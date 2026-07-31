/**
 * ADDING A MEDIA NODE MUST BE AN INFRASTRUCTURE STEP — the mechanism, driven.
 *
 * The owner's requirement: when a node is added later, the app starts using it with no code
 * change and no redeploy. That claim is only true if selection reads a LIVE registry, so
 * these tests are BEHAVIOURAL — they register nodes into a fake Redis, run the real reader
 * and the real selector, and assert what a room would actually be assigned. A source pin
 * cannot tell you whether a third node becomes eligible without a deploy, and that is the
 * whole feature.
 *
 * The five cases below are the owner doc's own verification list, in order, plus the two
 * defects this work turned up in code that already existed.
 *
 * ONE DEVIATION FROM THE DOC, STATED RATHER THAN QUIETLY IMPLEMENTED: it says three times
 * that saturation should fall back to the hosted SFU. That account was cancelled and the
 * code deleted in v2.106.53 on the owner's own instruction, so the fallback is the MESH.
 * The later instruction wins; nothing else about the requirement changes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  NODE_CPU_CEILING,
  NODE_INDEX_KEY,
  NODE_MAX_ROUTERS,
  NODE_TTL_MS,
  assignmentStillValid,
  decodeNode,
  encodeNode,
  isNodeEligible,
  isNodeLive,
  nodeKey,
  partitionNodes,
  planRoomTransport,
  selectVoipNode,
  type VoipNode,
  type VoipRegistryClient,
  type PoolReason,
} from "./voipRegistry";
import {
  _resetVoipPoolForTests,
  poolState,
  poolWarningLine,
  refreshVoipPool,
  reportPoolState,
  setVoipPoolClient,
  type PoolState,
} from "./voipPool";

const NOW = 1_800_000_000_000;

/** RFC 5737 documentation addresses — never routable, so no production IP is in this file. */
function node(over: Partial<VoipNode> & { instanceId: string }): VoipNode {
  return {
    publicIp: "192.0.2.10",
    privateIp: "198.51.100.10",
    az: "ap-south-1a",
    cores: 2,
    routers: 0,
    consumers: 0,
    cpuLoad: 0.1,
    updatedAt: NOW,
    ...over,
  };
}

/** A fake Redis holding exactly the four commands the registry uses. */
function fakeRedis(): VoipRegistryClient & { store: Map<string, string>; set_: Set<string> } {
  const store = new Map<string, string>();
  const set_ = new Set<string>();
  return {
    store,
    set_,
    async smembers() {
      return [...set_];
    },
    async get(k) {
      return store.get(k) ?? null;
    },
    async mget(keys) {
      return keys.map((k) => store.get(k) ?? null);
    },
    async set(k, v) {
      store.set(k, v);
      return "OK";
    },
    async sadd(k, m) {
      set_.add(m);
      return 1;
    },
    async srem(k, m) {
      set_.delete(m);
      return 1;
    },
    async del(k) {
      store.delete(k);
      return 1;
    },
  };
}

/** Put a node in the registry the way the agent's heartbeat does. */
async function register(r: ReturnType<typeof fakeRedis>, n: VoipNode) {
  r.store.set(nodeKey(n.instanceId), encodeNode(n));
  r.set_.add(n.instanceId);
}

/**
 * A real `PoolState` for the reporting tests.
 *
 * Built properly rather than `{...poolState(), reason} as never`: casting through `never`
 * would keep these green if the shape ever changed underneath them, which is the opposite
 * of what a test about the wording should do.
 */
function state(over: Partial<PoolState> & { reason: PoolReason }): PoolState {
  return {
    eligible: [],
    live: [],
    total: 0,
    draining: 0,
    saturated: 0,
    ageMs: 0,
    configured: true,
    ...over,
  };
}

beforeEach(() => {
  _resetVoipPoolForTests();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  _resetVoipPoolForTests();
  vi.restoreAllMocks();
});

