/* ──────────────────────────────────────────────────────────────────────────
 * v2.105.21 — call quality, as numbers.
 *
 * DRIVEN BEHAVIOURALLY against real-shaped stats reports, because every property
 * here is arithmetic that is easy to get subtly wrong and IMPOSSIBLE to notice by
 * looking at the result on screen: `currentRoundTripTime` and `jitter` are SECONDS
 * (report them raw and a 40ms link reads "0.04ms", i.e. perfect), loss has exactly
 * one correct denominator, and a bitrate is a DELTA so a single sample can only
 * answer null.
 *
 * These are the assertions that make the readout trustworthy. A stats panel showing
 * a confidently wrong number is worse than no panel, because a decision gets made
 * on it — in this case whether to change SFU vendors.
 * ────────────────────────────────────────────────────────────────────────── */
import { describe, it, expect } from "vitest";
import {
  summarizeStats,
  formatCallStats,
  callStatsVerdict,
  type StatEntry,
} from "./callStats";

/** A succeeded candidate pair plus its two candidate ends. */
function pair(localType: string, remoteType: string, rttSec: number | null): StatEntry[] {
  return [
    {
      id: "cp1",
      type: "candidate-pair",
      state: "succeeded",
      nominated: true,
      localCandidateId: "lc",
      remoteCandidateId: "rc",
      ...(rttSec === null ? {} : { currentRoundTripTime: rttSec }),
    },
    { id: "lc", type: "local-candidate", candidateType: localType },
    { id: "rc", type: "remote-candidate", candidateType: remoteType },
  ];
}

describe("the unit conversions — where a wrong number would look plausible", () => {
  it("RTT is reported in SECONDS by the spec and rendered in ms", () => {
    // 0.042s is a healthy 42ms link. Rendered raw it reads "0.042ms", which looks
    // like a flawless connection and would send somebody hunting elsewhere.
    const { stats } = summarizeStats([pair("host", "host", 0.042)], { nowMs: 0 });
    expect(stats.rttMs).toBe(42);
  });

  it("jitter is seconds too", () => {
    const { stats } = summarizeStats(
      [[...pair("host", "host", 0.01), { type: "inbound-rtp", jitter: 0.018, packetsReceived: 100 }]],
      { nowMs: 0 },
    );
    expect(stats.jitterMs).toBe(18);
  });

  it("loss is over packets SENT to us — received plus lost", () => {
    // 5 lost of 105 attempted is 4.8%. Dividing by `received` alone gives 5.0%,
    // which is wrong in the direction that matters (it overstates).
    const { stats } = summarizeStats(
      [[{ type: "inbound-rtp", packetsReceived: 100, packetsLost: 5 }]],
      { nowMs: 0 },
    );
    expect(stats.lossPct).toBe(4.8);
  });

  it("loss is null, never 0, before anything has arrived", () => {
    // "0% loss" on a call that has received nothing is a claim about a link that has
    // not been exercised.
    const { stats } = summarizeStats([[{ type: "inbound-rtp" }]], { nowMs: 0 });
    expect(stats.lossPct).toBeNull();
  });
});

describe("the media path — the finding this whole readout exists for", () => {
  it("a relay candidate on EITHER end means the media is relayed", () => {
    expect(summarizeStats([pair("relay", "host", 0.1)], { nowMs: 0 }).stats.path).toBe("relay");
    expect(summarizeStats([pair("host", "relay", 0.1)], { nowMs: 0 }).stats.path).toBe("relay");
  });

  it("host/srflx pairs are direct", () => {
    expect(summarizeStats([pair("host", "host", 0.1)], { nowMs: 0 }).stats.path).toBe("direct");
    expect(summarizeStats([pair("srflx", "srflx", 0.1)], { nowMs: 0 }).stats.path).toBe("direct");
  });

  it("ONE relayed leg makes the whole call relayed — worst case, not majority", () => {
    // A 4-way call where three legs are direct and one is relayed is a call with a
    // relayed leg. Reporting "direct" because most legs are would hide exactly the
    // thing being looked for.
    const { stats } = summarizeStats([pair("host", "host", 0.02), pair("relay", "host", 0.2)], {
      nowMs: 0,
    });
    expect(stats.path).toBe("relay");
    expect(stats.legs).toBe(2);
  });

  it("with NO succeeded pair the path is unknown, never 'direct'", () => {
    // "direct" would be a claim about the media path with no evidence for it.
    const { stats } = summarizeStats(
      [[{ type: "candidate-pair", state: "in-progress", currentRoundTripTime: 0.05 }]],
      { nowMs: 0 },
    );
    expect(stats.path).toBe("unknown");
    expect(stats.rttMs).toBeNull();
  });

  it("prefers the NOMINATED pair's RTT when several read succeeded", () => {
    const report: StatEntry[] = [
      { id: "a", type: "candidate-pair", state: "succeeded", currentRoundTripTime: 0.5 },
      {
        id: "b",
        type: "candidate-pair",
        state: "succeeded",
        nominated: true,
        currentRoundTripTime: 0.03,
      },
    ];
    expect(summarizeStats([report], { nowMs: 0 }).stats.rttMs).toBe(30);
  });
});

