import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * v2.80 — multi-party A/V reliability, static pins.
 *
 * Field report (6-participant call): 2/6 cameras dead or "not recognized",
 * 1/6 muted/distorted — across browsers and devices. Root causes found by a
 * code audit + an empirical 6-browser matrix test (all 30 remote streams are
 * asserted live in scratchpad/six-party.mjs; the fixes below took the matrix
 * from 29/30 with frozen-frame artifacts to 30/30):
 */
const SRC = fs.readFileSync(path.resolve(__dirname, "relayClient.ts"), "utf8");

describe("mesh — camera-less participants (the '2/6 cameras dead' class)", () => {
  it("a video-less OFFERER still negotiates a VIDEO m-line; the ANSWERER flips offered video to sendrecv", () => {
    // Without the offerer's null-track transceiver, an audio-only initiator's
    // offer had no video m-line — an answer can't add one. And the answerer
    // must declare sendrecv (default answers recvonly), or IT could never
    // send video later without renegotiation. addTransceiver is OFFERER-only:
    // on the answerer it stays an mid-less orphan that swallowed the track.
    expect(SRC).toMatch(/else if \(initiator\) pc\.addTransceiver\("video", \{ direction: "sendrecv" \}\);/);
    expect(SRC).toMatch(/if \(tr\.receiver\?\.track\?\.kind === "video" && tr\.direction === "recvonly"\) \{\s*\n\s*try \{ tr\.direction = "sendrecv"; \}/);
    expect(SRC).toMatch(/tr\.mid !== null && !tr\.sender\.track && tr\.receiver\?\.track\?\.kind === "video"/);
  });

  it("enabling the camera with NO live local track REACQUIRES on the mesh (v2.72 only gave the SFU this)", () => {
    expect(SRC).toMatch(/const haveLive = localStream\.getVideoTracks\(\)\.some\(t => t\.readyState === "live"\);/);
    /* REWRITTEN TO THE PROPERTY (#145). This froze the publish as UNCONDITIONAL, and it
       can no longer be: turning the camera off now STOPS the track, so `!haveLive` fires
       for the ordinary off→on during a SCREEN SHARE — where publishing the camera would
       end the share. The rule this test stands for is that a reacquire happens on the
       mesh at all, and that its result is published; the guard is asserted with it so the
       exception cannot silently widen into "never publishes". */
    expect(SRC).toMatch(/const track = await reacquireCameraForPublish\(\);\s*\n\s*if \(track\) \{/);
    expect(SRC).toMatch(/if \(!screenSharing\) await replaceVideoEverywhere\(track\);/);
  });

  it("a failed (re)acquire is HONEST: camera button off + toast, never a fake-on camera", () => {
    /* Was `toBe(2)` — one message per transport — and the SFU's copy went with it
       (v2.106.53). ONE now, and asserted as exactly one rather than at-least-one:
       two copies of a user-facing message is how they come to disagree. */
    const honest = SRC.match(/Camera unavailable — check that RELAY has camera permission and no other app is using it\./g) || [];
    expect(honest.length).toBe(1);
    // …and the button really goes off, rather than the toast being the only signal.
    expect(SRC).toMatch(/camOn = false;[\s\S]{0,200}Camera unavailable/);
  });

  it("the audio-only JOIN fallback reflects on the camera button immediately", () => {
    expect(SRC).toMatch(/camOn = false;[\s\S]{0,300}\$\("camBtn"\)\?\.classList\.add\("off"\);[\s\S]{0,300}No camera found — joining with audio only/);
  });
});

describe("remote video going quiet shows the AVATAR, never a frozen last frame", () => {
  it("mesh: the tile placeholder keys off !muted AND real frames (a live-but-silent consent m-line must not paint a black tile)", () => {
    expect(SRC).toMatch(/const hasLiveTrack = stream\.getVideoTracks\(\)\.some\(tr => !tr\.muted && tr\.enabled && tr\.readyState === "live"\);/);
    expect(SRC).toMatch(/const has = hasLiveTrack && \(\(v\?\.videoWidth \|\| 0\) > 0\);/);
    expect(SRC).toMatch(/v\?\.addEventListener\("resize", sync\);/);
  });

  /* EIGHT SFU-PATH TESTS STOOD HERE and went with the transport (v2.106.53). Each
     described a hazard of a media server we no longer have: track mute/unmute
     events, adaptiveStream pausing a subscription, screen-share publications, a
     detached audio element per subscribed track, publish retries. The MESH halves
     of the same properties — a quiet remote video showing the avatar, an honest
     failed reacquire, the tap-to-unlock fallback — are asserted above and below.
     They are recorded here rather than silently dropped so the next transport is
     written knowing which hazards it inherits. */

});

describe("signaling reliability at multi-party scale", () => {
  it("sendWS RETRIES dropped messages (a lost mesh offer/answer was permanently fatal for that pair)", () => {
    expect(SRC).toMatch(/const retriable = !!obj && obj\.type !== "leave";/);
    expect(SRC).toMatch(/if \(res\.ok \|\| !retriable \|\| attempt >= 3\) return;/);
    expect(SRC).toMatch(/250 \* Math\.pow\(3, attempt\)/);
  });
});

describe("the 'one participant muted / distorted' class", () => {
  it("LOCAL track death (phone interrupt, BT swap, camera claimed) self-heals — mic reacquired + re-fed to mesh senders and the SFU", () => {
    expect(SRC).toMatch(/function watchLocalTracks\(stream: MediaStream\)/);
    expect(SRC).toMatch(/async function recoverDeadLocalTrack\(kind: string\)/);
    expect(SRC).toMatch(/watchLocalTracks\(localStream\);/);
    expect(SRC).toMatch(/toast\("Microphone reconnected\."\);/);
  });

  it("no Web-Audio tap ever contends for a remote stream (the loser fell back to the earpiece = one quiet voice)", () => {
    /* THE PROPERTY, not the mechanism. This used to require BOTH taps to use a
       "fresh wrapper stream", counted at exactly 2 — and v2.107.11 showed that a
       wrapper protects nothing for the ANALYSER, because a wrapper still
       references the SAME track object, so the tap competed with the <audio>
       element playing it. The two taps need DIFFERENT treatments:
         - the loudspeaker route must carry the SAME audio to `destination` (and
           deliberately mutes the element once wired), so a wrapper is right;
         - the analyser is a SINK, so it must never touch the live track at all —
           it taps a CLONE, which cannot contend by construction.
       What must hold either way: neither tap is handed the shared stream OBJECT. */
    const sources = SRC.match(/createMediaStreamSource\([^)]*\)/g) || [];
    expect(sources.length).toBeGreaterThanOrEqual(2); // loudspeaker route + mesh analyser
    for (const s of sources) expect(s).toMatch(/new MediaStream\(/);
    // The loudspeaker route: its own wrapper around the same tracks.
    expect(SRC).toMatch(/createMediaStreamSource\(new MediaStream\(stream\.getAudioTracks\(\)\)\)/);
    // The analyser: a clone, never the live track.
    expect(SRC).toMatch(/createMediaStreamSource\(new MediaStream\(\[tap\]\)\)/);
    expect(SRC).toMatch(/tap = live\.clone\(\)/);
  });

});

describe("publication hygiene", () => {
  it("stopping a screen share with the camera OFF publishes NOTHING (not a disabled black track)", () => {
    expect(SRC).toMatch(/await replaceVideoEverywhere\(camOn \? currentCameraVideoTrack\(\) : null\);/);
  });

});

describe("second-wave audit fixes (finders re-reviewed the fresh code)", () => {
  it("msid-less ontrack MERGES the bare track — never wipes the tile (a camera-less peer's null transceiver killed their own audio for everyone)", () => {
    expect(SRC).toMatch(/const s = e\.streams && e\.streams\[0\];\s*\n\s*if \(s\) \{ attachRemote\(pin, s\); return; \}/);
    expect(SRC).toMatch(/const merged = cur \|\| new MediaStream\(\);/);
    expect(SRC).toMatch(/if \(!stream\) return; \/\/ defensive: never wipe a tile with a missing stream/);
  });

  it("dead-mic paths actually recover: ensureMedia refuses dead cached streams; unmuting a dead mic reacquires; pipeline audio swapped too", () => {
    expect(SRC).toMatch(/const audioLive = localStream\.getAudioTracks\(\)\.some\(t => t\.readyState === "live"\);/);
    expect(SRC).toMatch(/if \(on && inCall && !localStream\.getAudioTracks\(\)\.some\(t => t\.readyState === "live"\)\) \{\s*\n\s*void recoverDeadLocalTrack\("audio"\);/);
    expect(SRC).toMatch(/processedStream\.getAudioTracks\(\)\.forEach\(t => \{ try \{ processedStream!\.removeTrack\(t\); \} catch \{ \/\* \*\/ \} \}\);/);
  });

  it("camera reacquire prefers the SAME camera (flip helper refuses the current device) and re-arms the death watch", () => {
    expect(SRC).toMatch(/video: \{ facingMode: \{ ideal: facingMode \} \},\s*\n\s*audio: false,/);
    expect(SRC).toMatch(/v\.onended = \(\) => \{ void recoverDeadLocalTrack\("video"\); \};/);
  });

  it("mesh encoders scale with party size (5 uncapped 720p30 encoders melted phones + uplinks)", () => {
    expect(SRC).toMatch(/function applyMeshVideoCaps\(\)/);
    expect(SRC).toMatch(/const maxBitrate = n <= 1 \? 1_200_000 : n <= 3 \? 700_000 : 350_000;/);
    expect(SRC).toMatch(/applyMeshVideoCaps\(\); \/\/ fewer parties → raise per-sender quality again/);
  });

  it("held→resumed peers RESUME playback (a thawed tile stayed paused = silent + frozen forever)", () => {
    expect(SRC).toMatch(/const vid = e\.el\?\.querySelector\("video"\) as HTMLVideoElement \| null;\s*\n\s*if \(vid\) void vid\.play\(\)\.catch\(\(\) => armAudioUnlock\(\)\);/);
  });

  it("the loudspeaker never mutes an element into a NON-RUNNING AudioContext (suspended-context scan silenced new joiners)", () => {
    expect(SRC).toMatch(/if \(loudspeakerCtx\.state !== "running"\) \{\s*\n\s*void loudspeakerCtx\.resume\(\)\.catch\(\(\) => \{\}\);\s*\n\s*return;/);
  });

  it("the null-sender fallback in replaceVideoEverywhere is KIND-aware (video never lands on an empty audio sender)", () => {
    expect(SRC).toMatch(/pc\.getTransceivers\(\)\.find\(tr => tr\.mid !== null && !tr\.sender\.track && tr\.receiver\?\.track\?\.kind === "video"\)\?\.sender/);
  });
});
