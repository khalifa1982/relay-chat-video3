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
import { syncAlertPrefsToSw } from "./swPrefs";

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
  /** Proof-of-possession for a re-bind (v2.99.49). See readOrMintClaim. */
  claim?: string;
}

/** localStorage key for the push claim. Deliberately NOT cleared on sign-out
 *  (see useSignOut): it identifies the BROWSER PROFILE that owns this push
 *  subscription, not an identity — and keeping it across sign-out is precisely
 *  what lets the same device re-bind its endpoint to a second account. */
const CLAIM_KEY = "relay_push_claim";

/**
 * Read, or mint once, this browser's push claim (v2.99.49).
 *
 * Closes the residual where anyone who learned a push endpoint could re-point it
 * at their own identity and silently kill the owner's notifications. The endpoint
 * alone was the only key, and it isn't a secret in the "can't be leaked" sense.
 *
 * Why not the existing device id: it lives in sessionStorage and is reset on
 * every sign-out, so it is strictly shorter-lived than a PushSubscription and
 * would differ on exactly the account switch this has to keep working.
 *
 * Takes a store so it can be unit-tested without a DOM. Returns null when
 * storage is unavailable (private mode) — the server then falls back to the
 * legacy keys-match path, so nothing breaks.
 */
export function readOrMintClaim(
  store: Pick<Storage, "getItem" | "setItem"> | undefined = typeof localStorage !== "undefined"
    ? localStorage
    : undefined
): string | null {
  if (!store) return null;
  try {
    const existing = store.getItem(CLAIM_KEY);
    if (existing && /^[a-f0-9]{32,64}$/.test(existing)) return existing;
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    const minted = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    store.setItem(CLAIM_KEY, minted);
    return minted;
  } catch {
    return null;
  }
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
  // Seed the worker's copy of this device's mute/DND state before any push can
  // arrive (v2.99.42). Both are localStorage settings the worker can't read, and
  // a message push reaches the OS without going through the page — so without
  // this the very first muted-thread message would still buzz the phone.
  syncAlertPrefsToSw();
  try {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as unknown as BufferSource,
      });
    }
    const claim = readOrMintClaim() ?? undefined;
    const j = sub.toJSON();
    if (!j.endpoint || !j.keys?.p256dh || !j.keys?.auth) return false;
    const res = (await save({
      endpoint: j.endpoint,
      keys: { p256dh: j.keys.p256dh, auth: j.keys.auth },
      claim,
    })) as { owned?: boolean } | undefined;

    // SELF-HEAL (v2.99.49). `owned: false` means this endpoint is registered to a
    // different identity and we couldn't prove possession — e.g. this browser lost
    // its claim (cleared storage) after a previous account registered the same
    // endpoint. Rather than leave the user silently unnotifiable, rotate: drop the
    // subscription and take a FRESH endpoint, which has no prior owner. This is
    // what makes the server's refusal safe to ship — the strict gate can never
    // strand anybody.
    if (res && res.owned === false) {
      try {
        await sub.unsubscribe();
        const fresh = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as unknown as BufferSource,
        });
        const fj = fresh.toJSON();
        if (!fj.endpoint || !fj.keys?.p256dh || !fj.keys?.auth) return false;
        await save({
          endpoint: fj.endpoint,
          keys: { p256dh: fj.keys.p256dh, auth: fj.keys.auth },
          claim,
        });
      } catch {
        // Rotation failed — no worse off than before, and the next app open retries.
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}
