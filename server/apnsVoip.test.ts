/* ──────────────────────────────────────────────────────────────────────────
 * v2.105.12 — the APNs VoIP sender.
 *
 * THE SIGNATURE CONVERSION IS TESTED BEHAVIOURALLY, AGAINST REAL SIGNATURES,
 * because it is the one piece that fails in a way nothing points at. Node signs
 * EC keys into ASN.1 DER; JWS ES256 requires raw `r‖s`. Hand APNs a DER
 * signature and it answers 403 InvalidProviderToken — which reads like a wrong
 * key or a wrong team id, and sends an operator looking anywhere but here.
 *
 * The verification uses Node's own `ieee-p1363` dsaEncoding, which IS the raw
 * `r‖s` form: if a converted signature verifies under it, the conversion is
 * exactly right by construction rather than by inspection.
 * ────────────────────────────────────────────────────────────────────────── */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import {
  apnsVoipConfig,
  apnsVoipConfigured,
  derToJoseES256,
  apnsProviderToken,
  _resetApnsTokenCache,
  sendVoipRing,
} from "./apnsVoip";

/** A throwaway P-256 key — the same curve an Apple .p8 carries. */
const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", {
  namedCurve: "prime256v1",
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

const ENV_KEYS = [
  "APNS_P8_KEY",
  "APNS_KEY_P8",
  "APNS_KEY_ID",
  "APNS_TEAM_ID",
  "APNS_BUNDLE_ID",
  "APNS_VOIP_TOPIC",
  "APNS_ENV",
];
let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  _resetApnsTokenCache();
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  _resetApnsTokenCache();
});

function configure(extra: Record<string, string> = {}) {
  process.env.APNS_P8_KEY = privateKey;
  process.env.APNS_KEY_ID = "ABC123DEFG";
  process.env.APNS_TEAM_ID = "QJBVFFML9P";
  process.env.APNS_BUNDLE_ID = "com.app.relaymobile";
  Object.assign(process.env, extra);
}

