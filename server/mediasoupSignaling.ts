/**
 * THE APP → MEDIA-NODE CLIENT.
 *
 * `voipRegistry.ts` answers *which* node a room belongs to. This answers *how* signaling
 * talks to it: one signed JSON POST per operation, to the node's own private IP on the
 * VPC-internal API port. It is the only place in the app that knows the node protocol.
 *
 * ── WHY THE PRIVATE IP, WHEN THE REGISTRY ALSO CARRIES A PUBLIC ONE ───────────────
 *
 * The two addresses answer two different questions and mixing them up is a real bug in
 * both directions. `publicIp` is what a BROWSER sends media to — it is announced in ICE
 * candidates and must be reachable from the internet. `privateIp` is what the app's own
 * signaling reaches over, and using the public address here would send control traffic out
 * through the internet gateway and back, paying latency on the path where latency is a
 * per-operation cost, while also requiring the internal API port to be open to the world.
 * The security group deliberately allows 4443 from the VPC only, so the public address
 * would not even work.
 *
 * ── WHY EVERY FAILURE IS A NULL, NEVER A THROW ────────────────────────────────────
 *
 * The caller is the call path. A node that is slow, restarting, or newly gone must degrade
 * the call — to the mesh — and must never propagate an exception into
 * signaling, where an unhandled rejection in the invite handler would cost the caller their
 * dial. So every op resolves to `{ok:true, data}` or `{ok:false, reason}`, the reason is
 * always one of a closed set, and the CALLER decides what to do about it. This is the same
 * discipline `readVoipNodes` applies for the same reason.
 *
 * ── WHY THERE IS A TIMEOUT AT ALL ────────────────────────────────────────────────
 *
 * `fetch` has no default timeout. A node that accepts a connection and then never answers
 * — the exact behaviour of a host whose mediasoup workers have wedged but whose kernel is
 * fine — would leave the request hanging forever, and with it whatever call setup was
 * waiting on it. A bounded wait converts that into a fallback.
 */
/* The signer is IMPORTED FROM THE NODE'S OWN MODULE, not reimplemented here.
 *
 * That is deliberate and it is the difference between a rule with one implementation and
 * the two-implementations-in-two-languages shape v2.99.71 recorded drifting in production.
 * The import is RELATIVE, so esbuild inlines it into `dist/index.js` — nothing named
 * `voip-node` is installed or shipped to the app fleet, and `sign.mjs` deliberately carries
 * no dependency and no side effect, which is what makes it safe to bundle. */
import { signBody, SIG_HEADER } from "../voip-node/sign.mjs";
import type { VoipNode } from "./voipRegistry";

/** The internal API port. Matches the agent's `VOIP_API_PORT` default. */
export const VOIP_API_PORT = 4443;

/**
 * How long to wait for one node operation.
 *
 * Deliberately short. These are same-VPC requests against an in-memory server: the honest
 * expectation is single-digit milliseconds, so a second and a half is already two orders of
 * magnitude of headroom, and anything slower than this is a node to stop using rather than
 * a node to keep waiting for. Media setup is on the critical path of a call connecting.
 */
export const NODE_TIMEOUT_MS = 1_500;

/** Every operation the node exposes. Mirrors the agent's `HANDLERS` — pinned by test. */
export type NodeOp =
  | "state"
  | "routerCapabilities"
  | "createTransport"
  | "connectTransport"
  | "produce"
  | "consume"
  | "resumeConsumer"
  | "setConsumerLayers"
  | "closeRoom"
  | "loudest"
  | "stats";

/** A closed set of reasons, so a caller can branch without parsing a message. */
export type NodeFailure =
  /** No `VOIP_NODE_SECRET`: mediasoup is not configured, so it is not an error. */
  | "unconfigured"
  /** Network refused, DNS, socket closed — the node is not answering. */
  | "unreachable"
  /** Accepted the connection and did not answer inside `NODE_TIMEOUT_MS`. */
  | "timeout"
  /** The node refused the signature. A real misconfiguration; log it loudly. */
  | "unauthorized"
  /** The node ran the op and it failed, or refused the shape. */
  | "node-error"
  /** The node answered something that is not JSON. */
  | "bad-response";

