/**
 * APK integrity verification for the self-hosted auto-update flow.
 *
 * WHAT ACTUALLY PROTECTS THE USER, in order:
 *  1. ANDROID'S OWN SIGNATURE ENFORCEMENT. The package installer refuses an
 *     update whose signing certificate differs from the installed app's, and
 *     refuses a versionCode downgrade. That — not this file — is the trust
 *     anchor that stops a tampered APK being installed.
 *  2. HTTPS to the release host.
 *  3. The manifest SHA-256, checked here. Note its limit: the manifest and the
 *     APK come from the SAME host, so the digest catches CORRUPTION and a
 *     partial download, not a compromised release host. Do not oversell it.
 *
 * Hashing 50+ MB in JavaScript on a phone is slow, so verification is
 * best-effort and must never strand a user on an old build. But "best effort"
 * previously meant: any failure except a timely mismatch resulted in an install
 * that reported success — including, after a retry, a file already KNOWN to
 * mismatch. The policy is now:
 *
 *  - hash matches            → install, reported as verified.
 *  - hash MISMATCHES         → never install this download. A mismatch is
 *                              evidence; it is terminal for the attempt, and it
 *                              disables the timeout allowance for the retry, so
 *                              a known-bad file can no longer slip in by simply
 *                              being slow to hash the second time.
 *  - size mismatch           → never install.
 *  - hash times out / errors → install IS allowed (Android's signature check is
 *                              the real gate and blocking here would strand
 *                              users on slow devices), but the result says
 *                              UNVERIFIED so the caller can tell the truth
 *                              rather than claim a check that did not run.
 *  - no hash in the manifest → install, reported as unverified.
 */
import * as FileSystem from "expo-file-system/legacy";

import { Sha256, base64ToBytes } from "./sha256";

// Re-export the pure helpers so existing import sites keep working.
export { Sha256, base64ToBytes } from "./sha256";

// Read the APK in 4 MiB windows: base64 reads dominate, so fewer, larger reads
// finish materially sooner than the previous 2 MiB.
const CHUNK_BYTES = 4 * 1024 * 1024;

/** Floor for the verification budget, for a small file. */
const VERIFY_TIMEOUT_MIN_MS = 20_000;
/** Additional budget per MiB. A flat 10s could not hash a 53 MB APK on any real
 *  device — the check "timed out" essentially always, which is why it had become
 *  decorative. Scaling with size means it normally COMPLETES. */
const VERIFY_TIMEOUT_PER_MIB_MS = 1_500;
/** Absolute ceiling so a pathological file cannot hang the update UI. */
const VERIFY_TIMEOUT_MAX_MS = 180_000;

export function verifyTimeoutMsFor(sizeBytes: number): number {
  const mib = Math.max(0, sizeBytes) / (1024 * 1024);
  const budget = VERIFY_TIMEOUT_MIN_MS + mib * VERIFY_TIMEOUT_PER_MIB_MS;
  return Math.min(VERIFY_TIMEOUT_MAX_MS, Math.round(budget));
}

export type VerifyResult = {
  /** Hash matched (true), did not match (false), or was not computed (null). */
  passed: boolean | null;
  /** Human-readable reason for the result. */
  reason: string;
  /** Whether the file may be handed to the package installer. */
  shouldInstall: boolean;
  /**
   * True ONLY when a digest was actually computed and matched. The caller must
   * use this — not `shouldInstall` — when telling the user anything was verified.
   */
  verified: boolean;
  /**
   * A digest was computed and DISAGREED. The caller must not allow a subsequent
   * attempt to fall back to the timeout allowance.
   */
  mismatch: boolean;
};

/**
 * Compute the SHA-256 of a local file, reading it in fixed-size windows.
 * Returns a lowercase hex digest.
 */
async function sha256OfFile(uri: string, size: number): Promise<string> {
  const hasher = new Sha256();
  for (let position = 0; position < size; position += CHUNK_BYTES) {
    const length = Math.min(CHUNK_BYTES, size - position);
    const b64 = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
      position,
      length,
    });
    hasher.update(base64ToBytes(b64));
  }
  return hasher.digestHex();
}

