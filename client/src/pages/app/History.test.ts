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
import { filterItems } from "./History";

const PAGE = read("client/src/pages/app/History.tsx");
const ROUTERS = read("server/v2routers.ts");
const V2DB = read("server/v2db.ts");
const SCHEMA = read("drizzle/schema.ts");

describe("History page — filter tabs + Clear History", () => {
  it("exposes exactly four filters — All / Dialed / Received / Missed — each with an icon", () => {
    // v2.99.98 added Received at the owner's request; the count is asserted so a fifth
    // tab has to be a deliberate act rather than something that drifts in.
    expect(PAGE).toMatch(/\{ key: "all", label: "All", icon: Phone \}/);
    expect(PAGE).toMatch(/\{ key: "dialed", label: "Dialed", icon: PhoneOutgoing \}/);
    expect(PAGE).toMatch(/\{ key: "received", label: "Received", icon: PhoneIncoming \}/);
    expect(PAGE).toMatch(/\{ key: "missed", label: "Missed", icon: PhoneMissed \}/);
    const decl = PAGE.slice(PAGE.indexOf("const FILTERS"), PAGE.indexOf("];", PAGE.indexOf("const FILTERS")));
    expect(decl.match(/\{ key: "/g)?.length).toBe(4);
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
    // REWRITTEN in v2.99.98. This used to freeze the exact ternary that lived inside
    // `visible`, so it broke the moment the selection became a pure exported function
    // — while saying nothing about whether the filters actually filter. It is now a
    // BEHAVIOURAL check against that function, which is strictly stronger; the tab
    // semantics (including Received, and Received never containing a missed call) are
    // covered in full by historyGrouping.test.ts.
    const inbound = {
      kind: "solo" as const,
      key: "solo-1",
      at: 2,
      direction: "in" as const,
      call: { id: 1, direction: "in" as const, status: "missed", startedAt: new Date(2), other: null },
    };
    const outbound = {
      kind: "solo" as const,
      key: "solo-2",
      at: 1,
      direction: "out" as const,
      call: { id: 2, direction: "out" as const, status: "missed", startedAt: new Date(1), other: null },
    };
    const log = [inbound, outbound];
    expect(filterItems(log, "dialed").map((x) => x.key)).toEqual(["solo-2"]);
    expect(filterItems(log, "missed").map((x) => x.key)).toEqual(["solo-1"]);
    expect(filterItems(log, "all").length).toBe(2);
    // And the page routes its list through that one function rather than re-deriving.
    expect(PAGE).toMatch(/let v = filterItems\(items, filter\);/);
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

  it("every row shows the FULL date + precise time, the duration, and the number", () => {
    expect(PAGE).toMatch(/formatFullWhen\(conf\.startedAt\)/);
    expect(PAGE).toMatch(/formatFullWhen\(call\.startedAt\)/);
    expect(PAGE).toMatch(/formatDuration\(conf\.durationSec\)/);
    // v2.99.77 rewrote HOW the number is shown, at the owner's request: a bracketed
    // tag beside the NAME, in its own colour, with no "PIN" label — *"just put his
    // number ... in different color"*. Asserting the old `PIN {` literal would now
    // pin prose that was deliberately removed, so this asserts the new carrier.
    expect(PAGE).toMatch(/function PinTag\(/);
    const tags = PAGE.match(/<PinTag number=/g) || [];
    expect(tags.length).toBeGreaterThanOrEqual(2); // the 1:1-answered row + the solo row
    // The label is gone from the rendered rows.
    const codeOnly = PAGE.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
    expect(codeOnly).not.toMatch(/PIN \{/);
  });

  it("NEVER shows the viewer their own number (owner spec, v2.99.77)", () => {
    // *"you don't need to put my number because I know my PIN."* The roster is the
    // only place self ever appeared, and it is now groups-only and self-excluded.
    expect(PAGE).toMatch(/const others = conf\.participants\.filter\(\(p\) => !p\.isSelf\);/);
    expect(PAGE).toMatch(/\{isGroup && others\.length > 0 \?/);
    const codeOnly = PAGE.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
    expect(codeOnly).not.toMatch(/p\.isSelf \? "You"/);
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
    /* REWRITTEN in #117 to the PROPERTY. This froze the literal
       `listCallHistory(me.id, 100, clearedAt)` — the hardcoded page size AND the exact
       three-argument list — so it broke the moment paging added a cursor, while saying
       nothing about what it is actually for: that BOTH queries pass the per-user cleared
       mark, so paging can never become a way around "Clear history".
       The page size is now asserted through the named constant, which is stricter than
       the literal was: it also forbids the two queries silently disagreeing about it. */
    expect(ROUTERS).toMatch(/clearHistory: publicProcedure\.mutation/);
    expect(ROUTERS).toMatch(/listCallHistory\(me\.id, HISTORY_PAGE, clearedAt[,)]/);
    expect(ROUTERS).toMatch(/listConferenceHistory\(me\.id, HISTORY_PAGE, clearedAt[,)]/);
    expect(ROUTERS).toMatch(/const HISTORY_PAGE = 100;/);
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
