/**
 * Central configuration for the RELAY web app that the mobile shell mirrors.
 *
 * The base URL can be overridden at build/run time via the public env var
 * `EXPO_PUBLIC_RELAY_URL`. It falls back to the production RELAY site.
 *
 * Because this is a thin shell, ALL features live on the web app — changing the
 * web app automatically changes what the mobile app shows.
 */

const DEFAULT_BASE_URL = "https://your-chat.io";

/** Trim a trailing slash so we can safely append paths. */
function normalizeBaseUrl(raw: string | undefined): string {
  const value = (raw ?? "").trim();
  const base = value.length > 0 ? value : DEFAULT_BASE_URL;
  return base.replace(/\/+$/, "");
}

export const RELAY_BASE_URL = normalizeBaseUrl(process.env.EXPO_PUBLIC_RELAY_URL);

/** The actual app entry point inside the RELAY site. */
export const RELAY_APP_URL = `${RELAY_BASE_URL}/app`;

/**
 * Returns true when a navigated URL belongs to the RELAY site (should stay
 * inside the WebView) versus an external link (should open in the system
 * browser / native handler).
 */
export function isInternalUrl(url: string): boolean {
  if (!url) return false;
  // Always keep about:blank and data/blob URLs inside the WebView.
  if (/^(about:|data:|blob:)/i.test(url)) return true;
  // Keep RELAY OAuth (manus.im app-auth) inside so sign-in completes in-app.
  if (/^https?:\/\/([a-z0-9-]+\.)*manus\.im\//i.test(url)) return true;
  try {
    const target = new URL(url);
    const base = new URL(RELAY_BASE_URL);
    return target.hostname === base.hostname;
  } catch {
    return false;
  }
}
