/**
 * Call quality, as numbers (v2.105.21).
 *
 * WHY THIS EXISTS. The owner reported "slowness in the voice and video calls" and
 * there was no way to answer it: `/api/health` now says which transport the fleet
 * uses, but nothing reported what a call is actually DOING. v2.99.67 removed the
 * Diagnostics panel (rightly — it was a permanent floater nobody asked for), and
 * the only surviving `getStats` reader samples bitrate for the quality button. So
 * "it feels slow" could not be turned into a figure, and choosing a different SFU
 * vendor on that basis would have been a guess.
 *
 * THE ONE NUMBER THAT MATTERS MOST IS `path`. If the selected ICE candidate pair
 * is a RELAY pair, media is going out to coturn and back instead of to the SFU
 * directly — which roughly doubles the round trip and is a CONFIGURATION problem no
 * vendor change fixes. `relay` therefore has to be visible, not inferred.
 *
 * PURE CORE, INJECTED COLLECTION. `summarizeStats` takes reports and returns a
 * record; it touches no RTCPeerConnection, no LiveKit room and no clock. That is
 * what makes the arithmetic — seconds→ms, loss as a ratio of the right
 * denominator, bitrate as a DELTA — testable without a browser, which matters
 * because every one of those is easy to get subtly wrong and impossible to notice
 * by looking at a number on a screen.
 *
 * ONE SHAPE FOR BOTH TRANSPORTS, deliberately: the mesh exposes
 * `RTCPeerConnection.getStats()` per peer and LiveKit exposes
 * `Track.getRTCStatsReport()` per track, so the collectors differ and the summary
 * must not — otherwise the two paths cannot be compared, which is the entire point
 * of measuring before switching vendors.
 */

/** A single stats entry, narrowed to the fields we read. Deliberately loose: the
 *  browser's `RTCStats` union is huge and varies by engine, and reading an absent
 *  field must yield `undefined` rather than throwing. */
export interface StatEntry {
  id?: string;
  type?: string;
  kind?: string;
  mediaType?: string;
  state?: string;
  nominated?: boolean;
  selected?: boolean;
  currentRoundTripTime?: number;
  localCandidateId?: string;
  remoteCandidateId?: string;
  candidateType?: string;
  packetsLost?: number;
  packetsReceived?: number;
  jitter?: number;
  frameWidth?: number;
  frameHeight?: number;
  framesPerSecond?: number;
  bytesSent?: number;
  bytesReceived?: number;
}

/**
 * What a caller hands us: a plain ARRAY of entries, one array per leg.
 *
 * Deliberately not `Iterable<StatEntry>`, which is the obvious choice and does not
 * compile here: this project targets ES5, so `for…of` over a bare iterable is
 * TS2802 (`--downlevelIteration`) — the trap recorded in v2.99.72 and v2.99.98. An
 * `RTCStatsReport` is converted with its own `.forEach`, which is exactly how the
 * existing bitrate sampler already reads one, so the collectors and this share a
 * style rather than diverging.
 */
export type StatsInput = readonly StatEntry[];

/** Flatten a browser stats report into the array shape above, ES5-safely. */
export function entriesOf(report: { forEach: (cb: (v: unknown) => void) => void }): StatEntry[] {
  const out: StatEntry[] = [];
  try {
    report.forEach((v) => {
      if (v && typeof v === "object") out.push(v as StatEntry);
    });
  } catch {
    /* a hostile or half-implemented report yields nothing rather than throwing */
  }
  return out;
}

export type MediaPath = "relay" | "direct" | "unknown";

