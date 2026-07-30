/**
 * design_handoff_relay_app — PHASE 3, the STANDARD CALL BAR.
 *
 * This file reads `relayAssets.ts` as TEXT and imports nothing from it, which is
 * deliberate and load-bearing — see the backtick guard at the bottom.
 *
 * TWO THINGS THE BOARD ASKS FOR ARE DELIBERATELY NOT TAKEN, and both are cases where it
 * contradicts something the owner asked for in their own words. A visual decision of mine
 * is superseded by the board; an explicit request is not.
 *   1. The board says "standard 6-button call bar — NEVER REDUCED". v2.99.39 REMOVED
 *      controls from this bar at the owner's explicit request. Restyling satisfies the
 *      board's intent — one consistent bar across every call surface — without taking back
 *      anything they asked to be rid of. The control SET is untouched.
 *   2. The labels and the per-control hues stay, because v2.99.4 is the owner asking for
 *      exactly them ("all these icons different colors with a very nice shape", every
 *      button saying what it does) — and a label is the only thing a screen reader has
 *      here. The CHIP takes the board's uniform glass; the GLYPH keeps its hue.
 *   3. The end button stays a CIRCLE rather than the board's 56x50 pill, because v2.96.3
 *      made it round after the owner reported the pill "read as a blob".
 *
 * THE FINDING WORTH THE MOST HERE IS A PRE-EXISTING BUG, LIVE SINCE v2.99.4, FOUND BY
 * MEASURING RATHER THAN READING: the per-button tints were ID-scoped, and an ID is compared
 * before any number of classes — so `#micBtn .ctrl-ic` (0,1,2) outranked
 * `.ctrl.off .ctrl-ic` (0,0,4) whatever the order. The MUTED-mic red chip never rendered.
 * A muted mic showed a slashed glyph and a red LABEL over a chip still filled cheerful
 * green: the chip saying "fine" while the icon said "muted", on the one control where being
 * wrong matters most. The comment that sat there claimed "state overrides win over the
 * per-button tints" and was false. Confirmed in a browser before anything was changed.
 *
 * MEASURED, because none of this is answerable from source: the override's effect depends
 * on the cascade (v2.99.84 measured its own override doing literally NOTHING while reading
 * as correct), the phone blur depends on a media query matching, and "does `.off` still beat
 * `.on`" is now a question about rule order. Headless Chromium against the REAL exported
 * stylesheet and markup at 390 and 1280 — 8/8: uniform neutral chip both widths, blur on
 * desktop only, `.on` resolving to the accent with the board's `#04211a` glyph, and `.off`
 * beating `.on`.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SRC = readFileSync(resolve(process.cwd(), "client/src/lib/relayAssets.ts"), "utf8");
const CLIENT = readFileSync(resolve(process.cwd(), "client/src/lib/relayClient.ts"), "utf8");
const CLIENT_CODE = CLIENT.replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n").filter((l) => !/^\s*(\/\/|\*)/.test(l)).join("\n");

/** A named template literal's raw interior, straight out of the source text. */
function literal(name: string): string {
  const at = SRC.indexOf(`export const ${name}`);
  expect(at, name).toBeGreaterThan(0);
  const open = SRC.indexOf("`", at);
  const nextExport = SRC.indexOf("\nexport const ", open);
  const region = SRC.slice(open + 1, nextExport > 0 ? nextExport : SRC.length);
  const close = region.lastIndexOf("`");
  expect(close, `${name}: unterminated`).toBeGreaterThan(0);
  return region.slice(0, close);
}
const CSS = literal("RELAY_CSS");
/** CSS with comments stripped — this repo has matched its own prose 18+ times. */
const CSS_CODE = CSS.replace(/\/\*[\s\S]*?\*\//g, "");

/** A rule's own body, bounded by its own closing brace. */
function rule(sel: string): string {
  const at = CSS_CODE.indexOf(sel);
  expect(at, `no such rule: ${sel}`).toBeGreaterThan(0);
  return CSS_CODE.slice(at, CSS_CODE.indexOf("}", at) + 1);
}

const CONTROL_IDS = [
  "micBtn", "camBtn", "flipCamBtn", "screenBtn", "qualityBtn",
  "audioBtn", "pipBtn", "filterBtn", "addBtn", "hostBtn", "chatBtn",
];

describe("the per-control hue can no longer block a STATE", () => {
  it("no ID rule declares the chip's background or border", () => {
    /* THE PRE-EXISTING BUG. An ID beats any number of classes, so an ID rule owning the
       chip's fill makes `.off` and `.on` unreachable — which is exactly what happened to
       the muted-mic red for four releases. */
    for (const id of CONTROL_IDS) {
      const r = rule(`#${id}`);
      expect(r, id).not.toMatch(/background/);
      expect(r, id).not.toMatch(/border-color/);
    }
  });

  it("no ID rule declares `color` either — that would block the on-accent glyph", () => {
    /* Same trap one level down: a mid-tone hue on a bright accent fill is unreadable, so
       the ACTIVE state must be able to take the glyph dark. */
    for (const id of CONTROL_IDS) {
      expect(rule(`#${id}`), id).not.toMatch(/(^|[;{])\s*color:/);
    }
  });

  it("the hue survives — as a custom property the base rule reads", () => {
    // Nothing is discarded: the owner's per-control colour identity is intact, it has just
    // stopped competing with state for the same declaration.
    for (const id of CONTROL_IDS) {
      expect(rule(`#${id}`), id).toMatch(/--ctrl-hue:/);
    }
    expect(rule(".relay-root .ctrl .ctrl-ic")).toMatch(/color:var\(--ctrl-hue,var\(--text\)\)/);
  });

  it("the labels are still there — v2.99.4 asked for them by name", () => {
    expect(CSS_CODE).toMatch(/\.ctrl-lbl\{/);
    expect(CSS_CODE).toMatch(/\.ctrl\.off \.lbl-off\{display:inline\}/);
  });
});

describe("the board's standard bar", () => {
  it("one uniform glass chip, declared once", () => {
    const uniform = CSS_CODE.match(/\.relay-root \.ctrl \.ctrl-ic\{background:rgba\(255, ?255, ?255, ?\.14\)/g) ?? [];
    expect(uniform).toHaveLength(1);
  });

  it("ACTIVE is the cycling accent with the board's dark glyph", () => {
    const on = rule(".relay-root .ctrl.on .ctrl-ic{background:rgba(var(--rb-rgb)");
    expect(on).toMatch(/rgba\(var\(--rb-rgb\), ?\.85\)/);
    expect(on).toMatch(/color:#04211a/);
  });

  it("OFF outranks ACTIVE — a muted mic must never read as live", () => {
    /* Ordering, not specificity: both are class-level now, so the LATER one wins. Measured
       as well (the red really does resolve), because this is the one state whose being
       wrong is dangerous rather than ugly. */
    const onAt = CSS_CODE.lastIndexOf(".relay-root .ctrl.on .ctrl-ic");
    const offAt = CSS_CODE.lastIndexOf(".relay-root .ctrl.off .ctrl-ic");
    expect(onAt).toBeGreaterThan(0);
    expect(offAt).toBeGreaterThan(onAt);
  });

  it("the blur is DESKTOP ONLY — the measured v2.99.84 rule", () => {
    /* This bar sits over LIVE VIDEO, where v2.99.84 counted 36 backdrop-filter layers over
       a call grid and removed all of them on phones: nothing behind a blur can be cached
       when the backdrop changes every frame. Phones get an opaque chip of the same tone, so
       the look survives and the cost does not. */
    expect(CSS_CODE).toMatch(
      /@media \(min-width:769px\)\{\s*\.relay-root \.ctrl \.ctrl-ic\{backdrop-filter:blur\(14px\)/
    );
    expect(CSS_CODE).toMatch(
      /@media \(max-width:768px\)\{\s*\.relay-root \.ctrl \.ctrl-ic\{background:rgba\(46, ?50, ?58/
    );
  });

  it("the control SET is untouched — restyled, never reduced", () => {
    /* The board says "never reduced"; v2.99.39 REMOVED controls at the owner's explicit
       request. The set lives in the MARKUP, so that is what this asserts — every control
       still exists, and nothing new was introduced to satisfy the board's count.

       MY FIRST VERSION OF THIS WAS THE PROSE-ANCHOR TRAP, INVERTED, for the third recorded
       time: it anchored on the comment text "THE STANDARD CALL BAR" in COMMENT-STRIPPED
       source, so `indexOf` returned −1 and the slice ran the whole stylesheet. It failed on
       correct code, which is the only reason it was caught. */
    const markup = literal("RELAY_MARKUP");
    for (const id of CONTROL_IDS) expect(markup, id).toContain(`id="${id}"`);
    expect(markup).toContain('id="hangBtn"');
    // Nothing beyond the known set: a 12th control would mean the board's "six" had been
    // read as a licence to re-add what v2.99.39 removed.
    const ids = [...markup.matchAll(/class="ctrl[^"]*"[^>]*id="([a-zA-Z]+)"|id="([a-zA-Z]+)"[^>]*class="ctrl[^"]*"/g)]
      .map((m) => m[1] ?? m[2]);
    expect(ids.length).toBeGreaterThan(5);
    /* `statsBtn` (the v2.105.21 call-quality readout) and `recordBtn` are real controls
       that carry no per-control hue — they fall back to the base text colour, which is
       correct: one is a mono text chip and the other only exists when recording is
       configured. Enumerating them here is what makes this list the actual control set
       rather than my recollection of it; leaving `statsBtn` out is how the first run
       failed on correct code. */
    for (const id of ids) {
      expect([...CONTROL_IDS, "hangBtn", "recordBtn", "statsBtn"], id).toContain(id);
    }
  });

  it("the end button stays a CIRCLE, not the board's pill", () => {
    // v2.96.3, after the owner reported the old rounded-rect pill "read as a blob".
    expect(rule(".relay-root .ctrl.hangup")).toMatch(/border-radius:50%/);
  });
});

describe("the template literals are intact", () => {
  it("neither RELAY_CSS nor RELAY_MARKUP contains an interior backtick", () => {
    /* THE REASON THIS FILE IMPORTS NOTHING FROM relayAssets. A backtick inside a CSS
       comment terminates the literal — it has broken the build four times (v2.99.16,
       v2.99.82, v2.105.24, and again while writing this release) — and the guard that lived
       in `relayAssets.test.ts` could never report it: it asserts against the IMPORTED
       value, which by construction cannot contain a backtick once the literal ends early,
       and when the trap fires that file does not even parse, so vitest reports "no tests"
       rather than a failure. Reading the source as TEXT, from a file with no import of it,
       is what makes this reportable. */
    for (const name of ["RELAY_CSS", "RELAY_MARKUP"]) {
      const body = literal(name);
      expect(body.length, name).toBeGreaterThan(2000);
      expect(body.includes("`"), `${name}: a backtick inside the literal`).toBe(false);
    }
  });
});

describe("the whole call UI follows the ONE accent", () => {
  it("the call surfaces' accent token points at the cycling accent", () => {
    /* One declaration, and 59 var(--accent) sites follow it — including any added later,
       which is what a per-rule sweep can never do. This is the same leverage as repointing
       --primary for the six screens. */
    expect(CSS_CODE).toMatch(/--accent:var\(--rb,#3FE0C5\)/);
    expect(CSS_CODE).toMatch(/--accent-rgb:var\(--rb-rgb,63,224,197\)/);
  });

  it("the fallbacks are LITERALS, never self-references", () => {
    /* MY OWN SWEEP GOT THIS WRONG AND IT WOULD HAVE ERASED EVERY ACCENT IN THE CALL UI.
       Converting the hardcoded literals rewrote these two declarations' own fallbacks into
       var(--accent) / var(--accent-rgb), i.e. a custom-property CYCLE — which resolves to
       the guaranteed-invalid value, so both declarations are dropped. Caught by resolving
       the value in a browser rather than reading the file. And the fallback is not
       decoration: an UNSET custom property is an invalid declaration the browser DROPS, so
       without it a call surface with no engine has NO accent rather than a plain one. */
    expect(CSS_CODE).not.toMatch(/--accent:var\(--rb,var\(--accent\)\)/);
    expect(CSS_CODE).not.toMatch(/--accent-rgb:var\(--rb-rgb,var\(--accent-rgb\)\)/);
  });

  it("--accent2 is the same hue at lower alpha, not a second colour", () => {
    // The board has ONE accent. Two-tone gradients stay two-tone without a second hue.
    expect(CSS_CODE).toMatch(/--accent2:rgba\(var\(--accent-rgb\),\.55\)/);
    expect(CSS_CODE).toMatch(/--grad:linear-gradient\(135deg,var\(--accent\),var\(--accent2\)\)/);
  });

  it("no hardcoded accent literal is left to disagree with the variable", () => {
    /* A HALF-CONVERTED ACCENT IS WORSE THAN NONE: a rule still painting the old cyan sits
       beside one cycling through twelve hues, and the two visibly disagree. 40 literals
       were converted; this is what keeps the count at zero. */
    for (const lit of ["#3FE0C5", "#6EE7FF", "63,224,197", "110,231,255"]) {
      const hits = CSS_CODE.split(lit).length - 1;
      // The two token fallbacks are the ONLY legitimate occurrences.
      const allowed = lit === "#3FE0C5" || lit === "63,224,197" ? 1 : 0;
      expect(hits, lit).toBe(allowed);
    }
  });
});

describe("board 3a — the outgoing number as matrix digits", () => {
  it("the number is CELLS, not one text node", () => {
    /* A proportional glyph would make the row jitter sideways as each digit lands on a
       different width — the number would appear to breathe while it resolves. Measured at
       0.0px variance across the six cells. */
    expect(CLIENT_CODE).toMatch(/function paintDialDigits\(/);
    expect(rule(".relay-root .dial-card .dc-dig{")).toMatch(/min-width:\.62em/);
    expect(rule('.relay-root .dial-card .dc-num{font-family:"JetBrains Mono"')).toMatch(/display:flex/);
  });

  it("a settled digit takes the accent glow, and the glow follows the CYCLING accent", () => {
    const set = rule(".relay-root .dial-card .dc-dig.set{");
    expect(set).toMatch(/text-shadow:0 0 14px rgba\(var\(--accent-rgb\)/);
  });

  it("a SEPARATOR is never scrambled — it is punctuation, not a digit", () => {
    expect(CLIENT_CODE).toMatch(/if \(!animate \|\| !isDigit\)/);
  });

  it("a mid-dial REPAINT does not re-scramble", () => {
    /* THE ONE THING THAT WOULD READ AS A GLITCH RATHER THAN AN EFFECT. `showDialCard`
       re-runs during a single dial — the `ringing` ack carries the callee's real name — so
       scrambling unconditionally would re-scramble a number that had already settled, a
       second into the call. The `fresh` flag is what the paint is gated on. */
    expect(CLIENT_CODE).toMatch(/paintDialDigits\([\s\S]{0,140}?, fresh\);/);
  });

  it("leaving the screen clears the timers", () => {
    // Otherwise an interval writes into detached nodes for the rest of the session.
    const at = CLIENT_CODE.indexOf("function exitPreConnect()");
    expect(at).toBeGreaterThan(0);
    expect(CLIENT_CODE.slice(at, at + 200)).toMatch(/stopDialScramble\(\)/);
  });

  it("the row heartbeat is TRANSFORM only and inside the reduced-motion gate", () => {
    /* v2.99.84's rule: an animated box-shadow or width repaints every frame. And the house
       rule that all decorative motion sits behind prefers-reduced-motion — the settled state
       is a plain declaration, so a reduced-motion viewer still sees the resolved number with
       its glow, just without movement. */
    const kf = CSS_CODE.slice(CSS_CODE.indexOf("@keyframes relayDialBeat"));
    const body = kf.slice(0, kf.indexOf("}\n") + 1);
    expect(body).toMatch(/transform:scale/);
    expect(body).not.toMatch(/box-shadow|width|height|filter|opacity/);
    const beatAt = CSS_CODE.indexOf(".relay-root .dial-card .dc-num{animation:relayDialBeat");
    expect(beatAt, "the heartbeat rule must exist").toBeGreaterThan(0);
    /* BOTH spellings are in this file — `prefers-reduced-motion:no-preference` and the
       spaced form — and my first version looked only for the spaced one, so it failed on
       correct code. Match either. */
    const gates = [...CSS_CODE.matchAll(/prefers-reduced-motion:\s*no-preference/g)]
      .map((m) => m.index ?? -1).filter((i) => i >= 0 && i < beatAt);
    const gateAt = gates.length ? gates[gates.length - 1] : -1;
    expect(gateAt, "the heartbeat must sit inside a reduced-motion gate").toBeGreaterThan(0);
    // …and inside THAT block, not merely after some earlier one.
    expect(CSS_CODE.slice(gateAt, beatAt)).not.toMatch(/\n\}/);
  });
});

describe("board 1g — CONFIRMED, not rebuilt", () => {
  it("the incoming avatar already has two STAGGERED ping rings", () => {
    /* The board asks for "two staggered ping rings (2.2s)" and v2.97.0 already shipped
       exactly that shape — two `.ring-halo` elements on `relayHalo` (scale 1 -> 1.5, opacity
       .85 -> 0), the second delayed by half the cycle. Confirmed with a pin rather than
       churned for a 0.3s difference in duration: the property is TWO rings, staggered. */
    const markup = literal("RELAY_MARKUP");
    expect((markup.match(/class="ring-halo/g) ?? []).length).toBe(2);
    expect(CSS_CODE).toMatch(/@keyframes relayHalo\{0%\{transform:scale\(1\)/);
    expect(CSS_CODE).toMatch(/\.ring-halo\{animation:relayHalo [\d.]+s/);
    const delay = CSS_CODE.match(/\.ring-halo\.h2\{animation-delay:([\d.]+)s\}/);
    const dur = CSS_CODE.match(/\.ring-halo\{animation:relayHalo ([\d.]+)s/);
    expect(delay, "the second ring must be staggered").toBeTruthy();
    // Staggered by about half the cycle, so the two rings never expand together.
    expect(Number(delay![1])).toBeGreaterThan(Number(dur![1]) * 0.3);
  });
});
