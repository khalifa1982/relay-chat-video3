/* ============================================================
   v2.99.85 — who is speaking, told by colour; and the ⋮ looks like a button.

   Owner, from a group-chat screenshot: "when I type it should showing typing like
   my name typing and it's like first name is capital small letter for the rest and
   it keep increase. the second letter become capital and the first one small. it's
   like nice animation smoothly … and it give a different color if there is two
   three people typing in the same time like I'm typing and the other user typing it
   will show for him. I'm typing and he will see my typing and when he post mind
   bubble is orange so him he should. the other side should be blue, but if you were
   in the group each one give him a different colour for his type of chat bubble.
   also, the three dots is not clear. it's very light color. you need to make it
   highlighted. it means that a three dots. you can click on it"

   The colour rule is tested BEHAVIOURALLY — it is a function, and whether two
   different people can collide on one hue is the only question that matters about
   it. The layout/DOM halves are source-pinned.
   ============================================================ */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  BRAND_GRADIENT,
  GROUP_BUBBLE_STYLE,
  GROUP_PALETTE,
  OWN_BUBBLE_STYLE,
  PEER_BUBBLE_STYLE,
  bubbleStyleFor,
  nameColorFor,
  peerPaletteIndex,
  senderAvatarStyle,
} from "./peerColors";

