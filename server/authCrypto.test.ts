import { describe, it, expect } from "vitest";
import {
  hashPassword,
  verifyPassword,
  genToken,
  safeEqualHex,
  normalizeEmail,
  isValidEmail,
  passwordIssue,
  signSession,
  verifySession,
} from "./authCrypto";

describe("password hashing (scrypt)", () => {
  it("verifies the correct password and rejects wrong ones", () => {
    const h = hashPassword("Hunter2pass");
    expect(h.startsWith("scrypt$")).toBe(true);
    expect(verifyPassword("Hunter2pass", h)).toBe(true);
    expect(verifyPassword("hunter2pass", h)).toBe(false);
    expect(verifyPassword("", h)).toBe(false);
  });
  it("uses a fresh salt per hash (no two hashes match)", () => {
    expect(hashPassword("samepass1")).not.toBe(hashPassword("samepass1"));
  });
  it("never throws on a malformed stored hash", () => {
    expect(verifyPassword("x", "garbage")).toBe(false);
    expect(verifyPassword("x", "")).toBe(false);
    expect(verifyPassword("x", "scrypt$abc")).toBe(false);
  });
});

describe("tokens", () => {
  it("genToken yields unique hex of the requested length", () => {
    const a = genToken(16);
    const b = genToken(16);
    expect(a).toMatch(/^[a-f0-9]{32}$/);
    expect(a).not.toBe(b);
  });
  it("safeEqualHex is true only for identical hex", () => {
    const t = genToken(16);
    expect(safeEqualHex(t, t)).toBe(true);
    expect(safeEqualHex(t, genToken(16))).toBe(false);
    expect(safeEqualHex(t, t.slice(0, -2))).toBe(false);
    expect(safeEqualHex("", "")).toBe(false);
  });
});

describe("email + password policy", () => {
  it("normalizes + validates emails", () => {
    expect(normalizeEmail("  Bob@Example.COM ")).toBe("bob@example.com");
    expect(isValidEmail("bob@example.com")).toBe(true);
    expect(isValidEmail("nope")).toBe(false);
    expect(isValidEmail("a@b")).toBe(false);
  });
  it("enforces the password policy", () => {
    expect(passwordIssue("short1")).toMatch(/8 characters/);
    expect(passwordIssue("alllettersonly")).toMatch(/number/);
    expect(passwordIssue("12345678")).toMatch(/letter/);
    expect(passwordIssue("Hunter2pass")).toBeNull();
    expect(passwordIssue(123)).toMatch(/required/);
  });
});

describe("stateless session token", () => {
  const secret = "test-secret";
  const now = 1_000_000;
  it("round-trips a valid unexpired token to the userId", () => {
    const tok = signSession(42, secret, 60_000, now);
    expect(verifySession(tok, secret, now + 30_000)).toBe(42);
  });
  it("rejects an expired token", () => {
    const tok = signSession(42, secret, 60_000, now);
    expect(verifySession(tok, secret, now + 61_000)).toBeNull();
  });
  it("rejects a tampered token or wrong secret", () => {
    const tok = signSession(42, secret, 60_000, now);
    expect(verifySession(tok.replace("42", "43"), secret, now)).toBeNull();
    expect(verifySession(tok, "other-secret", now)).toBeNull();
    expect(verifySession("a.b.c", secret, now)).toBeNull();
  });
});
