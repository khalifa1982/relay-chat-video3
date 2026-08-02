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
import { copyOnScreen } from "./testing/copyOnScreen";
import { DICT } from "../client/src/app/i18n";
import { createGroupCountKey } from "../client/src/pages/app/Messages";

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
  // The window is real, not an accidental empty string. Asked through `copyOnScreen`
  // rather than as a raw literal because the sentinel is COPY, and copy moves into the
  // dictionary: a non-vacuity guard that goes red when a screen is translated is a guard
  // that has to be weakened at exactly the wrong moment.
  expect(copyOnScreen(region, "Conversation type")).toBe(true);
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
    /* REWRITTEN in v2.106.31: this froze the chip's inline `.14` fill AND
       `color: var(--rb)` — the second of which is the defect, not the design. That pair was
       a hand-rolled duplicate of `.rchip-accent`'s own values differing only in missing its
       light-theme text colour, so the chip's own digits measured 1.47:1 in the theme the app
       defaults to. THE PROPERTY is that a picked member is an ACCENT chip rather than a
       neutral grey pill — which the class delivers, at 5.17:1. */
    expect(sheet()).toMatch(/rchip-accent/);
    expect(sheet()).not.toMatch(/rounded-full bg-muted px-2\.5 py-1 text-xs font-mono/);
  });

  it("the CTA counts YOU as a member", () => {
    // "Create group · 4 members" for three picked people plus you. A count reading 3
    // for a group of 4 would be wrong about the thing it names.
    //
    // Pinned as the ARITHMETIC plus the copy, not as one template literal: the wording
    // now comes from the dictionary (and in two plural bands, because Arabic counts
    // differently), so freezing the interpolation would forbid the translation while
    // saying nothing about the +1 — which is the only part that can be wrong.
    //
    // The key is chosen at RUNTIME, so `copyOnScreen` cannot see it (the v2.106.85 limit
    // recorded for `guestExpiryKey`); the copy is therefore pinned at the SELECTOR, and
    // what this region owes is the +1 reaching it.
    expect(sheet()).toMatch(/createGroupCountKey\(groupNumbers\.length \+ 1\)/);
    expect(sheet()).toMatch(/n: groupNumbers\.length \+ 1/);
  });

  it("and the wording it selects really says so, in both bands", () => {
    for (const n of [1, 4, 30]) {
      const e = DICT[createGroupCountKey(n)] as { en: string; ar: string };
      expect(e.en).toContain("Create group");
      expect(e.en).toContain("{n}");
      expect(e.ar).toContain("{n}");
      // Western digits in Arabic prose (v2.106.84) — the numeral is interpolated, so an
      // Arabic-Indic one beside it would read as a rendering fault.
      expect(e.ar).not.toMatch(/[٠-٩]/);
    }
    // The bands are REAL: a plural sentence for one member would be the bug.
    expect(createGroupCountKey(1)).not.toBe(createGroupCountKey(4));
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
    //
    // PINNED AS THE PAIR, not as one class string (v2.106.86): this froze the exact
    // order `rsheet w-full max-w-sm`, so it broke the moment a height bound joined
    // the list — while saying nothing about the property it stands for, which is only
    // that BOTH recipes are on the card. The bound itself is pinned, with its
    // measurements, in `client/src/app/textScaleFrame.test.ts`.
    expect(sheet()).toMatch(/className="[^"]*\brsheet\b/);
    expect(sheet()).toMatch(/className="[^"]*\bmax-w-sm\b/);
    expect(sheet()).toMatch(/bg-card/);
  });
});
