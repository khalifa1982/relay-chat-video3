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
    /** High-water mark for missed-call acknowledgement: missed/declined calls
     *  newer than this are "unseen" and drive the landing popup + badges. Bumped
     *  to now() when the user reviews their missed calls. Additive + nullable. */
    missedCallsSeenAt: timestamp("missedCallsSeenAt"),
    /** "Clear history" high-water mark: call/conference rows started at or
     *  before this are hidden from THIS identity's History tab (per-user soft
     *  clear — the other party keeps their own log). Additive + nullable. */
    historyClearedAt: timestamp("historyClearedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (t) => ({
    numberIdx: uniqueIndex("identities_number_unique").on(t.number),
    userIdx: index("identities_userId_idx").on(t.userId),
    guestTokenIdx: index("identities_guestToken_idx").on(t.guestToken),
    deviceIdIdx: index("identities_deviceId_idx").on(t.deviceId),
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
    isOnline: boolean("isOnline").notNull().default(false),
    lastSeenAt: timestamp("lastSeenAt").defaultNow().notNull(),
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
     *  Additive nullable column applied by the boot migrator. */
    category: varchar("category", { length: 16 }),
    /** Owner has BLOCKED this number: their calls are auto-declined on this
     *  device and their 1:1 messages to the owner are rejected (v2.82). */
    blocked: boolean("blocked"),
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
    lastMessageAt: timestamp("lastMessageAt").defaultNow().notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => ({
    pairKeyIdx: uniqueIndex("conversations_pairKey_unique").on(t.pairKey),
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
    status: mysqlEnum("status", ["sent", "delivered", "read", "failed"])
      .notNull()
      .default("sent"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    editedAt: timestamp("editedAt"),
    deletedAt: timestamp("deletedAt"),
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
    identityId: int("identityId").notNull(), // owner
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
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    /** createdAt + TTL (default 24h). Reads filter `expiresAt > now`. */
    expiresAt: timestamp("expiresAt").notNull(),
  },
  (t) => ({
    ownerIdx: index("statuses_owner_idx").on(t.identityId),
    expiresIdx: index("statuses_expires_idx").on(t.expiresAt),
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
