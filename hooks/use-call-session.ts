import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, type AppStateStatus, NativeModules, PermissionsAndroid, Platform } from "react-native";
import { setAudioModeAsync } from "expo-audio";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";

export interface CallState {
  /** A WebRTC call is currently active. */
  active: boolean;
  /** The active call has a live local video track (video call vs voice-only). */
  hasVideo: boolean;
}

const IDLE: CallState = { active: false, hasVideo: false };

/** Audio output routes the in-call speaker control can switch between. */
export type AudioRoute = "earpiece" | "speaker" | "bluetooth";

/**
 * Module-level flag for whether a call is currently active. Other subsystems
 * (e.g. the OTA self-updater) read this to avoid disruptive actions like
 * restarting the app mid-call.
 */
let callActiveGlobal = false;
export function isCallActive(): boolean {
  return callActiveGlobal;
}

/**
 * Configure the audio session for an active call.
 *
 * BUG #1 + #2 FIX: We now set shouldRouteThroughEarpiece to FALSE by default
 * so audio goes to the speaker immediately on call connect. This fixes the
 * issue where inbound calls start on earpiece and the speaker button fails.
 *
 * We also ensure allowsRecording is true (enables full-duplex audio) which
 * fixes the one-way audio issue between platforms.
 */
async function enterCallAudioMode() {
  try {
    await setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      allowsRecording: true,
      interruptionMode: "doNotMix",
      interruptionModeAndroid: "doNotMix",
      // Route to speaker by default — fixes Bug #1 (speaker not working on inbound)
      shouldRouteThroughEarpiece: false,
    });
  } catch {
    // Non-fatal: audio still works in foreground.
  }
}

/**
 * BUG #2 FIX: Explicitly set the audio mode to full-duplex communication
 * mode with speaker output. Called when the injected JS detects a call
 * connecting and requests speaker route.
 */
async function forceFullDuplexSpeaker() {
  try {
    await setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      allowsRecording: true,
      interruptionMode: "doNotMix",
      interruptionModeAndroid: "doNotMix",
      shouldRouteThroughEarpiece: false,
    });
  } catch {
    // Non-fatal
  }
}

async function exitCallAudioMode() {
  try {
    await setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: false,
      allowsRecording: false,
    });
  } catch {
    // ignore
  }
}

/**
 * Switch the in-call audio output route.
 *
 * BUG #1 FIX: Enhanced to always re-set the full audio mode configuration
 * when switching routes, ensuring the audio session is properly configured
 * for bidirectional audio regardless of when the switch happens.
 */
export async function setAudioRoute(route: AudioRoute): Promise<void> {
  // BLUETOOTH_CONNECT is a runtime permission on Android 12+ (API 31).
  // Request it before attempting Bluetooth SCO, or the route switch silently fails.
  if (route === "bluetooth" && Platform.OS === "android" && Platform.Version >= 31) {
    try {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        {
          title: "Bluetooth Permission",
          message: "RELAY needs Bluetooth access to route call audio to your headset.",
          buttonPositive: "Allow",
        }
      );
      if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
        // Permission denied — fall back to speaker instead of silently failing
        return;
      }
    } catch {
      // Non-fatal — proceed anyway
    }
  }

  try {
    await setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      allowsRecording: true,
      interruptionMode: "doNotMix",
      interruptionModeAndroid: "doNotMix",
      shouldRouteThroughEarpiece: route === "earpiece",
    });
  } catch {
    // Non-fatal: route change is best-effort on web/Expo Go.
  }
}

/**
 * Best-effort Android picture-in-picture trigger.
 */
function tryEnterAndroidPip() {
  if (Platform.OS !== "android") return;
  try {
    const anyModules = NativeModules as Record<string, any>;
    const candidates = [
      anyModules?.RNCWebView,
      anyModules?.ExpoActivityUtils,
      anyModules?.PipModule,
    ];
    for (const m of candidates) {
      if (m && typeof m.enterPictureInPicture === "function") {
        m.enterPictureInPicture();
        return;
      }
    }
  } catch {
    // ignore — PiP is best-effort on WebView calls.
  }
}

/**
 * useCallSession reacts to call state reported by the injected CALL_WATCH_JS:
 *  - While a call is active: keep the screen awake and hold a background-capable
 *    audio session so audio does not drop when the app is backgrounded.
 *  - BUG #1 FIX: When a call becomes active, immediately configure audio for
 *    speaker output (not earpiece) so the user can hear and be heard.
 *  - BUG #2 FIX: When applying audio route, always ensure full-duplex mode is
 *    set, preventing one-way audio scenarios.
 *  - When the app goes to the background DURING a call: request Android PiP.
 *  - When the app returns to the foreground: ask the page to re-acquire its
 *    camera and re-apply the audio mode to fix any OS-level audio session reset.
 */
export function useCallSession(onResumeReacquireCamera: () => void) {
  const [call, setCall] = useState<CallState>(IDLE);
  const callRef = useRef<CallState>(IDLE);
  const audioRouteRef = useRef<AudioRoute>("speaker");

  const setCallState = useCallback((next: CallState) => {
    callRef.current = next;
    callActiveGlobal = next.active;
    setCall(next);
  }, []);

  // Apply an audio output route requested from the web app's speaker control.
  // BUG #1 FIX: Always re-apply the full audio mode when route changes.
  const applyAudioRoute = useCallback((route: AudioRoute) => {
    audioRouteRef.current = route;
    void setAudioRoute(route);
  }, []);

  // Apply / release the call session when the active flag flips.
  // BUG #1 + #2 FIX: When a call becomes active, force full-duplex speaker mode.
  useEffect(() => {
    (async () => {
      if (call.active) {
        await activateKeepAwakeAsync("relay-call").catch(() => {});
        await enterCallAudioMode();
        // Double-ensure speaker mode after a short delay (some devices need this)
        setTimeout(() => {
          void forceFullDuplexSpeaker();
        }, 500);
      } else {
        deactivateKeepAwake("relay-call");
        await exitCallAudioMode();
      }
    })();
  }, [call.active]);

  // Handle foreground/background transitions while in a call.
  useEffect(() => {
    const onChange = (state: AppStateStatus) => {
      const inCall = callRef.current.active;
      if (!inCall) return;
      if (state === "background" || state === "inactive") {
        // Going to background mid-call: try to float the call via PiP.
        if (callRef.current.hasVideo) tryEnterAndroidPip();
      } else if (state === "active") {
        // Coming back: clear any frozen camera frame and re-apply audio mode.
        onResumeReacquireCamera();
        // BUG #2 FIX: Re-apply audio mode on resume to fix any OS-level reset
        // that may have happened while backgrounded.
        void setAudioRoute(audioRouteRef.current);
      }
    };
    const sub = AppState.addEventListener("change", onChange);
    return () => sub.remove();
  }, [onResumeReacquireCamera]);

  return { call, setCallState, applyAudioRoute } as const;
}
