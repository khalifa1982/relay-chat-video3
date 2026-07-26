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

/**
 * v2.99.12 — offline-return batch (owner: "when he logs in again he'll see the
 * notification on the main page and the icon keeps blinking if there's a
 * message or a missed call"). The missed-call landing popup existed; this adds
 * (a) unread MESSAGES to the same landing surface and (b) a blinking indicator.
 */
describe("v2.99.12 — offline-return: unread messages surface + blinking icon", () => {
  const CSS = read("../index.css");

  it("missed calls AND unread messages surface on RETURN — but no longer as a banner", () => {
    // v2.99.67 (owner): "the missed call notification, the way how it works, it's
    // not nice. Don't show it on the main screen as a side banner from up to
    // down. Show it only on the notification center on the top… and also on the
    // history." So the banner is no longer mounted. The REQUIREMENT it served —
    // that returning after time away surfaces both categories — is unchanged and
    // now lives on pull surfaces: the bell's badge and blink, its panel, and
    // History. The component itself is retained but unmounted.
    expect(SHELL).not.toMatch(/<AwaySummaryToast/);
    expect(MISSED).toMatch(/export function AwaySummaryToast/);
    // The bell counts BOTH categories and blinks for them…
    expect(MISSED).toMatch(/const total = missedCount \+ unreadCount \+ pendingDevices;/);
    expect(MISSED).toMatch(/const blink = missedCount \+ unreadCount > 0;/);
    // …and routes to the detail for each.
    expect(MISSED).toMatch(/onOpenHistory/);
    expect(MISSED).toMatch(/onOpenMessages/);
    expect(SHELL).toMatch(/<NotificationBell/);
  });

  it("the landing card re-surfaces on a NEW item via a TIMESTAMP watermark (counts are non-monotonic)", () => {
    // Counts fall when you review History (markMissedSeen) or read a thread, so
    // a count high-water mark goes stale-high and hides new activity. The
    // watermark keys on the latest-item TIMESTAMP, which only moves forward.
    expect(SHELL).toMatch(/latestMissedAt > seen\.missedAt/);
    expect(SHELL).toMatch(/latestMsgAt > seen\.msgAt/);
    expect(SHELL).toMatch(/const awayOpen = showMissedAlert \|\| showUnreadAlert/);
    // dismiss advances (never lowers) both watermarks
    expect(SHELL).toMatch(/missedAt: Math\.max\(latestMissedAt, seen\.missedAt\)/);
    expect(SHELL).toMatch(/relay_away_popup_seen_v2/);
  });

  it("the catch-up banner is a passive region, not a focus-trapping alertdialog", () => {
    expect(MISSED).toMatch(/role="region"/);
    expect(MISSED).not.toMatch(/role="alertdialog"/);
  });

  it("the bell + tab badges BLINK on a missed call / unread message, gated behind reduced-motion", () => {
    expect(MISSED).toMatch(/const blink = missedCount \+ unreadCount > 0/);
    expect(MISSED).toMatch(/relay-blink/);
    // blink CSS is inert unless the user allows motion
    expect(CSS).toMatch(/@media \(prefers-reduced-motion: no-preference\)/);
    expect(CSS).toMatch(/@keyframes relayBlink/);
    expect(CSS).toMatch(/\.relay-blink \{/);
    // applied to the Messages + History tab badges (sidebar + mobile)
    expect(SHELL).toMatch(/relay-blink inline-flex min-w-5/);
    expect(SHELL).toMatch(/relay-blink absolute -top-0\.5/);
  });

  it("the latest unread thread powers the messages row (group title or peer name)", () => {
    expect(SHELL).toMatch(/const latestUnread = useMemo/);
    expect(SHELL).toMatch(/top\.title \|\| top\.peerDisplayName \|\| top\.peerNumber/);
  });
});
