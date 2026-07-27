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
    const at = PRESENCE.indexOf("const onLeave =");
    const fn = PRESENCE.slice(at, PRESENCE.indexOf("\n    };", at));
    expect(fn.length).toBeGreaterThan(200);
    // v2.99.92 dropped `onLeave`'s `closing` parameter: its only false caller was
    // `visibilitychange → hidden`, which now marks IDLE instead of beaconing
    // offline (owner: "whenever you minimize the app, the user showing offline, not
    // the idle"), so the false branch had become unreachable. The M12 property is
    // unchanged and is what this asserts — free the slot, then beacon only when no
    // other tab of this identity is alive.
    expect(fn).toMatch(/removeTab\(id, tabId, now\)/);
    expect(fn).not.toMatch(/closing/);
    expect(fn).toMatch(/if \(otherTabsAlive\(id, tabId, now\)\) return;/);
    expect(fn).toMatch(/beaconOffline\(\)/);
    // And hiding the tab must NOT reach this path any more.
    // Bounded by onVisibility's OWN end, not a 700-char window: the wider window ran
    // past it into `const onClose = () => onLeave();`, which legitimately calls it.
    const visAt = PRESENCE.indexOf("const onVisibility =");
    const visBody = PRESENCE.slice(visAt, PRESENCE.indexOf("\n    };", visAt));
    expect(visBody.length).toBeGreaterThan(120);
    expect(visBody).toMatch(/document\.visibilityState === "hidden"\) idleTick\(\)/);
    // COMMENT LINES STRIPPED. Without this the assertion matched the comment that
    // explains `onLeave(false)`'s removal — the sixth time in this repo that a
    // `not.toMatch` has passed or failed on its own prose rather than on code.
    const visCode = visBody
      .split("\n")
      .filter((l) => {
        const t = l.trim();
        return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
      })
      .join("\n");
    expect(visCode).not.toMatch(/onLeave\(/);
  });
  it("frees the tab slot on unmount (cleanup)", () => {
    expect(PRESENCE).toMatch(/removeTab\(id, tabId, Date\.now\(\)\); \/\/ leaving/);
  });
});

describe("v2.99.32 QA L4 — reaper returns only genuinely-flipped victims", () => {
  // Bounded by the function's own end: a fixed +1800 characters shrank as
  // v2.99.92's comments grew and cut the re-check clean out of the slice.
  const reapAt = V2DB.indexOf("export async function reapStalePresence(");
  const fn = V2DB.slice(reapAt, V2DB.indexOf("\n}", V2DB.indexOf("return victims;", reapAt)));
  expect(fn.length).toBeGreaterThan(800);
  it("re-confirms isOnline=false after the UPDATE (excludes race-reconnected users)", () => {
    expect(fn).toMatch(/inArray\(presence\.identityId, ids\), eq\(presence\.isOnline, false\)/);
    expect(fn).toMatch(/return confirmed;/);
    // fail-safe: a re-check error falls back to the captured victims
    expect(fn).toMatch(/return victims; \/\/ re-check failed/);
  });
});
