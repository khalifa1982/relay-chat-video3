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
        <div className="min-w-0 flex-1">
          <span className="font-semibold text-sky-200">Get call alerts on this iPhone:</span>{" "}
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

  return (
    <div className="mx-3 mt-2 flex items-center gap-2.5 rounded-2xl border border-emerald-400/25 bg-emerald-500/10 px-3.5 py-2.5 text-[13px] text-emerald-100/90 backdrop-blur">
      <BellRing className="size-4 shrink-0 text-emerald-300" />
      <div className="min-w-0 flex-1">
        <span className="font-semibold text-emerald-200">Never miss a call</span> — get rung even when RELAY
        is closed.
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
        className="shrink-0 rounded-full bg-emerald-500/90 px-3.5 py-1.5 text-xs font-semibold text-emerald-950 hover:bg-emerald-400"
      >
        Enable
      </button>
      <button type="button" onClick={dismiss} aria-label="Dismiss" className="rounded-full p-1 text-emerald-200/70 hover:bg-white/10">
        <X className="size-4" />
      </button>
    </div>
  );
}
