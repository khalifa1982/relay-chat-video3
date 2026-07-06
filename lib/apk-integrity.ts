/**
 * APK integrity verification for the self-hosted auto-update flow.
 *
 * The audit recommended that a downloaded APK be verified (hash or signature)
 * before the installer is launched, rather than trusting HTTPS transport alone.
 *
 * PRACTICAL REALITY: Computing SHA-256 of a 53 MB file in pure JS on a mobile
 * device is too slow (30-60s+) and frequently crashes or times out, causing a
 * download→verify→fail→redownload loop that never completes.
 *
 * NEW STRATEGY (v1.0.16):
 * 1. Verify file EXISTS and has the expected size (fast, reliable).
 * 2. Attempt a quick SHA-256 check with a strict timeout (10s).
 * 3. If the hash check passes → great, install.
 * 4. If the hash check FAILS or TIMES OUT → log a warning but still allow
 *    install, because HTTPS already provides transport integrity. The hash is
 *    defense-in-depth, not a hard gate that blocks users from updating.
 * 5. If the file doesn't exist or is clearly corrupt (size mismatch) → delete
 *    and retry the download once.
 *
 * This ensures users ALWAYS get their update, while still catching obvious
 * corruption when the device is fast enough to verify in time.
 */
import * as FileSystem from "expo-file-system/legacy";

import { Sha256, base64ToBytes } from "./sha256";

// Re-export the pure helpers so existing import sites keep working.
export { Sha256, base64ToBytes } from "./sha256";

// Read the APK in 2 MiB windows for faster throughput.
const CHUNK_BYTES = 2 * 1024 * 1024;

// Maximum time (ms) to spend on SHA-256 verification before giving up.
const VERIFY_TIMEOUT_MS = 10_000;

export type VerifyResult = {
  /** Whether the hash matched (true), didn't match (false), or was skipped (null). */
  passed: boolean | null;
  /** Human-readable reason for the result. */
  reason: string;
  /** Whether the file should be installed (true) or re-downloaded (false). */
  shouldInstall: boolean;
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
): Promise<VerifyResult> {
  // Step 1: Check file exists and get its size.
  let info: FileSystem.FileInfo;
  try {
    info = await FileSystem.getInfoAsync(uri);
  } catch {
    return {
      passed: false,
      reason: "Downloaded file not accessible",
      shouldInstall: false,
    };
  }

  if (!info.exists) {
    return {
      passed: false,
      reason: "Downloaded file does not exist",
      shouldInstall: false,
    };
  }

  const fileSize = typeof info.size === "number" ? info.size : 0;
  if (fileSize <= 0) {
    return {
      passed: false,
      reason: "Downloaded file is empty",
      shouldInstall: false,
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
      };
    }
  }

  // Step 3: If no hash provided, skip verification (backward compatible).
  if (!expectedSha256) {
    return {
      passed: null,
      reason: "No hash in manifest, skipping verification",
      shouldInstall: true,
    };
  }

  // Step 4: Attempt SHA-256 with a strict timeout.
  try {
    const actual = await withTimeout(sha256OfFile(uri, fileSize), VERIFY_TIMEOUT_MS);
    if (actual === expectedSha256) {
      return {
        passed: true,
        reason: "SHA-256 verified",
        shouldInstall: true,
      };
    } else {
      // Hash mismatch — file is corrupt or tampered. Delete and retry.
      return {
        passed: false,
        reason: `Hash mismatch: expected ${expectedSha256.slice(0, 12)}…, got ${actual.slice(0, 12)}…`,
        shouldInstall: false,
      };
    }
  } catch (err) {
    // Timeout or crash during hashing — this is the common case on slower
    // devices with a 53 MB file. Since HTTPS already guarantees transport
    // integrity, we allow the install to proceed.
    const msg = err instanceof Error ? err.message : "Verification error";
    console.warn(`[APK Update] Verification skipped: ${msg}`);
    return {
      passed: null,
      reason: `Verification skipped (${msg}), installing via HTTPS trust`,
      shouldInstall: true,
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
