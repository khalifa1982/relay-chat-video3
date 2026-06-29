import { useEffect, useRef } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";

import type { ApkUpdateStatus } from "@/hooks/use-apk-update";

interface Props {
  /** Installed Android build number (versionCode), or null on web/iOS. */
  installedBuild: number | null;
  /** Installed human version name, e.g. "1.0.4". */
  installedVersionName?: string | null;
  /** Latest build number reported by the manifest, if known. */
  latestBuild?: number;
  /** Latest human version name reported by the manifest, if known. */
  latestVersionName?: string | null;
  /** Human-readable explanation of the last check result. */
  reason?: string | null;
  status: ApkUpdateStatus;
  /** Download progress 0..1 (only meaningful while downloading). */
  progress?: number;
  /** Re-check the manifest for a newer build. */
  onCheck?: () => void;
  /** Start downloading the available build ("Update" button). */
  onDownload?: () => void;
  /** Apply the downloaded APK + restart ("Restart" button). */
  onApply?: () => void;
}

const COLORS = {
  bg: "#0F1630",
  border: "#1F2A4D",
  track: "#1B2647",
  text: "#E5E9F5",
  sub: "#9AA3BD",
  accent: "#06B6D4",
  ok: "#34D399",
  warn: "#F59E0B",
};

/**
 * A compact, professional status row that shows the user's current app build,
 * the latest available build, and — when an update exists — a live download
 * progress bar. The action button adapts to the update phase:
 *
 *  - idle / up to date      -> "Check"      (re-check the manifest)
 *  - available (not started) -> "Update"     (begin download)
 *  - downloading            -> shows % + bar (button disabled)
 *  - ready to install       -> "Restart"    (apply + relaunch)
 *  - error                  -> "Retry"
 *
 * It is intentionally unobtrusive and meant to sit as a thin footer beneath the
 * WebView so the user always knows whether they are up to date.
 */
export function BuildStatusRow({
  installedBuild,
  installedVersionName,
  latestBuild,
  latestVersionName,
  reason,
  status,
  progress = 0,
  onCheck,
  onDownload,
  onApply,
}: Props) {
  const installedLabel = installedVersionName ?? (installedBuild != null ? String(installedBuild) : "—");
  const latestLabel = latestVersionName ?? (latestBuild != null ? String(latestBuild) : null);
  const upToDate =
    latestBuild != null && installedBuild != null
      ? installedBuild >= latestBuild
      : status === "idle";

  // The download has fully completed but the installer hasn't taken over yet.
  const readyToInstall = status === "ready";
  const showBar =
    status === "downloading" ||
    status === "installing" ||
    status === "ready" ||
    status === "available";

  const statusLabel = (() => {
    switch (status) {
      case "checking":
        return "Checking for updates…";
      case "available":
        return latestLabel != null
          ? `Update available (${latestLabel}) — tap Update`
          : "Update available — tap Update";
      case "downloading":
        return `Downloading update… ${Math.round(progress * 100)}%`;
      case "ready":
        return "Download complete — tap Restart to apply";
      case "installing":
        return "Installing update…";
      case "error":
        return reason ?? "Update check failed — tap Retry";
      default:
        return upToDate ? "Up to date" : "Ready";
    }
  })();

  // Choose the action button label + handler for the current phase.
  const action = (() => {
    if (status === "ready") {
      return { label: "Restart", onPress: onApply, disabled: false };
    }
    if (status === "downloading") {
      return { label: `${Math.round(progress * 100)}%`, onPress: undefined, disabled: true };
    }
    if (status === "installing") {
      return { label: "Installing", onPress: undefined, disabled: true };
    }
    if (status === "available") {
      return { label: "Update", onPress: onDownload, disabled: false };
    }
    if (status === "error") {
      return { label: "Retry", onPress: onCheck, disabled: false };
    }
    if (status === "checking") {
      return { label: "…", onPress: undefined, disabled: true };
    }
    return { label: "Check", onPress: onCheck, disabled: false };
  })();

  // Animate the progress bar width smoothly.
  const widthAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(widthAnim, {
      toValue: Math.max(0, Math.min(1, progress)),
      duration: 200,
      useNativeDriver: false,
    }).start();
  }, [progress, widthAnim]);

  const barWidth = widthAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["0%", "100%"],
  });

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <View style={styles.left}>
          <Text style={styles.build} numberOfLines={1}>
            Version {installedLabel}
            {latestLabel != null ? ` · latest ${latestLabel}` : ""}
          </Text>
          <Text
            style={[
              styles.status,
              status === "idle" && upToDate ? styles.statusOk : null,
              status === "error" ? styles.statusWarn : null,
            ]}
            numberOfLines={1}
          >
            {statusLabel}
          </Text>
          {reason && status === "idle" ? (
            <Text style={styles.reason} numberOfLines={2}>
              {reason}
            </Text>
          ) : null}
        </View>
        <Pressable
          onPress={action.onPress}
          disabled={action.disabled}
          style={({ pressed }) => [
            styles.button,
            readyToInstall && styles.buttonReady,
            action.disabled && { opacity: 0.5 },
            pressed && !action.disabled && { opacity: 0.85 },
          ]}
          accessibilityRole="button"
          accessibilityLabel={`Update action: ${action.label}`}
        >
          <Text style={styles.buttonText}>{action.label}</Text>
        </Pressable>
      </View>

      {showBar ? (
        <View style={styles.track}>
          <Animated.View
            style={[
              styles.fill,
              { width: barWidth },
              readyToInstall && { backgroundColor: COLORS.ok },
            ]}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: COLORS.bg,
    borderTopColor: COLORS.border,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  left: {
    flexShrink: 1,
    paddingRight: 12,
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
  statusWarn: {
    color: COLORS.warn,
  },
  reason: {
    color: COLORS.sub,
    fontSize: 11,
    marginTop: 2,
    opacity: 0.8,
  },
  button: {
    backgroundColor: COLORS.accent,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
    minWidth: 76,
    alignItems: "center",
  },
  buttonReady: {
    backgroundColor: COLORS.ok,
  },
  buttonText: {
    color: "#04121A",
    fontWeight: "800",
    fontSize: 13,
  },
  track: {
    height: 4,
    backgroundColor: COLORS.track,
    overflow: "hidden",
  },
  fill: {
    height: 4,
    backgroundColor: COLORS.accent,
  },
});
