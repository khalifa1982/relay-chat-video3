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
import type {
  WebViewMessageEvent,
  WebViewNavigation,
} from "react-native-webview";
import type { WebViewErrorEvent } from "react-native-webview/lib/WebViewTypes";

import { RELAY_APP_URL, isInternalUrl } from "@/lib/relay-config";
import { reconcileVersion } from "@/lib/version-watch";

const COLORS = {
  navy: "#0B1020",
  surface: "#11182B",
  indigo: "#4F46E5",
  cyan: "#06B6D4",
  foreground: "#E5E9F5",
  muted: "#8B93AD",
  border: "#1E2742",
};

const RELAY_LOGO = require("@/assets/images/relay-logo.png");

/**
 * Injected into the web app to watch its footer version string (e.g. "v2.51.0")
 * and report it to native. When the deployed web version changes while the app
 * is open, native shows a lightweight "reload" prompt so users get the freshest
 * web content immediately. Must be self-contained and end with `true;`.
 */
const VERSION_WATCH_JS = `(() => {
  try {
    if (window.__relayVersionWatch) return;
    window.__relayVersionWatch = true;
    var post = function (v) {
      try {
        window.ReactNativeWebView &&
          window.ReactNativeWebView.postMessage(
            JSON.stringify({ type: 'relay-version', version: v })
          );
      } catch (e) {}
    };
    var read = function () {
      var m = (document.body && document.body.innerText || '').match(/v\\d+\\.\\d+\\.\\d+/);
      return m ? m[0] : null;
    };
    var report = function () { var v = read(); if (v) post(v); };
    report();
    setInterval(report, 60000);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') report();
    });
  } catch (e) {}
})();
true;`;

/**
 * RelayWebView renders the RELAY web app inside a native WebView and adds the
 * shell chrome: a branded loading overlay until first paint, an offline / load
 * error screen with retry, Android hardware-back navigation through web
 * history, and routing of external links to the system browser.
 */
