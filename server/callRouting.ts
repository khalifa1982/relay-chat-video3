/**
 * Per-box in-memory CALL-ROUTING cache (v2.107.48, owner).
 * ────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS — and why it is NOT a DB call on the ring path.
 *
 * The first cut of "send calls to voicemail" was reverted because it broke
 * calling for EVERYONE: it put a DB round-trip (getIdentityByNumber +
 * isCallRoutedToVoicemailBy) in front of the ring on the REACHABLE (live-callee)
 * fast path for every single call, deferred into a `.then()`. Under any DB
 * latency that delayed or dropped the ring on all calls — live people looked
 * unreachable and fell through to offline+voicemail. One rarely-used feature
 * taxed the latency of the entire platform.
 *
 * The fix is this module. A user's routing config (the global "all my calls to
 * voicemail" switch + the set of individual numbers they divert) is loaded into
 * a plain in-memory Map when they REGISTER — an async context already off the
 * ring path — and refreshed when they toggle. The ring-time decision is then a
 * SYNCHRONOUS Map lookup with ZERO added latency and ZERO DB access.
 *
 * The contract the ring path relies on:
 *   • routeCallToVoicemail() is synchronous and never throws.
 *   • A cache MISS returns false — "ring normally". A callee who has not opted
 *     in has no entry, so the normal ring path stays byte-for-byte unchanged.
 *     Fail-OPEN by construction: the boundary can only ever ADD a divert, never
 *     swallow a real call.
 *
 * KEYING: by the callee's 6-digit NUMBER, which is exactly what the ring path
 * holds in hand (`to`) — no per-registry identity plumbing, no second lookup on
 * the hot path. The loader/toggle side works from identity or number and
 * resolves as needed OFF the hot path.
 *
 * CROSS-BOX: presence is per-box (the ring is delivered by the box holding the
 * callee's socket), so the config must live on THAT box. It is loaded there at
 * register. A toggle (which may land on a different box) writes the DB and
 * publishes a `relay:callrouting` envelope; every box refreshes its own entry
 * for that number if it holds one. Worst case during the sub-second propagation
 * window is a call that rings when it would have gone to voicemail (or
 * vice-versa) — both harmless and self-healing, never a dropped real call.
 */
import { loadCallRoutingConfigByNumber } from "./v2db";
import { publishBus, subscribeBus } from "./redisBus";

type RoutingEntry = {
  /** Global "send ALL my calls to voicemail". */
  all: boolean;
  /** Individual caller numbers whose calls go to voicemail. */
  numbers: Set<string>;
};

/** calleeNumber → routing config. Absence === not loaded === ring normally. */
const cache = new Map<string, RoutingEntry>();

function entryIsActive(e: RoutingEntry): boolean {
  return e.all || e.numbers.size > 0;
}

/**
 * SYNCHRONOUS ring-time check: does the callee at `calleeNumber` send
 * `callerNumber`'s calls to voicemail? Never throws; a miss (unloaded, or
 * loaded-and-all-off) returns false so the call rings exactly as it always has.
 * This is the ONLY function the hot path calls.
 */
export function routeCallToVoicemail(calleeNumber: string, callerNumber: string): boolean {
  const e = cache.get(calleeNumber);
  if (!e) return false; // not opted in (or not yet loaded) → ring
  if (e.all) return true;
  return e.numbers.has(callerNumber);
}

/**
 * Load (or refresh) a number's config into the cache. Called at REGISTER and
 * after a toggle — both async, both off the ring path. All-off configs are
 * pruned rather than stored, so the common case (nobody opted in) keeps the map
 * empty and every lookup is a fast miss. Best-effort: a DB error leaves any
 * existing entry untouched and simply doesn't add one (→ ring).
 */
export async function loadRoutingForNumber(calleeNumber: string): Promise<void> {
  try {
    const cfg = await loadCallRoutingConfigByNumber(calleeNumber);
    if (!cfg) return; // number resolved to no identity — leave as-is
    const entry: RoutingEntry = { all: cfg.all, numbers: new Set(cfg.numbers) };
    if (entryIsActive(entry)) cache.set(calleeNumber, entry);
    else cache.delete(calleeNumber);
  } catch {
    /* leave prior state as-is; absence/stale both fail open to ringing */
  }
}

/** Drop a number's cached config (e.g. on full disconnect, to bound memory). */
export function forgetRoutingForNumber(calleeNumber: string): void {
  cache.delete(calleeNumber);
}

// ── cross-box propagation ────────────────────────────────────────────────────
const CALL_ROUTING_CHANNEL = "relay:callrouting";
let subscribed = false;

/** Idempotently subscribe this box to routing-change envelopes. Call at boot. */
export function initCallRoutingBus(): void {
  if (subscribed) return;
  subscribed = true;
  subscribeBus(CALL_ROUTING_CHANNEL, (payload: unknown) => {
    const num = (payload as { n?: unknown } | null)?.n;
    if (typeof num !== "string" || !num) return;
    // Refresh only if we already hold this number (we may be the box with their
    // socket). A box that never loaded them loads fresh at their next register.
    if (cache.has(num)) void loadRoutingForNumber(num);
  });
}

/**
 * Announce that a number's routing config changed: refresh locally now, then
 * tell the other boxes. Called by the toggle endpoints after they write the DB.
 * `publishBus` drops our own envelope by instance id, so the local refresh here
 * is what updates this box.
 */
export async function publishRoutingChanged(calleeNumber: string): Promise<void> {
  await loadRoutingForNumber(calleeNumber);
  try {
    publishBus(CALL_ROUTING_CHANNEL, { n: calleeNumber });
  } catch {
    /* a bus hiccup only delays cross-box propagation to the next register */
  }
}

// ── test/introspection helpers ───────────────────────────────────────────────
export function _routingCacheSize(): number {
  return cache.size;
}
export function _setRoutingForTests(calleeNumber: string, all: boolean, numbers: string[]): void {
  const entry: RoutingEntry = { all, numbers: new Set(numbers) };
  if (entryIsActive(entry)) cache.set(calleeNumber, entry);
  else cache.delete(calleeNumber);
}
export function _clearRoutingForTests(): void {
  cache.clear();
}
