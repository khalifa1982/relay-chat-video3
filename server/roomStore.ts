/* ──────────────────────────────────────────────────────────────────────────
 * Round 11 — the signaling room registry survives the loss of the leader.
 *
 * THE GAP THIS CLOSES. In clustered mode (RELAY_CLUSTER=1 + REDIS_URL) one
 * elected instance owns the whole call registry in memory: rooms, members,
 * roles, the pin→room index. Every other instance proxies signaling to it. That
 * is what makes the transactional call-state transitions correct (see the
 * "DELIBERATELY OUT OF SCOPE" note in redisBus.ts) — but it means the LEADER's
 * memory is the only copy. If the leader's process dies, every active call's
 * room is gone fleet-wide: the browsers reconnect, a new leader is elected with
 * an EMPTY registry, and nothing can be renegotiated. Pure-P2P media keeps
 * flowing until the first hiccup, then the call is unrepairable because there is
 * no room to relay an ICE restart through.
 *
 * This module gives the registry a durable shadow copy in Redis, written
 * fire-and-forget by the leader and read back by whoever wins the lease next.
 *
 * ── design decisions, and why ───────────────────────────────────────────────
 *
 * ONE HASH PER ROOM, not a key per fact. Each room is `relay:room:<id>` with
 * exactly two fields: `e` (the writing leader's fence epoch) and `d` (the whole
 * record as JSON). A single HSET is atomic, so a reader can never observe a
 * half-written room. Spreading members / roles / pinroom across several keys
 * would reintroduce exactly the cross-key inconsistency window the in-memory
 * registry exists to avoid.
 *
 * THE PIN→ROOM INDEX IS DERIVED, not stored separately. A pin is in at most two
 * rooms — its ACTIVE one (`reg.pinRoom`) and its HELD one (`reg.heldRoom`) — and
 * BOTH are always rooms whose member Set contains that pin (every mutation site
 * in relay.ts maintains that invariant). So recording `held: true|false` on each
 * member is sufficient to rebuild both maps, and it rides the same atomic write
 * as the membership it describes. A separate `relay:pinroom:<pin>` key would be
 * a second write that can land out of order with the first.
 *
 * FENCING. A lease can expire while its holder is still alive and still thinks
 * it leads — a GC pause, a network blip, a slow Redis round trip. Two leaders
 * both write-through and the room record ends up an interleaving of two
 * registries. So every write carries a monotonic epoch (INCR on winning the
 * lease) and is applied by a Lua CAS that refuses a write whose epoch is LOWER
 * than the one already stored. The old leader's writes are rejected; the new
 * leader's win. `>` and not `>=`, so a leader can always overwrite ITSELF.
 *
 * SIGNED. Room records cross the same trust boundary as bus envelopes — anything
 * with network reach to Redis can write them — and hydration feeds them straight
 * into the call registry. They are HMAC'd with the same fleet secret the bus
 * uses (`busSecret`, imported rather than re-derived). No secret ⇒ records are
 * written unsigned and accepted unsigned, which is the dev/test case; production
 * always has JWT_SECRET because the session signer refuses to boot without it.
 *
 * DORMANT UNLESS LED. Every write is gated on a non-zero epoch, and only
 * `relayCluster` ever sets one. A single-process deploy (`.org`, any box without
 * RELAY_CLUSTER) therefore does nothing here at all — no connection, no writes.
 * ────────────────────────────────────────────────────────────────────────── */
import Redis from "ioredis";
import { busSecret } from "./redisBus";
import crypto from "crypto";

export const ROOM_KEY_PREFIX = "relay:room:";
/** SET of live room ids, so hydration is one SMEMBERS instead of a SCAN over a
 *  shared ElastiCache keyspace. */
export const ROOM_INDEX_KEY = "relay:rooms";
/** Monotonic counter; INCR'd once per leadership win to mint a fence epoch. */
export const LEADER_EPOCH_KEY = "relay:leader:epoch";
/** Records outlive any plausible call, and are refreshed on every write and by
 *  the periodic sweep — so the TTL only ever collects rooms whose leader died
 *  without reaping them. */
export const ROOM_TTL_MS = 6 * 60 * 60_000;
/** Full re-sync cadence: rewrites every live room, so a mutation site nobody
 *  remembered to mark still converges, and TTLs stay refreshed on a quiet call. */
export const ROOM_SWEEP_MS = 15_000;

export function roomKey(roomId: string): string {
  return ROOM_KEY_PREFIX + roomId;
}

/* ── record shape (pure) ─────────────────────────────────────────────────── */

