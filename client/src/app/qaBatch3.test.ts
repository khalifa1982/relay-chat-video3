import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * v2.99.25 — heavy-QA sweep fixes, batch 3.
 *   H9 (HIGH): the landing onLookup wrapper swallowed a directory.lookup ERROR
 *              into null via `.catch(() => null)`, so a real online user whose
 *              lookup errored (shared-NAT rate-limit / transient 500) rendered
 *              as "NO RELAY USER" with CALL disabled; runLookup's documented
 *              fail-open was dead code.
 *   H4 (HIGH): AuthPanel's wasRegistration was set on register and never reset,
 *              so backing out and logging into an existing PIN-less account was
 *              routed into the broken "Finish setting up" screen (401s).
 *   H6 (HIGH): PresenceManager's 30s heartbeat had no visibility check, so a
 *              tab-hidden user was re-marked online → false "back online" pushes.
 */
const HOME = readFileSync(join(__dirname, "..", "pages", "Home.tsx"), "utf8");
const AUTH = readFileSync(join(__dirname, "AuthPanel.tsx"), "utf8");
const PRESENCE = readFileSync(join(__dirname, "PresenceManager.tsx"), "utf8");

describe("v2.99.25 QA H9 — landing lookup errors fail OPEN (not a false 'no user')", () => {
  it("the onLookup wrapper no longer swallows a lookup error into null", () => {
    const wrapper = HOME.slice(HOME.indexOf("onLookup: (number: string) =>"), HOME.indexOf("onLookup: (number: string) =>") + 400);
    expect(wrapper).toMatch(/utils\.directory\.lookup/);
    expect(wrapper).not.toMatch(/\.catch\(\(\) => null\)/);
  });
  it("runLookup still fails OPEN on a real rejection (FALLBACK + armed CALL)", () => {
    const fn = HOME.slice(HOME.indexOf("const runLookup ="), HOME.indexOf("const syncDial ="));
    expect(fn).toMatch(/\.catch\(\(\) => \{/);
    expect(fn).toMatch(/dialTarget = FALLBACK;/);
  });
});

describe("v2.99.25 QA H4 — a stale registration flag can't misroute a login into setup", () => {
  it("routeAfterProbe resets wasRegistration before routing", () => {
    const fn = AUTH.slice(AUTH.indexOf("async function routeAfterProbe"), AUTH.indexOf("async function routeAfterProbe") + 1200);
    expect(fn).toMatch(/setWasRegistration\(false\);/);
    // and the reset precedes the probe/route
    const resetAt = fn.indexOf("setWasRegistration(false)");
    const probeAt = fn.indexOf("loginProbe.mutateAsync");
    expect(resetAt).toBeGreaterThan(0);
    expect(resetAt).toBeLessThan(probeAt);
  });
});

describe("v2.99.25 QA H6 — the presence heartbeat never re-marks a hidden tab online", () => {
  it("the 30s tick skips the heartbeat when the document is hidden", () => {
    const at = PRESENCE.indexOf("const tick =");
    const fn = PRESENCE.slice(at, PRESENCE.indexOf("\n    };", at));
    expect(fn.length).toBeGreaterThan(200);
    expect(fn).toMatch(/document\.visibilityState === "hidden"\) return;/);
    // the hidden-guard must precede the heartbeat call inside tick
    const guardAt = fn.indexOf('visibilityState === "hidden"');
    const beatAt = fn.indexOf("heartbeat.mutate()");
    expect(guardAt).toBeGreaterThan(0);
    expect(guardAt).toBeLessThan(beatAt);
  });
});
