/**
 * CALL TELEMETRY (v2.107.23) — the technical vitals of every call, never its
 * content. The owner's line draws the boundary exactly: "not the voice or the
 * video itself — the transmission size in kilobytes, upstream, downstream,
 * latency, everything technical." So this module records bytes, bitrate,
 * round-trip, loss, duration, how the call ended and whether teardown was
 * CLEAN — and has no access to a single media frame by construction: its only
 * input is the summarized stats object the quality readout already computes.
 *
 * FED, NOT SAMPLING: relayClient's one 2s stats tick (the file itself warns a
 * second timer would double getStats cost) hands each summarize result here.
 * With the overlay hidden the tick thins to every third beat — vitals at 6s
 * resolution for free, full 2s resolution whenever someone is watching.
 *
 * LIFECYCLE mirrors sessions: partial flushes mid-call are heartbeats, the end
 * flush carries the reason, and a call whose heartbeat stops without an end
 * flush is judged VANISHED server-side — the killed-app case that client code
 * can never report on its own.
 */
import { APP_VERSION } from "@shared/version";
import {
  accumulateCall,
  callTotals,
  newCallAccumulator,
  type CallSummaryAccumulator,
} from "@shared/telemetryCore";
import { detectCrashPlatform } from "@shared/crashCore";
import type { CallStats, ByteSample } from "./callStats";
import { crashDeviceId, crashSessionId } from "./crashReporter";
import { sessionEvent } from "./sessionTelemetry";

const ENDPOINT = "/api/telemetry";
const PARTIAL_MS = 30_000;

type Live = {
  callInstanceId: string;
  roomId: string;
  startedAtMs: number;
  connectedAtMs: number | null;
  acc: CallSummaryAccumulator;
  prev: ByteSample | null;
  peersMax: number;
  events: { t: number; msg: string }[];
  partialT: ReturnType<typeof setInterval>;
};

let live: Live | null = null;
let lastEndReason: string | null = null;

function uid(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }
}

function send(final: boolean, extra: Record<string, unknown>): void {
  const l = live;
  if (!l) return;
  try {
    const totals = callTotals(l.acc);
    const body = JSON.stringify({
      kind: "call",
      callInstanceId: l.callInstanceId,
      sessionId: crashSessionId(),
      deviceId: crashDeviceId(),
      platform: typeof window === "undefined" ? "web" : detectCrashPlatform(window as never),
      appVersion: APP_VERSION,
      roomId: l.roomId,
      startedAt: l.startedAtMs,
      connectedAt: l.connectedAtMs,
      durationSec: Math.round((Date.now() - l.startedAtMs) / 1000),
      peersMax: l.peersMax,
      ...totals,
      samples: l.acc.samples,
      events: l.events,
      ...extra,
    });
    if (final && navigator.sendBeacon?.(ENDPOINT, new Blob([body], { type: "application/json" }))) return;
    void fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* vitals must never wound the call */
  }
}

/** A call became active. Called from the one place every call path crosses. */
export function callTelemetryStart(roomId: string): void {
  if (live) return; // re-arm of the same sampler, not a new call
  const startedAtMs = Date.now();
  live = {
    callInstanceId: uid(),
    roomId,
    startedAtMs,
    connectedAtMs: null,
    acc: newCallAccumulator(),
    prev: null,
    peersMax: 0,
    events: [{ t: 0, msg: "start" }],
    partialT: setInterval(() => send(false, { ended: null }), PARTIAL_MS),
  };
  lastEndReason = null;
  sessionEvent("call", "call start " + roomId);
}

/** Every summarize result flows through here — the whole vitals feed. */
export function callTelemetrySample(stats: CallStats, sample: ByteSample, peerCount: number): void {
  const l = live;
  if (!l) return;
  try {
    if (peerCount > l.peersMax) l.peersMax = peerCount;
    if (l.connectedAtMs == null && (sample.bytesReceived > 0 || sample.bytesSent > 0)) {
      l.connectedAtMs = Date.now();
      l.events.push({ t: Math.round((Date.now() - l.startedAtMs) / 1000), msg: "connected" });
      sessionEvent("call", "call connected");
    }
    let upKbps = 0;
    let downKbps = 0;
    if (l.prev) {
      const dtMs = sample.atMs - l.prev.atMs;
      if (dtMs > 0) {
        upKbps = ((sample.bytesSent - l.prev.bytesSent) * 8) / dtMs;
        downKbps = ((sample.bytesReceived - l.prev.bytesReceived) * 8) / dtMs;
      }
    }
    l.prev = sample;
    accumulateCall(
      l.acc,
      Math.round((Date.now() - l.startedAtMs) / 1000),
      sample.bytesSent,
      sample.bytesReceived,
      upKbps,
      downKbps,
      stats.rttMs,
      stats.lossWorstPct ?? stats.lossPct
    );
  } catch {
    /* vitals must never wound the call */
  }
}

/** A named moment worth keeping on the call's timeline ("local-hangup",
 *  "peer-left", "reconnect"…). The end reason is whichever note landed last
 *  before teardown — the local hang-up tap, in the common case. */
export function callTelemetryNote(msg: string): void {
  const l = live;
  if (!l) return;
  l.events.push({ t: Math.round((Date.now() - l.startedAtMs) / 1000), msg });
  lastEndReason = msg;
}

/** Teardown crossed. `peersAtEnd`/`roomStillSet` come from the caller's own
 *  scope at that instant — the honest "did the kill actually kill it" reading. */
export function callTelemetryEnd(peersAtEnd: number, roomStillSet: boolean): void {
  const l = live;
  if (!l) return;
  clearInterval(l.partialT);
  const reason = lastEndReason ?? "ended";
  l.events.push({ t: Math.round((Date.now() - l.startedAtMs) / 1000), msg: "end " + reason });
  send(true, {
    ended: { reason },
    clean: peersAtEnd === 0 && !roomStillSet ? 1 : 0,
  });
  sessionEvent("call", "call end " + reason + (peersAtEnd === 0 ? " clean" : " peersLeft=" + peersAtEnd));
  live = null;
  lastEndReason = null;
}
