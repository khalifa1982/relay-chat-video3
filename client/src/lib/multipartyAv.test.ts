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
    expect(SRC).toMatch(/const track = await reacquireCameraForPublish\(\);\s*\n\s*if \(track\) \{\s*\n\s*await replaceVideoEverywhere\(track\);/);
  });

  it("a failed (re)acquire is HONEST on both paths: camera button off + toast, never a fake-on camera", () => {
    const honest = SRC.match(/Camera unavailable — check that RELAY has camera permission and no other app is using it\./g) || [];
    expect(honest.length).toBe(2); // mesh setCam branch + SFU syncLivekitVideoPublication
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

  it("SFU: TrackMuted/TrackUnmuted handlers exist and toggle the placeholder", () => {
    expect(SRC).toMatch(/RoomEventEnum\.TrackMuted, \(pub: any, participant: any\) => \{[\s\S]*?bindLkPlaceholder\(el, false\);/);
    expect(SRC).toMatch(/RoomEventEnum\.TrackUnmuted, \(pub: any, participant: any\) => \{[\s\S]*?bindLkPlaceholder\(el, lkHasVideo\(participant\)\);/);
  });

  it("SFU: adaptiveStream PAUSES (TrackStreamStateChanged) flip the tile to the avatar and back", () => {
    expect(SRC).toMatch(/RoomEventEnum\.TrackStreamStateChanged, \(pub: any, state: any, participant: any\) => \{[\s\S]*?if \(String\(state\) === "paused"\) bindLkPlaceholder\(el, false\);/);
  });

  it("the quiet-video handlers ignore SCREEN-SHARE publications (owned by the share flow)", () => {
    expect(SRC).toMatch(/const isRemoteCameraVideo = \(pub: unknown\): boolean => \{[\s\S]*?!isScreenPub\(pub\);/);
  });
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

  it("SFU inbound audio arms the one-tap unlock on EVERY platform (autoplay rejection = silent participant)", () => {
    expect(SRC).toMatch(/void \(audioEl as HTMLMediaElement\)\.play\?\.\(\)\.catch\(\(\) => armAudioUnlock\(\)\);/);
    expect(SRC).toMatch(/AudioPlaybackStatusChanged[\s\S]{0,300}canPlaybackAudio === false\) armAudioUnlock\(\);/);
  });

  it("Web-Audio taps use FRESH wrapper streams so loudspeaker + analyser never fight over one stream (the loser fell back to the earpiece = one quiet voice)", () => {
    const wraps = SRC.match(/createMediaStreamSource\(new MediaStream\(stream\.getAudioTracks\(\)\)\)/g) || [];
    expect(wraps.length).toBe(2); // loudspeaker route + mesh analyser
  });

  it("SFU publish failures are no longer silent: retried once, then reported honestly", () => {
    expect(SRC).toMatch(/const publishSafe = async \(t: MediaStreamTrack, what: "camera" \| "microphone"\)/);
    expect(SRC).toMatch(/Couldn't send your microphone — others may not hear you\./);
  });
});

describe("publication hygiene", () => {
  it("stopping a screen share with the camera OFF publishes NOTHING (not a disabled black track)", () => {
    expect(SRC).toMatch(/await replaceVideoEverywhere\(camOn \? currentCameraVideoTrack\(\) : null\);/);
  });

  it("a fresh SFU publish from replaceVideoEverywhere requires camera-on or an active screen share", () => {
    expect(SRC).toMatch(/if \(!swapped && \(camOn \|\| screenSharing\)\) await lp\.publishTrack\(track\);/);
  });

  it("adaptiveStream keeps flowing in the background (frozen auto-PiP fix) while size-based adaptation stays on", () => {
    expect(SRC).toMatch(/adaptiveStream: \{ pauseVideoInBackground: false \}/);
  });

  it("unsubscribed Android audio elements are removed from the DOM (no per-call leak)", () => {
    expect(SRC).toMatch(/try \{ d\.remove\(\); \} catch \{ \/\* not in the DOM — fine \*\/ \}/);
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
