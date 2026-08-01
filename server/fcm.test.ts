import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { buildFcmAssertion, fcmConfig, tokenIsDead } from "./fcm";

/** v2.86 — FCM sender for the native Android app. */

/**
 * Every variable this module reads, cleared together.
 *
 * Clearing only ONE of them is how a test comes to pass for the wrong reason once a
 * second name is accepted: `GOOGLE_APPLICATION_CREDENTIALS` is a name other tooling
 * sets, so a test that deletes only `FIREBASE_SERVICE_ACCOUNT_JSON` and then asserts
 * "not configured" would be asserting something about the runner's environment.
 */
const KEYS = ["FIREBASE_SERVICE_ACCOUNT_JSON", "GOOGLE_APPLICATION_CREDENTIALS", "FCM_PROJECT_ID"] as const;
let saved: Record<string, string | undefined> = {};
beforeEach(() => {
  saved = Object.fromEntries(KEYS.map(k => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k]!;
  }
});

function realKey(): string {
  return crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  }).privateKey as string;
}
function serviceAccount(projectId = "relay-5f28c"): string {
  return JSON.stringify({
    project_id: projectId,
    client_email: `svc@${projectId}.iam.gserviceaccount.com`,
    private_key: realKey(),
  });
}

describe("fcmConfig", () => {
  it("is null without FIREBASE_SERVICE_ACCOUNT_JSON (FCM sends skip silently)", () => {
    {
      expect(fcmConfig()).toBeNull();
      process.env.FIREBASE_SERVICE_ACCOUNT_JSON = "{not json";
      expect(fcmConfig()).toBeNull();
      process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({ project_id: "p" }); // incomplete
      expect(fcmConfig()).toBeNull();
      /* A KEY THAT CANNOT SIGN IS NOT CONFIGURED (rewritten v2.105.17).
         The old fixture's private_key was `-----BEGIN PRIVATE KEY-----\nx\n-----END…`,
         which cannot sign anything — so this test asserted that Firebase reports
         CONFIGURED for a credential that makes every send a silent no-op, byte-identical
         to having none. That green row is what the owner was looking at while reporting
         "i have problem with firebase to send the notification". */
      process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({
        project_id: "relay-app",
        client_email: "svc@relay-app.iam.gserviceaccount.com",
        private_key: "-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----\n",
      });
      expect(fcmConfig()).toBeNull();

      // A REAL key configures, and the \n-escaped form — the commonest Firebase
      // copy-paste damage — is REPAIRED rather than refused, because refusing it would
      // send an operator hunting for a problem they cannot see.
      const real = crypto.generateKeyPairSync("rsa", {
        modulusLength: 2048,
        privateKeyEncoding: { type: "pkcs8", format: "pem" },
        publicKeyEncoding: { type: "spki", format: "pem" },
      }).privateKey as string;
      process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({
        project_id: "relay-app",
        client_email: "svc@relay-app.iam.gserviceaccount.com",
        private_key: real,
      });
      expect(fcmConfig()?.project_id).toBe("relay-app");
      process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({
        project_id: "relay-app",
        client_email: "svc@relay-app.iam.gserviceaccount.com",
        private_key: real.replace(/\n/g, "\\n"),
      });
      expect(fcmConfig()?.project_id).toBe("relay-app");
      expect(fcmConfig()?.private_key).toContain("\n");
    }
  });
});

/**
 * THE FLEET'S CREDENTIAL WAS STAGED AND THE CODE COULD NOT SEE IT (2026-08-01).
 *
 * The owner put the service account on both app instances as
 * `GOOGLE_APPLICATION_CREDENTIALS=/home/relay/fcm-sa.json` and proved the pipe end to
 * end. This module read only `FIREBASE_SERVICE_ACCOUNT_JSON`, so on that fleet FCM was
 * reported NOT configured and every Android push was skipped — the same silent-lie
 * shape v2.105.17 removed, one layer out.
 */
