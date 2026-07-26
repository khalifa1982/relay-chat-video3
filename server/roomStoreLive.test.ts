/* ============================================================
   Round 11 — the room store against a REAL redis-server.

   The fence that stops a zombie leader from corrupting the room registry is a
   Lua CAS, and Lua runs inside Redis. A unit test can assert the script's TEXT;
   only this can assert its BEHAVIOUR. So the two scripts are executed here for
   real: a lower-epoch write must be refused while a higher-epoch one applies,
   and the same for deletes.

   SKIPPED automatically when redis-server isn't installed — the fake-client
   suite in roundEleven.test.ts covers everything else.
   ============================================================ */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import Redis from "ioredis";
import {
  WRITE_LUA,
  DELETE_LUA,
  ROOM_INDEX_KEY,
  ROOM_TTL_MS,
  LEADER_EPOCH_KEY,
  roomKey,
  encodeRoom,
  decodeRoom,
  initRoomStore,
  setLeaderEpoch,
  markRoomDirty,
  mintLeaderEpoch,
  hydrateRooms,
  _flushNowForTests,
  _resetRoomStoreForTests,
  type PersistedRoom,
} from "./roomStore";

const HAVE_REDIS_SERVER = (() => {
  try {
    return spawnSync("redis-server", ["--version"], { timeout: 3000 }).status === 0;
  } catch {
    return false;
  }
})();

const PORT = 16700 + Math.floor(Math.random() * 200);
const URL = `redis://127.0.0.1:${PORT}`;
let serverProc: ChildProcess | null = null;
let probe: Redis | null = null;
let savedRedisUrl: string | undefined;
let savedSecret: string | undefined;

async function waitForReady(): Promise<void> {
  for (let i = 0; i < 50; i++) {
    try {
      const r = new Redis(URL, { lazyConnect: true, maxRetriesPerRequest: 1, retryStrategy: () => null });
      await r.connect();
      await r.ping();
      probe = r;
      return;
    } catch {
      await new Promise((res) => setTimeout(res, 100));
    }
  }
  throw new Error("local redis-server never became ready");
}

function room(roomId: string, members: string[]): PersistedRoom {
  return {
    roomId,
    members: members.map((pin) => ({ pin, name: "P" + pin, held: false })),
    hostPin: members[0] ?? null,
    cohosts: [],
    startedAt: 1,
    answeredAt: 2,
    lastActiveAt: 3,
    dialedNumber: null,
    accepted: true,
    roster: members.map((pin) => [pin, "P" + pin] as [string, string]),
  };
}

/** Run WRITE_LUA exactly as roomStore does. Returns 1 applied / 0 fenced out. */
async function write(rec: PersistedRoom, epoch: number): Promise<number> {
  return (await probe!.eval(
    WRITE_LUA, 2, roomKey(rec.roomId), ROOM_INDEX_KEY,
    String(epoch), String(ROOM_TTL_MS), encodeRoom(rec), rec.roomId,
  )) as number;
}
async function del(roomId: string, epoch: number): Promise<number> {
  return (await probe!.eval(
    DELETE_LUA, 2, roomKey(roomId), ROOM_INDEX_KEY, String(epoch), roomId,
  )) as number;
}
async function readBack(roomId: string): Promise<PersistedRoom | null> {
  return decodeRoom(await probe!.hget(roomKey(roomId), "d"));
}

