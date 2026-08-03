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

const ROOT = resolve(__dirname, "../../..");
const ENGINE = readFileSync(resolve(ROOT, "client/src/lib/relayClient.ts"), "utf8");

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

describe("meshAudioCtx is gesture-primed, which is what makes #160's close safe", () => {
  it("has a prime of its own, NOT gated on the speaker preference", () => {
    const prime = fnBody(ENGINE, "function meshSpeakerPrime(");
    expect(prime).toMatch(/ensureMeshAudioCtx\(\)/);
    /* The monitor runs on every call whichever output carries the audio, so
       gating it on loudspeakerPref() would leave earpiece calls unprimed. */
    expect(prime).not.toMatch(/loudspeakerPref/);
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
