/**
 * `contact.tags` — DATA-CONTRACTS.md §1, the store behind board 3b and 4a.
 *
 * Driven BEHAVIOURALLY rather than pinned from source, because every claim here is
 * about what a given row RESOLVES to, and a source pin cannot tell you whether a
 * contact saved in v2.82 still lands in the right section.
 *
 * The load-bearing property is the one that needed no migration: `contacts.category`
 * has existed since v2.82, so this is a WIDENING from one to many — and a row
 * carrying only the old column has to keep meaning what it always meant, on the
 * first render, with nothing run against the database.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { codeOnly } from "./testing/codeOnly";
import {
  CONTACT_TAGS,
  SECTION_TAGS,
  TAG_COLOR,
  categoryMirror,
  contactTagsOf,
  filterContacts,
  parseContactTags,
  primaryTag,
  sectionCounts,
  sectionsFor,
  serializeContactTags,
  toggleContactTag,
  type ContactTag,
  type TaggableContact,
} from "../shared/contactTags";
import { contactTagColumns } from "./v2db";

const R = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const V2DB = R("server/v2db.ts");
const ROUTERS = R("server/v2routers.ts");
const SCHEMA = R("drizzle/schema.ts");

const c = (
  number: string,
  tags: ContactTag[],
  favourite = false,
  online = false
): TaggableContact => ({ number, tags, favourite, online });

describe("a v2.82 contact keeps meaning what it meant — no backfill", () => {
  it("a row with only `category` resolves to that single tag", () => {
    expect(contactTagsOf({ category: "family", tags: null })).toEqual(["family"]);
  });

  it("a row with neither resolves to none, not to a guess", () => {
    expect(contactTagsOf({ category: null, tags: null })).toEqual([]);
    expect(contactTagsOf({})).toEqual([]);
  });

  it("`tags` wins once it has anything", () => {
    // Otherwise the mirror could outvote the real field after an edit.
    expect(contactTagsOf({ category: "family", tags: "vip,team" })).toEqual(["vip", "team"]);
  });

  it("an EMPTY tags string still falls back, rather than reading as cleared", () => {
    // "" is what a serializer writes for nothing; a row that has never been edited
    // must not lose its legacy category to it.
    expect(contactTagsOf({ category: "team", tags: "" })).toEqual(["team"]);
  });
});

describe("parsing fails to EMPTY and never to a guess", () => {
  it("drops unknown entries instead of rejecting the whole list", () => {
    // A row written by a future build carrying a fifth tag must still show the four
    // this build understands.
    expect(parseContactTags("vip,platinum,team")).toEqual(["vip", "team"]);
  });

  it("de-duplicates and folds case and whitespace", () => {
    expect(parseContactTags(" VIP , vip,Team ")).toEqual(["vip", "team"]);
  });

  it("survives every malformed shape", () => {
    for (const bad of [null, undefined, 0, {}, [1, 2], "", ",,,", [null], true]) {
      expect(parseContactTags(bad as unknown)).toEqual([]);
    }
  });

  it("PRESERVES the user's order, because the first tag is the row chip", () => {
    expect(parseContactTags("team,vip")).toEqual(["team", "vip"]);
    expect(primaryTag(parseContactTags("team,vip"))).toBe("team");
  });

  it("serializes to NULL for none, so 'never set' and 'cleared' look the same", () => {
    expect(serializeContactTags([])).toBeNull();
    expect(serializeContactTags(["vip", "vip"])).toBe("vip");
  });

  it("round-trips", () => {
    for (const t of [[], ["vip"], ["family", "team"], [...CONTACT_TAGS]] as ContactTag[][]) {
      expect(parseContactTags(serializeContactTags(t))).toEqual(t);
    }
  });
});

describe("`category` is a derived mirror, computed in exactly one place", () => {
  it("mirrors the FIRST tag", () => {
    expect(categoryMirror(["team", "vip"])).toBe("team");
    expect(categoryMirror([])).toBeNull();
  });

  it("the writer derives BOTH columns from one input", () => {
    // Two writers is how the column and the list come to disagree about what
    // somebody is filed under.
    const db = codeOnly(V2DB);
    expect(db).toMatch(/function contactTagColumns\(/);
    expect(db).toMatch(/\.\.\.contactTagColumns\(input\)/);
    // …and the upsert's own values object does not assign the column separately.
    // SCOPED TO THE WRITE, not the file: `contactTagColumns` legitimately READS
    // `input.category` to derive the mirror, and a file-wide needle matched that
    // read — the assertion was wrong about the code, not the code about itself.
    const at = db.indexOf("const values = {");
    expect(at).toBeGreaterThan(-1);
    const values = db.slice(at, db.indexOf("};", at));
    expect(values).toMatch(/\.\.\.contactTagColumns\(input\)/);
    expect(values).not.toMatch(/^\s*category:/m);
    expect(values).not.toMatch(/^\s*tags:/m);
  });

  it("the writer's RETURNED object actually carries the mirror", () => {
    /* A REAL GAP IN MY OWN TEST, found by mutation and reported rather than
       quietly patched: setting `category: null` inside `contactTagColumns` left
       every assertion green, because they pinned that the function is CALLED and
       that `values` does not assign the column separately — neither of which says
       anything about what it RETURNS. Pinning a rule's presence rather than its
       effect is the class this repo keeps hitting; driving the real function is
       the only thing that catches it. */
    expect(contactTagColumns({ tags: "team,vip" })).toEqual({
      tags: "team,vip",
      category: "team",
    });
    expect(contactTagColumns({ category: "friend" })).toEqual({
      tags: "friend",
      category: "friend",
    });
    expect(contactTagColumns({})).toEqual({ tags: null, category: null });
  });

  it("an older client that sends only `category` still works", () => {
    // Mid-deploy this is the ordinary case, and it must land as the single tag
    // rather than being dropped.
    expect(contactTagsOf({ category: "friend", tags: null })).toEqual(["friend"]);
    expect(categoryMirror(contactTagsOf({ category: "friend", tags: null }))).toBe("friend");
  });
});

