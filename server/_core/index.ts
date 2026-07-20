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
import { registerV2Upload } from "../v2upload";
import { registerV2Events, publishToIdentity } from "../v2events";
import { registerV2Offline } from "../v2offline";
import { getIdentityByNumber, getPartyLineByNumber, reapStalePresence, recordMissedCall, recordConferenceEnd, ensureSchemaExtensions, getOrCreateDmConversation } from "../v2db";
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
import { INSTANCE_ID } from "../redisBus";

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
  app.use(
    "/api/v2/upload",
    express.raw({ type: "application/octet-stream", limit: "41mb" })
  );
  app.use("/api/v2/upload", express.json({ limit: "15mb" }));
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
      // onInvite: desktop-notify the callee on their other tabs.
      try {
        const callee = await getIdentityByNumber(info.toPin);
        if (!callee) return;
        publishToIdentity(callee.id, {
          kind: "call_offer",
          fromNumber: info.fromPin,
          fromName: info.fromName,
          roomId: info.roomId,
        });
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
        await sendEmail({
          to: user.email,
          subject: `Missed call from ${callerLabel} on RELAY`,
          html: missedCallHtml({ callerLabel, appUrl }),
          replyTo,
        });
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
          participants: info.participants.map((p) => ({ number: p.pin, name: p.name })),
        });
      } catch (err) {
        console.warn("[conference-history]", err);
      }
    },
    async (info) => {
      // onPageCallee: an invite targeted a number with NO live signaling
      // connection (backgrounded/locked phone, closed tab). Answer whether the
      // number belongs to a real identity — if so the relay PAGES it (keeps the
      // dial alive + redelivers the ring when the app opens) and we WAKE the
      // device with a Web Push so a pocketed phone actually alerts.
      const callee = await getIdentityByNumber(info.calleePin);
      if (!callee) return { exists: false };
      const caller = info.callerName
        ? `${info.callerName} (${info.callerPin})`
        : info.callerPin;
      sendPushToIdentity(callee.id, {
        kind: "incoming-call",
        title: `Incoming ${info.video ? "video" : "voice"} call`,
        body: `${caller} is calling you on RELAY — tap to answer.`,
        tag: `relay-call-${info.roomId}`,
        url: "/app/dialer",
      }).catch(() => {
        /* push is best-effort — the page itself still works via reconnect */
      });
      return { exists: true, name: callee.displayName ?? undefined };
    },
    async (pin) => {
      // onResolveDial (v2.89): party lines. A dialed number that matches a
      // party_lines row NEVER rings anyone — the relay drops the caller into
      // the line's persistent room (`pl-<number>`). Anything else (including a
      // DB hiccup — the relay catches a rejection) dials as an identity.
      const line = await getPartyLineByNumber(pin);
      if (line) return { partyLine: true as const, title: line.title };
      return "identity" as const;
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
    });
  });
  // v2.0 attachment upload (multipart-friendly JSON body)
  registerV2Upload(app);
  // v2.0 push channel — SSE that routes message/presence/read events
  // to the right identity. Production gateway is SSE-friendly.
  registerV2Events(app);
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

  // Stale-presence sweep — once a minute, flip users whose heartbeat
  // expired to offline. Cheap UPDATE; safe to run from a single instance.
  setInterval(() => {
    reapStalePresence(120).catch((err) => {
      console.warn("[v2 presence reaper]", err);
    });
  }, 60_000).unref();
  // Purge expired email-OTP rows every 5 minutes (10-min TTL codes).
  setInterval(() => {
    sweepExpiredOtps().catch((err) => console.warn("[otp sweep]", err));
  }, 5 * 60_000).unref();
  // tRPC API
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