export function RelayWebView() {
  const webViewRef = useRef<WebView>(null);
  // `loading` only controls the FIRST-load splash overlay. Subsequent in-app
  // (SPA) navigations must never re-show a full-screen overlay, otherwise the
  // spinner can get stuck covering an already-rendered page.
  const [loading, setLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const canGoBackRef = useRef(false);
  const firstLoadDoneRef = useRef(false);
  const loadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Safety net: never let the first-load splash hang forever. If the first
  // load has not reported completion within 12s, dismiss the overlay anyway.
  useEffect(() => {
    loadTimeoutRef.current = setTimeout(() => {
      firstLoadDoneRef.current = true;
      setLoading(false);
    }, 12000);
    return () => {
      if (loadTimeoutRef.current) clearTimeout(loadTimeoutRef.current);
    };
  }, []);

  const finishFirstLoad = useCallback(() => {
    firstLoadDoneRef.current = true;
    if (loadTimeoutRef.current) {
      clearTimeout(loadTimeoutRef.current);
      loadTimeoutRef.current = null;
    }
    setLoading(false);
  }, []);

  // Android hardware back button -> navigate WebView history when possible.
  useEffect(() => {
    if (Platform.OS !== "android") return;
    const onBackPress = () => {
      if (canGoBackRef.current && webViewRef.current) {
        webViewRef.current.goBack();
        return true; // handled
      }
      return false; // let the OS handle (exit app)
    };
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      onBackPress,
    );
    return () => subscription.remove();
  }, []);

  const handleNavStateChange = useCallback((nav: WebViewNavigation) => {
    canGoBackRef.current = nav.canGoBack;
  }, []);

  // --- Web-content version change detection ---
  const [webUpdateAvailable, setWebUpdateAvailable] = useState(false);
  const webVersionRef = useRef<string | null>(null);

  const handleVersion = useCallback((version: string) => {
    const { next, shouldPromptReload } = reconcileVersion(
      webVersionRef.current,
      version,
    );
    webVersionRef.current = next;
    if (shouldPromptReload) setWebUpdateAvailable(true);
  }, []);

  const reloadWebContent = useCallback(() => {
    setWebUpdateAvailable(false);
    webViewRef.current?.reload();
  }, []);

  const reload = useCallback(() => {
    setHasError(false);
    firstLoadDoneRef.current = false;
    setLoading(true);
    if (loadTimeoutRef.current) clearTimeout(loadTimeoutRef.current);
    loadTimeoutRef.current = setTimeout(() => {
      firstLoadDoneRef.current = true;
      setLoading(false);
    }, 12000);
    webViewRef.current?.reload();
  }, []);

  const handleError = useCallback((_event: WebViewErrorEvent) => {
    setHasError(true);
    finishFirstLoad();
  }, [finishFirstLoad]);

  // Route ONLY genuinely external links to the system browser. Everything on
  // the RELAY site (including all /app/* sub-routes) stays inside the WebView.
  const handleShouldStartLoad = useCallback((req: WebViewNavigation) => {
    const url = req.url;
    // Keep all internal RELAY navigation in the WebView.
    if (isInternalUrl(url)) return true;
    // mailto/tel/sms always go to the native handler.
    if (/^(mailto:|tel:|sms:)/i.test(url)) {
      Linking.openURL(url).catch(() => {});
      return false;
    }
    // External http(s) links open in the system browser.
    if (/^https?:/i.test(url)) {
      Linking.openURL(url).catch(() => {});
      return false;
    }
    // Anything else (custom schemes, etc.) — let the WebView decide.
    return true;
  }, []);

  // Receive messages from the injected version watcher.
  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      try {
        const data = JSON.parse(event.nativeEvent.data);
        if (data && data.type === "relay-version" && data.version) {
          handleVersion(String(data.version));
        }
      } catch {
        // Ignore non-JSON messages.
      }
    },
    [handleVersion],
  );

  return (
    <View style={styles.container}>
      <WebView
        ref={webViewRef}
        source={{ uri: RELAY_APP_URL }}
        style={styles.webview}
        // --- Media / WebRTC ---
        mediaCapturePermissionGrantType="grant"
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        allowsProtectedMedia
        // --- Storage / cookies so the guest identity persists ---
        domStorageEnabled
        javaScriptEnabled
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        // --- UX ---
        pullToRefreshEnabled
        allowsBackForwardNavigationGestures
        startInLoadingState={false}
        originWhitelist={["*"]}
        setSupportMultipleWindows={false}
        // Only show the splash on the very first load. Do NOT toggle `loading`
        // back on for subsequent SPA navigations — that is what made other tabs
        // appear stuck on an endless spinner.
        onLoadStart={() => {
          if (!firstLoadDoneRef.current) setLoading(true);
        }}
        onLoadEnd={finishFirstLoad}
        onError={handleError}
        onHttpError={() => {}}
        onNavigationStateChange={handleNavStateChange}
        onShouldStartLoadWithRequest={handleShouldStartLoad}
        onMessage={handleMessage}
        injectedJavaScript={VERSION_WATCH_JS}
      />

      {webUpdateAvailable && !loading && !hasError ? (
        <View style={styles.webUpdateWrap}>
          <View style={styles.webUpdateBanner}>
            <Text style={styles.webUpdateText}>
              RELAY was updated. Reload for the latest.
            </Text>
            <Pressable
              onPress={reloadWebContent}
              style={({ pressed }) => [
                styles.webUpdateButton,
                pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] },
              ]}
              accessibilityRole="button"
            >
              <Text style={styles.webUpdateButtonText}>Reload</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {loading && !hasError ? (
        <View style={styles.overlay} pointerEvents="none">
          <Image source={RELAY_LOGO} style={styles.logo} resizeMode="contain" />
          <Text style={styles.brand}>RELAY</Text>
          <ActivityIndicator
            size="large"
            color={COLORS.cyan}
            style={styles.spinner}
          />
        </View>
      ) : null}

      {hasError ? (
        <View style={styles.errorOverlay}>
          <Image source={RELAY_LOGO} style={styles.logo} resizeMode="contain" />
          <Text style={styles.brand}>RELAY</Text>
          <View style={styles.errorCard}>
            <Text style={styles.errorTitle}>Can&apos;t reach RELAY</Text>
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
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.navy,
  },
  webview: {
    flex: 1,
    backgroundColor: COLORS.navy,
  },
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
  logo: {
    width: 96,
    height: 96,
  },
  brand: {
    marginTop: 12,
    color: COLORS.foreground,
    fontSize: 26,
    fontWeight: "800",
    letterSpacing: 4,
  },
  spinner: {
    marginTop: 28,
  },
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
  errorTitle: {
    color: COLORS.foreground,
    fontSize: 18,
    fontWeight: "700",
  },
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
  retryText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
  },
  webUpdateWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  webUpdateBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 16,
    maxWidth: 460,
    width: "100%",
  },
  webUpdateText: {
    color: COLORS.foreground,
    fontSize: 13,
    fontWeight: "600",
    flexShrink: 1,
  },
  webUpdateButton: {
    marginLeft: "auto",
    backgroundColor: COLORS.cyan,
    paddingVertical: 8,
    paddingHorizontal: 18,
    borderRadius: 999,
  },
  webUpdateButtonText: {
    color: "#04121A",
    fontSize: 13,
    fontWeight: "800",
  },
});
