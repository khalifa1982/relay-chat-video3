/**
 * THE RECORDING PROMISE MUST ALWAYS SETTLE — DRIVEN, because whether a promise settles is
 * precisely what a source pin cannot tell you.
 *
 * THE DEFECT, and why it cost so much more than it looks: `done` resolved ONLY inside
 * `rec.onstop`. There was no `onerror`, and the duration cap called `rec.stop()` — which
 * itself depends on `onstop` firing. So a recorder that went inactive without firing it (an
 * iOS call or Siri interruption, mic contention with another tab, a MediaRecorder `error`)
 * left the promise pending forever.
 *
 * In `Messages.tsx`, `setRecording(false)` lived only in that promise's `.finally()`, and
 * while `recording` is true the whole composer is REPLACED by the recording bar — no text
 * field, no send button — and both of the bar's exits called `stop()`, a no-op on an
 * already-inactive recorder. Both ways out were dead. The mic is also the DEFAULT primary
 * button while the field is empty, i.e. exactly what somebody taps first. That is a
 * complete, silent lock-out of sending, and it is the owner's "I cannot send messages".
 *
 * Every case below drives the REAL `startVoiceRecording` against a fake MediaRecorder, and
 * every one asserts the promise SETTLES rather than what the source says.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/* ── a MediaRecorder that can misbehave in the ways real ones do ─────────────────── */
type Mode = "normal" | "silent-inactive" | "error-event" | "never-answers";

class FakeRecorder {
  static mode: Mode = "normal";
  static instances: FakeRecorder[] = [];
  state: "inactive" | "recording" | "paused" = "inactive";
  mimeType = "audio/webm";
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(_s: unknown, opts?: { mimeType?: string }) {
    if (opts?.mimeType) this.mimeType = opts.mimeType;
    FakeRecorder.instances.push(this);
  }
  static isTypeSupported() {
    return true;
  }
  start() {
    this.state = "recording";
    // A chunk arrives, as a real recorder would deliver on its timeslice.
    setTimeout(() => this.ondataavailable?.({ data: new Blob(["x"]) as Blob }), 0);
    if (FakeRecorder.mode === "silent-inactive") {
      // THE REAL FAILURE: the engine goes inactive on its own and fires NOTHING.
      setTimeout(() => {
        this.state = "inactive";
      }, 5);
    }
    if (FakeRecorder.mode === "error-event") {
      setTimeout(() => {
        this.state = "inactive";
        this.onerror?.();
      }, 5);
    }
  }
  stop() {
    if (FakeRecorder.mode === "never-answers") {
      // Accepts the call and fires no event — the other shape of the same bug.
      this.state = "inactive";
      return;
    }
    this.state = "inactive";
    this.onstop?.();
  }
  pause() {
    this.state = "paused";
  }
  resume() {
    this.state = "recording";
  }
}

function fakeStream() {
  const track = { stop: vi.fn(), kind: "audio", enabled: true };
  return { getTracks: () => [track], getAudioTracks: () => [track], _track: track } as unknown as MediaStream & { _track: { stop: ReturnType<typeof vi.fn> } };
}

let startVoiceRecording: typeof import("./voiceNote")["startVoiceRecording"];
let currentStream: ReturnType<typeof fakeStream>;

beforeEach(async () => {
  FakeRecorder.mode = "normal";
  FakeRecorder.instances = [];
  vi.stubGlobal("MediaRecorder", FakeRecorder as unknown as typeof MediaRecorder);
  /* `pickAudioMime` reads `window.MediaRecorder` specifically, not the bare global, and the
     suite runs in the `node` environment where `window` does not exist — so stubbing the
     global alone left the module correctly reporting "not supported". Stub the window it
     actually looks at. */
  vi.stubGlobal("window", { MediaRecorder: FakeRecorder });
  // WebAudio is optional decoration here (the level meter); absent it must degrade, not throw.
  vi.stubGlobal("AudioContext", undefined);
  vi.stubGlobal("webkitAudioContext", undefined);
  // The real entry point acquires the mic itself, so the mic is what gets stubbed — which
  // also lets the release assertions below watch the REAL track this module stops.
  vi.stubGlobal("navigator", {
    mediaDevices: { getUserMedia: async () => currentStream },
  });
  vi.useFakeTimers();
  ({ startVoiceRecording } = await import("./voiceNote"));
});

