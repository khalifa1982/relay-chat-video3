/**
 * THE mediasoup MEDIA-NODE REGISTRY, AND THE TRANSPORT PRECEDENCE.
 *
 * RELAY's media transport is a self-hosted mediasoup SFU with the WebRTC mesh underneath
 * it as the floor. Two media nodes exist in Mumbai, one per availability zone,
 * smoke-tested: a worker per core, `WebRtcTransport` announcing the node's own public IP,
 * UDP+TCP 40000-49999 open.
 *
 * THERE WERE THREE RUNGS UNTIL v2.106.53 — a hosted SFU sat between these two. The owner
 * cancelled that account, so the ladder is now our own nodes or no infrastructure at all,
 * and the mesh's 6-participant cap is the real ceiling whenever a node is unavailable.
 *
 * THIS FILE IS THE PART THAT CAN BE REASONED ABOUT AND TESTED WITHOUT ANY OF THAT.
 * Everything here is PURE plus an injected client, the same shape `callStats.ts` and
 * `fleetVerify.ts` use — because the decisions that matter (is this node usable, which
 * node gets this room, which transport does this call use) are arithmetic, and arithmetic
 * should not need a browser, a VPC or a phone to check.
 *
 * ── WHY A REGISTRY AT ALL, RATHER THAN A CONFIGURED LIST ──────────────────────────
 *
 * The nodes' public IPs are AUTO-ASSIGNED, not Elastic — the account hit its EIP quota
 * and an increase is pending. An auto-assigned IP CHANGES when an instance stops and
 * starts. So a configured `MEDIASOUP_HOSTS` list is not merely inelegant here, it is a
 * value that goes silently wrong and sends media to an address nobody is listening on.
 * Each node self-reports its current IP from instance metadata; signaling reads what the
 * nodes say about themselves. When the quota lands, Elastic IPs can be attached with no
 * code change, because nothing was ever written down.
 *
 * ── WHY MEDIA CANNOT SIT BEHIND THE LOAD BALANCER ────────────────────────────────
 *
 * Media is a live UDP flow that must reach the EXACT host holding that room's router. A
 * load balancer would spray packets across hosts and break the stream — this is true of
 * every SFU, hosted or otherwise. So the signaling plane keeps one endpoint (the existing
 * ALB) and the media plane fans out beneath it, one public IP per node, with each room
 * PINNED to one node.
 */

/** A media node's self-reported state. Written by the node agent, read by signaling. */
export interface VoipNode {
  /** EC2 instance id — the registry key, stable across an IP change. */
  instanceId: string;
  /** Current public IP, read from IMDSv2 by the node itself. Clients send media here. */
  publicIp: string;
  /** VPC-private IP — what the transport LISTENS on, while announcing `publicIp`. */
  privateIp: string;
  /** Availability zone, so a room's coturn fallback can stay in the same zone. */
  az: string;
  /** CPU cores, i.e. how many mediasoup workers this node runs. */
  cores: number;
  /** Live counts, for load. */
  routers: number;
  consumers: number;
  /** 0..1 load average per core. mediasoup is CPU-bound, so this is the real ceiling. */
  cpuLoad: number;
  /** The node's own clock when it last reported. Freshness is judged on THIS. */
  updatedAt: number;
}

export const NODE_KEY_PREFIX = "relay:voip:node:";
export const NODE_INDEX_KEY = "relay:voip:nodes";

/** A record older than this is not trusted to be alive. */
export const NODE_TTL_MS = 15_000;
/**
 * How far a node's clock may run AHEAD of the reader's before its record is disbelieved.
 *
 * Not a tolerance for sloppiness — a bound on a comparison between two machines' clocks.
 * Without it the freshness test failed SHUT on a millisecond of skew (see `isNodeFresh`).
 */
export const NODE_CLOCK_SKEW_MS = 2_000;
/**
 * A hard ceiling on rooms per node, and it exists because the other two load signals LAG.
 *
 * `cpuLoad` is `loadavg()[0]`, a ONE-MINUTE average, and `consumers` only rises after people
 * have actually joined — so fifty dials in three seconds all read one snapshot and all land
 * on the same node. `routers` moves the instant a room is assigned, which makes it the only
 * fast brake available. A starting value: like the CPU ceiling it can only be calibrated by
 * load-testing the real subscription pattern on a 2-core box.
 */
