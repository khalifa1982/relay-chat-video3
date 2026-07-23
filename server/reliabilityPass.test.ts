import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

/**
 * Regression tests for the 2026-07-23 reliability pass (a bug hunt across
 * calling/messaging/onboarding, independently verified against source before
 * any change). The affected code isn't reachable in the unit env without a DOM
 * or a MySQL connection, so — following the repo's existing precedent
 * (status.test.ts / securityAudit.test.ts) — these pin the fixes by reading
 * the source.
 */

describe("getOrCreateDmConversation self-heals an orphaned/racing DM thread", () => {
  const src = read("server/v2db.ts");
  const fn = src.slice(
    src.indexOf("export async function getOrCreateDmConversation"),
    src.indexOf("export async function createGroupConversation")
  );
  it("ensures participant rows on EVERY return path, not just the create branch", () => {
    // The old shape returned `existing[0]` immediately, before the participant
    // upsert — so a conversation row that ever committed without its
    // participant rows (a transient failure between the two separate inserts,
    // there being no transaction) stayed broken forever: every later call hit
    // the early return and handed back a thread neither user could actually
    // use. The fix runs the participant upsert unconditionally.
    expect(fn).not.toMatch(/if \(existing\.length > 0\) return existing\[0\];/);
    expect(fn).toMatch(/if \(existing\.length > 0\) \{\s*convo = existing\[0\];/);
    expect(fn).toMatch(/\.insert\(conversationParticipants\)/);
  });
  it("the participant upsert is reached after BOTH branches (create and existing)", () => {
    // Only one insert(conversationParticipants) call exists — it must sit
    // after the if/else that sets `convo`, not inside just one arm.
    const upsertIdx = fn.indexOf(".insert(conversationParticipants)");
    const ifIdx = fn.indexOf("if (existing.length > 0)");
    const returnIdx = fn.lastIndexOf("return convo;");
    expect(upsertIdx).toBeGreaterThan(ifIdx);
    expect(returnIdx).toBeGreaterThan(upsertIdx);
  });
});
