/**
 * v2.107.39 — STORY MEDIA GOES THROUGH THE EDITORS.
 *
 * The chat composer has had crop/rotate/flip/draw for photos and draw-on-video
 * since v2.107.2x; the status composer still posted whatever the picker handed
 * it, untouched. A story is MORE public than a message — it deserves the same
 * pass, not less. The wiring these pins hold: picking an image or video (from
 * the file picker OR the in-app camera recorder) opens the matching editor
 * above the composer; "Use" stages the edited file, Cancel stages the ORIGINAL
 * byte for byte (the editors' own contract — the old one-tap flow survives);
 * a staged preview carries an Edit pill to re-open the editor; audio, which
 * has no editor, bypasses the whole thing.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const read = (p: string) => fs.readFileSync(path.resolve(__dirname, p), "utf8");
const STATUS = read("Status.tsx");
const DICT = read("../../app/dict/status.ts");

describe("the intake routes through the editors", () => {
  it("pickFile: image and video open an editor; audio bypasses", () => {
    const at = STATUS.indexOf("function pickFile(");
    const body = STATUS.slice(at, STATUS.indexOf("\n  }", at));
    expect(body).toMatch(/if \(k === "image" \|\| k === "video"\) \{/);
    expect(body).toMatch(/setEditing\(f\);/);
    expect(body).toMatch(/\} else \{\s*setFile\(f\);/);
  });

  it("the camera recorder's clip goes through pickFile — so it routes too", () => {
    expect(STATUS).toMatch(/setRecOpen\(false\);\s*pickFile\(new File\(\[r\.blob\]/);
  });

  it("both editors are mounted; Cancel stages the ORIGINAL, Use stages the edit", () => {
    expect(STATUS).toMatch(/mediaKindOf\(editing\) === "image" && \(\s*<ImageEditSheet/);
    expect(STATUS).toMatch(/mediaKindOf\(editing\) === "video" && \(\s*<MediaEditSheet/);
    const closes = STATUS.match(/onClose=\{\(\) => \{ setFile\(editing\); setEditing\(null\); \}\}/g) ?? [];
    const uses = STATUS.match(/onUse=\{\(f\) => \{ setFile\(f\); setEditing\(null\); \}\}/g) ?? [];
    expect(closes.length).toBe(2);
    expect(uses.length).toBe(2);
  });
});

describe("the staged preview can re-enter the editor", () => {
  it("an Edit pill sits on the preview — hidden for audio, which has no editor", () => {
    expect(STATUS).toMatch(/mediaKindOf\(file\) !== "audio" && \(/);
    expect(STATUS).toMatch(/onClick=\{\(\) => setEditing\(file\)\}/);
    expect(STATUS).toMatch(/<Pencil className="size-3" \/> \{t\("status\.editMedia"\)\}/);
  });

  it("the pill's label exists in both languages", () => {
    expect(DICT).toMatch(/"status\.editMedia": \{ en: "Edit", ar: "تعديل" \}/);
  });
});

describe("the layering contract", () => {
  it("the editors' own portals (z-130) clear the status dialog (z-95)", () => {
    // Both editors portal themselves to document.body at z-[130]; the status
    // composer overlay is z-[95]. Pinned in all three files so a future z
    // shuffle in any ONE of them has to come back here.
    const IMG = fs.readFileSync(path.resolve(__dirname, "../../app/ImageEditSheet.tsx"), "utf8");
    const MED = fs.readFileSync(path.resolve(__dirname, "../../app/MediaEditSheet.tsx"), "utf8");
    expect(STATUS).toMatch(/fixed inset-0 z-\[95\]/);
    expect(IMG).toMatch(/fixed inset-0 z-\[130\]/);
    expect(MED).toMatch(/fixed inset-0 z-\[130\]/);
  });
});
