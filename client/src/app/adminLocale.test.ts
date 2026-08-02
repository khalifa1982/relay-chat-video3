/**
 * THE ADMIN CONSOLE SPEAKS ARABIC — and did not lose a safety property on the way.
 *
 * This screen can delete a person, move an account between tiers and change a 6-digit
 * number that other people have saved. A localisation sweep is exactly the change that
 * quietly drops such a decision, because nothing about which language a button is in
 * depends on whether the button still decides anything. So this file pins three
 * different kinds of property:
 *
 *   1. THE SWEEP IS COMPLETE — no user-visible English literal is left on the screen,
 *      and every key added for it actually has a reader. A dead key is worse than a
 *      missing one: it looks like coverage (the v2.106.91 finding).
 *   2. THE VOCABULARY SURVIVED — the three account tiers stay three distinct words in
 *      BOTH languages, and "delete" does not collapse into "withdraw". Two English
 *      words that mean different things must not become one Arabic word, in the
 *      language where nobody reviewing this would notice.
 *   3. NOTHING THAT DECIDES BECAME DECORATION — the typed-number delete confirmation
 *      still gates the button, and both PIN boxes are still recognisable as PIN boxes
 *      to the app-wide cap sweep in `pinInput.test.ts`.
 *
 * Every assertion is about a PROPERTY, never about a particular English literal — that
 * is the whole reason `copyOnScreen` exists, and freezing a literal here is what would
 * make the next translator's job impossible.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { codeOnly } from "../../../server/testing/codeOnly";
import { copyOnScreen, keysForEnglish } from "../../../server/testing/copyOnScreen";
import { ADMIN } from "./dict/admin";
import { DICT, translate } from "./i18n";
import { roleLabel } from "./VerifiedBadge";
import type { IdentityRole } from "./VerifiedBadge";

/* Resolved from THIS file rather than from a literal absolute path: a hardcoded
   `/home/user/...` passes on the machine it was written on and can never pass on a CI
   runner whose checkout lives elsewhere (v2.99.60, and `repoHygiene.test.ts` forbids
   it). */
const ROOT = resolve(__dirname, "../../..");
const SRC = readFileSync(resolve(ROOT, "client/src/pages/app/Admin.tsx"), "utf8");
const CODE = codeOnly(SRC);

const KEYS = Object.keys(ADMIN) as (keyof typeof ADMIN)[];

/**
 * "Is this sentence still on the screen?", widened to know about `tn`.
 *
 * A FINDING ABOUT THE SHARED HELPER, not a preference. `copyOnScreen`'s `TCALL` is
 * `\b(?:t|tr)\(` — it recognises the two spellings of the plain translator and NOT
 * `tn(`, the one that renders a sentence with a React node inside it. So a sentence
 * moved to `translateNodes` reads to that helper as GONE FROM THE SCREEN, and any pin
 * repointed through it goes red on correct source.
 *
 * That matters beyond this file: `tn` exists precisely for the sentences that are
 * hardest to translate (a bolded run in the middle, which Arabic word order does not
 * put between the same two fragments), so it is exactly the sentences most worth
 * pinning that the helper cannot see. Fixing `copyOnScreen` itself is outside this
 * screen's scope — reported instead, and worked around here by DELEGATING to it first
 * and only then checking the `tn` spelling, so this stays a strict widening rather than
 * a second implementation that could drift.
 */
