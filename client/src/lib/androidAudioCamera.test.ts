import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * v2.62 — Android incoming-audio fix + verified camera QA fixes. The engine is a
 * huge imperative closure that isn't booted in tests, so these static guards pin
 * the load-bearing lines (each traced to a confirmed root cause) so they can't
 * silently regress. Behaviour is validated on real devices.
 */
const CLIENT = fs.readFileSync(path.resolve(__dirname, "relayClient.ts"), "utf8");
const PIPE = fs.readFileSync(path.resolve(__dirname, "mediaPipeline.ts"), "utf8");

describe("Android incoming-audio fixes", () => {
  it("mesh remote <video> explicitly calls play() (Android autoplay-with-audio gate)", () => {
    // attachRemote must play() the element after srcObject, with a one-tap unlock
    // fallback — without play() the remote element stays paused and audio is silent.
    expect(CLIENT).toMatch(/v\.srcObject = stream;[\s\S]*?void v\.play\(\)\.catch\(\(\) => armAudioUnlock\(\)\)/);
    expect(CLIENT).toMatch(/function armAudioUnlock/);
  });

  it("loudspeaker mutes the element ONLY AFTER the Web-Audio route is wired", () => {
    // A failed createMediaStreamSource (stream already tapped) must NOT leave the
    // element muted with no route = silence. The connect+push happens first; the
    // mute is the last statement in the try so a throw leaves the element audible.
    expect(CLIENT).toMatch(/src\.connect\(loudspeakerCtx\.destination\);[\s\S]*?loudspeakerMutedEls\.add\(el\);[\s\S]*?el\.muted = true;/);
  });

  it("LiveKit detached <audio> is inserted into the DOM on Android only", () => {
    expect(CLIENT).toMatch(/if \(IS_ANDROID\) \{[\s\S]*?root\.appendChild\(audioEl\)/);
  });

  it("stopRingtone() drains scheduled oscillator/gain nodes, not just the interval", () => {
    // Root cause of the Android mid-call \"peep peep peep\": a suspended AudioContext
    // (Android's autoplay policy) can leave fire()'s oscillators queued; clearing only
    // the setInterval left them in the Web Audio graph to fire audibly once the
    // context later resumed (e.g. loudspeakerEnable()'s own resume()) — long after the
    // call connected. stopRingtone() must stop+disconnect every tracked node too.
    expect(CLIENT).toMatch(/const ringtoneNodes = new Set<AudioScheduledSourceNode \| AudioNode>\(\);/);
    expect(CLIENT).toMatch(
      /function stopRingtone\(\) \{[\s\S]*?clearInterval\(ringtoneTimer\)[\s\S]*?ringtoneNodes\.forEach\(n => \{[\s\S]*?\.stop\?\.\(0\)[\s\S]*?n\.disconnect\(\)[\s\S]*?ringtoneNodes\.clear\(\)/,
    );
  });

  it("every fire() burst registers its nodes and self-prunes on end", () => {
    expect(CLIENT).toMatch(/ringtoneNodes\.add\(osc\); ringtoneNodes\.add\(gain\);/);
    expect(CLIENT).toMatch(/osc\.onended = \(\) => \{ ringtoneNodes\.delete\(osc\); ringtoneNodes\.delete\(gain\); \};/);
  });
});

describe("v2.66 communication reliability (verified)", () => {
  it("in-call chat frames carry an id and duplicates are dropped on reconnect/redelivery", () => {
    expect(CLIENT).toMatch(/const seenChatIds = new Set<string>\(\);/);
    expect(CLIENT).toMatch(/function markChatSeen\(id: string\): boolean/);
    // both receive paths funnel through the dedup guard
    expect(CLIENT).toMatch(/dc\.onmessage = e => receiveChatFrame\(e\.data as string\)/);
    expect(CLIENT).toMatch(/receiveChatFrame\(new TextDecoder\(\)\.decode\(payload\)\)/);
  });

  it("sendChat warns when a message reached no peers (delivery feedback)", () => {
    // broadcastChat returns a delivered count; sendChat toasts on 0-with-peers.
    expect(CLIENT).toMatch(/function broadcastChat\(text: string, id: string\): number/);
    expect(CLIENT).toMatch(/if \(delivered === 0 && Object\.keys\(peers\)\.length > 0\)/);
  });

  it("audio routing is re-applied on a voice→video upgrade (survives setCam)", () => {
    expect(CLIENT).toMatch(/function reapplyAudioRouting\(\)/);
    expect(CLIENT).toMatch(/syncLivekitVideoPublication\(camOn\)\.then\(\(\) => \{ if \(camOn\) reapplyAudioRouting\(\); \}\)/);
  });

  it("accepting a call arms the audio unlock on the tap gesture", () => {
    // (v2.70.1 inserted the callAnswered flag between the two pinned lines.)
    expect(CLIENT).toMatch(/armAudioUnlock\(\);[\s\S]{0,120}?inCall = true; roomId = r\.roomId; enterCallUI\("In call"\);/);
  });
});

describe("v2.68 call-state + audio routing (verified)", () => {
  it("markEstablished() silences the ring AND flips to in-call at the real connect", () => {
    // The authoritative connect signal (mesh pc 'connected' / SFU connect) must
    // stop the ringtone and leave phase 'dialing' — this is what kills the iOS
    // phantom-ring-after-connect (Safari throttles the timer-based stop in the bg).
    expect(CLIENT).toMatch(
      /function markEstablished\(\) \{[\s\S]*?stopRingtone\(\);[\s\S]*?emitPhase\("in-call"\);[\s\S]*?setCallStatus\("live"\)/,
    );
  });

  it("connecting a headset while forced-loudspeaker is on hands audio back to it", () => {
    // Detected across input+output (Android often doesn't enumerate outputs, but
    // the headset MIC appears), so a headset connect drops the loudspeaker force.
    expect(CLIENT).toMatch(/let headsetWasPresent = false;/);
    expect(CLIENT).toMatch(
      /if \(headsetNow && !headsetWasPresent && loudspeakerOn\) \{[\s\S]*?loudspeakerDisable\(\)/,
    );
  });
});

describe("v2.69 background call-media keep-alive (verified, static-safe)", () => {
  it("registers an OS media session on connect and releases it on hang-up", () => {
    expect(CLIENT).toMatch(/function updateMediaSession\(active: boolean\)/);
    expect(CLIENT).toMatch(/updateMediaSession\(true\);/); // in markEstablished
    expect(CLIENT).toMatch(/updateMediaSession\(false\);/); // in hangUp
  });

  it("auto-resumes the forced-loudspeaker AudioContext if the OS suspends it", () => {
    // onstatechange resume (background) + resume on foreground return.
    expect(CLIENT).toMatch(/loudspeakerCtx\.onstatechange = \(\) => \{[\s\S]*?loudspeakerCtx\.resume\(\)/);
    expect(CLIENT).toMatch(/if \(loudspeakerOn\) \{ try \{ void loudspeakerCtx\?\.resume\(\); \}/);
  });

  it("swaps the published video from the rAF canvas to the raw camera when backgrounded", () => {
    // The filtered canvas.captureStream track freezes in the background; publish
    // the raw camera track while hidden, restore the filtered one on foreground.
    expect(CLIENT).toMatch(/async function bgSwapVideo\(hidden: boolean\)/);
    expect(CLIENT).toMatch(/void bgSwapVideo\(true\);/);
    expect(CLIENT).toMatch(/void bgSwapVideo\(false\);/);
  });

  it("writes the rejoin snapshot on pagehide (mobile-reliable), not just beforeunload", () => {
    expect(CLIENT).toMatch(/window\.addEventListener\("pagehide", onUnload\)/);
    expect(CLIENT).toMatch(/window\.removeEventListener\("pagehide", onUnload\)/);
  });
});

describe("camera QA fixes (verified)", () => {
  it("flip device selection normalizes an empty deviceId (iOS) and requires both ids", () => {
    expect(CLIENT).toMatch(/getSettings\?\.\(\)\.deviceId \|\| ""/);
    expect(CLIENT).toMatch(/cams\.find\(d => d\.deviceId && curId && d\.deviceId !== curId\)/);
  });

  it("self-tile is rebound (srcObject nulled) after a flip so no stale frame sticks", () => {
    expect(CLIENT).toMatch(/selfV\.srcObject = null;[\s\S]*?selfV\.srcObject = processedStream \|\| nu;/);
  });

  it("filter-off defers the pipeline dispose one tick so peers don't freeze", () => {
    expect(CLIENT).toMatch(/await new Promise\(r => setTimeout\(r, 0\)\);[\s\S]*?dying\?\.dispose\(\)/);
  });

  it("the canvas is sized to the DOWNSCALED resolution before captureStream", () => {
    expect(PIPE).toMatch(/MAX_PROC_HEIGHT \/ vh/);
    expect(PIPE).toMatch(/const sizeCanvas = \(\)/);
  });

  it("one frame is drawn before captureStream is read, and unsupported capture is surfaced", () => {
    // loop() is called inside the first-time (!outputStream) branch, before the
    // captureStream read; an unsupported captureStream is reported, not silent.
    expect(PIPE).toMatch(/this\.loop\(\);[\s\S]*?captureStream/);
    expect(PIPE).toMatch(/aren't supported on this browser/);
  });
});

describe("v2.70 multi-party grid + exit + quality (verified)", () => {
  it("SFU pre-creates a tile for every roster member (fixes 'only 4 tiles for 5-6')", () => {
    // onJoined / onRejoin / onResumed / onMerged all seed tiles from m.members,
    // and joinLivekit enumerates already-present remotes after connect.
    const matches = CLIENT.match(/\(m\.members \|\| \[\]\)\.forEach\(mem => addLkTile\(mem\.pin, mem\.name \|\| "Guest"\)\)/g) || [];
    expect(matches.length).toBeGreaterThanOrEqual(4);
    expect(CLIENT).toMatch(/remoteParticipants \|\| [\s\S]*?\.participants[\s\S]*?addLkTile\(p\.identity/);
  });

  it("a participant exit surfaces a visible toast (not just a chat system message)", () => {
    expect(CLIENT).toMatch(/toast\(\(nm \|\| "Someone"\) \+ " left the call\."\)/); // mesh removePeer
    expect(CLIENT).toMatch(/toast\(nm \+ " left the call\."\)/); // SFU removeLkTile
  });

  it("an established peer that drops shows 'reconnecting…' instead of freezing silently", () => {
    expect(CLIENT).toMatch(/const broken = st === "failed" \|\| st === "disconnected";/);
    expect(CLIENT).toMatch(/if \(!broken && \(st === "connected" \|\| peer\.gotStream\)\)/);
  });

  it("mesh screen-share groups video under sendStream's msid (mid-share joiner fix)", () => {
    expect(CLIENT).toMatch(/if \(vtrack\) pc\.addTrack\(vtrack, sendStream\);/);
  });

  it("published camera/screen tracks carry a contentHint; SFU uses the speech Opus preset", () => {
    expect(CLIENT).toMatch(/contentHint = "motion"/);
    expect(CLIENT).toMatch(/contentHint = "detail"/);
    expect(CLIENT).toMatch(/publishDefaults = \{ audioPreset: AudioPresetsEnum\.speech \}/);
  });
});

describe("v2.70.1 — dial disconnect hotfix (verified)", () => {
  it("the SFU join watchdog NEVER tears down a still-ringing (unanswered) call", () => {
    // It used to hangUp("livekit-join-timeout") ~16.5s after DIAL — the watchdog
    // is armed by enterCallUI at "Calling…" — so a slow/failing caller-side SFU
    // connect killed every outgoing call while it was still ringing.
    expect(CLIENT).toMatch(/let callAnswered = false;/);
    expect(CLIENT).toMatch(/if \(!callAnswered\) \{[\s\S]*?refresh-livekit[\s\S]*?return;\s*\}/);
  });

  it("callAnswered flips on any second-party evidence and resets on hangUp", () => {
    const matches = CLIENT.match(/callAnswered = true;/g) || [];
    expect(matches.length).toBeGreaterThanOrEqual(3); // acceptInvite + createPeer + addLkTile
    expect(CLIENT).toMatch(/inCall = false; roomId = null; callAnswered = false;/);
  });

  it("a throwing LiveKit Room constructor falls back to bare options (never kills dialing)", () => {
    expect(CLIENT).toMatch(/room = new RoomCtor\(roomOpts\);\s*\} catch/);
    expect(CLIENT).toMatch(/room = new RoomCtor\(\{ adaptiveStream: true, dynacast: true \}\); \}/);
  });
});

describe("v2.72 — mobile call QA fixes (verified)", () => {
  it("#1 camera flip stops the old camera BEFORE acquiring the new one (v2.96.1: every platform, with retries)", () => {
    // Many phones hold only one camera at a time — acquiring while the old is
    // live froze the page (iOS always; some Android WebViews too). v2.96.1:
    // stop-first EVERYWHERE, then acquire with retry+backoff (a just-released
    // camera can transiently NotReadableError), with recovery on failure.
    expect(CLIENT).toMatch(/oldVideo\.forEach\(t => t\.stop\(\)\);\s*\n\s*const nuVideo = await acquireFlippedCameraWithRetry\(next\)/);
    expect(CLIENT).toMatch(/async function acquireFlippedCameraWithRetry\(/);
    expect(CLIENT).toMatch(/const delays = \[0, 300, 700\];/);
    // Failure recovery re-grabs the ORIGINAL facing so the tile never dies.
    expect(CLIENT).toMatch(/await acquireFlippedCameraWithRetry\(facingMode\)/);
  });

  it("#3 SFU camera toggle unpublishes WITHOUT stopping the track (re-enable works)", () => {
    expect(CLIENT).toMatch(/lp\.unpublishTrack\(lt\.mediaStreamTrack, false\)/);
    expect(CLIENT).toMatch(/async function reacquireCameraForPublish\(\)/);
  });

  it("#5 iOS filters probe for a live frame and fall back to the raw camera if dead", () => {
    expect(CLIENT).toMatch(/function probeTrackLive\(stream: MediaStream\)/);
    expect(CLIENT).toMatch(/if \(IS_IOS && processedStream\) \{[\s\S]*?probeTrackLive\(processedStream\)/);
    expect(CLIENT).toMatch(/Live filters aren't supported on this browser/);
  });

  it("#2 screen-share tells MOBILE users it's desktop-only (no mobile browser has getDisplayMedia)", () => {
    // Android Chrome ALSO lacks getDisplayMedia (not just iOS) — so the message
    // must not say 'Try Chrome' to a phone user; it must point them to a desktop.
    expect(CLIENT).toMatch(/Screen sharing only works on a computer/);
    expect(CLIENT).not.toMatch(/Use a desktop or Android Chrome/);
  });

  it("IS_IOS is defined once (hoisted for the flip/filter paths)", () => {
    expect((CLIENT.match(/const IS_IOS = \(\(\) => \{/g) || []).length).toBe(1);
  });
});