describe.skipIf(!HAVE_REDIS_SERVER)("room store against a real redis-server", () => {
  beforeAll(async () => {
    savedRedisUrl = process.env.REDIS_URL;
    savedSecret = process.env.REDIS_BUS_SECRET;
    serverProc = spawn(
      "redis-server",
      ["--port", String(PORT), "--save", "", "--appendonly", "no", "--bind", "127.0.0.1"],
      { stdio: "ignore" }
    );
    await waitForReady();
    process.env.REDIS_URL = URL;
    process.env.REDIS_BUS_SECRET = "live-fleet-secret";
  }, 15_000);

  afterAll(async () => {
    _resetRoomStoreForTests();
    try { probe?.disconnect(); } catch { /* noop */ }
    try { serverProc?.kill("SIGKILL"); } catch { /* noop */ }
    if (savedRedisUrl === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = savedRedisUrl;
    if (savedSecret === undefined) delete process.env.REDIS_BUS_SECRET;
    else process.env.REDIS_BUS_SECRET = savedSecret;
  });

  beforeEach(async () => {
    await probe!.flushall();
    _resetRoomStoreForTests();
  });

  it("writes a room, indexes it, and gives it a TTL", async () => {
    expect(await write(room("r1", ["111111", "222222"]), 1)).toBe(1);
    expect(await readBack("r1")).toEqual(room("r1", ["111111", "222222"]));
    expect(await probe!.smembers(ROOM_INDEX_KEY)).toEqual(["r1"]);
    const ttl = await probe!.pttl(roomKey("r1"));
    expect(ttl).toBeGreaterThan(ROOM_TTL_MS - 60_000);
    expect(ttl).toBeLessThanOrEqual(ROOM_TTL_MS);
  });

  it("FENCES OUT a stale leader: a lower epoch cannot overwrite a higher one", async () => {
    // The scenario: leader #2 wins the lease while leader #1 is paused (GC, a
    // network blip) and still believes it leads. #1 wakes up mid-flush.
    expect(await write(room("r2", ["111111"]), 9)).toBe(1);       // new leader
    expect(await write(room("r2", ["999999"]), 4)).toBe(0);       // zombie leader
    expect((await readBack("r2"))!.members.map((m) => m.pin)).toEqual(["111111"]);
  });

  it("a leader can always overwrite its OWN writes", async () => {
    expect(await write(room("r3", ["111111"]), 5)).toBe(1);
    expect(await write(room("r3", ["111111", "222222"]), 5)).toBe(1);
    expect((await readBack("r3"))!.members).toHaveLength(2);
  });

  it("a stale leader cannot DELETE the live leader's room either", async () => {
    // This is the sharper half: a zombie reaping a room would end a live call.
    expect(await write(room("r4", ["111111"]), 9)).toBe(1);
    expect(await del("r4", 4)).toBe(0);
    expect(await readBack("r4")).not.toBeNull();
    expect(await del("r4", 9)).toBe(1);
    expect(await probe!.exists(roomKey("r4"))).toBe(0);
    expect(await probe!.smembers(ROOM_INDEX_KEY)).toEqual([]);
  });

  it("mints strictly increasing leadership epochs", async () => {
    const a = await mintLeaderEpoch();
    const b = await mintLeaderEpoch();
    expect(a).toBeGreaterThan(0);
    expect(b).toBe(a + 1);
    expect(Number(await probe!.get(LEADER_EPOCH_KEY))).toBe(b);
  });

  it("end to end: mark dirty → flush → hydrate reads it back", async () => {
    const rooms = new Map<string, PersistedRoom>([["live-1", room("live-1", ["111111", "222222"])]]);
    initRoomStore({
      snapshotOf: (id) => rooms.get(id) ?? null,
      liveRoomIds: () => Array.from(rooms.keys()),
    });
    setLeaderEpoch(await mintLeaderEpoch());
    markRoomDirty("live-1");
    await _flushNowForTests();

    const back = await hydrateRooms();
    expect(back).toHaveLength(1);
    expect(back[0]).toEqual(rooms.get("live-1"));

    // …and reaping it (snapshot → null) removes it from both the key and index.
    rooms.delete("live-1");
    markRoomDirty("live-1");
    await _flushNowForTests();
    expect(await hydrateRooms()).toEqual([]);
    expect(await probe!.smembers(ROOM_INDEX_KEY)).toEqual([]);
  });

  it("hydration drops a record an outsider forged, and prunes its index entry", async () => {
    // Anything with network reach to Redis can SADD/HSET. A record it writes
    // must not become membership in a call.
    await write(room("real", ["111111"]), 1);
    await probe!.hset(roomKey("forged"), "e", "1", "d", JSON.stringify({
      d: JSON.stringify(room("forged", ["999999"])), m: "0".repeat(32),
    }));
    await probe!.sadd(ROOM_INDEX_KEY, "forged");

    const back = await hydrateRooms();
    expect(back.map((r) => r.roomId)).toEqual(["real"]);
    expect(await probe!.smembers(ROOM_INDEX_KEY)).toEqual(["real"]);
  });
});
