/**
 * purgeIdentity — the one irreversible destructive path in this codebase.
 *
 * TWO CALLERS, ONE CASCADE. The owner asked for two things that turn out to be
 * the same operation: a guest identity that goes unused for 30 days is deleted
 * automatically, and an admin can *"delete him completely. Whoever he took,
 * whoever he had contact data, everything will delete."* Writing the cascade
 * twice is how the two would come to disagree about what "everything" means, so
 * there is exactly one implementation and the two callers differ only in the
 * PREDICATE that decides who may be selected — which is the whole of the safety
 * argument and therefore lives inside `claimIdentityForPurge`, never in options a
 * caller passes.
 *
 * THREE THINGS ARE DELIBERATELY *NOT* DELETED, because deleting them would do
 * active harm. They are the reason this is a strategy table rather than a list of
 * DELETEs, and each is pinned by a test:
 *
 *   1. `attachments` ROWS ARE KEPT. `authorizeStorageKey` classifies a storage
 *      key with no attachments row as `{kind:"unknown"}`, and the proxy SERVES an
 *      `unknown` key to any signed-in caller — so deleting the row makes the
 *      media MORE readable than leaving it. This is the v2.98.4/F3 defect in a
 *      second place: there F3 was fixed by *keeping* the row on a view-once burn,
 *      for exactly this reason. The row is what holds the object shut, so it stays
 *      as a fail-closed tombstone and the bytes stay with it. Said plainly in the
 *      changelog rather than implied away: this purge does not delete uploaded
 *      media from object storage, because no delete primitive exists here
 *      (`server/storage.ts` exports put/get/sign and nothing else) and inventing
 *      one that half-works would leave media readable rather than gone.
 *
 *   2. THIRD-PARTY `contacts` ROWS THAT SAVED THIS NUMBER ARE KEPT. `blocked`
 *      lives on the contact row and `isNumberBlockedBy` keys on `contacts.number`,
 *      so deleting those rows would silently UNBLOCK whoever had blocked this
 *      person — the v2.99.28/M13 hazard, and a purge must never quietly hand
 *      somebody back a channel they were deliberately denied. The identity's OWN
 *      address book (`contacts.ownerId`) is deleted in full.
 *
 *   3. THE 6-DIGIT NUMBER IS TOMBSTONED, NEVER RELEASED. `number_reservations` is
 *      monotonic on purpose so a number somebody wrote down can never later
 *      connect them to a stranger. Two things make that non-obvious here: the
 *      ledger only exists from v2.99.30, so an older identity may have NO row at
 *      all, and `reapUnclaimedReservations` deletes any row whose number is absent
 *      from both number tables — which is precisely the state a purge creates. So
 *      the FIRST step of the cascade INSERTs the number with `claimedAt` stamped
 *      (the reaper's own guard is `claimedAt IS NULL`), before anything is
 *      destroyed. Without this, purging a pre-ledger guest would put their number
 *      back in circulation.
 *
 * ORDER IS THE SAFETY PROPERTY, not consistency. There are ZERO foreign keys in
 * this schema, so nothing detects an orphan and nothing cascades on our behalf.
 * The steps are therefore ordered so that every intermediate state leaves the
 * identity strictly LESS reachable and less readable than the step before, and
 * the `identities` row is deleted LAST — kill it first and no later pass could
 * ever find the wreckage.
 */
