/**
 * Cross-instance call signaling (phase-2) — leader model. See
 * docs-cross-instance-signaling.md for the full design.
 *
 * RELAY's signaling registry (server/relay.ts) is in-memory per process, so two
 * users connected to different app instances can't ring each other. This module
 * lets the fleet run ONE elected "leader" instance that owns the whole registry
 * + handleMessage UNCHANGED, while every instance keeps serving load-balanced
 * SSE connections and proxies signaling to/from the leader over Redis.
 *
 * Gated on `RELAY_CLUSTER=1` AND `REDIS_URL`. Off ⇒ single-process behavior,
 * byte-identical to today (this whole module is dormant). Only `.io` (2 EC2 +
 * ALB) turns it on; `.org` (single Manus instance) never does.
 *
 * THIS FILE (phase 1) is the pure, unit-tested protocol core + the virtual
 * socket. The Redis election LOOP and the server/relay.ts wiring land in
 * phase 2 (guarded the same way), so nothing here is live yet.
 */
import Redis from "ioredis";
import type { RelaySocket } from "./relay";
import { INSTANCE_ID, publishBus, subscribeBus } from "./redisBus";
import { mintLeaderEpoch, setLeaderEpoch } from "./roomStore";

export { INSTANCE_ID };

/** Clustered signaling is ON only when explicitly enabled AND Redis is present.
 *  Read per-call (like every other RELAY feature gate) so it can be flipped via
 *  env without a rebuild. */
export function clusterEnabled(): boolean {
  return (
    Boolean(process.env.REDIS_URL) &&
    /^(1|true)$/i.test(process.env.RELAY_CLUSTER || "")
  );
}

/* ── Redis channel/key names (pure) ──────────────────────────────────────────
   in:<leader>  — proxies forward inbound signaling {cid, home, raw} to the leader
   out:<home>   — the leader publishes {cid, obj} for a home instance to write to
                  its local SSE response
   relay:leader — the leader-election lease key */
export const LEADER_KEY = "relay:leader";
export function sigInChannel(leaderId: string): string {
  return `relay:sig:in:${leaderId}`;
}
export function sigOutChannel(homeInstanceId: string): string {
  return `relay:sig:out:${homeInstanceId}`;
}
/** hb:<leader> — each home instance tells the leader, every beat, which cids it
 *  still holds an open SSE stream for (Round 11 part C). */
export function sigHbChannel(leaderId: string): string {
  return `relay:sig:hb:${leaderId}`;
}

/* ── Envelope encode/decode (pure) ───────────────────────────────────────────
   Directed channels (in:<leader>, out:<home>) already target one instance, so —
   unlike the fan-out bus — there is no self-drop; the frame is just JSON. Decode
   never throws (a malformed frame is dropped). */
export interface InboundFrame {
  /** Per-tab channel id the browser chose (relay `cid`). */
  cid: string;
  /** Instance the browser's SSE connection is homed on. */
  home: string;
  /** Raw signaling message: a `/api/relay/send` body, or a synthetic
   *  {type:"__register"|"__disconnect", ...} the proxy injects. */
  raw: unknown;
  /** v2.99.59 — set when the publisher is NOT the home: a `/api/relay/send`
   *  POST that the load balancer routed to an instance which does not hold this
   *  cid's SSE stream. The leader must then IGNORE `home` and route replies to
   *  the home it already recorded, because the publisher does not know it and
   *  must not be able to claim it. See the affinity note in relay.ts. */
  proxy?: boolean;
}
export interface OutboundFrame {
  /** Target browser's channel id. */
  cid: string;
  /** Object to write to that browser's SSE response. */
  obj: unknown;
}
/** Round 11 part C. One frame per instance per beat, not one per cid: the whole
 *  point is that a leader can tell a dead HOME from a quiet one, and instance
 *  liveness is an instance-level fact. Carrying the cid list in the same frame
 *  also re-announces connections to a leader that has just been elected and
 *  knows nothing — which is what closes the "leader change silently deregisters
 *  every browser" half of the finding. */
export interface HeartbeatFrame {
  home: string;
  cids: string[];
}

