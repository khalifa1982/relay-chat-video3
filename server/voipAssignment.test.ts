/**
 * A ROOM'S ASSIGNMENT TO ONE MEDIA NODE — the half of the SFU that can be got wrong SILENTLY.
 *
 * Everything here is arithmetic over node records plus one composition, so all of it is
 * checkable with no Redis, no VPC and no media node. That is deliberate: the failures this
 * suite is about do not throw and do not log. They produce a call that connects to nothing,
 * or a fleet that quietly stops using the SFU it is paying for.
 *
 * THE THREE PROPERTIES WORTH THE MOST, each a defect found by review rather than by running:
 *
 *  1. `planRoomTransport` cannot report `mediasoup` while holding no assignment, and cannot
 *     hold an assignment it then routes past. Two callers each doing half of this is how a
 *     client gets told "mediasoup" with no address to send media to — invisible in either
 *     half alone, which is why the composition exists at all.
 *  2. A room whose node kept heartbeating but CHANGED ITS PUBLIC IP has lost every router it
 *     depended on. The IPs are auto-assigned rather than Elastic, so the changed address is
 *     positive evidence of a stop/start, and it is the only evidence there is.
 *  3. A hydrated record with NO transport must resolve to the PRE-FEATURE answer and never to
 *     mediasoup. A rolling deploy serves both bundles for about a minute, which is exactly
 *     long enough for real calls to be handed to a node that has never heard of them.
 *
 * WHAT THIS DELIBERATELY DOES NOT CLAIM: that media flows, or that a node answers. Nobody
 * has joined a room on a real node from this sandbox.
 */
import { describe, expect, it } from "vitest";
import {
  assignmentStillValid,
  isVoipAssignment,
  NODE_CLOCK_SKEW_MS,
  NODE_CPU_CEILING,
  NODE_MAX_ROUTERS,
  NODE_TTL_MS,
  nodeLoadScore,
  orderRelaysByAz,
  PENDING_CONSUMER_WEIGHT,
  planRoomTransport,
  rankNodes,
  selectVoipNode,
  transportForHydratedRoom,
  type VoipAssignment,
  type VoipNode,
} from "./voipRegistry";

const NOW = 1_785_000_000_000;

/** The two real nodes, as the brief measured them. */
const A = (over: Partial<VoipNode> = {}): VoipNode => ({
  instanceId: "i-062022390e558ce74",
  publicIp: "192.0.2.10",
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
  publicIp: "198.51.100.20",
  privateIp: "10.0.2.246",
  az: "ap-south-1b",
  cores: 2,
  routers: 0,
  consumers: 0,
  cpuLoad: 0.1,
  updatedAt: NOW,
  ...over,
});

