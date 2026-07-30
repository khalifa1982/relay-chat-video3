/**
 * Board 3d — the New group sheet.
 *
 * Source-pinned because this is a layout to a spec: what matters is that the board's
 * own values reached the markup and that the rules the redesign runs on were not
 * broken doing it. The BEHAVIOUR of this sheet (six-digit gating, the shared
 * suggestion ranking, the group-tab landing side) is already covered by
 * `contactSuggest.test.ts` and `fiveTabShell.test.ts` and is untouched here.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { codeOnly } from "./testing/codeOnly";

const UI = codeOnly(
  readFileSync(resolve(process.cwd(), "client/src/pages/app/Messages.tsx"), "utf8")
);

/** The sheet's own region, bounded by its two ends so an insertion elsewhere in this
 *  4,800-line file cannot silently move the window (the recurring fixed-slice
 *  fragility — v2.99.78 and five recurrences since). */
function sheet(): string {
  const at = UI.indexOf("function NewMessageDialog");
  expect(at).toBeGreaterThan(0);
  const end = UI.indexOf("function SuggestList", at);
  expect(end).toBeGreaterThan(at);
  const region = UI.slice(at, end);
  // The window is real, not an accidental empty string.
  expect(region).toContain("Conversation type");
  return region;
}

describe("board 3d — the segmented Direct / Group control", () => {
  it("is an inset well with the board's radius and padding", () => {
    expect(sheet()).toMatch(/rounded-\[13px\] p-\[5px\]/);
    expect(sheet()).toMatch(/background: "rgba\(0,0,0,\.32\)"/);
  });

  it("the SELECTED half is the cycling accent, not a neutral raised tile", () => {
    // The same "you are here" language as the tab bar's pill (v2.106.2), so one idea
    // of selection covers the app.
    const hits = sheet().match(/rgba\(var\(--rb-rgb, 63, 224, 197\), 0\.20\)/g) ?? [];
    expect(hits.length).toBe(2); // one per half
  });

  it("both halves are styled, so neither can be left on the old recipe", () => {
    // A half-converted control puts a raised grey tile beside a cycling accent one
    // and the two visibly disagree about what "selected" means.
    expect(sheet()).not.toMatch(/bg-background text-foreground shadow-sm/);
  });

  it("the accent is an INLINE style, never a runtime-composed Tailwind class", () => {
    // A class name assembled at render time is invisible to the JIT and comes out
    // completely unstyled — the trap recorded for the old tab accents.
    expect(sheet()).not.toMatch(/bg-\[\$\{/);
  });
});

describe("board 3d — the fields and chips", () => {
  it("section labels are the board's mono 10px / .2em", () => {
    // The same typographic voice the History day headers and Contacts A-Z letters
    // took in v2.106.4, so the app has ONE idea of a section label.
    const hits = UI.match(/font-mono text-\[10px\] uppercase tracking-\[\.2em\]/g) ?? [];
    expect(hits.length).toBeGreaterThanOrEqual(3);
    expect(sheet()).not.toMatch(/text-xs uppercase tracking-widest text-muted-foreground mb-2 block/);
  });

  it("GROUP NAME gets the accent focus ring, and only on focus", () => {
    // An always-lit field stops meaning "you are typing here".
    expect(sheet()).toMatch(/focus-within:shadow-\[0_0_0_3px_rgba\(var\(--rb-rgb,63,224,197\),0\.12\)\]/);
  });

  it("a selected member is an ACCENT chip, not a neutral grey pill", () => {
    expect(sheet()).toMatch(/rgba\(var\(--rb-rgb, 63, 224, 197\), 0\.14\)/);
    expect(sheet()).toMatch(/color: "var\(--rb, #3FE0C5\)"/);
    expect(sheet()).not.toMatch(/rounded-full bg-muted px-2\.5 py-1 text-xs font-mono/);
  });

  it("the CTA counts YOU as a member", () => {
    // "Create group · 4 members" for three picked people plus you. A count reading 3
    // for a group of 4 would be wrong about the thing it names.
    expect(sheet()).toMatch(/Create group · \$\{groupNumbers\.length \+ 1\} members/);
  });

  it("every accent fallback is a LITERAL, never a self-reference", () => {
    // `var(--rb, var(--rb))` is a custom-property CYCLE: it resolves to the
    // guaranteed-invalid value and the browser DROPS the declaration, leaving the
    // control with no fill at all (v2.106.7).
    expect(sheet()).not.toMatch(/var\(--rb[a-z-]*,\s*var\(--rb/);
  });
});

describe("board 3d — the picker's check circle is opt-in", () => {
  it("the affordance is a PROP, not added to every row", () => {
    /* `SuggestList` is SHARED with the DM field, where tapping a row OPENS a thread
       rather than selecting a member — a tick there would promise a multi-select that
       does not exist. One list, two meanings, and the caller says which. */
    expect(UI).toMatch(/selectable\?: boolean;/);
    expect(UI).toMatch(/\{selectable && \(/);
  });

  it("only the GROUP field asks for it", () => {
    const hits = sheet().match(/^\s*selectable$/gm) ?? [];
    expect(hits.length).toBe(1);
  });

  it("the sheet carries the shared dark-scoped material", () => {
    // `.rsheet` declares NOTHING in light, so `bg-card` stays as the light surface
    // underneath rather than being replaced (v2.106.10).
    expect(sheet()).toMatch(/className="rsheet w-full max-w-sm/);
    expect(sheet()).toMatch(/bg-card/);
  });
});