describe("VIP is a chip, not a section", () => {
  it("the section list excludes it", () => {
    expect(SECTION_TAGS).not.toContain("vip");
    expect([...SECTION_TAGS]).toEqual(["family", "friend", "team"]);
  });

  it("a VIP-only contact still appears — under Other", () => {
    // The asymmetry must not cost somebody their row. This is the case that would
    // silently vanish if VIP were treated as a section that simply wasn't rendered.
    const rows = sectionsFor([c("111111", ["vip"])]);
    expect(rows.map((s) => s.key)).toEqual(["other"]);
  });

  it("every tag has a colour, and none of them is the cycling accent", () => {
    // Four fixed identities: a tag that changed colour under the reader would stop
    // being a label.
    for (const t of CONTACT_TAGS) expect(TAG_COLOR[t]).toMatch(/^#[0-9a-f]{6}$/i);
    expect(Object.values(TAG_COLOR)).not.toContain("var(--rb)");
  });
});

describe("sections: membership, not a partition", () => {
  const people = [
    c("111111", ["family"], false, true),
    c("222222", ["family", "team"], true, false),
    c("333333", [], false, true),
    c("444444", ["vip"], false, false),
  ];

  it("one contact appears in EVERY section it qualifies for", () => {
    const map = new Map(sectionsFor(people).map((s) => [s.key, s.contacts.map((x) => x.number)]));
    expect(map.get("family")).toEqual(["111111", "222222"]);
    expect(map.get("team")).toEqual(["222222"]);
    expect(map.get("favorites")).toEqual(["222222"]);
    // 222222 is in three at once — that is the contract, not a bug.
  });

  it("ONLINE and FAVORITES cross-cut rather than competing", () => {
    const map = new Map(sectionsFor(people).map((s) => [s.key, s.contacts.map((x) => x.number)]));
    expect(map.get("online")).toEqual(["111111", "333333"]);
  });

  it("sections come in the contract's order", () => {
    expect(sectionsFor(people).map((s) => s.key)).toEqual([
      "online",
      "favorites",
      "family",
      "team",
      "other",
    ]);
  });

  it("an empty section is omitted, never rendered as a header with nothing under it", () => {
    expect(sectionsFor([c("111111", ["team"])]).map((s) => s.key)).toEqual(["team"]);
  });

  it("an UNTAGGED contact never vanishes", () => {
    // The whole job of this screen is listing contacts.
    expect(sectionsFor([c("999999", [])]).map((s) => s.key)).toEqual(["other"]);
  });

  it("a favourite with no tags is not ALSO listed under Other", () => {
    // It is already shown above; repeating it lists one person twice for no new
    // information.
    expect(sectionsFor([c("999999", [], true)]).map((s) => s.key)).toEqual(["favorites"]);
  });

  it("the header count pair is total + online", () => {
    expect(sectionCounts([c("1", [], false, true), c("2", [], false, false)])).toEqual({
      total: 2,
      online: 1,
    });
  });
});

describe("the top filter chips are single-select, with All meaning no filter", () => {
  const people = [c("111111", ["vip"]), c("222222", ["family"]), c("333333", [])];

  it("null is All", () => {
    expect(filterContacts(people, null)).toHaveLength(3);
  });

  it("a filter narrows to that tag", () => {
    expect(filterContacts(people, "vip").map((x) => x.number)).toEqual(["111111"]);
  });

  it("All returns a COPY, so a caller sorting it cannot reorder the source", () => {
    const out = filterContacts(people, null);
    out.reverse();
    expect(people[0].number).toBe("111111");
  });
});

describe("assignment is a toggle, because the chips ARE the editor (4a)", () => {
  it("adds, then removes on a second tap", () => {
    expect(toggleContactTag([], "vip")).toEqual(["vip"]);
    expect(toggleContactTag(["vip"], "vip")).toEqual([]);
  });

  it("preserves the order of the others", () => {
    expect(toggleContactTag(["team", "vip", "family"], "vip")).toEqual(["team", "family"]);
  });
});

describe("the store is additive and needs no backfill", () => {
  it("one nullable column, applied by the boot migrator", () => {
    expect(SCHEMA).toMatch(/tags: varchar\("tags", \{ length: 64 \}\)/);
    expect(V2DB).toMatch(
      /\{ table: "contacts", column: "tags", ddl: "ADD COLUMN `tags` varchar\(64\)" \}/
    );
  });

  it("no NOT NULL and no DEFAULT — NULL means 'read the legacy column'", () => {
    const block = SCHEMA.slice(SCHEMA.indexOf("export const contacts"), SCHEMA.indexOf("export type Contact ="));
    const col = block.slice(block.indexOf('tags: varchar("tags"'));
    expect(col.slice(0, 60)).not.toMatch(/notNull|default/);
  });

  it("the column is upsertable, or a tag edit would silently do nothing", () => {
    expect(codeOnly(V2DB)).toMatch(/"category", "tags", "blocked",/);
  });

  it("the wire enum is CLOSED, so a client cannot invent a fifth tag", () => {
    expect(codeOnly(ROUTERS)).toMatch(
      /tags: z\.array\(z\.enum\(\["vip", "family", "friend", "team"\]\)\)\.max\(4\)/
    );
  });

  it("the list projection resolves through the shared reader", () => {
    // Not `r.tags` directly: a pre-tags contact would then show as untagged.
    expect(codeOnly(ROUTERS)).toMatch(
      /tags: contactTagsOf\(\{ tags: r\.tags \?\? null, category: r\.category \?\? null \}\)/
    );
  });
});

describe("the Contacts list reads the shared derivation, not its own copy", () => {
  const UI = codeOnly(readFileSync(resolve(process.cwd(), "client/src/pages/app/Contacts.tsx"), "utf8"));

  it("sections come from `sectionsFor`", () => {
    // A second copy of "who is in what" is how the list, its counts and 4a's chips
    // come to disagree.
    expect(UI).toMatch(/sectionsFor\(/);
    expect(UI).toMatch(/contactTagsOf\(/);
  });

  it("the old single-category partition is gone from the SECTIONS", () => {
    /* `c.category === cat && !c.favourite` HID a favourited contact from their own
       category — star somebody and they left Family. That is the behaviour this
       release fixes.
       SCOPED TO THE SECTIONS MEMO, deliberately: the row menu and the edit dialog
       still compare `c.category === cat`, because they are single-select PICKERS
       and widening them to multi-tag assignment is 4a's editable chips, not this
       release. My first version of this assertion swept the whole file and failed
       on correct code for exactly that reason. Said plainly in the notes: until
       those pickers are widened, the UI can only ever assign ONE tag. */
    const at = UI.indexOf("const sections = useMemo");
    expect(at).toBeGreaterThan(-1);
    const end = UI.indexOf("}, [filtered]);", at);
    expect(end).toBeGreaterThan(at);
    expect(UI.slice(at, end)).not.toMatch(/c\.category === cat/);
  });

  it("ONLINE and FAVORITES are not emitted twice", () => {
    /* A REAL GAP found by mutation: this file had NO client-side pin at all, so
       dropping the guard rendered Favorites as two identical sections and nothing
       failed. Both are pushed above with their own icon and tint; taking them from
       the derivation as well duplicates them. */
    expect(UI).toMatch(/if \(key === "online" \|\| key === "favorites"\) continue;/);
  });
});
