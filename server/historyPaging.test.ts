/**
 * #117 — the call log reaches past its newest page.
 *
 * Both payloads were hard-capped at 100 rows with no way past them, so search and
 * per-person grouping could only ever see the most recent 100 calls; an older call was
 * unfindable however good the matcher was (flagged in v2.99.96 and again in v2.99.98).
 *
 * TWO PROPERTIES CARRY THE WHOLE CHANGE, and everything here protects one of them:
 *   1. The POLLED page size is unchanged. Both queries refetch every 30s for every open
 *      History tab, so a bigger default would multiply that traffic for everybody to
 *      serve a search almost nobody runs.
 *   2. The cursor is an ID, never an offset. This table grows at the TOP, so an offset
 *      SKIPS a row whenever a call ends between two pages — silently, and exactly the
 *      row somebody was paging to find.
 */
import { describe, expect, it } from "vitest";
import { copyOnScreen, whyCopyMissing } from "./testing/copyOnScreen";
import { translate } from "../client/src/app/i18n";
import { loadedCountKey } from "../client/src/pages/app/History";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  mergeHistoryPages,
  oldestCursor,
  pageLooksFull,
  HISTORY_PAGE,
} from "../client/src/app/historyPages";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const DB = read("server/v2db.ts");
const ROUTERS = read("server/v2routers.ts");
const HISTORY = read("client/src/pages/app/History.tsx");

/** Comment-stripped source — this repo has matched its own prose 17+ times. */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*)/.test(l))
    .join("\n");
}

/** A function's BODY, with the brace scan seeded from the anchor so an anchor that
 *  already contains `(` cannot make the parameter object read as the body. */
function fnAt(src: string, decl: string): string {
  const i = src.indexOf(decl);
  expect(i).toBeGreaterThan(-1);
  const seed = (o: string, c: string) => decl.split(o).length - decl.split(c).length;
  let par = seed("(", ")"), ang = seed("<", ">"), start = -1;
  for (let j = i + decl.length; j < src.length; j++) {
    const ch = src[j];
    if (ch === "(") par++;
    else if (ch === ")") par--;
    else if (ch === "<") ang++;
    else if (ch === ">") ang--;
    else if (ch === "{" && par === 0 && ang <= 0) { start = j; break; }
  }
  expect(start).toBeGreaterThan(-1);
  let d = 0;
  for (let j = start; j < src.length; j++) {
    if (src[j] === "{") d++;
    else if (src[j] === "}" && --d === 0) return src.slice(start, j + 1);
  }
  throw new Error("unbalanced: " + decl);
}

const row = (id: number, extra: Record<string, unknown> = {}) => ({ id, ...extra });

describe("mergeHistoryPages", () => {
  it("returns newest-first regardless of the order pages arrive in", () => {
    // The server orders each page, but pages are fetched independently — a late page
    // must not be able to put an older call above a newer one.
    const merged = mergeHistoryPages([row(9), row(8)], [[row(3), row(2)], [row(6), row(5)]]);
    expect(merged.map((r) => r.id)).toEqual([9, 8, 6, 5, 3, 2]);
  });

  it("DE-DUPLICATES by id — the newest page and an older one can overlap", () => {
    /* Load-bearing rather than defensive: the newest page refetches every 30s while
       older pages are frozen, so a call ending between fetches shifts what "the newest
       100" contains. Without this React renders two rows with the same key. */
    const merged = mergeHistoryPages([row(5), row(4)], [[row(4), row(3)]]);
    expect(merged.map((r) => r.id)).toEqual([5, 4, 3]);
  });

  it("the NEWEST page wins a collision, because it was just refetched", () => {
    // An older page is a snapshot and may hold a stale copy of the same row.
    const merged = mergeHistoryPages(
      [row(4, { status: "missed" })],
      [[row(4, { status: "initiated" })]],
    );
    expect(merged).toHaveLength(1);
    expect((merged[0] as { status: string }).status).toBe("missed");
  });

  it("handles the empty cases without inventing rows", () => {
    expect(mergeHistoryPages([], [])).toEqual([]);
    expect(mergeHistoryPages([row(1)], [])).toHaveLength(1);
    expect(mergeHistoryPages([], [[row(1)]])).toHaveLength(1);
  });
});

describe("oldestCursor", () => {
  it("is the SMALLEST id held, not the last element", () => {
    /* Taking `rows[rows.length - 1]` is correct only while every page is perfectly
       ordered and complete, and would silently re-request the same page forever the
       moment it was not. */
    expect(oldestCursor([row(9), row(2), row(7)])).toBe(2);
  });

  it("is null when we hold nothing", () => {
    // There is no "older than" without a row to be older than, and asking with no
    // cursor would re-fetch page one.
    expect(oldestCursor([])).toBeNull();
  });
});

