/**
 * SESSION TELEMETRY (v2.107.23) — the full journey, not just the last 30 steps.
 *
 * The crash reporter keeps a short ring for context around a death; the owner's
 * brief goes further: "everything the user does, icon by icon, what does not
 * function — so you understand." This module records the WHOLE session — every
 * navigation, tap, error, failed request, lifecycle change, and call marker —
 * and flushes it in batches to `/api/telemetry`, where one row per session is
 * upserted and capped.
 *
 * SOURCES, deliberately not duplicated: the crash reporter already instruments
 * taps/navs/errors/lifecycle once; it now exposes a SINK and this module is the
 * subscriber. Failures ("does not function") come from the query/mutation cache
 * hooks in main.tsx; call markers come from callTelemetry. One capture layer,
 * two consumers.
 *
 * LIFECYCLE: every flush is a heartbeat (the server bumps lastSeenAt); pagehide
 * sends `ended` via sendBeacon. A session with no `ended` whose heartbeat went
 * silent is judged VANISHED — server-side, by absence, which is the only way a
 * killed tab can testify.
 *
 * DELIVERY mirrors the crash pipe's rules: fire-and-forget, keepalive, any HTTP
 * response counts as delivered, and total silence on failure — telemetry must
 * never become the problem it exists to observe.
 */
import { APP_VERSION } from "@shared/version";
import {
  SESSION_EVENT_MSG_MAX,
  type SessionEvent,
} from "@shared/telemetryCore";
import { detectCrashPlatform } from "@shared/crashCore";
import { crashDeviceId, crashSessionId, setCrumbSink } from "./crashReporter";

const ENDPOINT = "/api/telemetry";
const FLUSH_MS = 20_000;
const BURST_AT = 25;

let startedAtMs = 0;
let buf: SessionEvent[] = [];
let taps = 0;
let errors = 0;
let fails = 0;
let flushT: ReturnType<typeof setInterval> | null = null;
let inited = false;
let endedSent = false;

function now(): number {
  return Math.round((Date.now() - startedAtMs) / 100) / 10;
}

/** Public: append one journey event. Safe before init (buffered) and total-silent. */
export function sessionEvent(kind: SessionEvent["kind"], msg: string): void {
  try {
    buf.push({ t: now(), kind, msg: String(msg).slice(0, SESSION_EVENT_MSG_MAX) });
    if (kind === "tap") taps++;
    else if (kind === "error") errors++;
    else if (kind === "fail") fails++;
    if (buf.length >= BURST_AT) flush(false);
  } catch {
    /* never the problem */
  }
}

function payload(ended: { reason: string } | null): string {
  const events = buf;
  buf = [];
  return JSON.stringify({
    kind: "session",
    sessionId: crashSessionId(),
    deviceId: crashDeviceId(),
    platform: typeof window === "undefined" ? "web" : detectCrashPlatform(window as never),
    appVersion: APP_VERSION,
    startedAt: startedAtMs,
    url: location.pathname,
    events,
    taps,
    errors,
    fails,
    ended,
  });
}

function flush(final: boolean): void {
  try {
    if (endedSent) return;
    if (!final && buf.length === 0) {
      // Heartbeat with no events still matters: lastSeenAt is what separates
      // "open" from "vanished", so an idle-but-alive session keeps testifying.
      void fetch(ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: payload(null),
        keepalive: true,
      }).catch(() => {});
      return;
    }
    const body = payload(final ? { reason: "pagehide" } : null);
    if (final) {
      endedSent = true;
      // sendBeacon is the only sender the page-death path can trust.
      if (navigator.sendBeacon?.(ENDPOINT, new Blob([body], { type: "application/json" }))) return;
    }
    void fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* never the problem */
  }
}

/** Wire the capture. Idempotent; call once from main.tsx after the crash reporter. */
export function initSessionTelemetry(): void {
  if (inited || typeof window === "undefined") return;
  inited = true;
  startedAtMs = Date.now();
  // The crash reporter's instrumentation (taps, navs, errors, lifecycle) feeds
  // the journey too — one capture layer, two consumers.
  setCrumbSink(c => sessionEvent(c.kind as SessionEvent["kind"], c.msg));
  sessionEvent("life", "session start " + location.pathname);
  flushT = setInterval(() => flush(false), FLUSH_MS);
  window.addEventListener("pagehide", () => {
    if (flushT) {
      clearInterval(flushT);
      flushT = null;
    }
    flush(true);
  });
}
