import { useEffect, useRef, useState } from "react";
import { RotateCw } from "lucide-react";
import { APP_VERSION } from "@/lib/buildInfo";
import { useRelayEngine } from "./RelayEngine";
import { isNewer } from "./updateVersion";

/**
 * Auto-update checker. Polls `GET /api/version` every 30s and compares the
 * version the SERVER is running with the version baked into THIS loaded bundle
 * (`APP_VERSION`). When they differ a newer deploy is live:
 *
 *   • In a call (engine phase !== "idle") → reload SILENTLY. Persistent call
 *     membership + auto-rejoin re-enter the same room on the fresh bundle (a page
 *     refresh keeps the server-side membership — see relayClient `onUnload`), so
 *     the swap is seamless and the user keeps talking without noticing.
 *   • Idle → show a CENTERED, clickable card. Dismissing it ("Later") only hides
 *     it briefly; it REAPPEARS so an update can't be permanently ignored.
 *
 * Mounted once at the app root, inside RelayEngineProvider (it reads the call
 * phase via useRelayEngine()).
 */
const POLL_MS = 30_000;
const REAPPEAR_MS = 45_000;
// After a silent reload we record the moment; if we're STILL on the old bundle
// this soon afterwards (a stale CDN/old-revision asset edge during a rollout),
// we don't silently reload again — we surface the card instead of looping.
const RELOAD_COOLDOWN_MS = 60_000;
const RELOAD_STAMP_KEY = "relay_update_reload_ts";

/** Did we attempt a silent reload within the cooldown window? Survives the
 *  reload via sessionStorage, so a stale asset edge can't trigger a tight loop
 *  (the in-memory ref is wiped by reload()). */
function recentlyReloaded(): boolean {
  try {
    const ts = parseInt(window.sessionStorage.getItem(RELOAD_STAMP_KEY) ?? "", 10);
    return Number.isFinite(ts) && Date.now() - ts < RELOAD_COOLDOWN_MS;
  } catch {
    return false;
  }
}

function reloadNow(): void {
  try {
    window.sessionStorage.setItem(RELOAD_STAMP_KEY, String(Date.now()));
  } catch {
    /* private mode — fall through; the in-memory guard still helps */
  }
  window.location.reload();
}

export function UpdateChecker() {
  const { phase } = useRelayEngine();
  // Read the live phase inside the (mount-once) poll without re-arming the timer.
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const [outdated, setOutdated] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const reloadingRef = useRef(false);

  useEffect(() => {
    let alive = true;
    const check = async () => {
      try {
        const res = await fetch("/api/version", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { version?: string };
        const serverV = typeof data.version === "string" ? data.version : "";
        if (!alive || !serverV) return;
        // Only react to a STRICTLY-NEWER deploy (see isNewer): equal, older, or a
        // rollback never reloads, which removes all rollout-flapping.
        if (!isNewer(serverV, APP_VERSION)) {
          setOutdated(false);
          return;
        }
        // A strictly-newer deploy is live.
        if (phaseRef.current === "in-call") {
          // ESTABLISHED call → refresh silently; auto-rejoin re-enters the same
          // room (server keeps membership across a reload). We deliberately do
          // NOT reload during "dialing"/"ringing": that pre-answer window has no
          // server membership to rejoin, so a reload would silently drop the
          // outgoing call. Those phases fall through to the flag below and just
          // defer — the next poll reloads once connected, or shows the card once
          // the user is idle. Skip if we reloaded very recently and are STILL
          // outdated (stale asset edge), so we never loop.
          if (!reloadingRef.current && !recentlyReloaded()) {
            reloadingRef.current = true;
            reloadNow();
          }
        } else {
          // idle / dialing / ringing — flag it. The card is gated to render only
          // when idle (below), so dialing/ringing stay quiet until they resolve.
          setOutdated(true);
        }
      } catch {
        /* offline / transient — try again on the next tick */
      }
    };
    void check();
    const t = setInterval(check, POLL_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  // Bring the prompt back a short while after the user taps "Later" — an update
  // shouldn't be dismissable forever.
  useEffect(() => {
    if (!outdated || !dismissed) return;
    const t = setTimeout(() => setDismissed(false), REAPPEAR_MS);
    return () => clearTimeout(t);
  }, [outdated, dismissed]);

  // Only ever shown while idle: if a new version is detected DURING a call we
  // reload silently instead, so the card never interrupts an active call. (If the
  // user happens to leave the call before a poll fires, the next tick flags it.)
  if (!outdated || dismissed || phase !== "idle") return null;

  return (
    <div
      className="fixed inset-0 z-[120] grid place-items-center glass-overlay p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Update available"
    >
      <div className="w-[min(92vw,360px)] rounded-3xl border border-border bg-card p-6 text-center shadow-2xl">
        <div className="mx-auto mb-4 grid size-14 place-items-center rounded-2xl bg-primary/15 text-primary">
          <RotateCw className="size-7" />
        </div>
        <h2 className="text-lg font-bold">New version available</h2>
        <p className="mt-1.5 text-sm text-muted-foreground">
          A fresh version of RELAY is ready. Refresh to get the latest.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-5 w-full rounded-full bg-primary px-5 py-3 font-semibold text-primary-foreground shadow-lg transition active:scale-[0.98]"
        >
          Refresh now
        </button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="mt-2 w-full rounded-full px-5 py-2 text-sm text-muted-foreground transition hover:bg-muted/50"
        >
          Later
        </button>
      </div>
    </div>
  );
}
