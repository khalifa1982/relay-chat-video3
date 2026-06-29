import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, type AppStateStatus, NativeModules, Platform } from "react-native";
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
 * Configure the audio session so a call keeps working when the app is
 * backgrounded (audio stays active) and routes correctly during a call.
 */
async function enterCallAudioMode() {
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
    // Non-fatal: audio still works in foreground.
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
 * `expo-audio` exposes `shouldRouteThroughEarpiece` (Android), which lets us
 * toggle between the earpiece and the loudspeaker. Bluetooth routing is handled
 * by the OS once `allowsRecording`/communication mode is active and a headset is
 * connected; selecting "bluetooth" disables the earpiece-force so the system
 * routes to the connected Bluetooth device. A dedicated native module can be
 * added later for explicit device selection if needed.
 */
export async function setAudioRoute(route: AudioRoute): Promise<void> {
  try {
    await setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      allowsRecording: true,
      interruptionMode: "doNotMix",
      interruptionModeAndroid: "doNotMix",
      // Earpiece route forces audio through the earpiece; speaker/bluetooth do not.
      shouldRouteThroughEarpiece: route === "earpiece",
    });
  } catch {
    // Non-fatal: route change is best-effort on web/Expo Go.
  }
}

/**
 * Best-effort Android picture-in-picture trigger. expo-video's PiP only covers
 * its own player, so for a WebRTC call rendered inside the WebView we ask the
 * host Activity to enter PiP directly. If the native module/method isn't
 * present (e.g. Expo Go, iOS), this is a safe no-op and the call simply
 * continues full-screen.
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
 *  - When the app goes to the background DURING a call: request Android PiP so
 *    the call stays visible in a floating window.
 *  - When the app returns to the foreground: ask the page to re-acquire its
 *    camera so the video preview never stays frozen.
 *
 * `onResumeReacquireCamera` is provided by the WebView wrapper and runs the
 * exposed `window.__relayReacquireCamera()` inside the page.
 */
export function useCallSession(onResumeReacquireCamera: () => void) {
  const [call, setCall] = useState<CallState>(IDLE);
  const callRef = useRef<CallState>(IDLE);

  const setCallState = useCallback((next: CallState) => {
    callRef.current = next;
    callActiveGlobal = next.active;
    setCall(next);
  }, []);

  // Apply an audio output route requested from the web app's speaker control.
  const applyAudioRoute = useCallback((route: AudioRoute) => {
    void setAudioRoute(route);
  }, []);

  // Apply / release the call session when the active flag flips.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (call.active) {
        await activateKeepAwakeAsync("relay-call").catch(() => {});
        await enterCallAudioMode();
      } else {
        deactivateKeepAwake("relay-call");
        await exitCallAudioMode();
      }
    })();
    return () => {
      cancelled = true;
      void cancelled;
    };
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
        // Coming back: clear any frozen camera frame.
        onResumeReacquireCamera();
      }
    };
    const sub = AppState.addEventListener("change", onChange);
    return () => sub.remove();
  }, [onResumeReacquireCamera]);

  return { call, setCallState, applyAudioRoute } as const;
}
