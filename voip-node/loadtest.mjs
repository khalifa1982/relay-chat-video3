/**
 * MEDIA-NODE LOAD TEST — find the router-per-node degradation knee.
 *
 * The owner's ask: *"drive one node to the degradation knee for voice rooms and video rooms
 * separately, then cap = knee × cores × 0.8."* `NODE_MAX_ROUTERS` is 40 today and that number
 * was CHOSEN, not measured (v2.106.54 said so in place). This produces the measurement.
 *
 * ── WHY IT DOES NOT GO THROUGH THE AGENT'S HTTP API ──────────────────────────────────────
 * Two reasons, and the second is the important one. The API adds an HMAC verify plus a JSON
 * round trip per operation, which would be measured as router cost. And the agent's workers
 * are the ones serving real calls — driving THOSE to saturation is the thing this must never
 * do. So the harness imports mediasoup directly and starts its own workers, mirroring the
 * agent's shape (one worker per core, one router per room, round-robin) so what it measures
 * is what the agent would experience.
 *
 * ── THE KNEE IS AN OUTCOME, NOT A CPU READING ────────────────────────────────────────────
 * A CPU percentage does not say whether calls still work; it says how busy a box is. So the
 * primary signal is DELIVERY: packets arriving at the sinks divided by packets the generator
 * actually sent, fanned out by the room's own consumer count. When a router can no longer
 * keep up, that ratio falls — that is the degradation, in the units a user would notice.
 * Per-worker CPU (`getResourceUsage`, µs) rides alongside as the EXPLANATION, not the verdict.
 *
 * ── PLAIN RTP IN, SRTP OUT, OVER REAL UDP ────────────────────────────────────────────────
 * Ingest is a comedia PlainTransport (auto-detects the generator from the first packet, which
 * is exactly a receive-only feed). Egress is a PlainTransport with `enableSrtp`, so the router
 * does real SRTP encryption per consumer — which is a large part of what an SFU actually
 * spends CPU on. A DirectTransport harness measures neither the socket path nor the crypto,
 * so its number would be optimistic by an unknown margin.
 *
 * The synthetic payloads are legitimate for THIS measurement and not for others: a router
 * never decodes media, it rewrites headers, reads the payload descriptor and re-encrypts. So
 * bytes that carry a valid RTP header and a plausible VP8 descriptor cost the router the same
 * as real ones. What this therefore does NOT measure: encode/decode, real keyframe-request
 * behaviour, bandwidth estimation, or anything a browser does.
 *
 * ── THE GENERATOR IS A SEPARATE PROCESS, AND IT CAN VOID THE RESULT ──────────────────────
 * It shares this box with the thing under test, so if IT saturates first, its own limit reads
 * as the node's. It reports SCHEDULED vs SENT — a direct signal, better than a CPU percentage —
 * and the parent REFUSES a verdict for any step where the generator fell behind its own clock.
 *
 * Stated plainly, because it bounds what the number is worth: because the generator shares the
 * box, every knee measured here is a FLOOR rather than the true knee. A true measurement needs
 * a second box generating. The error is in the safe direction, and `× 0.8` compounds that.
 *
 * ── THE SAFETY GATE ─────────────────────────────────────────────────────────────────────
 * On a real media node this REFUSES unless the node is draining AND its agent is stopped, and
 * there is deliberately no override flag. Draining stops the app assigning NEW rooms here; a
 * stopped agent proves there are no CURRENT ones. Both are needed — see `assertSafeToRun`.
 *
 * The gate keys on `/opt/relay-voip` existing, which is evidence the HOST carries (the
 * v2.106.33 reasoning): a box without it is not a media node, so there are no live calls to
 * protect and the gate is vacuous rather than overridden. Such a run is LABELLED in the
 * report, because a dev-box number must never be mistaken for a fleet number.
 *
 *   Usage (on a drained node, agent stopped):
 *     node loadtest.mjs --kind=voice --participants=2 --run
 *     node loadtest.mjs --kind=video --participants=4 --run
 *
 *   Dry run is the DEFAULT: without `--run` it checks the gate, prints the plan and the
 *   environment, and starts nothing.
 *
 * Every path prints `LOADTEST_EXIT=<n>` as its last line, because a wrapper or a pipeline can
 * mask a non-zero exit (v2.99.46) and the caller must read the marker rather than the status.
 */
