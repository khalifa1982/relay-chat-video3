import { describe, it, expect } from "vitest";
import { generateOtp, hashOtp, verifyOtpHash, dispatchOtp } from "./authOtp";

/**
 * v2.68 passwordless email-OTP — pure crypto/format + dev-fallback guards.
 * DB-backed helpers (mint/latest/consume/attempts) are exercised at the router
 * layer; here we pin the security-critical primitives that don't need a DB.
 */
describe("generateOtp", () => {
  it("is always a zero-padded 6-digit string", () => {
    for (let i = 0; i < 200; i++) {
      const code = generateOtp();
      expect(code).toMatch(/^\d{6}$/);
      expect(code.length).toBe(6);
    }
  });
  it("produces varied codes (not a constant)", () => {
    const set = new Set(Array.from({ length: 50 }, () => generateOtp()));
    expect(set.size).toBeGreaterThan(5);
  });
});

describe("hashOtp / verifyOtpHash", () => {
  it("round-trips a code and rejects the wrong one", () => {
    const code = "042195";
    const hash = hashOtp(code);
    expect(hash).not.toContain(code); // never stored in the clear
    expect(verifyOtpHash(code, hash)).toBe(true);
    expect(verifyOtpHash("042196", hash)).toBe(false);
    expect(verifyOtpHash("", hash)).toBe(false);
  });
  it("never throws on a malformed stored hash", () => {
    expect(verifyOtpHash("123456", "not-a-hash")).toBe(false);
  });
});

describe("dispatchOtp dev fallback", () => {
  it("returns true in dev even when email is disabled (code discoverable in logs)", async () => {
    const prevEnv = process.env.NODE_ENV;
    const prevKey = process.env.RESEND_API_KEY;
    delete process.env.RESEND_API_KEY; // email disabled
    process.env.NODE_ENV = "development";
    try {
      await expect(dispatchOtp("dev@example.com", "123456")).resolves.toBe(true);
    } finally {
      process.env.NODE_ENV = prevEnv;
      if (prevKey !== undefined) process.env.RESEND_API_KEY = prevKey;
    }
  });

  it("returns false in production when email can't be sent (UI must surface the failure)", async () => {
    const prevEnv = process.env.NODE_ENV;
    const prevKey = process.env.RESEND_API_KEY;
    const prevDev = process.env.RELAY_OTP_DEV_LOG;
    delete process.env.RESEND_API_KEY;
    delete process.env.RELAY_OTP_DEV_LOG;
    process.env.NODE_ENV = "production";
    try {
      await expect(dispatchOtp("real@example.com", "654321")).resolves.toBe(false);
    } finally {
      process.env.NODE_ENV = prevEnv;
      if (prevKey !== undefined) process.env.RESEND_API_KEY = prevKey;
      if (prevDev !== undefined) process.env.RELAY_OTP_DEV_LOG = prevDev;
    }
  });
});
