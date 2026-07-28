/* ──────────────────────────────────────────────────────────────────────────
 * APNs VoIP pushes — zero dependency (v2.105.12).
 *
 * A VoIP push is what makes an iPhone show the real full-screen CallKit call
 * screen on a locked device. It is NOT an ordinary notification and cannot be
 * sent through Expo or FCM: it goes straight to APNs with `apns-push-type: voip`
 * on the `<bundle-id>.voip` topic, and iOS hands it to the app's PushKit
 * delegate even when the app is not running.
 *
 * ── WHY .p8 TOKEN AUTH RATHER THAN THE CERTIFICATE ────────────────────────
 * A VoIP Services certificate works, but it expires annually and its private
 * key is a file that has to live somewhere. A .p8 key signs a short-lived JWT,
 * does not expire, and serves every APNs topic — one credential to rotate. The
 * owner chose it, and it is also the option that keeps a private key out of the
 * repository entirely.
 *
 * ── ZERO DEPENDENCY, LIKE EVERY OTHER TRANSPORT HERE ──────────────────────
 * `smtp.ts`, `s3.ts`, `fcm.ts` and `expoPush.ts` are all hand-written for the
 * same reason: one npm package for one HTTP call is a supply-chain surface this
 * project has consistently refused. Node ships `node:http2` and `node:crypto`,
 * which is everything APNs needs.
 *
 * ── THE SUBTLE PART IS THE SIGNATURE, NOT THE REQUEST ─────────────────────
 * ES256 JWT requires the signature as raw `r‖s` (64 bytes). Node's
 * `crypto.sign` emits ASN.1 DER for EC keys, so it MUST be converted — a DER
 * signature is accepted by nothing and APNs answers 403 InvalidProviderToken,
 * which reads like a bad key rather than a bad encoding. That conversion is the
 * one piece worth testing hardest.
 *
 * Configuration is read PER CALL (the `TURN_*` convention), so the fleet can be
 * given the key without a rebuild. With nothing configured, `apnsVoipConfigured()`
 * is false and the sender is a no-op — the feature does not exist rather than
 * failing loudly on every dial.
 * ────────────────────────────────────────────────────────────────────────── */
import crypto from "crypto";
import http2 from "http2";
import fs from "fs";

/** Apple caps a provider token at 1h; refresh well inside that. */
const TOKEN_TTL_MS = 45 * 60_000;
/** A ring is worthless late. APNs drops it rather than storing it. */
const VOIP_EXPIRY_SECONDS = 45;

export interface ApnsVoipConfig {
  keyPem: string;
  keyId: string;
  teamId: string;
  /** The push topic: `<bundle-id>.voip` for VoIP. Derived if only a bundle id is given. */
  topic: string;
  host: string;
}

/**
 * Read the config from the environment, per call.
 *
 * `APNS_P8_KEY` may be the PEM itself or a path to it — an inline PEM is what a
 * `.env` can hold, a path is what a mounted secret looks like, and guessing
 * wrong either way is a silent misconfiguration. A value that starts with the
 * PEM header is content; anything else is treated as a path.
 */
export function apnsVoipConfig(): ApnsVoipConfig | null {
  const raw = (process.env.APNS_P8_KEY || process.env.APNS_KEY_P8 || "").trim();
  const keyId = (process.env.APNS_KEY_ID || "").trim();
  const teamId = (process.env.APNS_TEAM_ID || "").trim();
  const bundleId = (process.env.APNS_BUNDLE_ID || "").trim();
  const topicEnv = (process.env.APNS_VOIP_TOPIC || "").trim();
  if (!raw || !keyId || !teamId) return null;

  let keyPem = raw;
  if (!raw.includes("BEGIN PRIVATE KEY")) {
    try {
      keyPem = fs.readFileSync(raw, "utf8");
    } catch {
      return null;
    }
  }
  if (!keyPem.includes("BEGIN PRIVATE KEY")) return null;

  // The VoIP topic is the bundle id plus `.voip`. Appending it ourselves when a
  // bare bundle id is given avoids the most likely configuration mistake, and an
  // explicit topic still wins so an unusual setup is expressible.
  const topic = topicEnv || (bundleId ? `${bundleId}.voip` : "");
  if (!topic) return null;

  // Sandbox is a DELIBERATE opt-in. Defaulting to it would make a production
  // build silently un-ringable, which is the failure this whole file exists to
  // remove; defaulting to production means a dev build fails loudly instead.
  const sandbox = /^(1|true|sandbox|dev|development)$/i.test(process.env.APNS_ENV || "");
  const host = sandbox ? "api.sandbox.push.apple.com" : "api.push.apple.com";
  return { keyPem, keyId, teamId, topic, host };
}

