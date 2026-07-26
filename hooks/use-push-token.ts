import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, type AppStateStatus, Platform } from "react-native";
import * as Notifications from "expo-notifications";
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

      // Get the native device push token (APNs on iOS, FCM on Android)
      const tokenData = await Notifications.getDevicePushTokenAsync();
      const pushToken = tokenData.data;
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

  return { token, onWebViewLoadEnd, registerForPush };
}