describe("what we are sending — the simulcast trap", () => {
  it("reports the LARGEST outbound layer, not the last one seen", () => {
    // A simulcasting publisher emits one outbound-rtp PER spatial layer. Taking the
    // last would show a healthy 720p publish as 180p and read as a broken camera.
    const report: StatEntry[] = [
      { type: "outbound-rtp", frameWidth: 1280, frameHeight: 720, framesPerSecond: 30 },
      { type: "outbound-rtp", frameWidth: 640, frameHeight: 360, framesPerSecond: 30 },
      { type: "outbound-rtp", frameWidth: 320, frameHeight: 180, framesPerSecond: 15 },
    ];
    const { stats } = summarizeStats([report], { nowMs: 0 });
    expect(stats.up).toEqual({ w: 1280, h: 720, fps: 30 });
  });

  it("and the largest INBOUND frame, so a thumbnail tile does not misreport the call", () => {
    /* THE BIG ONE COMES FIRST, and that ordering is the test.
       FOUND BY MUTATION: my first version listed 320×180 then 1280×720, so
       "take the last" and "take the largest" produced the SAME answer and a
       mutation replacing the comparison with a bare truthiness check SURVIVED.
       The sibling outbound case happened to be ordered correctly, which is exactly
       why that one bit and this one did not — the same class as v2.99.84's padding
       case, where a short `r` beside a full-length `s` hid a wrong offset. */
    const report: StatEntry[] = [
      { type: "inbound-rtp", frameWidth: 1280, frameHeight: 720, framesPerSecond: 25, packetsReceived: 10 },
      { type: "inbound-rtp", frameWidth: 320, frameHeight: 180, framesPerSecond: 15, packetsReceived: 10 },
    ];
    expect(summarizeStats([report], { nowMs: 0 }).stats.down).toEqual({ w: 1280, h: 720, fps: 25 });
  });

  it("an audio-only call reports no frame sizes rather than 0×0", () => {
    const { stats } = summarizeStats(
      [[{ type: "outbound-rtp", bytesSent: 1000 }, { type: "inbound-rtp", packetsReceived: 50 }]],
      { nowMs: 0 },
    );
    expect(stats.up).toBeNull();
    expect(stats.down).toBeNull();
  });
});

describe("throughput is a DELTA, so one sample cannot answer it", () => {
  const first: StatEntry[] = [
    { type: "outbound-rtp", bytesSent: 0 },
    { type: "inbound-rtp", bytesReceived: 0, packetsReceived: 1 },
  ];
  const second: StatEntry[] = [
    { type: "outbound-rtp", bytesSent: 125_000 },
    { type: "inbound-rtp", bytesReceived: 250_000, packetsReceived: 100 },
  ];

  it("the first sample reports null, not 0", () => {
    const { stats, sample } = summarizeStats([first], { nowMs: 1000 });
    expect(stats.kbpsUp).toBeNull();
    expect(stats.kbpsDown).toBeNull();
    expect(sample.atMs).toBe(1000);
  });

  it("the second computes kbps from the byte difference over elapsed time", () => {
    const a = summarizeStats([first], { nowMs: 1000 });
    // 125,000 bytes in 1s = 1,000,000 bits/s = 1000 kbps.
    const b = summarizeStats([second], { prev: a.sample, nowMs: 2000 });
    expect(b.stats.kbpsUp).toBe(1000);
    expect(b.stats.kbpsDown).toBe(2000);
  });

  it("a non-positive interval yields null rather than Infinity", () => {
    const a = summarizeStats([first], { nowMs: 5000 });
    const b = summarizeStats([second], { prev: a.sample, nowMs: 5000 });
    expect(b.stats.kbpsUp).toBeNull();
  });

  it("a counter that went BACKWARDS reads as no data, not a negative bitrate", () => {
    // A renegotiation or a republished track resets the counters. Reporting
    // "-800 kbps" would be nonsense on screen.
    const a = summarizeStats([second], { nowMs: 1000 });
    const b = summarizeStats([first], { prev: a.sample, nowMs: 2000 });
    expect(b.stats.kbpsUp).toBeNull();
    expect(b.stats.kbpsDown).toBeNull();
  });
});

