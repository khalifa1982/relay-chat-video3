/**
 * Hook: useAndroidCallIntent
 *
 * On Android, when the native IncomingCallActivity or CallActionReceiver
 * answers/declines a call, it launches MainActivity with intent extras:
 *   - nativeCall: callId
 *   - mode: "voice" | "video"
 *   - action: "answer" | "decline"
 *
 * This hook reads those extras via Expo Linking (initial URL) and injects
 * the appropriate CustomEvent into the WebView so the web app joins/declines.
 *
 * For cold start: the WebView loads the call URL directly with query params.
 * For warm start: we inject a CustomEvent('relay:native', ...) into the WebView.
 */
import { useCallback, useEffect, useRef } from "react";
import { Platform, Linking } from "react-native";
import type { WebView } from "react-native-webview";
import { RELAY_APP_URL } from "@/lib/relay-config";

// On Android, react-native passes intent extras as URL query params
// when the app is launched via an intent with data.
// However, our native code uses putExtra (not setData), so we need
// a different approach: use a native module or check SharedPreferences.
// Since we're in Expo managed workflow, we'll use a bridge approach:
// The native code stores the call intent in SharedPreferences, and
// we read it here on mount/resume.

// Actually, in Expo with expo-linking, intent extras are not directly
// accessible. Instead, we'll modify the native code to set the intent
// data as a URL scheme, OR we use the expo-intent-launcher approach.
// 
// SIMPLEST APPROACH: The native Kotlin code launches MainActivity with
// a deep link URL that Expo Router can handle:
//   relay://call?nativeCall=xxx&mode=voice&action=answer
// 
// But since we already have the WebView handling everything, the cleanest
// approach is:
// 1. Native code stores call intent in SharedPreferences
// 2. On WebView load, we check SharedPreferences and inject the event
// 3. Clear SharedPreferences after handling
//
// For Expo managed workflow without native modules, we'll use the
// Linking API with a custom URL scheme approach.

/**
 * Handles Android call intents by checking the initial URL on app launch.
 * The native IncomingCallActivity/CallActionReceiver will launch the app
 * with a deep link: manusrelaymobile://call?nativeCall=X&mode=Y&action=Z
 */
export function useAndroidCallIntent(
  webViewRef: React.RefObject<WebView | null>,
  webViewReady: boolean
) {
  const handledRef = useRef(false);
  const pendingIntentRef = useRef<{
    callId: string;
    mode: string;
    action: string;
  } | null>(null);

  const handleCallIntent = useCallback(
    (callId: string, mode: string, action: string) => {
      if (!webViewRef.current) {
        // Store for when WebView becomes ready
        pendingIntentRef.current = { callId, mode, action };
        return;
      }

      if (action === "answer") {
        // Inject callAnswered event into WebView
        const js = `
          window.dispatchEvent(new CustomEvent('relay:native', {
            detail: { type: 'callAnswered', callId: '${callId}', mode: '${mode}' }
          }));
          true;
        `;
        webViewRef.current.injectJavaScript(js);
      } else if (action === "decline") {
        // Inject callDeclined event into WebView
        const js = `
          window.dispatchEvent(new CustomEvent('relay:native', {
            detail: { type: 'callDeclined', callId: '${callId}' }
          }));
          true;
        `;
        webViewRef.current.injectJavaScript(js);
      }
    },
    [webViewRef]
  );

  // Check initial URL on mount (cold start)
  useEffect(() => {
    if (Platform.OS !== "android") return;

    const checkInitialUrl = async () => {
      try {
        const url = await Linking.getInitialURL();
        if (url && !handledRef.current) {
          const parsed = parseCallUrl(url);
          if (parsed) {
            handledRef.current = true;
            handleCallIntent(parsed.callId, parsed.mode, parsed.action);
          }
        }
      } catch {
        // ignore
      }
    };

    void checkInitialUrl();
  }, [handleCallIntent]);

  // Listen for deep links while app is running (warm start)
  useEffect(() => {
    if (Platform.OS !== "android") return;

    const handleUrl = (event: { url: string }) => {
      const parsed = parseCallUrl(event.url);
      if (parsed) {
        handleCallIntent(parsed.callId, parsed.mode, parsed.action);
      }
    };

    const sub = Linking.addEventListener("url", handleUrl);
    return () => sub.remove();
  }, [handleCallIntent]);

  // When WebView becomes ready, flush any pending intent
  useEffect(() => {
    if (webViewReady && pendingIntentRef.current) {
      const { callId, mode, action } = pendingIntentRef.current;
      pendingIntentRef.current = null;

      if (action === "answer") {
        // For cold start answer, navigate WebView to the call URL
        const callUrl = `${RELAY_APP_URL}?nativeCall=${encodeURIComponent(callId)}&mode=${encodeURIComponent(mode)}&action=answer`;
        webViewRef.current?.injectJavaScript(
          `window.location.href = ${JSON.stringify(callUrl)}; true;`
        );
      } else if (action === "decline") {
        const js = `
          window.dispatchEvent(new CustomEvent('relay:native', {
            detail: { type: 'callDeclined', callId: '${callId}' }
          }));
          true;
        `;
        webViewRef.current?.injectJavaScript(js);
      }
    }
  }, [webViewReady, webViewRef]);

  return { handleCallIntent };
}

function parseCallUrl(
  url: string
): { callId: string; mode: string; action: string } | null {
  try {
    // Expected format: scheme://call?nativeCall=X&mode=Y&action=Z
    // Or: https://your-chat.io/app?nativeCall=X&mode=Y&action=Z
    const urlObj = new URL(url);
    const callId = urlObj.searchParams.get("nativeCall");
    const mode = urlObj.searchParams.get("mode");
    const action = urlObj.searchParams.get("action");
    if (callId && mode && action) {
      return { callId, mode, action };
    }
  } catch {
    // ignore
  }
  return null;
}