describe("doc §1 — rooms distribute across whatever nodes exist", () => {
  it("the busier node is skipped, so several rooms spread by load", async () => {
    const r = fakeRedis();
    await register(r, node({ instanceId: "i-a", consumers: 0 }));
    await register(r, node({ instanceId: "i-b", consumers: 12, az: "ap-south-1b" }));
    setVoipPoolClient(r);
    await refreshVoipPool(NOW);

    const plan = planRoomTransport({ nodes: poolState(NOW).live, nowMs: NOW });
    expect(plan.transport).toBe("mediasoup");
    expect(plan.voip?.instanceId).toBe("i-a");
  });

  it("a room's assignment carries BOTH addresses, each named for its own plane", async () => {
    /* The rule is signaling over the private address and public for media only. An
       assignment recording just the public IP leaves the next signaling caller nothing else
       to reach the node by, so it would get used — crossing the line on the way. */
    const r = fakeRedis();
    await register(r, node({ instanceId: "i-a", publicIp: "192.0.2.7", privateIp: "198.51.100.7" }));
    setVoipPoolClient(r);
    await refreshVoipPool(NOW);
    const plan = planRoomTransport({ nodes: poolState(NOW).live, nowMs: NOW });
    expect(plan.voip?.publicIp).toBe("192.0.2.7");
    expect(plan.voip?.privateIp).toBe("198.51.100.7");
  });

  it("every participant of one room gets ONE node — the plan is per room, not per person", () => {
    /* Rooms are pinned. This is the property that makes that expressible: the assignment is
       a value the room carries, so there is one answer to hand every joiner. */
    const nodes = [node({ instanceId: "i-a" }), node({ instanceId: "i-b" })];
    const plan = planRoomTransport({ nodes, nowMs: NOW });
    expect(plan.voip).not.toBeNull();
    // Re-reading the same assignment cannot produce a different node.
    expect(plan.voip?.instanceId).toBe(selectVoipNode(nodes, { nowMs: NOW })?.instanceId);
  });
});

describe("doc §2 — a dead node leaves the pool on its own", () => {
  it("its key expires, it stops being selected, and the survivor keeps serving", async () => {
    const r = fakeRedis();
    await register(r, node({ instanceId: "i-a" }));
    await register(r, node({ instanceId: "i-b" }));
    setVoipPoolClient(r);
    await refreshVoipPool(NOW);
    expect(poolState(NOW).eligible).toHaveLength(2);

    // The agent dies: Redis expires the key. The index entry lingers until pruned.
    r.store.delete(nodeKey("i-a"));
    await refreshVoipPool(NOW + 1000);

    const st = poolState(NOW + 1000);
    expect(st.eligible.map((n) => n.instanceId)).toEqual(["i-b"]);
    expect(selectVoipNode(st.live, { nowMs: NOW + 1000 })?.instanceId).toBe("i-b");
  });

  it("a node that stops heartbeating without its key expiring is ALSO refused", async () => {
    /* Key presence is the weaker claim; the record's own `updatedAt` is the real one. A key
       whose TTL was refreshed by something other than a heartbeat must not read as alive. */
    const r = fakeRedis();
    await register(r, node({ instanceId: "i-a", updatedAt: NOW }));
    setVoipPoolClient(r);
    await refreshVoipPool(NOW);
    const later = NOW + NODE_TTL_MS + 1;
    expect(poolState(later).eligible).toHaveLength(0);
    expect(poolState(later).reason).toBe("all-stale");
  });
});

describe("doc §3 — a THIRD node needs no deploy", () => {
  it("a node that registers after boot is eligible on the very next room", async () => {
    const r = fakeRedis();
    await register(r, node({ instanceId: "i-a", consumers: 20 }));
    await register(r, node({ instanceId: "i-b", consumers: 20 }));
    setVoipPoolClient(r);
    await refreshVoipPool(NOW);
    expect(poolState(NOW).total).toBe(2);

    // Infrastructure launches a third box. Nothing in the app is touched.
    await register(r, node({ instanceId: "i-c", consumers: 0, az: "ap-south-1c" }));
    await refreshVoipPool(NOW + 5000);

    const st = poolState(NOW + 5000);
    expect(st.total).toBe(3);
    // And because it is the least loaded, the next room goes to it.
    const plan = planRoomTransport({ nodes: st.live, nowMs: NOW + 5000 });
    expect(plan.voip?.instanceId).toBe("i-c");
  });

  it("nothing anywhere holds a node list — the pool is only what the registry says", async () => {
    /* The claim "no config edit" is only true if there is no config to edit. An empty
       registry must yield an empty pool rather than some baked-in default. */
    const r = fakeRedis();
    setVoipPoolClient(r);
    await refreshVoipPool(NOW);
    expect(poolState(NOW).total).toBe(0);
    expect(poolState(NOW).reason).toBe("no-nodes");
  });
});