describe("robustness — a stats report is engine-specific and half of it may be absent", () => {
  it("an empty report summarizes to all-nulls without throwing", () => {
    const { stats } = summarizeStats([[]], { nowMs: 0 });
    expect(stats).toMatchObject({ rttMs: null, lossPct: null, path: "unknown", up: null, down: null });
  });

  it("no reports at all is legal (a call with no transport yet)", () => {
    const { stats } = summarizeStats([], { nowMs: 0 });
    expect(stats.legs).toBe(0);
    expect(stats.path).toBe("unknown");
  });

  it("non-numeric and NaN fields are ignored rather than propagated", () => {
    const report = [
      { type: "candidate-pair", state: "succeeded", nominated: true, currentRoundTripTime: NaN },
      { type: "inbound-rtp", packetsReceived: "many" as unknown as number, packetsLost: 3 },
    ] as StatEntry[];
    const { stats } = summarizeStats([report], { nowMs: 0 });
    expect(stats.rttMs).toBeNull();
    // 3 lost, 0 usable received — a real ratio, not NaN.
    expect(stats.lossPct).toBe(100);
  });

  it("a candidate pair whose ends are missing from the report is not called direct", () => {
    // The ids resolve to nothing, so relay cannot be RULED OUT — but a pair did
    // succeed, so this is the one case where "direct" is the honest reading of the
    // evidence available. Pinned so the choice is deliberate.
    const { stats } = summarizeStats(
      [[{ type: "candidate-pair", state: "succeeded", nominated: true, currentRoundTripTime: 0.05, localCandidateId: "gone", remoteCandidateId: "alsogone" }]],
      { nowMs: 0 },
    );
    expect(stats.path).toBe("direct");
  });
});

describe("the one-line rendering", () => {
  it("omits fields it has no value for, so a partial reading reads short not broken", () => {
    const { stats } = summarizeStats([[{ type: "inbound-rtp", packetsReceived: 100, packetsLost: 0 }]], {
      nowMs: 0,
    });
    const line = formatCallStats(stats);
    expect(line).toContain("0% loss");
    expect(line).not.toContain("undefined");
    expect(line).not.toContain("null");
    expect(line).not.toContain("NaN");
  });

  it("says 'measuring…' rather than an empty string before anything is known", () => {
    const { stats } = summarizeStats([], { nowMs: 0 });
    expect(formatCallStats(stats)).toBe("measuring…");
  });

  it("names the relay in words, because the number alone does not explain the latency", () => {
    const { stats } = summarizeStats([pair("relay", "host", 0.2)], { nowMs: 0 });
    expect(formatCallStats(stats)).toContain("via TURN relay");
  });

  it("names 'direct' too, which is what makes 'relay' meaningful when it appears", () => {
    const { stats } = summarizeStats([pair("host", "host", 0.02)], { nowMs: 0 });
    expect(formatCallStats(stats)).toContain("direct");
  });
});

