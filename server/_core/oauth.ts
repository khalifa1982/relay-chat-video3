import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import type { Express, Request, Response } from "express";
import * as db from "../db";
import * as v2db from "../v2db";
import { getSessionCookieOptions } from "./cookies";
import { sdk } from "./sdk";
import { GUEST_COOKIE } from "./context";

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
          await v2db.ensureUserIdentity({
            userId: user.id,
            displayName: userInfo.name || "User",
            guestToken,
          });
          // Clear the guest cookie regardless of whether the migration
          // happened — from this point on the auth session is the source
          // of truth, and a stale guest cookie would just create noise.
          res.clearCookie(GUEST_COOKIE, { path: "/" });
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
