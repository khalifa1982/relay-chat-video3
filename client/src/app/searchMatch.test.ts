/**
 * v2.99.96 — search that finds it.
 *
 * Owner: *"Whenever I put the keywords either by words, single words, it will deduct
 * anything on that single word. Let's say if a name, it will deduct on the names
 * first, second, third … Or if I put a number, it will deduct the number. So make sure
 * that the search is properly working because currently, I put the words doesn't
 * deduct hundred percent."*
 *
 * Tested BEHAVIOURALLY, because that is the entire feature: a source pin cannot tell
 * you whether typing "khalifa ali" finds Khalifa Mohamed Ali, or whether the `777-777`
 * the app itself renders finds the number it renders.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { digitsOf, foldText, isNumberQuery, matchQuery, tokenize } from "./searchMatch";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const CONTACTS = read("../pages/app/Contacts.tsx");
const MESSAGES = read("../pages/app/Messages.tsx");
const HISTORY = read("../pages/app/History.tsx");
const PICKER = read("../pages/app/GroupCallScreen.tsx");
const SUGGEST = read("./contactSuggest.ts");

const codeOnly = (s: string) =>
  s
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !/^\s*\/\//.test(l))
    .join("\n");

/** A person shaped like a row in any of the four lists. */
const KHALIFA = ["Khalifa Mohamed Ali", "777777"];
const ALVARO = ["Ålvaro Núñez", "601586"];

describe("the owner's own cases", () => {
  it("matches ANY word of a name, in ANY order — the 'first, second, third' ask", () => {
    // THE HEADLINE BUG. A contiguous substring test cannot do this at all, because
    // "khalifa ali" does not appear anywhere inside "Khalifa Mohamed Ali".
    expect(matchQuery("khalifa ali", KHALIFA)).toBe(true);
    expect(matchQuery("ali khalifa", KHALIFA)).toBe(true);
    expect(matchQuery("mohamed", KHALIFA)).toBe(true);
    expect(matchQuery("ali", KHALIFA)).toBe(true);
  });

  it("still matches a single mid-word fragment, which people rely on", () => {
    // Deliberately NOT narrowed to word-start: today "hammadi" finds "Alhammadi", and
    // taking that away to satisfy the letter of the ask would remove a real match.
    expect(matchQuery("hammadi", ["Khalifa Alhammadi", "777777"])).toBe(true);
  });

  it("finds the number in the grouped form the app itself displays", () => {
    // Contacts and the group picker compared the RAW query against the raw number, so
    // typing back the `777-777` printed on the very same row matched nothing.
    expect(matchQuery("777-777", KHALIFA)).toBe(true);
    expect(matchQuery("777 777", KHALIFA)).toBe(true);
    expect(matchQuery("(777) 777", KHALIFA)).toBe(true);
    expect(matchQuery("777777", KHALIFA)).toBe(true);
  });

  it("matches a partial number", () => {
    expect(matchQuery("777", KHALIFA)).toBe(true);
    expect(matchQuery("601", ALVARO)).toBe(true);
  });

  it("folds diacritics, so an unaccented query finds an accented name", () => {
    expect(matchQuery("alvaro", ALVARO)).toBe(true);
    expect(matchQuery("nunez", ALVARO)).toBe(true);
    expect(matchQuery("jose", ["José García", "111111"])).toBe(true);
  });

  it("folds case in both directions", () => {
    expect(matchQuery("KHALIFA", KHALIFA)).toBe(true);
    expect(matchQuery("khalifa", ["KHALIFA MOHAMED", "777777"])).toBe(true);
  });

  it("a name query and a number query can be MIXED", () => {
    // Different tokens may match different fields, which is what makes this useful.
    expect(matchQuery("khalifa 777", KHALIFA)).toBe(true);
    expect(matchQuery("777 ali", KHALIFA)).toBe(true);
  });
});

