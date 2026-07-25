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
/** sha256 hex of a secret. Used for the push CLAIM (v2.99.49): the server only
 *  ever stores the hash, so a database read cannot yield a token that would let
 *  someone re-bind a push endpoint. */
export function sha256Hex(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

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
 * A compact signed token. Two shapes, both accepted forever:
 *   legacy (pre-v2.99.1):  `userId.expMs.hmac`            (3 parts, no sid)
 *   v2.99.1+ (revocable):  `userId.expMs.sid.hmac`        (4 parts, with sid)
 * The `sid` ties the cookie to a row in the `sessions` ledger so a specific
 * device can be logged out remotely (the device-list feature). It is OPTIONAL:
 * omitting it reproduces the exact legacy token byte-for-byte, so every cookie
 * already in the wild keeps verifying unchanged (the ledger is only consulted
 * for tokens that actually carry a sid). The `sid` is restricted to hex so it
 * can never contain the `.` separator. */

export function signSession(
  userId: number,
  secret: string,
  ttlMs: number,
  nowMs: number,
  sid?: string,
): string {
  const exp = nowMs + ttlMs;
  const body = sid ? `${userId}.${exp}.${sid}` : `${userId}.${exp}`;
  const mac = crypto.createHmac("sha256", secret).update(body).digest("hex");
  return `${body}.${mac}`;
}

/** Parse + verify a session token → `{ userId, sid }` when valid + unexpired,
 *  else null. `sid` is null for legacy 3-part tokens. Timing-safe; never throws. */
export function readSession(
  token: string,
  secret: string,
  nowMs: number,
): { userId: number; sid: string | null } | null {
  try {
    const parts = String(token || "").split(".");
    let uidStr: string, expStr: string, sid: string | null, mac: string;
    if (parts.length === 3) {
      [uidStr, expStr, mac] = parts;
      sid = null;
    } else if (parts.length === 4) {
      [uidStr, expStr, sid, mac] = parts;
      if (!/^[a-f0-9]{1,64}$/.test(sid)) return null;
    } else {
      return null;
    }
    const body = sid ? `${uidStr}.${expStr}.${sid}` : `${uidStr}.${expStr}`;
    const expected = crypto.createHmac("sha256", secret).update(body).digest("hex");
    const a = Buffer.from(mac, "hex");
    const b = Buffer.from(expected, "hex");
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const exp = parseInt(expStr, 10);
    const uid = parseInt(uidStr, 10);
    if (!Number.isFinite(exp) || !Number.isFinite(uid) || exp < nowMs) return null;
    return { userId: uid, sid };
  } catch {
    return null;
  }
}

/** Back-compat shim: the userId only. Prefer `readSession` when the sid matters. */
export function verifySession(token: string, secret: string, nowMs: number): number | null {
  return readSession(token, secret, nowMs)?.userId ?? null;
}
