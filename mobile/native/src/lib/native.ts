/**
 * Safe wrappers around the CallNative Android module (M4). Every call is a
 * no-op on iOS / when the module is missing, so the JS engine never branches
 * on platform — it just calls these unconditionally.
 *
 *  - startCallService / stopCallService: ongoing-call FOREGROUND SERVICE so
 *    Android never freezes a backgrounded live call.
 *  - ensureNotificationPermission: POST_NOTIFICATIONS runtime ask (13+).
 *  - getPushToken: the FCM device token (null until Firebase is configured —
 *    google-services.json; see mobile/README.md).
 *  - cancelRing: dismiss the native lock-screen ring once JS shows its own.
 */
import { NativeModules, Platform } from "react-native";

type CallNativeType = {
  startCallService(title: string | null): Promise<void>;
  stopCallService(): Promise<void>;
  cancelRing(): Promise<void>;
  ensureNotificationPermission(): Promise<{ granted: boolean }>;
  getPushToken(): Promise<{ token: string | null; reason?: string }>;
};

const mod: CallNativeType | null =
  Platform.OS === "android" && NativeModules.CallNative
    ? (NativeModules.CallNative as CallNativeType)
    : null;

export function nativeStartCallService(title?: string): void {
  void mod?.startCallService(title ?? null).catch(() => {});
}

export function nativeStopCallService(): void {
  void mod?.stopCallService().catch(() => {});
}

export function nativeCancelRing(): void {
  void mod?.cancelRing().catch(() => {});
}

export async function nativeEnsureNotificationPermission(): Promise<boolean> {
  if (!mod) return true;
  try {
    return (await mod.ensureNotificationPermission()).granted;
  } catch {
    return false;
  }
}

export async function nativeGetPushToken(): Promise<string | null> {
  if (!mod) return null;
  try {
    return (await mod.getPushToken()).token ?? null;
  } catch {
    return null;
  }
}
