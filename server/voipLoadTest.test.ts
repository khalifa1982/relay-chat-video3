/**
 * THE LOAD-TEST HARNESS — driven, not source-pinned, wherever a decision can be driven.
 *
 * This harness exists to produce a number the owner will size the fleet on, so the failure that
 * matters most is not a crash — it is a CONFIDENT WRONG NUMBER. Five such defects were found by
 * running it, and each one is pinned below so it cannot come back:
 *
 *   1. RTCP counted as delivered media (read 100.37%, would have hidden 2% real loss).
 *   2. RTX / bandwidth-probation padding counted as delivered media (read 100.89%).
 *   3. the fan-out denominator multiplied by the number of KINDS as well as participants,
 *      which on any video run halves the ratio and declares a knee of zero rooms.
 *   4. `ru_utime` treated as microseconds when mediasoup reports MILLISECONDS, so every step
 *      printed `node 0.00 core` while the box was saturating.
 *   5. the per-consumer cost measured AT the knee, where CPU has already pegged, understating
 *      it by a third.
 *
 * The safety gate and the step verdict are pure and are therefore DRIVEN. Everything that needs
 * mediasoup, a socket or a child process is asserted on source, and the reason that split exists
 * is itself the first thing asserted — see `loadtestCore.mjs`'s own header.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { codeOnly } from "./testing/codeOnly";
import {
  assertSafeToRun,
  buildRtpPacket,
  judgeStep,
  MAX_PORT,
  MEDIA_CODECS,
  MIN_PORT,
  packetsPerSecond,
  parseArgs,
} from "../voip-node/loadtestCore.mjs";

const CORE_SRC = readFileSync("voip-node/loadtestCore.mjs", "utf8");
const HARNESS_SRC = readFileSync("voip-node/loadtest.mjs", "utf8");
const CORE = codeOnly(CORE_SRC);
const HARNESS = codeOnly(HARNESS_SRC);
const AGENT = readFileSync("voip-node/index.js", "utf8");

const NODE = { isMediaNode: true, drainFile: "/etc/relay-voip/draining", cores: 2 };

describe("the safety gate refuses to saturate a node that is carrying calls", () => {
  it("a media node that is NOT draining is refused, and told how to drain", () => {
    const v = assertSafeToRun({ ...NODE, draining: false, agentActive: false });
    expect(v.ok).toBe(false);
    expect(v.notes.join(" ")).toMatch(/REFUSED/);
    // The refusal has to be actionable: an operator reading it must learn the next command.
    expect(v.notes.join(" ")).toMatch(/touch \/etc\/relay-voip\/draining/);
  });

  it("a DRAINING media node whose agent is still running is refused", () => {
    /* Draining and stopped answer DIFFERENT questions and both are required: draining stops the
       app assigning NEW rooms here, a stopped agent proves there are no CURRENT ones and frees
       the CPU this measures. Accepting on `draining` alone would saturate a box still serving
       every call that had not yet ended. */
    const v = assertSafeToRun({ ...NODE, draining: true, agentActive: true });
    expect(v.ok).toBe(false);
    expect(v.notes.join(" ")).toMatch(/systemctl stop relay-voip-agent/);
  });

  it("an UNKNOWN agent state is refused — the gate fails CLOSED", () => {
    /* The opposite direction from the agent's own drain check, deliberately: the agent guessing
       wrong costs capacity, this guessing wrong costs somebody's live call. `systemctl is-active`
       can fail for reasons that are not "stopped", and none of them are evidence of safety. */
    const v = assertSafeToRun({ ...NODE, draining: true, agentActive: null });
    expect(v.ok).toBe(false);
    expect(v.notes.join(" ")).toMatch(/unknown state/);
  });

  it("both conditions met → allowed", () => {
    const v = assertSafeToRun({ ...NODE, draining: true, agentActive: false });
    expect(v.ok).toBe(true);
  });

  it("a box that is NOT a media node is allowed, and the report SAYS so", () => {
    /* Keyed on evidence the HOST carries (v2.106.33's reasoning), so the gate is vacuous rather
       than overridden on a dev box — there are no live calls there to protect. The label is the
       load-bearing half: without it a 4-core sandbox number reads as a fleet number. */
    const v = assertSafeToRun({ ...NODE, isMediaNode: false, draining: false, agentActive: true });
    expect(v.ok).toBe(true);
    expect(v.notes.join(" ")).toMatch(/NOT A MEDIA NODE/);
    expect(v.notes.join(" ")).toMatch(/not a fleet measurement/i);
  });

  it("there is NO override flag anywhere — the gate cannot be argued with", () => {
    // The whole point of the gate is that somebody in a hurry cannot switch it off.
    expect(CORE).not.toMatch(/--force|allowUnsafe|skipGate|ignoreDrain/i);
    expect(HARNESS).not.toMatch(/--force|allowUnsafe|skipGate|ignoreDrain/i);
    // …and the gate's verdict is what decides, rather than being advisory.
    expect(HARNESS).toMatch(/if \(!gate\.ok\)/);
  });

  it("the run is a DRY RUN by default", () => {
    // A mis-dispatched measurement should print a plan, not saturate a box.
    expect(parseArgs([]).run).toBe(false);
    expect(parseArgs(["--run"]).run).toBe(true);
  });
});

