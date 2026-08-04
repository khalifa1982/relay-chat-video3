/**
 * VIDEO COVERS (v2.107.30) — the rules are tested BEHAVIOURALLY where they are
 * pure (seek time, cover dimensions), and the WIRING is source-pinned, because
 * this suite runs in the `node` environment and the wiring's failure modes are
 * exactly the silent kind: a bubble that quietly falls back to the black-box
 * `<video preload>` looks like a working feature on every desktop browser and
 * ships the original bug to every phone.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { THUMB_MAX_EDGE } from "./imageDownscale";
import { posterSeekSeconds, posterTargetDims } from "./videoPoster";

const ROOT = path.resolve(__dirname, "../../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

describe("video covers — where in the clip the cover comes from", () => {
  it("a normal clip is captured at 0.1s — the first SCREEN, not the black frame 0", () => {
    expect(posterSeekSeconds(12.4)).toBe(0.1);
    expect(posterSeekSeconds(0.3)).toBe(0.1);
  });

  it("a clip at or under 0.2s is captured at its very start", () => {
    // Seeking 0.1 into a 0.15s clip lands past its midpoint — that is no longer
    // "the first screen" of anything.
    expect(posterSeekSeconds(0.2)).toBe(0);
    expect(posterSeekSeconds(0.05)).toBe(0);
  });

  it("an unknown duration never produces a seek the element would reject", () => {
    expect(posterSeekSeconds(NaN)).toBe(0);
    // An INDETERMINATE duration (some containers report Infinity until fully
    // parsed) captures at the start — the one position every decoder can serve.
    expect(posterSeekSeconds(Infinity)).toBe(0);
    expect(posterSeekSeconds(-3)).toBe(0);
    expect(posterSeekSeconds(0)).toBe(0);
  });
});

describe("video covers — the cover is a photo thumbnail, by the photo's own rule", () => {
  it("bounds the long edge at THUMB_MAX_EDGE, aspect preserved", () => {
    const d = posterTargetDims(1920, 1080);
    expect(Math.max(d.width, d.height)).toBe(THUMB_MAX_EDGE);
    expect(d.width / d.height).toBeCloseTo(1920 / 1080, 2);
  });

  it("never UPSCALES a small video — its frame is already its own thumbnail", () => {
    const d = posterTargetDims(320, 240);
    expect(d.width).toBe(320);
    expect(d.height).toBe(240);
  });

  it("portrait bounds the TALL edge — a 9:16 phone clip stays 9:16", () => {
    const d = posterTargetDims(1080, 1920);
    expect(d.height).toBe(THUMB_MAX_EDGE);
    expect(d.width / d.height).toBeCloseTo(1080 / 1920, 2);
  });
});

describe("video covers — the wiring, source-pinned", () => {
  const messages = read("client/src/pages/app/Messages.tsx");

  it("a picked video captures its poster BEFORE uploading, and the upload carries it", () => {
    // The upload branch: poster first, then thumbKey + dims + duration ride the
    // same uploadAttachment call. If any of these pins break, videos silently
    // upload coverless and dimensionless — the pre-v2.107.30 world.
    const branch = messages.slice(messages.indexOf('startsWith("video/")) {'));
    expect(branch).toContain("await captureVideoPoster(file)");
    expect(branch).toContain("uploadThumbnail(poster.blob");
    expect(branch).toContain("durationMs: poster?.durationMs");
    expect(branch).toContain("thumbKey,");
  });

  it("a video bubble WITH a cover renders the cover as an <img>, keeping the play glyph", () => {
    // The cover path must be the image element (instant, lazy, works on iOS) —
    // not a poster attribute on the video element, which still costs a media
    // fetch per bubble.
    expect(messages).toMatch(/thumbUrl && !imgBroken[\s\S]{0,900}src=\{thumbUrl\}[\s\S]{0,900}<Play/);
  });

  it("a legacy video without a cover still PAINTS a frame on phones", () => {
    // The media-fragment start plus playsInline is what makes iOS/Android render
    // anything at all; losing either regresses to the black rectangle.
    expect(messages).toContain("#t=0.1");
    expect(messages).toMatch(/<video[^>]*playsInline/);
  });

  it("a broken cover falls back to the playable video, never to nothing", () => {
    const vid = messages.slice(messages.indexOf('mimeType.startsWith("video/")'));
    expect(vid).toContain("onError={() => setImgBroken(true)}");
  });
});
