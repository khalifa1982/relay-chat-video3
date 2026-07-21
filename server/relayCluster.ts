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
}
export interface OutboundFrame {
  /** Target browser's channel id. */
  cid: string;
  /** Object to write to that browser's SSE response. */
  obj: unknown;
}

export function encodeFrame(frame: InboundFrame | OutboundFrame): string {
  return JSON.stringify(frame);
}
export function decodeInbound(raw: string): InboundFrame | null {
  try {
    const v = JSON.parse(raw);
    if (v && typeof v.cid === "string" && typeof v.home === "string" && "raw" in v) {
      return { cid: v.cid, home: v.home, raw: v.raw };
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

/* ── Virtual socket ──────────────────────────────────────────────────────────
   On the leader, every remotely-homed peer is represented by one of these. It
   satisfies the RelaySocket contract the registry/handleMessage expect, but
   instead of writing to a local SSE response, `send` hands the object to
   `deliver(cid, obj)` — which the phase-2 wiring implements as "publish to the
   peer's home instance's out channel". For a peer homed on the LEADER itself the
   wiring passes a `deliver` that writes the local SSE response directly (no
   Redis hop) — so co-located calls keep zero added latency.

   `alive` is reported by the home instance via periodic liveness in the inbound
   stream; absent ⇒ assumed alive (matches the RelaySocket contract), so the
   invite path's dead-socket paging still works once phase 2 feeds liveness. */
export function makeRemoteSocket(
  cid: string,
  deliver: (cid: string, obj: unknown) => void,
  onClose: (cid: string) => void
): RelaySocket {
  return {
    send: (obj: unknown) => deliver(cid, obj),
    close: () => onClose(cid),
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

/** True when THIS instance currently holds the signaling leadership lease. */
export function isLeader(): boolean {
  return _isLeader;
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
        return;
      }
      _isLeader = false; // lost the lease (expired / taken over)
    }
    const won = await c.set(LEADER_KEY, INSTANCE_ID, "PX", LEADER_TTL_MS, "NX");
    if (won === "OK") {
      _isLeader = true;
      _leaderId = INSTANCE_ID;
      return;
    }
    _leaderId = (await c.get(LEADER_KEY)) ?? null;
  } catch {
    /* transient Redis error — retry next tick; never throw to callers */
  }
}

let started = false;
let _onInbound: ((cid: string, home: string, raw: unknown) => void) | null = null;
let _onOutbound: ((cid: string, obj: unknown) => void) | null = null;

/**
 * Start the cluster runtime (idempotent). `onInbound` runs a forwarded signaling
 * frame on the LEADER (server/relay.ts wires it to leaderProcess); `onOutbound`
 * writes a leader-routed object to THIS home's local SSE socket. No-op unless
 * clusterEnabled().
 */
export function startClusterRuntime(deps: {
  onInbound: (cid: string, home: string, raw: unknown) => void;
  onOutbound: (cid: string, obj: unknown) => void;
}): void {
  if (!clusterEnabled() || started) return;
  started = true;
  _onInbound = deps.onInbound;
  _onOutbound = deps.onOutbound;

  // As a HOME: deliver frames the leader routed to us.
  subscribeBus(sigOutChannel(INSTANCE_ID), (payload) => {
    const f = payload as OutboundFrame | null;
    if (f && typeof f.cid === "string") _onOutbound?.(f.cid, f.obj);
  });
  // As the LEADER: process frames homes forwarded to us. Guarded on _isLeader so
  // a former leader (lease lost, mid-transition) can't mutate registry state.
  subscribeBus(sigInChannel(INSTANCE_ID), (payload) => {
    if (!_isLeader) return;
    const f = payload as InboundFrame | null;
    if (f && typeof f.cid === "string" && typeof f.home === "string")
      _onInbound?.(f.cid, f.home, f.raw);
  });

  void electTick();
  electionTimer = setInterval(() => void electTick(), LEADER_RENEW_MS);
  electionTimer.unref?.();
}

/** Test/shutdown hook — stop the election loop and reset state. */
export function stopClusterRuntime(): void {
  if (electionTimer) {
    clearInterval(electionTimer);
    electionTimer = null;
  }
  started = false;
  _isLeader = false;
  _leaderId = null;
  _onInbound = null;
  _onOutbound = null;
}

/** HOME → LEADER. A raw signaling message (or synthetic __connect/__disconnect)
 *  from a browser homed on THIS instance, routed to the current leader. When we
 *  ARE the leader, dispatched locally (no Redis hop). */
export function clusterForwardInbound(cid: string, raw: unknown): void {
  if (_isLeader) {
    _onInbound?.(cid, INSTANCE_ID, raw);
    return;
  }
  const lid = _leaderId;
  if (!lid) return; // no leader known yet — the client resends on its next beat
  publishBus(sigInChannel(lid), { cid, home: INSTANCE_ID, raw } as InboundFrame);
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
}