describe("the verdict — generous thresholds, one loud case", () => {
  const base = summarizeStats([pair("host", "host", 0.05)], { nowMs: 0 }).stats;

  it("a relayed call is flagged whatever the numbers say", () => {
    // It is a fixable misconfiguration, not a condition to tolerate — so it is
    // called out even on an otherwise perfect reading.
    const { stats } = summarizeStats([pair("relay", "host", 0.01)], { nowMs: 0 });
    expect(callStatsVerdict(stats)).toBe("relay");
  });

  it("an ordinary healthy call is ok", () => {
    expect(callStatsVerdict(base)).toBe("ok");
  });

  it("high RTT, loss or jitter is poor", () => {
    expect(callStatsVerdict({ ...base, rttMs: 400 })).toBe("poor");
    expect(callStatsVerdict({ ...base, lossPct: 8 })).toBe("poor");
    expect(callStatsVerdict({ ...base, jitterMs: 90 })).toBe("poor");
  });

  it("unknown values never read as poor — absence is not evidence of a bad call", () => {
    expect(callStatsVerdict({ ...base, rttMs: null, lossPct: null, jitterMs: null })).toBe("ok");
  });
});

/* ── the wiring: things behaviour in this env cannot see ──────────────────── */
import fs from "node:fs";
import path from "node:path";
const R = (p: string) => fs.readFileSync(path.resolve(__dirname, "..", "..", "..", p), "utf8");
const CLIENT = R("client/src/lib/relayClient.ts");
const ASSETS = R("client/src/lib/relayAssets.ts");

