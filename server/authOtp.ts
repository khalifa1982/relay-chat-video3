/**
 * Passwordless email-OTP auth (v2.68). A single email → a 6-digit one-time code
 * emailed to that address → code entry authenticates. NO password, NO third-party
 * identity provider. DB + crypto helpers here; the tRPC procedures live in
 * v2routers.ts (authOtpRouter) so they can set the session cookie via ctx.res and
 * upgrade a guest identity in place.
 *
 * Security:
 *   - The 6-digit code is stored HASHED (scrypt, reusing authCrypto) — never plaintext.
 *   - Short TTL (10 min), attempt cap (5) burns the row, 60s resend cooldown.
 *   - Codes are generated with crypto.randomInt (uniform, not Math.random).
 *   - verifyOtp is timing-safe via scrypt compare.
 *
 * Email deliverability: reuses server/email.ts sendEmail (never throws). When email
 * is NOT configured (no RESEND_API_KEY) OR a send fails, dispatchOtp logs the code in
 * non-production so the flow stays testable, and reports failure so the UI can say
 * "couldn't send" rather than a dead-end "code sent". Codes are NEVER logged in a
 * correctly-configured production (gated on NODE_ENV / RELAY_OTP_DEV_LOG).
 */
import crypto from "crypto";
import { and, desc, eq, isNull, lt } from "drizzle-orm";
import { getDb } from "./db";
import { users, emailOtps } from "../drizzle/schema";
import { hashPassword, verifyPassword, genToken } from "./authCrypto";
import { sendEmail, emailEnabled, wrapEmailDocument } from "./email";

export const OTP_TTL_MS = 10 * 60 * 1000; // codes valid 10 minutes
export const OTP_MAX_ATTEMPTS = 5; // wrong tries before the code is burned
export const OTP_RESEND_COOLDOWN_MS = 60_000; // 1 minute between (re)sends per email

export type OtpPurpose = "login" | "register";

/** A uniformly-random, zero-padded 6-digit code. */
export function generateOtp(): string {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
}

/** Hash a code for at-rest storage (scrypt). */
export function hashOtp(code: string): string {
  return hashPassword(code);
}

/** Timing-safe verify of a code against its stored scrypt hash. */
export function verifyOtpHash(code: string, storedHash: string): boolean {
  return verifyPassword(code, storedHash);
}

export interface OtpRow {
  id: number;
  email: string;
  codeHash: string;
  purpose: string;
  firstName: string | null;
  lastName: string | null;
  expiresAt: Date;
  attempts: number;
  consumedAt: Date | null;
  createdAt: Date;
}

/** Insert a fresh OTP row and return the PLAINTEXT code (to email, never stored). */
export async function mintOtp(input: {
  email: string;
  purpose: OtpPurpose;
  firstName?: string | null;
  lastName?: string | null;
  nowMs?: number;
}): Promise<string> {
  const db = await getDb();
  if (!db) throw new Error("database unavailable");
  const now = input.nowMs ?? Date.now();
  const code = generateOtp();
  await db.insert(emailOtps).values({
    email: input.email,
    codeHash: hashOtp(code),
    purpose: input.purpose,
    firstName: input.firstName ?? null,
    lastName: input.lastName ?? null,
    expiresAt: new Date(now + OTP_TTL_MS),
  });
  return code;
}

/** Newest un-consumed, un-expired OTP row for an email (the one to verify against). */
export async function latestOtp(email: string, nowMs = Date.now()): Promise<OtpRow | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(emailOtps)
    .where(and(eq(emailOtps.email, email), isNull(emailOtps.consumedAt)))
    .orderBy(desc(emailOtps.createdAt))
    .limit(1);
  const row = rows[0] as OtpRow | undefined;
  if (!row) return null;
  if (new Date(row.expiresAt).getTime() < nowMs) return null;
  return row;
}

/** Timestamp of the most recent OTP minted for an email — drives the cooldown. */
export async function lastOtpAt(email: string): Promise<number | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select({ createdAt: emailOtps.createdAt })
    .from(emailOtps)
    .where(eq(emailOtps.email, email))
    .orderBy(desc(emailOtps.createdAt))
    .limit(1);
  return rows[0]?.createdAt ? new Date(rows[0].createdAt).getTime() : null;
}

