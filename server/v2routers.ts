/* ============================================================
   v2.0 tRPC routers — the API surface for the phone-app shell.

   Every router exported here is namespaced under appRouter as a
   sibling of `auth` and `system`. See server/routers.ts for the
   final composition.
   ============================================================ */

import { contactTagsOf, serializeContactTags } from "../shared/contactTags";
import { sanitizeUgcText } from "../shared/contentFilter";
import { TRPCError } from "@trpc/server";
import { s3Config } from "./s3";
import { storageGetSignedUrl } from "./storage";
import {
  MAX_TRANSCRIBE_BYTES,
  geminiKey,
  transcribeAudio,
  translateText,
} from "./voiceTranscribe";
import { z } from "zod";
import { personReelKey, groupReelKey } from "../shared/reelKey";
import { mintGroupCallSeed } from "./groupCallSeed";
import {
  mintGroupInvite,
  verifyGroupInvite,
  inviteAudienceAdmits,
  GROUP_INVITE_TTL_MS,
  type GroupInviteAudience,
} from "./groupInvite";
import { eq } from "drizzle-orm";
import { getDb, getUserById } from "./db";
import { identities } from "../drizzle/schema";
import { router, publicProcedure } from "./_core/trpc";
import { GUEST_COOKIE } from "./_core/context";
import { hashRecoveryKey, normalizeRecoveryKey } from "./guestRecovery";
import { MAX_ALERT_IDS, normalizeAlertPrefs } from "../shared/alertPrefs";
import { ALBUM_MIN_ITEMS, albumCounts, albumKindFor } from "../shared/albumRules";
import { getSessionCookieOptions } from "./_core/cookies";
import {
  adoptRecoveredIdentity,
  bindDeviceIdToIdentity,
  createGuestIdentity,
  ensureGuestRecoveryKey,
  findRecoverableGuestIdentity,
  identityFootprint,
  deleteContact,
  getAttachmentForIdentity,
  getAttachmentsByIds,
  keyInOwnerNamespace,
  getIdentitiesByIds,
  getIdentitiesByNumbers,
  insertStatus,
  getActiveStatusesForOwners,
  getActiveStatusById,
  deleteStatus,
  deleteStatusAsGroupAdmin,
  recordStatusView,
  getViewedStatusIds,
  getStatusViewerIds,
  getStatusViewCounts,
  getContactNumbersForOwner,
  getIdentityIdsWhoSaved,
  getBlockedNumbersForOwner,
  statusAudienceAuthorized,
  countActiveStatuses,
  ownersWhoBlockedNumber,
  getStatusAudienceIds,
  getGroupStatusAudienceIds,
  getActiveStatusesForConversations,
  getGroupConversationIdsFor,
  getGroupsByIds,
  getIdentityStatusAudience,
  setIdentityStatusAudience,
  getViewableStatusesOfOwner,
  normalizeStatusAudience,
  type StatusRow,
  getIdentityByDeviceId,
  getIdentityById,
  getIdentityByNumber,
  isNumberReserved,
  listCrashGroups,
  listCrashVersions,
  listSessions,
  getSessionLog,
  listCalls,
  getCallLog,
  resolveCrash,
  unresolveCrash,
  listCrashOccurrences,
  getCrashReport,
  purgeCrashReports,
  getOrCreateDmConversation,
  dmConversationExists,
  createGroupConversation,
  setGroupProfile,
  setGroupRole,
  deleteMessageAsGroupAdmin,
  checkGroupPermission,
  getGroupRoles,
  getGroupInviteEpoch,
  revokeGroupInvites,
  joinGroupByInvite,
  hideMessageForIdentity,
  setMessageReaction,
  reactionsForMessages,
  setThreadState,
  deleteMessage,
  editMessage,
  consumeExpiringMessage,
  revealExpiringMessage,
  getPresenceAudienceIds,
  getPresenceForIds,
  presenceNeedsNotification,
  markIdle,
  isGuestPresenceHidden,
  listCallHistory,
  listConferenceHistory,
  getHistoryClearedAt,
  getLastCallWith,
  clearCallHistory,
  isNumberBlockedBy,
  listContacts,
  listMessages,
  searchMessages,
  listThreads,
  listUnseenMissedCalls,
  markMissedCallsSeen,
  markOnline,
  markOffline,
  markThreadRead,
  listMessageReads,
  markThreadDelivered,
  recordAttachment,
  recordCallStart,
  sendMessage,
  touchGuestExpiry,
  updateIdentityProfile,
  regenerateIdentityNumber,
  claimIdentityNumberAsAdmin,
  claimIdentityNumber,
  isUserAdmin,
  adminFindIdentities,
  setIdentityAccountType,
  upsertContact,
  getConversationParticipantIds,
  getConversationPushHeader,
  recentAutoReplyExists,
  getPublicStats,
  upsertPushSubscription,
  listPushSubscriptions,
  pushEnabledForIdentity,
  deleteOwnPushSubscription,
  setPushAlertPrefs,
  addOnlineWatch,
  takeOnlineWatchers,
  createPartyLine,
  deletePartyLine,
  getPartyLineByNumber,
  getPartyLinesByNumbers,
  listPartyLines,
  MAX_PARTY_LINES_PER_OWNER,
  claimOfflineMessageEmail,
  releaseOfflineMessageEmailClaim,
  setUserNotificationPrefs,
  OFFLINE_MESSAGE_EMAIL_COOLDOWN_MS,
  OFFLINE_MESSAGE_EMAIL_MIN_AWAY_MS,
  hasPushSubscription,
  pushReachable,
  type PresenceLite,

  canRingIdentity,
  saveAttachmentTranscript,
  saveAttachmentTranscriptAlt,
  saveMessageAlbum,
  getAlbumsForMessages,
  getAttachmentsForIdentityBatch,
  fileContentReport,
  listContentReports,
  setReportStatus,
  openReportCount,
  REPORT_REASONS,
  REPORT_CONTEXTS,
  starMessage,
  unstarMessage,
  listStarredIdsInConversation,
  listStarredMessages,
} from "./v2db";
import { publishRoutingChanged } from "./callRouting";
import { adminPurgeIdentity, guestDaysLeft } from "./purgeIdentity";
import {
  MAX_STATUS_NOTE,
  PROFILE_STATUSES,
  normalizeProfileStatus,
  normalizeStatusNote,
} from "../shared/profileStatus";
import { sendEmail, emailEnabled, wrapEmailDocument } from "./email";
import { appBaseUrl } from "./appUrl";
import { unsubscribeHeaders, unsubscribeLink } from "./unsubscribe";
import { vapidConfig, sendPushToIdentity, isAllowedWebPushEndpoint } from "./webPush";
import { messagePushPreview, messagePushTitle, messagePushBody } from "./messagePush";
import { classifyNativeToken, isVoipDeclaration, type NativeTokenKind } from "./expoPush";
import { fcmConfig } from "./fcm";
import { apnsVoipConfigured, apnsVoipConfig, apnsCredentialExpiry } from "./apnsVoip";
import { publishToIdentity, publishPresenceTo } from "./v2events";
import { projectReactions, REACTION_MAX_LENGTH } from "@shared/reactions";
import { ensureUserIdentity, markIdentityVerified, getIdentityByUserId } from "./v2db";
import { setIdentityAutoReply, autoReplyEnabledFor } from "./v2db";
import { recordSession, listSessionsForUser, revokeSession } from "./v2db";
import { setSessionGeo } from "./v2db";
import {
  describeLogin,
  describeLoginPlace,
  loginMethodLabel,
  normalizeLoginMethod,
  normalizeCity,
  normalizeCountry,
  normalizeLoginIp,
  type LoginMethod,
} from "./loginOrigin";
import { getRolesByIdentityIds, type IdentityRole } from "./v2db";
import { hasRecentApprovedSession, pendingSessionsForUser, sessionApprovalBySid, approveSession } from "./v2db";
// v2.105.15 — the admin's registration SUGGESTION for a guest. `activeRegInvite` is
// the one reader of the expiry rule, shared by whoami and the admin panel.
import { activeRegInvite, clearRegInvite, inviteGuestRegistration } from "./v2db";
// v2.105.16 — group roster management. `admitGroupMember` is the ONE writer for
// "somebody becomes a member after the group existed", shared with the invite-link
// route so the history watermark cannot come to mean two different things.
import {
  admitGroupMember,
  getGroupMembersCanAdd,
  removeGroupMember,
  setGroupMembersCanAdd,
} from "./v2db";
import { setSessionCookie, rememberToTtlMs, LOCAL_SESSION_COOKIE, newSessionId, readLocalSession,
  unlockPasswordLogin,
} from "./authLocal";
import { deviceLabelFromUA } from "./deviceLabel";
import { COOKIE_NAME } from "@shared/const";
import { normalizeEmail, isValidEmail, sha256Hex } from "./authCrypto";
import {
  mintOtp,
  latestOtp,
  lastOtpAt,
  recordOtpFailure,
  consumeOtp,
  verifyOtpHash,
  dispatchOtp,
  findUserByEmailAny,
  createOtpUser,
  markUserEmailVerified,
  clearUnverifiedCredentials,
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_COOLDOWN_MS,
} from "./authOtp";
import {
  attemptPinLogin,
  clearLoginPin,
  isValidPin,
  pinSlotsSpent,
  setLoginPin as setLoginPinDb,
  unlockLoginPin,
} from "./authPin";
import { createRateLimiter, clientIpOf, trustedProxyHops } from "./rateLimit";
// Carrier-style busy line (v2.88): pure read of the relay's in-memory registry
// ("is this pin in a room right now?"). Single-instance by design — the same
// instance serves the SSE signaling, so the read is authoritative here.
// partyLineLiveCounts (v2.89) reads the same registry for "N on the line".
// v2.91: the tiered Async variants read the local registry when this process
// serves signaling, and the Redis mirror (`relay:busypins`/`relay:plcounts`)
// when it's an API-tier instance behind the scale-out ALB (REDIS_URL set, no
// local relay clients). Single-instance deploys are byte-identical.
import { pinsInCallAsync, partyLineLiveCountsAsync, liveRoomFor, partyLineRosterFor, iceServers } from "./relay";
import { poolState } from "./voipPool";

/**
 * #121 — the leading group of an account's 6-digit number, for the sign-in screen
 * to echo back once the email is typed ("so we will know that this is your ID").
 *
 * MASKED, never whole: see the note at the `numberHint` field for why. Returns
 * null for an account with no identity yet, for a malformed stored number, and on
 * ANY read failure — a sign-in must never break because a decoration could not be
 * resolved, and a wrong hint is worse than none.
 */
export function maskNumber(n: string | null | undefined): string | null {
  return typeof n === "string" && /^\d{6}$/.test(n) ? `${n.slice(0, 3)}-•••` : null;
}

async function maskedNumberForUser(userId: number): Promise<string | null> {
  try {
    return maskNumber((await getIdentityByUserId(userId))?.number);
  } catch {
    return null;
  }
}

/**
 * Offline-message email (v2.99.13). CONTENT-FREE by design (owner: "it will
 * tell him you received a message but NOT put the contents — log in to see
 * it"): no sender name, no body, no thread — just a nudge + an Open button.
 * appUrl is env-derived (APP_URL/DOMAIN) or null; with no env we omit the
 * button (same rule as the missed-call email — a relative href is dead in a
 * mail client and a Host-derived one is spoofable).
 */
function messageWaitingHtml(opts: { appUrl: string | null; unsubscribeUrl?: string | null }): string {
  const button = opts.appUrl
    ? `\n    <a href="${opts.appUrl}/app" style="display:inline-block;background:#3FE0C5;color:#04201B;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:12px">Open RELAY</a>`
    : "";
  // A visible one-click opt-out, not just the List-Unsubscribe header (v2.99.40)
  // — plenty of mail clients don't surface the header, and this is the one email
  // RELAY sends that the recipient didn't ask for. The link needs no sign-in.
  const unsub = opts.unsubscribeUrl
    ? ` <a href="${opts.unsubscribeUrl}" style="color:#8A93A2;text-decoration:underline">Unsubscribe from these emails.</a>`
    : "";
  return wrapEmailDocument(
    `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#0E1014">
    <div style="font-size:20px;font-weight:800;letter-spacing:-0.02em">RELAY</div>
    <p style="font-size:16px;line-height:1.5;margin:18px 0 6px">You have messages waiting on RELAY.</p>
    <p style="font-size:14px;color:#5A6271;margin:0 0 22px">Log in to read them — we don't include message contents in email.</p>${button}
    <p style="font-size:12px;color:#8A93A2;margin-top:28px">You're receiving this because message notifications are on for your RELAY account. You can turn them off in Profile → Notifications.${unsub}</p>
  </div>`,
    "Messages waiting · RELAY"
  );
}

/**
 * text/plain twin of `messageWaitingHtml`. Written by hand rather than derived,
 * because `stripHtml` drops anchors together with their hrefs — so the derived
 * fallback mentioned the unsubscribe link without ever giving its URL.
 */
function messageWaitingText(opts: { appUrl: string | null; unsubscribeUrl?: string | null }): string {
  const lines = [
    "RELAY",
    "",
    "You have messages waiting on RELAY.",
    "Log in to read them — we don't include message contents in email.",
  ];
  if (opts.appUrl) lines.push("", `Open RELAY: ${opts.appUrl}/app`);
  lines.push(
    "",
    "You're receiving this because message notifications are on for your RELAY account.",
    "You can turn them off in Profile → Notifications."
  );
  if (opts.unsubscribeUrl) lines.push(`Or unsubscribe here: ${opts.unsubscribeUrl}`);
  return lines.join("\n");
}

/**
 * How long this identity has been away, in ms — or null when we can't tell
 * (no presence row, no timestamp). Callers treat null as "no opinion" and fall
 * through rather than guessing, so a missing row never suppresses a
 * notification on its own.
 */
function awayForMs(presence: PresenceLite | undefined): number | null {
  if (!presence) return null;
  // IDLE (v2.99.92): a backgrounded app keeps heartbeating — that is what stops it
  // decaying to offline after two minutes — so `lastSeenAt` no longer answers "how
  // long have they been away" and would report a few seconds forever. `idleSince`
  // records when they went away rather than when they last beat, which is why it is
  // a timestamp and not a flag.
  if (presence.isOnline) {
    if (!presence.idle || !presence.idleSince) return null;
    const since = new Date(presence.idleSince).getTime();
    if (!Number.isFinite(since)) return null;
    return Math.max(0, Date.now() - since);
  }
  const seen = presence.lastSeenAt ? new Date(presence.lastSeenAt).getTime() : NaN;
  if (!Number.isFinite(seen)) return null;
  return Math.max(0, Date.now() - seen);
}

export const NumberSchema = z
  .string()
  .regex(/^\d{6}$/, { message: "Number must be 6 digits" });

const DisplayNameSchema = z
  .string()
  .trim()
  .min(1, "Name is required")
  .max(64, "Name is too long");

/**
 * Avatar URL — accepts either an absolute URL (e.g. an external CDN
 * link) or a server-relative storage path emitted by our `storagePut`
 * helper, which returns `/manus-storage/{key}` (the platform serves it
 * via signed redirect). `z.string().url()` only accepts absolute URLs,
 * which would reject every avatar that came from our own upload
 * endpoint.
 */
/**
 * SECURITY (M27 — avatar-as-tracking-beacon): an avatar URL may point at OUR OWN
 * storage or be an inline data: image. Arbitrary `http(s)://` URLs used to be
 * accepted, which made a profile photo a remote-fetch primitive aimed at other
 * users' browsers — and the avatar is rendered on the INCOMING-CALL RING CARD,
 * which appears with no interaction from the callee. So an attacker could set
 * their avatar to `http://their-host/x.png`, dial a victim, and harvest the
 * victim's IP address and User-Agent from a call the victim never answered —
 * deanonymizing them on demand. It also fired from thread lists, contact rows,
 * and in-call tiles, giving a passive read on when a target is looking at them.
 *
 * This is the same threat the status-background sanitizer already rejects
 * `url(...)` for ("so an author can't turn a status into a tracking beacon that
 * phones home from every viewer's browser"), and it cuts directly against this
 * app's stated no-tracing goal — so it gets the same answer.
 *
 * No compatibility cost: every client path sets this from our own upload
 * endpoint (always a `/manus-storage/…` key) or clears it to null, and it is
 * never re-sent on an unrelated profile edit. This gates WRITES only, so any
 * pre-existing row keeps rendering exactly as before.
 */
const AvatarUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .refine(
    v => v.startsWith("/manus-storage/") || v.startsWith("data:image/"),
    { message: "Invalid avatar URL" }
  );

const GUEST_DAYS_MS = 30 * 24 * 60 * 60 * 1000; // DB-side guest row TTL (not the cookie)

/**
 * Guest cookie options. v2.95 (owner spec: guests are "session-only, wiped on
 * logout/close"): the guest cookie is now a SESSION cookie — NO `maxAge`/
 * `expires`, so the browser drops it on close. Paired with the sessionStorage
 * device-id (client/src/lib/deviceId.ts), BOTH halves of the guest-survival
 * mechanism die on browser close, so a fresh session mints a brand-new guest.
 * Within a session the cookie is shared across tabs and survives reloads, so the
 * number stays stable while the browser is open. The DB row keeps a 30-day TTL
 * as a backstop reaper bound; the cookie, not the row, gates access.
 */
function guestCookieOptions(req: Parameters<typeof getSessionCookieOptions>[0]) {
  return getSessionCookieOptions(req);
}

/**
 * Require any identity (guest or registered). Throws UNAUTHORIZED otherwise.
 */
function requireIdentity(ctx: { identity: unknown }) {
  const id = ctx.identity as {
    id: number;
    number: string;
    displayName: string;
    isGuest: boolean;
    /* Carried so `identityTier` can answer guest-vs-registered with NO database work.
     * `getRolesByIdentityIds` fails soft by design (it backs a badge), so without this
     * a DB blip would read a registered caller as a guest — which for the invite-link
     * audience gate means refusing somebody a link was minted for. */
    verified: boolean;
  } | null;
  if (!id) throw new TRPCError({ code: "UNAUTHORIZED", message: "No identity" });
  return id;
}

/**
 * The caller's account tier — the app's own three-tier rule (v2.99.6): `admin` when
 * their `users` row says so, else `registered` when the identity is verified, else
 * `guest`.
 *
 * ONE EXPRESSION, because there are now three readers (whoami's badge, and the
 * invite link's audience gate at both preview and accept). Two copies of "which
 * tier is this" is how a badge and a gate come to disagree about the same person —
 * and here that disagreement would mean a screen offering a Join button that the
 * accept then refuses.
 *
 * `getRolesByIdentityIds` swallows its own failure (it backs a badge, so it must
 * never break a payload), which is why the fallback is derived from the already-
 * resolved identity row rather than from a second query: the guest/registered half
 * of the answer is available without any database work at all, and only the
 * admin/registered distinction depends on the join.
 */
async function identityTier(identity: { id: number; verified?: boolean }): Promise<IdentityRole> {
  return (
    (await getRolesByIdentityIds([identity.id])).get(identity.id) ??
    (identity.verified ? "registered" : "guest")
  );
}

/**
 * Hard ceiling on bytes inlined into a `revealExpiring` response. Kept at the
 * original 30MB so no legitimate view-once clip regresses (a 60s video note is
 * ≈20MB), but now enforced against the STREAM rather than a trusted
 * `content-length` header — see the bounded read loop in `revealExpiring`.
 */
const REVEAL_MAX_INLINE_BYTES = 30 * 1024 * 1024;

/**
 * AGGREGATE ceiling for the same endpoint (v2.99.49).
 *
 * ── SELF-REVIEW: M23 BOUNDED ONE OBJECT, NOT THE PROCESS ── the per-request cap
 * stopped a single unbounded read, and M23's own comment reasoned that the per-IP
 * throttle covered the rest. It does not: tRPC batching lets ONE HTTP request
 * carry many `revealExpiring` calls, and the shared `statusGate` bucket permits a
 * 60-burst — so ~60 reveals of a 30MB attachment could be in flight at once, each
 * holding the buffer, its `Buffer.concat` copy, a ~40MB base64 string and the
 * JSON response body. That is >100MB of live heap per entry against a
 * `max_memory_restart: "1G"`, `instances: 1` process — and that single process
 * holds the ENTIRE in-memory signaling registry plus every open SSE stream, with
 * `/api/relay/*` ALB-pinned to it. An OOM restart therefore drops every call on
 * the fleet, not just the attacker's request.
 *
 * So concurrency and total in-flight bytes are bounded too. Over budget answers
 * "try again" WITHOUT burning the message — the reveal must stay retryable,
 * because a burn the reader never saw is unrecoverable data loss.
 */
const REVEAL_MAX_CONCURRENT = 2;
const REVEAL_MAX_INFLIGHT_BYTES = 60 * 1024 * 1024;
let revealInFlight = 0;
let revealInFlightBytes = 0;

/** Reserve a slot for one inline read, or null when the process is at budget. */
function reserveRevealSlot(): { release: (bytes: number) => void } | null {
  if (revealInFlight >= REVEAL_MAX_CONCURRENT) return null;
  if (revealInFlightBytes >= REVEAL_MAX_INFLIGHT_BYTES) return null;
  revealInFlight++;
  let released = false;
  return {
    release: (bytes: number) => {
      if (released) return;
      released = true;
      revealInFlight = Math.max(0, revealInFlight - 1);
      revealInFlightBytes = Math.max(0, revealInFlightBytes - bytes);
    },
  };
}
/** Exported for tests — the counters are process-global by design. */
export function revealBudgetState(): { inFlight: number; bytes: number } {
  return { inFlight: revealInFlight, bytes: revealInFlightBytes };
}

/* ── auth/identity router ─────────────────────────────────────── */

/**
 * SECURITY (M21): `startGuest` MINTS a brand-new identity — an `identities` row
 * plus a permanent claim on one of the ~980,000 available 6-digit numbers — and
 * it is `publicProcedure` reachable with no cookie and no credential. It was the
 * only unauthenticated *resource-creating* endpoint with NO throttle at all
 * (every comparable one already has a gate: directoryGate, otpGate,
 * partyLineGate, statusGate, the upload buckets, the storage-proxy limiter).
 *
 * That mattered more than a normal write endpoint because the 6-digit space is
 * FINITE and, in practice, never reclaimed: `numberTaken` treats a row's mere
 * existence as "taken" (it does not consider guest expiry) and nothing anywhere
 * deletes identities, while M20's `number_reservations` ledger is deliberately
 * monotonic. So each unthrottled call permanently consumed one number. Drained
 * far enough, `allocateSharedNumber`'s 40-attempt random search starts failing
 * for EVERYONE — and once it does, every new guest, every registration, and
 * every party-line creation fails with "could not allocate a unique 6-digit
 * number", with no recovery path short of manual DB surgery. A slow, permanent,
 * unauthenticated denial of service on all new onboarding.
 *
 * Sized against the real shape of the traffic. Only the ALLOCATING branch is
 * metered (see the call site), and `startGuest` is invoked from exactly one
 * place — the "Enter as guest" form submit.
 *
 * ── SELF-REVIEW (v2.99.49): THE SIZING RATIONALE WAS WRONG ── v2.99.45 raised the
 * burst on the argument that "returning visitors cost nothing". They do not:
 * guest identity is deliberately SESSION-scoped (the device id lives in
 * `sessionStorage` and the guest cookie is a session cookie, so both halves die
 * on browser close), which means the SAME person spends a fresh token every
 * browser session. Demand therefore tracks sessions/day, not distinct people, and
 * a large shared egress (carrier CGNAT, an office, a school, a conference) is
 * governed by the SUSTAINED rate — which was still only 0.2/s, i.e. the 13th
 * visitor per minute got a hard TOO_MANY_REQUESTS on the one screen that gets a
 * person into the product, with no client-side retry. Raising the burst fixed the
 * spike and left the steady state broken.
 *
 * Sustained is now ~1/s, and the real ceiling on the finite resource moved to the
 * GLOBAL mint budget inside `allocateSharedNumber` (v2.99.49) — which is the
 * correct shape: a global counter protects a global resource, whereas a per-IP
 * counter mostly punishes whoever shares an address.
 * Honors RELAY_RATELIMIT_OFF like every other gate.
 */
const guestMintIpLimiter = createRateLimiter({ capacity: 60, refillPerSec: 1 });
setInterval(() => guestMintIpLimiter.sweep(Date.now(), 60 * 60_000), 60 * 60_000).unref();
function guestMintGate(ctx: { req: unknown }) {
  if (process.env.RELAY_RATELIMIT_OFF === "1") return;
  if (!guestMintIpLimiter.allow(clientIpOf(ctx.req as Parameters<typeof clientIpOf>[0]), Date.now())) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "Too many sign-in attempts from this network. Try again shortly.",
    });
  }
}

