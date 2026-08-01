/**
 * RTL SPACING SWEEP — `client/src/pages/app/Messages.tsx`
 *
 * WHAT THIS PINS, AND WHY IT IS A SWEEP RATHER THAN A LIST
 * -------------------------------------------------------
 * The app renders Arabic, and `dir` is written on the ROOT — so every LOGICAL spacing
 * utility flips for free and every PHYSICAL one silently does not. A physical `pl-9`
 * beside a logical `ms-auto` is not a style inconsistency, it is a layout that is
 * correct in one language and wrong in the other, with nothing on screen saying so.
 *
 * The load-bearing assertion is therefore a SWEEP over the whole file (`no physical
 * directional utility survives in the CODE`), not an enumeration of the sites this
 * release converted: an enumeration goes stale the moment somebody adds the next
 * `pl-2`, which is exactly the occurrence that would not be caught.
 *
 * WHY `codeOnly`
 * --------------
 * This file quotes the design board's own CSS in prose (`border-left: 2.5px solid
 * var(--rb)`) and explains the menu's edge mapping in words. A raw `not.toMatch` would
 * match that ENGLISH and fail on correct source — the prose trap this repo has hit
 * roughly twenty times. Every sweep here runs on comment-stripped source, and a
 * companion assertion proves the strip removes something real, so it can never be
 * hiding a live offender instead.
 *
 * THE CENTRING EXCEPTION
 * ----------------------
 * `left-1/2` + `-translate-x-1/2` is direction-INDEPENDENT and must stay PHYSICAL —
 * `start-1/2` pushes the wrong way in RTL. It does not occur in this file today, and
 * the sweep is written so that it would be permitted rather than flagged if it
 * arrived, so nobody is ever pressured to "fix" a correct centre into a broken one.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { codeOnly } from "../../../server/testing/codeOnly";

const ROOT = resolve(__dirname, "../../..");
const SRC_PATH = resolve(ROOT, "client/src/pages/app/Messages.tsx");
const RAW = readFileSync(SRC_PATH, "utf8");
const CODE = codeOnly(RAW);

/**
 * Physical, direction-DEPENDENT utilities. Deliberately excludes:
 *   - `left-1/2` / `right-1/2` (centring — must stay physical),
 *   - `top-`/`bottom-` (the block axis does not mirror),
 *   - `px-`/`py-`/`mx-`/`my-` (symmetric),
 *   - `justify-*`/`items-*` (flexbox already honours `direction`).
 */
const PHYSICAL = new RegExp(
  "(?:^|[\\s\"'`{(+])" +
    "(-?(?:pl|pr|ml|mr|border-l|border-r|rounded-l|rounded-r|space-x|divide-x|scroll-pl|scroll-pr)-(?:\\[[^\\]]*\\]|[0-9][0-9a-z./]*)" +
    "|-?(?:left|right)-(?:\\[[^\\]]*\\]|[0-9][0-9a-z.]*)" +
    "|text-left|text-right" +
    "|origin-left|origin-right)" +
    // The trailing `/` in the lookahead is what exempts CENTRING. A first draft ended
    // the class at `[0-9][0-9a-z.]*`, which matches `left-1` out of `left-1/2` and stops
    // at the slash — so the sweep flagged a utility that is CORRECTLY physical and would
    // have pressured the next reader into `start-1/2`, which pushes the wrong way in RTL.
    // Fractions are the proportional-positioning family; no real physical spacing
    // utility carries one.
    "(?![-a-zA-Z0-9/])",
  "g",
);

function physicalHits(source: string): string[] {
  return [...source.matchAll(PHYSICAL)].map((m) => m[1]);
}

