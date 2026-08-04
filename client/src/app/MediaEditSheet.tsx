import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, Check, Undo2, Eraser, Pencil } from "lucide-react";
import { EDIT_MAX_EDGE, isEditableImage } from "@/lib/imageEdit";
import { fitWithin, renameForMime } from "@/lib/imageDownscale";
import { useLocale } from "./i18n";

/**
 * PRE-UPLOAD ANNOTATION — draw on a photo before it is sent.
 *
 * Opens from the composer's attach menu and BEFORE the upload. Emits a File
 * through `onUse`, which the caller then puts through its ordinary upload path
 * — so the existing downscale (cap 2048, webp q≈0.85), the ≤512px thumbnail,
 * the caption and the disappearing timer all still apply. This sheet uploads
 * nothing itself.
 *
 * ── WHY THIS IS A SECOND SHEET RATHER THAN A THIRD TOOL IN `ImageEditSheet` ──────────
 * Crop and rotate already ship (`ImageEditSheet`, #144, v2.106.94) and drawing
 * genuinely belongs beside them in ONE editor. It is not there because of a
 * file boundary rather than a design judgement, and that is recorded here so
 * the next person does not have to re-derive it:
 *
 *   • Chaining the two sheets was the first design and it MISLABELS an exit
 *     whichever order they run in. `ImageEditSheet`'s two buttons are "Use
 *     photo" (hands the file to the composer — the last step) and "Use
 *     original" (attach the untouched bytes). Put drawing AFTER it and "Use
 *     photo" no longer uses the photo, it opens another editor. Put drawing
 *     BEFORE it and "Use original" attaches a drawn-on photo while calling it
 *     the original. `dict/imageedit.ts` records both of those labels as
 *     deliberate distinctions, so neither lie is acceptable.
 *
 *   • Replacing that sheet with a self-contained one would duplicate the crop
 *     geometry, and the #144 pins would then guard the copy nobody renders.
 *
 * So the honest shape available here is a SEPARATE, ADDITIVE entry: the photo
 * picker keeps opening the crop/rotate sheet exactly as before, and this is its
 * own item in the attach menu. The cost is real and worth stating — a photo
 * cannot currently be BOTH cropped and drawn on in one pass. Folding this in as
 * a third tool inside `ImageEditSheet` is the right end state.
 *
 * ── STROKES ARE NORMALIZED, WHICH IS WHAT MAKES THE PREVIEW HONEST ───────────────────
 * A point is stored as a 0..1 fraction of the image, never in pixels. The
 * preview canvas and the output canvas are DIFFERENT sizes (the preview is
 * bounded for the screen, the output by the upload pipeline's own 2048), so a
 * pixel-space stroke would land somewhere else in the file than where it was
 * drawn — the classic silent failure on this feature, and invisible to any test
 * that only checks that something was painted. Both canvases are painted by the
 * SAME `paintStrokes`, so "what you see is what is encoded" is structural
 * rather than a claim.
 *
 * ── VIDEO IS NOT EDITABLE HERE, AND THE REASON IS NOT AN OVERSIGHT ───────────────────
 * Trimming a clip needs the bytes re-muxed. Nothing in a browser writes an MP4
 * or WebM container, so a dependency-free trim would have to re-encode by
 * playing the clip into a `MediaRecorder` in REAL TIME — a 60s clip costs the
 * sender 60s and a generation of quality, and `HTMLMediaElement.captureStream`
 * is not available on iOS Safari at all, so it would not work for a large part
 * of this app's users. `lib/imageEdit.ts` reached the same conclusion; this
 * file agrees with it rather than quietly re-opening it.
 */

/**
 * WHERE THIS COPY BELONGS, AND WHY IT IS HERE INSTEAD.
 *
 * Every other surface keeps its strings in `dict/<surface>.ts`. There is no
 * module for this one and `dict/index.ts` may not be edited from here, so the
 * two halves live beside the component rather than shipping an untranslated
 * screen — which is the worse of the two failures. Resolved by moving this map
 * into `dict/mediaedit.ts`, registering it, and swapping the reads for `t(…)`;
 * nothing else about the sheet changes.
 *
 * The register matches `dict/imageedit.ts`: short control labels are verbal
 * nouns, full sentences are imperative. The two exits keep that module's
 * distinctions — "use original" is not "cancel" (both exits attach the photo),
 * and the failure notice says the DRAWING was dropped, never the photo.
 */
