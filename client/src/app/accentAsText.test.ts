/**
 * THE ACCENT AS TEXT MUST NEVER BE THE RAW VARIABLE — and this guard is app-wide, because
 * the one that already existed was scoped to a single file and so never looked here.
 *
 * v2.106.26 fixed three sites in the voicemail panel and left its guard reading only that
 * file (`voicemailFrame.test.ts` asserts `not.toMatch(/color:\s*["'`]var\(--rb/)` against
 * `VM` alone). Messages.tsx carried four more of the same defect and nothing checked.
 *
 * MEASURED as rendered at 390px against the real built stylesheet, in the theme the app
 * DEFAULTS to:
 *
 *   raw accent as text on the light card          1.59:1   (AA needs 4.5)
 *   raw accent as text on its own .16 tint        1.46:1
 *   raw accent as text on its own .14 tint        1.47:1
 *   `text-primary` on the light card              4.59:1   PASS
 *   `text-primary` on the .16 tint                4.20:1   STILL FAILS
 *   `.rchip-accent` on the .14 tint               5.17:1   PASS
 *
 * THE MIDDLE ROW IS THE POINT. The obvious fix — swap the raw variable for `text-primary`,
 * which is what v2.106.26 did — is NOT sufficient on an accent-tinted surface, because the
 * tint darkens the effective background out from under it. So the rule has two halves: on a
 * plain surface use `text-primary`; on the accent's own tint use `.rchip-accent`, which is
 * the recipe v2.106.25 built with a measured light-theme colour for exactly this.
 *
 * Dark passes everywhere (7-11:1), so all of it is light-theme only — which is precisely why
 * it survived: the board is a dark design and the app ships light.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { codeOnly } from "../../../server/testing/codeOnly";

const read = (p: string) => readFileSync(p, "utf8");

/** Every .tsx/.ts under client/src, so a file added later is covered rather than exempt. */
function clientSources(dir = "client/src", out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const abs = join(dir, e);
    if (statSync(abs).isDirectory()) clientSources(abs, out);
    else if (/\.tsx?$/.test(e) && !/\.test\.tsx?$/.test(e)) out.push(abs);
  }
  return out;
}

