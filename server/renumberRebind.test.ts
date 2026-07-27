/* ============================================================
   v2.99.83 — a renumbered person stays reachable.

   THE BUG, proven by two of the owner's screenshots seconds apart: dialling
   909 090 showed "Mohamed Idris · Registered · online now" in the dialer, and the
   call immediately answered "Mohamed Idris is offline right now."

   Presence is a DB row keyed on identityId. The signaling registry — the thing that
   actually routes a call — is in memory and keyed on the 6-digit PIN.
   `regenerateIdentityNumber` moved the database and every stored copy of the number
   inside one transaction and touched the registry NOT AT ALL, so the person stayed
   registered under their OLD pin: unreachable at the number they now own, and still
   occupying one that no longer exists.

   Three more owner-reported symptoms were the same bug: the in-call "Add to
   contacts" pill reappearing for somebody already SAVED (the roster names the old
   pin while their contact row was rewritten), and Contacts showing them plain
   "online" instead of "on a call" (pinsInCall reports the old pin).

   TESTED BEHAVIOURALLY against the REAL registry. A source pin cannot tell you
   whether a call actually connects after a rename, and that is the entire feature.
   ============================================================ */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  createRegistry,
  handleMessage,
  rebindRegisteredPin,
  pinsInCall,
  _setActiveRegistryForTests,
  type RelayConnection,
  type RelayRegistry,
  type RelaySocket,
} from "./relay";

type Sent = Record<string, unknown>;

/**
 * Mirrors what `attachRelay` really does per browser, and the two details it
 * mirrors are load-bearing for this feature rather than incidental:
 *
 *  - the STABLE `RelayConnection` object lives in `reg.connections` keyed by cid,
 *    and it is that object's `.pin` the rebind rewrites. A harness that only
 *    snapshotted the pin would report the rebind as working while the next
 *    message from that browser still arrived carrying the OLD number.
 *  - the wrapper handed to `handleMessage` is rebuilt per message and reads the
 *    entry's pin LIVE (`attachRelay` line: `setPin: (p) => { c.pin = p; }`), so a
 *    rename between two messages is visible to the second one.
 */
class FakeConn {
  outbox: Sent[] = [];
  entry: RelayConnection;
  alive = true;
  constructor(readonly cid: string) {
    const socket: RelaySocket = {
      send: (obj: unknown) => this.outbox.push(obj as Sent),
      close: () => { this.alive = false; },
      alive: () => this.alive,
    };
    this.entry = { cid, socket, pin: null };
  }
  get pin(): string | null { return this.entry.pin; }
  ofType(t: string): Sent[] { return this.outbox.filter((m) => m.type === t); }
  last(t: string): Sent | undefined { return this.ofType(t).slice(-1)[0]; }
  asConn() {
    const e = this.entry;
    return { socket: e.socket, pin: e.pin, setPin: (p: string) => { e.pin = p; }, cid: e.cid };
  }
}
function register(reg: RelayRegistry, name: string, pin?: string, cid?: string) {
  const c = new FakeConn(cid ?? `c-${name}-${reg.clients.size}`);
  reg.connections.set(c.cid, c.entry);
  handleMessage(reg, c.asConn(), { type: "register", name, pin });
  return c;
}
/**
 * Answer the way a real client does: an `accept` must name the room the RING
 * carried, because a bare accept cannot be authorized (a client that merely
 * learned a roomId must not be able to walk into a call — v2.99.43/M45).
 * Passing `{type:"accept"}` alone therefore silently does nothing, which is how
 * this harness first reported a working rebind as broken.
 */
function answer(reg: RelayRegistry, callee: FakeConn, extra: Record<string, unknown> = {}) {
  const ring = callee.last("ring");
  expect(ring, "the callee actually got a ring to answer").toBeTruthy();
  handleMessage(reg, callee.asConn(), { type: "accept", roomId: ring!.roomId, ...extra });
}
const read = (rel: string) => readFileSync(join(__dirname, rel), "utf8");
const RELAY = read("relay.ts");
const V2DB = read("v2db.ts");
const EVENTS = read("v2events.ts");
const CLUSTER = read("relayCluster.ts");
const CLI = read("../scripts/admin-tool.mjs");

