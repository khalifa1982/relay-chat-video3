/* ──────────────────────────────────────────────────────────────────────────
 * Redis event bus for horizontal scale (v2.91).
 *
 * Gated ENTIRELY on REDIS_URL (read per-call, like TURN_* / LIVEKIT_*):
 * absent ⇒ every function here is a no-op and RELAY behaves byte-identically
 * to the single-instance builds — that's `.org` on Manus and any `.io` box
 * that hasn't provisioned ElastiCache yet.
 *
 * What the bus does when enabled:
 *
 *   1. v2 SSE fan-out (channel `relay:v2ev`) — server/v2events.ts delivers an
 *      event to ITS OWN SSE clients first, then publishes the envelope so
 *      every OTHER instance delivers to its local clients. Loop-safety: each
 *      envelope carries the publisher's per-boot INSTANCE_ID and subscribers
 *      drop their own envelopes (local delivery already happened).
 *
 *   2. Busy-line + party-line live counts across tiers — the SIGNALING
 *      instance (the one ALB routes /api/relay/* to) mirrors its in-memory
 *      registry into:
 *        `relay:busypins`  (SET, via SADD/SREM diffs)
 *        `relay:plcounts`  (HASH number → live members, via HSET/HDEL diffs)
 *      synced from the join/leave/reap funnels in server/relay.ts (coalesced
 *      per tick) plus a 30s full re-sync, with a 90s TTL on both keys so a
 *      crashed signaling node can never leave ghost state. API-tier
 *      instances (no local relay clients) READ these keys in
 *      pinsInCallAsync / partyLineLiveCountsAsync instead of their (empty)
 *      local registry.
 *
 * DELIBERATELY OUT OF SCOPE — cross-instance relay rooms / mesh signaling.
 * The registry in server/relay.ts performs transactional multi-step call-state
 * transitions (ring replacement, call-waiting hold/promote, grace-reap vs
 * rejoin races) that are only correct because they run atomically within one
 * process's event loop. Splitting rooms across instances turns each of those
 * into a distributed consistency problem (fencing, ordering, partial-failure
 * rollback) — that is phase 2 with its own design. Until then ALL
 * /api/relay/* traffic must be routed to ONE instance (see
 * docs-aws-scale-out.md); this module makes everything AROUND signaling
 * scale out. The busy-state keys assume that single-writer topology: enable
 * REDIS_URL only after (or together with) the ALB signaling rule.
 *
 * Client: ioredis (regular dependency — production signaling infrastructure
 * wants a battle-tested RESP client: AUTH/db/TLS from the URL, auto-reconnect
 * with backoff, auto re-subscribe). Two connections, as Redis requires: one
 * for commands/publishing, one dedicated to subscriptions.
 * ────────────────────────────────────────────────────────────────────────── */
import crypto from "crypto";
import Redis from "ioredis";

/** Per-boot instance identity — stamps every published envelope. */
export const INSTANCE_ID = crypto.randomBytes(8).toString("hex");

export const V2EV_CHANNEL = "relay:v2ev";
export const BUSY_PINS_KEY = "relay:busypins";
export const PL_COUNTS_KEY = "relay:plcounts";
/** Both busy-state keys self-expire if the signaling node stops refreshing
 *  them (30s full-sync cadence ⇒ 90s covers two missed beats + skew). */
export const BUSY_STATE_TTL_S = 90;

/** The bus is ON only when the operator provisioned Redis. Read per-call. */
export function busEnabled(): boolean {
  return !!process.env.REDIS_URL;
}

/* ── connections ───────────────────────────────────────────────── */

/** The minimal command surface this module uses — lets tests inject a fake
 *  and keeps us honest about the blast radius of the dependency. ioredis
 *  satisfies it structurally. */
