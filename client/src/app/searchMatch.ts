/**
 * ONE matching rule for every search box in the app (v2.99.96).
 *
 * Owner: *"the search anywhere in the system, either by call, by history, by message,
 * contact. Whenever I put the keywords either by words, single words, it will deduct
 * anything on that single word. Let's say if a name, it will deduct on the names
 * first, second, third. This is how it works. Or if I put a number, it will deduct the
 * number. So make sure that the search is properly working because currently, I put
 * the words doesn't deduct hundred percent."*
 *
 * Before this there was no shared primitive at all: four screens each hand-rolled
 * `oneJoinedString.toLowerCase().includes(query.toLowerCase())`, which fails in four
 * mechanical ways the owner would experience as "doesn't detect 100%":
 *
 *   1. IT IS A CONTIGUOUS SUBSTRING TEST. A query whose words are not adjacent in the
 *      stored name can never match — "khalifa ali" misses "Khalifa Mohamed Ali", and
 *      any reversed order misses too. That is exactly the "first, second, third" ask.
 *   2. THE NUMBER WAS NOT DIGIT-FOLDED on Contacts or the group picker, while the same
 *      rows DISPLAY it as `777-777`. Searching the string the app itself puts on
 *      screen matched nothing.
 *   3. NO DIACRITIC FOLDING, so "jose" missed "José".
 *   4. EACH SURFACE SEARCHED A DIFFERENT NAME and none searched first/last, so a
 *      person findable on one screen was unfindable on another.
 *
 * TWO DECISIONS WORTH KNOWING:
 *
 * FIELDS ARE COMPARED SEPARATELY, never pre-joined into one haystack. History used to
 * glue every field's digits together and strip non-digits from the result, so a digit
 * run SPANNING two fields matched — a false positive that looks like a bug in the
 * other direction.
 *
 * INFIX IS KEPT, not narrowed to word-start. The suggestion list in
 * `contactSuggest.ts` is word-start only, and adopting that here would REGRESS the
 * main lists: today "hammadi" does find "Alhammadi", and taking that away to satisfy
 * the letter of "first, second, third" would remove a match people rely on. The
 * complaint is under-matching, so loose is the safer direction — and it means "ali"
 * also matches "Khalifa", which is accepted rather than overlooked.
 */

import { digitsOf, isNumberQuery, pinFromQuery } from "../../../shared/searchNumber";

/** Fold case and strip diacritics, so "alv" reaches "Ålvaro" and "jose" reaches "José". */
export function foldText(s: string | null | undefined): string {
  return (s ?? "")
    .normalize("NFD")
    // eslint-disable-next-line no-misleading-character-class
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/* THE NUMBER RULE MOVED TO `shared/searchNumber.ts` (2026-08-01) and is re-exported
   here, so every existing import is unchanged and there is exactly ONE definition.

   The admin panel's server-side search needs the same rule and had its own — it
   tested `/^\d{6}$/` against the RAW query, so `777-777`, the form the app itself
   renders and the owner types, matched nothing. A second copy of one rule is the
   two-gates-disagree defect this repo keeps paying for (v2.99.71's TURN checker,
   v2.105.11's token classifier), and `shared/` is where a rule both sides need
   belongs. */
export { digitsOf, isNumberQuery, pinFromQuery };

/** Split a query into the words a person meant, keeping hyphenated names whole. */
export function tokenize(query: string | null | undefined): string[] {
  return foldText(query)
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/** Does ONE field satisfy ONE query token? */
function fieldMatchesToken(field: string | null | undefined, token: string): boolean {
  if (!field) return false;
  if (foldText(field).includes(token)) return true;
  // A digit-SHAPED token also matches the field's digits, so "777" finds 777-777 and
  // "12" finds a contact called "Flat 12" — the name branch is never short-circuited
  // by the number branch, because both are legitimate readings of the same keystrokes.
  //
  // `isNumberQuery` and not merely "contains a digit": an earlier cut pulled the
  // digits out of ANY token, so typing "7th" extracted "7" and matched every contact
  // whose number contains a seven — which is most of them. A name search that returns
  // the whole list is worse than one that returns nothing, and it is the same
  // over-matching trap as a two-letter infix (v2.99.80). Caught by this release's own
  // test.
  if (isNumberQuery(token)) {
    const t = digitsOf(token);
    if (t && digitsOf(field).includes(t)) return true;
  }
  return false;
}

/**
 * Does this record match what was typed?
 *
 * EVERY query token must match SOME field, and different tokens may match different
 * fields — so "khalifa 777" finds the person whose name matches one and whose number
 * matches the other. An empty query matches everything, so a filter built on this
 * hides nothing before the user has typed.
 */
export function matchQuery(query: string | null | undefined, fields: Array<string | null | undefined>): boolean {
  const q = (query ?? "").trim();
  if (!q) return true;

  /* THERE IS DELIBERATELY NO SEPARATE WHOLE-QUERY NUMBER BRANCH, and that is a
     correction the mutation run forced.

     The first cut had one: fold the entire query to digits and compare it against each
     field before tokenising. Deleting it changed no behaviour at all, and deleting the
     per-token digit rule below changed no behaviour either — each survived only
     because the other covered it. Two mechanisms that are individually removable are
     not defence in depth, they are dead weight that reads as load-bearing, so the
     redundant one is gone and the remaining one is now genuinely load-bearing.

     `777-777` still works because it tokenises to ONE number-shaped token, and
     `777 777` works because each of its two tokens matches the field's digits. */
  const tokens = tokenize(q);
  if (tokens.length === 0) return true;
  return tokens.every((t) => fields.some((f) => fieldMatchesToken(f, t)));
}
