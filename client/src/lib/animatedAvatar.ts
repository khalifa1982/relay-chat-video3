/**
 * Animated avatars (v2.99.18) — owner asked for "an animated icon also" alongside
 * the static emoji/character avatars and photo upload.
 *
 * An animated avatar is rendered to an ANIMATED GIF (an emoji gently bouncing +
 * pulsing on the same gradient background used by the static emoji avatars) and
 * uploaded through the SAME profile-photo path as a real photo. Because it's a
 * genuine image/gif, every surface that renders `avatarUrl` in an <img> animates
 * it natively — thread rows, contacts, history discs, in-call tiles, other
 * users' directory previews — and it syncs to other devices/users like any
 * photo. No schema change, no client-only animation that others couldn't see.
 *
 * The GIF is encoded here with a tiny, dependency-free GIF89a + LZW encoder
 * (the repo deliberately avoids heavy deps — see s3.ts / smtp.ts / fcm.ts). A
 * fixed 216-colour web-safe palette keeps the encoder simple and provably
 * correct; at avatar size the mild gradient banding is invisible.
 */

/** LSB-first bit writer for GIF's LZW code stream. */
class BitWriter {
  private bytes: number[] = [];
  private cur = 0;
  private nbits = 0;
  write(code: number, len: number): void {
    this.cur |= code << this.nbits;
    this.nbits += len;
    while (this.nbits >= 8) {
      this.bytes.push(this.cur & 0xff);
      this.cur >>= 8;
      this.nbits -= 8;
    }
  }
  finish(): number[] {
    if (this.nbits > 0) {
      this.bytes.push(this.cur & 0xff);
      this.cur = 0;
      this.nbits = 0;
    }
    return this.bytes;
  }
}

/**
 * GIF-flavoured LZW compression of an index stream (min code size = 8).
 * Codes 0..255 are literals, 256 = CLEAR, 257 = END, first free code = 258.
 * The dictionary is keyed by (prefixCode * 256 + symbol) — the standard fast
 * form. Code width grows from 9 up to 12 bits as the table fills, and a CLEAR
 * is emitted (table reset) when it would overflow 4095, exactly mirroring what
 * a GIF decoder does.
 */
function lzwCompress(indices: Uint8Array): number[] {
  const MIN = 8;
  const CLEAR = 1 << MIN; // 256
  const END = CLEAR + 1; // 257
  const bw = new BitWriter();
  let codeSize = MIN + 1; // 9
  let next = END + 1; // 258
  let dict = new Map<number, number>();
  bw.write(CLEAR, codeSize);
  if (indices.length === 0) {
    bw.write(END, codeSize);
    return bw.finish();
  }
  let prefix = indices[0]; // a code in 0..255
  for (let i = 1; i < indices.length; i++) {
    const sym = indices[i];
    const key = prefix * 256 + sym;
    const found = dict.get(key);
    if (found !== undefined) {
      prefix = found;
    } else {
      bw.write(prefix, codeSize); // emit the code for the current prefix
      dict.set(key, next);
      next++;
      if (next > 4095) {
        bw.write(CLEAR, codeSize);
        dict = new Map();
        next = END + 1;
        codeSize = MIN + 1;
      } else if (next === 1 << codeSize && codeSize < 12) {
        codeSize++;
      }
      prefix = sym;
    }
  }
  bw.write(prefix, codeSize);
  bw.write(END, codeSize);
  return bw.finish();
}

/** Split raw LZW bytes into GIF sub-blocks (≤255 bytes each, 00-terminated). */
function subBlocks(data: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < data.length; i += 255) {
    const chunk = data.slice(i, i + 255);
    out.push(chunk.length, ...chunk);
  }
  out.push(0);
  return out;
}

/** 216-colour web-safe palette (6×6×6), padded to 256 entries. */
const LEVELS = [0, 51, 102, 153, 204, 255];
function buildPalette(): number[] {
  const p: number[] = [];
  for (let r = 0; r < 6; r++)
    for (let g = 0; g < 6; g++)
      for (let b = 0; b < 6; b++) p.push(LEVELS[r], LEVELS[g], LEVELS[b]);
  while (p.length < 256 * 3) p.push(0);
  return p;
}
const PALETTE = buildPalette();

