import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SRC = readFileSync(resolve(__dirname, "..", "lib/injected-scripts.ts"), "utf8");

/**
 * Two call-path defects in the JavaScript the shell injects into the RELAY page.
 *
 * These are source pins by necessity: the code is a string injected into a
 * WebView and driven by live WebRTC state, so there is no way to execute it
 * meaningfully under vitest with no device. The properties pinned are the ones
 * whose loss reproduces the bug.
 */

describe("the shell never re-enables a LOCAL audio track", () => {
  /* The web app mutes by setting `enabled = false` on the local mic track. The
   * shell ran a 2-second interval that re-enabled every disabled local audio
   * track, so mute lasted at most two seconds — while the button kept rendering
   * as muted. The user believed they were muted and was not.
   *
   * The shell cannot distinguish "accidentally disabled" from "the user pressed
   * mute": they are the same one bit. So there is no safe version to keep. */

  it("the health monitor and its interval are gone", () => {
    expect(SRC).not.toContain("ensureAudioTracksEnabled");
    expect(SRC).not.toMatch(/setInterval\([^)]*\n?[^)]*ensureAudioTracks/);
  });

  it("no 'mute' event handler re-enables a track", () => {
    expect(SRC).not.toMatch(/addEventListener\('mute'/);
  });

  it("a freshly acquired stream is not force-enabled either", () => {
    const gum = SRC.slice(SRC.indexOf("return origGUM(c).then"), SRC.indexOf("window.__relayReacquireCamera"));
    expect(gum).not.toMatch(/getAudioTracks\(\)\.forEach\(function \(t\) \{\s*\n\s*t\.enabled = true;/);
  });

  it("camera reacquire restores the PRIOR enabled value, not true", () => {
    // Otherwise kicking a frozen preview turns a camera back on that the user
    // had deliberately switched off.
    const at = SRC.indexOf("window.__relayReacquireCamera = function");
    expect(at, "the reacquire function exists").toBeGreaterThan(-1);
    const fn = SRC.slice(at, at + 900);
    expect(fn).toMatch(/var was = t\.enabled;/);
    expect(fn).toMatch(/t\.enabled = was;/);
    expect(fn).not.toMatch(/setTimeout\(function \(\) \{ t\.enabled = true; \}/);
  });

  it("enabling a REMOTE track is still allowed (that is incoming audio)", () => {
    // The local mute button does not control the other party's audio, so this
    // one is unrelated and must not be swept away with the rest.
    expect(SRC).toMatch(/if \(ev\.track && ev\.track\.kind === 'audio'\) \{\s*\n\s*ev\.track\.enabled = true;/);
  });
});

describe("a transient ICE drop does not end the call", () => {
  /* `recompute()` runs the irreversible teardown — track.stop() on every local
   * track, plus reporting the call ended to CallKit / the Android call service.
   * Treating 'disconnected' as terminal meant a two-second tunnel killed the
   * microphone and camera for the REST of the call, and nothing re-added the
   * connection when ICE recovered. */

  const cleanup = SRC.slice(SRC.indexOf("var deadT = null;"), SRC.indexOf("var origClose ="));

  it("only a CLOSED connection tears down immediately", () => {
    expect(cleanup).toMatch(/if \(cs === 'closed' \|\| pc\.iceConnectionState === 'closed'\) \{\s*\n\s*finish\(\);/);
  });

  it("disconnected and failed are debounced, not immediate", () => {
    expect(cleanup).toMatch(/if \(cs === 'failed' \|\| cs === 'disconnected'\)/);
    expect(cleanup).toMatch(/deadT = setTimeout\(/);
    // …and the delay is long enough to cover a real handoff.
    const ms = Number(/\}, (\d+)\);/.exec(cleanup)?.[1]);
    expect(ms).toBeGreaterThanOrEqual(10000);
  });

  it("recovery cancels the pending teardown", () => {
    expect(cleanup).toMatch(/if \(cs === 'connected' \|\| cs === 'completed'\) \{\s*\n[^}]*clearDead\(\);/);
    // and the timer re-checks state before acting, in case it recovered late
    expect(cleanup).toMatch(/if \(now !== 'connected' && now !== 'completed'\) finish\(\);/);
  });

  it("an explicit close() cancels the timer too", () => {
    expect(SRC).toMatch(/pc\.close = function \(\) \{ clearDead\(\);/);
  });
});

/* NOT TESTED HERE, deliberately: that no stray backtick appears inside the
 * injected JS. This file holds that JS in TypeScript template literals, so a
 * backtick in the body — even inside a comment — terminates the string. It is a
 * real trap (CLAUDE.md records the same thing biting the CSS template, and it
 * bit twice while writing these fixes). But `pnpm check` fails the build on an
 * unterminated template, immediately and by exact line, and any heuristic here
 * would be strictly weaker than that. Counting backticks, for instance, passes
 * happily when a comment adds two. */

describe("an incoming-call ring cannot be raised by page text", () => {
  /* Ring detection matched "<name> is calling you" anywhere in body innerText,
   * gated on "are there accept-like buttons on the page". RELAY's ring card is
   * PERMANENTLY MOUNTED, so that gate was always true — meaning any chat message,
   * status or contact name containing the phrase raised a MAX-importance,
   * DND-bypassing, sticky notification with a looping ringtone, on demand, from
   * anyone who could send the victim text.
   *
   * It could not simply be deleted: none of the strong selectors the code looked
   * for (`[data-incoming-call]`, `.incoming-call-overlay`, …) exist anywhere in
   * the web app, so the text path was the ONLY thing that worked. The fix was to
   * find the state the web app actually uses — `#ringOverlay.active`, added by
   * relayClient on ring and removed on accept/decline/cancel/hangup — and key off
   * that instead. */

  it("the ring verdict is the DOM state alone", () => {
    expect(SRC).toMatch(/var ringing = hasCallModal;/);
  });

  it("the text heuristic and its always-true gate are gone", () => {
    expect(SRC).not.toContain("hasRingingText");
    expect(SRC).not.toContain("hasActionButtons");
    expect(SRC).not.toMatch(/is calling\\\.\{0,3\}\$/);
  });

  it("it keys off the web app's real ring overlay", () => {
    expect(SRC).toMatch(/#ringOverlay\.active/);
  });

  it("the caller name is read from the ring card, not scraped from the body", () => {
    expect(SRC).toMatch(/#ringOverlay\.active #ringWho/);
  });
});

describe("the call-end signal names the call it is ending", () => {
  /* Both end-of-call notifications sent `callId: ''` (or no field), and every
   * consumer rejects or misroutes an empty id — so a CallKit call answered from a
   * VoIP push was never reported as ended, and it then blocked later calls. */

  it("no emitter hardcodes an empty callId", () => {
    expect(SRC).not.toMatch(/type: 'webCallEnded', callId: ''/);
    expect(SRC).not.toMatch(/JSON\.stringify\(\{ type: 'callEnded' \}\)/);
  });

  it("all three emitters carry the tracked id", () => {
    const hits = SRC.match(/window\.__relayNativeCallId \|\| ''/g) || [];
    expect(hits.length).toBeGreaterThanOrEqual(3);
  });

  it("the id is captured when the native side answers, and cleared when it ends", () => {
    // Otherwise the tracked value is always empty and nothing changes.
    expect(SRC).toMatch(/d\.type === 'callAnswered'[\s\S]{0,120}__relayNativeCallId = String\(d\.callId\)/);
    expect(SRC).toMatch(/d\.type === 'callDeclined' \|\| d\.type === 'callEnded'[\s\S]{0,80}__relayNativeCallId = null/);
  });

  it("still falls back to '' so the native endAllCalls path can fire", () => {
    expect(SRC).toMatch(/__relayNativeCallId \|\| ''/);
  });
});

describe("iOS calls stay out of the system Phone history", () => {
  const IOS = readFileSync(resolve(__dirname, "..", "plugins/with-ios-voip-callkit.js"), "utf8");

  it("includesCallsInRecents is disabled in both configs", () => {
    // Defaults to true, and the caller string comes verbatim from the VoIP push —
    // so every call, spoofed or not, was written into the stock Recents list where
    // it is indistinguishable from a real phone call.
    expect(IOS).toMatch(/config\.includesCallsInRecents = false/);
    expect(IOS).toMatch(/"includesCallsInRecents": false/);
  });
});
