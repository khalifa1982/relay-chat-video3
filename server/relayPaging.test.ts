import { describe, expect, it, beforeEach } from "vitest";
import {
  createRegistry,
  handleMessage,
  PENDING_RING_TTL_MS,
  type MissedCallHook,
  type PageCalleeHook,
  type RelayRegistry,
  type RelaySocket,
} from "./relay";

/**
 * Offline-callee behavior — protocol tests.
 *
 * v2.99.11 (owner directive: "if the user is offline it should NOT ring
 * automatically — tell the caller he's offline; you can leave an SMS or voice
 * message"): the v2.83 PAGING model (keep the dial alive + push-wake the phone
 * + redeliver the ring on reconnect) is RETIRED for a cold offline dial. An
 * invite to an unreachable number now resolves the identity via the hook and
 * returns a FAST, honest error{offline} (real identity) or error{nonexistent},
 * recording the miss immediately so it surfaces on the callee's History +
 * (pref-gated) email when they return. The LIVE-path ring redelivery
 * (deliverPendingRing on a mid-ring reload) is unchanged.
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
      send: (obj: unknown) => {
        this.outbox.push(obj as Sent);
      },
      close: () => {
        this.alive = false;
      },
      alive: () => this.alive,
    };
  }
  setPin = (p: string) => {
    this.pin = p;
  };
  ofType(type: string): Sent[] {
    return this.outbox.filter(m => m.type === type);
  }
  asConn() {
    return { socket: this.socket, pin: this.pin, setPin: this.setPin, cid: this.cid };
  }
}

const flush = () => new Promise(r => setImmediate(r));

function register(reg: RelayRegistry, name: string, pin: string, cid?: string, hooks?: Hooks) {
  const c = new FakeConn(cid);
  handleMessage(reg, c.asConn(), { type: "register", name, pin }, hooks?.onInvite, hooks?.onMissed, hooks?.onPage);
  return c;
}

interface Hooks {
  onInvite?: undefined;
  onMissed?: MissedCallHook;
  onPage?: PageCalleeHook;
}

describe("offline-callee paging", () => {
  let reg: RelayRegistry;
  beforeEach(() => {
    reg = createRegistry();
  });

  it("LEGACY (no paging hook): invite to an unknown number still fails fast with error{offline} + records the miss", () => {
    const misses: string[] = [];
    const a = register(reg, "Ana", "111111");
    handleMessage(reg, a.asConn(), { type: "invite", to: "222222" }, undefined, (i) => misses.push(i.calleePin));
    const err = a.ofType("error")[0];
    expect(err?.code).toBe("offline");
    expect(misses).toEqual(["222222"]);
    // No dial room survives the legacy bounce path for the ring bookkeeping.
    expect(reg.pendingRings.size).toBe(0);
  });

  it("a REAL but unreachable number → FAST error{offline} + records the miss, NO keep-alive ring (v2.99.11)", async () => {
    const misses: string[] = [];
    const paged: string[] = [];
    const onPage: PageCalleeHook = async (info) => {
      paged.push(info.calleePin);
      return { exists: true, name: "Bob" };
    };
    const a = register(reg, "Ana", "111111");
    handleMessage(reg, a.asConn(), { type: "invite", to: "222222" }, undefined, (i) => misses.push(i.calleePin), onPage);
    await flush();
    // Honest offline error naming the callee — no room kept, no ringing ack.
    const err = a.ofType("error")[0];
    expect(err?.code).toBe("offline");
    expect(String(err?.message)).toMatch(/offline/i);
    expect(a.ofType("ringing").length).toBe(0);
    // The identity was resolved (name), and the miss is recorded IMMEDIATELY so
    // it lands on the callee's History + email when they return.
    expect(paged).toEqual(["222222"]);
    expect(misses).toEqual(["222222"]);
    // No dangling dial bookkeeping — nothing to redeliver, nothing to reap.
    expect(reg.pendingRings.size).toBe(0);
    expect(reg.clients.get("111111")?.ringing.size ?? 0).toBe(0);
  });

  it("NONEXISTENT number (hook says exists:false): error{nonexistent}, no miss recorded", async () => {
    const misses: string[] = [];
    const onPage: PageCalleeHook = async () => ({ exists: false });
    const a = register(reg, "Ana", "111111");
    handleMessage(reg, a.asConn(), { type: "invite", to: "999999" }, undefined, (i) => misses.push(i.calleePin), onPage);
    await flush();
    const err = a.ofType("error")[0];
    expect(err?.code).toBe("nonexistent");
    expect(String(err?.message)).toMatch(/doesn't exist/);
    expect(reg.pendingRings.size).toBe(0);
    expect(reg.clients.get("111111")?.ringing.size).toBe(0);
    // A number that doesn't exist has nobody to record a miss against.
    expect(misses).toEqual([]);
  });

  it("a DEAD-BUT-IN-GRACE callee socket is treated as offline too (fast error, no ring into the void)", async () => {
    const onPage: PageCalleeHook = async () => ({ exists: true, name: "Bob" });
    // Bob was registered, then his phone locked → SSE closed, record in grace.
    const b = register(reg, "Bob", "222222", "cid-bob");
    b.socket.close();
    const a = register(reg, "Ana", "111111");
    handleMessage(reg, a.asConn(), { type: "invite", to: "222222" }, undefined, undefined, onPage);
    await flush();
    expect(a.ofType("error")[0]?.code).toBe("offline");
    expect(a.ofType("ringing").length).toBe(0);
    expect(b.ofType("ring").length).toBe(0);
  });

  it("reload mid-ring (LIVE path) redelivers too: the ring survives the callee's refresh", () => {
    const a = register(reg, "Ana", "111111");
    const b = register(reg, "Bob", "222222", "cid-bob");
    handleMessage(reg, a.asConn(), { type: "invite", to: "222222" });
    expect(b.ofType("ring").length).toBe(1);
    // Bob's page reloads mid-ring: new connection, same cid, re-register.
    const b2 = register(reg, "Bob", "222222", "cid-bob");
    expect(b2.ofType("ring").length).toBe(1);
  });

  it("a REJECT clears the pending ring (no ghost ring on the callee's next open)", () => {
    const a = register(reg, "Ana", "111111");
    const b = register(reg, "Bob", "222222", "cid-bob");
    handleMessage(reg, a.asConn(), { type: "invite", to: "222222" });
    handleMessage(reg, b.asConn(), { type: "reject", to: "111111" });
    expect(reg.pendingRings.has("222222")).toBe(false);
    const b2 = register(reg, "Bob", "222222", "cid-bob");
    expect(b2.ofType("ring").length).toBe(0);
  });

  it("an EXPIRED pending ring never redelivers", () => {
    const a = register(reg, "Ana", "111111");
    register(reg, "Bob", "222222", "cid-bob");
    handleMessage(reg, a.asConn(), { type: "invite", to: "222222" });
    const pr = reg.pendingRings.get("222222")!;
    reg.pendingRings.set("222222", { ...pr, at: Date.now() - PENDING_RING_TTL_MS - 1000 });
    const b2 = register(reg, "Bob", "222222", "cid-bob");
    expect(b2.ofType("ring").length).toBe(0);
    expect(reg.pendingRings.has("222222")).toBe(false);
  });

  it("a MID-DIAL re-register (geo-flag re-affirm / SSE blip) must NOT reap the caller's fresh dial room", () => {
    const a = register(reg, "Ana", "111111", "cid-ana");
    const b = register(reg, "Bob", "222222", "cid-bob");
    handleMessage(reg, a.asConn(), { type: "invite", to: "222222" });
    const roomId = String(a.ofType("room")[0]?.roomId);
    expect(reg.rooms.has(roomId)).toBe(true);
    // The engine re-registers on every SSE `ready` and on setSelfFlag (geo
    // resolving ~1-2s after boot — i.e. often DURING a quick History redial).
    // The v2.78.1 ghost-room guard used to see a solo room and leaveRoom() it,
    // killing the dial out from under the caller.
    handleMessage(reg, a.asConn(), { type: "register", name: "Ana", pin: "111111", flag: "🇩🇪" });
    expect(reg.rooms.has(roomId)).toBe(true);
    expect(reg.clients.get("111111")?.roomId).toBe(roomId);
    // …and the callee can still answer the (still-live) call.
    handleMessage(reg, b.asConn(), { type: "accept", roomId });
    expect(b.ofType("joined").length).toBe(1);
    expect(a.ofType("peer-joined")[0]?.pin).toBe("222222");
  });
});
