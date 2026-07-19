import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  DOWNSCALE_MAX_EDGE,
  THUMB_MAX_EDGE,
  WEBP_QUALITY,
  fitWithin,
  isDownscalableImage,
  renameForMime,
  shouldKeepOriginal,
} from "./imageDownscale";

/**
 * v2.89 — photo downscale + thumbnails (backlog #1).
 *
 * The decision logic is PURE and tested directly; the canvas/DOM plumbing and
 * the upload threading are pinned as source contracts (the repo's pattern for
 * browser-driven behavior).
 */

const MESSAGES = fs.readFileSync(
  path.resolve(__dirname, "..", "pages", "app", "Messages.tsx"),
  "utf8",
);
const UPLOAD_HELPER = fs.readFileSync(path.resolve(__dirname, "uploadAttachment.ts"), "utf8");
const V2UPLOAD = fs.readFileSync(
  path.resolve(__dirname, "..", "..", "..", "server", "v2upload.ts"),
  "utf8",
);
const V2DB = fs.readFileSync(
  path.resolve(__dirname, "..", "..", "..", "server", "v2db.ts"),
  "utf8",
);
const SCHEMA = fs.readFileSync(
  path.resolve(__dirname, "..", "..", "..", "drizzle", "schema.ts"),
  "utf8",
);

describe("downscale constants", () => {
  it("caps the longest edge at 2048 and thumbnails at 512, webp q≈0.85", () => {
    expect(DOWNSCALE_MAX_EDGE).toBe(2048);
    expect(THUMB_MAX_EDGE).toBe(512);
    expect(WEBP_QUALITY).toBeCloseTo(0.85, 2);
  });
});

describe("isDownscalableImage — what goes through the pipeline", () => {
  it("accepts ordinary raster images", () => {
    expect(isDownscalableImage("image/jpeg")).toBe(true);
    expect(isDownscalableImage("image/png")).toBe(true);
    expect(isDownscalableImage("image/webp")).toBe(true);
    expect(isDownscalableImage("image/heic")).toBe(true);
  });
  it("SKIPS gifs — a canvas re-encode would freeze the animation", () => {
    expect(isDownscalableImage("image/gif")).toBe(false);
  });
  it("skips svg (vector; blocked server-side anyway) and non-images", () => {
    expect(isDownscalableImage("image/svg+xml")).toBe(false);
    expect(isDownscalableImage("video/mp4")).toBe(false);
    expect(isDownscalableImage("application/pdf")).toBe(false);
    expect(isDownscalableImage("")).toBe(false);
    expect(isDownscalableImage(null)).toBe(false);
  });
});

describe("fitWithin — dimension capping", () => {
  it("scales the LONGEST edge down to the cap, preserving aspect", () => {
    expect(fitWithin(4032, 3024, 2048)).toEqual({ width: 2048, height: 1536, resized: true });
    expect(fitWithin(3024, 4032, 2048)).toEqual({ width: 1536, height: 2048, resized: true });
  });
  it("NEVER upscales — smaller images pass through untouched", () => {
    expect(fitWithin(800, 600, 2048)).toEqual({ width: 800, height: 600, resized: false });
    expect(fitWithin(2048, 100, 2048)).toEqual({ width: 2048, height: 100, resized: false });
  });
  it("thumbnails cap at 512 with the same rule", () => {
    expect(fitWithin(2048, 1536, 512)).toEqual({ width: 512, height: 384, resized: true });
    expect(fitWithin(300, 200, 512)).toEqual({ width: 300, height: 200, resized: false });
  });
  it("never emits a zero dimension on extreme aspect ratios", () => {
    const r = fitWithin(10000, 1, 512);
    expect(r.width).toBe(512);
    expect(r.height).toBeGreaterThanOrEqual(1);
  });
  it("survives garbage dimensions", () => {
    expect(fitWithin(0, 0, 2048)).toEqual({ width: 1, height: 1, resized: false });
    expect(fitWithin(NaN, 10, 2048).width).toBe(1);
  });
});

describe("shouldKeepOriginal — the keep-the-smaller-file rule", () => {
  it("keeps the original when it already fits AND the re-encode didn't shrink it", () => {
    expect(shouldKeepOriginal({ originalBytes: 100_000, reencodedBytes: 120_000, wasResized: false })).toBe(true);
    expect(shouldKeepOriginal({ originalBytes: 100_000, reencodedBytes: 100_000, wasResized: false })).toBe(true);
  });
  it("ships the re-encode when it's genuinely smaller", () => {
    expect(shouldKeepOriginal({ originalBytes: 4_000_000, reencodedBytes: 900_000, wasResized: false })).toBe(false);
  });
  it("a RESIZED image always ships resized — the dimension cap is the contract", () => {
    expect(shouldKeepOriginal({ originalBytes: 100_000, reencodedBytes: 150_000, wasResized: true })).toBe(false);
  });
});

