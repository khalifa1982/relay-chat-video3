import { describe, expect, it } from "vitest";
import {
  accumulateCall,
  callTotals,
  mergeSessionEvents,
  newCallAccumulator,
  pushCallSample,
  sessionStateOf,
  SESSION_EVENT_MAX,
  type CallSample,
  type SessionEvent,
} from "./telemetryCore";

/* The journey and vitals cores are pure on purpose: the client caps before
 * sending and the server caps before storing, and these tests are the proof
 * that both ends agree on what the caps mean. */

describe("mergeSessionEvents", () => {
  const ev = (i: number): SessionEvent => ({ t: i, kind: "tap", msg: "tap " + i });

  it("appends onto stored events and keeps order", () => {
    const first = mergeSessionEvents(null, [ev(1), ev(2)]);
    const second = mergeSessionEvents(first, [ev(3)]);
    const parsed = JSON.parse(second) as SessionEvent[];
    expect(parsed.map((e) => e.msg)).toEqual(["tap 1", "tap 2", "tap 3"]);
  });

  it("drops the OLDEST past the item cap — the end of a journey is where crashes live", () => {
    let stored: string | null = null;
    for (let i = 0; i < SESSION_EVENT_MAX + 50; i += 25) {
      stored = mergeSessionEvents(stored, Array.from({ length: 25 }, (_, j) => ev(i + j)));
    }
    const parsed = JSON.parse(stored as string) as SessionEvent[];
    expect(parsed.length).toBeLessThanOrEqual(SESSION_EVENT_MAX);
    expect(parsed[parsed.length - 1].msg).toBe("tap " + (SESSION_EVENT_MAX + 50 - 1));
  });

  it("sheds oldest while over the char cap instead of failing", () => {
    /* NEVER RAN until v2.107.32 — the vitest globs omitted shared/ — and the
       day it first ran it failed on ITS OWN arithmetic, not the function's:
       199 x's + a three-digit index is 202 chars, so the per-message cap this
       very suite pins two cases below truncated "…299" to "…2" before any
       shedding happened. 190 keeps every index intact. The INTENT was always
       the function's behavior: the END of the journey survives (that is where
       crashes live), the start is what sheds. */
    const big: SessionEvent[] = Array.from({ length: 300 }, (_, i) => ({
      t: i,
      kind: "nav",
      msg: "x".repeat(190) + i,
    }));
    const out = mergeSessionEvents(null, big, 400, 10_000);
    expect(out.length).toBeLessThanOrEqual(10_000);
    const parsed = JSON.parse(out) as SessionEvent[];
    expect(parsed[parsed.length - 1].msg.endsWith("299")).toBe(true);
    // The head was genuinely shed — the first survivor is not event 0.
    expect(Number(parsed[0].msg.slice(190))).toBeGreaterThan(0);
  });

  it("replaces a corrupt stored trail rather than throwing", () => {
    const out = mergeSessionEvents("{not json", [ev(1)]);
    expect((JSON.parse(out) as SessionEvent[]).length).toBe(1);
  });

  it("caps each message to the shared length", () => {
    const out = mergeSessionEvents(null, [{ t: 0, kind: "error", msg: "y".repeat(500) }]);
    expect((JSON.parse(out) as SessionEvent[])[0].msg.length).toBe(200);
  });
});

describe("sessionStateOf", () => {
  const now = 1_000_000;
  it("closed when the client said goodbye, regardless of staleness", () => {
    expect(sessionStateOf(now - 500_000, now - 500_000, now)).toBe("closed");
  });
  it("open while the heartbeat is fresh", () => {
    expect(sessionStateOf(null, now - 30_000, now)).toBe("open");
  });
  it("vanished once the heartbeat goes silent past the stale window", () => {
    expect(sessionStateOf(null, now - 90_001, now)).toBe("vanished");
    // The boundary itself is still open — "more than", not "at least".
    expect(sessionStateOf(null, now - 90_000, now)).toBe("open");
  });
});

describe("pushCallSample", () => {
  it("halves resolution past the cap so a marathon call keeps its whole shape", () => {
    const list: CallSample[] = [];
    for (let i = 0; i < 130; i++) {
      pushCallSample(list, { t: i, upKbps: i, downKbps: i, rttMs: null, lossPct: null }, 120);
    }
    expect(list.length).toBeLessThanOrEqual(120);
    expect(list[0].t).toBe(0); // the start survives
    expect(list[list.length - 1].t).toBe(129); // and so does the end
  });
});

describe("accumulateCall + callTotals", () => {
  it("derives totals from cumulative counters — first vs last, never a sum of deltas", () => {
    const a = newCallAccumulator();
    accumulateCall(a, 2, 10_240, 20_480, 40, 80, 120, 1.5);
    accumulateCall(a, 4, 30_720, 61_440, 40, 80, 80, 0.5);
    // a missed tick between these loses resolution, not volume:
    accumulateCall(a, 10, 102_400, 204_800, 40, 80, 100, 4.2);
    const t = callTotals(a);
    expect(t.upKB).toBe(Math.round((102_400 - 10_240) / 1024));
    expect(t.downKB).toBe(Math.round((204_800 - 20_480) / 1024));
    expect(t.avgRttMs).toBe(100);
    expect(t.maxRttMs).toBe(120);
    expect(t.lossWorstPct).toBe(4.2);
  });

  it("reports null round-trip when no sample ever carried one", () => {
    const a = newCallAccumulator();
    accumulateCall(a, 1, 100, 100, 0, 0, null, null);
    const t = callTotals(a);
    expect(t.avgRttMs).toBeNull();
    expect(t.maxRttMs).toBeNull();
  });
});
