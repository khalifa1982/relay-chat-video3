import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  BackHandler,
  Image,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { WebView } from "react-native-webview";
import type { WebViewMessageEvent, WebViewNavigation } from "react-native-webview";
import type { WebViewErrorEvent } from "react-native-webview/lib/WebViewTypes";
import * as Notifications from "expo-notifications";

import { RELAY_APP_URL, isInternalUrl } from "@/lib/relay-config";
import { usePushToken } from "@/hooks/use-push-token";

const COLORS = {
  navy: "#050608",
  surface: "#0E1117",
  indigo: "#4F46E5",
  cyan: "#22D3EE",
  foreground: "#F2F4F8",
  muted: "#8B93AD",
  border: "#1A1F2B",
};

const RELAY_LOGO = require("@/assets/images/relay-logo.png");

/**
 * RelayWebView — thin WebView shell.
 *
 * Responsibilities:
 *  • Render your-chat.io full-screen with branded loading / error screens.
 *  • Register the native push token (APNs / FCM) and deliver it to the web
 *    app so the server can reach this device for incoming calls and messages.
 *  • Route notification taps into the correct web-app screen (/app/dialer etc).
 *  • Route external links to the system browser.
 *  • Android hardware-back through web history.
 *
 * NOT here: CallKit, VoIP push, ringtones, call state, APK updater. All call
 * and message UI lives in the web app.
 */