describe("what must NOT match", () => {
  it("a query whose token appears nowhere", () => {
    expect(matchQuery("zzz", KHALIFA)).toBe(false);
    expect(matchQuery("khalifa zzz", KHALIFA)).toBe(false);
  });

  it("EVERY token must match — not merely one of them", () => {
    // `some` instead of `every` would make a two-word query looser than a one-word
    // one, which is the opposite of what a person expects when they add a word.
    expect(matchQuery("khalifa bartholomew", KHALIFA)).toBe(false);
  });

  it("a different number", () => {
    expect(matchQuery("999999", KHALIFA)).toBe(false);
    expect(matchQuery("999-999", KHALIFA)).toBe(false);
  });

  it("digits are compared PER FIELD, never across a joined haystack", () => {
    // History used to glue every field together and strip non-digits from the whole
    // string, so a digit run spanning two fields matched. Here the name ends "12" and
    // the number starts "34"; "1234" must not match.
    expect(matchQuery("1234", ["Room 12", "345678"])).toBe(false);
    // …while each field's own digits still match.
    expect(matchQuery("12", ["Room 12", "345678"])).toBe(true);
    expect(matchQuery("3456", ["Room 12", "345678"])).toBe(true);
  });
});

describe("edge cases that must not break a list", () => {
  it("an empty or whitespace query matches everything", () => {
    // A filter built on this must hide nothing before the user has typed.
    expect(matchQuery("", KHALIFA)).toBe(true);
    expect(matchQuery("   ", KHALIFA)).toBe(true);
    expect(matchQuery(null, KHALIFA)).toBe(true);
    expect(matchQuery(undefined, KHALIFA)).toBe(true);
  });

  it("null and undefined FIELDS are skipped, not crashed on", () => {
    // Every real row has nullable fields: contacts.displayName is nullable, and a DM
    // thread has no title.
    expect(matchQuery("khalifa", [null, "Khalifa", undefined, ""])).toBe(true);
    expect(matchQuery("khalifa", [null, undefined])).toBe(false);
  });

  it("a numeric query can still be a NAME", () => {
    // The number branch must not short-circuit the name branch, or a contact called
    // "Flat 12" becomes unfindable by typing 12.
    expect(matchQuery("12", ["Flat 12", "999999"])).toBe(true);
  });

  it("a query with a letter is NOT read as a number", () => {
    // "7th floor" must be a name search; reading it as the number 7 would return
    // every row whose number contains a 7.
    expect(isNumberQuery("7th floor")).toBe(false);
    expect(matchQuery("7th", ["7th Avenue Office", "111111"])).toBe(true);
    expect(matchQuery("7th", ["Khalifa", "777777"])).toBe(false);
  });
});

describe("the primitives", () => {
  it("foldText strips marks and lowercases", () => {
    expect(foldText("Ålvaro NÚÑEZ")).toBe("alvaro nunez");
    expect(foldText("  José  ")).toBe("josé".normalize("NFD").replace(/[̀-ͯ]/g, ""));
    expect(foldText(null)).toBe("");
  });

  it("digitsOf keeps only digits", () => {
    expect(digitsOf("777-777")).toBe("777777");
    expect(digitsOf("(+971) 50 123")).toBe("97150123");
    expect(digitsOf(null)).toBe("");
  });

  it("isNumberQuery accepts the separators people really type", () => {
    for (const q of ["777777", "777-777", "777 777", "(777) 777", "+777777", "777.777"]) {
      expect(isNumberQuery(q), q).toBe(true);
    }
    for (const q of ["", "   ", "khalifa", "7th", "abc123"]) {
      expect(isNumberQuery(q), q).toBe(false);
    }
  });

  it("tokenize splits on whitespace and keeps hyphenated names whole", () => {
    expect(tokenize("Khalifa  Al-Hammadi")).toEqual(["khalifa", "al-hammadi"]);
    expect(tokenize("   ")).toEqual([]);
  });
});

