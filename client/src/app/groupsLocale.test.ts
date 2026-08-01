/**
 * THE GROUP INFO SHEET SPEAKS ARABIC (#157) — and keeps its four vocabulary
 * distinctions while doing it.
 *
 * ── WHY A SWEEP AND NOT A LIST OF STRINGS ────────────────────────────────────────────
 * Enumerating "these 90 sentences are translated" goes stale the moment somebody adds
 * the 91st, and it goes stale SILENTLY — the list still passes while a new English
 * literal sits on the screen. So the load-bearing assertion below is the other shape:
 * it walks the component for anything a person could READ and fails on whatever is not
 * routed through the translator. A string added later is covered rather than exempt.
 *
 * ── AND WHY THE VOCABULARY IS PINNED SEPARATELY ──────────────────────────────────────
 * This is the densest permission surface in the app. Four pairs of English words mean
 * different things here — creator/admin, remove/revoke/delete, group code/app passcode,
 * status/story — and the failure mode is not a missing translation but a translation
 * that collapses a pair onto one word. Nobody reviewing the English half would notice,
 * because the English still says two different things. So the Arabic is asserted to say
 * two different things too.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { codeOnly } from "../../../server/testing/codeOnly";
import { copyOnScreen, whyCopyMissing } from "../../../server/testing/copyOnScreen";
import { GROUPS } from "./dict/groups";
import { DICT, translate } from "./i18n";

/* Resolved from THIS file, never from a hardcoded absolute path: a literal repo root
   passes on the machine it was written on and can never pass on a CI runner whose
   checkout lives somewhere else (the v2.106.60 finding, now a standing rule). */
const ROOT = resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

const RAW = read("client/src/app/GroupInfoSheet.tsx");
const SRC = codeOnly(RAW);

const entries = Object.entries(GROUPS) as [string, { en: string; ar: string }][];

/* ════════════════════════════════════════════════════════════════════════════════════
   1 — NOTHING A PERSON CAN READ IS STILL AN ENGLISH LITERAL
   ══════════════════════════════════════════════════════════════════════════════════ */

/** The attributes on this screen whose value is rendered or announced. */
const VISIBLE_ATTRS = [
  "aria-label",
  "placeholder",
  "title",
  "alt",
  "emptyHint",
  "removeLabel",
  "displayName",
];

/**
 * Two predicates, because an attribute and a text node fail differently.
 *
 * A LABEL can be one word — `aria-label="Close"` is copy — so the attribute rule
 * accepts a single word. A TEXT NODE cannot use that rule: the spans between `>` and
 * `<` also catch fragments of ordinary code, so it requires two SPACE-separated words.
 *
 * MY FIRST VERSION USED ONE LOOSE RULE FOR BOTH AND FAILED ON CORRECT SOURCE — it swept
 * whole LINES with `word<non-alpha>word`, which matches `setAddError(null);` and
 * `return map;`, and reported 81 offenders in a fully translated file. A guard that
 * cries wolf is as useless as one that never fires; the shapes below are calibrated
 * against the pre-translation file (see "these sweeps really bite" at the end of this
 * block: together they find 30 strings there and 0 here).
 */
const WORD = /[A-Za-z]{2,}/;
const SENTENCE = /[A-Za-z]{2,}\s+[A-Za-z]{2,}/;

/** Literal values of the attributes on this screen that are rendered or announced. */
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
 * JSX text nodes, in the two shapes copy actually takes in this file: a short label on
 * one line, and a paragraph prettier has wrapped across several. The multi-line span
 * rejects anything carrying code punctuation (`= ; " \` { }`), which is what keeps a
 * ternary spread over two lines out of the results.
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

/** Copy raised as a toast or an inline field error — never on screen when you look at
 *  the component, so the easiest kind to leave behind. */
function englishToasts(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/(toast\.\w+|setAddError)\(\s*("[^"]*"|`[^`]*`)/g)) {
    if (SENTENCE.test(m[2])) out.push(`${m[1]}(${m[2].slice(0, 60)})`);
  }
  return out;
}