import { and, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import {
  callHistory,
  conferenceHistory,
  conferenceParticipants,
  contacts,
  conversationParticipants,
  conversations,
  emailOtps,
  emailVerifications,
  identities,
  messages,
  onlineWatches,
  partyLines,
  presence,
  pushSubscriptions,
  sessions,
  signaling,
  statusViews,
  statuses,
  users,
} from "../drizzle/schema";
import { getDb } from "./db";

/** How long a guest identity survives without a visit. `touchGuestExpiry` pushes
 *  `guestExpiresAt` forward to now+30d on EVERY visit, so an expiry in the past
 *  means exactly "30 days since they last opened RELAY" — the owner's own figure,
 *  and the reason this needs no second clock. */
export const GUEST_PURGE_DAYS = 30;

/** Identities per sweep. Bounded because this process is `instances: 1` and owns
 *  the in-memory signaling registry and every SSE stream; a sweep that held locks
 *  on `messages` for a long time would stall live users' `listThreads`. */
export const GUEST_PURGE_BATCH = 20;

/**
 * How a column that references an identity is disposed of.
 *
 *   "cascade"      deleted, scoped to this identity.
 *   "keep-safer"   deliberately retained, because deleting it would do HARM.
 *                  Each one carries the finding it comes from.
 *   "redact"       the row is SHARED with people who are not being deleted, so
 *                  the row survives and this person's entry inside it is scrubbed.
 *   "shared-row"   deleted only when no survivor is left in it.
 *   "repair"       not a reference to the identity, but a reference to rows the
 *                  cascade removed; repaired so survivors are not left broken.
 *   "identity"     the identity row itself.
 *   "account"      the `users` row and its credentials — reached only by the ADMIN
 *                  path, because a guest has no account to delete.
 */
export type PurgeStrategy =
  | "cascade"
  | "keep-safer"
  | "redact"
  | "shared-row"
  | "repair"
  | "identity"
  | "account";

/**
 * EVERY column in the schema that names an identity, and what happens to it.
 *
 * This exists to be MACHINE-CHECKED. `identityPurge.test.ts` scans
 * `drizzle/schema.ts` for every column matching the identity-reference shapes and
 * FAILS THE BUILD if any of them has no entry here — the same contract
 * `NUMBER_BEARING_COLUMNS` + `numberContinuity.test.ts` have enforced for the
 * 6-digit number since v2.99.54. It is the only defence against the next table six
 * months from now silently escaping the cascade, and an escaped table is invisible:
 * nothing errors, the rows just sit there naming somebody who no longer exists.
 */
export const IDENTITY_REFERENCING_COLUMNS = [
  { table: "identities", column: "id", strategy: "identity", note: "Deleted LAST, with the claim restated." },
  {
    table: "identities",
    column: "userId",
    strategy: "account",
    note:
      "The link to an account, not a reference TO this identity. It decides whether " +
      "the account half of the cascade runs at all, and it is the guest predicate's " +
      "first conjunct.",
  },
  { table: "presence", column: "identityId", strategy: "cascade", note: "One row, theirs alone." },
  {
    table: "contacts",
    column: "ownerId",
    strategy: "cascade",
    note: "Their own address book.",
  },
  {
    table: "contacts",
    column: "number",
    strategy: "keep-safer",
    note:
      "Rows where SOMEBODY ELSE saved this number. `blocked` lives here and " +
      "isNumberBlockedBy keys on it, so deleting these would silently unblock a " +
      "blocked person (v2.99.28/M13). Kept.",
  },
  {
    table: "conversation_participants",
    column: "identityId",
    strategy: "cascade",
    note:
      "Membership. Deleting it is what removes the thread from the other side's " +
      "inbox — listThreads selects only conversations the caller has a row in.",
  },
  { table: "messages", column: "senderIdentityId", strategy: "cascade", note: "Everything they wrote." },
  {
    table: "messages",
    column: "replyToId",
    strategy: "repair",
    note:
      "A SURVIVOR's message may quote one of theirs. Nulled before the delete so a " +
      "group thread that lives on has no dangling quote.",
  },
  {
    table: "conversation_participants",
    column: "unreadCount",
    strategy: "repair",
    note:
      "A stored counter, so removing messages from a surviving group leaves other " +
      "members' badges too high. RECOMPUTED, never decremented — a decrement is not " +
      "idempotent and a retried sweep would drive it negative (the v2.99.74 lesson).",
  },
  {
    table: "conversations",
    column: "id",
    strategy: "shared-row",
    note:
      "A DM is between two people, one of whom is going — the thread goes with them. " +
      "A GROUP survives for its other members and is deleted only when nobody is left.",
  },
  {
    table: "attachments",
    column: "uploadedByIdentityId",
    strategy: "keep-safer",
    note:
      "KEPT. authorizeStorageKey classifies a key with no row as `unknown`, which the " +
      "storage proxy SERVES — so deleting the row makes the media readable rather " +
      "than gone (the v2.98.4/F3 defect). The row is the lock.",
  },
  { table: "statuses", column: "identityId", strategy: "cascade", note: "Their stories." },
  { table: "status_views", column: "viewerId", strategy: "cascade", note: "Stories they viewed." },
  { table: "call_history", column: "callerIdentityId", strategy: "cascade", note: "Solo calls they placed." },
  { table: "call_history", column: "calleeIdentityId", strategy: "cascade", note: "Solo calls they received." },
  { table: "conference_participants", column: "identityId", strategy: "cascade", note: "Their conference join rows." },
  {
    table: "conference_participants",
    column: "number",
    strategy: "cascade",
    note: "Rides the join row it sits on; scoped by identityId.",
  },
  {
    table: "conference_history",
    column: "participants",
    strategy: "redact",
    note:
      "One SHARED row per call room, carrying a frozen name+number roster. Survivors " +
      "did not consent to lose their call log, so the row stays and this person's " +
      "entry is scrubbed. The row is deleted only when nobody else was on the call.",
  },
  { table: "push_subscriptions", column: "identityId", strategy: "cascade", note: "Their devices." },
  { table: "online_watches", column: "watcherId", strategy: "cascade", note: "Comebacks they were waiting for." },
  { table: "online_watches", column: "targetId", strategy: "cascade", note: "People waiting for THEIR comeback." },
  {
    table: "party_lines",
    column: "ownerIdentityId",
    strategy: "cascade",
    note:
      "A line they created. Flagged loudly: a line is a shared room other people " +
      "dial, so this ends something third parties use.",
  },
  { table: "party_lines", column: "number", strategy: "cascade", note: "Rides the line row; tombstoned in the ledger." },
  { table: "signaling", column: "fromIdentityId", strategy: "cascade", note: "Unused mailbox table; swept defensively." },
  { table: "signaling", column: "toIdentityId", strategy: "cascade", note: "Same." },
  {
    table: "sessions",
    column: "userId",
    strategy: "account",
    note: "ADMIN path only — a guest has no sessions. Ends every signed-in device.",
  },
  {
    table: "email_verifications",
    column: "userId",
    strategy: "account",
    note: "ADMIN path only.",
  },
  {
    table: "users",
    column: "id",
    strategy: "account",
    note:
      "ADMIN path only, and deleted LAST of all. Without it the person signs in " +
      "again with the same email and is handed a fresh identity, so 'deleted " +
      "completely' would be untrue within a minute.",
  },
] as const;

/** A roster entry as `recordConferenceEnd` writes it. */
export type RosterEntry = { number?: string | null; name?: string | null; identityId?: number | null };

/**
 * Remove one person from a frozen conference roster, PURELY.
 *
 * Matches on `identityId` first because that is the only stable handle; falls back
 * to the number for a legacy entry written before rosters carried ids. Anything it
 * cannot parse is passed through untouched rather than dropped — a roster is
 * somebody else's call log and losing an unrelated entry to a defensive `filter`
 * would be a worse outcome than leaving one stale name.
 */
export function redactRoster(
  roster: unknown,
  identityId: number,
  number: string | null | undefined
): { roster: RosterEntry[]; removed: number } {
  if (!Array.isArray(roster)) return { roster: [], removed: 0 };
  const keep: RosterEntry[] = [];
  let removed = 0;
  for (const raw of roster) {
    if (!raw || typeof raw !== "object") {
      keep.push(raw as RosterEntry);
      continue;
    }
    const e = raw as RosterEntry;
    const byId = typeof e.identityId === "number" && e.identityId === identityId;
    // Only fall back to the number when the entry has NO id — an entry that names
    // a DIFFERENT id and happens to share a number (a renumber, a reissued line)
    // is somebody else, and matching it would delete a stranger from the log.
    const byNumber =
      e.identityId == null && !!number && typeof e.number === "string" && e.number === number;
    if (byId || byNumber) {
      removed++;
      continue;
    }
    keep.push(e);
  }
  return { roster: keep, removed };
}

/** One conversation the identity belongs to, and who else is in it. */
export type ConversationMembership = { conversationId: number; kind: string | null; others: number };

/**
 * Decide, per conversation, whether the whole thread goes or only this person's
 * part of it. Pure, because this is the branch with a real blast radius: getting
 * it wrong either destroys a six-person group over one lapsed guest, or leaves a
 * DM thread half-visible in somebody's inbox.
 *
 * A DM always goes whole — it is a thread between two people and one of them is
 * being deleted, so nothing about it survives meaningfully, and the owner asked
 * for the other side to lose it. A GROUP goes only when it would otherwise be
 * empty; while anyone remains it is theirs, and they did not ask to lose it.
 */
export function planConversationPurge(rows: ConversationMembership[]): {
  deleteWhole: number[];
  trim: number[];
} {
  const deleteWhole: number[] = [];
  const trim: number[] = [];
  for (const r of rows) {
    if (r.kind === "group" && r.others > 0) trim.push(r.conversationId);
    else deleteWhole.push(r.conversationId);
  }
  return { deleteWhole, trim };
}

/**
 * Whole days until a guest identity is purged, for the notice beside the blue
 * badge. Returns null — the field is OMITTED, never 0 — for anything that is not
 * an expiring guest, so a registered account cannot render a countdown.
 *
 * Floors rather than rounds, and clamps at 0: "1 day left" must not appear for
 * something 20 minutes from the cutoff, and a row already past it reads 0 rather
 * than a negative number the UI would have to special-case.
 */
export function guestDaysLeft(
  guestExpiresAt: Date | string | null | undefined,
  now: Date = new Date()
): number | null {
  if (!guestExpiresAt) return null;
  const at = guestExpiresAt instanceof Date ? guestExpiresAt : new Date(guestExpiresAt);
  const ms = at.getTime();
  if (!Number.isFinite(ms)) return null;
  const left = Math.floor((ms - now.getTime()) / (24 * 60 * 60 * 1000));
  if (left <= 0) return 0;
  return Math.min(left, GUEST_PURGE_DAYS);
}

/** Which caller is asking, and therefore which predicate guards the claim. */
export type PurgeGuard = "guest-expired" | "admin";

export type PurgeOutcome =
  | { ok: true; identityId: number; number: string | null; hadAccount: boolean }
  | { ok: false; reason: "not-eligible" | "not-found" | "unavailable" };

/**
 * Claim an identity for purging: ONE atomic conditional UPDATE that both decides
 * eligibility and makes the row unusable.
 *
 * Doing those two things in one statement is the whole design. The verdict comes
 * from `affectedRows`, so two instances cannot both claim the same row (the
 * `claimMissedCallEmail` / `burnExpiringMessage` pattern), and the same statement
 * NULLs all three handles that could resurrect the identity — `guestToken`,
 * `deviceId` and `recoveryHash` — so from the instant it commits, no resolver in
 * `createContext`, no guest cookie and no Adopt-and-Retire recovery key can land
 * a live request on a row that is being destroyed. Holding a long lock instead
 * would have blocked `messages.send` for everybody in the meantime.
 *
 * The guest predicate is written HERE rather than passed in. Both callers ask a
 * different question ("has this guest lapsed" vs "did an admin name this person")
 * and one boolean serving two questions is the mistake CLAUDE.md records for
 * `isOnline`; a caller that could supply its own WHERE would be a caller that
 * could delete a registered account by accident.
 */
export async function claimIdentityForPurge(
  identityId: number,
  guard: PurgeGuard
): Promise<{ ok: boolean; row?: { number: string | null; userId: number | null } }> {
  const db = await getDb();
  if (!db) return { ok: false };
  // Read first, so the caller can tombstone the NUMBER before anything is
  // destroyed. The read is only for that: eligibility is decided by the UPDATE.
  const [before] = await db
    .select({ number: identities.number, userId: identities.userId })
    .from(identities)
    .where(eq(identities.id, identityId))
    .limit(1);
  if (!before) return { ok: false };

  const claim =
    guard === "guest-expired"
      ? sql`UPDATE \`identities\`
               SET \`purgeStartedAt\` = NOW(),
                   \`guestToken\` = NULL,
                   \`deviceId\` = NULL,
                   \`recoveryHash\` = NULL
             WHERE \`id\` = ${identityId}
               AND \`purgeStartedAt\` IS NULL
               AND \`userId\` IS NULL
               AND (\`verified\` IS NULL OR \`verified\` = 0)
               AND \`guestExpiresAt\` IS NOT NULL
               AND \`guestExpiresAt\` < NOW()`
      : sql`UPDATE \`identities\`
               SET \`purgeStartedAt\` = NOW(),
                   \`guestToken\` = NULL,
                   \`deviceId\` = NULL,
                   \`recoveryHash\` = NULL
             WHERE \`id\` = ${identityId}
               AND \`purgeStartedAt\` IS NULL`;
  const res: any = await db.execute(claim);
  const affected = Number(res?.[0]?.affectedRows ?? res?.affectedRows ?? 0);
  if (affected !== 1) return { ok: false };
  return { ok: true, row: { number: before.number ?? null, userId: before.userId ?? null } };
}

/**
 * Tombstone a 6-digit number so it can never be handed to a stranger.
 *
 * `ON DUPLICATE KEY UPDATE ... COALESCE` rather than a plain overwrite, because a
 * number minted since v2.99.30 already has a row with the moment it was really
 * claimed and rewriting that would lose it. There is deliberately no DELETE here
 * and none anywhere near this file: the ledger is monotonic, and the one existing
 * deleter (`reapUnclaimedReservations`) is guarded on `claimedAt IS NULL`, which
 * this stamp is what defeats.
 */
export async function tombstoneNumber(number: string | null | undefined): Promise<void> {
  if (!number) return;
  const db = await getDb();
  if (!db) return;
  try {
    await db.execute(sql`
      INSERT INTO \`number_reservations\` (\`number\`, \`claimedAt\`)
      VALUES (${number}, NOW())
      ON DUPLICATE KEY UPDATE \`claimedAt\` = COALESCE(\`claimedAt\`, NOW())`);
  } catch (e) {
    // Deliberately loud but non-fatal: the reservation table is created by the
    // boot migrator, and a purge must not be blocked by its absence — but a
    // number that failed to tombstone is the one outcome worth a log line.
    console.warn("[purge] number tombstone failed:", number, (e as Error)?.message || "");
  }
}

/**
 * Delete an identity and everything hanging off it. Assumes the caller has
 * already WON the claim — this function does not decide eligibility, which is why
 * it is not exported for general use and both entry points below go through the
 * claim first.
 */
async function cascade(identityId: number, number: string | null, userId: number | null): Promise<void> {
  const db = await getDb();
  if (!db) return;

  // ── 1. Reachability first: nothing can ring, alert or notify this person again.
  await db.delete(onlineWatches).where(
    or(eq(onlineWatches.watcherId, identityId), eq(onlineWatches.targetId, identityId))
  );
  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.identityId, identityId));
  await db.delete(presence).where(eq(presence.identityId, identityId));
  await db.delete(signaling).where(
    or(eq(signaling.fromIdentityId, identityId), eq(signaling.toIdentityId, identityId))
  );

  // ── 2. Their own content and their own view of everyone else's.
  const ownStatuses = await db
    .select({ id: statuses.id })
    .from(statuses)
    .where(eq(statuses.identityId, identityId));
  if (ownStatuses.length > 0) {
    const ids = ownStatuses.map((s) => s.id);
    await db.delete(statusViews).where(inArray(statusViews.statusId, ids));
    await db.delete(statuses).where(inArray(statuses.id, ids));
  }
  await db.delete(statusViews).where(eq(statusViews.viewerId, identityId));
  await db.delete(contacts).where(eq(contacts.ownerId, identityId));
  await db.delete(partyLines).where(eq(partyLines.ownerIdentityId, identityId));
  await db
    .delete(callHistory)
    .where(
      or(eq(callHistory.callerIdentityId, identityId), eq(callHistory.calleeIdentityId, identityId))
    );

  // ── 3. Conferences: a SHARED row, so redact rather than delete while anyone else
  //      was on the call. Bounded; a person with more conference rows than this has
  //      the remainder left as an inert roster entry, which is a stale name rather
  //      than a reachable reference.
  const myConfs = await db
    .select({ conferenceId: conferenceParticipants.conferenceId })
    .from(conferenceParticipants)
    .where(eq(conferenceParticipants.identityId, identityId))
    .limit(1000);
  await db.delete(conferenceParticipants).where(eq(conferenceParticipants.identityId, identityId));
  for (const { conferenceId } of myConfs) {
    try {
      const survivors = await db
        .select({ id: conferenceParticipants.id })
        .from(conferenceParticipants)
        .where(eq(conferenceParticipants.conferenceId, conferenceId))
        .limit(1);
      if (survivors.length === 0) {
        await db.delete(conferenceHistory).where(eq(conferenceHistory.id, conferenceId));
        continue;
      }
      const [row] = await db
        .select({ participants: conferenceHistory.participants })
        .from(conferenceHistory)
        .where(eq(conferenceHistory.id, conferenceId))
        .limit(1);
      if (!row) continue;
      const { roster, removed } = redactRoster(row.participants, identityId, number);
      if (removed > 0) {
        await db
          .update(conferenceHistory)
          .set({ participants: roster })
          .where(eq(conferenceHistory.id, conferenceId));
      }
    } catch {
      /* one conference is not worth abandoning the purge for */
    }
  }

  // ── 4. Conversations. The branch with the real blast radius, so the decision is
  //      made by the pure planner above and this only executes it.
  const myConvs = await db
    .select({ conversationId: conversationParticipants.conversationId, kind: conversations.kind })
    .from(conversationParticipants)
    .innerJoin(conversations, eq(conversations.id, conversationParticipants.conversationId))
    .where(eq(conversationParticipants.identityId, identityId));
  const memberships: ConversationMembership[] = [];
  for (const c of myConvs) {
    const others = await db
      .select({ identityId: conversationParticipants.identityId })
      .from(conversationParticipants)
      .where(
        and(
          eq(conversationParticipants.conversationId, c.conversationId),
          ne(conversationParticipants.identityId, identityId)
        )
      );
    memberships.push({ conversationId: c.conversationId, kind: c.kind ?? null, others: others.length });
  }
  const { deleteWhole, trim } = planConversationPurge(memberships);

  for (const conversationId of deleteWhole) {
    await db.delete(messages).where(eq(messages.conversationId, conversationId));
    await db
      .delete(conversationParticipants)
      .where(eq(conversationParticipants.conversationId, conversationId));
    await db.delete(conversations).where(eq(conversations.id, conversationId));
  }

  for (const conversationId of trim) {
    // A survivor's message may quote one of theirs — null those FIRST, or the
    // group thread lives on with a quote bar pointing at a row that is gone.
    await db.execute(sql`
      UPDATE \`messages\` m
         SET m.\`replyToId\` = NULL
       WHERE m.\`conversationId\` = ${conversationId}
         AND m.\`replyToId\` IN (
           SELECT x.\`id\` FROM (
             SELECT \`id\` FROM \`messages\`
              WHERE \`conversationId\` = ${conversationId}
                AND \`senderIdentityId\` = ${identityId}
           ) x
         )`);
    await db
      .delete(messages)
      .where(and(eq(messages.conversationId, conversationId), eq(messages.senderIdentityId, identityId)));
    await db
      .delete(conversationParticipants)
      .where(
        and(
          eq(conversationParticipants.conversationId, conversationId),
          eq(conversationParticipants.identityId, identityId)
        )
      );
    // RECOMPUTE, never decrement. A retried sweep must land on the same number,
    // and `unreadCount` is a stored counter that a decrement would drive negative.
    await db.execute(sql`
      UPDATE \`conversation_participants\` cp
         SET cp.\`unreadCount\` = (
           SELECT COUNT(*) FROM \`messages\` m
            WHERE m.\`conversationId\` = cp.\`conversationId\`
              AND m.\`senderIdentityId\` <> cp.\`identityId\`
              AND (cp.\`lastReadMessageId\` IS NULL OR m.\`id\` > cp.\`lastReadMessageId\`)
         )
       WHERE cp.\`conversationId\` = ${conversationId}`);
  }

  // ── 5. The identity itself, LAST, with the claim restated so a row somebody
  //      un-claimed underneath us survives instead of being deleted unclaimed.
  await db.execute(sql`
    DELETE FROM \`identities\`
     WHERE \`id\` = ${identityId}
       AND \`purgeStartedAt\` IS NOT NULL`);

  // ── 6. The ACCOUNT, only when there is one. Without this an admin "delete"
  //      lasts until the person signs in again with the same email and is handed a
  //      brand-new identity, which is not what "delete him completely" means.
  if (userId != null) {
    const [acct] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
    await db.delete(sessions).where(eq(sessions.userId, userId));
    await db.delete(emailVerifications).where(eq(emailVerifications.userId, userId));
    if (acct?.email) {
      await db.delete(emailOtps).where(eq(emailOtps.email, acct.email));
    }
    await db.delete(users).where(eq(users.id, userId));
  }
}

