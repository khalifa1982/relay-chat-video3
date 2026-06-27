import "dotenv/config";
import express from "express";
import cookieParser from "cookie-parser";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { attachRelay } from "../relay";
import { registerV2Upload } from "../v2upload";
import { registerV2Events, publishToIdentity } from "../v2events";
import { getIdentityByNumber, reapStalePresence, recordMissedCall } from "../v2db";
import { getUserById } from "../db";
import { sendEmail } from "../email";

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string)
  );
}

function missedCallHtml(opts: { callerLabel: string; appUrl: string }): string {
  const safe = escapeHtml(opts.callerLabel);
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#0E1014">
    <div style="font-size:20px;font-weight:800;letter-spacing:-0.02em">RELAY</div>
    <p style="font-size:16px;line-height:1.5;margin:18px 0 6px">You missed a call from <b>${safe}</b>.</p>
    <p style="font-size:14px;color:#5A6271;margin:0 0 22px">Open RELAY to call them back.</p>
    <a href="${opts.appUrl}/app" style="display:inline-block;background:#3FE0C5;color:#04201B;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:12px">Open RELAY</a>
    <p style="font-size:12px;color:#8A93A2;margin-top:28px">You're receiving this because you have a RELAY account.</p>
  </div>`;
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
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  // Populate req.cookies for all downstream middleware (tRPC context
  // reads `req.cookies.relay_guest` to resolve guest identities).
  // Without this, req.cookies is undefined and every guest looks signed
  // out even though their cookie made it back to the server.
  app.use(cookieParser());
  registerStorageProxy(app);
  registerOAuthRoutes(app);
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
        if (info.reason !== "cancelled") return; // don't email deliberate declines
        if (callee.userId == null) return; // guests have no email
        const user = await getUserById(callee.userId);
        if (!user?.email) return;
        const callerLabel = info.callerName
          ? `${info.callerName} (${info.callerPin})`
          : info.callerPin;
        const appUrl = process.env.APP_URL || "https://www.your-chat.org";
        await sendEmail({
          to: user.email,
          subject: `Missed call from ${callerLabel} on RELAY`,
          html: missedCallHtml({ callerLabel, appUrl }),
        });
      } catch (err) {
        console.warn("[missed-call email]", err);
      }
    }
  );
  // v2.0 attachment upload (multipart-friendly JSON body)
  registerV2Upload(app);
  // v2.0 push channel — SSE that routes message/presence/read events
  // to the right identity. Production gateway is SSE-friendly.
  registerV2Events(app);
  // Stale-presence sweep — once a minute, flip users whose heartbeat
  // expired to offline. Cheap UPDATE; safe to run from a single instance.
  setInterval(() => {
    reapStalePresence(120).catch((err) => {
      console.warn("[v2 presence reaper]", err);
    });
  }, 60_000).unref();
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