export interface RedisCommandClient {
  publish(channel: string, message: string): Promise<unknown>;
  smembers(key: string): Promise<string[]>;
  smismember(key: string, ...members: string[]): Promise<unknown>;
  sadd(key: string, ...members: string[]): Promise<unknown>;
  srem(key: string, ...members: string[]): Promise<unknown>;
  expire(key: string, seconds: number): Promise<unknown>;
  hgetall(key: string): Promise<Record<string, string>>;
  hset(key: string, ...fieldValues: (string | number)[]): Promise<unknown>;
  hdel(key: string, ...fields: string[]): Promise<unknown>;
  hmget(key: string, ...fields: string[]): Promise<(string | null)[]>;
}
export interface RedisSubscriberClient {
  subscribe(...channels: string[]): Promise<unknown>;
  on(event: "message", cb: (channel: string, message: string) => void): unknown;
}

let pubClient: RedisCommandClient | null = null;
let subClient: RedisSubscriberClient | null = null;
let injectedForTests = false;

function makeRedis(label: string, opts?: { maxRetriesPerRequest?: number | null }): Redis {
  const r = new Redis(process.env.REDIS_URL as string, {
    // Capped exponential backoff; never give up (signaling infra must ride
    // out an ElastiCache failover).
    retryStrategy: (times) => Math.min(30_000, 500 * 2 ** Math.min(times, 6)),
    // fail reads fast — callers fall back to local/empty. The SUB connection
    // overrides this to null (v2.91 review D3): its only command is
    // SUBSCRIBE, and failing that out of the offline queue would silently
    // lose the channel for the life of the process.
    maxRetriesPerRequest: opts?.maxRetriesPerRequest === undefined ? 2 : opts.maxRetriesPerRequest,
    enableOfflineQueue: true,
    // Hard upper bound on ANY command awaiting a reply (v2.91 review D4):
    // an API request must never hang on a Redis outage — reads give up in
    // 1.5s and callers take their safe defaults (empty set / zero counts).
    commandTimeout: 1500,
  });
  r.on("error", (err: unknown) => {
    console.warn(`[redisBus] ${label}:`, err instanceof Error ? err.message : err);
  });
  r.once("ready", () => console.log(`[redisBus] ${label} ready (instance ${INSTANCE_ID})`));
  return r;
}

function getPub(): RedisCommandClient | null {
  if (pubClient) return pubClient;
  if (!busEnabled()) return null;
  pubClient = makeRedis("pub");
  return pubClient;
}

function getSub(): RedisSubscriberClient | null {
  if (subClient) return subClient;
  if (!busEnabled()) return null;
  // maxRetriesPerRequest:null — a boot-time SUBSCRIBE waits in the offline
  // queue instead of being failed out of it (v2.91 review D3).
  const r = makeRedis("sub", { maxRetriesPerRequest: null });
  r.on("message", dispatchMessage);
  // Self-heal on every (re)connect: re-issue SUBSCRIBE for ALL handler
  // channels (duplicates are idempotent). ioredis only auto-resubscribes
  // server-ACKed channels, so a subscription lost to a boot-time Redis
  // outage would otherwise stay lost for the life of the process.
  r.on("ready", () => resubscribeAllChannels(r));
  subClient = r;
  return subClient;
}

/* ── envelope (pure — unit-tested) ─────────────────────────────── */

export interface BusEnvelope {
  /** Publisher's INSTANCE_ID. */
  i: string;
  /** Opaque payload owned by the channel's subscriber. */
  p: unknown;
}

/* ── envelope authentication (v2.99.49) ────────────────────────────────────
   Closes the residual accepted in v2.99.20: the bus had NO authentication of any
   kind, so anything able to PUBLISH to Redis could forge an envelope that reached
   every connected SSE stream on an instance (the `kind` allowlist added then is
   loop/shape safety, not auth).

   WIRE FORMAT IS DELIBERATELY UNCHANGED IN SHAPE: still a flat object with `i`
   and `p` at the top level, with the signature in ADDITIONAL fields. Today's
   decoder reads only `i`/`p` and ignores extras, so a signed envelope is
   transparently accepted by an OLD instance — which matters because the fleet is
   rolled one instance at a time, so signed and unsigned publishers coexist during
   every deploy. Any other shape (a `v1.<mac>.<body>` prefix, a nested body) would
   make every old receiver JSON.parse-fail and drop 100% of real events for the
   whole rollout window. */

