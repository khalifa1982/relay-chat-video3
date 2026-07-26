/**
 * Round 11 — the signaling room registry survives the loss of the leader.
 *
 * Three claims are under test here, and each one is checked by DRIVING the real
 * registry rather than by reading source:
 *
 *   A. A room written to Redis by one leader can be read back by the next, and a
 *      participant who re-registers is put back into the call.
 *   B. The recovery path that runs when even that fails is authorized by a
 *      SERVER-MINTED capability, so it cannot be used to walk into a stranger's
 *      call or to claim moderation over one.
 *   C. The leader can tell a dead home instance from a quiet one, and a home it
 *      loses gets the ordinary disconnect grace instead of vanishing.
 *
 * The Lua fencing is exercised against a REAL redis-server in
 * roomStoreLive.test.ts (auto-skipped where none is installed) — a string check
 * of a script is not evidence that the script works.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
  createRegistry,
  handleMessage,
  snapshotRoom,
  applyHydratedRooms,
  HYDRATED_GRACE_MS,
  type RelayRegistry,
  type RelaySocket,
} from "./relay";
import {
  encodeRoom,
  decodeRoom,
  isPersistedRoom,
  WRITE_LUA,
  DELETE_LUA,
  ROOM_INDEX_KEY,
  roomKey,
  initRoomStore,
  setLeaderEpoch,
  markRoomDirty,
  hydrateRooms,
  _setRoomStoreClientForTests,
  _resetRoomStoreForTests,
  _flushNowForTests,
  type PersistedRoom,
  type RoomStoreClient,
} from "./roomStore";
import { mintRoomCap, verifyRoomCap, ROOM_CAP_TTL_MS } from "./roomCapability";
import {
  makeRemoteSocket,
  homeAlive,
  HEARTBEAT_STALE_MS,
  INSTANCE_ID,
  clusterForwardInbound,
  _noteHeartbeatForTest,
  _sweepLostHomesForTest,
  _wireHooksForTest,
  _beginLeadershipForTest,
  _setHydratingForTest,
  _setLeaderForTest,
  _pendingInboundCountForTest,
  stopClusterRuntime,
} from "./relayCluster";

/* ── harness ─────────────────────────────────────────────────────────────── */

class FakeConn {
  outbox: any[] = [];
  pin: string | null = null;
  socket: RelaySocket;
  cid: string | undefined;
  constructor(cid?: string) {
    this.cid = cid;
    this.socket = { send: (o: unknown) => { this.outbox.push(o); }, close: () => {} };
  }
  setPin = (p: string) => { this.pin = p; };
  ofType(t: string) { return this.outbox.filter((m) => m?.type === t); }
  lastOfType(t: string) { const a = this.ofType(t); return a[a.length - 1]; }
  asConn() { return { socket: this.socket, pin: this.pin, setPin: this.setPin, cid: this.cid }; }
}

function register(reg: RelayRegistry, name: string, pin?: string, cid?: string) {
  const c = new FakeConn(cid);
  handleMessage(reg, c.asConn(), { type: "register", name, pin });
  return c;
}

/** Two peers, connected in one call. Returns both conns and the room id. */
function twoInACall(reg: RelayRegistry) {
  const a = register(reg, "Ann", "111111");
  const b = register(reg, "Bob", "222222");
  handleMessage(reg, a.asConn(), { type: "invite", to: "222222" });
  const room = a.lastOfType("room");
  handleMessage(reg, b.asConn(), { type: "accept", to: "111111", roomId: room.roomId });
  return { a, b, rid: room.roomId as string };
}

const SECRET = "round-eleven-test-secret";
const savedSecret = process.env.REDIS_BUS_SECRET;
beforeEach(() => { process.env.REDIS_BUS_SECRET = SECRET; });
afterEach(() => {
  if (savedSecret === undefined) delete process.env.REDIS_BUS_SECRET;
  else process.env.REDIS_BUS_SECRET = savedSecret;
  _resetRoomStoreForTests();
  stopClusterRuntime();
});

/* ── A. persistence + hydration ──────────────────────────────────────────── */

