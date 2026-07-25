import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import type { Express, Request, Response } from "express";
import * as db from "../db";
import * as v2db from "../v2db";
import { getSessionCookieOptions } from "./cookies";
import { sdk } from "./sdk";
import { GUEST_COOKIE } from "./context";
import { deviceIdFromRequest } from "../deviceIdHeader";

function getQueryParam(req: Request, key: string): string | undefined {
  const value = req.query[key];
  return typeof value === "string" ? value : undefined;
}

export function registerOAuthRoutes(app: Express) {
  app.get("/api/oauth/callback", async (req: Request, res: Response) => {
    const code = getQueryParam(req, "code");
    const state = getQueryParam(req, "state");

    if (!code || !state) {
      res.status(400).json({ error: "code and state are required" });
      return;
    }

    try {
      const tokenResponse = await sdk.exchangeCodeForToken(code, state);
      const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);

      if (!userInfo.openId) {
        res.status(400).json({ error: "openId missing from user info" });
        return;
      }

      await db.upsertUser({
        openId: userInfo.openId,
        name: userInfo.name || null,
        email: userInfo.email ?? null,
        loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
        lastSignedIn: new Date(),
      });

      // v2.0: bind the (just-created or just-updated) user to a phone-app
      // identity. If a guest cookie is present, migrate that guest row in
      // place so the user keeps their existing number, contacts, messages
      // and call history. Otherwise allocate a fresh permanent identity.
      try {
        const user = await db.getUserByOpenId(userInfo.openId);
        if (user) {
          const guestToken =
            (req.cookies?.[GUEST_COOKIE] as string | undefined) ?? null;
          // THE FIFTH MINTING SITE (v2.99.53). v2.99.49 fixed four call sites and
          // missed this one, so it kept the original bug shape: cookie-only, which
          // for any browser whose guest identity is device-resolved falls through
          // to allocateNumber() and strands the guest row. It was the worst of the
          // five, because without resolvedIdentityId the stranded-guest warning
          // could not fire either, so it happened silently.
          //
          // A top-level OAuth redirect cannot carry our custom header, so deviceId
          // is usually null here — passing it costs nothing and is correct on the
          // paths that can supply it, rather than leaving a fifth shape to
          // rediscover later.
          // Resolve the guest row BEFORE the claim: a successful claim nulls the
          // token, so afterwards there is nothing left to compare against.
          const guestBefore = guestToken
            ? await v2db.getIdentityByGuestToken(guestToken).catch(() => null)
            : null;
          const identity = await v2db.ensureUserIdentity({
            userId: user.id,
            displayName: userInfo.name || "User",
            guestToken,
            deviceId: deviceIdFromRequest(req),
          });
          // Clear the guest cookie only when the identity we ended up with really
          // IS this browser's guest row, or when there was no guest row at all
          // (a stale token worth dropping). Clearing it unconditionally — the old
          // behaviour, "regardless of whether the migration happened" — destroyed
          // the last durable handle on a guest row whose adoption had just failed:
          // the token is the only half of guest identity that survives a browser
          // close, so dropping it turns a recoverable orphan into a permanent one.
          // Note `isGuest === false` is NOT a usable test here: it is equally true
          // of a freshly minted identity, i.e. exactly the failure case.
          if (!guestBefore || identity.id === guestBefore.id) {
            res.clearCookie(GUEST_COOKIE, { path: "/" });
          } else {
            console.warn(
              `[oauth] guest identity ${guestBefore.id} (${guestBefore.number}) not adopted by user ${user.id}; keeping its cookie so it stays recoverable`
            );
          }
        }
      } catch (mergeErr) {
        console.warn("[OAuth] guest-identity merge failed (continuing)", mergeErr);
      }

      const sessionToken = await sdk.createSessionToken(userInfo.openId, {
        name: userInfo.name || "",
        expiresInMs: ONE_YEAR_MS,
      });

      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });

      res.redirect(302, "/app");
    } catch (error) {
      console.error("[OAuth] Callback failed", error);
      res.status(500).json({ error: "OAuth callback failed" });
    }
  });
}