/** Signing key: REDIS_BUS_SECRET, else JWT_SECRET (fleet-uniform by necessity —
 *  it already verifies session cookies on every instance), else null. NEVER
 *  throws: publishBus is contractually no-throw. */
function busSecret(): string | null {
  return process.env.REDIS_BUS_SECRET || process.env.JWT_SECRET || null;
}

/** Strict mode: reject UNSIGNED envelopes. The operator flips this only after the
 *  whole fleet runs a signing build — see docs-aws-scale-out.md. Note the
 *  `&& key` conjunction at the use site: strict with no key must not drop
 *  everything, or a dev box with the flag set goes dark. */
export function busStrict(): boolean {
  return /^(1|true)$/i.test(process.env.REDIS_BUS_STRICT || "");
}

function envelopeMac(channel: string, i: string, t: number, p: unknown, key: string): string {
  const ps = JSON.stringify(p === undefined ? null : p) ?? "null";
  return crypto
    .createHmac("sha256", key)
    .update(`${channel}\n${i}\n${t}\n${ps}`)
    .digest("hex")
    .slice(0, 32); // 128-bit tag
}

/** Counters surfaced on /api/health so `REDIS_BUS_STRICT=1` can be flipped on
 *  evidence (every instance reporting unsigned: 0) rather than on faith. */
export const busAuthStats = { signed: 0, unsigned: 0, invalid: 0, unverifiable: 0 };
export function _busAuthStatsForTests() {
  return { ...busAuthStats };
}
let lastBusAuthWarn = 0;
function warnBusAuth(what: string): void {
  const now = Date.now();
  if (now - lastBusAuthWarn < 60_000) return;
  lastBusAuthWarn = now;
  console.warn(`[redisBus] ${what}`);
}

export function encodeEnvelope(instanceId: string, payload: unknown, channel = ""): string {
  const key = busSecret();
  // No key ⇒ byte-identical to the pre-signing format.
  if (!key) return JSON.stringify({ i: instanceId, p: payload });
  const t = Date.now();
  return JSON.stringify({
    i: instanceId,
    p: payload,
    t,
    m: envelopeMac(channel, instanceId, t, payload, key),
  });
}

export function decodeEnvelope(raw: string, channel = ""): BusEnvelope | null {
  try {
    const j = JSON.parse(raw) as Partial<BusEnvelope> & { t?: unknown; m?: unknown };
    if (!j || typeof j.i !== "string" || !("p" in j)) return null;
    const env: BusEnvelope = { i: j.i, p: j.p };
    const key = busSecret();
    if (typeof j.m === "string" && typeof j.t === "number") {
      if (!key) {
        // Only reachable in dev/test: production always has JWT_SECRET, because
        // the session signer already refuses to start without it.
        busAuthStats.unverifiable++;
        return env;
      }
      const expected = envelopeMac(channel, j.i, j.t, j.p, key);
      const ok =
        expected.length === j.m.length &&
        crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(j.m));
      if (!ok) {
        // A signed-but-WRONG envelope is dropped in every mode, strict or not.
        busAuthStats.invalid++;
        warnBusAuth(`dropped an envelope with a bad signature on ${channel || "?"}`);
        return null;
      }
      busAuthStats.signed++;
      return env;
    }
    // Unsigned: an old instance mid-deploy, or a forgery. Accepted until the
    // operator flips strict — which is exactly why the counter exists.
    busAuthStats.unsigned++;
    if (busStrict() && key) {
      warnBusAuth(`dropped an UNSIGNED envelope on ${channel || "?"} (strict mode)`);
      return null;
    }
    return env;
  } catch {
    return null;
  }
}

/** Loop-safety: an instance never re-delivers its own envelope — it already
 *  delivered locally BEFORE publishing. */