export const v2AuthRouter = router({
  /**
   * Return whatever identity is attached to the current request.
   * Used by the client to decide between "show name input" and
   * "show app shell" without a redirect.
   */
  whoami: publicProcedure.query(async ({ ctx }) => {
    if (!ctx.identity) return null;
    // Touch the guest cookie so 30-day countdown resets on activity.
    if (ctx.identity.isGuest) {
      try {
        await touchGuestExpiry(ctx.identity.id);
      } catch {
        /* swallow */
      }
    }
    // Registered users: surface their validated email (read-only on the profile).
    let email: string | null = null;
    if (ctx.identity.userId != null) {
      try {
        const u = await getUserById(ctx.identity.userId);
        email = u?.email ?? null;
      } catch {
        /* email is best-effort */
      }
    }
    // Three-tier badge (v2.99.6): guest / registered / admin. Via the shared reader,
    // so the badge and the invite-link audience gate cannot disagree about a tier.
    const role: IdentityRole = await identityTier(ctx.identity);
    return {
      id: ctx.identity.id,
      number: ctx.identity.number,
      displayName: ctx.identity.displayName,
      avatarUrl: ctx.identity.avatarUrl,
      isGuest: ctx.identity.isGuest,
      guestExpiresAt: ctx.identity.guestExpiresAt,
      email,
      bio: ctx.identity.bio,
      allCallsToVoicemail: ctx.identity.allCallsToVoicemail === true,
      statusOverride: (ctx.identity.statusOverride as "" | "away" | "travel" | null) ?? "",
      // The profile LABEL (v2.101.1) — separate from the presence override above,
      // and normalized on the way out so a hand-edited row cannot render a label
      // the client has no entry for.
      profileStatus: normalizeProfileStatus(ctx.identity.profileStatus),
      statusNote: normalizeStatusNote(ctx.identity.statusNote),
      mobiles: ctx.identity.mobiles,
      socials: ctx.identity.socials,
      verified: ctx.identity.verified,
      role,
      firstName: ctx.identity.firstName,
      lastName: ctx.identity.lastName,
      /** Away auto-reply, opt-in (v2.99.66) — drives the Messages toggle. */
      autoReplyEnabled: ctx.identity.autoReplyEnabled,
      /**
       * An admin's SUGGESTED registration address (v2.105.15), or null.
       *
       * Threaded through `activeRegInvite` rather than read off the row, so the
       * expiry rule has exactly one reader and this cannot disagree with what the
       * admin panel shows. It reaches only the person it is about — whoami is
       * scoped to `ctx.identity` — and it is a SUGGESTION the guest can edit, not
       * a binding, so seeing it costs them nothing.
       */
      regInvite: (() => {
        const inv = activeRegInvite(ctx.identity);
        return inv ? { email: inv.email, expiresAt: inv.expiresAt } : null;
      })(),
    };
  }),

  /**
   * Dismiss an admin's registration suggestion (v2.105.15).
   *
   * Scoped to the CALLER'S OWN identity — it takes no id at all, so there is no
   * way to clear somebody else's. The guest is the only person for whom the hint
   * is on screen, so they are the only person who needs to be able to remove it.
   */
  dismissRegInvite: publicProcedure.mutation(async ({ ctx }) => {
    if (!ctx.identity) throw new TRPCError({ code: "UNAUTHORIZED" });
    await clearRegInvite(ctx.identity.id);
    return { ok: true as const };
  }),

  /**
   * Start (or restart) a guest session.
   *
   * The resolution order is strict, and was completely reworked in
   * v2.1.0 to fix the "my number changes randomly / accounts collide"
   * class of bug:
   *
   *   1. Cookie or device-id already resolved to an identity in ctx?
   *      Reuse it. The context resolver has already done the heavy
   *      lifting; we just re-issue a fresh cookie so the 30-day window
   *      doesn't drift.
   *   2. No ctx identity, but the caller's device id maps to an
   *      existing guest row? Return THAT row. This is the survival
   *      path when the cookie was dropped between page loads but the
   *      browser is the same as before.
   *   3. Neither — mint a brand-new identity, bind the device id, and
   *      issue a cookie.
   *
   * The displayName is now treated as a hint for case (3) only: in
   * cases (1) and (2) we keep the existing row's displayName so a
   * silent rename can't happen behind the user's back.
   */
  startGuest: publicProcedure
    .input(
      z.object({
        displayName: DisplayNameSchema,
        // Optional but strongly recommended — see context.ts for shape.
        deviceId: z
          .string()
          .regex(/^[a-f0-9]{16,64}$/i)
          .optional()
          .nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const deviceId =
        input.deviceId?.toLowerCase() ?? ctx.deviceId ?? null;

      // (1) Already authenticated via context.
      if (ctx.identity) {
        if (ctx.identity.isGuest && deviceId) {
          await bindDeviceIdToIdentity(ctx.identity.id, deviceId).catch(
            () => {}
          );
        }
        await touchGuestExpiry(ctx.identity.id).catch(() => {});
        return {
          id: ctx.identity.id,
          number: ctx.identity.number,
          displayName: ctx.identity.displayName,
          avatarUrl: ctx.identity.avatarUrl,
          isGuest: ctx.identity.isGuest,
          reused: true as const,
          // Adopt-and-Retire self-heal (v2.99.68): a guest row minted before this
          // release has no recovery key, so it would stay permanently unreachable
          // after a browser close. Issue one on the next visit. Returns null when
          // the row already has one — the existing key must never be replaced, or
          // the copy the browser is holding would stop working.
          recoveryKey: ctx.identity.isGuest
            ? await ensureGuestRecoveryKey(ctx.identity.id)
            : null,
        };
      }

      // (2) Survival path — cookie was dropped but device id still
      // points at a guest row. Reuse it and reissue the cookie.
      if (deviceId) {
        const byDevice = await getIdentityByDeviceId(deviceId).catch(
          () => null
        );
        if (byDevice) {
          // Re-mint a guest token so the user gets a fresh cookie
          // (the old one is gone) without changing identity.
          const freshToken = (await import("crypto")).randomBytes(24).toString(
            "hex"
          );
          const expires = new Date(Date.now() + GUEST_DAYS_MS);
          const db = await getDb();
          if (db) {
            await db
              .update(identities)
              .set({ guestToken: freshToken, guestExpiresAt: expires })
              .where(eq(identities.id, byDevice.id));
          }
          ctx.res.cookie(GUEST_COOKIE, freshToken, guestCookieOptions(ctx.req));
          return {
            id: byDevice.id,
            number: byDevice.number,
            displayName: byDevice.displayName,
            avatarUrl: byDevice.avatarUrl,
            isGuest: true as const,
            reused: true as const,
            recoveryKey: await ensureGuestRecoveryKey(byDevice.id),
          };
        }
      }

      // (3) Fresh identity. Bind the device id now.
      //
      // SELF-REVIEW (M21 refinement): the throttle belongs HERE, on the branch
      // that actually ALLOCATES, not at the top of the resolver. Cases (1) and
      // (2) above return an EXISTING identity and consume no number, yet a gate
      // at the entrance charged them a token anyway — so on a shared egress
      // (carrier CGNAT, an office, a conference, a classroom) returning visitors
      // whose cookie had been dropped would drain the bucket and then block
      // people who genuinely needed a new identity, with a hard
      // TOO_MANY_REQUESTS on the one screen that gets them into the app. The
      // resource being protected is the finite 6-digit number space, so meter
      // exactly the operation that spends it.
      guestMintGate(ctx);
      const { identity, guestToken, recoveryKey } = await createGuestIdentity({
        displayName: input.displayName,
        deviceId,
      });
      ctx.res.cookie(GUEST_COOKIE, guestToken, guestCookieOptions(ctx.req));
      return {
        id: identity.id,
        number: identity.number,
        displayName: identity.displayName,
        avatarUrl: identity.avatarUrl,
        isGuest: identity.isGuest,
        reused: false as const,
        recoveryKey,
      };
    }),

  /**
   * Explicit sign-out. Historically this only cleared the guest cookie, but a
   * sign-out must end EVERY session flavor on this browser (v2.88): an upgraded
   * member could carry a live `relay_session` (email-OTP/PIN login) and/or an
   * `app_session_id` (OAuth) alongside the guest cookie, so "signing out" left
   * them silently signed in on the next visit.
   */
  signOutGuest: publicProcedure.mutation(async ({ ctx }) => {
    const opts = guestCookieOptions(ctx.req);
    ctx.res.clearCookie(GUEST_COOKIE, { ...opts, maxAge: -1 });
    const sess = getSessionCookieOptions(ctx.req);
    ctx.res.clearCookie(LOCAL_SESSION_COOKIE, { ...sess, maxAge: -1 });
    ctx.res.clearCookie(COOKIE_NAME, { ...sess, maxAge: -1 });
    return { ok: true };
  }),

  /**
   * SELF-SERVE ACCOUNT DELETION (v2.107.52) — Apple App Store Guideline 5.1.1(v):
   * "apps that support account creation must also offer account deletion." The
   * admin path above deletes SOMEBODY ELSE and is gated on `requireAdmin`; this
   * one lets the signed-in person erase THEIR OWN identity, which is the exact
   * capability the guideline requires and the one the app did not have.
   *
   * Same cascade, one inversion. `adminPurgeIdentity` REFUSES a caller equal to
   * its target — that guard exists so an admin cannot orphan the deployment by
   * deleting themselves through the admin tool. Here self-deletion IS the whole
   * point, so `actingIdentityId` is passed as `null`: the guard is skipped and
   * the identical tombstone-number-then-cascade runs. Nothing about the erase
   * differs between "an admin deleted you" and "you deleted yourself" — only who
   * is allowed to ask, so only the authorization wrapper changes.
   *
   * `me.id` is re-derived from the session on THIS request (whoami), so the
   * target is never client-supplied: a caller can only ever delete the identity
   * the cookie already proves they are. There is no `identityId` input by
   * construction, which is what makes it safe to run under the plain
   * `protectedProcedure` that any signed-in user reaches.
   */
  deleteMyAccount: publicProcedure.mutation(async ({ ctx }) => {
    const me = requireIdentity(ctx);
    // actingIdentityId=null → the self-guard in adminPurgeIdentity is bypassed on
    // purpose. The number is tombstoned (never reissued) exactly as in the admin
    // path, so a number the person shared can't later resurface as someone else.
    const res = await adminPurgeIdentity(me.id, null);
    if (!res.ok) {
      const map: Record<
        typeof res.reason,
        { code: "CONFLICT" | "NOT_FOUND" | "INTERNAL_SERVER_ERROR"; message: string }
      > = {
        "not-eligible": {
          code: "CONFLICT",
          message: "This account can't be deleted right now.",
        },
        "not-found": {
          code: "NOT_FOUND",
          message: "Your account is already being deleted.",
        },
        unavailable: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Couldn't complete the deletion. Please try again.",
        },
      };
      const m = map[res.reason];
      throw new TRPCError({ code: m.code, message: m.message, cause: res.reason });
    }
    // The identity row is gone; sever the session cookies too so the next request
    // mints a fresh guest rather than 500ing against an identity that no longer
    // exists. The exact three cookies `signOutGuest` clears — guest, local
    // session, OAuth session — because a member could carry any combination.
    // Best-effort: the identity is ALREADY erased, which is the part the guideline
    // is about — a lingering cookie only means one dead whoami before re-mint.
    try {
      const opts = guestCookieOptions(ctx.req);
      ctx.res.clearCookie(GUEST_COOKIE, { ...opts, maxAge: -1 });
      const sess = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(LOCAL_SESSION_COOKIE, { ...sess, maxAge: -1 });
      ctx.res.clearCookie(COOKIE_NAME, { ...sess, maxAge: -1 });
    } catch {
      /* cookie teardown is a convenience; the erase above already happened */
    }
    console.warn(
      `[self-delete] identity ${me.id} (${res.number ?? "no number"}, account: ${res.hadAccount}) deleted their own account`
    );
    return { ok: true as const, hadAccount: res.hadAccount };
  }),

  /**
   * REPORT CONTENT (v2.107.52) — Apple App Store Guideline 1.2: users must be
   * able to flag objectionable content. The signed-in person files a report
   * against another identity, optionally pinned to a specific message; it lands
   * in `content_reports` for admin review within the 24h window the guideline
   * requires.
   *
   * `reportedId` is client-supplied (you report a person you are looking at), but
   * `reporterId` is always `me.id` from the session — a caller can file AS nobody
   * but themselves. Filing a report against yourself is refused: it is either a
   * mistake or an attempt to pollute the queue, and neither is a real report.
   *
   * `snapshot` is the reported text captured at report time so the record
   * survives the sender later unsending it — a report whose evidence vanishes the
   * moment the reported party deletes it would defeat its own purpose.
   */
  reportContent: publicProcedure
    .input(
      z.object({
        reportedId: z.number().int().positive(),
        messageId: z.number().int().positive().nullish(),
        context: z.enum(REPORT_CONTEXTS),
        reason: z.enum(REPORT_REASONS),
        note: z.string().max(1000).nullish(),
        snapshot: z.string().max(2000).nullish(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const me = requireIdentity(ctx);
      if (input.reportedId === me.id) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You can't report yourself.",
        });
      }
      try {
        await fileContentReport({
          reporterId: me.id,
          reportedId: input.reportedId,
          messageId: input.messageId ?? null,
          context: input.context,
          reason: input.reason,
          note: input.note ?? null,
          snapshot: input.snapshot ?? null,
        });
      } catch {
        // Fail-LOUD, unlike telemetry: a report the user believes they filed must
        // actually be recorded, so a storage outage surfaces and they can retry.
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Couldn't submit your report. Please try again.",
        });
      }
      console.warn(
        `[report] identity ${me.id} reported ${input.reportedId} (${input.context}/${input.reason}${input.messageId ? `, msg ${input.messageId}` : ""})`
      );
      return { ok: true as const };
    }),

  /**
   * Star / unstar a message (v2.107.53). A private per-user bookmark. The DB layer
   * gates star on membership, so passing input.messageId here can only ever pin a
   * message the caller may already read — no id-guessing across rooms. requireIdentity
   * (sync) supplies the identity; there is no identityId input by construction.
   */
  setMessageStar: publicProcedure
    .input(
      z.object({
        messageId: z.number().int().positive(),
        starred: z.boolean(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const me = requireIdentity(ctx);
      const res = input.starred
        ? await starMessage(me.id, input.messageId)
        : await unstarMessage(me.id, input.messageId);
      if (!res.ok) {
        // star returns !ok when the message isn't the caller's to see; surface it
        // rather than pretending the star landed.
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Couldn't update the star.",
        });
      }
      return { ok: true as const, starred: input.starred };
    }),

  /** The caller's starred message-ids within ONE conversation — the client marks
   *  bubbles from this, keeping the star overlay off the message read hot path. */
  starredIdsInConversation: publicProcedure
    .input(z.object({ conversationId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const me = requireIdentity(ctx);
      return { ids: await listStarredIdsInConversation(me.id, input.conversationId) };
    }),

  /** The caller's starred messages across every conversation, newest star first —
   *  the "Starred" view. Membership re-checked in the query, so a star from a room
   *  the person has left, or a since-deleted message, drops out. */
  starredMessages: publicProcedure
    .input(z.object({ limit: z.number().int().positive().max(500).optional() }).optional())
    .query(async ({ ctx, input }) => {
      const me = requireIdentity(ctx);
      const rows = await listStarredMessages(me.id, input?.limit ?? 200);
      return { messages: rows };
    }),

  /**
   * ADOPT-AND-RETIRE, step 1: what does this recovery key name? (v2.99.68)
   *
   * Read-only. Answers with the identity's number, name and a footprint the entry
   * screen shows verbatim — "restore 601-586 · 14 contacts, 320 messages" — because
   * a restore prompt the user cannot verify is one they should not tap.
   *
   * A key that names nothing returns null rather than an error: the browser may be
   * holding a record for an identity that has since been registered (in which case
   * signing in is the way back) and a dead record must not turn the entry screen
   * into an error screen. `directoryGate` bounds the database work; brute force is
   * not the threat (the key is 256 bits) but an unmetered DB read is.
   */
  guestRecoveryPreview: publicProcedure
    .input(z.object({ key: z.string().min(1).max(200) }))
    .query(async ({ ctx, input }) => {
      directoryGate(ctx);
      const key = normalizeRecoveryKey(input.key);
      if (!key) return null;
      const found = await findRecoverableGuestIdentity(
        hashRecoveryKey(key)
      ).catch(() => null);
      if (!found) return null;
      const footprint = await identityFootprint(found.id).catch(() => null);
      return {
        number: found.number,
        displayName: found.displayName,
        avatarUrl: found.avatarUrl,
        // Negative counts mean "could not read", so report null rather than a
        // confident zero — the prompt says "your data" instead of naming figures
        // it cannot stand behind.
        footprint:
          footprint && Object.values(footprint).every(n => n >= 0)
            ? footprint
            : null,
      };
    }),

  /**
   * ADOPT-AND-RETIRE, step 2: take it. (v2.99.68)
   *
   * Binds this browser (or, for a signed-in caller, this account) to the recovered
   * identity and retires the empty one it was using. The recovered identity keeps
   * its own 6-digit number, so everybody who saved it still reaches this person —
   * which is the whole reason recovery is preferable to "here is a new number".
   *
   * Refusals are named rather than collapsed into a generic failure, because each
   * one has a different correct next step for the user, and `current-has-data` in
   * particular must never be silently resolved by throwing one side away.
   */
  adoptGuestRecovery: publicProcedure
    .input(
      z.object({
        key: z.string().min(1).max(200),
        deviceId: z
          .string()
          .regex(/^[a-f0-9]{16,64}$/i)
          .optional()
          .nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      directoryGate(ctx);
      const key = normalizeRecoveryKey(input.key);
      if (!key) return { ok: false as const, reason: "not-found" as const };
      const deviceId = input.deviceId?.toLowerCase() ?? ctx.deviceId ?? null;
      const res = await adoptRecoveredIdentity({
        recoveryHash: hashRecoveryKey(key),
        currentIdentityId: ctx.identity?.id ?? null,
        currentUserId: ctx.user?.id ?? null,
        deviceId,
      });
      if (!res.ok) return { ok: false as const, reason: res.reason };
      // A guest adoption mints a fresh guest token for the recovered row, so this
      // browser resolves it the ordinary way on every later request — no special
      // case anywhere else. A registered adoption has no token by design: the
      // account's own session cookie is already the credential.
      if (res.guestToken) {
        ctx.res.cookie(
          GUEST_COOKIE,
          res.guestToken,
          guestCookieOptions(ctx.req)
        );
      }
      return {
        ok: true as const,
        number: res.identity.number,
        displayName: res.identity.displayName,
        isGuest: res.identity.isGuest,
      };
    }),

  /**
   * Update display name or avatar URL on the current identity.
   */
  updateProfile: publicProcedure
    .input(
      z.object({
        displayName: DisplayNameSchema.optional(),
        avatarUrl: AvatarUrlSchema.nullable().optional(),
        bio: z.string().max(500).nullable().optional(),
        statusOverride: z.enum(["", "away", "travel"]).optional(),
        // The five the owner named, plus "" to clear. A closed enum rather than a
        // free string, because this label is shown to everybody who looks the
        // person up and the server must not store one no surface can render.
        profileStatus: z.enum(["", ...PROFILE_STATUSES]).optional(),
        statusNote: z.string().max(MAX_STATUS_NOTE).optional(),
        mobiles: z.array(z.string().max(32)).max(20).optional(),
        socials: z
          .array(z.object({ platform: z.string().max(20), value: z.string().max(200) }))
          .max(20)
          .optional(),
        /** Global "send all my calls to voicemail" master switch (v2.107.48). */
        allCallsToVoicemail: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const me = requireIdentity(ctx);
      // SECURITY (avatar-laundering, F2 + QA H5): an avatar URL that references
      // our storage MUST point into the caller's OWN upload namespace. Without
      // this a user could set avatarUrl to ANOTHER user's private attachment key
      // — authorizeStorageKey's "is this some identity's current avatar?" rescue
      // (isIdentityAvatarKey) matches the key as a SUFFIX (`%/manus-storage/<key>`),
      // so the storage proxy would serve that key to anyone, even unauthenticated
      // (and it survives the sender's unsend). The ORIGINAL gate only covered a
      // RELATIVE `/manus-storage/…` URL — an ABSOLUTE `https://host/manus-storage/
      // <victim-key>` slipped straight past it (that suffix still matches the
      // rescue). Validate the key after the LAST `/manus-storage/` so BOTH shapes
      // are gated. Pure data:/external-CDN URLs (no `/manus-storage/`) never
      // resolve through our proxy, so they're untouched.
      if (input.avatarUrl) {
        const marker = "/manus-storage/";
        const mi = input.avatarUrl.lastIndexOf(marker);
        if (mi !== -1) {
          const key = input.avatarUrl.slice(mi + marker.length);
          if (!keyInOwnerNamespace(key, me.id, s3Config()?.prefix ?? "")) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid avatar image." });
          }
        }
      }
      // updateIdentityProfile sanitizes mobiles/socials/status server-side.
      // Apple 1.2 — the display name and status note are broadcast to everyone who
      // looks this person up, so they are UGC-filtered before they are stored. Only
      // the two free-text, publicly-shown fields; the enums and structured fields
      // can't carry a slur. sanitizeUgcText passes undefined straight through, so an
      // update that doesn't touch these fields is unchanged.
      const filteredInput = {
        ...input,
        ...(input.displayName !== undefined
          ? { displayName: sanitizeUgcText(input.displayName) }
          : {}),
        ...(input.statusNote !== undefined
          ? { statusNote: sanitizeUgcText(input.statusNote) }
          : {}),
      };
      await updateIdentityProfile(me.id, filteredInput);
      // v2.107.48: if the global voicemail switch moved, refresh this user's
      // routing across boxes so the ring-time cache reflects it. Fire-and-forget.
      if (Object.prototype.hasOwnProperty.call(input, "allCallsToVoicemail")) {
        void publishRoutingChanged(me.number);
      }
      const fresh = await getIdentityById(me.id);
      return fresh;
    }),

  /**
   * Regenerate the caller's 6-digit number and AUTO-PROPAGATE it to every
   * contact that saved the old number, so their contacts keep reaching them
   * without re-adding. The relay engine adopts the new number on the client's
   * next whoami (see RelayEngine's setPreferredPin reconcile).
   */
  /**
   * Turn the away auto-reply on or off (v2.99.66). Guests included — the pref
   * lives on the identity, so it works before registration and survives it.
   */
  setAutoReply: publicProcedure
    .input(z.object({ enabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const me = requireIdentity(ctx);
      await setIdentityAutoReply(me.id, input.enabled);
      return { ok: true, enabled: input.enabled };
    }),

  regenerateNumber: publicProcedure.mutation(async ({ ctx }) => {
    const me = requireIdentity(ctx);
    // SECURITY (M41): the sibling of M21. Each regeneration permanently claims
    // another of the ~980,000 six-digit numbers — `numberTaken` treats any
    // existing row as taken and M20's reservation ledger is monotonic, so the
    // old number is never recycled either. Unthrottled, ONE authenticated
    // account could therefore drain the shared space on its own and break number
    // allocation for every future signup, which is exactly the permanent,
    // unrecoverable onboarding DoS M21 closed on the guest-minting side. It also
    // renumbers the caller across every contact who saved them, so hammering it
    // is abusive regardless. Reuse the guest-mint budget: nobody legitimately
    // changes their number more than a handful of times.
    guestMintGate(ctx);
    const result = await regenerateIdentityNumber(me.id);
    const fresh = await getIdentityById(me.id);
    return {
      number: fresh?.number ?? me.number,
      previousNumber: result?.oldNumber ?? me.number,
    };
  }),

  /**
   * Move onto a number the person CHOSE (v2.99.75).
   *
   * Same permanent claim on the shared 6-digit space as `regenerateNumber`, and
   * the same propagation — everyone who saved the old number is rewritten inside
   * the same transaction, so contacts, blocks, threads, messages and call history
   * all follow the person rather than the digits. Hence the same M41 mint gate.
   *
   * REGISTERED ACCOUNTS ONLY, and that is a deliberate policy rather than an
   * implementation limit. A chosen number is first-come and permanent (the
   * reservation ledger never recycles), so leaving it open to guests would let an
   * ephemeral, unverified session squat the memorable numbers — and a guest
   * identity is session-scoped, so the number would be stranded the moment the
   * browser closed. Proving an email is a low bar that makes the claim
   * accountable to an account that persists.
   */
  setNumber: publicProcedure
    .input(z.object({ number: z.string().min(1).max(32) }))
    .mutation(async ({ ctx, input }) => {
      const me = requireIdentity(ctx);
      if (me.isGuest || !ctx.user) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Choosing your own number needs a registered account.",
        });
      }
      guestMintGate(ctx);
      const res = await claimIdentityNumber(me.id, input.number);
      if (!res.ok) {
        // NAMED refusals: each one has a different correct next step, and
        // collapsing them into one message would tell somebody whose typo was
        // rejected to go and pick a different number.
        const map: Record<typeof res.reason, { code: "BAD_REQUEST" | "CONFLICT" | "NOT_FOUND" | "TOO_MANY_REQUESTS" | "INTERNAL_SERVER_ERROR"; message: string }> = {
          invalid: {
            code: "BAD_REQUEST",
            message: "That isn't a valid RELAY number — six digits, not starting 000 or 111.",
          },
          taken: { code: "CONFLICT", message: "That number is already in use." },
          budget: {
            code: "TOO_MANY_REQUESTS",
            message: "Too many numbers claimed just now — try again shortly.",
          },
          "not-found": { code: "NOT_FOUND", message: "Identity not found." },
          unavailable: {
            code: "INTERNAL_SERVER_ERROR",
            message: "Couldn't change your number — nothing was changed.",
          },
        };
        const m = map[res.reason];
        throw new TRPCError({ code: m.code, message: m.message, cause: res.reason });
      }
      const fresh = await getIdentityById(me.id);
      return {
        number: fresh?.number ?? res.newNumber,
        previousNumber: res.oldNumber,
        unchanged: res.unchanged,
      };
    }),
});

/* ── directory (numbers / lookups) ────────────────────────────── */

export interface GeoSelfResult {
  ip: string | null;
  country: string | null;
  countryName: string | null;
  city: string | null;
  flagEmoji: string | null;
}

const GEO_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const geoCache = new Map<
  string,
  { value: GeoSelfResult; expiresAt: number }
>();

/** Reset the in-process cache. Used by tests. */
export function _resetGeoCache(): void {
  geoCache.clear();
}

/**
 * Convert an ISO 3166-1 alpha-2 country code into the matching flag
 * emoji by mapping each ASCII letter to its regional-indicator codepoint.
 * Returns null for invalid input.
 */
export function flagEmojiFromIso2(
  code: string | null | undefined
): string | null {
  if (!code) return null;
  const c = code.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) return null;
  const A = 0x1f1e6 - "A".charCodeAt(0);
  return String.fromCodePoint(c.charCodeAt(0) + A, c.charCodeAt(1) + A);
}

/**
 * Best-effort extraction of the caller's public IP from an Express
 * request. Honors `CF-Connecting-IP` and `X-Forwarded-For`, falling
 * back to `req.ip`. Strips IPv6-mapped IPv4 prefixes.
 *
 * SECURITY (F4): the `X-Forwarded-For` entry we trust is the one the front
 * proxy APPENDED (`trustedProxyHops()` positions from the right), NOT the
 * client-supplied leftmost hop — otherwise a spoofed header defeats per-IP
 * limits (see clientIpOf). `CF-Connecting-IP` is only meaningful when Cloudflare
 * is actually the front proxy; it stays first for that deployment.
 */
export function pickClientIp(req: {
  headers: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string | null };
  ip?: string;
}): string | null {
  const cf = req.headers["cf-connecting-ip"];
  if (typeof cf === "string" && cf.trim()) {
    return cf.trim().replace(/^::ffff:/i, "");
  }
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.trim()) {
    const hops = xff.split(",").map((s) => s.trim()).filter(Boolean);
    if (hops.length) {
      const trusted = hops[Math.max(0, hops.length - trustedProxyHops())];
      if (trusted) return trusted.replace(/^::ffff:/i, "");
    }
  }
  if (req.ip) return req.ip.replace(/^::ffff:/i, "");
  const sock = req.socket?.remoteAddress;
  if (sock) return sock.replace(/^::ffff:/i, "");
  return null;
}

/** Returns true for IPs we should not run a public geo lookup against. */
export function isPrivateOrLocalIp(ip: string): boolean {
  if (!ip) return true;
  if (ip === "127.0.0.1" || ip === "::1") return true;
  if (ip.startsWith("10.")) return true;
  if (ip.startsWith("192.168.")) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true;
  if (ip.startsWith("169.254.")) return true;
  if (ip.startsWith("fc") || ip.startsWith("fd") || ip.startsWith("fe80:")) {
    return true;
  }
  return false;
}

/**
 * Resolve an IP to a country / city / flag, cached in-process for 12h.
 *
 * EXTRACTED from the `geoSelf` procedure in v2.100.1 so the sign-in capture and
 * the flag chip in the top bar use ONE implementation. Two copies of "which
 * country is this IP" is how the two would come to disagree about the same login,
 * and the whole point of putting a place on an approval prompt is that the owner
 * can trust it.
 *
 * Never throws and never rejects: an unreachable geo service, a timeout, a private
 * address or a GeoIP miss all yield nulls with the IP preserved, because the IP is
 * the one detail we always have and the UI is built to omit the rest.
 */
export async function resolveGeoForIp(ip: string | null): Promise<GeoSelfResult> {
  const empty: GeoSelfResult = {
    ip: null,
    country: null,
    countryName: null,
    city: null,
    flagEmoji: null,
  };
  if (!ip) return empty;
  if (isPrivateOrLocalIp(ip)) return { ...empty, ip };

  const cached = geoCache.get(ip);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(`https://ipapi.co/${encodeURIComponent(ip)}/json/`, {
      signal: ctrl.signal,
      headers: { "User-Agent": "relay-chat-video/2.0" },
    });
    clearTimeout(timer);
    if (!res.ok) return { ...empty, ip };
    const json = (await res.json()) as {
      country_code?: string | null;
      country_name?: string | null;
      city?: string | null;
      error?: boolean;
    };
    if (json.error) return { ...empty, ip };
    const country = (json.country_code || "").trim().toUpperCase() || null;
    const out: GeoSelfResult = {
      ip,
      country,
      countryName: json.country_name || null,
      city: json.city || null,
      flagEmoji: flagEmojiFromIso2(country),
    };
    geoCache.set(ip, { value: out, expiresAt: Date.now() + GEO_CACHE_TTL_MS });
    return out;
  } catch {
    return { ...empty, ip };
  }
}

// SECURITY (F5): the directory endpoints are intentionally PUBLIC (an
// unidentified visitor opening an `/i/<pin>` call link resolves the callee via
// `lookup` before entering a name), but `lookup` reveals a number's existence,
// display name, avatar, verified badge, and live presence. With no throttle the
// 10^6 number space is a free scrape of the whole user directory. A generous
// per-IP token bucket (120 burst, ~60/min sustained) is invisible to any real
// dialer yet turns a full enumeration into a multi-day, obvious grind. Keyed on
// the trusted client IP (see clientIpOf) and honoring RELAY_RATELIMIT_OFF like
// every other gate here.
const directoryIpLimiter = createRateLimiter({ capacity: 120, refillPerSec: 1 });
setInterval(() => directoryIpLimiter.sweep(Date.now(), 30 * 60_000), 30 * 60_000).unref();
/**
 * `cost` is OPTIONAL and defaults to 1 (v2.99.81), so the eleven existing
 * `directoryGate(ctx)` call sites are untouched.
 *
 * It exists because a BATCH endpoint does N times the work of a single lookup for
 * one token: `presenceMany` resolves up to 100 numbers per call and `presence` up
 * to 200 ids, so at a flat one token each their enumeration throttle was 100x and
 * 200x weaker than `lookup`'s — and both drop unknown entries, which makes each
 * one an existence probe. Charged sub-linearly so real batch users stay well
 * inside the budget.
 */
function directoryGate(ctx: { req: unknown }, cost = 1) {
  if (process.env.RELAY_RATELIMIT_OFF === "1") return;
  if (!directoryIpLimiter.allow(clientIpOf(ctx.req as Parameters<typeof clientIpOf>[0]), Date.now(), cost)) {
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many lookups. Try again shortly." });
  }
}

export const v2DirectoryRouter = router({
  /** Look up a single number — returns null when unknown. Party-line numbers
   *  (v2.89) resolve FIRST (same precedence as the dial path) and return the
   *  line's title + live head-count instead of a person. */
  lookup: publicProcedure
    .input(z.object({ number: NumberSchema }))
    .query(async ({ input, ctx }) => {
      directoryGate(ctx);
      const line = await getPartyLineByNumber(input.number).catch(() => null);
      if (line) {
        const memberCount =
          (await partyLineLiveCountsAsync([line.number])).get(line.number) ?? 0;
        return {
          id: line.id,
          number: line.number,
          displayName: line.title,
          avatarUrl: null as string | null,
          isOnline: memberCount > 0,
          lastSeenAt: null as Date | null,
          statusOverride: "" as "" | "away" | "travel",
          profileStatus: null as string | null, // a line is not a person
          statusNote: null as string | null,
          presenceHidden: false,
          verified: false,
          role: null as IdentityRole | null, // a line is not a person — no badge
          inCall: false,
          partyLine: true,
          // A line is always reachable: joining rings nobody, you just land on the
          // room — so an empty line must stay joinable, which is the point of a line.
          reachable: true,
          memberCount,
        };
      }
      const id = await getIdentityByNumber(input.number);
      if (!id) return null;
      const [pres] = await getPresenceForIds([id.id]);
      /* CAN A CALL TO THEM RING ANYTHING? Presence answers "is a socket open", which
         is NOT the same question and is the wrong one to gate a call on: presence is
         bound to a live socket session, so backgrounding the app or locking the phone
         drops it — and a backgrounded phone is precisely what a VoIP push wakes.
         Reachability is therefore `a live socket OR a device we can push a ring to`.

         Emitted ALONGSIDE `isOnline`, never instead of it — an older client ignores
         the field and keeps today's behaviour, and presence stays what it always was
         for showing status.

         REPORTED HONESTLY EVEN WHEN PRESENCE IS SUPPRESSED, deliberately. The v2.95
         privacy rule hides whether somebody is online RIGHT NOW; this says only that
         a call could reach a device. Withholding it would refuse calls to exactly the
         long-inactive guests the suppression protects, which is the bug rather than
         the privacy. Nothing new is disclosed either: this endpoint already returns
         their name, avatar, badge and tier for any number, so "has the app" is
         already implied — and it stays behind `directoryGate`'s throttle. */
      const reachable = (pres?.isOnline ?? false) || (await canRingIdentity(id.id));
      // Privacy: a guest inactive >24h shows NO status at all.
      const hidden = isGuestPresenceHidden({
        isGuest: id.isGuest,
        isOnline: pres?.isOnline ?? false,
        lastSeenAt: pres?.lastSeenAt ?? null,
      });
      return {
        id: id.id,
        number: id.number,
        displayName: id.displayName,
        // First/last name (v2.99.18): registered users have these split; the
        // landing dialer + previews show "First Last" explicitly (owner asked
        // the preview to show "the name first and last"). Null for guests.
        firstName: id.firstName,
        lastName: id.lastName,
        avatarUrl: id.avatarUrl,
        isOnline: hidden ? false : (pres?.isOnline ?? false),
        // v2.99.92 — signed in but backgrounded. Emitted alongside `isOnline`, never
        // instead of it, so an older client simply ignores it and keeps today's
        // reading. Suppressed with everything else when presence is hidden.
        idle: hidden ? false : (pres?.idle ?? false),
        lastSeenAt: hidden ? null : (pres?.lastSeenAt ?? null),
        statusOverride: hidden ? "" : ((id.statusOverride as "" | "away" | "travel" | null) ?? ""),
        // WITHHELD when presence is hidden, with everything else: a guest inactive
        // over a day has presence suppressed for privacy (v2.95), and "On vacation ·
        // back Monday" would leak exactly what the suppression withholds — in words,
        // which is worse than a dot.
        profileStatus: hidden ? null : normalizeProfileStatus(id.profileStatus),
        statusNote: hidden ? null : normalizeStatusNote(id.statusNote),
        presenceHidden: hidden,
        reachable,
        verified: id.verified,
        // Three-tier badge (v2.99.6): guest / registered / admin.
        role: ((await getRolesByIdentityIds([id.id])).get(id.id) ??
          (id.verified ? "registered" : "guest")) as IdentityRole | null,
        // Carrier-style busy line (v2.88): they're ON A CALL right now.
        inCall: hidden ? false : (await pinsInCallAsync([id.number])).has(id.number),
        // How long before a GUEST identity is deleted (v2.100.0, owner: *"for the
        // guest, the blue badge, when you enter to their profile, it will show you
        // that they will be deleted after certain days ... the number of days and
        // the countdown"*). NULL — the field is OMITTED, never 0 — for anybody who
        // is not an expiring guest, so a registered account cannot render one.
        //
        // No new information class: the figure is derived purely from how long ago
        // they last opened RELAY, which `lastSeenAt` on this same payload has stated
        // outright since v2.99.66.
        guestDaysLeft: guestDaysLeft(id.guestExpiresAt),
        partyLine: false,
        memberCount: 0,
      };
    }),

  /**
   * Is this number HELD in the reservation ledger? (v2.107.x) A number can be reserved
   * without being a person — an admin-reserved vanity pattern (000000, 121212, …) or a
   * tombstoned number. The dialer asks this ONLY when `lookup` already resolved to
   * nobody, so it can tell a HELD number ("Reserved by admin") apart from a genuinely
   * free one ("No RELAY user with this number"). Behind the same `directoryGate`
   * throttle, and it discloses nothing a `lookup` did not already imply. Kept as its
   * OWN query on purpose, so the lookup payload — and every one of its consumers —
   * stays exactly as it was.
   */
  reserved: publicProcedure
    .input(z.object({ number: NumberSchema }))
    .query(async ({ input, ctx }) => {
      directoryGate(ctx);
      return { reserved: await isNumberReserved(input.number) };
    }),

  /**
   * Live-call rejoin (v2.99.9): is `number` in a still-alive call the CALLER
   * was previously part of? Returns the live roster + host so History can show
   * a "Live now · N in the call · hosted by X · Join" card. Privacy-safe: the
   * registry reader only returns data when the caller's own number is in that
   * room's roster (you can only see a call you were in — no enumeration/
   * eavesdrop oracle). Null on a non-signaling instance (degrades to no card).
   */
  liveRoom: publicProcedure
    .input(z.object({ number: NumberSchema }))
    .query(async ({ input, ctx }) => {
      directoryGate(ctx);
      const me = ctx.identity;
      if (!me || !/^\d{6}$/.test(me.number)) return null;
      const info = liveRoomFor(input.number, me.number);
      if (!info) return null;
      return {
        roomId: info.roomId,
        count: info.count,
        hostName: info.hostName,
        startedAt: info.startedAt,
        // Names only (no pins) — the caller was in this call, but we still don't
        // hand back a machine-dialable roster of everyone's numbers.
        members: info.members.map((m) => ({ name: m.name, role: m.role })),
      };
    }),

  /**
   * #109 — the extra facts the INVITE screen needs about a PARTY LINE, and
   * nothing else.
   *
   * `directory.lookup` already answers everything the screen shows for a PERSON
   * (name, avatar, badge, presence, on-a-call), so this deliberately covers only
   * the case it cannot: a line's title, when it was created, who created it, and
   * who is on it right now. A number that is not a party line returns null, which
   * is what keeps the disclosure below scoped to lines.
   *
   * WHY A LINE MAY LIST ITS OCCUPANTS AND A CALL MAY NOT. A party line is a
   * deliberately-shared, dial-to-enter room: its owner created it to hand round,
   * anybody holding the number can walk in, and the moment they do they see the
   * same roster from the inside — the in-call tiles have shown each peer's name
   * and digits since v2.105.24. So the only thing this adds is seeing it a second
   * BEFORE joining instead of a second after. A private call is the opposite on
   * every count, which is why `directory.liveRoom` stays gated on the requester
   * having been in the room.
   *
   * IT STILL RETURNS NO OCCUPANT'S NUMBER, and that is not symmetry for its own
   * sake. Numbers are enumerable (10^6, throttled but public), so this endpoint is
   * effectively readable by anybody — and a machine-readable list of the 6-digit
   * numbers of everybody currently on a line is a harvesting endpoint, whereas
   * joining to read the same digits off the tiles is an ACT: the count moves and
   * every person already there sees you arrive. Visible harvesting is a real
   * difference from silent harvesting. The line's OWN number is returned, because
   * it is the link the caller is already holding.
   */
  inviteCard: publicProcedure
    .input(z.object({ number: NumberSchema }))
    .query(async ({ input, ctx }) => {
      directoryGate(ctx);
      const line = await getPartyLineByNumber(input.number).catch(() => null);
      if (!line) return null;
      const owner = await getIdentityById(line.ownerIdentityId).catch(() => null);
      // Off the signaling node this is null, and the screen then shows the line
      // with no roster rather than asserting it is empty.
      const live = partyLineRosterFor(line.number);
      const pins = (live?.members ?? []).map((m) => m.pin);
      const rows = pins.length ? await getIdentitiesByNumbers(pins).catch(() => []) : [];
      const byNumber = new Map(rows.map((r) => [r.number, r]));
      // One batched role read for the owner AND the occupants, so a badge is the
      // real tier rather than a guess from `verified` alone.
      const ids = [
        ...(owner ? [owner.id] : []),
        ...rows.map((r) => r.id),
      ];
      const roles = ids.length
        ? await getRolesByIdentityIds(ids).catch(() => new Map<number, IdentityRole>())
        : new Map<number, IdentityRole>();
      // A NULL `verified` reads as a guest, which is what every other tier reader
      // does — the stored column is nullable and only an explicit true is a claim.
      const tierOf = (r: { id: number; verified: boolean | null }): IdentityRole =>
        roles.get(r.id) ?? (r.verified ? "registered" : "guest");
      return {
        kind: "party-line" as const,
        number: line.number,
        title: line.title,
        createdAt: line.createdAt,
        liveSince: live?.startedAt ?? null,
        liveCount: live?.members.length ?? 0,
        rosterKnown: !!live,
        owner: owner
          ? {
              // FIRST name, per the ask ("the Creator (first name + badge)"), with
              // the display name as the fallback for a guest who has no split name.
              firstName: owner.firstName || owner.displayName,
              displayName: owner.displayName,
              avatarUrl: owner.avatarUrl,
              role: tierOf(owner),
            }
          : null,
        members: (live?.members ?? []).map((m) => {
          const id = byNumber.get(m.pin);
          return {
            // NO `pin` — see the note above.
            name: id?.displayName || m.name,
            avatarUrl: id?.avatarUrl ?? null,
            role: id ? tierOf(id) : null,
            // Host / co-host in THIS room, which is what "who is host and who is
            // admin" means once a call is running. A party line has no host of
            // its own (its owner may never dial in), so this is usually "".
            callRole: m.role,
            joinedAt: m.joinedAt,
            isOwner: !!owner && !!id && id.id === owner.id,
          };
        }),
      };
    }),

  /**
   * Resolve the caller's request IP to a country (ISO 3166-1 alpha-2)
   * and a flag emoji using a free public geo service (`ipapi.co`).
   * Cached in-process for 12h per IP. Returns nulls on failure or
   * for private/loopback addresses — the UI gracefully omits the
   * flag chip when null.
   */
  geoSelf: publicProcedure.query(async ({ ctx }) => {
    return resolveGeoForIp(pickClientIp(ctx.req));
  }),

  /** Get presence for an array of identity ids. */
  presence: publicProcedure
    .input(z.object({ ids: z.array(z.number().int().positive()).max(200) }))
    .query(async ({ input, ctx }) => {
      // SECURITY (S3): throttle (this was an anonymous, unthrottled enumeration
      // of the sequential id space) and apply the SAME guest-privacy rule the
      // other directory surfaces use — a guest inactive >24h must not leak
      // presence / last-seen here when they're hidden everywhere else.
      //
      // One token per TWENTY ids (v2.99.81): the id space is sequential and so
      // cheaper to walk than the number space, but the legitimate callers here send
      // small batches, so a coarser divisor keeps them free while still pricing a
      // 200-id sweep at 10 tokens instead of 1.
      directoryGate(ctx, Math.ceil(input.ids.length / 20));
      if (input.ids.length === 0) return [];
      const [presList, idents] = await Promise.all([
        getPresenceForIds(input.ids),
        getIdentitiesByIds(input.ids),
      ]);
      const isGuestById = new Map(idents.map((i) => [i.id, i.userId == null]));
      return presList.map((p) => {
        const hidden = isGuestPresenceHidden({
          isGuest: isGuestById.get(p.identityId) ?? false,
          isOnline: p.isOnline,
          lastSeenAt: p.lastSeenAt,
        });
        return hidden ? { ...p, isOnline: false, idle: false, lastSeenAt: null } : p;
      });
    }),

  /**
   * Batched online/offline for a set of NUMBERS (one query pair, not N
   * lookups) — powers the presence LEDs on History rows so the user can see
   * BEFORE redialing whether someone is reachable. Applies the same guest
   * privacy rule as `lookup`; unknown numbers are simply omitted.
   */
  presenceMany: publicProcedure
    .input(z.object({ numbers: z.array(NumberSchema).max(100) }))
    .query(async ({ input, ctx }) => {
      // One token per TEN numbers (v2.99.81). History legitimately sends 100 every
      // 30s, which is 10 tokens per poll against a 60/min budget — comfortable —
      // while a scraper's rate drops 10x. Charged BEFORE the dedupe below, so
      // padding the array with repeats costs the same as distinct probes.
      directoryGate(ctx, Math.ceil(input.numbers.length / 10));
      const uniq = Array.from(new Set(input.numbers));
      if (uniq.length === 0) return [];
      const idents = await getIdentitiesByNumbers(uniq);
      if (idents.length === 0) return [];
      const presList = await getPresenceForIds(idents.map((i) => i.id));
      const presById = new Map(presList.map((p) => [p.identityId, p]));
      // Busy line (v2.88): one registry/Redis read for the whole batch.
      const inCallSet = await pinsInCallAsync(idents.map((i) => i.number));
      return idents.map((i) => {
        const pres = presById.get(i.id);
        const hidden = isGuestPresenceHidden({
          isGuest: i.userId == null,
          isOnline: pres?.isOnline ?? false,
          lastSeenAt: pres?.lastSeenAt ?? null,
        });
        return {
          number: i.number,
          isOnline: hidden ? false : (pres?.isOnline ?? false),
          idle: hidden ? false : (pres?.idle ?? false),
          inCall: hidden ? false : inCallSet.has(i.number),
        };
      });
    }),

  /**
   * Call-back alert (v2.88): "tell me when they're back online". Registers a
   * one-shot, 24h-expiring watch on a number; when that identity's heartbeat
   * flips them offline→online, the watcher gets a push + an SSE nudge with a
   * ready-to-dial link.
   */
  watchOnline: publicProcedure
    .input(z.object({ number: NumberSchema }))
    .mutation(async ({ ctx, input }) => {
      // SECURITY (S4): this resolves a number→identity and returns the display
      // name on a hit, so without the gate it was a free number-enumeration +
      // name-harvest oracle over the 10^6 space (bypassing the F5 throttle on
      // its sibling directory endpoints). Same per-IP bucket as lookup.
      directoryGate(ctx);
      const me = requireIdentity(ctx);
      const target = await getIdentityByNumber(input.number);
      if (!target) {
        throw new TRPCError({ code: "NOT_FOUND", message: "That number isn't a RELAY user yet." });
      }
      if (target.id === me.id) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "That's your own number." });
      }
      // M18: if the TARGET has blocked me, I must not be able to arm a
      // back-online watch on them — otherwise blocking wouldn't stop a blocked
      // caller from being told (with the target's name + a ready-to-dial link)
      // the moment they come back online. Respond IDENTICALLY to "not a RELAY
      // user" so the block itself is never revealed (mirrors the openThread /
      // createGroup / call-invite block gates).
      if (await isNumberBlockedBy(target.id, me.number)) {
        throw new TRPCError({ code: "NOT_FOUND", message: "That number isn't a RELAY user yet." });
      }
      await addOnlineWatch(me.id, target.id);
      return { ok: true, displayName: target.displayName, number: target.number };
    }),

  /**
   * Heartbeat: mark me online and bump my lastSeenAt. Client should call
   * this every ~30s while the app is open.
   */
  heartbeat: publicProcedure.mutation(async ({ ctx }) => {
    const me = requireIdentity(ctx);
    const { becameOnline } = await markOnline(me.id, null);
    // Only push presence to people who care (contacts + conversation peers), and
    // only on an actual offline->online transition — not on every 30s tick.
    // Fire-and-forget; failures don't affect the heartbeat result.
    if (becameOnline) {
      try {
        const audience = await getPresenceAudienceIds(me.id, me.number);
        publishPresenceTo(audience, me.number, true, new Date());
      } catch {
        /* ignore */
      }
      // Call-back alerts (v2.88): consume one-shot watches on this identity —
      // every unexpired watcher gets an SSE nudge (in-app toast, instant) AND
      // a push (reaches them if RELAY is closed), with a ready-to-dial link.
      try {
        const watchers = await takeOnlineWatchers(me.id);
        for (const watcherId of watchers) {
          publishToIdentity(watcherId, {
            kind: "watched_online",
            number: me.number,
            name: me.displayName,
          });
          sendPushToIdentity(watcherId, {
            kind: "contact-online",
            title: `${me.displayName || me.number} is back online`,
            body: "You asked to be told — tap to call them now.",
            tag: `relay-online-${me.number}`,
            url: `/app/dialer?to=${me.number}&voice=1`,
          }).catch(() => {});
        }
      } catch {
        /* watches are best-effort */
      }
    }
    /* THE AUTHORITATIVE NUMBER, CARRIED BACK ON EVERY BEAT (v2.106.86).
     *
     * Owner: "his pin is 543-101. when he was online I changed his PIN to 222-222.
     * he was calling me after the change [and it] is showing me his old pin on the
     * call, but the front end showing the new pin."
     *
     * Both halves of that are explained by ONE stale value. The signaling registry
     * is in memory and keyed on the 6-digit PIN, and a client only ever registers a
     * pin it believes is its own — so a renumber must reach the CLIENT before the
     * routing layer can be right. Three paths were supposed to make that happen and
     * all three miss the case the owner hit:
     *
     *   - the `number` SSE event, fired by `notifyNumberChanged` — but the operator
     *     CLI (`scripts/admin-tool.mjs`) writes STRAIGHT to MySQL, importing only
     *     `mysql2/promise`, so no server hook can fire. Its own header says so.
     *   - `whoami`'s `refetchOnWindowFocus` (v2.99.83), added as the backstop for
     *     exactly that path — but an app sitting in the FOREGROUND never blurs, so
     *     it never refetches. He was online, which is precisely when it cannot fire.
     *   - a reload, which is a thing the user has to think of doing.
     *
     * So he stayed registered as 543101 indefinitely: his calls carried the old pin,
     * the owner's client offered to save it as a new contact, and the address book
     * ended up holding both numbers for one person — the second symptom, from the
     * same cause.
     *
     * This costs NOTHING to add and closes the class rather than the instance.
     * `requireIdentity` has already re-read the identity row for this request, so the
     * true number is in hand; returning it lets the client notice a change made by
     * ANY writer — the CLI, a direct SQL edit, a future tool nobody has written yet —
     * within one beat. No new query, no new endpoint, no new secret, and no second
     * implementation of the propagation rule.
     *
     * The client compares and invalidates `whoami`; `setPreferredPin` then does the
     * re-register it has always done. The server does not compare, because it would
     * have to be TOLD what the client thinks its number is, and a value the client
     * supplies is a worse authority than the one we just read. */
    return { ok: true, at: new Date(), number: me.number };
  }),

  /**
   * "I went to the background" — the idle beat (v2.99.92).
   *
   * Owner: *"whenever you minimize the app, the user showing offline, not the idle."*
   * Minimising used to fire the go-offline beacon below, so switching apps for five
   * seconds read as OFFLINE to every contact.
   *
   * Deliberately does NOT fan a presence SSE event. The person is still online as far
   * as `isOnline` goes, so the boolean every SSE consumer reads has not changed —
   * publishing `true` again would be a no-op that costs an audience query on every
   * background/foreground flip, and publishing `false` would be the bug. Idle reaches
   * the UI on the next ordinary presence read, which is the honest cadence for a
   * signal that means "not looking right now".
   */
  markIdle: publicProcedure.mutation(async ({ ctx }) => {
    const me = requireIdentity(ctx);
    await markIdle(me.id);
    return { ok: true };
  }),

  /** Explicit "I'm leaving" beacon. */
  goOffline: publicProcedure.mutation(async ({ ctx }) => {
    const me = requireIdentity(ctx);
    await markOffline(me.id);
    try {
      const audience = await getPresenceAudienceIds(me.id, me.number);
      publishPresenceTo(audience, me.number, false, new Date());
    } catch {
      /* ignore */
    }
    return { ok: true };
  }),
});

