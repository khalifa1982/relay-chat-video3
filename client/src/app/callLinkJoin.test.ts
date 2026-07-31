import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { inviteTargetFromSearch } from "./OnboardingGate";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

/**
 * Call-link direct-join (owner: "paramount"). A shared invite link
 * (`/i/<pin>` → `/app/join?to=<pin>` since #109) must land a not-yet-identified
 * clicker on a FOCUSED "enter your name to connect" card — not the generic
 * marketing login — then straight into the dial. These pin the URL parser + the
 * presence of the focused-join affordance so a redesign can't silently regress it
 * back to the full login wall.
 *
 * #109 replaced the card's BODY with the shared `InviteCard` (one component for
 * this screen and the signed-in `/app/join` one) and left every property below
 * intact, which is why they all still hold.
 */
describe("inviteTargetFromSearch — pull the call target out of the URL", () => {
  it("extracts a 6-digit ?to= target", () => {
    expect(inviteTargetFromSearch("?to=800165")).toBe("800165");
    expect(inviteTargetFromSearch("to=800165")).toBe("800165");
    expect(inviteTargetFromSearch("?to=800165&video=1")).toBe("800165");
  });

  it("strips non-digits and caps at 6", () => {
    expect(inviteTargetFromSearch("?to=800-165")).toBe("800165");
    expect(inviteTargetFromSearch("?to=8001650000")).toBe("800165");
  });

  it("returns null for absent / malformed / short targets", () => {
    expect(inviteTargetFromSearch("")).toBe(null);
    expect(inviteTargetFromSearch("?foo=bar")).toBe(null);
    expect(inviteTargetFromSearch("?to=800")).toBe(null); // too short
    expect(inviteTargetFromSearch("?to=")).toBe(null);
  });
});

describe("OnboardingGate — focused call-link join UI", () => {
  const src = read("client/src/app/OnboardingGate.tsx");

  it("branches on a URL call target to a focused join card", () => {
    expect(src).toMatch(/inviteTargetFromSearch/);
    expect(src).toMatch(/const showJoin\b/);
    // The join CTA — distinct from the generic "Enter as guest".
    expect(src).toMatch(/Join call/);
    expect(src).toMatch(/Enter your name to connect/);
  });

  it("resolves who's being called via the public directory.lookup", () => {
    expect(src).toMatch(/directory\.lookup\.useQuery/);
    // Enabled only when there's a target and no identity yet.
    expect(src).toMatch(/enabled:\s*!!callTarget/);
  });

  it("keeps a sign-in escape and a party-line variant", () => {
    expect(src).toMatch(/Have a RELAY account/);
    expect(src).toMatch(/Join the line/);
  });
});

describe("v2.99.15 — a guest can't call an OFFLINE user from a call link", () => {
  const GATE = read("client/src/app/OnboardingGate.tsx");
  it("blocks the join only when the callee cannot be RUNG (party lines exempt)", () => {
    /* REWRITTEN FROM PRESENCE TO REACHABILITY, and the old pin is why this needed
       saying: it froze `!invitee.isOnline`, i.e. it pinned the defect. Presence is
       bound to a live socket session, so a backgrounded or locked phone reads
       offline — and that is exactly the phone a VoIP push wakes (verified in
       production: APNs 200, full-screen CallKit with the app not in the
       foreground). Gating a call on presence therefore refused calls to most of
       the user base most of the time, for a limitation that no longer exists.

       What survives is the ONE honest guard: somebody with no device to ring at
       all still cannot be called, because a guest has no thread to leave a message
       on and a call that wakes nothing must not be offered. */
    expect(GATE).toMatch(
      /const calleeUnreachable =\s*inviteResolved && !isPartyLine && !!invitee && !\(invitee\.reachable \?\? true\)/,
    );
    expect(GATE).toMatch(/const numberNotFound = inviteResolved && !isPartyLine && !invitee/);
    expect(GATE).toMatch(/const joinBlocked = numberNotFound \|\| calleeUnreachable/);
    expect(GATE).toMatch(/disabled=\{!name\.trim\(\) \|\| startGuestPending \|\| joinBlocked\}/);
  });
  it("no longer gates the call on presence anywhere in this screen", () => {
    // The property the rewrite exists for, asserted as an ABSENCE so it cannot
    // creep back: `isOnline` may be DISPLAYED (the card shows a presence dot) but
    // must never decide whether the join is allowed.
    const code = GATE.replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    expect(code).not.toMatch(/joinBlocked[^\n]*isOnline/);
    expect(code).not.toMatch(/isOnline[^\n]*&&[^\n]*joinBlocked/);
    // ...and the block must be derived from `reachable`, not from anything else.
    expect(code).toMatch(/calleeUnreachable[\s\S]{0,120}reachable/);
  });
  it("FAILS OPEN when the server predates the reachable field", () => {
    // A rolling deploy serves both bundles for ~60s. `?? true` is what stops that
    // window becoming a calling outage: no field ⇒ offer the call and let the dial
    // report the truth, which is the behaviour that shipped before this change.
    expect(GATE).toMatch(/invitee\.reachable \?\? true/);
  });
  it("fails OPEN on a lookup error so a transient hiccup never strands a real caller", () => {
    expect(GATE).toMatch(/invite\.isFetched && !invite\.isError/);
  });
  it("tells a blocked guest why, without promising something nothing can keep", () => {
    /* The old copy said "you can reach them once they're back online". For the state
       that remains — no device at all — coming online is not what would change it,
       so that sentence was a promise nothing can keep. It now names the real
       condition, and the word "offline" is gone from this branch entirely, because
       an offline-but-installed phone IS callable now. */
    expect(GATE).toMatch(/Can't be reached/);
    expect(GATE).toMatch(/no device we can ring/);
    expect(GATE).not.toMatch(/They're offline — can't call/);
    expect(GATE).not.toMatch(/once they're back online/i);
  });
});
