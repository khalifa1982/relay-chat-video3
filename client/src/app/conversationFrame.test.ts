/**
 * BOARD 1d — THE CONVERSATION SCREEN THE OWNER PHOTOGRAPHED.
 *
 * Their words: *"the message section is not integrated to the new design … You should check
 * all my new designs and match it to the existing one"*, with a screenshot of a DM full of
 * voice notes.
 *
 * Two of the findings here are visible IN that screenshot, and both are contrast rather than
 * layout — which is why reading the source had not surfaced them:
 *
 *   THE PLAY TRIANGLE. `.rchip-accent` is a CARD recipe, measured on `--card`, and it was
 *   applied to a control sitting on a SATURATED BUBBLE. Measured across all 36 bubble
 *   surfaces the app can draw (own orange, peer blue, the 16 group hues, both gradient stops
 *   of each): 1.16:1 at worst, FAILING AA on 30 of the 36. A recipe is only valid on the
 *   surface it was measured against.
 *
 *   THE ✓✓. The read tick was the cycling accent and delivered was white at 70%. On the
 *   orange bubble's pale stop that is 1.34:1 for read against 1.77:1 for delivered — so the
 *   vocabulary was not merely faint, it was INVERTED: the state that matters most was the
 *   fainter of the two.
 *
 * And one is a claim the app cannot keep: *"Media is end-to-end encrypted"* was printed on
 * every media viewer while `messages.body` is plain `text` and the server runs a SQL `LIKE`
 * over it. Board 1d's centre chip asks for a second one; it is DECLINED rather than built.
 *
 * MEASURED where the claim is a number, source-pinned where it is structural. The bar
 * pattern, the tick ordering and the glyph rule are the three that a restyle can silently
 * undo, so they are asserted as properties rather than as literals.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { bubbleGlyphColor, GROUP_PALETTE, peerPaletteIndex } from "./peerColors";

const root = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const MSG = strip(root("client/src/pages/app/Messages.tsx"));
const CSS = root("client/src/index.css");
const ADMIN = strip(root("client/src/pages/app/Admin.tsx"));

describe("the voice note is the board's waveform, and its control can be seen", () => {
  it("18 bars from a fixed pattern, not a progress track", () => {
    const m = CSS === MSG ? null : MSG.match(/const WAVE_BARS = \[([^\]]+)\]/);
    expect(m, "the bar pattern must be a named constant").toBeTruthy();
    const bars = (m as RegExpMatchArray)[1].split(",").map((n) => Number(n.trim()));
    expect(bars.length, "board 1d specifies 18").toBe(18);
    for (const h of bars) expect(h).toBeGreaterThan(0);
    // …and they must all differ enough to read as a wave rather than a block
    expect(new Set(bars).size).toBeGreaterThanOrEqual(14);
    expect(MSG).toMatch(/WAVE_BARS\.map\(/);
  });

  it("the seek element keeps its slider role and aria values", () => {
    /* The bars REPLACE the track inside the same element. Losing the role would take the
       only way a screen reader has to report or change the position. */
    const at = MSG.indexOf('role="slider"');
    expect(at).toBeGreaterThan(-1);
    const el = MSG.slice(at, at + 420);
    expect(el).toMatch(/aria-valuemin=\{0\}/);
    expect(el).toMatch(/aria-valuenow=\{Math\.round\(cur\)\}/);
    expect(el).toMatch(/onClick=\{seek\}/);
    expect(el, "the bars live inside the seek element").toMatch(/WAVE_BARS/);
  });

  it("the play disc is WHITE with the bubble's own dark stop as its glyph", () => {
    /* NOT `.rchip-accent`: measured 1.16:1 at worst on a saturated bubble, failing on 30 of
       36 surfaces. The white disc reads as a control on every hue by construction and the
       glyph is 4.92:1 at worst against it. */
    const at = MSG.indexOf('aria-label={playing ? "Pause" : "Play voice note"}');
    expect(at).toBeGreaterThan(-1);
    const btn = MSG.slice(at, at + 700);
    expect(btn).toMatch(/bg-white/);
    expect(btn, "a hairline, because a white disc on a pale bubble is only 1.92:1").toMatch(
      /ring-1 ring-black\/10/,
    );
    expect(btn).toMatch(/style=\{\{ color: glyph \}\}/);
    expect(btn, "the card recipe must not come back on a bubble").not.toMatch(/rchip-accent/);
  });

  it("every bubble surface really does get a distinct dark-stop glyph", () => {
    /* Driven, because whether the colour is legible is exactly what a source pin cannot
       answer — and because a wrong branch here silently paints one hue on every bubble. */
    expect(bubbleGlyphColor({ mine: true, isGroup: false, senderIdentityId: null })).toBe("#c2410c");
    expect(bubbleGlyphColor({ mine: false, isGroup: false, senderIdentityId: 7 })).toBe("#1d4ed8");
    for (const id of [1, 2, 3, 41, 999]) {
      const got = bubbleGlyphColor({ mine: false, isGroup: true, senderIdentityId: id });
      expect(got).toBe(GROUP_PALETTE[peerPaletteIndex(id)].to);
    }
    // and `mine` wins over the group branch, or my own bubble borrows a stranger's hue
    expect(bubbleGlyphColor({ mine: true, isGroup: true, senderIdentityId: 3 })).toBe("#c2410c");
  });

  it("both attachment mounts pass the glyph, so a view-once note is not the odd one out", () => {
    /* v2.99.74 records this exact class: the ordinary bubble passed `durationMs` and the
       revealed-expiring path did not, so a view-once voice note sat frozen. */
    const passes = MSG.match(/glyph=\{bubbleGlyphColor\(/g) ?? [];
    expect(passes.length, "the ordinary bubble AND the revealed-expiring path").toBe(2);
  });
});

