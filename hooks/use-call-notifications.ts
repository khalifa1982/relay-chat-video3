import { useCallback, useEffect, useRef } from "react";
import { AppState, type AppStateStatus, Platform } from "react-native";
import * as Notifications from "expo-notifications";
import {
  createAudioPlayer,
  setAudioModeAsync,
  type AudioPlayer,
} from "expo-audio";

const RINGTONE = require("@/assets/audio/ringtone.wav");

const CALL_CHANNEL_ID = "incoming_calls";
const MESSAGE_CHANNEL_ID = "messages";
const CALL_NOTIFICATION_ID = "relay-incoming-call";
export const CALL_CATEGORY_ID = "relay_incoming_call";

export const CALL_ACTION_ACCEPT = "accept";
export const CALL_ACTION_DECLINE = "decline";

/**
 * Foreground notification behaviour: when a call notification arrives while the
 * app is open, still show the heads-up banner. We play the ringtone ourselves
 * (via expo-audio) so it loops and stops precisely when answered/missed.
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

/**
 * Request notification permission and create the Android channels:
 *  - "incoming_calls": MAX importance + ringtone, used for the full-screen-style
 *    incoming-call heads-up notification.
 *  - "messages": high importance for incoming chat messages.
 * Also registers the Accept/Decline action category for calls.
 *
 * BUG #4 FIX: This function is now called on every app resume (not just mount)
 * to ensure notification permissions and channels are always properly registered
 * after iOS suspends the app's background processes.
 */
export async function setupCallNotifications(): Promise<boolean> {
  try {
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync(CALL_CHANNEL_ID, {
        name: "Incoming calls",
        importance: Notifications.AndroidImportance.MAX,
        sound: "ringtone.wav", // base filename; bundled via app config `sounds`
        vibrationPattern: [0, 700, 700, 700, 700],
        lightColor: "#06B6D4",
        bypassDnd: true,
        enableVibrate: true,
      });
      await Notifications.setNotificationChannelAsync(MESSAGE_CHANNEL_ID, {
        name: "Messages",
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: "#06B6D4",
        enableVibrate: true,
      });
    }

    // Accept / Decline buttons on the incoming-call notification.
    await Notifications.setNotificationCategoryAsync(CALL_CATEGORY_ID, [
      {
        identifier: CALL_ACTION_ACCEPT,
        buttonTitle: "Accept",
        options: { opensAppToForeground: true },
      },
      {
        identifier: CALL_ACTION_DECLINE,
        buttonTitle: "Decline",
        options: { opensAppToForeground: false, isDestructive: true },
      },
    ]);

    const { status: existing } = await Notifications.getPermissionsAsync();
    let status = existing;
    if (existing !== "granted") {
      const req = await Notifications.requestPermissionsAsync({
        ios: { allowAlert: true, allowBadge: true, allowSound: true },
      });
      status = req.status;
    }
    return status === "granted";
  } catch {
    return false;
  }
}

/**
 * Manages the incoming-call ringtone + heads-up notification and incoming
 * message notifications.
 *
 * BUG #4 FIX (iOS notification failure after backgrounding):
 * The issue is that iOS suspends the app's JS execution after backgrounding,
 * which can cause the notification response listener to become stale. We now:
 * 1. Re-run setupCallNotifications() on every app resume to ensure channels
 *    and permissions are fresh.
 * 2. Re-register the notification response listener on resume.
 * 3. Set the notification handler again on resume to ensure iOS doesn't
 *    suppress notifications after the app was in management/settings screens.
 */