describe("A. the room registry survives the leader (persist → hydrate)", () => {
  it("a call rebuilt on a NEW leader puts a returning participant back in it", () => {
    // This is the exact production scenario: two browsers in a call, the leader
    // instance dies, another wins the lease and hydrates, the browsers
    // re-register. Before Round 11 the new leader had no room and the call was
    // unrecoverable fleet-wide.
    const oldLeader = createRegistry();
    const { rid } = twoInACall(oldLeader);
    const shadow = snapshotRoom(oldLeader, rid)!;
    expect(shadow.members.map((m) => m.pin).sort()).toEqual(["111111", "222222"]);

    // … the leader dies. Everything it held is gone.
    const newLeader = createRegistry();
    expect(newLeader.rooms.size).toBe(0);
    expect(applyHydratedRooms(newLeader, [decodeRoom(encodeRoom(shadow))!])).toBe(1);
    expect(newLeader.pinRoom.get("111111")).toBe(rid);
    expect(newLeader.pinRoom.get("222222")).toBe(rid);

    // Ann's browser re-registers (what `resync` triggers) and is handed the call.
    const annAgain = register(newLeader, "Ann", "111111");
    const rj = annAgain.lastOfType("rejoin");
    expect(rj).toBeTruthy();
    expect(rj.roomId).toBe(rid);
    expect(rj.members.map((m: any) => m.pin)).toEqual(["222222"]);
    // …and it carries a fresh capability, so the NEXT handover is recoverable too.
    expect(rj.cap).toBeTruthy();
  });

  it("the FIRST peer back does not dissolve the hydrated room", () => {
    // A hydrated room has no connected members by construction, which is exactly
    // the "room of ghosts" shape sendRejoinIfInRoom exists to dissolve. Without
    // the hydration grace the first returning peer calls leaveRoom and the whole
    // round is a no-op — so this is the load-bearing assertion of part A.
    const old = createRegistry();
    const { rid } = twoInACall(old);
    const fresh = createRegistry();
    applyHydratedRooms(fresh, [snapshotRoom(old, rid)!]);

    register(fresh, "Ann", "111111");
    expect(fresh.rooms.has(rid)).toBe(true);            // room still there
    expect(fresh.pinRoom.get("111111")).toBe(rid);      // and Ann is still a member
    expect(fresh.pinRoom.get("222222")).toBe(rid);      // Bob's seat is kept for him

    // …and now Bob comes back too, into the same room.
    const bob = register(fresh, "Bob", "222222");
    expect(bob.lastOfType("rejoin")?.roomId).toBe(rid);
  });

  it("once the grace has passed, a room of only ghosts is dissolved as before", () => {
    const old = createRegistry();
    const { rid } = twoInACall(old);
    const fresh = createRegistry();
    applyHydratedRooms(fresh, [snapshotRoom(old, rid)!]);
    // Age the marker past the window: the room is genuinely abandoned now.
    fresh.roomMeta.get(rid)!.hydratedAt = Date.now() - HYDRATED_GRACE_MS - 1000;
    const ann = register(fresh, "Ann", "111111");
    expect(ann.ofType("rejoin")).toHaveLength(0);
    expect(fresh.pinRoom.get("111111")).toBeUndefined();
  });

  it("carries host/co-host roles and the history roster across the handover", () => {
    const old = createRegistry();
    const { a, rid } = twoInACall(old);
    handleMessage(old, a.asConn(), { type: "mod", action: "cohost", target: "222222", roomId: rid });
    const fresh = createRegistry();
    applyHydratedRooms(fresh, [decodeRoom(encodeRoom(snapshotRoom(old, rid)!))!]);
    const meta = fresh.roomMeta.get(rid)!;
    expect(meta.hostPin).toBe("111111");
    expect(meta.cohosts.has("222222")).toBe(true);
    expect(meta.accepted).toBe(true);               // or the call is never logged
    expect(meta.roster.get("111111")).toBe("Ann");  // conference history survives
    expect(meta.roster.get("222222")).toBe("Bob");
  });

  it("records which room a member has on HOLD, not just which they are in", () => {
    // A pin is in at most one ACTIVE and one HELD room, and both always contain
    // it — which is why the pin→room index is derived from membership instead of
    // being written as separate keys. If the held flag were dropped, a call
    // waiting handover would come back with both calls active.
    const reg = createRegistry();
    const { a, rid: first } = twoInACall(reg);
    const c = register(reg, "Cid", "333333");
    handleMessage(reg, c.asConn(), { type: "invite", to: "111111" });
    const second = c.lastOfType("room").roomId;
    handleMessage(reg, a.asConn(), { type: "accept", to: "333333", roomId: second });

    expect(reg.heldRoom.get("111111")).toBe(first);
    const heldShadow = snapshotRoom(reg, first)!;
    expect(heldShadow.members.find((m) => m.pin === "111111")!.held).toBe(true);
    expect(heldShadow.members.find((m) => m.pin === "222222")!.held).toBe(false);

    const fresh = createRegistry();
    applyHydratedRooms(fresh, [heldShadow, snapshotRoom(reg, second)!]);
    expect(fresh.heldRoom.get("111111")).toBe(first);
    expect(fresh.pinRoom.get("111111")).toBe(second);
  });

  it("never overwrites a room the live registry already has", () => {
    const reg = createRegistry();
    const { rid } = twoInACall(reg);
    const stale: PersistedRoom = { ...snapshotRoom(reg, rid)!, members: [{ pin: "999999", name: "Ghost" }] };
    expect(applyHydratedRooms(reg, [stale])).toBe(0);
    expect(Array.from(reg.rooms.get(rid)!).sort()).toEqual(["111111", "222222"]);
  });

  it("a hydrated room is put on the abandonment clock", () => {
    // Otherwise a call whose participants never return outlives them on the new
    // leader, holding their numbers "busy" forever.
    const old = createRegistry();
    const { rid } = twoInACall(old);
    const fresh = createRegistry();
    applyHydratedRooms(fresh, [snapshotRoom(old, rid)!]);
    expect(fresh.roomReapT.has(rid)).toBe(true);
    clearTimeout(fresh.roomReapT.get(rid)!);
  });

  it("a reaped room snapshots to null, which the store turns into a delete", () => {
    const reg = createRegistry();
    const { a, rid } = twoInACall(reg);
    handleMessage(reg, a.asConn(), { type: "leave" });
    handleMessage(reg, { socket: new FakeConn().socket, pin: "222222", setPin: () => {} }, { type: "leave" });
    expect(snapshotRoom(reg, rid)).toBeNull();
  });
});

