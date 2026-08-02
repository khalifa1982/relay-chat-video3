/**
 * #171 — THE ROUTER CAP IS A HARD ADMISSION GATE, not a preference.
 *
 * Owner, 2026-08-02: *"the assigner must treat the cap as hard admission — at cap, next node;
 * all nodes full → 1:1 falls back to P2P mesh, groups get 'busy.' Over-cap must be
 * unreachable, not merely discouraged."*
 *
 * WHY THESE ARE DRIVEN. The claim is about what a BURST of dials does against one snapshot,
 * and that is invisible in the text of any one function: `isNodeEligible` looked correct in
 * isolation (`n.routers < NODE_MAX_ROUTERS`) while the number it compared was a report up to
 * one refresh old, and `nodeLoadScore`'s correction for that was real, tested, and reached by
 * no production caller. So the sequence is fed through the real pool, the real selector and
 * the real `voipPendingRooms`.
 *
 * WHAT WAS ALREADY TRUE and is pinned rather than rebuilt: v2.106.59 already refuses a GROUP
 * call on `all-saturated` and already lets a 1:1 fall back to the mesh. The half that was
 * missing is that the fleet could be pushed PAST the ceiling in the first place.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { codeOnly } from "./testing/codeOnly";
import {
  NODE_CPU_CEILING,
  NODE_MAX_ROUTERS,
  PENDING_CONSUMER_WEIGHT,
  isNodeEligible,
  isNodeLive,
  nodeLoadScore,
  partitionNodes,
  pendingCountFor,
  planRoomTransport,
  selectVoipNode,
  type VoipNode,
} from "./voipRegistry";
import {
  _resetVoipPoolForTests,
  planDialTransport,
  poolPending,
  poolState,
  refreshVoipPool,
  setVoipPendingSource,
  setVoipPoolClient,
} from "./voipPool";
import {
  createRegistry,
  voipPendingRooms,
  _setActiveRegistryForTests,
  type RelayRegistry,
} from "./relay";

const ROOT = path.resolve(__dirname, "..");
const REG_SRC = fs.readFileSync(path.join(ROOT, "server/voipRegistry.ts"), "utf8");
const POOL_SRC = fs.readFileSync(path.join(ROOT, "server/voipPool.ts"), "utf8");
const RELAY_SRC = fs.readFileSync(path.join(ROOT, "server/relay.ts"), "utf8");
const CORE_SRC = fs.readFileSync(path.join(ROOT, "server/_core/index.ts"), "utf8");

const NOW = 1_700_000_000_000;
/* RFC 5737 documentation ranges (v2.106.52): this repo is public and a test must never carry a
   routable production address. */
const PRIVATE_IP = "192.0.2.20";
const PUBLIC_IP = "198.51.100.20";

function node(over: Partial<VoipNode> = {}): VoipNode {
  return {
    instanceId: "i-a",
    publicIp: PUBLIC_IP,
    privateIp: PRIVATE_IP,
    az: "ap-south-1a",
    cores: 2,
    workers: 2,
    routers: 0,
    consumers: 0,
    cpuLoad: 0.1,
    updatedAt: NOW,
    ...over,
  };
}

/** A node one room under its ceiling — the state the whole requirement is about. */
function almostFull(over: Partial<VoipNode> = {}): VoipNode {
  return node({ routers: NODE_MAX_ROUTERS - 1, ...over });
}

