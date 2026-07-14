/**
 * Web Push sender (v2.83) — wakes devices that have NO live SSE connection.
 *
 * Two payload kinds today, both consumed by client/public/sw.js:
 *   • incoming-call paging — "X is calling you, open RELAY to answer"
 *     (fired from the relay invite path when the callee is unreachable; the
 *     signaling server keeps the dial alive and redelivers the ring when the
 *     callee's app opens — see deliverPendingRing in server/relay.ts)
 *   • missed-call notice — "Missed call from X", deep-links the Missed log
 *
 * VAPID keys: set VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY (base64url) to bring
 * your own. Without them, a STABLE keypair is DERIVED from JWT_SECRET —
 * deterministic across restarts and instances, so subscriptions never
 * invalidate on redeploy and no new secret needs provisioning. VAPID_SUBJECT
 * (default mailto:) identifies the sender to push services.
 *
 * Platform support: Android Chrome + all desktop browsers work everywhere;
 * iOS/iPadOS 16.4+ receive push ONLY as a Home-Screen-installed web app
 * (Apple's restriction — a plain Safari tab cannot be pushed).
 */
import crypto from "crypto";
import { listPushSubscriptions, deletePushSubscription } from "./v2db";
import { sendFcmData } from "./fcm";

export interface PushPayload {
  kind: "incoming-call" | "missed-call";
  title: string;
  body?: string;
  /** Notification tag — same tag replaces instead of stacking. */
  tag?: string;
  /** App path to open on tap, e.g. "/app/dialer". */
  url?: string;
}

const b64url = (b: Buffer) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** P-256 group order (the private scalar must be in [1, n-1]). */
const P256_N = BigInt("0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551");

/**
 * Derive a valid, deterministic P-256 keypair from a secret. SHA-256 of the
 * (namespaced, counter-suffixed) secret is the private scalar; the counter
 * bumps in the astronomically unlikely case the hash falls outside [1, n-1].
 * Same secret ⇒ same keys, forever — the property that keeps existing browser
 * subscriptions valid across restarts/instances.
 */
export function deriveVapidKeys(secret: string): { publicKey: string; privateKey: string } {
  for (let counter = 0; ; counter++) {
    const digest = crypto.createHash("sha256").update(`relay-vapid-v1:${counter}:${secret}`).digest();
    const d = BigInt("0x" + digest.toString("hex"));
    if (d > BigInt(0) && d < P256_N) {
      const priv = Buffer.from(d.toString(16).padStart(64, "0"), "hex");
      const ecdh = crypto.createECDH("prime256v1");
      ecdh.setPrivateKey(priv);
      const pub = ecdh.getPublicKey(); // 65-byte uncompressed point (0x04 …)
      return { publicKey: b64url(pub), privateKey: b64url(priv) };
    }
  }
}

let cached: { publicKey: string; privateKey: string; subject: string } | null = null;

/** Resolved VAPID config, or null when push can't be enabled (no secret at all). */
export function vapidConfig(): { publicKey: string; privateKey: string; subject: string } | null {
  if (cached) return cached;
  const subject = process.env.VAPID_SUBJECT || "mailto:notifications@your-chat.org";
  const envPub = process.env.VAPID_PUBLIC_KEY;
  const envPriv = process.env.VAPID_PRIVATE_KEY;
  if (envPub && envPriv) {
    cached = { publicKey: envPub, privateKey: envPriv, subject };
    return cached;
  }
  const secret = process.env.JWT_SECRET;
  if (!secret) return null;
  cached = { ...deriveVapidKeys(secret), subject };
  return cached;
}

/**
 * Send a push to EVERY subscription this identity has (multiple devices ring
 * together — first one to open the app wins the ring, like multi-device SMS).
 * Best-effort: failures never propagate; dead endpoints (404/410) are pruned.
 */
export async function sendPushToIdentity(identityId: number, payload: PushPayload): Promise<number> {
  let subs: Array<{ endpoint: string; p256dh: string; auth: string; kind?: string | null }>;
  try {
    subs = await listPushSubscriptions(identityId);
  } catch {
    return 0;
  }
  if (subs.length === 0) return 0;
  // NATIVE ANDROID (kind="fcm"): the endpoint IS the FCM device token; deliver
  // the same payload as a data message so RelayFcmService renders the
  // full-screen ring / notification even with the app closed.
  const fcmTokens = subs.filter(s => s.kind === "fcm").map(s => s.endpoint);
  let fcmDelivered = 0;
  if (fcmTokens.length > 0) {
    const r = await sendFcmData(fcmTokens, {
      kind: payload.kind,
      title: payload.title,
      body: payload.body ?? "",
      tag: payload.tag ?? "",
      url: payload.url ?? "",
    });
    fcmDelivered = r.delivered;
    await Promise.all(r.invalidTokens.map(t => deletePushSubscription(t).catch(() => {})));
  }
  subs = subs.filter(s => s.kind !== "fcm");
  const cfg = vapidConfig();
  if (!cfg) return fcmDelivered;
  if (subs.length === 0) return fcmDelivered;
  let webpush: typeof import("web-push");
  try {
    webpush = (await import("web-push")).default as unknown as typeof import("web-push");
  } catch (e) {
    console.warn("[push] web-push unavailable:", (e as Error)?.message);
    return 0;
  }
  const body = JSON.stringify(payload);
  let delivered = fcmDelivered;
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          body,
          {
            vapidDetails: { subject: cfg.subject, publicKey: cfg.publicKey, privateKey: cfg.privateKey },
            // A call page is useless once the ring window has passed.
            TTL: payload.kind === "incoming-call" ? 70 : 3600,
            urgency: "high",
          },
        );
        delivered++;
      } catch (e) {
        const code = (e as { statusCode?: number })?.statusCode;
        if (code === 404 || code === 410) {
          // Subscription expired/revoked — prune so we stop paying for it.
          await deletePushSubscription(s.endpoint).catch(() => {});
        }
      }
    }),
  );
  return delivered;
}