describe("renameForMime — extension follows the re-encode", () => {
  it("renames to the encoded format", () => {
    expect(renameForMime("photo.jpg", "image/webp")).toBe("photo.webp");
    expect(renameForMime("IMG_0001.HEIC", "image/jpeg")).toBe("IMG_0001.jpg");
  });
  it("handles missing extensions and unknown mimes", () => {
    expect(renameForMime("photo", "image/webp")).toBe("photo.webp");
    expect(renameForMime("photo.jpg", "image/tiff")).toBe("photo.jpg");
    expect(renameForMime("", "image/webp")).toBe("photo.webp");
  });
});

describe("upload threading (source contracts)", () => {
  it("Messages' photo path runs the pipeline and falls back to the raw file on failure", () => {
    expect(MESSAGES).toMatch(/isDownscalableImage\(file\.type\)/);
    expect(MESSAGES).toMatch(/processImageForUpload\(file\)\.catch\(\(\) => null\)/);
    expect(MESSAGES).toMatch(/uploadThumbnail\(processed\.thumb\.blob/);
    expect(MESSAGES).toMatch(/thumbKey,?\s*\n\s*\}\);/);
  });
  it("uploadAttachment carries width/height/thumbKey as query params on the BINARY route", () => {
    expect(UPLOAD_HELPER).toMatch(/qs\.set\(\s*["']width["']/);
    expect(UPLOAD_HELPER).toMatch(/qs\.set\(\s*["']height["']/);
    expect(UPLOAD_HELPER).toMatch(/qs\.set\(\s*["']thumbKey["']/);
    expect(UPLOAD_HELPER).toMatch(/thumb:\s*["']1["']/); // uploadThumbnail mode
  });
  it("the server's thumb mode stores WITHOUT an attachment row and caps at 2 MB", () => {
    expect(V2UPLOAD).toMatch(/req\.query\.thumb === ["']1["']/);
    expect(V2UPLOAD).toMatch(/MAX_THUMB_BYTES = 2 \* 1024 \* 1024/);
    expect(V2UPLOAD).toMatch(/thumb:\s*true,\s*storageKey:/);
  });
  it("thumbKey must live in the CALLER'S OWN namespace (ownership check)", () => {
    expect(V2UPLOAD).toMatch(/startsWith\(`relay-chat\/\$\{identityId\}\/`\)/);
    expect(V2UPLOAD).toMatch(/Invalid thumbKey/);
  });
  it("thumbUrl is DERIVED server-side from the key — never taken from the client", () => {
    expect(V2UPLOAD).toMatch(/`\/manus-storage\/\$\{thumbKey\}`/);
    expect(V2UPLOAD).not.toMatch(/req\.query\.thumbUrl/);
  });
  it("the base64 (mobile/native) route is untouched — no thumb fields", () => {
    const base64Block = V2UPLOAD.slice(
      V2UPLOAD.indexOf("LEGACY base64 JSON path"),
      V2UPLOAD.indexOf("if (!ALLOWED_MIME"),
    );
    expect(base64Block).not.toMatch(/thumb/i);
  });
  it("attachments gained thumbKey/thumbUrl via the boot migrator, mirrored in drizzle", () => {
    expect(V2DB).toMatch(/table: "attachments", column: "thumbKey"/);
    expect(V2DB).toMatch(/table: "attachments", column: "thumbUrl"/);
    expect(SCHEMA).toMatch(/thumbKey: varchar\("thumbKey", \{ length: 256 \}\)/);
    expect(SCHEMA).toMatch(/thumbUrl: text\("thumbUrl"\)/);
  });
  it("bubbles render the THUMBNAIL with explicit dimensions and open the full url", () => {
    expect(MESSAGES).toMatch(/src=\{thumbUrl \|\| url\}/);
    expect(MESSAGES).toMatch(/aspectRatio: `\$\{width\} \/ \$\{height\}`/);
    // The tap-through target stays the FULL image.
    expect(MESSAGES).toMatch(/onOpen\?\.\(\{ url, type: "image", name: filename \}\)/);
    expect(MESSAGES).toMatch(/thumbUrl=\{m\.attachment\.thumbUrl \?\? null\}/);
  });
});
