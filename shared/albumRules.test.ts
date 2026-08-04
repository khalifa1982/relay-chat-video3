/**
 * ALBUMS (v2.107.32) — the counting contract, tested once because it is
 * WRITTEN once: the picker and `messages.send` import these functions, so a
 * green suite here is a client and a server that cannot disagree about what
 * fits in an album.
 */
import { describe, expect, it } from "vitest";
import { ALBUM_MAX_IMAGES, ALBUM_MAX_VIDEOS, ALBUM_MIN_ITEMS, albumCounts, albumKindFor } from "./albumRules";

describe("albums — what fits", () => {
  it("the owner's numbers, verbatim: 100 photos and 100 videos", () => {
    expect(ALBUM_MAX_IMAGES).toBe(100);
    expect(ALBUM_MAX_VIDEOS).toBe(100);
    expect(ALBUM_MIN_ITEMS).toBe(2);
  });

  it("a full album at both caps is allowed; one more of either is not", () => {
    const imgs = Array(100).fill("image/jpeg");
    const vids = Array(100).fill("video/mp4");
    expect(albumCounts([...imgs, ...vids])).toEqual({ ok: true, images: 100, videos: 100, reason: null });
    expect(albumCounts([...imgs, "image/png", ...vids]).reason).toBe("images");
    expect(albumCounts([...imgs, ...vids, "video/webm"]).reason).toBe("videos");
  });

  it("anything that is not a photo or a video refuses the WHOLE selection", () => {
    // "kind" outranks the counts: a selection containing a PDF is wrong before
    // it is long, and half an album is a different message than the one picked.
    expect(albumCounts(["image/jpeg", "application/pdf", "image/png"]).reason).toBe("kind");
    expect(albumCounts(["audio/mp4"]).reason).toBe("kind");
    expect(albumCounts([]).reason).toBe("empty");
  });

  it("mime case never matters", () => {
    expect(albumCounts(["IMAGE/JPEG", "Video/MP4"]).ok).toBe(true);
  });
});

describe("albums — the kind an album rides under", () => {
  it("derives from the COVER (item 0), image unless that item is video", () => {
    // Deliberately an EXISTING kind: this is exactly what a not-yet-updated
    // client renders during the deploy window — the cover, not a blank.
    expect(albumKindFor("video/mp4")).toBe("video");
    expect(albumKindFor("image/webp")).toBe("image");
    expect(albumKindFor("")).toBe("image");
  });
});
