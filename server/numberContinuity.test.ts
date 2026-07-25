/* ============================================================
   v2.99.53 — NUMBER CONTINUITY.

   Owner, after losing their guest data at registration: "it should not be
   repeated again to any other users and in the future and should be
   systematic... You should stay with your data. It will move with you whenever
   you are moving. You can regenerate the number, but you will not lose your
   data. But your number is hooked to other contact list, it will be updated
   automatically. So you need to have a mature system, doesn't have glitch or
   errors."

   The structural problem behind both symptoms: RELAY names a person twice. The
   IDENTITY ROW is referenced by numeric id, so everything hanging off it travels
   with the person for free. The 6-DIGIT NUMBER is what other people store, and
   every place it is stored is a COPY that can rot.

   Renumbering used to rewrite exactly one of those copies — `contacts` — because
   the guarantee lived inside one function that happened to know about contacts.
   History's copies rotted silently: a dead call-back button, a stale PIN
   rendered as fact, a permanently-grey presence dot, and a lost avatar.

   These tests are the guarantee instead of that function's memory. The first one
   FAILS THE BUILD if any number-bearing column in the schema has no declared
   strategy, so the mistake cannot be repeated by a future table.
   ============================================================ */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { NUMBER_BEARING_COLUMNS } from "./v2db";

const read = (...p: string[]) => fs.readFileSync(path.resolve(__dirname, ...p), "utf8");
const SCHEMA = read("..", "drizzle", "schema.ts");
const V2DB = read("v2db.ts");
const ROUTERS = read("v2routers.ts");