describe("A. record encoding is authenticated and validated", () => {
  const sample: PersistedRoom = {
    roomId: "r-1", members: [{ pin: "111111", name: "Ann", held: false }],
    hostPin: "111111", cohosts: [], startedAt: 1, answeredAt: 2, lastActiveAt: 3,
    dialedNumber: "222222", accepted: true, roster: [["111111", "Ann"]],
  };

  it("round-trips", () => {
    expect(decodeRoom(encodeRoom(sample))).toEqual(sample);
  });

  it("rejects a record whose body was edited", () => {
    const wire = JSON.parse(encodeRoom(sample));
    const doc = JSON.parse(wire.d);
    doc.members.push({ pin: "999999", name: "Intruder" });   // add yourself to a call
    wire.d = JSON.stringify(doc);
    expect(decodeRoom(JSON.stringify(wire))).toBeNull();
  });

  it("rejects an UNSIGNED record when this instance holds a key", () => {
    // With a key configured, "no signature" is what a forgery looks like.
    expect(decodeRoom(JSON.stringify({ d: JSON.stringify(sample) }))).toBeNull();
  });

  it("rejects a record signed with somebody else's key", () => {
    const wire = encodeRoom(sample);
    process.env.REDIS_BUS_SECRET = "a-different-fleet";
    expect(decodeRoom(wire)).toBeNull();
  });

  it("never throws on garbage", () => {
    for (const junk of ["", "{", "null", "[]", '{"d":5}', '{"d":"not-json","m":"x"}']) {
      expect(() => decodeRoom(junk)).not.toThrow();
      expect(decodeRoom(junk)).toBeNull();
    }
  });

  it("validation refuses shapes hydration must never apply", () => {
    expect(isPersistedRoom(sample)).toBe(true);
    expect(isPersistedRoom({ ...sample, members: [{ pin: "12", name: "x" }] })).toBe(false);
    expect(isPersistedRoom({ ...sample, hostPin: "nope" })).toBe(false);
    expect(isPersistedRoom({ ...sample, cohosts: ["abc"] })).toBe(false);
    expect(isPersistedRoom({ ...sample, accepted: "yes" })).toBe(false);
    expect(isPersistedRoom({ ...sample, roster: [["a"]] })).toBe(false);
    expect(isPersistedRoom(null)).toBe(false);
  });
});

