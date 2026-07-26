/**
 * LIVE NETWORK STATS, PUSHED (v2.99.71).
 *
 * Owner: "the statistics of number of users, active users, messages, calls — the
 * one on the main page and on the login page — it should be dynamic. While I'm
 * seeing the page, if somebody logs in, it will automatically update. No need for
 * me to refresh the page."
 *
 * WHAT WAS ALREADY TRUE, AND WHAT WAS NOT
 * ---------------------------------------
 * All five figures were already read live from the database (six COUNT(*)s in
 * `getPublicStats`, no cache), and both surfaces already refreshed without a
 * reload. What was missing was IMMEDIACY and it cost real money: the landing page
 * polled every 30s with `refetchOnWindowFocus` OFF — so a visitor could sit looking
 * at numbers half a minute stale, and returning to the tab did not refresh them —
 * while the sign-in screen polled every 15s. Worse, polling scales the wrong way:
 * every viewer independently ran six COUNT(*)s, one of them over `messages`, the
 * largest table in the schema.
 *
 * THE SHAPE, AND WHY IT IS CHEAPER THAN WHAT IT REPLACES
 * -----------------------------------------------------
 * One computation per instance, shared by every viewer, pushed over SSE. Ten
 * thousand people watching the landing page now cost exactly what one person costs.
 * Two further properties keep it honest:
 *
 *   1. TWO CADENCES. `onlineNow` is the number the owner actually named — it is the
 *      one that moves when somebody signs in — and it is cheap: `presence` carries
 *      `presence_isOnline_idx`, so counting it is an index scan over a small table.
 *      It refreshes every 2s. The other four barely move and are expensive, so they
 *      refresh every 20s. Recomputing a COUNT(*) over `messages` every two seconds
 *      to watch a number that changes hourly would be indefensible.
 *
 *   2. NOTHING RUNS WHEN NOBODY IS WATCHING. The timers start on the first
 *      subscriber and stop on the last, so an idle instance does no database work at
 *      all — which is exactly the property the old per-visitor polling had, and it
 *      would have been easy to lose here.
 *
 * Frames are sent only when a number CHANGES, so a quiet network costs a heartbeat
 * comment every 25s and nothing else.
 *
 * The stream is deliberately PUBLIC and unauthenticated, like the `stats.public`
 * procedure it mirrors: it carries aggregate counts and nothing else — never a name,
 * a number, or an identity. It is capped per IP the same way the other anonymous
 * streams are, because each open stream pins a socket and a heartbeat timer.
 */

import type { Express, Request, Response } from "express";
import { createRateLimiter, clientIpOf } from "./rateLimit";
import {
  getPublicStats,
  getOnlineCount,
  setPresenceChangeHook,
  type PublicStats,
} from "./v2db";

/**
 * Cadences. Overridable ONLY so the behavioural tests can drive real ticks in
 * milliseconds instead of sleeping for seconds and hoping — a timing-raced test is
 * a flaky test, and this feature's whole claim is about what happens on a tick.
 * Both are clamped, so a bad value cannot turn the feed into a busy loop against the
 * database; unset means the production cadence.
 */
const envMs = (name: string, dflt: number, min: number): number => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= min ? n : dflt;
};
/** How often the cheap, fast-moving figure is recomputed while anyone is watching. */
const FAST_MS = envMs("RELAY_STATS_FAST_MS", 2_000, 25);
/** How often the expensive totals are recomputed. */
const SLOW_MS = envMs("RELAY_STATS_SLOW_MS", 20_000, 50);
/** Proxy keep-alive. Matches /api/v2/events. */
const HEARTBEAT_MS = 25_000;
/**
 * Reconnect pacing handed to EventSource. Without it, a browser that hits the cap
 * (or a restarting instance) retries on the default ~3s, and a crowd of landing-page
 * visitors becomes a reconnect storm against the endpoint that is already saying no.
 */
const CLIENT_RETRY_MS = 15_000;

type Client = { res: Response; closed: boolean };