export function encodeFrame(frame: InboundFrame | OutboundFrame): string {
  return JSON.stringify(frame);
}
export function decodeInbound(raw: string): InboundFrame | null {
  try {
    const v = JSON.parse(raw);
    if (v && typeof v.cid === "string" && typeof v.home === "string" && "raw" in v) {
      return { cid: v.cid, home: v.home, raw: v.raw, proxy: v.proxy === true };
    }
  } catch {
    /* drop malformed */
  }
  return null;
}
export function decodeOutbound(raw: string): OutboundFrame | null {
  try {
    const v = JSON.parse(raw);
    if (v && typeof v.cid === "string" && "obj" in v) {
      return { cid: v.cid, obj: v.obj };
    }
  } catch {
    /* drop malformed */
  }
  return null;
}

/* ── Leader-lease decision (pure) ─────────────────────────────────────────────
   Extracted so the election logic is unit-testable without Redis. The loop
   around it just runs `SET relay:leader <self> NX PX <ttl>` (win → hold),
   renews while held, and reads the holder otherwise. */
export function isSelfLeader(leaseHolder: string | null, selfId: string): boolean {
  return leaseHolder === selfId;
}

/** Lease timings. TTL comfortably exceeds the renew interval so a brief renew
 *  delay never drops leadership; on a real leader death the lease expires within
 *  TTL and another instance wins. */
export const LEADER_TTL_MS = 9000;
export const LEADER_RENEW_MS = 3000;

/** How often a home tells the leader which cids it holds. */
export const HEARTBEAT_MS = 5000;
/** A home that has missed this much is presumed GONE; its cids are handed to the
 *  ordinary disconnect-grace path rather than being silently deregistered.
 *  Four missed beats — a leader must be slow to declare a peer dead, because the
 *  cost of being wrong is a dropped call. */
export const HEARTBEAT_STALE_MS = 20_000;
/** Upper bound on how long a newly-elected leader defers inbound signaling while
 *  it reads the room registry back from Redis. Past this it serves ANYWAY: a
 *  missing room degrades to "dial again / rejoin-recreate", whereas a wedged
 *  signaling layer means nobody can call at all. Fail open, deliberately. */
export const HYDRATE_TIMEOUT_MS = 5000;
/** Frames held during hydration. Far above any real burst (hydration is one
 *  Redis round trip per room); the cap exists so a pathological stall cannot
 *  grow the queue without bound. */
export const MAX_PENDING_INBOUND = 5000;

/* ── Virtual socket ──────────────────────────────────────────────────────────
   On the leader, every remotely-homed peer is represented by one of these. It
   satisfies the RelaySocket contract the registry/handleMessage expect, but
   instead of writing to a local SSE response, `send` hands the object to
   `deliver(cid, obj)` — which the phase-2 wiring implements as "publish to the
   peer's home instance's out channel". For a peer homed on the LEADER itself the
   wiring passes a `deliver` that writes the local SSE response directly (no
   Redis hop) — so co-located calls keep zero added latency.

   `alive` (Round 11 part C) is derived from the home instance's heartbeat: a home
   that is still beating vouches for its cids, one that stopped is presumed gone.
   It FAILS OPEN in the two directions that matter — an unknown cid, and a home
   that has never beaten AT ALL (an instance still running an older build during a
   rolling deploy) both report alive — because reporting a live browser as dead
   sends its calls to the leave-a-message card instead of ringing them. */
export function makeRemoteSocket(
  cid: string,
  deliver: (cid: string, obj: unknown) => void,
  onClose: (cid: string) => void,
  alive: (cid: string) => boolean = homeAlive
): RelaySocket {
  return {
    send: (obj: unknown) => deliver(cid, obj),
    close: () => onClose(cid),
    alive: () => alive(cid),
  };
}

/* ── Redis runtime (leader election + channel routing) ────────────────────────
   Kept below the pure section so the unit tests stay Redis-free. Reuses
   redisBus's publish/subscribe (envelope + self-drop) for the directed
   channels — safe because the same-instance case is ALWAYS short-circuited
   below, so a published frame's publisher is never also its recipient. A
   dedicated ioredis connection runs the leader lease. */

