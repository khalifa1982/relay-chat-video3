/**
 * v2.107.38 — THE PERSON FINDER IS A CARD.
 *
 * Owner screenshot (iPhone): the admin search field and the number-change note
 * rendered ON TOP of each other — placeholder and paragraph interleaved in the
 * same line boxes. The JSX is a plain flex column; no spec-following engine can
 * interleave two normal-flow siblings. What the screenshot COULD prove: this
 * was the only block on the admin page not inside an opaque `.rsheet` card — a
 * 5%-white input and a bare paragraph compositing directly onto the decorative
 * background, exactly the setup iOS Safari's compositor is known to garble.
 * The fix is structural, not a nudge: the finder now lives in the same opaque
 * card as every other admin block, so this class of artifact has nowhere to
 * paint. These pins hold the construction.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ADMIN = fs.readFileSync(
  path.resolve(__dirname, "Admin.tsx"),
  "utf8",
);
const DICT = fs.readFileSync(
  path.resolve(__dirname, "../../app/dict/admin.ts"),
  "utf8",
);

describe("the finder card (v2.107.38)", () => {
  it("label, form, and blurb live INSIDE one opaque rsheet card, in that order", () => {
    const card = ADMIN.indexOf('"rsheet space-y-2.5 rounded-[20px] border bg-card p-4"');
    const label = ADMIN.indexOf('t("admin.people.label")');
    const field = ADMIN.indexOf('t("admin.search.placeholder")');
    const blurb = ADMIN.indexOf('t("admin.blurb")');
    const results = ADMIN.indexOf("found.isLoading");
    expect(card).toBeGreaterThan(-1);
    expect(label).toBeGreaterThan(card);
    expect(field).toBeGreaterThan(label);
    expect(blurb).toBeGreaterThan(field);
    // The results list stays OUTSIDE the card, after it — the card is the
    // finder, not the findings.
    expect(results).toBeGreaterThan(blurb);
  });

  it("the input is opaque and stacked — no translucent pill on the page art", () => {
    // `bg-card` (not `/60`), its own stacking slot, and a slightly stronger
    // dark fill. The logical `start-3.5` icon survives untouched: the glyph
    // still marks the LEADING edge in both directions.
    expect(ADMIN).toMatch(/relative z-\[1\] w-full rounded-\[13px\] border border-border bg-card py-2\.5 ps-9/);
    expect(ADMIN).toMatch(/dark:bg-white\/\[0\.07\]/);
    expect(ADMIN).toMatch(/absolute start-3\.5 top-1\/2 size-3\.5 -translate-y-1\/2/);
    expect(ADMIN).not.toMatch(/bg-card\/60 py-2\.5 ps-9/);
  });

  it("the card's gold label exists in both languages", () => {
    expect(DICT).toMatch(/"admin\.people\.label": \{ en: "People", ar: "الأشخاص" \}/);
  });
});