const clients = new Set<Client>();
let snapshot: PublicStats | null = null;
let fastTimer: ReturnType<typeof setInterval> | null = null;
let slowTimer: ReturnType<typeof setInterval> | null = null;

function sameStats(a: PublicStats | null, b: PublicStats | null): boolean {
  if (!a || !b) return false;
  return (
    a.registeredUsers === b.registeredUsers &&
    a.guestsServed === b.guestsServed &&
    a.totalParties === b.totalParties &&
    a.messagesSent === b.messagesSent &&
    a.onlineNow === b.onlineNow
  );
}

function writeTo(client: Client, payload: string): void {
  if (client.closed) return;
  try {
    client.res.write(payload);
  } catch {
    // A dead socket that has not fired 'close' yet. Mark it and let the next
    // sweep drop it rather than throwing inside a broadcast loop.
    client.closed = true;
  }
}

/** Push the current snapshot to everyone. Called only when something changed. */
function broadcast(): void {
  if (!snapshot) return;
  const frame = `data: ${JSON.stringify({ kind: "stats", ...snapshot })}\n\n`;
  // `forEach`, not `for…of`: tsconfig sets no `target`, so it compiles as ES5 where
  // iterating a Set is a type error (TS2802). This is the trap that broke CI in
  // v2.99.49 — `pnpm build` uses esbuild and does not typecheck, so only
  // `pnpm check` catches it.
  clients.forEach(c => writeTo(c, frame));
}

/**
 * Recompute and broadcast if anything moved.
 *
 * `full` recomputes all five; otherwise only `onlineNow` is re-read and merged over
 * the existing snapshot. Every failure is swallowed: this feed is decoration on a
 * marketing page, and a database hiccup must never take a page down or kill the
 * stream — the previous snapshot simply stands until the next tick.
 */
async function refresh(full: boolean): Promise<void> {
  if (clients.size === 0) return;
  try {
    let next: PublicStats | null;
    if (full || !snapshot) {
      next = await getPublicStats();
    } else {
      const online = await getOnlineCount();
      // A failed read returns null rather than 0 — reporting "0 online" because a
      // query blipped would be a visible lie on the front page.
      next = online == null ? snapshot : { ...snapshot, onlineNow: online };
    }
    if (!next) return;
    if (sameStats(snapshot, next)) return;
    snapshot = next;
    broadcast();
  } catch {
    /* keep the last good snapshot */
  }
}

/**
 * Something happened that moves a number — refresh NOW rather than on the next tick
 * (v2.99.72; owner: "make it live, not after 30 seconds").
 *
 * The 2s tick already made the figures feel live, but a tick is still a tick: signing
 * in could take up to two seconds to show. The events that move these numbers are all
 * known to the server, so it can just say so.
 *
 * COALESCED, and that is the load-bearing part. Presence writes arrive in bursts — a
 * heartbeat sweep, a call ending, a reaper pass — and one database read per event
 * would be far worse than the polling this replaced. A poke schedules at most one read
 * per `POKE_COALESCE_MS`, so a hundred people signing in at once costs the same as one.
 * Cheap by construction too: a poke only ever re-reads `onlineNow`, never the
 * full-table counts.
 *
 * A no-op when nobody is watching, so an idle instance stays idle.
 */
const POKE_COALESCE_MS = 150;
let pokeTimer: ReturnType<typeof setTimeout> | null = null;
export function pokeStatsFeed(): void {
  if (clients.size === 0 || pokeTimer) return;
  pokeTimer = setTimeout(() => {
    pokeTimer = null;
    void refresh(false);
  }, POKE_COALESCE_MS);
  (pokeTimer as unknown as { unref?: () => void }).unref?.();
}

/** Start the shared timers on the first subscriber. */
function startTimers(): void {
  if (fastTimer) return;
  fastTimer = setInterval(() => void refresh(false), FAST_MS);
  slowTimer = setInterval(() => void refresh(true), SLOW_MS);
  (fastTimer as unknown as { unref?: () => void }).unref?.();
  (slowTimer as unknown as { unref?: () => void }).unref?.();
}

