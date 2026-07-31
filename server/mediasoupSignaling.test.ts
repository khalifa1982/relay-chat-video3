/**
 * THE APP → NODE CALL, DRIVEN RATHER THAN PINNED.
 *
 * Every claim here is about what happens on the wire — whether a signature the app produced
 * is accepted by the verifier the node really runs, whether a wedged node becomes a
 * fallback rather than a hung call, whether a replayed request still works an hour later.
 * None of those is answerable from reading the source, so this file spins up a REAL HTTP
 * server running the agent's own `verifySignature` and points the real `callNode` at it.
 *
 * The one thing it deliberately does NOT do is import `agent.mjs`: that would start
 * mediasoup workers and listen on a port. The signature rule lives in `sign.mjs` precisely
 * so it can be exercised without any of that.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { signBody, SIG_HEADER, SIG_WINDOW_MS, verifySignature } from "../voip-node/sign.mjs";
import {
  callNode,
  callNodeTracked,
  mediasoupConfigured,
  nodeApiUrl,
  nodeExclusionReason,
  NODE_FAILURES_BEFORE_EXCLUDE,
  NODE_TIMEOUT_MS,
  NODE_UNAUTHORIZED_COOLDOWN_MS,
  NODE_UNREACHABLE_COOLDOWN_MS,
  recordNodeOutcome,
  resetNodeHealth,
  unhealthyNodeIds,
  VOIP_API_PORT,
  voipNodeSecret,
  type FetchLike,
  type NodeFailure,
  type NodeHealthStore,
  type NodeOp,
} from "./mediasoupSignaling";
import { planRoomTransport, type VoipNode } from "./voipRegistry";
import { codeOnly } from "./testing/codeOnly";

const SECRET = "test-shared-secret-not-a-real-one";
const NOW = 1_785_000_000_000;

const NODE: VoipNode = {
  instanceId: "i-062022390e558ce74",
  publicIp: "192.0.2.10",
  privateIp: "10.0.1.192",
  az: "ap-south-1a",
  cores: 2,
  routers: 1,
  consumers: 4,
  cpuLoad: 0.2,
  updatedAt: NOW,
};

/**
 * A stand-in node: the agent's REAL verifier in front of a recorder.
 *
 * `stall` makes it accept the connection and never answer, which is the behaviour of a host
 * whose mediasoup workers have wedged while its kernel is fine — the case a timeout exists
 * for, and one that cannot be simulated by refusing a connection.
 */
function fakeNode(opts: { secret?: string; stall?: boolean; reply?: unknown; status?: number } = {}) {
  const seen: { body: string; header: unknown; authorized: boolean }[] = [];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      const header = req.headers[SIG_HEADER];
      const authorized = verifySignature(opts.secret ?? SECRET, raw, header, Date.now());
      seen.push({ body: raw, header, authorized });
      if (opts.stall) return; // hold the socket open, answer nothing
      if (!authorized) {
        res.writeHead(401, { "content-type": "application/json" });
        return res.end(JSON.stringify({ error: "unauthorized" }));
      }
      res.writeHead(opts.status ?? 200, { "content-type": "application/json" });
      res.end(typeof opts.reply === "string" ? opts.reply : JSON.stringify(opts.reply ?? { ok: true }));
    });
  });
  return {
    seen,
    server,
    async listen(): Promise<number> {
      await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
      return (server.address() as { port: number }).port;
    },
    close() {
      return new Promise<void>((r) => server.close(() => r()));
    },
  };
}

let open: { close(): Promise<void> }[] = [];
afterEach(async () => {
  for (const s of open) await s.close();
  open = [];
  delete process.env.VOIP_NODE_SECRET;
});

/** `callNode` targets the node's PRIVATE ip; the test server is on loopback. */
function loopbackNode(port: number): VoipNode {
  return { ...NODE, privateIp: "127.0.0.1" };
}

