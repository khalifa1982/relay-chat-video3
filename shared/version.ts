/* Single source of truth for the app version, shared by the client (baked into
 * the bundle at build) and the server (served at runtime from /api/version).
 *
 * The auto-update checker compares the client's BAKED version against the
 * server's RUNTIME version: after a new deploy they differ, which is how an
 * already-loaded tab learns a fresh version is live. Bump this on every release. */
export const APP_VERSION = "2.105.3";