let leaseClient: Redis | null = null;
function getLeaseClient(): Redis | null {
  if (leaseClient) return leaseClient;
  if (!clusterEnabled()) return null;
  const r = new Redis(process.env.REDIS_URL as string, {
    retryStrategy: (times) => Math.min(30_000, 500 * 2 ** Math.min(times, 6)),
    maxRetriesPerRequest: 2,
    commandTimeout: 1500,
  });
  r.on("error", (e: unknown) =>
    console.warn("[relayCluster] lease:", e instanceof Error ? e.message : e)
  );
  leaseClient = r;
  return leaseClient;
}

let _isLeader = false;
let _leaderId: string | null = null;
let electionTimer: ReturnType<typeof setInterval> | null = null;

/* ── Round 11 state ──────────────────────────────────────────────────────── */
/** LEADER role: home instance id → last heartbeat received. An instance absent
 *  from this map has never beaten, which is the fail-open case. */
const instanceSeen = new Map<string, number>();
/** LEADER role: cid → the home that last vouched for it. */
const cidHome = new Map<string, string>();
/** True while a freshly-elected leader is reading rooms back from Redis. */
let _hydrating = false;
/** Frames that arrived during hydration, replayed in order once it finishes. */
const pendingInbound: Array<[string, string, unknown, boolean]> = [];
let leadershipInFlight = false;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
/** The leader we last told the app about, so a CHANGE can be acted on once. */
let announcedLeader: string | null = null;

/** True when THIS instance currently holds the signaling leadership lease. */
export function isLeader(): boolean {
  return _isLeader;
}
/** True while this (newly elected) leader is still hydrating and is deliberately
 *  not yet processing signaling. */
export function isHydrating(): boolean {
  return _hydrating;
}

/**
 * Round 11 part C. Is the browser behind `cid` still reachable? See the
 * fail-open rules on makeRemoteSocket — this is consulted by the invite path to
 * decide "ring" vs "they're offline", so a false negative is a lost call.
 */
export function homeAlive(cid: string, nowMs: number = Date.now()): boolean {
  const home = cidHome.get(cid);
  if (!home) return true;                     // never heard of it → assume alive
  if (home === INSTANCE_ID) return true;      // homed here; the local socket knows
  const seen = instanceSeen.get(home);
  if (seen === undefined) return true;        // that instance has never beaten
  return nowMs - seen < HEARTBEAT_STALE_MS;
}
/** Instance id believed to hold leadership (self, another, or null during a
 *  brief election gap). */
export function leaderId(): string | null {
  return _leaderId;
}

// Renew ONLY if we still hold the lease (never PEXPIRE a key we no longer own —
// that would let a split-brain second holder keep resetting the real leader's
// TTL). Atomic compare-and-pexpire.
const RENEW_LUA =
  "if redis.call('get',KEYS[1])==ARGV[1] then return redis.call('pexpire',KEYS[1],ARGV[2]) else return 0 end";

async function electTick(): Promise<void> {
  const c = getLeaseClient();
  if (!c) return;
  try {
    if (_isLeader) {
      const ok = await c.eval(RENEW_LUA, 1, LEADER_KEY, INSTANCE_ID, String(LEADER_TTL_MS));
      if (ok === 1) {
        _leaderId = INSTANCE_ID;
        noteLeader();
        return;
      }
      // Lost the lease (expired / taken over). Stop persisting IMMEDIATELY —
      // the fence epoch is what keeps a zombie leader from corrupting the room
      // records, and the cheapest way to honour it is to not write at all.
      _isLeader = false;
      setLeaderEpoch(0);
    }
    const won = await c.set(LEADER_KEY, INSTANCE_ID, "PX", LEADER_TTL_MS, "NX");
    if (won === "OK") {
      _isLeader = true;
      _leaderId = INSTANCE_ID;
      noteLeader();
      await beginLeadership();
      return;
    }
    _leaderId = (await c.get(LEADER_KEY)) ?? null;
    noteLeader();
  } catch {
    /* transient Redis error — retry next tick; never throw to callers */
  }
}

