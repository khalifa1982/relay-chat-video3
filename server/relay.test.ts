import { describe, expect, it, beforeEach } from "vitest";
import {
  createRegistry,
  handleMessage,
  leaveRoom,
  iceServers,
  type RelayRegistry,
  type RelaySocket,
} from "./relay";

/**
 * Minimal stub that mimics the `RelaySocket` shape (`send(obj)` + `close()`).
 * The relay's protocol layer is transport-agnostic, so the test doubles can
 * just collect outbound messages in an array.
 */
type Sent = unknown;
class FakeConn {
  outbox: Sent[] = [];
  pin: string | null = null;
  socket: RelaySocket;
  constructor() {
    this.socket = {
      send: (obj: unknown) => {
        this.outbox.push(obj);
      },
      close: () => {},
    };
  }
  setPin = (p: string) => {
    this.pin = p;
  };
  last(): Sent | undefined {
    return this.outbox[this.outbox.length - 1];
  }
  asConn() {
    return { socket: this.socket, pin: this.pin, setPin: this.setPin };
  }
}

function register(reg: RelayRegistry, name: string, requestedPin?: string) {
  const c = new FakeConn();
  handleMessage(reg, c.asConn(), { type: "register", name, pin: requestedPin });
  // `setPin` mutates the conn; pull it back out so subsequent calls see it.
  return c;
}

describe("relay signaling", () => {
  let reg: RelayRegistry;

  beforeEach(() => {
    reg = createRegistry();
  });

  it("issues STUN-only ICE servers when TURN env vars are unset", () => {
    const list = iceServers("user-1");
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(
      list.every(s => !s.urls.startsWith("turn:") && !s.urls.startsWith("turns:"))
    ).toBe(true);
  });

  it("registers a client and assigns a 6-digit pin", () => {
    const c = register(reg, "Alice");
    const last = c.last() as { type: string; pin: string; name: string };
    expect(last.type).toBe("registered");
    expect(last.name).toBe("Alice");
    expect(last.pin).toMatch(/^\d{6}$/);
    expect(reg.clients.has(last.pin)).toBe(true);
    expect(c.pin).toBe(last.pin);
  });

  it("ignores a duplicate register for the same connection", () => {
    const c = register(reg, "Alice");
    const firstPin = (c.last() as { pin: string }).pin;
    handleMessage(reg, c.asConn(), { type: "register", name: "Alice2" });
    const registers = c.outbox.filter(
      (m): m is { type: string } =>
        typeof m === "object" && m !== null && (m as { type: string }).type === "registered"
    );
    expect(registers).toHaveLength(1);
    expect(reg.clients.get(firstPin)?.name).toBe("Alice");
  });

  it("rejects calling your own number", () => {
    const c = register(reg, "Alice");
    const pin = (c.last() as { pin: string }).pin;
    c.outbox.length = 0;
    handleMessage(reg, c.asConn(), { type: "invite", to: pin });
    const last = c.last() as { type: string; code: string };
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
    handleMessage(reg, a.asConn(), { type: "invite", to: bPin });

    const room = a.outbox.find((m): m is { type: string; roomId: string } =>
      typeof m === "object" && m !== null && (m as { type: string }).type === "room"
    );
    expect(room?.roomId).toBeTruthy();

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
    handleMessage(reg, a.asConn(), { type: "invite", to: bPin });
    const roomId = (a.outbox.find(
      (m): m is { type: string; roomId: string } =>
        typeof m === "object" && m !== null && (m as { type: string }).type === "room"
    ) as { roomId: string }).roomId;

    a.outbox.length = 0;
    b.outbox.length = 0;
    handleMessage(reg, b.asConn(), { type: "accept", roomId });

    const joined = b.last() as {
      type: string;
      roomId: string;
      members: { pin: string; name: string }[];
    };
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
    handleMessage(reg, a.asConn(), { type: "signal", to: bPin, data: { sdp } });
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

    handleMessage(reg, a.asConn(), { type: "invite", to: bPin });
    const roomId = (a.outbox.find(
      (m): m is { type: string; roomId: string } =>
        typeof m === "object" && m !== null && (m as { type: string }).type === "room"
    ) as { roomId: string }).roomId;
    handleMessage(reg, b.asConn(), { type: "accept", roomId });

    c.outbox.length = 0;
    handleMessage(reg, c.asConn(), { type: "invite", to: bPin });
    const last = c.last() as { type: string; from: string };
    expect(last.type).toBe("busy");
    expect(last.from).toBe(bPin);
    expect(reg.clients.get(cPin)).toBeTruthy();
  });

  it("notifies remaining peers when one leaves the room", () => {
    const a = register(reg, "Alice");
    const b = register(reg, "Bob");
    const aPin = (a.last() as { pin: string }).pin;
    const bPin = (b.last() as { pin: string }).pin;
    handleMessage(reg, a.asConn(), { type: "invite", to: bPin });
    const roomId = (a.outbox.find(
      (m): m is { type: string; roomId: string } =>
        typeof m === "object" && m !== null && (m as { type: string }).type === "room"
    ) as { roomId: string }).roomId;
    handleMessage(reg, b.asConn(), { type: "accept", roomId });

    a.outbox.length = 0;
    leaveRoom(reg, bPin);
    const left = a.last() as { type: string; pin: string };
    expect(left.type).toBe("peer-left");
    expect(left.pin).toBe(bPin);
    expect(reg.rooms.get(roomId)?.size).toBe(1);
    expect(reg.rooms.get(roomId)?.has(aPin)).toBe(true);
  });
});
