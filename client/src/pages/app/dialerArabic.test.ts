/* ============================================================
   THE DIALER SPEAKS ARABIC — the app's DEFAULT tab (#156).

   The owner has asked three times for the whole app to be mapped to Arabic. The
   Dialer still had English on its critical path, and the two worst cases were not
   the obscure ones:

     - "Add to contacts", the VISIBLE label under the quick-add button, shipped as a
       bare literal while `dialer.addToContacts` — Arabic half and all — sat one line
       above it on the very same element, used for the `title` a phone never shows.

     - The idle MARQUEE, the largest text on the screen when nothing is typed, had no
       i18n at all: seven strings hardcoded in `dialerMarquee.ts`, a module that
       imported nothing from the dictionary.

   WHAT THIS FILE PINS, AND WHY IT IS NOT A COUNT OF `t(` CALLS. A count says
   nothing about whether the strings a person actually reads were converted — it
   stays green with one label translated and forty left behind. So each assertion
   below is either a sentence somebody sees, or a rule about how a plural is chosen.
   ============================================================ */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { codeOnly } from "../../../../server/testing/codeOnly";
import { DICT, translate, type Locale, type TKey } from "@/app/i18n";
import {
  ROUND_PROMPT_KEY,
  HINT_LINE_KEYS,
  buildRotations,
  frameAt,
  type MarqueeContactRow,
} from "@/app/dialerMarquee";
import { moreDigitsKey } from "./Dialer";

const ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const DIALER = read("client/src/pages/app/Dialer.tsx");
const ENGINE = read("client/src/app/dialerMarquee.ts");
const PAINTER = read("client/src/app/DialerMarquee.tsx");

const LOCALES: Locale[] = ["en", "ar"];

