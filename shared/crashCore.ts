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
