import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * v2.81 — mutual-consent video protocol (1:1), static pins. Verified live in
 * scratchpad/consent-e2e.mjs (all three cases, both directions):
 *   1. video dial + Video answer → both cameras on;
 *   2. voice dial: ring hides the Video answer; camera tap sends a REQUEST
 *      (nothing transmits), the peer's prompt accepts → both cameras on;
 *   3. Voice answer on a video dial stands the caller's camera down; a later
 *      request can be declined → everything stays voice-only.
 */
const ROOT = path.resolve(__dirname, "../../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const CLIENT = read("client/src/lib/relayClient.ts");
const ASSETS = read("client/src/lib/relayAssets.ts");
const SERVER = read("server/relay.ts");

describe("mutual-consent video — 1:1 protocol", () => {
  it("state machine + gate exist and reset per call", () => {
    expect(CLIENT).toMatch(/let videoApproved = false;/);
    expect(CLIENT).toMatch(/let callIsGroup = false;/);
    expect(CLIENT).toMatch(/videoApproved = false; callIsGroup = false; callGroupName = null; \/\/ consent is per-call/);
  });

  it("camera tap in an un-approved 1:1 call sends a REQUEST — it never enables the camera directly", () => {
    expect(CLIENT).toMatch(/if \(!camOn && videoGateActive\(\) && !screenSharing\) \{\s*\n\s*requestVideoUpgrade\(\);\s*\n\s*return;/);
    expect(CLIENT).toMatch(/sendWS\(\{ type: "video-request" \}\);/);
  });

  it("the callee's answer choice IS the consent on a video dial (accept/decline sent AFTER `accept`)", () => {
    expect(CLIENT).toMatch(/if \(r\.video && !opts\?\.voice\) videoApproved = true;/);
    expect(CLIENT).toMatch(/if \(r\.video\) sendWS\(\{ type: opts\?\.voice \? "video-decline" : "video-accept" \}\);/);
  });

  it("a voice-dialed ring HIDES the Video answer button and labels the mode", () => {
    // v2.97: the round buttons carry labels in a wrapper, so the WRAPPER hides.
    expect(CLIENT).toMatch(/vWrap\.style\.display = m\.video \? "" : "none";/);
    expect(CLIENT).toMatch(/ringSub\.textContent = m\.video \? "Video call…" : "Voice call…";/);
  });

  it("publication is consent-gated at every point video can start flowing", () => {
    /* The SFU's publish gate went with that transport (v2.106.53). The two that
       remain are the ones that matter on the mesh: `createPeer` decides whether a
       video track joins the peer connection at all, and the mid-call re-assert
       refuses to fill a sender that consent has not opened. */
    expect(CLIENT).toMatch(/const consentOk = videoApproved \|\| callIsGroup;/);
    // The re-assert refuses to fill a sender consent has not opened.
    const re = CLIENT.slice(CLIENT.indexOf("function ensureApprovedVideoFlowing()"));
    expect(re.slice(0, 400)).toMatch(/!\(videoApproved \|\| callIsGroup\)/);
    // And `createPeer` decides whether a video track joins the connection at all.
    expect(CLIENT).toMatch(/consentOk \? \(sendStream\.getVideoTracks\(\)\[0\] \|\| null\) : null/);
  });

  it("consent arriving before the transport settles still starts video (re-assert on connect)", () => {
    expect(CLIENT).toMatch(/function ensureApprovedVideoFlowing\(\)/);
    expect(CLIENT).toMatch(/ensureApprovedVideoFlowing\(\); \/\/ consent may have landed before this pc existed/);
  });

  it("declining keeps everything voice-only; the video-dial caller stands down", () => {
    expect(CLIENT).toMatch(/function onVideoDecline\(\) \{[\s\S]*?if \(camOn\) setCam\(false\);/);
  });

  it("groups bypass the gate (2nd remote flips callIsGroup) and rejoin/resume keep consent settled", () => {
    const flips = CLIENT.match(/callIsGroup = true;/g) || [];
    expect(flips.length).toBeGreaterThanOrEqual(3); // group dial + both roster-growth paths
    const resumes = CLIENT.match(/videoApproved = true; \/\/ resuming an established call/g) || [];
    expect(resumes.length).toBe(2); // onRejoin + onResumed
  });

  it("the in-call consent prompt exists and is wired (accept turns video on + replies)", () => {
    for (const id of ["videoAsk", "vaName", "vaAccept", "vaDecline"]) expect(ASSETS).toContain('id="' + id + '"');
    expect(CLIENT).toMatch(/unlockApprovedVideo\(\);\s*\n\s*sendWS\(\{ type: "video-accept" \}\);/);
  });

  it("1:1 calls END when the other party leaves (a dead solo call swallowed the next ring)", () => {
    const ends = CLIENT.match(/hangUp\("remote-left"\);/g) || [];
    expect(ends.length).toBe(2); // mesh removePeer + SFU removeLkTile
  });

  it("the server relays the consent messages to the room and flags rings with the dialed mode", () => {
    expect(SERVER).toMatch(/case "video-request":\s*\n\s*case "video-accept":\s*\n\s*case "video-decline": \{/);
    // v2.89: the invite body captures the dialed mode once as `wantVideo`
    // (the party-line resolver defers the flow, so !!msg.video is snapshotted
    // up front); the ring envelope still carries it.
    expect(SERVER).toMatch(/const wantVideo = !!msg\.video;/);
    expect(SERVER).toMatch(/video: wantVideo,/);
  });
});
