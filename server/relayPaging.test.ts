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
 * TWO OWNER DIRECTIVES THAT READ AS OPPOSITES, AND THE ONE RULE THAT SATISFIES
 * BOTH. v2.99.11: "if the user is offline it should NOT ring automatically —
 * tell the caller he's offline; you can leave an SMS or voice message", which
 * retired the v2.83 paging model. v2.105.12: "build the incoming-call push path
 * and restore ringing", so a closed or locked phone rings like WhatsApp's does.
 *
 * The relay now pages ONLY when a push ACTUALLY REACHED a device (`pushed > 0`
 * from the hook). So:
 *   • a phone with the app installed → PAGE: dial held open, ring redeliverable,
 *     caller told "Reaching their phone…" via ringing{paging:true}.
 *   • nobody reachable → the v2.99.11 behaviour, unchanged: fast honest
 *     error{offline}, miss recorded, leave-a-message card.
 * A hook that omits `pushed` reads as 0, which is why every pre-v2.105.12 case
 * below still describes current behaviour rather than having been rewritten.
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

  it("a REAL but unreachable number whose hook omits `pushed` still fails fast (the additive default)", async () => {
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

  // ── v2.105.12: ringing restored, gated on the push actually landing ──────

  /** A hook standing in for a callee whose phone WAS woken by a push. */
  const wokeOneDevice: PageCalleeHook = async () => ({ exists: true, name: "Bob", pushed: 1 });

  it("a push that REACHED a device pages: dial held open, ring redeliverable, no miss yet", async () => {
    const misses: string[] = [];
    const a = register(reg, "Ana", "111111");
    handleMessage(reg, a.asConn(), { type: "invite", to: "222222" }, undefined, (i) => misses.push(i.calleePin), wokeOneDevice);
    await flush();
    // NOT an error — the caller stays on the dial.
    expect(a.ofType("error").length).toBe(0);
    const ack = a.ofType("ringing")[0];
    expect(ack?.pin).toBe("222222");
    // `paging` is what makes the caller's status line honest: the push has been
    // sent but nothing is audibly ringing yet.
    expect(ack?.paging).toBe(true);
    // The ring must be REDELIVERABLE, or opening the app finds nothing to answer.
    const pr = reg.pendingRings.get("222222");
    expect(pr?.from).toBe("111111");
    expect(pr?.roomId).toBeTruthy();
    // deliverPendingRing refuses a ring the caller is no longer offering, so the
    // caller's own bookkeeping has to name the callee too.
    expect(reg.clients.get("111111")?.ringing.has("222222")).toBe(true);
    // NO miss is recorded yet — the call is still ringing. Recording one here
    // would put a missed call in History for a call about to be answered.
    expect(misses).toEqual([]);
  });

  it("the paging room is the one a late accept joins — so the callee can actually answer", async () => {
    const a = register(reg, "Ana", "111111");
    handleMessage(reg, a.asConn(), { type: "invite", to: "222222" }, undefined, undefined, wokeOneDevice);
    await flush();
    const room = String(reg.pendingRings.get("222222")?.roomId);
    // THE POINT OF CARRYING A ROOM IN THE PUSH. Bob's phone rang, he opens the
    // app: registering delivers the ring, and accepting the room connects.
    const b = register(reg, "Bob", "222222", "cid-bob");
    expect(b.ofType("ring")[0]?.roomId).toBe(room);
    handleMessage(reg, b.asConn(), { type: "accept", roomId: room });
    expect(b.ofType("joined").length).toBe(1);
    expect(a.ofType("peer-joined")[0]?.pin).toBe("222222");
  });

  it("the late ring UPGRADES the caller's card from paging to a real Ringing…", async () => {
    const a = register(reg, "Ana", "111111");
    handleMessage(reg, a.asConn(), { type: "invite", to: "222222" }, undefined, undefined, wokeOneDevice);
    await flush();
    expect(a.ofType("ringing")[0]?.paging).toBe(true);
    register(reg, "Bob", "222222", "cid-bob");
    // A SECOND ack, this one WITHOUT `paging` — the client re-labels in place.
    const acks = a.ofType("ringing");
    expect(acks.length).toBe(2);
    expect(acks[1]?.paging).toBeFalsy();
  });

  it("pushed:0 (no subscription / push switched off) keeps the FAST offline bounce", async () => {
    // The half of v2.99.11 worth keeping: paging somebody nothing can wake would
    // sit the caller on "Reaching their phone…" for 65s to no purpose.
    const misses: string[] = [];
    const a = register(reg, "Ana", "111111");
    handleMessage(
      reg, a.asConn(), { type: "invite", to: "222222" }, undefined,
      (i) => misses.push(i.calleePin),
      async () => ({ exists: true, name: "Bob", pushed: 0 }),
    );
    await flush();
    expect(a.ofType("error")[0]?.code).toBe("offline");
    expect(a.ofType("ringing").length).toBe(0);
    expect(reg.pendingRings.size).toBe(0);
    expect(misses).toEqual(["222222"]);
  });

  it("a NONEXISTENT number never pages, however the hook is shaped", async () => {
    const a = register(reg, "Ana", "111111");
    handleMessage(reg, a.asConn(), { type: "invite", to: "999999" }, undefined, undefined,
      // `pushed` on a non-existent identity is nonsense; existence must win.
      async () => ({ exists: false, pushed: 3 }));
    await flush();
    expect(a.ofType("error")[0]?.code).toBe("nonexistent");
    expect(reg.pendingRings.size).toBe(0);
  });

  it("an UNVERIFIED caller gets no NAME in the paging ack", async () => {
    // Same reasoning as the offline reply (v2.99.49): a named ack reachable by
    // probing the number space turns existence-checking into name-harvesting.
    // This path is reachable by the same probe, so it withholds the same field.
    const a = register(reg, "Ana", "111111");
    const rec = reg.clients.get("111111")!;
    rec.verifiedPin = false;
    handleMessage(reg, a.asConn(), { type: "invite", to: "222222" }, undefined, undefined, wokeOneDevice);
    await flush();
    const ack = a.ofType("ringing")[0];
    expect(ack?.paging).toBe(true);
    expect(ack?.name).toBeUndefined();
  });

  it("a HANG-UP while the hook awaits leaves NO pending ring behind", async () => {
    // The epoch guard. Without it a slow push resolving after the caller gave up
    // would register a ring for a dial that no longer exists — the callee's phone
    // would ring for nobody.
    const a = register(reg, "Ana", "111111");
    let release: (() => void) | null = null;
    const slow: PageCalleeHook = () =>
      new Promise((res) => { release = () => res({ exists: true, name: "Bob", pushed: 1 }); });
    handleMessage(reg, a.asConn(), { type: "invite", to: "222222" }, undefined, undefined, slow);
    handleMessage(reg, a.asConn(), { type: "leave" });
    release!();
    await flush();
    expect(reg.pendingRings.size).toBe(0);
    expect(a.ofType("ringing").length).toBe(0);
  });

  it("a paged ring still expires — a phone opened much later does not ring", async () => {
    const a = register(reg, "Ana", "111111");
    handleMessage(reg, a.asConn(), { type: "invite", to: "222222" }, undefined, undefined, wokeOneDevice);
    await flush();
    const pr = reg.pendingRings.get("222222")!;
    reg.pendingRings.set("222222", { ...pr, at: Date.now() - PENDING_RING_TTL_MS - 1000 });
    const b = register(reg, "Bob", "222222", "cid-bob");
    expect(b.ofType("ring").length).toBe(0);
    expect(reg.pendingRings.has("222222")).toBe(false);
  });

  it("the caller hanging up on a paged dial cancels the ring and records the miss", async () => {
    const misses: Array<{ pin: string; reason: string }> = [];
    const onMissed: MissedCallHook = (i) => misses.push({ pin: i.calleePin, reason: i.reason });
    const a = register(reg, "Ana", "111111");
    handleMessage(reg, a.asConn(), { type: "invite", to: "222222" }, undefined, onMissed, wokeOneDevice);
    await flush();
    expect(reg.pendingRings.has("222222")).toBe(true);
    // The hook belongs on the LEAVE too — this is the call the `leave` handler
    // makes, and it is the one that turns an abandoned page into a missed call.
    handleMessage(reg, a.asConn(), { type: "leave" }, undefined, onMissed);
    // Now the miss lands — deferred from the page to the give-up, which is when
    // the call was actually missed.
    expect(reg.pendingRings.has("222222")).toBe(false);
    expect(misses).toEqual([{ pin: "222222", reason: "cancelled" }]);
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
