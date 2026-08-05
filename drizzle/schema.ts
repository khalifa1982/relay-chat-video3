import {
  bigint,
  boolean,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

/* ──────────────────────────────────────────────────────────────────────────
 * users — registered (OAuth) accounts. Kept compatible with the template.
 * ────────────────────────────────────────────────────────────────────────── */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per
   *  user. Self-hosted email/password accounts get a synthetic `local:<rand>`. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  /* Self-hosted email/password auth (v2.54). Additive + nullable, applied to the
     live DB by `ensureSchemaExtensions()`. Null for OAuth-only accounts. */
  /** scrypt password hash (`scrypt$N$salt$hash`) for email/password accounts. */
  passwordHash: text("passwordHash"),
  /** True once the email-verification link has been clicked (local flow). */
  emailVerified: boolean("emailVerified"),
  /* 4-digit login PIN (v2.87). Additive + nullable via ensureSchemaExtensions().
     Three wrong entries warn; the fourth locks (loginPinLockedAt) until an
     email-code sign-in unlocks. */
  loginPinHash: text("loginPinHash"),
  loginPinAttempts: int("loginPinAttempts"),
  loginPinLockedAt: timestamp("loginPinLockedAt"),
  preferPinLogin: boolean("preferPinLogin"),
  /* Password-login attempt ladder (v2.99.49), closing the v2.99.20 residual
     "no per-account password-login lockout (only per-IP)". Additive + nullable
     via ensureSchemaExtensions(); NULL = never failed.
     DELIBERATELY SEPARATE from the loginPin* pair: sharing those columns would
     let a password brute-force lock out PIN sign-in — which IS a live UI path —
     so the fix would introduce a cross-channel denial of service. */
  loginPwAttempts: int("loginPwAttempts"),
  loginPwLockedAt: timestamp("loginPwLockedAt"),
  /* Email-notification preferences (v2.99.13). Additive + nullable via
     ensureSchemaExtensions(). NULL is treated as ENABLED (the historical
     default — the missed-call email always sent), so existing users keep
     getting emails; a user disables by storing false. */
  /** Email me when I miss a call while offline. NULL/true = on, false = off. */
  emailNotifyMissedCall: boolean("emailNotifyMissedCall"),
  /** Email me (content-free) when I get a message while offline. NULL/true = on. */
  emailNotifyMessage: boolean("emailNotifyMessage"),
  /** Cooldown watermark: last time we sent an offline-message email to this
   *  user, so N messages while away don't produce N emails. */
  lastMessageEmailAt: timestamp("lastMessageEmailAt"),
  /* Notification preferences + email budget (v2.99.40). Additive + nullable via
     ensureSchemaExtensions(); NULL = enabled, matching the columns above. */
  /** Master switch for Web Push / FCM notifications. NULL/true = on, false =
   *  off. A user can revoke at the browser level too, but that is invisible to
   *  us and not portable across their devices — this is the in-app control. */
  pushEnabled: boolean("pushEnabled"),
  /** Day (UTC, midnight-truncated) that `messageEmailsToday` counts. */
  messageEmailDay: timestamp("messageEmailDay"),
  /** Cooldown watermark for the missed-call email (v2.99.44). Deliberately a
   *  cooldown with NO daily cap, unlike the message nudge: a missed call is a
   *  first-class event and suppressing the tenth one could hide the one that
   *  mattered. Repeated dialling past this is harassment, which blocking already
   *  shuts off — a blocked caller reaches neither the push nor this email. */
  lastMissedCallEmailAt: timestamp("lastMissedCallEmailAt"),
  /** Offline-message emails already sent on `messageEmailDay`. Hard-capped, so
   *  a busy day can never turn RELAY into a mail flood (and can never put the
   *  SES reputation at risk). Reset implicitly when the day rolls over. */
  messageEmailsToday: int("messageEmailsToday"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});
export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/* ──────────────────────────────────────────────────────────────────────────
 * email_verifications — one-time tokens for the self-hosted registration flow.
 * A row is minted on register / resend; clicking the link consumes it and flips
 * users.emailVerified. Created by the boot-migrator (CREATE TABLE IF NOT EXISTS).
 * ────────────────────────────────────────────────────────────────────────── */
export const emailVerifications = mysqlTable(
  "email_verifications",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    email: varchar("email", { length: 320 }).notNull(),
    token: varchar("token", { length: 128 }).notNull(),
    expiresAt: timestamp("expiresAt").notNull(),
    consumedAt: timestamp("consumedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => ({
    tokenIdx: uniqueIndex("email_verif_token_unique").on(t.token),
    userIdx: index("email_verif_user_idx").on(t.userId),
  }),
);
export type EmailVerification = typeof emailVerifications.$inferSelect;

/* ──────────────────────────────────────────────────────────────────────────
 * email_otps — short-lived one-time codes for passwordless email login (v2.68).
 * A row is minted on requestOtp / register / resend BEFORE a user necessarily
 * exists (hence no userId here, unlike email_verifications). The 6-digit code is
 * stored HASHED (scrypt), never plaintext; expiry ~10 min, attempts capped, and
 * the row is burned on consume or too many failures. Created by the boot-migrator.
 * ────────────────────────────────────────────────────────────────────────── */
export const emailOtps = mysqlTable(
  "email_otps",
  {
    id: int("id").autoincrement().primaryKey(),
    email: varchar("email", { length: 320 }).notNull(),
    /** scrypt hash of the 6-digit code (`scrypt$N$salt$hash`, ~174 chars). */
    codeHash: varchar("codeHash", { length: 255 }).notNull(),
    /** "login" (existing account) or "register" (carries the pending name). */
    purpose: varchar("purpose", { length: 16 }).notNull().default("login"),
    firstName: varchar("firstName", { length: 64 }),
    lastName: varchar("lastName", { length: 64 }),
    expiresAt: timestamp("expiresAt").notNull(),
    attempts: int("attempts").notNull().default(0),
    consumedAt: timestamp("consumedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => ({
    emailIdx: index("email_otps_email_idx").on(t.email),
    expiresIdx: index("email_otps_expires_idx").on(t.expiresAt),
  }),
);
export type EmailOtp = typeof emailOtps.$inferSelect;

/* ──────────────────────────────────────────────────────────────────────────
 * identities — every "party" on RELAY, whether a guest or a registered user.
 *
 * A guest gets an identity row immediately (no `userId`). If they later upgrade
 * via OAuth, the same identity row stays (preserving their number, contacts,
 * messages, call history) and `userId` is filled in.
 *
 * `number` is the public 6-digit RELAY number. We index it uniquely so calls
 * can resolve a destination by number alone.
 * ────────────────────────────────────────────────────────────────────────── */
