/**
 * THE ACTIVE-SPEAKER TAP MUST NOT BE ABLE TO SILENCE THE CALL.
 *
 * The incident: a real call on v2.107.10 was fully silent BOTH directions with a
 * perfectly healthy transport — 32ms RTT, 0% loss, direct/host/udp, Opus
 * negotiated and sent, video rendering at 640x480 both ways — and coturn
 * confirmed valid credentials with zero 401s. Transport, codec and credentials
 * were all exonerated by measurement, which leaves the RENDER path.
 *
 * WHAT MAKES THIS SITE THE CANDIDATE. `registerMeshAnalyser` taps every remote
 * audio stream into `meshAudioCtx` for level metering, and:
 *   - it tapped the LIVE remote track (a "fresh wrapper MediaStream" still
 *     references the same track object, so it protected nothing), and
 *   - `meshAudioCtx` is built inside `ontrack` — NEVER inside a user gesture —
 *     so on WebKit it is born SUSPENDED and `resume()` is REFUSED. That is the
 *     v2.106.89 rule, which was fixed for the voice recorder and never swept to
 *     this second site.
 *   - #160 then began CLOSING this context at every hang-up. Its own test states
 *     the safety argument for closing: "Closing at teardown is only safe because
 *     `loudspeakerPrime()` runs inside the dial tap and the Answer tap." That
 *     argument was made for the LOUDSPEAKER context and applied to this one,
 *     which had no priming at all — so every call after the first rebuilt it
 *     outside a gesture.
 * A MediaStreamAudioSourceNode routes its source INTO the graph; this graph ends
 * in an analyser (a sink), and a suspended graph renders nothing — so the
 * <audio> element holding the same track is starved. "Audio arrives and is never
 * played out", on both ends, on voice and video alike.
 *
 * WHY IT SURVIVED THREE MEASUREMENTS. v2.106.51, v2.106.53 and v2.106.57 each
 * drove real calls here and read totalAudioEnergy 2.6-4.0. Desktop Chromium
 * PERMITS a gesture-less `resume()`, so the context runs and the tap is harmless.
 * It can only bite on a real handset — exactly where the owner tested and where
 * this sandbox cannot reproduce it.
 *
 * SOURCE PINS BY NECESSITY, SAID PLAINLY: there is no WebAudio, no MediaStream
 * and no RTCPeerConnection in the node test environment, so whether a clone
 * really leaves playout intact cannot be driven from here — that is a handset
 * measurement. What these pin is that the two rules are IN the code and cannot
 * be quietly removed.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { codeOnly } from "../../../server/testing/codeOnly";

const ROOT = resolve(__dirname, "../../..");
const ENGINE = readFileSync(resolve(ROOT, "client/src/lib/relayClient.ts"), "utf8");
/* For any assertion that forbids an identifier: this file's own comments EXPLAIN what
   must not be there, and a raw sweep matches the explanation — the prose trap this
   repo has now hit twenty-odd times. */
const ENGINE_CODE = codeOnly(ENGINE);

/** The body of a named function, brace-matched from the brace that opens it with
 *  parens and angles closed — so a parameter object or a `Promise<{...}>` return
 *  type is never mistaken for the body (a trap this repo has hit six times). */
function fnBody(src: string, decl: string): string {
  const at = src.indexOf(decl);
  if (at < 0) throw new Error("declaration not found: " + decl);
  /* Scan from the START of the declaration, not past it: the anchor ends with an
     OPEN paren, so resuming after it would begin at depth 0 with one already
     open — the seeded-depth trap this repo has hit six times, which then takes a
     type annotation's brace as the body. */
  let i = at;
  let paren = 0;
  let angle = 0;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === "(") paren++;
    else if (c === ")") paren--;
    else if (c === "<") angle++;
    else if (c === ">") angle--;
    else if (c === "{" && paren === 0 && angle <= 0) break;
  }
  const open = i;
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  throw new Error("unbalanced body: " + decl);
}

