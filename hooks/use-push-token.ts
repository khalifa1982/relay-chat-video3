import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, type AppStateStatus, Platform } from "react-native";
import * as Notifications from "expo-notifications";
import type { WebView } from "react-native-webview";

import { pushTokenJs, type PushTokenKind } from "@/lib/native-bridge";

// On iOS the VoIP (PushKit) token is handled by lib/voip-call-manager.ts —
// that is the one that rings through CallKit. This hook handles the ORDINARY
// device token: FCM on Android, the APNs alert token on iOS.

/**
 * Deliver the native device push token to the page, so the web app can register
 * it against the signed-in account and the server can wake this device for an
 * incoming call while the app is closed.
 *
 * ── WHY THIS IS NOT `webViewRef.postMessage` ─────────────────────────────────
 * It used to be, and on Android that meant the token never arrived at all.
 * `WebView.postMessage` on Android builds a MessageEvent and dispatches it on
 * `document`; MessageEvent does not bubble, so a `window` listener never fires.
 * On iOS the same call dispatches on `window`. The page listens on `window` —
 * that is what the push spec asks for and what the iPhone shell's own token
 * path already uses — so Android silently registered nothing and ring-when-closed
 * was dead on every Android handset. `injectJavaScript` is the same channel the
 * VoIP manager already uses successfully, and it behaves identically on both
 * platforms.
 *
 * ── WHY IT IS SENT MORE THAN ONCE ────────────────────────────────────────────
 * There is no handshake available: the page's "I am ready" signal is a
 * same-window `postMessage`, which cannot reach native. So delivery is a race
 * against the web bundle mounting its listener, and losing that race is
 * invisible. The page de-duplicates by (kind, token) and only writes to the
 * server on a change, so re-sending is free; not re-sending costs the user
 * their calls.
 */

/** Offsets from a delivery trigger, in ms. The page ignores the duplicates. */
const DELIVERY_SCHEDULE_MS = [0, 1_500, 4_000, 10_000] as const;

function kindForPlatform(): PushTokenKind {
  return Platform.OS === "ios" ? "apns" : "fcm";
}

export function usePushToken(webViewRef: React.RefObject<WebView | null>) {
  const [token, setToken] = useState<string | null>(null);
  // Read by the delivery timers, which must see the CURRENT token rather than
  // the one captured when they were scheduled (a rotation mid-schedule would
  // otherwise keep re-sending the dead one).
  const tokenRef = useRef<string | null>(null);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const cancelPending = useCallback(() => {
    for (const t of timersRef.current) clearTimeout(t);
    timersRef.current = [];
  }, []);

  const injectNow = useCallback(() => {
    const t = tokenRef.current;
    if (!t || !webViewRef.current) return;
    webViewRef.current.injectJavaScript(pushTokenJs(t, kindForPlatform()));
  }, [webViewRef]);

  /** Send now and again a few times, replacing any schedule already running. */
  const deliver = useCallback(() => {
    if (!tokenRef.current) return;
    cancelPending();
    for (const delay of DELIVERY_SCHEDULE_MS) {
      if (delay === 0) {
        injectNow();
        continue;
      }
      timersRef.current.push(setTimeout(injectNow, delay));
    }
  }, [cancelPending, injectNow]);

  const adopt = useCallback(
    (next: string | null) => {
      if (!next || next === tokenRef.current) return;
      tokenRef.current = next;
      setToken(next);
      deliver();
    },
    [deliver],
  );

  const registerForPush = useCallback(async () => {
    try {
      const { status: existing } = await Notifications.getPermissionsAsync();
      let finalStatus = existing;
      if (existing !== "granted") {
        const { status } = await Notifications.requestPermissionsAsync({
          ios: { allowAlert: true, allowBadge: true, allowSound: true },
        });
        finalStatus = status;
      }
      if (finalStatus !== "granted") return null;

      // The native device token: FCM on Android, APNs on iOS.
      const tokenData = await Notifications.getDevicePushTokenAsync();
      adopt(tokenData.data);
      return tokenData.data;
    } catch {
      return null;
    }
  }, [adopt]);

  // Register on mount.
  useEffect(() => {
    void registerForPush();
  }, [registerForPush]);

  /**
   * A push token is not permanent. FCM reissues on app data restore, on some
   * reinstalls and when Google rotates it; APNs reissues on restore too. The
   * old token then silently stops delivering, which looks exactly like "the app
   * stopped ringing for no reason". This is the only notification of that.
   */
  useEffect(() => {
    const sub = Notifications.addPushTokenListener((t) => {
      if (typeof t?.data === "string") adopt(t.data);
    });
    return () => sub.remove();
  }, [adopt]);

  // Re-deliver on foreground: the WebView may have been reloaded while away.
  useEffect(() => {
    const onChange = (state: AppStateStatus) => {
      if (state === "active") deliver();
    };
    const sub = AppState.addEventListener("change", onChange);
    return () => sub.remove();
  }, [deliver]);

  useEffect(() => cancelPending, [cancelPending]);

  /** Called when the WebView finishes loading — the page is new, send again. */
  const onWebViewLoadEnd = useCallback(() => {
    deliver();
  }, [deliver]);

  return { token, onWebViewLoadEnd, registerForPush };
}
