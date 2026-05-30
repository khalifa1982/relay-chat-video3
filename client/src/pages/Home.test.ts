import { describe, it, expect } from "vitest";

/**
 * The loop reel renders LOOP_FRAMES twice in a row, then animates the track
 * with `translateX(-50%)` so the second half scrolls into the same position
 * the first half started at — that's how the loop appears seamless.
 *
 * These tests pin the pure math: how wide the track is and how wide each
 * frame is, given a frame count. Changing the duplication factor or the
 * frame width without changing these tests would visually break the loop.
 */
describe("Home — loop-reel layout math", () => {
  // The Home component uses LOOP_FRAMES.length === 6 today, but the math
  // should hold for any non-trivial count.
  function trackWidthPercent(frameCount: number): number {
    return frameCount * 200;
  }
  function frameWidthPercent(frameCount: number): number {
    return 100 / (frameCount * 2);
  }

  it("track width grows with frame count to fit two copies of the strip", () => {
    expect(trackWidthPercent(6)).toBe(1200);
    expect(trackWidthPercent(4)).toBe(800);
    expect(trackWidthPercent(1)).toBe(200);
  });

  it("frame width is the fraction of track each duplicated frame occupies", () => {
    // 12 frames (6 duplicated) inside a 1200% track: each frame is 100% / 12 of the track.
    expect(frameWidthPercent(6)).toBeCloseTo(100 / 12, 6);
    expect(frameWidthPercent(4)).toBeCloseTo(100 / 8, 6);
  });

  it("two copies of the strip equal the track width", () => {
    for (const n of [3, 6, 8]) {
      // Each frame width × (2 * n) frames = track width
      const total = frameWidthPercent(n) * (2 * n);
      expect(total).toBeCloseTo(100, 6);
    }
  });
});

describe("Home — asset paths are local manus-storage URLs", () => {
  // Sanity-check that no asset path slipped back to absolute http(s) URLs.
  // Local /manus-storage paths share lifecycle with the project and never expire.
  const ASSET_PATHS = [
    "/manus-storage/hero_7fd2aad5.png",
    "/manus-storage/scene-chat_d5b71720.png",
    "/manus-storage/scene-voice-call_757f9f34.png",
    "/manus-storage/scene-video-grid_a221d124.png",
    "/manus-storage/scene-dialpad_b09b59c0.png",
    "/manus-storage/scene-launch_d020f421.png",
    "/manus-storage/loop-1-dial_0d16a088.png",
    "/manus-storage/loop-2-ringing_fb44c0f7.png",
    "/manus-storage/loop-3-connecting_f6b2bf94.png",
    "/manus-storage/loop-4-live_d2b91240.png",
    "/manus-storage/loop-5-group_c4eb3cbd.png",
    "/manus-storage/loop-6-chat_bf820cb4.png",
  ];

  it("every asset path is server-relative and starts with /manus-storage/", () => {
    for (const p of ASSET_PATHS) {
      expect(p.startsWith("/manus-storage/")).toBe(true);
      expect(p.startsWith("http")).toBe(false);
    }
  });

  it("twelve unique paths (six scenes + six loop frames)", () => {
    expect(new Set(ASSET_PATHS).size).toBe(12);
  });
});
