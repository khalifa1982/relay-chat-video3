import { describe, it, expect } from "vitest";
import { rememberToTtlMs } from "./authLocal";

const DAY = 24 * 60 * 60 * 1000;

/**
 * "Remember me" (login overhaul): the sign-in mutations (verifyOtp,
 * loginWithPin) map the client's choice to a session-cookie lifetime.
 *   0        → session cookie (browser-close; setSessionCookie omits maxAge)
 *   30/60/90 → that many days
 *   omitted  → undefined → the historical 1-year default (no regression)
 */
describe("rememberToTtlMs", () => {
  it("maps 0 to a session cookie (ttl 0)", () => {
    expect(rememberToTtlMs(0)).toBe(0);
  });

  it("maps 30/60/90 to day-milliseconds", () => {
    expect(rememberToTtlMs(30)).toBe(30 * DAY);
    expect(rememberToTtlMs(60)).toBe(60 * DAY);
    expect(rememberToTtlMs(90)).toBe(90 * DAY);
  });

  it("falls back to the default (undefined) for omitted / unexpected values", () => {
    expect(rememberToTtlMs(undefined)).toBeUndefined();
    expect(rememberToTtlMs(null)).toBeUndefined();
    expect(rememberToTtlMs(45)).toBeUndefined(); // not an offered option
    expect(rememberToTtlMs(-1)).toBeUndefined();
  });
});
