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
import { eq, and, isNull, sql } from "drizzle-orm";
import { getDb } from "./db";
import { users } from "../drizzle/schema";
import { hashPassword, verifyPassword } from "./authCrypto";
import { sendEmail, wrapEmailDocument } from "./email";

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
 *
 * ⚠️ ADVISORY ONLY — NOT AN ENFORCEMENT PATH. Currently referenced only by
 * tests, where it documents the ladder's shape. It decides from a SNAPSHOT of
 * the row, so it cannot bound how many PINs get verified concurrently: N
 * simultaneous requests would all see the same `loginPinLockedAt: null` and all
 * reach `verifyPassword`, which is exactly the brute-force bypass M36 closed in
 * `attemptPinLogin`. Do NOT wire this into a login route. Real attempts must go
 * through `attemptPinLogin`, which claims an attempt slot atomically in the
 * database BEFORE testing the secret.
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

export function lockEmailHtml(): string {
  return wrapEmailDocument(
    `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#0E1014">
    <div style="font-size:20px;font-weight:800;letter-spacing:-0.02em">RELAY</div>
    <p style="font-size:16px;line-height:1.5;margin:18px 0 10px"><b>Your account has been locked.</b></p>
    <p style="font-size:14px;line-height:1.6;color:#39414d">Someone entered a wrong 4-digit sign-in code four times in a row. To protect the account, PIN sign-in is disabled until you sign in with an email code — doing so unlocks it automatically.</p>
    <p style="font-size:14px;color:#5A6271;margin:14px 0 0">If this wasn't you, signing in with an email code and choosing a new PIN is all you need to do.</p>
  </div>`,
    "Your RELAY account was locked"
  );
}

/**
 * Latch the lock on a row whose slots are spent, and send the alert email —
 * exactly once, no matter how many callers race here.
 *
 * The `isNull` guard is what makes it once-only: precisely one statement can
 * transition the row to locked, and that same statement owns the email, so
 * losers can neither re-latch nor duplicate the alert.
 */
async function latchLockAndAlert(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  row: { id: number; email: string | null },
): Promise<void> {
  const latch = await db
    .update(users)
    .set({ loginPinLockedAt: sql`NOW()` })
    .where(and(eq(users.id, row.id), isNull(users.loginPinLockedAt)));
  const iLatched =
    Array.isArray(latch) && ((latch[0] as { affectedRows?: number })?.affectedRows ?? 0) > 0;
  if (row.email && iLatched) {
    // Best-effort — the lock itself never depends on email delivery. This is
    // the owner's ONLY signal that their account is being brute-forced.
    void sendEmail({
      to: row.email,
      subject: "RELAY: your account was locked after 4 wrong PIN entries",
      html: lockEmailHtml(),
    });
  }
}

/**
 * True when the row's attempt slots are spent — i.e. PIN sign-in cannot
 * succeed — regardless of whether the lock field ever latched.
 *
 * ── SELF-REVIEW (v2.99.47): M36 could leave a row lying about its own state ──
 * M36 splits a wrong attempt into two statements: claim a slot, then (on the
 * spending entry) latch `loginPinLockedAt`. If the process dies in between —
 * and this repo pm2-restarts the whole fleet on every push to `main`, right
 * across the ~100ms scrypt verify that sits in that window — the row is left
 * `attempts = 4, lockedAt = NULL`. The claim's `attempts <= 3` bound then
 * refuses every future attempt INCLUDING THE CORRECT PIN, while `loginProbe`
 * derived its answer purely from `lockedAt` and reported `locked: false`, so
 * AuthPanel parked the user on a PIN pad where no entry could ever work, with
 * no lock notice and no alert email (the latch that owns it never ran).
 *
 * Spent-ness is therefore derived from BOTH fields wherever it is reported,
 * and `attemptPinLogin` heals such a row into a real, visible lock.
 */
export function pinSlotsSpent(row: {
  loginPinAttempts: number | null;
  loginPinLockedAt: Date | null;
}): boolean {
  return Boolean(row.loginPinLockedAt) || (row.loginPinAttempts ?? 0) > PIN_MAX_ATTEMPTS;
}

/**
 * Full attempt handler with persistence + the lock email. Returns the verdict
 * for the router to translate into HTTP shapes.
 */