export interface PersistedMember {
  pin: string;
  /** Latest display name, so a hydrated roster is not all "Guest". */
  name: string;
  /** True when THIS room is the member's HELD room rather than their active one.
   *  Absent/false ⇒ active. See the derived-index note above. */
  held?: boolean;
  /**
   * #109 — unix ms this member joined, so a leader change does not reset every
   * join time to "just now" on the invite screen.
   *
   * OPTIONAL for the same reason `groupAdminPins` is: a record written by a
   * not-yet-updated instance mid-rollout simply has no field, and the member
   * comes back with no stamp — which the reader reports as "unknown", not as a
   * fabricated time.
   */
  joinedAt?: number;
}

export interface PersistedRoom {
  roomId: string;
  members: PersistedMember[];
  hostPin: string | null;
  cohosts: string[];
  startedAt: number;
  answeredAt: number | null;
  lastActiveAt: number;
  dialedNumber: string | null;
  accepted: boolean;
  /** Everyone who was EVER in the room (pin → latest name) — the conference
   *  history roster, which must survive a leader change or the call is logged
   *  with only whoever happened to still be present. */
  roster: Array<[string, string]>;
  /**
   * #113 — the admins of the GROUP this call was started for, so a leader change
   * does not silently strip moderation from an admin who joins afterwards.
   *
   * OPTIONAL, deliberately: a record written by a not-yet-updated instance
   * mid-rollout simply has no field, and the room comes back without seeding —
   * which is exactly today's behaviour, not a broken room. Round 11's wire format
   * stays additive for the same reason the bus envelope does (v2.99.49): a shape
   * change would make every older instance drop every record during a deploy.
   */
  groupAdminPins?: string[];
  /**
   * #116 — how the call was DIALLED, so an answered group call can report Voice or
   * Video in History even if a leader change happened mid-call.
   *
   * OPTIONAL for the same reason `groupAdminPins` is: a record written by a
   * not-yet-updated instance mid-rollout simply has no field, and the room comes
   * back with the channel UNKNOWN — which History renders as nothing, not as a
   * fabricated media type.
   */
  video?: boolean;
}

const isStr = (v: unknown): v is string => typeof v === "string";
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * Validate a decoded record field by field. Hydration feeds this straight into
 * the live registry, so a malformed or hostile record must be DROPPED, never
 * partially applied — a room with a garbage member list would hand out
 * membership in a call to whatever the garbage named.
 */
export function isPersistedRoom(v: unknown): v is PersistedRoom {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  if (!isStr(o.roomId) || o.roomId.length === 0 || o.roomId.length > 128) return false;
  if (!Array.isArray(o.members) || o.members.length > 64) return false;
  for (const m of o.members) {
    if (!m || typeof m !== "object") return false;
    const mm = m as Record<string, unknown>;
    if (!isStr(mm.pin) || !/^\d{6}$/.test(mm.pin)) return false;
    if (!isStr(mm.name)) return false;
    if (mm.held !== undefined && typeof mm.held !== "boolean") return false;
    // #109 — absent is fine (a pre-feature record). Present must be a real
    // number, or hydration would put a NaN into a map the invite screen formats.
    if (mm.joinedAt !== undefined && !isNum(mm.joinedAt)) return false;
  }
  if (o.hostPin !== null && !(isStr(o.hostPin) && /^\d{6}$/.test(o.hostPin))) return false;
  if (!Array.isArray(o.cohosts) || o.cohosts.some((c) => !isStr(c) || !/^\d{6}$/.test(c))) return false;
  // Absent is fine (a pre-#113 record). Present must be a clean pin list —
  // hydration feeds this into the live registry, where it GRANTS moderation, so a
  // malformed entry drops the whole record rather than being partially applied.
  if (o.groupAdminPins !== undefined) {
    if (!Array.isArray(o.groupAdminPins)) return false;
    if (o.groupAdminPins.some((c) => !isStr(c) || !/^\d{6}$/.test(c))) return false;
    if (o.groupAdminPins.length > 32) return false;
  }
  if (!isNum(o.startedAt) || !isNum(o.lastActiveAt)) return false;
  if (o.answeredAt !== null && !isNum(o.answeredAt)) return false;
  if (o.dialedNumber !== null && !isStr(o.dialedNumber)) return false;
  if (typeof o.accepted !== "boolean") return false;
  // #116 — absent is fine (a party line, or a pre-feature record). Present must be
  // a real boolean, since hydration feeds this into the live registry.
  if (o.video !== undefined && typeof o.video !== "boolean") return false;
  if (!Array.isArray(o.roster) || o.roster.length > 128) return false;
  for (const r of o.roster) {
    if (!Array.isArray(r) || r.length !== 2 || !isStr(r[0]) || !isStr(r[1])) return false;
  }
  return true;
}