export const NODE_MAX_ROUTERS = 40;
/**
 * What a just-assigned room counts for while its participants have not joined yet.
 *
 * The app correcting for what it has itself just done, inside one refresh window — with no
 * extra state to keep in sync, because the caller already knows what it assigned.
 */
export const PENDING_CONSUMER_WEIGHT = 2;
/** How often a node refreshes — three beats inside the TTL, so one lost beat is survivable. */
export const NODE_HEARTBEAT_MS = 5_000;

/**
 * Above this per-core load a node is EXCLUDED from new rooms rather than merely ranked
 * last. mediasoup is CPU-bound, so a saturated node does not degrade gracefully — it
 * drops frames for every room it already holds, and adding one more makes that worse for
 * people already in a call. Excluding is kinder than ranking.
 */
export const NODE_CPU_CEILING = 0.85;

export function nodeKey(instanceId: string): string {
  return NODE_KEY_PREFIX + instanceId;
}

const isStr = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * An IPv4 dotted quad, checked by SHAPE rather than by a loose "has dots" test.
 *
 * This is load-bearing rather than fussy: the value is handed to a browser as the address
 * to send media to, so a garbage value is a call that silently never connects, and a
 * value under someone else's control would be a redirection of media. The node reports it
 * from instance metadata, but the registry is the trust boundary and validates anyway —
 * the same discipline `isPersistedRoom` applies to a hydrated room, for the same reason:
 * this record feeds a live decision.
 */
export function isIpv4(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const parts = v.split(".");
  if (parts.length !== 4) return false;
  return parts.every((p) => {
    if (!/^\d{1,3}$/.test(p)) return false;
    const n = Number(p);
    // No leading zeros: "01" and "1" would otherwise be two spellings of one address.
    if (p.length > 1 && p[0] === "0") return false;
    return n >= 0 && n <= 255;
  });
}

/**
 * Validate a decoded node record FIELD BY FIELD and drop it whole if anything is wrong.
 *
 * Never partially applied, for the reason `roomStore`'s validator gives about rooms: a
 * half-trusted record here decides where a call's media goes. A node missing from the
 * registry costs one node's capacity; a node in the registry with a wrong IP costs every
 * call assigned to it.
 */
export function decodeNode(raw: string | null | undefined): VoipNode | null {
  if (!raw) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (!isStr(o.instanceId) || !isStr(o.az)) return null;
  if (!isIpv4(o.publicIp) || !isIpv4(o.privateIp)) return null;
  if (!isNum(o.cores) || o.cores < 1) return null;
  if (!isNum(o.routers) || o.routers < 0) return null;
  if (!isNum(o.consumers) || o.consumers < 0) return null;
  if (!isNum(o.cpuLoad) || o.cpuLoad < 0) return null;
  if (!isNum(o.updatedAt) || o.updatedAt <= 0) return null;
  return {
    instanceId: o.instanceId,
    publicIp: o.publicIp,
    privateIp: o.privateIp,
    az: o.az,
    cores: o.cores,
    routers: o.routers,
    consumers: o.consumers,
    cpuLoad: o.cpuLoad,
    updatedAt: o.updatedAt,
  };
}

export function encodeNode(n: VoipNode): string {
  return JSON.stringify(n);
}

/**
 * Is this record recent enough to believe?
 *
 * Judged on the record's OWN `updatedAt` rather than on Redis key expiry alone. A key can
 * be present and stale — during a partition, or if a TTL was refreshed by something other
 * than a real heartbeat — and "the key exists" is a weaker claim than "the node said this
 * recently". A clock that has run BACKWARDS reads as stale rather than as infinitely
 * fresh, because the failure that matters is believing a dead node is alive.
 */
export function isNodeFresh(n: VoipNode, nowMs: number, ttlMs = NODE_TTL_MS): boolean {
  const age = nowMs - n.updatedAt;
  /* THE LOWER BOUND WAS `>= 0`, AND THAT WAS A FAIL-SHUT DEFECT — the exact direction this
     file's own header says must never happen.
     `updatedAt` is the NODE's clock and `nowMs` is the READER's, so they are two machines'
     clocks compared to the millisecond. ONE millisecond of forward skew on a node excluded
     it; both nodes skewed forward excluded the WHOLE FLEET, and every call silently fell to
     the mesh with nothing anywhere saying why. Two hosts running NTP are normally within a
     few milliseconds, which is precisely why this would have looked fine and then bitten
     once during a clock step.
     The recorded intent is KEPT and merely bounded: a timestamp far in the future is still
     evidence something is wrong and must not read as health. A couple of seconds is skew;
     a minute is a broken clock. */
  return age >= -NODE_CLOCK_SKEW_MS && age <= ttlMs;
}

