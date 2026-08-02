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
import { INJECTED_BEFORE_JS, INJECTED_JS } from "@/lib/injected-scripts";
import { parseRelayMessage } from "@/lib/call-messages";
import { useCallSession } from "@/hooks/use-call-session";
import { useCallNotifications } from "@/hooks/use-call-notifications";
import { useBackgroundPresence } from "@/hooks/use-background-presence";
import { usePushToken } from "@/hooks/use-push-token";
import {
  setVoipWebViewRef,
  onVoipWebViewReady,
  handleWebCallEnded,
} from "@/lib/voip-call-manager";
import { useAndroidCallIntent } from "@/hooks/use-android-call-intent";

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
/**
 * Is this URL the MAIN document rather than a sub-resource?
 *
 * `onHttpError` fires for images, scripts and XHRs too, and a 404 on a tracking
 * pixel must not replace the whole app with an error card. The RELAY page is an
 * SPA, so the main document is the site root or an /app route — never a file
 * with an asset extension.
 */
function isMainDocument(url: string): boolean {
  try {
    const u = new URL(url);
    if (/\.(js|mjs|css|png|jpe?g|gif|webp|svg|ico|woff2?|ttf|map|json)$/i.test(u.pathname)) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function RelayWebView() {
  const webViewRef = useRef<WebView>(null);

  // Register WebView ref with VoIP call manager for JS injection
  useEffect(() => {
    setVoipWebViewRef(webViewRef);
  }, []);
  // `loading` only controls the FIRST-load splash overlay. Subsequent in-app
  // (SPA) navigations must never re-show a full-screen overlay, otherwise the
  // spinner can get stuck covering an already-rendered page.
  const [loading, setLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  /** HTTP status of a failed main-document load, so the card can name it. */
  const [httpStatus, setHttpStatus] = useState<number | null>(null);
  /** True when the failure was the first load never completing. */
  const [timedOut, setTimedOut] = useState(false);
  /** Set by any failure path; onLoadEnd (which also fires after an error) uses it
   *  to tell a real success from the tail of a failure. */
  const loadFailedRef = useRef(false);
  const canGoBackRef = useRef(false);
  const firstLoadDoneRef = useRef(false);
  const loadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Safety net: never let the first-load splash hang forever. If the first
  // load has not reported completion within 12s, dismiss the overlay anyway.
  useEffect(() => {
    loadTimeoutRef.current = setTimeout(() => {
      // Do NOT silently dismiss (audit). This used to set loading=false whether or
      // not the page had loaded, and because onLoadStart is gated on
      // `!firstLoadDoneRef.current` the splash could never come back — leaving a
      // blank navy screen with no spinner, no message and no way out for the rest
      // of the process. If the first load has not completed by now, surface the
      // error card that already exists, with its Retry button.
      if (!firstLoadDoneRef.current) {
        loadFailedRef.current = true;
        setTimedOut(true);
        setHasError(true);
      }
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

  // Firebase push token: get the native device token and inject it into the
  // WebView so the web app can register it with its server for push delivery.
  const { onWebViewLoadEnd: sendPushToken } = usePushToken(webViewRef);

  // Track when WebView is ready (first load complete) for Android call intents
  const [webViewReady, setWebViewReady] = useState(false);

  // Android native call intent handling (cold start answer/decline from native FCM service)
  useAndroidCallIntent(webViewRef, webViewReady);

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
    setTimedOut(false);
    setHttpStatus(null);
    loadFailedRef.current = false;
    if (loadTimeoutRef.current) clearTimeout(loadTimeoutRef.current);
    loadTimeoutRef.current = setTimeout(() => {
      if (!firstLoadDoneRef.current) {
        loadFailedRef.current = true;
        setTimedOut(true);
        setHasError(true);
      }
      firstLoadDoneRef.current = true;
      setLoading(false);
    }, 12000);
    webViewRef.current?.reload();
  }, []);

  const handleError = useCallback((_event: WebViewErrorEvent) => {
    loadFailedRef.current = true;
    setHttpStatus(null); // a transport failure has no status code
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
    // DEFAULT DENY (audit fix). This used to `return true` — "let the WebView
    // decide" — which made it the widest hole in the shell: a URL that is not
    // internal, not mailto/tel/sms and not http(s) was LOADED. That is exactly
    // `javascript:`, and also `file:`, `content:` and Android's `intent:`. So
    // tightening isInternalUrl alone would have changed nothing; the fallback
    // was the vulnerability.
    //
    // Refusing is safe here because every legitimate destination is already
    // handled above: the RELAY site, about:blank, the three native schemes, and
    // outbound links. Logged rather than silently dropped, so if a real flow
    // turns out to need a scheme, it is diagnosable instead of just broken.
    console.warn("[RELAY] refused navigation to an unsupported scheme:", url.slice(0, 80));
    return false;
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
        case "webCallEnded":
          // Web page ended the call — report to native so system UI closes
          if (Platform.OS === "ios" && msg.callId) {
            handleWebCallEnded(msg.callId);
          }
          // On Android: the native RelayNativeInterface @JavascriptInterface
          // handles webCallEnded directly (dismisses notification, deactivates
          // audio router). The web app calls window.RelayNative.postMessage()
          // which goes straight to native without passing through RN bridge.
          // We still handle it here as a fallback for the RN message path.
          if (Platform.OS === "android" && msg.callId) {
            // Dismiss any ongoing call notification via Expo Notifications
            // (best-effort — native interface handles it primarily)
          }
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
        onLoadEnd={() => {
          // CLEAR a stale error (audit). `setHasError(false)` used to live only in
          // the manual reload callback, so one transient main-frame failure left an
          // opaque, touch-intercepting overlay covering a WebView that had since
          // loaded fine — the app looked permanently dead. Any successful load
          // dismisses it. `loadFailedRef` is what distinguishes "loaded" from
          // "onLoadEnd fired after an error", which also fires.
          if (!loadFailedRef.current) setHasError(false);
          loadFailedRef.current = false;
          finishFirstLoad();
          sendPushToken();
          setWebViewReady(true);
          // Notify VoIP manager that WebView is ready for injection
          if (Platform.OS === "ios") onVoipWebViewReady();
        }}
        onError={handleError}
        onHttpError={(e) => {
          // Was an empty function. A 4xx/5xx main-frame response "loads"
          // successfully, dismisses the splash, and renders the SERVER's error
          // body — so the branded error card and its Retry button, which this
          // component already implements, never appeared. Sub-resource failures
          // (an image, a script) must NOT trigger it, hence the URL check.
          const { statusCode, url } = e.nativeEvent;
          if (statusCode >= 400 && isMainDocument(url)) {
            loadFailedRef.current = true;
            setHttpStatus(statusCode);
            setHasError(true);
            finishFirstLoad();
          }
        }}
        onNavigationStateChange={handleNavStateChange}
        onShouldStartLoadWithRequest={handleShouldStartLoad}
        onMessage={handleMessage}
        injectedJavaScript={INJECTED_JS}
        // The session copy-back has to beat the web bundle's own read of
        // sessionStorage; at document-end it restores the session for the NEXT
        // load, which is why cold start kept showing a sign-in screen.
        injectedJavaScriptBeforeContentLoaded={INJECTED_BEFORE_JS}
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
            <Text style={styles.errorTitle}>
              {httpStatus != null
                ? "RELAY had a problem"
                : timedOut
                  ? "RELAY is taking too long"
                  : "Can't reach RELAY"}
            </Text>
            {/* Say which of the three it was. The card previously blamed the
                user's connection for every failure, including a 500 from the
                server and a load that simply never finished. */}
            <Text style={styles.errorBody}>
              {httpStatus != null
                ? `The server responded with ${httpStatus}. This is usually temporary.`
                : timedOut
                  ? "The page didn't finish loading. It may just be slow."
                  : "Check your internet connection and try again."}
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