export interface CallStats {
  /** Round trip to the far end, ms. Null when no succeeded candidate pair reported one. */
  rttMs: number | null;
  /** Inbound packet loss, percent, 0–100. Null when nothing has been received yet. */
  lossPct: number | null;
  /** Inbound jitter, ms. Null when unreported. */
  jitterMs: number | null;
  /**
   * Whether media is going through a TURN relay.
   *
   * `relay` is the finding: it means the round trip includes a detour to coturn.
   * WORST-CASE across peers/tracks — if ANY leg is relayed the call is relayed as
   * far as the user's experience is concerned, so reporting "direct" because one
   * other leg happened to be direct would hide the thing being looked for.
   */
  path: MediaPath;
  /** What WE are sending: the largest published frame + its rate. */
  up: { w: number; h: number; fps: number | null } | null;
  /** What we are RECEIVING: the largest inbound frame + its rate. */
  down: { w: number; h: number; fps: number | null } | null;
  /** Throughput, kbps, derived from a byte DELTA — null on the first sample. */
  kbpsUp: number | null;
  kbpsDown: number | null;
  /** How many peer connections / tracks this summary covers. */
  legs: number;
}

/** Byte counters plus the moment they were read, so the next call can difference them. */
export interface ByteSample {
  bytesSent: number;
  bytesReceived: number;
  atMs: number;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Reduce one or more stats reports to a single summary.
 *
 * `prev` + `now` are what make throughput possible: a stats report carries
 * CUMULATIVE byte counters, so a bitrate is a difference over elapsed time and a
 * single sample can only ever answer null. Passing the clock in rather than calling
 * `Date.now()` keeps the function pure and its arithmetic checkable.
 */
export function summarizeStats(
  reports: StatsInput[],
  opts: { prev?: ByteSample | null; nowMs: number } = { nowMs: 0 },
): { stats: CallStats; sample: ByteSample } {
  let rttMs: number | null = null;
  let lost = 0;
  let received = 0;
  let jitterWorstMs: number | null = null;
  let anyRelay = false;
  let sawPair = false;
  let up: CallStats["up"] = null;
  let down: CallStats["down"] = null;
  let bytesSent = 0;
  let bytesReceived = 0;
  let legs = 0;

  for (const report of reports) {
    legs++;
    // Index candidates by id first: a candidate PAIR names its ends by id, so the
    // types can only be resolved after the whole report has been seen. Doing it in
    // one pass would work only if the browser emitted candidates before pairs,
    // which is not guaranteed.
    const byId = new Map<string, StatEntry>();
    const entries: StatEntry[] = [];
    for (const e of report) {
      entries.push(e);
      if (e && typeof e.id === "string") byId.set(e.id, e);
    }

    for (const e of entries) {
      if (!e) continue;

      if (e.type === "candidate-pair" && e.state === "succeeded") {
        // Several pairs can read "succeeded"; the nominated/selected one is the one
        // carrying media. Absent that flag, any succeeded pair is better than none.
        const preferred = e.nominated === true || e.selected === true;
        const r = num(e.currentRoundTripTime);
        // `currentRoundTripTime` is SECONDS per spec. Reporting it raw would show
        // "0.04 ms" and read as a perfect connection.
        if (r !== null && (preferred || rttMs === null)) rttMs = r * 1000;
        sawPair = true;
        const l = e.localCandidateId ? byId.get(e.localCandidateId) : undefined;
        const rm = e.remoteCandidateId ? byId.get(e.remoteCandidateId) : undefined;
        if (l?.candidateType === "relay" || rm?.candidateType === "relay") anyRelay = true;
      }

      if (e.type === "inbound-rtp") {
        lost += num(e.packetsLost) ?? 0;
        received += num(e.packetsReceived) ?? 0;
        const j = num(e.jitter);
        // Jitter is SECONDS too, and worst-case across legs for the same reason as
        // `path`: one smooth leg does not make a choppy call smooth.
        if (j !== null) jitterWorstMs = Math.max(jitterWorstMs ?? 0, j * 1000);
        bytesReceived += num(e.bytesReceived) ?? 0;
        const w = num(e.frameWidth);
        const h = num(e.frameHeight);
        if (w && h && (!down || w * h > down.w * down.h)) {
          down = { w, h, fps: num(e.framesPerSecond) };
        }
      }

      if (e.type === "outbound-rtp") {
        bytesSent += num(e.bytesSent) ?? 0;
        const w = num(e.frameWidth);
        const h = num(e.frameHeight);
        // LARGEST, not last: with simulcast a publisher reports one outbound-rtp per
        // spatial layer, and the low layer would otherwise be shown as "what you are
        // sending" — making a healthy 720p publish read as 180p.
        if (w && h && (!up || w * h > up.w * up.h)) {
          up = { w, h, fps: num(e.framesPerSecond) };
        }
      }
    }
  }

  const sample: ByteSample = { bytesSent, bytesReceived, atMs: opts.nowMs };
  let kbpsUp: number | null = null;
  let kbpsDown: number | null = null;
  const prev = opts.prev;
  if (prev) {
    const dt = (opts.nowMs - prev.atMs) / 1000;
    // A non-positive interval yields no rate rather than Infinity, and a counter
    // that went BACKWARDS (a renegotiation, a track republish) is treated as no
    // data rather than a negative bitrate.
    if (dt > 0) {
      const dUp = bytesSent - prev.bytesSent;
      const dDown = bytesReceived - prev.bytesReceived;
      if (dUp >= 0) kbpsUp = Math.round((dUp * 8) / dt / 1000);
      if (dDown >= 0) kbpsDown = Math.round((dDown * 8) / dt / 1000);
    }
  }

  return {
    stats: {
      rttMs: rttMs === null ? null : Math.round(rttMs),
      // The denominator is received + lost, i.e. packets that were SENT to us —
      // dividing by `received` alone understates loss, and by anything else is
      // meaningless.
      lossPct: received + lost > 0 ? Math.round((lost / (received + lost)) * 1000) / 10 : null,
      jitterMs: jitterWorstMs === null ? null : Math.round(jitterWorstMs * 10) / 10,
      // `unknown` when no succeeded pair was reported at all — never "direct",
      // which would be a claim about the media path we have no evidence for.
      path: !sawPair ? "unknown" : anyRelay ? "relay" : "direct",
      up,
      down,
      kbpsUp,
      kbpsDown,
      legs,
    },
    sample,
  };
}

/** One line, for the in-call chip. Every field is omitted rather than shown empty,
 *  so a partially-reported call reads as short rather than as broken. */
export function formatCallStats(s: CallStats): string {
  const parts: string[] = [];
  if (s.rttMs !== null) parts.push(`${s.rttMs}ms`);
  if (s.lossPct !== null) parts.push(`${s.lossPct}% loss`);
  if (s.jitterMs !== null) parts.push(`${s.jitterMs}ms jit`);
  // Named even when it is the good case, because "direct" is the reassurance that
  // makes "relay" mean something when it appears.
  if (s.path !== "unknown") parts.push(s.path === "relay" ? "via TURN relay" : "direct");
  if (s.up) parts.push(`↑${s.up.w}×${s.up.h}${s.up.fps !== null ? `@${Math.round(s.up.fps)}` : ""}`);
  if (s.kbpsUp !== null) parts.push(`↑${s.kbpsUp}kbps`);
  if (s.down) parts.push(`↓${s.down.w}×${s.down.h}${s.down.fps !== null ? `@${Math.round(s.down.fps)}` : ""}`);
  if (s.kbpsDown !== null) parts.push(`↓${s.kbpsDown}kbps`);
  return parts.length ? parts.join(" · ") : "measuring…";
}

/**
 * Is this reading worth flagging to the user?
 *
 * Thresholds are deliberately generous — this exists to catch a call that is
 * genuinely bad, not to editorialise about a good one. A TURN relay is called out
 * on its own regardless of the numbers, because it is a fixable misconfiguration
 * rather than a condition to tolerate.
 */
export function callStatsVerdict(s: CallStats): "relay" | "poor" | "ok" {
  if (s.path === "relay") return "relay";
  if ((s.rttMs ?? 0) > 300) return "poor";
  if ((s.lossPct ?? 0) > 5) return "poor";
  if ((s.jitterMs ?? 0) > 50) return "poor";
  return "ok";
}
