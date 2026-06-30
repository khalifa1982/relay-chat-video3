/**
 * Pure, dependency-free SHA-256 (FIPS 180-4) + base64 decoder.
 *
 * Kept free of any native/Expo imports so it can be unit-tested under vitest
 * (the SSR transform can't parse Expo native module sources). Used by
 * lib/apk-integrity.ts to verify a downloaded APK against the manifest digest.
 */

/** Streaming SHA-256 (FIPS 180-4) over raw bytes. Exported for unit testing. */
export class Sha256 {
  private h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
    0x1f83d9ab, 0x5be0cd19,
  ]);
  private readonly k = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
    0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
    0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
    0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
    0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);
  private buffer = new Uint8Array(64);
  private bufferLen = 0;
  private lengthBytes = 0;
  private readonly w = new Uint32Array(64);

  update(bytes: Uint8Array): void {
    this.lengthBytes += bytes.length;
    let offset = 0;
    // Drain any leftover bytes from the previous update into a full block.
    if (this.bufferLen > 0) {
      while (offset < bytes.length && this.bufferLen < 64) {
        this.buffer[this.bufferLen++] = bytes[offset++];
      }
      if (this.bufferLen === 64) {
        this.processBlock(this.buffer, 0);
        this.bufferLen = 0;
      }
    }
    // Process as many full 64-byte blocks straight from the input as possible.
    while (offset + 64 <= bytes.length) {
      this.processBlock(bytes, offset);
      offset += 64;
    }
    // Stash the remainder.
    while (offset < bytes.length) {
      this.buffer[this.bufferLen++] = bytes[offset++];
    }
  }

  digestHex(): string {
    const bitLen = this.lengthBytes * 8;
    // Append 0x80 then pad with zeros to a 56-mod-64 boundary, then 64-bit length.
    const pad: number[] = [0x80];
    let total = this.bufferLen + 1;
    while (total % 64 !== 56) {
      pad.push(0);
      total++;
    }
    // 64-bit big-endian length (JS numbers are safe up to 2^53, plenty for APKs).
    const hi = Math.floor(bitLen / 0x100000000);
    const lo = bitLen >>> 0;
    pad.push(
      (hi >>> 24) & 0xff,
      (hi >>> 16) & 0xff,
      (hi >>> 8) & 0xff,
      hi & 0xff,
      (lo >>> 24) & 0xff,
      (lo >>> 16) & 0xff,
      (lo >>> 8) & 0xff,
      lo & 0xff,
    );
    this.update(Uint8Array.from(pad));
    let out = "";
    for (let i = 0; i < 8; i++) {
      out += this.h[i].toString(16).padStart(8, "0");
    }
    return out;
  }

  private processBlock(block: Uint8Array, start: number): void {
    const w = this.w;
    for (let i = 0; i < 16; i++) {
      const j = start + i * 4;
      w[i] =
        ((block[j] << 24) |
          (block[j + 1] << 16) |
          (block[j + 2] << 8) |
          block[j + 3]) >>>
        0;
    }
    for (let i = 16; i < 64; i++) {
      const s0 =
        (rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3)) >>> 0;
      const s1 =
        (rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10)) >>> 0;
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = this.h;
    for (let i = 0; i < 64; i++) {
      const S1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
      const ch = ((e & f) ^ (~e & g)) >>> 0;
      const t1 = (h + S1 + ch + this.k[i] + w[i]) >>> 0;
      const S0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const t2 = (S0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    this.h[0] = (this.h[0] + a) >>> 0;
    this.h[1] = (this.h[1] + b) >>> 0;
    this.h[2] = (this.h[2] + c) >>> 0;
    this.h[3] = (this.h[3] + d) >>> 0;
    this.h[4] = (this.h[4] + e) >>> 0;
    this.h[5] = (this.h[5] + f) >>> 0;
    this.h[6] = (this.h[6] + g) >>> 0;
    this.h[7] = (this.h[7] + h) >>> 0;
  }
}

function rotr(x: number, n: number): number {
  return ((x >>> n) | (x << (32 - n))) >>> 0;
}

const B64 =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B64_LOOKUP: Record<string, number> = {};
for (let i = 0; i < B64.length; i++) {
  B64_LOOKUP[B64[i]] = i;
}

/** Decode a standard base64 string to bytes (no atob dependency on native). */
export function base64ToBytes(b64: string): Uint8Array {
  // Strip everything that isn't a base64 alphabet char (drops '=' padding and
  // any whitespace/newlines). The output length is then derived purely from the
  // number of significant chars, which correctly yields 0 for empty input.
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, "");
  // Each group of 4 chars -> 3 bytes; a trailing group of 2 -> 1 byte, 3 -> 2.
  const rem = clean.length % 4;
  const outLen =
    Math.floor(clean.length / 4) * 3 + (rem === 2 ? 1 : rem === 3 ? 2 : 0);
  const out = new Uint8Array(outLen);
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n0 = B64_LOOKUP[clean[i]] ?? 0;
    const n1 = B64_LOOKUP[clean[i + 1]] ?? 0;
    const n2 = B64_LOOKUP[clean[i + 2]] ?? 0;
    const n3 = B64_LOOKUP[clean[i + 3]] ?? 0;
    if (o < outLen) out[o++] = (n0 << 2) | (n1 >> 4);
    if (o < outLen) out[o++] = ((n1 & 0x0f) << 4) | (n2 >> 2);
    if (o < outLen) out[o++] = ((n2 & 0x03) << 6) | n3;
  }
  return out;
}
