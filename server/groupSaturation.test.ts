/**
 * v2.106.59 — a group call is REFUSED when the media pool is full, never meshed.
 *
 * The owner's node-scaling doc, in the one clause that differs from the version v2.106.54
 * answered: "Mesh fallback is for 1:1 calls. If group rooms exist and the pool is saturated,
 * reject with a clear 'service busy' error and fire the saturation alarm loudly — a large
 * group over mesh is worse than an honest error."
 *
 * DRIVEN, not pinned, for the decision: whether a wrong `VOIP_NODE_SECRET` refuses group
 * calls is exactly what a source assertion cannot answer, and it is the difference between
 * this rule and a fleet-wide outage. The five ways the eligible list can come back empty
 * (v2.106.54) are each fed through the real selector and each asserted separately.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  planRoomTransport,
  isGroupParty,
  chooseCallTransport,
  GROUP_MIN_PARTIES,
  NODE_MAX_ROUTERS,
  NODE_CPU_CEILING,
  type VoipNode,
} from "./voipRegistry";
import { poolWarningLine, type PoolState } from "./voipPool";

const HERE = __dirname;
const RELAY = readFileSync(join(HERE, "relay.ts"), "utf8");
const CLIENT = readFileSync(join(HERE, "../client/src/lib/relayClient.ts"), "utf8");
const POOL = readFileSync(join(HERE, "voipPool.ts"), "utf8");

function codeOnly(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

const NOW = 1_700_000_000_000;

/** A healthy, live, eligible node. RFC 5737 documentation addresses only. */
function node(over: Partial<VoipNode> = {}): VoipNode {
  return {
    instanceId: "i-aaa",
    publicIp: "192.0.2.10",
    privateIp: "10.0.1.10",
    az: "ap-south-1a",
    cores: 2,
    workers: 2,
    routers: 1,
    consumers: 2,
    cpuLoad: 0.1,
    draining: false,
    updatedAt: NOW,
    ...over,
  };
}

/** A node that is live and WILLING but over its ceilings — the only "add a node" case. */
function saturated(over: Partial<VoipNode> = {}): VoipNode {
  return node({ routers: NODE_MAX_ROUTERS, cpuLoad: NODE_CPU_CEILING + 0.05, ...over });
}

const GROUP = GROUP_MIN_PARTIES;

describe("v2.106.59 — the group-vs-1:1 test", () => {
  it("treats an absent party size as 1:1, which is what keeps a rolling deploy safe", () => {
    // An older bundle sends no `parties` at all. Reading that as "group" would refuse
    // every 1:1 call it places for the ~60s two bundles are served side by side.
    expect(isGroupParty(undefined)).toBe(false);
    expect(isGroupParty(null)).toBe(false);
  });

  it("treats a two-party call as 1:1 — the mesh is the transport working as designed there", () => {
    expect(isGroupParty(1)).toBe(false);
    expect(isGroupParty(2)).toBe(false);
    expect(isGroupParty(GROUP)).toBe(true);
    expect(isGroupParty(10)).toBe(true);
  });

  it("refuses to read a garbage count as a group", () => {
    for (const v of [NaN, Infinity, -Infinity, -5, 0, "3", "many", {}, [], true, 2.9]) {
      expect(isGroupParty(v as unknown), String(v)).toBe(false);
    }
    // 3.5 floors to 3, which IS a group — a fractional count is still a count.
    expect(isGroupParty(3.5)).toBe(true);
  });
});

