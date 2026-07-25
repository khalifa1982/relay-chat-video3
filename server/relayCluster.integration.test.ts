import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Cross-instance signaling integration test (phase-2). Drives the REAL
 * attachRelay clustered path: peer A is homed on the leader (through the actual
 * /api/relay/stream + /api/relay/send handlers), peer B is homed on a DIFFERENT
 * simulated instance ("inst-B") whose frames are injected over an in-memory bus.
 * Proves A's invite rings B ACROSS instances and B's accept connects both — the
 * exact scenario that fails on an unclustered multi-instance deploy.
 *
 * The Redis bus + ioredis lease are mocked (in-memory) so the test is Redis-free
 * and deterministic; the real routing/leader/handleMessage code runs unchanged.
 */
const { bus, busSub, busPub } = vi.hoisted(() => {
  const bus = new Map<string, Set<(p: unknown) => void>>();
  const busSub = (ch: string, h: (p: unknown) => void) => {
    let s = bus.get(ch);
    if (!s) { s = new Set(); bus.set(ch, s); }
    s.add(h);
  };
  // The real publishBus stamps the publishing instance's INSTANCE_ID into the
  // envelope, and dispatchMessage hands it to the handler as `fromInstance`
  // (v2.99.49 — the leader refuses a frame whose `home` claims to be someone
  // other than its publisher). This fake models that: it derives the publisher
  // from the frame's own `home` when present, which is exactly what a genuine
  // instance-B publish would produce, and falls back to "LEADER" otherwise.
  const busPub = (ch: string, p: unknown) => {
    const from = (p as { home?: unknown } | null)?.home;
    const fromInstance = typeof from === "string" ? from : "LEADER";
    bus.get(ch)?.forEach((h) => { try { h(p, fromInstance); } catch { /* */ } });
  };
  return { bus, busSub, busPub };
});

vi.mock("./redisBus", () => ({
  INSTANCE_ID: "LEADER",
  busEnabled: () => true,
  publishBus: busPub,
  subscribeBus: busSub,
  initBusyStateSync: () => {},
  touchBusyState: () => {},
  readBusyPinsFromRedis: async () => new Set<string>(),
  readPlCountsFromRedis: async () => new Map<string, number>(),
}));
vi.mock("ioredis", () => ({
  default: class {
    on() { return this; }
    async set() { return "OK"; }
    async get() { return "LEADER"; }
    async eval() { return 1; }
    disconnect() {}
  },
}));

import { attachRelay } from "./relay";
import { _setLeaderForTest, stopClusterRuntime, sigInChannel, sigOutChannel } from "./relayCluster";

type Handler = (req: any, res: any) => void;

function sseObjs(writes: string[]): any[] {
  return writes
    .join("")
    .split("\n\n")
    .map((l) => l.replace(/^data: /, "").trim())
    .filter((l) => l.startsWith("{"))
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}

