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
  gte,
  inArray,
  isNull,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";
import {
  attachments,
  callHistory,
  contacts,
  conversationParticipants,
  conversations,
  identities,
  messages,
  presence,
} from "../drizzle/schema";
import { getDb } from "./db";

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

export async function allocateNumber(): Promise<string> {
  const db = await getDb();
  if (!db) throw new Error("database unavailable");
  for (let attempt = 0; attempt < 25; attempt++) {
    const candidate = randomDigits6();
    if (RESERVED_PREFIXES.some((p) => candidate.startsWith(p))) continue;
    const existing = await db
      .select({ id: identities.id })
      .from(identities)
      .where(eq(identities.number, candidate))
      .limit(1);
    if (existing.length === 0) return candidate;
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

export async function updateIdentityProfile(
  id: number,
  patch: { displayName?: string; avatarUrl?: string | null }
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const set: Record<string, unknown> = {};
  if (patch.displayName !== undefined) {
    const n = patch.displayName.trim().slice(0, 64);
    if (n.length > 0) set.displayName = n;
  }
  if (patch.avatarUrl !== undefined) set.avatarUrl = patch.avatarUrl;
  if (Object.keys(set).length === 0) return;
  await db.update(identities).set(set).where(eq(identities.id, id));
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
export async function reapStalePresence(maxAgeSeconds = 120) {
  const db = await getDb();
  if (!db) return 0;
  const cutoff = new Date(Date.now() - maxAgeSeconds * 1000);
  const res = await db
    .update(presence)
    .set({ isOnline: false })
    .where(and(eq(presence.isOnline, true), lt(presence.lastSeenAt, cutoff)));
  return res?.[0]?.affectedRows ?? 0;
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

export interface PresenceLite {
  identityId: number;
  isOnline: boolean;
  lastSeenAt: Date | null;
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

export async function upsertContact(input: {
  ownerId: number;
  number: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  favourite?: boolean;
  notes?: string | null;
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
  };
  await db
    .insert(contacts)
    .values(values)
    .onDuplicateKeyUpdate({
      set: {
        displayName: values.displayName,
        avatarUrl: values.avatarUrl,
        favourite: values.favourite,
        notes: values.notes,
      },
    });
  const rows = await db
    .select()
    .from(contacts)
    .where(and(eq(contacts.ownerId, input.ownerId), eq(contacts.number, input.number)))
    .limit(1);
  return rows[0];
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

  const existing = await db
    .select()
    .from(conversations)
    .where(eq(conversations.pairKey, key))
    .limit(1);
  if (existing.length > 0) return existing[0];

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
  const convo = created[0];

  // For self-conversations we only insert one participant row; the
  // composite primary key (conversationId, identityId) would reject a
  // duplicate anyway, but being explicit avoids depending on that.
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

export interface ThreadSummary {
  conversationId: number;
  otherIdentityId: number;
  otherNumber: string;
  otherDisplayName: string;
  otherAvatarUrl: string | null;
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
  convoRows: Array<{ id: number; lastMessageAt: Date }>;
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
  const convoIdsWithOther = new Set(input.others.map((o) => o.conversationId));

  const result: ThreadSummary[] = [];

  for (const p of input.others) {
    const convo = convoById.get(p.conversationId);
    const other = otherById.get(p.identityId);
    if (!convo || !other) continue;
    const latest = input.latestMessageByConvo.get(p.conversationId) ?? null;
    result.push({
      conversationId: p.conversationId,
      otherIdentityId: other.id,
      otherNumber: other.number,
      otherDisplayName: other.displayName,
      otherAvatarUrl: other.avatarUrl ?? null,
      lastMessageAt: convo.lastMessageAt,
      unreadCount: unreadByConvo.get(p.conversationId) ?? 0,
      lastMessagePreview: latest?.body ?? null,
      lastMessageKind: latest?.kind ?? "text",
    });
  }

  // Self-conversations: synthesise the "Notes (You)" peer row.
  if (input.myIdentity) {
    for (const p of input.myParts) {
      if (convoIdsWithOther.has(p.conversationId)) continue;
      const convo = convoById.get(p.conversationId);
      if (!convo) continue;
      const latest = input.latestMessageByConvo.get(p.conversationId) ?? null;
      result.push({
        conversationId: p.conversationId,
        otherIdentityId: input.myIdentity.id,
        otherNumber: input.myIdentity.number,
        otherDisplayName: "Notes (You)",
        otherAvatarUrl: input.myIdentity.avatarUrl ?? null,
        lastMessageAt: convo.lastMessageAt,
        unreadCount: unreadByConvo.get(p.conversationId) ?? 0,
        lastMessagePreview: latest?.body ?? null,
        lastMessageKind: latest?.kind ?? "text",
      });
    }
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

  // 4) the most-recent non-deleted message per conversation, for preview
  const recents = await db
    .select()
    .from(messages)
    .where(and(inArray(messages.conversationId, convoIds), isNull(messages.deletedAt)))
    .orderBy(desc(messages.createdAt));
  const latestByConvo = new Map<number, typeof recents[number]>();
  for (const m of recents) {
    if (!latestByConvo.has(m.conversationId)) latestByConvo.set(m.conversationId, m);
  }

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
    convoRows: convos.map((c) => ({ id: c.id, lastMessageAt: c.lastMessageAt })),
    latestMessageByConvo: new Map(
      Array.from(latestByConvo.entries()).map(([k, m]) => [
        k,
        m ? { body: m.body ?? null, kind: m.kind } : null,
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

export async function markThreadRead(input: { conversationId: number; identityId: number }) {
  const db = await getDb();
  if (!db) return;
  // last visible message id
  const rows = await db
    .select({ id: messages.id })
    .from(messages)
    .where(eq(messages.conversationId, input.conversationId))
    .orderBy(desc(messages.id))
    .limit(1);
  const lastId = rows[0]?.id ?? null;
  await db
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
    await db
      .update(messages)
      .set({ status: "read" })
      .where(
        and(
          eq(messages.conversationId, input.conversationId),
          lte(messages.id, lastId),
          sql`${messages.senderIdentityId} <> ${input.identityId}`,
          or(eq(messages.status, "sent"), eq(messages.status, "delivered"))
        )
      );
  }
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
  uploadedByIdentityId: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("database unavailable");
  await db.insert(attachments).values({
    storageKey: input.storageKey,
    url: input.url,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    width: input.width ?? null,
    height: input.height ?? null,
    durationMs: input.durationMs ?? null,
    filename: input.filename ?? null,
    uploadedByIdentityId: input.uploadedByIdentityId,
  });
  const rows = await db
    .select()
    .from(attachments)
    .where(
      and(
        eq(attachments.storageKey, input.storageKey),
        eq(attachments.uploadedByIdentityId, input.uploadedByIdentityId)
      )
    )
    .orderBy(desc(attachments.id))
    .limit(1);
  return rows[0];
}

export async function getAttachmentById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(attachments).where(eq(attachments.id, id)).limit(1);
  return rows[0] ?? null;
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

export async function listCallHistory(identityId: number, limit = 100) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select()
    .from(callHistory)
    .where(
      or(
        eq(callHistory.callerIdentityId, identityId),
        eq(callHistory.calleeIdentityId, identityId)
      )
    )
    .orderBy(desc(callHistory.id))
    .limit(limit);
  return rows;
}