export async function attemptPinLogin(row: PinUserRow, pin: string): Promise<PinVerdict> {
  const db = await getDb();
  if (!db) throw new Error("database unavailable");
  if (!row.loginPinHash) return { outcome: "no-pin" };

  // ── SECURITY (M36): CLAIM AN ATTEMPT SLOT ATOMICALLY, BEFORE VERIFYING ──
  //
  // The lockout used to be gated on `row.loginPinLockedAt` — a field from a
  // snapshot the CALLER read (loginWithPin does its own findUserByEmailAny),
  // and `verifyPassword` then ran regardless of the row's LIVE state. So N
  // concurrent requests all read an unlocked row, all passed the gate, and all
  // got a PIN checked. The S1 fix made the counter arithmetic race-free, which
  // stopped increments being LOST — but it never bounded how many
  // VERIFICATIONS could happen, so the "3 tries then lock" guarantee wasn't
  // actually enforced per attempt: a burst could test many of the 10^4 PINs in
  // one window, held back only by the per-IP bucket rather than the cap.
  //
  // Fixed by inverting the order: every attempt must first WIN a slot from the
  // database, and only a winner is allowed to verify. The guard is the WHERE
  // clause, so MySQL serializes it per row and exactly PIN_MAX_ATTEMPTS + 1
  // slots can ever be claimed between unlocks — no matter how many requests
  // arrive at once, whether they interleave, or which instance they hit.
  //
  // `COALESCE(attempts,0) <= PIN_MAX_ATTEMPTS` is the slot bound: the count can
  // climb 0→1→2→3→4 and then stops matching, so the FOURTH try is still
  // verified (a correct 4th succeeds, exactly as before — the lock latches only
  // on a wrong 4th, below). `isNull(lockedAt)` refuses an already-locked row
  // using LIVE state rather than the caller's snapshot.
  const claim = await db
    .update(users)
    .set({ loginPinAttempts: sql`COALESCE(${users.loginPinAttempts}, 0) + 1` })
    .where(
      and(
        eq(users.id, row.id),
        isNull(users.loginPinLockedAt),
        sql`COALESCE(${users.loginPinAttempts}, 0) <= ${PIN_MAX_ATTEMPTS}`,
      ),
    );
  // mysql2 returns [ResultSetHeader]; affectedRows>0 means THIS statement won a slot.
  const gotSlot =
    Array.isArray(claim) && ((claim[0] as { affectedRows?: number })?.affectedRows ?? 0) > 0;
  // No slot ⇒ the row is locked, or its slots are spent without the lock having
  // latched (a prior attempt died in between — see pinSlotsSpent). Refuse
  // either way; an email code still unlocks via unlockLoginPin. Fail CLOSED.
  if (!gotSlot) {
    // HEAL the second case: a spent-but-unlatched row is invisible to anything
    // reading `loginPinLockedAt`, so latch it now. This makes the state the
    // probe reports agree with the state the claim enforces, and delivers the
    // alert email the interrupted attempt owed the account owner.
    const [live] = await db
      .select({
        attempts: users.loginPinAttempts,
        lockedAt: users.loginPinLockedAt,
      })
      .from(users)
      .where(eq(users.id, row.id))
      .limit(1);
    if (live && !live.lockedAt && (live.attempts ?? 0) > PIN_MAX_ATTEMPTS) {
      await latchLockAndAlert(db, row);
    }
    return { outcome: "locked" };
  }

  // Slot won — now, and only now, is it legitimate to test the secret.
  if (verifyPassword(pin, row.loginPinHash)) {
    // Correct: release every slot for next time.
    await db.update(users).set({ loginPinAttempts: 0 }).where(eq(users.id, row.id));
    return { outcome: "ok" };
  }

  // WRONG. Read the persisted post-increment count — authoritative, since the
  // claim above was atomic — and latch the lock when it has passed the cap.
  const [after] = await db
    .select({ attempts: users.loginPinAttempts })
    .from(users)
    .where(eq(users.id, row.id))
    .limit(1);
  const attempts = after?.attempts ?? PIN_MAX_ATTEMPTS + 1;
  if (attempts > PIN_MAX_ATTEMPTS) {
    await latchLockAndAlert(db, row);
    return { outcome: "locked-now" };
  }
  return { outcome: "wrong", attemptsLeft: PIN_MAX_ATTEMPTS - attempts + 1 };
}