export function RelayWebView() {
  const webViewRef = useRef<WebView>(null);

  const [loading, setLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const firstLoadDone = useRef(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canGoBack = useRef(false);

  // Push token registration
  const { onWebViewLoadEnd: sendPushToken, onWebReady: sendPushTokenOnReady } =
    usePushToken(webViewRef);

  // ─── Loading splash safety net ───────────────────────────────────────────
  useEffect(() => {
    timeoutRef.current = setTimeout(() => {
      firstLoadDone.current = true;
      setLoading(false);
    }, 12_000);
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const finishFirstLoad = useCallback(() => {
    firstLoadDone.current = true;
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setLoading(false);
  }, []);

  // ─── Notification URL navigation ─────────────────────────────────────────
  const navigateToUrl = useCallback((path: string) => {
    // path may be "/app/dialer" or a full URL
    const target = /^https?:\/\//i.test(path)
      ? path
      : `${RELAY_APP_URL.replace(/\/app$/, "")}${path}`;
    webViewRef.current?.injectJavaScript(
      `window.location.href = ${JSON.stringify(target)}; true;`,
    );
  }, []);

  // App foregrounded by tapping a notification (background → foreground)
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const url = response.notification.request.content.data?.url as
          | string
          | undefined;
        if (url) navigateToUrl(url);
      },
    );
    return () => sub.remove();
  }, [navigateToUrl]);

  // Cold-start: app was launched from a killed state by tapping a notification
  useEffect(() => {
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      const url = response?.notification.request.content.data?.url as
        | string
        | undefined;
      if (url) {
        // Defer until the WebView has finished loading and the user is auth'd
        const timer = setTimeout(() => navigateToUrl(url), 2_500);
        return () => clearTimeout(timer);
      }
    });
  }, [navigateToUrl]);

  // ─── Android hardware back ────────────────────────────────────────────────
  useEffect(() => {
    if (Platform.OS !== "android") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (canGoBack.current && webViewRef.current) {
        webViewRef.current.goBack();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, []);

  // ─── Handlers ────────────────────────────────────────────────────────────
  const handleNavState = useCallback((nav: WebViewNavigation) => {
    canGoBack.current = nav.canGoBack;
  }, []);

  const handleShouldLoad = useCallback((req: WebViewNavigation) => {
    const { url } = req;
    if (isInternalUrl(url)) return true;
    if (/^(mailto:|tel:|sms:)/i.test(url)) {
      Linking.openURL(url).catch(() => {});
      return false;
    }
    if (/^https?:/i.test(url)) {
      Linking.openURL(url).catch(() => {});
      return false;
    }
    return true;
  }, []);

  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      try {
        const msg = JSON.parse(event.nativeEvent.data) as { type?: string };
        // The web app signals its bridge is ready — re-send the push token so
        // it isn't dropped if loadEnd fired before the listener attached.
        if (msg?.type === "RELAY_WEB_READY" || msg?.type === "web-ready") {
          sendPushTokenOnReady();
        }
      } catch {
        // Non-JSON or irrelevant message; ignore.
      }
    },
    [sendPushTokenOnReady],
  );

  const handleError = useCallback(
    (_event: WebViewErrorEvent) => {
      setHasError(true);
      finishFirstLoad();
    },
    [finishFirstLoad],
  );

  const reload = useCallback(() => {
    setHasError(false);
    firstLoadDone.current = false;
    setLoading(true);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      firstLoadDone.current = true;
      setLoading(false);
    }, 12_000);
    webViewRef.current?.reload();
  }, []);

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <View style={styles.container}>
      <WebView
        ref={webViewRef}
        source={{ uri: RELAY_APP_URL }}
        style={styles.webview}
        // ── Media / WebRTC ────────────────────────────────────────────────
        mediaCapturePermissionGrantType="grant"
        allowsInlineMediaPlayback
        allowsPictureInPictureMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        allowsProtectedMedia
        // ── Storage / session (persist login + cache across launches) ─────
        domStorageEnabled
        javaScriptEnabled
        cacheEnabled
        cacheMode="LOAD_DEFAULT"
        incognito={false}
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        // ── UX ────────────────────────────────────────────────────────────
        pullToRefreshEnabled
        allowsBackForwardNavigationGestures
        startInLoadingState={false}
        originWhitelist={["*"]}
        setSupportMultipleWindows={false}
        // ── Events ────────────────────────────────────────────────────────
        onLoadStart={() => {
          if (!firstLoadDone.current) setLoading(true);
        }}
        onLoadEnd={() => {
          finishFirstLoad();
          sendPushToken();
        }}
        onError={handleError}
        onHttpError={() => {}}
        onNavigationStateChange={handleNavState}
        onShouldStartLoadWithRequest={handleShouldLoad}
        onMessage={handleMessage}
      />

      {/* First-load splash */}
      {loading && !hasError && (
        <View style={styles.overlay} pointerEvents="none">
          <Image source={RELAY_LOGO} style={styles.logo} resizeMode="contain" />
          <Text style={styles.brand}>RELAY</Text>
          <Text style={styles.tagline}>Voice · Video · Chat</Text>
          <ActivityIndicator size="large" color={COLORS.cyan} style={styles.spinner} />
        </View>
      )}

      {/* Error / offline screen */}
      {hasError && (
        <View style={styles.errorOverlay}>
          <Image source={RELAY_LOGO} style={styles.logo} resizeMode="contain" />
          <Text style={styles.brand}>RELAY</Text>
          <View style={styles.errorCard}>
            <Text style={styles.errorTitle}>Can't reach RELAY</Text>
            <Text style={styles.errorBody}>
              Check your internet connection and try again.
            </Text>
            <Pressable
              style={({ pressed }) => [
                styles.retryButton,
                pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] },
              ]}
              onPress={reload}
              accessibilityRole="button"
            >
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.navy },
  webview: { flex: 1, backgroundColor: COLORS.navy },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: COLORS.navy,
    alignItems: "center",
    justifyContent: "center",
  },
  errorOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: COLORS.navy,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  logo: { width: 96, height: 96 },
  brand: {
    marginTop: 12,
    color: COLORS.foreground,
    fontSize: 26,
    fontWeight: "800",
    letterSpacing: 4,
  },
  tagline: {
    marginTop: 6,
    color: COLORS.muted,
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: 1,
  },
  spinner: { marginTop: 28 },
  errorCard: {
    marginTop: 28,
    width: "100%",
    maxWidth: 360,
    backgroundColor: COLORS.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 24,
    alignItems: "center",
  },
  errorTitle: { color: COLORS.foreground, fontSize: 18, fontWeight: "700" },
  errorBody: {
    color: COLORS.muted,
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
    marginTop: 8,
  },
  retryButton: {
    marginTop: 20,
    backgroundColor: COLORS.indigo,
    paddingVertical: 12,
    paddingHorizontal: 40,
    borderRadius: 999,
  },
  retryText: { color: "#FFFFFF", fontSize: 15, fontWeight: "700" },
});
