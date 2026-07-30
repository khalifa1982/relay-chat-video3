/**
 * The mediasoup registry's decisions, DRIVEN rather than pinned.
 *
 * Every claim here is about what a set of node records RESOLVES to — which node a room
 * lands on, whether a stale node is believed, which transport a call ends up using — and
 * a source pin cannot answer any of those. There is no Redis, no VPC and no media node in
 * this environment, which is exactly why the module was written pure with an injected
 * client: the arithmetic is the part that can be got wrong silently, and it is the part
 * that is checkable here.
 *
 * WHAT THIS DELIBERATELY DOES NOT CLAIM: that media flows. Nobody has joined a room on a
 * real node from this sandbox.
 */
import { describe, expect, it } from "vitest";
import {
  chooseCallTransport,
  decodeNode,
  deregisterVoipNode,
  encodeNode,
  heartbeatVoipNode,
  isIpv4,
  isNodeFresh,
  isNodeUsable,
  NODE_CPU_CEILING,
  NODE_HEARTBEAT_MS,
  NODE_INDEX_KEY,
  NODE_TTL_MS,
  nodeKey,
  nodeLoadScore,
  readVoipNodes,
  selectVoipNode,
  transportCap,
  type VoipNode,
  type VoipRegistryClient,
} from "./voipRegistry";

const NOW = 1_785_000_000_000;

/** The two real nodes, as the brief measured them. */
const A = (over: Partial<VoipNode> = {}): VoipNode => ({
  instanceId: "i-062022390e558ce74",
  publicIp: "13.201.44.153",
  privateIp: "10.0.1.192",
  az: "ap-south-1a",
  cores: 2,
  routers: 0,
  consumers: 0,
  cpuLoad: 0.1,
  updatedAt: NOW,
  ...over,
});
const B = (over: Partial<VoipNode> = {}): VoipNode => ({
  instanceId: "i-0dce71f5056f73ce6",
  publicIp: "13.203.219.67",
  privateIp: "10.0.2.246",
  az: "ap-south-1b",
  cores: 2,
  routers: 0,
  consumers: 0,
  cpuLoad: 0.1,
  updatedAt: NOW,
  ...over,
});

describe("a node record is validated because it decides where media goes", () => {
  it("round-trips a real record", () => {
    expect(decodeNode(encodeNode(A()))).toEqual(A());
  });

  it("a garbage or truncated record is dropped WHOLE, never partially applied", () => {
    for (const bad of ["", "{", "null", "[]", '"x"', "{}"]) {
      expect(decodeNode(bad), bad).toBeNull();
    }
  });

  it("a record with a bad IP is refused, not repaired", () => {
    /* The IP is handed to a browser as the address to send media to. A garbage value is a
       call that silently never connects; a value under someone else's control would be a
       redirection of somebody's media. Refusing costs one node's capacity, which is the
       cheaper failure by a wide margin. */
    for (const ip of ["", "1.2.3", "1.2.3.4.5", "256.1.1.1", "1.2.3.-1", "01.2.3.4", "abc", "10.0.0.1/24"]) {
      expect(decodeNode(encodeNode(A({ publicIp: ip as string }))), ip).toBeNull();
      expect(decodeNode(encodeNode(A({ privateIp: ip as string }))), ip).toBeNull();
    }
    expect(isIpv4("13.201.44.153")).toBe(true);
    expect(isIpv4("0.0.0.0")).toBe(true);
  });

  it("a record with impossible counts is refused", () => {
    expect(decodeNode(encodeNode(A({ cores: 0 })))).toBeNull();
    expect(decodeNode(encodeNode(A({ consumers: -1 })))).toBeNull();
    expect(decodeNode(encodeNode(A({ updatedAt: 0 })))).toBeNull();
    expect(decodeNode(encodeNode(A({ cpuLoad: Number.NaN })))).toBeNull();
  });
});

describe("freshness is judged on the node's own timestamp", () => {
  it("a record inside the TTL is fresh and one past it is not", () => {
    expect(isNodeFresh(A({ updatedAt: NOW - 1000 }), NOW)).toBe(true);
    expect(isNodeFresh(A({ updatedAt: NOW - NODE_TTL_MS + 1 }), NOW)).toBe(true);
    expect(isNodeFresh(A({ updatedAt: NOW - NODE_TTL_MS - 1 }), NOW)).toBe(false);
  });

  it("a clock that has run BACKWARDS reads as stale, not as infinitely fresh", () => {
    /* The failure that matters is believing a dead node is alive — a room assigned to it
       is a call that cannot connect. A future timestamp is evidence something is wrong,
       so it must not be evidence of health. */
    expect(isNodeFresh(A({ updatedAt: NOW + 60_000 }), NOW)).toBe(false);
  });

  it("the heartbeat fits three times inside the TTL, so one lost beat survives", () => {
    expect(NODE_HEARTBEAT_MS * 3).toBeLessThanOrEqual(NODE_TTL_MS);
  });

  it("a saturated node is UNUSABLE even while fresh", () => {
    // Two independent reasons to skip a node, and they must not collapse into one.
    const hot = A({ cpuLoad: NODE_CPU_CEILING });
    expect(isNodeFresh(hot, NOW)).toBe(true);
    expect(isNodeUsable(hot, NOW)).toBe(false);
    expect(isNodeUsable(A({ cpuLoad: NODE_CPU_CEILING - 0.01 }), NOW)).toBe(true);
  });
});

