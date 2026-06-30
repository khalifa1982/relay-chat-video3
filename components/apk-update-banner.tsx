import { useEffect, useRef } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";

import type { ApkUpdateStatus } from "@/hooks/use-apk-update";

interface Props {
  status: ApkUpdateStatus;
  /** 0..1 download progress. */
  progress: number;
  versionName?: string;
  /** Start downloading the available build. */
  onDownload?: () => void;
  /** Apply the downloaded APK + restart. */
  onApply?: () => void;
  /** When true, the update is required: show a full blocking overlay. */
  mandatory?: boolean;
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
  onDownload,
  onApply,
  mandatory = false,
}: Props) {
  const widthAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(widthAnim, {
      toValue: Math.max(0, Math.min(1, progress)),
      duration: 150,
      useNativeDriver: false,
    }).start();
  }, [progress, widthAnim]);

  const pct = Math.round(Math.max(0, Math.min(1, progress)) * 100);
  const label =
    versionName != null ? `RELAY ${versionName}` : "A new RELAY version";

  // The compact, non-blocking update experience lives in the footer
  // BuildStatusRow. The banner is now reserved exclusively for MANDATORY
  // updates, where we take over the screen so the user must update to continue.
  if (!mandatory) return null;

  {
    return (
      <View style={styles.blockOverlay} pointerEvents="auto">
        <View style={styles.blockCard}>
          <Text style={styles.blockTitle}>Update required</Text>
          <Text style={styles.sub}>
            {label} must be installed to continue using RELAY.
          </Text>
          {status === "downloading" ? (
            <>
              <Text style={styles.title}>Downloading… {pct}%</Text>
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
            </>
          ) : status === "verifying" ? (
            <Text style={styles.sub}>Verifying update…</Text>
          ) : status === "installing" ? (
            <Text style={styles.sub}>
              Confirm the system prompt to install and restart RELAY.
            </Text>
          ) : status === "ready" ? (
            <Pressable
              onPress={onApply}
              style={({ pressed }) => [
                styles.button,
                pressed && { opacity: 0.85 },
              ]}
            >
              <Text style={styles.buttonText}>Restart to install</Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={onDownload}
              style={({ pressed }) => [
                styles.button,
                pressed && { opacity: 0.85 },
              ]}
            >
              <Text style={styles.buttonText}>
                {status === "error" ? "Try again" : "Update now"}
              </Text>
            </Pressable>
          )}
        </View>
      </View>
    );
  }
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
  blockOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(7,11,26,0.96)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  blockCard: {
    width: "100%",
    maxWidth: 380,
    backgroundColor: COLORS.bg,
    borderColor: COLORS.border,
    borderWidth: 1,
    borderRadius: 20,
    padding: 24,
    gap: 12,
  },
  blockTitle: {
    color: COLORS.text,
    fontSize: 20,
    fontWeight: "800",
  },
});