describe("#171 the ROOM CEILING excludes, and pending counts toward it", () => {
  it("a node one room under the ceiling is eligible with nothing pending", () => {
    expect(isNodeEligible(almostFull(), NOW)).toBe(true);
    expect(isNodeEligible(almostFull(), NOW, undefined, 0)).toBe(true);
  });

  it("ONE pending room takes the last slot — this is the requirement", () => {
    /* Over-cap UNREACHABLE, not discouraged: the node's own report says there is room, and the
       room we have already placed against that same report is what closes it. */
    expect(isNodeEligible(almostFull(), NOW, undefined, 1)).toBe(false);
  });

  it("pending is UNWEIGHTED here, unlike the load score", () => {
    /* One pending room is exactly one future router. Applying `PENDING_CONSUMER_WEIGHT` — which
       exists because `nodeLoadScore` measures CONSUMERS — would make the cap wrong by that
       factor, refusing at 38 rather than 39. */
    expect(PENDING_CONSUMER_WEIGHT).toBeGreaterThan(1);
    expect(isNodeEligible(node({ routers: NODE_MAX_ROUTERS - 2 }), NOW, undefined, 1)).toBe(true);
    // And the weighted reading would have refused it, so the two really do differ.
    expect(NODE_MAX_ROUTERS - 2 + PENDING_CONSUMER_WEIGHT).toBeGreaterThanOrEqual(NODE_MAX_ROUTERS);
  });

  it("pending does NOT move the CPU ceiling", () => {
    /* A pending room has no measured CPU cost. Inventing one would be a guess presented as a
       reading — and it would exclude healthy nodes during any burst. */
    const warm = node({ cpuLoad: NODE_CPU_CEILING - 0.01, routers: 0 });
    expect(isNodeEligible(warm, NOW, undefined, 5)).toBe(true);
    const hot = node({ cpuLoad: NODE_CPU_CEILING, routers: 0 });
    expect(isNodeEligible(hot, NOW, undefined, 0)).toBe(false);
  });

  it("pending cannot make a STALE or DRAINING node eligible", () => {
    const stale = almostFull({ updatedAt: NOW - 10 * 60_000 });
    expect(isNodeLive(stale, NOW)).toBe(false);
    expect(isNodeEligible(stale, NOW, undefined, 0)).toBe(false);
    expect(isNodeEligible(node({ draining: true }), NOW, undefined, 0)).toBe(false);
  });

  it("a garbage pending value reads as zero rather than throwing or excluding", () => {
    for (const bad of [undefined, null, NaN, Infinity, -3, "4", {}] as unknown[]) {
      expect(pendingCountFor({ "i-a": bad } as never, "i-a")).toBe(0);
    }
    expect(pendingCountFor(null, "i-a")).toBe(0);
    expect(pendingCountFor(new Map(), "i-a")).toBe(0);
    expect(pendingCountFor(new Map([["i-a", 3]]), "i-a")).toBe(3);
    expect(pendingCountFor({ "i-a": 3 }, "i-a")).toBe(3);
    expect(pendingCountFor({ "i-a": 3 }, "i-b")).toBe(0);
  });
});

describe("#171 at cap, NEXT NODE", () => {
  it("the burst moves to the second node instead of piling onto the first", () => {
    const nodes = [almostFull({ instanceId: "i-a" }), node({ instanceId: "i-b", routers: 5 })];
    // With nothing pending the emptier node already wins on load, so pick the case where the
    // ALMOST-FULL node is the one the ranking prefers: give it the lower consumer count.
    const skewed = [
      almostFull({ instanceId: "i-a", consumers: 0 }),
      node({ instanceId: "i-b", routers: 5, consumers: 40 }),
    ];
    expect(selectVoipNode(skewed, { nowMs: NOW })?.instanceId).toBe("i-a");
    /* One room placed against that same snapshot and the preference is irrelevant: i-a is out
       of the running entirely, which is what "at cap, next node" means. */
    expect(
      selectVoipNode(skewed, { nowMs: NOW, pending: { "i-a": 1 } })?.instanceId,
    ).toBe("i-b");
    expect(selectVoipNode(nodes, { nowMs: NOW, pending: { "i-a": 1 } })?.instanceId).toBe("i-b");
  });

  it("pending in the EXCLUSION is not the same as pending in the ranking", () => {
    /* THE MUTATION THIS EXISTS FOR: correcting only the score cannot bound a burst, because a
       score is a preference BETWEEN nodes and a single-node fleet has no alternative. The
       ranking-only reading returns the node; the exclusion refuses it. */
    const only = [almostFull()];
    expect(nodeLoadScore(only[0], 1)).toBeGreaterThan(nodeLoadScore(only[0], 0));
    expect(selectVoipNode(only, { nowMs: NOW, pending: { "i-a": 1 } })).toBeNull();
  });

  it("a whole burst against one snapshot cannot exceed the ceiling", () => {
    /* The sequence the requirement is written about: N dials, one snapshot, and the pending
       count derived from what has already been placed. The fleet has exactly TWO free slots. */
    const snapshot = [
      almostFull({ instanceId: "i-a" }),
      almostFull({ instanceId: "i-b" }),
    ];
    const placed = new Map<string, number>();
    const outcomes: Array<string | null> = [];
    for (let i = 0; i < 6; i++) {
      const n = selectVoipNode(snapshot, { nowMs: NOW, pending: placed });
      outcomes.push(n?.instanceId ?? null);
      if (n) placed.set(n.instanceId, (placed.get(n.instanceId) ?? 0) + 1);
    }
    // Two placements, then four honest refusals — never a third room on either node.
    expect(outcomes.filter(Boolean)).toHaveLength(2);
    expect(new Set(outcomes.filter(Boolean) as string[])).toEqual(new Set(["i-a", "i-b"]));
    expect(outcomes.slice(2)).toEqual([null, null, null, null]);
    for (const [id, count] of placed) {
      const rec = snapshot.find((s) => s.instanceId === id)!;
      expect(rec.routers + count).toBeLessThanOrEqual(NODE_MAX_ROUTERS);
    }
  });
});

