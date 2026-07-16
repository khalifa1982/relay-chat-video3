import { useCallback, useState, type ReactNode } from "react";
import { trpc } from "@/lib/trpc";
import { clearRelayChannel, resetDeviceId } from "@/lib/deviceId";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";

/**
 * Shared sign-out flow (v2.88) — extracted from Profile so the AppShell's two
 * sign-out buttons and Profile all run the SAME teardown instead of three
 * hand-rolled variants (the AppShell buttons used to call `signOutGuest` even
 * for registered members, which left their session cookie alive).
 *
 * The flow:
 *   1. Confirm via AlertDialog (native `confirm()` is gone). A GUEST sign-out
 *      is an identity WIPE — their number/contacts are unrecoverable on this
 *      device — so the copy warns explicitly.
 *   2. Server mutation: guests → `identity.signOutGuest`, members →
 *      `auth.logout`. Both now clear every session cookie flavor
 *      (relay_guest / relay_session / app_session_id).
 *   3. Local teardown (v2.87.1 lesson): the cookie alone isn't the whole
 *      story — the DEVICE-ID binding silently restores the same identity on
 *      the next visit. Rotate it, and sever the relay signaling channel so the
 *      next user on this browser can't be auto-rejoined into a live call.
 *   4. Land on /app (the entry screen: guest name form + member sign-in).
 */
export function useSignOut(me: { isGuest: boolean } | null | undefined): {
  /** Open the confirm dialog (the actual sign-out runs on confirm). */
  requestSignOut: () => void;
  /** Render this once near the buttons — it hosts the AlertDialog. */
  signOutDialog: ReactNode;
  signOutPending: boolean;
} {
  const [confirming, setConfirming] = useState(false);
  const signOutGuestMut = trpc.identity.signOutGuest.useMutation();
  const logoutUserMut = trpc.auth.logout.useMutation();
  const isGuest = !!me?.isGuest;

  const performSignOut = useCallback(async () => {
    try {
      if (isGuest) await signOutGuestMut.mutateAsync();
      else await logoutUserMut.mutateAsync();
    } catch {
      /* even if the server round-trip fails, the local teardown below still
         severs the device binding — the next whoami mints a fresh identity */
    }
    resetDeviceId();
    clearRelayChannel();
    window.location.href = "/app";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGuest]);

  const requestSignOut = useCallback(() => setConfirming(true), []);

  const signOutDialog = (
    <AlertDialog open={confirming} onOpenChange={(open) => !open && setConfirming(false)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{isGuest ? "Sign out and forget this number?" : "Sign out?"}</AlertDialogTitle>
          <AlertDialogDescription>
            {isGuest
              ? "Guest sign-out wipes this identity from this device: your number, contacts, and messages won't come back unless you registered. This can't be undone."
              : "You'll be signed out of your account on this device. Your number and data stay on your account — sign back in anytime."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              setConfirming(false);
              void performSignOut();
            }}
          >
            Sign out
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return {
    requestSignOut,
    signOutDialog,
    signOutPending: signOutGuestMut.isPending || logoutUserMut.isPending,
  };
}