describe("the mesh active-speaker tap cannot starve remote audio", () => {
  const register = fnBody(ENGINE, "function registerMeshAnalyser(");

  it("taps a CLONE of the remote audio track, never the live track", () => {
    /* THE PROPERTY: WebAudio gets its own copy, so the element's render path is
       untouched whatever state the context is in. A wrapper stream around the
       SAME track — what this used to do — does not deliver that. */
    expect(register).toMatch(/=\s*live\.clone\(\)/);
    expect(register).toMatch(/createMediaStreamSource\(new MediaStream\(\[tap\]\)\)/);
    // The live track must never reach the graph.
    expect(register).not.toMatch(/createMediaStreamSource\([^)]*getAudioTracks\(\)/);
  });

  it("refuses to tap a context that is not RUNNING, and DEFERS rather than drops", () => {
    expect(register).toMatch(/if \(meshAudioCtx\.state !== "running"\)/);
    // The refusal returns BEFORE any createMediaStreamSource.
    const gate = register.indexOf('state !== "running"');
    const tap = register.indexOf("createMediaStreamSource");
    expect(gate).toBeGreaterThan(-1);
    expect(tap).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(tap);
    // It still tries to resume, so the deferral can clear.
    expect(register).toMatch(/void meshAudioCtx\.resume\(\)/);
  });

  it("the sampler RETRIES a deferred tap — otherwise metering never recovers", () => {
    /* The retry belongs on a tick rather than at attach time, because what
       changes is the CONTEXT's state, not the peer's. */
    const sample = fnBody(ENGINE, "function sampleMeshSpeakers(");
    expect(sample).toMatch(/if \(rs && !meshAnalysers\[pin\]\) registerMeshAnalyser\(pin, rs\)/);
  });

  it("the clone is STOPPED on unregister — nothing else can ever release it", () => {
    const unregister = fnBody(ENGINE, "function unregisterMeshAnalyser(");
    expect(unregister).toMatch(/a\.tap\.stop\(\)/);
    // A clone that never reached meshAnalysers is released too.
    expect(register).toMatch(/tap\?\.stop\(\)/);
  });

  it("the analyser stays a SINK — connecting it to destination would be a second playout path", () => {
    expect(register).toMatch(/src\.connect\(node\)/);
    expect(register).not.toMatch(/connect\(meshAudioCtx\.destination\)/);
  });
});

/**
 * THE SEND SIDE (v2.107.15).
 *
 * v2.107.12 fixed the RECEIVE path and the next handset reading moved the failure
 * rather than clearing it: `↑0kbps · ↓7kbps · ↓aud 399pkt/0.03e`. Energy was no
 * longer exactly zero and no "audio not playing out" note appeared, so playout was
 * working — but this device sent ZERO audio bytes over the sample interval, on a
 * voice call whose mic button read ON and whose outbound Opus stream existed.
 *
 * `bytesSent` is a delta and the same interval computed 7kbps inbound, so the zero
 * is a real computed zero rather than a missing sample. Opus with DTX still emits
 * comfort-noise frames during silence, so zero bytes means the encoder was being fed
 * nothing at all.
 *
 * TWO THINGS MADE THAT POSSIBLE AND BOTH ARE CLOSED HERE:
 *   1. `watchLocalTracks` watched only `onended`. A track the OS MUTES stays live
 *      with `enabled` true, so `syncMicEnabled` saw nothing wrong, the button stayed
 *      lit, and the sender sent nothing with no signal anywhere. Video already
 *      watched onmute/onunmute for its tile placeholder; audio never got the mirror.
 *   2. The local level meter was the only WebAudio consumer of the live mic, and it
 *      claimed it BEFORE WebRTC did — `ensureLocalLevelMonitor()` runs at
 *      `ensureMediaInner`'s exit, while the track only reaches an RTCRtpSender later
 *      in `createPeer`. On iOS a WebAudio mic input reconfigures the shared audio
 *      session, and a muted capture track is the documented outcome.
 *
 * WHY iOS IS A SKIP AND NOT THE SAME CLONE: a clone stops two consumers contending
 * for one track and does nothing about the OS reconfiguring the session, because the
 * clone is fed from the same input. Elsewhere the tap is kept and hardened like its
 * sibling, so the class is closed on every platform rather than papered over on one.
 */