describe("planning a room's transport composes the two halves so they cannot disagree", () => {
  it("a usable node yields mediasoup AND the assignment for it", () => {
    const p = planRoomTransport({ nodes: [A()], nowMs: NOW, livekitEnabled: true });
    expect(p.transport).toBe("mediasoup");
    expect(p.voip).toEqual({
      instanceId: A().instanceId,
      publicIp: A().publicIp,
      az: A().az,
      assignedAt: NOW,
    });
  });

  it("no nodes at all falls back to LiveKit with a NULL assignment", () => {
    const p = planRoomTransport({ nodes: [], nowMs: NOW, livekitEnabled: true });
    expect(p.transport).toBe("livekit");
    expect(p.voip, "a non-mediasoup verdict must not carry an address").toBeNull();
  });

  it("nothing configured falls back to the MESH rather than refusing the call", () => {
    /* The floor, and the reason this function cannot answer "nothing": the mesh needs no
       server at all, so a Redis blip or an unconfigured SFU degrades the call's QUALITY and
       never removes the ability to place it. */
    const p = planRoomTransport({ nodes: [], nowMs: NOW, livekitEnabled: false });
    expect(p.transport).toBe("mesh");
    expect(p.voip).toBeNull();
  });

  it("the kill switch diverts without stranding the call, and spends no assignment", () => {
    const withLk = planRoomTransport({
      nodes: [A()],
      nowMs: NOW,
      livekitEnabled: true,
      mediasoupEnabled: false,
    });
    expect(withLk.transport).toBe("livekit");
    expect(withLk.voip).toBeNull();
    const withoutLk = planRoomTransport({
      nodes: [A()],
      nowMs: NOW,
      livekitEnabled: false,
      mediasoupEnabled: false,
    });
    expect(withoutLk.transport).toBe("mesh");
    expect(withoutLk.voip).toBeNull();
  });

  it("the A/B override does the same with a perfectly healthy node available", () => {
    const p = planRoomTransport({
      nodes: [A()],
      nowMs: NOW,
      livekitEnabled: true,
      forceLivekit: true,
    });
    expect(p.transport).toBe("livekit");
    expect(p.voip).toBeNull();
  });

  it("THE CROSS-PROPERTY, over every combination: mediasoup ⇔ an assignment exists", () => {
    /* This is the assertion the composition exists for, and it is stated as a property
       rather than as a list of cases because the defect is a MISMATCH between two answers —
       any single case can be right while the pairing is wrong. */
    const nodeSets: VoipNode[][] = [
      [],
      [A()],
      [A(), B()],
      [A({ updatedAt: NOW - 60_000 })], // stale
      [A({ cpuLoad: 0.99 })], // saturated
      [A({ routers: NODE_MAX_ROUTERS })], // at the room ceiling
    ];
    let sawMediasoup = false;
    let sawFallback = false;
    for (const nodes of nodeSets) {
      for (const livekitEnabled of [true, false]) {
        for (const forceLivekit of [true, false, undefined]) {
          for (const mediasoupEnabled of [true, false, undefined]) {
            const p = planRoomTransport({
              nodes,
              nowMs: NOW,
              livekitEnabled,
              forceLivekit,
              mediasoupEnabled,
            });
            const label = `${nodes.length} nodes lk=${livekitEnabled} force=${forceLivekit} enabled=${mediasoupEnabled}`;
            if (p.transport === "mediasoup") {
              sawMediasoup = true;
              expect(isVoipAssignment(p.voip), `mediasoup with no assignment: ${label}`).toBe(true);
            } else {
              sawFallback = true;
              expect(p.voip, `${p.transport} carrying an assignment: ${label}`).toBeNull();
            }
          }
        }
      }
    }
    // A property test that never reached either branch would pass by doing nothing.
    expect(sawMediasoup && sawFallback, "both branches must have been exercised").toBe(true);
  });

  it("the assignment names the node that was actually RANKED first", () => {
    /* The other way the two halves can disagree: choose correctly and then describe a
       different node. The expected answer is derived from `rankNodes` rather than restated,
       so this cannot go stale if the ordering is ever retuned. */
    const nodes = [A({ consumers: 40 }), B({ consumers: 4 })];
    const p = planRoomTransport({ nodes, nowMs: NOW, livekitEnabled: true });
    expect(p.voip?.instanceId).toBe(rankNodes(nodes, { nowMs: NOW })[0].instanceId);
    expect(p.voip?.instanceId).toBe(B().instanceId);
  });

  it("the zone preference reaches the plan rather than stopping at the selector", () => {
    const p = planRoomTransport({
      nodes: [A({ consumers: 2 }), B({ consumers: 2 })],
      nowMs: NOW,
      livekitEnabled: true,
      preferAz: "ap-south-1b",
    });
    expect(p.voip?.az).toBe("ap-south-1b");
  });

  it("`pending` reaches the plan too — a burst does not all land on one node", () => {
    /* Without this the correction exists in `nodeLoadScore` and is never applied where it
       matters, which is the plan. Both nodes are idle in the registry's eyes; A has just
       been handed rooms this app knows about and the registry does not yet. */
    const p = planRoomTransport({
      nodes: [A(), B()],
      nowMs: NOW,
      livekitEnabled: true,
      pending: { [A().instanceId]: 6 },
    });
    expect(p.voip?.instanceId).toBe(B().instanceId);
  });

  it("an EXCLUDED node is not planned onto, and the call still happens", () => {
    /* The fail-open link: a node with a wrong shared secret heartbeats perfectly and refuses
       every operation, so without this the plan keeps choosing it and every call fails with
       no degradation anywhere. */
    const p = planRoomTransport({
      nodes: [A()],
      nowMs: NOW,
      livekitEnabled: true,
      excludeInstanceIds: [A().instanceId],
    });
    expect(p.transport).toBe("livekit");
    expect(p.voip).toBeNull();
    // With a second healthy node it degrades to that node rather than off the SFU entirely.
    const p2 = planRoomTransport({
      nodes: [A(), B()],
      nowMs: NOW,
      livekitEnabled: true,
      excludeInstanceIds: [A().instanceId],
    });
    expect(p2.transport).toBe("mediasoup");
    expect(p2.voip?.instanceId).toBe(B().instanceId);
  });

  it("`assignedAt` is the caller's clock, never a fresh read of the wall clock", () => {
    /* Two reads of `Date.now()` inside one decision is how an assignment ends up stamped a
       few milliseconds after the freshness it was judged against — small, and exactly the
       kind of thing that makes a later comparison unreproducible. */
    const p = planRoomTransport({ nodes: [A()], nowMs: NOW, livekitEnabled: true });
    expect(p.voip?.assignedAt).toBe(NOW);
  });
});

