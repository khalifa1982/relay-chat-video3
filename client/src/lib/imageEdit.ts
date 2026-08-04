/* ============================================================
   Pre-upload PHOTO editing — rotate + crop (#144).

   A sheet opens after the user picks a photo in the Messages
   composer and BEFORE it uploads, offering rotate 90° each way
   and a crop (freeform drag, plus 1:1 and 16:9 presets).

   ── IT COMPOSES WITH THE DOWNSCALE, IT DOES NOT REPLACE IT ────
   `processImageForUpload` (imageDownscale.ts) already caps the
   longest edge at 2048, re-encodes webp/jpeg and emits the ≤512px
   thumbnail. This module runs BEFORE that and hands back an
   ordinary File, so the edited photo goes down the SAME
   `uploadFile()` path as an unedited one and inherits the cap,
   the thumbnail and the keep-original rule for free. Nothing here
   uploads, and nothing here bypasses that pipeline.

   ── VIDEO IS DELIBERATELY OUT OF SCOPE ───────────────────────
   Trimming a clip means decoding and re-encoding it. There is no
   canvas-shaped shortcut: WebCodecs is not available on the
   browsers this app supports (and is absent in every Safari this
   codebase already works around), and the alternative — playing
   the clip into a MediaRecorder — re-encodes in real time, so a
   60s video costs 60s of the user's time and one generation of
   quality loss. That is a different feature with a different
   pipeline, not an extension of this one.

   ── WHY THE GEOMETRY IS PURE ─────────────────────────────────
   Everything that decides the OUTPUT — the rotation transform,
   the clamped crop, the bounded working size — is a pure function
   tested in Node without a canvas. The DOM half (`renderEdit`)
   only EXECUTES that plan. This split is what makes "the rotation
   reaches the output rather than only a CSS preview" an
   assertable property: a preview-only rotate is the classic
   silent no-op on this feature, and it is invisible to any test
   that reads a style.
   ============================================================ */

import { DOWNSCALE_MAX_EDGE, fitWithin, isDownscalableImage, renameForMime } from "./imageDownscale";

/**
 * The working canvas is bounded by the SAME cap the downscale uses. A modern
 * phone shoots 48 megapixels; holding that at full resolution while somebody
 * drags a crop box is the memory spike this bound exists to prevent, and going
 * above 2048 would be pointless anyway — the upload pipeline caps there
 * immediately afterwards.
 */
export const EDIT_MAX_EDGE = DOWNSCALE_MAX_EDGE;

/**
 * A crop can never be smaller than this. `canvas.width = 0` throws in some
 * engines and yields an empty blob in others, so a fat-fingered zero-width drag
 * must not be representable by the time it reaches a canvas.
 */
export const MIN_CROP_PX = 16;

/** Quarter turns clockwise. */
export type Quarter = 0 | 1 | 2 | 3;

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Images this sheet may open. DELEGATES to the downscale pipeline's own gate
 * rather than restating the rule, which is the point: a GIF must not reach the
 * editor (a canvas re-encode keeps ONE frame — the animation is silently lost),
 * and an SVG is blocked server-side. Two copies of "which images may we
 * re-encode" is how one of them comes to admit a gif.
 */
export function isEditableImage(mime: string | undefined | null): boolean {
  return isDownscalableImage(mime);
}

/** Normalize any input to a quarter turn. */
export function normalizeQuarter(n: number): Quarter {
  if (!Number.isFinite(n)) return 0;
  return (((Math.round(n) % 4) + 4) % 4) as Quarter;
}

/** Dimensions after N quarter turns — odd turns swap the axes. */
export function rotatedDims(width: number, height: number, rotation: number): { width: number; height: number } {
  const rot = normalizeQuarter(rotation);
  return rot % 2 === 1 ? { width: height, height: width } : { width, height };
}

/**
 * The canvas transform for a quarter turn, in the exact terms `renderEdit`
 * applies them: `ctx.translate(translateX, translateY)` then `ctx.rotate(radians)`,
 * after which the source is drawn at (0,0) at its own (width × height).
 *
 * Verified corner-by-corner in the tests rather than by eye — an off-by-one on
 * the translate leaves the image drawn outside its own canvas, which renders as
 * a blank photo and is exactly the failure a "does it rotate?" glance misses.
 */
export function rotationTransform(
  width: number,
  height: number,
  rotation: number,
): { canvasWidth: number; canvasHeight: number; translateX: number; translateY: number; radians: number } {
  const rot = normalizeQuarter(rotation);
  const dims = rotatedDims(width, height, rot);
  const radians = (rot * Math.PI) / 2;
  // Each turn moves the origin to the corner the source's (0,0) lands on.
  const translate =
    rot === 0
      ? { translateX: 0, translateY: 0 }
      : rot === 1
        ? { translateX: height, translateY: 0 }
        : rot === 2
          ? { translateX: width, translateY: height }
          : { translateX: 0, translateY: width };
  return { canvasWidth: dims.width, canvasHeight: dims.height, radians, ...translate };
}

