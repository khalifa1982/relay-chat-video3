import { describe, expect, it, beforeEach } from "vitest";
import {
  createRegistry,
  handleMessage,
  partyLineRoomId,
  partyLineLiveCounts,
  _setActiveRegistryForTests,
  _setResolveDialTimeoutForTests,
  PARTY_LINE_ROOM_PREFIX,
  RESOLVE_DIAL_TIMEOUT_MS,
  type ConferenceEndHook,
  type MissedCallHook,
  type ResolveDialHook,
  type RelayRegistry,
  type RelaySocket,
} from "./relay";

/**
 * v2.89 — PARTY LINES: dialable room numbers, protocol tests.
 *
 * A party line is a DB row (number → title) consulted by the invite path via
 * the async `onResolveDial` hook BEFORE the identity/paging flow. A dial to a
 * line NEVER rings anyone: the caller gets the standard `room` ack and a
 * `joined` envelope into the line's persistent room (`pl-<number>`), merging
 * with whoever is already there exactly like the add-person join path. The
 * room id is DERIVED from the number, so reaping an empty room never kills
 * the line — it's re-dialable forever.
 */

type Sent = Record<string, unknown>;
class FakeConn {
  outbox: Sent[] = [];
  pin: string | null = null;
  socket: RelaySocket;
  cid: string | undefined;
  constructor(cid?: string) {
    this.cid = cid;
    this.socket = {
      send: (obj: unknown) => {
        this.outbox.push(obj as Sent);
      },
      close: () => {},
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

const LINE = "555001";
const lineResolver: ResolveDialHook = async (pin) =>
  pin === LINE ? { partyLine: true, title: "The Fam" } : "identity";

function register(reg: RelayRegistry, name: string, pin: string) {
  const c = new FakeConn();
  handleMessage(reg, c.asConn(), { type: "register", name, pin });
  return c;
}

function invite(
  reg: RelayRegistry,
  c: FakeConn,
  to: string,
  resolver: ResolveDialHook = lineResolver,
  onMissedCall?: MissedCallHook
) {
  handleMessage(reg, c.asConn(), { type: "invite", to }, undefined, onMissedCall, undefined, resolver);
}

describe("party lines — dial-to-join", () => {
  let reg: RelayRegistry;
  beforeEach(() => {
    reg = createRegistry();
  });

  it("derives a stable internal room id with the pl- prefix", () => {
    expect(partyLineRoomId("123456")).toBe("pl-123456");
    expect(partyLineRoomId("123456").startsWith(PARTY_LINE_ROOM_PREFIX)).toBe(true);
  });

  it("a dial to a party-line number joins WITHOUT ringing anyone", async () => {
    const a = register(reg, "Ana", "111111");
    invite(reg, a, LINE);
    await flush();
    // Standard `room` ack, flagged as a party line.
    const room = a.ofType("room")[0];
    expect(room?.roomId).toBe("pl-" + LINE);
    expect(room?.partyLine).toBe(true);
    // Then a `joined` into the (empty) line, carrying the title.
    const joined = a.ofType("joined")[0];
    expect(joined?.roomId).toBe("pl-" + LINE);
    expect(joined?.partyLine).toBe(true);
    expect(joined?.lineTitle).toBe("The Fam");
    expect(joined?.members).toEqual([]);
    // NOBODY was rung: no pending rings, no ringing bookkeeping, no ringing ack.
    expect(reg.pendingRings.size).toBe(0);
    expect(reg.clients.get("111111")?.ringing.size).toBe(0);
    expect(a.ofType("ringing").length).toBe(0);
    expect(a.ofType("ring").length).toBe(0);
    // The caller is a persistent member of the line's room.
    expect(reg.rooms.get("pl-" + LINE)?.has("111111")).toBe(true);
    expect(reg.pinRoom.get("111111")).toBe("pl-" + LINE);
  });

  it("a second dialer lands in the SAME room and rosters merge like the add-person path", async () => {
    const a = register(reg, "Ana", "111111");
    const b = register(reg, "Bob", "222222");
    invite(reg, a, LINE);
    await flush();
    a.outbox.length = 0;
    invite(reg, b, LINE);
    await flush();
    // B's joined lists Ana as a current member.
    const joined = b.ofType("joined")[0] as { members?: Array<{ pin: string; name: string }> };
    expect(joined?.members).toHaveLength(1);
    expect(joined?.members?.[0]).toMatchObject({ pin: "111111", name: "Ana" });
    // Ana hears peer-joined for Bob (the standard merge signal).
    const pj = a.ofType("peer-joined")[0];
    expect(pj?.pin).toBe("222222");
    expect(pj?.name).toBe("Bob");
    // One shared room with both members.
    expect(reg.rooms.get("pl-" + LINE)?.size).toBe(2);
    // Two concurrent members ⇒ the room is a real (loggable, busy-line) call.
    expect(reg.roomMeta.get("pl-" + LINE)?.accepted).toBe(true);
  });

  it("enforces the standard mesh cap with error{code:full}", async () => {
    const members: FakeConn[] = [];
    for (let i = 1; i <= 6; i++) {
      const c = register(reg, `M${i}`, `10000${i}`);
      invite(reg, c, LINE);
      await flush();
      members.push(c);
    }
    expect(reg.rooms.get("pl-" + LINE)?.size).toBe(6);
    const late = register(reg, "Late", "700007");
    invite(reg, late, LINE);
    await flush();
    const err = late.ofType("error")[0];
    expect(err?.code).toBe("full");
    expect(reg.rooms.get("pl-" + LINE)?.has("700007")).toBe(false);
    expect(reg.pinRoom.get("700007")).toBeUndefined();
  });

  it("an EMPTY line is re-dialable forever: leave reaps the room, the next dial recreates it", async () => {
    const ended: string[] = [];
    reg.onConferenceEnd = ((info) => ended.push(info.roomId)) as ConferenceEndHook;
    const a = register(reg, "Ana", "111111");
    invite(reg, a, LINE);
    await flush();
    handleMessage(reg, a.asConn(), { type: "leave" });
    // Solo occupancy: room fully reaped, and NOT logged as a conference
    // (nobody ever talked — roster < 2).
    expect(reg.rooms.has("pl-" + LINE)).toBe(false);
    expect(reg.roomMeta.has("pl-" + LINE)).toBe(false);
    expect(ended).toEqual([]);
    // Dialing again just re-creates the room — the mapping is DB-derived.
    a.outbox.length = 0;
    invite(reg, a, LINE);
    await flush();
    expect((a.ofType("joined")[0] as { roomId?: string })?.roomId).toBe("pl-" + LINE);
    expect(reg.rooms.get("pl-" + LINE)?.has("111111")).toBe(true);
  });

  it("logs conference history (dialedNumber = the line's number) once TWO members talked", async () => {
    const ended: Array<{ roomId: string; dialedNumber: string | null; participants: Array<{ pin: string }> }> = [];
    reg.onConferenceEnd = ((info) => ended.push(info)) as ConferenceEndHook;
    const a = register(reg, "Ana", "111111");
    const b = register(reg, "Bob", "222222");
    invite(reg, a, LINE);
    await flush();
    invite(reg, b, LINE);
    await flush();
    handleMessage(reg, a.asConn(), { type: "leave" });
    handleMessage(reg, b.asConn(), { type: "leave" });
    expect(ended).toHaveLength(1);
    expect(ended[0].roomId).toBe("pl-" + LINE);
    expect(ended[0].dialedNumber).toBe(LINE);
    expect(ended[0].participants.map(p => p.pin).sort()).toEqual(["111111", "222222"]);
  });

  it("identity dials are UNAFFECTED when the resolver says identity (normal ring flow)", async () => {
    const a = register(reg, "Ana", "111111");
    const b = register(reg, "Bob", "222222");
    invite(reg, a, "222222");
    await flush();
    // Bob rings; Ana gets room + the ringing ack — the classic flow.
    const ring = b.ofType("ring")[0];
    expect(ring?.from).toBe("111111");
    expect(a.ofType("ringing")[0]?.pin).toBe("222222");
    expect(a.ofType("joined").length).toBe(0);
    // …and the dial room is a normal r… room, never a pl- one.
    expect(String(ring?.roomId)).toMatch(/^r/);
  });

  it("a resolver REJECTION falls back to the identity flow (never blocks a call)", async () => {
    const failing: ResolveDialHook = async () => {
      throw new Error("db down");
    };
    const a = register(reg, "Ana", "111111");
    const b = register(reg, "Bob", "222222");
    invite(reg, a, "222222", failing);
    await flush();
    expect(b.ofType("ring").length).toBe(1);
  });

  it("an in-call dialer with OTHER people cannot fold a party line in (non-fatal busy)", async () => {
    // A and B in a normal call.
    const a = register(reg, "Ana", "111111");
    const b = register(reg, "Bob", "222222");
    invite(reg, a, "222222");
    await flush();
    const roomId = String((a.ofType("room")[0] as { roomId?: string })?.roomId);
    handleMessage(reg, b.asConn(), { type: "accept", roomId });
    a.outbox.length = 0;
    // A tries to add the party line from in-call.
    invite(reg, a, LINE);
    await flush();
    const err = a.ofType("error")[0];
    expect(err?.code).toBe("busy");
    // A stayed in the original call; the line room was never created.
    expect(reg.pinRoom.get("111111")).toBe(roomId);
    expect(reg.rooms.has("pl-" + LINE)).toBe(false);
  });

  it("redialing the line you're already on is a NON-fatal no-op (code:already)", async () => {
    const a = register(reg, "Ana", "111111");
    invite(reg, a, LINE);
    await flush();
    a.outbox.length = 0;
    invite(reg, a, LINE);
    await flush();
    const err = a.ofType("error")[0];
    expect(err?.code).toBe("already");
    expect(reg.rooms.get("pl-" + LINE)?.size).toBe(1);
  });

  it("a caller who hung up while the resolver was in flight is never joined", async () => {
    let release: (v: "identity" | { partyLine: true }) => void = () => {};
    const slow: ResolveDialHook = () =>
      new Promise(resolve => {
        release = resolve;
      });
    const a = register(reg, "Ana", "111111");
    invite(reg, a, LINE, slow);
    // Ana's client record is torn down before the resolver answers.
    reg.clients.delete("111111");
    release({ partyLine: true });
    await flush();
    expect(reg.rooms.has("pl-" + LINE)).toBe(false);
    expect(a.ofType("joined").length).toBe(0);
  });

  it("partyLineLiveCounts counts only CONNECTED members from the live registry", async () => {
    const a = register(reg, "Ana", "111111");
    const b = register(reg, "Bob", "222222");
    invite(reg, a, LINE);
    await flush();
    invite(reg, b, LINE);
    await flush();
    _setActiveRegistryForTests(reg);
    try {
      expect(partyLineLiveCounts([LINE]).get(LINE)).toBe(2);
      // Bob's client dies (grace-reaped) but his membership is kept — he must
      // NOT inflate the live head-count.
      reg.clients.delete("222222");
      expect(partyLineLiveCounts([LINE]).get(LINE)).toBe(1);
      expect(partyLineLiveCounts(["999999"]).get("999999")).toBe(0);
    } finally {
      _setActiveRegistryForTests(null);
    }
  });

  it("without the resolver hook the invite path is fully synchronous (legacy tests unaffected)", () => {
    const a = register(reg, "Ana", "111111");
    const b = register(reg, "Bob", "222222");
    handleMessage(reg, a.asConn(), { type: "invite", to: "222222" });
    // No flush needed — the ring is already out.
    expect(b.ofType("ring").length).toBe(1);
  });
});

/**
 * v2.89.0 adversarial-review fixes — the deferred (async-resolver) invite path
 * and the party-line room-lifecycle edges it exposed:
 *
 *  D1  a `leave` / re-register / NEWER dial during the in-flight onResolveDial
 *      await must abort the stale continuation — no ghost ring, no ringing
 *      the old target into a new call's room, no phantom line member. Two
 *      stamps: party-line JOINS check dialEpoch strictly (newest dial wins);
 *      identity RINGS check ctxEpoch (hang-up / channel takeover only), so a
 *      group-dial burst's sibling in-flight invites still all ring.
 *  D2  a wedged resolver (dead DB pool) must not strand the dial: identity
 *      fallback after RESOLVE_DIAL_TIMEOUT_MS, late real resolve ignored.
 *  D3  a lone party-line occupant must SURVIVE their invitee's decline (the
 *      reject handler's solo-room cleanup skips pl- rooms).
 *  D4  joining a line while MID-DIAL must cancel the outstanding ring cleanly
 *      (ring-cancel + pendingRings + caller bookkeeping + missed-call row) so
 *      nobody's accept lands in the reaped dial room.
 */
describe("party lines — deferred-dial safety (v2.89.0 adversarial review)", () => {
  let reg: RelayRegistry;
  beforeEach(() => {
    reg = createRegistry();
  });

  /** A resolver whose answer is released manually, per dialed pin. */
  function gatedResolver() {
    const gates = new Map<string, (v: "identity" | { partyLine: true; title?: string }) => void>();
    const resolver: ResolveDialHook = (pin) =>
      new Promise(resolve => {
        gates.set(pin, resolve);
      });
    return { resolver, release: (pin: string, v: "identity" | { partyLine: true; title?: string }) => gates.get(pin)?.(v) };
  }

  it("D1: a hang-up (leave) during the resolver await aborts the dial — no ghost ring", async () => {
    const { resolver, release } = gatedResolver();
    const a = register(reg, "Ana", "111111");
    const b = register(reg, "Bob", "222222");
    invite(reg, a, "222222", resolver);
    // Ana hangs up while the resolver is still out. Her client record STAYS
    // (leave ≠ disconnect) — pre-fix the continuation found it and rang Bob.
    handleMessage(reg, a.asConn(), { type: "leave" });
    release("222222", "identity");
    await flush();
    expect(b.ofType("ring").length).toBe(0);
    expect(a.ofType("room").length).toBe(0); // no post-hang-up dial room either
    expect(reg.pendingRings.size).toBe(0);
    expect(reg.clients.get("111111")?.ringing.size).toBe(0);
    expect(reg.clients.get("111111")?.roomId).toBeNull();
  });

  it("D1: a hang-up during the await never enrolls the idle caller as a phantom line member", async () => {
    const { resolver, release } = gatedResolver();
    const a = register(reg, "Ana", "111111");
    invite(reg, a, LINE, resolver);
    handleMessage(reg, a.asConn(), { type: "leave" });
    release(LINE, { partyLine: true, title: "The Fam" });
    await flush();
    expect(reg.rooms.has("pl-" + LINE)).toBe(false);
    expect(a.ofType("joined").length).toBe(0);
    expect(reg.pinRoom.get("111111")).toBeUndefined();
  });

  it("D1: a NEWER dial during the await wins — the stale resolve can't yank the caller into the line", async () => {
    const { resolver, release } = gatedResolver();
    const a = register(reg, "Ana", "111111");
    const b = register(reg, "Bob", "222222");
    invite(reg, a, LINE, resolver); // resolver still out…
    invite(reg, a, "222222", resolver); // …when Ana dials Bob instead
    release("222222", "identity");
    await flush();
    // Bob is ringing in Ana's fresh dial room.
    expect(b.ofType("ring").length).toBe(1);
    const dialRoom = reg.clients.get("111111")?.roomId;
    expect(dialRoom).toMatch(/^r/);
    // The LINE resolve lands late — dropped, NOT allowed to hijack the dial.
    release(LINE, { partyLine: true, title: "The Fam" });
    await flush();
    expect(reg.rooms.has("pl-" + LINE)).toBe(false);
    expect(a.ofType("joined").length).toBe(0);
    expect(reg.clients.get("111111")?.roomId).toBe(dialRoom);
    // Bob's ring is still live and answerable in the REAL dial's room.
    expect(reg.pendingRings.get("222222")?.roomId).toBe(dialRoom);
  });

  it("D1 guard rail: a group-dial BURST's sibling in-flight invites all still ring (only stale LINE joins are newest-dial-gated)", async () => {
    // The group-dial flush fires its remaining invites back-to-back, so two
    // identity resolves are routinely in flight together. The epoch fix must
    // not let invite N+1 abort invite N — that would silently drop group
    // members whenever the DB resolver is slower than the inter-POST gap.
    const { resolver, release } = gatedResolver();
    const a = register(reg, "Ana", "111111");
    const b = register(reg, "Bob", "222222");
    const c = register(reg, "Cyd", "333333");
    invite(reg, a, "222222", resolver);
    invite(reg, a, "333333", resolver); // in flight together
    release("222222", "identity");
    release("333333", "identity");
    await flush();
    expect(b.ofType("ring").length).toBe(1);
    expect(c.ofType("ring").length).toBe(1);
    // …and into ONE shared dial room (the group-call contract).
    expect(String(b.ofType("ring")[0]?.roomId)).toBe(String(c.ofType("ring")[0]?.roomId));
    expect(reg.clients.get("111111")?.ringing.size).toBe(2);
  });

  it("D1: a channel-takeover re-register during the await aborts the stale continuation", async () => {
    const { resolver, release } = gatedResolver();
    const a = new FakeConn("cid-ana");
    handleMessage(reg, a.asConn(), { type: "register", name: "Ana", pin: "111111" });
    const b = register(reg, "Bob", "222222");
    invite(reg, a, "222222", resolver);
    // Ana's tab reloads: a NEW channel (same cid) re-registers and takes over
    // the record while the resolver is out. The old continuation captured a
    // dead socket + stale context — it must not ring Bob under it.
    const a2 = new FakeConn("cid-ana");
    handleMessage(reg, a2.asConn(), { type: "register", name: "Ana" });
    expect(a2.ofType("registered")[0]?.pin).toBe("111111"); // same number kept
    release("222222", "identity");
    await flush();
    expect(b.ofType("ring").length).toBe(0);
    expect(reg.pendingRings.size).toBe(0);
    // The re-registered client dials fine afterwards (fresh epoch, fresh ring).
    invite(reg, a2, "222222");
    await flush();
    expect(b.ofType("ring").length).toBe(1);
  });

  it("D2: a WEDGED resolver falls back to the identity flow after the timeout; the late resolve is ignored", async () => {
    expect(RESOLVE_DIAL_TIMEOUT_MS).toBe(1500); // production default pinned
    _setResolveDialTimeoutForTests(25);
    try {
      const { resolver, release } = gatedResolver();
      const a = register(reg, "Ana", "111111");
      const b = register(reg, "Bob", "222222");
      invite(reg, a, "222222", resolver);
      await flush();
      expect(b.ofType("ring").length).toBe(0); // still awaiting the resolver
      await new Promise(r => setTimeout(r, 120)); // > the shrunk 25ms timeout
      // Fallback dialed Bob as an identity — the dial never sat in limbo.
      expect(b.ofType("ring").length).toBe(1);
      expect(a.ofType("ringing").length).toBe(1);
      // The REAL resolve lands late — the flow must NOT run a second time.
      release("222222", { partyLine: true, title: "Zombie" });
      await flush();
      expect(b.ofType("ring").length).toBe(1); // no double ring
      expect(reg.rooms.has("pl-222222")).toBe(false); // no post-hoc line join
      expect(a.ofType("joined").length).toBe(0);
    } finally {
      _setResolveDialTimeoutForTests(null);
    }
  });

  it("D3: a LONE line occupant survives their invitee's decline (solo-room cleanup skips pl- rooms)", async () => {
    const a = register(reg, "Ana", "111111");
    const b = register(reg, "Bob", "222222");
    invite(reg, a, LINE);
    await flush();
    // Ana, alone on the line, rings Bob INTO it (ordinary identity invite).
    invite(reg, a, "222222");
    await flush();
    expect(b.ofType("ring")[0]?.roomId).toBe("pl-" + LINE);
    handleMessage(reg, b.asConn(), { type: "reject", to: "111111" });
    expect(a.ofType("rejected").length).toBe(1);
    // Reject bookkeeping ran…
    expect(reg.clients.get("111111")?.ringing.size).toBe(0);
    expect(reg.pendingRings.has("222222")).toBe(false);
    // …but Ana is STILL parked on the line (pre-fix she was evicted and the
    // line room reaped by the solo-dial-room cleanup).
    expect(reg.rooms.get("pl-" + LINE)?.has("111111")).toBe(true);
    expect(reg.pinRoom.get("111111")).toBe("pl-" + LINE);
    expect(reg.clients.get("111111")?.roomId).toBe("pl-" + LINE);
  });

  it("D3: …while a normal solo DIAL room is still torn down on decline (cleanup preserved)", async () => {
    const a = register(reg, "Ana", "111111");
    const b = register(reg, "Bob", "222222");
    invite(reg, a, "222222");
    await flush();
    handleMessage(reg, b.asConn(), { type: "reject", to: "111111" });
    expect(reg.clients.get("111111")?.roomId).toBeNull();
    expect(reg.pinRoom.get("111111")).toBeUndefined();
  });

  it("D4: joining a line MID-DIAL cancels the outstanding ring cleanly (no accept into a dead room)", async () => {
    const missed: Array<Parameters<MissedCallHook>[0]> = [];
    const hook: MissedCallHook = info => missed.push(info);
    const a = register(reg, "Ana", "111111");
    const b = register(reg, "Bob", "222222");
    // Ana dials Bob — a LIVE mid-dial: solo dial room + outstanding ring.
    invite(reg, a, "222222", lineResolver, hook);
    await flush();
    const dialRoom = String((a.ofType("room")[0] as { roomId?: string })?.roomId);
    expect(b.ofType("ring").length).toBe(1);
    expect(reg.pendingRings.get("222222")?.roomId).toBe(dialRoom);
    // Ana abandons the dial by hopping onto the party line instead.
    invite(reg, a, LINE, lineResolver, hook);
    await flush();
    // Bob's ring is cancelled EVERYWHERE: ring-cancel delivered, redelivery
    // cleared, caller bookkeeping cleared, and the miss is recorded — exactly
    // the `leave` handler's semantics. Pre-fix leaveRoom silently reaped the
    // room and Bob kept alerting until his accept bounced.
    expect(b.ofType("ring-cancel")[0]?.from).toBe("111111");
    expect(reg.pendingRings.has("222222")).toBe(false);
    expect(reg.clients.get("111111")?.ringing.size).toBe(0);
    expect(missed).toEqual([
      { calleePin: "222222", callerPin: "111111", callerName: "Ana", reason: "cancelled" },
    ]);
    // The stale dial room is gone; Ana is parked on the line.
    expect(reg.rooms.has(dialRoom)).toBe(false);
    expect(reg.pinRoom.get("111111")).toBe("pl-" + LINE);
    expect((a.ofType("joined")[0] as { roomId?: string })?.roomId).toBe("pl-" + LINE);
    // A straggler accept of the dead dial room gets the honest error, never a
    // half-join into nowhere (and never lands on the party line).
    handleMessage(reg, b.asConn(), { type: "accept", roomId: dialRoom });
    expect(b.ofType("error").some(e => e.code === "gone")).toBe(true);
    expect(reg.rooms.get("pl-" + LINE)?.has("222222")).toBe(false);
  });
});
