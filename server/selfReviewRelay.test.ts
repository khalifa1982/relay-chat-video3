import { describe, expect, it, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createRegistry, handleMessage, leaveRoom, roleOf, type RelayRegistry, type RelaySocket } from "./relay";

/**
 * v2.99.47 — behavioural coverage for the SECOND self-review round's call-path
 * items. These are regressions and half-closures in MY OWN earlier fixes, so
 * they are tested against the real signaling handler rather than pinned by
 * source shape wherever the harness can reach them.
 *
 * M53  host SUCCESSION — M45's `room.has(approver)` gate was right, but with a
 *      `hostPin` that never moved it made History's "Join" a silent dead end.
 * M54  every reachability reply names its invitee (`pin`), or a group dial hangs.
 * M55  the offline-dial throttle no longer claims "offline" for an unresolved
 *      number (which offered voicemail for a number that may not exist).
 * M56  a refused knock approve/deny REPLIES, with a code that can't hang up the
 *      approver's own call.
 */

type Sent = Record<string, unknown>;
class FakeConn {
  outbox: Sent[] = [];
  pin: string | null = null;
  socket: RelaySocket;
  constructor() {
    this.socket = { send: (o: unknown) => this.outbox.push(o as Sent), close: () => {} };
  }
  setPin = (p: string) => { this.pin = p; };
  asConn() { return { socket: this.socket, pin: this.pin, setPin: this.setPin, cid: undefined }; }
  find(t: string) { return this.outbox.find((m) => m.type === t); }
  has(t: string) { return this.outbox.some((m) => m.type === t); }
  clear() { this.outbox.length = 0; }
}

function register(reg: RelayRegistry, name: string) {
  const c = new FakeConn();
  handleMessage(reg, c.asConn(), { type: "register", name });
  return c;
}
function roomIdOf(c: FakeConn): string {
  return (c.outbox.find((m) => m.type === "room") as { roomId: string }).roomId;
}

describe("M53 — the host role follows the call, not the original creator", () => {
  let reg: RelayRegistry;
  beforeEach(() => { reg = createRegistry(); });

  /** Host A + B + C all in one room (A dialed B, then added C). */
  function threeWay() {
    const a = register(reg, "Alice");
    const b = register(reg, "Bob");
    const c = register(reg, "Carol");
    handleMessage(reg, a.asConn(), { type: "invite", to: b.pin! });
    const rid = roomIdOf(a);
    handleMessage(reg, b.asConn(), { type: "accept", roomId: rid });
    handleMessage(reg, a.asConn(), { type: "invite", to: c.pin! });
    handleMessage(reg, c.asConn(), { type: "accept", roomId: rid });
    return { a, b, c, rid };
  }

  it("promotes a remaining member when the host leaves", () => {
    const { a, b, rid } = threeWay();
    expect(reg.roomMeta.get(rid)?.hostPin).toBe(a.pin);
    b.clear();
    handleMessage(reg, a.asConn(), { type: "leave" });
    const meta = reg.roomMeta.get(rid);
    expect(meta?.hostPin).not.toBe(a.pin);
    // Whoever inherited it is a member who is still connected.
    expect(reg.rooms.get(rid)?.has(meta!.hostPin!)).toBe(true);
    expect(reg.clients.has(meta!.hostPin!)).toBe(true);
    // The room is told, so clients render the new host's controls.
    const role = b.outbox.find((m) => m.type === "role" && m.role === "host");
    expect(role?.hostPin).toBe(meta?.hostPin);
  });

  it("prefers an existing CO-HOST over an ordinary member", () => {
    const { a, b, c, rid } = threeWay();
    // Alice promotes Carol (the LAST joiner, so insertion order would not pick her).
    handleMessage(reg, a.asConn(), { type: "mod", action: "cohost", target: c.pin! });
    expect(roleOf(reg.roomMeta.get(rid), c.pin!)).toBe("cohost");
    handleMessage(reg, a.asConn(), { type: "leave" });
    expect(reg.roomMeta.get(rid)?.hostPin).toBe(c.pin);
    // …and the successor is host outright, not host-and-co-host.
    expect(reg.roomMeta.get(rid)?.cohosts.has(c.pin!)).toBe(false);
    expect(b.pin).toBeTruthy();
  });

  it("does nothing when a NON-host leaves", () => {
    const { a, b, rid } = threeWay();
    handleMessage(reg, b.asConn(), { type: "leave" });
    expect(reg.roomMeta.get(rid)?.hostPin).toBe(a.pin);
  });

  it("leaves no host when only ghosts remain (never hands the role to a dead pin)", () => {
    const { a, b, c, rid } = threeWay();
    // B and C lose their client records but keep membership (the mid-call
    // disconnect case the registry deliberately models).
    reg.clients.delete(b.pin!);
    reg.clients.delete(c.pin!);
    handleMessage(reg, a.asConn(), { type: "leave" });
    const host = reg.roomMeta.get(rid)?.hostPin;
    if (host) expect(reg.clients.has(host)).toBe(true);
  });

  it("the promotion survives a direct leaveRoom() (the kick / reap path)", () => {
    const { a, rid } = threeWay();
    leaveRoom(reg, a.pin!);
    expect(reg.roomMeta.get(rid)?.hostPin).not.toBe(a.pin);
  });

  /**
   * THE EXACT M45 DEAD END. Carol drops out, then the original host (Alice)
   * leaves but stays signed in. Carol taps History's "Live now · Join" on Bob's
   * number — Bob is still in the call, so the room resolves.
   *
   * Before this fix `hostPin` was still Alice: her client record exists, so the
   * prompt went to HER, and her Approve tap hit M45's `room.has(approver)` gate
   * and returned silently — Carol waited on "Asked the host to let you in…"
   * forever with nobody able to admit her. Now Bob inherited the role and the
   * rejoin completes.
   */
  it("a rejoin knock is answered by the SUCCESSOR host, not left hanging", () => {
    const { a, b, c, rid } = threeWay();
    handleMessage(reg, c.asConn(), { type: "leave" });
    handleMessage(reg, a.asConn(), { type: "leave" });
    expect(reg.roomMeta.get(rid)!.hostPin).toBe(b.pin); // succession happened
    b.clear(); c.clear();
    handleMessage(reg, c.asConn(), { type: "knock", to: b.pin! });
    expect(b.find("knock")?.fromPin).toBe(c.pin);
    expect(c.find("knock-result")?.reason).toBe("pending");
    // …and the successor's approval actually admits her.
    handleMessage(reg, b.asConn(), { type: "knock-approve", roomId: rid, pin: c.pin! });
    expect(c.has("joined")).toBe(true);
    expect(reg.rooms.get(rid)?.has(c.pin!)).toBe(true);
    expect(a.pin).toBeTruthy();
  });

  /**
   * The companion guarantee: when the host is genuinely absent from the room
   * (an older room whose meta predates succession, or a room left with only
   * ghosts), the knock is REFUSED up front instead of prompting someone who
   * cannot act. Either way the knocker gets an answer.
   */
  it("refuses the knock when no present moderator can honour it", () => {
    const { a, b, c, rid } = threeWay();
    handleMessage(reg, c.asConn(), { type: "leave" });
    // Force the pre-succession shape: host names a pin no longer in the room.
    reg.roomMeta.get(rid)!.hostPin = a.pin;
    reg.rooms.get(rid)!.delete(a.pin!);
    c.clear(); a.clear();
    handleMessage(reg, c.asConn(), { type: "knock", to: b.pin! });
    expect(a.has("knock")).toBe(false);
    expect(c.find("knock-result")?.reason).toBe("gone");
  });
});

