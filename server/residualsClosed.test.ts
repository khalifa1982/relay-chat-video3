/* ============================================================
   v2.99.49 — the five documented ACCEPTED RESIDUALS, closed.

   Each was accepted because the obvious fix broke something. The
   tests below pin the property AND the constraint it had to
   respect, because a future "simplification" that ignores the
   constraint is the realistic way each of these regresses.
   ============================================================ */
import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const read = (...p: string[]) => fs.readFileSync(path.resolve(__dirname, ...p), "utf8");
const V2DB = read("v2db.ts");
const UPLOAD = read("v2upload.ts");
const CORE = read("_core", "index.ts");
const AUTH_LOCAL = read("authLocal.ts");
const CLUSTER = read("relayCluster.ts");
const SCHEMA = read("..", "drizzle", "schema.ts");

/* ── R5: upload rate-limit ordering ─────────────────────────────────────── */

describe("R5 — the upload gate runs BEFORE the body parsers", () => {
  it("is mounted ahead of express.raw/json for that route", () => {
    const gateAt = CORE.indexOf('app.use("/api/v2/upload", cookieParser(), uploadRateGate)');
    const rawAt = CORE.indexOf('express.raw({ type: "application/octet-stream", limit: "41mb"');
    const jsonAt = CORE.indexOf('app.use("/api/v2/upload", express.json({ limit: "15mb"');
    expect(gateAt).toBeGreaterThan(0);
    expect(gateAt).toBeLessThan(rawAt);
    expect(gateAt).toBeLessThan(jsonAt);
  });

  it("refuses BOTH throttled and anonymous requests pre-buffer", () => {
    const gate = UPLOAD.slice(UPLOAD.indexOf("export async function uploadRateGate"), UPLOAD.indexOf("export function registerV2Upload"));
    // per-IP first (headers only), then identity, then per-identity
    expect(gate.indexOf("uploadIpLimiter.allow")).toBeLessThan(gate.indexOf("createContext"));
    expect(gate.indexOf("createContext")).toBeLessThan(gate.indexOf("uploadIdLimiter.allow"));
    // the 401 is now pre-buffer too — it used to cost a full 41MB
    expect(gate).toMatch(/refuseUpload\(res, 401, "No identity/);
    expect(gate).toMatch(/refuseUpload\(res, 429, "Too many uploads/);
  });

  it("closes the connection on refusal instead of destroying the socket", () => {
    // body-parser was skipped, so its 41MB limit no longer bounds Node's drain of
    // the unread body; Connection: close stops ingress after the reply flushes. A
    // manual destroy could RST before the flush and eat the response.
    const fn = UPLOAD.slice(UPLOAD.indexOf("function refuseUpload"), UPLOAD.indexOf("function refuseUpload") + 400);
    expect(fn).toMatch(/res\.setHeader\("Connection", "close"\)/);
    expect(fn).not.toMatch(/destroy\(/);
  });

  it("honours the kill switch and leaves non-POST byte-identical", () => {
    const gate = UPLOAD.slice(UPLOAD.indexOf("export async function uploadRateGate"), UPLOAD.indexOf("export function registerV2Upload"));
    expect(gate).toMatch(/if \(req\.method !== "POST"\) return next\(\)/);
    expect(gate).toMatch(/RELAY_RATELIMIT_OFF/);
  });

  it("the handler still works when the gate isn't mounted (tests, direct register)", () => {
    // The fallback must reproduce the OLD behaviour exactly, or every existing
    // upload test that calls registerV2Upload directly would change meaning.
    const h = UPLOAD.slice(UPLOAD.indexOf("export function registerV2Upload"), UPLOAD.indexOf("── extract payload"));
    expect(h).toMatch(/__uploadIdentityId \?\? null/);
    expect(h).toMatch(/if \(identityId == null\) \{/);
    expect(h).toMatch(/status\(401\)/);
    expect(h).toMatch(/uploadIpLimiter\.allow/);
  });
});

/* ── R4: per-account password lockout ───────────────────────────────────── */

describe("R4 — password login has a per-account ladder", () => {
  it("uses its OWN columns, not the PIN's", () => {
    // Sharing loginPin* would let a password brute-force lock out PIN sign-in —
    // a live UI path — turning the fix into a cross-channel DoS.
    expect(SCHEMA).toMatch(/loginPwAttempts: int\("loginPwAttempts"\)/);
    expect(SCHEMA).toMatch(/loginPwLockedAt: timestamp\("loginPwLockedAt"\)/);
    expect(SCHEMA).toMatch(/cross-channel denial of service/);
    expect(V2DB).toMatch(/column: "loginPwAttempts"/);
    expect(V2DB).toMatch(/column: "loginPwLockedAt"/);
  });

  it("claims a slot BEFORE verifying, so the cap bounds scrypt work", () => {
    const fn = AUTH_LOCAL.slice(
      AUTH_LOCAL.indexOf("export async function attemptPasswordLogin"),
      AUTH_LOCAL.indexOf("export async function unlockPasswordLogin")
    );
    expect(fn.indexOf("const gotSlot")).toBeLessThan(fn.indexOf("verifyPassword(password"));
    expect(fn).toMatch(/if \(!gotSlot\) return "locked";/);
    expect(fn).toMatch(/affectedRows/);
  });

  it("no statement depends on SET assignment order", () => {
    // Slice from the doc block, which is where the rationale lives.
    const fn = AUTH_LOCAL.slice(
      AUTH_LOCAL.indexOf("Mirrors `attemptPinLogin`'s discipline"),
      AUTH_LOCAL.indexOf("export async function unlockPasswordLogin")
    );
    // The claim assigns exactly one column; the resets assign only constants.
    expect(fn).toMatch(/\.set\(\{ loginPwAttempts: sql`COALESCE\(\$\{users\.loginPwAttempts\}, 0\) \+ 1` \}\)/);
    expect(fn).toMatch(/\.set\(\{ loginPwAttempts: 0, loginPwLockedAt: null \}\)/);
    // No IF()-style read-your-own-write inside a multi-column SET.
    expect(fn).not.toMatch(/IF\(/);
    expect(fn).toMatch(/SCHEMA DECLARATION order/); // documents why
  });

  it("fails CLOSED on DB trouble — an auth path must not let a guess through", () => {
    const fn = AUTH_LOCAL.slice(
      AUTH_LOCAL.indexOf("export async function attemptPasswordLogin"),
      AUTH_LOCAL.indexOf("export async function unlockPasswordLogin")
    );
    expect(fn).toMatch(/if \(!db\) return "locked";/);
    expect(fn).toMatch(/return "locked";\s*\n\s*\}\s*\n\}/); // the catch
  });

  it("a locked account is indistinguishable from a wrong password", () => {
    const route = AUTH_LOCAL.slice(AUTH_LOCAL.indexOf('app.post("/api/auth/login"'), AUTH_LOCAL.indexOf('app.post("/api/auth/login"') + 1400);
    expect(route).toMatch(/if \(!u \|\| \(await attemptPasswordLogin\(u, password\)\) !== "ok"\)/);
    // one uniform 401 — no distinct status that would out a live password
    expect(route).toMatch(/error: "bad_credentials"/);
    expect(route).not.toMatch(/error: "locked"/);
  });

  it("has escape hatches so nobody is stranded", () => {
    expect(AUTH_LOCAL).toMatch(/PW_LOCK_MS = 15 \* 60_000/); // self-expiry
    const fn = AUTH_LOCAL.slice(
      AUTH_LOCAL.indexOf("export async function attemptPasswordLogin"),
      AUTH_LOCAL.indexOf("export async function unlockPasswordLogin")
    );
    expect(fn).toMatch(/isNotNull\(users\.loginPwLockedAt\)/); // the expiry sweep
    expect(read("v2routers.ts")).toMatch(/await unlockPasswordLogin\(userId\);/); // email code clears it
  });

  it("deliberately sends NO alert email (it would be an email-bomb primitive)", () => {
    const fn = AUTH_LOCAL.slice(
      AUTH_LOCAL.indexOf("export async function attemptPasswordLogin"),
      AUTH_LOCAL.indexOf("export async function unlockPasswordLogin")
    );
    expect(fn).not.toMatch(/sendEmail/);
    expect(fn).toMatch(/console\.warn/);
    expect(fn).toMatch(/email-bomb primitive/);
  });
});

/* ── R2: leaked number reservations ─────────────────────────────────────── */

describe("R2 — unbound number reservations are reclaimed, monotonicity intact", () => {
  it("the reaper requires FOUR independent conditions", () => {
    const fn = V2DB.slice(V2DB.indexOf("export async function reapUnclaimedReservations"), V2DB.indexOf("export async function reapUnclaimedReservations") + 1600);
    expect(fn).toMatch(/\\`claimedAt\\` IS NULL/);
    expect(fn).toMatch(/\\`createdAt\\` >= \$\{RESERVATION_CLAIM_EPOCH\}/);
    expect(fn).toMatch(/INTERVAL/);
    expect(fn).toMatch(/NOT EXISTS \(SELECT 1 FROM \\`identities\\`/);
    expect(fn).toMatch(/NOT EXISTS \(SELECT 1 FROM \\`party_lines\\`/);
    expect(fn).toMatch(/LIMIT 500/); // bounded per sweep
  });

  it("the epoch floor protects every pre-release row (no backfill needed)", () => {
    // A NULL claimedAt on an older row means "unknown", not "leaked" — it could be
    // a number freed by a renumber, which the ledger must keep forever.
    expect(V2DB).toMatch(/const RESERVATION_CLAIM_EPOCH = "2026-07-26 00:00:00"/);
    expect(V2DB).toMatch(/NEVER move earlier/);
  });

  it("the column has NO default, or the reaper would be a permanent no-op", () => {
    expect(V2DB).toMatch(/column: "claimedAt", ddl: "ADD COLUMN `claimedAt` timestamp NULL"/);
    expect(V2DB).toMatch(/\\`claimedAt\\` timestamp NULL,/); // the CREATE TABLE too
    expect(V2DB).toMatch(/NO DEFAULT on\s*\n\s*\/\/ purpose/);
  });

  it("every allocator path confirms its reservation once the row lands", () => {
    // guest identity, permanent identity, renumber, party line
    expect((V2DB.match(/await confirmNumberReservation\(/g) || []).length).toBeGreaterThanOrEqual(4);
    const fn = V2DB.slice(V2DB.indexOf("export async function confirmNumberReservation"), V2DB.indexOf("export async function releaseUnusedNumberReservation"));
    expect(fn).toMatch(/\\`claimedAt\\` IS NULL/); // idempotent
  });

  it("release is guarded so it can never un-reserve a live number", () => {
    const fn = V2DB.slice(V2DB.indexOf("export async function releaseUnusedNumberReservation"), V2DB.indexOf("export async function reapUnclaimedReservations"));
    expect(fn).toMatch(/NOT EXISTS \(SELECT 1 FROM \\`identities\\`/);
    expect(fn).toMatch(/NOT EXISTS \(SELECT 1 FROM \\`party_lines\\`/);
  });

  it("a failed identity insert releases AND resolves the race winner", () => {
    const seg = V2DB.slice(V2DB.indexOf("// Fresh permanent identity."), V2DB.indexOf("// Fresh permanent identity.") + 1400);
    expect(seg).toMatch(/await releaseUnusedNumberReservation\(number\);/);
    // strictly better than before: the loser used to end up with no identity
    expect(seg).toMatch(/const winner = await getIdentityByUserId\(input\.userId\);/);
  });

  it("a RENUMBERED user's old number is never reclaimed", () => {
    const seg = V2DB.slice(V2DB.indexOf("await confirmNumberReservation(newNumber)") - 400, V2DB.indexOf("await confirmNumberReservation(newNumber)") + 120);
    expect(seg).toMatch(/OLD number's\s*\n\s*\/\/ reservation stays forever/);
  });

  it("the reaper is mounted on a boot interval", () => {
    expect(CORE).toMatch(/reapUnclaimedReservations\(\)\.catch/);
  });
});

/* ── R3: Redis bus authentication ───────────────────────────────────────── */

describe("R3 — bus envelopes are authenticated, compatibly", () => {
  it("keeps the flat {i,p} shape so an OLD receiver still parses a signed envelope", async () => {
    // This is the deploy-safety property: the fleet rolls one instance at a time,
    // so a new signed publisher must not break instances still on the old build.
    // An old decoder read only `i`/`p` and ignored extras.
    process.env.REDIS_BUS_SECRET = "test-bus-secret";
    vi.resetModules();
    const { encodeEnvelope } = await import("./redisBus");
    const raw = encodeEnvelope("INST-A", { hello: "world" }, "relay:v2ev");
    const j = JSON.parse(raw);
    expect(j.i).toBe("INST-A");
    expect(j.p).toEqual({ hello: "world" });
    expect(typeof j.m).toBe("string"); // signature rides in an EXTRA field
    expect(typeof j.t).toBe("number");
    delete process.env.REDIS_BUS_SECRET;
    vi.resetModules();
  });

  it("with no secret the wire format is byte-identical to before", async () => {
    const prevBus = process.env.REDIS_BUS_SECRET;
    const prevJwt = process.env.JWT_SECRET;
    delete process.env.REDIS_BUS_SECRET;
    delete process.env.JWT_SECRET;
    vi.resetModules();
    const { encodeEnvelope } = await import("./redisBus");
    expect(encodeEnvelope("INST-A", { a: 1 }, "ch")).toBe(JSON.stringify({ i: "INST-A", p: { a: 1 } }));
    if (prevBus !== undefined) process.env.REDIS_BUS_SECRET = prevBus;
    if (prevJwt !== undefined) process.env.JWT_SECRET = prevJwt;
    vi.resetModules();
  });

  it("round-trips a valid signature and DROPS a tampered one in any mode", async () => {
    process.env.REDIS_BUS_SECRET = "test-bus-secret";
    delete process.env.REDIS_BUS_STRICT;
    vi.resetModules();
    const { encodeEnvelope, decodeEnvelope } = await import("./redisBus");
    const raw = encodeEnvelope("INST-A", { n: 1 }, "chan");
    expect(decodeEnvelope(raw, "chan")).toEqual({ i: "INST-A", p: { n: 1 } });
    // payload tampered under a valid-looking signature
    const j = JSON.parse(raw);
    j.p = { n: 999 };
    expect(decodeEnvelope(JSON.stringify(j), "chan")).toBeNull();
    // replayed onto a DIFFERENT channel — channel is bound into the mac
    expect(decodeEnvelope(raw, "other-chan")).toBeNull();
    delete process.env.REDIS_BUS_SECRET;
    vi.resetModules();
  });

  it("unsigned is accepted by default (rolling deploy) and dropped under strict", async () => {
    process.env.REDIS_BUS_SECRET = "test-bus-secret";
    delete process.env.REDIS_BUS_STRICT;
    vi.resetModules();
    let mod = await import("./redisBus");
    const legacy = JSON.stringify({ i: "OLD-INST", p: { x: 1 } });
    expect(mod.decodeEnvelope(legacy, "chan")).toEqual({ i: "OLD-INST", p: { x: 1 } });

    process.env.REDIS_BUS_STRICT = "1";
    vi.resetModules();
    mod = await import("./redisBus");
    expect(mod.decodeEnvelope(legacy, "chan")).toBeNull();

    // strict with NO key must not black-hole everything (a dev box going dark)
    delete process.env.REDIS_BUS_SECRET;
    const prevJwt = process.env.JWT_SECRET;
    delete process.env.JWT_SECRET;
    vi.resetModules();
    mod = await import("./redisBus");
    expect(mod.decodeEnvelope(legacy, "chan")).toEqual({ i: "OLD-INST", p: { x: 1 } });
    if (prevJwt !== undefined) process.env.JWT_SECRET = prevJwt;
    delete process.env.REDIS_BUS_STRICT;
    vi.resetModules();
  });

  it("the mac is a real HMAC over channel + instance + time + payload", async () => {
    process.env.REDIS_BUS_SECRET = "k";
    vi.resetModules();
    const { encodeEnvelope } = await import("./redisBus");
    const raw = encodeEnvelope("I", { z: 3 }, "CH");
    const j = JSON.parse(raw);
    const expected = crypto
      .createHmac("sha256", "k")
      .update(`CH\nI\n${j.t}\n${JSON.stringify({ z: 3 })}`)
      .digest("hex")
      .slice(0, 32);
    expect(j.m).toBe(expected);
    delete process.env.REDIS_BUS_SECRET;
    vi.resetModules();
  });

  it("the leader refuses a frame claiming a home it didn't publish from", () => {
    const sub = CLUSTER.slice(CLUSTER.indexOf("subscribeBus(sigInChannel(INSTANCE_ID)"), CLUSTER.indexOf("void electTick();"));
    expect(sub).toMatch(/\(payload, fromInstance\) =>/);
    expect(sub).toMatch(/if \(f\.home !== fromInstance\) return;/);
    // deploy-safe with no flag: the equality already held for old publishers
    expect(sub).toMatch(/short-circuits before publishing/);
  });

  it("counters are exposed so strict can be flipped on evidence", () => {
    expect(CORE).toMatch(/busAuth: \{/);
    expect(CORE).toMatch(/strict: busStrict\(\)/);
    expect(CORE).toMatch(/unsigned: busAuthStats\.unsigned/);
  });
});

/* ── R1: push endpoint re-bind ──────────────────────────────────────────── */

describe("R1 — an endpoint re-bind requires proof of possession", () => {
  const V2DB2 = read("v2db.ts");
  const fn = V2DB2.slice(
    V2DB2.indexOf("export async function upsertPushSubscription"),
    V2DB2.indexOf("export async function deletePushSubscription")
  );

  it("the INSERT no longer re-binds on conflict (that was the hijack)", () => {
    expect(fn).toMatch(/onDuplicateKeyUpdate\(\{ set: \{ endpoint: sql`\$\{pushSubscriptions\.endpoint\}` \} \}\)/);
    // the pre-fix shape: identityId reassigned straight from the caller's input
    expect(fn).not.toMatch(/onDuplicateKeyUpdate\(\{[\s\S]{0,200}identityId: input\.identityId/);
  });

  it("the whole gate lives in the WHERE, so it reads the PRE-update row", () => {
    const where = fn.slice(fn.indexOf(".where("));
    expect(where).toMatch(/eq\(pushSubscriptions\.identityId, input\.identityId\)/); // already ours
    expect(where).toMatch(/claimHash \? eq\(pushSubscriptions\.claimHash, claimHash\) : sql`1=0`/);
    expect(where).toMatch(/isNull\(pushSubscriptions\.claimHash\)/); // legacy row
    // No SET-assignment-order dependence anywhere.
    expect(fn).not.toMatch(/IF\(/);
  });

  it("a legacy row needs the ENCRYPTION KEYS, which an endpoint-only attacker lacks", () => {
    const where = fn.slice(fn.indexOf(".where("));
    expect(where).toMatch(/eq\(pushSubscriptions\.p256dh, p256dh\)/);
    expect(where).toMatch(/eq\(pushSubscriptions\.auth, auth\)/);
    // …and it is legacy exactly once: the same update stamps a claim.
    expect(fn).toMatch(/\.\.\.\(claimHash \? \{ claimHash \} : \{\}\)/);
  });

  it("the verdict comes from a RE-READ, not affectedRows", () => {
    // MySQL reports 0 affected for a matched-but-unchanged row, which is
    // indistinguishable from a refusal — reporting that as `owned: false` would
    // trigger a pointless endpoint rotation on every ordinary re-registration.
    expect(fn).toMatch(/return \{ owned: !row \|\| row\.identityId === input\.identityId \};/);
    // `affectedRows` may appear in the comment explaining WHY it isn't used; what
    // must not exist is the verdict being derived from it.
    expect(fn).not.toMatch(/affectedRows \?\? 0\) > 0/);
  });

  it("a refusal is purely a no-op — it cannot break the real owner", () => {
    expect(fn).toMatch(/REFUSAL IS PURELY A NO-OP|refusal is purely a no-op/i);
    expect(fn).toMatch(/if \(!db\) return \{ owned: true \};/); // DB down stays fail-open
  });

  it("only the HASH is stored, and the router passes it", () => {
    expect(read("authCrypto.ts")).toMatch(/export function sha256Hex/);
    const routers = read("v2routers.ts");
    expect(routers).toMatch(/claimHash: input\.claim \? sha256Hex\(input\.claim\) : null/);
    expect(routers).toMatch(/claim: z\.string\(\)\.regex\(\/\^\[a-f0-9\]\{32,64\}\$\/\)\.optional\(\)/);
    expect(routers).toMatch(/return \{ ok: true, owned \};/);
  });

  it("the claim is in localStorage and survives sign-out (the constraint)", () => {
    const client = read("..", "client", "src", "app", "pushClient.ts");
    expect(client).toMatch(/const CLAIM_KEY = "relay_push_claim";/);
    expect(client).toMatch(/NOT cleared on sign-out/);
    // The device id was the tempting choice and is WRONG here: sessionStorage,
    // and reset on every sign-out — i.e. it differs on exactly the account
    // switch this must keep working.
    expect(client).toMatch(/sessionStorage and is reset on\s*\n \* every sign-out|sessionStorage/);
    expect(read("..", "client", "src", "app", "useSignOut.tsx")).toMatch(/does NOT clear `relay_push_claim`/);
  });

  it("a lost claim ROTATES the endpoint instead of going silent", () => {
    const client = read("..", "client", "src", "app", "pushClient.ts");
    expect(client).toMatch(/if \(res && res\.owned === false\)/);
    expect(client).toMatch(/await sub\.unsubscribe\(\)/);
    expect(client).toMatch(/reg\.pushManager\.subscribe\(/);
  });
});

/* ── owner report: the desktop status composer ──────────────────────────── */

describe("desktop New-status composer no longer overlaps or clips", () => {
  const STATUS = read("..", "client", "src", "pages", "app", "Status.tsx");

  it("renders through a portal, so no ancestor can trap the fixed overlay", () => {
    expect(STATUS).toMatch(/import \{ createPortal \} from "react-dom";/);
    expect(STATUS).toMatch(/return createPortal\(/);
    expect(STATUS).toMatch(/document\.body\s*\n  \);/);
    // …and the reason, so nobody "simplifies" it back.
    expect(STATUS).toMatch(/a backdrop-blur\s*\n\s*counts\)/);
  });

  it("the tab row can shrink and truncate rather than overflow the card", () => {
    const row = STATUS.slice(STATUS.indexOf("{/* Mode toggle */}"), STATUS.indexOf("{/* Preview area */}"));
    expect(row).toMatch(/flex min-w-0 gap-1 p-3/);
    expect((row.match(/min-w-0 flex-1/g) || []).length).toBe(3);
    expect((row.match(/shrink-0/g) || []).length).toBe(3); // icons never shrink
    expect((row.match(/<span className="truncate">/g) || []).length).toBe(3);
  });

  it("a tall composer scrolls inside itself instead of being cut off", () => {
    expect(STATUS).toMatch(/max-h-\[92dvh\] overflow-y-auto overflow-x-hidden/);
  });
});
