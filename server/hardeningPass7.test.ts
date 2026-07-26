/* ============================================================
   v2.99.43 — HARDENING PASS 8: the verified-and-queued list.

   These five were confirmed during the class-based sweep but deliberately
   held back from the pass that shipped three HIGH fixes, because four of
   them sit in the call path — the most delicate code in the app — and
   bundling them behind one version bump would have been a bad trade
   against a green suite. Taken here one at a time.

   One of the five (the claim that /api/relay/send resolves the identity
   context before the rate check) turned out to be WRONG on inspection and
   is pinned below as a refutation rather than a fix.
   ============================================================ */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const read = (...p: string[]) => fs.readFileSync(path.resolve(__dirname, ...p), "utf8");
const RELAY = read("relay.ts");
const CORE_INDEX = read("_core", "index.ts");
const V2DB = read("v2db.ts");
const ENGINE = read("..", "client", "src", "lib", "relayClient.ts");
const BOOT_URL = read("..", "client", "src", "lib", "bootUrl.ts");
const DIALER = read("..", "client", "src", "pages", "app", "Dialer.tsx");
const REALTIME = read("..", "client", "src", "app", "useRealtime.ts");
const MAIN = read("..", "client", "src", "main.tsx");

/* ── M45: moderator powers end when you leave / are removed ─────────────── */

