import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

/**
 * v2.68 passwordless email-OTP router — validation + no-DB branch behavior, plus
 * the whoami `verified` passthrough that drives the blue badge. (getDb() is null
 * in the test env, which cleanly exercises the "unknown email" / "expired code"
 * branches without a live database.)
 */
function makeCtx(identity: TrpcContext["identity"] = null): TrpcContext {
  return {
    user: null,
    identity,
    req: { protocol: "https", headers: {}, cookies: {} } as TrpcContext["req"],
    res: {
      cookie: () => undefined,
      clearCookie: () => undefined,
    } as unknown as TrpcContext["res"],
  };
}

const caller = () => appRouter.createCaller(makeCtx(null));

describe("otpAuth.requestOtp", () => {
  it("rejects a malformed email", async () => {
    await expect(caller().otpAuth.requestOtp({ email: "not-an-email" })).rejects.toThrow();
  });
  it("reports an unknown email as unregistered (no code sent)", async () => {
    // No DB in tests → findUserByEmailAny returns null → registration branch.
    const r = await caller().otpAuth.requestOtp({ email: "stranger@example.com" });
    expect(r).toMatchObject({ ok: true, unregistered: true });
    expect(r.sent).toBe(false);
  });
});

describe("otpAuth.register", () => {
  it("requires first AND last name", async () => {
    await expect(
      caller().otpAuth.register({ firstName: "", lastName: "Rivera", email: "a@b.co" })
    ).rejects.toThrow();
    await expect(
      caller().otpAuth.register({ firstName: "Alex", lastName: "  ", email: "a@b.co" })
    ).rejects.toThrow();
  });
});

describe("otpAuth.verifyOtp", () => {
  it("rejects a non-6-digit code before touching anything", async () => {
    await expect(
      caller().otpAuth.verifyOtp({ email: "a@b.co", code: "12ab" })
    ).rejects.toThrow();
    await expect(
      caller().otpAuth.verifyOtp({ email: "a@b.co", code: "1234567" })
    ).rejects.toThrow();
  });
  it("rejects a well-formed code when there's no pending OTP (expired/none)", async () => {
    await expect(
      caller().otpAuth.verifyOtp({ email: "a@b.co", code: "123456" })
    ).rejects.toThrow(/expired|code/i);
  });
});

describe("whoami — verified passthrough (blue badge source)", () => {
  const base = {
    id: 7,
    number: "482015",
    displayName: "Alex Rivera",
    avatarUrl: null,
    userId: 3,
    isGuest: false,
    guestExpiresAt: null,
    bio: null,
    statusOverride: null,
    mobiles: [],
    socials: [],
    firstName: "Alex",
    lastName: "Rivera",
  };
  it("surfaces verified=true for a verified identity", async () => {
    const me = await appRouter.createCaller(makeCtx({ ...base, verified: true })).identity.whoami();
    expect(me?.verified).toBe(true);
  });
  it("surfaces verified=false for an unverified/guest identity", async () => {
    const me = await appRouter
      .createCaller(makeCtx({ ...base, userId: null, isGuest: true, verified: false }))
      .identity.whoami();
    expect(me?.verified).toBe(false);
  });
});
