import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const ENGINE = read("client/src/lib/relayClient.ts");
const RELAY = read("server/relay.ts");
const VOICE = read("client/src/lib/voiceNote.ts");
const MESSAGES = read("client/src/pages/app/Messages.tsx");
const VMPROMPT = read("client/src/app/VoicemailPrompt.tsx");

/**
 * v2.99.36 — OWNER BUG: "when I finish the call and I minimize the browser, the
 * mic and the camera is still active — I cannot even have another call."
 *
 * A 5-dimension multi-agent audit of every capture/release path confirmed a
 * cluster of causes; these pin each fix.
 *
 *  A. THE WEDGE (the reported symptom). The red End button calls endActiveLine(),
 *     which SKIPS hangUp() — the only releaser — whenever heldRoomId is set, and
 *     waits for the server's `resumed`. onResumed never cleared heldRoomId, so
 *     after one end-and-resume heldRoomId === roomId; the next End took the
 *     silent branch, the server promoted nothing and replied NOTHING, and the
 *     engine wedged with inCall true + camera/mic captured + End a no-op (which
 *     also blocks a new call, since programmaticDial requires !inCall).
 *  B. IDLE HOLD. primeMedia() acquired camera+mic at login and deliberately KEPT
 *     them ("warm the stream and keep it ready") — so the devices were captured
 *     the whole time the app was open with no call at all.
 *  C. ORPHANED ACQUISITIONS. ensureMedia / flipCamera / reacquireCameraForPublish
 *     / recoverDeadLocalTrack all installed a stream AFTER an await with no
 *     staleness check, so a call ending mid-acquisition stranded a live capture.
 *  D. VOICE-NOTE MIC. voiceNote's stream was only stopped in rec.onstop, so a
 *     construct/start throw — or the caller unmounting during the await — left
 *     the mic open with no handle to stop it.
 */
