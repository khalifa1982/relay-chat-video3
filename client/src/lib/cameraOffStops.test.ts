/**
 * #145 — turning the camera off STOPS it.
 *
 * Owner: video → voice should stop the camera track, not merely disable it.
 *
 * `track.enabled = false` keeps the CAPTURE open — the OS camera indicator stays lit, the
 * sensor keeps running, and the encoder keeps producing black frames that cost real uplink
 * and real CPU. On a phone that is the heat (v2.106.56 measured this class); on any device
 * it is a light saying "this app can see you" when it cannot.
 *
 * Source-pinned by necessity: there is no camera and no `navigator.mediaDevices` in this
 * environment, so what a real device does with the indicator cannot be observed here. The
 * assertions are therefore about the ORDERING and the GUARDS, which is where this change
 * can go wrong — and each of the three has a specific failure it prevents.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../../..");
const ENGINE = fs.readFileSync(path.join(ROOT, "client/src/lib/relayClient.ts"), "utf8");
const PIPELINE = fs.readFileSync(path.join(ROOT, "client/src/lib/mediaPipeline.ts"), "utf8");

/** A function's body, bounded by its own closing brace at column 2. */
function body(src: string, decl: string): string {
  const at = src.indexOf(decl);
  expect(at, `${decl} not found`).toBeGreaterThan(-1);
  const open = src.indexOf("{", at);
  const end = src.indexOf("\n  }", open);
  expect(end, `${decl} has no closing brace`).toBeGreaterThan(open);
  return src.slice(open, end);
}

describe("#145 — camera OFF releases the device", () => {
  it("setCam(false) reaches a stop, not just a disable", () => {
    const setCam = body(ENGINE, "function setCam(on: boolean)");
    // The synchronous disable STAYS and runs first — see below for why.
    expect(setCam).toMatch(/getVideoTracks\(\)\.forEach\(t => \(t\.enabled = camOn\)\)/);
    expect(setCam).toMatch(/else \{\s*\n\s*void stopCameraCapture\(\);/);
  });

  it("the synchronous disable still runs FIRST, so nothing leaks before the stop lands", () => {
    /* `stopCameraCapture` is async (it awaits `replaceVideoEverywhere`). Between the tap
       and that landing, the only thing keeping frames off the wire is `enabled = false` —
       so removing it in favour of the stop would open a window in which the camera is
       still publishing. Both, in this order. */
    const setCam = body(ENGINE, "function setCam(on: boolean)");
    const disable = setCam.indexOf("t.enabled = camOn");
    const stop = setCam.indexOf("stopCameraCapture()");
    expect(disable).toBeGreaterThan(-1);
    expect(stop).toBeGreaterThan(-1);
    expect(disable).toBeLessThan(stop);
  });

  it("it stops the track and clears `onended` before doing so", () => {
    /* `stop()` does not fire `ended` per spec, but `recoverDeadLocalTrack` is armed on
       that handler — a recovery storm for a track killed ON PURPOSE would reopen the very
       camera we were asked to close. `stopScreenShare` applies the same pairing. */
    const fn = body(ENGINE, "async function stopCameraCapture()");
    expect(fn).toMatch(/cam\.forEach\(t => \{ t\.onended = null; t\.stop\(\); \}\)/);
  });

  it("it never ends a live SCREEN SHARE", () => {
    /* The screen owns the video sender while sharing, so publishing null would stop the
       share — and "turn my camera off" is not "stop sharing my screen". The camera is
       stopped either way: during a share it is not published at all, so holding it open
       buys nothing and costs the indicator. */
    const fn = body(ENGINE, "async function stopCameraCapture()");
    expect(fn).toMatch(/if \(!screenSharing\) \{[\s\S]{0,160}replaceVideoEverywhere\(null\)/);
    // …and the stop itself is OUTSIDE that guard.
    const guard = fn.indexOf("if (!screenSharing)");
    const stop = fn.indexOf("t.stop()");
    expect(stop).toBeGreaterThan(guard);
    expect(fn.slice(guard, stop)).toMatch(/\n    \}/); // the guard closed before the stop
  });

  it("coming back does not publish the camera OVER a live screen share", () => {
    /* THE REGRESSION THIS CHANGE WOULD OTHERWISE INTRODUCE. `setCam(true)` reacquires when
       no live track is present — a branch that used to fire only when the camera had DIED.
       Stopping on camera-off makes it fire for the ordinary off→on during a share, where
       an unguarded `replaceVideoEverywhere(track)` would end the share. */
    const setCam = body(ENGINE, "function setCam(on: boolean)");
    expect(setCam).toMatch(/if \(!screenSharing\) await replaceVideoEverywhere\(track\)/);
    expect(setCam).not.toMatch(/\n\s*await replaceVideoEverywhere\(track\)/);
  });

  it("the reacquire path it leans on is still there, and is the ONLY way back", () => {
    /* Composing with the existing branch rather than adding a second way for the camera to
       return is the whole reason this is small. If that branch is ever removed, camera-off
       becomes camera-gone. */
    const setCam = body(ENGINE, "function setCam(on: boolean)");
    expect(setCam).toMatch(/const haveLive = localStream\.getVideoTracks\(\)\.some\(t => t\.readyState === "live"\)/);
    expect(setCam).toMatch(/if \(!haveLive\)/);
    expect(setCam).toMatch(/await reacquireCameraForPublish\(\)/);
    expect((ENGINE.match(/reacquireCameraForPublish\(\)/g) ?? []).length).toBeGreaterThan(1);
  });

  it("the pipeline is PAUSED, never destroyed — the filter has to survive", () => {
    /* Destroying it would silently reset the user's chosen filter to none on the way back,
       which is a visible loss in exchange for an invisible saving. Pausing stops the loop
       and `setInputStream` restarts it, so resuming needs no second mechanism. */
    const fn = body(ENGINE, "async function stopCameraCapture()");
    expect(fn).toMatch(/pipeline\.pause\(\)/);
    expect(fn).not.toMatch(/pipeline\.destroy\(\)|pipeline = null/);
  });

  it("pause() really stops the loop, and setInputStream really restarts it", () => {
    /* Both halves, because a pause with no resume is a camera that comes back with a dead
       canvas — worse than the frozen frame it exists to stop. */
    const p = body(PIPELINE, "pause()");
    expect(p).toMatch(/cancelAnimationFrame\(this\.rafId\)/);
    expect(p).toMatch(/this\.rafId = null/);
    expect(PIPELINE).toMatch(/if \(this\.rafId === null\) this\.loop\(\)/);
  });

  it("audio is untouched — this is the camera control, not the mic", () => {
    const fn = body(ENGINE, "async function stopCameraCapture()");
    expect(fn).toMatch(/localStream = new MediaStream\(localStream\.getAudioTracks\(\)\)/);
    // Nothing here may stop, disable or reacquire an audio track.
    expect(fn).not.toMatch(/getAudioTracks\(\)\.forEach|micOn|audio: true/);
  });
});
