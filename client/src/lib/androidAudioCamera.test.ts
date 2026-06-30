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
