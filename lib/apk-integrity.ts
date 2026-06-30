/**
 * APK integrity verification for the self-hosted auto-update flow.
 *
 * The audit recommended that a downloaded APK be verified (hash or signature)
 * before the installer is launched, rather than trusting HTTPS transport alone.
 * This module computes the SHA-256 of a downloaded file on-device and compares
 * it to the expected digest declared in the update manifest.
 *
 * Memory note: an APK is ~50 MB. We must NOT read the entire file into a single
 * JS string/buffer (that risks an OOM crash on low-end Android). Instead we read
 * the file in fixed-size byte windows via expo-file-system's `length`/`position`
 * options and feed each chunk into the streaming SHA-256 from ./sha256.
 *
 * The pure hashing/base64 code lives in ./sha256 (no native imports) so it can
 * be unit-tested. Verification ONLY runs when the manifest supplies a `sha256`,
 * so releases without a hash keep installing unchanged.
 */
import * as FileSystem from "expo-file-system/legacy";

import { Sha256, base64ToBytes } from "./sha256";

// Re-export the pure helpers so existing import sites keep working.
export { Sha256, base64ToBytes } from "./sha256";

// Read the APK in 1 MiB windows. Base64 expands by ~4/3, so each read holds at
// most ~1.33 MB of string in memory at a time — safe on low-end devices.
const CHUNK_BYTES = 1024 * 1024;

/**
 * Compute the SHA-256 of a local file, reading it in fixed-size windows so the
 * full file never sits in memory at once. Returns a lowercase hex digest.
 */
export async function sha256OfFile(uri: string): Promise<string> {
  const info = await FileSystem.getInfoAsync(uri);
  if (!info.exists) throw new Error("File to verify does not exist");
  const size = typeof info.size === "number" ? info.size : 0;
  if (size <= 0) throw new Error("File to verify is empty");

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
 * Verify a downloaded file against an expected lowercase-hex SHA-256.
 * Returns the computed digest on success; throws on mismatch.
 */
export async function verifyFileSha256(
  uri: string,
  expectedHex: string,
): Promise<string> {
  const actual = await sha256OfFile(uri);
  if (actual !== expectedHex) {
    throw new Error(
      `Integrity check failed: expected ${expectedHex.slice(0, 12)}…, got ${actual.slice(0, 12)}…`,
    );
  }
  return actual;
}