export type NodeResult<T = unknown> = { ok: true; data: T } | { ok: false; reason: NodeFailure };

/** Injected so the whole protocol can be driven with no node and no network. */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

/**
 * Read the shared secret.
 *
 * Read PER CALL rather than captured at module load, the same pattern as `iceServers()` —
 * so a fleet can be given the secret without a restart, and so a test can change it
 * between cases.
 */
export function voipNodeSecret(): string {
  return process.env.VOIP_NODE_SECRET || "";
}

/** Is the mediasoup transport configured at all? */
export function mediasoupConfigured(): boolean {
  return voipNodeSecret().length > 0;
}

/**
 * The parts of a node this module needs — and naming them is the two-plane rule made
 * explicit rather than left to a comment.
 *
 * Signaling reaches a node over its PRIVATE address; `publicIp` is what a client is told to
 * send media to and has no business being reachable from here. `instanceId` is the health
 * ledger's key. Nothing else about a node — its load, its cores, its freshness — can change
 * where a signed op is sent, so nothing else is accepted.
 *
 * A full `VoipNode` satisfies this, so every existing caller is unchanged; what it also
 * admits is a room's recorded `VoipAssignment`, which is the only thing a live call has (the
 * node it was placed on may have left the pool since, and the call must still be able to talk
 * to it — see `assignmentStillValid`, which asks about LIVENESS rather than eligibility for
 * exactly this reason).
 */
export type NodeAddress = Pick<VoipNode, "instanceId" | "privateIp">;

/**
 * The URL for one node's internal API.
 *
 * Built from the node's own self-reported private address, so it follows an instance
 * replacement with no configuration anywhere. `http` and not `https`: this is a
 * VPC-internal hop between two hosts in one security group, and the payload is
 * HMAC-authenticated rather than merely confidential — adding TLS here would mean managing
 * a certificate per node whose IP changes, for a link that carries no user content (SDP
 * and RTP parameters, never media and never a credential).
 */
export function nodeApiUrl(node: NodeAddress, port = VOIP_API_PORT): string {
  return `http://${node.privateIp}:${port}/`;
}

/**
 * Call one operation on one node.
 *
 * THE BODY IS SERIALIZED EXACTLY ONCE, and that is a correctness requirement rather than an
 * optimisation: the signature covers the bytes, so signing one serialization and sending
 * another — even a semantically identical one with different key order — produces a request
 * the node correctly refuses. Sign what you send.
 */
export async function callNode<T = unknown>(
  node: NodeAddress,
  op: NodeOp,
  payload: Record<string, unknown>,
  opts: {
    fetchImpl?: FetchLike;
    nowMs?: number;
    secret?: string;
    port?: number;
    timeoutMs?: number;
  } = {},
): Promise<NodeResult<T>> {
  const secret = opts.secret ?? voipNodeSecret();
  if (!secret) return { ok: false, reason: "unconfigured" };
  const doFetch = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike | undefined);
  if (!doFetch) return { ok: false, reason: "unreachable" };

  const body = JSON.stringify({ op, ...payload });
  const sig = signBody(secret, body, opts.nowMs ?? Date.now());

  // AbortSignal.timeout would be tidier and is not used: it is unavailable on older Node
  // and, more usefully, an explicit controller lets the timer be CLEARED on success. A
  // 1.5s timer left armed per request on the call path is a leak that only shows up under
  // load, which is the worst time to find it.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? NODE_TIMEOUT_MS);
  let res: { ok: boolean; status: number; text(): Promise<string> };
  try {
    res = await doFetch(nodeApiUrl(node, opts.port), {
      method: "POST",
      headers: { "content-type": "application/json", [SIG_HEADER]: sig },
      body,
      signal: controller.signal,
    });
  } catch (e) {
    // An abort and a refused connection are DIFFERENT diagnoses — "the node is wedged"
    // versus "the node is gone" — and they get different reasons so a log says which.
    return { ok: false, reason: controller.signal.aborted ? "timeout" : "unreachable" };
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    if (res.status === 401) return { ok: false, reason: "unauthorized" };
    return { ok: false, reason: "node-error" };
  }
  let text: string;
  try {
    text = await res.text();
  } catch {
    return { ok: false, reason: "bad-response" };
  }
  try {
    return { ok: true, data: (text ? JSON.parse(text) : {}) as T };
  } catch {
    return { ok: false, reason: "bad-response" };
  }
}

