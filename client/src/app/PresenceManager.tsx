import { useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { getDeviceId } from "@/lib/deviceId";
import { makeTabId, touchTab, removeTab, otherTabsAlive } from "./tabPresence";

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
  // A stable per-tab id for the M12 multi-tab ref-count (see tabPresence.ts).
  const tabIdRef = useRef<string>("");

  useEffect(() => {
    if (!inApp || !id) return;
    let cancelled = false;
    if (!tabIdRef.current) tabIdRef.current = makeTabId();
    const tabId = tabIdRef.current;
    const tick = () => {
      if (cancelled) return;
      // QA H6: never heartbeat a HIDDEN tab. onLeave (visibilitychange→hidden)
      // already marked us offline; a blind 30s heartbeat would re-mark us online
      // — flipping presence back on and firing false "X is back online" pushes to
      // every watcher while the tab is still backgrounded. The visibilitychange
      // handler re-heartbeats the instant we return to visible, so nothing is lost.
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      heartbeat.mutate();
      touchTab(id, tabId, Date.now()); // M12: record this tab as live
    };
    tick();
    const interval = window.setInterval(tick, 30_000);
    const beaconOffline = () => {
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
    const onLeave = (closing: boolean) => {
      const now = Date.now();
      if (closing) removeTab(id, tabId, now); // real close/unmount — free my slot first
      // M12: another live tab of this identity keeps presence — do NOT beacon
      // offline (else contacts blink offline and the surviving tab's next
      // heartbeat fires a false "back online" watcher push). A single tab (no
      // others) still beacons instantly; a storage error fails safe to a beacon.
      if (otherTabsAlive(id, tabId, now)) return;
      beaconOffline();
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") onLeave(false);
      else if (!cancelled) {
        heartbeat.mutate(); // back → online instantly
        touchTab(id, tabId, Date.now());
      }
    };
    const onClose = () => onLeave(true);
    window.addEventListener("pagehide", onClose);
    window.addEventListener("beforeunload", onClose);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("pagehide", onClose);
      window.removeEventListener("beforeunload", onClose);
      document.removeEventListener("visibilitychange", onVisibility);
      removeTab(id, tabId, Date.now()); // leaving /app — free my slot
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inApp, id]);

  return null;
}
