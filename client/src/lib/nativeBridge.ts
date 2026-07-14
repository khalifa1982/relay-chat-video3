/**
 * Bridge to the NATIVE Android app (mobile/app — Capacitor shell, v2.86).
 *
 * When the web app runs inside the native shell, `window.Capacitor` exposes
 * the custom plugins registered in MainActivity:
 *   CallAudio  — real AudioManager speakerphone/earpiece routing
 *   CallNative — ongoing-call foreground service, POST_NOTIFICATIONS
 *                permission, FCM device token
 *
 * Every helper is a safe no-op (or returns false/null) in a plain browser,
 * in the TWA, and on iOS — callers can use them unconditionally.
 */

type CapPlugin = Record<string, (options?: unknown) => Promise<Record<string, unknown>>>;

interface CapacitorGlobal {
  getPlatform?: () => string;
  isNativePlatform?: () => boolean;
  Plugins?: Record<string, CapPlugin>;
}

function cap(): CapacitorGlobal | null {
  if (typeof window === "undefined") return null;
  return ((window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor) ?? null;
}

export function isNativeAndroid(): boolean {
  try {
    const c = cap();
    return !!c && c.getPlatform?.() === "android" && c.isNativePlatform?.() === true;
  } catch {
    return false;
  }
}

function plugin(name: string): CapPlugin | null {
  try {
    return cap()?.Plugins?.[name] ?? null;
  } catch {
    return null;
  }
}

/** OS speakerphone toggle. Returns true only if the native route handled it. */
export async function nativeSetSpeaker(on: boolean): Promise<boolean> {
  if (!isNativeAndroid()) return false;
  const p = plugin("CallAudio");
  if (!p?.setSpeaker) return false;
  try {
    await p.setSpeaker({ on });
    return true;
  } catch {
    return false;
  }
}

/**
 * Enter/leave native call mode: AudioManager communication mode + the
 * ongoing-call foreground service (so Android never freezes a live call).
 */
export async function nativeSetInCall(active: boolean, title?: string): Promise<void> {
  if (!isNativeAndroid()) return;
  const audio = plugin("CallAudio");
  const nat = plugin("CallNative");
  try { await audio?.setInCall?.({ active }); } catch { /* best-effort */ }
  try {
    if (active) await nat?.startCallService?.({ title: title ?? "RELAY call" });
    else await nat?.stopCallService?.({});
  } catch { /* best-effort */ }
}

/** Android 13+ notification permission (needed for the FCM ring). */
export async function nativeEnsureNotifPermission(): Promise<void> {
  if (!isNativeAndroid()) return;
  try { await plugin("CallNative")?.ensureNotificationPermission?.({}); } catch { /* */ }
}

/** FCM device token, or null (plain browser / Firebase not configured yet). */
export async function nativeGetPushToken(): Promise<string | null> {
  if (!isNativeAndroid()) return null;
  const p = plugin("CallNative");
  if (!p?.getPushToken) return null;
  try {
    const r = await p.getPushToken({});
    const t = r?.token;
    return typeof t === "string" && t.length > 0 ? t : null;
  } catch {
    return null;
  }
}
