import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

const V2ROUTERS = readFileSync(join(__dirname, "v2routers.ts"), "utf8");
const AUTH_PANEL = readFileSync(join(__dirname, "..", "client/src/app/AuthPanel.tsx"), "utf8");

/**
 * v2.99.35 — the v2.97.2 `RELAY_OTP_REGISTER_BYPASS` email-outage stopgap is
 * REMOVED now that the operator's SES account is out of the AWS sandbox
 * (production access approved 2026-07-24). Registration ALWAYS mints + emails a
 * real verification code and requires verifyOtp before an account is created —
 * email ownership is proven at signup unconditionally, and no env flag can
 * silently re-disable it. This suite pins that the bypass is gone and that
 * register() always takes the mint/email path regardless of the old flag.
 */
function makeCtx(): TrpcContext {
  return {
    user: null,
    identity: null,
    req: { protocol: "https", headers: {}, cookies: {} } as TrpcContext["req"],
    res: {
      cookie: () => undefined,
      clearCookie: () => undefined,
    } as unknown as TrpcContext["res"],
  };
}
const caller = () => appRouter.createCaller(makeCtx());
const FLAG = "RELAY_OTP_REGISTER_BYPASS";
afterEach(() => {
  delete process.env[FLAG];
});

describe("register() always verifies by email (v2.97.2 bypass removed)", () => {
  it("no longer reads RELAY_OTP_REGISTER_BYPASS anywhere in the router", () => {
    expect(V2ROUTERS).not.toMatch(/process\.env\.RELAY_OTP_REGISTER_BYPASS/);
    expect(V2ROUTERS).not.toMatch(/otpRegisterBypassEnabled/);
    expect(V2ROUTERS).not.toMatch(/return \{ ok: true, sent: false, bypass: true \}/);
  });

  it("takes the mint/email path (fails on DB unavailability in the no-DB test env)", async () => {
    delete process.env[FLAG];
    await expect(
      caller().otpAuth.register({ firstName: "Alex", lastName: "Rivera", email: "verify@example.com" })
    ).rejects.toThrow(/database unavailable/i);
  });

  it("the old flag has NO effect anymore — still the mint/email path with it set", async () => {
    process.env[FLAG] = "1";
    await expect(
      caller().otpAuth.register({ firstName: "Alex", lastName: "Rivera", email: "verify2@example.com" })
    ).rejects.toThrow(/database unavailable/i); // NOT "could not create your account"
  });

  it("still validates input before doing anything", async () => {
    await expect(
      caller().otpAuth.register({ firstName: "", lastName: "Rivera", email: "a@b.co" })
    ).rejects.toThrow();
    await expect(
      caller().otpAuth.register({ firstName: "Alex", lastName: "Rivera", email: "not-an-email" })
    ).rejects.toThrow();
  });

  it("login (requestOtp) is unaffected", async () => {
    const r = await caller().otpAuth.requestOtp({ email: "stranger@example.com" });
    expect(r).toMatchObject({ ok: true, unregistered: true });
    expect(r.sent).toBe(false);
  });
});

describe("AuthPanel no longer handles a bypass response", () => {
  it("submitRegister goes straight to the code stage (no bypass short-circuit)", () => {
    const fn = AUTH_PANEL.slice(AUTH_PANEL.indexOf("async function submitRegister"));
    const body = fn.slice(0, fn.indexOf("\n  }\n"));
    expect(body).not.toMatch(/\.bypass/);
    expect(body).toMatch(/toCodeStage\(\)/);
  });
});
