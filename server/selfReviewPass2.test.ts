import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { pinSlotsSpent, PIN_MAX_ATTEMPTS } from "./authPin";

/**
 * v2.99.47 — SECOND self-review round: regressions and incomplete closures in
 * MY OWN hardening fixes, found by red-teaming them rather than hunting new
 * vulnerabilities. Each item below is a way one of today's fixes made the app
 * WORSE for a legitimate user, or left the invariant it claimed only half-shut.
 *
 * M49  M36's split claim/latch could leave a row that refuses the CORRECT PIN
 *      while reporting itself unlocked.
 * M50  M35 closed duplicate accounts at /api/auth/register but not at the OTP
 *      door, where an unguarded consume let one code create two user rows.
 * M51  M29 + M35 together destroyed an unverified registrant's own password and
 *      then answered "sign in instead" to a login that can never succeed.
 * M52  M38's widened upload denylist rejected everyday .xml / .js attachments
 *      (covered in hardeningPass6.test.ts, whose pins were rewritten).
 */
const ROOT = path.resolve(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const PIN = read("server/authPin.ts");
const OTP = read("server/authOtp.ts");
const ROUTERS = read("server/v2routers.ts");
const LOCAL = read("server/authLocal.ts");

/* ── M49: spent-but-unlatched PIN rows ──────────────────────────────────── */

describe("M49 — a PIN row can never refuse the correct PIN while claiming to be unlocked", () => {
  it("pinSlotsSpent derives lock state from BOTH fields", () => {
    // Ordinary states.
    expect(pinSlotsSpent({ loginPinAttempts: 0, loginPinLockedAt: null })).toBe(false);
    expect(pinSlotsSpent({ loginPinAttempts: PIN_MAX_ATTEMPTS, loginPinLockedAt: null })).toBe(false);
    // A latched lock is spent regardless of the counter.
    expect(pinSlotsSpent({ loginPinAttempts: 0, loginPinLockedAt: new Date() })).toBe(true);
    // THE REGRESSION: slots gone, lock never latched (the process died between
    // M36's two statements). The claim bound refuses every later attempt, so
    // this state must read as locked everywhere it is reported.
    expect(pinSlotsSpent({ loginPinAttempts: PIN_MAX_ATTEMPTS + 1, loginPinLockedAt: null })).toBe(true);
  });

  it("tolerates a NULL counter (legacy rows) without reporting a false lock", () => {
    expect(pinSlotsSpent({ loginPinAttempts: null, loginPinLockedAt: null })).toBe(false);
  });

  it("the no-slot branch HEALS the row: latches the lock and sends the owed alert", () => {
    const branch = PIN.slice(PIN.indexOf("if (!gotSlot)"), PIN.indexOf("// Slot won"));
    // Re-reads LIVE state rather than trusting the caller's snapshot…
    expect(branch).toMatch(/attempts: users\.loginPinAttempts/);
    expect(branch).toMatch(/lockedAt: users\.loginPinLockedAt/);
    // …and latches only the spent-but-unlatched case.
    expect(branch).toMatch(
      /if \(live && !live\.lockedAt && \(live\.attempts \?\? 0\) > PIN_MAX_ATTEMPTS\) \{\s*\n\s*await latchLockAndAlert\(db, row\);/,
    );
    expect(branch).toMatch(/return \{ outcome: "locked" \}/);
  });

  it("the latch + alert live in ONE helper, so both call sites stay once-only", () => {
    const helper = PIN.slice(PIN.indexOf("async function latchLockAndAlert"), PIN.indexOf("export function pinSlotsSpent"));
    // isNull guard = exactly one statement transitions the row, and that same
    // statement owns the email.
    expect(helper).toMatch(/isNull\(users\.loginPinLockedAt\)/);
    expect(helper).toMatch(/affectedRows/);
    expect(helper).toMatch(/if \(row\.email && iLatched\)/);
    expect(helper).toMatch(/sendEmail\(/);
    // No second copy of the email anywhere in the module.
    expect(PIN.match(/sendEmail\(/g)?.length).toBe(1);
  });

  it("loginProbe and pinStatus both report the DERIVED state, not the raw field", () => {
    const probe = ROUTERS.slice(ROUTERS.indexOf("loginProbe: publicProcedure"), ROUTERS.indexOf("loginWithPin: publicProcedure"));
    expect(probe).toMatch(/locked: pinSlotsSpent\(\{/);
    expect(probe).not.toMatch(/locked: Boolean\(u\.loginPinLockedAt\)/);
    const status = ROUTERS.slice(ROUTERS.indexOf("pinStatus: publicProcedure"), ROUTERS.indexOf("pinStatus: publicProcedure") + 900);
    expect(status).toMatch(/locked: pinSlotsSpent\(\{/);
    expect(status).not.toMatch(/locked: Boolean\(user\.loginPinLockedAt\)/);
  });
});

/* ── M50: one code, one account ─────────────────────────────────────────── */

describe("M50 — OTP consumption is the race winner (no duplicate accounts)", () => {
  const fn = OTP.slice(OTP.indexOf("export async function consumeOtp"), OTP.indexOf("export async function sweepExpiredOtps"));

  it("consumeOtp guards on the row being un-consumed and reports whether it won", () => {
    expect(fn).toMatch(/Promise<boolean>/);
    expect(fn).toMatch(/and\(eq\(emailOtps\.id, rowId\), isNull\(emailOtps\.consumedAt\)\)/);
    expect(fn).toMatch(/affectedRows/);
    // Never silently succeeds when the DB is down.
    expect(fn).toMatch(/if \(!db\) return false;/);
  });

  it("verifyOtp refuses to continue when it LOST the race", () => {
    const v = ROUTERS.slice(ROUTERS.indexOf("verifyOtp: publicProcedure"), ROUTERS.indexOf("resendOtp: publicProcedure"));
    expect(v).toMatch(/if \(!\(await consumeOtp\(row\.id\)\)\) \{/);
    expect(v).toMatch(/code: "CONFLICT"/);
    // The refusal must sit BEFORE account creation — that is the whole point.
    // (Match the CALL, not the name: the comment above it names it too.)
    expect(v.indexOf("await consumeOtp(row.id)")).toBeLessThan(v.indexOf("createOtpUser({ email"));
  });

  it("findUserByEmailAny resolves duplicates deterministically (oldest first)", () => {
    const f = OTP.slice(OTP.indexOf("export async function findUserByEmailAny"), OTP.indexOf("export async function createOtpUser"));
    expect(f).toMatch(/\.orderBy\(asc\(users\.id\)\)/);
    // The preference order itself is unchanged (otp → local → any).
    expect(f).toMatch(/rows\.find\(\(r\) => r\.loginMethod === "otp"\)/);
  });
});

/* ── M51: never signpost a login that cannot succeed ────────────────────── */

describe("M51 — the register 409 names a sign-in that actually works", () => {
  const reg = LOCAL.slice(LOCAL.indexOf('app.post("/api/auth/register"'), LOCAL.indexOf('app.get("/api/auth/status"'));

  it("branches on whether the existing row can sign in with a password at all", () => {
    expect(reg).toMatch(/const other = await findAnyUserByEmail\(email\);/);
    expect(reg).toMatch(/other\.passwordHash\s*\n?\s*\?/);
  });

  it("a credential-less row is pointed at the email code, not at password login", () => {
    const msg = reg.slice(reg.indexOf("const other ="), reg.indexOf("const userId = await createLocalUser"));
    expect(msg).toMatch(/signs in with an email code/);
  });

  it("still REFUSES the duplicate row — M35's invariant is untouched", () => {
    expect(reg).toMatch(/res\s*\n?\s*\.?status\(409\)|status\(409\)/);
    expect(reg).toMatch(/error: "exists"/);
    // No new write path was introduced for an existing address.
    const guarded = reg.slice(0, reg.indexOf("const userId = await createLocalUser"));
    expect(guarded).not.toMatch(/setUserPassword|resetPassword/);
  });
});
