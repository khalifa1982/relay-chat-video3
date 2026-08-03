import { describe, expect, it, beforeEach } from "vitest";
import {
  createRegistry,
  handleMessage,
  releaseHeldRoom,
  type RelayRegistry,
  type RelaySocket,
  type MissedCallHook,
} from "./relay";

/**
 * Call-waiting HOLD / SWAP / MERGE / END-ACTIVE state machine.
 *
 * The user's #1 requirement: answering a second call must put the FIRST call on
 * HOLD (never drop it), the user must be able to SWAP back and resume, optionally
 * MERGE both into a 3-way, and ending one line must resume the other. These tests
 * exercise the server pointers (pinRoom = active, heldRoom = held), the member
 * Sets, and the notifications each party receives — deterministically, with no
 * media. "Eliminate dropped calls" is verified by asserting the held member stays
 * in BOTH rooms across every transition until they explicitly end it.
 */

type Sent = Record<string, unknown>;
class FakeConn {
  outbox: Sent[] = [];
  pin: string | null = null;
  socket: RelaySocket;
  cid: string | undefined;
  constructor(cid?: string) {
    this.cid = cid;
    this.socket = { send: (o: unknown) => { this.outbox.push(o as Sent); }, close: () => {} };
  }
  setPin = (p: string) => { this.pin = p; };
  asConn() { return { socket: this.socket, pin: this.pin, setPin: this.setPin, cid: this.cid }; }
  clear() { this.outbox.length = 0; }
  msgs(type: string) { return this.outbox.filter(m => m.type === type); }
  last(type: string) { return [...this.outbox].reverse().find(m => m.type === type); }
}

function register(reg: RelayRegistry, name: string): { conn: FakeConn; pin: string } {
  const c = new FakeConn(name + "-cid");
  handleMessage(reg, c.asConn(), { type: "register", name });
  const pin = (c.last("registered") as { pin: string }).pin;
  return { conn: c, pin };
}

/** Drive a real 2-party call: caller invites callee, callee accepts. Returns the
 *  room id (caller's `room` envelope). */
function makeCall(reg: RelayRegistry, caller: FakeConn, callee: FakeConn, calleePin: string): string {
  handleMessage(reg, caller.asConn(), { type: "invite", to: calleePin });
  const room = (caller.last("room") as { roomId: string }).roomId;
  handleMessage(reg, callee.asConn(), { type: "accept", roomId: room });
  return room;
}