/* ── contacts router ──────────────────────────────────────────── */

export const v2ContactsRouter = router({
  list: publicProcedure.query(async ({ ctx }) => {
    const me = requireIdentity(ctx);
    const rows = await listContacts(me.id);
    // Resolve every contact's identity in ONE query (was N+1: one per contact).
    /* GUARDED for the same reason the presence and busy-line reads below are, and this one
     * was missed on the first pass — `getIdentitiesByNumbers` is `db.select()` with no
     * try/catch of its own, so a rejection propagated out of the resolver and the owner's
     * ENTIRE directory became "We couldn't load your contacts". `identities` is a different
     * table from `presence`, so it is an independent failure source with identical reach.
     *
     * It qualifies by the same test its siblings passed: every field the row itself shows —
     * displayName, number, favourite, blocked, notes — comes from `rows` (listContacts).
     * `idents` supplies only the LIVE decorations: the search-only live name, the current
     * avatar, the role and the verified flag. Losing those costs a photo and a badge.
     * `listContacts` above stays unguarded deliberately: that read IS the content. */
    const idents = await getIdentitiesByNumbers(rows.map((r) => r.number)).catch(() => []);
    const idByNumber = new Map(idents.map((i) => [i.number, i.id]));
    // Track which identities are guests (userId == null) for presence privacy.
    const isGuestById = new Map(idents.map((i) => [i.id, i.userId == null]));
    // Verified (blue badge) per identity.
    const verifiedById = new Map(idents.map((i) => [i.id, i.verified]));
    // Three-tier badge (v2.99.6): guest / registered / admin, one batched query.
    const rolesById = await getRolesByIdentityIds(idents.map((i) => i.id));
    // LIVE profile photo per number (v2.96): the contact row's avatarUrl is a
    // frozen copy from save-time — the peer's CURRENT photo must win, else a
    // profile-photo change never propagates to anyone who saved them.
    const liveAvatarByNumber = new Map(idents.map((i) => [i.number, i.avatarUrl]));
    // LIVE display name per number (v2.99.96), for SEARCH only — never for display.
    // `contacts.displayName` is what you chose to call them and stays what the row
    // shows; but somebody saved as "Dad" was previously unfindable by their real
    // name on this screen while History (which resolves names live) found them, so
    // one person was searchable on one screen and not another.
    const liveNameByNumber = new Map(idents.map((i) => [i.number, i.displayName]));
    const ids = idents.map((i) => i.id);
    /* EVERY DECORATION READ ON THIS RESOLVER FAILS SOFT, and these two were the
     * exceptions. `getRolesByIdentityIds` above already swallows its own failure by
     * design — it backs a badge — but `getPresenceForIds` has no try/catch of its own,
     * so one hiccup on the `presence` table threw out of the resolver and the caller
     * got NOTHING: the whole address book replaced by "We couldn't load your contacts",
     * which is the owner's "the contacts section is not showing" with a cause nobody
     * could see from the screen.
     *
     * A contact row is worth serving without its green dot. The projection below is
     * already written for the absent case throughout (`pres?.isOnline ?? false`,
     * `inCallSet.has(...)`), so an empty answer degrades to "nobody shown as online"
     * rather than to a broken screen — and that is the correct direction, because a
     * missing LED costs a glance while a missing directory costs the feature. */
    const presByIdentity = await getPresenceForIds(ids)
      .then((rows) => new Map(rows.map((p) => [p.identityId, p])))
      .catch(() => new Map<number, Awaited<ReturnType<typeof getPresenceForIds>>[number]>());
    // Busy line (v2.88): which saved numbers are on a call right now.
    const inCallSet = await pinsInCallAsync(idents.map((i) => i.number)).catch(
      () => new Set<string>(),
    );
    return rows.map((r) => {
      const ident = idByNumber.get(r.number);
      const pres = ident != null ? presByIdentity.get(ident) : undefined;
      // Privacy: a guest inactive >24h shows NO status at all.
      const hidden = isGuestPresenceHidden({
        isGuest: ident != null ? (isGuestById.get(ident) ?? true) : true,
        isOnline: pres?.isOnline ?? false,
        lastSeenAt: pres?.lastSeenAt ?? null,
      });
      return {
        id: r.id,
        number: r.number,
        displayName: r.displayName,
        /** Their own current name. Search-only — the row still shows `displayName`. */
        liveName: liveNameByNumber.get(r.number) ?? null,
        avatarUrl: liveAvatarByNumber.get(r.number) ?? r.avatarUrl,
        favourite: r.favourite,
        notes: r.notes,
        email: r.email ?? null,
        phone: r.phone ?? null,
        company: r.company ?? null,
        jobTitle: r.jobTitle ?? null,
        website: r.website ?? null,
        birthday: r.birthday ?? null,
        category: (r.category as "vip" | "family" | "friend" | "team" | null) ?? null,
        /* THE READ GOES THROUGH ONE RESOLVER (v2.106.14), so no surface can show a
           pre-tags contact as untagged: a row with only the legacy `category`
           resolves to that single tag. `category` is still emitted because a
           client on the previous bundle is reading it mid-deploy. */
        tags: contactTagsOf({ tags: r.tags ?? null, category: r.category ?? null }),
        blocked: r.blocked === true,
        callsToVoicemail: r.callsToVoicemail === true,
        identityId: ident ?? null,
        isOnline: hidden ? false : (pres?.isOnline ?? false),
        idle: hidden ? false : (pres?.idle ?? false),
        lastSeenAt: hidden ? null : (pres?.lastSeenAt ?? null),
        presenceHidden: hidden,
        verified: ident != null ? (verifiedById.get(ident) ?? false) : false,
        // M14: a saved number that does NOT resolve to an identity is NOT a
        // RELAY user (a made-up number, or one that never registered) — it must
        // get NO badge. Returning "guest" here rendered a blue "✓ Guest" seal
        // on a non-user. `null` (explicit) → roleFromFlags returns null → no
        // badge; a REAL identity with no admin/registered flag still defaults
        // to "guest" (correct — they ARE a guest RELAY user).
        role: (ident != null ? (rolesById.get(ident) ?? "guest") : null) as IdentityRole | null,
        inCall: hidden ? false : inCallSet.has(r.number),
      };
    });
  }),

  upsert: publicProcedure
    .input(
      z.object({
        number: NumberSchema,
        displayName: z.string().trim().max(64).nullable().optional(),
        avatarUrl: AvatarUrlSchema.nullable().optional(),
        favourite: z.boolean().optional(),
        notes: z.string().max(2000).nullable().optional(),
        email: z.string().trim().max(320).email("Invalid email address").nullable().optional(),
        phone: z
          .string()
          .trim()
          .max(40)
          .nullable()
          .optional()
          .refine(
            v => !v || (/^[+\d\s().-]+$/.test(v) && (v.match(/\d/g) || []).length >= 4),
            { message: "Phone must contain at least 4 digits and only phone characters" }
          ),
        company: z.string().trim().max(128).nullable().optional(),
        jobTitle: z.string().trim().max(128).nullable().optional(),
        // Restricted to http(s) — without this, a contact's "website" could be
        // set to a javascript:/data: URI. It's never rendered as a clickable
        // link anywhere today, but validating at the boundary means that stays
        // true even if a future UI change adds one without re-auditing this field.
        website: z
          .string()
          .trim()
          .max(256)
          .nullable()
          .optional()
          .refine(v => !v || /^https?:\/\//i.test(v), { message: "Must start with http:// or https://" }),
        birthday: z.string().trim().max(32).nullable().optional(),
        /** Contact group for the categorized list (v2.82). Since v2.106.14 this is
         *  a DERIVED MIRROR of the first tag — still accepted so an older client
         *  keeps working, where it lands as the single tag. */
        category: z.enum(["vip", "family", "friend", "team"]).nullable().optional(),
        /** Contact tags, ordered — the first is the row chip (DATA-CONTRACTS §1).
         *  A CLOSED enum, so a client cannot invent a fifth tag that every reader
         *  would then have to drop; bounded at 4 because that is how many exist. */
        tags: z.array(z.enum(["vip", "family", "friend", "team"])).max(4).optional(),
        /** Block this number: their calls auto-decline, their 1:1 messages are rejected. */
        blocked: z.boolean().optional(),
        /** Send THIS number's calls to voicemail (v2.107.48): calls-only, opt-in;
         *  chat is unaffected. Distinct from `blocked`. */
        callsToVoicemail: z.boolean().optional(),
        /** Explicit-rename opt-in — only the edit dialog sends this. Without it a
         *  provided displayName cannot replace an existing alias (see upsertContact). */
        overwriteName: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const me = requireIdentity(ctx);
      if (input.number === ctx.identity!.number) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You can't add yourself as a contact",
        });
      }
      /* The array arrives from the client; the store keeps the serialized form.
         Converted HERE rather than widening `upsertContact`'s signature, so the
         writer has exactly one representation to reason about. */
      const { tags, ...rest } = input;
      const row = await upsertContact({
        ownerId: me.id,
        ...rest,
        ...(tags ? { tags: serializeContactTags(tags) } : {}),
      });
      // v2.107.48: a change to who-goes-to-voicemail must reach the box holding
      // this user's live socket so the ring-time cache reflects it. Fire-and-forget.
      if (Object.prototype.hasOwnProperty.call(input, "callsToVoicemail")) {
        void publishRoutingChanged(me.number);
      }
      return row;
    }),

  remove: publicProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const me = requireIdentity(ctx);
      await deleteContact(me.id, input.id);
      return { ok: true };
    }),
});

/* ── messages router ──────────────────────────────────────────── */

/**
 * AVATAR LAUNDERING (v2.98.4/F2, and v2.99.26/H5 for the absolute form): a storage key must
 * be in the CALLER's own namespace, or a group could be pointed at a stranger's private
 * attachment and the proxy would serve it to everyone in that group.
 *
 * ONE function, two callers (v2.106.66). It was inline in `setGroupProfile`, and the moment
 * `createGroup` also accepted an avatar that became a rule with two homes — which is exactly
 * how the second one comes to be written without it. `lastIndexOf` rather than a prefix test
 * because the ABSOLUTE form (`https://host/manus-storage/<key>`) must be gated too: the
 * storage proxy matches the key as a SUFFIX, so an absolute URL naming a stranger's key
 * resolves through it just as a relative one does (H5).
 */
function assertOwnedAvatarUrl(avatarUrl: string | null | undefined, identityId: number): void {
  if (!avatarUrl) return;
  const marker = "/manus-storage/";
  const at = avatarUrl.lastIndexOf(marker);
  if (at < 0) return; // a data: URL or an external CDN never resolves through our proxy
  const key = avatarUrl.slice(at + marker.length);
  if (!keyInOwnerNamespace(key, identityId)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "That image isn't yours to use." });
  }
}