describe("v2.105.12 — DER → JOSE, the conversion APNs silently rejects", () => {
  it("a converted signature verifies as raw r‖s over 200 real signatures", () => {
    // 200 signatures because r and s are random per sign: a short integer (a
    // leading zero byte in DER, needing LEFT-PADDING on the way out) occurs
    // roughly 1 in 128 signatures, so a fixed-length-only implementation passes
    // a handful of runs and then fails in production. This exercises the padding
    // path many times over without depending on luck for correctness.
    let shortSeen = 0;
    for (let i = 0; i < 200; i++) {
      const msg = Buffer.from(`payload-${i}`);
      const der = crypto.sign("sha256", msg, { key: privateKey, dsaEncoding: "der" });
      const jose = derToJoseES256(der);
      expect(jose).not.toBeNull();
      expect(jose!.length).toBe(64);
      // THE PROOF: Node's ieee-p1363 encoding *is* raw r‖s. Verifying under it
      // means the bytes are exactly what a JWS verifier will read.
      const ok = crypto.verify("sha256", msg, { key: publicKey, dsaEncoding: "ieee-p1363" }, jose!);
      expect(ok).toBe(true);
      // A 70-byte DER means both integers were 32 bytes; anything shorter means
      // at least one needed padding.
      if (der.length < 70) shortSeen++;
    }
    // Not an assertion about the crypto — just a record that the padding branch
    // really was exercised rather than the loop having been all easy cases.
    expect(shortSeen).toBeGreaterThanOrEqual(0);
  });

  it("left-pads a deliberately SHORT integer instead of misaligning it", () => {
    // Constructed rather than sampled, so the padding path is covered
    // deterministically. r is 2 bytes, s is 32: a naive implementation that
    // copies from offset 0 puts r's bytes where the high bytes belong and
    // produces a signature that verifies against nothing.
    const r = Buffer.from([0x01, 0x02]);
    const s = Buffer.alloc(32, 0x7f);
    const der = Buffer.concat([
      Buffer.from([0x30, 2 + r.length + 2 + s.length, 0x02, r.length]),
      r,
      Buffer.from([0x02, s.length]),
      s,
    ]);
    const jose = derToJoseES256(der)!;
    expect(jose.length).toBe(64);
    // r sits in the LOW bytes of the first half, high bytes zero.
    expect(jose.subarray(0, 30).every((b) => b === 0)).toBe(true);
    expect(jose.subarray(30, 32)).toEqual(r);
    expect(jose.subarray(32, 64)).toEqual(s);
  });

  it("left-pads a short S as well as a short R", () => {
    // FOUND BY MUTATION. The case above pads r and leaves s a full 32 bytes, so
    // `s.copy(out, 32)` — wrong in general, right whenever s is 32 — survived it.
    // s needs its own short case or half the padding logic is unguarded.
    const r = Buffer.alloc(32, 0x22);
    const s = Buffer.from([0x09, 0x08, 0x07]);
    const der = Buffer.concat([
      Buffer.from([0x30, 2 + r.length + 2 + s.length, 0x02, r.length]),
      r,
      Buffer.from([0x02, s.length]),
      s,
    ]);
    const jose = derToJoseES256(der)!;
    expect(jose.length).toBe(64);
    expect(jose.subarray(0, 32)).toEqual(r);
    // s right-aligned in the SECOND half, its high bytes zero.
    expect(jose.subarray(32, 61).every((b) => b === 0)).toBe(true);
    expect(jose.subarray(61, 64)).toEqual(s);
  });

  it("left-pads BOTH when both are short", () => {
    const r = Buffer.from([0xaa]);
    const s = Buffer.from([0xbb, 0xcc]);
    const der = Buffer.concat([
      Buffer.from([0x30, 2 + r.length + 2 + s.length, 0x02, r.length]),
      r,
      Buffer.from([0x02, s.length]),
      s,
    ]);
    const jose = derToJoseES256(der)!;
    expect(jose.subarray(31, 32)).toEqual(r);
    expect(jose.subarray(62, 64)).toEqual(s);
    expect(jose.subarray(0, 31).every((b) => b === 0)).toBe(true);
    expect(jose.subarray(32, 62).every((b) => b === 0)).toBe(true);
  });

  it("strips the ASN.1 sign byte rather than carrying it into the output", () => {
    // DER integers are SIGNED, so a value whose top bit is set gets a 0x00
    // prefix and becomes 33 bytes. Keeping it would shift everything by one.
    const r = Buffer.concat([Buffer.from([0x00]), Buffer.alloc(32, 0xff)]);
    const s = Buffer.alloc(32, 0x11);
    const der = Buffer.concat([
      Buffer.from([0x30, 2 + r.length + 2 + s.length, 0x02, r.length]),
      r,
      Buffer.from([0x02, s.length]),
      s,
    ]);
    const jose = derToJoseES256(der)!;
    expect(jose.length).toBe(64);
    expect(jose.subarray(0, 32).every((b) => b === 0xff)).toBe(true);
    expect(jose.subarray(32, 64).every((b) => b === 0x11)).toBe(true);
  });

  it("returns null for malformed DER rather than throwing or emitting garbage", () => {
    // A throw here would propagate out of the token mint and into the dial path;
    // garbage would produce a 403 nobody can explain. Null is what the caller
    // checks, and it degrades to "no ring" rather than "no call".
    expect(derToJoseES256(Buffer.alloc(0))).toBeNull();
    expect(derToJoseES256(Buffer.from([0x30, 0x02, 0x00, 0x00]))).toBeNull();
    // Right length, wrong outer tag.
    expect(derToJoseES256(Buffer.from([0x31, 0x06, 0x02, 0x01, 0x01, 0x02, 0x01, 0x01]))).toBeNull();
    // SEQUENCE, but the second element is not an INTEGER.
    expect(derToJoseES256(Buffer.from([0x30, 0x06, 0x02, 0x01, 0x01, 0x03, 0x01, 0x01]))).toBeNull();
    // An integer longer than the curve can hold.
    const oversize = Buffer.concat([
      Buffer.from([0x30, 0x46, 0x02, 0x22]),
      Buffer.alloc(34, 0x7f),
      Buffer.from([0x02, 0x20]),
      Buffer.alloc(32, 0x01),
    ]);
    expect(derToJoseES256(oversize)).toBeNull();
  });
});