describe("pageLooksFull", () => {
  it("a full page means there MAY be more", () => {
    expect(pageLooksFull(Array.from({ length: HISTORY_PAGE }, (_, i) => i), HISTORY_PAGE)).toBe(true);
  });
  it("a short page means there is not", () => {
    expect(pageLooksFull([1, 2, 3], HISTORY_PAGE)).toBe(false);
  });
  it("no data at all is not 'more'", () => {
    // Undefined is a query that has not answered; claiming more would render a control
    // that cannot work yet.
    expect(pageLooksFull(undefined, HISTORY_PAGE)).toBe(false);
    expect(pageLooksFull([], HISTORY_PAGE)).toBe(false);
  });
  it("the client's page size matches the server's LIMIT", () => {
    // Two numbers is how "is it full" and the actual limit come to disagree, which
    // reads as a Load-older button that never stops appearing.
    expect(HISTORY_PAGE).toBe(100);
    expect(code(ROUTERS)).toMatch(/const HISTORY_PAGE = 100;/);
  });
});

describe("the server pages on a CURSOR, never an offset", () => {
  it("the 1:1 log filters on id, strictly less than", () => {
    const fn = fnAt(DB, "export async function listCallHistory");
    expect(fn).toMatch(/before \? lt\(callHistory\.id, before\) : undefined/);
    // An offset would be the wrong tool on a table that grows at the top.
    expect(fn).not.toMatch(/\.offset\(/);
  });

  it("the conference log's cursor is applied to the PARTICIPANT query", () => {
    /* The subtlety worth pinning: the LIMIT applies to my participant rows, not to
       conferences, so filtering the SECOND query would page nothing — the first would
       still hand back the newest `limit` participants every time. It is also the only
       cursor the client can express, since it only ever sees conference ids. */
    const fn = fnAt(DB, "export async function listConferenceHistory");
    const parts = fn.slice(0, fn.indexOf("const confIds"));
    expect(parts.length).toBeGreaterThan(120);
    expect(parts).toMatch(/before \? lt\(conferenceParticipants\.conferenceId, before\) : undefined/);
    expect(fn).not.toMatch(/\.offset\(/);
  });

  it("both keep their existing clear-history and identity filters", () => {
    // Paging must not become a way around the per-user soft clear.
    const a = fnAt(DB, "export async function listCallHistory");
    expect(a).toMatch(/since \? gt\(callHistory\.startedAt, since\) : undefined/);
    expect(a).toMatch(/eq\(callHistory\.callerIdentityId, identityId\)/);
    const b = fnAt(DB, "export async function listConferenceHistory");
    expect(b).toMatch(/eq\(conferenceParticipants\.identityId, identityId\)/);
    expect(b).toMatch(/since \? gt\(conferenceHistory\.startedAt, since\) : undefined/);
  });
});

describe("the wire", () => {
  const src = code(ROUTERS);

  it("the cursor input is OPTIONAL, so a client that sends nothing is unchanged", () => {
    // Every build before this one sends no input at all.
    expect(src).toMatch(/const HistoryPageInput = z\s*\n?\s*\.object\(\{ before: z\.number\(\)\.int\(\)\.positive\(\)\.optional\(\) \}\)\s*\n?\s*\.optional\(\)/);
  });

  it("a garbage cursor is refused by the SCHEMA, not passed to SQL", () => {
    /* `.int().positive()` because ids are positive integers: without it a NaN reaches
       `lt(id, NaN)`, which quietly matches nothing and reads as "no older calls". */
    expect(src).toMatch(/z\.number\(\)\.int\(\)\.positive\(\)/);
  });

  it("both procedures take it and thread it through", () => {
    expect(src).toMatch(/history: publicProcedure\.input\(HistoryPageInput\)/);
    expect(src).toMatch(/conferenceHistory: publicProcedure\.input\(HistoryPageInput\)/);
    expect(src).toMatch(/listCallHistory\(me\.id, HISTORY_PAGE, clearedAt, input\?\.before \?\? null\)/);
    expect(src).toMatch(/listConferenceHistory\(me\.id, HISTORY_PAGE, clearedAt, input\?\.before \?\? null\)/);
  });

  it("the page size is still 100 — the polled cost is unchanged", () => {
    /* The whole point. A bigger default would multiply the 30s poll for everybody. */
    expect(src).not.toMatch(/listCallHistory\(me\.id, (?!HISTORY_PAGE)/);
    expect(src).not.toMatch(/listConferenceHistory\(me\.id, (?!HISTORY_PAGE)/);
  });

  it("the return stays a bare ARRAY, so a rolling deploy cannot break an older client", () => {
    /* Switching to `{rows, hasMore}` would hand an older bundle an object where it
       expects an array — an empty log for the ~60s of a deploy. `hasMore` is derived
       from the page being full instead. */
    const h = src.slice(src.indexOf("history: publicProcedure"), src.indexOf("conferenceHistory: publicProcedure"));
    expect(h.length).toBeGreaterThan(200);
    expect(h).toMatch(/return rows\.map\(/);
    expect(h).not.toMatch(/hasMore/);
  });
});

describe("the client keeps older pages OUT of the polled queries", () => {
  const src = code(HISTORY);

  it("the two polled queries still poll at 30s and take no cursor", () => {
    // If the poll started sending a cursor it would stop refreshing the newest page.
    expect(src).toMatch(/trpc\.calls\.conferenceHistory\.useQuery\(undefined, \{/);
    expect(src).toMatch(/trpc\.calls\.history\.useQuery\(undefined, \{/);
    expect((src.match(/refetchInterval: 30_000/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("older pages live in component state, not the query cache", () => {
    /* That is what stops the 30s poll re-fetching them: paging stays O(1) on the
       polling cost no matter how far back somebody has gone. */
    expect(src).toMatch(/const \[olderCalls, setOlderCalls\] = useState<CallRow\[\]\[\]>\(\[\]\)/);
    expect(src).toMatch(/const \[olderConfs, setOlderConfs\] = useState<ConfRow\[\]\[\]>\(\[\]\)/);
  });

  it("the list is built from the MERGED windows, which is what extends search", () => {
    // Search, the filter counts and grouping all derive from `items`, so pointing it at
    // the merged rows is the single change that gives all three the longer reach.
    expect(src).toMatch(/for \(const c of confRows\)/);
    expect(src).toMatch(/for \(const c of callRows\)/);
    expect(src).toMatch(/\}, \[confRows, callRows\]\);/);
  });

  it("each log pages on ITS OWN cursor", () => {
    // Two unrelated tables with unrelated ids: one shared cursor would skip rows in
    // whichever log is denser.
    expect(src).toMatch(/utils\.calls\.history\.fetch\(\{ before: oldestCursor\(callRows\) \?\? undefined \}\)/);
    expect(src).toMatch(/utils\.calls\.conferenceHistory\.fetch\(\{ before: oldestCursor\(confRows\) \?\? undefined \}\)/);
  });

  it("CLEAR HISTORY drops the kept pages too", () => {
    /* Without this, clearing would empty the newest page and leave every older page on
       screen underneath it — invalidating the queries cannot reach component state. */
    const clear = src.slice(src.indexOf("clearHistory = trpc.calls.clearHistory"), src.indexOf("const [confirmClear"));
    expect(clear.length).toBeGreaterThan(120);
    expect(clear).toMatch(/setOlderCalls\(\[\]\)/);
    expect(clear).toMatch(/setOlderConfs\(\[\]\)/);
  });

  it("switching identity drops them as well", () => {
    // A kept page must not survive into somebody else's log.
    expect(src).toMatch(/\}, \[me\?\.id\]\);/);
  });

  it("the control is absent when there is nothing more, not disabled", () => {
    /* The v2.103.3 rule: a button that looks live and always refuses is worse than one
       that is not there. */
    expect(src).toMatch(/\{mayHaveOlder && visible\.length > 0 && \(/);
  });

  it("a failed load says so rather than doing nothing visible", () => {
    // v2.88 — a silently-failed tap is the worst case.
    const fn = fnAt(HISTORY, "async function loadOlder()");
    expect(fn).toMatch(/toast\.error\(/);
    /* The sentence is a dictionary entry now, so it is asked for as the PROPERTY —
       satisfied by the literal OR by a key whose English carries it, which additionally
       proves an Arabic half exists. */
    expect(copyOnScreen(fn, "That's the whole call log."),
      whyCopyMissing(fn, "That's the whole call log.")).toBe(true);
    // And it cannot be fired twice concurrently.
    expect(fn).toMatch(/if \(loadingOlder\) return;/);
  });

  it("the count copy says what it covers, and still never claims a lifetime total", () => {
    /* v2.99.98 chose "in this log" precisely because a lifetime figure is unknowable,
       and that stays. The new line says how far the reach currently extends.
       My first draft matched the literal "calls loaded", which is not in the source —
       the JSX is `{… ? "call" : "calls"} loaded`, i.e. an interpolation splits it. */
    /* The `{n} {call|calls} loaded` interpolation is gone, and what replaced it is
       stronger: English one/other is two forms and Arabic needs four, so the line selects a
       WHOLE KEY PER BAND. Pinned at the SELECTOR because the key is chosen at runtime and
       no static reader (`copyOnScreen` included) can follow that, then driven for the
       words. */
    expect(src).toMatch(/t\(loadedCountKey\(items\.length\), \{ count: items\.length \}\)/);
    for (const n of [1, 2, 4, 30]) {
      const en = translate("en", loadedCountKey(n), { count: n });
      expect(en).toMatch(/search and grouping cover these/);
      expect(en).toContain(n === 1 ? "1 call loaded" : `${n} calls loaded`);
    }
    expect(HISTORY).toMatch(/in this log/);
  });
});
