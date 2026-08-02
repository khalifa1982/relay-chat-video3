/**
 * #160 — the two teardown gaps that leave a device or a session claimed after a call.
 *
 * Found by an audit that inventoried every `getUserMedia` / `getDisplayMedia` /
 * `AudioContext` / `MediaRecorder` site under `client/src/` and then tried to REFUTE each
 * candidate against the paths that already cover it. Most were refuted — `flipCamera`,
 * `reacquireCameraForPublish`, the screen share, `primeMedia`, the pre-connect dial
 * failures and `endActiveLine` are all covered by `mediaGen`/`mediaStale`, a `finally`, or
 * an existing teardown. What follows is what survived, and each is pinned with the reason
 * the obvious simpler fix would have been wrong.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../../..");
const ENGINE = fs.readFileSync(path.join(ROOT, "client/src/lib/relayClient.ts"), "utf8");
const VOICE = fs.readFileSync(path.join(ROOT, "client/src/lib/voiceNote.ts"), "utf8");

function body(src: string, decl: string): string {
  const at = src.indexOf(decl);
  expect(at, `${decl} not found`).toBeGreaterThan(-1);
  const open = src.indexOf("{", at);
  const end = src.indexOf("\n  }", open);
  expect(end, `${decl} has no closing brace`).toBeGreaterThan(open);
  return src.slice(open, end);
}

describe("#160 gap 1 — a concurrent recovery could orphan a LIVE microphone", () => {
  it("recovery is single-flight, like every other media entry point in this file", () => {
    /* THE SEQUENCE THAT REACHED IT, which is ordinary rather than exotic: the OS kills the
       mic, recovery A starts; the failure toast tells the user to "tap mute/unmute to
       retry" and they do, so `setMic` sees no live track and starts recovery B. A installs
       mic #1; B then removes mic #1 from the stream. `flipBusy`, `filterBusy` and
       `ensureMediaInFlight` all exist for exactly this and this one had nothing. */
    expect(ENGINE).toMatch(/let recoverBusy = false;/);
    const outer = body(ENGINE, "async function recoverDeadLocalTrack(kind: string)");
    expect(outer).toMatch(/if \(recoverBusy\) return;/);
    expect(outer).toMatch(/recoverBusy = true;/);
    // Released in a `finally`, or one throw wedges recovery for the rest of the call —
    // which is strictly worse than the race, because the mic then never comes back.
    expect(outer).toMatch(/finally \{\s*\n\s*recoverBusy = false;/);
    expect(outer).toMatch(/await recoverDeadLocalTrackInner\(kind\)/);
  });

  it("the guard cannot be satisfied by a flag nothing reads", () => {
    /* A `recoverBusy` that is set and never tested is the shape that reads as fixed. Both
       the read and the write are required, and the read must come FIRST. */
    const outer = body(ENGINE, "async function recoverDeadLocalTrack(kind: string)");
    expect(outer.indexOf("if (recoverBusy) return;")).toBeLessThan(outer.indexOf("recoverBusy = true;"));
  });

  it("a removed audio track is STOPPED, not merely removed", () => {
    /* The orphan is what made this a live-mic bug rather than a cosmetic one: a track
       removed from `localStream` and not stopped belongs to no stream at all, and
       `releaseLocalMedia` stops only `localStream`'s tracks, `pc.close()` does not stop a
       sender's track, and `replaceTrack` never stops the one it replaces. Nothing in the
       engine could reach it. `stop()` on an already-ended track is a no-op, so the
       ordinary single-recovery case is unchanged. */
    const inner = body(ENGINE, "async function recoverDeadLocalTrackInner(kind: string)");
    expect(inner).toMatch(
      /localStream\.getAudioTracks\(\)\.forEach\(t => \{[\s\S]{0,220}removeTrack\(t\)[\s\S]{0,220}t\.stop\(\)/,
    );
  });

  it("`mediaGen` is NOT what covers this, so the staleness check stays as well", () => {
    /* Both acquisitions land during a LIVE call with no release in between, so
       `mediaStale` is inert for this race — it guards a different one (a call that ended
       mid-acquisition) and both guards are needed. */
    const inner = body(ENGINE, "async function recoverDeadLocalTrackInner(kind: string)");
    expect(inner).toMatch(/const genR = mediaGen;/);
    expect(inner).toMatch(/if \(mediaStale\(genR\) \|\| !inCall \|\| !localStream\) \{ stopStream\(fresh\); return; \}/);
  });
});

