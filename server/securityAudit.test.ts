import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  createRegistry,
  handleMessage,
  type RelayRegistry,
  type RelaySocket,
  type RelayMessage,
} from "./relay";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

/**
 * Regression tests for the 2026-07-22 security audit (findings F1–F5).
 *
 * F1 (signaling identity binding) is exercised behaviorally against
 * handleMessage — the security-critical branch needs no DB. F2/F3/F5 touch
 * router/DB code that isn't reachable in the unit env (no MySQL), so — following
 * the repo's existing precedent (status.test.ts) — they pin the security wiring
 * by reading the source. F4 is covered behaviorally in rateLimit.test.ts.
 */

// ── F1: a client can only register its OWN server-resolved number ────────────
class Conn {
  outbox: unknown[] = [];
  pin: string | null = null;
  socket: RelaySocket;
  constructor(public cid: string) {
    this.socket = { send: (o) => this.outbox.push(o), close: () => {} };
  }
  setPin = (p: string) => {
    this.pin = p;
  };
  asConn() {
    return { socket: this.socket, pin: this.pin, setPin: this.setPin, cid: this.cid };
  }
  registeredPin(): string | undefined {
    const last = [...this.outbox].reverse().find(
      (m): m is { type: string; pin: string } =>
        !!m && typeof m === "object" && (m as { type?: string }).type === "registered"
    );
    return last?.pin;
  }
}

function doRegister(reg: RelayRegistry, c: Conn, msg: Partial<RelayMessage>) {
  handleMessage(reg, c.asConn(), { type: "register", name: "X", ...msg } as RelayMessage);
}

describe("F1 — signaling register binds the claimed number to the caller's identity", () => {
  let reg: RelayRegistry;
  beforeEach(() => {
    reg = createRegistry();
  });

  it("uses the server-resolved number and IGNORES a mismatched client-requested pin", () => {
    const c = new Conn("cidA");
    // Client asks for 222222 but the server resolved their identity as 111111.
    doRegister(reg, c, { pin: "222222", __ownedNumber: "111111" });
    expect(c.pin).toBe("111111");
    expect(c.registeredPin()).toBe("111111");
    expect(reg.clients.has("111111")).toBe(true);
    expect(reg.clients.has("222222")).toBe(false);
  });

  it("an attacker CANNOT seize a victim's (offline, unclaimed) number", () => {
    // Victim's number 500500 is not currently connected (app closed).
    const attacker = new Conn("cidAttacker");
    // Attacker claims the victim's number, but their real identity is 900900.
    doRegister(reg, attacker, { pin: "500500", __ownedNumber: "900900" });
    // They get their OWN number, never the victim's.
    expect(attacker.pin).toBe("900900");
    expect(reg.clients.has("900900")).toBe(true);
    // The victim's number stays free — the attacker never registered on it, so a
    // real dial to 500500 can't be routed to the attacker's socket.
    expect(reg.clients.has("500500")).toBe(false);
  });

  it("with NO resolvable identity (null), an explicit claim of a FREE number is refused", () => {
    const c = new Conn("cidNull");
    // Free number requested, but no identity resolved (no cookie / resolve error).
    doRegister(reg, c, { pin: "222222", __ownedNumber: null });
    // A fresh number is allocated instead of honoring the claim.
    expect(c.pin).toMatch(/^\d{6}$/);
    expect(c.pin).not.toBe("222222");
    expect(reg.clients.has("222222")).toBe(false);
  });

  it("a same-cid reconnect keeps its already-bound number", () => {
    const c = new Conn("cidReuse");
    doRegister(reg, c, { pin: "222222", __ownedNumber: "111111" });
    expect(c.pin).toBe("111111");
    // Reconnect (same cid) — even if the client now asks for something else, the
    // cid-owned number is preserved (and still equals the bound identity number).
    doRegister(reg, c, { pin: "333333", __ownedNumber: "111111" });
    expect(c.pin).toBe("111111");
  });

  it("LEGACY: a direct handleMessage call with no __ownedNumber keeps requested-pin behavior", () => {
    // No __ownedNumber field at all (unit-test / non-HTTP path) → unchanged.
    const c = new Conn("cidLegacy");
    doRegister(reg, c, { pin: "222222" });
    expect(c.pin).toBe("222222");
  });
});

// ── source-pinned wiring for the DB/router-coupled fixes ─────────────────────
describe("F1 — the POST /api/relay/send handler stamps a server-only owned number", () => {
  const src = read("server/relay.ts");
  it("strips any client-supplied __ownedNumber before use", () => {
    expect(src).toMatch(/delete \(message as Record<string, unknown>\)\.__ownedNumber/);
  });
  it("resolves the caller's identity via createContext for register messages", () => {
    expect(src).toMatch(/import \{ createContext \} from "\.\/_core\/context"/);
    expect(src).toMatch(/\(message as RelayMessage\)\.type === "register"/);
    expect(src).toMatch(/ctx\.identity\?\.number \?\? null/);
  });
  it("fails CLOSED (null) when identity resolution throws", () => {
    // The catch sets owned = null → the register handler allocates a fresh pin.
    expect(src).toMatch(/catch \{\s*owned = null;/);
  });
});

describe("F2 — updateProfile gates a /manus-storage avatar key on the caller's namespace", () => {
  const src = read("server/v2routers.ts");
  it("rejects a foreign-namespace avatar key on write (relative AND absolute — QA H5)", () => {
    // v2.99.26 (H5): the gate was widened from a relative-only
    // `startsWith("/manus-storage/")` check to `lastIndexOf("/manus-storage/")`
    // so an ABSOLUTE https://host/manus-storage/<victim-key> URL is gated too
    // (isIdentityAvatarKey suffix-matches, so the absolute shape laundered keys).
    expect(src).toMatch(/lastIndexOf\(marker\)/);
    expect(src).toMatch(/keyInOwnerNamespace\(key, me\.id, s3Config\(\)\?\.prefix \?\? ""\)/);
  });
});

describe("F3 — consuming view-once media fails CLOSED instead of deleting the row", () => {
  const src = read("server/v2db.ts");
  it("no longer deletes the attachments row on consume", () => {
    // The old fail-open deletion is gone (deleting made the key classify as
    // `unknown`, which the storage proxy serves to anyone).
    expect(src).not.toMatch(/db\.delete\(attachments\)\.where\(eq\(attachments\.id, row\.attachmentId\)\)/);
  });
  it("documents the fail-closed rationale", () => {
    expect(src).toMatch(/fails CLOSED/);
  });
});

describe("F5 — the public directory endpoints are rate-gated", () => {
  const src = read("server/v2routers.ts");
  it("defines a per-IP directory limiter + gate", () => {
    expect(src).toMatch(/directoryIpLimiter = createRateLimiter/);
    expect(src).toMatch(/function directoryGate\(/);
  });
  it("applies the gate to lookup and presenceMany", () => {
    // Both procedures call directoryGate(ctx) before any DB work.
    const gateCalls = src.match(/directoryGate\(ctx\)/g) ?? [];
    expect(gateCalls.length).toBeGreaterThanOrEqual(2);
  });
  it("honors the RELAY_RATELIMIT_OFF escape hatch like the other gates", () => {
    expect(src).toMatch(/function directoryGate[\s\S]*?RELAY_RATELIMIT_OFF/);
  });
});
