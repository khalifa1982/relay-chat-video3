/**
 * v2.106.58 — the readout says WHAT and WHERE, not only how bad.
 *
 * The mediasoup doc's section 3 ends with "Also finish the in-call stats readout …
 * ICE candidate type … It is the only instrument that can explain the 'becomes slow'
 * complaint, and it must work on both transports so the two can be compared with
 * numbers rather than impressions." Four of its named fields were missing, and one
 * of the aggregation rules hid the thing it was meant to surface.
 *
 * DRIVEN, not pinned, for everything computable: whether a `protocol` read off the
 * candidate PAIR comes back null is exactly what a source assertion cannot answer,
 * and it is the difference between a field that works and one that renders nothing
 * while looking implemented. The wiring — two lines, textContent, no second poller —
 * is source-pinned because it lives inside a 6,500-line closure with no DOM here.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  summarizeStats,
  formatCallStats,
  formatCallDetail,
  callStatsVerdict,
  LOSS_MIN_PACKETS,
  type StatEntry,
  type CallStats,
} from "./callStats";

const HERE = __dirname;
const CLIENT = readFileSync(join(HERE, "relayClient.ts"), "utf8");
const ASSETS = readFileSync(join(HERE, "relayAssets.ts"), "utf8");
const STATS = readFileSync(join(HERE, "callStats.ts"), "utf8");

/** Strip comment SPANS so a prose mention of a banned pattern cannot satisfy — or
 *  falsely fail — an assertion about code. */