describe("every search box goes through the one rule", () => {
  it("all four list filters import it", () => {
    for (const [name, src] of [
      ["Contacts", CONTACTS],
      ["Messages", MESSAGES],
      ["History", HISTORY],
      ["GroupCallScreen", PICKER],
    ] as const) {
      expect(src, `${name} imports the matcher`).toMatch(
        /import \{ matchQuery \} from "@\/app\/searchMatch"/
      );
      expect(src, `${name} uses it`).toMatch(/matchQuery\(/);
    }
  });

  it("no surface hand-rolls a lowercase substring filter any more", () => {
    // The shape that produced all four failure modes.
    for (const [name, src] of [
      ["Contacts", CONTACTS],
      ["Messages", MESSAGES],
      ["History", HISTORY],
      ["GroupCallScreen", PICKER],
    ] as const) {
      const code = codeOnly(src);
      expect(code, `${name} still lowercases a query for filtering`).not.toMatch(
        /displayName\?\.toLowerCase\(\)\.includes\(q\)/
      );
      expect(code, `${name} still compares a raw query to a number`).not.toMatch(
        /c\.number\.includes\(q\)/
      );
    }
  });

  it("the text primitives exist in exactly ONE place", () => {
    // `contactSuggest` re-exports them rather than keeping a second copy, because two
    // implementations of "fold this name" is how two screens end up disagreeing.
    expect(SUGGEST).toMatch(/import \{ digitsOf, foldText, isNumberQuery \} from "\.\/searchMatch"/);
    const code = codeOnly(SUGGEST);
    expect(code).not.toMatch(/function foldName/);
    expect(code).not.toMatch(/function digitsOf/);
    expect(code).not.toMatch(/function isNumberQuery/);
  });
});

describe("a match is never hidden by a collapsed section", () => {
  it("Contacts opens every section while a query is active", () => {
    // THE INVISIBLE-MATCH BUG. The filter kept the row and the section header counted
    // it, but the body was gated on collapse state — so a search could report "1"
    // beside a heading and render nothing. Found by an adversarial review of the
    // search diagnosis, and it is a large part of "doesn't detect 100%".
    expect(CONTACTS).toMatch(/const searching = search\.trim\(\)\.length > 0/);
    expect(CONTACTS).toMatch(/const isCollapsed = !searching && collapsed\.has\(section\.key\)/);
  });

  it("History opens every day section while a query is active", () => {
    expect(HISTORY).toMatch(
      /const isCollapsed = !historySearch\.trim\(\) && collapsed\.has\(sec\.key\)/
    );
  });

  it("Messages opens every category while a query is active", () => {
    expect(MESSAGES).toMatch(
      /const open = threadSearch\.trim\(\)\.length > 0 \|\| !collapsedCats\[cat\.key\]/
    );
  });
});

describe("each surface offers the right fields", () => {
  it("Contacts searches the saved name, the LIVE name and the number", () => {
    // Somebody saved as "Dad" was findable in Contacts and not in History; somebody's
    // real name was findable in History and not in Contacts. Both now work on both.
    expect(CONTACTS).toMatch(/matchQuery\(search, \[c\.displayName, c\.liveName, c\.number\]\)/);
  });

  it("the group picker searches the same three", () => {
    expect(PICKER).toMatch(/matchQuery\(search, \[c\.displayName, c\.liveName, c\.number\]\)/);
  });

  it("History excludes the VIEWER from the roster it searches", () => {
    // Your own name is on every conference row, so including it made searching for
    // yourself match every single call.
    const fn = HISTORY.slice(HISTORY.indexOf("function searchFieldsOf"));
    const body = fn.slice(0, fn.indexOf("\n}"));
    expect(body.length).toBeGreaterThan(100);
    expect(body).toMatch(/if \(p\.isSelf\) continue;/);
  });

  it("History searches the SAVED contact name on BOTH row kinds", () => {
    // COUNTED. A bare `toMatch` was satisfied by the solo branch alone while the
    // conference branch had lost it — so a call from somebody saved as "Dad" stayed
    // unfindable on exactly the rows that matter most (answered calls are all
    // conference rows). Found by the mutation run.
    expect(HISTORY.match(/savedNameOf\?\.\(/g)?.length).toBe(2);
    expect(HISTORY).toMatch(/const savedNameOf = useMemo/);
  });

  it("the server sends the live name for search, additively", () => {
    const ROUTERS = read("../../../server/v2routers.ts");
    expect(ROUTERS).toMatch(/const liveNameByNumber = new Map/);
    expect(ROUTERS).toMatch(/liveName: liveNameByNumber\.get\(r\.number\) \?\? null/);
    // The row still DISPLAYS the name you chose — liveName is search-only.
    expect(ROUTERS).toMatch(/displayName: r\.displayName,/);
  });
});
