/**
 * GIF PICKER BACKEND (v2.107.62, QW-10).
 *
 * A search-backed GIF picker that rides the chat's attachment sheet. Two server jobs:
 *
 *  1. SEARCH — proxy Giphy's search/trending so the API key stays server-side and never
 *     reaches the browser (a client-embedded key is a leak, and Giphy media also blocks
 *     cross-origin XHR, so a client can't call it directly anyway). Results are
 *     normalized to just what the picker needs.
 *
 *  2. ATTACH — the chosen GIF becomes a NORMAL self-hosted attachment, exactly like a
 *     picked photo: the server fetches the bytes (no client CORS), size- and mime-guards
 *     them, `storagePut`s them into the caller's own namespace, and records an
 *     attachment row. The client then sends a message referencing that attachment id —
 *     the same last step every upload uses. Nothing external is stored or hotlinked, so
 *     a GIF survives the provider deleting it and inherits the same signed-URL / burn /
 *     expiry behaviour as any other image.
 *
 * ENV-GATED: with no `GIPHY_API_KEY` set, `gifEnabled()` is false, `whoami` reports the
 * picker unavailable, and the client hides the GIF button entirely — so the feature is
 * invisible rather than broken until a (free) key is dropped into the environment.
 *
 * SAFETY: search is pinned to a `pg-13` content rating, and ATTACH only fetches from a
 * fixed allowlist of Giphy media hosts (an SSRF guard — the URL is provider-supplied,
 * never arbitrary), with a hard byte cap.
 */
import { storagePut } from "./storage";
import { recordAttachment } from "./v2db";
import { normalizeMimeType } from "./v2upload";
import { randomUUID } from "node:crypto";

/** The picker is available only when a provider key is configured. */
export function gifEnabled(): boolean {
  return (process.env.GIPHY_API_KEY || "").trim().length > 0;
}

const GIPHY_KEY = () => (process.env.GIPHY_API_KEY || "").trim();

/** A GIF the picker can show and send. `previewUrl` is a small still/animated preview
 *  for the grid; `gifUrl` is the full animated GIF that ATTACH re-hosts. */
export interface GifResult {
  id: string;
  previewUrl: string;
  previewWidth: number;
  previewHeight: number;
  gifUrl: string;
  width: number;
  height: number;
}

/**
 * The Giphy media hosts ATTACH is allowed to fetch from. A fixed allowlist because the
 * URL that reaches `attachGif` is chosen from search RESULTS the client echoes back —
 * so without this a caller could point ATTACH at any internal address (SSRF). Giphy
 * serves media from `media0..4.giphy.com` and `i.giphy.com`; `media.giphy.com` is the
 * apex some originals use.
 */
const GIPHY_HOSTS = new Set([
  "media.giphy.com",
  "media0.giphy.com",
  "media1.giphy.com",
  "media2.giphy.com",
  "media3.giphy.com",
  "media4.giphy.com",
  "i.giphy.com",
]);

/** True only for an https Giphy media URL — the ATTACH fetch guard. */
export function isAllowedGifUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  return u.protocol === "https:" && GIPHY_HOSTS.has(u.hostname);
}

const MAX_GIF_BYTES = 12 * 1024 * 1024; // 12 MB — generous for a GIF, well under the 40 MB attachment ceiling

/** Pull one integer out of Giphy's stringly-typed image dimensions, defaulting sanely. */
function dim(v: unknown, fallback: number): number {
  const n = typeof v === "string" ? parseInt(v, 10) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Search (or, with an empty query, trend) Giphy. Returns [] when the key is unset or the
 * call fails — the picker degrades to "no results" rather than throwing, and the button
 * is already hidden when the key is unset, so a failure here is a transient-network case.
 */
export async function searchGifs(query: string, limit: number): Promise<GifResult[]> {
  const key = GIPHY_KEY();
  if (!key) return [];
  const n = Math.max(1, Math.min(50, Math.floor(limit) || 24));
  const q = query.trim();
  const base = q
    ? `https://api.giphy.com/v1/gifs/search?q=${encodeURIComponent(q)}&`
    : `https://api.giphy.com/v1/gifs/trending?`;
  // pg-13 keeps explicit content out — this app carries UGC obligations, and a GIF
  // grid is exactly the kind of surface a store review scrutinizes.
  const url = `${base}api_key=${encodeURIComponent(key)}&limit=${n}&rating=pg-13&bundle=messaging_non_clips`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];
    const json = (await res.json()) as { data?: Array<Record<string, unknown>> };
    const rows = Array.isArray(json.data) ? json.data : [];
    const out: GifResult[] = [];
    for (const row of rows) {
      const id = typeof row.id === "string" ? row.id : null;
      const images = (row.images ?? {}) as Record<string, Record<string, unknown>>;
      const preview = images.fixed_width ?? images.downsized ?? images.original;
      const full = images.original ?? images.downsized ?? images.fixed_width;
      const previewUrl = typeof preview?.url === "string" ? preview.url : null;
      const gifUrl = typeof full?.url === "string" ? full.url : null;
      // Only keep rows whose media URLs are ones ATTACH will actually accept — so a
      // result the user taps can never be un-attachable.
      if (!id || !previewUrl || !gifUrl || !isAllowedGifUrl(gifUrl)) continue;
      out.push({
        id,
        previewUrl,
        previewWidth: dim(preview?.width, 200),
        previewHeight: dim(preview?.height, 200),
        gifUrl,
        width: dim(full?.width, 480),
        height: dim(full?.height, 480),
      });
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Re-host a chosen Giphy GIF as the caller's own attachment and return the row. Guards:
 * the URL must be an allowlisted Giphy host (SSRF), the fetched bytes must be a GIF under
 * the cap, and the storage key lives in the caller's namespace (`relay-chat/<id>/…`), so
 * the ownership check every reader trusts holds exactly as it does for an upload.
 */
export async function attachGif(input: {
  identityId: number;
  url: string;
  width?: number | null;
  height?: number | null;
}): Promise<
  | { ok: true; id: number; url: string; mimeType: string }
  | { ok: false; reason: "bad-url" | "too-large" | "not-a-gif" | "unavailable" }
> {
  if (!gifEnabled()) return { ok: false, reason: "unavailable" };
  if (!isAllowedGifUrl(input.url)) return { ok: false, reason: "bad-url" };
  try {
    const res = await fetch(input.url, { signal: AbortSignal.timeout(12000) });
    if (!res.ok) return { ok: false, reason: "unavailable" };
    const ct = normalizeMimeType(res.headers.get("content-type") || "image/gif");
    if (ct !== "image/gif") return { ok: false, reason: "not-a-gif" };
    const ab = await res.arrayBuffer();
    if (ab.byteLength > MAX_GIF_BYTES) return { ok: false, reason: "too-large" };
    const buf = Buffer.from(ab);
    const key = `relay-chat/${input.identityId}/gif/${randomUUID()}.gif`;
    const { key: storedKey, url } = await storagePut(key, buf, "image/gif");
    const row = await recordAttachment({
      storageKey: storedKey,
      url,
      mimeType: "image/gif",
      sizeBytes: buf.length,
      width: input.width ?? null,
      height: input.height ?? null,
      filename: "giphy.gif",
      uploadedByIdentityId: input.identityId,
    });
    if (!row) return { ok: false, reason: "unavailable" };
    return { ok: true, id: row.id, url: row.url, mimeType: "image/gif" };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}
