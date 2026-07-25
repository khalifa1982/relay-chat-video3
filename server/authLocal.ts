/**
 * Self-hosted email + password authentication (Phase 3 / v2.54) — a proprietary
 * registration panel, NO third-party identity provider. Lives alongside the
 * existing Manus OAuth (both can mint a session). Raw Express routes (not tRPC)
 * because the verify step is a link-click that returns an HTML page.
 *
 * Flow:
 *   POST /api/auth/register {email,password} → create UNVERIFIED user + identity,
 *        mint a verification token, email a link. No session yet.
 *   GET  /api/auth/verify?token=…           → consume token, flip emailVerified,
 *        render "You have been verified — return to your other tab" HTML.
 *   GET  /api/auth/status?email=…           → {exists, verified} for the waiting
 *        registration tab to poll (never hangs).
 *   POST /api/auth/login {email,password}   → verify password + emailVerified,
 *        set the session cookie. 403 {error:"unverified"} if not yet verified.
 *   POST /api/auth/resend {email}           → new token + email (1-min cooldown).
 *   POST /api/auth/logout                   → clear the local session cookie.
 *
 * Security: scrypt password hashing, timing-safe comparisons, signed stateless
 * session cookie (HMAC, see authCrypto), per-IP + per-email rate limits, single-
 * use time-limited verification tokens.
 */
import type { CookieOptions, Express, Request, Response } from "express";
import { and, desc, eq, isNull, isNotNull, lt, sql } from "drizzle-orm";
import { getDb, getUserById } from "./db";
import { users, emailVerifications } from "../drizzle/schema";
import { ensureUserIdentity } from "./v2db";
import { deviceIdFromRequest } from "./deviceIdHeader";
import { sendEmail, emailEnabled, wrapEmailDocument } from "./email";
import {
  hashPassword,
  verifyPassword,
  genToken,
  normalizeEmail,
  isValidEmail,
  passwordIssue,
  signSession,
  verifySession,
  readSession,
} from "./authCrypto";
import { createRateLimiter, clientIpOf } from "./rateLimit";
import { appBaseUrl } from "./appUrl";

export const LOCAL_SESSION_COOKIE = "relay_session";
const SESSION_TTL_MS = 365 * 24 * 60 * 60 * 1000; // 1 year, mirrors the OAuth cookie
const VERIFY_TTL_MS = 24 * 60 * 60 * 1000; // verification link valid 24h
const RESEND_COOLDOWN_MS = 60_000; // 1 minute (matches the "regenerate after 1 min" ask)

function sessionSecret(): string {
  const secret = process.env.JWT_SECRET || process.env.INBOUND_EMAIL_SECRET;
  if (secret) return secret;
  // SECURITY (S10): the session cookie is a bare HMAC over "<userId>.<exp>" with
  // NO server-side store, so anyone who knows the signing key can forge a
  // session for ANY user. Falling back to the public constant "relay-dev-secret"
  // in production would make that forgery trivial — fail CLOSED instead: a
  // correctly-provisioned deploy always sets JWT_SECRET, so reaching here in
  // production is a misconfiguration, not a valid state. Dev/test (no NODE_ENV
  // === "production") keep the convenience fallback so `pnpm dev`/vitest run
  // without an env.
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "JWT_SECRET (or INBOUND_EMAIL_SECRET) must be set in production — refusing to sign/verify sessions with the public dev fallback."
    );
  }
  return "relay-dev-secret";
}

function baseUrl(req: Request): string {
  // v2.92 (R4B): single shared derivation (APP_URL → DOMAIN → this request's
  // proto/host → most-observed origin), no hardcoded deployment domain. The
  // null case can only happen on a request with NO Host header before any
  // other traffic — degenerate; the emailed link degrades to relative.
  return appBaseUrl(req) ?? "";
}

/* ── DB helpers (self-contained) ──────────────────────────────────────────── */

async function findLocalUserByEmail(email: string) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(users).where(eq(users.email, email)).limit(5);
  // A LOCAL account is one with a passwordHash. (An OAuth account may share the
  // email but has no passwordHash — kept separate.)
  return rows.find((r) => !!r.passwordHash) ?? null;
}

