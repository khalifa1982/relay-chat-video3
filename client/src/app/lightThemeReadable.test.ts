/**
 * THE LIGHT THEME WAS UNREADABLE, AND THE DARK ONE WAS PERFECT — WHICH IS THE WHOLE SHAPE
 * OF THE BUG.
 *
 * Owner, with four screenshots: "If you see now the white theme, the coloring, it's not
 * matching at all. I cannot read it everything in white. The background is white. The
 * font is white."
 *
 * Every message bubble is a TRANSLUCENT fill — `rgba(245,140,60,.17)` for mine,
 * `rgba(255,255,255,.08)` for a received one — and the text over it was a hard-coded
 * near-white. Over the board's near-black page the effective surface is dark and that
 * reads at 15–17:1. Over the light page the effective surface is the page, so it is white
 * on white. Measured against the real built stylesheet by compositing each fill over the
 * real token and computing WCAG contrast:
 *
 *     group / 1:1 bubble body      1.04:1   (white on rgb(248,249,250))
 *     own bubble body              1.18:1
 *     new-message toggle label     1.09:1
 *     group-lock keypad digit      1.04:1
 *     voicemail prompt name        1.17:1
 *
 * THIRTEEN of thirteen light cases failed AA; all thirteen dark ones passed. It arrived at
 * v2.106.62, which removed twelve `mine ? white : muted` ternaries and made bubble text
 * white UNCONDITIONALLY — correct for the surfaces it was measured on, and it never met
 * the light page.
 *
 * WHAT IS PINNED HERE IS THE RULE, NOT THE VALUES. The specific colours are free to be
 * retuned; what must not come back is a LITERAL near-white nailed into a surface that
 * exists in both themes. So this is a sweep: no in-bubble text may be a hard-coded
 * near-white, and every theme-dependent colour must resolve through a variable that
 * `index.css` declares on BOTH sides.
 *
 * The contrast numbers themselves need a browser (Chromium hands `oklch()` back verbatim,
 * so colours have to be painted to be read) and `playwright` is deliberately not a
 * dependency of this repo — so the measurement lives outside it and what is pinned here is
 * the structure that measurement proved.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { codeOnly } from "../../../server/testing/codeOnly";

const ROOT = resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

const CSS = read("client/src/index.css");
const PEER = read("client/src/app/peerColors.ts");
const MSG = read("client/src/pages/app/Messages.tsx");
const VOICEMAIL = read("client/src/app/VoicemailPrompt.tsx");
const TYPING = read("client/src/app/TypingLine.tsx");
const SHELL = read("client/src/app/AppShell.tsx");

/** The variables this release introduced, and the surfaces each one carries. */
const THEMED_VARS = [
  "--mbub-own-fg",
  "--mbub-peer-fg",
  "--mbub-own-dim",
  "--mbub-soft",
  "--mbub-dim",
  "--mbub-stamp-mine",
  "--mbub-stamp-peer",
  "--mbub-tile",
  "--mbub-wave-track",
  "--mbub-wave-fill",
  "--mbub-disc-ring",
  "--rlock-fg",
  "--rseg-fg",
];

/**
 * EVERY block declared for one selector, concatenated.
 *
 * `.relay-v2:not(.dark)` legitimately appears TWICE — the pre-existing light token
 * palette, and the bubble-text overrides this release adds beside it — and CSS applies
 * both. Taking only the FIRST match is how this test failed against perfectly correct
 * source on its first run: it read the palette block and reported every new variable
 * missing. The question is "is this declared for this selector", so the answer has to
 * span the selector's whole footprint.
 */
function block(selector: string): string {
  /* ANCHORED TO THE LINE START, because `.relay-v2 {` is a SUBSTRING of
     `.dark.relay-v2 {` — a bare indexOf would read the dark palette as if it were the
     shared one. Same collision class that made `--rb` match `--rbub-*` while this
     release was being written. */
  const open = new RegExp(`^${selector.replace(/[.:()\\]/g, "\\$&")} \\{`, "gm");
  const parts: string[] = [];
  for (const m of CSS.matchAll(open)) {
    const at = m.index!;
    const end = CSS.indexOf("\n}", at);
    expect(end, `${selector} must be a closed block`).toBeGreaterThan(at);
    parts.push(CSS.slice(at, end));
  }
  expect(parts.length, `${selector} must exist in index.css`).toBeGreaterThan(0);
  return parts.join("\n");
}