export const identities = mysqlTable(
  "identities",
  {
    id: int("id").autoincrement().primaryKey(),
    /** 6-digit RELAY number (zero-padded string, e.g. "482015"). */
    number: varchar("number", { length: 6 }).notNull(),
    /** Display name chosen by the user (guests pick this on landing). */
    displayName: varchar("displayName", { length: 64 }).notNull(),
    /** Optional avatar URL (stored via /manus-storage/...). */
    avatarUrl: text("avatarUrl"),
    /** If the identity has been upgraded to a registered user, link here. */
    userId: int("userId"),
    /** Guest cookie token (random 32-byte hex). Null once upgraded. */
    guestToken: varchar("guestToken", { length: 64 }),
    /** When the guest cookie expires (30 days from creation or last refresh). */
    guestExpiresAt: timestamp("guestExpiresAt"),
    /**
     * Stable per-browser device id, generated by the client and stored in
     * localStorage. Survives across cookie clears, IP changes, and network
     * swaps. This is what makes the guest session truly sticky — on a fresh
     * `whoami` without a cookie, we can still resolve the identity by
     * device id (if the client provides it via the `x-relay-device-id`
     * header). Format is a random 16-byte hex string (32 chars).
     */
    deviceId: varchar("deviceId", { length: 64 }),
    /* Profile-hub fields (v2.52). Additive + nullable, applied to existing DBs at
       boot by `ensureSchemaExtensions()` (idempotent ADD COLUMN), same contract
       as the contacts rich fields. */
    /** Short "about me" line shown on the profile. */
    bio: text("bio"),
    /** Manual status override: "away" | "travel" | null/"" (= auto from presence). */
    statusOverride: varchar("statusOverride", { length: 16 }),
    /** JSON array of optional mobile numbers (strings). */
    mobiles: text("mobiles"),
    /** JSON array of { platform, value } social/link entries. */
    socials: text("socials"),
    /** True once the identity's owner has completed email verification (OTP or
     *  the legacy email+password link flow). Drives the "blue badge". Additive +
     *  nullable; NULL is treated as unverified. Backfilled at boot for existing
     *  emailVerified accounts. */
    verified: boolean("verified"),
    /** Given/family name captured at passwordless registration (v2.68). */
    firstName: varchar("firstName", { length: 64 }),
    lastName: varchar("lastName", { length: 64 }),
    /**
     * Away auto-reply, OPT-IN (v2.99.66). When a 1:1 message arrives while this
     * identity is offline, RELAY can post one "…is away right now" line back so
     * the sender knows not to wait. It used to fire for everyone unconditionally;
     * the owner asked for it to be the user's choice ("you should allow the user
     * to enable and disable it. You don't enable it by default").
     *
     * NULL / false = off, which is the default for existing rows too — the
     * behaviour change is intentional, since nobody opted into it. Lives on the
     * IDENTITY rather than `users` so a guest can set it and so it travels with
     * the person through registration and renumbering.
     */
    autoReplyEnabled: boolean("autoReplyEnabled"),
    /** High-water mark for missed-call acknowledgement: missed/declined calls
     *  newer than this are "unseen" and drive the landing popup + badges. Bumped
     *  to now() when the user reviews their missed calls. Additive + nullable. */
    missedCallsSeenAt: timestamp("missedCallsSeenAt"),
    /** "Clear history" high-water mark: call/conference rows started at or
     *  before this are hidden from THIS identity's History tab (per-user soft
     *  clear — the other party keeps their own log). Additive + nullable. */
    historyClearedAt: timestamp("historyClearedAt"),
    /** Default audience for statuses I post: "contacts" | "everyone" (v2.99.66).
     *  NULL = "contacts", which is what every pre-v2.99.66 identity was posting
     *  under, so adding the column changes nobody's visibility. This is only the
     *  DEFAULT for new posts — each status stamps its own `statuses.audience`, so
     *  changing this never reaches back into something already published. */
    statusAudience: varchar("statusAudience", { length: 16 }),
    /**
     * ADOPT-AND-RETIRE recovery (v2.99.68) — sha256 of a recovery key the browser
     * keeps in localStorage. This is the ONE durable thing a guest holds.
     *
     * Guest identity is deliberately SESSION-scoped: the device id lives in
     * sessionStorage and the guest cookie is a session cookie, so both halves die
     * on browser close and a fresh session mints a fresh guest. That was an
     * explicit product decision and this column does NOT change it — automatic
     * resolution is untouched. What it adds is a way for the PERSON to come back
     * and say "that number was mine", which is the only remaining case where
     * closing a browser silently stranded contacts, messages and call history.
     *
     * Stored HASHED, so a database read never yields a key that could claim an
     * identity. Only ever settable on a row with `userId IS NULL`, and adoption
     * re-checks that in its WHERE — a recovery key can never hand over an
     * identity that now belongs to an account.
     */
    recoveryHash: varchar("recoveryHash", { length: 64 }),
    /** When the recovery key was minted. Recorded for support/debugging; the
     *  window is deliberately NOT bounded, because "you lost your data because you
     *  waited too long" is the outcome this whole mechanism exists to prevent. */
    recoveryIssuedAt: timestamp("recoveryIssuedAt"),
    /**
     * When this identity was CLAIMED for deletion (v2.100.0). NULL for every
     * living row, which is why the additive migration is a no-op.
     *
     * It is one column doing two jobs, both load-bearing. It is the fleet-wide
     * SERIALIZER: the claim is a conditional UPDATE gated on `IS NULL`, so its
     * `affectedRows` decides which of two instances owns the purge. And it is the
     * TOMBSTONE: the claim NULLs `guestToken`, `deviceId` and `recoveryHash` in
     * the same statement, so from the instant it commits nothing can resolve a
     * live request onto a row that is being destroyed — without holding a write
     * lock on it for the whole cascade.
     */
    purgeStartedAt: timestamp("purgeStartedAt"),
    /**
     * THE PROFILE STATUS (v2.101.1) — the label somebody sets about themselves:
     * work / vacation / travel / free / busy, each with an emoji and a colour, plus
     * a free-text note. NOT presence.
     *
     * It is a SEPARATE column from `statusOverride` rather than a widening of it,
     * because `statusOverride` feeds `effectiveStatus` → `presenceDot`, whose colour
     * vocabulary is deliberately four values wide (v2.99.92: a third meaning for a
     * colour makes colour stop carrying information). `statusOverride` is DERIVED
     * from this by `overrideForStatus` at write time, so the label and the LED can
     * never disagree — one is computed from the other.
     */
    profileStatus: varchar("profileStatus", { length: 16 }),
    statusNote: varchar("statusNote", { length: 140 }),
    /**
     * AN ADMIN'S SUGGESTED REGISTRATION ADDRESS (v2.105.15) — a nudge, never a
     * binding, and the distinction is the whole safety argument.
     *
     * An admin can propose that this guest register with a particular address.
     * They CANNOT complete it: the only writer that turns a guest identity into a
     * registered one is `ensureUserIdentity`, and its claim candidates come
     * exclusively from the REQUESTING BROWSER (the identity `createContext`
     * already resolved, the request's own guest cookie, the request's own device
     * id). Nothing lets a caller name an arbitrary identity to claim, and that is
     * precisely why v2.99.99 declined to ship this feature "the obvious way" —
     * doing so means breaking that invariant, at which point an admin can attach
     * an address they control to somebody else's identity and then sign in as
     * them with an ordinary email code.
     *
     * So these two columns hold a SUGGESTION that the guest's own app surfaces
     * and the guest's own ordinary registration completes. The address is
     * editable by them, which is strictly safer than binding it: a mistyped or
     * hostile suggestion is corrected by the one person who owns the inbox.
     *
     * NULL on both = no invite, which is every pre-release row, so the additive
     * migration is a no-op until an admin sends one.
     */
    regInviteEmail: varchar("regInviteEmail", { length: 320 }),
    regInviteAt: timestamp("regInviteAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (t) => ({
    numberIdx: uniqueIndex("identities_number_unique").on(t.number),
    userIdx: index("identities_userId_idx").on(t.userId),
    guestTokenIdx: index("identities_guestToken_idx").on(t.guestToken),
    deviceIdIdx: index("identities_deviceId_idx").on(t.deviceId),
    recoveryIdx: index("identities_recoveryHash_idx").on(t.recoveryHash),
  }),
);
export type Identity = typeof identities.$inferSelect;
export type InsertIdentity = typeof identities.$inferInsert;

