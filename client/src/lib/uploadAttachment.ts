/**
 * Shared client helper for POST /api/v2/upload.
 *
 * Since v2.88 the web client sends the file as RAW BINARY
 * (application/octet-stream body + metadata in the query string) instead of a
 * base64 JSON envelope: base64 inflated every upload by ~33% on the wire and
 * peaked at several times the file size in server memory — an OOM on the
 * 512 MiB instance wiped the in-memory relay registry and dropped every live
 * call. The base64 route still exists server-side (capped at 10 MB) for old
 * clients and mobile/native.
 *
 * Why the shared helper exists (all call sites — Messages image/file,
 * Messages voice-note, Profile avatar, voicemail — must use it): it sends the
 * `x-relay-device-id` header. Guests whose cookie was dropped (Safari ITP /
 * Brave / Firefox ETP) are resolved server-side by device id on every tRPC
 * call — but raw upload fetches bypassed tRPC and only sent the cookie, so
 * those guests' uploads 401'd. This restores the same fallback the rest of
 * the API has.
 */
import { DEVICE_ID_HEADER, getDeviceId } from "./deviceId";

/** Read a Blob/File as base64 (no `data:` prefix) off the main thread. */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.onload = () => {
      const result = String(reader.result || "");
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(blob);
  });
}

export interface UploadedAttachment {
  id: number;
  url: string;
  storageKey?: string;
  mimeType: string;
  sizeBytes?: number;
  width?: number | null;
  height?: number | null;
  durationMs?: number | null;
  filename?: string | null;
}

/**
 * Upload a file/blob to the v2 upload endpoint as raw binary. Sends
 * credentials AND the device-id header. Throws with the server's error text
 * on a non-2xx response.
 */
export async function uploadAttachment(
  blob: Blob,
  opts: { filename: string; mimeType?: string; durationMs?: number },
): Promise<UploadedAttachment> {
  const mime = opts.mimeType || blob.type || "application/octet-stream";
  const qs = new URLSearchParams({ filename: opts.filename, mime });
  if (typeof opts.durationMs === "number") qs.set("durationMs", String(Math.round(opts.durationMs)));
  const headers: Record<string, string> = { "Content-Type": "application/octet-stream" };
  const deviceId = getDeviceId();
  if (deviceId) headers[DEVICE_ID_HEADER] = deviceId;

  const res = await fetch(`/api/v2/upload?${qs.toString()}`, {
    method: "POST",
    credentials: "include",
    headers,
    // The Blob streams straight into the request body — no base64 inflation,
    // no giant string on the main thread.
    body: blob,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<UploadedAttachment>;
}
