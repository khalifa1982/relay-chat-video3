import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createRegistry, handleMessage, type RelayRegistry, type RelaySocket } from "./relay";
import { mintBudgetState } from "./v2db";

/**
 * v2.99.48 — THIRD self-review round. The pattern that keeps repeating in these
 * rounds is worth naming: a fix keyed to something the ATTACKER controls, or a
 * guard that parses differently from the code it guards, looks closed and is not.
 *
 * M57  the offline-dial budget was keyed on a pin an anonymous caller re-mints
 *      at will, so M40's enumeration oracle never actually closed.
 * M58  the number-space ceiling is now GLOBAL, at the one allocator funnel —
 *      `/api/auth/register` reached that sink with no mint budget at all.
 * M59  `revealExpiring` bounded one object but not the process (tRPC batching +
 *      a 60-burst bucket ⇒ enough heap to OOM the signaling instance).
 * M60  the M48 forced-call guard is re-tested in client/src/lib/bootUrl.test.ts.
 */
const ROOT = path.resolve(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const RELAY = read("server/relay.ts");
const ROUTERS = read("server/v2routers.ts");
const V2DB = read("server/v2db.ts");
const CORE = read("server/_core/index.ts");
const MESSAGES = read("client/src/pages/app/Messages.tsx");

/* ── M57: the budget follows an identity the caller can't mint ───────────── */

type Sent = Record<string, unknown>;
class FakeConn {
  outbox: Sent[] = [];
  pin: string | null = null;
  socket: RelaySocket;
  constructor(readonly cid?: string) {
    this.socket = { send: (o: unknown) => this.outbox.push(o as Sent), close: () => {} };
  }
  setPin = (p: string) => { this.pin = p; };
  asConn() { return { socket: this.socket, pin: this.pin, setPin: this.setPin, cid: this.cid }; }
}

describe("M57 — an unverified caller is budgeted by ADDRESS, not by their pin", () => {
  let reg: RelayRegistry;
  beforeEach(() => { reg = createRegistry(); });

  it("marks a cookie-resolved registration as verified and remembers the address", () => {
    const c = new FakeConn("cid-1");
    handleMessage(reg, c.asConn(), {
      type: "register", name: "Real", pin: "111111",
      __ownedNumber: "111111", __clientIp: "203.0.113.9",
    });
    const rec = reg.clients.get(c.pin!)!;
    expect(c.pin).toBe("111111");
    expect(rec.verifiedPin).toBe(true);
    expect(rec.ip).toBe("203.0.113.9");
  });

  it("marks an ANONYMOUS registration unverified — it got a minted pin, not its own", () => {
    const c = new FakeConn("cid-2");
    handleMessage(reg, c.asConn(), {
      type: "register", name: "Anon", pin: "222222",
      __ownedNumber: null, __clientIp: "198.51.100.7",
    });
    // The claim was refused (F1) and a fresh pin allocated…
    expect(c.pin).not.toBe("222222");
    const rec = reg.clients.get(c.pin!)!;
    // …so nothing about this pin is proven, and the budget must not follow it.
    expect(rec.verifiedPin).toBe(false);
    expect(rec.ip).toBe("198.51.100.7");
  });

  it("an anonymous client cannot take over a VERIFIED pin (so it can't inherit its budget)", () => {
    const real = new FakeConn("cid-real");
    handleMessage(reg, real.asConn(), {
      type: "register", name: "Real", pin: "444444",
      __ownedNumber: "444444", __clientIp: "203.0.113.9",
    });
    expect(reg.clients.get("444444")!.verifiedPin).toBe(true);
    // A DIFFERENT channel with no cookie claiming that number: F1 refuses the
    // claim outright and mints a fresh pin, so the impostor is budgeted by its
    // own address and the real owner's bucket is untouched.
    const imposter = new FakeConn("cid-imposter");
    handleMessage(reg, imposter.asConn(), {
      type: "register", name: "Anon", pin: "444444",
      __ownedNumber: null, __clientIp: "198.51.100.7",
    });
    expect(imposter.pin).not.toBe("444444");
    expect(reg.clients.get(imposter.pin!)!.verifiedPin).toBe(false);
    expect(reg.clients.get("444444")!.verifiedPin).toBe(true); // still theirs
  });

  it("a re-affirm on an already-bound channel cannot UPGRADE verified state", () => {
    // The re-affirm path (same cid, pin already bound) deliberately only refreshes
    // name/device/flag. What matters for the budget is that it can never turn an
    // unverified record into a verified one — the initial bind decides.
    const c = new FakeConn("cid-x");
    handleMessage(reg, c.asConn(), {
      type: "register", name: "Anon", pin: "555555",
      __ownedNumber: null, __clientIp: "198.51.100.7",
    });
    const minted = c.pin!;
    expect(reg.clients.get(minted)!.verifiedPin).toBe(false);
    handleMessage(reg, c.asConn(), {
      type: "register", name: "Anon", pin: minted,
      __ownedNumber: minted, __clientIp: "198.51.100.7",
    });
    expect(reg.clients.get(minted)!.verifiedPin).toBe(false);
  });

  it("a direct handleMessage (no transport) stays verified, so unit tests are unchanged", () => {
    const c = new FakeConn("cid-3");
    handleMessage(reg, c.asConn(), { type: "register", name: "Test" });
    expect(reg.clients.get(c.pin!)!.verifiedPin).toBe(true);
  });

  it("keys the bucket on the identity when proven and the address otherwise", () => {
    const key = RELAY.slice(RELAY.indexOf("function offlineDialKey"), RELAY.indexOf("function offlineDialKey") + 400);
    expect(key).toMatch(/if \(c\?\.verifiedPin\) return "id:" \+ callerPin;/);
    expect(key).toMatch(/return "ip:" \+ \(c\?\.ip \|\| "unknown"\);/);
    expect(RELAY).toMatch(/offlineDialLimiter\.allow\(offlineDialKey\(reg, callerPin\), Date\.now\(\)\)/);
  });

  it("strips both server-only fields from client input before stamping them", () => {
    const route = RELAY.slice(RELAY.indexOf('app.post("/api/relay/send"'));
    expect(route).toMatch(/delete \(message as Record<string, unknown>\)\.__ownedNumber;/);
    expect(route).toMatch(/delete \(message as Record<string, unknown>\)\.__clientIp;/);
    // …and the strips precede the stamps, or a client could forge either.
    expect(route.indexOf("delete (message as Record<string, unknown>).__clientIp;"))
      .toBeLessThan(route.indexOf("__clientIp = clientIpOf(req)"));
  });

  it("only a VERIFIED caller is told the callee's name (no name harvesting)", () => {
    const branch = RELAY.slice(RELAY.indexOf("if (!targetReachable)"), RELAY.indexOf("if (!target) return;"));
    expect(branch).toMatch(/verifiedPin\s*\n?\s*\? \(info\.name \|\| "They"\) \+ " is offline right now\."/);
    expect(branch).toMatch(/: "They're offline right now\."/);
  });
});

/* ── M58: the number-space ceiling is global ─────────────────────────────── */

describe("M58 — the mint budget lives at the allocator, where no caller can miss it", () => {
  it("guards allocateSharedNumber itself, ahead of the candidate search", () => {
    const alloc = V2DB.slice(V2DB.indexOf("async function allocateSharedNumber"));
    expect(alloc.slice(0, 500)).toMatch(/if \(!claimMintBudget\(Date\.now\(\)\)\)/);
    // Over budget throws, so every existing caller's error handling applies.
    expect(alloc.slice(0, 700)).toMatch(/throw new Error\("number allocation is temporarily rate-limited"\)/);
    // The guard precedes any DB work.
    expect(alloc.indexOf("claimMintBudget")).toBeLessThan(alloc.indexOf("numberTaken(db, candidate)"));
  });

  it("reports a fresh window as fully available (and is a rolling window)", () => {
    const st = mintBudgetState(Date.now() + 3 * 60 * 60_000); // far past any window
    expect(st.used).toBe(0);
    expect(st.remaining).toBeGreaterThan(0);
  });

  it("the registration path that was missed now meters BEFORE it allocates", () => {
    const LOCAL = read("server/authLocal.ts");
    expect(LOCAL).toMatch(/const mintGate = \(req: Request, res: Response\)/);
    const reg = LOCAL.slice(LOCAL.indexOf('app.post("/api/auth/register"'));
    expect(reg.indexOf("if (!mintGate(req, res)) return;")).toBeLessThan(reg.indexOf("await createLocalUser("));
    // The looser gate still fronts the whole route (brute-force guard).
    expect(reg.indexOf("if (!gate(req, res)) return;")).toBeLessThan(reg.indexOf("if (!mintGate(req, res)) return;"));
  });

  it("the guest gate's sustained rate is no longer the thing that locks a NAT out", () => {
    expect(ROUTERS).toMatch(/createRateLimiter\(\{ capacity: 60, refillPerSec: 1 \}\)/);
  });
});

/* ── M59: the reveal endpoint can't OOM the signaling process ────────────── */

describe("M59 — revealExpiring bounds the PROCESS, not just one response", () => {
  const fn = ROUTERS.slice(ROUTERS.indexOf("revealExpiring: publicProcedure"), ROUTERS.length);

  it("reserves an aggregate slot BEFORE the irreversible burn", () => {
    expect(fn).toMatch(/const slot = reserveRevealSlot\(\);/);
    expect(fn).toMatch(/if \(!slot\) \{\s*\n\s*return \{ ok: false as const, retry: true as const \};/);
    // Refusing AFTER the burn would destroy a message the reader never saw.
    expect(fn.indexOf("reserveRevealSlot()")).toBeLessThan(fn.indexOf("await revealExpiringMessage("));
  });

  it("bounds both concurrency and total in-flight bytes, and always releases", () => {
    expect(ROUTERS).toMatch(/const REVEAL_MAX_CONCURRENT = \d+;/);
    expect(ROUTERS).toMatch(/const REVEAL_MAX_INFLIGHT_BYTES = /);
    const reserve = ROUTERS.slice(ROUTERS.indexOf("function reserveRevealSlot"), ROUTERS.indexOf("export function revealBudgetState"));
    expect(reserve).toMatch(/if \(revealInFlight >= REVEAL_MAX_CONCURRENT\) return null;/);
    expect(reserve).toMatch(/if \(revealInFlightBytes >= REVEAL_MAX_INFLIGHT_BYTES\) return null;/);
    expect(reserve).toMatch(/if \(released\) return;/); // idempotent release
    expect(fn).toMatch(/\} finally \{\s*\n\s*slot\.release\(reservedBytes\);/);
  });

  it("the per-request stream cap it complements is still enforced", () => {
    expect(fn).toMatch(/total > REVEAL_MAX_INLINE_BYTES/);
    expect(fn).toMatch(/await reader\.cancel\(\)/);
  });

  it("tRPC batches are capped, so one request can't multiply any procedure", () => {
    expect(CORE).toMatch(/const TRPC_MAX_BATCH = \d+;/);
    expect(CORE).toMatch(/res\.status\(413\)\.json\(\{ error: "batch_too_large" \}\)/);
    // The cap must run BEFORE the tRPC middleware or resolvers already executed.
    expect(CORE.indexOf("TRPC_MAX_BATCH")).toBeLessThan(CORE.indexOf("createExpressMiddleware({"));
  });
});

/* ── M22 follow-up: losing the burn race must not latch an empty bubble ─── */

describe("M22 follow-up — a refused reveal stays honest and retryable", () => {
  const fn = MESSAGES.slice(MESSAGES.indexOf("async function revealExpiring("), MESSAGES.indexOf("const removeMutation"));

  it("only caches a reveal that actually returned content", () => {
    expect(fn).toMatch(/let got = false;/);
    expect(fn).toMatch(/got = true;/);
    expect(fn).toMatch(/if \(!got\) \{[\s\S]*?messages\.list\.invalidate\(\)[\s\S]*?return;\s*\n\s*\}/);
    // The setRevealed write must sit AFTER that early return.
    expect(fn.indexOf("if (!got)")).toBeLessThan(fn.indexOf("setRevealed((prev)"));
  });

  it("clears the in-flight marker on every path (no stuck spinner)", () => {
    expect(fn).toMatch(/setRevealing\(null\);/);
    expect(fn.indexOf("setRevealing(null);")).toBeLessThan(fn.indexOf("if (!got)"));
  });
});