describe("an existing assignment is re-validated on the ONE thing that can betray it", () => {
  const live: VoipAssignment = {
    instanceId: A().instanceId,
    publicIp: A().publicIp,
    az: A().az,
    assignedAt: NOW - 5_000,
  };

  it("a healthy node holding the room is still valid", () => {
    expect(assignmentStillValid(live, [A(), B()], NOW)).toBe(true);
  });

  it("no assignment at all is not valid — absent is not a pass", () => {
    expect(assignmentStillValid(null, [A()], NOW)).toBe(false);
    expect(assignmentStillValid(undefined, [A()], NOW)).toBe(false);
  });

  it("the node having vanished from the registry invalidates it", () => {
    expect(assignmentStillValid(live, [B()], NOW)).toBe(false);
    expect(assignmentStillValid(live, [], NOW)).toBe(false);
  });

  it("THE SAME NODE WITH A CHANGED PUBLIC IP invalidates it — the stop/start case", () => {
    /* THE REASON THIS FUNCTION EXISTS. The IPs are auto-assigned rather than Elastic, so an
       instance that stopped and started comes back with a different address and brand-new
       mediasoup worker processes. Its heartbeat is perfect and every router this room
       depended on is gone; the changed address is the only evidence of that, and without
       this check the room is treated as live on a node with no idea it exists. */
    const restarted = A({ publicIp: "13.204.99.1" });
    expect(assignmentStillValid(live, [restarted], NOW)).toBe(false);
    // …and it is genuinely the IP doing the work, not staleness or load standing in for it.
    expect(assignmentStillValid(live, [A()], NOW)).toBe(true);
  });

  it("a STALE node invalidates it, so a dead node does not keep a room", () => {
    expect(assignmentStillValid(live, [A({ updatedAt: NOW - 60_000 })], NOW)).toBe(false);
  });

  it("a SATURATED node invalidates it too", () => {
    /* Deliberately the same `isNodeUsable` the selection uses. Two definitions of "can this
       node take work" is how a room gets kept on a node the selector would refuse. */
    expect(assignmentStillValid(live, [A({ cpuLoad: NODE_CPU_CEILING })], NOW)).toBe(false);
    expect(assignmentStillValid(live, [A({ routers: NODE_MAX_ROUTERS })], NOW)).toBe(false);
  });

  it("a node a few milliseconds ahead of us keeps its rooms", () => {
    // The skew tolerance has to reach here as well, or a clock step evicts every live room.
    expect(assignmentStillValid(live, [A({ updatedAt: NOW + 1 })], NOW)).toBe(true);
  });
});

