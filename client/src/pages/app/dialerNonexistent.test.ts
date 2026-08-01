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

  it("the Save-to-contacts button is withheld for a nonexistent number", () => {
    /* REWRITTEN v2.106.78 TO THE PROPERTY. This used to freeze the pill's exact
       inline condition, ending `?` — i.e. it pinned the fact that the decision
       was made AT THE MOUNT, which is precisely what changed when the owner
       asked for the button to move from its own row below the keypad to inline
       beside the entered digits. It said nothing about the rule it stands for.

       The rule is: a number the lookup PROVED does not exist gets no
       add-to-contacts affordance, because you cannot save a contact who is not
       a RELAY user. So it is asserted on the decision itself wherever that
       lives, plus the fact that the mount reads that decision rather than
       re-deriving it — one condition, one place, which is what stops the two
       drifting the next time the button moves. */
    const decision = DIALER.slice(DIALER.indexOf("const quickAddTarget"));
    expect(decision.length, "found the decision").toBeGreaterThan(80);
    expect(decision.slice(0, 300)).toMatch(/!previewIdentity\?\.partyLine && !nonexistent/);
    expect(decision.slice(0, 300)).toMatch(/\bdialed !== myNumber\b/);
    // The mount consumes it and does not restate any of it.
    expect(DIALER).toMatch(/\{quickAddTarget \?/);
    expect(
      (DIALER.match(/const quickAddTarget/g) || []).length,
      "exactly one decision"
    ).toBe(1);
  });

  it("startCallNow refuses to dial a nonexistent number defensively", () => {
    expect(DIALER).toMatch(/if \(nonexistent\) return;/);
  });
});
