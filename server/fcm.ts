/**
 * Firebase Cloud Messaging sender (v2.86) — wakes the NATIVE Android app.
 *
 * The native RELAY Android app (mobile/app) cannot receive Web Push (Android
 * WebViews have no Push API); it registers an FCM device token instead
 * (push_subscriptions.kind = "fcm"). This module delivers the same
 * incoming-call / missed-call payloads to those tokens as DATA messages, so
 * the app's RelayFcmService controls presentation (full-screen ring) even
 * when the app is completely closed.
 *
 * Config: the service-account key JSON from Firebase console → Project settings
 * → Service accounts → Generate new private key, supplied EITHER as
 * FIREBASE_SERVICE_ACCOUNT_JSON or as GOOGLE_APPLICATION_CREDENTIALS, and in
 * either case as the JSON itself OR a path to it. Unset ⇒ FCM sends are skipped
 * (Web Push still works). See `fcmConfig` for why both names are read.
 *
 * Zero dependencies: the OAuth2 access token is minted by signing a JWT with
 * node:crypto (RS256) and exchanging it at Google's token endpoint.
 */
import crypto from "crypto";
import fs from "fs";
import { CALL_PUSH_EXPIRY_SECONDS } from "./callPushPayload";

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

/**
 * Read the service account, and PROVE THE KEY CAN SIGN before calling it configured.
 *
 * ── WHY THE PARSE (v2.105.17) ────────────────────────────────────────────────
 * This used to gate on TRUTHINESS alone: any non-empty `private_key` made
 * `fcmConfig()` non-null, so `admin.pushDiagnostics` reported `fcm: true` and the
 * Push Doctor rendered a green "Firebase is configured on the server" row — while
 * `sendFcmData` returned `{delivered: 0, invalidTokens: []}`, which is BYTE-IDENTICAL
 * to having no credential at all, and logged nothing.
 *
 * THE TRIGGER IS THE SINGLE MOST COMMON FIREBASE MISCONFIGURATION: a service-account
 * JSON whose `private_key` carries LITERAL backslash-n instead of real newlines. It
 * is what you get from most copy-paste routes, it parses as JSON perfectly, and it
 * cannot sign. So the transport the owner reported broken ("i have problem with
 * firebase to send the notification") had a diagnostic that said it was fine.
 *
 * `\n`-escaped keys are REPAIRED rather than refused, because that form is so common
 * that refusing it would send an operator hunting for a problem they cannot see — and
 * the repair is unambiguous: a real PEM never contains a literal backslash-n.
 * Anything still unloadable after that is reported NOT configured, which is the loud,
 * recoverable direction: the doctor then says "Firebase is NOT configured".
 */
export function fcmConfig(): ServiceAccount | null {
  const raw = readServiceAccountJson();
  if (!raw) return null;
  try {
    const j = JSON.parse(raw) as Partial<ServiceAccount>;
    const projectId = (j.project_id || "").trim();
    const clientEmail = (j.client_email || "").trim();
    let privateKey = (j.private_key || "").trim();
    if (!projectId || !clientEmail || !privateKey) return null;
    // The common copy-paste damage, repaired: literal \n → real newlines.
    if (privateKey.includes("\\n")) privateKey = privateKey.replace(/\\n/g, "\n");
    try {
      crypto.createPrivateKey(privateKey);
    } catch {
      // Non-empty but unsignable. Reporting NOT configured is the honest answer; the
      // alternative is the green row above with nothing behind it.
      return null;
    }
    warnOnProjectIdMismatch(projectId);
    return { project_id: projectId, client_email: clientEmail, private_key: privateKey };
  } catch {
    return null;
  }
}

/**
 * Resolve the service-account JSON from either variable, in either shape.
 *
 * ── WHY TWO NAMES (2026-08-01) ───────────────────────────────────────────────
 * The owner staged the credential on both app instances as
 * `GOOGLE_APPLICATION_CREDENTIALS=/home/relay/fcm-sa.json` — the name Google's own
 * client libraries read — and proved the pipe end to end (OAuth mint OK, FCM v1
 * answered the project). This module read only `FIREBASE_SERVICE_ACCOUNT_JSON`, so
 * on that fleet `fcmConfig()` returned null: every Android push was skipped and the
 * admin Push Doctor said "Firebase is NOT configured" over a credential that was
 * sitting right there and worked. A staged-and-proven credential the code cannot see
 * is the same class of silent failure v2.105.17 exists to remove, one layer out.
 *
 * ── WHY THE SHAPE DECIDES, NOT THE NAME ──────────────────────────────────────
 * Either variable may hold the JSON itself or a path to it: inline is what a `.env`
 * can carry, a path is what a mounted secret looks like, and guessing wrong either
 * way is a silent misconfiguration — the reasoning `readPem` already records for
 * `APNS_P8_KEY`. A value starting with `{` is content; anything else is a path.
 *
 * `FIREBASE_SERVICE_ACCOUNT_JSON` is tried FIRST so every deployment that works
 * today is byte-identical; the fleet's variable is the fallback, which is the
 * direction that can only ever add a working configuration.
 *
 * Read per call, like every other config reader here (`apnsVoipConfig`,
 * `iceServers`), so a corrected path takes effect without a restart. The file read
 * is microseconds against an OAuth round trip that is already cached for ~50 min.
 */
function readServiceAccountJson(): string | null {
  for (const name of ["FIREBASE_SERVICE_ACCOUNT_JSON", "GOOGLE_APPLICATION_CREDENTIALS"]) {
    const v = (process.env[name] || "").trim();
    if (!v) continue;
    if (v.startsWith("{")) return v;
    try {
      const body = fs.readFileSync(v, "utf8").trim();
      if (body.startsWith("{")) return body;
    } catch {
      /* unreadable path — fall through to the next name, then to "not configured" */
    }
  }
  return null;
}

