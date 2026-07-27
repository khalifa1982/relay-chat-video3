import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { contactUpdateKeys, isGuestPresenceHidden, GUEST_PRESENCE_TTL_MS } from "./v2db";

/**
 * Guest presence privacy (v2.36): a GUEST inactive for >24h has their presence
 * COMPLETELY suppressed (no online dot, no "offline", no "last seen"). Registered
 * users always show presence; a live or recently-seen guest still shows status.
 */
describe("isGuestPresenceHidden — 24h guest privacy", () => {
  const now = 1_000_000_000_000;
  it("never hides a REGISTERED user's presence (even if long offline)", () => {
    expect(
      isGuestPresenceHidden({ isGuest: false, isOnline: false, lastSeenAt: new Date(0) }, now),
    ).toBe(false);
  });
  it("never hides an ONLINE guest", () => {
    expect(
      isGuestPresenceHidden({ isGuest: true, isOnline: true, lastSeenAt: new Date(now) }, now),
    ).toBe(false);
  });
  it("shows a guest seen WITHIN 24h (so 'last seen' still renders)", () => {
    const seen = new Date(now - (GUEST_PRESENCE_TTL_MS - 60_000));
    expect(isGuestPresenceHidden({ isGuest: true, isOnline: false, lastSeenAt: seen }, now)).toBe(false);
  });
  it("HIDES a guest inactive for >24h", () => {
    const seen = new Date(now - (GUEST_PRESENCE_TTL_MS + 60_000));
    expect(isGuestPresenceHidden({ isGuest: true, isOnline: false, lastSeenAt: seen }, now)).toBe(true);
  });
  it("HIDES a guest with no presence record at all", () => {
    expect(isGuestPresenceHidden({ isGuest: true, isOnline: false, lastSeenAt: null }, now)).toBe(true);
  });
});

/**
 * Rich-contact upsert + the additive boot-migrator (v2.24).
 *
 * `contactUpdateKeys` decides which columns an upsert overwrites on conflict —
 * only the ones the caller passed, so a partial update can't wipe saved fields
 * (this fixes a latent bug where toggling Favourite, which omits avatarUrl/
 * notes, would null them out).
 */
describe("contactUpdateKeys — partial-update preservation", () => {
  it("a favourite toggle only updates the fields it passed (not avatarUrl/notes/email)", () => {
    const keys = contactUpdateKeys({ number: "482015", displayName: "Anya", favourite: true });
    expect(keys).toEqual(["displayName", "favourite"]);
    expect(keys).not.toContain("avatarUrl");
    expect(keys).not.toContain("notes");
    expect(keys).not.toContain("email");
  });

  it("a full edit updates every provided rich field", () => {
    const keys = contactUpdateKeys({
      number: "482015",
      displayName: "Anya",
      avatarUrl: null,
      favourite: false,
      notes: "friend",
      email: "a@b.co",
      phone: "+1",
      company: "Acme",
      jobTitle: "CTO",
      website: "acme.co",
      birthday: "Mar 14",
    });
    expect(keys).toEqual([
      "displayName", "avatarUrl", "favourite", "notes",
      "email", "phone", "company", "jobTitle", "website", "birthday",
    ]);
  });

  it("falls back to a harmless 'number' self-assignment when nothing updatable is passed", () => {
    expect(contactUpdateKeys({ number: "482015" })).toEqual(["number"]);
  });

  it("ignores keys that aren't real updatable columns", () => {
    const keys = contactUpdateKeys({ number: "1", ownerId: 5, bogus: 1, email: "x@y.z" });
    expect(keys).toEqual(["email"]);
  });
});

describe("ensureSchemaExtensions — additive only (never destructive)", () => {
  // Static-analysis guard: the boot migrator must only ever ADD COLUMN. A stray
  // DROP/ALTER/TRUNCATE here would silently destroy live data, so pin it.
  const SRC = readFileSync(resolve(__dirname, "v2db.ts"), "utf8");
  const fnBody = SRC.slice(
    SRC.indexOf("export async function ensureSchemaExtensions"),
    SRC.indexOf("export async function listContacts")
  );

  /**
   * Comments stripped, so a destructive-SQL sweep cannot be satisfied — or tripped —
   * by prose. Both are real failure modes: a comment quoting `DROP TABLE` to explain
   * why the migrator never does it would hide nothing, and a comment naming the
   * "delete for me" feature must not read as a DELETE statement.
   */
  const codeSql = (x: string) =>
    x
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((l) => !/^\s*\/\//.test(l))
      .join("\n");

  it("contains an ensureSchemaExtensions function", () => {
    expect(fnBody.length).toBeGreaterThan(50);
  });

  it("every DDL string is an ADD COLUMN or ADD [UNIQUE] INDEX — no DROP/RENAME/TRUNCATE/DELETE", () => {
    const ddls = [...fnBody.matchAll(/ddl:\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(ddls.length).toBeGreaterThan(0);
    for (const d of ddls) {
      // v2.88 widened the migrator to also apply hot-path INDEXES — still
      // strictly additive (an index never touches data). v2.99.43 (M47) adds a
      // UNIQUE index (one identity per user); also additive, and the migrator's
      // per-item catch means it simply logs and moves on where existing rows
      // would violate it, so boot is never blocked.
      expect(d, d).toMatch(/^ADD (COLUMN|(UNIQUE )?INDEX) /);
    }
    // The whole-function sweep below used to be case-INSENSITIVE, which made it a
    // guard against PROSE as well as SQL: v2.102.2's `message_hides` table is for the
    // "delete for me" feature, so the comment naming it tripped /\bDELETE\b/i inside a
    // function containing no DELETE statement at all. Scanning prose is a proxy for
    // what this test actually cares about, and it produced a false positive on a
    // correct migration.
    //
    // So the sweep is now case-SENSITIVE (SQL keywords in this file are written upper
    // case — every DDL string above proves it) and matches the destructive STATEMENT
    // forms rather than bare words. That is strictly tighter on what it exists to
    // catch: `DELETE` alone could never distinguish a comment from a statement, while
    // `DELETE FROM` cannot appear by accident.
    expect(codeSql(fnBody)).not.toMatch(/\bDROP\s+(TABLE|COLUMN|INDEX|DATABASE)\b/);
    expect(codeSql(fnBody)).not.toMatch(/\bTRUNCATE\b/);
    expect(codeSql(fnBody)).not.toMatch(/\bDELETE\s+FROM\b/);
    expect(codeSql(fnBody)).not.toMatch(/\bRENAME\b/);
    // …and every CREATE is guarded, so a boot can never clobber an existing table.
    // On STRIPPED sql, for the same reason as the sweep above — and this assertion
    // proved it by failing on v2.102.0's comment "the CREATE TABLE never re-runs".
    for (const c of [...codeSql(fnBody).matchAll(/CREATE TABLE[^`]*/g)].map((m) => m[0])) {
      expect(c, c).toMatch(/^CREATE TABLE IF NOT EXISTS/);
    }
  });

  it("swallows the duplicate-column AND duplicate-key errors so it's safe to run on every boot", () => {
    expect(fnBody).toMatch(/duplicate column/i);
    // MySQL reports a re-added index as "Duplicate key name" — swallow that
    // flavor too, or every boot after the first logs a scary warning.
    expect(fnBody).toMatch(/duplicate key name/i);
  });
});
