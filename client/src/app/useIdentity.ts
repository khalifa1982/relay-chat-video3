import { useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { getDeviceId } from "@/lib/deviceId";

/**
 * Hook for v2.0 phone-app identity — a PURE READ (whoami + start/sign-out).
 *
 * - `me`: the current identity (guest or registered) or null.
 * - `loading`: still resolving whoami.
 * - `startGuest`: pick a guest display-name; server pins it for 30 days
 *   via an HttpOnly cookie and returns a fresh 6-digit number.
 *
 * NOTE: the presence heartbeat + go-offline beacon used to live here, which
 * meant every call site (AppShell, Dialer, OnboardingGate, …) spun up its own
 * 30s heartbeat loop and unload listeners. They now live in a single
 * <PresenceManager/> mounted once at the app root.
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
