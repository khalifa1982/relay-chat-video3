/* ──────────────────────────────────────────────────────────────────────────
 * The Dialer's idle marquee — the painter.
 *
 * ZERO setState. This component renders a static skeleton ONCE and never
 * re-renders; one `useEffect` owns one rAF loop that writes `textContent`,
 * `style.opacity` and `style.transform` through refs.
 *
 * That is not a micro-optimisation, it is the enforced form of a rule this repo
 * has paid for twice. A state write per 55ms flick would re-render the whole
 * DialerPage — twelve keypad buttons, the MY NUMBER card, the action row —
 * eighteen times a second, on the app's DEFAULT tab. `TypingLine` says the same
 * thing in its own header ("inline in the conversation it would re-render the
 * whole message list on every step — the v2.99.67 mistake") and v2.99.73's
 * waveform is imperative for the same reason.
 *
 * NO @keyframes ANYWHERE, and that is stronger than satisfying the standing
 * guard rather than merely equal to it: every fade is an imperative opacity
 * write, the prompt's entrance is a `translateY`, the lock pop is a `scale`.
 * All compositor-only. Worth knowing WHY the stronger form was chosen — the
 * repainting-property guard slices `client/src/index.css` only, so a
 * component-local keyframe inherits no coverage at all. Proof that is a real
 * hole rather than a hypothetical: `ghost-flash`, in Dialer.tsx's own page-local
 * <style>, animates `filter: blur(6px)` — a banned property — and the suite is
 * green.
 * ────────────────────────────────────────────────────────────────────────── */
