import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import type { WebView } from "react-native-webview";
import { readVoipPayload, type VoipCallPayload } from "@/lib/voip-payload";

/**
 * PushKit + CallKit — the iOS half of "the phone rings when it's locked".
 *
 * ── WHY THIS IS SEPARATE FROM use-push-token ───────────────────────────────
 * iOS issues TWO tokens and they are NOT interchangeable:
 *
 *   • the ALERT token (expo-notifications) — ordinary notifications, topic
 *     `<bundle>`. That is what `use-push-token` handles.
 *   • the PUSHKIT token (here) — VoIP pushes, topic `<bundle>.voip`, and the ONLY
 *     thing that can show the real full-screen call screen on a locked device.
 *
 * They are both 64-char hex, so nothing downstream can tell them apart by shape.
 * That is why this posts `kind: "apns-voip"` alongside the token: the server
 * trusts that one label precisely because the shape cannot carry it, and because
 * mislabelling costs only this device its own ring (see `isVoipDeclaration`).
 * Sending a VoIP push to an ALERT token earns `BadDeviceToken`, which the server
 * reads as stale and PRUNES — so getting this wrong destroys the registration
 * rather than merely failing.
 *
 * ── iOS ONLY ───────────────────────────────────────────────────────────────
 * Android already rings through the existing FCM/Expo path plus the
 * full-screen-intent notification. CallKeep's Android ConnectionService would add
 * a second, competing incoming-call UI to a platform that works. Only the broken
 * platform changes.
 *
 * ── THE LIBRARIES ARE OPTIONAL AT RUNTIME, AND THAT IS DELIBERATE ──────────
 * They are native modules, so they exist only in a real prebuild — not in Expo
 * Go, not on web, not in a unit test. Every use is behind a guarded require, so
 * an environment without them degrades to "no CallKit" instead of a red screen
 * at startup. The app is more useful without ringing than not launching.
 */

const CALLKEEP_OPTIONS = {
  ios: {
    appName: "RELAY",
    supportsVideo: true,
    // No ringtone override: CallKit uses the system ringtone, which is what makes
    // it feel like a phone call rather than a notification.
    maximumCallGroups: "1",
    maximumCallsPerCallGroup: "1",
  },
  android: {
    // Present because the type requires it. CallKeep is never SET UP on Android
    // here — see `setup` below — so none of this takes effect.
    alertTitle: "Permissions required",
    alertDescription: "RELAY needs access to your phone accounts",
    cancelButton: "Cancel",
    okButton: "ok",
    additionalPermissions: [],
    foregroundService: {
      channelId: "relay_call",
      channelName: "RELAY call",
      notificationTitle: "RELAY call in progress",
    },
  },
};

type Mod = Record<string, unknown> | null;

/** Load a native module without exploding where it does not exist. */
function optionalModule(load: () => unknown): Mod {
  try {
    const m = load() as { default?: unknown };
    return ((m && (m.default ?? m)) as Mod) ?? null;
  } catch {
    return null;
  }
}

interface CallKeepLike {
  setup: (o: unknown) => Promise<void>;
  setAvailable?: (b: boolean) => void;
  addEventListener: (e: string, cb: (p: never) => void) => void;
  removeEventListener: (e: string) => void;
  endAllCalls?: () => void;
  backToForeground?: () => void;
}

interface VoipPushLike {
  registerVoipToken?: () => void;
  addEventListener: (e: string, cb: (p: never) => void) => void;
  removeEventListener: (e: string) => void;
}

/**
 * Wire PushKit + CallKit and report the VoIP token to the WebView.
 *
 * `onAnswer` / `onEnd` are the CallKit buttons. They are handed to the caller
 * rather than acted on here, because the web app owns what answering MEANS — the
 * shell does not know about rooms.
 */
export function useVoipCallKit(
  webViewRef: React.RefObject<WebView | null>,
  handlers?: { onAnswer?: (payload: VoipCallPayload) => void; onEnd?: () => void },
) {
  const [voipToken, setVoipToken] = useState<string | null>(null);
  const hRef = useRef(handlers);
  hRef.current = handlers;
  /** The payload of the push that woke us, kept so an ANSWER can name the room. */
  const pendingRef = useRef<VoipCallPayload | null>(null);

  const postVoipToken = useCallback(
    (token: string) => {
      if (!webViewRef.current) return;
      // The SAME envelope the alert token uses, plus the one field the shape
      // cannot express. An older web app ignores `kind` and would store this as a
      // plain `apns` row — inert, which is the safe way to be wrong.
      webViewRef.current.postMessage(
        JSON.stringify({ type: "SET_PUSH_TOKEN", token, kind: "apns-voip" }),
      );
    },
    [webViewRef],
  );

  useEffect(() => {
    if (Platform.OS !== "ios") return;
    const CallKeep = optionalModule(() => require("react-native-callkeep")) as CallKeepLike | null;
    const VoipPush = optionalModule(() =>
      require("react-native-voip-push-notification"),
    ) as VoipPushLike | null;
    if (!CallKeep || !VoipPush) return;

    let cancelled = false;
    void (async () => {
      try {
        await CallKeep.setup(CALLKEEP_OPTIONS);
        if (cancelled) return;
        CallKeep.setAvailable?.(true);
      } catch {
        // A refused CallKit setup must not take the app down with it.
        return;
      }

      // The PushKit token. Registration itself happens natively at launch (see
      // plugins/with-ios-voip.js) because a push can LAUNCH the app, long before
      // this effect runs; this listener only collects the result.
      VoipPush.addEventListener("register", ((token: string) => {
        if (cancelled || typeof token !== "string" || !token) return;
        setVoipToken(token);
        postVoipToken(token);
      }) as never);

      // A push that arrives while JS IS running. The native side has already
      // reported the call to CallKit by this point — it must, or iOS kills us —
      // so this only records who is calling for the answer handler.
      VoipPush.addEventListener("notification", ((payload: Record<string, unknown>) => {
        pendingRef.current = readVoipPayload(payload);
      }) as never);
      // DO NOT call VoipPush.registerVoipToken() here. The native
      // RelayVoipBridge (plugins/with-ios-voip.js) already creates its own
      // PKPushRegistry with itself as delegate from +load. The library's
      // registerVoipToken() creates a SECOND registry that casts the AppDelegate
      // to a PKPushRegistryDelegate — which it is NOT — causing an
      // "unrecognized selector" crash on all devices.

      CallKeep.addEventListener("answerCall", (() => {
        // Bring the WebView forward, then let the app decide what to join.
        CallKeep.backToForeground?.();
        hRef.current?.onAnswer?.(pendingRef.current ?? {});
      }) as never);
      CallKeep.addEventListener("endCall", (() => {
        pendingRef.current = null;
        hRef.current?.onEnd?.();
      }) as never);
    })();

    return () => {
      cancelled = true;
      try {
        VoipPush.removeEventListener("register");
        VoipPush.removeEventListener("notification");
        CallKeep.removeEventListener("answerCall");
        CallKeep.removeEventListener("endCall");
      } catch {
        /* module already torn down */
      }
    };
  }, [postVoipToken]);

  /** Re-post on the web app's READY handshake, like the alert token does. */
  const onWebReady = useCallback(() => {
    if (voipToken) postVoipToken(voipToken);
  }, [voipToken, postVoipToken]);

  return { voipToken, onWebReady };
}