describe("#160 gap 2 — the loudspeaker context was suspended, never closed", () => {
  it("`loudspeakerDisable` still only SUSPENDS, and that is deliberate", () => {
    /* Three of its four callers are mid-call (the speaker toggle, a route change), and a
       closed AudioContext cannot be reopened — `ensureLoudspeakerCtx` guards on
       `if (!loudspeakerCtx)`, so closing there would hand back a dead context and every
       later `resume()` would throw, killing the loudspeaker for the rest of the call. */
    const dis = body(ENGINE, "function loudspeakerDisable()");
    expect(dis).toMatch(/void loudspeakerCtx\?\.suspend\(\)/);
    expect(dis).not.toMatch(/loudspeakerCtx\?\.close|loudspeakerCtx = null/);
  });

  it("the close lives at teardown, and NULLS the reference so the next call rebuilds", () => {
    const rel = body(ENGINE, "function releaseLoudspeakerCtx()");
    expect(rel).toMatch(/loudspeakerDisable\(\);/);
    expect(rel).toMatch(/void loudspeakerCtx\?\.close\?\.\(\)/);
    expect(rel).toMatch(/loudspeakerCtx = null;/);
  });

  it("hang-up AND destroy both go through that one release", () => {
    /* Two implementations of "let go of the audio session" is how one of them comes to be
       the one that forgets. `destroy()` used to close without nulling, unlike its
       `cueCtx`/`ringtoneCtx` siblings. */
    expect((ENGINE.match(/releaseLoudspeakerCtx\(\)/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(ENGINE).not.toMatch(/loudspeakerDisable\(\); loudspeakerCtx\?\.close/);
  });

  it("rebuilding is safe because priming happens inside the gesture", () => {
    /* A context created OUTSIDE a user gesture starts suspended on iOS. Closing at
       teardown is only safe because `loudspeakerPrime()` runs inside the dial tap and the
       Answer tap — which is the whole reason that priming exists. */
    expect(ENGINE).toMatch(/function loudspeakerPrime\(\)/);
    expect((ENGINE.match(/loudspeakerPrime\(\)/g) ?? []).length).toBeGreaterThan(2);
    expect(ENGINE).toMatch(/if \(!loudspeakerCtx\) \{/);
  });

  it("its two siblings were already closed at hang-up — this one was the omission", () => {
    expect(ENGINE).toMatch(/teardownSpeakerMonitor\(\);/);
    expect(ENGINE).toMatch(/teardownLocalLevelMonitor\(\);/);
  });
});

describe("#160 gap 3 — the voice recorder's context on the throwing path", () => {
  it("a failed analyser setup closes the context before dropping it", () => {
    /* `createMediaStreamSource` can genuinely throw ("stream already tapped" — this repo's
       own `androidAudioCamera.test.ts` documents it), and nulling alone left an open
       context unreachable: `releaseAudio()` reads the already-nulled `ac`. */
    expect(VOICE).toMatch(/try \{ void ac\?\.close\?\.\(\); \} catch \{ \/\* \*\/ \}\s*\n\s*ac = null;/);
  });

  it("the MICROPHONE was never the problem here, and still is not", () => {
    /* Said plainly so nobody widens this fix: `finish()` stops the stream's tracks on
       every path, so only the audio SESSION leaked. */
    const stops = VOICE.match(/stream\.getTracks\(\)\.forEach\(\(t\) => t\.stop\(\)\)/g) ?? [];
    expect(stops.length, "the mic is stopped on the throw guards AND on the settle").toBe(3);
  });
});
