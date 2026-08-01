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
import { listPushSubscriptions, deletePushSubscription, pushEnabledForIdentity } from "./v2db";
import { sendFcmData } from "./fcm";
import { sendExpoPush } from "./expoPush";
import { sendVoipRing } from "./apnsVoip";
import { buildCallPush, type CallPushType } from "./callPushPayload";
import { appBaseUrl } from "./appUrl";

export interface PushPayload {
  kind: "incoming-call" | "missed-call" | "voicemail" | "contact-online" | "message";
  title: string;
  body?: string;
  /** Notification tag — same tag replaces instead of stacking. */
  tag?: string;
  /** App path to open on tap, e.g. "/app/dialer". */
  url?: string;
  /**
   * Ring-only, and only APNs VoIP reads it (v2.105.12). A VoIP push is NOT a
   * notification — iOS hands it to PushKit, which reports a real CallKit call —
   * so it needs the things an ANSWER requires rather than the things a banner
   * requires: who is calling, and the room to join. A title/body alone cannot be
   * answered.
   */
  call?: {
    callerName: string;
    callerPin: string;
    roomId: string;
    video: boolean;
    /** Absent is normal — the shell falls back to initials. Never blocks a ring. */
    callerAvatar?: string | null;
    /**
     * `incoming_call` (default) or `call_cancel`. A cancel rides the SAME kind and
     * therefore the SAME transports as the ring it stops — a cancel routed
     * differently could reach a device the ring never did, or miss the one it did.
     */
    type?: CallPushType;
  };
}

const b64url = (b: Buffer) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/**
 * SECURITY (S8): a Web Push `endpoint` is a client-supplied URL that the
 * `web-push` library connects to server-side (https.request). Without
 * validation, a caller could subscribe with an internal/arbitrary URL and turn
 * a later push into a blind SSRF (e.g. hitting a VPC service or the cloud
 * metadata endpoint). Restrict webpush endpoints to https on the KNOWN push
 * services. FCM subscriptions carry a bare device token (not a URL) and are
 * validated separately, so they bypass this.
 */
const WEBPUSH_HOST_SUFFIXES = [
  ".push.services.mozilla.com", // Firefox (updates.push.services.mozilla.com)
  ".notify.windows.com", // Edge / WNS (wns2-*.notify.windows.com)
  ".push.apple.com", // Safari (web.push.apple.com)
  ".googleapis.com", // Chrome FCM web push (fcm.googleapis.com, android.googleapis.com)
];
const WEBPUSH_HOST_EXACT = new Set([
  "fcm.googleapis.com",
  "android.googleapis.com",
  "web.push.apple.com",
  "updates.push.services.mozilla.com",
]);

