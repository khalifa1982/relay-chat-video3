import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, RotateCcw, RotateCw, Check, Undo2, Crop as CropIcon, FlipHorizontal2, FlipVertical2 } from "lucide-react";
import {
  centeredAspectCrop,
  clampCrop,
  fitAspect,
  isEditableImage,
  normalizeQuarter,
  renderEdit,
  rotateCropQuarter,
  flipCropRect,
  rotationTransform,
  planEdit,
  type CropRect,
  type Quarter,
} from "@/lib/imageEdit";
import { useLocale } from "./i18n";

/**
 * PRE-UPLOAD PHOTO EDITOR (#144) — rotate 90° each way, and crop.
 *
 * Opens after the user picks a photo in the Messages composer and BEFORE it
 * uploads. Emits an edited File through `onUse`, which the caller then puts
 * through its ordinary upload path — so the existing downscale, the ≤512px
 * thumbnail and the caption/disappearing-timer flow all still apply. This
 * sheet uploads nothing itself.
 *
 * Modelled on `VideoRecordSheet`: same full-screen `z-[130]` dialog, the same
 * self-declared `dark relay-v2` (the design utilities are scoped `.relay-v2 X`
 * and this surface is a black stage in either theme), the same 44px minimum hit
 * targets, and the same "a control that can only refuse is absent, not
 * disabled" rule.
 *
 * ── THE PREVIEW *IS* THE OUTPUT GEOMETRY, NOT A CSS ROTATION ─────────────────────────
 * The stage is a CANVAS drawn through the very `rotationTransform` the encoder
 * uses, not an `<img>` wearing `transform: rotate(90deg)`. That is the single
 * most important decision in this file: a preview-only rotate is the classic
 * silent no-op on this feature — the photo spins on screen, the uploaded bytes
 * do not, and no test that reads a style can tell. Here there is no style to
 * diverge from; if the preview turned, the plan turned.
 *
 * ── DIRECTION: THE CROP BOX IS PHYSICAL ON PURPOSE ───────────────────────────────────
 * Every other box in this app uses the logical `ps-`/`start-` spellings because
 * text mirrors. A PHOTO DOES NOT. The crop overlay is positioned with inline
 * `left`/`top` percentages in the image's own coordinate space, and it must NOT
 * follow `dir` — mirroring it would put the selection on the wrong part of the
 * picture in Arabic, which is the opposite of correct. This is the same class of
 * exemption `rtlSweep.test.ts` grants centring, and it is recorded here because
 * the "fix" looks obvious. The sheet's CHROME (buttons, labels) is fully logical
 * and does mirror. Rotate-left likewise stays counter-clockwise in both
 * languages — see `dict/imageedit.ts`, distinction 3.
 */

/** Preview backing store cap. Independent of the 2048 OUTPUT bound: this one is
 *  only ever shown on screen, so it buys nothing above a retina phone width and
 *  costs a redraw on every rotate. */
const PREVIEW_MAX_EDGE = 1400;
/** Corner handle hit size, comfortably past the 24px minimum for a finger. */
const HANDLE = 28;

type AspectKey = "free" | "square" | "wide";
const ASPECTS: Record<AspectKey, number | null> = { free: null, square: 1, wide: 16 / 9 };

type DragMode = "new" | "move" | "nw" | "ne" | "sw" | "se";

