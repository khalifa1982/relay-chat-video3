import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * v2.74 — staged call-progress flow (caller side), static pins.
 *
 * The phone-style sequence the product spec requires:
 *   PIN entered → "Calling…"  (invite sent, pulsing indicator)
 *   server ack  → "Ringing…"  (callee's device confirmed alerting)
 *   answer      → "Connecting…" (session establishing)
 *   established → full in-call interface (and ONLY then)
 * Plus: a voice dial keeps video disabled until explicitly enabled in-call;
 * a video dial connects with the camera live and says so on the dial card.
 */
const ROOT = path.resolve(__dirname, "../../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const CLIENT = read("client/src/lib/relayClient.ts");
const ASSETS = read("client/src/lib/relayAssets.ts");
const SERVER = read("server/relay.ts");
const DIALER = read("client/src/pages/app/Dialer.tsx");

describe("staged call progress — Calling → Ringing → Connecting → connected", () => {
  it("the status machine knows the two pre-answer stages with phone wording", () => {
    expect(CLIENT).toMatch(/calling: "Calling…"/);
    expect(CLIENT).toMatch(/ringing: "Ringing…"/);
    expect(CLIENT).toMatch(/type CallStatus = "calling" \| "ringing" \| "connecting" \| "encrypting" \| "live" \| "reconnecting"/);
  });

  it("every outgoing dial enters the pre-connect flow (dial card + staged status), not the connecting sequence", () => {
    const outgoingEntries = CLIENT.match(/enterCallUI\([^)]*\{ outgoing: true \}\)/g) || [];
    expect(outgoingEntries.length).toBe(3); // startCall + programmaticDial + programmaticGroupDial
    expect(CLIENT).toMatch(/if \(opts\?\.outgoing\) \{[\s\S]*?setCallStatus\("calling"\);[\s\S]*?showDialCard\(\);/);
  });

  it("the server's `ringing` ack flips the status only while still unanswered", () => {
    expect(CLIENT).toMatch(/case "ringing":[\s\S]*?if \(inCall && outgoingDial && !callAnswered\) \{[\s\S]*?setCallStatus\("ringing"\);/);
  });

  it("the server acks the caller once the ring is delivered (callee pin + registered name)", () => {
    // v2.89: the invite body moved into runIdentityInvite (party-line resolver
    // runs first), so the caller's socket is the captured `callerSocket`.
    expect(SERVER).toMatch(/safeSend\(callerSocket, \{ type: "ringing", pin: to, name: target\.name \}\)/);
  });

  it("answering advances Ringing… to the REAL connecting sequence (both mesh and SFU paths)", () => {
    expect(CLIENT).toMatch(/function onCalleeAnswered\(\) \{[\s\S]*?if \(!establishedOnce\) runConnSequence\(\);/);
    const hooks = CLIENT.match(/onCalleeAnswered\(\);/g) || [];
    expect(hooks.length).toBeGreaterThanOrEqual(2); // createPeer (mesh) + addLkTile (SFU)
  });

  it("SFU: the caller's own uplink no longer claims Connected while the callee is still ringing", () => {
    expect(CLIENT).toMatch(/if \(!outgoingDial \|\| callAnswered\) markEstablished\(\);/);
    expect(CLIENT).not.toMatch(/clearLkWatchdog\(\);\s*\n\s*markEstablished\(\); \/\/ SFU media is up/);
  });

  it("SFU: first REMOTE track subscribing is what establishes an outgoing call", () => {
    expect(CLIENT).toMatch(/TrackSubscribed[\s\S]{0,400}if \(!establishedOnce\) markEstablished\(\);/);
  });

  it("the FULL in-call interface appears only upon establishment (markEstablished exits pre-connect)", () => {
    expect(CLIENT).toMatch(/function markEstablished\(\) \{[\s\S]*?exitPreConnect\(\);/);
    expect(CLIENT).toMatch(/function hangUp[\s\S]{0,700}exitPreConnect\(\);/);
  });
});

describe("pre-connect dial screen (dedicated calling card)", () => {
  it("the call screen carries a dial card: avatar, number, name, mode chip, live status", () => {
    for (const id of ["dialCard", "dcAv", "dcNum", "dcName", "dcMode", "dcStatusTxt"]) {
      expect(ASSETS).toContain('id="' + id + '"');
    }
  });

  it("pre-connect hides every control EXCEPT End Call, and the grid", () => {
    expect(ASSETS).toMatch(/#call\.pre-connect \.ctrl-bar \.ctrl\{display:none\}/);
    expect(ASSETS).toMatch(/#call\.pre-connect \.ctrl-bar \.ctrl\.hangup\{display:flex\}/);
    expect(ASSETS).toMatch(/#call\.pre-connect \.call-main \.grid\{display:none\}/);
  });

  it("Calling/Ringing get their own pulsing status-dot styles (top bar + card)", () => {
    expect(ASSETS).toMatch(/\.ct\.st-calling \.live-dot/);
    expect(ASSETS).toMatch(/\.ct\.st-ringing \.live-dot/);
    expect(ASSETS).toMatch(/\.dial-card\.st-ringing \.dc-dot/);
  });

  it("the live status is mirrored onto the dial card as the stage advances", () => {
    expect(CLIENT).toMatch(/\$\("dcStatusTxt"\); if \(dst\) dst\.textContent = text;/);
  });
});

describe("voice-first video defaults", () => {
  it("a Voice Dial starts with the camera OFF (tap-to-enable in-call)", () => {
    expect(CLIENT).toMatch(/if \(opts\?\.voice && localStream && localStream\.getVideoTracks\(\)\.length > 0\) \{\s*\n\s*setCam\(false\);/);
  });

  it("SFU voice calls never publish a video track at all (and 1:1 video needs mutual consent)", () => {
    expect(CLIENT).toMatch(/if \(camOn && \(videoApproved \|\| callIsGroup\)\) \{\s*\n\s*for \(const t of send\.getVideoTracks\(\)\) await publishSafe\(t, "camera"\);/);
  });

  it("the dial card visually confirms the session mode from the start (Video call vs Voice call chip)", () => {
    expect(CLIENT).toMatch(/md\.textContent = d\.video \? "Video call" : "Voice call";/);
    expect(ASSETS).toMatch(/\.dc-mode\.video\{/);
  });

  it("the Dialer labels the card with the callee's directory name when known", () => {
    expect(DIALER).toMatch(/displayName = previewQuery\.data\?\.displayName \|\| undefined/);
    expect(DIALER).toMatch(/engine\.dial\(dialed, \{ \.\.\.opts, displayName \}\)/);
  });
});

describe("v2.78.1 — answered-call reliability (zombie-call fixes)", () => {
  it("the caller reacts to the ANSWER via signaling (peer-joined) on BOTH media paths — not LiveKit events alone", () => {
    expect(CLIENT).toMatch(/refreshHostPanel\(\);[\s\S]{0,900}callAnswered = true;\s*\n\s*onCalleeAnswered\(\);[\s\S]{0,300}if \(livekitEnabled\) return;/);
  });

  it("outgoing dials carry a no-answer backstop: armed at dial, cleared on answer and on teardown", () => {
    expect(CLIENT).toMatch(/function armDialTimeout\(\)/);
    // v2.83: the no-answer teardown routes through failDial so the outcome is
    // SHOWN on the dial card first (the old instant hangUp hid the toast —
    // the engine root parks at opacity-0 the moment phase flips to idle).
    expect(CLIENT).toMatch(/failDial\("No answer — they'll see your missed call\.", "no-answer"\)/);
    expect(CLIENT).toMatch(/showDialCard\(\);\s*\n\s*armDialTimeout\(\);/);
    expect(CLIENT).toMatch(/function onCalleeAnswered\(\) \{\s*\n\s*clearDialTimeout\(\);/);
    expect(CLIENT).toMatch(/clearDialTimeout\(\); \/\/ an ended call must never fire a stale "No answer\."/);
  });

  it("a dying call PROMOTES a waiting second caller to a real incoming ring — never auto-declines them", () => {
    expect(CLIENT).toMatch(/const promotedRing = waitingRing;/);
    expect(CLIENT).toMatch(/if \(promotedRing && !destroyed\) \{/);
    expect(CLIENT).not.toMatch(/if \(waitingRing\) declineWaiting\(\); \/\/ reject any pending second caller/);
  });

  it("the server refuses to rejoin a room of GHOSTS (every other member's client record gone)", () => {
    expect(SERVER).toMatch(/const connectedOthers = members\.filter\(m => reg\.clients\.has\(m\.pin\)\)\.length;/);
    expect(SERVER).toMatch(/members\.length === 0 \|\| connectedOthers === 0/);
  });
});
