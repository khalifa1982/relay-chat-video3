/**
 * v2.106.56 — WHERE the video is encoded, and what else is burning the CPU
 * during a call.
 *
 * Owner report: the phone becomes very hot after 20–30 minutes of a call, which is
 * very likely also the long-standing "video degrades mid-call" complaint — heat →
 * thermal throttling → the encoder starves → the picture falls apart. The servers
 * were exonerated with measurements in earlier releases; the device was the
 * suspect, and this is the device-side cost.
 *
 * THE AUDIT CHANGED THE SCOPE, so what these tests cover is narrower than the
 * report asked for and the reasons are recorded beside each one. Three of the five
 * items in the owner's own doc were ALREADY true (a single encoding per sender,
 * voice mode opening no camera, contentHint + degradationPreference), and its
 * headline fix was written against a mediasoup client that does not exist yet —
 * every call today is the MESH. So the codec preference is applied where the calls
 * actually are.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { summarizeStats, formatCallStats, callQualityTone, callStatsVerdict, isSoftwareEncoder, type StatEntry } from "./callStats";

const root = resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");
/** Comment SPANS stripped — this file's own prose names the very patterns it bans. */
const codeOnly = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

const CLIENT = read("client/src/lib/relayClient.ts");
const CODE = codeOnly(CLIENT);
const BG = read("client/src/lib/relayBackground.ts");
const STATS = read("client/src/lib/callStats.ts");

const NOW = 1_000_000;
/** `summarizeStats` takes one array PER LEG, so a single leg is a nested array. */
const sum = (e: StatEntry[]) => summarizeStats([e], { nowMs: NOW }).stats;
/** Two separate legs — used where the worst-case-across-legs rule is the property. */
const sumLegs = (...legs: StatEntry[][]) => summarizeStats(legs, { nowMs: NOW }).stats;