export const v2MessagesRouter = router({
  threads: publicProcedure.query(async ({ ctx }) => {
    const me = requireIdentity(ctx);
    const base = await listThreads(me.id);
    if (base.length === 0) return [];
    const otherIds = base.map((b) => b.otherIdentityId);
    const pres = await getPresenceForIds(otherIds);
    const byId = new Map(pres.map((p) => [p.identityId, p]));
    // Resolve the peer's verified (blue-badge) flag in one batched query.
    const peerIdents = await getIdentitiesByIds(otherIds);
    const verifiedById = new Map(peerIdents.map((i) => [i.id, i.verified]));
    // Three-tier badge (v2.99.6): guest / registered / admin, one batched query.
    const rolesById = await getRolesByIdentityIds(otherIds);
    // Guest-presence privacy, in the FOURTH place that needs it (v2.99.77).
    //
    // Owner: *"I saw this user in the contacts one time showing online. But when I
    // went to his message or to his call history ... is offline."* `contacts.list`,
    // `directory.presence` and `directory.presenceMany` all put presence through
    // `isGuestPresenceHidden`; this resolver did not. So for a stale GUEST the
    // thread list said online while every other surface said offline — one rule,
    // four call sites, and the fourth forgot it. Exactly the class of bug this
    // codebase keeps re-learning.
    const peerIsGuestById = new Map(peerIdents.map((i) => [i.id, i.userId == null]));
    return base.map((b) => {
      const p = byId.get(b.otherIdentityId);
      const presenceHidden = isGuestPresenceHidden({
        isGuest: peerIsGuestById.get(b.otherIdentityId) ?? false,
        isOnline: p?.isOnline ?? false,
        lastSeenAt: p?.lastSeenAt ?? null,
      });
      return {
        conversationId: b.conversationId,
        kind: b.kind,
        title: b.title,
        // The GROUP's own identity (v2.102.0) — null for a DM, and null for a group
        // created before this release. Named `group*` rather than reusing the `peer*`
        // fields on purpose: a group is not a peer, and one field meaning two things
        // is how a surface comes to render a group's id as a person's.
        groupNumber: b.groupNumber,
        groupAvatarUrl: b.groupAvatarUrl,
        groupStatus: b.groupStatus,
        groupStatusNote: b.groupStatusNote,
        // Swipe-action state (v2.103.0) — so the row can render the pin marker, the
        // hand-marked-unread dot, and which way the swipe buttons should read.
        pinned: b.pinned,
        archived: b.archived,
        manualUnread: b.manualUnread,
        memberCount: b.memberCount,
        peerIdentityId: b.otherIdentityId,
        peerNumber: b.otherNumber,
        peerDisplayName: b.otherDisplayName,
        peerAvatarUrl: b.otherAvatarUrl,
        peerIsOnline: presenceHidden ? false : (p?.isOnline ?? false),
        peerIdle: presenceHidden ? false : (p?.idle ?? false),
        peerLastSeenAt: presenceHidden ? null : (p?.lastSeenAt ?? null),
        peerVerified: verifiedById.get(b.otherIdentityId) ?? false,
        peerRole: (rolesById.get(b.otherIdentityId) ?? "guest") as IdentityRole,
        lastMessageAt: b.lastMessageAt,
        lastMessageBody: b.lastMessagePreview,
        lastMessageKind: b.lastMessageKind,
        /* #115 — two narrow booleans, so the row can say what a bare reaction emoji
           was about. Threaded EXPLICITLY, like every other field here: the raw `meta`
           deliberately never reaches the browser, because it carries the replied-to
           story's own text excerpt and a one-line row has no room for it. */
        lastMessageStatusReply: b.lastMessageStatusReply,
        lastMessageMine: b.lastMessageMine,
        lastMessageStatus: b.lastMessageStatus,
        lastMessageSender: b.lastMessageSender,
        unreadCount: b.unreadCount,
      };
    });
  }),

  /**
   * Open or create a 1:1 conversation with the given number. Passing
   * the caller's own number creates (or returns) a private "note to
   * self" thread — useful for saving links, ideas, or attachments.
   */
  openThread: publicProcedure
    .input(z.object({ number: NumberSchema }))
    .mutation(async ({ ctx, input }) => {
      // SECURITY: openThread resolves number→identity (NOT_FOUND vs a hit is an
      // existence oracle) AND returns the target's display name + avatar AND
      // plants a DM thread in the target's inbox — strictly worse than the
      // directory endpoints F5/S3–S5 already throttled. Apply the same per-IP
      // gate so it can't be looped to scrape the 10^6 number space (names +
      // avatars) or spam arbitrary users' inboxes with empty threads. The
      // `/i/<pin>` call-link flow uses directory.lookup, not this, so no
      // legitimate path is affected. Honors RELAY_RATELIMIT_OFF.
      directoryGate(ctx);
      const me = requireIdentity(ctx);
      const other = await getIdentityByNumber(input.number);
      if (!other) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "That number isn't a RELAY user yet",
        });
      }
      const isSelf = other.id === me.id;
      // SECURITY: a target who has BLOCKED the caller must not be reachable
      // via a brand-new thread — otherwise blocking is trivially pointless,
      // since anyone can force an empty DM into the victim's inbox with no
      // consent and (today) no way for the victim to delete/leave it. Only
      // gate the FRESH-creation case: a conversation that already existed
      // before the block keeps working, exactly like 1:1 send-blocking never
      // retroactively hides prior history. Respond identically to "unknown
      // number" so the block itself is never revealed to the blocked caller.
      if (!isSelf && !(await dmConversationExists(me.id, other.id))) {
        if (await isNumberBlockedBy(other.id, me.number)) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "That number isn't a RELAY user yet",
          });
        }
      }
      const convo = await getOrCreateDmConversation(me.id, other.id);
      return {
        conversationId: convo.id,
        otherIdentityId: other.id,
        otherNumber: other.number,
        otherDisplayName: isSelf ? "Notes (You)" : other.displayName,
        otherAvatarUrl: other.avatarUrl,
        isSelf,
      };
    }),

  /**
   * Convenience procedure: open (or create) the caller's note-to-self
   * thread without needing to know their own number first. The client
   * uses this to power the "Note to self" quick action in the New
   * Conversation dialog.
   */
  openSelfThread: publicProcedure.mutation(async ({ ctx }) => {
    const me = requireIdentity(ctx);
    const convo = await getOrCreateDmConversation(me.id, me.id);
    return {
      conversationId: convo.id,
      otherIdentityId: me.id,
      otherNumber: me.number,
      otherDisplayName: "Notes (You)",
      otherAvatarUrl: null,
      isSelf: true,
    };
  }),

  /**
   * Create a named group from a set of 6-digit numbers. The caller is always a
   * member. Unknown numbers are skipped (we report which resolved). Needs at
   * least one other valid member.
   */
  /**
   * Edit a GROUP's own title, photo and status (v2.102.0, owner: a group should have
   * a group ID, a group avatar and a group status).
   *
   * Members-only, and that check lives INSIDE `setGroupProfile` rather than here,
   * because it writes a row several people share — "who may change it" is the safety
   * argument and must not be something a call site can forget. The avatar URL is
   * validated with the SAME namespace gate an identity's photo uses (F2), so this
   * cannot be used to point a group at somebody else's private media.
   */
  /**
   * Hide ONE message for the caller alone — "delete for me" (v2.102.2, owner #81).
   *
   * DISTINCT FROM `remove`, which is UNSEND: that flips `deletedAt`, takes the message
   * away from EVERYBODY, and is rightly restricted to its own sender. This one changes
   * nothing for anybody else, which is why it is allowed on somebody else's message.
   *
   * Membership and idempotency both live in `hideMessageForIdentity` rather than here,
   * because a message id is a small integer and "who may hide this" is the safety
   * argument — it must not be something a second call site could forget.
   */
  /**
   * A thread's own per-person state — pin / archive / mark unread / clear (v2.103.0),
   * the actions behind the swipe row.
   *
   * ONE procedure for all four rather than four, because they write one row and four
   * endpoints would be four places that can forget the membership check. Membership is
   * enforced by the WHERE clause naming both halves of the primary key, inside
   * `setThreadState` — never here, so a second call site could not skip it.
   *
   * MUTE IS ABSENT ON PURPOSE. It stays per-DEVICE (localStorage plus the Cache Storage
   * mirror the service worker reads), because the worker has to silence a notification
   * without asking the server anything — v2.99.42's decision. Moving it here would
   * quietly reverse that and break notification muting.
   */
  setThreadState: publicProcedure
    .input(
      z.object({
        conversationId: z.number().int().positive(),
        pinned: z.boolean().optional(),
        archived: z.boolean().optional(),
        unread: z.boolean().optional(),
        clear: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const me = requireIdentity(ctx);
      const res = await setThreadState({
        conversationId: input.conversationId,
        identityId: me.id,
        pinned: input.pinned,
        archived: input.archived,
        unread: input.unread,
        clear: input.clear,
      });
      if (!res.ok) {
        if (res.reason === "not-a-member") {
          // Same answer a missing conversation would get, so this is no oracle over
          // conversation ids.
          throw new TRPCError({ code: "NOT_FOUND", message: "That conversation isn't there." });
        }
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Couldn't save that — nothing changed.",
        });
      }
      return { ok: true as const };
    }),

  hide: publicProcedure
    .input(z.object({ messageId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const me = requireIdentity(ctx);
      const res = await hideMessageForIdentity({ messageId: input.messageId, identityId: me.id });
      if (!res.ok) {
        // Named, because "that message is gone" and "you are not in that conversation"
        // need different next steps — and a member who is not in the conversation is
        // told the same thing a missing message gets, so this is no existence oracle
        // over message ids.
        if (res.reason === "not-a-member" || res.reason === "not-found") {
          throw new TRPCError({ code: "NOT_FOUND", message: "That message is no longer there." });
        }
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Couldn't hide that — nothing changed.",
        });
      }
      return { ok: true as const };
    }),

  setGroupProfile: publicProcedure
    .input(
      z.object({
        conversationId: z.number().int().positive(),
        title: z.string().max(128).optional(),
        avatarUrl: z.string().max(1024).nullable().optional(),
        profileStatus: z.enum(["", ...PROFILE_STATUSES]).optional(),
        statusNote: z.string().max(MAX_STATUS_NOTE).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const me = requireIdentity(ctx);
      assertOwnedAvatarUrl(input.avatarUrl, me.id);
      // Apple 1.2 — a group's name and status note are shown to every member, so the
      // two free-text fields are UGC-filtered before the write (undefined passes
      // through untouched, so a photo-only update is unchanged).
      const res = await setGroupProfile(input.conversationId, me.id, {
        title: input.title !== undefined ? sanitizeUgcText(input.title) : undefined,
        avatarUrl: input.avatarUrl,
        profileStatus: input.profileStatus,
        statusNote: input.statusNote !== undefined ? sanitizeUgcText(input.statusNote) : undefined,
      });
      if (!res.ok) {
        const map: Record<
          NonNullable<typeof res.reason>,
          { code: "NOT_FOUND" | "BAD_REQUEST" | "FORBIDDEN" | "INTERNAL_SERVER_ERROR"; message: string }
        > = {
          "not-found": { code: "NOT_FOUND", message: "That conversation doesn't exist." },
          "not-a-group": {
            code: "BAD_REQUEST",
            message: "That's a direct chat — its name and photo come from the person you're talking to.",
          },
          "not-a-member": { code: "FORBIDDEN", message: "Only members can change a group." },
          unavailable: { code: "INTERNAL_SERVER_ERROR", message: "Couldn't save that — nothing changed." },
        };
        const m = map[res.reason ?? "unavailable"];
        throw new TRPCError({ code: m.code, message: m.message, cause: res.reason });
      }
      return { ok: true as const };
    }),

  /**
   * Appoint or revoke a group admin (v2.104.0).
   *
   * The router performs NO check of its own — `setGroupRole` gates itself through
   * `checkGroupPermission`, because a caller must not be able to forget it. All this
   * does is give each named refusal its own message: "you're not an admin", "this group
   * has no admin", "the creator can't be demoted" and "that would leave nobody in
   * charge" need four different next steps, and a generic error sends somebody looking
   * in the wrong place.
   */
  setGroupRole: publicProcedure
    .input(
      z.object({
        conversationId: z.number().int().positive(),
        targetIdentityId: z.number().int().positive(),
        role: z.enum(["admin"]).nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const me = requireIdentity(ctx);
      const res = await setGroupRole({
        conversationId: input.conversationId,
        actorIdentityId: me.id,
        targetIdentityId: input.targetIdentityId,
        role: input.role,
      });
      if (!res.ok) {
        const map: Record<
          NonNullable<typeof res.reason>,
          { code: "NOT_FOUND" | "BAD_REQUEST" | "FORBIDDEN" | "INTERNAL_SERVER_ERROR"; message: string }
        > = {
          "not-found": { code: "NOT_FOUND", message: "That conversation doesn't exist." },
          "not-a-group": { code: "BAD_REQUEST", message: "That's a direct chat — it has no admins." },
          "not-a-member": { code: "FORBIDDEN", message: "Only members can do that." },
          "not-an-admin": { code: "FORBIDDEN", message: "Only a group admin can change who's an admin." },
          "target-not-a-member": { code: "NOT_FOUND", message: "They're not in this group." },
          "creator-cannot-be-revoked": {
            code: "BAD_REQUEST",
            message: "The person who created the group is always an admin.",
          },
          "last-admin": {
            code: "BAD_REQUEST",
            message: "Make somebody else an admin first — a group can't be left with none.",
          },
          unavailable: { code: "INTERNAL_SERVER_ERROR", message: "Couldn't save that — nothing changed." },
        };
        const m = map[res.reason ?? "unavailable"];
        throw new TRPCError({ code: m.code, message: m.message, cause: res.reason });
      }
      return { ok: true as const };
    }),

  /**
   * A group admin removes somebody else's message, for everyone (v2.104.0).
   *
   * SEPARATE from `deleteMessage` (unsend), which stays sender-only. The two have
   * different blast radii and different authority, and one endpoint serving both is how
   * somebody deletes for everyone believing they hid it for themselves.
   */
  deleteAsAdmin: publicProcedure
    .input(
      z.object({
        conversationId: z.number().int().positive(),
        messageId: z.number().int().positive(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const me = requireIdentity(ctx);
      const res = await deleteMessageAsGroupAdmin({
        messageId: input.messageId,
        conversationId: input.conversationId,
        identityId: me.id,
      });
      if (!res.ok) {
        const map: Record<
          NonNullable<typeof res.reason>,
          { code: "NOT_FOUND" | "BAD_REQUEST" | "FORBIDDEN" | "INTERNAL_SERVER_ERROR"; message: string }
        > = {
          "not-found": { code: "NOT_FOUND", message: "That message isn't in this group." },
          "not-a-group": { code: "BAD_REQUEST", message: "That's a direct chat." },
          "not-a-member": { code: "FORBIDDEN", message: "Only members can do that." },
          "not-an-admin": { code: "FORBIDDEN", message: "Only a group admin can remove someone else's message." },
          "own-message": { code: "BAD_REQUEST", message: "Use Unsend for your own message." },
          unavailable: { code: "INTERNAL_SERVER_ERROR", message: "Couldn't remove that — nothing changed." },
        };
        const m = map[res.reason ?? "unavailable"];
        throw new TRPCError({ code: m.code, message: m.message, cause: res.reason });
      }
      // Reuses the EXISTING `message` SSE kind rather than inventing one: an undeclared
      // kind is dropped by the Redis bus allowlist whenever the recipient is on the other
      // instance, and single-instance dev would look perfect (the v2.99.74 trap).
      const members = await getConversationParticipantIds(input.conversationId);
      for (const id of members) {
        if (id !== me.id) publishToIdentity(id, { kind: "message", conversationId: input.conversationId, from: me.id });
      }
      return { ok: true as const };
    }),

  createGroup: publicProcedure
    .input(
      z.object({
        title: z.string().trim().min(1).max(128),
        numbers: z.array(NumberSchema).min(1).max(19), // + creator = 20 cap
        // v2.106.66 — the owner's report: *"there is a problem with the avatar of the
        // group when you created you select avatar by default, it comes with default
        // avatar, but if you select another avatar doesn't appear."* They were right, and
        // it was never a UI bug: this schema accepted ONLY title and numbers, and a plain
        // `z.object` STRIPS unknown keys rather than rejecting them — so a client sending
        // an avatar got a silent success and a group born with a NULL photo.
        avatarUrl: z.string().max(1024).nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // SECURITY: same enumeration class as openThread — the `skipped` count
      // and BAD_REQUEST reveal which supplied numbers are real users, and
      // success force-creates a group thread in every resolved member's inbox.
      // Gate it on the shared per-IP directory bucket (honors RELAY_RATELIMIT_OFF).
      directoryGate(ctx);
      const me = requireIdentity(ctx);
      // The SAME gate `setGroupProfile` carries. Accepting an avatar here without it would
      // let a brand-new group be pointed at a stranger's private attachment, which the
      // storage proxy would then serve to every member.
      assertOwnedAvatarUrl(input.avatarUrl, me.id);
      const unique = Array.from(new Set(input.numbers)).filter((n) => n !== me.number);
      const resolved = await getIdentitiesByNumbers(unique);
      // SECURITY: a target who has blocked the creator must not be forcibly
      // addable to a BRAND-NEW group — otherwise blocking is trivially
      // bypassed (create a fresh group containing just the victim + one
      // throwaway member, and message them there). Silently exclude — fold
      // into the existing `skipped` count so the block is never revealed,
      // matching the existing "not found" secrecy on this same endpoint.
      const blockChecks = await Promise.all(
        resolved.map((m) => isNumberBlockedBy(m.id, me.number).catch(() => false))
      );
      const members = resolved.filter((_, i) => !blockChecks[i]);
      if (members.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Add at least one other RELAY number to start a group.",
        });
      }
      const convo = await createGroupConversation({
        creatorId: me.id,
        memberIds: members.map((m) => m.id),
        // Apple 1.2 — a group name is shown to every member; UGC-filter it at creation.
        title: sanitizeUgcText(input.title),
        avatarUrl: input.avatarUrl ?? null,
      });
      // Push a hint so every member's thread list refreshes.
      try {
        for (const pid of [me.id, ...members.map((m) => m.id)]) {
          publishToIdentity(pid, { kind: "message", conversationId: convo.id, from: me.id });
        }
      } catch {
        /* best-effort */
      }
      return {
        conversationId: convo.id,
        title: convo.title,
        memberCount: members.length + 1,
        skipped: unique.length - members.length,
      };
    }),

  /**
   * Members of a conversation (id, number, name, avatar) — used by the group
   * conversation view to label messages with sender names and show the roster.
   */
  /** Per-post group read receipts (v2.107.35): who read this post, and when.
   *  The audience gate lives in `listMessageReads` - author or group admin
   *  (creator included) - so a second call site could not forget it. */
  readsFor: publicProcedure
    .input(z.object({ messageId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const me = requireIdentity(ctx);
      const res = await listMessageReads({ messageId: input.messageId, viewerId: me.id });
      if (!res.ok) {
        if (res.reason === "not-allowed")
          throw new TRPCError({ code: "FORBIDDEN", message: "not-allowed" });
        if (res.reason === "unavailable")
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "unavailable" });
        throw new TRPCError({ code: "NOT_FOUND", message: res.reason });
      }
      return res.readers.map((r) => ({
        identityId: r.identityId,
        displayName: r.displayName,
        number: r.number,
        readAt: r.readAt,
      }));
    }),

  conversationInfo: publicProcedure
    .input(z.object({ conversationId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const me = requireIdentity(ctx);
      const memberIds = await getConversationParticipantIds(input.conversationId);
      if (!memberIds.includes(me.id)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Not a member of this conversation." });
      }
      const idents = await getIdentitiesByIds(memberIds);
      // GROUP ROLES (v2.104.0). Decoration for the roster — every real permission
      // decision goes through `checkGroupPermission`, which fails closed, whereas
      // `getGroupRoles` swallows its own failure so a role lookup can never stop the
      // members list rendering.
      const roles = await getGroupRoles(input.conversationId);
      const storedAdmins = memberIds.filter((id) => roles.roleById.get(id) === "admin");
      const creatorIsMember = roles.ownerIdentityId != null && memberIds.includes(roles.ownerIdentityId);
      return {
        conversationId: input.conversationId,
        members: idents.map((i) => ({
          id: i.id,
          number: i.number,
          displayName: i.displayName,
          avatarUrl: i.avatarUrl ?? null,
          isMe: i.id === me.id,
          isCreator: roles.ownerIdentityId != null && roles.ownerIdentityId === i.id,
          // The creator is an admin without a stored role, so it is derived here too
          // rather than read off the column — one rule, both places.
          isAdmin: roles.roleById.get(i.id) === "admin" || roles.ownerIdentityId === i.id,
        })),
        /** Whether the group has ANY administrator, so the UI can say "this group has
         *  none" instead of offering a control that always fails. False for every group
         *  created before v2.102.0, which have no creator recorded. */
        hasAdmin: storedAdmins.length > 0 || creatorIsMember,
        /**
         * "All users can add" (v2.105.16). On the wire so a MEMBER's UI knows whether to
         * offer the Add control at all, rather than showing one the server will refuse.
         *
         * Only an explicit `true` reads as on — NULL is what every pre-release group
         * carries and has to keep meaning admin-only, which is the same falsy-is-safe
         * direction `checkGroupPermission` takes. Both read the column, and neither
         * infers the other's answer.
         */
        membersCanAdd: (await getGroupMembersCanAdd(input.conversationId)) === true,
      };
    }),

  /**
   * Start a call FOR A GROUP (#113, v2.105.7): who to ring, and a signed seed
   * naming the group's admins so they become CO-HOSTS of the room.
   *
   * WHY THIS PROCEDURE EXISTS AT ALL, rather than the client just dialling the
   * numbers it already has from `conversationInfo`: the room is created
   * synchronously inside the signaling invite handler, so resolving adminship
   * there would put a database read on the one path a call cannot afford to wait
   * on (which is why `onResolveDial` needs a timeout and a settled flag). And the
   * client must not be asked who the admins are — that is an assertion about
   * authority. So it is resolved HERE, where the database already lives and where
   * membership can be checked, and handed back as a capability the fleet signed.
   *
   * ONE-WAY, ALWAYS: this reads group roles and writes none. A call host never
   * becomes a group admin — see `server/groupCallSeed.ts` for why every mechanism
   * that hands out hostship would otherwise be a takeover route.
   */
  startGroupCall: publicProcedure
    .input(z.object({ conversationId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const me = requireIdentity(ctx);
      // Membership FIRST, and via the group module's own gate so the DM refusal,
      // the not-found refusal and the fail-closed `unavailable` behaviour are not
      // a second copy. A conversation id is a small sequential integer, so without
      // this anybody could name any group and learn its admin set.
      /* `start-call`, not `post-story`: the capability's NAME has to say what is being
         checked, or a later reader cannot tell whether restricting stories would also
         restrict calling. Both are unconditional for members today, so this changes no
         behaviour — it makes the two separately restrictable, which is the point of
         having names at all. */
      const gate = await checkGroupPermission(input.conversationId, me.id, "start-call");
      if (!gate.ok) {
        const message =
          gate.reason === "not-a-group"
            ? "That's a direct chat — call them from their own thread."
            : gate.reason === "unavailable"
              ? "Couldn't check that group just now."
              : "That group isn't yours to call.";
        throw new TRPCError({
          code: gate.reason === "unavailable" ? "INTERNAL_SERVER_ERROR" : "FORBIDDEN",
          message,
        });
      }
      const memberIds = await getConversationParticipantIds(input.conversationId);
      const idents = await getIdentitiesByIds(memberIds);
      const roles = await getGroupRoles(input.conversationId);
      const isAdmin = (id: number) =>
        roles.roleById.get(id) === "admin" || roles.ownerIdentityId === id;
      // Everyone to ring: the members except me, with a dialable number. A member
      // whose number is malformed is dropped rather than dialled and refused.
      const targets = idents
        .filter((i) => i.id !== me.id && /^\d{6}$/.test(i.number))
        .map((i) => ({ number: i.number, displayName: i.displayName }));
      // The admins' pins, INCLUDING mine if I am one — the seed is a statement
      // about the group, not about who is calling, and the signaling side already
      // makes the room's creator its host (host outranks co-host, so seeding my
      // own pin changes nothing for me and keeps the seed honest).
      const adminPins = idents.filter((i) => isAdmin(i.id)).map((i) => i.number);
      return {
        conversationId: input.conversationId,
        targets,
        /** Null when the group has no admin, or when the fleet has no signing
         *  secret. The dial proceeds either way; only the seeding is absent. */
        hostSeed: mintGroupCallSeed(input.conversationId, me.number, adminPins),
      };
    }),

  /**
   * Mint a shareable invite link for a group (v2.105.9, #114).
   *
   * ADMIN-ONLY, via a capability deliberately absent from MEMBER_CAPABILITIES: a link
   * admits a stranger and every member being able to hand one out is a decision nobody
   * has made. `checkGroupPermission` also supplies the DM refusal, the not-found refusal
   * and the fail-closed `unavailable`, so none of those is a second copy here.
   *
   * THE AUDIENCE IS PER-LINK (v2.105.23) and travels INSIDE the signed token, so an
   * admin can have an open link and a registered-only one live at the same time and
   * neither is rewritten when the other is minted. An omitted audience is `all`, which
   * is exactly what every link minted before this existed already means.
   */
  createGroupInvite: publicProcedure
    .input(
      z.object({
        conversationId: z.number().int().positive(),
        audience: z.enum(["all", "guest", "registered"]).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const me = requireIdentity(ctx);
      const gate = await checkGroupPermission(input.conversationId, me.id, "invite-link");
      if (!gate.ok) {
        const message =
          gate.reason === "not-a-group"
            ? "That's a direct chat — it has no invite link."
            : gate.reason === "not-an-admin"
              ? gate.hasAdmin
                ? "Only a group admin can create an invite link."
                : "This group was created before admins existed, so nobody can create an invite link for it."
              : gate.reason === "unavailable"
                ? "Couldn't check that group just now."
                : "That group isn't yours.";
        throw new TRPCError({
          code: gate.reason === "unavailable" ? "INTERNAL_SERVER_ERROR" : "FORBIDDEN",
          message,
        });
      }
      const epoch = await getGroupInviteEpoch(input.conversationId);
      if (epoch == null) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Couldn't read that group just now." });
      }
      const audience: GroupInviteAudience = input.audience ?? "all";
      const token = mintGroupInvite(input.conversationId, epoch, audience);
      // No fleet secret ⇒ no invite links at all, said plainly rather than handing back
      // a token that would never verify.
      if (!token) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Invite links aren't available on this server.",
        });
      }
      // The audience is echoed back from the value that was actually SIGNED, not from
      // the input — so the sheet can never label a link with a restriction the token
      // does not carry.
      return { token, path: `/g/${token}`, expiresInMs: GROUP_INVITE_TTL_MS, audience };
    }),

  /** Invalidate EVERY outstanding invite link for a group, in one write. Admin-only. */
  revokeGroupInvites: publicProcedure
    .input(z.object({ conversationId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const me = requireIdentity(ctx);
      const res = await revokeGroupInvites({ conversationId: input.conversationId, actorIdentityId: me.id });
      if (!res.ok) {
        const message =
          res.reason === "not-a-group"
            ? "That's a direct chat — it has no invite link."
            : res.reason === "not-an-admin"
              ? "Only a group admin can revoke an invite link."
              : res.reason === "unavailable"
                ? "Couldn't update that group just now."
                : "That group isn't yours.";
        throw new TRPCError({
          code: res.reason === "unavailable" ? "INTERNAL_SERVER_ERROR" : "FORBIDDEN",
          message,
        });
      }
      return { ok: true };
    }),

  /**
   * ADD SOMEBODY TO A GROUP BY THEIR 6-DIGIT NUMBER (v2.105.16, #108).
   *
   * Admin-only unless the group's own "all users can add" is on — that decision lives in
   * `checkGroupPermission`, so this procedure never has to know which it is.
   *
   * THE BLOCK CHECK IS THE PART WORTH BEING CAREFUL ABOUT. Adding somebody to a group is
   * a way to put messages in front of them, so it must not become a route around a block
   * they placed — the same reasoning that gated `openThread` and `createGroup` in
   * v2.98.6/E2. It refuses IDENTICALLY to "no such number", so the block is never
   * revealed to the person it was placed against.
   *
   * The number resolves through the ordinary directory, and an unknown one answers the
   * same way as a blocked one for that reason.
   */
  addGroupMember: publicProcedure
    .input(
      z.object({
        conversationId: z.number().int().positive(),
        number: z.string().min(1).max(32),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const me = requireIdentity(ctx);
      directoryGate(ctx);
      const gate = await checkGroupPermission(input.conversationId, me.id, "add-member");
      if (!gate.ok) {
        const message =
          gate.reason === "not-a-group"
            ? "That's a direct chat — there's nobody to add to it."
            : gate.reason === "not-an-admin"
              ? gate.hasAdmin
                ? "Only a group admin can add people, unless the group lets every member do it."
                : "This group was created before admins existed, so nobody can add people to it."
              : gate.reason === "unavailable"
                ? "Couldn't check that group just now."
                : "That group isn't yours.";
        throw new TRPCError({
          code: gate.reason === "unavailable" ? "INTERNAL_SERVER_ERROR" : "FORBIDDEN",
          message,
        });
      }

      const digits = (input.number || "").replace(/[\s\-.]/g, "");
      const target = /^\d{6}$/.test(digits) ? await getIdentityByNumber(digits) : null;
      // ONE message for "no such number" and for "they blocked you", so this cannot be
      // used to discover either. Adding yourself is refused separately, because that one
      // reveals nothing and a distinct message is genuinely more useful.
      const notFound = new TRPCError({
        code: "NOT_FOUND",
        message: "That number isn't a RELAY user yet.",
      });
      if (!target) throw notFound;
      if (target.id === me.id) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "You're already in this group." });
      }
      if (await isNumberBlockedBy(target.id, me.number).catch(() => false)) throw notFound;

      const res = await admitGroupMember({
        conversationId: input.conversationId,
        identityId: target.id,
      });
      if (!res.ok) {
        throw new TRPCError({
          code: res.reason === "unavailable" ? "INTERNAL_SERVER_ERROR" : "BAD_REQUEST",
          message: "Couldn't add them to that group just now.",
        });
      }
      // `joined: false` means they were ALREADY a member, which is a success and not
      // worth an error — but the client says so rather than claiming a fresh add.
      return { ok: true as const, added: res.joined, displayName: target.displayName };
    }),

  /**
   * REMOVE A MEMBER (v2.105.16, #108). Admin-only UNCONDITIONALLY — there is no toggle,
   * because "all users can add" says add and one member ejecting another is a different,
   * larger power nobody asked for.
   *
   * The removals that are wrong whoever asks — the creator, and yourself — are refused in
   * `removeGroupMember`, not here, so no call site can forget them.
   */
  removeGroupMember: publicProcedure
    .input(
      z.object({
        conversationId: z.number().int().positive(),
        identityId: z.number().int().positive(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const me = requireIdentity(ctx);
      const gate = await checkGroupPermission(input.conversationId, me.id, "remove-member");
      if (!gate.ok) {
        const message =
          gate.reason === "not-a-group"
            ? "That's a direct chat — there's nobody to remove from it."
            : gate.reason === "not-an-admin"
              ? gate.hasAdmin
                ? "Only a group admin can remove people."
                : "This group was created before admins existed, so nobody can remove people from it."
              : gate.reason === "unavailable"
                ? "Couldn't check that group just now."
                : "That group isn't yours.";
        throw new TRPCError({
          code: gate.reason === "unavailable" ? "INTERNAL_SERVER_ERROR" : "FORBIDDEN",
          message,
        });
      }
      const res = await removeGroupMember({
        conversationId: input.conversationId,
        identityId: input.identityId,
        actingIdentityId: me.id,
      });
      if (!res.ok) {
        // Each of these needs a different next step, so each is named.
        const map: Record<typeof res.reason, { code: "BAD_REQUEST" | "INTERNAL_SERVER_ERROR"; message: string }> = {
          "not-found": { code: "BAD_REQUEST", message: "No group with that id." },
          "not-a-group": { code: "BAD_REQUEST", message: "That's a direct chat." },
          "is-creator": {
            code: "BAD_REQUEST",
            message:
              "The person who created this group can't be removed — that would leave it with no admin and no way to appoint one.",
          },
          self: {
            code: "BAD_REQUEST",
            message: "Removing yourself isn't the same as leaving a group, and leaving isn't built yet.",
          },
          unavailable: { code: "INTERNAL_SERVER_ERROR", message: "Couldn't update that group just now." },
        };
        const m = map[res.reason];
        throw new TRPCError({ code: m.code, message: m.message, cause: res.reason });
      }
      return { ok: true as const, removed: res.removed };
    }),

  /**
   * Turn "all users can add" on or off (v2.105.16). ADMIN-ONLY via `manage-roles`, which
   * is the capability that already means "change who may do what in this group" — a new
   * capability naming the same authority would be two names for one decision.
   */
  setGroupMembersCanAdd: publicProcedure
    .input(
      z.object({
        conversationId: z.number().int().positive(),
        allowed: z.boolean(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const me = requireIdentity(ctx);
      const gate = await checkGroupPermission(input.conversationId, me.id, "manage-roles");
      if (!gate.ok) {
        throw new TRPCError({
          code: gate.reason === "unavailable" ? "INTERNAL_SERVER_ERROR" : "FORBIDDEN",
          message:
            gate.reason === "not-an-admin"
              ? "Only a group admin can change who may add people."
              : "Couldn't update that group just now.",
        });
      }
      const ok = await setGroupMembersCanAdd(input.conversationId, input.allowed);
      if (!ok) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Couldn't update that group just now.",
        });
      }
      return { ok: true as const, allowed: input.allowed };
    }),

  /**
   * What is behind this link, for the join screen — name, photo, member count.
   *
   * A TOKEN HOLDER LEARNS THIS AND THAT IS THE POINT: somebody deciding whether to join
   * has to see what they are joining, and a link they hold is already the authority. It
   * reveals no member's name or number, so a leaked link tells you about the GROUP and
   * not about the people in it.
   *
   * EVERY REFUSAL READS THE SAME. Expired, revoked, mis-signed and no-such-group are one
   * message, because distinguishing them would turn the endpoint into an oracle for
   * which conversation ids exist and which epochs are current.
   *
   * THE AUDIENCE IS REPORTED, AND THAT IS NOT A NEW ORACLE. Reaching this point already
   * required a signature this fleet minted for this group at the current epoch, so it
   * tells nobody anything they did not already hold a legitimate link for — and knowing
   * BEFORE the tap that a link needs a registered account is the difference between one
   * clear sentence and a refused join the person has to interpret.
   */
  groupInvitePreview: publicProcedure
    .input(z.object({ token: z.string().min(1).max(256) }))
    .query(async ({ ctx, input }) => {
      const me = requireIdentity(ctx);
      const claim = verifyGroupInvite(input.token);
      if (!claim) return null;
      const epoch = await getGroupInviteEpoch(claim.conversationId);
      if (epoch == null || epoch !== claim.epoch) return null;
      const group = (await getGroupsByIds([claim.conversationId]))[0];
      if (!group) return null;
      const memberIds = await getConversationParticipantIds(claim.conversationId);
      const alreadyMember = memberIds.includes(me.id);
      return {
        conversationId: claim.conversationId,
        title: group.title ?? null,
        avatarUrl: group.avatarUrl ?? null,
        number: group.number ?? null,
        memberCount: memberIds.length,
        alreadyMember,
        audience: claim.audience,
        /* THE AUDIENCE GOVERNS ADMISSION, NOT MEMBERSHIP — so an existing member is
         * admitted whatever their tier. Without that, somebody who joined through a
         * guest-only link and later REGISTERED (keeping their identity and number, per
         * v2.99.49) would be told they cannot join a group they are already in. */
        admitted: alreadyMember || inviteAudienceAdmits(claim.audience, await identityTier(me)),
      };
    }),

  /**
   * Redeem an invite link: join the group.
   *
   * The epoch is re-checked HERE and not merely at preview, because the two are separate
   * requests and a revoke can land between them — checking only at preview would let a
   * link revoked seconds ago still admit somebody.
   *
   * A LINK-JOINED MEMBER IS AN ORDINARY MEMBER. No role is written, and v2.105.7's
   * co-host seeding grants nothing to a pin its signed admin list does not name, so this
   * cannot reach group adminship or call moderation. That composition is exactly what
   * v2.104.0's review kept closed by having no "members are admins when there is no
   * admin" fallback.
   *
   * THE AUDIENCE IS RE-CHECKED HERE and not merely at preview, for the same reason the
   * epoch is: they are separate requests. The refusal NAMES the requirement, unlike every
   * other refusal on this endpoint — it is reached only after a signature this fleet
   * minted has already verified, so it reveals nothing, and "you need a registered
   * account" is only useful if it is said.
   */
  acceptGroupInvite: publicProcedure
    .input(z.object({ token: z.string().min(1).max(256) }))
    .mutation(async ({ ctx, input }) => {
      const me = requireIdentity(ctx);
      const claim = verifyGroupInvite(input.token);
      if (!claim) throw new TRPCError({ code: "NOT_FOUND", message: "That invite link is no longer valid." });
      const epoch = await getGroupInviteEpoch(claim.conversationId);
      if (epoch == null || epoch !== claim.epoch) {
        throw new TRPCError({ code: "NOT_FOUND", message: "That invite link is no longer valid." });
      }
      // Membership is read BEFORE the audience gate, deliberately: the gate governs
      // ADMISSION, so an existing member re-opening the link must never be refused for a
      // tier they have since changed. It also fails in the safe direction — an
      // unreadable roster reads as "not a member", so the gate still applies.
      if (!(await getConversationParticipantIds(claim.conversationId)).includes(me.id)) {
        if (!inviteAudienceAdmits(claim.audience, await identityTier(me))) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message:
              claim.audience === "registered"
                ? "This invite is for registered accounts. Register with email from your profile — your number and contacts carry over — then open the link again."
                : "This invite is open to guest accounts only.",
          });
        }
      }
      const res = await joinGroupByInvite({ conversationId: claim.conversationId, identityId: me.id });
      if (!res.ok) {
        throw new TRPCError({
          code: res.reason === "unavailable" ? "INTERNAL_SERVER_ERROR" : "NOT_FOUND",
          message:
            res.reason === "unavailable"
              ? "Couldn't join that group just now."
              : "That invite link is no longer valid.",
        });
      }
      return { conversationId: claim.conversationId, joined: res.joined };
    }),

  list: publicProcedure
    .input(
      z.object({
        conversationId: z.number().int().positive(),
        beforeId: z.number().int().positive().optional(),
        limit: z.number().int().min(1).max(200).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const me = requireIdentity(ctx);
      const rows = await listMessages({
        conversationId: input.conversationId,
        identityId: me.id,
        beforeId: input.beforeId,
        limit: input.limit,
      });
      // Resolve attachments in ONE query (was N+1: one round-trip per message).
      const attIds = rows
        .map((r) => r.attachmentId)
        .filter((x): x is number => typeof x === "number");
      const attById = new Map((await getAttachmentsByIds(attIds)).map((a) => [a.id, a]));
      // ALBUMS (v2.107.32): one indexed IN-query for the page; messages without
      // an album — almost all of them — simply aren't in the map.
      const albumByMsg = await getAlbumsForMessages(rows.map((r) => r.id));
      // Reactions for this page (board 4c) — ONE indexed range over ids already in
      // hand, and it returns nothing at all for a thread nobody has reacted in,
      // which is almost every thread. The map is projected into the contract's
      // `{emoji: pins[]}` shape here rather than in the DB layer, because that shape
      // is the WIRE contract and `listMessages` returns rows.
      const reactionRows = await reactionsForMessages(rows.map((r) => r.id));
      return rows.map((r) => {
        // M11: WITHHOLD the content of a locked expiring message — a recipient
        // must reveal it via `revealExpiring` (which burns it), so the secret is
        // no longer readable straight out of the raw list response. The sender
        // always sees their own; a consumed message is already null in the DB
        // and renders as "disappeared".
        const m = (r.meta ?? null) as { expire?: unknown; consumedAt?: unknown } | null;
        const isExpiring = m?.expire != null;
        const consumed = m?.consumedAt != null;
        const locked = isExpiring && !consumed && r.senderIdentityId !== me.id;
        return {
          id: r.id,
          conversationId: r.conversationId,
          senderIdentityId: r.senderIdentityId,
          kind: r.kind,
          body: locked ? null : r.body,
          meta: r.meta,
          status: r.status,
          createdAt: r.createdAt,
          // v2.99.74 — receipt times for the message-info panel. Sent to BOTH sides:
          // they are timestamps the recipient generated about their own reading, and
          // the sender is precisely who the info panel is for. Nothing here reveals
          // content, an identity, or anything the ticks do not already imply.
          deliveredAt: r.deliveredAt ?? null,
          readAt: r.readAt ?? null,
          editedAt: r.editedAt,
          attachment: locked ? null : r.attachmentId ? (attById.get(r.attachmentId) ?? null) : null,
          album: locked ? null : (albumByMsg.get(r.id) ?? null),
          replyToId: r.replyToId ?? null,
          locked,
          // Sent for a LOCKED message too, deliberately: a reaction is not the
          // message's content, and withholding it would make a view-once bubble the
          // one place chips vanish — which is itself a signal about what it holds.
          reactions: projectReactions(reactionRows.get(r.id) ?? []),
        };
      });
    }),

  /**
   * VOICE TRANSCRIPTS (v2.107.31). Lazy and cached: the FIRST listener's tap
   * pays the Gemini call, the row keeps the text, and every later reader — this
   * person, the other participant, next month's scrollback — gets it from
   * `messages.list` for free (the projection ships the whole attachment row).
   *
   * Behind `getAttachmentForIdentity` DELIBERATELY: that is the one gate that
   * already knows the participant rule and the view-once lock (M28), so a
   * transcript can never leak content the attachment itself would refuse.
   */
  transcribeVoice: publicProcedure
    .input(z.object({ attachmentId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const me = requireIdentity(ctx);
      if (!geminiKey()) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Transcription isn't set up on this server." });
      }
      const att = await getAttachmentForIdentity(input.attachmentId, me.id);
      if (!att) throw new TRPCError({ code: "NOT_FOUND", message: "That recording isn't available." });
      if (!/^audio\//i.test(att.mimeType)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Only voice messages can be transcribed." });
      }
      // The cache read comes FIRST, ahead of the size gate: an already-stored
      // transcript is served whatever today's limits say.
      if (att.transcript != null && att.transcriptLang) {
        return { lang: att.transcriptLang, text: att.transcript };
      }
      if (Number(att.sizeBytes) > MAX_TRANSCRIBE_BYTES) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "That recording is too long to transcribe." });
      }
      const signed = await storageGetSignedUrl(att.storageKey);
      const res = await fetch(signed).catch(() => null);
      if (!res || !res.ok) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Couldn't read the recording." });
      }
      const bytes = Buffer.from(await res.arrayBuffer());
      const out = await transcribeAudio(bytes, att.mimeType);
      // The empty transcript is a REFUSAL, not a result — caching "" would pin
      // "no speech" onto a note a retry might have read fine.
      if (!out || out.text.length === 0) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Couldn't transcribe that — try again." });
      }
      await saveAttachmentTranscript(att.id, out.lang, out.text);
      return out;
    }),

  /** Translate a cached transcript (EN↔AR). One alt slot on the row: with two
   *  languages it is simply "the other one", and re-asking for a cached target
   *  is a read. Asking for the ORIGINAL language returns the original — a
   *  no-op, not an error, so a double-tap costs nothing. */
  translateTranscript: publicProcedure
    .input(z.object({ attachmentId: z.number().int().positive(), target: z.enum(["en", "ar"]) }))
    .mutation(async ({ ctx, input }) => {
      const me = requireIdentity(ctx);
      if (!geminiKey()) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Translation isn't set up on this server." });
      }
      const att = await getAttachmentForIdentity(input.attachmentId, me.id);
      if (!att) throw new TRPCError({ code: "NOT_FOUND", message: "That recording isn't available." });
      if (att.transcript == null || !att.transcriptLang) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Transcribe it first." });
      }
      if (att.transcriptLang === input.target) return { lang: att.transcriptLang, text: att.transcript };
      if (att.transcriptAltLang === input.target && att.transcriptAlt != null) {
        return { lang: att.transcriptAltLang, text: att.transcriptAlt };
      }
      const out = await translateText(att.transcript, input.target);
      if (!out) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Couldn't translate that — try again." });
      await saveAttachmentTranscriptAlt(att.id, input.target, out);
      return { lang: input.target, text: out };
    }),

  /**
   * React to a message, or take it back (DATA-CONTRACTS §2, board 4c).
   *
   * The wire format is the contract's — `{messageId, emoji, op}` — with the TOGGLE
   * decided client-side by `reactionOpFor`, which is why both ops must be (and are)
   * idempotent: the client is toggling its OWN reaction, so the only race is with
   * itself, and a retried request must not undo the thing it just did.
   *
   * EVERY REFUSAL ANSWERS THE SAME WAY except a malformed emoji, which is the
   * caller's own bug rather than a fact about somebody else's data: message ids are
   * small sequential integers, so a distinguishable "not a member" would map which
   * conversations exist and who is in them.
   */
  react: publicProcedure
    .input(
      z.object({
        messageId: z.number().int().positive(),
        emoji: z.string().min(1).max(REACTION_MAX_LENGTH),
        op: z.enum(["add", "remove"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const me = requireIdentity(ctx);
      const res = await setMessageReaction({
        messageId: input.messageId,
        identityId: me.id,
        emoji: input.emoji,
        op: input.op,
      });
      if (!res.ok) {
        if (res.reason === "bad-emoji") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "That isn't a reaction." });
        }
        throw new TRPCError({ code: "NOT_FOUND", message: "That message isn't available." });
      }
      // Tell the whole thread, INCLUDING the reactor's other devices — the chips are
      // shared state, so a phone and a laptop showing different counts for the same
      // message is exactly the divergence this codebase keeps paying for.
      if (res.conversationId != null) {
        const members = await getConversationParticipantIds(res.conversationId);
        for (const pid of members) {
          // NOT `if (pid !== me.id)`, which is what the message fan-out just above
          // does and is right for a message: nobody needs telling about their own
          // send. Here my other devices DO need it — the chips are shared state, and
          // a phone and a laptop showing different counts for one message is exactly
          // the divergence this codebase keeps paying for.
          publishToIdentity(pid, {
            kind: "reaction",
            conversationId: res.conversationId,
            messageId: input.messageId,
          });
        }
      }
      return { ok: true };
    }),

  /** Search message bodies within one conversation. */
  search: publicProcedure
    .input(
      z.object({
        conversationId: z.number().int().positive(),
        query: z.string().min(1).max(200),
        limit: z.number().int().min(1).max(100).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const me = requireIdentity(ctx);
      const rows = await searchMessages({
        conversationId: input.conversationId,
        identityId: me.id,
        query: input.query,
        limit: input.limit,
      });
      const attIds = rows
        .map((r) => r.attachmentId)
        .filter((x): x is number => typeof x === "number");
      const attById = new Map((await getAttachmentsByIds(attIds)).map((a) => [a.id, a]));
      // ALBUMS (v2.107.32): one indexed IN-query for the page; messages without
      // an album — almost all of them — simply aren't in the map.
      const albumByMsg = await getAlbumsForMessages(rows.map((r) => r.id));
      return rows.map((r) => ({
        id: r.id,
        conversationId: r.conversationId,
        senderIdentityId: r.senderIdentityId,
        kind: r.kind,
        body: r.body,
        createdAt: r.createdAt,
        attachment: r.attachmentId ? (attById.get(r.attachmentId) ?? null) : null,
        album: albumByMsg.get(r.id) ?? null,
      }));
    }),

  send: publicProcedure
    .input(
      z.object({
        conversationId: z.number().int().positive(),
        kind: z
          .enum(["text", "image", "video", "audio", "file"])
          .optional()
          .default("text"),
        body: z.string().max(8000).nullable().optional(),
        attachmentId: z.number().int().positive().nullable().optional(),
        /** ALBUMS (v2.107.32): up to 100 photos + 100 videos in ONE message,
         *  each with its own optional caption, in the sender's picked order.
         *  The message's own `attachmentId` stays the COVER (item 0) so an
         *  un-updated client renders the first photo instead of a blank. */
        album: z
          .array(
            z.object({
              attachmentId: z.number().int().positive(),
              caption: z.string().max(2000).optional(),
            }),
          )
          .min(ALBUM_MIN_ITEMS)
          .max(200)
          .optional(),
        replyToId: z.number().int().positive().nullable().optional(),
        /** Constrained metadata (v2.88; still a deliberately CLOSED shape —
         *  clients can't stuff arbitrary JSON into `messages.meta`).
         *  `voicemail: true` marks an audio message recorded after a failed
         *  dial. `expire` (v2.96) makes the message SELF-DESTRUCT once the
         *  recipient opens it: "once" = view-once, or a 5/10/30-second
         *  countdown after reveal. */
        meta: z
          .object({
            voicemail: z.literal(true).optional(),
            expire: z
              .union([z.literal("once"), z.literal(5), z.literal(10), z.literal(30)])
              .optional(),
          })
          .optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const me = requireIdentity(ctx);
      // Trim BEFORE checking/storing — without this, a whitespace-only body
      // alongside an attachment skipped the empty check (the OR condition only
      // fires when there's no attachment) and got stored as meaningless
      // whitespace instead of being treated as "no body".
      const trimmedBody = input.body?.trim() || null;
      if (!trimmedBody && !input.attachmentId && !(input.album && input.album.length > 0)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Message must have body or attachment",
        });
      }
      // An attachmentId must actually belong to (or be visible to) the sender —
      // without this, anyone could attach ANY attachment id in the database
      // (including private uploads from other conversations) to a message they
      // send, exposing media they were never granted access to.
      if (input.attachmentId != null) {
        const owned = await getAttachmentForIdentity(input.attachmentId, me.id);
        if (!owned) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Attachment not found or not yours" });
        }
      }
      /* ── ALBUM VALIDATION (v2.107.32) ─────────────────────────────────────
         The album REWRITES the message's kind and cover rather than trusting
         the client's: kind is derived from item 0's mime (that is what an old
         client will render), the cover IS item 0, and every item must pass the
         SAME gate a single attachment does — including the forward case, where
         `getAttachmentsForIdentityBatch` falls back to the participant/view-once
         check per item. Expiring albums are refused outright: the burn path
         nulls ONE attachmentId, so a "disappearing" album would leave its other
         199 items readable — a promise the feature could not keep. */
      let effectiveKind: "text" | "image" | "video" | "audio" | "file" = input.kind;
      let effectiveAttachmentId: number | null = input.attachmentId ?? null;
      let albumItems: Array<{ attachmentId: number; caption?: string | null }> | null = null;
      if (input.album && input.album.length > 0) {
        if (input.meta?.expire != null) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Albums can't be disappearing messages." });
        }
        const ids = input.album.map((a) => a.attachmentId);
        if (new Set(ids).size !== ids.length) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "An album can't contain the same item twice." });
        }
        const atts = await getAttachmentsForIdentityBatch(ids, me.id);
        if (!atts) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Attachment not found or not yours" });
        }
        const counts = albumCounts(atts.map((a) => a.mimeType));
        if (!counts.ok) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              counts.reason === "kind"
                ? "Albums can only contain photos and videos."
                : "Up to 100 photos and 100 videos per album.",
          });
        }
        albumItems = input.album.map((a) => ({ attachmentId: a.attachmentId, caption: a.caption ?? null }));
        effectiveAttachmentId = ids[0];
        effectiveKind = albumKindFor(atts[0].mimeType);
      }
      // Participant roster, fetched ONCE (v2.88 — this used to be re-queried
      // three times: block check, push fan-out, auto-reply). Best-effort: a
      // lookup hiccup yields [] and, exactly as before, skips the block check,
      // fan-out, and auto-reply without blocking the send itself.
      let participantIds: number[] = [];
      try {
        participantIds = await getConversationParticipantIds(input.conversationId);
      } catch {
        participantIds = [];
      }
      const peerIds = participantIds.filter((p) => p !== me.id);
      // BLOCKING (1:1 only): a recipient who blocked the sender receives
      // nothing — the send fails honestly instead of silently delivering.
      try {
        if (peerIds.length === 1) {
          const blocked = await isNumberBlockedBy(peerIds[0], me.number);
          if (blocked) {
            throw new TRPCError({ code: "FORBIDDEN", message: "You can't message this person." });
          }
        }
      } catch (e) {
        if (e instanceof TRPCError) throw e; // block verdicts propagate
        /* lookup hiccups never block sending */
      }
      const row = await sendMessage({
        conversationId: input.conversationId,
        senderIdentityId: me.id,
        kind: effectiveKind,
        body: trimmedBody,
        attachmentId: effectiveAttachmentId,
        replyToId: input.replyToId ?? null,
        meta: input.meta ?? null,
      });
      if (albumItems) {
        // A failure past this point leaves a COVER-ONLY message — degraded but
        // visible and resendable, never a silently lost send.
        try {
          await saveMessageAlbum(row.id, albumItems);
        } catch {
          /* the cover carries the message */
        }
      }
      // Voicemail (v2.88): wake the recipient's device — "Voicemail from X".
      // 1:1 only (that's the only place voicemails are recorded). Best-effort.
      if (input.meta?.voicemail && peerIds.length === 1) {
        sendPushToIdentity(peerIds[0], {
          kind: "voicemail",
          title: `Voicemail from ${me.displayName || me.number}`,
          body: "They couldn't reach you and left a voice message — tap to listen.",
          tag: `relay-voicemail-${input.conversationId}`,
          url: `/app/messages?c=${input.conversationId}`,
        }).catch(() => {});
      }
      // Fan out a push hint to every participant so their UIs refetch.
      // Includes the sender so their other tabs also stay in sync.
      try {
        for (const pid of participantIds) {
          publishToIdentity(pid, {
            kind: "message",
            conversationId: input.conversationId,
            from: me.id,
          });
        }
      } catch {
        /* push is best-effort; polling is the safety net */
      }

      // NEW-MESSAGE WEB PUSH (v2.99.40). The fan-out above is an SSE hint — it
      // only reaches a tab that is currently connected, which is exactly the
      // case where the user does NOT need telling. A missed call has woken the
      // device since v2.83 and a voicemail since v2.88, but a plain message
      // never did: a phone with RELAY installed and closed stayed silent until
      // its owner happened to open the app. So push every OFFLINE recipient.
      //
      // THE BANNER NOW QUOTES THE MESSAGE, WHICH REVERSES THIS LINE'S OWN
      // EARLIER RULE (2026-08-02). It read "content-free by the same rule as the
      // email (owner: 'WITHOUT the content')"; the owner's message-notification
      // spec asks for a preview, so the preview ships and the EMAIL keeps its
      // rule — an inbox holds the disclosure indefinitely, a banner does not.
      // `server/messagePush.ts` owns the wording, including the two cases that
      // still refuse to quote (an expiring message, and a caption-less
      // attachment), and in a group the TITLE is the group with the sender
      // leading the body. One tag per conversation, so ten messages replace each
      // other instead of stacking ten notifications.
      // `sendPushToIdentity` already no-ops when the user turned push off or has
      // no subscription, so this needs no gate of its own; everything is
      // best-effort and never affects the delivered message.
      let offlinePeerIds: number[] = [];
      const presenceById = new Map<number, PresenceLite>();
      try {
        if (peerIds.length > 0) {
          const presences = await getPresenceForIds(peerIds);
          for (const p of presences) presenceById.set(p.identityId, p);
          // v2.99.92: a BACKGROUNDED app needs this push every bit as much as a
          // closed one — it cannot draw an in-page toast. One shared rule, so the
          // three sites that ask this question cannot drift apart.
          offlinePeerIds = peerIds.filter((pid) => presenceNeedsNotification(presenceById.get(pid)));
          // A voicemail already pushed its own, better-worded notification.
          if (!input.meta?.voicemail && offlinePeerIds.length > 0) {
            const from = me.displayName || me.number;
            // Read ONLY when there is somebody to notify, so a conversation whose
            // members are all online costs no extra query at all.
            const header = await getConversationPushHeader(input.conversationId);
            const isGroup = header?.isGroup === true;
            const preview = messagePushPreview({
              kind: input.kind,
              body: trimmedBody,
              meta: input.meta ?? null,
            });
            const title = messagePushTitle({ isGroup, groupTitle: header?.title, senderName: from });
            const body = messagePushBody({ isGroup, senderName: from, preview });
            for (const pid of offlinePeerIds) {
              sendPushToIdentity(pid, {
                kind: "message",
                title,
                body,
                tag: `relay-msg-${input.conversationId}`,
                url: `/app/messages?c=${input.conversationId}`,
              }).catch(() => {});
            }
          }
        }
      } catch {
        /* a presence hiccup costs a notification, never the message */
      }

      // Offline-message EMAIL (v2.99.13, owner: "if somebody sent me a message
      // and I'm offline, email me — WITHOUT the content — 'you received a
      // message, log in to see it'; I can disable it in Profile"). Content-free
      // nudge to an offline recipient with a linked address and the pref on.
      // This runs only on the real client→peers send path (the internal offline
      // auto-reply below is a separate sendMessage call, never this procedure),
      // so it never emails for system messages. Fully best-effort: a failure
      // here never affects the delivered message.
      //
      // v2.99.40 tightens it to LAST RESORT, because this is the one place
      // RELAY can generate mail from someone else's action — the failure mode is
      // an unhappy recipient and an SES sending reputation we don't get back.
      // Four rules, on top of the existing pref + atomic claim:
      //   1. Only when we CANNOT reach the device instead. A recipient with a
      //      push subscription just got the notification above; emailing them
      //      too is pure noise.
      //   2. Only once they've actually been away a while. Presence flips
      //      offline the moment a tab hides, so a phone that locks for ten
      //      seconds mid-conversation would otherwise earn an email for a
      //      message its owner is already reading.
      //   3. One per hour, not per 15 minutes (the cooldown constant), and it
      //      coalesces by design: the mail says "you have messages waiting",
      //      never a per-message count, so a burst is one accurate email.
      //   4. At most 3 per UTC day, enforced in the same atomic claim.
      // Rules 3–4 live in claimOfflineMessageEmail so they're race-safe.
      try {
        if (emailEnabled() && offlinePeerIds.length > 0) {
          for (const pid of offlinePeerIds) {
            const peer = await getIdentityById(pid);
            if (!peer?.userId) continue; // guests have no email
            const user = await getUserById(peer.userId);
            if (!user?.email) continue;
            // Rule 2 — been gone long enough to actually miss this?
            const away = awayForMs(presenceById.get(pid));
            if (away !== null && away < OFFLINE_MESSAGE_EMAIL_MIN_AWAY_MS) continue;
            // Rule 1 — a reachable device makes the email redundant. "Reachable"
            // must mean BOTH a live subscription AND the push switch on: nothing
            // deletes the subscription row when the switch is turned off, so
            // testing only the row would leave a push-off user with no push AND
            // no email, which is the opposite of what this rule is for.
            if (await pushReachable(pid)) continue;
            // Atomic: pref on AND cooldown elapsed AND daily budget left.
            const claimed = await claimOfflineMessageEmail(
              peer.userId,
              OFFLINE_MESSAGE_EMAIL_COOLDOWN_MS
            );
            if (!claimed) continue;
            const appUrl = appBaseUrl();
            const claimUserId = peer.userId;
            const unsubscribeUrl = unsubscribeLink(peer.userId);
            void sendEmail({
              to: user.email,
              subject: "You have messages waiting on RELAY",
              html: messageWaitingHtml({ appUrl, unsubscribeUrl }),
              // An explicit text/plain part, because the default is
              // stripHtml(html) and that deletes every <a> along with its href —
              // so a text-only client saw the words "Unsubscribe from these
              // emails" with no URL behind them, which is the one case the
              // visible link exists for.
              text: messageWaitingText({ appUrl, unsubscribeUrl }),
              // One-click unsubscribe. Required by bulk-sender rules and, more
              // to the point, the honest thing to offer: the recipient never
              // asked for this mail. The link works without signing in.
              headers: unsubscribeHeaders(peer.userId),
            })
              // RELEASE ON A FAILED SEND. This has to inspect the RESULT, not
              // hang off .catch(): sendEmail is documented never to throw and
              // resolves {ok:false} on every failure path, so the .catch() this
              // replaces was dead code — a refused or throttled SES send kept the
              // claim, and the recipient paid the full cooldown plus one of three
              // daily slots for a mail that never left.
              .then((r) => {
                if (!r.ok) void releaseOfflineMessageEmailClaim(claimUserId);
              })
              .catch(() => {
                // Defensive: if it ever does throw, still give the claim back.
                void releaseOfflineMessageEmailClaim(claimUserId);
              });
          }
        }
      } catch {
        /* offline-message email is best-effort — never blocks the send */
      }

      // Offline auto-reply (1:1 only — avoids group spam). If the single other
      // party is offline, HAS OPTED IN, and hasn't auto-replied in the last
      // 10 min, post a one-time auto-reply FROM them so the sender knows they'll
      // reply later.
      //
      // v2.99.66 — now OPT-IN (owner: "you should allow the user to enable and
      // disable it. You don't enable it by default"). This posts a message in
      // someone else's name into a conversation they are not watching, so the
      // consent has to be theirs; `autoReplyEnabledFor` fails closed, and the
      // pref is checked BEFORE the presence and dedupe reads so the common
      // (opted-out) path costs one indexed lookup instead of three.
      try {
        if (peerIds.length === 1 && (await autoReplyEnabledFor(peerIds[0]))) {
          const peerId = peerIds[0];
          const [pres] = await getPresenceForIds([peerId]);
          // DELIBERATELY NOT `presenceNeedsNotification` (v2.99.92). This one posts a
          // line in somebody else's name saying they are away and will reply later —
          // and a person who merely switched apps for ten seconds may reply
          // immediately, which would make the auto-reply a lie. Genuinely offline is
          // the right trigger here, and it is the same over-reaction to minimising
          // that this release exists to remove, in message form.
          const offline = !pres?.isOnline;
          if (
            offline &&
            !(await recentAutoReplyExists(input.conversationId, peerId, 10 * 60 * 1000))
          ) {
            const peer = await getIdentityById(peerId);
            const name = peer?.displayName || "They";
            const autoRow = await sendMessage({
              conversationId: input.conversationId,
              senderIdentityId: peerId,
              kind: "text",
              body: `${name} is away right now and will reply when they're back. (Auto-reply)`,
              meta: { autoReply: true },
            });
            if (autoRow) {
              publishToIdentity(me.id, {
                kind: "message",
                conversationId: input.conversationId,
                from: peerId,
              });
              publishToIdentity(peerId, {
                kind: "message",
                conversationId: input.conversationId,
                from: peerId,
              });
            }
          }
        }
      } catch {
        /* auto-reply is best-effort */
      }

      return row;
    }),

  /**
   * Mark inbound messages DELIVERED (v2.99.74) — the second tick.
   *
   * Called by the RECIPIENT's client whenever it learns about messages in a
   * conversation it is not currently reading. Fans a `read`-shaped event back so the
   * sender's ticks update live rather than on their next poll; the event kind is
   * `delivered` so an older client, which does not know it, simply ignores it.
   */
  markDelivered: publicProcedure
    .input(z.object({ conversationId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const me = requireIdentity(ctx);
      const wasMember = await markThreadDelivered({
        conversationId: input.conversationId,
        identityId: me.id,
      });
      if (wasMember) {
        try {
          const peers = await getConversationParticipantIds(input.conversationId);
          for (const pid of peers) {
            if (pid !== me.id) {
              publishToIdentity(pid, {
                kind: "delivered",
                conversationId: input.conversationId,
                by: me.id,
              });
            }
          }
        } catch {
          /* the receipt is already stored; the peer picks it up on their next read */
        }
      }
      return { ok: wasMember };
    }),

  markRead: publicProcedure
    .input(z.object({ conversationId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const me = requireIdentity(ctx);
      const wasMember = await markThreadRead({
        conversationId: input.conversationId,
        identityId: me.id,
      });
      // SECURITY (S6): only fan out the read-receipt when the caller is actually
      // a participant — otherwise a non-member could spam bogus `read` events at
      // a conversation's real participants even though the DB write no-op'd.
      if (wasMember) {
        try {
          const peers = await getConversationParticipantIds(input.conversationId);
          for (const pid of peers) {
            if (pid !== me.id) {
              publishToIdentity(pid, {
                kind: "read",
                conversationId: input.conversationId,
                reader: me.id,
              });
            }
          }
        } catch {
          /* ignore */
        }
      }
      return { ok: true };
    }),

  /** Ephemeral "I'm typing" ping — fanned out to the OTHER participants. No DB. */
  typing: publicProcedure
    .input(z.object({ conversationId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const me = requireIdentity(ctx);
      try {
        const participants = await getConversationParticipantIds(input.conversationId);
        // SECURITY: only a MEMBER may emit a typing indicator into a thread —
        // the missed sibling of the S6 markRead membership fix. Without this,
        // any identity could push a spurious "typing…" event into strangers'
        // conversations by iterating conversation ids.
        if (!participants.includes(me.id)) return { ok: true };
        // …and a BLOCKED sender reaches nobody (v2.99.57). `messages.send` has
        // always been block-gated, but `typing` was not — so someone who had been
        // blocked could still make "X is typing…" appear on the blocker's screen,
        // repeatedly and at will. A block that stops the messages but not the
        // presence of the person is not a block. Per-recipient, because a group
        // thread may contain both people who blocked me and people who didn't.
        const others = participants.filter((pid) => pid !== me.id);
        const blocks = await Promise.all(
          others.map((pid) =>
            isNumberBlockedBy(pid, me.number).catch(() => false), // fail OPEN
          ),
        );
        others.forEach((pid, i) => {
          if (blocks[i]) return;
          publishToIdentity(pid, {
            kind: "typing",
            conversationId: input.conversationId,
            from: me.id,
          });
        });
      } catch {
        /* best-effort */
      }
      return { ok: true };
    }),

  /** Unsend (soft-delete) one of your OWN messages. */
  remove: publicProcedure
    .input(z.object({ messageId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const me = requireIdentity(ctx);
      const conversationId = await deleteMessage({ messageId: input.messageId, identityId: me.id });
      if (conversationId == null) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You can only delete your own messages." });
      }
      // Fan out so every participant's thread refreshes (the message vanishes).
      try {
        for (const pid of await getConversationParticipantIds(conversationId)) {
          publishToIdentity(pid, { kind: "message", conversationId, from: me.id });
        }
      } catch {
        /* best-effort */
      }
      return { ok: true, conversationId };
    }),

  /** Edit the text of one of your OWN messages (QW-4). Sender-only, text-only,
   *  live-only (see editMessage). The body bound matches `send`'s text bound, and
   *  an edit stamps `editedAt` so both sides render an "edited" marker. */
  edit: publicProcedure
    .input(
      z.object({
        messageId: z.number().int().positive(),
        body: z.string().trim().min(1).max(8000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const me = requireIdentity(ctx);
      const conversationId = await editMessage({
        messageId: input.messageId,
        identityId: me.id,
        body: input.body,
      });
      if (conversationId == null) {
        // Same refusal for foreign / missing / non-text / expiring / already-unsent —
        // the endpoint is not an oracle over which of those a message id is.
        throw new TRPCError({ code: "FORBIDDEN", message: "You can only edit your own text messages." });
      }
      // Fan out so every participant re-reads the message (new text + edited mark).
      try {
        for (const pid of await getConversationParticipantIds(conversationId)) {
          publishToIdentity(pid, { kind: "message", conversationId, from: me.id });
        }
      } catch {
        /* best-effort */
      }
      return { ok: true, conversationId };
    }),

  /** Self-destruct burn (v2.96): the recipient opened an expiring message —
   *  destroy its content for everyone (see consumeExpiringMessage). Idempotent
   *  from the client's view: an already-burned/foreign id returns ok:false. */
  consumeExpiring: publicProcedure
    .input(z.object({ messageId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const me = requireIdentity(ctx);
      const res = await consumeExpiringMessage({ messageId: input.messageId, identityId: me.id });
      if (!res) return { ok: false };
      try {
        for (const pid of res.participantIds) {
          publishToIdentity(pid, { kind: "message", conversationId: res.conversationId, from: me.id });
        }
      } catch {
        /* best-effort */
      }
      return { ok: true };
    }),

  /**
   * M11 (server-side content gating): reveal a LOCKED expiring message. The
   * body + attachment are WITHHELD from `messages.list` for a locked message
   * (see the `locked` gate there), so a recipient can no longer read the secret
   * out of the raw list response without burning it — this is the only path to
   * the content, and it BURNS the message (view-once: gone for everyone). Media
   * is returned INLINE as a data URL: the server reads the object while it still
   * has access, so the immediate burn can't race the client's fetch (the old
   * client-fetch-then-burn flow is retired). Text returns `body`.
   */
  revealExpiring: publicProcedure
    .input(z.object({ messageId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const me = requireIdentity(ctx);
      statusGate(ctx); // reuse the generic per-IP throttle
      // Reserve the aggregate slot BEFORE the burn (v2.99.49). Order matters: the
      // burn is irreversible, so refusing after it would destroy a message the
      // reader never got to see. `retry` tells the client this one is still there.
      const slot = reserveRevealSlot();
      if (!slot) {
        return { ok: false as const, retry: true as const };
      }
      let reservedBytes = 0;
      try {
      const res = await revealExpiringMessage({
        messageId: input.messageId,
        identityId: me.id,
        // Checked BEFORE the burn (v2.99.57): over-cap media used to be destroyed
        // and the reader told it succeeded.
        maxAttachmentBytes: REVEAL_MAX_INLINE_BYTES,
      });
      if (!res) return { ok: false as const };
      if (res.tooLarge) {
        // Nothing was burned — the message is still there. Say so honestly rather
        // than reporting a success that delivered nothing.
        return { ok: false as const, tooLarge: true as const };
      }
      // Tell every participant the row changed so their list refetches and shows
      // the "disappeared" placeholder (the burn already nulled the content).
      try {
        for (const pid of res.participantIds) {
          publishToIdentity(pid, { kind: "message", conversationId: res.conversationId, from: me.id });
        }
      } catch {
        /* best-effort */
      }
      // Inline the media bytes (data URL) so the revealer renders a LOCAL copy —
      // the burn above already revoked the storage key, so there's no live url
      // to hand back. Bounded: skip inlining above ~30MB (view-once media is
      // small in practice); a miss just yields no media, never a hang.
      let media: { dataUrl: string; mimeType: string } | null = null;
      if (res.attachmentId != null) {
        try {
          const [att] = await getAttachmentsByIds([res.attachmentId]);
          if (att?.storageKey) {
            const signed = await storageGetSignedUrl(att.storageKey);
            const resp = await fetch(signed);
            if (!resp.ok || !resp.body) throw new Error("reveal: upstream unavailable");
            // SECURITY (M23 — unbounded buffering): the size guard used to be
            // `Number(content-length ?? 0) <= CAP`, so an upstream response with
            // NO content-length yielded len=0, PASSED the check, and then went
            // straight into `arrayBuffer()` — buffering the entire body with no
            // ceiling at all. The follow-up `buf.length <= CAP` check was too
            // late to help: the memory was already committed. A lying (small)
            // content-length had the same effect. Because the inlined bytes are
            // then base64'd (+33%) and serialized into a JSON tRPC response,
            // one request could pin several times the object's size in heap, and
            // this endpoint is only per-IP throttled — so a handful of hosts
            // could OOM the instance.
            //
            // Now: reject a DECLARED over-cap size cheaply, then read the stream
            // with a HARD ceiling regardless of what the header claimed, so a
            // missing or dishonest content-length cannot exceed the cap either.
            const declared = Number(resp.headers.get("content-length"));
            if (Number.isFinite(declared) && declared > REVEAL_MAX_INLINE_BYTES) {
              throw new Error("reveal: declared size over cap");
            }
            const reader = resp.body.getReader();
            const chunks: Buffer[] = [];
            let total = 0;
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              if (!value) continue;
              total += value.byteLength;
              if (total > REVEAL_MAX_INLINE_BYTES) {
                await reader.cancel().catch(() => {});
                throw new Error("reveal: body exceeded cap");
              }
              chunks.push(Buffer.from(value));
            }
            const buf = Buffer.concat(chunks);
            // Charge the aggregate budget with what we really hold (the base64
            // string and the JSON body are multiples of this, which is why the
            // ceiling sits well under the process limit).
            reservedBytes = buf.length;
            revealInFlightBytes += reservedBytes;
            const mime = att.mimeType || "application/octet-stream";
            media = { dataUrl: `data:${mime};base64,${buf.toString("base64")}`, mimeType: mime };
          }
        } catch {
          /* best-effort — the reader still gets the text body / a burned card */
        }
      }
      return { ok: true as const, body: res.body, media };
      } finally {
        slot.release(reservedBytes);
      }
    }),
});

/* ── attachments router ───────────────────────────────────────── */

export const v2AttachmentsRouter = router({
  /**
   * Register an attachment after the file has been uploaded via the HTTP
   * `/api/v2/upload` endpoint (which does the actual storagePut). This
   * router-level entry exists for clients that already have storage keys
   * (e.g. server-driven flows or tests).
   */
  register: publicProcedure
    .input(
      z.object({
        storageKey: z.string().min(1).max(256),
        mimeType: z.string().min(1).max(128),
        sizeBytes: z.number().int().nonnegative(),
        width: z.number().int().positive().optional().nullable(),
        height: z.number().int().positive().optional().nullable(),
        durationMs: z.number().int().positive().optional().nullable(),
        filename: z.string().max(256).optional().nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const me = requireIdentity(ctx);
      // SECURITY (v2.94.2): storageKey is CLIENT-SUPPLIED. It MUST live in the
      // caller's own upload namespace — otherwise a client could forge OWNERSHIP
      // of a stranger's key, which the storage proxy's participant check trusts
      // via uploadedByIdentityId. (`register` is client-unused today; defensive.)
      if (!keyInOwnerNamespace(input.storageKey, me.id, s3Config()?.prefix ?? "")) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "storageKey must be in your own upload namespace",
        });
      }
      // SECURITY: `url` is NEVER accepted from the client — it used to be, which
      // let a caller register an attachment row pointing at an ARBITRARY external
      // URL (or a javascript:/data: scheme). Every client that opens the returned
      // attachment (AttachmentView/FileCard/MediaLightbox) trusts `url` to be a
      // same-origin `/manus-storage/{key}` path — the only shape the real upload
      // endpoint ever produces — and renders it directly into <img src>/<a href>
      // with no scheme check, so an attacker-chosen url was a no-interaction
      // tracking beacon (any image attachment auto-loads it) and a phishing
      // open-redirect. Deriving it here from the already namespace-validated
      // storageKey, exactly like /api/v2/upload does, makes that shape the only
      // one that can ever exist.
      const row = await recordAttachment({
        ...input,
        url: `/manus-storage/${input.storageKey}`,
        uploadedByIdentityId: me.id,
      });
      return row;
    }),

  get: publicProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      // Authorization: only return an attachment the caller uploaded or that
      // belongs to a conversation they participate in. Without this gate, any
      // caller could enumerate sequential ids and read every attachment URL.
      const me = requireIdentity(ctx);
      return getAttachmentForIdentity(input.id, me.id);
    }),
});

