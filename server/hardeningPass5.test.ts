/* ============================================================
   v2.99.37 — HARDENING PASS 5 (class-based security sweep).

   Prior passes audited SURFACE BY SURFACE (routers, then auth, then
   storage…). This pass audited by VULNERABILITY CLASS instead, which is
   what surfaced these six: a resource-exhaustion class (the unthrottled
   identity minter), an unbounded-buffering class (the reveal inliner), a
   TOCTOU class (the view-once burn), a fail-open error-handling class (the
   reservation ledger), and an SQL-semantics class (MySQL's left-to-right
   UPDATE assignment breaking BOTH attempt ladders).

   The DB-touching logic can't be exercised without a live MySQL, so those
   are pinned against source the same way this repo already pins
   securityAudit / securitySweep / enumBlockHardening. The two attempt
   ladders additionally get a real arithmetic simulation of MySQL's
   documented assignment semantics, so the off-by-one can't silently return.
   ============================================================ */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const read = (...p: string[]) => fs.readFileSync(path.resolve(__dirname, ...p), "utf8");
const ROUTERS = read("v2routers.ts");
const V2DB = read("v2db.ts");
const AUTH_PIN = read("authPin.ts");
const AUTH_OTP = read("authOtp.ts");

/* ── M21: the unauthenticated identity minter is throttled ──────────────── */

