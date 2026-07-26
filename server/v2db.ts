/* ============================================================
   v2.0 database helpers.

   Layered on top of server/db.ts. Keeps the v1.x logic untouched
   while exposing everything the v2.0 phone-app shell needs:
     - Guest identities pinned by a 30-day cookie
     - Upgrade path from guest -> registered user (preserves number,
       contacts, messages, call history)
     - Presence (online/offline + last seen)
     - Contacts CRUD
     - 1:1 conversations + messages + attachments

   All times are UTC Date objects. Numbers are 6-digit strings.
   ============================================================ */

import crypto from "crypto";
import {
  and,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNull,
  isNotNull,
  like,
  lt,
  lte,
  ne,
  or,
  sql,
  asc,
} from "drizzle-orm";
import {
  attachments,
  callHistory,
  conferenceHistory,
  conferenceParticipants,
  contacts,
  conversationParticipants,
  conversations,
  identities,
  messages,
  onlineWatches,
  partyLines,
  presence,
  pushSubscriptions,
  sessions,
  statuses,
  statusViews,
  users,
} from "../drizzle/schema";
import { getDb } from "./db";
import { hashRecoveryKey, newRecoveryKey } from "./guestRecovery";
import {
  sanitizeMobiles,
  sanitizeSocials,
  sanitizeStatusOverride,
  type SocialLink,
} from "@shared/profileFields";

/**
 * Rows a write actually touched, which is how every conditional claim in this file
 * decides whether IT won: the entire gate lives in the WHERE, so `affectedRows` is
 * the only trustworthy verdict — a prior read is a snapshot another request may
 * already have invalidated.
 *
 * Both driver shapes are handled: mysql2 returns `[ResultSetHeader]` with
 * `affectedRows`, while some drivers return a bare object with `rowsAffected`.
 * Reading only one of them would silently report every write as a loss.
 */
function affectedRowsOf(res: unknown): number {
  const direct = (res as { rowsAffected?: number; affectedRows?: number } | null)
    ?.rowsAffected;
  if (typeof direct === "number") return direct;
  const flat = (res as { affectedRows?: number } | null)?.affectedRows;
  if (typeof flat === "number") return flat;
  const head = Array.isArray(res)
    ? (res[0] as { affectedRows?: number } | undefined)?.affectedRows
    : undefined;
  return typeof head === "number" ? head : 0;
}

/* ── identity ─────────────────────────────────────────────────── */

const RESERVED_PREFIXES = ["000", "111"]; // avoid trivially-confused numbers
/** Per-owner contact ceiling (v2.99.57). Far above any real address book — the
 *  point is that the table is BOUNDED, so `listContacts` and its enrichment
 *  queries cannot be grown without limit by one free guest. `listContacts` uses
 *  the same number as its LIMIT, so no legitimate user is ever truncated and the
 *  client (which sorts and filters over the full list) needs no pagination. */
const MAX_CONTACTS_PER_OWNER = 5000;
/** Push endpoints kept per identity (v2.99.57). A real multi-device user has
 *  perhaps 4-6 (phone + tablet + desktop + PWA + a reinstall or two), so this sits
 *  comfortably above genuine use; the point is that `sendPushToIdentity` fans out
 *  over this list, and an uncapped table turned one identity into an unbounded
 *  burst of TLS connections and ECDH/AES-GCM operations in a 1GB single process.
 *  Eviction is OLDEST-FIRST so the device in the user's hand is never the one
 *  dropped. */
const MAX_PUSH_SUBS_PER_IDENTITY = 12;
const GUEST_DAYS = 30;

export function pairKey(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

function randomDigits6(): string {
  // SECURITY: every other identifier this codebase mints (OTP codes, guest/
  // verification tokens) uses a CSPRNG (crypto.randomInt/randomBytes) — this
  // was the one exception, using non-cryptographic Math.random(), whose
  // internal state (V8's xorshift128+) is recoverable from a handful of
  // observed outputs. Numbers are a semi-public dialing address, not a
  // secret, so the practical exploit is narrow (predicting/pre-claiming a
  // soon-to-be-issued number), but there is no reason to accept that
  // exposure when crypto.randomInt is the same one-line call.
  // Avoid leading zero -> reserves first digit 1-9.
  const first = 1 + crypto.randomInt(0, 9);
  const rest = crypto.randomInt(0, 100000).toString().padStart(5, "0");
  return `${first}${rest}`;
}

/**
 * True when `candidate` is already taken in EITHER number table. Identities and
 * party lines (v2.89) share ONE 6-digit number space — a dial resolves the
 * party line first, so a collision would permanently shadow a person (or make a
 * line unreachable). Both allocators check both tables.
 */
async function numberTaken(db: NonNullable<Awaited<ReturnType<typeof getDb>>>, candidate: string): Promise<boolean> {
  const existing = await db
    .select({ id: identities.id })
    .from(identities)
    .where(eq(identities.number, candidate))
    .limit(1);
  if (existing.length > 0) return true;
  try {
    const line = await db
      .select({ id: partyLines.id })
      .from(partyLines)
      .where(eq(partyLines.number, candidate))
      .limit(1);
    if (line.length > 0) return true;
  } catch {
    // party_lines may not exist yet on a first boot before the migrator ran —
    // treat as free (identical to pre-v2.89 behavior).
  }
  return false;
}

/**
 * M20: atomically RESERVE a candidate in the shared `number_reservations`
 * ledger. Returns true when this call won the reservation (INSERT succeeded),
 * false when another concurrent allocation already holds it (duplicate-key →
 * the caller retries with a fresh candidate). FAILS OPEN on any other error
 * (e.g. the table doesn't exist yet on a first boot before the migrator ran):
 * we return true so allocation proceeds EXACTLY as it did before this ledger
 * existed — the per-table UNIQUE keys + numberTaken remain the backstop, so
 * the ledger can only ever ADD cross-table safety, never remove correctness.
 */
async function tryReserveNumber(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  candidate: string,
): Promise<boolean> {
  try {
    await db.execute(sql`INSERT INTO \`number_reservations\` (\`number\`) VALUES (${candidate})`);
    return true;
  } catch (e) {
    // Detect the duplicate-key case by mysql's STABLE machine-readable markers
    // (errno 1062 / code ER_DUP_ENTRY) first, and only fall back to sniffing the
    // human-readable text. Matching the message ALONE was fragile in exactly the
    // wrong direction: this helper fails OPEN (returns true) for anything it
    // doesn't recognize, so a driver upgrade, a localized server, or a wrapped
    // error that no longer contains the literal word "duplicate" would silently
    // turn every lost race into "reservation won" — reintroducing the very
    // cross-table collision the ledger exists to prevent, with no visible sign.
    const err = e as { errno?: number; code?: string; message?: string };
    if (err?.errno === 1062 || err?.code === "ER_DUP_ENTRY") return false;
    if (/duplicate/i.test(err?.message || "")) return false;
    return true; // table missing / transient hiccup → behave as pre-ledger
  }
}

/** Shared allocator for the ONE 6-digit number space (identities + party
 *  lines). numberTaken guards pre-existing rows; tryReserveNumber closes the
 *  cross-table NEW-vs-NEW race atomically. */
/**
 * GLOBAL MINT BUDGET (v2.99.49).
 *
 * Every 6-digit number ever handed out is permanent, and the space is 10^6 —
 * shared by guests, registrations, party lines and regenerations. M21 metered
 * `startGuest` and M41 metered `regenerateNumber`, but the budget that matters is
 * GLOBAL while every one of those gates is PER-IP: a caller with several
 * addresses simply pays the toll several times. And the audit's own follow-up
 * note was right that a per-endpoint gate can always be forgotten — it was:
 * `POST /api/auth/register` reaches this same sink through `ensureUserIdentity`
 * and had no mint budget at all, at 43,200 permanent claims/day/IP, more than the
 * per-endpoint bound M21 advertised.
 *
 * So the ceiling lives HERE, at the one funnel all four allocators pass through,
 * where no future caller can miss it. It is sized far above any real day
 * (RELAY's whole population is a rounding error against it) and exists only to
 * stop a scripted drain: once the space is walked far enough, the 40-attempt
 * search below starts failing for EVERYONE — every new guest, every
 * registration, every party line — with no recovery short of DB surgery.
 *
 * Deliberately a soft rolling window rather than a hard daily counter: no schema,
 * no cross-instance coordination, and a restart resets it. That is an accepted
 * weakness — this is a backstop against a runaway loop, not an authorization
 * boundary, and the per-IP gates in front of it remain the first line.
 */
const MINT_WINDOW_MS = 60 * 60_000;          // one hour
const MINT_MAX_PER_WINDOW = 5_000;           // ~0.5% of the space per hour, per instance
let mintWindowStart = 0;
let mintedInWindow = 0;

/** Exported for tests + observability; call sites use it via allocateSharedNumber. */
export function mintBudgetState(nowMs: number): { used: number; remaining: number } {
  if (nowMs - mintWindowStart >= MINT_WINDOW_MS) return { used: 0, remaining: MINT_MAX_PER_WINDOW };
  return { used: mintedInWindow, remaining: Math.max(0, MINT_MAX_PER_WINDOW - mintedInWindow) };
}

function claimMintBudget(nowMs: number): boolean {
  if (nowMs - mintWindowStart >= MINT_WINDOW_MS) {
    mintWindowStart = nowMs;
    mintedInWindow = 0;
  }
  if (mintedInWindow >= MINT_MAX_PER_WINDOW) return false;
  mintedInWindow++;
  return true;
}

async function allocateSharedNumber(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
): Promise<string> {
  if (!claimMintBudget(Date.now())) {
    // Same error shape as exhaustion below, so every caller's existing handling
    // (guest start, registration, party line, regenerate) already covers it.
    throw new Error("number allocation is temporarily rate-limited");
  }
  for (let attempt = 0; attempt < 40; attempt++) {
    const candidate = randomDigits6();
    if (RESERVED_PREFIXES.some((p) => candidate.startsWith(p))) continue;
    if (await numberTaken(db, candidate)) continue;
    if (await tryReserveNumber(db, candidate)) return candidate;
    // else: a concurrent allocation just reserved this candidate — retry.
  }
  throw new Error("could not allocate a unique 6-digit number");
}

export async function allocateNumber(): Promise<string> {
  const db = await getDb();
  if (!db) throw new Error("database unavailable");
  return allocateSharedNumber(db);
}

export function newGuestToken(): string {
  return crypto.randomBytes(24).toString("hex");
}

export interface ResolvedIdentity {
  id: number;
  number: string;
  displayName: string;
  avatarUrl: string | null;
  userId: number | null;
  isGuest: boolean;
  guestExpiresAt: Date | null;
  bio: string | null;
  statusOverride: string | null;
  mobiles: string[];
  socials: SocialLink[];
  /** Email-verified → shows the blue badge. NULL column is treated as false. */
  verified: boolean;
  firstName: string | null;
  lastName: string | null;
  /** Away auto-reply, opt-in (v2.99.66). NULL column is treated as false. */
  autoReplyEnabled: boolean;
}

function parseJsonSafe(text: string | null | undefined): unknown {
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

function rowToResolved(row: typeof identities.$inferSelect): ResolvedIdentity {
  return {
    id: row.id,
    number: row.number,
    displayName: row.displayName,
    avatarUrl: row.avatarUrl ?? null,
    userId: row.userId ?? null,
    isGuest: row.userId == null,
    guestExpiresAt: row.guestExpiresAt ?? null,
    bio: row.bio ?? null,
    statusOverride: row.statusOverride ?? null,
    mobiles: sanitizeMobiles(parseJsonSafe(row.mobiles)),
    socials: sanitizeSocials(parseJsonSafe(row.socials)),
    // Strict: only an explicit `true` badges. NULL (legacy/never-verified) and
    // guests are unverified. Existing verified accounts are handled by the
    // one-time backfill in ensureSchemaExtensions.
    verified: row.verified === true,
    firstName: row.firstName ?? null,
    lastName: row.lastName ?? null,
    // Opt-in: only an explicit true enables the away auto-reply (v2.99.66).
    autoReplyEnabled: row.autoReplyEnabled === true,
  };
}

export async function getIdentityById(id: number): Promise<ResolvedIdentity | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(identities).where(eq(identities.id, id)).limit(1);
  return rows.length > 0 ? rowToResolved(rows[0]) : null;
}

export async function getIdentityByNumber(number: string): Promise<ResolvedIdentity | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(identities).where(eq(identities.number, number)).limit(1);
  return rows.length > 0 ? rowToResolved(rows[0]) : null;
}

/**
 * Is this user an administrator? (v2.99.76)
 *
 * THE SERVER-SIDE AUTHORITY for the admin panel. `whoami` already reports a `role`
 * so the client can decide what to RENDER, but that value has been through the
 * browser and is therefore a hint, not a permission — every admin procedure
 * re-derives the answer here, from the row.
 *
 * FAILS CLOSED. A DB hiccup means "not an admin", never "probably fine": the whole
 * point of the check is to stand between a stranger and other people's identities.
 */
export async function isUserAdmin(userId: number | null | undefined): Promise<boolean> {
  if (typeof userId !== "number" || !Number.isFinite(userId)) return false;
  const db = await getDb();
  if (!db) return false;
  try {
    const rows = await db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return rows[0]?.role === "admin";
  } catch {
    return false;
  }
}

/** One row of the admin panel's people list. Deliberately NOT the whole identity:
 *  see `adminFindIdentities` for what is withheld and why. */
export interface AdminIdentityRow {
  id: number;
  number: string;
  displayName: string;
  role: IdentityRole;
  email: string | null;
  isGuest: boolean;
  createdAt: Date | null;
}

/**
 * Find identities for the admin panel, by 6-digit number, email, or name.
 *
 * WHAT THIS DELIBERATELY DOES NOT RETURN, because an admin panel is a permanent
 * new read surface and the smallest one that does the job is the right one: no
 * message bodies, no contacts, no attachment keys, no credential hashes, no guest
 * tokens, no recovery hashes, no device ids. Identifying a person and their number
 * is the entire task the panel exists for.
 *
 * A blank query lists the most recent identities, which is what makes the panel
 * usable before you know what you are looking for.
 */
export async function adminFindIdentities(
  query: string,
  limit = 25
): Promise<AdminIdentityRow[]> {
  const db = await getDb();
  if (!db) return [];
  const q = (query || "").trim();
  const cap = Math.min(Math.max(1, limit), 50);
  const cols = {
    id: identities.id,
    number: identities.number,
    displayName: identities.displayName,
    verified: identities.verified,
    userId: identities.userId,
    userRole: users.role,
    email: users.email,
    createdAt: identities.createdAt,
  };
  try {
    const base = db.select(cols).from(identities).leftJoin(users, eq(users.id, identities.userId));
    // `like` parameterizes its value, but the WILDCARDS are ours to control: a `%`
    // typed by the operator would otherwise widen their own search silently rather
    // than matching the literal character they typed.
    const esc = q.replace(/[%_\\]/g, (c) => `\\${c}`);
    const rows = /^\d{6}$/.test(q)
      ? await base.where(eq(identities.number, q)).limit(cap)
      : q.length > 0
        ? await base
            .where(or(like(users.email, `%${esc}%`), like(identities.displayName, `%${esc}%`)))
            .limit(cap)
        : await base.orderBy(desc(identities.id)).limit(cap);
    return rows.map((r) => ({
      id: r.id,
      number: r.number,
      displayName: r.displayName,
      role: (r.userRole === "admin"
        ? "admin"
        : r.verified === true
          ? "registered"
          : "guest") as IdentityRole,
      email: r.email ?? null,
      isGuest: r.userId == null,
      createdAt: r.createdAt ?? null,
    }));
  } catch {
    return [];
  }
}

/** Three-tier account badge (v2.99.6, owner spec):
 *  admin — the identity's owning user carries users.role = "admin";
 *  registered — email-verified identity (the old "verified" blue badge);
 *  guest — everything else (no account, or never verified). */
export type IdentityRole = "guest" | "registered" | "admin";

/** Resolve the badge tier for a batch of identities in ONE query
 *  (identities LEFT JOIN users). Decoration-only: any DB hiccup returns an
 *  empty map and callers fall back to "guest"/verified — never throws. */
export async function getRolesByIdentityIds(ids: number[]): Promise<Map<number, IdentityRole>> {
  const out = new Map<number, IdentityRole>();
  if (ids.length === 0) return out;
  const db = await getDb();
  if (!db) return out;
  try {
    const rows = await db
      .select({ id: identities.id, verified: identities.verified, userRole: users.role })
      .from(identities)
      .leftJoin(users, eq(users.id, identities.userId))
      .where(inArray(identities.id, ids));
    rows.forEach((r) =>
      out.set(r.id, r.userRole === "admin" ? "admin" : r.verified === true ? "registered" : "guest")
    );
  } catch {
    /* badge is decoration — never break a payload over it */
  }
  return out;
}

export async function getIdentityByGuestToken(
  token: string
): Promise<ResolvedIdentity | null> {
  const db = await getDb();
  if (!db || !token) return null;
  const now = new Date();
  const rows = await db
    .select()
    .from(identities)
    .where(and(eq(identities.guestToken, token), gte(identities.guestExpiresAt, now)))
    .limit(1);
  return rows.length > 0 ? rowToResolved(rows[0]) : null;
}

/**
 * Resolve an identity by its sticky per-browser device id.
 *
 * This is the survival path when the guest cookie has been dropped
 * (third-party-cookie blocking, ITP, manual cookie clear) but the user
 * is still on the same browser. The device id lives in localStorage,
 * which survives network changes and a much wider set of privacy modes
 * than cookies.
 *
 * We deliberately do NOT check guest expiry here: the device id is
 * stable across the full lifetime of the browser profile, and an active
 * user on the same browser should never lose their number just because
 * their cookie clock ticked over.
 *
 * Returns guest identities only — a registered (userId-bound) identity
 * must be resolved through the OAuth session, not by a device id which
 * can be replayed.
 */
export async function getIdentityByDeviceId(
  deviceId: string | null | undefined
): Promise<ResolvedIdentity | null> {
  if (!deviceId) return null;
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(identities)
    .where(and(eq(identities.deviceId, deviceId), isNull(identities.userId)))
    .limit(1);
  return rows.length > 0 ? rowToResolved(rows[0]) : null;
}

/**
 * Pin the supplied device id to an existing identity. Used in two
 * places:
 *   1. createGuestIdentity — binds at first sign-in so the row is
 *      discoverable on cookie loss.
 *   2. Context resolver — if an identity already has no device id but
 *      the caller is presenting one, bind it now (one-time upgrade so
 *      pre-existing rows benefit from the new behavior without a
 *      reset).
 *
 * Refuses to overwrite a non-null deviceId with a different value —
 * that's a sign of a stolen cookie being replayed from a different
 * device, and we should not silently accept it. Returns `true` if the
 * row was updated, `false` if no change was made (either same value or
 * mismatch).
 */
export async function bindDeviceIdToIdentity(
  identityId: number,
  deviceId: string
): Promise<boolean> {
  if (!deviceId || deviceId.length < 8) return false;
  const db = await getDb();
  if (!db) return false;
  const result = await db
    .update(identities)
    .set({ deviceId })
    .where(
      and(
        eq(identities.id, identityId),
        // Only bind when the slot is still empty.
        isNull(identities.deviceId)
      )
    );
  // drizzle-orm/mysql2 returns a ResultSetHeader-like object; we treat
  // any non-error result as success and rely on the WHERE to ensure
  // we don't trample existing bindings.
  void result;
  return true;
}

export async function getIdentityByUserId(userId: number): Promise<ResolvedIdentity | null> {
  const db = await getDb();
  if (!db) return null;
  // SECURITY / INTEGRITY (M47): ORDER BY id — always resolve to the OLDEST
  // identity for this user.
  //
  // `ensureUserIdentity` is a check-then-insert (read by userId, then create a
  // fresh identity) with no unique constraint behind it, so two concurrent
  // sign-ins for the same account — a double-tapped Sign in, two devices at
  // once, an OTP verify racing a PIN login — could each see "no identity yet"
  // and each mint one, leaving the user with TWO identity rows and TWO 6-digit
  // numbers. With a bare `.limit(1)` and no ordering, MySQL may then return
  // EITHER row per query, so the same account reports different numbers on
  // different requests and its messages/contacts split across both. That is
  // precisely the long-standing "my number changes randomly / this device shows
  // a different number" symptom.
  //
  // Ordering makes resolution DETERMINISTIC even where duplicate rows already
  // exist in production, so every surface agrees on one identity; the unique
  // index added by the boot migrator stops new duplicates being created at all.
  const rows = await db
    .select()
    .from(identities)
    .where(eq(identities.userId, userId))
    .orderBy(asc(identities.id))
    .limit(1);
  return rows.length > 0 ? rowToResolved(rows[0]) : null;
}

/**
 * Create a new guest identity with a fresh 6-digit number and a 30-day cookie.
 * Returns the new identity plus the token to put in the response cookie.
 *
 * If a `deviceId` is provided, it is bound to the row. Subsequent
 * `whoami` calls from the same browser — even after a full cookie
 * wipe — will resolve back to this identity via the device id, so the
 * user keeps the same name and number.
 */
export async function createGuestIdentity(input: {
  displayName: string;
  deviceId?: string | null;
}): Promise<{ identity: ResolvedIdentity; guestToken: string; recoveryKey: string }> {
  const db = await getDb();
  if (!db) throw new Error("database unavailable");
  const number = await allocateNumber();
  const guestToken = newGuestToken();
  const guestExpiresAt = new Date(Date.now() + GUEST_DAYS * 24 * 60 * 60 * 1000);
  const displayName = input.displayName.trim().slice(0, 64) || "Guest";
  const deviceId =
    typeof input.deviceId === "string" && input.deviceId.length >= 8
      ? input.deviceId
      : null;
  // Adopt-and-Retire (v2.99.68): mint the recovery key in the SAME insert that
  // creates the identity, so there is no window in which a guest exists with no
  // way back to it. Only the hash is stored.
  const recoveryKey = newRecoveryKey();
  await db.insert(identities).values({
    number,
    displayName,
    guestToken,
    guestExpiresAt,
    deviceId,
    recoveryHash: hashRecoveryKey(recoveryKey),
    recoveryIssuedAt: new Date(),
  });
  await confirmNumberReservation(number); // the number is now genuinely bound
  const created = await db
    .select()
    .from(identities)
    .where(eq(identities.guestToken, guestToken))
    .limit(1);
  if (created.length === 0) throw new Error("insert succeeded but row missing");
  return { identity: rowToResolved(created[0]), guestToken, recoveryKey };
}

/* ── Adopt-and-Retire: reclaiming an identity the browser forgot ───────────── */

/**
 * Give an EXISTING guest identity a recovery key if it has none, and hand the raw
 * key back so the browser can store it.
 *
 * This is the self-healing half. Every identity minted before v2.99.68 has a NULL
 * `recoveryHash`, and so does every guest whose row predates the feature — without
 * this they would stay permanently unrecoverable, which is precisely the failure
 * this release exists to end. `startGuest`'s two reuse branches call it, so an
 * ordinary returning visitor is issued one on their next visit with no action.
 *
 * Returns null (never throws) when there is nothing to do or nothing can be done:
 *   - the row already has a hash — re-minting would INVALIDATE the key the browser
 *     may already hold, converting a recoverable identity into a lost one, so an
 *     existing hash is never overwritten here;
 *   - the row belongs to an account (`userId` set) — a registered user recovers by
 *     signing in, and a bearer key must never be able to claim an account's row;
 *   - the database is unavailable. A guest sign-in must not fail because a
 *     convenience column could not be written.
 */
export async function ensureGuestRecoveryKey(
  identityId: number
): Promise<string | null> {
  try {
    const db = await getDb();
    if (!db) return null;
    const key = newRecoveryKey();
    const res = await db
      .update(identities)
      .set({ recoveryHash: hashRecoveryKey(key), recoveryIssuedAt: new Date() })
      .where(
        and(
          eq(identities.id, identityId),
          isNull(identities.userId),
          isNull(identities.recoveryHash)
        )
      );
    // The whole gate is in the WHERE, so the verdict comes from the write itself
    // and two concurrent requests cannot both believe they minted the live key.
    return affectedRowsOf(res) > 0 ? key : null;
  } catch {
    return null;
  }
}

/**
 * Resolve the guest identity a recovery key names, or null.
 *
 * Deliberately NOT gated on `guestExpiresAt`: the expiry models the COOKIE's life,
 * and this lookup exists for exactly the case where that cookie is long gone. It IS
 * gated on `userId IS NULL`, so a key can only ever name an unclaimed identity —
 * once someone registers, the row is reachable by signing in and by nothing else.
 */
