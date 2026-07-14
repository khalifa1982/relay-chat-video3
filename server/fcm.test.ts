import { describe, expect, it } from "vitest";
import crypto from "crypto";
import { buildFcmAssertion, fcmConfig } from "./fcm";

/** v2.86 — FCM sender for the native Android app. */

describe("fcmConfig", () => {
  it("is null without FIREBASE_SERVICE_ACCOUNT_JSON (FCM sends skip silently)", () => {
    const prev = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    try {
      expect(fcmConfig()).toBeNull();
      process.env.FIREBASE_SERVICE_ACCOUNT_JSON = "{not json";
      expect(fcmConfig()).toBeNull();
      process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({ project_id: "p" }); // incomplete
      expect(fcmConfig()).toBeNull();
      process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({
        project_id: "relay-app",
        client_email: "svc@relay-app.iam.gserviceaccount.com",
        private_key: "-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----\n",
      });
      expect(fcmConfig()?.project_id).toBe("relay-app");
    } finally {
      if (prev === undefined) delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
      else process.env.FIREBASE_SERVICE_ACCOUNT_JSON = prev;
    }
  });
});

describe("buildFcmAssertion", () => {
  it("produces a VALID RS256 JWT for Google's token endpoint (verified against the real public key)", () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    const sa = { project_id: "relay-app", client_email: "svc@relay-app.iam.gserviceaccount.com", private_key: privateKey };
    const now = 1_760_000_000;
    const jwt = buildFcmAssertion(sa, now);
    const [h, c, sig] = jwt.split(".");
    // Signature verifies with the matching public key.
    const ok = crypto
      .createVerify("RSA-SHA256")
      .update(`${h}.${c}`)
      .verify(publicKey, Buffer.from(sig.replace(/-/g, "+").replace(/_/g, "/"), "base64"));
    expect(ok).toBe(true);
    // Claims carry the messaging scope + Google token audience + 1h expiry.
    const claims = JSON.parse(Buffer.from(c.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString());
    expect(claims.iss).toBe(sa.client_email);
    expect(claims.scope).toBe("https://www.googleapis.com/auth/firebase.messaging");
    expect(claims.aud).toBe("https://oauth2.googleapis.com/token");
    expect(claims.exp - claims.iat).toBe(3600);
    const header = JSON.parse(Buffer.from(h.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString());
    expect(header).toEqual({ alg: "RS256", typ: "JWT" });
  });
});
