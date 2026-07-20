/* ============================================================
   v2.91 — Redis event bus: loop-safety, gating, busy-state sync.

   Everything here runs against an in-memory FakeRedis implementing
   the narrow RedisCommandClient surface — no server needed. The
   companion file redisBusLive.test.ts exercises the same paths
   against a REAL redis-server when one is installed (skipped
   otherwise).
   ============================================================ */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import {
  INSTANCE_ID,
  V2EV_CHANNEL,
  BUSY_PINS_KEY,
  PL_COUNTS_KEY,
  BUSY_STATE_TTL_S,
  busEnabled,
  encodeEnvelope,
  decodeEnvelope,
  shouldDeliver,
  diffSets,
  diffCounts,
  publishBus,
  subscribeBus,
  initBusyStateSync,
  touchBusyState,
  readBusyPinsFromRedis,
  readPlCountsFromRedis,
  _setRedisForTests,
  _runBusySyncNowForTests,
  _dispatchForTests,
  _resetBusForTests,
  _resubscribeAllForTests,
  type RedisCommandClient,
  type RedisSubscriberClient,
  type BusySnapshot,
} from "./redisBus";
import {
  createRegistry,
  computeBusySnapshot,
  handleMessage,
  pinsInCallAsync,
  partyLineLiveCountsAsync,
  _setActiveRegistryForTests,
  type RelayClient,
  type RelaySocket,
} from "./relay";
import {
  publishToIdentity,
  publishPresenceTo,
  _handleBusV2Event,
  _addSseClientForTests,
} from "./v2events";

/* ── fake redis ── */

class FakeRedis implements RedisCommandClient {
  sets = new Map<string, Set<string>>();
  hashes = new Map<string, Map<string, string>>();
  published: Array<{ channel: string; message: string }> = [];
  expires: Array<{ key: string; seconds: number }> = [];
  calls: string[] = [];
  failNextRead = false;
  /** Simulate a Redis outage where commands neither resolve nor reject. */
  hangReads = false;

  async publish(channel: string, message: string) {
    this.calls.push("publish");
    this.published.push({ channel, message });
    return 1;
  }
  async smembers(key: string) {
    this.calls.push("smembers");
    if (this.failNextRead) throw new Error("boom");
    return Array.from(this.sets.get(key) ?? []);
  }
  async smismember(key: string, ...members: string[]) {
    this.calls.push("smismember");
    if (this.hangReads) return new Promise<number[]>(() => {});
    if (this.failNextRead) throw new Error("boom");
    const s = this.sets.get(key);
    return members.map((m) => (s?.has(m) ? 1 : 0));
  }
  async sadd(key: string, ...members: string[]) {
    this.calls.push("sadd");
    let s = this.sets.get(key);
    if (!s) {
      s = new Set();
      this.sets.set(key, s);
    }
    members.forEach((m) => s!.add(m));
    return members.length;
  }
  async srem(key: string, ...members: string[]) {
    this.calls.push("srem");
    const s = this.sets.get(key);
    members.forEach((m) => s?.delete(m));
    return members.length;
  }
  async expire(key: string, seconds: number) {
    this.calls.push("expire");
    this.expires.push({ key, seconds });
    return 1;
  }
  async hgetall(key: string) {
    this.calls.push("hgetall");
    if (this.failNextRead) throw new Error("boom");
    return Object.fromEntries(this.hashes.get(key) ?? []);
  }
  async hset(key: string, ...fieldValues: (string | number)[]) {
    this.calls.push("hset");
    let h = this.hashes.get(key);
    if (!h) {
      h = new Map();
      this.hashes.set(key, h);
    }
    for (let i = 0; i + 1 < fieldValues.length; i += 2) {
      h.set(String(fieldValues[i]), String(fieldValues[i + 1]));
    }
    return 1;
  }
  async hdel(key: string, ...fields: string[]) {
    this.calls.push("hdel");
    const h = this.hashes.get(key);
    fields.forEach((f) => h?.delete(f));
    return fields.length;
  }
  async hmget(key: string, ...fields: string[]) {
    this.calls.push("hmget");
    if (this.hangReads) return new Promise<(string | null)[]>(() => {});
    if (this.failNextRead) throw new Error("boom");
    const h = this.hashes.get(key);
    return fields.map((f) => h?.get(f) ?? null);
  }
}

