/**
 * v2.100.1 — a second-device sign-in says WHERE it came from and HOW.
 *
 * The owner, on the approval flow they had already asked for in v2.99.7:
 *
 *   *"it need to be sent always the details from where his login type, country,
 *   IP, device name, everything."*
 *
 * The three ways in already existed and are CONFIRMED here rather than rebuilt —
 * the 4-digit passcode bypasses approval by the owner's own spec, an email code
 * parks as pending when another device is online, and that device approves or
 * declines. What did not exist is the DETAIL on the prompt: it said "New sign-in
 * waiting" and a device label, and nothing else.
 *
 * The formatting is tested BEHAVIOURALLY, because a source pin cannot tell you
 * whether a login with a city and no country reads correctly.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { codeOnly } from "./testing/codeOnly";
import {
  LOGIN_METHODS,
  describeLogin,
  describeLoginPlace,
  loginMethodLabel,
  normalizeCity,
  normalizeCountry,
  normalizeLoginIp,
  normalizeLoginMethod,
} from "./loginOrigin";

const ROOT = path.resolve(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

const ROUTERS = read("server/v2routers.ts");
const V2DB = read("server/v2db.ts");
const SCHEMA = read("drizzle/schema.ts");
const PROFILE = read("client/src/pages/app/Profile.tsx");
const BELL = read("client/src/app/MissedCalls.tsx");
const SHELL = read("client/src/app/AppShell.tsx");


describe("the login method — the owner's three ways in", () => {
  it("is exactly the three, and the count is asserted", () => {
    expect([...LOGIN_METHODS]).toEqual(["code", "pin", "register"]);
  });

  it("FAILS TO NULL on anything unrecognised, never to a default", () => {
    // This string is shown to the account owner as a claim about how somebody got
    // in. "Signed in with a passcode" when it was really an email code is worse
    // than saying nothing at all.
    expect(normalizeLoginMethod("passkey")).toBeNull();
    expect(normalizeLoginMethod("")).toBeNull();
    expect(normalizeLoginMethod(null)).toBeNull();
    expect(normalizeLoginMethod("CODE")).toBeNull(); // no case folding: not a value we write
    expect(loginMethodLabel(undefined)).toBeNull();
  });

  it("names each one in the owner's own vocabulary", () => {
    expect(loginMethodLabel("code")).toBe("Email code");
    expect(loginMethodLabel("pin")).toBe("4-digit passcode");
    expect(loginMethodLabel("register")).toBe("New registration");
  });
});

describe("describing where a sign-in came from", () => {
  it("prefers the most specific place it can honestly name", () => {
    expect(describeLoginPlace({ city: "Dubai", country: "ae", ip: "1.2.3.4" })).toBe("Dubai, AE");
    expect(describeLoginPlace({ city: "Dubai", ip: "1.2.3.4" })).toBe("Dubai");
    expect(describeLoginPlace({ country: "AE", ip: "1.2.3.4" })).toBe("AE");
  });

  it("falls back to the IP, which is the one detail that always survives", () => {
    // On a LAN, behind a VPN or on a GeoIP miss there is no place to name — and
    // that is the ordinary case, not an edge one.
    expect(describeLoginPlace({ ip: "203.0.113.9" })).toBe("203.0.113.9");
  });

  it("returns null rather than an empty string when it knows nothing", () => {
    expect(describeLoginPlace({})).toBeNull();
    expect(describeLoginPlace({ ip: "   ", city: "", country: "" })).toBeNull();
  });

  it("joins place and method, and emits NO dangling separator when one is missing", () => {
    // An interpolation that always writes " · " is how a card ends up reading
    // "Dubai, AE ·" with nothing after it.
    expect(describeLogin({ city: "Dubai", country: "AE", method: "pin" })).toBe(
      "Dubai, AE · 4-digit passcode"
    );
    expect(describeLogin({ city: "Dubai", country: "AE" })).toBe("Dubai, AE");
    expect(describeLogin({ method: "code" })).toBe("Email code");
    expect(describeLogin({})).toBeNull();
    expect(describeLogin({ method: "nonsense" })).toBeNull();
  });
});

describe("what gets stored", () => {
  it("an IP is accepted in both families, brackets stripped", () => {
    expect(normalizeLoginIp("203.0.113.9")).toBe("203.0.113.9");
    expect(normalizeLoginIp("2001:db8::1")).toBe("2001:db8::1");
    // Some proxies bracket IPv6; the same client must not appear as two addresses.
    expect(normalizeLoginIp("[2001:db8::1]")).toBe("2001:db8::1");
  });

  it("REFUSES a zone id, which cannot be a client IP through a load balancer", () => {
    // Asserted as a decision rather than an omission: a scoped link-local address
    // cannot have reached this server from a real client, so accepting one would
    // only widen what can be written into a row the owner reads.
    expect(normalizeLoginIp("fe80::1%eth0")).toBeNull();
  });

  it("refuses anything that is not an address", () => {
    // This value is rendered back to the account owner, so a header that got
    // through with text in it must not become part of their security notice.
    expect(normalizeLoginIp("<script>alert(1)</script>")).toBeNull();
    expect(normalizeLoginIp("1.2.3.4, 5.6.7.8")).toBeNull(); // a chain, not one hop
    // HEX-LEGAL and over-length, so this exercises the LENGTH cap rather than the
    // character check — "x".repeat(65) was refused for the wrong reason, which left
    // the cap untested (found by the mutation run).
    expect(normalizeLoginIp("1".repeat(65))).toBeNull();
    expect(normalizeLoginIp("1".repeat(64))).toBe("1".repeat(64));
    expect(normalizeLoginIp(12345)).toBeNull();
    expect(normalizeLoginIp("")).toBeNull();
  });

  it("a country is exactly two letters, because the column holds two", () => {
    // A longer value would be silently truncated into a country code that means
    // somewhere else entirely.
    expect(normalizeCountry("ae")).toBe("AE");
    expect(normalizeCountry("ARE")).toBeNull();
    expect(normalizeCountry("A")).toBeNull();
    expect(normalizeCountry("A1")).toBeNull();
    expect(normalizeCountry(null)).toBeNull();
  });

  it("a city is bounded to the column and empty becomes null", () => {
    expect(normalizeCity("  Dubai  ")).toBe("Dubai");
    expect(normalizeCity("   ")).toBeNull();
    expect(normalizeCity("x".repeat(200))?.length).toBe(96);
  });
});

describe("capturing the details at sign-in", () => {
  const startSession = () => {
    const at = ROUTERS.indexOf("async function startSession(");
    return ROUTERS.slice(at, ROUTERS.indexOf("\n/**", at));
  };

  it("the IP comes from pickClientIp, which trusts the hop the PROXY appended", () => {
    // v2.98.4/F4: the leftmost X-Forwarded-For entry is client-appendable behind an
    // appending ALB, so reading it would let anybody write their own "where from".
    expect(startSession()).toMatch(/normalizeLoginIp\(pickClientIp\(/);
    expect(V2DB).toMatch(/ip: origin\?\.ip \?\? null/);
  });

  it("the geo lookup is NOT awaited, so a sign-in never waits on a third party", () => {
    // A 4s external call in front of every login would be a self-inflicted outage
    // the first time ipapi.co is slow.
    const b = startSession();
    expect(b).toMatch(/void resolveGeoForIp\(ip\)/);
    expect(b).not.toMatch(/await resolveGeoForIp/);
    // …and the row is written BEFORE the lookup starts, so the IP is never lost to
    // a failed geo call.
    expect(b.indexOf("await recordSession(")).toBeLessThan(b.indexOf("resolveGeoForIp(ip)"));
  });

  it("there is ONE geo implementation, shared with the top bar's flag chip", () => {
    // Two copies of "which country is this IP" is how the login notice and the flag
    // come to disagree about the same person — the divergence class v2.99.77 and
    // v2.99.96 were both about.
    expect(ROUTERS).toMatch(/export async function resolveGeoForIp\(/);
    expect(ROUTERS).toMatch(/geoSelf: publicProcedure\.query\(async \(\{ ctx \}\) => \{\s*return resolveGeoForIp\(pickClientIp\(ctx\.req\)\);/);
    expect((codeOnly(ROUTERS).match(/ipapi\.co/g) || []).length).toBe(1);
  });

  it("each of the three ways in records ITS OWN method", () => {
    // A session row looks identical however it was created, so this cannot be
    // inferred after the fact — `accountExisted` is the only thing distinguishing a
    // first registration from a sign-in.
    expect(ROUTERS).toMatch(/startSession\(ctx, userId, pending, accountExisted \? "code" : "register"\)/);
    expect(ROUTERS).toMatch(/startSession\(ctx, user\.id, false, "pin"\)/);
  });

  it("the PIN path still bypasses approval — the owner's own rule, unchanged", () => {
    expect(ROUTERS).toMatch(/startSession\(ctx, user\.id, false, "pin"\)/);
    // shouldRequireApproval is consulted only on the code path.
    const pinBlock = ROUTERS.slice(ROUTERS.indexOf('startSession(ctx, user.id, false, "pin")') - 900);
    expect(pinBlock.slice(0, 900)).not.toMatch(/shouldRequireApproval/);
  });

  it("the four columns are declared in the schema AND the additive boot-migrator", () => {
    for (const c of ["ip", "country", "city", "method"]) {
      expect(SCHEMA, `schema ${c}`).toMatch(new RegExp(`${c}: varchar\\("${c}"`));
      expect(V2DB, `migrator ${c}`).toMatch(
        new RegExp('table: "sessions", column: "' + c + '"')
      );
    }
  });

  it("setSessionGeo is scoped to the sid and does nothing when there is nothing to write", () => {
    // Bounded to the function: sliced to end-of-file, `revokeSession`'s identical
    // WHERE clause satisfied this while setSessionGeo scoped to the wrong column
    // (found by mutation — it would have rewritten another account's rows).
    const at = V2DB.indexOf("export async function setSessionGeo");
    const fn = V2DB.slice(at, V2DB.indexOf("\n}", at));
    expect(fn.length).toBeGreaterThan(150);
    expect(fn).toMatch(/if \(!geo\.country && !geo\.city\) return;/);
    expect(fn).toMatch(/\.where\(eq\(sessions\.sid, sid\)\)/);
    expect(fn).not.toMatch(/sessions\.userId/);
  });

  it("recordSession's new argument is OPTIONAL, so no existing caller changes behaviour", () => {
    expect(V2DB).toMatch(/origin\?: \{ ip\?: string \| null; method\?: string \| null \}/);
  });
});

describe("one projection, three surfaces", () => {
  it("the approval prompt and the device list share ONE builder", () => {
    // Three projections of the same event is how three surfaces come to describe
    // one login differently.
    expect(ROUTERS).toMatch(/function pendingSessionWire\(/);
    expect(ROUTERS).toMatch(/pending: rows\.map\(pendingSessionWire\)/);
    expect(ROUTERS).toMatch(/\.\.\.pendingSessionWire\(r\),/);
    // Two PARENTHESISED occurrences: the declaration and the spread in
    // listSessions. `rows.map(pendingSessionWire)` passes the reference, so it
    // carries no paren — counting it as one was my own arithmetic error.
    expect((ROUTERS.match(/pendingSessionWire\(/g) || []).length).toBe(2);
  });

  it("the wire carries every detail the owner listed", () => {
    const fn = ROUTERS.slice(
      ROUTERS.indexOf("export type PendingSessionWire"),
      ROUTERS.indexOf("function pendingSessionWire(")
    );
    for (const f of ["sid", "label", "createdAt", "detail", "place", "methodLabel", "ip", "country"]) {
      expect(fn, `wire field ${f}`).toMatch(new RegExp(`\\b${f}\\??:`));
    }
  });

  it("every read is scoped to ctx.user, so the IP reaches nobody else", () => {
    // The IP is included deliberately — it is the owner's OWN sign-in and the one
    // detail that survives a geo failure — which is only defensible because these
    // procedures answer nobody but the account holder.
    for (const proc of ["pendingSessions", "listSessions"]) {
      const at = ROUTERS.indexOf(`  ${proc}: publicProcedure`);
      expect(at, proc).toBeGreaterThan(0);
      // Bounded to THIS procedure. A fixed-size window spilled into the next one,
      // whose own `if (!user)` satisfied the assertion after this procedure's guard
      // had been deleted — the unbounded-slice fragility, found by mutation.
      const end = ROUTERS.indexOf("\n  }),", at);
      expect(end, proc).toBeGreaterThan(at);
      const body = ROUTERS.slice(at, end);
      expect(body, proc).toMatch(/const user = ctx\.user;/);
      expect(body, proc).toMatch(/if \(!user\)/);
      // The scoping itself: the row read is keyed on the AUTHENTICATED user, never
      // on a coalesced fallback that would answer for somebody else.
      expect(body, proc).toMatch(/ForUser\(user\.id\)/);
      expect(body, proc).not.toMatch(/user\?\.id/);
    }
  });
});

/** The pending-approval card. Bounded FORWARD from its own heading: an earlier
 *  "Approve" occurs in the mutation handler above it, so slicing to that needle
 *  collapsed the window to "" and every assertion inside passed vacuously — the
 *  unbounded-slice fragility this repo keeps re-learning. */