describe("selecting a node for a new room", () => {
  it("returns null when there is nothing usable — the caller must fall back", () => {
    expect(selectVoipNode([], { nowMs: NOW })).toBeNull();
    expect(selectVoipNode([A({ updatedAt: NOW - 60_000 })], { nowMs: NOW })).toBeNull();
    expect(selectVoipNode([A({ cpuLoad: 0.99 })], { nowMs: NOW })).toBeNull();
  });

  it("picks the less loaded node", () => {
    const chosen = selectVoipNode([A({ consumers: 40 }), B({ consumers: 4 })], { nowMs: NOW });
    expect(chosen?.instanceId).toBe(B().instanceId);
  });

  it("load is per CORE, so a bigger node correctly attracts more rooms", () => {
    /* The documented scaling path is to grow cores before adding nodes, so an absolute
       consumer count would send rooms away from the node that was just upgraded. */
    const small = A({ cores: 2, consumers: 10 }); // 5.0 per core
    const big = B({ cores: 8, consumers: 24 }); //   3.0 per core
    expect(nodeLoadScore(small)).toBeGreaterThan(nodeLoadScore(big));
    expect(selectVoipNode([small, big], { nowMs: NOW })?.instanceId).toBe(big.instanceId);
  });

  it("prefers the caller's zone when the two nodes are comparably loaded", () => {
    const chosen = selectVoipNode([A({ consumers: 2 }), B({ consumers: 2 })], {
      nowMs: NOW,
      preferAz: "ap-south-1b",
    });
    expect(chosen?.instanceId).toBe(B().instanceId);
  });

  it("but LOAD beats zone preference once the gap is real", () => {
    /* Zone locality is worth a little and worth less than not putting a room on a node
       carrying far more work — a room in the right zone on a saturating node is a worse
       call than a room one zone away. The threshold is explicit rather than implied. */
    const chosen = selectVoipNode([A({ consumers: 0 }), B({ consumers: 40 })], {
      nowMs: NOW,
      preferAz: "ap-south-1b",
    });
    expect(chosen?.instanceId).toBe(A().instanceId);
  });

  it("is STABLE on an idle fleet rather than alternating between equal nodes", () => {
    // Consecutive rooms bouncing between identical nodes for no reason is churn that
    // shows up as rooms scattered across zones with no benefit.
    const picks = new Set(
      Array.from({ length: 5 }, () => selectVoipNode([B(), A()], { nowMs: NOW })?.instanceId),
    );
    expect(picks.size).toBe(1);
  });

  it("never returns a stale node even when it is the least loaded", () => {
    // The tempting bug: rank first, filter later. An idle DEAD node looks perfect.
    const dead = A({ consumers: 0, updatedAt: NOW - 60_000 });
    const live = B({ consumers: 30 });
    expect(selectVoipNode([dead, live], { nowMs: NOW })?.instanceId).toBe(live.instanceId);
  });
});

describe("the transport precedence FAILS OPEN — a call is always possible", () => {
  it("mediasoup when a node is usable", () => {
    expect(chooseCallTransport({ mediasoupNode: A(), livekitEnabled: true })).toBe("mediasoup");
  });

  it("LiveKit when no node is usable but LiveKit is configured", () => {
    expect(chooseCallTransport({ mediasoupNode: null, livekitEnabled: true })).toBe("livekit");
  });

  it("the MESH when neither is available, because it needs no infrastructure", () => {
    /* This is the floor and the reason the function cannot return "nothing": a Redis
       hiccup, an unconfigured SFU or a saturated fleet must degrade the call's QUALITY,
       never remove the ability to place it. */
    expect(chooseCallTransport({ mediasoupNode: null, livekitEnabled: false })).toBe("mesh");
  });

  it("never answers with anything outside the three transports", () => {
    const all = new Set<string>();
    for (const node of [A(), null]) {
      for (const livekitEnabled of [true, false]) {
        for (const forceLivekit of [true, false, undefined]) {
          for (const mediasoupEnabled of [true, false, undefined]) {
            all.add(
              chooseCallTransport({ mediasoupNode: node, livekitEnabled, forceLivekit, mediasoupEnabled }),
            );
          }
        }
      }
    }
    expect([...all].sort()).toEqual(["livekit", "mediasoup", "mesh"]);
  });

  it("the A/B override sends a call to LiveKit even with a healthy node", () => {
    // Staged rollout and A/B need this: the two transports must be comparable on one
    // account with numbers, which is the only way "video degrades" gets an answer.
    expect(
      chooseCallTransport({ mediasoupNode: A(), livekitEnabled: true, forceLivekit: true }),
    ).toBe("livekit");
  });

  it("the fleet kill switch does not strand the call", () => {
    expect(
      chooseCallTransport({ mediasoupNode: A(), livekitEnabled: true, mediasoupEnabled: false }),
    ).toBe("livekit");
    expect(
      chooseCallTransport({ mediasoupNode: A(), livekitEnabled: false, mediasoupEnabled: false }),
    ).toBe("mesh");
  });

  it("an SFU raises the cap; the mesh keeps its six", () => {
    /* On the mesh each phone runs N-1 encoders and N-1 decoders — v2.99.84 measured that
       as the biggest lever on call CPU and heat. An SFU decouples cost from party size,
       so the SFU paths get 10. mediasoup is deliberately NOT given more than LiveKit: the
       nodes are 2-core and the real ceiling has to come from load testing. */
    expect(transportCap("mesh")).toBe(6);
    expect(transportCap("livekit")).toBe(10);
    expect(transportCap("mediasoup")).toBe(transportCap("livekit"));
  });
});

