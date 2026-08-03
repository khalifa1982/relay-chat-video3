import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { pickVideoMime, recordFromStream } from "./videoNote";

/**
 * THE VIDEO SIBLING NEVER GOT EITHER OF THE VOICE-NOTE FIXES.
 *
 * 1. `done` COULD HANG. It resolved only from the recorder's `stop` event: there was
 *    no `error` listener, `safeStop()` on an already-inactive recorder fires nothing,
 *    and the duration cap called `stop()` and then trusted that same event. So a
 *    recorder that went inactive on its own — an iOS call or Siri interruption, the
 *    camera claimed by another app, a MediaRecorder `error` — left it pending.
 *
 *    `VideoRecordSheet` leaves `phase === "rec"` only inside `rec.done.then(...)`,
 *    and both of that phase's exits call `recRef.current?.stop()`, a no-op on an
 *    inactive recorder. Both ways out dead, sheet stuck — the same complete lock-out
 *    the owner reported for the voice composer, on the video sheet.
 *
 * 2. AN ANDROID CLIP WAS UNPLAYABLE ON AN IPHONE. `pickVideoMime` asked for bare
 *    `video/mp4`, which Chromium answers TRUE to and then encodes VP8/VP9 under.
 *    The mislabel check spots the lie and switches to WebM — honest, and still
 *    undecodable on every iPhone, because iOS Safari has no WebM demuxer.
 *    `pickAudioMime` learned to ask for the codec BY NAME in v2.106.89; this did not.
 *
 * Driven, because whether a promise settles is exactly what source cannot answer.
 */

type Mode = "normal" | "silent-inactive" | "error-event" | "stop-does-nothing";

class FakeRecorder {
  static mode: Mode = "normal";
  static supported: (t: string) => boolean = () => true;
  static instances: FakeRecorder[] = [];
  state: "inactive" | "recording" | "paused" = "inactive";
  mimeType: string;
  private listeners = new Map<string, ((e: unknown) => void)[]>();
  constructor(_s: unknown, opts?: { mimeType?: string }) {
    this.mimeType = opts?.mimeType ?? "video/webm";
    FakeRecorder.instances.push(this);
  }
  static isTypeSupported(t: string) {
    return FakeRecorder.supported(t);
  }
  addEventListener(t: string, fn: (e: unknown) => void) {
    this.listeners.set(t, [...(this.listeners.get(t) ?? []), fn]);
  }
  removeEventListener(t: string, fn: (e: unknown) => void) {
    this.listeners.set(t, (this.listeners.get(t) ?? []).filter((f) => f !== fn));
  }
  private fire(t: string, e?: unknown) {
    for (const fn of this.listeners.get(t) ?? []) fn(e);
  }
  start(_timeslice?: number) {
    this.state = "recording";
    setTimeout(() => this.fire("dataavailable", { data: new Blob(["frame"]) }), 0);
    if (FakeRecorder.mode === "silent-inactive") {
      setTimeout(() => {
        this.state = "inactive";
      }, 5);
    }
    if (FakeRecorder.mode === "error-event") {
      setTimeout(() => {
        this.state = "inactive";
        this.fire("error");
      }, 5);
    }
  }
  requestData() {
    this.fire("dataavailable", { data: new Blob(["probe"]) });
  }
  stop() {
    if (FakeRecorder.mode === "stop-does-nothing") {
      this.state = "inactive";
      return;
    }
    this.state = "inactive";
    setTimeout(() => {
      this.fire("dataavailable", { data: new Blob(["tail"]) });
      this.fire("stop");
    }, 0);
  }
}

const fakeStream = () => ({ getTracks: () => [] }) as unknown as MediaStream;