export function shouldDeliver(env: BusEnvelope, selfInstanceId: string): boolean {
  return env.i !== selfInstanceId;
}

/* ── pub/sub ───────────────────────────────────────────────────── */

/** `fromInstance` is the publisher's INSTANCE_ID as carried by the envelope —
 *  additive, so existing single-argument handlers are unaffected. It lets a
 *  handler refuse a frame that claims to originate somewhere it didn't. */
type BusHandler = (payload: unknown, fromInstance: string) => void;
const handlers = new Map<string, Set<BusHandler>>();
/** Channels whose SUBSCRIBE the server has ACKed. A channel enters this set
 *  only when its SUBSCRIBE RESOLVES (v2.91 review D3) — an eagerly-latched
 *  channel whose boot-time SUBSCRIBE then failed was unrecoverable. */
const subscribedChannels = new Set<string>();

/** Issue one SUBSCRIBE; latch the channel on success, unlatch on failure so a
 *  later subscribeBus / reconnect sweep retries it. */
function issueSubscribe(sub: RedisSubscriberClient, channel: string): void {
  Promise.resolve(sub.subscribe(channel))
    .then(() => subscribedChannels.add(channel))
    .catch((err) => {
      subscribedChannels.delete(channel);
      console.warn(
        "[redisBus] subscribe failed:",
        err instanceof Error ? err.message : err
      );
    });
}

/** Re-issue SUBSCRIBE for every registered handler channel (used on the sub
 *  connection's "ready" — duplicate SUBSCRIBEs are idempotent). */
function resubscribeAllChannels(sub: RedisSubscriberClient): void {
  handlers.forEach((_set, channel) => issueSubscribe(sub, channel));
}

function dispatchMessage(channel: string, message: string): void {
  const set = handlers.get(channel);
  if (!set || set.size === 0) return;
  const env = decodeEnvelope(message, channel);
  if (!env || !shouldDeliver(env, INSTANCE_ID)) return;
  set.forEach((h) => {
    try {
      h(env.p, env.i);
    } catch (err) {
      console.warn("[redisBus] handler error:", err);
    }
  });
}

/**
 * Register a handler for a channel. The handler is recorded even when the bus
 * is off (cheap; lets a later-provisioned REDIS_URL work after restart and
 * lets tests drive `_dispatchForTests`). The actual SUBSCRIBE happens only
 * when enabled.
 */
export function subscribeBus(channel: string, handler: BusHandler): void {
  let set = handlers.get(channel);
  if (!set) {
    set = new Set();
    handlers.set(channel, set);
  }
  set.add(handler);
  const sub = getSub();
  if (sub && !subscribedChannels.has(channel)) issueSubscribe(sub, channel);
}

/** Fire-and-forget publish. No-op when the bus is off; never throws. */
export function publishBus(channel: string, payload: unknown): void {
  const pub = getPub();
  if (!pub) return;
  Promise.resolve(pub.publish(channel, encodeEnvelope(INSTANCE_ID, payload, channel))).catch(
    () => {
      /* transient — subscribers self-heal via reconnect + local polling */
    }
  );
}

/* ── busy-line / party-line state sync ─────────────────────────── */

export interface BusySnapshot {
  /** Pins currently on a call (pinsInCall semantics). */
  busyPins: string[];
  /** Party-line number → CONNECTED member count (zero-count lines omitted). */
  plCounts: Map<string, number>;
  /** Does this instance's registry hold ANY live signaling client? Only such
   *  an instance (the signaling node) may write/clear the shared keys. */
  hasClients: boolean;
}

let snapshotProvider: (() => BusySnapshot) | null = null;
let syncTimer: ReturnType<typeof setInterval> | null = null;
let touchScheduled = false;
let syncRunning = false;
let syncPendingAgain = false;

/**
 * Wire the signaling registry's snapshot function (called by attachRelay).
 * Arms the 30s full re-sync once; the interval is unref'd and no-ops unless
 * the bus is enabled, so test processes and `.org` pay nothing.
 */
