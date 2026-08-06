import { useEffect } from "react";
import { Platform } from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import * as Notifications from "expo-notifications";

/**
 * Thin shell layout. No tRPC, no Manus runtime, no VoIP manager.
 * The web app (your-chat.io) handles all features; we just host it.
 */

// When the app is foregrounded, suppress the native banner — the web app
// shows its own notification UI. Background / killed → OS shows natively.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: false,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export default function RootLayout() {
  // Create Android notification channel so incoming-call / message pushes
  // have a channel to land on (required on Android 8+).
  useEffect(() => {
    if (Platform.OS !== "android") return;
    void Notifications.setNotificationChannelAsync("relay-default", {
      name: "RELAY",
      importance: Notifications.AndroidImportance.HIGH,
      enableVibrate: true,
      showBadge: true,
    });
    // The server's FCM display block targets channel_id "messages" (fcm.ts).
    // Without this declared, Android falls back to FCM's own fallback channel,
    // which works but is DEFAULT-importance — no heads-up banner. Declaring it
    // MAX makes message and call banners pop over whatever is on screen.
    void Notifications.setNotificationChannelAsync("messages", {
      name: "Messages & Calls",
      importance: Notifications.AndroidImportance.MAX,
      enableVibrate: true,
      showBadge: true,
      sound: "default",
    });
  }, []);

  return (
    <SafeAreaProvider>
      <Stack screenOptions={{ headerShown: false }} />
      <StatusBar style="light" />
    </SafeAreaProvider>
  );
}
