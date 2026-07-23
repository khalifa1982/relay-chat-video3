import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * v2.99.7 — new-device login approval (owner spec).
 *
 * A new EMAIL-CODE sign-in on an account that has another ONLINE device parks
 * as `pendingApproval` and does NOT authenticate until an existing device
 * approves it — UNLESS the 4-digit PIN was used (that bypasses approval). The
 * DB/context wiring needs a live MySQL, so the safety-critical invariants are
 * pinned against source (the repo's convention for DB/express behavior), the
 * same way v2.99.1's revocable sessions are pinned in deviceSessions.test.ts.
 *
 * The invariants that must never silently regress:
 *   1. a PENDING session does NOT authenticate (sessionState maps it to
 *      "revoked" so the context's existing `state !== "revoked"` gate blocks it
 *      with no context change);
 *   2. the feature is fail-SAFE against lockout — approval is required only
 *      when another device was active recently, and every gate/poll fails OPEN;
 *   3. PIN login never requires approval.
 */
const ROOT = path.resolve(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const V2DB = read("server/v2db.ts");
const ROUTERS = read("server/v2routers.ts");
const CTX = read("server/_core/context.ts");
const EVENTS = read("server/v2events.ts");

describe("pending sessions never authenticate (v2.99.7)", () => {
  it("sessionState maps a pending row to 'revoked' (blocked by the unchanged context gate)", () => {
    const fn = V2DB.slice(V2DB.indexOf("export async function sessionState"), V2DB.indexOf("export async function hasRecentApprovedSession"));
    expect(fn).toMatch(/pending: sessions\.pendingApproval/);
    expect(fn).toMatch(/rows\[0\]\.pending == null \? "active" : "revoked"/);
    // The context gate itself is untouched (deviceSessions.test.ts pins this line).
    expect(CTX).toMatch(/if \(state !== "revoked"\)/);
  });
  it("the waiting device's own-cookie poll fails OPEN ('approved') on DB trouble", () => {
    const fn = V2DB.slice(V2DB.indexOf("export async function sessionApprovalBySid"), V2DB.indexOf("export async function approveSession"));
    expect(fn).toMatch(/if \(!db\) return "approved";/);
    expect(fn).toMatch(/catch \{\s*return "approved";\s*\}/);
    expect(fn).toMatch(/rows\.length === 0\) return "denied"/); // row gone = denied
    expect(fn).toMatch(/rows\[0\]\.pending == null \? "approved" : "pending"/);
  });
});

describe("fail-safe against lockout (v2.99.7)", () => {
  it("hasRecentApprovedSession returns false on any DB trouble (never require an approver we can't prove)", () => {
    const fn = V2DB.slice(V2DB.indexOf("export async function hasRecentApprovedSession"), V2DB.indexOf("export async function pendingSessionsForUser"));
    expect(fn).toMatch(/if \(!db\) return false;/);
    expect(fn).toMatch(/catch \{\s*return false;\s*\}/);
    // Only counts APPROVED (pendingApproval IS NULL) sessions active since a cutoff.
    expect(fn).toMatch(/isNull\(sessions\.pendingApproval\)/);
    expect(fn).toMatch(/gte\(sessions\.lastSeenAt, cutoff\)/);
  });
  it("approval is required only when another device was active recently", () => {
    expect(ROUTERS).toMatch(/const NEW_DEVICE_APPROVAL_WINDOW_MS =/);
    expect(ROUTERS).toMatch(/async function shouldRequireApproval\(userId: number\)/);
    expect(ROUTERS).toMatch(/return hasRecentApprovedSession\(userId, NEW_DEVICE_APPROVAL_WINDOW_MS\)/);
  });
});

describe("login paths (v2.99.7)", () => {
  it("verifyOtp parks a NON-registration sign-in that needs approval; a fresh registration never waits", () => {
    const fn = ROUTERS.slice(ROUTERS.indexOf("verifyOtp: publicProcedure"), ROUTERS.indexOf("resendOtp: publicProcedure"));
    expect(fn).toMatch(/const wasRegistration = !!\(row\.firstName \|\| row\.lastName\)/);
    expect(fn).toMatch(/const pending = !wasRegistration && \(await shouldRequireApproval\(userId\)\)/);
    expect(fn).toMatch(/await startSession\(ctx, userId, pending\)/);
    expect(fn).toMatch(/return \{ ok: true, verified: true, pending: true \}/);
    expect(fn).toMatch(/announcePendingDevice\(userId, sid, label\)/);
  });
  it("loginWithPin is the bypass — it never calls the approval gate", () => {
    const fn = ROUTERS.slice(ROUTERS.indexOf("loginWithPin: publicProcedure"), ROUTERS.indexOf("setLoginPin: publicProcedure"));
    expect(fn).toContain("loginWithPin"); // slice is non-empty
    expect(fn).not.toMatch(/shouldRequireApproval/);
  });
  it("startSession threads the pending flag into recordSession (default false = byte-identical to before)", () => {
    expect(ROUTERS).toMatch(/async function startSession\([\s\S]*?pending = false,/);
    expect(ROUTERS).toMatch(/await recordSession\(sid, userId, label, pending\)/);
    expect(V2DB).toMatch(/export async function recordSession\(sid: string, userId: number, label: string, pending = false\)/);
    expect(V2DB).toMatch(/pendingApproval: pending \? new Date\(\) : null/);
  });
});

describe("approval procedures + realtime (v2.99.7)", () => {
  it("exposes sessionApprovalStatus (public, own-cookie), pendingSessions (auth), approveSession (ownership-scoped)", () => {
    expect(ROUTERS).toMatch(/sessionApprovalStatus: publicProcedure/);
    expect(ROUTERS).toMatch(/readLocalSession\(ctx\.req\)/);
    expect(ROUTERS).toMatch(/pendingSessions: publicProcedure/);
    expect(ROUTERS).toMatch(/approveSession: publicProcedure/);
    // approveSession clears the pending stamp only for the user's own sid.
    expect(V2DB).toMatch(/and\(eq\(sessions\.userId, userId\), eq\(sessions\.sid, sid\)\)/);
    expect(V2DB).toMatch(/\.set\(\{ pendingApproval: null \}\)/);
  });
  it("a device_pending SSE kind exists and is published to the account identity", () => {
    expect(EVENTS).toMatch(/kind: "device_pending"; sid: string; label: string/);
    expect(ROUTERS).toMatch(/publishToIdentity\(identity\.id, \{ kind: "device_pending", sid, label \}\)/);
  });
  it("the pending session column is added by the additive boot migrator (NULL = every legacy row)", () => {
    expect(V2DB).toMatch(/column: "pendingApproval", ddl: "ADD COLUMN `pendingApproval` timestamp NULL"/);
  });
});
