/**
 * GROUP DESCRIPTION (QW-7, v2.107.59) — an editable "about" blurb on the group info
 * sheet, distinct from and longer than the group's short status note.
 *
 * The feature is a single new `description` column on the conversations (groups) table
 * threaded end to end: DB helper write → thread-list serialization → GroupInfoSheet
 * prop → a textarea editor. This pins each seam so a half-wired column (written but
 * never serialized, or serialized but never rendered) can't pass. House style:
 * codeOnly()-stripped source, so a pin can never pass on a comment, plus a bilingual
 * check that both dictionary halves carry every new key.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { codeOnly } from "./testing/codeOnly";

const read = (rel: string) => readFileSync(join(__dirname, rel), "utf8");
const schema = codeOnly(read("../drizzle/schema.ts"));
const v2db = codeOnly(read("./v2db.ts"));
const routers = codeOnly(read("./v2routers.ts"));
const sheet = codeOnly(read("../client/src/app/GroupInfoSheet.tsx"));
const messages = codeOnly(read("../client/src/pages/app/Messages.tsx"));
const groupsDict = read("../client/src/app/dict/groups.ts");
const version = read("../shared/version.ts");

const hasBilingualKey = (src: string, key: string, prefix: string): boolean => {
  const at = src.indexOf(`"${key}":`);
  if (at < 0) return false;
  const rest = src.slice(at + key.length);
  const nextKey = rest.indexOf(`"${prefix}`, 3);
  const entry = nextKey > 0 ? rest.slice(0, nextKey) : rest.slice(0, 400);
  return /\ben:/.test(entry) && /\bar:/.test(entry);
};

/* ───────────────────────────── schema: the column ───────────────────────────── */

describe("QW-7 — the conversations table gains a description column", () => {
  it("adds description as a varchar(500), longer than the 140-char status note", () => {
    expect(schema).toMatch(/description: varchar\("description", \{ length: 500 \}\)/);
  });

  it("puts description in the conversations table, next to the group's statusNote", () => {
    // Anchor on the conversations-specific ownerIdentityId that follows the group
    // status pair, so this can't accidentally match the identities table.
    const at = schema.indexOf('statusNote: varchar("statusNote", { length: 140 }),');
    // The conversations copy is the one immediately before ownerIdentityId.
    const tail = schema.slice(at);
    const owner = tail.indexOf("ownerIdentityId");
    const between = tail.slice(0, owner);
    expect(between).toMatch(/description: varchar\("description", \{ length: 500 \}\)/);
  });

  it("the boot migrator ADDs the column so it exists on the live DB (additive, never destructive)", () => {
    // A schema column that the self-migrator doesn't ADD would be missing on the
    // running DB, and the bare `.select()` plus the write would fail at runtime.
    expect(v2db).toMatch(
      /\{ table: "conversations", column: "description", ddl: "ADD COLUMN `description` varchar\(500\)" \}/,
    );
  });
});

/* ─────────────────────── db helper: accept + write it ─────────────────────── */

describe("QW-7 — setGroupProfile writes the description", () => {
  it("accepts description in its patch shape", () => {
    const at = v2db.indexOf("export async function setGroupProfile");
    const fn = v2db.slice(at, at + 1600);
    expect(fn).toMatch(/description\?: string/);
  });

  it("clears to null on empty and caps at 500, the same rule the title uses", () => {
    const at = v2db.indexOf("export async function setGroupProfile");
    const fn = v2db.slice(at, at + 1600);
    expect(fn).toMatch(/patch\.description !== undefined/);
    expect(fn).toMatch(/patch\.description\.trim\(\)\.slice\(0, 500\)/);
    expect(fn).toMatch(/set\.description = d \|\| null/);
  });
});

/* ─────────────── serialization: it reaches the thread on the wire ─────────────── */