export function initBusyStateSync(provider: () => BusySnapshot): void {
  snapshotProvider = provider;
  if (!syncTimer) {
    syncTimer = setInterval(() => {
      void runBusySync();
    }, 30_000);
    syncTimer.unref?.();
  }
}

/**
 * Coalesced touch — call from the relay's join/leave/reap funnels. The sync
 * runs on the NEXT tick so a handler's multi-step mutation is observed once,
 * settled, no matter how many funnels it crossed.
 */
export function touchBusyState(): void {
  if (touchScheduled) return;
  if (!snapshotProvider) return;
  if (!busEnabled() && !injectedForTests) return;
  touchScheduled = true;
  setImmediate(() => {
    touchScheduled = false;
    void runBusySync();
  });
}

/** Diff-sync the registry truth into Redis. Serialized (one at a time). */
async function runBusySync(): Promise<void> {
  if (syncRunning) {
    syncPendingAgain = true;
    return;
  }
  const pub = getPub();
  if (!pub || !snapshotProvider) return;
  syncRunning = true;
  try {
    const truth = snapshotProvider();
    // Single-writer guard (v2.91 review D6): ONLY the signaling node — an
    // instance with live relay clients — may touch the shared keys. There is
    // deliberately NO "one final clearing sync" for a node that just lost its
    // last client: during a graceful signaling re-pin that clear diffed the
    // ENTIRE remote key toward its own empty truth and wiped entries the NEW
    // signaling node had just written. Post-demotion residue simply ages out
    // via the 90s TTL (a call that ends while clients remain connected still
    // clears immediately — hasClients is about clients, not calls).
    if (!truth.hasClients) return;

    const [remotePins, remoteCounts] = await Promise.all([
      pub.smembers(BUSY_PINS_KEY),
      pub.hgetall(PL_COUNTS_KEY),
    ]);

    const pinOps = diffSets(remotePins, truth.busyPins);
    if (pinOps.add.length > 0) await pub.sadd(BUSY_PINS_KEY, ...pinOps.add);
    if (pinOps.remove.length > 0) await pub.srem(BUSY_PINS_KEY, ...pinOps.remove);

    const countOps = diffCounts(remoteCounts, truth.plCounts);
    if (countOps.set.length > 0) await pub.hset(PL_COUNTS_KEY, ...countOps.set);
    if (countOps.del.length > 0) await pub.hdel(PL_COUNTS_KEY, ...countOps.del);

    if (truth.busyPins.length > 0) await pub.expire(BUSY_PINS_KEY, BUSY_STATE_TTL_S);
    if (truth.plCounts.size > 0) await pub.expire(PL_COUNTS_KEY, BUSY_STATE_TTL_S);
  } catch (err) {
    console.warn("[redisBus] busy-state sync failed:", err instanceof Error ? err.message : err);
  } finally {
    syncRunning = false;
    if (syncPendingAgain) {
      syncPendingAgain = false;
      void runBusySync();
    }
  }
}

/** Pure diff: which members to SADD / SREM to turn `remote` into `truth`. */
export function diffSets(
  remote: readonly string[],
  truth: readonly string[]
): { add: string[]; remove: string[] } {
  const remoteSet = new Set(remote);
  const truthSet = new Set(truth);
  return {
    add: Array.from(truthSet).filter((m) => !remoteSet.has(m)),
    remove: Array.from(remoteSet).filter((m) => !truthSet.has(m)),
  };
}

/** Pure diff for the counts hash: HSET pairs (flat) + HDEL fields. */
export function diffCounts(
  remote: Record<string, string>,
  truth: ReadonlyMap<string, number>
): { set: (string | number)[]; del: string[] } {
  const set: (string | number)[] = [];
  truth.forEach((n, number) => {
    if (remote[number] !== String(n)) set.push(number, n);
  });
  const del = Object.keys(remote).filter((number) => !truth.has(number));
  return { set, del };
}

/* ── cross-tier reads (API-tier instances) ─────────────────────── */

