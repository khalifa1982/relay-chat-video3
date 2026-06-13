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
  cid: string | undefined;
  constructor(cid?: string) {
    this.cid = cid;
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
    return { socket: this.socket, pin: this.pin, setPin: this.setPin, cid: this.cid };
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

  it("re-affirms the SAME pin on a duplicate register for the same connection", () => {
    // A duplicate register on an already-bound connection must NOT mint a new
    // number; it re-affirms the existing pin (used by the client after a
    // reconnect). It may also refresh the display name.
    const c = register(reg, "Alice");
    const firstPin = (c.last() as { pin: string }).pin;
    handleMessage(reg, c.asConn(), { type: "register", name: "Alice2" });
    const registers = c.outbox.filter(
      (m): m is { type: string; pin: string } =>
        typeof m === "object" && m !== null && (m as { type: string }).type === "registered"
    );
    // Both replies reference the same pin.
    expect(registers.every(r => r.pin === firstPin)).toBe(true);
    expect(c.pin).toBe(firstPin);
    expect(reg.clients.get(firstPin)?.name).toBe("Alice2");
  });

  it("sends ring-cancel to a pending callee when the caller leaves before answer", () => {
    const a = register(reg, "Alice");
    const b = register(reg, "Bob");
    handleMessage(reg, a.asConn(), { type: "invite", to: b.pin! });
    expect((b.last() as { type: string }).type).toBe("ring");
    // Alice hangs up before Bob answers → Bob's ring must be cancelled.
    handleMessage(reg, a.asConn(), { type: "leave" });
    const cancel = b.outbox.find(
      (m): m is { type: string; from: string } =>
        typeof m === "object" && m !== null && (m as { type: string }).type === "ring-cancel"
    );
    expect(cancel).toBeTruthy();
    expect(cancel!.from).toBe(a.pin);
  });

  it("does NOT ring-cancel a callee who already accepted (they get peer-left instead)", () => {
    const a = register(reg, "Alice");
    const b = register(reg, "Bob");
    handleMessage(reg, a.asConn(), { type: "invite", to: b.pin! });
    const room = a.outbox.find(
      (m): m is { type: string; roomId: string } =>
        typeof m === "object" && m !== null && (m as { type: string }).type === "room"
    )!;
    handleMessage(reg, b.asConn(), { type: "accept", roomId: room.roomId });
    b.outbox.length = 0;
    handleMessage(reg, a.asConn(), { type: "leave" });
    expect(b.outbox.some((m) => (m as { type?: string }).type === "ring-cancel")).toBe(false);
    expect(b.outbox.some((m) => (m as { type?: string }).type === "peer-left")).toBe(true);
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

  it("uses TURN_TCP_HOST for the tcp candidate when the UDP and TCP IPs differ", () => {
    const prev = {
      s: process.env.TURN_SECRET,
      h: process.env.TURN_HOST,
      t: process.env.TURN_TCP_HOST,
    };
    process.env.TURN_SECRET = "test-secret";
    process.env.TURN_HOST = "1.1.1.1";
    process.env.TURN_TCP_HOST = "2.2.2.2";
    try {
      const list = iceServers("user-7");
      const udp = list.find(s => s.urls.includes("transport=udp"));
      const tcp = list.find(s => s.urls.includes("transport=tcp"));
      expect(udp?.urls).toContain("1.1.1.1");
      expect(tcp?.urls).toContain("2.2.2.2");
    } finally {
      void 0;
    }
  });

  it("advertises a firewall-penetrating TURN-over-TCP candidate on port 443", () => {
    const prev = { s: process.env.TURN_SECRET, h: process.env.TURN_HOST, t: process.env.TURN_TCP_HOST };
    process.env.TURN_SECRET = "test-secret";
    process.env.TURN_HOST = "1.1.1.1";
    process.env.TURN_TCP_HOST = "2.2.2.2";
    try {
      const list = iceServers("user-443");
      const tcp443 = list.find(s => s.urls.includes(":443?transport=tcp"));
      expect(tcp443).toBeDefined();
      expect(tcp443?.urls).toBe("turn:2.2.2.2:443?transport=tcp");
      expect(typeof tcp443?.username).toBe("string");
      expect(typeof tcp443?.credential).toBe("string");
    } finally {
      process.env.TURN_SECRET = prev.s ?? ""; if (prev.s === undefined) delete process.env.TURN_SECRET;
      process.env.TURN_HOST = prev.h ?? ""; if (prev.h === undefined) delete process.env.TURN_HOST;
      process.env.TURN_TCP_HOST = prev.t ?? ""; if (prev.t === undefined) delete process.env.TURN_TCP_HOST;
    }
  });

  it("does NOT advertise a turns: (TLS) candidate unless TURN_TLS=1", () => {
    const prev = { s: process.env.TURN_SECRET, h: process.env.TURN_HOST, tls: process.env.TURN_TLS };
    process.env.TURN_SECRET = "test-secret";
    process.env.TURN_HOST = "1.1.1.1";
    delete process.env.TURN_TLS;
    try {
      const list = iceServers("user-9");
      expect(list.some(s => s.urls.startsWith("turns:"))).toBe(false);
    } finally {
      process.env.TURN_SECRET = prev.s ?? ""; if (prev.s === undefined) delete process.env.TURN_SECRET;
      process.env.TURN_HOST = prev.h ?? ""; if (prev.h === undefined) delete process.env.TURN_HOST;
      if (prev.tls !== undefined) process.env.TURN_TLS = prev.tls; else delete process.env.TURN_TLS;
    }
  });

  // ---- reconnect / cid-binding behaviour (the "keeps disconnecting" fix) ----

  it("reuses the same pin when a cid re-registers after its channel dropped", () => {
    // First registration on cid "tab-1".
    const c1 = new FakeConn("tab-1");
    handleMessage(reg, c1.asConn(), { type: "register", name: "Sam" });
    const pin1 = (c1.last() as { pin: string }).pin;
    expect(reg.cidToPin.get("tab-1")).toBe(pin1);

    // Simulate the SSE channel dropping then the SAME cid reconnecting and
    // re-registering. Even though the old client entry may still exist, the
    // user must keep the same number.
    const c2 = new FakeConn("tab-1");
    handleMessage(reg, c2.asConn(), { type: "register", name: "Sam" });
    const pin2 = (c2.last() as { pin: string }).pin;
    expect(pin2).toBe(pin1);
  });

  it("keeps room membership when a peer reconnects on the same cid mid-call", () => {
    // Two parties in a room.
    const a = new FakeConn("cid-a");
    handleMessage(reg, a.asConn(), { type: "register", name: "A" });
    const aPin = (a.last() as { pin: string }).pin;
    const b = new FakeConn("cid-b");
    handleMessage(reg, b.asConn(), { type: "register", name: "B" });
    const bPin = (b.last() as { pin: string }).pin;

    handleMessage(reg, a.asConn(), { type: "invite", to: bPin });
    const roomId = (a.outbox.find(
      (m): m is { type: string; roomId: string } =>
        typeof m === "object" && m !== null && (m as { type: string }).type === "room"
    ) as { roomId: string }).roomId;
    handleMessage(reg, b.asConn(), { type: "accept", roomId });
    expect(reg.clients.get(aPin)?.roomId).toBe(roomId);

    // A's channel drops but, crucially, we do NOT call leaveRoom here (the
    // server now defers cleanup behind a grace timer). A re-registers on the
    // same cid and must still be in the room with the same pin.
    const a2 = new FakeConn("cid-a");
    handleMessage(reg, a2.asConn(), { type: "register", name: "A" });
    const aPin2 = (a2.last() as { pin: string }).pin;
    expect(aPin2).toBe(aPin);
    expect(reg.clients.get(aPin)?.roomId).toBe(roomId);
    expect(reg.rooms.get(roomId)?.has(aPin)).toBe(true);
  });

  it("honours an explicit pin request from the same cid that already owns it", () => {
    const c1 = new FakeConn("cid-x");
    handleMessage(reg, c1.asConn(), { type: "register", name: "X" });
    const pin = (c1.last() as { pin: string }).pin;

    // Reconnect and explicitly ask for the same pin (mirrors client behaviour).
    const c2 = new FakeConn("cid-x");
    handleMessage(reg, c2.asConn(), { type: "register", name: "X", pin });
    expect((c2.last() as { pin: string }).pin).toBe(pin);
  });
});

/**
 * Live validation of the configured TURN secret/host. This performs a real
 * STUN/TURN Allocate handshake over UDP against the operator coturn server
 * using the same time-limited credential scheme the app issues. It only runs
 * when TURN_SECRET + TURN_HOST are present in the environment (i.e. the
 * secrets have been configured); otherwise it is skipped so CI without the
 * secret stays green.
 */
import crypto from "crypto";
import net from "net";

// Capture the real TURN config ONCE at module load. Other tests in this file
// mutate process.env.TURN_* to fake values (e.g. "1.1.1.1", "test-secret") and
// run concurrently, so reading process.env inside the async live test would
// race and point the socket at a bogus host. Snapshotting here keeps the live
// probe pinned to the actual operator coturn server.
const LIVE_TURN_SECRET = process.env.TURN_SECRET || "";
const LIVE_TURN_TCP_HOST = process.env.TURN_TCP_HOST || process.env.TURN_HOST || "";
const LIVE_TURN_TCP_PORT = parseInt(process.env.TURN_TCP_ALT_PORT || "443", 10);
const HAS_TURN = !!(process.env.TURN_SECRET && process.env.TURN_HOST);

function parseAttrs(buf: Buffer, mlen: number) {
  const attrs = new Map<number, Buffer>();
  let i = 20;
  const end = 20 + mlen;
  while (i + 4 <= end) {
    const at = buf.readUInt16BE(i);
    const al = buf.readUInt16BE(i + 2);
    attrs.set(at, buf.subarray(i + 4, i + 4 + al));
    i += 4 + al + ((4 - (al % 4)) % 4);
  }
  return attrs;
}

function pad(b: Buffer) {
  const padLen = (4 - (b.length % 4)) % 4;
  return padLen ? Buffer.concat([b, Buffer.alloc(padLen)]) : b;
}
function attr(t: number, v: Buffer) {
  const head = Buffer.alloc(4);
  head.writeUInt16BE(t, 0);
  head.writeUInt16BE(v.length, 2);
  return Buffer.concat([head, pad(v)]);
}

const ALLOCATE = 0x0003;
const REQUESTED_TRANSPORT = 0x0019;
const USERNAME = 0x0006;
const REALM = 0x0014;
const NONCE = 0x0015;
const MESSAGE_INTEGRITY = 0x0008;
const XOR_RELAYED = 0x0016;
const MAGIC = 0x2112a442;

function header(type: number, len: number, txid: Buffer) {
  const h = Buffer.alloc(20);
  h.writeUInt16BE(type, 0);
  h.writeUInt16BE(len, 2);
  h.writeUInt32BE(MAGIC, 4);
  txid.copy(h, 8);
  return h;
}

(HAS_TURN ? describe : describe.skip)("live TURN allocation (operator coturn)", () => {
  // Validate the firewall-penetrating TURN-over-TCP path on port 443 — the same
  // path the app now advertises and the one that actually fixes calls stuck on
  // "connecting...". TCP is also more stable than UDP inside the CI sandbox.
  it("allocates a relay over TCP:443 with app-issued time-limited credentials", async () => {
    const SECRET = LIVE_TURN_SECRET;
    const HOST = LIVE_TURN_TCP_HOST;
    const PORT = LIVE_TURN_TCP_PORT;
    const expiry = Math.floor(Date.now() / 1000) + 3600;
    const user = expiry + ":vitest";
    const cred = crypto.createHmac("sha1", SECRET).update(user).digest("base64");
    const reqTransport = attr(REQUESTED_TRANSPORT, Buffer.from([17, 0, 0, 0]));

    const result = await new Promise<{ ok: boolean; relayed?: string }>((resolve) => {
      let stage = 1;
      let rbuf = Buffer.alloc(0);
      const sock = net.createConnection({ host: HOST, port: PORT });
      const done = (r: { ok: boolean; relayed?: string }) => { try { sock.destroy(); } catch { /* noop */ } resolve(r); };
      const timer = setTimeout(() => done({ ok: false }), 9000);

      const send1 = () => {
        const txid = crypto.randomBytes(12);
        sock.write(Buffer.concat([header(ALLOCATE, reqTransport.length, txid), reqTransport]));
      };

      const handle = (msg: Buffer) => {
        const type = msg.readUInt16BE(0);
        const mlen = msg.readUInt16BE(2);
        const attrs = parseAttrs(msg, mlen);
        if (stage === 1) {
          const realm = attrs.get(REALM)?.toString() || "";
          const nonce = attrs.get(NONCE);
          if (!nonce) { clearTimeout(timer); done({ ok: false }); return; }
          stage = 2;
          const key = crypto.createHash("md5").update(`${user}:${realm}:${cred}`).digest();
          const txid2 = crypto.randomBytes(12);
          const body = Buffer.concat([
            reqTransport,
            attr(USERNAME, Buffer.from(user)),
            attr(REALM, Buffer.from(realm)),
            attr(NONCE, nonce),
          ]);
          const h = header(ALLOCATE, body.length + 24, txid2);
          const mac = crypto.createHmac("sha1", key).update(Buffer.concat([h, body])).digest();
          sock.write(Buffer.concat([h, body, attr(MESSAGE_INTEGRITY, mac)]));
        } else {
          clearTimeout(timer);
          const success = type === 0x0103;
          let relayed: string | undefined;
          const ra = attrs.get(XOR_RELAYED);
          if (ra && ra.length >= 8) {
            const port = ra.readUInt16BE(2) ^ (MAGIC >>> 16);
            const ipNum = ra.readUInt32BE(4) ^ MAGIC;
            relayed = `${(ipNum >>> 24) & 255}.${(ipNum >>> 16) & 255}.${(ipNum >>> 8) & 255}.${ipNum & 255}:${port}`;
          }
          done({ ok: success, relayed });
        }
      };

      sock.on("connect", send1);
      sock.on("data", (chunk) => {
        rbuf = Buffer.concat([rbuf, chunk]);
        // STUN/TURN over TCP frames each message with its 20-byte header + length.
        while (rbuf.length >= 20) {
          const mlen = rbuf.readUInt16BE(2);
          if (rbuf.length < 20 + mlen) break;
          const frame = rbuf.subarray(0, 20 + mlen);
          rbuf = rbuf.subarray(20 + mlen);
          handle(frame);
        }
      });
      sock.on("error", () => { clearTimeout(timer); done({ ok: false }); });
    });

    expect(result.ok).toBe(true);
    expect(result.relayed).toBeTruthy();
  }, 14000);
});
