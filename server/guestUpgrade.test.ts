/* ============================================================
   v2.99.49 — REGISTERING AS A GUEST NO LONGER CHANGES YOUR NUMBER
   OR ORPHANS YOUR DATA.

   Owner report, with screenshots of both numbers side by side: they
   used RELAY as a guest on 601-586, saved contacts, exchanged
   messages and made calls, then registered with their email. After
   verifying the code they were signed in as 737-582 — a brand new
   number — with an empty account. Their old identity was still in
   the database, unreachable.

   THE BUG. `createContext` resolves which identity a browser is using
   from the guest cookie OR the device id, and documents that the
   device id WINS when the two disagree ("cookies are a hint, device
   id is the truth") — that rule exists so a cleared, expired or
   ITP-dropped cookie doesn't cost a guest their number.
   `ensureUserIdentity`, which performs the upgrade at registration,
   looked the guest up by COOKIE TOKEN ONLY. So for every browser
   whose live identity was device-resolved, the upgrade found nothing,
   fell through to its allocate-a-fresh-identity branch, and minted a
   new number. Two functions with two different answers to "who is
   this browser", one of which silently allocates.

   THE FIX. The upgrade is handed the identity the request already
   resolved, plus the device id, and tries them in the same order of
   authority the resolver uses. Every claim is a conditional UPDATE on
   `userId IS NULL`, so it can only ever adopt an UNCLAIMED guest row —
   never take an identity that belongs to another account.
   ============================================================ */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { normalizeDeviceId, deviceIdFromRequest, DEVICE_ID_HEADER } from "./deviceIdHeader";

const read = (...p: string[]) => fs.readFileSync(path.resolve(__dirname, ...p), "utf8");
const V2DB = read("v2db.ts");
const ROUTERS = read("v2routers.ts");
const CONTEXT = read("_core", "context.ts");
const AUTHLOCAL = read("authLocal.ts");

const ENSURE = V2DB.slice(
  V2DB.indexOf("export async function ensureUserIdentity"),
  V2DB.indexOf("export async function markIdentityVerified")
);