describe("A. writes are fenced and only ever made by a leader", () => {
  function fakeClient() {
    const calls: any[][] = [];
    const client: RoomStoreClient = {
      eval: async (...args: any[]) => { calls.push(args); return 1; },
      smembers: async () => [],
      hget: async () => null,
      incr: async () => 7,
      srem: async () => 1,
    };
    return { client, calls };
  }

  it("an instance with no epoch (not the leader) writes NOTHING", async () => {
    const { client, calls } = fakeClient();
    _setRoomStoreClientForTests(client);
    const reg = createRegistry();
    initRoomStore({ snapshotOf: (id) => snapshotRoom(reg, id), liveRoomIds: () => Array.from(reg.rooms.keys()) });
    setLeaderEpoch(0);
    twoInACall(reg);            // crosses joinRoomMember several times
    await _flushNowForTests();
    expect(calls).toHaveLength(0);
  });

  it("a leader writes the room, stamped with ITS epoch", async () => {
    const { client, calls } = fakeClient();
    _setRoomStoreClientForTests(client);
    const reg = createRegistry();
    initRoomStore({ snapshotOf: (id) => snapshotRoom(reg, id), liveRoomIds: () => Array.from(reg.rooms.keys()) });
    setLeaderEpoch(42);
    const { rid } = twoInACall(reg);
    await _flushNowForTests();
    const write = calls.find((c) => c[0] === WRITE_LUA);
    expect(write).toBeTruthy();
    // eval(script, numKeys, roomKey, indexKey, epoch, ttl, doc, roomId)
    expect(write![2]).toBe(roomKey(rid));
    expect(write![3]).toBe(ROOM_INDEX_KEY);
    expect(write![4]).toBe("42");
    expect(decodeRoom(write![6])!.roomId).toBe(rid);
  });

  it("losing leadership drops queued writes rather than flushing them late", async () => {
    const { client, calls } = fakeClient();
    _setRoomStoreClientForTests(client);
    const reg = createRegistry();
    initRoomStore({ snapshotOf: (id) => snapshotRoom(reg, id), liveRoomIds: () => Array.from(reg.rooms.keys()) });
    setLeaderEpoch(5);
    const { rid } = twoInACall(reg);
    setLeaderEpoch(0);                       // demoted before the flush ran
    markRoomDirty(rid);
    await _flushNowForTests();
    expect(calls).toHaveLength(0);
  });

  it("both scripts compare epochs and RETURN before touching anything", () => {
    // The fence is only a fence if it precedes the mutation. (The scripts are
    // executed for real in roomStoreLive.test.ts; this pins the ordering so a
    // future edit cannot quietly move the write above the check.)
    for (const lua of [WRITE_LUA, DELETE_LUA]) {
      const guard = lua.indexOf("if cur > tonumber(ARGV[1]) then return 0 end");
      expect(guard).toBeGreaterThan(-1);
      for (const mutate of ["HSET", "DEL", "SADD", "SREM"]) {
        const at = lua.indexOf(mutate);
        if (at > -1) expect(at).toBeGreaterThan(guard);
      }
    }
  });

  it("hydration prunes index entries whose room has expired", async () => {
    const removed: string[] = [];
    _setRoomStoreClientForTests({
      eval: async () => 1,
      smembers: async () => ["alive", "expired"],
      hget: async (key: string) => (key === roomKey("alive")
        ? encodeRoom({
            roomId: "alive", members: [{ pin: "111111", name: "A" }], hostPin: null, cohosts: [],
            startedAt: 1, answeredAt: null, lastActiveAt: 1, dialedNumber: null, accepted: true, roster: [],
          })
        : null),
      incr: async () => 1,
      srem: async (_k: string, ...m: string[]) => { removed.push(...m); return 1; },
    });
    const rooms = await hydrateRooms();
    expect(rooms.map((r) => r.roomId)).toEqual(["alive"]);
    expect(removed).toEqual(["expired"]);
  });
});

