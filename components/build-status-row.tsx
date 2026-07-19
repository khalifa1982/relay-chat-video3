import { useEffect, useRef } from "react";
import { Animated, Platform, StyleSheet, Text, View } from "react-native";

import type { ApkUpdateStatus } from "@/hooks/use-apk-update";
import { GlossyCheckButton } from "@/components/glossy-check-button";

interface Props {
  /** Installed Android build number (versionCode), or null on web/iOS. */
  installedBuild: number | null;
  /** Installed human version name, e.g. "1.0.4". */
  installedVersionName?: string | null;
  /** The version bundled into this app build (from app.config.ts). */
  betaVersionName?: string | null;
  /** Latest build number reported by the manifest, if known. */
  latestBuild?: number;
  /** Latest human version name reported by the manifest, if known. */
  latestVersionName?: string | null;
  /** Human-readable explanation of the last check result. */
  reason?: string | null;
  status: ApkUpdateStatus;
  /** Download progress 0..1 (only meaningful while downloading). */
  progress?: number;
  /** Epoch ms of the last update check (anchors the countdown ring). */
  lastCheckAt?: number;
  /** Poll window length in ms (the countdown ring drains over this). */
  pollIntervalMs?: number;
  /** Re-check the manifest for a newer build. */
  onCheck?: () => void;
  /** Start downloading the available build ("Update" button). */
  onDownload?: () => void;
  /** Apply the downloaded APK + restart ("Restart" button). */
  onApply?: () => void;
}

const COLORS = {
  bg: "#080A0F",
  border: "#161B26",
  track: "#1A1F2B",
  text: "#F2F4F8",
  sub: "#8B93AD",
  accent: "#22D3EE",
  ok: "#34D399",
  warn: "#F59E0B",
};

/**
 * A compact, professional status row that shows the user's current app version,
 * the latest available version, and — when an update exists — a live download
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
  betaVersionName,
  latestBuild,
  latestVersionName,
  reason,
  status,
  progress = 0,
  lastCheckAt = Date.now(),
  pollIntervalMs = 10 * 60_000,
  onCheck,
  onDownload,
  onApply,
}: Props) {
  // On iOS, hide the entire update row since iOS updates go through the App Store.
  if (Platform.OS === "ios") return null;

  // Version label: show the installed version name and build number.
  const versionLabel = betaVersionName ?? installedVersionName ?? null;
  const latestLabel = latestVersionName ?? (latestBuild != null ? String(latestBuild) : null);
  const upToDate =
    latestBuild != null && installedBuild != null
      ? installedBuild >= latestBuild
      : status === "idle";

  // The download has fully completed but the installer hasn't taken over yet.
  const readyToInstall = status === "ready";
  const showBar =
    status === "downloading" ||
    status === "verifying" ||
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
      case "verifying":
        return "Verifying update…";
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

  // A single, slim line. When idle/up-to-date we show only the compact version
  // identity so the footer is as small as possible and the WebView gets the
  // maximum area. During an update we surface the phase text instead.
  const showPhaseText =
    status !== "idle" || (status === "idle" && !upToDate);

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <View style={styles.left}>
          <View style={styles.versionRow}>
            <Text style={styles.build} numberOfLines={1}>
              v{versionLabel ?? "—"}
            </Text>
            {installedBuild != null ? (
              <Text style={styles.buildMeta} numberOfLines={1}>
                {"·"} build {installedBuild}
                {latestLabel != null && !upToDate ? `  ·  latest ${latestLabel}` : ""}
              </Text>
            ) : null}
          </View>
          {showPhaseText ? (
            <Text
              style={[
                styles.status,
                status === "error" ? styles.statusWarn : null,
              ]}
              numberOfLines={1}
            >
              {statusLabel}
            </Text>
          ) : null}
        </View>
        <GlossyCheckButton
          status={status}
          progress={progress}
          lastCheckAt={lastCheckAt}
          pollIntervalMs={pollIntervalMs}
          onCheck={onCheck}
          onDownload={onDownload}
          onApply={onApply}
        />
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
    paddingHorizontal: 14,
    paddingVertical: 5,
  },
  left: {
    flexShrink: 1,
    paddingRight: 12,
  },
  versionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  build: {
    color: COLORS.text,
    fontSize: 13,
    fontWeight: "800",
  },
  buildMeta: {
    color: COLORS.sub,
    fontSize: 11,
    fontWeight: "600",
  },
  status: {
    color: COLORS.sub,
    fontSize: 11.5,
    marginTop: 2,
  },
  statusWarn: {
    color: COLORS.warn,
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
