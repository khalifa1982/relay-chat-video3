import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * v2.92 (R4B, owner requirement) — ZERO hardcoded deployment domains.
 *
 * The same source tree serves BOTH production deployments (the Manus-hosted
 * .org and the AWS-Mumbai self-hosted .io); which domain an instance answers
 * as is decided entirely by env (APP_URL / DOMAIN) and the request Host header
 * via server/appUrl.ts (client side: window.location). A "your-chat" literal
 * in runtime source would silently pin one deployment's identity into the
 * other's build — this walks every runtime source file and forbids it.
 *
 * Scanned: server/, client/src/, client/public/, shared/ (final fix round P3
 * added client/public — sw.js and friends ship to the browser too), plus the
 * single files client/index.html (the SPA shell) and the repo-root
 * ecosystem.config.cjs (allowlisted below).
 *
 * Allowed list (deliberate, per the owner's scope):
 *   - *.test.* files            — fixtures may name real domains
 *   - mobile/**                 — the shipped APK is deliberately pinned to .org
 *   - scripts/**                — CLI conveniences (latency.mjs default arg)
 *   - docs / changelogs / .github workflows — not runtime source
 *   - ecosystem.config.cjs      — EXPLICIT allowlist entry: pm2 deploy config
 *     for the self-hosted .io fleet; it names its own deployment target on
 *     purpose (comments/paths), and it is deploy config, not app runtime
 *     source. Scanned so the entry is a conscious exemption, not a blind spot.
 */

const ROOT = path.resolve(__dirname, "..");
const SCAN_ROOTS = ["server", "client/src", "client/public", "shared"];
// Runtime-adjacent single files that live outside the walked roots.
const EXTRA_FILES = ["client/index.html", "ecosystem.config.cjs"];
// EXPLICIT allowlist — scanned, but allowed to contain a deployment domain
// (rationale in the header comment). Keep this list tiny and justified.
const ALLOWLIST = new Set(["ecosystem.config.cjs"]);
const SOURCE_EXT = /\.(ts|tsx|js|mjs|cjs|css|json|html|xml|txt|webmanifest)$/;
const TEST_FILE = /\.test\.(ts|tsx)$/;
// Deployment-identity literals: the two public domains, the Manus space host
// (any *.manus.space — the old canonical/sitemap/og:url leak), and the space
// slug itself so a re-introduction under another TLD still trips the scan.
const FORBIDDEN = /your-chat\.(org|io)|manus\.space|relaychat-lduywq6l/i;

function walk(dir: string, out: string[]): void {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules") continue;
      walk(p, out);
      continue;
    }
    if (!SOURCE_EXT.test(e.name)) continue;
    if (TEST_FILE.test(e.name)) continue;
    out.push(p);
  }
}

describe("no hardcoded deployment domains (v2.92 R4B)", () => {
  it("server/, client/src/, client/public/, shared/ + the SPA shell contain NO your-chat.org / your-chat.io / manus.space literals outside tests and the explicit allowlist", () => {
    const files: string[] = [];
    for (const root of SCAN_ROOTS) walk(path.join(ROOT, root), files);
    for (const f of EXTRA_FILES) {
      const p = path.join(ROOT, f);
      if (fs.existsSync(p)) files.push(p);
    }
    expect(files.length).toBeGreaterThan(100); // sanity: the walk actually walked
    // The SPA shell and the deploy config must actually be in the scan set.
    const rels = files.map(f => path.relative(ROOT, f));
    expect(rels).toContain(path.join("client", "index.html"));
    expect(rels).toContain("ecosystem.config.cjs");
    const offenders = files
      .filter(f => !ALLOWLIST.has(path.relative(ROOT, f)))
      .filter(f => FORBIDDEN.test(fs.readFileSync(f, "utf8")))
      .map(f => path.relative(ROOT, f));
    expect(offenders).toEqual([]);
  });

  it("sitemap.xml / robots.txt are DYNAMIC routes, not static files (they need per-deployment absolute URLs)", () => {
    expect(fs.existsSync(path.join(ROOT, "client/public/sitemap.xml"))).toBe(false);
    expect(fs.existsSync(path.join(ROOT, "client/public/robots.txt"))).toBe(false);
    const seo = fs.readFileSync(path.join(ROOT, "server/seo.ts"), "utf8");
    expect(seo).toMatch(/appBaseUrl\(req\)/);
    expect(fs.readFileSync(path.join(ROOT, "server/_core/index.ts"), "utf8")).toMatch(/registerSeo\(app\)/);
    // The SPA shell must not pin a canonical/og:url origin either — canonical
    // is injected at runtime from location.
    const shell = fs.readFileSync(path.join(ROOT, "client/index.html"), "utf8");
    expect(shell).not.toMatch(/rel="canonical" href="http/);
    expect(shell).not.toMatch(/property="og:url"/);
  });

  it("the derivation helper exists and the known former literal sites now use it", () => {
    const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
    expect(read("server/appUrl.ts")).toMatch(/export function appBaseUrl/);
    // D1 (final fix round): the observed-origin ledger must STAY deleted — a
    // traffic-derived origin memory is a link-hijack primitive.
    expect(read("server/appUrl.ts")).not.toMatch(/observeRequestOrigin|mostObservedOrigin/);
    expect(read("server/_core/index.ts")).not.toMatch(/observeRequestOrigin/);
    // Missed-call email links (request-free context; null omits the button).
    expect(read("server/_core/index.ts")).toMatch(/appBaseUrl\(\)/);
    // Registration/verification email links (request in hand).
    expect(read("server/authLocal.ts")).toMatch(/appBaseUrl\(req\)/);
    // VAPID subject.
    expect(read("server/webPush.ts")).toMatch(/vapidSubject/);
    // Marketing/legal pages derive the displayed host from the page's origin.
    expect(read("client/src/pages/Technology.tsx")).toMatch(/siteHost\(\)/);
    expect(read("client/src/pages/PrivacyPolicy.tsx")).toMatch(/siteHost\(\)/);
  });
});