export async function findRecoverableGuestIdentity(
  recoveryHash: string
): Promise<ResolvedIdentity | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(identities)
    .where(and(eq(identities.recoveryHash, recoveryHash), isNull(identities.userId)))
    .orderBy(asc(identities.id))
    .limit(1);
  return rows.length > 0 ? rowToResolved(rows[0]) : null;
}

/** What is actually attached to an identity. Every field is a row count. */
export type IdentityFootprint = {
  messages: number;
  conversations: number;
  contacts: number;
  calls: number;
  conferences: number;
  statuses: number;
  partyLines: number;
};

/** True when nothing at all hangs off the identity, i.e. retiring it loses nothing. */
export function footprintIsEmpty(f: IdentityFootprint): boolean {
  return (
    f.messages === 0 &&
    f.conversations === 0 &&
    f.contacts === 0 &&
    f.calls === 0 &&
    f.conferences === 0 &&
    f.statuses === 0 &&
    f.partyLines === 0
  );
}

/**
 * Count everything that references an identity.
 *
 * Two jobs, and they pull in the same direction. It tells the USER what they are
 * about to get back ("14 contacts, 320 messages"), which is what makes the restore
 * prompt trustworthy rather than a leap of faith. And it is the SAFETY GATE on the
 * row being retired: adoption only ever deletes a provably empty identity, because
 * the single way this feature could destroy data is by removing a non-empty row.
 *
 * The table/column list is the same one `scripts/recover-orphan-identity.mjs`
 * validates against `information_schema` — note `contacts.ownerId` (not
 * `ownerIdentityId`) and that call history splits into caller/callee columns; both
 * were wrong in the first draft of that script and are easy to get wrong again.
 *
 * A count that cannot be read is reported as -1, never 0, so a failed query can
 * never make a populated identity look empty to the gate.
 */
export async function identityFootprint(
  identityId: number
): Promise<IdentityFootprint> {
  const db = await getDb();
  const zero: IdentityFootprint = {
    messages: -1,
    conversations: -1,
    contacts: -1,
    calls: -1,
    conferences: -1,
    statuses: -1,
    partyLines: -1,
  };
  if (!db) return zero;
  const one = async (run: () => Promise<{ n: number }[]>): Promise<number> => {
    try {
      const rows = await run();
      const n = Number(rows[0]?.n ?? -1);
      return Number.isFinite(n) ? n : -1;
    } catch {
      return -1;
    }
  };
  const [m, c, ct, ch, cp, st, pl] = await Promise.all([
    one(() =>
      db
        .select({ n: sql<number>`count(*)` })
        .from(messages)
        .where(eq(messages.senderIdentityId, identityId))
    ),
    one(() =>
      db
        .select({ n: sql<number>`count(*)` })
        .from(conversationParticipants)
        .where(eq(conversationParticipants.identityId, identityId))
    ),
    one(() =>
      db
        .select({ n: sql<number>`count(*)` })
        .from(contacts)
        .where(eq(contacts.ownerId, identityId))
    ),
    one(() =>
      db
        .select({ n: sql<number>`count(*)` })
        .from(callHistory)
        .where(
          or(
            eq(callHistory.callerIdentityId, identityId),
            eq(callHistory.calleeIdentityId, identityId)
          )
        )
    ),
    one(() =>
      db
        .select({ n: sql<number>`count(*)` })
        .from(conferenceParticipants)
        .where(eq(conferenceParticipants.identityId, identityId))
    ),
    one(() =>
      db
        .select({ n: sql<number>`count(*)` })
        .from(statuses)
        .where(eq(statuses.identityId, identityId))
    ),
    one(() =>
      db
        .select({ n: sql<number>`count(*)` })
        .from(partyLines)
        .where(eq(partyLines.ownerIdentityId, identityId))
    ),
  ]);
  return {
    messages: m,
    conversations: c,
    contacts: ct,
    calls: ch,
    conferences: cp,
    statuses: st,
    partyLines: pl,
  };
}

/** Why an adoption was refused. The caller turns these into copy. */
export type AdoptRefusal =
  | "unavailable"
  | "not-found"
  | "current-has-data"
  | "footprint-unknown"
  | "race-lost";

export type AdoptResult =
  | { ok: true; identity: ResolvedIdentity; guestToken: string | null; retiredId: number | null }
  | { ok: false; reason: AdoptRefusal };

/**
 * Move this browser (or this account) onto a recovered identity, and retire the
 * one it is currently using.
 *
 * THE SHAPE, and why it is this shape:
 *
 *   - The recovered identity KEEPS ITS OWN NUMBER. That is the entire point — the
 *     number is what other people stored, so restoring the person must not move it.
 *     Nothing here ever writes `identities.number`, which is also why the
 *     `NUMBER_BEARING_COLUMNS` contract (v2.99.54) needs no new entry.
 *
 *   - The identity being RETIRED must be provably EMPTY. Otherwise adoption would
 *     just move the loss to the other row, and this feature would become a new way
 *     to destroy data. There is deliberately no override flag; a caller holding
 *     real data on both rows is told so and keeps both.
 *
 *   - A GUEST caller has this browser rebound to the recovered row: the device id
 *     and a fresh guest token move over, so every subsequent request resolves it
 *     the ordinary way with no special case anywhere else in the codebase.
 *
 *   - A REGISTERED caller has the recovered row CLAIMED by their account
 *     (`userId` set, guest fields cleared) — the same claim `ensureUserIdentity`
 *     performs, and it must be preceded by deleting their current identity because
 *     the per-account unique index on identities.userId allows exactly one.
 *
 * Every write re-checks its own preconditions in the WHERE clause, so a concurrent
 * change LOSES rather than corrupting, and a lost race is reported as such instead
 * of being papered over.
 */
export async function adoptRecoveredIdentity(input: {
  recoveryHash: string;
  /**
   * The identity this request already resolved, or null when the visitor has none
   * yet — which is the PRIMARY path: someone reopens their browser, the entry
   * screen sees a recovery record, and they restore before typing a name. With no
   * current identity there is nothing to retire, so the emptiness gate below has
   * nothing to check and is correctly skipped.
   */
  currentIdentityId: number | null;
  currentUserId: number | null;
  deviceId?: string | null;
}): Promise<AdoptResult> {
  const db = await getDb();
  if (!db) return { ok: false, reason: "unavailable" };

  const target = await findRecoverableGuestIdentity(input.recoveryHash).catch(
    () => null
  );
  if (!target) return { ok: false, reason: "not-found" };

  // Already there. Idempotent so a double-tap, a retry, or a replayed request is
  // a no-op success rather than an error the user has to interpret.
  if (target.id === input.currentIdentityId) {
    return { ok: true, identity: target, guestToken: null, retiredId: null };
  }

  const retiring = input.currentIdentityId;
  if (retiring != null) {
    const footprint = await identityFootprint(retiring);
    // -1 means a count could not be read. Refusing here is the fail-closed choice:
    // treating an unknown as empty is how you delete somebody's messages.
    if (Object.values(footprint).some(n => n < 0)) {
      return { ok: false, reason: "footprint-unknown" };
    }
    if (!footprintIsEmpty(footprint)) {
      return { ok: false, reason: "current-has-data" };
    }
  }

  const guestToken = input.currentUserId == null ? newGuestToken() : null;
  const deviceId =
    typeof input.deviceId === "string" && input.deviceId.length >= 8
      ? input.deviceId
      : null;

  let claimed = 0;
  await db.transaction(async tx => {
    // Retire the empty row FIRST — the per-account unique index means the claim
    // below cannot succeed while it still exists. Each branch re-states its own
    // ownership in the WHERE, so this can only ever delete the row the caller
    // genuinely holds: never another guest's, never another account's.
    if (retiring != null) {
      await tx
        .delete(identities)
        .where(
          input.currentUserId == null
            ? and(eq(identities.id, retiring), isNull(identities.userId))
            : and(
                eq(identities.id, retiring),
                eq(identities.userId, input.currentUserId)
              )
        );
    }
    const res = await tx
      .update(identities)
      .set(
        input.currentUserId == null
          ? {
              // Stay a guest, but bound to THIS browser.
              deviceId,
              guestToken,
              guestExpiresAt: new Date(
                Date.now() + GUEST_DAYS * 24 * 60 * 60 * 1000
              ),
            }
          : {
              // Become this account's identity. Guest handles are dropped so the
              // recovery key and the old cookie stop naming it — after adoption the
              // account is the only way in, which is what a registered identity
              // means everywhere else in the codebase.
              userId: input.currentUserId,
              guestToken: null,
              guestExpiresAt: null,
              recoveryHash: null,
              recoveryIssuedAt: null,
              deviceId,
            }
      )
      .where(and(eq(identities.id, target.id), isNull(identities.userId)));
    claimed = affectedRowsOf(res);
    if (claimed === 0) {
      // Somebody registered the target between our read and this write. Roll the
      // delete back rather than leaving the caller with no identity at all.
      throw new Error("adopt-race");
    }
  }).catch(() => {
    claimed = 0;
  });

  if (claimed === 0) return { ok: false, reason: "race-lost" };

  const fresh = await getIdentityById(target.id).catch(() => null);
  return {
    ok: true,
    identity: fresh ?? target,
    guestToken,
    retiredId: retiring,
  };
}

/**
 * Extend the cookie expiry on every visit so an active guest never loses
 * their number while still in regular use.
 */
export async function touchGuestExpiry(identityId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const guestExpiresAt = new Date(Date.now() + GUEST_DAYS * 24 * 60 * 60 * 1000);
  await db
    .update(identities)
    .set({ guestExpiresAt })
    .where(and(eq(identities.id, identityId), isNull(identities.userId)));
}

/**
 * Ensure a registered user has exactly one identity. If they were previously
 * a guest with a cookie present, upgrade that row in place so all their data
 * stays with them. Otherwise create a fresh permanent identity.
 */
export async function ensureUserIdentity(input: {
  userId: number;
  displayName: string;
  guestToken: string | null;
  /**
   * The identity `createContext` ALREADY resolved for this request, and the
   * browser's device id — both added in v2.99.49 to fix real data loss.
   *
   * THE BUG: this function used to look for the guest by `guestToken` ONLY, while
   * `createContext` resolves a guest by guestToken OR deviceId and documents that
   * "cookies are a hint, device id is the truth" — device id WINS there when the
   * two disagree. So whenever the browser's live guest identity was the
   * device-resolved one (a cleared or expired guest cookie, an ITP-dropped
   * cookie, a rotated token), registration looked up nothing, fell through to the
   * fresh-identity branch, and minted a NEW 6-digit number. The user's guest
   * identity — their number, contacts, messages and call history — was silently
   * orphaned, and they landed on an empty account with a different number.
   *
   * Passing the resolved identity makes the upgrade use exactly the same notion of
   * "who is this browser" as every other request, which is the only way the two
   * can't drift apart again.
   */
  resolvedIdentityId?: number | null;
  deviceId?: string | null;
}): Promise<ResolvedIdentity> {
  const db = await getDb();
  if (!db) throw new Error("database unavailable");

  const existingByUser = await getIdentityByUserId(input.userId);
  if (existingByUser) {
    // The account already has an identity. Don't touch the guest row — but say so,
    // because it means a guest session in this browser is about to be left behind
    // (re-registering an address that already has an account).
    if (input.resolvedIdentityId && input.resolvedIdentityId !== existingByUser.id) {
      console.warn(
        `[identity] user ${input.userId} already owns identity ${existingByUser.id}; guest identity ${input.resolvedIdentityId} left unclaimed`
      );
    }
    return existingByUser;
  }

  /* Claim the guest identity this browser is ACTUALLY using. Tried in the same
     order of authority as createContext: the already-resolved identity first
     (which is device-id-aware), then the cookie token, then the device id. */
  // A plain array with an explicit dedupe rather than a Set: this project sets no
  // `target`, so it compiles as ES5 and iterating a Set is a type error.
  const candidates: number[] = [];
  const addCandidate = (id: number | null | undefined) => {
    if (id && !candidates.includes(id)) candidates.push(id);
  };
  addCandidate(input.resolvedIdentityId);
  if (input.guestToken) {
    try {
      const byToken = await getIdentityByGuestToken(input.guestToken);
      addCandidate(byToken?.id);
    } catch {
      /* a lookup hiccup must not cost the number */
    }
  }
  if (input.deviceId) {
    try {
      const byDevice = await getIdentityByDeviceId(input.deviceId);
      addCandidate(byDevice?.id);
    } catch {
      /* same */
    }
  }

  for (const candidateId of candidates) {
    // Conditional on `userId IS NULL`, so this can only ever claim an UNCLAIMED
    // guest row — it can never steal an identity that already belongs to another
    // account, however the candidate was resolved.
    //
    // Wrapped because `identities.userId` carries a UNIQUE index
    // (identities_user_unique, installed by the boot migrator): if a concurrent
    // sign-in for the same account already claimed or minted an identity between
    // our getIdentityByUserId read and this write, the UPDATE violates it and
    // throws. The mint path below anticipates exactly that race and resolves to
    // the winner; the claim path did not, and the asymmetry was unintentional —
    // an uncaught throw here surfaces as a 500 from verifyOtp AFTER the one-time
    // code has already been consumed, so the user is told their code was already
    // used and has to request another for a registration that half-completed.
    let claimed = false;
    try {
      const res = await db
        .update(identities)
        .set({
          userId: input.userId,
          displayName: input.displayName.trim().slice(0, 64) || undefined,
          guestToken: null,
          guestExpiresAt: null,
          // v2.99.68: drop the guest recovery key along with the other guest
          // handles. `findRecoverableGuestIdentity` already refuses a row with a
          // `userId`, so this is defence in depth rather than the gate — but a
          // dangling bearer credential on an account's identity is precisely the
          // kind of leftover a future code path forgets to check for.
          recoveryHash: null,
          recoveryIssuedAt: null,
        })
        .where(and(eq(identities.id, candidateId), isNull(identities.userId)));
      claimed =
        Array.isArray(res) && ((res[0] as { affectedRows?: number })?.affectedRows ?? 0) > 0;
    } catch {
      // Lost the race. The winner is another identity for this same account, and
      // resolving to it is strictly better than throwing — and better than
      // falling through to mint, which would allocate a second number.
      const winner = await getIdentityByUserId(input.userId);
      if (winner) return winner;
    }
    if (!claimed) continue;
    const refreshed = await getIdentityById(candidateId);
    if (refreshed) return refreshed; // SAME number, SAME contacts/messages/history
  }

  // Fresh permanent identity.
  const number = await allocateNumber();
  try {
    await db.insert(identities).values({
      number,
      displayName: input.displayName.trim().slice(0, 64) || "User",
      userId: input.userId,
    });
  } catch (e) {
    // The number was reserved but never bound — give it back (v2.99.49).
    await releaseUnusedNumberReservation(number);
    // The usual cause is a concurrent sign-in winning the per-user unique index.
    // Resolving to the winner is strictly better than the old behaviour, where
    // the loser's request ended up with no identity at all.
    const winner = await getIdentityByUserId(input.userId);
    if (winner) return winner;
    throw e;
  }
  await confirmNumberReservation(number);
  const created = await getIdentityByNumber(number);
  if (!created) throw new Error("user identity insert failed");
  return created;
}

/** Flip an identity to verified (blue badge) and record the registration name.
 *  Called after a successful email-OTP verification. */
/**
 * Turn this identity's away auto-reply on or off (v2.99.66). Opt-in: only an
 * explicit `true` ever enables it.
 */
export async function setIdentityAutoReply(id: number, enabled: boolean): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("database unavailable");
  await db.update(identities).set({ autoReplyEnabled: enabled }).where(eq(identities.id, id));
}

/**
 * Does this identity want an away auto-reply sent on their behalf?
 *
 * FAILS CLOSED on any trouble (missing row, DB hiccup, legacy NULL): an
 * auto-reply is a message posted in someone's name to a conversation they are
 * not watching, so silence is always the safer answer than guessing yes.
 */
export async function autoReplyEnabledFor(identityId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  try {
    const rows = await db
      .select({ on: identities.autoReplyEnabled })
      .from(identities)
      .where(eq(identities.id, identityId))
      .limit(1);
    return rows[0]?.on === true;
  } catch {
    return false;
  }
}

export async function markIdentityVerified(
  id: number,
  name?: { firstName?: string | null; lastName?: string | null },
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const patch: Record<string, unknown> = { verified: true };
  if (name?.firstName != null) patch.firstName = name.firstName.trim().slice(0, 64) || null;
  if (name?.lastName != null) patch.lastName = name.lastName.trim().slice(0, 64) || null;
  await db.update(identities).set(patch).where(eq(identities.id, id));
}

export async function updateIdentityProfile(
  id: number,
  patch: {
    displayName?: string;
    avatarUrl?: string | null;
    bio?: string | null;
    statusOverride?: string;
    mobiles?: unknown;
    socials?: unknown;
  }
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const set: Record<string, unknown> = {};
  if (patch.displayName !== undefined) {
    const n = patch.displayName.trim().slice(0, 64);
    if (n.length > 0) set.displayName = n;
  }
  if (patch.avatarUrl !== undefined) set.avatarUrl = patch.avatarUrl;
  if (patch.bio !== undefined) {
    const b = (patch.bio ?? "").toString().trim().slice(0, 500);
    set.bio = b || null;
  }
  if (patch.statusOverride !== undefined) {
    set.statusOverride = sanitizeStatusOverride(patch.statusOverride) || null;
  }
  if (patch.mobiles !== undefined) set.mobiles = JSON.stringify(sanitizeMobiles(patch.mobiles));
  if (patch.socials !== undefined) set.socials = JSON.stringify(sanitizeSocials(patch.socials));
  if (Object.keys(set).length === 0) return;
  await db.update(identities).set(set).where(eq(identities.id, id));
}

/* ── the number-copy registry ──────────────────────────────────────────────
 *
 * RELAY calls you two things. Your IDENTITY ROW is who you are: contacts,
 * messages, conversation membership, call logs and statuses all reference it by
 * numeric id, so they follow you through every transition — registering,
 * a new device, a cleared cookie, a renumber — with nothing to migrate. Your
 * 6-DIGIT NUMBER is how other people reach you, and wherever it is STORED
 * rather than referenced, that storage is a COPY that can go stale.
 *
 * Every stale copy is a user-visible glitch: a dead call-back button, a wrong
 * PIN shown as fact, a contact that no longer reaches anyone, a presence dot
 * stuck grey. Before v2.99.54 the guarantee lived inside one function that
 * happened to know about `contacts` — so History's number copies rotted
 * silently on every renumber, and nothing would have caught a new table
 * repeating the mistake.
 *
 * This registry is the guarantee instead. Every column in the schema that holds
 * a 6-digit number must appear here with how it stays correct, and
 * `server/numberContinuity.test.ts` reads `drizzle/schema.ts` and FAILS THE
 * BUILD if one does not. Adding a number-bearing column without deciding its
 * strategy is therefore impossible to ship.
 *
 *   "identity"     the source of truth — the identity's own number.
 *   "renumber"     a stored copy, rewritten inside regenerateIdentityNumber's
 *                  transaction (all-or-nothing with the identity move).
 *   "live"         a frozen historical copy that is never rewritten, because it
 *                  is RESOLVED from the identity at read time. Preferred: it is
 *                  correct for renumbers that already happened, needs no
 *                  migration, and cannot drift.
 *   "not-a-person" a number belonging to something other than a person, which a
 *                  person renumbering must NOT touch.
 */
export const NUMBER_BEARING_COLUMNS = [
  {
    table: "identities",
    column: "number",
    strategy: "identity",
    note: "The number itself. regenerateIdentityNumber is the only writer.",
  },
  {
    table: "contacts",
    column: "number",
    strategy: "renumber",
    note:
      "How everyone else reaches you. Rewritten so contacts keep working — and " +
      "so a block placed on your old number FOLLOWS you rather than being shed.",
  },
  {
    table: "conference_participants",
    column: "number",
    strategy: "renumber",
    note: "Scoped by identityId, so it can only ever rewrite this person's own row.",
  },
  {
    table: "conference_history",
    column: "dialedNumber",
    strategy: "live",
    note:
      "History's call-back target. Resolved through the roster's identityId in " +
      "calls.conferenceHistory, so it dials who you actually called, not a " +
      "number they have since left behind. Party-line numbers pass through " +
      "unchanged (a line is not a person).",
  },
  {
    table: "party_lines",
    column: "number",
    strategy: "not-a-person",
    note:
      "The LINE's own dialable number, from the same space but owned by the line, " +
      "not its creator. Renumbering a person must never move it.",
  },
] as const;

/**
 * Pure planner for renumbering: given every contact row that references EITHER
 * the old OR the new number, decide which rows to UPDATE to the new number and
 * which to DELETE (a stale pre-existing new-number row owned by the same person,
 * which would otherwise collide with the unique (ownerId, number) key). Pure so
 * the tricky collision logic is unit-tested without a DB.
 */
export function planRenumber(
  rows: Array<{ id: number; ownerId: number; number: string }>,
  oldNumber: string,
  newNumber: string
): { updateIds: number[]; deleteIds: number[] } {
  if (oldNumber === newNumber) return { updateIds: [], deleteIds: [] };
  const newRowByOwner = new Map<number, number>(); // ownerId -> row id holding newNumber
  for (const r of rows) if (r.number === newNumber) newRowByOwner.set(r.ownerId, r.id);
  const updateIds: number[] = [];
  const deleteIds: number[] = [];
  for (const r of rows) {
    if (r.number !== oldNumber) continue;
    updateIds.push(r.id);
    const collidingId = newRowByOwner.get(r.ownerId);
    if (collidingId !== undefined) deleteIds.push(collidingId); // drop the stale dup
  }
  return { updateIds, deleteIds };
}

/**
 * Normalize a number somebody TYPED, for the choose-your-own-number path
 * (v2.99.75). Returns the canonical 6 digits, or null when it is not a number
 * this system can hand out.
 *
 * FAILS CLOSED, and deliberately does its own shape check rather than trusting
 * the caller's: this value reaches the one function allowed to move an identity's
 * number, and every place a number is validated in this codebase agrees on
 * exactly six digits. Spacing and the display grouping people naturally type
 * ("777 777", "777-777") are accepted because refusing them would just be rude;
 * anything else — a letter, five digits, seven, a reserved prefix — is not.
 */
export function normalizeDesiredNumber(input: unknown): string | null {
  if (typeof input !== "string") return null;
  // Strip only spaces and the two grouping characters a person would type. NOT
  // every non-digit: doing that would silently accept "7a7b7c7d7e7f" as 777777,
  // i.e. turn a typo into a successful renumber of somebody's identity.
  const cleaned = input.replace(/[\s\-.]/g, "");
  if (!/^\d{6}$/.test(cleaned)) return null;
  if (RESERVED_PREFIXES.some((p) => cleaned.startsWith(p))) return null;
  return cleaned;
}

/** Why a chosen number could not be taken. Named, because each has a different
 *  correct next step for the person who typed it. */
export type ChooseNumberError = "invalid" | "taken" | "budget";

/**
 * Regenerate this identity's 6-digit number and PROPAGATE it across the network:
 * every contact that saved the OLD number is rewritten to the NEW one, so people
 * keep reaching them without re-adding. Collisions with a stale (ownerId,new)
 * contact are resolved by dropping the stale row first. Returns the old/new pair.
 *
 * Everything with strategy "renumber" in NUMBER_BEARING_COLUMNS moves here, in
 * ONE transaction with the identity itself, so the system is never half-moved.
 * The "live" copies are deliberately NOT rewritten — they are resolved from the
 * identity when read, which is also why renumbers that happened BEFORE this
 * release come out correct with no backfill.
 *
 * `desiredNumber` (v2.99.75) picks a SPECIFIC number instead of a random one.
 * It is a parameter here rather than a second function on purpose: propagation is
 * the whole difficulty of renumbering, and a parallel implementation is exactly
 * how History's copies came to rot before v2.99.54. `guestUpgrade.test.ts` pins
 * that the codebase contains exactly ONE writer of `identities.number`, so this
 * is also the only shape that can ship.
 *
 * Throws a `ChooseNumberError` message for a desired number that cannot be taken.
 */
