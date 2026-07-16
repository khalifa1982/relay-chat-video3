import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import { COOKIE_NAME } from "../shared/const";
import type { TrpcContext } from "./_core/context";

type CookieCall = {
  name: string;
  options: Record<string, unknown>;
};

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAuthContext(): { ctx: TrpcContext; clearedCookies: CookieCall[] } {
  const clearedCookies: CookieCall[] = [];

  const user: AuthenticatedUser = {
    id: 1,
    openId: "sample-user",
    email: "sample@example.com",
    name: "Sample User",
    loginMethod: "manus",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  const ctx: TrpcContext = {
    user,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: (name: string, options: Record<string, unknown>) => {
        clearedCookies.push({ name, options });
      },
    } as TrpcContext["res"],
  };

  return { ctx, clearedCookies };
}

describe("auth.logout", () => {
  it("clears the session cookies and reports success", async () => {
    const { ctx, clearedCookies } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.auth.logout();

    expect(result).toEqual({ success: true });
    // v2.88: logout clears BOTH session flavors — the OAuth cookie AND the
    // email-OTP/PIN `relay_session` (members signed in passwordlessly used to
    // stay signed in after "logout"). Review v2.88: ALSO the guest cookie —
    // a leftover pre-upgrade guest identity must not resurrect for the next
    // visitor on this browser.
    expect(clearedCookies).toHaveLength(3);
    const names = clearedCookies.map((c) => c.name);
    expect(names).toContain(COOKIE_NAME);
    expect(names).toContain("relay_session");
    expect(names).toContain("relay_guest");
    // v2.1.0: cookie hardened from SameSite=None to SameSite=Lax to
    // stop Safari/Brave/Firefox from silently dropping the session
    // cookie under privacy-mode treatment. Same-origin app, so Lax
    // is the correct value and matches every other field above.
    for (const cleared of clearedCookies) {
      expect(cleared.options).toMatchObject({
        maxAge: -1,
        secure: true,
        sameSite: "lax",
        httpOnly: true,
        path: "/",
      });
    }
  });
});

describe("identity.signOutGuest", () => {
  it("expires ALL THREE session cookies (guest, relay_session, app_session_id)", async () => {
    const { ctx, clearedCookies } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.identity.signOutGuest();

    expect(result).toEqual({ ok: true });
    const names = clearedCookies.map((c) => c.name);
    // A guest sign-out is an identity wipe on this browser — every session
    // flavor must die, or the next visit silently restores the old identity.
    expect(names).toContain("relay_guest");
    expect(names).toContain("relay_session");
    expect(names).toContain("relay_guest");
    expect(names).toContain(COOKIE_NAME);
    expect(clearedCookies).toHaveLength(3);
    for (const cleared of clearedCookies) {
      expect(cleared.options).toMatchObject({ maxAge: -1, path: "/" });
    }
  });
});
