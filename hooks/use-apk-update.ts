import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, type AppStateStatus, Platform } from "react-native";
import * as Application from "expo-application";
import * as IntentLauncher from "expo-intent-launcher";
// Legacy FileSystem API exposes download progress callbacks, which the new
// File API does not, so we use it for the resumable APK download.
import * as FileSystem from "expo-file-system/legacy";

import { verifyDownloadedApk, deleteApkFile } from "@/lib/apk-integrity";
import {
  UPDATE_MANIFEST_URL,
  type UpdateManifest,
  isMandatoryUpdate,
  isUpdateAvailable,
  parseManifest,
  resolveApkUrl,
  POLL_INTERVAL_MS,
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
  | "verifying" // APK downloaded, verifying its SHA-256 before install
  | "ready" // APK fully downloaded, waiting for the user to apply/restart
  | "installing" // handing the APK to the Android installer
  | "error"; // a recoverable error occurred

const MIN_CHECK_INTERVAL_MS = 30_000;
// Poll cadence (10 min) is defined once in apk-update-config so the footer
// countdown ring drains over exactly the same window.

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
  // Timestamp (ms epoch) of when the most recent check STARTED. The footer uses
  // this together with POLL_INTERVAL_MS to render the draining countdown ring,
  // and resets the ring whenever it changes.
  const [lastCheckAt, setLastCheckAt] = useState<number>(() => Date.now());

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

  // Track retry attempts to prevent infinite download loops.
  const retryCountRef = useRef(0);
  /** Content-Length of the in-flight download, for the size check. */
  const expectedBytesRef = useRef<number | null>(null);
  /** Sticky: a digest has disagreed at least once for this update. */
  const sawMismatchRef = useRef(false);
  // Maximum number of automatic retries when verification fails.
  const MAX_RETRIES = 1;

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
      expectedBytesRef.current = null;

      const resumable = FileSystem.createDownloadResumable(
        apkUrl,
        target,
        {},
        (p) => {
          if (p.totalBytesExpectedToWrite > 0) {
            expectedBytesRef.current = p.totalBytesExpectedToWrite;
            setProgress(p.totalBytesWritten / p.totalBytesExpectedToWrite);
          }
        },
      );

      const result = await resumable.downloadAsync();
      if (!result || !result.uri) {
        throw new Error("Download failed");
      }
      setProgress(1);

      // Integrity verification before handing the file to the package installer.
      // Android's own signature check is the real trust anchor (it refuses an
      // update signed with a different key), so this is defence in depth against
      // a corrupt or partial download — and it must never strand a user on an old
      // build. It is therefore allowed to time out on a slow device.
      //
      // But once a digest has actually DISAGREED, the timeout allowance is
      // withdrawn for the retry: previously a mismatching file was deleted,
      // re-downloaded, and then installed anyway if the second hash ran slowly,
      // which turned a DETECTED bad file into an install.
      setStatus("verifying");
      const verifyResult = await verifyDownloadedApk(
        result.uri,
        m.sha256,
        // The size the download actually reported. This argument existed and was
        // never passed, so the documented size check was dead at the only call
        // site — the sole remaining check was "the file is non-empty".
        expectedBytesRef.current,
        { allowSkipOnTimeout: !sawMismatchRef.current },
      );
      if (verifyResult.mismatch) sawMismatchRef.current = true;
      if (!verifyResult.shouldInstall) {
        // File is corrupt — delete it.
        await deleteApkFile(result.uri);

        // Auto-retry once: if we haven't retried yet, try downloading again.
        if (retryCountRef.current < MAX_RETRIES) {
          retryCountRef.current += 1;
          console.warn(
            `[APK Update] Verification failed (${verifyResult.reason}), retrying (attempt ${retryCountRef.current})...`,
          );
          // Recursive retry — will go through the full download + verify again.
          await download(m);
          return;
        }

        // Already retried — give up and show error.
        throw new Error(
          `${verifyResult.reason} (failed after ${MAX_RETRIES + 1} attempts)`,
        );
      }

      // Success — reset per-update state for the next update.
      retryCountRef.current = 0;
      sawMismatchRef.current = false;
      readyFileRef.current = result.uri;
      // Fully downloaded + verified — wait for the user to apply (or auto-apply).
      setStatus("ready");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update download failed");
      setStatus("error");
      setProgress(0);
      // Reset retry counter so the next manual attempt starts fresh.
      retryCountRef.current = 0;
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
      setLastCheckAt(now);
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
          // Up-to-date is already conveyed by the concise "Up to date" status
          // label; don't surface a verbose secondary line for it.
          setLastReason(null);
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

  // Check once on first mount (not throttled, so the countdown ring anchors to
  // a real check time right away).
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void check();
  }, [check]);

  // Re-check whenever the app returns to the foreground.
  useEffect(() => {
    const onChange = (state: AppStateStatus) => {
      if (state === "active") void check({ auto: true });
    };
    const sub = AppState.addEventListener("change", onChange);
    return () => sub.remove();
  }, [check]);

  // Poll on the 10-minute cadence, anchored to the LAST check time. Re-arming on
  // `lastCheckAt` keeps the automatic check aligned with the footer countdown
  // ring: whenever a check happens (manual, resume, or auto), the ring resets to
  // full and the next auto check is scheduled exactly POLL_INTERVAL_MS later.
  useEffect(() => {
    const elapsed = Date.now() - lastCheckAt;
    const remaining = Math.max(0, POLL_INTERVAL_MS - elapsed);
    const id = setTimeout(() => {
      void check({ auto: true });
    }, remaining);
    return () => clearTimeout(id);
  }, [check, lastCheckAt]);

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
    /** Epoch ms of when the most recent check started (drives the countdown ring). */
    lastCheckAt,
    /** Poll window length in ms (the countdown ring drains over this). */
    pollIntervalMs: POLL_INTERVAL_MS,
    /** Re-check the manifest (detect only). */
    check,
    /** Begin downloading the available build (footer "Update" button). */
    startDownload,
    /** Apply the downloaded APK + restart (footer "Restart" button). */
    applyUpdate,
  } as const;
}