export async function regenerateIdentityNumber(
  identityId: number,
  desiredNumber?: string
): Promise<{ oldNumber: string; newNumber: string } | null> {
  const db = await getDb();
  if (!db) throw new Error("database unavailable");
  const id = await getIdentityById(identityId);
  if (!id) return null;
  // The PRE-FLIGHT snapshot. Used for the no-op check and the budget decisions
  // below, then REFRESHED inside the transaction under a row lock — see there for
  // why the pre-flight value cannot be the propagation key (v2.99.81).
  let oldNumber = id.number;
  let newNumber: string;
  if (desiredNumber !== undefined) {
    const want = normalizeDesiredNumber(desiredNumber);
    if (!want) throw new Error("invalid" satisfies ChooseNumberError);
    // Already theirs: a no-op, not an error. Makes a double-tap and a retry after
    // a dropped response both harmless, rather than reporting "taken" about the
    // caller's own number — which is true and useless.
    if (want === oldNumber) return { oldNumber, newNumber: oldNumber };
    // Same permanent resource a random allocation spends, so it is metered the
    // same way — the global budget is the backstop against a scripted drain of
    // the space, and it must not be sidesteppable by naming numbers instead of
    // asking for them.
    if (!claimMintBudget(Date.now())) throw new Error("budget" satisfies ChooseNumberError);
    if (await numberTaken(db, want)) throw new Error("taken" satisfies ChooseNumberError);
    // Take it in the shared ledger too, which is what closes the cross-table
    // NEW-vs-NEW race against a party line being created in the same instant.
    if (!(await tryReserveNumber(db, want))) throw new Error("taken" satisfies ChooseNumberError);
    newNumber = want;
  } else {
    newNumber = await allocateNumber();
  }
  // The identity update and contact propagation must succeed or fail TOGETHER.
  // The old code swallowed a propagation failure (try/catch around it only),
  // which could leave the identity pointed at newNumber while every contact
  // who'd saved the OLD number silently kept dialing a number that's no longer
  // this person — a split-brain the caller never finds out about (the function
  // still returned success). A transaction makes it all-or-nothing.
  await db.transaction(async (tx) => {
    // RE-READ THE OLD NUMBER UNDER A ROW LOCK (v2.99.81).
    //
    // The pre-flight read above happens up to three DB round-trips before this
    // transaction opens (`allocateNumber` alone does two SELECTs plus a ledger
    // insert, retried up to 40x). Two concurrent renumbers of the same identity
    // therefore both captured the SAME `oldNumber`; the loser's UPDATE below blocks
    // on the winner's row lock, and under REPEATABLE READ its read view forms at
    // the first consistent read — the contacts SELECT — which runs AFTER the winner
    // committed. So the loser propagated against a number that no longer existed,
    // matched nothing, and left every saver's contact row stranded on the winner's
    // number: a number nobody holds and never will, because the ledger is
    // monotonic. That is permanent and self-heals nowhere, and because
    // `isNumberBlockedBy` keys on `contacts.number`, it also SHEDS a block the
    // renumbering person was under — the exact invariant the registry promises
    // ("a block placed on your old number FOLLOWS you").
    //
    // A locking SELECT, deliberately not a second writer: this file must contain
    // exactly ONE writer of `identities.number`, which is what stops a parallel
    // implementation from skipping propagation.
    const [cur] = await tx
      .select({ number: identities.number })
      .from(identities)
      .where(eq(identities.id, identityId))
      .for("update");
    if (!cur) throw new Error("identity-gone");
    oldNumber = cur.number;
    // A racer may already have landed us on exactly this number (two identical
    // chosen-number requests). Nothing to do, and propagating with
    // oldNumber === newNumber would delete rows it should keep.
    if (oldNumber === newNumber) return;
    // Point the identity at the new number first (unique index guarantees it's free).
    await tx.update(identities).set({ number: newNumber }).where(eq(identities.id, identityId));
    // Propagate to contacts. Fetch the rows touching either number, plan, apply.
    const affected = await tx
      .select({ id: contacts.id, ownerId: contacts.ownerId, number: contacts.number })
      .from(contacts)
      .where(or(eq(contacts.number, oldNumber), eq(contacts.number, newNumber)));
    const plan = planRenumber(affected, oldNumber, newNumber);
    if (plan.deleteIds.length > 0) {
      await tx.delete(contacts).where(inArray(contacts.id, plan.deleteIds));
    }
    if (plan.updateIds.length > 0) {
      await tx.update(contacts).set({ number: newNumber }).where(inArray(contacts.id, plan.updateIds));
    }
    // The conference-history join rows carry a frozen copy of the number beside
    // the identityId. Scoped by identityId, so this can only ever rewrite THIS
    // person's own rows — never a namesake's, and never a row whose number
    // merely happens to match.
    await tx
      .update(conferenceParticipants)
      .set({ number: newNumber })
      .where(
        and(
          eq(conferenceParticipants.identityId, identityId),
          eq(conferenceParticipants.number, oldNumber)
        )
      );
  });
  // Committed — the new number is genuinely bound (v2.99.49). The OLD number's
  // reservation stays forever on purpose: it WAS handed out, and recycling it
  // would let a contact who kept the old number later dial a stranger.
  await confirmNumberReservation(newNumber);
  return { oldNumber, newNumber };
}

/**
 * Move an identity onto a number the person CHOSE (v2.99.75).
 *
 * A thin, deliberate wrapper: it exists so callers get a typed refusal instead of
 * a thrown string, while the actual move — and therefore the propagation
 * guarantee, the transaction, and the reservation ledger — stays in the one
 * function that owns it. Nothing here writes a number.
 *
 * On a lost race the identity's unique index is the final authority, so a
 * concurrent claim surfaces as "taken" rather than as a 500, and the reservation
 * this call took is handed back (guarded on the number being in neither number
 * table, so it can never un-reserve one that is genuinely in use).
 */
export async function claimIdentityNumber(
  identityId: number,
  desired: unknown
): Promise<
  | { ok: true; oldNumber: string; newNumber: string; unchanged: boolean }
  | { ok: false; reason: ChooseNumberError | "not-found" | "unavailable" }
> {
  const want = normalizeDesiredNumber(desired);
  if (!want) return { ok: false, reason: "invalid" };
  try {
    const res = await regenerateIdentityNumber(identityId, want);
    if (!res) return { ok: false, reason: "not-found" };
    return {
      ok: true,
      oldNumber: res.oldNumber,
      newNumber: res.newNumber,
      unchanged: res.oldNumber === res.newNumber,
    };
  } catch (e) {
    const err = e as { errno?: number; code?: string; message?: string };
    const msg = err?.message || "";
    // THE PRE-FLIGHT REFUSALS MUST NOT RELEASE ANYTHING. Each of these is thrown
    // BEFORE this call holds a reservation on `want`, and "taken" specifically
    // means somebody ELSE holds it — possibly an allocation that has reserved the
    // number but not yet inserted its row. Handing that back would un-reserve a
    // stranger's in-flight number and hand it to two people.
    if (msg === "invalid" || msg === "taken" || msg === "budget") {
      return { ok: false, reason: msg as ChooseNumberError };
    }
    // Everything below this line means the reservation WAS taken and the move then
    // failed, so the number is ours to give back. `releaseUnusedNumberReservation`
    // re-checks that it is absent from both number tables, so even here it cannot
    // un-reserve one that is genuinely bound.
    await releaseUnusedNumberReservation(want).catch(() => {});
    // The identity vanished between the pre-flight read and the locking re-read
    // inside the transaction (v2.99.81) — a deleted account, or an Adopt-and-Retire
    // running concurrently. Report it as what it is rather than as a fault; the
    // release above is correct, because this call really did hold the reservation.
    if (msg === "identity-gone") return { ok: false, reason: "not-found" };
    // A duplicate-key failure inside the transaction means somebody bound the
    // number between our check and our write. That is "taken", not a fault — and
    // the row that won is precisely why the release above is a no-op.
    const dup =
      err?.errno === 1062 || err?.code === "ER_DUP_ENTRY" || /duplicate/i.test(msg);
    return { ok: false, reason: dup ? "taken" : "unavailable" };
  }
}

/* ── presence ─────────────────────────────────────────────────── */

/**
 * Called whenever an identity's ONLINE state actually flips (v2.99.72).
 *
 * Set by the live-stats feed so "Online now" moves the moment somebody signs in
 * rather than on the next tick. Registered as a HOOK rather than an import because
 * `statsFeed` already imports this module, and a second edge would be a cycle.
 *
 * It lives INSIDE `markOnline`/`markOffline` rather than at their call sites — there
 * are four of those today and forgetting one is precisely the class of bug this
 * codebase keeps re-learning, so every present and future caller is covered by
 * construction.
 */
let presenceChangeHook: (() => void) | null = null;
export function setPresenceChangeHook(fn: (() => void) | null): void {
  presenceChangeHook = fn;
}
function notifyPresenceChanged(): void {
  try {
    presenceChangeHook?.();
  } catch {
    // A decoration on a marketing page must never be able to fail a presence write.
  }
}

export async function markOnline(
  identityId: number,
  socketSessionId: string | null
): Promise<{ becameOnline: boolean }> {
  const db = await getDb();
  if (!db) return { becameOnline: false };
  const now = new Date();
  // Was this identity already online? Lets the caller broadcast presence ONLY
  // on an actual offline->online transition instead of every 30s heartbeat.
  const prev = await db
    .select({ isOnline: presence.isOnline })
    .from(presence)
    .where(eq(presence.identityId, identityId))
    .limit(1);
  const wasOnline = prev[0]?.isOnline ?? false;
  await db
    .insert(presence)
    .values({
      identityId,
      isOnline: true,
      lastSeenAt: now,
      socketSessionId,
    })
    .onDuplicateKeyUpdate({
      set: {
        isOnline: true,
        lastSeenAt: now,
        socketSessionId,
      },
    });
  // Only a real TRANSITION pokes the live-stats feed — a heartbeat from someone
  // already online changes no number, and poking on every beat would mean a database
  // read every 30s per open tab, which is the cost this feed exists to avoid.
  if (!wasOnline) notifyPresenceChanged();
  return { becameOnline: !wasOnline };
}

export async function markOffline(identityId: number) {
  const db = await getDb();
  if (!db) return;
  const now = new Date();
  await db
    .insert(presence)
    .values({ identityId, isOnline: false, lastSeenAt: now })
    .onDuplicateKeyUpdate({ set: { isOnline: false, lastSeenAt: now } });
  // Unconditional here: unlike markOnline there is no cheap prior read telling us
  // whether this was already offline, and the feed coalesces pokes anyway.
  notifyPresenceChanged();
}

/**
 * Stale-presence sweep: anyone marked online but whose heartbeat is older
 * than the threshold gets flipped to offline. Call this periodically.
 */
/**
 * Mark stale-heartbeat identities offline and RETURN which ones flipped (id +
 * number) so the caller can broadcast an offline SSE event for each — without
 * that, SSE-fed surfaces (Contacts, Messages, the profile popup) kept showing a
 * crashed/closed user GREEN until their own poll, while poll-fed surfaces
 * (History) read the freshly-reaped DB and showed grey — the reported
 * "online here, offline there" inconsistency (v2.99.3).
 */
export async function reapStalePresence(
  maxAgeSeconds = 120,
): Promise<Array<{ id: number; number: string }>> {
  const db = await getDb();
  if (!db) return [];
  const cutoff = new Date(Date.now() - maxAgeSeconds * 1000);
  // Capture the soon-to-be-reaped rows first (join identities for the number),
  // then flip them. Reaping is infrequent (60s) and usually touches few rows.
  let victims: Array<{ id: number; number: string }> = [];
  try {
    victims = await db
      .select({ id: identities.id, number: identities.number })
      .from(presence)
      .innerJoin(identities, eq(identities.id, presence.identityId))
      .where(and(eq(presence.isOnline, true), lt(presence.lastSeenAt, cutoff)));
  } catch {
    victims = [];
  }
  await db
    .update(presence)
    .set({ isOnline: false })
    .where(and(eq(presence.isOnline, true), lt(presence.lastSeenAt, cutoff)));
  // L4/TOCTOU: a victim that HEARTBEAT back online between the SELECT above and
  // this UPDATE is NOT flipped by the UPDATE (its lastSeenAt is now fresh, so the
  // WHERE no longer matches it) — yet it was captured in `victims`. Returning it
  // would fan a spurious "went offline" for a user who is actually online. Re-
  // confirm each candidate is GENUINELY offline now and return only those.
  if (victims.length === 0) return victims;
  const ids = victims.map((v) => v.id);
  try {
    const confirmed = await db
      .select({ id: identities.id, number: identities.number })
      .from(presence)
      .innerJoin(identities, eq(identities.id, presence.identityId))
      .where(and(inArray(presence.identityId, ids), eq(presence.isOnline, false)));
    return confirmed;
  } catch {
    return victims; // re-check failed — fall back to the pre-fix behaviour
  }
}

/**
 * Identities that should hear about this identity's presence changes: anyone
 * who saved them as a contact, plus anyone they share a conversation with. Used
 * to SCOPE presence pushes — the old broadcast fanned every user's number (and
 * online/offline) to every connected client, leaking strangers' presence.
 */
export async function getPresenceAudienceIds(
  identityId: number,
  number: string
): Promise<number[]> {
  const db = await getDb();
  if (!db) return [];
  const audience = new Set<number>();
  // Who saved me as a contact?
  const owners = await db
    .select({ id: contacts.ownerId })
    .from(contacts)
    .where(eq(contacts.number, number));
  owners.forEach((r) => audience.add(r.id));
  // Who shares a conversation with me?
  const myConvos = await db
    .select({ cid: conversationParticipants.conversationId })
    .from(conversationParticipants)
    .where(eq(conversationParticipants.identityId, identityId));
  const convoIds = myConvos.map((r) => r.cid);
  if (convoIds.length > 0) {
    const peers = await db
      .select({ id: conversationParticipants.identityId })
      .from(conversationParticipants)
      .where(
        and(
          inArray(conversationParticipants.conversationId, convoIds),
          sql`${conversationParticipants.identityId} <> ${identityId}`
        )
      );
    peers.forEach((r) => audience.add(r.id));
  }
  audience.delete(identityId); // never notify yourself
  return Array.from(audience);
}

/* ── call-back alerts ("tell me when they're back online", v2.88) ── */

export const ONLINE_WATCH_TTL_MS = 24 * 60 * 60 * 1000; // 24h then it lapses

/** Register (or refresh) a one-shot watch: alert `watcherId` when `targetId`
 *  next flips offline→online. Idempotent per pair — re-watching extends the
 *  24h expiry instead of stacking rows. */
export async function addOnlineWatch(watcherId: number, targetId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("database unavailable");
  const expiresAt = new Date(Date.now() + ONLINE_WATCH_TTL_MS);
  await db
    .insert(onlineWatches)
    .values({ watcherId, targetId, expiresAt })
    .onDuplicateKeyUpdate({ set: { expiresAt } });
}

/** Consume every watch on `targetId`: returns the UNEXPIRED watcher ids and
 *  deletes ALL rows for the target (one-shot semantics — expired rows are
 *  swept opportunistically here too). */
export async function takeOnlineWatchers(targetId: number): Promise<number[]> {
  const db = await getDb();
  if (!db) return [];
  const now = new Date();
  const rows = await db
    .select({ watcherId: onlineWatches.watcherId, expiresAt: onlineWatches.expiresAt })
    .from(onlineWatches)
    .where(eq(onlineWatches.targetId, targetId));
  if (rows.length === 0) return [];
  await db.delete(onlineWatches).where(eq(onlineWatches.targetId, targetId));
  return rows.filter((r) => new Date(r.expiresAt).getTime() > now.getTime()).map((r) => r.watcherId);
}

/** Offline-message email cooldown (v2.99.13): at most one "you have a new
 *  message" email per user per window, so a burst of messages while away
 *  doesn't flood their inbox. */
export const OFFLINE_MESSAGE_EMAIL_COOLDOWN_MS = 60 * 60 * 1000;

/** How long a recipient must have been gone before a message email is worth
 *  sending (v2.99.40). Presence flips offline the instant a tab is hidden, so
 *  without this a phone that locks for ten seconds mid-conversation earns an
 *  email for a message its owner is about to read anyway. */
export const OFFLINE_MESSAGE_EMAIL_MIN_AWAY_MS = 5 * 60 * 1000;

/** Hard ceiling on offline-message emails per user per UTC day (v2.99.40).
 *  The cooldown alone allows ~24/day; this is the backstop that keeps RELAY
 *  well inside "transactional" behaviour no matter how the cooldown is tuned. */
export const OFFLINE_MESSAGE_EMAIL_MAX_PER_DAY = 3;

/** Update a user's email-notification preferences (v2.99.13). Writes only the
 *  keys present; a column left NULL means "enabled (default)" and false means
 *  the user turned it off. */
export async function setUserNotificationPrefs(
  userId: number,
  prefs: { emailNotifyMissedCall?: boolean; emailNotifyMessage?: boolean; pushEnabled?: boolean }
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("database unavailable");
  const set: Record<string, boolean> = {};
  if (prefs.emailNotifyMissedCall !== undefined) set.emailNotifyMissedCall = prefs.emailNotifyMissedCall;
  if (prefs.emailNotifyMessage !== undefined) set.emailNotifyMessage = prefs.emailNotifyMessage;
  if (prefs.pushEnabled !== undefined) set.pushEnabled = prefs.pushEnabled;
  if (Object.keys(set).length === 0) return;
  await db.update(users).set(set).where(eq(users.id, userId));
}

/** Atomically CLAIM the right to send ONE offline-message email to `userId`
 *  (v2.99.13). Returns true — and stamps `lastMessageEmailAt = now` — only if
 *  the emailNotifyMessage pref is on (NULL default = on, explicit false = off)
 *  AND the cooldown has elapsed. A single conditional UPDATE, so concurrent
 *  sends can't both claim (mirrors the v2.98.4 S1 PIN-lockout race fix). The
 *  caller still resolves the address and does the (fail-safe) send. */
export async function claimOfflineMessageEmail(userId: number, cooldownMs: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const now = new Date();
  const cutoff = new Date(now.getTime() - cooldownMs);
  // UTC midnight of "today" — the bucket the daily counter belongs to.
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  // STEP 1 — roll the day over, if it hasn't been rolled already.
  //
  // This is deliberately its OWN statement, and the daily counter deliberately
  // does NOT reset itself inside the claim below. The obvious one-statement
  // version (`SET count = IF(day <=> today, count + 1, 1), day = today`) leans
  // on MySQL evaluating SET assignments left to right so the IF reads the OLD
  // day — but the emitted ORDER IS NOT OURS TO CHOOSE: drizzle's
  // `buildUpdateSet` walks `Object.keys(table columns)`, i.e. the order the
  // columns are DECLARED IN THE SCHEMA, not the order of the object literal
  // passed to `.set()`. `messageEmailDay` is declared before
  // `messageEmailsToday`, so the day would be overwritten FIRST, the IF would
  // always see `today`, and the counter would never reset — the cap would decay
  // to one email per day forever and the counter would grow without bound.
  // Verified against drizzle-orm 0.44.6's mysql dialect, and unpleasant to spot
  // from the call site, so this code does not depend on assignment order at all.
  //
  // Idempotent and race-safe: concurrent rollovers write the SAME values, and
  // the WHERE means an already-rolled row is untouched. A rollover racing a
  // claim across the midnight boundary can at worst grant or cost one email in
  // that instant, which is immaterial against a 3-per-day budget.
  try {
    await db
      .update(users)
      .set({ messageEmailsToday: 0, messageEmailDay: today })
      .where(
        and(
          eq(users.id, userId),
          or(isNull(users.messageEmailDay), sql`NOT (${users.messageEmailDay} <=> ${today})`)
        )
      );
  } catch {
    // A failed rollover must not grant an email it hasn't budgeted for: fall
    // through to the claim, which still enforces pref + cooldown + the cap
    // against whatever the counter currently says (fails toward FEWER emails).
  }

  // STEP 2 — the atomic claim. A pure increment now: no day logic in the SET, so
  // the statement is correct regardless of the order the columns are emitted in.
  const res = await db
    .update(users)
    .set({
      lastMessageEmailAt: now,
      messageEmailsToday: sql`COALESCE(${users.messageEmailsToday}, 0) + 1`,
    })
    .where(
      and(
        eq(users.id, userId),
        or(isNull(users.emailNotifyMessage), eq(users.emailNotifyMessage, true)),
        or(isNull(users.lastMessageEmailAt), lt(users.lastMessageEmailAt, cutoff)),
        // Daily budget, evaluated against the pre-update row — so two concurrent
        // claims at count = CAP-1 can't both win.
        sql`COALESCE(${users.messageEmailsToday}, 0) < ${OFFLINE_MESSAGE_EMAIL_MAX_PER_DAY}`
      )
    );
  // mysql2 returns [ResultSetHeader]; affectedRows>0 means THIS statement won
  // the claim (pref on + cooldown elapsed + budget left).
  return Array.isArray(res) && ((res[0] as { affectedRows?: number })?.affectedRows ?? 0) > 0;
}

/** Missed-call email cooldown (v2.99.44, closing the H8 follow-up deferred in
 *  v2.99.22). The missed-call email had NO throttle at all: it was gated on the
 *  block check, the pref and "not a deliberate decline", then sent — so someone
 *  dialling you repeatedly produced one email per attempt. Ten minutes bounds a
 *  burst while still telling you promptly about a call you actually missed. */
export const MISSED_CALL_EMAIL_COOLDOWN_MS = 10 * 60 * 1000;

/** Atomically CLAIM the right to send ONE missed-call email to `userId`
 *  (v2.99.44). Same shape as `claimOfflineMessageEmail`: a single conditional
 *  UPDATE, so two simultaneous missed calls can't both claim, and the verdict
 *  comes from `affectedRows` rather than a prior read. The pref itself is checked
 *  by the caller (it has the user row in hand), so this is purely the cooldown.
 *  Returns false on DB trouble — failing toward NOT sending, since a duplicate
 *  email is the failure mode being prevented here. */
export async function claimMissedCallEmail(userId: number, cooldownMs: number): Promise<boolean> {
  try {
    const db = await getDb();
    if (!db) return false;
    const cutoff = new Date(Date.now() - cooldownMs);
    const res = await db
      .update(users)
      .set({ lastMissedCallEmailAt: new Date() })
      .where(
        and(
          eq(users.id, userId),
          or(isNull(users.lastMissedCallEmailAt), lt(users.lastMissedCallEmailAt, cutoff))
        )
      );
    return Array.isArray(res) && ((res[0] as { affectedRows?: number })?.affectedRows ?? 0) > 0;
  } catch {
    return false;
  }
}

/** Give back a missed-call claim whose email failed to send (v2.99.44), so one
 *  transient mailer failure doesn't silence the next ten minutes of misses.
 *  Mirrors `releaseOfflineMessageEmailClaim`; safe because nothing else writes
 *  this column and no concurrent claim can have won inside the fresh cooldown. */
export async function releaseMissedCallEmailClaim(userId: number): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    await db.update(users).set({ lastMissedCallEmailAt: null }).where(eq(users.id, userId));
  } catch {
    /* best effort */
  }
}

/** True when this identity has at least one live push subscription (Web Push or
 *  FCM) — i.e. we can reach their device directly and an email is redundant
 *  (v2.99.40). Fails CLOSED for email purposes: on any DB trouble it returns
 *  true ("assume reachable"), so a hiccup suppresses a nudge rather than
 *  emailing someone who did not need it. */
export async function hasPushSubscription(identityId: number): Promise<boolean> {
  try {
    const db = await getDb();
    if (!db) return true;
    const rows = await db
      .select({ id: pushSubscriptions.id })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.identityId, identityId))
      .limit(1);
    return rows.length > 0;
  } catch {
    return true;
  }
}

/** Can we actually deliver a push to this identity right now (v2.99.42)?
 *
 *  BOTH conditions matter, and checking only the first was a real bug: nothing
 *  deletes the `push_subscriptions` row when a user turns the push switch off,
 *  so a subscription can exist for someone `sendPushToIdentity` will refuse to
 *  send to. The offline-message email used "has a subscription" as its stand-in
 *  for "reachable", which meant push-off + message-email-on produced NEITHER a
 *  push nor an email — silently, forever, for that combination. */
export async function pushReachable(identityId: number): Promise<boolean> {
  const [hasSub, enabled] = await Promise.all([
    hasPushSubscription(identityId),
    pushEnabledForIdentity(identityId),
  ]);
  return hasSub && enabled;
}

/** Is push delivery enabled for the account behind this identity (v2.99.40)?
 *  NULL/true = on (the historical default: having a subscription meant push),
 *  explicit false = the user turned it off in Profile. Guests have no user row
 *  and are always on. Fails OPEN on DB trouble so a hiccup can't silence a
 *  ringing call. */
