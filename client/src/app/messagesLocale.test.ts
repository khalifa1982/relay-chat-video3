/**
 * THE MESSAGES SCREEN SPEAKS ARABIC (#156) — the whole of it, not most of it.
 *
 * ── WHY THIS EXISTS AS A SWEEP AND NOT A LIST ────────────────────────────────────────
 * v2.106.85 shipped "the four in-app tabs speak Arabic" and left ~90 render sites in
 * this one file behind — including the `+` attachment menu the owner named in their own
 * words. Nothing failed, because the guard that release added asks whether particular
 * sentences reach the screen, and a sentence nobody listed is a sentence nobody misses.
 *
 * So the load-bearing assertions below are the other shape: they walk the component for
 * anything a person can READ and fail on whatever is not routed through the translator.
 * A string added later is covered rather than exempt — which is the difference between
 * "we converted 90 sites once" and a rule.
 *
 * ── AND WHY THE PLURALS ARE PINNED BEHAVIOURALLY ─────────────────────────────────────
 * Two counts on this screen straddle an Arabic band boundary. Which FORM a number
 * selects is exactly what a source pin cannot answer, so the selectors are driven.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { codeOnly } from "../../../server/testing/codeOnly";
import { copyOnScreen, whyCopyMissing } from "../../../server/testing/copyOnScreen";
import { MESSAGES } from "./dict/messages";
import { DICT, translate } from "./i18n";
import { createGroupCountKey, expireSecondsKey } from "../pages/app/Messages";

/* Resolved from THIS file, never from a hardcoded absolute path: a literal repo root
   passes on the machine it was written on and can never pass on a CI runner whose
   checkout lives somewhere else (the v2.106.60 finding, now a standing rule). */
const ROOT = resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

const RAW = read("client/src/pages/app/Messages.tsx");
const SRC = codeOnly(RAW);

const entries = Object.entries(MESSAGES) as [string, { en: string; ar: string }][];

/* ════════════════════════════════════════════════════════════════════════════════════
   1 — NOTHING A PERSON CAN READ IS STILL AN ENGLISH LITERAL
   ══════════════════════════════════════════════════════════════════════════════════ */

/** The attributes on this screen whose value is rendered or announced. */
const VISIBLE_ATTRS = ["aria-label", "placeholder", "title", "alt", "removeLabel", "displayName"];

/* Two predicates, because an attribute and a text node fail differently — a label can
   legitimately be one word (`aria-label="Muted"`), while the spans between `>` and `<`
   also catch fragments of ordinary code and so need two words to count. Same calibration
   as `groupsLocale.test.ts`, whose header records why a single loose rule cried wolf. */
const WORD = /[A-Za-z]{2,}/;

/**
 * Two words — and the reason there are TWO rules is a hole mutation found in the first
 * version of this file.
 *
 * Reverting `{t("msg.photoAndVideo")}` to the literal `Photo &amp; video` SURVIVED, in
 * the one menu the owner asked for by name. Two things had to be wrong for that:
 *
 *   1. the entity was never decoded, and
 *   2. even decoded, "Photo & video" has NO two alpha runs separated only by whitespace
 *      — the `&` sits between them — so an "alpha \s+ alpha" rule cannot see it.
 *
 * So entities are decoded first, and an INLINE span (`>…<` on one line) accepts a short
 * run of punctuation between the two words. A BLOCK span keeps the stricter whitespace
 * rule, because those are the ones that also catch wrapped ternaries — measured: the
 * loose rule finds 5 code fragments there and 0 here.
 */
const INLINE_SENTENCE = /[A-Za-z]{2,}[^A-Za-z\n]{1,4}[A-Za-z]{2,}/;
const BLOCK_SENTENCE = /[A-Za-z]{2,}\s+[A-Za-z]{2,}/;

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&(?:rsquo|apos|#39);/g, "'")
    .replace(/&(?:quot|ldquo|rdquo);/g, '"');
}

function englishAttributes(src: string): string[] {
  const out: string[] = [];
  for (const attr of VISIBLE_ATTRS) {
    for (const m of src.matchAll(new RegExp(`\\b${attr}="([^"]*)"`, "g"))) {
      if (WORD.test(m[1])) out.push(`${attr}="${m[1]}"`);
    }
  }
  return out;
}

