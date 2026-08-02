/**
 * THE GROUP-CALL PICKER AND PARTY LINES SPEAK ARABIC — and keep the distinctions that
 * make the screen legible while doing it.
 *
 * ── WHY A SWEEP AND NOT A LIST OF STRINGS ────────────────────────────────────────────
 * Enumerating "these 40 sentences are translated" goes stale the moment somebody adds the
 * 41st, and it goes stale SILENTLY — the list still passes while a new English literal
 * sits on the screen. So the load-bearing assertions below are the other shape: they walk
 * the component for anything a person could READ or hear announced and fail on whatever is
 * not routed through the translator. A string added later is covered rather than exempt.
 *
 * ── AND WHY THE VOCABULARY IS PINNED SEPARATELY ──────────────────────────────────────
 * This is the ONLY screen in the app that shows a GROUP CALL and a PARTY LINE at once,
 * and they are different things: one rings a set of people you pick, the other rings
 * nobody and is dialled. The failure mode here is not a missing translation but a
 * translation that collapses that pair — or Join/Start, or Delete/Remove — onto one word.
 * Nobody reviewing the English half would notice, because the English still says two
 * different things. So the Arabic is asserted to say two different things too.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { codeOnly } from "../../../server/testing/codeOnly";
import { copyOnScreen, expandCopy, whyCopyMissing } from "../../../server/testing/copyOnScreen";
import { GROUPCALL } from "./dict/groupcall";
import { DICT, translate } from "./i18n";

/* Resolved from THIS file, never from a hardcoded absolute path: a literal repo root
   passes on the machine it was written on and can never pass on a CI runner whose
   checkout lives somewhere else (the v2.106.60 finding, now a standing rule). */
const ROOT = resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

const RAW = read("client/src/pages/app/GroupCallScreen.tsx");
const SRC = codeOnly(RAW);

const entries = Object.entries(GROUPCALL) as [string, { en: string; ar: string }][];

/* ════════════════════════════════════════════════════════════════════════════════════
   1 — NOTHING A PERSON CAN READ IS STILL AN ENGLISH LITERAL
   ══════════════════════════════════════════════════════════════════════════════════ */

/** The attributes on this screen whose value is rendered or announced. */
const VISIBLE_ATTRS = ["aria-label", "placeholder", "title", "alt"];

/**
 * Two predicates, because an attribute and a text node fail differently.
 *
 * A LABEL can be one word — `aria-label="Close"` is copy — so the attribute rule accepts a
 * single word. A TEXT NODE cannot use that rule: the spans between `>` and `<` also catch
 * fragments of ordinary code, so it requires two SPACE-separated words. (Calibrated the
 * same way `groupsLocale.test.ts` calibrates its pair, and checked below against planted
 * regressions AND against real code, so it neither misses nor cries wolf.)
 */
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

/**
 * JSX text nodes, in the two shapes copy actually takes in this file: a short label on one
 * line, and a paragraph prettier has wrapped across several. The multi-line span rejects
 * anything carrying code punctuation (`= ; " \` { }`), which is what keeps a ternary spread
 * over two lines out of the results.
 */
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

/** Copy raised as a toast — never on screen when you look at the component, so the easiest
 *  kind to leave behind. Both the bare literal and the `err.message || "…"` fallback. */
function englishToasts(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/toast\.\w+\(\s*(?:[\w.]+\s*\|\|\s*)?("[^"]*"|`[^`]*`)/g)) {
    if (SENTENCE.test(m[1])) out.push(`toast(${m[1].slice(0, 60)})`);
  }
  return out;
}