describe("the step verdict cannot report a knee the measurement did not find", () => {
  const base = { rooms: 10, fanout: 5, minRatio: 0.98 };

  it("full delivery is ok", () => {
    const s = judgeStep({ ...base, sent: 1000, scheduled: 1000, received: 5000 });
    expect(s.verdict).toBe("ok");
    expect(s.ratio).toBeCloseTo(1, 5);
  });

  it("delivery below the threshold is degraded", () => {
    const s = judgeStep({ ...base, sent: 1000, scheduled: 1000, received: 4700 });
    expect(s.verdict).toBe("degraded");
  });

  it("a generator that fell behind VOIDS the step, even with perfect delivery", () => {
    /* THE MOST IMPORTANT ASSERTION IN THIS FILE. The generator shares the box with the thing
       under test, so when IT saturates first its own limit reads as the node's — and the
       delivery ratio then looks FINE, because everything it managed to send did arrive.
       Reporting "ok" there would attribute the harness's ceiling to the fleet. */
    const s = judgeStep({ ...base, sent: 800, scheduled: 1000, received: 4000 });
    expect(s.ratio).toBeCloseTo(1, 5); // delivery is perfect…
    expect(s.verdict).toBe("void"); // …and the step is still not a result.
    expect(s.why).toMatch(/generator/);
  });

  it("void wins over degraded too — a starved generator explains either reading", () => {
    const s = judgeStep({ ...base, sent: 500, scheduled: 1000, received: 100 });
    expect(s.verdict).toBe("void");
  });

  it("nothing sent is NOT silently ok", () => {
    // A step that measured nothing must not read as a clean step; `ratio` of 0 is degraded.
    const s = judgeStep({ ...base, sent: 0, scheduled: 0, received: 0 });
    expect(s.verdict).toBe("degraded");
  });

  it("the whole run reports NO VERDICT when any step was void", () => {
    expect(HARNESS).toMatch(/verdict === "void"/);
    expect(HARNESS).toMatch(/NO VERDICT/);
    // …and exits non-zero, so a caller reading the marker cannot mistake it for a result.
    expect(HARNESS).toMatch(/LOADTEST_EXIT=91/);
  });
});

describe("the RTP the generator sends is RTP a router will forward", () => {
  const args = {
    payloadType: 100,
    seq: 0x1234,
    timestamp: 0xdeadbeef,
    ssrc: 0x30000001,
    marker: false,
    kind: "audio" as const,
    firstOfFrame: true,
    bytes: 80,
  };

  it("carries a well-formed RTP header", () => {
    const p = buildRtpPacket(args);
    expect(p[0]).toBe(0x80); // V=2, no padding, no extension, no CSRCs
    expect(p[1] & 0x7f).toBe(100);
    expect(p.readUInt16BE(2)).toBe(0x1234);
    expect(p.readUInt32BE(4)).toBe(0xdeadbeef);
    expect(p.readUInt32BE(8)).toBe(0x30000001);
    expect(p.length).toBe(12 + 80);
  });

  it("sets the marker bit without corrupting the payload type", () => {
    const p = buildRtpPacket({ ...args, marker: true });
    expect(p[1] & 0x80).toBe(0x80);
    expect(p[1] & 0x7f).toBe(100);
  });

  it("masks a payload type that would overflow into the marker bit", () => {
    // 0x80 in the PT position would set the marker on a packet that never asked for it.
    const p = buildRtpPacket({ ...args, payloadType: 0x80 | 96, marker: false });
    expect(p[1] & 0x80).toBe(0);
    expect(p[1] & 0x7f).toBe(96);
  });

  it("wraps the sequence number rather than writing past 16 bits", () => {
    const p = buildRtpPacket({ ...args, seq: 0x1_0002 });
    expect(p.readUInt16BE(2)).toBe(2);
  });

  it("a VP8 packet starting a frame carries S=1 and a KEYFRAME payload header", () => {
    /* mediasoup PARSES the VP8 payload descriptor — it is not opaque to the router — and a
       consumer that never sees a keyframe can legitimately forward nothing, which would read as
       100% loss rather than as a harness fault. So every frame is marked as a keyframe: `P=0`
       plus the mandatory `9d 01 2a` start code. */
    const p = buildRtpPacket({ ...args, kind: "video", firstOfFrame: true, bytes: 1100 });
    expect(p[12] & 0x10).toBe(0x10); // S bit — start of partition
    expect(p[13] & 0x01).toBe(0); // P=0 → keyframe
    expect([p[16], p[17], p[18]]).toEqual([0x9d, 0x01, 0x2a]);
  });

  it("a VP8 continuation packet does NOT claim to start a frame", () => {
    const p = buildRtpPacket({ ...args, kind: "video", firstOfFrame: false, bytes: 1100 });
    expect(p[12] & 0x10).toBe(0);
  });

  it("packet rates match the codec profile the agent negotiates", () => {
    expect(packetsPerSecond("audio")).toBe(50); // 20 ms ptime, as the agent's Opus parameters say
    expect(packetsPerSecond("video")).toBe(60); // 30 fps × 2 packets/frame
  });
});