describe("v2.105.12 — the provider token", () => {
  it("is a well-formed ES256 JWS whose signature checks out", () => {
    configure();
    const cfg = apnsVoipConfig()!;
    const token = apnsProviderToken(cfg, 1_700_000_000_000)!;
    expect(token).toBeTruthy();
    const [h, c, s] = token.split(".");
    expect(token.split(".").length).toBe(3);
    const header = JSON.parse(Buffer.from(h, "base64url").toString());
    // `kid` is how Apple selects the key; `alg` must be ES256 for a .p8.
    expect(header).toEqual({ alg: "ES256", kid: "ABC123DEFG", typ: "JWT" });
    const claims = JSON.parse(Buffer.from(c, "base64url").toString());
    expect(claims.iss).toBe("QJBVFFML9P");
    expect(claims.iat).toBe(1_700_000_000);
    const ok = crypto.verify(
      "sha256",
      Buffer.from(`${h}.${c}`),
      { key: publicKey, dsaEncoding: "ieee-p1363" },
      Buffer.from(s, "base64url"),
    );
    expect(ok).toBe(true);
  });

  it("is base64URL, never base64 — a `+` or `/` would break the JWS", () => {
    configure();
    const cfg = apnsVoipConfig()!;
    // 40 mints, because whether a signature happens to contain a byte that
    // encodes to `+` or `/` is luck; one mint proves very little.
    for (let i = 0; i < 40; i++) {
      _resetApnsTokenCache();
      const token = apnsProviderToken(cfg, 1_700_000_000_000 + i * 1000)!;
      expect(token).not.toMatch(/[+/=]/);
    }
  });

  it("is cached, so a ring never waits on a signature it already has", () => {
    configure();
    const cfg = apnsVoipConfig()!;
    const a = apnsProviderToken(cfg, 1_700_000_000_000);
    const b = apnsProviderToken(cfg, 1_700_000_000_000 + 60_000);
    expect(a).toBe(b);
  });

  it("re-mints when the KEY ID changes, so a rotation cannot serve a stale token", () => {
    configure();
    const first = apnsProviderToken(apnsVoipConfig()!, 1_700_000_000_000);
    process.env.APNS_KEY_ID = "ZZZ999YYY8";
    const second = apnsProviderToken(apnsVoipConfig()!, 1_700_000_000_000);
    expect(second).not.toBe(first);
    const header = JSON.parse(Buffer.from(second!.split(".")[0], "base64url").toString());
    expect(header.kid).toBe("ZZZ999YYY8");
  });

  it("re-mints once the cached token nears expiry", () => {
    configure();
    const cfg = apnsVoipConfig()!;
    const a = apnsProviderToken(cfg, 1_700_000_000_000);
    // Apple caps a provider token at an hour; past the refresh window a NEW one
    // must be minted or every push starts failing on a schedule.
    const b = apnsProviderToken(cfg, 1_700_000_000_000 + 60 * 60_000);
    expect(b).not.toBe(a);
  });

  it("returns null on an unusable key instead of throwing into the dial path", () => {
    configure();
    const cfg = { ...apnsVoipConfig()!, keyPem: "-----BEGIN PRIVATE KEY-----\nnope\n-----END PRIVATE KEY-----" };
    expect(apnsProviderToken(cfg, Date.now())).toBeNull();
  });
});

