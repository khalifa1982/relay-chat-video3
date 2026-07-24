/**
 * Browser-scoped multi-tab presence ref-count (M12).
 *
 * Presence is a single boolean per identity, but every tab runs its own
 * PresenceManager — so closing ONE of two open tabs used to beacon the WHOLE
 * identity offline while the other tab was still live: contacts blink offline,
 * and the surviving tab's next heartbeat (≤30s) then fires a false
 * "X is back online — tap to call them now" push to every watcher.
 *
 * Each tab records `tabId → lastActiveTs` in a per-identity localStorage map on
 * every VISIBLE heartbeat; on leave, a tab only sends the offline beacon when no
 * OTHER tab of the same identity has a fresh timestamp. localStorage is
 * per-browser, so this coordinates all tabs in one browser regardless of which
 * fleet instance each tab's SSE hit.
 *
 * Fails SAFE: any storage error → treated as "no other tab" → the beacon fires
 * (exactly today's behaviour). A crashed tab's stale entry ages out via
 * TAB_FRESH_MS, and the 2-min server reaper remains the ultimate backstop, so
 * the worst case of a mis-skip is a delayed offline, never a stuck-online.
 */
const PREFIX = "relay_tabs_";
/** Freshness window: > the 30s heartbeat so one missed beat doesn't drop a tab. */
export const TAB_FRESH_MS = 45_000;

type TabMap = Record<string, number>;

function keyOf(identityId: number): string {
  return PREFIX + identityId;
}

/** A per-tab id. Prefers a CSPRNG UUID; falls back to a good-enough random. */
export function makeTabId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    /* fall through */
  }
  return `t_${Math.floor(Math.random() * 1e9).toString(36)}_${Date.now().toString(36)}`;
}

/* ── pure decision logic (unit-tested without localStorage) ─────────────── */

/** Is any tab OTHER than `tabId` still fresh (active within `freshMs`)? */
export function anyOtherTabFresh(
  map: TabMap,
  tabId: string,
  now: number,
  freshMs = TAB_FRESH_MS,
): boolean {
  for (const k of Object.keys(map)) {
    if (k === tabId) continue;
    const ts = map[k];
    if (typeof ts === "number" && now - ts >= 0 && now - ts < freshMs) return true;
  }
  return false;
}

/** Drop entries older than `freshMs` (crashed/closed tabs that never cleaned up). */
export function pruneTabs(map: TabMap, now: number, freshMs = TAB_FRESH_MS): TabMap {
  const out: TabMap = {};
  for (const k of Object.keys(map)) {
    const ts = map[k];
    if (typeof ts === "number" && now - ts >= 0 && now - ts < freshMs) out[k] = ts;
  }
  return out;
}

/* ── localStorage-backed wrappers ───────────────────────────────────────── */

function readMap(identityId: number): TabMap {
  try {
    const raw = localStorage.getItem(keyOf(identityId));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as TabMap) : {};
  } catch {
    return {};
  }
}

function writeMap(identityId: number, map: TabMap): void {
  try {
    if (Object.keys(map).length === 0) localStorage.removeItem(keyOf(identityId));
    else localStorage.setItem(keyOf(identityId), JSON.stringify(map));
  } catch {
    /* storage unavailable — ref-count just won't persist (fails safe) */
  }
}

/** Record this tab as active now (call on each visible heartbeat). */
export function touchTab(identityId: number, tabId: string, now: number): void {
  const map = pruneTabs(readMap(identityId), now);
  map[tabId] = now;
  writeMap(identityId, map);
}

/** Remove this tab (call on a real close / unmount). */
export function removeTab(identityId: number, tabId: string, now: number): void {
  const map = pruneTabs(readMap(identityId), now);
  delete map[tabId];
  writeMap(identityId, map);
}

/** True when another tab of this identity is still live (so we should NOT beacon
 *  offline). Fails safe to false (→ beacon fires) on any error. */
export function otherTabsAlive(identityId: number, tabId: string, now: number): boolean {
  try {
    return anyOtherTabFresh(pruneTabs(readMap(identityId), now), tabId, now);
  } catch {
    return false;
  }
}
