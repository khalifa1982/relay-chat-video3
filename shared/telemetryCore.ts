/**
 * SESSION + CALL TELEMETRY — the pure core (v2.107.23), shared by both ends for
 * the same reason crashCore is: the client caps before sending, the server caps
 * again before storing, and one implementation is the only way they agree.
 *
 * WHAT THIS LAYER RECORDS, AND WHAT IT NEVER TOUCHES: the owner's brief is
 * "everything the user does, icon by icon, and every technical vital of a call —
 * but never the voice or video itself." So a session row is a JOURNEY (taps,
 * navigations, failures, lifecycle) and a call row is VITALS (kilobytes up and
 * down, bitrate, round-trip, loss, how it ended). No frame, no sample, no text
 * a user typed ever enters this pipe.
 *
 * THE LIFECYCLE QUESTION — "when the session closed, is it killed or still
 * open?" — is answered by three states, derived rather than trusted:
 *   closed    — the client said goodbye (an `ended` flush arrived);
 *   open      — no goodbye yet, and a flush arrived recently (heartbeat);
 *   vanished  — no goodbye, and the heartbeat went silent: the tab or app was
 *               killed, crashed, or lost the network. The one the owner most
 *               wants to see, and the one only ABSENCE can reveal.
 */

/* ── Session journeys ───────────────────────────────────────────────────────── */

export type SessionEvent = {
  /** Seconds since session start, one decimal. */
  t: number;
  kind: "nav" | "tap" | "error" | "fail" | "life" | "call";
  msg: string;
};

/** Hard bounds on a stored journey. 400 events / 60k chars keeps "everything he
 *  did" reviewable AND keeps a keep-forever table affordable: even a marathon
 *  session is one bounded row, never an unbounded stream. */
export const SESSION_EVENT_MAX = 400;
export const SESSION_EVENTS_CHARS = 60_000;
export const SESSION_EVENT_MSG_MAX = 200;

/** How long a session may stay silent before "open" becomes "vanished". Flushes
 *  ride a 20s cadence, so 90s of silence is four missed heartbeats — a stall,
 *  not a slow network. */
export const SESSION_STALE_MS = 90_000;

/** Merge new journey events onto the stored ones, oldest dropped first when a
 *  bound is hit — the END of a journey is where crashes and hangs live, so the
 *  end is what survives. Returns the JSON string ready to store. */
export function mergeSessionEvents(
  storedJson: string | null | undefined,
  incoming: SessionEvent[],
  maxItems = SESSION_EVENT_MAX,
  maxChars = SESSION_EVENTS_CHARS
): string {
  let all: SessionEvent[] = [];
  try {
    const prev = storedJson ? (JSON.parse(storedJson) as SessionEvent[]) : [];
    if (Array.isArray(prev)) all = prev;
  } catch {
    /* a corrupt stored trail is replaced, not fatal */
  }
  for (const e of incoming) {
    if (!e || typeof e.msg !== "string") continue;
    all.push({
      t: typeof e.t === "number" ? Math.round(e.t * 10) / 10 : 0,
      kind: e.kind,
      msg: e.msg.slice(0, SESSION_EVENT_MSG_MAX),
    });
  }
  if (all.length > maxItems) all = all.slice(all.length - maxItems);
  let out = JSON.stringify(all);
  while (out.length > maxChars && all.length > 1) {
    all = all.slice(Math.ceil(all.length / 8)); // shed the oldest eighth
    out = JSON.stringify(all);
  }
  return out;
}

export type SessionState = "open" | "closed" | "vanished";

/** Derive the lifecycle answer. Pure over timestamps so it is testable and so
 *  the console and any future sweep compute the SAME answer. */
export function sessionStateOf(
  endedAtMs: number | null,
  lastSeenAtMs: number,
  nowMs: number,
  staleMs = SESSION_STALE_MS
): SessionState {
  if (endedAtMs != null) return "closed";
  return nowMs - lastSeenAtMs > staleMs ? "vanished" : "open";
}

/* ── Call vitals ────────────────────────────────────────────────────────────── */

export type CallSample = {
  /** Seconds since the call started. */
  t: number;
  upKbps: number;
  downKbps: number;
  rttMs: number | null;
  lossPct: number | null;
};

/** One sample per tick, capped: at the telemetry cadence this covers a long
 *  call; past the cap every SECOND sample is dropped (halving resolution) so a
 *  marathon call keeps its whole shape instead of losing its start. */
export const CALL_SAMPLE_MAX = 120;

export function pushCallSample(list: CallSample[], s: CallSample, max = CALL_SAMPLE_MAX): CallSample[] {
  list.push({
    t: Math.round(s.t),
    upKbps: Math.max(0, Math.round(s.upKbps)),
    downKbps: Math.max(0, Math.round(s.downKbps)),
    rttMs: s.rttMs == null ? null : Math.round(s.rttMs),
    lossPct: s.lossPct == null ? null : Math.round(s.lossPct * 10) / 10,
  });
  if (list.length > max) {
    const halved: CallSample[] = [];
    for (let i = 0; i < list.length; i++) if (i % 2 === 0) halved.push(list[i]);
    list.length = 0;
    list.push(...halved);
  }
  return list;
}

/** The per-call rollup the console lists — built from cumulative byte counters
 *  (first vs last) so a missed tick loses resolution, never volume. */
export type CallSummaryAccumulator = {
  firstBytesUp: number | null;
  firstBytesDown: number | null;
  lastBytesUp: number;
  lastBytesDown: number;
  rttSum: number;
  rttN: number;
  rttMax: number;
  lossWorst: number;
  samples: CallSample[];
};

export function newCallAccumulator(): CallSummaryAccumulator {
  return {
    firstBytesUp: null,
    firstBytesDown: null,
    lastBytesUp: 0,
    lastBytesDown: 0,
    rttSum: 0,
    rttN: 0,
    rttMax: 0,
    lossWorst: 0,
    samples: [],
  };
}

export function accumulateCall(
  a: CallSummaryAccumulator,
  tSec: number,
  bytesUp: number,
  bytesDown: number,
  upKbps: number,
  downKbps: number,
  rttMs: number | null,
  lossPct: number | null
): void {
  if (a.firstBytesUp == null) a.firstBytesUp = bytesUp;
  if (a.firstBytesDown == null) a.firstBytesDown = bytesDown;
  a.lastBytesUp = Math.max(a.lastBytesUp, bytesUp);
  a.lastBytesDown = Math.max(a.lastBytesDown, bytesDown);
  if (rttMs != null) {
    a.rttSum += rttMs;
    a.rttN += 1;
    if (rttMs > a.rttMax) a.rttMax = rttMs;
  }
  if (lossPct != null && lossPct > a.lossWorst) a.lossWorst = lossPct;
  pushCallSample(a.samples, { t: tSec, upKbps, downKbps, rttMs, lossPct });
}

export function callTotals(a: CallSummaryAccumulator): {
  upKB: number;
  downKB: number;
  avgRttMs: number | null;
  maxRttMs: number | null;
  lossWorstPct: number;
} {
  return {
    upKB: Math.max(0, Math.round((a.lastBytesUp - (a.firstBytesUp ?? 0)) / 1024)),
    downKB: Math.max(0, Math.round((a.lastBytesDown - (a.firstBytesDown ?? 0)) / 1024)),
    avgRttMs: a.rttN > 0 ? Math.round(a.rttSum / a.rttN) : null,
    maxRttMs: a.rttN > 0 ? Math.round(a.rttMax) : null,
    lossWorstPct: Math.round(a.lossWorst * 10) / 10,
  };
}