describe("an assignment read back off the wire is validated field by field", () => {
  const good: VoipAssignment = {
    instanceId: "i-062022390e558ce74",
    publicIp: "192.0.2.10",
    az: "ap-south-1a",
    assignedAt: NOW,
  };

  it("accepts a real one", () => {
    expect(isVoipAssignment(good)).toBe(true);
  });

  it("refuses garbage, partials and hostile shapes rather than repairing them", () => {
    const bad: unknown[] = [
      null,
      undefined,
      0,
      "",
      "i-062022390e558ce74",
      [],
      {},
      { ...good, instanceId: "" },
      { ...good, instanceId: 5 },
      { ...good, publicIp: "not-an-ip" },
      { ...good, publicIp: "13.201.44" },
      { ...good, publicIp: "256.1.1.1" },
      { ...good, publicIp: "" },
      { ...good, az: "" },
      { ...good, assignedAt: 0 },
      { ...good, assignedAt: -1 },
      { ...good, assignedAt: Number.NaN },
      { ...good, assignedAt: "now" },
    ];
    for (const v of bad) expect(isVoipAssignment(v), JSON.stringify(v) ?? String(v)).toBe(false);
  });

  it("an extra field does not make it invalid — the record may grow additively", () => {
    /* Refusing on unknown keys would make any future field a fleet-wide outage during the
       ~60s of a rolling deploy, which is the failure this whole area is written around. */
    expect(isVoipAssignment({ ...good, routerId: "r1" })).toBe(true);
  });
});

describe("a HYDRATED room's transport is the pre-feature answer when the record predates it", () => {
  it("an absent transport is never read as mediasoup", () => {
    /* THE MID-ROLLOUT GUARD. A record written by an instance that predates this feature
       carries no transport and no assignment, so reading it as mediasoup hands the room to a
       node that has never heard of it — and a rolling deploy serves both bundles for about a
       minute, which is long enough for that to happen to real calls. */
    expect(transportForHydratedRoom({}, { livekitEnabled: true })).toBe("livekit");
    expect(transportForHydratedRoom({}, { livekitEnabled: false })).toBe("mesh");
    expect(transportForHydratedRoom(null, { livekitEnabled: true })).toBe("livekit");
    expect(transportForHydratedRoom(undefined, { livekitEnabled: false })).toBe("mesh");
  });

  it("a recorded transport is honoured exactly", () => {
    for (const t of ["mediasoup", "livekit", "mesh"] as const) {
      expect(transportForHydratedRoom({ transport: t }, { livekitEnabled: true })).toBe(t);
    }
    // Even with LiveKit switched off: the room is ALREADY on that transport and saying
    // otherwise would move a live call's media mid-flight.
    expect(transportForHydratedRoom({ transport: "livekit" }, { livekitEnabled: false })).toBe(
      "livekit",
    );
  });

  it("an UNRECOGNISED transport degrades rather than being trusted", () => {
    // A value from a future build, or a corrupted record. Either way it is not something this
    // build can route, so it must read as "we do not know" and take the safe answer.
    for (const t of ["sfu", "", 1, null, {}, "MEDIASOUP"]) {
      expect(
        transportForHydratedRoom({ transport: t }, { livekitEnabled: true }),
        JSON.stringify(t),
      ).toBe("livekit");
    }
  });
});

describe("the load correction for rooms that have been assigned but not yet joined", () => {
  it("a pending room counts for something, or a burst all reads one stale snapshot", () => {
    /* `cpuLoad` is a ONE-MINUTE average and `consumers` only rises after people join, so
       fifty dials inside one 5s refresh window would otherwise all rank against the same
       numbers and pile onto the same node. `routers` moves immediately, which is why it is
       also a hard ceiling — but the app correcting for what it has just itself done needs no
       extra state at all, because the caller already knows what it assigned. */
    expect(nodeLoadScore(A({ consumers: 0 }), 0)).toBe(0);
    expect(nodeLoadScore(A({ consumers: 0 }), 4)).toBe((4 * PENDING_CONSUMER_WEIGHT) / 2);
    expect(nodeLoadScore(A(), 1)).toBeGreaterThan(nodeLoadScore(A(), 0));
  });

  it("defaults to zero, so every pre-existing caller is byte-identical", () => {
    expect(nodeLoadScore(A({ consumers: 10 }))).toBe(nodeLoadScore(A({ consumers: 10 }), 0));
  });

  it("garbage in the pending map is ignored rather than poisoning the ranking", () => {
    /* This map is assembled by a caller from its own bookkeeping; a NaN reaching the sort
       comparator would make the ordering non-deterministic, which is far worse than a
       missing correction. */
    for (const junk of [Number.NaN, -3, Number.POSITIVE_INFINITY, "2" as unknown as number]) {
      const ranked = rankNodes([A(), B()], {
        nowMs: NOW,
        pending: { [A().instanceId]: junk },
      });
      expect(ranked, String(junk)).toHaveLength(2);
      expect(ranked.map((n) => n.instanceId).sort()).toEqual([A().instanceId, B().instanceId].sort());
    }
  });

  it("accepts a Map as well as a plain object, because callers keep one or the other", () => {
    const viaMap = rankNodes([A(), B()], {
      nowMs: NOW,
      pending: new Map([[A().instanceId, 6]]),
    });
    const viaObj = rankNodes([A(), B()], { nowMs: NOW, pending: { [A().instanceId]: 6 } });
    expect(viaMap.map((n) => n.instanceId)).toEqual(viaObj.map((n) => n.instanceId));
    expect(viaMap[0].instanceId).toBe(B().instanceId);
  });
});

