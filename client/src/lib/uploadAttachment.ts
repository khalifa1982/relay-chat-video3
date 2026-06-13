/**
 * Shared client helper for POST /api/v2/upload.
 *
 * Two reasons this exists (and why the three call sites — Messages image/file,
 * Messages voice-note, Profile avatar — should all use it):
 *
 *  1. base64 via FileReader, NOT `btoa(uint8.reduce((s,b)=>s+fromCharCode(b)))`.
 *     The reduce form builds a giant string one byte at a time on the main
 *     thread; on a 40 MB file that freezes (or OOM-crashes) mobile Safari.
 *     FileReader.readAsDataURL does the work off-thread.
 *  2. It sends the `x-relay-device-id` header. Guests whose cookie was dropped
 *     (Safari ITP / Brave / Firefox ETP) are resolved server-side by device id
 *     on every tRPC call — but the raw upload fetches bypassed tRPC and only
 *     sent the cookie, so those guests' uploads 401'd. This restores the same
 *     fallback the rest of the API has.
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
 * Upload a file/blob to the v2 upload endpoint. Sends credentials AND the
 * device-id header. Throws with the server's error text on a non-2xx response.
 */
export async function uploadAttachment(
  blob: Blob,
  opts: { filename: string; mimeType?: string },
): Promise<UploadedAttachment> {
  const dataBase64 = await blobToBase64(blob);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const deviceId = getDeviceId();
  if (deviceId) headers[DEVICE_ID_HEADER] = deviceId;

  const res = await fetch("/api/v2/upload", {
    method: "POST",
    credentials: "include",
    headers,
    body: JSON.stringify({
      dataBase64,
      mimeType: opts.mimeType || blob.type || "application/octet-stream",
      filename: opts.filename,
    }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<UploadedAttachment>;
}