/**
 * ADMIN: delete this person completely.
 *
 * Refuses to delete the acting admin's own identity, for the same reason
 * `setIdentityAccountType` refuses a self-demotion: the one action nobody can undo
 * for you is the one you take against yourself, and an admin who deletes their own
 * account may leave an installation with no admin at all.
 */
export async function adminPurgeIdentity(
  identityId: number,
  actingIdentityId: number | null
): Promise<PurgeOutcome> {
  const db = await getDb();
  if (!db) return { ok: false, reason: "unavailable" };
  if (actingIdentityId != null && actingIdentityId === identityId) {
    return { ok: false, reason: "not-eligible" };
  }
  try {
    const claimed = await claimIdentityForPurge(identityId, "admin");
    if (!claimed.ok || !claimed.row) return { ok: false, reason: "not-found" };
    await tombstoneNumber(claimed.row.number);
    await cascade(identityId, claimed.row.number, claimed.row.userId);
    return {
      ok: true,
      identityId,
      number: claimed.row.number,
      hadAccount: claimed.row.userId != null,
    };
  } catch (e) {
    console.warn("[purge] admin purge failed:", identityId, (e as Error)?.message || "");
    return { ok: false, reason: "unavailable" };
  }
}

/** Three states, one variable: off (the default), a dry run, or armed. */
export type GuestPurgeMode = "off" | "dry" | "on";