/* ──────────────────────────────────────────────────────────────────────────
 * presence — who's online right now, plus last-seen.
 * Updated by WebSocket heartbeats; reads via tRPC are cheap.
 * ────────────────────────────────────────────────────────────────────────── */
export const presence = mysqlTable(
  "presence",
  {
    identityId: int("identityId").primaryKey(),
    /**
     * Has a live session — foreground OR backgrounded (v2.99.92).
     *
     * This deliberately does NOT mean "actively looking at the app". Minimising
     * used to flip it false, which showed the person OFFLINE to everybody
     * (owner: "whenever you minimize the app, the user showing offline, not the
     * idle"). `idleSince` is what separates the two now.
     */
    isOnline: boolean("isOnline").notNull().default(false),
    lastSeenAt: timestamp("lastSeenAt").defaultNow().notNull(),
    /**
     * When the app went to the background, or NULL while it is in the foreground.
     *
     * Non-null WITH `isOnline` true is the idle/away state. It is a timestamp
     * rather than a flag because the offline-message email needs to know how long
     * somebody has actually been away, and `lastSeenAt` can no longer answer that
     * — a backgrounded app keeps heartbeating, which is what stops it decaying to
     * offline after two minutes.
     */
    idleSince: timestamp("idleSince"),
    /** Active socket session id (helps when an identity has multiple tabs). */
    socketSessionId: varchar("socketSessionId", { length: 64 }),
  },
  (t) => ({
    onlineIdx: index("presence_isOnline_idx").on(t.isOnline),
  }),
);
export type Presence = typeof presence.$inferSelect;

/* ──────────────────────────────────────────────────────────────────────────
 * contacts — saved entries in one identity's phonebook.
 * The contact may itself be a known identity (resolved by number).
 * ────────────────────────────────────────────────────────────────────────── */