/** Every `varchar(name, { length: 6 })` column in the schema, with its table. */
function numberColumnsInSchema(): Array<{ table: string; column: string }> {
  const found: Array<{ table: string; column: string }> = [];
  // Walk the file once, tracking the most recent mysqlTable("<name>" declaration
  // so each 6-char varchar is attributed to the table it sits in.
  let table = "";
  for (const line of SCHEMA.split("\n")) {
    const t = line.match(/mysqlTable\(\s*$|mysqlTable\(\s*"([^"]+)"/);
    if (t) {
      if (t[1]) table = t[1];
      else table = "__pending__"; // name is on the next line
    } else if (table === "__pending__") {
      const n = line.match(/^\s*"([^"]+)",\s*$/);
      if (n) table = n[1];
    }
    const c = line.match(/(\w+)\s*:\s*varchar\(\s*"(\w+)"\s*,\s*\{\s*length:\s*6\s*\}/);
    if (c) found.push({ table, column: c[2] });
  }
  return found;
}

describe("the number-copy registry is complete", () => {
  it("finds the schema's number columns at all (the scanner works)", () => {
    const cols = numberColumnsInSchema();
    // If this ever drops to zero the whole guard would pass vacuously.
    expect(cols.length).toBeGreaterThanOrEqual(5);
    expect(cols).toEqual(
      expect.arrayContaining([{ table: "identities", column: "number" }])
    );
    for (const c of cols) expect(c.table, "every column is attributed to a table").not.toBe("");
    expect(cols.map((c) => c.table)).not.toContain("__pending__");
  });

  it("EVERY number-bearing column declares how it stays correct", () => {
    const declared = new Set(NUMBER_BEARING_COLUMNS.map((c) => `${c.table}.${c.column}`));
    const missing = numberColumnsInSchema()
      .map((c) => `${c.table}.${c.column}`)
      .filter((k) => !declared.has(k));
    // THIS IS THE POINT OF THE FILE. A new column holding a 6-digit number must
    // be added to NUMBER_BEARING_COLUMNS with a strategy — "renumber" (rewritten
    // in regenerateIdentityNumber's transaction), "live" (resolved from the
    // identity at read time), "identity" (the source of truth), or
    // "not-a-person". Storing a number and forgetting about it is what made
    // History rot, and it is exactly what this refuses to let ship.
    expect(missing, `undeclared number column(s): ${missing.join(", ")}`).toEqual([]);
  });

  it("declares nothing that isn't actually in the schema", () => {
    const inSchema = new Set(numberColumnsInSchema().map((c) => `${c.table}.${c.column}`));
    const stale = NUMBER_BEARING_COLUMNS.map((c) => `${c.table}.${c.column}`).filter((k) => !inSchema.has(k));
    expect(stale, `registry references removed column(s): ${stale.join(", ")}`).toEqual([]);
  });

  it("every entry states a strategy and a reason", () => {
    for (const c of NUMBER_BEARING_COLUMNS) {
      expect(["identity", "renumber", "live", "not-a-person"]).toContain(c.strategy);
      expect(c.note.length, `${c.table}.${c.column} explains itself`).toBeGreaterThan(20);
    }
  });
});

describe("renumbering moves every stored copy, atomically", () => {
  const fn = V2DB.slice(
    V2DB.indexOf("export async function regenerateIdentityNumber"),
    V2DB.indexOf("/* ── presence")
  );

  it("the identity move and every copy share ONE transaction", () => {
    expect(fn).toMatch(/await db\.transaction\(async \(tx\) => \{/);
    // All-or-nothing: a half-applied renumber leaves people dialling someone who
    // is no longer there, and the caller would never learn it happened.
    const tx = fn.slice(fn.indexOf("db.transaction"), fn.indexOf("confirmNumberReservation"));
    expect(tx).toMatch(/tx\.update\(identities\)\s*\.set\(\{ number: newNumber \}\)/);
    expect(tx).toMatch(/tx\.update\(contacts\)\s*\.set\(\{ number: newNumber \}\)/);
    expect(tx).toMatch(/tx\s*\n?\s*\.update\(conferenceParticipants\)/);
  });

  it("covers exactly the columns declared 'renumber' — no more, no less", () => {
    const tx = fn.slice(fn.indexOf("db.transaction"), fn.indexOf("confirmNumberReservation"));
    const TABLE_TO_DRIZZLE: Record<string, string> = {
      contacts: "contacts",
      conference_participants: "conferenceParticipants",
      conference_history: "conferenceHistory",
      party_lines: "partyLines",
    };
    for (const c of NUMBER_BEARING_COLUMNS) {
      const sym = TABLE_TO_DRIZZLE[c.table];
      if (!sym) continue; // identities itself
      const written = tx.includes(`.update(${sym})`);
      if (c.strategy === "renumber") {
        expect(written, `${c.table} is declared 'renumber' and must be updated here`).toBe(true);
      } else {
        // A "live" or "not-a-person" column must NOT be rewritten — rewriting a
        // party line's number would move a resource its creator doesn't own, and
        // rewriting history would only paper over the read path that must be
        // right anyway.
        expect(written, `${c.table} is declared '${c.strategy}' and must NOT be rewritten`).toBe(false);
      }
    }
  });

  it("the conference join row is scoped by identity, not by matching number alone", () => {
    // Scoping on the number alone would rewrite any row that happens to hold it.
    expect(fn).toMatch(
      /eq\(conferenceParticipants\.identityId, identityId\),\s*\n?\s*eq\(conferenceParticipants\.number, oldNumber\)/
    );
  });

  it("a block placed on the OLD number follows the person", () => {
    // contacts.blocked lives on the contact row, which is keyed by number — so
    // rewriting the row carries the block with it. Regenerating a number must
    // never be a way to shed a block; nothing here deletes or clears it.
    const tx = fn.slice(fn.indexOf("db.transaction"), fn.indexOf("confirmNumberReservation"));
    expect(tx).not.toMatch(/blocked/);
    // The only deletes are the planner's stale duplicates, by explicit id.
    expect(tx).toMatch(/tx\.delete\(contacts\)\.where\(inArray\(contacts\.id, plan\.deleteIds\)\)/);
  });

  it("the old number is never recycled", () => {
    // A contact who somehow kept the old number must reach nobody, rather than
    // reaching a stranger who was later given it.
    expect(fn).toMatch(/reservation stays forever/);
    expect(fn).not.toMatch(/releaseUnusedNumberReservation\(oldNumber\)/);
  });
});

describe("History resolves people from their identity, not a frozen number", () => {
  const proc = ROUTERS.slice(
    ROUTERS.indexOf("conferenceHistory: publicProcedure"),
    ROUTERS.indexOf("conferenceHistory: publicProcedure") + 5200
  );

  it("looks the roster up by identityId", () => {
    expect(proc).toMatch(/getIdentitiesByIds\(rosterIds\)/);
    expect(proc).toMatch(/liveById/);
  });

  it("shows the LIVE number, falling back to the snapshot only for guests", () => {
    expect(proc).toMatch(/number: live\?\.number \?\? frozenNumber/);
    // Entries that never had an identity are the only ones resolved by number.
    expect(proc).toMatch(/\.filter\(\(p\) => typeof p\.identityId !== "number"\)/);
  });

  it("the avatar is resolved by identity too", () => {
    // It used to be looked up BY NUMBER, so a renumbered person silently lost
    // their photo from everybody's History.
    expect(proc).toMatch(/avatarUrl: live\?\.avatarUrl \?\?/);
  });

  it("the call-back target maps through the roster to a live number", () => {
    expect(proc).toMatch(/participants\.find\(\(p\) => p\.frozenNumber === dialed\)\?\.number \?\? dialed/);
  });

  it("a party line's number is exempt — it belongs to the line, not a person", () => {
    expect(proc).toMatch(/dialed && !isPartyLine/);
    // The title lookup must stay on the STORED number for the same reason.
    expect(proc).toMatch(/titleByNumber\.get\(dialed \?\? ""\)/);
  });

  it("the frozen number is an internal detail, not shipped to the client", () => {
    // Two numbers on one row would be a bug generator on the client.
    expect(proc).toMatch(/participants\.map\(\(\{ frozenNumber: _frozen, \.\.\.p \}\) => p\)/);
  });
});

describe("what is welded to the identity needs no propagation at all", () => {
  it("threads are keyed by identity id, so they survive a renumber", () => {
    // pairKey is built from identity ids. If it were built from numbers, a
    // renumber would strand every DM thread — the loss the owner reported, in a
    // different disguise.
    const fn = V2DB.slice(V2DB.indexOf("export function pairKey"), V2DB.indexOf("function randomDigits6"));
    expect(fn).toMatch(/pairKey\(a: number, b: number\)/);
    expect(fn).toMatch(/\$\{a\}-\$\{b\}/);
  });

  it("call history, messages and membership reference identities, not numbers", () => {
    // Pinned on the schema so a future column can't quietly switch to a number.
    for (const decl of [
      /callerIdentityId: int\("callerIdentityId"\)/,
      /calleeIdentityId: int\("calleeIdentityId"\)/,
      /senderIdentityId: int\("senderIdentityId"\)/,
      /identityId: int\("identityId"\)/,
    ]) {
      expect(SCHEMA).toMatch(decl);
    }
  });
});
