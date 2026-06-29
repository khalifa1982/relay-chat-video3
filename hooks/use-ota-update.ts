import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, type AppStateStatus, Platform } from "react-native";
import * as Updates from "expo-updates";

/**
 * Possible states of the OTA self-update flow.
 * - idle:        nothing happening
 * - checking:    asking the update server whether a newer app bundle exists
 * - downloading: a new bundle was found and is being fetched
 * - restarting:  a new bundle is ready; the app is about to reload into it
 */
export type OtaStatus = "idle" | "checking" | "downloading" | "restarting";

const MIN_CHECK_INTERVAL_MS = 60_000; // don't hammer the server on rapid resumes

/**
 * useOtaUpdate drives the "app updates itself" behaviour requested by the user:
 * it asks the configured Expo Updates URL whether a newer app bundle is
 * available, downloads it, and then restarts the app into the new version —
 * with no manual APK download/reinstall.
 *
 * It runs automatically on mount and whenever the app returns to the
 * foreground (so a long-lived install still picks up new releases). In Expo Go
 * and during local development `Updates.isEnabled` is false, so every call is a
 * safe no-op.
 */
export function useOtaUpdate(options?: { autoRestart?: boolean }) {
  const autoRestart = options?.autoRestart ?? true;
  const [status, setStatus] = useState<OtaStatus>("idle");
  const [updateReady, setUpdateReady] = useState(false);
  const lastCheckRef = useRef(0);
  const busyRef = useRef(false);

  const applyUpdate = useCallback(async () => {
    setStatus("restarting");
    try {
      await Updates.reloadAsync();
    } catch {
      // If reload fails, surface the ready state so a manual restart can apply it.
      setStatus("idle");
      setUpdateReady(true);
    }
  }, []);

  const checkForUpdate = useCallback(async () => {
    // Disabled in Expo Go / dev / web — nothing to do.
    if (!Updates.isEnabled || Platform.OS === "web") return;
    if (busyRef.current) return;

    const now = Date.now();
    if (now - lastCheckRef.current < MIN_CHECK_INTERVAL_MS) return;
    lastCheckRef.current = now;

    busyRef.current = true;
    try {
      setStatus("checking");
      const result = await Updates.checkForUpdateAsync();
      if (result.isAvailable) {
        setStatus("downloading");
        const fetched = await Updates.fetchUpdateAsync();
        if (fetched.isNew) {
          setUpdateReady(true);
          if (autoRestart) {
            await applyUpdate();
            return;
          }
        }
      }
      setStatus("idle");
    } catch {
      // Network errors etc. are non-fatal: the cached bundle keeps running and
      // we simply try again on the next launch / resume.
      setStatus("idle");
    } finally {
      busyRef.current = false;
    }
  }, [applyUpdate, autoRestart]);

  // Check once on mount.
  useEffect(() => {
    void checkForUpdate();
  }, [checkForUpdate]);

  // Re-check when the app returns to the foreground.
  useEffect(() => {
    const onChange = (state: AppStateStatus) => {
      if (state === "active") void checkForUpdate();
    };
    const sub = AppState.addEventListener("change", onChange);
    return () => sub.remove();
  }, [checkForUpdate]);

  return { status, updateReady, checkForUpdate, applyUpdate } as const;
}