describe("v2.106.59 — the refusal fires ONLY for a saturated pool, never for an empty one", () => {
  const plan = (nodes: VoipNode[], partySize: number | null, extra = {}) =>
    planRoomTransport({ nodes, nowMs: NOW, partySize, ...extra });

  it("REFUSES a group call when every live node is over its ceiling", () => {
    const p = plan([saturated()], GROUP);
    expect(p.reason).toBe("all-saturated");
    expect(p.refused).toBe("pool-saturated");
  });

  it("MESHES a 1:1 call in exactly the same conditions — that is the doc's own split", () => {
    const p = plan([saturated()], 2);
    expect(p.reason).toBe("all-saturated");
    expect(p.refused).toBeNull();
    expect(p.transport).toBe("mesh");
  });

  it("does NOT refuse when the pool is EMPTY — a node agent that is not running is not a full fleet", () => {
    const p = plan([], GROUP);
    expect(p.reason).toBe("no-nodes");
    expect(p.refused).toBeNull();
    expect(p.transport).toBe("mesh");
  });

  it("does NOT refuse when every node is STALE — that is a heartbeat problem, not capacity", () => {
    const p = plan([node({ updatedAt: NOW - 10 * 60_000 })], GROUP);
    expect(p.reason).toBe("all-stale");
    expect(p.refused).toBeNull();
  });

  it("does NOT refuse when every node is DRAINING — an operator retiring a node has not asked to stop group calls", () => {
    const p = plan([node({ draining: true })], GROUP);
    expect(p.reason).toBe("all-draining");
    expect(p.refused).toBeNull();
  });

  it("does NOT refuse when every node is EXCLUDED — a wrong VOIP_NODE_SECRET must not become a group-calling outage", () => {
    // This is the false-alarm inversion the PoolReason funnel exists to prevent: a node
    // with the wrong secret heartbeats happily and answers 401 to every operation.
    const p = plan([node()], GROUP, { excludeInstanceIds: ["i-aaa"] });
    expect(p.reason).toBe("all-excluded");
    expect(p.refused).toBeNull();
  });

  it("does NOT refuse when mediasoup is switched OFF fleet-wide", () => {
    const p = plan([saturated()], GROUP, { mediasoupEnabled: false });
    expect(p.reason).toBe("disabled");
    expect(p.refused).toBeNull();
    expect(p.transport).toBe("mesh");
  });

  it("does NOT refuse when this call was opted onto the mesh for an A/B comparison", () => {
    const p = plan([saturated()], GROUP, { forceMesh: true });
    expect(p.refused).toBeNull();
    expect(p.transport).toBe("mesh");
  });

  it("does NOT refuse while ANY node still has room — one saturated node beside a free one is not saturation", () => {
    const p = plan([saturated(), node({ instanceId: "i-bbb", publicIp: "198.51.100.7" })], GROUP);
    expect(p.reason).toBe("ok");
    expect(p.refused).toBeNull();
    expect(p.transport).toBe("mediasoup");
    expect(p.voip?.instanceId).toBe("i-bbb");
  });
});

describe("v2.106.59 — a refusal is not a transport", () => {
  it("keeps CallTransport at two values, so no reader has to handle a third arm", () => {
    // chooseCallTransport is the fail-open floor for every other case and is UNCHANGED:
    // it still cannot return "nothing".
    expect(chooseCallTransport({ mediasoupNode: null })).toBe("mesh");
    expect(chooseCallTransport({ mediasoupNode: node() })).toBe("mediasoup");
  });

  it("a refused plan still names a transport and carries no assignment", () => {
    const p = planRoomTransport({ nodes: [saturated()], nowMs: NOW, partySize: GROUP });
    expect(p.refused).toBe("pool-saturated");
    // The invariant from v2.106.32 holds regardless: mesh always carries null.
    expect(p.transport).toBe("mesh");
    expect(p.voip).toBeNull();
  });

  it("keeps the mediasoup-carries-an-assignment invariant intact", () => {
    const p = planRoomTransport({ nodes: [node()], nowMs: NOW, partySize: GROUP });
    expect(p.transport).toBe("mediasoup");
    expect(p.voip).not.toBeNull();
    expect(p.refused).toBeNull();
  });
});

describe("v2.106.59 — the saturation log stops contradicting the behaviour", () => {
  const state = (over: Partial<PoolState> = {}): PoolState => ({
    total: 2, live: [node(), node()], stale: [], draining: [], saturated: 2,
    eligible: [], reason: "all-saturated", ...over,
  } as PoolState);

  it("names BOTH outcomes, because they need different responses from whoever reads it", () => {
    const line = poolWarningLine(state());
    expect(line).toContain("SATURATED");
    expect(line).toMatch(/1:1/);
    expect(line).toMatch(/REFUSED|service busy/i);
    expect(line).toContain("add a node");
  });

  it("no longer asserts the mesh fallback unconditionally", () => {
    // It used to read "so new calls are falling back to the mesh", which after this
    // release is false for exactly the calls a person would notice.
    expect(poolWarningLine(state())).not.toMatch(/new calls are falling back to the mesh/);
  });

  it("leaves every OTHER reason's wording alone, so no other line starts claiming a refusal", () => {
    for (const reason of ["no-nodes", "all-stale", "all-draining", "all-excluded"] as const) {
      const line = poolWarningLine(state({ reason }));
      expect(line, reason).not.toMatch(/REFUSED|service busy/i);
      /* Deliberately NOT "every other line mentions the mesh": `all-draining` correctly
         does not, because a drained fleet is an operator action with its own remedy
         ("clear the drain flag, or add a node") rather than a fallback to describe. That
         assertion was wrong about the code and failed on correct source. */
      expect(line.length, reason).toBeGreaterThan(40);
      expect(line, reason).toMatch(/\[voip\]/);
    }
  });
});