function recordMac(doc: string, key: string): string {
  return crypto.createHmac("sha256", key).update(doc).digest("hex").slice(0, 32);
}

/** Serialize + sign. Unsigned (`{d}` only) when no fleet secret is configured,
 *  which keeps dev/test byte-simple and is never the production case. */
export function encodeRoom(r: PersistedRoom): string {
  const doc = JSON.stringify(r);
  const key = busSecret();
  return key ? JSON.stringify({ d: doc, m: recordMac(doc, key) }) : JSON.stringify({ d: doc });
}

/** Parse + verify + validate. Returns null for anything that isn't a record
 *  this fleet wrote — never throws. */
export function decodeRoom(raw: string | null | undefined): PersistedRoom | null {
  if (!raw) return null;
  try {
    const outer = JSON.parse(raw) as { d?: unknown; m?: unknown };
    if (!outer || !isStr(outer.d)) return null;
    const key = busSecret();
    if (key) {
      // A record with no signature is accepted only when this instance has no
      // key to check it with (dev). With a key, an unsigned record is exactly
      // what a forgery looks like.
      if (!isStr(outer.m)) return null;
      const expected = recordMac(outer.d, key);
      if (
        expected.length !== outer.m.length ||
        !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(outer.m))
      ) {
        return null;
      }
    }
    const parsed: unknown = JSON.parse(outer.d);
    return isPersistedRoom(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/* ── Lua (fenced write / fenced delete) ──────────────────────────────────── */

/** KEYS: room, index. ARGV: epoch, ttlMs, doc, roomId. Returns 1 applied, 0
 *  fenced out. A MISSING epoch reads as -1 so a first write always applies. */
export const WRITE_LUA =
  "local cur = tonumber(redis.call('HGET', KEYS[1], 'e') or '-1') " +
  "if cur > tonumber(ARGV[1]) then return 0 end " +
  "redis.call('HSET', KEYS[1], 'e', ARGV[1], 'd', ARGV[3]) " +
  "redis.call('PEXPIRE', KEYS[1], ARGV[2]) " +
  "redis.call('SADD', KEYS[2], ARGV[4]) " +
  "redis.call('PEXPIRE', KEYS[2], ARGV[2]) " +
  "return 1";

/** KEYS: room, index. ARGV: epoch, roomId. */
export const DELETE_LUA =
  "local cur = tonumber(redis.call('HGET', KEYS[1], 'e') or '-1') " +
  "if cur > tonumber(ARGV[1]) then return 0 end " +
  "redis.call('DEL', KEYS[1]) " +
  "redis.call('SREM', KEYS[2], ARGV[2]) " +
  "return 1";

/* ── runtime ─────────────────────────────────────────────────────────────── */

/** The command surface this module needs — narrow, so a test can supply a fake
 *  and so the blast radius of the ioredis dependency stays visible. */
export interface RoomStoreClient {
  eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown>;
  smembers(key: string): Promise<string[]>;
  hget(key: string, field: string): Promise<string | null>;
  incr(key: string): Promise<number>;
  srem(key: string, ...members: string[]): Promise<unknown>;
}

let client: RoomStoreClient | null = null;
let injectedForTests = false;

function getClient(): RoomStoreClient | null {
  if (client) return client;
  if (!process.env.REDIS_URL) return null;
  const r = new Redis(process.env.REDIS_URL, {
    retryStrategy: (times) => Math.min(30_000, 500 * 2 ** Math.min(times, 6)),
    maxRetriesPerRequest: 2,
    // Hydration reads a handful of small keys; 3s is generous and still bounded
    // so a Redis stall can never hold leadership hostage (the hydrate gate has
    // its own timeout on top).
    commandTimeout: 3000,
  });
  r.on("error", (e: unknown) =>
    console.warn("[roomStore]", e instanceof Error ? e.message : e)
  );
  client = r as unknown as RoomStoreClient;
  return client;
}

/** 0 = "this instance is not the leader" ⇒ every write is a no-op. Only
 *  relayCluster ever sets a non-zero value, which is what keeps a
 *  single-process deploy completely dormant here. */
let epoch = 0;
let snapshotOf: ((roomId: string) => PersistedRoom | null) | null = null;
let liveRoomIds: (() => string[]) | null = null;
const dirty = new Set<string>();
let flushScheduled = false;
let sweepTimer: ReturnType<typeof setInterval> | null = null;

/** Wire the registry's snapshot functions (called once by attachRelay) and arm
 *  the periodic full sweep. The sweep is unref'd and no-ops while epoch is 0. */
export function initRoomStore(deps: {
  snapshotOf: (roomId: string) => PersistedRoom | null;
  liveRoomIds: () => string[];
}): void {
  snapshotOf = deps.snapshotOf;
  liveRoomIds = deps.liveRoomIds;
  if (!sweepTimer) {
    sweepTimer = setInterval(() => {
      if (!epoch || !liveRoomIds) return;
      for (const id of liveRoomIds()) dirty.add(id);
      scheduleFlush();
    }, ROOM_SWEEP_MS);
    sweepTimer.unref?.();
  }
}

/** Called by relayCluster: a fresh fence epoch on winning the lease, 0 on
 *  losing it. Dropping to 0 also drops any queued writes — a demoted leader
 *  must not write, and its pending marks describe a registry it no longer owns. */
export function setLeaderEpoch(n: number): void {
  epoch = n > 0 ? n : 0;
  if (!epoch) dirty.clear();
}
export function leaderEpoch(): number {
  return epoch;
}

/** Mint the next fence epoch. Returns 0 when Redis is unreachable, which leaves
 *  persistence OFF for this leadership term rather than writing unfenced. */
export async function mintLeaderEpoch(): Promise<number> {
  const c = getClient();
  if (!c) return 0;
  try {
    const n = await c.incr(LEADER_EPOCH_KEY);
    return typeof n === "number" && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

/**
 * Note that a room's state changed. Coalesced: many marks inside one signaling
 * handler produce ONE write, on the next tick, of the SETTLED state — the same
 * discipline `touchBusyState` uses, and for the same reason (a handler crosses
 * several mutation funnels mid-transition).
 */
export function markRoomDirty(roomId: string | null | undefined): void {
  if (!roomId || !epoch) return;
  dirty.add(roomId);
  scheduleFlush();
}

function scheduleFlush(): void {
  if (flushScheduled || !epoch) return;
  flushScheduled = true;
  setImmediate(() => {
    flushScheduled = false;
    void flushDirty();
  });
}

async function flushDirty(): Promise<void> {
  const c = getClient();
  if (!c || !epoch || !snapshotOf) {
    dirty.clear();
    return;
  }
  const ids = Array.from(dirty);
  dirty.clear();
  const myEpoch = epoch;
  for (const roomId of ids) {
    const rec = snapshotOf(roomId);
    try {
      if (rec) {
        await c.eval(
          WRITE_LUA, 2, roomKey(roomId), ROOM_INDEX_KEY,
          String(myEpoch), String(ROOM_TTL_MS), encodeRoom(rec), roomId,
        );
      } else {
        await c.eval(DELETE_LUA, 2, roomKey(roomId), ROOM_INDEX_KEY, String(myEpoch), roomId);
      }
    } catch {
      /* Fire-and-forget by contract: a failed write must never surface on the
       * signaling hot path. The 15s sweep re-marks every live room, so a
       * transient Redis error self-heals within one sweep. */
    }
  }
}

/** Test seam: run the pending flush now (no timers). */
export async function _flushNowForTests(): Promise<void> {
  flushScheduled = false;
  await flushDirty();
}

/**
 * Read every persisted room back. Used by a freshly-elected leader BEFORE it
 * serves signaling. Index entries whose hash has expired are pruned, so the
 * index cannot grow without bound after a leader dies mid-call.
 */
export async function hydrateRooms(): Promise<PersistedRoom[]> {
  const c = getClient();
  if (!c) return [];
  let ids: string[];
  try {
    ids = await c.smembers(ROOM_INDEX_KEY);
  } catch {
    return [];
  }
  const out: PersistedRoom[] = [];
  const gone: string[] = [];
  for (const id of ids) {
    let raw: string | null = null;
    try {
      raw = await c.hget(roomKey(id), "d");
    } catch {
      continue; // transient read error: leave the index entry alone
    }
    const rec = decodeRoom(raw);
    if (rec) out.push(rec);
    else gone.push(id);
  }
  if (gone.length) {
    try {
      await c.srem(ROOM_INDEX_KEY, ...gone);
    } catch {
      /* best-effort */
    }
  }
  return out;
}

/* ── test hooks ──────────────────────────────────────────────────────────── */

export function _setRoomStoreClientForTests(c: RoomStoreClient | null): void {
  client = c;
  injectedForTests = c !== null;
}
export function _resetRoomStoreForTests(): void {
  client = null;
  injectedForTests = false;
  epoch = 0;
  snapshotOf = null;
  liveRoomIds = null;
  dirty.clear();
  flushScheduled = false;
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
}
export function _roomStoreInjectedForTests(): boolean {
  return injectedForTests;
}
