import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { codeOnly } from "../../../../server/testing/codeOnly";
import { sanitizeStatusBg } from "../../../../server/v2routers";
import { BG_OPTIONS } from "./Status";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const SRC = read("client/src/pages/app/Status.tsx");
const CODE = codeOnly(SRC);

/**
 * Design-board frame 4b — STORY COMPOSER.
 *
 * The frame: a full-bleed gradient canvas, 26px centred text with a caret, Text ·
 * Photo · Video · Audio tabs, five gradient swatches, text/camera tools, an audience
 * chip and an accent "Post story" pill.
 *
 * No DOM environment here (vitest runs `node`), so layout wiring is source-pinned —
 * EXCEPT the palette, which is driven through the REAL server sanitizer below, because
 * that is the one thing a source pin genuinely cannot answer.
 */

/** The composer's own slice, so a pin cannot accidentally read the viewer instead. */
function composer(src: string): string {
  const at = src.indexOf("function StatusComposer(");
  expect(at, "StatusComposer is gone").toBeGreaterThan(-1);
  const end = src.indexOf("function MediaPreview(", at);
  expect(end, "MediaPreview no longer follows the composer").toBeGreaterThan(at);
  const out = src.slice(at, end);
  expect(out.length, "the composer slice collapsed").toBeGreaterThan(2000);
  return out;
}
const COMPOSER = composer(CODE);

/* ─────────────────────────────────────────────────────────────────────────────
   THE PALETTE, AND THE 64-CHARACTER TRAP
   ───────────────────────────────────────────────────────────────────────────── */

