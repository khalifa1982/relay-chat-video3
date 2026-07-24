/* ============================================================
   v2.0 tRPC routers — the API surface for the phone-app shell.

   Every router exported here is namespaced under appRouter as a
   sibling of `auth` and `system`. See server/routers.ts for the
   final composition.
   ============================================================ */

import { TRPCError } from "@trpc/server";
import { s3Config } from "./s3";
import { storageGetSignedUrl } from "./storage";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, getUserById } from "./db";
import { identities } from "../drizzle/schema";
import { router, publicProcedure } from "./_core/trpc";
import { GUEST_COOKIE } from "./_core/context";
import { getSessionCookieOptions } from "./_core/cookies";
import {
  bindDeviceIdToIdentity,
  createGuestIdentity,
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
  recordStatusView,
  getViewedStatusIds,
  getStatusViewerIds,
  getStatusViewCounts,
  getContactNumbersForOwner,
  getIdentityIdsWhoSaved,
  statusAudienceAuthorized,
  countActiveStatuses,
  ownersWhoBlockedNumber,
  getStatusAudienceIds,
  type StatusRow,
  getIdentityByDeviceId,
  getIdentityById,
  getIdentityByNumber,
  getOrCreateDmConversation,
  dmConversationExists,
  createGroupConversation,
  deleteMessage,
  consumeExpiringMessage,
  revealExpiringMessage,
  getPresenceAudienceIds,
  getPresenceForIds,
  isGuestPresenceHidden,
  listCallHistory,
  listConferenceHistory,
  getHistoryClearedAt,
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
  recordAttachment,
  recordCallStart,
  sendMessage,
  touchGuestExpiry,
  updateIdentityProfile,
  regenerateIdentityNumber,
  upsertContact,
  getConversationParticipantIds,
  recentAutoReplyExists,
  getPublicStats,
  upsertPushSubscription,
  deleteOwnPushSubscription,
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

} from "./v2db";
import { sendEmail, emailEnabled, wrapEmailDocument } from "./email";
import { appBaseUrl } from "./appUrl";
import { unsubscribeHeaders, unsubscribeLink } from "./unsubscribe";
import { vapidConfig, sendPushToIdentity, isAllowedWebPushEndpoint } from "./webPush";
import { publishToIdentity, publishPresenceTo } from "./v2events";
import { ensureUserIdentity, markIdentityVerified, getIdentityByUserId } from "./v2db";
import { recordSession, listSessionsForUser, revokeSession } from "./v2db";
import { getRolesByIdentityIds, type IdentityRole } from "./v2db";
import { hasRecentApprovedSession, pendingSessionsForUser, sessionApprovalBySid, approveSession } from "./v2db";
import { setSessionCookie, rememberToTtlMs, LOCAL_SESSION_COOKIE, newSessionId, readLocalSession } from "./authLocal";
import { deviceLabelFromUA } from "./deviceLabel";
import { COOKIE_NAME } from "@shared/const";
import { normalizeEmail, isValidEmail } from "./authCrypto";
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
import { pinsInCallAsync, partyLineLiveCountsAsync, liveRoomFor } from "./relay";

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
  if (!presence || presence.isOnline) return null;
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
  } | null;
  if (!id) throw new TRPCError({ code: "UNAUTHORIZED", message: "No identity" });
  return id;
}

/**
 * Hard ceiling on bytes inlined into a `revealExpiring` response. Kept at the
 * original 30MB so no legitimate view-once clip regresses (a 60s video note is
 * ≈20MB), but now enforced against the STREAM rather than a trusted
 * `content-length` header — see the bounded read loop in `revealExpiring`.
 */
