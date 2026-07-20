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
import type { RelaySocket } from "./relay";
import { INSTANCE_ID } from "./redisBus";

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