import { useEffect, useMemo, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { prefersReducedMotion } from "@/lib/relayBackground";
import {
  MARQUEE_TIMING,
  MARQUEE_MIN_VIEWPORT_H,
  buildRotations,
  frameAt,
  marqueeSignature,
  slideDuration,
  type MarqueeContactRow,
  type MarqueeSlide,
} from "./dialerMarquee";

/** Roll one glyph out of an alphabet. The painter's job, not the engine's —
 *  which is exactly why the engine returns WHICH alphabet and stays pure. */
const roll = (alphabet: string) => alphabet[Math.floor(Math.random() * alphabet.length)] ?? "";

export function DialerMarquee({
  ownNumber,
  onPick,
}: {
  ownNumber: string | null | undefined;
  /** Fills the pad. NEVER dials — see the handler below. */
  onPick: (number: string) => void;
}) {
  /* COSTS NO NEW QUERY: identical procedure, identical `undefined` input, so
     react-query serves it from the SAME cache key RelayEngine already fills
     app-wide (it runs this for the blocked-pin set inside a provider mounted
     above the router). Passing an input object would mint a second key.

     THE OPTIONS ARE COPIED FROM THAT OWNER DELIBERATELY. `refetchOnMount` and
     `refetchOnWindowFocus` are PER-OBSERVER, so a new observer that omits them
     silently re-enables a focus refetch RelayEngine turned off, and fires an
     extra fetch whenever it mounts into a stale window. The honest claim is
     therefore: no new query, no new poll timer, and no new fetch — rather than
     the looser "costs nothing" it would be easy to write. */
  const contacts = trpc.contacts.list.useQuery(undefined, {
    staleTime: 30_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  const rootRef = useRef<HTMLDivElement | null>(null);
  const promptRef = useRef<HTMLSpanElement | null>(null);
  const nameRef = useRef<HTMLSpanElement | null>(null);
  const cellRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const btnRef = useRef<HTMLButtonElement | null>(null);

  const rows = (contacts.data ?? []) as unknown as MarqueeContactRow[];
  /* MEMOISED ON A DERIVED SIGNATURE, NOT THE ARRAY. The payload carries
     `lastSeenAt`/`isOnline`/`idle`/`inCall` and is polled every 60s, so the
     array identity changes on essentially every refetch for any account with an
     online contact — memoising on it would reshuffle the deck (and swap the
     slide currently on screen) about once a minute. */
  const signature = marqueeSignature(rows);
  const shortViewport =
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(`(max-height: ${MARQUEE_MIN_VIEWPORT_H}px)`).matches
      : false;

  const slides = useMemo<MarqueeSlide[]>(
    () =>
      buildRotations(rows, {
        ownNumber,
        shortViewport,
        contactsUnavailable: contacts.isError,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [signature, ownNumber, shortViewport, contacts.isError]
  );

  /* The live slide is read by the tap handler, which must dial what is ON SCREEN
     rather than what a stale closure remembers. */
  const idxRef = useRef(0);
  const slidesRef = useRef(slides);
  slidesRef.current = slides;

  useEffect(() => {
    if (prefersReducedMotion()) return;
    if (!slides.length) return;

    let raf = 0;
    let last = 0;
    let rotStart = 0;
    let started = false;
    /* Paused while a finger or the keyboard is on the marquee, so a tap target
       cannot move between press and release. Resume re-arms the FULL hold
       rather than the remainder — finishing a slide the user interrupted two
       hundred milliseconds before its exit reads as a glitch. */
    let paused = false;

    const paint = (f: ReturnType<typeof frameAt>) => {
      const p = promptRef.current;
      if (p) {
        if (p.textContent !== f.promptText) p.textContent = f.promptText;
        p.style.opacity = String(f.promptOpacity);
        p.style.transform = f.promptShiftPx ? `translateY(${f.promptShiftPx}px)` : "";
      }
      const n = nameRef.current;
      if (n) {
        if (n.textContent !== f.nameText) n.textContent = f.nameText;
        n.style.opacity = String(f.nameOpacity);
      }
      for (let i = 0; i < 6; i++) {
        const el = cellRefs.current[i];
        if (!el) continue;
        const c = f.cells[i] ?? { digit: "", locked: false, alphabet: null, opacity: 0, scale: 1 };
        const glyph = c.alphabet == null ? "" : c.locked ? c.digit : roll(c.alphabet);
        if (el.textContent !== glyph) el.textContent = glyph;
        el.style.opacity = String(c.opacity);
        el.style.transform = c.scale === 1 ? "" : `scale(${c.scale})`;
      }
      /* The whole region is tappable only while a real contact is on screen and
         settled enough to have been read. */
      const b = btnRef.current;
      if (b) {
        const live = slidesRef.current[idxRef.current];
        const tappable = live?.kind === "contact" && f.nameOpacity > 0.6;
        b.style.pointerEvents = tappable ? "auto" : "none";
        b.setAttribute("aria-hidden", tappable ? "false" : "true");
        b.tabIndex = tappable ? 0 : -1;
        const label =
          tappable && live?.kind === "contact"
            ? `Dial ${live.contact.name}, ${live.contact.number}`
            : "";
        if (b.getAttribute("aria-label") !== label) b.setAttribute("aria-label", label);
      }
    };

    const loop = () => {
      /* RE-ARM FIRST, THEN GUARD. Returning before the request kills the loop
         permanently on the first hidden frame — the v2.99.67 bug, recorded in
         place inside relayBackground.ts. */
      raf = requestAnimationFrame(loop);
      if (typeof document !== "undefined" && document.hidden) return;
      /* A live call is a fixed overlay and this tab stays MOUNTED beneath it.
         The accent engine already stops during a call; the marquee must not
         become the only thing still ticking on the one screen where every cycle
         belongs to the video encoder (v2.106.56). */
      if (typeof document !== "undefined" && document.documentElement.dataset.relayInCall === "1")
        return;
      if (paused) return;

      const now = performance.now();
      if (!started) {
        started = true;
        rotStart = now;
        last = 0;
      }
      if (now - last < MARQUEE_TIMING.FLICK) return;
      last = now;

      const list = slidesRef.current;
      if (!list.length) return;
      /* NORMALISE THE INDEX HERE rather than taking a modulo at each read. The
         rotation list is rebuilt whenever the contact signature changes, and a
         shorter list would otherwise leave `idxRef` past its end — where the
         loop (with a modulo) and the tap handler (without one) would disagree
         about which slide is on screen, i.e. a tap could fill the pad with a
         number other than the one being shown. */
      if (idxRef.current >= list.length) idxRef.current = 0;
      const slide = list[idxRef.current];
      const t = now - rotStart;
      paint(frameAt(slide, t));
      if (t >= slideDuration(slide)) {
        idxRef.current = (idxRef.current + 1) % list.length;
        rotStart = now;
      }
    };

    const hold = () => {
      paused = true;
    };
    const release = () => {
      paused = false;
      /* Re-arm the full hold: rotStart moves to now, so the interrupted slide
         restarts rather than jumping to its exit under the finger. */
      rotStart = performance.now();
      last = 0;
    };

    const el = rootRef.current;
    el?.addEventListener("pointerdown", hold);
    el?.addEventListener("pointerenter", hold);
    el?.addEventListener("focusin", hold);
    el?.addEventListener("pointerup", release);
    el?.addEventListener("pointerleave", release);
    el?.addEventListener("pointercancel", release);
    el?.addEventListener("focusout", release);

    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      el?.removeEventListener("pointerdown", hold);
      el?.removeEventListener("pointerenter", hold);
      el?.removeEventListener("focusin", hold);
      el?.removeEventListener("pointerup", release);
      el?.removeEventListener("pointerleave", release);
      el?.removeEventListener("pointercancel", release);
      el?.removeEventListener("focusout", release);
    };
  }, [slides]);

  /* THE STILL FRAME IS THE HINT, AND UNDER REDUCED MOTION IT IS THE WHOLE OF
     WHAT SUCH A VIEWER EVER SEES — so it is a decision rather than a seed.

     A JS-driven animation cannot be stopped by the CSS gate (that makes a CLASS
     inert and has no reach into a rAF loop), so the gate has to be JS — and the
     consequence is that whatever the skeleton holds at mount is PERMANENT for
     anyone who asked for less motion.

     Freezing on a CONTACT was the first version and it is the wrong call twice
     over: it is arbitrary (why that person, forever?), and it would leave a real
     name and a dialable number standing on the app's default screen for the one
     user who cannot have it rotate away. The hint says what the pad is for,
     moves nothing, and discloses nobody. A reduced-motion viewer therefore gets
     less of this feature, which is honest: the feature IS the rotation. */
  const still = frameAt({ kind: "hint" }, MARQUEE_TIMING.IN + MARQUEE_TIMING.PROMPT - 1);

  return (
    <div
      ref={rootRef}
      /* `dir="ltr"` on the container and bidi ISOLATION on the digit run: an
         Arabic contact name sits directly beside the six cells here, and the
         owner's own directory has several. Without it the digit groups reorder
         (v2.99.77). */
      dir="ltr"
      className="rmarquee relative flex items-center justify-center w-full"
      style={{ minHeight: "inherit" }}
    >
      {/* THE NAME IS ABSOLUTE AT THE INLINE START, which is what keeps "the pin
          on the place of the six digits" literally true: a long name TRUNCATES
          rather than displacing the cells, so the PIN sits exactly where a
          dialed number always appears and does not jump when you start typing. */}
      <span
        aria-hidden="true"
        className="rmarquee-name absolute start-0 top-1/2 -translate-y-1/2 text-muted-foreground"
        style={{ opacity: String(still.nameOpacity) }}
      >
        {/* `dir="auto"` IS ON THE INNER SPAN, NOT THE POSITIONED ONE — and that
            is a measured fix rather than a preference. With it on the outer
            element an Arabic name resolved the box to RTL, and Chromium then
            resolved `inset-inline-start` against the element's OWN direction:
            the name jumped to the right-hand edge and sat on top of the digits
            at every width tested. The POSITION belongs to the container (which
            is `dir="ltr"` so the six cells cannot reorder); the name's own
            direction is a text concern and belongs to the text. */}
        <span ref={nameRef} dir="auto" className="block truncate">
          {still.nameText}
        </span>
      </span>

      {/* THE PROMPT AND THE PIN OCCUPY THE SAME CENTRED SPACE AND CROSS-FADE.
          Both are absolutely positioned, so the marquee contributes NO height of
          its own and simply centres inside the row's existing `minHeight` — which
          is what makes "zero height delta" a structural fact rather than an
          arithmetic claim. The keypad's cap subtracts a hardcoded 422px that this
          row is part of and does not shrink to absorb anything added here. */}
      <span
        ref={promptRef}
        aria-hidden="true"
        className="rmarquee-prompt absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap text-foreground/85"
        style={{ opacity: String(still.promptOpacity) }}
      >
        {still.promptText}
      </span>
      <span
        aria-hidden="true"
        className="rmarquee-pin absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 inline-flex [unicode-bidi:isolate] text-primary"
      >
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <span
            key={i}
            ref={(el) => {
              cellRefs.current[i] = el;
            }}
            className="rmarquee-cell"
            style={{ opacity: String(still.cells[i]?.opacity ?? 0) }}
          >
            {still.cells[i]?.digit ?? ""}
          </span>
        ))}
      </span>

      {/* TAPPING FILLS THE PAD AND NEVER DIALS. The target ROTATES, so a
          mistimed tap on an auto-dialling marquee would place a live call to a
          number the user never saw — strictly worse than the one-click-call hole
          this very file already closes for `?to=`. Filling the pad also flips
          the row to its `typed` branch, which unmounts the marquee: the
          interaction needs no extra state to be self-consistent. */}
      <button
        ref={btnRef}
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        className="absolute inset-0 rounded-xl"
        style={{ pointerEvents: "none" }}
        onClick={() => {
          const live = slidesRef.current[idxRef.current];
          if (live?.kind === "contact") onPick(live.contact.number);
        }}
      />
    </div>
  );
}
