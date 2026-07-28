import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, type AppStateStatus, Platform } from "react-native";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import type { WebView } from "react-native-webview";

/**
 * Manages the native device push token (FCM on Android, APNs on iOS) and
 * injects it into the WebView so the web app can register it with its server
 * for server-initiated push notifications (incoming calls when app is closed).
 *
 * The token is sent to the WebView via postMessage as:
 *   { type: "SET_PUSH_TOKEN", token: "<device_push_token>" }
 *
 * The web app at your-chat.io/app should listen for this message and send the
 * token to its backend for storage.
 */
export function usePushToken(webViewRef: React.RefObject<WebView | null>) {
  const [token, setToken] = useState<string | null>(null);
  const tokenSentRef = useRef(false);

  const sendTokenToWebView = useCallback(
    (pushToken: string) => {
      if (webViewRef.current) {
        const message = JSON.stringify({
          type: "SET_PUSH_TOKEN",
          token: pushToken,
        });
        webViewRef.current.postMessage(message);
        tokenSentRef.current = true;
      }
    },
    [webViewRef],
  );

  const registerForPush = useCallback(async () => {
    try {
      // Check/request permission
      const { status: existing } = await Notifications.getPermissionsAsync();
      let finalStatus = existing;
      if (existing !== "granted") {
        const { status } = await Notifications.requestPermissionsAsync({
          ios: { allowAlert: true, allowBadge: true, allowSound: true },
        });
        finalStatus = status;
      }
      if (finalStatus !== "granted") return null;

      // PREFER THE EXPO PUSH TOKEN, AND THE REASON IS THAT APNs IS NOT FCM.
      //
      // `getDevicePushTokenAsync()` returns an FCM registration token on Android but an
      // APNs device token on iOS. RELAY's server sends native pushes through FCM v1
      // `messages:send`, which requires an FCM REGISTRATION token — handed a raw APNs
      // token it answers 400/404, and the sender reads that as a stale token and DELETES
      // the subscription. So an iPhone was silently deregistered on its very first push.
      //
      // An Expo push token (`ExponentPushToken[…]`) is delivered by Expo's own service,
      // which holds the APNs key uploaded to EAS, and RELAY has had the matching
      // transport since v2.99.79. It is routable on BOTH platforms.
      //
      // GUARDED, because `getExpoPushTokenAsync` THROWS when no EAS projectId is
      // configured — and it is not configured in app.config.ts today. Falling back keeps
      // Android working exactly as before rather than trading one broken platform for two.
      let pushToken: string | null = null;
      try {
        const projectId =
          (Constants?.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas
            ?.projectId ?? (Constants as { easConfig?: { projectId?: string } })?.easConfig?.projectId;
        if (projectId) {
          const expoToken = await Notifications.getExpoPushTokenAsync({ projectId });
          if (expoToken?.data) pushToken = expoToken.data;
        }
      } catch {
        /* no EAS project, or Expo's service unreachable — fall through */
      }
      if (!pushToken) {
        // On Android this is an FCM registration token and fully routable. On iOS it is
        // an APNs token, which RELAY now stores as kind "apns": not deliverable, but
        // visible in the admin push doctor so the cause is diagnosable rather than silent.
        const tokenData = await Notifications.getDevicePushTokenAsync();
        pushToken = tokenData.data;
      }
      setToken(pushToken);
      return pushToken;
    } catch {
      return null;
    }
  }, []);

  // Register on mount
  useEffect(() => {
    void registerForPush().then((t) => {
      if (t) sendTokenToWebView(t);
    });
  }, [registerForPush, sendTokenToWebView]);

  // Re-send token on app resume (in case WebView reloaded)
  useEffect(() => {
    const onChange = (state: AppStateStatus) => {
      if (state === "active" && token) {
        sendTokenToWebView(token);
      }
    };
    const sub = AppState.addEventListener("change", onChange);
    return () => sub.remove();
  }, [token, sendTokenToWebView]);

  // Called when WebView finishes loading — send the token again
  const onWebViewLoadEnd = useCallback(() => {
    if (token) {
      sendTokenToWebView(token);
    }
  }, [token, sendTokenToWebView]);

  /**
   * Re-send in response to the web app announcing it is listening.
   *
   * `onWebViewLoadEnd` is not sufficient on its own: the document can finish loading
   * before RELAY's bridge attaches its listener in a React effect, so a token posted
   * then is dropped with nothing reporting it. This is the acknowledged handshake.
   */
  const onWebReady = useCallback(() => {
    if (token) sendTokenToWebView(token);
    // A token we never obtained (permission granted late, or a transient failure on
    // mount) is worth one more attempt now that we know the other side is up.
    else void registerForPush().then((t) => { if (t) sendTokenToWebView(t); });
  }, [token, sendTokenToWebView, registerForPush]);

  return { token, onWebViewLoadEnd, onWebReady, registerForPush };
}
