import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { contactUpdateKeys } from "./v2db";

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

  it("contains an ensureSchemaExtensions function", () => {
    expect(fnBody.length).toBeGreaterThan(50);
  });

  it("every DDL string is an ADD COLUMN — no DROP/RENAME/TRUNCATE/DELETE", () => {
    const ddls = [...fnBody.matchAll(/ddl:\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(ddls.length).toBeGreaterThan(0);
    for (const d of ddls) {
      expect(d, d).toMatch(/^ADD COLUMN /);
    }
    expect(fnBody).not.toMatch(/\bDROP\b/i);
    expect(fnBody).not.toMatch(/\bTRUNCATE\b/i);
    expect(fnBody).not.toMatch(/\bDELETE\b/i);
  });

  it("swallows the duplicate-column error so it's safe to run on every boot", () => {
    expect(fnBody).toMatch(/duplicate column/i);
  });
});
