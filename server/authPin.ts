/**
 * 4-digit login PIN (v2.87) — the owner-specified alternative to email codes.
 *
 * During (or after) registration a user may set a 4-digit PIN and choose it
 * as their sign-in method. Rules, verbatim from the spec:
 *   - The PIN may be entered THREE times; a FOURTH wrong entry LOCKS the
 *     account and sends an email (via the built-in mailer).
 *   - A locked account signs in with an email code — success UNLOCKS the PIN
 *     and resets the counter.
 *
 * Storage: scrypt hash (authCrypto — same as OTP codes), never plaintext.
 * A 4-digit space is tiny (10,000), so the attempt cap is the real defense;
 * verification stays timing-safe anyway.
 */
import { eq } from "drizzle-orm";
import { getDb } from "./db";
import { users } from "../drizzle/schema";
import { hashPassword, verifyPassword } from "./authCrypto";
import { sendEmail } from "./email";

/** Wrong entries allowed before the NEXT one locks (spec: 3 tries, 4th locks). */
export const PIN_MAX_ATTEMPTS = 3;

export function isValidPin(pin: string): boolean {
  return /^\d{4}$/.test(pin);
}

export interface PinUserRow {
  id: number;
  email: string | null;
  loginPinHash: string | null;
  loginPinAttempts: number | null;
  loginPinLockedAt: Date | null;
  preferPinLogin: boolean | null;
}

export async function setLoginPin(userId: number, pin: string, prefer: boolean): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("database unavailable");
  await db
    .update(users)
    .set({
      loginPinHash: hashPassword(pin),
      loginPinAttempts: 0,
      loginPinLockedAt: null,
      preferPinLogin: prefer,
    })
    .where(eq(users.id, userId));
}

export async function clearLoginPin(userId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("database unavailable");
  await db
    .update(users)
    .set({ loginPinHash: null, loginPinAttempts: 0, loginPinLockedAt: null, preferPinLogin: false })
    .where(eq(users.id, userId));
}

/** Email-code sign-in succeeded — the account is verified again: unlock. */
export async function unlockLoginPin(userId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .update(users)
    .set({ loginPinAttempts: 0, loginPinLockedAt: null })
    .where(eq(users.id, userId));
}

export type PinVerdict =
  | { outcome: "ok" }
  | { outcome: "no-pin" }
  | { outcome: "locked" }
  | { outcome: "wrong"; attemptsLeft: number }
  | { outcome: "locked-now" };

/**
 * Pure decision: given the stored row and an entered PIN, what happens?
 * (DB writes + the lock email are applied by the caller — this stays
 * unit-testable without a database.)
 */
export function judgePinAttempt(row: {
  loginPinHash: string | null;
  loginPinAttempts: number | null;
  loginPinLockedAt: Date | null;
}, pin: string): PinVerdict {
  if (!row.loginPinHash) return { outcome: "no-pin" };
  if (row.loginPinLockedAt) return { outcome: "locked" };
  if (verifyPassword(pin, row.loginPinHash)) return { outcome: "ok" };
  const attempts = (row.loginPinAttempts ?? 0) + 1;
  // Spec: three tries; the FOURTH wrong entry locks. attempts counts wrong
  // entries — so 1..3 warn, and a 4th wrong entry (attempts === 4) locks.
  if (attempts > PIN_MAX_ATTEMPTS) return { outcome: "locked-now" };
  return { outcome: "wrong", attemptsLeft: PIN_MAX_ATTEMPTS - attempts + 1 };
  // attemptsLeft counts how many MORE wrong entries are survivable before
  // the lock (after the 3rd wrong entry it reads 1: the next one locks).
}

function lockEmailHtml(): string {
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#0E1014">
    <div style="font-size:20px;font-weight:800;letter-spacing:-0.02em">RELAY</div>
    <p style="font-size:16px;line-height:1.5;margin:18px 0 10px"><b>Your account has been locked.</b></p>
    <p style="font-size:14px;line-height:1.6;color:#39414d">Someone entered a wrong 4-digit sign-in code four times in a row. To protect the account, PIN sign-in is disabled until you sign in with an email code — doing so unlocks it automatically.</p>
    <p style="font-size:14px;color:#5A6271;margin:14px 0 0">If this wasn't you, signing in with an email code and choosing a new PIN is all you need to do.</p>
  </div>`;
}

/**
 * Full attempt handler with persistence + the lock email. Returns the verdict
 * for the router to translate into HTTP shapes.
 */
export async function attemptPinLogin(row: PinUserRow, pin: string): Promise<PinVerdict> {
  const db = await getDb();
  if (!db) throw new Error("database unavailable");
  const verdict = judgePinAttempt(row, pin);
  switch (verdict.outcome) {
    case "ok":
      await db.update(users).set({ loginPinAttempts: 0 }).where(eq(users.id, row.id));
      break;
    case "wrong":
      await db
        .update(users)
        .set({ loginPinAttempts: (row.loginPinAttempts ?? 0) + 1 })
        .where(eq(users.id, row.id));
      break;
    case "locked-now": {
      await db
        .update(users)
        .set({ loginPinAttempts: (row.loginPinAttempts ?? 0) + 1, loginPinLockedAt: new Date() })
        .where(eq(users.id, row.id));
      if (row.email) {
        // Best-effort — the lock itself never depends on email delivery.
        void sendEmail({
          to: row.email,
          subject: "RELAY: your account was locked after 4 wrong PIN entries",
          html: lockEmailHtml(),
        });
      }
      break;
    }
    default:
      break;
  }
  return verdict;
}
