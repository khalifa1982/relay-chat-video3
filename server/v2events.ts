/**
 * v2 Server-Sent Events bus.
 *
 * Why SSE and not WebSocket: the production gateway downgrades raw
 * WebSocket upgrades on arbitrary paths. SSE is just an HTTP response
 * with `Content-Type: text/event-stream`, which the gateway passes
 * through cleanly. The downside (no client→server frames) is fine
 * because writes still go through tRPC.
 *
 * Each connected identity gets one or more streams (a user can have
 * multiple tabs open). When we publish a payload to identity N, every
 * open stream for N receives it. Other identities don't.
 *
 * v2.91 — horizontal scale: when REDIS_URL is set, every publish is ALSO
 * fanned out on the Redis channel `relay:v2ev` so identities whose SSE
 * stream landed on a DIFFERENT instance (load-balanced /api/v2/events)
 * still get their events. Order of operations is deliberate: deliver to
 * THIS instance's local streams first, then publish for the others;
 * subscribers drop envelopes stamped with their own instance id (see
 * server/redisBus.ts), so nothing is ever delivered twice. With REDIS_URL
 * unset the publish helpers are no-ops and behavior is byte-identical to
 * the single-instance build.
 */
import type { Express, Request, Response } from "express";
import { createContext, GUEST_COOKIE } from "./_core/context";
import { createRateLimiter, clientIpOf } from "./rateLimit";
import { publishBus, subscribeBus, V2EV_CHANNEL } from "./redisBus";

type SseClient = {
  res: Response;
  identityId: number;
  closed: boolean;
};

const clientsByIdentity = new Map<number, Set<SseClient>>();

export type V2Event =
  | { kind: "message"; conversationId: number; from: number }
  | { kind: "typing"; conversationId: number; from: number }
  | { kind: "read"; conversationId: number; reader: number }
  | { kind: "presence"; number: string; online: boolean; lastSeenAt: string }
  | { kind: "contact"; from: number }
  | {
      kind: "call_offer";
      fromNumber: string;
      fromName: string;
      roomId: string;
    }
  /** Call-back alert (v2.88): a number the user watched is back online. */
  | { kind: "watched_online"; number: string; name: string }
  /** Status realtime (v2.96): someone in your feed posted (or removed) a
   *  status — refresh rings/feed instantly; toast only when `removed` unset. */
  | { kind: "status"; number: string; name: string; removed?: boolean }
  /** New-device approval (v2.99.7): a new sign-in on this account is WAITING
   *  for one of the existing devices to approve it — light up the bell. */
  | { kind: "device_pending"; sid: string; label: string }
  | { kind: "ping" };

function writeEvent(client: SseClient, ev: V2Event) {
  if (client.closed) return;
  // Guard the window where the underlying socket has already died but our
  // `close`/`aborted` cleanup hasn't fired yet to flip `client.closed`. These
  // are fast synchronous checks; writing to a destroyed/ended response would
  // otherwise throw (caught below) or, worse, buffer against a dead socket.
  if (client.res.destroyed || client.res.writableEnded) {
    client.closed = true;
    return;
  }
  try {
    client.res.write(`data: ${JSON.stringify(ev)}\n\n`);
  } catch {
    client.closed = true;
  }
}

/** Deliver to THIS instance's streams only (no cross-instance publish). */
function deliverLocal(identityId: number, ev: V2Event) {
  const set = clientsByIdentity.get(identityId);
  if (!set || set.size === 0) return;
  set.forEach((c) => writeEvent(c, ev));
}

/** Wire payload for the `relay:v2ev` Redis channel: targets + event.
 *  `t` is a list of identity ids, or "*" for every connected stream. */
type BusV2Payload = { t: number[] | "*"; ev: V2Event };

/** Handle a foreign instance's envelope payload (exported for tests; own
 *  envelopes never reach here — redisBus drops them by instance id). */
export function _handleBusV2Event(payload: unknown): void {
  const p = payload as Partial<BusV2Payload> | null;
  if (!p || typeof p !== "object") return;
  const ev = p.ev as V2Event | undefined;
  if (!ev || typeof ev !== "object" || typeof (ev as { kind?: unknown }).kind !== "string")
    return;
  if (p.t === "*") {
    clientsByIdentity.forEach((set) => set.forEach((c) => writeEvent(c, ev)));
    return;
  }
  if (!Array.isArray(p.t)) return;
  for (const id of p.t) {
    if (typeof id === "number" && Number.isFinite(id)) deliverLocal(id, ev);
  }
}

export function publishToIdentity(identityId: number, ev: V2Event) {
  // Local first, THEN the bus — subscribers skip our envelope by instance id,
  // so local streams get exactly one copy (see redisBus loop-safety).
  deliverLocal(identityId, ev);
  publishBus(V2EV_CHANNEL, { t: [identityId], ev } satisfies BusV2Payload);
}

export function broadcastPresence(
  number: string,
  online: boolean,
  lastSeenAt: Date | string
): void {
  const payload: V2Event = {
    kind: "presence",
    number,
    online,
    lastSeenAt:
      lastSeenAt instanceof Date ? lastSeenAt.toISOString() : lastSeenAt,
  };
  // Fan out to all currently-open streams. Presence is small/cheap.
  clientsByIdentity.forEach((set) => {
    set.forEach((c) => writeEvent(c, payload));
  });
  publishBus(V2EV_CHANNEL, { t: "*", ev: payload } satisfies BusV2Payload);
}

/**
 * Scoped presence push: deliver a presence event ONLY to the given audience
 * (contacts + conversation peers), instead of every connected client. This is
 * what `broadcastPresence` should have been — it stops leaking every user's
 * number and online/offline state to strangers.
 */