/** Record a failed attempt; burn the row (consume) once the cap is hit. */
export async function recordOtpFailure(rowId: number, currentAttempts: number, nowMs = Date.now()): Promise<number> {
  const db = await getDb();
  if (!db) return currentAttempts;
  const next = currentAttempts + 1;
  const patch: Record<string, unknown> = { attempts: next };
  if (next >= OTP_MAX_ATTEMPTS) patch.consumedAt = new Date(nowMs); // burn it
  await db.update(emailOtps).set(patch).where(eq(emailOtps.id, rowId));
  return next;
}

/** Mark an OTP row consumed (single-use) after a successful verify. */
export async function consumeOtp(rowId: number, nowMs = Date.now()): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(emailOtps).set({ consumedAt: new Date(nowMs) }).where(eq(emailOtps.id, rowId));
}

/** Periodic cleanup of expired OTP rows (wired next to the presence reaper). */
export async function sweepExpiredOtps(nowMs = Date.now()): Promise<void> {
  const db = await getDb();
  if (!db) return;
  try {
    await db.delete(emailOtps).where(lt(emailOtps.expiresAt, new Date(nowMs)));
  } catch {
    /* best-effort */
  }
}

/* ── users ────────────────────────────────────────────────────────────────── */

/**
 * Find any user by email — UNLIKE the password flow's findLocalUserByEmail, this
 * does NOT require a passwordHash (OTP users have none) and prefers an OTP/local
 * account, falling back to any (so an existing OAuth-email user can also sign in
 * by OTP with the same address).
 */
export async function findUserByEmailAny(email: string) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(users).where(eq(users.email, email)).limit(10);
  if (rows.length === 0) return null;
  return (
    rows.find((r) => r.loginMethod === "otp") ??
    rows.find((r) => r.loginMethod === "local") ??
    rows[0]
  );
}

/** Create a passwordless (OTP) user, already email-verified (they just proved it). */
export async function createOtpUser(input: {
  email: string;
  firstName?: string | null;
  lastName?: string | null;
}): Promise<number | null> {
  const db = await getDb();
  if (!db) return null;
  const name = `${input.firstName ?? ""} ${input.lastName ?? ""}`.trim() || input.email.split("@")[0];
  await db.insert(users).values({
    openId: "local:" + genToken(12),
    email: input.email,
    name,
    loginMethod: "otp",
    passwordHash: null,
    emailVerified: true,
  });
  const u = await findUserByEmailAny(input.email);
  return u?.id ?? null;
}

/** Ensure a resolved user is flagged email-verified (idempotent). */
export async function markUserEmailVerified(userId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(users).set({ emailVerified: true }).where(eq(users.id, userId));
}

/* ── email dispatch ───────────────────────────────────────────────────────── */

export function otpHtml(code: string): string {
  return wrapEmailDocument(
    `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#0E1014">
    <div style="font-size:20px;font-weight:800;letter-spacing:-0.02em">RELAY</div>
    <p style="font-size:16px;line-height:1.5;margin:18px 0 10px">Your sign-in code is:</p>
    <div style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:34px;font-weight:800;letter-spacing:10px;background:#f2f5f7;border-radius:14px;padding:18px 12px;text-align:center;color:#0E1014">${code}</div>
    <p style="font-size:14px;color:#5A6271;margin:14px 0 0">This code expires in 10 minutes. If you didn't request it, you can ignore this email.</p>
  </div>`,
    "Your RELAY sign-in code"
  );
}

/**
 * Send the OTP email. Returns whether the code is deliverable-or-discoverable:
 *   - email configured + sent → true
 *   - not configured / send failed, but in dev → logs the code, returns true
 *   - not configured / send failed in production → returns false (UI shows an error)
 * Codes are only ever logged when NODE_ENV !== "production" or RELAY_OTP_DEV_LOG=1.
 */
export async function dispatchOtp(email: string, code: string): Promise<boolean> {
  const res = emailEnabled()
    ? await sendEmail({ to: email, subject: "Your RELAY sign-in code", html: otpHtml(code) })
    : { ok: false, skippedReason: "disabled" as const };
  if (res.ok) return true;
  const devLog = process.env.NODE_ENV !== "production" || process.env.RELAY_OTP_DEV_LOG === "1";
  if (devLog) {
    console.log(`[auth] OTP for ${email}: ${code}`);
    return true; // discoverable in logs → flow completable in dev/self-host
  }
  return false; // prod without working email → surface the failure to the UI
}
