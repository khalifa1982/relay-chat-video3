import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * v2.106.51 — MESH REMOTE AUDIO WAS NEVER PLAYED OUT ON A CALL WITH NO VIDEO.
 *
 * THE DEFECT. `attachRemote` handed the tile's <video> the WHOLE remote stream
 * (`v.srcObject = stream`), so remote audio played through the video element. On a
 * voice call that same stream also carries a video track that will never deliver a
 * frame — the offerer always negotiates a null-track video m-line for the
 * mutual-consent slot (see createPeer). A <video> cannot reach HAVE_METADATA
 * without dimensions, and a frameless track supplies none, so the element parked at
 * readyState 0 with the trace `emptied -> play -> waiting`, its play() promise never
 * settled, and THE AUDIO SITTING IN THE SAME STREAM WAS NEVER PLAYED OUT.
 *
 * MEASURED, in a real two-browser call (not argued):
 *   before  inbound totalAudioEnergy 0.0000 on BOTH sides, 6 runs of 6,
 *           while ~508 audio packets/side/direction arrived with 0 loss
 *   after   2.677 (A) / 2.728 (B), 512/511 packets, audioBothWays true
 *   video call, after: audio 2.293/2.474 AND video 283/374 packets — no regression
 * A zero-RELAY-code loopback isolated the mechanism: audio-only -> a <video> plays
 * (energy ~1.9); audio + a sendrecv video transceiver with NO track -> the <video>
 * stalls identically (energy 0, readyState 0); the SAME stream given to an <audio>
 * plays. So it is not a headless artifact, and `--mute-audio` and
 * `visibility:hidden` were both excluded by control arms.
 *
 * WHY IT WAS NEVER ONLY "VOICE MODE". The trigger is NO INCOMING VIDEO FRAMES,
 * which also covers every 1:1 video dial before consent (v2.81 means no camera
 * transmits yet) and any group participant with their camera off. And it bites
 * hardest through the MESH — which is exactly where v2.106.48's new SFU fallback
 * lands a call.
 *
 * These are source pins by necessity: the engine is a large imperative closure that
 * is not booted in this node-environment suite, and whether audio is PLAYED is a
 * browser fact. The behavioural proof is the drive above; these guards stop the
 * shape regressing.
 */
const CLIENT = fs.readFileSync(path.resolve(__dirname, "relayClient.ts"), "utf8");

/** Strip comment spans so a `not.toMatch` cannot be satisfied by prose ABOUT the
 *  pattern — this file necessarily documents the defect it forbids. */
const codeOnly = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

function fnBody(name: string): string {
  const at = CLIENT.indexOf(`function ${name}(`);
  expect(at, `${name} must exist`).toBeGreaterThan(0);
  const end = CLIENT.indexOf("\n  function ", at + 10);
  const body = CLIENT.slice(at, end > at ? end : at + 6000);
  expect(body.length, `${name}'s slice must be real`).toBeGreaterThan(200);
  return body;
}

