import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { Sha256, base64ToBytes } from "../lib/sha256";
import { normalizeSha256, parseManifest } from "../lib/apk-update-config";

/** parseManifest now REQUIRES a digest (the owner confirmed the live
 *  manifest carries one), so fixtures must supply a real 64-hex value. */
const VALID_SHA = "e482dd5fdbe5eed4c5d3898b1282842013a3bd4af29f672c2d850ceef4e4b046";

// Re-implement the streaming hasher test against Node's crypto as the oracle.
// We can't import the private Sha256 class, so we exercise it indirectly by
// reconstructing the same digest from base64-decoded chunks the way the file
// hasher does, and assert base64ToBytes + the digest match Node.

describe("base64ToBytes", () => {
  it("decodes a known string exactly", () => {
    // "Hello, world!" base64 = SGVsbG8sIHdvcmxkIQ==
    const bytes = base64ToBytes("SGVsbG8sIHdvcmxkIQ==");
    expect(Buffer.from(bytes).toString("utf8")).toBe("Hello, world!");
  });

  it("round-trips arbitrary binary data of varying lengths", () => {
    for (const len of [0, 1, 2, 3, 16, 63, 64, 65, 1000]) {
      const src = Buffer.alloc(len);
      for (let i = 0; i < len; i++) src[i] = (i * 37 + 11) & 0xff;
      const b64 = src.toString("base64");
      const out = Buffer.from(base64ToBytes(b64));
      expect(out.equals(src)).toBe(true);
    }
  });
});

describe("normalizeSha256", () => {
  it("accepts a valid 64-char hex digest and lowercases it", () => {
    const hex = "A".repeat(64);
    expect(normalizeSha256(hex)).toBe("a".repeat(64));
  });

  it("strips a sha256: prefix and whitespace", () => {
    const hex = "b".repeat(64);
    expect(normalizeSha256(`  sha256:${hex}  `)).toBe(hex);
    expect(normalizeSha256(`SHA-256:${hex}`)).toBe(hex);
  });

  it("rejects malformed or wrong-length values", () => {
    expect(normalizeSha256("xyz")).toBeNull();
    expect(normalizeSha256("g".repeat(64))).toBeNull(); // non-hex
    expect(normalizeSha256("a".repeat(63))).toBeNull();
    const notAString: unknown = 123;
    expect(normalizeSha256(notAString)).toBeNull();
    expect(normalizeSha256(undefined)).toBeNull();
  });
});

describe("parseManifest sha256 handling", () => {
  it("includes a valid sha256 when present", () => {
    const sha = "c".repeat(64);
    const m = parseManifest({ buildNumber: 9, sha256: sha });
    expect(m?.sha256).toBe(sha);
  });

  it("REJECTS a manifest whose sha256 is invalid", () => {
    // Was: "omits an invalid sha256 but keeps the manifest valid". A digest is now
    // required, so a malformed one is a rejected manifest — "no update offered"
    // rather than "update installed unverified".
    expect(parseManifest({ buildNumber: 9, sha256: "not-a-hash" })).toBeNull();
    expect(parseManifest({ buildNumber: 9, sha256: "" })).toBeNull();
    expect(parseManifest({ buildNumber: 9, sha256: "abc" })).toBeNull();
  });

  it("REJECTS a manifest with no sha256 at all", () => {
    // SELF_HOSTED_UPDATE.md used to promise "no sha256 simply skips". That
    // guarantee is withdrawn: omitting one key disabled verification entirely, and
    // version.json is a far smaller asset to tamper with than the APK. The live
    // manifest carries a digest and publish-release.sh emits one, so nothing real
    // regresses.
    //
    // Note the old test asserted `m?.sha256` was undefined, which passes for a
    // NULL manifest too — it would not have caught this change either way.
    expect(parseManifest({ buildNumber: 9, versionName: "1.0.9" })).toBeNull();
  });
});

describe("Sha256 streaming hasher matches Node crypto", () => {
  it("matches for empty input", () => {
    expect(new Sha256().digestHex()).toBe(
      createHash("sha256").update(Buffer.alloc(0)).digest("hex"),
    );
  });

  it("matches for inputs spanning block boundaries", () => {
    for (const len of [1, 55, 56, 63, 64, 65, 119, 120, 1000, 100_003]) {
      const data = Buffer.alloc(len);
      for (let i = 0; i < len; i++) data[i] = (i * 131 + 7) & 0xff;
      const expected = createHash("sha256").update(data).digest("hex");
      const h = new Sha256();
      h.update(new Uint8Array(data));
      expect(h.digestHex()).toBe(expected);
    }
  });

  it("matches when fed in arbitrary chunk sizes (streaming)", () => {
    const total = 250_000;
    const data = Buffer.alloc(total);
    for (let i = 0; i < total; i++) data[i] = (i * 53 + 29) & 0xff;
    const expected = createHash("sha256").update(data).digest("hex");
    const h = new Sha256();
    let off = 0;
    for (const size of [1, 7, 64, 100, 4096, 33_333]) {
      while (off < total) {
        const end = Math.min(off + size, total);
        h.update(new Uint8Array(data.subarray(off, end)));
        off = end;
        if (size < 4096) break; // interleave small + large chunks
      }
    }
    if (off < total) h.update(new Uint8Array(data.subarray(off)));
    expect(h.digestHex()).toBe(expected);
  });
});

// Sanity check that Node's SHA-256 of a known vector matches the canonical
// digest, anchoring the expected-value used by the device-side verifier.
describe("sha256 known vector", () => {
  it("hashes the empty string to the documented digest", () => {
    expect(createHash("sha256").update("").digest("hex")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("hashes 'abc' to the documented digest", () => {
    expect(createHash("sha256").update("abc").digest("hex")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});
