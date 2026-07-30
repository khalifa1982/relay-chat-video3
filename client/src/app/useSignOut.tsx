import { useCallback, useState, type ReactNode } from "react";
import { trpc } from "@/lib/trpc";
import { clearRelayChannel, resetDeviceId } from "@/lib/deviceId";
import { forgetGuestRecovery } from "@/lib/guestRecovery";
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
  const pushUnsubscribeMut = trpc.push.unsubscribe.useMutation();
  const isGuest = !!me?.isGuest;

  const performSignOut = useCallback(async () => {
    // PUSH (v2.99.81): drop this device's subscription BEFORE the session goes,
    // because `push.unsubscribe` is identity-scoped and needs the caller still to
    // be that identity. Nothing used to do this — sign-out rotated the device id,
    // the channel and the recovery key but left the `push_subscriptions` row bound,
    // so the browser kept receiving the signed-out person's notifications, and
    // their Devices list kept showing a subscription they had signed out of.
    //
    // Best-effort by design: a failure here must never be the reason somebody
    // cannot sign out. The browser-side subscription is also dropped, so a
    // re-registration mints a fresh endpoint rather than reviving this one.
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      const sub = await reg?.pushManager?.getSubscription();
      if (sub?.endpoint) {
        await pushUnsubscribeMut.mutateAsync({ endpoint: sub.endpoint }).catch(() => {});
        await sub.unsubscribe().catch(() => {});
      }
    } catch {
      /* no service worker, no permission, or a storage error — nothing to undo */
    }
    try {
      if (isGuest) await signOutGuestMut.mutateAsync();
      else await logoutUserMut.mutateAsync();
    } catch {
      /* even if the server round-trip fails, the local teardown below still
         severs the device binding — the next whoami mints a fresh identity */
    }
    // NOTE (v2.99.49): deliberately does NOT clear `relay_push_claim`. That value
    // identifies this BROWSER PROFILE as the owner of its push subscription, not
    // the signed-out identity — clearing it would make the next account's
    // re-bind unprovable and force an endpoint rotation on every sign-out.
    resetDeviceId();
    clearRelayChannel();
    // ADOPT-AND-RETIRE (v2.99.68): drop the recovery record too. This is the
    // boundary that keeps a SHARED browser safe — recovery is deliberate rather
    // than automatic precisely so that signing out is enough to sever it, and
    // leaving the record behind would hand the next person a one-tap way back
    // into this identity.
    forgetGuestRecovery();
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
              ? "Guest sign-out wipes this identity from this device: your number, contacts, and messages won't come back unless you registered — and it also removes the option to restore this number later. This can't be undone."
              : "You'll be signed out of your account on this device. Your number and data stay on your account — sign back in anytime."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          {/* RED FOR A GUEST, ACCENT FOR AN ACCOUNT — the two are not the same act.
              A guest's number, contacts and messages do not come back (the description
              above says so); a registered sign-out is reversible by signing back in.
              Painting both red would spend the warning colour on the harmless one and
              leave it meaning nothing on the other. Board 4k draws this one red. */}
          <AlertDialogAction
            destructive={isGuest}
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
