import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { anyOtherTabFresh, pruneTabs, makeTabId, TAB_FRESH_MS } from "./tabPresence";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const PRESENCE = read("client/src/app/PresenceManager.tsx");
const V2DB = read("server/v2db.ts");

/**
 * v2.99.32 — heavy-QA sweep fixes, batch 10 (presence).
 *
 *   M12 (MED): presence is one boolean per identity, but every tab runs its own
 *              PresenceManager — so closing ONE of two open tabs beaconed the
 *              whole identity offline while the other tab was live (contacts
 *              blink offline; the surviving tab's next heartbeat then fires a
 *              false "X is back online" watcher push). Fixed with a browser-
 *              scoped last-tab localStorage ref-count (tabPresence.ts): a tab
 *              only beacons offline when no OTHER tab of the identity is fresh.
 *   L4/TOCTOU: reapStalePresence SELECTed victims then UPDATEd — a victim that
 *              heartbeat back online in between wasn't flipped but was still
 *              returned to broadcast offline (spurious). Now returns only the
 *              rows genuinely offline after the update.
 */
describe("v2.99.32 QA M12 — tab ref-count decision logic (pure)", () => {
  const NOW = 1_000_000;
  it("a single tab (only mine) → no other tab alive → beacon fires", () => {
    expect(anyOtherTabFresh({ me: NOW }, "me", NOW)).toBe(false);
  });
  it("a second FRESH tab → another alive → skip the beacon", () => {
    expect(anyOtherTabFresh({ me: NOW, other: NOW - 5_000 }, "me", NOW)).toBe(true);
  });
  it("a STALE other tab (past the freshness window) doesn't count", () => {
    expect(anyOtherTabFresh({ me: NOW, dead: NOW - TAB_FRESH_MS - 1 }, "me", NOW)).toBe(false);
  });
  it("pruneTabs drops stale entries and keeps fresh ones", () => {
    const pruned = pruneTabs({ a: NOW - 1_000, b: NOW - TAB_FRESH_MS - 1 }, NOW);
    expect(pruned).toHaveProperty("a");
    expect(pruned).not.toHaveProperty("b");
  });
  it("makeTabId returns a non-empty string", () => {
    expect(typeof makeTabId()).toBe("string");
    expect(makeTabId().length).toBeGreaterThan(0);
  });
});

describe("v2.99.32 QA M12 — PresenceManager wiring", () => {
  it("records this tab on every visible heartbeat (touchTab)", () => {
    expect(PRESENCE).toMatch(/touchTab\(id, tabId, Date\.now\(\)\)/);
  });
  it("onLeave only beacons when no other tab is alive; removes the slot on a real close", () => {
    const fn = PRESENCE.slice(PRESENCE.indexOf("const onLeave ="), PRESENCE.indexOf("const onLeave =") + 700);
    expect(fn).toMatch(/if \(closing\) removeTab\(id, tabId, now\)/);
    expect(fn).toMatch(/if \(otherTabsAlive\(id, tabId, now\)\) return;/);
    expect(fn).toMatch(/beaconOffline\(\)/);
  });
  it("frees the tab slot on unmount (cleanup)", () => {
    expect(PRESENCE).toMatch(/removeTab\(id, tabId, Date\.now\(\)\); \/\/ leaving/);
  });
});

describe("v2.99.32 QA L4 — reaper returns only genuinely-flipped victims", () => {
  const fn = V2DB.slice(V2DB.indexOf("export async function reapStalePresence("), V2DB.indexOf("export async function reapStalePresence(") + 1800);
  it("re-confirms isOnline=false after the UPDATE (excludes race-reconnected users)", () => {
    expect(fn).toMatch(/inArray\(presence\.identityId, ids\), eq\(presence\.isOnline, false\)/);
    expect(fn).toMatch(/return confirmed;/);
    // fail-safe: a re-check error falls back to the captured victims
    expect(fn).toMatch(/return victims; \/\/ re-check failed/);
  });
});
