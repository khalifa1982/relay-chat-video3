/**
 * Security primitives for the self-hosted email + password auth (Phase 3).
 * No DB, no Express — pure functions so the security-critical bits are unit
 * tested. Password hashing uses Node's built-in scrypt (no external dep), tokens
 * use crypto.randomBytes, and all secret comparisons are timing-safe.
 */
import crypto from "crypto";

const SCHEME = "scrypt";
const SCRYPT_N = 16384; // CPU/memory cost (2^14) — ~tens of ms per hash
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEYLEN = 64;
const SALT_BYTES = 16;

/** Hash a password into a self-describing `scrypt$N$salt$hash` string. */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(SALT_BYTES).toString("hex");
  const derived = crypto
    .scryptSync(password, salt, KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P })
    .toString("hex");
  return `${SCHEME}$${SCRYPT_N}$${salt}$${derived}`;
}

/** Verify a password against a stored hash. Timing-safe; never throws. */
export function verifyPassword(password: string, stored: string): boolean {
  try {
    const parts = String(stored || "").split("$");
    if (parts.length !== 4 || parts[0] !== SCHEME) return false;
    const N = parseInt(parts[1], 10);
    const salt = parts[2];
    const expected = Buffer.from(parts[3], "hex");
    if (!Number.isFinite(N) || N < 2 || !salt || expected.length === 0) return false;
    const derived = crypto.scryptSync(password, salt, expected.length, {
      N,
      r: SCRYPT_R,
      p: SCRYPT_P,
    });
    return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

/** A URL-safe random token (hex) for email-verification links / sessions. */
export function genToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("hex");
}

/** Timing-safe equality for two hex token strings of equal length. */
export function safeEqualHex(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(String(a), "hex");
    const bb = Buffer.from(String(b), "hex");
    return ba.length > 0 && ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

/** Lowercase + trim an email for storage / comparison. */
export function normalizeEmail(email: string): string {
  return String(email || "").trim().toLowerCase();
}

/** Loose but practical email shape check. */
export function isValidEmail(email: string): boolean {
  const e = normalizeEmail(email);
  return e.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

/**
 * Password policy. Returns a human message when the password is unacceptable,
 * or null when it's fine. Kept deliberately simple but non-trivial: ≥8 chars,
 * with at least one letter and one digit.
 */
export function passwordIssue(password: unknown): string | null {
  if (typeof password !== "string") return "Password is required.";
  if (password.length < 8) return "Password must be at least 8 characters.";
  if (password.length > 200) return "Password is too long.";
  if (!/[A-Za-z]/.test(password)) return "Include at least one letter.";
  if (!/\d/.test(password)) return "Include at least one number.";
  return null;
}

/* ── stateless session token (signed, no DB) ──────────────────────────────
 * A compact `userId.expMs.hmac` token signed with the app secret. Lets a
 * local (email/password) login mint a session cookie without a sessions table,
 * mirroring how the Manus OAuth cookie is self-contained. */

export function signSession(userId: number, secret: string, ttlMs: number, nowMs: number): string {
  const exp = nowMs + ttlMs;
  const body = `${userId}.${exp}`;
  const mac = crypto.createHmac("sha256", secret).update(body).digest("hex");
  return `${body}.${mac}`;
}

/** Verify a session token; returns the userId when valid + unexpired, else null. */
export function verifySession(token: string, secret: string, nowMs: number): number | null {
  try {
    const parts = String(token || "").split(".");
    if (parts.length !== 3) return null;
    const [uidStr, expStr, mac] = parts;
    const body = `${uidStr}.${expStr}`;
    const expected = crypto.createHmac("sha256", secret).update(body).digest("hex");
    const a = Buffer.from(mac, "hex");
    const b = Buffer.from(expected, "hex");
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const exp = parseInt(expStr, 10);
    const uid = parseInt(uidStr, 10);
    if (!Number.isFinite(exp) || !Number.isFinite(uid) || exp < nowMs) return null;
    return uid;
  } catch {
    return null;
  }
}
