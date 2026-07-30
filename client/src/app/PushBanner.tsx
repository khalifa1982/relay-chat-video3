import { useEffect, useState } from "react";
import { BellRing, X, Share } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { getNotifPermission, requestNotifPermission, unlockAudio } from "./notifications";
import { ensurePushSubscription, pushSupported, iosNeedsInstallForPush } from "./pushClient";

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
 *   • iPhone/iPad in a plain Safari tab (no PushManager) → explain that call
 *     alerts need Add to Home Screen (Apple's rule), dismissible.
 */
export function PushBanner() {
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try { return localStorage.getItem(DISMISS_KEY) === "1"; } catch { return true; }
  });
  const [perm, setPerm] = useState(() => getNotifPermission());
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

  if (dismissed || perm === "granted" || perm === "denied") return null;

  // iOS Safari tab: push physically unavailable until installed to Home Screen.
  if (iosNeedsInstallForPush()) {
    return (
      <div className="mx-3 mt-2 flex items-start gap-2.5 rounded-2xl border border-sky-400/25 bg-sky-500/10 px-3.5 py-3 text-[13px] leading-snug text-sky-100/90 backdrop-blur">
        <Share className="mt-0.5 size-4 shrink-0 text-sky-300" />
        {/* Sky rather than the accent, deliberately: this one carries NO action —
            the install happens in Safari's own menu, which no button here can open.
            Painting it in the accent would promise a tap that does not exist. */}
        <div className="min-w-0 flex-1">
          <span className="font-semibold text-sky-200">Install RELAY (iOS):</span>{" "}
          tap Safari&apos;s Share button → <span className="font-medium">Add to Home Screen</span>, then open
          RELAY from the icon. iOS only rings installed web apps.
        </div>
        <button type="button" onClick={dismiss} aria-label="Dismiss" className="rounded-full p-1 text-sky-200/70 hover:bg-white/10">
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