/* ── calls router (history + start log) ───────────────────────── */

/**
 * #117 — HOW FAR BACK THE CALL LOG REACHES.
 *
 * Both call payloads were hard-capped at 100 rows with no way past them, so search and
 * per-person grouping could only ever see the most recent 100 calls — an older call was
 * unfindable however good the matcher was (v2.99.96, v2.99.98 both flagged it).
 *
 * THE PAGE SIZE IS UNCHANGED AT 100, DELIBERATELY. Both queries are POLLED every 30s by
 * every open History tab, so raising the default would multiply that traffic for
 * everybody to serve a search almost nobody runs — the same trade v2.102.2 refused for
 * the thread list's groupwise-max. Reaching further is an explicit act instead: the
 * client asks for an older page and keeps it, and the poll still only ever refreshes
 * the newest page.
 */
const HISTORY_PAGE = 100;

/**
 * A CURSOR, never an offset — see `listCallHistory` for why offsets are wrong on a table
 * that grows at the top. Optional and `.optional()` as a whole, so a client that sends
 * no input at all (every build before this one) is byte-identical to before.
 *
 * `.int().positive()` because ids are positive integers: a garbage cursor must be
 * refused by the schema rather than reaching SQL as a `lt(id, NaN)` that quietly
 * matches nothing and reads as "no older calls".
 */
const HistoryPageInput = z
  .object({ before: z.number().int().positive().optional() })
  .optional();

export const v2CallsRouter = router({
  /**
   * When did I last call this person, or they me? (v2.105.24)
   *
   * Backs one line on the OUTGOING dial card — the owner asked for "my last call when it
   * was" on the screen where you are deciding whether to dial again.
   *
   * WHY THIS EXISTS RATHER THAN FILTERING `calls.history` ON THE CLIENT, which is already
   * cached in the Dialer and would have been free: `call_history` is a MISSED/DECLINED log
   * in production (nothing calls `logStart`, so no "initiated" row is ever written and
   * nothing writes "answered" at all), so filtering it would report the last time you
   * FAILED to reach somebody and stay silent about every real conversation — a confidently
   * wrong statement about the caller's own history. `getLastCallWith` unions both tables.
   * The 100-row caps on both existing payloads are the second reason: a heavy caller's last
   * call with one person falls off the end and reads as "never".
   *
   * SCOPED TO THE CALLER BY CONSTRUCTION: the identity is taken from the context, never
   * from input, so this can only ever answer about a call the caller was party to. The
   * peer is named by NUMBER and resolved server-side; an unknown number and a peer with no
   * shared call answer IDENTICALLY (`{ at: null }`), so this is no existence oracle over
   * the number space — and it is `directoryGate`-limited before any DB work for the same
   * reason every other number-taking resolver is (F5).
   */
  lastWith: publicProcedure
    .input(z.object({ number: NumberSchema }))
    .query(async ({ ctx, input }) => {
      const me = requireIdentity(ctx);
      await directoryGate(ctx);
      const peer = await getIdentityByNumber(input.number);
      // Unknown number, a party line (not a person), or self: all answer "no last call"
      // rather than an error, so the dial card simply renders no line.
      if (!peer || peer.id === me.id) return { at: null, answered: false };
      const clearedAt = await getHistoryClearedAt(me.id);
      const last = await getLastCallWith(me.id, peer.id, clearedAt);
      return { at: last?.at ?? null, answered: last?.answered ?? false };
    }),

  history: publicProcedure.input(HistoryPageInput).query(async ({ ctx, input }) => {
    const me = requireIdentity(ctx);
    const clearedAt = await getHistoryClearedAt(me.id);
    const rows = await listCallHistory(me.id, HISTORY_PAGE, clearedAt, input?.before ?? null);
    // join the "other" identity for each row for friendly display
    const otherIds = Array.from(
      new Set(
        rows.map((r) => (r.callerIdentityId === me.id ? r.calleeIdentityId : r.callerIdentityId))
      )
    );
    // Resolve the "other" identity for every row in ONE query. (This replaced a
    // dead single-row query plus an N+1 loop.)
    const otherById = new Map((await getIdentitiesByIds(otherIds)).map((o) => [o.id, o]));
    // Tier badge for the call log (v2.99.78). Owner: *"inside the call history ...
    // you didn't put the badge ... immediately put the badge"*. One batched query,
    // and it is decoration — `getRolesByIdentityIds` swallows its own errors and
    // returns an empty map, so a hiccup costs a badge and never the call log.
    const rolesById = await getRolesByIdentityIds(otherIds);
    return rows.map((r) => {
      const otherId = r.callerIdentityId === me.id ? r.calleeIdentityId : r.callerIdentityId;
      const other = otherById.get(otherId);
      return {
        id: r.id,
        direction: r.callerIdentityId === me.id ? ("out" as const) : ("in" as const),
        status: r.status,
        channel: r.channel,
        startedAt: r.startedAt,
        answeredAt: r.answeredAt,
        endedAt: r.endedAt,
        durationSec: r.durationSec,
        other: other
          ? {
              identityId: other.id,
              number: other.number,
              displayName: other.displayName,
              avatarUrl: other.avatarUrl,
              role: (rolesById.get(other.id) ?? "guest") as IdentityRole,
            }
          : null,
      };
    });
  }),

  /** Multi-party CONFERENCE history — every answered call (2..10 parties) this
   *  identity took part in, with the full roster (name + PIN) and duration. */
  conferenceHistory: publicProcedure.input(HistoryPageInput).query(async ({ ctx, input }) => {
    const me = requireIdentity(ctx);
    const clearedAt = await getHistoryClearedAt(me.id);
    const rows = await listConferenceHistory(me.id, HISTORY_PAGE, clearedAt, input?.before ?? null);
    // Party lines (v2.89): pl- rooms carry the line's number as dialedNumber —
    // resolve their titles in ONE batched query so History can label them.
    const lineNumbers = Array.from(
      new Set(
        rows
          .filter((r) => (r.roomId ?? "").startsWith("pl-") && r.dialedNumber)
          .map((r) => r.dialedNumber as string)
      )
    );
    const titleByNumber = new Map(
      (await getPartyLinesByNumbers(lineNumbers).catch(() => [])).map((l) => [l.number, l.title])
    );
    /* THE ROSTER IS A HISTORICAL SNAPSHOT — RESOLVE THE PEOPLE IN IT LIVE.
     *
     * Each roster entry froze a number and a name at the moment the call ended,
     * and it also recorded the `identityId`. The number is the part that goes
     * stale: regenerate your number and every History row anybody holds keeps
     * pointing at a number you no longer own — so the call-back button dials
     * nothing, the row displays a PIN that is not yours as fact, and the
     * presence dot (looked up by number) sticks grey forever. The avatar had the
     * same defect: it was resolved BY NUMBER, so a renumbered person also lost
     * their photo from everyone's History.
     *
     * So resolve from the identityId instead, and fall back to the number only
     * for entries that never had an identity (true guests). This is the "live"
     * strategy in NUMBER_BEARING_COLUMNS: nothing is rewritten, which means
     * renumbers that already happened come out correct too, and no future
     * renumber can leave this behind. Names are refreshed on the same principle
     * the contacts list already uses — live identity over frozen copy.
     */
    const roster0 = (r: (typeof rows)[number]) =>
      Array.isArray(r.participants)
        ? (r.participants as Array<{ number?: string; name?: string; identityId?: number | null }>)
        : [];
    const rosterIds = Array.from(
      new Set(rows.flatMap((r) => roster0(r).map((p) => p.identityId).filter((x): x is number => typeof x === "number")))
    );
    const liveById = new Map(
      (rosterIds.length ? await getIdentitiesByIds(rosterIds).catch(() => []) : []).map((i) => [i.id, i])
    );
    // Guests (no identityId) keep the by-number lookup as their only option.
    const guestNumbers = Array.from(
      new Set(
        rows.flatMap((r) =>
          roster0(r)
            .filter((p) => typeof p.identityId !== "number")
            .map((p) => p.number ?? "")
            .filter(Boolean)
        )
      )
    );
    const avatarByNumber = new Map(
      (guestNumbers.length ? await getIdentitiesByNumbers(guestNumbers).catch(() => []) : []).map((i) => [
        i.number,
        i.avatarUrl ?? null,
      ])
    );
    // Tier badge for each roster member (v2.99.78), resolved BY IDENTITY like the
    // name and avatar already are — so a renumbered person keeps their badge. One
    // batched query for the whole page; decoration-only and error-swallowing.
    const confRolesById = await getRolesByIdentityIds(
      Array.from(liveById.keys()).filter((k): k is number => typeof k === "number")
    );
    return rows.map((r) => {
      const roster = roster0(r);
      const isPartyLine = (r.roomId ?? "").startsWith("pl-");
      const participants = roster.map((p) => {
        const live = typeof p.identityId === "number" ? liveById.get(p.identityId) : undefined;
        const frozenNumber = p.number ?? "";
        return {
          /**
           * Who they are, not what they were called (v2.99.98).
           *
           * The client groups a call log per person, and grouping on the NUMBER would
           * split one person's calls in two the moment they renumber — the number
           * moves, the identity does not. Null for a roster entry we can no longer
           * resolve, which the client then groups by number as the best available key.
           */
          identityId: typeof p.identityId === "number" ? p.identityId : null,
          // Live number when we know who they are; the snapshot otherwise.
          number: live?.number ?? frozenNumber,
          frozenNumber,
          name: live?.displayName || p.name || "Guest",
          avatarUrl: live?.avatarUrl ?? (frozenNumber ? (avatarByNumber.get(frozenNumber) ?? null) : null),
          isSelf: p.identityId === me.id,
          role:
            typeof p.identityId === "number"
              ? ((confRolesById.get(p.identityId) ?? "guest") as IdentityRole)
              : null,
        };
      });
      /* The dialled number is stored with no identity of its own, so map it
       * through the roster: the entry whose FROZEN number matches is the person
       * who was dialled, and their live number is where a call-back should go.
       * A party line is exempt — its number belongs to the line, not a person,
       * and never moves. */
      const dialed = r.dialedNumber ?? null;
      const dialedLive =
        dialed && !isPartyLine
          ? (participants.find((p) => p.frozenNumber === dialed)?.number ?? dialed)
          : dialed;
      return {
        id: r.id,
        roomId: r.roomId,
        dialedNumber: dialedLive,
        partyCount: r.partyCount,
        startedAt: r.startedAt,
        endedAt: r.endedAt,
        durationSec: r.durationSec,
        /**
         * #116 — how the call was DIALLED, or null when we never recorded it.
         *
         * NULL is the honest answer for every conference logged before the column
         * existed and for a party line (which is joined, not dialled), and the row
         * renders nothing for it rather than defaulting to "Voice" — which would be
         * a confident claim about somebody's own call history that nobody recorded.
         */
        channel: (r.channel ?? null) as "voice" | "video" | null,
        partyLine: isPartyLine,
        // Null when the line has since been deleted (row keeps its number).
        // Looked up on the STORED number: a line's number never moves.
        partyLineTitle: isPartyLine ? (titleByNumber.get(dialed ?? "") ?? null) : null,
        // Surface everyone EXCEPT me first-class; keep the full list too.
        participants: participants.map(({ frozenNumber: _frozen, ...p }) => p),
      };
    });
  }),

  /** Caller calls this immediately before sending the SDP offer. */
  logStart: publicProcedure
    .input(
      z.object({
        calleeNumber: NumberSchema,
        channel: z.enum(["voice", "video"]).optional().default("video"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // SECURITY (S5): logStart resolves calleeNumber→identity (NOT_FOUND vs a
      // row is an existence oracle) and writes a call-history row, both
      // unbounded before this — a free enumeration bypass of the F5 throttle
      // plus a way to spam a victim's History with bogus "initiated" rows. Gate
      // it on the same per-IP bucket; legit dial-preflight is one call.
      directoryGate(ctx);
      const me = requireIdentity(ctx);
      const callee = await getIdentityByNumber(input.calleeNumber);
      if (!callee) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Number not found" });
      }
      const row = await recordCallStart({
        callerIdentityId: me.id,
        calleeIdentityId: callee.id,
        channel: input.channel,
      });
      return row;
    }),

  /**
   * Unacknowledged missed/declined incoming calls — newest first. Drives the
   * landing missed-call popup and the History / notification-bell badges. Works
   * for guests and registered users alike (both have an identity row).
   */
  missedSummary: publicProcedure.query(async ({ ctx }) => {
    const me = requireIdentity(ctx);
    const rows = await listUnseenMissedCalls(me.id, 30);
    return {
      count: rows.length,
      items: rows.map((r) => ({
        id: r.id,
        callerName: r.callerName,
        callerNumber: r.callerNumber,
        status: r.status,
        channel: r.channel,
        at: r.startedAt,
      })),
      // The single most recent caller, for a one-line popup headline.
      latest: rows[0]
        ? { name: rows[0].callerName, number: rows[0].callerNumber, at: rows[0].startedAt }
        : null,
    };
  }),

  /** Acknowledge all missed calls (clears the popup + badges). */
  markMissedSeen: publicProcedure.mutation(async ({ ctx }) => {
    const me = requireIdentity(ctx);
    await markMissedCallsSeen(me.id);
    return { ok: true };
  }),

  /** "Clear history" (per-user soft clear): hides every existing call +
   *  conference row from THIS identity's History tab and acks missed-call
   *  badges. The other parties' logs are untouched. */
  clearHistory: publicProcedure.mutation(async ({ ctx }) => {
    const me = requireIdentity(ctx);
    await clearCallHistory(me.id);
    return { ok: true };
  }),
});


/* ──────────────────────────────────────────────────────────────────────────
 * Stats router — public, aggregate-only counters surfaced on the landing page.
 * No auth required and no personal data leaves the server; just headline
 * totals so the marketing page can show live network size.
 * ────────────────────────────────────────────────────────────────────────── */
export const v2StatsRouter = router({
  public: publicProcedure.query(async () => {
    return await getPublicStats();
  }),
});

/* ── passwordless email-OTP auth (v2.68) ──────────────────────────
   Single email → 6-digit code → code entry authenticates. No password,
   no third-party IdP. Guest→verified upgrade happens on verify (the
   guest cookie is still present), preserving number/contacts/messages.
   Per-IP rate limit + per-email 60s cooldown; codes are hashed at rest
   and burned after OTP_MAX_ATTEMPTS wrong tries. */
const EmailSchema = z.string().trim().max(320);
const CodeSchema = z.string().regex(/^\d{6}$/, { message: "Enter the 6-digit code" });
const NameSchema = z.string().trim().min(1).max(64);
/**
 * A SURNAME may be empty, because the login page asks for ONE "permanent display
 * name" (RELAY_LOGIN_HANDOFF.md §3) and splits it on the first space — so a
 * mononym ("Prince", "Zendaya", and most of the world's single-name conventions)
 * legitimately arrives with `lastName: ""`. Requiring it rejected those
 * registrations outright with a raw zod error:
 *
 *   {"code":"too_small","minimum":1,"path":["lastName"], … }
 *
 * The old two-field panel made that unreachable, so the strictness never showed.
 * Nothing downstream needs it: BOTH places that build a display name already do
 * `${firstName ?? ""} ${lastName ?? ""}`.trim() || email.split("@")[0]`, which
 * yields a clean "Prince" with no trailing space. It also cannot reach the
 * v2.99.81 approval bypass — that short-circuit inferred "first device" from the
 * PRESENCE of a name and was deleted; `shouldRequireApproval` answers it now.
 */
const OptionalSurnameSchema = z.string().trim().max(64).optional().default("");

const otpIpLimiter = createRateLimiter({ capacity: 30, refillPerSec: 30 / 60 });
setInterval(() => otpIpLimiter.sweep(Date.now(), 30 * 60_000), 30 * 60_000).unref();
function otpGate(ctx: { req: unknown }) {
  if (process.env.RELAY_RATELIMIT_OFF === "1") return;
  if (!otpIpLimiter.allow(clientIpOf(ctx.req as Parameters<typeof clientIpOf>[0]), Date.now())) {
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many attempts. Try again shortly." });
  }
}
/**
 * Reduce an address to the INBOX it actually reaches, for throttling only.
 *
 * v2.99.81: the per-email cooldown keyed on the exact string, so `victim+1@x.com`,
 * `victim+2@x.com` … were each a fresh bucket while all of them deliver to
 * `victim@x.com`. That cooldown is the only bound on mail volume to one inbox that
 * is not per-IP, so aliasing turned it into ~30 unsolicited emails per minute per
 * rotating IP — a deliverability and SES-reputation problem, which this codebase
 * already treats as a first-class concern (v2.99.42 GAP3).
 *
 * THROTTLING ONLY. `normalizeEmail` is deliberately left alone: it is the storage
 * and identity key, and merging aliases there would make `victim+work@` and
 * `victim@` resolve to ONE account, breaking the exact-match identity resolution
 * `findUserByEmailAny` depends on and the one-email-one-row invariant M35 exists to
 * hold. Dots are also deliberately NOT stripped — dot-insensitivity is a Gmail
 * behaviour, and applying it globally would merge genuinely distinct addresses at
 * other providers and refuse a legitimate signup.
 */
export function canonicalRecipient(email: string): string {
  const e = String(email || "").trim().toLowerCase();
  const at = e.lastIndexOf("@");
  if (at <= 0) return e;
  const local = e.slice(0, at);
  const domain = e.slice(at);
  const plus = local.indexOf("+");
  // A local part that is ONLY a tag ("+tag@x.com") is not a valid address to
  // begin with; leave it whole rather than producing a bare "@domain" bucket that
  // every such address would share.
  if (plus <= 0) return e;
  return local.slice(0, plus) + domain;
}

/**
 * Per-INBOX mint budget, on top of the per-exact-address cooldown.
 *
 * Sized as a ceiling rather than a cooldown: a person legitimately holding several
 * aliases at one provider should be able to sign in with each, so this permits a
 * short burst and then throttles hard. In-memory and therefore per-instance —
 * stated plainly: on the two-instance fleet the effective ceiling is double this,
 * which still turns an unbounded mail cannon into a bounded trickle.
 */
const otpRecipientLimiter = createRateLimiter({ capacity: 6, refillPerSec: 6 / 600 });
setInterval(() => otpRecipientLimiter.sweep(Date.now(), 60 * 60_000), 30 * 60_000).unref();

async function cooldownOk(email: string) {
  const last = await lastOtpAt(email);
  if (last && Date.now() - last < OTP_RESEND_COOLDOWN_MS) return false;
  // The exact-string cooldown above is KEPT, not replaced. Sharing one bucket
  // between `victim@` and `victim+1@` would let an attacker deny the legitimate
  // owner of an alias their own code.
  if (process.env.RELAY_RATELIMIT_OFF === "1") return true;
  return otpRecipientLimiter.allow(canonicalRecipient(email), Date.now());
}

/**
 * Per-address budget for WRONG code guesses (v2.99.81).
 *
 * THE REAL DEFECT here was not where it was first claimed. `mintOtp` not
 * invalidating prior codes is harmless — superseding only SHADOWS them, so once the
 * newest row is burned `latestOtp` falls back to the older un-consumed one, and
 * every mint mails the new valid code to the victim's own inbox, which the attacker
 * cannot read. Making `mintOtp` invalidate priors would DELETE that self-healing
 * fallback and make the burn permanent — strictly worse.
 *
 * `verifyOtp` is the unbounded one: it has no per-address throttle at all, so five
 * wrong guesses burn a code (`recordOtpFailure` consumes at the cap) and repeating
 * drains every outstanding row until `latestOtp` returns null and the victim's real
 * code reports "expired". Chained with four wrong PIN tries that is a full
 * unauthenticated lockout, because the email code is the PIN's own unlock path.
 *
 * Generously sized: a legitimate person needs one or two attempts, and this repo
 * already fixed the case where correcting a digit cost an attempt (v2.99.31 L3), so
 * 20 per ten minutes cannot lock out a real user while it makes draining somebody's
 * codes impractical.
 */
const otpVerifyLimiter = createRateLimiter({ capacity: 20, refillPerSec: 20 / 600 });
setInterval(() => otpVerifyLimiter.sweep(Date.now(), 60 * 60_000), 30 * 60_000).unref();
function otpVerifyGate(email: string) {
  if (process.env.RELAY_RATELIMIT_OFF === "1") return;
  if (!otpVerifyLimiter.allow(canonicalRecipient(email), Date.now())) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "Too many code attempts for this address. Wait a few minutes and try again.",
    });
  }
}

