/**
 * IS THIS QUERY A NUMBER? — one rule, both sides of the wire.
 *
 * The owner's ask is that every search box works "either by name or by pin number,
 * anywhere and the entire system by these two methods". The client half has had this
 * since v2.99.96 (`client/src/app/searchMatch.ts`); the ADMIN PANEL's server-side
 * search did not, and tested `/^\d{6}$/` against the RAW query — so `777-777`, the
 * exact form the app itself renders and the owner types, matched nothing and fell
 * through to a LIKE over email and display name, which cannot match a number either.
 *
 * ── WHY THIS MOVED TO `shared/` RATHER THAN BEING RE-IMPLEMENTED ─────────────
 * A second copy is the defect this repo keeps paying for: `turn-check.mjs` vs
 * `iceServers()` (v2.99.71), the client token classifier vs the server's
 * (v2.105.11). Here a divergence would mean the admin panel and every other search
 * box disagreeing about whether `777 777` is a number — invisible until somebody
 * cannot find a user they can see on screen.
 *
 * `client/src/app/searchMatch.ts` RE-EXPORTS these, so every existing import is
 * unchanged and there is exactly one definition.
 */

/** Every digit in the string, in order. Nothing else. */
export function digitsOf(s: string | null | undefined): string {
  return (s ?? "").replace(/[^0-9]/g, "");
}

/**
 * Is this query a NUMBER search? Only when it holds a digit and nothing that looks
 * like a name — otherwise "7th floor" would be read as the number 7.
 *
 * Accepts the separators people and phones actually use, including the grouping this
 * app itself renders, because refusing the app's own format back is rude.
 */
export function isNumberQuery(query: string | null | undefined): boolean {
  const q = (query ?? "").trim();
  if (!q) return false;
  return /^[0-9\s\-.()+]+$/.test(q) && digitsOf(q).length > 0;
}

/**
 * The 6-digit RELAY number a query names, or null.
 *
 * Deliberately requires EXACTLY six digits: a prefix search is a different operation
 * (the suggestion pickers do that on purpose), and an admin looking somebody up by
 * number means that number. Anything shorter or longer is a name search.
 */
export function pinFromQuery(query: string | null | undefined): string | null {
  if (!isNumberQuery(query)) return null;
  const d = digitsOf(query);
  return d.length === 6 ? d : null;
}