describe("the local mic meter cannot cost us the outbound audio", () => {
  const ensure = fnBody(ENGINE, "function ensureLocalLevelMonitor(");

  it("does not run at all on iOS — a clone cannot protect the audio SESSION", () => {
    const allowed = fnBody(ENGINE, "function localLevelMeterAllowed(");
    expect(allowed).toMatch(/return !IS_IOS/);
    // The gate is the FIRST thing the monitor does, ahead of any context work.
    expect(ensure).toMatch(/^\{\s*\n\s*if \(!localLevelMeterAllowed\(\)\) return;/);
    // …and the context builder is gated too, so priming cannot create one either.
    expect(fnBody(ENGINE, "function ensureLocalLevelCtx(")).toMatch(
      /if \(!localLevelMeterAllowed\(\)\) return;/,
    );
  });

  it("taps a CLONE, never the live mic the RTCRtpSender is publishing", () => {
    expect(ensure).toMatch(/tap = live\.clone\(\)/);
    expect(ensure).toMatch(/createMediaStreamSource\(new MediaStream\(\[tap\]\)\)/);
    // The old shape — a wrapper around the live track — must not come back.
    expect(ensure).not.toMatch(/new MediaStream\(\[localStream\.getAudioTracks\(\)\[0\]\]\)/);
    // And the clone is released; nothing else can.
    expect(fnBody(ENGINE, "function teardownLocalLevelMonitor(")).toMatch(/tap\.stop\(\)/);
    expect(ensure).toMatch(/tap\?\.stop\(\)/);
  });

  it("refuses a context that is not RUNNING, and defers rather than dropping", () => {
    expect(ensure).toMatch(/if \(localLevelCtx\.state !== "running"\)/);
    const gate = ensure.indexOf('state !== "running"');
    const tap = ensure.indexOf("createMediaStreamSource");
    expect(gate).toBeGreaterThan(-1);
    expect(tap).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(tap);
    expect(fnBody(ENGINE, "function sampleLocalLevel(")).toMatch(/ensureLocalLevelMonitor\(\)/);
  });
});

describe("an OS-muted mic stops being invisible", () => {
  const watch = fnBody(ENGINE, "function watchLocalTracks(");

  it("watches onmute/onunmute on AUDIO, not just onended", () => {
    expect(watch).toMatch(/t\.onended = /);
    expect(watch).toMatch(/if \(t\.kind !== "audio"\) return;/);
    expect(watch).toMatch(/t\.onmute = /);
    expect(watch).toMatch(/t\.onunmute = /);
  });

  it("recovery is DELAYED and re-checks the world, so a blip cannot tear down a live mic", () => {
    expect(watch).toMatch(/setTimeout\(/);
    expect(ENGINE).toMatch(/const MIC_MUTE_RECOVER_MS = \d+;/);
    // Re-checked ON FIRE, not trusted from when the timer was armed.
    expect(watch).toMatch(/if \(!inCall \|\| !t\.muted \|\| t\.readyState !== "live"\) return;/);
    expect(watch).toMatch(/recoverDeadLocalTrack\("audio"\)/);
    // unmute cancels it.
    expect(watch).toMatch(/onunmute[\s\S]{0,120}clearTimeout\(micMuteT\)/);
  });

  it("the pending recovery cannot outlive the call (the #160 orphan class)", () => {
    /* Firing after teardown would re-open the microphone with nothing left holding a
       reference able to stop it. */
    expect(fnBody(ENGINE, "function releaseLocalMedia(")).toMatch(
      /clearTimeout\(micMuteT\); micMuteT = null;/,
    );
  });

  it("there is ONE source of truth for whether the mic is muted — the track", () => {
    /* A mirrored flag is how the readout and the recovery come to disagree; the
       readout reads `track.muted` live instead. Asserted on comment-stripped source,
       because the engine's own comment names the flag in order to say it must not
       exist — and a companion assertion proves that reason is genuinely recorded, so
       the strip cannot be hiding a live one. */
    expect(ENGINE_CODE).not.toMatch(/micTrackMuted/);
    expect(ENGINE).toMatch(/micTrackMuted/); // …in prose only.
  });

  it("the readout SAYS which of the two `↑0kbps` causes it is", () => {
    /* Without this the next reading is inferential again: "we are sending nothing"
       and "we are sending and they cannot play it" looked identical. */
    expect(ENGINE).toMatch(/↑mic muted by OS/);
    expect(ENGINE).toMatch(/↑mic ended/);
    expect(ENGINE).toMatch(/↑mic none/);
    expect(ENGINE).toMatch(/↑mic disabled/);
    // Derived from the live track, and only rendered when something is wrong.
    expect(ENGINE).toMatch(/const outTrack = outAudioTrack\(\);/);
    expect(ENGINE).toMatch(/const micNote = !outTrack/);
    expect(ENGINE).toMatch(/\[formatCallDetail\(stats\), micNote\]\.filter\(Boolean\)/);
  });
});

describe("meshAudioCtx is gesture-primed, which is what makes #160's close safe", () => {
  it("has a prime of its own, NOT gated on the speaker preference", () => {
    const prime = fnBody(ENGINE, "function meshSpeakerPrime(");
    expect(prime).toMatch(/ensureMeshAudioCtx\(\)/);
    /* The monitor runs on every call whichever output carries the audio, so
       gating it on loudspeakerPref() would leave earpiece calls unprimed. */
    expect(prime).not.toMatch(/loudspeakerPref/);
  });

  it("EVERY call-audio context is primed by the one funnel — three, not two", () => {
    /* `localLevelCtx` was the third context still built after the gesture was spent
       (at ensureMediaInner's exit, post-getUserMedia). A funnel that primes some and
       forgets others is the exact omission that armed the v2.107.12 defect. */
    const funnel = fnBody(ENGINE, "function primeCallAudio(");
    expect(funnel).toMatch(/loudspeakerPrime\(\);/);
    expect(funnel).toMatch(/meshSpeakerPrime\(\);/);
    expect(funnel).toMatch(/localLevelPrime\(\);/);
    // Each half has exactly ONE caller, which is the funnel.
    for (const p of ["loudspeakerPrime", "meshSpeakerPrime", "localLevelPrime"]) {
      expect((ENGINE.match(new RegExp(p + "\\(\\);", "g")) || []).length).toBe(1);
    }
  });

  it("priming builds+resumes the CONTEXT without starting the 400ms sampler", () => {
    const ctx = fnBody(ENGINE, "function ensureMeshAudioCtx(");
    expect(ctx).toMatch(/new Ctx\(\)/);
    expect(ctx).toMatch(/void meshAudioCtx\.resume\(\)/);
    // No timer before there is a call to meter.
    expect(ctx).not.toMatch(/setInterval/);
    // The sampler still starts, one layer out.
    expect(fnBody(ENGINE, "function ensureMeshSpeakerMonitor(")).toMatch(
      /speakerSampleT = setInterval\(sampleMeshSpeakers, 400\)/,
    );
  });

  it("the close it makes safe is still there (the two must move together)", () => {
    const teardown = fnBody(ENGINE, "function teardownSpeakerMonitor(");
    expect(teardown).toMatch(/meshAudioCtx\.close\(\)/);
    expect(teardown).toMatch(/meshAudioCtx = null/);
  });
});