describe("doc §4 — saturation is LOUD, and says the right thing", () => {
  it("all nodes over their ceiling reads as SATURATED and falls back to the mesh", () => {
    const hot = [
      node({ instanceId: "i-a", cpuLoad: NODE_CPU_CEILING }),
      node({ instanceId: "i-b", routers: NODE_MAX_ROUTERS }),
    ];
    const part = partitionNodes(hot, { nowMs: NOW });
    expect(part.reason).toBe("all-saturated");
    expect(part.saturated).toBe(2);
    const plan = planRoomTransport({ nodes: hot, nowMs: NOW });
    expect(plan.transport).toBe("mesh");
    expect(plan.voip).toBeNull();
    expect(plan.reason).toBe("all-saturated");
  });

  it("AN EMPTY POOL IS NOT REPORTED AS SATURATION — the false-alarm case", () => {
    /* This is the whole reason the reason exists. Both situations are an empty eligible
       list; telling an operator to add capacity when the AGENT IS NOT RUNNING sends them to
       launch a second box that also fails to register. */
    const empty = poolWarningLine(state({ reason: "no-nodes" }));
    expect(empty).toMatch(/not a capacity problem/i);
    expect(empty).not.toMatch(/saturated/i);

    const sat = poolWarningLine(
      state({
        reason: "all-saturated",
        saturated: 2,
        live: [node({ instanceId: "i-a" }), node({ instanceId: "i-b" })],
      }),
    );
    expect(sat).toMatch(/SATURATED/);
    expect(sat, "only this one should tell somebody to add a node").toMatch(/add a node/i);
  });

  it("each reason names its own action, so no two send you to the same place", () => {
    const reasons = ["no-nodes", "all-stale", "all-draining", "all-excluded", "all-saturated"] as const;
    const lines = reasons.map((reason) =>
      poolWarningLine(state({ reason, live: [node({ instanceId: "i-a" })] })),
    );
    expect(new Set(lines).size, "every reason must read differently").toBe(reasons.length);
    // The wrong-secret case has to name the variable, or it is unactionable.
    expect(lines[3]).toMatch(/VOIP_NODE_SECRET/);
  });

  it("the warning fires on the TRANSITION and then holds its tongue", () => {
    const sat = state({ reason: "all-saturated", live: [node({ instanceId: "i-a" })] });
    expect(reportPoolState(sat, NOW), "first sight must speak").toBeTruthy();
    expect(reportPoolState(sat, NOW + 1000), "same condition, inside cooldown").toBeNull();
    expect(reportPoolState(sat, NOW + 6 * 60_000), "still broken after 5min").toBeTruthy();
  });

  it("…and RECOVERY is logged too, so the story has an end", () => {
    const sat = state({ reason: "all-saturated", live: [node({ instanceId: "i-a" })] });
    reportPoolState(sat, NOW);
    const ok = reportPoolState(state({ reason: "ok" }), NOW + 1000);
    expect(ok).toMatch(/healthy again/i);
  });

  it("a healthy pool is SILENT — no line per refresh", () => {
    const ok = state({ reason: "ok" });
    reportPoolState(ok, NOW);
    expect(reportPoolState(ok, NOW + 5000)).toBeNull();
    expect(reportPoolState(ok, NOW + 10 * 60_000)).toBeNull();
  });
});

