import { describe, expect, it, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  createRegistry,
  handleMessage,
  type PageCalleeHook,
  type RelayRegistry,
  type RelaySocket,
} from "./relay";

/**
 * v2.99.19 — QA-sweep fixes. The heavy multi-agent QA pass surfaced a cluster of
 * real regressions/edge bugs (several from the v2.99.11 offline-call rework).
 * These tests pin the behavioural ones directly (signaling harness) and the
 * client / DB-layer ones by source assertions (they need a browser or a live DB
 * that this suite doesn't spin up).
 */

type Sent = Record<string, unknown>;
class FakeConn {
  outbox: Sent[] = [];
  pin: string | null = null;
  socket: RelaySocket;
  cid: string | undefined;
  alive = true;
  constructor(cid?: string) {
    this.cid = cid;
    this.socket = {
      send: (obj: unknown) => this.outbox.push(obj as Sent),
      close: () => { this.alive = false; },
      alive: () => this.alive,
    };
  }
  setPin = (p: string) => { this.pin = p; };
  ofType(type: string): Sent[] { return this.outbox.filter((m) => m.type === type); }
  asConn() { return { socket: this.socket, pin: this.pin, setPin: this.setPin, cid: this.cid }; }
}
const flush = () => new Promise((r) => setImmediate(r));
function register(reg: RelayRegistry, name: string, pin?: string, cid?: string) {
  const c = new FakeConn(cid);
  handleMessage(reg, c.asConn(), { type: "register", name, pin });
  return c;
}
const read = (rel: string) => readFileSync(join(__dirname, rel), "utf8");

describe("v2.99.19 QA — #49 multi-device caller hang-up cancels ALL the callee's devices", () => {
  let reg: RelayRegistry;
  beforeEach(() => { reg = createRegistry(); });

  it("a caller who hangs up BEFORE answer fans ring-cancel to every ringing device (not just the primary)", () => {
    process.env.MULTI_DEVICE_RING = "1";
    try {
      const caller = register(reg, "Caller", undefined, "caller");
      const d1 = register(reg, "Callee", undefined, "dev1");
      const number = d1.pin!;
      const d2 = register(reg, "Callee", number, "dev2");
      expect(d2.pin).toBe(number);
      handleMessage(reg, caller.asConn(), { type: "invite", to: number });
      expect(d1.ofType("ring").length).toBe(1);
      expect(d2.ofType("ring").length).toBe(1);
      d1.outbox.length = 0; d2.outbox.length = 0;
      // Caller gives up before either device answers.
      handleMessage(reg, caller.asConn(), { type: "leave" });
      // BOTH devices must stop ringing — the pre-fix code only cancelled the
      // primary socket, leaving the OTHER device ringing until its own timeout.
      expect(d1.ofType("ring-cancel").length).toBe(1);
      expect(d2.ofType("ring-cancel").length).toBe(1);
      expect(d1.ofType("ring-cancel")[0]?.from).toBe(caller.pin);
      expect(d2.ofType("ring-cancel")[0]?.from).toBe(caller.pin);
    } finally {
      delete process.env.MULTI_DEVICE_RING;
    }
  });

  it("single-device (flag off) still cancels the one primary socket", () => {
    delete process.env.MULTI_DEVICE_RING;
    const caller = register(reg, "Caller", undefined, "caller");
    const b = register(reg, "Bob", undefined, "bob");
    handleMessage(reg, caller.asConn(), { type: "invite", to: b.pin! });
    expect(b.ofType("ring").length).toBe(1);
    b.outbox.length = 0;
    handleMessage(reg, caller.asConn(), { type: "leave" });
    expect(b.ofType("ring-cancel").length).toBe(1);
  });
});

describe("v2.99.19 QA — #48 offline resolver re-checks ctxEpoch before firing a stale error", () => {
  let reg: RelayRegistry;
  beforeEach(() => { reg = createRegistry(); });

  it("a hang-up while the offline resolver is still out DROPS the stray error", async () => {
    let resolvePage!: (v: { exists: boolean; name?: string }) => void;
    const onPage: PageCalleeHook = () => new Promise((res) => { resolvePage = res; });
    const a = register(reg, "Ana", "111111", "cid-ana");
    handleMessage(reg, a.asConn(), { type: "invite", to: "222222" }, undefined, undefined, onPage);
    // Ana hangs up BEFORE the DB resolve returns → ctxEpoch bumps.
    handleMessage(reg, a.asConn(), { type: "leave" });
    const errsBefore = a.ofType("error").length;
    resolvePage({ exists: true, name: "Bob" });
    await flush();
    // The stale offline result belongs to a dial that no longer exists — dropped.
    expect(a.ofType("error").length).toBe(errsBefore);
  });

  it("with NO hang-up, the offline error is still delivered (guard only blocks the stale case)", async () => {
    let resolvePage!: (v: { exists: boolean; name?: string }) => void;
    const onPage: PageCalleeHook = () => new Promise((res) => { resolvePage = res; });
    const a = register(reg, "Ana", "111111", "cid-ana");
    handleMessage(reg, a.asConn(), { type: "invite", to: "222222" }, undefined, undefined, onPage);
    resolvePage({ exists: true, name: "Bob" });
    await flush();
    const err = a.ofType("error")[0];
    expect(err?.code).toBe("offline");
  });
});

