/**
 * Sentry (v2.107.78, owner: "chase all errors"). The org's error tracker, wired
 * ALONGSIDE the homegrown crash reporter rather than instead of it — the Admin
 * crash panel reads the in-house table and keeps working; Sentry adds the
 * cross-release aggregation, grouping and alerting the panel does not do.
 *
 * TWO capture paths, deliberately:
 *   1. Sentry's OWN global hooks (installed by init): breadcrumbs, console
 *      context, unhandled errors it sees first.
 *   2. A FORWARD from `reportCrash` — the one choke point the in-house net
 *      already routes window.onerror, unhandledrejection AND render crashes
 *      through — so anything that pipe catches reaches Sentry too, tagged with
 *      the same kind. Sentry dedupes the overlap by event fingerprint.
 *
 * The DSN is PUBLIC BY DESIGN (it can only ingest, never read) — hardcoding it
 * is the documented deployment model and is what makes this work inside the
 * native shells with zero configuration. The org API token is NOT here and must
 * never be: that one can read.
 */
import * as Sentry from "@sentry/react";
import { APP_VERSION } from "@shared/version";

const DSN = "https://f41ffd91134ac10b69b8153edf69ed7c@o4511875054108672.ingest.us.sentry.io/4511875279814656";

/** Noise that would drown the signal, dropped client-side so it never spends
 *  quota: benign browser loop warnings, user-cancelled fetches, and the offline
 *  flap every phone produces in a tunnel. Real request failures still surface
 *  server-side where they are one event, not one per affected phone. */
const IGNORE = [
  /ResizeObserver loop/i,
  /^AbortError/i,
  /Failed to fetch/i,
  /NetworkError when attempting/i,
  /Load failed/i, // Safari's spelling of the same offline fetch
];

export function initSentry(): void {
  // Dev servers stay quiet: a hot-reload loop can mint hundreds of synthetic
  // errors a minute, and localhost stacks are not actionable in aggregate.
  if (!import.meta.env.PROD) return;
  try {
    Sentry.init({
      dsn: DSN,
      release: `relay-web@${APP_VERSION}`,
      environment: "production",
      sampleRate: 1,
      // Tracing and replay OFF: this install is for ERRORS. Both cost bundle,
      // battery and quota, and the vitals/session telemetry already in this app
      // covers the performance questions.
      tracesSampleRate: 0,
      beforeSend(event, hint) {
        const msg =
          (hint?.originalException as { message?: string } | undefined)?.message ??
          event.message ??
          event.exception?.values?.[0]?.value ??
          "";
        if (IGNORE.some((re) => re.test(String(msg)))) return null;
        return event;
      },
    });
  } catch {
    /* telemetry must never be the crash */
  }
}

/** The forward from the in-house pipe. Guarded so a Sentry hiccup can never turn
 *  crash REPORTING into a crash. */
export function sentryCapture(err: unknown, extra?: Record<string, unknown>): void {
  try {
    Sentry.captureException(err, { extra });
  } catch {
    /* */
  }
}