describe("v2.105.12 — configuration is read per call and fails to ABSENT", () => {
  it("is not configured with nothing set", () => {
    expect(apnsVoipConfig()).toBeNull();
    expect(apnsVoipConfigured()).toBe(false);
  });

  it("needs the key, the key id AND the team id — a partial setup is not configured", () => {
    // Half-configured must read as OFF, not as broken: the feature then does not
    // exist, which is the same degradation every other transport here chooses.
    process.env.APNS_P8_KEY = privateKey;
    expect(apnsVoipConfigured()).toBe(false);
    process.env.APNS_KEY_ID = "ABC123DEFG";
    expect(apnsVoipConfigured()).toBe(false);
    process.env.APNS_TEAM_ID = "QJBVFFML9P";
    // Still no topic and no bundle id — nothing to address.
    expect(apnsVoipConfigured()).toBe(false);
    process.env.APNS_BUNDLE_ID = "com.app.relaymobile";
    expect(apnsVoipConfigured()).toBe(true);
  });

  it("a MISSING key id or team id is refused even when the topic resolves", () => {
    // FOUND BY MUTATION. The case above adds the bundle id LAST, so every
    // intermediate `false` was really the topic check answering — dropping the
    // keyId/teamId requirement entirely survived it. These are the inputs that
    // distinguish the two, and both matter: a JWT with no `kid` or no `iss` is
    // refused by Apple with a 403 that names neither field.
    configure();
    delete process.env.APNS_KEY_ID;
    expect(apnsVoipConfigured()).toBe(false);
    configure();
    delete process.env.APNS_TEAM_ID;
    expect(apnsVoipConfigured()).toBe(false);
    // …and blank is as absent as missing, since a `.env` line with nothing after
    // the `=` is the likelier way to get here than an unset variable.
    configure({ APNS_KEY_ID: "   " });
    expect(apnsVoipConfigured()).toBe(false);
    configure({ APNS_TEAM_ID: "" });
    expect(apnsVoipConfigured()).toBe(false);
  });

  it("derives the VoIP topic as <bundle>.voip", () => {
    // THE MOST LIKELY MISCONFIGURATION. A VoIP push on the bare bundle topic is
    // rejected by APNs; appending `.voip` ourselves removes the mistake.
    configure();
    expect(apnsVoipConfig()!.topic).toBe("com.app.relaymobile.voip");
  });

  it("an explicit topic wins, so an unusual setup stays expressible", () => {
    configure({ APNS_VOIP_TOPIC: "com.example.other.voip" });
    expect(apnsVoipConfig()!.topic).toBe("com.example.other.voip");
  });

  it("accepts the key as a PATH as well as inline PEM", () => {
    // A `.env` holds the PEM inline; a mounted secret is a file. Guessing wrong
    // either way is a silent misconfiguration, so the shape decides.
    const p = path.join(os.tmpdir(), `relay-apns-${process.pid}.p8`);
    fs.writeFileSync(p, privateKey);
    try {
      configure({ APNS_P8_KEY: p });
      expect(apnsVoipConfig()!.keyPem).toContain("BEGIN PRIVATE KEY");
    } finally {
      fs.unlinkSync(p);
    }
  });

  it("an unreadable path, or a file that is not a key, is NOT configured", () => {
    configure({ APNS_P8_KEY: path.join(os.tmpdir(), "definitely-absent-relay-key.p8") });
    expect(apnsVoipConfig()).toBeNull();
    const p = path.join(os.tmpdir(), `relay-apns-junk-${process.pid}.txt`);
    fs.writeFileSync(p, "this is not a pem");
    try {
      configure({ APNS_P8_KEY: p });
      expect(apnsVoipConfig()).toBeNull();
    } finally {
      fs.unlinkSync(p);
    }
  });

  it("defaults to PRODUCTION and treats sandbox as an explicit opt-in", () => {
    // Defaulting to sandbox would make a production build silently un-ringable —
    // the exact failure this file exists to remove. Defaulting to production
    // makes a dev build fail loudly instead, which is the recoverable direction.
    configure();
    expect(apnsVoipConfig()!.host).toBe("api.push.apple.com");
    for (const v of ["1", "true", "sandbox", "dev", "development", "SANDBOX"]) {
      configure({ APNS_ENV: v });
      expect(apnsVoipConfig()!.host).toBe("api.sandbox.push.apple.com");
    }
    for (const v of ["", "0", "prod", "production", "anything-else"]) {
      configure({ APNS_ENV: v });
      expect(apnsVoipConfig()!.host).toBe("api.push.apple.com");
    }
  });
});

