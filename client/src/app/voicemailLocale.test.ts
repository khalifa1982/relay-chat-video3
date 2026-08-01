/**
 * THE POST-DIAL VOICEMAIL CARD SPEAKS ARABIC — board 2g plus 5h's recording panel —
 * and keeps the distinctions that make it readable.
 *
 * ── WHY SWEEPS RATHER THAN A LIST OF SENTENCES ───────────────────────────────────────
 * "These 30 strings are translated" goes stale the moment somebody adds the 31st, and it
 * goes stale SILENTLY: the list still passes while a fresh English literal sits on the
 * screen. So the load-bearing assertions walk the component for anything a person could
 * read and fail on whatever is not routed through the translator, which covers the string
 * added next instead of exempting it.
 *
 * ── AND WHY THIS SCREEN NEEDS THE HELPER SWEEP TOO ───────────────────────────────────
 * Most copy here is a JSX text node or an attribute. `reasonLine` was a third shape: a
 * pure module-level function — which cannot call a hook — that RETURNED finished English
 * for the one line explaining why the call failed. A sweep reading only JSX would report
 * this screen as fully translated while that sentence stayed English, which is exactly
 * the defect `ago()` shipped with on the alert surfaces.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { codeOnly } from "../../../server/testing/codeOnly";
import { copyOnScreen, whyCopyMissing } from "../../../server/testing/copyOnScreen";
import { VOICEMAIL } from "./dict/voicemail";
import { DICT, translate } from "./i18n";
import { reasonKey, reasonLine } from "./VoicemailPrompt";

/* Resolved from THIS file, never a hardcoded repo root: a literal absolute path passes
   on the machine it was written on and can never pass on a runner whose checkout lives
   somewhere else (the v2.106.60 finding, now a standing rule). */
