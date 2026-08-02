import { useCallback, useEffect, useRef, useState } from "react";
import { RelayBackground } from "./RelayBackground";
import { useT } from "./i18n";

/**
 * THE PIN REVEAL (#162) — `design_handoff_pin_reveal/`.
 *
 * Owner: *"once you pass [login], before you go to the dashboard screen, there is a PIN
 * number page where it shows you your number (either guest or member)… and after viewing
 * the pin it will take you to the main dashboard."*
 *
 * A glowing orb docks into a capsule, fires a beam across it, the six digits churn
 * matrix-style, settle RIGHT→LEFT into the real number, and the beam fades slowly so the
 * light never covers the digits. The handoff calls its timings final, so they are
 * transcribed exactly rather than approximated:
 *
 *   t=0      idle    dots, no orb
 *   t=700    charge  orb rises, scale(.15) translateY(55%) → scale(1), .6s
 *   t=2300   flash   beams scaleX(0→1); scramble ticks every 55ms
 *   +350ms   settle  one digit locks per 150ms, right → left
 *   then     hold    beams fade over 2.2s; caption in
 *
 * ── WHY THE PIN IS A PROP AND NOT FETCHED HERE ───────────────────────────────────────
 * The handoff suggests fetching during the 2.3s charge budget. In this app the number is
 * ALREADY resolved by the time anything can route here — `whoami` has it, and for a guest
 * `startGuest` has just minted it. Fetching again would introduce a second source for a
 * value the caller already holds, and a slow request would strand the animation mid-charge
 * with nothing to settle onto. The caller passes it; this component only performs it.
 *
 * ── AND WHY IT NEVER SCRAMBLES ONTO A MALFORMED NUMBER ───────────────────────────────
 * `pin` is validated to exactly six digits. Anything else and the component reports done
 * IMMEDIATELY rather than animating: a reveal that settles onto "undefine" would be worse
 * than no reveal, and this sits between a person and their inbox — it must never be the
 * reason somebody cannot get in.
 *
 * ── ITS COPY IS IN BOTH LANGUAGES, AND THE DIGITS ARE IN NEITHER ─────────────────────
 * Every way into the app passes through this screen, so shipping it English-only made it
 * the one surface nobody could avoid reading in a language they may not have. The five
 * strings live in `dict/auth.ts` — this is the last step of the LOGIN path rather than a
 * screen of the app behind it. The six digits are Western in both languages, because a
 * number read aloud has to be the number typed (v2.106.84), and `.prv-digits` already
 * carries `direction: ltr` so the row cannot reorder under `dir="rtl"`.
 *
 * KNOWN AND NOT FIXED HERE: the three micro-labels sit under 0.3–0.4em letter-spacing,
 * which forces gaps between letters that Arabic JOINS. Their Arabic is kept short to
 * limit it, but the real fix is a direction-aware tracking reset in `index.css`, which
 * is app-wide (History's day headers and the Contacts A–Z letters have the same shape)
 * and does not belong in one component's translation.
 */

/** Every timing the handoff fixes, in one place so the test can assert them. */
export const PIN_REVEAL_TIMING = {
  chargeAt: 700,
  flashAt: 2300,
  scrambleTick: 55,
  settleGrace: 350,
  settleStep: 150,
  beamFade: 2200,
  /** Owner: *"after 10 seconds, it will move again rapidly to the next page."* */
  autoAdvanceMs: 10_000,
  /** The warp either side of this screen. */
  warpMs: 900,
} as const;

export function isRevealablePin(pin: string | null | undefined): boolean {
  return typeof pin === "string" && /^\d{6}$/.test(pin);
}

/**
 * The right→left settle, as a pure function of elapsed time.
 *
 * Returns the index of the LAST still-unsettled slot: 5 → -1. Extracted because it is the
 * only real arithmetic here, and "does the sixth digit ever actually settle" is exactly
 * what a source pin cannot answer.
 */
export function settledIndexAt(elapsedMs: number): number {
  const { settleGrace, settleStep } = PIN_REVEAL_TIMING;
  return Math.max(-1, 5 - Math.floor(Math.max(0, elapsedMs - settleGrace) / settleStep));
}

/** Total time from the flash to every digit being locked. */
export function pinRevealTotalMs(): number {
  const { flashAt, settleGrace, settleStep } = PIN_REVEAL_TIMING;
  return flashAt + settleGrace + settleStep * 6;
}

type Phase = "idle" | "charge" | "flash" | "hold";

