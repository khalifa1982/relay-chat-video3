import { describe, expect, it, beforeEach } from "vitest";
import { EventEmitter } from "events";
import {
  createRegistry,
  handleMessage,
  leaveRoom,
  iceServers,
  type RelayRegistry,
} from "./relay";

/**
 * Minimal stub that mimics the parts of `ws.WebSocket` used by `relay.ts`:
 *   - `readyState === 1` so `safeSend` proceeds
 *   - `send(json)` captures the outbound message
 *   - extra fields (`pin`, `isAlive`) match the augmented type
 */
type Sent = unknown;
class FakeSocket extends EventEmitter {
  readyState = 1;
  pin: string | null = null;
  isAlive = true;
  outbox: Sent[] = [];
  send(payload: string) {
    try {
      this.outbox.push(JSON.parse(payload));
    } catch {
      this.outbox.push(payload);
    }
  }
  ping() {}
  terminate() {}
  last(): Sent | undefined {
    return this.outbox[this.outbox.length - 1];
  }
}

function register(reg: RelayRegistry, name: string, requestedPin?: string) {
  const ws = new FakeSocket();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handleMessage(reg, ws as any, { type: "register", name, pin: requestedPin });
  return ws;
}

describe("relay signaling", () => {
  let reg: RelayRegistry;

  beforeEach(() => {
    reg = createRegistry();
  });

  it("issues STUN-only ICE servers when TURN env vars are unset", () => {
    const list = iceServers("user-1");
    expect(list.length).toBeGreaterThanOrEqual(1);
    // No TURN entry without TURN_HOST + TURN_SECRET.
    expect(list.every(s => !s.urls.startsWith("turn:") && !s.urls.startsWith("turns:"))).toBe(
      true
    );
  });

  it("registers a client and assigns a 6-digit pin", () => {
    const ws = register(reg, "Alice");
    const last = ws.last() as { type: string; pin: string; name: string };
    expect(last.type).toBe("registered");
    expect(last.name).toBe("Alice");
    expect(last.pin).toMatch(/^\d{6}$/);
    expect(reg.clients.has(last.pin)).toBe(true);
  });

  it("ignores a duplicate register for the same socket", () => {
    const ws = register(reg, "Alice");
    const firstPin = (ws.last() as { pin: string }).pin;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handleMessage(reg, ws as any, { type: "register", name: "Alice2" });
    // Still only the original "registered" message (no second one).
    const registers = ws.outbox.filter(
      (m): m is { type: string } => typeof m === "object" && m !== null && (m as { type: string }).type === "registered"
    );
    expect(registers).toHaveLength(1);
    expect(reg.clients.get(firstPin)?.name).toBe("Alice");
  });

  it("rejects calling your own number", () => {
    const ws = register(reg, "Alice");
    const pin = (ws.last() as { pin: string }).pin;
    ws.outbox.length = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handleMessage(reg, ws as any, { type: "invite", to: pin });
    const last = ws.last() as { type: string; code: string };
    expect(last.type).toBe("error");
    expect(last.code).toBe("self");
  });

  it("rings an online peer and creates a room for the caller", () => {
    const a = register(reg, "Alice");
    const b = register(reg, "Bob");
    const aPin = (a.last() as { pin: string }).pin;
    const bPin = (b.last() as { pin: string }).pin;
    a.outbox.length = 0;
    b.outbox.length = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handleMessage(reg, a as any, { type: "invite", to: bPin });

    // Caller learns its room id.
    const room = a.outbox.find((m): m is { type: string; roomId: string } =>
      typeof m === "object" && m !== null && (m as { type: string }).type === "room"
    );
    expect(room?.roomId).toBeTruthy();

    // Callee receives a ring.
    const ring = b.outbox.find((m): m is { type: string; from: string; roomId: string } =>
      typeof m === "object" && m !== null && (m as { type: string }).type === "ring"
    );
    expect(ring?.from).toBe(aPin);
    expect(ring?.roomId).toBe(room?.roomId);
  });

  it("on accept: newcomer learns existing members; existing members are notified", () => {
    const a = register(reg, "Alice");
    const b = register(reg, "Bob");
    const aPin = (a.last() as { pin: string }).pin;
    const bPin = (b.last() as { pin: string }).pin;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handleMessage(reg, a as any, { type: "invite", to: bPin });
    const roomId = (a.outbox.find(
      (m): m is { type: string; roomId: string } =>
        typeof m === "object" && m !== null && (m as { type: string }).type === "room"
    ) as { roomId: string }).roomId;

    a.outbox.length = 0;
    b.outbox.length = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handleMessage(reg, b as any, { type: "accept", roomId });

    const joined = b.last() as { type: string; roomId: string; members: { pin: string; name: string }[] };
    expect(joined.type).toBe("joined");
    expect(joined.roomId).toBe(roomId);
    expect(joined.members).toEqual([{ pin: aPin, name: "Alice" }]);

    const peerJoined = a.last() as { type: string; pin: string; name: string };
    expect(peerJoined.type).toBe("peer-joined");
    expect(peerJoined.pin).toBe(bPin);
    expect(peerJoined.name).toBe("Bob");
  });

  it("relays signal payloads only to the addressed peer", () => {
    const a = register(reg, "Alice");
    const b = register(reg, "Bob");
    const c = register(reg, "Carol");
    const bPin = (b.last() as { pin: string }).pin;
    a.outbox.length = b.outbox.length = c.outbox.length = 0;
    const sdp = { type: "offer", sdp: "v=0..." };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handleMessage(reg, a as any, { type: "signal", to: bPin, data: { sdp } });
    expect(b.outbox).toHaveLength(1);
    expect(c.outbox).toHaveLength(0);
    const relayed = b.last() as { type: string; data: { sdp: { type: string } } };
    expect(relayed.type).toBe("signal");
    expect(relayed.data.sdp.type).toBe("offer");
  });

  it("flags busy when the target is already in a different call", () => {
    const a = register(reg, "Alice");
    const b = register(reg, "Bob");
    const c = register(reg, "Carol");
    const bPin = (b.last() as { pin: string }).pin;
    const cPin = (c.last() as { pin: string }).pin;

    // A invites B, B accepts → A & B share a room.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handleMessage(reg, a as any, { type: "invite", to: bPin });
    const roomId = (a.outbox.find(
      (m): m is { type: string; roomId: string } =>
        typeof m === "object" && m !== null && (m as { type: string }).type === "room"
    ) as { roomId: string }).roomId;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handleMessage(reg, b as any, { type: "accept", roomId });

    // C now invites B → should get busy.
    c.outbox.length = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handleMessage(reg, c as any, { type: "invite", to: bPin });
    const last = c.last() as { type: string; from: string };
    expect(last.type).toBe("busy");
    expect(last.from).toBe(bPin);
    // And C still has their own pin available.
    expect(reg.clients.get(cPin)).toBeTruthy();
  });

  it("notifies remaining peers when one leaves the room", () => {
    const a = register(reg, "Alice");
    const b = register(reg, "Bob");
    const aPin = (a.last() as { pin: string }).pin;
    const bPin = (b.last() as { pin: string }).pin;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handleMessage(reg, a as any, { type: "invite", to: bPin });
    const roomId = (a.outbox.find(
      (m): m is { type: string; roomId: string } =>
        typeof m === "object" && m !== null && (m as { type: string }).type === "room"
    ) as { roomId: string }).roomId;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handleMessage(reg, b as any, { type: "accept", roomId });

    a.outbox.length = 0;
    leaveRoom(reg, bPin);
    const left = a.last() as { type: string; pin: string };
    expect(left.type).toBe("peer-left");
    expect(left.pin).toBe(bPin);
    // Room should still exist (Alice is in it) but with only A.
    expect(reg.rooms.get(roomId)?.size).toBe(1);
    expect(reg.rooms.get(roomId)?.has(aPin)).toBe(true);
  });
});