function pendingCard(): string {
  const at = PROFILE.indexOf("New sign-in waiting");
  const card = PROFILE.slice(at, PROFILE.indexOf("Decline", at));
  if (card.length < 200) throw new Error("pendingCard slice collapsed");
  return card;
}

describe("what the owner actually sees", () => {
  it("the approval prompt shows the device, the place, the time and the IP", () => {
    const card = pendingCard();
    expect(card).toMatch(/\{p\.label\}/);
    expect(card).toMatch(/\{p\.detail\}/);
    expect(card).toMatch(/new Date\(p\.createdAt\)\.toLocaleString\(\)/);
    expect(card).toMatch(/\{p\.ip\}/);
  });

  it("each line is WITHHELD when the server sent null, not rendered empty", () => {
    // A place we could not resolve must read as absent. Rendering an empty line
    // makes the card look broken and, worse, looks like a claim.
    const card = pendingCard();
    expect(card).toMatch(/\{p\.detail && \(/);
    expect(card).toMatch(/\{p\.ip && \(/);
  });

  it("it tells the owner what to do if it wasn't them", () => {
    expect(PROFILE).toMatch(/If this wasn't you, decline it/);
  });

  it("the IP is bidi-isolated, so an RTL locale cannot reorder it", () => {
    const card = pendingCard();
    expect(card).toMatch(/dir="ltr"/);
  });

  it("the device list carries the same one-line detail", () => {
    expect(PROFILE).toMatch(/\{s\.detail && \(/);
  });

  it("the notification centre names the sign-in when there is exactly ONE", () => {
    // With two waiting, naming the newest would describe one and imply both.
    expect(BELL).toMatch(/pendingDevices === 1 && pendingDetail \?/);
    expect(BELL).toMatch(/\{pendingDetail\.label\}/);
    expect(BELL).toMatch(/\{pendingDetail\.detail\}/);
    expect(BELL).toMatch(/new Date\(pendingDetail\.createdAt\)\.toLocaleString\(\)/);
    // …and falls back to the old count line otherwise, rather than rendering blanks.
    expect(BELL).toMatch(/Approve or decline the sign-in/);
  });

  it("the detail prop is OPTIONAL, so a caller that has not fetched it degrades", () => {
    expect(BELL).toMatch(/pendingDetail\?: \{ label: string; detail: string \| null; createdAt: number \} \| null;/);
  });

  it("AppShell derives it from the SAME query the count comes from", () => {
    // A second query would let the count and the detail disagree.
    expect(SHELL).toMatch(/const pendingList = pendingDevicesQ\.data\?\.pending \?\? \[\]/);
    expect(SHELL).toMatch(/const pendingDevices = pendingList\.length/);
    expect(SHELL).toMatch(/pendingDevices === 1 \? pendingList\[0\] : null/);
  });

  it("BOTH bell mounts get it — the count of mounts is asserted", () => {
    // The shell renders the bell twice (mobile header + desktop sidebar), and one
    // of them silently missing the detail is exactly the kind of half-shipped
    // change the v2.99.85 sender-label count caught.
    const mounts = (SHELL.match(/pendingDevices=\{pendingDevices\}/g) || []).length;
    expect(mounts).toBe(2);
    expect((SHELL.match(/pendingDetail=\{pendingDetail\}/g) || []).length).toBe(mounts);
  });

  it("no surface hand-rolls the place or the method string", () => {
    // The whole point of the shared module is that the phrasing lives in one place.
    for (const [name, src] of [
      ["Profile.tsx", PROFILE],
      ["MissedCalls.tsx", BELL],
    ] as const) {
      const code = codeOnly(src);
      expect(code, `${name} rebuilds a place string`).not.toMatch(/\$\{[^}]*city[^}]*\},\s*\$\{/);
      expect(code, `${name} hard-codes a method label`).not.toMatch(/"4-digit passcode"/);
    }
  });
});
