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
 * RelayWebView renders the RELAY web app inside a native WebView and adds the
 * shell chrome: a branded loading overlay until first paint, an offline / load
 * error screen with retry, Android hardware-back navigation through web
 * history, and routing of external links to the system browser.
 */
export function RelayWebView() {
  const webViewRef = useRef<WebView>(null);
  const [loading, setLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const canGoBackRef = useRef(false);

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

  const reload = useCallback(() => {
    setHasError(false);
    setLoading(true);
    webViewRef.current?.reload();
  }, []);

  const handleError = useCallback((_event: WebViewErrorEvent) => {
    setHasError(true);
    setLoading(false);
  }, []);

  // Route external (non-RELAY) links to the system browser / native handler.
  const handleShouldStartLoad = useCallback((req: WebViewNavigation) => {
    const url = req.url;
    if (isInternalUrl(url)) return true;
    if (/^(https?:|mailto:|tel:|sms:)/i.test(url)) {
      Linking.openURL(url).catch(() => {});
      return false;
    }
    return true;
  }, []);

  // Keep a no-op message bridge available for future web<->native messaging.
  const handleMessage = useCallback((_event: WebViewMessageEvent) => {}, []);

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
        onLoadStart={() => setLoading(true)}
        onLoadEnd={() => setLoading(false)}
        onError={handleError}
        onHttpError={() => {}}
        onNavigationStateChange={handleNavStateChange}
        onShouldStartLoadWithRequest={handleShouldStartLoad}
        onMessage={handleMessage}
      />

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
});