describe("#171 all nodes full: 1:1 meshes, a GROUP is refused", () => {
  const saturatedByBurst = () => ({
    nodes: [almostFull({ instanceId: "i-a" }), almostFull({ instanceId: "i-b" })],
    pending: { "i-a": 1, "i-b": 1 },
  });

  it("the partition reports all-saturated, not ok", () => {
    const { nodes, pending } = saturatedByBurst();
    expect(partitionNodes(nodes, { nowMs: NOW }).reason).toBe("ok");
    const part = partitionNodes(nodes, { nowMs: NOW, pending });
    expect(part.reason).toBe("all-saturated");
    expect(part.eligible).toHaveLength(0);
    // Still LIVE — the ceiling withholds new work and never evicts the rooms that filled it.
    expect(part.live).toHaveLength(2);
    expect(part.saturated).toBe(2);
  });

  it("a 1:1 falls back to the mesh and is NOT refused", () => {
    const { nodes, pending } = saturatedByBurst();
    const p = planRoomTransport({ nodes, nowMs: NOW, pending, partySize: 2 });
    expect(p.transport).toBe("mesh");
    expect(p.voip).toBeNull();
    expect(p.refused).toBeNull();
    expect(p.reason).toBe("all-saturated");
  });

  it("a GROUP gets service-busy rather than a silently over-capacity mesh", () => {
    const { nodes, pending } = saturatedByBurst();
    const p = planRoomTransport({ nodes, nowMs: NOW, pending, partySize: 6 });
    expect(p.refused).toBe("pool-saturated");
    expect(p.transport).toBe("mesh");
    expect(p.voip).toBeNull();
  });

  it("the REASON cannot disagree with the selection", () => {
    /* `planRoomTransport` runs the funnel twice — once for the list, once for the reason — and
       the refusal is keyed on the reason. Leaving pending out of the second call would make the
       selector refuse a burst-saturated node while the reason still said `ok`, i.e. a group
       call quietly placed on the mesh instead of told to wait. */
    const { nodes, pending } = saturatedByBurst();
    const p = planRoomTransport({ nodes, nowMs: NOW, pending, partySize: 6 });
    expect(p.reason).toBe("all-saturated");
    const regionEnd = REG_SRC.indexOf("const transport = chooseCallTransport");
    const regionStart = REG_SRC.indexOf("const reason: PoolReason = off");
    expect(regionStart).toBeGreaterThan(0);
    expect(regionEnd).toBeGreaterThan(regionStart);
    expect(REG_SRC.slice(regionStart, regionEnd)).toMatch(/pending:\s*opts\.pending/);
  });

  it("a burst does NOT make an unrelated pool reason say saturated", () => {
    /* The v2.105.10 rule: a standing false alarm is what hides a real one. An empty registry
       still reports `no-nodes` however much is pending, because "add a node" and "your agent is
       not running" need different responses. */
    expect(partitionNodes([], { nowMs: NOW, pending: { "i-a": 9 } }).reason).toBe("no-nodes");
    const stale = [almostFull({ updatedAt: NOW - 10 * 60_000 })];
    expect(partitionNodes(stale, { nowMs: NOW, pending: { "i-a": 9 } }).reason).toBe("all-stale");
  });
});

