/**
 * Persist the ACTIVE CALL state across a page reload (e.g. the auto-updater's
 * mid-call refresh), so the engine can rejoin the exact room — with the user's
 * mic/cam state — on the fresh bundle, instead of stranding them on the idle
 * dialer. Stored in sessionStorage (per-tab, survives reload, gone on close).
 *
 * The server keeps room membership for a 30s grace window after a socket drops
 * (RELAY_DISCONNECT_GRACE_MS), so a snapshot is only honored while it's fresh
 * (well within that window). The pure validator is unit-tested.
 */
export interface RejoinSnapshot {
  /** The signaling room id to rejoin. */
  roomId: string;
  /** The 6-digit pin we were registered under IN the call (so the server's
   *  membership lookup matches after reload — not a reconciled/changed pin). */
  pin: string;
  /** Mic/cam state to restore after rejoining. */
  micOn: boolean;
  camOn: boolean;
  /** When the snapshot was taken (ms). */
  ts: number;
}

export const REJOIN_KEY = "relay_rejoin";
/** Honor a snapshot only within the server's grace window (a touch under 30s). */
export const REJOIN_MAX_AGE_MS = 28_000;

/** Validate shape + freshness. Pure — `now` injected for tests. */
export function isFreshSnapshot(s: unknown, nowMs: number): s is RejoinSnapshot {
  if (!s || typeof s !== "object") return false;
  const o = s as Record<string, unknown>;
  if (typeof o.roomId !== "string" || o.roomId.length === 0) return false;
  if (typeof o.pin !== "string" || !/^\d{6}$/.test(o.pin)) return false;
  if (typeof o.micOn !== "boolean" || typeof o.camOn !== "boolean") return false;
  if (typeof o.ts !== "number" || !Number.isFinite(o.ts)) return false;
  const age = nowMs - o.ts;
  // Reject stale snapshots and absurd future-dated ones (clock skew guard).
  if (age > REJOIN_MAX_AGE_MS || age < -5_000) return false;
  return true;
}

function parseFrom(store: Storage | undefined, nowMs: number): RejoinSnapshot | null {
  try {
    const raw = store?.getItem(REJOIN_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isFreshSnapshot(parsed, nowMs) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Read the freshest valid snapshot. Checked in BOTH stores so we rejoin after:
 *   - a same-tab RELOAD (sessionStorage), AND
 *   - a full app/browser CLOSE + reopen or a CRASH (localStorage) — within the
 *     server's grace window (the freshness check guarantees we never try to
 *     rejoin a long-dead room).
 */
export function readSnapshot(nowMs: number): RejoinSnapshot | null {
  return (
    parseFrom(typeof window !== "undefined" ? window.sessionStorage : undefined, nowMs) ??
    parseFrom(typeof window !== "undefined" ? window.localStorage : undefined, nowMs)
  );
}

export function writeSnapshot(s: RejoinSnapshot): void {
  const v = JSON.stringify(s);
  try { window.sessionStorage.setItem(REJOIN_KEY, v); } catch { /* */ }
  // localStorage survives a tab/browser close so a crash-and-reopen still rejoins.
  try { window.localStorage.setItem(REJOIN_KEY, v); } catch { /* */ }
}

export function clearSnapshot(): void {
  try { window.sessionStorage.removeItem(REJOIN_KEY); } catch { /* */ }
  try { window.localStorage.removeItem(REJOIN_KEY); } catch { /* */ }
}