/**
 * Clamp a crop rectangle into the image. Handles every shape a drag can
 * produce: negative origins, a box dragged past an edge, one wider than the
 * image, and non-finite values from a pointer event that arrived mid-teardown.
 *
 * The rectangle is moved back INSIDE rather than merely truncated, so dragging
 * past an edge slides the box along it instead of shrinking it to nothing.
 */
export function clampCrop(rect: Partial<CropRect> | null | undefined, imgW: number, imgH: number): CropRect {
  const W = Math.max(1, Math.floor(Number.isFinite(imgW) ? imgW : 1));
  const H = Math.max(1, Math.floor(Number.isFinite(imgH) ? imgH : 1));
  const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

  // Never wider/taller than the image, never below the minimum (itself capped
  // by the image, so a tiny source is still croppable to its own full size).
  const minW = Math.min(MIN_CROP_PX, W);
  const minH = Math.min(MIN_CROP_PX, H);
  let w = Math.round(Math.min(W, Math.max(minW, num(rect?.width, W))));
  let h = Math.round(Math.min(H, Math.max(minH, num(rect?.height, H))));
  let x = Math.round(num(rect?.x, 0));
  let y = Math.round(num(rect?.y, 0));
  x = Math.min(Math.max(0, x), W - w);
  y = Math.min(Math.max(0, y), H - h);
  return { x, y, width: w, height: h };
}

/**
 * The largest centred crop of `aspect` (width/height) that fits — what the 1:1
 * and 16:9 presets produce. A non-positive or non-finite aspect falls back to
 * the whole image rather than throwing: a preset is a convenience and must
 * never be the reason a photo cannot be sent.
 */
export function centeredAspectCrop(imgW: number, imgH: number, aspect: number): CropRect {
  const W = Math.max(1, Math.floor(imgW));
  const H = Math.max(1, Math.floor(imgH));
  if (!Number.isFinite(aspect) || aspect <= 0) return { x: 0, y: 0, width: W, height: H };
  let w = W;
  let h = Math.round(W / aspect);
  if (h > H) {
    h = H;
    w = Math.round(H * aspect);
  }
  return clampCrop({ x: Math.round((W - w) / 2), y: Math.round((H - h) / 2), width: w, height: h }, W, H);
}

/**
 * Force `rect` to `aspect` (width/height) inside the image, then clamp.
 *
 * The containment happens BEFORE `clampCrop`, deliberately: clampCrop caps
 * width and height INDEPENDENTLY, so handing it an oversized aspect-correct
 * rect would square it off and silently break the ratio the preset promises.
 * By the time it is called here the box already fits, so it only slides the
 * origin. A null/invalid aspect means freeform.
 */
export function fitAspect(
  rect: Partial<CropRect> | null | undefined,
  aspect: number | null | undefined,
  imgW: number,
  imgH: number,
): CropRect {
  const W = Math.max(1, Math.floor(imgW));
  const H = Math.max(1, Math.floor(imgH));
  if (!aspect || !Number.isFinite(aspect) || aspect <= 0) return clampCrop(rect, W, H);
  const base = clampCrop(rect, W, H);
  let w = base.width;
  let h = w / aspect;
  if (h > H) {
    h = H;
    w = h * aspect;
  }
  if (w > W) {
    w = W;
    h = w / aspect;
  }
  return clampCrop({ x: base.x, y: base.y, width: Math.round(w), height: Math.round(h) }, W, H);
}

/**
 * Carry a crop rectangle through a quarter turn so rotating does not throw the
 * user's selection away. `dir` is +1 clockwise, -1 counter-clockwise; the
 * returned rect is in the NEW stage's coordinates, whose axes are swapped.
 */
export function rotateCropQuarter(rect: CropRect, stageW: number, stageH: number, dir: 1 | -1): CropRect {
  const next =
    dir === 1
      ? { x: stageH - rect.y - rect.height, y: rect.x, width: rect.height, height: rect.width }
      : { x: rect.y, y: stageW - rect.x - rect.width, width: rect.height, height: rect.width };
  // The new stage has the axes swapped.
  return clampCrop(next, stageH, stageW);
}

export interface EditPlan {
  /** Bounded size the SOURCE is drawn at (before rotation). */
  drawWidth: number;
  drawHeight: number;
  /** The rotated stage the crop is expressed against. */
  stageWidth: number;
  stageHeight: number;
  translateX: number;
  translateY: number;
  radians: number;
  /** Clamped, in stage (i.e. post-rotation) coordinates. */
  crop: CropRect;
  outWidth: number;
  outHeight: number;
  /** No rotation and a crop covering the whole stage — nothing to do. */
  isIdentity: boolean;
  /** Mirror the STAGE (what the user sees) about its vertical / horizontal axis. */
  flipH: boolean;
  flipV: boolean;
}

/**
 * Everything the renderer needs, decided here so it can be asserted without a
 * browser. `crop` is in STAGE coordinates — i.e. what the user sees after the
 * rotation — because that is the space they dragged it in.
 */
/**
 * Mirror a crop rectangle across the stage, for the flip buttons: the stage's
 * dimensions do not change under a mirror, so only the origin moves. Pure and
 * exact — flipping twice must return the caller's rectangle, which the tests
 * assert, because an off-by-one here shows up as a crop that CREEPS one pixel
 * per toggle and is invisible in any single screenshot.
 */
