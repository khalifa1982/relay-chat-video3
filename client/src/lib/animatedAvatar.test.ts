import { describe, it, expect } from "vitest";
import { encodeGif } from "./animatedAvatar";

/**
 * v2.99.18 — animated avatars (owner asked for "an animated icon also").
 * The avatar is a dependency-free animated GIF. These tests exercise the pure
 * GIF89a + LZW encoder in Node with synthetic frames; the full render path
 * (canvas → emoji → GIF) is additionally headless-verified in Chromium (the
 * output decodes as a valid 160×160 animated GIF with a NETSCAPE loop block).
 */
async function bytesOf(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

/** Build a solid-colour w×h RGBA frame. */
function frame(w: number, h: number, r: number, g: number, b: number): Uint8ClampedArray {
  const a = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < a.length; i += 4) {
    a[i] = r; a[i + 1] = g; a[i + 2] = b; a[i + 3] = 255;
  }
  return a;
}

describe("animatedAvatar — GIF89a encoder", () => {
  it("emits a valid GIF89a with a global colour table and the trailer", async () => {
    const b = await bytesOf(encodeGif([frame(4, 4, 255, 0, 0)], 4, 4, 10));
    const magic = String.fromCharCode(...b.slice(0, 6));
    expect(magic).toBe("GIF89a");
    expect(b[b.length - 1]).toBe(0x3b); // trailer
    // logical screen: 4×4 little-endian
    expect(b[6]).toBe(4); expect(b[7]).toBe(0);
    expect(b[8]).toBe(4); expect(b[9]).toBe(0);
  });

  it("loops forever (NETSCAPE2.0 application extension present)", async () => {
    const b = await bytesOf(encodeGif([frame(4, 4, 0, 255, 0)], 4, 4, 10));
    const s = String.fromCharCode(...b);
    expect(s.includes("NETSCAPE2.0")).toBe(true);
  });

  it("encodes one Graphic Control Extension per frame (so it's actually animated)", async () => {
    const frames = [
      frame(4, 4, 255, 0, 0),
      frame(4, 4, 0, 255, 0),
      frame(4, 4, 0, 0, 255),
    ];
    const b = await bytesOf(encodeGif(frames, 4, 4, 8));
    let gce = 0;
    for (let i = 0; i + 2 < b.length; i++) {
      if (b[i] === 0x21 && b[i + 1] === 0xf9 && b[i + 2] === 0x04) gce++;
    }
    expect(gce).toBe(3);
    // the per-frame delay we passed (8cs) is written little-endian after the
    // GCE packed byte — spot-check the first frame's delay.
    const idx = b.findIndex((_, i) => b[i] === 0x21 && b[i + 1] === 0xf9 && b[i + 2] === 0x04);
    expect(b[idx + 4]).toBe(8); // delay low byte
    expect(b[idx + 5]).toBe(0); // delay high byte
  });

  it("produces an image/gif blob", async () => {
    const blob = encodeGif([frame(2, 2, 10, 20, 30)], 2, 2, 10);
    expect(blob.type).toBe("image/gif");
  });
});