export function publishPresenceTo(
  audienceIds: number[],
  number: string,
  online: boolean,
  lastSeenAt: Date | string
): void {
  if (audienceIds.length === 0) return;
  const payload: V2Event = {
    kind: "presence",
    number,
    online,
    lastSeenAt:
      lastSeenAt instanceof Date ? lastSeenAt.toISOString() : lastSeenAt,
  };
  // Local delivery for every audience member on THIS instance, then ONE bus
  // envelope carrying the whole audience for the other instances.
  audienceIds.forEach((id) => deliverLocal(id, payload));
  publishBus(V2EV_CHANNEL, { t: audienceIds, ev: payload } satisfies BusV2Payload);
}

/**
 * Mount the SSE endpoint. The client subscribes via:
 *   const es = new EventSource("/api/v2/events", { withCredentials: true });
 * and listens for the `message` event in JS (browser default — the data
 * payload contains a `kind` we use as discriminator).
 */
export function registerV2Events(app: Express): void {
  // Horizontal scale (v2.91): receive other instances' v2 events. No-op
  // subscription bookkeeping when REDIS_URL is unset.
  subscribeBus(V2EV_CHANNEL, _handleBusV2Event);
  // ── abuse hardening (v2.88, mirrors /api/relay/stream) ──
  // Open-rate + concurrent-stream caps per IP; RELAY_RATELIMIT_OFF honors the
  // same kill switch as the relay limiters. Each open stream pins a socket +
  // heartbeat timer, so unbounded anonymous opens can exhaust the instance.
  const rateLimitOff = () => process.env.RELAY_RATELIMIT_OFF === "1";
  const openLimiter = createRateLimiter({ capacity: 30, refillPerSec: 1 });
  setInterval(() => openLimiter.sweep(Date.now(), 10 * 60_000), 10 * 60_000).unref();
  const MAX_STREAMS_PER_IP = 25;
  const streamsPerIp = new Map<string, number>();

  app.get("/api/v2/events", async (req: Request, res: Response) => {
    const ip = clientIpOf(req);
    if (!rateLimitOff()) {
      if (!openLimiter.allow(ip, Date.now())) {
        res.status(429).json({ error: "rate_limited" });
        return;
      }
      if ((streamsPerIp.get(ip) ?? 0) >= MAX_STREAMS_PER_IP) {
        res.status(429).json({ error: "too_many_streams" });
        return;
      }
    }
    // Resolve identity via the same context resolver so guest cookies work.
    let identityId: number | null = null;
    try {
      const ctx = await createContext({ req, res } as Parameters<
        typeof createContext
      >[0]);
      identityId = ctx.identity?.id ?? null;
    } catch {
      identityId = null;
    }

    if (!identityId) {
      // We still keep the stream open for 1 round-trip so EventSource
      // doesn't reconnect-storm; just signal no-auth and close.
      res.status(401);
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-store");
      res.write(`data: ${JSON.stringify({ kind: "ping" })}\n\n`);
      res.end();
      return;
    }

    // SSE response headers. Disable buffering through any intermediary.
    res.status(200);
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-store, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    // Initial hello so the client knows the stream is alive.
    res.write(`: connected\n\n`);
    res.write(`data: ${JSON.stringify({ kind: "ping" })}\n\n`);

    const client: SseClient = { res, identityId, closed: false };
    let set = clientsByIdentity.get(identityId);
    if (!set) {
      set = new Set();
      clientsByIdentity.set(identityId, set);
    }
    set.add(client);

    // Count the stream against its IP; released exactly once in cleanup().
    streamsPerIp.set(ip, (streamsPerIp.get(ip) ?? 0) + 1);
    let counted = true;
    const uncountStream = () => {
      if (!counted) return;
      counted = false;
      const n = (streamsPerIp.get(ip) ?? 1) - 1;
      if (n <= 0) streamsPerIp.delete(ip);
      else streamsPerIp.set(ip, n);
    };

    // Heartbeat every 25s — keeps proxies from closing the idle conn.
    const hb = setInterval(() => {
      if (client.closed) return;
      try {
        res.write(`: hb\n\n`);
      } catch {
        client.closed = true;
      }
    }, 25_000);
    // Tag the timer as non-blocking for process exit.
    (hb as unknown as { unref?: () => void }).unref?.();

    const cleanup = () => {
      client.closed = true;
      clearInterval(hb);
      uncountStream();
      const s = clientsByIdentity.get(identityId!);
      if (s) {
        s.delete(client);
        if (s.size === 0) clientsByIdentity.delete(identityId!);
      }
    };
    req.on("close", cleanup);
    req.on("aborted", cleanup);
    res.on("close", cleanup);
  });
}

/** Test helper — attach a fake SSE client for an identity; returns cleanup.
 *  Lets bus-delivery tests observe real writeEvent output without an HTTP
 *  server (same spirit as relay's _setActiveRegistryForTests). */
export function _addSseClientForTests(
  identityId: number,
  res: Pick<Response, "write"> & { destroyed?: boolean; writableEnded?: boolean }
): () => void {
  const client: SseClient = { res: res as Response, identityId, closed: false };
  let set = clientsByIdentity.get(identityId);
  if (!set) {
    set = new Set();
    clientsByIdentity.set(identityId, set);
  }
  set.add(client);
  return () => {
    client.closed = true;
    const s = clientsByIdentity.get(identityId);
    if (s) {
      s.delete(client);
      if (s.size === 0) clientsByIdentity.delete(identityId);
    }
  };
}

/** Test helper — returns current connected-identity count. */
export function _connectedCount(): number {
  let total = 0;
  clientsByIdentity.forEach((s) => {
    total += s.size;
  });
  return total;
}

// Silence unused-import warning if GUEST_COOKIE ends up unused after refactor.
void GUEST_COOKIE;
