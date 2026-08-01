import "dotenv/config";
import express from "express";
import type { Request, Response } from "express";
import cookieParser from "cookie-parser";
import { APP_VERSION } from "@shared/version";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic } from "./static";
import { attachRelay } from "../relay";
import { registerV2Upload, uploadRateGate } from "../v2upload";
import { registerV2Events, publishToIdentity, publishPresenceTo } from "../v2events";
import { registerV2Offline } from "../v2offline";
import { registerStatsFeed } from "../statsFeed";
import { getIdentityByNumber, getPartyLineByNumber, reapStalePresence, reapExpiredStatuses, reapStaleSessions, reapUnclaimedReservations, recordMissedCall, recordConferenceEnd, ensureSchemaExtensions, getOrCreateDmConversation, isNumberBlockedBy, getPresenceAudienceIds,
  claimMissedCallEmail,
  releaseMissedCallEmailClaim,
  MISSED_CALL_EMAIL_COOLDOWN_MS,
  // v2.105.18: the call path becomes the fourth reader of the v2.99.92 idle rule,
  // so a MINIMISED app is rung at the OS level rather than only over SSE.
  getPresenceForIds,
  presenceNeedsNotification,
} from "../v2db";
import { reapExpiredGuests } from "../purgeIdentity";
import { sendPushToIdentity } from "../webPush";
import { registerWellKnown } from "../wellKnown";
import { registerSeo } from "../seo";
import { sweepExpiredOtps } from "../authOtp";
import { inboundConfig, inboundAddress, registerEmailInbound } from "../emailInbound";
import { getUserById } from "../db";
import { sendEmail, wrapEmailDocument } from "../email";
import { createRateLimiter, clientIpOf } from "../rateLimit";
import { registerLocalAuth } from "../authLocal";
import { appBaseUrl } from "../appUrl";
import { INSTANCE_ID, busStrict, busAuthStats, busCommandClient } from "../redisBus";
import { poolState, startVoipPool } from "../voipPool";
import { clusterEnabled } from "../relayCluster";
import { registerDomainMigration } from "../domainMigration";

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string)
  );
}

function missedCallHtml(opts: { callerLabel: string; appUrl: string | null }): string {
  const safe = escapeHtml(opts.callerLabel);
  // v2.92 (D1): appUrl is env-derived (APP_URL/DOMAIN) or null — this is a
  // request-free context and Host-derived origins are spoofable, so with no
  // env we OMIT the button entirely rather than emit a relative (dead-in-an-
  // email-client) or attacker-steerable href. The copy above the button
  // already tells the recipient what to do.
  const button = opts.appUrl
    ? `\n    <a href="${opts.appUrl}/app" style="display:inline-block;background:#3FE0C5;color:#04201B;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:12px">Open RELAY</a>`
    : "";
  // Title is a STATIC string on purpose — callerLabel is user-controlled and
  // must never reach the (unescaped) <title>; the escaped name stays in-body.
  return wrapEmailDocument(
    `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#0E1014">
    <div style="font-size:20px;font-weight:800;letter-spacing:-0.02em">RELAY</div>
    <p style="font-size:16px;line-height:1.5;margin:18px 0 6px">You missed a call from <b>${safe}</b>.</p>
    <p style="font-size:14px;color:#5A6271;margin:0 0 22px">Open RELAY to call them back.</p>${button}
    <p style="font-size:12px;color:#8A93A2;margin-top:28px">You're receiving this because you have a RELAY account.</p>
  </div>`,
    "Missed call · RELAY"
  );
}

