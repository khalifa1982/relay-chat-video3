import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * v2.106.44 — A VOICE CALL NO LONGER OPENS THE CAMERA.
 *
 * The owner's instruction is that voice and video are two MODES of one call
 * path, "differing only by the media profile applied" — and specifically, for
 * voice mode: "Publish: microphone only. Do NOT acquire or publish a camera
 * track." The audio profile is identical in both modes; only video is added.
 *
 * What was wrong: `acquireRawStream` requested `video` UNCONDITIONALLY, and a
 * voice dial then called `setCam(false)` — whose own comment admitted "the
 * track is already published, just disabled". So the letter of the v2.81
 * mutual-consent rule held (nothing transmits) while three real things went
 * wrong on every voice call:
 *
 *   1. the OS camera indicator lights up, on a call with no video in it;
 *   2. the device encodes frames it will never send (the "phone becomes very
 *      hot" class this repo measured in v2.99.84); and
 *   3. a camera-less desktop took the no-camera FALLBACK and toasted "No camera
 *      found — joining with audio only" on a call where none was ever wanted —
 *      a warning about a device the call had no use for.
 *
 * These are SOURCE pins by necessity: whether a camera opens is a property of
 * the getUserMedia constraints, and there is no camera (and no `navigator`) in
 * the node test environment. The behavioural half of this is the owner's
 * device check — step 1 of the verification list in their own instruction.
 */
const ENGINE = fs.readFileSync(path.resolve(__dirname, "relayClient.ts"), "utf8");

/** Strip comments so a `not.toMatch` can never be satisfied by prose ABOUT the
 *  pattern — this file explains in words exactly what it forbids in code. */
function codeOnly(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}
const CODE = codeOnly(ENGINE);

/** The body of a named function, found by brace matching rather than a fixed
 *  slice (the v2.99.78 fragility), and seeded from the anchor so an open paren
 *  in the signature cannot be mistaken for the body's own brace. */
function fnBody(src: string, anchor: string): string {
  const at = src.indexOf(anchor);
  expect(at, `anchor must exist: ${anchor}`).toBeGreaterThan(0);
  let i = at + anchor.length;
  let paren = (anchor.match(/\(/g) || []).length - (anchor.match(/\)/g) || []).length;
  // Walk to the body brace: the first `{` reached with parens closed.
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

describe("voice mode acquires NO camera", () => {
  it("acquireRawStream takes the mode and passes video:false in voice mode", () => {
    const body = fnBody(CODE, "async function acquireRawStream(");
    // The signature carries the flag…
    expect(CODE).toMatch(/async function acquireRawStream\(\s*useFacingMode: "user" \| "environment",\s*wantVideo = true,?\s*\)/);
    // …and the constraint is CONDITIONAL on it, not unconditional.
    expect(body).toMatch(/video: wantVideo \?[\s\S]{0,120}: false/);
    // An unconditional video constraint is exactly the defect.
    expect(body).not.toMatch(/video: \{ \.\.\.qualityVideo\(videoQuality\), facingMode: useFacingMode \}/);
  });

  it("the flag DEFAULTS to true, so an un-updated caller can only ever be byte-identical", () => {
    // This is what makes the change safe to land in one commit: it can narrow
    // what is opened, never widen it. A required parameter would have made
    // every missed call site a compile error rather than the old behaviour.
    expect(CODE).toMatch(/wantVideo = true/);
    expect(CODE).toMatch(/function ensureMedia\(wantVideo = true\)/);
  });

  it("ensureMedia threads the mode through to the acquisition", () => {
    const outer = fnBody(CODE, "function ensureMedia(wantVideo = true)");
    expect(outer).toMatch(/ensureMediaInner\(wantVideo\)/);
    const inner = fnBody(CODE, "async function ensureMediaInner(wantVideo: boolean)");
    expect(inner).toMatch(/acquireRawStream\(facingMode, wantVideo\)/);
    // A hardcoded literal at either hop would silently reinstate the defect.
    expect(inner).not.toMatch(/acquireRawStream\(facingMode\)/);
    expect(inner).not.toMatch(/acquireRawStream\(facingMode, true\)/);
  });

  it("every site that KNOWS the mode passes it", () => {
    // programmaticDial / programmaticGroupDial carry an explicit `voice` option;
    // acceptInvite derives it from the ring; the raw dialer and add-person use
    // the live camera state; rejoin uses the snapshot. Enumerated rather than
    // counted, so a NEW call site is visible as an unexplained bare call.
    const dial = fnBody(CODE, "async function programmaticDial(");
    expect(dial).toMatch(/ensureMedia\(!opts\?\.voice\)/);
    const group = fnBody(CODE, "async function programmaticGroupDial(");
    expect(group).toMatch(/ensureMedia\(!opts\?\.voice\)/);
    const accept = fnBody(CODE, "async function acceptInvite(");
    expect(accept).toMatch(/ensureMedia\(wantVideo\)/);
    const start = fnBody(CODE, "async function startCall()");
    expect(start).toMatch(/ensureMedia\(camOn\)/);
    const rejoin = fnBody(CODE, "async function onRejoin(");
    // BOTH attempts (there is a retry) must carry it…
    expect(rejoin.match(/ensureMedia\(rejoinWantsVideo\)/g)?.length, "first attempt AND its retry").toBe(2);
    // …and the value must be DERIVED from the snapshot rather than a constant.
    // Found by mutation: asserting only that the identifier is passed stayed
    // green when the derivation became `= true`, i.e. the pin named the
    // variable while saying nothing about the rule it carries.
    expect(rejoin).toMatch(/const rejoinWantsVideo = pendingRejoin \? pendingRejoin\.camOn : true/);
    // …and NOTHING calls it bare any more, which is what stops a mode-blind
    // caller quietly opening a camera on a voice call.
    expect(CODE).not.toMatch(/ensureMedia\(\)/);
  });

  it("the camera STATE is stood down in voice mode even though no track exists", () => {
    // The old guard was `opts?.voice && localStream && getVideoTracks().length > 0`
    // — i.e. it required the very track a voice call no longer has, so it would
    // now SKIP and leave a lit camera button, a video-looking self tile and a
    // publish gate reading `camOn === true` over a camera nobody opened.
    for (const anchor of ["async function programmaticDial(", "async function programmaticGroupDial("]) {
      const body = fnBody(CODE, anchor);
      expect(body).toMatch(/if \(opts\?\.voice\) setCam\(false\)/);
      expect(body).not.toMatch(/opts\?\.voice && localStream && localStream\.getVideoTracks\(\)\.length > 0/);
    }
    // addSelfTile reads camOn at creation, so standing it down BEFORE the call
    // UI is entered is what puts the avatar on the self tile.
    const self = fnBody(CODE, "function addSelfTile()");
    expect(self).toMatch(/if \(!camOn\) t\.classList\.add\("audio-only"\)/);
  });

  it("answering derives the mode from the RING, not only from the button", () => {
    const accept = fnBody(CODE, "async function acceptInvite(");
    // A voice DIAL answered with the plain Answer button is still voice: under
    // mutual consent our camera may not transmit until a video-request is
    // accepted, so opening one would capture frames that cannot be sent.
    expect(accept).toMatch(/const wantVideo = !!\(r\.video && !opts\?\.voice\)/);
    expect(accept).toMatch(/if \(!wantVideo\) setCam\(false\)/);
    // The consent bookkeeping is unchanged: answering a VIDEO dial as video is
    // the consent, and answering it as voice is not.
    expect(accept).toMatch(/if \(r\.video && !opts\?\.voice\) videoApproved = true/);
  });

  it("VOICE→VIDEO still works with no camera at call start", () => {
    // The upgrade path must ADD a camera rather than assume one is already
    // there. Both transports already reacquire when enabling with no live
    // track; this pins that they still do, because without it the owner's
    // mid-call "upgrade to video" would be a button that does nothing.
    const unlock = fnBody(CODE, "function unlockApprovedVideo()");
    expect(unlock).toMatch(/if \(!camOn\) setCam\(true\)/);
    const setCam = fnBody(CODE, "function setCam(on: boolean)");
    expect(setCam).toMatch(/reacquireCameraForPublish\(\)/);
    const sync = fnBody(CODE, "async function syncLivekitVideoPublication(enabled: boolean)");
    expect(sync).toMatch(/reacquireCameraForPublish\(\)/);
    // …and reacquire builds the fresh stream from the EXISTING audio tracks, so
    // it needs no camera to have been open at join time.
    const re = fnBody(CODE, "async function reacquireCameraForPublish()");
    expect(re).toMatch(/const audio = localStream\.getAudioTracks\(\)/);
    expect(re).toMatch(/new MediaStream\(\[\.\.\.audio, v\]\)/);
  });

  it("a VIDEO call after a VOICE call in one session gets a camera", () => {
    // The cached-stream reuse used to key on the MIC alone, so the second call
    // would be handed the voice call's audio-only stream and read as "my camera
    // is never recognized". It now adds one — WITHOUT tearing down a working
    // mic to chase it, since a re-prompt can fail (device busy) and that would
    // cost the call its audio.
    const inner = fnBody(CODE, "async function ensureMediaInner(wantVideo: boolean)");
    expect(inner).toMatch(/if \(wantVideo && !localStream\.getVideoTracks\(\)\.some\(t => t\.readyState === "live"\)\)/);
    expect(inner).toMatch(/const added = await reacquireCameraForPublish\(\)/);
    // The mic is never stopped on that branch.
    const upTo = inner.slice(0, inner.indexOf("cached media is dead") >= 0 ? inner.indexOf("cached media is dead") : inner.length);
    expect(upTo).not.toMatch(/localStream\.getTracks\(\)\.forEach\(t => t\.stop\(\)\)/);
    // A failed add degrades honestly rather than claiming the camera is live.
    expect(inner).toMatch(/if \(!added\)[\s\S]{0,200}camOn = false/);
  });

  it("concurrent callers wanting DIFFERENT modes cannot start two acquisitions", () => {
    // Sharing one in-flight promise is what stops an orphaned stream (v2.99.36),
    // but a VOICE acquisition in flight cannot satisfy a VIDEO caller — so the
    // video caller must WAIT for it and re-run, never run beside it.
    const outer = fnBody(CODE, "function ensureMedia(wantVideo = true)");
    expect(outer).toMatch(/ensureMediaInFlightWantsVideo/);
    expect(outer).toMatch(/if \(ensureMediaInFlight && \(!wantVideo \|\| ensureMediaInFlightWantsVideo\)\) return ensureMediaInFlight/);
    expect(outer).toMatch(/\.then\(\(\) => ensureMedia\(wantVideo\)\)/);
    expect(outer.match(/ensureMediaInner\(/g)?.length).toBe(1);
  });

  it("voice mode never reports a missing CAMERA as the reason a call failed", () => {
    // In voice mode the request WAS audio-only, so retrying identical
    // constraints could only fail identically — and calling that a "no camera"
    // fallback is a false claim about a call that never wanted one.
    const inner = fnBody(CODE, "async function ensureMediaInner(wantVideo: boolean)");
    expect(inner).toMatch(/if \(!wantVideo\)[\s\S]{0,200}Mic blocked/);
    // The fallback branch (and its camera toast) stays reachable for VIDEO.
    expect(inner).toMatch(/No camera found/);
  });

  it("the AUDIO profile is identical in both modes — only video is added", () => {
    // The owner's constraint: "Audio profile is the same in both modes". One
    // shared constant, and the mode flag must never reach it.
    expect(CODE).toMatch(/const AUDIO_CONSTRAINTS/);
    const body = fnBody(CODE, "async function acquireRawStream(");
    expect(body).toMatch(/audio: AUDIO_CONSTRAINTS/);
    expect(body).not.toMatch(/audio: wantVideo/);
    // Mono + the three cleanups are the profile, and they are unconditional.
    const audio = CODE.slice(CODE.indexOf("const AUDIO_CONSTRAINTS"), CODE.indexOf("async function acquireRawStream("));
    for (const k of ["echoCancellation", "noiseSuppression", "autoGainControl", "channelCount"]) {
      expect(audio, `${k} must be part of the shared audio profile`).toMatch(new RegExp(k));
    }
  });

  it("primeMedia is deliberately left warming BOTH permissions", () => {
    // It acquires and immediately RELEASES (v2.99.36), so it holds nothing —
    // and narrowing it to audio would make the first VIDEO call prompt for the
    // camera mid-dial, which is the very thing it exists to avoid.
    const body = fnBody(CODE, "async function primeMedia()");
    expect(body).toMatch(/video: true/);
    expect(body).toMatch(/probe\.getTracks\(\)\.forEach\(t => t\.stop\(\)\)/);
  });
});
