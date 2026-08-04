/**
 * PRE-UPLOAD ANNOTATION — draw on a photo before it is sent.
 *
 * The geometry here is driven rather than pinned: whether a stroke drawn at the
 * middle of the preview lands at the middle of the ENCODED file is exactly what
 * a source assertion cannot answer, and it is the whole feature. The two
 * canvases are different sizes by construction (the preview is bounded for the
 * screen, the output by the upload pipeline's 2048), so a pixel-space stroke
 * would be drawn in one place and saved in another — and it would still look
 * perfect on screen.
 *
 * `renderDrawing` itself is deliberately NOT driven here. It needs a real
 * canvas, and in this environment `document` is undefined, so every call
 * returns null — a "refuses a gif" test would pass without the gate existing at
 * all. The gate is asserted where it can be: as agreement with the downscale
 * pipeline's own predicate, plus the ORDER of the guards in source.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  DRAW_COLORS,
  MIN_STROKE_PX,
  STROKE_FRACTION,
  hasDrawing,
  isEditableImage,
  paintStrokes,
  sanitizeStrokes,
  strokeWidthPx,
  toUnitPoint,
  undoStrokes,
  type DrawStroke,
} from "./MediaEditSheet";
import { EDIT_MAX_EDGE } from "@/lib/imageEdit";
import { DOWNSCALE_MAX_EDGE, isDownscalableImage } from "@/lib/imageDownscale";

const ROOT = path.resolve(__dirname, "../../..");
const SHEET = fs.readFileSync(path.join(ROOT, "client/src/app/MediaEditSheet.tsx"), "utf8");
const MESSAGES = fs.readFileSync(path.join(ROOT, "client/src/pages/app/Messages.tsx"), "utf8");

/**
 * Strip comments — prose ABOUT a pattern is not the pattern (the recurring trap).
 *
 * ── WHY THIS IS NOT THE USUAL ONE-LINER ──────────────────────────────────────────────
 * The obvious `src.replace(/\/\*[\s\S]*?\*\//g, "")` is WRONG on this file and
 * measurably so: `accept="image/*"` contains `/*`, so the strip opens a comment
 * inside a JSX attribute and runs to the next real `*&#47;` somewhere below.
 * Measured on `Messages.tsx` it deleted 147,817 of 314,141 characters — nearly
 * half the file, silently. Every `not.toMatch` over that region would have
 * passed for the wrong reason, which is the one failure worse than going red.
 *
 * So comments are matched only in the two shapes they actually take here: a JSX
 * `{/* … *&#47;}` block, and a block or line comment that STARTS a line. A `/*`
 * sitting mid-line inside a string literal matches neither.
 */
