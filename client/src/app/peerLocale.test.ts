/**
 * The PEER surfaces speak Arabic — the profile popup, the full-screen profile, the
 * avatar ring and the guest-expiry note (`PeerOverlays.tsx`).
 *
 * WHAT THIS FILE ASSERTS, AND WHY IT IS SHAPED THIS WAY
 * ----------------------------------------------------
 * Three different kinds of claim, because a translation sweep can fail three ways:
 *
 *   1. A string is left behind in English. Guarded by a SWEEP over the component's
 *      own user-visible positions rather than a list of the strings that exist today,
 *      so the string somebody adds NEXT is covered rather than exempt.
 *   2. A key is added to the dictionary and never rendered. A dead key is worse than a
 *      missing one: it looks like coverage, so somebody counting keys concludes the
 *      screen is translated when nothing on it is (v2.106.91).
 *   3. The Arabic quietly collapses a distinction the English keeps. Here that is
 *      v2.101.0's STORY (the ephemeral post) versus STATUS (the profile label) — the
 *      owner corrected it three times, and the language where nobody would notice it
 *      being undone is exactly the second one.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DICT, translate, type TKey } from "./i18n";
import { PEER } from "./dict/peer";
import { guestExpiryKey } from "./PeerOverlays";
import { CONTACT_TAGS } from "@shared/contactTags";
import { PROFILE_STATUSES, PROFILE_STATUS_META } from "@shared/profileStatus";

const ROOT = resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

const SRC = read("client/src/app/PeerOverlays.tsx");

/** Comments stripped. Every rule below is about what the app DOES or SAYS, and this
 *  file's prose legitimately quotes the very strings some rules forbid — the trap this
 *  repo has hit repeatedly. Block comments go first so a JSX `{/* … *\/}` collapses to a
 *  bare `{}` rather than swallowing a documented prop block. */
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n")
  .filter((l) => !/^\s*\/\//.test(l))
  .join("\n");

const PEER_KEYS = Object.keys(PEER) as TKey[];

/**
 * One exported function's OWN body.
 *
 * BOUNDED BY THE NEXT `export function`, NOT BY A FIXED CHARACTER COUNT. A fixed window
 * is the fragility this repo keeps paying for, and it bit here: a 2600-character slice
 * from `GuestExpiryNote` ran past its end into `PeerOverlaysHost` and matched THAT
 * component's `useT()`, so deleting the hook from `GuestExpiryNote` left the assertion
 * green while a whole sub-surface had lost the translator.
 */
function fnBody(name: string): string {
  const at = CODE.indexOf(`export function ${name}`);
  expect(at, `${name} is exported from PeerOverlays`).toBeGreaterThan(0);
  const after = CODE.indexOf("\nexport function ", at + 1);
  const body = CODE.slice(at, after === -1 ? CODE.length : after);
  // The slice is real, and it is ONE function — not the rest of the file.
  expect(body.length, `${name}: slice is non-empty`).toBeGreaterThan(200);
  expect(
    body.match(/export function /g)?.length,
    `${name}: the slice must hold exactly one function`,
  ).toBe(1);
  return body;
}

describe("every user-visible string on the peer surfaces goes through the dictionary", () => {
  it("no attribute, toast or JSX text run is a hardcoded English sentence", () => {
    /* THE SWEEP IS THE POINT, not the list. Enumerating today's strings would go stale
       the moment somebody adds a control; this looks at the POSITIONS a string can
       occupy and requires each to be an expression rather than a literal. */
    const offenders: string[] = [];

    // 1. Attributes a person reads, and toast bodies.
    for (const re of [
      /(?:title|placeholder|aria-label|alt)=\{?["`]([^"`]{2,})["`]/g,
      /toast\.(?:success|error|info|message)\(\s*["`]([^"`]{2,})/g,
    ]) {
      for (const m of CODE.matchAll(re)) {
        // `alt={label}` and friends are expressions, so they never reach here. A bare
        // literal does.
        if (/[A-Za-z]{3}/.test(m[1])) offenders.push(m[1]);
      }
    }

    // 2. JSX TEXT RUNS. `>text<` is ambiguous with TypeScript generics (`useState<X |
    //    null>(null)` reads as a text run), so a run only counts when it is a plausible
    //    sentence: letters and spaces/punctuation only, no `;` `=` `(` `)` `.` `,`.
    for (const m of CODE.matchAll(/>\s*([A-Za-z][A-Za-z '’—-]{2,})\s*</g)) {
      offenders.push(m[1].trim());
    }

    expect(
      offenders,
      `these still reach the screen as English literals:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("the component really does render through the translator", () => {
    // Guards the sweep above against passing because the file stopped rendering
    // anything at all: a screen with no `t(` calls would trivially have no literals.
    expect(CODE).toMatch(/import \{ useT, type TKey \} from "\.\/i18n"/);
    const calls = CODE.match(/\bt\("peer\.[\w.]+"/g) ?? [];
    expect(calls.length, "peer.* keys rendered from this screen").toBeGreaterThan(20);
    // Every component that shows words takes the hook — a missed one is a whole
    // sub-surface left in English, and each is checked against its OWN body.
    for (const fn of ["PeerAvatar", "ProfileStatusChip", "GuestExpiryNote", "PeerOverlaysHost"]) {
      expect(fnBody(fn), `${fn} must read the translator`).toMatch(/const t = useT\(\);/);
    }
  });

  it("every key this module declares has a reader — a dead key reads as coverage", () => {
    /* v2.106.91's rule. The exemptions are NAMED rather than a tolerated count, because
       a count-based threshold is exactly how a real dead key hides among accepted ones. */
    const INDIRECT = new Set<TKey>([
      // Reached through `PROFILE_STATUS_LABEL_KEY`, keyed on the shared status key.
      "peer.profileStatus.work",
      "peer.profileStatus.vacation",
      "peer.profileStatus.travel",
      "peer.profileStatus.free",
      "peer.profileStatus.busy",
      // Reached through `guestExpiryKey`, which picks the plural form.
      "peer.guestExpiresToday",
      "peer.guestExpiresInDay",
      "peer.guestExpiresInTwoDays",
      "peer.guestExpiresInDaysFew",
      "peer.guestExpiresInDaysMany",
    ]);
    const dead = PEER_KEYS.filter(
      (k) => !INDIRECT.has(k) && !CODE.includes(`t("${k}"`),
    );
    expect(dead, `declared but never rendered: ${dead.join(", ")}`).toEqual([]);

    // …and the indirect ones really are reachable, or the exemption is a hiding place.
    for (const k of INDIRECT) {
      expect(PEER_KEYS, `${k} must exist to be exempted`).toContain(k);
    }
    expect(CODE).toMatch(/PROFILE_STATUS_LABEL_KEY\[meta\.key\]/);
    expect(CODE).toMatch(/t\(guestExpiryKey\(daysLeft\), \{ count: daysLeft \}\)/);
  });
});

describe("the STORY / STATUS vocabulary survives the translation", () => {
  /* v2.101.0: a STORY is the ephemeral post, a STATUS is the profile label. Two of this
     screen's strings called the post a "status" — the popup avatar's aria-label and the
     button that opens the story viewer — while the `title` on the same element already
     said "View story". Both now say story.

     Pinned HERE as well as in `storyVsStatus.test.ts` because that file's extractor
     matches `aria-label={"…"` / `aria-label={\`…\``, which a ternary defeats — it is how
     the aria-label stayed wrong. This asks the dictionary instead, where the words are. */

  /** The keys about the ephemeral post. */
  const STORY_KEYS: TKey[] = [
    "peer.viewStory",
    "peer.newStoryTap",
    "peer.viewNamedStory",
  ];

  it("the story keys say story in BOTH languages, never status", () => {
    for (const k of STORY_KEYS) {
      const e = DICT[k];
      expect(e.en.toLowerCase(), `${k}.en`).toContain("story");
      expect(e.en.toLowerCase(), `${k}.en`).not.toContain("status");
      // «قصة» is the word `dict/status.ts` uses for the post. Reaching for a different
      // one here would let the two surfaces name one thing two ways in Arabic.
      expect(e.ar, `${k}.ar`).toContain("قصة");
    }
  });

  it("no peer key calls the ephemeral post a status, in either half", () => {
    // The PROFILE LABEL is legitimately a status, so it is exempted BY NAME — and its
    // own words never contain "status" anyway, which is asserted below.
    const offenders = PEER_KEYS.filter((k) => !k.startsWith("peer.profileStatus."))
      .filter((k) => /\bstatus(es)?\b/i.test(DICT[k].en) || /\bحالة\b/.test(DICT[k].ar));
    expect(offenders, `these say "status" about a story: ${offenders.join(", ")}`).toEqual([]);
  });

  it("the two controls that used to say status now say story", () => {
    // The button that opens the story viewer, and the avatar's label.
    expect(CODE).not.toMatch(/View status/);
    expect(CODE).not.toMatch(/'s status/);
    const viewer = CODE.slice(CODE.indexOf("openPeerStatus(n);"));
    expect(viewer.slice(0, 700)).toMatch(/t\("peer\.viewStory"\)/);
  });

  it("the PROFILE LABEL keeps its own words — the two ideas never share one", () => {
    /* Collapsing "story" and the profile label onto one Arabic word is how v2.101.0's
       correction would be undone silently. The label's five values are their own
       vocabulary and must not borrow «قصة». */
    for (const s of PROFILE_STATUSES) {
      const e = DICT[`peer.profileStatus.${s}` as TKey];
      expect(e, `peer.profileStatus.${s} exists`).toBeTruthy();
      expect(e.ar, `peer.profileStatus.${s}.ar must not say "story"`).not.toContain("قصة");
    }
  });

  it("every profile status the shared module can return has a translation", () => {
    // A sixth status added to `PROFILE_STATUS_META` must not arrive untranslated.
    for (const meta of PROFILE_STATUS_META) {
      const k = `peer.profileStatus.${meta.key}` as TKey;
      expect(PEER_KEYS, `${meta.key} needs a key`).toContain(k);
      // The English half is the shared constant's own label, so the chip reads
      // identically in English to what it did before the sweep.
      expect(DICT[k].en).toBe(meta.label);
    }
  });
});

describe("the label chips share ONE key with Contacts, so one fact has one Arabic word", () => {
  it("the chips translate through contacts.tag.*, not a private copy", () => {
    /* `dict/contacts.ts` records the rule: "Family" the section heading and "Family" the
       chip are the SAME fact. A `peer.tag.*` copy would hold that only until somebody
       edited one of the two. */
    expect(CODE).toMatch(/const TAG_LABEL_KEY: Record<ContactTag, TKey>/);
    for (const tag of CONTACT_TAGS) {
      expect(CODE, `${tag} must map to the shared key`).toContain(`"contacts.tag.${tag}"`);
    }
    expect(CODE).toMatch(/\{t\(TAG_LABEL_KEY\[tag\]\)\}/);
    // No parallel namespace was minted.
    const rival = PEER_KEYS.filter((k) => k.startsWith("peer.tag."));
    expect(rival, `a rival tag namespace: ${rival.join(", ")}`).toEqual([]);
  });

  it("the shared English label is no longer read at the render site", () => {
    // Rendering `TAG_LABEL[tag]` would be English forever, whatever the dictionary says.
    expect(CODE).not.toMatch(/TAG_LABEL\[/);
  });

  it("the loop variable is `tag`, so `t` is the translator and not a ContactTag", () => {
    /* It used to be `t`. Removing the shadow beats aliasing around it (v2.106.85) — and
       a shadowed `t` here would be a silent type error's worth of wrongness: `t("…")`
       would be calling a string. */
    expect(CODE).toMatch(/CONTACT_TAGS\.map\(\(tag\) => \{/);
    expect(CODE).toMatch(/tags: toggleContactTag\(myTags, tag\)/);
  });
});

describe("the guest countdown counts correctly in both languages", () => {
  it("English needs two forms and gets them", () => {
    expect(translate("en", guestExpiryKey(0))).toBe("Guest number expires today");
    expect(translate("en", guestExpiryKey(-3))).toBe("Guest number expires today");
    expect(translate("en", guestExpiryKey(1), { count: 1 })).toBe(
      "Guest number expires in 1 day",
    );
    // The bug the old `day${n === 1 ? "" : "s"}` existed to avoid: "1 days".
    expect(translate("en", guestExpiryKey(1), { count: 1 })).not.toContain("1 days");
    for (const n of [2, 3, 7, 12, 30]) {
      expect(translate("en", guestExpiryKey(n), { count: n })).toBe(
        `Guest number expires in ${n} days`,
      );
    }
  });

  it("ARABIC NEEDS FOUR, and each count selects the right one", () => {
    /* 1 singular, 2 DUAL, 3–10 plural of paucity, 11+ singular accusative. Rendering
       "3 يومًا" is wrong in a way every Arabic reader sees, which is why this is a
       function rather than a ternary at the render site. */
    expect(translate("ar", guestExpiryKey(1), { count: 1 })).toContain("يوم واحد");
    expect(translate("ar", guestExpiryKey(2), { count: 2 })).toContain("يومين");
    for (const n of [3, 7, 10]) {
      expect(translate("ar", guestExpiryKey(n), { count: n }), `${n} takes أيام`).toContain(
        "أيام",
      );
    }
    for (const n of [11, 25, 30]) {
      expect(translate("ar", guestExpiryKey(n), { count: n }), `${n} takes يومًا`).toContain(
        "يومًا",
      );
    }
    // The dual and the paucity form are genuinely different strings, or the split is
    // decoration.
    expect(guestExpiryKey(2)).not.toBe(guestExpiryKey(3));
    expect(guestExpiryKey(10)).not.toBe(guestExpiryKey(11));
  });

  it("the digits stay WESTERN wherever a count is actually substituted", () => {
    /* v2.106.84: an Arabic-Indic numeral beside a substituted Western one reads as a
       rendering fault.

       SCOPED TO THE INTERPOLATED FORMS, and that scoping is a correction to my own first
       version of this test, which demanded a digit in EVERY form and failed on correct
       source. Arabic spells one and two as WORDS — «يوم واحد», «يومين» — so those entries
       substitute nothing and have no digit to be Western. Asserting otherwise would have
       forced «خلال 1 يوم», which no Arabic speaker writes. */
    for (const n of [3, 7, 12, 30]) {
      const s = translate("ar", guestExpiryKey(n), { count: n });
      expect(s, `${n} renders as Western digits`).toMatch(new RegExp(`\\b${n}\\b`));
    }
    // No form, interpolated or not, may carry an Arabic-Indic numeral.
    for (const n of [0, 1, 2, 5, 12]) {
      expect(
        translate("ar", guestExpiryKey(n), { count: n }),
        `${n}: no Arabic-Indic numerals`,
      ).not.toMatch(/[٠-٩]/);
    }
  });

  it("one and two are spelled as WORDS in Arabic, not as a substituted digit", () => {
    /* The reason the rule above has to be scoped, pinned as the property it is: Arabic
       counts one and two with the noun's own singular and dual forms rather than with a
       numeral, so these two entries deliberately carry no `{count}` at all. */
    for (const k of ["peer.guestExpiresInDay", "peer.guestExpiresInTwoDays"] as TKey[]) {
      expect(DICT[k].ar, `${k}.ar spells the count`).not.toMatch(/\d/);
      expect(DICT[k].ar, `${k}.ar interpolates nothing`).not.toContain("{count}");
    }
    // …while the forms that DO count carry the placeholder in both halves.
    for (const k of ["peer.guestExpiresInDaysFew", "peer.guestExpiresInDaysMany"] as TKey[]) {
      expect(DICT[k].en).toContain("{count}");
      expect(DICT[k].ar).toContain("{count}");
    }
  });

  it("the note still says the clock resets, in both languages", () => {
    // A bare countdown implies one nobody can stop; `touchGuestExpiry` really does push
    // it forward on every visit, so the sentence is true and must survive translation.
    expect(DICT["peer.guestCountdownResets"].en).toBe("Opening RELAY resets the countdown");
    expect(DICT["peer.guestCountdownResets"].ar).toContain("RELAY");
    expect(CODE).toMatch(/t\("peer\.guestCountdownResets"\)/);
  });
});

describe("sentences keep their placeholders INSIDE them", () => {
  it("the private-labels line is one key, not two fragments glued around a name", () => {
    /* A sentence chopped at the English seam cannot be translated — Arabic does not put
       the person between the same two words, so the halves can only be re-assembled into
       nonsense. */
    expect(DICT["peer.labelsPrivate"].en).toContain("{name}");
    expect(DICT["peer.labelsPrivate"].ar).toContain("{name}");
    expect(CODE).toMatch(/t\("peer\.labelsPrivate", \{ name: p\.displayName \|\| t\("peer\.them"\) \}\)/);
    // The old split shape is gone.
    expect(CODE).not.toMatch(/never shared with\{" "\}/);
  });

  it("every interpolated key carries its placeholder in BOTH halves", () => {
    // A placeholder present in English and missing in Arabic renders a sentence with a
    // hole in it — and one present in Arabic only renders a literal `{name}`.
    for (const k of PEER_KEYS) {
      const en = [...DICT[k].en.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      const ar = [...DICT[k].ar.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      expect(ar, `${k}: placeholders differ between halves`).toEqual(en);
    }
  });

  it("Arabic is free to REORDER the name, and does where it reads better", () => {
    /* Substitution is BY NAME, so the placeholder may move. "X's story" has no Arabic
       possessive — it becomes "story of X" — and "{name} full profile" ends with the
       name rather than starting with it. Asserted so a later "fix" that forces the
       English order is caught. */
    expect(translate("ar", "peer.viewNamedStory", { name: "خليفة" })).toBe("عرض قصة خليفة");
    const full = translate("ar", "peer.fullProfileOf", { name: "خليفة" });
    expect(full.endsWith("خليفة"), `Arabic ends with the name: ${full}`).toBe(true);
    expect(translate("en", "peer.fullProfileOf", { name: "Khalifa" }).startsWith("Khalifa")).toBe(
      true,
    );
  });
});

describe("RTL — the sweep to logical properties", () => {
  it("no physical spacing survives on this screen", () => {
    /* `pl-/pr-/ml-/mr-` are reading-order gaps and must swap sides in Arabic. This file
       had exactly one (`mr-1` on the tick inside a label chip); the sweep is a rule
       rather than a fix so the next one added is caught. */
    const bad = [...CODE.matchAll(/\b(?:pl|pr|ml|mr)-[\w./[\]#%-]+/g)].map((m) => m[0]);
    expect(bad, `physical spacing: ${bad.join(", ")}`).toEqual([]);
    // …and the logical replacement really is there, so this did not pass by deletion.
    expect(CODE).toMatch(/<Check className="me-1 inline size-3" \/>/);
  });

  it("no physical text alignment or edge positioning either", () => {
    const bad = [
      ...CODE.matchAll(/\btext-(?:left|right)\b/g),
      ...CODE.matchAll(/(?<![\w-])(?:left|right)-\d/g),
    ].map((m) => m[0]);
    expect(bad, `physical direction: ${bad.join(", ")}`).toEqual([]);
  });

  it("the 6-digit number is direction-isolated on BOTH profile surfaces", () => {
    /* A RELAY number beside Arabic has its two groups reordered by the bidi algorithm
       without this — `777-254` renders as `254-777`, which is a different number. */
    const isolated = CODE.match(/\[unicode-bidi:isolate\][^>]*dir="ltr"/g) ?? [];
    expect(isolated.length, "the popup and the full profile both isolate it").toBe(2);
    // Both really are the number, not some other mono run.
    for (const m of CODE.matchAll(/dir="ltr"\s*>([\s\S]{0,160})/g)) {
      expect(m[1]).toMatch(/p\.number/);
    }
  });

  it("centring stays PHYSICAL where it is used, because centring has no direction", () => {
    // Nothing on this screen centres with `left-1/2`, so the rule is expressed as its
    // absence rather than as an exemption list — if one arrives, the test above about
    // `left-\d` deliberately does not flag `left-1/2`.
    expect(CODE).not.toMatch(/start-1\/2/);
  });
});

describe("the dictionary module itself obeys the house rules", () => {
  it("both halves are present, differ, and the Arabic really is Arabic", () => {
    // The global sweep in i18n.test.ts covers the whole dictionary; this is the same
    // rule asked of THIS module, so a failure names the module that broke it.
    for (const k of PEER_KEYS) {
      const e = DICT[k];
      expect(e.en.trim(), `${k}.en`).not.toBe("");
      expect(e.ar.trim(), `${k}.ar`).not.toBe("");
      expect(e.ar, `${k}: English pasted into the Arabic half`).not.toBe(e.en);
      expect(e.ar, `${k}: no Arabic script`).toMatch(/[؀-ۿ]/);
    }
    expect(PEER_KEYS.length).toBeGreaterThan(25);
  });

  it("every key is namespaced to this surface, so it cannot collide with another module", () => {
    const stray = PEER_KEYS.filter((k) => !k.startsWith("peer."));
    expect(stray, `not namespaced: ${stray.join(", ")}`).toEqual([]);
  });

  it("keys sit at the two-space indentation the duplicate-key sweep parses", () => {
    /* `i18n.test.ts` finds keys with /^\s{2}"([\w.]+)":/ and cross-checks the count
       against the composed dictionary. A key indented differently would be invisible to
       that sweep — it would not collide, it would simply stop being CHECKED for
       collisions. */
    const mod = read("client/src/app/dict/peer.ts");
    const found = [...mod.matchAll(/^\s{2}"([\w.]+)":/gm)].map((m) => m[1]);
    expect(found.sort()).toEqual([...PEER_KEYS].sort());
  });
});