/** Fresh AND not saturated: the two independent reasons to skip a node. */
export function isNodeUsable(n: VoipNode, nowMs: number, ttlMs = NODE_TTL_MS): boolean {
  return (
    isNodeFresh(n, nowMs, ttlMs) &&
    n.cpuLoad < NODE_CPU_CEILING &&
    // EXCLUDED rather than ranked last, for the same reason as the CPU ceiling: a node at
    // its room ceiling does not degrade gracefully, it degrades for everybody already on it.
    n.routers < NODE_MAX_ROUTERS
  );
}

/**
 * Load, as a number to rank by: CONSUMERS PER CORE.
 *
 * Deliberately not `cpuLoad`, and the distinction is the whole of the choice. cpuLoad is
 * the real constraint but it is a noisy, lagging sample — ranking on it makes the
 * selection FLAP between nodes as two samples cross, which on a per-room assignment means
 * consecutive rooms bouncing for no reason. Consumers per core is monotonic in the work
 * actually asked of the node and moves only when something really joined or left, so the
 * ranking is stable. cpuLoad still has a job, and a better-suited one: it EXCLUDES a
 * saturated node outright (`NODE_CPU_CEILING`) rather than merely ranking it last.
 *
 * Per CORE rather than absolute, so a bigger node correctly attracts more rooms — the
 * documented scaling path is to grow cores before adding nodes.
 */
export function nodeLoadScore(n: VoipNode, pendingRooms = 0): number {
  /* `pendingRooms` is rooms THIS app has just assigned here whose participants have not
     joined yet, so `consumers` does not know about them. Without it a burst of dials inside
     one 5s refresh window all rank against the same stale snapshot and pile onto one node.
     Defaults to 0, so every existing caller is byte-identical. */
  return (n.consumers + pendingRooms * PENDING_CONSUMER_WEIGHT) / Math.max(1, n.cores);
}

/**
 * Pick the node for a NEW room. Pure and deterministic.
 *
 * `preferAz` is honoured only among nodes that are otherwise usable, and only as a
 * TIEBREAK-LEVEL preference rather than an override: keeping media in the caller's zone
 * is worth a little, and worth less than not putting a room on a node that is already
 * carrying twice as much work. The threshold is explicit rather than implied.
 *
 * Returns null when nothing is usable — the caller falls back to another transport, and
 * `chooseCallTransport` below is where that decision lives.
 */
export function rankNodes(
  nodes: VoipNode[],
  opts: {
    nowMs: number;
    preferAz?: string | null;
    ttlMs?: number;
    /** instanceId -> rooms assigned here that have not filled up yet. */
    pending?: Record<string, number> | Map<string, number> | null;
    /** Nodes to skip because they are answering badly, however healthy they LOOK. */
    excludeInstanceIds?: Iterable<string> | null;
  },
): VoipNode[] {
  const pendingFor = (id: string): number => {
    const p = opts.pending;
    if (!p) return 0;
    const v = p instanceof Map ? p.get(id) : p[id];
    return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
  };
  /* THE FAIL-OPEN LINK THE DESIGN REVIEW FOUND MISSING. Without it a node whose shared
     secret is wrong (or which has wedged) keeps looking perfectly healthy in the registry —
     it heartbeats happily — while refusing every operation, so `planRoomTransport` keeps
     choosing it and every call fails with no degradation. `mediasoupSignaling` reports such
     nodes and they are excluded here, which is what makes the fallback to the mesh actually
     happen. */
  const excluded = new Set(opts.excludeInstanceIds ?? []);
  const usable = nodes.filter(
    (n) => !excluded.has(n.instanceId) && isNodeUsable(n, opts.nowMs, opts.ttlMs),
  );
  if (usable.length === 0) return [];
  return [...usable].sort((a, b) => {
    const la = nodeLoadScore(a, pendingFor(a.instanceId));
    const lb = nodeLoadScore(b, pendingFor(b.instanceId));
    /* AZ preference applies only when the two nodes are within a QUARTER of a consumer
       per core of each other — close enough that zone locality is the more useful
       tiebreak. Above that gap, load wins: a room placed in the right zone on a node
       that is twice as busy is a worse call than a room one zone away. */
    if (opts.preferAz && Math.abs(la - lb) < 0.25) {
      const pa = a.az === opts.preferAz ? 0 : 1;
      const pb = b.az === opts.preferAz ? 0 : 1;
      if (pa !== pb) return pa - pb;
    }
    if (la !== lb) return la - lb;
    // A STABLE final tiebreak, so an unloaded two-node fleet does not alternate
    // arbitrarily between otherwise identical nodes on every room.
    return a.instanceId < b.instanceId ? -1 : a.instanceId > b.instanceId ? 1 : 0;
  });
}

