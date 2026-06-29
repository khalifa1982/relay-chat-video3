import { Platform, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";

import { RelayWebView } from "@/components/relay-webview";
import { ApkUpdateBanner } from "@/components/apk-update-banner";
import { BuildStatusRow } from "@/components/build-status-row";
import { useApkUpdate } from "@/hooks/use-apk-update";
import { RELAY_APP_URL } from "@/lib/relay-config";

/**
 * Main screen — a full-screen WebView shell that mirrors the live RELAY web
 * app. Everything (dialer, calls, messages, contacts) is served by the web,
 * so any web update is reflected here automatically.
 *
 * The app also updates ITSELF from a self-hosted APK: on launch, on resume, and
 * every 10 minutes it checks a fixed manifest URL for a higher build number,
 * and if found it downloads the APK with a progress bar and launches the
 * Android installer to update + restart — no manual download. (Android only.)
 *
 * On web (Expo preview) WebView/native features aren't available, so we show a
 * lightweight notice with the target URL instead of an embedded frame.
 */
export default function HomeScreen() {
  // Self-hosted APK auto-update.
  const {
    status,
    progress,
    manifest,
    mandatory,
    installedBuild,
    check,
    startDownload,
    applyUpdate,
  } = useApkUpdate();

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
      <View style={styles.webviewWrap}>
        <RelayWebView />
      </View>

      {/* Compact build/status footer with manual re-check. */}
      <BuildStatusRow
        installedBuild={installedBuild}
        latestBuild={manifest?.buildNumber}
        status={status}
        progress={progress}
        onCheck={() => void check()}
        onDownload={startDownload}
        onApply={() => void applyUpdate()}
      />

      {/* Update banner (or full blocking overlay when the update is mandatory). */}
      <ApkUpdateBanner
        status={status}
        progress={progress}
        versionName={manifest?.versionName}
        mandatory={mandatory}
        onDownload={startDownload}
        onApply={() => void applyUpdate()}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#0B1020",
  },
  webviewWrap: {
    flex: 1,
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
