/**
 * #117 — HOW THE CALL LOG REACHES PAST ITS NEWEST PAGE.
 *
 * Search and per-person grouping could only ever see the most recent 100 calls, because
 * both payloads are hard-capped there and nothing could ask for more. This is the client
 * half: the newest page stays POLLED (so an ordinary History tab costs exactly what it
 * cost before), and older pages are fetched only when asked for and then KEPT.
 *
 * The merge is a pure function precisely so it can be tested without a database or a
 * browser — the ordering and the de-duplication are where this goes wrong, and both are
 * invisible in a source pin.
 */

/** The two shapes this pages over share only an `id`, which is all the merge needs. */
export type HasId = { id: number };

/**
 * Merge the polled newest page with every older page already loaded.
 *
 * DE-DUPLICATES BY ID, and that is load-bearing rather than defensive: the newest page is
 * refetched every 30s while the older pages are frozen, so a row can legitimately appear
 * in both — the cursor is exclusive, but a call that ended between two fetches shifts
 * what "the newest 100" contains, and React would then render two rows with the same key.
 *
 * THE NEWEST PAGE WINS on a collision, because it is the one that was just refetched: an
 * older page is a snapshot and may hold a stale copy of the same row.
 *
 * SORTED BY ID DESCENDING at the end rather than trusting concatenation order. The server
 * orders each page, but the pages are fetched independently and a late-arriving page must
 * not be able to put an older call above a newer one.
 */
export function mergeHistoryPages<T extends HasId>(newest: readonly T[], older: readonly T[][]): T[] {
  const byId = new Map<number, T>();
  // Older first, so the newest page's copy overwrites a stale one.
  for (const page of older) for (const row of page) byId.set(row.id, row);
  for (const row of newest) byId.set(row.id, row);
  return Array.from(byId.values()).sort((a, b) => b.id - a.id);
}

/**
 * The cursor for the NEXT older page: the smallest id we hold.
 *
 * The smallest, not the last element — see the sort above. Taking `rows[rows.length - 1]`
 * would be correct only while every page is perfectly ordered and complete, and would
 * silently re-request the same page forever the moment it was not.
 *
 * Null when we hold nothing, which is the honest answer: there is no "older than"
 * without a row to be older than, and asking with no cursor would re-fetch page one.
 */
export function oldestCursor(rows: readonly HasId[]): number | null {
  let min: number | null = null;
  for (const r of rows) if (min == null || r.id < min) min = r.id;
  return min;
}

/**
 * Is there more to load?
 *
 * DERIVED FROM THE PAGE BEING FULL rather than from a server-supplied flag, and that is a
 * deliberate wire decision: both procedures return a bare ARRAY, and changing them to
 * `{rows, hasMore}` would break every client mid-rolling-deploy — an older bundle would
 * receive an object where it expects an array and render an empty log for ~60s. The
 * additive reading costs one over-optimistic case (a final page that is exactly full,
 * whose "load older" then returns nothing and settles the question), which is cosmetic
 * and self-correcting.
 */
export function pageLooksFull(rows: readonly unknown[] | undefined, page: number): boolean {
  return !!rows && rows.length >= page;
}

/** The page size the server uses. Kept here so the client's "is it full" test and the
 *  server's LIMIT cannot drift; a test cross-checks them against each other. */
export const HISTORY_PAGE = 100;
