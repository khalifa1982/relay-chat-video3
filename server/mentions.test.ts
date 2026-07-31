/**
 * @mentions and the group header's online count — board 3c.
 *
 * The resolver is driven BEHAVIOURALLY, because every claim is about what a body
 * RESOLVES to against a roster: whether "email me @ 5pm" lights up, whether
 * `@Ali Hassan` is one mention or two, what the caret is on. A source pin can tell
 * you a matcher exists and cannot tell you it refuses a stray at-sign.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { codeOnly } from "./testing/codeOnly";
import {
  findMentions,
  mentions,
  mentionQueryAt,
  rankMentionMatches,
  applyMention,
} from "@shared/mentions";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

const ROSTER = [
  { id: 1, name: "Ali" },
  { id: 2, name: "Ali Hassan" },
  { id: 3, name: "Dana" },
  { id: 4, name: "Khalifa" },
];

describe("findMentions — a mention must RESOLVE, not just follow an at-sign", () => {
  it("finds a roster name", () => {
    const m = findMentions("hey @Dana can you look", ROSTER);
    expect(m).toHaveLength(1);
    expect(m[0].id).toBe(3);
    expect(m[0].text).toBe("@Dana");
  });

  it("does NOT highlight an at-sign that names nobody", () => {
    // "email me @ 5pm" and "@here" are not mentions of anybody. Highlighting them
    // would make the accent mean "somebody was addressed" when nobody was.
    expect(findMentions("email me @ 5pm", ROSTER)).toEqual([]);
    expect(findMentions("@here @everyone @channel", ROSTER)).toEqual([]);
    expect(findMentions("@Sam is not in this group", ROSTER)).toEqual([]);
  });

  it("prefers the LONGEST name, so a surname is not left stranded", () => {
    // With both "Ali" and "Ali Hassan" in the roster, `@Ali Hassan` is ONE mention
    // of the second person — not a mention of the first plus a loose word.
    const m = findMentions("ping @Ali Hassan about it", ROSTER);
    expect(m).toHaveLength(1);
    expect(m[0].id).toBe(2);
    expect(m[0].text).toBe("@Ali Hassan");
  });

  it("still matches the short name when the long one does not follow", () => {
    const m = findMentions("ping @Ali about it", ROSTER);
    expect(m).toHaveLength(1);
    expect(m[0].id).toBe(1);
  });

  it("does not read an email address's domain as a mention", () => {
    expect(findMentions("write to ali@dana.com", ROSTER)).toEqual([]);
  });

  it("is case-insensitive — a person should not have to match capitalisation", () => {
    expect(findMentions("@dana", ROSTER)[0]?.id).toBe(3);
    expect(findMentions("@DANA", ROSTER)[0]?.id).toBe(3);
  });

  it("finds several, in order, without overlapping", () => {
    const m = findMentions("@Dana and @Khalifa both", ROSTER);
    expect(m.map((x) => x.id)).toEqual([3, 4]);
    expect(m[0].end).toBeLessThanOrEqual(m[1].start);
  });

  it("is empty for an empty roster — which is what makes a DM byte-identical", () => {
    expect(findMentions("@Dana", [])).toEqual([]);
  });

  it("survives a null body", () => {
    expect(findMentions(null, ROSTER)).toEqual([]);
    expect(findMentions(undefined, ROSTER)).toEqual([]);
  });

  it("`mentions` answers for one identity", () => {
    expect(mentions("hi @Dana", ROSTER, 3)).toBe(true);
    expect(mentions("hi @Dana", ROSTER, 4)).toBe(false);
  });
});

describe("mentionQueryAt — what the caret is actually on", () => {
  it("reports the token being typed", () => {
    expect(mentionQueryAt("hey @da", 7)).toEqual({ query: "da", start: 4 });
  });

  it("reports an empty query right after the at-sign, so the picker opens", () => {
    expect(mentionQueryAt("hey @", 5)).toEqual({ query: "", start: 4 });
  });

  it("is anchored at the CARET, not at the last @ in the whole draft", () => {
    // Scanning the draft would re-open a completed mention earlier in the line every
    // time the user typed a character after it.
    expect(mentionQueryAt("@Dana said hi", 5)).toEqual({ query: "Dana", start: 0 });
    // Caret at the end, four words past the mention: too long to be a token.
    expect(mentionQueryAt("@Dana said hi to everybody", 26)).toBeNull();
  });

  it("stops at a newline — an @ two lines up is not what the caret is on", () => {
    expect(mentionQueryAt("@Dana\nhello", 11)).toBeNull();
  });

  it("does not fire inside an email address", () => {
    expect(mentionQueryAt("ali@dana", 8)).toBeNull();
  });

  it("is null with no at-sign at all", () => {
    expect(mentionQueryAt("hello there", 11)).toBeNull();
  });
});

describe("rankMentionMatches — prefix beats interior", () => {
  it("puts a name that STARTS with the query first", () => {
    // Typing "sa" means somebody whose name starts with it far more often than
    // somebody with it in the middle.
    //
    // THE CASE IS CHOSEN SO ALPHABETICAL ORDER AND RANK DISAGREE. My first version
    // used "al" against Ali/Salim, where the alphabetical tiebreak gives the same
    // answer as the rank — so gutting the rank left it green, and the mutation run
    // said so. Here "Hassan" sorts BEFORE "Sam", so only the rank can put Sam first.
    const r = rankMentionMatches("sa", [
      { id: 8, name: "Hassan" },
      { id: 9, name: "Sam" },
    ]);
    expect(r[0].name).toBe("Sam");
  });

  it("matches a surname, because people search by it", () => {
    expect(rankMentionMatches("hassan", ROSTER).map((m) => m.id)).toContain(2);
  });

  it("returns the roster when nothing is typed yet", () => {
    expect(rankMentionMatches("", ROSTER).length).toBe(ROSTER.length);
  });

  it("is bounded on the SCORED path, not just the empty-query one", () => {
    // My first version passed "" and so took the early return, never reaching the
    // scored path it meant to bound — removing that slice left it green, and the
    // mutation run said so. A real query goes through the scoring.
    const many = Array.from({ length: 50 }, (_, i) => ({ id: i, name: `Person${i}` }));
    expect(rankMentionMatches("person", many).length).toBeLessThanOrEqual(6);
    expect(rankMentionMatches("", many).length).toBeLessThanOrEqual(6);
  });
});

describe("applyMention — completing the token", () => {
  it("replaces the token and leaves the caret after a trailing space", () => {
    const r = applyMention("hey @da", 7, { id: 3, name: "Dana" });
    expect(r?.text).toBe("hey @Dana ");
    expect(r?.caret).toBe(10);
  });

  it("keeps the rest of the line intact, with NO double space", () => {
    // The first draft always appended a space, so completing mid-sentence produced
    // "hey @Dana  can" — small, visible, and entirely the tool's fault. Written as a
    // test first, which is how it was caught.
    const r = applyMention("hey @da can you look", 7, { id: 3, name: "Dana" });
    expect(r?.text).toBe("hey @Dana can you look");
    // Past the existing space, so the next keystroke starts a new word rather than
    // extending the name.
    expect(r?.caret).toBe(10);
  });

  it("does nothing when the caret is not on a token", () => {
    expect(applyMention("hello", 5, { id: 3, name: "Dana" })).toBeNull();
  });
});

describe("the renderer", () => {
  const L = codeOnly(read("client/src/lib/linkify.tsx"));

  it("highlights only via the shared resolver", () => {
    expect(L).toMatch(/findMentions\(text, members\)/);
  });

  it("members are OPTIONAL, so every pre-3c caller is unchanged", () => {
    // A DM has one other person in it: there is nobody a mention could disambiguate.
    expect(L).toMatch(/members\?: readonly MentionCandidate\[\]/);
    expect(L).toMatch(/members && members\.length \? withMentions/);
  });

  it("mentions resolve INSIDE the non-URL runs only", () => {
    // Otherwise a name inside a link's path becomes a mention span inside an anchor.
    const at = L.indexOf("withMentions(part");
    expect(at).toBeGreaterThan(0);
    // The URL branch returns before this point.
    expect(at).toBeGreaterThan(L.indexOf("i % 2 === 1"));
  });

  it("EVERY message's mention is the accent, mine included", () => {
    /* REWRITTEN v2.106.62. This froze `style={mine ? undefined : …}` — the branch, not the
       rule — and the reason it gave ("the outgoing bubble is orange, and a bright accent span
       on it is the one combination that does not read") was true of the SOLID `#fb923c` the
       app used to fill an own bubble with. The board fills it `rgba(245,140,60,.17)` and puts
       its own `@Marcus` in `var(--rb)` on exactly that. Re-measured across all 12 accent
       hues, worst case: 1.06:1 on the old solid fill, 5.44:1 mobile / 4.82:1 desktop on the
       board's. So the branch is gone and the parameter with it.

       THE PROPERTY: one accent for every mention, and no per-message exception — a `mine`
       conditional reaching this colour again is the regression, so it is forbidden by name
       rather than merely absent. */
    expect(L).toMatch(/style=\{\{ color: "var\(--rb, #3FE0C5\)" \}\}/);
    expect(L, "no per-message exception to the accent").not.toMatch(/mine/);
    // A literal fallback, never a self-reference: `var(--rb, var(--rb))` is a
    // custom-property CYCLE and the browser drops the declaration (v2.106.7).
    expect(L).not.toMatch(/var\(--rb[a-z-]*,\s*var\(--rb/);
  });
});