/**
 * Any user row with this email, regardless of how it signs in.
 *
 * SECURITY (M35): `findLocalUserByEmail` above deliberately matches only rows
 * that HAVE a `passwordHash`, so it is blind to OAuth and email-code (otp)
 * accounts. Registration therefore couldn't see that an address was already
 * taken by one of those, and happily inserted a SECOND `users` row for the same
 * email. That is what makes account DIVERSION possible: `findUserByEmailAny`
 * (the resolver the email-code sign-in uses) prefers an `otp` row, then a
 * `local` row, then anything — so for a legacy OAuth user, an attacker-created
 * `local` row OUTRANKS the victim's real account. The victim's email code then
 * signs them into the attacker's empty row and their real account — number,
 * contacts, message history — becomes unreachable, and since the OAuth sign-in
 * UI was removed in v2.92 the email code is their ONLY remaining way in.
 *
 * (M29 clears a pre-planted credential, so the attacker cannot log into the row;
 * this closes the other half — the victim must not be routed away from their own
 * account in the first place. One account per email address.)
 */
/* ── per-account password-login lockout (v2.99.49) ─────────────────────────
   Closes the v2.99.20 residual. `/api/auth/login` had exactly one throttle: a
   per-IP token bucket shared across /api/auth/*. That cannot bound a
   rotating-IP attacker — every address gets a fresh bucket — so one account
   could be guessed at indefinitely with its owner never told. */

/** Wrong entries allowed before the NEXT one locks. Looser than the PIN's 3: a
 *  typed password is mistyped more often than 4 digits, and the search space is
 *  vastly larger than 10^4. The point is bounding a DISTRIBUTED attacker, not
 *  policing typos. */
export const PW_MAX_ATTEMPTS = 5;
/** How long a latched lock lasts. It EXPIRES ON ITS OWN — that is the primary
 *  escape hatch, so recovery needs no action from anyone. */
export const PW_LOCK_MS = 15 * 60_000;

export type PwVerdict = "ok" | "wrong" | "locked";

/**
 * Mirrors `attemptPinLogin`'s discipline: an attempt must WIN A SLOT from the
 * database BEFORE the secret is tested, so the cap bounds actual verifications
 * (and therefore scrypt work), not merely increments after the fact.
 *
 * NOTHING HERE DEPENDS ON SET-ASSIGNMENT ORDER. drizzle's `buildUpdateSet` emits
 * columns in SCHEMA DECLARATION order, not object-literal order, so any design
 * leaning on MySQL's left-to-right evaluation is fragile by construction (see the
 * note in `claimOfflineMessageEmail`, where exactly that cost a release). Every
 * statement below either makes ONE assignment or assigns only literal constants
 * that never read each other.
 */
export async function attemptPasswordLogin(
  row: { id: number; passwordHash: string | null },
  password: string
): Promise<PwVerdict> {
  if (!row.passwordHash) return "wrong";
  try {
    const db = await getDb();
    if (!db) return "locked"; // fail CLOSED: never verify a secret without a live ladder

    // (1) Expire a stale lock. Idempotent — concurrent runs write identical
    // constants, so there is nothing to race.
    await db
      .update(users)
      .set({ loginPwAttempts: 0, loginPwLockedAt: null })
      .where(
        and(
          eq(users.id, row.id),
          isNotNull(users.loginPwLockedAt),
          lt(users.loginPwLockedAt, new Date(Date.now() - PW_LOCK_MS))
        )
      );

    // (2) Claim a slot. ONE assignment, so the emitted order is irrelevant.
    // MySQL serializes it per row, so however many requests arrive at once, only
    // PW_MAX_ATTEMPTS + 1 can ever claim between unlocks.
    const claim = await db
      .update(users)
      .set({ loginPwAttempts: sql`COALESCE(${users.loginPwAttempts}, 0) + 1` })
      .where(
        and(
          eq(users.id, row.id),
          isNull(users.loginPwLockedAt),
          sql`COALESCE(${users.loginPwAttempts}, 0) <= ${PW_MAX_ATTEMPTS}`
        )
      );
    const gotSlot =
      Array.isArray(claim) && ((claim[0] as { affectedRows?: number })?.affectedRows ?? 0) > 0;
    if (!gotSlot) return "locked";

    // (3) Slot won — only now is it legitimate to spend a scrypt on this guess.
    if (verifyPassword(password, row.passwordHash)) {
      await db
        .update(users)
        .set({ loginPwAttempts: 0, loginPwLockedAt: null })
        .where(eq(users.id, row.id));
      return "ok";
    }

    // (4) Wrong. Latch from the PERSISTED count — authoritative, because the
    // claim above was atomic — via its own isNull-guarded UPDATE.
    const [after] = await db
      .select({ attempts: users.loginPwAttempts })
      .from(users)
      .where(eq(users.id, row.id))
      .limit(1);
    if ((after?.attempts ?? PW_MAX_ATTEMPTS + 1) > PW_MAX_ATTEMPTS) {
      await db
        .update(users)
        .set({ loginPwLockedAt: sql`NOW()` })
        .where(and(eq(users.id, row.id), isNull(users.loginPwLockedAt)));
      console.warn(
        `[auth] password login locked for user ${row.id} (${PW_MAX_ATTEMPTS + 1} wrong entries)`
      );
    }
    return "wrong";
    // DELIBERATELY NO ALERT EMAIL, unlike the PIN lock. That one latches until an
    // email code unlocks it, so it mails at most once per lock and the owner must
    // act. A 15-minute self-expiring lock would let anyone who knows an address
    // trigger ~96 alerts a day: an email-bomb primitive and an SES-reputation
    // hazard this repo explicitly budgets against elsewhere. The console warning
    // is the signal; if an alert is ever wanted, it must go through a
    // cooldown claim like the missed-call one.
  } catch (e) {
    // An AUTH path fails CLOSED. The repo's fail-OPEN convention covers
    // notification/presence work, where a hiccup must not silence a call — it
    // must never be read as "let the guess through".
    console.warn("[auth] password ladder unavailable:", e);
    return "locked";
  }
}

