import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, type AppStateStatus, Platform } from "react-native";
import * as Notifications from "expo-notifications";
import type { WebView } from "react-native-webview";

/**
 * Registers the native device push token (APNs on iOS, FCM on Android) and
 * delivers it to the WebView via postMessage so the web app can register it
 * with its server.
 *
 * Wire format:
 *   { type: "SET_PUSH_TOKEN", token: "<device_token>", kind: "apns" | "fcm" }
 *
 * The web app at your-chat.io listens for this and POSTs to the server,
 * which stores it under push_subscriptions so incoming-call / message pushes
 * can reach this device.
 */
export function usePushToken(webViewRef: React.RefObject<WebView | null>) {
  const [token, setToken] = useState<string | null>(null);
  const [kind, setKind] = useState<"apns" | "fcm">("apns");

  const sendToWebView = useCallback(
    (pushToken: string, tokenKind: "apns" | "fcm") => {
      webViewRef.current?.postMessage(
        JSON.stringify({ type: "SET_PUSH_TOKEN", token: pushToken, kind: tokenKind }),
      );
    },
    [webViewRef],
  );

  const register = useCallback(async () => {
    try {
      // Request permission (iOS asks the user; Android 13+ needs it too)
      const { status: existing } = await Notifications.getPermissionsAsync();
      let finalStatus = existing;
      if (existing !== "granted") {
        const { status } = await Notifications.requestPermissionsAsync({
          ios: { allowAlert: true, allowBadge: true, allowSound: true },
        });
        finalStatus = status;
      }
      if (finalStatus !== "granted") return null;

      // getDevicePushTokenAsync returns the FCM token on Android and the
      // raw APNs hex token on iOS.
      const tokenData = await Notifications.getDevicePushTokenAsync();
      const pushToken = tokenData.data as string;
      const tokenKind = Platform.OS === "ios" ? "apns" : "fcm";
      setToken(pushToken);
      setKind(tokenKind);
      return { pushToken, tokenKind };
    } catch {
      return null;
    }
  }, []);

  // Register on mount and send to WebView immediately
  useEffect(() => {
    void register().then((result) => {
      if (result) sendToWebView(result.pushToken, result.tokenKind);
    });
  }, [register, sendToWebView]);

  // Re-send on app resume so a WebView reload during background doesn't
  // miss its token.
  useEffect(() => {
    const onChange = (state: AppStateStatus) => {
      if (state === "active" && token) sendToWebView(token, kind);
    };
    const sub = AppState.addEventListener("change", onChange);
    return () => sub.remove();
  }, [token, kind, sendToWebView]);

  /** Called after every WebView loadEnd — re-sends the token in case the
   *  page reloaded and missed the previous postMessage. */
  const onWebViewLoadEnd = useCallback(() => {
    if (token) sendToWebView(token, kind);
  }, [token, kind, sendToWebView]);

  /**
   * Called when the web app fires its RELAY_WEB_READY handshake, meaning its
   * JS bridge is now listening. Re-send (or request) the token so it isn't
   * dropped even if loadEnd fired before the listener attached.
   */
  const onWebReady = useCallback(() => {
    if (token) {
      sendToWebView(token, kind);
    } else {
      void register().then((result) => {
        if (result) sendToWebView(result.pushToken, result.tokenKind);
      });
    }
  }, [token, kind, sendToWebView, register]);

  return { token, onWebViewLoadEnd, onWebReady };
}
