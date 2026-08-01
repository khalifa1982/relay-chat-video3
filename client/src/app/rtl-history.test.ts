/**
 * RTL SPACING SWEEP — client/src/pages/app/History.tsx
 *
 * The app renders Arabic (v2.106.83 put `dir` on the root), so every utility that
 * encodes READING ORDER has to be logical or the screen mirrors its text and leaves
 * its spacing behind: the search glyph sits on top of the first letter, the row's
 * action cluster is shoved to the middle of the row instead of under the thumb, and
 * the roster indents away from the avatar it hangs beneath.
 *
 * WHAT THIS FILE ASSERTS, AND WHY IT IS A SWEEP RATHER THAN A LIST
 * ---------------------------------------------------------------
 * A list of "line 726 says start-3" freezes an arrangement and says nothing about the
 * rule. The property is that the file contains NO physical-direction spacing at all,
 * so the class somebody adds next is covered instead of exempt.
 *
 * THE EXEMPTION LIST IS EMPTY, DELIBERATELY. History.tsx is a first-party screen, not
 * a vendor primitive — there is no site here that is genuinely about physical screen
 * position (no centring, no physical borders or radii, no inline-style left/right;
 * each of those was checked). A future exemption must be NAMED and justified here
 * rather than admitted by loosening the sweep, because a count-based tolerance is how
 * a real regression hides among accepted ones.
 *
 * IT RUNS ON COMMENT-STRIPPED SOURCE, and that is load-bearing. This file's own
 * comments explain the conversions by NAMING the physical classes they replaced
 * ("physical `ml-auto` would have shoved it…"), so a raw scan would fail on CORRECT
 * source — the prose trap CLAUDE.md records roughly nineteen times. A companion
 * assertion proves the strip removes something real, so the strip can never be what
 * is hiding a defect.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { codeOnly } from "../../../server/testing/codeOnly";

// Resolved from __dirname, never a literal absolute path: a hardcoded repo root
// passes on the machine it was written on and can NEVER pass on a CI runner whose
// checkout lives elsewhere (v2.99.60, now a standing guard in repoHygiene).
const ROOT = resolve(__dirname, "../../..");
const PATH = "client/src/pages/app/History.tsx";
const RAW = readFileSync(resolve(ROOT, PATH), "utf8");
const SRC = codeOnly(RAW);

/**
 * Every physical-direction spacing utility Tailwind can emit, as whole tokens.
 *
 * The lookbehind is what keeps it honest: without it `rounded-lg` and
 * `place-items-center` read as `l`-something and the sweep cries wolf on correct code.
 * Vertical offsets (`-bottom-1`, `top-1/2`) and axis-symmetric ones (`inset-x-`) are
 * deliberately NOT matched — they are direction-independent and must stay physical.
 */
const PHYSICAL =
  /(?<![\w-])-?(?:p|m)[lr]-[\w./[\]%-]+|(?<![\w-])-?(?:left|right)-[\w./[\]%-]+|(?<![\w-])text-(?:left|right)(?![\w-])/g;

const found = (s: string) => s.match(PHYSICAL) ?? [];

describe("History.tsx uses logical spacing so the screen mirrors in Arabic", () => {
  it("contains no physical-direction spacing utility, with no exemptions", () => {
    // Named rather than counted: a failure should say WHICH class came back.
    expect(found(SRC)).toEqual([]);
  });

  it("the sweep is not vacuous — it really does detect the classes it forbids", () => {
    // If the regex were broken, "zero physical sites" would pass for the wrong
    // reason. Feed it the exact shapes this sweep converted.
    expect(found('className="pl-9 pr-3"')).toEqual(["pl-9", "pr-3"]);
    expect(found('className="ml-auto"')).toEqual(["ml-auto"]);
    expect(found('className="mr-0.5 inline"')).toEqual(["mr-0.5"]);
    expect(found('className="absolute left-3 -right-0.5 -left-1"')).toEqual([
      "left-3",
      "-right-0.5",
      "-left-1",
    ]);
    expect(found('className="text-left"')).toEqual(["text-left"]);
  });

  it("the sweep does not flag classes that merely LOOK physical", () => {
    // These are the false positives that would make a green sweep worthless by
    // forcing someone to loosen it.
    expect(found("rounded-lg place-items-center pointer-events-none")).toEqual([]);
    expect(found("ps-9 pe-3 ms-auto me-0.5 start-3 -end-0.5 text-start")).toEqual([]);
    // Vertical and axis-symmetric offsets are direction-independent, so they are not
    // this sweep's business and must never be "fixed" into logical ones.
    expect(found("-bottom-1 top-1/2 -translate-y-1/2 inset-x-0 px-4 py-3")).toEqual([]);
  });

  it("the comment strip removes real prose, so it cannot be hiding a defect", () => {
    // The strip is only trustworthy if it is doing work AND if the work it does is
    // confined to comments. The raw file explains the conversions by naming the
    // physical classes; the stripped file must not contain them.
    expect(RAW).toContain("physical `ml-auto` would have shoved it");
    expect(SRC).not.toContain("physical `ml-auto` would have shoved it");
  });

  it("the comment strip ate no CODE — every region of the file survives, in order", () => {
    /* The failure this guards against is v2.105.6, where a bad block-comment rule
       swallowed 7,015 CONTIGUOUS characters and every `not.toMatch` landing in the
       hole passed for the wrong reason.

       A byte-RATIO is the wrong instrument for that and my first draft used one: it
       asserted the stripped file kept 80% of its bytes and FAILED on correct source,
       because History.tsx is 34.5% comments (nearly every decision here carries its
       rationale). The correct ratio is a property of how documented the file is, not
       of whether the strip is sound. Landmarks spread from the first export to the
       last function test the real property directly — a swallowed region takes one
       of them with it — and requiring them in ASCENDING order proves the spans
       BETWEEN them still exist rather than merely the endpoints. */
    const landmarks = [
      "export function conferenceRowKeys(",
      "export function groupByPeer(",
      "export default function HistoryPage()",
      "function ConferenceItem({",
      "function SoloItem({",
      "function LiveRejoinCard({",
    ];
    const at = landmarks.map((l) => SRC.indexOf(l));
    expect(landmarks.filter((_, i) => at[i] === -1)).toEqual([]);
    expect(at).toEqual([...at].sort((a, b) => a - b));
  });

  it("the logical replacements are actually present", () => {
    // Non-vacuity in the other direction: proves this is the real, converted file
    // rather than an empty or mis-read one.
    for (const cls of ["ps-9", "pe-3", "start-3", "ms-auto", "me-0.5", "ps-12", "text-start"]) {
      expect(SRC).toContain(cls);
    }
  });
});

