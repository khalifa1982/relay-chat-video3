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

  it("includes both STUN and the free public TURN fallback when TURN env vars are unset", () => {
    // Make sure env is clean for this case.
    const prevSecret = process.env.TURN_SECRET;
    const prevHost = process.env.TURN_HOST;
    delete process.env.TURN_SECRET;
    delete process.env.TURN_HOST;
    try {
      const list = iceServers("user-1");
      // Should have at least one public STUN server.
      expect(list.some(s => s.urls.startsWith("stun:"))).toBe(true);
      // Should also include the free public TURN fallback so strict-NAT users
      // can connect without operator-run coturn.
      expect(list.some(s => s.urls.startsWith("turn:") || s.urls.startsWith("turns:")))
        .toBe(true);
      // Public TURN must come with credentials.
      const anyTurn = list.find(s => s.urls.startsWith("turn:"));
      expect(anyTurn?.username).toBeTruthy();
      expect(anyTurn?.credential).toBeTruthy();
    } finally {
      if (prevSecret !== undefined) process.env.TURN_SECRET = prevSecret;
      if (prevHost !== undefined) process.env.TURN_HOST = prevHost;
    }
  });

  it("issues HMAC-signed short-lived TURN credentials when TURN_SECRET + TURN_HOST are set", () => {
    const prevSecret = process.env.TURN_SECRET;
    const prevHost = process.env.TURN_HOST;
    process.env.TURN_SECRET = "test-secret";
    process.env.TURN_HOST = "turn.example.com";
    try {
      const list = iceServers("user-42");
      // At least one operator TURN entry must point at our host.
      const ours = list.filter(s => s.urls.includes("turn.example.com"));
      expect(ours.length).toBeGreaterThan(0);
      // Each operator TURN entry has username + credential.
      ours.forEach(s => {
        expect(s.username).toBeTruthy();
        expect(s.credential).toBeTruthy();
        // Username format: <unix-ts>:<user>
        expect(s.username).toMatch(/^\d+:user-42$/);
      });
    } finally {
      if (prevSecret !== undefined) process.env.TURN_SECRET = prevSecret; else delete process.env.TURN_SECRET;
      if (prevHost !== undefined) process.env.TURN_HOST = prevHost; else delete process.env.TURN_HOST;
    }
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

  // ===== v1.3 regression tests — phantom-busy, leaked-room, per-call ICE =====

  it("does not flag a solo dialing caller as busy to a third party", () => {
    const a = register(reg, "Alice");
    const b = register(reg, "Bob");
    const c = register(reg, "Carol");
    const aPin = (a.last() as { pin: string }).pin;
    const bPin = (b.last() as { pin: string }).pin;
    const cPin = (c.last() as { pin: string }).pin;

    handleMessage(reg, a.asConn(), { type: "invite", to: bPin });

    a.outbox.length = 0;
    c.outbox.length = 0;
    handleMessage(reg, c.asConn(), { type: "invite", to: aPin });

    expect(
      c.outbox.some(m => (m as { type?: string }).type === "busy")
    ).toBe(false);
    const ring = a.outbox.find(
      (m): m is { type: string; from: string } =>
        typeof m === "object" && m !== null &&
        (m as { type: string }).type === "ring"
    );
    expect(ring?.from).toBe(cPin);
  });

  it("tears down the caller's solo dialing room when the callee rejects", () => {
    const a = register(reg, "Alice");
    const b = register(reg, "Bob");
    const aPin = (a.last() as { pin: string }).pin;
    const bPin = (b.last() as { pin: string }).pin;

    handleMessage(reg, a.asConn(), { type: "invite", to: bPin });
    const roomId = (a.outbox.find(
      (m): m is { type: string; roomId: string } =>
        typeof m === "object" && m !== null &&
        (m as { type: string }).type === "room"
    ) as { roomId: string }).roomId;
    expect(reg.rooms.has(roomId)).toBe(true);

    a.outbox.length = 0;
    handleMessage(reg, b.asConn(), { type: "reject", to: aPin });

    const rejected = a.last() as { type: string; from: string };
    expect(rejected.type).toBe("rejected");
    expect(rejected.from).toBe(bPin);
    expect(reg.rooms.has(roomId)).toBe(false);
    expect(reg.clients.get(aPin)?.roomId).toBe(null);
  });

  it("ships fresh iceServers on joined and peer-joined so creds never go stale", () => {
    const a = register(reg, "Alice");
    const b = register(reg, "Bob");
    const bPin = (b.last() as { pin: string }).pin;
    handleMessage(reg, a.asConn(), { type: "invite", to: bPin });
    const roomId = (a.outbox.find(
      (m): m is { type: string; roomId: string } =>
        typeof m === "object" && m !== null &&
        (m as { type: string }).type === "room"
    ) as { roomId: string }).roomId;

    a.outbox.length = 0;
    b.outbox.length = 0;
    handleMessage(reg, b.asConn(), { type: "accept", roomId });

    const joined = b.last() as { type: string; iceServers?: unknown[] };
    expect(joined.type).toBe("joined");
    expect(Array.isArray(joined.iceServers)).toBe(true);
    expect(joined.iceServers!.length).toBeGreaterThan(0);

    const peerJoined = a.last() as { type: string; iceServers?: unknown[] };
    expect(peerJoined.type).toBe("peer-joined");
    expect(Array.isArray(peerJoined.iceServers)).toBe(true);
  });

  it("answers refresh-ice with a fresh ice payload for a registered client", () => {
    const a = register(reg, "Alice");
    a.outbox.length = 0;

    handleMessage(reg, a.asConn(), { type: "refresh-ice" });

    const reply = a.last() as { type: string; iceServers?: unknown[] };
    expect(reply.type).toBe("ice");
    expect(Array.isArray(reply.iceServers)).toBe(true);
    expect(reply.iceServers!.length).toBeGreaterThan(0);
  });

  it("ignores refresh-ice from a connection that hasn't registered", () => {
    const c = new FakeConn();
    handleMessage(reg, c.asConn(), { type: "refresh-ice" });
    expect(c.outbox).toHaveLength(0);
  });

  it("issues operator TURN creds via refresh-ice when TURN env is set", () => {
    const prevSecret = process.env.TURN_SECRET;
    const prevHost = process.env.TURN_HOST;
    process.env.TURN_SECRET = "test-secret";
    process.env.TURN_HOST = "turn.example.com";
    try {
      const a = register(reg, "Alice");
      const aPin = (a.last() as { pin: string }).pin;
      a.outbox.length = 0;

      handleMessage(reg, a.asConn(), { type: "refresh-ice" });

      const reply = a.last() as {
        type: string;
        iceServers: Array<{ urls: string; username?: string; credential?: string }>;
      };
      expect(reply.type).toBe("ice");
      const ours = reply.iceServers.filter(s => s.urls.includes("turn.example.com"));
      expect(ours.length).toBeGreaterThan(0);
      ours.forEach(s => {
        expect(s.username).toMatch(new RegExp("^\\d+:" + aPin + "$"));
        expect(s.credential).toBeTruthy();
      });
    } finally {
      if (prevSecret !== undefined) process.env.TURN_SECRET = prevSecret; else delete process.env.TURN_SECRET;
      if (prevHost !== undefined) process.env.TURN_HOST = prevHost; else delete process.env.TURN_HOST;
    }
  });
});
