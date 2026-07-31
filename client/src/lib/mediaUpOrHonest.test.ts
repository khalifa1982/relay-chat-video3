import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * v2.106.48 — A CALL THAT CARRIES NO MEDIA MUST NOT REPORT ITSELF AS CONNECTED,
 * AND A BROKEN SFU MUST NOT TAKE CALLING AWAY.
 *
 * The owner: "I tested the calls, and still i can't calling I can't" — narrowed
 * by two questions to "Connects but no audio" on "Every single call", then, in
 * their own words a moment later, "Also inspect that no video active". So: ZERO
 * media in BOTH directions, on EVERY call, on EVERY device.
 *
 * That corrected symptom rules out the audio-routing layer (a sink or a
 * loudspeaker-force bug cannot make VIDEO disappear) and points at media
 * establishment. Two defects in that path are fixed here.
 *
 * (1) TOTAL MEDIA FAILURE WAS RECORDED AS SUCCESS. `joinLivekit` ran
 *     `lkConnected = true; clearLkWatchdog();` UNCONDITIONALLY after
 *     `room.connect()`. But the publish block above it is
 *     `const send = processedStream || localStream; if (send) { … }`, so with
 *     `send` falsy it is a silent no-op — and `publishSafe` failing twice merely
 *     toasts and falls through. Either way the room was up, NOTHING was
 *     published in either kind, the flag said our media was live and the ONLY
 *     thing watching was switched off. That is a permanently mute-and-black call
 *     with no error and no retry: the exact reported shape. The comment on
 *     `lkConnected` already claimed "true only AFTER a successful
 *     room.connect()+publish" — a promise the code did not keep.
 *
 * (2) THERE WAS NO RUNTIME FALLBACK FROM A DEAD SFU TO THE MESH. When the fleet
 *     advertises LiveKit the client never builds a peer connection, and the
 *     watchdog's terminal action was `hangUp()`. So one unusable media vendor
 *     does not degrade calling, it REMOVES it — for everyone, on every call,
 *     while our own SSE signaling works perfectly (ring, accept and roster all
 *     succeed, which is why it presents as "it connects and there is nothing").
 *     `server/voipRegistry.ts` already states the ladder for the SERVER's
 *     choice — mediasoup → LiveKit → mesh, "the mesh last precisely because it
 *     depends on no infrastructure" — and this is that same ladder at RUNTIME,
 *     which is the half that was missing: the server can only ever choose a
 *     transport it BELIEVES works.
 *
 * SAID PLAINLY: these are source pins. Whether media flows is a property of a
 * live SFU and two real browsers, and there is neither in the node test
 * environment (nor any route to the fleet from this sandbox — CONNECT 403). What
 * is proven here is that total failure can no longer be recorded as success and
 * that the terminal path tries to carry the call before ending it. Whether THIS
 * is the cause of the owner's silent calls is NOT claimed.
 */
const ENGINE = fs.readFileSync(path.resolve(__dirname, "relayClient.ts"), "utf8");

/** Strip comments so a `not.toMatch` can never be satisfied by prose ABOUT the
 *  pattern — this file describes in words exactly what it forbids in code. */
function codeOnly(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}
const CODE = codeOnly(ENGINE);

/** The body of a named function, by brace matching rather than a fixed slice
 *  (the v2.99.78 fragility), seeded from the anchor so an open paren in the
 *  signature cannot be mistaken for the body's own brace. */
function fnBody(src: string, anchor: string): string {
  const at = src.indexOf(anchor);
  expect(at, `anchor must exist: ${anchor}`).toBeGreaterThan(0);
  let i = at + anchor.length;
  let paren = (anchor.match(/\(/g) || []).length - (anchor.match(/\)/g) || []).length;
  while (i < src.length) {
    const c = src[i];
    if (c === "(") paren++;
    else if (c === ")") paren--;
    else if (c === "{" && paren <= 0) break;
    i++;
  }
  const start = i;
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) break; }
  }
  const body = src.slice(start, i + 1);
  expect(body.length, `body slice must be real for ${anchor}`).toBeGreaterThan(20);
  return body;
}

