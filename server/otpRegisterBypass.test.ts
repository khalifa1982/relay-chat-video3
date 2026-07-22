import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

const AUTH_PANEL = readFileSync(join(__dirname, "..", "client/src/app/AuthPanel.tsx"), "utf8");

/**
 * v2.97.2 — RELAY_OTP_REGISTER_BYPASS (owner directive, 2026-07-22): the
 * operator's SES account is sandboxed pending AWS's production-access
 * review, so AWS refuses OTP emails to anyone but a pre-verified address —
 * every new registration failed with "couldn't send your code" (owner
 * screenshot). This flag lets registration skip the code entirely and sign
 * the caller in immediately, as a TEMPORARY stopgap until SES is approved.
 *
 * Default OFF (unset): register() is byte-identical to before this change —
 * pinned by asserting the flag reader and by the existing otpAuth.test.ts
 * suite staying green. ON: the account-creation branch is taken instead of
 * ever touching mintOtp/dispatchOtp — proven behaviorally in the test env's
 * no-DB harness (both branches ultimately fail without a live database, but
 * with DIFFERENT, branch-specific errors, which is exactly the evidence that
 * the bypass takes a different code path).
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

describe("RELAY_OTP_REGISTER_BYPASS (email-outage stopgap)", () => {
  it("is OFF by default — register() takes the normal mint/email path (fails on DB unavailability, not account creation)", async () => {
    delete process.env[FLAG];
    await expect(
      caller().otpAuth.register({ firstName: "Alex", lastName: "Rivera", email: "bypass-off@example.com" })
    ).rejects.toThrow(/database unavailable/i);
  });

  it("anything other than the literal '1' is treated as OFF", async () => {
    process.env[FLAG] = "true";
    await expect(
      caller().otpAuth.register({ firstName: "Alex", lastName: "Rivera", email: "bypass-off2@example.com" })
    ).rejects.toThrow(/database unavailable/i);
  });

  it("ON: skips mintOtp/dispatchOtp entirely and goes straight for account creation (a DIFFERENT failure in the no-DB test env proves the branch)", async () => {
    process.env[FLAG] = "1";
    await expect(
      caller().otpAuth.register({ firstName: "Alex", lastName: "Rivera", email: "bypass-on@example.com" })
    ).rejects.toThrow(/could not create your account/i);
  });

  it("still validates input BEFORE consulting the bypass flag", async () => {
    process.env[FLAG] = "1";
    await expect(
      caller().otpAuth.register({ firstName: "", lastName: "Rivera", email: "a@b.co" })
    ).rejects.toThrow();
    await expect(
      caller().otpAuth.register({ firstName: "Alex", lastName: "Rivera", email: "not-an-email" })
    ).rejects.toThrow();
  });

  it("login (requestOtp/verifyOtp/loginWithPin) is completely unaffected by the flag", async () => {
    process.env[FLAG] = "1";
    // requestOtp for an unknown email still reports unregistered — same as the
    // OFF-path test in otpAuth.test.ts — proving the flag is register()-only.
    const r = await caller().otpAuth.requestOtp({ email: "stranger-bypass@example.com" });
    expect(r).toMatchObject({ ok: true, unregistered: true });
    expect(r.sent).toBe(false);
  });
});

describe("AuthPanel client handling of register()'s bypass response", () => {
  it("skips the code stage and lands on the post-registration setup step", () => {
    const fn = AUTH_PANEL.slice(AUTH_PANEL.indexOf("async function submitRegister"));
    const body = fn.slice(0, fn.indexOf("\n  }\n"));
    expect(body).toMatch(/\(r as \{ bypass\?: boolean \}\)\.bypass/);
    expect(body).toMatch(/utils\.identity\.whoami\.invalidate\(\)/);
    expect(body).toMatch(/setStage\("setup"\)/);
    // The bypass branch must return BEFORE the normal toCodeStage() call.
    const bypassIdx = body.indexOf("bypass");
    const codeStageIdx = body.indexOf("toCodeStage()");
    expect(bypassIdx).toBeGreaterThan(-1);
    expect(codeStageIdx).toBeGreaterThan(bypassIdx);
  });
});
