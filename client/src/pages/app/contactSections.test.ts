/**
 * v2.99.97 — an Online section, and counts that say how many and how many are here.
 *
 * Owner: *"these are the all categories where I usually manually add people to it.
 * Also, add in the top online. Online means whoever on your contacts and all type of
 * categories will be showing online also on that one beside of the assigned category
 * … where I put for you red circle here mention number of contacts in each category
 * and also mention number of online in each category … let's say, in VIP, I have ten
 * … it will mention total ten. On beside, it will show green color … to show that is
 * online."*
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { codeOnly } from "../../../../server/testing/codeOnly";

const CONTACTS = readFileSync(new URL("./Contacts.tsx", import.meta.url), "utf8");


/* The predicate is not exported (it is one small pure function inside the page), so
 * it is re-implemented here from the source under test and pinned to agree. What is
 * tested BEHAVIOURALLY is the RULE — that presence suppression wins and that being on
 * a call counts — because those are the two ways a count can silently lie. */
function isActiveContact(c: { presenceHidden?: boolean | null; isOnline?: boolean | null; inCall?: boolean | null }): boolean {
  if (c.presenceHidden) return false;
  return !!c.isOnline || !!c.inCall;
}

describe("who counts as online", () => {
  it("someone signed in counts", () => {
    expect(isActiveContact({ isOnline: true })).toBe(true);
  });

  it("someone ON A CALL counts, even if the online flag is not set", () => {
    // A person mid-call is plainly there, and the amber busy LED already says so.
    expect(isActiveContact({ isOnline: false, inCall: true })).toBe(true);
  });

  it("a presence-SUPPRESSED guest does NOT count, whatever their flags say", () => {
    // A guest inactive over a day has presence withheld entirely (v2.95 privacy).
    // Counting them would leak precisely what the suppression exists to hide — and
    // would also pull them into the Online section, which is worse than a wrong
    // number because it is a visible list of names.
    expect(isActiveContact({ presenceHidden: true, isOnline: true })).toBe(false);
    expect(isActiveContact({ presenceHidden: true, inCall: true })).toBe(false);
  });

  it("nobody counts by default", () => {
    expect(isActiveContact({})).toBe(false);
    expect(isActiveContact({ isOnline: null, inCall: null })).toBe(false);
  });
});

describe("the source uses ONE predicate for all three answers", () => {
  it("the predicate exists and respects suppression first", () => {
    expect(CONTACTS).toMatch(/function isActiveContact\(/);
    const fn = CONTACTS.slice(CONTACTS.indexOf("function isActiveContact("));
    const body = fn.slice(0, fn.indexOf("\n}"));
    expect(body).toMatch(/if \(c\.presenceHidden\) return false;/);
    expect(body).toMatch(/return !!c\.isOnline \|\| !!c\.inCall;/);
  });

  it("the Online section and the header count both go through it", () => {
    // Two copies of "is this person online" is how a section comes to list four
    // people under a header that says three.
    expect(CONTACTS).toMatch(/filtered\.filter\(isActiveContact\)/);
    expect(CONTACTS).toMatch(/section\.rows\.filter\(isActiveContact\)\.length/);
    // And the old inline copy is gone rather than left beside it.
    const code = codeOnly(CONTACTS);
    expect(code).not.toMatch(/!r\.presenceHidden && \(r\.isOnline \|\| r\.inCall\)/);
  });
});

describe("the Online section", () => {
  it("sits at the TOP, above Favorites", () => {
    const online = CONTACTS.indexOf('key: "online"');
    const fav = CONTACTS.indexOf('key: "fav"');
    expect(online).toBeGreaterThan(0);
    expect(fav).toBeGreaterThan(0);
    expect(online).toBeLessThan(fav);
  });

  it("CROSS-CUTS the categories rather than being one", () => {
    // "whoever on your contacts and all type of categories will be showing online
    // ALSO on that one beside of the assigned category" — so a person appears here
    // AND under whatever category they were filed in, exactly as Favorites does. It
    // must therefore NOT be part of CATEGORY_ORDER, or people could be "moved into"
    // an online category, which is not a thing.
    expect(CONTACTS).toMatch(/const CATEGORY_ORDER: Category\[\] = \["vip", "family", "friend", "team"\]/);
    expect(CONTACTS).not.toMatch(/CATEGORY_ORDER: Category\[\] = \[[^\]]*"online"/);
    // It is derived from the SAME filtered list every other section is built from,
    // so a category filter or a search applies to it identically.
    expect(CONTACTS).toMatch(/const online = filtered\.filter\(isActiveContact\)/);
  });

  it("hides itself when nobody is online", () => {
    // Consistent with every other section: an empty heading is noise.
    expect(CONTACTS).toMatch(/if \(online\.length\)\s*\n?\s*out\.push\(\{ key: "online"/);
  });
});

describe("the counts on each header", () => {
  it("shows the TOTAL and the ONLINE count, from the same rows", () => {
    expect(CONTACTS).toMatch(/const total = section\.rows\.length;/);
    expect(CONTACTS).toMatch(/const onlineCount = section\.rows\.filter\(isActiveContact\)\.length;/);
  });

  it("the online count is GREEN, from the AA-measured text token", () => {
    // Not the LED green: that is 4.46:1 on the light card and fails AA for text this
    // small — measured in v2.99.86, which is why a separate text token exists.
    expect(CONTACTS).toMatch(/\{onlineCount\}/);
    const at = CONTACTS.indexOf("{onlineCount}");
    const around = CONTACTS.slice(at - 400, at);
    expect(around).toMatch(/text-\[color:var\(--relay-green-text\)\]/);
  });

  it("withholds a green ZERO", () => {
    // A green 0 spends attention on the one answer that needs none.
    expect(CONTACTS).toMatch(/\{onlineCount > 0 && \(/);
  });

  it("the Online section shows ONE number, not the same number twice", () => {
    // Its total IS its online count, so "5 · 5" would be noise.
    expect(CONTACTS).toMatch(/allActive\?: boolean;/);
    expect(CONTACTS).toMatch(/allActive: true/);
    expect(CONTACTS).toMatch(/section\.allActive \? \(/);
  });

  it("both numbers are tabular, so the column cannot jitter", () => {
    const at = CONTACTS.indexOf("{onlineCount > 0");
    expect(CONTACTS.slice(at - 500, at)).toMatch(/tabular-nums/);
  });

  it("each number says what it means, for a screen reader and on hover", () => {
    expect(CONTACTS).toMatch(/title=\{`\$\{total\} contacts`\}/);
    expect(CONTACTS).toMatch(/title=\{`\$\{onlineCount\} of them online now`\}/);
  });
});

describe("what already worked and must keep working", () => {
  it("a contact can be DELETED from the list, behind a confirmation", () => {
    // Owner asked for this; it already existed. Pinned so it cannot quietly go.
    expect(CONTACTS).toMatch(/onDelete=\{\(\) => setDeleteId\(c\.id\)\}/);
    expect(CONTACTS).toMatch(/<AlertDialogTitle>Remove contact\?<\/AlertDialogTitle>/);
    expect(CONTACTS).toMatch(/remove\.mutate/);
  });

  it("removing a BLOCKED contact still warns that it unblocks them", () => {
    // v2.99.28: the block lives on the contact row, so deleting it silently drops
    // the block. Still true, and still said out loud.
    expect(CONTACTS).toMatch(/deletingContact\?\.blocked/);
  });

  it("every section is still collapsible, and a search still forces them open", () => {
    expect(CONTACTS).toMatch(/const isCollapsed = !searching && collapsed\.has\(section\.key\)/);
  });
});
