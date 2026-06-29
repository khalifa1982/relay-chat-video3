import { Platform, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";

import { RelayWebView } from "@/components/relay-webview";
import { OtaUpdateBanner } from "@/components/ota-update-banner";
import { useOtaUpdate } from "@/hooks/use-ota-update";
import { RELAY_APP_URL } from "@/lib/relay-config";

/**
 * Main screen — a full-screen WebView shell that mirrors the live RELAY web
 * app. Everything (dialer, calls, messages, contacts) is served by the web,
 * so any web update is reflected here automatically.
 *
 * In addition, the app updates ITSELF over-the-air: on launch and on resume it
 * checks the configured update server, downloads any new app bundle, and
 * restarts into it automatically — no manual APK reinstall.
 *
 * On web (Expo preview) WebView/native features aren't available, so we show a
 * lightweight notice with the target URL instead of an embedded frame.
 */
export default function HomeScreen() {
  // OTA self-update: auto-check + auto-restart into the newest app bundle.
  const { status, updateReady, applyUpdate } = useOtaUpdate({ autoRestart: true });

  if (Platform.OS === "web") {
    return (
      <View style={styles.webFallback}>
        <Text style={styles.webFallbackTitle}>RELAY Mobile Shell</Text>
        <Text style={styles.webFallbackBody}>
          On a phone, this screen loads the live RELAY web app full-screen.
        </Text>
        <Text style={styles.webFallbackUrl}>{RELAY_APP_URL}</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right", "bottom"]}>
      <StatusBar style="light" />
      <RelayWebView />
      <OtaUpdateBanner
        status={status}
        updateReady={updateReady}
        onRestart={applyUpdate}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#0B1020",
  },
  webFallback: {
    flex: 1,
    backgroundColor: "#0B1020",
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
  },
  webFallbackTitle: {
    color: "#E5E9F5",
    fontSize: 22,
    fontWeight: "800",
    letterSpacing: 3,
  },
  webFallbackBody: {
    color: "#8B93AD",
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
    marginTop: 12,
  },
  webFallbackUrl: {
    color: "#06B6D4",
    fontSize: 14,
    marginTop: 16,
  },
});