function codeOnly(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/** A succeeded, nominated pair plus its two candidate ends. */
function pair(
  opts: { localType?: string; remoteType?: string; localProto?: string; remoteProto?: string } = {},
): StatEntry[] {
  return [
    {
      id: "p", type: "candidate-pair", state: "succeeded", nominated: true,
      localCandidateId: "lc", remoteCandidateId: "rc", currentRoundTripTime: 0.004,
    },
    { id: "lc", type: "local-candidate", candidateType: opts.localType ?? "host", protocol: opts.localProto },
    { id: "rc", type: "remote-candidate", candidateType: opts.remoteType ?? "host", protocol: opts.remoteProto },
  ];
}

function one(entries: StatEntry[]): CallStats {
  return summarizeStats([entries], { nowMs: 1000 }).stats;
}
function legs(...reports: StatEntry[][]): CallStats {
  return summarizeStats(reports, { nowMs: 1000 }).stats;
}

/** An inbound audio leg with the given counters. */
function inbound(received: number, lost: number): StatEntry {
  return { id: "i", type: "inbound-rtp", kind: "audio", packetsReceived: received, packetsLost: lost };
}

describe("v2.106.58 — the ICE candidate type is surfaced, and `path` is derived from it", () => {
  it("reports the specific candidate type rather than only relay-vs-direct", () => {
    const s = one(pair({ localType: "host", remoteType: "host" }));
    expect(s.candidate).toBe("host");
    expect(s.path).toBe("direct");
  });

  it("distinguishes srflx from host — both of which USED to read only 'direct'", () => {
    const s = one(pair({ localType: "host", remoteType: "srflx" }));
    // Worse of the two ends: a NAT-traversed pair is not a same-LAN pair.
    expect(s.candidate).toBe("srflx");
    expect(s.path).toBe("direct");
    expect(formatCallDetail(s)).toContain("srflx");
  });

  it("derives `path` from the candidate, so relay still reads relay", () => {
    const s = one(pair({ localType: "host", remoteType: "relay" }));
    expect(s.candidate).toBe("relay");
    expect(s.path).toBe("relay");
    expect(callStatsVerdict(s)).toBe("relay");
  });

  it("takes the WORST candidate across legs, matching `path`'s own discipline", () => {
    const s = legs(pair({ localType: "host" }), pair({ localType: "relay", remoteType: "relay" }));
    expect(s.candidate).toBe("relay");
    expect(s.path).toBe("relay");
  });

  it("IGNORES an unrecognised candidate type rather than ranking it, so `path` stays byte-identical to the flag it replaced", () => {
    const s = one(pair({ localType: "quantum", remoteType: "quantum" }));
    expect(s.candidate).toBeNull();
    // A pair WAS seen, so "direct" — exactly what the old anyRelay=false produced.
    expect(s.path).toBe("direct");
  });

  it("still reports `unknown` with no succeeded pair at all", () => {
    const s = one([{ id: "p", type: "candidate-pair", state: "failed" }]);
    expect(s.path).toBe("unknown");
    expect(s.candidate).toBeNull();
  });
});

describe("v2.106.58 — the transport protocol comes from the CANDIDATE, never the pair", () => {
  it("captures udp", () => {
    const s = one(pair({ localProto: "udp", remoteProto: "udp" }));
    expect(s.protocol).toBe("udp");
    expect(formatCallDetail(s)).toContain("host/udp");
  });

  it("reports tcp as the worse of a mixed pair, because its latency is the finding", () => {
    const s = one(pair({ localProto: "udp", remoteProto: "tcp" }));
    expect(s.protocol).toBe("tcp");
  });

  it("reads NOTHING when the protocol sits on the pair instead of its ends — the trap that renders an implemented-looking blank", () => {
    const entries = pair();
    // Put it in the wrong place on purpose: the spec has no `protocol` on a pair.
    (entries[0] as StatEntry).protocol = "udp";
    entries[1].protocol = undefined;
    entries[2].protocol = undefined;
    expect(one(entries).protocol).toBeNull();
  });

  it("takes the worst protocol across legs", () => {
    const s = legs(pair({ localProto: "udp", remoteProto: "udp" }), pair({ localProto: "tcp", remoteProto: "tcp" }));
    expect(s.protocol).toBe("tcp");
  });

  it("lowercases, so a UA reporting UDP is not a third value", () => {
    expect(one(pair({ localProto: "UDP", remoteProto: "UDP" })).protocol).toBe("udp");
  });
});

describe("v2.106.58 — the negotiated codec, resolved through the codec entry", () => {
  const send = (codecId: string, extra: Partial<StatEntry> = {}): StatEntry =>
    ({ id: "o" + codecId, type: "outbound-rtp", codecId, ...extra });

  it("names the audio codec, which is what the Opus check needs", () => {
    const s = one([...pair(), send("ca"), { id: "ca", type: "codec", mimeType: "audio/opus" }]);
    expect(s.codecAudio).toBe("opus");
    expect(s.codecVideo).toBeNull();
    expect(formatCallDetail(s)).toContain("↑opus");
  });

  it("reports NO video codec on a VOICE call, though the frameless consent m-line negotiates one", () => {
    /* MEASURED on a real voice call before this gate existed: under mutual
       consent the offerer negotiates a video m-line with a null track for the
       slot the camera would later fill (v2.106.51), so Chromium reports an
       outbound video stream with a codec and NO frames. The readout said "VP8"
       on a call with no camera — the false impression this release removes, and
       the opposite of the doc's own "confirm no camera track is published". */
    const s = one([
      ...pair(),
      { id: "oa", type: "outbound-rtp", kind: "audio", codecId: "ca" },
      { id: "ca", type: "codec", mimeType: "audio/opus" },
      // The consent slot: a real video stream, a real codec, zero frames.
      { id: "ov", type: "outbound-rtp", kind: "video", codecId: "cv" },
      { id: "cv", type: "codec", mimeType: "video/VP8" },
    ]);
    expect(s.codecAudio).toBe("opus");
    expect(s.codecVideo).toBeNull();
    // And it agrees with the resolution line, which is the same evidence.
    expect(s.up).toBeNull();
    expect(formatCallDetail(s)).toContain("↑opus");
    expect(formatCallDetail(s)).not.toContain("VP8");
  });

  it("names the video codec, which is the H.264 preference's only direct pass/fail signal", () => {
    const s = one([
      ...pair(),
      send("cv", { kind: "video", frameWidth: 640, frameHeight: 360 }),
      { id: "cv", type: "codec", mimeType: "video/H264" },
    ]);
    expect(s.codecVideo).toBe("H264");
    expect(formatCallDetail(s)).toContain("↑H264");
  });

  it("files by the codec's OWN mimeType prefix, so no `kind` guess is involved", () => {
    // No kind, no mediaType, no frame size — only the codec entry says which it is.
    const s = one([...pair(), send("cv", { frameWidth: 640, frameHeight: 360 }), { id: "cv", type: "codec", mimeType: "video/VP8" }]);
    expect(s.codecVideo).toBe("VP8");
    expect(s.codecAudio).toBeNull();
  });

  it("reads NOTHING when mimeType is on the rtp entry rather than the codec it names", () => {
    const s = one([...pair(), { id: "o", type: "outbound-rtp", mimeType: "audio/opus" } as StatEntry]);
    expect(s.codecAudio).toBeNull();
  });

  it("joins legs that DISAGREE rather than hiding it behind whichever came first", () => {
    const fr = { kind: "video", frameWidth: 640, frameHeight: 360 };
    const a = [...pair(), send("c1", fr), { id: "c1", type: "codec", mimeType: "video/VP8" }];
    const b = [...pair(), send("c2", fr), { id: "c2", type: "codec", mimeType: "video/H264" }];
    // Sorted, so the string is stable across reports rather than emission-order dependent.
    expect(legs(a, b).codecVideo).toBe("H264/VP8");
    expect(legs(b, a).codecVideo).toBe("H264/VP8");
  });

  it("ignores a top-level type that is neither audio nor video", () => {
    const s = one([...pair(), send("cx"), { id: "cx", type: "codec", mimeType: "application/octet-stream" }]);
    expect(s.codecAudio).toBeNull();
    expect(s.codecVideo).toBeNull();
  });

  it("ignores a malformed mimeType with no slash", () => {
    const s = one([...pair(), send("cy"), { id: "cy", type: "codec", mimeType: "opus" }]);
    expect(s.codecAudio).toBeNull();
  });
});

describe("v2.106.58 — loss stops being diluted by the clean legs of a group call", () => {
  it("is IDENTICAL to the pooled figure on a 1:1 call, so the common case is unchanged", () => {
    const s = one([...pair(), inbound(950, 50)]);
    expect(s.lossPct).toBe(5);
    expect(s.lossWorstPct).toBe(5);
    // Equal, so the detail line does not restate it.
    expect(formatCallDetail(s)).not.toContain("worst leg");
  });

  it("surfaces one bad peer that four clean ones would otherwise average away", () => {
    const clean = [...pair(), inbound(1000, 0)];
    const bad = [...pair(), inbound(800, 200)];
    const s = legs(clean, clean, clean, clean, bad);
    // Pooled reads healthy...
    expect(s.lossPct).toBeLessThan(5);
    // ...while the worst leg is a fifth of its packets gone.
    expect(s.lossWorstPct).toBe(20);
    expect(callStatsVerdict(s)).toBe("poor");
    expect(formatCallDetail(s)).toContain("worst leg 20%");
  });

  it("a five-clean-leg call is still ok — the worst-leg rule must not cry wolf", () => {
    const clean = [...pair(), inbound(1000, 0)];
    const s = legs(clean, clean, clean, clean, clean);
    expect(s.lossWorstPct).toBe(0);
    expect(callStatsVerdict(s)).toBe("ok");
  });

  it("a freshly-joined leg with almost no evidence cannot spike the call to poor", () => {
    const clean = [...pair(), inbound(5000, 0)];
    // 1 of 2 packets is 50% and means nothing two seconds into a leg.
    const fresh = [...pair(), inbound(1, 1)];
    expect(LOSS_MIN_PACKETS).toBeGreaterThan(2);
    const s = legs(clean, fresh);
    expect(s.lossWorstPct).toBe(0);
    expect(callStatsVerdict(s)).toBe("ok");
  });

  it("but an under-evidenced leg still counts toward the POOLED figure, so nothing is discarded", () => {
    const s = legs([...pair(), inbound(1, 1)]);
    expect(s.lossPct).toBe(50);
    expect(s.lossWorstPct).toBeNull();
  });

  it("pools audio and video WITHIN a leg — that is one peer's loss", () => {
    const s = one([
      ...pair(),
      { id: "ia", type: "inbound-rtp", kind: "audio", packetsReceived: 500, packetsLost: 0 },
      { id: "iv", type: "inbound-rtp", kind: "video", packetsReceived: 500, packetsLost: 500 },
    ]);
    expect(s.lossWorstPct).toBe(33.3);
    expect(s.lossPct).toBe(33.3);
  });
});

describe("v2.106.58 — the limitation reason is surfaced whatever it says", () => {
  const vid = (reason: string): StatEntry[] => [
    ...pair(),
    { id: "o", type: "outbound-rtp", kind: "video", frameWidth: 640, frameHeight: 360, qualityLimitationReason: reason },
  ];

  it("shows `bandwidth`, the literal starts-fine-then-degrades signal that was captured and invisible", () => {
    const s = one(vid("bandwidth"));
    expect(s.limitedBy).toBe("bandwidth");
    expect(formatCallStats(s)).toContain("bandwidth limited");
  });

  it("still shows cpu, and cpu is still the only one that makes the call POOR", () => {
    expect(formatCallStats(one(vid("cpu")))).toContain("cpu limited");
    expect(callStatsVerdict(one(vid("cpu")))).toBe("poor");
    // Bandwidth is a network condition, not a thermal one: reported, not verdicted.
    expect(callStatsVerdict(one(vid("bandwidth")))).toBe("ok");
  });

  it("says nothing at all for the healthy value", () => {
    const s = one(vid("none"));
    expect(s.limitedBy).toBeNull();
    expect(formatCallStats(s)).not.toContain("limited");
  });
});

describe("v2.106.58 — the detail line is separate from the quality line", () => {
  it("renders EMPTY when there is nothing distinctive, so an ordinary reading stays one line", () => {
    const s = one([{ id: "p", type: "candidate-pair", state: "failed" }]);
    expect(formatCallDetail(s)).toBe("");
  });

  it("carries the raw encoder name, which the thermal doc calls the pass/fail signal", () => {
    const s = one([
      ...pair(),
      { id: "o", type: "outbound-rtp", kind: "video", frameWidth: 640, frameHeight: 360, encoderImplementation: "libvpx" },
    ]);
    expect(formatCallDetail(s)).toContain("enc libvpx");
    // And line 1 still says only the BAD word, so it does not grow for the good case.
    expect(formatCallStats(s)).toContain("sw encode");
    expect(formatCallStats(s)).not.toContain("libvpx");
  });

  it("names the leg count only when there is more than one", () => {
    expect(formatCallDetail(one(pair()))).not.toContain("legs");
    expect(formatCallDetail(legs(pair(), pair()))).toContain("2 legs");
  });

  it("does NOT restate the quality numbers — the two lines answer different questions", () => {
    const s = one([...pair(), inbound(950, 50)]);
    const d = formatCallDetail(s);
    expect(d).not.toContain("ms");
    expect(d).not.toContain("% loss");
    expect(d).not.toContain("jit");
  });

  it("is a real second function rather than something appended to line 1", () => {
    // A mutation that folds the detail into formatCallStats would break the
    // truncation argument the split exists for.
    const s = one([...pair({ localProto: "udp", remoteProto: "udp" })]);
    expect(formatCallStats(s)).not.toContain("host/udp");
    expect(formatCallDetail(s)).toContain("host/udp");
  });
});

describe("v2.106.58 — the readout is wired for two lines and still rides one poller", () => {
  it("joins the two lines with a newline, and only when the detail says something", () => {
    const code = codeOnly(CLIENT);
    expect(code).toMatch(/const detail = formatCallDetail\(stats\);/);
    expect(code).toMatch(/detail \? "\\n" \+ detail : ""/);
  });

  it("writes through textContent, never innerHTML — the encoder name is a browser string and there is no reason to parse it", () => {
    const render = CLIENT.slice(
      CLIENT.indexOf("function renderCallQuality("),
      CLIENT.indexOf("async function collectCallQuality("),
    );
    expect(render.length).toBeGreaterThan(200);
    expect(render).toContain("el.textContent = text");
    expect(codeOnly(render)).not.toContain("innerHTML");
  });

  it("the chip WRAPS rather than truncating, or every field added clips the thermal words off the end", () => {
    const rule = ASSETS.slice(ASSETS.indexOf(".relay-root .call-qual{"));
    const decl = rule.slice(0, rule.indexOf("}"));
    expect(decl).toContain("white-space:pre-line");
    expect(decl).not.toContain("white-space:nowrap");
    expect(decl).not.toContain("text-overflow:ellipsis");
    expect(decl).toContain("overflow-wrap:anywhere");
  });

  it("is centred by auto margins across the FULL containing block, never by left:50% + a transform", () => {
    /* MEASURED, and the difference is 8 lines versus 4 on a phone. For an
       absolutely-positioned box with `left:50%` and auto width, the shrink-to-fit
       AVAILABLE width is only what remains to the containing block's right edge —
       half of it — so at 320px the pill came out 160px wide and 175px tall while
       `max-width:96vw` said 307px. max-width cannot widen a box the available
       space has already squeezed. Spanning the block and centring with auto
       margins measured 307px × 76px at the same width, and 520px × 60px on
       desktop, i.e. unchanged there. */
    const rule = ASSETS.slice(ASSETS.indexOf(".relay-root .call-qual{"));
    const decl = rule.slice(0, rule.indexOf("}"));
    expect(decl).toMatch(/left:0/);
    expect(decl).toMatch(/right:0/);
    expect(decl).toMatch(/margin:0 auto/);
    expect(decl).toContain("width:fit-content");
    // And NOT the half-width shape, which also drops the v2.99.54 transform hazard.
    expect(decl).not.toContain("left:50%");
    expect(decl).not.toContain("translateX(-50%)");
  });

  it("keeps every property the readout's own placement argument rests on", () => {
    const rule = ASSETS.slice(ASSETS.indexOf(".relay-root .call-qual{"));
    const decl = rule.slice(0, rule.indexOf("}"));
    // v2.105.21: out of flow so it can never become a flex item of .controls and
    // push a control chip off a 320px screen; not hit-testable over hang-up; and no
    // backdrop-filter over live video.
    expect(decl).toContain("position:absolute");
    expect(decl).toContain("pointer-events:none");
    expect(decl).not.toContain("backdrop-filter");
  });

  it("adds NO second poller — it still rides the 2s sampleStats tick", () => {
    const code = codeOnly(CLIENT);
    expect(code).toMatch(/void collectCallQuality\(\);/);
    // Exactly one interval arms the stats sampler; the readout arms none of its own.
    expect((code.match(/setInterval\(sampleStats/g) || []).length).toBe(1);
    const collect = code.slice(
      code.indexOf("async function collectCallQuality("),
      code.indexOf("function toggleCallStats("),
    );
    expect(collect.length).toBeGreaterThan(300);
    expect(collect).not.toContain("setInterval");
    expect(collect).not.toContain("setTimeout");
  });

  it("logs the three thermal fields to the debug log ON CHANGE, not every tick", () => {
    const collect = codeOnly(CLIENT).slice(
      codeOnly(CLIENT).indexOf("async function collectCallQuality("),
      codeOnly(CLIENT).indexOf("function toggleCallStats("),
    );
    expect(collect).toMatch(/diag\(`enc=/);
    expect(collect).toContain("limited=");
    expect(collect).toContain("fps=");
    // Guarded on a signature, or a 2s poller floods the buffer.
    expect(collect).toMatch(/if \(sig !== qualLastSig\)/);
  });
});

describe("v2.106.58 — the aggregation rules are declared, not scattered", () => {
  it("ranks candidate types and protocols in ONE table each, so the order is reviewable", () => {
    const code = codeOnly(STATS);
    expect(code).toMatch(/const CANDIDATE_RANK[^=]*=\s*\{[^}]*relay:\s*3/);
    expect(code).toMatch(/const PROTOCOL_RANK[^=]*=\s*\{[^}]*udp:\s*0/);
    // One reduction helper, so "worst-case" cannot be spelled two ways.
    expect((code.match(/worseOf\(/g) || []).length).toBeGreaterThanOrEqual(4);
  });

  it("has no second relay rule — `path` is derived and `anyRelay` is gone", () => {
    const code = codeOnly(STATS);
    expect(code).not.toContain("anyRelay");
    expect(code).toMatch(/path:\s*!sawPair \? "unknown" : candidate === "relay"/);
  });
});