describe("the room ceiling EXCLUDES rather than ranking last", () => {
  it("a node at the ceiling is not returned even when it is the least loaded", () => {
    /* The tempting version ranks it last, which on a two-node fleet means it still wins as
       soon as the other node is busier — and a node past its room ceiling does not degrade
       gracefully, it degrades for everybody already on it. */
    const full = A({ routers: NODE_MAX_ROUTERS, consumers: 0 });
    const busy = B({ routers: 1, consumers: 100 });
    expect(rankNodes([full, busy], { nowMs: NOW }).map((n) => n.instanceId)).toEqual([
      busy.instanceId,
    ]);
    expect(selectVoipNode([full], { nowMs: NOW })).toBeNull();
  });

  it("one room below the ceiling is still usable — the bound is not off by one", () => {
    expect(selectVoipNode([A({ routers: NODE_MAX_ROUTERS - 1 })], { nowMs: NOW })).not.toBeNull();
  });

  it("the ceiling is a real bound rather than effectively infinite", () => {
    // A ceiling nothing can reach is a comment. These are 2-core boxes.
    expect(NODE_MAX_ROUTERS).toBeGreaterThan(1);
    expect(NODE_MAX_ROUTERS).toBeLessThan(1_000);
  });
});

describe("ranking and selection are ONE rule, not two copies of it", () => {
  it("selectVoipNode is exactly the head of rankNodes, over varied fleets", () => {
    /* Two functions each carrying a copy of the ordering is how "which node did we pick" and
       "which node should we have picked" come to disagree — the class this repo has paid for
       twice (v2.99.71's checker vs. the server, v2.99.77's presence key). Asserted as an
       identity rather than by restating expected winners, so it cannot go stale. */
    const fleets: VoipNode[][] = [
      [],
      [A()],
      [A(), B()],
      [A({ consumers: 40 }), B({ consumers: 4 })],
      [A({ updatedAt: NOW - 60_000 }), B()],
      [A({ cpuLoad: 0.99 }), B({ routers: NODE_MAX_ROUTERS })],
      [B(), A()],
    ];
    for (const nodes of fleets) {
      for (const preferAz of [null, "ap-south-1a", "ap-south-1b"]) {
        const opts = { nowMs: NOW, preferAz };
        expect(selectVoipNode(nodes, opts)).toBe(rankNodes(nodes, opts)[0] ?? null);
      }
    }
  });

  it("ranking is a total order over the usable nodes — nothing is dropped or duplicated", () => {
    const nodes = [A({ consumers: 4 }), B({ consumers: 4 })];
    const ranked = rankNodes(nodes, { nowMs: NOW });
    expect(ranked).toHaveLength(2);
    expect(new Set(ranked.map((n) => n.instanceId)).size).toBe(2);
  });

  it("ranking does not MUTATE the list it was given", () => {
    /* The caller's list is read from the registry and may be reused for the ICE composition
       in the same request; sorting it in place would reorder something else by surprise. */
    const nodes = [B({ consumers: 40 }), A({ consumers: 1 })];
    const before = nodes.map((n) => n.instanceId);
    rankNodes(nodes, { nowMs: NOW });
    expect(nodes.map((n) => n.instanceId)).toEqual(before);
  });

  it("the skew tolerance reaches SELECTION, not just the freshness predicate", () => {
    expect(
      selectVoipNode([A({ updatedAt: NOW + NODE_CLOCK_SKEW_MS })], { nowMs: NOW }),
    ).not.toBeNull();
    expect(selectVoipNode([A({ updatedAt: NOW + 60_000 })], { nowMs: NOW })).toBeNull();
  });
});