// NOTE (v2.99.35): the v2.97.2 `RELAY_OTP_REGISTER_BYPASS` email-outage stopgap
// has been REMOVED now that the operator's SES account is out of the AWS
// sandbox (production access approved 2026-07-24). Registration ALWAYS mints +
// emails a real verification code again — email ownership is proven at signup,
// unconditionally, so a stale env flag can never silently re-disable it.

/** How recently another session must have been active for a NEW sign-in to
 *  require its approval (v2.99.7). Matches "another device is online right now"
 *  — the session lastSeenAt is bumped ~every 5 min while a device is in use, so
 *  a 12-min window means "used within the last couple of heartbeats". Longer
 *  than the touch throttle so an actively-used device is never missed. */
const NEW_DEVICE_APPROVAL_WINDOW_MS = 12 * 60_000;

/** Mint a session id, record it in the device ledger (labelled from the
 *  User-Agent), and return the sid to embed in the cookie (v2.99.1 device
 *  list). recordSession is best-effort and never throws, so a ledger hiccup
 *  can't block a login — the cookie still authenticates.
 *
 *  v2.99.7: when `pending` is true the row is written AWAITING approval — the
 *  cookie is still set, but the session does NOT authenticate (createContext's
 *  sessionState gate treats a pending row as revoked) until another device
 *  approves it. The result object tells the client to park on the waiting
 *  screen. */
async function startSession(
  ctx: { req: { headers?: Record<string, unknown> } },
  userId: number,
  pending = false,
  /** Which of the three ways in was used (v2.100.1). The owner asked for the login
   *  TYPE on every notification, and it is not derivable after the fact — a session
   *  row looks identical however it was created. */
  method: LoginMethod | null = null,
): Promise<string> {
  const sid = newSessionId();
  const label = deviceLabelFromUA(ctx.req?.headers?.["user-agent"]);
  const ip = normalizeLoginIp(pickClientIp(ctx.req as Parameters<typeof pickClientIp>[0]));
  await recordSession(sid, userId, label, pending, { ip, method });
  // The country and city are resolved AFTER the row lands, deliberately un-awaited:
  // it is an external HTTP call with a 4s timeout, and a sign-in must never wait on
  // somebody else's service. A row with an IP and no place is the honest degraded
  // state — the UI already omits what it does not have.
  if (ip) {
    void resolveGeoForIp(ip)
      .then((g) =>
        setSessionGeo(sid, {
          country: normalizeCountry(g.country),
          city: normalizeCity(g.city),
        }),
      )
      .catch(() => {
        /* decoration on a row that already exists */
      });
  }
  return sid;
}

/** Decide whether a NEW email-code sign-in must wait for approval: only when the
 *  account has ANOTHER device that was active recently (someone can actually
 *  approve it). Fail-SAFE — hasRecentApprovedSession returns false on any DB
 *  trouble, so we never require an approval that could strand the user. PIN
 *  logins never call this (the PIN itself is the bypass, per the owner spec). */
async function shouldRequireApproval(userId: number): Promise<boolean> {
  return hasRecentApprovedSession(userId, NEW_DEVICE_APPROVAL_WINDOW_MS);
}

/** Notify the account's other (already signed-in) devices that a new device is
 *  waiting for approval, so the notification center lights up in real time.
 *  Best-effort; the waiting screen also polls, so a dropped event is harmless. */
async function announcePendingDevice(userId: number, sid: string, label: string): Promise<void> {
  try {
    const identity = await getIdentityByUserId(userId);
    if (identity) publishToIdentity(identity.id, { kind: "device_pending", sid, label });
  } catch {
    /* the poll is the backstop */
  }
}

/**
 * One shape for a waiting sign-in, and one projection that builds it.
 *
 * The approval prompt in Profile, the notification-centre row and the Devices list
 * all describe the same event, so they read the same fields from the same function
 * — three projections is how three surfaces come to disagree about one login.
 *
 * The IP IS included, and that is a deliberate call rather than an oversight: this
 * is the account owner being shown their OWN sign-in, it is the one detail that
 * survives when the geo service cannot resolve a place, and the owner asked for it
 * by name. It reaches nobody else — every procedure here is scoped to `ctx.user`.
 */
export type PendingSessionWire = {
  sid: string;
  label: string;
  createdAt: number;
  /** "Dubai, AE · Email code", or null when we know neither. */
  detail: string | null;
  place: string | null;
  methodLabel: string | null;
  /* The METHOD as its enum rather than as a phrase, so the client can pick its own
     key. `methodLabel` above stays beside it: a client on the previous bundle is
     still reading that field for the ~60s of a rolling deploy, and dropping it
     would blank the line for those people rather than translating it. */
  method: LoginMethod | null;
  ip: string | null;
  country: string | null;
};

function pendingSessionWire(r: {
  sid: string;
  label: string | null;
  createdAt: Date | string;
  ip?: string | null;
  country?: string | null;
  city?: string | null;
  method?: string | null;
}): PendingSessionWire {
  const origin = { ip: r.ip ?? null, country: r.country ?? null, city: r.city ?? null };
  return {
    sid: r.sid,
    label: r.label || "Unknown device",
    createdAt: new Date(r.createdAt).getTime(),
    detail: describeLogin({ ...origin, method: r.method }),
    place: describeLoginPlace(origin),
    methodLabel: loginMethodLabel(r.method),
    method: normalizeLoginMethod(r.method),
    ip: origin.ip,
    country: normalizeCountry(origin.country),
  };
}

export const v2OtpAuthRouter = router({
  /** Login path: if the email is known, email a code; else tell the UI to register. */
  requestOtp: publicProcedure
    .input(z.object({ email: EmailSchema }))
    .mutation(async ({ ctx, input }) => {
      otpGate(ctx);
      const email = normalizeEmail(input.email);
      if (!isValidEmail(email)) throw new TRPCError({ code: "BAD_REQUEST", message: "Enter a valid email." });
      const user = await findUserByEmailAny(email);
      if (!user) return { ok: true, unregistered: true, sent: false };
      if (!(await cooldownOk(email))) return { ok: true, unregistered: false, sent: true, cooldown: true };
      const code = await mintOtp({ email, purpose: "login" });
      const sent = await dispatchOtp(email, code);
      return { ok: sent, unregistered: false, sent };
    }),

  /** Registration: capture first/last name + email, email a code. The user row is
   *  created by verifyOtp, so an address is never registered unproven. */
  register: publicProcedure
    .input(z.object({ firstName: NameSchema, lastName: OptionalSurnameSchema, email: EmailSchema }))
    .mutation(async ({ ctx, input }) => {
      otpGate(ctx);
      const email = normalizeEmail(input.email);
      if (!isValidEmail(email)) throw new TRPCError({ code: "BAD_REQUEST", message: "Enter a valid email." });
      // Real email verification (SES out of sandbox): mint a code and email it.
      // The recipient must enter it (verifyOtp) to prove the address before the
      // account is created/verified — the v2.97.2 sign-in-without-a-code stopgap
      // is gone.
      if (!(await cooldownOk(email))) return { ok: true, sent: true, cooldown: true };
      const code = await mintOtp({ email, purpose: "register", firstName: input.firstName, lastName: input.lastName });
      const sent = await dispatchOtp(email, code);
      return { ok: sent, sent };
    }),

  /** Verify a code → resolve/create the user, upgrade the guest identity, sign in. */
  verifyOtp: publicProcedure
    .input(
      z.object({
        email: EmailSchema,
        code: CodeSchema,
        // "Remember me" (login overhaul): 0 = this browser session only,
        // 30/60/90 = days, omitted = the default 1-year session.
        remember: z.union([z.literal(0), z.literal(30), z.literal(60), z.literal(90)]).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      otpGate(ctx);
      const email = normalizeEmail(input.email);
      // Per-ADDRESS budget on top of the per-IP one (v2.99.81). Claimed BEFORE the
      // row is read, so a drain attempt cannot spend somebody else's codes faster
      // than the budget allows, and an attacker rotating IPs gains nothing here.
      otpVerifyGate(email);
      const row = await latestOtp(email);
      if (!row) throw new TRPCError({ code: "CONFLICT", message: "That code has expired — request a new one." });
      if (!verifyOtpHash(input.code, row.codeHash)) {
        const attempts = await recordOtpFailure(row.id, row.attempts);
        const left = Math.max(0, OTP_MAX_ATTEMPTS - attempts);
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: left > 0 ? `Incorrect code. ${left} attempt${left === 1 ? "" : "s"} left.` : "Too many attempts — request a new code.",
        });
      }
      // v2.99.47: consumption is the RACE WINNER, not a side effect. Two
      // verifies carrying the same valid code both cleared `latestOtp`; without
      // this guard both proceeded to createOtpUser and one email could end up
      // owning two user rows (users.email has no unique index), so a later
      // sign-in could land on the orphan account. Only the consumer continues.
      if (!(await consumeOtp(row.id))) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "That code was already used — request a new one.",
        });
      }
      // Resolve or create the user account (register rows carry the name).
      let userId = (await findUserByEmailAny(email))?.id ?? null;
      // Did this address ALREADY have an account before this verification? That is
      // the honest test for "first device" and for "may this code rename you"
      // (v2.99.81) — see below. Captured before createOtpUser, which would make it
      // indistinguishable from a genuine first registration.
      const accountExisted = userId != null;
      if (!userId) userId = await createOtpUser({ email, firstName: row.firstName, lastName: row.lastName });
      if (!userId) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Could not create your account." });
      // M29 (account pre-hijacking): the code proves this caller owns the
      // address, so any password/PIN attached to the row BEFORE that proof is
      // untrustworthy — clear it before granting verified status. Must run
      // ahead of markUserEmailVerified, whose own guard is `emailVerified=false`.
      await clearUnverifiedCredentials(userId);
      await markUserEmailVerified(userId);
      // v2.87: an email-code sign-in is the recovery path — unlock the PIN.
      await unlockLoginPin(userId);
      // Same recovery path for the password ladder (v2.99.49): proving the
      // address by email code clears a password lock too, so a locked
      // credential can never strand someone who can read their inbox.
      await unlockPasswordLogin(userId);
      // Upgrade the guest identity in place (preserves number/contacts/messages).
      const guestToken = (ctx.req.cookies?.[GUEST_COOKIE] as string | undefined) ?? null;
      const displayName =
        `${row.firstName ?? ""} ${row.lastName ?? ""}`.trim() || email.split("@")[0];
      // Pass the identity createContext ALREADY resolved for this request (plus the
      // device id) so the guest upgrade uses the same notion of "who is this
      // browser" as every other request. Without this, a guest whose identity was
      // device-resolved rather than cookie-resolved got a BRAND NEW number and
      // lost their contacts, messages and history (v2.99.49).
      const identity = await ensureUserIdentity({
        userId,
        displayName,
        guestToken,
        resolvedIdentityId: ctx.identity?.id ?? null,
        deviceId: ctx.deviceId ?? null,
      });
      // NAME: only a genuinely new account takes its name from the OTP row.
      //
      // v2.99.81: `otpAuth.register` accepts an address that ALREADY has an account
      // (the legacy password route refuses — the two paths disagreed), and the name
      // fields on that row are attacker-supplied. Writing them unconditionally let a
      // register call rename an existing person, and the rewrite is visible to
      // strangers, because `directory.lookup` returns firstName/lastName and the
      // landing dialer PREFERS "First Last" over displayName.
      if (!accountExisted) {
        await markIdentityVerified(identity.id, { firstName: row.firstName, lastName: row.lastName });
      } else {
        await markIdentityVerified(identity.id);
      }
      // New-device approval (v2.99.7): an email-code sign-in on an account that
      // already has another ONLINE device waits for that device to approve it.
      //
      // v2.99.81 — THE SHORT-CIRCUIT IS GONE. It read
      // `const wasRegistration = !!(row.firstName || row.lastName)` and skipped
      // approval whenever the row carried a name — but `NameSchema` makes a name
      // MANDATORY on register, so every register-minted row set it, and an
      // `otpAuth.register` against an existing address therefore bypassed approval
      // entirely: the victim's online device was never prompted and could never
      // decline. Inferring "first device" from an attacker-supplied field was the
      // defect. `shouldRequireApproval` already answers the real question — a
      // genuine first registration has no prior approved session, so it still never
      // waits, which is the property the short-circuit was reaching for.
      const pending = await shouldRequireApproval(userId);
      // The login TYPE is recorded from what actually happened, not inferred later:
      // a session row looks identical however it was created, and `accountExisted`
      // is the only thing that distinguishes a first registration from a sign-in.
      const sid = await startSession(ctx, userId, pending, accountExisted ? "code" : "register");
      setSessionCookie(ctx.res, userId, rememberToTtlMs(input.remember), sid);
      if (pending) {
        const label = deviceLabelFromUA(ctx.req?.headers?.["user-agent"]);
        await announcePendingDevice(userId, sid, label);
        return { ok: true, verified: true, pending: true };
      }
      return { ok: true, verified: true };
    }),

  /** Resend the current code (enforces the 60s cooldown; carries purpose/name forward). */
  resendOtp: publicProcedure
    .input(z.object({ email: EmailSchema }))
    .mutation(async ({ ctx, input }) => {
      otpGate(ctx);
      const email = normalizeEmail(input.email);
      if (!isValidEmail(email)) return { ok: true, cooldown: false };
      if (!(await cooldownOk(email))) return { ok: true, cooldown: true };
      // Carry the pending purpose/name from the most recent row (a register in flight).
      const prev = await latestOtp(email);
      const user = await findUserByEmailAny(email);
      if (!prev && !user) return { ok: true, cooldown: false }; // nothing to resend
      const code = await mintOtp({
        email,
        purpose: (prev?.purpose as "login" | "register") ?? "login",
        firstName: prev?.firstName ?? null,
        lastName: prev?.lastName ?? null,
      });
      const sent = await dispatchOtp(email, code);
      return { ok: sent, sent };
    }),

  /** Sign out of a passwordless session (clears the local session cookie + drops
   *  this device from the session ledger so it leaves the device list). */
  signOut: publicProcedure.mutation(async ({ ctx }) => {
    const opts = getSessionCookieOptions(ctx.req);
    ctx.res.clearCookie("relay_session", { ...opts, maxAge: -1 });
    if (ctx.user && ctx.sessionSid) {
      await revokeSession(ctx.user.id, ctx.sessionSid).catch(() => {});
    }
    return { ok: true };
  }),

  /* ── 4-digit PIN login (v2.87) ──────────────────────────────────
     Set during/after registration; usable INSTEAD of an email code.
     Three wrong entries warn, the fourth LOCKS the account and emails
     the owner; an email-code sign-in unlocks. */

  /** Pre-login probe: does this email sign in by PIN? Sends NOTHING. */
  loginProbe: publicProcedure
    .input(z.object({ email: EmailSchema }))
    .mutation(async ({ ctx, input }) => {
      otpGate(ctx);
      const email = normalizeEmail(input.email);
      if (!isValidEmail(email)) throw new TRPCError({ code: "BAD_REQUEST", message: "Enter a valid email." });
      const user = await findUserByEmailAny(email);
      if (!user) return { unregistered: true, hasPin: false, locked: false, preferPin: false, numberHint: null };
      const u = user as typeof user & {
        loginPinHash?: string | null; loginPinAttempts?: number | null;
        loginPinLockedAt?: Date | null; preferPinLogin?: boolean | null;
      };
      return {
        unregistered: false,
        hasPin: Boolean(u.loginPinHash),
        /**
         * The owner asked for the number to appear as soon as the email is typed,
         * "so we will know that this is your ID and your number" — i.e. the purpose
         * is RECOGNITION, confirming you reached your own account.
         *
         * SO IT IS MASKED, and that is a deliberate narrowing of the ask rather
         * than an oversight. This procedure is reachable by anybody who knows an
         * address, so returning the whole number would make an unauthenticated
         * email → dialable-number oracle: somebody who has your email address could
         * then call and message you on RELAY without you ever giving them your
         * number. The leading group is enough to recognise your own number and is
         * not an address anybody can reach you on.
         *
         * The residual is stated rather than hidden: three known digits narrow an
         * enumeration of the number space for somebody who ALSO knows your display
         * name. That is bounded and throttled, and it is the price of the ask.
         */
        numberHint: await maskedNumberForUser(u.id),
        // v2.99.47: spent attempt slots count as locked even when the lock field
        // never latched (see pinSlotsSpent) — otherwise the probe says "not
        // locked" and AuthPanel parks the user on a pad no entry can satisfy.
        locked: pinSlotsSpent({
          loginPinAttempts: u.loginPinAttempts ?? 0,
          loginPinLockedAt: u.loginPinLockedAt ?? null,
        }),
        preferPin: Boolean(u.preferPinLogin),
      };
    }),

  /** Sign in with the 4-digit PIN (the email-code alternative). */
  loginWithPin: publicProcedure
    .input(
      z.object({
        email: EmailSchema,
        pin: z.string().regex(/^\d{4}$/, { message: "Enter the 4-digit code" }),
        remember: z.union([z.literal(0), z.literal(30), z.literal(60), z.literal(90)]).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      otpGate(ctx);
      const email = normalizeEmail(input.email);
      const user = await findUserByEmailAny(email);
      if (!user) throw new TRPCError({ code: "UNAUTHORIZED", message: "No account with that email." });
      const u = user as typeof user & {
        loginPinHash?: string | null; loginPinAttempts?: number | null; loginPinLockedAt?: Date | null;
      };
      const verdict = await attemptPinLogin(
        {
          id: user.id,
          email: user.email,
          loginPinHash: u.loginPinHash ?? null,
          loginPinAttempts: u.loginPinAttempts ?? 0,
          loginPinLockedAt: u.loginPinLockedAt ?? null,
          preferPinLogin: null,
        },
        input.pin
      );
      switch (verdict.outcome) {
        case "ok": {
          // Same sign-in semantics as verifyOtp: adopt/upgrade the guest
          // identity so number/contacts/messages survive.
          const guestToken = (ctx.req.cookies?.[GUEST_COOKIE] as string | undefined) ?? null;
          await ensureUserIdentity({
            userId: user.id,
            displayName: user.name ?? email.split("@")[0],
            guestToken,
            resolvedIdentityId: ctx.identity?.id ?? null,
            deviceId: ctx.deviceId ?? null,
          });
          // The PIN is the owner's own bypass for approval (their spec), so this path
          // never waits — but it is still recorded, and recorded AS a passcode login,
          // because "somebody signed in with the passcode from Dubai" is exactly the
          // line that tells the owner whether it was them.
          setSessionCookie(
            ctx.res,
            user.id,
            rememberToTtlMs(input.remember),
            await startSession(ctx, user.id, false, "pin"),
          );
          return { ok: true };
        }
        case "no-pin":
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "PIN sign-in isn't set up for this account — use an email code." });
        case "locked":
          throw new TRPCError({ code: "FORBIDDEN", message: "Account locked after too many wrong PINs. Sign in with an email code to unlock." });
        case "locked-now":
          throw new TRPCError({ code: "FORBIDDEN", message: "That was the 4th wrong PIN — the account is now locked and an email is on its way. Sign in with an email code to unlock." });
        case "wrong":
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: verdict.attemptsLeft <= 1
              ? "Incorrect PIN. Careful — one more wrong entry locks the account."
              : `Incorrect PIN. ${verdict.attemptsLeft} tries left before the account locks.`,
          });
      }
    }),

  /** Set / change / remove the login PIN (signed-in users only). */
  setLoginPin: publicProcedure
    .input(z.object({
      pin: z.string().regex(/^\d{4}$/).nullable(), // null ⇒ remove the PIN
      preferPin: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const user = ctx.user;
      if (!user) throw new TRPCError({ code: "UNAUTHORIZED", message: "Sign in first." });
      if (input.pin === null) {
        await clearLoginPin(user.id);
        return { ok: true, hasPin: false };
      }
      if (!isValidPin(input.pin)) throw new TRPCError({ code: "BAD_REQUEST", message: "The PIN is exactly 4 digits." });
      await setLoginPinDb(user.id, input.pin, input.preferPin ?? true);
      return { ok: true, hasPin: true };
    }),

  /** PIN state for the signed-in user (Profile / post-register step). */
  pinStatus: publicProcedure.query(async ({ ctx }) => {
    const user = ctx.user as (typeof ctx.user & {
      loginPinHash?: string | null; loginPinAttempts?: number | null;
      loginPinLockedAt?: Date | null; preferPinLogin?: boolean | null;
    }) | null;
    if (!user) return { signedIn: false, hasPin: false, locked: false, preferPin: false };
    return {
      signedIn: true,
      hasPin: Boolean(user.loginPinHash),
      // Same derived state as loginProbe (v2.99.47) — Profile must not show
      // "PIN sign-in on" for a row whose slots are spent.
      locked: pinSlotsSpent({
        loginPinAttempts: user.loginPinAttempts ?? 0,
        loginPinLockedAt: user.loginPinLockedAt ?? null,
      }),
      preferPin: Boolean(user.preferPinLogin),
    };
  }),

  /* ── email-notification preferences (v2.99.13) ──────────────────────
     Registered users with a linked email can toggle the two transactional
     emails: a missed call (while offline) and a content-free "you have a new
     message" nudge. NULL columns mean ENABLED (the historical default), so
     the read normalizes `!== false`. Guests / email-less accounts get
     hasEmail:false and the Profile section hides itself. */
  getNotificationPrefs: publicProcedure.query(async ({ ctx }) => {
    const user = ctx.user as (typeof ctx.user & {
      email?: string | null;
      emailNotifyMissedCall?: boolean | null;
      emailNotifyMessage?: boolean | null;
      pushEnabled?: boolean | null;
    }) | null;
    if (!user) return { signedIn: false, hasEmail: false, missedCall: true, message: true, push: true };
    return {
      signedIn: true,
      hasEmail: Boolean(user.email),
      missedCall: user.emailNotifyMissedCall !== false,
      message: user.emailNotifyMessage !== false,
      // v2.99.40: NULL/true = on, matching the email prefs.
      push: user.pushEnabled !== false,
    };
  }),

  setNotificationPrefs: publicProcedure
    .input(
      z.object({
        missedCall: z.boolean().optional(),
        message: z.boolean().optional(),
        push: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const user = ctx.user;
      if (!user) throw new TRPCError({ code: "UNAUTHORIZED", message: "Sign in first." });
      await setUserNotificationPrefs(user.id, {
        emailNotifyMissedCall: input.missedCall,
        emailNotifyMessage: input.message,
        pushEnabled: input.push,
      });
      return { ok: true, missedCall: input.missedCall, message: input.message, push: input.push };
    }),

  /* ── device list + remote logout (v2.99.1) ──────────────────────────
     Every login records a row in the `sessions` ledger; this lists the
     signed-in user's devices and lets them log any one out by deleting its
     row (which stops that device's cookie from authenticating). Only the
     account owner sees/affects their own sessions. */

  /** The signed-in user's devices, newest-active first. Marks the CURRENT one. */
  listSessions: publicProcedure.query(async ({ ctx }) => {
    const user = ctx.user;
    if (!user)
      return {
        signedIn: false,
        sessions: [] as Array<PendingSessionWire & { lastSeenAt: number; current: boolean }>,
      };
    const rows = await listSessionsForUser(user.id);
    return {
      signedIn: true,
      // The SAME projection the approval prompt uses (v2.100.1), so the device you
      // approved and the device in this list describe themselves identically.
      sessions: rows.map((r) => ({
        ...pendingSessionWire(r),
        lastSeenAt: new Date(r.lastSeenAt).getTime(),
        current: ctx.sessionSid != null && r.sid === ctx.sessionSid,
      })),
    };
  }),

  /** Log a specific device out by deleting its session row. If it's the CURRENT
   *  device, also clear this cookie so the response signs the caller out too. */
  revokeSession: publicProcedure
    .input(z.object({ sid: z.string().regex(/^[a-f0-9]{1,64}$/) }))
    .mutation(async ({ ctx, input }) => {
      const user = ctx.user;
      if (!user) throw new TRPCError({ code: "UNAUTHORIZED", message: "Sign in first." });
      const removed = await revokeSession(user.id, input.sid);
      if (removed && ctx.sessionSid && input.sid === ctx.sessionSid) {
        const opts = getSessionCookieOptions(ctx.req);
        ctx.res.clearCookie(LOCAL_SESSION_COOKIE, { ...opts, maxAge: -1 });
      }
      return { ok: true, removed };
    }),

  /* ── new-device login approval (v2.99.7) ────────────────────────────
     A new email-code sign-in on an account with another ONLINE device parks
     as `pendingApproval` and does not authenticate until an existing device
     approves it (or the user used their 4-digit PIN, which bypasses this
     entirely). The waiting device polls `sessionApprovalStatus` by its own
     cookie; the account's other devices see `pendingSessions` in the
     notification center and call approve/revoke. */

  /** Polled by the WAITING device (it isn't authenticated yet, so this reads
   *  its own cookie sid directly): "pending" | "approved" | "denied".
   *  Fail-open ("approved") on any trouble so a legit device is never stranded. */
  sessionApprovalStatus: publicProcedure.query(async ({ ctx }) => {
    const sess = readLocalSession(ctx.req);
    if (!sess?.sid) return { status: "approved" as const };
    const status = await sessionApprovalBySid(sess.sid);
    return { status };
  }),

  /** The account's devices still WAITING for this user to approve them (drives
   *  the notification-center approve/deny rows). Empty unless signed in. */
  pendingSessions: publicProcedure.query(async ({ ctx }) => {
    const user = ctx.user;
    if (!user) return { signedIn: false, pending: [] as PendingSessionWire[] };
    const rows = await pendingSessionsForUser(user.id);
    return { signedIn: true, pending: rows.map(pendingSessionWire) };
  }),

  /** Approve a waiting device (ownership-scoped) → it starts authenticating.
   *  Deny is just `revokeSession` (deletes the row → cookie stops working). */
  approveSession: publicProcedure
    .input(z.object({ sid: z.string().regex(/^[a-f0-9]{1,64}$/) }))
    .mutation(async ({ ctx, input }) => {
      const user = ctx.user;
      if (!user) throw new TRPCError({ code: "UNAUTHORIZED", message: "Sign in first." });
      const approved = await approveSession(user.id, input.sid);
      return { ok: true, approved };
    }),
});

/* ── web push router (v2.83) ──────────────────────────────────────
 * Registers/removes a browser's Web Push subscription so the server can WAKE
 * this device for incoming calls (paging) and missed-call notices even when
 * no tab/SSE is alive. `publicKey` hands the client the VAPID application
 * server key it must subscribe with (null ⇒ push disabled on this deploy). */