const COPY = {
  title: { en: "Draw on photo", ar: "الرسم على الصورة" },
  /* The composer's attach-menu row that opens this sheet. It lives HERE rather
     than in `Messages.tsx` so every string this feature owns has one home to
     move when `dict/mediaedit.ts` exists — and so the composer, which is a
     heavily swept file, gains no literal of its own. */
  menuDraw: { en: "Draw on photo", ar: "الرسم على الصورة" },
  close: {
    en: "Skip drawing and use the original photo",
    ar: "تخطّي الرسم واستخدام الصورة الأصلية",
  },
  hint: { en: "Drag on the photo to draw", ar: "اسحب على الصورة للرسم" },
  undo: { en: "Undo the last stroke", ar: "التراجع عن آخر خط" },
  clear: { en: "Clear the drawing", ar: "مسح الرسم" },
  useOriginal: { en: "Use original", ar: "استخدام الأصلية" },
  usePhoto: { en: "Use photo", ar: "استخدام الصورة" },
  failed: {
    en: "Couldn't apply the drawing — attaching the original photo instead.",
    ar: "تعذّر تطبيق الرسم — سيتم إرفاق الصورة الأصلية بدلًا من ذلك.",
  },
  white: { en: "White", ar: "أبيض" },
  black: { en: "Black", ar: "أسود" },
  red: { en: "Red", ar: "أحمر" },
  amber: { en: "Amber", ar: "كهرماني" },
  pen: { en: "Draw freehand", ar: "رسم حر" },
  circleTool: { en: "Draw a circle", ar: "رسم دائرة" },
  green: { en: "Green", ar: "أخضر" },
  blue: { en: "Blue", ar: "أزرق" },
} as const;

type CopyKey = keyof typeof COPY;

/** Preview backing store cap — only ever shown on screen, so it buys nothing
 *  above a retina phone width and costs a repaint on every pointer move. */
const PREVIEW_MAX_EDGE = 1400;

/**
 * Stroke width as a FRACTION of the image's longest edge, never a pixel count.
 * A 6px line is a marker on a 400px photo and invisible on a 4000px one, so a
 * fixed width would make the tool behave differently depending on the camera
 * that took the picture.
 */
export const STROKE_FRACTION = 0.008;
/** Below this a stroke stops being visible at all once the image is scaled. */
export const MIN_STROKE_PX = 2;

export interface DrawPoint {
  /** 0..1 fraction of the image width. */
  x: number;
  /** 0..1 fraction of the image height. */
  y: number;
}

export interface DrawStroke {
  color: string;
  /** Absent = freehand. "circle": exactly two points — the drag's start and end,
   *  read as the ellipse's bounding box. Unknown shapes sanitize away to nothing
   *  rather than to a misdrawn line. */
  shape?: "circle";
  points: DrawPoint[];
}

/** The palette. Six is "a few" — enough to stay legible on any photo, few
 *  enough to fit one row on a 320px phone without wrapping into the stage. */
export const DRAW_COLORS: ReadonlyArray<{ key: CopyKey; css: string }> = [
  { key: "white", css: "#ffffff" },
  { key: "black", css: "#111111" },
  { key: "red", css: "#ef4444" },
  { key: "amber", css: "#f59e0b" },
  { key: "green", css: "#22c55e" },
  { key: "blue", css: "#3b82f6" },
];

/**
 * The painted line width for a given canvas. Rounded and floored, so the
 * preview and the output agree to the pixel at their own scales.
 */
export function strokeWidthPx(canvasW: number, canvasH: number): number {
  const longest = Math.max(
    1,
    Number.isFinite(canvasW) ? canvasW : 1,
    Number.isFinite(canvasH) ? canvasH : 1,
  );
  return Math.max(MIN_STROKE_PX, Math.round(longest * STROKE_FRACTION));
}

/**
 * Drop everything a canvas cannot draw.
 *
 * A single non-finite coordinate does not throw — it makes the WHOLE path
 * silently paint nothing, so one stray pointer event arriving mid-teardown
 * would lose the user's entire stroke with no error anywhere. Points are NOT
 * clamped to 0..1 on purpose: a stroke that runs off the edge should leave the
 * picture where it was drawn, and the canvas clips it for free. Empty strokes
 * are removed so `hasDrawing` cannot report a drawing that would paint nothing.
 */
