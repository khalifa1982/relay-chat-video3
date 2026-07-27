/**
 * Find a contact from what somebody has started typing (v2.99.93).
 *
 * Owner: start a new conversation "by first digit or first letter" — type `7` and
 * see everyone whose number starts with 7, type `k` and see everyone called K‑
 * something. Before this the New-conversation field stripped every non-digit, so a
 * name could not be typed at all and you had to know the six digits by heart.
 *
 * TWO RULES, PICKED BY WHAT WAS TYPED, because they answer different questions:
 *
 *   digits  → the number STARTS WITH them. Not "contains": a 6-digit number has no
 *             meaningful interior, and `55` matching 155234 would put a stranger
 *             above the person you were actually dialling.
 *   letters → any WORD of the name starts with them, so "ham" finds "Khalifa
 *             Alhammadi" — people search by surname as readily as by first name.
 *
 * NEVER AN INFIX ON A SHORT QUERY. One or two letters inside a word matches most of
 * a contact list, which is indistinguishable from no filter at all — the lesson from
 * the v2.99.80 emoji catalogue, where a two-letter infix returned the whole set.
 *
 * Pure and injectable so the ranking can be tested without a DOM: a source pin
 * cannot tell you whether typing `7` actually surfaces 777777.
 */
export interface SuggestableContact {
  number: string;
  displayName?: string | null;
  /** Contacts YOU blocked are withheld — see below. */
  blocked?: boolean | null;
  favorite?: boolean | null;
  isOnline?: boolean | null;
  avatarUrl?: string | null;
}

/* The text primitives moved to `searchMatch.ts` in v2.99.96, when the main search
 * boxes needed the same folding and digit rules. They are re-exported here so every
 * existing caller and pin keeps working — the point is that there is now exactly ONE
 * implementation of "fold this name" and "what digits did they type", not two that
 * can drift apart. */
import { digitsOf, foldText, isNumberQuery } from "./searchMatch";

export { digitsOf, isNumberQuery };
/** Fold case and strip diacritics, so "Ålvaro" is reachable by typing "alv". */
export const foldName = foldText;

export function suggestContacts(
  contacts: SuggestableContact[],
  query: string,
  limit = 6
): SuggestableContact[] {
  const list = (contacts || []).filter(
    // A contact YOU blocked is withheld. Offering to start a conversation with
    // somebody you deliberately blocked is a mis-suggestion — and unblocking is a
    // decision to make in Contacts, on purpose, not by autocomplete.
    (c) => c && /^\d{6}$/.test(c.number) && !c.blocked
  );
  const q = (query || "").trim();
  if (!q) {
    // Nothing typed: the most useful default is who you talk to, so favourites
    // first, then whoever is online.
    return [...list]
      .sort(
        (a, b) =>
          Number(!!b.favorite) - Number(!!a.favorite) ||
          Number(!!b.isOnline) - Number(!!a.isOnline) ||
          foldName(a.displayName || a.number).localeCompare(foldName(b.displayName || b.number))
      )
      .slice(0, limit);
  }

  if (isNumberQuery(q)) {
    const d = digitsOf(q);
    return list
      .filter((c) => c.number.startsWith(d))
      .sort((a, b) => a.number.localeCompare(b.number))
      .slice(0, limit);
  }

  const needle = foldName(q);
  if (!needle) return [];
  const scored: Array<{ c: SuggestableContact; rank: number }> = [];
  for (const c of list) {
    const name = foldName(c.displayName || "");
    if (!name) continue;
    // Rank 0 — the whole name starts with it: the most likely intent.
    // Rank 1 — a LATER word starts with it (a surname).
    // Anything else is not a match at all.
    if (name.startsWith(needle)) {
      scored.push({ c, rank: 0 });
      continue;
    }
    const words = name.split(/\s+/).slice(1);
    if (words.some((w) => w.startsWith(needle))) scored.push({ c, rank: 1 });
  }
  return scored
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        Number(!!b.c.favorite) - Number(!!a.c.favorite) ||
        foldName(a.c.displayName || "").localeCompare(foldName(b.c.displayName || ""))
    )
    .map((s) => s.c)
    .slice(0, limit);
}