/** Scriptable subscriber — records SUBSCRIBE attempts, can fail the next one
 *  (a Redis outage at boot, v2.91 review D3). */
class FakeSubscriber implements RedisSubscriberClient {
  attempts: string[] = [];
  failNext = false;
  async subscribe(...channels: string[]) {
    this.attempts.push(...channels);
    if (this.failNext) {
      this.failNext = false;
      throw new Error("redis unavailable at boot");
    }
    return channels.length;
  }
  on() {
    return this;
  }
}

let savedRedisUrl: string | undefined;
beforeEach(() => {
  savedRedisUrl = process.env.REDIS_URL;
  delete process.env.REDIS_URL;
  _resetBusForTests();
});
afterEach(() => {
  if (savedRedisUrl === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = savedRedisUrl;
  _resetBusForTests();
  _setActiveRegistryForTests(null);
});

const nextTick = () => new Promise<void>((r) => setImmediate(() => setImmediate(r)));

/* ── envelope + loop-safety ── */

describe("bus envelope (loop-safety primitives)", () => {
  it("encode/decode round-trips instance id + payload", () => {
    const raw = encodeEnvelope("abc123", { t: [1, 2], ev: { kind: "ping" } });
    const env = decodeEnvelope(raw);
    expect(env).toEqual({ i: "abc123", p: { t: [1, 2], ev: { kind: "ping" } } });
  });
  it("decode rejects malformed frames instead of throwing", () => {
    expect(decodeEnvelope("not json")).toBeNull();
    expect(decodeEnvelope('{"no":"i"}')).toBeNull();
    expect(decodeEnvelope('{"i":42,"p":{}}')).toBeNull();
  });
  it("shouldDeliver drops the publisher's own envelope, keeps foreign ones", () => {
    expect(shouldDeliver({ i: INSTANCE_ID, p: null }, INSTANCE_ID)).toBe(false);
    expect(shouldDeliver({ i: "someone-else", p: null }, INSTANCE_ID)).toBe(true);
  });
  it("INSTANCE_ID is a per-boot random hex token", () => {
    expect(INSTANCE_ID).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("dispatch (subscriber side)", () => {
  it("delivers a FOREIGN envelope's payload to channel handlers", () => {
    const got: unknown[] = [];
    subscribeBus("chan-x", (p) => got.push(p));
    _dispatchForTests("chan-x", encodeEnvelope("other-instance", { hello: 1 }));
    expect(got).toEqual([{ hello: 1 }]);
  });
  it("ignores its OWN envelopes (local delivery already happened pre-publish)", () => {
    const got: unknown[] = [];
    subscribeBus("chan-x", (p) => got.push(p));
    _dispatchForTests("chan-x", encodeEnvelope(INSTANCE_ID, { hello: 1 }));
    expect(got).toEqual([]);
  });
  it("ignores garbage frames and unknown channels", () => {
    const got: unknown[] = [];
    subscribeBus("chan-x", (p) => got.push(p));
    _dispatchForTests("chan-x", "garbage{{{");
    _dispatchForTests("chan-other", encodeEnvelope("other", { hello: 1 }));
    expect(got).toEqual([]);
  });
});

/* ── subscribe lifecycle (v2.91 review D3: boot-failure recovery) ── */

describe("subscribe lifecycle", () => {
  const tick = () => new Promise<void>((r) => setImmediate(r));

  it("a rejected boot-time SUBSCRIBE is NOT latched — the next subscribeBus re-issues it", async () => {
    const sub = new FakeSubscriber();
    sub.failNext = true; // Redis down when the process boots
    _setRedisForTests(new FakeRedis(), sub);
    subscribeBus("chan-boot", () => {});
    await tick();
    expect(sub.attempts).toEqual(["chan-boot"]); // tried once, rejected
    // Before the fix the channel was latched as subscribed on REJECTION too,
    // so this second registration silently skipped the SUBSCRIBE forever.
    subscribeBus("chan-boot", () => {});
    await tick();
    expect(sub.attempts).toEqual(["chan-boot", "chan-boot"]);
  });

  it("a RESOLVED SUBSCRIBE is latched — duplicate registrations do not re-issue", async () => {
    const sub = new FakeSubscriber();
    _setRedisForTests(new FakeRedis(), sub);
    subscribeBus("chan-ok", () => {});
    await tick();
    subscribeBus("chan-ok", () => {});
    await tick();
    expect(sub.attempts).toEqual(["chan-ok"]);
  });

  it("the reconnect sweep (sub 'ready') re-issues SUBSCRIBE for every handler channel", async () => {
    const sub = new FakeSubscriber();
    sub.failNext = true;
    _setRedisForTests(new FakeRedis(), sub);
    subscribeBus("chan-a", () => {});
    await tick(); // subscription lost to the boot outage
    _resubscribeAllForTests(); // = the sub connection's "ready" event firing
    await tick();
    expect(sub.attempts).toEqual(["chan-a", "chan-a"]);
    // Once healed, further sweeps are harmless duplicates by design
    // (idempotent SUBSCRIBE), and dispatch works again end-to-end.
    const got: unknown[] = [];
    subscribeBus("chan-a", (p) => got.push(p));
    _dispatchForTests("chan-a", encodeEnvelope("other-instance", { ok: 1 }));
    expect(got).toEqual([{ ok: 1 }]);
  });
});

/* ── gating ── */

describe("REDIS_URL gating", () => {
  it("busEnabled tracks the env var per-call", () => {
    expect(busEnabled()).toBe(false);
    process.env.REDIS_URL = "redis://127.0.0.1:6379";
    expect(busEnabled()).toBe(true);
    delete process.env.REDIS_URL;
    expect(busEnabled()).toBe(false);
  });

  it("publishBus is a silent no-op when the bus is off (no client, no throw)", () => {
    expect(() => publishBus("chan", { x: 1 })).not.toThrow();
  });

  it("pinsInCallAsync stays LOCAL when REDIS_URL is unset — even if a Redis were reachable", async () => {
    const fake = new FakeRedis();
    await fake.sadd(BUSY_PINS_KEY, "111111"); // a mirror that would claim busy
    _setRedisForTests(fake);
    const reg = createRegistry();
    _setActiveRegistryForTests(reg);
    // no REDIS_URL ⇒ local verdict (not busy), Redis untouched by the read
    expect((await pinsInCallAsync(["111111"])).has("111111")).toBe(false);
    expect(fake.calls).not.toContain("smismember");
  });

  it("pinsInCallAsync reads the Redis mirror ONLY on an API-tier instance (bus on, no local clients)", async () => {
    const fake = new FakeRedis();
    await fake.sadd(BUSY_PINS_KEY, "111111");
    fake.calls.length = 0;
    _setRedisForTests(fake);
    process.env.REDIS_URL = "redis://test";

    // API tier: empty local registry ⇒ Redis wins.
    const emptyReg = createRegistry();
    _setActiveRegistryForTests(emptyReg);
    expect((await pinsInCallAsync(["111111"])).has("111111")).toBe(true);
    expect(fake.calls).toContain("smismember");

    // Signaling node: ANY local client ⇒ local registry is authoritative.
    fake.calls.length = 0;
    const socket: RelaySocket = { send: () => {}, close: () => {} };
    const client: RelayClient = {
      socket,
      name: "T",
      roomId: null,
      cid: "c1",
      graceT: null,
      ringing: new Set(),
    };
    emptyReg.clients.set("222222", client);
    expect((await pinsInCallAsync(["111111"])).has("111111")).toBe(false);
    expect(fake.calls).not.toContain("smismember");
  });

  it("partyLineLiveCountsAsync routes the same way", async () => {
    const fake = new FakeRedis();
    await fake.hset(PL_COUNTS_KEY, "343434", 3);
    _setRedisForTests(fake);
    process.env.REDIS_URL = "redis://test";
    _setActiveRegistryForTests(createRegistry()); // API tier
    const counts = await partyLineLiveCountsAsync(["343434", "999999"]);
    expect(counts.get("343434")).toBe(3);
    expect(counts.get("999999")).toBe(0);
    delete process.env.REDIS_URL; // bus off ⇒ local zeros even with a mirror
    const local = await partyLineLiveCountsAsync(["343434"]);
    expect(local.get("343434")).toBe(0);
  });
});

/* ── v2events integration ── */

function fakeSse() {
  const writes: string[] = [];
  const res = {
    write: (chunk: string) => {
      writes.push(chunk);
      return true;
    },
    destroyed: false,
    writableEnded: false,
  };
  return { res, writes };
}

describe("v2 SSE fan-out over the bus", () => {
  it("publishToIdentity delivers LOCALLY FIRST, then publishes one envelope for the others", async () => {
    const fake = new FakeRedis();
    _setRedisForTests(fake);
    process.env.REDIS_URL = "redis://test";
    const { res, writes } = fakeSse();
    const cleanup = _addSseClientForTests(4242, res);
    try {
      publishToIdentity(4242, { kind: "typing", conversationId: 1, from: 9 });
      // Local delivery is synchronous — BEFORE the publish promise resolves.
      expect(writes.length).toBe(1);
      expect(writes[0]).toContain('"kind":"typing"');
      await nextTick();
      expect(fake.published.length).toBe(1);
      expect(fake.published[0].channel).toBe(V2EV_CHANNEL);
      const env = decodeEnvelope(fake.published[0].message)!;
      expect(env.i).toBe(INSTANCE_ID);
      expect(env.p).toEqual({
        t: [4242],
        ev: { kind: "typing", conversationId: 1, from: 9 },
      });
    } finally {
      cleanup();
    }
  });

  it("still publishes when the target has NO local stream (that's the whole point)", async () => {
    const fake = new FakeRedis();
    _setRedisForTests(fake);
    process.env.REDIS_URL = "redis://test";
    publishToIdentity(777, { kind: "ping" });
    await nextTick();
    expect(fake.published.length).toBe(1);
  });

  it("a FOREIGN envelope delivers to this instance's local SSE clients", () => {
    const { res, writes } = fakeSse();
    const cleanup = _addSseClientForTests(4242, res);
    try {
      subscribeBus(V2EV_CHANNEL, _handleBusV2Event);
      _dispatchForTests(
        V2EV_CHANNEL,
        encodeEnvelope("other-instance", {
          t: [4242],
          ev: { kind: "message", conversationId: 5, from: 6 },
        })
      );
      expect(writes.length).toBe(1);
      expect(writes[0]).toContain('"conversationId":5');
    } finally {
      cleanup();
    }
  });

  it("this instance's OWN envelope is NOT re-delivered (no double events)", () => {
    const { res, writes } = fakeSse();
    const cleanup = _addSseClientForTests(4242, res);
    try {
      subscribeBus(V2EV_CHANNEL, _handleBusV2Event);
      _dispatchForTests(
        V2EV_CHANNEL,
        encodeEnvelope(INSTANCE_ID, { t: [4242], ev: { kind: "ping" } })
      );
      expect(writes.length).toBe(0);
    } finally {
      cleanup();
    }
  });

  it("_handleBusV2Event validates payload shape and supports the '*' broadcast target", () => {
    const a = fakeSse();
    const b = fakeSse();
    const cleanA = _addSseClientForTests(1, a.res);
    const cleanB = _addSseClientForTests(2, b.res);
    try {
      _handleBusV2Event(null);
      _handleBusV2Event({ t: [1] }); // no ev
      _handleBusV2Event({ t: "nope", ev: { kind: "ping" } }); // bad targets
      expect(a.writes.length + b.writes.length).toBe(0);
      _handleBusV2Event({
        t: "*",
        ev: { kind: "presence", number: "123456", online: true, lastSeenAt: "x" },
      });
      expect(a.writes.length).toBe(1);
      expect(b.writes.length).toBe(1);
    } finally {
      cleanA();
      cleanB();
    }
  });

  it("publishPresenceTo sends ONE envelope carrying the whole audience", async () => {
    const fake = new FakeRedis();
    _setRedisForTests(fake);
    process.env.REDIS_URL = "redis://test";
    publishPresenceTo([1, 2, 3], "123456", true, new Date("2026-01-01T00:00:00Z"));
    await nextTick();
    expect(fake.published.length).toBe(1);
    const env = decodeEnvelope(fake.published[0].message)!;
    expect((env.p as { t: number[] }).t).toEqual([1, 2, 3]);
  });
});

/* ── busy-state sync ── */

describe("pure diff helpers", () => {
  it("diffSets computes minimal SADD/SREM", () => {
    expect(diffSets(["a", "b"], ["b", "c"])).toEqual({ add: ["c"], remove: ["a"] });
    expect(diffSets([], [])).toEqual({ add: [], remove: [] });
  });
  it("diffCounts computes HSET pairs + HDEL fields", () => {
    expect(
      diffCounts({ l1: "2", l2: "5" }, new Map([["l1", 3], ["l3", 1]]))
    ).toEqual({ set: ["l1", 3, "l3", 1], del: ["l2"] });
    // unchanged values are NOT rewritten
    expect(diffCounts({ l1: "2" }, new Map([["l1", 2]]))).toEqual({ set: [], del: [] });
  });
});

describe("busy-state sync into Redis", () => {
  function withProvider(snap: () => BusySnapshot, fake: FakeRedis) {
    _setRedisForTests(fake);
    process.env.REDIS_URL = "redis://test";
    initBusyStateSync(snap);
  }

  it("mirrors busy pins + party-line counts, with the self-heal TTL", async () => {
    const fake = new FakeRedis();
    let snap: BusySnapshot = {
      busyPins: ["111111", "222222"],
      plCounts: new Map([["343434", 2]]),
      hasClients: true,
    };
    withProvider(() => snap, fake);
    await _runBusySyncNowForTests();
    expect(Array.from(fake.sets.get(BUSY_PINS_KEY)!)).toEqual(["111111", "222222"]);
    expect(fake.hashes.get(PL_COUNTS_KEY)!.get("343434")).toBe("2");
    expect(fake.expires).toContainEqual({ key: BUSY_PINS_KEY, seconds: BUSY_STATE_TTL_S });
    expect(fake.expires).toContainEqual({ key: PL_COUNTS_KEY, seconds: BUSY_STATE_TTL_S });

    // Call ends for 111111; the line empties → diff writes only.
    snap = { busyPins: ["222222"], plCounts: new Map(), hasClients: true };
    fake.calls.length = 0;
    await _runBusySyncNowForTests();
    expect(Array.from(fake.sets.get(BUSY_PINS_KEY)!)).toEqual(["222222"]);
    expect(fake.hashes.get(PL_COUNTS_KEY)!.size).toBe(0);
    expect(fake.calls).toContain("srem");
    expect(fake.calls).toContain("hdel");
    expect(fake.calls).not.toContain("sadd"); // nothing new to add
  });

  it("heals foreign ghosts (a crashed predecessor's pins) once it HAS clients", async () => {
    const fake = new FakeRedis();
    await fake.sadd(BUSY_PINS_KEY, "999999"); // ghost from a dead instance
    withProvider(
      () => ({ busyPins: ["111111"], plCounts: new Map(), hasClients: true }),
      fake
    );
    await _runBusySyncNowForTests();
    expect(Array.from(fake.sets.get(BUSY_PINS_KEY)!)).toEqual(["111111"]);
  });

  it("an API-tier instance (never any relay clients) NEVER writes or wipes", async () => {
    const fake = new FakeRedis();
    await fake.sadd(BUSY_PINS_KEY, "111111"); // the signaling node's live state
    fake.calls.length = 0;
    withProvider(
      () => ({ busyPins: [], plCounts: new Map(), hasClients: false }),
      fake
    );
    await _runBusySyncNowForTests();
    await _runBusySyncNowForTests();
    expect(fake.calls).toEqual([]); // not even a read
    expect(fake.sets.get(BUSY_PINS_KEY)!.has("111111")).toBe(true);
  });

  // Pin updated for v2.91 review D6: the old "one final clearing sync" after
  // the last client left diffed the ENTIRE key toward this node's empty truth
  // and wiped entries a NEW signaling node had just written during a graceful
  // re-pin — now a no-clients node never writes; residue ages out via the TTL.
  it("after the last CLIENT disconnects the node goes quiet — residue is left to the TTL, never wiped", async () => {
    const fake = new FakeRedis();
    let snap: BusySnapshot = {
      busyPins: ["111111"],
      plCounts: new Map(),
      hasClients: true,
    };
    withProvider(() => snap, fake);
    await _runBusySyncNowForTests();
    expect(fake.sets.get(BUSY_PINS_KEY)!.has("111111")).toBe(true);

    // A call that ends while clients REMAIN connected still clears instantly.
    snap = { busyPins: [], plCounts: new Map(), hasClients: true };
    await _runBusySyncNowForTests();
    expect(fake.sets.get(BUSY_PINS_KEY)!.size).toBe(0);

    // Demotion: last client gone while a successor may own the keys — this
    // node must not touch them at all (not even a read).
    await fake.sadd(BUSY_PINS_KEY, "222222"); // the successor's live state
    snap = { busyPins: [], plCounts: new Map(), hasClients: false };
    fake.calls.length = 0;
    await _runBusySyncNowForTests();
    expect(fake.calls).toEqual([]);
    expect(fake.sets.get(BUSY_PINS_KEY)!.has("222222")).toBe(true);
  });

  it("touchBusyState coalesces to a single next-tick sync", async () => {
    const fake = new FakeRedis();
    let syncs = 0;
    withProvider(() => {
      syncs++;
      return { busyPins: ["111111"], plCounts: new Map(), hasClients: true };
    }, fake);
    touchBusyState();
    touchBusyState();
    touchBusyState();
    expect(syncs).toBe(0); // nothing yet — scheduled, not run
    await nextTick();
    expect(syncs).toBe(1);
  });

  it("a sync failure is swallowed (never breaks call handling) and retried on the next touch", async () => {
    const fake = new FakeRedis();
    fake.failNextRead = true;
    withProvider(
      () => ({ busyPins: ["111111"], plCounts: new Map(), hasClients: true }),
      fake
    );
    await _runBusySyncNowForTests(); // throws internally, swallowed
    expect(fake.sets.get(BUSY_PINS_KEY)).toBeUndefined();
    fake.failNextRead = false;
    await _runBusySyncNowForTests();
    expect(fake.sets.get(BUSY_PINS_KEY)!.has("111111")).toBe(true);
  });

  it("merging a SOLO held party line syncs the mirror (v2.91 review D7 — the funnel-less touchpoint)", async () => {
    // Bob answered a call while alone on party line 343434 → the line is HELD.
    // `merge` with an empty movers list deletes the held pl- room WITHOUT
    // crossing joinRoomMember/leaveRoom/reapRoom, so the handler's own
    // touchBusyState() is the only thing keeping the Redis mirror honest.
    const fake = new FakeRedis();
    const reg = createRegistry();
    _setRedisForTests(fake);
    process.env.REDIS_URL = "redis://test";
    initBusyStateSync(() => computeBusySnapshot(reg));

    const socket: RelaySocket = { send: () => {}, close: () => {} };
    const mk = (name: string): RelayClient => ({
      socket,
      name,
      roomId: "r-live",
      cid: "c" + name,
      graceT: null,
      ringing: new Set(),
    });
    reg.clients.set("111111", mk("Bob"));
    reg.clients.set("222222", mk("Carol"));
    reg.rooms.set("r-live", new Set(["111111", "222222"]));
    reg.roomMeta.set("r-live", {
      startedAt: 1,
      answeredAt: 1,
      lastActiveAt: 1,
      dialedNumber: null,
      accepted: true,
      roster: new Map(),
      hostPin: null,
      cohosts: new Set(),
    });
    reg.rooms.set("pl-343434", new Set(["111111"]));
    reg.heldRoom.set("111111", "pl-343434");
    await _runBusySyncNowForTests();
    expect(fake.hashes.get(PL_COUNTS_KEY)!.get("343434")).toBe("1");

    handleMessage(reg, { socket, pin: "111111", setPin: () => {} }, { type: "merge" });
    expect(reg.rooms.has("pl-343434")).toBe(false); // held room reaped locally
    await nextTick(); // the coalesced touch runs its sync
    expect(fake.hashes.get(PL_COUNTS_KEY)!.has("343434")).toBe(false);
  });
});

/* ── cross-tier reads ── */

describe("cross-tier read helpers", () => {
  it("readBusyPinsFromRedis maps SMISMEMBER flags back to a pin set", async () => {
    const fake = new FakeRedis();
    await fake.sadd(BUSY_PINS_KEY, "111111", "333333");
    _setRedisForTests(fake);
    const got = await readBusyPinsFromRedis(["111111", "222222", "333333"]);
    expect(got).toEqual(new Set(["111111", "333333"]));
    expect(await readBusyPinsFromRedis([])).toEqual(new Set());
  });
  it("readBusyPinsFromRedis degrades to empty on a Redis error (safe default)", async () => {
    const fake = new FakeRedis();
    fake.failNextRead = true;
    _setRedisForTests(fake);
    expect((await readBusyPinsFromRedis(["111111"])).size).toBe(0);
  });
  it("readPlCountsFromRedis parses counts and zero-fills unknowns", async () => {
    const fake = new FakeRedis();
    await fake.hset(PL_COUNTS_KEY, "343434", 4);
    _setRedisForTests(fake);
    const counts = await readPlCountsFromRedis(["343434", "555555"]);
    expect(counts.get("343434")).toBe(4);
    expect(counts.get("555555")).toBe(0);
  });

  it("a HUNG Redis read resolves to safe defaults within the ~1.5s bound (v2.91 review D4)", async () => {
    // With Redis down, ioredis can park commands 7s-2min in the offline
    // queue; API requests (directory.lookup, contacts.list, partyLines.list)
    // await these helpers and must NEVER hang that long.
    vi.useFakeTimers();
    try {
      const fake = new FakeRedis();
      fake.hangReads = true; // neither resolve nor reject
      _setRedisForTests(fake);
      const pinsP = readBusyPinsFromRedis(["111111"]);
      const countsP = readPlCountsFromRedis(["343434"]);
      await vi.advanceTimersByTimeAsync(2_000);
      expect((await pinsP).size).toBe(0); // safe default: not on a call
      expect((await countsP).get("343434")).toBe(0); // safe default: empty line
    } finally {
      vi.useRealTimers();
    }
  });
});

/* ── registry snapshot (what the signaling node mirrors) ── */

describe("computeBusySnapshot", () => {
  const socket: RelaySocket = { send: () => {}, close: () => {} };
  const mkClient = (roomId: string | null): RelayClient => ({
    socket,
    name: "T",
    roomId,
    cid: "c" + Math.random().toString(36).slice(2, 6),
    graceT: null,
    ringing: new Set(),
  });

  it("mirrors pinsInCall semantics (accepted room OR >1 member; ghosts excluded)", () => {
    const reg = createRegistry();
    reg.clients.set("111111", mkClient("r-live"));
    reg.roomMeta.set("r-live", { accepted: true } as never);
    reg.rooms.set("r-live", new Set(["111111"]));
    reg.clients.set("222222", mkClient("r-dial")); // alone in an unanswered dial
    reg.rooms.set("r-dial", new Set(["222222"]));
    reg.clients.set("333333", mkClient(null)); // idle
    const snap = computeBusySnapshot(reg);
    expect(snap.busyPins).toEqual(["111111"]);
    expect(snap.hasClients).toBe(true);
  });

  it("counts only CONNECTED party-line members and omits zero-count lines", () => {
    const reg = createRegistry();
    reg.rooms.set("pl-343434", new Set(["111111", "222222", "999999"]));
    reg.clients.set("111111", mkClient("pl-343434"));
    reg.clients.set("222222", mkClient("pl-343434"));
    // 999999 is a ghost (membership without a client record)
    reg.rooms.set("pl-777777", new Set(["888888"])); // all ghosts → omitted
    const snap = computeBusySnapshot(reg);
    expect(snap.plCounts.get("343434")).toBe(2);
    expect(snap.plCounts.has("777777")).toBe(false);
  });

  it("an empty registry snapshots as no-clients/no-state", () => {
    const snap = computeBusySnapshot(createRegistry());
    expect(snap).toEqual({ busyPins: [], plCounts: new Map(), hasClients: false });
  });
});