/**
 * Round 11 part A. Take up leadership: mint a fence epoch, then read the room
 * registry back from Redis BEFORE any signaling is processed. Inbound frames
 * queue meanwhile — a leader that answers `accept` for a room it has not
 * hydrated yet would tell the caller the call is gone.
 *
 * Every failure mode here degrades to "no persistence, serve anyway": that is
 * strictly today's behaviour, and refusing to serve would be worse than serving
 * without the safety net.
 */
async function beginLeadership(): Promise<void> {
  if (leadershipInFlight) return;
  leadershipInFlight = true;
  _hydrating = true;
  try {
    const ep = await mintLeaderEpoch();
    setLeaderEpoch(ep);
    if (_onHydrate) {
      await Promise.race([
        _onHydrate().catch(() => { /* hydration is best-effort */ }),
        new Promise<void>((resolve) => {
          const t = setTimeout(resolve, HYDRATE_TIMEOUT_MS);
          (t as { unref?: () => void }).unref?.();
        }),
      ]);
    }
  } catch {
    /* fall through to serving */
  } finally {
    leadershipInFlight = false;
    _hydrating = false;
    flushPendingInbound();
    // The browsers homed on THIS instance need re-registering just as much as
    // everyone else's: their client records lived in the DEAD leader's memory,
    // not here. `noteLeader` deliberately stays silent when the new leader is
    // us, so without this the instance that took over would repair every
    // browser in the fleet except its own. At boot there is nobody connected
    // yet, so it is a no-op there.
    try {
      _onLeaderChanged?.(INSTANCE_ID);
    } catch {
      /* never let a handover hook break the election loop */
    }
  }
}

function flushPendingInbound(): void {
  if (!_onInbound) {
    pendingInbound.length = 0;
    return;
  }
  const queued = pendingInbound.splice(0);
  for (const [cid, home, raw, proxy] of queued) {
    try {
      _onInbound(cid, home, raw, proxy);
    } catch {
      /* one bad frame must not strand the rest of the queue */
    }
  }
}

/** Dispatch or defer, depending on whether this leader is hydrated yet. */
function dispatchInbound(cid: string, home: string, raw: unknown, proxy: boolean): void {
  if (_hydrating) {
    if (pendingInbound.length < MAX_PENDING_INBOUND) pendingInbound.push([cid, home, raw, proxy]);
    return;
  }
  _onInbound?.(cid, home, raw, proxy);
}

/** Fire `onLeaderChanged` exactly once per observed change of leadership, and
 *  only for instances that are NOT the new leader — the leader repairs itself by
 *  hydrating; the homes repair themselves by re-announcing their browsers. */
function noteLeader(): void {
  const lid = _leaderId;
  if (!lid || lid === announcedLeader) return;
  const first = announcedLeader === null;
  announcedLeader = lid;
  if (lid === INSTANCE_ID) return;
  // A FIRST observation at boot is not a handover — nothing was attached to the
  // old leader, so waking every browser would be noise.
  if (first) return;
  try {
    _onLeaderChanged?.(lid);
  } catch {
    /* never let a handover hook break the election loop */
  }
}

let started = false;
let _onInbound:
  | ((cid: string, home: string, raw: unknown, proxy: boolean) => void)
  | null = null;
let _onOutbound: ((cid: string, obj: unknown) => void) | null = null;
let _onHydrate: (() => Promise<void>) | null = null;
let _onLeaderChanged: ((newLeaderId: string) => void) | null = null;
let _liveCids: (() => string[]) | null = null;
let _onHomeLost: ((cids: string[]) => void) | null = null;

/**
 * Start the cluster runtime (idempotent). `onInbound` runs a forwarded signaling
 * frame on the LEADER (server/relay.ts wires it to leaderProcess); `onOutbound`
 * writes a leader-routed object to THIS home's local SSE socket. No-op unless
 * clusterEnabled().
 */
