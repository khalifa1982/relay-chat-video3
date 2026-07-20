import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { appBaseUrl, requestOrigin } from "./appUrl";

/**
 * v2.92 (R4B) — the single base-URL derivation helper. Priority:
 * APP_URL → DOMAIN → the request's proto/host → null.
 *
 * D1 (final fix round): there is deliberately NO traffic-derived fallback —
 * an observed-origin ledger was removed because x-forwarded-host is attacker
 * controlled and its output fed absolute links in missed-call emails. The
 * null-when-no-env-and-no-request behavior is pinned below.
 */

const req = (headers: Record<string, unknown>, protocol?: string) => ({ headers, protocol });

describe("appBaseUrl derivation order", () => {
  const KEYS = ["APP_URL", "DOMAIN"] as const;
  let saved: Record<string, string | undefined>;
  beforeEach(() => {
    saved = Object.fromEntries(KEYS.map(k => [k, process.env[k]]));
    for (const k of KEYS) delete process.env[k];
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k] as string;
    }
  });

  it("APP_URL wins outright (trailing slashes stripped)", () => {
    process.env.APP_URL = "https://calls.example.io///";
    process.env.DOMAIN = "other.example.org";
    expect(appBaseUrl(req({ host: "req.example.net" }))).toBe("https://calls.example.io");
  });

  it("DOMAIN is a bare-hostname convenience — scheme/slash tolerated but not required", () => {
    process.env.DOMAIN = "calls.example.io";
    expect(appBaseUrl()).toBe("https://calls.example.io");
    process.env.DOMAIN = "https://calls.example.io/";
    expect(appBaseUrl()).toBe("https://calls.example.io");
  });

  it("with no env, a request's forwarded proto/host is used (trust-proxy reading)", () => {
    expect(
      appBaseUrl(req({ "x-forwarded-proto": "https, http", "x-forwarded-host": "www.example.org", host: "10.0.0.5:3000" }))
    ).toBe("https://www.example.org");
    // Plain Host header + no forwarded proto defaults to https.
    expect(appBaseUrl(req({ host: "example.org" }))).toBe("https://example.org");
    // req.protocol is consulted when no x-forwarded-proto (dev over http).
    expect(appBaseUrl(req({ host: "localhost:3000" }, "http"))).toBe("http://localhost:3000");
  });

  it("with no env and no request, returns null — NEVER an origin remembered from traffic (D1)", () => {
    // Request-free contexts (missed-call email, VAPID subject) must degrade;
    // a Host-header-derived memory here would let anyone steer email links.
    expect(appBaseUrl()).toBeNull();
  });

  it("requestOrigin returns null without a Host header (caller decides the degrade)", () => {
    expect(requestOrigin(req({}))).toBeNull();
    expect(appBaseUrl(req({}))).toBeNull();
  });
});
