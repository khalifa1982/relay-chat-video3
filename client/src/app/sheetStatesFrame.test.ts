import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { codeOnly } from "../../../server/testing/codeOnly";
import { expandCopy } from "../../../server/testing/copyOnScreen";
import { VOICEMAIL_MAX_MS, CAP_LABEL, fmtClock } from "./VoicemailPrompt";

/* ============================================================================
   BOARD 5h — SHEET STATES (this component's quarter)
   ============================================================================

   5h draws FOUR sheets: device approval · empty inbox · voicemail recording ·
   story → group. Three of them are somebody else's file (the bell panel in
   `AppShell`, the alerts dictionary, `Status.tsx`) and were built with their own
   frames; this file owns the fourth.

   WHAT THIS FILE PINS THAT `voicemailFrame.test.ts` DOES NOT. That file covers
   board 2g — the leave-a-message card — plus the recording panel's BEHAVIOUR
   (elapsedMs, the bounded scaleX, discard/pause wiring, the colour vocabulary).
   Read 5h's four cards together and the frame has a thesis of its own that 2g
   does not state: THE SHEET'S OWN EDGE REPORTS THE SHEET'S STATE. That is
   measured off the board's markup rather than inferred — its four borders are

     rgba(var(--rb-rgb) …)   NOTIFICATIONS — DEVICE APPROVAL   (accent: act on me)
     rgba(255,255,255,.13)   the empty inbox                   (neutral: passive)
     rgba(251,85,96,.3)      VOICEMAIL — RECORDING (MAX 60S)   (red: live)
     rgba(255,255,255,.13)   STORY POSTED TO A GROUP           (neutral: passive)

   — three distinct edges across four cards, which is a system rather than one
   card's styling. This card's edge was `border-border` in all four of its own
   states, so that signal was the last genuinely-absent part of 5h here.

   THE PINS ARE PROPERTIES, NOT PIXELS. None of them freezes the board's
   `rgba(251,85,96,.3)`: the app's red is the `--destructive` token, which is
   theme-aware, and a hex literal from a dark mock would be wrong on the light
   card. What is pinned is that the edge CHANGES WITH STATE, that it is scoped to
   the one state the board draws an edge for, that it is additive everywhere
   else, and that it cannot be assembled at runtime.
   ========================================================================== */

const ROOT = resolve(import.meta.dirname, "..", "..", "..");
const VM_PATH = "client/src/app/VoicemailPrompt.tsx";
const RAW = readFileSync(join(ROOT, VM_PATH), "utf8");
/** Comment-stripped. Every `not.toMatch` below runs on this, because this file
 *  EXPLAINS in prose the very things it must not do — the recurring trap where a
 *  sweep matches the comment that justifies the absence. */
const VM = codeOnly(RAW);

/**
 * A window bounded by its own end anchor, with BOTH anchors asserted to exist.
 *
 * A stale anchor makes `indexOf` return -1, and a negative index does not throw —
 * it silently reads from the other end of the file, so the assertion inside then
 * passes or fails for a reason unrelated to what it claims to check.
 */
function region(src: string, start: string, end: string): string {
  const a = src.indexOf(start);
  expect(a, `start anchor missing: ${start}`).toBeGreaterThanOrEqual(0);
  const b = src.indexOf(end, a + start.length);
  expect(b, `end anchor missing after start: ${end}`).toBeGreaterThan(a);
  return src.slice(a, b);
}

