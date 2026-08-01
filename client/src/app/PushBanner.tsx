import { useEffect, useState } from "react";
import { BellRing, X, MonitorDown } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { getNotifPermission, requestNotifPermission, unlockAudio } from "./notifications";
import { ensurePushSubscription, pushSupported } from "./pushClient";
import {
  isNativeShell,
  promptInstall,
  shouldOfferInstall,
  subscribeInstallPrompt,
} from "./installSurface";

const DISMISS_KEY = "relay_push_banner_dismissed";

/**
 * One-time "get call alerts" banner + the silent auto-(re)subscribe that keeps
 * this device wakeable.
 *
 * Three states:
 *   • permission already granted → render nothing; silently ensure the push
 *     subscription exists server-side (it can vanish after browser updates).
 *   • push supported, permission not asked yet → offer an Enable button
 *     (permission MUST be requested from a user gesture).
 *   • DESKTOP with a real `beforeinstallprompt` in hand → offer a one-click
 *     Install that creates a shortcut to /app (v2.106.81).
 *
 * NOT shown at all inside the native shell, and no longer shown on a mobile
 * browser: the owner ships real iOS and Android apps now, so the old "Add to Home
 * Screen" tip pointed a mobile visitor at the wrong product — and inside the Expo
 * WebView it named a Safari button that does not exist. See ./installSurface.
 */
export function PushBanner() {
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try { return localStorage.getItem(DISMISS_KEY) === "1"; } catch { return true; }
  });
  const [perm, setPerm] = useState(() => getNotifPermission());
  /* `beforeinstallprompt` fires once, early and asynchronously — often BEFORE this
     component mounts and sometimes after. Subscribing (rather than reading once)
     is what makes the row appear either way. */
  const [offerInstall, setOfferInstall] = useState(() => shouldOfferInstall());
  useEffect(() => subscribeInstallPrompt(() => setOfferInstall(shouldOfferInstall())), []);
  const pubKey = trpc.push.publicKey.useQuery(undefined, {
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  const subscribe = trpc.push.subscribe.useMutation();

  // Silent keep-alive: whenever permission is granted and the key is known,
  // make sure the browser's subscription is registered with the server.
  useEffect(() => {
    if (perm !== "granted") return;
    if (!pubKey.data?.key) return;
    void ensurePushSubscription(pubKey.data.key, (sub) => subscribe.mutateAsync(sub));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perm, pubKey.data?.key]);

  const dismiss = () => {
    setDismissed(true);
    try { localStorage.setItem(DISMISS_KEY, "1"); } catch { /* */ }
  };

  /* NOTHING AT ALL INSIDE THE NATIVE SHELL. It receives calls over APNs/FCM, so
     every prompt here is either noise or — in the case the owner was looking at —
     actively wrong: the old iOS tip fired inside the Expo WebView, because a
     WebView is not `display-mode: standalone` and exposes no PushManager, and told
     the user to tap a Safari Share button that does not exist. */
  if (isNativeShell()) return null;

  if (dismissed || perm === "granted" || perm === "denied") return null;

  /* DESKTOP INSTALL — one click, and the browser creates the shortcut itself
     (owner: *"show it the icon that can be added to the browser or to the desktop
     — as you click, automatically create a shortcut to the /app link
     directly"*). It lands on /app with no work here: `manifest.webmanifest`
     already declares `"start_url": "/app"`.

     GATED ON HOLDING A REAL PROMPT, not on "is this a desktop": Safari and Firefox
     never fire `beforeinstallprompt` and expose no programmatic install, so a
     button there would be present, tappable and able to do nothing at all. It is
     ABSENT instead (v2.103.3). */
  if (offerInstall) {
    return (
      <div className="mx-3 mt-2 flex items-center gap-2.5 rounded-2xl border border-sky-400/25 bg-sky-500/10 px-3.5 py-2.5 text-[13px] text-sky-100/90 backdrop-blur">
        <MonitorDown className="size-4 shrink-0 text-sky-300" />
        <div className="min-w-0 flex-1">
          <span className="font-semibold text-sky-200">Install RELAY</span> — add it to your
          desktop and open it like an app.
        </div>
        <button
          type="button"
          onClick={() => {
            void promptInstall().then((accepted) => {
              // Either way the prompt is spent, so the row must go: a button that
              // works once and then silently does nothing is worse than none.
              setOfferInstall(false);
              if (accepted) dismiss();
            });
          }}
          className="rcta shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold"
        >
          Install
        </button>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="rounded-full p-1 text-sky-200/70 hover:bg-white/10"
        >
          <X className="size-4" />
        </button>
      </div>
    );
  }

  if (!pushSupported() || !pubKey.data?.key) return null;

  /* Board 4k: "Get call alerts / Ring even when this tab is closed / Enable".
     ---------------------------------------------------------------------------
     THE COLOUR IS THE CHANGE, and it is a vocabulary fix rather than a restyle.
     This banner was emerald end to end — but green in this app means ONLINE: it is
     what every presence LED is painted with, and it is why v2.99.86 moved Do Not
     Disturb off green and v2.106.9 moved the speaking tile off it. A green chip
     that means "enable notifications" is a third meaning for the one colour that
     has to keep carrying exactly one. The accent is what "the thing to tap" means
     everywhere else in the app, so the banner takes the accent and green is left
     alone. */
  return (
    <div
      className="mx-3 mt-2 flex items-center gap-2.5 rounded-2xl px-3.5 py-2.5 text-[13px] backdrop-blur"
      style={{
        background: "rgba(var(--rb-rgb), 0.10)",
        border: "1px solid rgba(var(--rb-rgb), 0.28)",
      }}
    >
      <BellRing className="size-4 shrink-0" style={{ color: "var(--rb)" }} />
      <div className="min-w-0 flex-1">
        <span className="font-semibold" style={{ color: "var(--rb)" }}>
          Get call alerts
        </span>{" "}
        — ring even when this tab is closed.
      </div>
      <button
        type="button"
        onClick={() => {
          // Same gesture also unlocks the audio context, so the first ring is audible.
          unlockAudio();
          void requestNotifPermission().then(async (p) => {
            setPerm(p);
            if (p === "granted" && pubKey.data?.key) {
              await ensurePushSubscription(pubKey.data.key, (sub) => subscribe.mutateAsync(sub));
            }
            if (p !== "default") dismiss();
          });
        }}
        className="rcta shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold"
      >
        Enable
      </button>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="rounded-full p-1 text-foreground/60 hover:bg-white/10"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
