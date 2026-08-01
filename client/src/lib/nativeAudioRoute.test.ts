/**
 * NATIVE AUDIO ROUTING — the refusals and the direction of trust.
 *
 * Three questions decide whether this feature is safe, and none of them is
 * answerable from source:
 *
 *   1. Does a garbled event move the call onto the loudspeaker? (It must not —
 *      that is the one wrong answer with a real-world cost, somebody's private
 *      call played out loud.)
 *   2. Does a non-boolean `muted` mute the microphone? (A separate binary sends
 *      it, so its type is not ours to assume.)
 *   3. Does a plain browser take the native path at all? (If it did, every
 *      route button on the web would silently stop working.)
 *
 * So this drives the real functions against a stand-in window, the same shape
 * `nativeCallBridge.test.ts` uses and for the same reason: the suite runs in the
 * `node` environment and a listener registry is what the questions need.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  hasNativeAudioShell,
  mountNativeAudioBridge,
  normalizeNativeRoute,
  parseNativeAudioEvent,
  requestNativeAudioRoute,
  ROUTE_TO_WIRE,
  wireToEngineRoute,
  type NativeAudioEvent,
} from "./nativeAudioRoute";

type Listener = (ev: unknown) => void;
interface Harness {
  fire: (detail: unknown) => void;
  sent: string[];
}
function installWindow(withShell: boolean): Harness {
  const listeners = new Map<string, Set<Listener>>();
  const sent: string[] = [];
  const w: Record<string, unknown> = {
    addEventListener(t: string, fn: Listener) {
      if (!listeners.has(t)) listeners.set(t, new Set());
      listeners.get(t)!.add(fn);
    },
    removeEventListener(t: string, fn: Listener) {
      listeners.get(t)?.delete(fn);
    },
  };
  if (withShell) w.RelayNative = { postMessage: (s: string) => sent.push(s) };
  (globalThis as unknown as { window?: unknown }).window = w;
  return {
    sent,
    fire: (detail: unknown) => {
      listeners.get("relay:native")?.forEach(fn => fn({ type: "relay:native", detail }));
    },
  };
}
afterEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window;
});

describe("the wire vocabulary", () => {
  it("uses the spec's exact route names", () => {
    // These strings are a contract with a binary we do not build and cannot
    // deploy in step with. A rename here is a silently broken shell.
    expect(ROUTE_TO_WIRE.loud).toBe("speaker");
    expect(ROUTE_TO_WIRE.ear).toBe("earpiece");
    expect(ROUTE_TO_WIRE.bt).toBe("bluetooth");
  });

  it("round-trips every route through BOTH directions of the one table", () => {
    // The property that matters is not either mapping in isolation — it is that
    // the request and the confirmation agree. Two hand-written tables is how you
    // tap Bluetooth, the shell confirms "bluetooth", and nothing lights up.
    for (const engine of Object.keys(ROUTE_TO_WIRE) as (keyof typeof ROUTE_TO_WIRE)[]) {
      expect(wireToEngineRoute(ROUTE_TO_WIRE[engine])).toBe(engine);
    }
  });

  it("covers every route the menu can offer, with no extras", () => {
    // A fourth engine id with no wire name would send `undefined` to the shell.
    expect(Object.keys(ROUTE_TO_WIRE).sort()).toEqual(["bt", "ear", "loud"]);
  });
});

describe("normalizeNativeRoute — fails CLOSED", () => {
  it("accepts exactly the three spec names", () => {
    expect(normalizeNativeRoute("speaker")).toBe("speaker");
    expect(normalizeNativeRoute("earpiece")).toBe("earpiece");
    expect(normalizeNativeRoute("bluetooth")).toBe("bluetooth");
  });

  it("refuses anything else rather than defaulting", () => {
    // "speaker" is the harmful default specifically: a garbled event must never
    // put a call somebody is holding to their ear onto the loudspeaker.
    for (const bad of [
      "SPEAKER", " speaker", "speakerphone", "loud", "ear", "bt",
      "", null, undefined, 0, 1, {}, [], true,
    ]) {
      expect(normalizeNativeRoute(bad), String(bad)).toBeNull();
    }
  });
});

describe("parseNativeAudioEvent", () => {
  it("accepts a well-formed route change", () => {
    expect(parseNativeAudioEvent({ type: "audioRouteChanged", route: "bluetooth" }))
      .toEqual({ type: "audioRouteChanged", route: "bluetooth" });
  });

  it("drops a route change carrying an unknown route", () => {
    expect(parseNativeAudioEvent({ type: "audioRouteChanged", route: "speakerphone" })).toBeNull();
    expect(parseNativeAudioEvent({ type: "audioRouteChanged" })).toBeNull();
  });

  it("accepts callMuted in BOTH boolean states", () => {
    expect(parseNativeAudioEvent({ type: "callMuted", muted: true }))
      .toEqual({ type: "callMuted", muted: true });
    expect(parseNativeAudioEvent({ type: "callMuted", muted: false }))
      .toEqual({ type: "callMuted", muted: false });
  });

  it("refuses a non-boolean `muted` instead of coercing it", () => {
    // The string "false" is truthy. Coercing it would mute somebody's microphone
    // mid-sentence on an event that was trying to say the opposite.
    for (const bad of ["true", "false", 1, 0, "", null, undefined, {}]) {
      expect(parseNativeAudioEvent({ type: "callMuted", muted: bad }), String(bad)).toBeNull();
    }
  });

  it("ignores every other shape, including the call bridge's own events", () => {
    // The two bridges share a channel. Each must ignore the other's traffic
    // rather than half-matching it.
    for (const bad of [
      { type: "callAnswered", callId: "r1" },
      { type: "SET_PUSH_TOKEN", token: "x" },
      { type: "audioRoute", route: "speaker" },
      "audioRouteChanged", null, undefined, 42, [],
    ]) {
      expect(parseNativeAudioEvent(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe("hasNativeAudioShell", () => {
  it("is false with no window at all", () => {
    expect(hasNativeAudioShell()).toBe(false);
  });

  it("is false in a plain browser", () => {
    installWindow(false);
    expect(hasNativeAudioShell()).toBe(false);
  });

  it("is true only when postMessage is actually callable", () => {
    installWindow(true);
    expect(hasNativeAudioShell()).toBe(true);
    // An object that merely EXISTS is not a shell — a half-injected bridge would
    // otherwise swallow every tap into nothing.
    (globalThis as unknown as { window: Record<string, unknown> }).window.RelayNative = {};
    expect(hasNativeAudioShell()).toBe(false);
  });
});

describe("requestNativeAudioRoute — web → native", () => {
  it("sends BOTH envelopes the shell actually listens for", () => {
    // Verified against the shell's own source, not the spec — which names only
    // the first. iOS (`with-ios-voip-callkit.js`) switches on `setAudioRoute`;
    // Android (`components/relay-webview.tsx` + `lib/call-messages.ts`) switches
    // on `audio-route`. Sending one name only means every tap on the other
    // platform reaches an inert default and does nothing, silently.
    const h = installWindow(true);
    expect(requestNativeAudioRoute("speaker")).toBe(true);
    expect(h.sent).toHaveLength(2);
    expect(h.sent.map(s => JSON.parse(s))).toEqual([
      { type: "setAudioRoute", route: "speaker" },
      { type: "audio-route", route: "speaker" },
    ]);
  });

  it("carries the same route in both, so the two shells cannot disagree", () => {
    const h = installWindow(true);
    requestNativeAudioRoute("bluetooth");
    const routes = new Set(h.sent.map(s => JSON.parse(s).route));
    expect([...routes]).toEqual(["bluetooth"]);
  });

  it("sends nothing, and reports so, in a plain browser", () => {
    const h = installWindow(false);
    expect(requestNativeAudioRoute("earpiece")).toBe(false);
    expect(h.sent).toHaveLength(0);
  });

  it("never throws when the shell refuses", () => {
    installWindow(true);
    (globalThis as unknown as { window: Record<string, unknown> }).window.RelayNative = {
      postMessage: () => { throw new Error("bridge is gone"); },
    };
    // This runs from a button handler inside a live call.
    expect(() => requestNativeAudioRoute("bluetooth")).not.toThrow();
    expect(requestNativeAudioRoute("bluetooth")).toBe(false);
  });

  it("one envelope throwing does not cost the other its delivery", () => {
    // The two names go to two different platforms' handlers; a shell that
    // refuses one must not be able to suppress the one it does understand.
    const sent: string[] = [];
    installWindow(true);
    let n = 0;
    (globalThis as unknown as { window: Record<string, unknown> }).window.RelayNative = {
      postMessage: (s: string) => {
        if (n++ === 0) throw new Error("first name refused");
        sent.push(s);
      },
    };
    expect(requestNativeAudioRoute("earpiece")).toBe(true);
    expect(sent.map(s => JSON.parse(s).type)).toEqual(["audio-route"]);
  });

  it("never throws with no window", () => {
    expect(() => requestNativeAudioRoute("speaker")).not.toThrow();
    expect(requestNativeAudioRoute("speaker")).toBe(false);
  });
});

describe("mountNativeAudioBridge", () => {
  it("delivers valid events and swallows the rest", () => {
    const h = installWindow(true);
    const seen: NativeAudioEvent[] = [];
    mountNativeAudioBridge(e => seen.push(e));
    h.fire({ type: "audioRouteChanged", route: "speaker" });
    h.fire({ type: "audioRouteChanged", route: "nonsense" });
    h.fire({ type: "callMuted", muted: true });
    h.fire({ type: "callMuted", muted: "true" });
    h.fire(null);
    expect(seen).toEqual([
      { type: "audioRouteChanged", route: "speaker" },
      { type: "callMuted", muted: true },
    ]);
  });

  it("does NOT dedupe — a repeated route is a real event", () => {
    // The call bridge dedupes per (type, callId) so a foreground re-post cannot
    // answer twice. Route events legitimately repeat: a headset connecting,
    // dropping and reconnecting sends bluetooth → earpiece → bluetooth, and
    // swallowing the third would strand the button on the wrong route.
    const h = installWindow(true);
    const seen: NativeAudioEvent[] = [];
    mountNativeAudioBridge(e => seen.push(e));
    h.fire({ type: "audioRouteChanged", route: "bluetooth" });
    h.fire({ type: "audioRouteChanged", route: "earpiece" });
    h.fire({ type: "audioRouteChanged", route: "bluetooth" });
    expect(seen.map(e => (e as { route: string }).route))
      .toEqual(["bluetooth", "earpiece", "bluetooth"]);
  });

  it("teardown really detaches", () => {
    const h = installWindow(true);
    const onEvent = vi.fn();
    const off = mountNativeAudioBridge(onEvent);
    h.fire({ type: "callMuted", muted: true });
    expect(onEvent).toHaveBeenCalledTimes(1);
    off();
    h.fire({ type: "callMuted", muted: false });
    expect(onEvent).toHaveBeenCalledTimes(1);
  });

  it("is an inert no-op with no window", () => {
    expect(() => mountNativeAudioBridge(() => {})()).not.toThrow();
  });
});

/**
 * ENGINE WIRING.
 *
 * Source pins, and honestly so: `relayClient.ts` is a ~7000-line closure that
 * needs a DOM, a signaling transport and getUserMedia to instantiate. What these
 * hold is the three decisions that make the module above load-bearing rather
 * than dead code.
 */
