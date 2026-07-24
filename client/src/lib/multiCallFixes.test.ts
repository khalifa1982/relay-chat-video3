import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const engine = read("client/src/lib/relayClient.ts");

/**
 * Multi-call audit fixes. The client hold/swap/switch engine has no DOM-env test
 * harness, so these are source-pinned to lock the four fixes against regression
 * (the server halves are covered behaviorally in relay*.test.ts). Each assertion
 * targets the specific line the audit flagged.
 */
describe("multi-call engine fixes (source-pinned)", () => {
  it("§4a: error{full}/forbidden are fatal to a peerless joiner", () => {
    // v2.99.19 split the error codes: full/forbidden are JOIN errors (WE
    // couldn't join — an over-cap accept / a full-party-line dial), which must
    // still fail cleanly for a peerless joiner instead of stranding in a dead
    // call. (Reachability errors — offline/nonexistent — are handled separately
    // so a group call isn't torn down by one offline invitee.)
    const m = engine.match(/const joinErr =[^;]*;/s);
    expect(m).toBeTruthy();
    expect(m![0]).toMatch(/"full"/);
    expect(m![0]).toMatch(/"forbidden"/);
    // Both classes reach the fatal branch for a peerless dialer/joiner.
    expect(engine).toMatch(/\(reachErr \|\| joinErr\) && inCall && aloneInCall\(\)/);
  });

  it("§2b: onRingCancel dismisses a cancelled call-waiting popup", () => {
    const fn = engine.match(/function onRingCancel\(m: Msg\) \{[\s\S]*?\n  \}/);
    expect(fn).toBeTruthy();
    // Clears the matching waitingRing + hides the Switch popup.
    expect(fn![0]).toMatch(/waitingRing\s*=\s*null/);
    expect(fn![0]).toMatch(/hideCallWaiting\(\)/);
    expect(fn![0]).toMatch(/waitingRing\.from === m\.from/);
  });

  it("§2a: the far side leaving an active 1:1 RESUMES a held call, not hangUp", () => {
    // In removePeer's auto-end, a held call must be promoted (endActiveLine),
    // never torn down via hangUp→dropHeld.
    expect(engine).toMatch(/if \(heldRoomId\) \{\s*\n\s*toast\("Call ended — resuming your held call…"\);\s*\n\s*endActiveLine\(\);/);
  });

  it("§4b: group dial clamps to the transport cap (mesh 6 / SFU 10)", () => {
    expect(engine).toMatch(/const cap = livekitEnabled \? 10 : 6;/);
    expect(engine).toMatch(/deduped\.slice\(0, cap\)/);
    // The handle exposes the cap for the picker.
    expect(engine).toMatch(/maxParticipants\(\) \{ return livekitEnabled \? 10 : 6; \}/);
  });
});

describe("group-call picker uses the real cap", () => {
  it("GroupCallScreen reads engine.maxParticipants (no hardcoded 10)", () => {
    const gcs = read("client/src/pages/app/GroupCallScreen.tsx");
    // v2.99.27 (QA M19): reserve the caller's own slot — engine.maxParticipants
    // is the TOTAL room cap (incl. the caller), so invitees cap at cap−1.
    expect(gcs).toMatch(/const MAX_PARTICIPANTS = Math\.max\(1, engine\.maxParticipants - 1\)/);
    // The old module-level constant is gone.
    expect(gcs).not.toMatch(/const MAX_PARTICIPANTS = 10/);
  });

  it("RelayEngine surfaces maxParticipants with a safe default", () => {
    const re = read("client/src/app/RelayEngine.tsx");
    expect(re).toMatch(/maxParticipants: handleRef\.current\?\.maxParticipants\(\) \?\? 10/);
    expect(re).toMatch(/maxParticipants: 10/); // context default
  });
});