describe("the measurement counts forwarded media and nothing else", () => {
  it("the sink admits only an exact (ssrc, payloadType) pair", () => {
    /* Two classes of datagram arrive on a muxed port that are NOT forwarded media, and each
       inflated the ratio ABOVE 100% in a real run: RTCP (100.37%) and RTX/probation padding the
       router generates itself (100.89%). Above 100% is not a cosmetic error — at a 0.98
       threshold it hides 2% of real loss. Filtering by RFC 5761's payload-type range alone
       catches only the first, which is why the allow-list is exact. */
    expect(HARNESS).toMatch(/expect\.has\(key\)/);
    expect(HARNESS).toMatch(/readUInt32BE\(8\)/); // ssrc
    expect(HARNESS).toMatch(/msg\[1\] & 0x7f/); // payload type
  });

  it("the allow-list is built from the CONSUMER's own ssrc, not the producer's", () => {
    // The router rewrites the SSRC on the way out, so keying on the producer's admits nothing.
    expect(HARNESS).toMatch(/consumer\.rtpParameters\.encodings\?\.\[0\]/);
    expect(HARNESS).toMatch(/consumer\.rtpParameters\.codecs\?\.\[0\]/);
  });

  it("the fan-out denominator is participants-1 and is NOT multiplied by kinds", () => {
    /* `sent` already counts every packet of every kind, and each packet reaches only the other
       participants' consumers OF ITS OWN KIND. Multiplying by kinds as well was the first
       version of this line: on any video run it doubled the denominator, reported ~50% delivery
       at the first step, and declared a knee of zero rooms with total confidence. */
    expect(HARNESS).toMatch(/fanout: participants - 1/);
    expect(HARNESS).toMatch(/fanout: rooms\[0\]\.fanout,/);
    expect(HARNESS).not.toMatch(/fanout: rooms\[0\]\.fanout \* kinds\.length/);
  });

  it("the window is airtight: the sender is FROZEN, then the wire drains", () => {
    /* With the generator still running, packets sent between the closing sample and the read of
       the sinks count as delivered but not as sent, and packets sent just before it have not
       arrived. Both were measured (100.89% and 99.55%). Freezing then draining removes them, so
       a ratio below 100% means real loss rather than a boundary. */
    expect(HARNESS).toMatch(/pauseAndReport\(\)/);
    expect(HARNESS).toMatch(/DRAIN_MS/);
    const pause = HARNESS.indexOf("const after = await pauseAndReport()");
    const recv = HARNESS.indexOf("const recvAfter =");
    expect(pause).toBeGreaterThan(-1);
    expect(recv).toBeGreaterThan(pause);
    expect(HARNESS).toMatch(/msg\.t === "pause"/);
  });

  it("node CPU is read in MILLISECONDS, the unit mediasoup actually reports", () => {
    /* `ru_utime`/`ru_stime` are ms (mediasoup's own declarations); `process.cpuUsage()` is µs.
       Treating both as µs understated node CPU 1000× and printed `node 0.00 core` through
       saturation — a harness reporting an idle node is the one reading that makes a knee
       unfindable. The two lines must therefore scale DIFFERENTLY. */
    expect(HARNESS).toMatch(/nodeCpuCores = \(cpuAfter - cpuBefore\) \/ wall/);
    expect(HARNESS).not.toMatch(/nodeCpuCores = \(cpuAfter - cpuBefore\) \/ 1000 \/ wall/);
    expect(HARNESS).toMatch(/before\.cpu\.system\) \/ 1000 \/ wall/);
  });

  it("the per-consumer cost is fitted in the LINEAR region, never at the knee", () => {
    /* Once a worker pegs at 1.00 core the CPU reading stops rising while consumers keep being
       added, so `cpu / consumers` FALLS: 0.00035 at the knee against 0.00046 unsaturated, a
       third low. Taking the slope between two unsaturated steps also cancels any fixed
       per-room overhead. */
    expect(HARNESS).toMatch(/nodeCpuCores < 0\.9 \* workerCount/);
    expect(HARNESS).toMatch(/b\.nodeCpuCores - a\.nodeCpuCores\) \/ \(b\.consumers - a\.consumers/);
  });
});

