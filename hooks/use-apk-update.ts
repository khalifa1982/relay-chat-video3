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
  | "available" // a newer build exists (download not started yet)
  | "downloading" // APK is downloading (see `progress`)
  | "ready" // APK fully downloaded, waiting for the user to apply/restart
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
 * Reads the human-readable installed version name, e.g. "1.0.4".
 * `Application.nativeApplicationVersion` is the versionName on Android.
 */
function getInstalledVersionName(): string | null {
  return Application.nativeApplicationVersion ?? null;
}

/**
 * useApkUpdate drives the self-hosted APK update flow. On each app launch, on
 * foreground resume, and every 10 minutes it checks a fixed manifest URL for a
 * higher build number.
 *
 * The flow is deliberately split into discrete, user-visible phases so the
 * footer status row can present a professional experience:
 *   check -> available -> (download w/ progress bar) -> ready -> restart/apply
 *
 * - For a normal update, detection sets status to "available" and the user taps
 *   "Update" to start the download; when the bar reaches 100% it becomes "ready"
 *   and the button turns into "Restart" which installs + relaunches.
 * - For a mandatory update, the download starts automatically (and the blocking
 *   overlay is shown by the banner).
 *
 * The whole flow is Android-only and a safe no-op elsewhere.
 */
export function useApkUpdate() {
  const [status, setStatus] = useState<ApkUpdateStatus>("idle");
  const [progress, setProgress] = useState(0); // 0..1
  const [manifest, setManifest] = useState<UpdateManifest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mandatory, setMandatory] = useState(false);

  // Human-readable explanation of the last check outcome, shown in the footer
  // so "Check" never silently says "no update" without a reason.
  const [lastReason, setLastReason] = useState<string | null>(null);

  const busyRef = useRef(false);
  const lastCheckRef = useRef(0);
  const startedRef = useRef(false);
  // Path to a fully-downloaded APK that's ready to install.
  const readyFileRef = useRef<string | null>(null);
  const installedBuild = getInstalledBuild();
  const installedVersionName = getInstalledVersionName();

  /** Download the APK with progress, then mark it ready to install. */
  const download = useCallback(async (m: UpdateManifest) => {
    if (Platform.OS !== "android") return;
    if (busyRef.current && status === "downloading") return;

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
      readyFileRef.current = null;

      const resumable = FileSystem.createDownloadResumable(
        apkUrl,
        target,
        {},
        (p) => {
          if (p.totalBytesExpectedToWrite > 0) {
            setProgress(p.totalBytesWritten / p.totalBytesExpectedToWrite);
          }
        },
      );

      const result = await resumable.downloadAsync();
      if (!result || !result.uri) {
        throw new Error("Download failed");
      }
      setProgress(1);
      readyFileRef.current = result.uri;
      // Fully downloaded — wait for the user to apply (or auto-apply if mandatory).
      setStatus("ready");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update download failed");
      setStatus("error");
      setProgress(0);
    }
  }, [status]);

  /** Hand the downloaded APK to the Android package installer (apply + restart). */
  const applyUpdate = useCallback(async () => {
    if (Platform.OS !== "android") return;
    const uri = readyFileRef.current;
    if (!uri) return;
    try {
      setStatus("installing");
      // Expose the file via a content:// URI through Expo's FileProvider.
      const contentUri = await FileSystem.getContentUriAsync(uri);
      await IntentLauncher.startActivityAsync(
        "android.intent.action.INSTALL_PACKAGE",
        {
          data: contentUri,
          flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
          type: "application/vnd.android.package-archive",
        },
      );
      // After the user confirms, Android installs and relaunches the app. If the
      // user cancels, revert to "ready" so they can retry.
      setTimeout(() => {
        setStatus((s) => (s === "installing" ? "ready" : s));
      }, 4000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Install failed");
      setStatus("ready");
    }
  }, []);

  /**
   * Check the manifest for a newer build. By default this only DETECTS the
   * update (status -> "available") and lets the user start the download via the
   * footer button. Mandatory updates auto-download. Pass `autoDownload` to start
   * downloading immediately on detection.
   */
  const check = useCallback(
    async (opts?: { auto?: boolean; autoDownload?: boolean }) => {
      if (Platform.OS !== "android") return; // sideload install is Android-only
      if (busyRef.current) return;
      // Don't re-check while a download/install is already in flight.
      if (status === "downloading" || status === "installing" || status === "ready") {
        return;
      }

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
        if (!res.ok) throw new Error(`Manifest not reachable (HTTP ${res.status})`);

        // Read as text first so we can detect the common failure where the server
        // returns an HTML page (SPA fallback) instead of a JSON manifest.
        const text = await res.text();
        const trimmed = text.trim();
        if (trimmed.startsWith("<")) {
          throw new Error(
            "Update manifest URL returned a web page, not JSON. Host version.json on the server.",
          );
        }
        let json: unknown;
        try {
          json = JSON.parse(trimmed);
        } catch {
          throw new Error("Update manifest is not valid JSON.");
        }
        const m = parseManifest(json);
        if (!m) {
          throw new Error("Update manifest is missing a valid buildNumber.");
        }
        setManifest(m);

        const installed = getInstalledBuild();
        const installedName = getInstalledVersionName();
        const isMandatory = isMandatoryUpdate(installed, m, installedName);
        setMandatory(isMandatory);

        if (isUpdateAvailable(installed, m, installedName) && m) {
          setStatus("available");
          setLastReason(
            `Update available: ${m.versionName ?? `build ${m.buildNumber}`} ` +
              `(installed ${installedName ?? installed ?? "unknown"}).`,
          );
          // Auto-start the download for mandatory updates or when explicitly
          // requested. Never interrupt an active call with an install prompt.
          if ((isMandatory || opts?.autoDownload) && !isCallActive()) {
            // release the busy lock first so download() can proceed
            busyRef.current = false;
            await download(m);
            return;
          }
        } else {
          setStatus("idle");
          setLastReason(
            `You're on the latest version ` +
              `(${installedName ?? installed ?? "unknown"}; server ` +
              `${m.versionName ?? `build ${m.buildNumber}`}).`,
          );
        }
      } catch (e) {
        // Network / parse errors are non-fatal — try again next time, but surface
        // the real reason so the user isn't told a misleading "no update".
        const msg = e instanceof Error ? e.message : "Update check failed";
        setError(msg);
        setLastReason(msg);
        setStatus("idle");
      } finally {
        busyRef.current = false;
      }
    },
    [status, download],
  );

  /** Footer "Update" button: start downloading the known available build. */
  const startDownload = useCallback(() => {
    if (
      manifest &&
      isUpdateAvailable(getInstalledBuild(), manifest, getInstalledVersionName())
    ) {
      void download(manifest);
    }
  }, [manifest, download]);

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
  // is picked up automatically without needing a relaunch.
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
    installedVersionName,
    /** Human-readable explanation of the last check result. */
    lastReason,
    /** Re-check the manifest (detect only). */
    check,
    /** Begin downloading the available build (footer "Update" button). */
    startDownload,
    /** Apply the downloaded APK + restart (footer "Restart" button). */
    applyUpdate,
  } as const;
}