describe("the group header's online count", () => {
  const UI = codeOnly(read("client/src/pages/app/Messages.tsx"));

  it("reads presence through the ONE shared reader", () => {
    // Re-deriving would be how a header comes to disagree with the LEDs on the very
    // same people — the divergence v2.99.95 was about. That funnel already applies
    // the guest-privacy suppression and the idle distinction.
    expect(UI).toMatch(/trpc\.directory\.presenceMany\.useQuery/);
  });

  it("excludes ME from the count", () => {
    // You are reading the screen: counting yourself makes an empty group read as
    // "1 online".
    const at = UI.indexOf("const memberNumbers = useMemo");
    expect(at).toBeGreaterThan(0);
    expect(UI.slice(at, UI.indexOf("const memberPresence", at))).toMatch(/!mem\.isMe/);
  });

  it("renders NOTHING rather than a zero while the query is in flight", () => {
    // "0 online" is a claim about a group, and a wrong one before an answer lands.
    expect(UI).toMatch(/if \(!rows\) return undefined;/);
    expect(UI).toMatch(/membersOnline != null && membersOnline > 0/);
  });

  it("uses the AA-measured green text token, not the LED hue", () => {
    // The LED green fails contrast at this size (measured in v2.99.86).
    const at = UI.indexOf("membersOnline} online");
    expect(at).toBeGreaterThan(0);
    expect(UI.slice(Math.max(0, at - 300), at)).toMatch(/--relay-green-text/);
  });
});