export function sanitizeStrokes(strokes: readonly DrawStroke[] | null | undefined): DrawStroke[] {
  if (!Array.isArray(strokes)) return [];
  const out: DrawStroke[] = [];
  for (const s of strokes) {
    if (!s || typeof s.color !== "string" || !s.color) continue;
    const raw: unknown[] = Array.isArray(s.points) ? (s.points as unknown[]) : [];
    const points: DrawPoint[] = [];
    for (const p of raw) {
      const q = p as Partial<DrawPoint> | null | undefined;
      if (!q || typeof q.x !== "number" || typeof q.y !== "number") continue;
      if (!Number.isFinite(q.x) || !Number.isFinite(q.y)) continue;
      points.push({ x: q.x, y: q.y });
    }
    if (s.shape === "circle") {
      // A circle is its drag's two endpoints; anything less has no geometry.
      if (points.length >= 2) {
        out.push({ color: s.color, shape: "circle", points: [points[0], points[points.length - 1]] });
      }
      continue;
    }
    if (points.length > 0) out.push({ color: s.color, points });
  }
  return out;
}

/** Is there anything to encode? Answered AFTER sanitizing, so a stroke made
 *  entirely of unusable points reads as no drawing and the original ships. */
export function hasDrawing(strokes: readonly DrawStroke[] | null | undefined): boolean {
  return sanitizeStrokes(strokes).length > 0;
}

/** Undo: drop the newest stroke. Never throws on an empty history. */
export function undoStrokes(strokes: readonly DrawStroke[]): DrawStroke[] {
  return strokes.length > 0 ? strokes.slice(0, -1) : [];
}

/**
 * A pointer position as a fraction of the rendered canvas. Returns null for a
 * degenerate rect (an element measured while hidden, or mid-unmount), because
 * dividing by it yields Infinity and every later point would be discarded.
 */
