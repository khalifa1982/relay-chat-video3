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
 * Returns true when a navigated URL belongs to the RELAY site and may therefore
 * load INSIDE the WebView — which is to say, inside the origin that holds the
 * user's session and the native bridge. Everything else must go to the system
 * browser or be refused.
 *
 * Hardened (audit): the old gate compared `hostname` only, so `http://your-chat.io`
 * counted as internal and the shell would load the session origin over cleartext.
 * It also kept `data:` and `blob:` inside unconditionally, and allowed
 * `https?://*.manus.im` for a Manus OAuth flow the web app removed in v2.92 —
 * over any subdomain and over cleartext.
 */
export function isInternalUrl(url: string): boolean {
  if (!url) return false;
  // about:blank only. WebViews navigate to it themselves during setup, so
  // refusing it breaks the view; the wider `about:` family is not needed.
  if (/^about:blank$/i.test(url)) return true;
  try {
    const target = new URL(url);
    const base = new URL(RELAY_BASE_URL);
    // HTTPS ONLY. Without this, `http://your-chat.io` was "internal" and the
    // origin holding the session loaded over cleartext.
    if (target.protocol !== "https:") return false;
    const host = target.hostname.toLowerCase();
    const baseHost = base.hostname.toLowerCase();
    // Exact host, or a REAL subdomain. `endsWith(baseHost)` alone would accept
    // `your-chat.io.evil.com`, so the dot is required and checked against the
    // suffix boundary.
    return host === baseHost || host.endsWith("." + baseHost);
  } catch {
    return false;
  }
}