describe("the two avatar badges mirror TOGETHER or they collide", () => {
  /**
   * PresenceLed and DirectionBadge hang off the SAME avatar, on opposite corners, so
   * that they never overlap. Mirroring one alone would stack them on top of each
   * other in Arabic — which is why this is pinned as a PAIR rather than as two
   * independent classes. `-end-0.5` matches the identical affordance in
   * GroupCallScreen, GroupInfoSheet and Messages.
   */
  const bodyOf = (name: string) => {
    const start = SRC.indexOf(`function ${name}(`);
    expect(start, `${name} should exist`).toBeGreaterThan(-1);
    const end = SRC.indexOf("\nfunction ", start + 1);
    const body = SRC.slice(start, end === -1 ? undefined : end);
    // A stale anchor slices from the END of the file and reads something unrelated
    // (the negative-index trap, v2.99.78) — so prove the slice is real first.
    expect(body.length).toBeGreaterThan(80);
    return body;
  };

  it("the presence LED sits on the TRAILING corner", () => {
    const led = bodyOf("PresenceLed");
    expect(led).toContain("-end-0.5");
    expect(found(led)).toEqual([]);
  });

  it("the direction badge sits on the LEADING corner", () => {
    const badge = bodyOf("DirectionBadge");
    expect(badge).toContain("-start-1");
    expect(found(badge)).toEqual([]);
  });

  it("they are on OPPOSITE logical edges, so they cannot overlap in either direction", () => {
    const led = bodyOf("PresenceLed");
    const badge = bodyOf("DirectionBadge");
    expect(led).not.toContain("-start-");
    expect(badge).not.toContain("-end-");
  });

  it("their VERTICAL offsets stay physical — RTL flips the x axis, not the y", () => {
    expect(bodyOf("PresenceLed")).toContain("-bottom-0.5");
    expect(bodyOf("DirectionBadge")).toContain("-bottom-1");
  });
});

describe("the spacing sweep did not disturb the screen's copy", () => {
  it("the search field kept its translated placeholder and label", () => {
    // This is the one JSX block the sweep rewrote wholesale (icon + input), so it is
    // the one place a spacing edit could plausibly have dropped translated copy.
    // Scoped to what THIS change could break — the dictionary itself is not this
    // file's business.
    expect(SRC).toContain('placeholder={t("history.search")}');
    expect(SRC).toContain('aria-label={t("history.searchLabel")}');
  });

  it("the search glyph and the padding that reserves room for it move together", () => {
    /* `ps-9` exists to clear THIS icon. If the icon flipped to `start-3` and the
       padding stayed `pl-9`, the glyph would land on top of the first character in
       Arabic — a half-conversion that looks done and is not.

       Anchored on the WRAPPER, because my first draft anchored on
       `value={historySearch}` and failed on correct source: the glyph is rendered
       ABOVE the input, so a forward slice from the input could never contain it. */
    const anchor = 'className="mb-2.5 relative"';
    expect(SRC.split(anchor).length - 1, "anchor must be unique").toBe(1);
    const block = SRC.slice(SRC.indexOf(anchor), SRC.indexOf(anchor) + 560);
    expect(block.length).toBeGreaterThan(100);
    expect(block).toContain("start-3");
    expect(block).toContain("ps-9");
    expect(found(block)).toEqual([]);
  });
});
