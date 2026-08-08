import { useEffect } from "react";
import { Platform, StyleSheet } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import * as Notifications from "expo-notifications";

import { RelayWebView } from "./src/relay-webview";

/**
 * RELAY mobile — a thin shell around the web app at your-chat.io.
 *
 * The ENTIRE product lives in the web app: dialer, calls (WebRTC in the
 * WebView), messages, statuses, contacts, sounds, mic/camera/speaker
 * handling. This shell exists only for what a browser tab cannot do:
 *
 *  • a home-screen icon with a real app identity,
 *  • native push (APNs on iOS, FCM on Android) delivered to the web app,
 *  • notification taps deep-linking into the right web screen,
 *  • OS-level call affordances (lock-screen show, PiP, background audio),
 *  • the QW-12 screenshot block (Android FLAG_SECURE).
 *
 * Nothing else. Changing the web app changes the product with no rebuild.
 */

// Foregrounded app: suppress the native banner — the web app draws its own
// notification UI. Backgrounded / killed → the OS shows the push natively.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    // `shouldShowAlert` is the pre-SDK-51 name (kept for older runtimes);
    // `shouldShowBanner` + `shouldShowList` are its modern replacement. All
    // false so a foreground push shows nothing native.
    shouldShowAlert: false,
    shouldShowBanner: false,
    shouldShowList: false,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export default function App() {
  // Android 8+ requires notification channels. The server's FCM display block
  // targets channel_id "messages" (server/fcm.ts) — declared MAX so message
  // and call banners pop over whatever is on screen; without the declaration
  // Android falls back to a DEFAULT-importance channel with no heads-up.
  useEffect(() => {
    if (Platform.OS !== "android") return;
    void Notifications.setNotificationChannelAsync("relay-default", {
      name: "RELAY",
      importance: Notifications.AndroidImportance.HIGH,
      enableVibrate: true,
      showBadge: true,
    });
    void Notifications.setNotificationChannelAsync("messages", {
      name: "Messages & Calls",
      importance: Notifications.AndroidImportance.MAX,
      enableVibrate: true,
      showBadge: true,
      sound: "default",
    });
  }, []);

  /* No "bottom" edge (v1.0.43, owner): padding the WebView up off the bottom
     left a dead grey strip under the web app's tab bar. The WebView reaches
     the bottom edge and the web tab bar's own env(safe-area-inset-bottom)
     padding clears the home indicator (viewport-fit=cover is set). */
  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
        <RelayWebView />
      </SafeAreaView>
      <StatusBar style="light" />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#050608",
  },
});