/** Map an 8-bit channel to the nearest web-safe level index (0..5). */
function lvl(v: number): number {
  return Math.min(5, Math.round(v / 51));
}
function nearestIndex(r: number, g: number, b: number): number {
  return 36 * lvl(r) + 6 * lvl(g) + lvl(b);
}

function u16(n: number): [number, number] {
  return [n & 0xff, (n >> 8) & 0xff];
}

/**
 * Assemble an animated GIF89a from RGBA frames.
 * @param frames  RGBA Uint8ClampedArray per frame (length = w*h*4)
 * @param delayCs per-frame delay in centiseconds (1/100 s)
 */
export function encodeGif(frames: Uint8ClampedArray[], w: number, h: number, delayCs: number): Blob {
  const bytes: number[] = [];
  const str = (s: string) => { for (const ch of s) bytes.push(ch.charCodeAt(0)); };
  // Header + Logical Screen Descriptor (global colour table, 256 entries).
  str("GIF89a");
  bytes.push(...u16(w), ...u16(h), 0xf7 /* GCT flag, 8-bit, 256 entries */, 0, 0);
  bytes.push(...PALETTE);
  // NETSCAPE2.0 loop-forever extension.
  bytes.push(0x21, 0xff, 0x0b);
  str("NETSCAPE2.0");
  bytes.push(0x03, 0x01, 0x00, 0x00, 0x00);
  for (const rgba of frames) {
    // Graphic Control Extension (disposal=1 "leave in place", no transparency).
    bytes.push(0x21, 0xf9, 0x04, 0x04, ...u16(delayCs), 0x00, 0x00);
    // Image Descriptor (no local colour table).
    bytes.push(0x2c, ...u16(0), ...u16(0), ...u16(w), ...u16(h), 0x00);
    // Quantise the frame to palette indices.
    const idx = new Uint8Array(w * h);
    for (let i = 0, p = 0; i < idx.length; i++, p += 4) {
      idx[i] = nearestIndex(rgba[p], rgba[p + 1], rgba[p + 2]);
    }
    bytes.push(8); // LZW minimum code size
    bytes.push(...subBlocks(lzwCompress(idx)));
  }
  bytes.push(0x3b); // trailer
  return new Blob([new Uint8Array(bytes)], { type: "image/gif" });
}

/**
 * Render `emoji` on the `bg` gradient as an animated GIF: a gentle bounce + pulse
 * loop (10 frames, ~1s, loops forever). Returns an `image/gif` Blob that uploads
 * through the normal avatar path.
 */
export function renderAnimatedEmojiAvatar(
  emoji: string,
  bg: { from: string; to: string },
  size = 160,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) {
        reject(new Error("Canvas 2D unavailable"));
        return;
      }
      const grad = ctx.createLinearGradient(0, 0, size, size);
      grad.addColorStop(0, bg.from);
      grad.addColorStop(1, bg.to);
      const FRAMES = 10;
      const frames: Uint8ClampedArray[] = [];
      for (let f = 0; f < FRAMES; f++) {
        const t = f / FRAMES; // 0..1
        const phase = Math.sin(t * Math.PI * 2); // -1..1, seamless loop
        ctx.clearRect(0, 0, size, size);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, size, size);
        ctx.save();
        // Bounce (vertical) + subtle pulse (scale) + gentle tilt.
        const dy = -phase * size * 0.06;
        const scale = 1 + phase * 0.06;
        ctx.translate(size / 2, size / 2 + size * 0.04 + dy);
        ctx.scale(scale, scale);
        ctx.rotate(phase * 0.06);
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = `${Math.round(size * 0.58)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
        ctx.fillText(emoji, 0, 0);
        ctx.restore();
        frames.push(ctx.getImageData(0, 0, size, size).data);
      }
      // 10cs/frame → ~1s loop.
      resolve(encodeGif(frames, size, size, 10));
    } catch (e) {
      reject(e instanceof Error ? e : new Error("Failed to render animated avatar"));
    }
  });
}
