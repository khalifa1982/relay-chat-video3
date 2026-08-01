/**
 * "Is this sentence still on this screen?" — asked in a way that survives
 * localisation.
 *
 * WHY THIS EXISTS (v2.106.84)
 * ---------------------------
 * Dozens of tests in this repo pin owner-signed-off copy by searching the source
 * file for the English literal. That was exactly right while the app spoke one
 * language. The moment a string moves into the dictionary and the component
 * renders `t("login.createAccount")`, every one of those pins goes red — and the
 * two available reactions are both wrong:
 *
 *   - DELETE the pin. The copy then has no guard at all, and the owner's signed-off
 *     wording can be changed by anybody with nothing failing.
 *   - Rewrite it to look for `t("login.createAccount")`. That freezes the KEY, which
 *     is an implementation detail, and says nothing about what the words are — the
 *     Arabic could say anything and the English could be silently reworded.
 *
 * So the pin is rewritten to the PROPERTY it always stood for: this sentence reaches
 * this screen. It is satisfied either by the literal being present (a screen not yet
 * swept) or by the screen referencing a dictionary key whose ENGLISH half is that
 * sentence. That is strictly stronger than the literal check it replaces, because
 * reaching the dictionary also proves an Arabic half exists — `Entry` requires both.
 *
 * NOTHING IS RELAXED. A screen that stops saying the sentence at all still fails,
 * whichever way it is written.
 */
import { DICT } from "../../client/src/app/i18n";

/** Fold the incidental differences between a literal in JSX and one in a dictionary
 *  entry: HTML entities the JSX has to escape, and whitespace a formatter may have
 *  re-wrapped across lines. */
function normalize(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&rsquo;/g, "\u2019")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * How a translator call is spelled at a render site.
 *
 * `t` is the ordinary name. `tr` is the ALIAS a file uses when `t` would be shadowed
 * — `Messages.tsx`'s swipe-action builder binds the THREAD to `t`, so an unaliased
 * translator there would silently be a ThreadSummary rather than a function. A helper
 * that only knew `t` would report those screens as having lost their copy, which is a
 * guard crying wolf on correct code.
 */
const TCALL = "\\b(?:t|tr)\\(\\s*";

/**
 * Every dictionary key whose English half CONTAINS this text.
 *
 * Containment rather than equality, because the pins being preserved are
 * `toContain` calls and many of them quote a distinctive PREFIX of a longer
 * sentence ("Business accounts bring team lines, shared numbers and an admin
 * console" is the opening of a two-clause paragraph). Requiring equality would
 * fail those on correct code — which is the shape of a guard that cries wolf, and
 * this replacement must be no weaker AND no noisier than what it replaces.
 *
 * Usually one key; a sentence deliberately shared by two surfaces has several.
 */
export function keysForEnglish(english: string): string[] {
  const want = normalize(english);
  return Object.entries(DICT)
    .filter(([, e]) => normalize((e as { en: string }).en).includes(want))
    .map(([k]) => k);
}

/**
 * True when `src` still puts `english` on the screen — directly, or through a
 * dictionary key that carries exactly those words.
 */
export function copyOnScreen(src: string, english: string): boolean {
  if (normalize(src).includes(normalize(english))) return true;
  const keys = keysForEnglish(english);
  if (keys.length === 0) return false;
  // A key is REFERENCED, not merely mentioned: `t("key")` / `tr("key")`. A bare
  // occurrence of the string would match this file's own imports and comments.
  return keys.some((k) => new RegExp(`${TCALL}["'\`]${k.replace(/\./g, "\\.")}["'\`]`).test(src));
}

/**
 * Rewrite every `t("some.key")` in `src` to the key's ENGLISH half, so a rule that
 * reads a component's COPY keeps working after that copy moved into the dictionary.
 *
 * WHY THIS IS NEEDED AND WHY IT IS NOT OPTIONAL (v2.106.85)
 * --------------------------------------------------------
 * `copyOnScreen` answers "is this exact sentence here". Some guards are the other
 * shape: they SWEEP a file, extract every dialog, and apply a rule to whatever copy
 * they find — `systemAlerts.test.ts` requires that any confirmation whose own words
 * say the action is final also passes `destructive`. Move the words into the
 * dictionary and that sweep silently matches NOTHING: it goes green while covering
 * zero dialogs, which is strictly worse than going red, because it reports safety.
 *
 * Expanding first restores the rule over BOTH swept and unswept files — a screen that
 * still carries its literals reads unchanged, and a swept one reads as its English.
 * An unknown key expands to nothing rather than to itself, so a stale key cannot
 * satisfy a copy rule by accident.
 */
export function expandCopy(src: string): string {
  return src.replace(/\b(?:t|tr)\(\s*["'`]([\w.]+)["'`]\s*(?:,[^)]*)?\)/g, (whole, key: string) => {
    const e = DICT[key as keyof typeof DICT] as { en: string } | undefined;
    return e ? e.en : whole;
  });
}

/** `expect`-friendly wrapper that names the failure usefully: whether the sentence
 *  is missing from the dictionary too, or merely not referenced here. */
export function whyCopyMissing(src: string, english: string): string {
  if (copyOnScreen(src, english)) return "";
  const keys = keysForEnglish(english);
  return keys.length === 0
    ? `"${english}" is neither in the source nor in the dictionary — the copy is gone`
    : `"${english}" is in the dictionary as ${keys.join("/")} but this screen does not render it`;
}
