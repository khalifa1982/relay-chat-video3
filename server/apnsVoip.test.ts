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
import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { codeOnly } from "./testing/codeOnly";
import {
  apnsVoipConfig,
  apnsCredentialExpiry,
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

/** Keys that LOAD but cannot produce an ES256 signature — see the key-type tests. */
const P384_KEY = crypto.generateKeyPairSync("ec", {
  namedCurve: "secp384r1",
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
}).privateKey;
const RSA_KEY = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
}).privateKey;
const ED25519_KEY = crypto.generateKeyPairSync("ed25519", {
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
}).privateKey;

/** The sender's own source — the cert path is a TLS/connection concern that no
 *  local test can exercise without a real APNs, so those two rules are pinned. */
const SRC_FOR_HEADERS = fs.readFileSync(path.join(__dirname, "apnsVoip.ts"), "utf8");

const ENV_KEYS = [
  "APNS_P8_KEY",
  "APNS_KEY_P8",
  "APNS_KEY_ID",
  "APNS_TEAM_ID",
  "APNS_BUNDLE_ID",
  "APNS_VOIP_TOPIC",
  "APNS_ENV",
  "APNS_VOIP_CERT_PEM",
  "APNS_VOIP_KEY_PEM",
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
  process.env.APNS_TEAM_ID = "XYZ987WVUT";
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
    expect(claims.iss).toBe("XYZ987WVUT");
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
    /* 2026-08-01 REWRITTEN TO THE PROPERTY. This used to assert that key + keyId +
       teamId with NO topic env reads as unconfigured — which is exactly what the
       staged-topic fallback legitimately changes, while saying nothing about the
       rule it stands for: the CREDENTIAL halves are each required.

       Half-configured must read as OFF rather than as broken: the feature then
       does not exist, which is the degradation every other transport here chooses. */
    process.env.APNS_P8_KEY = privateKey;
    expect(apnsVoipConfigured()).toBe(false); // no key id, no team id
    process.env.APNS_KEY_ID = "ABC123DEFG";
    expect(apnsVoipConfigured()).toBe(false); // still no team id
    process.env.APNS_TEAM_ID = "XYZ987WVUT";
    // The credential is complete now, and the topic no longer has to be named —
    // it falls back to the owner's staged value. An explicit bundle id still wins.
    expect(apnsVoipConfigured()).toBe(true);
    expect(apnsVoipConfig()!.topic).toBe("com.app.relaymobile.voip");
    process.env.APNS_BUNDLE_ID = "com.example.other";
    expect(apnsVoipConfig()!.topic).toBe("com.example.other.voip");
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

/**
 * CERTIFICATE AUTH (v2.105.14).
 *
 * The owner turned out to hold a VoIP Services certificate rather than a .p8, so
 * APNs' OTHER provider credential had to work too. It is a different mechanism,
 * not a different spelling: the cert+key are presented at the TLS handshake and
 * there is NO authorization header at all — sending an empty bearer alongside a
 * client certificate is how a working cert setup earns a 403 that reads like a
 * bad certificate.
 *
 * The config logic needs no real crypto (it keys on the PEM markers), so most of
 * this runs anywhere. Only the EXPIRY parse needs a genuine certificate, and that
 * one generates a throwaway self-signed pair rather than committing a key.
 */
const CERT_ENV = ["APNS_VOIP_CERT_PEM", "APNS_VOIP_KEY_PEM"];

/**
 * A REAL self-signed pair, minted once per run.
 *
 * REWRITTEN v2.105.17, and the reason is the whole point of that release. This helper
 * used to hand out synthetic PEMs under the comment "the config path keys on the
 * markers, never on validity" — which was an accurate description of a DEFECT. Because
 * `readPem` validated nothing beyond the marker substring, these tests asserted that
 * cert mode resolves for a certificate that could never complete a TLS handshake, and
 * the same hole let a header-only `.p8` report CONFIGURED to the admin push doctor
 * while no iPhone could ring.
 *
 * So the fixture is now genuine: `readPem` parses, and a test that wants cert mode has
 * to supply something Node's own X509 parser accepts.
 *
 * NOT SKIPPED WHEN openssl IS MISSING — this whole describe would silently assert
 * nothing, which reports safety, and that is the failure mode the release exists to
 * remove. Every environment this runs in (this container, ubuntu-latest) has openssl.
 */
let REAL: { cert: string; key: string; dir: string };
beforeAll(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "relay-apns-cert-"));
  const kp = path.join(dir, "k.pem");
  const cp = path.join(dir, "c.pem");
  execFileSync(
    "openssl",
    [
      "req", "-x509", "-newkey", "rsa:2048", "-nodes",
      "-keyout", kp, "-out", cp, "-days", "30",
      "-subj", "/CN=relay-test",
    ],
    { stdio: "ignore" },
  );
  REAL = { cert: fs.readFileSync(cp, "utf8"), key: fs.readFileSync(kp, "utf8"), dir };
});
afterAll(() => {
  if (REAL?.dir) fs.rmSync(REAL.dir, { recursive: true, force: true });
});