describe("the harness measures the router the fleet actually runs", () => {
  it("its codec list is identical to the agent's", () => {
    /* A divergence here makes the measurement describe a router the fleet does not run — the
       v2.99.71 two-implementations class. Compared by VALUE against the agent's source rather
       than by reading the comment that claims they match. */
    const block = AGENT.slice(AGENT.indexOf("const MEDIA_CODECS = ["));
    const agentCodecs = block.slice(0, block.indexOf("\n];") + 3);
    const strip = (s: string) => s.replace(/\/\/[^\n]*/g, "").replace(/\s+/g, "");
    expect(strip(agentCodecs)).toContain(strip("mimeType: \"audio/opus\""));
    for (const c of MEDIA_CODECS as { mimeType: string }[]) {
      expect(strip(agentCodecs), `${c.mimeType} is not in the agent's list`).toContain(
        strip(`mimeType: "${c.mimeType}"`),
      );
    }
    // Same count, so the harness cannot be missing one the agent offers.
    expect((agentCodecs.match(/mimeType:/g) ?? []).length).toBe(MEDIA_CODECS.length);
  });

  it("it starts its OWN workers rather than driving the agent's", () => {
    /* Two reasons and the second is the point: the API would add an HMAC verify plus a JSON
       round trip per operation to what is being measured, and the agent's workers are the ones
       serving real calls. */
    expect(HARNESS).toMatch(/mediasoup\.createWorker/);
    expect(HARNESS).not.toMatch(/callNode|VOIP_NODE_SECRET|4443/);
  });

  it("egress really encrypts — SRTP, not plain RTP out", () => {
    // Per-consumer SRTP is a large part of what an SFU spends CPU on. A harness without it
    // reports a knee that is optimistic by an unknown margin.
    expect(HARNESS).toMatch(/enableSrtp: true/);
    expect(HARNESS).toMatch(/AES_CM_128_HMAC_SHA1_80/);
  });

  it("consumers for one participant share ONE egress transport", () => {
    // How a real participant works. One transport per consumer would multiply the socket and
    // crypto-context count and measure a shape the app never creates.
    expect((HARNESS.match(/createPlainTransport/g) ?? []).length).toBe(2);
  });
});

describe("the harness cannot collide with the agent, or with the OS", () => {
  it("its port pool is clear of the agent's RTC range", () => {
    // The agent uses 40000-49999. A harness left running must not be able to take one.
    expect(MIN_PORT).toBeGreaterThan(49999);
    expect(MAX_PORT).toBeGreaterThan(MIN_PORT);
    expect(MAX_PORT).toBeLessThanOrEqual(65535);
  });

  it("and clear of Linux's default ephemeral range", () => {
    /* The first pool was 50000-59998, INSIDE the 32768-60999 default — so a sink socket bound
       with `bind(0)` was handed a port the explicit allocator later reached, and the run died
       with EADDRINUSE half-built. */
    expect(MIN_PORT).toBeGreaterThan(60999);
  });

  it("a taken port advances the pool instead of failing the run", () => {
    // No pool can be ASSUMED free when other processes share the box.
    expect(HARNESS).toMatch(/onFreePort/);
    expect(CORE + HARNESS).toMatch(/EADDRINUSE/);
  });

  it("one port per transport, because rtcpMux binds exactly one", () => {
    // Reserving a second "just in case" halved the pool and killed a voice sweep at ~96 rooms
    // with four good steps already measured.
    expect(HARNESS + CORE).toMatch(/nextPort \+= 1/);
    expect(HARNESS + CORE).not.toMatch(/nextPort \+= 2/);
  });

  it("a build failure ENDS the sweep rather than discarding it", () => {
    // A partial sweep still contains a knee if one was reached.
    expect(HARNESS).toMatch(/buildStoppedAt/);
  });

  it("a dead generator is reported as a dead generator", () => {
    /* Without this the parent's next `send` throws ERR_IPC_CHANNEL_CLOSED, which says the
       channel closed and never that the child threw — the child's own ReferenceError (a missing
       import, once) reached no log at all. */
    expect(HARNESS).toMatch(/generator died before ready|genDead/);
  });
});