describe("board 5h — the sheet's own edge reports its state", () => {
  it("has a real four-state machine for the edge to report on", () => {
    // Non-vacuity for everything below. "Recording differs from the other
    // states" is a claim about a state machine, so the machine has to exist —
    // otherwise a green suite would be describing a component with one state.
    expect(VM).toMatch(/useState<"idle" \| "recording" \| "sending" \| "sent">\("idle"\)/);
    for (const s of ["idle", "recording", "sending", "sent"]) {
      expect(VM, `no state is ever entered: ${s}`).toMatch(
        new RegExp(`setRecState\\("${s}"\\)`),
      );
    }
  });

  it("tints the sheet while recording, and leaves every other state alone", () => {
    // The property, in one expression: the edge is a function of the state.
    const sheet = region(VM, 'className="rsheet ', "</div>");
    expect(sheet).toMatch(/style=\{\{\s*borderColor:/);
    expect(sheet).toMatch(/recState === "recording" \? RECORDING_EDGE : undefined/);

    // ADDITIVE, and that is the half worth pinning: the else-branch above is
    // `undefined`, so React sets no inline border at all in idle/sending/sent and
    // those three cards render byte-identically to before this state existed. A
    // literal neutral colour there would instead override `.rsheet`'s own dark
    // edge and silently change three states in order to fix one.
    //
    // The sheet's inline style carries the edge and NOTHING else — an inline
    // style beats every stylesheet rule, so anything that lands here silently
    // outranks both `.rsheet` and every Tailwind utility on the same element.
    // Keys occur at the START of the object or after a comma — anchoring on that
    // is what tells an object key apart from the TERNARY's own colon, which a
    // bare `/(\w+)\s*:/` sweep counted as a second key (it read `RECORDING_EDGE`
    // out of `? RECORDING_EDGE : undefined` and failed on correct source).
    // `region` INCLUDES its start anchor, so the marker is trimmed — otherwise
    // `^` anchors on `style=` itself and the sweep reads zero keys, i.e. passes
    // an "only borderColor" assertion by finding nothing at all.
    const style = region(sheet, "style={{", "}}").replace("style={{", "");
    const keys = [...style.matchAll(/(?:^|,)\s*([A-Za-z][\w]*)\s*:/g)].map((m) => m[1]);
    expect(keys).toEqual(["borderColor"]);
  });

  it("uses the app's own destructive token, never the board's dark-mock hex", () => {
    const edge = region(VM, "const RECORDING_EDGE", "\n");
    expect(edge).toMatch(/var\(--destructive\)/);
    // The board is a DARK design and this card is `bg-card`, i.e. white in the
    // light theme (its own header records why it carries `relay-v2` and
    // deliberately not `dark`). Freezing `#fb5560` would paint a dark mock's red
    // onto a light card and, worse, stop following the theme.
    expect(VM).not.toMatch(/#fb5560/i);
    expect(VM).not.toMatch(/251\s*,\s*85\s*,\s*96/);
  });

  it("cannot be a runtime-composed class, and keeps the shared .rsheet recipe", () => {
    // A class name assembled at render time is invisible to the JIT and comes
    // out unstyled — which is why the tint is an inline style at all.
    //
    // THE RULE IS "NO RUNTIME VALUE REACHES A CLASS NAME", NOT "NO CONCATENATION".
    // A first draft of this banned `+` inside `className` outright and FAILED ON
    // CORRECT SOURCE: this component deliberately picks between two WHOLE static
    // class names with a ternary and concatenates the winner (the recording dot,
    // and the rail's `origin-left`/`origin-right`, which cannot be a logical
    // utility because `transform-origin` takes physical keywords only). Both are
    // fully visible to the JIT and both are the sanctioned pattern the source
    // comments name. What is actually unsafe is a VALUE flowing into the string:
    // a template interpolation, or a bare identifier concatenated in.
    //
    // v2.107.58 EXTENDS the sanctioned pattern to the wrapper's theme class: the
    // wrapper is `className={`relay-v2 ${theme === "dark" ? "dark" : ""} …`}`, which
    // is the SAME "pick between two whole literals" shape — the JIT still sees the
    // literal `dark`, and no runtime string value reaches the class. So the guard
    // allows a template whose ONLY interpolations are literal-selecting ternaries,
    // and still bans a bare `${identifier}` or a value-carrying interpolation.
    const classNameExprs = [...VM.matchAll(/className=\{`([^`]*)`\}/g)].map((m) => m[1]);
    for (const body of classNameExprs) {
      for (const interp of [...body.matchAll(/\$\{([^}]*)\}/g)].map((m) => m[1])) {
        // A literal-selecting ternary is fine: `X ? "a" : "b"` / `X ? "a" : ""`.
        const literalTernary = /^\s*[^?]+\?\s*"[^"]*"\s*:\s*"[^"]*"\s*$/.test(interp);
        expect(literalTernary, `unsafe className interpolation: \${${interp}}`).toBe(true);
      }
    }
    // A bare identifier or value concatenated with + is still banned.
    expect(VM).not.toMatch(/className=\{[^}]*\+\s*[A-Za-z_$]/);
    // The sheet still opts into the shared surface recipe as a LITERAL. Two
    // things depend on that: `.dark.relay-v2 .rsheet` supplies the neutral dark
    // edge this tint is additive over, and a sibling pin matches the literal
    // `className="rsheet ` — so an expression here would break a file this
    // change has no business editing.
    expect(RAW).toMatch(/className="rsheet /);
  });
});

describe("board 5h — the recording panel carries every part the frame draws", () => {
  const panel = region(VM, "function RecordPanel(", "export function VoicemailPrompt(");

  it("renders the pill's five board parts", () => {
    // dot · elapsed/cap readout · live wave · elapsed-vs-cap rail · pause.
    // Each asserted by the property that makes it that part, not by its classes.
    expect(panel, "no pulsing state dot").toMatch(/rounded-full[^"]*"\s*\+\s*\(paused \?/);
    expect(panel, "readout is not the board's elapsed / cap shape").toMatch(
      /\{CAP_LABEL\}/,
    );
    expect(panel, "the wave is not driven by the recorder's own level()").toMatch(
      /rec\.level\(\)/,
    );
    expect(panel, "no elapsed-vs-cap rail").toMatch(/scaleX\(/);
    expect(panel, "pause does not read the recorder's state back").toMatch(
      /onTogglePause/,
    );
  });

  it("the readout composes to the board's own '0:23 / 1:00'", () => {
    // Behavioural, because a source pin cannot tell you what the panel actually
    // reads at 23 seconds — and 5h prints that exact string.
    expect(`${fmtClock(23)} / ${CAP_LABEL}`).toBe("0:23 / 1:00");
    // …and the right-hand side is derived, so the readout and the recorder's own
    // ceiling cannot come to disagree.
    expect(CAP_LABEL).toBe(fmtClock(VOICEMAIL_MAX_MS / 1000));
  });

  it("keeps the readout bidi-isolated, because it is two clocks around a slash", () => {
    // Digits are weak and "/" is neutral, so in an RTL paragraph "0:23 / 1:00"
    // reorders and the panel claims the take is already past its cap.
    const readout = region(panel, "{CAP_LABEL}", "</span>");
    expect(readout.length).toBeGreaterThan(0);
    const wrapper = region(panel, 'dir="ltr"', "{CAP_LABEL}");
    expect(wrapper).toMatch(/unicode-bidi:isolate/);
  });
});

describe("board 5h — the two caption clauses this app cannot honestly say", () => {
  /* 5h's caption reads "They hear your greeting first · sending declines the
     call". Both halves describe a product this is not, and the component's
     header already records the refusal with reasons. Pinned so a later pass
     cannot "finish the frame" by pasting the board's words back in.

     EXPANDED FIRST, and that is not optional: this screen's copy lives in
     `dict/voicemail.ts`, so a raw sweep for an English sentence would match
     NOTHING and go green while covering zero copy — a guard reporting safety is
     worse than one going red (v2.106.85). */
  const copy = expandCopy(VM);

  it("the expansion is doing real work, so the sweeps below are not vacuous", () => {
    // If the dictionary ever stops resolving, this fails before the two rules
    // below can pass for the wrong reason: an English sentence that exists ONLY
    // in `dict/voicemail.ts` has to appear here after expansion and nowhere in
    // the component before it.
    //
    // NOT A LENGTH COMPARISON. A first draft asserted the expansion GREW the
    // text and failed on correct source — `t("voicemail.autoStop", { seconds })`
    // is longer than the sentence it resolves to, so expanding this file
    // legitimately shrinks it. Length was never the property; substitution is.
    expect(VM).not.toMatch(/Sending stops the recording/);
    expect(copy).toMatch(/Sending stops the recording/);
  });

  it("claims no greeting, because there is no greeting feature", () => {
    expect(copy).not.toMatch(/greeting/i);
  });

  it("claims sending declines a call, when no call is left to decline", () => {
    // This card is only ever mounted AFTER a dial has ended, so there is no live
    // call at this point — the sentence would be false on its face.
    expect(copy).not.toMatch(/declines the call/i);
    expect(copy).not.toMatch(/decline[s]? (?:the|this) (?:call|dial)/i);
  });
});