import * as mediasoup from "mediasoup";
import { createSocket } from "node:dgram";
import { execFileSync } from "node:child_process";
import { fork } from "node:child_process";
import { existsSync } from "node:fs";
import { cpus } from "node:os";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  AUDIO_BYTES,
  AUDIO_PTIME_MS,
  assertSafeToRun,
  buildRtpPacket,
  HOST,
  judgeStep,
  MAX_PORT,
  MEDIA_CODECS,
  MIN_PORT,
  packetsPerSecond,
  parseArgs,
  VIDEO_BYTES,
  VIDEO_PKTS_PER_FRAME,
  VIDEO_FPS,
} from "./loadtestCore.mjs";

const SELF = fileURLToPath(import.meta.url);

function readEnvironment() {
  const drainFile = process.env.VOIP_DRAIN_FILE || "/etc/relay-voip/draining";
  let agentActive = null; // null = could not tell, which the gate treats as unsafe.
  try {
    // `is-active` PRINTS its answer and exits non-zero for anything but active, so the exit
    // code alone is not the reading (v2.106.73 shipped exactly that bug).
    const out = execFileSync("systemctl", ["is-active", "relay-voip-agent"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    agentActive = out.trim() === "active";
  } catch (e) {
    const out = String(e?.stdout ?? "").trim();
    if (out) agentActive = out === "active";
  }
  return {
    isMediaNode: existsSync("/opt/relay-voip"),
    draining: existsSync(drainFile),
    drainFile,
    agentActive,
    cores: Math.max(1, cpus().length),
    model: cpus()[0]?.model ?? "unknown",
  };
}

// ── RTP ──────────────────────────────────────────────────────────────────────────
// ── the generator (child process) ────────────────────────────────────────────────
function runGenerator() {
  /** @type {{port:number, ssrc:number, payloadType:number, kind:string}[]} */
  let streams = [];
  let timer = null;
  let startedAt = 0;
  let sent = 0;
  let scheduled = 0;
  const sock = createSocket("udp4");
  const state = new Map();

  const TICK_MS = 10;

  function tick() {
    const now = Date.now();
    const elapsed = now - startedAt;
    for (const s of streams) {
      const st = state.get(s.ssrc);
      const pps = packetsPerSecond(s.kind);
      const want = Math.floor((elapsed / 1000) * pps);
      scheduled += Math.max(0, want - st.emitted);
      while (st.emitted < want) {
        const firstOfFrame = s.kind === "audio" ? true : st.emitted % VIDEO_PKTS_PER_FRAME === 0;
        const marker = s.kind === "audio" ? false : st.emitted % VIDEO_PKTS_PER_FRAME === VIDEO_PKTS_PER_FRAME - 1;
        const pkt = buildRtpPacket({
          payloadType: s.payloadType,
          seq: st.seq,
          timestamp: st.ts,
          ssrc: s.ssrc,
          marker,
          kind: s.kind,
          firstOfFrame,
          bytes: s.kind === "audio" ? AUDIO_BYTES : VIDEO_BYTES,
        });
        sock.send(pkt, s.port, HOST);
        sent++;
        st.seq = (st.seq + 1) & 0xffff;
        st.emitted++;
        if (s.kind === "audio") st.ts = (st.ts + 48000 / (1000 / AUDIO_PTIME_MS)) >>> 0;
        else if (marker) st.ts = (st.ts + 90000 / VIDEO_FPS) >>> 0;
      }
    }
  }

  process.on("message", (msg) => {
    if (msg.t === "streams") {
      for (const s of msg.streams) {
        if (!state.has(s.ssrc)) state.set(s.ssrc, { seq: 1, ts: 1000, emitted: 0 });
      }
      streams = msg.streams;
      /* The clock restarts whenever the stream set changes, and every stream's own emitted
         counter restarts with it. Otherwise a stream added at step 5 would be judged against
         an elapsed time it was never running for, and every later step would report a
         generator that had "fallen behind" when it had not. */
      startedAt = Date.now();
      sent = 0;
      scheduled = 0;
      for (const st of state.values()) st.emitted = 0;
      if (!timer) timer = setInterval(tick, TICK_MS);
    } else if (msg.t === "sample") {
      const cpu = process.cpuUsage();
      process.send({ t: "sample", id: msg.id, sent, scheduled, cpu, streams: streams.length });
    } else if (msg.t === "pause") {
      /* STOP EMITTING, THEN report. This is what makes the measurement window airtight: with
         the generator still running, packets sent between the parent's sample and its read of
         the sinks are counted as delivered but not as sent (the first video run read 100.89%),
         and packets sent just before the closing sample have not arrived yet (99.55%). Freezing
         the sender and then letting the wire drain removes both, so a ratio below 100% means
         real loss rather than a boundary. */
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      const cpu = process.cpuUsage();
      process.send({ t: "sample", id: msg.id, sent, scheduled, cpu, streams: streams.length });
    } else if (msg.t === "stop") {
      if (timer) clearInterval(timer);
      sock.close();
      process.exit(0);
    }
  });
  process.send({ t: "ready" });
}

// ── the node under test ──────────────────────────────────────────────────────────
async function startWorkers(cores) {
  const workers = [];
  for (let i = 0; i < cores; i++) {
    const w = await mediasoup.createWorker({
      rtcMinPort: MIN_PORT,
      rtcMaxPort: MAX_PORT,
      logLevel: "error",
    });
    w.on("died", () => {
      console.error(`[loadtest] worker ${w.pid} died — the measurement is void`);
      process.exit(1);
    });
    workers.push(w);
  }
  return workers;
}

function codecFor(router, mimeType) {
  const c = router.rtpCapabilities.codecs.find((x) => x.mimeType.toLowerCase() === mimeType.toLowerCase());
  if (!c) throw new Error(`router does not offer ${mimeType}`);
  return c;
}

let nextSsrc = 0x30000000;
let nextPort = MIN_PORT;
/* ONE port per transport, because `rtcpMux` is on and mediasoup therefore binds exactly one.
   Reserving a second "in case" halved the pool and made a voice sweep die at ~96 rooms with
   four good steps already measured. */
function allocPort() {
  const p = nextPort;
  nextPort += 1;
  if (nextPort > MAX_PORT) {
    throw new Error(
      `out of loopback ports (${MIN_PORT}-${MAX_PORT}); ` +
        "lower --max-rooms or widen the pool with LOADTEST_MIN_PORT/LOADTEST_MAX_PORT",
    );
  }
  return p;
}

/**
 * Try `fn(port)` down the pool until one binds.
 *
 * A port pool cannot be assumed free: anything else on the box may already hold a port in the
 * range, and on a real media node that is likelier than here. Retrying is the difference
 * between a measurement and a run that dies half-built — and it must NOT swallow other
 * failures, so only an address-in-use error advances the pool.
 */
async function onFreePort(fn, tries = 40) {
  let last;
  for (let i = 0; i < tries; i++) {
    const port = allocPort();
    try {
      return await fn(port);
    } catch (e) {
      last = e;
      if (!/address already in use|EADDRINUSE/i.test(String(e?.message ?? e))) throw e;
    }
  }
  throw new Error(`no free port after ${tries} attempts: ${last?.message ?? last}`);
}

/**
 * Build one room: P participants, each producing and each consuming the other P-1.
 *
 * Producers are created for EVERY participant before any consumer, because a consumer needs
 * its producer to exist. Consumers for one participant share ONE egress transport, which is
 * how a real participant works — putting each consumer on its own transport would multiply the
 * socket and crypto-context count and measure a shape the app never creates.
 */
async function buildRoom(worker, kinds, participants, sinks) {
  const router = await worker.createRouter({ mediaCodecs: MEDIA_CODECS });
  const audio = codecFor(router, "audio/opus");
  const video = kinds.includes("video") ? codecFor(router, "video/VP8") : null;

  const people = [];
  const streams = [];
  for (let i = 0; i < participants; i++) {
    const ingest = await onFreePort((port) =>
      router.createPlainTransport({
        listenInfo: { protocol: "udp", ip: HOST, port },
        rtcpMux: true,
        /* comedia: the transport learns the generator's address from the first packet. That is
           exactly a receive-only feed, and with SRTP off `connect()` must not be called. */
        comedia: true,
      }),
    );
    const producers = [];
    for (const kind of kinds) {
      const codec = kind === "audio" ? audio : video;
      const ssrc = nextSsrc++;
      producers.push(
        await ingest.produce({
          kind,
          rtpParameters: {
            codecs: [
              {
                mimeType: codec.mimeType,
                payloadType: codec.preferredPayloadType,
                clockRate: codec.clockRate,
                ...(codec.channels ? { channels: codec.channels } : {}),
                parameters: codec.parameters ?? {},
                rtcpFeedback: [],
              },
            ],
            encodings: [{ ssrc }],
          },
        }),
      );
      streams.push({ port: ingest.tuple.localPort, ssrc, payloadType: codec.preferredPayloadType, kind });
    }
    people.push({ ingest, producers, consumers: [] });
  }

  for (let i = 0; i < participants; i++) {
    /* The sink binds from OUR pool rather than an ephemeral port. `bind(0)` was what collided:
       the OS handed it a port inside the range the explicit allocator later reached. */
    const sink = createSocket("udp4");
    const sinkPort = await onFreePort(
      (port) =>
        new Promise((res, rej) => {
          const onErr = (e) => {
            sink.off("error", onErr);
            rej(e);
          };
          sink.once("error", onErr);
          sink.bind(port, HOST, () => {
            sink.off("error", onErr);
            res(port);
          });
        }),
    );
    /* COUNT ONLY THE FORWARDED MEDIA, IDENTIFIED BY (SSRC, PAYLOAD TYPE).
       Two classes of datagram arrive here that are NOT forwarded media, and both inflate the
       ratio above 100% — which at a 0.98 threshold hides real loss rather than showing it:
         - RTCP, because `rtcpMux` shares this port and every consumer sends a sender report
           about once a second (that alone read 100.37% on the first voice run);
         - RTX and bandwidth-probation padding, which the router GENERATES itself, so it has no
           counterpart in the generator's `sent` (that read 100.89% on the first video run).
       Filtering by RFC 5761's payload-type range alone catches only the first. An exact
       (ssrc, pt) allow-list built from each consumer's own `rtpParameters` catches both, and
       SRTP leaves the RTP header in clear so both fields are readable at the sink. */
    const counter = { received: 0, other: 0 };
    const expect = new Set();
    sink.on("message", (msg) => {
      if (msg.length < 12) return;
      const key = `${msg.readUInt32BE(8)}:${msg[1] & 0x7f}`;
      if (expect.has(key)) counter.received++;
      else counter.other++;
    });
    sinks.push({ sink, counter, expect });
    const rec = sinks[sinks.length - 1];

    const egress = await onFreePort((port) =>
      router.createPlainTransport({
        listenInfo: { protocol: "udp", ip: HOST, port },
        rtcpMux: true,
        /* SRTP on egress, so the router does real per-consumer encryption — a large part of
           what an SFU spends CPU on, and invisible to a DirectTransport harness. */
        enableSrtp: true,
        srtpCryptoSuite: "AES_CM_128_HMAC_SHA1_80",
      }),
    );
    await egress.connect({
      ip: HOST,
      port: sinkPort,
      srtpParameters: {
        cryptoSuite: "AES_CM_128_HMAC_SHA1_80",
        // 16-byte master key + 14-byte salt for AES_CM_128_HMAC_SHA1_80.
        keyBase64: randomBytes(30).toString("base64"),
      },
    });
    people[i].egress = egress;

    for (let j = 0; j < participants; j++) {
      if (j === i) continue;
      for (const producer of people[j].producers) {
        const consumer = await egress.consume({
          producerId: producer.id,
          rtpCapabilities: router.rtpCapabilities,
          paused: false,
        });
        people[i].consumers.push(consumer);
        /* The router REWRITES the SSRC on the way out, so the expected key is the CONSUMER's
           own output ssrc, never the producer's input one. codecs[0] is the media codec;
           an RTX entry (if any) follows it and is deliberately NOT admitted, because RTX is
           the router's own retransmission rather than forwarded media. */
        const enc = consumer.rtpParameters.encodings?.[0];
        const codec = consumer.rtpParameters.codecs?.[0];
        if (enc?.ssrc != null && codec?.payloadType != null) {
          rec.expect.add(`${enc.ssrc}:${codec.payloadType}`);
        }
      }
    }
  }

  /* FAN-OUT IS `participants - 1`, AND IT IS NOT MULTIPLIED BY THE NUMBER OF KINDS.
     `sent` already counts every packet of every kind, and each packet reaches exactly the
     other participants' consumers OF ITS OWN KIND — so expected = sent × (P-1). Multiplying
     by kinds as well was the first version of this line, and on a video run it would have
     doubled the denominator, reported ~50% delivery at the very first step, and declared a
     knee of zero rooms with total confidence. */
  return { router, people, streams, fanout: participants - 1 };
}

// ── measurement ──────────────────────────────────────────────────────────────────
function workerCpuTotals(workers) {
  return Promise.all(workers.map((w) => w.getResourceUsage())).then((us) =>
    us.reduce((a, u) => a + (u.ru_utime ?? 0) + (u.ru_stime ?? 0), 0),
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const env = readEnvironment();
  const kinds = args.kind === "video" ? ["audio", "video"] : ["audio"];

  console.log("── media-node load test ──────────────────────────────────────────");
  console.log(`host        ${env.cores} core(s) — ${env.model}`);
  console.log(`kind        ${args.kind} (streams per participant: ${kinds.join(" + ")})`);
  console.log(`room        ${args.participants} participants → ${args.participants * (args.participants - 1)} consumers/room/kind`);
  console.log(
    `workers     ${args.workers || env.cores}${args.workers ? " (forced)" : " (one per core, as the agent does)"}`,
  );
  console.log(`sweep       +${args.step} rooms per step to ${args.maxRooms}, ${args.windowMs}ms window`);
  console.log(`threshold   delivery ≥ ${args.minRatio}`);

  const gate = assertSafeToRun(env);
  for (const n of gate.notes) console.log(`gate        ${n}`);
  if (!gate.ok) {
    console.log("LOADTEST_EXIT=90");
    process.exitCode = 90;
    return;
  }
  if (!args.run) {
    console.log("gate        DRY RUN — pass --run to start workers and drive the sweep.");
    console.log("LOADTEST_EXIT=0");
    return;
  }

  const workerCount = args.workers || env.cores;
  const workers = await startWorkers(workerCount);
  const gen = fork(SELF, ["--generator-child"], { env: { ...process.env, LOADTEST_GENERATOR: "1" } });
  /* REPORT A DEAD GENERATOR AS A DEAD GENERATOR. Without this the parent's next `send` throws
     `ERR_IPC_CHANNEL_CLOSED`, which says the channel closed and not that the child threw — and
     the child's own ReferenceError (a missing import, once) never reaches the log at all. */
  let genDead = null;
  gen.on("exit", (code, signal) => {
    if (code !== 0) genDead = `generator exited code=${code} signal=${signal}`;
  });
  await Promise.race([
    new Promise((res) => gen.once("message", res)),
    new Promise((_, rej) =>
      gen.once("exit", (code) => rej(new Error(`generator died before ready (code=${code})`))),
    ),
  ]);

  let sampleId = 0;
  const ask = (t) =>
    new Promise((res) => {
      const id = ++sampleId;
      const onMsg = (m) => {
        if (m.t === "sample" && m.id === id) {
          gen.off("message", onMsg);
          res(m);
        }
      };
      gen.on("message", onMsg);
      gen.send({ t, id });
    });
  const sample = () => ask("sample");
  const pauseAndReport = () => ask("pause");
  const DRAIN_MS = 300;

  const rooms = [];
  const sinks = [];
  const steps = [];
  let knee = null;
  let buildStoppedAt = null;

  try {
    for (let target = args.step; target <= args.maxRooms; target += args.step) {
      /* A BUILD FAILURE ENDS THE SWEEP, IT DOES NOT DISCARD IT. Running out of loopback ports
         used to throw straight out of `main`, losing four already-measured steps — and a
         partial sweep still contains a knee if one was reached. */
      try {
        while (rooms.length < target) {
          rooms.push(await buildRoom(workers[rooms.length % workers.length], kinds, args.participants, sinks));
        }
      } catch (e) {
        buildStoppedAt = { rooms: rooms.length, why: String(e?.message ?? e) };
        console.log(`build stopped at ${rooms.length} room(s): ${buildStoppedAt.why}`);
        break;
      }
      const allStreams = rooms.flatMap((r) => r.streams);
      gen.send({ t: "streams", streams: allStreams });

      await new Promise((r) => setTimeout(r, args.settleMs));
      if (genDead) throw new Error(genDead);
      const before = await sample();
      const cpuBefore = await workerCpuTotals(workers);
      const recvBefore = sinks.reduce((a, s) => a + s.counter.received, 0);
      const t0 = Date.now();

      await new Promise((r) => setTimeout(r, args.windowMs));

      /* Freeze the sender, take the CPU reading against the same instant, THEN let the wire
         drain before counting arrivals — see the generator's `pause` handler for why. */
      const after = await pauseAndReport();
      const cpuAfter = await workerCpuTotals(workers);
      const wall = Date.now() - t0;
      await new Promise((r) => setTimeout(r, DRAIN_MS));
      const recvAfter = sinks.reduce((a, s) => a + s.counter.received, 0);

      const step = judgeStep({
        rooms: rooms.length,
        sent: after.sent - before.sent,
        scheduled: after.scheduled - before.scheduled,
        received: recvAfter - recvBefore,
        fanout: rooms[0].fanout,
        minRatio: args.minRatio,
      });
      /* THE TWO CPU SOURCES USE DIFFERENT UNITS AND THAT COST A RUN.
         mediasoup's `ru_utime`/`ru_stime` are MILLISECONDS (its own declarations say so),
         while `process.cpuUsage()` is MICROSECONDS. The first draft treated both as µs, so
         node CPU was understated 1000× and every step printed `node 0.00 core` while the
         box was really working — a harness reporting an idle node during saturation, which
         is the one reading that would have made a knee unfindable. */
      step.nodeCpuCores = (cpuAfter - cpuBefore) / wall; // ms / ms → cores
      step.consumers = rooms.length * args.participants * (args.participants - 1) * kinds.length;
      step.genCpuCores =
        (after.cpu.user + after.cpu.system - before.cpu.user - before.cpu.system) / 1000 / wall; // µs → ms
      steps.push(step);

      console.log(
        `rooms ${String(step.rooms).padStart(4)}  delivery ${(step.ratio * 100).toFixed(2)}%  ` +
          `node ${step.nodeCpuCores.toFixed(2)} core  ${(step.nodeCpuCores / step.consumers).toFixed(5)} core/cons  ` +
          `gen ${step.genCpuCores.toFixed(2)} core  ` +
          `keep ${(step.keep * 100).toFixed(1)}%  ${step.verdict}${step.why ? ` (${step.why})` : ""}`,
      );

      if (step.verdict === "degraded") {
        const lastOk = [...steps].reverse().find((s) => s.verdict === "ok");
        knee = lastOk ? lastOk.rooms : 0;
        break;
      }
      if (step.verdict === "void") break;
    }
  } finally {
    gen.send({ t: "stop" });
    for (const s of sinks) s.sink.close();
    for (const w of workers) w.close();
  }

  console.log("── result ────────────────────────────────────────────────────────");
  const voided = steps.some((s) => s.verdict === "void");
  if (voided) {
    console.log("NO VERDICT: the generator saturated before the node did, so the delivery ratio");
    console.log("measures the generator. Re-run with fewer rooms per step, or generate from a");
    console.log("second box. Reporting a knee from this would report the harness's own limit.");
    console.log("LOADTEST_EXIT=91");
    process.exitCode = 91;
    return;
  }
  if (knee == null) {
    const last = steps[steps.length - 1];
    console.log(
      `NO KNEE FOUND up to ${last ? last.rooms : 0} rooms` +
        (buildStoppedAt ? ` — the build stopped first (${buildStoppedAt.why}).` : " — raise --max-rooms."),
    );
    if (last) {
      console.log(
        `last clean    ${last.rooms} rooms at ${last.nodeCpuCores.toFixed(2)} core — ` +
          `${(last.nodeCpuCores / last.rooms).toFixed(4)} core/room, so saturation projects near ` +
          `${Math.floor(1 / (last.nodeCpuCores / last.rooms))} rooms/core.`,
      );
    }
    console.log("LOADTEST_EXIT=92");
    process.exitCode = 92;
    return;
  }
  /* Divide by the WORKER count, not the host's core count: the workers are what carried the
     rooms, and with `--workers=1` the two differ. */
  const perCore = knee / workerCount;
  console.log(`knee            ${knee} rooms of ${args.participants} (${args.kind}) across ${workerCount} worker(s)`);
  console.log(`per core        ${perCore.toFixed(2)} rooms/core`);
  console.log(
    `cap = knee×0.8  ${Math.floor(perCore * 0.8)} rooms/core → ` +
      `${Math.floor(perCore * 0.8 * env.cores)} on a ${env.cores}-core host`,
  );
  /* THE ROOM COUNT IS SHAPE-SPECIFIC; THE CONSUMER COST IS NOT — and that is the finding this
     harness exists to surface. Measured on one box, one worker: a 6-party voice room costs
     0.008 core, a 6-party video room 0.025, a 10-party video room 0.083 — a 10× spread. Divide
     each by its own consumer count and they collapse to 0.00027 / 0.00042 / 0.00046 core per
     consumer. So capacity is very nearly LINEAR IN CONSUMERS, and a cap counting ROOMS is
     necessarily wrong for every shape but the one it was tuned against. Report the per-consumer
     figure so the reader can size a cap that holds for all of them. */
  /* MEASURED IN THE LINEAR REGION, NEVER AT THE KNEE. Once a worker pegs at 1.00 core the CPU
     reading stops rising while consumers keep being added, so `cpu / consumers` FALLS — the
     first version of this line read 0.00035 core/consumer at the knee against 0.00046 in the
     unsaturated steps, understating the cost by a third. The slope between the first and the
     last unsaturated step also cancels any fixed per-room overhead. */
  const linear = steps.filter((s) => s.verdict === "ok" && s.nodeCpuCores < 0.9 * workerCount);
  if (linear.length >= 2) {
    const a = linear[0];
    const b = linear[linear.length - 1];
    const perCons = (b.nodeCpuCores - a.nodeCpuCores) / (b.consumers - a.consumers);
    console.log(
      `linear region   ${a.rooms}-${b.rooms} rooms: ${perCons.toFixed(5)} core/consumer ` +
        `(${a.consumers}→${b.consumers} consumers)`,
    );
    console.log(
      `consumer cap    ${Math.floor((1 / perCons) * 0.8)} consumers/core — SHAPE-INDEPENDENT, ` +
        "and the figure to prefer over a room count",
    );
  } else {
    console.log("linear region   too few unsaturated steps to fit a slope — lower --step.");
  }
  if (!env.isMediaNode) {
    console.log("NOTE            this host is not a media node; the number describes this box only.");
  }
  console.log("NOTE            the generator shares this box, so this knee is a FLOOR, not the true knee.");
  console.log("LOADTEST_EXIT=0");
}

if (process.env.LOADTEST_GENERATOR === "1") {
  runGenerator();
} else if (process.argv[1] && process.argv[1].endsWith("loadtest.mjs")) {
  main().catch((e) => {
    console.error(`[loadtest] ${e?.stack || e}`);
    console.log("LOADTEST_EXIT=93");
    process.exitCode = 93;
  });
}