describe("M45 — knock-approve requires live room membership", () => {
  const c = RELAY.slice(RELAY.indexOf('case "knock-approve":'), RELAY.indexOf('case "refresh-ice"'));

  it("checks the approver is STILL in the room, not just recorded as a moderator", () => {
    expect(c).toMatch(/!isModerator\(meta, conn\.pin\) \|\| !room\.has\(conn\.pin\)/);
  });

  it("explains why isModerator alone was insufficient (roomMeta outlives membership)", () => {
    expect(c).toMatch(/`roomMeta` outlives/); // comment wraps after this
    expect(c).toMatch(/KICKED co-host/);
  });

  it("keeps the pending-knock gate and the client-supplied roomId lookup", () => {
    // The roomId stays client-supplied on purpose (a held-call host must be able
    // to approve), which is exactly why membership had to be asserted.
    // v2.99.47: the gate REPLIES before breaking (silence read as a broken
    // Approve button), with a code that can't hang up the approver's own call.
    expect(c).toMatch(/if \(!meta\.knocks \|\| !meta\.knocks\.has\(knockerPin\)\) \{/);
    expect(c).toMatch(/code: "knockfail"/);
  });
});

describe("M45 — kick revokes the target's moderator role", () => {
  const c = RELAY.slice(RELAY.indexOf('case "kick": {'), RELAY.indexOf('case "pin": {'));

  it("deletes the co-host role and any pending knock before removing them", () => {
    expect(c).toMatch(/meta\.cohosts\.delete\(target\);/);
    expect(c).toMatch(/meta\.knocks\?\.delete\(target\);/);
    expect(c.indexOf("cohosts.delete")).toBeLessThan(c.indexOf("leaveRoom(reg, target)"));
  });

  it("tells the remaining room the role is gone", () => {
    expect(c).toMatch(/broadcastToRoom\(reg, rid, \{ type: "role", pin: target, role: null \}\)/);
  });

  it("still enforces the original role hierarchy", () => {
    expect(c).toMatch(/You can't remove the host\./);
    expect(c).toMatch(/Only the host can remove a co-host\./);
  });
});

/* ── M46: in-call chat uses the transport-proven sender ─────────────────── */

describe("M46 — chat sender identity comes from the transport, not the frame", () => {
  const fn = ENGINE.slice(
    ENGINE.indexOf("function receiveChatFrame("),
    ENGINE.indexOf("function setupDC("),
  );

  it("prefers a proven senderPin and validates its shape", () => {
    expect(fn).toMatch(/const trusted = senderPin && \/\^\\d\{6\}\$\/\.test\(senderPin\) \? senderPin : undefined;/);
    expect(fn).toMatch(/const pin = trusted \?\? \(typeof d\.pin === "string" \? d\.pin : undefined\);/);
  });

  it("takes the display name from the roster when the sender is proven", () => {
    expect(fn).toMatch(/const name = trusted \? nameOf\(trusted\) : d\.name;/);
    // The pre-fix call passed the frame's own name/pin straight through.
    expect(fn).not.toMatch(/addChatMsg\(d\.name, d\.text, false, typeof d\.pin/);
  });

  it("the MESH path passes the per-peer channel's pin", () => {
    const dc = ENGINE.slice(ENGINE.indexOf("function setupDC("), ENGINE.indexOf("function setupDC(") + 500);
    expect(dc).toMatch(/receiveChatFrame\(e\.data as string, pin\)/);
  });

  it("the SFU path passes LiveKit's sending participant identity", () => {
    expect(ENGINE).toMatch(
      /RoomEventEnum\.DataReceived, \(payload: Uint8Array, participant\?: \{ identity\?: string \}\)/,
    );
    expect(ENGINE).toMatch(/receiveChatFrame\(new TextDecoder\(\)\.decode\(payload\), participant\?\.identity\)/);
  });

  /** A forged frame must not be able to dictate who the message appears to be from. */
  it("a claimed pin/name is ignored whenever the transport proves otherwise", () => {
    const pick = (senderPin: string | undefined, claimed: string | undefined) => {
      const trusted = senderPin && /^\d{6}$/.test(senderPin) ? senderPin : undefined;
      return trusted ?? claimed;
    };
    expect(pick("235680", "911801")).toBe("235680"); // forgery loses
    expect(pick(undefined, "911801")).toBe("911801"); // legacy path unchanged
    expect(pick("not-a-pin", "911801")).toBe("911801"); // junk identity ignored
  });
});

/* ── M47: one identity per user, resolved deterministically ─────────────── */

describe("M47 — duplicate identities can't be created, and resolution is stable", () => {
  const fn = V2DB.slice(
    V2DB.indexOf("export async function getIdentityByUserId"),
    V2DB.indexOf("Create a new guest identity"),
  );

  it("orders by id so the SAME identity is returned every time", () => {
    expect(fn).toMatch(/\.orderBy\(asc\(identities\.id\)\)/);
    expect(V2DB).toMatch(/^\s*asc,$/m); // imported
  });

  it("documents the user-visible symptom it removes", () => {
    expect(fn).toMatch(/number changes randomly/);
    expect(fn).toMatch(/check-then-insert/);
  });

  it("adds a UNIQUE index on identities.userId via the boot migrator", () => {
    expect(V2DB).toMatch(
      /ADD UNIQUE INDEX `identities_user_unique` \(`userId`\)/,
    );
  });

  it("notes that NULL userId (guests) are unaffected and that boot is never blocked", () => {
    // Anchored on the MIGRATOR ENTRY, not on a bare `identities_user_unique`
    // token: v2.99.68 mentioned that index name in prose 1,000 lines earlier, which
    // put the slice's end BEFORE its start and silently reduced it to "" — a pin
    // that reads an empty string cannot fail for the reason it was written.
    const start = V2DB.indexOf("M47: one identity per registered user");
    const end = V2DB.indexOf('ddl: "ADD UNIQUE INDEX', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const idx = V2DB.slice(start, end);
    expect(idx.length).toBeGreaterThan(200); // the comment block really is there
    expect(idx).toMatch(/NULL/);
    expect(idx).toMatch(/boot is never blocked/);
  });

  it("the migrator still tolerates a failing ALTER (duplicates already present)", () => {
    const loop = V2DB.slice(V2DB.indexOf("for (const a of adds) {"), V2DB.indexOf("Additive TABLE creation"));
    expect(loop).toMatch(/catch \(e\)/);
    expect(loop).toMatch(/duplicate key name/);
  });
});

/* ── M48: a link can't place a call without a gesture ──────────────────── */

describe("M48 — ?to= only auto-dials when the intent came from inside the app", () => {
  it("captures the boot URL once, outside any lazily-loaded route module", () => {
    expect(BOOT_URL).toMatch(/export const BOOT_SEARCH/);
    expect(BOOT_URL).toMatch(/export function bootedWithDialTarget\(\)/);
    // Imported by the entry so it evaluates before routing.
    expect(MAIN).toMatch(/import "@\/lib\/bootUrl";/);
  });

  it("explains why a route module can't make this distinction itself", () => {
    expect(BOOT_URL).toMatch(/lazily loaded/);
  });

  it("the Dialer prefills instead of dialing when the document arrived with ?to=", () => {
    const eff = DIALER.slice(DIALER.indexOf("const autoDialedRef"), DIALER.indexOf("const history ="));
    expect(eff).toMatch(/if \(arrivedWithDialTarget\(to\) && !intended\) \{/);
    expect(eff).toMatch(/setDialed\(to\);/);
    // …and the guard sits BEFORE the dial.
    expect(eff.indexOf("bootedWithDialTarget()")).toBeLessThan(eff.indexOf("engine.dial(to"));
  });

  it("honors a one-time same-origin intent so our own notification stays one tap", () => {
    expect(BOOT_URL).toMatch(/export function markDialIntent\(/);
    expect(BOOT_URL).toMatch(/export function consumeDialIntent\(/);
    expect(BOOT_URL).toMatch(/sessionStorage/);
    expect(REALTIME).toMatch(/markDialIntent\(payload\.number\);/);
    const eff = DIALER.slice(DIALER.indexOf("const autoDialedRef"), DIALER.indexOf("const history ="));
    expect(eff).toMatch(/const intended = consumeDialIntent\(\) === to;/);
  });

  it("the intent is single-use (a reload can't silently re-dial)", () => {
    const fn = BOOT_URL.slice(BOOT_URL.indexOf("export function consumeDialIntent"));
    expect(fn).toMatch(/removeItem\(DIAL_INTENT_KEY\)/);
  });

  it("explains why a URL-embedded marker would be useless", () => {
    expect(BOOT_URL).toMatch(/copies it into/);
  });
});

/* ── refuted: the send limiter already precedes identity resolution ─────── */

describe("REFUTED — /api/relay/send rate-limits BEFORE resolving identity", () => {
  it("the limiter is app.use middleware on the path, registered before attachRelay", () => {
    const limiterAt = CORE_INDEX.indexOf('app.use("/api/relay/send"');
    const attachAt = CORE_INDEX.indexOf("attachRelay(");
    expect(limiterAt).toBeGreaterThan(-1);
    expect(attachAt).toBeGreaterThan(-1);
    // Express runs middleware in REGISTRATION order, so an earlier app.use on
    // the same path always precedes the route handler that calls createContext.
    expect(limiterAt).toBeLessThan(attachAt);
  });

  it("createContext lives inside the POST handler, i.e. after the middleware", () => {
    const handler = RELAY.slice(RELAY.indexOf('app.post("/api/relay/send"'));
    expect(handler).toMatch(/await createContext\(/);
    // And only for `register` — every other message skips the DB entirely.
    expect(handler).toMatch(/if \(\(message as RelayMessage\)\.type === "register"\) \{/);
  });
});
