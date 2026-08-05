/**
 * v2.106.62 — board 3c/1d, the conversation interior.
 *
 * Owner: *"inside the message, where different people participate in the messages with
 * different bubble colors, everything. If you look at the designs I uploaded, you didn't
 * match it 100%; you matched it about 60%… do it exactly how I did it there."*
 *
 * Every value asserted here is read off the board's own markup rather than described from a
 * screenshot, so the numbers are the board's and not my reading of a picture:
 *
 *   received bubble   padding:8px 12px · radius 16px 16px 16px 5px
 *                     background linear-gradient(180deg,rgba(255,255,255,.08),rgba(255,255,255,.03))
 *                     border 1px solid rgba(255,255,255,.11)
 *   own bubble        radius 16px 16px 5px 16px · rgba(245,140,60,.17) · border rgba(245,140,60,.45)
 *   sender name       10.5px/700 in the sender's own hue
 *   in-bubble stamp   IBM Plex Mono 8.5px · right · #7d8f8a received / #9fb0ab own
 *   reply quote       margin-top:4px · padding:6px 9px · radius 9px
 *                     background rgba(var(--rb-rgb),.08) · border-left 2.5px solid var(--rb)
 *                     name 9.5px/700 in the QUOTED person's hue · text 10.5px #9fb0ab, ellipsised
 *   @mention          var(--rb), bold
 *   day divider       mono 9px · letter-spacing .22em · #68797c
 *
 * THE HEADLINE FINDING IS NOT A COLOUR. `Messages.tsx` had exactly two `linkify` call sites,
 * and the one that renders a conversation passed no roster — so board 3c's accent `@mention`
 * had never appeared in a chat, only in the search-results list. v2.106.17 shipped the
 * resolver, the shared `findMentions` and the composer picker, and the single render that
 * matters got a bare `linkify(body)`. The pins in `server/mentions.test.ts` all cover the
 * roster being BUILT and the renderer being ABLE to highlight; none covered it arriving.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..", "..", "..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

/** Strip comment SPANS, so an assertion can never be satisfied by prose describing it. */
function codeOnly(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const MESSAGES = codeOnly(read("client/src/pages/app/Messages.tsx"));
const LINKIFY = codeOnly(read("client/src/lib/linkify.tsx"));

/**
 * The body of the function/arrow starting at `anchor`, found by BRACE BALANCE rather than by
 * a fixed slice or `indexOf("\n}")`. Both of those have bitten this repo repeatedly — a fixed
 * slice goes stale the moment a comment is added above the target, and `\n}` closes an inline
 * PARAMETER OBJECT for a signature like `function f({ a, b }: { a: X; b: Y })`.
 */
function bodyAt(src: string, anchor: string): string {
  const at = src.indexOf(anchor);
  if (at < 0) throw new Error(`anchor not found: ${anchor}`);
  const open = src.indexOf("{", at);
  if (open < 0) throw new Error(`no body for: ${anchor}`);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  throw new Error(`unbalanced body for: ${anchor}`);
}

describe("@mentions actually reach a conversation", () => {
  it("EVERY linkify call site in Messages passes the roster", () => {
    /* THE BUG, and the shape of the pin that would have caught it. There are two call sites:
       the search-results list (which always passed the roster) and `content()`, the helper
       every ordinary message renders through — `if (!expiring) return content(m.body, …)`.
       That one passed nothing, so the feature was invisible in the one place it exists for.

       Asserted as a SWEEP over every occurrence rather than as "the roster is passed
       somewhere", because "somewhere" is exactly what was true while the bug shipped. */
    const calls = [...MESSAGES.matchAll(/linkify\(([^)]*)\)/g)].map((m) => m[1]);
    expect(calls.length, "both render paths are still there").toBeGreaterThanOrEqual(2);
    for (const args of calls) {
      expect(args, `linkify(${args}) renders without the mention roster`).toMatch(
        /mentionRoster/,
      );
    }
  });

  it("the ordinary (non-expiring) path is the one that goes through content()", () => {
    // If this stops being true the sweep above stops covering the main bubble, so the
    // premise is pinned rather than assumed.
    // v2.107.36: the call grew a third argument when the album grid moved onto
    // this path (it had shipped only in the search bubble — the very trap the
    // sweep exists to catch). The premise is unchanged: the ordinary bubble
    // still renders through content(), so the mention sweep still covers it.
    expect(MESSAGES).toMatch(/if \(!expiring\) return content\(m\.body, m\.attachment, m\.album\)/);
  });

  it("the mention is the accent for every message, with no `mine` exception", () => {
    // MEASURED across all 12 accent hues, worst case: 1.06:1 on the old solid #fb923c own
    // bubble, 5.44:1 mobile / 4.82:1 desktop on the board's rgba(245,140,60,.17). The old
    // `mine ? undefined :` branch was right about the surface the app had chosen and wrong
    // about the board's.
    expect(LINKIFY).toMatch(/style=\{\{ color: "var\(--rb, #3FE0C5\)" \}\}/);
    expect(LINKIFY).not.toMatch(/mine/);
  });
});

