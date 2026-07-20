import { describe, it, expect } from "vitest";
import { sitemapXml, robotsTxt, SITEMAP_PATHS } from "./seo";

/**
 * v2.92 R4B follow-up — sitemap/robots are dynamic, origin-derived routes.
 * The builders are pure: base in, document out. No deployment domain may be
 * baked in (noHardcodedDomains.test.ts walks the source; these tests pin the
 * behavior side).
 */
describe("dynamic SEO endpoints", () => {
  it("sitemap derives every <loc> from the passed origin", () => {
    const xml = sitemapXml("https://calls.example");
    expect(xml).toContain("<loc>https://calls.example/</loc>");
    expect(xml).toContain("<loc>https://calls.example/docs</loc>");
    expect(xml).toContain("<loc>https://calls.example/turn-test</loc>");
    // one <url> per public path, nothing else
    expect(xml.match(/<url>/g)?.length).toBe(SITEMAP_PATHS.length);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"');
  });

  it("sitemap normalizes a trailing slash on the base (no double slashes)", () => {
    const xml = sitemapXml("https://calls.example/");
    expect(xml).toContain("<loc>https://calls.example/</loc>");
    expect(xml).not.toContain("https://calls.example//");
  });

  it("robots carries an absolute Sitemap line only when an origin exists", () => {
    const withBase = robotsTxt("https://calls.example");
    expect(withBase).toContain("User-agent: *");
    expect(withBase).toContain("Allow: /");
    expect(withBase).toContain("Sitemap: https://calls.example/sitemap.xml");
    const without = robotsTxt(null);
    expect(without).toContain("User-agent: *");
    expect(without).not.toContain("Sitemap:");
  });

  it("no deployment domain is baked into the builders' output", () => {
    const all = sitemapXml("https://x.example") + robotsTxt("https://x.example");
    expect(all).not.toMatch(/your-chat|manus\.space|relaychat/i);
  });
});
