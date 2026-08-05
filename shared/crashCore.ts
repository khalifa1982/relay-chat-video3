/**
 * CRASH TELEMETRY — the pure core, shared by every reporter (v2.107.x).
 *
 * One file because the SAME rules must hold on both ends: the client truncates
 * before sending so a pathological stack never leaves the device, and the server
 * truncates again before storing so a client that skipped the first cap still
 * cannot write an unbounded row. Two implementations of "the cap" is how the two
 * ends drift until one of them is the bug.
 *
 * Everything here is platform-agnostic on purpose — no `crypto`, no DOM, no DB —
 * so it runs in the browser, in the Capacitor shells, in React Native and in
 * Node, and so the tests exercise the real functions rather than copies.
 *
 * ── WHY MESSAGES ARE NORMALIZED BEFORE GROUPING ────────────────────────────────
 * The whole value of a crash console is the GROUP, not the row: "this one error,
 * 3,000 times, since 2.107.12" is reviewable; 3,000 rows are not. But raw
 * messages carry ids, ports, uuids and timestamps ("fetch failed for user 48213"),
 * which would make every occurrence its own group. So the fingerprint input
 * replaces every number-ish token with a placeholder — the SHAPE of the error
 * groups, the specifics stay in the stored row.
 */

/** Every platform a report may claim. Anything else is clamped to "web" rather
 *  than rejected: a mislabelled crash is still worth keeping, an invented enum
 *  value in the table is not. `server` exists because the Node process reports
 *  its own uncaught exceptions through the same pipe. The `-shell` pair is the
 *  Capacitor apps' NATIVE layer (Java / NSException, v2.107.21) — distinct from
 *  plain "ios"/"android", which is the SAME web bundle reporting from inside
 *  those shells, and from "-native", which is the React Native app. */
export const CRASH_PLATFORMS = [
  "web",
  "ios",
  "android",
  "ios-native",
  "android-native",
  "ios-shell",
  "android-shell",
  "server",
] as const;
export type CrashPlatform = (typeof CRASH_PLATFORMS)[number];

export function normalizeCrashPlatform(v: unknown): CrashPlatform {
  return (CRASH_PLATFORMS as readonly string[]).includes(String(v))
    ? (v as CrashPlatform)
    : "web";
}

/** Storage caps, in characters. Applied on the client BEFORE queueing (so the
 *  localStorage queue and the request body stay small) and on the server AGAIN
 *  before the INSERT (so the row is bounded even for a client that lied). */
export const CRASH_CAPS = {
  name: 128,
  message: 4_000,
  stack: 30_000,
  componentStack: 8_000,
  breadcrumbs: 20_000,
  device: 2_000,
  url: 512,
  id: 64, // deviceId / sessionId
  version: 32,
} as const;

/** Truncate with an explicit marker — a silently-cut stack looks complete and
 *  sends whoever reads it hunting for a frame that was never recorded. */
export function capCrashField(s: unknown, max: number): string {
  const str = typeof s === "string" ? s : s == null ? "" : String(s);
  if (str.length <= max) return str;
  return str.slice(0, max) + `…[+${str.length - max}]`;
}

/** Replace every number-ish token so two occurrences of the same defect produce
 *  the same string: uuids, hex runs, and bare integers all become placeholders.
 *  Order matters — uuids first, or their hex segments get eaten piecemeal. */
export function normalizeCrashMessage(msg: string): string {
  return msg
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<uuid>")
    .replace(/0x[0-9a-f]+/gi, "<hex>")
    .replace(/\b[0-9a-f]{7,}\b/gi, "<hex>")
    .replace(/\b\d+\b/g, "#")
    .slice(0, 512);
}

/** The first meaningful frames of a stack, with line:column and cache-busting
 *  query strings stripped — a rebuild moves every line number, and the group
 *  must survive a rebuild or each release starts its history from zero. */
export function crashTopFrames(stack: string | null | undefined, n = 3): string[] {
  if (!stack) return [];
  const out: string[] = [];
  for (const raw of stack.split("\n")) {
    const line = raw.trim();
    // V8: "at fn (url:1:2)" / "at url:1:2"; Firefox/Safari: "fn@url:1:2".
    if (!/^at\s|@/.test(line)) continue;
    out.push(
      line
        .replace(/\?[^:)\s]*/g, "") // ?v=hash cache busters
        .replace(/:\d+:\d+\)?$/, "") // trailing line:col
        .replace(/:\d+\)?$/, "")
        .slice(0, 200)
    );
    if (out.length >= n) break;
  }
  return out;
}