describe("board 3c's reply quote", () => {
  const quote = bodyAt(MESSAGES, "m.replyToId != null && (()");

  it("is accent-tinted with an accent LEFT border, on a received bubble", () => {
    expect(quote).toMatch(/rgba\(var\(--rb-rgb[^)]*\),\s*\.08\)/);
    expect(quote).toMatch(/borderLeftColor: "var\(--rb, #3FE0C5\)"/);
    /* `border-s-`, not `border-l-`: the quote's rule is a bar on the side the text
       STARTS from, so in Arabic it belongs on the right. Board 3c draws it left because
       the board is an English mock — the property is "leading edge", not "left". */
    expect(quote).toMatch(/border-s-\[2\.5px\]/);
    expect(quote).not.toMatch(/border-l-/);
    expect(quote).toMatch(/rounded-\[9px\]/);
  });

  it("names the QUOTED person in THEIR OWN hue, not a flat colour", () => {
    /* This is the point of the quote rather than decoration: it answers "whose message is
       this replying to" before a word is read. It must resolve the colour from the REPLIED-TO
       message's sender, so a mutation that colours it by the CURRENT sender — which looks
       identical whenever somebody quotes themselves — bites. */
    expect(quote).toMatch(/nameColorFor\(\{\s*isGroup,\s*senderIdentityId: quotedId\s*\}\)/);
    expect(quote).toMatch(/const quotedId = quoted\?\.senderIdentityId/);
  });

  it("is ONE line, ellipsised — a quote that wraps stops being a reference", () => {
    expect(quote).toMatch(/whitespace-nowrap/);
    expect(quote).toMatch(/text-ellipsis/);
    expect(quote).toMatch(/overflow-hidden/);
  });

  it("keeps the white treatment on MY bubble", () => {
    /* Not an oversight: the board only ever draws a quote on a received bubble, so it has
       nothing to say here, and an accent-tinted panel with an accent border inside an orange
       bubble is two tints competing for the same few pixels. The accent moving onto the
       mention and the tick is about GLYPHS on that fill, which is a different question from
       a filled panel. */
    // Whitespace-flexible: prettier breaks this ternary across three lines, so a
    // single-line pattern fails on perfectly correct source (it did, first run).
    expect(quote).toMatch(/mine\s*\?\s*undefined\s*:/);
    expect(quote).toMatch(/border-white\/50/);
  });

  it("uses LOGICAL padding, so an RTL quote is not padded on the wrong side", () => {
    expect(quote).toMatch(/\bps-\d/);
    expect(quote).not.toMatch(/\bpl-\d/);
  });
});