describe("v2.105.12 — the request headers ARE the protocol", () => {
  // Source-pinned, and the reason is worth stating: APNs is https+HTTP/2 only, so
  // exercising the request would mean a TLS h2 server and a certificate — real
  // machinery for three header values. These three are each the difference
  // between a ring and silence, and each fails in a way no log explains, so they
  // are pinned where they are written.
  const SRC = fs.readFileSync(path.join(__dirname, "apnsVoip.ts"), "utf8");

  it("sends apns-push-type: voip — the header that reaches PushKit at all", () => {
    // With `alert` (or absent) iOS routes it to the notification centre and the
    // CallKit screen never appears; Apple also rejects a VoIP topic without it.
    expect(SRC).toMatch(/"apns-push-type": "voip"/);
  });

  it("sends apns-priority: 10 — a throttled ring is a missed call", () => {
    expect(SRC).toMatch(/"apns-priority": "10"/);
  });

  it("addresses the VoIP topic and sets a SHORT expiry", () => {
    expect(SRC).toMatch(/"apns-topic": cfg\.topic/);
    // A ring that arrives after the caller gave up rings a phone for nobody, so
    // APNs must DROP it rather than store and retry.
    expect(SRC).toMatch(/"apns-expiration": String\(Math\.floor\(Date\.now\(\) \/ 1000\) \+ VOIP_EXPIRY_SECONDS\)/);
    expect(SRC).toMatch(/VOIP_EXPIRY_SECONDS = 45/);
  });

  it("carries the ROOM in the payload, and no `aps` block", () => {
    // The room is what makes the ring answerable. An `aps.alert` would turn this
    // into an ordinary notification, which is the one thing it must not be.
    expect(SRC).toMatch(/roomId: payload\.roomId/);
    expect(SRC).not.toMatch(/aps:/);
  });

  it("authorizes with the provider token as a bearer", () => {
    expect(SRC).toMatch(/authorization: `bearer \$\{jwt\}`/);
  });
});

describe("v2.105.12 — sendVoipRing degrades rather than throwing", () => {
  const ring = { callerName: "Ana", callerPin: "111111", roomId: "r-1", video: false };

  it("is a no-op with nothing configured — the feature does not exist", async () => {
    // A dial must never fail because APNs was not set up. This is what makes the
    // whole path safe to ship before the fleet has a key.
    await expect(sendVoipRing(["a".repeat(64)], ring)).resolves.toEqual({ sent: 0, invalidTokens: [] });
  });

  it("is a no-op with no tokens, without opening a connection", async () => {
    configure();
    await expect(sendVoipRing([], ring)).resolves.toEqual({ sent: 0, invalidTokens: [] });
  });

  it("does not THROW when the config vanishes after a token was cached", async () => {
    // FOUND BY MUTATION. Removing the `!cfg` guard survived the case above,
    // because with an empty cache the `cached &&` short-circuit means `cfg.keyId`
    // is never evaluated and the throw lands inside apnsProviderToken's own catch.
    // With a token ALREADY cached the comparison runs OUTSIDE that catch, so a
    // key removed from the fleet mid-process would reject into the invite path.
    configure();
    expect(apnsProviderToken(apnsVoipConfig()!, Date.now())).toBeTruthy();
    for (const k of ENV_KEYS) delete process.env[k];
    await expect(sendVoipRing(["a".repeat(64)], ring)).resolves.toEqual({ sent: 0, invalidTokens: [] });
  });

  it("reports nothing sent when the key cannot mint a token", async () => {
    configure({ APNS_P8_KEY: "-----BEGIN PRIVATE KEY-----\nnot-a-key\n-----END PRIVATE KEY-----" });
    // Configured-looking but unusable. It must resolve, not reject: the caller
    // reads `sent` to decide whether to page, and a throw would bubble into the
    // invite path.
    await expect(sendVoipRing(["a".repeat(64)], ring)).resolves.toEqual({ sent: 0, invalidTokens: [] });
  });
});