describe("doc §5 — draining retires a node WITHOUT cutting its live calls", () => {
  const draining = node({ instanceId: "i-a", draining: true });

  it("no new room is assigned to it", () => {
    expect(isNodeEligible(draining, NOW)).toBe(false);
    expect(selectVoipNode([draining], { nowMs: NOW })).toBeNull();
    expect(partitionNodes([draining], { nowMs: NOW }).reason).toBe("all-draining");
  });

  it("THE FLAG SURVIVES THE WHOLE ROUND TRIP — agent record to selector", async () => {
    /* FOUND BY MUTATION: every other draining test here builds the node in MEMORY, so
       `decodeNode` returning a hardcoded `draining: false` — which makes the entire feature
       a silent no-op — passed all of them. The flag's whole journey is agent -> JSON ->
       Redis -> decode -> select, and only driving that path can tell you it arrives. */
    const r = fakeRedis();
    await register(r, node({ instanceId: "i-a", draining: true }));
    await register(r, node({ instanceId: "i-b", consumers: 40 }));
    setVoipPoolClient(r);
    await refreshVoipPool(NOW);

    const st = poolState(NOW);
    expect(st.live.find((n) => n.instanceId === "i-a")?.draining, "decoded off the wire").toBe(true);
    expect(st.draining).toBe(1);
    // The far busier sibling still wins, because draining is not a load signal.
    expect(planRoomTransport({ nodes: st.live, nowMs: NOW }).voip?.instanceId).toBe("i-b");
  });

  it("…and a whole pool of drained nodes reads as all-draining through the registry", async () => {
    const r = fakeRedis();
    await register(r, node({ instanceId: "i-a", draining: true }));
    await register(r, node({ instanceId: "i-b", draining: true }));
    setVoipPoolClient(r);
    await refreshVoipPool(NOW);
    const st = poolState(NOW);
    expect(st.reason).toBe("all-draining");
    expect(planRoomTransport({ nodes: st.live, nowMs: NOW }).transport).toBe("mesh");
  });

  it("BUT ITS EXISTING ROOMS KEEP RUNNING — the point of the whole feature", () => {
    /* The trap: one shared predicate would make draining EVICT the calls draining exists
       to preserve. Liveness and eligibility have to disagree here, and this is the
       assertion that they do. */
    expect(isNodeLive(draining, NOW)).toBe(true);
    const assignment = {
      instanceId: "i-a",
      publicIp: draining.publicIp,
      privateIp: draining.privateIp,
      az: draining.az,
      assignedAt: NOW - 60_000,
    };
    expect(assignmentStillValid(assignment, [draining], NOW)).toBe(true);
  });

  it("an undrained sibling takes the new rooms while the draining one finishes", () => {
    const nodes = [draining, node({ instanceId: "i-b", consumers: 30 })];
    // i-b is far busier and still wins, because draining is not a load signal.
    expect(selectVoipNode(nodes, { nowMs: NOW })?.instanceId).toBe("i-b");
  });

  it("clearing the flag puts it straight back in rotation", () => {
    const back = node({ instanceId: "i-a", draining: false, consumers: 0 });
    expect(selectVoipNode([back, node({ instanceId: "i-b", consumers: 9 })], { nowMs: NOW })?.instanceId).toBe("i-a");
  });

  it("an ABSENT flag means serving, so an older agent is not silently retired", () => {
    /* Reading absent as draining would halve a two-node fleet the moment one box lagged a
       deploy, with nothing saying why. */
    const legacy = decodeNode(
      JSON.stringify({ ...node({ instanceId: "i-a" }), draining: undefined }),
    );
    expect(legacy?.draining).toBe(false);
    expect(isNodeEligible(legacy as VoipNode, NOW)).toBe(true);
  });

  it("the STRING \"false\" does not retire a node either", () => {
    // A flag written by a shell is exactly how this arrives wrong.
    const n = decodeNode(JSON.stringify({ ...node({ instanceId: "i-a" }), draining: "false" }));
    expect(n?.draining).toBe(false);
    expect(isNodeEligible(n as VoipNode, NOW)).toBe(true);
  });
});

describe("the admission-vs-liveness split — a defect this work found in existing code", () => {
  const busy = node({ instanceId: "i-a", routers: NODE_MAX_ROUTERS });
  const live = {
    instanceId: "i-a",
    publicIp: busy.publicIp,
    privateIp: busy.privateIp,
    az: busy.az,
    assignedAt: NOW - 60_000,
  };

  it("a node at its ROOM ceiling keeps the rooms that put it there", () => {
    /* `routers >= NODE_MAX_ROUTERS` means forty LIVE rooms. The old shared predicate
       declared all forty invalid — the ceiling evicting the very calls it protects. A
       pre-existing test pinned that, with a comment arguing for it. */
    expect(isNodeEligible(busy, NOW)).toBe(false);
    expect(assignmentStillValid(live, [busy], NOW)).toBe(true);
  });

  it("…and so does a node at its CPU ceiling", () => {
    const hot = node({ instanceId: "i-a", cpuLoad: NODE_CPU_CEILING + 0.1 });
    expect(isNodeEligible(hot, NOW)).toBe(false);
    expect(assignmentStillValid(live, [hot], NOW)).toBe(true);
  });

  it("but a genuinely DEAD node still loses its rooms", () => {
    // The split must not become "assignments are valid forever".
    expect(assignmentStillValid(live, [node({ instanceId: "i-a", updatedAt: NOW - 60_000 })], NOW)).toBe(false);
  });

  it("and a RESTARTED node still loses them, which is what the IP comparison is for", () => {
    expect(assignmentStillValid(live, [node({ instanceId: "i-a", publicIp: "192.0.2.99" })], NOW)).toBe(false);
  });
});