describe("v2.106.59 — the wire, and the refusal's one call site", () => {
  it("the party size rides the invite that CREATES the room, and only that one", () => {
    const dial = CLIENT.slice(
      CLIENT.indexOf("async function programmaticGroupDial("),
      CLIENT.indexOf("// ---------- incoming ----------"),
    );
    expect(dial.length).toBeGreaterThan(400);
    expect((dial.match(/parties:/g) ?? []).length).toBe(1);
    const firstInvite = dial.slice(dial.indexOf('type: "invite", to: first'));
    expect(firstInvite.slice(0, 300)).toMatch(/parties: clean\.length \+ 1/);
    /* +1 FOR US: `clean` is the invitees, and a rule about how many people are on the
       call must count the caller or "3" means three invited rather than three present. */
    expect(firstInvite.slice(0, 300)).not.toMatch(/parties: clean\.length[^ ]/);
  });

  it("the add-person path sends no party size, so growing a LIVE call is never refused", () => {
    const dial = CLIENT.slice(
      CLIENT.indexOf("async function programmaticGroupDial("),
      CLIENT.indexOf("// ---------- incoming ----------"),
    );
    const addPath = dial.slice(dial.indexOf("if (alreadyInRoom)"), dial.indexOf("} else {"));
    expect(addPath.length).toBeGreaterThan(60);
    expect(addPath).not.toMatch(/parties/);
  });

  it("the server VALIDATES the count rather than trusting the JSON", () => {
    const code = codeOnly(RELAY);
    expect(code).toMatch(/function wireCount\(v: unknown\): number \| null/);
    expect(code).toMatch(/planDialTransport\(\{ partySize: wireCount\(/);
  });

  it("the refusal precedes the room, the ring and the miss — a refused call spends nothing", () => {
    const invite = RELAY.slice(RELAY.indexOf('case "invite": {'));
    const guard = invite.indexOf('code: "saturated"');
    const room = invite.indexOf("ensureDialRoom");
    const identity = invite.indexOf("runIdentityInvite");
    expect(guard).toBeGreaterThan(0);
    expect(room).toBeGreaterThan(0);
    expect(identity).toBeGreaterThan(0);
    expect(guard).toBeLessThan(room);
    expect(guard).toBeLessThan(identity);
  });

  it("the guard keys on the refusal, never on a missing node", () => {
    const code = codeOnly(RELAY);
    expect(code).toMatch(/dialPlan\.refused === "pool-saturated"/);
    // Keying on the absence of a node would refuse on every empty-pool reason.
    expect(code).not.toMatch(/dialPlan\.voip === null[\s\S]{0,80}saturated/);
    expect(code).not.toMatch(/!dialPlan\.voip[\s\S]{0,80}saturated/);
  });

  it("the client CLASSIFIES the code, or the caller sits on Ringing for 65 seconds", () => {
    const code = codeOnly(CLIENT);
    // A join error: the failure is ours, not the invitee's.
    expect(code).toMatch(/const joinErr = [^;]*m\.code === "saturated"/);
    // NOT a reach error, which would raise the leave-a-voice-message card for
    // somebody who is perfectly reachable.
    expect(code).not.toMatch(/const reachErr = [^;]*"saturated"/);
  });

  it("the refusal message says what to do instead", () => {
    const invite = RELAY.slice(RELAY.indexOf('case "invite": {'));
    const msg = invite.slice(invite.indexOf('code: "saturated"'), invite.indexOf('code: "saturated"') + 300);
    expect(msg).toMatch(/busy/i);
    expect(msg).toMatch(/one person|try again/i);
  });
});

describe("v2.106.59 — the dial decision is synchronous and dormant without a fleet", () => {
  it("reads the CACHED snapshot, because room creation must never await Redis", () => {
    const pool = codeOnly(POOL);
    /* BOUNDED BY THE NEXT DECLARATION, not by the first `\n}`: this function's parameter
       is an inline object type, so its own closing brace sits at the start of a line and a
       naive `indexOf("\\n}")` slices off the entire body — the fnBody trap recorded at
       v2.105.9 / v2.105.27 / v2.106.4 / v2.106.48, and it failed on correct source here
       exactly as it did there. */
    const fn = pool.slice(pool.indexOf("export function planDialTransport("));
    const body = fn.slice(0, fn.indexOf("export function startVoipPool("));
    expect(body.length).toBeGreaterThan(100);
    expect(body).toContain("poolSnapshot()");
    expect(body).not.toContain("await");
    expect(body).not.toContain("async");
    expect(body).not.toContain("readVoipNodes");
  });

  it("an unread pool answers exactly as the pre-feature code did", () => {
    // poolSnapshot() is [] without REDIS_URL or a registered agent.
    const p = planRoomTransport({ nodes: [], nowMs: NOW, partySize: 6 });
    expect(p.transport).toBe("mesh");
    expect(p.voip).toBeNull();
    expect(p.refused).toBeNull();
  });
});
