/* Single source of truth for the app version + the build-stamped footer line. */

// Injected by Vite `define` at build time (see vite.config.ts).
declare const __BUILD_DATE__: string;

export const APP_VERSION = "2.43.1";

/** Build date (UTC YYYY-MM-DD), stamped at build time. Falls back to the current
 *  date in dev/test where the Vite `define` isn't applied. */
export const BUILD_DATE: string =
  typeof __BUILD_DATE__ !== "undefined"
    ? __BUILD_DATE__
    : new Date().toISOString().slice(0, 10);

export const BUILD_YEAR = BUILD_DATE.slice(0, 4);

/** Copyright + version + build date, e.g. "© 2026 RELAY · v2.12.0 · 2026-06-14". */
export const FOOTER_LINE = `© ${BUILD_YEAR} RELAY · v${APP_VERSION} · ${BUILD_DATE}`;
