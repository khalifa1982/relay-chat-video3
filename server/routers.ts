import { GUEST_COOKIE } from "./_core/context";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { LOCAL_SESSION_COOKIE } from "./authLocal";
import { revokeSession } from "./v2db";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import {
  v2AuthRouter,
  v2DirectoryRouter,
  v2ContactsRouter,
  v2MessagesRouter,
  v2AttachmentsRouter,
  v2CallsRouter,
  v2StatsRouter,
  v2OtpAuthRouter,
  v2PushRouter,
  v2PartyLinesRouter,
  v2StatusRouter,
} from "./v2routers";

export const appRouter = router({
  system: systemRouter,
  auth: router({
    /**
     * SECURITY (M39): NEVER ship credential material to the browser.
     *
     * `ctx.user` is whatever `getUserById` returned, and that does an
     * unprojected `db.select()` — so this handler was serialising the caller's
     * ENTIRE `users` row, including their scrypt `passwordHash` and their
     * `loginPinHash`, into the `auth.me` response on every page load. Those then
     * live in JS memory, the React Query cache, devtools/HAR captures, anything
     * a browser extension can read, and any client error report that includes
     * query state. It is the caller's OWN hash, so this is not cross-user
     * disclosure — but it converts any read-only client-side foothold (an XSS
     * like the in-call chat one, a malicious extension) into offline credential
     * cracking. And the PIN hash covers a 10^4 space, so it does not survive
     * even a trivial offline attack — recovering it hands over the account.
     *
     * Stripped as a DENYLIST rather than an allowlist projection so no field the
     * client already consumes can silently disappear. Server-side callers that
     * genuinely need the hashes (loginWithPin) read them from their own query,
     * not from `ctx.user`, so nothing else is affected.
     */
    me: publicProcedure.query((opts) => {
      const u = opts.ctx.user;
      if (!u) return null;
      const {
        passwordHash: _passwordHash,
        loginPinHash: _loginPinHash,
        ...safe
      } = u as typeof u & { passwordHash?: unknown; loginPinHash?: unknown };
      return safe;
    }),
    logout: publicProcedure.mutation(async ({ ctx }) => {
      // SECURITY (M43): actually REVOKE the session server-side, not just drop
      // the cookies. v2.99.1 introduced a revocable session ledger, and
      // createContext gates every sid-bearing cookie on it — but sign-out only
      // ever cleared cookies, so the row stayed ACTIVE. Two consequences: the
      // device kept showing up in the user's own "Devices" list as a live
      // session long after they signed out (the 30-min reaper only drops rows
      // idle past the cookie TTL), and the token itself remained valid, so a
      // copy recovered from a synced browser profile, a disk backup, or a shared
      // machine would still authenticate. "Log out" has to mean the credential
      // stops working, otherwise the whole revocable-session model is decorative.
      // Best-effort: a DB hiccup must never stop the cookies being cleared.
      if (ctx.user && ctx.sessionSid) {
        try {
          await revokeSession(ctx.user.id, ctx.sessionSid);
        } catch {
          /* cookies are still cleared below */
        }
      }
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      // v2.88: members signed in via email-OTP/PIN carry `relay_session`, not
      // the OAuth cookie — logout must clear BOTH or they stay signed in.
      ctx.res.clearCookie(LOCAL_SESSION_COOKIE, { ...cookieOptions, maxAge: -1 });
      // And a leftover PRE-UPGRADE guest cookie would resurrect a different
      // guest identity for the next visitor on this browser (review v2.88).
      ctx.res.clearCookie(GUEST_COOKIE, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  // v2.0 phone-app namespace
  identity: v2AuthRouter,
  otpAuth: v2OtpAuthRouter,
  directory: v2DirectoryRouter,
  contacts: v2ContactsRouter,
  messages: v2MessagesRouter,
  attachments: v2AttachmentsRouter,
  calls: v2CallsRouter,
  stats: v2StatsRouter,
  push: v2PushRouter,
  partyLines: v2PartyLinesRouter,
  status: v2StatusRouter,
});

export type AppRouter = typeof appRouter;