export function ImageEditSheet({
  file,
  onClose,
  onUse,
}: {
  file: File;
  /** Skip/cancel — the caller attaches the ORIGINAL file, byte for byte. */
  onClose: () => void;
  /** Hands over the edited file (or the original when nothing changed / the
   *  render failed). Never uploads. */
  onUse: (f: File) => void;
}) {
  const { t } = useLocale();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const sourceRef = useRef<CanvasImageSource | null>(null);
  const closeSourceRef = useRef<(() => void) | null>(null);
  const dragRef = useRef<{ mode: DragMode; startX: number; startY: number; origin: CropRect } | null>(null);

  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const [rotation, setRotation] = useState<Quarter>(0);
  const [flipH, setFlipH] = useState(false);
  const [flipV, setFlipV] = useState(false);
  const [crop, setCrop] = useState<CropRect | null>(null);
  const [aspect, setAspect] = useState<AspectKey>("free");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  /* The stage the crop is expressed in: the bounded, ROTATED image. Derived
     from the same planner the encoder uses, so the box the user drags and the
     pixels that get cropped are the same coordinate space by construction. */
  const stage = natural
    ? (() => {
        const p = planEdit({ naturalWidth: natural.width, naturalHeight: natural.height, rotation });
        return { width: p.stageWidth, height: p.stageHeight };
      })()
    : null;

  /* ── decode once ──────────────────────────────────────────────────────────
     The decoded bitmap is held for the life of the sheet (redrawn on every
     rotate). Released on unmount — an ImageBitmap holds real memory and an
     object URL from the <img> fallback is a leak if it is not revoked. */
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
      // Revoke on EVERY exit path, including one that unmounts mid-decode.
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      try {
        closeSourceRef.current?.();
      } catch {
        /* */
      }
      closeSourceRef.current = null;
      sourceRef.current = null;
    };
    // `file` is the identity of this sheet; onClose is stable enough at the call site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  /* ── the preview canvas: the plan, drawn ─────────────────────────────────── */
  const paint = useCallback(() => {
    const cv = canvasRef.current;
    const src = sourceRef.current;
    if (!cv || !src || !natural) return;
    const t0 = rotationTransform(natural.width, natural.height, rotation);
    const longest = Math.max(t0.canvasWidth, t0.canvasHeight);
    const scale = longest > PREVIEW_MAX_EDGE ? PREVIEW_MAX_EDGE / longest : 1;
    const dw = Math.max(1, Math.round(natural.width * scale));
    const dh = Math.max(1, Math.round(natural.height * scale));
    const tr = rotationTransform(dw, dh, rotation);
    cv.width = tr.canvasWidth;
    cv.height = tr.canvasHeight;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    /* Same stage-space mirror the encoder applies (renderEdit) — one geometry,
       two callers, which is what keeps the preview a statement about the file. */
    if (flipH) { ctx.translate(tr.canvasWidth, 0); ctx.scale(-1, 1); }
    if (flipV) { ctx.translate(0, tr.canvasHeight); ctx.scale(1, -1); }
    ctx.translate(tr.translateX, tr.translateY);
    ctx.rotate(tr.radians);
    ctx.drawImage(src, 0, 0, dw, dh);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }, [natural, rotation, flipH, flipV]);

  useEffect(() => {
    paint();
  }, [paint]);

  /* A fresh photo starts with the whole frame selected. */
  useEffect(() => {
    if (!stage || crop) return;
    setCrop({ x: 0, y: 0, width: stage.width, height: stage.height });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage?.width, stage?.height]);

  /* The crop follows the mirror (flipCropRect), so the box stays on the same
     PICTURE content the user selected rather than jumping to the far side. */
  function toggleFlip(axis: "h" | "v") {
    if (!stage) return;
    if (axis === "h") setFlipH((v) => !v); else setFlipV((v) => !v);
    setCrop((c) => (c ? flipCropRect(c, stage.width, stage.height, axis) : c));
  }
  function rotate(dir: 1 | -1) {
    if (!stage) return;
    setCrop((c) => (c ? rotateCropQuarter(c, stage.width, stage.height, dir) : c));
    setRotation((r) => normalizeQuarter(r + dir));
  }

  function chooseAspect(key: AspectKey) {
    setAspect(key);
    if (!stage) return;
    const a = ASPECTS[key];
    setCrop(a ? centeredAspectCrop(stage.width, stage.height, a) : { x: 0, y: 0, width: stage.width, height: stage.height });
  }

  function reset() {
    setFlipH(false);
    setFlipV(false);
    setRotation(0);
    setAspect("free");
    setCrop(null); // the effect above re-selects the whole (un-rotated) frame
    setFailed(false);
  }

  /* ── crop dragging ────────────────────────────────────────────────────────
     Every mutation lands through `fitAspect`/`clampCrop`, so no gesture — however
     wild — can produce a rectangle outside the image or below the minimum. */
  const toStage = (e: { clientX: number; clientY: number }): { x: number; y: number } | null => {
    const el = frameRef.current;
    if (!el || !stage) return null;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;
    return {
      x: ((e.clientX - r.left) / r.width) * stage.width,
      y: ((e.clientY - r.top) / r.height) * stage.height,
    };
  };

  function onPointerDown(mode: DragMode, e: React.PointerEvent) {
    if (!stage || !crop) return;
    const p = toStage(e);
    if (!p) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    dragRef.current = { mode, startX: p.x, startY: p.y, origin: crop };
    if (mode === "new") {
      // A fresh drag collapses to a point and grows from it.
      setCrop(clampCrop({ x: p.x, y: p.y, width: 1, height: 1 }, stage.width, stage.height));
      dragRef.current.origin = { x: p.x, y: p.y, width: 0, height: 0 };
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d || !stage) return;
    const p = toStage(e);
    if (!p) return;
    const dx = p.x - d.startX;
    const dy = p.y - d.startY;
    const o = d.origin;
    const a = ASPECTS[aspect];
    let next: CropRect;
    if (d.mode === "move") {
      next = { x: o.x + dx, y: o.y + dy, width: o.width, height: o.height };
      // A move must never resize, so it clamps only the origin.
      setCrop(clampCrop(next, stage.width, stage.height));
      return;
    }
    if (d.mode === "new") {
      const x = Math.min(d.startX, p.x);
      const y = Math.min(d.startY, p.y);
      next = { x, y, width: Math.abs(dx), height: Math.abs(dy) };
    } else {
      const right = o.x + o.width;
      const bottom = o.y + o.height;
      const nx = d.mode === "nw" || d.mode === "sw" ? o.x + dx : o.x;
      const ny = d.mode === "nw" || d.mode === "ne" ? o.y + dy : o.y;
      const nr = d.mode === "ne" || d.mode === "se" ? right + dx : right;
      const nb = d.mode === "sw" || d.mode === "se" ? bottom + dy : bottom;
      next = { x: Math.min(nx, nr), y: Math.min(ny, nb), width: Math.abs(nr - nx), height: Math.abs(nb - ny) };
    }
    setCrop(a ? fitAspect(next, a, stage.width, stage.height) : clampCrop(next, stage.width, stage.height));
  }

  function onPointerUp(e: React.PointerEvent) {
    dragRef.current = null;
    (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
  }

  /* ── exits ────────────────────────────────────────────────────────────────
     BOTH keep the photo. `useOriginal` hands back the caller's own File object
     — not a copy and not a re-encode — which is the contract: somebody who
     opens the editor and changes their mind gets their bytes untouched. */
  function useOriginal() {
    onUse(file);
  }

  async function applyAndUse() {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const edited = await renderEdit(file, { rotation, flipH, flipV, crop });
      if (!edited) {
        // Either nothing changed or the canvas refused — the original is right
        // in both cases, and only the second is worth telling the user about.
        onUse(file);
        return;
      }
      onUse(new File([edited.blob], edited.filename, { type: edited.mime }));
    } catch {
      setFailed(true);
      onUse(file);
    } finally {
      setBusy(false);
    }
  }

  const pct = (v: number, total: number) => `${Math.max(0, Math.min(100, (v / total) * 100))}%`;

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
      aria-label={t("imageedit.title")}
    >
      {/* top bar: skip · title · reset */}
      <div
        className="flex items-center justify-between gap-2 px-4 pb-2.5"
        style={{ paddingTop: "max(10px, env(safe-area-inset-top))" }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label={t("imageedit.close")}
          className="grid size-11 shrink-0 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20"
        >
          <X className="size-[19px]" strokeWidth={2} />
        </button>
        <span className="truncate text-[13px] font-semibold text-white/85">{t("imageedit.title")}</span>
        <button
          type="button"
          onClick={reset}
          aria-label={t("imageedit.reset")}
          className="grid size-11 shrink-0 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20"
        >
          <Undo2 className="size-[18px]" strokeWidth={1.9} />
        </button>
      </div>

      {/* stage */}
      <div className="grid min-h-0 flex-1 place-items-center px-4">
        <div ref={frameRef} className="relative max-h-full">
          <canvas ref={canvasRef} className="block max-h-[58vh] max-w-full rounded-lg" />
          {stage && crop && (
            /* The crop layer. `touch-none` is load-bearing: without it the
               browser claims the gesture for panning and the box never moves on
               a phone. Dragging on the dimmed area starts a NEW selection. */
            <div
              className="absolute inset-0 touch-none"
              onPointerDown={(e) => onPointerDown("new", e)}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            >
              {/* PHYSICAL left/top — a photo does not mirror. See the header. */}
              <div
                className="absolute cursor-move border-2 border-white/90"
                style={{
                  left: pct(crop.x, stage.width),
                  top: pct(crop.y, stage.height),
                  width: pct(crop.width, stage.width),
                  height: pct(crop.height, stage.height),
                  boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)",
                }}
                onPointerDown={(e) => onPointerDown("move", e)}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
              >
                {(["nw", "ne", "sw", "se"] as const).map((corner) => (
                  <span
                    key={corner}
                    role="presentation"
                    onPointerDown={(e) => onPointerDown(corner, e)}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onPointerCancel={onPointerUp}
                    className="absolute rounded-full border-2 border-white bg-black/40"
                    style={{
                      width: HANDLE,
                      height: HANDLE,
                      left: corner === "nw" || corner === "sw" ? -HANDLE / 2 : undefined,
                      right: corner === "ne" || corner === "se" ? -HANDLE / 2 : undefined,
                      top: corner === "nw" || corner === "ne" ? -HANDLE / 2 : undefined,
                      bottom: corner === "sw" || corner === "se" ? -HANDLE / 2 : undefined,
                      cursor: corner === "nw" || corner === "se" ? "nwse-resize" : "nesw-resize",
                      touchAction: "none",
                    }}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <p className="px-4 pt-3 text-center text-[11px] text-white/55">{t("imageedit.dragHint")}</p>
      {failed && <p className="px-4 pt-1 text-center text-[11px] text-amber-300/90">{t("imageedit.failed")}</p>}

      {/* tools: rotate pair + the three crop modes */}
      <div className="flex flex-wrap items-center justify-center gap-2 px-4 pt-3">
        <button
          type="button"
          onClick={() => rotate(-1)}
          aria-label={t("imageedit.rotateLeft")}
          className="grid size-11 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20 active:scale-95 transition-transform"
        >
          <RotateCcw className="size-[18px]" strokeWidth={1.9} />
        </button>
        <button
          type="button"
          onClick={() => rotate(1)}
          aria-label={t("imageedit.rotateRight")}
          className="grid size-11 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20 active:scale-95 transition-transform"
        >
          <RotateCw className="size-[18px]" strokeWidth={1.9} />
        </button>
        <button
          type="button"
          onClick={() => toggleFlip("h")}
          aria-label={t("imageedit.flipH")}
          aria-pressed={flipH}
          className={`grid size-11 place-items-center rounded-full text-white active:scale-95 transition-transform ${flipH ? "bg-white/25" : "bg-white/10 hover:bg-white/20"}`}
        >
          <FlipHorizontal2 className="size-[18px]" strokeWidth={1.9} />
        </button>
        <button
          type="button"
          onClick={() => toggleFlip("v")}
          aria-label={t("imageedit.flipV")}
          aria-pressed={flipV}
          className={`grid size-11 place-items-center rounded-full text-white active:scale-95 transition-transform ${flipV ? "bg-white/25" : "bg-white/10 hover:bg-white/20"}`}
        >
          <FlipVertical2 className="size-[18px]" strokeWidth={1.9} />
        </button>
        <span className="mx-1 h-6 w-px bg-white/15" role="presentation" />
        {(
          [
            { key: "free" as const, label: t("imageedit.cropFree"), ratio: null },
            { key: "square" as const, label: t("imageedit.cropSquare"), ratio: "1:1" },
            { key: "wide" as const, label: t("imageedit.cropWide"), ratio: "16:9" },
          ]
        ).map((opt) => (
          <button
            key={opt.key}
            type="button"
            onClick={() => chooseAspect(opt.key)}
            aria-pressed={aspect === opt.key}
            className={
              aspect === opt.key
                ? "inline-flex min-h-11 items-center gap-1.5 rounded-[18px] bg-white/90 px-3.5 text-[11px] font-bold text-black transition-transform active:scale-95"
                : "inline-flex min-h-11 items-center gap-1.5 rounded-[18px] bg-white/10 px-3.5 text-[11px] font-semibold text-white hover:bg-white/20 transition-transform active:scale-95"
            }
          >
            {opt.key === "free" && <CropIcon className="size-3.5" />}
            {opt.label}
            {/* The ratio is TWO numeric runs around a colon, which the bidi
                algorithm reorders inside Arabic — `16:9` would render as `9:16`,
                a different crop. Isolated, exactly as videorec isolates its
                clock, which is also why it is not a dictionary string. */}
            {opt.ratio && (
              <span dir="ltr" className="font-mono text-[10px] opacity-70 [unicode-bidi:isolate]">
                {opt.ratio}
              </span>
            )}
          </button>
        ))}
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
          {t("imageedit.useOriginal")}
        </button>
        <button
          type="button"
          onClick={applyAndUse}
          disabled={busy || !natural}
          className="rcta inline-flex min-h-11 items-center gap-2 rounded-[18px] px-5 text-[11px] font-bold transition-transform active:scale-95 disabled:opacity-60"
        >
          <Check className="size-4" /> {t("imageedit.usePhoto")}
        </button>
      </div>
    </div>,
    document.body
  );
}

/** Re-exported so the composer's gate and this sheet can never disagree. */
export { isEditableImage };