describe("M21 — startGuest is rate limited (number-space exhaustion)", () => {
  it("defines a dedicated guest-mint limiter that honors the global kill switch", () => {
    expect(ROUTERS).toMatch(/const guestMintIpLimiter = createRateLimiter\(/);
    const gate = ROUTERS.slice(
      ROUTERS.indexOf("function guestMintGate"),
      ROUTERS.indexOf("export const v2AuthRouter"),
    );
    expect(gate).toMatch(/RELAY_RATELIMIT_OFF/);
    expect(gate).toMatch(/TOO_MANY_REQUESTS/);
    expect(gate).toMatch(/clientIpOf/);
  });

  it("calls the gate INSIDE startGuest's resolver, before any identity work", () => {
    const start = ROUTERS.indexOf("startGuest: publicProcedure");
    expect(start).toBeGreaterThan(-1);
    const body = ROUTERS.slice(start, start + 900);
    expect(body).toMatch(/guestMintGate\(ctx\)/);
    // The gate must precede the deviceId resolution / identity reuse branches.
    expect(body.indexOf("guestMintGate(ctx)")).toBeLessThan(body.indexOf("ctx.identity"));
  });

  it("sweeps the limiter map so it can't grow without bound itself", () => {
    expect(ROUTERS).toMatch(/guestMintIpLimiter\.sweep\(/);
  });
});

/* ── M22: the view-once burn is atomic ─────────────────────────────────── */

describe("M22 — view-once burn is atomic (TOCTOU)", () => {
  it("burnExpiringMessage guards on consumedAt still being NULL, in SQL", () => {
    const fn = V2DB.slice(
      V2DB.indexOf("async function burnExpiringMessage"),
      V2DB.indexOf("export async function consumeExpiringMessage"),
    );
    expect(fn).toMatch(/JSON_EXTRACT\(\$\{messages\.meta\}, '\$\.consumedAt'\) IS NULL/);
    // Verdict must come from whether THIS statement won, not from a prior read.
    expect(fn).toMatch(/affectedRows/);
  });

  it("BOTH burn paths bail out when they lose the race", () => {
    for (const name of ["consumeExpiringMessage", "revealExpiringMessage"]) {
      const start = V2DB.indexOf(`export async function ${name}`);
      expect(start, `${name} exists`).toBeGreaterThan(-1);
      const body = V2DB.slice(start, start + 2600);
      expect(body, `${name} calls the atomic burn`).toMatch(/await burnExpiringMessage\(/);
      expect(body, `${name} returns null on a lost race`).toMatch(
        /if \(!\(await burnExpiringMessage\([^)]*\)\)\) \{\s*\n\s*return null;/,
      );
    }
  });

  it("neither path does a bare unconditional content-nulling UPDATE any more", () => {
    // The pre-fix shape: .set({ body: null, attachmentId: null, ... }) followed
    // by a .where keyed ONLY on the message id.
    const reveal = V2DB.slice(
      V2DB.indexOf("export async function revealExpiringMessage"),
      V2DB.indexOf("export async function markThreadRead"),
    );
    expect(reveal).not.toMatch(/\.where\(eq\(messages\.id, input\.messageId\)\);/);
  });
});

/* ── M23: reveal media inlining is bounded ─────────────────────────────── */

describe("M23 — revealExpiring cannot buffer an unbounded body", () => {
  const reveal = ROUTERS.slice(
    ROUTERS.indexOf("revealExpiring: publicProcedure"),
    ROUTERS.indexOf("/* ── attachments router"),
  );

  it("declares an explicit byte ceiling", () => {
    expect(ROUTERS).toMatch(/const REVEAL_MAX_INLINE_BYTES = 30 \* 1024 \* 1024;/);
  });

  it("no longer treats a MISSING content-length as size zero", () => {
    // The bug: Number(header ?? 0) === 0 passed a `<= CAP` check, then went
    // straight into an unbounded arrayBuffer().
    expect(reveal).not.toMatch(/content-length["']\s*\)\s*\?\?\s*0/);
    expect(reveal).not.toMatch(/await resp\.arrayBuffer\(\)/);
  });

  it("reads the stream with a hard ceiling and cancels when exceeded", () => {
    expect(reveal).toMatch(/resp\.body\.getReader\(\)/);
    expect(reveal).toMatch(/total > REVEAL_MAX_INLINE_BYTES/);
    expect(reveal).toMatch(/reader\.cancel\(\)/);
  });

  it("still rejects an over-cap DECLARED size cheaply, before reading", () => {
    expect(reveal).toMatch(/declared > REVEAL_MAX_INLINE_BYTES/);
    expect(reveal.indexOf("declared > REVEAL_MAX_INLINE_BYTES")).toBeLessThan(
      reveal.indexOf("getReader()"),
    );
  });
});

/* ── M24: the reservation ledger fails closed on a duplicate ───────────── */

describe("M24 — tryReserveNumber detects a duplicate by error CODE", () => {
  const fn = V2DB.slice(
    V2DB.indexOf("async function tryReserveNumber"),
    V2DB.indexOf("async function allocateSharedNumber"),
  );

  it("checks mysql's stable machine-readable duplicate markers", () => {
    expect(fn).toMatch(/errno === 1062/);
    expect(fn).toMatch(/ER_DUP_ENTRY/);
  });

  it("keeps the message sniff only as a FALLBACK, after the code checks", () => {
    expect(fn).toMatch(/duplicate/i);
    expect(fn.indexOf("errno === 1062")).toBeLessThan(fn.search(/\/duplicate\/i/));
  });
});

/* ── M28: a locked view-once message can't authorize attachment access ──── */

describe("M28 — locked expiring media isn't readable via the attachment gate", () => {
  const fn = V2DB.slice(
    V2DB.indexOf("export async function getAttachmentForIdentity"),
    V2DB.indexOf("/* ── batch lookups"),
  );

  it("excludes an un-consumed expiring message as an authorization basis", () => {
    expect(fn).toMatch(
      /JSON_EXTRACT\(\$\{messages\.meta\}, '\$\.expire'\) IS NULL OR JSON_EXTRACT\(\$\{messages\.meta\}, '\$\.consumedAt'\) IS NOT NULL/,
    );
  });

  it("keeps the uploader's own early return ABOVE the restriction (senders unaffected)", () => {
    expect(fn).toMatch(/if \(att\.uploadedByIdentityId === identityId\) return att;/);
    expect(fn.indexOf("uploadedByIdentityId === identityId")).toBeLessThan(
      fn.indexOf("JSON_EXTRACT"),
    );
  });

  it("still requires conversation participation (the original IDOR gate is intact)", () => {
    expect(fn).toMatch(/eq\(conversationParticipants\.identityId, identityId\)/);
    expect(fn).toMatch(/eq\(messages\.attachmentId, attachmentId\)/);
  });

  it("documents that this gate also backs attachments.get, the storage proxy, and messages.send", () => {
    expect(fn).toMatch(/attachments\.get/);
    expect(fn).toMatch(/authorizeStorageKey/);
    expect(fn).toMatch(/messages\.send/);
  });

  it("the two consumers of this gate still route through it (no direct unscoped fetch)", () => {
    // attachments.get must not bypass to an unscoped lookup.
    const get = ROUTERS.slice(ROUTERS.indexOf("  get: publicProcedure"), ROUTERS.indexOf("  get: publicProcedure") + 500);
    expect(get).toMatch(/getAttachmentForIdentity\(input\.id, me\.id\)/);
    // authorizeStorageKey's attachment branch likewise.
    expect(V2DB).toMatch(/const authed = await getAttachmentForIdentity\(att\.id, identityId\);/);
  });
});

/* ── M29: account pre-hijacking via a pre-planted password ─────────────── */

describe("M29 — an unverified pre-planted credential is destroyed on OTP claim", () => {
  // Slice from the doc block (the rationale pins below read from it) through the
  // end of the function body.
  const start = AUTH_OTP.indexOf("SECURITY (M29");
  const fn = AUTH_OTP.slice(
    start,
    AUTH_OTP.indexOf("\n}\n", AUTH_OTP.indexOf("export async function clearUnverifiedCredentials")),
  );

  it("clears passwordHash AND the PIN fields", () => {
    expect(fn).toMatch(/passwordHash: null/);
    expect(fn).toMatch(/loginPinHash: null/);
    expect(fn).toMatch(/loginPinAttempts: 0/);
    expect(fn).toMatch(/loginPinLockedAt: null/);
  });

  it("is SCOPED to still-unverified rows, so a real local user keeps their password", () => {
    expect(fn).toMatch(/eq\(users\.emailVerified, false\)/);
  });

  it("runs BEFORE markUserEmailVerified at BOTH OTP claim sites", () => {
    // Ordering is load-bearing: the helper's own guard is emailVerified=false,
    // so flipping the flag first would make it a no-op.
    const sites = [...ROUTERS.matchAll(/await markUserEmailVerified\(userId\);/g)];
    expect(sites.length).toBeGreaterThanOrEqual(2);
    for (const m of sites) {
      const before = ROUTERS.slice(Math.max(0, m.index! - 700), m.index!);
      expect(before, "clearUnverifiedCredentials precedes this markUserEmailVerified").toMatch(
        /await clearUnverifiedCredentials\(userId\);/,
      );
    }
  });

  it("documents the pre-hijacking chain it closes", () => {
    expect(fn).toMatch(/PRE-HIJACK/i);
    expect(fn).toMatch(/api\/auth\/register/);
    expect(fn).toMatch(/findUserByEmailAny/);
  });
});

/* ── M30: status media key can't be laundered via a text status ─────────── */

describe("M30 — status.post gates a supplied mediaKey for EVERY kind", () => {
  const post = ROUTERS.slice(
    ROUTERS.indexOf("export const v2StatusRouter"),
    ROUTERS.indexOf("/** The story feed"),
  );

  it("checks keyInOwnerNamespace whenever a mediaKey is present", () => {
    expect(post).toMatch(
      /if \(input\.mediaKey && !keyInOwnerNamespace\(input\.mediaKey, me\.id, s3Config\(\)\?\.prefix \?\? ""\)\)/,
    );
  });

  it("runs the ownership gate OUTSIDE the media-kind branch", () => {
    // Pre-fix the gate lived inside `else { … }`, so kind:"text" skipped it.
    expect(post.indexOf("keyInOwnerNamespace")).toBeLessThan(
      post.indexOf('if (input.kind === "text")'),
    );
  });

  it("never persists a media key for a text status", () => {
    expect(post).toMatch(/const mediaKey = input\.kind === "text" \? null : \(input\.mediaKey \?\? null\);/);
    expect(post).toMatch(/const mediaUrl = mediaKey \? `\/manus-storage\/\$\{mediaKey\}` : null;/);
    expect(post).toMatch(/^\s*mediaKey,$/m);
    // The raw input must no longer reach the row.
    expect(post).not.toMatch(/mediaKey: input\.mediaKey \?\? null/);
    expect(post).not.toMatch(/input\.mediaKey \? `\/manus-storage\//);
  });

  it("documents why (authorizeStorageKey resolves a /status_ key by active row)", () => {
    expect(post).toMatch(/authorizeStorageKey/);
    expect(post).toMatch(/EXPIRED or DELETED/);
  });
});

/* ── M25: both attempt ladders match MySQL's assignment semantics ───────── */

/**
 * Simulate MySQL's DOCUMENTED single-table UPDATE behaviour: assignments are
 * evaluated left to right, and a later assignment reads the value an earlier
 * assignment just wrote. `lockExpr` therefore receives the ALREADY-INCREMENTED
 * count — which is exactly the subtlety both ladders got wrong.
 */
function runLadder(
  priorAttempts: number,
  cap: number,
  lockExpr: (postIncrementAttempts: number, cap: number) => boolean,
): { persisted: number; latched: boolean } {
  const persisted = (priorAttempts ?? 0) + 1; // assignment #1
  const latched = lockExpr(persisted, cap); // assignment #2, sees the new value
  return { persisted, latched };
}

describe("M25 — PIN lockout ladder (MySQL left-to-right UPDATE assignment)", () => {
  const CAP = 3; // PIN_MAX_ATTEMPTS
  // The CURRENT (fixed) expression: compare the post-increment value directly.
  const fixed = (post: number, cap: number) => post > cap;
  // The PRE-FIX expression, which added a second +1 on top of the increment.
  const buggy = (post: number, cap: number) => post + 1 > cap;

  it("PIN_MAX_ATTEMPTS is still 3 (the ladder below assumes it)", () => {
    expect(AUTH_PIN).toMatch(/export const PIN_MAX_ATTEMPTS = 3;/);
  });

  it("locks on the FOURTH wrong entry, not the third", () => {
    expect(runLadder(0, CAP, fixed).latched).toBe(false); // 1st wrong
    expect(runLadder(1, CAP, fixed).latched).toBe(false); // 2nd
    expect(runLadder(2, CAP, fixed).latched).toBe(false); // 3rd — warn only
    expect(runLadder(3, CAP, fixed).latched).toBe(true); // 4th — lock
  });

  it("the locking statement persists exactly PIN_MAX_ATTEMPTS + 1, so the alert email is REACHABLE", () => {
    const lock = runLadder(3, CAP, fixed);
    expect(lock.latched).toBe(true);
    // attemptPinLogin gates the lock email on `attempts === PIN_MAX_ATTEMPTS + 1`.
    expect(lock.persisted).toBe(CAP + 1);
  });

  it("the pre-fix expression locked a try early AND made the alert email unreachable", () => {
    // Regression witness: it latched on the 3rd...
    expect(runLadder(2, CAP, buggy).latched).toBe(true);
    // ...persisting only 3, which never equals the email's required cap + 1 (4).
    expect(runLadder(2, CAP, buggy).persisted).not.toBe(CAP + 1);
  });

  it("the source no longer double-counts the increment", () => {
    const stmt = AUTH_PIN.slice(AUTH_PIN.indexOf("loginPinLockedAt: sql`CASE WHEN"));
    expect(stmt.slice(0, 200)).toMatch(
      /COALESCE\(\$\{users\.loginPinAttempts\}, 0\) > \$\{PIN_MAX_ATTEMPTS\}/,
    );
    expect(stmt.slice(0, 200)).not.toMatch(/0\) \+ 1 > \$\{PIN_MAX_ATTEMPTS\}/);
  });

  it("documents WHY the +1 is absent, so it isn't 'fixed' back", () => {
    expect(AUTH_PIN).toMatch(/LEFT TO RIGHT/);
  });
});

/* ── M26: peer-supplied chat pin can't reach innerHTML ─────────────────── */

describe("M26 — in-call chat pin is validated before it reaches innerHTML", () => {
  const ENGINE = read("..", "client", "src", "lib", "relayClient.ts");
  const addChat = ENGINE.slice(
    ENGINE.indexOf("function addChatMsg("),
    ENGINE.indexOf("function addSysMsg("),
  );

  it("derives idPin through a strict 6-digit check, not straight from the frame", () => {
    expect(addChat).toMatch(/const idPinRaw = mine \? \(me\.pin \|\| undefined\) : pin;/);
    expect(addChat).toMatch(/const idPin = idPinRaw && \/\^\\d\{6\}\$\/\.test\(idPinRaw\) \? idPinRaw : undefined;/);
  });

  it("no longer assigns the raw parameter directly to idPin", () => {
    expect(addChat).not.toMatch(/const idPin = mine \? \(me\.pin \|\| undefined\) : pin;/);
  });

  it("escapes the initials in the identity chip", () => {
    expect(addChat).toMatch(/escapeHtml\(initials\(who\)\)/);
    expect(addChat).not.toMatch(/">" \+ initials\(who\) \+ "</);
  });

  /**
   * The guard's whole job is to reject anything that could break out of the
   * `data-pin="…"` attribute or survive `fmtPin` unchanged. Exercise the real
   * predicate against the payloads that made this exploitable.
   */
  const pinGuard = (p: string | undefined) => (p && /^\d{6}$/.test(p) ? p : undefined);

  it("rejects the attribute-breakout payloads a hostile peer would send", () => {
    for (const evil of [
      'x"><img src=x onerror=alert(document.domain)>',
      '123456" onmouseover="alert(1)',
      '" autofocus onfocus=alert(1) x="',
      "123456<script>alert(1)</script>",
      "12345",       // too short
      "1234567",     // too long
      "12 34 56",    // fmtPin's own output shape is NOT a valid pin
      "abcdef",
      "",
    ]) {
      expect(pinGuard(evil), `must reject ${JSON.stringify(evil)}`).toBeUndefined();
    }
  });

  it("still accepts a real 6-digit pin, so the chip is unchanged for honest peers", () => {
    expect(pinGuard("235680")).toBe("235680");
    expect(pinGuard("911801")).toBe("911801");
  });

  it("a value surviving the guard can contain nothing HTML-significant", () => {
    const ok = pinGuard("235680")!;
    expect(ok).not.toMatch(/[&<>"']/);
  });
});

/* ── M27: avatar URL can't be an external tracking beacon ──────────────── */

describe("M27 — avatarUrl rejects arbitrary external URLs", () => {
  // Include the preceding doc block — the rationale pin below reads from it.
  const schema = ROUTERS.slice(
    ROUTERS.indexOf("SECURITY (M27"),
    ROUTERS.indexOf("const GUEST_DAYS_MS"),
  );

  it("no longer allows an arbitrary http(s) URL", () => {
    expect(schema).not.toMatch(/\^https\?:\\\/\\\//);
    expect(schema).not.toMatch(/https\?:\/\//);
  });

  it("still allows our own storage path and inline data images", () => {
    expect(schema).toMatch(/startsWith\("\/manus-storage\/"\)/);
    expect(schema).toMatch(/startsWith\("data:image\/"\)/);
  });

  it("documents the ring-card deanonymization rationale", () => {
    expect(schema).toMatch(/RING CARD/);
  });

  /** The real predicate, exercised against beacon URLs. */
  const allowed = (v: string) => v.startsWith("/manus-storage/") || v.startsWith("data:image/");

  it("rejects remote-fetch beacons while accepting legitimate values", () => {
    expect(allowed("http://attacker.example/beacon.png")).toBe(false);
    expect(allowed("https://attacker.example/x.gif?u=victim")).toBe(false);
    expect(allowed("//attacker.example/x.png")).toBe(false);
    expect(allowed("/manus-storage/relay-chat/7/avatar_ab12.jpg")).toBe(true);
    expect(allowed("data:image/png;base64,iVBORw0KGgo=")).toBe(true);
  });
});

describe("M25 — OTP burn ladder (same assignment semantics)", () => {
  const CAP = 5; // OTP_MAX_ATTEMPTS
  const fixed = (post: number, cap: number) => post >= cap;
  const buggy = (post: number, cap: number) => post + 1 >= cap;

  it("OTP_MAX_ATTEMPTS is still 5", () => {
    expect(AUTH_OTP).toMatch(/export const OTP_MAX_ATTEMPTS = 5;/);
  });

  it("burns the code on the FIFTH wrong guess, not the fourth", () => {
    expect(runLadder(3, CAP, fixed).latched).toBe(false); // 4th wrong
    expect(runLadder(4, CAP, fixed).latched).toBe(true); // 5th — burn
    // The pre-fix expression burned one guess early.
    expect(runLadder(3, CAP, buggy).latched).toBe(true);
  });

  it("the source no longer double-counts the increment", () => {
    const stmt = AUTH_OTP.slice(AUTH_OTP.indexOf("consumedAt: sql`CASE WHEN"));
    expect(stmt.slice(0, 220)).toMatch(
      /COALESCE\(\$\{emailOtps\.attempts\}, 0\) >= \$\{OTP_MAX_ATTEMPTS\}/,
    );
    expect(stmt.slice(0, 220)).not.toMatch(/0\) \+ 1 >= \$\{OTP_MAX_ATTEMPTS\}/);
  });
});