/**
 * Pick the node for a NEW room: the head of the ranking.
 *
 * Reduced to one line over `rankNodes` DELIBERATELY. Two functions each carrying a copy of
 * the ordering is how "which node did we pick" and "which node should we have picked" come
 * to disagree — the class this repo keeps paying for (v2.99.71, v2.99.77).
 */
export function selectVoipNode(
  nodes: VoipNode[],
  opts: {
    nowMs: number;
    preferAz?: string | null;
    ttlMs?: number;
    pending?: Record<string, number> | Map<string, number> | null;
    excludeInstanceIds?: Iterable<string> | null;
  } = { nowMs: Date.now() },
): VoipNode | null {
  return rankNodes(nodes, opts)[0] ?? null;
}

/** Which media transport a call should use. */
export type CallTransport = "mediasoup" | "mesh";

/**
 * THE PRECEDENCE, IN ONE PLACE.
 *
 * mediasoup when there is a usable node and nothing has opted this call out; else the mesh,
 * which needs no server at all and is therefore the floor.
 *
 * IT CANNOT RETURN "NOTHING", and that is the point rather than a convenience. This
 * decides whether a call can be placed, and the rule this repo keeps re-learning is that
 * such a decision must FAIL OPEN: a Redis hiccup, an unconfigured SFU or a saturated
 * fleet must degrade the call's QUALITY, never remove the ability to make it. The mesh is
 * always the last resort precisely because it depends on no infrastructure — up to six
 * participants it is a complete answer.
 *
 * THE LADDER USED TO HAVE A MIDDLE RUNG (v2.106.53). It was a hosted SFU, and the owner
 * cancelled that account, so there are now exactly two rungs: our own nodes, or no
 * infrastructure at all. `forceMesh` survives from that arrangement because it is still
 * the only way to compare the two with numbers on one account, which is what turns a
 * "video degrades mid-call" report into an answer rather than an opinion.
 */
export function chooseCallTransport(opts: {
  mediasoupNode: VoipNode | null;
  /** Per-room or per-user opt-out, for staged rollout and A/B. */
  forceMesh?: boolean;
  /** Kill switch: mediasoup off fleet-wide without a deploy. */
  mediasoupEnabled?: boolean;
}): CallTransport {
  const msoup = opts.mediasoupEnabled !== false && !opts.forceMesh && opts.mediasoupNode !== null;
  return msoup ? "mediasoup" : "mesh";
}

/**
 * A room's assignment to ONE node, in the form that has to survive a leader change.
 *
 * Narrow on purpose: the instance id (stable across an IP change), the public IP the clients
 * were told to send media to, the zone, and when. NOT the whole node record — a room's
 * assignment must not carry a snapshot of load that will be stale in five seconds and that
 * somebody would then be tempted to read.
 */
export interface VoipAssignment {
  instanceId: string;
  publicIp: string;
  az: string;
  assignedAt: number;
}

export function isVoipAssignment(v: unknown): v is VoipAssignment {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return isStr(o.instanceId) && isIpv4(o.publicIp) && isStr(o.az) && isNum(o.assignedAt) && o.assignedAt > 0;
}

/**
 * Is a room's existing assignment still good?
 *
 * THE `publicIp` COMPARISON IS THE INTERESTING HALF, and it is only possible because the IPs
 * are auto-assigned rather than Elastic. A node whose record is FRESH but whose address has
 * CHANGED has been stopped and started: its mediasoup workers are new processes, so every
 * router this room depended on is gone even though the heartbeat looks perfect. The changed
 * address is positive evidence of that, and without this check a room would keep being
 * treated as live on a node that has no idea it exists.
 */
