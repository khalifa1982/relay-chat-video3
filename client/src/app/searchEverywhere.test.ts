/**
 * SEARCH BY NAME **OR** PIN, IN EVERY BOX (2026-08-01).
 *
 * The owner's ask, twice: *"any type of box you can search either by name … or by pin
 * number … anywhere and the entire system by these two methods"*.
 *
 * v2.99.96 built the shared rule and put it on Contacts, History and the group-call
 * picker. An audit of the rest found three genuine gaps and one non-gap:
 *
 *   1. THE MESSAGES THREAD SEARCH NEVER SAW THE NAME YOU SAVED. It matched
 *      `t.peerDisplayName`, which is the LIVE identity name — whatever that person
 *      calls themselves — so somebody stored in your contacts as "Dad" could not be
 *      found by typing "Dad". The single most likely word to type matched nothing.
 *
 *   2. THE ADMIN PANEL COULD NOT FIND `777-777`. Its server-side search tested
 *      `/^\d{6}$/` against the RAW query, so the grouping the app itself RENDERS —
 *      and therefore the form an admin reads off the screen and types back — fell
 *      through to a LIKE over email and display name, which cannot match a number.
 *
 *   3. THE FORWARD PICKER HAD NO SEARCH BOX AT ALL.
 *
 *   4. NOT A GAP, and recorded here so it is not "fixed" later: the new-message and
 *      group-member pickers use `suggestContacts`, whose NAME matching is word-start
 *      only rather than infix. That is a decision, not an omission — v2.99.93 records
 *      that a one- or two-letter infix matches most of a contact list and is
 *      indistinguishable from no filter, and v2.99.96 then kept infix in `matchQuery`
 *      *because* adopting the suggestion rule there would regress the main lists. The
 *      two differ on purpose. They already AGREE on the number half, which is what the
 *      owner asked about, because both import the same primitives.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { codeOnly } from "../../../server/testing/codeOnly";
import { digitsOf, isNumberQuery, pinFromQuery } from "../../../shared/searchNumber";
import { matchQuery } from "./searchMatch";
import { isNumberQuery as suggestIsNumberQuery } from "./contactSuggest";

const read = (p: string) => codeOnly(readFileSync(resolve(process.cwd(), p), "utf8"));
const MSG = read("client/src/pages/app/Messages.tsx");
const DB = read("server/v2db.ts");

describe("the number rule has exactly ONE definition", () => {
  it("`shared/searchNumber.ts` is it, and the client re-exports rather than restating", () => {
    /* A second copy is the two-gates-disagree defect this repo keeps paying for
       (v2.99.71's TURN checker, v2.105.11's token classifier). Here a divergence would
       mean the admin panel and every other box disagreeing about whether `777 777` is
       a number — invisible until somebody cannot find a user they can see on screen. */
    const sm = read("client/src/app/searchMatch.ts");
    expect(sm).toMatch(/from "\.\.\/\.\.\/\.\.\/shared\/searchNumber"/);
    expect(sm, "the rule must not be restated client-side").not.toMatch(
      /export function (digitsOf|isNumberQuery)\b/,
    );
    // The suggestion pickers reach the SAME function, not a lookalike.
    expect(suggestIsNumberQuery).toBe(isNumberQuery);
  });

  it("accepts every grouping the app itself renders, and refuses a name", () => {
    for (const q of ["777777", "777-777", "777 777", "77-77-77", "(777) 777", "+777777"]) {
      expect(isNumberQuery(q), q).toBe(true);
      expect(digitsOf(q), q).toBe("777777");
    }
    /* "7th floor" must be a NAME search — reading it as the number 7 is the
       over-match v2.99.96 removed. */
    for (const q of ["7th", "7th floor", "Flat 12", "", "  ", "abc"]) {
      expect(isNumberQuery(q), q).toBe(false);
    }
  });

  it("`pinFromQuery` is exactly six digits, or nothing", () => {
    expect(pinFromQuery("777-777")).toBe("777777");
    expect(pinFromQuery(" 777 777 ")).toBe("777777");
    /* A PREFIX is a different operation — the suggestion pickers do that on purpose —
       and an admin looking somebody up by number means THAT number. */
    expect(pinFromQuery("777")).toBeNull();
    expect(pinFromQuery("7777777")).toBeNull();
    expect(pinFromQuery("Dad")).toBeNull();
    expect(pinFromQuery(null)).toBeNull();
  });
});

describe("the admin panel finds the number an admin can see on screen", () => {
  it("the number branch folds the query instead of testing it raw", () => {
    const at = DB.indexOf("export async function adminFindIdentities");
    expect(at).toBeGreaterThan(-1);
    const fn = DB.slice(at, DB.indexOf("\n}\n", at));
    expect(fn.length).toBeGreaterThan(400);
    expect(fn).toMatch(/const pin = pinFromQuery\(q\);/);
    expect(fn).toMatch(/eq\(identities\.number, pin\)/);
    /* The defect, by name: the raw-query test could never match `777-777`. */
    expect(fn, "the raw six-digit test is gone").not.toMatch(/\/\^\\d\{6\}\$\/\.test\(q\)/);
    expect(fn, "and it must not compare the unfolded query").not.toMatch(
      /eq\(identities\.number, q\)/,
    );
  });

  it("imports the shared rule rather than restating it", () => {
    expect(DB).toMatch(/import \{ pinFromQuery \} from "\.\.\/shared\/searchNumber"/);
  });
});

