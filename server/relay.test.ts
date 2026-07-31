import { describe, expect, it, beforeEach, afterEach } from "vitest";
import crypto from "crypto";
import fs from "node:fs";
import path from "node:path";
import {
  createRegistry,
  handleMessage,
  leaveRoom,
  iceServers,
  livekitConfig,
  mintLivekitToken,
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

  it("acks the CALLER with `ringing` (callee pin + name) once the ring is delivered", () => {
    // Drives the caller's staged progress: "Calling…" (invite sent) flips to
    // "Ringing…" only when the server confirms the callee is actually alerting.
    const a = register(reg, "Alice");
    const b = register(reg, "Bob");
    const bPin = (b.last() as { pin: string }).pin;
    a.outbox.length = 0;
    handleMessage(reg, a.asConn(), { type: "invite", to: bPin });

    const ringing = a.outbox.find((m): m is { type: string; pin: string; name: string } =>
      typeof m === "object" && m !== null && (m as { type: string }).type === "ringing"
    );
    expect(ringing?.pin).toBe(bPin);
    expect(ringing?.name).toBe("Bob");
  });

  it("does NOT send a `ringing` ack when the callee is offline (error:offline instead)", () => {
    const a = register(reg, "Alice");
    a.outbox.length = 0;
    handleMessage(reg, a.asConn(), { type: "invite", to: "000001" });

    expect(a.outbox.some(m => (m as { type?: string }).type === "ringing")).toBe(false);
    const err = a.outbox.find((m): m is { type: string; code: string } =>
      (m as { type?: string }).type === "error"
    );
    expect(err?.code).toBe("offline");
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
    expect(joined.members).toHaveLength(1);
    expect(joined.members[0]).toMatchObject({ pin: aPin, name: "Alice" });

    const peerJoined = a.last() as { type: string; pin: string; name: string };
    expect(peerJoined.type).toBe("peer-joined");
    expect(peerJoined.pin).toBe(bPin);
    expect(peerJoined.name).toBe("Bob");
  });

  it("relays signal payloads only to the addressed peer — and only within a shared room (S2)", () => {
    const a = register(reg, "Alice");
    const b = register(reg, "Bob");
    const c = register(reg, "Carol");
    const bPin = (b.last() as { pin: string }).pin;
    // Establish an actual call room between Alice and Bob (invite → accept).
    handleMessage(reg, a.asConn(), { type: "invite", to: bPin });
    const roomId = (a.outbox.find(
      (m): m is { type: string; roomId: string } =>
        typeof m === "object" && m !== null && (m as { type: string }).type === "room"
    ) as { roomId: string }).roomId;
    handleMessage(reg, b.asConn(), { type: "accept", roomId });

    a.outbox.length = b.outbox.length = c.outbox.length = 0;
    const sdp = { type: "offer", sdp: "v=0..." };
    handleMessage(reg, a.asConn(), { type: "signal", to: bPin, data: { sdp } });
    expect(b.outbox).toHaveLength(1);
    expect(c.outbox).toHaveLength(0);
    const relayed = b.last() as { type: string; data: { sdp: { type: string } } };
    expect(relayed.type).toBe("signal");
    expect(relayed.data.sdp.type).toBe("offer");

    // SECURITY (S2): Carol is NOT in Alice/Bob's room, so she cannot push a
    // signal to Bob (no ICE-candidate harvesting of an online stranger).
    b.outbox.length = 0;
    handleMessage(reg, c.asConn(), { type: "signal", to: bPin, data: { sdp } });
    expect(b.outbox).toHaveLength(0);
  });

  it("rings the callee (call waiting) instead of flagging busy when already in a call", () => {
    // Call waiting: a third party dialing someone who's mid-call no longer gets a
    // "busy" bounce. The invite rings through so the callee's client can show a
    // call-waiting popup (Answer = hold current + switch; Reject = decline).
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

    b.outbox.length = 0;
    c.outbox.length = 0;
    handleMessage(reg, c.asConn(), { type: "invite", to: bPin });

    // Carol is NOT told "busy".
    expect(c.outbox.some(m => (m as { type?: string }).type === "busy")).toBe(false);
    // Bob receives a ring from Carol — the call-waiting alert.
    const ring = b.outbox.find(
      (m): m is { type: string; from: string } =>
        typeof m === "object" && m !== null && (m as { type: string }).type === "ring"
    );
    expect(ring).toBeTruthy();
    expect(ring!.from).toBe(cPin);
    expect(reg.clients.get(cPin)).toBeTruthy();
  });

  it("answering a call-waiting call HOLDS the first call instead of dropping it", () => {
    // switchCall() answers a waiting call with ONLY {accept} (no {leave}). The
    // server now detects that Bob's prior room is a REAL call (Alice is in it) and
    // puts it ON HOLD — Bob stays a member of room A (held) while talking in room R
    // (active) — instead of ejecting him. Alice is told he's on hold, NOT gone.
    const a = register(reg, "Alice");
    const b = register(reg, "Bob");
    const c = register(reg, "Carol");
    const aPin = (a.last() as { pin: string }).pin;
    const bPin = (b.last() as { pin: string }).pin;

    // Room A: Alice + Bob.
    handleMessage(reg, a.asConn(), { type: "invite", to: bPin });
    const roomA = (a.outbox.find(
      (m): m is { type: string; roomId: string } =>
        typeof m === "object" && m !== null && (m as { type: string }).type === "room"
    ) as { roomId: string }).roomId;
    handleMessage(reg, b.asConn(), { type: "accept", roomId: roomA });

    // Carol rings Bob (call waiting) → Carol's room R is created.
    handleMessage(reg, c.asConn(), { type: "invite", to: bPin });
    const roomR = (c.outbox.find(
      (m): m is { type: string; roomId: string } =>
        typeof m === "object" && m !== null && (m as { type: string }).type === "room"
    ) as { roomId: string }).roomId;
    expect(roomR).not.toBe(roomA);

    a.outbox.length = 0;
    // Bob answers Carol — accept alone relocates the ACTIVE pointer and HOLDS A.
    handleMessage(reg, b.asConn(), { type: "accept", roomId: roomR });

    expect(reg.rooms.get(roomR)?.has(bPin)).toBe(true);   // Bob active in Carol's room
    expect(reg.rooms.get(roomA)?.has(bPin)).toBe(true);   // …and STILL a member of A (held)
    expect(reg.clients.get(bPin)?.roomId).toBe(roomR);    // active pointer = R
    expect(reg.pinRoom.get(bPin)).toBe(roomR);
    expect(reg.heldRoom.get(bPin)).toBe(roomA);           // A is the held room
    // Alice is told Bob put her ON HOLD — not that he left.
    const hold = a.outbox.find(
      (m): m is { type: string; pin: string; on: boolean } =>
        typeof m === "object" && m !== null && (m as { type: string }).type === "peer-hold"
    );
    expect(hold?.pin).toBe(bPin);
    expect(hold?.on).toBe(true);
    const left = a.outbox.find(
      (m): m is { type: string } =>
        typeof m === "object" && m !== null && (m as { type: string }).type === "peer-left"
    );
    expect(left).toBeUndefined();
    expect(reg.rooms.get(roomA)?.has(aPin)).toBe(true);
  });

  it("'end-held' drops ONLY the waiting line (v2.97.1): held members get peer-left, the active call is untouched", () => {
    const a = register(reg, "Alice");
    const b = register(reg, "Bob");
    const c = register(reg, "Carol");
    const aPin = (a.last() as { pin: string }).pin;
    const bPin = (b.last() as { pin: string }).pin;
    const cPin = (c.last() as { pin: string }).pin;
    // Room A: Alice + Bob live; Carol rings Bob; Bob answers (A goes on hold).
    handleMessage(reg, a.asConn(), { type: "invite", to: bPin });
    const roomA = (a.outbox.find(
      (m): m is { type: string; roomId: string } =>
        typeof m === "object" && m !== null && (m as { type: string }).type === "room"
    ) as { roomId: string }).roomId;
    handleMessage(reg, b.asConn(), { type: "accept", roomId: roomA });
    handleMessage(reg, c.asConn(), { type: "invite", to: bPin });
    const roomR = (c.outbox.find(
      (m): m is { type: string; roomId: string } =>
        typeof m === "object" && m !== null && (m as { type: string }).type === "room"
    ) as { roomId: string }).roomId;
    handleMessage(reg, b.asConn(), { type: "accept", roomId: roomR });
    expect(reg.heldRoom.get(bPin)).toBe(roomA);

    a.outbox.length = 0;
    b.outbox.length = 0;
    // Bob hangs up the WAITING line only.
    handleMessage(reg, b.asConn(), { type: "end-held" });
    // Alice gets a REAL peer-left (her client ends that call normally)…
    const left = a.outbox.find(
      (m): m is { type: string; pin: string } =>
        typeof m === "object" && m !== null && (m as { type: string }).type === "peer-left"
    );
    expect(left?.pin).toBe(bPin);
    // …while Bob's ACTIVE call with Carol is untouched and the hold is gone.
    expect(reg.heldRoom.get(bPin)).toBeUndefined();
    expect(reg.pinRoom.get(bPin)).toBe(roomR);
    expect(reg.rooms.get(roomR)?.has(bPin)).toBe(true);
    expect(reg.rooms.get(roomR)?.has(cPin)).toBe(true);
    expect(reg.rooms.get(roomA)?.has(bPin)).toBeFalsy();
    expect(reg.rooms.get(roomA)?.has(aPin) ?? false).toBe(reg.rooms.has(roomA));
    expect(
      b.outbox.some((m) => typeof m === "object" && m !== null && (m as { type: string }).type === "held-ended")
    ).toBe(true);
    // A second end-held has nothing to release → explicit nohold error.
    b.outbox.length = 0;
    handleMessage(reg, b.asConn(), { type: "end-held" });
    const err = b.outbox.find(
      (m): m is { type: string; code: string } =>
        typeof m === "object" && m !== null && (m as { type: string }).type === "error"
    );
    expect(err?.code).toBe("nohold");
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

  // ---- v2.92 R4C — TURN_TTL / TURN_TCP_HOST env extras, pinned ----

  /** Expiry (unix seconds) embedded in a coturn use-auth-secret username. */
  const usernameExpiry = (username?: string) => Number(String(username).split(":")[0]);

  it("v2.92 R4C: TURN_TTL sets the credential lifetime; default stays 3600", () => {
    const KEYS = ["TURN_SECRET", "TURN_HOST", "TURN_TCP_HOST", "TURN_TTL"] as const;
    const prev = Object.fromEntries(KEYS.map(k => [k, process.env[k]]));
    for (const k of KEYS) delete process.env[k];
    process.env.TURN_SECRET = "test-secret";
    process.env.TURN_HOST = "turn.example.com";
    try {
      // Default (unset): 3600s — the historical value.
      let now = Math.floor(Date.now() / 1000);
      let turn = iceServers("user-ttl").find(s => s.urls.startsWith("turn:"));
      expect(usernameExpiry(turn?.username)).toBeGreaterThanOrEqual(now + 3600 - 2);
      expect(usernameExpiry(turn?.username)).toBeLessThanOrEqual(now + 3600 + 2);

      // Operator-tuned lifetime.
      process.env.TURN_TTL = "600";
      now = Math.floor(Date.now() / 1000);
      turn = iceServers("user-ttl").find(s => s.urls.startsWith("turn:"));
      expect(usernameExpiry(turn?.username)).toBeGreaterThanOrEqual(now + 600 - 2);
      expect(usernameExpiry(turn?.username)).toBeLessThanOrEqual(now + 600 + 2);

      // The explicit override (the /api/relay/ice 300s probe) beats the env.
      turn = iceServers("user-ttl", 300).find(s => s.urls.startsWith("turn:"));
      expect(usernameExpiry(turn?.username)).toBeLessThanOrEqual(now + 300 + 2);

      // Garbage / non-positive values fall back to 3600 — never "NaN:" or
      // already-expired usernames.
      for (const bad of ["banana", "-5", "0"]) {
        process.env.TURN_TTL = bad;
        now = Math.floor(Date.now() / 1000);
        turn = iceServers("user-ttl").find(s => s.urls.startsWith("turn:"));
        expect(Number.isFinite(usernameExpiry(turn?.username))).toBe(true);
        expect(usernameExpiry(turn?.username)).toBeGreaterThanOrEqual(now + 3600 - 2);
      }
    } finally {
      for (const k of KEYS) {
        if (prev[k] === undefined) delete process.env[k];
        else process.env[k] = prev[k] as string;
      }
    }
  });

  it("v2.92 R4C: TURN_TCP_HOST adds turn:<host>:3478?transport=tcp with the SAME HMAC credentials", () => {
    const KEYS = ["TURN_SECRET", "TURN_HOST", "TURN_TCP_HOST", "TURN_TTL", "TURN_PORT"] as const;
    const prev = Object.fromEntries(KEYS.map(k => [k, process.env[k]]));
    for (const k of KEYS) delete process.env[k];
    process.env.TURN_SECRET = "test-secret";
    process.env.TURN_HOST = "1.1.1.1";
    process.env.TURN_TCP_HOST = "2.2.2.2";
    try {
      const list = iceServers("user-tcp");
      const tcp3478 = list.find(s => s.urls === "turn:2.2.2.2:3478?transport=tcp");
      const udp = list.find(s => s.urls === "turn:1.1.1.1:3478?transport=udp");
      expect(tcp3478).toBeDefined();
      expect(udp).toBeDefined();
      // Same minted username+credential on every operator entry, and the
      // credential really is base64(HMAC-SHA1(secret, username)).
      expect(tcp3478?.username).toBe(udp?.username);
      expect(tcp3478?.credential).toBe(udp?.credential);
      const expected = crypto
        .createHmac("sha1", "test-secret")
        .update(String(tcp3478?.username))
        .digest("base64");
      expect(tcp3478?.credential).toBe(expected);
    } finally {
      for (const k of KEYS) {
        if (prev[k] === undefined) delete process.env[k];
        else process.env[k] = prev[k] as string;
      }
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
    // same cid and must still be in the room with the same pin — AND now gets a
    // `rejoin` so the fresh page re-enters the call without a new invite.
    const a2 = new FakeConn("cid-a");
    handleMessage(reg, a2.asConn(), { type: "register", name: "A" });
    const registered = a2.outbox.find(
      (m): m is { type: string; pin: string } =>
        typeof m === "object" && m !== null && (m as { type: string }).type === "registered"
    );
    expect(registered?.pin).toBe(aPin);
    expect(reg.clients.get(aPin)?.roomId).toBe(roomId);
    expect(reg.rooms.get(roomId)?.has(aPin)).toBe(true);
    // New: auto-rejoin message for the active call.
    const rejoin = a2.outbox.find(
      (m): m is { type: string; roomId: string } =>
        typeof m === "object" && m !== null && (m as { type: string }).type === "rejoin"
    );
    expect(rejoin?.roomId).toBe(roomId);
  });

  // ── persistent rejoin (v2.33) ────────────────────────────────────────────
  const rtype = (m: unknown) => (m as { type?: string })?.type;
  function setupCall() {
    const a = new FakeConn("dev-a");
    handleMessage(reg, a.asConn(), { type: "register", name: "A" });
    const b = new FakeConn("dev-b");
    handleMessage(reg, b.asConn(), { type: "register", name: "B" });
    handleMessage(reg, a.asConn(), { type: "invite", to: b.pin! });
    const roomMsg = a.outbox.find(
      (m): m is { type: string; roomId: string } =>
        typeof m === "object" && m !== null && rtype(m) === "room"
    );
    const rid = roomMsg!.roomId;
    handleMessage(reg, b.asConn(), { type: "accept", roomId: rid });
    return { a, b, rid, aPin: a.pin!, bPin: b.pin! };
  }

  it("a member whose in-call client was reaped keeps membership and AUTO-REJOINS on return", () => {
    const { b, rid, aPin, bPin } = setupCall();
    expect(reg.pinRoom.get(aPin)).toBe(rid);
    // Simulate the grace reaper for an IN-CALL member: client gone, membership KEPT.
    reg.clients.delete(aPin);
    expect(reg.pinRoom.get(aPin)).toBe(rid);
    expect(reg.rooms.get(rid)?.has(aPin)).toBe(true);
    // A's device returns (same cid → same pin) with a fresh page.
    const a2 = new FakeConn("dev-a");
    handleMessage(reg, a2.asConn(), { type: "register", name: "A" });
    expect(a2.pin).toBe(aPin);
    const rejoin = a2.outbox.find((m) => rtype(m) === "rejoin") as
      | { roomId: string; members: Array<{ pin: string }> }
      | undefined;
    expect(rejoin?.roomId).toBe(rid);
    expect(rejoin?.members?.some((mm) => mm.pin === bPin)).toBe(true);
    expect(reg.clients.get(aPin)?.roomId).toBe(rid);
    void b;
  });

  it("a newcomer's `joined` roster EXCLUDES ghost members (their tiles would never connect)", () => {
    const { a, rid, aPin, bPin } = setupCall();
    // B's client record is long gone (grace expired) but membership persists.
    reg.clients.delete(bPin);
    // A now invites C into the same room; C accepts.
    const c = new FakeConn("dev-c");
    handleMessage(reg, c.asConn(), { type: "register", name: "C" });
    handleMessage(reg, a.asConn(), { type: "invite", to: c.pin! });
    handleMessage(reg, c.asConn(), { type: "accept", roomId: rid });
    const joined = c.outbox.find((m) => rtype(m) === "joined") as
      | { members: Array<{ pin: string }> }
      | undefined;
    expect(joined).toBeTruthy();
    expect(joined!.members.some((m) => m.pin === aPin)).toBe(true);  // live member listed
    expect(joined!.members.some((m) => m.pin === bPin)).toBe(false); // ghost excluded
  });

  it("does NOT rejoin into a room of GHOSTS — all other members' clients gone → membership released (zombie-call fix)", () => {
    // The immortal-zombie loop this kills: media fails mid-setup, both tabs
    // close without an explicit leave, membership persists; every later app
    // open auto-rejoined the dead room (cancelling its abandonment reaper!),
    // the device sat silently "in a call", real incoming rings degraded to
    // call-waiting, and the zombie's death auto-declined them.
    const { rid, aPin, bPin } = setupCall();
    reg.clients.delete(aPin);
    reg.clients.delete(bPin); // BOTH sides long gone; membership persisted
    expect(reg.rooms.get(rid)?.has(aPin)).toBe(true);
    const a2 = new FakeConn("dev-a");
    handleMessage(reg, a2.asConn(), { type: "register", name: "A" });
    expect(a2.pin).toBe(aPin);
    expect(a2.outbox.some((m) => rtype(m) === "rejoin")).toBe(false);
    expect(reg.pinRoom.has(aPin)).toBe(false); // membership released, no zombie
  });

  it("an EXPLICIT hang-up removes membership — re-registering does NOT auto-rejoin (locked out)", () => {
    const { a, rid, aPin } = setupCall();
    handleMessage(reg, a.asConn(), { type: "leave" });
    expect(reg.pinRoom.has(aPin)).toBe(false);
    expect(reg.rooms.get(rid)?.has(aPin)).toBe(false);
    const a2 = new FakeConn("dev-a");
    handleMessage(reg, a2.asConn(), { type: "register", name: "A" });
    expect(a2.outbox.some((m) => rtype(m) === "rejoin")).toBe(false);
  });

  it("the room is reaped once the LAST member explicitly leaves (no zombie room)", () => {
    const { a, b, rid, aPin, bPin } = setupCall();
    handleMessage(reg, a.asConn(), { type: "leave" });
    expect(reg.rooms.get(rid)?.has(bPin)).toBe(true); // B still in the call
    expect(reg.rooms.has(rid)).toBe(true);
    handleMessage(reg, b.asConn(), { type: "leave" });
    expect(reg.rooms.has(rid)).toBe(false);
    expect(reg.pinRoom.has(aPin)).toBe(false);
    expect(reg.pinRoom.has(bPin)).toBe(false);
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

  // ── v2.33.1 hardening (adversarial-review findings) ──────────────────────
  it("a DIFFERENT user on the SAME browser (cid) is NOT auto-rejoined into the previous user's live call", () => {
    const { b, rid, aPin, bPin } = setupCall();
    // The in-call grace reaper deletes A's client but (per the real grace branch)
    // KEEPS the cid->pin mapping AND the room membership.
    reg.clients.delete(aPin);
    expect(reg.cidToPin.get("dev-a")).toBe(aPin);
    expect(reg.pinRoom.get(aPin)).toBe(rid);

    // A logs out; a different user registers on the same browser, explicitly
    // requesting THEIR OWN number (any valid pin that isn't A's or B's).
    let wantPin = "200000";
    while (wantPin === aPin || wantPin === bPin) wantPin = String(Number(wantPin) + 1);
    const other = new FakeConn("dev-a");
    handleMessage(reg, other.asConn(), { type: "register", name: "Mallory", pin: wantPin });

    // They get their OWN number, never A's, and no rejoin into A's call.
    expect(other.pin).toBe(wantPin);
    expect(other.pin).not.toBe(aPin);
    expect(other.outbox.some((m) => rtype(m) === "rejoin")).toBe(false);
    // A's stale cid binding + membership were severed; B's call is untouched.
    expect(reg.cidToPin.get("dev-a")).toBe(wantPin);
    expect(reg.pinRoom.has(aPin)).toBe(false);
    expect(reg.rooms.get(rid)?.has(bPin)).toBe(true);
    void b;
  });

  it("a same-cid reconnect that re-requests its OWN pin still auto-rejoins (identitySwitch stays off)", () => {
    const { rid, aPin, bPin } = setupCall();
    reg.clients.delete(aPin); // in-call grace reaped the client, membership kept
    const a2 = new FakeConn("dev-a");
    handleMessage(reg, a2.asConn(), { type: "register", name: "A", pin: aPin });
    expect(a2.pin).toBe(aPin);
    const rejoin = a2.outbox.find((m) => rtype(m) === "rejoin") as { roomId: string } | undefined;
    expect(rejoin?.roomId).toBe(rid);
    void bPin;
  });

  it("a ghost-only room is reap-armed (not leaked) when the last connected peer explicitly leaves", () => {
    const { b, rid, aPin, bPin } = setupCall();
    // A drops mid-call: grace reaped the client, membership KEPT → disconnected ghost.
    reg.clients.delete(aPin);
    expect(reg.rooms.get(rid)?.has(aPin)).toBe(true);
    expect(reg.roomReapT.has(rid)).toBe(false); // not armed while B is connected
    // B explicitly hangs up. The room now holds only the disconnected ghost A.
    handleMessage(reg, b.asConn(), { type: "leave" });
    expect(reg.rooms.get(rid)?.has(bPin)).toBe(false);
    // The room is no longer leaked: the abandonment reaper is armed for it.
    expect(reg.roomReapT.has(rid)).toBe(true);
    const t = reg.roomReapT.get(rid);
    if (t) clearTimeout(t); // don't leave a 5-min timer dangling in the suite
  });

  it("refreshing while ALONE in a solo dialing room lands in the lobby (no empty rejoin) and reaps the room", () => {
    const a = new FakeConn("dev-a");
    handleMessage(reg, a.asConn(), { type: "register", name: "A" });
    const b = new FakeConn("dev-b");
    handleMessage(reg, b.asConn(), { type: "register", name: "B" });
    // A dials B but B never accepts → A sits alone in a solo dialing room.
    handleMessage(reg, a.asConn(), { type: "invite", to: b.pin! });
    const rid = (a.outbox.find((m) => rtype(m) === "room") as { roomId: string }).roomId;
    expect(reg.pinRoom.get(a.pin!)).toBe(rid);
    // A's in-call client is reaped (refresh) but membership kept.
    const aPin = a.pin!;
    reg.clients.delete(aPin);
    // A returns. Being ALONE, A must NOT get an empty rejoin — they go to lobby
    // and the orphaned solo room is reaped.
    const a2 = new FakeConn("dev-a");
    handleMessage(reg, a2.asConn(), { type: "register", name: "A" });
    expect(a2.outbox.some((m) => rtype(m) === "rejoin")).toBe(false);
    expect(reg.pinRoom.has(aPin)).toBe(false);
    expect(reg.rooms.has(rid)).toBe(false);
  });
});

/* ── conference history (v2.34) ─────────────────────────────────────────────
 * The room is the unit of a "conference". When it ends (reaped), the relay emits
 * onConferenceEnd with the full roster + duration, which a higher layer persists.
 * ────────────────────────────────────────────────────────────────────────── */
describe("relay — conference history", () => {
  let reg: RelayRegistry;
  beforeEach(() => { reg = createRegistry(); });
  const rtype = (m: unknown) => (m as { type?: string })?.type;

  type ConfInfo = {
    roomId: string;
    startedAt: number;
    answeredAt: number | null;
    endedAt: number;
    dialedNumber: string | null;
    participants: Array<{ pin: string; name: string }>;
  };

  function registerConn(cid: string, name: string) {
    const c = new FakeConn(cid);
    handleMessage(reg, c.asConn(), { type: "register", name });
    return c;
  }

  it("emits onConferenceEnd with the full roster + dialed number when an answered call ends", () => {
    const a = registerConn("dev-a", "Alice");
    const b = registerConn("dev-b", "Bob");
    handleMessage(reg, a.asConn(), { type: "invite", to: b.pin! });
    const rid = (a.outbox.find((m) => rtype(m) === "room") as { roomId: string }).roomId;
    handleMessage(reg, b.asConn(), { type: "accept", roomId: rid });

    let captured: ConfInfo | null = null;
    reg.onConferenceEnd = (info) => { captured = info as ConfInfo; };

    handleMessage(reg, a.asConn(), { type: "leave" });
    expect(captured).toBeNull(); // B is still in the call — not ended yet
    handleMessage(reg, b.asConn(), { type: "leave" }); // last out → reap → emit

    const info = captured as ConfInfo | null;
    expect(info).not.toBeNull();
    expect(info!.roomId).toBe(rid);
    expect(info!.dialedNumber).toBe(b.pin);
    const pins = info!.participants.map((p) => p.pin).sort();
    expect(pins).toEqual([a.pin!, b.pin!].sort());
    const names = Object.fromEntries(info!.participants.map((p) => [p.pin, p.name]));
    expect(names[a.pin!]).toBe("Alice");
    expect(names[b.pin!]).toBe("Bob");
    expect(info!.endedAt).toBeGreaterThanOrEqual(info!.startedAt);
    // Duration is measured from the ANSWER (talk time), not the dial.
    expect(info!.answeredAt).not.toBeNull();
    expect(info!.answeredAt!).toBeGreaterThanOrEqual(info!.startedAt);
    expect(info!.endedAt).toBeGreaterThanOrEqual(info!.answeredAt!);
  });

  it("propagates each member's device type AND flag in the joined member list (v2.39/v2.44)", () => {
    const a = new FakeConn("dev-a");
    handleMessage(reg, a.asConn(), { type: "register", name: "Alice", device: "Desktop", flag: "🇬🇧" });
    const b = new FakeConn("dev-b");
    handleMessage(reg, b.asConn(), { type: "register", name: "Bob", device: "Mobile", flag: "🇺🇸" });
    handleMessage(reg, a.asConn(), { type: "invite", to: b.pin! });
    const rid = (a.outbox.find((m) => rtype(m) === "room") as { roomId: string }).roomId;
    handleMessage(reg, b.asConn(), { type: "accept", roomId: rid });
    // B's `joined` message lists A with A's device + flag.
    const joined = b.outbox.find((m) => rtype(m) === "joined") as
      | { members: Array<{ pin: string; device?: string; flag?: string }> }
      | undefined;
    const aMember = joined?.members.find((mm) => mm.pin === a.pin);
    expect(aMember?.device).toBe("Desktop");
    expect(aMember?.flag).toBe("🇬🇧");
    // A gets a `peer-joined` for B carrying B's device + flag.
    const pj = a.outbox.find((m) => rtype(m) === "peer-joined") as { device?: string; flag?: string } | undefined;
    expect(pj?.device).toBe("Mobile");
    expect(pj?.flag).toBe("🇺🇸");
  });

  it("does NOT log an UNANSWERED dial as a conference (no accept → no history)", () => {
    const a = registerConn("dev-a", "Alice");
    const b = registerConn("dev-b", "Bob");
    handleMessage(reg, a.asConn(), { type: "invite", to: b.pin! });
    let called = false;
    reg.onConferenceEnd = () => { called = true; };
    handleMessage(reg, a.asConn(), { type: "leave" }); // caller gives up before answer
    expect(called).toBe(false);
  });

  it("keeps a participant who LEFT EARLY in the conference roster", () => {
    const a = registerConn("dev-a", "Alice");
    const b = registerConn("dev-b", "Bob");
    const c = registerConn("dev-c", "Carol");
    handleMessage(reg, a.asConn(), { type: "invite", to: b.pin! });
    const rid = (a.outbox.find((m) => rtype(m) === "room") as { roomId: string }).roomId;
    handleMessage(reg, b.asConn(), { type: "accept", roomId: rid });
    handleMessage(reg, a.asConn(), { type: "invite", to: c.pin! });
    handleMessage(reg, c.asConn(), { type: "accept", roomId: rid });

    let captured: ConfInfo | null = null;
    reg.onConferenceEnd = (info) => { captured = info as ConfInfo; };

    handleMessage(reg, b.asConn(), { type: "leave" }); // Bob bails early
    expect(captured).toBeNull();
    handleMessage(reg, a.asConn(), { type: "leave" });
    handleMessage(reg, c.asConn(), { type: "leave" }); // last out → reap

    const info = captured as ConfInfo | null;
    expect(info).not.toBeNull();
    const pins = info!.participants.map((p) => p.pin).sort();
    expect(pins).toEqual([a.pin!, b.pin!, c.pin!].sort());
    expect(info!.participants.length).toBe(3);
  });
});

/* ── host moderation (v2.41) ───────────────────────────────────────────────
 * The room creator is the host; host/co-hosts can mute, promote, and pin.
 * ────────────────────────────────────────────────────────────────────────── */
describe("relay — host moderation", () => {
  let reg: RelayRegistry;
  beforeEach(() => { reg = createRegistry(); });
  const rtype = (m: unknown) => (m as { type?: string })?.type;

  function hostAndGuest() {
    const a = new FakeConn("dev-a");
    handleMessage(reg, a.asConn(), { type: "register", name: "Host" });
    const b = new FakeConn("dev-b");
    handleMessage(reg, b.asConn(), { type: "register", name: "Bob" });
    handleMessage(reg, a.asConn(), { type: "invite", to: b.pin! });
    const rid = (a.outbox.find((m) => rtype(m) === "room") as { roomId: string }).roomId;
    handleMessage(reg, b.asConn(), { type: "accept", roomId: rid });
    return { a, b, rid };
  }

  it("the room creator is told they are the host", () => {
    const a = new FakeConn("dev-a");
    handleMessage(reg, a.asConn(), { type: "register", name: "Host" });
    const b = new FakeConn("dev-b");
    handleMessage(reg, b.asConn(), { type: "register", name: "Bob" });
    handleMessage(reg, a.asConn(), { type: "invite", to: b.pin! });
    const room = a.outbox.find((m) => rtype(m) === "room") as { selfRole?: string };
    expect(room.selfRole).toBe("host");
  });

  it("host 'mute-all' force-mutes every OTHER member", () => {
    const { a, b } = hostAndGuest();
    b.outbox.length = 0;
    handleMessage(reg, a.asConn(), { type: "mod", action: "mute-all" });
    const fm = b.outbox.find((m) => rtype(m) === "force-mute") as { on?: boolean } | undefined;
    expect(fm?.on).toBe(true);
  });

  it("a non-moderator's mod request is rejected", () => {
    const { b } = hostAndGuest();
    b.outbox.length = 0;
    handleMessage(reg, b.asConn(), { type: "mod", action: "mute-all" });
    const err = b.outbox.find((m) => rtype(m) === "error") as { code?: string } | undefined;
    expect(err?.code).toBe("forbidden");
  });

  it("host can promote a co-host, who can then moderate", () => {
    const { a, b } = hostAndGuest();
    handleMessage(reg, a.asConn(), { type: "mod", action: "cohost", target: b.pin! });
    const roleMsg = b.outbox.find((m) => rtype(m) === "role") as { role?: string } | undefined;
    expect(roleMsg?.role).toBe("cohost");
    // The co-host (B) can now mute the host (A).
    a.outbox.length = 0;
    handleMessage(reg, b.asConn(), { type: "mod", action: "mute", target: a.pin! });
    const fm = a.outbox.find((m) => rtype(m) === "force-mute") as { on?: boolean } | undefined;
    expect(fm?.on).toBe(true);
  });

  it("only the HOST (not a co-host) can assign co-hosts", () => {
    const { a, b } = hostAndGuest();
    handleMessage(reg, a.asConn(), { type: "mod", action: "cohost", target: b.pin! }); // B is cohost
    // B (cohost) tries to promote A — must be refused (only host assigns).
    b.outbox.length = 0;
    handleMessage(reg, b.asConn(), { type: "mod", action: "cohost", target: a.pin! });
    const err = b.outbox.find((m) => rtype(m) === "error") as { code?: string } | undefined;
    expect(err?.code).toBe("forbidden");
  });

  it("'hold' broadcasts peer-hold to the other room members (call waiting → hold)", () => {
    const { a, b } = hostAndGuest();
    b.outbox.length = 0;
    handleMessage(reg, a.asConn(), { type: "hold", action: "on" });
    const ph = b.outbox.find((m) => rtype(m) === "peer-hold") as { pin?: string; on?: boolean } | undefined;
    expect(ph?.on).toBe(true);
    expect(ph?.pin).toBe(a.pin);
  });

  it("'screen' broadcasts peer-screen so everyone can spotlight the sharer", () => {
    const { a, b } = hostAndGuest();
    b.outbox.length = 0;
    handleMessage(reg, a.asConn(), { type: "screen", action: "on" });
    const ps = b.outbox.find((m) => rtype(m) === "peer-screen") as { pin?: string; on?: boolean } | undefined;
    expect(ps?.on).toBe(true);
    expect(ps?.pin).toBe(a.pin);
  });

  it("the host can TRANSFER the host role (makehost): new host promoted, old host → co-host", () => {
    const { a, b } = hostAndGuest();
    b.outbox.length = 0; a.outbox.length = 0;
    handleMessage(reg, a.asConn(), { type: "mod", action: "makehost", target: b.pin! });
    // The room learns B is host and A is now co-host.
    const roleMsgs = b.outbox.filter((m) => rtype(m) === "role") as Array<{ pin?: string; role?: string }>;
    expect(roleMsgs.find((r) => r.pin === b.pin)?.role).toBe("host");
    expect(roleMsgs.find((r) => r.pin === a.pin)?.role).toBe("cohost");
    // B (now host) can moderate; A (now co-host) can no longer assign co-hosts.
    a.outbox.length = 0;
    handleMessage(reg, a.asConn(), { type: "mod", action: "cohost", target: b.pin! });
    expect((a.outbox.find((m) => rtype(m) === "error") as { code?: string } | undefined)?.code).toBe("forbidden");
  });

  it("a non-host cannot transfer the host role", () => {
    const { a, b } = hostAndGuest();
    handleMessage(reg, a.asConn(), { type: "mod", action: "cohost", target: b.pin! }); // B = cohost
    b.outbox.length = 0;
    handleMessage(reg, b.asConn(), { type: "mod", action: "makehost", target: a.pin! });
    expect((b.outbox.find((m) => rtype(m) === "error") as { code?: string } | undefined)?.code).toBe("forbidden");
  });

  it("host 'kick' removes the target from the call (kicked + membership cleared)", () => {
    const { a, b, rid } = hostAndGuest();
    b.outbox.length = 0;
    expect(reg.rooms.get(rid)?.has(b.pin!)).toBe(true);
    handleMessage(reg, a.asConn(), { type: "mod", action: "kick", target: b.pin! });
    // B is told they were kicked and is removed from the room membership.
    expect(b.outbox.some((m) => rtype(m) === "kicked")).toBe(true);
    expect(reg.rooms.get(rid)?.has(b.pin!) ?? false).toBe(false);
    expect(reg.pinRoom.has(b.pin!)).toBe(false);
  });

  it("nobody can kick the HOST", () => {
    const { a, b } = hostAndGuest();
    handleMessage(reg, a.asConn(), { type: "mod", action: "cohost", target: b.pin! }); // B = cohost
    b.outbox.length = 0;
    handleMessage(reg, b.asConn(), { type: "mod", action: "kick", target: a.pin! }); // cohost tries to kick host
    expect((b.outbox.find((m) => rtype(m) === "error") as { code?: string } | undefined)?.code).toBe("forbidden");
  });

  it("host 'pin' broadcasts host-pin to the room", () => {
    const { a, b } = hostAndGuest();
    b.outbox.length = 0;
    handleMessage(reg, a.asConn(), { type: "mod", action: "pin", target: b.pin! });
    const pin = b.outbox.find((m) => rtype(m) === "host-pin") as { pin?: string } | undefined;
    expect(pin?.pin).toBe(b.pin);
  });

  it("host 'grid' broadcasts a host-pin clear (null)", () => {
    const { a, b } = hostAndGuest();
    b.outbox.length = 0;
    handleMessage(reg, a.asConn(), { type: "mod", action: "grid" });
    const msg = b.outbox.find((m) => rtype(m) === "host-pin") as { pin?: string | null } | undefined;
    expect(msg).toBeTruthy();
    expect(msg?.pin ?? null).toBeNull();
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

describe("relay — LiveKit SFU token minting", () => {
  const SAVE = {
    url: process.env.LIVEKIT_URL,
    key: process.env.LIVEKIT_API_KEY,
    secret: process.env.LIVEKIT_API_SECRET,
  };
  beforeEach(() => {
    process.env.LIVEKIT_URL = "wss://example.livekit.cloud";
    process.env.LIVEKIT_API_KEY = "APItestkey";
    process.env.LIVEKIT_API_SECRET = "test-secret-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  });
  afterEach(() => {
    for (const [k, v] of [
      ["LIVEKIT_URL", SAVE.url],
      ["LIVEKIT_API_KEY", SAVE.key],
      ["LIVEKIT_API_SECRET", SAVE.secret],
    ] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("LIVEKIT IS RETIRED — disabled unconditionally, and the env is not consulted", () => {
    // v2.106.52. The owner cancelled the LiveKit subscription and asked for it
    // removed. This assertion USED to require `enabled === true` when all three
    // vars were set — i.e. it would now forbid the retirement.
    //
    // Ignoring the env is the point, not an implementation detail: `enabled` is
    // what every signaling frame stamps as `livekit`, and the client's entire SFU
    // branch hangs off it. A stale LIVEKIT_URL left behind in /home/relay/.env
    // would otherwise reinstate the ~20s connect wait (4.5s + 3x4s of watchdog
    // before the mesh fallback could start), which is the exact failure being
    // removed. So it must not be reachable by leaving a variable set.
    //
    // Note this test's own beforeEach SETS all three vars — so the env being
    // fully populated while `enabled` is false is precisely what is asserted.
    expect(process.env.LIVEKIT_URL).toBeTruthy();
    expect(process.env.LIVEKIT_API_KEY).toBeTruthy();
    expect(process.env.LIVEKIT_API_SECRET).toBeTruthy();
    expect(livekitConfig().enabled).toBe(false);
    expect(livekitConfig().url).toBe("");
    // …and the function body reads no LIVEKIT_ env var at all.
    const src = fs.readFileSync(path.resolve(__dirname, "relay.ts"), "utf8");
    const at = src.indexOf("export function livekitConfig()");
    const body = src.slice(at, src.indexOf("\n}", at));
    expect(body).not.toMatch(/process\.env\.LIVEKIT/);
  });

  it("mints a scoped, short-lived join token (identity=pin, room, publish+subscribe, 60s, no admin)", async () => {
    const jwt = await mintLivekitToken("123456", "Alice", "rabc123");
    expect(typeof jwt).toBe("string");
    const payload = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString());
    expect(payload.sub).toBe("123456"); // identity = caller's own pin
    expect(payload.video.room).toBe("rabc123");
    expect(payload.video.roomJoin).toBe(true);
    expect(payload.video.canPublish).toBe(true);
    expect(payload.video.canSubscribe).toBe(true);
    expect(payload.video.roomAdmin).toBeFalsy(); // never admin
    expect(payload.video.roomRecord).toBeFalsy(); // never recorder
    expect(payload.exp - payload.nbf).toBe(60); // 60s TTL
  });
});

describe("relay — missed-call hook", () => {
  let reg: RelayRegistry;
  beforeEach(() => { reg = createRegistry(); });

  type Missed = { calleePin: string; callerPin: string; callerName: string; reason: string };

  it("fires onMissedCall (cancelled) for a pending callee when the caller leaves", () => {
    const a = register(reg, "Alice");
    const b = register(reg, "Bob");
    const calls: Missed[] = [];
    handleMessage(reg, a.asConn(), { type: "invite", to: b.pin! });
    handleMessage(reg, a.asConn(), { type: "leave" }, undefined, (i) => calls.push(i));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ calleePin: b.pin, callerPin: a.pin, reason: "cancelled" });
  });

  it("fires onMissedCall (rejected) when the callee declines", () => {
    const a = register(reg, "Alice");
    const b = register(reg, "Bob");
    const calls: Missed[] = [];
    handleMessage(reg, a.asConn(), { type: "invite", to: b.pin! });
    handleMessage(reg, b.asConn(), { type: "reject", to: a.pin! }, undefined, (i) => calls.push(i));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ calleePin: b.pin, callerPin: a.pin, reason: "rejected" });
  });

  it("does NOT fire onMissedCall when the callee accepted and the caller later leaves", () => {
    const a = register(reg, "Alice");
    const b = register(reg, "Bob");
    handleMessage(reg, a.asConn(), { type: "invite", to: b.pin! });
    const room = a.outbox.find(
      (m): m is { type: string; roomId: string } =>
        typeof m === "object" && m !== null && (m as { type: string }).type === "room"
    )!;
    handleMessage(reg, b.asConn(), { type: "accept", roomId: room.roomId });
    const calls: Missed[] = [];
    handleMessage(reg, a.asConn(), { type: "leave" }, undefined, (i) => calls.push(i));
    expect(calls).toHaveLength(0);
  });

  it("fires onMissedCall (cancelled) when inviting an OFFLINE / unregistered number", () => {
    const a = register(reg, "Alice");
    const calls: Missed[] = [];
    handleMessage(reg, a.asConn(), { type: "invite", to: "999000" }, undefined, (i) => calls.push(i));
    // Caller gets the offline error, and the miss is reported so the DB layer can
    // record it + email a registered (but offline) callee.
    expect((a.last() as { type: string; code?: string }).code).toBe("offline");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ calleePin: "999000", callerPin: a.pin, reason: "cancelled" });
  });

  it("ignores a `reject` for a call that was never ringing the sender (no forged history)", () => {
    const a = register(reg, "Alice");
    const b = register(reg, "Bob");
    const calls: Missed[] = [];
    // Bob rejects Alice without Alice ever having rung Bob.
    handleMessage(reg, b.asConn(), { type: "reject", to: a.pin! }, undefined, (i) => calls.push(i));
    expect(calls).toHaveLength(0);
    expect(a.outbox.some((m) => (m as { type?: string }).type === "rejected")).toBe(false);
  });
});

describe("relay — room-join authorization", () => {
  let reg: RelayRegistry;
  beforeEach(() => { reg = createRegistry(); });

  function roomIdOf(c: FakeConn): string {
    return (c.outbox.find(
      (m): m is { type: string; roomId: string } =>
        typeof m === "object" && m !== null && (m as { type: string }).type === "room"
    ) as { roomId: string }).roomId;
  }

  it("rejects an `accept` from a client who was never invited to the room", () => {
    const a = register(reg, "Alice");
    const b = register(reg, "Bob");
    const c = register(reg, "Carol");
    handleMessage(reg, a.asConn(), { type: "invite", to: b.pin! }); // A rings B, room created
    const rid = roomIdOf(a);
    // Carol learned the roomId but was never rung — she must NOT be able to join.
    handleMessage(reg, c.asConn(), { type: "accept", roomId: rid });
    const last = c.last() as { type: string; code?: string };
    expect(last.type).toBe("error");
    expect(last.code).toBe("forbidden");
    expect(reg.rooms.get(rid)?.has(c.pin!)).toBe(false);
  });

  it("allows an invited callee to accept", () => {
    const a = register(reg, "Alice");
    const b = register(reg, "Bob");
    handleMessage(reg, a.asConn(), { type: "invite", to: b.pin! });
    const rid = roomIdOf(a);
    handleMessage(reg, b.asConn(), { type: "accept", roomId: rid });
    expect((b.last() as { type: string }).type).toBe("joined");
    expect(reg.rooms.get(rid)?.has(b.pin!)).toBe(true);
  });

  // ── multi-device ring (feature-flagged) ──────────────────────────────────
  const typeOf = (m: unknown) => (m as { type?: string })?.type;
  const has = (c: FakeConn, t: string) => c.outbox.some((m) => typeOf(m) === t);
  const find = (c: FakeConn, t: string) => c.outbox.find((m) => typeOf(m) === t) as Record<string, unknown> | undefined;

  // ── live-call rejoin: knock → host approval → direct join (v2.99.9) ───────
  /** A live 2-party call: Alice (host) + Bob, both joined. Returns them + rid. */
  function liveCall(reg2: RelayRegistry): { a: FakeConn; b: FakeConn; rid: string } {
    const a = register(reg2, "Alice");
    const b = register(reg2, "Bob");
    handleMessage(reg2, a.asConn(), { type: "invite", to: b.pin! });
    const rid = roomIdOf(a);
    handleMessage(reg2, b.asConn(), { type: "accept", roomId: rid });
    return { a, b, rid };
  }

  it("a returning member knocks → the HOST is prompted → approve drops them back in", () => {
    const { a, b, rid } = liveCall(reg);
    // Bob leaves the room (he stays registered + in the room's roster — the
    // "you were in this call and want back" case).
    handleMessage(reg, b.asConn(), { type: "leave" });
    expect(reg.pinRoom.has(b.pin!)).toBe(false);
    expect(reg.rooms.get(rid)?.has(b.pin!)).toBe(false);
    // Bob knocks to rejoin the call Alice is still in.
    a.outbox.length = 0; b.outbox.length = 0;
    handleMessage(reg, b.asConn(), { type: "knock", to: a.pin! });
    // Host (Alice) gets the knock; Bob gets a "pending" ack.
    const knock = find(a, "knock");
    expect(knock?.fromPin).toBe(b.pin);
    expect(knock?.roomId).toBe(rid);
    expect(find(b, "knock-result")?.ok).toBe(true);
    // Alice approves → Bob is admitted (joined) + Alice sees peer-joined.
    a.outbox.length = 0; b.outbox.length = 0;
    handleMessage(reg, a.asConn(), { type: "knock-approve", roomId: rid, pin: b.pin! });
    expect(has(b, "joined")).toBe(true);
    expect(reg.rooms.get(rid)?.has(b.pin!)).toBe(true);
    expect(has(a, "peer-joined")).toBe(true);
  });

  it("a knock to deny is refused (knocker told denied, NOT admitted)", () => {
    const { a, b, rid } = liveCall(reg);
    handleMessage(reg, b.asConn(), { type: "leave" });
    handleMessage(reg, b.asConn(), { type: "knock", to: a.pin! });
    b.outbox.length = 0;
    handleMessage(reg, a.asConn(), { type: "knock-deny", roomId: rid, pin: b.pin! });
    expect(find(b, "knock-result")?.reason).toBe("denied");
    expect(reg.rooms.get(rid)?.has(b.pin!)).toBe(false);
  });

  it("a STRANGER who was never in the room cannot knock (roster gate)", () => {
    const { a } = liveCall(reg);
    const carol = register(reg, "Carol"); // never in Alice+Bob's room
    handleMessage(reg, carol.asConn(), { type: "knock", to: a.pin! });
    // No knock reaches the host; Carol is told the call's unavailable.
    expect(has(a, "knock")).toBe(false);
    expect(find(carol, "knock-result")?.ok).toBe(false);
  });

  it("only a moderator can approve a knock, and only a PENDING one (no forged admit)", () => {
    const { a, b, rid } = liveCall(reg);
    handleMessage(reg, b.asConn(), { type: "leave" });
    // Carol is a bystander (was never in the room).
    const carol = register(reg, "Carol");
    handleMessage(reg, b.asConn(), { type: "knock", to: a.pin! });
    // A non-moderator (Carol) tries to approve Bob → ignored.
    handleMessage(reg, carol.asConn(), { type: "knock-approve", roomId: rid, pin: b.pin! });
    expect(reg.rooms.get(rid)?.has(b.pin!)).toBe(false);
    // Even the host approving a pin that never knocked → ignored (no injection).
    handleMessage(reg, a.asConn(), { type: "knock-approve", roomId: rid, pin: carol.pin! });
    expect(reg.rooms.get(rid)?.has(carol.pin!)).toBe(false);
  });

  it("without MULTI_DEVICE_RING, a 2nd device requesting a taken number gets a DIFFERENT number", () => {
    delete process.env.MULTI_DEVICE_RING;
    const d1 = new FakeConn("dev1");
    handleMessage(reg, d1.asConn(), { type: "register", name: "Sam" });
    const num = d1.pin!;
    const d2 = new FakeConn("dev2");
    handleMessage(reg, d2.asConn(), { type: "register", name: "Sam", pin: num });
    expect(d2.pin).not.toBe(num); // evicts → fresh number (current behaviour)
  });

  it("with MULTI_DEVICE_RING: two devices share a number, both ring, first accept cancels the rest, and in-call signal routes to the accepter", () => {
    process.env.MULTI_DEVICE_RING = "1";
    try {
      const caller = new FakeConn("caller");
      handleMessage(reg, caller.asConn(), { type: "register", name: "Caller" });
      const callerPin = caller.pin!;

      const d1 = new FakeConn("dev1");
      handleMessage(reg, d1.asConn(), { type: "register", name: "Callee" });
      const number = d1.pin!;
      const d2 = new FakeConn("dev2");
      handleMessage(reg, d2.asConn(), { type: "register", name: "Callee", pin: number });
      expect(d2.pin).toBe(number); // SAME number on the 2nd device

      // Caller rings the number → BOTH devices ring.
      d1.outbox.length = 0; d2.outbox.length = 0;
      handleMessage(reg, caller.asConn(), { type: "invite", to: number });
      expect(has(d1, "ring")).toBe(true);
      expect(has(d2, "ring")).toBe(true);
      const ring = d1.outbox.find((m) => typeOf(m) === "ring") as { from: string; roomId: string };
      expect(ring.from).toBe(callerPin);

      // Device 2 answers → device 1 gets "answered elsewhere", device 2 joins.
      d1.outbox.length = 0; d2.outbox.length = 0;
      handleMessage(reg, d2.asConn(), { type: "accept", roomId: ring.roomId });
      expect(has(d2, "joined")).toBe(true);
      const cancel = d1.outbox.find((m) => typeOf(m) === "ring-cancel") as { from: string } | undefined;
      expect(cancel?.from).toBe(callerPin);

      // The accepting DEVICE is now primary: an in-call signal to the number
      // routes to device 2, not device 1.
      d1.outbox.length = 0; d2.outbox.length = 0;
      handleMessage(reg, caller.asConn(), { type: "signal", to: number, data: { sdp: { type: "offer" } } });
      expect(has(d2, "signal")).toBe(true);
      expect(has(d1, "signal")).toBe(false);
    } finally {
      delete process.env.MULTI_DEVICE_RING;
    }
  });

  // ── multi-device hardening (v2.99.5, pre-enable review) ──────────────────
  /** Register two devices sharing one number; returns [d1, d2, number]. */
  function twoDevices(reg2: RelayRegistry): [FakeConn, FakeConn, string] {
    const d1 = new FakeConn("dev1");
    handleMessage(reg2, d1.asConn(), { type: "register", name: "Callee" });
    const number = d1.pin!;
    const d2 = new FakeConn("dev2");
    handleMessage(reg2, d2.asConn(), { type: "register", name: "Callee", pin: number });
    return [d1, d2, number];
  }

  it("declining on ONE device ring-cancels the number's OTHER devices (reason: declined)", () => {
    process.env.MULTI_DEVICE_RING = "1";
    try {
      const caller = new FakeConn("caller");
      handleMessage(reg, caller.asConn(), { type: "register", name: "Caller" });
      const [d1, d2, number] = twoDevices(reg);
      handleMessage(reg, caller.asConn(), { type: "invite", to: number });
      expect(has(d1, "ring")).toBe(true);
      expect(has(d2, "ring")).toBe(true);
      d1.outbox.length = 0; d2.outbox.length = 0; caller.outbox.length = 0;
      // Device 1 declines → device 2 stops ringing too, caller sees rejected.
      handleMessage(reg, d1.asConn(), { type: "reject", to: caller.pin! });
      const cancel = d2.outbox.find((m) => typeOf(m) === "ring-cancel") as { from: string; reason?: string } | undefined;
      expect(cancel?.from).toBe(caller.pin);
      expect(cancel?.reason).toBe("declined");
      expect(has(caller, "rejected")).toBe(true);
      // The declining device itself gets no self-cancel.
      expect(has(d1, "ring-cancel")).toBe(false);
    } finally {
      delete process.env.MULTI_DEVICE_RING;
    }
  });

  it("the accept fan-out labels its cancel (reason: answered)", () => {
    process.env.MULTI_DEVICE_RING = "1";
    try {
      const caller = new FakeConn("caller");
      handleMessage(reg, caller.asConn(), { type: "register", name: "Caller" });
      const [d1, d2, number] = twoDevices(reg);
      handleMessage(reg, caller.asConn(), { type: "invite", to: number });
      const ring = d1.outbox.find((m) => typeOf(m) === "ring") as { roomId: string };
      d1.outbox.length = 0; d2.outbox.length = 0;
      handleMessage(reg, d2.asConn(), { type: "accept", roomId: ring.roomId });
      const cancel = d1.outbox.find((m) => typeOf(m) === "ring-cancel") as { reason?: string } | undefined;
      expect(cancel?.reason).toBe("answered");
    } finally {
      delete process.env.MULTI_DEVICE_RING;
    }
  });

  it("a SECONDARY device registering while the number's call lives on the primary gets NO rejoin (no call hijack)", () => {
    process.env.MULTI_DEVICE_RING = "1";
    try {
      const caller = new FakeConn("caller");
      handleMessage(reg, caller.asConn(), { type: "register", name: "Caller" });
      const d1 = new FakeConn("dev1");
      handleMessage(reg, d1.asConn(), { type: "register", name: "Callee" });
      const number = d1.pin!;
      handleMessage(reg, caller.asConn(), { type: "invite", to: number });
      const ring = d1.outbox.find((m) => typeOf(m) === "ring") as { roomId: string };
      handleMessage(reg, d1.asConn(), { type: "accept", roomId: ring.roomId }); // d1 mid-call
      // A fresh device now opens the app and registers the same number.
      const d2 = new FakeConn("dev2");
      handleMessage(reg, d2.asConn(), { type: "register", name: "Callee", pin: number });
      expect(d2.pin).toBe(number);
      expect(has(d2, "rejoin")).toBe(false); // NOT dragged into the live call
      // The in-call primary keeps routing: a signal still reaches d1, not d2.
      d1.outbox.length = 0; d2.outbox.length = 0;
      handleMessage(reg, caller.asConn(), { type: "signal", to: number, data: { sdp: { type: "offer" } } });
      expect(has(d1, "signal")).toBe(true);
      expect(has(d2, "signal")).toBe(false);
    } finally {
      delete process.env.MULTI_DEVICE_RING;
    }
  });

  it("a secondary's RE-AFFIRM register mid-call gets no rejoin either (isPrimaryChannel guard)", () => {
    process.env.MULTI_DEVICE_RING = "1";
    try {
      const caller = new FakeConn("caller");
      handleMessage(reg, caller.asConn(), { type: "register", name: "Caller" });
      const [d1, d2, number] = twoDevices(reg);
      handleMessage(reg, caller.asConn(), { type: "invite", to: number });
      const ring = d1.outbox.find((m) => typeOf(m) === "ring") as { roomId: string };
      handleMessage(reg, d1.asConn(), { type: "accept", roomId: ring.roomId }); // d1 is primary now
      d2.outbox.length = 0;
      // d2's geo-flag re-affirm (its conn.pin is already bound) must not rejoin.
      handleMessage(reg, d2.asConn(), { type: "register", name: "Callee", flag: "🇦🇪" });
      expect(has(d2, "registered")).toBe(true);
      expect(has(d2, "rejoin")).toBe(false);
    } finally {
      delete process.env.MULTI_DEVICE_RING;
    }
  });

  it("identity-switch on one device PROMOTES a survivor — the number stays reachable on the other device", () => {
    process.env.MULTI_DEVICE_RING = "1";
    try {
      const [d1, , number] = twoDevices(reg); // d2 became primary (latest registration)
      // Device 2 signs out → its engine restarts and registers a NEW identity
      // number on the same browser channel (same cid, fresh connection).
      const freePin = "999999";
      const d2b = new FakeConn("dev2");
      handleMessage(reg, d2b.asConn(), { type: "register", name: "Guest", pin: freePin });
      expect(d2b.pin).toBe(freePin);
      // The ORIGINAL number was not torn down: device 1 was promoted primary…
      expect(reg.clients.get(number)?.cid).toBe("dev1");
      // …and an incoming call still rings device 1.
      const caller = new FakeConn("caller");
      handleMessage(reg, caller.asConn(), { type: "register", name: "Caller" });
      d1.outbox.length = 0;
      handleMessage(reg, caller.asConn(), { type: "invite", to: number });
      expect(has(d1, "ring")).toBe(true);
    } finally {
      delete process.env.MULTI_DEVICE_RING;
    }
  });

  it("MULTI_DEVICE_RING=1 is baked into the .io pm2 config BEFORE the .env spread (operator can still override)", () => {
    const eco = fs.readFileSync(path.resolve(__dirname, "..", "ecosystem.config.cjs"), "utf8");
    expect(eco).toMatch(/MULTI_DEVICE_RING: "1", \.\.\.loadEnvFile\("\/home\/relay\/\.env"\)/);
  });

  it("a device registering MID-RING gets the pending ring on ITS OWN socket", () => {
    process.env.MULTI_DEVICE_RING = "1";
    try {
      const caller = new FakeConn("caller");
      handleMessage(reg, caller.asConn(), { type: "register", name: "Caller" });
      const d1 = new FakeConn("dev1");
      handleMessage(reg, d1.asConn(), { type: "register", name: "Callee" });
      const number = d1.pin!;
      handleMessage(reg, caller.asConn(), { type: "invite", to: number });
      expect(has(d1, "ring")).toBe(true);
      // The user now opens the app on a SECOND device while it's still ringing.
      const d2 = new FakeConn("dev2");
      handleMessage(reg, d2.asConn(), { type: "register", name: "Callee", pin: number });
      expect(has(d2, "ring")).toBe(true); // delivered to the registering socket
    } finally {
      delete process.env.MULTI_DEVICE_RING;
    }
  });
});

describe("v2.70 — in-call disconnect grace broadcasts peer-left to survivors", () => {
  it("the grace-expiry path emits peer-left so survivors reflow + get notified", () => {
    // Behavioral coverage needs the 30s grace timer + a full room; pin the
    // source so the authoritative-exit broadcast can't silently regress.
    const src = require("node:fs").readFileSync(require("node:path").resolve(__dirname, "relay.ts"), "utf8");
    expect(src).toMatch(/broadcastToRoom\(reg, rid, \{ type: "peer-left", pin \}, pin\)/);
  });
});