beforeEach(() => {
  FakeRecorder.mode = "normal";
  FakeRecorder.supported = () => true;
  FakeRecorder.instances = [];
  vi.stubGlobal("MediaRecorder", FakeRecorder as unknown as typeof MediaRecorder);
  vi.stubGlobal("window", { MediaRecorder: FakeRecorder });
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function resolveWithin(p: Promise<unknown>, ms: number) {
  let out: unknown = "PENDING";
  void p.then((v) => {
    out = v;
  });
  await vi.advanceTimersByTimeAsync(ms);
  return out;
}

describe("the video recording promise always settles", () => {
  it("a normal stop settles with the clip", async () => {
    const r = recordFromStream(fakeStream());
    await vi.advanceTimersByTimeAsync(10);
    r.stop();
    expect(await resolveWithin(r.done, 50)).not.toBeNull();
  });

  it("A RECORDER THAT WENT INACTIVE ON ITS OWN still settles when Stop is pressed", async () => {
    // The lock-out: the engine is already inactive, so `stop()` fires no event.
    FakeRecorder.mode = "silent-inactive";
    const r = recordFromStream(fakeStream());
    await vi.advanceTimersByTimeAsync(10);
    r.stop();
    expect(await resolveWithin(r.done, 50), "the sheet would be stuck on the recording UI").not.toBe(
      "PENDING",
    );
  });

  it("a recorder ERROR settles with what was captured, not with nothing", async () => {
    FakeRecorder.mode = "error-event";
    const r = recordFromStream(fakeStream());
    const out = await resolveWithin(r.done, 50);
    expect(out).not.toBe("PENDING");
    expect(out, "footage already captured must not be thrown away").not.toBeNull();
  });

  it("a stop that produces no event is caught by the deadline", async () => {
    FakeRecorder.mode = "stop-does-nothing";
    const r = recordFromStream(fakeStream(), { maxMs: 10_000 });
    await vi.advanceTimersByTimeAsync(100);
    r.stop();
    expect(await resolveWithin(r.done, 6 * 60_000)).not.toBe("PENDING");
  });

  it("the cap keeps the take rather than resolving before the flush", async () => {
    // The `voiceNote` lesson: `stop()` QUEUES the final blob, so settling in the
    // same tick would drop it.
    const r = recordFromStream(fakeStream(), { maxMs: 5_000 });
    const out = await resolveWithin(r.done, 6_000);
    expect(out).not.toBe("PENDING");
    expect(out).not.toBeNull();
  });

  it("cancel still discards", async () => {
    const r = recordFromStream(fakeStream());
    await vi.advanceTimersByTimeAsync(10);
    r.cancel();
    expect(await resolveWithin(r.done, 50)).toBeNull();
  });

  it("settling is idempotent — a late stop cannot resolve twice", async () => {
    const r = recordFromStream(fakeStream());
    await vi.advanceTimersByTimeAsync(10);
    r.stop();
    const first = await resolveWithin(r.done, 50);
    r.stop();
    await vi.advanceTimersByTimeAsync(50);
    expect(await r.done).toBe(first);
  });
});

describe("a clip recorded on Android is playable on an iPhone", () => {
  it("asks for H.264 BY NAME before falling back to a bare mp4 label", () => {
    const asked: string[] = [];
    FakeRecorder.supported = (t) => {
      asked.push(t);
      return t.includes("avc1");
    };
    const pick = pickVideoMime();
    expect(pick?.mimeType).toContain("avc1");
    expect(pick?.ext).toBe("mp4");
    // The explicit spelling must be tried FIRST — bare `video/mp4` is answered true
    // by engines that then encode VP9 under it.
    expect(asked[0]).toContain("avc1");
  });

  it("still takes Safari's bare video/mp4, which really is H.264", () => {
    FakeRecorder.supported = (t) => t === "video/mp4";
    expect(pickVideoMime()).toEqual({ mimeType: "video/mp4", ext: "mp4" });
  });

  it("falls back to WebM only when no mp4 spelling is offered at all", () => {
    FakeRecorder.supported = (t) => t.startsWith("video/webm");
    expect(pickVideoMime()?.ext).toBe("webm");
  });

  it("reports unsupported rather than producing garbage", () => {
    FakeRecorder.supported = () => false;
    expect(pickVideoMime()).toBeNull();
  });
});
