/**
 * THE LOAD TEST'S PURE HALF — no mediasoup, no sockets, no child processes.
 *
 * SPLIT FOR THE SAME REASON `record.mjs` IS SPLIT FROM `index.js`, and it is a hard
 * requirement rather than a tidiness preference: `voip-node` is NOT a pnpm workspace member,
 * so CI's root `pnpm install --frozen-lockfile` never installs mediasoup. A test that imported
 * `loadtest.mjs` would therefore pass on a box where somebody had built the worker and fail in
 * CI — and importing mediasoup at all is the v2.99.71 trap (importing `turn-check.mjs` ran a
 * health check and called `process.exit`, killing the test runner).
 *
 * So everything a test needs to DRIVE — the safety gate, the step verdict, the RTP builder,
 * the argument parser — lives here and imports nothing at all. `server/voipLoadTest.test.ts`
 * asserts that, because the value of the split is lost the moment one import creeps back in.
 */

/* The agent's own codec list, deliberately duplicated rather than imported: `index.js` starts
   workers and binds a port at import, which is the v2.99.71 trap (importing `turn-check.mjs`
   ran a health check and called `process.exit`). A divergence here makes the measurement
   describe a router the fleet does not run, so `server/voipLoadTest.test.ts` compares the two
   lists rather than trusting this comment. */
export const MEDIA_CODECS = [
  {
    kind: "audio",
    mimeType: "audio/opus",
    clockRate: 48000,
    channels: 2,
    parameters: {
      maxaveragebitrate: 32000,
      ptime: 20,
      usedtx: 1,
      useinbandfec: 1,
      stereo: 0,
    },
  },
  { kind: "video", mimeType: "video/VP8", clockRate: 90000, parameters: { "x-google-start-bitrate": 400 } },
  {
    kind: "video",
    mimeType: "video/H264",
    clockRate: 90000,
    parameters: {
      "packetization-mode": 1,
      "profile-level-id": "42e01f",
      "level-asymmetry-allowed": 1,
      "x-google-start-bitrate": 400,
    },
  },
];

/* Loopback only, and a port range DELIBERATELY disjoint from the agent's 40000-49999. Nothing
   here crosses the network, so these ports need no security-group rule — and keeping them out
   of the agent's range means a harness left running cannot collide with a restarted agent. */
export const HOST = "127.0.0.1";
/* ABOVE THE OS EPHEMERAL RANGE, AND CLEAR OF THE AGENT'S 40000-49999.
   The first pool was 50000-59998, which sits INSIDE Linux's default ephemeral range
   (32768-60999) — so a sink socket bound with `bind(0)` was handed 51052 and the run then
   died with EADDRINUSE when the explicit allocator reached the same number. Choosing a base
   above the range removes the common case; `onFreePort` below handles the rest, because no
   pool can be ASSUMED free when other processes share the box. */
export const MIN_PORT = Number(process.env.LOADTEST_MIN_PORT || 61100);
export const MAX_PORT = Number(process.env.LOADTEST_MAX_PORT || 65400);

export const AUDIO_PTIME_MS = 20; // 50 packets/second, matching the agent's own Opus ptime.
export const AUDIO_BYTES = 80; // ≈32 kbps at 20 ms.
export const VIDEO_FPS = 30;
export const VIDEO_PKTS_PER_FRAME = 2; // ≈500 kbps in ~1200-byte payloads.
export const VIDEO_BYTES = 1100;

// ── argv ─────────────────────────────────────────────────────────────────────────
export function parseArgs(argv) {
  const out = {
    kind: "voice",
    participants: 2,
    step: 4,
    maxRooms: 64,
    windowMs: 6000,
    settleMs: 1500,
    minRatio: 0.98,
    workers: 0, // 0 = one per core, as the agent does.
    run: false,
  };
  for (const a of argv) {
    const m = /^--([a-z-]+)(?:=(.*))?$/.exec(a);
    if (!m) throw new Error(`unrecognised argument: ${a}`);
    const [, k, v] = m;
    if (k === "run") out.run = true;
    else if (k === "kind") {
      if (v !== "voice" && v !== "video") throw new Error(`--kind must be voice|video, got ${v}`);
      out.kind = v;
    } else if (k === "participants") out.participants = num(v, 2, 16, k);
    else if (k === "step") out.step = num(v, 1, 64, k);
    else if (k === "max-rooms") out.maxRooms = num(v, 1, 512, k);
    else if (k === "window-ms") out.windowMs = num(v, 1000, 120000, k);
    else if (k === "settle-ms") out.settleMs = num(v, 0, 30000, k);
    else if (k === "min-ratio") out.minRatio = frac(v, k);
    /* `--workers=1` measures ONE core directly, which is the quantity the owner's formula
       actually needs (`cap = knee × cores × 0.8` is per-core). Deriving it by dividing a
       whole-node knee assumes the cores scale linearly and that nothing else on the box
       competed; measuring a single worker assumes neither, and saturates far sooner. */
    else if (k === "workers") out.workers = num(v, 1, 64, k);
    else throw new Error(`unrecognised argument: --${k}`);
  }
  return out;
}
export function num(v, lo, hi, k) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < lo || n > hi) throw new Error(`--${k} must be an integer ${lo}-${hi}, got ${v}`);
  return n;
}
export function frac(v, k) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0 || n > 1) throw new Error(`--${k} must be in (0,1], got ${v}`);
  return n;
}