/* ─────────────────────────────────────────────────────────────────────────────────────
 * NODE HEALTH — THE LINK THAT MAKES THE FALLBACK ACTUALLY HAPPEN.
 *
 * A node can be PERFECTLY HEALTHY in the registry and refuse every operation, and that is
 * not a hypothetical: give one node the wrong `VOIP_NODE_SECRET` and it heartbeats happily
 * — the heartbeat is a Redis write it makes about itself, not a request anyone signs — while
 * answering 401 to signaling. Without this, `planRoomTransport` keeps selecting it, every
 * call assigned to it fails, and NOTHING degrades: the registry says the fleet is fine.
 *
 * So the ops report, and the reports feed `planRoomTransport`'s `excludeInstanceIds`. The
 * whole point is that the call then goes to the other node, or to the mesh.
 *
 * THE FAILURES ARE NOT EQUIVALENT, AND TREATING THEM AS ONE IS THE TRAP IN BOTH DIRECTIONS:
 *
 *   `unauthorized`   — excluded IMMEDIATELY, and for longest. A wrong secret does not heal
 *                      itself and every subsequent op will fail identically, so one is all
 *                      the evidence there is ever going to be.
 *   `timeout`        — needs REPEATS. One dropped packet must not take a node out of a
 *   `unreachable`      two-node fleet; that would turn a blip into halved capacity, which
 *                      is worse than the blip.
 *   `node-error`     — NEVER excludes. The node answered; the OPERATION failed, which is
 *   `bad-response`     usually about the payload or a room that has gone. Excluding here
 *                      would let one malformed request from the app take out the fleet.
 *   `unconfigured`   — NEVER excludes, and is not about the node at all.
 *
 * A SUCCESS CLEARS THE RECORD OUTRIGHT rather than decrementing a counter, because a node
 * that just answered is a node that works — a slow decay would go on punishing a node that
 * had already recovered, on a fleet of two.
 *
 * AND IT MAY EXCLUDE EVERY NODE, deliberately. If all of them really are refusing, then the
 * right answer is the mesh, and a "never exclude the last one" rule would keep
 * routing calls into a fleet that cannot carry them. That is what fail-open means here: the
 * CALL survives, not the SFU.
 * ────────────────────────────────────────────────────────────────────────────────────── */

/** How long an `unauthorized` node is left alone. A wrong secret needs a human, not a retry. */
export const NODE_UNAUTHORIZED_COOLDOWN_MS = 60_000;
/** How long a node that stopped answering is left alone. Short: a restart is ~seconds. */
export const NODE_UNREACHABLE_COOLDOWN_MS = 10_000;
/**
 * Consecutive transport failures before a node is set aside.
 *
 * Three rather than one because the cost of being wrong is asymmetric on a two-node fleet:
 * excluding a healthy node halves SFU capacity, while carrying a broken one for two more ops
 * costs those two calls a fallback they would have taken anyway.
 */
export const NODE_FAILURES_BEFORE_EXCLUDE = 3;

interface NodeHealthEntry {
  /** Consecutive transport-level failures since the last success. */
  failures: number;
  /** Excluded until this instant, on the CALLER's clock. */
  until: number;
  /** Why, so a log can say which and an operator knows where to look. */
  reason: NodeFailure | null;
}

/**
 * The health store, INJECTABLE with a process-local default.
 *
 * Process-local is correct here rather than lazy: this is an observation THIS instance made
 * about whether a node answers IT, on the same footing as the rate limiters, and a shared
 * store would let one instance's network trouble take a node away from the other. Injectable
 * because a module-level Map that tests cannot reset is how state leaks between cases — and
 * because a `Map` mutated at module scope is the hazard v2.105.16 recorded.
 */