export function apnsVoipConfigured(): boolean {
  return apnsVoipConfig() !== null;
}

function b64url(b: Buffer): string {
  return b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * ASN.1 DER ECDSA signature → raw `r‖s`, which is what JWS ES256 requires.
 *
 * Node signs EC keys into DER (`30 len 02 rlen r 02 slen s`). Each integer is
 * signed big-endian, so it may carry a leading 0x00 that must be dropped, and it
 * may be SHORTER than 32 bytes and must be left-padded. Getting either wrong
 * produces a token APNs rejects with 403 InvalidProviderToken — an error that
 * reads like a wrong key and sends you looking in the wrong place entirely.
 *
 * Exported so it can be tested directly against real signatures rather than
 * inferred from a successful send.
 */
export function derToJoseES256(der: Buffer): Buffer | null {
  try {
    if (der.length < 8 || der[0] !== 0x30) return null;
    // Skip the SEQUENCE header (long form supported, though P-256 never needs it).
    let i = 1;
    if (der[i] & 0x80) i += 1 + (der[i] & 0x7f);
    else i += 1;
    if (der[i] !== 0x02) return null;
    const rLen = der[i + 1];
    let r = der.subarray(i + 2, i + 2 + rLen);
    i = i + 2 + rLen;
    if (der[i] !== 0x02) return null;
    const sLen = der[i + 1];
    let s = der.subarray(i + 2, i + 2 + sLen);
    // Strip the sign byte, then left-pad to exactly 32.
    while (r.length > 32 && r[0] === 0x00) r = r.subarray(1);
    while (s.length > 32 && s[0] === 0x00) s = s.subarray(1);
    if (r.length > 32 || s.length > 32) return null;
    const out = Buffer.alloc(64);
    r.copy(out, 32 - r.length);
    s.copy(out, 64 - s.length);
    return out;
  } catch {
    return null;
  }
}

let cached: { token: string; exp: number; keyId: string } | null = null;

/**
 * Mint (or reuse) the provider JWT. Cached because a ring must not wait on a
 * signature it already has, and because Apple rate-limits token minting.
 * Keyed on the key id so rotating the key cannot serve a stale token.
 */
export function apnsProviderToken(cfg: ApnsVoipConfig, nowMs: number = Date.now()): string | null {
  if (cached && cached.keyId === cfg.keyId && cached.exp > nowMs + 60_000) return cached.token;
  try {
    const header = b64url(Buffer.from(JSON.stringify({ alg: "ES256", kid: cfg.keyId, typ: "JWT" })));
    const iat = Math.floor(nowMs / 1000);
    const claims = b64url(Buffer.from(JSON.stringify({ iss: cfg.teamId, iat })));
    const signingInput = `${header}.${claims}`;
    const der = crypto.sign("sha256", Buffer.from(signingInput), {
      key: cfg.keyPem,
      dsaEncoding: "der",
    });
    const jose = derToJoseES256(der);
    if (!jose) return null;
    const token = `${signingInput}.${b64url(jose)}`;
    cached = { token, exp: nowMs + TOKEN_TTL_MS, keyId: cfg.keyId };
    return token;
  } catch {
    return null;
  }
}

/** Test seam: drop the cached provider token. */
export function _resetApnsTokenCache() {
  cached = null;
}

export interface VoipRingPayload {
  /** Who is calling — the shell shows this on the CallKit screen. */
  callerName: string;
  callerPin: string;
  /** The room the callee must join to answer. Without it the ring is undialable. */
  roomId: string;
  video: boolean;
}

export interface VoipSendResult {
  sent: number;
  /** Tokens APNs says are gone. The caller prunes them, as the FCM path does. */
  invalidTokens: string[];
}

/**
 * Send a VoIP ring to each APNs device token. Best effort; never throws.
 *
 * THE PAYLOAD CARRIES THE ROOM, and that is what separates this from a
 * notification: the callee's PushKit handler has to be able to ANSWER, which
 * means joining a room the caller already created. A ring without a room is a
 * phone that rings and then cannot connect.
 *
 * It carries no message content and no third party's data — a caller's own name
 * and number, which the callee is about to see anyway.
 */
export async function sendVoipRing(
  tokens: string[],
  payload: VoipRingPayload,
): Promise<VoipSendResult> {
  const out: VoipSendResult = { sent: 0, invalidTokens: [] };
  const cfg = apnsVoipConfig();
  if (!cfg || tokens.length === 0) return out;
  const jwt = apnsProviderToken(cfg);
  if (!jwt) return out;

  const body = JSON.stringify({
    // A VoIP push has no `aps.alert` — iOS delivers it to PushKit, not to the
    // notification centre. Everything the shell needs is top-level data.
    callerName: payload.callerName,
    callerPin: payload.callerPin,
    roomId: payload.roomId,
    video: payload.video ? "1" : "0",
    kind: "incoming-call",
  });

  let session: http2.ClientHttp2Session | null = null;
  try {
    session = http2.connect(`https://${cfg.host}`);
    // A dial cannot wait on a wedged connection; the caller's own no-answer
    // backstop is the outer bound, but this must not hold it open either.
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("apns connect timeout")), 5000);
      session!.once("connect", () => { clearTimeout(t); resolve(); });
      session!.once("error", (e) => { clearTimeout(t); reject(e); });
    });

    await Promise.all(
      tokens.map(
        (token) =>
          new Promise<void>((resolve) => {
            let done = false;
            const finish = () => { if (!done) { done = true; resolve(); } };
            try {
              const req = session!.request({
                ":method": "POST",
                ":path": `/3/device/${token}`,
                "apns-topic": cfg.topic,
                // `voip` is the whole point: it is what reaches PushKit and what
                // lets iOS present CallKit on a locked device.
                "apns-push-type": "voip",
                // 10 = deliver immediately. A ring throttled to save battery is
                // a missed call.
                "apns-priority": "10",
                "apns-expiration": String(Math.floor(Date.now() / 1000) + VOIP_EXPIRY_SECONDS),
                authorization: `bearer ${jwt}`,
                "content-type": "application/json",
                "content-length": Buffer.byteLength(body),
              });
              let status = 0;
              let respBody = "";
              req.on("response", (h) => { status = Number(h[":status"]) || 0; });
              req.setEncoding("utf8");
              req.on("data", (c: string) => { respBody += c; });
              req.on("end", () => {
                if (status === 200) out.sent++;
                // 410 Gone = unregistered. 400 BadDeviceToken = not ours. Both mean
                // prune; anything else (429, 5xx, a network blip) leaves the token
                // ALONE, because destroying a registration over a transient failure
                // is the exact defect v2.105.11 fixed on the FCM path.
                else if (status === 410 || /BadDeviceToken|Unregistered/.test(respBody)) {
                  out.invalidTokens.push(token);
                }
                finish();
              });
              req.on("error", finish);
              const t = setTimeout(finish, 5000);
              req.once("close", () => clearTimeout(t));
              req.end(body);
            } catch {
              finish();
            }
          }),
      ),
    );
  } catch {
    /* unreachable APNs — the dial proceeds, the ring simply does not land */
  } finally {
    try { session?.close(); } catch { /* already gone */ }
  }
  return out;
}