/** The string the fingerprint hashes. The HASHING itself lives server-side
 *  (Node `crypto`); the client never needs the digest, only the server groups. */
export function crashFingerprintInput(
  name: string,
  message: string,
  stack: string | null | undefined
): string {
  return [name.slice(0, 128), normalizeCrashMessage(message), ...crashTopFrames(stack, 3)].join(
    "\n"
  );
}

/* ── Breadcrumbs ──────────────────────────────────────────────────────────────
   A fixed-size ring of "what happened just before" — navigation, taps, console
   errors. Thirty entries is enough to see the path into a crash and small
   enough that the serialized trail stays a fraction of the breadcrumbs cap. */

export type CrashBreadcrumb = {
  /** Seconds since page/app start, one decimal — absolute clocks differ per
   *  device and add nothing; "4.2s in, tapped Call" is the useful shape. */
  t: number;
  kind: "nav" | "tap" | "error" | "net" | "life";
  msg: string;
};

export const CRASH_BREADCRUMB_MAX = 30;

/** Push into the ring IN PLACE and return the same array — the reporter holds
 *  one long-lived buffer and the crash snapshot copies it. */
export function pushCrashBreadcrumb(
  list: CrashBreadcrumb[],
  crumb: CrashBreadcrumb,
  max = CRASH_BREADCRUMB_MAX
): CrashBreadcrumb[] {
  list.push({ ...crumb, msg: crumb.msg.slice(0, 200) });
  while (list.length > max) list.shift();
  return list;
}

/** Capacitor injects `window.Capacitor`; its `getPlatform()` answers "ios" /
 *  "android" / "web". Detected rather than configured so the SAME deployed web
 *  bundle labels itself correctly inside each shell — which is the whole trick
 *  that makes the iOS and Android apps report without an app-store release. */
export function detectCrashPlatform(win: {
  Capacitor?: { getPlatform?: () => string };
}): CrashPlatform {
  try {
    const p = win.Capacitor?.getPlatform?.();
    if (p === "ios" || p === "android") return p;
  } catch {
    /* a broken bridge must never break the reporter */
  }
  return "web";
}

/** How long two reports with the same fingerprint from the same session are
 *  treated as ONE row with a bumped counter. A render-loop crash can fire
 *  hundreds of times a second; the counter keeps the truth ("this happened
 *  400 times") without four hundred inserts. */
export const CRASH_STORM_WINDOW_SEC = 60;

/**
 * Numeric dotted-version compare for the SOLVED workflow (v2.107.23): a crash
 * marked solved-in-2.107.22 must stay hidden for stale clients still running
 * 2.107.21, and must RESURFACE the moment the same fingerprint arrives from
 * 2.107.23 — that is a regression, and it un-hides itself. String compare is
 * wrong here ("2.107.9" > "2.107.10" lexically); this splits on dots and
 * compares numerically, missing segments read as 0.
 */
export function compareAppVersions(a: string, b: string): -1 | 0 | 1 {
  const pa = a.split(".").map(s => parseInt(s, 10) || 0);
  const pb = b.split(".").map(s => parseInt(s, 10) || 0);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}

/**
 * NOISE, CLASSIFIED (v2.107.37) — the owner asked to "check the crash report
 * and fix it"; the check found ELEVEN rows and zero application crashes. The
 * fix is therefore this filter, one pure function used by BOTH the client
 * reporter and the server ingest, so the console only ever shows crashes that
 * are OURS to fix. Three classes, each named after a real production row:
 *
 *   "abort"                — AbortError is cancellation as control flow: a
 *                            navigation aborts a fetch, an unmount interrupts
 *                            play() (rows 5 & 6 — "The play() request was
 *                            interrupted because the media was removed…").
 *   "opaque-cross-origin"  — the browser's redaction of an error thrown by a
 *                            script it will not let us read: the literal
 *                            string "Script error." and nothing else (rows
 *                            9 & 10, HonorBrowser's injection on the landing
 *                            page). There is nothing inside to fix.
 *   "foreign-script"       — every URL frame in the stack belongs to somebody
 *                            ELSE'S script: an in-app browser's injected
 *                            logger, an extension. Row 13 was Instagram's own
 *                            `iabjs://navigation_performance_logger_android`
 *                            dying on our page. A crash of OURS always shows
 *                            at least one frame on our host.
 *
 * Native shells are exempt from the web-only rules — their stacks carry no
 * URLs — and a report with no URL frames at all is KEPT, because "could be
 * ours" must never be dropped. `ownHost` empty skips the foreign rule too:
 * better a stray row than a silenced real crash.
 */