describe("the composer autocomplete", () => {
  const UI = codeOnly(read("client/src/pages/app/Messages.tsx"));

  it("offers only group members, and the DM branch is EMPTY", () => {
    // Pinning that an `isGroup ?` ternary exists says nothing about its else branch:
    // a mutation that filled the DM side with the peer kept the ternary and stayed
    // green, while `@777777` would start highlighting in a 1:1 and the
    // "byte-identical for a DM" claim in the code would stop being true.
    const at = UI.indexOf("const mentionRoster = useMemo");
    expect(at).toBeGreaterThan(0);
    const block = UI.slice(at, UI.indexOf("[isGroup, infoQuery.data]", at));
    expect(block).toMatch(/isGroup\s*\?/);
    expect(block).toMatch(/:\s*\[\],/);
  });

  it("the picker is IN FLOW, not absolutely positioned", () => {
    // A floating list over a composer that sits above the tab bar and the on-screen
    // keyboard needs measuring and clamping, and gets it wrong on exactly the phone
    // it matters on — the class that clipped the ⋮ menu (v2.99.0).
    const at = UI.indexOf("mentionMatches.length > 0 && (");
    expect(at).toBeGreaterThan(0);
    expect(UI.slice(at, at + 500)).not.toMatch(/\babsolute\b/);
  });

  it("commits on mouseDOWN, because click fires after blur", () => {
    // Blur closes the picker, so an onClick row would unmount from under the tap.
    const at = UI.indexOf("mentionMatches.length > 0 && (");
    const block = UI.slice(at, at + 800);
    expect(block).toMatch(/onMouseDown=/);
    expect(block).not.toMatch(/onClick=/);
  });

  it("Enter completes the top match rather than sending a fragment", () => {
    // Typing "@da" and pressing Enter must not send "@da" to a group.
    expect(UI).toMatch(/if \(mentionMatches\.length\) \{\s*e\.preventDefault\(\);\s*pickMention\(mentionMatches\[0\]\);/);
  });

  it("Escape closes the picker without clearing the draft", () => {
    expect(UI).toMatch(/e\.key === "Escape"/);
  });

  it("restores the caret after the state write", () => {
    // React re-renders a controlled input with the caret at the END, so inserting
    // mid-sentence would jump the cursor past everything already written.
    const at = UI.indexOf("function pickMention");
    expect(at).toBeGreaterThan(0);
    const body = UI.slice(at, UI.indexOf("\n  }", at));
    expect(body).toMatch(/requestAnimationFrame/);
    expect(body).toMatch(/setSelectionRange\(applied\.caret, applied\.caret\)/);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
   Board 4d / 2f — and the standing guard the repeated violation earned.
   ──────────────────────────────────────────────────────────────────────────── */

describe("green means ONLINE, and only online", () => {
  const UI = codeOnly(read("client/src/pages/app/Messages.tsx"));

  it("the recording waveform is the ACCENT, not the presence green", () => {
    // A green waveform is a fourth meaning for the one colour that has to carry
    // exactly one — the same fix v2.99.86 made for DND, v2.106.9 for the speaking
    // tile and v2.106.11 for the push banner. Recording is ACTIVE, which is what
    // the accent means after v2.106.6.
    const at = UI.indexOf("const BARS = 30;");
    expect(at).toBeGreaterThan(0);
    const bar = UI.slice(at, UI.indexOf("\nfunction ", at));
    expect(bar).toMatch(/var\(--rb, #3FE0C5\)/);
    expect(bar).not.toMatch(/relay-online/);
  });

  it("the voice-note play button is not the presence green (board 2f)", () => {
    const at = UI.indexOf('aria-label={playing ? "Pause" : "Play voice note"}');
    expect(at).toBeGreaterThan(0);
    const btn = UI.slice(at, at + 900);
    /* REWRITTEN TWICE, and the second rewrite is the more interesting one.
       v2.106.31 replaced a frozen inline `rgba(var(--rb-rgb),0.16)` fill with `.rchip-accent`
       — right for a control on a CARD, and wrong here: this button sits on a SATURATED
       BUBBLE, where that card recipe measures 1.16:1 at worst and fails AA on 30 of the 36
       bubble surfaces the app can draw. So requiring the class froze a defect, exactly as
       the inline fill had.
       THE PROPERTY THIS FILE STANDS FOR is the vocabulary one and nothing more: green means
       ONLINE, so a play control must not be painted in it. Which treatment is legible on a
       bubble is a MEASURED question and is pinned in `conversationFrame.test.ts`, against
       the real `bubbleGlyphColor`. */
    expect(btn).not.toMatch(/relay-online/);
    expect(btn, "the presence green's own hex must not arrive by literal either").not.toMatch(
      /#22c55e/i,
    );
  });

  it("every REMAINING use of the presence green is about presence", () => {
    /* THE STANDING GUARD. This exact violation has now been found SIX times in
       as many releases, always by measuring rather than by reading — so it gets a
       sweep rather than another one-off fix.
       `typing…` is DELIBERATELY allowed: typing implies online (you cannot type
       from an offline client), it occupies the presence slot in the same header,
       and it is a STRONGER presence statement rather than a different kind of
       fact. So green is carrying its one meaning there.

       WIDENED (v2.106.42) TO BOTH GREEN TOKENS, and that gap is why there was a
       sixth: this swept `--relay-online` only, and the PIN MARKER on a thread row
       was painted with `--relay-green-text` — the AA-measured sibling v2.99.86
       added for small text. Two spellings of one meaning, one of them unguarded,
       so the guard read as covering the rule while covering half of it. A pinned
       thread is not an online thread; the marker is muted now, deliberately not
       the accent, because the accent means UNREAD in that same row. */
    const ALLOWED = [/typing…/, /\bonline\b/, /online now/];
    const GREEN = /relay-online|relay-green-text/;
    /* THE WINDOW IS THE ELEMENT, NOT THE LINE, and widening the token set is what exposed
       that: a per-LINE sweep asked whether the className and the word sit on the same
       source line, which for multi-line JSX they do not — the group header's perfectly
       correct `{membersOnline} online` lives one line below its own class, and the first
       run of the widened guard failed on it. A line is not the unit this rule is about. */
    const all = UI.split("\n");
    const hits = all
      .map((l, i) => ({ l, i }))
      .filter(({ l }) => GREEN.test(l));
    expect(hits.length, "the sweep must not be vacuous").toBeGreaterThan(0);
    for (const { l, i } of hits) {
      const el = all.slice(i, i + 3).join(" ");
      expect(
        ALLOWED.some((re) => re.test(el)),
        `presence green used for something that is not presence:\n  ${l.trim()}`
      ).toBe(true);
    }
  });

  it("the recording DOT stays red, because red-means-recording does not collide", () => {
    // The only destructive control in the bar is the discard button, which is a
    // filled chip rather than a hairline — so the two cannot be mistaken.
    const at = UI.indexOf("const BARS = 30;");
    expect(UI.slice(at, UI.indexOf("\nfunction ", at))).toMatch(/bg-destructive motion-safe:animate-pulse/);
  });
});
