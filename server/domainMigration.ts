import type { Express } from "express";

/**
 * Domain-migration shim (owner decision, 2026-07-21): the Manus-hosted
 * your-chat.org deployment was emptied and retired — your-chat.io (AWS) is the
 * ONLY live deployment. Any traffic still arriving under the old Host (stale
 * links, old APK/TWA installs, search results) is permanently redirected to the
 * same path on .io.
 *
 * This file is the ONE deliberate place in runtime source allowed to name the
 * deployment domains (allowlisted in server/noHardcodedDomains.test.ts, like
 * ecosystem.config.cjs): a cross-domain 301 shim is domain-specific BY
 * DEFINITION — env-deriving it would just silently drop the redirect on a
 * misconfigured box. Everything else stays env/Host-driven via appBaseUrl().
 *
 * Notes:
 *  - 301s only help GET navigations. API POSTs (tRPC mutations) do NOT survive
 *    a redirect, which is why the mobile clients were repointed at .io directly
 *    (v2.95.4) rather than relying on this shim.
 *  - Only fires when .org DNS actually resolves to this fleet; harmless
 *    otherwise. Health checks (localhost/IP Hosts) never match.
 */
const RETIRED_HOSTS = new Set(["your-chat.org", "www.your-chat.org"]);
const CANONICAL_ORIGIN = "https://your-chat.io";

export function registerDomainMigration(app: Express): void {
  app.use((req, res, next) => {
    const host = (req.headers.host || "").replace(/:.*$/, "").toLowerCase();
    if (RETIRED_HOSTS.has(host)) {
      return res.redirect(301, `${CANONICAL_ORIGIN}${req.originalUrl}`);
    }
    next();
  });
}
