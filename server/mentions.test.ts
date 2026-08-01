/**
 * @mentions and the group header's online count — board 3c.
 *
 * The resolver is driven BEHAVIOURALLY, because every claim is about what a body
 * RESOLVES to against a roster: whether "email me @ 5pm" lights up, whether
 * `@Ali Hassan` is one mention or two, what the caret is on. A source pin can tell
 * you a matcher exists and cannot tell you it refuses a stray at-sign.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { codeOnly } from "./testing/codeOnly";
import { expandCopy } from "./testing/copyOnScreen";
import {
  findMentions,
  mentions,
  mentionQueryAt,
  rankMentionMatches,
  applyMention,
} from "@shared/mentions";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

/** Every `.tsx` under `client/src` whose SOURCE mentions the pattern, repo-relative. */
function clientFilesUsing(re: RegExp): string[] {
  const out: string[] = [];
  const walk = (rel: string) => {
    for (const e of readdirSync(resolve(process.cwd(), rel), { withFileTypes: true })) {
      const p = join(rel, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".tsx") && re.test(readFileSync(resolve(process.cwd(), p), "utf8")))
        out.push(p);
    }
  };
  walk("client/src");
  return out.sort();
}

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
    const at = UI.indexOf('aria-label={playing ? t("msg.pause") : t("msg.playVoiceNote")}');
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
    /* v2.106.66 — THE GUARD WAS SELF-ALLOWING, AND HALF-BLIND. Found by the design audit,
       verified here: `/\bonline\b/` matches inside the TOKEN NAME —
       `/\bonline\b/.test("var(--relay-online)")` is `true` — so every `--relay-online` hit
       allowed ITSELF and only `--relay-green-text` was ever constrained. And `UI` is
       `Messages.tsx` alone, so `Status.tsx` — which renders the stories strip on that very
       screen — was outside the sweep entirely. It duly held a `+` badge filled with the
       presence green, the seventh occurrence of a rule this file exists to enforce.

       Both halves are fixed: the allow-list is tested against the RENDERED TEXT with class
       and style attributes stripped, and the sweep reads every client source. */
    /* `typing` is allowed WITH OR WITHOUT the ellipsis. The pattern was `/typing…/`, and
       the thread ROW's literal is a bare `typing` followed by three animated dots — so the
       first run of the de-self-allowed guard flagged perfectly correct code. (The old
       assertion had passed off the header's and TypingLine's occurrences elsewhere in the
       file, which is the same accident one layer along.) Typing is DELIBERATELY allowed:
       it implies online — you cannot type from an offline client — it occupies the presence
       slot in the same row, and it is a STRONGER presence statement rather than a different
       kind of fact, so green is carrying its one meaning there. */
    /* AN ELEMENT SAYS IT IS ABOUT PRESENCE IN ONE OF TWO WAYS — in its WORDS, or in its
       CONDITION. `p.isOnline && !p.idle ? green : muted` is a presence statement with no
       prose in it at all, and a text-only allow-list flags it: the first run of this
       sweep flagged four such sites and every one of them was correct. */
    const PRESENCE = [/\btyping\b/, /\bonline\b/, /online now/, /\bisOnline\b/];

    /* THE TWO GREEN TOKENS DO NOT CARRY THE SAME LICENCE, which is why this is a pair of
       rules rather than one flat list. `--relay-online` is the LED hue and means ONLINE,
       full stop. `--relay-green-text` is the AA-measured sibling v2.99.86 added because
       the LED hue fails contrast as small text — and the app has a SECOND, deliberate
       meaning for it: a 6-digit RELAY NUMBER (the top bar since v2.99.86, a contact's
       number since v2.106.43). That is a recorded decision, so it is EXEMPTED BY NAME and
       narrowly: only the text token, only where a number is what renders. Painting a
       number with the LED hue stays a violation — it would both fail AA and put a
       presence hue on a fact that is not presence. */
    const NUMBER = /\.number\b|formatPin\(/;
    const LED = /relay-online/;
    const GREEN = /relay-online|relay-green-text/;

    /** The element with the TOKEN NAMES removed — i.e. what a person READS. */
    function renderedText(el: string): string {
      /* ONLY the token names. The first version also stripped `className={…}}` and its
         string cousins, which was redundant — removing `--relay-online` is what stops the
         allow-list matching itself — and actively harmful: the non-greedy multi-line form
         ate as far as the next `}}`, swallowing the `p.isOnline` that made a PeerOverlays
         element legitimate, so a correct site was flagged for a reason having nothing to
         do with the rule. */
      return el.replace(/--relay-[a-z-]+/g, " ");
    }

    /** True when a green use is about presence, or is the named number exemption. */
    function greenIsEarned(line: string, element: string): boolean {
      const el = renderedText(element);
      if (PRESENCE.some((re) => re.test(el))) return true;
      return !LED.test(line) && NUMBER.test(el);
    }

    /* THE LIST IS DERIVED, NOT HAND-KEPT, and that is the whole reason there was a seventh
       occurrence: the old sweep read `Messages.tsx` alone, so `Status.tsx` — which renders
       the stories strip on that very screen — was outside it and duly held a `+` badge
       filled with the presence green. A hand-written list is a list somebody forgets to
       add the next file to, and the omission is invisible: the sweep still passes, still
       reports a non-zero count, and simply never looks. So the files are DISCOVERED by
       walking the client tree for the tokens, and the enumeration below only records what
       must be there — a file that stops offending drops out on its own, and one that
       starts is picked up without anybody remembering. */
    const FILES = clientFilesUsing(GREEN);
    /* The three files that legitimately draw presence must be IN it — a derived list that
       quietly discovered nothing would pass while proving nothing. `Status.tsx` is
       deliberately NOT among them: this release took the last green out of it, so
       requiring it here would be requiring a violation to exist. It gets the opposite
       assertion instead, below. */
    for (const must of [
      "client/src/pages/app/Messages.tsx",
      "client/src/pages/app/Contacts.tsx",
      "client/src/app/PeerOverlays.tsx",
    ]) {
      expect(FILES, `${must} must be in the sweep`).toContain(must);
    }
    /* THE SEVENTH OCCURRENCE, pinned shut. The stories strip's `+` badge was filled with
       the presence green — on the very screen this guard was written for, in a file the
       old sweep did not read. It is the accent now, so the file holds no green at all. */
    expect(FILES).not.toContain("client/src/pages/app/Status.tsx");

    /* ═══ THE DEBT LIST, and it is a bigger finding than the release that produced it ═══
       Deriving the file list turned a guard that read ONE file into one that reads the
       client tree, and what it found is that the presence green has been serving as a
       general-purpose accent app-wide: 35 uses across 14 files — CTA fills, links, a
       spinner, toggle states, the History PIN, a "Party line" chip. Reported honestly
       rather than overclaimed: this release fixed the two that COLLIDE inside a screen
       that also draws presence (the stories strip's badge, and GroupInfoSheet's "Saved"
       beside member LEDs), and the rest each need the same per-site judgement those two
       got — is this a CTA (`.rcta`), a link (`text-primary`), a state, or genuinely
       presence — which is a design pass, not a find-and-replace.

       So it is ENUMERATED, exactly as v2.106.31 enumerated the raw-accent-as-text debt.
       The list may SHRINK freely and may never GROW: a file not on it must be clean, so
       a NEW misuse anywhere else is red immediately. And every entry must still really
       offend — an exemption left behind after a fix is how a guard rots into a comment. */
    const DEBT = new Set([
      "client/src/app/InviteCard.tsx",
      "client/src/app/LiveStats.tsx",
      "client/src/app/MissedCalls.tsx",
      "client/src/app/OnboardingGate.tsx",
      "client/src/app/RelayEngine.tsx",
      "client/src/app/TopBar.tsx",
      "client/src/lib/linkify.tsx",
      "client/src/pages/app/Admin.tsx",
      /* Dialer.tsx CAME OFF THIS LIST in v2.106.78, and the guard is what told me
         to remove it — this is the staleness loop working exactly as designed.
         Its only UNEARNED green was the idle ghost of the viewer's own number,
         which that release deleted (the owner circled that slot and asked for it
         gone); the file's remaining green use is EARNED, because its element
         window carries `st.online`. Left on the list it would have been a
         permanent exemption nobody notices. */
      "client/src/pages/app/History.tsx",
      "client/src/pages/app/Join.tsx",
      "client/src/pages/app/Profile.tsx",
      "client/src/pages/app/ProfileHubSections.tsx",
    ]);
    /** A file not on the debt list must be clean. Named, so the branch below cannot be
     *  replaced by a constant that swallows every file — the mutation that found this. */
    const mustBeClean = (f: string) => !DEBT.has(f);
    expect(mustBeClean("client/src/app/PasscodeGate.tsx")).toBe(true); // clean ⇒ enforced
    expect(mustBeClean("client/src/pages/app/Profile.tsx")).toBe(false); // on the list
    const stillOffends = new Set<string>();
    let swept = 0;
    for (const f of FILES) {
      /* COMMENT-STRIPPED, and that is not tidiness — this file's own prose EXPLAINS the
         rule, so it necessarily names the token it forbids. The first run of the widened
         sweep flagged a comment recording why the voice-note waveform moved OFF the
         presence green: text ABOUT the misuse satisfying a search FOR it. That is the
         prose trap this repo has now hit sixteen times, here inside the guard written to
         catch the very thing the comment describes. */
      /* AND `expandCopy`'d (#156): the evidence that a green is EARNED is usually the
         WORD beside it ("3 online"), and the Arabic sweep moved those words into the
         dictionary — so the element the rule inspects went from saying "online" to
         saying `t("groups.onlineCount")`. Without this, a correctly-earned green reads
         as a violation, which is a guard crying wolf on correct code. `expandCopy`
         rewrites each key to its English half before the rule looks, exactly as
         `systemAlerts` does for its own copy rules (v2.106.85). */
      const src = expandCopy(codeOnly(read(f)));
      const all = src.split("\n");
      const hits = all.map((l, i) => ({ l, i })).filter(({ l }) => GREEN.test(l));
      for (const { l, i } of hits) {
        swept++;
        /* THE WINDOW IS THE ELEMENT, NOT THE LINE: a per-line sweep asks whether the class
           and the word sit on one source line, which for multi-line JSX they do not — the
           group header's correct `{membersOnline} online` lives a line below its own
           class, and the first run of the widened guard failed on it.

           IT LOOKS BOTH WAYS, and that is measured rather than symmetry for its own sake.
           A dot's evidence can be its parent's ATTRIBUTE, which precedes it: the Contacts
           ONLINE section deliberately renders a bare count (v2.99.97 — its own heading
           already says "Online", so the word would read "Online … 3 online") and carries
           the meaning in the wrapper's `title` one line above the LED. Forward-only, the
           widened guard flagged that correct element. The forward reach is 5 because the
           contact row's number renders four lines below its own class (`dir="ltr"` and
           the opening bracket sit between them). */
        const element = all.slice(Math.max(0, i - 2), i + 5).join(" ");
        if (greenIsEarned(l, element)) continue;
        if (!mustBeClean(f)) {
          stillOffends.add(f);
          continue;
        }
        expect(
          false,
          `presence green used for something that is not presence:\n  ${f}\n  ${l.trim()}\n` +
            `  (fix it, or add the file to DEBT with a reason — never silently)`,
        ).toBe(true);
      }
    }
    expect(swept, "the sweep must not be vacuous").toBeGreaterThan(0);

    /* NO ENTRY MAY GO STALE. A file left on the list after its last misuse is fixed is an
       exemption nobody is watching, and the next real misuse there would be invisible —
       which is exactly how this rule reached a seventh and eighth occurrence. */
    for (const f of DEBT) {
      expect(stillOffends.has(f), `${f} is CLEAN now — take it off DEBT`).toBe(true);
    }

    /* IT STILL BITES — proven on constructed elements rather than assumed, because a
       sweep that has been widened four times to stop flagging correct code is exactly
       the kind that ends up flagging nothing at all. */
    const led = 'className="bg-[color:var(--relay-online)]"';
    const txt = 'className="text-[color:var(--relay-green-text)]"';
    expect(greenIsEarned(led, `${led} Pinned`)).toBe(false); // the 7th occurrence
    expect(greenIsEarned(txt, `${txt} Unread`)).toBe(false);
    expect(greenIsEarned(led, `${led} {c.number}`)).toBe(false); // LED may NOT be a number
    expect(greenIsEarned(txt, `${txt} {c.number}`)).toBe(true); // the named exemption
    expect(greenIsEarned(led, `p.isOnline ? ${led} : muted`)).toBe(true);
    expect(greenIsEarned(led, `${led} 3 online`)).toBe(true);

    /* The comment strip is doing REAL work rather than hiding a defect: the raw file
       genuinely carries prose naming the token, and the stripped form genuinely does
       not. Without this pair, `codeOnly` silently becoming a no-op — or the comment
       being deleted — would leave the sweep looking guarded while proving less. */
    const rawMessages = read("client/src/pages/app/Messages.tsx");
    expect(rawMessages).toMatch(/painted with `--relay-online`/);
    expect(codeOnly(rawMessages)).not.toMatch(/painted with `--relay-online`/);

    // …and the strip really is stripping: with the token name left in, the old guard's
    // allow-list matched itself, which is why it caught nothing.
    expect(/\bonline\b/.test("var(--relay-online)")).toBe(true);
    expect(/\bonline\b/.test(renderedText("bg-[color:var(--relay-online)]"))).toBe(
      false,
    );
  });

  it("the recording DOT stays red, because red-means-recording does not collide", () => {
    // The only destructive control in the bar is the discard button, which is a
    // filled chip rather than a hairline — so the two cannot be mistaken.
    const at = UI.indexOf("const BARS = 30;");
    expect(UI.slice(at, UI.indexOf("\nfunction ", at))).toMatch(/bg-destructive motion-safe:animate-pulse/);
  });
});
