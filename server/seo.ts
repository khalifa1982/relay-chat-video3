/**
 * Dynamic /sitemap.xml + /robots.txt (v2.92 R4B follow-up).
 *
 * These two files used to be static assets in client/public with the Manus
 * space URL baked in — the last hardcoded deployment domain in the shipped
 * tree. One build serves every deployment (.org on Manus, .io on AWS), so the
 * absolute URLs a crawler needs can only be known per-request: both routes
 * derive their origin from appBaseUrl(req) (APP_URL → DOMAIN → request Host),
 * exactly like the email links and the VAPID subject.
 *
 * The static files are deleted; these Express routes are registered BEFORE the
 * static/SPA middleware, so they answer in both dev (ahead of Vite) and prod.
 */
import type { Express, Request, Response } from "express";
import { appBaseUrl } from "./appUrl";

/** Public, indexable routes (keep in sync with client/src/App.tsx). */
export const SITEMAP_PATHS: ReadonlyArray<{ path: string; changefreq: string; priority: string }> = [
  { path: "/", changefreq: "weekly", priority: "1.0" },
  { path: "/docs", changefreq: "monthly", priority: "0.5" },
  { path: "/technology", changefreq: "monthly", priority: "0.5" },
  { path: "/privacy-policy", changefreq: "yearly", priority: "0.3" },
  { path: "/turn-test", changefreq: "monthly", priority: "0.3" },
];

/** Build the sitemap for a concrete origin (no trailing slash). */
export function sitemapXml(base: string): string {
  const origin = base.replace(/\/+$/, "");
  const urls = SITEMAP_PATHS.map(
    p =>
      `  <url>\n    <loc>${origin}${p.path}</loc>\n    <changefreq>${p.changefreq}</changefreq>\n    <priority>${p.priority}</priority>\n  </url>`
  ).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

/** robots.txt — the Sitemap line needs an absolute URL, so it is omitted when
 *  no origin can be derived (env-less AND request-less never happens on a real
 *  request; the null branch exists for defensiveness + tests). */
export function robotsTxt(base: string | null): string {
  const lines = ["User-agent: *", "Allow: /", ""];
  if (base) lines.push(`Sitemap: ${base.replace(/\/+$/, "")}/sitemap.xml`, "");
  return lines.join("\n");
}

export function registerSeo(app: Express): void {
  app.get("/robots.txt", (req: Request, res: Response) => {
    res
      .type("text/plain")
      .setHeader("Cache-Control", "public, max-age=3600")
      .send(robotsTxt(appBaseUrl(req)));
  });
  app.get("/sitemap.xml", (req: Request, res: Response) => {
    const base = appBaseUrl(req);
    // Unreachable in practice (a real request always carries a Host header),
    // but a sitemap without absolute URLs is spec-invalid — refuse honestly.
    if (!base) {
      res.status(404).type("text/plain").send("sitemap unavailable: no origin configured");
      return;
    }
    res
      .type("application/xml")
      .setHeader("Cache-Control", "public, max-age=3600")
      .send(sitemapXml(base));
  });
}