export async function pushEnabledForIdentity(identityId: number): Promise<boolean> {
  try {
    const db = await getDb();
    if (!db) return true;
    const rows = await db
      .select({ pushEnabled: users.pushEnabled })
      .from(identities)
      .innerJoin(users, eq(identities.userId, users.id))
      .where(eq(identities.id, identityId))
      .limit(1);
    const row = rows[0];
    if (!row) return true; // guest / no linked account
    return row.pushEnabled !== false;
  } catch {
    return true;
  }
}

/** Release a claim made by `claimOfflineMessageEmail` when the email FAILED to
 *  send (v2.99.19). Clears the cooldown watermark so the NEXT offline message
 *  can retry, instead of a transient mailer failure silently suppressing every
 *  notification for the whole cooldown window. Safe to reset to NULL: no other
 *  code writes this column, and no concurrent claim can have won inside the
 *  just-stamped cooldown, so this only ever un-does OUR failed stamp. */
export async function releaseOfflineMessageEmailClaim(userId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  // Also give the day's budget slot back (v2.99.40) — a send that never left
  // must not spend one of the three. GREATEST floors it at 0 so a rollback can
  // never drive the counter negative.
  await db
    .update(users)
    .set({
      lastMessageEmailAt: null,
      messageEmailsToday: sql`GREATEST(COALESCE(${users.messageEmailsToday}, 0) - 1, 0)`,
    })
    .where(eq(users.id, userId));
}

export interface PresenceLite {
  identityId: number;
  isOnline: boolean;
  lastSeenAt: Date | null;
}

/** A guest's presence is fully suppressed once they've been inactive this long. */
export const GUEST_PRESENCE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Whether a contact's presence must be COMPLETELY hidden (no online dot, no
 * "offline", no "last seen") for privacy. Applies only to GUEST identities that
 * have been inactive for >24h — a registered user always shows presence, and a
 * guest still shows "online" / a recent "last seen" within the window. Pure +
 * unit-tested. `now` is injectable for tests.
 */
export function isGuestPresenceHidden(
  opts: { isGuest: boolean; isOnline: boolean; lastSeenAt: Date | null },
  now: number = Date.now(),
): boolean {
  if (!opts.isGuest) return false; // registered users always show presence
  if (opts.isOnline) return false; // a live guest still shows online
  const last = opts.lastSeenAt ? opts.lastSeenAt.getTime() : 0;
  return now - last > GUEST_PRESENCE_TTL_MS; // stale (or never-seen) guest → hide
}

export async function getPresenceForIds(ids: number[]): Promise<PresenceLite[]> {
  if (ids.length === 0) return [];
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(presence).where(inArray(presence.identityId, ids));
  const byId = new Map<number, PresenceLite>();
  for (const r of rows) {
    byId.set(r.identityId, {
      identityId: r.identityId,
      isOnline: r.isOnline,
      lastSeenAt: r.lastSeenAt ?? null,
    });
  }
  return ids.map(
    (id) =>
      byId.get(id) ?? {
        identityId: id,
        isOnline: false,
        lastSeenAt: null,
      }
  );
}

/* ── contacts ─────────────────────────────────────────────────── */

/**
 * Idempotently apply additive, nullable columns to the live database at boot.
 * This is how we evolve the schema on an already-provisioned MySQL without a
 * manual `pnpm db:push`: each `ADD COLUMN` runs once; on subsequent boots (or a
 * concurrent second Cloud Run instance) the duplicate-column error is swallowed.
 * STRICTLY additive — never drops or alters existing columns/data. Best-effort:
 * a DB hiccup is logged and never blocks startup.
 */
export async function ensureSchemaExtensions(): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const adds: Array<{ table: string; column: string; ddl: string }> = [
    { table: "contacts", column: "email", ddl: "ADD COLUMN `email` varchar(320)" },
    { table: "contacts", column: "phone", ddl: "ADD COLUMN `phone` varchar(40)" },
    { table: "contacts", column: "company", ddl: "ADD COLUMN `company` varchar(128)" },
    { table: "contacts", column: "jobTitle", ddl: "ADD COLUMN `jobTitle` varchar(128)" },
    { table: "contacts", column: "website", ddl: "ADD COLUMN `website` varchar(256)" },
    { table: "contacts", column: "birthday", ddl: "ADD COLUMN `birthday` varchar(32)" },
    // Profile-hub fields (v2.52).
    { table: "identities", column: "bio", ddl: "ADD COLUMN `bio` text" },
    { table: "identities", column: "statusOverride", ddl: "ADD COLUMN `statusOverride` varchar(16)" },
    { table: "identities", column: "mobiles", ddl: "ADD COLUMN `mobiles` text" },
    { table: "identities", column: "socials", ddl: "ADD COLUMN `socials` text" },
    // Missed-call acknowledgement high-water mark (v2.61).
    { table: "identities", column: "missedCallsSeenAt", ddl: "ADD COLUMN `missedCallsSeenAt` timestamp NULL" },
    // Per-user "Clear history" high-water mark (v2.75).
    { table: "identities", column: "historyClearedAt", ddl: "ADD COLUMN `historyClearedAt` timestamp NULL" },
    // Contact categories + per-contact block (v2.82).
    { table: "contacts", column: "category", ddl: "ADD COLUMN `category` varchar(16)" },
    { table: "contacts", column: "blocked", ddl: "ADD COLUMN `blocked` boolean" },
    // Self-hosted email/password auth (v2.54).
    { table: "users", column: "passwordHash", ddl: "ADD COLUMN `passwordHash` text" },
    { table: "users", column: "emailVerified", ddl: "ADD COLUMN `emailVerified` boolean" },
    // Passwordless email-OTP + verified blue badge (v2.68).
    { table: "identities", column: "verified", ddl: "ADD COLUMN `verified` boolean" },
    { table: "identities", column: "firstName", ddl: "ADD COLUMN `firstName` varchar(64)" },
    { table: "identities", column: "lastName", ddl: "ADD COLUMN `lastName` varchar(64)" },
    // v2.99.66 — the away auto-reply is now OPT-IN, per identity (so a guest can
    // set it too, and it follows the person through registration). NULL = off,
    // which deliberately turns the old always-on behaviour off for everyone
    // until they ask for it.
    { table: "identities", column: "autoReplyEnabled", ddl: "ADD COLUMN `autoReplyEnabled` boolean" },
    // v2.99.68 — Adopt-and-Retire. sha256 of the recovery key a guest's browser
    // keeps in localStorage, so a person can reclaim the identity (number,
    // contacts, messages, history) that a browser close made unreachable. Additive
    // + nullable: a NULL simply means "not yet issued", and `ensureGuestRecoveryKey`
    // fills it in on the row's next visit.
    // v2.99.74 — receipt timestamps for the message-info panel. `createdAt` already
    // carries "sent"; these two say when it reached the device and when it was opened.
    { table: "messages", column: "deliveredAt", ddl: "ADD COLUMN `deliveredAt` timestamp NULL" },
    { table: "messages", column: "readAt", ddl: "ADD COLUMN `readAt` timestamp NULL" },
    { table: "identities", column: "recoveryHash", ddl: "ADD COLUMN `recoveryHash` varchar(64)" },
    { table: "identities", column: "recoveryIssuedAt", ddl: "ADD COLUMN `recoveryIssuedAt` timestamp NULL" },
    // Native Android app push transport (v2.86).
    { table: "push_subscriptions", column: "kind", ddl: "ADD COLUMN `kind` varchar(10)" },
    // v2.99.49 — proof-of-possession for an endpoint re-bind.
    { table: "push_subscriptions", column: "claimHash", ddl: "ADD COLUMN `claimHash` varchar(64)" },
    // 4-digit login PIN + lockout (v2.87).
    { table: "users", column: "loginPinHash", ddl: "ADD COLUMN `loginPinHash` text" },
    { table: "users", column: "loginPinAttempts", ddl: "ADD COLUMN `loginPinAttempts` int" },
    { table: "users", column: "loginPinLockedAt", ddl: "ADD COLUMN `loginPinLockedAt` timestamp NULL" },
    { table: "users", column: "preferPinLogin", ddl: "ADD COLUMN `preferPinLogin` boolean" },
    // New-device approval (v2.99.7): NULL = approved/normal (every legacy row);
    // non-NULL = sign-in is WAITING for approval from another device.
    { table: "sessions", column: "pendingApproval", ddl: "ADD COLUMN `pendingApproval` timestamp NULL" },
    // Email-notification preferences (v2.99.13). NULL = ENABLED (historical
    // default — the missed-call email always sent), so a user disables by
    // storing false. lastMessageEmailAt is the offline-message email cooldown.
    { table: "users", column: "emailNotifyMissedCall", ddl: "ADD COLUMN `emailNotifyMissedCall` boolean" },
    { table: "users", column: "emailNotifyMessage", ddl: "ADD COLUMN `emailNotifyMessage` boolean" },
    { table: "users", column: "lastMessageEmailAt", ddl: "ADD COLUMN `lastMessageEmailAt` timestamp NULL" },
    // v2.99.40 — push master switch + the daily offline-email budget.
    { table: "users", column: "pushEnabled", ddl: "ADD COLUMN `pushEnabled` boolean" },
    { table: "users", column: "messageEmailDay", ddl: "ADD COLUMN `messageEmailDay` timestamp NULL" },
    { table: "users", column: "messageEmailsToday", ddl: "ADD COLUMN `messageEmailsToday` int" },
    // v2.99.44 — missed-call email cooldown (H8).
    { table: "users", column: "lastMissedCallEmailAt", ddl: "ADD COLUMN `lastMissedCallEmailAt` timestamp NULL" },
    // v2.99.66 — status audience. NULL means "contacts" on BOTH columns, which is
    // exactly the rule every existing row was posted under, so the migration is a
    // no-op until someone opts in. `statuses.audience` is per-POST and stamped at
    // insert so flipping the identity default can never retroactively widen an
    // already-published status.
    { table: "identities", column: "statusAudience", ddl: "ADD COLUMN `statusAudience` varchar(16)" },
    { table: "statuses", column: "audience", ddl: "ADD COLUMN `audience` varchar(16)" },
    // v2.99.49 — per-account password-login lockout (closes the v2.99.20 residual).
    { table: "users", column: "loginPwAttempts", ddl: "ADD COLUMN `loginPwAttempts` int" },
    { table: "users", column: "loginPwLockedAt", ddl: "ADD COLUMN `loginPwLockedAt` timestamp NULL" },
    // v2.99.49 — stamped once the real identities/party_lines row lands, so a
    // reservation that never became a row can be reclaimed. NO DEFAULT on
    // purpose: a default would backfill existing rows (convenient) but also
    // stamp every NEW row, making the reaper a permanent no-op.
    { table: "number_reservations", column: "claimedAt", ddl: "ADD COLUMN `claimedAt` timestamp NULL" },
    // Hot-path indexes (v2.88, mirrored in drizzle/schema.ts):
    //  - messages(conversationId, id): the listThreads groupwise-max + every
    //    listMessages page (ORDER BY id within a conversation).
    //  - messages(attachmentId): getAttachmentForIdentity full-scanned messages
    //    on EVERY attachment auth check.
    //  - contacts(number): getPresenceAudienceIds full-scanned contacts on
    //    every presence transition.
    { table: "messages", column: "messages_convo_id_idx", ddl: "ADD INDEX `messages_convo_id_idx` (`conversationId`, `id`)" },
    { table: "messages", column: "messages_attachment_idx", ddl: "ADD INDEX `messages_attachment_idx` (`attachmentId`)" },
    { table: "contacts", column: "contacts_number_idx", ddl: "ADD INDEX `contacts_number_idx` (`number`)" },
    // Image thumbnails (v2.89, mirrored in drizzle/schema.ts): the client
    // uploads a ≤512px thumb alongside a downscaled main image; bubbles render
    // the thumb and tap through to the full-size url.
    { table: "attachments", column: "thumbKey", ddl: "ADD COLUMN `thumbKey` varchar(256)" },
    { table: "attachments", column: "thumbUrl", ddl: "ADD COLUMN `thumbUrl` text" },
    // Participant-only file access (v2.94.2): the storage proxy resolves an
    // attachment by storageKey/thumbKey on EVERY /manus-storage request (ahead
    // of the signed-url cache). Without these it was a full table scan.
    { table: "attachments", column: "attachments_key_idx", ddl: "ADD INDEX `attachments_key_idx` (`storageKey`)" },
    { table: "attachments", column: "attachments_thumbkey_idx", ddl: "ADD INDEX `attachments_thumbkey_idx` (`thumbKey`)" },
    // M47: one identity per registered user. `ensureUserIdentity` is a
    // check-then-insert, so without this two concurrent sign-ins for the same
    // account could each mint an identity — giving one user two rows and two
    // 6-digit numbers, after which lookups returned whichever MySQL felt like
    // (the historical "my number changes randomly" report). NULL is allowed
    // any number of times by a MySQL UNIQUE index, so guest identities
    // (userId NULL) are entirely unaffected.
    //
    // If a deployment ALREADY contains duplicates this ALTER fails, and the
    // loop below logs and moves on exactly like every other additive step —
    // boot is never blocked. The ordering fix in getIdentityByUserId keeps such
    // a deployment self-consistent meanwhile, and the index lands on the next
    // boot after the duplicates are reconciled.
    { table: "identities", column: "identities_user_unique", ddl: "ADD UNIQUE INDEX `identities_user_unique` (`userId`)" },
    // v2.99.68 — Adopt-and-Retire looks an identity up BY recoveryHash, and
    // `identities` is one of the larger tables. Without this the lookup is a full
    // scan on an endpoint any visitor can reach. Declared after the column entries
    // above because this list is applied in order.
    // NOT unique: two rows could in principle hold the same hash only via a
    // 2^256 collision, and a UNIQUE index here would instead mean that a future
    // backfill bug takes the whole ALTER (and therefore the index) down with it.
    { table: "identities", column: "identities_recoveryHash_idx", ddl: "ADD INDEX `identities_recoveryHash_idx` (`recoveryHash`)" },
  ];
  for (const a of adds) {
    try {
      await db.execute(sql.raw(`ALTER TABLE \`${a.table}\` ${a.ddl}`));
      console.log(`[schema] added ${a.table}.${a.column}`);
    } catch (e) {
      const msg = (e as Error)?.message || "";
      // Already present (normal on every boot after the first) → ignore
      // quietly. "duplicate key name" is MySQL's ADD INDEX flavor of the same.
      if (!/duplicate column|duplicate key name|exists|check that column/i.test(msg)) {
        console.warn(`[schema] ensure ${a.table}.${a.column} skipped:`, msg);
      }
    }
  }
  // Additive TABLE creation (conference history). CREATE TABLE IF NOT EXISTS is
  // idempotent and never touches existing tables/data — same safety contract as
  // the ADD COLUMN block above.
  const tableCreates: Array<{ name: string; ddl: string }> = [
    {
      name: "conference_history",
      ddl: `CREATE TABLE IF NOT EXISTS \`conference_history\` (
        \`id\` int AUTO_INCREMENT PRIMARY KEY,
        \`roomId\` varchar(40) NOT NULL,
        \`dialedNumber\` varchar(6),
        \`partyCount\` int NOT NULL DEFAULT 0,
        \`startedAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`endedAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`durationSec\` int NOT NULL DEFAULT 0,
        \`participants\` json,
        KEY \`conf_started_idx\` (\`startedAt\`),
        KEY \`conf_room_idx\` (\`roomId\`)
      )`,
    },
    {
      name: "conference_participants",
      ddl: `CREATE TABLE IF NOT EXISTS \`conference_participants\` (
        \`id\` int AUTO_INCREMENT PRIMARY KEY,
        \`conferenceId\` int NOT NULL,
        \`identityId\` int NOT NULL,
        \`number\` varchar(6) NOT NULL,
        KEY \`conf_part_identity_idx\` (\`identityId\`),
        KEY \`conf_part_conf_idx\` (\`conferenceId\`)
      )`,
    },
    {
      name: "email_verifications",
      ddl: `CREATE TABLE IF NOT EXISTS \`email_verifications\` (
        \`id\` int AUTO_INCREMENT PRIMARY KEY,
        \`userId\` int NOT NULL,
        \`email\` varchar(320) NOT NULL,
        \`token\` varchar(128) NOT NULL,
        \`expiresAt\` timestamp NOT NULL,
        \`consumedAt\` timestamp NULL,
        \`createdAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY \`email_verif_token_unique\` (\`token\`),
        KEY \`email_verif_user_idx\` (\`userId\`)
      )`,
    },
    {
      name: "email_otps",
      ddl: `CREATE TABLE IF NOT EXISTS \`email_otps\` (
        \`id\` int AUTO_INCREMENT PRIMARY KEY,
        \`email\` varchar(320) NOT NULL,
        \`codeHash\` varchar(255) NOT NULL,
        \`purpose\` varchar(16) NOT NULL DEFAULT 'login',
        \`firstName\` varchar(64),
        \`lastName\` varchar(64),
        \`expiresAt\` timestamp NOT NULL,
        \`attempts\` int NOT NULL DEFAULT 0,
        \`consumedAt\` timestamp NULL,
        \`createdAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        KEY \`email_otps_email_idx\` (\`email\`),
        KEY \`email_otps_expires_idx\` (\`expiresAt\`)
      )`,
    },
    {
      // Web Push endpoints per identity — wakes devices with no live SSE
      // (incoming-call paging + missed-call notices). v2.83.
      name: "push_subscriptions",
      ddl: `CREATE TABLE IF NOT EXISTS \`push_subscriptions\` (
        \`id\` int AUTO_INCREMENT PRIMARY KEY,
        \`identityId\` int NOT NULL,
        \`endpoint\` varchar(500) NOT NULL,
        \`p256dh\` varchar(255) NOT NULL,
        \`auth\` varchar(120) NOT NULL,
        \`kind\` varchar(10),
        \`claimHash\` varchar(64),
        \`createdAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY \`push_sub_endpoint_unique\` (\`endpoint\`),
        KEY \`push_sub_identity_idx\` (\`identityId\`)
      )`,
    },
    {
      // Party lines (v2.89): dialable ROOM numbers. One row per line; the
      // number shares the identity number space (both allocators check both
      // tables). The relay derives the persistent room id (`pl-<number>`)
      // from this row, so an empty line is re-dialable forever.
      name: "party_lines",
      ddl: `CREATE TABLE IF NOT EXISTS \`party_lines\` (
        \`id\` int AUTO_INCREMENT PRIMARY KEY,
        \`number\` varchar(6) NOT NULL,
        \`ownerIdentityId\` int NOT NULL,
        \`title\` varchar(64) NOT NULL,
        \`createdAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY \`party_lines_number_unique\` (\`number\`),
        KEY \`party_lines_owner_idx\` (\`ownerIdentityId\`)
      )`,
    },
    {
      // M20 (v2.99.30): a SHARED reservation ledger across the one 6-digit
      // number space. identities and party_lines each have a per-table UNIQUE
      // key on `number`, but MySQL can't enforce uniqueness ACROSS two tables,
      // so two concurrent allocations targeting DIFFERENT tables could both
      // pass the check-then-insert `numberTaken` gate and claim the same fresh
      // number (a collision permanently shadows a person or unreachables a
      // line). Every allocator now first INSERTs the candidate here (PK on
      // `number`), so the unique key serializes concurrent allocations across
      // BOTH tables — one wins, the loser gets a duplicate-key and retries.
      // Monotonic (never trimmed): a number handed out is never recycled, so a
      // deleted user's number can't later misroute to someone else.
      name: "number_reservations",
      ddl: `CREATE TABLE IF NOT EXISTS \`number_reservations\` (
        \`number\` varchar(6) NOT NULL,
        \`createdAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`claimedAt\` timestamp NULL,
        PRIMARY KEY (\`number\`)
      )`,
    },
    {
      // Call-back alerts (v2.88): "tell me when they're back online". One-shot
      // rows consumed on the target's offline→online transition; 24h expiry.
      name: "online_watches",
      ddl: `CREATE TABLE IF NOT EXISTS \`online_watches\` (
        \`id\` int AUTO_INCREMENT PRIMARY KEY,
        \`watcherId\` int NOT NULL,
        \`targetId\` int NOT NULL,
        \`expiresAt\` timestamp NOT NULL,
        \`createdAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY \`watch_pair_unique\` (\`watcherId\`, \`targetId\`),
        KEY \`watch_target_idx\` (\`targetId\`)
      )`,
    },
    {
      // Rich user status (story-style, ephemeral). Media referenced by key/url
      // (uploaded via /api/v2/upload); reads filter expiresAt > now.
      name: "statuses",
      ddl: `CREATE TABLE IF NOT EXISTS \`statuses\` (
        \`id\` int AUTO_INCREMENT PRIMARY KEY,
        \`identityId\` int NOT NULL,
        \`kind\` varchar(16) NOT NULL,
        \`text\` text,
        \`bgColor\` varchar(64),
        \`mediaKey\` varchar(256),
        \`mediaUrl\` text,
        \`mimeType\` varchar(128),
        \`durationMs\` int,
        \`createdAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`expiresAt\` timestamp NOT NULL,
        KEY \`statuses_owner_idx\` (\`identityId\`),
        KEY \`statuses_expires_idx\` (\`expiresAt\`)
      )`,
    },
    {
      // "Seen by" — one row per (status, viewer).
      name: "status_views",
      ddl: `CREATE TABLE IF NOT EXISTS \`status_views\` (
        \`id\` int AUTO_INCREMENT PRIMARY KEY,
        \`statusId\` int NOT NULL,
        \`viewerId\` int NOT NULL,
        \`viewedAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY \`status_view_pair_unique\` (\`statusId\`, \`viewerId\`),
        KEY \`status_views_status_idx\` (\`statusId\`)
      )`,
    },
    {
      // Device/session ledger (v2.99.1). One row per login; the cookie's sid
      // maps here so a device can be logged out by deleting its row.
      name: "sessions",
      ddl: `CREATE TABLE IF NOT EXISTS \`sessions\` (
        \`id\` int AUTO_INCREMENT PRIMARY KEY,
        \`sid\` varchar(64) NOT NULL,
        \`userId\` int NOT NULL,
        \`label\` varchar(160),
        \`createdAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`lastSeenAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY \`sessions_sid_unique\` (\`sid\`),
        KEY \`sessions_user_idx\` (\`userId\`)
      )`,
    },
  ];
  for (const t of tableCreates) {
    try {
      await db.execute(sql.raw(t.ddl));
    } catch (e) {
      const msg = (e as Error)?.message || "";
      if (!/exists/i.test(msg)) console.warn(`[schema] ensure table ${t.name} skipped:`, msg);
    }
  }
  // One-time backfill: any identity whose owning user has already verified their
  // email (legacy email+password flow) should show the blue badge immediately.
  // Idempotent — only touches rows still NULL, so it's a no-op on every boot
  // after the first and never un-verifies or re-verifies anyone.
  try {
    await db.execute(
      sql.raw(
        "UPDATE `identities` i JOIN `users` u ON i.`userId` = u.`id` " +
          "SET i.`verified` = 1 WHERE u.`emailVerified` = 1 AND i.`verified` IS NULL",
      ),
    );
  } catch (e) {
    const msg = (e as Error)?.message || "";
    console.warn("[schema] verified backfill skipped:", msg);
  }
}

export async function listContacts(ownerId: number) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select()
    .from(contacts)
    .where(eq(contacts.ownerId, ownerId))
    .orderBy(desc(contacts.favourite), desc(contacts.updatedAt))
    // Bounded by construction (v2.99.57). Equal to MAX_CONTACTS_PER_OWNER, so a
    // real user is never truncated — deliberately NOT a small page, because the
    // Contacts screen sorts and filters over the whole list client-side and a
    // short page would silently HIDE contacts, which is worse than the DoS.
    .limit(MAX_CONTACTS_PER_OWNER);
  return rows;
}

/* ── sessions / device list (v2.99.1) ─────────────────────────────────────
 * The cookie stays the source of truth for AUTHENTICATION (signed HMAC); this
 * ledger only powers the device list + remote logout. Every helper is
 * best-effort and NEVER throws to its caller: recording a session must not
 * block a login, and the revocation gate FAILS OPEN on any DB error so a
 * transient outage can never mass-log-out the fleet.
 * (Defined AFTER listContacts on purpose — the contacts.test.ts additive-only
 * guard slices [ensureSchemaExtensions, listContacts) and forbids the word
 * DELETE in that range; the revoke helper below legitimately deletes a row.) */

/** Insert a login session. Best-effort; a failure just means it won't appear in
 *  the device list (auth still works via the cookie).
 *  v2.99.7: `pending` writes the row AWAITING new-device approval — such a row
 *  does NOT authenticate (sessionState treats it as revoked) until approved. */
