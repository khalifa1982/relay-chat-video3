/**
 * CLIENT CRASH REPORTER (v2.107.x) — runs on the web AND inside the Capacitor
 * iOS/Android shells, because the shells load this exact bundle from the live
 * site: ship this once and all three surfaces report, with no store release.
 * `detectCrashPlatform` reads the Capacitor bridge so each report labels itself.
 *
 * ── WHAT IT CAPTURES ──────────────────────────────────────────────────────────
 *   • window "error"            — uncaught throws (resource-load errors skipped:
 *                                 a 404'd image is not a crash)
 *   • window "unhandledrejection" — uncaught async failures
 *   • React render crashes      — via <CrashBoundary/>, which calls reportCrash
 *                                 with the componentStack
 * plus a 30-entry breadcrumb ring (navigation, taps, console.error) so every
 * report carries "what happened just before".
 *
 * ── WHY A PERSISTED QUEUE, AND WHAT "DELIVERED" MEANS ─────────────────────────
 * The moment a crash happens is the worst possible moment to depend on a network
 * round-trip completing. So a report is written to localStorage FIRST, then
 * flushed — keepalive fetch normally, sendBeacon on pagehide — and a report that
 * never got out (tab killed mid-crash, device offline, hard reload loop) is
 * re-sent on the NEXT boot from the persisted queue. ANY http response counts as
 * delivered: the server answers 204 to everything on purpose, so nothing here
 * can retry-loop; only a network-level failure keeps an item queued.
 *
 * EVERY PATH IS WRAPPED. A crash reporter that can itself throw turns one defect
 * into two; failure here must always degrade to "no report", never to noise.
 */
import { sentryCapture } from "@/lib/sentry";
import { APP_VERSION } from "@shared/version";
import {
  CRASH_CAPS,
  classifyCrashNoise,
  type CrashBreadcrumb,
  capCrashField,
  detectCrashPlatform,
  pushCrashBreadcrumb,
  describeThrowable,
} from "@shared/crashCore";
import { getDeviceId } from "@/lib/deviceId";

const QUEUE_KEY = "relay_crash_queue_v1";
const QUEUE_MAX = 10;
/** Client-side flood floor: the same (name, message) more than this many times a
 *  minute is dropped BEFORE queueing — the server's storm collapse would merge
 *  them anyway, so sending each one only burns the rate budget. */
const SAME_ERROR_PER_MIN = 5;

type QueuedReport = Record<string, string>;