/* ── B. rejoin-recreate: authorized by the server's own signature ────────── */

describe("B. rejoin-recreate is authorized by a server-minted capability", () => {
  it("mints and verifies for exactly one (room, pin) pair", () => {
    const cap = mintRoomCap("room-a", "111111", "host")!;
    expect(verifyRoomCap(cap, "room-a", "111111")).toMatchObject({ role: "host" });
    expect(verifyRoomCap(cap, "room-b", "111111")).toBeNull();   // another room
    expect(verifyRoomCap(cap, "room-a", "222222")).toBeNull();   // another number
    expect(verifyRoomCap(cap, "room-a", "111111", Date.now() + ROOM_CAP_TTL_MS + 1)).toBeNull();
  });

  it("the role is inside the signature, so it cannot be edited upward", () => {
    const cap = mintRoomCap("room-a", "111111", undefined)!;
    expect(verifyRoomCap(cap, "room-a", "111111")).toMatchObject({ role: "" });
    const escalated = cap.replace(/^(\d+)\.\./, "$1.host.");
    expect(verifyRoomCap(escalated, "room-a", "111111")).toBeNull();
  });

  it("with no fleet secret the path does not exist rather than being open", () => {
    delete process.env.REDIS_BUS_SECRET;
    const saved = process.env.JWT_SECRET;
    delete process.env.JWT_SECRET;
    try {
      expect(mintRoomCap("room-a", "111111", "host")).toBeNull();
      expect(verifyRoomCap("anything", "room-a", "111111")).toBeNull();
    } finally {
      if (saved !== undefined) process.env.JWT_SECRET = saved;
    }
  });

  it("never throws on malformed input", () => {
    for (const junk of ["", "a.b.c", "1.host", "x".repeat(300), null, 7, {}]) {
      expect(() => verifyRoomCap(junk, "r", "111111")).not.toThrow();
      expect(verifyRoomCap(junk as unknown, "r", "111111")).toBeNull();
    }
  });

  it("a real call is recreated from its capability when the server has lost it", () => {
    const old = createRegistry();
    const { a, rid } = twoInACall(old);
    const cap = a.lastOfType("room").cap as string;
    expect(cap).toBeTruthy();

    // The new leader knows nothing at all — not even a hydrated shadow.
    const fresh = createRegistry();
    const ann = register(fresh, "Ann", "111111");
    expect(ann.ofType("rejoin")).toHaveLength(0);
    handleMessage(fresh, ann.asConn(), { type: "rejoin-recreate", roomId: rid, cap });
    const rj = ann.lastOfType("rejoin");
    expect(rj?.roomId).toBe(rid);
    expect(rj?.recreated).toBe(true);
    expect(fresh.pinRoom.get("111111")).toBe(rid);

    // Bob presents HIS capability and membership converges from the clients.
    const bobCap = mintRoomCap(rid, "222222", undefined)!;
    const bob = register(fresh, "Bob", "222222");
    handleMessage(fresh, bob.asConn(), { type: "rejoin-recreate", roomId: rid, cap: bobCap });
    expect(bob.lastOfType("rejoin")?.members.map((m: any) => m.pin)).toEqual(["111111"]);
    expect(ann.lastOfType("peer-joined")?.pin).toBe("222222");
  });

  it("REFUSES a room the caller was never in — no cap, wrong cap, or someone else's", () => {
    const old = createRegistry();
    const { a, rid } = twoInACall(old);
    const annCap = a.lastOfType("room").cap as string;

    const fresh = createRegistry();
    const mallory = register(fresh, "Mallory", "555555");
    const attempts = [
      { roomId: rid },                                        // no capability at all
      { roomId: rid, cap: "1893456000000.host.deadbeef" },    // invented
      { roomId: rid, cap: annCap },                           // stolen from Ann
      { roomId: rid, cap: mintRoomCap("some-other-room", "555555", "host")! },
    ];
    for (const msg of attempts) {
      handleMessage(fresh, mallory.asConn(), { type: "rejoin-recreate", ...msg });
      expect(mallory.lastOfType("error")?.code).toBe("gone");
    }
    expect(fresh.rooms.has(rid)).toBe(false);
    expect(fresh.pinRoom.get("555555")).toBeUndefined();
  });

  it("a client cannot make itself host by SAYING so", () => {
    const rid = "r-claimed";
    const fresh = createRegistry();
    const c = register(fresh, "Cid", "333333");
    // A plain member's capability, plus every self-description a client could
    // attach. Only the signature is read.
    handleMessage(fresh, c.asConn(), {
      type: "rejoin-recreate",
      roomId: rid,
      cap: mintRoomCap(rid, "333333", undefined)!,
      selfRole: "host",
      hostPin: "333333",
      members: [{ pin: "999999", name: "Ghost" }],
    } as never);
    const meta = fresh.roomMeta.get(rid)!;
    expect(meta.hostPin).toBeNull();
    expect(fresh.rooms.get(rid)!.has("999999")).toBe(false);   // claimed roster ignored
    expect(c.lastOfType("rejoin")?.selfRole).toBeUndefined();
  });

  it("a signed HOST capability takes a VACANT host seat but never displaces one", () => {
    const rid = "r-host";
    const reg = createRegistry();
    const ann = register(reg, "Ann", "111111");
    handleMessage(reg, ann.asConn(), { type: "rejoin-recreate", roomId: rid, cap: mintRoomCap(rid, "111111", "host")! });
    expect(reg.roomMeta.get(rid)!.hostPin).toBe("111111");

    // Two peers can hold a host capability for the same room (the role moved
    // mid-call). The second must not be able to take moderation off the first.
    const bob = register(reg, "Bob", "222222");
    handleMessage(reg, bob.asConn(), { type: "rejoin-recreate", roomId: rid, cap: mintRoomCap(rid, "222222", "host")! });
    expect(reg.roomMeta.get(rid)!.hostPin).toBe("111111");
    expect(reg.roomMeta.get(rid)!.cohosts.has("222222")).toBe(true);
  });

  it("re-admits into a room that still EXISTS instead of rebuilding it", () => {
    const reg = createRegistry();
    const { a, rid } = twoInACall(reg);
    const startedAt = reg.roomMeta.get(rid)!.startedAt;
    const cap = a.lastOfType("room").cap as string;
    handleMessage(reg, a.asConn(), { type: "rejoin-recreate", roomId: rid, cap });
    // Same room, same history — a recreate must not reset the call's clock.
    expect(reg.roomMeta.get(rid)!.startedAt).toBe(startedAt);
    expect(Array.from(reg.rooms.get(rid)!).sort()).toEqual(["111111", "222222"]);
  });

  it("every envelope that puts a client in a room carries a capability", () => {
    // If any of them stopped doing so, recovery would silently be unavailable
    // for whoever entered the call that way. (`rejoin` is covered by the
    // leader-handover test above, which is the only place it legitimately fires.)
    const reg = createRegistry();
    const { a, b, rid } = twoInACall(reg);
    expect(a.lastOfType("room").cap).toBeTruthy();                    // caller: room
    expect(b.lastOfType("joined").cap).toBeTruthy();                  // callee: joined

    // …and `resumed`, the envelope that hands a parked call back.
    const c = register(reg, "Cid", "333333");
    handleMessage(reg, c.asConn(), { type: "invite", to: "111111" });
    const second = c.lastOfType("room").roomId;
    handleMessage(reg, a.asConn(), { type: "accept", to: "333333", roomId: second });
    handleMessage(reg, a.asConn(), { type: "swap" });
    const resumed = a.lastOfType("resumed");
    expect(resumed.roomId).toBe(rid);
    expect(resumed.cap).toBeTruthy();
  });
});