// ── the safety gate ──────────────────────────────────────────────────────────────
/**
 * Refuse to run on a media node that is still carrying calls.
 *
 * BOTH conditions are required and they answer different questions:
 *   - the drain file  → the APP stops assigning NEW rooms here. Without it, a room assigned
 *     mid-test lands on a stopped agent and that call simply fails.
 *   - the agent stopped → there are no CURRENT rooms in the way, and the CPU this measures is
 *     the harness's own rather than shared with live calls.
 *
 * FAILS CLOSED, which is the opposite of the agent's own drain check — and the asymmetry is
 * the reason: the agent guessing wrong costs capacity, the harness guessing wrong costs
 * somebody's live call. There is no override flag for the same reason.
 */
export function assertSafeToRun(env) {
  const notes = [];
  if (!env.isMediaNode) {
    notes.push(
      "NOT A MEDIA NODE (/opt/relay-voip is absent), so there are no live calls to protect. " +
        "Numbers from this host describe THIS host and are not a fleet measurement.",
    );
    return { ok: true, notes };
  }
  if (!env.draining) {
    return {
      ok: false,
      notes: [
        `REFUSED: this is a media node and it is not draining (${env.drainFile} absent).`,
        "Driving a node to its knee while it carries calls degrades them for everybody on it.",
        `Run:  sudo touch ${env.drainFile}   then wait for its rooms to end.`,
      ],
    };
  }
  if (env.agentActive !== false) {
    return {
      ok: false,
      notes: [
        `REFUSED: the agent is ${env.agentActive === true ? "still active" : "in an unknown state"}.`,
        "A stopped agent is what proves there are no live rooms left, and it frees the CPU this measures.",
        "Run:  sudo systemctl stop relay-voip-agent",
      ],
    };
  }
  notes.push("media node, draining, agent stopped — safe to saturate.");
  return { ok: true, notes };
}

/**
 * One RTP packet. The header is the whole of what a router reads to forward, so it has to be
 * right; the payload only has to be plausible.
 *
 * For VP8 the payload descriptor IS read (mediasoup parses it for keyframe and layer
 * detection), so the first packet of every frame carries `S=1` and a VP8 payload header with
 * `P=0` — a keyframe — followed by the mandatory `9d 01 2a` start code. Every frame being a
 * keyframe is unrealistic for bitrate and irrelevant here: the packet rate is what we set, and
 * it guarantees a consumer is never waiting on a keyframe that a synthetic sender would never
 * produce (which would read as 100% loss).
 */
export function buildRtpPacket({ payloadType, seq, timestamp, ssrc, marker, kind, firstOfFrame, bytes }) {
  const payloadLen = kind === "video" ? bytes : bytes;
  const buf = Buffer.alloc(12 + payloadLen);
  buf[0] = 0x80; // V=2, P=0, X=0, CC=0
  buf[1] = (marker ? 0x80 : 0) | (payloadType & 0x7f);
  buf.writeUInt16BE(seq & 0xffff, 2);
  buf.writeUInt32BE(timestamp >>> 0, 4);
  buf.writeUInt32BE(ssrc >>> 0, 8);
  if (kind === "video") {
    if (firstOfFrame) {
      buf[12] = 0x10; // X=0 N=0 S=1 PID=0
      buf[13] = 0x00; // VP8 payload header, P=0 → keyframe
      buf[14] = 0x00;
      buf[15] = 0x00;
      buf[16] = 0x9d;
      buf[17] = 0x01;
      buf[18] = 0x2a;
      buf.writeUInt16LE(320, 19);
      buf.writeUInt16LE(240, 21);
    } else {
      buf[12] = 0x00; // continuation of the same partition
    }
  }
  return buf;
}

/** Packets per second for one stream of this kind — the generator's own clock. */
export function packetsPerSecond(kind) {
  return kind === "audio" ? 1000 / AUDIO_PTIME_MS : VIDEO_FPS * VIDEO_PKTS_PER_FRAME;
}

/**
 * One measurement step. Returns a record; the caller decides where the knee is.
 *
 * `verdict: "void"` is a first-class outcome: if the generator did not keep its own clock, the
 * delivery ratio measures the generator and not the node, and saying "fine" there would be the
 * worst available answer.
 */
export function judgeStep({ rooms, sent, scheduled, received, fanout, minRatio, generatorMinKeep = 0.99 }) {
  const keep = scheduled > 0 ? sent / scheduled : 1;
  const expected = sent * fanout;
  const ratio = expected > 0 ? received / expected : 0;
  if (keep < generatorMinKeep) {
    return { rooms, ratio, keep, expected, received, verdict: "void", why: "generator fell behind its own clock" };
  }
  return { rooms, ratio, keep, expected, received, verdict: ratio >= minRatio ? "ok" : "degraded" };
}
