import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const DIALER = readFileSync(resolve(process.cwd(), "client/src/pages/app/Dialer.tsx"), "utf8");

/**
 * v2.99.17 — a NONEXISTENT dialed number offers NO actions (owner screenshot:
 * "888 888 · No RELAY user with this number" still showed active Voice/Video/
 * Group buttons AND a "Save to contacts" pill). A number that resolves to no
 * RELAY user can't be called, group-called, or saved. Existing-but-offline
 * users and party lines are unaffected; a lookup error / still-loading FAILS
 * OPEN so a transient hiccup never blocks a real number.
 */
describe("v2.99.17 — nonexistent dialed number disables call/group/save", () => {
  it("nonexistent is a SUCCESSFUL resolve-to-null (fails open on error/loading)", () => {
    expect(DIALER).toMatch(
      /const nonexistent =\s*\n\s*\/\^\\d\{6\}\$\/\.test\(dialed\) && dialed !== myNumber && previewQuery\.isSuccess && !previewIdentity;/
    );
  });

  it("callable excludes a nonexistent number (Voice + Video buttons already gate on !callable)", () => {
    expect(DIALER).toMatch(/engineReady && !nonexistent;/);
    // both call buttons disable on !callable
    expect((DIALER.match(/disabled=\{!callable\}/g) || []).length).toBeGreaterThanOrEqual(2);
  });

  it("the Group Call button is disabled for a nonexistent number (was previously always enabled)", () => {
    expect(DIALER).toMatch(/disabled=\{nonexistent\}/);
  });

  it("the Save-to-contacts pill is hidden for a nonexistent number", () => {
    expect(DIALER).toMatch(/!previewIdentity\?\.partyLine && !nonexistent \?/);
  });

  it("startCallNow refuses to dial a nonexistent number defensively", () => {
    expect(DIALER).toMatch(/if \(nonexistent\) return;/);
  });
});
