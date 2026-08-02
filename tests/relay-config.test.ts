import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { RELAY_APP_URL, RELAY_BASE_URL, isInternalUrl } from "../lib/relay-config";

describe("relay-config URL resolution", () => {
  it("derives a base URL with no trailing slash", () => {
    expect(RELAY_BASE_URL.endsWith("/")).toBe(false);
    expect(RELAY_BASE_URL.startsWith("http")).toBe(true);
  });

  it("builds the app entry URL under the base", () => {
    expect(RELAY_APP_URL).toBe(`${RELAY_BASE_URL}/app`);
  });

  it("treats same-host URLs as internal", () => {
    expect(isInternalUrl(`${RELAY_BASE_URL}/app/call`)).toBe(true);
    expect(isInternalUrl(`${RELAY_BASE_URL}/docs`)).toBe(true);
  });

  it("does NOT treat manus.im as internal — that OAuth flow was removed in v2.92", () => {
    // The rule allowed https?://*.manus.im — any subdomain, and cleartext — to load
    // inside the origin that holds the session, for a sign-in path the web app no
    // longer has. Dead code with live reach.
    expect(isInternalUrl("https://manus.im/app-auth?appId=abc")).toBe(false);
    expect(isInternalUrl("http://manus.im/app-auth")).toBe(false);
    expect(isInternalUrl("https://anything.manus.im/x")).toBe(false);
  });

  it("treats foreign https hosts as external", () => {
    expect(isInternalUrl("https://example.com/page")).toBe(false);
    expect(isInternalUrl("https://google.com")).toBe(false);
  });
});

describe("relay live endpoint reachability", () => {
  it("responds with a successful status for /app", async () => {
    const res = await fetch(RELAY_APP_URL, { method: "GET" });
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(400);
  }, 20000);
});

/* ── The WebView navigation gate ────────────────────────────────────────
 *
 * `isInternalUrl` decides what loads INSIDE the origin holding the session and
 * the native bridge. Three defects, all in the old Expo shell that the live
 * manifest still ships:
 *
 *  - it compared `hostname` only, so `http://your-chat.io` was "internal" and
 *    the session origin would load over cleartext;
 *  - `data:` and `blob:` were kept inside unconditionally;
 *  - `https?://*.manus.im` was allowed — any subdomain, cleartext included — for
 *    an OAuth flow the web app removed in v2.92.
 *
 * And the one that mattered most was not in this function at all: the caller's
 * fallback was `return true`, so anything that reached it was LOADED.
 */
describe("isInternalUrl — only https on the RELAY host", () => {
  it("accepts the site and real subdomains over https", () => {
    expect(isInternalUrl(`${RELAY_BASE_URL}/app`)).toBe(true);
    const host = new URL(RELAY_BASE_URL).hostname;
    expect(isInternalUrl(`https://www.${host}/app`)).toBe(true);
    expect(isInternalUrl(`https://${host.toUpperCase()}/app`)).toBe(true);
  });

  it("refuses cleartext to the very same host", () => {
    const host = new URL(RELAY_BASE_URL).hostname;
    expect(isInternalUrl(`http://${host}/app`)).toBe(false);
  });

  it("refuses a suffix look-alike", () => {
    const host = new URL(RELAY_BASE_URL).hostname;
    // `endsWith(host)` without the dot boundary would accept this.
    expect(isInternalUrl(`https://${host}.evil.tld/app`)).toBe(false);
    expect(isInternalUrl(`https://evil${host}/app`)).toBe(false);
  });

  it("refuses the dangerous schemes outright", () => {
    for (const u of [
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "blob:https://your-chat.io/abc",
      "file:///etc/passwd",
      "content://com.other.app/x",
      "intent://scan/#Intent;scheme=zxing;end",
    ]) {
      expect(isInternalUrl(u), u).toBe(false);
    }
  });

  it("still allows about:blank, which the WebView navigates to itself", () => {
    expect(isInternalUrl("about:blank")).toBe(true);
    // …but not the wider about: family.
    expect(isInternalUrl("about:srcdoc")).toBe(false);
  });

  it("handles junk without throwing", () => {
    for (const u of ["", "not a url", "://", "https://"]) {
      expect(() => isInternalUrl(u)).not.toThrow();
      expect(isInternalUrl(u)).toBe(false);
    }
  });
});

describe("the navigation fallback DENIES", () => {
  const SRC = readFileSync(resolve(__dirname, "..", "components/relay-webview.tsx"), "utf8");

  it("an unrecognised scheme is refused, not handed to the WebView", () => {
    // This was `return true` — "let the WebView decide". A `javascript:` URL is
    // not internal, not mailto/tel/sms and not http(s), so it fell straight
    // through to that line and loaded. Tightening isInternalUrl alone would not
    // have closed it; the fallback WAS the hole.
    const fn = SRC.slice(SRC.indexOf("const handleShouldStartLoad"), SRC.indexOf("// Receive messages"));
    expect(fn).toMatch(/return false;\s*\n\s*\}, \[\]\);/);
    expect(fn).not.toMatch(/Anything else \(custom schemes, etc\.\) — let the WebView decide\.\s*\n\s*return true;/);
  });

  it("the refusal is logged, so a genuinely-needed scheme is diagnosable", () => {
    expect(SRC).toMatch(/refused navigation to an unsupported scheme/);
  });

  it("the legitimate destinations are still handled", () => {
    const fn = SRC.slice(SRC.indexOf("const handleShouldStartLoad"), SRC.indexOf("// Receive messages"));
    expect(fn).toMatch(/if \(isInternalUrl\(url\)\) return true;/);
    expect(fn).toMatch(/mailto:\|tel:\|sms:/);
    expect(fn).toMatch(/\^https\?:/);
  });
});