export const v2PushRouter = router({
  publicKey: publicProcedure.query(() => {
    const cfg = vapidConfig();
    return { key: cfg?.publicKey ?? null };
  }),

  subscribe: publicProcedure
    .input(
      z
        .object({
          endpoint: z.string().min(10).max(500),
          /** Web Push encryption keys — required for browsers, absent for FCM
           *  (the native Android app registers a bare device token). */
          keys: z
            .object({
              p256dh: z.string().min(10).max(255),
              auth: z.string().min(6).max(120),
            })
            .optional(),
          // "apns" is accepted as a LABEL (v2.105.11) so an iOS shell can say what it
          // has — but it is only ever a hint: `classifyNativeToken` below re-derives the
          // kind from the token's SHAPE, so a client gains nothing by lying here.
          //
          // "apns-voip" (v2.105.13) is the ONE exception, because the shape cannot
          // carry it: a PushKit VoIP token and an ordinary APNs alert token are both
          // pure hex of the same length. See `isVoipDeclaration` for why trusting it
          // here is safe — a shell that mislabels breaks only its own delivery.
          kind: z.enum(["webpush", "fcm", "expo", "apns", "apns-voip"]).optional(),
          /** Proof-of-possession secret (v2.99.49): a per-browser value the
           *  client keeps in localStorage. Optional — an old client, or one with
           *  storage disabled, simply doesn't send it and falls back to the
           *  legacy keys-match path. */
          claim: z.string().regex(/^[a-f0-9]{32,64}$/).optional(),
        })
        .refine(v => (v.kind ?? "webpush") !== "webpush" || !!v.keys, {
          message: "keys are required for webpush subscriptions",
        })
    )
    .mutation(async ({ ctx, input }) => {
      const me = requireIdentity(ctx);
      // Widened for `apns` (v2.105.11): the WIRE enum stays the three kinds a client may
      // CLAIM, but the shape re-derivation below can answer with a fourth that no client
      // is allowed to assert. TypeScript caught this the moment the kind widened, which is
      // the guard working — a stored kind the sender cannot route must be a deliberate
      // decision, never something that slipped through a narrowing.
      let kind: "webpush" | NativeTokenKind = input.kind ?? "webpush";
      // NATIVE tokens: the SHAPE decides the transport, not the label (v2.99.79).
      //
      // The label arrives from a mobile shell over a WebView bridge, and getting it
      // wrong is a SILENT failure: an Expo token posted to FCM is not a
      // registration token, so every notification is dropped with nothing in the
      // logs pointing at why. `classifyNativeToken` re-derives it, and a token that
      // is neither shape is refused at the door rather than stored and never
      // delivered to.
      if (kind !== "webpush") {
        const actual = classifyNativeToken(input.endpoint);
        if (!actual) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Unrecognised push token." });
        }
        // The shape wins — EXCEPT for the one distinction it cannot express. A
        // PushKit VoIP token and an APNs alert token are both pure hex, so the
        // client's declaration is the only available signal, and misdeclaring it
        // costs the declarer their own ring and nobody else anything.
        kind = isVoipDeclaration(input.kind, actual) ? "apns-voip" : actual;
      }
      // SECURITY (S8): a webpush endpoint is a URL the server later connects to;
      // reject anything that isn't https on a known push service so it can't be
      // used as a stored blind-SSRF primitive. FCM tokens aren't URLs.
      if (kind === "webpush" && !isAllowedWebPushEndpoint(input.endpoint)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Unsupported push endpoint." });
      }
      const { owned } = await upsertPushSubscription({
        identityId: me.id,
        endpoint: input.endpoint,
        p256dh: kind === "webpush" ? input.keys!.p256dh : kind,
        auth: kind === "webpush" ? input.keys!.auth : kind,
        kind,
        claimHash: input.claim ? sha256Hex(input.claim) : null,
      });
      // `owned: false` means this endpoint belongs to a different identity and the
      // caller couldn't prove possession. The client answers by rotating to a
      // FRESH endpoint rather than being silently unnotifiable — which is what
      // removes the downside that kept this residual open.
      return { ok: true, owned };
    }),

  /**
   * Mirror this DEVICE's Do Not Disturb / mute / lock lists onto its own
   * subscription row (v2.107.11).
   *
   * WHY THE SERVER NEEDS THEM AT ALL. All three are per-device localStorage
   * settings enforced by the service worker, which was sufficient for exactly as
   * long as every OS-level alert went through it. v2.107.8 attached an FCM
   * `notification` block and started sending Expo pushes so message notifications
   * would appear on the native shells — and the OS renders both of those directly.
   * From that release DND silenced nothing on a phone, a muted conversation buzzed
   * anyway, and a LOCKED group's message preview appeared on the lock screen naming
   * the sender and quoting the text, which is exactly what the lock exists to stop.
   *
   * The page already mirrors these into Cache Storage for the worker; this is the
   * same mirror, to the row the sender reads. It is authoritative for nothing — the
   * settings still live on the device, and an unsynced row suppresses nothing.
   */
  setAlertPrefs: publicProcedure
    .input(
      z.object({
        endpoint: z.string().min(10).max(500),
        dnd: z.boolean().optional(),
        muted: z.array(z.number().int().positive()).max(MAX_ALERT_IDS).optional(),
        locked: z.array(z.number().int().positive()).max(MAX_ALERT_IDS).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const me = requireIdentity(ctx);
      const stored = await setPushAlertPrefs({
        identityId: me.id,
        endpoint: input.endpoint,
        prefs: normalizeAlertPrefs(input),
      });
      // `stored:false` is NOT an error. A device can legitimately sync before its
      // token is registered, or after the per-identity cap evicted the row; the
      // honest answer is "nothing was written", and the page retries on its next
      // change rather than showing anybody a failure they cannot act on.
      return { ok: true as const, stored };
    }),

  /** Endpoint URLs are unguessable capability URLs, so possession is proof
   *  enough to remove one (same trust model as the push service itself). */
  unsubscribe: publicProcedure
    .input(z.object({ endpoint: z.string().min(10).max(500) }))
    .mutation(async ({ ctx, input }) => {
      // SECURITY: scope the delete to the caller's OWN subscription. `endpoint`
      // alone used to be sufficient — anyone who learned a victim's endpoint
      // string could silently kill their incoming-call/missed-call push.
      const me = requireIdentity(ctx);
      await deleteOwnPushSubscription(me.id, input.endpoint);
      return { ok: true };
    }),
});

/* ── party lines router (v2.89) ───────────────────────────────────
 * Dialable ROOM numbers. Guests allowed (an identity is an identity);
 * per-IP rate-limited so the shared 6-digit number space can't be
 * farmed, plus a per-owner cap enforced in the DB helper. */

const partyLineIpLimiter = createRateLimiter({ capacity: 10, refillPerSec: 10 / 60 });
setInterval(() => partyLineIpLimiter.sweep(Date.now(), 30 * 60_000), 30 * 60_000).unref();
function partyLineGate(ctx: { req: unknown }) {
  if (process.env.RELAY_RATELIMIT_OFF === "1") return;
  if (!partyLineIpLimiter.allow(clientIpOf(ctx.req as Parameters<typeof clientIpOf>[0]), Date.now())) {
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many party-line changes. Try again shortly." });
  }
}

export const v2PartyLinesRouter = router({
  /** Create a line → it gets its OWN 6-digit number (shared number space with
   *  identities — allocation checks both tables). */
  create: publicProcedure
    .input(z.object({ title: z.string().trim().min(1).max(64) }))
    .mutation(async ({ ctx, input }) => {
      const me = requireIdentity(ctx);
      partyLineGate(ctx);
      try {
        // Apple 1.2 — a party-line title is shown to everyone who joins the line, so
        // it's UGC-filtered before it's stored.
        const row = await createPartyLine({ ownerIdentityId: me.id, title: sanitizeUgcText(input.title) });
        return { id: row.id, number: row.number, title: row.title, createdAt: row.createdAt };
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Could not create the party line.";
        if (msg.includes("at most")) {
          throw new TRPCError({ code: "BAD_REQUEST", message: msg });
        }
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Could not create the party line." });
      }
    }),

  /** The caller's OWN lines, newest first, with live head-counts. */
  list: publicProcedure.query(async ({ ctx }) => {
    const me = requireIdentity(ctx);
    const rows = await listPartyLines(me.id);
    const counts = await partyLineLiveCountsAsync(rows.map((r) => r.number));
    return rows.map((r) => ({
      id: r.id,
      number: r.number,
      title: r.title,
      createdAt: r.createdAt,
      liveCount: counts.get(r.number) ?? 0,
      max: MAX_PARTY_LINES_PER_OWNER,
    }));
  }),

  /** Owner-only delete. Anyone currently ON the line keeps talking until they
   *  leave; the number just stops resolving for NEW dials. */
  remove: publicProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const me = requireIdentity(ctx);
      partyLineGate(ctx);
      const removed = await deletePartyLine(me.id, input.id);
      if (!removed) {
        throw new TRPCError({ code: "NOT_FOUND", message: "That party line isn't yours (or is already gone)." });
      }
      return { ok: true };
    }),
});

/* ── rich user status (story-style, ephemeral) ─────────────────────────────
   text / image+caption / video+caption / audio, visible to the owner + their
   contacts, auto-expiring (24h). Media is uploaded via /api/v2/upload (same as
   attachments) and referenced by mediaKey; the URL is derived server-side after
   an ownership-namespace check (identical gate to attachments.register). */

const StatusKindSchema = z.enum(["text", "image", "video", "audio"]);
const STATUS_TTL_MS = 24 * 60 * 60 * 1000; // 24h, story-style
const STATUS_MAX_TEXT = 700;
const STATUS_MAX_ACTIVE = 30; // per-user cap on concurrent active statuses

// Rate gate (mirrors otp/party-line): caps status POSTs + view-records per IP so
// a client can't spray fake views across every status id (adversarial review §5).
const statusIpLimiter = createRateLimiter({ capacity: 60, refillPerSec: 60 / 60 });
setInterval(() => statusIpLimiter.sweep(Date.now(), 30 * 60_000), 30 * 60_000).unref();
function statusGate(ctx: { req: unknown }) {
  if (process.env.RELAY_RATELIMIT_OFF === "1") return;
  if (!statusIpLimiter.allow(clientIpOf(ctx.req as Parameters<typeof clientIpOf>[0]), Date.now())) {
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many status actions. Try again shortly." });
  }
}

/**
 * A text status's background is author-controlled and injected into a CSS
 * `background` shorthand on the viewer's device. Restrict it to a solid hex
 * color or a linear/radial-gradient built ONLY from safe tokens — no `url(...)`,
 * so an author can't turn a status into a tracking beacon that phones home from
 * every viewer's browser (adversarial review §8). Anything else → null (default).
 */
export function sanitizeStatusBg(v: string | undefined | null): string | null {
  if (!v) return null;
  const s = v.trim().slice(0, 64);
  if (/url\(|@|;|\{|\}|expression|image-set|<|>/i.test(s)) return null;
  const hex = /^#[0-9a-fA-F]{3,8}$/;
  const grad = /^(linear|radial)-gradient\([#0-9a-zA-Z.,%()\s-]+\)$/;
  return hex.test(s) || grad.test(s) ? s : null;
}

/** The two status-audience options (v2.99.66). */
const StatusAudienceSchema = z.enum(["contacts", "everyone"]);

/**
 * The wire shape of a status.
 *
 * `own` adds `audience` — a per-post choice is useless if the author can't see
 * what they picked. It is deliberately NOT sent for other people's statuses:
 * whether someone's story is public or contacts-only is not something a viewer
 * needs, and this codebase has been bitten by shipping fields nobody consumes
 * (v2.99.40 #4 serialized the caller's own credential hashes into every
 * `auth.me`). Send the minimum that the surface renders.
 */
function publicStatus(
  r: StatusRow,
  own = false,
  /**
   * Who wrote it — sent ONLY for a group story (v2.105.6), where a reel legitimately
   * mixes authors and the viewer has to say which member each slide came from. Omitted
   * for a personal reel, where it would restate the reel's own owner on every item.
   */
  author?: { id: number; number: string; displayName: string; avatarUrl: string | null },
) {
  return {
    id: r.id,
    kind: r.kind,
    text: r.text,
    bgColor: r.bgColor,
    mediaUrl: r.mediaUrl,
    mimeType: r.mimeType,
    durationMs: r.durationMs,
    ...(own ? { audience: normalizeStatusAudience(r.audience) } : {}),
    /**
     * Is this slide MINE — i.e. may I delete it and see who watched it?
     *
     * PER-ITEM rather than per-reel, and that generalization is what group stories
     * needed. Both facts have always been per-item; the reel-level `owner.isMe` was
     * only ever a correct proxy because every reel had exactly one author. A group
     * reel does not, so reading ownership off the reel would offer Delete on a
     * fellow member's slide (the server would refuse it — `deleteStatus` is
     * author-scoped — leaving a button that silently does nothing).
     */
    mine: own,
    ...(author ? { author } : {}),
    createdAt: r.createdAt,
    expiresAt: r.expiresAt,
  };
}

/**
 * One reel in the story feed: everything a single ring stands for.
 *
 * `subject` is WHAT THE RING IS ON, and it is a discriminated record rather than a
 * reused `owner` because a group is not a person (the v2.102.0 rule: name the group
 * fields `group*`, never borrow `peer*`). Two properties make it hard to misread:
 *
 *  - `key` is `"p:<identityId>"` or `"g:<conversationId>"`, so the strip's identity
 *    and React key are unambiguous by construction. Using a bare numeric id would
 *    put identity ids and conversation ids in one field, which is exactly how a
 *    surface comes to render a group's id as a person's.
 *  - `identityId` and `conversationId` are non-null in mutually exclusive cases,
 *    so a reader that wants a real id has to say which kind it means.
 *
 * `isMe` stays about a PERSON. A group reel is never "mine" — the flag drives "My
 * story", the delete row and the chain skip — and per-item `mine` carries what is
 * actually mine inside a reel that mixes authors.
 */
type StatusReel = {
  subject: {
    key: string;
    kind: "person" | "group";
    identityId: number | null;
    conversationId: number | null;
    number: string;
    displayName: string;
    avatarUrl: string | null;
    isMe: boolean;
  };
  items: ReturnType<typeof publicStatus>[];
  hasUnseen: boolean;
  latestAt: Date;
};

/**
 * Fan a realtime "status" SSE event out to everyone whose feed includes this post
 * (v2.96; group-aware v2.105.6). Fire-and-forget from post/remove — never blocks
 * the mutation result on the audience query.
 *
 * THE CHOICE OF AUDIENCE LIVES HERE AND NOWHERE ELSE. A group story reaches the
 * group's members; a personal one reaches the contact graph. Those are different
 * queries, so what has to be single is the decision between them — a second call
 * site picking for itself is how a group story comes to be announced to the
 * author's contacts, who cannot open it.
 */
async function publishStatusEvent(
  ownerId: number,
  ownerNumber: string,
  ownerName: string,
  removed?: boolean,
  /** The group it was addressed to, or null for a personal story. */
  conversationId?: number | null,
  /** The group's display name, so the toast can name the group and not the author. */
  groupName?: string | null,
): Promise<void> {
  const audience =
    conversationId != null
      ? await getGroupStatusAudienceIds(conversationId, ownerId)
      : await getStatusAudienceIds(ownerId, ownerNumber);
  for (const id of audience) {
    publishToIdentity(id, {
      kind: "status",
      number: ownerNumber,
      // The client shows "<name> posted a story"; for a group the newsworthy
      // subject is the GROUP, so it is named and the author is not — matching
      // where the ring appears.
      name: conversationId != null ? (groupName || "A group") : ownerName,
      ...(removed ? { removed: true } : {}),
    });
  }
}

export const v2StatusRouter = router({
  /** Post a status. Text kind needs text; media kinds need an owned mediaKey. */
  post: publicProcedure
    .input(
      z.object({
        kind: StatusKindSchema,
        text: z.string().max(STATUS_MAX_TEXT).optional(),
        bgColor: z.string().max(64).optional(),
        mediaKey: z.string().max(256).optional(),
        mimeType: z.string().max(128).optional(),
        durationMs: z.number().int().min(0).max(10 * 60_000).optional(),
        /** Per-post override; omitted ⇒ my saved default (v2.99.66). */
        audience: StatusAudienceSchema.optional(),
        /**
         * Post this story TO A GROUP instead of to my own ring (v2.105.6, #110).
         * Omitted ⇒ a personal story, byte-identical to every previous caller.
         */
        conversationId: z.number().int().positive().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const me = requireIdentity(ctx);
      statusGate(ctx);
      // Apple 1.2 — a story's text is broadcast to the poster's audience (or a whole
      // group), so it's UGC-filtered here, before the length checks and the write,
      // and every downstream use (the row, the push excerpt) sees the masked text.
      const text = sanitizeUgcText((input.text ?? "").trim());
      /* GROUP STORIES: MEMBERSHIP IS CHECKED HERE, SERVER-SIDE, BEFORE ANY WRITE.
       *
       * A conversation id is a small sequential integer, so without this anybody
       * could address a story to any group in the database — and since membership
       * is what AUTHORIZES reading a group story, that would publish content into a
       * room of strangers. The same reasoning that put `setGroupProfile`'s gate
       * inside the function rather than in options a caller passes: this writes a
       * row several people will read, so who may do it is the safety argument.
       *
       * `checkGroupPermission` is reused rather than a membership SELECT written
       * here, so the DM refusal, the not-found refusal and the fail-closed
       * `unavailable` behaviour are the group module's, not a second copy. The
       * capability is `post-story`, which is unconditional for members — a group
       * has no notion of "may post" today, and inventing an admin-only rule would
       * be a permission model nobody asked for. It exists as its own capability so
       * that restricting it later is one line in one place.
       *
       * A DM IS REFUSED OUTRIGHT rather than treated as a two-person group: a DM
       * borrows the peer's name, photo and status and has no identity of its own,
       * so there is nothing for a story to hang on — and a "story" visible to
       * exactly one person is a message. */
      let group: { id: number; title: string | null } | null = null;
      if (input.conversationId != null) {
        const gate = await checkGroupPermission(input.conversationId, me.id, "post-story");
        if (!gate.ok) {
          // Each refusal is NAMED because they need different next steps, and
          // "not a member" answers identically to "no such group" so the endpoint
          // is not an existence oracle over conversation ids.
          const message =
            gate.reason === "not-a-group"
              ? "Stories go to a group, not a direct chat."
              : gate.reason === "unavailable"
                ? "Couldn't check that group just now."
                : "That group isn't yours to post in.";
          throw new TRPCError({
            code: gate.reason === "unavailable" ? "INTERNAL_SERVER_ERROR" : "FORBIDDEN",
            message,
          });
        }
        const [g] = await getGroupsByIds([input.conversationId]);
        group = { id: input.conversationId, title: g?.title ?? null };
      }
      // SECURITY (M30 — status-media laundering, the F2 class again): the
      // ownership gate below used to live ONLY in the media-kind `else` branch,
      // but `input.mediaKey` was persisted for EVERY kind. So a `kind:"text"`
      // post could smuggle an arbitrary key into its `mediaKey`/`mediaUrl`
      // without any namespace check.
      //
      // That matters because `authorizeStorageKey` resolves a `/status_` key by
      // looking up whichever ACTIVE status row claims it, and grants access to
      // THAT row's owner and audience — checked BEFORE the attachment branch. So
      // planting another user's status key on your own text status re-activates
      // it: an EXPIRED or DELETED status, whose media is supposed to be
      // permanently unreachable ("truly ephemeral at the access layer even
      // though the object lingers in the bucket"), becomes readable again by the
      // planter and re-exposed to the planter's own audience. Anyone who was in
      // the original audience while it was live already knows the key.
      //
      // Validate whenever a key is supplied, regardless of kind.
      if (input.mediaKey && !keyInOwnerNamespace(input.mediaKey, me.id, s3Config()?.prefix ?? "")) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "That upload isn't yours." });
      }
      if (input.kind === "text") {
        if (!text) throw new TRPCError({ code: "BAD_REQUEST", message: "A text status needs some text." });
      } else {
        if (!input.mediaKey) throw new TRPCError({ code: "BAD_REQUEST", message: "Missing media for this status." });
      }
      // A text status has no media by definition — never persist a key for one,
      // so it can't claim a `/status_` key in the authorization table at all.
      const mediaKey = input.kind === "text" ? null : (input.mediaKey ?? null);
      // Cap so posting isn't an unbounded DB/storage cost vector — counted on the
      // shelf being posted to (#119). A group story spends one of THAT GROUP's
      // slots, not one of the author's personal thirty, so posting into several
      // groups can no longer lock somebody out of their own reel. The refusal names
      // which shelf is full, because "you can have up to 30" while a personal reel
      // sits empty is a message somebody cannot act on.
      if ((await countActiveStatuses(me.id, group?.id ?? null)) >= STATUS_MAX_ACTIVE) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: group
            ? `You can have up to ${STATUS_MAX_ACTIVE} active stories in one group.`
            : `You can have up to ${STATUS_MAX_ACTIVE} active stories.`,
        });
      }
      const mediaUrl = mediaKey ? `/manus-storage/${mediaKey}` : null;
      // v2.99.66 — resolve the audience ONCE, here, and store it on the row. An
      // explicit per-post choice wins; otherwise fall back to my saved default.
      // A DB hiccup reading the default resolves to "contacts" (the private
      // option), so a failed read can never publish a post wider than intended.
      const audience =
        input.audience ?? (await getIdentityStatusAudience(me.id).catch(() => "contacts" as const));
      const row = await insertStatus({
        identityId: me.id,
        conversationId: group?.id ?? null,
        kind: input.kind,
        text: text || null,
        // Author-controlled bg is restricted to safe color/gradient tokens.
        bgColor: sanitizeStatusBg(input.bgColor),
        mediaKey,
        mediaUrl,
        mimeType: input.mimeType ?? null,
        durationMs: input.durationMs ?? null,
        audience,
        ttlMs: STATUS_TTL_MS,
      });
      if (!row) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Couldn't post your status." });
      // Realtime (v2.96): tell everyone whose feed includes this post — instantly —
      // so their rings/feed refresh and Messages can show a quiet toast. For a
      // group story that is the group's members, not my contacts.
      publishStatusEvent(
        me.id,
        me.number,
        me.displayName,
        undefined,
        group?.id ?? null,
        group?.title ?? null,
      ).catch(() => {});
      return { id: row.id, expiresAt: row.expiresAt };
    }),

  /** The story feed: my active statuses + my contacts', grouped by owner. */
  feed: publicProcedure.query(async ({ ctx }) => {
    const me = requireIdentity(ctx);
    // Either-direction feed (v2.99.33): my own statuses + statuses of people I
    // saved AND people who saved ME — so a contact's post shows up even if I
    // haven't added them back (mirrors statusAudienceAuthorized). Blocks are
    // dropped: getContactNumbersForOwner already excludes contacts I blocked,
    // and `blockedMe` below drops any owner who blocked ME.
    const contactNumbers = await getContactNumbersForOwner(me.id);
    const contactIdents = contactNumbers.length ? await getIdentitiesByNumbers(contactNumbers) : [];
    const savedMeIds = await getIdentityIdsWhoSaved(me.number);
    const candidateIds = Array.from(
      new Set<number>([me.id, ...contactIdents.map((i) => i.id), ...savedMeIds]),
    );
    const blockedMe = await ownersWhoBlockedNumber(candidateIds.filter((id) => id !== me.id), me.number);
    // …and drop anyone *I* blocked (v2.99.57). `getContactNumbersForOwner` already
    // excludes contacts I blocked, but `savedMeIds` is the OTHER direction — people
    // who saved MY number — and it only filters out savers who blocked me. So a
    // person I had blocked, who had saved me, stayed in my feed: their status text
    // and the fact they posted leaked, while `statusAudienceAuthorized` correctly
    // refused their MEDIA, which merely rendered as a broken image. Two
    // independently-written gates disagreeing, which is the trap this codebase keeps
    // paying for; the block must hide them here too.
    const iBlocked = await getBlockedNumbersForOwner(me.id);
    const blockedIdents = iBlocked.size
      ? new Set(
          (await getIdentitiesByNumbers(Array.from(iBlocked)))
            .filter((i) => iBlocked.has(i.number))
            .map((i) => i.id),
        )
      : new Set<number>();
    const ownerIds = candidateIds.filter(
      (id) => id === me.id || (!blockedMe.has(id) && !blockedIdents.has(id)),
    );
    const rows = await getActiveStatusesForOwners(ownerIds);
    const owners = await getIdentitiesByIds(Array.from(new Set(rows.map((r) => r.identityId))));
    const ownerById = new Map(owners.map((o) => [o.id, o]));
    const viewed = await getViewedStatusIds(me.id, rows.map((r) => r.id));

    const byOwner = new Map<number, StatusRow[]>();
    for (const r of rows) {
      const arr = byOwner.get(r.identityId) ?? [];
      arr.push(r);
      byOwner.set(r.identityId, arr);
    }
    const reels: StatusReel[] = Array.from(byOwner.entries()).map(([oid, items]) => {
      const o = ownerById.get(oid);
      const latest = items[items.length - 1];
      return {
        subject: {
          key: personReelKey(oid),
          kind: "person" as const,
          identityId: oid,
          conversationId: null,
          number: o?.number ?? "",
          displayName: o?.displayName ?? "Someone",
          avatarUrl: o?.avatarUrl ?? null,
          isMe: oid === me.id,
        },
        items: items.map((it) => publicStatus(it, oid === me.id)),
        hasUnseen: oid !== me.id && items.some((it) => !viewed.has(it.id)),
        latestAt: latest.createdAt,
      };
    });

    /* ── THE GROUP HALF (v2.105.6, #110) ─────────────────────────────────────
     * A group's stories are ONE reel keyed by the GROUP, not one reel per author.
     * Grouping by author instead would put the same group's ring in the strip
     * once per member who has posted, which is not a thing a strip can mean.
     *
     * The candidate set is my own group memberships, so no story reaches this
     * list that membership did not already authorize — the same set
     * `statusAudienceAuthorized` consults, read from the same table. Blocks are
     * NOT applied to the reel as a whole on purpose: a block is between two
     * people, and dropping a whole group because one member in it blocked me
     * would hide nineteen other people's stories. Per-ITEM filtering below is
     * where the block belongs, and it is the same either-direction rule as
     * everywhere else. */
    const myGroupIds = await getGroupConversationIdsFor(me.id);
    if (myGroupIds.length > 0) {
      const groupRows = await getActiveStatusesForConversations(myGroupIds);
      if (groupRows.length > 0) {
        const authorIds = Array.from(new Set(groupRows.map((r) => r.identityId)));
        const authors = await getIdentitiesByIds(authorIds);
        const authorById = new Map(authors.map((a) => [a.id, a]));
        // A member who blocked me, or whom I blocked, contributes nothing —
        // reusing the two sets already computed above, so the group half cannot
        // disagree with the personal half about who is hidden.
        const hiddenAuthors = await ownersWhoBlockedNumber(
          authorIds.filter((id) => id !== me.id),
          me.number,
        );
        const visible = groupRows.filter(
          (r) => r.identityId === me.id || (!hiddenAuthors.has(r.identityId) && !blockedIdents.has(r.identityId)),
        );
        const groupViewed = await getViewedStatusIds(me.id, visible.map((r) => r.id));
        const meta = await getGroupsByIds(
          Array.from(new Set(visible.map((r) => r.conversationId!).filter((v) => v != null))),
        );
        const metaById = new Map(meta.map((g) => [g.id, g]));
        const byGroup = new Map<number, StatusRow[]>();
        for (const r of visible) {
          const cid = r.conversationId;
          if (cid == null) continue;
          const arr = byGroup.get(cid) ?? [];
          arr.push(r);
          byGroup.set(cid, arr);
        }
        // `Array.from`, not a bare `for…of` over the Map: this tsconfig targets ES5
        // and direct Map iteration is a TS2802 build error (v2.99.72, v2.99.98 —
        // `pnpm build` uses esbuild and does not typecheck, so only `pnpm check`
        // catches it).
        for (const [cid, items] of Array.from(byGroup.entries())) {
          const g = metaById.get(cid);
          // A group whose meta row did not come back is not a group I may read —
          // getGroupsByIds filters to kind="group" — so it is dropped rather than
          // rendered under a placeholder name.
          if (!g) continue;
          const latest = items[items.length - 1];
          reels.push({
            subject: {
              key: groupReelKey(cid),
              kind: "group" as const,
              identityId: null,
              conversationId: cid,
              // The GROUP's own 6-digit id (v2.102.0) — null for a group created
              // before that release, and the UI omits what it does not have.
              number: g.number ?? "",
              displayName: g.title || "Group",
              avatarUrl: g.avatarUrl ?? null,
              // Never true. A group is not me, and this flag drives "My story",
              // the delete row and the chain skip — all of which are about a
              // person. Per-item `mine` carries what is actually mine.
              isMe: false,
            },
            items: items.map((it) => {
              const a = authorById.get(it.identityId);
              return publicStatus(it, it.identityId === me.id, {
                id: it.identityId,
                number: a?.number ?? "",
                displayName: a?.displayName ?? "Someone",
                avatarUrl: a?.avatarUrl ?? null,
              });
            }),
            // My own slides never count as unseen — I wrote them.
            hasUnseen: items.some((it) => it.identityId !== me.id && !groupViewed.has(it.id)),
            latestAt: latest.createdAt,
          });
        }
      }
    }

    // Order: me first, then subjects with unseen updates, then most-recent.
    reels.sort((a, b) => {
      if (a.subject.isMe !== b.subject.isMe) return a.subject.isMe ? -1 : 1;
      if (a.hasUnseen !== b.hasUnseen) return a.hasUnseen ? -1 : 1;
      return new Date(b.latestAt).getTime() - new Date(a.latestAt).getTime();
    });
    return { groups: reels };
  }),

  /**
   * The stories on MY OWN RING, with a "seen by N" count each.
   *
   * PERSONAL ONLY — a decision I got wrong first and corrected by reading what this
   * actually feeds (v2.105.6). Its single consumer is the top bar: the story pip on my
   * avatar and the "Open my story - N" row in its menu, which calls
   * `openPeerStatus(me.number)` and therefore opens MY PERSON REEL. Including group
   * stories here lit the pip and read 1 for somebody whose only story was posted to a
   * group, and the tap then found no person reel, fell through to `status.forNumber`
   * (personal-only by design, since that is the contacts-authorized surface) and
   * rendered NOTHING. A dead tap plus an overstated count — the v2.99.86
   * silent-no-op class, reintroduced by my own change and caught by reading the
   * consumer rather than by any test.
   *
   * Nothing is lost by narrowing it. The pip means "there is a story on your own
   * ring", which is the honest reading of the ring vocabulary — a group story's ring
   * is on the GROUP, and the author already sees it in the Messages strip and on the
   * group's own thread row. Viewers of a group story come from `status.viewers`, which
   * is author-gated and reachable from the group reel itself.
   */
  mine: publicProcedure.query(async ({ ctx }) => {
    const me = requireIdentity(ctx);
    const rows = await getActiveStatusesForOwners([me.id]);
    const counts = await getStatusViewCounts(rows.map((r) => r.id));
    return { items: rows.map((r) => ({ ...publicStatus(r, true), viewCount: counts.get(r.id) ?? 0 })) };
  }),

  /** Delete one of my statuses. */
  remove: publicProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const me = requireIdentity(ctx);
      // Read the row BEFORE deleting it: a group story's removal has to reach the
      // GROUP's members, and once the row is gone there is nothing left to say
      // which group that was. Only the author may delete (deleteStatus is
      // author-scoped), so this read reveals nothing the caller does not own.
      const before = await getActiveStatusById(input.id);
      const ok = await deleteStatus(input.id, me.id);
      // Removal fans out too (no toast client-side) so stale rings clear.
      if (ok) {
        let groupName: string | null = null;
        if (before?.conversationId != null) {
          const [g] = await getGroupsByIds([before.conversationId]);
          groupName = g?.title ?? null;
        }
        publishStatusEvent(
          me.id,
          me.number,
          me.displayName,
          true,
          before?.conversationId ?? null,
          groupName,
        ).catch(() => {});
      }
      return { ok };
    }),

  /**
   * #118 — a group ADMIN removes a story a MEMBER posted to their group.
   *
   * Its own procedure rather than a branch inside `remove`, mirroring the writer
   * split: `remove` is the author deleting their own, this is an admin acting on
   * somebody else's, and the two have different authority, different refusals and
   * different fan-out subjects. One procedure doing both is how a caller comes to
   * exercise the wrong one.
   *
   * THE FAN-OUT NAMES THE AUTHOR, NOT THE ADMIN, and that matters: the event says
   * whose story has gone, and every member's client keys their rings on the author.
   * Publishing it under the admin's identity would clear a ring the admin never had
   * and leave the real one lit for up to 24 hours.
   */
  removeAsGroupAdmin: publicProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const me = requireIdentity(ctx);
      statusGate(ctx);
      const res = await deleteStatusAsGroupAdmin(input.id, me.id);
      if (!res.ok) {
        // "No such story", "that is a personal story" and "you are not an admin
        // here" answer IDENTICALLY. Status ids are small sequential integers, so a
        // distinguishable refusal would let anybody probe which ids exist and which
        // groups they belong to.
        throw new TRPCError({ code: "NOT_FOUND", message: "That story isn't there to remove." });
      }
      const author = await getIdentityById(res.authorId).catch(() => null);
      const [g] = await getGroupsByIds([res.conversationId]);
      publishStatusEvent(
        res.authorId,
        author?.number ?? "",
        author?.displayName ?? "",
        true,
        res.conversationId,
        g?.title ?? null,
      ).catch(() => {});
      return { ok: true };
    }),

  /** Record that I viewed a status (idempotent; self-views aren't recorded). */
  markViewed: publicProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const me = requireIdentity(ctx);
      statusGate(ctx);
      const st = await getActiveStatusById(input.id);
      if (!st) return { ok: false };
      if (st.identityId === me.id) return { ok: true };
      // Only someone in the status's audience can register a view — otherwise a
      // stranger (even a guest with an attacker-chosen name) could enumerate
      // status ids and inject themselves into the owner's "Seen by" (review §5).
      // `conversationId` is REQUIRED here, not optional decoration: for a group
      // story the author's contacts rule is the wrong question, so omitting it
      // would refuse the very members it was posted for and their views would
      // silently never be recorded — the ring would stay lit forever.
      if (!(await statusAudienceAuthorized(me.id, st.identityId, st.audience, st.conversationId)))
        return { ok: false };
      await recordStatusView(input.id, me.id);
      return { ok: true };
    }),

  /* ── who can watch my statuses (v2.99.66) ──────────────────────────
     Two options, per the owner's ask: everyone, or contacts only. The value is
     the DEFAULT for future posts; each status carries its own copy, so changing
     this never reaches back into something already published. */

  /** My default status audience. NULL in the DB ⇒ "contacts". */
  getPrivacy: publicProcedure.query(async ({ ctx }) => {
    const me = requireIdentity(ctx);
    return { audience: await getIdentityStatusAudience(me.id) };
  }),

  /** Change the default audience for FUTURE statuses. */
  setPrivacy: publicProcedure
    .input(z.object({ audience: StatusAudienceSchema }))
    .mutation(async ({ ctx, input }) => {
      const me = requireIdentity(ctx);
      await setIdentityStatusAudience(me.id, input.audience);
      return { ok: true, audience: input.audience };
    }),

  /**
   * The active statuses of ONE person I'm allowed to watch, by number — the
   * profile-visit surface that gives "everyone" its meaning.
   *
   * The story feed is bounded to my contacts and people who saved me (see
   * getStatusAudienceIds for why it must stay bounded), so an "everyone" post by
   * someone I haven't saved would otherwise be authorized but undiscoverable.
   * This is the pull: I already have their number because I'm looking at their
   * profile.
   *
   * Not an enumeration oracle — `directory.lookup` already exposes name and
   * presence for any number, and this adds nothing for a contacts-only poster:
   * they return the same empty list as someone with no story at all.
   */
  forNumber: publicProcedure
    .input(z.object({ number: z.string().regex(/^\d{6}$/) }))
    .query(async ({ ctx, input }) => {
      const me = requireIdentity(ctx);
      statusGate(ctx);
      const owner = await getIdentityByNumber(input.number);
      if (!owner) return { items: [], hasUnseen: false };
      const rows = await getViewableStatusesOfOwner(me.id, owner.id);
      if (rows.length === 0) return { items: [], hasUnseen: false };
      const viewed = await getViewedStatusIds(me.id, rows.map((r) => r.id));
      return {
        items: rows.map((r) => publicStatus(r, owner.id === me.id)),
        hasUnseen: owner.id !== me.id && rows.some((r) => !viewed.has(r.id)),
      };
    }),

  /** Who saw my status (owner-only; empty for anyone else). */
  viewers: publicProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const me = requireIdentity(ctx);
      const st = await getActiveStatusById(input.id);
      if (!st || st.identityId !== me.id) return { viewers: [] };
      const ids = await getStatusViewerIds(input.id);
      const idents = ids.length ? await getIdentitiesByIds(ids) : [];
      const byId = new Map(idents.map((i) => [i.id, i]));
      return {
        viewers: ids.map((id) => {
          const i = byId.get(id);
          return {
            id,
            displayName: i?.displayName ?? "Someone",
            number: i?.number ?? "",
            avatarUrl: i?.avatarUrl ?? null,
          };
        }),
      };
    }),

  /**
   * Reply to somebody's status — as a PRIVATE MESSAGE to them (v2.99.80).
   *
   * Owner: *"When any user plays status, you can see his status ... you can make a
   * kind of emoji or put a reply. So it will reply to him on the private message on
   * the message showing that I replied on this status."*
   *
   * A one-tap emoji and a typed sentence are the SAME operation here, differing
   * only in the body — which is what the owner described ("a kind of emoji OR put a
   * reply", both arriving as a private message). A separate reaction counter on the
   * status would have been a second data model, a second notification path and a
   * second privacy question, for something the owner asked to land in the inbox.
   *
   * WHY THIS IS ITS OWN PROCEDURE RATHER THAN A NEW `messages.send` meta KEY.
   * The `statusReply` marker is what makes the recipient's bubble say "replied to
   * your status", so it is a CLAIM ABOUT PROVENANCE and must not be client-settable.
   * `messages.send`'s meta schema is a plain `z.object`, which STRIPS unknown keys
   * rather than rejecting them, and `sendMessage` casts meta through without
   * validating it — so exposing the key there would let any client stamp "replied
   * to your status <any id>" on any message, including a status it never had access
   * to. Stamping it here, server-side, is the same pattern `autoReply` and
   * `viaEmail` already use.
   *
   * NO COPY OF THE STATUS MEDIA IS STORED. A status is unreachable after 24h by
   * design (`authorizeStorageKey` resolves through `getActiveStatusByMediaKey`), so
   * a bubble holding a `mediaUrl` would render a broken image forever afterwards —
   * and keeping a durable copy would quietly break the ephemerality the whole
   * feature promises. The marker carries the KIND plus a short text excerpt, which
   * is enough for the bubble to read correctly for the rest of time, and only the
   * author and the replier ever see it.
   */
  reply: publicProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        /** The reply text, or a single emoji for a one-tap reaction. */
        body: z.string().min(1).max(2000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const me = requireIdentity(ctx);
      // Throttle BEFORE any DB work: each reply is a message row plus an unread
      // increment in someone else's inbox, so a loop is inbox spam.
      statusGate(ctx);
      const body = input.body.trim();
      if (!body) throw new TRPCError({ code: "BAD_REQUEST", message: "Reply can't be empty." });

      // Expired or missing are the SAME answer, deliberately. Distinguishing them
      // would make this an existence oracle over status ids — the reason
      // markViewed/forNumber answer uniformly. The viewer knows `expiresAt`
      // locally and disables the input, so a legitimate user is told why.
      const st = await getActiveStatusById(input.id);
      if (!st) return { ok: false as const, reason: "unavailable" as const };
      // Replying to your own status would silently post into your own Notes thread
      // (getOrCreateDmConversation(me, me) is a real, supported self-thread), which
      // is confusing rather than useful. The UI hides the band for your own story.
      if (st.identityId === me.id) return { ok: false as const, reason: "own" as const };
      // The audience verdict that let this person WATCH lived in a different
      // request and cannot be carried. Re-check it — and note this one call also
      // covers blocks in BOTH directions, ahead of the "everyone" short-circuit,
      // so a block outranks a public audience.
      if (
        !(await statusAudienceAuthorized(me.id, st.identityId, st.audience, st.conversationId))
      ) {
        return { ok: false as const, reason: "unavailable" as const };
      }

      /* A REPLY TO A GROUP STORY STILL GOES PRIVATELY TO ITS AUTHOR, and that is
       * a decision rather than an oversight. The story was written by a person;
       * replying to it is replying to them, and the band says "Reply privately".
       * Posting it into the group thread would be a different act — everyone
       * reads it — and would surprise somebody who believed they were answering
       * one person. If group-visible replies are wanted, that is a feature with
       * its own surface, not a silent change of blast radius here. */
      const convo = await getOrCreateDmConversation(me.id, st.identityId);
      // Excerpt, not media: the status's own text or caption, bounded. Kept so the
      // bubble still reads correctly once the status itself is gone.
      const excerpt = (st.text ?? "").trim().slice(0, 80) || undefined;
      const row = await sendMessage({
        conversationId: convo.id,
        senderIdentityId: me.id,
        kind: "text",
        body,
        attachmentId: null,
        replyToId: null,
        meta: { statusReply: { id: st.id, kind: st.kind, ...(excerpt ? { excerpt } : {}) } },
      });

      // Realtime + push reuse `kind:"message"` deliberately. A bespoke SSE kind
      // would be dropped by KNOWN_V2_EVENT_KINDS whenever the recipient's stream
      // landed on the other instance (the v2.99.74 trap), and the `relay-msg-<id>`
      // tag is what makes DND and per-conversation mute apply in the service
      // worker — a new kind would bypass both.
      for (const pid of [st.identityId, me.id]) {
        try {
          publishToIdentity(pid, { kind: "message", conversationId: convo.id, from: me.id });
        } catch {
          /* realtime is best-effort; the poll backstop covers it */
        }
      }
      try {
        const [pres] = await getPresenceForIds([st.identityId]);
        // Same shared rule as `messages.send` (v2.99.92): a backgrounded app cannot
        // draw an in-page toast, so idle needs the OS notification too.
        if (presenceNeedsNotification(pres) && (await pushReachable(st.identityId))) {
          // Content-free by the standing rule: the sender's name, never a word of
          // the reply. "Replied to your status" is a fact about the recipient's own
          // post and reveals nothing about what was said.
          sendPushToIdentity(st.identityId, {
            kind: "message",
            title: me.displayName || me.number,
            body: "Replied to your status — tap to read it.",
            tag: `relay-msg-${convo.id}`,
            url: `/app/messages?c=${convo.id}`,
          }).catch(() => {});
        }
      } catch {
        /* a presence hiccup must never fail the reply itself */
      }

      return { ok: true as const, conversationId: convo.id, messageId: row.id };
    }),
});

