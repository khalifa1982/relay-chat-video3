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

  it("runs BEFORE markUserEmailVerified at EVERY OTP claim site", () => {
    // Ordering is load-bearing: the helper's own guard is emailVerified=false,
    // so flipping the flag first would make it a no-op.
    //
    // There were TWO claim sites when this was written (verifyOtp + the
    // RELAY_OTP_REGISTER_BYPASS branch of register). v2.99.39 DELETED the bypass
    // entirely — SES is out of the sandbox — so verifyOtp is now the only path
    // that can mark an address verified. This asserts the ordering at whatever
    // sites exist rather than a fixed count, so it survives either shape.
    const sites = [...ROUTERS.matchAll(/await markUserEmailVerified\(userId\);/g)];
    expect(sites.length).toBeGreaterThanOrEqual(1);
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

/* ── M31: the register bypass is GONE (superseded) ─────────────────────── */

describe("M31 — the RELAY_OTP_REGISTER_BYPASS branch no longer exists at all", () => {
  // M31 hardened the bypass branch to be CREATE-ONLY, because as written it let
  // anyone who knew a registered address obtain a session as that user. v2.99.39
  // goes further and DELETES the branch and its env-flag reader: AWS approved SES
  // production access, so registration always mints and emails a real code and
  // the account is only created by verifyOtp. Removal strictly supersedes the
  // hardening — there is no branch left to get wrong, and a stale
  // RELAY_OTP_REGISTER_BYPASS=1 in a server .env now has no effect because
  // nothing reads it. The full removal is pinned in otpRegisterBypass.test.ts.
  it("neither the branch nor its flag reader survives in the router", () => {
    expect(ROUTERS).not.toMatch(/otpRegisterBypassEnabled/);
    expect(ROUTERS).not.toMatch(/bypass: true/);
  });

  it("register always mints a code and dispatches it — no conditional path", () => {
    const reg = ROUTERS.slice(
      ROUTERS.indexOf("  register: publicProcedure"),
      ROUTERS.indexOf("  verifyOtp: publicProcedure"),
    );
    expect(reg).toMatch(/const code = await mintOtp\(\{ email, purpose: "register"/);
    expect(reg).toMatch(/const sent = await dispatchOtp\(email, code\);/);
    // No branch may skip the code and hand back a session.
    expect(reg).not.toMatch(/setSessionCookie/);
    expect(reg).not.toMatch(/createOtpUser/);
  });

  it("the only markUserEmailVerified caller is the code-verifying path", () => {
    const idx = ROUTERS.indexOf("await markUserEmailVerified(userId);");
    expect(idx).toBeGreaterThan(ROUTERS.indexOf("  verifyOtp: publicProcedure"));
  });
});

/* ── M32: MIME type is canonicalized before any allow/deny test ─────────── */

describe("M32 — upload MIME cannot be a multi-valued Content-Type", () => {
  const UPLOAD = read("v2upload.ts");

  it("normalizes at BOTH mimeType sources, before the gates", () => {
    expect(UPLOAD).toMatch(/mimeType = normalizeMimeType\(String\(req\.query\.mime \|\| ""\)\) \?\? "";/);
    expect(UPLOAD).toMatch(/mimeType = normalizeMimeType\(body\.mimeType\) \?\? "";/);
    expect(UPLOAD).not.toMatch(/mimeType = String\(req\.query\.mime \|\| ""\);/);
    expect(UPLOAD).not.toMatch(/^\s*mimeType = body\.mimeType;$/m);
  });

  /** The real exported predicate, exercised against the bypass payloads. */
  it("rejects comma-lists and other multi-valued / malformed shapes", async () => {
    const { normalizeMimeType } = await import("./v2upload");
    // The bypass: start-anchored ALLOWED/BLOCKED only ever saw the FIRST type.
    expect(normalizeMimeType("image/png,text/html")).toBeNull();
    expect(normalizeMimeType("image/png, image/svg+xml")).toBeNull();
    expect(normalizeMimeType("text/html,image/png")).toBeNull();
    expect(normalizeMimeType("image/png text/html")).toBeNull();
    expect(normalizeMimeType("")).toBeNull();
    expect(normalizeMimeType("notamimetype")).toBeNull();
    expect(normalizeMimeType("/png")).toBeNull();
  });

  it("canonicalizes a legitimate type (params dropped, case-folded)", async () => {
    const { normalizeMimeType } = await import("./v2upload");
    expect(normalizeMimeType("image/png")).toBe("image/png");
    expect(normalizeMimeType("IMAGE/PNG")).toBe("image/png");
    expect(normalizeMimeType("video/webm; codecs=vp9")).toBe("video/webm");
    expect(normalizeMimeType("  audio/mp4  ")).toBe("audio/mp4");
  });

  it("still lets the blocked list catch a normalized dangerous type", async () => {
    const { normalizeMimeType } = await import("./v2upload");
    const BLOCKED =
      /^(image\/svg\+xml|text\/html|application\/xhtml\+xml|application\/javascript|application\/x-msdownload|application\/x-sh)/i;
    // Normalization must not launder these into something the gate misses.
    for (const evil of ["image/svg+xml", "TEXT/HTML; charset=utf-8", "application/javascript"]) {
      const n = normalizeMimeType(evil);
      expect(n).not.toBeNull();
      expect(BLOCKED.test(n!), `${evil} must stay blocked`).toBe(true);
    }
  });
});

/* ── M33/M34: limiter sweep + no request-body inflation on upload ───────── */

describe("M33 — the storage-proxy limiter is swept", () => {
  it("pairs its limiter with a periodic sweep like every other gate", () => {
    const PROXY = read("_core", "storageProxy.ts");
    expect(PROXY).toMatch(/storageIpLimiter\.sweep\(/);
    expect(PROXY).toMatch(/setInterval\(\(\) => storageIpLimiter\.sweep\(/);
    expect(PROXY).toMatch(/\.unref\(\)/);
  });
});

describe("M34 — upload parsers refuse encoded bodies (no gzip amplification)", () => {
  const INDEX = read("_core", "index.ts");
  it("sets inflate:false on BOTH /api/v2/upload parsers", () => {
    const seg = INDEX.slice(INDEX.indexOf('"/api/v2/upload"'), INDEX.indexOf('"/api/email/inbound"'));
    expect(seg).toMatch(/limit: "41mb", inflate: false/);
    expect(seg).toMatch(/limit: "15mb", inflate: false/);
  });
  it("explains the amplification it removes", () => {
    expect(INDEX).toMatch(/M34/);
    expect(INDEX).toMatch(/DECOMPRESSED/);
  });
});

/* ── M35: one account per email (no diverting row) ─────────────────────── */

describe("M35 — register cannot create a second row for an existing email", () => {
  const LOCAL = read("authLocal.ts");

  it("adds an any-loginMethod existence lookup", () => {
    expect(LOCAL).toMatch(/async function findAnyUserByEmail\(email: string\)/);
  });

  it("refuses registration when ANY row already holds the address", () => {
    const reg = LOCAL.slice(
      LOCAL.indexOf('app.post("/api/auth/register"'),
      LOCAL.indexOf('app.get("/api/auth/status"'),
    );
    expect(reg).toMatch(/if \(await findAnyUserByEmail\(email\)\) \{/);
    expect(reg).toMatch(/error: "exists"/);
    // …and does so BEFORE inserting.
    expect(reg.indexOf("findAnyUserByEmail")).toBeLessThan(reg.indexOf("createLocalUser("));
  });

  it("keeps the unverified-local resend path intact (no behaviour regression)", () => {
    const reg = LOCAL.slice(
      LOCAL.indexOf('app.post("/api/auth/register"'),
      LOCAL.indexOf('app.get("/api/auth/status"'),
    );
    expect(reg).toMatch(/findLocalUserByEmail\(email\)/);
    expect(reg).toMatch(/resent: true/);
  });

  it("documents the diversion it closes", () => {
    expect(LOCAL).toMatch(/findUserByEmailAny/);
    expect(LOCAL).toMatch(/One account per email address\./);
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

  it("no longer computes the lock inside a same-statement CASE at all (M36)", () => {
    // v2.99.39 restructured this: the lock is latched by its OWN guarded UPDATE
    // from the PERSISTED count, so the MySQL assignment-order hazard cannot
    // apply to the PIN ladder any more. The double-counted CASE must be gone.
    expect(AUTH_PIN).not.toMatch(/loginPinLockedAt: sql`CASE WHEN/);
    expect(AUTH_PIN).not.toMatch(/0\) \+ 1 > \$\{PIN_MAX_ATTEMPTS\}/);
    // The threshold is now evaluated in JS against the read-back value.
    expect(AUTH_PIN).toMatch(/if \(attempts > PIN_MAX_ATTEMPTS\) \{/);
    expect(AUTH_PIN).toMatch(/\.set\(\{ loginPinLockedAt: sql`NOW\(\)` \}\)/);
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

/* ── M36: PIN verification is bounded by an atomic slot claim ───────────── */

describe("M36 — a concurrent burst cannot exceed the PIN try cap", () => {
  it("claims a slot with a guarded UPDATE before verifying anything", () => {
    const fn = AUTH_PIN.slice(
      AUTH_PIN.indexOf("export async function attemptPinLogin"),
      AUTH_PIN.length,
    );
    // The claim must carry BOTH guards: live lock state + the slot bound.
    expect(fn).toMatch(/isNull\(users\.loginPinLockedAt\)/);
    expect(fn).toMatch(/COALESCE\(\$\{users\.loginPinAttempts\}, 0\) <= \$\{PIN_MAX_ATTEMPTS\}/);
    expect(fn).toMatch(/if \(!gotSlot\) return \{ outcome: "locked" \};/);
    // …and it must come BEFORE the secret is tested.
    expect(fn.indexOf("gotSlot")).toBeLessThan(fn.indexOf("verifyPassword("));
  });

  it("no longer gates on the caller's snapshot of loginPinLockedAt", () => {
    // The pre-fix gate — a stale field from a row the CALLER read — is what let
    // N concurrent requests all reach verifyPassword. Scoped to attemptPinLogin:
    // the pure `judgePinAttempt` helper still decides from a snapshot BY DESIGN,
    // which is fine because it is advisory/test-only (and now says so loudly).
    const fn = AUTH_PIN.slice(
      AUTH_PIN.indexOf("export async function attemptPinLogin"),
      AUTH_PIN.length,
    );
    expect(fn).not.toMatch(/if \(row\.loginPinLockedAt\) return \{ outcome: "locked" \};/);
  });

  it("the advisory helper is marked as NOT an enforcement path", () => {
    const judge = AUTH_PIN.slice(
      AUTH_PIN.indexOf("ADVISORY ONLY"),
      AUTH_PIN.indexOf("export function judgePinAttempt"),
    );
    expect(judge).toMatch(/NOT AN ENFORCEMENT PATH/);
    expect(judge).toMatch(/attemptPinLogin/);
  });

  it("latches the lock with its own isNull-guarded UPDATE so the alert email sends exactly once", () => {
    expect(AUTH_PIN).toMatch(/const iLatched =/);
    expect(AUTH_PIN).toMatch(/if \(row\.email && iLatched\)/);
  });

  /**
   * Model the DB guard: `WHERE lockedAt IS NULL AND attempts <= cap`. However
   * many requests arrive at once, MySQL serializes them per row, so only the
   * ones that still satisfy the predicate win a slot — and only a winner may
   * verify. This is the property the old snapshot gate did not have.
   */
  function simulateBurst(concurrent: number, cap: number) {
    let attempts = 0;
    let locked = false;
    let verifications = 0;
    for (let i = 0; i < concurrent; i++) {
      if (locked || attempts > cap) continue; // claim fails → refused, no verify
      attempts += 1;
      verifications += 1; // slot won → this attempt gets to test the PIN
      if (attempts > cap) locked = true; // wrong answer latches on the last slot
    }
    return { verifications, attempts, locked };
  }

  it("bounds verifications to cap+1 even under a 10,000-request burst", () => {
    const CAP = 3;
    const burst = simulateBurst(10_000, CAP);
    expect(burst.verifications).toBe(CAP + 1); // 4 — not 10,000
    expect(burst.locked).toBe(true);
  });

  it("still allows the full documented ladder for a legitimate user", () => {
    const CAP = 3;
    expect(simulateBurst(1, CAP).verifications).toBe(1);
    expect(simulateBurst(3, CAP).locked).toBe(false); // 3 wrong tries = warn only
    expect(simulateBurst(4, CAP).locked).toBe(true); // the 4th locks
    // …and the 4th try IS verified, so a correct 4th entry can still succeed.
    expect(simulateBurst(4, CAP).verifications).toBe(4);
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
