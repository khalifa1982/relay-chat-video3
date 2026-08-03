import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * A RECORDING THAT RAN TO ITS DURATION CAP WAS THROWN AWAY.
 *
 * `startVoiceRecording` calls `rec.start()` with NO timeslice — one blob at the end
 * rather than a stream of them — and `MediaRecorder.stop()` QUEUES the final
 * `dataavailable` rather than firing it. The cap did:
 *
 *     rec.stop();
 *     finish();          // same tick
 *
 * so `finish` ran while `chunks` was still empty, and it resolves NULL for an empty
 * recording. `VoicemailPrompt` passes `maxMs: 60_000`, so a voicemail somebody spoke
 * for the full minute resolved to nothing and read as "cancelled". No error, no
 * retry, no trace.
 *
 * WHY THE SUITE DID NOT CATCH IT: the fake recorder in `voiceNoteSettle.test.ts`
 * fires `onstop` SYNCHRONOUSLY and emits a chunk from `start()`, so the queue this
 * bug lives in does not exist there. The recorder below follows the spec instead —
 * data arrives only after `stop()`, on a later task — which is the whole point of
 * this file.
 */
class SpecRecorder {
  static instances: SpecRecorder[] = [];
  /** Set to make `stop()` produce nothing at all — a recorder that died quietly. */
  static silent = false;
  state: "inactive" | "recording" | "paused" = "inactive";
  mimeType = "audio/webm";
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    SpecRecorder.instances.push(this);
  }
  static isTypeSupported() {
    return true;
  }
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    if (SpecRecorder.silent) return;
    // The spec queues a task: the final blob and then the stop event.
    setTimeout(() => {
      this.ondataavailable?.({ data: new Blob(["the whole recording"]) as Blob });
      this.onstop?.();
    }, 0);
  }
  pause() {
    this.state = "paused";
  }
  resume() {
    this.state = "recording";
  }
}

let startVoiceRecording: typeof import("./voiceNote")["startVoiceRecording"];

beforeEach(async () => {
  SpecRecorder.instances = [];
  SpecRecorder.silent = false;
  vi.stubGlobal("MediaRecorder", SpecRecorder as unknown as typeof MediaRecorder);
  vi.stubGlobal("window", { MediaRecorder: SpecRecorder });
  vi.stubGlobal("AudioContext", undefined);
  vi.stubGlobal("webkitAudioContext", undefined);
  const track = { stop: vi.fn(), kind: "audio", enabled: true };
  vi.stubGlobal("navigator", {
    mediaDevices: { getUserMedia: async () => ({ getTracks: () => [track] }) },
  });
  vi.useFakeTimers();
  ({ startVoiceRecording } = await import("./voiceNote"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetModules();
});

/** Settle or report PENDING — never hang the suite on a hang. */
async function resolveWithin(p: Promise<unknown>, ms: number) {
  let out: unknown = "PENDING";
  void p.then((v) => {
    out = v;
  });
  await vi.advanceTimersByTimeAsync(ms);
  return out;
}

describe("a recording that reaches its cap is KEPT", () => {
  it("the full-length voicemail is delivered, not discarded", async () => {
    const h = await startVoiceRecording({ maxMs: 60_000 });
    const out = await resolveWithin(h.done, 61_000);
    expect(out, "a voicemail spoken for the whole minute resolved to nothing").not.toBeNull();
    expect(out).not.toBe("PENDING");
    const v = out as { blob: Blob; durationMs: number };
    expect(v.blob.size).toBeGreaterThan(0);
    expect(v.durationMs).toBeGreaterThanOrEqual(60_000);
  });

  it("it still settles when the stop produces NOTHING — the cap is not a way to hang", async () => {
    // The property the same line was added for: a recorder that goes inactive
    // without flushing must not leave the promise pending. The grace window is what
    // bounds it now, instead of pre-empting the flush.
    SpecRecorder.silent = true;
    const h = await startVoiceRecording({ maxMs: 60_000 });
    const out = await resolveWithin(h.done, 61_000 + 6_000);
    expect(out, "a silent recorder left the promise pending").not.toBe("PENDING");
    expect(out).toBeNull(); // nothing was captured, so there is nothing to send
  });

  it("the grace is SHORT — a user is not left staring at a spent recorder", async () => {
    SpecRecorder.silent = true;
    const h = await startVoiceRecording({ maxMs: 10_000 });
    // Nothing yet at the cap itself…
    let out: unknown = "PENDING";
    void h.done.then((v) => {
      out = v;
    });
    await vi.advanceTimersByTimeAsync(10_100);
    expect(out).toBe("PENDING");
    // …and settled well inside ten seconds after it.
    await vi.advanceTimersByTimeAsync(9_900);
    expect(out).not.toBe("PENDING");
  });

  it("a manual stop is unaffected — it always waited for the flush", async () => {
    const h = await startVoiceRecording({ maxMs: 60_000 });
    await vi.advanceTimersByTimeAsync(5_000);
    h.stop();
    const out = await resolveWithin(h.done, 100);
    expect(out).not.toBeNull();
    expect((out as { blob: Blob }).blob.size).toBeGreaterThan(0);
  });

  it("cancelling at the cap still discards, deliberately", async () => {
    // `cancelled` outranks the chunks: the user asked for it to go.
    const h = await startVoiceRecording({ maxMs: 60_000 });
    await vi.advanceTimersByTimeAsync(5_000);
    h.cancel();
    expect(await resolveWithin(h.done, 100)).toBeNull();
  });

  it("a PAUSED recording that resumes into the cap is kept too", async () => {
    // The two fixes have to compose: the cap counts audio, and reaching it keeps
    // what was recorded.
    const h = await startVoiceRecording({ maxMs: 60_000 });
    await vi.advanceTimersByTimeAsync(30_000);
    h.pause();
    await vi.advanceTimersByTimeAsync(60_000); // does not count
    h.resume();
    const out = await resolveWithin(h.done, 31_000);
    expect(out).not.toBeNull();
    expect(out).not.toBe("PENDING");
  });
});