/** Stop them on the last unsubscribe, so an idle instance does no DB work. */
function stopTimers(): void {
  if (fastTimer) clearInterval(fastTimer);
  if (slowTimer) clearInterval(slowTimer);
  fastTimer = null;
  slowTimer = null;
}

export function registerStatsFeed(app: Express): void {
  // "Make it live, not after 30 seconds" (v2.99.72): every online/offline transition
  // pokes the feed, so the figure moves in ~150ms instead of waiting out a tick. The
  // tick stays as the backstop for the four expensive totals and for anything that
  // moves a number without touching presence.
  setPresenceChangeHook(pokeStatsFeed);
  const rateLimitOff = () => process.env.RELAY_RATELIMIT_OFF === "1";
  // Open-RATE is the flood defence; the concurrent cap bounds sockets held. Both
  // mirror /api/v2/events, including its reasoning about shared egress: a café or a
  // CGNAT block is one IP with many legitimate viewers.
  const openLimiter = createRateLimiter({ capacity: 30, refillPerSec: 1 });
  setInterval(() => openLimiter.sweep(Date.now(), 10 * 60_000), 10 * 60_000).unref();
  const MAX_STREAMS_PER_IP = 250;
  const streamsPerIp = new Map<string, number>();

  app.get("/api/stats/stream", async (req: Request, res: Response) => {
    const ip = clientIpOf(req);
    if (!rateLimitOff()) {
      if (!openLimiter.allow(ip, Date.now()) || (streamsPerIp.get(ip) ?? 0) >= MAX_STREAMS_PER_IP) {
        // Answer as a STREAM carrying a retry directive, not a bare JSON 429: an
        // EventSource ignores the body and reconnects on its own schedule, so the
        // only way to slow a refused client down is to tell it how long to wait.
        res.status(429);
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-store");
        res.write(`retry: ${CLIENT_RETRY_MS}\n`);
        res.write(`: rate limited\n\n`);
        res.end();
        return;
      }
    }

    res.status(200);
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-store, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();
    res.write(`retry: ${CLIENT_RETRY_MS}\n`);
    res.write(`: connected\n\n`);

    const client: Client = { res, closed: false };
    clients.add(client);
    streamsPerIp.set(ip, (streamsPerIp.get(ip) ?? 0) + 1);
    startTimers();

    // Seed this viewer immediately. A brand-new stream must not wait up to 20s for
    // its first numbers — that would look exactly like the staleness being fixed.
    if (snapshot) {
      writeTo(client, `data: ${JSON.stringify({ kind: "stats", ...snapshot })}\n\n`);
    } else {
      void (async () => {
        try {
          const first = await getPublicStats();
          if (!snapshot) snapshot = first;
          // Broadcast rather than write to this client alone: any stream that
          // opened alongside this one is waiting on the same first read.
          broadcast();
        } catch {
          /* the timers will try again */
        }
      })();
    }

    const hb = setInterval(() => {
      if (client.closed) return;
      writeTo(client, `: hb\n\n`);
    }, HEARTBEAT_MS);
    (hb as unknown as { unref?: () => void }).unref?.();

    let released = false;
    const cleanup = () => {
      if (released) return;
      released = true;
      client.closed = true;
      clearInterval(hb);
      clients.delete(client);
      const n = (streamsPerIp.get(ip) ?? 1) - 1;
      if (n <= 0) streamsPerIp.delete(ip);
      else streamsPerIp.set(ip, n);
      if (clients.size === 0) stopTimers();
      try {
        res.end();
      } catch {
        /* already gone */
      }
    };
    req.on("close", cleanup);
    req.on("aborted", cleanup);
    res.on("error", cleanup);
  });
}

/** Test/diagnostic view of the feed's internal state. */
export function statsFeedState(): {
  subscribers: number;
  timersRunning: boolean;
  snapshot: PublicStats | null;
} {
  return { subscribers: clients.size, timersRunning: fastTimer != null, snapshot };
}
