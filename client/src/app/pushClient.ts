/**
 * Web Push client plumbing (v2.83).
 *
 * The server can WAKE this device for an incoming call (paging) or a missed
 * call even when no tab is alive — but only after the browser grants
 * notification permission and we register a PushSubscription with the server.
 *
 * Platform notes:
 *   • Android Chrome + all desktop browsers: works in any tab.
 *   • iPhone/iPad: Apple only exposes Web Push to HOME-SCREEN-INSTALLED web
 *     apps on iOS 16.4+ — a plain Safari tab has no PushManager at all. For
 *     that case the UI shows an "Add to Home Screen" tip instead of a broken
 *     enable button.
 */

export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    typeof Notification !== "undefined"
  );
}

export function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  // iPadOS 13+ reports as Mac; the touch-points check catches it.
  return /iPhone|iPad|iPod/.test(ua) || (/Mac/.test(ua) && (navigator.maxTouchPoints || 0) > 2);
}

/** iOS device where push is impossible UNTIL the user installs to Home Screen. */
export function iosNeedsInstallForPush(): boolean {
  if (!isIos()) return false;
  const standalone =
    (typeof window !== "undefined" &&
      (window.matchMedia?.("(display-mode: standalone)")?.matches ||
        (navigator as unknown as { standalone?: boolean }).standalone === true)) ||
    false;
  return !standalone && !pushSupported();
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export interface PushSubscriptionPayload {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/**
 * Idempotently make sure this browser has a push subscription registered with
 * the server. Safe to call on every app load: reuses an existing subscription,
 * no-ops without permission/support/key. Returns true when a subscription is
 * (now) registered.
 */
export async function ensurePushSubscription(
  vapidPublicKey: string | null | undefined,
  save: (sub: PushSubscriptionPayload) => Promise<unknown>,
): Promise<boolean> {
  if (!pushSupported() || !vapidPublicKey) return false;
  if (Notification.permission !== "granted") return false;
  try {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as unknown as BufferSource,
      });
    }
    const j = sub.toJSON();
    if (!j.endpoint || !j.keys?.p256dh || !j.keys?.auth) return false;
    await save({ endpoint: j.endpoint, keys: { p256dh: j.keys.p256dh, auth: j.keys.auth } });
    return true;
  } catch {
    return false;
  }
}
