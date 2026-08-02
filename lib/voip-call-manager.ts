/**
 * RELAY VoIP Call Manager (iOS)
 *
 * Central module that bridges native PushKit/CallKit events to the WebView.
 * This module:
 *  1. Listens for VoIP push token registration → injects into WebView via CustomEvent
 *  2. Listens for incoming VoIP push notifications → already handled natively by CallKit
 *  3. Listens for CallKeep answer/decline events → injects into WebView
 *  4. Handles "web ended call" messages from WebView → reports to CallKit
 *
 * Architecture:
 *  - Native AppDelegate (via config plugin) handles PushKit + CallKit IMMEDIATELY
 *  - This JS module handles the AFTER-JS-BRIDGE-READY coordination
 *  - WebView communication uses `relay:native` CustomEvent (native→web) and
 *    `ReactNativeWebView.postMessage` (web→native)
 */
import { Platform } from "react-native";
import type { WebView } from "react-native-webview";
import { RELAY_APP_URL } from "./relay-config";
import { nativeEventJs, navigateJs } from "./native-bridge";

// Only import on iOS — these modules are iOS-only
let VoipPushNotification: any = null;
let RNCallKeep: any = null;

if (Platform.OS === "ios") {
  try {
    VoipPushNotification = require("react-native-voip-push-notification").default;
  } catch (e) {
    console.warn("[RELAY VoIP] react-native-voip-push-notification not available:", e);
  }
  try {
    RNCallKeep = require("react-native-callkeep").default;
  } catch (e) {
    console.warn("[RELAY VoIP] react-native-callkeep not available:", e);
  }
}

/** Pending call context stored when CallKit answers before WebView is ready */
interface PendingCallAnswer {
  callId: string;
  mode: string;
}

// Module-level state
let webViewRef: React.RefObject<WebView | null> | null = null;
let voipToken: string | null = null;
let isWebViewReady = false;
let pendingTokenInjection = false;
let pendingCallAnswer: PendingCallAnswer | null = null;
let initialized = false;

// Map UUID → callId for reverse lookup
const uuidToCallId: Map<string, string> = new Map();
// Map UUID → mode ("voice" | "video") for call type tracking
const uuidToMode: Map<string, string> = new Map();

/**
 * Initialize the VoIP call manager. Call this once at app startup (in _layout.tsx).
 * Must be called before the WebView mounts.
 */
export function initVoipCallManager() {
  if (Platform.OS !== "ios" || initialized) return;
  if (!VoipPushNotification || !RNCallKeep) return;

  initialized = true;

  // ─── CallKeep Setup (JS side — supplements native setup) ──────────────
  // Native setup is done in AppDelegate via the config plugin, but we also
  // call setup here so the JS event bridge is properly wired.
  RNCallKeep.setup({
    ios: {
      appName: "RELAY",
      supportsVideo: true,
      maximumCallsPerCallGroup: 1,
      maximumCallGroups: 1,
      audioSession: {
        mode: "voiceChat",
      },
    },
  }).catch(() => {
    // Setup may fail on simulator — that's OK
  });

  // Mark app as reachable once JS is up
  RNCallKeep.setReachable();

  // ─── VoIP Push Token Registration ─────────────────────────────────────
  VoipPushNotification.addEventListener("register", (token: string) => {
    console.log("[RELAY VoIP] Token received:", token.substring(0, 12) + "...");
    voipToken = token;
    injectTokenIntoWebView(token);
  });

  // ─── Incoming VoIP Push (JS side — for logging/tracking) ──────────────
  VoipPushNotification.addEventListener("notification", (notification: any) => {
    console.log("[RELAY VoIP] Push notification received in JS:", notification?.type);
    // The native side already reported to CallKit — we just track the UUID mapping
    const callId = notification?.callId;
    const uuid = notification?.uuid;
    const mode = notification?.mode || "voice";
    if (callId && uuid) {
      uuidToCallId.set(uuid.toLowerCase(), callId);
      uuidToMode.set(uuid.toLowerCase(), mode);
    }
    // Signal completion to PushKit
    if (notification?.uuid) {
      VoipPushNotification.onVoipNotificationCompleted(notification.uuid);
    }
  });

  // ─── Early Events (before JS bridge was ready) ────────────────────────
  VoipPushNotification.addEventListener("didLoadWithEvents", (events: any[]) => {
    if (!events || !Array.isArray(events) || events.length < 1) return;
    console.log("[RELAY VoIP] Processing early events:", events.length);
    for (const event of events) {
      const { name, data } = event;
      if (name === "RNVoipPushRemoteNotificationsRegisteredEvent") {
        voipToken = data;
        injectTokenIntoWebView(data);
      } else if (name === "RNVoipPushRemoteNotificationReceivedEvent") {
        const callId = data?.callId;
        const uuid = data?.uuid;
        const mode = data?.mode || "voice";
        if (callId && uuid) {
          uuidToCallId.set(uuid.toLowerCase(), callId);
          uuidToMode.set(uuid.toLowerCase(), mode);
        }
      }
    }
  });

  // Register for VoIP push (no-op if already done natively in AppDelegate)
  VoipPushNotification.registerVoipToken();

  // ─── CallKeep Events ──────────────────────────────────────────────────

  // User answered the call via CallKit
  RNCallKeep.addEventListener("answerCall", ({ callUUID }: { callUUID: string }) => {
    console.log("[RELAY VoIP] Call answered via CallKit, UUID:", callUUID);
    const callId = uuidToCallId.get(callUUID.toLowerCase()) || callUUID;
    // Determine mode from the notification payload
    const mode = uuidToMode.get(callUUID.toLowerCase()) || "voice";

    if (isWebViewReady && webViewRef?.current) {
      // Warm start: inject event into WebView
      injectCallAnswered(callId, mode);
    } else {
      // Cold start: queue for when WebView loads
      pendingCallAnswer = { callId, mode };
    }
  });

  // User declined/ended the call via CallKit
  RNCallKeep.addEventListener("endCall", ({ callUUID }: { callUUID: string }) => {
    console.log("[RELAY VoIP] Call ended/declined via CallKit, UUID:", callUUID);
    const callId = uuidToCallId.get(callUUID.toLowerCase()) || callUUID;
    injectCallDeclined(callId);
    uuidToCallId.delete(callUUID.toLowerCase());
    uuidToMode.delete(callUUID.toLowerCase());
  });

  // Audio session activated by CallKit
  RNCallKeep.addEventListener("didActivateAudioSession", () => {
    console.log("[RELAY VoIP] Audio session activated by CallKit");
    // Audio is now ready for WebRTC in the WebView
  });

  // Handle events that fired before JS bridge was initialized
  RNCallKeep.addEventListener("didLoadWithEvents", (events: any[]) => {
    if (!events || !Array.isArray(events)) return;
    console.log("[RELAY VoIP] CallKeep early events:", events.length);
    for (const event of events) {
      const { name, data } = event;
      if (name === "RNCallKeepPerformAnswerCallAction") {
        const callId = uuidToCallId.get(data?.callUUID?.toLowerCase()) || data?.callUUID || "";
        const mode = uuidToMode.get(data?.callUUID?.toLowerCase()) || "voice";
        pendingCallAnswer = { callId, mode };
      } else if (name === "RNCallKeepPerformEndCallAction") {
        const callId = uuidToCallId.get(data?.callUUID?.toLowerCase()) || data?.callUUID || "";
        injectCallDeclined(callId);
      }
    }
  });

  // Incoming call displayed
  RNCallKeep.addEventListener(
    "didDisplayIncomingCall",
    ({ callUUID, payload }: { callUUID: string; payload: any }) => {
      // Track UUID → callId mapping from the payload
      const callId = payload?.callId;
      if (callId && callUUID) {
        uuidToCallId.set(callUUID.toLowerCase(), callId);
      }
    }
  );
}

