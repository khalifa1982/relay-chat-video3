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
import { INJECTED_JS } from "@/lib/injected-scripts";
import { parseRelayMessage } from "@/lib/call-messages";
import { useCallSession } from "@/hooks/use-call-session";
import { useCallNotifications } from "@/hooks/use-call-notifications";
import { useBackgroundPresence } from "@/hooks/use-background-presence";

// Palette aligned to the live RELAY web app (oklch(0.12 0.008 245) background
// ~ #050608) so the native shell's splash/error chrome blends seamlessly with
// the web content instead of flashing a lighter navy.
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

// Script that asks the page to refresh its camera track (clears frozen preview).
const REACQUIRE_CAMERA_JS =
  "try { window.__relayReacquireCamera && window.__relayReacquireCamera(); } catch (e) {} true;";

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

  // Ask the page (via injected helper) to re-acquire the camera on resume.
  const reacquireCamera = useCallback(() => {
    webViewRef.current?.injectJavaScript(REACQUIRE_CAMERA_JS);
  }, []);

  // Call lifecycle: background audio, keep-awake, PiP, camera re-acquire,
  // plus audio output routing (earpiece/speaker/Bluetooth).
  const { setCallState, applyAudioRoute } = useCallSession(reacquireCamera);

  // Online presence: keep RELAY reachable in the background so calls ring even
  // when minimized. The injected script reports whether the user is signed in;
  // we treat "logged in" (past the name-entry screen) as online.
  const [online, setOnline] = useState(false);
  useBackgroundPresence(online);
  // Incoming-call ringtone + notification (with Accept/Decline handling).
  const { showIncomingCall, dismissIncomingCall, showIncomingMessage } =
    useCallNotifications({
      onAccept: () => {
        // Bring the call back into view and refresh the camera frame.
        reacquireCamera();
      },
      onDecline: () => {
        void dismissIncomingCall();
      },
    });

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

  // Receive messages from the injected scripts (version, call, ring).
  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      const msg = parseRelayMessage(event.nativeEvent.data);
      switch (msg.type) {
        case "version":
          handleVersion(msg.version);
          break;
        case "call":
          setCallState({ active: msg.active, hasVideo: msg.hasVideo });
          // A connected call cancels any pending ringtone.
          if (msg.active) void dismissIncomingCall();
          break;
        case "ring":
          if (msg.ringing) void showIncomingCall(msg.caller ?? undefined);
          else void dismissIncomingCall();
          break;
        case "message":
          void showIncomingMessage();
          break;
        case "audio-route":
          applyAudioRoute(msg.route);
          break;
        case "online":
          setOnline(msg.online);
          break;
        default:
          break;
      }
    },
    [
      handleVersion,
      setCallState,
      applyAudioRoute,
      showIncomingCall,
      dismissIncomingCall,
      showIncomingMessage,
    ],
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
        allowsPictureInPictureMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        allowsProtectedMedia
        // --- Storage / cookies / cache so the session survives app restarts ---
        // domStorageEnabled: keep localStorage/IndexedDB (login token, drafts).
        // cacheEnabled + LOAD_DEFAULT: use the on-disk HTTP cache across launches
        // instead of re-fetching everything, so cold starts are faster and the
        // web app doesn't lose cached assets when the app is closed.
        domStorageEnabled
        javaScriptEnabled
        cacheEnabled
        cacheMode="LOAD_DEFAULT"
        incognito={false}
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
        injectedJavaScript={INJECTED_JS}
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
          <Text style={styles.tagline}>Voice · Video · Chat</Text>
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
  tagline: {
    marginTop: 6,
    color: COLORS.muted,
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: 1,
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
