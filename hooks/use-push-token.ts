import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, type AppStateStatus, Platform } from "react-native";
import * as Notifications from "expo-notifications";
import type { WebView } from "react-native-webview";

// On iOS, VoIP push token is handled by the voip-call-manager module
// (PushKit → native AppDelegate → JS bridge → WebView CustomEvent).
// This hook still handles the regular APNs device token for Android (FCM)
// and as a fallback for non-VoIP notifications on iOS.

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

  /**
   * Re-send in response to the web app announcing its bridge is LISTENING.
   *
   * `onWebViewLoadEnd` is not sufficient on its own: the document can finish
   * loading before RELAY attaches its listener in a React effect, so a token
   * posted then is dropped with nothing reporting it. This is the acknowledged
   * handshake — the web side has posted RELAY_WEB_READY since v2.99.79.
   *
   * DELIBERATELY NOT the Expo-token change from PR #96: iOS now gets a real FCM
   * registration token natively (Round 29, Firebase MessagingDelegate -> the
   * relay:native CustomEvent), so also fetching an Expo token here would give one
   * handset TWO distinct tokens. Subscriptions are keyed per token and
   * sendPushToIdentity fans out to every row, so that is a duplicate
   * notification for every message, not a fallback.
   */
  const onWebReady = useCallback(() => {
    if (token) sendTokenToWebView(token);
    // A token we never obtained (permission granted late, or a transient failure
    // on mount) is worth one more attempt now that we know the far side is up.
    else
      void registerForPush().then((t) => {
        if (t) sendTokenToWebView(t);
      });
  }, [token, sendTokenToWebView, registerForPush]);

  return { token, onWebViewLoadEnd, onWebReady, registerForPush };
}
