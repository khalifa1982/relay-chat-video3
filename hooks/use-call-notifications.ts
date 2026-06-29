import { useCallback, useEffect, useRef } from "react";
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import {
  createAudioPlayer,
  setAudioModeAsync,
  type AudioPlayer,
} from "expo-audio";

const RINGTONE = require("@/assets/audio/ringtone.wav");

const CALL_CHANNEL_ID = "incoming-calls";
const CALL_NOTIFICATION_ID = "relay-incoming-call";

/**
 * Foreground notification behaviour: when a call notification arrives while the
 * app is open, still show the banner. We play the ringtone ourselves (via
 * expo-audio) so it can loop and be stopped precisely when the call is answered
 * or missed.
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
 * Request notification permission and create the Android "Incoming calls"
 * channel. The channel is configured with high importance and the bundled
 * ringtone so the OS treats incoming calls as urgent.
 */
export async function setupCallNotifications(): Promise<boolean> {
  try {
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync(CALL_CHANNEL_ID, {
        name: "Incoming calls",
        importance: Notifications.AndroidImportance.MAX,
        sound: "ringtone.wav", // base filename; bundled via app config `sounds`
        vibrationPattern: [0, 600, 600, 600],
        lightColor: "#06B6D4",
        bypassDnd: false,
        enableVibrate: true,
      });
    }
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
 * Manages the incoming-call ringtone + notification. `caller` is whatever the
 * web app exposes (a name/number); it is optional.
 */
export function useCallNotifications() {
  const playerRef = useRef<AudioPlayer | null>(null);

  // Set up permissions + channel once on mount.
  useEffect(() => {
    void setupCallNotifications();
    return () => {
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
            data: { type: "incoming-call" },
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

  return { showIncomingCall, dismissIncomingCall, startRingtone, stopRingtone } as const;
}