export function startClusterRuntime(deps: {
  onInbound: (cid: string, home: string, raw: unknown, proxy: boolean) => void;
  onOutbound: (cid: string, obj: unknown) => void;
  /** LEADER role (Round 11 A): read the room registry back from Redis. Awaited
   *  before any signaling is processed. */
  onHydrate?: () => Promise<void>;
  /** HOME role (Round 11 C): leadership moved to `newLeaderId`. The new leader
   *  has our rooms (hydrated) but not our clients, so the browsers homed here
   *  must re-register. */
  onLeaderChanged?: (newLeaderId: string) => void;
  /** HOME role: cids with a live local SSE stream, published each heartbeat. */
  liveCids?: () => string[];
  /** LEADER role (Round 11 C): a home instance stopped beating; its browsers get
   *  the ordinary disconnect-grace treatment instead of vanishing. */
  onHomeLost?: (cids: string[]) => void;
}): void {
  if (!clusterEnabled() || started) return;
  started = true;
  _onInbound = deps.onInbound;
  _onOutbound = deps.onOutbound;
  _onHydrate = deps.onHydrate ?? null;
  _onLeaderChanged = deps.onLeaderChanged ?? null;
  _liveCids = deps.liveCids ?? null;
  _onHomeLost = deps.onHomeLost ?? null;

  // As a HOME: deliver frames the leader routed to us.
  subscribeBus(sigOutChannel(INSTANCE_ID), (payload) => {
    const f = payload as OutboundFrame | null;
    if (f && typeof f.cid === "string") _onOutbound?.(f.cid, f.obj);
  });
  // As the LEADER: record which browsers each home still holds (Round 11 C).
  subscribeBus(sigHbChannel(INSTANCE_ID), (payload, fromInstance) => {
    if (!_isLeader) return;
    const f = payload as HeartbeatFrame | null;
    if (!f || typeof f.home !== "string" || !Array.isArray(f.cids)) return;
    // Same anti-spoof rule as the inbound channel (v2.99.49): a publisher may
    // only vouch for ITSELF. Otherwise one instance could declare another's
    // browsers alive (or, by omission, dead).
    if (f.home !== fromInstance) return;
    instanceSeen.set(f.home, Date.now());
    for (const cid of f.cids) {
      if (typeof cid !== "string" || !cid) continue;
      const known = cidHome.get(cid);
      cidHome.set(cid, f.home);
      // A cid this leader has never seen is a browser that was attached to the
      // PREVIOUS leader. Adopting it here is what makes a leader change a
      // handover rather than a mass deregistration.
      if (known === undefined) dispatchInbound(cid, f.home, { type: "__connect" }, false);
    }
  });
  // As the LEADER: process frames homes forwarded to us. Guarded on _isLeader so
  // a former leader (lease lost, mid-transition) can't mutate registry state.
  subscribeBus(sigInChannel(INSTANCE_ID), (payload, fromInstance) => {
    if (!_isLeader) return;
    const f = payload as InboundFrame | null;
    if (!f || typeof f.cid !== "string" || typeof f.home !== "string") return;
    // A publisher may only claim ITSELF as the frame's home (v2.99.49). This
    // closes the other half of the bus residual — the leader used to trust a
    // bus-forwarded `home`, so a forged frame could make it route a client's
    // signaling to an instance of the attacker's choosing. Deploy-safe with no
    // flag: `clusterForwardInbound` always sets home = INSTANCE_ID and publishBus
    // stamps the same value as the envelope's `i`, and the same-instance case
    // short-circuits before publishing — so the equality already holds for OLD
    // publishers too.
    if (f.home !== fromInstance) return;
    // Keep the liveness index current from real traffic too, not just beats: a
    // browser that just sent a signaling message is demonstrably alive.
    cidHome.set(f.cid, f.home);
    instanceSeen.set(f.home, Date.now());
    dispatchInbound(f.cid, f.home, f.raw, f.proxy === true);
  });

  void electTick();
  electionTimer = setInterval(() => void electTick(), LEADER_RENEW_MS);
  electionTimer.unref?.();
  heartbeatTimer = setInterval(heartbeatTick, HEARTBEAT_MS);
  heartbeatTimer.unref?.();
}

/**
 * One beat. As a HOME: tell the current leader which browsers we still hold. As
 * the LEADER: sweep for homes that stopped beating and hand their browsers to
 * the ordinary disconnect-grace path.
 */
