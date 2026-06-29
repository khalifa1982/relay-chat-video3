import { useCallback, useEffect, useRef } from "react";
import { AppState, type AppStateStatus, Platform } from "react-native";
import * as Notifications from "expo-notifications";

const PRESENCE_CHANNEL_ID = "relay_presence";
const PRESENCE_NOTIFICATION_ID = "relay-presence";

/**
 * Background presence keeps RELAY reachable while the app is minimized.
 *
 * A plain WebView is suspended by Android shortly after the app is backgrounded,
 * which stops the web app from receiving incoming calls. To keep the page alive
 * we post an ongoing (sticky, low-importance) notification while the user is
 * "online" and the app is in the background. On Android this signals the OS that
 * the app is actively doing user-relevant work (incoming-call delivery) and
 * keeps the process from being aggressively frozen, so calls still ring.
 *
 * The notification is silent and low-priority so it is not intrusive; it is
 * removed automatically when the app returns to the foreground or the user goes
 * offline / a call ends.
 *
 * Note: full guaranteed background WebRTC ultimately benefits from a native
 * push/CallKit-style path; this is the strongest WebView-compatible approach.
 */
async function ensurePresenceChannel() {
  if (Platform.OS !== "android") return;
  try {
    await Notifications.setNotificationChannelAsync(PRESENCE_CHANNEL_ID, {
      name: "Online status",
      importance: Notifications.AndroidImportance.LOW,
      showBadge: false,
      enableVibrate: false,
      sound: undefined,
    });
  } catch {
    // ignore
  }
}

async function showPresence() {
  if (Platform.OS !== "android") return;
  try {
    await ensurePresenceChannel();
    await Notifications.scheduleNotificationAsync({
      identifier: PRESENCE_NOTIFICATION_ID,
      content: {
        title: "RELAY is running",
        body: "You will receive calls and messages.",
        sticky: true,
        priority: Notifications.AndroidNotificationPriority.LOW,
        data: { type: "presence" },
      },
      trigger: { channelId: PRESENCE_CHANNEL_ID } as Notifications.NotificationTriggerInput,
    });
  } catch {
    // ignore
  }
}

async function hidePresence() {
  try {
    await Notifications.dismissNotificationAsync(PRESENCE_NOTIFICATION_ID);
  } catch {
    // ignore
  }
}

/**
 * useBackgroundPresence shows the ongoing presence notification when the app is
 * backgrounded while the user is online, and clears it on foreground/offline.
 *
 * @param online whether the user is currently signed in / available for calls.
 */
export function useBackgroundPresence(online: boolean) {
  const onlineRef = useRef(online);
  onlineRef.current = online;

  const sync = useCallback((state: AppStateStatus) => {
    const backgrounded = state === "background" || state === "inactive";
    if (backgrounded && onlineRef.current) {
      void showPresence();
    } else {
      void hidePresence();
    }
  }, []);

  useEffect(() => {
    // React to online state changes immediately for the current app state.
    sync(AppState.currentState);
  }, [online, sync]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", sync);
    return () => {
      sub.remove();
      void hidePresence();
    };
  }, [sync]);
}

export const __test = { PRESENCE_CHANNEL_ID, PRESENCE_NOTIFICATION_ID };