export function PinReveal({
  pin,
  onDone,
  reducedMotion,
}: {
  pin: string;
  /** Called when the reveal is finished AND the auto-advance has elapsed. */
  onDone: () => void;
  /** Test seam; defaults to the media query. */
  reducedMotion?: boolean;
}) {
  const t = useT();
  const calm =
    reducedMotion ??
    (typeof window !== "undefined" &&
      !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);

  const ok = isRevealablePin(pin);
  const [phase, setPhase] = useState<Phase>(calm || !ok ? "hold" : "idle");
  const [disp, setDisp] = useState<string[]>(() =>
    /* `.split("")`, not a spread: spreading a STRING needs `downlevelIteration` under this
       repo's ES5 target (TS2802 — the trap recorded at v2.99.72, v2.99.98, v2.105.21,
       v2.106.32 and v2.106.89). Safe here because the value is six ASCII digits, never a
       surrogate pair. */
    calm || !ok ? (ok ? pin : "······").split("") : ["0", "0", "0", "0", "0", "0"],
  );
  const [settled, setSettled] = useState(calm || !ok ? -1 : 5);
  const [captionIn, setCaptionIn] = useState(calm || !ok);

  /* The advance is held in a ref so the timers below never capture a stale prop — this
     screen lives ~13s and the caller may re-render underneath it. */
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  /* THE TWO JUMPS THE OWNER ASKED FOR. 1 on mount ("it comes super speedily like flying
     in space"), 2 on the way out ("it will move again rapidly to the next page"). */
  const [warpKey, setWarpKey] = useState(1);

  /* Leaving is IDEMPOTENT and holds the screen for the jump. A tap during the exit must
     not fire a second `onDone`, and calling it straight away would destroy this canvas
     before the warp it just started could paint — so the jump IS the transition rather
     than something that plays underneath a screen already gone. Under reduced motion
     there is no jump and no wait, the same rule the engine applies to itself. */
  const leaving = useRef(false);
  const leave = useCallback(() => {
    if (leaving.current) return;
    leaving.current = true;
    if (calm) {
      doneRef.current();
      return;
    }
    setWarpKey((k) => k + 1);
    setTimeout(() => doneRef.current(), PIN_REVEAL_TIMING.warpMs);
  }, [calm]);

  // ── the animation ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (calm || !ok) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    let ticker: ReturnType<typeof setInterval> | undefined;

    timers.push(setTimeout(() => setPhase("charge"), PIN_REVEAL_TIMING.chargeAt));
    timers.push(
      setTimeout(() => {
        setPhase("flash");
        const started = Date.now();
        ticker = setInterval(() => {
          const s = settledIndexAt(Date.now() - started);
          setSettled(s);
          setDisp((prev) =>
            prev.map((_, i) => (i > s ? pin[i] : String(Math.floor(Math.random() * 10)))),
          );
          if (s <= -1) {
            if (ticker) clearInterval(ticker);
            setPhase("hold");
            setCaptionIn(true);
          }
        }, PIN_REVEAL_TIMING.scrambleTick);
      }, PIN_REVEAL_TIMING.flashAt),
    );

    return () => {
      timers.forEach(clearTimeout);
      if (ticker) clearInterval(ticker);
    };
  }, [pin, calm, ok]);

  // ── the auto-advance ─────────────────────────────────────────────────────────────
  useEffect(() => {
    /* A MALFORMED NUMBER ADVANCES AT ONCE. There is nothing to look at and the person is
       trying to reach their inbox. */
    if (!ok) {
      const t = setTimeout(() => doneRef.current(), 0);
      return () => clearTimeout(t);
    }
    /* The 10s clock starts when the reveal SETTLES, not on mount — otherwise the reduced-
       motion path (which shows the number instantly) and the animated path would give the
       viewer wildly different amounts of time to actually read it. */
    const from = calm ? 0 : pinRevealTotalMs();
    const t = setTimeout(() => leave(), from + PIN_REVEAL_TIMING.autoAdvanceMs);
    return () => clearTimeout(t);
  }, [ok, calm, leave]);

  const lit = phase === "flash" || phase === "hold";

  return (
    <div
      className="prv-root dark relay-v2"
      /* TAP TO SKIP. The 10s wait is the owner's, but somebody who has read their number
         must not be held on a screen with nothing left to do — and a full-screen surface
         with no exit is the shape people report as frozen. */
      onClick={() => leave()}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") leave();
      }}
      aria-label={t("pin.continueAria")}
    >
      {/* The reveal owns its OWN canvas, because at this point the login screen has
          unmounted and the shell has not mounted — exactly one is ever live (the rule
          AppShell states for itself). Dark unconditionally: every colour the handoff
          fixes is a dark-surface value, so this screen does not follow the theme. */}
      <RelayBackground warpKey={warpKey} />

      <div className="prv-stack">
        <div className="prv-brand">
          <div className="prv-brand-row">
            <span className="prv-dot" aria-hidden />
            <span className="prv-name">RELAY</span>
          </div>
          <span className="prv-status">{t("pin.online")}</span>
        </div>

        <div className="prv-card">
          <div className="prv-head">
            <span className="prv-label">{t("pin.yourNumber")}</span>
            <span className="prv-chip">{t("pin.autoAssigned")}</span>
          </div>

          <div className={`prv-capsule${phase === "charge" ? " charge" : ""}${phase === "flash" ? " flash" : ""}${phase === "hold" ? " hold" : ""}${lit ? " lit" : ""}`}>
            <span className="prv-beam" aria-hidden />
            <span className="prv-beam core" aria-hidden />
            <div className="prv-digits">
              {[0, 1, 2].map((i) => (
                <Slot key={i} i={i} d={disp[i]} settled={settled} />
              ))}
              <span className="prv-dash-wrap" aria-hidden>
                <span className="prv-dash" />
              </span>
              {[3, 4, 5].map((i) => (
                <Slot key={i} i={i} d={disp[i]} settled={settled} />
              ))}
            </div>
            <span className="prv-socket" aria-hidden />
            <span className="prv-orb" aria-hidden />
          </div>

          {/* The number, once, for a screen reader — the digit slots are decorative
              spans and would otherwise be read as six unrelated characters. */}
          <span className="sr-only">
            {/* The grouping is applied HERE and passed in whole, so the sentence stays
                one translatable string with the number wherever the language wants it —
                rather than being chopped at the English seam around an interpolation. */}
            {ok ? t("pin.screenReader", { number: `${pin.slice(0, 3)} ${pin.slice(3)}` }) : ""}
          </span>

          <p className={`prv-caption${captionIn ? " show" : ""}`}>{t("pin.caption")}</p>
        </div>
      </div>
    </div>
  );
}

function Slot({ i, d, settled }: { i: number; d: string; settled: number }) {
  const isSet = i > settled;
  return (
    <span className={`prv-slot${isSet ? " set" : " scrambling"}`} aria-hidden>
      <span className="prv-dotslot" />
      <span className="prv-digit">{d}</span>
    </span>
  );
}
