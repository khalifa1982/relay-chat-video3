/**
 * VIDEO → VOICE ACTUALLY STOPS THE CAMERA — the round trip, not just the way down.
 *
 * ── WHAT WAS ALREADY DONE, SAID FIRST ────────────────────────────────────────────
 * The headline of this task ("the downgrade disables the track rather than stopping
 * it") had ALREADY SHIPPED as #145 the night before, and `cameraOffStops.test.ts`
 * pins it: `setCam(false)` reaches `stopCameraCapture`, which stops the track, clears
 * `onended` first, spares a live screen share, and pauses rather than destroys the
 * filter pipeline. None of that is re-asserted here; duplicating a pin is how two
 * copies of one rule come to disagree.
 *
 * What #145 did NOT cover is the half the brief calls the hard part: **coming back**.
 * Stopping the camera on every camera-off turned `reacquireCameraForPublish` from a
 * rare recovery path (it used to run only when the OS had KILLED the camera) into the
 * ordinary way the camera returns — so it is now on the critical path of a button
 * every user presses, and the failure it can produce is precisely "a camera button
 * that silently does nothing".
 *
 * ── THE DEFECT THIS FILE EXISTS FOR ──────────────────────────────────────────────
 * `stopCameraCapture` is async: it awaits `replaceVideoEverywhere(null)`, which does
 * one `await sender.replaceTrack(null)` PER PEER. That is a real window, and it grows
 * with the size of the call. A camera-button DOUBLE TAP lands `setCam(true)` inside
 * it — and `setCam(true)` decides whether to reacquire by asking `haveLive`, which is
 * still TRUE, because the track it is about to stop has not been stopped yet. So it
 * skipped the reacquire, the pending stop then took the camera down underneath it,
 * and the user was left with the button reading ON, the self tile showing video, and
 * every sender holding null.
 *
 * The mirror runs the other way and is worse, because it leaves the light on: turning
 * the camera OFF while a reacquire is in flight left the fresh track installed and
 * merely DISABLED — `mediaGen` does not move for a camera toggle, so the existing
 * staleness guard never fires — which is the exact outcome stopping the camera exists
 * to prevent.
 *
 * Both are resolved by re-reading `camOn` after the await. `camOn` is what the user
 * has asked for, it is written synchronously at the top of `setCam`, and asking it
 * again is asking the right question — where an epoch counter would need a second
 * in-flight transition not to invalidate the first.
 *
 * ── HONEST LIMIT ─────────────────────────────────────────────────────────────────
 * Source-pinned by necessity. There is no camera, no `navigator.mediaDevices` and no
 * OS indicator in this environment, so whether a real device drops its capture cannot
 * be observed here. The assertions are therefore about ORDERING and GUARDS, which is
 * where this class of change goes wrong — and each one names the failure it prevents.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { codeOnly } from "../../../server/testing/codeOnly";

const ROOT = path.resolve(__dirname, "../../..");
const RAW = fs.readFileSync(path.join(ROOT, "client/src/lib/relayClient.ts"), "utf8");
/* Comments stripped before anything is FORBIDDEN: the new comments in this file
   describe the very failures being ruled out ("the camera light stays on",
   "removeTrack"), so a `not.toMatch` over raw source would match my own prose — the
   trap this repo has hit around twenty times. */
const ENGINE = codeOnly(RAW);

/** A function body, brace-matched from the brace that opens it. */
function fnBody(src: string, decl: string): string {
  const at = src.indexOf(decl);
  expect(at, `${decl} must exist`).toBeGreaterThan(-1);
  const open = src.indexOf("{", at + decl.length - 1);
  expect(open, `${decl} must have a body`).toBeGreaterThan(-1);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(open, i + 1);
  }
  throw new Error(`${decl} body is not closed`);
}

/** Index of `needle` inside `hay`, asserted to exist so no comparison is vacuous. */
function idx(hay: string, needle: string | RegExp, what: string): number {
  const at = typeof needle === "string" ? hay.indexOf(needle) : hay.search(needle);
  expect(at, `${what} must be present`).toBeGreaterThan(-1);
  return at;
}