/** A recording fake, so the read path can be driven without Redis. */
function fakeClient(records: Record<string, string>, index: string[]) {
  const calls: string[] = [];
  const client: VoipRegistryClient = {
    async smembers(key) {
      calls.push(`smembers ${key}`);
      return key === NODE_INDEX_KEY ? [...index] : [];
    },
    async get(key) {
      calls.push(`get ${key}`);
      return records[key] ?? null;
    },
    async set(key, value, _mode, ttl) {
      calls.push(`set ${key} ${ttl}`);
      records[key] = value;
      return "OK";
    },
    async sadd(key, member) {
      calls.push(`sadd ${key} ${member}`);
      if (!index.includes(member)) index.push(member);
      return 1;
    },
    async srem(key, member) {
      calls.push(`srem ${key} ${member}`);
      const i = index.indexOf(member);
      if (i >= 0) index.splice(i, 1);
      return 1;
    },
    async del(key) {
      calls.push(`del ${key}`);
      delete records[key];
      return 1;
    },
  };
  return { client, calls, records, index };
}

describe("reading the registry fails to EMPTY, never throws", () => {
  it("no client at all reads as no nodes", async () => {
    expect(await readVoipNodes(null)).toEqual([]);
  });

  it("a Redis error reads as no nodes, so a blip is a fallback and not a failed call", async () => {
    const client = {
      smembers: async () => {
        throw new Error("connection reset");
      },
    } as unknown as VoipRegistryClient;
    expect(await readVoipNodes(client)).toEqual([]);
  });

  it("returns the valid records and prunes an index entry whose record is gone", async () => {
    const f = fakeClient({ [nodeKey(A().instanceId)]: encodeNode(A()) }, [
      A().instanceId,
      "i-longdeadnode",
    ]);
    const nodes = await readVoipNodes(f.client);
    expect(nodes.map((n) => n.instanceId)).toEqual([A().instanceId]);
    // The index is a convenience for enumeration; leaving it to rot would make every
    // later read do work for nodes that no longer exist.
    expect(f.index).toEqual([A().instanceId]);
  });

  it("refuses a record whose body disagrees with the key it was found under", async () => {
    /* Otherwise one node could describe another — the registry is the trust boundary, and
       an id mismatch is exactly the shape of a record written to the wrong key. */
    const f = fakeClient({ [nodeKey("i-aaa")]: encodeNode(A()) }, ["i-aaa"]);
    expect(await readVoipNodes(f.client)).toEqual([]);
  });
});

describe("the heartbeat and the clean shutdown", () => {
  it("sets the record with a TTL and keeps the index entry", async () => {
    const f = fakeClient({}, []);
    expect(await heartbeatVoipNode(f.client, A())).toBe(true);
    expect(f.calls).toContain(`set ${nodeKey(A().instanceId)} ${NODE_TTL_MS}`);
    expect(f.index).toEqual([A().instanceId]);
    expect(await readVoipNodes(f.client)).toHaveLength(1);
  });

  it("a failed heartbeat reports false rather than throwing into the agent's loop", async () => {
    const client = {
      set: async () => {
        throw new Error("down");
      },
    } as unknown as VoipRegistryClient;
    expect(await heartbeatVoipNode(client, A())).toBe(false);
  });

  it("deregistering removes both the record and the index entry", async () => {
    const f = fakeClient({}, []);
    await heartbeatVoipNode(f.client, A());
    await deregisterVoipNode(f.client, A().instanceId);
    expect(f.index).toEqual([]);
    expect(await readVoipNodes(f.client)).toEqual([]);
  });

  it("a crashed node needs no deregistration — the TTL is what removes it", async () => {
    // Nothing has to NOTICE the death. That is why the record carries a TTL at all, and
    // why `isNodeFresh` covers the case where a key outlives its own body.
    const f = fakeClient({}, []);
    await heartbeatVoipNode(f.client, A({ updatedAt: NOW - 60_000 }));
    const nodes = await readVoipNodes(f.client);
    expect(nodes).toHaveLength(1); // still present…
    expect(selectVoipNode(nodes, { nowMs: NOW })).toBeNull(); // …and never selected
  });
});