export function flipCropRect(rect: CropRect, stageW: number, stageH: number, axis: "h" | "v"): CropRect {
  return axis === "h"
    ? { ...rect, x: stageW - (rect.x + rect.width) }
    : { ...rect, y: stageH - (rect.y + rect.height) };
}

export function planEdit(opts: {
  naturalWidth: number;
  naturalHeight: number;
  rotation: number;
  flipH?: boolean;
  flipV?: boolean;
  crop?: Partial<CropRect> | null;
  maxEdge?: number;
}): EditPlan {
  const maxEdge = opts.maxEdge && opts.maxEdge > 0 ? opts.maxEdge : EDIT_MAX_EDGE;
  // Bound BEFORE anything else — every downstream number is in bounded space.
  const fit = fitWithin(opts.naturalWidth, opts.naturalHeight, maxEdge);
  const t = rotationTransform(fit.width, fit.height, opts.rotation);
  const crop = clampCrop(opts.crop, t.canvasWidth, t.canvasHeight);
  return {
    drawWidth: fit.width,
    drawHeight: fit.height,
    stageWidth: t.canvasWidth,
    stageHeight: t.canvasHeight,
    translateX: t.translateX,
    translateY: t.translateY,
    radians: t.radians,
    crop,
    outWidth: crop.width,
    outHeight: crop.height,
    flipH: opts.flipH === true,
    flipV: opts.flipV === true,
    isIdentity:
      opts.flipH !== true &&
      opts.flipV !== true &&
      normalizeQuarter(opts.rotation) === 0 &&
      crop.x === 0 &&
      crop.y === 0 &&
      crop.width === t.canvasWidth &&
      crop.height === t.canvasHeight,
  };
}

export interface EditedImage {
  blob: Blob;
  mime: string;
  width: number;
  height: number;
  filename: string;
}

/** Decode via createImageBitmap with an <img> fallback (older Safari). */
async function decodeImage(
  file: Blob,
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
 * EXECUTE a plan: draw the rotated source, take the crop, encode.
 *
 * Returns null when this file should ship UNTOUCHED — a gif, a decode failure,
 * no canvas, or an edit that changes nothing. The caller then sends the
 * ORIGINAL File, which is the whole point of that return: somebody who opens
 * the editor and changes their mind must not receive a re-encode.
 *
 * webp→jpeg with a WHITE underlay on the jpeg retry, matching the downscale
 * pipeline exactly — a transparent png flattens to black otherwise.
 */
export async function renderEdit(
  file: File,
  opts: { rotation: number; flipH?: boolean; flipV?: boolean; crop?: Partial<CropRect> | null },
): Promise<EditedImage | null> {
  if (!isEditableImage(file.type)) return null;
  if (typeof document === "undefined") return null;
  let decoded: Awaited<ReturnType<typeof decodeImage>> | null = null;
  try {
    decoded = await decodeImage(file);
    const plan = planEdit({
      naturalWidth: decoded.width,
      naturalHeight: decoded.height,
      rotation: opts.rotation,
      flipH: opts.flipH,
      flipV: opts.flipV,
      crop: opts.crop,
    });
    if (plan.isIdentity) return null; // nothing was changed — keep the original bytes

    const canvas = document.createElement("canvas");
    canvas.width = plan.outWidth;
    canvas.height = plan.outHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    /* The crop is a TRANSLATION of the stage, applied before the rotation, so
       the whole edit is one draw rather than an intermediate full-stage canvas
       that would defeat the memory bound above. */
    ctx.translate(-plan.crop.x, -plan.crop.y);
    /* The mirror is a STAGE-space operation — applied after the crop translate
       and before the rotation, so what flips is exactly the picture the user
       was looking at when they pressed the button, crop box and all. */
    if (plan.flipH) { ctx.translate(plan.stageWidth, 0); ctx.scale(-1, 1); }
    if (plan.flipV) { ctx.translate(0, plan.stageHeight); ctx.scale(1, -1); }
    ctx.translate(plan.translateX, plan.translateY);
    ctx.rotate(plan.radians);
    ctx.drawImage(decoded.source, 0, 0, plan.drawWidth, plan.drawHeight);
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    const encode = (type: string): Promise<Blob | null> =>
      new Promise((resolve) => canvas.toBlob((b) => resolve(b), type, 0.9));
    let out = await encode("image/webp");
    let mime = "image/webp";
    if (!out || out.type !== "image/webp") {
      ctx.globalCompositeOperation = "destination-over";
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, plan.outWidth, plan.outHeight);
      out = await encode("image/jpeg");
      mime = "image/jpeg";
      if (!out || out.type !== "image/jpeg") return null;
    }
    return {
      blob: out,
      mime,
      width: plan.outWidth,
      height: plan.outHeight,
      filename: renameForMime(file.name || "photo", mime),
    };
  } catch {
    return null;
  } finally {
    try {
      decoded?.close();
    } catch {
      /* */
    }
  }
}