/** An email-code sign-in proves the address, so it clears any password lock —
 *  mirroring `unlockLoginPin`. A second escape hatch on top of self-expiry. */
export async function unlockPasswordLogin(userId: number): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    await db
      .update(users)
      .set({ loginPwAttempts: 0, loginPwLockedAt: null })
      .where(eq(users.id, userId));
  } catch {
    /* best effort — the lock expires on its own anyway */
  }
}

async function findAnyUserByEmail(email: string) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return rows[0] ?? null;
}

async function createLocalUser(email: string, passwordHash: string): Promise<number | null> {
  const db = await getDb();
  if (!db) return null;
  await db.insert(users).values({
    openId: "local:" + genToken(12),
    email,
    name: email.split("@")[0],
    loginMethod: "local",
    passwordHash,
    emailVerified: false,
  });
  const u = await findLocalUserByEmail(email);
  return u?.id ?? null;
}

async function mintVerification(userId: number, email: string, nowMs: number): Promise<string> {
  const db = await getDb();
  if (!db) throw new Error("database unavailable");
  const token = genToken(32);
  await db.insert(emailVerifications).values({
    userId,
    email,
    token,
    expiresAt: new Date(nowMs + VERIFY_TTL_MS),
  });
  return token;
}

/** When was the most recent verification email minted for this user? (cooldown) */
async function lastVerificationAt(userId: number): Promise<number | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select({ createdAt: emailVerifications.createdAt })
    .from(emailVerifications)
    .where(eq(emailVerifications.userId, userId))
    .orderBy(desc(emailVerifications.createdAt))
    .limit(1);
  return rows[0]?.createdAt ? new Date(rows[0].createdAt).getTime() : null;
}