/** Where the declaration starting at `from` ends: the next one that begins a line. */
function nextTopLevel(code: string, from: number): number {
  const re = /^(?:export |function |type |const |class )/gm;
  re.lastIndex = from + 1;
  const m = re.exec(code);
  return m ? m.index : code.length;
}

describe("every theme-dependent colour is declared on BOTH sides", () => {
  it("each variable has a base value and a light override", () => {
    /* THE COUNT IS THE PROPERTY. A variable declared only in the base block silently
       inherits the DARK value into light, which is exactly the defect — the light theme
       would look fixed in review and still be white-on-white on a phone. */
    const base = block(".relay-v2");
    const light = block(".relay-v2:not(.dark)");
    for (const v of THEMED_VARS) {
      expect(base, `${v} needs a base (dark) value`).toContain(v + ":");
      expect(light, `${v} needs a LIGHT override or dark leaks into light`).toContain(
        v + ":"
      );
    }
  });

  it("the light overrides resolve to the app's own measured tokens, not new hexes", () => {
    /* `--foreground` / `--muted-foreground` are already measured to read on `--background`
       and `--card`. Reusing them means the bubble text tracks the page for free; a second
       hand-picked palette is a second thing that can drift from the first. */
    const light = block(".relay-v2:not(.dark)");
    for (const v of ["--mbub-own-fg", "--mbub-peer-fg", "--rlock-fg", "--rseg-fg"]) {
      expect(light).toMatch(new RegExp(`${v}:\\s*var\\(--foreground\\)`));
    }
    for (const v of ["--mbub-own-dim", "--mbub-soft", "--mbub-dim"]) {
      expect(light).toMatch(new RegExp(`${v}:\\s*var\\(--muted-foreground\\)`));
    }
  });

  it("the DARK values are the ones that were previously inline — dark cannot regress", () => {
    /* Every one of these is what the source rendered before this release, so the light
       block is a pure addition. If a future edit changes a dark value it should be a
       decision, not a side effect of fixing light. */
    const base = block(".relay-v2");
    expect(base).toMatch(/--mbub-own-fg:\s*#f2fffa/i);
    expect(base).toMatch(/--mbub-peer-fg:\s*#eef7f3/i);
    expect(base).toMatch(/--mbub-dim:\s*#9fb0ab/i);
    expect(base).toMatch(/--mbub-stamp-mine:\s*#9fb0ab/i);
    expect(base).toMatch(/--mbub-stamp-peer:\s*#7d8f8a/i);
    expect(base).toMatch(/--rlock-fg:\s*#eafff6/i);
    expect(base).toMatch(/--rseg-fg:\s*#f2fffa/i);
  });
});

describe("no in-bubble text is a hard-coded near-white", () => {
  /** A colour literal light enough to vanish on a light surface. */
  const NEAR_WHITE = /#(f2fffa|eef7f3|eafff6|fff|ffffff)\b/i;

  it("the three bubble recipes carry a variable, never a literal", () => {
    const code = codeOnly(PEER);
    for (const konst of ["OWN_BUBBLE_STYLE", "PEER_BUBBLE_STYLE", "GROUP_BUBBLE_STYLE"]) {
      const at = code.indexOf(`export const ${konst}`);
      expect(at, `${konst} must exist`).toBeGreaterThan(0);
      const body = code.slice(at, code.indexOf("};", at));
      const color = /color:\s*"([^"]+)"/.exec(body);
      expect(color, `${konst} must set a text colour`).toBeTruthy();
      expect(color![1], `${konst}'s colour must be theme-aware`).toMatch(/^var\(--mbub-/);
      expect(color![1]).not.toMatch(NEAR_WHITE);
    }
  });

  it("the soft in-bubble labels go through one shared constant", () => {
    /* `text-white/75` and `/80` were three separate literals on three separate elements.
       One constant is what stops the fourth being written as a literal again. */
    const code = codeOnly(MSG);
    expect(code).toMatch(/const BUBBLE_SOFT = "text-\[color:var\(--mbub-soft\)\]"/);
    expect(
      [...code.matchAll(/BUBBLE_SOFT/g)].length,
      "the constant plus its three call sites"
    ).toBeGreaterThanOrEqual(4);
    expect(code, "no in-bubble label may go back to a flat white").not.toMatch(
      /"text-white\/(7[05]|80)"/
    );
  });

  it("the voice note and the file card inherit the bubble rather than nailing white in", () => {
    /* FOUND BY THIS TEST ON ITS FIRST RUN, in my own fix — the ban above flagged two
       components I had not converted. Both render INSIDE the bubble, so both were
       white-on-near-white in light exactly like the body text, and both would have shipped
       looking fixed. That is the fixed-in-one-of-N shape this file exists to catch.
       The correction is a REMOVAL rather than another variable: the enclosing bubble
       already sets `color`, so deleting `text-white` inherits the right value per side
       and per theme for free. */
    const code = codeOnly(MSG);
    for (const konst of ["VoiceNotePlayer", "FileCard"]) {
      const at = code.indexOf(`function ${konst}(`);
      expect(at, `${konst} must exist`).toBeGreaterThan(0);
      /* BOUNDED BY THE NEXT TOP-LEVEL DECLARATION, not by `\n}` — for
         `function f({ … }: { … })` the first line-start `}` closes the DESTRUCTURED
         PARAMETER, so a naive slice reads 92 characters of signature and every
         assertion inside it passes vacuously. CLAUDE.md records this trap six times;
         it fired here on the first run and the non-empty guard is what caught it. */
      const body = code.slice(at, nextTopLevel(code, at));
      expect(body.length, `${konst} must be a real slice`).toBeGreaterThan(200);
      expect(body, `${konst} must not override the bubble's own colour`).not.toMatch(
        /text-white\b/
      );
      // `bg-white/N` over a bubble is the same defect one property along: a translucent
      // white tile is invisible on a light bubble. The solid `bg-white` play DISC is
      // deliberately exempt — its glyph is the bubble's own dark stop (4.92:1, measured
      // across 36 surfaces), so it reads in both themes and only its ring changes.
      expect(body, `${konst} must not tint with white`).not.toMatch(/bg-white\/\d/);
    }
  });

  it("the timestamp is still muted PER SIDE, through variables", () => {
    // The per-side split is a board rule (the own bubble's warm tint carries the lighter
    // of the two); it survives the move to variables rather than being flattened.
    const code = codeOnly(MSG);
    const stamps = [
      ...code.matchAll(/color: mine \? "var\(--mbub-stamp-mine\)" : "var\(--mbub-stamp-peer\)"/g),
    ];
    expect(stamps.length, "the conversation stamp AND the search-result stamp").toBe(2);
  });
});

describe("a sender's name is darkened for light rather than re-picked", () => {
  it("the palette hex is handed over as `--rname`, and `.rname` decides the mix", () => {
    /* Sixteen runtime hues cannot be sixteen static classes and must not become sixteen
       more hand-picked hexes — that is a second palette to keep in step with the first.
       The call site passes the colour it already has; the theme owns only how far it is
       mixed toward black. At dark's 100%, `color-mix` returns the hex untouched. */
    expect(CSS).toMatch(/\.relay-v2 \.rname \{[^}]*color-mix\(in oklab, var\(--rname/);
    expect(block(".relay-v2")).toMatch(/--rname-mix:\s*100%/);
    const light = block(".relay-v2:not(.dark)");
    const mix = /--rname-mix:\s*(\d+)%/.exec(light);
    expect(mix, "light must darken the name").toBeTruthy();
    expect(Number(mix![1]), "and must actually be a darkening").toBeLessThan(100);
  });

  it("every name site delivers the colour through the variable", () => {
    /* Measured: 55% is the LIGHTEST mix clearing AA on all seventeen hues (worst 5.47:1;
       62% fails at 4.18). A site left on `color:` would keep the light tint and stay at
       1.34–1.71:1 while every other name was fixed — the fixed-in-one-of-N shape. */
    for (const [name, src] of [
      ["Messages", MSG],
      ["TypingLine", TYPING],
    ] as const) {
      const code = codeOnly(src);
      expect(code, `${name} must not colour a name directly`).not.toMatch(
        /color:\s*nameColorFor\(/
      );
      expect(code, `${name} must hand the hue over as --rname`).toMatch(/"--rname"/);
    }
  });
});

/* THE VOICEMAIL SHEET IS DELIBERATELY NOT GUARDED HERE, and saying why is the point.
 *
 * My first pass measured the callee's name on that card at 1.17:1 in light and added
 * `text-foreground` to it, on the theory that it inherited `.relay-root`'s private
 * near-black theme (`color: var(--text)` = `#EAEEF2`). BOTH halves were wrong, and only
 * measuring caught it:
 *
 *   1. The overlay is a SIBLING of the `.relay-root` host in `RelayEngine.tsx`, not a
 *      descendant — that div is self-closing — so no such inheritance reaches it.
 *   2. The real defect was that the overlay's own `relay-v2` wrapper (without `dark`)
 *      matched `.relay-v2:not(.dark)` and RE-SCOPED the tokens to light while the app was
 *      dark. v2.107.58 fixed that from a parallel session by mirroring the app theme onto
 *      the wrapper, which is the right cure.
 *
 * Re-measured against the rebased source, the card reads 16.18:1 in dark and 18.76:1 in
 * light — IDENTICAL with and without `text-foreground`. So the change was a no-op with a
 * false explanation attached, and it was reverted rather than shipped. */

describe("the bottom bar reaches the edge without burying the labels", () => {
  it("the inset is reduced by a fixed amount, floored at zero", () => {
    /* Owner, twice: the bar's background already reached the bottom — what they were
       pointing at is that the whole safe-area inset was spent as EMPTY padding under the
       labels. Measured with a 34px iPhone inset: bar 77px with 34px dead, scroll 767px;
       after, bar 63px and scroll 781px.
       `max(0px, …)` is what keeps v2.99.94 intact: with no home indicator the inset is 0,
       the subtraction floors at 0, and the bar still ends exactly at the viewport edge
       instead of acquiring a new floor. */
    const at = SHELL.indexOf("paddingBottom:");
    expect(at).toBeGreaterThan(0);
    const decl = SHELL.slice(at, SHELL.indexOf("\n", at));
    expect(decl).toMatch(/max\(0px,\s*calc\(env\(safe-area-inset-bottom\)\s*-\s*(\d+)px\)\)/);
    const px = Number(
      /calc\(env\(safe-area-inset-bottom\)\s*-\s*(\d+)px\)/.exec(decl)![1]
    );
    // BOUNDED BOTH WAYS. It must reclaim something, or the owner's report is unaddressed;
    // and it must leave clearance, because the home-indicator pill occupies roughly the
    // bottom 13px of a 34px inset — reclaiming 20+ would put the labels level with it.
    expect(px, "must actually reclaim space").toBeGreaterThan(0);
    expect(px, "must leave the home indicator its room").toBeLessThanOrEqual(16);
  });

  it("the bar is still in flow and still the last child, so it cannot scroll away", () => {
    // The reclaim is a padding change only. If the bar ever became `position: fixed` the
    // measurement above would stop describing what the user sees.
    const code = codeOnly(SHELL);
    const at = code.indexOf('"relay-appshell-chrome md:hidden shrink-0');
    expect(at, "the mobile tab bar").toBeGreaterThan(0);
    const nav = code.slice(at, at + 400);
    expect(nav).not.toMatch(/\bfixed\b/);
  });
});