describe("the service account is read from either variable, in either shape", () => {
  let dir = "";
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "relay-fcm-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("reads GOOGLE_APPLICATION_CREDENTIALS as a PATH — the fleet's actual configuration", () => {
    const p = path.join(dir, "fcm-sa.json");
    fs.writeFileSync(p, serviceAccount());
    process.env.GOOGLE_APPLICATION_CREDENTIALS = p;
    expect(fcmConfig()?.project_id).toBe("relay-5f28c");
  });

  it("reads FIREBASE_SERVICE_ACCOUNT_JSON as a PATH too — the shape decides, not the name", () => {
    /* Guessing wrong either way is a silent misconfiguration, which is the reasoning
       `readPem` already records for APNS_P8_KEY. */
    const p = path.join(dir, "sa.json");
    fs.writeFileSync(p, serviceAccount("proj-a"));
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = p;
    expect(fcmConfig()?.project_id).toBe("proj-a");
  });

  it("reads GOOGLE_APPLICATION_CREDENTIALS as INLINE json too", () => {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = serviceAccount("proj-b");
    expect(fcmConfig()?.project_id).toBe("proj-b");
  });

  it("prefers FIREBASE_SERVICE_ACCOUNT_JSON, so every deployment that works today is unchanged", () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = serviceAccount("explicit");
    process.env.GOOGLE_APPLICATION_CREDENTIALS = serviceAccount("fallback");
    expect(fcmConfig()?.project_id).toBe("explicit");
  });

  it("falls THROUGH an unreadable first value rather than reporting not-configured", () => {
    /* A stale path in one variable must not mask a working credential in the other —
       failing shut there would be the exact bug this describe block exists to fix. */
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = path.join(dir, "does-not-exist.json");
    process.env.GOOGLE_APPLICATION_CREDENTIALS = serviceAccount("survivor");
    expect(fcmConfig()?.project_id).toBe("survivor");
  });

  it("a path to something that is not json is not configured", () => {
    const p = path.join(dir, "notes.txt");
    fs.writeFileSync(p, "this is not a service account");
    process.env.GOOGLE_APPLICATION_CREDENTIALS = p;
    expect(fcmConfig()).toBeNull();
  });

  it("FCM_PROJECT_ID is a cross-check, never an override", () => {
    /* The access token is minted BY the service account and is only valid for its own
       project, so pointing the send URL elsewhere would 403 every push. The JSON wins
       and the disagreement is said out loud once. */
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      process.env.GOOGLE_APPLICATION_CREDENTIALS = serviceAccount("relay-5f28c");
      process.env.FCM_PROJECT_ID = "some-other-project";
      expect(fcmConfig()?.project_id).toBe("relay-5f28c");
      expect(warn).toHaveBeenCalled();
      expect(String(warn.mock.calls[0]?.[0])).toContain("some-other-project");
    } finally {
      warn.mockRestore();
    }
  });

  it("an AGREEING FCM_PROJECT_ID says nothing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      process.env.GOOGLE_APPLICATION_CREDENTIALS = serviceAccount("relay-5f28c");
      process.env.FCM_PROJECT_ID = "relay-5f28c";
      expect(fcmConfig()?.project_id).toBe("relay-5f28c");
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

/**
 * PRUNING ON A 400 IS A SELF-DEREGISTERING FAILURE.
 *
 * FCM answers 400 INVALID_ARGUMENT for a malformed MESSAGE as readily as for a
 * malformed token, so `status === 400 → prune` meant one bad payload of ours would
 * delete every Android registration in the fleet in parallel, on the first push after
 * a deploy — and those devices never ring again with nothing saying why. The same
 * shape as the APNs bug v2.105.13 fixed.
 */
describe("tokenIsDead — prune on evidence about the TOKEN", () => {
  const UNREGISTERED = JSON.stringify({
    error: { code: 404, status: "NOT_FOUND", details: [{ errorCode: "UNREGISTERED" }] },
  });
  const BAD_MESSAGE = JSON.stringify({
    error: {
      code: 400,
      status: "INVALID_ARGUMENT",
      message: 'Invalid JSON payload received. Unknown name "mode" at \'message.android\'.',
    },
  });
  const BAD_TOKEN = JSON.stringify({
    error: { code: 400, status: "INVALID_ARGUMENT", message: "The registration token is not a valid FCM registration token" },
  });

  it("404 / UNREGISTERED is dead — the one case the push spec asks us to prune", () => {
    expect(tokenIsDead(404, UNREGISTERED)).toBe(true);
    expect(tokenIsDead(404, "")).toBe(true);
    expect(tokenIsDead(200, UNREGISTERED)).toBe(true); // the body is the evidence
  });

  it("a 400 about OUR MESSAGE keeps the token", () => {
    expect(tokenIsDead(400, BAD_MESSAGE)).toBe(false);
  });

  it("a 400 that names the registration token IS dead", () => {
    expect(tokenIsDead(400, BAD_TOKEN)).toBe(true);
  });

  it("every other refusal keeps the token", () => {
    for (const s of [401, 403, 429, 500, 502, 503]) {
      expect(tokenIsDead(s, "quota exceeded"), `status ${s}`).toBe(false);
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