const bootAt = Date.now();
const sessionId =
  (typeof crypto !== "undefined" && "randomUUID" in crypto && crypto.randomUUID()) ||
  `s-${bootAt.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
const crumbs: CrashBreadcrumb[] = [];
const recent = new Map<string, number[]>(); // client-side flood floor
let installed = false;

/* The reporter's own logging uses the ORIGINAL console.warn reference — its
 * console.error wrapper adds a breadcrumb, and a reporter that breadcrumbs its
 * own warnings recurses at exactly the wrong time. */
const rawWarn: (...a: unknown[]) => void =
  typeof console !== "undefined" ? console.warn.bind(console) : () => {};

function nowT(): number {
  return Math.round((Date.now() - bootAt) / 100) / 10;
}

let crumbSink: ((c: CrashBreadcrumb) => void) | null = null;
/** SESSION TELEMETRY TAP (v2.107.23): the journey recorder subscribes here so
 *  taps/navs/errors/lifecycle are instrumented ONCE and consumed twice — the
 *  short ring for crash context, the full session log for the journey. */
export function setCrumbSink(fn: (c: CrashBreadcrumb) => void): void { crumbSink = fn; }
export function crashDeviceId(): string { return getDeviceId() ?? ""; }
export function crashSessionId(): string { return sessionId; }
function crumb(kind: CrashBreadcrumb["kind"], msg: string): void {
  try {
    pushCrashBreadcrumb(crumbs, { t: nowT(), kind, msg });
  } catch {
    /* never throw */
  }
  try { crumbSink?.({ t: 0, kind, msg }); } catch { /* the sink must never wound the ring */ }
}

function readQueue(): QueuedReport[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    const q = raw ? (JSON.parse(raw) as QueuedReport[]) : [];
    return Array.isArray(q) ? q : [];
  } catch {
    return [];
  }
}

function writeQueue(q: QueuedReport[]): void {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q.slice(-QUEUE_MAX)));
  } catch {
    /* quota/private-mode: the in-flight send still happens */
  }
}

function deviceInfo(): string {
  try {
    const n = navigator as Navigator & {
      deviceMemory?: number;
      connection?: { effectiveType?: string };
    };
    return JSON.stringify({
      ua: capCrashField(n.userAgent, 300),
      lang: n.language,
      vp: `${window.innerWidth}x${window.innerHeight}`,
      dpr: window.devicePixelRatio,
      mem: n.deviceMemory ?? null,
      net: n.connection?.effectiveType ?? null,
      online: n.onLine,
    });
  } catch {
    return "{}";
  }
}

function floodDrop(name: string, message: string): boolean {
  try {
    const key = name + "|" + message.slice(0, 120);
    const now = Date.now();
    const times = (recent.get(key) ?? []).filter((t) => now - t < 60_000);
    times.push(now);
    recent.set(key, times);
    return times.length > SAME_ERROR_PER_MIN;
  } catch {
    return false;
  }
}

function send(body: string, unloading: boolean): Promise<boolean> {
  try {
    if (unloading && typeof navigator.sendBeacon === "function") {
      // pagehide: fetch would be aborted with the document; a beacon outlives it.
      return Promise.resolve(
        navigator.sendBeacon("/api/crash", new Blob([body], { type: "application/json" }))
      );
    }
    return fetch("/api/crash", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true, // survives a navigation that starts mid-send
      credentials: "omit", // the ingest is auth-free by design
    }).then(
      () => true, // ANY response = delivered (server always answers 204)
      () => false // network failure = keep queued for next boot
    );
  } catch {
    return Promise.resolve(false);
  }
}

let flushing = false;
async function flush(unloading = false): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    let q = readQueue();
    while (q.length > 0) {
      const ok = await send(JSON.stringify(q[0]), unloading);
      if (!ok) break; // offline — try again next boot / next 'online'
      q = q.slice(1);
      writeQueue(q);
    }
  } catch {
    /* never throw */
  } finally {
    flushing = false;
  }
}

/** Queue-then-flush one report. Exported for <CrashBoundary/>; everything else
 *  arrives through the global hooks `initCrashReporter` installs. */
export function reportCrash(
  err: unknown,
  extra?: { componentStack?: string | null; kind?: string }
): void {
  // Sentry forward (v2.107.78): this function is the choke point every in-house
  // hook — window.onerror, unhandledrejection, the render boundary — already
  // routes through, so one line here gives Sentry everything the net catches.
  // Fire-and-forget and fully guarded inside; the in-house report below is
  // unconditional either way.
  sentryCapture(err, { kind: extra?.kind ?? "crash", componentStack: extra?.componentStack ?? null });
  try {
    /* v2.107.45: a non-Error throwable used to become `new Error(String(err))`,
       i.e. "[object Object]" for any plain object — which is exactly how crash
       #14 arrived: a real unhandledrejection with every diagnostic byte lost.
       describeThrowable pulls out a real message (a .message/.reason string, a
       JSON snapshot, a code) and, when there is genuinely nothing, stamps the
       empty sentinel so classifyCrashNoise can drop an undiagnosable OEM throw
       rather than store a wall of "[object Object]". A real Error is untouched. */
    const d = err instanceof Error ? null : describeThrowable(err);
    const e = err instanceof Error ? err : new Error(d!.message);
    if (d && !(err instanceof Error)) e.name = d.name;
    const name = capCrashField(e.name || extra?.kind || "Error", CRASH_CAPS.name);
    const message = capCrashField(e.message || "", CRASH_CAPS.message);
    const platform = detectCrashPlatform(
      window as unknown as Parameters<typeof detectCrashPlatform>[0]
    );
    /* v2.107.37: somebody else's crash is not our report. Checked before the
       breadcrumb too — Instagram's injected logger dying on our page should
       not even pollute the trail of a later, real crash. */
    const noise = classifyCrashNoise({
      errorName: name,
      errorMessage: message,
      stack: e.stack ?? "",
      platform,
      ownHost: location.host,
    });
    if (noise) {
      rawWarn(`[crash] ${noise} noise dropped:`, name, message.slice(0, 80));
      return;
    }
    if (floodDrop(name, message)) return;
    crumb("error", `${name}: ${message.slice(0, 120)}`);
    const report: QueuedReport = {
      platform,
      appVersion: APP_VERSION,
      errorName: name,
      errorMessage: message,
      stack: capCrashField(e.stack ?? "", CRASH_CAPS.stack),
      componentStack: extra?.componentStack
        ? capCrashField(extra.componentStack, CRASH_CAPS.componentStack)
        : "",
      breadcrumbs: capCrashField(JSON.stringify(crumbs), CRASH_CAPS.breadcrumbs),
      device: deviceInfo(),
      url: capCrashField(location.href, CRASH_CAPS.url),
      deviceId: capCrashField(getDeviceId(), CRASH_CAPS.id),
      sessionId,
    };
    const q = readQueue();
    q.push(report);
    writeQueue(q);
    void flush();
  } catch (e2) {
    rawWarn("[crash] report skipped:", e2);
  }
}

/** Install the hooks. Called ONCE, first thing in main.tsx — before React
 *  mounts, so even a crash during the very first render is caught. */
export function initCrashReporter(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  try {
    // Anything queued by a previous session that died before sending.
    void flush();

    window.addEventListener("error", (ev) => {
      // Resource-load errors (img/script 404s) target an element, carry no
      // `.error`, and are noise here — real throws carry the Error object.
      if (!ev.error && ev.target !== window) return;
      // Cross-origin masked errors: when a script from another origin throws, the
      // browser withholds the Error object and reports the sentinel "Script error."
      // with no usable filename. These are almost always injected third-party
      // scripts — OEM browsers (HonorBrowser et al.) and extensions — that we
      // neither own nor can diagnose; ingesting them only buries real crashes under
      // undiagnosable noise (the "stack" ends up being the reporter's own). Drop them.
      if (!ev.error && (!ev.filename || /^Script error\.?$/i.test(ev.message || ""))) return;
      reportCrash(ev.error ?? ev.message ?? "window.onerror", { kind: "WindowError" });
    });
    window.addEventListener("unhandledrejection", (ev) => {
      reportCrash(ev.reason ?? "unhandledrejection", { kind: "UnhandledRejection" });
    });
    window.addEventListener("pagehide", () => void flush(true));
    window.addEventListener("online", () => void flush());

    // ── Breadcrumb sources ────────────────────────────────────────────────
    crumb("life", "boot " + location.pathname);
    window.addEventListener("popstate", () => crumb("nav", location.pathname));
    // wouter navigates via pushState/replaceState — patch both so in-app route
    // changes land in the trail (popstate alone only sees Back).
    for (const m of ["pushState", "replaceState"] as const) {
      const orig = history[m].bind(history);
      history[m] = ((...args: Parameters<History["pushState"]>) => {
        const r = orig(...args);
        crumb("nav", location.pathname);
        return r;
      }) as History["pushState"];
    }
    document.addEventListener(
      "click",
      (ev) => {
        const el = ev.target as Element | null;
        if (!el || !el.tagName) return;
        const label =
          el.getAttribute?.("aria-label") ||
          el.getAttribute?.("title") ||
          (el.textContent || "").trim().slice(0, 32);
        crumb("tap", `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""} ${label}`.trim());
      },
      { capture: true, passive: true }
    );
    const origError = console.error.bind(console);
    console.error = (...args: unknown[]) => {
      try {
        crumb("error", args.map((a) => String(a)).join(" ").slice(0, 200));
      } catch {
        /* the trail is best-effort */
      }
      origError(...args);
    };
    document.addEventListener("visibilitychange", () =>
      crumb("life", document.visibilityState)
    );
  } catch (e) {
    rawWarn("[crash] init skipped:", e);
  }
}
