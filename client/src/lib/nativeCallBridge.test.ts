/**
 * THE NATIVE CALL BRIDGE — what it refuses is the whole value.
 *
 * The push spec's web-client half: Answer/Decline taps on the OS call screen have
 * to reach the engine, a cold start has to carry the intent in the URL, and a
 * web-side hang-up has to dismiss the OS screen.
 *
 * Every assertion here is behavioural, because "does a stray query param answer a
 * call" and "does a stale arm open the microphone later" are exactly the questions
 * a source pin cannot answer.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  mountNativeCallBridge,
  NATIVE_ANSWER_TTL_MS,
  nativeAnswerMatches,
  normalizeCallId,
  notifyNativeCallEnded,
  parseNativeCallEvent,
  parseNativeCallIntent,
} from "./nativeCallBridge";

/**
 * A MINIMAL WINDOW, because the suite runs in the `node` environment.
 *
 * The sibling `nativeTokenBridge.test.ts` sidesteps this by testing only pure
 * functions — but the whole point of `mountNativeCallBridge` is WHICH events it
 * acts on and whether teardown really detaches, and neither is answerable without
 * a listener registry. So this stands one up rather than asserting on source.
 */
type Listener = (ev: unknown) => void;
function installWindow(): { fire: (detail: unknown) => void } {
  const listeners = new Map<string, Set<Listener>>();
  const w = {
    addEventListener(t: string, fn: Listener) {
      if (!listeners.has(t)) listeners.set(t, new Set());
      listeners.get(t)!.add(fn);
    },
    removeEventListener(t: string, fn: Listener) {
      listeners.get(t)?.delete(fn);
    },
  };
  (globalThis as unknown as { window?: unknown }).window = w;
  return {
    fire: (detail: unknown) => {
      listeners.get("relay:native")?.forEach(fn => fn({ type: "relay:native", detail }));
    },
  };
}
afterEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window;
});

describe("the cold-start URL intent", () => {
  it("reads the spec's shape", () => {
    expect(parseNativeCallIntent("?nativeCall=room-42&mode=video&action=answer")).toEqual({
      callId: "room-42",
      mode: "video",
      action: "answer",
    });
    // Leading `?` optional — a caller may hand us either form.
    expect(parseNativeCallIntent("nativeCall=r1&action=decline")?.action).toBe("decline");
  });

  it("defaults the mode to VOICE, never video", () => {
    /* Getting this wrong toward video opens a camera the caller never asked for —
       the mutual-consent rule (v2.81). Defaulting to voice merely under-promises,
       and the camera is one tap away. */
    expect(parseNativeCallIntent("?nativeCall=r&action=answer")?.mode).toBe("voice");
    expect(parseNativeCallIntent("?nativeCall=r&mode=&action=answer")?.mode).toBe("voice");
    expect(parseNativeCallIntent("?nativeCall=r&mode=VIDEO&action=answer")?.mode).toBe("voice");
  });

  it("REFUSES an unrecognised action rather than defaulting it to answer", () => {
    /* A half-formed URL must not join a call. This is the one place strictness is
       obviously right. */
    expect(parseNativeCallIntent("?nativeCall=r")).toBeNull();
    expect(parseNativeCallIntent("?nativeCall=r&action=")).toBeNull();
    expect(parseNativeCallIntent("?nativeCall=r&action=ANSWER")).toBeNull();
    expect(parseNativeCallIntent("?nativeCall=r&action=join")).toBeNull();
  });

  it("is null for every URL that names no call", () => {
    for (const q of ["", "?", "?to=555555", "?nativeCall=&action=answer", "?action=answer"]) {
      expect(parseNativeCallIntent(q), q).toBeNull();
    }
  });

  it("refuses a call id that is not a call id", () => {
    expect(normalizeCallId("room-42")).toBe("room-42");
    expect(normalizeCallId("pl-777777")).toBe("pl-777777");
    for (const bad of ["", " ", "a b", "a/b", "<script>", "a".repeat(129), 42, null, undefined]) {
      expect(normalizeCallId(bad as unknown), String(bad)).toBeNull();
    }
  });
});

describe("the in-page event", () => {
  it("accepts the three shapes the spec names", () => {
    expect(parseNativeCallEvent({ type: "callAnswered", callId: "r1", mode: "video" })).toEqual({
      type: "callAnswered",
      callId: "r1",
      mode: "video",
    });
    expect(parseNativeCallEvent({ type: "callDeclined", callId: "r1" })).toEqual({
      type: "callDeclined",
      callId: "r1",
    });
    expect(parseNativeCallEvent({ type: "callEndedNative", callId: "r1" })).toEqual({
      type: "callEndedNative",
      callId: "r1",
    });
  });

  it("ignores anything else silently", () => {
    /* Unrelated libraries dispatch into pages constantly; a noisy console is its
       own bug. */
    for (const d of [
      null,
      "callAnswered",
      { type: "callAnswered" }, // no id
      { type: "pushToken", token: "x" }, // the OTHER bridge's message
      { callId: "r1" }, // no type
      { type: "somethingElse", callId: "r1" },
    ]) {
      expect(parseNativeCallEvent(d), JSON.stringify(d)).toBeNull();
    }
  });
});

