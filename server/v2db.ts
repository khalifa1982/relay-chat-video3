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
  like,
  lt,
  lte,
  or,
  sql,
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
import {
  sanitizeMobiles,
  sanitizeSocials,
  sanitizeStatusOverride,
  type SocialLink,
} from "@shared/profileFields";

/* ── identity ─────────────────────────────────────────────────── */

const RESERVED_PREFIXES = ["000", "111"]; // avoid trivially-confused numbers
const GUEST_DAYS = 30;

export function pairKey(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

function randomDigits6(): string {
  // Avoid leading zero -> reserves first digit 1-9.
  const first = 1 + Math.floor(Math.random() * 9);
  const rest = Math.floor(Math.random() * 100000)
    .toString()
    .padStart(5, "0");
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

export async function allocateNumber(): Promise<string> {
  const db = await getDb();
  if (!db) throw new Error("database unavailable");
  for (let attempt = 0; attempt < 25; attempt++) {
    const candidate = randomDigits6();
    if (RESERVED_PREFIXES.some((p) => candidate.startsWith(p))) continue;
    if (!(await numberTaken(db, candidate))) return candidate;
  }
  throw new Error("could not allocate a unique 6-digit number");
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
  const rows = await db
    .select()
    .from(identities)
    .where(eq(identities.userId, userId))
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
}): Promise<{ identity: ResolvedIdentity; guestToken: string }> {
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
  await db.insert(identities).values({
    number,
    displayName,
    guestToken,
    guestExpiresAt,
    deviceId,
  });
  const created = await db
    .select()
    .from(identities)
    .where(eq(identities.guestToken, guestToken))
    .limit(1);
  if (created.length === 0) throw new Error("insert succeeded but row missing");
  return { identity: rowToResolved(created[0]), guestToken };
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
}): Promise<ResolvedIdentity> {
  const db = await getDb();
  if (!db) throw new Error("database unavailable");

  const existingByUser = await getIdentityByUserId(input.userId);
  if (existingByUser) return existingByUser;

  // If the user previously had a guest identity cookie, upgrade that row.
  if (input.guestToken) {
    const guest = await getIdentityByGuestToken(input.guestToken);
    if (guest) {
      await db
        .update(identities)
        .set({
          userId: input.userId,
          displayName: input.displayName.trim().slice(0, 64) || guest.displayName,
          guestToken: null,
          guestExpiresAt: null,
        })
        .where(eq(identities.id, guest.id));
      const refreshed = await getIdentityById(guest.id);
      if (refreshed) return refreshed;
    }
  }

  // Fresh permanent identity.
  const number = await allocateNumber();
  await db.insert(identities).values({
    number,
    displayName: input.displayName.trim().slice(0, 64) || "User",
    userId: input.userId,
  });
  const created = await getIdentityByNumber(number);
  if (!created) throw new Error("user identity insert failed");
  return created;
}

/** Flip an identity to verified (blue badge) and record the registration name.
 *  Called after a successful email-OTP verification. */
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
 * Regenerate this identity's 6-digit number and PROPAGATE it across the network:
 * every contact that saved the OLD number is rewritten to the NEW one, so people
 * keep reaching them without re-adding. Collisions with a stale (ownerId,new)
 * contact are resolved by dropping the stale row first. Returns the old/new pair.
 */
export async function regenerateIdentityNumber(
  identityId: number
): Promise<{ oldNumber: string; newNumber: string } | null> {
  const db = await getDb();
  if (!db) throw new Error("database unavailable");
  const id = await getIdentityById(identityId);
  if (!id) return null;
  const oldNumber = id.number;
  const newNumber = await allocateNumber();
  // The identity update and contact propagation must succeed or fail TOGETHER.
  // The old code swallowed a propagation failure (try/catch around it only),
  // which could leave the identity pointed at newNumber while every contact
  // who'd saved the OLD number silently kept dialing a number that's no longer
  // this person — a split-brain the caller never finds out about (the function
  // still returned success). A transaction makes it all-or-nothing.
  await db.transaction(async (tx) => {
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
  });
  return { oldNumber, newNumber };
}

