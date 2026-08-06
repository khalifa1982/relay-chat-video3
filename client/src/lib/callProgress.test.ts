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

  it("the server's `ringing` ack flips the status only while still unanswered — and only for GROUP dials", () => {
    // v2.105.12 gave the ack a second flavour: `paging` labels it "Reaching their
    // phone…" because a woken-by-push callee is not audibly ringing yet.
    // v2.107.51 (owner) then scoped the whole flip to GROUP dials: a one-to-one
    // dial stays "Calling…" until answered (the staged Ringing/Reaching text read
    // wrong on a direct call and duplicated the pill). The unanswered GUARD is
    // unchanged — an ack arriving after the call was answered must never rewind
    // the status — and the group-only branch is now pinned alongside it.
    expect(CLIENT).toMatch(/case "ringing":[\s\S]*?if \(inCall && outgoingDial && !callAnswered\) \{[\s\S]*?if \(outgoingDial\.group\) \{[\s\S]*?setCallStatus\("ringing", m\.paging \? "Reaching their phone…" : undefined\);/);
  });

  it("the server acks the caller once the ring is delivered (callee pin + registered name)", () => {
    // v2.89: the invite body moved into runIdentityInvite (party-line resolver
    // runs first), so the caller's socket is the captured `callerSocket`.
    expect(SERVER).toMatch(/safeSend\(callerSocket, \{ type: "ringing", pin: to, name: target\.name \}\)/);
  });

  it("answering advances Ringing… to the REAL connecting sequence (both mesh and SFU paths)", () => {
    /* REWRITTEN TO THE PROPERTY. This froze the exact one-liner
       `if (!establishedOnce) runConnSequence();` — so it FORBADE bounding the answered-but-silent
       call (v2.106.37) while saying nothing about what it exists to protect: that answering leaves
       "Ringing…" and enters the real connecting sequence, on BOTH transports, and only while the
       call has not already established.
       It is now stricter than the literal was, because the advance is only safe if something also
       bounds it: `onCalleeAnswered` cancels the 65s no-answer backstop, so it must hand over to the
       establishment deadline in the same breath or the call is bounded by nothing at all. */
    const at = CLIENT.indexOf("function onCalleeAnswered() {");
    expect(at, "onCalleeAnswered must exist").toBeGreaterThan(-1);
    const body = CLIENT.slice(at, CLIENT.indexOf("\n  }", at));
    expect(body, "the advance is gated on not having established").toMatch(/if \(!establishedOnce\)/);
    expect(body, "…and it enters the real connecting sequence").toMatch(/runConnSequence\(\)/);
    expect(body, "the 65s backstop is cancelled here").toMatch(/clearDialTimeout\(\)/);
    expect(body, "so coverage MUST pass to the establishment deadline").toMatch(
      /armEstablishDeadline\(\)/,
    );
    const hooks = CLIENT.match(/onCalleeAnswered\(\);/g) || [];
    expect(hooks.length).toBeGreaterThanOrEqual(2); // createPeer (mesh) + addLkTile (SFU)
  });

  it("only REMOTE media establishes an outgoing call, never our own uplink", () => {
    /* v2.106.53 replaces two SFU-path pins with the property they both stood for.
       The defect they were written against: a caller who had brought its own uplink
       up reported "Connected" while the callee was still ringing. On the mesh there
       is only one establishment signal — the peer connection reaching `connected`,
       which requires the other side — so the property holds by construction and what
       is pinned is that nothing ELSE calls it. */
    const calls = CLIENT.match(/markEstablished\(\)/g) || [];
    expect(calls.length, "declaration + a small, reviewable set of callers").toBeLessThanOrEqual(5);
    expect(CLIENT).toMatch(/if \(st === "connected"\) \{[\s\S]{0,400}markEstablished\(\);/);
    // A timer must never stand in for real media.
    expect(CLIENT).not.toMatch(/setTimeout\([^)]*markEstablished/);
  });

  it("the FULL in-call interface appears only upon establishment (markEstablished exits pre-connect)", () => {
    expect(CLIENT).toMatch(/function markEstablished\(\) \{[\s\S]*?exitPreConnect\(\);/);
    /* 2026-08-01 REBOUNDED. This sliced a FIXED 700 characters from `function hangUp`,
       so it broke the moment a line was legitimately added near the top of that
       function (the native `webCallEnded` notify) while saying nothing about the
       property: an ended call must leave the pre-connect dial card. The recurring
       fixed-slice fragility CLAUDE.md records at v2.99.78 — now bounded by the
       function's OWN end, with the slice asserted to be real first. */
    const hAt = CLIENT.indexOf("function hangUp");
    expect(hAt, "hangUp is gone").toBeGreaterThan(-1);
    const hang = CLIENT.slice(hAt, CLIENT.indexOf("\n  }", hAt));
    expect(hang.length, "the hangUp slice collapsed").toBeGreaterThan(400);
    expect(hang).toMatch(/exitPreConnect\(\);/);
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
    // display:GRID, not flex (v2.98.3): .ctrl centers its glyph via grid +
    // place-items; the old flex un-hide pinned the handset to the left edge.
    expect(ASSETS).toMatch(/#call\.pre-connect \.ctrl-bar \.ctrl\.hangup\{display:grid\}/);
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
    // REWRITTEN v2.106.44 to the PROPERTY. This froze the exact guard
    // `opts?.voice && localStream && localStream.getVideoTracks().length > 0`,
    // which REQUIRED a video track to exist — precisely what a voice call no
    // longer has now that it opens no camera at all. Frozen, it forbade the fix
    // and would have left a lit camera button over a camera nobody opened.
    // The property is: a voice dial stands the camera state down, and it does
    // so UNCONDITIONALLY rather than only when a track happens to be there.
    expect(CLIENT).toMatch(/if \(opts\?\.voice\) setCam\(false\)/);
    expect(CLIENT).not.toMatch(/opts\?\.voice && localStream && localStream\.getVideoTracks\(\)\.length > 0/);
    // …and no camera is acquired for it in the first place.
    expect(CLIENT).toMatch(/ensureMedia\(!opts\?\.voice\)/);
  });

  it("a voice call opens no camera at all, and 1:1 video needs mutual consent", () => {
    /* The SFU form of this pinned that no video track was PUBLISHED. On the mesh
       the stronger version holds one step earlier: `acquireRawStream` is asked for
       no camera at all in voice mode, so there is nothing to publish — and the
       consent gate still governs whether an acquired camera may transmit. */
    expect(CLIENT).toMatch(/wantVideo/);
    expect(CLIENT).toMatch(/videoApproved \|\| callIsGroup/);
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
  it("the caller reacts to the ANSWER via signaling (peer-joined), never a media event", () => {
    /* This is what fixed the zombie call: a media event that never fires left the
       caller at "Ringing…" forever while the callee's side died with "couldn't
       connect media". The server's peer-joined is authoritative, so it drives the
       transition — and it must do so BEFORE any peer is built, or a slow transport
       reintroduces the same gap. */
    expect(CLIENT).toMatch(/refreshHostPanel\(\);[\s\S]{0,900}callAnswered = true;\s*\n\s*onCalleeAnswered\(\);/);
    const pj = CLIENT.slice(CLIENT.indexOf("function onPeerJoined("));
    const body = pj.slice(0, pj.indexOf("\n  }"));
    expect(body.indexOf("onCalleeAnswered()")).toBeLessThan(body.indexOf("createPeer("));
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