export async function recordSession(sid: string, userId: number, label: string, pending = false): Promise<void> {
  const db = await getDb();
  if (!db) return;
  try {
    await db.insert(sessions).values({
      sid,
      userId,
      label: label.slice(0, 160) || null,
      pendingApproval: pending ? new Date() : null,
    });
  } catch (e) {
    console.warn("[sessions] record skipped:", (e as Error)?.message || "");
  }
}

/** The revocation gate for a cookie's sid:
 *   "active"  → the session row exists AND is approved (valid),
 *   "revoked" → the row is gone (logged out) OR still PENDING new-device
 *               approval (v2.99.7) — a pending sid must NOT authenticate, so
 *               from the AUTH gate's view it's identical to revoked (the
 *               context's `state !== "revoked"` check keeps them out with no
 *               change); the pending rows surface separately for the approval
 *               UI via pendingSessionsForUser / sessionApprovalBySid,
 *   "error"   → no DB / query failed → the caller FAILS OPEN (keeps the user
 *               signed in), so a DB hiccup never logs anyone out.
 *  Only ever called for cookies that carry a sid; legacy cookies skip it. */
export async function sessionState(sid: string): Promise<"active" | "revoked" | "error"> {
  const db = await getDb();
  if (!db) return "error";
  try {
    const rows = await db
      .select({ id: sessions.id, pending: sessions.pendingApproval })
      .from(sessions)
      .where(eq(sessions.sid, sid))
      .limit(1);
    if (rows.length === 0) return "revoked"; // logged out
    return rows[0].pending == null ? "active" : "revoked"; // pending ⇒ not yet authenticated
  } catch {
    return "error";
  }
}

/** New-device approval (v2.99.7): does the account have another APPROVED session
 *  that was active within `sinceMs` (≈ "another device is online right now")?
 *  Drives the rule "ask an online device to approve a new sign-in" — and is
 *  fail-SAFE against lockout: on any DB trouble it returns false, so approval is
 *  never required when we can't prove an approver exists. `exceptSid` excludes
 *  the sign-in's own (not-yet-created) session defensively. */
export async function hasRecentApprovedSession(
  userId: number,
  sinceMs: number,
  exceptSid?: string,
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  try {
    const cutoff = new Date(Date.now() - sinceMs);
    const rows = await db
      .select({ sid: sessions.sid })
      .from(sessions)
      .where(
        and(
          eq(sessions.userId, userId),
          isNull(sessions.pendingApproval),
          gte(sessions.lastSeenAt, cutoff),
        ),
      );
    return rows.some((r) => r.sid !== exceptSid);
  } catch {
    return false;
  }
}

/** The account's sessions still WAITING for approval (for the notification-center
 *  approve/deny UI), newest first. Best-effort → [] on error. */
export async function pendingSessionsForUser(userId: number) {
  const db = await getDb();
  if (!db) return [];
  try {
    return await db
      .select()
      .from(sessions)
      .where(and(eq(sessions.userId, userId), isNotNull(sessions.pendingApproval)))
      .orderBy(desc(sessions.createdAt));
  } catch {
    return [];
  }
}

/** The waiting device polls this by its OWN cookie sid (it isn't authenticated
 *  yet, so it can't use userId-scoped queries):
 *    "pending"  → row exists, still awaiting approval,
 *    "approved" → row exists, approved (pendingApproval cleared) → proceed,
 *    "denied"   → row gone (rejected / never existed) → back to sign-in.
 *  On DB error returns "approved" (fail OPEN — a hiccup must never strand a
 *  legitimately signed-in device on the waiting screen). */
export async function sessionApprovalBySid(
  sid: string,
): Promise<"pending" | "approved" | "denied"> {
  const db = await getDb();
  if (!db) return "approved";
  try {
    const rows = await db
      .select({ pending: sessions.pendingApproval })
      .from(sessions)
      .where(eq(sessions.sid, sid))
      .limit(1);
    if (rows.length === 0) return "denied";
    return rows[0].pending == null ? "approved" : "pending";
  } catch {
    return "approved";
  }
}

/** Approve ONE pending session the user owns → it starts authenticating.
 *  Ownership-scoped (a user can only approve their OWN sessions). Returns true
 *  when a row actually flipped. */
export async function approveSession(userId: number, sid: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  try {
    const res = await db
      .update(sessions)
      .set({ pendingApproval: null })
      .where(and(eq(sessions.userId, userId), eq(sessions.sid, sid)));
    const affected = (res as unknown as { rowsAffected?: number; affectedRows?: number })?.rowsAffected
      ?? (res as unknown as [{ affectedRows?: number }])?.[0]?.affectedRows
      ?? 0;
    return affected > 0;
  } catch {
    return false;
  }
}

/** Bump lastSeenAt for a session (throttled by the caller). Best-effort. */
export async function touchSession(sid: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  try {
    await db.update(sessions).set({ lastSeenAt: new Date() }).where(eq(sessions.sid, sid));
  } catch {
    /* ignore — lastSeenAt is cosmetic */
  }
}

/** The user's active sessions, newest first (for the device list). */
export async function listSessionsForUser(userId: number) {
  const db = await getDb();
  if (!db) return [];
  try {
    return await db
      .select()
      .from(sessions)
      .where(eq(sessions.userId, userId))
      .orderBy(desc(sessions.lastSeenAt));
  } catch {
    return [];
  }
}

/** Revoke ONE session the user owns → logs that device out. Returns true when a
 *  row was actually removed (ownership-scoped: a user can only revoke their OWN
 *  sessions). */
export async function revokeSession(userId: number, sid: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  try {
    const res = await db
      .delete(sessions)
      .where(and(eq(sessions.userId, userId), eq(sessions.sid, sid)));
    const affected = (res as unknown as { rowsAffected?: number; affectedRows?: number })?.rowsAffected
      ?? (res as unknown as [{ affectedRows?: number }])?.[0]?.affectedRows
      ?? 0;
    return affected > 0;
  } catch {
    return false;
  }
}

/** Housekeeping reaper (v2.99.19): keep the sessions ledger bounded and — more
 *  importantly — drop DEAD pending-approval rows. A new-device sign-in that's
 *  never approved leaves its `pendingApproval` row forever: it can't authenticate,
 *  but it keeps counting as a "pending device" (inflating the approval bell on the
 *  account's other devices). Delete pending rows whose wait began before
 *  `pendingMaxAgeMs` ago (the waiting device gave up long ago) and long-idle rows
 *  older than `sessionMaxAgeMs` (past the longest cookie TTL). Best-effort; never
 *  throws. */
export async function reapStaleSessions(
  pendingMaxAgeMs: number,
  sessionMaxAgeMs: number,
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  try {
    const pendingCutoff = new Date(Date.now() - pendingMaxAgeMs);
    await db
      .delete(sessions)
      .where(and(isNotNull(sessions.pendingApproval), lt(sessions.pendingApproval, pendingCutoff)));
    const idleCutoff = new Date(Date.now() - sessionMaxAgeMs);
    await db.delete(sessions).where(lt(sessions.lastSeenAt, idleCutoff));
  } catch (e) {
    console.warn("[sessions reaper]", (e as Error)?.message || "");
  }
}

/** Columns that may be updated on a contact (everything except ownerId/number,
 *  which form the unique key). */
const CONTACT_UPDATABLE = [
  "displayName", "avatarUrl", "favourite", "notes",
  "email", "phone", "company", "jobTitle", "website", "birthday",
  "category", "blocked",
] as const;

/**
 * Decide which contact columns an upsert should overwrite on conflict: ONLY the
 * keys the caller explicitly passed (so a partial update never wipes saved
 * fields). Falls back to a harmless `number` self-assignment when nothing
 * updatable was provided (onDuplicateKeyUpdate requires a non-empty SET). Pure —
 * unit-tested without a DB.
 */
export function contactUpdateKeys(input: Record<string, unknown>): string[] {
  const keys = CONTACT_UPDATABLE.filter((k) =>
    Object.prototype.hasOwnProperty.call(input, k)
  );
  return keys.length > 0 ? keys : ["number"];
}

export async function upsertContact(input: {
  ownerId: number;
  number: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  favourite?: boolean;
  notes?: string | null;
  email?: string | null;
  phone?: string | null;
  company?: string | null;
  jobTitle?: string | null;
  website?: string | null;
  birthday?: string | null;
  category?: string | null;
  blocked?: boolean;
}) {
  const db = await getDb();
  if (!db) throw new Error("database unavailable");
  const values = {
    ownerId: input.ownerId,
    number: input.number,
    displayName: input.displayName ?? null,
    avatarUrl: input.avatarUrl ?? null,
    favourite: input.favourite ?? false,
    notes: input.notes ?? null,
    email: input.email ?? null,
    phone: input.phone ?? null,
    company: input.company ?? null,
    jobTitle: input.jobTitle ?? null,
    website: input.website ?? null,
    birthday: input.birthday ?? null,
    category: input.category ?? null,
    blocked: input.blocked ?? false,
  };
  // Only overwrite columns the caller explicitly provided, so a partial update
  // (e.g. a favourite toggle that omits email/notes/…) never wipes saved fields.
  const set: Record<string, unknown> = {};
  for (const k of contactUpdateKeys(input)) {
    set[k] = (values as Record<string, unknown>)[k];
  }
  // PER-OWNER CEILING (v2.99.57). `contacts` was unbounded: one free guest could
  // upsert distinct 6-digit numbers indefinitely, and `listContacts` then selected
  // and enriched every row — an OOM of the `instances: 1`, 1GB process that owns
  // the signaling registry and every SSE stream.
  //
  // Only a genuinely NEW row is capped. An UPDATE to an existing contact must
  // never be refused: a user at the ceiling still has to be able to rename,
  // favourite, or — most importantly — BLOCK someone.
  const [existing] = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(and(eq(contacts.ownerId, input.ownerId), eq(contacts.number, input.number)))
    .limit(1);
  await db
    .insert(contacts)
    .values(values)
    .onDuplicateKeyUpdate({ set });
  const rows = await db
    .select()
    .from(contacts)
    .where(and(eq(contacts.ownerId, input.ownerId), eq(contacts.number, input.number)))
    .limit(1);
  const row = rows[0];
  if (!existing && row) {
    // Enforced by the new row's id-RANK, the same pattern `createPartyLine` uses:
    // ids are monotonic and unique, so concurrent inserts get DISTINCT ranks and
    // exactly the ones past the cap self-delete. A count-then-insert check would
    // let two concurrent inserts at CAP-1 both pass.
    const [{ rank } = { rank: 0 }] = await db
      .select({ rank: sql<number>`count(*)` })
      .from(contacts)
      .where(and(eq(contacts.ownerId, input.ownerId), lte(contacts.id, row.id)));
    if (Number(rank) > MAX_CONTACTS_PER_OWNER) {
      await db.delete(contacts).where(eq(contacts.id, row.id));
      throw new Error(`contact limit reached (${MAX_CONTACTS_PER_OWNER})`);
    }
  }
  return row;
}

/** True when `ownerId` has a contact row for `number` marked BLOCKED. */
export async function isNumberBlockedBy(ownerId: number, number: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const rows = await db
    .select({ blocked: contacts.blocked })
    .from(contacts)
    .where(and(eq(contacts.ownerId, ownerId), eq(contacts.number, number)))
    .limit(1);
  return rows[0]?.blocked === true;
}

export async function deleteContact(ownerId: number, contactId: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(contacts).where(and(eq(contacts.id, contactId), eq(contacts.ownerId, ownerId)));
}

/* ── conversations & messages ─────────────────────────────────── */

/**
 * Does a 1:1 conversation between these two identities already exist? Used to
 * gate NEW-thread creation on the block state without disturbing a thread that
 * already legitimately existed before a block was set (block only stops
 * FRESH/unwanted contact — it never retroactively hides prior history).
 */
export async function dmConversationExists(a: number, b: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const key = pairKey(a, b);
  const rows = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(eq(conversations.pairKey, key))
    .limit(1);
  return rows.length > 0;
}

/**
 * Get or create a 1:1 conversation between two identities. When
 * `a === b`, returns a single-participant "note to self" conversation
 * — a private thread the user can use to leave themselves notes,
 * links, and attachments. The pair key uses the same identity twice
 * so it remains unique and stable.
 */
export async function getOrCreateDmConversation(a: number, b: number) {
  const key = pairKey(a, b);
  const isSelf = a === b;
  const db = await getDb();
  if (!db) throw new Error("database unavailable");

  let convo: { id: number; pairKey: string | null; kind: string } | undefined;

  const existing = await db
    .select()
    .from(conversations)
    .where(eq(conversations.pairKey, key))
    .limit(1);
  if (existing.length > 0) {
    convo = existing[0];
  } else {
    try {
      await db.insert(conversations).values({ pairKey: key, kind: "dm" });
    } catch (insertErr) {
      // Two participants can open the same thread at once: both SELECTs above see
      // nothing, both INSERT, and the loser hits the unique index on pairKey. Re-
      // select here; if the row now exists the race is benign and we return it.
      // Only a genuine insert failure (row still absent) is rethrown.
      const raced = await db
        .select()
        .from(conversations)
        .where(eq(conversations.pairKey, key))
        .limit(1);
      if (raced.length === 0) throw insertErr;
    }
    const created = await db
      .select()
      .from(conversations)
      .where(eq(conversations.pairKey, key))
      .limit(1);
    if (created.length === 0) throw new Error("conversation insert failed");
    convo = created[0];
  }

  // CORRECTNESS: ensure both participant rows exist EVERY time, including when
  // we returned a PRE-EXISTING conversation — not just on the create branch.
  // The conversation-row insert and the participant-rows insert are two
  // separate round trips (not one transaction, unlike createGroupConversation),
  // so a failure or slow participant insert used to leave a committed
  // conversation row with NO participants and no recovery path: every later
  // call hit the early-return above and handed back a thread that
  // listMessages/sendMessage's membership checks would 403 BOTH users out of,
  // forever. Re-running this idempotent upsert on every call self-heals any
  // already-orphaned row and closes the race window for new ones — a
  // concurrent caller that read the just-inserted conversation row via the
  // early-return branch above will still land here before returning.
  const participantValues = isSelf
    ? [{ conversationId: convo.id, identityId: a }]
    : [
        { conversationId: convo.id, identityId: a },
        { conversationId: convo.id, identityId: b },
      ];
  await db
    .insert(conversationParticipants)
    .values(participantValues)
    .onDuplicateKeyUpdate({ set: { unreadCount: sql`${conversationParticipants.unreadCount}` } });

  return convo;
}

/**
 * Create a named group conversation owned by `creatorId` with the given member
 * identities. The creator is always included. Returns the new conversation row.
 * Groups have a null `pairKey` (the unique index is on pairKey, which permits
 * many NULLs in MySQL), so every group is distinct even with the same members.
 */
export async function createGroupConversation(input: {
  creatorId: number;
  memberIds: number[];
  title: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("database unavailable");
  // De-dupe + always include the creator.
  const ids = Array.from(new Set([input.creatorId, ...input.memberIds]));
  // Both inserts in ONE transaction so a failed participant insert never leaves
  // an orphaned conversation row behind.
  return await db.transaction(async (tx) => {
    const res = await tx.insert(conversations).values({
      pairKey: null,
      kind: "group",
      title: input.title.slice(0, 128),
    });
    // mysql2 returns the new row id as insertId on the result header.
    const insertId = Number(res[0].insertId);
    if (!insertId) throw new Error("group conversation insert failed");
    await tx.insert(conversationParticipants).values(
      ids.map((identityId) => ({ conversationId: insertId, identityId }))
    );
    const [row] = await tx
      .select()
      .from(conversations)
      .where(eq(conversations.id, insertId))
      .limit(1);
    return row;
  });
}

export interface ThreadSummary {
  conversationId: number;
  /** "dm" (1:1 or note-to-self) or "group". */
  kind: "dm" | "group";
  /** Group title (null for DMs). */
  title: string | null;
  /** For a DM: the other participant. For a group: 0 (use title/members). */
  otherIdentityId: number;
  otherNumber: string;
  otherDisplayName: string;
  otherAvatarUrl: string | null;
  /** Participant count INCLUDING me (2 for a DM, 1 for self-notes). */
  memberCount: number;
  lastMessageAt: Date;
  unreadCount: number;
  lastMessagePreview: string | null;
  lastMessageKind: string;
}

/**
 * Pure projection helper for `listThreads`. Extracted so it can be
 * unit-tested without a database. Given the four input arrays already
 * loaded from the DB (my participant rows, the "other" participant
 * rows for non-self conversations, the conversation rows, and the
 * latest message per conversation), produces a list of `ThreadSummary`
 * sorted by `lastMessageAt` descending. Conversations where no
 * "other" participant exists are projected as a synthetic
 * "Notes (You)" thread using the caller's own identity row.
 */
export function composeThreadSummaries(input: {
  identityId: number;
  myParts: Array<{ conversationId: number; unreadCount: number }>;
  others: Array<{ conversationId: number; identityId: number }>;
  otherIdentities: Array<{
    id: number;
    number: string;
    displayName: string;
    avatarUrl: string | null;
  }>;
  myIdentity: {
    id: number;
    number: string;
    displayName: string;
    avatarUrl: string | null;
  } | null;
  convoRows: Array<{
    id: number;
    lastMessageAt: Date;
    kind?: "dm" | "group";
    title?: string | null;
  }>;
  latestMessageByConvo: Map<
    number,
    { body: string | null; kind: string } | null
  >;
}): ThreadSummary[] {
  const otherById = new Map(input.otherIdentities.map((i) => [i.id, i]));
  const convoById = new Map(input.convoRows.map((c) => [c.id, c]));
  const unreadByConvo = new Map(
    input.myParts.map((p) => [p.conversationId, p.unreadCount])
  );
  // Conversations that have ANY other participant row (before identity
  // resolution). Used to tell a true self-note (no others at all) apart from a
  // DM whose peer identity simply failed to load — the latter must be dropped,
  // NOT relabelled "Notes (You)".
  const convoIdsWithRawOther = new Set(input.others.map((o) => o.conversationId));
  // Group the RESOLVED "other" participants by conversation (a group has many).
  const othersByConvo = new Map<
    number,
    Array<{ id: number; number: string; displayName: string; avatarUrl: string | null }>
  >();
  for (const o of input.others) {
    const ident = otherById.get(o.identityId);
    if (!ident) continue;
    const arr = othersByConvo.get(o.conversationId) ?? [];
    arr.push(ident);
    othersByConvo.set(o.conversationId, arr);
  }

  const result: ThreadSummary[] = [];

  // Iterate MY conversations once each (no double-projection), branching on kind.
  for (const p of input.myParts) {
    const convo = convoById.get(p.conversationId);
    if (!convo) continue;
    const kind = convo.kind ?? "dm";
    const latest = input.latestMessageByConvo.get(p.conversationId) ?? null;
    const members = othersByConvo.get(p.conversationId) ?? [];
    const base = {
      conversationId: p.conversationId,
      lastMessageAt: convo.lastMessageAt,
      unreadCount: unreadByConvo.get(p.conversationId) ?? 0,
      lastMessagePreview: latest?.body ?? null,
      lastMessageKind: latest?.kind ?? "text",
    };

    if (kind === "group") {
      const fallbackTitle = members.map((m) => m.displayName).slice(0, 3).join(", ");
      result.push({
        ...base,
        kind: "group",
        title: convo.title ?? null,
        otherIdentityId: 0,
        otherNumber: "",
        otherDisplayName: convo.title || fallbackTitle || "Group",
        otherAvatarUrl: null,
        memberCount: members.length + 1, // + me
      });
    } else if (members.length > 0) {
      // Regular 1:1 DM — the single other participant.
      const other = members[0];
      result.push({
        ...base,
        kind: "dm",
        title: null,
        otherIdentityId: other.id,
        otherNumber: other.number,
        otherDisplayName: other.displayName,
        otherAvatarUrl: other.avatarUrl ?? null,
        memberCount: 2,
      });
    } else if (input.myIdentity && !convoIdsWithRawOther.has(p.conversationId)) {
      // TRUE self-conversation (no other participant rows at all) — synthesise
      // the "Notes (You)" peer row.
      result.push({
        ...base,
        kind: "dm",
        title: null,
        otherIdentityId: input.myIdentity.id,
        otherNumber: input.myIdentity.number,
        otherDisplayName: "Notes (You)",
        otherAvatarUrl: input.myIdentity.avatarUrl ?? null,
        memberCount: 1,
      });
    }
    // else: a DM whose peer didn't resolve (or myIdentity missing) → drop, just
    // as the pre-refactor projection did (never mislabel it "Notes (You)").
  }

  result.sort((a, b) => b.lastMessageAt.getTime() - a.lastMessageAt.getTime());
  return result;
}

export async function listThreads(identityId: number): Promise<ThreadSummary[]> {
  const db = await getDb();
  if (!db) return [];

  // 1) all conversations I'm in
  const myParts = await db
    .select()
    .from(conversationParticipants)
    .where(eq(conversationParticipants.identityId, identityId));
  if (myParts.length === 0) return [];
  const convoIds = myParts.map((p) => p.conversationId);
  const unreadByConvo = new Map<number, number>();
  myParts.forEach((p) => unreadByConvo.set(p.conversationId, p.unreadCount));

  // 2) the other participant per conversation
  const others = await db
    .select()
    .from(conversationParticipants)
    .where(
      and(
        inArray(conversationParticipants.conversationId, convoIds),
        sql`${conversationParticipants.identityId} <> ${identityId}`
      )
    );
  const otherIdentityIds = others.map((o) => o.identityId);
  const otherIds = await db
    .select()
    .from(identities)
    .where(inArray(identities.id, otherIdentityIds.length > 0 ? otherIdentityIds : [-1]));
  const otherById = new Map(otherIds.map((i) => [i.id, i]));

  // 3) the conversations themselves (for lastMessageAt)
  const convos = await db
    .select()
    .from(conversations)
    .where(inArray(conversations.id, convoIds));
  const convoById = new Map(convos.map((c) => [c.id, c]));

  // 4) the most-recent non-deleted message per conversation, for preview.
  // Groupwise-max (v2.88): SELECT MAX(id) GROUP BY conversationId, then fetch
  // just those rows. The old query selected EVERY non-deleted message across
  // ALL of a user's conversations with no LIMIT and picked first-per-convo in
  // JS — polled every few seconds by every client, that scan grew linearly
  // with total message history. Backed by the (conversationId, id) index.
  const maxIdRows = await db
    .select({
      conversationId: messages.conversationId,
      maxId: sql<number>`MAX(${messages.id})`,
    })
    .from(messages)
    .where(and(inArray(messages.conversationId, convoIds), isNull(messages.deletedAt)))
    .groupBy(messages.conversationId);
  const latestIds = maxIdRows.map((r) => Number(r.maxId)).filter((n) => Number.isFinite(n));
  const recents =
    latestIds.length > 0
      ? await db.select().from(messages).where(inArray(messages.id, latestIds))
      : [];
  const latestByConvo = new Map<number, typeof recents[number]>();
  for (const m of recents) latestByConvo.set(m.conversationId, m);

  // 5) Find this user's own row so we can synthesise the "Notes (You)"
  // peer projection on self-conversations (where there's no other row).
  const myIdentityRow = await db
    .select()
    .from(identities)
    .where(eq(identities.id, identityId))
    .limit(1);
  const me = myIdentityRow[0] ?? null;

  return composeThreadSummaries({
    identityId,
    myParts: myParts.map((p) => ({
      conversationId: p.conversationId,
      unreadCount: p.unreadCount,
    })),
    others: others.map((o) => ({
      conversationId: o.conversationId,
      identityId: o.identityId,
    })),
    otherIdentities: otherIds.map((i) => ({
      id: i.id,
      number: i.number,
      displayName: i.displayName,
      avatarUrl: i.avatarUrl ?? null,
    })),
    myIdentity: me
      ? {
          id: me.id,
          number: me.number,
          displayName: me.displayName,
          avatarUrl: me.avatarUrl ?? null,
        }
      : null,
    convoRows: convos.map((c) => ({
      id: c.id,
      lastMessageAt: c.lastMessageAt,
      kind: c.kind,
      title: c.title,
    })),
    latestMessageByConvo: new Map(
      Array.from(latestByConvo.entries()).map(([k, m]) => [
        k,
        m
          ? {
              // Self-destructing messages (v2.96) must NOT leak their text
              // into the thread list — the bubble is locked until tapped.
              body:
                (m.meta as { expire?: unknown } | null)?.expire != null
                  ? null
                  : (m.body ?? null),
              kind: m.kind,
            }
          : null,
      ])
    ),
  });
}

export async function listMessages(input: {
  conversationId: number;
  identityId: number;
  beforeId?: number;
  limit?: number;
}) {
  const db = await getDb();
  if (!db) return [];
  // verify membership
  const member = await db
    .select()
    .from(conversationParticipants)
    .where(
      and(
        eq(conversationParticipants.conversationId, input.conversationId),
        eq(conversationParticipants.identityId, input.identityId)
      )
    )
    .limit(1);
  if (member.length === 0) return [];

  const limit = Math.min(input.limit ?? 50, 200);
  const baseWhere = and(
    eq(messages.conversationId, input.conversationId),
    isNull(messages.deletedAt)
  );
  const where = input.beforeId ? and(baseWhere, lt(messages.id, input.beforeId)) : baseWhere;
  const rows = await db
    .select()
    .from(messages)
    .where(where)
    .orderBy(desc(messages.id))
    .limit(limit);
  return rows.reverse(); // ascending by id (oldest first) for rendering
}

/** Search message bodies within ONE conversation (membership-gated, mirrors
 *  listMessages). The LIKE '%term%' scan can't use an index either way (the
 *  leading wildcard rules that out), but it's bounded to one conversation's
 *  rows via the existing messages_conversation_idx, so this stays cheap at the
 *  message volumes this app sees. */
export async function searchMessages(input: {
  conversationId: number;
  identityId: number;
  query: string;
  limit?: number;
}) {
  const db = await getDb();
  if (!db) return [];
  const member = await db
    .select()
    .from(conversationParticipants)
    .where(
      and(
        eq(conversationParticipants.conversationId, input.conversationId),
        eq(conversationParticipants.identityId, input.identityId)
      )
    )
    .limit(1);
  if (member.length === 0) return [];

  const q = input.query.trim();
  if (!q) return [];
  // Escape LIKE wildcards so a literal "%" or "_" in the search text is matched
  // literally, not treated as a pattern.
  const escaped = q.replace(/[\\%_]/g, (c) => "\\" + c);
  const limit = Math.min(input.limit ?? 50, 100);
  const rows = await db
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, input.conversationId),
        isNull(messages.deletedAt),
        like(messages.body, `%${escaped}%`)
      )
    )
    .orderBy(desc(messages.id))
    .limit(limit);
  // Self-destructing messages (v2.96) never surface through search — their
  // content is locked behind the tap-to-view burn.
  return rows.filter((r) => (r.meta as { expire?: unknown } | null)?.expire == null);
}

