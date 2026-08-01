import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { codeOnly } from "../../../server/testing/codeOnly";

/**
 * v2.106.86 — THE BOTTOM FRAME HOLDS AT EVERY TEXT SIZE, AND THE GROUP SHEET'S ACTION
 * STAYS REACHABLE.
 *
 * Owner, with three Appearance screenshots plus one of the new-group sheet:
 *   "when you change the font size it goes below the frame which you cannot click it
 *    or if you put small size or medium it goes above. there is always space so make
 *    sure that the frame is fixed similar to the bar"
 *   "if you select several IDs, you cannot go below and click create group. I select
 *    multiple people and you cannot create the group"
 *
 * Two different bugs with one thing in common: a box whose height was decided under
 * assumptions that stopped holding, so the thing at the BOTTOM of it left the screen.
 *
 * ── (1) THE TAB BAR ──────────────────────────────────────────────────────────────
 * `--relay-vh` is the measured viewport, and v2.106.83 correctly divides it by the
 * text-size zoom, because the value is spent in a unit `zoom` has already scaled. What
 * it did not do is RE-MEASURE: the effect listens to `resize`, `orientationchange` and
 * the visual viewport, and **`style.zoom` fires none of them** — zoom re-lays-out the
 * page without moving `window.innerHeight`. So the shell kept whatever scale was in
 * force at the last rotation.
 *
 * MEASURED in Chromium at 390x844 against a replica of the shell's sizing chain, with
 * the tab bar's bottom edge compared to `innerHeight` (0 = flush):
 *
 *     scale  factor   stale --relay-vh   nav bottom   verdict
 *     sm     0.90     844px              759.6        GAP 84.4px
 *     md     1.00     844px              844.0        OK
 *     lg     1.15     844px              970.6        OVERFLOW 126.6px
 *
 * Both of the owner's screenshots, in both directions, from one cause. With the
 * re-measure the same three land at 844.2 / 844.0 / 844.1 — flush, no sideways scroll.
 *
 * The factor is read from `TEXT_SCALE_FACTOR[scale]` rather than from the published
 * `--relay-zoom`, and that is an ORDERING decision rather than a preference: React runs
 * a child's effects before its parent's, and `LocaleProvider` is the parent, so reading
 * the published variable would return the PREVIOUS scale on exactly the render that
 * changes it.
 *
 * ── (2) THE NEW-GROUP SHEET ──────────────────────────────────────────────────────
 * Its card had no height bound and no scroll, inside `fixed inset-0 … items-center
 * justify-center p-4`. A flex item centred on the cross axis overflows BOTH ends
 * equally, and the backdrop scrolls nothing — so the Create button, the last child,
 * simply left the screen as members were added.
 *
 * MEASURED against the REAL built stylesheet, sweeping the member count, with the
 * button's reachability decided by `elementFromPoint` at its own centre rather than by
 * its rectangle (on screen and tappable are different claims):
 *
 *     phone     scale  members   before          after
 *     375x667   lg     0         UNREACHABLE     reachable
 *     375x667   lg     3,6,12    UNREACHABLE     reachable
 *     375x667   md     12        UNREACHABLE     reachable
 *     390x844   lg     12        overflows       reachable
 *
 * — i.e. on a 375x667 phone at Large text the primary action was unreachable with NO
 * members at all. 5 of 24 combinations broken before, 0 after, and after the fix the
 * button holds a FIXED position as members are added (594px at md on the small phone,
 * whatever the count) because it is pinned outside the scroller.
 *
 * Every other sheet in this app already bounds itself and scrolls internally
 * (`GroupCallScreen` 92dvh, `AvatarPicker` 88dvh, the story composer 92dvh). This one
 * was the outlier; the fix brings it into line rather than inventing a shape.
 */
