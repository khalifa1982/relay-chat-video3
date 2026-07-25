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
const OAUTH = read("_core", "oauth.ts");

/** Every server source file, so "these are all the minting sites" is a fact
 *  checked against the tree rather than a list kept up to date by hand. */
const SOURCES: Array<{ name: string; src: string }> = (function walk(dir, prefix): Array<{ name: string; src: string }> {
  const out: Array<{ name: string; src: string }> = [];
  for (const e of fs.readdirSync(path.resolve(__dirname, dir), { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (e.name === "node_modules") continue;
      out.push(...walk(path.join(dir, e.name), prefix + e.name + "/"));
    } else if (e.name.endsWith(".ts") && !e.name.endsWith(".test.ts")) {
      out.push({ name: prefix + e.name, src: read(dir, e.name) });
    }
  }
  return out;
})(".", "");

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
    const resolved = ENSURE.indexOf("addCandidate(input.resolvedIdentityId)");
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

  it("deduplicates, so the same row is never attempted twice", () => {
    // The three sources routinely agree; without this, a claim that succeeded on
    // the first candidate would be re-attempted and fail its own userId IS NULL
    // gate. A plain array, not a Set: this project sets no tsconfig `target`, so
    // it compiles as ES5 and iterating a Set is a type error.
    expect(ENSURE).toMatch(/if \(id && !candidates\.includes\(id\)\) candidates\.push\(id\);/);
    expect(ENSURE).not.toMatch(/new Set</);
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
    // Both indices must EXIST before their order means anything. The first
    // version of this test compared the two indexOf results directly, and on
    // pre-fix code the candidate loop was absent (-1) while allocate was at 959
    // — so `-1 < 959` and the test passed against the very code it was written
    // to reject.
    const loop = ENSURE.indexOf("for (const candidateId of candidates)");
    const mint = ENSURE.indexOf("const number = await allocateNumber();");
    expect(loop, "the candidate loop exists at all").toBeGreaterThan(-1);
    expect(mint, "the mint path exists at all").toBeGreaterThan(-1);
    expect(loop).toBeLessThan(mint);
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
  /* EVERY call site is checked INDEPENDENTLY, by enumerating all of them rather
     than reaching for indexOf.
     The first version of this suite used `ROUTERS.indexOf("await
     ensureUserIdentity({")` to locate the PIN site — but that substring first
     occurs 17 characters INSIDE verifyOtp's own `const identity = await
     ensureUserIdentity({`, so the test re-read verifyOtp and never looked at the
     PIN path at all. Proven by reverting the PIN site to the pre-fix cookie-only
     shape: all 20 tests still passed. A test that cannot fail when the bug it
     covers is reintroduced is worse than no test, because it reports safety. */
  function callsIn(src: string): string[] {
    return [...src.matchAll(/ensureUserIdentity\(\{/g)].map((m) =>
      src.slice(m.index as number, (m.index as number) + 320)
    );
  }

  it("v2routers has exactly TWO minting sites and BOTH pass both hints", () => {
    const calls = callsIn(ROUTERS);
    expect(calls.length, "verifyOtp + the PIN/legacy sign-in path").toBe(2);
    for (const [i, call] of calls.entries()) {
      expect(call, `v2routers site ${i + 1} passes the resolved identity`).toMatch(
        /resolvedIdentityId: ctx\.identity\?\.id \?\? null/
      );
      expect(call, `v2routers site ${i + 1} passes the device id`).toMatch(
        /deviceId: ctx\.deviceId \?\? null/
      );
    }
    // And they really are the two distinct paths, not one counted twice.
    expect(ROUTERS.indexOf("const identity = await ensureUserIdentity({")).toBeGreaterThan(0);
    expect(ROUTERS).toMatch(/case "ok": \{[\s\S]{0,900}?ensureUserIdentity\(\{/);
  });

  it("createContext — which mints on ANY request when the account has no identity", () => {
    const calls = callsIn(CONTEXT);
    expect(calls.length).toBe(1);
    expect(calls[0]).toMatch(/guestToken,/);
    expect(calls[0]).toMatch(/deviceId,/);
  });

  it("POST /api/auth/register — the legacy password route", () => {
    const calls = callsIn(AUTHLOCAL);
    expect(calls.length).toBe(1);
    expect(calls[0]).toMatch(/guestToken,/);
    expect(calls[0]).toMatch(/deviceId: deviceIdFromRequest\(req\)/);
  });

  it("the OAuth callback — the FIFTH site, missed by v2.99.49", () => {
    // It kept the original cookie-only shape on a still-mounted route, and was
    // the worst of the five: without resolvedIdentityId the stranded-guest
    // warning could not fire, so it stranded people silently.
    const calls = callsIn(OAUTH);
    expect(calls.length).toBe(1);
    expect(calls[0]).toMatch(/guestToken,/);
    expect(calls[0]).toMatch(/deviceId: deviceIdFromRequest\(req\)/);
  });

  it("and there are no OTHER minting sites anywhere in the tree", () => {
    // The guard that makes the four tests above exhaustive rather than a list
    // someone has to remember to extend.
    const files = SOURCES.filter((f) => /ensureUserIdentity\(\{/.test(f.src));
    expect(files.map((f) => f.name).sort()).toEqual(
      ["_core/context.ts", "_core/oauth.ts", "authLocal.ts", "v2routers.ts"].sort()
    );
  });
});

describe("the OAuth callback no longer destroys the recovery evidence", () => {
  it("keeps the guest cookie when adoption did NOT happen", () => {
    // The token is the only half of guest identity that survives a browser close.
    // Clearing it after a failed claim turns a recoverable orphan into a
    // permanent one, which is what the old unconditional clearCookie did.
    expect(OAUTH).toMatch(/const guestBefore = guestToken/);
    expect(OAUTH).toMatch(/if \(!guestBefore \|\| identity\.id === guestBefore\.id\) \{/);
    expect(OAUTH).toMatch(/console\.warn\([\s\S]{0,200}not adopted by user/);
    // Resolved BEFORE the claim, because a successful claim nulls the token.
    expect(OAUTH.indexOf("const guestBefore")).toBeLessThan(
      OAUTH.indexOf("await v2db.ensureUserIdentity({")
    );
  });

  it("does not decide adoption from the identity's guest flag", () => {
    // That flag is equally false for a freshly minted identity — i.e. for exactly
    // the failure case this guard exists for. Checked against CODE only: the
    // surrounding comment names the flag in order to warn about it, and an
    // assertion that a word is absent from the file would be satisfied by
    // deleting the warning.
    const block = OAUTH.slice(OAUTH.indexOf("const guestBefore"), OAUTH.indexOf("const sessionToken"))
      .split("\n")
      .filter((l) => !l.trim().startsWith("//"))
      .join("\n");
    expect(block).not.toMatch(/identity\.isGuest/);
  });
});

describe("losing the per-user unique-index race cannot break a registration", () => {
  it("the claim resolves to the winner instead of throwing", () => {
    const claim = ENSURE.slice(
      ENSURE.indexOf("for (const candidateId of candidates)"),
      ENSURE.indexOf("// Fresh permanent identity.")
    );
    expect(claim).toMatch(/try \{/);
    expect(claim).toMatch(/\} catch \{[\s\S]*?getIdentityByUserId\(input\.userId\)/);
    // An uncaught throw here surfaces as a 500 from verifyOtp AFTER consumeOtp
    // has burned the code, so the user is told the code was already used.
    expect(ROUTERS.indexOf("consumeOtp")).toBeLessThan(
      ROUTERS.indexOf("const identity = await ensureUserIdentity({")
    );
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