const ROOT = resolve(import.meta.dirname, "../../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

const RAW = read("client/src/app/VoicemailPrompt.tsx");
const SRC = codeOnly(RAW);

const entries = Object.entries(VOICEMAIL) as [string, { en: string; ar: string }][];
const ar = (k: keyof typeof VOICEMAIL) => VOICEMAIL[k].ar;
const en = (k: keyof typeof VOICEMAIL) => VOICEMAIL[k].en;

/* ════════════════════════════════════════════════════════════════════════════════════
   0 — THE SWEEPS ARE READING THE REAL COMPONENT
   ══════════════════════════════════════════════════════════════════════════════════ */

describe("this file is asserting about the real screen", () => {
  it("is reading the component and not an empty string", () => {
    /* Every sweep below is `not`-shaped and passes trivially against an empty string, so
       a mis-resolved path or a `codeOnly` that ate the file would report the screen as
       fully translated. */
    expect(SRC.length).toBeGreaterThan(8_000);
    expect(SRC).toContain("export function VoicemailPrompt");
    expect(SRC).toContain("function RecordPanel(");
    expect(SRC).toContain("function CalleeAvatar(");
  });

  it("both components read the translator", () => {
    /* The card and the recording panel are separate components, so each needs its own
       hook call — one of them left without it could not translate anything, and every
       `not`-shaped sweep here would still pass, because the literals would have gone
       with it. `RecordPanel` takes `rtl` as well, for the fill origin (§5). */
    expect(SRC).toMatch(/const t = useT\(\);/);
    expect(SRC).toMatch(/const \{ t, rtl \} = useLocale\(\);/);
  });
});

/* ════════════════════════════════════════════════════════════════════════════════════
   1 — NOTHING A PERSON CAN READ IS STILL AN ENGLISH LITERAL
   ══════════════════════════════════════════════════════════════════════════════════ */

/** The attributes on this card whose value is rendered, announced or shown on hover. */
const VISIBLE_ATTRS = ["aria-label", "title", "placeholder", "alt"];

/** A LABEL may be one word (`aria-label="Dismiss"` is copy), so the attribute rule
 *  accepts one. A TEXT NODE cannot use that rule — the spans between `>` and `<` also
 *  catch fragments of ordinary code — so it requires two space-separated words. */
const WORD = /[A-Za-z]{2,}/;
const SENTENCE = /[A-Za-z]{2,}\s+[A-Za-z]{2,}/;

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
    if (SENTENCE.test(m[1])) out.push(`inline: ${m[1].trim().slice(0, 60)}`);
  }
  for (const m of src.matchAll(/>\s*\n([^<>{}=;"`]*?)\n\s*</g)) {
    if (SENTENCE.test(m[1])) out.push(`block: ${m[1].replace(/\s+/g, " ").trim().slice(0, 60)}`);
  }
  return out;
}

/**
 * A string literal RETURNED from a helper — the shape a JSX sweep cannot see, and the
 * one this screen actually shipped (`reasonLine` returned three finished sentences).
 *
 * TWO EXCLUSIONS, each earned rather than convenient. A returned DICTIONARY KEY is not
 * copy — it is the mapping this release introduced, and its words live in the dictionary
 * where both halves are required. A template literal carrying `${…}` is code assembling a
 * value (`fmtClock`'s `0:23`), and any real copy has to go through `t()` anyway, which is
 * what §2 enforces. Both exclusions are proven not to swallow a real regression below.
 */
function englishReturns(src: string): string[] {
  return [...src.matchAll(/\breturn\s+("[^"]*"|`[^`]*`)/g)]
    .map((m) => m[1])
    .filter((s) => !s.includes("${"))
    .filter((s) => !(s.slice(1, -1) in DICT))
    .filter((s) => WORD.test(s));
}

describe("every string on the voicemail card goes through the translator", () => {
  it("no user-visible ATTRIBUTE carries an English literal", () => {
    expect(
      englishAttributes(SRC),
      "route these through t() — an attribute is announced just like body text",
    ).toEqual([]);
  });

  it("no JSX TEXT NODE carries an English literal", () => {
    expect(englishText(SRC), "route these through t()").toEqual([]);
  });

  it("no helper RETURNS a finished English string", () => {
    /* This is the one that bit: `reasonLine` returned "They're offline right now." from
       outside any component. It returns a KEY now, and the render site translates it —
       which is how a module-level helper participates in a dictionary at all. */
    expect(englishReturns(SRC), "return a dictionary key instead").toEqual([]);
  });

  it("no toast is built by concatenating a sentence onto a value", () => {
    /* `"Couldn't send the voicemail: " + err.message` is untranslatable BY CONSTRUCTION,
       not merely untranslated: Arabic does not put the cause where English does, so a
       sentence chopped at the English seam can only be re-assembled into nonsense. The
       reason is interpolated INTO the string instead (`{error}`), which lets the
       translator place it. */
    expect(SRC, "interpolate {error} into the sentence").not.toMatch(/toast\.\w+\(\s*["'`]/);
    expect(SRC).not.toMatch(/["']\s*\+\s*\(?err/);
    // …and every toast really does go through the translator.
    const toasts = [...SRC.matchAll(/toast\.\w+\(([^\n]*)/g)].map((m) => m[1]);
    expect(toasts.length, "the toast sweep found nothing — re-anchor it").toBeGreaterThan(6);
    for (const call of toasts) {
      expect(call, `untranslated toast: ${call}`).toMatch(/\bt\(\s*"voicemail\./);
    }
  });

  it("these sweeps really bite — a planted regression is caught by each of them", () => {
    /* THE NON-VACUITY GUARD, and it is not ceremony: every assertion above is `not`-shaped
       and would pass against a file with no copy in it at all. Each shape below is one a
       contributor would plausibly write on this screen. */
    const planted = `
      <button aria-label="Discard this recording">
        <span>Leave a voice message</span>
        <p>
          Sending stops the recording.
        </p>
      </button>
    `;
    expect(englishAttributes(planted)).toHaveLength(1);
    expect(englishText(planted).filter((s) => s.startsWith("inline:"))).toHaveLength(1);
    expect(englishText(planted).filter((s) => s.startsWith("block:"))).toHaveLength(1);
    expect(englishReturns(`if (reason === "peer-rejected") return "They declined your call.";`))
      .toHaveLength(1);
    /* AND THE TWO EXCLUSIONS DO NOT SWALLOW THAT. A key is dropped because it is in the
       dictionary; a made-up key that is NOT would still be reported, so the exclusion
       cannot be used to smuggle copy past this rule. */
    expect(englishReturns(`return "voicemail.reasonOffline";`)).toEqual([]);
    expect(englishReturns(`return "They are not answering";`)).toHaveLength(1);
    // …and none of them fires on ordinary code, which is how a looser first draft of this
    // shape reported dozens of offenders in a fully translated file.
    const code = `
      const s = Math.max(0, Math.floor(totalSec));
      for (let i = 0; i < BARS; i++) {
      if (hist.length > BARS) hist.shift();
      {t("voicemail.discard")}
    `;
    expect([...englishAttributes(code), ...englishText(code), ...englishReturns(code)]).toEqual([]);
  });
});

/* ════════════════════════════════════════════════════════════════════════════════════
   2 — THE KEYS AND THEIR READERS
   ══════════════════════════════════════════════════════════════════════════════════ */

describe("the voicemail dictionary and the screen agree", () => {
  it("every voicemail.* key has a reader on this screen — a dead key reads as coverage", () => {
    /* v2.106.91's rule, applied locally so the failure names THIS screen rather than
       surfacing as one line in the app-wide sweep. An unread key is worse than a missing
       one: somebody counting keys concludes the screen is translated. */
    const dead = entries.map(([k]) => k).filter((k) => !SRC.includes(k));
    expect(dead, `no reader for:\n${dead.join("\n")}`).toEqual([]);
  });

  it("every voicemail.* key the screen references is defined", () => {
    const used = [...SRC.matchAll(/"(voicemail\.[A-Za-z0-9]+)"/g)].map((m) => m[1]);
    expect(used.length, "the reference sweep found nothing — re-anchor it").toBeGreaterThan(20);
    const missing = used.filter((k) => !(k in VOICEMAIL));
    expect(missing, `referenced but not defined:\n${missing.join("\n")}`).toEqual([]);
  });

  it("every key is reached by a DIRECT t(\"key\") call — except the three named below", () => {
    /* `t(cond ? "a" : "b")` type-checks and renders correctly — and is invisible to
       `copyOnScreen`, whose whole job is letting a pin on owner-signed-off wording survive
       localisation. A screen written that way cannot have its copy pinned at all, which is
       a guard silently lost rather than a bug. So the branch goes OUTSIDE the call.

       THE THREE REASON KEYS ARE THE ONE EXEMPTION AND IT IS EARNED, NOT ASSUMED. They are
       reached as `t(reasonKey(info.reason))`, because the alternative — three direct calls
       behind a nested ternary at the render site — would put the reason→sentence mapping
       in TWO places, which is the drift this repo keeps paying for. What makes that safe is
       that the copy stays pinnable by a BETTER route: `reasonLine` resolves the whole chain
       to English, asserted in §3, so a pin on those words is stronger than the source
       regex it replaces rather than weaker. */
    const INDIRECT_BY_DESIGN = [
      "voicemail.reasonDeclined",
      "voicemail.reasonOffline",
      "voicemail.reasonNoAnswer",
    ] as const;
    const direct = new Set(
      [...SRC.matchAll(/\bt\(\s*"(voicemail\.[A-Za-z0-9]+)"/g)].map((m) => m[1]),
    );
    const indirect = entries.map(([k]) => k).filter((k) => !direct.has(k));
    expect(
      indirect.filter((k) => !INDIRECT_BY_DESIGN.includes(k as never)),
      `reached only indirectly — hoist the branch out of t():\n${indirect.join("\n")}`,
    ).toEqual([]);
    /* …AND THE EXEMPTION MAY NOT GO STALE IN EITHER DIRECTION (the v2.106.31 pattern). A
       named exemption that no longer offends is a comment pretending to be a rule, and it
       is how a real one later hides among the accepted ones. */
    const stale = INDIRECT_BY_DESIGN.filter((k) => direct.has(k));
    expect(stale, `now direct — remove from the exemption list:\n${stale.join("\n")}`).toEqual([]);
    // The exemption is only defensible while ONE function owns the mapping.
    expect(SRC).toMatch(/\{t\(reasonKey\(info\.reason\)\)\}/);
    expect([...SRC.matchAll(/reason === "peer-rejected"/g)]).toHaveLength(1);
  });

  it("every Arabic half really is Arabic, not the English copied across", () => {
    /* The cheap way to satisfy `Entry`'s both-halves requirement is to paste the English
       across, which ships a build claiming to be translated when it is not. */
    const copied = entries.filter(([, e]) => e.en === e.ar).map(([k]) => k);
    expect(copied, `English pasted into the Arabic half:\n${copied.join("\n")}`).toEqual([]);
    const notArabic = entries.filter(([, e]) => !/[؀-ۿ]/.test(e.ar)).map(([k]) => k);
    expect(notArabic, `no Arabic script:\n${notArabic.join("\n")}`).toEqual([]);
    /* …and not merely Arabic-ish: a half still carrying a run of Latin words is English
       with a token pasted in front of it. `RELAY` is the product name and stays Latin. */
    const latinLeft = entries
      .filter(([, e]) => /[A-Za-z]{2,}\s+[A-Za-z]{2,}/.test(e.ar.replace(/RELAY/g, "")))
      .map(([k]) => k);
    expect(latinLeft, `untranslated English left in the Arabic half:\n${latinLeft.join("\n")}`)
      .toEqual([]);
  });

  it("the owner-signed-off copy still reaches this screen", () => {
    /* The sweeps above prove nothing English is left; these prove the WORDS did not
       quietly change on the way into the dictionary. Satisfied by the literal or by a key
       whose English half is that sentence — the latter being strictly stronger, because
       reaching the dictionary also proves an Arabic half exists. */
    for (const line of [
      "Leave a voice message",
      "Tell me when they're back online",
      "Sending stops the recording",
      "Voice recording isn't supported by this browser",
    ]) {
      expect(copyOnScreen(SRC, line), whyCopyMissing(SRC, line)).toBe(true);
    }
  });
});

/* ════════════════════════════════════════════════════════════════════════════════════
   3 — THE VOCABULARY DISTINCTIONS SURVIVE TRANSLATION
   ══════════════════════════════════════════════════════════════════════════════════ */

/** The two stems the whole §3 argument rests on. Stems rather than whole phrases,
 *  because Arabic prefixes the definite article: «الرسالة الصوتية» contains «رسالة» but
 *  not «رسالة صوتية», so a phrase-level `includes` would fail on correct copy. */
const MAIL_STEM = "بريد";
const MESSAGE_STEM = "رسالة";

describe("two English words that mean different things stay two Arabic words", () => {
  it("VOICEMAIL and VOICE MESSAGE are different words — one sentence says both", () => {
    /* "The voice message lands in your chat with X — they'll get a 'Voicemail' alert"
       names the thing you record AND the alert the recipient sees. Share one Arabic word
       and that sentence collapses into "the voice message … a voice-message alert", which
       says nothing. So the rule is applied to every string that mentions either. */
    for (const [k, e] of entries) {
      if (/voicemail/i.test(e.en)) {
        expect(e.ar, `${k}: "voicemail" must read as ${MAIL_STEM}`).toContain(MAIL_STEM);
      }
      if (/voice message/i.test(e.en)) {
        expect(e.ar, `${k}: "voice message" must read as ${MESSAGE_STEM}`).toContain(MESSAGE_STEM);
      }
    }
    // The sweep is only meaningful if both sides of it actually occur.
    expect(entries.filter(([, e]) => /voicemail/i.test(e.en)).length).toBeGreaterThan(3);
    expect(entries.filter(([, e]) => /voice message/i.test(e.en)).length).toBeGreaterThan(1);
    // And the sentence that carries both really carries both.
    expect(ar("voicemail.landsInChat")).toContain(MAIL_STEM);
    expect(ar("voicemail.landsInChat")).toContain(MESSAGE_STEM);
    // The two SEND labels sit on one control and must not read identically.
    expect(ar("voicemail.sendVoicemail")).not.toBe(ar("voicemail.sendThisVoiceMessage"));
  });

  it("the voice message is named the same way `Messages` names it", () => {
    /* One object, two surfaces: the composer's own label is `msg.voiceMessage`. If this
       card invented a second Arabic term for it, the thing you record here and the thing
       that appears in the thread would read as two different features. */
    expect(DICT["msg.voiceMessage"].ar).toContain(MESSAGE_STEM);
    expect(ar("voicemail.leaveVoiceMessage")).toContain(MESSAGE_STEM);
  });

  it("DISCARD and DISMISS are different words — one destroys a take, one closes a card", () => {
    /* Discard calls `rec.cancel()`: the audio is gone and cannot be recovered. Dismiss
       closes the card and costs nothing. Both are on screen at once, so one Arabic word
       for both would hide a destructive act behind the word people learn means "close". */
    expect(en("voicemail.discard")).toBe("Discard");
    expect(en("voicemail.dismiss")).toBe("Dismiss");
    expect(ar("voicemail.discard")).not.toBe(ar("voicemail.dismiss"));
  });

  it("the three ways a recording can end are three different words", () => {
    // Pause, Discard and Send are the panel's only three controls and all three exit the
    // recording differently — one suspends it, one destroys it, one delivers it.
    const three = [ar("voicemail.pause"), ar("voicemail.discard"), ar("voicemail.send")];
    expect(new Set(three).size).toBe(3);
    // …and pause/resume are opposites, not one toggle word.
    expect(ar("voicemail.pause")).not.toBe(ar("voicemail.resume"));
    expect(ar("voicemail.pauseRecording")).not.toBe(ar("voicemail.resumeRecording"));
  });

  it("the two FAILED SENDS stay distinguishable", () => {
    // Different sends fail for different reasons and need different next steps; the
    // English says two things, so the Arabic must too.
    expect(ar("voicemail.sendFailed")).not.toBe(ar("voicemail.messageFailed"));
    expect(ar("voicemail.sentTo")).not.toBe(ar("voicemail.messageSentTo"));
  });

  it("the three refusal reasons are three distinct sentences in BOTH languages", () => {
    /* This is the whole point of `reasonKey`: declined, offline and unanswered are three
       different facts about one call, and this card is the one surface that knows which.
       Collapsing any two in Arabic would make it guess in the language where the reader
       has no English to fall back on. */
    const reasons = ["peer-rejected", "server-error:offline", "no-answer"];
    for (const locale of ["en", "ar"] as const) {
      const said = reasons.map((r) => translate(locale, reasonKey(r)));
      expect(new Set(said).size, `${locale} collapsed two reasons`).toBe(3);
    }
  });

  it("the Arabic reasons use the call log's own words rather than inventing a second set", () => {
    /* History already says «رفضوا» for a call the peer declined and «غير متصل» for
       offline. The card describing the SAME call with different words would read as two
       different events to somebody who saw both. */
    expect(ar("voicemail.reasonDeclined")).toContain("رفضوا");
    expect(DICT["history.declinedByThem"].ar).toContain("رفضوا");
    expect(ar("voicemail.reasonOffline")).toContain("غير متصل");
    expect(DICT["presence.offline"].ar).toContain("غير متصل");
  });

  it("`reasonLine` is DERIVED from `reasonKey`, so the two can never disagree", () => {
    /* The seam this file was already tested through, and it is stronger now: it resolves
       the whole chain — reason → key → the dictionary entry — where it used to prove only
       its own `if` ladder. Behavioural, because whether the English still says these words
       is exactly what a source pin cannot answer. */
    expect(reasonLine("peer-rejected")).toBe("They declined your call.");
    expect(reasonLine("server-error:offline")).toBe("They're offline right now.");
    expect(reasonLine("no-answer")).toBe("They didn't answer.");
    // An unknown reason must not blank the line — the card always says something honest.
    expect(reasonLine("something-nobody-has-added-yet")).toBe("They didn't answer.");
    // Derived, not restated: the sentences live in the dictionary only.
    expect(SRC).toMatch(/return translate\("en", reasonKey\(reason\)\)/);
    expect(SRC).not.toMatch(/They're offline right now/);
  });
});

/* ════════════════════════════════════════════════════════════════════════════════════
   4 — DIGITS AND PLACEHOLDERS
   ══════════════════════════════════════════════════════════════════════════════════ */

describe("numbers read the same in both languages", () => {
  it("no Arabic half uses Arabic-Indic numerals", () => {
    /* The only number on this card is the recording cap, and it is a number somebody acts
       on — it is the same figure the clock counts toward. A substituted Western digit
       beside an Arabic-Indic one on the same line reads as a rendering fault (v2.106.84). */
    const bad = entries.filter(([, e]) => /[٠-٩۰-۹]/.test(e.ar)).map(([k]) => k);
    expect(bad).toEqual([]);
  });

  it("a digit stated in English is still a digit in Arabic", () => {
    const bad = entries
      .filter(([, e]) => (e.en.match(/\d/g) ?? []).some((d) => !e.ar.includes(d)))
      .map(([k]) => k);
    expect(bad, "the number was dropped or spelled out").toEqual([]);
  });

  it("every placeholder in an English half survives into the Arabic half", () => {
    /* Substitution is BY NAME, which is what lets Arabic put `{who}` where the language
       wants it — «سننبّهك عند عودة {who}» leads where "You'll be alerted when {who}"
       trails. The cost of that freedom is that a dropped placeholder is silent: the
       sentence renders, missing the very thing it was about. */
    const bad: string[] = [];
    for (const [k, e] of entries) {
      const want = new Set(e.en.match(/\{\w+\}/g) ?? []);
      const got = new Set(e.ar.match(/\{\w+\}/g) ?? []);
      for (const p of want) if (!got.has(p)) bad.push(`${k} lost ${p}`);
      for (const p of got) if (!want.has(p)) bad.push(`${k} invented ${p}`);
    }
    expect(bad).toEqual([]);
  });

  it("interpolation really works for every sentence that carries a value", () => {
    // Driven, not pinned: whether a substituted name lands INSIDE the Arabic sentence is
    // exactly what reading the dictionary cannot tell you.
    for (const [k, e] of entries) {
      const names = (e.en.match(/\{(\w+)\}/g) ?? []).map((p) => p.slice(1, -1));
      if (names.length === 0) continue;
      const vars = Object.fromEntries(names.map((n) => [n, `«${n}»`]));
      for (const locale of ["en", "ar"] as const) {
        const out = translate(locale, k as keyof typeof DICT, vars);
        for (const n of names) {
          expect(out, `${k} (${locale}) lost ${n}`).toContain(`«${n}»`);
        }
        expect(out, `${k} (${locale}) rendered a placeholder verbatim`).not.toMatch(/\{\w+\}/);
      }
    }
  });

  it("the cap in the copy is DERIVED from the constant, never written as a literal", () => {
    /* Both places that state the ceiling take it from `VOICEMAIL_MAX_MS`, so the copy can
       never promise a duration the recorder does not enforce. This survives localisation
       because the number is INTERPOLATED — a translated sentence with the figure baked
       into its Arabic half would be a second literal in a second language. */
    expect([...SRC.matchAll(/Math\.round\(VOICEMAIL_MAX_MS \/ 1000\)/g)]).toHaveLength(2);
    for (const k of ["voicemail.recordingLabel", "voicemail.autoStop"] as const) {
      expect(en(k)).toContain("{seconds}");
      expect(ar(k)).toContain("{seconds}");
    }
    expect(translate("ar", "voicemail.autoStop", { seconds: 60 })).toContain("60");
  });
});

/* ════════════════════════════════════════════════════════════════════════════════════
   5 — RTL: LOGICAL SPACING, AND THE TWO THINGS THAT MUST STAY PHYSICAL
   ══════════════════════════════════════════════════════════════════════════════════ */

describe("the voicemail card mirrors in RTL", () => {
  it("no physical spacing or inset utility is left anywhere in the component", () => {
    /* `dir` is written on the ROOT, so a logical utility flips for free and a physical one
       silently does not — which is how the missed-call marker ends up on the wrong corner
       of the avatar in Arabic while every other test still passes.

       SWEPT OVER THE COMMENT-STRIPPED SOURCE, because the prose here necessarily NAMES the
       physical spellings it replaced — the trap this repo has hit nineteen times. */
    const PHYSICAL = /(?:^|[\s`"'{(+:!])-?(?:pl|pr|ml|mr|left|right)-(?![a-z])/g;
    const hits = [...SRC.matchAll(PHYSICAL)].map((m) =>
      SRC.slice(Math.max(0, m.index - 40), m.index + 40).replace(/\s+/g, " "),
    );
    /* DELIBERATELY EMPTY, and that is the assertion. Centring (`left-1/2` with
       `-translate-x-1/2`) is direction-INDEPENDENT and must stay physical — the logical
       spelling pushes it the wrong way in RTL — so if one ever arrives here it has to be
       named with its reason rather than slipping through a blanket ban. There is none on
       this card today: everything is centred with `place-items-center` or
       `justify-center`, neither of which has a handedness. */
    expect(hits, "use ps-/pe-/ms-/me-/start-/end-").toEqual([]);
    expect(SRC).not.toMatch(/\btext-(?:left|right)\b/);
  });

  it("that sweep really bites", () => {
    // It is `not`-shaped over a variable, so it passes against anything that stopped
    // matching. Both the plain and the variant-prefixed spellings are planted, the second
    // because a boundary set without `:` silently misses `md:left-0`.
    const PHYSICAL = /(?:^|[\s`"'{(+:!])-?(?:pl|pr|ml|mr|left|right)-(?![a-z])/g;
    for (const planted of [
      `className="absolute -bottom-0.5 -right-0.5 grid"`,
      `className="flex items-center p-1.5 pl-3"`,
      `className={"fixed md:left-0 " + (x ? "ml-2" : "")}`,
    ]) {
      expect([...planted.matchAll(PHYSICAL)].length, planted).toBeGreaterThan(0);
    }
    // …and does not fire on the logical spellings that replaced them, nor on ordinary code.
    for (const clean of [
      `className="absolute -bottom-0.5 -end-0.5 grid"`,
      `className="flex items-center p-1.5 ps-3"`,
      `const frac = Math.max(0, Math.min(1, ms / VOICEMAIL_MAX_MS));`,
    ]) {
      expect([...clean.matchAll(PHYSICAL)].length, clean).toBe(0);
    }
  });

  it("the avatar's missed-call marker rides the TRAILING corner", () => {
    // The same logical spelling the thread rows' and the group sheet's own avatar badges
    // use, so the app cannot end up with one badge flipping in Arabic and another not.
    expect(SRC).toMatch(/absolute -bottom-0\.5 -end-0\.5 /);
  });

  it("the elapsed rail grows from the LEADING edge in both directions", () => {
    /* THE ONE PHYSICAL PROPERTY THAT CANNOT BE SWEPT, and it is a CSS limit rather than an
       oversight: `transform-origin` takes physical keywords only — there is no
       `origin-start` — so a rail left on `origin-left` would fill from the END of the line
       in Arabic while the waveform beside it (an ordinary flex row, which `dir` flips for
       free) fills from the start. Two STATIC class names picked by a ternary, never a
       composed one: a class assembled at render time is invisible to the JIT and comes out
       unstyled. */
    expect(SRC).toMatch(/rtl \? "origin-right" : "origin-left"/);
    expect(SRC, "a composed class name renders unstyled").not.toMatch(/origin-\$\{/);
    // …and the fill is still the bounded compositor transform it has always been.
    expect(SRC).toMatch(/style\.transform = `scaleX\(/);
  });

  it("the mono clock readout is bidi-isolated, or its two halves swap", () => {
    /* `0:23 / 1:00` is two clock values either side of a slash — digits are weak and `/`
       is neutral, so in an RTL paragraph the algorithm resolves them the other way round
       and the readout claims the take is already past its cap. */
    const clock = SRC.slice(SRC.indexOf("ref={clockRef}") - 400, SRC.indexOf("ref={clockRef}"));
    expect(clock.length, "the clock slice collapsed — re-anchor it").toBeGreaterThan(100);
    expect(clock).toMatch(/dir="ltr"/);
    expect(clock).toMatch(/\[unicode-bidi:isolate\]/);
  });

  it("the callee's name is dir=auto, never dir=ltr", () => {
    /* `who` is a display NAME — which may itself be Arabic — or, before the lookup
       resolves, the callee's 6-digit RELAY number. Forcing LTR would lay an Arabic name
       out backwards; `auto` resolves per value, and a pure-digit string still renders
       LTR because digits carry no strong direction. */
    expect(SRC).toMatch(/<span dir="auto" className="text-\[17px\] font-bold/);
  });
});