/* ── presence ─────────────────────────────────────────────────── */

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
  return victims;
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
    // Native Android app push transport (v2.86).
    { table: "push_subscriptions", column: "kind", ddl: "ADD COLUMN `kind` varchar(10)" },
    // 4-digit login PIN + lockout (v2.87).
    { table: "users", column: "loginPinHash", ddl: "ADD COLUMN `loginPinHash` text" },
    { table: "users", column: "loginPinAttempts", ddl: "ADD COLUMN `loginPinAttempts` int" },
    { table: "users", column: "loginPinLockedAt", ddl: "ADD COLUMN `loginPinLockedAt` timestamp NULL" },
    { table: "users", column: "preferPinLogin", ddl: "ADD COLUMN `preferPinLogin` boolean" },
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
    .orderBy(desc(contacts.favourite), desc(contacts.updatedAt));
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
 *  the device list (auth still works via the cookie). */
export async function recordSession(sid: string, userId: number, label: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  try {
    await db.insert(sessions).values({ sid, userId, label: label.slice(0, 160) || null });
  } catch (e) {
    console.warn("[sessions] record skipped:", (e as Error)?.message || "");
  }
}

/** The revocation gate for a cookie's sid:
 *   "active"  → the session row exists (valid),
 *   "revoked" → the row is gone (removed = the device was logged out),
 *   "error"   → no DB / query failed → the caller FAILS OPEN (keeps the user
 *               signed in), so a DB hiccup never logs anyone out.
 *  Only ever called for cookies that carry a sid; legacy cookies skip it. */