describe("the pure half imports nothing, and that is what makes it testable", () => {
  it("`loadtestCore.mjs` has no imports at all", () => {
    /* THE SPLIT IS A HARD REQUIREMENT, NOT A STYLE CHOICE. `voip-node` is not a pnpm workspace
       member, so CI's root install never fetches mediasoup — a test importing the harness would
       pass wherever somebody had built the worker and fail in CI. It is also the v2.99.71 trap:
       importing `turn-check.mjs` ran a health check and called `process.exit`, killing the
       runner. Same reason `record.mjs` is split from `index.js`. */
    expect(CORE).not.toMatch(/^\s*import\s/m);
    expect(CORE).not.toMatch(/require\(/);
    expect(CORE).not.toMatch(/process\.exit/);
    expect(CORE).not.toMatch(/createSocket|createServer|listen\(/);
  });

  it("and the half that DOES need mediasoup is the other file", () => {
    // The strip must be doing work rather than hiding a defect.
    expect(HARNESS).toMatch(/from "mediasoup"/);
    expect(HARNESS).toMatch(/from "\.\/loadtestCore\.mjs"/);
  });

  it("every exit path prints the marker", () => {
    /* A wrapper or a pipeline can mask a non-zero exit (v2.99.46), so the caller reads the
       printed marker rather than the status — and a path without one reads as silence. */
    const codes = [...HARNESS.matchAll(/LOADTEST_EXIT=(\d+)/g)].map((m) => m[1]);
    expect(new Set(codes)).toEqual(new Set(["0", "90", "91", "92", "93"]));
    // The gate refusal, the void run, the no-knee run and the crash each have their own code,
    // so a caller can tell "unsafe" from "inconclusive" from "broken".
    expect(codes.length).toBeGreaterThanOrEqual(5);
  });

  it("the deploy parses it before a node is ever asked to run it", () => {
    const sh = readFileSync("voip-node/deploy-remote.sh", "utf8");
    const loop = sh.slice(sh.indexOf("for f in index.js"));
    expect(loop.slice(0, 200)).toContain("loadtest.mjs");
    expect(loop.slice(0, 200)).toContain("loadtestCore.mjs");
  });
});

describe("argument validation refuses a value that would produce a wrong number", () => {
  it("rejects an unknown flag rather than ignoring it", () => {
    // A typo'd flag silently ignored means measuring something other than what was asked for.
    expect(() => parseArgs(["--particpants=6"])).toThrow(/unrecognised/);
  });

  it("rejects a kind that is not voice or video", () => {
    expect(() => parseArgs(["--kind=audio"])).toThrow(/voice\|video/);
  });

  it("rejects a non-integer or out-of-range participant count", () => {
    expect(() => parseArgs(["--participants=1"])).toThrow();
    expect(() => parseArgs(["--participants=2.5"])).toThrow();
  });

  it("rejects a ratio outside (0,1]", () => {
    expect(() => parseArgs(["--min-ratio=0"])).toThrow();
    expect(() => parseArgs(["--min-ratio=1.2"])).toThrow();
    expect(parseArgs(["--min-ratio=0.98"]).minRatio).toBe(0.98);
  });

  it("--workers measures ONE core directly rather than dividing a whole-node knee", () => {
    /* The owner's formula is per core. Dividing a whole-node knee assumes the cores scale
       linearly and that nothing else competed; measuring a single worker assumes neither. */
    expect(parseArgs(["--workers=1"]).workers).toBe(1);
    expect(parseArgs([]).workers).toBe(0); // 0 = one per core, as the agent does
    expect(HARNESS).toMatch(/const workerCount = args\.workers \|\| env\.cores/);
    // …and the per-core division uses the WORKER count, which is what carried the rooms.
    expect(HARNESS).toMatch(/knee \/ workerCount/);
  });
});