describe("#171 the pending count is DERIVED from the rooms we placed", () => {
  let reg: RelayRegistry;
  beforeEach(() => {
    reg = createRegistry();
    _setActiveRegistryForTests(reg);
  });
  afterEach(() => _setActiveRegistryForTests(null));

  const meta = (voip: { instanceId: string; assignedAt: number } | null) =>
    ({
      hostPin: "111111",
      roster: new Map(),
      startedAt: NOW,
      ...(voip
        ? {
            voip: {
              instanceId: voip.instanceId,
              publicIp: PUBLIC_IP,
              privateIp: PRIVATE_IP,
              az: "ap-south-1a",
              assignedAt: voip.assignedAt,
            },
          }
        : {}),
    }) as never;

  it("counts one per room, keyed by the node it was placed on", () => {
    reg.roomMeta.set("r1", meta({ instanceId: "i-a", assignedAt: NOW + 10 }));
    reg.roomMeta.set("r2", meta({ instanceId: "i-a", assignedAt: NOW + 20 }));
    reg.roomMeta.set("r3", meta({ instanceId: "i-b", assignedAt: NOW + 30 }));
    const out = voipPendingRooms(NOW);
    expect(out.get("i-a")).toBe(2);
    expect(out.get("i-b")).toBe(1);
  });

  it("a MESH room counts toward nothing", () => {
    reg.roomMeta.set("r1", meta(null));
    expect(voipPendingRooms(NOW).size).toBe(0);
  });

  it("a room the node has ALREADY reported stops being pending", () => {
    /* This is what stops the correction double-counting. Once the snapshot is refreshed, the
       node's own `routers` figure includes the room, so counting it again here would refuse
       capacity that exists. The cutoff is the pool's own `lastReadAt`. */
    reg.roomMeta.set("r1", meta({ instanceId: "i-a", assignedAt: NOW }));
    expect(voipPendingRooms(NOW - 1).get("i-a")).toBe(1);
    expect(voipPendingRooms(NOW).size).toBe(0);
    expect(voipPendingRooms(NOW + 1).size).toBe(0);
  });

  it("a reaped room stops counting with no bookkeeping", () => {
    /* DERIVED, not accumulated: there is no decrement to forget, which is why a counter was
       rejected. */
    reg.roomMeta.set("r1", meta({ instanceId: "i-a", assignedAt: NOW + 10 }));
    expect(voipPendingRooms(NOW).get("i-a")).toBe(1);
    reg.roomMeta.delete("r1");
    expect(voipPendingRooms(NOW).size).toBe(0);
  });

  it("answers empty off the signaling node rather than guessing", () => {
    _setActiveRegistryForTests(null);
    expect(voipPendingRooms(0).size).toBe(0);
  });

  it("is NOT incremented per invite, which is why it is derived", () => {
    /* `planDialTransport` runs on EVERY invite, including an add-person invite into a call that
       already has its room — so incrementing there would count a six-party dial as six rooms
       and refuse at about seven real ones. Worse than the defect. Asserted as an absence at the
       one place the mistake would live. */
    const body = codeOnly(POOL_SRC);
    expect(body).not.toMatch(/pending\w*\.set\(/);
    expect(body).not.toMatch(/notePending|reservePending|pending\+\+|pending \+= /);
  });
});

describe("#171 the pool actually PASSES it — the inert-correction defect", () => {
  beforeEach(() => _resetVoipPoolForTests());
  afterEach(() => _resetVoipPoolForTests());

  /** The real `VoipRegistryClient` shape: an index SET plus one JSON value per node. */
  const client = (nodes: VoipNode[]) => {
    const store = new Map<string, string>();
    nodes.forEach((n) => store.set(`relay:voip:node:${n.instanceId}`, JSON.stringify(n)));
    return {
      smembers: async () => nodes.map((n) => n.instanceId),
      get: async (k: string) => store.get(k) ?? null,
      set: async () => "OK",
      sadd: async () => 1,
      srem: async () => 1,
      del: async () => 1,
    };
  };

  async function poolWith(nodes: VoipNode[]) {
    setVoipPoolClient(client(nodes) as never);
    await refreshVoipPool(NOW);
  }

  it("planDialTransport reaches the pending source", async () => {
    /* THE HEADLINE DEFECT. `nodeLoadScore` has taken a pending argument since v2.106.54 and no
       production caller ever supplied one, so the whole correction was dead code — a burst not
       only exceeded the ceiling, it also scored identically on every dial and therefore piled
       onto the SAME node rather than spreading. */
    await poolWith([almostFull({ instanceId: "i-a" })]);
    expect(planDialTransport({ nowMs: NOW, partySize: 2 }).transport).toBe("mediasoup");
    setVoipPendingSource(() => new Map([["i-a", 1]]));
    const p = planDialTransport({ nowMs: NOW, partySize: 2 });
    expect(p.transport).toBe("mesh");
    expect(p.voip).toBeNull();
  });

  it("a GROUP dial against a burst-saturated pool is refused through the real pool", async () => {
    await poolWith([almostFull({ instanceId: "i-a" })]);
    setVoipPendingSource(() => new Map([["i-a", 1]]));
    expect(planDialTransport({ nowMs: NOW, partySize: 6 }).refused).toBe("pool-saturated");
    expect(planDialTransport({ nowMs: NOW, partySize: 2 }).refused).toBeNull();
  });

  it("the source is handed the pool's own lastReadAt, so the cutoff is the snapshot", async () => {
    await poolWith([node()]);
    const seen: number[] = [];
    setVoipPendingSource((since) => {
      seen.push(since);
      return new Map();
    });
    poolPending();
    expect(seen).toEqual([NOW]);
  });

  it("FAILS OPEN: a throwing source drops the correction rather than refusing every call", async () => {
    /* The direction is stated because it is the wrong-looking one. Treating an unreadable count
       as "assume full" would let one broken counter refuse every call on the fleet — far worse
       than a bounded burst overshoot, which is what the pre-correction behaviour already was. */
    await poolWith([almostFull({ instanceId: "i-a" })]);
    setVoipPendingSource(() => {
      throw new Error("nope");
    });
    expect(poolPending()).toBeNull();
    expect(planDialTransport({ nowMs: NOW, partySize: 2 }).transport).toBe("mediasoup");
  });

  it("with no source at all the ceiling still applies to the node's own report", async () => {
    await poolWith([node({ instanceId: "i-a", routers: NODE_MAX_ROUTERS })]);
    expect(poolPending()).toBeNull();
    expect(planDialTransport({ nowMs: NOW, partySize: 2 }).transport).toBe("mesh");
    expect(poolState(NOW).reason).toBe("all-saturated");
  });

  it("poolState sees pending too, so the warning cannot describe a different pool", async () => {
    /* From the refresh timer this is empty anyway — the tick reads state right after installing
       a snapshot — but "true because of when it is called" is not a property, and `/api/health`
       and the admin diagnostics read this surface at arbitrary moments. */
    await poolWith([almostFull({ instanceId: "i-a" })]);
    expect(poolState(NOW).reason).toBe("ok");
    setVoipPendingSource(() => new Map([["i-a", 1]]));
    expect(poolState(NOW).reason).toBe("all-saturated");
  });

  it("the source is cleared by the test seam, so it cannot leak between files", async () => {
    setVoipPendingSource(() => new Map([["i-a", 99]]));
    _resetVoipPoolForTests();
    expect(poolPending()).toBeNull();
  });
});

describe("#171 structure: one reader, one wiring, and the residual named", () => {
  it("the exclusion and the ranking read the pending map through ONE function", () => {
    /* Two copies of "how many rooms have we just put here" is how the ceiling and the
       preference come to disagree about the same node, and then one of them is wrong about
       capacity while both look reasonable. */
    const body = codeOnly(REG_SRC);
    const decl = (body.match(/export function pendingCountFor\(/g) ?? []).length;
    expect(decl).toBe(1);
    // No second inline reader: the shape `p instanceof Map ? p.get(` must occur exactly once.
    expect((body.match(/instanceof Map \? \w+\.get\(/g) ?? []).length).toBe(1);
    expect(body).toMatch(/isNodeEligible\([^)]*pendingCountFor\(/s);
    expect(body).toMatch(/nodeLoadScore\(a, pendingCountFor\(/);
  });

  it("the router comparison is the only place pending enters the ceiling", () => {
    const body = codeOnly(REG_SRC);
    const start = body.indexOf("export function isNodeEligible(");
    expect(start).toBeGreaterThan(0);
    const fn = body.slice(start, body.indexOf("\n}", start));
    expect(fn).toMatch(/n\.routers \+ pendingRooms < NODE_MAX_ROUTERS/);
    // The CPU ceiling must NOT be adjusted by it.
    expect(fn).toMatch(/n\.cpuLoad < NODE_CPU_CEILING/);
    expect(fn).not.toMatch(/cpuLoad[^<]*pending/);
    // Unweighted — the consumers weight belongs to the score, not the cap.
    expect(fn).not.toMatch(/PENDING_CONSUMER_WEIGHT/);
  });

  it("the source is wired at the composition root, not at a call site", () => {
    /* Wiring it where `planDialTransport` is CALLED would be a step somebody can forget, and
       forgetting it means over-cap is reachable again — the property that must not be
       forgettable. */
    const core = codeOnly(CORE_SRC);
    expect(core).toMatch(/setVoipPendingSource\(voipPendingRooms\)/);
    expect((core.match(/setVoipPendingSource\(/g) ?? []).length).toBe(1);
    // relay.ts supplies the count and does not wire itself, so the pool keeps no relay import.
    expect(codeOnly(POOL_SRC)).not.toMatch(/from "\.\/relay"/);
    expect(codeOnly(RELAY_SRC)).not.toMatch(/setVoipPendingSource/);
  });

  it("RESIDUAL, recorded as a decision: the plan-to-creation window is not closed", () => {
    /* Stated rather than hidden. `planDialTransport` runs synchronously at the top of the
       invite handler, but the room — and therefore its `assignedAt` — is written inside
       `ensureDialRoom`, which on the party-line path runs AFTER an await. Two dials in flight
       through that resolver can both plan before either records, so each can take the same last
       slot. The window is one DB round trip (~1-5ms) against the ~5s snapshot window this
       release closes, so the overshoot goes from unbounded-per-refresh to bounded-by-in-flight.
       Closing it fully needs a reserve/commit/release on the dial path, which is a bigger change
       to call setup than the evidence currently justifies.
       THE PREMISE IS ASSERTED so this note cannot quietly become false: if the plan ever moves
       into the same synchronous block as the room's creation, this goes red and the residual
       should be re-read. */
    const body = codeOnly(RELAY_SRC);
    const plan = body.indexOf("planDialTransport({");
    const ensure = body.indexOf("const ensureDialRoom");
    expect(plan).toBeGreaterThan(0);
    expect(ensure).toBeGreaterThan(plan);
    // The assignment is recorded inside ensureDialRoom, i.e. downstream of the plan.
    const ensureBody = body.slice(ensure, body.indexOf("\n      };", ensure));
    expect(ensureBody).toMatch(/dialPlan\.voip \? \{ voip: dialPlan\.voip \}/);
  });
});