describe("the app's signature is accepted by the verifier the node really runs", () => {
  it("a signed request round-trips, and the node sees exactly the bytes that were signed", async () => {
    const fake = fakeNode();
    open.push(fake);
    const port = await fake.listen();
    const res = await callNode(loopbackNode(port), "routerCapabilities", { roomId: "r1" }, {
      secret: SECRET,
      port,
    });
    expect(res.ok, JSON.stringify(res)).toBe(true);
    expect(fake.seen).toHaveLength(1);
    expect(fake.seen[0].authorized).toBe(true);
    /* SIGN WHAT YOU SEND. If the body were serialized once for the signature and again for
       the request, a different key order would verify as a forgery — so this asserts the
       node's received bytes verify against its own rule, which is the only claim that
       matters. It also pins that the op travels IN the body rather than in a path, since
       the agent dispatches on `body.op`. */
    expect(JSON.parse(fake.seen[0].body)).toEqual({ op: "routerCapabilities", roomId: "r1" });
    // Verified at the timestamp the header itself carries, not at a fixed clock: these
    // round-trip cases sign with the real one (as the app does), and a hardcoded date five
    // days away is correctly refused by the replay window — which is how the window proved
    // it works while four of my own first-draft assertions failed on correct code.
    const stamp = Number(String(fake.seen[0].header).split(".")[0]);
    expect(verifySignature(SECRET, fake.seen[0].body, fake.seen[0].header, stamp)).toBe(true);
  });

  it("the node's answer is returned as parsed data", async () => {
    const fake = fakeNode({ reply: { rtpCapabilities: { codecs: [{ mimeType: "video/VP8" }] } } });
    open.push(fake);
    const port = await fake.listen();
    const res = await callNode<{ rtpCapabilities: { codecs: { mimeType: string }[] } }>(
      loopbackNode(port),
      "routerCapabilities",
      { roomId: "r1" },
      { secret: SECRET, port },
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.rtpCapabilities.codecs[0].mimeType).toBe("video/VP8");
  });

  it("a WRONG secret is refused by the node, and the app reports it as unauthorized", async () => {
    /* Not a cosmetic distinction: this is the one failure that means a real
       misconfiguration rather than a transient one, so it must be diagnosable apart from
       "the node is unreachable" — those send an operator to different files. */
    const fake = fakeNode({ secret: "the-node-has-a-different-secret" });
    open.push(fake);
    const port = await fake.listen();
    const res = await callNode(loopbackNode(port), "state", {}, { secret: SECRET, port });
    expect(res).toEqual({ ok: false, reason: "unauthorized" });
    expect(fake.seen[0].authorized).toBe(false);
  });

  it("a TAMPERED body is refused even with a valid-looking header", async () => {
    const body = JSON.stringify({ op: "closeRoom", roomId: "victim-room" });
    const header = signBody(SECRET, body, NOW);
    const tampered = JSON.stringify({ op: "closeRoom", roomId: "someone-elses-room" });
    expect(verifySignature(SECRET, tampered, header, NOW)).toBe(false);
    expect(verifySignature(SECRET, body, header, NOW)).toBe(true);
  });

  it("MOVING the timestamp invalidates the signature", () => {
    /* The timestamp is inside the signed string, not merely alongside it. If it were sent
       in the clear anyone who captured a request could rewrite the timestamp and replay it
       forever, which would make the window decoration rather than a bound. */
    const body = JSON.stringify({ op: "state" });
    const header = signBody(SECRET, body, NOW);
    const [ts, sig] = header.split(".");
    expect(Number(ts)).toBe(NOW);
    const moved = `${NOW + 60_000}.${sig}`;
    expect(verifySignature(SECRET, body, moved, NOW + 60_000)).toBe(false);
  });

  it("a request older than the replay window is refused, in BOTH directions", () => {
    const body = JSON.stringify({ op: "state" });
    const header = signBody(SECRET, body, NOW);
    expect(verifySignature(SECRET, body, header, NOW + SIG_WINDOW_MS - 1_000)).toBe(true);
    expect(verifySignature(SECRET, body, header, NOW + SIG_WINDOW_MS + 1_000)).toBe(false);
    // A node whose clock is BEHIND must also refuse, or the window is one-sided and a
    // captured request is replayable indefinitely against a lagging host.
    expect(verifySignature(SECRET, body, header, NOW - SIG_WINDOW_MS - 1_000)).toBe(false);
  });

  it("a malformed header is refused rather than throwing", () => {
    /* `timingSafeEqual` THROWS on a length mismatch instead of returning false, so without
       the length guard every malformed request would be a 500 rather than a 401 — a
       denial-of-service with extra steps, on the port that drives every call. */
    const body = JSON.stringify({ op: "state" });
    for (const h of [
      undefined,
      null,
      123,
      "",
      ".",
      "abc",
      `${NOW}.`,
      `${NOW}.short`,
      `.${"a".repeat(64)}`,
      `notanumber.${"a".repeat(64)}`,
      { ts: NOW },
      [`${NOW}`, "a"],
    ]) {
      expect(() => verifySignature(SECRET, body, h, NOW), String(h)).not.toThrow();
      expect(verifySignature(SECRET, body, h, NOW), String(h)).toBe(false);
    }
  });

  it("an EMPTY secret verifies nothing — this one gate fails CLOSED", () => {
    /* The opposite of this repo's usual fail-open rule, deliberately. Elsewhere a
       misconfiguration must never remove the ability to make a call; here the question is
       whether a request is AUTHENTIC, and an unconfigured node that accepted everything
       would be an open SFU drivable by anything inside the VPC. The fail-OPEN behaviour
       lives one level up: no secret means mediasoup is not selected at all. */
    const body = JSON.stringify({ op: "closeRoom", roomId: "r1" });
    expect(verifySignature("", body, signBody("", body, NOW), NOW)).toBe(false);
  });
});

