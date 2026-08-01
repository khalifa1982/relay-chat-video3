import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { codeOnly } from "../../../server/testing/codeOnly";

/**
 * v2.106.88 — MUTE SURVIVES A MICROPHONE REACQUISITION.
 *
 * From the owner's `relaycallqualityfixes.md`, four client-side call fixes. Each was
 * checked against THIS source before anything was changed, and the honest result is
 * one real bug and three refutations — recorded here so nobody re-raises them.
 *
 * ── FIX 1: "mute disables a cached stream reference, not the sender's track" ──────
 * THE STATED MECHANISM IS NOT PRESENT. Audio track object IDENTITY is preserved
 * across every `replaceTrack` in this file: `replaceVideoEverywhere` is video-only,
 * the camera flip rebuilds the stream from the SAME `audioTracks` array, and
 * `recoverDeadLocalTrack` puts its fresh track into `localStream` before handing it to
 * the senders. `outAudioTrack()` reads `localStream` first. So disabling
 * `localStream`'s audio track disables the one the senders hold — they are one object.
 *
 * THE SYMPTOM WAS REAL ANYWAY, BY A DIFFERENT ROUTE, and looking for it rather than
 * for the stated cause is what found it: `ensureMedia`'s "cached media is dead —
 * reacquiring fresh" branch installs a WHOLLY NEW stream, and a fresh `getUserMedia`
 * track defaults to `enabled = true`. Somebody muted when that ran came back UNMUTED
 * with the mic button still showing "off", because nothing touches it. The app said
 * muted and the microphone was live.
 *
 * The camera has had a guard for exactly this for releases — `syncCamEnabled`, whose
 * own comment reads "a fresh track defaults to enabled, which would otherwise turn the
 * camera back ON" — and audio never got the mirror. The only place `micOn` was
 * re-applied to a new track was the dead-track recovery, which covers the `onended`
 * route and not this one.
 *
 * ── FIX 2: "remote audio plays twice — element AND the visualizer's graph" ────────
 * REFUTED, and pinned below so it stays refuted. Both analysers are sinks: the mesh
 * speaker monitor and the local level meter each `connect(analyser)` and NOTHING to
 * `destination`, with comments saying so. The one `connect(destination)` on a remote
 * stream is the deliberate loudspeaker force, and it mutes the element only AFTER the
 * Web-Audio path is wired — so there is exactly one playback path at a time, and a
 * failed tap leaves the element audible rather than silent. The self tile is `muted`.
 *
 * ── FIX 3: "route via RelayNative.postMessage, follow the shell's ack" ────────────
 * ALREADY SHIPPED (v2.106.76), including the detail the doc does not mention: the two
 * shells disagree about the envelope name, so the web posts BOTH.
 *
 * ── FIX 4: "equal grid, object-fit cover never fill" ──────────────────────────────
 * ALREADY TRUE. Tiles are `object-fit: cover`; `contain` appears only for a shared
 * SCREEN, where cropping would cut off what is being shown. The columns are derived
 * from the live participant count, not a hero-plus-strip.
 */
const ROOT = path.resolve(__dirname, "../../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const CLIENT = codeOnly(read("client/src/lib/relayClient.ts"));
const CSS = read("client/src/lib/relayAssets.ts");

function fnBody(name: string): string {
  const at = CLIENT.indexOf(`function ${name}(`);
  expect(at, `${name} must exist`).toBeGreaterThan(-1);
  const open = CLIENT.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < CLIENT.length; i++) {
    if (CLIENT[i] === "{") depth++;
    else if (CLIENT[i] === "}" && --depth === 0) return CLIENT.slice(open, i + 1);
  }
  throw new Error(`${name} body not closed`);
}