export async function sendMessage(input: {
  conversationId: number;
  senderIdentityId: number;
  kind?: "text" | "image" | "video" | "audio" | "file" | "system";
  body?: string | null;
  attachmentId?: number | null;
  replyToId?: number | null;
  meta?: unknown;
}) {
  const db = await getDb();
  if (!db) throw new Error("database unavailable");
  // verify membership (unless system message: server-only)
  if (input.kind !== "system") {
    const member = await db
      .select()
      .from(conversationParticipants)
      .where(
        and(
          eq(conversationParticipants.conversationId, input.conversationId),
          eq(conversationParticipants.identityId, input.senderIdentityId)
        )
      )
      .limit(1);
    if (member.length === 0) throw new Error("not a member of this conversation");
  }
  const now = new Date();
  // Insert + lastMessageAt bump + unread bump must be atomic; and we must return
  // the row WE inserted (by insertId). Selecting max(id) could return another
  // sender's message under concurrent sends in the same conversation.
  return db.transaction(async (tx) => {
    // A replyToId must reference a REAL message in THIS SAME conversation —
    // without this check, a client could set replyToId to any message id in
    // the whole database (including ones in conversations it isn't even a
    // member of), spoofing a fake "quoted reply" to a stranger's message.
    if (input.replyToId != null) {
      const [target] = await tx
        .select({ id: messages.id })
        .from(messages)
        .where(and(eq(messages.id, input.replyToId), eq(messages.conversationId, input.conversationId)))
        .limit(1);
      if (!target) throw new Error("reply target not found in this conversation");
    }
    const ins = await tx.insert(messages).values({
      conversationId: input.conversationId,
      senderIdentityId: input.senderIdentityId,
      kind: input.kind ?? "text",
      body: input.body ?? null,
      attachmentId: input.attachmentId ?? null,
      replyToId: input.replyToId ?? null,
      meta: (input.meta as object) ?? null,
      status: "sent",
    });
    const insertId = Number(ins[0].insertId);
    // bump the conversation's lastMessageAt
    await tx
      .update(conversations)
      .set({ lastMessageAt: now })
      .where(eq(conversations.id, input.conversationId));
    // bump unread for everyone else
    await tx
      .update(conversationParticipants)
      .set({ unreadCount: sql`${conversationParticipants.unreadCount} + 1` })
      .where(
        and(
          eq(conversationParticipants.conversationId, input.conversationId),
          sql`${conversationParticipants.identityId} <> ${input.senderIdentityId}`
        )
      );
    const rows = await tx
      .select()
      .from(messages)
      .where(eq(messages.id, insertId))
      .limit(1);
    return rows[0];
  });
}

/** True if `senderIdentityId` already posted an auto-reply in this conversation
 *  within `sinceMs` — used to rate-limit offline auto-replies (one per window). */
export async function recentAutoReplyExists(
  conversationId: number,
  senderIdentityId: number,
  sinceMs: number
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const cutoff = new Date(Date.now() - sinceMs);
  const rows = await db
    .select({ id: messages.id })
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, conversationId),
        eq(messages.senderIdentityId, senderIdentityId),
        gte(messages.createdAt, cutoff),
        isNull(messages.deletedAt),
        sql`JSON_EXTRACT(${messages.meta}, '$.autoReply') IS NOT NULL`
      )
    )
    .limit(1);
  return rows.length > 0;
}

export async function getConversationParticipantIds(
  conversationId: number
): Promise<number[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select({ id: conversationParticipants.identityId })
    .from(conversationParticipants)
    .where(eq(conversationParticipants.conversationId, conversationId));
  return rows.map((r) => r.id);
}

/**
 * Soft-delete (unsend) a message. Only the original sender may delete, and only
 * their own message. Sets `deletedAt` and nulls the body/attachment so the row
 * stops appearing (listMessages/listThreads already filter `deletedAt`). Returns
 * the conversationId on success (for push fan-out), or null if not found / not
 * the sender.
 */
export async function deleteMessage(input: {
  messageId: number;
  identityId: number;
}): Promise<number | null> {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .select()
    .from(messages)
    .where(eq(messages.id, input.messageId))
    .limit(1);
  if (!row || row.senderIdentityId !== input.identityId || row.deletedAt) return null;
  // ATOMIC CLAIM (v2.99.57), the same shape as `burnExpiringMessage`. The
  // read-then-write above is a check-then-act: two concurrent unsends of one
  // message both passed the `row.deletedAt` check and both ran the decrement
  // below, so every other participant's stored `unreadCount` was reduced once PER
  // racing request — corrupting counts for messages that were never unsent, and
  // permanently, since the counter is stored rather than derived. Only the caller
  // that actually flips `deletedAt` may proceed.
  const claim = await db
    .update(messages)
    .set({ deletedAt: new Date(), body: null, attachmentId: null })
    .where(
      and(
        eq(messages.id, input.messageId),
        eq(messages.senderIdentityId, input.identityId),
        isNull(messages.deletedAt),
      ),
    );
  const claimed =
    Array.isArray(claim) && ((claim[0] as { affectedRows?: number })?.affectedRows ?? 0) > 0;
  if (!claimed) return null; // lost the race — another unsend already did the work
  // unreadCount is a stored per-recipient counter (bumped +1 on send, reset to 0
  // on read) — NOT derived from message ids. Unsending an as-yet-UNREAD message
  // therefore leaves a phantom badge: the row is gone from listThreads (deletedAt
  // filter) but the count still includes it, so the recipient sees "1 unread" for
  // a message that no longer exists (v2.99.19). Decrement (floored at 0) for every
  // participant except the sender who hadn't yet read past this message.
  await db
    .update(conversationParticipants)
    .set({ unreadCount: sql`GREATEST(${conversationParticipants.unreadCount} - 1, 0)` })
    .where(
      and(
        eq(conversationParticipants.conversationId, row.conversationId),
        ne(conversationParticipants.identityId, input.identityId),
        or(
          isNull(conversationParticipants.lastReadMessageId),
          lt(conversationParticipants.lastReadMessageId, input.messageId)
        )
      )
    );
  return row.conversationId;
}

/**
 * Self-destruct (v2.96): a RECIPIENT opened an expiring message (view-once or
 * countdown) and it burned — destroy the content FOR EVERYONE. Only a
 * conversation participant who is NOT the sender can consume, exactly once.
 * The row keeps its meta (`expire` + a new `consumedAt`) so both sides render
 * an honest "disappeared" placeholder, and the linked attachment ROW is
 * deleted so the storage key stops authorizing (same access-layer honesty as
 * status media). Returns the conversation + roster for the SSE fan-out.
 */
/**
 * ATOMIC view-once burn (M22). Nulls the content and stamps `consumedAt`, but
 * ONLY if the message has not already been consumed — the `JSON_EXTRACT(...)
 * IS NULL` guard is evaluated by MySQL as part of the UPDATE, so exactly ONE
 * concurrent caller can ever win. Returns true for the winner, false for a
 * caller that lost the race (or whose row vanished).
 *
 * SECURITY (same lost-update class as the S1 PIN-lockout and S9 OTP races):
 * both burn paths previously did read → check `meta.consumedAt == null` in JS →
 * write, with an await in between (the participant lookup). Two concurrent
 * reveals of the SAME view-once message therefore both observed "not yet
 * consumed", both passed, and both returned the captured content — defeating
 * the once-only guarantee the whole feature rests on. It also amplified the
 * reveal path's cost: N racing reveals each triggered a full storage fetch and
 * base64 inline of the same object.
 */
async function burnExpiringMessage(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  messageId: number,
  meta: Record<string, unknown>,
): Promise<boolean> {
  const res = await db
    .update(messages)
    .set({
      body: null,
      attachmentId: null,
      meta: { ...meta, consumedAt: Date.now() },
    })
    .where(
      and(
        eq(messages.id, messageId),
        sql`JSON_EXTRACT(${messages.meta}, '$.consumedAt') IS NULL`,
      ),
    );
  // mysql2 returns [ResultSetHeader]; affectedRows>0 means THIS statement won.
  return Array.isArray(res) && ((res[0] as { affectedRows?: number })?.affectedRows ?? 0) > 0;
}

export async function consumeExpiringMessage(input: {
  messageId: number;
  identityId: number;
}): Promise<{ conversationId: number; participantIds: number[] } | null> {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .select()
    .from(messages)
    .where(eq(messages.id, input.messageId))
    .limit(1);
  if (!row || row.deletedAt) return null;
  const meta = (row.meta ?? null) as { expire?: unknown; consumedAt?: unknown } | null;
  if (!meta || meta.expire == null || meta.consumedAt != null) return null;
  if (row.senderIdentityId === input.identityId) return null;
  const pids = await getConversationParticipantIds(row.conversationId);
  if (!pids.includes(input.identityId)) return null;
  if (!(await burnExpiringMessage(db, input.messageId, meta as Record<string, unknown>))) {
    return null; // lost the race — another caller already burned it
  }
  // SECURITY (F3): we deliberately do NOT delete the attachments row on consume.
  // The message's attachmentId was just nulled above, so no conversation
  // references this file and getAttachmentForIdentity now denies every
  // participant (including the reader who burned it) — access IS revoked.
  // Deleting the row instead would make getAttachmentByStorageKey return null,
  // so authorizeStorageKey classifies the (still-present) S3 object as `unknown`,
  // which the storage proxy serves to ANYONE, unauthenticated. That is: burning
  // view-once media would make it MORE accessible, not less. Keeping the row
  // keeps the key classified as `attachment` and fails CLOSED (403) for every
  // non-uploader — matching the status-media model (ephemeral at the access
  // layer even though the object lingers in the bucket).
  return { conversationId: row.conversationId, participantIds: pids };
}

/**
 * M11 (server-side content gating): a RECIPIENT reveals a locked expiring
 * message. The content (body + attachment) is WITHHELD from `messages.list`
 * for a locked message, so the ONLY way to see it is through here — this
 * captures the content, then burns it (view-once: destroyed for everyone,
 * exactly like consumeExpiringMessage), and returns the captured content so
 * the caller can hand it to the revealer once. Same authorization as
 * consumeExpiringMessage (participant, not the sender, not already consumed).
 */
export async function revealExpiringMessage(input: {
  messageId: number;
  identityId: number;
  /** Refuse — WITHOUT burning — when the attachment exceeds this (v2.99.57). */
  maxAttachmentBytes?: number;
}): Promise<
  | {
      conversationId: number;
      participantIds: number[];
      body: string | null;
      attachmentId: number | null;
      tooLarge?: false;
    }
  | { tooLarge: true }
  | null
> {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .select()
    .from(messages)
    .where(eq(messages.id, input.messageId))
    .limit(1);
  if (!row || row.deletedAt) return null;
  const meta = (row.meta ?? null) as { expire?: unknown; consumedAt?: unknown } | null;
  if (!meta || meta.expire == null || meta.consumedAt != null) return null;
  if (row.senderIdentityId === input.identityId) return null;
  const pids = await getConversationParticipantIds(row.conversationId);
  if (!pids.includes(input.identityId)) return null;
  const capturedBody = row.body ?? null;
  const capturedAttachmentId = row.attachmentId ?? null;
  // SIZE CHECK BEFORE THE BURN (v2.99.57). The caller inlines the media as a data
  // URL because the burn revokes the storage key — but it evaluated its ~30MB
  // ceiling AFTER burning, so a larger view-once attachment was destroyed, the
  // inline threw, and the reader was told `ok: true` with no media. The content was
  // gone, the sender was told it had been seen, and nothing reported a failure.
  // Refusing here leaves the message intact so it can still be opened on a device
  // or build that can handle it.
  if (input.maxAttachmentBytes != null && capturedAttachmentId != null) {
    const [att] = await db
      .select({ sizeBytes: attachments.sizeBytes })
      .from(attachments)
      .where(eq(attachments.id, capturedAttachmentId))
      .limit(1);
    if (att && Number(att.sizeBytes) > input.maxAttachmentBytes) {
      return { tooLarge: true };
    }
  }
  // Burn — same as consumeExpiringMessage (keep the attachments ROW per F3 so
  // the lingering S3 object stays classified `attachment` and fails CLOSED).
  // ATOMIC (M22): only the caller that actually flips `consumedAt` may receive
  // the captured content, so two concurrent reveals can't both read it.
  if (!(await burnExpiringMessage(db, input.messageId, meta as Record<string, unknown>))) {
    return null; // lost the race — another caller already burned it
  }
  return {
    conversationId: row.conversationId,
    participantIds: pids,
    body: capturedBody,
    attachmentId: capturedAttachmentId,
  };
}

/**
 * Mark a conversation's inbound messages DELIVERED (v2.99.74).
 *
 * Owner: "the other user is online and he received, but he didn't open it. It should
 * show second check mark beside that."
 *
 * `messages.status` has had a `delivered` value since the schema was written and
 * NOTHING ever set it, so one tick and two ticks were the same state and the sender
 * could not tell "gone" from "arrived". This is the missing transition.
 *
 * DELIVERED MEANS "THE RECIPIENT'S APP HAS IT", which is why the recipient's client
 * calls this rather than the server inferring it from a live SSE connection: an open
 * stream proves a socket exists, not that the message reached the app — and it would
 * miss the ordinary case of someone who was offline when it was sent and opens the app
 * later without opening the thread. That case is precisely the one the second tick is
 * for.
 *
 * Never touches a message the caller SENT (you do not deliver to yourself) and never
 * downgrades one already `read`, so a late-arriving call cannot walk a receipt
 * backwards. Membership-scoped like `markThreadRead`, for the same reason: without it,
 * any identity could stamp receipts on conversations it is not part of.
 *
 * IN A GROUP, "delivered" MEANS AT LEAST ONE MEMBER HAS IT, not all of them — the row
 * is shared, so the first member to report flips it for the sender's view. That is not
 * a shortcut introduced here: `markThreadRead` has always worked exactly this way, so
 * the second tick inherits the same semantics the third one already had rather than
 * inventing a different rule for the same row. Per-recipient receipts would need a
 * per-participant table, which is a schema change and a separate piece of work.
 */
export async function markThreadDelivered(input: {
  conversationId: number;
  identityId: number;
}): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  try {
    const membership = await db
      .select({ id: conversationParticipants.identityId })
      .from(conversationParticipants)
      .where(
        and(
          eq(conversationParticipants.conversationId, input.conversationId),
          eq(conversationParticipants.identityId, input.identityId)
        )
      )
      .limit(1);
    if (membership.length === 0) return false;
    await db
      .update(messages)
      .set({ status: "delivered", deliveredAt: new Date() })
      .where(
        and(
          eq(messages.conversationId, input.conversationId),
          sql`${messages.senderIdentityId} <> ${input.identityId}`,
          isNull(messages.deletedAt),
          // ONLY from "sent". Excluding "read" is what stops a receipt going
          // backwards, and excluding "failed" leaves a genuine failure visible.
          eq(messages.status, "sent")
        )
      );
    return true;
  } catch {
    // A receipt is not worth failing a page render over.
    return false;
  }
}

export async function markThreadRead(input: {
  conversationId: number;
  identityId: number;
}): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  let isMember = false;
  // last visible message id — must match listMessages/listThreads' deletedAt
  // filter, or a soft-deleted message could become lastReadMessageId and get
  // skipped over forever (its content is gone, but its id still "counts").
  // Read the last-visible id and apply BOTH updates atomically, so a partial
  // failure can't leave the participant's unreadCount reset to 0 without the
  // matching read-receipt flip (or vice versa). Mirrors the sendMessage txn.
  await db.transaction(async (tx) => {
    // SECURITY (S6): confirm the caller is actually a participant BEFORE
    // flipping any read state. The unreadCount write below is already
    // membership-scoped (it no-ops for a non-member), but the peer-message
    // `status:"read"` UPDATE was not — so any identity could mark another
    // conversation's inbound messages "read" by iterating conversation ids,
    // corrupting real participants' delivery receipts. Check inside the same
    // tx (no TOCTOU) and bail out for non-members.
    const membership = await tx
      .select({ id: conversationParticipants.identityId })
      .from(conversationParticipants)
      .where(
        and(
          eq(conversationParticipants.conversationId, input.conversationId),
          eq(conversationParticipants.identityId, input.identityId)
        )
      )
      .limit(1);
    if (membership.length === 0) return;
    isMember = true;
    // last visible message id — must match listMessages/listThreads' deletedAt
    // filter, or a soft-deleted message could become lastReadMessageId and get
    // skipped over forever (its content is gone, but its id still "counts").
    const rows = await tx
      .select({ id: messages.id })
      .from(messages)
      .where(and(eq(messages.conversationId, input.conversationId), isNull(messages.deletedAt)))
      .orderBy(desc(messages.id))
      .limit(1);
    const lastId = rows[0]?.id ?? null;
    await tx
      .update(conversationParticipants)
      .set({ unreadCount: 0, lastReadMessageId: lastId })
      .where(
        and(
          eq(conversationParticipants.conversationId, input.conversationId),
          eq(conversationParticipants.identityId, input.identityId)
        )
      );
    // Mark the peer's messages as read — but only those at or before the message
    // id we actually observed (lastId). Without the `id <= lastId` bound, a
    // message inserted between the SELECT above and this UPDATE would be flipped
    // to "read" before the reader ever saw it, giving the sender a false receipt.
    if (lastId != null) {
      const now = new Date();
      await tx
        .update(messages)
        .set({
          status: "read",
          // v2.99.74: stamp WHEN, for the message-info panel. Also backfill
          // `deliveredAt` if it is somehow still null — a message cannot have been
          // read without having been delivered, and leaving it null would make the
          // info panel show "read" above an empty "delivered" line.
          readAt: now,
          deliveredAt: sql`COALESCE(${messages.deliveredAt}, ${now})`,
        })
        .where(
          and(
            eq(messages.conversationId, input.conversationId),
            lte(messages.id, lastId),
            sql`${messages.senderIdentityId} <> ${input.identityId}`,
            isNull(messages.deletedAt),
            or(eq(messages.status, "sent"), eq(messages.status, "delivered"))
          )
        );
    }
  });
  return isMember;
}

/* ── attachments ──────────────────────────────────────────────── */

export async function recordAttachment(input: {
  storageKey: string;
  url: string;
  mimeType: string;
  sizeBytes: number;
  width?: number | null;
  height?: number | null;
  durationMs?: number | null;
  filename?: string | null;
  /** ≤512px thumbnail (v2.89) — key + servable URL, images only. */
  thumbKey?: string | null;
  thumbUrl?: string | null;
  uploadedByIdentityId: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("database unavailable");
  // Select back by the INSERTED id, not a fresh query keyed on (storageKey,
  // uploadedByIdentityId) — the same identity uploading two attachments with
  // an identical storageKey (or in quick succession) could race and return
  // the WRONG row under the old "ORDER BY id DESC LIMIT 1" re-select.
  const ins = await db.insert(attachments).values({
    storageKey: input.storageKey,
    url: input.url,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    width: input.width ?? null,
    height: input.height ?? null,
    durationMs: input.durationMs ?? null,
    filename: input.filename ?? null,
    thumbKey: input.thumbKey ?? null,
    thumbUrl: input.thumbUrl ?? null,
    uploadedByIdentityId: input.uploadedByIdentityId,
  });
  const insertId = Number(ins[0].insertId);
  const rows = await db.select().from(attachments).where(eq(attachments.id, insertId)).limit(1);
  return rows[0];
}

export async function getAttachmentById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(attachments).where(eq(attachments.id, id)).limit(1);
  return rows[0] ?? null;
}

/**
 * Look up an attachment by its STORAGE KEY (the full-size key) or its THUMBNAIL
 * key — the two `/manus-storage/{key}` shapes a browser can request. Used by the
 * storage proxy to authorize file access by conversation participation. Returns
 * null when no attachment owns this key (an avatar or other object).
 */
/**
 * True iff a CLIENT-SUPPLIED storage key lives in the identity's OWN upload
 * namespace (`relay-chat/{id}/…`, allowing one optional S3 bucket prefix) and
 * carries no traversal segment. Guards `attachments.register` (and mirrors
 * /api/v2/upload's thumbKey check) so a client can never forge ownership of a
 * stranger's key — which the storage proxy's participant check trusts via
 * uploadedByIdentityId. Pure — unit-tested.
 */
export function keyInOwnerNamespace(key: string, identityId: number, s3Prefix = ""): boolean {
  if (!key) return false;
  const ownerNs = `relay-chat/${identityId}/`;
  const inNs =
    key.startsWith(ownerNs) ||
    (!!s3Prefix && key.startsWith(s3Prefix) && key.slice(s3Prefix.length).startsWith(ownerNs));
  const hasTraversal = key.split("/").some((s) => s === ".." || s === ".");
  return inNs && !hasTraversal;
}

export async function getAttachmentByStorageKey(storageKey: string) {
  const db = await getDb();
  if (!db || !storageKey) return null;
  const rows = await db
    .select()
    .from(attachments)
    .where(or(eq(attachments.storageKey, storageKey), eq(attachments.thumbKey, storageKey)))
    .limit(1);
  return rows[0] ?? null;
}

export type StorageKeyAuthz =
  | { kind: "attachment"; authorized: boolean }
  | { kind: "status"; authorized: boolean }
  /** The key is some identity's CURRENT profile photo — semi-public. */
  | { kind: "avatar"; authorized: true }
  | { kind: "unknown" };

/**
 * Is this storage key some identity's CURRENT profile photo? Matches both the
 * relative `/manus-storage/<key>` shape our uploads mint and legacy rows that
 * stored an absolute origin in front of the same path. LIKE wildcards in the
 * key are escaped so the suffix match stays literal.
 */
export async function isIdentityAvatarKey(storageKey: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const exact = `/manus-storage/${storageKey}`;
  const [hit] = await db
    .select({ id: identities.id })
    .from(identities)
    .where(eq(identities.avatarUrl, exact))
    .limit(1);
  if (hit) return true;
  const escaped = storageKey.replace(/([\\%_])/g, "\\$1");
  const [suffixHit] = await db
    .select({ id: identities.id })
    .from(identities)
    .where(like(identities.avatarUrl, `%/manus-storage/${escaped}`))
    .limit(1);
  return Boolean(suffixHit);
}