describe("v2.106.56 — H.264 is preferred so the phone encodes in hardware", () => {
  it("the preference is applied on BOTH sides of the negotiation", () => {
    /* The OFFERER's codec order is what an answerer normally adopts, so pinning
       only our own offers would leave the case that actually burns the phone: a
       Chrome desktop dialling an iPhone. MEASURED in this repo's Chromium — a
       default offer lists VP8 first — so the answerer half is load-bearing. */
    expect(CODE).toMatch(/function preferHardwareVideoCodec\(pc: RTCPeerConnection\)/);
    /* Offerer: inside createPeer, and the index must be ASSERTED TO EXIST first.
       A `slice(indexOf(x))` with x absent is `slice(-1)` — the LAST CHARACTER of the
       file, non-empty — so the obvious `length > 0` version of this passed with the
       call deleted. That is the v2.99.78 negative-index trap, and it survived a
       mutation here before being written this way. */
    const offAt = CODE.indexOf("preferHardwareVideoCodec(pc);");
    expect(offAt).toBeGreaterThan(0);
    // It runs before the encoder caps, i.e. while the senders are being set up.
    const capsAt = CODE.indexOf("setTimeout(applyMeshVideoCaps, 0);");
    expect(capsAt).toBeGreaterThan(offAt);
    // Answerer: before createAnswer, or the answer is built on the old order.
    const ansAt = CODE.indexOf("preferHardwareVideoCodec(peer.pc)");
    const answerAt = CODE.indexOf("await peer.pc.createAnswer()");
    expect(ansAt).toBeGreaterThan(0);
    expect(answerAt).toBeGreaterThan(0);
    expect(ansAt).toBeLessThan(answerAt);
  });

  it("it REORDERS and never RESTRICTS — every other codec survives after H.264", () => {
    /* A list containing only H.264 would fail to negotiate video at all against a
       peer that has none: a dead tile instead of a warm phone, which is worse than
       the bug. So the non-H264 codecs must be concatenated after it. */
    expect(CODE).toMatch(/\.concat\(\s*all\.filter\(c => !isH264\(c\)\)\s*\)/);
  });

  it("a build with NO H.264 is a no-op, not a throw and not an empty list", () => {
    /* MEASURED: this repo's own headless Chromium reports zero H.264 variants.
       `setCodecPreferences([])` RESETS preferences and a list missing required
       entries raises InvalidModificationError — so the absent case must return
       before touching any transceiver. */
    const body = CODE.slice(CODE.indexOf("function preferHardwareVideoCodec"));
    const end = body.indexOf("\n  function rankH264");
    const fn = body.slice(0, end > 0 ? end : 2000);
    expect(fn).toMatch(/if \(!h264\.length\) return;/);
    // …and the early return precedes the only call site that could throw.
    expect(fn.indexOf("if (!h264.length) return;"))
      .toBeLessThan(fn.indexOf("setCodecPreferences"));
    // An empty capability list is also refused up front.
    expect(fn).toMatch(/if \(!all \|\| !all\.length\) return;/);
  });

  it("baseline + packetization-mode=1 ranks first — that is what iPhone hardware encodes", () => {
    /* A high-profile H.264 entry offered first could land the phone back in
       software on the very device this exists for. */
    expect(CODE).toMatch(/42e01f/);
    expect(CODE).toMatch(/packetization-mode=1/);
    const rank = CODE.slice(CODE.indexOf("function rankH264"));
    expect(rank).toMatch(/if \(baseline && pm1\) return 0;/);
  });

  it("it can never cost us the call: every failure path is swallowed", () => {
    const fn = CODE.slice(CODE.indexOf("function preferHardwareVideoCodec"));
    // One try around the whole body, plus a per-transceiver try, because a single
    // transceiver refusing a codec set must not skip the rest.
    expect(fn.slice(0, fn.indexOf("function rankH264")).match(/try \{/g)?.length ?? 0)
      .toBeGreaterThanOrEqual(2);
  });

  it("SIMULCAST IS NOT THE PROBLEM HERE, and that is asserted rather than assumed", () => {
    /* The report expected 2–3 simultaneous encodings. That was a behaviour of the
       DELETED hosted-SFU client, whose SDK defaults simulcast on. The mesh
       publishes with plain addTrack and never supplies sendEncodings, so there is
       exactly ONE encoding — MEASURED as `encodingsPerSender: 1`. If anyone adds
       simulcast to the mesh later, this fails and they have to think about the
       phone first. */
    expect(CODE).not.toMatch(/sendEncodings/);
    expect(CODE).toMatch(/pc\.addTrack\(vtrack, sendStream\)/);
  });
});

describe("v2.106.56 — the app background stops painting behind a live call", () => {
  it("the canvas rAF returns early while the call surface is up", () => {
    /* This canvas is mounted by the app SHELL and the call UI is a fixed overlay
       over it — the shell never unmounts — so without the gate a full-screen
       animated scene composites at 30fps behind a call, invisibly, on the one
       screen where every cycle belongs to the video encoder. */
    expect(BG).toMatch(/dataset\.relayInCall === "1"\) return;/);
  });

  it("the loop is RE-ARMED before the gate, so the background resumes after the call", () => {
    /* Returning before requestAnimationFrame kills the loop permanently — the
       v2.99.67 bug — which here would mean the background never comes back. */
    const loop = BG.slice(BG.indexOf("const loop = (now: number) => {"));
    const rearm = loop.indexOf("raf = requestAnimationFrame(loop);");
    const gate = loop.indexOf("dataset.relayInCall");
    expect(rearm).toBeGreaterThan(-1);
    expect(gate).toBeGreaterThan(rearm);
  });

  it("the flag is owned by the ONE screen switcher, so it cannot drift", () => {
    /* Set at enterCallUI and cleared at a teardown, the two could disagree and
       either leak the flag — freezing the background for the session — or miss a
       path and keep painting through a call. In show() the flag cannot mean
       anything but which screen is active, and it covers the pre-connect dial
       card too, which is equally full-screen. */
    const setCount = (CODE.match(/dataset\.relayInCall = "1"/g) || []).length;
    expect(setCount).toBe(1);
    const show = CODE.slice(CODE.indexOf("const show = (s: string) =>"));
    const shownEnd = show.indexOf("const initials");
    const body = show.slice(0, shownEnd > 0 ? shownEnd : 900);
    expect(body).toMatch(/if \(s === "call"\) el\.dataset\.relayInCall = "1";/);
    expect(body).toMatch(/else delete el\.dataset\.relayInCall;/);
  });

  it("engine teardown clears it — the flag outlives the engine otherwise", () => {
    /* <html> survives this module, so a destroy while the call surface is showing
       (sign-out, route change) would freeze the background for the session. */
    const d = CODE.slice(CODE.indexOf("    destroy() {"));
    expect(d.slice(0, 600)).toMatch(/delete document\.documentElement\.dataset\.relayInCall/);
  });

  it("the audio meter already runs at 2.5fps, not 60 — asserted so it stays there", () => {
    // The report asked for ≤4fps. It is a 400ms setInterval, i.e. already met.
    expect(CODE).toMatch(/speakerSampleT = setInterval\(sampleMeshSpeakers, 400\)/);
  });
});

