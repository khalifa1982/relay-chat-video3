import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * v2.61 persistent missed-call notification system — static guards pinning the
 * cross-cutting wiring (server query, landing popup, badges, dialer alert) so it
 * can't silently regress. The DB path is exercised manually against the live DB.
 */
const read = (p: string) => fs.readFileSync(path.resolve(__dirname, p), "utf8");
const MISSED = read("MissedCalls.tsx");
const SHELL = read("AppShell.tsx");
const ROUTER = read("../../../server/v2routers.ts");
const DB = read("../../../server/v2db.ts");
const SCHEMA = read("../../../drizzle/schema.ts");
const DIALER = read("../pages/app/Dialer.tsx");

describe("missed-call notification system", () => {
  it("server exposes a missedSummary query and a markMissedSeen mutation", () => {
    expect(ROUTER).toMatch(/missedSummary:\s*publicProcedure\.query/);
    expect(ROUTER).toMatch(/markMissedSeen:\s*publicProcedure\.mutation/);
  });

  it("unseen missed calls are filtered by the per-identity high-water mark", () => {
    expect(DB).toMatch(/function listUnseenMissedCalls/);
    expect(DB).toMatch(/function markMissedCallsSeen/);
    // only INCOMING missed/declined calls count
    expect(DB).toMatch(/inArray\(callHistory\.status, \["missed", "declined"\]\)/);
    expect(DB).toMatch(/gt\(callHistory\.startedAt, seenAt\)/);
  });

  it("the schema + boot-migrator add the missedCallsSeenAt column additively", () => {
    expect(SCHEMA).toMatch(/missedCallsSeenAt: timestamp\("missedCallsSeenAt"\)/);
    expect(DB).toMatch(/ADD COLUMN `missedCallsSeenAt` timestamp NULL/);
  });

  it("the landing popup identifies the caller and routes to the dialer", () => {
    expect(MISSED).toMatch(/export function MissedCallToast/);
    expect(MISSED).toMatch(/latest\.name/);
    expect(SHELL).toMatch(/navigate\("\/app\/history\?filter=missed"\)/);
  });

  it("the notification bell badges with missed + unread and the History tab badges missed", () => {
    expect(MISSED).toMatch(/export function NotificationBell/);
    expect(MISSED).toMatch(/missedCount \+ unreadCount/);
    // History tab carries its own (destructive) missed-count badge
    expect(SHELL).toMatch(/tab\.key === "history" && missedCount > 0/);
  });

  it("reviewing the History tab acknowledges the missed calls", () => {
    expect(SHELL).toMatch(/onHistory && missedCount > 0/);
    expect(SHELL).toMatch(/markSeen\.mutate\(\)/);
  });

  it("the dialer shows a Missed Call alert when arrived from the popup", () => {
    expect(DIALER).toMatch(/get\("missed"\) === "1"/);
    expect(DIALER).toMatch(/Missed Call/);
  });
});
