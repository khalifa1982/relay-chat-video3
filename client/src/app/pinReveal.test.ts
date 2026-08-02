import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { codeOnly } from "../../../server/testing/codeOnly";
import { copyOnScreen, whyCopyMissing } from "../../../server/testing/copyOnScreen";
import { DICT } from "./i18n";
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
    expect(SRC).toMatch(/onClick=\{\(\) => leave\(\)\}/);
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

  it("scopes every rule TWICE over, so it cannot reach the rest of the app", () => {
    /* Both scopings, because they close different holes and this block has to satisfy
       the same house rule as every other one in this stylesheet:

         1. Rooted in `.relay-v2` — the app's own class, which the landing page and the
            docs page do not carry. `relayAccentVars` sweeps for this across the whole
            token layer, and a first attempt at this feature skipped it (the rules were
            written bare) and was caught by that guard rather than by this file.
         2. Every class it targets is `prv-`, exclusive to this component — so nothing
            else can select these elements however the markup is nested.

       The root rule is `.relay-v2.prv-root` (the element carries both) and its
       descendants take the ancestor form. */
    const block = CSS.slice(CSS.indexOf("PIN REVEAL (#162)"));
    const selectors = [...block.matchAll(/^\.[\w.-]+(?: \.[\w.-]+)*/gm)].map((m) => m[0]);
    expect(selectors.length).toBeGreaterThan(10);
    for (const sel of selectors) {
      expect(sel, sel).toMatch(/^\.relay-v2(?![\w-])/);
      /* Per COMPOUND, not per class: a state modifier like `.prv-beam.core` or
         `.prv-slot.set` cannot select anything foreign, because the compound as a whole
         still requires the `prv-` class. What must never appear is a compound carrying
         NEITHER — `.relay-v2 .core` would match any `.core` in the app. */
      for (const part of sel.split(" ")) {
        const classes = part.match(/\.[\w-]+/g) ?? [];
        expect(
          classes.some((c) => c === ".relay-v2" || c.startsWith(".prv-")),
          `${sel} → "${part}" is scoped by neither .relay-v2 nor a .prv- class`,
        ).toBe(true);
      }
    }
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

  it("fires TWICE — once arriving, once leaving", () => {
    /* The owner's two sentences: *"as you move from the login area to this page … it
       comes super speedily like flying in space"* and *"after 10 seconds, it will move
       again rapidly to the next page."* One jump on mount (`useState(1)`, which the
       background's effect fires because the key is truthy), one on the way out. */
    expect(SRC).toMatch(/const \[warpKey, setWarpKey\] = useState\(1\);/);
    expect(SRC).toMatch(/setWarpKey\(\(k\) => k \+ 1\);/);
    expect(SRC).toMatch(/<RelayBackground warpKey=\{warpKey\}/);
  });

  it("HOLDS the screen for the exit jump instead of vanishing under it", () => {
    /* Advancing immediately would destroy this canvas before the warp it just started
       could paint — the jump IS the transition, so it has to be visible on the surface
       that fired it. */
    const body = SRC.slice(SRC.indexOf("const leave = useCallback"));
    expect(body).toMatch(/setTimeout\(\(\) => doneRef\.current\(\), PIN_REVEAL_TIMING\.warpMs\)/);
  });

  it("leaving is IDEMPOTENT, so a tap during the exit cannot advance twice", () => {
    const body = SRC.slice(SRC.indexOf("const leave = useCallback"));
    expect(body).toMatch(/if \(leaving\.current\) return;/);
    expect(body).toMatch(/leaving\.current = true;/);
  });

  it("under reduced motion it neither jumps nor waits", () => {
    // Same rule the engine applies to itself: the effect IS the motion, so there is
    // nothing to slow the exit down for.
    const body = SRC.slice(SRC.indexOf("const leave = useCallback"));
    expect(body).toMatch(/if \(calm\) \{[\s\S]{0,80}doneRef\.current\(\);[\s\S]{0,20}return;/);
  });

  it("brings its OWN canvas, because nothing else is painting at that moment", () => {
    /* The login screen has unmounted and the shell has not mounted — exactly one
       background is ever live, which is the rule AppShell states for itself. */
    expect(SRC).toMatch(/import \{ RelayBackground \}/);
    // Dark unconditionally: every colour the handoff fixes is a dark-surface value.
    expect(SRC).not.toMatch(/<RelayBackground[^>]*\blight\b/);
    expect(SRC).toMatch(/className="prv-root dark relay-v2"/);
  });

  it("the content sits above that canvas STRUCTURALLY, not by DOM order", () => {
    /* `RelayBackground` is `position: fixed; z-index: 0`, and a positioned element at
       z-index 0 paints in the same step as an `auto` sibling — so without an explicit
       z-index the order would depend on which element happens to come last. That is
       the v2.106.27 defect (the canvas painting over the page). */
    const stack = CSS.slice(CSS.indexOf(".prv-stack {"));
    expect(stack.slice(0, 400)).toMatch(/z-index: 1;/);
    // …and the root carries the handoff's own base, since the canvas needs a surface.
    const root = CSS.slice(CSS.indexOf(".prv-root {"));
    expect(root.slice(0, 500)).toMatch(/background: #04070a;/);
  });

  it("a warpKey of 0 never jumps, so every existing mount is unchanged", () => {
    const BG = codeOnly(read("client/src/app/RelayBackground.tsx"));
    expect(BG).toMatch(/warpKey = 0/);
    expect(BG).toMatch(/if \(warpKey\) handle\.current\?\.warp\(\)/);
    /* Declared AFTER the init effect: effects run in declaration order, so a mount that
       already carries a key has its handle by the time the warp effect runs. */
    expect(BG.indexOf("initRelayBackground")).toBeLessThan(BG.indexOf("if (warpKey)"));
  });

  it("exists on the no-2D-context handle too", () => {
    /* A caller that fires a jump before navigating would otherwise throw on exactly the
       browser that branch is for. */
    const inert = ENGINE.slice(ENGINE.indexOf("if (!ctx) {"), ENGINE.indexOf("const low ="));
    expect(inert).toMatch(/warp: \(\) => \{\}/);
  });
});

/**
 * IT SPEAKS BOTH LANGUAGES (#156).
 *
 * This is the NEWEST screen in the app and it shipped English-only — which matters more
 * here than almost anywhere, because every way in passes through it: a guest name, an
 * email sign-in, and any entry surface added later, since it arms on the signed-out →
 * signed-in transition rather than on a callback per route. It was the one screen nobody
 * could avoid reading in a language they might not have.
 */
describe("the reveal is translated", () => {
  it("renders every word through the dictionary — none left as a literal", () => {
    /* A SWEEP, not a list: the string somebody adds next is covered rather than exempt.
       `codeOnly` first, because the header explains the copy it replaced. */
    /* ONE EXEMPTION, NAMED rather than a tolerance — a count-based allowance is how a
       real offender hides among the accepted ones. "RELAY" is a brand mark: it is a
       name, not language, and the test below EARNS this exemption by asserting it is
       still the brand span rather than a string that slipped through. */
    const NOT_LANGUAGE = new Set(["RELAY"]);
    const offenders: string[] = [];
    /* THE TEXT-NODE RULE IS DELIBERATELY PUNCTUATION-BLIND, and the first version of it
       was not — which a mutation caught. It allowed only letters, apostrophes and
       dashes between words, so the ONE full sentence on this screen ("…no account
       needed.") ended in a character the pattern could not cross and matched nothing:
       reverting the caption to an English literal passed every assertion in this file.
       A sweep with a hole exactly the shape of the longest string is worse than no
       sweep, because it reports coverage. It now takes any run of text between tags and
       asks whether it contains two ASCII words. */
    /* Scoped to the RENDERED JSX. A TypeScript generic (`ReturnType<typeof setTimeout>`)
       is angle brackets around text too, so sweeping the whole file reported the
       component's own timer declarations as user-facing copy — a guard crying wolf,
       which is as useless as one that never fires. The `return (` is where markup
       begins, and the code-shaped filter below is belt and braces for anything inside
       it that is still an expression rather than prose. */
    const at = SRC.indexOf("return (");
    expect(at, "the component still returns JSX").toBeGreaterThan(-1);
    for (const m of SRC.slice(at).matchAll(/>([^<>{}]+)</g)) {
      const text = m[1].replace(/\s+/g, " ").trim();
      if (/[=;:[\]|]/.test(text)) continue; // an expression, not prose
      if (!/[A-Za-z]{2}\s+[A-Za-z]{2}|^[A-Z][A-Za-z-]{2,}$/.test(text)) continue;
      if (!NOT_LANGUAGE.has(text)) offenders.push(text);
    }
    for (const m of SRC.matchAll(/aria-label="([^"]+)"/g)) {
      if (!NOT_LANGUAGE.has(m[1])) offenders.push(m[1]);
    }
    expect(
      offenders,
      `these still render English rather than a key:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("its five strings exist in BOTH languages", () => {
    for (const key of [
      "pin.yourNumber",
      "pin.autoAssigned",
      "pin.online",
      "pin.caption",
      "pin.screenReader",
      "pin.continueAria",
    ] as const) {
      const e = DICT[key];
      expect(e, key).toBeTruthy();
      expect(e.en.length, key).toBeGreaterThan(0);
      // Arabic script, not a transliteration, and not the English pasted across.
      expect(e.ar, key).toMatch(/[؀-ۿ]/);
      expect(e.ar, key).not.toBe(e.en);
    }
  });

  it("the caption and the screen-reader line still SAY what they always said", () => {
    /* Through `copyOnScreen`, so this is a pin on the WORDS rather than on the key —
       and stronger than the literal it replaces, because reaching the dictionary also
       proves an Arabic half exists. */
    for (const phrase of [
      "Anyone with this number can dial you — no account needed.",
      "Your RELAY number is",
    ]) {
      expect(copyOnScreen(SRC, phrase), whyCopyMissing(SRC, phrase)).toBe(true);
    }
  });

  it("the NUMBER is interpolated INTO the sentence, never glued around it", () => {
    /* `Your RELAY number is {number}` is one translatable string. Splitting it into two
       fragments either side of the digits is the shape `dict/auth.ts` records as
       untranslatable — Arabic does not put the number between the same two words. */
    expect(DICT["pin.screenReader"].en).toContain("{number}");
    expect(DICT["pin.screenReader"].ar).toContain("{number}");
    expect(SRC).toMatch(/t\("pin\.screenReader", \{ number: `\$\{pin\.slice\(0, 3\)\} \$\{pin\.slice\(3\)\}` \}\)/);
  });

  it("the digits stay WESTERN and cannot reorder under dir=rtl", () => {
    /* Two separate facts, both load-bearing. A RELAY number read aloud has to be the
       number typed, so no Arabic-Indic numerals reach it (v2.106.84) — and the digit ROW
       is a flex row, which under `dir="rtl"` would otherwise render 317-842. The
       stylesheet pins the direction on the row itself. */
    for (const key of ["pin.screenReader", "pin.caption", "pin.yourNumber"] as const) {
      expect(DICT[key].ar, key).not.toMatch(/[٠-٩۰-۹]/);
    }
    const digits = CSS.slice(CSS.indexOf(".prv-digits {"));
    expect(digits.slice(0, 400)).toMatch(/direction: ltr/);
  });

  it("the brand mark is NOT translated — it is a name, not language", () => {
    expect(SRC).toMatch(/<span className="prv-name">RELAY<\/span>/);
  });
});