describe("v2.106.56 — the two thermal signals reach the readout", () => {
  const vid = (o: Partial<StatEntry>): StatEntry =>
    ({ type: "outbound-rtp", kind: "video", frameWidth: 640, frameHeight: 360, ...o }) as StatEntry;

  it("a software encoder is reported as software", () => {
    const s = sum([vid({ encoderImplementation: "libvpx" })]);
    expect(s.encoder).toBe("libvpx");
    expect(s.encoderSoftware).toBe(true);
    expect(formatCallStats(s)).toContain("sw encode");
  });

  it("a hardware encoder is reported as NOT software, and is not named in the chip", () => {
    /* Hardware is the expectation, so naming it every call is noise — the raw
       string stays on the object for the debug log and the harness. */
    const s = sum([vid({ encoderImplementation: "VideoToolbox" })]);
    expect(s.encoder).toBe("VideoToolbox");
    expect(s.encoderSoftware).toBe(false);
    expect(formatCallStats(s)).not.toContain("sw encode");
  });

  it("an UNKNOWN encoder name is not reported as software", () => {
    /* The software set is short and stable; the hardware set is open-ended and
       vendor-specific, so matching the hardware names would make every
       unrecognised value cry wolf on a healthy call. */
    expect(isSoftwareEncoder("SomeFutureVendorEncoder")).toBe(false);
    expect(isSoftwareEncoder("ExternalEncoder")).toBe(false);
    expect(isSoftwareEncoder("MediaFoundationVideoEncodeAccelerator")).toBe(false);
  });

  it("a DECORATED software name still matches — the value is not always bare", () => {
    // Chromium reports e.g. "SimulcastEncoderAdapter (libvpx, libvpx)".
    expect(isSoftwareEncoder("SimulcastEncoderAdapter (libvpx, libvpx)")).toBe(true);
    expect(isSoftwareEncoder("OpenH264")).toBe(true);
    expect(isSoftwareEncoder("LIBVPX")).toBe(true); // case-folded
  });

  it("cpu limitation is the smoking gun: surfaced, and it makes the call POOR", () => {
    /* Thermal throttling degrades the picture with a 1ms RTT and zero loss, so
       every network threshold says the call is fine while the person watches it
       fall apart. That is exactly why it gets its own verdict. */
    const s = sum([
      vid({ qualityLimitationReason: "cpu" }),
      { type: "candidate-pair", state: "succeeded", nominated: true,
        currentRoundTripTime: 0.001, localCandidateId: "L" } as StatEntry,
      { type: "local-candidate", id: "L", candidateType: "host" } as StatEntry,
    ]);
    expect(s.limitedBy).toBe("cpu");
    expect(formatCallStats(s)).toContain("cpu limited");
    expect(callStatsVerdict(s)).toBe("poor");
    expect(callQualityTone(s)).toBe("warn");
  });

  it("software encoding ALONE is not poor — a desktop doing it is healthy", () => {
    /* It is a warning about heat over TIME, not a statement about this instant. */
    const s = sum([
      vid({ encoderImplementation: "libvpx" }),
      { type: "candidate-pair", state: "succeeded", nominated: true,
        currentRoundTripTime: 0.02, localCandidateId: "L" } as StatEntry,
      { type: "local-candidate", id: "L", candidateType: "host" } as StatEntry,
    ]);
    expect(callStatsVerdict(s)).toBe("ok");
    expect(callQualityTone(s)).toBe("good");
  });

  it('"none" never shadows a real reason from another leg, and cpu outranks all', () => {
    /* SEPARATE legs, because that is the real shape: one peer connection per peer,
       and the rule is worst-case ACROSS them. */
    const s = sumLegs(
      [vid({ qualityLimitationReason: "none" })],
      [vid({ qualityLimitationReason: "bandwidth" })],
      [vid({ qualityLimitationReason: "cpu" })],
    );
    expect(s.limitedBy).toBe("cpu");
    // …and in the other arrival order too, so it is not order-dependent.
    const s2 = sumLegs(
      [vid({ qualityLimitationReason: "cpu" })],
      [vid({ qualityLimitationReason: "bandwidth" })],
      [vid({ qualityLimitationReason: "none" })],
    );
    expect(s2.limitedBy).toBe("cpu");
  });

  it("a healthy sender reports no limitation rather than the word none", () => {
    expect(sum([vid({ qualityLimitationReason: "none" })]).limitedBy).toBeNull();
  });

  it("an AUDIO leg cannot overwrite a video reading with nulls", () => {
    /* A voice outbound-rtp reports no encoder and no limitation, so folding it in
       would blank a real video reading — the shape of a bug that reads as "the
       telemetry does not work" on exactly the calls that have video. */
    /* The audio entry must CARRY values, or the `if (impl)` / `if (lim)` guards
       cover for a missing kind check and this passes either way — which is exactly
       what happened: the first version of this test survived deleting the guard. */
    const s = sum([
      vid({ encoderImplementation: "libvpx", qualityLimitationReason: "cpu" }),
      { type: "outbound-rtp", kind: "audio", bytesSent: 900,
        encoderImplementation: "AudioEncoderShouldNotCount",
        qualityLimitationReason: "bandwidth" } as StatEntry,
    ]);
    expect(s.encoder).toBe("libvpx");
    expect(s.limitedBy).toBe("cpu");
    /* And in the other order, so the video reading is not merely "the last one
       seen" — an audio leg arriving AFTER must still not overwrite it. */
    const s2 = sum([
      { type: "outbound-rtp", kind: "audio", bytesSent: 900,
        encoderImplementation: "AudioEncoderShouldNotCount" } as StatEntry,
      vid({ encoderImplementation: "VideoToolbox" }),
    ]);
    expect(s2.encoder).toBe("VideoToolbox");
  });

  it("a VOICE call reports neither — null, never a confident default", () => {
    const s = sum([{ type: "outbound-rtp", kind: "audio", bytesSent: 900 } as StatEntry]);
    expect(s.encoder).toBeNull();
    expect(s.encoderSoftware).toBeNull();
    expect(s.limitedBy).toBeNull();
    expect(formatCallStats(s)).not.toContain("sw encode");
  });

  it("both fields are read from the standard outbound-rtp, so mesh and mediasoup agree", () => {
    /* getStats is plain WebRTC. Whatever transport carries the call, these two
       fields are read the same way — which is what makes the readout survive the
       mediasoup cutover unchanged. */
    expect(STATS).toMatch(/encoderImplementation\?: string;/);
    expect(STATS).toMatch(/qualityLimitationReason\?: string;/);
  });
});

describe("v2.106.56 — what the report asked for that was ALREADY true", () => {
  it("voice mode opens no camera at all (v2.106.44)", () => {
    /* The doc asked to confirm the video:false path is the one voice really uses.
       It is: wantVideo false makes the constraint literally `video: false`, so
       there is no camera to acquire, no track to encode and no indicator to light. */
    expect(CODE).toMatch(/video: wantVideo \? \{ [^}]*\} : false/);
  });

  it("published camera tracks already carry contentHint=motion and balanced degradation", () => {
    expect(CODE).toMatch(/contentHint = "motion"/);
    expect(CODE).toMatch(/degradationPreference = "balanced"/);
  });

  it("nothing forces screen brightness — there is nothing to remove", () => {
    expect(CODE).not.toMatch(/screen\.brightness|setBrightness/);
  });
});
