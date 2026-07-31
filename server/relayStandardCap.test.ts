import { describe, expect, it, beforeEach } from "vitest";
import {
  createRegistry,
  handleMessage,
  type RelayRegistry,
  type RelaySocket,
} from "./relay";

/**
 * The STANDARD (identity) call cap was previously untested — only the party-line
 * cap had coverage (relayPartyLine.test.ts). A conference audit flagged this
 * gap. These fill a real mesh room to the 6-cap and assert the 7th join is
 * refused with error{code:"full"} at BOTH enforcement points (invite + accept),
 * and that the room never exceeds the cap. The cap is 6 unconditionally since
 * v2.106.53 — one transport, one number (`ROOM_MAX`).
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
  ofType(t: string): Sent[] { return this.outbox.filter(m => m.type === t); }
  asConn() { return { socket: this.socket, pin: this.pin, setPin: this.setPin, cid: undefined }; }
}

function register(reg: RelayRegistry, name: string, pin: string) {
  const c = new FakeConn();
  handleMessage(reg, c.asConn(), { type: "register", name, pin });
  return c;
}

describe("standard call cap (mesh 6)", () => {
  let reg: RelayRegistry;
  beforeEach(() => { reg = createRegistry(); });

  /** Host `host` dials `pin` into their room and the callee accepts it. */
  function addToRoom(host: FakeConn, callee: FakeConn) {
    host.outbox.length = 0;
    handleMessage(reg, host.asConn(), { type: "invite", to: callee.pin! });
    const room = host.ofType("room")[0] as { roomId?: string } | undefined;
    const roomId = room?.roomId ?? reg.pinRoom.get(host.pin!);
    handleMessage(reg, callee.asConn(), { type: "accept", roomId });
    return roomId!;
  }

  it("refuses the 7th participant at INVITE time with error{full}", () => {
    const host = register(reg, "Host", "100000");
    let roomId = "";
    // Fill to 6 total: host + 5 accepted callees.
    for (let i = 1; i <= 5; i++) {
      roomId = addToRoom(host, register(reg, `M${i}`, `10000${i}`));
    }
    expect(reg.rooms.get(roomId)?.size).toBe(6);

    // The 7th invite from the (full) host is rejected — the HOST is told.
    host.outbox.length = 0;
    const seventh = register(reg, "Seven", "200007");
    handleMessage(reg, host.asConn(), { type: "invite", to: seventh.pin! });
    const err = host.ofType("error")[0];
    expect(err?.code).toBe("full");
    // The 7th was never rung and never joined.
    expect(seventh.ofType("ring").length).toBe(0);
    expect(reg.rooms.get(roomId)?.size).toBe(6);
    expect(reg.pinRoom.get("200007")).toBeUndefined();
  });

  it("refuses an accept that would overflow the room with error{full}", () => {
    const host = register(reg, "Host", "100000");
    let roomId = "";
    // Fill to 5 total: host + 4 accepted.
    for (let i = 1; i <= 4; i++) {
      roomId = addToRoom(host, register(reg, `M${i}`, `10000${i}`));
    }
    expect(reg.rooms.get(roomId)?.size).toBe(5);

    // Invite TWO more while there's still room — both get rung, so both are
    // legitimately "invited" (they pass the not-invited `forbidden` guard).
    const g = register(reg, "Gee", "200009");
    const h = register(reg, "Aitch", "200010");
    handleMessage(reg, host.asConn(), { type: "invite", to: g.pin! });
    handleMessage(reg, host.asConn(), { type: "invite", to: h.pin! });

    // G accepts first → the room hits the 6 cap.
    handleMessage(reg, g.asConn(), { type: "accept", roomId });
    expect(reg.rooms.get(roomId)?.size).toBe(6);

    // H was invited too, but the room is now full → the accept is bounced with
    // full (NOT silently added, NOT the not-invited `forbidden`).
    handleMessage(reg, h.asConn(), { type: "accept", roomId });
    const err = h.ofType("error")[0];
    expect(err?.code).toBe("full");
    expect(reg.rooms.get(roomId)?.has("200010")).toBe(false);
  });
});
