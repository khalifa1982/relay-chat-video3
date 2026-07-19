import { useEffect } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { getDeviceId } from "@/lib/deviceId";

/**
 * Owns the SINGLE presence heartbeat + go-offline beacon for the whole app.
 *
 * This used to live inside useIdentity(), so every call site (AppShell, Dialer,
 * OnboardingGate, …) spun up its own 30s heartbeat loop + unload listeners —
 * 3+ overlapping heartbeats writing the same presence row. Mounted once here
 * (above the router, so it survives tab navigation), it runs exactly one loop
 * while the user is in /app with a resolved identity.
 *
 * INSTANT OFFLINE (v2.89): leaving is reported with `navigator.sendBeacon` to
 * POST /api/v2/offline — a tRPC mutation fired during unload is routinely
 * dropped by the browser, which left a closed tab's LED green for up to 2
 * minutes until the reaper caught it. The beacon rides same-origin cookies;
 * the deviceId in the body is the same cookie-loss fallback the upload route
 * uses (beacons can't set the x-relay-device-id header). Fired on pagehide
 * AND visibilitychange→hidden (mobile Safari often fires ONLY the latter when
 * a tab is closed); returning to visible heartbeats immediately, so a mere
 * tab-switch flips right back online. The 2-min reaper stays as the backstop.
 */
export function PresenceManager() {
  const whoami = trpc.identity.whoami.useQuery(undefined, { staleTime: 30_000 });
  const [location] = useLocation();
  const inApp = location.startsWith("/app");
  const id = whoami.data?.id;
  const heartbeat = trpc.directory.heartbeat.useMutation();
  const goOffline = trpc.directory.goOffline.useMutation();

  useEffect(() => {
    if (!inApp || !id) return;
    let cancelled = false;
    const tick = () => {
      if (!cancelled) heartbeat.mutate();
    };
    tick();
    const interval = window.setInterval(tick, 30_000);
    const onLeave = () => {
      // sendBeacon is the ONLY channel the browser guarantees to flush after
      // the page is gone. Body: a plain JSON string (⇒ text/plain — Blob
      // content-types can trip beacon restrictions), carrying the deviceId
      // fallback for cookie-less guests.
      try {
        const payload = JSON.stringify({ deviceId: getDeviceId() });
        if (navigator.sendBeacon?.("/api/v2/offline", payload)) return;
      } catch {
        /* fall through to the best-effort mutation */
      }
      try {
        goOffline.mutate();
      } catch {
        /* ignore */
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") onLeave();
      else if (!cancelled) heartbeat.mutate(); // back → online instantly
    };
    window.addEventListener("pagehide", onLeave);
    window.addEventListener("beforeunload", onLeave);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("pagehide", onLeave);
      window.removeEventListener("beforeunload", onLeave);
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inApp, id]);

  return null;
}
