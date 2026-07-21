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
  /** ≤512px thumbnail URL (v2.89) — set when a thumbKey rode the upload. */
  thumbUrl?: string | null;
}

/**
 * Upload a file/blob to the v2 upload endpoint as raw binary. Sends
 * credentials AND the device-id header. Throws with the server's error text
 * on a non-2xx response. `width`/`height` (image pixel dims) and `thumbKey`
 * (a key returned by uploadThumbnail, v2.89) ride the query string.
 */
export async function uploadAttachment(
  blob: Blob,
  opts: {
    filename: string;
    mimeType?: string;
    durationMs?: number;
    width?: number;
    height?: number;
    thumbKey?: string;
  },
): Promise<UploadedAttachment> {
  const mime = opts.mimeType || blob.type || "application/octet-stream";
  const qs = new URLSearchParams({ filename: opts.filename, mime });
  if (typeof opts.durationMs === "number") qs.set("durationMs", String(Math.round(opts.durationMs)));
  if (typeof opts.width === "number") qs.set("width", String(Math.round(opts.width)));
  if (typeof opts.height === "number") qs.set("height", String(Math.round(opts.height)));
  if (opts.thumbKey) qs.set("thumbKey", opts.thumbKey);
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

/**
 * Upload a ≤512px thumbnail (v2.89). Same route with `?thumb=1`: the server
 * stores the bytes in the caller's own namespace and returns {storageKey,url}
 * WITHOUT creating an attachment row — the storageKey is then passed as
 * `thumbKey` on the full image's uploadAttachment call.
 */
export async function uploadThumbnail(
  blob: Blob,
  opts: { mimeType?: string },
): Promise<{ storageKey: string; url: string }> {
  const mime = opts.mimeType || blob.type || "image/webp";
  const qs = new URLSearchParams({ thumb: "1", mime });
  const headers: Record<string, string> = { "Content-Type": "application/octet-stream" };
  const deviceId = getDeviceId();
  if (deviceId) headers[DEVICE_ID_HEADER] = deviceId;
  const res = await fetch(`/api/v2/upload?${qs.toString()}`, {
    method: "POST",
    credentials: "include",
    headers,
    body: blob,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<{ storageKey: string; url: string }>;
}

/**
 * Upload rich-STATUS media (image/video/audio) via `?bare=1` (v2.95): stores
 * the bytes in the caller's own namespace and returns {storageKey,url} with NO
 * attachment row — so the storage proxy serves it publicly (like avatars) and a
 * contact viewing the status isn't blocked by the participant-only attachment
 * gate. The returned storageKey is then passed to `status.post`.
 */
export async function uploadStatusMedia(
  blob: Blob,
  opts: { mimeType?: string },
): Promise<{ storageKey: string; url: string }> {
  const mime = opts.mimeType || blob.type || "application/octet-stream";
  const qs = new URLSearchParams({ bare: "1", mime });
  const headers: Record<string, string> = { "Content-Type": "application/octet-stream" };
  const deviceId = getDeviceId();
  if (deviceId) headers[DEVICE_ID_HEADER] = deviceId;
  const res = await fetch(`/api/v2/upload?${qs.toString()}`, {
    method: "POST",
    credentials: "include",
    headers,
    body: blob,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<{ storageKey: string; url: string }>;
}
