/**
 * RTL SPACING SWEEP — `client/src/pages/app/Contacts.tsx`
 *
 * WHAT THIS PINS, AND WHY IT IS A SWEEP RATHER THAN A LIST
 * -------------------------------------------------------
 * The app renders Arabic and `dir` is written on the ROOT, so every LOGICAL spacing
 * utility flips for free and every PHYSICAL one silently does not. A physical `pl-10`
 * beside a logical `ms-auto` is not a style inconsistency — it is a layout that is
 * correct in one language and wrong in the other, with nothing on screen saying so.
 * This file was already HALF converted (`ps-[54px]` and `ms-auto` on the row's line 2)
 * while ten other sites stayed physical, which is exactly that state.
 *
 * The load-bearing assertion is a SWEEP over the whole file, not an enumeration of the
 * ten sites this release converted: an enumeration goes stale the moment somebody adds
 * the next `pl-2`, which is precisely the occurrence that would not be caught.
 *
 * WHY `codeOnly`
 * --------------
 * The conversions carry comments that NAME the classes they are about (`ps-10`,
 * `-end-0.5`, `ms-auto`). A count taken over raw source therefore reads one higher than
 * the number of real class strings, and a `not.toMatch` over raw source would match the
 * English explaining why a pattern is absent — the prose trap this repo has hit roughly
 * twenty times. Every assertion here runs on comment-stripped source, with a companion
 * check proving the strip removes something real so it can never be hiding a live
 * offender instead.
 *
 * THE TWO EXCEPTIONS THIS FILE MUST KEEP PHYSICAL
 * -----------------------------------------------
 * 1. `top-1/2 -translate-y-1/2` on the two search icons is the BLOCK axis. It does not
 *    mirror, and "converting" it would be the classic over-eager mistake, so it is
 *    pinned as still present rather than left to somebody's judgement.
 * 2. `left-1/2 -translate-x-1/2` centring is direction-INDEPENDENT (`start-1/2` pushes
 *    the wrong way in RTL). It does not occur here today, and the detector is written so
 *    it would be PERMITTED rather than flagged if it arrived — nobody should ever be
 *    pressured to "fix" a correct centre into a broken one.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { codeOnly } from "../../../server/testing/codeOnly";

// Resolved from `__dirname`, never a machine-specific absolute literal — a hardcoded
// `/home/user/...` root passes locally and can NEVER pass on a CI runner (v2.99.60).
const ROOT = resolve(__dirname, "../../..");
const SRC_PATH = resolve(ROOT, "client/src/pages/app/Contacts.tsx");
const RAW = readFileSync(SRC_PATH, "utf8");
const CODE = codeOnly(RAW);

/**
 * Physical, direction-DEPENDENT utilities. Deliberately excludes:
 *   - `left-1/2` / `right-1/2` (centring — must stay physical),
 *   - `top-`/`bottom-` (the block axis does not mirror),
 *   - `px-`/`py-`/`mx-`/`my-` (symmetric),
 *   - `justify-*`/`items-*` (flexbox already honours `direction`).
 *
 * WIDENED FROM THE SIBLING SWEEPS' COPY, AND THE GAP WAS REAL
 * -----------------------------------------------------------
 * `rtl-messages.test.ts` spells the value part `[0-9][0-9a-z./]*` — it must START WITH A
 * DIGIT — so `ml-auto` and `mr-auto` are invisible to it. Those are among the most common
 * direction-dependent utilities in the codebase (push a thing to the trailing edge), and
 * `ml-auto` was one of the ten offenders in THIS file: the sweep would have reported
 * "zero physical hits" while it survived. Found by an assertion of mine failing against
 * the copied detector, which is what that assertion is for.
 *
 * The keyword values (`auto`, `px`, `full`) are therefore accepted alongside the numeric
 * ones. Messages.tsx and History.tsx are clean of this shape TODAY (checked — the only
 * `ml-auto` occurrences there are in prose explaining its removal), so nothing is
 * currently escaping; their detectors just could not catch the next one. Propagating this
 * widening to them is the orchestrator's call — they are not this task's files.
 */