export const contacts = mysqlTable(
  "contacts",
  {
    id: int("id").autoincrement().primaryKey(),
    ownerId: int("ownerId").notNull(),
    /** The remote party's 6-digit number. */
    number: varchar("number", { length: 6 }).notNull(),
    /** Optional friendly name the owner gave to this contact. */
    displayName: varchar("displayName", { length: 64 }),
    avatarUrl: text("avatarUrl"),
    /** True when the owner has favourited / pinned the contact. */
    favourite: boolean("favourite").notNull().default(false),
    notes: text("notes"),
    /* Rich contact fields (v2.24). These additive, nullable columns are applied
       to existing databases at boot by `ensureSchemaExtensions()` in
       server/v2db.ts (idempotent ADD COLUMN) rather than a drizzle migration,
       so they land safely on the live DB without a manual db:push. */
    email: varchar("email", { length: 320 }),
    phone: varchar("phone", { length: 40 }),
    company: varchar("company", { length: 128 }),
    jobTitle: varchar("jobTitle", { length: 128 }),
    website: varchar("website", { length: 256 }),
    birthday: varchar("birthday", { length: 32 }),
    /** Contact group: "vip" | "family" | "friend" | "team" | null (v2.82).
     *  Additive nullable column applied by the boot migrator.
     *
     *  SINCE v2.106.14 THIS IS A DERIVED MIRROR of `tags[0]`, not an independent
     *  field. It stays on the wire because a client on the previous bundle is
     *  still reading it during a rolling deploy; `shared/contactTags.ts` owns the
     *  one expression that computes it. */
    category: varchar("category", { length: 16 }),
    /** Contact tags — 0..n of vip/family/friend/team, comma-separated, ORDERED
     *  (the first is the row chip). DATA-CONTRACTS.md §1, board 3b/4a.
     *
     *  Additive and nullable, so every pre-v2.106.14 row needs NO backfill: a row
     *  with a `category` and no `tags` reads as `[category]`, which is what it
     *  always meant. 63 chars fits all four plus separators with room spare. */
    tags: varchar("tags", { length: 64 }),
    /** Owner has BLOCKED this number: their calls are auto-declined on this
     *  device and their 1:1 messages to the owner are rejected (v2.82). */
    blocked: boolean("blocked"),
    /** Owner sends this number's CALLS to voicemail (v2.107.46): their calls
     *  reach the owner's voicemail and the owner shows as offline FOR CALLS to
     *  them, while chat, status and everything else stay completely normal.
     *  Distinct from `blocked`, which severs contact both ways — this is a
     *  calls-only "screen this caller" boundary, not a block. Additive nullable
     *  column, applied to live DBs by ensureSchemaExtensions(); NULL = off. */
    callsToVoicemail: boolean("callsToVoicemail"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (t) => ({
    ownerNumberUnique: uniqueIndex("contacts_owner_number_unique").on(t.ownerId, t.number),
    ownerIdx: index("contacts_owner_idx").on(t.ownerId),
    /** v2.88 (boot-migrator applied): presence-audience lookups resolve
     *  "who saved this number?" on every offline→online transition. */
    numberIdx: index("contacts_number_idx").on(t.number),
  }),
);
export type Contact = typeof contacts.$inferSelect;
export type InsertContact = typeof contacts.$inferInsert;

/* ──────────────────────────────────────────────────────────────────────────
 * conversations — a SMS-style chat thread, currently always 1:1 between two
 * identities (extendable to group later).
 * `key` is the lexicographically-sorted "minId-maxId" pair so we can find or
 * create a thread idempotently.
 * ────────────────────────────────────────────────────────────────────────── */
export const conversations = mysqlTable(
  "conversations",
  {
    id: int("id").autoincrement().primaryKey(),
    /** Stable key for 1:1: `${minId}-${maxId}`; for groups, null. */
    pairKey: varchar("pairKey", { length: 64 }),
    kind: mysqlEnum("kind", ["dm", "group"]).notNull().default("dm"),
    title: varchar("title", { length: 128 }),
    /**
     * THE GROUP'S OWN 6-DIGIT ID (v2.102.0, owner: a group should have a 6-digit
     * group ID, an avatar and a status of its own).
     *
     * From the SAME space as identities and party lines, and allocated through the
     * SAME `allocateSharedNumber` — a parallel allocator is exactly the cross-table
     * collision v2.99.30 closed. NULL for every DM and for every group created
     * before this release, which is why the migration is additive.
     *
     * Declared "not-a-person" in NUMBER_BEARING_COLUMNS: a member renumbering must
     * never move the group's id, the same rule a party line already has.
     */
    number: varchar("number", { length: 6 }),
    /** Group photo. Uploaded through the same `?bare=1&avatar=1` path identities
     *  use, or `authorizeStorageKey` cannot classify the key (v2.99.2). */
    avatarUrl: text("avatarUrl"),
    /** The group's status label + note, from the SAME vocabulary a person's uses
     *  (shared/profileStatus.ts) rather than a second one. No presence is derived
     *  from it — a group has no presence, so there is nothing to derive. */
    profileStatus: varchar("profileStatus", { length: 16 }),
    statusNote: varchar("statusNote", { length: 140 }),
    /** Who created it. Nullable: every pre-release group has no recorded creator,
     *  and the purge cascade must treat that as "no owner" rather than guessing. */
    ownerIdentityId: int("ownerIdentityId"),
    /**
     * INVITE-LINK REVOCATION COUNTER (v2.105.9) — NULL reads as 0.
     *
     * The invite token is STATELESS: it is signed and self-describing, so there is no
     * row to delete in order to revoke one. This integer is what a signature cannot
     * express on its own. A token names the epoch it was minted under and a join
     * refuses any token whose epoch is not the current value, so bumping it once kills
     * every outstanding link — which is what "revoke the link" has to mean, given that
     * an admin cannot know how many copies exist or where they went.
     *
     * NULL on every pre-release row and read as 0, so the migration is a no-op until
     * somebody revokes. Only ever increases.
     */
    inviteEpoch: int("inviteEpoch"),
    /**
     * MAY ORDINARY MEMBERS ADD PEOPLE? (v2.105.16, the owner's "all users can add".)
     *
     * NULL / false = admin-only, which is both the safe default and what every
     * pre-release group already means — so the additive migration changes nothing
     * until an admin turns it on.
     *
     * It widens ONE capability and never the rest: `remove-member` stays admin-only
     * unconditionally, because ejecting somebody is the higher-privilege half and a
     * member able to remove other members is a takeover primitive nobody asked for.
     *
     * Read PER GROUP inside `checkGroupPermission` rather than by mutating the
     * module-level `MEMBER_CAPABILITIES` set — that set is process-global, so adding
     * to it for one group would silently grant the capability in EVERY group for the
     * life of the process.
     */
    membersCanAdd: boolean("membersCanAdd"),
    lastMessageAt: timestamp("lastMessageAt").defaultNow().notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => ({
    pairKeyIdx: uniqueIndex("conversations_pairKey_unique").on(t.pairKey),
    // UNIQUE, like both other number tables: two groups sharing an id would make
    // the id useless for the one thing it exists for.
    numberIdx: uniqueIndex("conversations_number_unique").on(t.number),
    lastMessageIdx: index("conversations_lastMessage_idx").on(t.lastMessageAt),
  }),
);
export type Conversation = typeof conversations.$inferSelect;

/* ──────────────────────────────────────────────────────────────────────────
 * conversation_participants — membership table.
 * ────────────────────────────────────────────────────────────────────────── */
export const conversationParticipants = mysqlTable(
  "conversation_participants",
  {
    conversationId: int("conversationId").notNull(),
    identityId: int("identityId").notNull(),
    unreadCount: int("unreadCount").notNull().default(0),
    lastReadMessageId: int("lastReadMessageId"),
    mutedUntil: timestamp("mutedUntil"),
    /**
     * SWIPE-ACTION STATE (v2.103.0) — all four PER PERSON, which is the whole reason
     * they live here rather than in the browser: pinning a chat on a phone that does
     * not pin it on a laptop is the same lie a localStorage "delete for me" would have
     * been (v2.102.2). `conversation_participants` is already keyed
     * (conversationId, identityId), so each is one additive nullable column.
     *
     * MUTE IS DELIBERATELY NOT HERE. `mutedUntil` above has existed unwritten since the
     * schema was drawn, and mute stays per-DEVICE (localStorage + a Cache Storage mirror
     * the service worker reads) because the worker has to silence a notification without
     * asking the server anything — v2.99.42's decision, not an oversight.
     */
    pinnedAt: timestamp("pinnedAt"),
    archivedAt: timestamp("archivedAt"),
    /** Marked unread BY HAND. Its own field rather than rewinding the read watermark,
     *  which would fight `recomputeUnreadFor` and mean "unread" could not be expressed
     *  at all for a thread whose newest message is your own. */
    manualUnreadAt: timestamp("manualUnreadAt"),
    /**
     * "Delete for me" at THREAD scope: every message up to and including this id is
     * hidden from this person, and the thread leaves their list until a NEWER one
     * arrives. An id rather than a timestamp so the filter rides the
     * (conversationId, id) index, and one column rather than a bulk insert of
     * per-message hides — the same shape `identities.historyClearedAt` has used for
     * the call log since v2.75.
     *
     * The reappear rule needs NO write on the send path: the thread is hidden exactly
     * while its newest message id is not greater than this.
     */
    clearedUpToMessageId: int("clearedUpToMessageId"),
    /**
     * GROUP ROLE (v2.104.0) — `"admin"` or NULL, the one durable store for group power.
     *
     * It lives HERE because this row is already keyed (conversationId, identityId) as
     * its PRIMARY KEY, so an UPDATE naming both halves can only ever touch one person's
     * role in one group — the same property `setThreadState` already relies on.
     *
     * NOT `users.role`: that is an ACCOUNT-level SITE admin, and a guest has no `users`
     * row at all while a guest can perfectly well be a group member. A varchar rather
     * than a boolean so a third tier later is a value, not a migration.
     *
     * NULL = ordinary member, which is what every existing row reads as. Nothing a
     * member can do today stops working when this column appears, because `edit-profile`
     * is unconditional for members — see `checkGroupPermission`.
     */
    groupRole: varchar("groupRole", { length: 16 }),
    /**
     * JOIN WATERMARK (v2.105.9) — messages at or below this id are not this member's
     * to read. NULL means "sees everything", which is what every pre-release row and
     * every founding member needs.
     *
     * IT MUST BE ITS OWN COLUMN. `clearedUpToMessageId` above expresses a numerically
     * identical rule and reusing it would be a real bug: `listThreads` DROPS the thread
     * entirely while nothing newer than that watermark exists, deliberately, because
     * "delete for me" means the thread itself should go (v2.103.0). A member who just
     * joined a quiet group would therefore find it INVISIBLE until somebody spoke. Here
     * the thread must stay and merely show no preview, so the two rules cannot share a
     * column however alike they look.
     *
     * An id, not a timestamp, so every filter rides the (conversationId, id) index.
     */
    joinedAtMessageId: int("joinedAtMessageId"),
    joinedAt: timestamp("joinedAt").defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.conversationId, t.identityId] }),
    byIdentity: index("cp_identity_idx").on(t.identityId),
  }),
);
export type ConversationParticipant = typeof conversationParticipants.$inferSelect;

