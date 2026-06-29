import { useEffect, useRef } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";

import type { ApkUpdateStatus } from "@/hooks/use-apk-update";

interface Props {
  status: ApkUpdateStatus;
  /** 0..1 download progress. */
  progress: number;
  versionName?: string;
  onInstallNow?: () => void;
}

const COLORS = {
  bg: "#0F1630",
  border: "#1F2A4D",
  text: "#E5E9F5",
  sub: "#9AA3BD",
  accent: "#06B6D4",
  track: "#243154",
};

/**
 * A bottom banner that surfaces the self-hosted APK update flow:
 *  - "available": offers a Download button (shown when an update couldn't auto
 *    start, e.g. during a call)
 *  - "downloading": shows a live progress bar with percentage
 *  - "installing": tells the user to confirm the system install dialog
 *
 * It renders nothing while idle/checking so it stays out of the way.
 */
export function ApkUpdateBanner({
  status,
  progress,
  versionName,
  onInstallNow,
}: Props) {
  const widthAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(widthAnim, {
      toValue: Math.max(0, Math.min(1, progress)),
      duration: 150,
      useNativeDriver: false,
    }).start();
  }, [progress, widthAnim]);

  if (status === "idle" || status === "checking") return null;

  const pct = Math.round(Math.max(0, Math.min(1, progress)) * 100);
  const label =
    versionName != null ? `RELAY ${versionName}` : "A new RELAY version";

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <View style={styles.card}>
        {status === "available" && (
          <>
            <Text style={styles.title}>{label} is available</Text>
            <Text style={styles.sub}>
              Tap to download and install the latest version.
            </Text>
            <Pressable
              onPress={onInstallNow}
              style={({ pressed }) => [
                styles.button,
                pressed && { opacity: 0.85 },
              ]}
            >
              <Text style={styles.buttonText}>Download update</Text>
            </Pressable>
          </>
        )}

        {status === "downloading" && (
          <>
            <Text style={styles.title}>Downloading update… {pct}%</Text>
            <View style={styles.track}>
              <Animated.View
                style={[
                  styles.fill,
                  {
                    width: widthAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: ["0%", "100%"],
                    }),
                  },
                ]}
              />
            </View>
            <Text style={styles.sub}>Please keep the app open.</Text>
          </>
        )}

        {status === "installing" && (
          <>
            <Text style={styles.title}>Installing update…</Text>
            <Text style={styles.sub}>
              Confirm the system prompt to install and restart RELAY.
            </Text>
          </>
        )}

        {status === "error" && (
          <>
            <Text style={styles.title}>Update failed</Text>
            <Pressable
              onPress={onInstallNow}
              style={({ pressed }) => [
                styles.button,
                pressed && { opacity: 0.85 },
              ]}
            >
              <Text style={styles.buttonText}>Try again</Text>
            </Pressable>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    padding: 12,
  },
  card: {
    backgroundColor: COLORS.bg,
    borderColor: COLORS.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    padding: 16,
    gap: 10,
  },
  title: {
    color: COLORS.text,
    fontSize: 15,
    fontWeight: "700",
  },
  sub: {
    color: COLORS.sub,
    fontSize: 13,
    lineHeight: 18,
  },
  track: {
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.track,
    overflow: "hidden",
  },
  fill: {
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.accent,
  },
  button: {
    alignSelf: "flex-start",
    backgroundColor: COLORS.accent,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 999,
    marginTop: 2,
  },
  buttonText: {
    color: "#04121A",
    fontWeight: "800",
    fontSize: 14,
  },
});