describe("every string on the group sheet goes through the translator", () => {
  it("is reading the real component (guards against a vacuous pass)", () => {
    /* Every sweep below is a `not`-shaped assertion over `SRC`, and all of them pass
       trivially against an empty string. A mis-resolved path or a `codeOnly` that ate
       the file would therefore report the screen as fully translated. */
    expect(SRC.length).toBeGreaterThan(20_000);
    expect(SRC).toContain("export function GroupInfoSheet");
    expect(SRC).toContain("function InviteLinkSection");
    expect(SRC).toContain("function GroupLockSection");
  });

  it("all three components call useT()", () => {
    // A component that stopped calling it could not translate anything, and every
    // sweep below would still pass because the literals would be gone too.
    expect([...SRC.matchAll(/const t = useT\(\);/g)]).toHaveLength(3);
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

  it("no toast or inline error is raised with an English literal", () => {
    expect(englishToasts(SRC), "route these through t()").toEqual([]);
  });

  it("these sweeps really bite — a planted regression is caught by each of them", () => {
    /* THE NON-VACUITY GUARD, and it is not ceremony: all three assertions above are
       `not`-shaped and would pass against a file with no copy in it at all. Each shape
       below is one a contributor would plausibly write, so a sweep that stopped
       matching would be caught here rather than reporting a translated screen. */
    const planted = `
      <p className="x">Members who already joined stay in the group.</p>
      <button aria-label="Remove the lock">{t("groups.remove")}</button>
      <p>
        Hides the chat and its preview behind a 4-digit code on this
        device. It is not a permission.
      </p>
    `;
    expect(englishAttributes(planted)).toHaveLength(1);
    expect(englishText(planted).filter((s) => s.startsWith("inline:"))).toHaveLength(1);
    expect(englishText(planted).filter((s) => s.startsWith("block:"))).toHaveLength(1);
    expect(englishToasts(`toast.error("Couldn't remove them.");`)).toHaveLength(1);
    // …and none of them fires on ordinary code, which is how the first draft of this
    // file failed: it reported 81 offenders in a fully translated component.
    const code = `
      setAddError(null);
      return map;
      background: info.data?.membersCanAdd
      const x = useState<InviteAudience>("all");
      ) : !info.data ? (
      toast.success(t("groups.idCopied"));
    `;
    expect([...englishAttributes(code), ...englishText(code), ...englishToasts(code)]).toEqual([]);
  });

  it("the module-level options table carries KEYS, not finished strings", () => {
    /* A constant cannot call a hook, so a table declared outside the component can
       only hold keys — the standing rule. Holding a finished English string here is
       how a screen ends up 95% translated with its segmented control still English. */
    expect(SRC).toMatch(/labelKey: TKey; hintKey: TKey/);
    expect(SRC).toMatch(/\{t\(o\.labelKey\)\}/);
    const table = SRC.slice(SRC.indexOf("const AUDIENCE_OPTIONS"), SRC.indexOf("];", SRC.indexOf("const AUDIENCE_OPTIONS")));
    expect(table.length).toBeGreaterThan(120);
    /* ANCHORED AT A PROPERTY POSITION (`{` or `,` then the name), not a bare
       `/label:|hint:/`. `codeOnly` strips whole-line comments but not a TRAILING one, so
       the loose form fired on a mutation that merely added `// label: "Guests only"`
       beside the table — the prose trap, caught by a control mutation in this file's own
       verification run. Documenting the old shape must not fail the test; carrying it
       must. */
    expect(table, "a label here must be a key").not.toMatch(/[{,]\s*(?:label|hint):/);
    /* COUNTED ON THE VALUE (`labelKey: "`), not the identifier. The slice starts at the
       declaration, so it contains the TYPE ANNOTATION too — `labelKey: TKey` — and a
       bare identifier count reads 4 for three entries. My first version asserted 3 and
       failed on correct source: pinning the declaration rather than the use. */
    expect([...table.matchAll(/labelKey: "/g)]).toHaveLength(3);
    expect([...table.matchAll(/hintKey: "/g)]).toHaveLength(3);
    // …and the three values themselves are data, not copy, so they stay literals.
    for (const v of ["all", "guest", "registered"]) expect(table).toContain(`value: "${v}"`);
  });
});

/* ════════════════════════════════════════════════════════════════════════════════════
   2 — THE KEYS AND THEIR READERS
   ══════════════════════════════════════════════════════════════════════════════════ */

describe("the groups dictionary and the screen agree", () => {
  it("every groups.* key has a reader on this screen — a dead key reads as coverage", () => {
    /* v2.106.91's rule, applied locally so the failure names THIS screen rather than
       surfacing as a line in the app-wide sweep. An unread key is worse than a missing
       one: somebody counting keys concludes the screen is translated. */
    const dead = entries.map(([k]) => k).filter((k) => !SRC.includes(k));
    expect(dead, `no reader for:\n${dead.join("\n")}`).toEqual([]);
  });

  it("every groups.* key the screen references is defined", () => {
    const used = [...SRC.matchAll(/\bt\(\s*"(groups\.[A-Za-z0-9]+)"/g)].map((m) => m[1]);
    expect(used.length).toBeGreaterThan(50);
    const missing = used.filter((k) => !(k in GROUPS));
    expect(missing, `referenced but not defined:\n${missing.join("\n")}`).toEqual([]);
  });

  it("every Arabic half really is Arabic, not the English copied across", () => {
    /* ADDED AFTER A MUTATION SURVIVED: replacing one Arabic half with its English text
       passed all 42 assertions here. `i18n.test.ts` sweeps the whole dictionary for
       exactly this and would have caught it — but as a line in an app-wide list, which
       names the key and not the screen. The cheap way to satisfy `Entry`'s both-halves
       requirement is to paste the English across, and that ships a build claiming to be
       translated when it is not, so this module asserts it for itself. */
    const copied = entries.filter(([, e]) => e.en === e.ar).map(([k]) => k);
    expect(copied, `English pasted into the Arabic half:\n${copied.join("\n")}`).toEqual([]);
    const notArabic = entries.filter(([, e]) => !/[؀-ۿ]/.test(e.ar)).map(([k]) => k);
    expect(notArabic, `no Arabic script:\n${notArabic.join("\n")}`).toEqual([]);
    /* …and the Arabic half is not merely Arabic-ish: a half that still carries a run of
       Latin words is English with a token pasted in front of it. `RELAY` is the product
       name and stays Latin in both halves, so it is stripped before the check. */
    const latinLeft = entries
      .filter(([, e]) => /[A-Za-z]{2,}\s+[A-Za-z]{2,}/.test(e.ar.replace(/RELAY/g, "")))
      .map(([k]) => k);
    expect(latinLeft, `untranslated English left in the Arabic half:\n${latinLeft.join("\n")}`)
      .toEqual([]);
  });

  it("the shared verb is REUSED rather than re-spelled privately", () => {
    /* `common.cancel` already has readers on four other screens. A private
       `groups.cancel` would be a second Arabic word for one button — the exact
       divergence one shared module exists to prevent. */
    expect(SRC).toContain('t("common.cancel")');
    expect(Object.keys(GROUPS)).not.toContain("groups.cancel");
  });
});

/* ════════════════════════════════════════════════════════════════════════════════════
   3 — THE FOUR VOCABULARY DISTINCTIONS SURVIVE TRANSLATION
   ══════════════════════════════════════════════════════════════════════════════════ */

const ar = (k: keyof typeof GROUPS) => GROUPS[k].ar;

describe("two English words that mean different things stay two Arabic words", () => {
  it("CREATOR and ADMIN are different words, and the app's own term is kept", () => {
    /* v2.104.0 chose "Creator" over the board's "OWNER" because adminship is DERIVED
       from having made the group and cannot be revoked — a fact, not a grant. Two
       roles rendered with one Arabic word would erase that in the second language,
       where the two tags sit side by side on the same row. */
    expect(GROUPS["groups.roleCreator"].en).toBe("Creator");
    expect(GROUPS["groups.roleAdmin"].en).toBe("Admin");
    expect(ar("groups.roleCreator")).not.toBe(ar("groups.roleAdmin"));
    // The board's word is still declined, in both halves.
    expect(GROUPS["groups.roleCreator"].en.toUpperCase()).not.toBe("OWNER");
  });

  it("REMOVING A PERSON, REVOKING A LINK and REMOVING AN ADMINSHIP are three verbs", () => {
    /* They are three different acts with three different blast radii, and two of them
       are offered on the SAME member row. English spells two of the three "remove";
       Arabic must not spell all three the same, or the row reads as one button twice. */
    const person = ar("groups.remove");
    const link = ar("groups.revoke");
    const adminship = ar("groups.removeAdmin");
    expect(new Set([person, link, adminship]).size, "three acts, three words").toBe(3);
    // …and the progressive forms follow their own verb rather than crossing over.
    expect(ar("groups.removing")).toContain(person);
    expect(ar("groups.revoking")).toContain(link);
  });

  it("`common.delete` is deliberately NOT reached for — nothing here deletes", () => {
    /* Removing somebody from a group and deleting a thing are different acts; the
       revoke copy exists precisely to say that members who joined STAY. Borrowing the
       delete verb would contradict the sentence beside it. */
    expect(SRC).not.toContain('t("common.delete")');
    expect(ar("groups.remove")).not.toBe(DICT["common.delete"].ar);
  });

  it("the GROUP CODE and the APP PASSCODE are named differently", () => {
    /* The whole safety argument of the lock is that the app passcode is the only route
       back from a forgotten group code. One sentence names both, so if the two terms
       read alike that sentence stops meaning anything.

       MATCHED ON THE STEM, NOT THE DEFINITE FORM. My first version asked for the bare
       «المجموعة» and failed on correct source: Arabic attaches its prefixes to the word
       («للمجموعة» in the aria-label), so a containment check written the English way
       looks for a token that is never there. */
    const GROUP = "مجموع";
    const APP = "تطبيق";
    const both = ar("groups.lockWrongCode");
    expect(both, "the refusal names both, so they must be tellable apart").toContain(GROUP);
    expect(both).toContain(APP);
    expect(ar("groups.lockNewCodeAria"), "this box takes the GROUP's code").toContain(GROUP);
    expect(ar("groups.lockNeedsPasscode"), "the way back is the APP's passcode").toContain(APP);
    expect(GROUP).not.toBe(APP);
  });

  it("STATUS is not the word the ephemeral STORY uses", () => {
    /* v2.101.0 settled this after the owner corrected it three times: a STORY is the
       24-hour post (`dict/status.ts`, «قصة»), a STATUS is the profile label. This
       screen sets a status. */
    expect(ar("groups.statusLabel")).not.toContain("قصة");
    expect(ar("groups.statusEmptyHint")).not.toContain("قص");
    expect(ar("groups.statusLabel")).toBe("الحالة");
  });
});

/* ════════════════════════════════════════════════════════════════════════════════════
   4 — DIGITS, PLACEHOLDERS AND THE ARROW
   ══════════════════════════════════════════════════════════════════════════════════ */

describe("numbers read the same in both languages", () => {
  it("no Arabic half uses Arabic-Indic numerals", () => {
    /* Every number on this screen is one somebody acts on — a 6-digit group ID they
       dial, a 4-digit code they type, 7 days of link life. A substituted Western digit
       beside an Arabic-Indic one reads as a rendering fault (v2.106.84). */
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
    /* Substitution is BY NAME, which is what lets Arabic put `{name}` where the
       language wants it. The cost of that freedom is that a dropped placeholder is
       silent — the sentence renders, missing the very thing it was about. */
    const bad: string[] = [];
    for (const [k, e] of entries) {
      const want = new Set(e.en.match(/\{\w+\}/g) ?? []);
      const got = new Set(e.ar.match(/\{\w+\}/g) ?? []);
      for (const p of want) if (!got.has(p)) bad.push(`${k} lost ${p}`);
      for (const p of got) if (!want.has(p)) bad.push(`${k} invented ${p}`);
    }
    expect(bad).toEqual([]);
  });

  it("interpolation really works for the sentences that carry a name or a count", () => {
    // Driven rather than pinned: whether a substituted name lands INSIDE the Arabic
    // sentence is exactly what reading the dictionary cannot tell you.
    expect(translate("ar", "groups.removeConfirm", { name: "خليفة" })).toContain("خليفة");
    expect(translate("ar", "groups.memberCountMany", { n: 5 })).toContain("5");
    expect(translate("ar", "groups.onlineCount", { n: 3 })).toContain("3");
    // …and the count is not stranded outside the sentence in either language.
    expect(translate("en", "groups.memberCountOne", { n: 1 })).toBe("1 member");
  });

  it("the navigation arrow follows the reading direction", () => {
    /* "Profile → App lock" is a PATH. A right-pointing arrow inside RTL prose points
       backwards through the sequence it is describing. */
    for (const k of ["groups.lockNeedsPasscode", "groups.lockNeedsPasscodeToast"] as const) {
      expect(GROUPS[k].en, k).toContain("→");
      expect(GROUPS[k].ar, k).toContain("←");
      expect(GROUPS[k].ar, k).not.toContain("→");
    }
  });
});

/* ════════════════════════════════════════════════════════════════════════════════════
   5 — RTL: LOGICAL SPACING, AND THE ONE THING THAT MUST STAY PHYSICAL
   ══════════════════════════════════════════════════════════════════════════════════ */

describe("the sheet mirrors in RTL", () => {
  it("no physical spacing or inset utility is left in a className", () => {
    /* `dir` is written on the ROOT, so a logical utility flips for free and a physical
       one silently does not — which is how a photo's camera badge or a switch's knob
       ends up on the wrong side in Arabic while every test still passes. */
    const offenders: string[] = [];
    /* The delimiter set includes the QUOTES, because a template-literal className
       carries its branches as quoted literals (`${on ? "start-[16px]" : "start-0.5"}`)
       and a whitespace-only boundary cannot see inside them — measured: reverting that
       knob to `left-` failed only the structural pin and slipped past this sweep, which
       is the sweep whose whole job is to catch it. */
    const PHYSICAL = /(?:^|[\s`"'])-?(?:pl|pr|ml|mr|left|right)-(?![a-z])/;
    for (const m of SRC.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
      const cls = m[1] ?? m[2] ?? "";
      if (PHYSICAL.test(cls) || /\btext-(?:left|right)\b/.test(cls)) {
        offenders.push(cls.slice(0, 80));
      }
    }
    /* DELIBERATELY EMPTY, and that is the assertion. Centring (`left-1/2` with
       `-translate-x-1/2`) is direction-INDEPENDENT and must stay physical — the
       logical spelling pushes it the wrong way in RTL — so if one ever arrives on this
       screen it has to be named here with its reason rather than slipping through a
       blanket ban. There is none today. */
    expect(offenders, "use ps-/pe-/ms-/me-/start-/end-").toEqual([]);
  });

  it("the corner affordances use the logical edge", () => {
    // The camera badge on the group's photo and the presence LED on a member's disc
    // are the same idea in two places; they must agree about which corner they are on.
    expect(SRC).toMatch(/-bottom-1 -end-1/);
    expect(SRC).toMatch(/-bottom-0\.5 -end-0\.5/);
  });

  it("the switch knob travels from the START of its track, so the control mirrors", () => {
    /* `inset-inline-start-…` is the CSS PROPERTY name and emits NOTHING (v2.106.78);
       `start-…` is the Tailwind utility. Both halves must be complete literals or the
       JIT cannot see them. */
    expect(SRC).toMatch(/membersCanAdd \? "start-\[16px\]" : "start-0\.5"/);
    expect(SRC).not.toContain("inset-inline-start-");
  });

  it("the group's own 6-digit ID and the invite URL stay left-to-right", () => {
    // A number or a URL beside Arabic text has its parts reordered without this.
    expect(SRC).toMatch(/dir="ltr"/);
    expect(SRC).toContain("unicode-bidi:isolate");
    const idBtn = SRC.slice(SRC.indexOf("onClick={copyNumber}"), SRC.indexOf("</button>", SRC.indexOf("onClick={copyNumber}")));
    expect(idBtn.length).toBeGreaterThan(80);
    expect(idBtn).toMatch(/dir="ltr"/);
  });
});

/* ════════════════════════════════════════════════════════════════════════════════════
   6 — THE COPY THAT OTHER FILES PIN IS STILL ON THIS SCREEN
   ══════════════════════════════════════════════════════════════════════════════════ */

describe("the owner-signed-off sentences still reach the screen", () => {
  /* Each of these is pinned elsewhere by an English LITERAL, and moving the copy into
     the dictionary breaks that spelling. The PROPERTY those pins stand for — this
     sentence reaches this screen — is asserted here through `copyOnScreen`, which is
     satisfied by the literal OR by a key whose English half carries it. That is
     strictly stronger than the literal check, because reaching the dictionary also
     proves an Arabic half exists.

     They are listed with the file that pins each one, so the repoint is mechanical. */
  const PINNED: [string, string][] = [
    ["server/groupRoster.test.ts", "from this group? They lose access to it"],
    ["server/groupRoster.test.ts", "Messages they already sent stay"],
    ["server/groupRoster.test.ts", "They'll see messages from when they join, not the history before it"],
    ["server/groupRoles.test.ts", "Remove admin"],
    ["server/groupRoles.test.ts", "Make admin"],
    ["server/groupRoles.test.ts", "created before admins existed"],
    ["server/groupProfileEditor.test.ts", "Choose a group photo"],
    ["server/groupProfileEditor.test.ts", "the group photo"],
    ["server/groupProfileEditor.test.ts", "no ID"],
    ["server/inviteAudience.test.ts", "Create another link"],
    ["client/src/app/adminGroupFrames.test.ts", "Creator"],
    ["client/src/app/adminGroupFrames.test.ts", "Members who already joined stay in the group"],
    ["client/src/app/groupLock.test.ts", "not a permission"],
    ["client/src/app/groupLock.test.ts", "other devices still show them"],
    ["client/src/app/notShowing.test.ts", "controls are hidden"],
    ["client/src/app/notShowing.test.ts", "nothing has changed"],
    ["client/src/app/notShowing.test.ts", "Loading members"],
  ];

  it.each(PINNED)("%s — %s", (_file, english) => {
    expect(copyOnScreen(RAW, english), whyCopyMissing(RAW, english)).toBe(true);
  });

  it("…and the list is not empty (a vacuous `it.each` reports nothing)", () => {
    expect(PINNED.length).toBeGreaterThan(15);
  });
});
