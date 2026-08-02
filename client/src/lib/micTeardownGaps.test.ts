/**
 * TWO MIC-TEARDOWN GAPS THAT TWO PRIOR AUDITS BOTH WALKED PAST.
 *
 * The owner reported the microphone staying active after a call. `mediaRelease.test.ts`
 * (v2.99.36) and `micTeardown.test.ts` (#160) each swept this ground; between them they
 * fixed the staleness checks, the single-flight recovery guard, the removed-but-not-
 * stopped track, the voice recorder's context and the loudspeaker context. What follows
 * is what BOTH of them missed, in the two functions they were reading at the time.
 *
 * GAP 1 — `recoverDeadLocalTrackInner`, the audio branch. #160 fixed the removal loop
 * and left the exits ABOVE it going AROUND the stop. `if (!at) throw new Error("no-track")`
 * runs when `getUserMedia` has ALREADY resolved, so a live microphone exists, and the
 * throw hands it to a `catch` that only raises a toast. That capture is then reachable
 * from nothing: `releaseLocalMedia` stops `localStream`'s tracks and the track was never
 * put in `localStream`; `pc.close()` does not stop a sender's track and it was never
 * given to a sender; `mediaGen` guards installation, and nothing was installed. It is a
 * microphone captured for the life of the page. It is the exact shape camtrack has just
 * closed twice in `reacquireCameraForPublish` — "bail out THROUGH the stop, never around
 * it" — sitting in the AUDIO path, which is why it matters more.
 *
 * GAP 2 — the mic's level-meter AudioContext was closed by TWO of the three release
 * paths. `hangUp` and `destroy` called `teardownLocalLevelMonitor`; the backgrounded-
 * while-idle sweep, which calls `releaseLocalMedia` alone, did not — so the one release
 * written for "some path left a capture behind" was the one that left a RUNNING
 * AudioContext holding a `MediaStreamAudioSourceNode` on the microphone track, plus its
 * 400ms interval, for the rest of the session.
 *
 * HOW BIG GAP 2 IS, SAID PLAINLY RATHER THAN OVERCLAIMED: the track itself is stopped by
 * `releaseLocalMedia`, so this is not a live capture. Two costs are real. On iOS an open
 * context keeps the audio session claimed — this repo's own recorded reason for closing
 * the loudspeaker context at teardown (#160). And `ensureLocalLevelMonitor` opens with
 * `if (localLevelAnalyser) return`, so a stale analyser bound to a stopped track is never
 * replaced: the mic-level pulse is dead for every later call in that session.
 *
 * THESE ARE SOURCE PINS, and that is a limitation rather than a preference.
 * `recoverDeadLocalTrackInner` and `releaseLocalMedia` are closure-private to the engine
 * factory, which needs a DOM, a registered identity and a live signaling socket to reach;
 * nobody has driven a real `getUserMedia` failure here. What is proven is the shape of
 * the release, not that a handset's indicator goes out.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { codeOnly } from "../../../server/testing/codeOnly";

const ROOT = resolve(__dirname, "../../..");
const ENGINE = readFileSync(resolve(ROOT, "client/src/lib/relayClient.ts"), "utf8");
/** For every `not.toMatch`: this file's own prose names the things it forbids. */
const ENGINE_CODE = codeOnly(ENGINE);

/**
 * The body of a function declaration, by BRACE MATCHING.
 *
 * Not `indexOf("\n  }")`: an indent guess is the fragility CLAUDE.md records repeatedly,
 * and it silently returns a SHORT slice rather than failing, which makes every
 * `not.toMatch` inside it vacuous. The opening brace is the first one reached with
 * parentheses AND angle brackets closed — `function f(a: { x: 1 })` and
 * `function f(): Promise<{ x: 1 }>` both put a `{` before the body (the trap hit at
 * v2.105.9, v2.105.27, v2.106.4 and v2.106.48).
 */
function fnBody(src: string, decl: string): string {
  const at = src.indexOf(decl);
  expect(at, `${decl} not found`).toBeGreaterThan(-1);
  expect(src.indexOf(decl, at + 1), `${decl} occurs more than once — anchor is ambiguous`).toBe(-1);
  let i = at + decl.length;
  let paren = 0;
  let angle = 0;
  let open = -1;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === "(") paren++;
    else if (c === ")") paren--;
    else if (c === "<") angle++;
    else if (c === ">") angle--;
    else if (c === "{") {
      if (paren === 0 && angle <= 0) { open = i; break; }
      // a brace inside a parameter object / return type — skip to its match
      let d = 1;
      while (++i < src.length && d > 0) {
        if (src[i] === "{") d++;
        else if (src[i] === "}") d--;
      }
      i--;
    }
  }
  expect(open, `${decl} has no body brace`).toBeGreaterThan(-1);
  let depth = 0;
  for (let j = open; j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}") {
      depth--;
      if (depth === 0) {
        const body = src.slice(open, j + 1);
        // NON-VACUITY: a collapsed slice passes every negative assertion for free.
        expect(body.length, `${decl} body looks truncated`).toBeGreaterThan(120);
        return body;
      }
    }
  }
  throw new Error(`${decl} body never closes`);
}