describe("read is more visible than delivered, not less", () => {
  it("read is solid white and delivered is translucent white", () => {
    const m = MSG.match(/const tickStyle = \{[^}]+\}/);
    expect(m).toBeTruthy();
    const expr = (m as RegExpMatchArray)[0];
    expect(expr).toMatch(/read \? "#fff"/);
    expect(expr).toMatch(/rgba\(255,255,255,0?\.55\)/);
    expect(expr, "the accent measured 1.34:1 on the orange bubble").not.toMatch(/var\(--rb\)/);
  });

  it("ONE expression decides it, so the colour cannot be set twice", () => {
    /* v2.105.17: the first cut set a grey class and overrode it inline, and the mutation run
       showed the class could be deleted with nothing changing. */
    expect((MSG.match(/const tickStyle =/g) ?? []).length).toBe(1);
  });
});

describe("board 1d's smaller type and spacing rules", () => {
  it("bubble timestamps are mono, like the day divider on the same screen", () => {
    /* Counted on the CLASS rather than on the whole class string: one of the two rows is a
       CONCATENATION (`{"… " + "text-white/70"}`), so a `[^"]*` window cannot span it — my
       first version of this assertion failed on correct code for that reason. */
    const rows = MSG.match(/font-mono text-\[9px\]/g) ?? [];
    expect(rows.length, "the conversation bubble AND the search-result bubble").toBe(2);
    // both really are timestamp rows on an own/peer bubble, not something else that is mono
    for (const anchor of ['font-mono text-[9px] mt-1 " + "text-white/70"', "font-mono text-[9px] leading-none"]) {
      expect(MSG, anchor).toContain(anchor);
    }
  });

  it("the attach clip is INSIDE the field, with logical properties for RTL", () => {
    /* Measured: the text field went 190px -> 232px at 390px, exactly the recovered cell.
       `pe-`/`end-` rather than `pr-`/`right-` because this app renders Arabic — the owner's
       own thread has an Arabic message in it — so the reserved space has to swap sides. */
    expect(MSG).toMatch(/className="h-11 w-full rounded-full ps-4 pe-11"/);
    expect(MSG).toMatch(/absolute end-1 top-1\/2 size-9 -translate-y-1\/2 rounded-full/);
    expect(MSG, "the field must be able to shrink inside its wrapper").toMatch(
      /<div className="relative min-w-0 flex-1">/,
    );
  });
});