/** Acquire a recording the way the app does, and remember the stream it was given. */
async function record(maxMs: number) {
  currentStream = fakeStream();
  const h = await startVoiceRecording({ maxMs });
  return { h, stream: currentStream };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetModules();
});

/** Settle the promise or fail loudly — never hang the suite waiting for a hang. */
async function settlesWithin(p: Promise<unknown>, ms: number) {
  let done = false;
  const tracked = p.then((v) => {
    done = true;
    return v;
  });
  await vi.advanceTimersByTimeAsync(ms);
  return { done, value: done ? await tracked : undefined };
}

describe("the recording promise always settles", () => {
  it("a normal stop settles with the audio", async () => {
    const { h } = await record(60_000);
    await vi.advanceTimersByTimeAsync(10);
    h.stop();
    const r = await settlesWithin(h.done, 50);
    expect(r.done, "a normal stop must settle").toBe(true);
    expect(r.value).not.toBeNull();
  });

  it("cancel settles with NULL, so nothing is uploaded", async () => {
    const { h } = await record(60_000);
    await vi.advanceTimersByTimeAsync(10);
    h.cancel();
    const r = await settlesWithin(h.done, 50);
    expect(r.done).toBe(true);
    expect(r.value, "a discarded note must not resolve to a blob").toBeNull();
  });

  it("A RECORDER THAT WENT INACTIVE ON ITS OWN still settles when stop is pressed", async () => {
    /* THE OWNER'S LOCK-OUT. The engine is already inactive, so `stop()` fires no event —
       before the fix this pended forever and the composer never came back. */
    FakeRecorder.mode = "silent-inactive";
    const { h } = await record(60_000);
    await vi.advanceTimersByTimeAsync(20);
    expect(FakeRecorder.instances[0].state, "the fake really did go inactive").toBe("inactive");
    h.stop();
    const r = await settlesWithin(h.done, 50);
    expect(r.done, "stop on an inactive recorder must settle, not hang").toBe(true);
  });

  it("…and DISCARD works on one too", async () => {
    // Both exits from the recording bar routed through the same no-op. Both must work.
    FakeRecorder.mode = "silent-inactive";
    const { h } = await record(60_000);
    await vi.advanceTimersByTimeAsync(20);
    h.cancel();
    const r = await settlesWithin(h.done, 50);
    expect(r.done).toBe(true);
    expect(r.value).toBeNull();
  });

  it("a recorder ERROR settles, and KEEPS what was captured", async () => {
    /* Losing a recording somebody made is worse than sending a slightly short one, so the
       error path resolves with the chunks rather than discarding them. */
    FakeRecorder.mode = "error-event";
    const { h } = await record(60_000);
    const r = await settlesWithin(h.done, 60);
    expect(r.done, "an error event must settle the promise").toBe(true);
    expect(r.value, "captured audio is kept, not thrown away").not.toBeNull();
  });

  it("WITH NO DURATION CAP, a stop that produces no event still settles — the DEADLINE", async () => {
    /* THE BACKSTOP, AND THIS CASE HAD TO BE REWRITTEN TO REACH IT. The first version passed
       `maxMs: 1_000`, so the duration CAP settled the promise and removing the deadline
       entirely still passed — the test proved the cap worked and said nothing about the
       backstop. Found by mutation. With no cap there is no other timer, so only the deadline
       can settle this, and that is what makes "pending forever" impossible rather than
       merely unlikely. */
    FakeRecorder.mode = "never-answers";
    currentStream = fakeStream();
    const h = await startVoiceRecording(); // NO maxMs — the cap cannot rescue this
    await vi.advanceTimersByTimeAsync(10);
    h.stop(); // accepted, fires nothing
    const stillHanging = await settlesWithin(h.done, 5_000);
    expect(stillHanging.done, "nothing else should have settled it this early").toBe(false);
    const r = await settlesWithin(h.done, 6 * 60_000);
    expect(r.done, "the deadline must settle it with no cap in play").toBe(true);
  });

  it("a stop that produces no event settles under a cap too", async () => {
    FakeRecorder.mode = "never-answers";
    const { h } = await record(1_000);
    await vi.advanceTimersByTimeAsync(10);
    h.stop();
    const early = await settlesWithin(h.done, 100);
    // It may settle immediately via the already-inactive path — either is correct, so long
    // as it settles. What must NOT happen is pending forever.
    const late = early.done ? early : await settlesWithin(h.done, 40_000);
    expect(late.done, "nothing may leave this promise pending").toBe(true);
  });

  it("the duration cap settles by itself, with nobody pressing anything", async () => {
    /* WINDOW WIDENED v2.107.15, and the reason is the other half of this same line.
       The cap used to call `finish()` in the SAME TICK as `rec.stop()` — which does
       settle it promptly, and threw the recording away doing so: `stop()` queues the
       final `dataavailable`, and with no timeslice that queued blob is the entire
       take, so `finish` ran on an empty `chunks` and resolved NULL. A voicemail
       spoken for the full minute vanished (see `voiceNoteCap.test.ts`, which models
       the spec's async flush — the fake here fires `onstop` synchronously, which is
       exactly why this file could not see it).

       So the cap now stops the recorder and arms a SHORT deadline instead of
       pre-empting the flush. The property this test exists for is unchanged and is
       still asserted: nobody presses anything and it settles on its own. */
    FakeRecorder.mode = "never-answers";
    const { h } = await record(800);
    // Bounded well inside the flush grace plus a margin — not "eventually".
    const r = await settlesWithin(h.done, 800 + 5_000 + 1_000);
    expect(r.done, "the cap must settle rather than merely ask the recorder to stop").toBe(true);
  });

  it("THE MIC IS RELEASED on every settling path — no lingering LED", async () => {
    /* v2.99.39 was a whole release about capture outliving its call. Each of these used to
       depend on `onstop` running. */
    for (const mode of ["normal", "silent-inactive", "error-event", "never-answers"] as Mode[]) {
      FakeRecorder.mode = mode;
      const { h, stream } = await record(500);
      await vi.advanceTimersByTimeAsync(20);
      h.stop();
      await settlesWithin(h.done, 40_000);
      expect(stream._track.stop, `mic left open in mode=${mode}`).toHaveBeenCalled();
    }
  });

  it("settling twice runs the TEARDOWN once — the paths are idempotent", async () => {
    /* Four things can now settle this, and more than one can fire for a single recording
       (a cap plus a stop, an error plus a deadline).
       THIS ASSERTION HAD TO BE REWRITTEN TO BE ABLE TO FAIL. It previously checked only the
       resolved VALUE — and `Promise.resolve` is itself idempotent, so removing the `settled`
       guard changed nothing observable and the mutation survived. The guard's real,
       observable job is that the TEARDOWN does not re-run: without it, three exits stop the
       microphone's tracks three times and add to the elapsed clock repeatedly. Counting the
       mic stops is what makes the property testable. */
    const { h, stream } = await record(500);
    await vi.advanceTimersByTimeAsync(10);
    h.stop();
    h.stop();
    h.cancel();
    const r = await settlesWithin(h.done, 40_000);
    expect(r.done).toBe(true);
    expect(stream._track.stop, "teardown must run exactly once").toHaveBeenCalledTimes(1);
    // `cancel()` after a settled stop must NOT retroactively null the result.
    expect(r.value, "a late cancel cannot un-send an already-settled recording").not.toBeNull();
  });
});