/**
 * Read the guest-purge switch. DEFAULT IS OFF, and that is not timidity: this is
 * the only unattended irreversible destructive path in the codebase, nobody can
 * count the eligible rows from outside production, and every comparable operator
 * tool here (`aws-ops` `recover_apply`, `admin-tool.mjs`) defaults to not writing.
 * The `dry` setting exists so the first honest number comes from a log rather than
 * from a design document.
 */
export function guestPurgeMode(): GuestPurgeMode {
  const v = (process.env.RELAY_GUEST_PURGE || "").trim().toLowerCase();
  if (v === "1" || v === "true" || v === "on") return "on";
  if (v === "dry" || v === "dryrun" || v === "dry-run") return "dry";
  return "off";
}

/**
 * Sweep lapsed guest identities. Returns how many were purged (0 in `dry`, where
 * it logs what it WOULD have done and touches nothing).
 *
 * The SELECT restates the eligibility predicate even though the claim restates it
 * again, because the claim can only be trusted for the row it names — selecting
 * broadly and relying on the claim to refuse would put registered identities
 * through this function and make the safety argument rest on a single WHERE.
 */
export async function reapExpiredGuests(): Promise<number> {
  const mode = guestPurgeMode();
  if (mode === "off") return 0;
  const db = await getDb();
  if (!db) return 0;
  let due: Array<{ id: number; number: string; displayName: string }> = [];
  try {
    due = await db
      .select({ id: identities.id, number: identities.number, displayName: identities.displayName })
      .from(identities)
      .where(
        and(
          isNull(identities.userId),
          isNull(identities.purgeStartedAt),
          sql`(\`verified\` IS NULL OR \`verified\` = 0)`,
          sql`\`guestExpiresAt\` IS NOT NULL`,
          sql`\`guestExpiresAt\` < NOW()`
        )
      )
      .limit(GUEST_PURGE_BATCH);
  } catch (e) {
    console.warn("[guest purge] select failed:", (e as Error)?.message || "");
    return 0;
  }
  if (due.length === 0) return 0;
  if (mode === "dry") {
    // Numbers and ids only — a log line is not a place for display names.
    console.warn(
      `[guest purge] DRY RUN — would purge ${due.length} lapsed guest identit${due.length === 1 ? "y" : "ies"}:`,
      due.map((d) => `#${d.id}/${d.number}`).join(" ")
    );
    return 0;
  }
  let purged = 0;
  for (const row of due) {
    try {
      const claimed = await claimIdentityForPurge(row.id, "guest-expired");
      if (!claimed.ok || !claimed.row) continue; // raced, or no longer eligible
      await tombstoneNumber(claimed.row.number);
      await cascade(row.id, claimed.row.number, claimed.row.userId);
      purged++;
    } catch (e) {
      // One bad row must not stop the sweep; the claim stays stamped, so the row
      // is inert and a later pass will not re-select it (purgeStartedAt IS NULL).
      console.warn("[guest purge] identity failed:", row.id, (e as Error)?.message || "");
    }
  }
  if (purged > 0) console.warn(`[guest purge] purged ${purged} lapsed guest identities`);
  return purged;
}