describe("the relay list is reordered toward the room's own zone, and never on a guess", () => {
  const hosts = ["turn.your-chat.io", "turn2.your-chat.io"];
  const azs = ["ap-south-1a", "ap-south-1b"];

  it("puts the same-zone relay first", () => {
    /* Nothing here touches coturn or the credential mechanism, which are untouched by
       design — this is pure list reordering. A relay in the room's own zone is one fewer
       cross-zone hop on the path that only exists because the direct one failed. */
    expect(orderRelaysByAz(hosts, azs, "ap-south-1b")).toEqual([
      "turn2.your-chat.io",
      "turn.your-chat.io",
    ]);
    expect(orderRelaysByAz(hosts, azs, "ap-south-1a")).toEqual(hosts);
  });

  it("KEEPS every relay — this is an ordering, not a filter", () => {
    /* Dropping the other zone's relay would remove the fallback that exists for when the
       preferred one is the thing that is broken. */
    for (const az of ["ap-south-1a", "ap-south-1b", "ap-south-1c", null]) {
      expect(orderRelaysByAz(hosts, azs, az).slice().sort()).toEqual(hosts.slice().sort());
    }
  });

  it("is IDENTITY when it cannot do better, rather than reordering on a guess", () => {
    expect(orderRelaysByAz(hosts, azs, null)).toEqual(hosts);
    expect(orderRelaysByAz(hosts, azs, undefined)).toEqual(hosts);
    expect(orderRelaysByAz(hosts, null, "ap-south-1a")).toEqual(hosts);
    expect(orderRelaysByAz(hosts, undefined, "ap-south-1a")).toEqual(hosts);
    /* A MISMATCHED LENGTH means the zones do not describe THESE hosts, and this case had to be
       rewritten to be able to fail. The first version was `(hosts, ["ap-south-1a"], "ap-south-1a")`
       — two hosts, one zone, matching at index 0 — and pushing the match first PRESERVES that
       order, so identity and a reorder gave the same answer and dropping the length check
       survived. Found by mutation, the same coincidence class as v2.105.21's frame case and
       v2.99.93's name-rank case. Three hosts with the match at index 1 is what distinguishes
       them: unguarded it answers ["b","a","c"], reordering on zones that are not about these
       hosts at all. */
    expect(orderRelaysByAz(["a", "b", "c"], ["z1", "z2"], "z2")).toEqual(["a", "b", "c"]);
    expect(orderRelaysByAz(hosts, ["ap-south-1a"], "ap-south-1a")).toEqual(hosts);
    expect(orderRelaysByAz(hosts, ["a", "b", "c"], "b")).toEqual(hosts);
    // A zone nothing matches is not a reason to shuffle.
    expect(orderRelaysByAz(hosts, azs, "eu-west-1a")).toEqual(hosts);
    expect(orderRelaysByAz([], [], "ap-south-1a")).toEqual([]);
  });

  it("returns a COPY, so the caller's configured list is never reordered underneath it", () => {
    const src = [...hosts];
    const out = orderRelaysByAz(src, azs, "ap-south-1b");
    expect(out).not.toBe(src);
    expect(src).toEqual(hosts);
  });

  it("is stable within a group rather than shuffling equals", () => {
    const three = ["a", "b", "c"];
    const zones = ["z1", "z2", "z1"];
    expect(orderRelaysByAz(three, zones, "z1")).toEqual(["a", "c", "b"]);
  });
});

describe("the TTL and the tolerance are related on purpose", () => {
  it("the skew tolerance is far under the TTL", () => {
    // If they were comparable, "fresh" would start meaning "our clocks disagree" and the TTL
    // would stop being the thing that removes a dead node.
    expect(NODE_CLOCK_SKEW_MS).toBeGreaterThan(0);
    expect(NODE_CLOCK_SKEW_MS * 4).toBeLessThanOrEqual(NODE_TTL_MS);
  });
});