describe("M56 — a refused knock approve/deny always replies", () => {
  let reg: RelayRegistry;
  beforeEach(() => { reg = createRegistry(); });

  it("tells an approver who has left the call, with a NON-fatal code", () => {
    const a = register(reg, "Alice");
    const b = register(reg, "Bob");
    handleMessage(reg, a.asConn(), { type: "invite", to: b.pin! });
    const rid = roomIdOf(a);
    handleMessage(reg, b.asConn(), { type: "accept", roomId: rid });
    handleMessage(reg, b.asConn(), { type: "leave" });
    handleMessage(reg, b.asConn(), { type: "knock", to: a.pin! });
    handleMessage(reg, a.asConn(), { type: "leave" }); // host gone; role moved
    a.clear();
    handleMessage(reg, a.asConn(), { type: "knock-approve", roomId: rid, pin: b.pin! });
    const err = a.find("error") as { code?: string } | undefined;
    expect(err?.code).toBe("knockfail");
    // `forbidden`/`gone` are fatal to a peerless call on the client — using one
    // here could hang up the approver's own call.
    expect(err?.code).not.toBe("forbidden");
    expect(err?.code).not.toBe("gone");
  });

  it("tells a moderator whose pending knock already resolved", () => {
    const a = register(reg, "Alice");
    const b = register(reg, "Bob");
    handleMessage(reg, a.asConn(), { type: "invite", to: b.pin! });
    const rid = roomIdOf(a);
    handleMessage(reg, b.asConn(), { type: "accept", roomId: rid });
    a.clear();
    // No knock is pending at all.
    handleMessage(reg, a.asConn(), { type: "knock-approve", roomId: rid, pin: b.pin! });
    expect((a.find("error") as { code?: string } | undefined)?.code).toBe("knockfail");
  });
});

/* ── source-pinned: the offline branch runs behind an async identity resolver
      the harness can't drive, so these two assert the emitted shapes. ─────── */

describe("M54/M55 — every reachability reply names its invitee, honestly", () => {
  const RELAY = fs.readFileSync(path.resolve(__dirname, "relay.ts"), "utf8");

  it("no `error` reply in the invite path omits `pin`", () => {
    const invite = RELAY.slice(RELAY.indexOf('case "invite"'), RELAY.indexOf('case "accept"'));
    const codes = invite.match(/code: "(offline|nonexistent|unavailable)"/g) ?? [];
    expect(codes.length).toBeGreaterThanOrEqual(5);
    // Every reachability code in this block is accompanied by a pin.
    for (const m of invite.matchAll(/code: "(?:offline|nonexistent|unavailable)",?\s*(?:\n\s*)?([^\n]*)/g)) {
      expect(m[1], `reply missing pin: ${m[0].slice(0, 80)}`).toMatch(/pin/);
    }
  });

  it("the throttled dial uses its own code, not a claim that they're offline", () => {
    const seg = RELAY.slice(RELAY.indexOf("offlineDialLimiter.allow"), RELAY.indexOf("onPageCallee({"));
    expect(seg).toMatch(/code: "unavailable"/);
    expect(seg).not.toMatch(/code: "offline"/);
  });

  it("the client treats `unavailable` as unreachable but NOT voicemail-eligible", () => {
    const CLIENT = fs.readFileSync(
      path.resolve(__dirname, "..", "client", "src", "lib", "relayClient.ts"),
      "utf8",
    );
    expect(CLIENT).toMatch(/m\.code === "unavailable"/);
    const vm = CLIENT.slice(CLIENT.indexOf("Voicemail-eligible outcomes"), CLIENT.indexOf("setCallStatus(\"calling\", message)"));
    expect(vm).toMatch(/reason === "server-error:offline"/);
    expect(vm).not.toMatch(/reason === "server-error:unavailable"/);
  });
});