describe("the accent is never the raw variable in a text position", () => {
  /**
   * THE FILES THAT STILL DO IT, ENUMERATED RATHER THAN THE GUARD WEAKENED.
   *
   * The app-wide sweep found this in TEN more files than the two fixed here, which is a far
   * bigger finding than the release that discovered it, and pretending otherwise would be
   * worse than recording it. Each still needs the same per-site judgement the two fixed ones
   * got — is this surface theme-switchable, and is the text on a plain background or on the
   * accent's own tint — and that needs a measurement per site, not a find-and-replace.
   *
   * `relayAssets.ts` is called out separately because it is probably NOT a defect at all:
   * the call surfaces carry their own private near-black theme (`.relay-root`), so accent
   * text there measures 7-11:1. Lumping it in with the rest would manufacture work.
   *
   * The set may SHRINK freely. It may never GROW — that is what keeps this honest debt
   * rather than a licence.
   */
  const KNOWN_RAW_ACCENT_TEXT = [
    "client/src/app/AppShell.tsx",
    "client/src/app/AuthPanel.tsx",
    "client/src/app/GuestRestore.tsx",
    "client/src/app/PushBanner.tsx",
    "client/src/lib/linkify.tsx",
    "client/src/lib/relayAssets.ts", // always-dark call surfaces — likely fine, needs measuring
    "client/src/pages/app/Admin.tsx",
    /* Contacts.tsx is GONE from this list, and the staleness assertion below is what
       removed it: the section headings and both tag-chip sites were the debt this list
       recorded, and they are fixed (headings → `text-primary`; chips → the theme-aware
       `.rtag-*` recipes, whose light colours were measured at 4.65-4.81:1 against the
       1.53-1.71:1 they replaced). The list may SHRINK freely and may never GROW. */
    "client/src/pages/app/GroupCallScreen.tsx",
  ];

  it("no NEW file puts `--rb` in a `color:` — and the known set does not grow", () => {
    /* A sweep rather than a list of today's fixes: the reason this defect reached
       Messages.tsx at all is that v2.106.26's guard named ONE file. A sweep covers the file
       somebody adds next. Comments are stripped, because the fixed sites now EXPLAIN in
       prose what they must not do — the prose-anchor trap, which this repo has hit fifteen
       times and which would make this assertion fail on correct code. */
    const offenders = new Set<string>();
    for (const f of clientSources()) {
      const src = codeOnly(read(f));
      if (/color:\s*["'`]?\s*var\(--rb/.test(src) || /color:\s*["'`]?\s*rgba\(var\(--rb-rgb/.test(src))
        offenders.add(f);
    }
    const unexpected = [...offenders].filter((f) => !KNOWN_RAW_ACCENT_TEXT.includes(f));
    expect(unexpected, `NEW raw-accent-as-text in: ${unexpected.join(", ")}`).toEqual([]);
    // Every file taken off this list must stay off it.
    expect(offenders.has("client/src/pages/app/Messages.tsx")).toBe(false);
    expect(offenders.has("client/src/pages/app/Contacts.tsx")).toBe(false);
    expect(offenders.has("client/src/app/PeerOverlays.tsx")).toBe(false);
  });

  it("the known list is not stale — every file on it really still offends", () => {
    /* An entry that has been fixed but left on the list is a permanent exemption nobody
       notices, which is how a guard rots into a comment. */
    const stale: string[] = [];
    for (const f of KNOWN_RAW_ACCENT_TEXT) {
      const src = codeOnly(read(f));
      if (!/color:\s*["'`]?\s*var\(--rb/.test(src) && !/color:\s*["'`]?\s*rgba\(var\(--rb-rgb/.test(src))
        stale.push(f);
    }
    expect(stale, `fixed but still exempted — remove from the list: ${stale.join(", ")}`).toEqual([]);
  });

  it("the sweep can actually see a violation — it is not vacuous", () => {
    /* A sweep that finds nothing proves nothing unless it would find something. */
    const planted = codeOnly(`const s = { color: "var(--rb, #3FE0C5)" };`);
    expect(/color:\s*["'`]?\s*var\(--rb/.test(planted)).toBe(true);
    const plantedRgba = codeOnly(`const s = { color: "rgba(var(--rb-rgb), 0.9)" };`);
    expect(/color:\s*["'`]?\s*rgba\(var\(--rb-rgb/.test(plantedRgba)).toBe(true);
  });

  it("…and it does not flag a FILL, which is the accent's correct use", () => {
    /* v2.106.26 was explicit that this is only ever about text: a dark glyph ON the accent
       measures 10:1, and the fills are right. A guard that banned the variable outright
       would forbid the correct usage along with the wrong one. */
    const fill = codeOnly(`const s = { background: "var(--rb, #3FE0C5)", borderColor: "rgba(var(--rb-rgb), 0.4)" };`);
    expect(/color:\s*["'`]?\s*var\(--rb/.test(fill)).toBe(false);
    // The real avatar fill in Messages is exactly this shape and must stay allowed.
    expect(codeOnly(read("client/src/pages/app/Messages.tsx"))).toMatch(
      /background:\s*"var\(--rb, #3FE0C5\)"/,
    );
  });

  /** Same discipline: enumerated, may shrink, may never grow. */
  const KNOWN_FIXED_CYAN = [
    "client/src/app/AuthPanel.tsx",
    "client/src/app/GuestRestore.tsx",
    "client/src/app/InviteCard.tsx",
    "client/src/app/OnboardingGate.tsx",
    "client/src/app/ShareNumber.tsx",
    "client/src/app/TopBar.tsx",
    "client/src/lib/emojiAvatar.ts", // a generated PNG's own palette, not app chrome
    "client/src/pages/Docs.tsx",
    "client/src/pages/app/Profile.tsx",
  ];

  it("no NEW file carries the RETIRED fixed cyan as a fill", () => {
    /* v2.106.7 converted the call surfaces off `#3FE0C5`/`#6EE7FF` so every accent breathes
       with the background. A survivor sits beside a cycling one and the two visibly
       disagree — which is exactly what the composer's mic did next to its own Send button:
       the hue jumped the moment you typed a character. Literal FALLBACKS inside
       `var(--rb, …)` are legitimate and are excluded, because an unset custom property is an
       INVALID declaration the browser DROPS rather than a missing default. */
    const offenders = new Set<string>();
    for (const f of clientSources()) {
      const src = codeOnly(read(f)).replace(/var\(--rb[^)]*\)/g, "");
      if (/linear-gradient\([^)]*#3FE0C5/i.test(src) || /#6EE7FF/i.test(src)) offenders.add(f);
    }
    const unexpected = [...offenders].filter((f) => !KNOWN_FIXED_CYAN.includes(f));
    expect(unexpected, `NEW fixed-cyan fill in: ${unexpected.join(", ")}`).toEqual([]);
    expect(offenders.has("client/src/pages/app/Messages.tsx")).toBe(false);
  });
});

describe("the two halves of the rule are applied to the right surfaces", () => {
  const MSG = codeOnly(read("client/src/pages/app/Messages.tsx"));

  it("the composer's mic wears the accent CTA, so it matches the Send it swaps with", () => {
    /* They occupy the same position and swap on the first keystroke, so they must be the
       same material. Measured: 10.08:1 light, 9.85:1 dark. */
    expect(MSG).toMatch(/className=\{"h-11 w-11 rounded-full border-0" \+ \(recording \? "" : " rcta"\)\}/);
  });

  it("…but NOT while recording, when it is the destructive stop", () => {
    // A red stop control tinted with the accent reads as neither.
    expect(MSG).toMatch(/variant=\{recording \? "destructive" : "default"\}/);
  });

  it("an accent-TINTED chip uses `.rchip-accent`, which alone clears AA on a tint", () => {
    /* `text-primary` measures 4.20:1 there — under AA — so the tinted sites cannot take the
       same fix as the plain ones. Two of these were hand-rolled duplicates of the class's
       own values that differed only in missing its light-theme colour. */
    expect(MSG).toMatch(/rchip-accent/);
    // The duplicate is gone: no inline copy of the class's own fill + border pair.
    expect(MSG).not.toMatch(
      /background: "rgba\(var\(--rb-rgb[^"]*0\.14\)"[\s\S]{0,120}borderColor: "rgba\(var\(--rb-rgb[^"]*0\.4/,
    );
  });

  it("the light-theme override the class depends on really exists", () => {
    /* `.rchip-accent` is only safe because of it — without the override the class is the
       raw accent again and every consumer silently drops to 1.47:1. */
    const CSS = read("client/src/index.css");
    expect(CSS).toMatch(/\.relay-v2:not\(\.dark\) \.rchip-accent \{\s*\n\s*color: var\(--relay-green-text\);/);
  });
});

describe("avatar initials — a pre-existing app-wide failure, not one this release introduced", () => {
  it("the fallback uses a class with its own light-theme colour", () => {
    /* MEASURED as rendered: `bg-primary/15 text-primary` gave 3.77:1 in light, i.e. every
       avatar without a photo on every surface, in the theme the app defaults to. After:
       4.98-5.32:1 light, 8.28-8.59:1 dark. */
    expect(codeOnly(read("client/src/app/PeerOverlays.tsx"))).toMatch(
      /fallbackClassName = "ravatar-fallback"/,
    );
  });

  it("that class carries a light-theme text colour, or it is the same bug renamed", () => {
    const CSS = read("client/src/index.css");
    expect(CSS).toMatch(/\.relay-v2 \.ravatar-fallback \{/);
    expect(CSS).toMatch(/\.relay-v2:not\(\.dark\) \.ravatar-fallback \{\s*\n\s*color: var\(--relay-green-text\);/);
  });

  it("and NO border, because a ring around an avatar already means something else", () => {
    const CSS = read("client/src/index.css");
    const block = CSS.slice(CSS.indexOf(".relay-v2 .ravatar-fallback {"));
    const body = block.slice(0, block.indexOf("}"));
    expect(body.length, "the slice must be real").toBeGreaterThan(20);
    expect(body, "an unseen-story ring is what a hairline here would read as").not.toMatch(/border/);
  });
});