function copyReaches(src: string, english: string): boolean {
  if (copyOnScreen(src, english)) return true;
  return keysForEnglish(english).some((k) =>
    new RegExp(`\\btn\\(\\s*["'\`]${k.replace(/\./g, "\\.")}["'\`]`).test(src),
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   1. THE SWEEP IS COMPLETE
   ──────────────────────────────────────────────────────────────────────────── */

/**
 * Every literal that reaches a user's eyes: JSX text nodes, the three attributes that
 * render or are announced, and toast arguments.
 *
 * DELIBERATELY NARROW. A blanket "no quoted string with letters" sweep would flag every
 * Tailwind class, every CSS value and every `=== "mesh"` comparison, and a guard that
 * cries wolf gets its exemption list widened until it covers nothing. These three
 * positions are the ones a string has to be in to be read by a person.
 */
function userFacingLiterals(src: string): string[] {
  const out: string[] = [];
  // Attributes that are rendered or announced.
  for (const m of src.matchAll(/\b(placeholder|aria-label|title)=\{?"([^"]*)"\}?/g)) {
    out.push(`${m[1]}="${m[2]}"`);
  }
  // Toast bodies.
  for (const m of src.matchAll(/toast\.(?:success|error|info|message|warning)\(\s*"([^"]*)"/g)) {
    out.push(`toast("${m[1]}")`);
  }
  /* JSX text nodes.
     THE FIRST VERSION OF THIS WAS WRONG ABOUT THE CODE and reported eight offenders on
     correct source: it matched any run between a `>` and a `<`, which in TypeScript also
     spans a generic's brackets (`useState<number | null>(null); … = useState<`) and a
     comparison. Two things make it a JSX text node rather than code: it is terminated by
     a CLOSING TAG (`</`), and prose does not contain the punctuation of an expression. */
  for (const m of src.matchAll(/>([^<>{}=;()[\]"`|&]*[A-Za-z]{3,}[^<>{}=;()[\]"`|&]*)<\//g)) {
    const text = m[1].trim();
    if (text) out.push(`text: ${text}`);
  }
  return out;
}

/**
 * The literals that are allowed to stay English, each with the reason it is not prose.
 * NAMED, never a count threshold — a tolerance of "fewer than N" is exactly how a real
 * one hides among the accepted ones.
 */
const ALLOWED = new Set([
  // A format example for an ASCII-only field, in an input that is already `dir="ltr"`.
  // Translating it would demonstrate an address shape nobody can type — so the local
  // part is LANGUAGE-NEUTRAL instead ("name", not "them"), which is what makes the
  // exemption honest rather than an English word sitting on an Arabic screen.
  'placeholder="name@example.com"',
  // A six-digit example. It must stay Western digits (a RELAY number is read aloud and
  // typed back), and `pinInput.test.ts` recognises this box BY this placeholder.
  'placeholder="777777"',
  // The literal face of the in-call button in `lib/relayAssets.ts`, which this sweep
  // does not cover. Translating the word here would send an Arabic reader looking for
  // a control whose label says "Stats".
  "text: Stats",
]);

describe("the sweep left no English on the screen", () => {
  it("every user-visible literal is either translated or a named exception", () => {
    const offenders = userFacingLiterals(CODE).filter((l) => !ALLOWED.has(l));
    expect(offenders, "route these through useT()").toEqual([]);
  });

  it("…and that sweep is not vacuous — it catches a planted string", () => {
    /* A guard that cannot fail reports safety. Proven against a synthetic sample rather
       than by mutating the real file, so it also documents what the scanner looks for. */
    const planted = `
      <input placeholder="Find a person" />
      <p>Delete this account</p>
      {toast.success("Deleted.")}
    `;
    expect(userFacingLiterals(planted).sort()).toEqual([
      'placeholder="Find a person"',
      "text: Delete this account",
      'toast("Deleted.")',
    ]);
  });

  it("the screen still SAYS the sentences it is signed off on", () => {
    /* The property those pre-existing pins always stood for: this sentence reaches this
       screen. Satisfied by a key whose English half carries it, which is strictly
       stronger than the literal was — reaching the dictionary also proves an Arabic
       half exists, because `Entry` requires both. */
    for (const sentence of [
      "Administrators only",
      "Delete this person completely. This cannot be undone.",
      "Group chats survive for their other members",
      "retired for good",
      "stay in storage and stay locked shut",
      "no more readable than before, but not erased",
      "A block anyone placed on them stays in place",
      "Delete permanently",
      "Type their 6-digit number to enable Delete.",
      "this doesn't create an account or send anything",
      "Nothing was reachable",
      "No TURN advertised",
      "WebRTC mesh in use",
      "N−1 encoders",
      "Couldn't read the media config.",
      // Rendered through `tn` — see `copyReaches` for why the shared helper cannot see
      // these two, which is the reason this list checks them at all.
      "for live round-trip, packet loss",
    ]) {
      expect(copyReaches(SRC, sentence), sentence).toBe(true);
    }
  });
});

describe("every key added for this screen has a reader", () => {
  it("no key is dead", () => {
    /* v2.106.91: an unread key is worse than a missing one because it looks like
       coverage — somebody counting keys would conclude a screen is translated when
       nothing on it is. Matched on the QUOTED key anywhere in comment-stripped source,
       which covers both `t("…")` and the `TIER_KEY` map that holds three of them as
       values. */
    const dead = KEYS.filter((k) => !CODE.includes(`"${k}"`));
    expect(dead, "these keys reach no render site").toEqual([]);
  });

  it("…and the reader count is real, not zero-of-zero", () => {
    expect(KEYS.length).toBeGreaterThan(80);
  });

  it("every key this screen references exists in the dictionary", () => {
    // `TKey` already makes this a compile error, so this is the runtime backstop for a
    // key reached through a map rather than written at the call site.
    const referenced = [...CODE.matchAll(/"(admin\.[\w.]+)"/g)].map((m) => m[1]);
    expect(referenced.length).toBeGreaterThan(80);
    for (const k of referenced) {
      expect(Object.prototype.hasOwnProperty.call(DICT, k), `${k} is not in the dictionary`).toBe(
        true,
      );
    }
  });
});

describe("both halves are real, and the Arabic is Arabic", () => {
  const ARABIC = /[؀-ۿ]/;

  it("every entry carries a non-empty English and Arabic half", () => {
    for (const k of KEYS) {
      expect(ADMIN[k].en.trim().length, k).toBeGreaterThan(0);
      expect(ADMIN[k].ar.trim().length, k).toBeGreaterThan(0);
    }
  });

  it("the Arabic half contains Arabic script, not transliteration", () => {
    for (const k of KEYS) {
      expect(ARABIC.test(ADMIN[k].ar), `${k}: "${ADMIN[k].ar}" has no Arabic script`).toBe(true);
    }
  });

  it("the Arabic half is never a copy of the English one", () => {
    // The cheap way to satisfy a both-halves check is to paste the English across.
    for (const k of KEYS) {
      expect(ADMIN[k].ar, k).not.toBe(ADMIN[k].en);
    }
  });

  it("no placeholder is dropped or invented in translation", () => {
    /* A `{name}` that exists in one half and not the other renders a literal brace on
       screen in that language, or silently loses the value. Substitution is BY NAME, so
       the two halves may order them differently — and should, where Arabic reads better
       with the verb leading — but the SET has to match. */
    const names = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const k of KEYS) {
      expect(names(ADMIN[k].ar), `${k}: placeholders differ between halves`).toEqual(
        names(ADMIN[k].en),
      );
    }
  });

  it("Arabic-Indic numerals never appear — a RELAY number is read aloud and typed back", () => {
    /* v2.106.84. Every number on this screen is interpolated, so a hard-coded ٠١٢ in a
       translation would sit beside a substituted Western digit on the same line and read
       as a rendering fault. */
    for (const k of KEYS) {
      expect(/[٠-٩۰-۹]/.test(ADMIN[k].ar), `${k} uses Arabic-Indic digits`).toBe(
        false,
      );
    }
  });

  it("the count tile renders Western digits regardless of app language", () => {
    expect(CODE).toMatch(/toLocaleString\("en-US"\)/);
  });
});

describe("the three account tiers stay three distinct things", () => {
  const TIERS: IdentityRole[] = ["guest", "registered", "admin"];

  it("each tier's ENGLISH half is exactly what roleLabel() returns", () => {
    /* The row tag and the RoleBadge beside it are the SAME fact and must not come to
       disagree about the word. `roleLabel` lives in VerifiedBadge.tsx, a shared
       component outside this screen's sweep, so it could not be translated there —
       the tier words moved into this dictionary and the agreement is held HERE.
       That is stronger than sharing the function was: this also fails if somebody
       edits VerifiedBadge's spelling. */
    expect(ADMIN["admin.tier.guest"].en).toBe(roleLabel("guest"));
    expect(ADMIN["admin.tier.registered"].en).toBe(roleLabel("registered"));
    expect(ADMIN["admin.tier.admin"].en).toBe(roleLabel("admin"));
  });

  it("the three Arabic words are distinct from each other", () => {
    /* This console's whole job is moving somebody between these tiers. Collapsing any
       two onto one Arabic word would make the segmented control read as a no-op in
       Arabic, which is the language where nobody reviewing it would notice. */
    const ar = TIERS.map((r) => translate("ar", `admin.tier.${r}` as never));
    expect(new Set(ar).size, `Arabic tiers are not distinct: ${ar.join(" / ")}`).toBe(3);
  });

  it("the row tag renders the tier through the dictionary, not finished English", () => {
    // `roleLabel()` returns English, so a row still calling it would stay English on an
    // Arabic screen — the exact defect this sweep exists to remove.
    expect(CODE).toMatch(/tierWord\(t, r\.role\)/);
    expect(CODE, "roleLabel() would render English on an Arabic screen").not.toMatch(
      /roleLabel\(/,
    );
  });
});

describe("verbs that mean different things stay different words", () => {
  it("deleting a person and withdrawing a suggestion are not the same Arabic verb", () => {
    /* One is irreversible and destroys somebody's account; the other takes back a
       suggestion and costs nobody anything. v2.105.27 established that this repo keeps
       such verbs apart in Arabic — it matters more, not less, on a console. */
    const del = translate("ar", "admin.delete.action");
    const withdraw = translate("ar", "admin.type.withdraw");
    expect(del).not.toBe(withdraw);
    expect(del).toContain("حذف");
    expect(withdraw).toContain("سحب");
  });

  it("the irreversible action says so in Arabic too", () => {
    // "This cannot be undone" is the sentence that makes the confirmation meaningful.
    // A translation that dropped it would leave the Arabic screen quietly less safe.
    expect(translate("ar", "admin.delete.warning")).toMatch(/لا يمكن التراجع/);
  });
});

describe("nothing that decides became decoration", () => {
  it("the typed-number confirmation still gates the Delete button", () => {
    /* THE ONE PROPERTY ON THIS SCREEN THAT COSTS SOMEBODY EVERYTHING IF IT BREAKS.
       Pinned as the comparison AND as its position next to `disabled`, because
       asserting the input merely exists says nothing about whether it decides
       anything — the recurring survivor class. */
    expect(CODE).toMatch(/pinDigits\(confirmNum\) !== r\.number/);
    const at = CODE.search(/pinDigits\(confirmNum\) !== r\.number/);
    expect(at).toBeGreaterThan(-1);
    expect(CODE.slice(Math.max(0, at - 200), at + 200)).toMatch(/disabled/);
    // …and never a constant.
    expect(CODE).not.toMatch(/disabled=\{(?:false|!true)\b/);
  });

  it("both PIN boxes stay recognisable to the app-wide cap sweep", () => {
    /* `pinInput.test.ts` identifies a PIN box by what it is FOR — its placeholder names
       a 6-digit number. Translating either placeholder away would silently drop this
       file out of that sweep while every assertion there stayed green, which is how an
       uncapped box becomes exempt. */
    expect(CODE).toMatch(/placeholder=\{r\.number\}/);
    expect(CODE).toMatch(/placeholder="777777"/);
    expect((CODE.match(/capPinInput\(e\.target\.value\)/g) ?? []).length).toBe(2);
    expect((CODE.match(/maxLength=\{PIN_INPUT_MAXLENGTH\}/g) ?? []).length).toBe(2);
  });

  it("the fleet card still renders exactly once, above the per-person search", () => {
    expect((CODE.match(/<MediaCheck \/>/g) ?? []).length).toBe(1);
    const mount = CODE.indexOf("<MediaCheck />");
    const search = CODE.indexOf('aria-label={t("admin.search.aria")}');
    expect(mount).toBeGreaterThan(-1);
    expect(search).toBeGreaterThan(-1);
    expect(search).toBeGreaterThan(mount);
  });

  it("the gate is still a SERVER answer", () => {
    expect(CODE).toMatch(/trpc\.admin\.amIAdmin\.useQuery/);
    expect(CODE).toMatch(/if \(!amIAdmin\.data\?\.admin\)/);
  });

  it("a server-named refusal still reaches the operator verbatim", () => {
    /* Each mutation's onError shows `e.message` and falls back to a translated string
       only when the server said nothing. Translating the SERVER's message would be
       wrong: it names which of several refusals happened, and those are different next
       steps for the operator. */
    for (const fallback of [
      "admin.type.suggestFailed",
      "admin.type.withdrawFailed",
      "admin.delete.failed",
      "admin.number.failed",
    ]) {
      expect(CODE, fallback).toMatch(
        new RegExp(`e\\.message \\|\\| t\\("${fallback.replace(/\./g, "\\.")}"\\)`),
      );
    }
  });
});

describe("right-to-left", () => {
  it("no physical spacing or edge utility is left in the markup", () => {
    /* `pl-`/`pr-`/`ml-`/`mr-`/`left-`/`right-` do not mirror, so a padded field or an
        indented list points the wrong way in Arabic. Run on comment-stripped source —
        the comments here QUOTE the classes they replaced, which is the prose trap this
        repo has hit repeatedly. */
    expect(CODE).not.toMatch(/\b(?:pl|pr|ml|mr)-[0-9.]/);
    expect(CODE).not.toMatch(/\b(?:left|right)-[0-9.]/);
    expect(CODE).not.toMatch(/\btext-(?:left|right)\b/);
  });

  it("…and the logical replacements are actually there", () => {
    // The negative above is satisfied by deleting the padding altogether, which would
    // be a layout regression rather than a fix.
    expect(CODE).toMatch(/\bstart-3\.5\b/);
    expect(CODE).toMatch(/\bps-9\b/);
    expect(CODE).toMatch(/\bpe-3\b/);
    expect(CODE).toMatch(/\bps-4\b/);
  });

  it("vertical centring stays PHYSICAL, because it is not about reading order", () => {
    // `-translate-y-1/2` is direction-independent. Rewriting it "logically" would be a
    // change that means nothing and reads as one that does.
    expect(CODE).toMatch(/top-1\/2[^"]*-translate-y-1\/2/);
  });

  it("every LTR identifier beside Arabic text is bidi-ISOLATED, not merely directed", () => {
    /* `dir="ltr"` alone sets the run's direction; without isolation the run still
       participates in the surrounding RTL paragraph and its parts reorder. A 6-digit
       number, an email, an instance id and an IP all need both. */
    const isolated = [...CODE.matchAll(/dir="ltr"/g)].length;
    expect(isolated).toBeGreaterThan(4);
    // Every `dir="ltr"` on a SPAN carries isolation, by class or by inline style.
    for (const m of CODE.matchAll(/<span([^>]*dir="ltr"[^>]*)>/g)) {
      expect(
        /unicode-bidi:isolate|unicodeBidi: "isolate"/.test(m[1]),
        `a dir="ltr" span is not isolated: ${m[1].replace(/\s+/g, " ").slice(0, 100)}`,
      ).toBe(true);
    }
  });

  it("the delete bullet's number is a NODE, so it can be isolated inside a sentence", () => {
    /* `tn`, not `t`: interpolating the number as a STRING would put six Western digits
       into an Arabic sentence with nothing to hang isolation on. Keeping the
       placeholder inside the string is also what lets Arabic put it where the language
       wants — it leads with the verb here and English does not. */
    expect(CODE).toMatch(/tn\("admin\.delete\.bulletNumber"/);
    expect(translate("ar", "admin.delete.bulletNumber")).toContain("{number}");
    expect(translate("en", "admin.delete.bulletNumber")).toContain("{number}");
  });

  it("the bolded control name in the Stats hint is a node, not a split sentence", () => {
    // Splitting as `{t(part1)}<b>Stats</b>{t(part2)}` cannot be translated: Arabic word
    // order puts the emphasised run somewhere else entirely.
    expect(CODE).toMatch(/tn\("admin\.media\.statsHint"/);
    for (const loc of ["en", "ar"] as const) {
      expect(translate(loc, "admin.media.statsHint")).toContain("{stats}");
    }
  });
});

describe("operator-facing identifiers are never translated", () => {
  it("environment variable names survive in the Arabic halves", () => {
    /* An operator types or greps these. Translating one would send them looking for a
       file that does not exist, which is the exact failure this console exists to
       prevent. */
    const cases: [keyof typeof ADMIN, string][] = [
      ["admin.pool.unconfigured", "REDIS_URL"],
      ["admin.pool.allExcluded", "VOIP_NODE_SECRET"],
      ["admin.push.fcmOnDetail", "FIREBASE_SERVICE_ACCOUNT_JSON"],
      ["admin.push.expoTokenSet", "EXPO_ACCESS_TOKEN"],
      ["admin.push.apnsOffDetail", "APNS_P8_KEY"],
      ["admin.push.apnsOffDetail", "APNS_VOIP_CERT_PEM"],
      ["admin.push.apnsOffDetail", "APNS_VOIP_KEY_PEM"],
      ["admin.push.apnsOffDetail", "APNS_VOIP_TOPIC"],
      ["admin.push.noDevicesDetail", "SET_PUSH_TOKEN"],
    ];
    for (const [key, needle] of cases) {
      expect(ADMIN[key].ar, `${key} lost ${needle}`).toContain(needle);
      expect(ADMIN[key].en, `${key} lost ${needle}`).toContain(needle);
    }
  });

  it("the pool's reasons stay five different answers, not one 'unhealthy'", () => {
    /* An empty registry and a saturated fleet are the same empty list and OPPOSITE
       jobs: telling somebody to add a node when the agent is not running has them
       launch a second box that also fails to register. */
    const reasons = [
      "admin.pool.noNodes",
      "admin.pool.allStale",
      "admin.pool.allDraining",
      "admin.pool.allExcluded",
      "admin.pool.allSaturated",
    ] as const;
    const ar = reasons.map((k) => translate("ar", k));
    expect(new Set(ar).size).toBe(reasons.length);
  });
});
