import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { codeOnly } from "../../../../server/testing/codeOnly";
import { DICT } from "@/app/i18n";
import { timeAgoKey } from "./Status";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const src = read("client/src/pages/app/Status.tsx");

/**
 * Rich user status client (v2.95) — story strip, composer, and full-screen
 * viewer. No DOM test env, so wiring is source-pinned.
 */
describe("Status client", () => {
  it("exports the strip + full-screen viewer", () => {
    expect(src).toMatch(/export function StatusStrip\(/);
    expect(src).toMatch(/export function StatusViewer\(/);
  });

  it("drives the status tRPC surface", () => {
    for (const call of [
      /trpc\.status\.feed\.useQuery/,
      /trpc\.status\.post\.useMutation/,
      /trpc\.status\.markViewed\.useMutation/,
      /trpc\.status\.remove\.useMutation/,
      /trpc\.status\.viewers\.useQuery/,
    ]) {
      expect(src).toMatch(call);
    }
  });

  it("uploads media via the no-row status helper before posting", () => {
    expect(src).toMatch(/uploadStatusMedia\(file/);
    // media kinds resolve to the four status kinds
    expect(src).toMatch(/"image"|"video"|"audio"/);
  });

  it("supports all four kinds (text with a bg + the three media types)", () => {
    expect(src).toMatch(/kind === "text"/);
    expect(src).toMatch(/BG_OPTIONS/);
    expect(src).toMatch(/kind === "image"/);
    expect(src).toMatch(/kind === "video"/);
    expect(src).toMatch(/kind === "audio"/);
  });

  it("auto-advances the story and marks each item viewed", () => {
    expect(src).toMatch(/requestAnimationFrame/);
    expect(src).toMatch(/markViewed\.mutate\(\{ id: item\.id \}\)/);
  });

  it("is mounted at the top of the Messages tab", () => {
    const msgs = read("client/src/pages/app/Messages.tsx");
    expect(msgs).toMatch(/import \{ StatusStrip \}/);
    expect(msgs).toMatch(/<StatusStrip[\s/]/);
  });
});

/**
 * THE STORIES SCREEN SPEAKS ARABIC (#156).
 *
 * v2.106.90's note claimed this screen was swept, and it was swept in part: about a
 * third of it still rendered English literals, including a ternary with one branch
 * translated and one not (`posting ? t("status.posting") : "Share story"`). These pin
 * the two things a partial sweep gets wrong — a string left behind, and a sentence
 * assembled from fragments so that no translation of it can be correct.
 */
describe("the stories screen renders through the dictionary", () => {
  const CODE = codeOnly(src);

  it("has NO English copy left in the composer, the viewer or the reply bar", () => {
    /* A SWEEP rather than a list, so the string somebody adds NEXT is covered instead
       of exempt. `codeOnly` first: the comments on this screen legitimately quote the
       English they replaced, which is the prose trap this repo has hit nineteen times. */
    const offenders: string[] = [];
    /* THE JSX TEXT RULE IS PUNCTUATION- AND LENGTH-BLIND, and both corrections were
       forced by mutations that SURVIVED the first version. It used to require a capital
       followed by at least one more word from a class of letters, apostrophes and
       commas, which missed two whole shapes: a single word ("Viewers", "Delete") and a
       sentence whose last token ends in punctuation. A sweep with holes exactly where
       the copy is reports coverage it does not have. This takes any run of text between
       tags and asks whether it reads as prose; the code-shaped filter keeps TypeScript
       generics and expressions out, since `ReturnType<…>` is angle brackets around text
       too. */
    for (const m of CODE.matchAll(/>([^<>{}]+)</g)) {
      const text = m[1].replace(/\s+/g, " ").trim();
      if (/[=;:[\]|]/.test(text)) continue; // an expression, not prose
      if (!/[A-Za-z]{2}\s+[A-Za-z]{2}|^[A-Z][A-Za-z'-]{2,}$/.test(text)) continue;
      offenders.push(text);
    }
    for (const re of [
      // Quoted copy inside a placeholder / aria-label / title / toast.
      /(?:placeholder|aria-label|title)=\{?"([^"]*[a-z] [a-z][^"]*)"/g,
      /toast\.(?:success|error)\(\s*[`"]([^`"]{6,})[`"]/g,
      /* A user-facing LABEL on a module-level constant. Added because board 4b's tab
         row arrived carrying `label: "Photo"` and every rule above walked straight
         past it: a constant cannot call a hook, so its words hide from a sweep that
         only looks at JSX. Such a constant carries a `labelKey` instead — the pattern
         `PROFILE_STATUS_META` and `CATEGORY_META` already use.

         It flags a WORD, never a KEY: `AUDIENCE_KEYS` legitimately has a `label:` field
         whose value is `status.audContacts`, and a rule that could not tell the two
         apart would report the translated case as the untranslated one. A dictionary
         key is dotted and has no spaces; copy is the opposite. */
      /\blabel:\s*"((?![\w]+\.[\w]+")[^"]+)"/g,
    ]) {
      for (const m of CODE.matchAll(re)) offenders.push(m[1]);
    }
    expect(
      offenders,
      `these still render English rather than a key:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("a key that reaches a prop is TRANSLATED, never passed through raw", () => {
    /* The pin-the-declaration-not-the-use gap, found by mutation: naming `labelKey` on
       a constant proves nothing about whether the render site resolves it, and
       `label={m.labelKey}` would put the dotted key itself on screen — the one failure
       mode `translate()` refuses to produce (it falls back to English, never the key).
       So every `labelKey` reaching a JSX attribute must be wrapped. */
    const raw = [...CODE.matchAll(/=\{([\w.]*labelKey)\}/g)].map((m) => m[1]);
    expect(raw, `these pass a key straight to a prop: ${raw.join(", ")}`).toEqual([]);
    expect(CODE).toMatch(/label=\{t\(m\.labelKey\)\}/);
  });

  it("the SEND button is translated on BOTH arms of its ternary", () => {
    /* The exact defect: `posting ? t("status.posting") : (<>… Share story</>)`. One arm
       reached the dictionary and the other did not, which is invisible in any sweep that
       counts `t(` calls rather than looking at what is left.

       PINNED AS THE PROPERTY, NOT THE ARRANGEMENT — and that correction was earned. The
       first version froze the whole JSX expression including where the `<Send/>` glyph
       sits, and it broke within the hour when board 4b restructured that button, while
       saying nothing about whether either arm had lost its translation. What matters is
       that the ternary's TWO ARMS BOTH reach the dictionary and neither is a literal. */
    const ternary = CODE.slice(CODE.indexOf('posting ? t("status.posting")'));
    expect(ternary.length, "the send button still branches on `posting`").toBeGreaterThan(0);
    const arms = ternary.slice(0, ternary.indexOf("</Button>"));
    expect(arms).toMatch(/t\("status\.posting"\)/);
    expect(arms).toMatch(/t\("status\.shareStory"\)/);
    /* …and neither arm carries a bare English word. TAGS AND ATTRIBUTES ARE STRIPPED
       FIRST — the arm legitimately contains `<Send className="size-4" />`, and a naive
       "two words in a row" check reads `Send className` as copy, which is a guard crying
       wolf on correct markup. What is left after the tags go is the TEXT a person
       reads. */
    const prose = arms
      .replace(/\{?\s*(?:t|tn)\("[\w.]+"[^)]*\)\s*\}?/g, "")
      .replace(/<[^>]*>/g, "");
    expect(prose, `a bare English word survives in the send button: ${prose.trim()}`).not.toMatch(
      /[A-Za-z]{2}\s+[A-Za-z]{2}/,
    );
  });

  it("says STORY, never STATUS, in what a person reads", () => {
    /* v2.101.0's correction, carried into the words that MOVED. Two of this screen's
       strings were still wrong — a toast built with a TEMPLATE literal and a bare JSX
       text node — and both were outside `storyVsStatus.test.ts`'s window, which reads
       only double-quoted title/placeholder/aria-label/toast literals. Asserting it on
       the dictionary instead covers both halves in both languages. */
    for (const key of ["status.postedContacts", "status.postedEveryone", "status.postedGroup", "status.expired"] as const) {
      const e = DICT[key];
      expect(e, key).toBeTruthy();
      expect(e.en.toLowerCase(), `${key} must not call a story a status`).not.toContain("status");
    }
    expect(DICT["status.expired"].en).toContain("story");
  });

  it("keeps «قصة» for the post and never lends it to the profile label", () => {
    /* The owner corrected story-vs-status three times. The Arabic is where that
       correction is undone silently, so the two vocabularies are asserted apart:
       nothing under `profileStatus.*` may borrow the story word, and the profile
       labels keep their own (`peer.profileStatus.*`, reused rather than copied). */
    /* THE STEM «قص», not the bare noun «قصة» — and getting that wrong was a real bug in
       the first version of this test. Arabic attaches the possessive as a SUFFIX, and
       doing so converts the tāʾ marbūṭa: «قصة» + ي is «قصتي», which does not contain
       «قصة» as a substring at all. A test written against the bare noun would have
       passed over every inflected form, i.e. over most of the ways the word actually
       appears. */
    for (const [k, e] of Object.entries(DICT)) {
      if (!k.startsWith("profileStatus.")) continue;
      expect((e as { ar: string }).ar, `${k} must not borrow the story word`).not.toContain("قص");
    }
    // …and the story keys really do use it, so this is not vacuously true — in both the
    // bare form and the suffixed one, so the stem check is exercised by each.
    expect(DICT["status.newStory"].ar).toContain("قصة");
    expect(DICT["status.myStory"].ar).toContain("قص");
    expect(DICT["status.myStory"].ar).not.toContain("قصة");
  });

  it("selects a WHOLE key per relative-time band, never a stem plus a unit", () => {
    /* `${n} + "m ago"` is a sentence assembled from a fragment. English gets away with
       it because its abbreviated unit does not inflect; Arabic counts in five bands and
       would need a key each. Driven, because which band a duration selects is exactly
       what a source pin cannot answer. */
    const now = Date.UTC(2026, 0, 2, 12, 0, 0);
    const at = (secondsAgo: number) => new Date(now - secondsAgo * 1000);
    expect(timeAgoKey(at(0), now).key).toBe("status.justNow");
    expect(timeAgoKey(at(59), now).key).toBe("status.justNow");
    expect(timeAgoKey(at(60), now)).toEqual({ key: "status.minutesAgo", count: 1 });
    expect(timeAgoKey(at(59 * 60), now)).toEqual({ key: "status.minutesAgo", count: 59 });
    expect(timeAgoKey(at(3600), now)).toEqual({ key: "status.hoursAgo", count: 1 });
    expect(timeAgoKey(at(86_399), now)).toEqual({ key: "status.hoursAgo", count: 23 });
    expect(timeAgoKey(at(86_400), now)).toEqual({ key: "status.daysAgo", count: 1 });
    expect(timeAgoKey(at(86_400 * 9), now)).toEqual({ key: "status.daysAgo", count: 9 });
  });

  it("every band's Arabic unit is INVARIANT, which is why one key each is enough", () => {
    /* The load-bearing half of the decision above. If a band's Arabic spelled the unit
       out («دقيقة» / «دقائق») it would inflect with the count and one key could not
       serve 1, 2, 3–10 and 11+ — the `guestExpiryKey` situation. The abbreviations do
       not inflect, exactly as the English "m"/"h"/"d" do not. */
    for (const [key, unit] of [
      ["status.minutesAgo", "د"],
      ["status.hoursAgo", "س"],
      ["status.daysAgo", "ي"],
    ] as const) {
      const ar = DICT[key].ar;
      expect(ar, key).toContain("{count}");
      expect(ar, key).toContain(unit);
      // The spelled-out forms are what would have needed five keys apiece.
      for (const inflecting of ["دقيقة", "دقائق", "ساعة", "ساعات", "يوم", "أيام"]) {
        expect(ar, `${key} must not spell the unit out`).not.toContain(inflecting);
      }
    }
  });

  it("the audience words are keyed on the option's VALUE and fail closed", () => {
    /* `statusAudience.ts` is a module-level constant and cannot call a hook, so it
       carries the English and the KEY is named here — the `labelKey` pattern. Keyed on
       the value rather than looked up by the English text, or a copy edit silently drops
       the translation. And an unrecognised value must resolve to the PRIVATE option,
       exactly as `audienceOption` does: labelling it as the wider one would tell
       somebody their story is more visible than it is. */
    expect(CODE).toMatch(/const AUDIENCE_KEYS: Record<\s*\n?\s*StatusAudience,/);
    expect(CODE).toMatch(/return v === "everyone" \? AUDIENCE_KEYS\.everyone : AUDIENCE_KEYS\.contacts;/);
    for (const value of ["everyone", "contacts"] as const) {
      for (const slot of ["label", "hint", "posted"] as const) {
        const key = AUDIENCE_KEYS_EXPECTED[value][slot];
        expect(DICT[key as keyof typeof DICT], `${value}.${slot}`).toBeTruthy();
      }
    }
  });

  it("the picker's chip and the viewer's footer read the SAME keys", () => {
    // Two maps would be two lists to keep in step, and the composer and the viewer
    // would come to describe one setting with two different words.
    expect((CODE.match(/AUDIENCE_KEYS\[opt\.value\]/g) ?? []).length).toBe(2);
    expect(CODE).toMatch(/t\(audienceKeys\(item\.audience\)\.label\)/);
    expect(CODE).toMatch(/t\(audienceKeys\(item\.audience\)\.hint\)/);
  });

  it("no loop variable shadows the translator", () => {
    /* The group list used to bind the THREAD to `t`, so `t("…")` inside it would have
       been a ThreadSummary rather than a function — the collision `dict/messages.ts`
       records. The loop variable is renamed rather than the translator aliased. */
    expect(CODE).not.toMatch(/\.(?:filter|map)\(\(t\) =>/);
  });
});

const AUDIENCE_KEYS_EXPECTED = {
  contacts: {
    label: "status.audContacts",
    hint: "status.audContactsHint",
    posted: "status.postedContacts",
  },
  everyone: {
    label: "status.audEveryone",
    hint: "status.audEveryoneHint",
    posted: "status.postedEveryone",
  },
} as const;
