import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import type { OtaStatus } from "@/hooks/use-ota-update";

const COLORS = {
  surface: "#11182B",
  indigo: "#4F46E5",
  cyan: "#06B6D4",
  foreground: "#E5E9F5",
  muted: "#8B93AD",
  border: "#1E2742",
};

/**
 * A slim banner that communicates the OTA self-update progress to the user.
 * - While checking: hidden (silent, no noise on every launch).
 * - While downloading: "Updating app…" with a spinner.
 * - When an update is ready but auto-restart was deferred: a "Restart" action.
 */
export function OtaUpdateBanner({
  status,
  updateReady,
  onRestart,
}: {
  status: OtaStatus;
  updateReady: boolean;
  onRestart: () => void;
}) {
  const downloading = status === "downloading";
  const restarting = status === "restarting";
  const readyToRestart = updateReady && status === "idle";

  if (!downloading && !restarting && !readyToRestart) return null;

  return (
    <View style={styles.wrap} pointerEvents={readyToRestart ? "auto" : "none"}>
      <View style={styles.banner}>
        {readyToRestart ? (
          <>
            <Text style={styles.text}>A new version of RELAY is ready.</Text>
            <Pressable
              onPress={onRestart}
              style={({ pressed }) => [
                styles.button,
                pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] },
              ]}
              accessibilityRole="button"
            >
              <Text style={styles.buttonText}>Restart</Text>
            </Pressable>
          </>
        ) : (
          <>
            <ActivityIndicator size="small" color={COLORS.cyan} />
            <Text style={styles.text}>
              {restarting ? "Applying update…" : "Updating app…"}
            </Text>
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
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 16,
    maxWidth: 420,
    width: "100%",
  },
  text: {
    color: COLORS.foreground,
    fontSize: 14,
    fontWeight: "600",
    flexShrink: 1,
  },
  button: {
    marginLeft: "auto",
    backgroundColor: COLORS.indigo,
    paddingVertical: 8,
    paddingHorizontal: 20,
    borderRadius: 999,
  },
  buttonText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "700",
  },
});