describe("4b — every swatch survives the server's own background allowlist", () => {
  /* THIS IS THE LOAD-BEARING TEST IN THE FILE.
     `sanitizeStatusBg` does `v.trim().slice(0, 64)` BEFORE its regex runs, so a
     gradient one character too long has its closing paren cut, fails the pattern, and
     comes back NULL — the story posts with no background at all, silently. The board's
     own literal is 78 characters and does exactly that (proven below), so this cannot
     be a source pin: it has to drive the real function over the real array. */

  it("the array is the frame's five, so the sweep below is not vacuous", () => {
    // An empty or single-entry array would make "all entries survive" trivially true.
    expect(BG_OPTIONS).toHaveLength(5);
    for (const bg of BG_OPTIONS) expect(typeof bg).toBe("string");
  });

  it("each one round-trips through sanitizeStatusBg UNCHANGED", () => {
    for (const bg of BG_OPTIONS) {
      expect(sanitizeStatusBg(bg), `"${bg}" (${bg.length} chars) is rejected or altered`).toBe(bg);
    }
  });

  it("the guard really bites — the board's own hsl() literal is REJECTED", () => {
    /* Non-vacuity for the test above. If this ever started passing, the length bound
       had been relaxed and the sweep above would stop proving anything. It is also the
       evidence for why the palette is hex: this string is what frame 4b actually
       draws, and pasting it verbatim ships a story with no background. */
    const boardLiteral =
      "linear-gradient(160deg,hsl(200 70% 30%),hsl(255 60% 32%) 60%,hsl(300 50% 28%))";
    expect(boardLiteral.length).toBeGreaterThan(64);
    expect(sanitizeStatusBg(boardLiteral)).toBeNull();
  });

  it("no swatch can smuggle a url() — the tracking-beacon rule still holds", () => {
    /* `sanitizeStatusBg` exists to stop an author turning a story into a beacon that
       phones home from every viewer's browser. Asserted against the palette rather
       than only against the function, so a future entry cannot be the exception. */
    for (const bg of BG_OPTIONS) expect(bg).not.toMatch(/url\(|image-set|expression/i);
  });

  it("ONE string per option — the swatch is the canvas, not a lookalike", () => {
    /* The board draws each swatch as a 2-stop 135deg gradient while rendering the
       SCREEN as a 3-stop 160deg one. Shipping that literally means the dot you tap is
       a different gradient from the story you get. Both the full-bleed canvas and the
       swatch read the SAME array entry, so they cannot disagree. */
    expect(COMPOSER).toMatch(/style=\{\{ background: BG_OPTIONS\[bgIndex\] \}\}/);
    expect(COMPOSER).toMatch(/BG_OPTIONS\.map\(\(bg, i\) =>/);
    expect(COMPOSER).toMatch(/style=\{\{ background: bg \}\}/);
    // …and there is no second palette to drift from this one.
    expect(CODE.match(/linear-gradient\(/g) ?? []).toHaveLength(BG_OPTIONS.length - 1);
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
   THE FRAME'S LAYOUT
   ───────────────────────────────────────────────────────────────────────────── */

describe("4b — the bottom bar can never be pushed off the sheet", () => {
  /* v2.106.86 is this exact defect on the new-group sheet: a centred card with no
     bound, whose primary action left the screen as members were added. The frame puts
     the swatches AND the Post pill at the bottom, so the composer is a COLUMN whose
     only scroller is the body — pinned as the property (one scroller, bounded height,
     shrink-0 chrome) rather than as a class string. */

  it("the sheet is a bounded flex column, not a scrolling block", () => {
    expect(COMPOSER).toMatch(/flex[^"]*flex-col/);
    // The app's own bound for an overlay sheet (GroupCallScreen 92dvh, AvatarPicker 88dvh).
    expect(COMPOSER).toMatch(/max-h-\[92dvh\]/);
  });

  it("the BODY is the only scroller, and it may shrink", () => {
    /* `min-h-0` is load-bearing: a flex item defaults to `min-height:auto` and refuses
       to shrink below its content, so without it the column grows past its own bound
       and the bar leaves the screen again — which is the whole bug.
       ANCHORED ON CODE, NOT ON A COMMENT: `COMPOSER` is comment-STRIPPED, so an
       `indexOf` for a JSX comment marker returns -1 and `slice(-1)` silently reads the
       last CHARACTER of the file — a pin that passes for the wrong reason. This file's
       first draft did exactly that in three places; it is the trap CLAUDE.md records
       at v2.105.26 / v2.106.0, and it is why these now key on the class itself. */
    const scrollers = COMPOSER.match(/className="[^"]*overflow-y-auto[^"]*"/g) ?? [];
    // The BODY is the one scroller that may GROW — flex-1 + min-h-0 — and there is
    // exactly one of it. A second GROWING scroller would be a second place for the bar
    // to hide behind.
    const growers = scrollers.filter((c) => /flex-1/.test(c));
    expect(growers).toHaveLength(1);
    expect(growers[0]).toMatch(/min-h-0/);
    // Any OTHER scroller (the specific-members picker, v2.107.71) is height-CAPPED, so
    // it cannot push the bar off the bottom no matter how many contacts it lists.
    for (const c of scrollers) {
      if (c === growers[0]) continue;
      expect(c, "a second scroller must be height-capped (max-h-*)").toMatch(/max-h-/);
    }
  });

  it("the swatches and the Post pill sit OUTSIDE the scroller", () => {
    /* THE PROPERTY, asserted structurally rather than by a class string.
       "The bar is `shrink-0`" is only an implementation detail of it; what actually
       stops the pill leaving the screen is that it is not INSIDE the scrolling region.
       An earlier draft of this pin walked back to the nearest preceding `<div`, which
       is not the same as the ENCLOSING one — for the pill that is its sibling chips
       wrapper — so it failed on correct source. This walks real tag depth instead. */
    const endOfDivAt = (src: string, openIdx: number): number => {
      const tag = /<div\b[^>]*?(\/?)>|<\/div>/g;
      tag.lastIndex = openIdx;
      let depth = 0;
      for (let m = tag.exec(src); m; m = tag.exec(src)) {
        if (m[0].startsWith("</")) {
          if (--depth === 0) return m.index;
        } else if (m[1] !== "/") depth++; // a self-closing <div … /> nests nothing
      }
      return -1;
    };
    const scrollerClass = COMPOSER.indexOf("overflow-y-auto");
    const scrollerOpen = COMPOSER.lastIndexOf("<div", scrollerClass);
    expect(scrollerOpen, "no <div carries the scroller").toBeGreaterThan(-1);
    const scrollerClose = endOfDivAt(COMPOSER, scrollerOpen);
    expect(scrollerClose, "the scroller's own </div> was not found").toBeGreaterThan(scrollerOpen);

    for (const [what, needle] of [
      ["the swatch row", "BG_OPTIONS.map((bg, i)"],
      ["the Post pill", 'className="rcta'],
    ] as const) {
      const at = COMPOSER.indexOf(needle);
      expect(at, `${what} is gone`).toBeGreaterThan(-1);
      expect(at, `${what} is inside the scroller — it can scroll out of reach`).toBeGreaterThan(
        scrollerClose,
      );
    }
  });

  it("at most ONE picker panel is open, so two cannot stack above the bar", () => {
    // A boolean each would let the audience, group, and members panels open together
    // and push the Post pill off the bottom. One nullable union = one panel at a time.
    expect(COMPOSER).toMatch(/useState<"audience" \| "group" \| "members" \| null>\(null\)/);
  });
});

describe("4b — the frame's own values", () => {
  it("the text canvas is 26px, centred, with the textarea's OWN caret", () => {
    expect(COMPOSER).toMatch(/text-\[26px\]/);
    expect(COMPOSER).toMatch(/text-center/);
    /* The frame draws a blinking `|` because a static mock has no real caret. A
       decorative pipe beside a live textarea renders TWO carets, so the real one is
       made visible instead. */
    expect(COMPOSER).toMatch(/caret-white/);
    expect(COMPOSER).not.toMatch(/animate-pulse[^>]*>\s*\|/);
  });

  it("five 26px swatches, the selected one ringed", () => {
    expect(COMPOSER).toMatch(/size-\[26px\]/);
    expect(COMPOSER).toMatch(/i === bgIndex \? "ring-\[2\.5px\] ring-white"/);
  });

  it("the accent pill reads the CYCLING accent, never a frozen hue", () => {
    /* Board rule 1: every accent surface reads `var(--rb)`. `.rcta` IS the frame's
       recipe — solid accent, `#04211a` on-accent text, the same accent shadow — so
       using it is what keeps this pill on the one accent rather than a copy of it. */
    expect(COMPOSER).toMatch(/className="rcta/);
    // …and it is the SUBMIT control, not some decorative pill elsewhere.
    const at = COMPOSER.indexOf('className="rcta');
    expect(COMPOSER.slice(Math.max(0, at - 400), at)).toMatch(/onClick=\{submit\}/);
    // No hand-rolled copy of the recipe anywhere in the composer.
    expect(COMPOSER).not.toMatch(/var\(--rb\)/);
    expect(COMPOSER).not.toMatch(/#04211a/);
  });

  it("every control the frame draws small is still a >=44px target (board rule 9)", () => {
    /* The frame is 390x812 and draws the swatch at 26px and the tab pill at ~26px
       tall. The DRAWN size is a look; the TARGET is a separate number, so the swatch
       button is padded out to 44 while its ring stays 26, and the pill keeps 11px type
       with a 44px minimum height.
       THIS SWEEP FOUND A REAL DEFECT IN THIS FRAME'S FIRST CUT: the frame-faithful tab
       pill measured 34.5px (11px text at default leading + `py-2` + border), i.e. it
       failed the board's own rule. It is `min-h-11` now.
       `size-11` / `min-h-11` / `h-11` are all 11 x 0.25rem = 44px. TabPill and
       GlassChip are module-level, so they are checked in CODE rather than COMPOSER. */
    // In the composer itself: the swatch buttons, the header tools and the close button.
    expect(COMPOSER).toMatch(/size-11/);
    // The submit pill.
    expect(COMPOSER).toMatch(/className="rcta h-11/);
    // The two shared controls that render over the canvas.
    const pill = CODE.slice(CODE.indexOf("function TabPill("), CODE.indexOf("function GlassChip("));
    expect(pill, "the tab pill must be a 44px target, not just 26px tall").toMatch(/min-h-11/);
    expect(CODE.slice(CODE.indexOf("function GlassChip("))).toMatch(/min-h-11/);
  });
});

describe("4b — chips over an author-chosen gradient are white-on-scrim", () => {
  it("the tab pill and the chips do NOT use the card-tuned accent recipe", () => {
    /* `.rchip-accent` colours its label with the accent and is measured against the
       app's `--card`. These float on a gradient the AUTHOR picked, which may be the
       yellow/orange entry — accent text there is unreadable. A dark scrim under white
       is legible over all five by construction, and is what the frame draws.
       This is a deliberate exception to the app-wide "prefer .rchip-accent" rule, so
       it is pinned rather than left to look like an oversight. */
    const pill = CODE.slice(CODE.indexOf("function TabPill("), CODE.indexOf("function GlassChip("));
    expect(pill.length).toBeGreaterThan(200);
    expect(pill).not.toMatch(/rchip-accent/);
    expect(pill).toMatch(/bg-black\//);
    expect(pill).toMatch(/text-white/);

    const chip = CODE.slice(CODE.indexOf("function GlassChip("));
    expect(chip).not.toMatch(/rchip-accent/);
    expect(chip).toMatch(/bg-black\//);
  });

  it("both are BUTTONS with a pressed/expanded state, not decoration", () => {
    const pill = CODE.slice(CODE.indexOf("function TabPill("), CODE.indexOf("function GlassChip("));
    expect(pill).toMatch(/aria-pressed=\{active\}/);
    const chip = CODE.slice(CODE.indexOf("function GlassChip("));
    expect(chip).toMatch(/aria-expanded=\{expanded\}/);
    // A chip's visible text is its VALUE, so it needs a name of its own.
    expect(chip).toMatch(/aria-label=\{label\}/);
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
   THE FOUR TABS — and the rule that a post can never be mislabelled
   ───────────────────────────────────────────────────────────────────────────── */

describe("4b — Text / Photo / Video / Audio", () => {
  it("the three media tabs exist and each narrows the picker", () => {
    /* The board asks for three separate media tabs; three tabs that all open a picker
       showing everything are one tab pretending to be three. */
    expect(CODE).toMatch(/const MEDIA_TABS/);
    for (const accept of ['"image/\\*"', '"video/\\*"', '"audio/\\*"']) {
      expect(CODE).toMatch(new RegExp(`accept: ${accept}`));
    }
  });

  it("a tab id IS the server's own status kind, so there is no lookup to get wrong", () => {
    /* `mediaKindOf` returns "image" | "video" | "audio" and feeds `setTab` directly.
       A "photo"-named tab would need a translation table, which is a second place for
       the kind to be decided. Only the LABEL says Photo. */
    expect(CODE).toMatch(/type ComposerTab = "text" \| "image" \| "video" \| "audio"/);
    expect(COMPOSER).toMatch(/setTab\(mediaKindOf\(f\) \?\? "image"\)/);
  });

  it("the POST's kind is read off the FILE, never off the tab", () => {
    /* The property that makes a stale tab harmless: if a picker is cancelled the tab
       may briefly be ahead of the preview, but `submit()` still asks the file what it
       is, so a story can never be posted under the wrong kind. */
    expect(COMPOSER).toMatch(/const kind = mediaKindOf\(file\);/);
    expect(COMPOSER).toMatch(/kind,\n\s*mediaKey: storageKey/);
    // …and the tab is not consulted when building the payload.
    const submit = COMPOSER.slice(COMPOSER.indexOf("async function submit()"));
    const body = submit.slice(0, submit.indexOf("\n  }"));
    expect(body.length).toBeGreaterThan(300);
    expect(body).not.toMatch(/\btab\b/);
  });

  it("`mode` is DERIVED from the tab, so the canvas and the payload cannot disagree", () => {
    expect(COMPOSER).toMatch(/const mode: "text" \| "media" = tab === "text" \? "text" : "media";/);
    // No second source of truth.
    expect(COMPOSER).not.toMatch(/setMode\(/);
  });

  it("the picker opens inside the user gesture, and can re-offer the same file", () => {
    /* Setting `accept` from state and clicking on the next render loses the gesture,
       and a file dialog opened outside one is refused — a picker that silently never
       appears. Clearing `value` first is what makes re-picking the SAME file fire
       `change` again. */
    const fn = COMPOSER.slice(COMPOSER.indexOf("function openPicker("));
    const body = fn.slice(0, fn.indexOf("\n  }"));
    expect(body.length).toBeGreaterThan(80);
    expect(body).not.toMatch(/await|useState|setTimeout/);
    expect(body).toMatch(/el\.accept = accept;/);
    expect(body).toMatch(/el\.value = "";/);
    expect(body).toMatch(/el\.click\(\);/);
    // …and the attribute is restored, so it is never left narrowed for the next opener.
    expect(body).toMatch(/el\.accept = "image\/\*,video\/\*,audio\/\*";/);
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
   NOTHING SHIPPED WAS DESIGNED AWAY
   ───────────────────────────────────────────────────────────────────────────── */

describe("4b — the frame did not cost us a capability", () => {
  it("the in-app recorder survives, still gated on support", () => {
    /* v2.96.2: iOS blocks the SYSTEM camera while on a call, which is why an in-page
       recorder exists at all. The frame's camera tool is its home now. Gated, because
       an unsupported browser showing a dead control is the regression that test
       exists to catch. */
    expect(COMPOSER).toMatch(/videoRecorderSupported\(\) && \(/);
    expect(COMPOSER).toMatch(/setRecOpen\(true\)/);
    expect(COMPOSER).toMatch(/maxMs=\{30_000\}/);
  });

  it("posting to a GROUP survives, and still replaces the audience", () => {
    expect(COMPOSER).toMatch(/\.\.\.\(targetGroupId != null \? \{ conversationId: targetGroupId \} : \{\}\)/);
    expect(COMPOSER).toMatch(/const audiencePickerApplies = targetGroupId == null;/);
    // The group note is shown INSTEAD of the audience control, never beside it.
    expect(COMPOSER).toMatch(/\{audiencePickerApplies \? \(/);
  });

  it("the audience picker still offers both options and sends what it showed", () => {
    expect(COMPOSER).toMatch(/AUDIENCE_OPTIONS\.map/);
    expect(COMPOSER).toMatch(/audience: effectiveAudience/);
  });

  it("the group picker still only exists when I am in a group", () => {
    // A picker with one option is a control that cannot do anything.
    expect(COMPOSER).toMatch(/myGroups\.length > 0 && /);
  });

  it("caption, media upload and the true media duration all still ride the post", () => {
    expect(COMPOSER).toMatch(/uploadStatusMedia\(file/);
    expect(COMPOSER).toMatch(/const ms = await readMediaDurationMs\(file\)/);
    expect(COMPOSER).toMatch(/text: caption\.trim\(\) \|\| undefined/);
  });

  it("the audience chip shows the story's real 24h life", () => {
    // Matches the server's STATUS_TTL_MS; a chip claiming a different life would be
    // the only place on screen saying how long a story lasts, and wrong.
    expect(COMPOSER).toMatch(/24h/);
  });
});
