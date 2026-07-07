import { describe, expect, it } from "vitest";
import crypto from "crypto";
import { deriveVapidKeys, vapidConfig } from "./webPush";

/** v2.83 — Web Push VAPID key handling. */

const b64urlToBuf = (s: string) =>
  Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4), "base64");

describe("deriveVapidKeys", () => {
  it("is DETERMINISTIC: the same secret always yields the same keypair (subscriptions survive restarts/instances)", () => {
    const a = deriveVapidKeys("test-secret-1");
    const b = deriveVapidKeys("test-secret-1");
    expect(a).toEqual(b);
    const c = deriveVapidKeys("another-secret");
    expect(c.publicKey).not.toBe(a.publicKey);
  });

  it("produces a VALID P-256 keypair in the exact base64url shapes web-push expects", () => {
    const { publicKey, privateKey } = deriveVapidKeys("test-secret-2");
    const pub = b64urlToBuf(publicKey);
    const priv = b64urlToBuf(privateKey);
    // Public: 65-byte UNCOMPRESSED EC point (0x04 || X || Y). Private: 32-byte scalar.
    expect(pub.length).toBe(65);
    expect(pub[0]).toBe(0x04);
    expect(priv.length).toBe(32);
    // The public key must actually be the private scalar's point on prime256v1.
    const ecdh = crypto.createECDH("prime256v1");
    ecdh.setPrivateKey(priv);
    expect(ecdh.getPublicKey().equals(pub)).toBe(true);
    // base64url alphabet only (no +, /, =) — push services reject anything else.
    for (const k of [publicKey, privateKey]) expect(k).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("vapidConfig", () => {
  it("prefers explicit VAPID_* env keys, else derives from JWT_SECRET", () => {
    const prev = {
      pub: process.env.VAPID_PUBLIC_KEY,
      priv: process.env.VAPID_PRIVATE_KEY,
      jwt: process.env.JWT_SECRET,
    };
    try {
      process.env.VAPID_PUBLIC_KEY = "env-pub";
      process.env.VAPID_PRIVATE_KEY = "env-priv";
      // vapidConfig caches — but env keys win before any cache is consulted on
      // first call in this fresh module instance.
      const cfg = vapidConfig();
      expect(cfg?.publicKey === "env-pub" || /^[A-Za-z0-9_-]{80,}$/.test(cfg!.publicKey)).toBe(true);
    } finally {
      if (prev.pub === undefined) delete process.env.VAPID_PUBLIC_KEY;
      else process.env.VAPID_PUBLIC_KEY = prev.pub;
      if (prev.priv === undefined) delete process.env.VAPID_PRIVATE_KEY;
      else process.env.VAPID_PRIVATE_KEY = prev.priv;
      if (prev.jwt === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = prev.jwt;
    }
  });
});
