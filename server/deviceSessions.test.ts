import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { deviceLabelFromUA } from "./deviceLabel";

/**
 * v2.99.1 — multi-device session ledger + device list with remote logout.
 *
 * The pure device-label parser is tested behaviorally; the DB helpers +
 * createContext gating (which need a live MySQL) are pinned against source so
 * the two safety invariants can't silently regress:
 *   1. legacy (no-sid) cookies NEVER touch the ledger — zero risk to sessions
 *      already in the wild;
 *   2. the revocation gate FAILS OPEN on any DB error — a hiccup can't
 *      mass-log-out the fleet.
 */
describe("deviceLabelFromUA", () => {
  it("labels common mobile browsers", () => {
    expect(deviceLabelFromUA(
      "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36",
    )).toBe("Chrome on Android");
    expect(deviceLabelFromUA(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    )).toBe("Safari on iPhone");
  });
  it("labels desktop browsers, disambiguating Chrome-family spoofing", () => {
    expect(deviceLabelFromUA(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 Edg/120.0",
    )).toBe("Edge on Windows");
    expect(deviceLabelFromUA(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
    )).toBe("Safari on Mac");
    expect(deviceLabelFromUA(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
    )).toBe("Chrome on Windows");
  });
  it("recognises the native RELAY app", () => {
    expect(deviceLabelFromUA("RelayNative/3.0 (Android 14)")).toBe("RELAY app on Android");
  });
  it("never throws; unknown/empty → a friendly fallback", () => {
    expect(deviceLabelFromUA("")).toBe("Unknown device");
    expect(deviceLabelFromUA(undefined)).toBe("Unknown device");
    expect(deviceLabelFromUA(12345)).toBe("Unknown device");
    expect(deviceLabelFromUA("something weird")).toBe("Unknown device");
  });
});

describe("revocable-session wiring (source pins)", () => {
  const v2db = readFileSync(join(__dirname, "v2db.ts"), "utf8");
  const ctx = readFileSync(join(__dirname, "_core", "context.ts"), "utf8");
  const routers = readFileSync(join(__dirname, "v2routers.ts"), "utf8");

  it("sessionState fails OPEN on a DB error (never mass-logout)", () => {
    // The catch returns "error", and the caller treats non-"revoked" as valid.
    expect(v2db).toMatch(/catch\s*\{\s*return "error";\s*\}/);
    expect(ctx).toMatch(/if \(state !== "revoked"\)/);
  });

  it("createContext only consults the ledger for cookies that carry a sid", () => {
    // Legacy cookies (sess.sid falsy) go down the plain getUserById path.
    expect(ctx).toMatch(/if \(sess\.sid\) \{/);
    expect(ctx).toMatch(/const state = await sessionState\(sess\.sid\)/);
  });

  it("revokeSession is ownership-scoped (a user can only revoke their own)", () => {
    expect(v2db).toMatch(/and\(eq\(sessions\.userId, userId\), eq\(sessions\.sid, sid\)\)/);
  });

  it("every login path records a session + threads the sid into the cookie", () => {
    // startSession() records the ledger row and returns the sid; the two
    // sign-in mutations mint one (verifyOtp / loginWithPin). v2.99.35 removed
    // the register-bypass sign-in (register now only emails a code — the actual
    // sign-in happens in verifyOtp), so there are TWO session-minting paths.
    // v2.99.7 split verifyOtp's call across two lines (it needs the sid for the
    // pending-approval branch), so count startSession calls directly + confirm
    // each mints the cookie with a sid.
    expect(routers).toMatch(/async function startSession\(/);
    const starts = routers.match(/await startSession\(ctx, [^)]*\)/g) || [];
    expect(starts.length).toBe(2);
    const cookieWithSid = routers.match(/setSessionCookie\(ctx\.res, [^;]*(await startSession\(ctx,|sid\))/g) || [];
    expect(cookieWithSid.length).toBe(2);
  });

  it("revoking the CURRENT device also clears this cookie; signOut drops its row", () => {
    expect(routers).toMatch(/input\.sid === ctx\.sessionSid/);
    expect(routers).toMatch(/clearCookie\(LOCAL_SESSION_COOKIE/);
    expect(routers).toMatch(/await revokeSession\(ctx\.user\.id, ctx\.sessionSid\)/);
  });
});
