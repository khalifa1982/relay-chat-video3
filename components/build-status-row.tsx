import { Pressable, StyleSheet, Text, View } from "react-native";

import type { ApkUpdateStatus } from "@/hooks/use-apk-update";

interface Props {
  /** Installed Android build number (versionCode), or null on web/iOS. */
  installedBuild: number | null;
  /** Latest build number reported by the manifest, if known. */
  latestBuild?: number;
  status: ApkUpdateStatus;
  onCheck?: () => void;
}

const COLORS = {
  bg: "#0F1630",
  border: "#1F2A4D",
  text: "#E5E9F5",
  sub: "#9AA3BD",
  accent: "#06B6D4",
  ok: "#34D399",
};

/**
 * A compact status row that shows the user's current app build and lets them
 * manually re-check for an update. It is intentionally unobtrusive and meant to
 * sit at the bottom of the screen (e.g. inside an "About"/settings sheet, or as
 * a thin footer). It reflects the live update status so the user always knows
 * whether they are up to date or an update is in progress.
 */
export function BuildStatusRow({
  installedBuild,
  latestBuild,
  status,
  onCheck,
}: Props) {
  const upToDate =
    latestBuild != null && installedBuild != null
      ? installedBuild >= latestBuild
      : status === "idle";

  const statusLabel = (() => {
    switch (status) {
      case "checking":
        return "Checking for updates…";
      case "available":
        return "Update available";
      case "downloading":
        return "Downloading update…";
      case "installing":
        return "Installing update…";
      case "error":
        return "Update check failed";
      default:
        return upToDate ? "Up to date" : "Ready";
    }
  })();

  const busy = status === "checking" || status === "downloading";

  return (
    <View style={styles.row}>
      <View style={styles.left}>
        <Text style={styles.build}>
          Build {installedBuild ?? "—"}
          {latestBuild != null ? ` · latest ${latestBuild}` : ""}
        </Text>
        <Text
          style={[
            styles.status,
            status === "idle" && upToDate ? styles.statusOk : null,
          ]}
        >
          {statusLabel}
        </Text>
      </View>
      <Pressable
        onPress={onCheck}
        disabled={busy}
        style={({ pressed }) => [
          styles.button,
          busy && { opacity: 0.5 },
          pressed && !busy && { opacity: 0.85 },
        ]}
        accessibilityRole="button"
      >
        <Text style={styles.buttonText}>Check</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: COLORS.bg,
    borderTopColor: COLORS.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  left: {
    flexShrink: 1,
  },
  build: {
    color: COLORS.text,
    fontSize: 13,
    fontWeight: "700",
  },
  status: {
    color: COLORS.sub,
    fontSize: 12,
    marginTop: 2,
  },
  statusOk: {
    color: COLORS.ok,
  },
  button: {
    backgroundColor: COLORS.accent,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
    marginLeft: 12,
  },
  buttonText: {
    color: "#04121A",
    fontWeight: "800",
    fontSize: 13,
  },
});