function codeOnly(src: string): string {
  return src
    .split("\n")
    .filter((l) => {
      const t = l.trim();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");
}

/* ── the reported bug, end to end ──────────────────────────── */

describe("the reported bug: a renumbered person can be called", () => {
  let reg: RelayRegistry;
  beforeEach(() => { reg = createRegistry(); });

  it("BEFORE the rebind the new number is unreachable — the bug, reproduced", () => {
    register(reg, "Mohamed", "596484", "cM");
    // Nothing answers at the number they now own.
    expect(reg.clients.has("909090")).toBe(false);
    expect(reg.clients.has("596484")).toBe(true);
  });

  it("AFTER the rebind an invite to the NEW number rings them", () => {
    const mo = register(reg, "Mohamed", "596484", "cM");
    const caller = register(reg, "Khalifa", "777777", "cK");

    rebindRegisteredPin(reg, { identityId: 23, oldNumber: "596484", newNumber: "909090" });

    handleMessage(reg, caller.asConn(), { type: "invite", to: "909090" });
    expect(mo.ofType("ring").length, "the renumbered person actually rings").toBe(1);
    expect(caller.ofType("error").length, "the caller gets no offline error").toBe(0);
  });

  it("the OLD number is RETIRED — it rings nobody and is never aliased", () => {
    const mo = register(reg, "Mohamed", "596484", "cM");
    const caller = register(reg, "Khalifa", "777777", "cK");
    rebindRegisteredPin(reg, { identityId: 23, oldNumber: "596484", newNumber: "909090" });

    handleMessage(reg, caller.asConn(), { type: "invite", to: "596484" });
    expect(mo.ofType("ring").length, "the old number rings nobody").toBe(0);
    // An alias would re-create two addresses for one identity — the split being
    // removed — and would bypass the block-follows-you property, because
    // contacts.number was rewritten in the same transaction.
    expect(reg.clients.has("596484")).toBe(false);
  });

  it("tells the client its pin moved WITHOUT making it re-register", () => {
    // Re-registering mid-call is read as an identity switch and drops the call, so
    // the server pushes the new pin instead. The client's existing `registered`
    // handler already adopts and persists it, so an older client needs no change.
    const mo = register(reg, "Mohamed", "596484", "cM");
    const before = mo.ofType("registered").length;
    rebindRegisteredPin(reg, { identityId: 23, oldNumber: "596484", newNumber: "909090" });
    const after = mo.ofType("registered");
    expect(after.length).toBe(before + 1);
    expect(after.slice(-1)[0]).toMatchObject({ pin: "909090", renumbered: true });
  });
});

/* ── the three knock-on symptoms ───────────────────────────── */

describe("the knock-on symptoms the owner also reported", () => {
  let reg: RelayRegistry;
  beforeEach(() => { reg = createRegistry(); });
  // The busy-line reads target a module global; leaving this registry installed
  // would leak into every later file in the run.
  afterEach(() => { _setActiveRegistryForTests(null); });

  it("the room ROSTER carries the new pin, so a saved contact stops showing Add", () => {
    const a = register(reg, "Ahmed", "483307", "cA");
    const k = register(reg, "Khalifa", "777777", "cK");
    handleMessage(reg, k.asConn(), { type: "invite", to: "483307" });
    answer(reg, a);
    const rid = reg.pinRoom.get("483307")!;
    expect(rid).toBeTruthy();

    rebindRegisteredPin(reg, { identityId: 60, oldNumber: "483307", newNumber: "699999" });

    const room = reg.rooms.get(rid)!;
    expect(room.has("699999"), "membership moved").toBe(true);
    expect(room.has("483307"), "the old pin is gone from the room").toBe(false);
    const meta = reg.roomMeta.get(rid)!;
    // REWRITTEN IN PLACE, not appended — the roster is add-only everywhere else,
    // and appending would leave a permanent phantom in the conference history.
    expect(meta.roster.get("699999")).toBe("Ahmed");
    expect(meta.roster.has("483307")).toBe(false);
    expect(reg.pinRoom.get("699999")).toBe(rid);
    expect(reg.pinRoom.has("483307")).toBe(false);
  });

  it("pinsInCall reports the NEW pin, so Contacts says 'on a call'", () => {
    // Driven through the REAL busy-line read rather than re-deriving its rule
    // here, because the owner's screenshot was Contacts saying plain "available"
    // for somebody who was in a call with them, and this function is what answers
    // that question.
    const a = register(reg, "Ahmed", "483307", "cA");
    const k = register(reg, "Khalifa", "777777", "cK");
    handleMessage(reg, k.asConn(), { type: "invite", to: "483307" });
    answer(reg, a);
    _setActiveRegistryForTests(reg);

    expect(pinsInCall(["483307"]).has("483307"), "in a call before the rename").toBe(true);

    rebindRegisteredPin(reg, { identityId: 60, oldNumber: "483307", newNumber: "699999" });

    const busy = pinsInCall(["699999", "483307"]);
    expect(busy.has("699999")).toBe(true);
    expect(busy.has("483307")).toBe(false);
  });

  it("HOST and co-host roles follow the person", () => {
    // Missing this silently strips their moderation, and succession hands it away.
    const host = register(reg, "Khalifa", "777777", "cK");
    const b = register(reg, "Ahmed", "483307", "cA");
    handleMessage(reg, host.asConn(), { type: "invite", to: "483307" });
    answer(reg, b);
    const rid = reg.pinRoom.get("777777")!;
    expect(reg.roomMeta.get(rid)!.hostPin).toBe("777777");

    rebindRegisteredPin(reg, { identityId: 3, oldNumber: "777777", newNumber: "111000" });
    expect(reg.roomMeta.get(rid)!.hostPin).toBe("111000");
  });
});

/* ── the structures a partial rename would break ───────────── */

describe("every pin-bearing structure moves together", () => {
  let reg: RelayRegistry;
  beforeEach(() => { reg = createRegistry(); });

  it("the reverse index moves, so a concurrent re-register cannot drop the call", () => {
    // `cidToPin` beats the client's requested pin in the register handler, so until
    // it moves a re-register either re-asserts the OLD pin or is misclassified as an
    // identity switch — whose body destroys the live call. This is the single most
    // dangerous omission in the whole rename.
    register(reg, "Mohamed", "596484", "cM");
    rebindRegisteredPin(reg, { identityId: 23, oldNumber: "596484", newNumber: "909090" });
    expect(reg.cidToPin.get("cM")).toBe("909090");
    expect(reg.connections.get("cM")?.pin).toBe("909090");
  });

  it("a HELD room moves too — a pin can be in two rooms at once", () => {
    // Talking in one call with another parked. Missing heldRoom makes the parked
    // call unresumable AND unkillable.
    const mo = register(reg, "Mohamed", "596484", "cM");
    const k = register(reg, "Khalifa", "777777", "cK");
    const t = register(reg, "Third", "222222", "cT");
    handleMessage(reg, k.asConn(), { type: "invite", to: "596484" });
    answer(reg, mo);
    const firstRid = reg.pinRoom.get("596484")!;
    // A second caller arrives; answering PARKS the first call automatically —
    // there is no hold flag, the accept handler parks whenever the answerer is
    // already in a different room.
    handleMessage(reg, t.asConn(), { type: "invite", to: "596484" });
    answer(reg, mo);
    const heldRid = reg.heldRoom.get("596484");
    // Asserted, never skipped: a conditional `return` here would let this test
    // pass by doing nothing, which is worse than not having it.
    expect(heldRid, "the first call really is parked").toBe(firstRid);
    expect(reg.pinRoom.get("596484"), "and the ACTIVE room is the new one").not.toBe(firstRid);

    rebindRegisteredPin(reg, { identityId: 23, oldNumber: "596484", newNumber: "909090" });
    expect(reg.heldRoom.get("909090")).toBe(heldRid);
    expect(reg.heldRoom.has("596484")).toBe(false);
    expect(reg.rooms.get(firstRid)?.has("909090")).toBe(true);
    expect(reg.rooms.get(firstRid)?.has("596484")).toBe(false);
  });

  it("another caller's `ringing` set is swept, so they can still be answered", () => {
    // `ringing` lives on the CALLER and holds OUR pin as a callee. Miss it and the
    // accept authorization cannot find the ringer, so answering fails.
    const mo = register(reg, "Mohamed", "596484", "cM");
    const caller = register(reg, "Khalifa", "777777", "cK");
    handleMessage(reg, caller.asConn(), { type: "invite", to: "596484" });
    expect(reg.clients.get("777777")!.ringing.has("596484")).toBe(true);

    rebindRegisteredPin(reg, { identityId: 23, oldNumber: "596484", newNumber: "909090" });
    expect(reg.clients.get("777777")!.ringing.has("909090")).toBe(true);
    expect(reg.clients.get("777777")!.ringing.has("596484")).toBe(false);

    // …and the accept genuinely still works.
    answer(reg, mo);
    expect(mo.ofType("error").length, "answering after a mid-ring rename works").toBe(0);
    expect(reg.pinRoom.get("909090")).toBeTruthy();
  });

  it("a pending ring moves by KEY and by `from` value", () => {
    const mo = register(reg, "Mohamed", "596484", "cM");
    const caller = register(reg, "Khalifa", "777777", "cK");
    handleMessage(reg, caller.asConn(), { type: "invite", to: "596484" });
    expect(reg.pendingRings.has("596484")).toBe(true);

    // The CALLEE renumbers: the key moves, or a mid-ring reload never gets the ring.
    rebindRegisteredPin(reg, { identityId: 23, oldNumber: "596484", newNumber: "909090" });
    expect(reg.pendingRings.has("909090")).toBe(true);
    expect(reg.pendingRings.has("596484")).toBe(false);

    // The CALLER renumbers: the `from` moves, or they can no longer cancel their own
    // ring and it blind-rejects their next call.
    rebindRegisteredPin(reg, { identityId: 3, oldNumber: "777777", newNumber: "111000" });
    const pr = reg.pendingRings.get("909090") as { from?: string } | undefined;
    expect(pr?.from).toBe("111000");
    void mo;
  });

  it("devices move (multi-device ring is live on the fleet)", () => {
    register(reg, "Mohamed", "596484", "cM");
    expect(reg.devices.has("596484")).toBe(true);
    rebindRegisteredPin(reg, { identityId: 23, oldNumber: "596484", newNumber: "909090" });
    expect(reg.devices.has("909090")).toBe(true);
    expect(reg.devices.has("596484")).toBe(false);
  });

  it("the moved registration is marked VERIFIED, and that is what makes it ringable", () => {
    // Left false, `pinIsAddressable` returns false and the person is un-ringable and
    // un-rejoinable — an "offline" INDISTINGUISHABLE from the bug being fixed. After
    // the DB commit this pin genuinely IS cookie-resolvable, so setting it is correct
    // rather than optimistic.
    //
    // The record is forced to `false` first ON PURPOSE. Registering through this
    // harness takes the non-HTTP path, where `verifiedClaim` is true by
    // construction — so a test that merely re-read the value after a rebind would
    // pass whether the assignment existed or not (it did, and the mutation run
    // caught it). Said plainly: reaching an unverified record through the FRONT
    // door is not possible today, because an unverified registration is handed a
    // random `genPin` unrelated to its identity and no renumber event can name it.
    // This is a guard on an invariant, not a reproduction of a live case.
    const mo = register(reg, "Mohamed", "596484", "cM");
    const caller = register(reg, "Khalifa", "777777", "cK");
    reg.clients.get("596484")!.verifiedPin = false;

    rebindRegisteredPin(reg, { identityId: 23, oldNumber: "596484", newNumber: "909090" });
    expect(reg.clients.get("909090")!.verifiedPin).toBe(true);

    // …and the consequence, which is the part that actually matters.
    handleMessage(reg, caller.asConn(), { type: "invite", to: "909090" });
    expect(mo.ofType("ring").length, "an addressable pin rings").toBe(1);
  });
});

/* ── the refusals ──────────────────────────────────────────── */

describe("the cases it must refuse or ignore", () => {
  let reg: RelayRegistry;
  beforeEach(() => { reg = createRegistry(); });

  it("a renumber for somebody NOT connected is a cheap silent no-op", () => {
    // The common case: a renumber while signed out, or an admin acting on somebody
    // who is not online.
    expect(rebindRegisteredPin(reg, { identityId: 9, oldNumber: "123456", newNumber: "654321" }))
      .toBe("not-registered");
  });

  it("never evicts a VERIFIED holder of the new number", () => {
    // That would be the F1 pin-seizure class in reverse. Refuse and let the client
    // self-heal converge instead.
    register(reg, "Mohamed", "596484", "cM");
    const squatterCid = "cS";
    register(reg, "Someone", "909090", squatterCid);
    reg.clients.get("909090")!.verifiedPin = true;

    expect(rebindRegisteredPin(reg, { identityId: 23, oldNumber: "596484", newNumber: "909090" }))
      .toBe("collision");
    // Nothing moved.
    expect(reg.clients.has("596484")).toBe(true);
    expect(reg.clients.get("909090")!.name).toBe("Someone");
  });

  it("evicts an UNVERIFIED squatter, which is the only legitimate holder", () => {
    // An unverified genPin allocation is already un-ringable, so taking the number
    // from it costs nobody a reachable identity.
    register(reg, "Mohamed", "596484", "cM");
    register(reg, "Squatter", "909090", "cS");
    reg.clients.get("909090")!.verifiedPin = false;

    expect(rebindRegisteredPin(reg, { identityId: 23, oldNumber: "596484", newNumber: "909090" }))
      .toBe("rebound");
    expect(reg.clients.get("909090")!.name).toBe("Mohamed");
  });

  it("ignores a malformed or unchanged number", () => {
    register(reg, "Mohamed", "596484", "cM");
    for (const [o, n] of [["596484", "596484"], ["abc", "909090"], ["596484", "12345"]]) {
      expect(rebindRegisteredPin(reg, { identityId: 23, oldNumber: o, newNumber: n }))
        .toBe("not-registered");
    }
    expect(reg.clients.has("596484"), "nothing was touched").toBe(true);
  });
});

/* ── wiring ────────────────────────────────────────────────── */

describe("how the rebind gets triggered", () => {
  it("fires from INSIDE the single writer, after the commit", () => {
    // Not at the three procedures that call it: forgetting one call site is the
    // class of bug this codebase keeps re-learning, and a test already forbids a
    // parallel writer of identities.number.
    const fn = V2DB.slice(V2DB.indexOf("export async function regenerateIdentityNumber"));
    const body = fn.slice(0, fn.indexOf("\nexport ", 10));
    expect(body.length).toBeGreaterThan(1000);
    const confirm = body.indexOf("await confirmNumberReservation(newNumber);");
    const notify = body.indexOf("notifyNumberChanged({ identityId, oldNumber, newNumber });");
    expect(confirm).toBeGreaterThan(0);
    expect(notify, "notified after the reservation is confirmed").toBeGreaterThan(confirm);
  });

  it("the no-op path does NOT fire it", () => {
    // Choosing the number you already hold early-returns before the transaction.
    const fn = V2DB.slice(V2DB.indexOf("export async function regenerateIdentityNumber"));
    const preflight = fn.slice(0, fn.indexOf("await db.transaction"));
    expect(preflight).toMatch(/if \(want === oldNumber\) return \{ oldNumber, newNumber: oldNumber \};/);
    expect(codeOnly(preflight)).not.toMatch(/notifyNumberChanged/);
  });

  it("a throwing hook can never fail an already-committed renumber", () => {
    const notify = V2DB.slice(V2DB.indexOf("function notifyNumberChanged("));
    expect(notify.slice(0, 400)).toMatch(/try \{\s*\n\s*numberChangeHook\?\.\(e\);\s*\n\s*\} catch \{/);
  });

  it("v2db does NOT import the relay module — that edge would be a cycle", () => {
    // relay -> _core/context -> v2db already exists, so v2db -> relay would close
    // it. The hook is the only shape that adds no edge.
    expect(codeOnly(V2DB)).not.toMatch(/from "\.\/relay(Cluster)?"/);
  });

  it("clustered mode routes to the LEADER, where the registry actually lives", () => {
    // Applying locally on a follower is a silent no-op — its registry is empty.
    expect(RELAY).toMatch(/if \(!clustered \|\| isLeader\(\)\) \{\s*\n\s*rebindRegisteredPin\(reg, e\);/);
    expect(RELAY).toMatch(/clusterForwardRenumber\(e\);/);
    expect(CLUSTER).toMatch(/export function clusterForwardRenumber\(/);
    // …and the leader has a case for it, or the frame is dropped on arrival.
    expect(RELAY).toMatch(/\} else if \(t === "__renumber"\) \{/);
    // home must be our own id or the anti-spoof check drops it.
    expect(CLUSTER).toMatch(/cid: "__renumber", home: INSTANCE_ID, raw/);
  });

  it("the SSE kind is declared in BOTH the union and the bus allowlist", () => {
    // An undeclared kind is delivered locally and SILENTLY DROPPED whenever the
    // recipient's stream is on the other instance — most of the time on the
    // two-instance fleet, and single-instance dev would look perfect. Exactly the
    // v2.99.74 `delivered` bug.
    expect(EVENTS).toMatch(/\| \{ kind: "number"; number: string; previousNumber: string \}/);
    expect(EVENTS).toMatch(/"device_pending", "number", "ping",/);
  });
});

describe("the operator CLI path, stated honestly", () => {
  it("still talks straight to MySQL, so no server hook can fire", () => {
    expect(CLI).toMatch(/mysql2\/promise/);
    expect(codeOnly(CLI)).not.toMatch(/fetch\(|trpc|axios/);
  });

  it("says so in its header AND prints the consequence after a successful apply", () => {
    expect(CLI).toMatch(/THIS PATH FIRES NO HOOK AND SENDS NO NOTIFICATION/);
    expect(CLI).toMatch(/no notification was sent/);
  });

  it("the client-side backstop that covers it is enabled", () => {
    // The only mechanism present on BOTH paths. Without this, an operator renumber
    // leaves the person unreachable until they happen to reopen the app.
    const ui = read("../client/src/app/useIdentity.ts");
    expect(ui).toMatch(/refetchOnWindowFocus: true/);
    const rt = read("../client/src/app/useRealtime.ts");
    expect(rt).toMatch(/case "number": \{/);
    expect(rt).toMatch(/utils\.identity\.whoami\.invalidate\(\)/);
  });
});
