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
    // The cap comes from ONE definition (v2.106.48 consolidated three copies of
    // a per-transport ternary, because every reader must agree with the cap and a
    // fallback that disagrees with the cap the user was shown is its own bug). So the
    // property is the VALUES and the single source, not the expression's old spelling.
    expect(engine).toMatch(/const MESH_MAX = 6;/);
    /* v2.106.53: one rung, so one number. It stays a FUNCTION rather than becoming a
       bare constant, because three copies of the old per-transport ternary had to be
       consolidated once already and every reader must agree with the cap the picker
       showed the user. */
    expect(engine).not.toMatch(/SFU_MAX/);
    /* #170 rewrote this from the one-line body `{ return MESH_MAX; }` — which
       this test's own comment two lines up already says is NOT the property —
       to what it stands for: ONE definition, reached by every reader, whose
       default is the mesh number. The body now returns `roomPartyMax`, which
       the server states on the room ack, so the picker cannot offer a party the
       accept then refuses. Freezing the old spelling would have forbidden
       exactly that fix. */
    expect(engine).toMatch(/function transportMax\(\): number \{ return roomPartyMax; \}/);
    expect(engine).toMatch(/let roomPartyMax = MESH_MAX;/);
    expect(engine).toMatch(/const cap = transportMax\(\);/);
    expect(engine).toMatch(/deduped\.slice\(0, cap\)/);
    // The handle still exposes the cap for the picker, through the same definition.
    expect(engine).toMatch(/maxParticipants\(\) \{ return transportMax\(\); \}/);
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