/* ──────────────────────────────────────────────────────────────────────────
 * messages — a single message in a thread.
 * `kind` enum lets us render text, image, video, audio, file, or system events
 * (e.g. "Call ended — 02:34") uniformly.
 * ────────────────────────────────────────────────────────────────────────── */
/**
 * PER-PERSON MESSAGE HIDING (v2.102.2) — "delete for me".
 *
 * Owner (#81): hide a message somebody ELSE sent, for you alone.
 *
 * This is deliberately NOT `messages.deletedAt`, which is UNSEND and removes a message
 * for everybody — rightly restricted to its own sender. A row here says "one identity
 * does not want to see one message", and it exists at all because a browser-only
 * version would be a lie: the message would come back on that person's other phone.
 *
 * The primary key is (identityId, messageId) in that order, which is the order every
 * read uses — "which of these messages has THIS person hidden" — so the anti-join is
 * an index lookup rather than a scan. `messageId` gets its own index for the reverse
 * direction, so a real unsend can clear its hides without a table scan.
 */
export const messageHides = mysqlTable(
  "message_hides",
  {
    identityId: int("identityId").notNull(),
    messageId: int("messageId").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.identityId, t.messageId] }),
    messageIdx: index("message_hides_message_idx").on(t.messageId),
  }),
);

/**
 * Message reactions — `DATA-CONTRACTS.md` §2, board 4c.
 *
 * A TABLE RATHER THAN THE CONTRACT'S JSON MAP, AND THE REASON IS THE CONTRACT'S
 * OWN CENTRAL RULE. It asks for `reactions: MessageReactions` — `{emoji: pins[]}`
 * — stored on the message record, with "one reaction per user per message". Held
 * as a blob that rule is an application check around a read-modify-write: two
 * people reacting in the same instant both read the old map and the second write
 * silently discards the first. Here it is `UNIQUE (messageId, identityId)`, so
 * one-per-user holds BY CONSTRUCTION and a move is one atomic upsert.
 *
 * The contract's wire shape is unchanged — `{emoji: pins[]}` is a PROJECTION over
 * these rows, built at read time. Honouring a contract means keeping its shape,
 * not copying a store that cannot hold its own invariant.
 *
 * `emoji` is varchar(32) because a single reaction can be a ZWJ sequence with skin
 * tone modifiers — "👩🏽‍🚀" is 7 code units, and a family emoji more. It is bounded
 * and shape-checked on the way in (`normalizeReactionEmoji`): without that, this
 * column is a free-text channel that renders on somebody else's message.
 */