function code(src: string): string {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const d = src[i + 1];
    if (c === "/" && d === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && d === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      out += c;
      i++;
      while (i < src.length) {
        if (src[i] === "\\") {
          out += src.slice(i, i + 2);
          i += 2;
          continue;
        }
        out += src[i];
        if (src[i] === c) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/* The stripper is itself load-bearing, so it is checked rather than trusted:
   it must remove real comments and must NOT eat the source around them. */
describe("the comment stripper does not eat the file", () => {
  it("keeps a `/*` that lives inside a string literal", () => {
    expect(code('<input accept="image/*" onChange={f} />')).toContain('accept="image/*"');
  });

  it("still removes the comment shapes this file uses", () => {
    expect(code("  {/* a JSX note */}\n  keep")).not.toContain("a JSX note");
    expect(code("  /* a block note */\n  keep")).not.toContain("a block note");
    expect(code("  // a line note\n  keep")).not.toContain("a line note");
    expect(code("  {/* a JSX note */}\n  keep")).toContain("keep");
  });

  it("does not swallow the source that FOLLOWS a `/*` in a string", () => {
    /* The naive stripper's real damage was forward: it opened a comment at
       `accept="image/*"` and closed at the next `*&#47;` far below, taking
       everything between with it. A LENGTH check cannot see that — measured, the
       broken version left 52.9% of this file and the correct one leaves 53.8%,
       because the file genuinely is ~48% comments — so the property is asserted
       directly instead: the attribute survives, and so does code defined after it. */
    const c = code(MESSAGES);
    const at = c.indexOf('accept="image/*"');
    expect(at).toBeGreaterThan(-1);
    expect(c.indexOf("<MediaEditSheet", at)).toBeGreaterThan(at);
    expect(c.indexOf("<ImageEditSheet", at)).toBeGreaterThan(at);
  });
});

/* ── a recording 2D context ───────────────────────────────────────────────────
   Records the calls that decide where ink lands. Anything the painter asks for
   that is not recorded here is a no-op, which is what we want: the test should
   fail if the painter starts depending on something it does not set. */
type Op =
  | { op: "moveTo"; x: number; y: number }
  | { op: "lineTo"; x: number; y: number }
  | { op: "arc"; x: number; y: number; r: number }
  | { op: "ellipse"; x: number; y: number; rx: number; ry: number }
  | { op: "stroke" }
  | { op: "fill" };

function fakeCtx() {
  const ops: Op[] = [];
  const widths: number[] = [];
  const strokeStyles: unknown[] = [];
  const fillStyles: unknown[] = [];
  const ctx = {
    set lineWidth(v: number) {
      widths.push(v);
    },
    set strokeStyle(v: unknown) {
      strokeStyles.push(v);
    },
    set fillStyle(v: unknown) {
      fillStyles.push(v);
    },
    lineCap: "",
    lineJoin: "",
    save() {},
    restore() {},
    beginPath() {},
    moveTo(x: number, y: number) {
      ops.push({ op: "moveTo", x, y });
    },
    lineTo(x: number, y: number) {
      ops.push({ op: "lineTo", x, y });
    },
    arc(x: number, y: number, r: number) {
      ops.push({ op: "arc", x, y, r });
    },
    ellipse(x: number, y: number, rx: number, ry: number) {
      ops.push({ op: "ellipse", x, y, rx, ry });
    },
    stroke() {
      ops.push({ op: "stroke" });
    },
    fill() {
      ops.push({ op: "fill" });
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, ops, widths, strokeStyles, fillStyles };
}

/** Every coordinate the painter emitted, as a fraction of the canvas it was
 *  given — the space the strokes are actually stored in. */
function asFractions(ops: Op[], w: number, h: number): Array<[number, number]> {
  return ops
    .filter((o): o is Extract<Op, { x: number }> => "x" in o)
    .map((o) => [o.x / w, o.y / h] as [number, number]);
}

describe("draw — the preview and the encoded file are the same picture", () => {
  /* THE decision this feature rests on. Strokes are stored as 0..1 fractions of
     the image, so the two canvases — which are never the same size — paint the
     same picture at their own scales. A pixel-space stroke passes every "did it
     paint?" check and still saves the mark in the wrong place. */

  const stroke: DrawStroke = {
    color: "#ef4444",
    points: [
      { x: 0.25, y: 0.5 },
      { x: 0.75, y: 0.5 },
    ],
  };

  it("a fraction of the image lands at that fraction of the canvas", () => {
    const a = fakeCtx();
    paintStrokes(a.ctx, [stroke], 400, 200);
    expect(a.ops).toEqual([
      { op: "moveTo", x: 100, y: 100 },
      { op: "lineTo", x: 300, y: 100 },
      { op: "stroke" },
    ]);
  });

  it("the SAME strokes on a preview-sized and an output-sized canvas agree", () => {
    /* The real pairing: a 1400px preview and a 2048px output. If these two
       disagree, what the user drew is not what gets sent. */
    const preview = fakeCtx();
    const output = fakeCtx();
    paintStrokes(preview.ctx, [stroke], 1400, 933);
    paintStrokes(output.ctx, [stroke], 2048, 1365);
    const p = asFractions(preview.ops, 1400, 933);
    const o = asFractions(output.ops, 2048, 1365);
    expect(p.length).toBeGreaterThan(0);
    expect(o).toEqual(p);
  });

  it("the line is the same RELATIVE thickness at both sizes", () => {
    // A width in raw pixels would be a hairline on the output and a marker on
    // the preview — the mark would be honest in position and wrong in weight.
    const small = strokeWidthPx(400, 200) / 400;
    const large = strokeWidthPx(2048, 1365) / 2048;
    expect(large).toBeCloseTo(small, 3);
  });

  it("a TAP leaves a dot rather than nothing", () => {
    /* `lineTo` draws nothing for a one-point path, so without the dot branch
       the most likely first gesture on a touch screen silently does nothing. */
    const { ctx, ops } = fakeCtx();
    paintStrokes(ctx, [{ color: "#fff", points: [{ x: 0.5, y: 0.25 }] }], 200, 400);
    expect(ops).toEqual([{ op: "arc", x: 100, y: 100, r: strokeWidthPx(200, 400) / 2 }, { op: "fill" }]);
  });

  it("each stroke keeps its OWN colour", () => {
    const { ctx, strokeStyles } = fakeCtx();
    paintStrokes(
      ctx,
      [
        { color: "#ef4444", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
        { color: "#3b82f6", points: [{ x: 0, y: 1 }, { x: 1, y: 0 }] },
      ],
      100,
      100,
    );
    expect(strokeStyles).toEqual(["#ef4444", "#3b82f6"]);
  });

  it("paints nothing at all when there is nothing to paint", () => {
    const { ctx, ops, widths } = fakeCtx();
    paintStrokes(ctx, [], 100, 100);
    paintStrokes(ctx, null, 100, 100);
    paintStrokes(ctx, [{ color: "#fff", points: [] }], 100, 100);
    expect(ops).toEqual([]);
    // …and it does not even touch the context state, so a no-op draw cannot
    // disturb whatever the caller had set up.
    expect(widths).toEqual([]);
  });
});

describe("draw — a bad point can never reach the canvas", () => {
  /* One non-finite coordinate does not throw, it makes the WHOLE path paint
     nothing — so a single stray pointer event arriving mid-teardown would lose
     the user's entire stroke with no error anywhere. */

  it("drops non-finite points and keeps the rest of the stroke", () => {
    const clean = sanitizeStrokes([
      {
        color: "#fff",
        points: [
          { x: 0.1, y: 0.1 },
          { x: NaN, y: 0.2 },
          { x: 0.3, y: Infinity },
          { x: 0.4, y: 0.4 },
        ],
      },
    ]);
    expect(clean).toEqual([{ color: "#fff", points: [{ x: 0.1, y: 0.1 }, { x: 0.4, y: 0.4 }] }]);
  });

  it("no NaN survives into a paint call", () => {
    const { ctx, ops } = fakeCtx();
    paintStrokes(ctx, [{ color: "#fff", points: [{ x: NaN, y: 0 }, { x: 0.5, y: 0.5 }] }], 100, 100);
    for (const o of ops) {
      if ("x" in o) {
        expect(Number.isFinite(o.x)).toBe(true);
        expect(Number.isFinite(o.y)).toBe(true);
      }
    }
  });

  it("a stroke left with no usable points is removed entirely", () => {
    const strokes = [{ color: "#fff", points: [{ x: NaN, y: NaN }] }];
    expect(sanitizeStrokes(strokes)).toEqual([]);
    // …so it does not read as a drawing, and the ORIGINAL file ships.
    expect(hasDrawing(strokes)).toBe(false);
  });

  it("survives garbage without throwing", () => {
    for (const junk of [null, undefined, "x", 5, {}, [null], [{ color: "", points: [] }]]) {
      expect(() => sanitizeStrokes(junk as never)).not.toThrow();
      expect(hasDrawing(junk as never)).toBe(false);
    }
  });
});

describe("draw — nothing drawn means the ORIGINAL bytes are sent", () => {
  /* Opening the sheet and changing your mind must be indistinguishable from
     never having opened it. A re-encode on that path costs quality for nothing
     and is invisible to the sender. */

  it("hasDrawing is false until something real is drawn", () => {
    expect(hasDrawing([])).toBe(false);
    expect(hasDrawing([{ color: "#fff", points: [{ x: 0.5, y: 0.5 }] }])).toBe(true);
  });

  it("the renderer refuses before it decodes anything", () => {
    /* Order matters: a decode is the expensive, memory-hungry step, and there
       is nothing to draw on an empty stroke list. */
    const c = code(SHEET);
    const body = c.slice(c.indexOf("export async function renderDrawing"));
    const guard = body.indexOf("hasDrawing(strokes)");
    const decode = body.indexOf("decodeImage(file)");
    expect(guard).toBeGreaterThan(-1);
    expect(decode).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(decode);
  });

  it("both skip paths hand back the caller's own File object", () => {
    const c = code(SHEET);
    expect(c).toMatch(/function useOriginal\(\)\s*\{\s*onUse\(file\);\s*\}/);
    expect(c).toMatch(/if\s*\(!drawn\)\s*\{[\s\S]{0,200}onUse\(file\);/);
    expect(c).toMatch(/catch\s*\{[\s\S]{0,120}onUse\(file\);/);
    /* No path may wrap the original in a fresh File: that re-types it and drops
       the name, and is the shape a "harmless tidy-up" would introduce. */
    expect(c).not.toMatch(/onUse\(new File\(\[file\]/);
  });

  it("the composer uploads that same object when the sheet is dismissed", () => {
    expect(code(MESSAGES)).toMatch(
      /onClose=\{\(\)\s*=>\s*\{\s*const original = drawImage;\s*setDrawImage\(null\);\s*void uploadFile\(original\);/,
    );
  });
});

describe("draw — undo", () => {
  const a: DrawStroke = { color: "#fff", points: [{ x: 0, y: 0 }] };
  const b: DrawStroke = { color: "#000", points: [{ x: 1, y: 1 }] };

  it("removes the newest stroke and leaves the rest untouched", () => {
    expect(undoStrokes([a, b])).toEqual([a]);
  });

  it("is safe on an empty history", () => {
    expect(undoStrokes([])).toEqual([]);
  });

  it("does not mutate the array it was given", () => {
    const input = [a, b];
    undoStrokes(input);
    expect(input).toHaveLength(2);
  });

  it("the control is ABSENT rather than disabled when there is nothing to undo", () => {
    // The house rule: a control that can only refuse must not be on screen.
    expect(code(SHEET)).toMatch(/canUndo\s*&&\s*\(/);
    expect(code(SHEET)).toMatch(/const canUndo = strokes\.length > 0/);
  });
});

describe("draw — pointer positions", () => {
  it("normalizes against the rendered box", () => {
    expect(toUnitPoint(150, 60, { left: 100, top: 40, width: 200, height: 40 })).toEqual({ x: 0.25, y: 0.5 });
  });

  it("refuses a degenerate rect rather than emitting Infinity", () => {
    /* An element measured while hidden or mid-unmount reports a zero box;
       dividing by it poisons every point that follows. */
    for (const r of [
      { left: 0, top: 0, width: 0, height: 10 },
      { left: 0, top: 0, width: 10, height: 0 },
    ]) {
      expect(toUnitPoint(5, 5, r)).toBeNull();
    }
  });

  it("refuses a rect with NEGATIVE dimensions", () => {
    /* This is the case the size guard uniquely covers, and finding it was worth
       the mutation run: for a ZERO-sized rect the guard is redundant — the
       division yields Infinity and the finite check below catches it anyway —
       so removing the guard passed every other test here. A negative extent
       divides cleanly into a finite but meaningless fraction, which nothing
       downstream would reject. The property is that a rect which cannot yield a
       meaningful fraction is refused, not merely one that yields a non-finite
       number, and `toUnitPoint` is exported, so that contract is its own. */
    expect(toUnitPoint(5, 5, { left: 0, top: 0, width: -10, height: 10 })).toBeNull();
    expect(toUnitPoint(5, 5, { left: 0, top: 0, width: 10, height: -10 })).toBeNull();
  });

  it("does not clamp — a stroke may leave the picture where it was drawn", () => {
    // Clamping would drag the line along the edge instead of letting it exit,
    // which is a different drawing from the one the user made.
    const p = toUnitPoint(-10, 0, { left: 0, top: 0, width: 100, height: 100 });
    expect(p?.x).toBeLessThan(0);
  });
});

describe("draw — the shared bounds and gates are shared, not restated", () => {
  it("the gif gate DELEGATES to the downscale pipeline's own predicate", () => {
    /* A gif must never reach a canvas: the re-encode keeps ONE frame and
       silently drops the animation. Two copies of "which images may we redraw"
       is how one of them comes to admit a gif. */
    for (const m of ["image/gif", "image/svg+xml", "image/jpeg", "image/png", "image/webp", "video/mp4", "", "x"]) {
      expect(isEditableImage(m), m).toBe(isDownscalableImage(m));
    }
  });

  it("the working canvas is bounded by the upload pipeline's own cap", () => {
    // Not a second literal: drawing at 4000px only to have the downscale halve
    // it immediately is waste, and it is the memory spike a phone notices.
    expect(EDIT_MAX_EDGE).toBe(DOWNSCALE_MAX_EDGE);
    expect(code(SHEET)).toMatch(/fitWithin\([^)]*EDIT_MAX_EDGE\)/);
    expect(code(SHEET)).not.toMatch(/\b2048\b/);
  });

  it("the sheet never uploads — that stays the caller's job", () => {
    /* Keeping upload out is what makes the drawn photo inherit the downscale,
       the ≤512px thumbnail, the caption and the disappearing timer instead of
       quietly bypassing all four. */
    expect(code(SHEET)).not.toMatch(/uploadAttachment|uploadThumbnail|fetch\(/);
  });

  it("the drawn file rejoins the ordinary attachment flow", () => {
    const c = code(MESSAGES);
    expect(c).toMatch(/onUse=\{\(f\)\s*=>\s*\{\s*setDrawImage\(null\);\s*void uploadFile\(f\);/);
    expect(c).toMatch(/processImageForUpload\(file\)/);
  });

  it("ONE painter serves the preview and the encoder", () => {
    /* This is what makes the preview a statement about the file rather than a
       separate drawing that happens to look similar. */
    const c = code(SHEET);
    expect((c.match(/paintStrokes\(/g) ?? []).length).toBeGreaterThanOrEqual(3); // definition + 2 callers
    expect(c).toMatch(/const paint = useCallback\([\s\S]{0,900}paintStrokes\(/);
    expect(c.slice(c.indexOf("export async function renderDrawing"))).toMatch(/paintStrokes\(ctx, strokes/);
  });
});

describe("draw — the composer's ordinary photo path is untouched", () => {
  /* The spec's hard constraint: editing is skippable and the DEFAULT path to
     sending a photo must not get longer. Drawing is a separate attach-menu row,
     so the picker still goes straight to the rotate/crop sheet. */

  it("the photo picker still opens the rotate/crop sheet, unchanged", () => {
    const c = code(MESSAGES);
    expect(c).toMatch(/if\s*\(\s*isEditableImage\(file\.type\)\s*\)\s*\{\s*setEditImage\(file\);/);
    expect(c).toMatch(/<ImageEditSheet/);
  });

  it("the draw picker is a SEPARATE input and state, so neither can be mistaken for the other", () => {
    const c = code(MESSAGES);
    expect(c).toMatch(/ref=\{drawRef\}[^>]*accept="image\/\*"/);
    expect(c).toMatch(/if\s*\(\s*isEditableImage\(file\.type\)\s*\)\s*\{\s*setDrawImage\(file\);/);
    // Two distinct states — a mode flag on one of them is the shape that leaves
    // the wrong editor open on the right photo.
    expect(c).toMatch(/const \[editImage, setEditImage\]/);
    expect(c).toMatch(/const \[drawImage, setDrawImage\]/);
  });

  it("a file that fails the gate still uploads rather than being dropped", () => {
    const c = code(MESSAGES);
    const start = c.indexOf("async function handleDrawPick");
    expect(start).toBeGreaterThan(-1);
    /* Bounded by the function's OWN closing brace at its declaration indent —
       `indexOf("}\n")` finds the inner `if` block's brace and would read a
       window that stops before the line under test. */
    const fn = c.slice(start, c.indexOf("\n  }", start));
    expect(fn.length).toBeGreaterThan(80);
    expect(fn).toMatch(/setDrawImage\(file\);[\s\S]{0,60}return;[\s\S]{0,80}await uploadFile\(file\);/);
  });
});

describe("draw — object URLs are released on every exit path", () => {
  /* An unrevoked blob URL pins the whole decoded photo for the life of the
     document — a multi-megabyte leak per picked photo, invisible until a phone
     starts swapping. */

  it("the sheet revokes on unmount, including mid-decode", () => {
    const c = code(SHEET);
    const creates = (c.match(/URL\.createObjectURL\(/g) ?? []).length;
    const revokes = (c.match(/URL\.revokeObjectURL\(/g) ?? []).length;
    expect(creates).toBeGreaterThan(0);
    expect(revokes).toBeGreaterThanOrEqual(creates);
    expect(c).toMatch(/return\s*\(\)\s*=>\s*\{[\s\S]{0,400}if\s*\(objectUrl\)\s*URL\.revokeObjectURL\(objectUrl\)/);
    // …and the ImageBitmap is closed too: it holds decoded pixels, not a URL.
    expect(c).toMatch(/closeSourceRef\.current\?\.\(\)/);
  });

  it("the renderer's own decode path revokes on success and on failure", () => {
    const c = code(SHEET);
    expect(c).toMatch(/catch\s*\(e\)\s*\{\s*URL\.revokeObjectURL\(url\);\s*throw e;/);
    expect(c).toMatch(/finally\s*\{[\s\S]{0,120}decoded\?\.close\(\)/);
  });
});

describe("draw — the drag never re-renders the app on every pointer move", () => {
  it("the in-progress stroke lives in a ref, not in state", () => {
    /* A setState per pointermove re-renders this sheet sixty times a second
       while drawing. The committed strokes go into state on pointerup, which is
       the only moment anything else needs to know. */
    const c = code(SHEET);
    expect(c).toMatch(/const liveRef = useRef<DrawStroke \| null>\(null\)/);
    const move = c.slice(c.indexOf("function onPointerMove"), c.indexOf("function onPointerUp"));
    expect(move.length).toBeGreaterThan(50);
    expect(move).not.toMatch(/setStrokes/);
    expect(move).toMatch(/live\.points\.push/);
    // The commit happens exactly once, on release.
    expect(code(SHEET).slice(c.indexOf("function onPointerUp"))).toMatch(/setStrokes\(\(s\) => \[\.\.\.s, live\]\)/);
  });

  it("a finger held still does not grow the stroke forever", () => {
    expect(code(SHEET)).toMatch(/last\.x === p\.x && last\.y === p\.y/);
  });

  it("the canvas takes the gesture instead of the page scrolling", () => {
    // Without `touch-none` a finger pans the page and never draws.
    expect(code(SHEET)).toMatch(/touch-none/);
    expect(code(SHEET)).toMatch(/setPointerCapture/);
  });
});

describe("draw — every string reaches the reader in their own language", () => {
  /* This copy lives beside the component rather than in `dict/`, because there
     is no module for this surface yet and `dict/index.ts` is not editable from
     here. That makes THIS guard matter more, not less: it is the only thing
     standing between a new label and an untranslated screen. */

  it("both halves of every string are real, and the Arabic is Arabic", () => {
    const block = SHEET.slice(SHEET.indexOf("const COPY = {"), SHEET.indexOf("} as const;"));
    const entries = [...block.matchAll(/(\w+):\s*\{\s*\n?\s*en:\s*"([^"]+)",\s*\n?\s*ar:\s*"([^"]+)"/g)];
    expect(entries.length).toBeGreaterThanOrEqual(13);
    for (const [, key, en, ar] of entries) {
      expect(en.trim().length, key).toBeGreaterThan(0);
      expect(ar.trim().length, key).toBeGreaterThan(0);
      // Not the cheap fake: the Arabic half must not be the English pasted across.
      expect(ar, key).not.toBe(en);
      expect(/[؀-ۿ]/.test(ar), `${key} has no Arabic script`).toBe(true);
    }
  });

  it("every colour in the palette is labelled", () => {
    // A bare swatch gives a screen reader nothing at all.
    const block = SHEET.slice(SHEET.indexOf("const COPY = {"), SHEET.indexOf("} as const;"));
    for (const c of DRAW_COLORS) expect(block, c.key).toContain(`${c.key}:`);
    expect(code(SHEET)).toMatch(/aria-label=\{say\(c\.key\)\}/);
  });

  it("the composer gains no literal of its own", () => {
    /* One home for this feature's copy, so moving it into `dict/mediaedit.ts`
       is a single edit rather than a hunt. */
    const c = code(MESSAGES);
    expect(c).toMatch(/\{drawLabel\}/);
    expect(c).not.toMatch(/Draw on photo/);
  });

  it("the palette is a few colours, not a colour picker", () => {
    expect(DRAW_COLORS.length).toBeGreaterThanOrEqual(4);
    expect(DRAW_COLORS.length).toBeLessThanOrEqual(8);
    expect(new Set(DRAW_COLORS.map((c) => c.css)).size).toBe(DRAW_COLORS.length);
  });
});

describe("draw — stroke width", () => {
  it("scales with the longest edge", () => {
    expect(strokeWidthPx(1000, 500)).toBe(Math.round(1000 * STROKE_FRACTION));
    expect(strokeWidthPx(500, 1000)).toBe(Math.round(1000 * STROKE_FRACTION));
  });

  it("never falls below the visible minimum", () => {
    // On a tiny image the fraction rounds to nothing, and a zero-width line
    // paints nothing at all.
    expect(strokeWidthPx(10, 10)).toBe(MIN_STROKE_PX);
  });

  it("survives a degenerate canvas", () => {
    for (const [w, h] of [[0, 0], [NaN, 100], [-5, -5]]) {
      expect(Number.isFinite(strokeWidthPx(w, h))).toBe(true);
      expect(strokeWidthPx(w, h)).toBeGreaterThanOrEqual(MIN_STROKE_PX);
    }
  });
});

describe("circle tool — a drag's endpoints become an ellipse, everywhere the same", () => {
  /* Same contract as freehand: unit-space endpoints, one painter for preview and
     output. A circle stored in pixels of either canvas would be the wrong size on
     the other — honest in shape and wrong in scale. */

  it("sanitize keeps a two-point circle WITH its shape, first and last point only", () => {
    const out = sanitizeStrokes([
      {
        color: "#3b82f6",
        shape: "circle",
        points: [
          { x: 0.2, y: 0.2 },
          { x: 0.4, y: 0.9 }, // a mid-drag sample: geometry-irrelevant, must drop
          { x: 0.8, y: 0.6 },
        ],
      },
    ]);
    expect(out).toEqual([
      { color: "#3b82f6", shape: "circle", points: [{ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.6 }] },
    ]);
  });

  it("a one-point circle has no geometry and sanitizes away", () => {
    expect(sanitizeStrokes([{ color: "#fff", shape: "circle", points: [{ x: 0.5, y: 0.5 }] }])).toEqual([]);
    expect(hasDrawing([{ color: "#fff", shape: "circle", points: [{ x: 0.5, y: 0.5 }] }])).toBe(false);
  });

  it("the ellipse lands at the drag's bounding box, at that fraction of ANY canvas", () => {
    const circle: DrawStroke = {
      color: "#22c55e",
      shape: "circle",
      points: [
        { x: 0.25, y: 0.25 },
        { x: 0.75, y: 0.75 },
      ],
    };
    const { ctx, ops, strokeStyles } = fakeCtx();
    paintStrokes(ctx, [circle], 400, 200);
    expect(ops).toEqual([{ op: "ellipse", x: 200, y: 100, rx: 100, ry: 50 }, { op: "stroke" }]);
    expect(strokeStyles).toEqual(["#22c55e"]);
  });

  it("preview-sized and output-sized canvases agree about the circle", () => {
    const circle: DrawStroke = {
      color: "#fff",
      shape: "circle",
      points: [
        { x: 0.1, y: 0.2 },
        { x: 0.9, y: 0.8 },
      ],
    };
    const a = fakeCtx();
    const b = fakeCtx();
    paintStrokes(a.ctx, [circle], 1400, 933);
    paintStrokes(b.ctx, [circle], 2048, 1365);
    const frac = (ops: Op[], w: number, h: number) =>
      ops
        .filter((o): o is Extract<Op, { op: "ellipse" }> => o.op === "ellipse")
        .map((o) => [o.x / w, o.y / h, o.rx / w, o.ry / h]);
    const fa = frac(a.ops, 1400, 933);
    expect(fa.length).toBe(1);
    fa[0].forEach((v, i) => expect(v).toBeCloseTo(frac(b.ops, 2048, 1365)[0][i], 3));
  });

  it("a degenerate drag still paints a visible ring, never an invisible one", () => {
    // Both radii floor at half the stroke width — a shaky tap-drag of 1px must
    // not produce an ellipse thinner than the line that draws it.
    const { ctx, ops } = fakeCtx();
    paintStrokes(
      ctx,
      [{ color: "#fff", shape: "circle", points: [{ x: 0.5, y: 0.5 }, { x: 0.5005, y: 0.5 }] }],
      400,
      200,
    );
    const e = ops.find((o) => o.op === "ellipse") as Extract<Op, { op: "ellipse" }>;
    const w = strokeWidthPx(400, 200);
    expect(e.rx).toBeGreaterThanOrEqual(w / 2);
    expect(e.ry).toBeGreaterThanOrEqual(w / 2);
  });
});
