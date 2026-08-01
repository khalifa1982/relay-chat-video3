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
import {
  initRelayBackground,
  RELAY_TONE_DARK,
  RELAY_TONE_LIGHT,
  type RelayBackgroundHandle,
} from "@/lib/relayBackground";

export function RelayBackground({
  business = false,
  light = false,
}: {
  business?: boolean;
  /**
   * Paint the LIGHT tone map (#158, owner: *"if you choose the light theme, ensure that
   * the 3D background also changes … a very light black or gray that is moving"*).
   *
   * A PROP rather than a `useTheme()` read inside this component, deliberately: the login
   * and passcode screens mount this BEFORE the app shell exists and are dark by design,
   * so a theme read here would flip surfaces that were never meant to change. The caller
   * knows which surface it is; this component only knows how to paint.
   */
  light?: boolean;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const handle = useRef<RelayBackgroundHandle | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    handle.current = initRelayBackground(ref.current, {
      tone: light ? RELAY_TONE_LIGHT : RELAY_TONE_DARK,
    });
    return () => {
      handle.current?.destroy();
      handle.current = null;
    };
    /* Keyed on `light`: a theme switch REBUILDS the canvas rather than mutating a live
       loop. The tone is read once at init (it decides the composite operation, which is
       set per frame from a captured value), so a running loop cannot be re-toned — and a
       theme switch is rare enough that a teardown is cheaper than the state to make it
       hot-swappable. */
  }, [light]);

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
            /* The vignette must match the base it darkens toward, or the light canvas
               gets a near-black ring around a pale page. */
            light
              ? "radial-gradient(closest-side at 50% 42%, rgba(238,241,240,0) 55%, rgba(214,220,218,.72) 100%)"
              : "radial-gradient(closest-side at 50% 42%, rgba(4,7,10,0) 55%, rgba(3,6,8,.66) 100%)",
        }}
      />
    </>
  );
}
