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
 * uses (beacons can't set the x-relay-device-id header).
 *
 * MINIMISING IS IDLE, NOT OFFLINE (v2.99.92). Owner: *"whenever you minimize the
 * app, the user showing offline, not the idle."* The offline beacon used to fire on
 * `visibilitychange → hidden` as well as `pagehide`, so switching apps for five
 * seconds told every contact you had left. Now:
 *
 *   hidden        → `markIdle` + a SLOW idle beat, so the person reads "away" and
 *                   the row keeps its `lastSeenAt` fresh. Without that beat the
 *                   2-minute reaper would take a minimised-but-open app offline,
 *                   which is the bug rather than the fix.
 *   visible again → the ordinary heartbeat, which clears idle in the same write.
 *   pagehide /    → the offline beacon, exactly as before.
 *   beforeunload
 *
 * THE COST, stated rather than hidden: on mobile Safari a real tab CLOSE often
 * fires only `visibilitychange`, so such a close now reads "away" for up to two
 * minutes instead of going offline at once. That is the trade — a wrong "offline"
 * every time somebody checks another app, against a slightly late "offline" when
 * they close the tab on one browser. The reaper still converges it.
 */
export function PresenceManager() {
  const whoami = trpc.identity.whoami.useQuery(undefined, { staleTime: 30_000 });
  const [location] = useLocation();
  const inApp = location.startsWith("/app");
  const id = whoami.data?.id;
  const heartbeat = trpc.directory.heartbeat.useMutation();
  const goOffline = trpc.directory.goOffline.useMutation();
  const markIdle = trpc.directory.markIdle.useMutation();
  // A stable per-tab id for the M12 multi-tab ref-count (see tabPresence.ts).
  const tabIdRef = useRef<string>("");

  useEffect(() => {
    if (!inApp || !id) return;
    let cancelled = false;
    if (!tabIdRef.current) tabIdRef.current = makeTabId();
    const tabId = tabIdRef.current;
    const tick = () => {
      if (cancelled) return;
      // QA H6: never heartbeat a HIDDEN tab. `heartbeat` calls `markOnline`, which
      // clears idle AND can fire the "X is back online" watcher push — so a blind
      // 30s beat while backgrounded would undo the idle state this manager just set
      // and notify every watcher that somebody came back who never left. The
      // hidden case has its own beat (`idleTick`), and the visibilitychange handler
      // heartbeats the instant we return to visible, so nothing is lost.
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      heartbeat.mutate();
      touchTab(id, tabId, Date.now()); // M12: record this tab as live
    };
    tick();
    const interval = window.setInterval(tick, 30_000);
    /**
     * The IDLE beat (v2.99.92). Runs only while the tab is HIDDEN, and it is what
     * keeps a minimised-but-open app reading "away" instead of decaying to offline:
     * `markIdle` refreshes `lastSeenAt`, so the 2-minute reaper leaves the row alone
     * while the app is genuinely still there.
     *
     * A SEPARATE endpoint from `heartbeat`, not a flag on it, and that is the whole
     * point: `heartbeat` calls `markOnline`, which clears idle and can fire the
     * "X is back online" watcher push. Reusing it while hidden is exactly the bug
     * v2.99.25/H6 fixed, and this loop would have reintroduced it.
     *
     * 60s rather than 30s — a backgrounded app has nothing to show, so the only job
     * is staying inside the reaper's window, and a browser throttles background
     * timers anyway.
     */
    const idleTick = () => {
      if (cancelled) return;
      if (typeof document === "undefined" || document.visibilityState !== "hidden") return;
      // Another VISIBLE tab of this identity means the person IS looking at RELAY —
      // marking idle would report the whole identity away because one tab is
      // buried. `touchTab` only records on visible beats, so this is the same
      // ref-count that governs the offline beacon (M12).
      if (otherTabsAlive(id, tabId, Date.now())) return;
      markIdle.mutate();
    };
    const idleInterval = window.setInterval(idleTick, 60_000);
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
    /**
     * A real CLOSE. Its `closing` parameter is gone (v2.99.92): the only other
     * caller was `visibilitychange → hidden`, which now marks idle instead, so the
     * false branch had become unreachable — and an unreachable branch in a presence
     * path is how the wrong one gets taken later.
     */
    const onLeave = () => {
      const now = Date.now();
      removeTab(id, tabId, now); // free my slot first
      // M12: another live tab of this identity keeps presence — do NOT beacon
      // offline (else contacts blink offline and the surviving tab's next
      // heartbeat fires a false "back online" watcher push). A single tab (no
      // others) still beacons instantly; a storage error fails safe to a beacon.
      if (otherTabsAlive(id, tabId, now)) return;
      beaconOffline();
    };
    const onVisibility = () => {
      // HIDDEN IS IDLE, NOT GONE (v2.99.92). This used to call `onLeave(false)`,
      // which beaconed OFFLINE — the owner's report. `onLeave` is now reserved for
      // an actual close.
      if (document.visibilityState === "hidden") idleTick();
      else if (!cancelled) {
        heartbeat.mutate(); // back → online instantly, and idle is cleared with it
        touchTab(id, tabId, Date.now());
      }
    };
    const onClose = () => onLeave();
    window.addEventListener("pagehide", onClose);
    window.addEventListener("beforeunload", onClose);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.clearInterval(idleInterval);
      window.removeEventListener("pagehide", onClose);
      window.removeEventListener("beforeunload", onClose);
      document.removeEventListener("visibilitychange", onVisibility);
      removeTab(id, tabId, Date.now()); // leaving /app — free my slot
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inApp, id]);

  return null;
}
