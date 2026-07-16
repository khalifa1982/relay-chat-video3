import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * v2.75 — History overhaul, static pins.
 *
 * The user spec: three filter tabs (All / Dialed / Missed) with intuitive
 * icons + a Clear History control on the right of the filter bar; every call
 * type logged with name-or-number, FULL date, precise time, duration, and the
 * PIN dialed; color coding missed = bright red, dialed = vibrant green,
 * received = clear blue; and the bottom nav stays fixed while the log scrolls.
 */
const ROOT = path.resolve(__dirname, "../../../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const PAGE = read("client/src/pages/app/History.tsx");
const ROUTERS = read("server/v2routers.ts");
const V2DB = read("server/v2db.ts");
const SCHEMA = read("drizzle/schema.ts");

describe("History page — filter tabs + Clear History", () => {
  it("exposes exactly three filters — All / Dialed / Missed — each with an icon", () => {
    expect(PAGE).toMatch(/\{ key: "all", label: "All", icon: Phone \}/);
    expect(PAGE).toMatch(/\{ key: "dialed", label: "Dialed", icon: PhoneOutgoing \}/);
    expect(PAGE).toMatch(/\{ key: "missed", label: "Missed", icon: PhoneMissed \}/);
    expect(PAGE).toMatch(/role="tablist"/);
  });

  it("has a Clear History trash button on the right of the filter bar, guarded by a confirm", () => {
    expect(PAGE).toMatch(/aria-label="Clear history"/);
    expect(PAGE).toMatch(/Trash2/);
    // v2.88: the guard is the shared AlertDialog pattern, not window.confirm().
    expect(PAGE).toMatch(/Clear your entire call history\?/);
    expect(PAGE).toMatch(/AlertDialog open=\{confirmClear\}/);
    expect(PAGE).not.toMatch(/window\.confirm\(/);
    expect(PAGE).toMatch(/trpc\.calls\.clearHistory\.useMutation/);
    // clearing refreshes everything the log feeds (badges included)
    expect(PAGE).toMatch(/utils\.calls\.missedSummary\.invalidate\(\)/);
  });

  it("filters actually narrow the list (dialed = outgoing, missed = incoming missed/declined)", () => {
    expect(PAGE).toMatch(/if \(filter === "dialed"\) return items\.filter\(\(it\) => it\.direction === "out"\)/);
    expect(PAGE).toMatch(/if \(filter === "missed"\) return items\.filter\(isMissedItem\)/);
  });
});

describe("History rows — color coding + full metadata", () => {
  it("uses LITERAL tone classes: missed bright red, dialed vibrant green, received clear blue", () => {
    // v2.88: theme-PAIRED shades (600 in light / 400 in dark) — the raw *-500
    // failed contrast on the light theme. Still full literal class strings.
    expect(PAGE).toMatch(/bg-red-500\/12 text-red-600 dark:text-red-400/);
    expect(PAGE).toMatch(/bg-green-500\/12 text-green-600 dark:text-green-400/);
    expect(PAGE).toMatch(/bg-blue-500\/12 text-blue-600 dark:text-blue-400/);
  });

  it("every row shows the FULL date + precise time, the duration, and the PIN", () => {
    expect(PAGE).toMatch(/formatFullWhen\(conf\.startedAt\)/);
    expect(PAGE).toMatch(/formatFullWhen\(call\.startedAt\)/);
    expect(PAGE).toMatch(/formatDuration\(conf\.durationSec\)/);
    const pins = PAGE.match(/PIN \{/g) || [];
    expect(pins.length).toBeGreaterThanOrEqual(2); // conference dialed PIN + solo peer PIN
  });

  it("derives a conference's direction from the roster order (the CALLER seeds the roster)", () => {
    expect(PAGE).toMatch(/c\.participants\[0\]\?\.isSelf \? "out" : "in"/);
  });

  it("unanswered OUTGOING dials are listed too (not just incoming missed)", () => {
    expect(PAGE).toMatch(/\["missed", "declined", "initiated", "ringing", "failed"\]\.includes\(c\.status\)/);
    expect(PAGE).toMatch(/"No answer"/);
  });

  it("page fills the shell with flex-1 (docked nav stays visible; the LIST scrolls, not the page)", () => {
    expect(PAGE).toMatch(/flex-1 min-h-0 flex-col/);
    expect(PAGE).not.toMatch(/pb-24/); // stale fixed-nav clearance — nav is in-flow since v2.73
    expect(PAGE).toMatch(/min-h-0 flex-1 overflow-y-auto/);
  });
});

describe("Clear History — server side (per-user soft clear)", () => {
  it("calls.clearHistory mutation exists and both list queries respect the cleared mark", () => {
    expect(ROUTERS).toMatch(/clearHistory: publicProcedure\.mutation/);
    expect(ROUTERS).toMatch(/listCallHistory\(me\.id, 100, clearedAt\)/);
    expect(ROUTERS).toMatch(/listConferenceHistory\(me\.id, 100, clearedAt\)/);
  });

  it("clearCallHistory stamps BOTH historyClearedAt and missedCallsSeenAt (no lingering badges)", () => {
    expect(V2DB).toMatch(/\.set\(\{ historyClearedAt: now, missedCallsSeenAt: now \}\)/);
  });

  it("the list helpers filter with startedAt > since (rows stay in the DB for the other party)", () => {
    const gtFilters = V2DB.match(/since \? gt\((callHistory|conferenceHistory)\.startedAt, since\) : undefined/g) || [];
    expect(gtFilters.length).toBe(2);
  });

  it("historyClearedAt is declared in the schema AND the additive boot-migrator", () => {
    expect(SCHEMA).toMatch(/historyClearedAt: timestamp\("historyClearedAt"\)/);
    expect(V2DB).toMatch(/ADD COLUMN `historyClearedAt` timestamp NULL/);
  });
});
