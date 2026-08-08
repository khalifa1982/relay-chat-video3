/**
 * NUMBER REASSIGNMENTS (v2.107.79) — the pins.
 *
 * Three identities move into the reserved `111` vanity block at boot. The whole
 * safety story is that this migration writes NOTHING itself: every pair goes
 * through claimIdentityNumberAsAdmin → regenerateIdentityNumber, the codebase's
 * single writer of identities.number, and therefore inherits the row-locked
 * transaction, contact propagation, history rewrite and reservation-ledger
 * retirement that renumbering already means. What this file defends is exactly
 * that indirection — the day someone "simplifies" this into raw UPDATEs is the
 * day contacts strand on a number nobody holds.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { NUMBER_REASSIGNMENTS } from "./v2db";

const DB = readFileSync(resolve(__dirname, "v2db.ts"), "utf8");
const ENTRY = readFileSync(resolve(__dirname, "_core/index.ts"), "utf8");

describe("the owner's list, verbatim", () => {
  it("exactly the three pairs, old → new", () => {
    expect(NUMBER_REASSIGNMENTS).toEqual([
      ["997140", "111115"],
      ["414319", "111113"],
      ["812424", "111114"],
    ]);
  });

  it("every target sits in a RESERVED prefix — the allocator can never have minted it to a stranger", () => {
    for (const [, to] of NUMBER_REASSIGNMENTS) {
      expect(to.startsWith("111") || to.startsWith("000")).toBe(true);
    }
  });
});

describe("the migration is three calls into the single writer, not SQL", () => {
  it("goes through claimIdentityNumberAsAdmin and never touches identities.number itself", () => {
    const fn = DB.slice(
      DB.indexOf("export async function ensureNumberReassignments"),
      DB.indexOf("export async function ensureSchemaExtensions"),
    );
    expect(fn).toMatch(/claimIdentityNumberAsAdmin\(src\.id, to\)/);
    expect(fn).not.toMatch(/update\(identities\)|UPDATE `?identities`?/i);
  });

  it("is idempotent: a completed pair logs 'already done' and a missing source is skipped", () => {
    const fn = DB.slice(
      DB.indexOf("export async function ensureNumberReassignments"),
      DB.indexOf("export async function ensureSchemaExtensions"),
    );
    expect(fn).toMatch(/already done \(held by identity/);
    expect(fn).toMatch(/source not found — skipped/);
    // Per-pair isolation: one refusal cannot stop the rest or block boot.
    expect(fn).toMatch(/catch \(e\)/);
  });

  it("runs at boot, after the schema ensure, and never blocks startup", () => {
    expect(ENTRY).toMatch(/await ensureNumberReassignments\(\)\.catch/);
    expect(ENTRY.indexOf("ensureSchemaExtensions().catch")).toBeLessThan(
      ENTRY.indexOf("ensureNumberReassignments().catch"),
    );
  });
});

describe("the new numbers are reachable once assigned", () => {
  it("plain lookups do not apply the reserved-prefix refusal (that rule is mint-time only)", () => {
    // getIdentityByNumber is a bare eq() — the refusal lives in
    // normalizeDesiredNumber (claiming), not in resolution. If someone ever
    // routes lookups through the claim normalizer, dialing 111112 dies.
    const lookup = DB.slice(
      DB.indexOf("export async function getIdentityByNumber"),
      DB.indexOf("export async function getIdentityByNumber") + 400,
    );
    expect(lookup).toMatch(/eq\(identities\.number, number\)/);
    expect(lookup).not.toMatch(/RESERVED_PREFIXES|normalizeDesiredNumber/);
  });
});
