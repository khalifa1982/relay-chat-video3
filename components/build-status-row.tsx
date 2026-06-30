import { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";

import type { ApkUpdateStatus } from "@/hooks/use-apk-update";
import { GlossyCheckButton } from "@/components/glossy-check-button";

interface Props {
  /** Installed Android build number (versionCode), or null on web/iOS. */
  installedBuild: number | null;
  /** Installed human version name, e.g. "1.0.4". */
  installedVersionName?: string | null;
  /** The version bundled into this app build (shown as the "Beta" line). */
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
  // Two distinct version identities surfaced to the user:
  //  - Beta: the version this app build ships with (from app.config.ts).
  //  - Installed: what is actually running on this device (native versionName
  //    + build), which differs once an OTA APK update has been applied.
  const betaLabel = betaVersionName ?? installedVersionName ?? null;
  const installedNameLabel =
    installedVersionName ?? (installedBuild != null ? String(installedBuild) : "—");
  const installedLabel =
    installedBuild != null
      ? `${installedNameLabel} · build ${installedBuild}`
      : installedNameLabel;
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
          <View style={styles.versionRow}>
            <View style={styles.betaBadge}>
              <Text style={styles.betaBadgeText}>BETA</Text>
            </View>
            <Text style={styles.build} numberOfLines={1}>
              {betaLabel ?? "—"}
            </Text>
          </View>
          <Text style={styles.installed} numberOfLines={1}>
            Installed: {installedLabel}
            {latestLabel != null ? `  ·  latest ${latestLabel}` : ""}
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
    paddingHorizontal: 16,
    paddingVertical: 10,
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
  betaBadge: {
    backgroundColor: "rgba(6, 182, 212, 0.16)",
    borderColor: COLORS.accent,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  betaBadgeText: {
    color: COLORS.accent,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.2,
  },
  build: {
    color: COLORS.text,
    fontSize: 14,
    fontWeight: "800",
  },
  installed: {
    color: COLORS.sub,
    fontSize: 11.5,
    fontWeight: "600",
    marginTop: 3,
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