/** Index of `needle` in `hay`, asserted to EXIST — `indexOf` answers -1, and -1 is less
 *  than every real offset, so an ordering comparison passes vacuously without this
 *  (the trap recorded at v2.99.78, v2.106.56 and v2.106.65). */
function at(hay: string, needle: string, label: string): number {
  const i = hay.indexOf(needle);
  expect(i, `${label} — "${needle}" is absent`).toBeGreaterThan(-1);
  return i;
}

const RECOVER = "async function recoverDeadLocalTrackInner(kind: string)";

/** The audio half of the recovery: from the branch opener to the `return` that ends it. */
function audioBranch(): string {
  const body = fnBody(ENGINE, RECOVER);
  const start = at(body, 'if (kind === "audio") {', "audio branch");
  const end = at(body, "// Video: reuse the per-path camera reacquire flows", "audio branch end");
  expect(end, "the audio branch's end anchor precedes its start").toBeGreaterThan(start);
  const seg = body.slice(start, end);
  expect(seg.length, "audio branch slice collapsed").toBeGreaterThan(500);
  return seg;
}

describe("gap 1 — a microphone the recovery opened is released on EVERY exit", () => {
  it("the acquisition is wrapped by a finally that can still see the stream", () => {
    /* THE PROPERTY: the handle survives every way out of the try. `const fresh = await …`
       INSIDE the try cannot be read from a `finally`, which is precisely why the old
       shape had to stop the stream at each exit by hand — and then missed one. */
    const seg = audioBranch();
    const declFresh = at(seg, "let fresh: MediaStream | null = null;", "hoisted stream handle");
    const declAdopted = at(seg, "let adopted = false;", "adoption flag");
    const tryAt = at(seg, "try {", "the guarded region");
    expect(declFresh, "`fresh` must be declared outside the try").toBeLessThan(tryAt);
    expect(declAdopted, "`adopted` must be declared outside the try").toBeLessThan(tryAt);
    expect(seg).toMatch(/\}\s*finally\s*\{[\s\S]{0,600}stopStream\(fresh\)/);
  });

  it("the bail-out that leaked is INSIDE the region the finally covers", () => {
    /* This is the defect itself. `if (!at) throw` fires with a LIVE microphone already
       acquired; it only stops leaking because it now sits between the acquisition and
       the adoption, so the finally releases on the way out. Moving the acquisition after
       it, or the throw before it, reopens the leak. */
    const seg = audioBranch();
    const acquire = at(seg, "await navigator.mediaDevices.getUserMedia(", "the mic acquisition");
    const bail = at(seg, 'if (!at) throw new Error("no-track");', "the no-track bail-out");
    const fin = at(seg, "} finally {", "the release");
    expect(acquire, "the acquisition must precede the bail-out").toBeLessThan(bail);
    expect(bail, "the bail-out must precede the release").toBeLessThan(fin);
    // …and the mic is opened exactly once here, so one release covers the branch.
    expect(seg.match(/navigator\.mediaDevices\.getUserMedia\(/g) ?? []).toHaveLength(1);
  });

  it("adoption flips at the ONE line that makes the track reachable, and only there", () => {
    /* THE WHOLE CORRECTNESS OF THE GUARD. `fresh` shares its track with `localStream`
       after `addTrack`, so a flag set too LATE (or never) makes the finally stop the
       microphone the recovery just installed — the opposite bug, and a worse one. Set
       too EARLY and the leak is back. A second assignment anywhere would mean two
       answers to "is this ours yet". */
    const seg = audioBranch();
    const add = at(seg, "localStream.addTrack(at);", "the install");
    const flag = at(seg, "adopted = true;", "the adoption");
    expect(add, "adoption must follow the install").toBeLessThan(flag);
    expect(seg.match(/(?<!!)\badopted = true;/g) ?? []).toHaveLength(1);
  });

  it("the release is CONDITIONAL — an adopted track must never be stopped", () => {
    /* An unconditional `stopStream(fresh)` in the finally reads as the same fix and kills
       every successful recovery: the microphone is reconnected, the toast says so, and
       the track is stopped on the way out. */
    const seg = audioBranch();
    const fin = seg.slice(at(seg, "} finally {", "the release"));
    expect(fin).toMatch(/if \(!adopted\) stopStream\(fresh\);/);
    expect(
      fin.match(/stopStream\(/g) ?? [],
      "the finally must release through exactly one, guarded, call",
    ).toHaveLength(1);
  });

  it("the video half is untouched — it installs nothing of its own", () => {
    /* Scope, pinned so a later reader does not go looking for a matching guard there:
       the video branch delegates to `reacquireCameraForPublish`, which owns its own
       acquisition and its own release. Nothing is acquired in this function for video. */
    const body = fnBody(ENGINE, RECOVER);
    const video = body.slice(at(body, "// Video: reuse the per-path camera reacquire flows", "video branch"));
    expect(video).toMatch(/await reacquireCameraForPublish\(\)/);
    expect(codeOnly(video)).not.toMatch(/getUserMedia\(/);
  });
});

describe("gap 2 — the mic's level-meter graph is released by every release path", () => {
  it("releaseLocalMedia tears the local level monitor down", () => {
    expect(fnBody(ENGINE, "function releaseLocalMedia(reason: string)")).toMatch(
      /teardownLocalLevelMonitor\(\);/,
    );
  });

  it("it does so BEFORE the tracks it reads are stopped", () => {
    const body = fnBody(ENGINE, "function releaseLocalMedia(reason: string)");
    const down = at(body, "teardownLocalLevelMonitor();", "the graph teardown");
    const stop = at(body, "localStream.getTracks().forEach(t => t.stop());", "the track stop");
    expect(down, "disconnect the graph before tearing down what it reads").toBeLessThan(stop);
  });

  it("there is exactly ONE caller, so a release path cannot be the one that forgets", () => {
    /* THE TRIPWIRE. Moving this back beside `hangUp` restores the original defect — the
       backgrounded-idle sweep does not go through `hangUp`, and that sweep exists
       precisely because something left a capture behind. One owner is what makes the
       guarantee structural rather than three remembered lines. */
    const calls = (ENGINE_CODE.match(/(?<!function )teardownLocalLevelMonitor\(\)/g) ?? []);
    expect(calls, "exactly one call site").toHaveLength(1);
    expect(fnBody(ENGINE, "function releaseLocalMedia(reason: string)")).toMatch(
      /teardownLocalLevelMonitor\(\);/,
    );
  });

  it("all three release paths reach it — which is what makes 'one caller' mean 'every path'", () => {
    /* Without this the assertion above is satisfied by a single caller that some paths
       never take. The sweep is the one that used to miss out. */
    expect(ENGINE_CODE).toMatch(/releaseLocalMedia\("hidden-while-idle"\)/);
    expect(ENGINE_CODE).toMatch(/releaseLocalMedia\("hang-up:" \+ reason\)/);
    expect(ENGINE_CODE).toMatch(/releaseLocalMedia\("engine-destroy"\)/);
  });

  it("the teardown really CLOSES the context rather than nulling the reference", () => {
    /* #160's third gap in `voiceNote.ts` was exactly this shape: nulling `ac` left an open
       context that the release path could no longer reach. A teardown that only clears
       references leaves the audio session claimed and the interval running. */
    const body = fnBody(ENGINE, "function teardownLocalLevelMonitor()");
    expect(body).toMatch(/clearInterval\(localLevelT\)/);
    expect(body).toMatch(/localLevelCtx\.close\(\)/);
    expect(body).toMatch(/localLevelAnalyser = null;/);
    expect(body).toMatch(/localLevelCtx = null;/);
  });

  it("the guard that made a stale analyser PERMANENT is still there, and is why this must be universal", () => {
    /* The pair is the property. `ensureLocalLevelMonitor` refuses to rebuild while an
       analyser exists — correct, it is what stops a second graph per call — so a release
       that does not clear it leaves the meter bound to a stopped track for the rest of the
       session. Removing THIS guard instead would rebind the meter and still leak the old
       context and its interval, so the teardown is the fix and this is the reason. */
    const body = fnBody(ENGINE, "function ensureLocalLevelMonitor()");
    expect(body).toMatch(/if \(localLevelAnalyser \|\| !localStream/);
  });

  it("the REMOTE audio teardowns deliberately stay out of releaseLocalMedia", () => {
    /* A decision, pinned so it reads as one. `teardownSpeakerMonitor` taps remote peers
       and `releaseLoudspeakerCtx` drives OUTPUT — neither is a local capture, so both
       belong to the call's teardown. Folding the loudspeaker release in here in
       particular would close it on a path that can fire with no call at all.
       On comment-stripped source: the doc comment above `releaseLocalMedia` names both
       functions in order to say they stay out, which is the prose trap this repo has
       recorded roughly twenty times. */
    const body = codeOnly(fnBody(ENGINE, "function releaseLocalMedia(reason: string)"));
    expect(body).not.toMatch(/teardownSpeakerMonitor/);
    expect(body).not.toMatch(/releaseLoudspeakerCtx/);
    // …and they are still torn down where they belong, or this is a removal, not a split.
    expect(ENGINE_CODE).toMatch(/teardownSpeakerMonitor\(\);/);
    expect(ENGINE_CODE).toMatch(/releaseLoudspeakerCtx\(\)/);
  });
});