// The RELAY calling UI is rendered by the React SPA at /app (see
// `client/src/pages/Relay.tsx`). We deliberately do NOT serve a
// standalone HTML/JS bundle from Express here — the Manus production
// runtime injects helper scripts that interfere with non-React pages,
// so the calling UI lives inside the same React tree as the rest of
// the app where the platform's tooling leaves it untouched.

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  // Self-hosted deploys (.io) have no compressing edge in front of them —
  // gzip everything EXCEPT the SSE streams (compression buffers them, which
  // would hold back signaling/presence events). Manus's own gateway already
  // compresses, so this is effectively a no-op double there.
  if (process.env.NODE_ENV === "production") {
    const { default: compression } = await import("compression");
    app.use(
      compression({
        filter: (req, res) => {
          if (req.path.startsWith("/api/relay/stream")) return false;
          if (req.path.startsWith("/api/v2/events")) return false;
          return compression.filter(req, res);
        },
      })
    );
  }
  const server = createServer(app);

  // 301 the retired .org domain to .io (owner's domain migration, 2026-07-21).
  // Lives in its own consciously-allowlisted module — the domain guard forbids
  // deployment literals everywhere else (see server/domainMigration.ts).
  registerDomainMigration(app);

  // Security headers on every response. Kept deliberately CONSERVATIVE so they
  // can't break the inline-style/script-heavy SPA, the WebRTC media stack, or the
  // Manus editor embed:
  //   - No Content-Security-Policy (the app uses many inline styles +
  //     dangerouslySetInnerHTML; a strict CSP would break rendering).
  //   - No X-Frame-Options/frame-ancestors (the Manus Space Editor frames the app).
  //   - No Permissions-Policy / COOP (could block getUserMedia or the OAuth popup).
  // What's left is pure-win and risk-free:
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("X-DNS-Prefetch-Control", "off");
    // HTTPS-only (Manus serves over TLS). No includeSubDomains/preload so
    // sibling Manus-platform preview hosts are unaffected.
    res.setHeader("Strict-Transport-Security", "max-age=15552000");
    next();
  });
  // Abuse/DoS backstop for the raw signaling POST endpoint (the tRPC API is
  // separate). Per-IP token bucket sized so it ONLY ever catches a true flood:
  // ~200 msg/s sustained, 1000 burst. A 6-way mesh blasting ICE candidates during
  // setup is ~17 msg/s; even ~10 users sharing ONE office/campus NAT doing
  // simultaneous calls stay well under it — but a runaway loop (thousands/s) gets
  // a 429. Keyed by IP (read from headers, so it runs cheaply BEFORE the body
  // parser and before attachRelay's route). Disable with RELAY_RATELIMIT_OFF=1.
  const rateLimitOff = process.env.RELAY_RATELIMIT_OFF === "1";
  const relaySendLimiter = createRateLimiter({ capacity: 1000, refillPerSec: 200 });
  if (!rateLimitOff) {
    app.use("/api/relay/send", (req, res, next) => {
      if (relaySendLimiter.allow(clientIpOf(req), Date.now())) return next();
      res.status(429).json({ error: "rate_limited" });
    });
    // Drop idle buckets every 5 min so the map can't grow unbounded.
    setInterval(() => relaySendLimiter.sweep(Date.now(), 5 * 60_000), 5 * 60_000).unref();
  }
  // Body parsers, SCOPED per route (v2.88). The old global 50mb JSON parser
  // meant ANY endpoint would happily buffer a 50 MB body on a 512 MiB
  // instance; only the upload route needs big bodies.
  //
  //   /api/v2/upload   — raw binary (application/octet-stream, the primary
  //                      path since v2.88: bytes go straight to a Buffer, no
  //                      base64 inflation) + a legacy base64-JSON route for
  //                      old clients / mobile-native, capped at 10 MB decoded
  //                      (≈15 MB of base64 JSON).
  //   /api/email/inbound — 5 MB JSON, with the exact raw bytes stashed on
  //                      req.rawBody (the provider's HMAC webhook signature is
  //                      computed over the original payload — a re-serialized
  //                      object won't byte-match).
  //   everywhere else  — 1 MB JSON/urlencoded; every other payload fits.
  // SECURITY (M34): `inflate: false` on BOTH upload parsers. body-parser inflates
  // a gzip/deflate request body by default and enforces `limit` against the
  // DECOMPRESSED stream — so the 41 MB ceiling still holds, but the COST TO THE
  // ATTACKER of reaching it collapses: a few tens of KB of compressed zeros
  // expands to the full 41 MB of server-side buffering. That used to compound an
  // ordering weakness on this route (the per-IP/per-identity upload rate limit
  // lived INSIDE the handler, so it only ran AFTER the body was already
  // buffered), turning a bounded cost into a ~1000x amplified one; v2.99.49
  // closes the ordering half with the pre-parse gate below. No client compresses an
  // upload body — browsers never gzip request bodies on their own, and the native
  // app streams raw bytes — so refusing encoded bodies here costs nothing real.
  // The upload gate runs BEFORE the parsers below, so a throttled or
  // unauthenticated request is refused without buffering up to 41MB (v2.99.49,
  // closing the ordering residual the M34 note describes above). Its own
  // cookieParser(): the global one is mounted further down, AFTER these parsers,
  // and the gate's identity resolution reads relay_guest / relay_session.
  // cookie-parser early-returns when req.cookies is already set, so the later
  // global instance is a no-op for these requests.
  app.use("/api/v2/upload", cookieParser(), uploadRateGate);
  app.use(
    "/api/v2/upload",
    express.raw({ type: "application/octet-stream", limit: "41mb", inflate: false })
  );
  app.use("/api/v2/upload", express.json({ limit: "15mb", inflate: false }));
  app.use(
    "/api/email/inbound",
    express.json({
      limit: "5mb",
      verify: (req, _res, buf) => {
        (req as { rawBody?: Buffer }).rawBody = buf;
      },
    })
  );
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ limit: "1mb", extended: true }));
  // Populate req.cookies for all downstream middleware (tRPC context
  // reads `req.cookies.relay_guest` to resolve guest identities).
  // Without this, req.cookies is undefined and every guest looks signed
  // out even though their cookie made it back to the server.
  app.use(cookieParser());
  registerStorageProxy(app);
  registerOAuthRoutes(app);
  // /.well-known/assetlinks.json — proves the RELAY Android app (TWA) and this
  // origin share an owner, unlocking the app's full-screen mode. Env-driven
  // (TWA_SHA256_FINGERPRINTS); 404s harmlessly until configured.
  registerWellKnown(app);
  registerSeo(app);
  // RELAY signaling — SSE + POST on /api/relay/{stream,send}. We use
  // plain HTTP because the production gateway downgrades raw WebSocket
  // upgrades on arbitrary paths.
  // The relay handler also emits a `call_offer` hint on the v2 SSE bus
  // when an invite is dispatched, so the callee gets a desktop
  // notification even if they're not on the call screen yet.
  attachRelay(
    app,
    async (info) => {
      // onInvite: alert the callee on their other tabs AND — when their app is
      // MINIMISED — at the OS level.
      try {
        const callee = await getIdentityByNumber(info.toPin);
        if (!callee) return;
        // SECURITY/privacy: a caller the callee has BLOCKED must not be able to
        // pop a call notification on the callee's devices. Block enforcement was
        // client-only (auto-decline after the ring) + only on messages.send;
        // suppress the notification server-side too. (Notification-only hooks —
        // this doesn't touch the synchronous call-routing state machine.)
        //
        // THE GATE STAYS AHEAD OF THE PUSH ADDED BELOW. E4 (v2.98.6) exists
        // precisely because a blocked caller could otherwise fire the callee's
        // full-screen ring, and a push is the loudest possible form of that.
        if (await isNumberBlockedBy(callee.id, info.fromPin).catch(() => false)) return;
        publishToIdentity(callee.id, {
          kind: "call_offer",
          fromNumber: info.fromPin,
          fromName: info.fromName,
          roomId: info.roomId,
        });
        /* ── A MINIMISED APP NOW RINGS (v2.105.18) ─────────────────────────────
         * THE GAP THIS CLOSES, and it is the FOURTH reader of a rule that has
         * existed since v2.99.92. That release established that minimising is
         * IDLE, not offline — `markIdle` deliberately keeps `isOnline` TRUE
         * because the SSE stream is still open — and it added
         * `presenceNeedsNotification` (`!isOnline || idle`) for exactly the
         * question "can they see this in the open app, or must the OS tell them".
         * Its three readers are all in the MESSAGE path. The CALL path never
         * learned it.
         *
         * So a call to a minimised callee took the LIVE branch: an SSE ring plus
         * this `call_offer` hint, and NO push. That is enough for a visible tab
         * and nothing like enough for a backgrounded one — a hidden tab has its
         * EventSource throttled and its AudioContext suspended, and a
         * backgrounded WebView on Android or iOS has its JS frozen outright, so
         * `playCallRing()` never sounds and the page-level Notification is never
         * raised. The phone stays silent while the server believes it rang.
         *
         * The push is what survives that, and every transport behind it already
         * exists: `sw.js` renders a `requireInteraction` call notification with
         * sound and vibration and focuses the app on tap (whereupon
         * `deliverPendingRing` hands over the real ring and the in-page card
         * pops), the Android shell turns it into a full-screen intent, and the
         * iOS shell turns an `apns-voip` token into the CallKit screen. Nothing
         * downstream needed building — the call path simply never asked.
         *
         * A VISIBLE callee is deliberately NOT pushed: they are looking at the
         * app, the SSE ring is already sounding, and an OS notification on top of
         * it is noise. `presenceNeedsNotification` is what draws that line, and
         * reusing it rather than re-deriving one keeps the call path and the
         * message path agreeing about what "away" means.
         *
         * FAILS TOWARD RINGING: an unknown presence row reads as needing the
         * notification (the helper returns true for null), because a spurious
         * notification costs a moment's noise while a missed one costs the call.
         */
        const [pres] = await getPresenceForIds([callee.id]).catch(() => []);
        if (!presenceNeedsNotification(pres)) return;
        // ONE FUNNEL, deliberately — the same one `onPageCallee` uses, because
        // that is where the user's own master push switch is enforced (v2.99.40)
        // and where every transport fans out. A parallel ring sender would
        // bypass that switch however well-intentioned.
        await sendPushToIdentity(callee.id, {
          kind: "incoming-call",
          title: `${info.fromName || "Someone"} is calling`,
          body: "Tap to answer on RELAY",
          // The SAME tag the paged ring uses, so the two can never stack two
          // notifications for one call: whichever arrives second replaces the
          // first.
          tag: "relay-call",
          url: "/app/dialer",
          call: {
            callerName: info.fromName || "Someone",
            callerPin: info.fromPin,
            // The room the callee must join to answer. A ring with no room is a
            // phone that rings and then cannot connect.
            roomId: info.roomId,
            video: !!info.video,
          },
        }).catch(() => 0);
      } catch {
        /* swallow — the call still completes via the relay channel */
      }
    },
    async (info) => {
      // onMissedCall: record the miss for everyone (guests too, so "recents"
      // reflect it); email only a genuine MISS (caller gave up) to a REGISTERED
      // callee. A deliberate decline is recorded but not emailed.
      try {
        const callee = await getIdentityByNumber(info.calleePin);
        if (!callee) return;
        // QA H7/H8/M1: a BLOCKED caller must not reach the callee through the
        // missed-call path either. The live-invite paths already suppress the
        // notification when the callee blocked the caller, but this hook (fired
        // on a cancelled offline dial or a decline) recorded History + fired a
        // "Missed call from B" push/email with no block check — turning a block
        // into a repeatable push/email/history-injection channel. Skip it
        // ENTIRELY when blocked (history + push + email), matching the invite
        // guards. Fail-open on a DB hiccup so a genuine miss is never dropped.
        if (await isNumberBlockedBy(callee.id, info.callerPin).catch(() => false)) return;
        const caller = await getIdentityByNumber(info.callerPin);
        if (caller) {
          await recordMissedCall({
            callerIdentityId: caller.id,
            calleeIdentityId: callee.id,
            status: info.reason === "rejected" ? "declined" : "missed",
          }).catch(() => {});
        }
        if (info.reason !== "cancelled") return; // don't notify deliberate declines
        // Missed-call PUSH — works for guests too (no email needed) and reaches
        // phones that were asleep for the ring itself.
        sendPushToIdentity(callee.id, {
          kind: "missed-call",
          title: `Missed call from ${info.callerName || info.callerPin}`,
          body: "Tap to see your missed calls on RELAY.",
          tag: "relay-missed",
          url: "/app/history?filter=missed",
        }).catch(() => {});
        if (callee.userId == null) return; // guests have no email
        const user = await getUserById(callee.userId);
        if (!user?.email) return;
        // Email-notification preference (v2.99.13): NULL/true = on (historical
        // default), false = the user turned missed-call emails off in Profile.
        // The push + History record above stay unconditional — only the EMAIL
        // is preference-gated.
        if (user.emailNotifyMissedCall === false) return;
        // THROTTLE (v2.99.44, closing the H8 follow-up deferred in v2.99.22).
        // This email had no rate limit of any kind, so someone dialling you
        // repeatedly produced one email per attempt — the same unbounded shape
        // the offline-message nudge was tightened out of. One atomic claim per
        // cooldown window; the push and the History record above stay
        // unconditional, so a throttled email never costs you the record of the
        // call itself.
        if (!(await claimMissedCallEmail(callee.userId, MISSED_CALL_EMAIL_COOLDOWN_MS))) return;
        const callerLabel = info.callerName
          ? `${info.callerName} (${info.callerPin})`
          : info.callerPin;
        // v2.92 (R4B/D1): request-free context — the public origin comes ONLY
        // from env (APP_URL / DOMAIN); there is deliberately no traffic-derived
        // fallback (spoofable x-forwarded-host must never steer email links).
        // null degrades gracefully: the email still sends, minus the absolute
        // "Open RELAY" button.
        const appUrl = appBaseUrl();
        // When inbound email is configured, set a signed Reply-To so the callee
        // can reply straight from their inbox and it posts into their thread
        // with the caller.
        let replyTo: string | undefined;
        if (inboundConfig().enabled && caller) {
          try {
            const convo = await getOrCreateDmConversation(callee.id, caller.id);
            replyTo = inboundAddress(convo.id, callee.id);
          } catch {
            /* reply-to is best-effort */
          }
        }
        const sent = await sendEmail({
          to: user.email,
          subject: `Missed call from ${callerLabel} on RELAY`,
          html: missedCallHtml({ callerLabel, appUrl }),
          replyTo,
        });
        // Give the claim back when the send FAILED. sendEmail never throws — it
        // resolves {ok:false} — so this has to inspect the result; a `.catch`
        // here would be dead code (the same trap the message nudge was caught in).
        if (!sent.ok) await releaseMissedCallEmailClaim(callee.userId);
      } catch (err) {
        console.warn("[missed-call email]", err);
      }
    },
    async (info) => {
      // onConferenceEnd: persist the ended room as conference history. Resolves
      // each participant pin -> identity (pin === number) inside recordConferenceEnd.
      try {
        await recordConferenceEnd({
          roomId: info.roomId,
          dialedNumber: info.dialedNumber,
          startedAt: info.startedAt,
          answeredAt: info.answeredAt,
          endedAt: info.endedAt,
          // #116 — how it was dialled, so History can say Voice or Video for an
          // ANSWERED group call. Null means unknown and stays null in the column.
          video: info.video,
          participants: info.participants.map((p) => ({ number: p.pin, name: p.name })),
        });
      } catch (err) {
        console.warn("[conference-history]", err);
      }
    },
    async (info) => {
      // onPageCallee: an invite targeted a number with NO live signaling
      // connection (never registered, or a backgrounded/locked phone whose SSE
      // died). Resolve the identity, then TRY TO WAKE THE DEVICE, and report
      // whether anything was reached — `pushed` is what the relay uses to decide
      // between paging and a fast honest "offline".
      //
      // RESTORED IN v2.105.12, and the history matters because the two owner
      // directives look contradictory. v2.99.11 removed this push entirely — "if
      // the user is offline and you try to call him it should NOT ring
      // automatically" — and the owner has now asked for the opposite: "build the
      // incoming-call push path and restore ringing", so a closed or locked phone
      // rings like WhatsApp does. Both are honoured because the decision is made
      // on the RESULT: a device that can be woken rings, and a callee no push can
      // reach still gets today's fast bounce plus the leave-a-message card rather
      // than a caller staring at "Reaching their phone…" for 65 seconds.
      const callee = await getIdentityByNumber(info.calleePin);
      if (!callee) return { exists: false };
      // BLOCKING (E4, v2.98.6 — and this gate had to come BACK with the push).
      // The original finding was that a blocked caller could still fire the
      // callee's full-screen incoming-call push; v2.99.11 made that hold
      // trivially by deleting the push, so restoring the push without restoring
      // the gate re-opens exactly that bypass — a blocked person waking a locked
      // phone with a CallKit ring is the loudest possible version of it.
      //
      // Reported as `pushed: 0`, NOT as a distinct outcome: the caller then gets
      // the ordinary "<Name> is offline right now.", byte-identical to a genuinely
      // unreachable callee, so the reply is no oracle for having been blocked.
      // The miss is likewise suppressed by `onMissedCall`'s own block check.
      if (await isNumberBlockedBy(callee.id, info.callerPin).catch(() => false)) {
        return { exists: true, name: callee.displayName ?? undefined, pushed: 0 };
      }
      let pushed = 0;
      try {
        // ONE FUNNEL, deliberately — `sendPushToIdentity` is where the user's own
        // master push switch is enforced (v2.99.40) and where every transport
        // (Web Push / FCM / Expo / APNs VoIP) fans out. A parallel ring sender
        // would bypass that switch, which is a bug however well-intentioned.
        //
        // CONTENT-FREE by the owner's standing rule: the caller's own name and
        // number, which the callee is about to see on the ring card anyway.
        // Nothing about the conversation, and no third party's data. `call`
        // carries the ROOM, because a PushKit/CallKit answer means joining the
        // room the caller already created — a ring with no room is a phone that
        // rings and then cannot connect.
        pushed = await sendPushToIdentity(callee.id, {
          kind: "incoming-call",
          title: `${info.callerName || "Someone"} is calling`,
          body: "Tap to answer on RELAY",
          // One tag for every ring, so a redial REPLACES the notification
          // instead of stacking a second one for the same call.
          tag: "relay-call",
          url: "/app/dialer",
          call: {
            callerName: info.callerName || "Someone",
            callerPin: info.callerPin,
            roomId: info.roomId,
            video: info.video,
            // The spec's `callerAvatar`. BEST-EFFORT and separately caught: this
            // is decoration on a call screen that falls back to initials, so it
            // may never be the reason a ring does not go out. Not a disclosure
            // change — an avatar has always been served to any signed-in caller
            // and already renders on the in-app ring card (v2.99.20).
            callerAvatar: await getIdentityByNumber(info.callerPin)
              .then(c => c?.avatarUrl ?? null)
              .catch(() => null),
          },
        });
      } catch {
        // A push failure must never break call setup. `pushed` stays 0, so the
        // relay bounces the caller honestly instead of paging into silence.
      }
      return { exists: true, name: callee.displayName ?? undefined, pushed };
    },
    async (pin) => {
      // onResolveDial (v2.89): party lines. A dialed number that matches a
      // party_lines row NEVER rings anyone — the relay drops the caller into
      // the line's persistent room (`pl-<number>`). Anything else (including a
      // DB hiccup — the relay catches a rejection) dials as an identity.
      const line = await getPartyLineByNumber(pin);
      if (line) return { partyLine: true as const, title: line.title };
      return "identity" as const;
    },
    (info) => {
      // onCancelRingPush: the caller hung up before this callee answered, and this
      // callee's ring was delivered by PUSH — so there is no socket for the
      // websocket `ring-cancel` beside it to reach, and without this their handset
      // rings for the full 45s expiry after the caller has already given up. On
      // iOS that is a CallKit screen somebody answers into a call that ended.
      //
      // FIRE AND FORGET. The relay calls this from the hang-up path, which is
      // synchronous and must not wait on a DB read plus two HTTP round trips; a
      // failure here costs a stale ring, where a thrown error would cost the
      // hang-up itself.
      //
      // Through `sendPushToIdentity` like the ring, for the same reason: it is the
      // one place the user's master push switch is enforced and the only place
      // that knows every transport. `kind` stays "incoming-call" so the cancel
      // reaches EXACTLY the transports the ring did — the APNs VoIP branch is
      // gated on that kind, and a cancel that took a different route could arrive
      // at a device the ring never reached, or miss the one it did. The `type`
      // inside the payload is what makes it a cancel.
      void (async () => {
        try {
          const callee = await getIdentityByNumber(info.calleePin);
          if (!callee) return;
          await sendPushToIdentity(callee.id, {
            kind: "incoming-call",
            title: "Call ended",
            body: "",
            tag: "relay-call",
            url: "/app/dialer",
            call: {
              type: "call_cancel",
              // A cancel names the call to stop and nothing else — see
              // `buildCallCancel` for why it carries no caller identity.
              callerName: "",
              callerPin: "",
              roomId: info.roomId,
              video: false,
            },
          });
        } catch {
          /* a stale ring is the acceptable failure; a thrown hang-up is not */
        }
      })();
    }
  );
  // Version endpoint for the client's auto-update checker. Returns the version
  // baked into THIS (running) deploy; an older already-loaded tab polls it and
  // notices a mismatch after a new deploy. Cheap, no-auth, no-cache.
  app.get("/api/version", (_req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({ version: APP_VERSION });
  });
  // Liveness probe (v2.90) — the process is up and serving. No auth, no DB
  // touch (a transient DB blip during a rolling deploy must not fail the
  // gate), no cache. Used by the AWS rolling-deploy health check and any
  // load-balancer target group. The host it answers on is whatever domain
  // this instance is deployed under — the app is domain-agnostic.
  app.get("/api/health", (_req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    // `instance` is a per-boot random id (server/redisBus.ts). Behind a
    // multi-instance load balancer this VARIES across repeated /api/health
    // hits — that's how you confirm you're running >1 app instance. RELAY's
    // call signaling (/api/relay/*) is in-memory per-instance, so a
    // multi-instance deploy MUST pin ALL /api/relay/* to one instance (see
    // docs-aws-scale-out.md) or two callers on different instances can't
    // ring each other. `redisBus` reports whether the cross-instance event
    // bus is active (required before running >1 instance).
    res.json({
      status: "ok",
      version: APP_VERSION,
      instance: INSTANCE_ID,
      redisBus: Boolean(process.env.REDIS_URL),
      // Bus envelope authentication (v2.99.49). Counters, no secret — they exist
      // so REDIS_BUS_STRICT=1 can be flipped on EVIDENCE (every instance
      // reporting unsigned: 0 for a sustained window) instead of on faith. An
      // unsigned envelope means an instance mid-deploy is still on an older
      // build; `invalid` means a signature was present and WRONG, which is
      // always dropped regardless of strict mode.
      busAuth: {
        strict: busStrict(),
        signed: busAuthStats.signed,
        unsigned: busAuthStats.unsigned,
        invalid: busAuthStats.invalid,
      },
      // Operators who HAVE pinned all /api/relay/* to one instance (per
      // docs-aws-scale-out.md) set RELAY_SIGNALING_PINNED=1 on every instance
      // to silence the in-app "calling misconfigured" banner. Default false:
      // a multi-instance deploy is assumed unpinned (calls broken) until the
      // operator asserts otherwise.
      signalingPinned: process.env.RELAY_SIGNALING_PINNED === "1",
      // Cross-instance signaling (phase-2). When on (RELAY_CLUSTER=1 + REDIS_URL),
      // calls ring + connect across instances via the elected leader — so NO ALB
      // pin is needed and the "misconfigured" banner suppresses itself.
      cluster: clusterEnabled(),
      /**
       * WHICH MEDIA TRANSPORT THE FLEET IS ACTUALLY USING (v2.105.20).
       *
       * Added because it was NOT ANSWERABLE without opening a call, and the answer
       * matters: on the WebRTC mesh every phone in an N-party call runs N-1
       * encoders and N-1 decoders, which v2.99.84 measured as the single biggest
       * lever on call CPU, heat and latency.
       *
       * `mesh` IS NOW UNCONDITIONALLY TRUE (v2.106.53) and stays reported rather
       * than being dropped, because a health endpoint that stops answering a
       * question is worse than one that answers it plainly: an operator reading
       * this needs to know the fleet is on the mesh, not merely that it is not on
       * something else.
       *
       * THE POOL IS COUNTS ONLY, AND THAT IS A DELIBERATE LINE (v2.105.22 drew it
       * for the SFU URL and the reasoning is unchanged): this endpoint is
       * UNAUTHENTICATED, so it reports how many nodes there are and whether the
       * pool is saturated — enough to alert on — and never an address, a zone or an
       * instance id. Publishing the media topology to anonymous callers is not
       * something an uptime check needs. The per-node detail lives behind the admin
       * gate in `admin.mediaDiagnostics`.
       *
       * `saturated` IS THE ONE AN ALERT SHOULD WATCH, and it is deliberately not
       * "nodes === 0": an empty pool means the agent is not running, which is a
       * different problem with a different fix, so the two are separate fields
       * rather than one "unhealthy" boolean that sends an operator the wrong way.
       *
       * BOOLEANS AND COUNTS ONLY, never a URL and never a key — the same discipline
       * as `redisBus: Boolean(REDIS_URL)` above.
       */
      media: (() => {
        const p = poolState();
        return {
          mesh: true,
          voipPool: {
            configured: p.configured,
            nodes: p.total,
            live: p.live.length,
            eligible: p.eligible.length,
            draining: p.draining,
            saturated: p.reason === "all-saturated",
            reason: p.reason,
          },
        };
      })(),
    });
  });
  // v2.0 attachment upload (multipart-friendly JSON body)
  registerV2Upload(app);
  // v2.0 push channel — SSE that routes message/presence/read events
  // to the right identity. Production gateway is SSE-friendly.
  registerV2Events(app);
  // Live network stats, PUSHED (v2.99.71). Public + aggregate-only, so it needs no
  // identity — the landing page has none. One shared computation per instance feeds
  // every viewer, which is strictly cheaper than the per-visitor polling it replaces,
  // and its timers only run while somebody is actually watching.
  registerStatsFeed(app);
  // Instant offline presence (v2.89): the sendBeacon target fired on
  // pagehide/tab-hide so contacts' LEDs flip grey immediately instead of
  // waiting out the 2-minute reaper (which stays as the backstop).
  registerV2Offline(app);
  // Inbound email webhook (reply-to-thread). No-op until INBOUND_EMAIL_DOMAIN.
  registerEmailInbound(app);
  // Self-hosted email/password auth (register / verify / login / resend), served
  // alongside the Manus OAuth. The tRPC context recognizes its session cookie.
  registerLocalAuth(app);
  // Apply additive schema columns to the live DB (idempotent, never
  // destructive) — AWAIT before we start serving so contact SELECTs (which name
  // the new columns) can't 500 in a startup window on a fresh DB. The function
  // swallows per-column errors internally, so it won't throw / block boot; the
  // outer catch is belt-and-suspenders.
  await ensureSchemaExtensions().catch((err) => {
    console.warn("[v2 schema ensure]", err);
  });

  /* MEDIA-NODE POOL — the refresh timer that makes adding a node an infrastructure step.
   *
   * Dormant without `REDIS_URL`: `busCommandClient()` is null, `startVoipPool` returns
   * immediately, and `poolSnapshot()` stays empty, so every call takes the mesh exactly as
   * it does with no pool at all. With Redis it reads the registry on the node heartbeat
   * cadence and warns when the pool has nothing to offer — naming which of the five
   * reasons it is, because "add a node" and "your agent is not running" need different
   * actions from whoever reads the log. */
  startVoipPool(busCommandClient());

  // Stale-presence sweep — once a minute, flip users whose heartbeat
  // expired to offline. For EACH reaped user, broadcast an offline SSE event to
  // their audience (v2.99.3) so SSE-fed surfaces (Contacts/Messages/profile
  // popup) don't keep showing a crashed/closed user green until their own poll.
  setInterval(() => {
    reapStalePresence(120)
      .then(async (reaped) => {
        const now = new Date();
        for (const r of reaped) {
          try {
            const audience = await getPresenceAudienceIds(r.id, r.number);
            publishPresenceTo(audience, r.number, false, now);
          } catch {
            /* per-user best-effort; never break the sweep */
          }
        }
      })
      .catch((err) => {
        console.warn("[v2 presence reaper]", err);
      });
  }, 60_000).unref();
  // Purge expired email-OTP rows every 5 minutes (10-min TTL codes).
  setInterval(() => {
    sweepExpiredOtps().catch((err) => console.warn("[otp sweep]", err));
  }, 5 * 60_000).unref();
  // Reap expired rich-status rows + their views every 10 minutes (24h TTL). Reads
  // already filter expiresAt > now, so this is purely to keep the tables bounded.
  setInterval(() => {
    reapExpiredStatuses().catch((err) => console.warn("[status reaper]", err));
  }, 10 * 60_000).unref();
  // Reclaim 6-digit numbers that were RESERVED but never bound to a real row
  // (v2.99.49) — the crash-window backstop for the case no release call can
  // cover: the process dying between reserving and inserting. Hourly is ample;
  // the helper itself only ever touches rows that are unclaimed AND post-epoch
  // AND past the grace period AND absent from both number tables.
  setInterval(() => {
    reapUnclaimedReservations().catch((err) => console.warn("[reservation reaper]", err));
  }, 60 * 60_000).unref();
  // Reap the sessions ledger every 30 min: dead new-device approval rows (never
  // approved after 30 min — they'd otherwise inflate the pending-device bell
  // forever) + sessions idle PAST THE LONGEST COOKIE TTL. QA M8: the default
  // session cookie is 1 YEAR (SESSION_TTL_MS = 365d in authLocal.ts), so the
  // original 95-day idle cutoff deleted still-valid session rows and force-
  // logged-out users up to ~270 days early (sessionState reads the reaped row as
  // "revoked"). Use 365d + 7d grace so a row outlives every cookie it backs.
  setInterval(() => {
    reapStaleSessions(30 * 60_000, 372 * 24 * 60 * 60_000).catch((err) =>
      console.warn("[sessions reaper]", err),
    );
  }, 30 * 60_000).unref();
  // Purge guest identities that have gone 30 days without a visit (v2.100.0).
  //
  // OFF BY DEFAULT, and the interval below is registered regardless because
  // `reapExpiredGuests` returns immediately when the switch is unset — so turning
  // it on is one env var and a restart, with no code change and no window where
  // half the fleet sweeps. This is the only unattended irreversible destructive
  // path in the codebase, so `RELAY_GUEST_PURGE=dry` logs what it WOULD delete and
  // touches nothing: the first honest count of eligible rows has to come from
  // production, because nobody can take it from outside.
  setInterval(() => {
    reapExpiredGuests().catch((err) => console.warn("[guest purge]", err));
  }, 30 * 60_000).unref();
  // tRPC API
  //
  // SECURITY (v2.99.49): cap the BATCH size. tRPC's httpBatchLink packs many
  // calls into one request, and with no cap a single request could carry dozens
  // of the same expensive procedure — which is how a per-call limit on
  // `messages.revealExpiring` (a 30MB inline read each) still added up to enough
  // heap to OOM this process, and this process owns the whole in-memory signaling
  // registry. The real client batches a handful of light queries at a time, so a
  // generous cap costs nothing legitimate. Runs BEFORE the tRPC middleware, so an
  // over-cap batch is rejected without any resolver executing.
  const TRPC_MAX_BATCH = 20;
  app.use("/api/trpc", (req, res, next) => {
    if (req.query.batch === undefined) return next();
    let n = 0;
    if (req.method === "GET") {
      // GET batches encode inputs as `?input={"0":…,"1":…}`; the path names the
      // procedures, comma-separated.
      const path = req.path.replace(/^\//, "");
      n = path ? path.split(",").length : 0;
    } else if (Array.isArray(req.body)) {
      n = req.body.length;
    } else if (req.body && typeof req.body === "object") {
      n = Object.keys(req.body as Record<string, unknown>).length;
    }
    if (n > TRPC_MAX_BATCH) {
      res.status(413).json({ error: "batch_too_large" });
      return;
    }
    next();
  });
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    // Dynamic import: vite is a devDependency — production bundles must not
    // reference it even lazily (ROUND 2 fix; self-hosted fleet has no vite).
    const { setupVite } = await import("./vite");
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