describe("#156 — the visible strings on the default tab go through the dictionary", () => {
  it("the add-to-contacts LABEL is translated, not just its title attribute", () => {
    /* THE ONE-LINE DEFECT THIS RELEASE EXISTS FOR. v2.106.79 added the visible
       words because the icon "carried its meaning only in `title`, which a phone
       never shows" — and added them in English, with the translation already in
       hand on the line above. */
    const code = codeOnly(DIALER);
    expect(code, "the bare literal is gone from the JSX").not.toMatch(/>\s*Add to contacts\s*</);
    // Both the title AND the label reach the same key, so they cannot drift apart.
    expect((code.match(/t\("dialer\.addToContacts"\)/g) ?? []).length).toBe(2);
    expect(translate("ar", "dialer.addToContacts")).toBe("أضف إلى جهات الاتصال");
  });

  it("the sentences a person reads on this tab are no longer hardcoded", () => {
    /* Comment-stripped, because several of these literals legitimately survive in
       the prose that records why they moved — text ABOUT a pattern satisfying a
       search FOR it is the trap this repo has hit twenty times. */
    const code = codeOnly(DIALER);
    for (const lit of [
      "Enter a 6-digit RELAY number",
      "That number isn't on RELAY",
      "Group call — ring up to 10 people into one room",
      "Couldn't save the contact.",
    ]) {
      expect(code, `Dialer.tsx still hardcodes "${lit}"`).not.toContain(`"${lit}"`);
    }
    // …and the template-literal shapes, which a quoted-string sweep cannot see.
    expect(code, "the digit countdown is no longer assembled").not.toMatch(/more digits`/);
    expect(code, "the profile aria-label is no longer assembled").not.toMatch(
      /`View \$\{[^}]+\}'s profile`/,
    );
    expect(code, "the add aria-label is no longer assembled").not.toMatch(
      /`Add \$\{number\} to your contacts`/,
    );
  });

  it("the profile aria-label REUSES the peer key rather than minting a Dialer copy", () => {
    /* It opens the very same popup the avatar ring does. A second key would
       guarantee the two labels agree only until somebody edited one — the reasoning
       `dict/peer.ts` already records for reusing `contacts.tag.*`. */
    expect(codeOnly(DIALER)).toMatch(/t\("peer\.viewNamedProfile", \{\s*name:/);
  });
});

describe("#156 — 'N more digits' selects a WHOLE key per plural band", () => {
  /* `${n} more digit${n === 1 ? "" : "s"}` is a sentence assembled from a fragment
     and cannot be translated at all: English needs one/other, Arabic needs four
     forms. This is the single most-seen sentence on the Dialer — it renders on
     every keystroke between the first digit and the sixth. */

  it("picks one / dual / paucity / accusative by count", () => {
    expect(moreDigitsKey(1)).toBe("dialer.moreDigitsOne");
    expect(moreDigitsKey(2)).toBe("dialer.moreDigitsTwo");
    for (const n of [3, 4, 5, 9, 10]) expect(moreDigitsKey(n), `${n}`).toBe("dialer.moreDigitsFew");
    for (const n of [11, 20, 99]) expect(moreDigitsKey(n), `${n}`).toBe("dialer.moreDigitsMany");
    // Each band is a DIFFERENT key — a selector that collapsed two would be the
    // fragment-assembly bug wearing a function's clothes.
    expect(new Set([1, 2, 3, 11].map(moreDigitsKey)).size).toBe(4);
  });

  it("the Arabic really is the four forms, not one form four times", () => {
    /* Getting this wrong is visible to every Arabic reader: 1 is singular, 2 is the
       DUAL, 3–10 take the plural of paucity and 11+ the singular accusative. */
    expect(translate("ar", moreDigitsKey(1), { count: 1 })).toContain("واحد");
    expect(translate("ar", moreDigitsKey(2), { count: 2 })).toContain("رقمان");
    for (const n of [3, 5, 10]) {
      expect(translate("ar", moreDigitsKey(n), { count: n }), `${n}`).toContain("أرقام");
    }
    expect(translate("ar", moreDigitsKey(11), { count: 11 })).toContain("رقمًا");
    // The dual and the singular never carry a bare numeral — Arabic says "two
    // digits" with the noun's own dual form, not with a digit in front of it.
    expect(translate("ar", moreDigitsKey(2), { count: 2 })).not.toContain("2");
  });

  it("English never renders '1 more digits'", () => {
    expect(translate("en", moreDigitsKey(1), { count: 1 })).toBe("1 more digit");
    for (const n of [2, 3, 5]) {
      expect(translate("en", moreDigitsKey(n), { count: n })).toBe(`${n} more digits`);
    }
  });

  it("the caller's domain is 1–5, and the band above ten is deliberate", () => {
    /* `6 - dialed.length` with a typed length of 1–5. The 11+ form exists anyway
       because the rule belongs to the LANGUAGE rather than to today's caller: a
       later change to the number length would otherwise silently start rendering
       "11 أرقام", which is wrong Arabic, with nothing failing. Pinned so the
       unreachable-today branch is a recorded decision rather than dead code. */
    expect(codeOnly(DIALER)).toMatch(/t\(moreDigitsKey\(6 - dialed\.length\), \{ count: 6 - dialed\.length \}\)/);
    expect(moreDigitsKey(11)).not.toBe(moreDigitsKey(10));
  });
});

describe("#156 — the marquee, which had no i18n at all", () => {
  const row = (over: Partial<MarqueeContactRow> = {}): MarqueeContactRow => ({
    number: "777777",
    displayName: "Amira",
    tags: [],
    blocked: false,
    identityId: 42,
    ...over,
  });

  it("the engine carries KEYS and holds no finished English copy", () => {
    const code = codeOnly(ENGINE);
    for (const lit of [
      "Contact your family",
      "Call a friend",
      "Reach your team",
      "Call a VIP",
      "Someone you've saved",
      "Press the numbers to dial",
      "Find friends, family & team",
    ]) {
      expect(code, `the engine still holds "${lit}"`).not.toContain(`"${lit}"`);
    }
    // The prose above ROUND_PROMPT_KEY may still explain the decision, which is why
    // this ran on stripped source — and the strip must really be removing something,
    // or it could be hiding a live literal.
    expect(ENGINE, "the reason is recorded in place").toContain("Contact your family");
  });

  it("every round and every hint beat resolves to real copy in both languages", () => {
    const keys: TKey[] = [...Object.values(ROUND_PROMPT_KEY), ...HINT_LINE_KEYS];
    expect(keys.length, "five rounds plus two hint beats").toBe(7);
    for (const k of keys) {
      expect(DICT[k], `${k} is in the dictionary`).toBeTruthy();
      for (const loc of LOCALES) {
        const s = translate(loc, k);
        expect(s, `${k} (${loc})`).not.toBe(k);
        expect(s.trim().length, `${k} (${loc}) is not blank`).toBeGreaterThan(0);
      }
      // The Arabic half is Arabic, not the English copied across to fill the shape.
      expect(translate("ar", k), `${k} is translated`).not.toBe(translate("en", k));
      expect(translate("ar", k), `${k} is Arabic script`).toMatch(/[؀-ۿ]/);
    }
  });

  it("a real rotation carries keys the dictionary knows, on every slide that shows copy", () => {
    /* Driven through the REAL builder rather than read off the constant: the thing
       that matters is what a slide the user sees actually carries. */
    const slides = buildRotations([row({ tags: ["family"] }), row({ number: "888888", displayName: "Sam" })], {}, () => 0);
    expect(slides.length).toBeGreaterThan(1);
    for (const s of slides) {
      const f = frameAt(s, 300);
      if (f.promptKey === null) continue;
      expect(DICT[f.promptKey], `${f.promptKey} resolves`).toBeTruthy();
      expect(translate("ar", f.promptKey)).not.toBe(f.promptKey);
    }
    // At least one slide really did carry copy, so this cannot pass vacuously.
    expect(slides.some((s) => frameAt(s, 300).promptKey !== null)).toBe(true);
  });

  it("an EMPTY category still says which category it is", () => {
    /* The owner's clause is "it will show the other categories empty, but without
       showing numbers" — empty of NUMBERS, not of words. A slide that lost its
       prompt would render a blank row that reads as a broken marquee, and the
       cells-are-empty assertions elsewhere would all still pass. */
    const slides = buildRotations([], {}, () => 0);
    const empties = slides.filter((s) => s.kind === "empty");
    expect(empties.length, "there are empty-category slides").toBe(4);
    for (const s of empties) {
      const f = frameAt(s, 300);
      expect(f.promptKey, "an empty slide names its category").not.toBeNull();
      for (const loc of LOCALES) {
        expect(translate(loc, f.promptKey!).trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("THE PAINTER APPLIES IT — a key with a reader that never reaches the DOM is the v2.106.91 defect", () => {
    /* The dead-key sweep proves a key is REFERENCED. It says nothing about whether
       the component renders it, which is exactly how `msg.groupConversation` went to
       zero readers while looking wired. Both paint paths are pinned: the rAF loop and
       the reduced-motion still frame. */
    expect(PAINTER).toMatch(/tRef\.current\(f\.promptKey\)/);
    expect(PAINTER).toMatch(/still\.promptKey \? t\(still\.promptKey\) : ""/);
    expect(PAINTER).toMatch(/tRef\.current\("dialer\.marqueeDial"/);
  });

  it("the translator rides a REF, so a language switch is not one slide stale", () => {
    /* The rAF loop is set up by an effect keyed on `[slides]`. A `t` captured in that
       closure belongs to whichever render last ran the effect — and switching
       language changes the locale context, NOT `slides`, so the effect would not
       re-run and the marquee would keep painting the previous language until
       somebody edited a contact. */
    expect(PAINTER).toMatch(/const tRef = useRef\(t\);/);
    expect(PAINTER).toMatch(/tRef\.current = t;/);
    // …and the loop reads through the ref rather than the captured binding.
    const loop = PAINTER.slice(PAINTER.indexOf("const paint = "), PAINTER.indexOf("const loop = "));
    expect(loop.length, "found the painter").toBeGreaterThan(200);
    expect(loop, "no captured translator in the hot path").not.toMatch(/[^.]\bt\(/);
  });

  it("the engine stays free of React and the DOM — its test runs in node", () => {
    /* `Dialer.tsx` is the one app tab that is NOT React.lazy, so a runtime edge from
       this module into `i18n.tsx` (which imports React) would land in the entry
       chunk. The key type is taken as a TYPE-ONLY import, which is erased. */
    expect(ENGINE).toMatch(/import type \{ TKey \} from "@\/app\/i18n";/);
    const code = codeOnly(ENGINE);
    expect(code).not.toMatch(/^import \{[^}]*\} from "@\/app\/i18n"/m);
    expect(code).not.toMatch(/\bdocument\b|\bwindow\b|requestAnimationFrame|matchMedia/);
  });
});

describe("#156 — the house rules this surface has to keep", () => {
  it("Arabic uses WESTERN digits, because a number read aloud must be the number typed", () => {
    /* v2.106.84. Every number on this screen is interpolated — the countdown, the
       6-digit RELAY number, the party-line head count — so an Arabic-Indic numeral
       beside a substituted Western one reads as a rendering fault. */
    const arabicIndic = /[٠-٩۰-۹]/;
    const offenders = Object.entries(DICT)
      .filter(([k]) => k.startsWith("dialer.") || k.startsWith("presence."))
      .filter(([, e]) => arabicIndic.test((e as { ar: string }).ar))
      .map(([k]) => k);
    expect(offenders, `Arabic-Indic numerals: ${offenders.join(", ")}`).toEqual([]);
    // Non-vacuous: this surface really does carry digits in its Arabic.
    expect(translate("ar", "dialer.enterNumber")).toContain("6");
  });

  it("the missed-call banner is ONE sentence, not `from` + a name + a tail", () => {
    /* A sentence chopped at its English seams cannot be translated, only
       re-assembled into nonsense — Arabic does not put those words in that order.
       `tn` keeps the placeholders INSIDE the string. */
    const code = codeOnly(DIALER);
    expect(code).toMatch(/tn\("dialer\.missedFromTap"/);
    expect(code, "the tail is no longer a separate fragment").not.toContain("— tap to see all\"");
    for (const loc of LOCALES) {
      const s = translate(loc, "dialer.missedFromTap", { name: "Amira", num: " · 777 777" });
      expect(s, `${loc} keeps the name`).toContain("Amira");
      expect(s, `${loc} keeps the number`).toContain("777 777");
      expect(s, `${loc} leaves no raw placeholder`).not.toMatch(/\{\w+\}/);
    }
  });

  it("`num` is always supplied, so an absent number never leaves `{num}` on screen", () => {
    /* `translateNodes` keeps an unmatched placeholder verbatim, so omitting the var
       when there is no number would print the literal `{num}` to the user. */
    expect(codeOnly(DIALER)).toMatch(/num: missedLatest\.number \? [^:]+ : "",/);
    const s = translate("en", "dialer.missedFromTap", { name: "Amira", num: "" });
    expect(s).toBe("from Amira — tap to see all");
  });
});