describe("relayClient wiring", () => {
  const ROOT = path.resolve(__dirname, "../../..");
  const CLIENT = fs.readFileSync(path.join(ROOT, "client/src/lib/relayClient.ts"), "utf8");

  it("a tap in a shell ASKS and returns, before every web mechanism", () => {
    const body = CLIENT.slice(CLIENT.indexOf("async function setMobileRoute("));
    expect(body.length).toBeGreaterThan(200);
    const shell = body.indexOf("hasNativeAudioShell()");
    const request = body.indexOf("requestNativeAudioRoute(");
    const webForce = body.indexOf("loudspeakerEnable()");
    const nativeSpeaker = body.indexOf("nativeSetSpeaker(");
    expect(shell).toBeGreaterThan(-1);
    expect(request).toBeGreaterThan(shell);
    expect(request, "the request precedes the WebAudio force").toBeLessThan(webForce);
    expect(request, "the request precedes the Capacitor speaker call").toBeLessThan(nativeSpeaker);
    // THE RETURN IS THE PROPERTY, not the ordering. Position alone is satisfied
    // by a branch that asks the shell and THEN runs the WebAudio force anyway —
    // which is precisely the fight this design exists to prevent, and which
    // survived a first draft of this test that only compared indices.
    expect(
      body.slice(request, webForce),
      "the shell branch returns before any web mechanism can run",
    ).toMatch(/requestNativeAudioRoute\([^)]*\);\s*\n\s*return;/);
  });

  it("the confirmed route is written ONLY from the shell's answer", () => {
    // If a tap wrote it, the highlighted button would be a hope rather than a
    // report — the exact thing this design refuses.
    //
    // Matched per LINE, deliberately. Three drafts of this failed on CORRECT
    // source trying to do it with one file-wide pattern: the `let` declaration
    // matched, then the `=== "loud"` comparison matched, and then the optional
    // type-annotation branch ran `[^=]+` clean across a ternary and swallowed an
    // unrelated statement. An assignment to a plain local is a line that STARTS
    // with it, which is both exact and unable to span lines.
    const assignments = CLIENT.split("\n").filter(l => /^\s*nativeRoute\s*=[^=]/.test(l));
    expect(assignments, "exactly one writer, and it is not a tap").toHaveLength(1);
    expect(CLIENT).toMatch(/audioRouteChanged"[\s\S]{0,200}nativeRoute = wireToEngineRoute\(e\.route\)/);
  });

  it("a shell mute sets the mic STATE and never toggles it", () => {
    expect(CLIENT).toMatch(/setMic\(!e\.muted\)/);
    // A toggle would unmute on a second "muted: true" — the shells re-post on
    // foreground, so that is a real sequence, not a hypothetical one.
    expect(CLIENT).not.toMatch(/e\.muted[\s\S]{0,40}toggleMic\(\)/);
  });

  it("the listener is torn down with the engine", () => {
    // It sits on `window`, which outlives the engine.
    expect(CLIENT).toMatch(/unmountNativeAudio\(\)/);
  });
});