export function assignmentStillValid(
  a: VoipAssignment | null | undefined,
  nodes: VoipNode[],
  nowMs: number,
  ttlMs = NODE_TTL_MS,
): boolean {
  if (!a) return false;
  const n = nodes.find((x) => x.instanceId === a.instanceId);
  if (!n) return false;
  if (n.publicIp !== a.publicIp) return false;
  return isNodeUsable(n, nowMs, ttlMs);
}

/**
 * SELECT AND CHOOSE, COMPOSED IN ONE PLACE.
 *
 * The bug class this exists to prevent is the two halves DISAGREEING: a caller that picks a
 * node and then separately decides a transport can end up telling a client "mediasoup" while
 * holding no assignment, or holding an assignment it then routes past. Both are calls that
 * cannot connect, and neither is visible in either function alone.
 *
 * So the invariant is structural rather than remembered: `mediasoup` always carries a `voip`,
 * and anything else always carries `null`.
 */
export function planRoomTransport(opts: {
  nodes: VoipNode[];
  nowMs: number;
  mediasoupEnabled?: boolean;
  forceMesh?: boolean;
  preferAz?: string | null;
  pending?: Record<string, number> | Map<string, number> | null;
  excludeInstanceIds?: Iterable<string> | null;
}): { transport: CallTransport; voip: VoipAssignment | null } {
  const node =
    opts.mediasoupEnabled === false || opts.forceMesh
      ? null
      : selectVoipNode(opts.nodes, {
          nowMs: opts.nowMs,
          preferAz: opts.preferAz ?? null,
          pending: opts.pending ?? null,
          excludeInstanceIds: opts.excludeInstanceIds ?? null,
        });
  const transport = chooseCallTransport({
    mediasoupNode: node,
    forceMesh: opts.forceMesh,
    mediasoupEnabled: opts.mediasoupEnabled,
  });
  if (transport !== "mediasoup" || !node) return { transport, voip: null };
  return {
    transport,
    voip: {
      instanceId: node.instanceId,
      publicIp: node.publicIp,
      az: node.az,
      assignedAt: opts.nowMs,
    },
  };
}

/**
 * The transport for a room HYDRATED from a persisted record — the mid-rollout guard.
 *
 * An ABSENT `transport` resolves to the PRE-FEATURE answer and never to mediasoup. A record
 * written by an instance that predates this feature carries no transport and no assignment,
 * so reading it as mediasoup would hand the room to a node that has never heard of it. A
 * rolling deploy serves both bundles for about sixty seconds, which is exactly long enough
 * for that to happen to real calls.
 */
export function transportForHydratedRoom(
  rec: { transport?: unknown } | null | undefined,
): CallTransport {
  const t = rec?.transport;
  if (t === "mediasoup" || t === "mesh") return t;
  /* A RECORD NAMING THE RETIRED HOSTED SFU READS AS MESH (v2.106.53), which is the same
     answer an ABSENT transport gets and for the same reason: the only thing we know is
     that this room is not on one of our nodes, and the mesh is the transport that needs
     no server to be true. Reading it as mediasoup would hand the room to a node that has
     never heard of it. */
  return "mesh";
}

/**
 * Put the relays in the room's OWN zone first.
 *
 * Pure list reordering — nothing here touches coturn or the credential mechanism, which are
 * untouched by design. A relay in the same availability zone as the room's node is one fewer
 * cross-zone hop on the path that only exists because the direct one failed.
 *
 * STABLE, and identity when it cannot do better: an absent or short `azs`, or a zone nothing
 * matches, must return the list unchanged rather than reordering on a guess.
 */
export function orderRelaysByAz<T>(hosts: T[], azs: (string | null | undefined)[] | null | undefined, preferAz: string | null | undefined): T[] {
  if (!preferAz || !azs || azs.length !== hosts.length) return hosts.slice();
  const same: T[] = [];
  const other: T[] = [];
  hosts.forEach((h, i) => (azs[i] === preferAz ? same : other).push(h));
  return same.length === 0 ? hosts.slice() : [...same, ...other];
}