/**
 * The `{ … }` block that opens at/after `from`, brace-matched.
 *
 * FOUND BY MUTATION, and worth recording because it is the recurring shape: the first
 * version of the bail-out tests asserted `return;` somewhere in `slice(check, stop)`,
 * and `stopCameraCapture` has an UNRELATED `if (!cam.length) return;` inside that
 * window — so deleting the real `return` (leaving the check to fall through and stop
 * the camera anyway, i.e. the exact bug) SURVIVED. A window wide enough to catch a
 * neighbour's statement is a window that proves nothing about this one.
 */
function blockAt(src: string, from: number): string {
  const open = src.indexOf("{", from);
  expect(open, "a block must open here").toBeGreaterThan(-1);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(open, i + 1);
  }
  throw new Error("block is not closed");
}

const setCam = () => fnBody(ENGINE, "function setCam(on: boolean)");
const stopCam = () => fnBody(ENGINE, "async function stopCameraCapture()");
const reacquire = () => fnBody(ENGINE, "async function reacquireCameraForPublish()");
const replaceEverywhere = () =>
  fnBody(ENGINE, "async function replaceVideoEverywhere(track: MediaStreamTrack | null)");

describe("the camera turned back ON mid-detach is re-published, never stopped", () => {
  it("stopCameraCapture re-reads camOn AFTER the await and bails out before the stop", () => {
    /* THE DOUBLE-TAP BUG. Without this check the second tap's `setCam(true)` sees a
       still-live track, skips the reacquire, and this function then stops it — the
       button reads ON over a camera that is gone, and only toggling twice more
       recovers it. */
    const fn = stopCam();
    const detach = idx(fn, "replaceVideoEverywhere(null)", "the detach");
    const check = idx(fn, /if \(camOn\) \{/, "the re-read of camOn");
    const stop = idx(fn, "t.stop()", "the stop");
    expect(check).toBeGreaterThan(detach); // after the await, or it reads a stale answer
    expect(check).toBeLessThan(stop); // before the stop, or it decides nothing
    /* …and it must actually LEAVE. A check that falls through still stops the camera.
       Asserted inside the block's OWN braces: the function has an unrelated
       `if (!cam.length) return;` further down, and a window wide enough to reach it
       let exactly this mutation survive. */
    expect(blockAt(fn, check)).toMatch(/\breturn;/);
  });

  it("the bail-out re-publishes, so the senders do not keep the null we just gave them", () => {
    /* Returning early is only half of it: `replaceVideoEverywhere(null)` has already
       landed, so every video sender holds null. Leaving it there is the same silent
       dead button by a shorter route. */
    const fn = stopCam();
    const branch = blockAt(fn, idx(fn, /if \(camOn\) \{/, "the re-read of camOn"));
    expect(branch).toMatch(/currentCameraVideoTrack\(\)/);
    expect(branch).toMatch(/replaceVideoEverywhere\(/);
  });

  it("…and the re-publish never fires over a live screen share", () => {
    /* While sharing, the detach was skipped, so there is nothing to restore — and
       publishing the camera onto that sender is exactly how "turn my camera on" would
       silently END somebody's screen share. */
    const fn = stopCam();
    const branch = blockAt(fn, idx(fn, /if \(camOn\) \{/, "the re-read of camOn"));
    expect(branch).toMatch(/if \(!screenSharing\)/);
  });
});

describe("the camera turned OFF mid-acquire is released, never left captured", () => {
  it("setCam's reacquire continuation re-reads camOn before it publishes", () => {
    /* THE MIRROR, and the one that leaves the OS camera light on. `mediaGen` only
       moves on a full release, so the v2.99.36 staleness guard inside
       `reacquireCameraForPublish` cannot see a camera toggle — the fresh track comes
       back installed in `localStream`, `syncCamEnabled` merely DISABLES it, and the
       capture stays open with the button reading OFF. */
    const fn = setCam();
    const acquired = idx(fn, "await reacquireCameraForPublish()", "the reacquire");
    const check = idx(fn, /if \(!camOn\)/, "the re-read of camOn");
    const publish = idx(fn, "replaceVideoEverywhere(track)", "the publish");
    expect(check).toBeGreaterThan(acquired);
    expect(check).toBeLessThan(publish);
  });

  it("it releases the track it just acquired, through the one funnel that knows how", () => {
    /* Not by stopping it inline: `stopCameraCapture` also detaches the senders, pauses
       the pipeline and rebuilds `localStream` audio-only. A second, partial teardown
       here is how the two come to disagree about what "camera off" leaves behind. */
    const fn = setCam();
    const branch = blockAt(fn, idx(fn, /if \(!camOn\)/, "the re-read of camOn"));
    expect(branch).toMatch(/stopCameraCapture\(\)/);
    expect(branch).toMatch(/\breturn;/); // and it does not fall through into the publish
  });
});

describe("coming back reacquires — the half that makes the downgrade safe to ship", () => {
  it("the ON path asks whether a LIVE track exists, and reacquires when none does", () => {
    /* Post-#145 there is genuinely no track after a camera-off, so this branch is no
       longer a rare recovery — it is the ordinary way the camera returns. Asking
       `readyState === "live"` rather than merely counting tracks is what makes it
       true for a stopped one. */
    const fn = setCam();
    expect(fn).toMatch(/getVideoTracks\(\)\.some\(t => t\.readyState === "live"\)/);
    const guard = idx(fn, "if (!haveLive)", "the reacquire guard");
    const call = idx(fn, "await reacquireCameraForPublish()", "the reacquire");
    expect(call).toBeGreaterThan(guard);
  });

  it("the reacquired track is INSTALLED into localStream, not merely returned", () => {
    /* If it were only handed back, `haveLive` would stay false forever: every later
       toggle would re-prompt and re-acquire, and `outStream()` would keep serving a
       stream with no camera in it. Installing it is what makes the cycle repeatable. */
    const fn = reacquire();
    expect(fn).toMatch(/localStream = new MediaStream\(\[\.\.\.audio, v\]\)/);
  });

  it("with a filter on it returns the PIPELINE's output, so the filter survives the trip", () => {
    /* `stopCameraCapture` pauses the pipeline instead of destroying it precisely so the
       user's chosen filter is still there on the way back. Returning the raw camera
       here would throw that away at the last step and publish an unfiltered track. */
    const fn = reacquire();
    const restart = idx(fn, "pipeline.setInputStream(localStream)", "the pipeline restart");
    const out = idx(fn, "pipeline.getOutputStream()", "the processed output");
    expect(out).toBeGreaterThan(restart); // restarted before its output is read
  });

  it("a reacquire that FAILS says so and puts the button back, rather than lying", () => {
    /* The honest failure. Leaving `camOn` true over a camera that never opened is the
       silent-dead-button outcome in its purest form. */
    const fn = setCam();
    const branch = blockAt(fn, idx(fn, "} else {", "the failure branch"));
    expect(branch).toMatch(/camOn = false/);
    expect(branch).toMatch(/\$\("camBtn"\)\?\.classList\.add\("off"\)/);
    expect(branch).toMatch(/toast\(/);
  });

  it("every exit from the acquisition goes THROUGH a stop, never around one", () => {
    /* A stream opened and then abandoned is a capture with nothing left able to stop
       it — the camera light staying on, which is the whole point of this work. Two
       such exits existed: the first attempt being overwritten when it carried no video
       track, and the `!v` bail-out. */
    const fn = reacquire();
    // Every `return null` that can follow a successful getUserMedia is preceded by a stop.
    expect(fn).toMatch(/stopStream\(fresh\);\s*\n?\s*fresh = await acquireFlippedCamera/);
    expect(fn).toMatch(/if \(!v\) \{ stopStream\(fresh\); return null; \}/);
    expect(fn).toMatch(/if \(mediaStale\(genP\) \|\| !localStream\) \{ stopStream\(fresh\); return null; \}/);
  });
});

describe("the microphone is untouched by any of it", () => {
  it("the way DOWN carries the same audio track objects across", () => {
    /* This is WHY mute survives — not a coincidence worth leaving unstated. The stream
       is rebuilt, but from the SAME track objects, so their `enabled` flag (which is
       what mute is) comes with them. Re-acquiring audio here would hand back a fresh
       track defaulting to enabled: somebody muted would be live while their own screen
       said otherwise, which is v2.106.88's bug with a privacy consequence. */
    const fn = stopCam();
    expect(fn).toMatch(/localStream = new MediaStream\(localStream\.getAudioTracks\(\)\)/);
    expect(fn).not.toMatch(/getUserMedia|acquireRawStream|audio: true/);
  });

  it("the way BACK carries them across too", () => {
    /* The other half, and the one nothing pinned: `reacquireCameraForPublish` installs a
       NEW `localStream`, and it is only safe because the audio it splices in is read
       out of the old one rather than re-acquired. Its own getUserMedia is `audio:
       false` for exactly this reason. */
    const fn = reacquire();
    expect(fn).toMatch(/const audio = localStream\.getAudioTracks\(\)/);
    expect(fn).toMatch(/localStream = new MediaStream\(\[\.\.\.audio, v\]\)/);
    expect(fn).toMatch(/audio: false/);
  });

  it("neither direction stops, disables or re-acquires a microphone track", () => {
    for (const [name, fn] of [["stopCameraCapture", stopCam()], ["reacquireCameraForPublish", reacquire()]] as const) {
      expect(fn, `${name} must not touch the mic`).not.toMatch(/getAudioTracks\(\)\.forEach|micOn|setMic\(/);
    }
  });

  it("syncMicEnabled still runs at the acquisition's single exit", () => {
    /* v2.106.88's guarantee, re-pinned here only because this work moved traffic onto
       the camera paths beside it: `ensureMediaInner` is where a WHOLLY NEW stream can
       be installed, and that is where the mute has to be re-applied. */
    const fn = fnBody(ENGINE, "async function ensureMediaInner(wantVideo: boolean)");
    const sync = idx(fn, "syncMicEnabled()", "the mute re-apply");
    const ret = fn.lastIndexOf("return outStream()");
    expect(ret).toBeGreaterThan(-1);
    expect(sync).toBeLessThan(ret);
  });
});

describe("the video m-line survives the camera being stopped", () => {
  it("the detach is a replaceTrack — never a removeTrack, transceiver or direction change", () => {
    /* THE PROPERTY THE BRIEF ASKS FOR. `replaceTrack` is specified NOT to renegotiate:
       the transceiver, its mid and its direction are all untouched, so the m-line
       negotiated under the v2.81 mutual-consent rule is still there and still sendable
       when the camera comes back. `removeTrack` or a direction write would need an
       offer/answer round trip before video could resume — the camera would appear to
       do nothing until something else happened to renegotiate.
       Corroborated in-repo: hold/swap has detached and re-attached with exactly this
       pair (`freezePeerMedia` / `thawPeerMedia`) for many releases. */
    const fn = replaceEverywhere();
    expect(fn).toMatch(/sender\.replaceTrack\(track\)/);
    expect(fn).not.toMatch(/removeTrack|addTransceiver|\.direction\s*=/);
  });

  it("the refill can find a sender whose track is NULL — or the camera never comes back", () => {
    /* The subtle half. After the detach every video sender has `track === null`, so the
       "find a sender that already sends video" clause matches nothing. Without the
       kind-aware empty-slot fallback there would be no sender to hand the fresh track
       to and the m-line would sit unused: the camera reacquired, the light on, and
       nothing arriving at the far end. */
    const fn = replaceEverywhere();
    expect(fn).toMatch(/senders\.find\(s => s\.track && s\.track\.kind === "video"\)/);
    expect(fn).toMatch(
      /getTransceivers\(\)\.find\(tr => tr\.mid !== null && !tr\.sender\.track && tr\.receiver\?\.track\?\.kind === "video"\)/,
    );
  });

  it("a peer created while our camera is off still negotiates a sendable video m-line", () => {
    /* Post-#145 `sendStream.getVideoTracks()[0]` is genuinely absent during a
       camera-off, so somebody joining then takes the null-track path. The OFFERER adds
       the transceiver explicitly; the ANSWERER cannot (an answer may not add an
       m-line), so it flips the offered one to sendrecv instead. Both halves, or one
       direction is locked out of ever sending video without a renegotiation. */
    const create = fnBody(ENGINE, "function createPeer(pin: string, name: string, initiator: boolean)");
    expect(create).toMatch(/else if \(initiator\) pc\.addTransceiver\("video", \{ direction: "sendrecv" \}\)/);
    const onSignal = ENGINE.slice(idx(ENGINE, 'tr.direction === "recvonly"', "the answerer's flip"));
    expect(onSignal.slice(0, 200)).toMatch(/tr\.direction = "sendrecv"/);
  });
});
