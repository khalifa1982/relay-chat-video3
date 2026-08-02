/**
 * BOARD 1c — THE THREAD LIST, AND EVERY NUMBER HERE IS MEASURED.
 *
 * Same class of finding as v2.106.38's section headings and v2.106.31's accent-as-text: a
 * colour that reads perfectly in DARK and fails AA in LIGHT, which is the theme the app
 * DEFAULTS to — so it survives every review that looks at the board, because the board is a
 * dark design.
 *
 * MEASURED against the real built stylesheet, both themes, by painting each colour into a 1×1
 * canvas and compositing it over the surface it actually sits on (Chromium hands `oklch()`
 * back verbatim from `getComputedStyle`, and an alpha fill on a transparent canvas reads back
 * opaque — both traps this repo has been bitten by):
 *
 *                                   light        dark
 *   #fb923c (what shipped)          2.26:1 FAIL  8.30:1
 *   text-primary                    4.85:1 PASS  11.16:1
 *   orange glyph on its own .3 tint  1.77:1 FAIL  4.68:1
 *   --relay-green-text               5.92:1       9.27:1
 *   muted-foreground                 6.00:1       6.55:1
 *
 * So the UNREAD state — the count, the timestamp and both dots — was the least readable thing
 * in the row in light theme, and the compose chip's glyph on its own tint was worse still.
 *
 * AND THE ORANGE ALREADY MEANT SOMETHING: the owner asked for orange on their OWN BUBBLES in
 * their own words (v2.99.85), so spending it on "unread" put two meanings on one colour.
 *
 * The pin marker is a VOCABULARY fix rather than a contrast one — it was legible and it was
 * green, and green means ONLINE here.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { codeOnly } from "../../../server/testing/codeOnly";

const MSG = codeOnly(readFileSync(resolve(process.cwd(), "client/src/pages/app/Messages.tsx"), "utf8"));
const CSS = readFileSync(resolve(process.cwd(), "client/src/index.css"), "utf8");

describe("unread is the accent, in a form that survives the light theme", () => {
  it("the unread COUNT and the unread TIMESTAMP both carry the accent", () => {
    /* v2.106.67 REWROTE THIS TO THE PROPERTY. It froze the count's exact class string,
       `shrink-0 font-semibold text-[13px] text-primary` — i.e. the "colour + weight, not
       a pill" treatment — so it forbade board 1c's own row badge, which is a 17px accent
       PILL (`background:var(--rb);color:#04211a`). The property is that unread carries
       the ACCENT and never the retired orange; whether the accent arrives as text or as
       a fill is the board's business, and it says fill.
       On-accent text must come from the TOKEN, never the literal: v2.106.4 repointed
       `--primary-foreground` at `#04211a` inside `.dark.relay-v2` for exactly this
       pairing, so light keeps its own measured value instead of near-black on a pale
       accent. */
    const pill = MSG.slice(MSG.indexOf('aria-label={`${t.unreadCount} unread`}'));
    expect(pill.length, "the unread count is gone").toBeGreaterThan(100);
    expect(pill.slice(0, 400)).toMatch(/bg-primary/);
    expect(pill.slice(0, 400)).toMatch(/text-primary-foreground/);
    expect(pill.slice(0, 400), "never the on-accent literal").not.toMatch(/#04211a/);
    // The timestamp is unchanged: still the accent as TEXT when unread.
    expect(MSG).toMatch(/unread \? "font-semibold text-primary" : "text-muted-foreground"/);
  });

  it("both unread DOTS take the same accent as the count they stand in for", () => {
    /* The row's manual-unread dot and the section header's pip. Two colours for one state is
       how a header comes to disagree with the rows under it. A fill needs 3:1 rather than
       4.5, and the orange missed that on the light card too. */
    expect(MSG).toMatch(/aria-label=\{tr\("msg\.markedUnread"\)\}\s*\n\s*className="size-2\.5 shrink-0 rounded-full bg-primary"/);
    expect(MSG).toMatch(/<span className="size-2 rounded-full bg-primary" \/>/);
  });

  it("the own-bubble orange is gone from the thread ROW", () => {
    /* Scoped to the ROW rather than the file, and the boundary is a judgement worth recording
       rather than a convenience. TWO other uses of this orange are CORRECT and stay:
         · the own message BUBBLE's gradient, which is what the owner asked for by name;
         · the "Direct" section icon's `hex`, one of four fixed SECTION identities (Direct
           orange / Groups violet / Notes amber) — a wayfinding hue like the Contacts tag
           colours, not a state.
       What was wrong was the orange standing for UNREAD, a third meaning on one colour, in
       the one place it also failed AA. */
    const from = MSG.indexOf("{catUnread && (");
    const to = MSG.indexOf("</SwipeRow>");
    expect(from).toBeGreaterThan(-1);
    expect(to).toBeGreaterThan(from);
    const row = MSG.slice(from, to);
    expect(row.length).toBeGreaterThan(2000);
    expect(row, "no hardcoded orange literal survives in the row").not.toMatch(/#fb923c/i);
    expect(row, "…nor its rgb form").not.toMatch(/251\s*,\s*146\s*,\s*60/);
  });

  it("`--primary` really is theme-aware, so this is not just a rename", () => {
    /* The whole reason `text-primary` is the right vehicle: it is a MEASURED cyan in light and
       the cycling accent in dark, because v2.106.4 repointed it inside `.dark.relay-v2`. A
       plain `var(--rb)` would have been 1.68:1 in light — worse than the orange it replaced. */
    expect(CSS).toMatch(/\.dark\.relay-v2[^{]*\{[\s\S]{0,4000}?--primary:\s*var\(--rb\)/);
    const light = CSS.slice(CSS.indexOf(".relay-v2:not(.dark)"));
    expect(light, "light keeps its own measured value").toMatch(/--primary:\s*oklch\(/);
  });
});

describe("the pinned marker is not a presence statement", () => {
  it("it is muted — not green, and deliberately not the accent either", () => {
    const gate = MSG.indexOf("{t.pinned && (");
    expect(gate).toBeGreaterThan(-1);
    const marker = MSG.slice(MSG.indexOf("<Pin", gate), MSG.indexOf("/>", MSG.indexOf("<Pin", gate)));
    expect(marker).toMatch(/text-muted-foreground/);
    expect(marker, "green means ONLINE").not.toMatch(/relay-green-text|relay-online/);
    expect(marker, "the accent means UNREAD in this same row").not.toMatch(/text-primary/);
  });

  it("the standing green guard now sweeps BOTH green tokens", () => {
    /* THE GAP THAT LET THIS BE THE SIXTH OCCURRENCE. The guard in `mentions.test.ts` swept
       `--relay-online` only, and the pin was painted with `--relay-green-text` — the
       AA-measured sibling v2.99.86 added for small text. Two spellings of one meaning, one of
       them unguarded, so the guard read as covering the rule while covering half of it. */
    const guard = readFileSync(resolve(process.cwd(), "server/mentions.test.ts"), "utf8");
    expect(guard).toMatch(/const GREEN = \/relay-online\|relay-green-text\//);
    expect(guard, "and it must refuse to pass vacuously").toMatch(
      /the sweep must not be vacuous/,
    );
  });
});

describe("the compose chip is the accent chip, not a hand-rolled tint", () => {
  it("it uses the shared recipe and carries no inline colour", () => {
    // Anchored on the ELEMENT rather than on its label: the label moved into the
    // dictionary, and an anchor made of copy goes stale the moment a screen is
    // translated — which is exactly when nobody is looking at this test.
    const at = MSG.indexOf('aria-label={t("msg.newMessage")}');
    expect(at).toBeGreaterThan(-1);
    const btn = MSG.slice(at, at + 700);
    expect(btn).toMatch(/className="rchip-accent grid place-items-center w-\[34px\] h-\[34px\]/);
    expect(btn, "the 1.77:1 orange-on-orange is gone").not.toMatch(/251,146,60|#fb923c/);
    expect(btn, "and with it the inline style that could not express a per-theme colour").not.toMatch(
      /style=\{\{/,
    );
  });

  it("`.rchip-accent` is the only accent recipe with a per-theme text colour", () => {
    /* Which is why it and not an inline style: an inline `style={{ color }}` cannot branch on
       the theme, and in light the raw accent as text is 1.68:1. */
    const at = CSS.indexOf(".relay-v2 .rchip-accent {");
    expect(at).toBeGreaterThan(-1);
    expect(CSS).toMatch(/\.relay-v2:not\(\.dark\) \.rchip-accent \{\s*color: var\(--relay-green-text\);/);
  });
});
