/**
 * Rejoin-after-restart snapshot (M3.5) — the web's rejoinSnapshot.ts ported to
 * AsyncStorage. While a call is ESTABLISHED the engine keeps a fresh snapshot;
 * on the next boot a fresh one pre-arms the engine and registers under the
 * SNAPSHOT pin, so the server's `sendRejoinIfInRoom` offers the room back.
 *
 * Freshness window mirrors the web (28s < the server's 30s disconnect grace):
 * a snapshot older than that means the server already reaped our membership —
 * registering armed-for-rejoin would just hang on "connecting".
 *
 * SECURITY (shared-device hijack, the v2.4x web hardening): RN's signaling cid
 * is random per boot, so the server CANNOT detect an identity switch the way
 * it does for a live web tab. The engine therefore (a) clears the snapshot on
 * identity change/logout and (b) discards any snapshot whose pin isn't the
 * CURRENT identity's number before arming a rejoin.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "relay_rejoin_snapshot";
export const REJOIN_MAX_AGE_MS = 28_000;

export interface RejoinSnapshot {
  roomId: string;
  /** Server-authoritative signaling pin (sig.pin), NOT necessarily me.number. */
  pin: string;
  micOn: boolean;
  camOn: boolean;
  speakerOn: boolean;
  isVideoCall: boolean;
  isGroup: boolean;
  peerName: string;
  peerPin: string;
  ts: number;
}

export async function saveRejoinSnapshot(snap: RejoinSnapshot): Promise<void> {
  try { await AsyncStorage.setItem(KEY, JSON.stringify(snap)); } catch { /* best effort */ }
}

export async function clearRejoinSnapshot(): Promise<void> {
  try { await AsyncStorage.removeItem(KEY); } catch { /* */ }
}

/** Read + validate; stale/corrupt/clock-skewed snapshots are dropped. */
export async function readRejoinSnapshot(): Promise<RejoinSnapshot | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Partial<RejoinSnapshot>;
    if (!s || typeof s.roomId !== "string" || typeof s.pin !== "string" || typeof s.ts !== "number") {
      void clearRejoinSnapshot();
      return null;
    }
    const age = Date.now() - s.ts;
    // Future timestamps (>5s skew) are as untrustworthy as stale ones.
    if (age > REJOIN_MAX_AGE_MS || age < -5_000) {
      void clearRejoinSnapshot();
      return null;
    }
    return s as RejoinSnapshot;
  } catch {
    return null;
  }
}
