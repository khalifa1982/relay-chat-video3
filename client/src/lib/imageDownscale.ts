/* ============================================================
   Client-side photo downscale + thumbnail pipeline (v2.89).

   Phones attach 8-12 MB straight-off-the-camera photos; pushing
   those through upload, storage, AND every recipient's downlink
   (the bubble renders the full file) was the app's single biggest
   mobile-data waste. Before upload we now:

     1. Decode the image and cap its longest edge at 2048px
        (never upscaling), re-encoded as webp q≈0.85 with a jpeg
        fallback for browsers whose canvas can't emit webp.
     2. Keep the ORIGINAL bytes when the image already fits under
        the cap AND the re-encode didn't actually shrink it.
     3. Additionally emit a ≤512px THUMBNAIL (with its pixel
        dimensions) — bubbles render the thumb with explicit
        width/height (no layout shift) and tap through to the
        full-size url.

   GIFs are skipped entirely (canvas re-encode freezes the
   animation) and SVGs never reach here (blocked server-side). Any
   decode/encode failure returns null and the caller falls back to
   the untouched original upload path — this pipeline can only
   ever be an optimization, never a gate.

   The DOM-heavy parts live behind small PURE helpers (fitWithin /
   isDownscalableImage / shouldKeepOriginal / renameForMime) that
   are unit-tested in Node without a canvas.
   ============================================================ */

export const DOWNSCALE_MAX_EDGE = 2048;
export const THUMB_MAX_EDGE = 512;
export const WEBP_QUALITY = 0.85;

/** Images we re-encode. GIF keeps its animation; SVG is server-blocked. */
export function isDownscalableImage(mime: string | undefined | null): boolean {
  if (!mime || !/^image\//i.test(mime)) return false;
  if (/gif/i.test(mime)) return false;
  if (/svg/i.test(mime)) return false;
  return true;
}

/** Contain (w,h) within maxEdge, preserving aspect. NEVER upscales. */
export function fitWithin(
  w: number,
  h: number,
  maxEdge: number
): { width: number; height: number; resized: boolean } {
  const longest = Math.max(w, h);
  if (!Number.isFinite(longest) || longest <= 0) return { width: 1, height: 1, resized: false };
  if (longest <= maxEdge) return { width: Math.round(w), height: Math.round(h), resized: false };
  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
    resized: true,
  };
}

/**
 * The keep-original rule: when the image needed NO resize (already under the
 * cap) and the re-encode didn't shrink the bytes, uploading the original is
 * strictly better (no quality loss, no size win to trade it for). A resized
 * image always ships resized — the dimension cap is the contract.
 */
export function shouldKeepOriginal(opts: {
  originalBytes: number;
  reencodedBytes: number;
  wasResized: boolean;
}): boolean {
  if (opts.wasResized) return false;
  return opts.reencodedBytes >= opts.originalBytes;
}

/** photo.jpg + image/webp → photo.webp (extension follows the re-encode). */
export function renameForMime(filename: string, mime: string): string {
  const ext = mime === "image/webp" ? "webp" : mime === "image/jpeg" ? "jpg" : mime === "image/png" ? "png" : null;
  if (!ext) return filename;
  const base = filename.replace(/\.[A-Za-z0-9]{1,8}$/, "");
  return `${base || "photo"}.${ext}`;
}

export interface ProcessedImage {
  main: { blob: Blob; mime: string; width: number; height: number; filename: string };
  /** Present only when the final image is meaningfully larger than a thumb. */
  thumb: { blob: Blob; mime: string; width: number; height: number } | null;
}

/** Decode via createImageBitmap with an <img> fallback (older Safari). */
async function decodeImage(
  file: Blob
): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(file);
      return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
    } catch {
      /* fall through to the <img> path */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("image decode failed"));
      img.src = url;
    });
    return {
      source: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      close: () => URL.revokeObjectURL(url),
    };
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
}

/**
 * Draw `source` at (width × height) and encode webp→jpeg. The jpeg retry
 * paints on a WHITE underlay so a transparent png doesn't flatten to black.
 */
async function drawAndEncode(
  source: CanvasImageSource,
  width: number,
  height: number
): Promise<{ blob: Blob; mime: string } | null> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(source, 0, 0, width, height);
  const encode = (type: string): Promise<Blob | null> =>
    new Promise((resolve) => canvas.toBlob((b) => resolve(b), type, WEBP_QUALITY));
  const webp = await encode("image/webp");
  // Browsers that can't emit webp silently hand back a png — check the type.
  if (webp && webp.type === "image/webp") return { blob: webp, mime: "image/webp" };
  // JPEG fallback: flatten transparency onto white first.
  ctx.globalCompositeOperation = "destination-over";
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  const jpeg = await encode("image/jpeg");
  if (jpeg && jpeg.type === "image/jpeg") return { blob: jpeg, mime: "image/jpeg" };
  return null;
}

/**
 * Full pipeline. Returns null when this file should ship UNTOUCHED (gif/svg,
 * decode failure, encoder unavailable) — the caller falls back to the plain
 * upload path exactly as before v2.89.
 */
export async function processImageForUpload(file: File): Promise<ProcessedImage | null> {
  if (!isDownscalableImage(file.type)) return null;
  if (typeof document === "undefined") return null;
  let decoded: Awaited<ReturnType<typeof decodeImage>> | null = null;
  try {
    decoded = await decodeImage(file);
    const fit = fitWithin(decoded.width, decoded.height, DOWNSCALE_MAX_EDGE);
    const encoded = await drawAndEncode(decoded.source, fit.width, fit.height);
    if (!encoded) return null;

    const keepOriginal = shouldKeepOriginal({
      originalBytes: file.size,
      reencodedBytes: encoded.blob.size,
      wasResized: fit.resized,
    });
    const main = keepOriginal
      ? {
          blob: file as Blob,
          mime: file.type,
          width: Math.round(decoded.width),
          height: Math.round(decoded.height),
          filename: file.name || "photo",
        }
      : {
          blob: encoded.blob,
          mime: encoded.mime,
          width: fit.width,
          height: fit.height,
          filename: renameForMime(file.name || "photo", encoded.mime),
        };

    // Thumbnail only when it's meaningfully smaller than what the bubble
    // would otherwise load — a ≤512px main image IS its own thumbnail.
    let thumb: ProcessedImage["thumb"] = null;
    if (Math.max(main.width, main.height) > THUMB_MAX_EDGE) {
      const tFit = fitWithin(decoded.width, decoded.height, THUMB_MAX_EDGE);
      const tEnc = await drawAndEncode(decoded.source, tFit.width, tFit.height);
      if (tEnc) thumb = { blob: tEnc.blob, mime: tEnc.mime, width: tFit.width, height: tFit.height };
    }
    return { main, thumb };
  } catch {
    return null;
  } finally {
    try { decoded?.close(); } catch { /* */ }
  }
}
