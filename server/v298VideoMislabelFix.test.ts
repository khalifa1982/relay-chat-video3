/**
 * v2.98.0 — in-app video recorder: honest container labeling (owner: "the
 * status/message video record video" had "a problem").
 *
 * ROOT CAUSE (confirmed live via a headless Chromium capture with a fake
 * camera device): this browser's `MediaRecorder.isTypeSupported("video/mp4")`
 * returns true, but the recorder actually encodes VP9 video + Opus audio
 * under that label — `rec.mimeType` reveals `"video/mp4;codecs=vp9,opus"`
 * once encoding starts. A real .mp4 file that isn't really H.264/AAC can be
 * refused by a strict decoder (Safari's native player is exactly this) for
 * the RECIPIENT, even though it recorded and previewed fine for the sender.
 *
 * Two things had to be fixed, both found by driving the real MediaRecorder
 * API headlessly rather than guessing:
 *
 * 1. The mismatch is invisible at construction time — `rec.mimeType` stays
 *    the bare "video/mp4" for tens-to-hundreds of ms after start() and only
 *    flips to the qualified (honest) string once encoding is underway. A
 *    check placed right after `new MediaRecorder(...)` (the first attempt)
 *    NEVER caught it. Fixed by starting the recorder, immediately forcing
 *    `requestData()` to flush, and reading `mimeType` in that dataavailable
 *    handler — confirmed empirically to reveal the truth within ~2ms, with
 *    no meaningful footage recorded yet, so a mislabeled recorder can be
 *    swapped for an honest "video/webm" one transparently.
 * 2. A race: if the caller cancels in the same tick as construction (before
 *    the mislabel check has run), the swap logic used to ignore `cancelled`
 *    and start a brand-new live recorder anyway — one nobody would ever stop
 *    again, leaking the recorder and hanging the `done` promise forever
 *    (reproduced headlessly: `done` never resolved). Fixed with a `cancelled`
 *    guard inside the swap branch.
 *
 * Both were verified end-to-end against the real MediaRecorder API in a
 * headless Chromium page (fake device), not just source-read: the final
 * blob's first four bytes are 0x1A 0x45 0xDF 0xA3 (genuine WebM/Matroska
 * magic) when a swap occurs, `ext`/`mimeType` on the resolved result say
 * "webm" (not the stale mp4 pick), and both cancel-timing orders resolve
 * `done` with `null` instead of hanging. This file pins the source shape of
 * that fix — MediaRecorder isn't available in vitest's node environment, so
 * (per this repo's convention, e.g. imageDownscale.test.ts) the browser-only
 * mechanics are pinned as a source contract rather than executed here.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const VIDEO_NOTE = readFileSync(
  join(__dirname, "..", "client/src/lib/videoNote.ts"),
  "utf8",
);

const RECORD_FN = VIDEO_NOTE.slice(VIDEO_NOTE.indexOf("export function recordFromStream"));

describe("videoNote — honest container labeling (v2.98.0)", () => {
  it("only the 'video/mp4' pick is ever suspected of lying (webm openly names its own codec)", () => {
    expect(RECORD_FN).toMatch(/if \(ext !== "mp4"\) return; \/\/ only the "video\/mp4" label can lie/);
  });

  it("forces an immediate requestData() flush instead of trusting mimeType at construction time", () => {
    // The bug this replaces: checking rec.mimeType right after `new
    // MediaRecorder(...)` never sees the qualified codec string — confirmed
    // empirically it stays the bare "video/mp4" until encoding starts.
    expect(RECORD_FN).toMatch(/rec\.requestData\(\); \/\/ forces the mislabel check to resolve in ~ms, not 1s/);
    expect(RECORD_FN).not.toMatch(/if \(ext === "mp4" && \/vp\[89\]\|opus\/i\.test\(rec\.mimeType/);
  });

  it("detects VP8/VP9/Opus hiding under the video/mp4 label and swaps to an honest webm recorder", () => {
    expect(RECORD_FN).toMatch(/\/vp\[89\]\|opus\/i\.test\(r\.mimeType \|\| ""\)/);
    expect(RECORD_FN).toMatch(/const honest = constructRecorder\(stream, "video\/webm"\);/);
    expect(RECORD_FN).toMatch(/ext = "webm";\s*\n\s*mimeType = "video\/webm";/);
  });

  it("a cancel() landing before the swap check runs is respected — no orphaned recorder, no hung promise", () => {
    // Reproduced headlessly before this guard existed: done never resolved.
    const swapBlock = RECORD_FN.slice(RECORD_FN.indexOf("const check = "));
    const guardIdx = swapBlock.indexOf("if (cancelled) return;");
    const removeStopIdx = swapBlock.indexOf('r.removeEventListener("stop", finish)');
    expect(guardIdx).toBeGreaterThan(-1);
    expect(removeStopIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeLessThan(removeStopIdx); // guard must run BEFORE the swap proceeds
  });

  it("the resolved result reports the CURRENT ext/mimeType, never the stale original pick", () => {
    const finishFn = RECORD_FN.slice(RECORD_FN.indexOf("const finish = "), RECORD_FN.indexOf("const onData ="));
    expect(finishFn).toMatch(/const finalMime = rec\.mimeType \|\| mimeType;/);
    expect(finishFn).toMatch(/mimeType: finalMime,\s*\n\s*ext,/);
    expect(finishFn).not.toMatch(/pick\.ext/);
    expect(finishFn).not.toMatch(/pick\.mimeType/);
  });

  it("swapping discards any sliver already buffered under the wrong label before recording continues", () => {
    const swapBlock = RECORD_FN.slice(
      RECORD_FN.indexOf("if (cancelled) return;"),
      RECORD_FN.indexOf("const honest ="),
    );
    expect(swapBlock).toMatch(/chunks\.length = 0;/);
  });
});