const REVEAL_MAX_INLINE_BYTES = 30 * 1024 * 1024;

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
 * place — the "Enter as guest" form submit — so one new visitor costs one token
 * and returning visitors cost nothing. 60 burst then ~1 every 5s therefore
 * absorbs a whole room of people signing up together on one shared address (a
 * demo, a classroom, a conference, an office behind CGNAT), which is a realistic
 * scenario for this app and one where the failure mode would be a hard
 * TOO_MANY_REQUESTS on the only screen that gets a person into the product.
 *
 * It still bounds scripted abuse to roughly 17k numbers/day from a single host —
 * ~57 days to walk the space rather than an afternoon. A determined attacker with
 * several addresses is not stopped by a per-IP bucket alone; that would need a
 * global budget, which is noted as a follow-up rather than pretended here.
 * Honors RELAY_RATELIMIT_OFF like every other gate.
 */
const guestMintIpLimiter = createRateLimiter({ capacity: 60, refillPerSec: 0.2 });
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
    // Three-tier badge (v2.99.6): guest / registered / admin.
    const role: IdentityRole =
      (await getRolesByIdentityIds([ctx.identity.id])).get(ctx.identity.id) ??
      (ctx.identity.verified ? "registered" : "guest");
    return {
      id: ctx.identity.id,
      number: ctx.identity.number,
      displayName: ctx.identity.displayName,
      avatarUrl: ctx.identity.avatarUrl,
      isGuest: ctx.identity.isGuest,
      guestExpiresAt: ctx.identity.guestExpiresAt,
      email,
      bio: ctx.identity.bio,
      statusOverride: (ctx.identity.statusOverride as "" | "away" | "travel" | null) ?? "",
      mobiles: ctx.identity.mobiles,
      socials: ctx.identity.socials,
      verified: ctx.identity.verified,
      role,
      firstName: ctx.identity.firstName,
      lastName: ctx.identity.lastName,
    };
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
      const { identity, guestToken } = await createGuestIdentity({
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
   * Update display name or avatar URL on the current identity.
   */
  updateProfile: publicProcedure
    .input(
      z.object({
        displayName: DisplayNameSchema.optional(),
        avatarUrl: AvatarUrlSchema.nullable().optional(),
        bio: z.string().max(500).nullable().optional(),
        statusOverride: z.enum(["", "away", "travel"]).optional(),
        mobiles: z.array(z.string().max(32)).max(20).optional(),
        socials: z
          .array(z.object({ platform: z.string().max(20), value: z.string().max(200) }))
          .max(20)
          .optional(),
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
      await updateIdentityProfile(me.id, input);
      const fresh = await getIdentityById(me.id);
      return fresh;
    }),

  /**
   * Regenerate the caller's 6-digit number and AUTO-PROPAGATE it to every
   * contact that saved the old number, so their contacts keep reaching them
   * without re-adding. The relay engine adopts the new number on the client's
   * next whoami (see RelayEngine's setPreferredPin reconcile).
   */
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
function directoryGate(ctx: { req: unknown }) {
  if (process.env.RELAY_RATELIMIT_OFF === "1") return;
  if (!directoryIpLimiter.allow(clientIpOf(ctx.req as Parameters<typeof clientIpOf>[0]), Date.now())) {
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
          presenceHidden: false,
          verified: false,
          role: null as IdentityRole | null, // a line is not a person — no badge
          inCall: false,
          partyLine: true,
          memberCount,
        };
      }
      const id = await getIdentityByNumber(input.number);
      if (!id) return null;
      const [pres] = await getPresenceForIds([id.id]);
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
        lastSeenAt: hidden ? null : (pres?.lastSeenAt ?? null),
        statusOverride: hidden ? "" : ((id.statusOverride as "" | "away" | "travel" | null) ?? ""),
        presenceHidden: hidden,
        verified: id.verified,
        // Three-tier badge (v2.99.6): guest / registered / admin.
        role: ((await getRolesByIdentityIds([id.id])).get(id.id) ??
          (id.verified ? "registered" : "guest")) as IdentityRole | null,
        // Carrier-style busy line (v2.88): they're ON A CALL right now.
        inCall: hidden ? false : (await pinsInCallAsync([id.number])).has(id.number),
        partyLine: false,
        memberCount: 0,
      };
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
   * Resolve the caller's request IP to a country (ISO 3166-1 alpha-2)
   * and a flag emoji using a free public geo service (`ipapi.co`).
   * Cached in-process for 12h per IP. Returns nulls on failure or
   * for private/loopback addresses — the UI gracefully omits the
   * flag chip when null.
   */
  geoSelf: publicProcedure.query(async ({ ctx }) => {
    const empty: GeoSelfResult = {
      ip: null,
      country: null,
      countryName: null,
      city: null,
      flagEmoji: null,
    };
    const ip = pickClientIp(ctx.req);
    if (!ip) return empty;
    if (isPrivateOrLocalIp(ip)) return { ...empty, ip };

    const cached = geoCache.get(ip);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 4000);
      const res = await fetch(
        `https://ipapi.co/${encodeURIComponent(ip)}/json/`,
        {
          signal: ctrl.signal,
          headers: { "User-Agent": "relay-chat-video/2.0" },
        }
      );
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
      geoCache.set(ip, {
        value: out,
        expiresAt: Date.now() + GEO_CACHE_TTL_MS,
      });
      return out;
    } catch {
      return { ...empty, ip };
    }
  }),

  /** Get presence for an array of identity ids. */
  presence: publicProcedure
    .input(z.object({ ids: z.array(z.number().int().positive()).max(200) }))
    .query(async ({ input, ctx }) => {
      // SECURITY (S3): throttle (this was an anonymous, unthrottled enumeration
      // of the sequential id space) and apply the SAME guest-privacy rule the
      // other directory surfaces use — a guest inactive >24h must not leak
      // presence / last-seen here when they're hidden everywhere else.
      directoryGate(ctx);
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
        return hidden ? { ...p, isOnline: false, lastSeenAt: null } : p;
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
      directoryGate(ctx);
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
    return { ok: true, at: new Date() };
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
    const idents = await getIdentitiesByNumbers(rows.map((r) => r.number));
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
    const ids = idents.map((i) => i.id);
    const presList = await getPresenceForIds(ids);
    const presByIdentity = new Map(presList.map((p) => [p.identityId, p]));
    // Busy line (v2.88): which saved numbers are on a call right now.
    const inCallSet = await pinsInCallAsync(idents.map((i) => i.number));
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
        blocked: r.blocked === true,
        identityId: ident ?? null,
        isOnline: hidden ? false : (pres?.isOnline ?? false),
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
        /** Contact group for the categorized list (v2.82). */
        category: z.enum(["vip", "family", "friend", "team"]).nullable().optional(),
        /** Block this number: their calls auto-decline, their 1:1 messages are rejected. */
        blocked: z.boolean().optional(),
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
      const row = await upsertContact({ ownerId: me.id, ...input });
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
    return base.map((b) => {
      const p = byId.get(b.otherIdentityId);
      return {
        conversationId: b.conversationId,
        kind: b.kind,
        title: b.title,
        memberCount: b.memberCount,
        peerIdentityId: b.otherIdentityId,
        peerNumber: b.otherNumber,
        peerDisplayName: b.otherDisplayName,
        peerAvatarUrl: b.otherAvatarUrl,
        peerIsOnline: p?.isOnline ?? false,
        peerLastSeenAt: p?.lastSeenAt ?? null,
        peerVerified: verifiedById.get(b.otherIdentityId) ?? false,
        peerRole: (rolesById.get(b.otherIdentityId) ?? "guest") as IdentityRole,
        lastMessageAt: b.lastMessageAt,
        lastMessageBody: b.lastMessagePreview,
        lastMessageKind: b.lastMessageKind,
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
  createGroup: publicProcedure
    .input(
      z.object({
        title: z.string().trim().min(1).max(128),
        numbers: z.array(NumberSchema).min(1).max(19), // + creator = 20 cap
      })
    )
    .mutation(async ({ ctx, input }) => {
      // SECURITY: same enumeration class as openThread — the `skipped` count
      // and BAD_REQUEST reveal which supplied numbers are real users, and
      // success force-creates a group thread in every resolved member's inbox.
      // Gate it on the shared per-IP directory bucket (honors RELAY_RATELIMIT_OFF).
      directoryGate(ctx);
      const me = requireIdentity(ctx);
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
        title: input.title,
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
  conversationInfo: publicProcedure
    .input(z.object({ conversationId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const me = requireIdentity(ctx);
      const memberIds = await getConversationParticipantIds(input.conversationId);
      if (!memberIds.includes(me.id)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Not a member of this conversation." });
      }
      const idents = await getIdentitiesByIds(memberIds);
      return {
        conversationId: input.conversationId,
        members: idents.map((i) => ({
          id: i.id,
          number: i.number,
          displayName: i.displayName,
          avatarUrl: i.avatarUrl ?? null,
          isMe: i.id === me.id,
        })),
      };
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
          editedAt: r.editedAt,
          attachment: locked ? null : r.attachmentId ? (attById.get(r.attachmentId) ?? null) : null,
          replyToId: r.replyToId ?? null,
          locked,
        };
      });
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
      return rows.map((r) => ({
        id: r.id,
        conversationId: r.conversationId,
        senderIdentityId: r.senderIdentityId,
        kind: r.kind,
        body: r.body,
        createdAt: r.createdAt,
        attachment: r.attachmentId ? (attById.get(r.attachmentId) ?? null) : null,
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
      if (!trimmedBody && !input.attachmentId) {
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
        kind: input.kind,
        body: trimmedBody,
        attachmentId: input.attachmentId ?? null,
        replyToId: input.replyToId ?? null,
        meta: input.meta ?? null,
      });
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
      // Content-free by the same rule as the email (owner: "WITHOUT the
      // content") — the sender's name, never a word of the message. One tag per
      // conversation, so ten messages replace each other instead of stacking
      // ten notifications. `sendPushToIdentity` already no-ops when the user
      // turned push off or has no subscription, so this needs no gate of its
      // own; everything is best-effort and never affects the delivered message.
      let offlinePeerIds: number[] = [];
      const presenceById = new Map<number, PresenceLite>();
      try {
        if (peerIds.length > 0) {
          const presences = await getPresenceForIds(peerIds);
          for (const p of presences) presenceById.set(p.identityId, p);
          offlinePeerIds = peerIds.filter((pid) => !presenceById.get(pid)?.isOnline);
          // A voicemail already pushed its own, better-worded notification.
          if (!input.meta?.voicemail) {
            const from = me.displayName || me.number;
            for (const pid of offlinePeerIds) {
              sendPushToIdentity(pid, {
                kind: "message",
                title: from,
                body: "Sent you a message — tap to read it.",
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
      // party is offline and hasn't auto-replied in the last 10 min, post a
      // one-time auto-reply FROM them so the sender knows they'll reply later.
      try {
        if (peerIds.length === 1) {
          const peerId = peerIds[0];
          const [pres] = await getPresenceForIds([peerId]);
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
        for (const pid of participants) {
          if (pid !== me.id) {
            publishToIdentity(pid, {
              kind: "typing",
              conversationId: input.conversationId,
              from: me.id,
            });
          }
        }
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
      const res = await revealExpiringMessage({ messageId: input.messageId, identityId: me.id });
      if (!res) return { ok: false as const };
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
            const mime = att.mimeType || "application/octet-stream";
            media = { dataUrl: `data:${mime};base64,${buf.toString("base64")}`, mimeType: mime };
          }
        } catch {
          /* best-effort — the reader still gets the text body / a burned card */
        }
      }
      return { ok: true as const, body: res.body, media };
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

export const v2CallsRouter = router({
  history: publicProcedure.query(async ({ ctx }) => {
    const me = requireIdentity(ctx);
    const clearedAt = await getHistoryClearedAt(me.id);
    const rows = await listCallHistory(me.id, 100, clearedAt);
    // join the "other" identity for each row for friendly display
    const otherIds = Array.from(
      new Set(
        rows.map((r) => (r.callerIdentityId === me.id ? r.calleeIdentityId : r.callerIdentityId))
      )
    );
    // Resolve the "other" identity for every row in ONE query. (This replaced a
    // dead single-row query plus an N+1 loop.)
    const otherById = new Map((await getIdentitiesByIds(otherIds)).map((o) => [o.id, o]));
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
            }
          : null,
      };
    });
  }),

  /** Multi-party CONFERENCE history — every answered call (2..10 parties) this
   *  identity took part in, with the full roster (name + PIN) and duration. */
  conferenceHistory: publicProcedure.query(async ({ ctx }) => {
    const me = requireIdentity(ctx);
    const clearedAt = await getHistoryClearedAt(me.id);
    const rows = await listConferenceHistory(me.id, 100, clearedAt);
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
    // Live profile photos for every participant (v2.96) in ONE batched query —
    // the roster snapshot has only number+name.
    const allNumbers = Array.from(
      new Set(
        rows.flatMap((r) =>
          Array.isArray(r.participants)
            ? (r.participants as Array<{ number?: string }>).map((p) => p.number ?? "").filter(Boolean)
            : []
        )
      )
    );
    const avatarByNumber = new Map(
      (allNumbers.length ? await getIdentitiesByNumbers(allNumbers) : []).map((i) => [
        i.number,
        i.avatarUrl ?? null,
      ])
    );
    return rows.map((r) => {
      const roster = Array.isArray(r.participants)
        ? (r.participants as Array<{ number?: string; name?: string; identityId?: number | null }>)
        : [];
      const isPartyLine = (r.roomId ?? "").startsWith("pl-");
      return {
        id: r.id,
        roomId: r.roomId,
        dialedNumber: r.dialedNumber,
        partyCount: r.partyCount,
        startedAt: r.startedAt,
        endedAt: r.endedAt,
        durationSec: r.durationSec,
        partyLine: isPartyLine,
        // Null when the line has since been deleted (row keeps its number).
        partyLineTitle: isPartyLine ? (titleByNumber.get(r.dialedNumber ?? "") ?? null) : null,
        // Surface everyone EXCEPT me first-class; keep the full list too.
        participants: roster.map((p) => ({
          number: p.number ?? "",
          name: p.name ?? "Guest",
          avatarUrl: p.number ? (avatarByNumber.get(p.number) ?? null) : null,
          isSelf: p.identityId === me.id,
        })),
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

const otpIpLimiter = createRateLimiter({ capacity: 30, refillPerSec: 30 / 60 });
setInterval(() => otpIpLimiter.sweep(Date.now(), 30 * 60_000), 30 * 60_000).unref();
function otpGate(ctx: { req: unknown }) {
  if (process.env.RELAY_RATELIMIT_OFF === "1") return;
  if (!otpIpLimiter.allow(clientIpOf(ctx.req as Parameters<typeof clientIpOf>[0]), Date.now())) {
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many attempts. Try again shortly." });
  }
}
async function cooldownOk(email: string) {
  const last = await lastOtpAt(email);
  return !last || Date.now() - last >= OTP_RESEND_COOLDOWN_MS;
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
): Promise<string> {
  const sid = newSessionId();
  const label = deviceLabelFromUA(ctx.req?.headers?.["user-agent"]);
  await recordSession(sid, userId, label, pending);
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
    .input(z.object({ firstName: NameSchema, lastName: NameSchema, email: EmailSchema }))
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
      await consumeOtp(row.id);
      // Resolve or create the user account (register rows carry the name).
      let userId = (await findUserByEmailAny(email))?.id ?? null;
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
      // Upgrade the guest identity in place (preserves number/contacts/messages).
      const guestToken = (ctx.req.cookies?.[GUEST_COOKIE] as string | undefined) ?? null;
      const displayName =
        `${row.firstName ?? ""} ${row.lastName ?? ""}`.trim() || email.split("@")[0];
      const identity = await ensureUserIdentity({ userId, displayName, guestToken });
      await markIdentityVerified(identity.id, { firstName: row.firstName, lastName: row.lastName });
      // New-device approval (v2.99.7): an email-code sign-in on an account that
      // already has another ONLINE device waits for that device to approve it,
      // UNLESS this is a brand-new registration (`row.firstName` present means
      // the OTP was minted by register → first device, nothing to approve
      // against). PIN login is the explicit bypass and never lands here.
      const wasRegistration = !!(row.firstName || row.lastName);
      const pending = !wasRegistration && (await shouldRequireApproval(userId));
      const sid = await startSession(ctx, userId, pending);
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
      if (!user) return { unregistered: true, hasPin: false, locked: false, preferPin: false };
      const u = user as typeof user & {
        loginPinHash?: string | null; loginPinLockedAt?: Date | null; preferPinLogin?: boolean | null;
      };
      return {
        unregistered: false,
        hasPin: Boolean(u.loginPinHash),
        locked: Boolean(u.loginPinLockedAt),
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
          await ensureUserIdentity({ userId: user.id, displayName: user.name ?? email.split("@")[0], guestToken });
          setSessionCookie(ctx.res, user.id, rememberToTtlMs(input.remember), await startSession(ctx, user.id));
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
      loginPinHash?: string | null; loginPinLockedAt?: Date | null; preferPinLogin?: boolean | null;
    }) | null;
    if (!user) return { signedIn: false, hasPin: false, locked: false, preferPin: false };
    return {
      signedIn: true,
      hasPin: Boolean(user.loginPinHash),
      locked: Boolean(user.loginPinLockedAt),
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
    if (!user) return { signedIn: false, sessions: [] as Array<{
      sid: string; label: string; createdAt: number; lastSeenAt: number; current: boolean;
    }> };
    const rows = await listSessionsForUser(user.id);
    return {
      signedIn: true,
      sessions: rows.map((r) => ({
        sid: r.sid,
        label: r.label || "Unknown device",
        createdAt: new Date(r.createdAt).getTime(),
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
    if (!user) return { signedIn: false, pending: [] as Array<{ sid: string; label: string; createdAt: number }> };
    const rows = await pendingSessionsForUser(user.id);
    return {
      signedIn: true,
      pending: rows.map((r) => ({
        sid: r.sid,
        label: r.label || "Unknown device",
        createdAt: new Date(r.createdAt).getTime(),
      })),
    };
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
          kind: z.enum(["webpush", "fcm"]).optional(),
        })
        .refine(v => (v.kind ?? "webpush") === "fcm" || !!v.keys, {
          message: "keys are required for webpush subscriptions",
        })
    )
    .mutation(async ({ ctx, input }) => {
      const me = requireIdentity(ctx);
      const kind = input.kind ?? "webpush";
      // SECURITY (S8): a webpush endpoint is a URL the server later connects to;
      // reject anything that isn't https on a known push service so it can't be
      // used as a stored blind-SSRF primitive. FCM tokens aren't URLs.
      if (kind === "webpush" && !isAllowedWebPushEndpoint(input.endpoint)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Unsupported push endpoint." });
      }
      await upsertPushSubscription({
        identityId: me.id,
        endpoint: input.endpoint,
        p256dh: kind === "fcm" ? "fcm" : input.keys!.p256dh,
        auth: kind === "fcm" ? "fcm" : input.keys!.auth,
        kind,
      });
      return { ok: true };
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
        const row = await createPartyLine({ ownerIdentityId: me.id, title: input.title });
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

function publicStatus(r: StatusRow) {
  return {
    id: r.id,
    kind: r.kind,
    text: r.text,
    bgColor: r.bgColor,
    mediaUrl: r.mediaUrl,
    mimeType: r.mimeType,
    durationMs: r.durationMs,
    createdAt: r.createdAt,
    expiresAt: r.expiresAt,
  };
}

/** Fan a realtime "status" SSE event out to everyone whose feed includes
 *  `ownerId` (v2.96). Fire-and-forget from post/remove — never blocks the
 *  mutation result on the audience query. */
async function publishStatusEvent(
  ownerId: number,
  ownerNumber: string,
  ownerName: string,
  removed?: boolean,
): Promise<void> {
  const audience = await getStatusAudienceIds(ownerId, ownerNumber);
  for (const id of audience) {
    publishToIdentity(id, {
      kind: "status",
      number: ownerNumber,
      name: ownerName,
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
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const me = requireIdentity(ctx);
      statusGate(ctx);
      const text = (input.text ?? "").trim();
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
      // Per-user cap so posting isn't an unbounded DB/storage cost vector.
      if ((await countActiveStatuses(me.id)) >= STATUS_MAX_ACTIVE) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: `You can have up to ${STATUS_MAX_ACTIVE} active statuses.` });
      }
      const mediaUrl = mediaKey ? `/manus-storage/${mediaKey}` : null;
      const row = await insertStatus({
        identityId: me.id,
        kind: input.kind,
        text: text || null,
        // Author-controlled bg is restricted to safe color/gradient tokens.
        bgColor: sanitizeStatusBg(input.bgColor),
        mediaKey,
        mediaUrl,
        mimeType: input.mimeType ?? null,
        durationMs: input.durationMs ?? null,
        ttlMs: STATUS_TTL_MS,
      });
      if (!row) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Couldn't post your status." });
      // Realtime (v2.96): tell everyone whose feed includes me — instantly —
      // so their rings/feed refresh and Messages can show a quiet toast.
      publishStatusEvent(me.id, me.number, me.displayName).catch(() => {});
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
    const ownerIds = candidateIds.filter((id) => id === me.id || !blockedMe.has(id));
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
    const groups = Array.from(byOwner.entries()).map(([oid, items]) => {
      const o = ownerById.get(oid);
      const latest = items[items.length - 1];
      return {
        owner: {
          id: oid,
          number: o?.number ?? "",
          displayName: o?.displayName ?? "Someone",
          avatarUrl: o?.avatarUrl ?? null,
          isMe: oid === me.id,
        },
        items: items.map(publicStatus),
        hasUnseen: oid !== me.id && items.some((it) => !viewed.has(it.id)),
        latestAt: latest.createdAt,
      };
    });
    // Order: me first, then owners with unseen updates, then most-recent.
    groups.sort((a, b) => {
      if (a.owner.isMe !== b.owner.isMe) return a.owner.isMe ? -1 : 1;
      if (a.hasUnseen !== b.hasUnseen) return a.hasUnseen ? -1 : 1;
      return new Date(b.latestAt).getTime() - new Date(a.latestAt).getTime();
    });
    return { groups };
  }),

  /** My own active statuses with a "seen by N" count each. */
  mine: publicProcedure.query(async ({ ctx }) => {
    const me = requireIdentity(ctx);
    const rows = await getActiveStatusesForOwners([me.id]);
    const counts = await getStatusViewCounts(rows.map((r) => r.id));
    return { items: rows.map((r) => ({ ...publicStatus(r), viewCount: counts.get(r.id) ?? 0 })) };
  }),

  /** Delete one of my statuses. */
  remove: publicProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const me = requireIdentity(ctx);
      const ok = await deleteStatus(input.id, me.id);
      // Removal fans out too (no toast client-side) so stale rings clear.
      if (ok) publishStatusEvent(me.id, me.number, me.displayName, true).catch(() => {});
      return { ok };
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
      if (!(await statusAudienceAuthorized(me.id, st.identityId))) return { ok: false };
      await recordStatusView(input.id, me.id);
      return { ok: true };
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
});
