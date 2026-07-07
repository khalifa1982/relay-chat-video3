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
 * v2.83 — offline-callee PAGING + late-ring redelivery, protocol tests.
 *
 * The two reported bugs share one root: a callee whose SSE is gone (locked /
 * backgrounded phone, closed tab) could never be rung — the caller's dial died
 * instantly as "offline" (History redials dropping "within two seconds, before
 * it even rings") and the callee never saw ANY alert. Now an invite to an
 * unreachable-but-real number PAGES: the dial stays alive, a push hook wakes
 * the device, and the ring is DELIVERED the moment the callee (re)registers.
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

  it("pages a REAL but unreachable number: room kept, ringing{paging} ack, push hook fired, NO instant miss", async () => {
    const misses: string[] = [];
    const paged: string[] = [];
    const onPage: PageCalleeHook = async (info) => {
      paged.push(info.calleePin);
      return { exists: true, name: "Bob" };
    };
    const a = register(reg, "Ana", "111111");
    handleMessage(reg, a.asConn(), { type: "invite", to: "222222" }, undefined, (i) => misses.push(i.calleePin), onPage);
    await flush();
    // No offline error — instead a room + a paging-flavoured ringing ack.
    expect(a.ofType("error").length).toBe(0);
    expect(a.ofType("room").length).toBe(1);
    const ringing = a.ofType("ringing")[0];
    expect(ringing?.paging).toBe(true);
    expect(ringing?.name).toBe("Bob");
    expect(paged).toEqual(["222222"]);
    // The miss is recorded when the caller GIVES UP, not at invite time.
    expect(misses).toEqual([]);
    // Ring bookkeeping is live: redeliverable + cancellable.
    expect(reg.pendingRings.get("222222")?.from).toBe("111111");
    expect(reg.clients.get("111111")?.ringing.has("222222")).toBe(true);
  });

  it("NONEXISTENT number (hook says exists:false): classic offline error + clean bookkeeping", async () => {
    const onPage: PageCalleeHook = async () => ({ exists: false });
    const a = register(reg, "Ana", "111111");
    handleMessage(reg, a.asConn(), { type: "invite", to: "999999" }, undefined, undefined, onPage);
    await flush();
    const err = a.ofType("error")[0];
    expect(err?.code).toBe("offline");
    expect(String(err?.message)).toMatch(/doesn't exist/);
    expect(reg.pendingRings.size).toBe(0);
    expect(reg.clients.get("111111")?.ringing.size).toBe(0);
  });

  it("delivers the ring when the paged callee OPENS THE APP (register), upgrades the caller to a real Ringing ack, and the accept completes the call", async () => {
    const onPage: PageCalleeHook = async () => ({ exists: true, name: "Bob" });
    const a = register(reg, "Ana", "111111");
    handleMessage(reg, a.asConn(), { type: "invite", to: "222222", video: true }, undefined, undefined, onPage);
    await flush();
    const roomId = String(a.ofType("room")[0]?.roomId);

    // Callee opens the app from the push → registers → the held ring arrives.
    const b = register(reg, "Bob", "222222");
    const ring = b.ofType("ring")[0];
    expect(ring).toBeTruthy();
    expect(ring?.from).toBe("111111");
    expect(ring?.fromName).toBe("Ana");
    expect(ring?.roomId).toBe(roomId);
    expect(ring?.video).toBe(true); // the dialed MODE survives the redelivery
    // Caller's dial card advances from "Reaching their phone…" to Ringing….
    const acks = a.ofType("ringing");
    expect(acks.length).toBeGreaterThanOrEqual(2);
    expect(acks[acks.length - 1]?.paging).toBeUndefined();

    // And the answer path is the normal one.
    handleMessage(reg, b.asConn(), { type: "accept", roomId }, undefined, undefined, onPage);
    expect(b.ofType("joined").length).toBe(1);
    expect(a.ofType("peer-joined")[0]?.pin).toBe("222222");
    // Answered → the pending ring must never redeliver again.
    expect(reg.pendingRings.has("222222")).toBe(false);
  });

  it("caller hangs up first → pending ring cleared + miss recorded; the callee's later open gets NO ghost ring", async () => {
    const misses: Array<{ calleePin: string; reason: string }> = [];
    const onPage: PageCalleeHook = async () => ({ exists: true, name: "Bob" });
    const onMissed: MissedCallHook = (i) => misses.push({ calleePin: i.calleePin, reason: i.reason });
    const a = register(reg, "Ana", "111111", undefined, { onMissed, onPage });
    handleMessage(reg, a.asConn(), { type: "invite", to: "222222" }, undefined, onMissed, onPage);
    await flush();
    handleMessage(reg, a.asConn(), { type: "leave" }, undefined, onMissed, onPage);
    expect(reg.pendingRings.size).toBe(0);
    expect(misses).toEqual([{ calleePin: "222222", reason: "cancelled" }]);
    const b = register(reg, "Bob", "222222");
    expect(b.ofType("ring").length).toBe(0);
  });

  it("treats a DEAD-BUT-IN-GRACE callee socket like an offline device (pages instead of ringing into the void)", async () => {
    const onPage: PageCalleeHook = async () => ({ exists: true, name: "Bob" });
    // Bob was registered, then his phone locked → SSE closed, record in grace.
    const b = register(reg, "Bob", "222222", "cid-bob");
    b.socket.close();
    const a = register(reg, "Ana", "111111");
    handleMessage(reg, a.asConn(), { type: "invite", to: "222222" }, undefined, undefined, onPage);
    await flush();
    // The old behavior safeSend()'d the ring into the closed stream and acked a
    // fake "Ringing…". Now: paging ack + redeliverable pending ring.
    expect(a.ofType("ringing")[0]?.paging).toBe(true);
    expect(b.ofType("ring").length).toBe(0);
    // Bob's app comes back (same cid reconnect + re-register) → ring delivered.
    const b2 = register(reg, "Bob", "222222", "cid-bob");
    expect(b2.ofType("ring")[0]?.from).toBe("111111");
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
