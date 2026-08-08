/**
 * ACCOUNT-WIDE APP LOCK (v2.107.77) — the pins.
 *
 * The lock was device-local localStorage, which is why the owner's iPhone asked
 * for a passcode and his Android did not. Now the client-computed hash+salt are
 * mirrored on the identity and every device adopts them on load. What this file
 * pins is the SHAPE of that sync and, separately, the exact proof the forgot
 * path demands — because the forgot path is offered on the lock screen itself,
 * and a forgot path that accepts too little is a lock that opens for whoever is
 * holding the phone.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { APP_LOCK_FRESH_MS, isFreshSession } from "../../../server/v2routers";

const read = (p: string) => readFileSync(resolve(__dirname, "../../..", p), "utf8");
const ROUTERS = read("server/v2routers.ts");
const DB = read("server/v2db.ts");
const PASS = read("client/src/app/passcode.ts");
const ENGINE = read("client/src/app/RelayEngine.tsx");
const PROFILE = read("client/src/pages/app/Profile.tsx");
const GATE = read("client/src/app/PasscodeGate.tsx");
const MOUNT = read("server/routers.ts");

describe("the server sync store", () => {
  it("identities gains the three additive columns via ensureColumn", () => {
    for (const col of ["appLockHash", "appLockSalt", "appLockAt"]) {
      expect(DB).toMatch(new RegExp(`table: "identities", column: "${col}"`));
    }
  });

  it("the router is mounted and exposes get / set / clear / resetFresh", () => {
    expect(MOUNT).toMatch(/appLock: v2AppLockRouter,/);
    const r = ROUTERS.slice(ROUTERS.indexOf("export const v2AppLockRouter"));
    for (const ep of ["get:", "set:", "clear:", "resetFresh:"]) expect(r).toMatch(ep);
  });

  it("`set` accepts only the client-computed pair — the plaintext never has a field", () => {
    const r = ROUTERS.slice(
      ROUTERS.indexOf("export const v2AppLockRouter"),
      ROUTERS.indexOf("export const v2PushRouter"),
    );
    // The whole input object is exactly {hash, salt}: nothing else can arrive.
    expect(r).toMatch(
      /set: publicProcedure\s*\n\s*\.input\(z\.object\(\{ hash: z\.string\(\)\.regex\(APP_LOCK_HASH\), salt: z\.string\(\)\.regex\(APP_LOCK_SALT\) \}\)\)/,
    );
  });
});

describe("the forgot path demands real proof", () => {
  it("a guest must present the recovery key — device auto-restore mints fresh sessions, so freshness proves nothing for a guest", () => {
    const r = ROUTERS.slice(ROUTERS.indexOf("resetFresh:"), ROUTERS.indexOf("export const v2PushRouter"));
    expect(r).toMatch(/if \(me\.isGuest\)/);
    expect(r).toMatch(/guest-key-required/);
    expect(r).toMatch(/hashRecoveryKey\(key\) !== stored/);
  });

  it("a registered account must hold a FRESH session — credentials were needed to mint it", () => {
    const r = ROUTERS.slice(ROUTERS.indexOf("resetFresh:"), ROUTERS.indexOf("export const v2PushRouter"));
    expect(r).toMatch(/getSessionCreatedAt\(ctx\.sessionSid/);
    expect(r).toMatch(/stale-session/);
  });

  it("the freshness window is a bounded fifteen minutes, and the math rejects the edge cases", () => {
    expect(APP_LOCK_FRESH_MS).toBe(15 * 60_000);
    const now = new Date("2026-08-08T12:00:00Z");
    expect(isFreshSession(new Date(now.getTime() - 60_000), now)).toBe(true);
    expect(isFreshSession(new Date(now.getTime() - APP_LOCK_FRESH_MS - 1), now)).toBe(false);
    expect(isFreshSession(null, now)).toBe(false); // no row = not fresh
    expect(isFreshSession(new Date(now.getTime() + 60_000), now)).toBe(false); // clock skew forward
  });
});

describe("the client sync — one policy, one place", () => {
  it("passcode.ts exports the two primitives and setPasscode returns the pair", () => {
    expect(PASS).toMatch(/export function localLockSnapshot\(\)/);
    expect(PASS).toMatch(/export function adoptRemoteLock\(hash: string, salt: string/);
    expect(PASS).toMatch(/Promise<\{ hash: string; salt: string \}>/);
    // Adoption is shape-checked, so a malformed sync cannot poison the cache.
    expect(PASS).toMatch(/\^\[0-9a-f\]\{64\}\$/);
  });

  it("RelayEngine adopts the account's lock (locking immediately only when this device had none) and pushes a pre-feature local lock up once", () => {
    expect(ENGINE).toMatch(/trpc\.appLock\.get\.useQuery/);
    expect(ENGINE).toMatch(/adoptRemoteLock\(remote\.hash, remote\.salt, \{ lockNow: !local \}\)/);
    expect(ENGINE).toMatch(/appLockPushedRef\.current = true/);
  });

  it("Settings mirrors set AND clear to the account — a lock removed on one device must not re-adopt from the server", () => {
    expect(PROFILE).toMatch(/appLockSetMut\.mutate\(pair\)/);
    expect(PROFILE).toMatch(/appLockClearMut\.mutate\(\)/);
  });

  it("the gate offers Forgot, calls resetFresh, and clears BOTH local caches on success", () => {
    expect(GATE).toMatch(/Forgot passcode\?/);
    expect(GATE).toMatch(/resetMut\.mutateAsync\(\{ recoveryKey \}\)/);
    const fn = GATE.slice(GATE.indexOf("async function attemptReset"), GATE.indexOf("async function signOutFromGate"));
    expect(fn).toMatch(/clearPasscode\(\)/);
    expect(fn).toMatch(/clearBiometric\(\)/);
    // The three server verdicts each route to their stage, so a guest is asked for
    // the key and a stale registered session is told to sign in again.
    for (const verdict of ["guest-key-required", "bad-key", "stale-session"]) {
      expect(fn).toMatch(verdict);
    }
  });

  it("the gate's old 'lives only in this browser' claim is gone — it is no longer true", () => {
    expect(GATE).not.toMatch(/lives only in this browser/);
  });
});