describe("call-waiting hold / swap / merge", () => {
  let reg: RelayRegistry;
  beforeEach(() => { reg = createRegistry(); });

  // Bob is in call A (with Alice); Carol rings; Bob answers Carol → A is HELD.
  function holdScenario() {
    const alice = register(reg, "Alice");
    const bob = register(reg, "Bob");
    const carol = register(reg, "Carol");
    const roomA = makeCall(reg, alice.conn, bob.conn, bob.pin);
    // Carol rings Bob → call-waiting room R.
    handleMessage(reg, carol.conn.asConn(), { type: "invite", to: bob.pin });
    const roomR = (carol.conn.last("room") as { roomId: string }).roomId;
    alice.conn.clear(); carol.conn.clear(); bob.conn.clear();
    // Bob answers Carol → A held, R active.
    handleMessage(reg, bob.conn.asConn(), { type: "accept", roomId: roomR });
    return { alice, bob, carol, roomA, roomR };
  }

  it("holds the first call (member stays in both rooms; first party told 'on hold')", () => {
    const { alice, bob, roomA, roomR } = holdScenario();
    expect(reg.pinRoom.get(bob.pin)).toBe(roomR);
    expect(reg.heldRoom.get(bob.pin)).toBe(roomA);
    expect(reg.rooms.get(roomA)?.has(bob.pin)).toBe(true);
    expect(reg.rooms.get(roomR)?.has(bob.pin)).toBe(true);
    const hold = alice.conn.last("peer-hold") as { pin: string; on: boolean } | undefined;
    expect(hold?.on).toBe(true);
    expect(hold?.pin).toBe(bob.pin);
    expect(alice.conn.msgs("peer-left").length).toBe(0); // NOT dropped
  });

  it("swaps active <-> held and notifies both rooms", () => {
    const { alice, bob, carol, roomA, roomR } = holdScenario();
    alice.conn.clear(); carol.conn.clear(); bob.conn.clear();
    handleMessage(reg, bob.conn.asConn(), { type: "swap" });
    // Now A is active, R is held.
    expect(reg.pinRoom.get(bob.pin)).toBe(roomA);
    expect(reg.heldRoom.get(bob.pin)).toBe(roomR);
    // Both rooms still contain Bob.
    expect(reg.rooms.get(roomA)?.has(bob.pin)).toBe(true);
    expect(reg.rooms.get(roomR)?.has(bob.pin)).toBe(true);
    // Alice (now-active) hears resume; Carol (now-held) hears hold.
    expect((alice.conn.last("peer-hold") as { on: boolean }).on).toBe(false);
    expect((carol.conn.last("peer-hold") as { on: boolean }).on).toBe(true);
    // Bob gets a `resumed` envelope for room A with Alice in the member list.
    const resumed = bob.conn.last("resumed") as { roomId: string; members: Array<{ pin: string }> };
    expect(resumed.roomId).toBe(roomA);
    expect(resumed.members.some(m => m.pin === alice.pin)).toBe(true);
  });

  it("swaps back and forth without ever dropping either call", () => {
    const { bob, roomA, roomR } = holdScenario();
    handleMessage(reg, bob.conn.asConn(), { type: "swap" }); // A active
    handleMessage(reg, bob.conn.asConn(), { type: "swap" }); // R active again
    expect(reg.pinRoom.get(bob.pin)).toBe(roomR);
    expect(reg.heldRoom.get(bob.pin)).toBe(roomA);
    expect(reg.rooms.get(roomA)?.has(bob.pin)).toBe(true);
    expect(reg.rooms.get(roomR)?.has(bob.pin)).toBe(true);
  });

  it("end-active ends the active line and resumes the held one", () => {
    const { alice, bob, carol, roomA, roomR } = holdScenario();
    alice.conn.clear(); carol.conn.clear(); bob.conn.clear();
    handleMessage(reg, bob.conn.asConn(), { type: "end-active" });
    // Bob left R (active) and resumed A.
    expect(reg.rooms.get(roomR)?.has(bob.pin)).toBe(false);
    expect(reg.heldRoom.get(bob.pin)).toBeUndefined();
    expect(reg.pinRoom.get(bob.pin)).toBe(roomA);
    expect(reg.rooms.get(roomA)?.has(bob.pin)).toBe(true);
    // Carol is told Bob left; Alice is told Bob is back (peer-hold off).
    expect((carol.conn.last("peer-left") as { pin: string }).pin).toBe(bob.pin);
    expect((alice.conn.last("peer-hold") as { on: boolean }).on).toBe(false);
    // Bob gets a `resumed` for A.
    expect((bob.conn.last("resumed") as { roomId: string }).roomId).toBe(roomA);
  });

  it("merges the held call into the active call (3-way) and reaps the old room", () => {
    const { alice, bob, carol, roomA, roomR } = holdScenario();
    alice.conn.clear(); carol.conn.clear(); bob.conn.clear();
    handleMessage(reg, bob.conn.asConn(), { type: "merge" });
    // Everyone now in room R; room A is gone.
    expect(reg.heldRoom.get(bob.pin)).toBeUndefined();
    expect(reg.rooms.get(roomR)?.has(bob.pin)).toBe(true);
    expect(reg.rooms.get(roomR)?.has(alice.pin)).toBe(true);
    expect(reg.rooms.get(roomR)?.has(carol.pin)).toBe(true);
    expect(reg.rooms.has(roomA)).toBe(false);
    expect(reg.pinRoom.get(alice.pin)).toBe(roomR);
    // Alice (moved) is told to join R; Carol (already there) sees Alice join.
    expect((alice.conn.last("joined") as { roomId: string }).roomId).toBe(roomR);
    expect(carol.conn.msgs("peer-joined").some(m => (m as { pin: string }).pin === alice.pin)).toBe(true);
    // Bob gets a merged confirmation listing both peers.
    const merged = bob.conn.last("merged") as { members: Array<{ pin: string }> };
    expect(merged.members.some(m => m.pin === alice.pin)).toBe(true);
    expect(merged.members.some(m => m.pin === carol.pin)).toBe(true);
  });

  it("a full hang-up (leave) drops BOTH the active and the held call", () => {
    const { alice, bob, carol, roomA, roomR } = holdScenario();
    alice.conn.clear(); carol.conn.clear();
    handleMessage(reg, bob.conn.asConn(), { type: "leave" });
    expect(reg.rooms.get(roomA)?.has(bob.pin)).toBeFalsy();
    expect(reg.rooms.get(roomR)?.has(bob.pin)).toBeFalsy();
    expect(reg.heldRoom.get(bob.pin)).toBeUndefined();
    expect(reg.pinRoom.get(bob.pin)).toBeUndefined();
    // Both the held party (Alice) and the active party (Carol) hear he left.
    expect((alice.conn.last("peer-left") as { pin: string }).pin).toBe(bob.pin);
    expect((carol.conn.last("peer-left") as { pin: string }).pin).toBe(bob.pin);
  });

  it("rejecting a call-waiting call logs a missed call for the would-be answerer", () => {
    const alice = register(reg, "Alice");
    const bob = register(reg, "Bob");
    const carol = register(reg, "Carol");
    makeCall(reg, alice.conn, bob.conn, bob.pin);
    const missed: Array<{ calleePin: string; callerPin: string; reason: string }> = [];
    const hook: MissedCallHook = (i) => missed.push(i);
    // Carol rings Bob (call waiting); Bob declines.
    handleMessage(reg, carol.conn.asConn(), { type: "invite", to: bob.pin }, undefined, hook);
    handleMessage(reg, bob.conn.asConn(), { type: "reject", to: carol.pin }, undefined, hook);
    const rec = missed.find(m => m.callerPin === carol.pin && m.calleePin === bob.pin);
    expect(rec?.reason).toBe("rejected");
  });

  it("a SOLO dialing room is dropped (not held) when answering an incoming call", () => {
    // Bob dials Dave (solo room, nobody answered) then accepts Carol's call. The
    // solo room must be LEFT, not held — only real calls (with other members) hold.
    const bob = register(reg, "Bob");
    const dave = register(reg, "Dave");
    const carol = register(reg, "Carol");
    handleMessage(reg, bob.conn.asConn(), { type: "invite", to: dave.pin }); // Bob solo-dialing
    const solo = (bob.conn.last("room") as { roomId: string }).roomId;
    handleMessage(reg, carol.conn.asConn(), { type: "invite", to: bob.pin });
    const roomR = (carol.conn.last("room") as { roomId: string }).roomId;
    handleMessage(reg, bob.conn.asConn(), { type: "accept", roomId: roomR });
    expect(reg.heldRoom.get(bob.pin)).toBeUndefined();         // nothing held
    expect(reg.rooms.get(solo)?.has(bob.pin)).toBeFalsy();      // solo room left
    expect(reg.pinRoom.get(bob.pin)).toBe(roomR);
  });

  it("swap / merge with nothing on hold refuses with `holdgone`, NOT the code that hangs up", () => {
    /* REWRITTEN v2.107.14, and the old expectation was the bug rather than the
       contract. `nohold` is the answer to `end-active`, and the client HANGS UP on
       it — correctly, because after an end-active there is nothing left to resume.
       Sending the same code from `swap` and `merge` meant a user in a live call
       whose HELD party had just left tapped Merge, and the client ended the call
       they were actually on. Two different facts, two codes; the shared envelope is
       the `knockfail` lesson over again. */
    const alice = register(reg, "Alice");
    const bob = register(reg, "Bob");
    makeCall(reg, alice.conn, bob.conn, bob.pin);
    for (const type of ["swap", "merge"] as const) {
      bob.conn.clear();
      handleMessage(reg, bob.conn.asConn(), { type });
      const code = (bob.conn.last("error") as { code: string }).code;
      expect(code, `${type} must not answer with the hang-up code`).toBe("holdgone");
      expect(code).not.toBe("nohold");
    }
  });

  it("`nohold` is still what an end-active with nothing to resume answers", () => {
    // The other half of the split: the code that hangs up must keep reaching the
    // one case that wants it, or v2.99.36's wedge comes back.
    const alice = register(reg, "Alice");
    const bob = register(reg, "Bob");
    makeCall(reg, alice.conn, bob.conn, bob.pin);
    bob.conn.clear();
    handleMessage(reg, bob.conn.asConn(), { type: "end-active" });
    expect((bob.conn.last("error") as { code: string }).code).toBe("nohold");
  });

  it("releaseHeldRoom drops only the held room and notifies its members", () => {
    const { alice, bob, carol, roomA, roomR } = holdScenario();
    alice.conn.clear(); carol.conn.clear();
    releaseHeldRoom(reg, bob.pin);
    expect(reg.heldRoom.get(bob.pin)).toBeUndefined();
    expect(reg.rooms.get(roomA)?.has(bob.pin)).toBeFalsy();    // held room left
    expect(reg.pinRoom.get(bob.pin)).toBe(roomR);              // active untouched
    expect(reg.rooms.get(roomR)?.has(bob.pin)).toBe(true);
    expect((alice.conn.last("peer-left") as { pin: string }).pin).toBe(bob.pin);
    expect(carol.conn.msgs("peer-left").length).toBe(0);       // active peer unaffected
  });

  it("the held partner hanging up first leaves the holder's active call intact", () => {
    // Alice (the held party) hangs up while Bob is on the other line. Bob's ACTIVE
    // call with Carol must be untouched; his hold simply clears server-side when
    // room A empties.
    const { bob, carol, roomA, roomR } = holdScenario();
    const alicePin = Array.from(reg.rooms.get(roomA) || []).find(p => p !== bob.pin)!;
    handleMessage(reg, { socket: { send: () => {}, close: () => {} }, pin: alicePin, setPin: () => {} }, { type: "leave" });
    // Bob is still actively in R with Carol.
    expect(reg.pinRoom.get(bob.pin)).toBe(roomR);
    expect(reg.rooms.get(roomR)?.has(bob.pin)).toBe(true);
    expect(reg.rooms.get(roomR)?.has(carol.pin)).toBe(true);
    // Room A now only (maybe) lists Bob as a held ghost — it never affected R.
    expect(reg.rooms.get(roomR)?.has(alicePin)).toBeFalsy();
  });
});
