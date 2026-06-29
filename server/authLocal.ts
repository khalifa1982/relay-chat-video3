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
import type { Express, Request, Response } from "express";
import { and, desc, eq, isNull } from "drizzle-orm";
import { getDb, getUserById } from "./db";
import { users, emailVerifications } from "../drizzle/schema";
import { ensureUserIdentity } from "./v2db";
import { sendEmail, emailEnabled } from "./email";
import {
  hashPassword,
  verifyPassword,
  genToken,
  normalizeEmail,
  isValidEmail,
  passwordIssue,
  signSession,
  verifySession,
} from "./authCrypto";
import { createRateLimiter, clientIpOf } from "./rateLimit";

export const LOCAL_SESSION_COOKIE = "relay_session";
const SESSION_TTL_MS = 365 * 24 * 60 * 60 * 1000; // 1 year, mirrors the OAuth cookie
const VERIFY_TTL_MS = 24 * 60 * 60 * 1000; // verification link valid 24h
const RESEND_COOLDOWN_MS = 60_000; // 1 minute (matches the "regenerate after 1 min" ask)

function sessionSecret(): string {
  return process.env.JWT_SECRET || process.env.INBOUND_EMAIL_SECRET || "relay-dev-secret";
}

function baseUrl(req: Request): string {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/+$/, "");
  const proto = String(req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
  const host = (req.headers["x-forwarded-host"] || req.headers.host || "").toString();
  return host ? `${proto}://${host}` : "https://www.your-chat.org";
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

function setSessionCookie(res: Response, userId: number): void {
  const token = signSession(userId, sessionSecret(), SESSION_TTL_MS, Date.now());
  res.cookie(LOCAL_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: SESSION_TTL_MS,
    path: "/",
  });
}

/** Resolve the userId from a local session cookie, or null. Used by the tRPC
 *  context so a local login is recognised like an OAuth session. */
export function userIdFromLocalSession(req: { cookies?: Record<string, unknown> }): number | null {
  const tok = req.cookies?.[LOCAL_SESSION_COOKIE];
  if (typeof tok !== "string" || !tok) return null;
  return verifySession(tok, sessionSecret(), Date.now());
}

/* ── verification email + pages ───────────────────────────────────────────── */

function verifyHtml(opts: { link: string; email: string }): string {
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#0E1014">
    <div style="font-size:20px;font-weight:800;letter-spacing:-0.02em">RELAY</div>
    <p style="font-size:16px;line-height:1.5;margin:18px 0 6px">Confirm your email to finish creating your RELAY account.</p>
    <p style="font-size:14px;color:#5A6271;margin:0 0 22px">This link expires in 24 hours.</p>
    <a href="${opts.link}" style="display:inline-block;background:#3FE0C5;color:#04201B;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:12px">Verify my email</a>
    <p style="font-size:12px;color:#8A93A2;margin-top:28px;word-break:break-all">Or paste this link: ${opts.link}</p>
  </div>`;
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

      const userId = await createLocalUser(email, hashPassword(password));
      if (!userId) { res.status(503).json({ error: "unavailable", message: "Service unavailable. Try again." }); return; }
      // Give them an identity row now (guest cookie migrated if present) so their
      // number/contacts carry over the moment they verify + sign in.
      const guestToken = (req.cookies?.relay_guest as string | undefined) ?? null;
      try { await ensureUserIdentity({ userId, displayName: email.split("@")[0], guestToken }); } catch { /* identity is best-effort here */ }
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
      // Uniform failure message — don't reveal whether the email exists.
      if (!u || !u.passwordHash || !verifyPassword(password, u.passwordHash)) {
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