describe("QW-7 — the group description is serialized to the thread", () => {
  it("ThreadSummary carries groupDescription", () => {
    expect(v2db).toMatch(/groupDescription: string \| null/);
  });

  it("the group branch fills it from the row, and the DM default is null", () => {
    expect(v2db).toMatch(/groupDescription: convo\.description \?\? null/);
    expect(v2db).toMatch(/groupDescription: null as string \| null/);
  });

  it("description is threaded through convoRows explicitly (a column can't reach the wire by spread)", () => {
    // The convoRows type declares it and the mapping forwards it.
    expect(v2db).toMatch(/description\?: string \| null;/);
    expect(v2db).toMatch(/description: c\.description,/);
  });

  it("the router serializes groupDescription onto the thread list row", () => {
    expect(routers).toMatch(/groupDescription: b\.groupDescription/);
  });
});

/* ──────────────────────── router: the input is filtered ──────────────────────── */

describe("QW-7 — setGroupProfile accepts and UGC-filters the description", () => {
  it("adds description to the input schema, capped at 500", () => {
    const at = routers.indexOf("setGroupProfile: publicProcedure");
    const proc = routers.slice(at, at + 1400);
    expect(proc).toMatch(/description: z\.string\(\)\.max\(500\)\.optional\(\)/);
  });

  it("runs the same sanitizeUgcText gate the title and status note get", () => {
    const at = routers.indexOf("setGroupProfile: publicProcedure");
    const proc = routers.slice(at, at + 1600);
    expect(proc).toMatch(
      /description: input\.description !== undefined \? sanitizeUgcText\(input\.description\) : undefined/,
    );
  });
});

/* ──────────────────────── client: the editor is wired ──────────────────────── */

describe("QW-7 — the group info sheet edits the description", () => {
  it("takes a description prop", () => {
    expect(sheet).toMatch(/description: string \| null;/);
  });

  it("mirrors the name's follow-server-unless-editing rule for the about field", () => {
    expect(sheet).toMatch(/const \[about, setAbout\] = useState\(description \?\? ""\)/);
    expect(sheet).toMatch(/const \[editingAbout, setEditingAbout\] = useState\(false\)/);
    expect(sheet).toMatch(/if \(!editingAbout\) setAbout\(description \?\? ""\)/);
  });

  it("commits on blur, capping at 500 and skipping a no-op write", () => {
    const at = sheet.indexOf("const commitAbout");
    const fn = sheet.slice(at, at + 400);
    expect(fn).toMatch(/about\.trim\(\)\.slice\(0, 500\)/);
    expect(fn).toMatch(/if \(next === \(description \?\? ""\)\) return/);
    expect(fn).toMatch(/save\.mutate\(\{ conversationId, description: next \}\)/);
  });

  it("renders a multi-line Textarea with an explicit text colour so it's never invisible", () => {
    const at = sheet.indexOf('id="group-about"');
    const region = sheet.slice(at - 200, at + 600);
    expect(region).toMatch(/<Textarea/);
    expect(region).toMatch(/maxLength=\{500\}/);
    expect(region).toMatch(/text-foreground/);
  });

  it("Messages passes the group's description down to the sheet", () => {
    expect(messages).toMatch(/description=\{thread\?\.groupDescription \?\? null\}/);
  });
});

/* ─────────────────────────── i18n: both halves ─────────────────────────── */

describe("QW-7 — the about strings are bilingual", () => {
  it("carries label, placeholder and hint in en and ar", () => {
    expect(hasBilingualKey(groupsDict, "groups.aboutLabel", '"groups.')).toBe(true);
    expect(hasBilingualKey(groupsDict, "groups.aboutPlaceholder", '"groups.')).toBe(true);
    expect(hasBilingualKey(groupsDict, "groups.aboutHint", '"groups.')).toBe(true);
  });
});

/* ─────────────────────────── version bump ─────────────────────────── */

describe("QW-7 — ships in 2.107.60", () => {
  it("the app version is 2.107.60", () => {
    expect(version).toMatch(/APP_VERSION = "2\.107\.60"/);
  });
});