/**
 * Set the WebView ref so we can inject JavaScript into it.
 * Called from the RelayWebView component.
 */
export function setVoipWebViewRef(ref: React.RefObject<WebView | null>) {
  webViewRef = ref;
}

/**
 * Called when the WebView finishes loading — flush any pending injections.
 */
export function onVoipWebViewReady() {
  if (Platform.OS !== "ios") return;
  isWebViewReady = true;

  // Inject pending token
  if (voipToken && pendingTokenInjection) {
    injectTokenIntoWebView(voipToken);
  } else if (voipToken) {
    // Always re-inject token on load in case page reloaded
    injectTokenIntoWebView(voipToken);
  }

  // Handle pending call answer (cold start scenario)
  if (pendingCallAnswer) {
    const { callId, mode } = pendingCallAnswer;
    pendingCallAnswer = null;
    // For cold start, load the call URL directly
    if (webViewRef?.current) {
      const callUrl = `${RELAY_APP_URL}?nativeCall=${encodeURIComponent(callId)}&mode=${encodeURIComponent(mode)}&action=answer`;
      webViewRef.current.injectJavaScript(navigateJs(callUrl));
    }
  }
}

/**
 * Handle a message from the WebView that indicates the web app ended the call.
 * The web page sends: { type: "webCallEnded", callId: "..." }
 */
export function handleWebCallEnded(callId: string) {
  if (Platform.OS !== "ios" || !RNCallKeep) return;
  console.log("[RELAY VoIP] Web ended call:", callId);

  // Find the UUID for this callId and report to CallKit
  for (const [uuid, id] of uuidToCallId.entries()) {
    if (id === callId) {
      RNCallKeep.endCall(uuid);
      uuidToCallId.delete(uuid);
      return;
    }
  }
  // If no UUID found, try ending all calls as fallback
  RNCallKeep.endAllCalls();
}

// ─── Private Helpers ──────────────────────────────────────────────────────────

function injectTokenIntoWebView(token: string) {
  if (!webViewRef?.current || !isWebViewReady) {
    pendingTokenInjection = true;
    return;
  }
  pendingTokenInjection = false;

  // SECURITY: serialized, not interpolated (see lib/native-bridge.ts). The token
  // is vendor-supplied rather than user-supplied, but the identical shape at the
  // sibling call sites WAS arbitrary JS execution in the authenticated origin,
  // and a rule applied at only some sites is the bug that keeps recurring here.
  webViewRef.current.injectJavaScript(
    nativeEventJs({ type: "pushToken", kind: "apns-voip", token }),
  );
}

function injectCallAnswered(callId: string, mode: string) {
  if (!webViewRef?.current) return;

  webViewRef.current.injectJavaScript(
    nativeEventJs({ type: "callAnswered", callId, mode }),
  );
}

function injectCallDeclined(callId: string) {
  if (!webViewRef?.current || !isWebViewReady) return;

  webViewRef.current.injectJavaScript(
    nativeEventJs({ type: "callDeclined", callId }),
  );
}