describe("the Messages thread search sees the name YOU saved", () => {
  it("the saved name is an extra FIELD, not a replacement", () => {
    /* Both are legitimate readings of the same keystrokes: somebody may search for the
       name on screen or the name in their own address book. Replacing the live one
       would make a person unfindable by the name they chose. */
    const at = MSG.indexOf("matchQuery(threadSearch, [");
    expect(at).toBeGreaterThan(-1);
    const args = MSG.slice(at, MSG.indexOf("])", at));
    expect(args).toContain("t.peerDisplayName");
    expect(args).toContain("t.peerNumber");
    expect(args).toContain("t.title");
    expect(args).toContain("t.groupNumber");
    expect(args).toMatch(/savedNameByNumber\.get\(t\.peerNumber\)/);
  });

  it("`useSavedNames` is ONE hook with two consumers, and costs no request", () => {
    /* Two copies of the map is how the thread list and the Forward picker come to
       disagree about what a conversation is called. And `RelayEngine` already runs
       `contacts.list` app-wide, so this is the same react-query cache key. */
    expect((MSG.match(/function useSavedNames\(\)/g) || []).length).toBe(1);
    expect((MSG.match(/useSavedNames\(\)/g) || []).length).toBe(3); // 1 decl + 2 calls
    const at = MSG.indexOf("function useSavedNames()");
    const fn = MSG.slice(at, MSG.indexOf("\n}\n", at));
    expect(fn).toMatch(/trpc\.contacts\.list\.useQuery\(undefined,/);
  });

  it("the memo re-runs when a contact is renamed", () => {
    /* QA H3: react-query's structural sharing keeps `scopedThreads` referentially
       stable, so a filter input that is NOT a dep silently keeps the old result. */
    const at = MSG.indexOf("const threadCategories = useMemo(");
    const memo = MSG.slice(at, MSG.indexOf("]);", MSG.indexOf("}, [", at)) + 3);
    expect(memo).toMatch(/\}, \[[^\]]*savedNameByNumber[^\]]*\]/);
    expect(memo).toMatch(/\}, \[[^\]]*threadSearch[^\]]*\]/);
  });
});

describe("the Forward picker is a picker rather than a list", () => {
  it("it has a search box that names both methods", () => {
    const at = MSG.indexOf('aria-label="Search conversations to forward to"');
    expect(at, "the forward search box is gone").toBeGreaterThan(-1);
    const box = MSG.slice(Math.max(0, at - 400), at + 200);
    expect(box).toMatch(/value=\{forwardSearch\}/);
    expect(box).toMatch(/placeholder="Search by name or number"/);
  });

  it("it filters through the SHARED matcher, over the same fields as the thread list", () => {
    const at = MSG.indexOf("const forwardTargets = useMemo(");
    expect(at).toBeGreaterThan(-1);
    const fn = MSG.slice(at, MSG.indexOf("}, [", at));
    expect(fn).toMatch(/matchQuery\(q, \[/);
    expect(fn).toContain("t.peerDisplayName");
    expect(fn).toContain("t.groupNumber");
    expect(fn).toMatch(/savedNameByNumber\.get\(t\.peerNumber\)/);
    /* Still never offers the thread you are already in. */
    expect(fn).toMatch(/t\.conversationId !== conversationId/);
  });

  it("an EMPTY search is the whole list, not an empty one", () => {
    /* Failing the other way would make the picker useless until you typed. */
    const at = MSG.indexOf("const forwardTargets = useMemo(");
    const fn = MSG.slice(at, MSG.indexOf("}, [", at));
    expect(fn).toMatch(/if \(!q\) return others;/);
  });

  it("the query is cleared when the dialog closes", () => {
    /* Or the next forward opens filtered by something nobody typed for it. */
    const at = MSG.indexOf("open={forwarding !== null}");
    const dlg = MSG.slice(at, at + 500);
    expect(dlg).toMatch(/setForwardSearch\(""\)/);
  });

  it("a narrowed-to-nothing search does not claim the inbox is empty", () => {
    /* "No other conversations yet" is a false statement about somebody's own data the
       moment a filter is doing the emptying — the v2.106.25 defect. */
    const at = MSG.indexOf("No other conversations yet.");
    expect(at).toBeGreaterThan(-1);
    const region = MSG.slice(Math.max(0, at - 400), at + 100);
    expect(region).toMatch(/forwardSearch\.trim\(\)\s*\?/);
    expect(region).toMatch(/No conversations match/);
  });
});

describe("the four surfaces v2.99.96 already covered still do", () => {
  it("`matchQuery` finds a person by a grouped number and by a later word", () => {
    /* Driven, not pinned: whether "777-777" finds 777777 is exactly what a source
       assertion cannot answer. */
    expect(matchQuery("777-777", ["Khalifa Alhammadi", "777777"])).toBe(true);
    expect(matchQuery("777 777", [null, "777777"])).toBe(true);
    expect(matchQuery("alhammadi", ["Khalifa Alhammadi", "777777"])).toBe(true);
    expect(matchQuery("Dad", ["Khalifa Alhammadi", "777777", null, null, "Dad"])).toBe(true);
    expect(matchQuery("zzz", ["Khalifa Alhammadi", "777777"])).toBe(false);
  });
});
