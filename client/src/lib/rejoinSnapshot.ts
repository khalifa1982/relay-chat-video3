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

export function readSnapshot(nowMs: number): RejoinSnapshot | null {
  try {
    const raw = window.sessionStorage.getItem(REJOIN_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isFreshSnapshot(parsed, nowMs) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeSnapshot(s: RejoinSnapshot): void {
  try {
    window.sessionStorage.setItem(REJOIN_KEY, JSON.stringify(s));
  } catch {
    /* private mode / quota — best effort */
  }
}

export function clearSnapshot(): void {
  try {
    window.sessionStorage.removeItem(REJOIN_KEY);
  } catch {
    /* */
  }
}
