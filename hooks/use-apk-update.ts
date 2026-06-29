import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, type AppStateStatus, Platform } from "react-native";
import * as Application from "expo-application";
import * as IntentLauncher from "expo-intent-launcher";
// Legacy FileSystem API exposes download progress callbacks, which the new
// File API does not, so we use it for the resumable APK download.
import * as FileSystem from "expo-file-system/legacy";

import {
  UPDATE_MANIFEST_URL,
  type UpdateManifest,
  isMandatoryUpdate,
  isUpdateAvailable,
  parseManifest,
  resolveApkUrl,
} from "@/lib/apk-update-config";
import { isCallActive } from "@/hooks/use-call-session";

/**
 * Phases of the self-hosted APK update flow.
 */
export type ApkUpdateStatus =
  | "idle" // nothing to do / up to date
  | "checking" // fetching the manifest
  | "available" // a newer build exists (about to download)
  | "downloading" // APK is downloading (see `progress`)
  | "installing" // handing the APK to the Android installer
  | "error"; // a recoverable error occurred

const MIN_CHECK_INTERVAL_MS = 30_000;
// Poll the update manifest on this cadence while the app is running, in addition
// to launch + foreground-resume checks. The user asked for a 10-minute auto check.
const POLL_INTERVAL_MS = 10 * 60_000;

/**
 * Reads the currently installed Android build number as an integer.
 * `Application.nativeBuildVersion` is the versionCode on Android.
 */
function getInstalledBuild(): number | null {
  const raw = Application.nativeBuildVersion;
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.floor(n) : null;
}

/**
 * useApkUpdate drives the user's requested behaviour: on each app launch (and
 * when returning to the foreground) it checks a fixed manifest URL for a higher
 * build number. If found, it downloads the APK with a live progress bar and
 * launches the Android installer, which installs the update and restarts the
 * app. The whole flow is Android-only and a safe no-op elsewhere.
 */
export function useApkUpdate() {
  const [status, setStatus] = useState<ApkUpdateStatus>("idle");
  const [progress, setProgress] = useState(0); // 0..1
  const [manifest, setManifest] = useState<UpdateManifest | null>(null);
  const [error, setError] = useState<string | null>(null);

  const busyRef = useRef(false);
  const lastCheckRef = useRef(0);
  const startedRef = useRef(false);
  const [mandatory, setMandatory] = useState(false);
  const installedBuild = getInstalledBuild();

  /** Download the APK (with progress) then launch the Android installer. */
  const downloadAndInstall = useCallback(async (m: UpdateManifest) => {
    if (Platform.OS !== "android") return;
    const apkUrl = resolveApkUrl(m);
    const target = `${FileSystem.cacheDirectory}relay-update-${m.buildNumber}.apk`;

    try {
      // Remove any stale partial file from a previous attempt.
      try {
        const info = await FileSystem.getInfoAsync(target);
        if (info.exists) await FileSystem.deleteAsync(target, { idempotent: true });
      } catch {
        // ignore
      }

      setStatus("downloading");
      setProgress(0);

      const resumable = FileSystem.createDownloadResumable(
        apkUrl,
        target,
        {},
        (p) => {
          if (p.totalBytesExpectedToWrite > 0) {
            setProgress(
              p.totalBytesWritten / p.totalBytesExpectedToWrite,
            );
          }
        },
      );

      const result = await resumable.downloadAsync();
      if (!result || !result.uri) {
        throw new Error("Download failed");
      }
      setProgress(1);

      // Hand the downloaded APK to the system package installer. We must expose
      // the file via a content:// URI; FileSystem.getContentUriAsync does that
      // through the app's configured FileProvider.
      setStatus("installing");
      const contentUri = await FileSystem.getContentUriAsync(result.uri);

      await IntentLauncher.startActivityAsync(
        "android.intent.action.INSTALL_PACKAGE",
        {
          data: contentUri,
          flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
          type: "application/vnd.android.package-archive",
        },
      );
      // After the user confirms, Android installs and relaunches the app.
      // Keep status as installing; if the user cancels we revert to idle below.
      setTimeout(() => {
        setStatus((s) => (s === "installing" ? "idle" : s));
        setProgress(0);
      }, 4000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
      setStatus("error");
      setProgress(0);
    }
  }, []);

  /** Check the manifest; if a newer build exists, start the download/install. */
  const check = useCallback(
    async (opts?: { auto?: boolean }) => {
      if (Platform.OS !== "android") return; // sideload install is Android-only
      if (busyRef.current) return;

      const now = Date.now();
      if (opts?.auto && now - lastCheckRef.current < MIN_CHECK_INTERVAL_MS) {
        return;
      }
      lastCheckRef.current = now;
      busyRef.current = true;
      setError(null);

      try {
        setStatus("checking");
        const res = await fetch(`${UPDATE_MANIFEST_URL}?t=${now}`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`Manifest HTTP ${res.status}`);
        const json = await res.json();
        const m = parseManifest(json);
        setManifest(m);

        const installed = getInstalledBuild();
        setMandatory(isMandatoryUpdate(installed, m));
        if (isUpdateAvailable(installed, m) && m) {
          setStatus("available");
          // Don't interrupt an active call with an install prompt.
          if (!isCallActive()) {
            await downloadAndInstall(m);
          }
        } else {
          setStatus("idle");
        }
      } catch (e) {
        // Network / parse errors are non-fatal — try again next launch.
        setError(e instanceof Error ? e.message : "Update check failed");
        setStatus("idle");
      } finally {
        busyRef.current = false;
      }
    },
    [downloadAndInstall],
  );

  // Manual trigger for a "Download now" button (e.g. when a call had blocked it).
  const installNow = useCallback(() => {
    if (manifest) void downloadAndInstall(manifest);
  }, [manifest, downloadAndInstall]);

  // Check once on first mount.
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void check({ auto: true });
  }, [check]);

  // Re-check whenever the app returns to the foreground.
  useEffect(() => {
    const onChange = (state: AppStateStatus) => {
      if (state === "active") void check({ auto: true });
    };
    const sub = AppState.addEventListener("change", onChange);
    return () => sub.remove();
  }, [check]);

  // Poll every 10 minutes while the app is running so a freshly published build
  // is picked up automatically without needing a relaunch. The MIN_CHECK_INTERVAL
  // guard inside `check` prevents redundant overlapping checks.
  useEffect(() => {
    const id = setInterval(() => {
      void check({ auto: true });
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [check]);

  return {
    status,
    progress,
    manifest,
    error,
    mandatory,
    installedBuild,
    check,
    installNow,
  } as const;
}