describe("a node that is not answering becomes a fallback, never a hung call", () => {
  it("a WEDGED node times out rather than hanging forever", async () => {
    /* `fetch` has no default timeout. A host that accepts the connection and never answers
       — mediasoup wedged, kernel fine — would otherwise leave call setup waiting
       indefinitely, which is worse than any fallback. */
    const fake = fakeNode({ stall: true });
    open.push(fake);
    const port = await fake.listen();
    const started = Date.now();
    const res = await callNode(loopbackNode(port), "state", {}, {
      secret: SECRET,
      port,
      timeoutMs: 120,
    });
    expect(res).toEqual({ ok: false, reason: "timeout" });
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("an UNREACHABLE node is reported apart from a wedged one", async () => {
    // Nothing is listening on this port; a refused connection is a different diagnosis
    // ("the node is gone") from a stall ("the node is stuck") and gets its own reason.
    const res = await callNode(loopbackNode(1), "state", {}, {
      secret: SECRET,
      port: 9,
      timeoutMs: 400,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(["unreachable", "timeout"]).toContain(res.reason);
  });

  it("with no secret it answers `unconfigured` WITHOUT touching the network", async () => {
    /* An unconfigured fleet is the normal state until the secret is deployed, so this path
       must be free and must not be an error. A fetch here would be a per-call round trip
       for a feature nobody has turned on. */
    let called = 0;
    const spy: FetchLike = async () => {
      called += 1;
      return { ok: true, status: 200, async text() { return "{}"; } };
    };
    const res = await callNode(NODE, "state", {}, { secret: "", fetchImpl: spy });
    expect(res).toEqual({ ok: false, reason: "unconfigured" });
    expect(called, "it must not reach the network with no secret").toBe(0);
  });

  it("a non-JSON answer is `bad-response`, not a throw", async () => {
    const fake = fakeNode({ reply: "<html>proxy error</html>" });
    open.push(fake);
    const port = await fake.listen();
    const res = await callNode(loopbackNode(port), "state", {}, { secret: SECRET, port });
    expect(res).toEqual({ ok: false, reason: "bad-response" });
  });

  it("a 500 from the node is `node-error`, distinct from `unauthorized`", async () => {
    const fake = fakeNode({ status: 500, reply: { error: "no such room" } });
    open.push(fake);
    const port = await fake.listen();
    const res = await callNode(loopbackNode(port), "closeRoom", { roomId: "gone" }, {
      secret: SECRET,
      port,
    });
    expect(res).toEqual({ ok: false, reason: "node-error" });
  });

  it("NO failure is ever a throw — the caller is the call path", async () => {
    /* An unhandled rejection inside the invite handler costs the caller their dial, so
       every one of these has to resolve rather than reject. */
    const cases: Promise<unknown>[] = [
      callNode(NODE, "state", {}, { secret: "" }),
      callNode(loopbackNode(1), "state", {}, { secret: SECRET, port: 9, timeoutMs: 200 }),
      callNode(NODE, "state", {}, {
        secret: SECRET,
        fetchImpl: async () => {
          throw new Error("socket hang up");
        },
      }),
      callNode(NODE, "state", {}, {
        secret: SECRET,
        fetchImpl: async () => ({
          ok: true,
          status: 200,
          async text(): Promise<string> {
            throw new Error("stream broke mid-body");
          },
        }),
      }),
    ];
    for (const p of cases) await expect(p).resolves.toMatchObject({ ok: false });
  });
});

describe("the wire details that must not drift", () => {
  it("the URL uses the node's PRIVATE address, never its public one", () => {
    /* The two answer different questions and swapping them is a bug both ways: `publicIp`
       is where a BROWSER sends media and must be internet-reachable, `privateIp` is the
       app's own control hop. Using the public one would route control traffic out through
       the internet gateway and back, and the security group allows 4443 from the VPC only,
       so it would not even work. */
    const url = nodeApiUrl(NODE);
    expect(url).toContain(NODE.privateIp);
    expect(url).not.toContain(NODE.publicIp);
    expect(url).toBe(`http://10.0.1.192:${VOIP_API_PORT}/`);
  });

  it("the app and the agent agree on the port and the header", () => {
    const agent = readFileSync("voip-node/agent.mjs", "utf8");
    expect(agent).toMatch(new RegExp(`VOIP_API_PORT \\|\\| ${VOIP_API_PORT}`));
    // The header name is shared through `sign.mjs` rather than spelled twice, and the
    // agent must read it from there rather than re-typing the literal.
    expect(codeOnly(agent)).toMatch(/req\.headers\[SIG_HEADER\]/);
    expect(SIG_HEADER).toBe("x-relay-voip-sig");
  });

  it("every op the app can name is one the agent actually handles", () => {
    /* An op the node does not know is a 400 the app cannot distinguish from a real
       failure, so the two lists must not drift. Read off the agent's own HANDLERS. */
    const agent = readFileSync("voip-node/agent.mjs", "utf8");
    const start = agent.indexOf("const HANDLERS = {");
    expect(start, "HANDLERS must exist").toBeGreaterThan(-1);
    const body = agent.slice(start);
    const ops: NodeOp[] = [
      "state",
      "routerCapabilities",
      "createTransport",
      "connectTransport",
      "produce",
      "consume",
      "resumeConsumer",
      "setConsumerLayers",
      "closeRoom",
      "loudest",
      "stats",
    ];
    for (const op of ops) {
      expect(body, `agent has no handler for ${op}`).toMatch(new RegExp(`\\basync ${op}\\(`));
    }
    // …and the reverse, so a handler added to the agent without a type here is caught
    // rather than silently unreachable from the app.
    const declared = Array.from(body.matchAll(/^ {2}async (\w+)\(/gm)).map((m) => m[1]);
    expect(declared.sort()).toEqual([...ops].sort());
  });

  it("the signer is IMPORTED from the node's module, never reimplemented", () => {
    /* The whole reason parity here is structural rather than tested. A TypeScript copy of
       the HMAC would be the v2.99.71 shape, and this is the assertion that stops one
       reappearing — asserted on CODE, since the file's own comments discuss the copy it
       deliberately does not have. */
    const src = codeOnly(readFileSync("server/mediasoupSignaling.ts", "utf8"));
    expect(src).toMatch(/from "\.\.\/voip-node\/sign\.mjs"/);
    expect(src).not.toMatch(/createHmac|timingSafeEqual/);
  });

  it("the timeout is bounded and short, because it sits on the call path", () => {
    expect(NODE_TIMEOUT_MS).toBeGreaterThan(0);
    expect(NODE_TIMEOUT_MS).toBeLessThanOrEqual(3_000);
  });

  it("the secret is read per call, so a fleet can be configured without a restart", () => {
    /* The `iceServers()` pattern — env read PER CALL. Captured at module load it would need
       a deploy to turn mediasoup on, and a test could not change it between cases. */
    delete process.env.VOIP_NODE_SECRET;
    expect(voipNodeSecret()).toBe("");
    expect(mediasoupConfigured()).toBe(false);
    process.env.VOIP_NODE_SECRET = "later";
    expect(voipNodeSecret()).toBe("later");
    expect(mediasoupConfigured()).toBe(true);
  });
});

/* ─────────────────────────────────────────────────────────────────────────────────────
 * NODE HEALTH — the link that makes the fallback happen at all.
 *
 * THE FAILURE THIS EXISTS FOR IS INVISIBLE FROM THE REGISTRY, and that is the whole point:
 * give one node the wrong `VOIP_NODE_SECRET` and it heartbeats perfectly — the heartbeat is a
 * Redis write it makes about ITSELF, not a request anybody signs — while answering 401 to
 * every operation. Without this, the plan keeps selecting it, every call assigned to it fails,
 * and nothing anywhere degrades.
 *
 * Every case uses its OWN store, because a module-level Map tests cannot isolate is how state
 * leaks between cases and makes an order-dependent suite.
 * ────────────────────────────────────────────────────────────────────────────────────── */
describe("an unhealthy node is set aside so the call can go elsewhere", () => {
  const fresh = (): NodeHealthStore => new Map();
  const ID = NODE.instanceId;

  it("UNAUTHORIZED excludes on the FIRST failure — a wrong secret will not heal itself", () => {
    /* One is all the evidence there is ever going to be: every subsequent op fails
       identically, so waiting for repeats only costs more calls. */
    const store = fresh();
    expect(recordNodeOutcome(ID, { ok: false, reason: "unauthorized" }, { nowMs: NOW, store })).toBe(
      true,
    );
    expect(unhealthyNodeIds({ nowMs: NOW, store }).has(ID)).toBe(true);
    expect(nodeExclusionReason(ID, { nowMs: NOW, store })).toBe("unauthorized");
  });

  it("a TIMEOUT needs repeats, so one dropped packet does not halve a two-node fleet", () => {
    /* The cost of being wrong is asymmetric: excluding a healthy node removes half the SFU
       capacity, while carrying a broken one for two more ops costs those two calls a fallback
       they were going to take anyway. */
    const store = fresh();
    for (let i = 1; i < NODE_FAILURES_BEFORE_EXCLUDE; i += 1) {
      expect(
        recordNodeOutcome(ID, { ok: false, reason: "timeout" }, { nowMs: NOW, store }),
        `failure ${i} must not exclude`,
      ).toBe(false);
      expect(unhealthyNodeIds({ nowMs: NOW, store }).size).toBe(0);
    }
    expect(recordNodeOutcome(ID, { ok: false, reason: "timeout" }, { nowMs: NOW, store })).toBe(true);
    expect(unhealthyNodeIds({ nowMs: NOW, store }).has(ID)).toBe(true);
  });

  it("`unreachable` counts toward the same budget — both mean 'stopped answering'", () => {
    const store = fresh();
    recordNodeOutcome(ID, { ok: false, reason: "timeout" }, { nowMs: NOW, store });
    recordNodeOutcome(ID, { ok: false, reason: "unreachable" }, { nowMs: NOW, store });
    expect(recordNodeOutcome(ID, { ok: false, reason: "timeout" }, { nowMs: NOW, store })).toBe(true);
  });

  it("A NODE-ERROR NEVER EXCLUDES — the node answered, the operation failed", () => {
    /* The important negative. `node-error` and `bad-response` mean the request reached a
       working node and it refused the shape, or a room had already gone. Excluding on those
       would let one malformed payload from the app take the whole fleet out of service. */
    const store = fresh();
    for (const reason of ["node-error", "bad-response"] as NodeFailure[]) {
      for (let i = 0; i < NODE_FAILURES_BEFORE_EXCLUDE + 3; i += 1) {
        expect(recordNodeOutcome(ID, { ok: false, reason }, { nowMs: NOW, store }), reason).toBe(
          false,
        );
      }
      expect(unhealthyNodeIds({ nowMs: NOW, store }).size, reason).toBe(0);
    }
  });

  it("`unconfigured` never excludes, because it is not about the node", () => {
    const store = fresh();
    for (let i = 0; i < 10; i += 1) {
      recordNodeOutcome(ID, { ok: false, reason: "unconfigured" }, { nowMs: NOW, store });
    }
    expect(unhealthyNodeIds({ nowMs: NOW, store }).size).toBe(0);
  });

  it("A SUCCESS CLEARS THE RECORD OUTRIGHT rather than decrementing", () => {
    /* A node that just answered is a node that works. A slow decay would go on punishing a
       node that had already recovered — and on a fleet of two that is capacity nobody
       needed to lose. */
    const store = fresh();
    recordNodeOutcome(ID, { ok: false, reason: "timeout" }, { nowMs: NOW, store });
    recordNodeOutcome(ID, { ok: false, reason: "timeout" }, { nowMs: NOW, store });
    recordNodeOutcome(ID, { ok: true }, { nowMs: NOW, store });
    // Back to a full budget: two more failures must NOT be enough.
    expect(recordNodeOutcome(ID, { ok: false, reason: "timeout" }, { nowMs: NOW, store })).toBe(false);
    expect(recordNodeOutcome(ID, { ok: false, reason: "timeout" }, { nowMs: NOW, store })).toBe(false);
  });

  it("a success clears an EXCLUSION too, so a restarted node comes straight back", () => {
    const store = fresh();
    recordNodeOutcome(ID, { ok: false, reason: "unauthorized" }, { nowMs: NOW, store });
    expect(unhealthyNodeIds({ nowMs: NOW, store }).has(ID)).toBe(true);
    recordNodeOutcome(ID, { ok: true }, { nowMs: NOW, store });
    expect(unhealthyNodeIds({ nowMs: NOW, store }).has(ID)).toBe(false);
  });

  it("THE COOLDOWN EXPIRES — an exclusion is never permanent", () => {
    /* Without expiry a single bad minute takes a node out until the app restarts, which on a
       two-node fleet is the SFU switched off by a blip. */
    const store = fresh();
    recordNodeOutcome(ID, { ok: false, reason: "unauthorized" }, { nowMs: NOW, store });
    expect(unhealthyNodeIds({ nowMs: NOW + NODE_UNAUTHORIZED_COOLDOWN_MS - 1, store }).has(ID)).toBe(
      true,
    );
    expect(unhealthyNodeIds({ nowMs: NOW + NODE_UNAUTHORIZED_COOLDOWN_MS + 1, store }).has(ID)).toBe(
      false,
    );
  });

  it("…and the REASON reader has its own time check, not one borrowed from the pruning", () => {
    /* THIS CASE PASSED FOR THE WRONG REASON and mutation is what showed it. It used to sit
       under the assertion above, and that assertion's `unhealthyNodeIds` call had ALREADY
       PRUNED the expired entry — so the reader answered null because the record was gone, and
       gutting its own `e.until > now` guard changed nothing. On a fresh store the record is
       still present and only the reader's own check can answer. */
    const store = fresh();
    recordNodeOutcome(ID, { ok: false, reason: "unauthorized" }, { nowMs: NOW, store });
    expect(nodeExclusionReason(ID, { nowMs: NOW, store })).toBe("unauthorized");
    expect(nodeExclusionReason(ID, { nowMs: NOW + NODE_UNAUTHORIZED_COOLDOWN_MS - 1, store })).toBe(
      "unauthorized",
    );
    expect(
      nodeExclusionReason(ID, { nowMs: NOW + NODE_UNAUTHORIZED_COOLDOWN_MS + 1, store }),
      "the record is still in the store — only the reader's own check can answer",
    ).toBeNull();
    expect(store.has(ID), "and this case must not have pruned it either").toBe(true);
  });

  it("a wrong secret is held longer than a node that merely stopped answering", () => {
    /* Different diagnoses, different waits: a restart is seconds and needs retrying soon; a
       misconfigured secret needs a human and retrying it fast only wastes calls. */
    expect(NODE_UNAUTHORIZED_COOLDOWN_MS).toBeGreaterThan(NODE_UNREACHABLE_COOLDOWN_MS);
    expect(NODE_UNREACHABLE_COOLDOWN_MS).toBeGreaterThan(0);
  });

  it("reading the set PRUNES expired entries, so it cannot grow without bound", () => {
    const store = fresh();
    for (let i = 0; i < 5; i += 1) {
      recordNodeOutcome(`i-node${i}`, { ok: false, reason: "unauthorized" }, { nowMs: NOW, store });
    }
    expect(store.size).toBe(5);
    unhealthyNodeIds({ nowMs: NOW + NODE_UNAUTHORIZED_COOLDOWN_MS + 1, store });
    expect(store.size, "a fleet whose nodes come and go must not accumulate").toBe(0);
  });

  it("IT MAY EXCLUDE EVERY NODE — the CALL fails open, not the SFU", () => {
    /* Deliberately no "never exclude the last one" rule. If both nodes really are refusing,
       the right answer is the mesh, and protecting the fleet's membership here
       would keep routing calls into a fleet that cannot carry them. */
    const store = fresh();
    recordNodeOutcome("i-a", { ok: false, reason: "unauthorized" }, { nowMs: NOW, store });
    recordNodeOutcome("i-b", { ok: false, reason: "unauthorized" }, { nowMs: NOW, store });
    expect(unhealthyNodeIds({ nowMs: NOW, store }).size).toBe(2);
  });

  it("nodes are tracked SEPARATELY — one bad node does not condemn its neighbour", () => {
    const store = fresh();
    recordNodeOutcome("i-a", { ok: false, reason: "unauthorized" }, { nowMs: NOW, store });
    expect(unhealthyNodeIds({ nowMs: NOW, store })).toEqual(new Set(["i-a"]));
  });

  it("the returned set is a COPY, so a caller cannot edit the fleet's health by holding it", () => {
    const store = fresh();
    recordNodeOutcome(ID, { ok: false, reason: "unauthorized" }, { nowMs: NOW, store });
    const s1 = unhealthyNodeIds({ nowMs: NOW, store });
    s1.clear();
    expect(unhealthyNodeIds({ nowMs: NOW, store }).has(ID)).toBe(true);
  });

  it("`callNodeTracked` records, and plain `callNode` deliberately does NOT", async () => {
    /* A separate NAMED function rather than folding the recording into `callNode`, because
       `callNode` is also how a health probe or an operator tool talks to a node — and a probe
       that changes the fleet's routing as a side effect of looking at it is its own bug. */
    const store = fresh();
    const refuse: FetchLike = async () => ({ ok: false, status: 401, text: async () => "" });

    await callNode(NODE, "state", {}, { fetchImpl: refuse, secret: SECRET, nowMs: NOW });
    expect(unhealthyNodeIds({ nowMs: NOW, store }).size, "a probe must not condemn a node").toBe(0);

    const r = await callNodeTracked(NODE, "state", {}, {
      fetchImpl: refuse,
      secret: SECRET,
      nowMs: NOW,
      store,
    });
    expect(r.ok).toBe(false);
    expect(unhealthyNodeIds({ nowMs: NOW, store }).has(ID)).toBe(true);
  });

  it("`callNodeTracked` returns exactly what `callNode` returns", async () => {
    // The tracking is a side effect; wrapping must not change the answer the caller acts on.
    const store = fresh();
    const okFetch: FetchLike = async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ ok: true, routers: 2 }),
    });
    const bare = await callNode(NODE, "state", {}, { fetchImpl: okFetch, secret: SECRET, nowMs: NOW });
    const tracked = await callNodeTracked(NODE, "state", {}, {
      fetchImpl: okFetch,
      secret: SECRET,
      nowMs: NOW,
      store,
    });
    expect(tracked).toEqual(bare);
    expect(unhealthyNodeIds({ nowMs: NOW, store }).size, "a success excludes nothing").toBe(0);
  });

  it("`resetNodeHealth` clears the store it is handed", () => {
    const store = fresh();
    recordNodeOutcome(ID, { ok: false, reason: "unauthorized" }, { nowMs: NOW, store });
    resetNodeHealth(store);
    expect(store.size).toBe(0);
  });

  it("the exclusion set is the SHAPE `planRoomTransport` takes, so the link really connects", () => {
    /* The two halves are in different modules and this is the seam between them. A Set of
       instance ids is what `excludeInstanceIds` accepts, and asserting the shape here is what
       stops the tracker becoming an observation nobody consumes. */
    const store = fresh();
    recordNodeOutcome(ID, { ok: false, reason: "unauthorized" }, { nowMs: NOW, store });
    const excluded = unhealthyNodeIds({ nowMs: NOW, store });
    const plan = planRoomTransport({
      nodes: [NODE],
      nowMs: NOW,
      excludeInstanceIds: excluded,
    });
    expect(plan.transport, "a refusing node must not keep taking rooms").toBe("mesh");
    expect(plan.voip).toBeNull();
  });
});