/**
 * Race a promise against a timeout. Rejects with a timeout error if the
 * promise doesn't resolve within `ms` milliseconds.
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Verification timed out after ${ms}ms`)),
      ms,
    );
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

/**
 * Verify a downloaded APK file. This is the main entry point called by the
 * update hook.
 *
 * @param uri - Local file URI of the downloaded APK
 * @param expectedSha256 - Expected lowercase hex SHA-256 from the manifest (or undefined/null)
 * @param expectedSize - Expected file size in bytes (optional, from Content-Length)
 * @returns VerifyResult indicating whether to install or re-download
 */
export async function verifyDownloadedApk(
  uri: string,
  expectedSha256?: string | null,
  expectedSize?: number | null,
  opts?: {
    /** Allow install when the digest could not be computed in time. Defaults to
     *  true; the caller MUST pass false once a mismatch has been seen. */
    allowSkipOnTimeout?: boolean;
  },
): Promise<VerifyResult> {
  const allowSkipOnTimeout = opts?.allowSkipOnTimeout !== false;
  // Step 1: Check file exists and get its size.
  let info: FileSystem.FileInfo;
  try {
    info = await FileSystem.getInfoAsync(uri);
  } catch {
    return {
      passed: false,
      reason: "Downloaded file not accessible",
      shouldInstall: false,
      verified: false,
      mismatch: false,
    };
  }

  if (!info.exists) {
    return {
      passed: false,
      reason: "Downloaded file does not exist",
      shouldInstall: false,
      verified: false,
      mismatch: false,
    };
  }

  const fileSize = typeof info.size === "number" ? info.size : 0;
  if (fileSize <= 0) {
    return {
      passed: false,
      reason: "Downloaded file is empty",
      shouldInstall: false,
      verified: false,
      mismatch: false,
    };
  }

  // Step 2: Size check (fast, catches obvious corruption).
  if (expectedSize && expectedSize > 0) {
    // Allow 1% tolerance for filesystem reporting differences.
    const tolerance = expectedSize * 0.01;
    if (Math.abs(fileSize - expectedSize) > tolerance) {
      return {
        passed: false,
        reason: `Size mismatch: expected ~${expectedSize} bytes, got ${fileSize}`,
        shouldInstall: false,
        verified: false,
        mismatch: true,
      };
    }
  }

  // Step 3: If no hash provided, skip verification (backward compatible).
  if (!expectedSha256) {
    return {
      passed: null,
      reason: "No hash in manifest — installed unverified",
      shouldInstall: true,
      verified: false,
      mismatch: false,
    };
  }

  // Step 4: Attempt SHA-256 with a strict timeout.
  try {
    const actual = await withTimeout(
      sha256OfFile(uri, fileSize),
      verifyTimeoutMsFor(fileSize),
    );
    if (actual === expectedSha256) {
      return {
        passed: true,
        reason: "SHA-256 verified",
        shouldInstall: true,
        verified: true,
        mismatch: false,
      };
    } else {
      // Hash mismatch — file is corrupt or tampered. Delete and retry.
      return {
        passed: false,
        reason: `Hash mismatch: expected ${expectedSha256.slice(0, 12)}…, got ${actual.slice(0, 12)}…`,
        shouldInstall: false,
        verified: false,
        mismatch: true,
      };
    }
  } catch (err) {
    // Timeout or crash during hashing — this is the common case on slower
    // devices with a 53 MB file. Since HTTPS already guarantees transport
    // integrity, we allow the install to proceed.
    const msg = err instanceof Error ? err.message : "Verification error";
    console.warn(`[APK Update] Verification did not complete: ${msg}`);
    return {
      passed: null,
      reason: allowSkipOnTimeout
        ? `Could not verify (${msg}) — installing unverified`
        : `Could not verify (${msg}) after a mismatch — refusing to install`,
      // Blocked once a mismatch has been seen: otherwise a file already known to
      // be wrong installs on the retry simply by hashing too slowly.
      shouldInstall: allowSkipOnTimeout,
      verified: false,
      mismatch: false,
    };
  }
}

/**
 * Delete a downloaded APK file (cleanup on failure or before retry).
 */
export async function deleteApkFile(uri: string): Promise<void> {
  try {
    await FileSystem.deleteAsync(uri, { idempotent: true });
  } catch {
    // Best-effort cleanup
  }
}
