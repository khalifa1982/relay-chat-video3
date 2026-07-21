import { useEffect, useState } from "react";
import { AlertTriangle, X } from "lucide-react";

/**
 * Surfaces the ONE deploy misconfiguration that silently breaks calling:
 * running MULTIPLE app instances behind a load balancer without pinning call
 * signaling to a single instance. RELAY's `/api/relay/*` signaling is in-memory
 * per-instance (cross-instance relay rooms are out of scope), so two people on
 * different instances can't ring each other — the caller sees nothing and the
 * callee just gets a missed-call. That silent failure is exactly what this
 * banner exists to make visible.
 *
 * Detection: the ALB's `AWSALB` stickiness cookie pins a browser to one
 * instance, so an ordinary fetch always reports the same `instance` id. Probing
 * `/api/health` with `credentials:"omit"` drops that cookie, so the balancer
 * round-robins and a few probes reveal >1 distinct `instance` when the deploy
 * is multi-instance. An operator who HAS pinned signaling sets
 * `RELAY_SIGNALING_PINNED=1` (surfaced as `signalingPinned`) to silence this.
 * Single-instance deploys (e.g. Manus/.org) always see one id → never warns.
 */
export function CallHealthBanner() {
  const [warn, setWarn] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const seen = new Set<string>();
      let pinned = false;
      for (let i = 0; i < 5; i++) {
        try {
          const r = await fetch("/api/health", { credentials: "omit", cache: "no-store" });
          const j = (await r.json()) as {
            instance?: string;
            signalingPinned?: boolean;
            cluster?: boolean;
          };
          if (j?.instance) seen.add(String(j.instance));
          // `cluster` (RELAY_CLUSTER) makes calls work across instances via the
          // elected leader, so no pin is needed — treat it as healthy too.
          if (j?.signalingPinned || j?.cluster) pinned = true;
          if (pinned || seen.size >= 2) break; // enough to decide
        } catch {
          /* ignore transient probe errors */
        }
        await new Promise((res) => setTimeout(res, 250));
      }
      if (!cancelled && seen.size >= 2 && !pinned) setWarn(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!warn || dismissed) return null;
  return (
    <div className="mx-3 mt-3 md:mx-6 md:mt-4 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
      <div className="flex items-start gap-3">
        <AlertTriangle className="size-5 shrink-0 text-amber-500 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-foreground">Calls may not connect on this server</div>
          <p className="text-muted-foreground text-xs leading-relaxed mt-1">
            This deployment is running multiple instances but call signaling isn't
            pinned to one, so two people on different instances can't ring each
            other — calls show up only as missed. <span className="text-foreground/80">Admin:</span> pin all{" "}
            <code className="font-mono text-[0.72rem]">/api/relay/*</code> to a single instance
            (see <code className="font-mono text-[0.72rem]">docs-aws-scale-out.md</code>) or run one
            instance, then set <code className="font-mono text-[0.72rem]">RELAY_SIGNALING_PINNED=1</code>.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss"
          className="shrink-0 grid size-7 place-items-center rounded-lg text-muted-foreground hover:bg-muted/60 hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}