/** Upper bound on a cross-tier read (v2.91 review D4): a Redis outage must
 *  never hang an API request — the read resolves to its SAFE DEFAULT instead.
 *  Belt-and-suspenders with makeRedis's commandTimeout (this also bounds
 *  injected clients and any future client swap). The losing promise is
 *  pre-caught, so a late rejection can never surface as unhandled. */
const READ_TIMEOUT_MS = 1500;
function readWithTimeout<T>(read: Promise<T>, fallback: T): Promise<T> {
  return Promise.race([
    read.catch(() => fallback),
    new Promise<T>((resolve) => {
      const t = setTimeout(() => resolve(fallback), READ_TIMEOUT_MS);
      (t as { unref?: () => void }).unref?.();
    }),
  ]);
}

/** Which of `pins` are busy according to the shared Redis set. Empty on any
 *  error / timeout / when the key expired — "not on a call" is the safe
 *  default. */
export async function readBusyPinsFromRedis(pins: readonly string[]): Promise<Set<string>> {
  const out = new Set<string>();
  if (pins.length === 0) return out;
  const pub = getPub();
  if (!pub) return out;
  try {
    const flags = (await readWithTimeout(
      Promise.resolve(pub.smismember(BUSY_PINS_KEY, ...pins)),
      [] as number[]
    )) as number[];
    pins.forEach((pin, idx) => {
      if (flags?.[idx] === 1) out.add(pin);
    });
  } catch {
    /* fall through to empty */
  }
  return out;
}

/** Party-line live counts from the shared Redis hash (0 for unknown /
 *  error / timeout). */
export async function readPlCountsFromRedis(
  numbers: readonly string[]
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  numbers.forEach((n) => out.set(n, 0));
  if (numbers.length === 0) return out;
  const pub = getPub();
  if (!pub) return out;
  try {
    const vals = (await readWithTimeout(
      Promise.resolve(pub.hmget(PL_COUNTS_KEY, ...numbers)),
      [] as (string | null)[]
    )) as (string | null)[];
    numbers.forEach((n, idx) => {
      const parsed = Number(vals?.[idx] ?? 0);
      out.set(n, Number.isFinite(parsed) && parsed > 0 ? parsed : 0);
    });
  } catch {
    /* keep zeros */
  }
  return out;
}

/* ── test hooks ────────────────────────────────────────────────── */

/** Inject fake clients (or null to clear). Tests drive sync/reads against a
 *  scripted command recorder without a live server. */
export function _setRedisForTests(
  pub: RedisCommandClient | null,
  sub: RedisSubscriberClient | null = null
): void {
  pubClient = pub;
  subClient = sub;
  injectedForTests = pub !== null || sub !== null;
  subscribedChannels.clear();
}

/** Run one busy-state sync NOW (awaitable — no timers involved). */
export async function _runBusySyncNowForTests(): Promise<void> {
  await runBusySync();
}

/** Feed a raw pub/sub message through the dispatcher (as if from Redis). */
export function _dispatchForTests(channel: string, message: string): void {
  dispatchMessage(channel, message);
}

/** Run the reconnect resubscribe sweep against the current sub client — what
 *  the real sub connection's "ready" event does (v2.91 review D3). */
export function _resubscribeAllForTests(): void {
  if (subClient) resubscribeAllChannels(subClient);
}

/** Reset module state between tests. */
export function _resetBusForTests(): void {
  pubClient = null;
  subClient = null;
  injectedForTests = false;
  handlers.clear();
  subscribedChannels.clear();
  snapshotProvider = null;
  if (syncTimer) {
    clearInterval(syncTimer);
    syncTimer = null;
  }
  touchScheduled = false;
  syncRunning = false;
  syncPendingAgain = false;
}

/** Disconnect real connections (live integration tests / graceful exit). */
export function _shutdownRedisBusForTests(): void {
  for (const c of [pubClient, subClient]) {
    const r = c as unknown as { disconnect?: () => void } | null;
    try {
      r?.disconnect?.();
    } catch {
      /* noop */
    }
  }
  _resetBusForTests();
}