describe("the header says each thing once, and no colour means two things", () => {
  it("video comes before call, and the call chip is the accent", () => {
    const vid = MSG.indexOf('title="Video call"');
    const call = MSG.indexOf('title="Voice call"');
    expect(vid).toBeGreaterThan(-1);
    expect(call).toBeGreaterThan(-1);
    expect(vid < call, "board 1d orders video then call").toBe(true);
    expect(MSG.slice(call, call + 500)).toMatch(/rchip-accent/);
  });

  it("the voice chip no longer wears the Registered badge's exact green", () => {
    /* `#22c55e` is what `VerifiedBadge` uses for the registered tier, and this header
       renders that badge ~40px to the left of the button. Two meanings, one green, side by
       side — visible in the owner's own screenshot. */
    const badge = strip(root("client/src/app/VerifiedBadge.tsx"));
    expect(badge, "the badge still owns that hex").toMatch(/#22c55e/);
    const hdr = MSG.slice(MSG.indexOf("{!isGroup && thread?.peerNumber && ("), MSG.indexOf("{isGroup && thread && ("));
    expect(hdr.length).toBeGreaterThan(200);
    expect(hdr, "…so the 1:1 header must not").not.toMatch(/#22c55e/);
  });

  it("typing is announced once — the header arm yields to TypingLine in a group", () => {
    /* It used to fire in both places at once AND drop "5 members · 3 online" the moment
       anybody typed, so a group header lost its size to repeat something already on screen.
       TypingLine is kept because it names WHO and colours them per person. */
    expect(MSG).toMatch(/\{typers\.length > 0 && !isGroup \? \(/);
    expect(MSG).toMatch(/<TypingLine typers=\{typers\}/);
  });
});

describe("nothing on screen claims a security property the app does not have", () => {
  it("the media viewer no longer says end-to-end", () => {
    /* `messages.body` is plain `text` and the server runs `like(messages.body, '%…%')` — a
       database substring match, only possible on plaintext it can read. */
    expect(root("drizzle/schema.ts")).toMatch(/body: text\("body"\)/);
    expect(strip(root("server/v2db.ts"))).toMatch(/like\(messages\.body/);
    expect(MSG).not.toMatch(/end-to-end/i);
    expect(MSG).toMatch(/Encrypted in transit/);
  });
});

describe("the board's one card recipe paints in both themes", () => {
  it(".rglass carries an opaque base and a token hairline", () => {
    const at = CSS.indexOf(".relay-v2 .rglass {");
    expect(at).toBeGreaterThan(-1);
    /* Comments stripped, because this rule's own prose explains that the `background`
       SHORTHAND is what broke it — so a `not.toMatch` on the raw slice would be deciding on
       English rather than on the declarations. */
    const rule = CSS.slice(at, CSS.indexOf("}", at)).replace(/\/\*[\s\S]*?\*\//g, "");
    expect(rule, "a shorthand `background` resets the colour to transparent").not.toMatch(
      /\n\s*background:/,
    );
    expect(rule).toMatch(/background-color: var\(--card\)/);
    expect(rule).toMatch(/background-image: linear-gradient/);
    expect(rule, "white at 9% is invisible on the light card the app defaults to").toMatch(
      /border: 1px solid var\(--border\)/,
    );
  });

  it("the one-call-site workaround is gone, so every consumer gets the fix", () => {
    expect(ADMIN, "GLASS_SURFACE patched Admin only and left four consumers broken").not.toMatch(
      /GLASS_SURFACE/,
    );
    const users = ["client/src/app/GuestRestore.tsx", "client/src/app/ShareNumber.tsx", "client/src/app/GroupInfoSheet.tsx"];
    for (const f of users) expect(strip(root(f)), `${f} uses the shared recipe`).toMatch(/rglass/);
  });
});
