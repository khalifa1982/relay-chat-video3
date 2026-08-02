import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * v2.99.27 — heavy-QA sweep fixes, batch 5 (group-call invitee handling).
 *   M19 (MED): the group-call picker used the TOTAL room cap (mesh 6 / SFU 10,
 *              which INCLUDES the caller) as the count of OTHERS to invite, so
 *              the last acceptee hit a full room; reserve the caller's slot (−1)
 *              in both the picker and programmaticGroupDial.
 *   L7  (LOW): the picker accepted the caller's OWN number as an invitee.
 *   M2  (MED): answering call-waiting DURING an unanswered outgoing dial parked
 *              the empty dial room as "held" (nothing to resume; dialed party
 *              kept ringing). switchCall now cancels the dial instead.
 * (L1 — group dial where everyone declines hangs 65s — deferred; needs
 *  outstanding-invitee tracking + device testing.)
 */
const PICKER = readFileSync(join(__dirname, "GroupCallScreen.tsx"), "utf8");
const ENGINE = readFileSync(join(__dirname, "..", "..", "lib", "relayClient.ts"), "utf8");

describe("v2.99.27 QA M19/L7 — group-call picker reserves the caller's slot + rejects self", () => {
  it("caps invitees at maxParticipants − 1 (the caller occupies one slot)", () => {
    expect(PICKER).toMatch(/const MAX_PARTICIPANTS = Math\.max\(1, engine\.maxParticipants - 1\)/);
  });
  it("programmaticGroupDial clamps to (cap − 1) too", () => {
    // The property is "one fewer than the transport cap", not the arithmetic's old
    // spelling — v2.106.48 routes every cap site through `transportMax()`.
    expect(ENGINE).toMatch(/const cap = transportMax\(\) - 1;/);
    /* #170: the property is "one definition, defaulting to the mesh number",
       not the body's old spelling — which is what the comment above already
       said and what the previous assertion contradicted. */
    expect(ENGINE).toMatch(/function transportMax\(\): number \{ return roomPartyMax; \}/);
    expect(ENGINE).toMatch(/let roomPartyMax = MESH_MAX;/);
  });
  it("the picker rejects the caller's own number (toggle + addManual)", () => {
    expect(PICKER).toMatch(/if \(number === engine\.pin\) return;/);
    expect(PICKER).toMatch(/if \(n === engine\.pin\) \{ setManual\(""\); return; \}/);
  });
});

describe("v2.99.27 QA M2 — answering call-waiting during an unanswered dial cancels the dial", () => {
  it("switchCall abandons an unanswered outgoing dial instead of parking an empty held room", () => {
    const fn = ENGINE.slice(ENGINE.indexOf("function switchCall()"), ENGINE.indexOf("function switchCall()") + 1700);
    expect(fn).toMatch(/if \(outgoingDial && !establishedOnce\) \{/);
    expect(fn).toMatch(/abandon-dial-for-incoming/);
    // the park path is the ELSE branch now
    const dialAt = fn.indexOf("abandon-dial-for-incoming");
    const parkAt = fn.indexOf("parkActiveAsHeld()");
    expect(dialAt).toBeGreaterThan(0);
    expect(parkAt).toBeGreaterThan(dialAt);
  });
});
