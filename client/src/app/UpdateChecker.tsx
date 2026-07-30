import { useEffect, useRef, useState } from "react";
import { RotateCw } from "lucide-react";
import { APP_VERSION } from "@/lib/buildInfo";
import { useRelayEngine } from "./RelayEngine";
import { isNewer } from "./updateVersion";

/**
 * Auto-update checker. Polls `GET /api/version` every 30s and compares the
 * version the SERVER is running with the version baked into THIS loaded bundle
 * (`APP_VERSION`). When a strictly-newer deploy is live:
 *
 *   • Idle OR in an established call → reload SILENTLY (v2.96.1, owner: "no
 *     need to click Refresh"). In-call, persistent membership + auto-rejoin
 *     re-enter the same room on the fresh bundle, so the swap is seamless.
 *   • Dialing / ringing → defer (a reload there would drop the pre-answer
 *     call); the next poll reloads once the phase resolves.
 *   • The centered "Refresh now" card is now only the LOOP-GUARD FALLBACK: it
 *     appears when a silent reload already ran within the last minute and the
 *     bundle is STILL outdated (a stale CDN/asset edge mid-rollout) — never as
 *     the primary flow.
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
  // The version the SERVER answered with. Board 4k draws it on the card, and the
  // checker already had it — it was fetched, compared, and thrown away, so the
  // card could only ever say "a fresh version is ready" about a version it knew
  // the number of. Kept in state rather than re-derived so what is RENDERED is the
  // same string the comparison was made against.
  const [serverVersion, setServerVersion] = useState("");
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
        setServerVersion(serverV);
        const p = phaseRef.current;
        if (p === "in-call" || p === "idle") {
          // Established call OR idle → refresh silently (in-call, auto-rejoin
          // re-enters the same room; server keeps membership across a reload).
          // We deliberately do NOT reload during "dialing"/"ringing": that
          // pre-answer window has no server membership to rejoin, so a reload
          // would silently drop the outgoing call — those phases defer to the
          // next poll. Skip if we reloaded very recently and are STILL outdated
          // (stale asset edge) — the card below takes over instead of looping.
          if (!reloadingRef.current && !recentlyReloaded()) {
            reloadingRef.current = true;
            reloadNow();
            return;
          }
          setOutdated(true);
        } else {
          // dialing / ringing — flag it; the card renders only when idle, so
          // these phases stay quiet until they resolve.
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
      <div className="rsheet w-[min(92vw,360px)] rounded-3xl border border-border bg-card p-6 text-center shadow-2xl">
        <div className="mx-auto mb-4 grid size-14 place-items-center rounded-2xl bg-primary/15 text-primary">
          <RotateCw className="size-7" />
        </div>
        <h2 className="text-lg font-bold">New version available</h2>
        {/* THE VERSIONS, NOT A CHANGELOG. The board draws a summary line ("call
            quality + groups") and there is no release-notes feed behind it, so
            inventing one would be writing fiction into the one dialog whose whole
            job is to be trustworthy about what is deployed. Both numbers are real:
            `serverVersion` is what /api/version answered, `APP_VERSION` is baked
            into this bundle — the same pair the comparison was made on.
            `dir="ltr"` because a dot-separated number can have its parts reordered
            in an RTL paragraph (the v2.105.19 rule, applied to a version). */}
        <p className="mt-1.5 text-sm text-muted-foreground">
          {serverVersion ? (
            <>
              <span className="font-mono font-semibold text-foreground" dir="ltr">
                v{serverVersion}
              </span>{" "}
              is live — you&apos;re on{" "}
              <span className="font-mono" dir="ltr">
                v{APP_VERSION}
              </span>
              .
            </>
          ) : (
            <>A fresh version of RELAY is ready.</>
          )}{" "}
          Refresh to get the latest.
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
