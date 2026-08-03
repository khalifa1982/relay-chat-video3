import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * v2.107.25 — THE DESKTOP NOTIFICATION PANEL WAS PAINTED UNDER THE CONTENT.
 *
 * Owner screenshot: the bell panel open on desktop with "NOTIFICATIONS", the Do Not
 * Disturb row and "Missed calls" all sliced off at the Recent card's left edge.
 *
 * MECHANISM, measured against the real built stylesheet at 1400px rather than
 * reasoned about. The panel opens RIGHTWARD (`md:absolute md:start-0 md:w-72`), so on
 * a 256px sidebar it overflows ~52px into the content column. Sampling inside the
 * panel but past the sidebar's right edge, `elementFromPoint` returned:
 *
 *    aside z-10  ->  the content card   (OCCLUDED — the bug)
 *    aside z-20  ->  the panel          (VISIBLE)
 *
 * Two positioned siblings with EQUAL z-index paint in DOM order, and the content
 * wrapper comes later. The panel's own `z-[80]` cannot help, because `position` + a
 * non-auto `z-index` CREATES A STACKING CONTEXT — the 80 resolves inside the aside,
 * and what competes with the sibling is the aside's own value.
 *
 * WHY THESE ARE ASSERTED AS A RELATIONSHIP RATHER THAN AS LITERALS. Freezing
 * "z-20" would forbid a later retune while saying nothing about the property, and
 * freezing "z-10" on the content wrapper is what would have made this fix look
 * wrong. The property is an ORDERING: the sidebar must outrank the content wrapper,
 * and both must outrank the background canvas at 0.
 */

const ROOT = resolve(__dirname, "../../..");
const SHELL = readFileSync(resolve(ROOT, "client/src/app/AppShell.tsx"), "utf8");
const BELL = readFileSync(resolve(ROOT, "client/src/app/MissedCalls.tsx"), "utf8");

/** The `z-N` on one element's class string, as a number. */
function zOf(classChunk: string): number | null {
  const m = /(?:^|[\s"'+])z-(?:\[)?(\d+)(?:\])?(?:[\s"'+]|$)/.exec(classChunk);
  return m ? Number(m[1]) : null;
}

/** The desktop sidebar's own class string (the `<aside>`, `hidden md:flex`). */
function asideClass(): string {
  const i = SHELL.indexOf('hidden md:flex md:flex-col md:w-64');
  expect(i, "the desktop sidebar's class string must be findable").toBeGreaterThan(-1);
  // walk back to the start of the string literal that contains it
  const start = SHELL.lastIndexOf('"', i);
  const end = SHELL.indexOf('"', i);
  return SHELL.slice(start, end + 1);
}

/** The scroll container that wraps `{children}`. */
function contentClass(): string {
  const i = SHELL.indexOf('flex-1 min-h-0 overflow-y-auto overscroll-contain');
  expect(i, "the content scroll container must be findable").toBeGreaterThan(-1);
  const start = SHELL.lastIndexOf('"', i);
  const end = SHELL.indexOf('"', i);
  return SHELL.slice(start, end + 1);
}

describe("v2.107.25 — the desktop notification panel is not painted under the content", () => {
  it("the sidebar OUTRANKS the content wrapper, which is the whole bug", () => {
    const aside = zOf(asideClass());
    const content = zOf(contentClass());
    expect(aside, "the sidebar must carry a z-index").not.toBeNull();
    expect(content, "the content wrapper must carry a z-index").not.toBeNull();
    // STRICTLY greater. Equal is the defect: equal z-index paints in DOM order and
    // the content wrapper comes later in the file, so it wins the tie.
    expect(aside!).toBeGreaterThan(content!);
  });

  it("both still clear the background canvas at z-index 0", () => {
    // The ORIGINAL reason either carries a z-index (v2.106.27): `RelayBackground`'s
    // canvas is `position: fixed; z-index: 0` and paints above unpositioned content.
    // Raising the sidebar must not quietly drop that guarantee for either element.
    expect(zOf(asideClass())!).toBeGreaterThan(0);
    expect(zOf(contentClass())!).toBeGreaterThan(0);
    expect(asideClass()).toMatch(/\brelative\b/);
    expect(contentClass()).toMatch(/\brelative\b/);
  });

  it("the sidebar stays BELOW the mobile chrome, which it never coexists with", () => {
    // The mobile top bar and tab bar are z-30. They are `md:hidden` while the sidebar
    // is `hidden md:flex`, so they are never on screen together — but keeping the
    // ordering means a future shared overlay cannot be surprised by the sidebar.
    const bars = [...SHELL.matchAll(/md:hidden[^"]*\bz-30\b|\bz-30\b[^"]*md:hidden/g)];
    expect(bars.length, "the mobile chrome should still be z-30").toBeGreaterThan(0);
    expect(zOf(asideClass())!).toBeLessThan(30);
  });

  it("the panel still opens RIGHTWARD on desktop — which is why it needs the ordering at all", () => {
    // If the panel ever stopped overflowing the sidebar, the ordering above would be
    // guarding nothing. This keeps the test honest about why it exists.
    const i = BELL.indexOf("md:absolute");
    expect(i, "the desktop panel must still be absolutely positioned").toBeGreaterThan(-1);
    const start = BELL.lastIndexOf('"', i);
    const end = BELL.indexOf('"', i);
    const panel = BELL.slice(start, end + 1);
    expect(panel, "opens from the leading edge, rightward in LTR").toMatch(/md:start-0/);
    // 72 * 4px = 288px against a 256px (md:w-64) sidebar, so it MUST overflow.
    expect(panel).toMatch(/md:w-72/);
  });

  it("the panel is wider than the sidebar, so the overflow is arithmetic and not a guess", () => {
    // md:w-72 = 18rem = 288px. md:w-64 = 16rem = 256px. The panel cannot fit.
    const aside = asideClass();
    expect(aside).toMatch(/md:w-64/);
    const panelWiderThanSidebar = 72 > 64;
    expect(panelWiderThanSidebar).toBe(true);
  });

  it("the mobile panel keeps its own viewport pinning, and was never the bug", () => {
    // On mobile the bell renders from the top bar (z-30), which already beats the
    // content wrapper — which is exactly why this defect was desktop-only and hid for
    // so long. The mobile path is pinned so a later 'tidy-up' cannot collapse the two.
    const i = BELL.indexOf("md:absolute");
    const start = BELL.lastIndexOf('"', i);
    const end = BELL.indexOf('"', i);
    const panel = BELL.slice(start, end + 1);
    expect(panel, "phones pin the panel to the viewport, not to the bell").toMatch(
      /max-md:fixed/
    );
    expect(panel).toMatch(/max-md:inset-x-3/);
  });
});