describe("board 3c's bubble geometry and stamp", () => {
  it("the tail notch is the board's 5px, not Tailwind's 2px `rounded-*-sm`", () => {
    // `16px 16px 16px 5px` received / `16px 16px 5px 16px` mine. In Tailwind v4
    // `rounded-bl-sm` is 2px, close enough to a square corner at bubble scale to read as one.
    expect(MESSAGES).toMatch(/rounded-br-\[5px\]/);
    expect(MESSAGES).toMatch(/rounded-bl-\[5px\]/);
    expect(MESSAGES, "the 2px notch is gone").not.toMatch(/rounded-b[lr]-sm/);
  });

  it("the tail is on the side the speaker is on", () => {
    const tail = MESSAGES.slice(MESSAGES.indexOf("const tail = mine"));
    const br = tail.indexOf("rounded-br-[5px]");
    const bl = tail.indexOf("rounded-bl-[5px]");
    expect(br).toBeGreaterThan(-1);
    expect(bl).toBeGreaterThan(br); // mine (bottom-right) is the first arm of the ternary
  });

  it("the in-bubble stamp is the board's mono 8.5px, muted per side", () => {
    /* Anchored on the CONVERSATION stamp specifically — `font-mono text-[8.5px]` alone finds
       the SEARCH-RESULT stamp first (it sits earlier in the file), and that one is a plain
       left-aligned row with no `justify-end`, so the assertion failed on correct source. */
    const at = MESSAGES.indexOf("justify-end items-center gap-1 font-mono text-[8.5px]");
    expect(at, "the conversation bubble's stamp row").toBeGreaterThan(0);
    const row = MESSAGES.slice(MESSAGES.lastIndexOf("<div", at), at + 400);
    expect(row).toMatch(/justify-end/);
    expect(row).toMatch(/#9fb0ab/); // mine
    expect(row).toMatch(/#7d8f8a/); // received
    expect(row, "a flat white/70 was the pre-board value").not.toMatch(/text-white\/70/);
  });
});

describe("board 3c's day divider", () => {
  const at = MESSAGES.indexOf("{day.label}");
  const block = MESSAGES.slice(MESSAGES.lastIndexOf("<span", at), at);

  it("takes the board's type — mono 9px, .22em", () => {
    expect(block).toMatch(/text-\[9px\]/);
    expect(block).toMatch(/letterSpacing: "\.22em"/);
    expect(block).toMatch(/font-mono/);
  });

  it("reads as BARE TEXT by matching the scroller's own surface, and still occludes", () => {
    /* THE BOARD DRAWS NO PILL AT ALL, and it could not have: its frame is a static mock, so
       it never had to solve what v2.105.3 solved here — this header is STICKY and bubbles
       scroll behind it, so a transparent background has message text sliding through the
       letters. The resolution is a backing that MATCHES the scroll container rather than
       contrasting with it, so it is invisible against it and reads as the board's bare text.

       Pinned as the exact pair the scroller sets, because "has some background" would be
       satisfied by the `bg-muted` chip this replaces. */
    expect(block).toMatch(/bg-background md:bg-card/);
    expect(block, "the chip's ring and shadow are what made it content").not.toMatch(/ring-/);
    expect(block).not.toMatch(/shadow-/);
    expect(block).not.toMatch(/bg-muted/);
    // And the scroller really does set that pair — otherwise the match above is a coincidence.
    expect(MESSAGES).toMatch(/overflow-y-auto[^"]*bg-background md:bg-card/);
  });

  it("stays z-10: above the bubbles, below the search overlay and the lightbox", () => {
    const sticky = MESSAGES.slice(MESSAGES.indexOf("sticky top-0"), at);
    expect(sticky).toMatch(/z-10/);
  });

  it("is #708285, the closest value to the board's that clears AA on BOTH surfaces", () => {
    /* MEASURED by compositing in a real browser: the board's own `#68797c` is 4.46:1 on our
       mobile `--background` — essentially the surface the board drew it on — but only 4.13:1
       on the DESKTOP `--card`, which is lighter and which the board never drew. One step
       lighter gives 5.05 / 4.67. The colour moves as little as possible from what was
       specified; taking the board's literal here would have shipped sub-AA text on desktop. */
    expect(block).toMatch(/#708285/);
  });
});