describe("a media-less SFU room is never reported as connected", () => {
  it("lkConnected is set ONLY when the microphone actually published", () => {
    const body = fnBody(CODE, "async function joinLivekit(");
    // The gate exists and is conditional on a tracked publish result…
    expect(body).toMatch(/if \(audioUp\) \{[\s\S]{0,200}lkConnected = true/);
    // …and the unconditional pair — the defect — is gone. Matched as the exact
    // adjacency that used to follow the publish block, so a legitimate
    // `lkConnected = true` elsewhere under a real guard does not trip it.
    expect(body).not.toMatch(/\}\s*lkConnected = true;\s*clearLkWatchdog\(\);/);
  });

  it("the watchdog is NOT retired when nothing published — it is re-armed", () => {
    const body = fnBody(CODE, "async function joinLivekit(");
    // clearLkWatchdog must live inside the success arm only.
    const gate = body.slice(body.indexOf("if (audioUp)"));
    expect(gate).toMatch(/if \(audioUp\) \{[\s\S]*?clearLkWatchdog\(\);[\s\S]*?\} else \{/);
    // The failure arm re-arms, or the recovery below never gets a tick.
    expect(gate).toMatch(/\} else \{[\s\S]{0,600}armLkWatchdog\(\);/);
  });

  it("publishSafe REPORTS success, so audioUp can be true (and false after giving up)", () => {
    const body = fnBody(CODE, "const publishSafe = async (");
    expect(body).toMatch(/publishTrack\(t\);\s*return true;/);
    // The giving-up path must return false rather than falling out as undefined.
    expect(body).toMatch(/return false;\s*\}?\s*$/m);
    expect(body).toMatch(/return false/);
  });

  it("the MICROPHONE is the test, and the camera deliberately is not", () => {
    const body = fnBody(CODE, "async function joinLivekit(");
    // Audio sets the flag…
    expect(body).toMatch(/for \(const t of audioTracks\) \{ if \(await publishSafe\(t, "microphone"\)\) audioUp = true; \}/);
    // …and video does NOT, because a 1:1 caller legitimately publishes none
    // before consent (v2.81) and a voice call has no camera track at all, so
    // gating on it would refuse to call correct calls connected.
    expect(body).not.toMatch(/publishSafe\(t, "camera"\)\)\s*audioUp/);
    expect(body).not.toMatch(/videoUp/);
    // The consent gate on video is untouched.
    expect(body).toMatch(/if \(camOn && \(videoApproved \|\| callIsGroup\)\) \{/);
  });

  it("the fault is NAMED, and distinguishes an absent stream from a refused publish", () => {
    const body = fnBody(CODE, "async function joinLivekit(");
    expect(body).toMatch(/mediaFault = !send\s*\?\s*"no-local-stream"/);
    expect(body).toMatch(/audioTracks\.length === 0 \? "no-local-audio-track" : "publish-refused"/);
    // …and cleared on success, or one bad call would mislabel every later one.
    expect(body).toMatch(/if \(audioUp\) \{\s*mediaFault = null;/);
  });

  it("the give-up message names the cause instead of blaming the network", () => {
    const tick = fnBody(CODE, "function armLkWatchdog(");
    // Two distinct messages, chosen by the fault…
    expect(tick).toMatch(/mediaFault\s*\?[\s\S]{0,300}didn't manage to send its microphone/);
    expect(tick).toMatch(/the media server is unreachable from this network/);
    // …and two distinct hang-up reasons, so the next report is diagnosable.
    expect(tick).toMatch(/hangUp\(mediaFault \? "livekit-publish-failed" : "livekit-join-timeout"\)/);
  });
});

describe("the watchdog retries the thing that actually failed", () => {
  it("a live room retries the PUBLISH before any token is re-minted", () => {
    const tick = fnBody(CODE, "function armLkWatchdog(");
    const republishAt = tick.indexOf("republishToSfu()");
    const refreshAt = tick.indexOf('"refresh-livekit"');
    expect(republishAt, "the tick must retry the publish").toBeGreaterThan(0);
    expect(refreshAt).toBeGreaterThan(0);
    // Ordering is the property: a fresh token authorizes JOINING and we have
    // already joined, so re-minting first cannot fix a failed publish — and
    // joinLivekit's own `if (lkRoom) return` makes it a complete no-op.
    expect(republishAt).toBeLessThan(refreshAt);
    expect(tick).toMatch(/if \(lkRoom\) void republishToSfu\(\);/);
  });

  it("republishToSfu publishes only what is MISSING, so repeated ticks are idempotent", () => {
    const body = fnBody(CODE, "async function republishToSfu(");
    expect(body).toMatch(/let ok = hasKind\("audio"\);/);
    expect(body).toMatch(/if \(!ok\) \{[\s\S]{0,400}publishTrack\(t\)/);
    expect(body).toMatch(/!hasKind\("video"\)/);
  });

  it("it reacquires the local stream when there is none, or it would fail identically forever", () => {
    const body = fnBody(CODE, "async function republishToSfu(");
    expect(body).toMatch(/let stream = processedStream \|\| localStream;/);
    expect(body).toMatch(/if \(!stream\) \{[\s\S]{0,300}await ensureMedia\(camOn\)/);
  });

  it("it re-checks that the call is still THIS room after every await", () => {
    const body = fnBody(CODE, "async function republishToSfu(");
    // Two awaits, two checks — a call that ended or moved on during an acquire
    // or a publish must not have media pushed into it.
    const guards = body.match(/if \(!inCall \|\| lkRoom !== room\) return false;/g) || [];
    expect(guards.length).toBeGreaterThanOrEqual(2);
  });

  it("it does NOT mark the call established — a remote track is what proves a call", () => {
    const body = fnBody(CODE, "async function republishToSfu(");
    // Claiming "connected" off our OWN uplink is the dishonesty this release
    // removes; the connect path already decided what the user sees.
    expect(body).not.toMatch(/markEstablished\(/);
  });

  it("it never throws — its caller is the call path", () => {
    const body = fnBody(CODE, "async function republishToSfu(");
    // Every await is either inside a try or guarded by one.
    expect(body).toMatch(/try \{ stream = await ensureMedia\(camOn\); \}\s*catch/);
    expect(body).toMatch(/try \{ await lp\.publishTrack\(t\); ok = true; break; \}\s*catch/);
    expect(body).toMatch(/try \{ await syncLivekitVideoPublication\(true\); \} catch/);
  });
});

describe("a broken SFU cannot take calling away", () => {
  it("both terminal paths try to CARRY the call before ending it", () => {
    const tick = fnBody(CODE, "function armLkWatchdog(");
    const fbAt = tick.indexOf("fallbackToMesh(");
    const hangAt = tick.indexOf("hangUp(");
    expect(fbAt).toBeGreaterThan(0);
    expect(hangAt).toBeGreaterThan(0);
    expect(fbAt).toBeLessThan(hangAt);
    // It must RETURN on success, or the call would fall back AND then hang up.
    expect(tick).toMatch(/if \(fallbackToMesh\([\s\S]{0,60}\)\) return;/);
    // The LiveKit-gave-up-its-own-reconnect-window path too: that is the shape
    // of an SFU that cannot serve this network at all.
    const join = fnBody(CODE, "async function joinLivekit(");
    expect(join).toMatch(/if \(fallbackToMesh\("livekit-disconnected"\)\) return;\s*hangUp\("livekit-disconnected"\);/);
  });

  it("it refuses when the mesh genuinely cannot serve the call, rather than half-connecting", () => {
    const body = fnBody(CODE, "function fallbackToMesh(");
    // Nobody else present: there is nothing to build a mesh TO.
    expect(body).toMatch(/if \(!members\.length\) return false;/);
    // Over the mesh's own cap: a party it cannot carry would half-connect and
    // read as our bug, which is worse than failing honestly.
    expect(body).toMatch(/if \(members\.length > MESH_MAX - 1\)/);
    expect(body).toMatch(/return false;/);
  });

  it("the cap is derived from ONE definition shared with the picker the user saw", () => {
    // Four readers now (picker, add-person, maxParticipants, fallback), so the
    // three copies of `livekitEnabled ? 10 : 6` are consolidated — a fallback
    // that disagreed with the cap the user was shown is its own bug.
    expect(CODE).toMatch(/const MESH_MAX = 6;/);
    expect(CODE).toMatch(/const SFU_MAX = 10;/);
    expect(CODE).toMatch(/function transportMax\(\): number \{ return livekitEnabled \? SFU_MAX : MESH_MAX; \}/);
    expect(CODE).not.toMatch(/livekitEnabled \? 10 : 6/);
    // …and every consumer goes through it.
    expect((CODE.match(/transportMax\(\)/g) || []).length).toBeGreaterThanOrEqual(4);
  });

  it("sfuUnusable is STICKY, and the livekitEnabled assignment honours it", () => {
    // THE LOAD-BEARING PIN. `livekitEnabled = m.livekit` runs on `peer-joined`
    // and `joined`, not only `registered` — so without this guard the very next
    // frame silently puts a fallen-back call back onto the SFU mid-call, and
    // every later call pays another ~16s to relearn what this one established.
    expect(CODE).toMatch(/livekitEnabled = m\.livekit && !sfuUnusable;/);
    expect(CODE).not.toMatch(/livekitEnabled = m\.livekit;/);
    // Set BEFORE the teardown, so nothing can re-enable the SFU underneath it.
    const body = fnBody(CODE, "function fallbackToMesh(");
    const stickyAt = body.indexOf("sfuUnusable = true");
    const tearAt = body.indexOf("teardownLivekit()");
    expect(stickyAt).toBeGreaterThan(0);
    expect(tearAt).toBeGreaterThan(0);
    expect(stickyAt).toBeLessThan(tearAt);
  });

  it("it dials the SIGNALING roster, never the SFU's tiles", () => {
    // THE GAP THAT A REAL TWO-PARTY DRIVE FOUND IN THIS FIX. Tiles exist only once
    // LiveKit media has ARRIVED, which is precisely what has failed here: on the
    // SFU path `onPeerJoined` returns before creating anything, so at the moment
    // the callee answers the CALLER's tile map is EMPTY. A fallback keyed on tiles
    // therefore found nobody and ended the call — the exact outcome it exists to
    // prevent, and it would have shipped looking correct.
    const body = fnBody(CODE, "function fallbackToMesh(");
    expect(body).toMatch(/const members = Array\.from\(sigRoster\.keys\(\)\);/);
    expect(body).not.toMatch(/lkParticipantTiles/);
    expect(body).toMatch(/for \(const pin of members\) if \(!peers\[pin\]\) callPeer\(pin, names\[pin\]\);/);
  });

  it("the signaling roster is filled on peer-joined BEFORE the SFU early return", () => {
    // If it were recorded after, the caller would learn nobody had answered.
    const body = fnBody(CODE, "function onPeerJoined(");
    const setAt = body.indexOf("sigRoster.set(m.pin");
    const retAt = body.indexOf("if (livekitEnabled) return;");
    expect(setAt).toBeGreaterThan(0);
    expect(retAt).toBeGreaterThan(0);
    expect(setAt).toBeLessThan(retAt);
    // …and on every roster-bearing frame, beside the membership record that exists.
    expect((CODE.match(/recordSigRoster\(m\.members\);/g) || []).length).toBeGreaterThanOrEqual(3);
  });

  it("the roster is emptied when the call ends, and on a peer leaving", () => {
    // A stale entry would have a later fallback dial somebody who is not there.
    expect(fnBody(CODE, "function hangUp(")).toMatch(/sigRoster\.clear\(\);/);
    expect(CODE).toMatch(/sigRoster\.delete\(goneP\);/);
  });

  it("it does NOT re-gate video consent on the way down", () => {
    const body = fnBody(CODE, "function fallbackToMesh(");
    // This call already settled consent (v2.81); re-asking would black out
    // cameras that are legitimately live.
    expect(body).not.toMatch(/videoApproved = false/);
    expect(body).not.toMatch(/requestVideoUpgrade\(/);
    expect(body).not.toMatch(/resetVideoConsent\(/);
  });

  it("the SFU join path applies the room's fresh TURN credentials, which the fallback needs", () => {
    // The SFU branch of onJoined used to `return` before the ICE block, so a
    // fallback would have built peer connections from the register-time set —
    // hours old on a long session and past its TTL, i.e. no relay candidates on
    // exactly the strict networks that most need them.
    const at = CODE.indexOf("if (livekitEnabled && roomId) {");
    expect(at).toBeGreaterThan(0);
    const branch = CODE.slice(at, CODE.indexOf("return;", at) + 7);
    expect(branch).toMatch(/if \(m\.iceServers && m\.iceServers\.length\) iceConfig = buildIceConfig\(m\.iceServers\);/);
  });
});

describe("remote audio does not depend on a video tile existing", () => {
  /**
   * The TrackSubscribed CALLBACK body. `fnBody` cannot find this one: it seeds paren
   * depth from the anchor and waits for a `{` with parens CLOSED, which is right for
   * `function f(…) {` but wrong for a callback, whose body sits INSIDE the call's
   * still-open paren. CLAUDE.md records that exact distinction from v2.106.2 — one
   * rule cannot locate both — so this brace-matches from the arrow's own `{`.
   */
  const sub = () => {
    const anchor = "room.on(RoomEventEnum.TrackSubscribed, (track, _pub, participant) => {";
    const at = CODE.indexOf(anchor);
    expect(at, "the TrackSubscribed handler must exist").toBeGreaterThan(0);
    let i = at + anchor.length - 1; // sit ON the opening brace
    let depth = 0;
    for (; i < CODE.length; i++) {
      if (CODE[i] === "{") depth++;
      else if (CODE[i] === "}") { depth--; if (depth === 0) break; }
    }
    const body = CODE.slice(at, i + 1);
    expect(body.length, "the handler slice must be real").toBeGreaterThan(200);
    return body;
  };

  it("the tile guard sits INSIDE the video branch, not above both", () => {
    // It used to be a shared `if (!el) return;`. Remote audio plays from a DETACHED
    // element and needs no tile, so with no tile the track ARRIVED and was silently
    // dropped — a call carrying live inbound audio with no sound.
    const body = sub();
    const vidAt = body.indexOf("if (track.kind === TrackEnum.Kind.Video) {");
    const guardAt = body.indexOf("if (!el) return;");
    expect(vidAt).toBeGreaterThan(0);
    expect(guardAt).toBeGreaterThan(vidAt);
    // …and there is exactly ONE such guard, so it cannot also be above.
    expect((body.match(/if \(!el\) return;/g) || []).length).toBe(1);
  });

  it("the audio branch attaches and plays with no tile in the path", () => {
    const body = sub();
    const audioAt = body.indexOf("else if (track.kind === TrackEnum.Kind.Audio)");
    expect(audioAt).toBeGreaterThan(0);
    const audio = body.slice(audioAt);
    expect(audio).toMatch(/const audioEl = track\.attach\(\)/);
    expect(audio).toMatch(/lkAudioEls\.push\(audioEl\)/);
    expect(audio).toMatch(/applyAudioSink\(audioEl\)/);
    // The ONLY tile use left in this branch is guarded.
    expect(audio).toMatch(/if \(el\) bindLkPlaceholder\(el, lkHasVideo\(participant\)\);/);
    expect(audio).not.toMatch(/[^(]el\.querySelector/);
  });

  it("markEstablished still runs before either branch, so a tile-less call still connects", () => {
    const body = sub();
    const markAt = body.indexOf("markEstablished()");
    expect(markAt).toBeGreaterThan(0);
    expect(markAt).toBeLessThan(body.indexOf("if (track.kind === TrackEnum.Kind.Video)"));
  });
});