export function heartbeatTick(nowMs: number = Date.now()): void {
  const cids = _liveCids?.() ?? [];
  if (_isLeader) {
    // Homed here: no publish needed, we ARE the leader; just keep the index warm
    // so `homeAlive` never mistakes a locally-homed browser for a remote one.
    for (const cid of cids) cidHome.set(cid, INSTANCE_ID);
    instanceSeen.set(INSTANCE_ID, nowMs);
    sweepLostHomes(nowMs);
  } else if (_leaderId) {
    publishBus(sigHbChannel(_leaderId), { home: INSTANCE_ID, cids } as HeartbeatFrame);
  }
}

function sweepLostHomes(nowMs: number): void {
  const lost: string[] = [];
  instanceSeen.forEach((seen, home) => {
    if (home === INSTANCE_ID) return;
    if (nowMs - seen < HEARTBEAT_STALE_MS) return;
    lost.push(home);
  });
  if (!lost.length) return;
  for (const home of lost) {
    instanceSeen.delete(home);
    const orphans: string[] = [];
    cidHome.forEach((h, cid) => {
      if (h === home) orphans.push(cid);
    });
    for (const cid of orphans) cidHome.delete(cid);
    if (orphans.length) {
      console.warn(`[relayCluster] home ${home.slice(0, 8)} stopped beating; ${orphans.length} stream(s) enter disconnect grace`);
      try {
        _onHomeLost?.(orphans);
      } catch {
        /* never let cleanup break the beat */
      }
    }
  }
}

/** Test/shutdown hook — stop the election loop and reset state. */
export function stopClusterRuntime(): void {
  if (electionTimer) {
    clearInterval(electionTimer);
    electionTimer = null;
  }
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  started = false;
  _isLeader = false;
  _leaderId = null;
  _onInbound = null;
  _onOutbound = null;
  _onHydrate = null;
  _onLeaderChanged = null;
  _liveCids = null;
  _onHomeLost = null;
  _hydrating = false;
  leadershipInFlight = false;
  announcedLeader = null;
  pendingInbound.length = 0;
  instanceSeen.clear();
  cidHome.clear();
  setLeaderEpoch(0);
}

/** HOME → LEADER. A raw signaling message (or synthetic __connect/__disconnect)
 *  from a browser homed on THIS instance, routed to the current leader. When we
 *  ARE the leader, dispatched locally (no Redis hop). */
/**
 * RENUMBER → LEADER (v2.99.83).
 *
 * The signaling registry lives ONLY on the elected leader, but a renumber can be
 * served by any instance, so applying the rebind locally on a follower is a silent
 * no-op — the person stays registered under their old pin on the box that actually
 * routes calls.
 *
 * Rides the inbound signaling channel with a synthetic frame type rather than a new
 * channel: those frames are cid-addressed and a renumber has no cid, so a sentinel
 * is passed and the payload travels in `raw`. Two properties come free and both are
 * wanted — the frame queues behind the leader's HYDRATION GATE (a rebind arriving
 * mid-hydration is applied after it, which is required because hydration would
 * otherwise restore the old pin on top of the rename), and the envelope is HMAC'd
 * like every other bus frame.
 *
 * `home` must be our own instance id or the leader's anti-spoof check drops the
 * frame. It carries no reply path, so the value is informational — but it still has
 * to be correct.
 */
export function clusterForwardRenumber(e: {
  identityId: number;
  oldNumber: string;
  newNumber: string;
}): void {
  const raw = { type: "__renumber", ...e };
  if (_isLeader) {
    // Sentinel cid: nothing addresses a connection here, and `dispatchInbound`
    // only uses it for the home map, which a renumber never reads.
    dispatchInbound("__renumber", INSTANCE_ID, raw, false);
    return;
  }
  const lid = _leaderId;
  // No leader known yet: drop it. The client-side self-heal converges anyway, and
  // buffering a rename to replay against an unknown future registry would be worse
  // than not doing it.
  if (!lid) return;
  publishBus(sigInChannel(lid), { cid: "__renumber", home: INSTANCE_ID, raw } as InboundFrame);
}

