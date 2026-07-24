import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const V2DB = read("server/v2db.ts");

/**
 * v2.99.30 — heavy-QA sweep fixes, batch 8 (number-allocation races).
 *
 *   M20 (MED): identities and party_lines share ONE 6-digit number space, each
 *              with a per-TABLE unique key — but MySQL can't enforce uniqueness
 *              ACROSS two tables, so two concurrent allocations targeting
 *              DIFFERENT tables could both pass the check-then-insert
 *              numberTaken gate and claim the same fresh number. Both allocators
 *              now first INSERT the candidate into a shared number_reservations
 *              ledger (PK on `number`); the unique key serializes concurrent
 *              allocations across BOTH tables, so a collision is impossible.
 *   L8  (LOW): createPartyLine's per-owner cap was owned.length >= MAX then
 *              insert (check-then-act) — two concurrent creates at count 9 both
 *              passed. The cap is now enforced deterministically AFTER insert
 *              by the row's id-RANK: rows ranked > MAX self-delete and reject.
 *
 * DB-less vitest, so these are source-pinned to the exact mechanisms.
 */
describe("v2.99.30 QA M20 — shared cross-table number reservation", () => {
  it("a number_reservations ledger with a PK on `number` is created by the migrator", () => {
    expect(V2DB).toMatch(/CREATE TABLE IF NOT EXISTS \\`number_reservations\\`/);
    expect(V2DB).toMatch(/PRIMARY KEY \(\\`number\\`\)/);
  });
  it("tryReserveNumber INSERTs atomically, retries on duplicate, and fails OPEN otherwise", () => {
    const fn = V2DB.slice(
      V2DB.indexOf("async function tryReserveNumber"),
      V2DB.indexOf("async function allocateSharedNumber"),
    );
    expect(fn).toMatch(/INSERT INTO \\`number_reservations\\`/);
    // v2.99.37 (M24): duplicate detection keys on mysql's STABLE machine-readable
    // markers first, because this helper fails OPEN — recognizing the duplicate
    // only by the error TEXT meant any driver/locale change silently turned a
    // lost race into "reservation won", reintroducing the cross-table collision.
    // The text sniff is retained purely as a fallback.
    expect(fn).toMatch(/errno === 1062/);
    expect(fn).toMatch(/ER_DUP_ENTRY/);
    expect(fn).toMatch(/\/duplicate\/i\.test\(/);
    // any other error (e.g. table missing on first boot) → true = behave as pre-ledger
    expect(fn).toMatch(/return true; \/\/ table missing/);
  });
  it("allocateSharedNumber gates on numberTaken THEN reserves, and both allocators use it", () => {
    // Window widened for v2.99.48's global mint budget (a guard added ahead of
    // the candidate loop); the ordering asserted below is unchanged.
    const fn = V2DB.slice(V2DB.indexOf("async function allocateSharedNumber"), V2DB.indexOf("async function allocateSharedNumber") + 1100);
    expect(fn).toMatch(/if \(await numberTaken\(db, candidate\)\) continue;/);
    expect(fn).toMatch(/if \(await tryReserveNumber\(db, candidate\)\) return candidate;/);
    // both public allocators delegate to the shared core
    expect(V2DB.slice(V2DB.indexOf("export async function allocateNumber"), V2DB.indexOf("export async function allocateNumber") + 200)).toMatch(/return allocateSharedNumber\(db\)/);
    expect(V2DB.slice(V2DB.indexOf("export async function allocatePartyLineNumber"), V2DB.indexOf("export async function allocatePartyLineNumber") + 400)).toMatch(/return allocateSharedNumber\(db\)/);
  });
});

describe("v2.99.30 QA L8 — party-line per-owner cap enforced after insert", () => {
  const fn = V2DB.slice(V2DB.indexOf("export async function createPartyLine"), V2DB.indexOf("export async function createPartyLine") + 2600);
  it("keeps the fast pre-check but enforces the cap by id-rank after insert", () => {
    expect(fn).toMatch(/owned\.length >= MAX_PARTY_LINES_PER_OWNER/); // fast pre-check retained
    // rank = count of the owner's rows with id <= this new row's id
    expect(fn).toMatch(/lte\(partyLines\.id, insertId\)/);
    expect(fn).toMatch(/Number\(rankRow\?\.rank \?\? 0\) > MAX_PARTY_LINES_PER_OWNER/);
  });
  it("an over-cap racer deletes its OWN row and rejects (no double-delete)", () => {
    const del = fn.indexOf("delete(partyLines).where(eq(partyLines.id, insertId))");
    expect(del).toBeGreaterThan(0);
    // the delete is followed by the cap-reached throw
    expect(fn.slice(del, del + 200)).toMatch(/You can have at most/);
  });
});
