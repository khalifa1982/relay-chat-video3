/**
 * #144 — PRE-UPLOAD PHOTO EDITING (rotate + crop).
 *
 * The geometry is tested BEHAVIOURALLY: `imageEdit.ts` keeps every decision that
 * shapes the output in pure functions precisely so they can be driven here
 * without a canvas. The wiring — which file object reaches the uploader, what a
 * gif is allowed to touch, whether an object URL is released — is source-pinned,
 * because this suite runs in the `node` environment (see `vitest.config.ts`) and
 * those are properties of how the component is CONNECTED rather than of a value
 * it returns.
 *
 * The five properties below are the ones that break SILENTLY: each fails in a way
 * that still looks like a working editor on screen.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  EDIT_MAX_EDGE,
  MIN_CROP_PX,
  centeredAspectCrop,
  clampCrop,
  fitAspect,
  isEditableImage,
  normalizeQuarter,
  planEdit,
  renderEdit,
  rotateCropQuarter,
  rotatedDims,
  rotationTransform,
} from "@/lib/imageEdit";
import { isDownscalableImage } from "@/lib/imageDownscale";

const ROOT = path.resolve(__dirname, "../../..");
const SHEET = fs.readFileSync(path.join(ROOT, "client/src/app/ImageEditSheet.tsx"), "utf8");
const MESSAGES = fs.readFileSync(path.join(ROOT, "client/src/pages/app/Messages.tsx"), "utf8");
const LIB = fs.readFileSync(path.join(ROOT, "client/src/lib/imageEdit.ts"), "utf8");

/** Strip comments — prose ABOUT a pattern is not the pattern (the recurring trap). */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** Apply `translate(tx,ty)` then `rotate(θ)` to a point, as a canvas would. */
function mapPoint(t: { translateX: number; translateY: number; radians: number }, x: number, y: number) {
  const c = Math.cos(t.radians);
  const s = Math.sin(t.radians);
  return { x: t.translateX + x * c - y * s, y: t.translateY + x * s + y * c };
}