describe("cross-instance signaling (integration)", () => {
  let routes: Record<string, Handler>;
  const closers: Array<() => void> = [];

  beforeEach(() => {
    vi.useFakeTimers();
    bus.clear();
    closers.length = 0;
    process.env.RELAY_CLUSTER = "1";
    process.env.REDIS_URL = "redis://mock";
    process.env.RELAY_RATELIMIT_OFF = "1";
    routes = {};
    const app: any = {
      get: (p: string, h: Handler) => { routes["GET " + p] = h; },
      post: (p: string, h: Handler) => { routes["POST " + p] = h; },
      use: () => {},
    };
    attachRelay(app);
    _setLeaderForTest(true, "LEADER"); // this instance holds the lease
  });
  afterEach(() => {
    closers.forEach((c) => { try { c(); } catch { /* */ } });
    stopClusterRuntime();
    vi.clearAllTimers();
    vi.useRealTimers();
    delete process.env.RELAY_CLUSTER;
    delete process.env.REDIS_URL;
    delete process.env.RELAY_RATELIMIT_OFF;
  });

  it("A (leader) calls B (other instance): register → ring → accept all route across the bus", async () => {
    // ── Peer A: homed on the leader, via the REAL SSE + POST handlers ──
    const aWrites: string[] = [];
    const aRes: any = {
      status() { return this; },
      setHeader() {},
      flushHeaders() {},
      write(d: string) { aWrites.push(d); return true; },
      end() {},
      on(ev: string, cb: () => void) { if (ev === "close") closers.push(cb); },
    };
    routes["GET /api/relay/stream"]({ query: { cid: "cid-A" }, headers: {}, socket: { remoteAddress: "1.1.1.1" }, on() {} }, aRes);
    const postA = (message: unknown) =>
      routes["POST /api/relay/send"](
        { body: { cid: "cid-A", message }, headers: {}, socket: { remoteAddress: "1.1.1.1" } },
        { status() { return this; }, json() { return this; } }
      );

    await postA({ type: "register", name: "Alice" }); // register resolves identity (async, F1)
    const aReg = sseObjs(aWrites).find((o) => o.type === "registered");
    expect(aReg?.pin).toMatch(/^\d{6}$/);
    const aPin: string = aReg.pin;

    // ── Peer B: homed on a REMOTE instance "inst-B" — inject inbound over the
    //    bus (as a remote proxy would) and capture B's out-channel deliveries. ──
    const bOut: any[] = [];
    busSub(sigOutChannel("inst-B"), (f: any) => bOut.push(f));
    const injectB = (raw: unknown) => busPub(sigInChannel("LEADER"), { cid: "cid-B", home: "inst-B", raw });
    injectB({ type: "__connect" });
    injectB({ type: "register", name: "Bob" });
    const bReg = bOut.map((f) => f.obj).find((o) => o?.type === "registered");
    expect(bReg?.pin).toMatch(/^\d{6}$/);
    const bPin: string = bReg.pin;
    expect(bPin).not.toBe(aPin);

    // ── A invites B → B rings ACROSS the bus (the core cross-instance path) ──
    postA({ type: "invite", to: bPin });
    const ring = bOut.map((f) => f.obj).find((o) => o?.type === "ring");
    expect(ring).toBeTruthy();
    expect(ring.from).toBe(aPin);
    expect(ring.roomId).toBeTruthy();
    // A sees the "ringing" ack routed back to it locally.
    expect(sseObjs(aWrites).some((o) => o.type === "ringing" && o.pin === bPin)).toBe(true);

    // ── B accepts → both sides connect ──
    injectB({ type: "accept", roomId: ring.roomId });
    expect(bOut.map((f) => f.obj).some((o) => o?.type === "joined")).toBe(true);
    expect(sseObjs(aWrites).some((o) => o.type === "peer-joined")).toBe(true);
  });

  it("B's SDP signal relays back to A across instances", async () => {
    // Register both (A local, B remote) and open a call.
    const aWrites: string[] = [];
    const aRes: any = {
      status() { return this; }, setHeader() {}, flushHeaders() {},
      write(d: string) { aWrites.push(d); return true; }, end() {},
      on(ev: string, cb: () => void) { if (ev === "close") closers.push(cb); },
    };
    routes["GET /api/relay/stream"]({ query: { cid: "cid-A" }, headers: {}, socket: { remoteAddress: "1.1.1.1" }, on() {} }, aRes);
    const postA = (m: unknown) => routes["POST /api/relay/send"]({ body: { cid: "cid-A", message: m }, headers: {}, socket: { remoteAddress: "1.1.1.1" } }, { status() { return this; }, json() { return this; } });
    await postA({ type: "register", name: "Alice" }); // register resolves identity (async, F1)
    const aPin = sseObjs(aWrites).find((o) => o.type === "registered").pin;

    const bOut: any[] = [];
    busSub(sigOutChannel("inst-B"), (f: any) => bOut.push(f));
    const injectB = (raw: unknown) => busPub(sigInChannel("LEADER"), { cid: "cid-B", home: "inst-B", raw });
    injectB({ type: "__connect" });
    injectB({ type: "register", name: "Bob" });
    const bPin = bOut.map((f) => f.obj).find((o) => o?.type === "registered").pin;
    postA({ type: "invite", to: bPin });
    const roomId = bOut.map((f) => f.obj).find((o) => o?.type === "ring").roomId;
    injectB({ type: "accept", roomId });

    // B sends an SDP answer to A — it must relay to A on the leader.
    injectB({ type: "signal", to: aPin, data: { sdp: "v=0-answer" } });
    const sig = sseObjs(aWrites).find((o) => o.type === "signal");
    expect(sig).toBeTruthy();
    expect(sig.data?.sdp).toBe("v=0-answer");
  });
});
