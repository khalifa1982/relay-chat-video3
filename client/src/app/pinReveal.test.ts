import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { codeOnly } from "../../../server/testing/codeOnly";
import {
  PIN_REVEAL_TIMING,
  isRevealablePin,
  pinRevealTotalMs,
  settledIndexAt,
} from "./PinReveal";

/**
 * THE PIN REVEAL (#162) — `design_handoff_pin_reveal/`.
 *
 * Owner: *"before you go to the dashboard screen, there is a PIN number page where it
 * shows you your number (either guest or member)"*, arriving with a background that
 * *"comes super speedy like flying in space"*, and *"after 10 seconds, it will move again
 * rapidly to the next page."*
 *
 * The handoff calls its timings FINAL, so they are pinned as values rather than described.
 * The settle is driven arithmetically because the one thing that actually matters — does
 * every digit lock, and does the last one lock right-to-left — is invisible in a source
 * assertion.
 */
const ROOT = path.resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");
const SRC = codeOnly(read("client/src/app/PinReveal.tsx"));
const CSS = read("client/src/index.css");
const ENGINE = codeOnly(read("client/src/lib/relayBackground.ts"));

describe("the settle runs right to left and always finishes", () => {
  it("locks nothing during the grace window", () => {
    expect(settledIndexAt(0)).toBe(5);
    expect(settledIndexAt(PIN_REVEAL_TIMING.settleGrace - 1)).toBe(5);
  });

  it("locks ONE digit per step, from the right", () => {
    const { settleGrace, settleStep } = PIN_REVEAL_TIMING;
    // settledIndex is the LAST UNSETTLED slot, so it walks 5 → -1.
    expect(settledIndexAt(settleGrace)).toBe(5);
    expect(settledIndexAt(settleGrace + settleStep)).toBe(4);
    expect(settledIndexAt(settleGrace + settleStep * 3)).toBe(2);
    expect(settledIndexAt(settleGrace + settleStep * 5)).toBe(0);
  });

  it("REACHES -1 — every digit locks, including the leftmost", () => {
    /* The failure this exists for: an off-by-one that stops at 0 leaves the first digit
       scrambling forever, and the reveal never completes — which also means the
       auto-advance never fires and the person is stranded before their inbox. */
    expect(settledIndexAt(PIN_REVEAL_TIMING.settleGrace + PIN_REVEAL_TIMING.settleStep * 6)).toBe(-1);
    expect(settledIndexAt(999_999)).toBe(-1);
  });

  it("never runs backwards, at any point on the timeline", () => {
    let prev = 6;
    for (let ms = 0; ms <= 3000; ms += 7) {
      const s = settledIndexAt(ms);
      expect(s).toBeLessThanOrEqual(prev);
      prev = s;
    }
    expect(prev).toBe(-1);
  });

  it("the total is the flash plus the whole settle", () => {
    expect(pinRevealTotalMs()).toBe(2300 + 350 + 150 * 6);
  });
});