/**
 * THE CAP COUNTED WALL CLOCK WHILE THE TIMER COUNTED AUDIO.
 *
 * `elapsedMs()` excludes paused time on purpose — a note paused for a minute must not
 * claim to be a minute longer than its sound. The duration cap did not, and the two
 * meet in exactly one place: `VoicemailPrompt` passes `maxMs: 60_000` and puts a pause
 * button next to the timer. Pause for twenty seconds and the recorder was stopped at
 * forty seconds of audio, with the on-screen timer reading 0:40 out of 1:00 and
 * nothing anywhere saying why.
 *
 * Driven, not pinned: whether a timer fires early is not something source can answer.
 */
describe("a pause does not eat the recording budget", () => {
  it("the cap fires after maxMs of AUDIO, not of wall clock", async () => {
    const { h } = await record(60_000);
    await vi.advanceTimersByTimeAsync(30_000); // 30s recorded
    h.pause();
    await vi.advanceTimersByTimeAsync(30_000); // 30s paused — must not count
    expect(h.state()).toBe("paused");
    let settled = false;
    void h.done.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled, "the cap fired during the pause").toBe(false);

    h.resume();
    // 29 more seconds of audio: 59s total, still inside the minute.
    await vi.advanceTimersByTimeAsync(29_000);
    await vi.advanceTimersByTimeAsync(0);
    expect(settled, "the cap fired a second early").toBe(false);

    // …and the last second closes it.
    const r = await settlesWithin(h.done, 2_000);
    expect(r.done, "the cap must still stop the recording").toBe(true);
    expect(r.value).not.toBeNull();
  });

  it("the reported duration excludes the pause, and matches what the cap counted", async () => {
    const { h } = await record(60_000);
    await vi.advanceTimersByTimeAsync(10_000);
    h.pause();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(h.elapsedMs()).toBeGreaterThanOrEqual(10_000);
    expect(h.elapsedMs(), "paused time leaked into the duration").toBeLessThan(11_000);
    h.resume();
    await vi.advanceTimersByTimeAsync(5_000);
    h.stop();
    const r = await settlesWithin(h.done, 100);
    expect(r.done).toBe(true);
    const v = r.value as { durationMs: number };
    expect(v.durationMs).toBeGreaterThanOrEqual(15_000);
    expect(v.durationMs).toBeLessThan(16_000);
  });

  it("an uncapped recording is unaffected by pausing", async () => {
    currentStream = fakeStream();
    const h = await startVoiceRecording();
    await vi.advanceTimersByTimeAsync(1_000);
    h.pause();
    await vi.advanceTimersByTimeAsync(60_000);
    h.resume();
    await vi.advanceTimersByTimeAsync(1_000);
    h.stop();
    const r = await settlesWithin(h.done, 100);
    expect(r.done).toBe(true);
    expect(r.value).not.toBeNull();
  });

  it("a recording left PAUSED still settles eventually", async () => {
    // The backstop's property is "never pending forever". A paused recorder has
    // working Discard and Send buttons so it is not the lock-out that motivated it,
    // but it must not be able to sit there for the life of the tab either.
    const { h } = await record(60_000);
    await vi.advanceTimersByTimeAsync(1_000);
    h.pause();
    const r = await settlesWithin(h.done, 11 * 60_000);
    expect(r.done, "a forgotten paused recording never settled").toBe(true);
  });

  it("the backstop is not consumed by a pause either", async () => {
    // Left on wall clock it would fire mid-pause and end a recording somebody had
    // merely set down.
    const { h } = await record(60_000);
    await vi.advanceTimersByTimeAsync(5_000);
    h.pause();
    await vi.advanceTimersByTimeAsync(80_000); // past the original 90s deadline
    h.resume();
    let settled = false;
    void h.done.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled, "the backstop fired across the pause").toBe(false);
    h.stop();
    const r = await settlesWithin(h.done, 100);
    expect(r.done).toBe(true);
  });
});
