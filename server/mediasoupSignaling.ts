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
 * the call — to LiveKit, or to the mesh — and must never propagate an exception into
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
 * Read PER CALL rather than captured at module load, the same pattern as `iceServers()` and
 * `livekitConfig()` — so a fleet can be given the secret without a restart, and so a test
 * can change it between cases.
 */
export function voipNodeSecret(): string {
  return process.env.VOIP_NODE_SECRET || "";
}

/** Is the mediasoup transport configured at all? */
export function mediasoupConfigured(): boolean {
  return voipNodeSecret().length > 0;
}

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
export function nodeApiUrl(node: VoipNode, port = VOIP_API_PORT): string {
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
  node: VoipNode,
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