const PHYSICAL = new RegExp(
  "(?:^|[\\s\"'`{(+])" +
    "(-?(?:pl|pr|ml|mr|border-l|border-r|rounded-l|rounded-r|space-x|divide-x|scroll-pl|scroll-pr)-(?:\\[[^\\]]*\\]|[0-9][0-9a-z./]*|auto|px|full)" +
    "|-?(?:left|right)-(?:\\[[^\\]]*\\]|[0-9][0-9a-z.]*|auto|px|full)" +
    "|text-left|text-right" +
    "|origin-left|origin-right)" +
    // The trailing `/` in the lookahead is what exempts CENTRING: without it the class
    // matches `left-1` out of `left-1/2` and stops at the slash, so the sweep flags a
    // utility that is CORRECTLY physical. The `-a-zA-Z0-9` half is what stops
    // `rounded-lg` being read as `rounded-l` — a false positive an ad-hoc grep does hit.
    "(?![-a-zA-Z0-9/])",
  "g",
);

function physicalHits(source: string): string[] {
  return [...source.matchAll(PHYSICAL)].map((m) => m[1]);
}

/** Occurrences of a literal class string in comment-stripped source. */
function count(cls: string): number {
  return CODE.split(cls).length - 1;
}

describe("Contacts.tsx — RTL spacing sweep", () => {
  it("the harness reads a real file and the comment strip removes real prose", () => {
    // Non-vacuity. A sweep over an empty string passes for the wrong reason, and a
    // `codeOnly` that swallowed the file would make every assertion below vacuous
    // (the v2.105.6 defect, where a bad strip ate 7,015 characters and eight test
    // files went quietly green).
    expect(RAW.length).toBeGreaterThan(40_000);
    expect(CODE.length).toBeGreaterThan(20_000);
    expect(CODE.length).toBeLessThan(RAW.length);
    // The strip must remove COMMENTS, not code: class strings survive it.
    expect(CODE).toContain("text-start");
    expect(CODE).toContain("ps-[54px]");
    // …and it really does remove the prose that would otherwise inflate the counts
    // below. This file's comments NAME `-end-0.5`, so raw source carries one more of
    // it than there are real class strings.
    expect(RAW.split("-end-0.5").length - 1).toBeGreaterThan(count("-end-0.5"));
  });

  it("the detector actually bites (it is not a regex that matches nothing)", () => {
    // A sweep that can never fire reports safety. Prove it fires on every shape it
    // claims to cover — including the exact ten this file had — before trusting a
    // clean result.
    expect(physicalHits('className="h-11 pl-10 rounded-xl"')).toEqual(["pl-10"]);
    expect(physicalHits('className="absolute left-3 top-1/2"')).toEqual(["left-3"]);
    expect(physicalHits('className="size-4 mr-1.5"')).toEqual(["mr-1.5"]);
    expect(physicalHits('className="flex-1 text-left font-mono"')).toEqual(["text-left"]);
    expect(physicalHits('className="absolute -bottom-0.5 -right-0.5 size-3"')).toEqual([
      "-right-0.5",
    ]);
    // The keyword-valued family the copied detector could not see. `ml-auto` was a real
    // offender in this file, so this case is the one that earns the widening.
    expect(physicalHits('className="size-3.5 ml-auto text-primary"')).toEqual(["ml-auto"]);
    expect(physicalHits('className="mr-auto ml-px"')).toEqual(["mr-auto", "ml-px"]);
    expect(physicalHits('className="left-auto right-full"')).toEqual(["left-auto", "right-full"]);
    expect(physicalHits('"a " + (x ? "text-right" : "text-left")')).toEqual([
      "text-right",
      "text-left",
    ]);
    expect(physicalHits('className="border-l-[2.5px] pr-3"')).toEqual([
      "border-l-[2.5px]",
      "pr-3",
    ]);
  });

  it("the detector does NOT flag the things that are correctly physical or symmetric", () => {
    // Centring is direction-independent and MUST stay physical.
    expect(physicalHits('className="left-1/2 -translate-x-1/2"')).toEqual([]);
    // The block axis does not mirror — this file's search icons rely on it.
    expect(physicalHits('className="top-1/2 -translate-y-1/2 -bottom-0.5"')).toEqual([]);
    // Symmetric padding/margin.
    expect(physicalHits('className="px-4 md:px-5 py-2.5 mx-1"')).toEqual([]);
    // Flexbox already honours `direction`.
    expect(physicalHits('className="justify-end items-center"')).toEqual([]);
    // Not spacing utilities that merely contain the letters. `rounded-lg` is the one
    // an unbounded pattern really does mis-flag.
    expect(physicalHits('className="rounded-lg rounded-full border-border"')).toEqual([]);
    expect(physicalHits('className="relative flex-1 tracking-wider"')).toEqual([]);
    // The widened keyword branch must not reach symmetric or logical utilities: `px-4`
    // is symmetric padding (the prefix list holds `pl`/`pr`, never `px`), and `ms-auto`
    // is the logical form this sweep exists to arrive at.
    expect(physicalHits('className="px-4 ms-auto me-px start-full"')).toEqual([]);
  });

  it("carries ZERO physical directional spacing utilities", () => {
    // THE PROPERTY. Not "these ten sites were converted" — that list goes stale on the
    // next `pl-2` somebody adds, which is precisely the one that would not be caught.
    expect(physicalHits(CODE)).toEqual([]);
  });

  it("uses the logical counterparts, rather than having deleted the spacing", () => {
    // Guards the cheap way to satisfy the sweep: dropping a utility mirrors nothing and
    // silently changes the layout in BOTH languages. Each entry is a site the sweep
    // above would otherwise be entirely silent about.
    expect(count("start-3")).toBe(2); // both search icons
    expect(count("ps-10")).toBe(2); // the fields those icons sit in
    expect(count("me-1.5")).toBe(1); // icon-before-label in the empty-state button
    expect(count("text-start")).toBe(2); // section heading + the row's main-area button
    expect(count("-end-0.5")).toBe(2); // the two presence LEDs
    expect(count("ms-auto")).toBe(3); // row actions (pre-existing) + category tick + ringtone tick (QW-11)
  });

  it("each search icon sits on the SAME logical edge as the padding that clears it", () => {
    // THE ONE FAILURE MODE WITH REAL CONSEQUENCES, and the reason these are converted
    // as pairs rather than as four independent sites. The icon is absolutely positioned
    // at the field's leading edge; the field reserves `ps-10` to clear it. Convert one
    // alone and the glyph sits on the opposite edge from its own gap, so in Arabic the
    // typed text runs straight underneath it — a field that looks fine in English and
    // is unreadable in Arabic.
    //
    // Asserted as MATCHED COUNTS rather than by locating each pair: a `start-3` with no
    // `ps-10` beside it is the defect whichever field it happens to be in.
    expect(count("start-3")).toBe(count("ps-10"));
    expect(count("start-3")).toBeGreaterThan(0);
    // The mirrored halves must be gone from BOTH, or one field kept the old pairing.
    expect(CODE).not.toContain("left-3");
    expect(CODE).not.toContain("pl-10");
  });

  it("the vertical centring on those icons is left PHYSICAL", () => {
    // `top-1/2 -translate-y-1/2` is the BLOCK axis. It does not mirror, and rewriting it
    // to a logical form would be the over-eager mistake this sweep must not make. Pinned
    // as still present so a future pass cannot "finish the job" by breaking it.
    expect(count("top-1/2 -translate-y-1/2")).toBe(2);
  });

  it("the presence LEDs sit on the trailing corner, matching Messages and History", () => {
    // Cross-file consistency, not a local preference. `Messages.tsx` and `History.tsx`
    // were swept to `-end-0.5` for this identical affordance (History's own comment
    // records the reason), so leaving Contacts physical would put one presence dot on a
    // different corner per screen — in Arabic only, and with nothing saying so.
    const badges = [...CODE.matchAll(/-bottom-0\.5 (-[a-z]+)-0\.5/g)].map((m) => m[1]);
    expect(badges.length).toBe(2);
    expect(new Set(badges)).toEqual(new Set(["-end"]));
  });

  it("leaves the LTR island on the PIN intact, so its digit groups cannot reorder", () => {
    // A 6-digit RELAY number beside an Arabic display name needs both `dir="ltr"` and
    // bidi isolation or its parts reorder (v2.99.77). Untouched by this sweep, pinned
    // because it sits INSIDE the row whose spacing moved — the element most likely to be
    // disturbed by an edit here.
    expect(CODE).toContain("[unicode-bidi:isolate]");
    expect(CODE).toContain('dir="ltr"');
  });

  it("changed no copy: every user-facing string still resolves through the dictionary", () => {
    // This sweep is spacing ONLY. The screen was localised in an earlier release, so the
    // translator and its keys must survive untouched — a spacing pass that quietly
    // reinstates a hardcoded English label would undo that with no test elsewhere
    // looking at this file's classes to notice.
    expect(CODE).toContain('from "@/app/i18n"');
    expect(CODE).toContain("useT()");
    expect(count("t(")).toBeGreaterThan(30);
  });
});