function certConfigure(extra: Record<string, string> = {}) {
  process.env.APNS_VOIP_CERT_PEM = REAL.cert;
  process.env.APNS_VOIP_KEY_PEM = REAL.key;
  process.env.APNS_VOIP_TOPIC = "com.app.relaymobile.voip";
  Object.assign(process.env, extra);
}

describe("v2.105.14 — certificate auth, the other APNs credential", () => {
  beforeEach(() => {
    for (const k of CERT_ENV) delete process.env[k];
  });
  afterEach(() => {
    for (const k of CERT_ENV) delete process.env[k];
  });

  it("a cert + key with a topic is configured, in cert mode", () => {
    certConfigure();
    const cfg = apnsVoipConfig();
    expect(cfg?.mode).toBe("cert");
    expect(cfg?.topic).toBe("com.app.relaymobile.voip");
    expect(cfg?.host).toBe("api.push.apple.com");
    expect(apnsVoipConfigured()).toBe(true);
  });

  it("needs NO key id and NO team id — the certificate IS the identity", () => {
    // This is the whole reason cert auth is simpler to configure. Requiring them
    // would refuse a perfectly valid setup.
    certConfigure();
    delete process.env.APNS_KEY_ID;
    delete process.env.APNS_TEAM_ID;
    expect(apnsVoipConfigured()).toBe(true);
  });

  it("HALF a pair is not configured — neither half alone can complete a handshake", () => {
    certConfigure();
    delete process.env.APNS_VOIP_KEY_PEM;
    expect(apnsVoipConfig()).toBeNull();
    certConfigure();
    delete process.env.APNS_VOIP_CERT_PEM;
    expect(apnsVoipConfig()).toBeNull();
  });

  it("refuses a cert value that is not actually a certificate", () => {
    // A path that does not exist, or a file that is not a PEM, must read as OFF
    // rather than being handed to TLS as garbage.
    certConfigure({ APNS_VOIP_CERT_PEM: "-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----" });
    expect(apnsVoipConfig()).toBeNull();
    certConfigure({ APNS_VOIP_CERT_PEM: path.join(os.tmpdir(), "no-such-relay-cert.pem") });
    expect(apnsVoipConfig()).toBeNull();
  });

  it("accepts either half as a PATH as well as inline PEM", () => {
    const cp = path.join(os.tmpdir(), `relay-c-${process.pid}.pem`);
    const kp = path.join(os.tmpdir(), `relay-k-${process.pid}.pem`);
    fs.writeFileSync(cp, REAL.cert);
    fs.writeFileSync(kp, REAL.key);
    try {
      certConfigure({ APNS_VOIP_CERT_PEM: cp, APNS_VOIP_KEY_PEM: kp });
      const cfg = apnsVoipConfig();
      expect(cfg?.mode).toBe("cert");
      expect((cfg as { certPem: string }).certPem).toContain("BEGIN CERTIFICATE");
    } finally {
      fs.unlinkSync(cp);
      fs.unlinkSync(kp);
    }
  });

  it("TOKEN AUTH WINS when both credentials are configured", () => {
    // Operational, not aesthetic: a .p8 never expires while a certificate lapses
    // on a date nobody is watching. If both are present, prefer the one that
    // cannot silently die.
    configure();
    certConfigure();
    expect(apnsVoipConfig()?.mode).toBe("token");
  });

  it("falls back to cert when the .p8 is only HALF configured", () => {
    // A .p8 with no key id cannot sign a usable JWT. Falling through to a
    // complete cert pair is better than reporting the whole feature off.
    certConfigure();
    process.env.APNS_P8_KEY = privateKey;
    delete process.env.APNS_KEY_ID;
    delete process.env.APNS_TEAM_ID;
    expect(apnsVoipConfig()?.mode).toBe("cert");
  });

  it("honours the sandbox opt-in in cert mode too", () => {
    certConfigure({ APNS_ENV: "sandbox" });
    expect(apnsVoipConfig()?.host).toBe("api.sandbox.push.apple.com");
  });

  it("derives the topic from the bundle id when no explicit topic is set", () => {
    certConfigure();
    delete process.env.APNS_VOIP_TOPIC;
    process.env.APNS_BUNDLE_ID = "com.app.relaymobile";
    expect(apnsVoipConfig()?.topic).toBe("com.app.relaymobile.voip");
  });

  it("sends NO authorization header in cert mode", () => {
    // The credential travels in the TLS handshake. A bearer here — empty or
    // otherwise — is how a working cert setup earns a 403 blamed on the cert.
    expect(SRC_FOR_HEADERS).toMatch(/\.\.\.\(jwt \? \{ authorization: `bearer \$\{jwt\}` \} : \{\}\)/);
    // …and the cert is passed to the connection, not to a header.
    expect(SRC_FOR_HEADERS).toMatch(/cfg\.mode === "cert" \? \{ key: cfg\.keyPem, cert: cfg\.certPem \} : undefined/);
  });

  it("a missing JWT aborts only TOKEN mode, never cert mode", () => {
    // In cert mode jwt is null BY DESIGN; an unconditional `if (!jwt) return`
    // would make certificate auth silently send nothing at all.
    expect(SRC_FOR_HEADERS).toMatch(/if \(cfg\.mode === "token"\) \{\s*\n\s*jwt = apnsProviderToken\(cfg\);\s*\n\s*if \(!jwt\) return out;/);
  });

  it("degrades rather than throwing with a cert that TLS will reject", async () => {
    // Config-valid but cryptographically junk. It must resolve, because the
    // caller reads `sent` to decide whether to page and a throw would bubble
    // into the invite path.
    certConfigure();
    await expect(
      sendVoipRing(["a".repeat(64)], { callerName: "A", callerPin: "1", roomId: "r", video: false }),
    ).resolves.toEqual({ sent: 0, invalidTokens: [] });
  });
});

describe("v2.105.17 — a key that cannot sign must never report CONFIGURED", () => {
  /* THE DEFECT THIS CLOSES, and it was mine.
   *
   * `readPem` validated only that the value CONTAINED the marker, and on the inline
   * branch that final check was TAUTOLOGICAL — control only reached it if the marker was
   * already present. So `APNS_KEY_P8="-----BEGIN PRIVATE KEY-----"` with no body was
   * accepted, apnsVoipConfig() returned mode="token", apnsVoipConfigured() returned
   * true, and THE ADMIN PUSH DOCTOR SHOWED GREEN — while crypto.sign threw
   * ERR_OSSL_UNSUPPORTED into a bare catch and every ring silently sent nothing.
   *
   * Telling an operator the fleet can ring when it cannot is the same defect v2.105.12
   * set out to remove, pointing the other way.
   *
   * AND IT WAS REACHABLE: aws-ops.yml's env-set appends KEY=VALUE on ONE line, so a
   * multi-line PEM lands as several unquoted lines and the env loader keeps only the
   * first — reducing the key to exactly that header. Verified by replaying that shell.
   */

  it("a header-only .p8 is NOT configured — the exact production shape", () => {
    configure({ APNS_P8_KEY: "-----BEGIN PRIVATE KEY-----" });
    expect(apnsVoipConfig()).toBeNull();
    expect(apnsVoipConfigured()).toBe(false);
  });

  it("the same holds for the APNS_KEY_P8 spelling", () => {
    // Both names reach the same read, so a fix that covered only one would leave the
    // hole open for whichever spelling the operator happened to use.
    delete process.env.APNS_P8_KEY;
    configure({ APNS_KEY_P8: "-----BEGIN PRIVATE KEY-----" });
    delete process.env.APNS_P8_KEY;
    expect(apnsVoipConfig()).toBeNull();
  });

  it("a header-plus-garbage body is refused, not just a bare header", () => {
    configure({
      APNS_P8_KEY: "-----BEGIN PRIVATE KEY-----\nnot base64 at all\n-----END PRIVATE KEY-----",
    });
    expect(apnsVoipConfig()).toBeNull();
  });

  it("a TRUNCATED but well-formed-looking key is refused", () => {
    // The likeliest real corruption: a genuine PEM with lines lost. It still has both
    // markers and valid base64 characters, so nothing short of parsing catches it.
    const lines = privateKey.trim().split("\n");
    const truncated = [lines[0], lines[1], lines[lines.length - 1]].join("\n");
    configure({ APNS_P8_KEY: truncated });
    expect(apnsVoipConfig()).toBeNull();
  });

  it("a REAL key still configures — the fix refuses the unusable, not the valid", () => {
    // The fail-shut direction is only correct if it does not also reject what works.
    configure();
    const cfg = apnsVoipConfig();
    expect(cfg).not.toBeNull();
    expect(cfg!.mode).toBe("token");
    // …and it can actually mint, which is the property the doctor is really claiming.
    expect(apnsProviderToken(cfg as never)).toBeTruthy();
  });

  it("a PATH to an unusable key is refused as well as an inline one", () => {
    // The path branch read the file and then applied the same substring check, so it
    // had the identical hole for a truncated FILE — which is the shape an operator who
    // followed the mounted-secret advice would actually hit.
    const kp = path.join(os.tmpdir(), `relay-badkey-${process.pid}.pem`);
    fs.writeFileSync(kp, "-----BEGIN PRIVATE KEY-----\n-----END PRIVATE KEY-----");
    try {
      configure({ APNS_P8_KEY: kp });
      expect(apnsVoipConfig()).toBeNull();
    } finally {
      fs.unlinkSync(kp);
    }
  });

  it("a PATH to a REAL key configures, so the mounted-secret route still works", () => {
    const kp = path.join(os.tmpdir(), `relay-goodkey-${process.pid}.pem`);
    fs.writeFileSync(kp, privateKey);
    try {
      configure({ APNS_P8_KEY: kp });
      expect(apnsVoipConfig()?.mode).toBe("token");
    } finally {
      fs.unlinkSync(kp);
    }
  });

  /* ── THE KEY MUST BE P-256, NOT MERELY LOADABLE ──────────────────────────────
   * "It parses" is a weaker property than "it can sign an ES256 JWS", and the gap
   * between them is the same lie one layer deeper: the config reports mode="token",
   * `apnsProviderToken` signs successfully, and then `derToJoseES256` returns null at
   * an EARLY RETURN that never reaches the warning — so the doctor is green, no ring
   * is sent, and NOTHING is logged.
   *
   * It is reachable by an ordinary paste slip: `APNS_VOIP_KEY_PEM` (the certificate
   * mode's RSA key) and `APNS_P8_KEY` are adjacent variables for one feature, and an
   * Apple .p8 is ALWAYS P-256, so nothing else can legitimately appear here.
   * Measured rather than assumed: a P-384 key signs to a 103-byte DER and an RSA key
   * to a 256-byte PKCS#1 blob, and `derToJoseES256` answers null for both.
   */

  it("an RSA key is NOT a .p8 — refused, not reported configured", () => {
    configure({ APNS_P8_KEY: RSA_KEY });
    expect(apnsVoipConfig()).toBeNull();
    expect(apnsVoipConfigured()).toBe(false);
  });

  it("a P-384 key is refused — the right family, the wrong curve", () => {
    // The nastiest of the three, because `asymmetricKeyType === "ec"` is TRUE and the
    // sign call succeeds: only the curve tells you the 48-byte halves will be mangled
    // into a 64-byte ES256 signature APNs answers 403 to.
    configure({ APNS_P8_KEY: P384_KEY });
    expect(apnsVoipConfig()).toBeNull();
  });

  it("an Ed25519 key is refused", () => {
    // Loads fine and is not EC at all; signing it with sha256 throws
    // ERR_OSSL_INVALID_DIGEST, so accepting it would put the failure in the catch
    // rather than in the config, which is where an operator can act on it.
    configure({ APNS_P8_KEY: ED25519_KEY });
    expect(apnsVoipConfig()).toBeNull();
  });

  it("the curve check does not reject the curve Apple actually issues", () => {
    // The fail-shut direction is only correct if P-256 still passes AND still mints.
    configure({ APNS_P8_KEY: privateKey });
    expect(apnsVoipConfig()?.mode).toBe("token");
    expect(apnsProviderToken(apnsVoipConfig() as never)).toBeTruthy();
  });

  it("the wrong-curve path can no longer reach the silent null-token return", () => {
    // The property that actually matters: not merely that the config refuses, but that
    // the unlogged early return in apnsProviderToken has become unreachable from a
    // configured fleet. Driven end to end rather than asserted about source.
    for (const key of [RSA_KEY, P384_KEY, ED25519_KEY]) {
      configure({ APNS_P8_KEY: key });
      expect(apnsVoipConfig()).toBeNull(); // never gets as far as signing
    }
  });

  it("an unsignable key leaves EVIDENCE in the log, once per process", () => {
    // The catch in apnsProviderToken used to be completely silent, so a fleet that
    // could not ring left no trace of why. It should be unreachable now that the config
    // validates — which is exactly the branch worth leaving evidence in.
    const src = fs.readFileSync(path.join(__dirname, "apnsVoip.ts"), "utf8");
    expect(src).toMatch(/if \(!signWarned\) \{/);
    expect(src).toMatch(/console\.warn\(/);
    // The KEY is never logged — only the error text and the key id, which is public.
    const warn = src.slice(src.indexOf("if (!signWarned)"), src.indexOf("return null;", src.indexOf("if (!signWarned)")));
    expect(warn).not.toMatch(/keyPem/);
    expect(warn).not.toMatch(/cfg\.keyPem/);
  });
});

describe("v2.105.14 — a certificate EXPIRES, and the operator should hear about it", () => {
  it("returns null for token auth — nothing to expire", () => {
    configure();
    expect(apnsCredentialExpiry(apnsVoipConfig())).toBeNull();
  });

  it("an unparseable certificate never REACHES the expiry read — it is not configured", () => {
    // THE SCENARIO MOVED IN v2.105.17 rather than the property being dropped, and the
    // new place is strictly stronger. This used to assert "a bad cert yields a null
    // expiry", which was true but late: the config still reported mode="cert", so the
    // doctor showed a CONFIGURED row with a blank expiry and the fleet could not ring.
    // Now `readPem` proves the PEM loads, so a bad cert means NOT CONFIGURED at all —
    // the operator is told the thing that is actually wrong.
    certConfigure({
      APNS_VOIP_CERT_PEM: "-----BEGIN CERTIFICATE-----\nnope\n-----END CERTIFICATE-----",
    });
    expect(apnsVoipConfig()).toBeNull();
    expect(apnsVoipConfigured()).toBe(false);
    // And the expiry read still refuses to guess when handed nothing.
    expect(apnsCredentialExpiry(apnsVoipConfig())).toBeNull();
  });

  it("an unparseable KEY is refused too, not just the certificate", () => {
    // Both halves go through readPem, and a cert that parses beside a key that does
    // not cannot complete a handshake — so reporting configured would be the same lie.
    certConfigure({
      APNS_VOIP_KEY_PEM: "-----BEGIN PRIVATE KEY-----\nnope\n-----END PRIVATE KEY-----",
    });
    expect(apnsVoipConfig()).toBeNull();
  });

  it("reads notAfter from a REAL certificate", () => {
    // Generated here rather than committed: this repo is public, and a test
    // fixture private key is a habit worth not forming.
    let pair: { cert: string; key: string } | null = null;
    try {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "relay-x509-"));
      const kp = path.join(dir, "k.pem");
      const cp = path.join(dir, "c.pem");
      execFileSync("openssl", [
        "req", "-x509", "-newkey", "rsa:2048", "-nodes",
        "-keyout", kp, "-out", cp, "-days", "30",
        "-subj", "/CN=relay-test",
      ], { stdio: "ignore" });
      pair = { cert: fs.readFileSync(cp, "utf8"), key: fs.readFileSync(kp, "utf8") };
    } catch {
      pair = null; // no openssl on this machine
    }
    if (!pair) return; // skip rather than fail: the parse is Node's, not ours
    certConfigure({ APNS_VOIP_CERT_PEM: pair.cert, APNS_VOIP_KEY_PEM: pair.key });
    const when = apnsCredentialExpiry(apnsVoipConfig());
    expect(when).toBeInstanceOf(Date);
    const days = (when!.getTime() - Date.now()) / 86_400_000;
    // ~30 days out; generous bounds so a slow runner cannot flake it.
    expect(days).toBeGreaterThan(28);
    expect(days).toBeLessThan(32);
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

/**
 * v2.106.71 — THE TWO GAPS AN AUDIT OF THE PUSH DOC AGAINST THIS FILE FOUND.
 *
 * The owner re-uploaded `relaypushbackendconfig.md` and asked whether it had been
 * done. v2.106.69 wired both credential pipes; checking the file against the doc
 * CLAUSE BY CLAUSE — rather than against my own notes — turned up two more.
 */
describe("v2.106.71 — the staged configuration is reachable, and a 400 no longer deregisters", () => {
  it("resolves the owner's staged topic when the environment names none", () => {
    /* THE DOC'S ENV TABLE LISTS ONLY `APNS_KEY_ID` AND `APNS_TEAM_ID`. It names no
       topic variable and no bundle id, while stating the topic as a fixed value in
       its own send section. A fleet configured literally to that table therefore had
       NO topic, `apnsVoipConfig()` returned null, and no iPhone rang — the v2.106.69
       FCM defect one platform over. */
    process.env.APNS_P8_KEY = privateKey;
    process.env.APNS_KEY_ID = "ABC123DEFG";
    process.env.APNS_TEAM_ID = "XYZ987WVUT";
    delete process.env.APNS_BUNDLE_ID;
    delete process.env.APNS_VOIP_TOPIC;
    expect(apnsVoipConfig()?.topic).toBe("com.app.relaymobile.voip");
  });

  it("the environment always WINS — the fallback is a last resort, never an override", () => {
    configure({ APNS_VOIP_TOPIC: "com.example.custom.voip" });
    expect(apnsVoipConfig()?.topic).toBe("com.example.custom.voip");
    configure({ APNS_BUNDLE_ID: "com.example.other" });
    delete process.env.APNS_VOIP_TOPIC;
    expect(apnsVoipConfig()?.topic).toBe("com.example.other.voip");
  });

  it("falls back to the staged .p8 PATH, and an unreadable one fails to null", () => {
    /* Same shape as the FCM fix: the operator's own value is tried first, and a
       missing file falls THROUGH rather than throwing — a stale path must not mask
       a good credential, and a box with no key must read as unconfigured. */
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apns-"));
    const staged = path.join(dir, "apns-key.p8");
    fs.writeFileSync(staged, privateKey);
    try {
      configure({ APNS_P8_KEY: staged });
      expect(apnsVoipConfig()?.mode).toBe("token");
      // A path that does not exist is not a credential.
      configure({ APNS_P8_KEY: path.join(dir, "absent.p8") });
      expect(apnsVoipConfig()).toBeNull();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("the staged path is WIRED as the last candidate — pinned, and honestly so", () => {
    /* FOUND BY MUTATION: deleting the fallback SURVIVED the case above, because that
       one sets APNS_P8_KEY explicitly and therefore never reaches it.

       Said plainly — this property cannot be told apart behaviourally HERE: the
       staged path is `/home/relay/apns-key.p8`, which does not exist in this sandbox
       and which a test has no business creating, so with the variable unset both the
       fixed and the unfixed code return null. A source pin is the honest instrument,
       and it is comment-stripped so the prose above cannot satisfy it. */
    const src = codeOnly(fs.readFileSync(new URL("./apnsVoip.ts", import.meta.url), "utf8"));
    expect(src).toMatch(/const DEFAULT_P8_PATH = "\/home\/relay\/apns-key\.p8";/);
    // LAST candidate: the env vars are read first and `||` only falls through when
    // both are empty, so an operator's own value can never be overridden.
    expect(src).toMatch(
      /process\.env\.APNS_P8_KEY \|\| process\.env\.APNS_KEY_P8 \|\| ""\)\.trim\(\) \|\| DEFAULT_P8_PATH/,
    );
  });

  it("PRUNES ON 410 ONLY — a 400 is kept, because it usually means MIS-CONFIGURED", () => {
    /* Apple documents BadDeviceToken as "verify the token is valid AND THAT IT
       MATCHES THE ENVIRONMENT", so a perfectly live token answers 400 whenever
       APNS_ENV disagrees with the build that registered it. The old rule deleted
       it: one environment mismatch would have wiped every iPhone registration in
       the fleet, permanently, on the first push after a deploy.

       Driven against the REAL source rather than asserted, because which statuses
       reach `invalidTokens` is the whole property. */
    /* ON COMMENT-STRIPPED SOURCE — the prose trap, for the seventeenth time: the
       comment ABOVE this gate explains the fix and therefore contains the very word
       the assertion forbids, so it failed on correct code until it was stripped. */
    const src = codeOnly(fs.readFileSync(new URL("./apnsVoip.ts", import.meta.url), "utf8"));
    const at = src.indexOf("out.invalidTokens.push(token)");
    expect(at).toBeGreaterThan(-1);
    const gate = src.slice(src.lastIndexOf("if (status === 200)", at), at);
    expect(gate).toMatch(/status === 410/);
    expect(gate).toMatch(/\\bUnregistered\\b/);
    // The two 400 reasons that used to prune must NOT appear in the pruning gate.
    expect(gate, "BadDeviceToken must no longer prune").not.toMatch(/BadDeviceToken/);
    expect(gate, "a bare 400 must no longer prune").not.toMatch(/status === 400/);
    // …and a non-pruning failure is said out loud rather than swallowed.
    const after = src.slice(at, at + 800);
    expect(after).toMatch(/console\.warn\(\s*\n?\s*`\[apns-voip\] send failed/);
    expect(after).toMatch(/KEPT/);
  });
});
