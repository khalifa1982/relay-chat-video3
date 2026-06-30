/**
 * Configuration + pure helpers for the self-hosted APK auto-update system.
 *
 * How it works (Android only):
 *  1. On every launch the app fetches a small JSON manifest from a fixed URL.
 *  2. The manifest declares the latest `buildNumber` (an integer) and the APK
 *     download URL.
 *  3. If the manifest `buildNumber` is greater than the build installed on the
 *     device, the app downloads the APK (with a progress bar) and launches the
 *     Android package installer to update + restart.
 *
 * To publish a new version, the server owner simply:
 *  - builds a new APK with an incremented native build number,
 *  - uploads it to the APK URL (overwriting the previous file), and
 *  - bumps `buildNumber` in the manifest JSON.
 */

/**
 * Base URL of the update folder. Override via EXPO_PUBLIC_UPDATE_BASE_URL.
 *
 * Default: the PUBLIC GitHub Releases host `khalifa1982/relay-app-releases`.
 * GitHub's `releases/latest/download/<asset>` always points at the newest
 * published release, so the app never needs to change when a new build ships —
 * you just publish a new release with `version.json` + `relay-mobile.apk`.
 */
export const UPDATE_BASE_URL = (
  (process.env.EXPO_PUBLIC_UPDATE_BASE_URL ?? "").trim() ||
  "https://github.com/khalifa1982/relay-app-releases/releases/latest/download"
).replace(/\/+$/, "");

/**
 * Fixed manifest URL. Override via EXPO_PUBLIC_UPDATE_MANIFEST_URL.
 */
export const UPDATE_MANIFEST_URL =
  (process.env.EXPO_PUBLIC_UPDATE_MANIFEST_URL ?? "").trim() ||
  `${UPDATE_BASE_URL}/version.json`;

/**
 * Default APK download URL (used when the manifest doesn't supply one).
 * Override via EXPO_PUBLIC_UPDATE_APK_URL.
 */
export const UPDATE_APK_URL =
  (process.env.EXPO_PUBLIC_UPDATE_APK_URL ?? "").trim() ||
  `${UPDATE_BASE_URL}/relay-mobile.apk`;

/**
 * How often (ms) the app polls the manifest for a newer build while running.
 * The footer Check control drains its ring over exactly this window, then
 * triggers a check at zero and refills. The user asked for a 10-minute cycle.
 */
export const POLL_INTERVAL_MS = 10 * 60_000;

/**
 * Compare two dotted version-name strings (e.g. "1.0.5" vs "1.0.4").
 * Returns 1 if a>b, -1 if a<b, 0 if equal/uncomparable.
 * Non-numeric or missing segments are treated as 0.
 */
export function compareVersionNames(a?: string | null, b?: string | null): number {
  if (!a || !b) return 0;
  const pa = String(a).trim().replace(/^v/i, "").split(".");
  const pb = String(b).trim().replace(/^v/i, "").split(".");
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const na = Math.floor(Number(pa[i] ?? 0)) || 0;
    const nb = Math.floor(Number(pb[i] ?? 0)) || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

/** Shape of the version manifest hosted at UPDATE_MANIFEST_URL. */
export interface UpdateManifest {
  /** Latest available native build number (integer, monotonically increasing). */
  buildNumber: number;
  /** Optional human-readable version name, e.g. "1.2.0". */
  versionName?: string;
  /** APK download URL. Falls back to UPDATE_APK_URL when omitted. */
  apkUrl?: string;
  /** Optional release notes shown to the user. */
  notes?: string;
  /** Optional flag to force the update (no skip). Reserved for future use. */
  mandatory?: boolean;
}

/**
 * Parse + validate a raw manifest payload. Returns null when invalid so the
 * caller can safely ignore malformed/unreachable manifests.
 */
export function parseManifest(raw: unknown): UpdateManifest | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const build = Number(obj.buildNumber);
  if (!Number.isFinite(build) || build <= 0) return null;
  const manifest: UpdateManifest = { buildNumber: Math.floor(build) };
  if (typeof obj.versionName === "string") manifest.versionName = obj.versionName;
  if (typeof obj.apkUrl === "string" && obj.apkUrl) manifest.apkUrl = obj.apkUrl;
  if (typeof obj.notes === "string") manifest.notes = obj.notes;
  if (typeof obj.mandatory === "boolean") manifest.mandatory = obj.mandatory;
  return manifest;
}

/**
 * Decide whether an update should be offered: the server build must be a valid
 * integer strictly greater than the currently installed build.
 */
export function isUpdateAvailable(
  installedBuild: number | null | undefined,
  manifest: UpdateManifest | null,
  installedVersionName?: string | null,
): boolean {
  if (!manifest) return false;
  // Primary, robust signal: compare the human version name (e.g. 1.0.5 > 1.0.4)
  // when both sides provide one. This matches how releases are reasoned about
  // and works even if the native versionCode was not bumped.
  if (installedVersionName && manifest.versionName) {
    const cmp = compareVersionNames(manifest.versionName, installedVersionName);
    if (cmp !== 0) return cmp > 0;
    // Equal version names -> fall through to buildNumber as a tie-breaker.
  }
  if (installedBuild == null || !Number.isFinite(installedBuild)) {
    // If we can't read the installed build, be conservative and do NOT prompt
    // (avoids an endless update loop on a misconfigured build).
    return false;
  }
  return manifest.buildNumber > installedBuild;
}

/** Resolve the effective APK URL for a manifest. */
export function resolveApkUrl(manifest: UpdateManifest | null): string {
  return (manifest && manifest.apkUrl) || UPDATE_APK_URL;
}

/**
 * Whether the available update is mandatory (blocking). True only when an update
 * is actually available AND the manifest marks it mandatory.
 */
export function isMandatoryUpdate(
  installedBuild: number | null | undefined,
  manifest: UpdateManifest | null,
  installedVersionName?: string | null,
): boolean {
  return (
    isUpdateAvailable(installedBuild, manifest, installedVersionName) === true &&
    manifest?.mandatory === true
  );
}