export const messageReactions = mysqlTable(
  "message_reactions",
  {
    id: int("id").autoincrement().primaryKey(),
    messageId: int("messageId").notNull(),
    identityId: int("identityId").notNull(),
    emoji: varchar("emoji", { length: 32 }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => ({
    /* THE ONE-PER-USER RULE. Not a convenience index — it is the rule itself, which
       is why picking a second emoji can be an upsert rather than a delete+insert. */
    oneEach: uniqueIndex("message_reactions_one_each").on(t.messageId, t.identityId),
    /* The read direction: every reaction on a page of messages, one index range. */
    messageIdx: index("message_reactions_message_idx").on(t.messageId),
  }),
);

export const messages = mysqlTable(
  "messages",
  {
    id: int("id").autoincrement().primaryKey(),
    conversationId: int("conversationId").notNull(),
    senderIdentityId: int("senderIdentityId").notNull(),
    kind: mysqlEnum("kind", [
      "text",
      "image",
      "video",
      "audio",
      "file",
      "system",
    ])
      .notNull()
      .default("text"),
    body: text("body"),
    /** Reference to attachments.id when kind is image/video/audio/file. */
    attachmentId: int("attachmentId"),
    /** Reply-to message id for threaded replies. */
    replyToId: int("replyToId"),
    /** Free-form metadata (e.g. call-ended duration, system event details). */
    meta: json("meta"),
    /**
     * Receipt timestamps (v2.99.74). `createdAt` is already "sent", so these two
     * complete the set the message-info panel shows: when it reached the recipient's
     * device, and when they actually opened it.
     *
     * Additive + nullable via the boot migrator. NULL means "not yet", which is
     * exactly right for every historical row — we genuinely do not know when those
     * were delivered or read, and inventing a value would make the info panel lie.
     */
    deliveredAt: timestamp("deliveredAt"),
    readAt: timestamp("readAt"),
    status: mysqlEnum("status", ["sent", "delivered", "read", "failed"])
      .notNull()
      .default("sent"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    editedAt: timestamp("editedAt"),
    deletedAt: timestamp("deletedAt"),
    /**
     * WHO removed it, when it was not the sender (v2.104.0).
     *
     * `deletedAt` has one meaning and two causes: the sender unsending their own
     * message, and a group admin removing somebody else's. NULL here means the first,
     * which is true of every deletion that has ever happened, so no backfill.
     *
     * Declared **keep-safer** in IDENTITY_REFERENCING_COLUMNS rather than `redact`, and
     * that is a correction the adversarial review earned: nulling a purged admin's id
     * would rewrite their deletion into an apparent self-unsend, i.e. the row would
     * positively assert the sender removed their own words. Leaving it dangling reads as
     * "an admin, no longer here" — which is the truth.
     */
    deletedByIdentityId: int("deletedByIdentityId"),
  },
  (t) => ({
    conversationIdx: index("messages_conversation_idx").on(t.conversationId, t.createdAt),
    senderIdx: index("messages_sender_idx").on(t.senderIdentityId),
    /* Hot-path indexes (v2.88), applied to the live DB by the boot migrator
       (ensureSchemaExtensions ADD INDEX — idempotent, additive): */
    /** listThreads groupwise-max + listMessages pagination (ORDER BY id). */
    convoIdIdx: index("messages_convo_id_idx").on(t.conversationId, t.id),
    /** getAttachmentForIdentity's auth check (was a full scan per check). */
    attachmentIdx: index("messages_attachment_idx").on(t.attachmentId),
  }),
);
/* ──────────────────────────────────────────────────────────────────────────
 * message_attachments — ALBUM items (v2.107.32). A message has always carried
 * ONE `attachmentId`; an album keeps that column as its COVER (so an
 * un-updated client renders the first photo, not a blank) and lists the full
 * set here, ordered by `position`, each with its own optional caption.
 * ────────────────────────────────────────────────────────────────────────── */
export const messageAttachments = mysqlTable(
  "message_attachments",
  {
    id: int("id").autoincrement().primaryKey(),
    messageId: int("messageId").notNull(),
    attachmentId: int("attachmentId").notNull(),
    /** 0-based order in the strip/grid — the client's picked order, preserved. */
    position: smallint("position").notNull(),
    /** Per-ITEM caption; the album-level caption is the message body. */
    caption: text("caption"),
  },
  (t) => ({
    msgIdx: index("msg_att_msg_idx").on(t.messageId),
  }),
);

/**
 * PER-POST GROUP READ RECEIPTS (v2.107.35). Owner: *"in the group, when someone
 * posts something, the post owner and admins can see who read it and what time
 * for each post."* One row per (message, reader), stamped the moment the
 * reader's watermark passes the message inside `markThreadRead`'s transaction —
 * so a receipt can never exist without the read that produced it. Group
 * conversations only: the 1:1 panel already has `readAt` on the message row,
 * and a DM's "who" is never in question.
 */
export const messageReads = mysqlTable(
  "message_reads",
  {
    id: int("id").autoincrement().primaryKey(),
    messageId: int("messageId").notNull(),
    readerId: int("readerId").notNull(),
    readAt: timestamp("readAt").notNull(),
  },
  (t) => [
    // One receipt per reader per message — the insert relies on this to be idempotent.
    uniqueIndex("msg_reads_unique").on(t.messageId, t.readerId),
  ],
);
export type MessageAttachment = typeof messageAttachments.$inferSelect;

export type Message = typeof messages.$inferSelect;
export type InsertMessage = typeof messages.$inferInsert;

/* ──────────────────────────────────────────────────────────────────────────
 * attachments — file metadata. Bytes live in storage (storagePut), only the
 * key/url + descriptive fields land in the DB.
 * ────────────────────────────────────────────────────────────────────────── */
export const attachments = mysqlTable(
  "attachments",
  {
    id: int("id").autoincrement().primaryKey(),
    storageKey: varchar("storageKey", { length: 256 }).notNull(),
    url: text("url").notNull(),
    mimeType: varchar("mimeType", { length: 128 }).notNull(),
    sizeBytes: bigint("sizeBytes", { mode: "number" }).notNull(),
    /** Optional: image/video pixel dimensions. */
    width: smallint("width"),
    height: smallint("height"),
    /** Optional: audio/video duration in ms. */
    durationMs: int("durationMs"),
    /** Optional original filename for files. */
    filename: varchar("filename", { length: 256 }),
    /* Voice transcripts (v2.107.31). Filled lazily by messages.transcribeVoice —
       the first listener pays the Gemini call, everyone after reads the row.
       `transcriptAlt` holds the most recently requested TRANSLATION of it. */
    transcript: text("transcript"),
    transcriptLang: varchar("transcriptLang", { length: 8 }),
    transcriptAlt: text("transcriptAlt"),
    transcriptAltLang: varchar("transcriptAltLang", { length: 8 }),
    /* Image thumbnails (v2.89). Additive + nullable, applied to the live DB by
       ensureSchemaExtensions(). The client generates a ≤512px thumbnail on-canvas
       and uploads it BEFORE the full image; message bubbles render the thumb and
       tap through to the full-size `url`. Null for non-images / legacy rows /
       the unchanged base64 (mobile) upload path. */
    /** Storage key of the ≤512px thumbnail (in the uploader's own namespace). */
    thumbKey: varchar("thumbKey", { length: 256 }),
    /** Servable URL of the thumbnail (`/manus-storage/{thumbKey}`). */
    thumbUrl: text("thumbUrl"),
    uploadedByIdentityId: int("uploadedByIdentityId").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => ({
    ownerIdx: index("attachments_owner_idx").on(t.uploadedByIdentityId),
    /* Participant-only file access (v2.94.2): the storage proxy resolves an
       attachment by storageKey/thumbKey on every /manus-storage request. Added
       to the live DB by ensureSchemaExtensions (ADD INDEX, idempotent). */
    keyIdx: index("attachments_key_idx").on(t.storageKey),
    thumbKeyIdx: index("attachments_thumbkey_idx").on(t.thumbKey),
  }),
);
export type Attachment = typeof attachments.$inferSelect;
export type InsertAttachment = typeof attachments.$inferInsert;

/* ──────────────────────────────────────────────────────────────────────────
 * statuses — WhatsApp/story-style ephemeral updates (rich user status).
 * A status is text, image+caption, video+caption, or audio; it auto-expires
 * (default 24h) and is visible to the owner + their contacts. Media is uploaded
 * via /api/v2/upload (same as attachments) and referenced by mediaKey/mediaUrl.
 * Created by ensureSchemaExtensions (additive; no destructive migration).
 * ────────────────────────────────────────────────────────────────────────── */
export const statuses = mysqlTable(
  "statuses",
  {
    id: int("id").autoincrement().primaryKey(),
    identityId: int("identityId").notNull(), // AUTHOR — always a person
    /**
     * The GROUP this story belongs to, or NULL for a personal one (v2.105.5).
     *
     * `identityId` stays notNull and keeps meaning the AUTHOR: a group does not
     * write, a member does, and the viewer needs to know which member. So this is
     * an ADDRESSEE, not an owner — which is also what keeps the migration a
     * no-op, since NULL is exactly the reading every pre-existing row needs.
     *
     * The audience follows from it: a group story is visible to the group's
     * MEMBERS rather than to the author's contacts, which is why the audience
     * rule takes the row and not just an owner id.
     */
    conversationId: int("conversationId"),
    /** "text" | "image" | "video" | "audio". */
    kind: varchar("kind", { length: 16 }).notNull(),
    /** The text body (kind=text) OR the caption (image/video/audio). */
    text: text("text"),
    /** Background style for a text status (a CSS gradient/color token). */
    bgColor: varchar("bgColor", { length: 64 }),
    /** Storage key of the media (in the owner's upload namespace); null for text. */
    mediaKey: varchar("mediaKey", { length: 256 }),
    /** Servable media URL (`/manus-storage/{mediaKey}`). */
    mediaUrl: text("mediaUrl"),
    mimeType: varchar("mimeType", { length: 128 }),
    /** Audio/video duration in ms (drives the story auto-advance timer). */
    durationMs: int("durationMs"),
    /**
     * Who may watch THIS post: "contacts" | "everyone" (v2.99.66). Stamped at
     * insert from the poster's `identities.statusAudience` default, so later
     * changing that default can never retroactively widen an already-published
     * status. NULL = "contacts" (every pre-v2.99.66 row, which was posted under
     * the contacts-only rule).
     */
    audience: varchar("audience", { length: 16 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    /** createdAt + TTL (default 24h). Reads filter `expiresAt > now`. */
    expiresAt: timestamp("expiresAt").notNull(),
  },
  (t) => ({
    ownerIdx: index("statuses_owner_idx").on(t.identityId),
    expiresIdx: index("statuses_expires_idx").on(t.expiresAt),
    // The feed asks "any live story for these groups", so the index leads with
    // the group and carries the expiry — the same shape the owner index has.
    convoIdx: index("statuses_convo_idx").on(t.conversationId, t.expiresAt),
  }),
);
export type Status = typeof statuses.$inferSelect;
export type InsertStatus = typeof statuses.$inferInsert;

/* status_views — one row per (status, viewer) so the owner sees "seen by". */
export const statusViews = mysqlTable(
  "status_views",
  {
    id: int("id").autoincrement().primaryKey(),
    statusId: int("statusId").notNull(),
    viewerId: int("viewerId").notNull(),
    viewedAt: timestamp("viewedAt").defaultNow().notNull(),
  },
  (t) => ({
    pair: uniqueIndex("status_view_pair_unique").on(t.statusId, t.viewerId),
    statusIdx: index("status_views_status_idx").on(t.statusId),
  }),
);
export type StatusView = typeof statusViews.$inferSelect;

/* ──────────────────────────────────────────────────────────────────────────
 * call_history — every call attempt between two identities.
 * `status` covers initiated, answered, missed, declined, ended.
 * ────────────────────────────────────────────────────────────────────────── */
export const callHistory = mysqlTable(
  "call_history",
  {
    id: int("id").autoincrement().primaryKey(),
    callerIdentityId: int("callerIdentityId").notNull(),
    calleeIdentityId: int("calleeIdentityId").notNull(),
    /** Conversation that holds the chat for this call (auto-created). */
    conversationId: int("conversationId"),
    status: mysqlEnum("status", [
      "initiated",
      "ringing",
      "answered",
      "missed",
      "declined",
      "ended",
      "failed",
    ])
      .notNull()
      .default("initiated"),
    startedAt: timestamp("startedAt").defaultNow().notNull(),
    answeredAt: timestamp("answeredAt"),
    endedAt: timestamp("endedAt"),
    durationSec: int("durationSec"),
    /** Channel: voice | video. */
    channel: mysqlEnum("channel", ["voice", "video"]).notNull().default("video"),
  },
  (t) => ({
    callerIdx: index("call_caller_idx").on(t.callerIdentityId, t.startedAt),
    calleeIdx: index("call_callee_idx").on(t.calleeIdentityId, t.startedAt),
  }),
);
export type CallHistory = typeof callHistory.$inferSelect;

/* ──────────────────────────────────────────────────────────────────────────
 * conference_history — one row per ENDED multi-party call (room). Captures the
 * full roster (every number that was ever in the room, with display name), how
 * many parties, what number seeded the call, and the total duration. Unlike
 * call_history (rigidly 2-party), this is the source for the "History" tab.
 * Created at boot by ensureSchemaExtensions (CREATE TABLE IF NOT EXISTS).
 * ────────────────────────────────────────────────────────────────────────── */
export const conferenceHistory = mysqlTable(
  "conference_history",
  {
    id: int("id").autoincrement().primaryKey(),
    /** Signaling room id (e.g. "r1a2b3…"). */
    roomId: varchar("roomId", { length: 40 }).notNull(),
    /** The number that seeded the room (first dial target), if known. */
    dialedNumber: varchar("dialedNumber", { length: 6 }),
    partyCount: int("partyCount").notNull().default(0),
    startedAt: timestamp("startedAt").notNull(),
    endedAt: timestamp("endedAt").notNull(),
    durationSec: int("durationSec").notNull().default(0),
    /**
     * #116 — how the call was DIALLED, so an answered group call can say Voice or
     * Video in History the way a solo row already does.
     *
     * NULLABLE WITH NO DEFAULT, unlike `call_history.channel` (which is notNull
     * default "video"). Every row written before this column existed has no
     * recorded channel, and a default would make each of them ASSERT a media type
     * nobody recorded — which is the guess this column exists to replace. The UI
     * renders nothing for a null.
     *
     * The DIAL channel, matching what the solo column stores: mid-call somebody may
     * turn their camera on under the mutual-consent protocol, so "was video ever
     * live" is a different question, and answering it would make the two History
     * row kinds mean different things by the same word.
     */
    channel: mysqlEnum("channel", ["voice", "video"]),
    /** Full roster JSON: [{ number, name, identityId | null }]. */
    participants: json("participants"),
  },
  (t) => ({
    startedIdx: index("conf_started_idx").on(t.startedAt),
    roomIdx: index("conf_room_idx").on(t.roomId),
  }),
);
export type ConferenceHistory = typeof conferenceHistory.$inferSelect;

/* ──────────────────────────────────────────────────────────────────────────
 * push_subscriptions — Web Push endpoints per identity (one row per browser/
 * device that granted notification permission). Used to WAKE a device that has
 * no live SSE connection: incoming-call pages ("X is calling — open RELAY")
 * and missed-call notices. Endpoints are pruned when the push service reports
 * them gone (404/410). Created at boot by ensureSchemaExtensions
 * (CREATE TABLE IF NOT EXISTS) — additive, never touches existing data.
 * ────────────────────────────────────────────────────────────────────────── */
export const pushSubscriptions = mysqlTable(
  "push_subscriptions",
  {
    id: int("id").autoincrement().primaryKey(),
    identityId: int("identityId").notNull(),
    /** Push service URL — unique per browser profile/device subscription. */
    endpoint: varchar("endpoint", { length: 500 }).notNull(),
    /** Client public key (base64url) for payload encryption. */
    p256dh: varchar("p256dh", { length: 255 }).notNull(),
    /** Client auth secret (base64url) for payload encryption. */
    auth: varchar("auth", { length: 120 }).notNull(),
    /** Transport: "webpush" (browsers/PWA; null = legacy rows) or "fcm"
        (the native Android app — endpoint holds the FCM device token). */
    kind: varchar("kind", { length: 10 }),
    /** Proof-of-possession for a RE-BIND (v2.99.49): sha256 of a secret the
     *  browser mints once and keeps in localStorage. Closes the hijack where
     *  anyone who learned an endpoint could re-point it at their own identity and
     *  silently kill the owner's notifications. NULL = a row created before this
     *  existed; those are re-bound on a keys match instead (see
     *  upsertPushSubscription) so the account-switch flow never breaks. */
    claimHash: varchar("claimHash", { length: 64 }),
    /**
     * This DEVICE's Do Not Disturb / muted / locked lists, as JSON (v2.107.11).
     *
     * NULL means "never synced", which reads as nothing suppressed — the behaviour
     * every row had before this column existed. It is here rather than on
     * `conversation_participants` because the settings are per-device and this table
     * already is: putting mute on the participant row would silence a thread on every
     * device the account owns, which is a different feature.
     *
     * Only the OS-RENDERED transports consult it. A Web Push still passes through the
     * service worker, which applies the same rule from its own Cache Storage mirror.
     */
    alertPrefs: text("alertPrefs"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => ({
    identityIdx: index("push_sub_identity_idx").on(t.identityId),
    endpointUnique: uniqueIndex("push_sub_endpoint_unique").on(t.endpoint),
  }),
);
export type PushSubscriptionRow = typeof pushSubscriptions.$inferSelect;

/* ──────────────────────────────────────────────────────────────────────────
 * conference_participants — join rows so each identity can query "the
 * conferences I was in" with an index (instead of scanning the JSON roster).
 * ────────────────────────────────────────────────────────────────────────── */
export const conferenceParticipants = mysqlTable(
  "conference_participants",
  {
    id: int("id").autoincrement().primaryKey(),
    conferenceId: int("conferenceId").notNull(),
    identityId: int("identityId").notNull(),
    number: varchar("number", { length: 6 }).notNull(),
  },
  (t) => ({
    identityIdx: index("conf_part_identity_idx").on(t.identityId),
    confIdx: index("conf_part_conf_idx").on(t.conferenceId),
  }),
);
export type ConferenceParticipant = typeof conferenceParticipants.$inferSelect;

/* ──────────────────────────────────────────────────────────────────────────
 * online_watches — "tell me when they're back online" (v2.88 call-back alert).
 * One row per (watcher, target); re-watching refreshes the 24h expiry. When
 * the target's heartbeat flips them offline→online, every unexpired watcher
 * gets a push + SSE nudge and the rows are consumed (one-shot). Created at
 * boot by ensureSchemaExtensions (CREATE TABLE IF NOT EXISTS).
 * ────────────────────────────────────────────────────────────────────────── */
export const onlineWatches = mysqlTable(
  "online_watches",
  {
    id: int("id").autoincrement().primaryKey(),
    /** Who asked to be alerted. */
    watcherId: int("watcherId").notNull(),
    /** Whose comeback they're waiting for. */
    targetId: int("targetId").notNull(),
    expiresAt: timestamp("expiresAt").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => ({
    pairUnique: uniqueIndex("watch_pair_unique").on(t.watcherId, t.targetId),
    targetIdx: index("watch_target_idx").on(t.targetId),
  }),
);
export type OnlineWatch = typeof onlineWatches.$inferSelect;

/* ──────────────────────────────────────────────────────────────────────────
 * sessions — the device/session ledger (v2.99.1 device list + remote logout).
 *
 * One row per LOGIN. The session cookie carries a matching `sid`; a request is
 * authenticated by the signed cookie as before, and — ONLY for cookies that
 * carry a sid — the row's presence is additionally consulted so a specific
 * device can be logged out by DELETING its row. Legacy cookies (no sid) never
 * touch this table and behave exactly as before. Created at boot by
 * ensureSchemaExtensions (CREATE TABLE IF NOT EXISTS).
 * ────────────────────────────────────────────────────────────────────────── */
export const sessions = mysqlTable(
  "sessions",
  {
    id: int("id").autoincrement().primaryKey(),
    /** Random hex id embedded in the cookie; deleting the row logs the device out. */
    sid: varchar("sid", { length: 64 }).notNull(),
    /** The account this session signs in. */
    userId: int("userId").notNull(),
    /** Human device label derived from the User-Agent at login. */
    label: varchar("label", { length: 160 }),
    /** New-device approval (v2.99.7). NULL = approved/normal (every legacy row
     *  and every PIN login); non-NULL = when this sign-in started WAITING for
     *  approval from one of the account's other devices. A pending sid does
     *  NOT authenticate; approve = set NULL, deny = delete the row. Additive +
     *  nullable via ensureSchemaExtensions(). */
    pendingApproval: timestamp("pendingApproval"),
    /**
     * WHERE AND HOW THIS SIGN-IN HAPPENED (v2.100.1, owner: *"it need to be sent
     * always the details from where his login type, country, IP, device name,
     * everything"*). All four are additive + nullable, so every pre-existing row
     * simply has no details and the UI omits what it does not have.
     *
     * The IP is captured SYNCHRONOUSLY at login and the country/city are filled in
     * AFTERWARDS, fire-and-forget: geo resolution is an external HTTP call with a
     * 4s timeout, and putting that in front of a sign-in would make every login
     * wait on somebody else's service. A row with an IP and no country is the
     * honest degraded state, not a bug.
     */
    ip: varchar("ip", { length: 64 }),
    country: varchar("country", { length: 2 }),
    city: varchar("city", { length: 96 }),
    /** Which of the three ways in was used: "code" | "pin" | "register". */
    method: varchar("method", { length: 16 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    lastSeenAt: timestamp("lastSeenAt").defaultNow().notNull(),
  },
  (t) => ({
    sidUnique: uniqueIndex("sessions_sid_unique").on(t.sid),
    userIdx: index("sessions_user_idx").on(t.userId),
  }),
);
export type SessionRow = typeof sessions.$inferSelect;

/* ──────────────────────────────────────────────────────────────────────────
 * party_lines — dialable ROOM numbers (v2.89, the signature feature).
 *
 * A user creates a party line and it gets its OWN 6-digit number from the SAME
 * number space as identities (allocation checks BOTH tables, so a line can
 * never shadow a person or vice versa). Dialing the number never rings anyone:
 * the relay's invite path resolves it (onResolveDial) and drops the caller
 * straight into the line's persistent room (`pl-<number>`). The room id is
 * DERIVED from this row, so the in-memory room can be reaped freely when empty
 * — the line stays dialable forever until the owner deletes it. Created at
 * boot by ensureSchemaExtensions (CREATE TABLE IF NOT EXISTS).
 * ────────────────────────────────────────────────────────────────────────── */
export const partyLines = mysqlTable(
  "party_lines",
  {
    id: int("id").autoincrement().primaryKey(),
    /** The line's public dialable 6-digit number. */
    number: varchar("number", { length: 6 }).notNull(),
    /** The identity that created (and can delete) the line. */
    ownerIdentityId: int("ownerIdentityId").notNull(),
    /** Display title, shown in directory lookups + History. */
    title: varchar("title", { length: 64 }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => ({
    numberUnique: uniqueIndex("party_lines_number_unique").on(t.number),
    ownerIdx: index("party_lines_owner_idx").on(t.ownerIdentityId),
  }),
);
export type PartyLine = typeof partyLines.$inferSelect;

/* ──────────────────────────────────────────────────────────────────────────
 * signaling — DB-backed WebRTC SDP/ICE mailbox.
 *
 * Each row is a single signaling envelope from caller to callee (or vice
 * versa). Receivers poll/long-poll for new envelopes addressed to them.
 * Rows TTL out after a few minutes — a periodic job purges stale ones.
 * ────────────────────────────────────────────────────────────────────────── */
export const signaling = mysqlTable(
  "signaling",
  {
    id: int("id").autoincrement().primaryKey(),
    fromIdentityId: int("fromIdentityId").notNull(),
    toIdentityId: int("toIdentityId").notNull(),
    /** Logical call id so caller/callee can correlate offer/answer/ice. */
    callId: varchar("callId", { length: 64 }).notNull(),
    kind: mysqlEnum("kind", [
      "offer",
      "answer",
      "ice",
      "hangup",
      "ringing",
      "decline",
    ]).notNull(),
    /** Payload: SDP string or ICE candidate JSON. */
    payload: json("payload").notNull(),
    consumed: boolean("consumed").notNull().default(false),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    expiresAt: timestamp("expiresAt").notNull(),
  },
  (t) => ({
    inboxIdx: index("signaling_inbox_idx").on(t.toIdentityId, t.consumed, t.createdAt),
    callIdx: index("signaling_call_idx").on(t.callId),
    expiresIdx: index("signaling_expires_idx").on(t.expiresAt),
  }),
);
export type Signaling = typeof signaling.$inferSelect;
export type InsertSignaling = typeof signaling.$inferInsert;
