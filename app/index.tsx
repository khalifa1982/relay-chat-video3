import { StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { RelayWebView } from "@/components/relay-webview";

/**
 * Single screen: full-screen WebView pointing at your-chat.io.
 * Everything (dialer, calls, messages, contacts) lives in the web app.
 */
export default function HomeScreen() {
  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right", "bottom"]}>
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