describe("v2.106.88 — a reacquired microphone comes back MUTED if you were muted", () => {
  it("there is an audio mirror of syncCamEnabled", () => {
    /* THE FIX. Without it a fresh track arrives enabled and the person is live while
       their own screen says otherwise. */
    expect(CLIENT).toMatch(/function syncMicEnabled\(\)/);
    const body = fnBody("syncMicEnabled");
    expect(body).toMatch(/getAudioTracks\(\)\.forEach\(t => \(t\.enabled = micOn\)\)/);
  });

  it("it WRITES to both streams, for the same reason syncCamEnabled does", () => {
    /* With a filter active the published stream is the canvas output, and the recovery
       path adds the live mic to BOTH — so disabling one leaves a live copy on whichever
       the senders happen to hold.
     *
     * ASSERTED AS THE TWO WRITES, NOT AS THE NAMES AROUND THEM (found by mutation):
     * the first version matched `outStream()` and `processedStream && localStream` as
     * text, and both SURVIVED having their `forEach` gutted — the function would have
     * kept its shape and its comment while disabling nothing. Pinning that a name
     * appears says nothing about what is done with it. */
    const body = fnBody("syncMicEnabled");
    expect(body).toMatch(/outStream\(\)\s*\.?[\s\S]{0,40}getAudioTracks\(\)\.forEach\(t => \(t\.enabled = micOn\)\)/);
    expect(body).toMatch(
      /processedStream && localStream[\s\S]{0,80}localStream\.getAudioTracks\(\)\.forEach\(t => \(t\.enabled = micOn\)\)/,
    );
    // Exactly two writes: one per stream, neither dropped.
    expect(body.match(/getAudioTracks\(\)\.forEach/g) ?? []).toHaveLength(2);
  });

  it("the acquisition applies it at its final exit, so every path that ACQUIRES inherits it", () => {
    /* In `ensureMediaInner` — `ensureMedia` itself is the thin wrapper that dedupes
       concurrent callers onto one in-flight promise, and asserting against it would be
       reading the wrong function (this test did, and said so by failing).
     *
     * At the exit rather than beside each `localStream =` assignment, so a path added
     * later gets the guarantee instead of having to remember it. The one path that
     * does NOT pass through here is the cached-and-alive early return, which needs
     * nothing: it hands back the SAME audio track object, whose `enabled` already
     * carries the mute. Stated rather than glossed, because "every path" would be
     * an overclaim. */
    const body = fnBody("ensureMediaInner");
    expect(body).toMatch(/syncMicEnabled\(\);/);
    const sync = body.indexOf("syncMicEnabled()");
    const ret = body.lastIndexOf("return outStream()");
    expect(sync).toBeGreaterThan(0);
    expect(ret).toBeGreaterThan(0);
    expect(sync).toBeLessThan(ret);
    // …and it is AFTER the fresh install, or it would apply to the stream being replaced.
    expect(body.indexOf("localStream = raw")).toBeLessThan(sync);
  });

  it("setMic goes through the SAME helper — one implementation, not two", () => {
    /* Two would be two chances for the button and the wire to disagree, and the
       direction that disagreement fails is somebody being heard while muted. */
    const body = fnBody("setMic");
    expect(body).toMatch(/syncMicEnabled\(\)/);
    expect(body).not.toMatch(/getAudioTracks\(\)\.forEach/);
  });

  it("the dead-track recovery still applies micOn to the track it acquires", () => {
    /* The pre-existing guard for the OTHER route. This release adds a second path to
       the same guarantee; it must not have replaced the one that was already right. */
    expect(CLIENT).toMatch(/at\.enabled = micOn;/);
  });
});

describe("v2.106.88 — the three refutations, pinned so they stay true", () => {
  it("no analyser is ever connected to the destination", () => {
    /* Fix 2's mechanism. An analyser wired to `destination` would play the remote
       stream a second time on top of the element — the doubling the doc describes. */
    for (const name of ["registerMeshAnalyser", "ensureLocalLevelMonitor"]) {
      const body = fnBody(name);
      expect(body, `${name} must tap only`).toMatch(/createAnalyser\(\)/);
      expect(body, `${name} must not reach the destination`).not.toMatch(/connect\([^)]*destination/);
    }
  });

  it("the loudspeaker route mutes the element only AFTER its own path is wired", () => {
    /* This is the one deliberate second playback path, and the ordering is what keeps
       it from being either a doubling or a silence: wire, then mute; a failed tap
       leaves the element audible on the earpiece. */
    const body = fnBody("routeElToLoudspeaker");
    const wired = body.indexOf("src.connect(loudspeakerCtx.destination)");
    const muted = body.indexOf("el.muted = true");
    expect(wired).toBeGreaterThan(0);
    expect(muted).toBeGreaterThan(0);
    expect(wired).toBeLessThan(muted);
  });

  it("the self tile is muted, so a local preview can never feed back", () => {
    expect(fnBody("addSelfTile")).toMatch(/v\.muted = true/);
  });

  it("call tiles COVER, and only a shared screen may letterbox", () => {
    /* Fix 4. `cover` on a person's tile and `contain` on a screen is the correct pair —
       cropping a shared screen would cut off what is being shown. `fill` distorts and
       must appear on neither. */
    expect(CSS).toMatch(/\.relay-tile video\{[^}]*object-fit:cover/);
    expect(CSS).toMatch(/\.relay-tile\.screen video\{[^}]*object-fit:contain/);
    expect(CSS).not.toMatch(/object-fit:fill/);
  });
});