export function clusterForwardInbound(cid: string, raw: unknown): void {
  if (_isLeader) {
    cidHome.set(cid, INSTANCE_ID);
    dispatchInbound(cid, INSTANCE_ID, raw, false);
    return;
  }
  const lid = _leaderId;
  if (!lid) return; // no leader known yet — the client resends on its next beat
  publishBus(sigInChannel(lid), { cid, home: INSTANCE_ID, raw } as InboundFrame);
}

/** NOT-THE-HOME → LEADER (v2.99.59). A `/api/relay/send` POST that the load
 *  balancer routed to an instance holding no SSE stream for this cid. We cannot
 *  answer it locally and we do NOT know (or get to assert) where the stream
 *  lives — the leader looks the home up in its own map. Without this the POST
 *  was answered 404 and the signaling message was simply lost; measured against
 *  production, a two-instance ALB with no affinity lost HALF of them. */
export function clusterProxyInbound(cid: string, raw: unknown): void {
  if (_isLeader) {
    // Deliberately NOT recording cidHome here: a proxied frame comes from an
    // instance that does NOT hold the stream, so it is no evidence of where the
    // browser lives (the same reason leaderProcess ignores its claimed `home`).
    dispatchInbound(cid, INSTANCE_ID, raw, true);
    return;
  }
  const lid = _leaderId;
  if (!lid) return;
  publishBus(sigInChannel(lid), { cid, home: INSTANCE_ID, raw, proxy: true } as InboundFrame);
}

/** LEADER → HOME. An object the leader's registry produced for a peer, routed to
 *  the instance that peer is homed on. When the home IS the leader, delivered
 *  locally (no Redis hop). */
export function clusterDeliverOutbound(home: string, cid: string, obj: unknown): void {
  if (home === INSTANCE_ID) {
    _onOutbound?.(cid, obj);
    return;
  }
  publishBus(sigOutChannel(home), { cid, obj } as OutboundFrame);
}

/** Test seam: force leadership state (used by the in-process integration test to
 *  drive two registries without a real Redis election). NOT used in production. */
export function _setLeaderForTest(isLeaderNow: boolean, leader: string | null): void {
  _isLeader = isLeaderNow;
  _leaderId = leader;
  announcedLeader = leader;
}

/** Test seam: record a heartbeat as if `home` had published one. */
export function _noteHeartbeatForTest(home: string, cids: string[], atMs = Date.now()): void {
  instanceSeen.set(home, atMs);
  for (const cid of cids) cidHome.set(cid, home);
}
/** Test seam: run the leader's lost-home sweep at a chosen wall clock. */
export function _sweepLostHomesForTest(nowMs: number): void {
  sweepLostHomes(nowMs);
}
/** Test seam: wire the runtime's hooks without a Redis election, so the
 *  leadership transition itself can be driven and observed. */
export function _wireHooksForTest(deps: {
  onInbound?: (cid: string, home: string, raw: unknown, proxy: boolean) => void;
  onHydrate?: () => Promise<void>;
  onLeaderChanged?: (newLeaderId: string) => void;
  onHomeLost?: (cids: string[]) => void;
  liveCids?: () => string[];
}): void {
  if (deps.onInbound) _onInbound = deps.onInbound;
  if (deps.onHydrate) _onHydrate = deps.onHydrate;
  if (deps.onLeaderChanged) _onLeaderChanged = deps.onLeaderChanged;
  if (deps.onHomeLost) _onHomeLost = deps.onHomeLost;
  if (deps.liveCids) _liveCids = deps.liveCids;
}
/** Test seam: run the take-up-leadership sequence (mint epoch → hydrate →
 *  release the gate → resync our own browsers) exactly as electTick does. */
export async function _beginLeadershipForTest(): Promise<void> {
  _isLeader = true;
  _leaderId = INSTANCE_ID;
  await beginLeadership();
}
/** Test seam: drive the hydration gate without a Redis election. */
export function _setHydratingForTest(on: boolean): void {
  _hydrating = on;
  if (!on) flushPendingInbound();
}
/** Test seam: how many frames are parked behind the hydration gate. */
export function _pendingInboundCountForTest(): number {
  return pendingInbound.length;
}