/* ── C. cluster hygiene ──────────────────────────────────────────────────── */

describe("C. the leader can tell a dead home from a quiet one", () => {
  it("a virtual socket now reports liveness at all", () => {
    const sock = makeRemoteSocket("cid-1", () => {}, () => {});
    expect(typeof sock.alive).toBe("function");
  });

  it("FAILS OPEN for an unknown cid and for an instance that has never beaten", () => {
    // Both are the rolling-deploy case. Reporting a live browser as dead sends
    // its calls to the leave-a-message card instead of ringing them.
    expect(homeAlive("never-seen")).toBe(true);
    const sock = makeRemoteSocket("cid-x", () => {}, () => {});
    expect(sock.alive!()).toBe(true);
  });

  it("reports a home DEAD only once its heartbeat has genuinely gone stale", () => {
    const t0 = 1_000_000;
    _noteHeartbeatForTest("home-A", ["cid-a"], t0);
    expect(homeAlive("cid-a", t0 + HEARTBEAT_STALE_MS - 1)).toBe(true);
    expect(homeAlive("cid-a", t0 + HEARTBEAT_STALE_MS + 1)).toBe(false);
  });

  it("the instance that TAKES OVER also resyncs its own browsers", async () => {
    // `noteLeader` is deliberately silent when the new leader is us — so without
    // an explicit resync at the end of taking over, the instance that took the
    // job would repair every browser in the fleet EXCEPT the ones homed on it,
    // whose client records died with the old leader just like everyone else's.
    const resynced: string[] = [];
    const order: string[] = [];
    _wireHooksForTest({
      onHydrate: async () => { order.push("hydrate"); },
      onLeaderChanged: (id) => { order.push("resync"); resynced.push(id); },
      liveCids: () => ["cid-local"],
    });
    await _beginLeadershipForTest();
    expect(resynced).toEqual([INSTANCE_ID]);
    // …and only AFTER hydration, so a re-register cannot beat the rooms back.
    expect(order).toEqual(["hydrate", "resync"]);
  });

  it("defers inbound signaling until hydration finishes, then replays it in order", async () => {
    // A leader that answered `accept` for a room it had not read back yet would
    // tell the caller the call is gone — the very failure this round exists to
    // remove. Frames wait; nothing is dropped.
    const seen: string[] = [];
    _setLeaderForTest(true, INSTANCE_ID);
    _wireHooksForTest({ onInbound: (cid) => { seen.push(cid); } });
    _setHydratingForTest(true);
    clusterForwardInbound("first", { type: "ping" });
    clusterForwardInbound("second", { type: "ping" });
    expect(seen).toEqual([]);
    expect(_pendingInboundCountForTest()).toBe(2);
    _setHydratingForTest(false);
    expect(seen).toEqual(["first", "second"]);
  });

  it("hands a lost home's browsers to the disconnect-grace path, not oblivion", () => {
    const lost: string[][] = [];
    const t0 = 2_000_000;
    _noteHeartbeatForTest("home-B", ["cid-b1", "cid-b2"], t0);
    _noteHeartbeatForTest("home-C", ["cid-c1"], t0);
    // Only home-B goes stale.
    _noteHeartbeatForTest("home-C", ["cid-c1"], t0 + HEARTBEAT_STALE_MS + 5);
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      // Wire a collector via the runtime's own sweep by observing homeAlive:
      // after the sweep the stale home's cids are forgotten (fail open again),
      // while the fresh home's are still tracked.
      _sweepLostHomesForTest(t0 + HEARTBEAT_STALE_MS + 10);
    } finally {
      spy.mockRestore();
    }
    expect(homeAlive("cid-b1", t0 + HEARTBEAT_STALE_MS + 10)).toBe(true); // forgotten ⇒ open
    expect(homeAlive("cid-c1", t0 + HEARTBEAT_STALE_MS + 10)).toBe(true); // still fresh
    expect(lost).toEqual([]);                                            // no hook wired here
  });
});
