/**
 * THE LIVE MEDIA-NODE POOL — what turns "add a node" into an infrastructure step.
 *
 * `voipRegistry.ts` holds the arithmetic: given a list of nodes, which one takes this room
 * and why. This holds the part that has to touch the world — reading that list off Redis on
 * a timer, caching it for the dial path, and making saturation LOUD instead of silent.
 *
 * ── THE WHOLE MECHANISM, STATED PLAINLY ───────────────────────────────────────────────
 *
 * A node boots, reads its own address from instance metadata, and writes itself into Redis
 * every 5s with a 15s TTL. This module reads that set on the same cadence. Selection runs
 * against whatever it finds. So adding capacity is: launch a node. It registers. The next
 * room can land on it. No deploy, no config edit, no restart, and nothing anywhere holds a
 * list of hosts that could go stale — which is the point, because these addresses are
 * assigned by AWS and not by us.
 *
 * Removing capacity is the mirror: `touch /etc/relay-voip/draining` and the node stops
 * receiving new rooms while it finishes the calls it has.
 *
 * ── WHY THE DIAL PATH READS A CACHE AND NOT REDIS ─────────────────────────────────────
 *
 * Room creation is SYNCHRONOUS inside the signaling invite handler — that is why
 * `onResolveDial` needs a timeout and a settled flag, and why a wedged resolver must never
 * be able to strand a dial. Putting a Redis round trip in front of every call would put a
 * network hop on the critical path of the one operation that must not wait.
 *
 * So the timer refreshes and the dial path reads memory. A node that registered a moment ago
 * becomes eligible within one refresh (~5s) rather than instantly, and that is the honest
 * description: "no engineering work at the moment of need", not "zero latency".
 *
 * THE FRESHNESS CHECK STILL RUNS AT USE TIME, which is what makes a cache safe here. The
 * snapshot is raw records; `partitionNodes` is handed `Date.now()` by the caller, so a
 * cached record that has aged past the TTL is refused at the decision rather than trusted
 * because it was in the cache. A stale cache degrades to "no usable node" (the mesh), never
 * to "send this call to a dead box".
 *
 * ── DORMANT WITHOUT REDIS ─────────────────────────────────────────────────────────────
 *
 * No client, no timer, no reads, and `poolSnapshot()` is an empty list — so every call takes
 * the mesh exactly as it does today. Same contract as `redisBus`.
 */
import {
  NODE_HEARTBEAT_MS,
  partitionNodes,
  readVoipNodes,
  type NodePartition,
  type PoolReason,
  type VoipNode,
  type VoipRegistryClient,
} from "./voipRegistry";

/** How often the pool is re-read. The node heartbeat cadence, so the two stay in step. */
export const POOL_REFRESH_MS = NODE_HEARTBEAT_MS;

/**
 * How long a warning about the SAME condition is suppressed.
 *
 * Transitions are logged immediately, so this only governs the reminder while a condition
 * PERSISTS. Five minutes is often enough that a real saturation event stays visible in the
 * journal and rare enough that it cannot bury anything.
 */
export const POOL_WARN_COOLDOWN_MS = 5 * 60_000;

let client: VoipRegistryClient | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let nodes: VoipNode[] = [];
let lastReadAt = 0;
let lastReason: PoolReason | null = null;
let lastWarnAt = 0;

/** Injected so the whole module can be driven in a test with no Redis and no clock. */
export function setVoipPoolClient(c: VoipRegistryClient | null): void {
  client = c;
  if (!c) {
    nodes = [];
    lastReadAt = 0;
  }
}

/** The cached node list. Raw records — the caller applies freshness with its own clock. */
export function poolSnapshot(): VoipNode[] {
  return nodes;
}

/** When the cache was last successfully refreshed, so staleness is observable. */
export function poolLastReadAt(): number {
  return lastReadAt;
}

export async function refreshVoipPool(nowMs = Date.now()): Promise<VoipNode[]> {
  if (!client) return nodes;
  const read = await readVoipNodes(client);
  /* `readVoipNodes` FAILS TO AN EMPTY LIST on a Redis error, which is right for its own
     caller but wrong to cache: a single blip would empty the pool and route every call for
     the next few seconds onto the mesh. An empty read is only believed when the previous
     one was also empty or the cache has already aged past usefulness — otherwise the last
     known list is kept and will age out on its own via the freshness check. */
  if (read.length === 0 && nodes.length > 0 && nowMs - lastReadAt < POOL_REFRESH_MS * 3) {
    return nodes;
  }
  nodes = read;
  lastReadAt = nowMs;
  return nodes;
}

