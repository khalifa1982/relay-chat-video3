/**
 * Sentry, server side (v2.107.78). Imported as the FIRST line of the entry so
 * its process hooks (uncaughtException, unhandledRejection) exist before any
 * other module can throw. The DSN is the ingest-only public key for the
 * relay-server project; the readable org token is not in this repo and must
 * never be.
 */
import * as Sentry from "@sentry/node";
import { APP_VERSION } from "@shared/version";

const DSN = "https://84b4b6d75a3d15d3512d7e9207bc365a@o4511875054108672.ingest.us.sentry.io/4511875279880192";

const enabled = process.env.NODE_ENV !== "development" && process.env.SENTRY_OFF !== "1";

if (enabled) {
  try {
    Sentry.init({
      dsn: DSN,
      release: `relay-server@${APP_VERSION}`,
      environment: "production",
      sampleRate: 1,
      tracesSampleRate: 0, // errors-only install; perf has its own telemetry
    });
  } catch {
    /* telemetry must never be the outage */
  }
}

/** tRPC onError hook: only the UNEXPECTED classes reach Sentry. The codes a
 *  working product emits on purpose — auth walls, not-founds, input rejections,
 *  rate limits — are the product working, and forwarding them would bury the one
 *  INTERNAL_SERVER_ERROR that matters under a thousand UNAUTHORIZED a minute. */
const EXPECTED = new Set([
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "BAD_REQUEST",
  "CONFLICT",
  "PRECONDITION_FAILED",
  "PAYLOAD_TOO_LARGE",
  "TOO_MANY_REQUESTS",
  "CLIENT_CLOSED_REQUEST",
]);

export function sentryTrpcError(opts: { error: { code: string; cause?: unknown }; path?: string }): void {
  if (!enabled) return;
  if (EXPECTED.has(opts.error.code)) return;
  try {
    Sentry.captureException(opts.error.cause ?? opts.error, {
      extra: { trpcPath: opts.path ?? "?", trpcCode: opts.error.code },
    });
  } catch {
    /* */
  }
}