const ROOT = path.resolve(__dirname, "../../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const SHELL = read("client/src/app/AppShell.tsx");
const MESSAGES = read("client/src/pages/app/Messages.tsx");

/** The body of the effect that owns `--relay-vh`, plus its dependency array — bounded
 *  by its own `}, [` so a later effect cannot be read by accident. */
function vhEffect(src: string): string {
  const anchor = src.indexOf('setProperty("--relay-vh"');
  expect(anchor, "the --relay-vh writer must exist").toBeGreaterThan(-1);
  // Walk back to the `useEffect(` that contains it, and forward to that effect's deps.
  const start = src.lastIndexOf("useEffect(", anchor);
  expect(start, "the writer must live inside a useEffect").toBeGreaterThan(-1);
  const end = src.indexOf("}, [", anchor);
  expect(end, "that effect must have a dependency array").toBeGreaterThan(anchor);
  const close = src.indexOf("]", end + 4);
  return src.slice(start, close + 1);
}

describe("v2.106.86 — the tab bar stays flush at every text size", () => {
  it("the viewport measurement RE-RUNS when the text scale changes", () => {
    /* THE PROPERTY, and the whole bug: `style.zoom` fires no resize event, so without
       `scale` in the deps nothing re-measures and the shell keeps the height it had
       under the previous scale. A mutation dropping it must bite. */
    const eff = vhEffect(codeOnly(SHELL));
    const deps = eff.slice(eff.lastIndexOf("}, ["));
    expect(deps).toMatch(/\[\s*scale\s*\]/);
  });

  it("the divisor comes from the SHARED state, not from the published CSS variable", () => {
    /* An ordering property rather than a style one. `--relay-zoom` is written by the
       PROVIDER's effect, and React runs a child's effects first — so reading it here
       would see the previous scale on the very render that changes it. Reading
       `TEXT_SCALE_FACTOR[scale]` cannot be stale, because `scale` is what triggered
       this run. */
    const eff = vhEffect(codeOnly(SHELL));
    expect(eff).toMatch(/TEXT_SCALE_FACTOR\[\s*scale\s*\]/);
    expect(eff).not.toMatch(/getPropertyValue\(\s*["']--relay-zoom["']\s*\)/);
  });

  it("the measured height is DIVIDED by the scale, never multiplied or assigned raw", () => {
    /* The v2.106.83 half, re-pinned because this release moved the code it lives in.
       Multiplying is the plausible wrong direction and would make Large 32% too tall. */
    const eff = vhEffect(codeOnly(SHELL));
    expect(eff).toMatch(/setProperty\("--relay-vh",\s*Math\.round\(\s*h\s*\/\s*zoom\s*\)/);
  });

  it("`scale` is read ONCE, beside the translator, rather than re-derived", () => {
    /* Two reads of the locale state is two chances for the nav and the measurement to
       disagree about which scale is in force. */
    const code = codeOnly(SHELL);
    expect(code).toMatch(/const\s*\{\s*t,\s*scale\s*\}\s*=\s*useLocale\(\)/);
    expect(code.match(/useLocale\(\)/g) ?? []).toHaveLength(1);
  });

  it("md is exactly 1, so an install nobody has touched measures as it always did", () => {
    /* Guards the claim that the default build is byte-identical: at factor 1 the
       division is a no-op and `--relay-vh` is the raw measurement. */
    const i18n = read("client/src/app/i18n.tsx");
    expect(i18n).toMatch(/md:\s*1\s*,/);
  });
});

describe("v2.106.86 — the new-group sheet keeps its action reachable", () => {
  /** The sheet's card element: the one carrying the `.rsheet` recipe under the
   *  new-conversation backdrop. Anchored on the backdrop so a different `.rsheet`
   *  elsewhere in this very large file cannot be read instead. */
  function sheetCard(): string {
    const back = MESSAGES.indexOf("fixed inset-0 z-40 flex items-center justify-center bg-black/60");
    expect(back, "the new-conversation backdrop must exist").toBeGreaterThan(-1);
    const card = MESSAGES.indexOf("rsheet", back);
    expect(card).toBeGreaterThan(back);
    const end = MESSAGES.indexOf(">", MESSAGES.indexOf("onClick={(e) => e.stopPropagation()}", card));
    return MESSAGES.slice(card, end);
  }

  it("the card is height-bounded and is a flex COLUMN", () => {
    /* Unbounded is the defect. A column is what lets the middle scroll while the
       header and the action keep their own rows. */
    const card = sheetCard();
    expect(card).toMatch(/max-h-\[calc\(var\(--relay-vh,100dvh\)-2rem\)\]/);
    expect(card).toMatch(/\bflex\b/);
    expect(card).toMatch(/\bflex-col\b/);
  });

  it("the bound is --relay-vh, which shrinks for the keyboard, not a bare dvh", () => {
    /* This sheet is mostly text INPUTS, so the keyboard is up exactly when the bottom
       matters — and `dvh` does not shrink for it on iOS (v2.106.29 measured that). The
       siblings use dvh because they are not keyboard-dominated; the deviation is
       deliberate and this is where it is recorded. */
    expect(sheetCard()).not.toMatch(/max-h-\[\d+dvh\]/);
  });

  it("there is exactly ONE scrolling region, and it can actually shrink", () => {
    /* `min-h-0` is what makes it a scroller at all: a flex item defaults to
       `min-height:auto` and refuses to shrink below its content, so without it the
       card grows past its own max-h again and nothing has changed. */
    const back = MESSAGES.indexOf("fixed inset-0 z-40 flex items-center justify-center bg-black/60");
    const region = MESSAGES.slice(back, MESSAGES.indexOf("<AvatarPicker", back));
    const scrollers = region.match(/-mx-5 min-h-0 flex-1 overflow-y-auto px-5/g) ?? [];
    expect(scrollers).toHaveLength(1);
  });

  it("the Create button is OUTSIDE that scroller, in a shrink-0 footer", () => {
    /* The load-bearing half. Making the action merely reachable by scrolling would be
       the weaker fix, because every member added pushes it further down — the primary
       action would retreat as you use the screen. Measured: pinned, it holds one
       position at every member count. */
    const back = MESSAGES.indexOf("fixed inset-0 z-40 flex items-center justify-center bg-black/60");
    const region = MESSAGES.slice(back, MESSAGES.indexOf("<AvatarPicker", back));
    const scrollOpen = region.indexOf("-mx-5 min-h-0 flex-1 overflow-y-auto px-5");
    const foot = region.indexOf('className="shrink-0 pt-4"');
    const create = region.indexOf("createGroup.mutate({");
    expect(scrollOpen).toBeGreaterThan(-1);
    expect(foot).toBeGreaterThan(scrollOpen);
    expect(create).toBeGreaterThan(foot);
  });

  it("the error line is pinned too — an error you must scroll to is one nobody sees", () => {
    const back = MESSAGES.indexOf("fixed inset-0 z-40 flex items-center justify-center bg-black/60");
    const region = MESSAGES.slice(back, MESSAGES.indexOf("<AvatarPicker", back));
    const foot = region.indexOf('className="shrink-0 pt-4"');
    expect(region.indexOf("errorMessage &&", foot)).toBeGreaterThan(foot);
  });

  it("the header and the mode toggle cannot be squeezed by the scroller", () => {
    /* Both are `shrink-0`, or a tall member list would compress the title and the
       Direct/Group control instead of scrolling. */
    const back = MESSAGES.indexOf("fixed inset-0 z-40 flex items-center justify-center bg-black/60");
    const region = MESSAGES.slice(back, MESSAGES.indexOf("{mode === \"dm\" ?", back));
    expect(region).toMatch(/flex shrink-0 items-center justify-between mb-3/);
    expect(region).toMatch(/grid shrink-0 grid-cols-2/);
  });

  it("the minimized call window is clamped in the POINTER's unit, not an unzoomed one", () => {
    /* The same class, found by sweeping for other unzoomed viewport reads: `e.clientX/Y`
       are layout px that `zoom` has scaled, `window.innerWidth/Height` are not — so at
       Large the mini call window could be dragged ~15% past the edge, which on that
       surface can carry the hang-up button off screen. `documentElement.client*` is in
       the pointer's own unit, so the clamp is right without knowing the zoom. */
    const engine = codeOnly(read("client/src/app/RelayEngine.tsx"));
    const move = engine.slice(engine.indexOf("const onMiniDragMove"));
    const body = move.slice(0, move.indexOf("setMiniPos"));
    expect(body).toMatch(/document\.documentElement\.clientWidth/);
    expect(body).toMatch(/document\.documentElement\.clientHeight/);
    expect(body).not.toMatch(/window\.inner(Width|Height)/);
  });

  it("every other overlay sheet already bounds itself — this one was the outlier", () => {
    /* Not decoration: it is the evidence that the shape chosen here is the app's own
       rather than something invented for one screen. If these ever stop bounding
       themselves, the argument above needs revisiting rather than silently rotting. */
    for (const [file, bound] of [
      ["client/src/pages/app/GroupCallScreen.tsx", /max-h-\[92dvh\]/],
      ["client/src/app/AvatarPicker.tsx", /max-h-\[88dvh\]/],
      ["client/src/pages/app/Status.tsx", /max-h-\[92dvh\]/],
    ] as const) {
      expect(read(file), `${file} should still bound its sheet`).toMatch(bound);
    }
  });
});
