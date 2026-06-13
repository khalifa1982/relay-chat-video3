import { useEffect } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";

/**
 * Owns the SINGLE presence heartbeat + go-offline beacon for the whole app.
 *
 * This used to live inside useIdentity(), so every call site (AppShell, Dialer,
 * OnboardingGate, …) spun up its own 30s heartbeat loop + unload listeners —
 * 3+ overlapping heartbeats writing the same presence row. Mounted once here
 * (above the router, so it survives tab navigation), it runs exactly one loop
 * while the user is in /app with a resolved identity.
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
      try {
        goOffline.mutate();
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("pagehide", onLeave);
    window.addEventListener("beforeunload", onLeave);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("pagehide", onLeave);
      window.removeEventListener("beforeunload", onLeave);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inApp, id]);

  return null;
}