describe("the funnel names the stage that ran out, not a guess about the pool", () => {
  it("stale beats saturated: broken agents are not a capacity story", () => {
    const nodes = [
      node({ instanceId: "i-a", updatedAt: NOW - 60_000, cpuLoad: 0.99 }),
      node({ instanceId: "i-b", updatedAt: NOW - 60_000 }),
    ];
    expect(partitionNodes(nodes, { nowMs: NOW }).reason).toBe("all-stale");
  });

  it("a mix reports SATURATED when a live, willing node is merely full", () => {
    /* This is the actionable one: if even one node is fresh, undrained and over its
       ceiling, that IS the add-a-node signal, whatever the other nodes are doing. */
    const nodes = [
      node({ instanceId: "i-a", updatedAt: NOW - 60_000 }),
      node({ instanceId: "i-b", cpuLoad: NODE_CPU_CEILING }),
    ];
    expect(partitionNodes(nodes, { nowMs: NOW }).reason).toBe("all-saturated");
  });

  it("an EXCLUDED node (bad secret) is not reported as saturation", () => {
    const nodes = [node({ instanceId: "i-a" })];
    const part = partitionNodes(nodes, { nowMs: NOW, excludeInstanceIds: ["i-a"] });
    expect(part.reason).toBe("all-excluded");
    expect(part.saturated).toBe(0);
  });

  it("the transport opt-out is reported as DISABLED, not as a capacity failure", () => {
    const plan = planRoomTransport({ nodes: [node({ instanceId: "i-a" })], nowMs: NOW, forceMesh: true });
    expect(plan.transport).toBe("mesh");
    expect(plan.reason).toBe("disabled");
  });

  it("ONE filter feeds both the selector and the warning", () => {
    /* Two copies of "which nodes may take a room" is how the selector and the saturation
       warning come to disagree — and then the warning is either crying wolf or silent. */
    const nodes = [node({ instanceId: "i-a", cpuLoad: NODE_CPU_CEILING }), node({ instanceId: "i-b" })];
    const part = partitionNodes(nodes, { nowMs: NOW });
    const ranked = selectVoipNode(nodes, { nowMs: NOW });
    expect(part.eligible.map((n) => n.instanceId)).toEqual(["i-b"]);
    expect(ranked?.instanceId).toBe("i-b");
  });
});

describe("the pool degrades rather than misleads", () => {
  it("with no Redis it is dormant and every call takes the mesh", async () => {
    setVoipPoolClient(null);
    await refreshVoipPool(NOW);
    const st = poolState(NOW);
    expect(st.configured).toBe(false);
    expect(st.total).toBe(0);
    expect(planRoomTransport({ nodes: st.live, nowMs: NOW }).transport).toBe("mesh");
  });

  it("a Redis blip does not empty the pool and dump every call onto the mesh", async () => {
    const r = fakeRedis();
    await register(r, node({ instanceId: "i-a" }));
    setVoipPoolClient(r);
    await refreshVoipPool(NOW);
    expect(poolState(NOW).total).toBe(1);

    // `readVoipNodes` fails to an empty list, which must not be cached as truth.
    const broken: VoipRegistryClient = {
      ...r,
      async smembers() {
        throw new Error("connection reset");
      },
    };
    setVoipPoolClient(broken);
    await refreshVoipPool(NOW + 1000);
    expect(poolState(NOW + 1000).total, "the last known list is kept").toBe(1);
  });

  it("…but a persistent outage lets the pool age out rather than pretending forever", async () => {
    const r = fakeRedis();
    await register(r, node({ instanceId: "i-a" }));
    setVoipPoolClient(r);
    await refreshVoipPool(NOW);

    const broken: VoipRegistryClient = {
      ...r,
      async smembers() {
        throw new Error("still down");
      },
    };
    setVoipPoolClient(broken);
    await refreshVoipPool(NOW + 60_000);
    expect(poolState(NOW + 60_000).total).toBe(0);
  });

  it("a stale CACHE is refused at the decision, not trusted because it was cached", async () => {
    /* The freshness check runs with the CALLER's clock at use time, which is what makes
       caching safe: an aged record degrades to the mesh, never to "send media to a dead
       box". */
    const r = fakeRedis();
    await register(r, node({ instanceId: "i-a", updatedAt: NOW }));
    setVoipPoolClient(r);
    await refreshVoipPool(NOW);
    const late = NOW + NODE_TTL_MS + 5000;
    expect(poolState(late).live).toHaveLength(0);
    expect(planRoomTransport({ nodes: poolState(late).live, nowMs: late }).transport).toBe("mesh");
  });

  it("the index is pruned of members whose record is gone", async () => {
    const r = fakeRedis();
    r.set_.add("i-ghost");
    setVoipPoolClient(r);
    await refreshVoipPool(NOW);
    expect([...r.set_], "a rotting index makes every read do dead work").not.toContain("i-ghost");
  });
});