describe("every string on the group-call screen goes through the translator", () => {
  it("is reading the real component (guards against a vacuous pass)", () => {
    /* Every sweep below is a `not`-shaped assertion over `SRC`, and all of them pass
       trivially against an empty string. A mis-resolved path or a `codeOnly` that ate the
       file would therefore report the screen as fully translated. */
    expect(SRC.length).toBeGreaterThan(8_000);
    expect(SRC).toContain("export function GroupCallScreen");
    expect(SRC).toContain("export function PartyLinesSection");
    expect(SRC).toContain("function createdAgo(");
  });

  it("both components call useT()", () => {
    // A component that stopped calling it could not translate anything, and every sweep
    // below would still pass, because the literals would be gone too.
    expect([...SRC.matchAll(/const t = useT\(\);/g)]).toHaveLength(2);
  });

  it("no user-visible ATTRIBUTE carries an English literal", () => {
    expect(
      englishAttributes(SRC),
      "route these through t() — an attribute is read aloud or shown just like body text",
    ).toEqual([]);
  });

  it("no JSX TEXT NODE carries an English literal", () => {
    expect(englishText(SRC), "route these through t()").toEqual([]);
  });

  it("no toast is raised with an English literal, fallback included", () => {
    expect(englishToasts(SRC), "route these through t()").toEqual([]);
  });

  it("these sweeps really bite — a planted regression is caught by each of them", () => {
    /* THE NON-VACUITY GUARD, and it is not ceremony: all three assertions above are
       `not`-shaped and would pass against a file with no copy in it at all. Each shape
       below is one this very file used to carry, so a sweep that stopped matching would be
       caught here rather than reporting a translated screen. */
    const planted = `
      <h3 className="x">Create group call</h3>
      <Button aria-label="Close">{t("groupcall.close")}</Button>
      <p>
        A party line is a room with its own 6-digit number — anyone who
        dials it lands in the same call.
      </p>
    `;
    expect(englishAttributes(planted)).toHaveLength(1);
    expect(englishText(planted).filter((s) => s.startsWith("inline:"))).toHaveLength(1);
    expect(englishText(planted).filter((s) => s.startsWith("block:"))).toHaveLength(1);
    expect(englishToasts(`toast.success("Party line deleted");`)).toHaveLength(1);
    // The `err.message || "…"` shape specifically — the fallback is the half that is easy
    // to miss, because the line already looks like it is handling the message.
    expect(englishToasts(`toast.error(err.message || "Couldn't create the party line.");`))
      .toHaveLength(1);
    // …and none of them fires on ordinary code, which is how the first draft of the
    // sibling sweep failed: it reported 81 offenders in a fully translated component.
    const code = `
      setManual("");
      return next;
      const ok = engine.dialGroup(nums, { voice });
      ) : list.length === 0 ? (
      toast.success(t("groupcall.lineDeleted"));
      onError: (err) => toast.error(err.message || t("groupcall.createFailed")),
    `;
    expect([...englishAttributes(code), ...englishText(code), ...englishToasts(code)]).toEqual([]);
  });

  it("the module-level helper takes the translator, because it cannot call a hook", () => {
    /* `createdAgo` is declared outside both components. The standing rule is that such a
       constant carries a KEY rather than a finished string; a FUNCTION can go one better
       and take the translator, which is what `inviteMessage.ts` already does. Returning a
       finished English sentence here is how a screen ends up 95% translated with one
       subline still English. */
    const helper = SRC.slice(SRC.indexOf("function createdAgo("));
    expect(helper.length).toBeGreaterThan(100);
    expect(helper).toMatch(/t: Translate/);
    expect(helper).toMatch(/t\("groupcall\.createdAgo", \{ ago \}\)/);
    expect(helper, "a finished English sentence must not survive here").not.toMatch(/Created \$\{/);
    // …and the call site really passes it, or the parameter is decoration.
    expect(SRC).toMatch(/createdAgo\(t, l\.createdAt, now\)/);
  });
});

/* ════════════════════════════════════════════════════════════════════════════════════
   2 — THE KEYS AND THEIR READERS
   ══════════════════════════════════════════════════════════════════════════════════ */

describe("the groupcall dictionary and the screen agree", () => {
  it("every groupcall.* key has a reader on this screen — a dead key reads as coverage", () => {
    /* v2.106.91's rule, applied locally so the failure names THIS screen rather than
       surfacing as a line in the app-wide sweep. An unread key is worse than a missing
       one: somebody counting keys concludes the screen is translated. */
    const dead = entries.map(([k]) => k).filter((k) => !SRC.includes(k));
    expect(dead, `no reader for:\n${dead.join("\n")}`).toEqual([]);
  });

  it("every groupcall.* key the screen references is defined", () => {
    const used = [...SRC.matchAll(/\bt\(\s*"(groupcall\.[A-Za-z0-9]+)"/g)].map((m) => m[1]);
    expect(used.length).toBeGreaterThan(25);
    const missing = used.filter((k) => !(k in GROUPCALL));
    expect(missing, `referenced but not defined:\n${missing.join("\n")}`).toEqual([]);
  });

  it("every Arabic half really is Arabic, not the English copied across", () => {
    /* The cheap way to satisfy `Entry`'s both-halves requirement is to paste the English
       across, and that ships a build claiming to be translated when it is not.
       `i18n.test.ts` sweeps the whole dictionary for this — but as a line in an app-wide
       list, which names the key and not the screen. */
    const copied = entries.filter(([, e]) => e.en === e.ar).map(([k]) => k);
    expect(copied, `English pasted into the Arabic half:\n${copied.join("\n")}`).toEqual([]);
    const notArabic = entries.filter(([, e]) => !/[؀-ۿ]/.test(e.ar)).map(([k]) => k);
    expect(notArabic, `no Arabic script:\n${notArabic.join("\n")}`).toEqual([]);
    /* …and the Arabic half is not merely Arabic-ish: a half still carrying a run of Latin
       words is English with a token pasted in front of it. `RELAY` is the product name and
       stays Latin in both halves, so it is stripped before the check. */
    const latinLeft = entries
      .filter(([, e]) => /[A-Za-z]{2,}\s+[A-Za-z]{2,}/.test(e.ar.replace(/RELAY/g, "")))
      .map(([k]) => k);
    expect(latinLeft, `untranslated English left in the Arabic half:\n${latinLeft.join("\n")}`)
      .toEqual([]);
  });

  it("the Join verb is REUSED from the Dialer rather than re-spelled privately", () => {
    /* The Dialer's party-line Join and this list's Join are the SAME act — dial the room,
       ring nobody. `dialer.join` already has a reader and is pinned by
       `server/partyLines.test.ts`; a private `groupcall.join` would be a second Arabic
       word for one button, which is the divergence one shared dictionary exists to
       prevent. */
    expect(SRC).toContain('t("dialer.join")');
    expect(Object.keys(GROUPCALL)).not.toContain("groupcall.join");
  });

  it("`common.delete` is deliberately NOT reached for, and that is a decision", () => {
    /* The three delete strings here are one family about ONE act — retiring a party line
       and permanently retiring its 6-digit number with it — and they read together.
       `common.delete` is the generic verb, still parked in `dictCoverage`'s
       UNREAD_BY_DESIGN for the group/admin sweep; reaching for it here would make that
       recorded exemption stale in a file this change does not own. The WORD is the same in
       both, which is the point — this is a namespacing choice, not a second translation. */
    expect(SRC).not.toContain('t("common.delete")');
    expect(GROUPCALL["groupcall.delete"].ar).toBe(DICT["common.delete"].ar);
  });
});

/* ════════════════════════════════════════════════════════════════════════════════════
   3 — THE VOCABULARY DISTINCTIONS SURVIVE TRANSLATION
   ══════════════════════════════════════════════════════════════════════════════════ */

const ar = (k: keyof typeof GROUPCALL) => GROUPCALL[k].ar;

describe("two English things that mean different things stay two Arabic things", () => {
  it("a PARTY LINE and a GROUP CALL are different words — this screen shows both", () => {
    /* The distinction the whole sheet rests on: a group call RINGS the people you pick; a
       party line rings NOBODY and is dialled. Collapse them and the top half of this sheet
       describes the bottom half, and `groupcall.lineAbout`'s "No ringing, no invites"
       contradicts the button above it.

       MATCHED ON THE STEM, not the definite form: Arabic attaches its prefixes to the word
       («الخطوط الجماعية» in the section header), so a containment check written the English
       way looks for a token that is never there. */
    const LINE = "خط"; // خط جماعي — a line
    const CALL = "مكالمة"; // مكالمة جماعية — a call
    expect(ar("groupcall.partyLines"), "the section names LINES").toContain(LINE);
    expect(ar("groupcall.title"), "the picker creates a CALL").toContain(CALL);
    expect(ar("groupcall.start")).toContain(CALL);
    expect(LINE).not.toBe(CALL);
    // …and neither borrows the other's noun, which is the way the two would collapse.
    expect(ar("groupcall.title"), "a group call is not a line").not.toContain(LINE);
    expect(ar("groupcall.partyLines"), "a party line is not a call").not.toContain(CALL);
  });

  it("the party-line phrase agrees with the one the Dialer already ships", () => {
    /* `dialer.partyLine` renders the SAME fact about the SAME room on another screen. Two
       wordings is how one product ends up with two names for one thing — and nothing fails
       when they drift, which is exactly why it is asserted. */
    expect(DICT["dialer.partyLine"].ar).toContain("على الخط");
    expect(ar("groupcall.live"), "both say «على الخط»").toContain("على الخط");
  });

  it("JOINING a line and STARTING a group call are different verbs", () => {
    // One rings nobody and one rings everybody. Same button row, opposite blast radius.
    const join = DICT["dialer.join"].ar;
    const start = ar("groupcall.start");
    expect(join).not.toBe(start);
    expect(start, "starting is not joining").not.toContain(join);
    // The count form follows the same verb rather than crossing over to another.
    expect(ar("groupcall.startCount")).toContain(start.split(" ")[0]);
  });

  it("DELETING a line and REMOVING somebody from the selection are two verbs", () => {
    /* Deleting is permanent and retires a 6-digit number for good; removing a chip is a
       deselect that costs nothing. English already spells them differently and Arabic must
       too, or the destructive button reads like the harmless one.

       The repo settled this pair once already: `groups.remove` is «إزالة» and
       `common.delete` is «حذف». */
    const remove = ar("groupcall.removeSelected");
    const del = ar("groupcall.delete");
    expect(remove, "removing a chip is not deleting").not.toContain(del);
    expect(ar("groupcall.deleteAction")).toContain(del);
    expect(ar("groupcall.deleteTitle")).toContain(del);
  });

  it("HIDING the fold-out is not DELETING anything", () => {
    // The disclosure toggle sits two rows above a destructive button.
    expect(ar("groupcall.hide")).not.toContain(ar("groupcall.delete"));
    expect(ar("groupcall.hide")).not.toBe(ar("groupcall.manage"));
  });

  it("VOICE and VIDEO stay two words, and match the rest of the app", () => {
    expect(ar("groupcall.voice")).not.toBe(ar("groupcall.video"));
    // The same two words the entry screen already uses for the same two choices.
    expect(ar("groupcall.voice")).toBe(DICT["gate.voice"].ar);
    expect(ar("groupcall.video")).toBe(DICT["gate.video"].ar);
  });

  it("nothing claims a lock, a PIN or a host — the three declined board items", () => {
    /* There is no party-line passcode in the schema and no admission check in
       `joinPartyLine`; `hostPin` is set to null on purpose. `partyLinesFrame.test.ts` pins
       those absences in the SOURCE, so a translated string that reintroduced the claim in
       Arabic only would slip past it. Asserted on the dictionary here for that reason. */
    for (const [k, e] of entries) {
      expect(e.en, `${k} must not claim a lock`).not.toMatch(/\block\b|PIN required|hosted by/i);
      expect(e.ar, `${k} must not claim a lock`).not.toMatch(/قفل|مضيف|كلمة مرور/);
    }
  });
});

/* ════════════════════════════════════════════════════════════════════════════════════
   4 — DIGITS AND PLACEHOLDERS
   ══════════════════════════════════════════════════════════════════════════════════ */

describe("numbers read the same in both languages", () => {
  it("no Arabic half uses Arabic-Indic numerals", () => {
    /* Every number on this screen is one somebody acts on — a 6-digit line number they
       dial, the participant cap, the live head-count. A substituted Western digit beside an
       Arabic-Indic one reads as a rendering fault (v2.106.84). */
    const bad = entries.filter(([, e]) => /[٠-٩۰-۹]/.test(e.ar));
    expect(bad.map(([k]) => k)).toEqual([]);
  });

  it("a digit stated in English is still a digit in Arabic", () => {
    const bad = entries.filter(([, e]) =>
      (e.en.match(/\d/g) ?? []).some((d) => !e.ar.includes(d)),
    );
    expect(bad.map(([k]) => k), "the number was dropped or spelled out").toEqual([]);
  });

  it("every placeholder in an English half survives into the Arabic half", () => {
    /* Substitution is BY NAME, which is what lets Arabic put `{ago}` where the language
       wants it. The cost of that freedom is that a dropped placeholder is silent — the
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

  it("interpolation really works, including where Arabic MOVES the placeholder", () => {
    /* Driven rather than pinned: whether a substituted value lands INSIDE the Arabic
       sentence is exactly what reading the dictionary cannot tell you.

       `createdAgo` is the case that proves the by-name rule earns its keep — English puts
       the span in the MIDDLE ("Created 3h ago") and Arabic after the preposition
       («أُنشئ قبل 3h»). A positional scheme would have produced nonsense. */
    expect(translate("ar", "groupcall.createdAgo", { ago: "3h" })).toContain("3h");
    expect(translate("en", "groupcall.createdAgo", { ago: "3h" })).toBe("Created 3h ago");
    // The number in the delete confirmation reaches BOTH halves — it is the one fact the
    // sentence is about.
    for (const l of ["en", "ar"] as const) {
      expect(translate(l, "groupcall.deleteBody", { number: "794-254" })).toContain("794-254");
      expect(translate(l, "groupcall.lineCreated", { number: "794-254" })).toContain("794-254");
      expect(translate(l, "groupcall.live", { count: 4 })).toContain("4");
      expect(translate(l, "groupcall.atCap", { max: 10 })).toContain("10");
      // `lineAbout` carries the cap now — v2.107.2 deleted `lineHint`, whose whole
      // content was a second, harder-to-read copy of this sentence's meaning.
      expect(translate(l, "groupcall.lineAbout", { max: 6 })).toContain("6");
      expect(translate(l, "groupcall.startCount", { n: 3 })).toContain("3");
      expect(translate(l, "groupcall.joinAria", { title: "غرفة العائلة" })).toContain("غرفة العائلة");
    }
    // …and no `{placeholder}` survives unsubstituted in either language.
    for (const l of ["en", "ar"] as const) {
      expect(translate(l, "groupcall.deleteBody", { number: "794-254" })).not.toMatch(/\{\w+\}/);
      expect(translate(l, "groupcall.atCap", { max: 10 })).not.toMatch(/\{\w+\}/);
    }
  });

  it("the interpolated values reach the render sites with the names the keys use", () => {
    // A key whose English half reads "{max}" and a call site passing `{ n: … }` renders the
    // literal "{max}" on screen. Silent, and only visible in the language nobody reviews.
    expect(SRC).toMatch(/t\("groupcall\.lineAbout", \{ max: lineCap \}\)/);
    expect(SRC).toMatch(/t\("groupcall\.atCap", \{ max: maxLines \}\)/);
    expect(SRC).toMatch(/t\("groupcall\.live", \{ count: l\.liveCount \}\)/);
    expect(SRC).toMatch(/t\("groupcall\.startCount", \{ n: selected\.size \}\)/);
    expect(SRC).toMatch(/t\("groupcall\.lineCreated", \{ number: formatPin\(line\.number\) \}\)/);
  });
});

/* ════════════════════════════════════════════════════════════════════════════════════
   5 — RTL: LOGICAL SPACING, AND THE THINGS THAT MUST STAY PHYSICAL
   ══════════════════════════════════════════════════════════════════════════════════ */

describe("the screen mirrors in RTL", () => {
  it("no physical spacing or inset utility is left in a className", () => {
    /* `dir` is written on the ROOT, so a logical utility flips for free and a physical one
       silently does not — which is how a search glyph or a presence LED ends up on the
       wrong side in Arabic while every test still passes. */
    const offenders: string[] = [];
    /* The delimiter set includes the QUOTES, because a template-literal className carries
       its branches as quoted literals and a whitespace-only boundary cannot see inside
       them (the measured v2.106.93 finding on the sibling sheet). */
    const PHYSICAL = /(?:^|[\s`"'])-?(?:pl|pr|ml|mr|left|right)-(?![a-z])/;
    for (const m of SRC.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
      const cls = m[1] ?? m[2] ?? "";
      if (PHYSICAL.test(cls) || /\btext-(?:left|right)\b/.test(cls)) offenders.push(cls.slice(0, 80));
    }
    /* String-concatenated classNames too — this file builds two of them with `+`, and the
       row button's `text-left` lived in exactly that shape. */
    for (const m of SRC.matchAll(/"([^"\n]*(?:flex|grid|inline)[^"\n]*)"/g)) {
      const cls = m[1];
      if (PHYSICAL.test(cls) || /\btext-(?:left|right)\b/.test(cls)) offenders.push(cls.slice(0, 80));
    }
    expect(offenders, "use ps-/pe-/ms-/me-/start-/end-").toEqual([]);
  });

  it("…and that sweep is not vacuous — it catches the shapes this file used to carry", () => {
    /* Every assertion above is `not`-shaped. These are the four real offenders that were
       in this file before the sweep, in the exact spellings they had. */
    const PHYSICAL = /(?:^|[\s`"'])-?(?:pl|pr|ml|mr|left|right)-(?![a-z])/;
    for (const cls of ["absolute left-3 top-1/2", "pl-9", "absolute -bottom-0.5 -right-0.5"]) {
      expect(PHYSICAL.test(cls), cls).toBe(true);
    }
    expect(/\btext-(?:left|right)\b/.test("flex w-full items-center text-left")).toBe(true);
    // …and it does NOT fire on the logical replacements, or it would fail on correct code.
    for (const cls of ["absolute start-3 top-1/2", "ps-9", "absolute -bottom-0.5 -end-0.5", "ms-auto"]) {
      expect(PHYSICAL.test(cls), cls).toBe(false);
    }
  });

  it("the replacements really are present, not merely the physical ones deleted", () => {
    // A sweep that only bans can be satisfied by removing the utility altogether, which
    // silently changes the layout instead of mirroring it.
    expect(SRC, "the search glyph's inset").toMatch(/absolute start-3 top-1\/2/);
    expect(SRC, "the field's room for that glyph").toMatch(/className="ps-9"/);
    expect(SRC, "the presence LED's corner").toMatch(/-bottom-0\.5 -end-0\.5/);
    expect([...SRC.matchAll(/text-start/g)], "both row buttons").toHaveLength(2);
    expect(SRC, "the row's trailing control group").toMatch(/ms-auto/);
  });

  it("VERTICAL centring stays physical, because it is direction-independent", () => {
    /* The search glyph is centred on the cross axis with `top-1/2 -translate-y-1/2`. There
       is no logical spelling to reach for and none is wanted: swapping a centring
       transform for a logical inset is what pushes a centred element the WRONG way in RTL
       (the standing exception). `text-center` on the empty state is the same idea. */
    expect(SRC).toMatch(/top-1\/2 size-4 -translate-y-1\/2/);
    expect(SRC).toMatch(/p-8 text-center/);
    // …and no HORIZONTAL centring pair exists here that a blanket sweep could mangle.
    expect(SRC).not.toMatch(/-translate-x-1\/2/);
  });

  it("every 6-digit number and every user-supplied name declares its direction", () => {
    /* A 6-digit RELAY number beside Arabic text has its parts reordered without isolation,
       and a contact or line NAME may be in either language whatever the app is set to. */
    // The contact row's number: an INLINE span, never the block — `dir` on the block also
    // flips `text-align`, so the digits would align to the opposite edge from the name.
    expect(SRC).toMatch(/<span dir="ltr" className="\[unicode-bidi:isolate\]">\s*\{c\.number\}/);
    expect(SRC, "the manual-add field takes Western digits in both languages").toMatch(
      /inputMode="numeric"[\s\S]{0,200}?dir="ltr"/,
    );
    // Names follow what was typed rather than the page.
    expect(SRC, "the contact's name").toMatch(/className="truncate font-medium" dir="auto"/);
    expect(SRC, "the line-name field").toMatch(/t\("groupcall\.lineNamePlaceholder"\)\}\s*\n[\s\S]{0,240}?dir="auto"/);
    // The party line's own number pill was already isolated and must stay so.
    expect(SRC).toMatch(/dir="ltr"[\s\S]{0,200}?\[unicode-bidi:isolate\][\s\S]{0,200}?formatPin\(l\.number\)/);
  });

  it("icon-only controls have an accessible name, and decorative glyphs are hidden", () => {
    /* The `+` was an icon-only button with NO accessible name at all — a screen reader
       announced "button". A localisation sweep is exactly when that surfaces, because the
       sweep is an enumeration of everything a person reads or hears. */
    expect(SRC).toMatch(/aria-label=\{t\("groupcall\.addNumber"\)\}/);
    // A glyph that sits beside its own translated label must not be announced twice.
    const decorative = [...SRC.matchAll(/<(Plus|Phone|Video|Copy|Share2|Trash2|Radio|SlidersHorizontal) className="size-4"([^/>]*)\/>/g)];
    expect(decorative.length, "the sweep found the glyphs").toBeGreaterThan(5);
    const unhidden = decorative.filter((m) => !/aria-hidden/.test(m[2])).map((m) => m[1]);
    expect(unhidden, `these glyphs are announced as well as their label: ${unhidden.join(", ")}`)
      .toEqual([]);
  });
});

/* ════════════════════════════════════════════════════════════════════════════════════
   6 — THE COPY THAT OTHER FILES PIN IS STILL ON THIS SCREEN
   ══════════════════════════════════════════════════════════════════════════════════ */

describe("the owner-signed-off sentences still reach the screen", () => {
  /* Each of these is pinned elsewhere by an English LITERAL, and moving the copy into the
     dictionary breaks that spelling. The PROPERTY those pins stand for — this sentence
     reaches this screen — is asserted here through `copyOnScreen`, which is satisfied by
     the literal OR by a key whose English half carries it. That is strictly stronger than
     the literal check, because reaching the dictionary also proves an Arabic half exists.

     They are listed with the file that pins each one, so the repoint is mechanical. Those
     files are outside this change's scope and are REPORTED rather than edited. */
  const PINNED: [string, string][] = [
    ["client/src/pages/app/partyLinesFrame.test.ts", "on the line"],
    ["client/src/pages/app/partyLinesFrame.test.ts", "up to"],
    ["client/src/pages/app/partyLinesFrame.test.ts", "keeps talking"],
    ["client/src/pages/app/partyLinesFrame.test.ts", "stops resolving for new dials"],
    ["client/src/pages/app/partyLinesFrame.test.ts", "retired for good"],
    ["client/src/pages/app/partyLinesFrame.test.ts", "You have all"],
    ["client/src/pages/app/partyLinesFrame.test.ts", "party lines"],
    ["client/src/pages/app/partyLinesFrame.test.ts", "Created"],
    ["client/src/pages/app/partyLinesFrame.test.ts", "Party line created"],
    ["client/src/pages/app/partyLinesFrame.test.ts", "Party line deleted"],
    ["client/src/pages/app/partyLinesFrame.test.ts", "Invite copied"],
    ["client/src/pages/app/partyLinesFrame.test.ts", "Join"],
    ["client/src/app/pinInput.test.ts", "(6 digits)"],
    ["server/partyLines.test.ts", "on the line"],
  ];

  it.each(PINNED)("%s — %s", (_file, english) => {
    expect(copyOnScreen(RAW, english), whyCopyMissing(RAW, english)).toBe(true);
  });

  it("…and the list is not empty (a vacuous `it.each` reports nothing)", () => {
    expect(PINNED.length).toBeGreaterThan(10);
  });

  it("`expandCopy` restores the sweeps that read this file's COPY", () => {
    /* `pinInput.test.ts` identifies a PIN box by what it is FOR — its placeholder naming a
       6-digit number — and that predicate matches copy, not keys. Once the placeholder is a
       key it matches nothing, and the sweep goes GREEN while covering zero boxes in this
       file: strictly worse than going red, because it reports safety. `expandCopy` is the
       documented repoint for exactly that shape, and this asserts it works here rather than
       leaving the claim in a report. */
    const expanded = expandCopy(RAW);
    expect(expanded, "the placeholder's words come back").toContain("Add a number (6 digits)");
    expect(/777777|6[- ]digit|six digits|\(6 digits\)/i.test(expanded)).toBe(true);
    // …and the un-expanded source really does NOT satisfy it, or this proves nothing.
    expect(/\(6 digits\)/.test(RAW)).toBe(false);
  });
});