/**
 * A readable message + name for something thrown that is NOT an Error.
 *
 * `String(someObject)` is "[object Object]" — which is exactly what a real crash
 * from an unhandledrejection carrying a plain object produced (crash #14,
 * v2.107.41): a genuine failure with every diagnostic byte thrown away. This
 * digs out whatever the value actually carries — a `.message`/`.error`/`.reason`
 * string, a `.name`/`.code`, or a JSON snapshot — so the report says something.
 * Returns `{ name, message, empty }`; `empty` is true when the value yielded no
 * usable content at all (e.g. `{}`), which the noise classifier uses to drop
 * undiagnosable OEM-injected throws instead of storing a wall of "[object Object]".
 */
export function describeThrowable(err: unknown): { name: string; message: string; empty: boolean } {
  if (typeof err === "string") return { name: "Error", message: err, empty: err.trim() === "" };
  if (err == null) return { name: "Error", message: String(err), empty: false };
  if (typeof err !== "object") return { name: "Error", message: String(err), empty: false };

  const o = err as Record<string, unknown>;
  const pick = (v: unknown): string => (typeof v === "string" && v.trim() ? v.trim() : "");
  // Common shapes: {message}, {error:"…"}, {reason:"…"}, DOMException-ish {name,code}.
  let message = pick(o.message) || pick(o.error) || pick(o.reason) || pick(o.description);
  const name = pick(o.name) || "Error";
  const code = pick(o.code) || (typeof o.code === "number" ? String(o.code) : "");

  if (!message) {
    // No obvious string field — take a bounded JSON snapshot of own enumerable keys.
    try {
      const keys = Object.keys(o);
      if (keys.length > 0) {
        const snap = JSON.stringify(o, keys.slice(0, 12));
        if (snap && snap !== "{}") message = snap.slice(0, 300);
      }
    } catch {
      /* circular / unserialisable — fall through to empty */
    }
  }
  if (!message && code) message = name + " " + code;

  const empty = message === "";
  return { name, message: message || "[non-Error thrown, no message]", empty };
}

export function classifyCrashNoise(input: {
  errorName: string;
  errorMessage: string;
  stack: string | null | undefined;
  platform: string;
  ownHost: string;
}): null | "abort" | "opaque-cross-origin" | "foreign-script" | "empty-throwable" {
  const name = (input.errorName || "").trim();
  const msg = (input.errorMessage || "").trim();
  if (name === "AbortError") return "abort";
  if (input.platform !== "web") return null;
  if (/^Script error\.?$/.test(msg)) return "opaque-cross-origin";
  // An object thrown with NO usable content (the "[object Object]" / empty-{}
  // case the reporter tags with this sentinel) is undiagnosable no matter where
  // it came from — there is nothing to fix and nothing to group on. Crash #14
  // was exactly this: an unhandledrejection carrying a bare object on an OEM
  // browser, whose only stack frames were the reporter itself. Checked before
  // the frame-origin rule because the origin does not change the verdict.
  if (msg === EMPTY_THROWABLE_SENTINEL) return "empty-throwable";

  const frames = (input.stack || "").match(/[a-z][a-z0-9+.-]*:\/\/[^\s)]+/gi) ?? [];
  if (frames.length > 0 && input.ownHost) {
    const own = frames.some((f) => {
      try {
        return new URL(f).host === input.ownHost;
      } catch {
        return false;
      }
    });
    if (!own) return "foreign-script";
  }
  return null;
}

/** Marker the client stamps as the message when describeThrowable found nothing;
 *  lets the shared classifier recognise an undiagnosable object-throw. */
export const EMPTY_THROWABLE_SENTINEL = "[non-Error thrown, no message]";