/* ── admin ────────────────────────────────────────────────────── */

/**
 * The administrator panel's API (v2.99.76).
 *
 * Owner: *"why you dont do it at the backend / Or create for me an admin panel
 * were i can change it"*.
 *
 * SCOPE IS DELIBERATELY NARROW. An admin panel is a permanent, high-value read and
 * write surface, so this one does exactly two things — find a person, and change
 * their number — and nothing else. It cannot read a message, list contacts, delete
 * an account, or grant itself more power. Widening it later is a decision somebody
 * has to make on purpose rather than something that arrived for free.
 *
 * EVERY procedure re-derives admin status from the `users` row via `isUserAdmin`.
 * `whoami` already returns a `role`, but that value has been through the browser
 * and is a rendering hint, never a permission.
 */
async function requireAdmin(ctx: { user?: { id: number } | null; identity: unknown }) {
  const me = requireIdentity(ctx);
  const userId = ctx.user?.id ?? null;
  if (!(await isUserAdmin(userId))) {
    // Same shape for "not signed in", "not an admin" and "DB unreadable", so the
    // endpoint is not an oracle for who holds the role.
    throw new TRPCError({ code: "FORBIDDEN", message: "Administrators only." });
  }
  return me;
}

export const v2AdminRouter = router({
  /** Whether the CALLER is an admin, resolved server-side. Lets the client decide
   *  whether to show the panel at all without trusting its cached whoami. */
  amIAdmin: publicProcedure.query(async ({ ctx }) => {
    const userId = (ctx.user?.id as number | undefined) ?? null;
    return { admin: await isUserAdmin(userId) };
  }),

  /* ── Content reports (v2.107.52) — Apple 1.2 review queue ──────────────────
     The read + action side of user reports. Reports are FILED by any signed-in
     user (identity.reportContent); reviewing and actioning them is admin-only,
     because a report names two people and quotes private content. */

  /** The review queue. Defaults to open reports, newest first; pass a status to
   *  see actioned/dismissed history. */
  listReports: publicProcedure
    .input(
      z.object({
        status: z.enum(["open", "actioned", "dismissed"]).nullish(),
        limit: z.number().int().min(1).max(200).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      await requireAdmin(ctx);
      return { rows: await listContentReports(input.status ?? "open", input.limit ?? 100) };
    }),

  /** The open-report count — for the admin badge, so a reviewer sees there is
   *  something waiting without opening the queue. */
  openReportCount: publicProcedure.query(async ({ ctx }) => {
    await requireAdmin(ctx);
    return { count: await openReportCount() };
  }),

  /** Move a report out of the open queue: 'actioned' (the developer acted on it)
   *  or 'dismissed' (reviewed, no action). Both are the closing act the 24h
   *  window is measured against. */
  resolveReport: publicProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        status: z.enum(["actioned", "dismissed"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const me = await requireAdmin(ctx);
      const ok = await setReportStatus(input.id, input.status);
      if (!ok) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "No report with that id, or it was already resolved.",
        });
      }
      console.warn(`[report] ${input.id} ${input.status} by admin ${me.id}`);
      return { ok: true as const };
    }),

  /* ── Crash console (v2.107.x) ──────────────────────────────────────────────
     The read side of crash telemetry. Reports arrive via the no-auth
     /api/crash ingest (that path must work when the app is broken); REVIEWING
     them is admin-only — a stack trace names files, ids and sometimes people.
     Four reads, one deliberately-manual purge. */

  /** Per-(appVersion, platform) rollup — the owner's "review several versions
   *  for each build": which builds crash, how much, and when they last did. */
  crashVersions: publicProcedure.query(async ({ ctx }) => {
    await requireAdmin(ctx);
    return { rows: await listCrashVersions() };
  }),

  /** Grouped by defect (fingerprint), newest activity first, filterable to one
   *  platform / one build / a recency window. */
  crashGroups: publicProcedure
    .input(
      z.object({
        platform: z.string().max(16).optional(),
        appVersion: z.string().max(32).optional(),
        days: z.number().int().min(1).max(3650).optional(),
        includeSolved: z.boolean().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      await requireAdmin(ctx);
      return { rows: await listCrashGroups(input) };
    }),

  /** Every stored occurrence of one defect — its per-version history. */
  crashOccurrences: publicProcedure
    .input(z.object({ fingerprint: z.string().length(40), limit: z.number().int().min(1).max(200).optional() }))
    .query(async ({ ctx, input }) => {
      await requireAdmin(ctx);
      return { rows: await listCrashOccurrences(input.fingerprint, input.limit ?? 50) };
    }),

  /** One full report — stack, breadcrumbs, device — for the diagnostics view. */
  crashDetail: publicProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      await requireAdmin(ctx);
      return { report: await getCrashReport(input.id) };
    }),

  /** SOLVED workflow (v2.107.23): mark a fingerprint fixed-in-a-version. The
   *  group leaves the default view and resurfaces only on a NEWER-version
   *  recurrence — a regression un-hides itself. */
  crashResolve: publicProcedure
    .input(
      z.object({
        fingerprint: z.string().length(40),
        solvedInVersion: z.string().min(1).max(32),
        note: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const me = await requireAdmin(ctx);
      await resolveCrash({
        fingerprint: input.fingerprint,
        solvedInVersion: input.solvedInVersion,
        note: input.note ?? null,
        who: String((me as { number?: unknown } | null)?.number ?? "").slice(0, 6) || null,
      });
      return { ok: true as const };
    }),

  crashUnsolve: publicProcedure
    .input(z.object({ fingerprint: z.string().length(40) }))
    .mutation(async ({ ctx, input }) => {
      await requireAdmin(ctx);
      await unresolveCrash(input.fingerprint);
      return { ok: true as const };
    }),

  /** Session journeys (v2.107.23) — every tap, nav, failure and lifecycle beat
   *  per session, with the open / closed / VANISHED verdict derived server-side. */
  sessionList: publicProcedure
    .input(
      z.object({
        days: z.number().int().min(1).max(3650).optional(),
        limit: z.number().int().min(1).max(200).optional(),
        platform: z.string().max(16).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      await requireAdmin(ctx);
      return { rows: await listSessions(input) };
    }),

  sessionDetail: publicProcedure
    .input(z.object({ sessionId: z.string().min(1).max(64) }))
    .query(async ({ ctx, input }) => {
      await requireAdmin(ctx);
      return { session: await getSessionLog(input.sessionId) };
    }),

  /** Call vitals (v2.107.23) — kilobytes up/down, round-trip, loss, duration,
   *  end reason and the clean/leaked verdict. Never a frame of media. */
  callList: publicProcedure
    .input(
      z.object({
        days: z.number().int().min(1).max(3650).optional(),
        limit: z.number().int().min(1).max(200).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      await requireAdmin(ctx);
      return { rows: await listCalls(input) };
    }),

  callDetail: publicProcedure
    .input(z.object({ callInstanceId: z.string().min(1).max(64) }))
    .query(async ({ ctx, input }) => {
      await requireAdmin(ctx);
      return { call: await getCallLog(input.callInstanceId) };
    }),

  /** Manual trim. NEVER scheduled — the standing default is keep-forever; this
   *  exists so the owner can shed ancient rows on his own decision only. */
  crashPurge: publicProcedure
    .input(z.object({ olderThanDays: z.number().int().min(7).max(3650) }))
    .mutation(async ({ ctx, input }) => {
      await requireAdmin(ctx);
      return { purged: await purgeCrashReports(input.olderThanDays) };
    }),


  /** Find people by 6-digit number, email, or name. Blank lists the newest. */
  findIdentities: publicProcedure
    .input(z.object({ query: z.string().max(120).optional() }))
    .query(async ({ ctx, input }) => {
      await requireAdmin(ctx);
      directoryGate(ctx);
      return { rows: await adminFindIdentities(input.query ?? "", 25) };
    }),

  /**
   * Change ANY identity's 6-digit number.
   *
   * Routes through `claimIdentityNumber`, which is the same single writer the
   * self-service path uses — so an admin change propagates to every contact who
   * saved the old number, inside the same transaction, and keeps all of that
   * person's messages, calls, threads and statuses exactly where they are. An admin
   * shortcut that wrote the column directly would silently skip all of it.
   */
  setIdentityNumber: publicProcedure
    .input(
      z.object({
        identityId: z.number().int().positive(),
        number: z.string().min(1).max(32),
        /**
         * Assign a number using a RESERVED prefix (000/111). Explicit, because the
         * default has to stay "no": the reservation keeps trivially-confused numbers
         * out of circulation, and only a deliberate administrative assignment may use
         * one. The random allocator still skips them unconditionally either way, and
         * self-service still refuses them outright, so nobody can ever be handed one
         * by accident or claim one for themselves.
         */
        allowReserved: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const me = await requireAdmin(ctx);
      // A NAMED function for the relaxed path, never a boolean threaded into the
      // shared one — the `deleteMessageAsGroupAdmin` rule (v2.104.0): a privilege
      // flag in that position is something a caller can pass by mistake.
      const res = input.allowReserved
        ? await claimIdentityNumberAsAdmin(input.identityId, input.number)
        : await claimIdentityNumber(input.identityId, input.number);
      if (!res.ok) {
        const map: Record<
          typeof res.reason,
          { code: "BAD_REQUEST" | "CONFLICT" | "NOT_FOUND" | "TOO_MANY_REQUESTS" | "INTERNAL_SERVER_ERROR"; message: string }
        > = {
          invalid: {
            code: "BAD_REQUEST",
            message: "Not a valid RELAY number — six digits, not starting 000 or 111.",
          },
          taken: { code: "CONFLICT", message: "That number is already in use." },
          budget: {
            code: "TOO_MANY_REQUESTS",
            message: "Too many numbers claimed just now — try again shortly.",
          },
          "not-found": { code: "NOT_FOUND", message: "No identity with that id." },
          unavailable: {
            code: "INTERNAL_SERVER_ERROR",
            message: "Couldn't change the number — nothing was changed.",
          },
        };
        const m = map[res.reason];
        throw new TRPCError({ code: m.code, message: m.message, cause: res.reason });
      }
      // An admin acting on somebody else's identity is worth a server-side trace.
      // Ids only: this line lands in logs, so it carries no name, email or content.
      console.warn(
        `[admin] identity ${input.identityId} renumbered ${res.oldNumber} -> ${res.newNumber} by identity ${me.id}`
      );
      return { ...res };
    }),

  /**
   * Promote or demote an account type (v2.99.99, owner request: *"I can delete the
   * user or change type of account from guest to registered to admin"*).
   *
   * This deliberately widens a surface v2.99.76 kept narrow on purpose, and that is
   * the owner's decision to make rather than something that arrived for free — so it
   * stays as narrow as the ask allows: it writes ONE enum column and can do nothing
   * else. It cannot read a message, cannot list contacts, and cannot reach any other
   * field of the account.
   *
   * Each refusal is NAMED, because the three of them need three different next steps:
   * a guest has to register (which keeps their number and data), a self-demotion has
   * to be done by another admin, and "become a guest" is not a thing an account can
   * do. A generic error would send the operator looking in the wrong place.
   */
  setAccountType: publicProcedure
    .input(
      z.object({
        identityId: z.number().int().positive(),
        role: z.enum(["admin", "registered", "guest"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const me = await requireAdmin(ctx);
      const res = await setIdentityAccountType(
        input.identityId,
        input.role,
        (ctx.user?.id as number | undefined) ?? null
      );
      if (!res.ok) {
        const map: Record<
          typeof res.reason,
          { code: "BAD_REQUEST" | "NOT_FOUND" | "CONFLICT" | "INTERNAL_SERVER_ERROR"; message: string }
        > = {
          "not-found": { code: "NOT_FOUND", message: "No identity with that id." },
          "no-account": {
            code: "BAD_REQUEST",
            message:
              "That's a guest — there's no account to attach a role to. They keep their number and all their data when they register themselves, so registering is the way up from here. Use “Suggest an email” to put a prompt in their app.",
          },
          self: {
            code: "CONFLICT",
            message:
              "You can't remove your own admin rights — that could leave this deployment with no administrator at all. Another admin has to do it.",
          },
          unsupported: {
            code: "BAD_REQUEST",
            message:
              "An account with an email and a password doesn't become a guest because a flag says so. Delete it instead if that's what you mean.",
          },
          unavailable: {
            code: "INTERNAL_SERVER_ERROR",
            message: "Couldn't change the account type — nothing was changed.",
          },
        };
        const m = map[res.reason];
        throw new TRPCError({ code: m.code, message: m.message, cause: res.reason });
      }
      // Ids only — this lands in logs, so it carries no name, email or content.
      console.warn(
        `[admin] identity ${input.identityId} (account ${res.userId}) set to ${res.role} by identity ${me.id}`
      );
      return { ok: true as const, role: res.role };
    }),

  /**
   * SUGGEST A REGISTRATION ADDRESS TO A GUEST (v2.105.15, task #111 — the owner
   * asked for guest → registered from the panel and said to build it SAFELY).
   *
   * THE FEATURE v2.99.99 DECLINED, AND THE REASON IT CAN SHIP NOW IS A NARROWING,
   * NOT A NEW GUARD. That release refused to promote a guest by supplying an email
   * because doing it directly is an ACCOUNT-TAKEOVER PRIMITIVE: an admin attaches
   * an address they control to somebody else's guest identity, then signs in as
   * them with an ordinary email code and owns their number, contacts and history.
   *
   * What makes that impossible here is where the claim's inputs come from.
   * `ensureUserIdentity` is the only writer that turns a guest identity into a
   * registered one, and its candidates are exclusively properties of the
   * REQUESTING BROWSER — the identity `createContext` resolved, the request's own
   * guest cookie, the request's own device id — each claimed under
   * `WHERE id = ? AND userId IS NULL`. No parameter names an identity. So this
   * procedure writes a SUGGESTION and the guest's own ordinary registration is
   * what completes it, from the device that actually holds that identity.
   *
   * SAID PLAINLY, because the boundary is worth being exact about: this does not
   * defeat an admin who talks a guest into tapping through and reads them the
   * code. Nothing can. But it grants such an admin NO capability they lacked —
   * they could already say "open Register and type this address" — whereas the
   * design v2.99.99 refused would have let them act entirely alone.
   *
   * Rate-limited like every other identity-resolving admin read, and the trace
   * carries ids only. The email is NOT logged: it is a third party's address.
   */
  inviteGuestRegistration: publicProcedure
    .input(
      z.object({
        identityId: z.number().int().positive(),
        email: z.string().min(3).max(320),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const me = await requireAdmin(ctx);
      directoryGate(ctx);
      const res = await inviteGuestRegistration(input.identityId, input.email);
      if (!res.ok) {
        const map: Record<
          typeof res.reason,
          { code: "BAD_REQUEST" | "NOT_FOUND" | "CONFLICT" | "INTERNAL_SERVER_ERROR"; message: string }
        > = {
          "not-found": { code: "NOT_FOUND", message: "No identity with that id." },
          "not-a-guest": {
            code: "BAD_REQUEST",
            message:
              "That identity already has an account, so there's nothing to invite it to. Change its role instead.",
          },
          "bad-email": {
            code: "BAD_REQUEST",
            message: "That doesn't look like an email address.",
          },
          // NAMED rather than folded into a generic failure: the operator needs to
          // know the address is spoken for, and refusing it is what stops one
          // address being bound to two different people's data.
          "email-taken": {
            code: "CONFLICT",
            message:
              "That address already belongs to an account. One address, one account — otherwise their sign-in code would land in somebody else's number and history.",
          },
          unavailable: {
            code: "INTERNAL_SERVER_ERROR",
            message: "Couldn't save the suggestion — nothing was changed.",
          },
        };
        const m = map[res.reason];
        throw new TRPCError({ code: m.code, message: m.message, cause: res.reason });
      }
      // Ids only. The suggested address is a third party's and stays out of logs.
      console.warn(
        `[admin] registration suggested for identity ${input.identityId} by identity ${me.id}`
      );
      return { ok: true as const };
    }),

  /** Withdraw a suggestion. Same authority as making one; clears both columns. */
  clearGuestRegistrationInvite: publicProcedure
    .input(z.object({ identityId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      await requireAdmin(ctx);
      await clearRegInvite(input.identityId);
      return { ok: true as const };
    }),

  /**
   * DELETE A PERSON COMPLETELY (v2.100.0, owner: *"if I click delete, it will
   * delete him completely. Whoever he took, whoever he had contact data,
   * everything will delete."*).
   *
   * The only irreversible action any RELAY surface can take, and it shares its
   * entire implementation with the automatic guest purge — one cascade, two
   * callers, because two copies of "everything" is how the two would come to mean
   * different things. What is and is not destroyed, and why a few things are
   * deliberately KEPT because deleting them would do active harm, is documented in
   * `server/purgeIdentity.ts`; the short version is that an `attachments` row is
   * what holds its media SHUT (v2.98.4/F3).
   *
   * A THIRD PARTY'S CONTACT ROW USED TO BE KEPT HERE TOO and no longer is
   * (v2.106.82) — that row carries `blocked`, so dropping it unblocks whoever had
   * blocked this person (v2.99.28/M13), which is true of a LIVE person and inert
   * once the number is tombstoned. Leaving it made "deleted completely" visibly
   * false: the deleted person stayed in everybody's address book.
   *
   * `TWO_STEP` confirmation is the CLIENT's job and this endpoint does not model
   * it, deliberately: a server-side confirm token would be a second thing to get
   * wrong and would not stop a determined caller, whereas an admin who reaches
   * this procedure has already re-derived as an admin on this very request.
   *
   * It REFUSES the caller's own identity, for the same reason a self-demotion is
   * refused — the one account nobody else can restore for you is your own, and an
   * admin deleting themselves can leave a deployment with no administrator.
   */
  deleteIdentity: publicProcedure
    .input(z.object({ identityId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const me = await requireAdmin(ctx);
      const res = await adminPurgeIdentity(input.identityId, me.id);
      if (!res.ok) {
        const map: Record<
          typeof res.reason,
          { code: "CONFLICT" | "NOT_FOUND" | "INTERNAL_SERVER_ERROR"; message: string }
        > = {
          "not-eligible": {
            code: "CONFLICT",
            message:
              "You can't delete your own account from here — that could leave this deployment with no administrator. Another admin has to do it.",
          },
          "not-found": {
            code: "NOT_FOUND",
            message: "No identity with that id, or it is already being deleted.",
          },
          unavailable: {
            code: "INTERNAL_SERVER_ERROR",
            message: "Couldn't complete the deletion. Some of it may have been applied.",
          },
        };
        const m = map[res.reason];
        throw new TRPCError({ code: m.code, message: m.message, cause: res.reason });
      }
      // Ids and the number only. The number is logged BECAUSE it is now tombstoned
      // and can never be reissued — that is the fact worth being able to look up.
      console.warn(
        `[admin] identity ${input.identityId} (${res.number ?? "no number"}, account: ${res.hadAccount}) DELETED by identity ${me.id}`
      );
      return { ok: true as const, hadAccount: res.hadAccount };
    }),


  /**
   * WHY A NOTIFICATION DID NOT ARRIVE (v2.99.91).
   *
   * Owner: *"Can you check the Firebase configuration as still the notification for
   * the front mobile apps for Android? It's not showing or it's not active."*
   *
   * A native push crosses FIVE links, and each one fails in a way that looks
   * identical from the phone — nothing happens:
   *   1. the shell posts a token into the WebView (external Expo app),
   *   2. `push.subscribe` stores it with a kind the server can route,
   *   3. the transport for that kind is configured on the fleet,
   *   4. the user has not turned push off,
   *   5. something actually SENDS for the event being tested.
   * Guessing which one is broken has already cost more than building this. It
   * reports each link separately, so a "not showing" becomes one named cause.
   *
   * READ-ONLY, and it never returns a token. An FCM registration token plus the
   * project key, or an Expo token on its own, is enough to push to that handset —
   * so the row is reported as kind + length + a short prefix, which is enough to
   * tell two devices apart and not enough to address either.
   */
  /**
   * WHICH MEDIA STACK THIS FLEET IS ACTUALLY USING (v2.105.22).
   *
   * Owner, while diagnosing *"slowness … when the voice and video started together"*:
   * make sure the media details are visible in the system.
   *
   * WHAT IT REPORTS NARROWED IN v2.106.53, and the reason is worth recording rather
   * than leaving the block looking half-finished: the hosted SFU whose project host
   * this used to name is gone, so every call runs the WebRTC mesh and there is no
   * project to identify. What remains is the half that still has an answer — the
   * relays, which is also what the v2.105.21 in-call readout points an operator at:
   * when a call reports "via TURN relay", the next question is immediately which
   * relays are advertised and whether TLS is among them.
   *
   * ADMIN-GATED RATHER THAN ADDED TO `/api/health`, and that placement is still the
   * decision even now that it is only relays. v2.105.20 deliberately made health
   * report booleans and never a URL; widening an UNAUTHENTICATED endpoint to
   * enumerate the fleet's relay hosts would undo that for the sake of a convenience.
   *
   * NEVER A CREDENTIAL. `iceServers()` returns LIVE short-lived TURN credentials, so
   * only the URL SHAPES are read back — echoing the minted username/credential would
   * hand an admin screen a working relay credential for no reason — and `TURN_SECRET`
   * is reported as a boolean without its value ever being touched.
   */
  mediaDiagnostics: publicProcedure.query(async ({ ctx }) => {
    await requireAdmin(ctx);
    /* The relay list EXACTLY as a client is told it, so this cannot drift from what
       calls actually use — the parity lesson of v2.99.71, where a checker and the
       server disagreed about which endpoints existed. A throwaway pin is passed
       because the signature requires one; only the URL strings are read back. */
    let urls: string[] = [];
    try {
      for (const s of iceServers("000000")) {
        const u = (s as { urls?: string | string[] }).urls;
        if (typeof u === "string") urls.push(u);
        else if (Array.isArray(u)) urls = urls.concat(u.filter((x) => typeof x === "string"));
      }
    } catch {
      urls = [];
    }
    return {
      /**
       * The transport every call uses. A literal rather than a read, because there
       * is nothing left to read: the mesh is what the ladder degrades to and the
       * only rung that needs no infrastructure to be true.
       */
      transport: "mesh" as const,
      /**
       * THE MEDIA-NODE POOL, per node — so saturation is observable BEFORE it bites.
       *
       * Behind `requireAdmin` and not on `/api/health`, which is unauthenticated: that one
       * gets counts, this one gets addresses and instance ids. Same line v2.105.22 drew
       * when it kept the SFU URL out of health — a node's public IP is not secret (a client
       * in a call is told it) but the fleet's media topology is not something an anonymous
       * caller needs.
       *
       * `reason` is what an operator should read first: it names WHICH stage of the funnel
       * emptied the pool, so "add a node" is distinguishable from "the agent is not
       * running", which are the same empty list and completely different jobs.
       */
      voipPool: (() => {
        const p = poolState();
        const now = Date.now();
        return {
          configured: p.configured,
          reason: p.reason,
          ageMs: p.ageMs,
          total: p.total,
          eligible: p.eligible.length,
          saturated: p.saturated,
          drainingCount: p.draining,
          /** Per node. No secret exists in a node record, so this is the whole thing. */
          nodes: p.live.map((n) => ({
            instanceId: n.instanceId,
            az: n.az,
            publicIp: n.publicIp,
            privateIp: n.privateIp,
            cores: n.cores,
            routers: n.routers,
            consumers: n.consumers,
            cpuLoad: Math.round(n.cpuLoad * 100) / 100,
            draining: n.draining === true,
            /* Freshness as the READER sees it, since that is what selection acts on — a
               record can be present and too old to believe, and an operator staring at a
               node that "is in the registry" needs to see that distinction. */
            ageMs: now - n.updatedAt,
          })),
        };
      })(),
      /** What clients are told about relays — url shapes only, never a credential. */
      turn: {
        stun: urls.filter((u) => u.startsWith("stun:")).length,
        turnUdp: urls.filter((u) => u.startsWith("turn:") && u.includes("transport=udp")).length,
        turnTcp: urls.filter((u) => u.startsWith("turn:") && u.includes("transport=tcp")).length,
        turnsTls: urls.filter((u) => u.startsWith("turns:")).length,
        hosts: Array.from(
          new Set(
            urls
              .filter((u) => u.startsWith("turn:") || u.startsWith("turns:"))
              .map((u) => {
                const m = /^turns?:([^:?]+)/.exec(u);
                return m ? m[1] : "";
              })
              .filter(Boolean),
          ),
        ),
        secretSet: !!process.env.TURN_SECRET,
      },
    };
  }),

  pushDiagnostics: publicProcedure
    .input(z.object({ identityId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      await requireAdmin(ctx);
      let rows: Array<{ endpoint: string; kind?: string | null }> = [];
      let dbOk = true;
      try {
        rows = await listPushSubscriptions(input.identityId);
      } catch {
        dbOk = false;
      }
      // Legacy rows predate the column and are Web Push by construction (v2.99.79).
      const kindOf = (k: string | null | undefined) => (k && k.length > 0 ? k : "webpush");
      const devices = rows.map((r) => ({
        kind: kindOf(r.kind),
        // What the SHAPE says the token is, which is what actually decides the
        // transport — a row whose stored kind and derived kind disagree is
        // unroutable, and that disagreement is invisible without printing both.
        derived: classifyNativeToken(r.endpoint) ?? (r.endpoint.startsWith("https://") ? "webpush" : "unknown"),
        length: r.endpoint.length,
        prefix: r.endpoint.slice(0, 12),
      }));
      return {
        dbOk,
        pushEnabled: await pushEnabledForIdentity(input.identityId),
        devices,
        /** Which transports THIS fleet can use right now — read from the running
         *  process, which is stronger evidence than reading an env file. */
        transports: {
          // Expo needs no server credential for ordinary sends; the FCM server key
          // and APNs key live in EAS, not here. So an Expo token is deliverable as
          // soon as it is stored — which is why "configured" is not the same
          // question as "will it arrive".
          expo: true,
          expoAccessToken: !!process.env.EXPO_ACCESS_TOKEN,
          fcm: !!fcmConfig(),
          webpush: !!vapidConfig(),
          // APNs VoIP (v2.105.12) — the only transport that makes a LOCKED iPhone
          // show the real full-screen call screen. Reported separately because an
          // iOS device holding an `apns` token on a fleet with no credential is
          // precisely the case that stores a token nothing can deliver to, and it
          // is invisible otherwise.
          apnsVoip: apnsVoipConfigured(),
          /** "token" (.p8) or "cert" (VoIP Services certificate), or null. */
          apnsVoipMode: apnsVoipConfig()?.mode ?? null,
          /**
           * When a CERTIFICATE credential stops working (v2.105.14). Null for .p8,
           * which never expires. This is the one credential here that dies on a
           * date rather than because of a change — ringing would stop one morning
           * with nothing in the diff to blame — so the operator gets to see it
           * coming instead of finding out from a user.
           */
          apnsVoipExpiresAt: apnsCredentialExpiry()?.toISOString() ?? null,
        },
        /**
         * The kinds that any code path actually sends. Hard-coded on purpose: it is
         * a statement about the codebase, not a runtime probe, and it is the answer
         * to the most likely form of the owner's report — testing by CALLING a
         * closed app and seeing what happens. `incoming-call` was removed in
         * v2.99.11 at the owner's own request and RESTORED in v2.105.12 at their
         * request, so a closed app rings again. A test cross-checks this list
         * against every real call site's `kind`, because a list that drifts from
         * reality is worse than none — it sends an operator looking in the wrong
         * place.
         */
        sendsFor: ["incoming-call", "message", "missed-call", "voicemail", "contact-online"],
        /**
         * True once a ring is genuinely pushed. A ring only reaches a LOCKED
         * iPhone's real call screen over APNs VoIP, which is why `apns` is
         * reported beside the other transports: an iOS device that registered an
         * APNs token and a fleet with no .p8 key is the one combination that
         * stores a token it cannot deliver to.
         */
        ringPushed: true,
      };
    }),

  /**
   * Send a REAL push to one identity, through the REAL sender.
   *
   * `sendPushToIdentity` is called directly rather than reimplemented, so this
   * proves the actual production path — including the master push switch, the
   * per-kind transport routing and the dead-token pruning. A parallel test sender
   * would be able to pass while the real one was broken, which is worse than
   * having no test at all.
   *
   * The body is content-free and says it is a test: it lands on somebody else's
   * lock screen.
   */
  sendTestPush: publicProcedure
    .input(z.object({ identityId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const me = await requireAdmin(ctx);
      // Rate-limited even for an admin: this writes to a third party's device, and
      // a stuck retry loop in the panel must not become a notification flood.
      directoryGate(ctx);
      const delivered = await sendPushToIdentity(input.identityId, {
        kind: "message",
        title: "RELAY test notification",
        body: "If you can see this, notifications are working on this device.",
        tag: `relay-test-${input.identityId}`,
        url: "/app",
      });
      // Ids only — this lands in logs.
      console.warn(`[admin] test push to identity ${input.identityId} by identity ${me.id}: ${delivered} device(s)`);
      return { delivered };
    }),
});