export function useCallNotifications(callbacks?: {
  onAccept?: () => void;
  onDecline?: () => void;
}) {
  const playerRef = useRef<AudioPlayer | null>(null);
  const cbRef = useRef(callbacks);
  cbRef.current = callbacks;
  const responseSubRef = useRef<Notifications.EventSubscription | null>(null);

  // Handler for notification action responses (Accept/Decline taps)
  const handleNotificationResponse = useCallback(
    (response: Notifications.NotificationResponse) => {
      const action = response.actionIdentifier;
      if (action === CALL_ACTION_DECLINE) {
        cbRef.current?.onDecline?.();
      } else {
        // Default tap or Accept → bring the call into the foreground.
        cbRef.current?.onAccept?.();
      }
    },
    [],
  );

  // Set up permissions + channels once on mount, and listen for action taps.
  useEffect(() => {
    void setupCallNotifications();

    responseSubRef.current =
      Notifications.addNotificationResponseReceivedListener(
        handleNotificationResponse,
      );

    return () => {
      responseSubRef.current?.remove();
      responseSubRef.current = null;
      try {
        playerRef.current?.remove();
      } catch {
        // ignore
      }
      playerRef.current = null;
    };
  }, [handleNotificationResponse]);

  // BUG #4 FIX: Re-register notification infrastructure on every app resume.
  // iOS may suspend the notification listener when the app is backgrounded
  // (especially after visiting management/settings screens). Re-registering
  // ensures incoming calls and messages trigger notifications properly.
  useEffect(() => {
    const onChange = (state: AppStateStatus) => {
      if (state === "active") {
        // Re-setup channels and permissions (idempotent, fast)
        void setupCallNotifications();

        // Re-set the foreground notification handler to ensure iOS doesn't
        // suppress notifications after the app was suspended.
        Notifications.setNotificationHandler({
          handleNotification: async () => ({
            shouldPlaySound: false,
            shouldSetBadge: false,
            shouldShowBanner: true,
            shouldShowList: true,
          }),
        });

        // Re-register the response listener (remove old, add new)
        // This ensures the listener is fresh and not stale from suspension.
        responseSubRef.current?.remove();
        responseSubRef.current =
          Notifications.addNotificationResponseReceivedListener(
            handleNotificationResponse,
          );
      }
    };
    const sub = AppState.addEventListener("change", onChange);
    return () => sub.remove();
  }, [handleNotificationResponse]);

  const startRingtone = useCallback(async () => {
    try {
      await setAudioModeAsync({ playsInSilentMode: true });
      if (!playerRef.current) {
        playerRef.current = createAudioPlayer(RINGTONE);
        playerRef.current.loop = true;
      }
      playerRef.current.seekTo(0);
      playerRef.current.play();
    } catch {
      // ignore playback errors
    }
  }, []);

  const stopRingtone = useCallback(() => {
    try {
      playerRef.current?.pause();
    } catch {
      // ignore
    }
  }, []);

  const showIncomingCall = useCallback(
    async (caller?: string) => {
      // On iOS, CallKit handles the incoming call UI natively via PushKit.
      // Skip the local notification + ringtone path to avoid duplicate alerts.
      if (Platform.OS === "ios") return;
      await startRingtone();
      try {
        await Notifications.scheduleNotificationAsync({
          identifier: CALL_NOTIFICATION_ID,
          content: {
            title: "Incoming RELAY call",
            body: caller ? `${caller} is calling…` : "Someone is calling you",
            sound: undefined,
            priority: Notifications.AndroidNotificationPriority.MAX,
            sticky: true,
            categoryIdentifier: CALL_CATEGORY_ID,
            data: {
              type: "incoming-call",
              fullScreenIntent: true,
            },
            ...(Platform.OS === "android"
              ? { channelId: CALL_CHANNEL_ID }
              : {}),
          },
          trigger: null,
        });
      } catch {
        // ignore
      }
    },
    [startRingtone],
  );

  const dismissIncomingCall = useCallback(async () => {
    // On iOS, CallKit handles call dismissal natively.
    if (Platform.OS === "ios") return;
    stopRingtone();
    try {
      await Notifications.dismissNotificationAsync(CALL_NOTIFICATION_ID);
    } catch {
      // ignore
    }
  }, [stopRingtone]);

  /** Show a heads-up notification for an incoming chat message. */
  const showIncomingMessage = useCallback(
    async (sender?: string, preview?: string) => {
      try {
        await Notifications.scheduleNotificationAsync({
          content: {
            title: sender ? `New message from ${sender}` : "New RELAY message",
            body: preview || "You have a new message",
            priority: Notifications.AndroidNotificationPriority.HIGH,
            data: { type: "incoming-message" },
            ...(Platform.OS === "android"
              ? { channelId: MESSAGE_CHANNEL_ID }
              : {}),
            ...(Platform.OS === "ios"
              ? { interruptionLevel: "timeSensitive" as const }
              : {}),
          },
          trigger: null,
        });
      } catch {
        // ignore
      }
    },
    [],
  );

  return {
    showIncomingCall,
    dismissIncomingCall,
    showIncomingMessage,
    startRingtone,
    stopRingtone,
  } as const;
}