function englishText(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/>([^<>{}\n]+)</g)) {
    if (INLINE_SENTENCE.test(decodeEntities(m[1]))) out.push(`inline: ${m[1].trim().slice(0, 60)}`);
  }
  for (const m of src.matchAll(/>\s*\n([^<>{}=;"`]*?)\n\s*</g)) {
    if (BLOCK_SENTENCE.test(decodeEntities(m[1])))
      out.push(`block: ${m[1].replace(/\s+/g, " ").trim().slice(0, 60)}`);
  }
  return out;
}

/** Copy raised as a toast — never on screen when you look at the component, so the
 *  easiest kind to leave behind. */
function englishToasts(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/toast\.\w+\(\s*("[^"]*"|`[^`]*`)/g)) {
    if (BLOCK_SENTENCE.test(decodeEntities(m[1]))) out.push(`toast(${m[1].slice(0, 60)})`);
  }
  return out;
}

/**
 * COPY THAT IS NOT THIS SWEEP'S TO CLAIM — named, never a threshold.
 *
 * `LockedGroupGate` (board 4i) landed in this file from the GROUPS work while this sweep
 * was being written, and it speaks the `groups.*` vocabulary: its lock heading, its
 * explainer and its escape belong beside `groups.lockTitle` and the rest, not to a
 * `msg.*` twin. Minting `msg.*` keys for them would put two vocabularies on one screen
 * — the exact thing this file's own header argues against for counts.
 *
 * So these two are DEBT rather than a pass: real, current, untranslated English on the
 * Messages screen, recorded so the next reader sees them instead of finding a sweep that
 * quietly covers less than it claims. The assertion below makes the list impossible to
 * leave behind — it fails if a string is fixed AND if one gains a dictionary entry.
 */
const BOARD_4I_DEBT = [
  "block: This group is locked",
  "block: Forgotten it? Type your app passcode on this keypad instead ",
];

const DICT_ENGLISH = Object.values(DICT)
  .map((e) => (e as { en: string }).en)
  .join("\n");

function isBoardFourIDebt(hit: string): boolean {
  return BOARD_4I_DEBT.includes(hit);
}

describe("every string on the Messages screen goes through the translator", () => {
  it("is reading the real component (guards against a vacuous pass)", () => {
    /* Every sweep below is a `not`-shaped assertion over `SRC`, and all of them pass
       trivially against an empty string. A mis-resolved path or a `codeOnly` that ate
       the file would therefore report the screen as fully translated. */
    expect(SRC.length).toBeGreaterThan(150_000);
    expect(SRC).toContain("function ConversationView");
    expect(SRC).toContain("function NewMessageDialog");
    expect(SRC).toContain("function MessageMenu");
    expect(SRC).toContain("function AutoReplyToggle");
  });

  it("no rendered attribute is a bare English literal", () => {
    expect(englishAttributes(SRC)).toEqual([]);
  });

  it("no JSX text node is a bare English literal", () => {
    expect(englishText(SRC).filter((s) => !isBoardFourIDebt(s))).toEqual([]);
  });

  it("the board-4i debt is REAL and cannot grow silently", () => {
    /* Both halves matter. If a listed string is gone the exemption must go with it, or
       the list rots into a comment (the v2.106.31 pattern) and the next untranslated
       string hides behind it. */
    const found = englishText(SRC).filter(isBoardFourIDebt);
    expect(found.length, "an exempted string is gone — drop it from BOARD_4I_DEBT").toBe(
      BOARD_4I_DEBT.length,
    );
    for (const s of BOARD_4I_DEBT) {
      // The list holds the sweep's OUTPUT (`block: …`); the dictionary holds the words.
      // Comparing the two without stripping the prefix would make this check vacuous —
      // it could never match, so it would report "still debt" forever.
      const words = s.replace(/^(?:block|inline): /, "").trim();
      expect(words.length, "an entry lost its text — the prefix rule changed").toBeGreaterThan(10);
      expect(
        DICT_ENGLISH.includes(words),
        `"${words}" is in the dictionary now — drop it from BOARD_4I_DEBT and wire it`,
      ).toBe(false);
    }
  });

  it("no toast is a bare English literal", () => {
    expect(englishToasts(SRC)).toEqual([]);
  });

  it("these sweeps really bite, string by string", () => {
    /* The one thing that would make all three of the above worthless is a sweep that
       matches nothing by construction. Each real pre-translation shape is checked ON ITS
       OWN rather than in one blob: a blob passes as soon as ANY line is caught, which is
       how the `&amp;` hole below survived the first version of this file — the fixture
       contained it and the assertion was satisfied by a different line entirely. */
    expect(englishAttributes('<b aria-label="New message" />')).toHaveLength(1);
    expect(englishAttributes('<b title="Choose a group photo" />')).toHaveLength(1);
    expect(englishText("<p>No messages yet.</p>")).toHaveLength(1);
    expect(englishText("<span>Start a group call</span>")).toHaveLength(1);
    // The entity case, named: `&amp;` breaks a naive alpha-space-alpha rule.
    expect(englishText('<span className="truncate">Photo &amp; video</span>')).toHaveLength(1);
    expect(englishToasts(`toast.error("Couldn't change auto-reply. Try again.");`)).toHaveLength(1);
  });

  it("every component that renders copy has a translator", () => {
    /* A component with no `useT()` cannot translate anything, so the sweeps above would
       have nothing to find in it — the failure would be silent. These are the ones that
       got one in this sweep. */
    for (const fn of [
      "function GroupCallsSection",
      "function Receipt",
      "function FileCard",
      "function MediaLightbox",
      "function SuggestList",
    ]) {
      const at = SRC.indexOf(fn);
      expect(at, `${fn} is gone — re-point this list`).toBeGreaterThan(0);
      expect(SRC.slice(at, at + 900), `${fn} renders copy with no translator`).toMatch(
        /useT\(\)/,
      );
    }
  });
});

/* ════════════════════════════════════════════════════════════════════════════════════
   2 — THE OWNER'S NAMED ASK: THE "+" ATTACHMENT MENU
   ══════════════════════════════════════════════════════════════════════════════════ */

describe("the + attachment menu is translated, rows and all", () => {
  const menu = SRC.slice(SRC.indexOf("{attachMenuOpen && ("), SRC.indexOf("{expire !== null && ("));

  it("the window is real", () => {
    expect(menu.length).toBeGreaterThan(500);
  });

  it("every row the owner asked for is on screen, through the dictionary", () => {
    /* Owner (v2.106.65): "on the attachment inside the chat on the plus button add the
       voice note beside of the other features set as video photos". The menu was built
       and shipped entirely in English; these four are what it offers. */
    for (const s of ["Record video", "Photo & video", "Attach file", "Voice note"]) {
      expect(copyOnScreen(menu, s), whyCopyMissing(menu, s)).toBe(true);
    }
  });

  it("the disabled hint says what to do instead, in both languages", () => {
    const e = DICT["msg.voiceNoteUnsupported"] as { en: string; ar: string };
    // It names the alternative rather than only reporting the refusal — a row that is
    // dim and silent reads as a missing feature.
    expect(e.en).toContain("Attach file");
    expect(e.ar).toContain("إرفاق ملف");
  });
});

/* ════════════════════════════════════════════════════════════════════════════════════
   3 — THE VOCABULARY DISTINCTIONS SURVIVE THE TRANSLATION
   ══════════════════════════════════════════════════════════════════════════════════ */

describe("the Arabic keeps apart what the English keeps apart", () => {
  const ar = (k: string) => (DICT[k as keyof typeof DICT] as { ar: string }).ar;

  it("the five destructive verbs stay five different words", () => {
    /* v2.102.2 and v2.104.0 wrote these so the difference is unmistakable: they destroy
       different amounts, for different people, with different reversibility. Collapsing
       two onto one Arabic verb would undo that work in the language, where nobody
       reviewing the English would notice. */
    const verbs = [
      ar("msg.hideAction"), // delete for me
      ar("msg.unsendAction"), // unsend, for everyone
      ar("msg.adminRemoveAction"), // an admin removes somebody else's
      ar("msg.delete"), // the swipe tray's chat-level delete
      ar("msg.archive"),
    ];
    expect(new Set(verbs).size).toBe(verbs.length);
  });

  it("a STORY and a STATUS are two different Arabic words", () => {
    // v2.101.0, corrected by the owner three times: a STORY is the ephemeral post, a
    // STATUS is the profile label. One Arabic word for both would undo that silently.
    expect(ar("msg.repliedToYourStory")).toContain("قصت");
    expect(ar("msg.repliedToTheirStory")).toContain("قصت");
  });

  it("the media viewer's claim is not upgraded in translation", () => {
    /* The English is deliberately NOT an end-to-end claim — `messages.body` is plain
       text the server searches with LIKE, so the app cannot make one. The Arabic must
       not quietly promise more than the English does. */
    const e = DICT["msg.encryptedInTransit"] as { en: string; ar: string };
    expect(e.en).toContain("in transit");
    expect(e.ar).toContain("أثناء النقل");
    expect(e.ar).not.toContain("طرف إلى طرف"); // end-to-end
  });

  it("replying to yourself is its own sentence, not a substituted pronoun", () => {
    /* «الرد على أنت» is ungrammatical and no substitution fixes it — the pronoun has to
       change form, which only a separate string can express. */
    expect(SRC).toMatch(/replyingTo\.senderIdentityId === me\.id[\s\S]{0,80}msg\.replyingToSelf/);
    expect(ar("msg.replyingToSelf")).toContain("نفسك");
    expect(ar("msg.replyingToSelf")).not.toContain("أنت");
  });
});

/* ════════════════════════════════════════════════════════════════════════════════════
   4 — THE PLURAL BANDS, DRIVEN
   ══════════════════════════════════════════════════════════════════════════════════ */

describe("counts pick the form the language needs", () => {
  it("the disappearing countdown has two Arabic forms, and both are reachable", () => {
    /* 3–10 take the plural of paucity («ثوانٍ») and 11+ the singular accusative
       («ثانية»). The composer can send 5, 10 and 30 — so both bands are live, and
       "30 ثوانٍ" would be wrong in a way every Arabic reader sees. */
    expect(expireSecondsKey(5, "banner")).toBe(expireSecondsKey(10, "banner"));
    expect(expireSecondsKey(5, "banner")).not.toBe(expireSecondsKey(30, "banner"));
    expect(expireSecondsKey(5, "toggle")).not.toBe(expireSecondsKey(30, "toggle"));
    // The banner and the toggle are different sentences and must not share a key.
    expect(expireSecondsKey(5, "banner")).not.toBe(expireSecondsKey(5, "toggle"));

    expect(translate("ar", expireSecondsKey(5, "banner"), { n: 5 })).toContain("ثوان");
    expect(translate("ar", expireSecondsKey(30, "banner"), { n: 30 })).toContain("ثانية");
  });

  it("the create-group CTA counts you, in both bands", () => {
    expect(createGroupCountKey(1)).not.toBe(createGroupCountKey(4));
    expect(createGroupCountKey(4)).toBe(createGroupCountKey(30));
    expect(translate("en", createGroupCountKey(4), { n: 4 })).toBe("Create group · 4 members");
  });

  it("the header's member and online counts reuse the group sheet's own keys", () => {
    /* One vocabulary per noun. Two keys for "members" is how the sheet and the header
       come to describe the same group differently — and the Arabic plural decision then
       has to be made twice. */
    expect(SRC).toMatch(/groups\.memberCountOne/);
    expect(SRC).toMatch(/groups\.memberCountMany/);
    expect(SRC).toMatch(/t\("groups\.onlineCount", \{ n: membersOnline \}\)/);
    // And no `msg.*` twin was minted for either.
    expect(Object.keys(MESSAGES)).not.toContain("msg.memberCount");
    expect(Object.keys(MESSAGES)).not.toContain("msg.onlineCount");
  });
});

/* ════════════════════════════════════════════════════════════════════════════════════
   5 — THE DICTIONARY'S OWN RULES, FOR THIS MODULE
   ══════════════════════════════════════════════════════════════════════════════════ */

describe("this module obeys the dictionary's rules", () => {
  it("every Arabic half is really Arabic, and differs from the English", () => {
    /* The cheap way to satisfy a both-halves check is to paste the English across. */
    for (const [k, e] of entries) {
      expect(e.ar, `${k}: Arabic half is the English`).not.toBe(e.en);
      expect(e.ar, `${k}: no Arabic script`).toMatch(/[؀-ۿ]/);
    }
  });

  it("numbers stay Western in Arabic prose", () => {
    /* Every count here is INTERPOLATED, so an Arabic-Indic numeral beside a substituted
       Western one would put two numeral systems on one line — which reads as a rendering
       fault rather than as localisation (v2.106.84). */
    for (const [k, e] of entries) {
      expect(e.ar, `${k} carries Arabic-Indic digits`).not.toMatch(/[٠-٩]/);
    }
  });

  it("a placeholder in the English half survives into the Arabic", () => {
    /* `translate` substitutes by NAME, so the two halves may order them differently —
       what they may not do is drop one, which would render a sentence with a hole. */
    for (const [k, e] of entries) {
      const want = [...e.en.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      const got = [...e.ar.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      expect(got, `${k}: placeholders differ`).toEqual(want);
    }
  });
});