let warnedProjectMismatch = false;

/**
 * `FCM_PROJECT_ID` is a CROSS-CHECK, never an override.
 *
 * The access token is minted by the service account, so it is only valid for that
 * account's own project — pointing the send URL at a different project id would
 * produce a 403 on every push with nothing saying why. So the JSON wins and a
 * disagreement is reported once, because it means somebody has two projects'
 * settings mixed together and no push will ever arrive until that is resolved.
 */
function warnOnProjectIdMismatch(projectId: string): void {
  const declared = (process.env.FCM_PROJECT_ID || "").trim();
  if (!declared || declared === projectId || warnedProjectMismatch) return;
  warnedProjectMismatch = true;
  console.warn(
    `[fcm] FCM_PROJECT_ID=${declared} disagrees with the service account's own project_id=${projectId}. ` +
      `Using ${projectId} (the token is only valid for that project). Fix the mismatch: one of the two is wrong.`
  );
}

const b64url = (b: Buffer | string) =>
  Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** Build + sign the OAuth2 JWT assertion (pure — unit-testable). */
export function buildFcmAssertion(sa: ServiceAccount, nowSec: number): string {
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: "https://oauth2.googleapis.com/token",
      iat: nowSec,
      exp: nowSec + 3600,
    })
  );
  const unsigned = `${header}.${claims}`;
  const sig = crypto.createSign("RSA-SHA256").update(unsigned).sign(sa.private_key);
  return `${unsigned}.${b64url(sig)}`;
}

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(sa: ServiceAccount): Promise<string | null> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.token;
  try {
    const assertion = buildFcmAssertion(sa, Math.floor(Date.now() / 1000));
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }).toString(),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!j.access_token) return null;
    cachedToken = { token: j.access_token, expiresAt: Date.now() + (j.expires_in ?? 3600) * 1000 };
    return j.access_token;
  } catch {
    return null;
  }
}

export interface FcmSendResult {
  delivered: number;
  /** Tokens the push service reported dead — prune their subscriptions. */
  invalidTokens: string[];
}

/**
 * Does this refusal mean the TOKEN is dead, or that OUR MESSAGE was wrong?
 *
 * ── WHY THIS IS NOT `status === 400 || status === 404` (2026-08-01) ──────────
 * It was, and that is a self-deregistering failure: FCM answers 400
 * INVALID_ARGUMENT for a MALFORMED MESSAGE as readily as for a malformed token —
 * a non-string `data` value, an unknown field, a bad `ttl` — so one bad payload
 * from us would have pruned every Android registration in the fleet, in parallel,
 * on the first push after the deploy. The devices then never ring again and
 * nothing anywhere says why; the only repair is each user re-registering.
 *
 * That is exactly the shape v2.105.13 fixed for APNs, where sending a VoIP push to
 * an alert token earned `BadDeviceToken`, was read as stale, and destroyed the
 * registration. Prune on evidence about the TOKEN, never on a status code that two
 * different faults share.
 *
 * So: 404/UNREGISTERED always (the token is gone — that is what it means, and it is
 * the only case the push spec asks us to prune), and a 400 only when the response
 * actually names the registration token. Anything else is kept and logged, which is
 * the recoverable direction — a stale token costs one wasted request per push until
 * it 404s, while a wrongly-pruned live token costs that user every call.
 */
export function tokenIsDead(status: number, body: string): boolean {
  if (status === 404 || /UNREGISTERED/.test(body)) return true;
  if (status !== 400) return false;
  // FCM's own wording for a token it cannot parse; a malformed MESSAGE names the
  // offending field instead (e.g. "Invalid JSON payload received. Unknown name ...").
  return /registration token|not a valid FCM registration token|InvalidRegistration/i.test(body);
}

/**
 * Send a DATA message to each FCM token. Payload values must be strings
 * (FCM data-message contract). Best-effort; never throws.
 */
export async function sendFcmData(
  tokens: string[],
  data: Record<string, string>
): Promise<FcmSendResult> {
  const out: FcmSendResult = { delivered: 0, invalidTokens: [] };
  const sa = fcmConfig();
  if (!sa || tokens.length === 0) return out;
  const access = await getAccessToken(sa);
  if (!access) return out;
  const url = `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`;
  await Promise.all(
    tokens.map(async token => {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            message: {
              token,
              data,
              // A ring's TTL is the SHARED bound, not a literal chosen here: this
              // line carried a bare "70s" while APNs carried 45, so one event had
              // two lifetimes and an iPhone reconnecting at t=50s got nothing
              // where an Android rang. Everything that is not a ring keeps the
              // long TTL — a message or a missed-call notice is still worth
              // delivering an hour later, which a ring is not.
              android: {
                priority: "HIGH",
                ttl:
                  data.kind === "incoming-call"
                    ? `${CALL_PUSH_EXPIRY_SECONDS}s`
                    : "3600s",
              },
            },
          }),
        });
        if (res.ok) {
          out.delivered++;
          return;
        }
        const body = await res.text().catch(() => "");
        if (tokenIsDead(res.status, body)) out.invalidTokens.push(token);
        else if (res.status === 400) {
          // Loud, because this is almost always OUR payload rather than their token,
          // and it is invisible otherwise: the send just returns delivered: 0.
          console.warn(`[fcm] refused (400) and the token was KEPT: ${body.slice(0, 300)}`);
        }
      } catch {
        /* transient network failure — leave the token alone */
      }
    })
  );
  return out;
}