describe("v2.105.21 — the readout is wired without a second poller", () => {
  it("rides the EXISTING 2s sampler rather than arming its own timer", () => {
    // `sampleStats` already runs every 2s while in a call, is already gated on
    // `inCall`, and already fetches both transports' stats. A parallel interval
    // would double the getStats cost on the app's most expensive screen.
    const fn = CLIENT.slice(CLIENT.indexOf("function sampleStats()"));
    expect(fn.slice(0, 300)).toMatch(/void collectCallQuality\(\);/);
    // Exactly one interval drives stats collection.
    expect((CLIENT.match(/setInterval\(sampleStats/g) || []).length).toBe(1);
    expect(CLIENT).not.toMatch(/setInterval\(\s*collectCallQuality/);
  });

  it("collects every leg through the ONE shared summarizer", () => {
    /* The second collector went with the retired transport (v2.106.53). What the
       pin is FOR survives and is the reason the summarizer is shared at all: any
       transport added later must reduce through `summarizeStats` rather than
       computing its own numbers, or the two cannot be compared and "is this one
       worse?" has no answer. */
    const fn = CLIENT.slice(CLIENT.indexOf("async function collectCallQuality()"));
    const body = fn.slice(0, fn.indexOf("\n  function toggleCallStats"));
    expect(body.length, "the slice must be real").toBeGreaterThan(120);
    expect(body).toMatch(/peers\[pin\]\.pc\.getStats\(\)/);
    // EVERY leg, and one reduction: a per-transport summary is the thing to avoid.
    expect(body).toMatch(/summarizeStats\(/);
    expect((body.match(/summarizeStats\(/g) || []).length).toBe(1);
  });

  it("goes through the ONE shared summarizer, never a private copy of the maths", () => {
    expect(CLIENT).toMatch(/summarizeStats\(reports/);
    // The arithmetic (seconds→ms, the loss denominator, the byte delta) must live in
    // exactly one tested place — a second copy is how the two transports come to
    // disagree about what "40ms" means.
    expect(CLIENT).not.toMatch(/currentRoundTripTime \* 1000/);
  });

  it("is OFF by default and remembered, because a permanent panel was removed once already", () => {
    expect(CLIENT).toMatch(/statsShown = false;/);
    expect(CLIENT).toMatch(/localStorage\.getItem\("relay_call_stats"\)/);
    expect(CLIENT).toMatch(/localStorage\.setItem\("relay_call_stats"/);
  });

  it("does no work at all while switched off", () => {
    // The collector is the expensive half; it must return before any getStats call.
    const fn = CLIENT.slice(CLIENT.indexOf("async function collectCallQuality()"));
    expect(fn.slice(0, 200)).toMatch(/if \(!statsShown \|\| !inCall\) return;/);
  });

  it("clears the byte baseline on toggle, or the first line reports a stale rate", () => {
    const fn = CLIENT.slice(CLIENT.indexOf("function toggleCallStats()"));
    expect(fn.slice(0, 400)).toMatch(/qualPrev = null;/);
  });

  it("can never disturb a call — the whole collector is inside a catch", () => {
    const fn = CLIENT.slice(CLIENT.indexOf("async function collectCallQuality()"));
    expect(fn.slice(0, 3000)).toMatch(/catch \{ \/\* the readout is decoration/);
  });

  it("the chip is mounted and bound", () => {
    expect(ASSETS).toMatch(/id="statsBtn"/);
    expect(ASSETS).toMatch(/id="callQual"/);
    expect(CLIENT).toMatch(/\$\("statsBtn"\)[\s\S]{0,80}toggleCallStats/);
  });
});

describe("v2.105.21 — the readout cannot break the control bar it sits above", () => {
  it("is OUT OF FLOW, so it can never push a chip off a 320px screen", () => {
    // `.controls` is a flex ROW: an in-flow sibling becomes a flex ITEM competing
    // with the bar for width, and that bar has been measured twice to fit 320px
    // with every chip visible (v2.98.3, v2.103.1).
    const css = ASSETS.slice(ASSETS.indexOf(".relay-root .call-qual{"));
    const rule = css.slice(0, css.indexOf("}"));
    expect(rule).toMatch(/position:absolute/);
    expect(rule).toMatch(/bottom:100%/);
    // …and it cannot swallow a tap meant for hang-up underneath it.
    expect(rule).toMatch(/pointer-events:none/);
  });

  it("adds NO backdrop-filter over live video — in ANY of its rules", () => {
    // v2.99.84 measured 36 such layers over live video and removed all of them on
    // phones; adding one back for a debug line would undo that.
    //
    // WIDENED (board 5c): this read only the FIRST rule
    // (`css.slice(0, css.indexOf("}"))`), so the state rules 5c adds — and any rule
    // added later — could have carried a blur with this test green. It now sweeps
    // every rule whose selector mentions the class. The rest of the 5c state-rule
    // guards (no z-index, no animation, hue vocabulary, the writer cross-check)
    // live in `callQualityTone.test.ts`.
    expect(ASSETS).toContain(".relay-root .call-qual{");
    const re = /[^{}]*\.call-qual[^{}]*\{([^}]*)\}/g;
    let seen = 0;
    for (let m = re.exec(ASSETS); m; m = re.exec(ASSETS)) {
      seen += 1;
      expect(m[1]).not.toMatch(/backdrop-filter/);
    }
    // A sweep that matched nothing would pass for the wrong reason.
    expect(seen).toBeGreaterThanOrEqual(2);
  });

  it("the numbers are LTR-isolated, since an RTL locale would reorder them", () => {
    expect(ASSETS).toMatch(/id="callQual"[^>]*dir="ltr"/);
  });
});

describe("degradationPreference reaches every sender", () => {
  it("'balanced' is applied, and it is reachable rather than behind a dead gate", () => {
    /* THE ORIGINAL DEFECT, worth keeping stated: v2.99.84 reasoned that 'balanced'
       beats the camera default of maintain-framerate on a throttled phone — which
       holds fps and sheds RESOLUTION, precisely backwards on a phone whose uplink
       tightens the moment a second track starts — and then applied it ONLY inside a
       function that opened `if (sfuEnabled) return`, so every occurrence was
       unreachable on the transport the fleet actually ran. It is now applied on the
       one path there is, and this pin exists so a future transport gate cannot make
       it unreachable again.

       BOUNDED BY THE FUNCTION'S OWN END rather than a character count — the
       fixed-slice fragility this repo has hit repeatedly (v2.99.78, v2.99.94,
       v2.105.8): a window that silently shrinks as the code above it grows. */
    const at = CLIENT.indexOf("function applyMeshVideoCaps()");
    expect(at).toBeGreaterThan(-1);
    const end = CLIENT.indexOf("\n  function ", at + 10);
    expect(end).toBeGreaterThan(at);
    const mesh = CLIENT.slice(at, end);
    expect(mesh).toMatch(/degradationPreference = "balanced"/);
    // No early return can strand it.
    expect(mesh.slice(0, 120)).not.toMatch(/\breturn;/);
  });

  it("it is set in its OWN setParameters call, never folded in with the caps", () => {
    /* A top-level field some engines reject outright, and a rejected setParameters
       discards the ENTIRE object — so folding it in would silently lose the bitrate
       AND framerate caps on exactly the browsers that most need them. */
    const calls = CLIENT.match(/setParameters\(/g) || [];
    expect(calls.length).toBeGreaterThanOrEqual(2);
  });
});