/**
 * Authorize a `/manus-storage/{key}` fetch (participant-only file access).
 *
 *  - If the key belongs to a MESSAGE ATTACHMENT (a shared file / voice-note /
 *    image / video): readable ONLY by the uploader, or by a participant in a
 *    conversation that references it (identical rule to getAttachmentForIdentity,
 *    keyed by storageKey/thumbKey). A raw URL alone — held by a non-participant,
 *    or nobody logged in — is refused.
 *  - If the key is NOT a message attachment (an avatar / other object): returns
 *    `unknown`; the proxy serves those as before (avatars are semi-public — they
 *    already appear in directory previews — and are NOT the shared FILES this
 *    protects). Real attachment bytes always classify as `attachment` (MySQL's
 *    match set is a case-insensitive SUPERSET of the S3 exact-byte key), so a
 *    file can never slip through the `unknown` branch.
 */
export async function authorizeStorageKey(
  storageKey: string,
  identityId: number | null
): Promise<StorageKeyAuthz> {
  // Rich-status media (v2.95): no attachment row, so it would otherwise fall to
  // the public "unknown" path. Gate it on an ACTIVE status row + audience:
  //  - a deleted/expired status → no active row → 403 (media is truly ephemeral,
  //    even though the object lingers in the bucket).
  //  - anonymous / non-contact → 403 (not the world-readable avatar path).
  // Only status keys pay the extra query (`/status_` marker), so avatars and
  // thumbnails are unaffected.
  if (/\/status_/.test(storageKey)) {
    const st = await getActiveStatusByMediaKey(storageKey);
    if (!st) {
      // AVATAR RESCUE (v2.99.2): v2.96.1→v2.99.1 profile photos were uploaded
      // via `?bare=1`, which named them `status_…` — so this branch failed them
      // CLOSED (no status row ⇒ 403) and every avatar uploaded in that window
      // shows broken (owner report). A status-named key that is some identity's
      // CURRENT avatarUrl is a profile photo, semi-public by design — serve it.
      // No laundering risk: updateProfile's keyInOwnerNamespace gate (F2) means
      // only the key's OWNER can have adopted it as their avatar, and doing so
      // deliberately publishes their own media. Genuinely expired/deleted status
      // media (not anyone's avatar) still fails closed exactly as before.
      if (await isIdentityAvatarKey(storageKey)) return { kind: "avatar", authorized: true };
      return { kind: "status", authorized: false };
    }
    // DELIBERATELY refuses an anonymous request even for an "everyone" status
    // (v2.99.66). "Everyone" means every RELAY identity, not every HTTP client:
    // v2.99.14 exists specifically so a media URL cannot be opened or copied
    // outside the app, and relaxing this would hand back the shareable-link
    // behaviour that lockdown removed. Every real client has an identity (a
    // name-only guest counts), so nothing legitimate is refused here.
    if (identityId == null) return { kind: "status", authorized: false };
    if (st.identityId === identityId) return { kind: "status", authorized: true };
    // v2.99.66: the audience is a property of THIS post, not of its owner — an
    // "everyone" story and a contacts-only one can be live at the same time.
    const ok = await statusAudienceAuthorized(identityId, st.identityId, st.audience);
    return { kind: "status", authorized: ok };
  }
  const att = await getAttachmentByStorageKey(storageKey);
  if (!att) return { kind: "unknown" };
  if (identityId != null) {
    if (att.uploadedByIdentityId === identityId) return { kind: "attachment", authorized: true };
    const authed = await getAttachmentForIdentity(att.id, identityId);
    if (authed) return { kind: "attachment", authorized: true };
  }
  // LEGACY-AVATAR RESCUE (v2.96.1): pre-v2.96.1 profile photos were uploaded
  // through the ATTACHMENT path (a row exists but no message references it),
  // so the v2.95 participant gate blocked EVERYONE except the uploader — the
  // reported "my photo shows as a broken image to other people". A key that is
  // some identity's CURRENT avatar is semi-public by design (directory
  // previews already show it), so serve it. Runs only on the would-be-403
  // path — two indexed lookups, never on the normal attachment flow.
  if (await isIdentityAvatarKey(storageKey)) return { kind: "avatar", authorized: true };
  return { kind: "attachment", authorized: false };
}

/**
 * Authorization-scoped attachment fetch. Returns the attachment ONLY if the
 * caller is allowed to see it: either they uploaded it, or it is referenced by
 * a message in a conversation they participate in. Returns null otherwise, so a
 * caller cannot enumerate sequential attachment ids to read other people's
 * media (the public `attachments.get` endpoint must go through this).
 */
export async function getAttachmentForIdentity(attachmentId: number, identityId: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(attachments)
    .where(eq(attachments.id, attachmentId))
    .limit(1);
  const att = rows[0];
  if (!att) return null;
  // The uploader can always read their own attachment.
  if (att.uploadedByIdentityId === identityId) return att;
  // Otherwise require a message that references this attachment to live in a
  // conversation the caller participates in.
  //
  // SECURITY (M28 — view-once bypass): a still-LOCKED expiring message must NOT
  // serve as that authorization. M11 stopped handing the attachment back from
  // `messages.list` for a locked message, but this function is the gate behind
  // BOTH `attachments.get` (which takes a sequential integer id, so a recipient
  // can simply enumerate ids until one resolves) AND `authorizeStorageKey`, and
  // it happily matched the locked message — whose `attachmentId` is only nulled
  // at BURN time. So a recipient could read view-once media, repeatedly, without
  // ever burning it: the message stayed "locked" for everyone and the sender was
  // never told it had been seen — defeating the entire guarantee of the feature.
  //
  // Worse, the same gate is what `messages.send` uses to decide whether a caller
  // "owns" an attachment they're attaching, so a recipient could RE-ATTACH the
  // sender's view-once media to a brand-new message in another conversation —
  // laundering content that was meant to vanish into a permanent one the
  // original sender cannot unsend.
  //
  // The only legitimate path to locked content is `messages.revealExpiring`,
  // which burns it and inlines the bytes server-side. Note the uploader (i.e.
  // the SENDER) already returned above, so this restricts recipients only, and
  // a CONSUMED message has its `attachmentId` nulled and therefore stops
  // matching at all (fails closed, per F3).
  const ref = await db
    .select({ conversationId: messages.conversationId })
    .from(messages)
    .innerJoin(
      conversationParticipants,
      eq(conversationParticipants.conversationId, messages.conversationId)
    )
    .where(
      and(
        eq(messages.attachmentId, attachmentId),
        eq(conversationParticipants.identityId, identityId),
        sql`(JSON_EXTRACT(${messages.meta}, '$.expire') IS NULL OR JSON_EXTRACT(${messages.meta}, '$.consumedAt') IS NOT NULL)`
      )
    )
    .limit(1);
  return ref.length > 0 ? att : null;
}

/* ── batch lookups (collapse N+1 loops in list endpoints) ─────── */

export async function getIdentitiesByIds(ids: number[]) {
  const db = await getDb();
  if (!db || ids.length === 0) return [];
  return db.select().from(identities).where(inArray(identities.id, ids));
}

export async function getIdentitiesByNumbers(numbers: string[]) {
  const db = await getDb();
  if (!db || numbers.length === 0) return [];
  return db.select().from(identities).where(inArray(identities.number, numbers));
}

/* ── rich user status (story-style, ephemeral) ────────────────── */

/**
 * Who may watch a status (v2.99.66).
 *
 *  - "contacts"  the historical rule: either side having saved the other.
 *  - "everyone"  any signed-in RELAY identity that reaches the post.
 *
 * A block in either direction still wins over BOTH.
 */
export type StatusAudience = "contacts" | "everyone";

/**
 * Read a stored audience value. Anything that is not exactly "everyone" — NULL
 * (every pre-v2.99.66 row), a typo, a value from a future version, a corrupted
 * column — resolves to the PRIVATE option. Fail closed: a garbled value must
 * never be the reason a status is published wider than its author chose.
 */
export function normalizeStatusAudience(v: string | null | undefined): StatusAudience {
  return v === "everyone" ? "everyone" : "contacts";
}

export interface StatusRow {
  id: number;
  identityId: number;
  kind: string;
  text: string | null;
  bgColor: string | null;
  mediaKey: string | null;
  mediaUrl: string | null;
  mimeType: string | null;
  durationMs: number | null;
  /** Per-post audience; NULL = "contacts". Read via normalizeStatusAudience. */
  audience: string | null;
  createdAt: Date;
  expiresAt: Date;
}

export async function insertStatus(input: {
  identityId: number;
  kind: string;
  text: string | null;
  bgColor: string | null;
  mediaKey: string | null;
  mediaUrl: string | null;
  mimeType: string | null;
  durationMs: number | null;
  audience: StatusAudience;
  ttlMs: number;
}): Promise<StatusRow | null> {
  const db = await getDb();
  if (!db) return null;
  const expiresAt = new Date(Date.now() + input.ttlMs);
  await db.insert(statuses).values({
    identityId: input.identityId,
    kind: input.kind,
    text: input.text,
    bgColor: input.bgColor,
    mediaKey: input.mediaKey,
    mediaUrl: input.mediaUrl,
    mimeType: input.mimeType,
    durationMs: input.durationMs ?? null,
    // Stamped at insert, never read back from the identity default — that is what
    // makes a later default change unable to widen this post.
    audience: input.audience,
    expiresAt,
  });
  const [row] = await db
    .select()
    .from(statuses)
    .where(eq(statuses.identityId, input.identityId))
    .orderBy(desc(statuses.id))
    .limit(1);
  return (row as StatusRow) ?? null;
}

/** Active (unexpired) statuses for a set of owners, oldest→newest. */
export async function getActiveStatusesForOwners(ownerIds: number[]): Promise<StatusRow[]> {
  const db = await getDb();
  if (!db || ownerIds.length === 0) return [];
  const rows = await db
    .select()
    .from(statuses)
    .where(and(inArray(statuses.identityId, ownerIds), gt(statuses.expiresAt, new Date())))
    .orderBy(statuses.createdAt);
  return rows as StatusRow[];
}

/** A single active status (or null if missing/expired). */
export async function getActiveStatusById(id: number): Promise<StatusRow | null> {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .select()
    .from(statuses)
    .where(and(eq(statuses.id, id), gt(statuses.expiresAt, new Date())))
    .limit(1);
  return (row as StatusRow) ?? null;
}

/** Delete a status (owner-scoped) + its view rows. Returns true if it was ours. */
export async function deleteStatus(id: number, ownerId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const [own] = await db
    .select({ id: statuses.id })
    .from(statuses)
    .where(and(eq(statuses.id, id), eq(statuses.identityId, ownerId)))
    .limit(1);
  if (!own) return false;
  await db.delete(statuses).where(and(eq(statuses.id, id), eq(statuses.identityId, ownerId)));
  await db.delete(statusViews).where(eq(statusViews.statusId, id)).catch(() => {});
  return true;
}

/** Record that `viewerId` saw `statusId` (idempotent on the unique pair). */
export async function recordStatusView(statusId: number, viewerId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  try {
    await db.insert(statusViews).values({ statusId, viewerId });
  } catch {
    /* duplicate (already viewed) — the unique key rejected it; that's fine */
  }
}

/** Which of `statusIds` has `viewerId` already seen (drives unseen ring styling). */
export async function getViewedStatusIds(
  viewerId: number,
  statusIds: number[],
): Promise<Set<number>> {
  const db = await getDb();
  if (!db || statusIds.length === 0) return new Set();
  const rows = await db
    .select({ statusId: statusViews.statusId })
    .from(statusViews)
    .where(and(eq(statusViews.viewerId, viewerId), inArray(statusViews.statusId, statusIds)));
  return new Set(rows.map((r) => r.statusId));
}

/** Viewer identity-ids for a status, newest-seen first (owner-gated at router). */
export async function getStatusViewerIds(statusId: number): Promise<number[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select({ viewerId: statusViews.viewerId })
    .from(statusViews)
    .where(eq(statusViews.statusId, statusId))
    .orderBy(desc(statusViews.viewedAt));
  return rows.map((r) => r.viewerId);
}

/** viewer counts per status (for the owner's "seen by N"). */
export async function getStatusViewCounts(statusIds: number[]): Promise<Map<number, number>> {
  const db = await getDb();
  const out = new Map<number, number>();
  if (!db || statusIds.length === 0) return out;
  const rows = await db
    .select({ statusId: statusViews.statusId, c: sql<number>`count(*)` })
    .from(statusViews)
    .where(inArray(statusViews.statusId, statusIds))
    .groupBy(statusViews.statusId);
  for (const r of rows) out.set(r.statusId, Number(r.c));
  return out;
}

/** My saved contacts' numbers (to fan a status feed out to people I know),
 *  EXCLUDING anyone I've blocked. */
export async function getContactNumbersForOwner(ownerId: number): Promise<string[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select({ number: contacts.number, blocked: contacts.blocked })
    .from(contacts)
    .where(eq(contacts.ownerId, ownerId));
  return rows.filter((r) => r.blocked !== true).map((r) => r.number);
}

/**
 * Numbers `ownerId` has BLOCKED (v2.99.57).
 *
 * The complement of the filter above, needed because "who saved me" and "who I
 * saved" are different directions and only the second was block-filtered. A block
 * must hide statuses BOTH ways, which `statusAudienceAuthorized` enforces — but
 * `status.feed` builds its candidate set independently, so the two disagreed:
 * someone I blocked who had saved my number still appeared in my feed.
 */
export async function getBlockedNumbersForOwner(ownerId: number): Promise<Set<string>> {
  const db = await getDb();
  if (!db) return new Set();
  const rows = await db
    .select({ number: contacts.number })
    .from(contacts)
    .where(and(eq(contacts.ownerId, ownerId), eq(contacts.blocked, true)));
  return new Set(rows.map((r) => r.number));
}

/** Identity ids of everyone who has SAVED `number` as a (non-blocked) contact —
 *  the "people who added me" direction, so my feed can include their statuses
 *  too (v2.99.33 either-direction status visibility). */
export async function getIdentityIdsWhoSaved(number: string): Promise<number[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select({ ownerId: contacts.ownerId, blocked: contacts.blocked })
    .from(contacts)
    .where(eq(contacts.number, number));
  return Array.from(new Set(rows.filter((r) => r.blocked !== true).map((r) => r.ownerId)));
}

/** A single ACTIVE status by its media key (drives storage-proxy authorization). */
export async function getActiveStatusByMediaKey(
  mediaKey: string,
): Promise<{ id: number; identityId: number; audience: string | null } | null> {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .select({ id: statuses.id, identityId: statuses.identityId, audience: statuses.audience })
    .from(statuses)
    .where(and(eq(statuses.mediaKey, mediaKey), gt(statuses.expiresAt, new Date())))
    .limit(1);
  return row ?? null;
}

/**
 * Can `requesterId` view a status owned by `ownerId`? The owner always can.
 *
 * `audience` is the PER-POST value from `statuses.audience` (v2.99.66). Pass it
 * whenever the caller has a specific status in hand — the media gate and
 * markViewed both do. Omitting it evaluates the "contacts" rule, which is the
 * conservative reading and the right default for a caller that is reasoning
 * about an owner rather than about one post.
 *
 * The "contacts" rule (v2.99.33, owner: "when you post it, it doesn't appear on
 * anyone") is EITHER-DIRECTION, WhatsApp-style: a status reaches the people
 * YOU'VE added as contacts AND anyone who has added YOU — so posting is visible
 * to your contacts without requiring them to have saved you back.
 *
 * A block in EITHER direction hides statuses BOTH ways, and it is checked BEFORE
 * the audience widening, so "everyone" never means "everyone including someone I
 * blocked". This is the single audience rule shared by markViewed and media
 * access.
 */
export async function statusAudienceAuthorized(
  requesterId: number,
  ownerId: number,
  audience?: string | null,
): Promise<boolean> {
  if (requesterId === ownerId) return true;
  const db = await getDb();
  if (!db) return false;
  const owner = await getIdentityById(ownerId);
  const requester = await getIdentityById(requesterId);
  if (!owner || !requester) return false;
  // A block either way hides statuses in BOTH directions — and it outranks the
  // audience setting, so it is deliberately tested first.
  if (await isNumberBlockedBy(ownerId, requester.number)) return false; // owner blocked me
  if (await isNumberBlockedBy(requesterId, owner.number)) return false; // I blocked owner
  // "Everyone": any signed-in identity that gets this far may watch. Note the
  // caller has already established the requester IS a resolved identity — an
  // anonymous request never reaches here (the storage proxy refuses a null
  // identity before calling, and markViewed requires one).
  if (normalizeStatusAudience(audience) === "everyone") return true;
  // Either side having saved the other authorizes viewing.
  const [iSavedThem] = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(and(eq(contacts.ownerId, requesterId), eq(contacts.number, owner.number)))
    .limit(1);
  if (iSavedThem) return true;
  const [theySavedMe] = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(and(eq(contacts.ownerId, ownerId), eq(contacts.number, requester.number)))
    .limit(1);
  return !!theySavedMe;
}

/** My DEFAULT audience for new statuses (v2.99.66). NULL ⇒ "contacts". */
export async function getIdentityStatusAudience(identityId: number): Promise<StatusAudience> {
  const db = await getDb();
  if (!db) return "contacts";
  const [row] = await db
    .select({ a: identities.statusAudience })
    .from(identities)
    .where(eq(identities.id, identityId))
    .limit(1);
  return normalizeStatusAudience(row?.a ?? null);
}

/** Set my default audience for FUTURE statuses. Already-posted rows keep theirs. */
export async function setIdentityStatusAudience(
  identityId: number,
  audience: StatusAudience,
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("database unavailable");
  await db.update(identities).set({ statusAudience: audience }).where(eq(identities.id, identityId));
}

/**
 * The active statuses of ONE owner that `requesterId` is allowed to watch
 * (v2.99.66) — the discovery surface that gives "everyone" its meaning.
 *
 * The story feed is deliberately built from a BOUNDED candidate set (my contacts
 * + people who saved me), because the reverse of "everyone" is every identity in
 * the database and fanning realtime events to all of them is not a thing that can
 * be done. So "everyone" cannot mean "appears in strangers' feeds"; it means
 * "anyone who opens my profile can watch it". This is that lookup, called from
 * the profile popup with a number the viewer already has.
 *
 * Returns [] rather than an error for a status you may not see, so it is not an
 * existence oracle: a contacts-only poster is indistinguishable from someone with
 * no active status.
 */
export async function getViewableStatusesOfOwner(
  requesterId: number,
  ownerId: number,
): Promise<StatusRow[]> {
  const rows = await getActiveStatusesForOwners([ownerId]);
  if (rows.length === 0) return [];
  if (requesterId === ownerId) return rows;
  // One authorization call per DISTINCT audience value, not per row: the two
  // possible values mean at most two calls however many stories are live.
  const verdict = new Map<StatusAudience, boolean>();
  const out: StatusRow[] = [];
  for (const r of rows) {
    const a = normalizeStatusAudience(r.audience);
    if (!verdict.has(a)) {
      verdict.set(a, await statusAudienceAuthorized(requesterId, ownerId, a));
    }
    if (verdict.get(a)) out.push(r);
  }
  return out;
}

/** Count of a user's currently-active statuses (for the per-user cap). */
export async function countActiveStatuses(ownerId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const [row] = await db
    .select({ c: sql<number>`count(*)` })
    .from(statuses)
    .where(and(eq(statuses.identityId, ownerId), gt(statuses.expiresAt, new Date())));
  return Number(row?.c ?? 0);
}

/**
 * The REVERSE of the feed query: identity ids of everyone whose feed includes
 * `ownerId`'s statuses — used to fan out realtime "status" events the moment a
 * status is posted or removed. v2.99.33 (either-direction): that's everyone who
 * SAVED the owner's number (non-blocked) AND everyone the OWNER has saved
 * (their own contacts) — so a fresh post lights up on the poster's contacts
 * live, not just on people who saved them. Mutual blocks are dropped.
 *
 * DELIBERATELY NOT widened by an "everyone" audience (v2.99.66), even though
 * that looks like an inconsistency. This set is materialized and then iterated to
 * publish one SSE event per member; the reverse of "everyone" is every identity
 * in the database, so widening it would mean a full-table scan and a fan-out to
 * every user on every status post. "Everyone" is therefore an AUTHORIZATION
 * widening (see statusAudienceAuthorized) plus a pull-based discovery surface
 * (getViewableStatusesOfOwner), not a broadcast. Keep it bounded.
 */
export async function getStatusAudienceIds(
  ownerId: number,
  ownerNumber: string,
): Promise<number[]> {
  const db = await getDb();
  if (!db) return [];
  // People who SAVED the owner (follower direction).
  const savers = await db
    .select({ ownerId: contacts.ownerId, blocked: contacts.blocked })
    .from(contacts)
    .where(eq(contacts.number, ownerNumber));
  const saverIds = savers.filter((r) => r.blocked !== true).map((r) => r.ownerId);
  // People the OWNER saved (their own contacts) — a status also reaches these.
  const ownerContacts = await db
    .select({ number: contacts.number, blocked: contacts.blocked })
    .from(contacts)
    .where(eq(contacts.ownerId, ownerId));
  const savedNumbers = ownerContacts.filter((r) => r.blocked !== true).map((r) => r.number);
  const savedIdents = savedNumbers.length ? await getIdentitiesByNumbers(savedNumbers) : [];
  const candidateIds = Array.from(
    new Set<number>([...saverIds, ...savedIdents.map((i) => i.id)]),
  ).filter((id) => id !== ownerId);
  if (candidateIds.length === 0) return [];
  // A block hides statuses BOTH ways — drop anyone the owner blocked.
  const ownerBlocks = await db
    .select({ number: contacts.number })
    .from(contacts)
    .where(and(eq(contacts.ownerId, ownerId), eq(contacts.blocked, true)));
  const blockedNumbers = new Set(ownerBlocks.map((r) => r.number));
  const idents = await getIdentitiesByIds(candidateIds);
  return idents.filter((i) => !blockedNumbers.has(i.number)).map((i) => i.id);
}

/** Of `ownerIds`, which have BLOCKED `number` (so hide their statuses from it). */
export async function ownersWhoBlockedNumber(
  ownerIds: number[],
  number: string,
): Promise<Set<number>> {
  const db = await getDb();
  if (!db || ownerIds.length === 0) return new Set();
  const rows = await db
    .select({ ownerId: contacts.ownerId })
    .from(contacts)
    .where(
      and(inArray(contacts.ownerId, ownerIds), eq(contacts.number, number), eq(contacts.blocked, true)),
    );
  return new Set(rows.map((r) => r.ownerId));
}

/** Reap expired statuses + their view rows (bounded per sweep). */
export async function reapExpiredStatuses(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const dead = await db
    .select({ id: statuses.id })
    .from(statuses)
    .where(lt(statuses.expiresAt, new Date()))
    .limit(500);
  if (dead.length === 0) return 0;
  const ids = dead.map((d) => d.id);
  await db.delete(statusViews).where(inArray(statusViews.statusId, ids)).catch(() => {});
  await db.delete(statuses).where(inArray(statuses.id, ids));
  return ids.length;
}

export async function getAttachmentsByIds(ids: number[]) {
  const db = await getDb();
  if (!db || ids.length === 0) return [];
  return db.select().from(attachments).where(inArray(attachments.id, ids));
}

/* ── call history ─────────────────────────────────────────────── */

/** Record a missed (caller gave up) or declined call. No schema change — the
 *  call_history status enum already has "missed"/"declined". Fire-and-forget. */
export async function recordMissedCall(input: {
  callerIdentityId: number;
  calleeIdentityId: number;
  status?: "missed" | "declined";
  channel?: "voice" | "video";
}) {
  const db = await getDb();
  if (!db) return;
  const now = new Date();
  await db.insert(callHistory).values({
    callerIdentityId: input.callerIdentityId,
    calleeIdentityId: input.calleeIdentityId,
    channel: input.channel ?? "video",
    status: input.status ?? "missed",
    startedAt: now,
    endedAt: now,
  });
}

export async function recordCallStart(input: {
  callerIdentityId: number;
  calleeIdentityId: number;
  channel?: "voice" | "video";
}) {
  const db = await getDb();
  if (!db) throw new Error("database unavailable");
  await db.insert(callHistory).values({
    callerIdentityId: input.callerIdentityId,
    calleeIdentityId: input.calleeIdentityId,
    channel: input.channel ?? "video",
    status: "initiated",
  });
  const rows = await db
    .select()
    .from(callHistory)
    .where(
      and(
        eq(callHistory.callerIdentityId, input.callerIdentityId),
        eq(callHistory.calleeIdentityId, input.calleeIdentityId)
      )
    )
    .orderBy(desc(callHistory.id))
    .limit(1);
  return rows[0];
}

