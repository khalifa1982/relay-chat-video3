/**
 * The login page's animated canvas + vignette (RELAY_LOGIN_HANDOFF.md §6).
 *
 * Two fixed layers behind everything: the canvas, and a non-interactive
 * vignette the spec specifies exactly. The engine lives in
 * `client/src/lib/relayBackground.ts`; this is only its React lifetime.
 *
 * `business` crossfades the whole background to gold — the spec wants selecting
 * a Business account to sweep the accent across the page, and the engine eases
 * toward the target at ~5%/frame rather than cutting, so it reads as a sweep
 * rather than a flicker. It is pushed through the imperative handle rather than
 * re-initialising, because re-init would restart the whole simulation.
 */
import { useEffect, useRef } from "react";
import { initRelayBackground, type RelayBackgroundHandle } from "@/lib/relayBackground";

export function RelayBackground({ business = false }: { business?: boolean }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const handle = useRef<RelayBackgroundHandle | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    handle.current = initRelayBackground(ref.current);
    return () => {
      handle.current?.destroy();
      handle.current = null;
    };
  }, []);

  useEffect(() => {
    handle.current?.setBusiness(business);
  }, [business]);

  return (
    <>
      <canvas
        ref={ref}
        aria-hidden
        data-testid="relay-login-canvas"
        style={{ position: "fixed", inset: 0, width: "100%", height: "100%", display: "block", zIndex: 0 }}
      />
      <div
        aria-hidden
        style={{
          position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0,
          background:
            "radial-gradient(closest-side at 50% 42%, rgba(4,7,10,0) 55%, rgba(3,6,8,.66) 100%)",
        }}
      />
    </>
  );
}
