import { useCallback, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { getDeviceId } from "@/lib/deviceId";

/**
 * Hook for v2.0 phone-app identity.
 *
 * - `me`: the current identity (guest or registered) or null.
 * - `loading`: still resolving whoami.
 * - `startGuest`: pick a guest display-name; server pins it for 30 days
 *   via an HttpOnly cookie and returns a fresh 6-digit number.
 * - Heartbeat: every 30 seconds when an identity exists, we call
 *   `directory.heartbeat` so the user appears online to peers.
 */
export function useIdentity() {
  const utils = trpc.useUtils();
  const me = trpc.identity.whoami.useQuery(undefined, {
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  });
  const startGuestMutation = trpc.identity.startGuest.useMutation({
    onSuccess: () => utils.identity.whoami.invalidate(),
  });
  const signOutMutation = trpc.identity.signOutGuest.useMutation({
    onSuccess: () => utils.identity.whoami.invalidate(),
  });
  const heartbeatMutation = trpc.directory.heartbeat.useMutation();
  const goOfflineMutation = trpc.directory.goOffline.useMutation();

  const startGuest = useCallback(
    (displayName: string) =>
      startGuestMutation.mutateAsync({
        displayName,
        // Belt-and-suspenders: also pass the device id in the body. The
        // tRPC client already attaches `x-relay-device-id`, but the
        // explicit input lets the server log it and survives if a
        // proxy ever strips custom headers.
        deviceId: getDeviceId(),
      }),
    [startGuestMutation]
  );

  const signOut = useCallback(() => signOutMutation.mutateAsync(), [signOutMutation]);

  // Heartbeat loop while an identity exists.
  useEffect(() => {
    if (!me.data) return;
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      heartbeatMutation.mutate();
    };
    tick();
    const interval = window.setInterval(tick, 30_000);
    const onBeforeUnload = () => {
      try {
        goOfflineMutation.mutate();
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("pagehide", onBeforeUnload);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("pagehide", onBeforeUnload);
    };
    // We intentionally do not depend on the mutation objects (stable enough);
    // depending on them causes the interval to be reset on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me.data?.id]);

  return {
    me: me.data ?? null,
    loading: me.isLoading,
    error: me.error,
    startGuest,
    signOut,
    startGuestPending: startGuestMutation.isPending,
    startGuestError: startGuestMutation.error,
    refresh: () => utils.identity.whoami.invalidate(),
  };
}