export function toUnitPoint(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
): DrawPoint | null {
  if (!rect || !(rect.width > 0) || !(rect.height > 0)) return null;
  const x = (clientX - rect.left) / rect.width;
  const y = (clientY - rect.top) / rect.height;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

/**
 * Paint strokes onto a context sized `width` × `height`.
 *
 * THE ONE PAINTER — the on-screen preview and the encoded output both call it,
 * which is what makes the preview a statement about the file rather than a
 * separate drawing that happens to look similar.
 *
 * A single-point stroke is a TAP, and `lineTo` draws nothing for it, so it is
 * painted as a dot. Without that, tapping to place a mark appears to do
 * nothing — and it is the most likely first gesture on a touch screen.
 */
export function paintStrokes(
  ctx: CanvasRenderingContext2D,
  strokes: readonly DrawStroke[] | null | undefined,
  width: number,
  height: number,
): void {
  const clean = sanitizeStrokes(strokes);
  if (clean.length === 0) return;
  const w = strokeWidthPx(width, height);
  ctx.save();
  ctx.lineWidth = w;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const stroke of clean) {
    const pts = stroke.points;
    if (stroke.shape === "circle") {
      const [a, b] = pts;
      const cx = ((a.x + b.x) / 2) * width;
      const cy = ((a.y + b.y) / 2) * height;
      const rx = Math.max(w / 2, (Math.abs(b.x - a.x) / 2) * width);
      const ry = Math.max(w / 2, (Math.abs(b.y - a.y) / 2) * height);
      ctx.beginPath();
      ctx.strokeStyle = stroke.color;
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();
      continue;
    }
    if (pts.length === 1) {
      ctx.beginPath();
      ctx.fillStyle = stroke.color;
      ctx.arc(pts[0].x * width, pts[0].y * height, w / 2, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    ctx.beginPath();
    ctx.strokeStyle = stroke.color;
    ctx.moveTo(pts[0].x * width, pts[0].y * height);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x * width, pts[i].y * height);
    ctx.stroke();
  }
  ctx.restore();
}

export interface DrawnImage {
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
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
}

/**
 * Flatten the drawing into the photo.
 *
 * Returns null when the file should ship UNTOUCHED — a gif, a decode failure,
 * no canvas, or nothing drawn. The caller then sends the ORIGINAL File, which
 * is the point of that return: opening this sheet and changing your mind must
 * not cost a re-encode.
 *
 * The working canvas is bounded by the SAME `EDIT_MAX_EDGE` the upload pipeline
 * caps at rather than a second number — drawing at 4000px only to have the
 * downscale immediately halve it is pure waste, and it is the memory spike a
 * phone notices.
 */
export async function renderDrawing(file: File, strokes: readonly DrawStroke[]): Promise<DrawnImage | null> {
  if (!isEditableImage(file.type)) return null;
  if (typeof document === "undefined") return null;
  if (!hasDrawing(strokes)) return null;
  let decoded: Awaited<ReturnType<typeof decodeImage>> | null = null;
  try {
    decoded = await decodeImage(file);
    const fit = fitWithin(decoded.width, decoded.height, EDIT_MAX_EDGE);
    const canvas = document.createElement("canvas");
    canvas.width = fit.width;
    canvas.height = fit.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(decoded.source, 0, 0, fit.width, fit.height);
    paintStrokes(ctx, strokes, fit.width, fit.height);

    const encode = (type: string): Promise<Blob | null> =>
      new Promise((resolve) => canvas.toBlob((b) => resolve(b), type, 0.9));
    let out = await encode("image/webp");
    let mime = "image/webp";
    if (!out || out.type !== "image/webp") {
      /* A transparent source flattens to BLACK on jpeg without this, which
         would turn a png with alpha into a photo nobody recognises. Matches the
         downscale pipeline exactly. */
      ctx.globalCompositeOperation = "destination-over";
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, fit.width, fit.height);
      out = await encode("image/jpeg");
      mime = "image/jpeg";
      if (!out || out.type !== "image/jpeg") return null;
    }
    return {
      blob: out,
      mime,
      width: fit.width,
      height: fit.height,
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

export function MediaEditSheet({
  file,
  onClose,
  onUse,
}: {
  file: File;
  /** Skip/cancel — the caller attaches the ORIGINAL file, byte for byte. */
  onClose: () => void;
  /** Hands over the drawn-on file (or the original when nothing was drawn / the
   *  render failed). Never uploads. */
  onUse: (f: File) => void;
}) {
  const { locale } = useLocale();
  const say = (key: CopyKey) => COPY[key][locale === "ar" ? "ar" : "en"];

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sourceRef = useRef<CanvasImageSource | null>(null);
  const closeSourceRef = useRef<(() => void) | null>(null);
  /* The stroke under the finger lives in a REF, not in state. A setState per
     pointermove would re-render this component sixty times a second while
     drawing; the committed strokes go into state on pointerup, which is the
     only moment anything else needs to know. */
  const liveRef = useRef<DrawStroke | null>(null);

  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const [strokes, setStrokes] = useState<DrawStroke[]>([]);
  const [colorIndex, setColorIndex] = useState(0);
  const [tool, setTool] = useState<"pen" | "circle">("pen");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  /* ── decode once ──────────────────────────────────────────────────────────
     Held for the life of the sheet and released on unmount: an ImageBitmap
     holds real decoded pixels and an object URL pins the whole photo until it
     is revoked, including when the sheet unmounts mid-decode. */
  useEffect(() => {
    let dead = false;
    let objectUrl: string | null = null;
    (async () => {
      try {
        let source: CanvasImageSource;
        let width: number;
        let height: number;
        let close: () => void;
        if (typeof createImageBitmap === "function") {
          const bmp = await createImageBitmap(file);
          source = bmp;
          width = bmp.width;
          height = bmp.height;
          close = () => bmp.close();
        } else {
          objectUrl = URL.createObjectURL(file);
          const img = new Image();
          img.decoding = "async";
          await new Promise<void>((resolve, reject) => {
            img.onload = () => resolve();
            img.onerror = () => reject(new Error("decode failed"));
            img.src = objectUrl as string;
          });
          source = img;
          width = img.naturalWidth;
          height = img.naturalHeight;
          const u = objectUrl;
          close = () => URL.revokeObjectURL(u);
        }
        if (dead) {
          close();
          return;
        }
        sourceRef.current = source;
        closeSourceRef.current = close;
        setNatural({ width, height });
      } catch {
        // Undecodable here means undecodable in the encoder too — hand the
        // original straight back rather than parking on a dead stage.
        if (!dead) onClose();
      }
    })();
    return () => {
      dead = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      try {
        closeSourceRef.current?.();
      } catch {
        /* */
      }
      closeSourceRef.current = null;
      sourceRef.current = null;
    };
    // `file` is the identity of this sheet; onClose is stable at the call site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  /* ── the preview: the photo, then the very same strokes the encoder paints ── */
  const paint = useCallback(() => {
    const cv = canvasRef.current;
    const src = sourceRef.current;
    if (!cv || !src || !natural) return;
    const fit = fitWithin(natural.width, natural.height, PREVIEW_MAX_EDGE);
    if (cv.width !== fit.width || cv.height !== fit.height) {
      cv.width = fit.width;
      cv.height = fit.height;
    }
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.drawImage(src, 0, 0, fit.width, fit.height);
    const live = liveRef.current;
    paintStrokes(ctx, live ? [...strokes, live] : strokes, fit.width, fit.height);
  }, [natural, strokes]);

  useEffect(() => {
    paint();
  }, [paint]);

  /* ── drawing ──────────────────────────────────────────────────────────── */
  const unitFromEvent = (e: { clientX: number; clientY: number }): DrawPoint | null => {
    const cv = canvasRef.current;
    if (!cv) return null;
    return toUnitPoint(e.clientX, e.clientY, cv.getBoundingClientRect());
  };

  function onPointerDown(e: React.PointerEvent) {
    if (!natural) return;
    const p = unitFromEvent(e);
    if (!p) return;
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    liveRef.current =
      tool === "circle"
        ? { color: DRAW_COLORS[colorIndex].css, shape: "circle", points: [p] }
        : { color: DRAW_COLORS[colorIndex].css, points: [p] };
    paint();
  }

  function onPointerMove(e: React.PointerEvent) {
    const live = liveRef.current;
    if (!live) return;
    const p = unitFromEvent(e);
    if (!p) return;
    const last = live.points[live.points.length - 1];
    // An exact repeat adds nothing to the picture and grows the array forever
    // on a finger held still.
    if (last && last.x === p.x && last.y === p.y) return;
    if (live.shape === "circle") {
      // A circle is defined by its endpoints alone — the drag RESIZES it rather
      // than leaving a trail, so the live array stays [start, current].
      live.points = [live.points[0], p];
    } else {
      live.points.push(p);
    }
    paint();
  }

  function onPointerUp(e: React.PointerEvent) {
    const live = liveRef.current;
    (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
    liveRef.current = null;
    if (!live) return;
    setStrokes((s) => [...s, live]);
  }

  function undo() {
    setStrokes((s) => undoStrokes(s));
  }

  function clearAll() {
    liveRef.current = null;
    setStrokes([]);
    setFailed(false);
  }

  /* ── exits ────────────────────────────────────────────────────────────────
     BOTH keep the photo. `useOriginal` hands back the caller's own File object
     — not a copy and not a re-encode — so skipping is indistinguishable from
     never having opened the sheet. */
  function useOriginal() {
    onUse(file);
  }

  async function applyAndUse() {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const drawn = await renderDrawing(file, strokes);
      if (!drawn) {
        // Nothing drawn, or the canvas refused. The original is right in both
        // cases and only the second is worth telling the user about.
        onUse(file);
        return;
      }
      onUse(new File([drawn.blob], drawn.filename, { type: drawn.mime }));
    } catch {
      setFailed(true);
      onUse(file);
    } finally {
      setBusy(false);
    }
  }

  const canUndo = strokes.length > 0;

    /* PORTALLED (v2.107.33) — the owner's screenshot: Cancel / Use photo sliced
     under the bottom tab bar, only their top edge peeking out. The page content
     wrapper is a z-10 STACKING CONTEXT and the mobile chrome is z-30, so an
     overlay mounted inside a page can never out-stack the nav, whatever its own
     z says — this element's 130 resolves INSIDE the page wrapper and competes
     as 10. Third strike of the class: v2.106.27 (canvas over unpositioned
     content), v2.107.2 (the story viewer, fixed by portalling — the precedent
     followed here), v2.107.25 (AppShell records the mechanics). The root's own
     `dark relay-v2` classes are exactly what make it portal-safe: it carries
     its theme with it instead of inheriting from the tree it just left. */
return createPortal(
    <div
      className="dark relay-v2 fixed inset-0 z-[130] flex flex-col bg-black"
      role="dialog"
      aria-modal="true"
      aria-label={say("title")}
    >
      {/* top bar: skip · title · clear */}
      <div
        className="flex items-center justify-between gap-2 px-4 pb-2.5"
        style={{ paddingTop: "max(10px, env(safe-area-inset-top))" }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label={say("close")}
          className="grid size-11 shrink-0 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20"
        >
          <X className="size-[19px]" strokeWidth={2} />
        </button>
        <span className="truncate text-[13px] font-semibold text-white/85">{say("title")}</span>
        <button
          type="button"
          onClick={clearAll}
          aria-label={say("clear")}
          className="grid size-11 shrink-0 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20"
        >
          <Eraser className="size-[18px]" strokeWidth={1.9} />
        </button>
      </div>

      {/* stage — the canvas IS the drawing surface, so there is no overlay to
          keep in step with it and nothing to mirror in Arabic. `touch-none` is
          load-bearing: without it the browser claims the gesture for panning
          and a finger scrolls the page instead of drawing. */}
      <div className="grid min-h-0 flex-1 place-items-center px-4">
        <canvas
          ref={canvasRef}
          className="block max-h-[58vh] max-w-full touch-none rounded-lg"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
      </div>

      <p className="px-4 pt-3 text-center text-[11px] text-white/55">{say("hint")}</p>
      {failed && <p className="px-4 pt-1 text-center text-[11px] text-amber-300/90">{say("failed")}</p>}

      {/* palette + undo */}
      <div className="flex flex-wrap items-center justify-center gap-2 px-4 pt-3">
        <button
          type="button"
          onClick={() => setTool("pen")}
          aria-label={say("pen")}
          aria-pressed={tool === "pen"}
          className={`grid size-11 place-items-center rounded-full text-white transition-transform active:scale-95 ${tool === "pen" ? "bg-white/25" : "bg-white/10 hover:bg-white/20"}`}
        >
          <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
        </button>
        <button
          type="button"
          onClick={() => setTool("circle")}
          aria-label={say("circleTool")}
          aria-pressed={tool === "circle"}
          className={`grid size-11 place-items-center rounded-full text-white transition-transform active:scale-95 ${tool === "circle" ? "bg-white/25" : "bg-white/10 hover:bg-white/20"}`}
        >
          <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9"/></svg>
        </button>
        <span className="mx-1 h-6 w-px bg-white/15" role="presentation" />
        {DRAW_COLORS.map((c, i) => (
          <button
            key={c.key}
            type="button"
            onClick={() => setColorIndex(i)}
            aria-label={say(c.key)}
            aria-pressed={colorIndex === i}
            className="grid size-11 place-items-center rounded-full transition-transform active:scale-95"
          >
            <span
              className="block rounded-full"
              style={{
                width: colorIndex === i ? 26 : 20,
                height: colorIndex === i ? 26 : 20,
                background: c.css,
                boxShadow: colorIndex === i ? "0 0 0 3px rgba(255,255,255,0.9)" : "0 0 0 1px rgba(255,255,255,0.35)",
              }}
            />
          </button>
        ))}
        <span className="mx-1 h-6 w-px bg-white/15" role="presentation" />
        {/* A control that can only refuse is ABSENT rather than disabled — the
            house rule. With nothing drawn there is nothing to undo. */}
        {canUndo && (
          <button
            type="button"
            onClick={undo}
            aria-label={say("undo")}
            className="grid size-11 place-items-center rounded-full bg-white/10 text-white transition-transform hover:bg-white/20 active:scale-95"
          >
            <Undo2 className="size-[18px]" strokeWidth={1.9} />
          </button>
        )}
      </div>

      {/* exits — both attach the photo */}
      <div
        className="flex items-center justify-center gap-2 px-4 pt-4"
        style={{ paddingBottom: "max(20px, env(safe-area-inset-bottom))" }}
      >
        <button
          type="button"
          onClick={useOriginal}
          className="inline-flex min-h-11 items-center gap-2 rounded-[18px] px-4 text-[11px] font-semibold text-white transition-transform active:scale-95"
          style={{ background: "rgba(0, 0, 0, 0.4)", border: "1px solid rgba(255, 255, 255, 0.3)" }}
        >
          {say("useOriginal")}
        </button>
        <button
          type="button"
          onClick={applyAndUse}
          disabled={busy || !natural}
          className="rcta inline-flex min-h-11 items-center gap-2 rounded-[18px] px-5 text-[11px] font-bold transition-transform active:scale-95 disabled:opacity-60"
        >
          <Check className="size-4" /> {say("usePhoto")}
        </button>
      </div>
    </div>,
    document.body
  );
}

/**
 * The attach-menu row's label, resolved in the reader's own language.
 *
 * Exported as a hook rather than a bare string so the composer never holds a
 * literal of its own: when this copy moves into `dict/mediaedit.ts` the call
 * site does not change.
 */
export function useDrawLabel(): string {
  const { locale } = useLocale();
  return COPY.menuDraw[locale === "ar" ? "ar" : "en"];
}

/** Re-exported so the composer's gate and this sheet can never disagree about
 *  which images may be redrawn (a gif must not reach a canvas — the re-encode
 *  keeps one frame and silently drops the animation). */
export { isEditableImage, Pencil as DrawGlyph };
