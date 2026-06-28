import { describe, expect, it } from "vitest";

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

  it("treats manus.im auth URLs as internal so sign-in completes in-app", () => {
    expect(isInternalUrl("https://manus.im/app-auth?appId=abc")).toBe(true);
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