export function isAllowedWebPushEndpoint(endpoint: string): boolean {
  let u: URL;
  try {
    u = new URL(endpoint);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  const host = u.hostname.toLowerCase();
  if (WEBPUSH_HOST_EXACT.has(host)) return true;
  return WEBPUSH_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

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

let cachedKeys: { publicKey: string; privateKey: string } | null = null;

/**
 * VAPID subject (RFC 8292 §2.1: a mailto: or https: contact URI). v2.92
 * (R4B/D1): no hardcoded deployment domain — VAPID_SUBJECT wins; otherwise the
 * app's ENV-derived https origin (APP_URL / DOMAIN — never anything learned
 * from traffic, which is spoofable) is the contact URI; with no env the
 * neutral placeholder stands. Computed per-call (unlike the keys, which stay
 * cached) so env added without a restart is picked up.
 */
export function vapidSubject(): string {
  if (process.env.VAPID_SUBJECT) return process.env.VAPID_SUBJECT;
  const base = appBaseUrl();
  if (base && base.startsWith("https://")) return base;
  return "mailto:admin@localhost";
}

/** Resolved VAPID config, or null when push can't be enabled (no secret at all). */
export function vapidConfig(): { publicKey: string; privateKey: string; subject: string } | null {
  const subject = vapidSubject();
  if (cachedKeys) return { ...cachedKeys, subject };
  const envPub = process.env.VAPID_PUBLIC_KEY;
  const envPriv = process.env.VAPID_PRIVATE_KEY;
  if (envPub && envPriv) {
    cachedKeys = { publicKey: envPub, privateKey: envPriv };
    return { ...cachedKeys, subject };
  }
  const secret = process.env.JWT_SECRET;
  if (!secret) return null;
  cachedKeys = deriveVapidKeys(secret);
  return { ...cachedKeys, subject };
}

/**
 * Send a push to EVERY subscription this identity has (multiple devices ring
 * together — first one to open the app wins the ring, like multi-device SMS).
 * Best-effort: failures never propagate; dead endpoints (404/410) are pruned.
 */
export async function sendPushToIdentity(identityId: number, payload: PushPayload): Promise<number> {
  // The user's master push switch (v2.99.40). Checked HERE, once, so every
  // caller and every future push kind honours it — a per-call-site check is the
  // kind that gets forgotten when a new notification is added. Reads NULL/true
  // as on and fails OPEN on DB trouble, so a hiccup can never silence a call.
  if (!(await pushEnabledForIdentity(identityId))) return 0;
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
      // THE CALL BLOCK WAS DROPPED HERE, AND ANDROID COULD NOT ANSWER (2026-08-01).
      // Only the APNs branch below read `payload.call`, so an FCM ring arrived
      // carrying `kind: "incoming-call"` and NO ROOM — the shell could render a
      // full-screen ring and then had nothing to join, which is worse than not
      // ringing because the user acts on it. The composed envelope is spread LAST
      // so `kind` resolves to the call discriminator rather than the notification
      // one; every value is already a string (see `buildCallPush`).
      ...(payload.kind === "incoming-call" && payload.call
        ? buildCallPush({ type: "incoming_call", nowMs: Date.now(), ...payload.call })
        : {}),
    });
    fcmDelivered = r.delivered;
    await Promise.all(r.invalidTokens.map(t => deletePushSubscription(t).catch(() => {})));
  }
  subs = subs.filter(s => s.kind !== "fcm");
  // EXPO (kind="expo"): the owner's shipping app is an Expo WebView shell, and
  // Expo's own push tokens are NOT FCM registration tokens — they must go through
  // Expo's service, which then talks to FCM/APNs with credentials uploaded to EAS.
  // Routing one to FCM drops it silently, so it gets its own transport (v2.99.79).
  const expoTokens = subs.filter(s => s.kind === "expo").map(s => s.endpoint);
  let expoDelivered = 0;
  if (expoTokens.length > 0) {
    const r = await sendExpoPush(expoTokens, {
      title: payload.title,
      body: payload.body ?? "",
      kind: payload.kind,
      data: {
        kind: payload.kind,
        title: payload.title,
        body: payload.body ?? "",
        tag: payload.tag ?? "",
        url: payload.url ?? "",
      },
    });
    expoDelivered = r.sent;
    // Only "DeviceNotRegistered" reaches `dead`; a transient failure must never
    // cost the user their registration.
    await Promise.all(r.dead.map(t => deletePushSubscription(t).catch(() => {})));
  }
  subs = subs.filter(s => s.kind !== "expo");
  // APNs VoIP (kind="apns-voip", v2.105.12; the kind narrowed in v2.105.13).
  // The endpoint IS the PushKit token. This is the ONLY transport that makes a
  // locked iPhone show the real full-screen CallKit call screen, and it is
  // deliberately RING-ONLY: a VoIP push carries no `aps.alert`, so iOS delivers
  // it to PushKit rather than the notification centre — using it for a message
  // would produce a notification nobody ever sees, and Apple terminates apps
  // that send VoIP pushes without reporting a call.
  //
  // IT MUST BE `apns-voip` AND NOT `apns`, and getting that wrong is destructive
  // rather than merely ineffective: iOS issues TWO hex tokens per device — the
  // PushKit one (topic `<bundle>.voip`) and the ordinary ALERT one (topic
  // `<bundle>`). A VoIP push sent to an ALERT token earns `BadDeviceToken`,
  // which this function then reads as stale and PRUNES — deleting the very row
  // v2.105.11 chose to keep so the admin push doctor could report it. So a plain
  // `apns` row stays inert and diagnosable, exactly as it was, and only a token
  // the shell explicitly declared as PushKit is ever rung.
  const apnsTokens = subs.filter(s => s.kind === "apns-voip").map(s => s.endpoint);
  let apnsDelivered = 0;
  if (apnsTokens.length > 0 && payload.kind === "incoming-call" && payload.call) {
    const r = await sendVoipRing(apnsTokens, payload.call);
    apnsDelivered = r.sent;
    // Prune ONLY what APNs reports as gone (410 / BadDeviceToken). A transient
    // failure must never cost somebody their registration — that is exactly the
    // defect v2.105.11 fixed on the FCM path, where a 400 was read as stale.
    await Promise.all(r.invalidTokens.map(t => deletePushSubscription(t).catch(() => {})));
  }
  // Both hex kinds leave the webpush list: `apns-voip` was just handled, and a
  // plain `apns` alert token is not a Web Push subscription and must never be
  // handed to the webpush sender.
  subs = subs.filter(s => s.kind !== "apns-voip" && s.kind !== "apns");
  const nativeDelivered = fcmDelivered + expoDelivered + apnsDelivered;
  const cfg = vapidConfig();
  if (!cfg) return nativeDelivered;
  if (subs.length === 0) return nativeDelivered;
  let webpush: typeof import("web-push");
  try {
    webpush = (await import("web-push")).default as unknown as typeof import("web-push");
  } catch (e) {
    console.warn("[push] web-push unavailable:", (e as Error)?.message);
    // Pre-existing, corrected in v2.99.79: this returned a bare 0, discarding
    // native deliveries that had ALREADY succeeded. Cosmetic today (every caller
    // is fire-and-forget) but the return value's whole meaning is "how many
    // devices got it", and this release adds a second contributor to that count.
    return nativeDelivered;
  }
  const body = JSON.stringify(payload);
  let delivered = nativeDelivered;
  // BOUNDED CONCURRENCY (v2.99.57). `Promise.all` over the whole list opened one
  // TLS connection and one ECDH + AES-GCM encryption per subscription
  // simultaneously. With the per-identity cap now in place that list is short, but
  // this is the second half of the same fix: a group fan-out multiplies it by the
  // number of recipients, and this is a 1GB single process that owns every call.
  const PUSH_CONCURRENCY = 5;
  const sendOne = async (s: (typeof subs)[number]) => {
      try {
        // Defense-in-depth (S8): never connect to a non-allowlisted host, even
        // if a legacy row predates the subscribe-time guard. Drop it.
        if (!isAllowedWebPushEndpoint(s.endpoint)) {
          await deletePushSubscription(s.endpoint).catch(() => {});
          return;
        }
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
  };
  // A fixed pool of workers drains the queue; every subscription is still
  // attempted, just never all at once.
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(PUSH_CONCURRENCY, subs.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= subs.length) return;
        await sendOne(subs[i]);
      }
    }),
  );
  return delivered;
}