describe("Messages.tsx — RTL spacing sweep", () => {
  it("the harness reads a real file and the comment strip removes real prose", () => {
    // Non-vacuity. A sweep over an empty string passes for the wrong reason, and a
    // `codeOnly` that swallowed the file would make every `not.toMatch` below vacuous
    // (the v2.105.6 defect, where a bad strip ate 7,015 characters and eight test
    // files went quietly green).
    expect(RAW.length).toBeGreaterThan(150_000);
    expect(CODE.length).toBeGreaterThan(80_000);
    expect(CODE.length).toBeLessThan(RAW.length);
    // The strip must remove COMMENTS, not code: the class strings survive it.
    expect(CODE).toContain("text-start");
    expect(CODE).toContain("ms-auto");
  });

  it("the detector actually bites (it is not a regex that matches nothing)", () => {
    // A sweep that can never fire reports safety. Prove it fires on each shape it
    // claims to cover before trusting that it found none.
    expect(physicalHits('className="pl-9 pr-3"')).toEqual(["pl-9", "pr-3"]);
    expect(physicalHits('className="absolute left-3"')).toEqual(["left-3"]);
    expect(physicalHits('className="-right-0.5"')).toEqual(["-right-0.5"]);
    expect(physicalHits('className="border-l-[2.5px]"')).toEqual(["border-l-[2.5px]"]);
    expect(physicalHits('"a " + (mine ? "text-right" : "text-left")')).toEqual([
      "text-right",
      "text-left",
    ]);
    expect(physicalHits('className="ml-1 mr-1.5"')).toEqual(["ml-1", "mr-1.5"]);
  });

  it("the detector does NOT flag the things that are correctly physical or symmetric", () => {
    // Centring is direction-independent and MUST stay physical.
    expect(physicalHits('className="left-1/2 -translate-x-1/2"')).toEqual([]);
    // The block axis does not mirror.
    expect(physicalHits('className="bottom-0 top-4"')).toEqual([]);
    // Symmetric padding/margin.
    expect(physicalHits('className="px-3 py-2 mx-1"')).toEqual([]);
    // Flexbox already honours `direction`.
    expect(physicalHits('className="justify-end items-start"')).toEqual([]);
    // Not a spacing utility that happens to contain the letters.
    expect(physicalHits('className="border-border rounded-lg"')).toEqual([]);
    expect(physicalHits("style={{ borderRadius: 10 }}")).toEqual([]);
  });

  it("carries ZERO physical directional spacing utilities", () => {
    // THE PROPERTY. Not "these 44 sites were converted" — that list goes stale on the
    // next `pl-2` somebody adds, which is precisely the one that would not be caught.
    expect(physicalHits(CODE)).toEqual([]);
  });

  it("uses the logical counterparts it replaced them with", () => {
    // Guards the cheap way to satisfy the sweep: deleting the spacing rather than
    // mirroring it. Each of these is a site the sweep would otherwise be silent about.
    for (const cls of [
      "ps-9", // thread-search input, clearing its leading icon
      "pe-3",
      "start-3", // that icon
      "text-start",
      "text-end",
      "ps-10", // in-chat search input
      "border-s-2", // the story-reply chip and both composer bars
      "border-s-[2.5px]", // board 3c's reply-quote bar
      "ms-1", // the receipt tick, after the timestamp
      "me-1.5", // icon-before-label inside a button
      "end-4", // scroll-to-bottom FAB / lightbox close
      "end-16", // lightbox download, beside the close
      "start-4", // lightbox caption, opposite the controls
    ]) {
      expect(CODE).toContain(cls);
    }
  });

  it("the corner badges sit on the TRAILING corner, matching the one that was already logical", () => {
    // `-end-0.5` was already in this file (the group-photo `+` badge) before the sweep,
    // so mirroring the three presence LEDs follows an in-file precedent rather than a
    // guess about what a badge should do. Asserted as a COUNT: a badge left physical
    // would sit on the far corner from the avatar it belongs to, in Arabic only.
    const badges = [...CODE.matchAll(/-bottom-0\.5 (-[a-z]+)-0\.5/g)].map((m) => m[1]);
    expect(badges.length).toBeGreaterThanOrEqual(3);
    expect(new Set(badges)).toEqual(new Set(["-end"]));
    // The 60px thread-row LED uses the un-negated corner.
    expect(CODE).toContain("absolute bottom-0 end-0");
  });

  it("the ⋮ menu still opens toward the interior — and now does so in BOTH directions", () => {
    // v2.99.0 fixed a menu that clipped off the screen edge on wide own-bubbles. The
    // mapping is only correct while it FLIPS with the row: `justify-end` already moves
    // my ⋮ to the physical right in RTL, so a frozen `left-0` would grow the menu
    // straight off the screen — the same defect, in Arabic only.
    expect(CODE).toMatch(/mine\s*\?\s*"start-0"\s*:\s*"end-0"/);
    // And the reversed mapping stays forbidden.
    expect(CODE).not.toMatch(/mine\s*\?\s*"end-0"\s*:\s*"start-0"/);
  });

  it("the reaction-chip inset agrees with the side the chips are pushed to", () => {
    // `justify-end`/`justify-start` flip on their own; the inset beside them did not,
    // so in RTL the chips hugged one edge and were inset from the other.
    expect(CODE).toMatch(/justify-end pe-1/);
    expect(CODE).toMatch(/justify-start ps-1/);
  });

  it("the reply quote's accent bar sits on the same edge as its own padding", () => {
    // v2.106.62 gave this quote logical PADDING (`ps-2 pe-2.5`) and left the bar
    // physical, so in RTL the accent rule would have sat on the far side from the text
    // it introduces — the two halves of one element disagreeing about which edge leads.
    const quote = CODE.slice(CODE.indexOf("rounded-[9px] py-1 ps-2 pe-2.5"));
    expect(quote.length).toBeGreaterThan(200);
    expect(quote.slice(0, 200)).toContain("border-s-[2.5px]");
  });

  it("leaves the LTR islands isolated, so digits and URLs cannot reorder", () => {
    // A 6-digit RELAY number or a timestamp beside Arabic text needs both, or its parts
    // reorder. Unchanged by this sweep, pinned because it sits on the elements it moved.
    expect(CODE).toContain("[unicode-bidi:isolate]");
    expect(CODE).toContain('dir="ltr"');
  });
});
