import { StyleSheet, Text, View } from "react-native";

/**
 * MINIMAL HOME SCREEN — diagnostic build to isolate crash.
 * No WebView, no hooks, no native modules.
 * If this launches without crashing, the base Expo/RN setup is fine.
 */
export default function HomeScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>RELAY</Text>
      <Text style={styles.subtitle}>v1.0.23 - Native Modules Stripped</Text>
      <Text style={styles.body}>
        If you can see this screen, the base app works.{"\n"}
        The crash is caused by one of the removed modules.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#050608",
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
  },
  title: {
    color: "#F2F4F8",
    fontSize: 32,
    fontWeight: "800",
    letterSpacing: 4,
  },
  subtitle: {
    color: "#22D3EE",
    fontSize: 16,
    marginTop: 8,
  },
  body: {
    color: "#8B93AD",
    fontSize: 14,
    textAlign: "center",
    marginTop: 24,
    lineHeight: 22,
  },
});