describe("the upgrade sees the identity the request actually resolved", () => {
  it("takes both hints the resolver uses, not just the cookie", () => {
    const sig = ENSURE.slice(0, ENSURE.indexOf("): Promise<ResolvedIdentity>"));
    expect(sig).toMatch(/guestToken: string \| null;/);
    expect(sig).toMatch(/resolvedIdentityId\?: number \| null;/);
    expect(sig).toMatch(/deviceId\?: string \| null;/);
  });

  it("tries candidates in the resolver's order of authority", () => {
    const resolved = ENSURE.indexOf("candidates.add(input.resolvedIdentityId)");
    const byToken = ENSURE.indexOf("getIdentityByGuestToken(input.guestToken)");
    const byDevice = ENSURE.indexOf("getIdentityByDeviceId(input.deviceId)");
    for (const [name, at] of [["resolved", resolved], ["token", byToken], ["device", byDevice]] as const) {
      expect(at, `${name} candidate is gathered`).toBeGreaterThan(0);
    }
    // The already-resolved identity first: it is the one every OTHER request in
    // this browser is using, so agreeing with it is the whole point.
    expect(resolved).toBeLessThan(byToken);
    expect(byToken).toBeLessThan(byDevice);
  });

  it("a lookup failure costs nothing — it never falls through to minting", () => {
    // Both optional lookups are individually guarded, so a transient DB hiccup on
    // one of them cannot be the reason a user gets a new number.
    const tokenBranch = ENSURE.slice(
      ENSURE.indexOf("if (input.guestToken)"),
      ENSURE.indexOf("if (input.deviceId)")
    );
    expect(tokenBranch).toMatch(/try \{[\s\S]*\} catch \{/);
    const deviceBranch = ENSURE.slice(
      ENSURE.indexOf("if (input.deviceId)"),
      ENSURE.indexOf("for (const candidateId of candidates)")
    );
    expect(deviceBranch).toMatch(/try \{[\s\S]*\} catch \{/);
  });

  it("candidates are a Set, so the same row is never claimed twice", () => {
    expect(ENSURE).toMatch(/const candidates = new Set<number>\(\);/);
  });
});

describe("claiming a guest row can never steal someone else's identity", () => {
  it("the claim is conditional on the row being UNCLAIMED", () => {
    const claim = ENSURE.slice(
      ENSURE.indexOf("for (const candidateId of candidates)"),
      ENSURE.indexOf("// Fresh permanent identity.")
    );
    expect(claim).toMatch(
      /\.where\(and\(eq\(identities\.id, candidateId\), isNull\(identities\.userId\)\)\)/
    );
    // The verdict comes from the statement that ran, not from a prior read, so
    // two concurrent sign-ins can't both believe they claimed the same row.
    expect(claim).toMatch(/affectedRows/);
    // A refused claim moves to the next candidate rather than aborting.
    expect(claim).toMatch(/if \(!claimed\) continue;/);
  });

  it("returns the claimed row itself, so number and data are unchanged", () => {
    const claim = ENSURE.slice(
      ENSURE.indexOf("for (const candidateId of candidates)"),
      ENSURE.indexOf("// Fresh permanent identity.")
    );
    // Re-read by the SAME id that was claimed — the identity keeps its number,
    // and its contacts / messages / call history reference that id, so they
    // simply carry over.
    expect(claim).toMatch(/const refreshed = await getIdentityById\(candidateId\);/);
    expect(claim).toMatch(/if \(refreshed\) return refreshed;/);
    // Nothing in the claim touches `number`.
    const setBlock = claim.slice(claim.indexOf(".set({"), claim.indexOf(".where("));
    expect(setBlock).not.toMatch(/number/);
    expect(setBlock).toMatch(/userId: input\.userId/);
    expect(setBlock).toMatch(/guestToken: null/);
  });

  it("the device-id lookup only ever returns an unclaimed row", () => {
    // Second, independent guard on the same property: even if the conditional
    // UPDATE were ever loosened, this lookup cannot surface a registered
    // identity in the first place.
    const fn = V2DB.slice(
      V2DB.indexOf("export async function getIdentityByDeviceId"),
      V2DB.indexOf("export async function getIdentityByDeviceId") + 700
    );
    expect(fn).toMatch(/eq\(identities\.deviceId, deviceId\), isNull\(identities\.userId\)/);
  });

  it("minting a new number is the LAST resort, after every candidate failed", () => {
    expect(ENSURE.indexOf("for (const candidateId of candidates)")).toBeLessThan(
      ENSURE.indexOf("const number = await allocateNumber();")
    );
  });

  it("says out loud when an account already has an identity and a guest is stranded", () => {
    // Not silent: re-registering an address that already has an account is the
    // one case where a guest session in this browser really is left behind.
    const early = ENSURE.slice(ENSURE.indexOf("const existingByUser"), ENSURE.indexOf("/* Claim"));
    expect(early).toMatch(/console\.warn/);
    expect(early).toMatch(/left unclaimed/);
  });
});

describe("every path that can mint an identity passes both hints", () => {
  it("verifyOtp — the path the owner actually hit", () => {
    const call = ROUTERS.slice(
      ROUTERS.indexOf("const identity = await ensureUserIdentity({"),
      ROUTERS.indexOf("const identity = await ensureUserIdentity({") + 260
    );
    expect(call).toMatch(/resolvedIdentityId: ctx\.identity\?\.id \?\? null/);
    expect(call).toMatch(/deviceId: ctx\.deviceId \?\? null/);
  });

  it("the PIN / legacy sign-in path too", () => {
    // Same adoption semantics, so signing in doesn't renumber either.
    const at = ROUTERS.indexOf("await ensureUserIdentity({");
    const call = ROUTERS.slice(at, at + 300);
    expect(call).toMatch(/resolvedIdentityId: ctx\.identity\?\.id \?\? null/);
    expect(call).toMatch(/deviceId: ctx\.deviceId \?\? null/);
  });

  it("createContext — which mints on ANY request when the account has no identity", () => {
    const call = CONTEXT.slice(
      CONTEXT.indexOf("identity = await ensureUserIdentity({"),
      CONTEXT.indexOf("identity = await ensureUserIdentity({") + 220
    );
    expect(call).toMatch(/guestToken,/);
    expect(call).toMatch(/deviceId,/);
  });

  it("POST /api/auth/register — the legacy password route", () => {
    const call = AUTHLOCAL.slice(
      AUTHLOCAL.indexOf("await ensureUserIdentity({"),
      AUTHLOCAL.indexOf("await ensureUserIdentity({") + 260
    );
    expect(call).toMatch(/guestToken,/);
    expect(call).toMatch(/deviceId: deviceIdFromRequest\(req\)/);
  });
});

describe("one rule for reading the device-id header", () => {
  it("the resolver delegates instead of keeping its own copy", () => {
    // The two-implementations-of-one-rule shape is what caused this bug; the
    // header rule now has exactly one home.
    expect(CONTEXT).toMatch(/import \{ deviceIdFromRequest \} from "\.\.\/deviceIdHeader";/);
    const fn = CONTEXT.slice(
      CONTEXT.indexOf("export function extractDeviceId"),
      CONTEXT.indexOf("export async function createContext")
    );
    expect(fn).toMatch(/return deviceIdFromRequest\(req\);/);
    expect(fn).not.toMatch(/\[a-f0-9\]/);
  });

  it("accepts a real client-minted id, case-folded", () => {
    expect(normalizeDeviceId("A1B2C3D4E5F6")).toBe("a1b2c3d4e5f6");
    expect(normalizeDeviceId("  a1b2c3d4  ")).toBe("a1b2c3d4");
  });

  it("rejects anything that isn't a plausible id", () => {
    for (const bad of [
      undefined,
      null,
      42,
      "",
      "short",              // under 8
      "a".repeat(65),       // over 64
      "not-hex-at-all!!",
      "a1b2c3d4' OR 1=1 --",
    ]) {
      expect(normalizeDeviceId(bad), `${String(bad)} is refused`).toBeNull();
    }
  });

  it("takes the first value when the header is repeated", () => {
    expect(normalizeDeviceId(["a1b2c3d4", "deadbeef"])).toBe("a1b2c3d4");
  });

  it("reads the header off a request, and survives a request without headers", () => {
    expect(deviceIdFromRequest({ headers: { [DEVICE_ID_HEADER]: "a1b2c3d4" } })).toBe("a1b2c3d4");
    expect(deviceIdFromRequest({ headers: {} })).toBeNull();
    expect(deviceIdFromRequest({})).toBeNull();
    expect(DEVICE_ID_HEADER).toBe("x-relay-device-id");
  });
});

describe("the number only changes when the user asks for a new one", () => {
  it("regenerate is the only thing that rewrites an identity's number", () => {
    // The claim path sets userId/name/cookie fields; the mint path inserts a new
    // row. Neither rewrites `number` on an existing identity — only the explicit
    // regenerate does, and it is exposed as its own confirm-guarded action.
    const writes = [...V2DB.matchAll(/\.update\(identities\)\s*\n?\s*\.set\(\{ number:/g)];
    expect(writes.length).toBe(1);
    expect(ROUTERS).toMatch(/regenerateNumber/);
  });

  it("regenerating propagates the new number to everyone who saved the old one", () => {
    const fn = V2DB.slice(
      V2DB.indexOf("export async function regenerateIdentityNumber"),
      V2DB.indexOf("/* ── presence")
    );
    // Identity + contacts move together or not at all, so no contact is ever
    // left dialling a number that is no longer this person.
    expect(fn).toMatch(/await db\.transaction\(async \(tx\) => \{/);
    expect(fn).toMatch(/const plan = planRenumber\(affected, oldNumber, newNumber\);/);
    expect(fn).toMatch(/tx\.update\(contacts\)\s*\.set\(\{ number: newNumber \}\)/);
  });
});