describe("A — the end-active wedge is closed", () => {
  it("onResumed clears a stale heldRoomId (the wedge trigger)", () => {
    expect(ENGINE).toMatch(/if \(heldRoomId === rid\) \{ heldRoomId = null; heldLabel = null; \}/);
  });
  it("endActiveLine arms a fail-closed fallback that forces a real hang-up", () => {
    const fn = ENGINE.slice(ENGINE.indexOf("function endActiveLine()"), ENGINE.indexOf("function endActiveLine()") + 2200);
    expect(fn).toMatch(/endActiveT = setTimeout\(/);
    expect(fn).toMatch(/hangUp\("end-active-no-resume"\)/);
    expect(ENGINE).toMatch(/const END_ACTIVE_RESUME_MS = 4000/);
  });
  it("the fallback is disarmed on resume and on teardown", () => {
    expect(ENGINE).toMatch(/if \(endActiveT\) \{ clearTimeout\(endActiveT\); endActiveT = null; \}/);
    expect(ENGINE).toMatch(/function cancelEndActiveFallback\(\)/);
  });
  it("the SERVER always answers end-active (nohold) instead of going silent", () => {
    const seg = RELAY.slice(RELAY.indexOf('case "end-active"'), RELAY.indexOf('case "end-active"') + 1400);
    expect(seg).toMatch(/if \(!promoteHeldRoom\(reg, conn, self\)\)/);
    expect(seg).toMatch(/code: "nohold"/);
  });
  it("the client completes the hang-up on a nohold reply", () => {
    expect(ENGINE).toMatch(/m\.code === "nohold" && inCall/);
    expect(ENGINE).toMatch(/hangUp\("end-active-nohold"\)/);
  });
});

describe("B — the camera/mic are no longer held while idle", () => {
  it("primeMedia warms the PERMISSION and releases the devices immediately", () => {
    const fn = ENGINE.slice(ENGINE.indexOf("async function primeMedia()"), ENGINE.indexOf("async function primeMedia()") + 1400);
    expect(fn).toMatch(/probe\.getTracks\(\)\.forEach\(t => t\.stop\(\)\)/);
    // and it no longer keeps a stream by calling ensureMedia. Matched on the
    // CALL rather than the exact empty argument list (v2.106.44 gave it a mode
    // parameter, so `ensureMedia()` alone would let `ensureMedia(true)` slip in).
    expect(fn).not.toMatch(/ensureMedia\(/);
  });
  it("there is ONE release helper, used by hang-up and by engine teardown", () => {
    expect(ENGINE).toMatch(/function releaseLocalMedia\(reason: string\)/);
    expect(ENGINE).toMatch(/releaseLocalMedia\("hang-up:" \+ reason\)/);
    expect(ENGINE).toMatch(/releaseLocalMedia\("engine-destroy"\)/);
  });
  it("it also stops the filter pipeline and clears the self-preview srcObject", () => {
    const fn = ENGINE.slice(ENGINE.indexOf("function releaseLocalMedia"), ENGINE.indexOf("function releaseLocalMedia") + 1200);
    expect(fn).toMatch(/pipeline\.destroy\(\)/);
    expect(fn).toMatch(/selfV\.srcObject = null/);
  });
  it("backgrounding with NO call in progress releases any leftover capture", () => {
    expect(ENGINE).toMatch(/releaseLocalMedia\("hidden-while-idle"\)/);
  });
});

describe("C — an acquisition that lands after the call ended is discarded", () => {
  it("a monotonic media generation is bumped on every release", () => {
    expect(ENGINE).toMatch(/let mediaGen = 0/);
    expect(ENGINE).toMatch(/mediaGen\+\+/);
    expect(ENGINE).toMatch(/function mediaStale\(gen: number\)/);
    expect(ENGINE).toMatch(/return destroyed \|\| gen !== mediaGen/);
  });
  it("concurrent ensureMedia callers share ONE acquisition (no orphaned loser)", () => {
    // REWRITTEN v2.106.44 to the PROPERTY. This froze the exact one-liner
    // `if (ensureMediaInFlight) return ensureMediaInFlight`, which forbade the
    // mode-aware wait a voice/video split needs while saying nothing about the
    // rule: no caller may start a SECOND acquisition while one is in flight.
    expect(ENGINE).toMatch(/let ensureMediaInFlight: Promise<MediaStream> \| null = null/);
    const i = ENGINE.indexOf("function ensureMedia(");
    expect(i, "ensureMedia must exist").toBeGreaterThan(0);
    const fn = ENGINE.slice(i, ENGINE.indexOf("async function ensureMediaInner(", i));
    expect(fn.length, "the slice must be real").toBeGreaterThan(120);
    // Every path out of the gate either RETURNS the in-flight promise or CHAINS
    // off it — never runs ensureMediaInner beside it.
    expect(fn).toMatch(/if \(ensureMediaInFlight[^\n]*\) return ensureMediaInFlight/);
    expect(fn).toMatch(/ensureMediaInFlight\s*\n?\s*\.catch/);
    // ensureMediaInner is called from exactly ONE place, and it is the place
    // that also records the in-flight promise.
    expect(fn.match(/ensureMediaInner\(/g)?.length, "one call site").toBe(1);
    expect(fn).toMatch(/const p = ensureMediaInner\([\s\S]{0,200}ensureMediaInFlight = p/);
  });
  it("each acquire-after-await path checks staleness and stops the fresh stream", () => {
    for (const gen of ["genF", "genP", "genR"]) {
      expect(ENGINE, `${gen} must be captured before awaiting`).toMatch(new RegExp(`const ${gen} = mediaGen`));
      expect(ENGINE, `${gen} must be re-checked after`).toMatch(new RegExp(`mediaStale\\(${gen}\\)`));
    }
    expect(ENGINE).toMatch(/function stopStream\(/);
  });
});

describe("D — the voice-note microphone is always released", () => {
  it("a recorder that fails to construct or start still stops the mic", () => {
    /* ANCHORED ON THE AWAIT ITSELF, not on the declaration that used to precede it.
       v2.107.2 moved the acquisition into a try/catch (so a refused permission closes
       the level meter's context), which turned `const stream = await …` into
       `stream = await …` — and `indexOf` answers -1 for an absent needle, so this
       slice became `slice(-1)`, i.e. the LAST CHARACTER of the file, and the match
       count came back `undefined`. The negative-index trap this repo records at
       v2.99.78 / v2.106.56 / v2.106.65. The anchor is asserted to exist first, so it
       can never silently read nothing again. */
    const at = VOICE.indexOf("await navigator.mediaDevices.getUserMedia");
    expect(at, "the mic acquisition must exist").toBeGreaterThan(0);
    const seg = VOICE.slice(at);
    expect(seg.length, "the slice must be real").toBeGreaterThan(400);
    // both the recorder's construction and its start are guarded
    expect(seg.match(/stream\.getTracks\(\)\.forEach\(\(t\) => t\.stop\(\)\);\s*\n\s*throw e/g)?.length).toBe(2);
  });
  it("unmounting during the mic acquisition cancels the recording", () => {
    expect(MESSAGES).toMatch(/if \(!recorderAliveRef\.current\) \{ rec\.cancel\(\); return; \}/);
    expect(VMPROMPT).toMatch(/if \(!aliveRef\.current\) \{ rec\.cancel\(\); return; \}/);
  });
  it("a live recording is cancelled when the view unmounts", () => {
    expect(MESSAGES).toMatch(/recordingRef\.current\?\.cancel\(\)/);
    expect(VMPROMPT).toMatch(/recRef\.current\?\.cancel\(\)/);
  });
});
