import { describe, it, expect } from "vitest";
import { planRenumber } from "./v2db";

/**
 * Pure collision logic for propagating a regenerated PIN across every contact's
 * address book (server/v2db.ts regenerateIdentityNumber applies this plan).
 */
describe("planRenumber — PIN propagation to contacts", () => {
  it("rewrites every contact that saved the old number", () => {
    const rows = [
      { id: 1, ownerId: 10, number: "111111" },
      { id: 2, ownerId: 20, number: "111111" },
      { id: 3, ownerId: 30, number: "999999" }, // unrelated → untouched
    ];
    const plan = planRenumber(rows, "111111", "222222");
    expect([...plan.updateIds].sort()).toEqual([1, 2]);
    expect(plan.deleteIds).toEqual([]);
  });

  it("drops a stale (owner,new) duplicate so the unique key can't collide", () => {
    const rows = [
      { id: 1, ownerId: 10, number: "111111" }, // owner 10's contact for the renumberer
      { id: 2, ownerId: 10, number: "222222" }, // owner 10 ALSO already has a 222222 contact
    ];
    const plan = planRenumber(rows, "111111", "222222");
    expect(plan.updateIds).toEqual([1]);
    expect(plan.deleteIds).toEqual([2]);
  });

  it("no-ops when old === new", () => {
    expect(planRenumber([{ id: 1, ownerId: 1, number: "555555" }], "555555", "555555")).toEqual({
      updateIds: [],
      deleteIds: [],
    });
  });

  it("ignores rows holding neither number", () => {
    expect(planRenumber([{ id: 9, ownerId: 1, number: "333333" }], "111111", "222222")).toEqual({
      updateIds: [],
      deleteIds: [],
    });
  });
});
