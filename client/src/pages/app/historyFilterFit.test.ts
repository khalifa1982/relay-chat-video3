import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const H = readFileSync(resolve(process.cwd(), "client/src/pages/app/History.tsx"), "utf8");
const codeOnly = (s: string) =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !/^\s*\/\//.test(l))
    .join("\n");

/**
 * v2.103.1 — the History filter bar stopped being readable on a phone.
 *
 * Owner, with a screenshot: *"All type of categorize and the call history it's overlap.
 * you cannot see it like all calls received or outgoing grouping."*
 *
 * WHAT WENT WRONG, MEASURED RATHER THAN GUESSED. v2.99.98 added a fourth filter
 * (Received) and a fifth control (the Group toggle) to a single row that already held
 * three. Each filter needs an icon, a word and a count; five such controls need roughly
 * 500px and a phone has about 390. With `flex-1` and no `min-w-0` the flex items could
 * not shrink below their content, so they collided.
 *
 * The first attempt — two rows, filters on their own — removed the OVERLAP and was still
 * wrong: at 390px each tab got 87px, which leaves about 39px for the label once the icon
 * and count are placed, and "Received" needs about 58. Headless Chromium against the real
 * built stylesheet reported every label but "All" clipped at every phone width, which is
 * why the tab content is now STACKED: icon and count share a top line, and the label gets
 * the tab's full width beneath them.
 *
 * Measured after the change at 320 / 360 / 375 / 390 / 430: 0 overlaps, 0 clipped labels,
 * no horizontal overflow, Group and Clear both visible, at all five widths.
 *
 * These are the structural rules that result holds on. A layout regression here is
 * invisible in a unit test otherwise, and this exact bar has now broken twice.
 */
describe("v2.103.1 — the History filter bar fits a phone", () => {
  it("the filters get a row to themselves; Group and Clear get another", () => {
    // Five controls in one row is what broke. Grouping is also a MODIFIER rather than a
    // filter, so separating them is the better hierarchy as well as the fix.
    expect(H).toMatch(/className="mb-3 flex flex-col gap-2"/);
    expect(H).toMatch(/role="tablist"/);
    expect(H).toMatch(/className="flex gap-1 rounded-xl bg-muted\/50 p-1"/);
  });

  it("each tab STACKS its icon and count over its label", () => {
    // Side by side, the label had ~39px of an 87px tab and "Received" needs ~58.
    expect(H).toMatch(/flex min-w-0 flex-1 flex-col items-center justify-center gap-0\.5/);
    expect(H).toMatch(/<span className="max-w-full truncate">\{f\.label\}<\/span>/);
  });

  it("the tabs can actually shrink, and the icon and count cannot be squeezed away", () => {
    // `flex-1` alone will not shrink below content width — `min-w-0` is what allows it,
    // and it is the single line whose absence caused the collision.
    expect(H).toMatch(/min-w-0 flex-1/);
    expect(H).toMatch(/"size-3\.5 shrink-0 "/);
    expect(H).toMatch(/"min-w-4 shrink-0 rounded-full/);
  });

  it("the Group toggle is still a toggle, not a fifth exclusive tab", () => {
    // Moving it out of the tab strip must not turn it into a filter: it composes with
    // whichever filter is chosen, which an exclusive tab could not do (v2.99.98).
    expect(H).toMatch(/aria-pressed=\{grouped\}/);
    expect(codeOnly(H)).not.toMatch(/key: "grouped"/);
  });

  it("all four filters and both row-2 controls are still present", () => {
    // The cheap fix would have been to delete a label or a control. Nothing was dropped.
    for (const label of ["All", "Dialed", "Missed", "Received"]) {
      expect(H, label).toMatch(new RegExp(`label: "${label}"`));
    }
    expect(H).toMatch(/aria-label="Clear history"/);
    expect(H).toMatch(/Group\s*\n\s*<\/button>/);
  });
});