/** Consume a token if valid + unexpired + unconsumed. Returns the userId or null. */
async function consumeToken(token: string, nowMs: number): Promise<number | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(emailVerifications)
    .where(and(eq(emailVerifications.token, token), isNull(emailVerifications.consumedAt)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  if (new Date(row.expiresAt).getTime() < nowMs) return null;
  await db
    .update(emailVerifications)
    .set({ consumedAt: new Date(nowMs) })
    .where(eq(emailVerifications.id, row.id));
  await db.update(users).set({ emailVerified: true }).where(eq(users.id, row.userId));
  return row.userId;
}

/* ── session cookie ───────────────────────────────────────────────────────── */

/**
 * Set the local session cookie.
 *
 * `ttlMs` powers the login-overhaul "remember me" control:
 *   - undefined → the historical 1-year persistent session (back-compat: every
 *     pre-existing caller keeps its exact behavior).
 *   - a positive number → a persistent cookie of that lifetime (30/60/90 days).
 *   - 0 → a SESSION cookie: no `maxAge`/`expires`, so the browser drops it on
 *     close (the signed token still carries a 90-day safety expiry so a
 *     long-lived tab can't outlive the signature).
 */
export function setSessionCookie(
  res: Response,
  userId: number,
  ttlMs?: number,
  sid?: string,
): void {
  const isSession = ttlMs === 0;
  const tokenTtl = isSession ? 90 * 24 * 60 * 60 * 1000 : (ttlMs ?? SESSION_TTL_MS);
  // A `sid` binds this cookie to a row in the `sessions` ledger so the device
  // can be logged out remotely (v2.99.1 device list). Omitting it yields the
  // exact legacy token, so callers that don't opt in are byte-identical.
  const token = signSession(userId, sessionSecret(), tokenTtl, Date.now(), sid);
  const opts: CookieOptions = {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
  };
  // A session cookie is one with NO maxAge/expires — omit it in that case.
  if (!isSession) opts.maxAge = tokenTtl;
  res.cookie(LOCAL_SESSION_COOKIE, token, opts);
}

/** Map the client's "remember me" choice to a `setSessionCookie` ttl.
 *  0 = this browser session only; 30/60/90 = that many days; anything else
 *  (incl. undefined) = the default 1-year persistent session. */
export function rememberToTtlMs(remember?: number | null): number | undefined {
  if (remember === 0) return 0;
  if (remember === 30 || remember === 60 || remember === 90) {
    return remember * 24 * 60 * 60 * 1000;
  }
  return undefined;
}

/** Resolve the userId from a local session cookie, or null. Used by the tRPC
 *  context so a local login is recognised like an OAuth session. */
export function userIdFromLocalSession(req: { cookies?: Record<string, unknown> }): number | null {
  const tok = req.cookies?.[LOCAL_SESSION_COOKIE];
  if (typeof tok !== "string" || !tok) return null;
  return verifySession(tok, sessionSecret(), Date.now());
}

/** Resolve `{ userId, sid }` from a local session cookie, or null. `sid` is null
 *  for legacy cookies (minted before the device-list feature) — the caller then
 *  skips the ledger check entirely, so those sessions behave exactly as before. */
export function readLocalSession(
  req: { cookies?: Record<string, unknown> },
): { userId: number; sid: string | null } | null {
  const tok = req.cookies?.[LOCAL_SESSION_COOKIE];
  if (typeof tok !== "string" || !tok) return null;
  return readSession(tok, sessionSecret(), Date.now());
}

/** A fresh random session id (hex) for the `sessions` ledger + the cookie. */
export function newSessionId(): string {
  return genToken(16); // 32 hex chars
}

/* ── verification email + pages ───────────────────────────────────────────── */

export function verifyHtml(opts: { link: string; email: string }): string {
  return wrapEmailDocument(
    `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#0E1014">
    <div style="font-size:20px;font-weight:800;letter-spacing:-0.02em">RELAY</div>
    <p style="font-size:16px;line-height:1.5;margin:18px 0 6px">Confirm your email to finish creating your RELAY account.</p>
    <p style="font-size:14px;color:#5A6271;margin:0 0 22px">This link expires in 24 hours.</p>
    <a href="${opts.link}" style="display:inline-block;background:#3FE0C5;color:#04201B;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:12px">Verify my email</a>
    <p style="font-size:12px;color:#8A93A2;margin-top:28px;word-break:break-all">Or paste this link: ${opts.link}</p>
  </div>`,
    "Verify your email · RELAY"
  );
}

function verifiedPage(ok: boolean): string {
  const title = ok ? "You have been verified" : "This link is invalid or expired";
  const body = ok
    ? "Please return to your previous screen or the other tab to continue."
    : "Request a new verification link from the registration screen.";
  const tint = ok ? "#3FE0C5" : "#ff6b6b";
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title} · RELAY</title></head>
  <body style="margin:0;background:#0b0c10;color:#e7e9ee;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
    <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px">
      <div style="max-width:420px;text-align:center;background:#14171d;border:1px solid #2a2f3a;border-radius:24px;padding:36px 28px;box-shadow:0 24px 60px -20px rgba(0,0,0,.7)">
        <div style="width:56px;height:56px;border-radius:16px;margin:0 auto 18px;display:flex;align-items:center;justify-content:center;background:${tint}22;color:${tint};font-size:28px">${ok ? "✓" : "!"}</div>
        <h1 style="font-size:22px;margin:0 0 8px">${title}</h1>
        <p style="font-size:15px;line-height:1.5;color:#9aa3b2;margin:0">${body}</p>
      </div>
    </div>
  </body></html>`;
}

/* ── routes ───────────────────────────────────────────────────────────────── */

export function registerLocalAuth(app: Express): void {
  const rlOff = process.env.RELAY_RATELIMIT_OFF === "1";
  // Tight limits on the auth endpoints (brute-force / spam guard).
  const ipLimiter = createRateLimiter({ capacity: 30, refillPerSec: 30 / 60 }); // ~30/min burst, 0.5/s
  setInterval(() => ipLimiter.sweep(Date.now(), 30 * 60_000), 30 * 60_000).unref();
  // v2.99.49: registration ALSO spends a permanent 6-digit number (via
  // ensureUserIdentity → allocateNumber) and also sends mail, and it had no mint
  // budget at all — 43,200 permanent claims/day/IP through a sibling endpoint,
  // more than the per-endpoint bound M21 advertised for `startGuest`. A second,
  // tighter bucket meters exactly the registrations that CREATE an account, so
  // the login/verify/resend routes keep the looser gate above.
  const mintLimiter = createRateLimiter({ capacity: 20, refillPerSec: 20 / 60 }); // 20 burst, ~1/3s
  setInterval(() => mintLimiter.sweep(Date.now(), 30 * 60_000), 30 * 60_000).unref();
  const mintGate = (req: Request, res: Response): boolean => {
    if (rlOff) return true;
    if (mintLimiter.allow(clientIpOf(req), Date.now())) return true;
    res.status(429).json({ error: "rate_limited", message: "Too many sign-ups from this network. Try again shortly." });
    return false;
  };
  const gate = (req: Request, res: Response): boolean => {
    if (rlOff) return true;
    if (ipLimiter.allow(clientIpOf(req), Date.now())) return true;
    res.status(429).json({ error: "rate_limited", message: "Too many attempts. Try again shortly." });
    return false;
  };

  async function dispatchVerifyEmail(req: Request, email: string, token: string) {
    const link = `${baseUrl(req)}/api/auth/verify?token=${token}`;
    if (!emailEnabled()) {
      // No email provider configured — log the link so the operator can still
      // complete verification in dev/self-host without Resend.
      console.log(`[auth] verification link for ${email}: ${link}`);
      return;
    }
    await sendEmail({
      to: email,
      subject: "Verify your email for RELAY",
      html: verifyHtml({ link, email }),
    }).catch((e) => console.warn("[auth] verify email send failed:", e));
  }

  // Register: create an unverified local user + identity, send the link.
  app.post("/api/auth/register", async (req: Request, res: Response) => {
    if (!gate(req, res)) return;
    try {
      const email = normalizeEmail((req.body?.email ?? "").toString());
      const password = (req.body?.password ?? "").toString();
      if (!isValidEmail(email)) { res.status(400).json({ error: "bad_email", message: "Enter a valid email." }); return; }
      const pwIssue = passwordIssue(password);
      if (pwIssue) { res.status(400).json({ error: "bad_password", message: pwIssue }); return; }

      const existing = await findLocalUserByEmail(email);
      if (existing) {
        if (existing.emailVerified) {
          res.status(409).json({ error: "exists", message: "An account with this email already exists. Sign in instead." });
          return;
        }
        // Unverified re-register: resend a fresh link (don't leak/duplicate).
        const token = await mintVerification(existing.id, email, Date.now());
        await dispatchVerifyEmail(req, email, token);
        res.json({ ok: true, email, resent: true });
        return;
      }

      // M35: `findLocalUserByEmail` only sees password-bearing rows, so an
      // OAuth / email-code account for this address is invisible to the check
      // above. Refuse rather than insert a duplicate row for the same email —
      // a second row would OUTRANK the victim's real account in
      // findUserByEmailAny and divert their only sign-in path to it.
      const other = await findAnyUserByEmail(email);
      if (other) {
        // v2.99.47 — SIGNPOST THE ONE DEAD END M29 + M35 CAN CREATE TOGETHER.
        // A row with no passwordHash cannot sign in here at all, and there is
        // deliberately no password-reset route in this app, so "sign in instead"
        // sent such a caller back to a login that answers 401 forever. This
        // happens to a user's OWN account when they register a password, sign in
        // with an email code before clicking the verification link (M29 then
        // correctly destroys the unproven credential — the server cannot tell a
        // self-registration from an attacker pre-registering someone else's
        // address), and later try to re-register. Name the way in instead: the
        // email code IS this app's primary sign-in (v2.92 removed OAuth), so
        // nothing is actually lost but the password.
        res.status(409).json({
          error: "exists",
          message: other.passwordHash
            ? "An account with this email already exists. Sign in instead."
            : "An account with this email already exists and signs in with an email code — open RELAY and choose \"Email me a code\".",
        });
        return;
      }
      // Meter the ALLOCATING path only (an unverified re-register above resends a
      // link and spends no number, so it stays on the looser gate).
      if (!mintGate(req, res)) return;
      const userId = await createLocalUser(email, hashPassword(password));
      if (!userId) { res.status(503).json({ error: "unavailable", message: "Service unavailable. Try again." }); return; }
      // Give them an identity row now (guest cookie migrated if present) so their
      // number/contacts carry over the moment they verify + sign in.
      // Both hints, not just the cookie (v2.99.49): this call allocates a number
      // when it finds no guest row, so missing the browser's device-resolved
      // guest identity is what orphaned people's data.
      const guestToken = (req.cookies?.relay_guest as string | undefined) ?? null;
      try {
        await ensureUserIdentity({
          userId,
          displayName: email.split("@")[0],
          guestToken,
          deviceId: deviceIdFromRequest(req),
        });
      } catch { /* identity is best-effort here */ }
      const token = await mintVerification(userId, email, Date.now());
      await dispatchVerifyEmail(req, email, token);
      res.json({ ok: true, email });
    } catch (e) {
      console.warn("[auth] register error:", e);
      res.status(500).json({ error: "server", message: "Something went wrong." });
    }
  });

  // Status poll for the waiting registration tab. Never hangs — returns instantly.
  app.get("/api/auth/status", async (req: Request, res: Response) => {
    if (!gate(req, res)) return;
    res.setHeader("Cache-Control", "no-store");
    try {
      const email = normalizeEmail((req.query?.email ?? "").toString());
      if (!isValidEmail(email)) { res.json({ exists: false, verified: false }); return; }
      const u = await findLocalUserByEmail(email);
      res.json({ exists: !!u, verified: !!u?.emailVerified });
    } catch {
      res.json({ exists: false, verified: false });
    }
  });

  // Verify link target — consume the token, flip verified, show the page.
  app.get("/api/auth/verify", async (req: Request, res: Response) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    try {
      const token = (req.query?.token ?? "").toString();
      if (!/^[a-f0-9]{16,128}$/i.test(token)) { res.status(400).send(verifiedPage(false)); return; }
      const userId = await consumeToken(token, Date.now());
      res.status(userId ? 200 : 400).send(verifiedPage(!!userId));
    } catch (e) {
      console.warn("[auth] verify error:", e);
      res.status(500).send(verifiedPage(false));
    }
  });

  // Resend a verification link (1-minute cooldown per account).
  app.post("/api/auth/resend", async (req: Request, res: Response) => {
    if (!gate(req, res)) return;
    try {
      const email = normalizeEmail((req.body?.email ?? "").toString());
      const u = await findLocalUserByEmail(email);
      // Always answer ok (don't reveal which emails exist); only act for a real
      // unverified account past the cooldown.
      if (u && !u.emailVerified) {
        const last = await lastVerificationAt(u.id);
        if (!last || Date.now() - last >= RESEND_COOLDOWN_MS) {
          const token = await mintVerification(u.id, email, Date.now());
          await dispatchVerifyEmail(req, email, token);
        }
      }
      res.json({ ok: true });
    } catch (e) {
      console.warn("[auth] resend error:", e);
      res.json({ ok: true });
    }
  });

  // Login — password + verified gate, then set the session cookie.
  app.post("/api/auth/login", async (req: Request, res: Response) => {
    if (!gate(req, res)) return;
    try {
      const email = normalizeEmail((req.body?.email ?? "").toString());
      const password = (req.body?.password ?? "").toString();
      const u = await findLocalUserByEmail(email);
      // Uniform failure message — don't reveal whether the email exists. A LOCKED
      // account answers with the SAME uniform failure as a wrong password or an
      // unknown address: a distinct status here would turn this route into an
      // oracle for "this address has a live password".
      if (!u || (await attemptPasswordLogin(u, password)) !== "ok") {
        res.status(401).json({ error: "bad_credentials", message: "Incorrect email or password." });
        return;
      }
      if (!u.emailVerified) {
        res.status(403).json({ error: "unverified", message: "Verify your email first — check your inbox." });
        return;
      }
      setSessionCookie(res, u.id);
      res.json({ ok: true });
    } catch (e) {
      console.warn("[auth] login error:", e);
      res.status(500).json({ error: "server", message: "Something went wrong." });
    }
  });

  // Logout — clear the local session cookie.
  app.post("/api/auth/logout", (_req: Request, res: Response) => {
    res.clearCookie(LOCAL_SESSION_COOKIE, { path: "/" });
    res.json({ ok: true });
  });

  console.log("[auth] self-hosted email/password routes ready on /api/auth/*");
}

// Re-export for the tRPC context + tests.
export { getUserById };
