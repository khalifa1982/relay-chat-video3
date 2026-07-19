/* ============================================================
   POST /api/v2/offline — instant offline presence (v2.89).

   Fired by the client's `navigator.sendBeacon` on pagehide /
   visibilitychange→hidden, because tRPC mutations issued during
   unload are routinely dropped by the browser — which left a
   closed tab's presence LED green for up to 2 minutes until the
   stale-presence reaper caught it. sendBeacon is the one API the
   browser guarantees to flush after the page is gone.

   Identity resolution mirrors the SSE bus (`/api/v2/events`):
   the shared `createContext` first (cookies ride the same-origin
   beacon), then a device-id FALLBACK read from the body — beacons
   cannot set headers, so the `x-relay-device-id` survival path the
   rest of the API uses arrives in the payload instead. The 2-min
   reaper stays as the backstop for devices that die without firing
   any unload event at all (battery pull, crashed browser).
   ============================================================ */

import express from "express";
import type { Express, Request, Response } from "express";
import { createContext } from "./_core/context";
import { getIdentityByDeviceId, getPresenceAudienceIds, markOffline } from "./v2db";
import { publishPresenceTo } from "./v2events";

/**
 * Extract a plausible device id from whatever body shape arrived. sendBeacon
 * with a string posts `text/plain` (parsed by this route's scoped text
 * parser); tests and odd clients may post real JSON (parsed upstream by the
 * global JSON parser into an object). Pure — unit-tested without Express.
 */
export function parseOfflineBody(body: unknown): { deviceId: string | null } {
  let obj: unknown = body;
  if (Buffer.isBuffer(body)) {
    try { obj = JSON.parse(body.toString("utf8")); } catch { obj = null; }
  } else if (typeof body === "string") {
    try { obj = JSON.parse(body); } catch { obj = null; }
  }
  const raw =
    obj && typeof obj === "object"
      ? (obj as Record<string, unknown>).deviceId
      : null;
  if (typeof raw !== "string") return { deviceId: null };
  const trimmed = raw.trim().toLowerCase();
  // Same shape rule as the `x-relay-device-id` header (context.ts): hex, 8-64.
  return { deviceId: /^[a-f0-9]{8,64}$/.test(trimmed) ? trimmed : null };
}

export function registerV2Offline(app: Express) {
  // Scoped tiny body parser: sendBeacon(string) arrives as text/plain, which
  // the global JSON/urlencoded parsers skip. Accept any content type here —
  // the payload is a single optional deviceId, capped well under 4 KB.
  app.use("/api/v2/offline", express.text({ type: () => true, limit: "4kb" }));
  app.post("/api/v2/offline", async (req: Request, res: Response) => {
    try {
      // Resolve identity via the SAME context resolver as tRPC / the SSE bus.
      let identity: { id: number; number: string } | null = null;
      try {
        const ctx = await createContext({ req, res } as Parameters<typeof createContext>[0]);
        identity = ctx.identity;
      } catch {
        identity = null;
      }
      // Beacon fallback: no cookie made it (ITP/private mode) — the body's
      // deviceId resolves guests exactly like the header does elsewhere.
      if (!identity) {
        const { deviceId } = parseOfflineBody(req.body);
        if (deviceId) identity = await getIdentityByDeviceId(deviceId);
      }
      if (!identity) {
        return res.status(401).json({ error: "No identity" });
      }
      // Same path as directory.goOffline: flip the row, tell the audience.
      await markOffline(identity.id);
      try {
        const audience = await getPresenceAudienceIds(identity.id, identity.number);
        publishPresenceTo(audience, identity.number, false, new Date());
      } catch {
        /* audience push is best-effort */
      }
      return res.json({ ok: true });
    } catch (err) {
      console.warn("[v2offline]", err instanceof Error ? err.message : err);
      return res.status(500).json({ error: "offline failed" });
    }
  });
}