const ROOT = path.resolve(__dirname, "..", "..", "..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const MESSAGES = read("client/src/pages/app/Messages.tsx");
const TYPING = read("client/src/app/TypingLine.tsx");

function codeOnly(src: string): string {
  return src
    .split("\n")
    .filter(l => {
      const t = l.trim();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");
}

/** The alpha of an `rgba(...)`, or 1 for anything opaque. */
function alphaOf(css: string): number {
  const m = /rgba\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*([\d.]+)\s*\)/.exec(css);
  return m ? Number(m[1]) : 1;
}

describe("the colour rule", () => {
  it("mine is ORANGE and TRANSLUCENT, everywhere — never the accent", () => {
    /* REWRITTEN v2.106.62. This froze `#fb923c`, i.e. the SOLID gradient the app chose for
       itself, and the reason recorded beside it was wrong about the board: v2.106.40 held
       that "the board draws the outgoing bubble as a translucent ACCENT tint" and treated the
       owner's orange request as overriding it. Frames 1d and 3c both fill it
       `rgba(245,140,60,.17)` — orange. There was never a conflict, only a difference of
       WEIGHT, and freezing the solid literal is what hid that.

       THE PROPERTY IS THREE THINGS, and the third is the one that stops the misreading
       coming back: it is one object whatever the thread kind, it is the board's orange at
       the board's weight (translucent, so the accent-coloured tick and mention on top of it
       can be seen), and it is NOT the accent — somebody "correcting" this to
       `rgba(var(--rb-rgb),…)` would be re-introducing exactly the error being undone. */
    expect(
      bubbleStyleFor({ mine: true, isGroup: false, senderIdentityId: 7 })
    ).toBe(OWN_BUBBLE_STYLE);
    expect(
      bubbleStyleFor({ mine: true, isGroup: true, senderIdentityId: 7 })
    ).toBe(OWN_BUBBLE_STYLE);
    const fill = String(OWN_BUBBLE_STYLE.backgroundColor);
    expect(fill, "the board's own orange channels").toContain("245,140,60");
    expect(alphaOf(fill), "translucent, so the accent reads on top of it").toBeLessThan(0.5);
    expect(fill, "orange, NOT the accent — that was the misreading").not.toMatch(/--rb/);
    // The SEND BUTTONS keep the solid gradient: a translucent primary action reads disabled.
    expect(String(BRAND_GRADIENT)).toContain("#fb923c");
  });

  it("a 1:1 peer is the board's glass with the owner's BLUE on the edge, never hashed", () => {
    /* REWRITTEN v2.106.62. This froze `#3b82f6` as the FILL. The board uses the same neutral
       glass for a 1:1 peer as for a group member — byte-identical markup in frames 1d and 3c
       — so "match the board exactly" and the owner's earlier "the other side should be blue"
       genuinely conflicted. Put to them, they chose neutral glass PLUS a blue edge, so the
       blue moved from the fill to the border rather than being deleted.

       Two properties: it is never id-hashed (a two-person thread has no ambiguity to
       resolve), and the blue survives SOMEWHERE — on the border, with the fill matching a
       group member's exactly. */
    for (const id of [1, 2, 3, 40, 999, 123456]) {
      expect(
        bubbleStyleFor({ mine: false, isGroup: false, senderIdentityId: id })
      ).toBe(PEER_BUBBLE_STYLE);
    }
    expect(
      String(PEER_BUBBLE_STYLE.background),
      "the board's neutral glass, identical to a group member's",
    ).toBe(String(GROUP_BUBBLE_STYLE.background));
    expect(
      String(PEER_BUBBLE_STYLE.borderColor),
      "the owner's blue, kept as the edge",
    ).toMatch(/59\s*,\s*130\s*,\s*246/);
    expect(String(GROUP_BUBBLE_STYLE.borderColor)).not.toMatch(/59\s*,\s*130\s*,\s*246/);
  });

  it("in a group each member gets their own colour", () => {
    /* REWRITTEN v2.106.61. This collected the BUBBLE background, i.e. it pinned WHERE the
       colour was applied rather than the property — that each member is told apart by
       colour. The owner's board (frame 3c) puts a group person's colour on their NAME and
       AVATAR and gives every received bubble one neutral surface, and asked directly, they
       chose the board. So the rule is unchanged and only its carrier moved; asserted on
       both carriers now, which is STRICTER than the single value it replaced. */
    const names = new Set<string>();
    const discs = new Set<string>();
    for (const id of [11, 12, 13, 14, 15]) {
      names.add(nameColorFor({ isGroup: true, senderIdentityId: id }));
      discs.add(
        String(
          senderAvatarStyle({ isGroup: true, senderIdentityId: id }).background
        )
      );
    }
    // Five consecutive ids must not collapse onto one hue — that is the whole
    // feature, and a plain `id % N` would be fine here while failing elsewhere,
    // which is why the next test exists.
    expect(names.size).toBeGreaterThan(1);
    expect(discs.size).toBeGreaterThan(1);
    /* A person's disc and their name must come from the SAME palette entry, or the two
       surfaces tell you a different person is speaking. Compared PER PERSON, not by
       cardinality: `expect(discs.size).toBe(names.size)` was the first version of this and
       a mutation that shifted the disc's entry by three SURVIVED it — the counts match
       either way. Caught by mutation, not by reading. */
    for (const id of [11, 12, 13, 14, 15, 0, 987654]) {
      const entry = GROUP_PALETTE[peerPaletteIndex(id)];
      const disc = String(
        senderAvatarStyle({ isGroup: true, senderIdentityId: id }).background
      );
      expect(disc, `id ${id}`).toContain(`hsl(${entry.hue} 65% 62%)`);
      expect(nameColorFor({ isGroup: true, senderIdentityId: id })).toBe(
        entry.text
      );
    }
  });

  it("PeerAvatar actually APPLIES the tint it is handed", () => {
    /* Without this the whole thing is a silent no-op: `senderAvatarStyle` would compute a
       correct gradient, the gutter would pass it, and the disc would render in the shared
       `.ravatar-fallback` grey with every test still green. A mutation dropping the spread
       SURVIVED the first version of this suite. */
    const po = fs.readFileSync(
      path.join(__dirname, "PeerOverlays.tsx"),
      "utf8"
    );
    expect(po).toMatch(/fallbackStyle\?:\s*React\.CSSProperties/);
    // Spread INTO the fallback span's style, and after the geometry so a caller can only
    // add colour and can never break the alignment every row depends on.
    expect(po).toMatch(
      /fontSize: Math\.max\(11, size \* 0\.34\),\s*\.\.\.fallbackStyle/
    );
  });

  it("every received group bubble is the SAME neutral surface", () => {
    // The board's reply quote and @mention are accent-coloured INSIDE the bubble, which
    // only reads on a neutral fill — a per-person hue there would compete with the accent
    // in every bubble. So one surface for everybody is what makes the rest of 3c possible.
    const seen = new Set<string>();
    for (const id of [11, 12, 13, 14, 15, 999, 123456]) {
      seen.add(
        String(
          bubbleStyleFor({ mine: false, isGroup: true, senderIdentityId: id })
            .background
        )
      );
    }
    expect(seen.size).toBe(1);
    expect(
      bubbleStyleFor({ mine: false, isGroup: true, senderIdentityId: 11 })
    ).toBe(GROUP_BUBBLE_STYLE);
    // Mine and the 1:1 peer keep their own colours — the owner named both explicitly.
    expect(
      bubbleStyleFor({ mine: true, isGroup: true, senderIdentityId: 11 })
    ).not.toBe(GROUP_BUBBLE_STYLE);
    expect(
      bubbleStyleFor({ mine: false, isGroup: false, senderIdentityId: 11 })
    ).not.toBe(GROUP_BUBBLE_STYLE);
  });

  it("neighbouring ids land on DIFFERENT hues", () => {
    // Consecutive ids are what a young install hands out, and people added to one
    // group are frequently consecutive — so four neighbours collapsing onto one or
    // two colours defeats the whole feature.
    //
    // THIS IS WHAT CAUGHT A REAL BUG IN MY OWN MIX: the first version used a plain
    // `n * 2654435761`, which produces a double, and the following `>>>` truncates
    // to 32 bits — throwing away the high bits that carry all the mixing. At base
    // 1000 it returned 1,1,3,1.
    //
    // Stated honestly, because the test's name used to overclaim: a plain
    // `id % 10` ALSO passes this, since consecutive ids trivially differ under a
    // modulo. The mix is not justified by this property — it is there so SPARSE and
    // non-consecutive ids distribute as evenly as dense ones. With ten colours some
    // pair must always collide; that is the pigeonhole, not a defect.
    const runs: string[][] = [];
    for (const base of [1, 10, 100, 1000, 5000]) {
      runs.push([0, 1, 2, 3].map(k => String(peerPaletteIndex(base + k))));
    }
    for (const run of runs) {
      expect(
        new Set(run).size,
        "four neighbours share a hue: " + run.join(",")
      ).toBeGreaterThan(2);
    }
  });

  it("is STABLE — the same person is always the same colour", () => {
    // Derived from the identity id, not from roster position, so it cannot change
    // as people join or a query reorders them, and every participant sees the same
    // person in the same colour without agreeing on an ordering.
    const a = peerPaletteIndex(4242);
    for (let i = 0; i < 50; i++) expect(peerPaletteIndex(4242)).toBe(a);
  });

  it("never indexes outside the palette, for any input", () => {
    for (const id of [
      0,
      -1,
      -99999,
      1,
      2 ** 31,
      Number.MAX_SAFE_INTEGER,
      NaN,
      Infinity,
      null,
      undefined,
    ]) {
      const i = peerPaletteIndex(id as number);
      expect(Number.isInteger(i)).toBe(true);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(GROUP_PALETTE.length);
      // …and the per-person AVATAR gradient it produces is always well-formed. (This
      // asserted the BUBBLE gradient until v2.106.61, when the hue moved off the fill;
      // the property — no input can produce a malformed colour — is unchanged.)
      const st = senderAvatarStyle({
        isGroup: true,
        senderIdentityId: id as number,
      });
      expect(String(st.background)).toMatch(
        /^linear-gradient\(135deg,hsl\(\d{1,3} 65% 62%\),hsl\(\d{1,3} 70% 42%\)\)$/
      );
      // Every hue is a real angle, so no entry can emit `hsl(NaN …)`.
      for (const h of String(st.background).matchAll(/hsl\((\d{1,3}) /g)) {
        expect(Number(h[1])).toBeLessThan(360);
      }
    }
  });

  it("the group palette excludes blue and the own-bubble orange", () => {
    // Blue would read as "the other person" from the 1:1 rule; the own orange is
    // always you. Either would make the colour lie about who is speaking.
    const hues = GROUP_PALETTE.flatMap(c => [
      c.from.toLowerCase(),
      c.to.toLowerCase(),
    ]);
    expect(hues).not.toContain("#3b82f6");
    expect(hues).not.toContain("#1d4ed8");
    expect(hues).not.toContain("#fb923c");
    expect(hues).not.toContain("#c2410c");
  });

  it("every palette entry is complete and distinct", () => {
    const froms = new Set(GROUP_PALETTE.map(c => c.from.toLowerCase()));
    expect(froms.size, "no duplicate hues").toBe(GROUP_PALETTE.length);
    for (const c of GROUP_PALETTE) {
      for (const v of [c.from, c.to, c.text])
        expect(v).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it("the NAME colour agrees with the bubble for the same person", () => {
    // A name in one colour above a bubble in another is worse than no colour at
    // all, so both come from one module and one index.
    for (const id of [3, 17, 88, 1204]) {
      const idx = peerPaletteIndex(id);
      expect(nameColorFor({ isGroup: true, senderIdentityId: id })).toBe(
        GROUP_PALETTE[idx].text
      );
    }
    // 1:1 name colour is the blue, lightened for text on the page background.
    expect(nameColorFor({ isGroup: false, senderIdentityId: 5 })).toBe(
      "#93c5fd"
    );
  });
});

describe("the bubbles use the shared rule, not their own copy", () => {
  it("both bubble render paths go through bubbleStyleFor", () => {
    const calls = (
      MESSAGES.match(
        /bubbleStyleFor\(\{ mine, isGroup, senderIdentityId: m\.senderIdentityId \}\)/g
      ) ?? []
    ).length;
    expect(calls, "both paths").toBe(2);
  });

  it("Messages holds no second copy of the colours", () => {
    // A duplicated colour constant is how two surfaces come to promise different
    // things (the v2.99.55 lesson).
    const code = codeOnly(MESSAGES);
    expect(code).not.toMatch(/const OWN_BUBBLE_STYLE/);
    /* The property is that the colour LITERAL appears nowhere in this file, so the two
       surfaces cannot come to promise different things.
       REWRITTEN (v2.106.4): it also required `BRAND_GRADIENT` to be IMPORTED here and to
       occur exactly three times — which described one particular arrangement (the import
       plus the two send buttons) rather than the property. Both send buttons are now the
       accent `.rcta` per board 1d, so the import is legitimately gone and the file holds
       even fewer colour decisions than before. The literal ban is unchanged and the
       accent CTA is asserted, so a hardcoded fill coming back on either button fails. */
    expect(code).not.toMatch(/linear-gradient\(135deg,#fb923c/);
    expect(code).not.toMatch(/BRAND_GRADIENT/);
    expect(
      (code.match(/\brcta\b/g) ?? []).length,
      "both send buttons"
    ).toBeGreaterThanOrEqual(2);
  });

  it("the dead dark-text-on-grey branches are gone", () => {
    // Every bubble now sits on a colour with white text, so a `mine ? white :
    // muted` inner ternary would render muted grey on a blue bubble.
    const code = codeOnly(MESSAGES);
    expect(code).not.toMatch(
      /mine \? "text-white\/\d+" : "text-muted-foreground"/
    );
    expect(code).not.toMatch(/mine \? "bg-white\/\d+" : "bg-foreground/);
    expect(code).not.toMatch(/bg-muted\/70 text-foreground border-white\/10/);
  });

  it("the group sender label carries the person's own colour", () => {
    /* The DELIVERY is no longer `color:` (v2.107.27) — the palette hex is handed over as
       `--rname` so the `.rname` rule can darken it for the light theme, where these light
       tints measured 1.34–1.71:1. Matching the call rather than the property it is assigned
       to is strictly stronger: the property is that each label is coloured from this
       person's own entry, not which CSS property carries it. */
    const labels = (
      MESSAGES.match(
        /nameColorFor\(\{ isGroup, senderIdentityId: m\.senderIdentityId \}\)/g
      ) ?? []
    ).length;
    // THREE: both bubble paths AND the emoji-only path. The count is what caught the
    // miss — my first pass converted one of the two bubble labels and left the other
    // on `text-primary`, one colour for everybody, which is the thing being fixed.
    expect(labels, "every label site").toBe(3);
    expect(codeOnly(MESSAGES)).not.toMatch(
      /text-\[11px\] font-semibold text-primary/
    );
  });

  it("an emoji-only message in a group finally says WHO sent it", () => {
    // That branch renders no bubble and had no name either, so a bare emoji
    // arrived attached to nobody while every text message from the same person was
    // labelled — visible in the owner's own group screenshot.
    const emoji = MESSAGES.slice(MESSAGES.indexOf("if (emojiOnly) {"));
    const branch = emoji.slice(
      0,
      emoji.indexOf("return (\n                <div")
    );
    expect(branch.length).toBeGreaterThan(200);
    expect(branch).toMatch(/isGroup && !mine && !sameAsPrev/);
    expect(branch).toMatch(/nameById\.get\(m\.senderIdentityId\)/);
  });
});

describe("the typing line", () => {
  it("lives in its own component, so its tick cannot re-render the thread", () => {
    // A several-times-a-second state update inline in the conversation re-renders
    // the whole message list — the v2.99.67 mistake.
    expect(MESSAGES).toMatch(
      /<TypingLine typers=\{typers\} isGroup=\{isGroup\} labelFor=\{senderLabel\} \/>/
    );
    // The old inline block, with its hand-rolled "Several people are typing…", is
    // gone rather than left beside the new one.
    expect(codeOnly(MESSAGES)).not.toMatch(/Several people are typing/);
    expect(codeOnly(MESSAGES)).not.toMatch(/is typing…`/);
  });

  it("walks ONE capital along the name, and it repeats", () => {
    expect(TYPING).toMatch(
      /const hot = idxs\[\(step \+ offset\) % idxs\.length\]/
    );
    expect(TYPING).toMatch(/textTransform: "uppercase"/);
    expect(TYPING).toMatch(/textTransform: "lowercase"/);
  });

  it("only LETTERS take the capital", () => {
    // Walking onto a space or a hyphen reads as the animation stalling for a beat.
    expect(TYPING).toMatch(/IS_LETTER\.test\(c\)/);
    // Built with the constructor: a `/…/u` literal is a compile error at this
    // repo's target (TS1501), which is the trap this release hit.
    expect(TYPING).toMatch(/new RegExp\("\\\\p\{L\}", "u"\)/);
    expect(codeOnly(TYPING)).not.toMatch(/\/\\p\{L\}\/u/);
  });

  it("the timer is armed on a STABLE dependency", () => {
    // Depending on the array itself re-arms the interval every render — which is
    // every tick — so the walk would never advance smoothly, if at all.
    expect(TYPING).toMatch(/\}, \[idxs\.length\]\);/);
    // And a one-letter name has nothing to walk, so no timer is started at all.
    expect(TYPING).toMatch(/if \(idxs\.length < 2\) return;/);
  });

  it("gives each typer their own colour, from the shared module", () => {
    expect(TYPING).toMatch(/import \{ nameColorFor \} from ".\/peerColors"/);
    expect(TYPING).toMatch(
      /color=\{nameColorFor\(\{ isGroup, senderIdentityId: id \}\)\}/
    );
  });

  it("staggers two typers so they are not mid-step together", () => {
    expect(TYPING).toMatch(/offset=\{i \* 3\}/);
  });

  it("names the first two and counts the rest, rather than saying 'several'", () => {
    // Knowing WHO is typing is the value; a third name would wrap on a phone.
    expect(TYPING).toMatch(/const shown = typers\.slice\(0, 2\)/);
    expect(TYPING).toMatch(/and \{extra\} more/);
  });

  it("its dots respect reduced motion", () => {
    expect(TYPING).toMatch(/motion-safe:animate-bounce/);
    // An UNGATED use is one not preceded by the motion-safe: prefix. Matching
    // `[^-]animate-bounce` flagged the `:` in the gated form — i.e. it failed on the
    // code it was written to approve. My mistake, not the code's.
    expect(codeOnly(TYPING)).not.toMatch(/["' ]animate-bounce/);
  });

  it("renders nothing when nobody is typing", () => {
    expect(TYPING).toMatch(/if \(typers\.length === 0\) return null;/);
  });
});

describe("the message ⋮ reads as a button", () => {
  it("is fully opaque on every screen", () => {
    const code = codeOnly(MESSAGES);
    // It was 35% opacity on a phone and INVISIBLE until hover on desktop.
    expect(code).not.toMatch(/opacity-35/);
    expect(code).not.toMatch(/md:opacity-0 md:group-hover:opacity-100/);
  });

  it("has a real chip affordance — fill, border and shadow", () => {
    const btn = MESSAGES.slice(
      MESSAGES.indexOf('aria-label={t("msg.options")}')
    );
    const cls = btn.slice(0, btn.indexOf("MoreVertical"));
    expect(cls).toMatch(/border border-border/);
    expect(cls).toMatch(/bg-muted\/80/);
    expect(cls).toMatch(/text-foreground/);
    expect(cls).toMatch(/shadow-sm/);
    // A comfortable touch target rather than the old 28px.
    expect(cls).toMatch(/size-8/);
  });
});
