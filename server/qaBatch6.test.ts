import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { copyOnScreen } from "./testing/copyOnScreen";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const routers = read("server/v2routers.ts");
const contacts = read("client/src/pages/app/Contacts.tsx");

/**
 * v2.99.28 — heavy-QA sweep fixes, batch 6 (contacts / directory).
 *
 *   M18 (MED): directory.watchOnline had NO block check — a user the target
 *              BLOCKED could still arm a back-online watch and be told (with
 *              the target's name + a ready-to-dial link) the instant they came
 *              online. Now rejected, indistinguishably from "not a RELAY user".
 *   M14 (MED): contacts.list returned role "guest" for a saved number that
 *              does NOT resolve to an identity (a made-up / never-registered
 *              number), rendering a false blue "✓ Guest" badge on a non-user.
 *              Now returns role: null → no badge.
 *   M13 (MED): removing a BLOCKED contact silently unblocks them (the block
 *              lives on the contact row). The delete confirmation now WARNS.
 *
 * These are source-pinned: watchOnline is a tRPC procedure with no DB harness
 * here (its block helper is covered behaviorally in enumBlockHardening/relay
 * tests), and the badge/dialog fixes are UI. Each assertion targets the exact
 * line the finding flagged.
 */
describe("v2.99.28 QA M18 — watchOnline refuses a watcher the target blocked", () => {
  const fn = routers.slice(
    routers.indexOf("watchOnline: publicProcedure"),
    routers.indexOf("watchOnline: publicProcedure") + 2000
  );
  it("checks the target has not blocked me before arming the watch", () => {
    expect(fn).toMatch(/isNumberBlockedBy\(target\.id, me\.number\)/);
  });
  it("the block gate sits BEFORE addOnlineWatch", () => {
    const gateAt = fn.indexOf("isNumberBlockedBy(target.id, me.number)");
    const watchAt = fn.indexOf("addOnlineWatch(me.id, target.id)");
    expect(gateAt).toBeGreaterThan(0);
    expect(watchAt).toBeGreaterThan(gateAt);
  });
  it("responds identically to a non-user (NOT_FOUND) so the block isn't revealed", () => {
    // The block-branch throw reuses the exact not-a-RELAY-user message.
    const blockIdx = fn.indexOf("isNumberBlockedBy(target.id, me.number)");
    const tail = fn.slice(blockIdx, blockIdx + 220);
    expect(tail).toMatch(/code: "NOT_FOUND"/);
    expect(tail).toMatch(/isn't a RELAY user yet/);
  });
});

describe("v2.99.28 QA M14 — contacts.list gives an unresolved number no badge", () => {
  it("returns role: null (not 'guest') when the saved number has no identity", () => {
    expect(routers).toMatch(
      /role: \(ident != null \? \(rolesById\.get\(ident\) \?\? "guest"\) : null\) as IdentityRole \| null/
    );
  });
  it("the client ContactRow role prop accepts null", () => {
    expect(contacts).toMatch(/role\?: "guest" \| "registered" \| "admin" \| null;/);
  });
});

describe("v2.99.28 QA M13 — removing a blocked contact warns it also unblocks", () => {
  const dlg = contacts.slice(
    contacts.indexOf('{t("contacts.removeTitle")}'),
    contacts.indexOf('{t("contacts.removeTitle")}') + 900
  );
  it("the delete confirmation shows a block warning when the contact is blocked", () => {
    expect(dlg).toMatch(/deletingContact\?\.blocked/);
    expect(copyOnScreen(dlg, "also unblocks them")).toBe(true);
  });
});