export interface PoolState extends NodePartition {
  /** ms since the cache was refreshed, or null when nothing has ever been read. */
  ageMs: number | null;
  /** Whether a pool exists to read at all. */
  configured: boolean;
}

/** The pool as it stands right now, for a status surface. */
export function poolState(nowMs = Date.now(), excludeInstanceIds?: Iterable<string> | null): PoolState {
  const part = partitionNodes(nodes, { nowMs, excludeInstanceIds: excludeInstanceIds ?? null });
  return {
    ...part,
    ageMs: lastReadAt === 0 ? null : nowMs - lastReadAt,
    configured: client !== null,
  };
}

/**
 * MAKE THE POOL'S STATE AUDIBLE — and say the right thing, which is the hard part.
 *
 * The doc that asked for this wants a "pool saturated" warning as the signal to add a node.
 * Emitting that on every empty pool would be worse than emitting nothing: an empty registry
 * almost always means THE AGENT IS NOT RUNNING, and an operator told to add capacity in that
 * situation goes and launches a second box that also fails to register. A standing false
 * alarm is what hides a real one (v2.105.10 is this repo's recorded case, where a restart
 * counter cried wolf at the deploy cadence and had to be rewritten as a rate).
 *
 * So the message comes from the funnel's REASON, which names the stage that ran out of
 * candidates, and each message names the action that stage actually calls for.
 *
 * Returns the line it logged, or null, so a test can assert the wording rather than scraping
 * the console.
 */
export function reportPoolState(state: PoolState, nowMs = Date.now()): string | null {
  const { reason } = state;
  const changed = reason !== lastReason;
  const cooled = nowMs - lastWarnAt >= POOL_WARN_COOLDOWN_MS;

  // "ok" and "disabled" are not conditions to warn about; only the RECOVERY is worth a line.
  if (reason === "ok" || reason === "disabled") {
    lastReason = reason;
    if (!changed) return null;
    if (reason === "disabled") return null;
    const line = `[voip] media pool healthy again — ${state.eligible.length}/${state.total} node(s) accepting rooms`;
    console.log(line);
    return line;
  }

  if (!changed && !cooled) return null;
  lastReason = reason;
  lastWarnAt = nowMs;

  const line = poolWarningLine(state);
  console.warn(line);
  return line;
}

/** The wording, split out so it can be asserted directly and cannot drift from the reason. */
export function poolWarningLine(state: PoolState): string {
  const { total, live, draining, saturated } = state;
  switch (state.reason) {
    case "no-nodes":
      return "[voip] NO MEDIA NODE REGISTERED — every call is on the mesh (6 max). This is not a capacity problem: check that the node agent is running and can reach Redis.";
    case "all-stale":
      return `[voip] ALL ${total} MEDIA NODE(S) STALE — registered but not heartbeating, so every call is on the mesh. Check the agents and the clocks, not the capacity.`;
    case "all-draining":
      return `[voip] ALL ${draining} MEDIA NODE(S) DRAINING — no new rooms will be assigned; existing calls keep running. Clear the drain flag, or add a node.`;
    case "all-excluded":
      return `[voip] ALL ${live.length} LIVE MEDIA NODE(S) EXCLUDED — they heartbeat but are failing signaling (a wrong VOIP_NODE_SECRET does exactly this). Every call is on the mesh.`;
    case "all-saturated":
      return `[voip] MEDIA POOL SATURATED — ${saturated}/${live.length} live node(s) at their CPU or room ceiling, so new calls are falling back to the mesh (6 max). THIS is the signal to add a node.`;
    default:
      return `[voip] media pool unusable (${state.reason})`;
  }
}

/**
 * Start the refresh timer. Idempotent, and a no-op with no client.
 *
 * `unref` so it can never hold the process open — the same discipline the agent's own timers
 * use, and what keeps this from wedging a test runner or a graceful shutdown.
 */
export function startVoipPool(c: VoipRegistryClient | null): void {
  if (c) setVoipPoolClient(c);
  if (!client || timer) return;
  const tick = async () => {
    try {
      await refreshVoipPool();
      reportPoolState(poolState());
    } catch {
      /* A pool refresh must never throw into the timer: the pool going unread degrades
         calls to the mesh, and an unhandled rejection here would be a process-level event
         for what is a recoverable read. */
    }
  };
  void tick();
  timer = setInterval(tick, POOL_REFRESH_MS);
  timer.unref?.();
}

export function stopVoipPool(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

/** Test seam: forget every cached value AND the warning state. */
export function _resetVoipPoolForTests(): void {
  stopVoipPool();
  client = null;
  nodes = [];
  lastReadAt = 0;
  lastReason = null;
  lastWarnAt = 0;
}
