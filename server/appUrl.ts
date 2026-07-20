/**
 * v2.92 (R4B) — the SINGLE derivation point for the app's public base URL.
 *
 * Owner requirement: ZERO hardcoded deployment domains in server/, client/src/
 * and shared/. The same build serves the Manus deploy (.org) and the AWS
 * Mumbai self-host (.io); which one it is comes from env + the request Host
 * header, never from a source literal. (`server/noHardcodedDomains.test.ts`
 * pins this repo-wide.)
 *
 * Resolution order of `appBaseUrl(req?)`:
 *   1. APP_URL   — explicit full origin, e.g. "https://example.org" (already
 *                  the long-standing knob; trailing slashes stripped).
 *   2. DOMAIN    — bare-hostname convenience for self-host .envs, e.g.
 *                  "example.org" → "https://example.org". A pasted scheme or
 *                  trailing slash is tolerated.
 *   3. req       — `${x-forwarded-proto || https}://${x-forwarded-host || host}`
 *                  when a request is in hand (same trust-proxy reading the
 *                  auth routes have always used).
 *   4. null      — the caller decides how to degrade (the missed-call email
 *                  omits its absolute "Open RELAY" button, the VAPID subject
 *                  falls back to a neutral placeholder).
 *
 * SECURITY (final fix round, D1): an earlier draft inserted a fallback between
 * 3 and 4 — the origin most observed on real traffic, recorded by a request
 * middleware — so request-free contexts could still derive a URL on deploys
 * with no env set. It was REMOVED before ship: the ledger was poisonable by
 * anyone who could send requests (`x-forwarded-host` bursts at cold start
 * locking out the real origin via the entry cap, majority pumping, LB
 * health-check hostnames) and its output became ABSOLUTE LINKS in missed-call
 * emails — a link-hijack primitive. Request-free contexts now REQUIRE
 * APP_URL/DOMAIN and degrade gracefully without them. Do not reintroduce any
 * traffic-derived origin memory here.
 */

/** Minimal structural request type — Express `Request` satisfies it, tests can
 *  pass a bare object. */
export interface HostSource {
  headers: Record<string, unknown>;
  protocol?: string;
}

function headerStr(v: unknown): string {
  return Array.isArray(v) ? String(v[0] ?? "") : v == null ? "" : String(v);
}

/** `proto://host` for a request, or null when the Host header is absent. */
export function requestOrigin(req: HostSource): string | null {
  const proto =
    headerStr(req.headers["x-forwarded-proto"]).split(",")[0].trim() ||
    req.protocol ||
    "https";
  const host = (
    headerStr(req.headers["x-forwarded-host"]).split(",")[0].trim() ||
    headerStr(req.headers["host"]).split(",")[0].trim()
  );
  if (!host) return null;
  return `${proto}://${host}`;
}

/* ── the derivation ──────────────────────────────────────────────────────── */

function stripTrailingSlash(s: string): string {
  return s.replace(/\/+$/, "");
}

export function appBaseUrl(req?: HostSource): string | null {
  const envUrl = (process.env.APP_URL || "").trim();
  if (envUrl) return stripTrailingSlash(envUrl);
  const domain = (process.env.DOMAIN || "").trim();
  if (domain) {
    // Tolerate a pasted scheme/trailing slash; the var is meant to be bare.
    const bare = stripTrailingSlash(domain.replace(/^https?:\/\//i, ""));
    if (bare) return `https://${bare}`;
  }
  if (req) {
    const o = requestOrigin(req);
    if (o) return o;
  }
  return null;
}
