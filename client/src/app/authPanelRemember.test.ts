import { describe, it, expect } from "vitest";
import { copyOnScreen, whyCopyMissing } from "../../../server/testing/copyOnScreen";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

/**
 * Login-overhaul registered flow: the AuthPanel gains (a) a "keep me signed in"
 * 30/60/90-day control wired to the server `remember` param, and (b) a
 * secure-lock animation on PIN entry. Source-pinned (no DOM env).
 */
describe("AuthPanel — remember-me + secure-lock", () => {
  const src = read("client/src/app/AuthPanel.tsx");

  it("passes the remember choice to BOTH sign-in mutations", () => {
    expect(src).toMatch(/loginWithPin\.mutateAsync\(\{[^}]*remember[^}]*\}\)/s);
    expect(src).toMatch(/verifyOtp\.mutateAsync\(\{[^}]*remember[^}]*\}\)/s);
  });

  it("offers the 30/60/90-day picker and a session-only (off) state", () => {
    expect(src).toMatch(/const days: Remember\[\] = \[30, 60, 90\]/);
    expect(copyOnScreen(src, "signed out when this browser closes")).toBe(true);
  });

  it("engages the secure-lock animation around the PIN verify", () => {
    expect(src).toMatch(/setLock\("engaging"\)/);
    expect(src).toMatch(/setLock\("ok"\)/);
    expect(src).toMatch(/setLock\("err"\)/);
    expect(src).toMatch(/LockBadge/);
  });
});

describe("server session-cookie remember wiring", () => {
  const router = read("server/v2routers.ts");
  it("verifyOtp + loginWithPin accept remember and pass it to setSessionCookie", () => {
    expect(router).toMatch(/rememberToTtlMs\(input\.remember\)/);
    // both mutations declare the literal-union remember input
    const count = (router.match(/z\.literal\(90\)/g) || []).length;
    expect(count).toBeGreaterThanOrEqual(2);
  });
});
