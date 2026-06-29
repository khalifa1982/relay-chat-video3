import { useCallback, useEffect, useRef } from "react";
import { Platform } from "react-native";
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
 * message notifications. The call notification uses MAX importance, is sticky,
 * carries a full-screen-intent hint, and exposes Accept/Decline actions so it
 * behaves like a call screen even when the app is backgrounded.
 */
export function useCallNotifications(callbacks?: {
  onAccept?: () => void;
  onDecline?: () => void;
}) {
  const playerRef = useRef<AudioPlayer | null>(null);
  const cbRef = useRef(callbacks);
  cbRef.current = callbacks;

  // Set up permissions + channels once on mount, and listen for action taps.
  useEffect(() => {
    void setupCallNotifications();

    const sub = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const action = response.actionIdentifier;
        if (action === CALL_ACTION_DECLINE) {
          cbRef.current?.onDecline?.();
        } else {
          // Default tap or Accept → bring the call into the foreground.
          cbRef.current?.onAccept?.();
        }
      },
    );

    return () => {
      sub.remove();
      try {
        playerRef.current?.remove();
      } catch {
        // ignore
      }
      playerRef.current = null;
    };
  }, []);

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
      await startRingtone();
      try {
        await Notifications.scheduleNotificationAsync({
          identifier: CALL_NOTIFICATION_ID,
          content: {
            title: "Incoming RELAY call",
            body: caller ? `${caller} is calling…` : "Someone is calling you",
            sound: Platform.OS === "ios" ? "ringtone.wav" : undefined,
            priority: Notifications.AndroidNotificationPriority.MAX,
            sticky: true,
            categoryIdentifier: CALL_CATEGORY_ID,
            data: {
              type: "incoming-call",
              // Hint for native layers / future full-screen-intent handling.
              fullScreenIntent: true,
            },
            ...(Platform.OS === "android"
              ? { channelId: CALL_CHANNEL_ID }
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
    [startRingtone],
  );

  const dismissIncomingCall = useCallback(async () => {
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