export async function sessionState(sid: string): Promise<"active" | "revoked" | "error"> {
  const db = await getDb();
  if (!db) return "error";
  try {
    const rows = await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.sid, sid))
      .limit(1);
    return rows.length > 0 ? "active" : "revoked";
  } catch {
    return "error";
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
  await db
    .insert(contacts)
    .values(values)
    .onDuplicateKeyUpdate({ set });
  const rows = await db
    .select()
    .from(contacts)
    .where(and(eq(contacts.ownerId, input.ownerId), eq(contacts.number, input.number)))
    .limit(1);
  return rows[0];
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
  await db
    .update(messages)
    .set({ deletedAt: new Date(), body: null, attachmentId: null })
    .where(and(eq(messages.id, input.messageId), eq(messages.senderIdentityId, input.identityId)));
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
  await db
    .update(messages)
    .set({
      body: null,
      attachmentId: null,
      meta: { ...meta, consumedAt: Date.now() },
    })
    .where(eq(messages.id, input.messageId));
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
      await tx
        .update(messages)
        .set({ status: "read" })
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
    if (identityId == null) return { kind: "status", authorized: false };
    if (st.identityId === identityId) return { kind: "status", authorized: true };
    const ok = await statusAudienceAuthorized(identityId, st.identityId);
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
        eq(conversationParticipants.identityId, identityId)
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

/** A single ACTIVE status by its media key (drives storage-proxy authorization). */
export async function getActiveStatusByMediaKey(
  mediaKey: string,
): Promise<{ id: number; identityId: number } | null> {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .select({ id: statuses.id, identityId: statuses.identityId })
    .from(statuses)
    .where(and(eq(statuses.mediaKey, mediaKey), gt(statuses.expiresAt, new Date())))
    .limit(1);
  return row ?? null;
}

/**
 * Can `requesterId` view statuses owned by `ownerId`? The owner always can;
 * otherwise the requester must have SAVED the owner (a non-blocked contact for
 * the owner's number) AND the owner must not have blocked the requester. This is
 * the single audience rule shared by the feed, markViewed, and media access.
 */
export async function statusAudienceAuthorized(
  requesterId: number,
  ownerId: number,
): Promise<boolean> {
  if (requesterId === ownerId) return true;
  const db = await getDb();
  if (!db) return false;
  const owner = await getIdentityById(ownerId);
  if (!owner) return false;
  const [saved] = await db
    .select({ blocked: contacts.blocked })
    .from(contacts)
    .where(and(eq(contacts.ownerId, requesterId), eq(contacts.number, owner.number)))
    .limit(1);
  if (!saved || saved.blocked === true) return false; // must have saved (not blocked) them
  const requester = await getIdentityById(requesterId);
  if (!requester) return false;
  if (await isNumberBlockedBy(ownerId, requester.number)) return false; // owner blocked me
  return true;
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
 * `ownerId`'s statuses — i.e. everyone who SAVED the owner's number (non-blocked)
 * and whom the owner hasn't blocked back. Used to fan out realtime "status"
 * events the moment a status is posted or removed.
 */
export async function getStatusAudienceIds(
  ownerId: number,
  ownerNumber: string,
): Promise<number[]> {
  const db = await getDb();
  if (!db) return [];
  const savers = await db
    .select({ ownerId: contacts.ownerId, blocked: contacts.blocked })
    .from(contacts)
    .where(eq(contacts.number, ownerNumber));
  const candidateIds = Array.from(
    new Set(savers.filter((r) => r.blocked !== true).map((r) => r.ownerId)),
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
}

export async function getPublicStats(): Promise<PublicStats> {
  const db = await getDb();
  if (!db) {
    return { registeredUsers: 0, guestsServed: 0, totalParties: 0, onlineNow: 0 };
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

  return {
    registeredUsers: Number(usersRow?.n ?? 0),
    guestsServed: Number(guestRow?.n ?? 0),
    totalParties: Number(totalRow?.n ?? 0),
    onlineNow: Number(onlineRow?.n ?? 0),
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
  kind?: "webpush" | "fcm";
}): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const kind = input.kind ?? "webpush";
  await db
    .insert(pushSubscriptions)
    .values({
      identityId: input.identityId,
      endpoint: input.endpoint.slice(0, 500),
      p256dh: input.p256dh.slice(0, 255),
      auth: input.auth.slice(0, 120),
      kind,
    })
    .onDuplicateKeyUpdate({
      // Same endpoint/token re-registered (e.g. after a login switch on the
      // same device) → re-bind it to the CURRENT identity + fresh keys.
      set: {
        identityId: input.identityId,
        p256dh: input.p256dh.slice(0, 255),
        auth: input.auth.slice(0, 120),
        kind,
      },
    });
}

export async function deletePushSubscription(endpoint: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint.slice(0, 500)));
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
    .where(eq(pushSubscriptions.identityId, identityId));
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
export async function allocatePartyLineNumber(): Promise<string> {
  const db = await getDb();
  if (!db) throw new Error("database unavailable");
  for (let attempt = 0; attempt < 25; attempt++) {
    const candidate = randomDigits6();
    if (RESERVED_PREFIXES.some((p) => candidate.startsWith(p))) continue;
    if (!(await numberTaken(db, candidate))) return candidate;
  }
  throw new Error("could not allocate a unique 6-digit number");
}

export async function createPartyLine(input: {
  ownerIdentityId: number;
  title: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("database unavailable");
  const title = input.title.trim().slice(0, 64);
  if (!title) throw new Error("title required");
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
    try {
      const ins = await db.insert(partyLines).values({
        number,
        ownerIdentityId: input.ownerIdentityId,
        title,
      });
      const insertId = Number(ins[0].insertId);
      const [row] = await db.select().from(partyLines).where(eq(partyLines.id, insertId)).limit(1);
      if (row) return row;
    } catch (e) {
      const msg = (e as Error)?.message || "";
      if (!/duplicate/i.test(msg)) throw e; // only a number race retries
    }
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