/**
 * The participant cap for a transport.
 *
 * An SFU decouples a participant's cost from the party size — on the mesh each phone runs
 * N-1 encoders and N-1 decoders, which v2.99.84 measured as the single biggest lever on
 * call CPU and heat. So the mesh keeps its 6 and mediasoup gets 10.
 *
 * THE 10 IS STILL PROVISIONAL, and now more so than before: it was inherited from what a
 * hosted SFU was allowed rather than derived, and the nodes are 2-core, so the real
 * ceiling has to come from load-testing the actual subscription pattern.
 */
export function transportCap(t: CallTransport): number {
  return t === "mesh" ? 6 : 10;
}

/**
 * A minimal Redis surface, injected — the same shape `redisBus` already defines, so the
 * app reuses its ONE connection rather than opening a third. Injected rather than
 * imported so the selection and freshness rules above can be driven in a test with no
 * Redis at all, which is most of what is worth checking.
 */
export interface VoipRegistryClient {
  smembers(key: string): Promise<string[]>;
  get(key: string): Promise<string | null>;
  /**
   * OPTIONAL, and used when present: the per-key `get` loop below is O(N) SEQUENTIAL round
   * trips, and this read is about to sit on a 5s timer on every app instance. Optional
   * rather than required so an injected test client (or an older bus wrapper) still works.
   */
  mget?(keys: string[]): Promise<(string | null)[]>;
  set(key: string, value: string, mode: "PX", ttlMs: number): Promise<unknown>;
  sadd(key: string, member: string): Promise<unknown>;
  srem(key: string, member: string): Promise<unknown>;
  del(key: string): Promise<unknown>;
}

/**
 * Read every registered node.
 *
 * FAILS TO AN EMPTY LIST rather than throwing, because the ONE caller is the transport
 * choice and an empty list there means "fall back", which is exactly the right answer
 * when the registry cannot be read. Throwing would turn a Redis blip into a failed call.
 *
 * A member in the index whose record is gone or invalid is skipped and the stale index
 * entry is dropped — the index is a convenience for enumeration, and leaving it to rot
 * would slowly make every read do work for nodes that no longer exist.
 */
export async function readVoipNodes(
  client: VoipRegistryClient | null,
  opts: { pruneIndex?: boolean } = {},
): Promise<VoipNode[]> {
  if (!client) return [];
  try {
    const ids = await client.smembers(NODE_INDEX_KEY);
    const out: VoipNode[] = [];
    // ONE round trip when the client can do it, falling back to the loop when it cannot.
    let batched: (string | null)[] | null = null;
    if (client.mget && ids.length > 0) {
      try {
        batched = await client.mget(ids.map((id) => nodeKey(id)));
      } catch {
        batched = null; // fall back rather than fail the read
      }
    }
    for (let i = 0; i < ids.length; i += 1) {
      const id = ids[i];
      let rec: VoipNode | null = null;
      try {
        rec = decodeNode(batched ? batched[i] : await client.get(nodeKey(id)));
      } catch {
        rec = null;
      }
      if (rec && rec.instanceId === id) out.push(rec);
      else if (opts.pruneIndex !== false) {
        // Best-effort tidy; never allowed to fail the read.
        try {
          await client.srem(NODE_INDEX_KEY, id);
        } catch {
          /* ignore */
        }
      }
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * A node agent's heartbeat. Sets the record with a TTL and keeps the index entry.
 *
 * The TTL is what makes a crashed node disappear on its own: nothing has to notice the
 * death, because the record simply stops existing. `isNodeFresh` then makes a record that
 * outlives its usefulness (a refreshed key with a stale body) unusable too, so the two
 * mechanisms cover each other rather than duplicating.
 */
export async function heartbeatVoipNode(
  client: VoipRegistryClient | null,
  n: VoipNode,
  ttlMs = NODE_TTL_MS,
): Promise<boolean> {
  if (!client) return false;
  try {
    await client.set(nodeKey(n.instanceId), encodeNode(n), "PX", ttlMs);
    await client.sadd(NODE_INDEX_KEY, n.instanceId);
    return true;
  } catch {
    return false;
  }
}

/** Deregister on a clean shutdown, so a planned stop does not wait out the TTL. */
export async function deregisterVoipNode(
  client: VoipRegistryClient | null,
  instanceId: string,
): Promise<void> {
  if (!client) return;
  try {
    await client.del(nodeKey(instanceId));
    await client.srem(NODE_INDEX_KEY, instanceId);
  } catch {
    /* ignore — the TTL is the backstop */
  }
}