describe("mesh remote audio has its own element", () => {
  it("attachRemote NEVER hands the tile <video> the whole stream", () => {
    // The exact defect. `v.srcObject = stream` is what made every voice call silent.
    const body = codeOnly(fnBody("attachRemote"));
    expect(body).not.toMatch(/v\.srcObject = stream\b/);
    // The video element gets VIDEO TRACKS ONLY.
    expect(body).toMatch(/v\.srcObject = new MediaStream\(stream\.getVideoTracks\(\)\)/);
  });

  it("audio is attached to a dedicated <audio> element, in the document", () => {
    const body = fnBody("attachRemote");
    expect(body).toMatch(/document\.createElement\("audio"\)/);
    expect(body).toMatch(/ae\.srcObject = new MediaStream\(audioTracks\)/);
    // IN the document: a detached element is not a reliable playout path on
    // Android Chrome, which is why the SFU path inserts its element too.
    expect(body).toMatch(/entry\.el\.appendChild\(ae\)/);
    // Reused across re-attaches rather than stacking one element per ontrack.
    expect(body).toMatch(/let ae = entry\.audioEl;/);
    expect(body).toMatch(/if \(!ae\) \{/);
  });

  it("the audio element is only (re)pointed when the stream actually has audio", () => {
    // The msid-less merge path can call attachRemote with a video-only stream.
    // Re-pointing unconditionally would blank a working audio element.
    const body = fnBody("attachRemote");
    const gate = body.indexOf("if (audioTracks.length)");
    const set = body.indexOf("ae.srcObject =");
    expect(gate).toBeGreaterThan(0);
    expect(gate).toBeLessThan(set);
  });

  it("the audio element goes through the SAME sink + unlock machinery as before", () => {
    // Losing either would silently break the output-device picker or leave audio
    // stuck silent behind the autoplay gate.
    const body = fnBody("attachRemote");
    expect(body).toMatch(/void applyAudioSink\(ae\)/);
    expect(body).toMatch(/void ae\.play\(\)\.catch\(\(\) => armAudioUnlock\(\)\)/);
    // …and onto the loudspeaker when that mode is already on, or a peer who joins
    // during loudspeaker mode plays on the earpiece.
    expect(body).toMatch(/if \(loudspeakerOn\) routeElToLoudspeaker\(ae\)/);
  });

  it("collectAudioEls reaches the per-peer audio elements", () => {
    // THIS IS THE FUNNEL. applyAudioSink, armAudioUnlock's tap-to-recover and the
    // forced-loudspeaker route reach remote audio ONLY through this function, so an
    // element missing here is three shipped features silently not covering it.
    const body = fnBody("collectAudioEls");
    expect(body).toMatch(/peers\[pin\]\.audioEl/);
    // The <video>s stay collected — they still need play() re-kicked for VIDEO.
    expect(body).toMatch(/querySelector\("video"\)/);
  });

  it("the frameless consent track still reaches the video element", () => {
    // A mid-call camera-on arrives by replaceTrack on that SAME track object (no
    // new ontrack), so filtering it out here would mean the camera never appears.
    // Proven in-band: turning both cameras on mid-call took the element from
    // readyState 0 to 4 with the trace completing to `playing`.
    const body = codeOnly(fnBody("attachRemote"));
    expect(body).toMatch(/stream\.getVideoTracks\(\)/);
    expect(body).not.toMatch(/getVideoTracks\(\)\.filter/);
  });
});

describe("the peer's audio element is released on teardown", () => {
  it("releasePeerAudio stops it, clears srcObject and drops it", () => {
    // A detached media element with a live srcObject can KEEP PLAYING in Chrome,
    // so a departed peer could still be heard.
    const body = fnBody("releasePeerAudio");
    expect(body).toMatch(/ae\.pause\(\)/);
    expect(body).toMatch(/ae\.srcObject = null/);
    expect(body).toMatch(/ae\.remove\(\)/);
    expect(body).toMatch(/e\.audioEl = null/);
    expect(body).toMatch(/e\.remoteStream = null/);
  });

  it("BOTH teardown paths call it — active and held", () => {
    // Two paths, so a rule living at each call site is a rule one of them
    // eventually forgets. Counted, not merely present.
    const code = codeOnly(CLIENT);
    const calls = code.match(/releasePeerAudio\(/g) || [];
    // 1 declaration + 2 call sites.
    expect(calls.length).toBe(3);
    const rm = fnBody("removePeer");
    expect(rm).toMatch(/releasePeerAudio\(h\)/); // held bucket
    expect(rm).toMatch(/releasePeerAudio\(e\)/); // active peer
  });
});

describe("the msid-less merge accumulates on the entry, not the video element", () => {
  it("ontrack merges onto entry.remoteStream", () => {
    // It used to read the tile <video>'s srcObject as the accumulator. Once audio
    // moved off that element the <video> holds video only, so merging onto it
    // would have quietly DROPPED this peer's audio — the very bug the merge path
    // was originally written to prevent, one layer along.
    const code = codeOnly(CLIENT);
    expect(code).toMatch(/const cur = peers\[pin\]\?\.remoteStream \|\| null;/);
    expect(code).not.toMatch(/\?\.srcObject as MediaStream \| null;\s*\n\s*const merged/);
    // attachRemote records it, or the accumulator is always empty.
    expect(fnBody("attachRemote")).toMatch(/entry\.remoteStream = stream;/);
  });
});

describe("there is exactly ONE route to remote audio", () => {
  it("collectAudioEls is the only collector, and nothing else gathers media elements", () => {
    /* THIS REPLACES A PARITY PIN. The hosted SFU attached per track and was
       structurally immune to the defect this file is about; that transport is gone
       (v2.106.53), so what is left to protect is the SINGLE FUNNEL. `applyAudioSink`
       (the output-device picker), `armAudioUnlock`'s tap-to-recover and the forced
       loudspeaker route ALL reach remote audio through `collectAudioEls` — so an
       element missing from it is three shipped features silently not covering it. */
    const code = codeOnly(CLIENT);
    const collectors = code.match(/function collectAudioEls\(/g) || [];
    expect(collectors.length).toBe(1);
    for (const consumer of ["applyAudioSink", "armAudioUnlock", "routeElToLoudspeaker"]) {
      expect(code, consumer).toContain(consumer);
    }
    // The retired transport's own element list is gone with it.
    expect(code).not.toMatch(/lkAudioEls/);
  });
});
