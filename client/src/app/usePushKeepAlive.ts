/**
 * Keep this device WAKEABLE for calls — silently, on every signed-in session.
 * ────────────────────────────────────────────────────────────────────────────
 * WHY (owner, "test — call me at 777777"): a call to a backgrounded or locked
 * phone only rings if the server has a push subscription to wake it. In
 * production the owner's own account had ZERO subscriptions, so a call to it fell
 * straight through to "they're offline" — the server's paging path is correct,
 * but it had nothing to page.
 *
 * The silent (re)subscribe already existed, but ONLY inside <PushBanner>, which
 * returns null in the native shell and self-dismisses on the web — so the effect
 * that keeps a device registered frequently never ran. This hook lifts that
 * keep-alive up to the app root so it runs for EVERY signed-in web/PWA session.
 *
 * It is safe to run unconditionally because it NEVER prompts: ensurePushSubscription
 * bails unless notification permission is ALREADY granted, and it reuses an
 * existing PushSubscription. So this only ever REPAIRS a missing row for a device
 * whose owner already opted in (permission granted) but whose server-side
 * subscription is absent — after a deploy, a browser update, or a cleared claim.
 * A device that never granted permission is untouched (the banner still offers
 * the opt-in from a user gesture, which is the only place a prompt may fire).
 *
 * Native shells are skipped: they ring over APNs/FCM with their own OS token, not
 * Web Push, and a WebView exposes no usable PushManager anyway.
 */
import { useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { ensurePushSubscription, pushSupported } from "./pushClient";
import { getNotifPermission } from "./notifications";
import { isNativeShell } from "./installSurface";

/**
 * Mount once, high in the signed-in tree. `enabled` gates on having a session so
 * we don't subscribe an anonymous visitor (the subscribe endpoint keys the row
 * to the current identity).
 */
export function usePushKeepAlive(enabled: boolean): void {
  // The VAPID key is a stable per-deploy value; fetch it once and never refetch.
  const pubKey = trpc.push.publicKey.useQuery(undefined, {
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    // No point asking for the key where Web Push can't be used at all.
    enabled: enabled && !isNativeShell() && pushSupported(),
  });
  const subscribe = trpc.push.subscribe.useMutation();

  useEffect(() => {
    if (!enabled) return;
    // Native shells use APNs/FCM, not Web Push.
    if (isNativeShell()) return;
    // No PushManager (a plain iOS Safari tab, or an old browser) → nothing to do.
    if (!pushSupported()) return;
    // NEVER prompt from here — only ensure the row when permission already exists.
    if (getNotifPermission() !== "granted") return;
    const key = pubKey.data?.key;
    if (!key) return;
    void ensurePushSubscription(key, (sub) => subscribe.mutateAsync(sub));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, pubKey.data?.key]);
}