describe("a number it cannot reveal never animates", () => {
  it("accepts exactly six digits and nothing else", () => {
    expect(isRevealablePin("842317")).toBe(true);
    for (const bad of ["", "84231", "8423177", "84231a", " 842317", "842-317", null, undefined]) {
      expect(isRevealablePin(bad as string), String(bad)).toBe(false);
    }
  });

  it("advances IMMEDIATELY rather than scrambling onto nothing", () => {
    /* This screen sits between a person and their inbox. A reveal that settled onto
       "undefine" would be worse than no reveal, and a reveal that hung would cost them
       the app. Both effects bail on `!ok`. */
    expect(SRC).toMatch(/const ok = isRevealablePin\(pin\)/);
    expect(SRC).toMatch(/if \(calm \|\| !ok\) return;/);
    expect(SRC).toMatch(/if \(!ok\) \{[\s\S]{0,160}setTimeout\(\(\) => doneRef\.current\(\), 0\)/);
  });
});

describe("the owner's two explicit numbers", () => {
  it("holds for 10 seconds before advancing", () => {
    expect(PIN_REVEAL_TIMING.autoAdvanceMs).toBe(10_000);
  });

  it("starts that clock when the number is READABLE, not on mount", () => {
    /* Otherwise the animated path spends 3.2s of its ten seconds still scrambling while
       the reduced-motion path gets the full ten — two very different amounts of time to
       read the one thing the screen exists to show. */
    expect(SRC).toMatch(/const from = calm \? 0 : pinRevealTotalMs\(\);/);
    expect(SRC).toMatch(/from \+ PIN_REVEAL_TIMING\.autoAdvanceMs/);
  });

  it("can be skipped by a tap, and by the keyboard", () => {
    /* The 10s is the owner's, but a full-screen surface with no exit is what people
       report as frozen. */
    expect(SRC).toMatch(/onClick=\{\(\) => doneRef\.current\(\)\}/);
    expect(SRC).toMatch(/e\.key === "Enter" \|\| e\.key === " "/);
  });

  it("reads the advance from a REF, so a re-render cannot strand it", () => {
    expect(SRC).toMatch(/doneRef\.current = onDone;/);
    expect(SRC).not.toMatch(/setTimeout\(onDone/);
  });
});

describe("the handoff's timings are transcribed, not approximated", () => {
  it("matches design_handoff_pin_reveal exactly", () => {
    expect(PIN_REVEAL_TIMING.chargeAt).toBe(700);
    expect(PIN_REVEAL_TIMING.flashAt).toBe(2300);
    expect(PIN_REVEAL_TIMING.scrambleTick).toBe(55);
    expect(PIN_REVEAL_TIMING.settleGrace).toBe(350);
    expect(PIN_REVEAL_TIMING.settleStep).toBe(150);
    expect(PIN_REVEAL_TIMING.beamFade).toBe(2200);
  });

  it("the beam fades over 2.2s and the digits stay lit", () => {
    // "the light reduces slowly, never covers the PIN" — the owner's own requirement.
    expect(CSS).toMatch(/\.prv-capsule\.hold \.prv-beam \{[^}]*opacity: 0;[^}]*transition: opacity 2\.2s ease-out/);
    expect(CSS).toMatch(/\.prv-capsule\.lit \.prv-digit \{ opacity: 1/);
  });

  it("every timer is cleaned up on unmount", () => {
    expect(SRC).toMatch(/timers\.forEach\(clearTimeout\)/);
    expect(SRC).toMatch(/if \(ticker\) clearInterval\(ticker\)/);
  });
});

describe("it never hardcodes the accent", () => {
  it("uses --rb / --rb-rgb so the capsule cycles with the page", () => {
    /* The handoff is explicit: "All accent colors reference --rb / --rb-rgb, which
       relay-bg.js cycles live; never hardcode the teal." The literal appears ONLY as a
       CSS fallback for the frame before the engine publishes — an unset custom property
       is an INVALID declaration the browser drops, which would leave the capsule with no
       colour at all (the v2.106.7 trap). */
    const block = CSS.slice(CSS.indexOf("PIN REVEAL (#162)"));
    expect(block.length).toBeGreaterThan(3000);
    expect(block).toMatch(/var\(--rb, #35e0b4\)/);
    expect(block).toMatch(/var\(--rb-rgb, 53, 224, 180\)/);
    // …and never as a bare value with no variable in front of it.
    expect(block).not.toMatch(/(?<!var\(--rb, )#35e0b4/);
  });

  it("scopes every rule to .prv-, so it cannot reach the rest of the app", () => {
    const block = CSS.slice(CSS.indexOf("PIN REVEAL (#162)"));
    const selectors = [...block.matchAll(/^\.([a-z][\w-]*)/gm)].map((m) => m[1]);
    expect(selectors.length).toBeGreaterThan(10);
    for (const s of selectors) expect(s, s).toMatch(/^prv-/);
  });

  it("its keyframes are namespaced and gated on reduced motion", () => {
    const block = CSS.slice(CSS.indexOf("PIN REVEAL (#162)"));
    const frames = [...block.matchAll(/@keyframes ([\w-]+)/g)].map((m) => m[1]);
    expect(frames.length).toBeGreaterThan(0);
    // A keyframe name declared anywhere is GLOBAL, so namespacing is the only scoping.
    for (const f of frames) expect(f, f).toMatch(/^prv/);
    for (const f of frames) {
      const at = block.indexOf(`animation: ${f}`);
      expect(at, `${f} is never used`).toBeGreaterThan(-1);
      const before = block.slice(0, at);
      expect(before.lastIndexOf("prefers-reduced-motion: no-preference")).toBeGreaterThan(
        before.lastIndexOf("@keyframes"),
      );
    }
  });
});

describe("the hyperspace warp", () => {
  it("is a one-shot on the EXISTING loop, not a second animation", () => {
    /* This canvas is already the most expensive thing on the screen; a parallel loop or a
       CSS layer over it is the v2.99.84 cost class. */
    expect(ENGINE).toMatch(/warp\(ms = 900\)/);
    expect(ENGINE).toMatch(/warpUntil = performance\.now\(\) \+ warpSpan;/);
    expect((ENGINE.match(/requestAnimationFrame/g) ?? []).length).toBeLessThanOrEqual(2);
  });

  it("RESTARTS rather than stacking", () => {
    // Two overlapping warps would multiply the streak length without bound.
    expect(ENGINE).toMatch(/warpSpan = Math\.max\(1, ms\);/);
    expect(ENGINE).not.toMatch(/warpUntil \+=/);
  });

  it("is a NO-OP under reduced motion — the effect IS the motion", () => {
    const body = ENGINE.slice(ENGINE.indexOf("warp(ms = 900)"));
    expect(body.slice(0, 200)).toMatch(/if \(calm\) return;/);
  });

  it("collapses to the ordinary star draw when it is not running", () => {
    /* `k` is 0 outside a warp, so `ease` is 0 and the else-branch draws the original
       round dot — which is what makes every other screen byte-identical to before. */
    expect(ENGINE).toMatch(/const k = warpUntil > t \? Math\.min\(1, \(warpUntil - t\) \/ Math\.max\(1, warpSpan\)\) : 0;/);
    expect(ENGINE).toMatch(/if \(ease > 0\.001\) \{/);
    expect(ENGINE).toMatch(/ctx!\.beginPath\(\); ctx!\.arc\(sx0, yy, s\.r, 0, 6\.28\); ctx!\.fill\(\);/);
  });

  it("exists on the no-2D-context handle too", () => {
    /* A caller that fires a jump before navigating would otherwise throw on exactly the
       browser that branch is for. */
    const inert = ENGINE.slice(ENGINE.indexOf("if (!ctx) {"), ENGINE.indexOf("const low ="));
    expect(inert).toMatch(/warp: \(\) => \{\}/);
  });
});