describe("the mounted listener", () => {
  it("delivers a call event and DEDUPES it", () => {
    /* The shells re-post on foreground; answering the same call twice would run the
       join path against a room we are already in. */
    const { fire } = installWindow();
    const seen: string[] = [];
    const off = mountNativeCallBridge(e => seen.push(`${e.type}:${e.callId}`));
    fire({ type: "callAnswered", callId: "r1", mode: "video" });
    fire({ type: "callAnswered", callId: "r1", mode: "video" });
    fire({ type: "callDeclined", callId: "r1" }); // different type, same call — distinct
    fire({ type: "callAnswered", callId: "r2", mode: "voice" });
    off();
    fire({ type: "callAnswered", callId: "r3", mode: "voice" }); // after teardown
    expect(seen).toEqual(["callAnswered:r1", "callDeclined:r1", "callAnswered:r2"]);
  });

  it("ignores a token message on the same channel", () => {
    const { fire } = installWindow();
    const seen: unknown[] = [];
    const off = mountNativeCallBridge(e => seen.push(e));
    fire({ type: "pushToken", kind: "apns-voip", token: "a".repeat(64) });
    off();
    expect(seen).toEqual([]);
  });
});

describe("web → native", () => {
  it("posts the spec's message when a shell is present", () => {
    installWindow();
    const post = vi.fn();
    (globalThis as unknown as { window: { RelayNative?: unknown } }).window.RelayNative = {
      postMessage: post,
    };
    try {
      notifyNativeCallEnded("room-42");
      expect(post).toHaveBeenCalledTimes(1);
      expect(JSON.parse(post.mock.calls[0][0] as string)).toEqual({
        type: "webCallEnded",
        callId: "room-42",
      });
    } finally {
      /* afterEach removes the whole stub window */
    }
  });

  it("degrades SILENTLY in a plain browser — this runs on every hang-up", () => {
    installWindow(); // a window, but no RelayNative on it
    expect(() => notifyNativeCallEnded("room-42")).not.toThrow();
  });

  it("degrades silently with NO window at all (SSR / the node suite itself)", () => {
    expect(() => notifyNativeCallEnded("room-42")).not.toThrow();
  });

  it("survives a shell whose postMessage throws", () => {
    installWindow();
    (globalThis as unknown as { window: { RelayNative?: unknown } }).window.RelayNative = {
      postMessage: () => {
        throw new Error("bridge closed");
      },
    };
    expect(() => notifyNativeCallEnded("room-42")).not.toThrow();
  });

  it("sends nothing for a malformed call id", () => {
    installWindow();
    const post = vi.fn();
    (globalThis as unknown as { window: { RelayNative?: unknown } }).window.RelayNative = {
      postMessage: post,
    };
    notifyNativeCallEnded("");
    notifyNativeCallEnded("a b");
    expect(post).not.toHaveBeenCalled();
  });
});

/**
 * THE ARMED ANSWER — the one place this feature could open a microphone.
 */
describe("nativeAnswerMatches", () => {
  const NOW = 1_760_000_000_000;
  const arm = { roomId: "room-42", voice: false, at: NOW };

  it("completes the call the OS reported", () => {
    expect(nativeAnswerMatches(arm, "room-42", NOW + 500)).toEqual({ voice: false });
    expect(nativeAnswerMatches({ ...arm, voice: true }, "room-42", NOW)).toEqual({ voice: true });
  });

  it("NEVER answers a different room", () => {
    /* Without this, the arm answers whichever call happens to arrive next — which
       may be a stranger's. */
    expect(nativeAnswerMatches(arm, "room-43", NOW)).toBeNull();
    expect(nativeAnswerMatches(arm, "", NOW)).toBeNull();
  });

  it("EXPIRES, so the same caller redialling later is not auto-answered", () => {
    /* Bounded to the server's own ring life — past that the original ring is no
       longer redeliverable, so a match could only be a different call. */
    expect(nativeAnswerMatches(arm, "room-42", NOW + NATIVE_ANSWER_TTL_MS)).toEqual({ voice: false });
    expect(nativeAnswerMatches(arm, "room-42", NOW + NATIVE_ANSWER_TTL_MS + 1)).toBeNull();
    expect(nativeAnswerMatches(arm, "room-42", NOW + 3_600_000)).toBeNull();
  });

  it("is null with nothing armed — the ordinary case for every browser", () => {
    expect(nativeAnswerMatches(null, "room-42", NOW)).toBeNull();
  });

  it("a clock that ran BACKWARDS does not extend the arm indefinitely", () => {
    /* now < at yields a negative age, which is <= the TTL, so it still matches —
       correct: a backwards clock must not strand somebody mid-answer, and the room
       match is still required. */
    expect(nativeAnswerMatches(arm, "room-42", NOW - 5_000)).toEqual({ voice: false });
    expect(nativeAnswerMatches(arm, "other", NOW - 5_000)).toBeNull();
  });
});
