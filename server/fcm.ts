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
 * Config: FIREBASE_SERVICE_ACCOUNT_JSON — the full service-account key JSON
 * from Firebase console → Project settings → Service accounts → Generate new
 * private key. Unset ⇒ FCM sends are skipped (Web Push still works).
 *
 * Zero dependencies: the OAuth2 access token is minted by signing a JWT with
 * node:crypto (RS256) and exchanging it at Google's token endpoint.
 */
import crypto from "crypto";

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
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
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
    return { project_id: projectId, client_email: clientEmail, private_key: privateKey };
  } catch {
    return null;
  }
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
              android: { priority: "HIGH", ttl: data.kind === "incoming-call" ? "70s" : "3600s" },
            },
          }),
        });
        if (res.ok) {
          out.delivered++;
          return;
        }
        // UNREGISTERED / INVALID_ARGUMENT with a stale token → prune.
        if (res.status === 404 || res.status === 400) out.invalidTokens.push(token);
      } catch {
        /* transient network failure — leave the token alone */
      }
    })
  );
  return out;
}