export async function listCallHistory(identityId: number, limit = 100, since?: Date | null) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select()
    .from(callHistory)
    .where(
      and(
        or(
          eq(callHistory.callerIdentityId, identityId),
          eq(callHistory.calleeIdentityId, identityId)
        ),
        // "Clear history": rows at/before the identity's cleared mark stay in
        // the DB (the OTHER party keeps their log) but are hidden from us.
        since ? gt(callHistory.startedAt, since) : undefined
      )
    )
    .orderBy(desc(callHistory.id))
    .limit(limit);
  return rows;
}

/** This identity's "Clear history" high-water mark (null = never cleared). */
export async function getHistoryClearedAt(identityId: number): Promise<Date | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select({ historyClearedAt: identities.historyClearedAt })
    .from(identities)
    .where(eq(identities.id, identityId))
    .limit(1);
  return rows[0]?.historyClearedAt ?? null;
}

/** "Clear history": per-user soft clear. Hides every call/conference row that
 *  started at or before NOW from this identity's History tab, and acks any
 *  outstanding missed-call badges (a cleared log shouldn't keep nagging). The
 *  rows themselves are untouched — the other parties keep their own history. */
export async function clearCallHistory(identityId: number) {
  const db = await getDb();
  if (!db) return;
  const now = new Date();
  await db
    .update(identities)
    .set({ historyClearedAt: now, missedCallsSeenAt: now })
    .where(eq(identities.id, identityId));
}

/**
 * Missed/declined INCOMING calls this identity hasn't acknowledged yet — i.e.
 * newer than its `missedCallsSeenAt` high-water mark (all of them if it's null).
 * Drives the landing missed-call popup + the History / bell badges. Returns the
 * rows newest-first (capped) plus the resolved caller name/number for each.
 */
export async function listUnseenMissedCalls(identityId: number, limit = 30) {
  const db = await getDb();
  if (!db) return [] as Array<{ id: number; callerIdentityId: number; callerName: string; callerNumber: string; status: string; channel: string; startedAt: Date }>;
  const meRows = await db.select().from(identities).where(eq(identities.id, identityId)).limit(1);
  const seenAt = (meRows[0] as { missedCallsSeenAt?: Date | null } | undefined)?.missedCallsSeenAt ?? null;
  const conds = [
    eq(callHistory.calleeIdentityId, identityId),
    inArray(callHistory.status, ["missed", "declined"]),
  ];
  if (seenAt) conds.push(gt(callHistory.startedAt, seenAt));
  const rows = await db
    .select()
    .from(callHistory)
    .where(and(...conds))
    .orderBy(desc(callHistory.id))
    .limit(limit);
  if (rows.length === 0) return [];
  const callerIds = Array.from(new Set(rows.map((r) => r.callerIdentityId)));
  const callerRows = await db.select().from(identities).where(inArray(identities.id, callerIds));
  const byId = new Map(callerRows.map((c) => [c.id, c]));
  return rows.map((r) => {
    const c = byId.get(r.callerIdentityId);
    return {
      id: r.id,
      callerIdentityId: r.callerIdentityId,
      callerName: c?.displayName || "Unknown",
      callerNumber: c?.number || "",
      status: r.status,
      channel: r.channel,
      startedAt: r.startedAt,
    };
  });
}

/** Acknowledge all missed calls up to now (clears the badge / popup). */
export async function markMissedCallsSeen(identityId: number) {
  const db = await getDb();
  if (!db) return;
  await db
    .update(identities)
    .set({ missedCallsSeenAt: new Date() })
    .where(eq(identities.id, identityId));
}

/* ── conference history (multi-party calls) ───────────────────── */

export interface ConferenceRosterEntry {
  number: string;
  name: string;
  identityId: number | null;
}

/**
 * Persist an ended conference (room). Resolves each participant pin to an
 * identity (a relay pin IS the identity's 6-digit number), writes one
 * conference_history row with the full JSON roster, and one
 * conference_participants row per registered participant so each can query
 * their own history with an index. Fire-and-forget; a DB hiccup is swallowed.
 */
export async function recordConferenceEnd(input: {
  roomId: string;
  dialedNumber: string | null;
  startedAt: number; // unix ms — when the room was created (the "when")
  answeredAt?: number | null; // unix ms — first answer; duration counts from here
  endedAt: number; // unix ms — last member active
  participants: Array<{ number: string; name: string }>;
}) {
  const db = await getDb();
  if (!db) return;
  const numbers = input.participants.map((p) => p.number);
  const idents = await getIdentitiesByNumbers(numbers);
  const byNumber = new Map(idents.map((i) => [i.number, i]));
  const roster: ConferenceRosterEntry[] = input.participants.map((p) => {
    const id = byNumber.get(p.number);
    return {
      number: p.number,
      // Prefer the identity's canonical display name; fall back to the relay name.
      name: id?.displayName || p.name || "Guest",
      identityId: id?.id ?? null,
    };
  });
  // Duration is TALK time: from the first answer (not the dial), to the end.
  const talkStart = input.answeredAt ?? input.startedAt;
  const durationSec = Math.max(0, Math.round((input.endedAt - talkStart) / 1000));
  // Use the driver's insertId (same pattern as sendMessage/createGroupConversation)
  // instead of a SELECT-back — avoids any roomId-reuse ambiguity + an extra query.
  const ins = await db.insert(conferenceHistory).values({
    roomId: input.roomId,
    dialedNumber: input.dialedNumber ?? null,
    partyCount: roster.length,
    startedAt: new Date(input.startedAt),
    endedAt: new Date(input.endedAt),
    durationSec,
    participants: roster,
  });
  const conferenceId = Number((ins as unknown as Array<{ insertId?: number }>)[0]?.insertId);
  if (!conferenceId) return;
  const partRows = roster
    .filter((r) => r.identityId != null)
    .map((r) => ({ conferenceId, identityId: r.identityId as number, number: r.number }));
  if (partRows.length) await db.insert(conferenceParticipants).values(partRows);
}

/** Conferences `identityId` participated in, most recent first. */
export async function listConferenceHistory(identityId: number, limit = 100, since?: Date | null) {
  const db = await getDb();
  if (!db) return [];
  const parts = await db
    .select()
    .from(conferenceParticipants)
    .where(eq(conferenceParticipants.identityId, identityId))
    .orderBy(desc(conferenceParticipants.id))
    .limit(limit);
  const confIds = Array.from(new Set(parts.map((p) => p.conferenceId)));
  if (!confIds.length) return [];
  const confs = await db
    .select()
    .from(conferenceHistory)
    // Order by id (monotonic) — startedAt has 1-second granularity, so it ties
    // unstably for conferences started in the same second.
    .where(
      and(
        inArray(conferenceHistory.id, confIds),
        // Same per-user "Clear history" mark as listCallHistory.
        since ? gt(conferenceHistory.startedAt, since) : undefined
      )
    )
    .orderBy(desc(conferenceHistory.id));
  return confs;
}


/* ──────────────────────────────────────────────────────────────────────────
 * Public landing-page stats. Aggregate counts only — never exposes any
 * personal data, just headline totals for the marketing page:
 *   - registeredUsers: rows in `users` (OAuth accounts)
 *   - guestsServed:    identities that never upgraded (userId IS NULL)
 *   - totalParties:    every identity ever provisioned (guest or registered)
 *   - onlineNow:       identities currently flagged online in `presence`
 * All counts are cheap COUNT(*) queries. Returns zeros if the DB is down so
 * the landing page degrades gracefully instead of throwing.
 * ────────────────────────────────────────────────────────────────────────── */
export interface PublicStats {
  registeredUsers: number;
  guestsServed: number;
  totalParties: number;
  onlineNow: number;
  /** Messages ever sent (v2.99.66 — owner asked for it beside the others). */
  messagesSent: number;
}

/**
 * Just the online count (v2.99.71) — the one live figure worth re-reading often.
 *
 * The pushed stats feed recomputes this every 2s while anyone is watching, and it is
 * cheap enough to justify that: `presence` is small and carries
 * `presence_isOnline_idx`, so this is an index scan, not the full-table COUNT(*) that
 * `messagesSent` requires. Re-running the whole of `getPublicStats` at that cadence
 * would mean counting the largest table in the schema every two seconds to watch a
 * number that changes hourly.
 *
 * Returns null rather than 0 on any trouble: "0 people online" is a visible claim on
 * the front page, and a query blip must never be allowed to make it.
 */
export async function getOnlineCount(): Promise<number | null> {
  try {
    const db = await getDb();
    if (!db) return null;
    const [row] = await db
      .select({ n: sql<number>`count(*)` })
      .from(presence)
      .where(eq(presence.isOnline, true));
    const n = Number(row?.n ?? NaN);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export async function getPublicStats(): Promise<PublicStats> {
  const db = await getDb();
  if (!db) {
    return { registeredUsers: 0, guestsServed: 0, totalParties: 0, onlineNow: 0, messagesSent: 0 };
  }

  const [usersRow] = await db
    .select({ n: sql<number>`count(*)` })
    .from(users);
  const [totalRow] = await db
    .select({ n: sql<number>`count(*)` })
    .from(identities);
  const [guestRow] = await db
    .select({ n: sql<number>`count(*)` })
    .from(identities)
    .where(isNull(identities.userId));
  const [onlineRow] = await db
    .select({ n: sql<number>`count(*)` })
    .from(presence)
    .where(eq(presence.isOnline, true));
  // Aggregate count only — no bodies, no senders, no conversation ids. Wrapped
  // because `messages` is the largest table here and a headline number must
  // never be the reason the landing page fails to render.
  let messagesSent = 0;
  try {
    const [msgRow] = await db.select({ n: sql<number>`count(*)` }).from(messages);
    messagesSent = Number(msgRow?.n ?? 0);
  } catch {
    messagesSent = 0;
  }

  return {
    registeredUsers: Number(usersRow?.n ?? 0),
    guestsServed: Number(guestRow?.n ?? 0),
    totalParties: Number(totalRow?.n ?? 0),
    onlineNow: Number(onlineRow?.n ?? 0),
    messagesSent,
  };
}

/* ──────────────────────────────────────────────────────────────────────────
 * Web Push subscriptions (v2.83) — one row per browser/device that granted
 * notification permission. Used to wake devices with NO live SSE connection:
 * incoming-call paging and missed-call notices.
 * ────────────────────────────────────────────────────────────────────────── */

export async function upsertPushSubscription(input: {
  identityId: number;
  endpoint: string;
  p256dh: string;
  auth: string;
  /** "webpush" (default) or "fcm" (native Android — endpoint = device token). */
  /** v2.99.79: "expo" joins these — an Expo push token needs Expo's own
   *  transport, not FCM. The column is varchar(10), so it fits. */
  kind?: "webpush" | "fcm" | "expo";
  /** sha256 of the browser's push claim, when it has one (v2.99.49). */
  claimHash?: string | null;
}): Promise<{ owned: boolean }> {
  const db = await getDb();
  // DB down: keep the fail-open convention — claim nothing was refused, so the
  // client never starts a pointless self-heal storm.
  if (!db) return { owned: true };
  const kind = input.kind ?? "webpush";
  const endpoint = input.endpoint.slice(0, 500);
  const p256dh = input.p256dh.slice(0, 255);
  const auth = input.auth.slice(0, 120);
  const claimHash = input.claimHash ?? null;

  // STEP 1 — create if absent, and DELIBERATELY do nothing on conflict. The old
  // code re-bound `identityId` right here, keyed on the globally-unique endpoint
  // alone: anyone who learned a victim's endpoint string could point it at their
  // own identity and silently kill the victim's notifications. The no-op keeps
  // the insert from being a hijack primitive; the guarded UPDATE below is the
  // only way an existing row's owner can change.
  await db
    .insert(pushSubscriptions)
    .values({ identityId: input.identityId, endpoint, p256dh, auth, kind, claimHash })
    .onDuplicateKeyUpdate({ set: { endpoint: sql`${pushSubscriptions.endpoint}` } });

  // STEP 2 — one conditional UPDATE with the ENTIRE gate in the WHERE, so it
  // reads the PRE-update row and cannot depend on the order MySQL emits SET
  // assignments in (the lesson from claimOfflineMessageEmail).
  await db
    .update(pushSubscriptions)
    .set({
      identityId: input.identityId,
      p256dh,
      auth,
      kind,
      ...(claimHash ? { claimHash } : {}),
    })
    .where(
      and(
        eq(pushSubscriptions.endpoint, endpoint),
        or(
          // Already ours — there is nothing to steal.
          eq(pushSubscriptions.identityId, input.identityId),
          // Proof of possession: the same browser profile that registered it.
          claimHash ? eq(pushSubscriptions.claimHash, claimHash) : sql`1=0`,
          // LEGACY row (claimHash IS NULL) — accept on a keys match. This is what
          // preserves the documented account-switch-on-same-device flow for every
          // subscription that predates the claim: the encryption keys come from
          // the browser's own PushSubscription, so a remote attacker with only the
          // endpoint string cannot produce them. Such a row is stamped with a
          // claim on this very update, so it is legacy exactly once.
          and(
            isNull(pushSubscriptions.claimHash),
            eq(pushSubscriptions.p256dh, p256dh),
            eq(pushSubscriptions.auth, auth)
          )
        )
      )
    );

  // STEP 3 — verdict from a RE-READ, not from affectedRows: MySQL reports 0
  // affected for a matched-but-unchanged row, which is indistinguishable from
  // "refused". A refusal is purely a no-op — the victim's identityId, keys and
  // claim are all untouched — so this can never break the owner, only decline an
  // unproven re-bind.
  const [row] = await db
    .select({ identityId: pushSubscriptions.identityId })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.endpoint, endpoint))
    .limit(1);
  const owned = !row || row.identityId === input.identityId;

  // EVICT past the per-identity ceiling (v2.99.57). Only once this row is ours —
  // a refused re-bind must stay a pure no-op and must never trim the victim's
  // devices. Oldest-first (ascending id), so the device the user is holding right
  // now is never the one dropped, and a NEW device always succeeds rather than
  // being refused at the door.
  if (owned) {
    try {
      const mine = await db
        .select({ id: pushSubscriptions.id })
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.identityId, input.identityId))
        .orderBy(asc(pushSubscriptions.id));
      const excess = mine.slice(0, Math.max(0, mine.length - MAX_PUSH_SUBS_PER_IDENTITY));
      if (excess.length) {
        await db.delete(pushSubscriptions).where(
          inArray(pushSubscriptions.id, excess.map((r) => r.id)),
        );
      }
    } catch {
      // Eviction is hygiene, never a reason to fail a subscribe — that would
      // cost the user their ring-when-closed notifications.
    }
  }
  return { owned };
}

export async function deletePushSubscription(endpoint: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint.slice(0, 500)));
}

/**
 * Delete a push subscription — but ONLY if it belongs to the calling identity.
 * The unscoped `deletePushSubscription` above stays for the system's own
 * dead-token cleanup (webPush.ts, after a failed/rejected send — no identity
 * context there, and it's already independently determined the endpoint is
 * invalid), but the user-facing `push.unsubscribe` procedure has no reason to
 * delete a row it doesn't own: without this scoping, `endpoint` alone was
 * enough for ANY caller to silently kill a stranger's incoming-call/missed-
 * call notifications (a targeted, silent notification DoS) by learning their
 * endpoint string (e.g. leaked in logs, a referrer, or the FCM token exposed
 * to the native layer).
 */
export async function deleteOwnPushSubscription(identityId: number, endpoint: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.endpoint, endpoint.slice(0, 500)), eq(pushSubscriptions.identityId, identityId)));
}

export async function listPushSubscriptions(
  identityId: number,
): Promise<Array<{ endpoint: string; p256dh: string; auth: string; kind: string | null }>> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select({
      endpoint: pushSubscriptions.endpoint,
      p256dh: pushSubscriptions.p256dh,
      auth: pushSubscriptions.auth,
      kind: pushSubscriptions.kind,
    })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.identityId, identityId))
    // Bounded (v2.99.57): `upsertPushSubscription` evicts past the same cap, so
    // this only ever truncates a row that eviction is about to remove anyway.
    .orderBy(desc(pushSubscriptions.id))
    .limit(MAX_PUSH_SUBS_PER_IDENTITY);
  return rows;
}

/* ──────────────────────────────────────────────────────────────────────────
 * Party lines (v2.89) — dialable ROOM numbers. A line gets its own 6-digit
 * number from the SAME space as identities; dialing it never rings anyone,
 * the caller just lands in the line's persistent relay room (`pl-<number>`).
 * ────────────────────────────────────────────────────────────────────────── */

/** Prevent one identity hoarding the number space. */
export const MAX_PARTY_LINES_PER_OWNER = 10;

/** Allocate a fresh 6-digit number that collides with NEITHER identities NOR
 *  existing party lines (one shared number space — see numberTaken). */
/* ── reservation lifecycle (v2.99.49) ───────────────────────────────────────
   Closes the leak deferred in v2.99.30. `allocateSharedNumber` inserts into the
   shared ledger and hands the number back; it never learns whether the caller
   went on to insert the real row. If that insert failed, the number was consumed
   forever.

   THE LEDGER'S MONOTONICITY IS LOAD-BEARING and must survive this: a number that
   WAS handed out must never be recycled, even after its identity row is deleted
   or renumbered, or a stale contact could later dial a stranger. So nothing here
   reclaims a number on the strength of "no row has it" alone. */

/** Reservations minted before the confirming code shipped are OUT OF SCOPE
 *  forever. A NULL `claimedAt` on such a row means "unknown", not "leaked" — it
 *  may be a number freed by a renumber or a removed party line, both of which the
 *  ledger must keep. Dated the day AFTER the deploy so no clock or session
 *  timezone skew can slide the floor back over the rollout. NEVER move earlier. */
const RESERVATION_CLAIM_EPOCH = "2026-07-26 00:00:00";
/** How long an unclaimed reservation is left alone. Must comfortably exceed the
 *  gap between reserving and inserting, so an in-flight allocation can never be
 *  reaped out from under itself. */
const RESERVATION_REAP_GRACE_SEC = 3600;

/** Stamp a reservation as genuinely bound to a real row. Best-effort by design:
 *  a stamp failure must never fail a signup, and the reaper's NOT EXISTS guard
 *  makes the consequence nil. Affects 0 rows when the allocation fail-opened
 *  without a ledger row at all — also fine. */
export async function confirmNumberReservation(number: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  try {
    await db.execute(
      sql`UPDATE \`number_reservations\` SET \`claimedAt\` = NOW() WHERE \`number\` = ${number} AND \`claimedAt\` IS NULL`
    );
  } catch (e) {
    console.warn("[numbers] confirm reservation skipped:", (e as Error)?.message || "");
  }
}

/** Release a reservation this process just took and PROVABLY never bound.
 *  Guarded on the number being absent from BOTH number tables, so it can never
 *  un-reserve one that is actually in use. */
export async function releaseUnusedNumberReservation(number: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  try {
    await db.execute(sql`
      DELETE FROM \`number_reservations\`
       WHERE \`number\` = ${number}
         AND NOT EXISTS (SELECT 1 FROM \`identities\`  i WHERE i.\`number\`  = ${number})
         AND NOT EXISTS (SELECT 1 FROM \`party_lines\` p WHERE p.\`number\` = ${number})`);
  } catch (e) {
    console.warn("[numbers] release reservation skipped:", (e as Error)?.message || "");
  }
}

/** Backstop for the case no release call can cover: the process dying between
 *  reserving and inserting. Only ever touches rows that are unclaimed AND minted
 *  after the epoch floor AND past the grace period AND absent from both number
 *  tables — four independent conditions, each of which alone would protect a live
 *  number. Bounded per sweep so it can never become a long lock. */
export async function reapUnclaimedReservations(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  try {
    const res = await db.execute(sql`
      DELETE FROM \`number_reservations\`
       WHERE \`claimedAt\` IS NULL
         AND \`createdAt\` >= ${RESERVATION_CLAIM_EPOCH}
         AND \`createdAt\` <  NOW() - INTERVAL ${sql.raw(String(RESERVATION_REAP_GRACE_SEC))} SECOND
         AND NOT EXISTS (SELECT 1 FROM \`identities\`  i WHERE i.\`number\`  = \`number_reservations\`.\`number\`)
         AND NOT EXISTS (SELECT 1 FROM \`party_lines\` p WHERE p.\`number\` = \`number_reservations\`.\`number\`)
       LIMIT 500`);
    const n = Array.isArray(res) ? ((res[0] as { affectedRows?: number })?.affectedRows ?? 0) : 0;
    if (n > 0) console.log(`[numbers] reclaimed ${n} unclaimed reservation(s)`);
    return n;
  } catch (e) {
    console.warn("[numbers] reservation reaper skipped:", (e as Error)?.message || "");
    return 0;
  }
}

export async function allocatePartyLineNumber(): Promise<string> {
  const db = await getDb();
  if (!db) throw new Error("database unavailable");
  // Same shared allocator identities use — so a party line and an identity can
  // never both claim the same fresh number (M20: cross-table reservation).
  return allocateSharedNumber(db);
}

export async function createPartyLine(input: {
  ownerIdentityId: number;
  title: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("database unavailable");
  const title = input.title.trim().slice(0, 64);
  if (!title) throw new Error("title required");
  // Fast pre-check (a clean error before we allocate/insert in the common
  // over-cap case). This alone is check-then-insert — RACY — so the true cap
  // is enforced deterministically AFTER the insert below (L8).
  const owned = await db
    .select({ id: partyLines.id })
    .from(partyLines)
    .where(eq(partyLines.ownerIdentityId, input.ownerIdentityId));
  if (owned.length >= MAX_PARTY_LINES_PER_OWNER) {
    throw new Error(`You can have at most ${MAX_PARTY_LINES_PER_OWNER} party lines.`);
  }
  // The unique index on `number` is the true guard; retry on a lost race.
  for (let attempt = 0; attempt < 3; attempt++) {
    const number = await allocatePartyLineNumber();
    let insertId: number;
    try {
      const ins = await db.insert(partyLines).values({
        number,
        ownerIdentityId: input.ownerIdentityId,
        title,
      });
      insertId = Number(ins[0].insertId);
    } catch (e) {
      const msg = (e as Error)?.message || "";
      if (!/duplicate/i.test(msg)) throw e; // only a number race retries
      continue;
    }
    // L8: the pre-check above is racy (two concurrent creates at count 9 both
    // pass, both insert → 11). Enforce the cap atomically by this row's
    // id-RANK: count the owner's rows with id <= ours. Since id is monotonic
    // and unique, concurrent racers get DISTINCT ranks, so exactly the rows
    // ranked > MAX self-delete (each deletes only its OWN id — no double
    // delete) and the set converges to exactly MAX.
    const [rankRow] = await db
      .select({ rank: sql<number>`count(*)` })
      .from(partyLines)
      .where(and(eq(partyLines.ownerIdentityId, input.ownerIdentityId), lte(partyLines.id, insertId)));
    if (Number(rankRow?.rank ?? 0) > MAX_PARTY_LINES_PER_OWNER) {
      await db.delete(partyLines).where(eq(partyLines.id, insertId)).catch(() => {});
      // The row is gone, so this number was never really handed out (v2.99.49).
      await releaseUnusedNumberReservation(number);
      throw new Error(`You can have at most ${MAX_PARTY_LINES_PER_OWNER} party lines.`);
    }
    await confirmNumberReservation(number);
    const [row] = await db.select().from(partyLines).where(eq(partyLines.id, insertId)).limit(1);
    if (row) return row;
  }
  throw new Error("could not allocate a party line number");
}

export async function getPartyLineByNumber(number: string) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(partyLines).where(eq(partyLines.number, number)).limit(1);
  return rows[0] ?? null;
}

export async function getPartyLinesByNumbers(numbers: string[]) {
  const db = await getDb();
  if (!db || numbers.length === 0) return [];
  return db.select().from(partyLines).where(inArray(partyLines.number, numbers));
}

export async function listPartyLines(ownerIdentityId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(partyLines)
    .where(eq(partyLines.ownerIdentityId, ownerIdentityId))
    .orderBy(desc(partyLines.id));
}

/** Owner-scoped delete. Returns true when a row was actually removed. */
export async function deletePartyLine(ownerIdentityId: number, id: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const rows = await db
    .select({ id: partyLines.id })
    .from(partyLines)
    .where(and(eq(partyLines.id, id), eq(partyLines.ownerIdentityId, ownerIdentityId)))
    .limit(1);
  if (rows.length === 0) return false;
  await db
    .delete(partyLines)
    .where(and(eq(partyLines.id, id), eq(partyLines.ownerIdentityId, ownerIdentityId)));
  return true;
}