describe("v2.99.19 QA — #46 group-dial does not collapse when an invitee is offline", () => {
  const src = read("../client/src/lib/relayClient.ts");
  it("the error handler promotes the next pending invitee as bootstrap instead of failing the whole dial", () => {
    expect(src).toMatch(/reachErr && callIsGroup && outgoingDial && !establishedOnce && !roomId && aloneInCall\(\)/);
    expect(src).toMatch(/pendingGroupInvites\.shift\(\)/);
  });
  it("a reachability error inside an established parked call never ends the call", () => {
    expect(src).toMatch(/if \(reachErr && inParkedCall\(\)\) break;/);
  });
  it("#51 add-person guard accepts BOTH offline and nonexistent", () => {
    expect(src).toMatch(/addInviteOfflineGuard && \(m\.code === "offline" \|\| m\.code === "nonexistent"/);
  });
});

describe("view-once media survives the burn (v2.99.19 #47 → v2.99.34 M11)", () => {
  const src = read("../client/src/pages/app/Messages.tsx");
  it("revealExpiring gets the content from the server reveal endpoint (which burns it)", () => {
    // M11 retired the client fetch-then-burn flow: the content is withheld from
    // messages.list, so revealExpiring calls the server, which returns the media
    // INLINE as a data URL (survives the immediate burn — no live url to race).
    expect(src).toMatch(/async function revealExpiring/);
    expect(src).toMatch(/await revealExpiringMutation\.mutateAsync\(\{ messageId: m\.id \}\)/);
    expect(src).toMatch(/url: res\.media\.dataUrl/);
    expect(src).toMatch(/thumbUrl: null/);
  });
  it("the reveal-media cleanup helpers still exist (harmless for data URLs)", () => {
    expect(src).toMatch(/function revokeReveal/);
    expect(src).toMatch(/function revokeAllReveals/);
  });
});

describe("v2.99.19 QA — #50 new-device approval waiting screen has a de-strand escape", () => {
  const src = read("../client/src/app/AuthPanel.tsx");
  it("a stall timer surfaces an honest 'other device may be offline' note", () => {
    expect(src).toMatch(/setWaitStalled\(true\)/);
    expect(src).toMatch(/may be offline or closed/i);
  });
  it("offers a PIN sign-in (which bypasses approval) as the escape", () => {
    expect(src).toMatch(/Sign in with your PIN/i);
  });
});

describe("v2.99.19 QA — #51 unsend clears the phantom unread badge + email cooldown rollback + session reaper", () => {
  const db = read("./v2db.ts");
  const routers = read("./v2routers.ts");
  const core = read("./_core/index.ts");
  it("deleteMessage decrements recipients' unreadCount for the unsent message", () => {
    expect(db).toMatch(/GREATEST\(\$\{conversationParticipants\.unreadCount\} - 1, 0\)/);
    expect(db).toMatch(/ne\(conversationParticipants\.identityId, input\.identityId\)/);
  });
  it("a failed offline-message email releases the cooldown claim (retry, not silent suppression)", () => {
    expect(db).toMatch(/export async function releaseOfflineMessageEmailClaim/);
    expect(routers).toMatch(/releaseOfflineMessageEmailClaim\(claimUserId\)/);
  });
  it("a session reaper drops dead pending-approval rows + long-idle sessions", () => {
    expect(db).toMatch(/export async function reapStaleSessions/);
    expect(db).toMatch(/isNotNull\(sessions\.pendingApproval\), lt\(sessions\.pendingApproval/);
    // v2.99.22 (QA M8): the idle cutoff was raised 95d → 372d so it outlives the
    // 365-day cookie TTL (95d prematurely force-logged-out valid sessions).
    expect(core).toMatch(/reapStaleSessions\(30 \* 60_000, 372 \* 24 \* 60 \* 60_000\)/);
  });
});