export type NodeHealthStore = Map<string, NodeHealthEntry>;

const defaultHealth: NodeHealthStore = new Map();

/** Record the outcome of one op against one node. Returns whether the node is now excluded. */
export function recordNodeOutcome(
  instanceId: string,
  result: { ok: boolean; reason?: NodeFailure },
  opts: { nowMs?: number; store?: NodeHealthStore } = {},
): boolean {
  const store = opts.store ?? defaultHealth;
  const now = opts.nowMs ?? Date.now();
  if (result.ok) {
    // A node that answered is healthy. No decay, no memory of a blip it has recovered from.
    store.delete(instanceId);
    return false;
  }
  const reason = result.reason;
  // Neither of these is evidence about the NODE, so neither may cost it its rooms.
  if (!reason || reason === "unconfigured" || reason === "node-error" || reason === "bad-response") {
    return false;
  }
  const prev = store.get(instanceId);
  const failures = (prev?.failures ?? 0) + 1;
  if (reason === "unauthorized") {
    store.set(instanceId, { failures, until: now + NODE_UNAUTHORIZED_COOLDOWN_MS, reason });
    return true;
  }
  // timeout | unreachable — needs repeats.
  const until =
    failures >= NODE_FAILURES_BEFORE_EXCLUDE ? now + NODE_UNREACHABLE_COOLDOWN_MS : (prev?.until ?? 0);
  store.set(instanceId, { failures, until, reason });
  return until > now;
}

/**
 * The instance ids to exclude right now — handed straight to `planRoomTransport`.
 *
 * Expired entries are dropped as they are read, so the store cannot grow without bound on a
 * fleet whose nodes come and go. Returns a fresh Set, never the store's own keys, so a caller
 * holding it cannot mutate the health of the fleet by accident.
 */
export function unhealthyNodeIds(
  opts: { nowMs?: number; store?: NodeHealthStore } = {},
): Set<string> {
  const store = opts.store ?? defaultHealth;
  const now = opts.nowMs ?? Date.now();
  const out = new Set<string>();
  const expired: string[] = [];
  /* `.forEach` rather than `for…of` over the Map: iterating an Iterable needs
     `downlevelIteration` under this target and fails the build with TS2802 — the trap
     recorded in v2.99.72, v2.99.98 and v2.105.21, hit here for the fourth time. Deletions are
     collected rather than made mid-walk, which is correct regardless of iteration style. */
  store.forEach((e, id) => {
    if (e.until > now) out.add(id);
    else if (e.until !== 0) expired.push(id);
  });
  expired.forEach((id) => store.delete(id));
  return out;
}

/** Why a node is set aside, for a log line. Null when it is not. */
export function nodeExclusionReason(
  instanceId: string,
  opts: { nowMs?: number; store?: NodeHealthStore } = {},
): NodeFailure | null {
  const store = opts.store ?? defaultHealth;
  const now = opts.nowMs ?? Date.now();
  const e = store.get(instanceId);
  return e && e.until > now ? e.reason : null;
}

/** Test seam and a clean-shutdown tidy. Never called on any request path. */
export function resetNodeHealth(store: NodeHealthStore = defaultHealth): void {
  store.clear();
}

/**
 * `callNode` with the outcome recorded — what the call path should use.
 *
 * A separate NAMED function rather than folding the recording into `callNode`, because
 * `callNode` is also how a health probe or an operator tool would talk to a node, and a probe
 * that changes the fleet's routing as a side effect of looking at it is its own bug.
 */
export async function callNodeTracked<T = unknown>(
  node: NodeAddress,
  op: NodeOp,
  payload: Record<string, unknown>,
  opts: Parameters<typeof callNode>[3] & { store?: NodeHealthStore } = {},
): Promise<NodeResult<T>> {
  const r = await callNode<T>(node, op, payload, opts);
  recordNodeOutcome(node.instanceId, r, { nowMs: opts.nowMs, store: opts.store });
  return r;
}