describe("#144 — a gif never reaches the editor", () => {
  /* A canvas re-encode keeps ONE frame. An animated gif that silently becomes a
     still is the worst failure this feature can have, because the sender sees
     their own thumbnail and never learns the recipient got a frozen picture. */
  it("refuses gif and svg, accepts the ordinary photo types", () => {
    expect(isEditableImage("image/gif")).toBe(false);
    expect(isEditableImage("image/GIF")).toBe(false);
    expect(isEditableImage("image/svg+xml")).toBe(false);
    expect(isEditableImage("image/jpeg")).toBe(true);
    expect(isEditableImage("image/png")).toBe(true);
    expect(isEditableImage("image/webp")).toBe(true);
    expect(isEditableImage("image/heic")).toBe(true);
  });

  it("refuses everything that is not an image at all", () => {
    for (const m of ["video/mp4", "audio/webm", "application/pdf", "text/plain", "", undefined, null]) {
      expect(isEditableImage(m as string)).toBe(false);
    }
  });

  it("DELEGATES to the downscale pipeline's gate rather than restating it", () => {
    /* Two copies of "which images may we re-encode" is how one of them comes to
       admit a gif. Asserted as agreement over every shape, not by reading the
       source: a lookalike reimplementation would pass a source pin. */
    for (const m of ["image/gif", "image/svg+xml", "image/jpeg", "image/png", "image/webp", "video/mp4", "", "x"]) {
      expect(isEditableImage(m), m).toBe(isDownscalableImage(m));
    }
  });

  it("the composer gates the picker on that same predicate", () => {
    const c = code(MESSAGES);
    expect(c).toMatch(/if\s*\(\s*isEditableImage\(file\.type\)\s*\)\s*\{\s*setEditImage\(file\);/);
    // …and a file that fails the gate still uploads, rather than being dropped.
    expect(c).toMatch(/setEditImage\(file\);[\s\S]{0,60}return;[\s\S]{0,80}await uploadFile\(file\);/);
  });

  it("renderEdit refuses a gif even if a caller reaches it directly", () => {
    /* Defence in depth: the sheet is not the only way into the encoder, and a
       future caller must not be able to flatten an animation by forgetting the
       gate. Awaited rather than trusted — this is the encoder's own answer. */
    const gif = new File([new Uint8Array([0x47, 0x49, 0x46])], "a.gif", { type: "image/gif" });
    return expect(renderEdit(gif, { rotation: 1 })).resolves.toBeNull();
  });
});

describe("#144 — rotation reaches the OUTPUT, not just a CSS preview", () => {
  /* THE failure mode of this feature: the photo turns on screen and the uploaded
     bytes do not. It is invisible to any test that reads a style, so what is
     asserted here is the canvas transform and the plan it comes from. */

  it("odd quarter turns swap the axes", () => {
    expect(rotatedDims(400, 300, 0)).toEqual({ width: 400, height: 300 });
    expect(rotatedDims(400, 300, 1)).toEqual({ width: 300, height: 400 });
    expect(rotatedDims(400, 300, 2)).toEqual({ width: 400, height: 300 });
    expect(rotatedDims(400, 300, 3)).toEqual({ width: 300, height: 400 });
  });

  it("the transform lands the image exactly inside its own canvas, every turn", () => {
    /* An off-by-one on the translate draws the photo OUTSIDE the canvas, which
       renders as a blank image — so the corners are mapped for real and the
       bounding box is required to equal the canvas rather than merely overlap. */
    const w = 400;
    const h = 300;
    for (const rot of [0, 1, 2, 3] as const) {
      const t = rotationTransform(w, h, rot);
      const corners = [
        mapPoint(t, 0, 0),
        mapPoint(t, w, 0),
        mapPoint(t, 0, h),
        mapPoint(t, w, h),
      ];
      const xs = corners.map((p) => p.x);
      const ys = corners.map((p) => p.y);
      expect(Math.min(...xs)).toBeCloseTo(0, 6);
      expect(Math.min(...ys)).toBeCloseTo(0, 6);
      expect(Math.max(...xs)).toBeCloseTo(t.canvasWidth, 6);
      expect(Math.max(...ys)).toBeCloseTo(t.canvasHeight, 6);
    }
  });

  it("a rotated plan carries a non-zero rotation into the encoder", () => {
    const p0 = planEdit({ naturalWidth: 400, naturalHeight: 300, rotation: 0 });
    const p1 = planEdit({ naturalWidth: 400, naturalHeight: 300, rotation: 1 });
    expect(p0.radians).toBe(0);
    expect(p1.radians).toBeCloseTo(Math.PI / 2, 9);
    // The OUTPUT dimensions turn with it — this is what a preview-only rotate
    // would leave unchanged.
    expect([p0.outWidth, p0.outHeight]).toEqual([400, 300]);
    expect([p1.outWidth, p1.outHeight]).toEqual([300, 400]);
  });

  it("a rotated photo is never treated as an unchanged one", () => {
    /* `isIdentity` short-circuits to the ORIGINAL bytes. If a rotation ever
       satisfied it, the rotate buttons would become a silent no-op. */
    expect(planEdit({ naturalWidth: 400, naturalHeight: 300, rotation: 0 }).isIdentity).toBe(true);
    for (const rot of [1, 2, 3]) {
      expect(planEdit({ naturalWidth: 400, naturalHeight: 300, rotation: rot }).isIdentity, `rot=${rot}`).toBe(false);
    }
  });

  it("the sheet's preview is drawn through that transform, and there is no CSS rotation to diverge from", () => {
    const c = code(SHEET);
    expect(c).toMatch(/rotationTransform\(/);
    expect(c).toMatch(/ctx\.rotate\(tr\.radians\)/);
    expect(c).toMatch(/ctx\.translate\(tr\.translateX,\s*tr\.translateY\)/);
    /* The preview must not be an <img> wearing a transform: that is precisely
       the divergence this design removes. No `rotate(` in any style/class. */
    expect(c).not.toMatch(/rotate\(\s*-?\d+\s*deg/);
    expect(c).not.toMatch(/className=\{?["'][^"']*\brotate-\d/);
    // The stage really is a canvas.
    expect(c).toMatch(/<canvas\b/);
  });

  it("the encoder applies the same rotation it planned", () => {
    const c = code(LIB);
    // The plan's own numbers reach the context — not a re-derived pair.
    expect(c).toMatch(/ctx\.translate\(plan\.translateX,\s*plan\.translateY\)/);
    expect(c).toMatch(/ctx\.rotate\(plan\.radians\)/);
    expect(c).toMatch(/canvas\.width\s*=\s*plan\.outWidth/);
    expect(c).toMatch(/canvas\.height\s*=\s*plan\.outHeight/);
  });

  it("normalizes any rotation input to a quarter turn", () => {
    expect(normalizeQuarter(0)).toBe(0);
    expect(normalizeQuarter(4)).toBe(0);
    expect(normalizeQuarter(5)).toBe(1);
    expect(normalizeQuarter(-1)).toBe(3);
    expect(normalizeQuarter(-5)).toBe(3);
    expect(normalizeQuarter(NaN)).toBe(0);
    expect(normalizeQuarter(Infinity)).toBe(0);
  });
});

describe("#144 — the crop rectangle is clamped to the image bounds", () => {
  /* A crop that escapes the image draws transparent padding into the output at
     best, and produces a zero-sized canvas (which throws, or yields an empty
     blob) at worst. Every gesture in the sheet routes through these. */

  it("keeps an ordinary rect untouched", () => {
    expect(clampCrop({ x: 10, y: 20, width: 100, height: 50 }, 400, 300)).toEqual({
      x: 10,
      y: 20,
      width: 100,
      height: 50,
    });
  });

  it("pulls a negative origin back inside", () => {
    expect(clampCrop({ x: -50, y: -80, width: 100, height: 50 }, 400, 300)).toEqual({
      x: 0,
      y: 0,
      width: 100,
      height: 50,
    });
  });

  it("slides a box dragged past an edge back in rather than shrinking it", () => {
    /* Truncating instead would make the box collapse as you drag off the
       picture, which reads as the crop "fighting" the finger. */
    const r = clampCrop({ x: 380, y: 290, width: 100, height: 50 }, 400, 300);
    expect(r).toEqual({ x: 300, y: 250, width: 100, height: 50 });
    expect(r.x + r.width).toBeLessThanOrEqual(400);
    expect(r.y + r.height).toBeLessThanOrEqual(300);
  });

  it("caps a rect larger than the image at the image", () => {
    expect(clampCrop({ x: 0, y: 0, width: 9999, height: 9999 }, 400, 300)).toEqual({
      x: 0,
      y: 0,
      width: 400,
      height: 300,
    });
  });

  it("never produces a zero-sized crop", () => {
    const r = clampCrop({ x: 10, y: 10, width: 0, height: 0 }, 400, 300);
    expect(r.width).toBeGreaterThanOrEqual(MIN_CROP_PX);
    expect(r.height).toBeGreaterThanOrEqual(MIN_CROP_PX);
    const neg = clampCrop({ x: 10, y: 10, width: -40, height: -40 }, 400, 300);
    expect(neg.width).toBeGreaterThanOrEqual(MIN_CROP_PX);
    expect(neg.height).toBeGreaterThanOrEqual(MIN_CROP_PX);
  });

  it("survives non-finite values from a pointer event that arrived mid-teardown", () => {
    const r = clampCrop({ x: NaN, y: Infinity, width: NaN, height: -Infinity }, 400, 300);
    expect(Number.isFinite(r.x)).toBe(true);
    expect(Number.isFinite(r.y)).toBe(true);
    expect(r.width).toBeGreaterThan(0);
    expect(r.height).toBeGreaterThan(0);
    expect(r.x + r.width).toBeLessThanOrEqual(400);
  });

  it("a tiny image is still fully croppable — the minimum never exceeds it", () => {
    /* MIN_CROP_PX must not become a floor larger than the picture, or an 8px
       avatar could not be cropped at all and the sheet would refuse it. */
    const r = clampCrop({ x: 0, y: 0, width: 8, height: 8 }, 8, 8);
    expect(r).toEqual({ x: 0, y: 0, width: 8, height: 8 });
  });

  it("the plan clamps too, so a bad crop can never reach the canvas", () => {
    const p = planEdit({
      naturalWidth: 400,
      naturalHeight: 300,
      rotation: 0,
      crop: { x: -100, y: -100, width: 99999, height: 99999 },
    });
    expect(p.crop).toEqual({ x: 0, y: 0, width: 400, height: 300 });
    expect(p.outWidth).toBe(400);
    expect(p.outHeight).toBe(300);
  });

  it("clamps against the ROTATED stage, not the original orientation", () => {
    /* The user drags the box on what they can see. Clamping a 90°-turned photo
       against its pre-rotation dimensions would cut the crop short on one axis
       and let it overhang on the other. */
    const p = planEdit({
      naturalWidth: 400,
      naturalHeight: 300,
      rotation: 1,
      crop: { x: 0, y: 0, width: 9999, height: 9999 },
    });
    expect(p.stageWidth).toBe(300);
    expect(p.stageHeight).toBe(400);
    expect(p.crop).toEqual({ x: 0, y: 0, width: 300, height: 400 });
  });

  it("every crop mutation in the sheet goes through a clamp", () => {
    /* The invariant is only worth as much as its coverage: a single raw
       `setCrop({...})` from a drag handler would bypass it. */
    const c = code(SHEET);
    const sets = c.match(/setCrop\(/g) ?? [];
    expect(sets.length).toBeGreaterThan(2);
    for (const m of c.matchAll(/setCrop\((?!\(c\))([\s\S]{0,120})/g)) {
      const body = m[1];
      const ok =
        /clampCrop\(|fitAspect\(|centeredAspectCrop\(|rotateCropQuarter\(/.test(body) ||
        /^\s*null\s*\)/.test(body) ||
        // the initial "select the whole frame", which is the stage by construction
        /x:\s*0,\s*y:\s*0,\s*width:\s*stage\.width,\s*height:\s*stage\.height/.test(body);
      expect(ok, `unclamped setCrop: ${body.slice(0, 90)}`).toBe(true);
    }
  });
});

describe("#144 — the aspect presets", () => {
  it("1:1 is the largest centred square", () => {
    expect(centeredAspectCrop(400, 300, 1)).toEqual({ x: 50, y: 0, width: 300, height: 300 });
    expect(centeredAspectCrop(300, 400, 1)).toEqual({ x: 0, y: 50, width: 300, height: 300 });
  });

  it("16:9 fits inside a tall photo", () => {
    const r = centeredAspectCrop(300, 400, 16 / 9);
    expect(r.width).toBe(300);
    expect(r.height).toBe(169);
    expect(r.x).toBe(0);
    expect(r.y + r.height).toBeLessThanOrEqual(400);
  });

  it("an invalid aspect falls back to the whole image rather than throwing", () => {
    /* A preset is a convenience and must never be the reason a photo cannot be
       sent — so every degenerate value degrades to "no crop". */
    for (const a of [0, -1, NaN, Infinity]) {
      expect(centeredAspectCrop(400, 300, a)).toEqual({ x: 0, y: 0, width: 400, height: 300 });
    }
  });

  it("fitAspect keeps the ratio instead of being squared off by the clamp", () => {
    /* clampCrop caps width and height INDEPENDENTLY, so an oversized
       aspect-correct rect handed straight to it comes back the wrong shape —
       the preset would silently stop being a preset. */
    const r = fitAspect({ x: 0, y: 0, width: 9999, height: 10 }, 1, 400, 300);
    expect(r.width).toBe(r.height);
    expect(r.width).toBeLessThanOrEqual(300);
    const wide = fitAspect({ x: 0, y: 0, width: 400, height: 5 }, 16 / 9, 400, 300);
    expect(wide.width / wide.height).toBeCloseTo(16 / 9, 1);
    expect(wide.x + wide.width).toBeLessThanOrEqual(400);
    expect(wide.y + wide.height).toBeLessThanOrEqual(300);
  });

  it("a freeform (null) aspect just clamps", () => {
    expect(fitAspect({ x: -5, y: 0, width: 100, height: 40 }, null, 400, 300)).toEqual({
      x: 0,
      y: 0,
      width: 100,
      height: 40,
    });
  });
});

describe("#144 — rotating carries the crop with the photo", () => {
  it("a quarter turn maps the rect into the new stage's axes", () => {
    // 400×300 stage, box at (10,20) sized 100×50 → clockwise → 300×400 stage.
    const r = rotateCropQuarter({ x: 10, y: 20, width: 100, height: 50 }, 400, 300, 1);
    expect(r).toEqual({ x: 300 - 20 - 50, y: 10, width: 50, height: 100 });
  });

  it("clockwise then counter-clockwise returns the original", () => {
    const start = { x: 10, y: 20, width: 100, height: 50 };
    const cw = rotateCropQuarter(start, 400, 300, 1);
    const back = rotateCropQuarter(cw, 300, 400, -1);
    expect(back).toEqual(start);
  });

  it("the result always fits its new stage", () => {
    for (const dir of [1, -1] as const) {
      const r = rotateCropQuarter({ x: 350, y: 250, width: 60, height: 60 }, 400, 300, dir);
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.x + r.width).toBeLessThanOrEqual(300);
      expect(r.y + r.height).toBeLessThanOrEqual(400);
    }
  });
});

describe("#144 — the working canvas is bounded", () => {
  it("a 48-megapixel photo is never held at full resolution", () => {
    /* Constraint: a phone shoots 8000×6000. Decoding that is unavoidable;
       carrying it into the crop stage is not. */
    const p = planEdit({ naturalWidth: 8000, naturalHeight: 6000, rotation: 0 });
    expect(Math.max(p.drawWidth, p.drawHeight)).toBeLessThanOrEqual(EDIT_MAX_EDGE);
    expect(Math.max(p.stageWidth, p.stageHeight)).toBeLessThanOrEqual(EDIT_MAX_EDGE);
    expect(p.outWidth).toBeLessThanOrEqual(EDIT_MAX_EDGE);
  });

  it("the bound is the downscale pipeline's own, not a second number", () => {
    /* Editing to 4096 and then immediately downscaling to 2048 would be pure
       waste; a second literal is how the two drift apart. */
    const src = code(LIB);
    expect(src).toMatch(/EDIT_MAX_EDGE\s*=\s*DOWNSCALE_MAX_EDGE/);
    expect(EDIT_MAX_EDGE).toBe(2048);
  });

  it("never upscales a small photo", () => {
    const p = planEdit({ naturalWidth: 320, naturalHeight: 240, rotation: 0 });
    expect(p.drawWidth).toBe(320);
    expect(p.drawHeight).toBe(240);
  });
});

describe("#144 — cancel emits the ORIGINAL file, not a re-encode", () => {
  /* The contract: opening the editor and changing your mind has to be
     indistinguishable from never having opened it. A re-encode on that path
     costs quality for nothing and is invisible to the sender. */

  it("the sheet hands back the caller's own File object on both skip paths", () => {
    const c = code(SHEET);
    // The explicit "Use original" button.
    expect(c).toMatch(/function useOriginal\(\)\s*\{\s*onUse\(file\);\s*\}/);
    // …and the plan-was-a-no-op / render-failed paths inside the apply button.
    expect(c).toMatch(/if\s*\(!edited\)\s*\{[\s\S]{0,200}onUse\(file\);/);
    expect(c).toMatch(/catch\s*\{[\s\S]{0,120}onUse\(file\);/);
    /* No path may wrap the original in a fresh File: that would re-type it and
       drop the name, and is the shape a "harmless tidy-up" would introduce. */
    expect(c).not.toMatch(/onUse\(new File\(\[file\]/);
  });

  it("the composer uploads that same object when the sheet is dismissed", () => {
    const c = code(MESSAGES);
    expect(c).toMatch(
      /onClose=\{\(\)\s*=>\s*\{\s*const original = editImage;\s*setEditImage\(null\);\s*void uploadFile\(original\);/,
    );
  });

  it("an unchanged plan is reported as identity, so nothing is re-encoded", () => {
    const p = planEdit({
      naturalWidth: 400,
      naturalHeight: 300,
      rotation: 0,
      crop: { x: 0, y: 0, width: 400, height: 300 },
    });
    expect(p.isIdentity).toBe(true);
    // …and any real change is NOT identity, or the edit would be dropped.
    expect(planEdit({ naturalWidth: 400, naturalHeight: 300, rotation: 0, crop: { x: 1, y: 0, width: 399, height: 300 } }).isIdentity).toBe(false);
    expect(planEdit({ naturalWidth: 400, naturalHeight: 300, rotation: 2 }).isIdentity).toBe(false);
  });

  it("renderEdit returns null (⇒ keep the original) when it cannot produce an edit", () => {
    /* Driven for real: this suite has no `document`, which is exactly the
       "no canvas" branch, and null is what tells the caller to send the
       untouched file. */
    const png = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "p.png", { type: "image/png" });
    return expect(renderEdit(png, { rotation: 1 })).resolves.toBeNull();
  });

  it("the editor never uploads — that stays the caller's job", () => {
    /* Keeping upload out of the sheet is what makes the edited photo inherit
       the downscale, the ≤512px thumbnail, the caption and the disappearing
       timer instead of quietly bypassing all four. */
    const c = code(SHEET) + code(LIB);
    expect(c).not.toMatch(/uploadAttachment|uploadThumbnail|fetch\(/);
  });

  it("the edited file rejoins the ordinary attachment flow", () => {
    const c = code(MESSAGES);
    expect(c).toMatch(/onUse=\{\(f\)\s*=>\s*\{\s*setEditImage\(null\);\s*void uploadFile\(f\);/);
    // …and uploadFile is still the thing that downscales + thumbnails.
    expect(c).toMatch(/processImageForUpload\(file\)/);
  });
});

describe("#144 — object URLs are released on every exit path", () => {
  /* An unrevoked blob URL pins the whole decoded photo for the life of the
     document. On this screen that is a multi-megabyte leak per picked photo,
     and it is invisible until a phone starts swapping. */

  it("the sheet revokes on unmount, including mid-decode", () => {
    const c = code(SHEET);
    const creates = (c.match(/URL\.createObjectURL\(/g) ?? []).length;
    const revokes = (c.match(/URL\.revokeObjectURL\(/g) ?? []).length;
    expect(creates).toBeGreaterThan(0);
    expect(revokes).toBeGreaterThanOrEqual(creates);
    // The cleanup runs even when the component unmounts before the decode
    // resolves — the `dead` flag alone would leave the URL alive.
    expect(c).toMatch(/return\s*\(\)\s*=>\s*\{[\s\S]{0,400}if\s*\(objectUrl\)\s*URL\.revokeObjectURL\(objectUrl\)/);
    // …and the ImageBitmap is closed too: it holds decoded pixels, not a URL.
    expect(c).toMatch(/closeSourceRef\.current\?\.\(\)/);
  });

  it("the encoder's own decode path revokes on success and on failure", () => {
    const c = code(LIB);
    const creates = (c.match(/URL\.createObjectURL\(/g) ?? []).length;
    const revokes = (c.match(/URL\.revokeObjectURL\(/g) ?? []).length;
    expect(creates).toBeGreaterThan(0);
    expect(revokes).toBeGreaterThanOrEqual(creates);
    // The throw path frees it before rethrowing…
    expect(c).toMatch(/catch\s*\(e\)\s*\{\s*URL\.revokeObjectURL\(url\);\s*throw e;/);
    // …and every success path goes through the finally.
    expect(c).toMatch(/finally\s*\{[\s\S]{0,120}decoded\?\.close\(\)/);
  });
});

describe("#144 — the sheet keeps the app's contracts", () => {
  it("every user-facing string comes from the dictionary", () => {
    /* An untranslated literal on a swept screen is the thing the dict exists to
       make impossible. Checked as "the labels are t() calls", not by hunting
       for English — the latter cannot tell a label from a class name. */
    const c = code(SHEET);
    for (const key of [
      "imageedit.title",
      "imageedit.close",
      "imageedit.rotateLeft",
      "imageedit.rotateRight",
      "imageedit.cropFree",
      "imageedit.cropSquare",
      "imageedit.cropWide",
      "imageedit.reset",
      "imageedit.dragHint",
      "imageedit.useOriginal",
      "imageedit.usePhoto",
      "imageedit.failed",
    ]) {
      expect(c, key).toContain(`t("${key}")`);
    }
  });

  it("both halves of every string are real, and the Arabic is Arabic", () => {
    const dict = fs.readFileSync(path.join(ROOT, "client/src/app/dict/imageedit.ts"), "utf8");
    const entries = [...dict.matchAll(/"(imageedit\.[a-zA-Z]+)":\s*\{\s*en:\s*"([^"]+)",\s*ar:\s*"([^"]+)"/g)];
    expect(entries.length).toBeGreaterThanOrEqual(12);
    for (const [, key, en, ar] of entries) {
      expect(en.trim().length, key).toBeGreaterThan(0);
      expect(ar.trim().length, key).toBeGreaterThan(0);
      // Not the cheap fake: the Arabic half must not be the English pasted across.
      expect(ar, key).not.toBe(en);
      expect(/[\u0600-\u06FF]/.test(ar), `${key} has no Arabic script`).toBe(true);
    }
  });

  it("the module is registered in the composed dictionary", () => {
    const idx = fs.readFileSync(path.join(ROOT, "client/src/app/dict/index.ts"), "utf8");
    expect(idx).toMatch(/import \{ IMAGEEDIT \} from "\.\/imageedit"/);
    expect(idx).toMatch(/\.\.\.IMAGEEDIT,/);
  });

  it("the ratio labels are LTR islands", () => {
    /* `16:9` is two numeric runs around a separator: inside Arabic prose the
       bidi algorithm swaps them and the button offers 9:16, a different crop.
       Same trap the video recorder records for its `0:07 / 1:00` clock. */
    const c = code(SHEET);
    expect(c).toMatch(/dir="ltr"[^>]*unicode-bidi:isolate/);
    expect(c).toMatch(/ratio: "16:9"/);
  });

  it("the crop overlay stays physically positioned, and only the overlay", () => {
    /* A photo does not mirror, so the crop box must NOT follow `dir` — the
       logical spelling would put the selection on the wrong part of the picture
       in Arabic. It is an inline style on the overlay only; the chrome around it
       is ordinary logical Tailwind and is swept by rtlSweep.test.ts. */
    const c = code(SHEET);
    expect(c).toMatch(/left:\s*pct\(crop\.x/);
    expect(c).toMatch(/top:\s*pct\(crop\.y/);
    // The prose recording WHY is present, so nobody "fixes" it into breaking Arabic.
    expect(SHEET).toMatch(/A PHOTO DOES NOT/);
  });

  it("the sheet declares its own dark scope, like its siblings", () => {
    /* The design utilities are scoped `.relay-v2 X` / `.dark.relay-v2 X`, and
       AppShell only adds `dark` in the dark theme — this is a black stage in
       both. Same as VideoRecordSheet / AuthPanel / PasscodeGate. */
    expect(code(SHEET)).toMatch(/className="dark relay-v2 fixed inset-0 z-\[130\]/);
  });

  it("the primary action does not promise a send it has not performed", () => {
    /* `onUse` makes a pendingUpload; the composer's own Send is what sends. The
       sibling recorder makes the same distinction for the same reason. */
    const dict = fs.readFileSync(path.join(ROOT, "client/src/app/dict/imageedit.ts"), "utf8");
    expect(dict).toMatch(/"imageedit\.usePhoto":\s*\{\s*en:\s*"Use photo"/);
    expect(dict).not.toMatch(/"imageedit\.[a-zA-Z]+":\s*\{\s*en:\s*"Send"/);
  });

  it("touch dragging is not stolen by the browser's own panning", () => {
    /* Without `touch-none` the crop box simply does not move on a phone — the
       feature is desktop-only and nothing says so. */
    expect(code(SHEET)).toMatch(/absolute inset-0 touch-none/);
  });
});
