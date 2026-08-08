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
import * as ScreenCapture from "expo-screen-capture";

import { RELAY_APP_URL, isInternalUrl } from "./relay-config";
import { usePushToken } from "./use-push-token";

const COLORS = {
  navy: "#050608",
  surface: "#0E1117",
  indigo: "#4F46E5",
  cyan: "#22D3EE",
  foreground: "#F2F4F8",
  muted: "#8B93AD",
  border: "#1A1F2B",
};

const RELAY_LOGO = require("../assets/images/relay-logo.png");

/**
 * Native-capability handshake (QW-12).
 *
 * Set BEFORE the page's own JS runs so the web app can, from its first render,
 * tell it is inside the shell, which platform it is on, and which native-only
 * features this build can honour. The web app's "Block screenshots" toggle keys
 * its visibility off `capabilities.screenshotBlock`, so the switch only appears
 * on a build that can actually enforce it — never as a dead control on an older
 * shell or a desktop browser (where `__RELAY_NATIVE__` is simply undefined).
 *
 * `screenshotBlock` is advertised on Android only: FLAG_SECURE genuinely blocks
 * still screenshots, screen recording, and the app-switcher thumbnail there,
 * whereas iOS cannot block a still screenshot at all — so promising it on iOS
 * would be a lie the user could disprove in one tap.
 */
const NATIVE_BRIDGE_INJECTION = `(function () {
  try {
    window.__RELAY_NATIVE__ = {
      platform: ${JSON.stringify(Platform.OS)},
      capabilities: { screenshotBlock: ${Platform.OS === "android"} },
    };
  } catch (e) {}
  true;
})();`;

/**
 * Apply (or lift) the OS screen-capture block. On Android this flips FLAG_SECURE;
 * elsewhere the native module is a no-op, which is why the web app never shows the
 * toggle off Android. Fire-and-forget — a rejected promise (e.g. the Activity is
 * mid-teardown) must not surface as an unhandled rejection in the shell.
 */
function applyScreenshotBlock(enabled: boolean): void {
  void (enabled
    ? ScreenCapture.preventScreenCaptureAsync()
    : ScreenCapture.allowScreenCaptureAsync()
  ).catch(() => {});
}

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
  // A deep-link URL from a COLD-START notification tap, held until the WebView has
  // loaded the web app (and its nav bridge). Injected in onLoadEnd, not on a fixed
  // timer — the bridge queues it and flushes on ready, so there is nothing to race.
  const pendingNavUrl = useRef<string | null>(null);

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
    const full = /^https?:\/\//i.test(path)
      ? path
      : `${RELAY_APP_URL.replace(/\/app$/, "")}${path}`;
    // Prefer CLIENT-SIDE routing via the web app's nav bridge (nativeNavBridge.ts):
    // it routes WITHOUT reloading, so a tap lands on the exact conversation / call
    // history and keeps the session — an active call included, which it shrinks to
    // the mini-box. It QUEUES the request if the app is still booting and flushes it
    // on ready, so there is no cold-start timer to lose to. A hard `location.href`
    // is the fallback for a web app too old to define the hook — the reload that
    // used to be the ONLY path, and the reason a cold tap landed on the default tab.
    webViewRef.current?.injectJavaScript(
      `(function(){try{` +
        `if(window.__relayNavigate__){window.__relayNavigate__(${JSON.stringify(path)});}` +
        `else{window.location.href=${JSON.stringify(full)};}` +
        `}catch(e){window.location.href=${JSON.stringify(full)};}})();true;`,
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

  // Cold-start: app was launched from a killed state by tapping a notification.
  // Stash the URL and let onLoadEnd inject it once the web app (and its nav bridge)
  // has loaded — the bridge queues it and flushes when the router is live, which is
  // reliable where the old fixed 2.5s defer raced the boot and lost.
  useEffect(() => {
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      const url = response?.notification.request.content.data?.url as
        | string
        | undefined;
      if (url) pendingNavUrl.current = url;
    });
  }, []);

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
        const msg = JSON.parse(event.nativeEvent.data) as {
          type?: string;
          enabled?: unknown;
        };
        // The web app signals its bridge is ready — re-send the push token so
        // it isn't dropped if loadEnd fired before the listener attached.
        if (msg?.type === "RELAY_WEB_READY" || msg?.type === "web-ready") {
          sendPushTokenOnReady();
          return;
        }
        // QW-12: the web app's privacy toggle asks us to block (or allow) screen
        // capture. It only sends this on a platform we advertised the capability
        // for, and re-sends on every load because FLAG_SECURE resets per launch.
        if (msg?.type === "SET_SCREENSHOT_BLOCK") {
          applyScreenshotBlock(msg.enabled === true);
          return;
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
        // ── Native-capability handshake (set before page JS; QW-12) ───────
        injectedJavaScriptBeforeContentLoaded={NATIVE_BRIDGE_INJECTION}
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
          const wasFirstLoad = !firstLoadDone.current;
          finishFirstLoad();
          sendPushToken();
          // Cold-start deep link: the web app + its nav bridge are loaded now, so
          // route to the tapped conversation / call history. Only on the FIRST load
          // (the client-side nav bridge doesn't reload, so this won't re-fire).
          if (wasFirstLoad && pendingNavUrl.current) {
            const url = pendingNavUrl.current;
            pendingNavUrl.current = null;
            navigateToUrl(url);
          }
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
