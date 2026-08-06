import { StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { RelayWebView } from "@/components/relay-webview";

/**
 * Single screen: full-screen WebView pointing at your-chat.io.
 * Everything (dialer, calls, messages, contacts) lives in the web app.
 */
export default function HomeScreen() {
  /* No "bottom" edge (v1.0.43, owner): padding the WebView up off the bottom
     left a dead grey strip under the web app's tab bar. The WebView now
     reaches the bottom edge and the web tab bar's own env(safe-area-inset-
     bottom) padding clears the home indicator (viewport-fit=cover is set). */
  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      <RelayWebView />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#050608",
  },
});
