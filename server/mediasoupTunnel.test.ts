/**
 * #129 — the mediasoup op tunnel and the app-side ownership it exists to enforce.
 *
 * WHY THESE ARE DRIVEN RATHER THAN SOURCE-PINNED: the claim is "a participant cannot act on
 * another participant's transport", and no assertion about the text of `relay.ts` can answer
 * that. The refusal is a decision over three id spaces and a room's membership, so it is fed
 * real registries, a real `handleMessage`, and a stub node that verifies our own HMAC.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { codeOnly } from "./testing/codeOnly";
import {
  createRegistry,
  handleMessage,
  leaveRoom,
  partyLineRoomId,
  snapshotRoom,
  applyHydratedRooms,
  _resetVoipSessionsForTests,
  type RelayRegistry,
  type RelaySocket,
} from "./relay";
import { isPersistedRoom } from "./roomStore";
import {
  CLIENT_OPS,
  authorizeClientOp,
  forgetMember,
  isClientOp,
  newRoomSession,
  otherProducersFor,
  ownedIdFieldFor,
  recordOpResult,
  type RoomSession,
} from "./mediasoupRoom";
import type { VoipAssignment } from "./voipRegistry";

const ROOT = path.resolve(__dirname, "..");
const RELAY_SRC = fs.readFileSync(path.join(ROOT, "server/relay.ts"), "utf8");
const ROOM_SRC = fs.readFileSync(path.join(ROOT, "server/mediasoupRoom.ts"), "utf8");

/* RFC 5737 documentation address, per the v2.106.52 rule: a test must never carry a routable
   production IP, and this repo is public. */
const NODE_IP = "192.0.2.10";
const ASSIGNMENT: VoipAssignment = {
  instanceId: "i-0test",
  publicIp: "198.51.100.7",
  privateIp: NODE_IP,
  az: "ap-south-1a",
  assignedAt: 1_700_000_000_000,
};

class FakeConn {
  outbox: unknown[] = [];
  pin: string | null = null;
  socket: RelaySocket;
  constructor(public cid?: string) {
    this.socket = { send: (o: unknown) => this.outbox.push(o), close: () => {} };
  }
  setPin = (p: string) => {
    this.pin = p;
  };
  asConn() {
    return { socket: this.socket, pin: this.pin, setPin: this.setPin, cid: this.cid };
  }
  ofType(t: string) {
    return this.outbox.filter((m) => (m as { type?: string })?.type === t);
  }
  lastOfType(t: string) {
    const all = this.ofType(t);
    return all[all.length - 1] as Record<string, unknown> | undefined;
  }
}

function register(reg: RelayRegistry, name: string) {
  const c = new FakeConn(`cid-${name}`);
  handleMessage(reg, c.asConn(), { type: "register", name });
  return c;
}

/** A connected 1:1 call, optionally placed on a node. */
function callBetween(reg: RelayRegistry, onNode: boolean) {
  const a = register(reg, "A");
  const b = register(reg, "B");
  handleMessage(reg, a.asConn(), { type: "invite", to: b.pin! });
  const room = a.lastOfType("room") as { roomId: string };
  handleMessage(reg, b.asConn(), { type: "accept", roomId: room.roomId, cap: (b.lastOfType("ring") as { cap?: string })?.cap });
  const rid = reg.pinRoom.get(a.pin!)!;
  if (onNode) reg.roomMeta.get(rid)!.voip = { ...ASSIGNMENT };
  return { a, b, rid };
}

// ---------------------------------------------------------------------------------------
// THE OWNERSHIP DECISION
// ---------------------------------------------------------------------------------------

describe("#129 app-side ownership — the node records no owner, so we must", () => {
  const base = {
    roomId: "r1",
    hasAssignment: true,
    isMember: true,
  };

  let s: RoomSession;
  beforeEach(() => {
    s = newRoomSession();
    s.transports.set("t-alice", "111111");
    s.transports.set("t-bob", "222222");
    s.producers.set("p-alice", { pin: "111111", kind: "audio" });
    s.producers.set("p-bob", { pin: "222222", kind: "video" });
    s.consumers.set("c-alice", "111111");
    s.consumers.set("c-bob", "222222");
  });

  it("REFUSES produce on another participant's transport — this is caller-ID spoofing in a call", () => {
    /* THE SHARPEST CASE IN THE FILE. `voip-node/index.js` HANDLERS.produce takes a
       transportId and produces on it with no notion of who asked, so without this the media
       would be attributed to Bob while Alice sent it. */
    const v = authorizeClientOp({
      ...base,
      op: "produce",
      pin: "111111",
      session: s,
      transportId: "t-bob",
    });
    expect(v).toEqual({ allow: false, reason: "not-your-id" });
  });

  it("allows produce on your OWN transport", () => {
    const v = authorizeClientOp({ ...base, op: "produce", pin: "111111", session: s, transportId: "t-alice" });
    expect(v).toEqual({ allow: true, op: "produce" });
  });

  it("answers 'belongs to someone else' and 'does not exist' IDENTICALLY", () => {
    /* A distinguishable refusal would turn the tunnel into a probe for which transport ids
       are live on the node. */
    const stranger = authorizeClientOp({ ...base, op: "produce", pin: "111111", session: s, transportId: "t-bob" });
    const nothing = authorizeClientOp({ ...base, op: "produce", pin: "111111", session: s, transportId: "t-nope" });
    expect(stranger).toEqual(nothing);
  });

  it("REFUSES setConsumerLayers on another participant's consumer", () => {
    // Would let one participant downgrade the video quality somebody ELSE is receiving.
    const v = authorizeClientOp({ ...base, op: "setConsumerLayers", pin: "111111", session: s, consumerId: "c-bob" });
    expect(v).toEqual({ allow: false, reason: "not-your-id" });
  });

  it("REFUSES connectTransport on another participant's transport", () => {
    const v = authorizeClientOp({ ...base, op: "connectTransport", pin: "111111", session: s, transportId: "t-bob" });
    expect(v).toEqual({ allow: false, reason: "not-your-id" });
  });

  it("ALLOWS consuming another participant's producer — that is the whole point of the room", () => {
    /* The asymmetry is deliberate and is the one place ownership must NOT be required: you
       consume other people. What is checked instead is that the producer is in THIS room. */
    const v = authorizeClientOp({
      ...base,
      op: "consume",
      pin: "111111",
      session: s,
      transportId: "t-alice",
      producerId: "p-bob",
    });
    expect(v).toEqual({ allow: true, op: "consume" });
  });

  it("refuses consuming a producer from a DIFFERENT room", () => {
    const v = authorizeClientOp({
      ...base,
      op: "consume",
      pin: "111111",
      session: s,
      transportId: "t-alice",
      producerId: "p-from-another-call",
    });
    expect(v).toEqual({ allow: false, reason: "no-such-producer" });
  });

  it("refuses consuming ONTO another participant's transport even with a valid producer", () => {
    const v = authorizeClientOp({
      ...base,
      op: "consume",
      pin: "111111",
      session: s,
      transportId: "t-bob",
      producerId: "p-bob",
    });
    expect(v).toEqual({ allow: false, reason: "not-your-id" });
  });

  it("refuses every op a client may not call, and the exclusions are the safety argument", () => {
    for (const op of ["closeRoom", "state", "stats", "loudest", "", "produce ", "PRODUCE"]) {
      expect(isClientOp(op)).toBe(false);
      const v = authorizeClientOp({ ...base, op, pin: "111111", session: s, transportId: "t-alice" });
      expect(v, `op=${JSON.stringify(op)} must be refused`).toEqual({ allow: false, reason: "op-not-allowed" });
    }
  });

  it("every allowed op declares which id it needs, so a new op cannot arrive unowned", () => {
    /* The guard that matters for the NEXT op somebody adds: if it names an id and nobody
       tables it, `ownedIdFieldFor` returns null and the op is unowned. Asserting the table is
       TOTAL over CLIENT_OPS is what makes the omission a failure rather than a silent hole. */
    for (const op of CLIENT_OPS) {
      expect(ownedIdFieldFor(op), `${op} must have an explicit ownership rule`).not.toBe(undefined);
    }
    // And the two handshake openers genuinely own nothing yet, which is why they are null.
    expect(ownedIdFieldFor("routerCapabilities")).toBe(null);
    expect(ownedIdFieldFor("createTransport")).toBe(null);
  });

  it("decides membership BEFORE the assignment, so a refusal is not a per-room existence oracle", () => {
    // A non-member of a NODE room learns only "not-in-room" …
    const outsider = authorizeClientOp({ ...base, op: "createTransport", pin: "999999", isMember: false, session: s });
    expect(outsider).toEqual({ allow: false, reason: "not-in-room" });
    // … which is exactly what a non-member of a MESH room learns too.
    const outsiderMesh = authorizeClientOp({
      ...base,
      op: "createTransport",
      pin: "999999",
      isMember: false,
      hasAssignment: false,
      session: undefined,
    });
    expect(outsiderMesh).toEqual(outsider);
    // A real MEMBER of a mesh room gets the honest, different answer.
    const member = authorizeClientOp({ ...base, op: "createTransport", pin: "111111", hasAssignment: false, session: undefined });
    expect(member).toEqual({ allow: false, reason: "no-assignment" });
  });

  it("refuses when the connection is in no room at all", () => {
    const v = authorizeClientOp({ ...base, op: "createTransport", roomId: null, pin: "111111", session: s });
    expect(v).toEqual({ allow: false, reason: "not-in-room" });
  });

  it("refuses an op that omits the id it needs, rather than passing it to the node", () => {
    expect(authorizeClientOp({ ...base, op: "produce", pin: "111111", session: s })).toEqual({
      allow: false,
      reason: "bad-request",
    });
    expect(
      authorizeClientOp({ ...base, op: "consume", pin: "111111", session: s, transportId: "t-alice" }),
    ).toEqual({ allow: false, reason: "bad-request" });
  });
});

describe("#129 the ledger", () => {
  it("records ONLY what the node actually minted", () => {
    /* Written from the RESPONSE, never the request: an id the node did not hand out would
       authorize a later op against something that does not exist, and the node's refusal
       would then look like our own bug. */
    const s = newRoomSession();
    expect(recordOpResult(s, "111111", "createTransport", { notAnId: "x" })).toEqual({});
    expect(s.transports.size).toBe(0);
    recordOpResult(s, "111111", "createTransport", { id: "t1" });
    expect(s.transports.get("t1")).toBe("111111");
  });

  it("reports a new producer so the room's others can be told", () => {
    const s = newRoomSession();
    const r = recordOpResult(s, "111111", "produce", { id: "p1", kind: "video" });
    expect(r.newProducer).toEqual({ id: "p1", kind: "video" });
    expect(s.producers.get("p1")).toEqual({ pin: "111111", kind: "video" });
  });

  it("defaults an unrecognised kind to audio rather than inventing video", () => {
    const s = newRoomSession();
    recordOpResult(s, "111111", "produce", { id: "p1" });
    expect(s.producers.get("p1")!.kind).toBe("audio");
  });

  it("otherProducersFor excludes your own — you do not consume yourself", () => {
    const s = newRoomSession();
    s.producers.set("p-mine", { pin: "111111", kind: "audio" });
    s.producers.set("p-theirs", { pin: "222222", kind: "video" });
    expect(otherProducersFor(s, "111111")).toEqual([{ id: "p-theirs", kind: "video", pin: "222222" }]);
    expect(otherProducersFor(undefined, "111111")).toEqual([]);
  });

  it("forgetMember drops one participant's ids across all three spaces and leaves the others", () => {
    const s = newRoomSession();
    s.transports.set("t-a", "111111");
    s.transports.set("t-b", "222222");
    s.producers.set("p-a", { pin: "111111", kind: "audio" });
    s.producers.set("p-b", { pin: "222222", kind: "audio" });
    s.consumers.set("c-a", "111111");
    s.consumers.set("c-b", "222222");
    forgetMember(s, "111111");
    expect([...s.transports.keys()]).toEqual(["t-b"]);
    expect([...s.producers.keys()]).toEqual(["p-b"]);
    expect([...s.consumers.keys()]).toEqual(["c-b"]);
  });

  it("a forgotten member's id stops authorizing immediately", () => {
    const s = newRoomSession();
    s.transports.set("t-a", "111111");
    const ok = authorizeClientOp({
      op: "produce", roomId: "r", pin: "111111", hasAssignment: true, isMember: true, session: s, transportId: "t-a",
    });
    expect(ok.allow).toBe(true);
    forgetMember(s, "111111");
    const after = authorizeClientOp({
      op: "produce", roomId: "r", pin: "111111", hasAssignment: true, isMember: true, session: s, transportId: "t-a",
    });
    expect(after).toEqual({ allow: false, reason: "not-your-id" });
  });
});

// ---------------------------------------------------------------------------------------
// THE TUNNEL, END TO END THROUGH handleMessage
// ---------------------------------------------------------------------------------------

describe("#129 the op tunnel", () => {
  let reg: RelayRegistry;
  let sent: Array<{ url: string; body: Record<string, unknown>; signed: boolean }>;
  let reply: (body: Record<string, unknown>) => { status: number; json: unknown };
  const realFetch = globalThis.fetch;
  const realSecret = process.env.VOIP_NODE_SECRET;

  beforeEach(() => {
    reg = createRegistry();
    _resetVoipSessionsForTests();
    process.env.VOIP_NODE_SECRET = "test-secret-abc";
    sent = [];
    reply = () => ({ status: 200, json: { ok: true } });
    globalThis.fetch = (async (url: unknown, init: unknown) => {
      const i = (init ?? {}) as { body?: string; headers?: Record<string, string> };
      const body = JSON.parse(i.body ?? "{}") as Record<string, unknown>;
      const headers = i.headers ?? {};
      sent.push({
        url: String(url),
        body,
        /* The tunnel must reach the node through the SIGNED path — an unsigned op would be
           refused by the agent, so a tunnel that forgot the signer would fail only in
           production. */
        signed: Object.keys(headers).some((h) => /sig/i.test(h)),
      });
      const r = reply(body);
      return {
        ok: r.status >= 200 && r.status < 300,
        status: r.status,
        json: async () => r.json,
        text: async () => JSON.stringify(r.json),
      } as unknown as Response;
    }) as typeof globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    if (realSecret === undefined) delete process.env.VOIP_NODE_SECRET;
    else process.env.VOIP_NODE_SECRET = realSecret;
    _resetVoipSessionsForTests();
  });

  const flush = () => new Promise((r) => setTimeout(r, 0));

  it("DROPS an unregistered connection silently, before the switch is even reached", async () => {
    /* Not my guard — `handleMessage` returns for a pin-less connection ahead of every case,
       and a silent drop is STRONGER than the error reply I first wrote here: it reveals
       nothing at all, where a refusal distinguishes "unregistered" from "not in that room".
       Asserted so the tunnel is not later given its own weaker version. */
    const c = new FakeConn("anon");
    handleMessage(reg, c.asConn(), { type: "voip", op: "createTransport", seq: 1 });
    await flush();
    expect(c.outbox).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });

  it("refuses a member of a MESH room — there is no node to talk to", async () => {
    const { a } = callBetween(reg, false);
    a.outbox.length = 0;
    handleMessage(reg, a.asConn(), { type: "voip", op: "createTransport", seq: 7 });
    await flush();
    expect(a.lastOfType("voip-error")).toMatchObject({ reason: "no-assignment", seq: 7 });
    expect(sent).toHaveLength(0);
  });

  it("routes a member's op to the room's OWN node, signed, over the PRIVATE address", async () => {
    const { a } = callBetween(reg, true);
    reply = () => ({ status: 200, json: { rtpCapabilities: { codecs: [] } } });
    handleMessage(reg, a.asConn(), { type: "voip", op: "routerCapabilities", seq: 3 });
    await flush();
    expect(sent).toHaveLength(1);
    // The private plane, never the public one — signaling and media are different addresses.
    expect(sent[0].url).toContain(NODE_IP);
    expect(sent[0].url).not.toContain(ASSIGNMENT.publicIp);
    expect(sent[0].signed).toBe(true);
    expect(sent[0].body.op).toBe("routerCapabilities");
    expect(a.lastOfType("voip-result")).toMatchObject({ seq: 3, op: "routerCapabilities" });
  });

  it("IGNORES a client-supplied roomId — the room comes from the registry", async () => {
    /* The M45 property. Room ids are relayed to every participant, so if the tunnel took the
       roomId off the wire, naming somebody else's room would reach into their call on the
       same node — the node keys every id by roomId and would happily comply. */
    const { a, rid } = callBetween(reg, true);
    handleMessage(reg, a.asConn(), {
      type: "voip",
      op: "routerCapabilities",
      seq: 1,
      roomId: "somebody-elses-room",
    });
    await flush();
    expect(sent).toHaveLength(1);
    expect(sent[0].body.roomId).toBe(rid);
    expect(JSON.stringify(sent[0].body)).not.toContain("somebody-elses-room");
  });

  it("passes opaque mediasoup payload through but strips the envelope", async () => {
    const { a } = callBetween(reg, true);
    handleMessage(reg, a.asConn(), {
      type: "voip",
      op: "routerCapabilities",
      seq: 9,
      rtpCapabilities: { codecs: ["opus"] },
    });
    await flush();
    expect(sent[0].body.rtpCapabilities).toEqual({ codecs: ["opus"] });
    expect(sent[0].body).not.toHaveProperty("type");
    expect(sent[0].body).not.toHaveProperty("seq");
  });

  it("records the transport the node minted, so the NEXT op is authorized", async () => {
    const { a } = callBetween(reg, true);
    reply = () => ({ status: 200, json: { id: "t-real" } });
    handleMessage(reg, a.asConn(), { type: "voip", op: "createTransport", seq: 1 });
    await flush();
    // Now a produce on that transport is allowed …
    reply = () => ({ status: 200, json: { id: "p-real", kind: "audio" } });
    handleMessage(reg, a.asConn(), { type: "voip", op: "produce", seq: 2, transportId: "t-real" });
    await flush();
    expect(a.lastOfType("voip-result")).toMatchObject({ seq: 2, op: "produce" });
    // … and on an id the node never minted, it is not.
    handleMessage(reg, a.asConn(), { type: "voip", op: "produce", seq: 3, transportId: "t-invented" });
    await flush();
    expect(a.lastOfType("voip-error")).toMatchObject({ seq: 3, reason: "not-your-id" });
  });

  it("a participant cannot produce on the OTHER participant's minted transport", async () => {
    const { a, b } = callBetween(reg, true);
    reply = () => ({ status: 200, json: { id: "t-b" } });
    handleMessage(reg, b.asConn(), { type: "voip", op: "createTransport", seq: 1 });
    await flush();
    const before = sent.length;
    handleMessage(reg, a.asConn(), { type: "voip", op: "produce", seq: 2, transportId: "t-b" });
    await flush();
    expect(a.lastOfType("voip-error")).toMatchObject({ seq: 2, reason: "not-your-id" });
    // Refused HERE, so the node is never asked — the guard is ours, not the node's.
    expect(sent).toHaveLength(before);
  });

  it("tells the room's OTHER members about a new producer, and not the producer", async () => {
    /* THE EVENT CHANNEL THE NODE DOES NOT HAVE. The agent is request/response only, so
       "who is producing" is unanswerable on that side — but the app made the call, so it
       already knows and says so directly. */
    const { a, b } = callBetween(reg, true);
    reply = () => ({ status: 200, json: { id: "t-a" } });
    handleMessage(reg, a.asConn(), { type: "voip", op: "createTransport", seq: 1 });
    await flush();
    b.outbox.length = 0;
    a.outbox.length = 0;
    reply = () => ({ status: 200, json: { id: "p-a", kind: "video" } });
    handleMessage(reg, a.asConn(), { type: "voip", op: "produce", seq: 2, transportId: "t-a" });
    await flush();
    expect(b.lastOfType("voip-producer")).toMatchObject({ pin: a.pin, producerId: "p-a", kind: "video" });
    expect(a.ofType("voip-producer")).toHaveLength(0);
  });

  it("answers voip-producers from the ledger, excluding the asker's own", async () => {
    const { a, b } = callBetween(reg, true);
    reply = () => ({ status: 200, json: { id: "t-a" } });
    handleMessage(reg, a.asConn(), { type: "voip", op: "createTransport", seq: 1 });
    await flush();
    reply = () => ({ status: 200, json: { id: "p-a", kind: "audio" } });
    handleMessage(reg, a.asConn(), { type: "voip", op: "produce", seq: 2, transportId: "t-a" });
    await flush();

    handleMessage(reg, b.asConn(), { type: "voip-producers" });
    expect(b.lastOfType("voip-producers")).toMatchObject({
      producers: [{ id: "p-a", kind: "audio", pin: a.pin }],
    });
    handleMessage(reg, a.asConn(), { type: "voip-producers" });
    expect(a.lastOfType("voip-producers")).toMatchObject({ producers: [] });
  });

  it("surfaces a node failure as a refusal with its reason, never a throw", async () => {
    const { a } = callBetween(reg, true);
    reply = () => ({ status: 500, json: { error: "boom" } });
    handleMessage(reg, a.asConn(), { type: "voip", op: "createTransport", seq: 4 });
    await flush();
    const err = a.lastOfType("voip-error")!;
    expect(err.seq).toBe(4);
    expect(typeof err.reason).toBe("string");
    expect(err.reason).not.toBe("");
  });

  it("refuses with 'unconfigured' rather than reaching out when there is no fleet secret", async () => {
    delete process.env.VOIP_NODE_SECRET;
    const { a } = callBetween(reg, true);
    handleMessage(reg, a.asConn(), { type: "voip", op: "createTransport", seq: 5 });
    await flush();
    expect(a.lastOfType("voip-error")).toMatchObject({ seq: 5, reason: "unconfigured" });
    expect(sent).toHaveLength(0);
  });

  it("leaving the room forgets that member's ids", async () => {
    const { a, rid } = callBetween(reg, true);
    reply = () => ({ status: 200, json: { id: "t-a" } });
    handleMessage(reg, a.asConn(), { type: "voip", op: "createTransport", seq: 1 });
    await flush();
    leaveRoom(reg, a.pin!);
    /* Re-joining the same room and naming the old id must be refused — the ledger, not the
       node, is what decides, and the node cannot help because it records no owner. */
    reg.pinRoom.set(a.pin!, rid);
    reg.rooms.get(rid)?.add(a.pin!);
    handleMessage(reg, a.asConn(), { type: "voip", op: "produce", seq: 2, transportId: "t-a" });
    await flush();
    expect(a.lastOfType("voip-error")).toMatchObject({ seq: 2, reason: "not-your-id" });
  });

  it("echoes the client's own seq untouched, and tolerates its absence", async () => {
    const { a } = callBetween(reg, true);
    handleMessage(reg, a.asConn(), { type: "voip", op: "routerCapabilities", seq: 42 });
    await flush();
    expect(a.lastOfType("voip-result")!.seq).toBe(42);
    handleMessage(reg, a.asConn(), { type: "voip", op: "routerCapabilities" });
    await flush();
    expect(a.lastOfType("voip-result")!.seq).toBe(null);
  });
});

// ---------------------------------------------------------------------------------------
// THE ASSIGNMENT SURVIVES A LEADER CHANGE
// ---------------------------------------------------------------------------------------

describe("#129 the room remembers its node", () => {
  let reg: RelayRegistry;
  beforeEach(() => {
    reg = createRegistry();
    _resetVoipSessionsForTests();
  });

  it("a MESH room's record is byte-identical to one with no such field", () => {
    /* The claim that this release changes nothing for existing calls. A mesh room must not
       start carrying a `voip` key, or every older instance mid-deploy sees a shape it did not
       write. */
    const { rid } = callBetween(reg, false);
    const rec = snapshotRoom(reg, rid)!;
    expect(rec).not.toHaveProperty("voip");
    expect(isPersistedRoom(rec)).toBe(true);
  });

  it("survives snapshot → hydrate, so a leader change does not break a live mediasoup call", () => {
    const { rid } = callBetween(reg, true);
    const rec = snapshotRoom(reg, rid)!;
    expect(rec.voip).toEqual(ASSIGNMENT);
    expect(isPersistedRoom(rec)).toBe(true);

    const fresh = createRegistry();
    applyHydratedRooms(fresh, [rec]);
    expect(fresh.roomMeta.get(rid)!.voip).toEqual(ASSIGNMENT);
  });

  it("a MALFORMED assignment drops the WHOLE record rather than one field", () => {
    /* It feeds the live registry, so a partially-applied garbage address would authorize ops
       against a node that does not exist. Same rule the two established optional fields use. */
    const { rid } = callBetween(reg, true);
    const rec = snapshotRoom(reg, rid)! as Record<string, unknown>;
    for (const bad of [
      { ...ASSIGNMENT, privateIp: "not-an-ip" },
      { ...ASSIGNMENT, publicIp: "" },
      { ...ASSIGNMENT, instanceId: 5 },
      { ...ASSIGNMENT, assignedAt: 0 },
      "a string",
      null,
    ]) {
      expect(isPersistedRoom({ ...rec, voip: bad }), `voip=${JSON.stringify(bad)}`).toBe(false);
    }
  });

  it("a record with NO assignment hydrates as mesh, which is the safe direction", () => {
    const { rid } = callBetween(reg, true);
    const rec = snapshotRoom(reg, rid)!;
    const { voip: _drop, ...older } = rec as Record<string, unknown>;
    void _drop;
    expect(isPersistedRoom(older)).toBe(true);
    const fresh = createRegistry();
    applyHydratedRooms(fresh, [older as never]);
    expect(fresh.roomMeta.get(rid)!.voip).toBe(undefined);
  });
});

// ---------------------------------------------------------------------------------------
// STRUCTURE — the few properties only the source can answer
// ---------------------------------------------------------------------------------------

describe("#129 structure", () => {
  const relayCode = codeOnly(RELAY_SRC);
  const roomCode = codeOnly(ROOM_SRC);

  it("the assignment is captured from the plan, not recomputed later", () => {
    /* Behaviourally untestable here: `planDialTransport` reads a pool snapshot that is empty
       without REDIS_URL and a registered agent, so a dial in this environment can only ever
       produce the mesh case (which IS driven, above). What the source can say is that the
       room's field comes from the plan computed for that dial. */
    expect(relayCode).toMatch(/voip:\s*dialPlan\.voip/);
  });

  it("the tunnel never reads a roomId off the wire", () => {
    const tunnel = relayCode.slice(relayCode.indexOf('case "voip": {'));
    const end = tunnel.indexOf('case "voip-producers"');
    expect(end).toBeGreaterThan(0);
    const body = tunnel.slice(0, end);
    expect(body.length).toBeGreaterThan(400);
    expect(body).not.toMatch(/msg\s*(as[^)]*)?\)?\s*\.\s*roomId/);
    expect(body).not.toMatch(/roomId\??:\s*unknown/);
  });

  it("the ownership module reaches no network, timer or registry", () => {
    /* It is a DECISION, per the signalDisposition precedent — drivable without a socket, a
       node or a room. Anything I/O-shaped in here would make that false. */
    for (const banned of ["fetch(", "setTimeout", "setInterval", "require(", "process.env"]) {
      expect(roomCode, `mediasoupRoom.ts must not use ${banned}`).not.toContain(banned);
    }
    expect(roomCode).not.toMatch(/from\s+["']\.\/(relay|voipPool|mediasoupSignaling)["']/);
  });

  it("there is exactly ONE tunnel, so no call site can reply to the wrong socket", () => {
    /* v2.106.48 is the recorded proof: a token addressed to the number instead of the socket
       reached a different device and the call carried nothing while every frame looked fine.
       With six-plus ops, "each call site remembers the right socket" is the shape the house
       rule forbids. */
    /* `[<(]` because the call carries a type argument — `callNodeTracked<Record<…>>(` — so a
       bare `name(` pattern matches nothing and the count would read 0 against correct code. */
    expect(relayCode.match(/callNodeTracked[<(]/g) ?? []).toHaveLength(1);
    expect(relayCode.match(/case "voip":/g) ?? []).toHaveLength(1);
  });

  it("both room-lifetime funnels clear the ledger", () => {
    expect(relayCode).toMatch(/forgetRoom\(voipSessions/);
    expect(relayCode).toMatch(/forgetMember\(voipSessions\.get\(roomId\)/);
  });

  it("the ledger is never persisted — a hydrated room owns no node-side ids", () => {
    const store = codeOnly(fs.readFileSync(path.join(ROOT, "server/roomStore.ts"), "utf8"));
    for (const banned of ["voipSessions", "transports", "producers", "consumers"]) {
      expect(store, `roomStore must not persist ${banned}`).not.toContain(banned);
    }
  });

  it("signaling addresses a node by its PRIVATE plane only", () => {
    const sig = codeOnly(fs.readFileSync(path.join(ROOT, "server/mediasoupSignaling.ts"), "utf8"));
    // The narrowed parameter type is what makes reaching for publicIp here impossible.
    expect(sig).toMatch(/export type NodeAddress = Pick<VoipNode, "instanceId" \| "privateIp">/);
    expect(sig).not.toMatch(/node\.publicIp/);
  });
});

/**
 * "reapRoom is the single teardown path" WAS AN ASSERTION, AND THE FILE ALREADY
 * CONTAINED THE EXCEPTION.
 *
 * `merge` folds the held call into the active one and then deleted the emptied
 * room by hand — its own comment says it does so "WITHOUT crossing reapRoom" — so
 * `forgetRoom` never ran and the room's ownership ledger survived it.
 *
 * For an ordinary room that is a leak and nothing more: ids are random, so nothing
 * ever asks for that session again. A PARTY LINE is the case that bites. Its room
 * id is DERIVED from its number (`pl-<number>`) precisely so the room can be reaped
 * and rebuilt on the next dial — so the stale session comes back under the same id,
 * and `otherProducersFor` hands the next call's joiner the PREVIOUS call's producer
 * ids. Those producers died with the old room on the node, so the joiner consumes
 * nothing and hears nothing.
 *
 * Driven end to end: whether a ledger survives a merge is not a question the source
 * can answer.
 */
describe("a merged-away room takes its ledger with it", () => {
  let reg: RelayRegistry;
  let sent: Array<Record<string, unknown>>;
  let reply: () => { status: number; json: unknown };

  beforeEach(() => {
    _resetVoipSessionsForTests();
    reg = createRegistry();
    sent = [];
    reply = () => ({ status: 200, json: {} });
    process.env.VOIP_NODE_SECRET = "test-secret";
    installFetch();
  });
  afterEach(() => restoreFetch());

  function installFetch() {
    (globalThis as unknown as { fetch: unknown }).fetch = async (
      _url: string,
      init: { body: string },
    ) => {
      sent.push(JSON.parse(init.body) as Record<string, unknown>);
      const r = reply();
      return { ok: r.status < 400, status: r.status, text: async () => JSON.stringify(r.json) };
    };
  }
  function restoreFetch() {
    delete (globalThis as unknown as { fetch?: unknown }).fetch;
  }
  const flush = () => new Promise((r) => setTimeout(r, 0));

  /** Put `pin` in `roomId` as far as the server is concerned, node-assigned. */
  function placeIn(pin: string, roomId: string, seedFrom: string) {
    const seed = reg.roomMeta.get(seedFrom)!;
    if (!reg.rooms.has(roomId)) reg.rooms.set(roomId, new Set());
    reg.rooms.get(roomId)!.add(pin);
    if (!reg.roomMeta.has(roomId)) {
      reg.roomMeta.set(roomId, {
        ...seed,
        roster: new Map(seed.roster),
        cohosts: new Set(seed.cohosts),
        voip: { ...ASSIGNMENT },
      });
    }
    reg.pinRoom.set(pin, roomId);
    const c = reg.clients.get(pin);
    if (c) c.roomId = roomId;
  }

  it("a re-dialled party line does not inherit the merged call's producers", async () => {
    const { a, b, rid } = callBetween(reg, true);
    const line = partyLineRoomId("555555");

    // A produces INSIDE the party line, so that room's ledger names a producer.
    placeIn(a.pin!, line, rid);
    reply = () => ({ status: 200, json: { id: "t-line" } });
    handleMessage(reg, a.asConn(), { type: "voip", op: "createTransport", seq: 1 });
    await flush();
    reply = () => ({ status: 200, json: { id: "p-line", kind: "audio" } });
    handleMessage(reg, a.asConn(), { type: "voip", op: "produce", seq: 2, transportId: "t-line" });
    await flush();

    // …then it becomes the HELD line and A merges it into the active call.
    placeIn(a.pin!, rid, rid);
    reg.rooms.get(line)!.add(a.pin!); // still a member of the held room, as hold leaves it
    reg.heldRoom.set(a.pin!, line);
    handleMessage(reg, a.asConn(), { type: "merge" });
    expect(reg.rooms.has(line), "the merged-away room should be gone").toBe(false);

    // The line is dialled again. Same id, by construction — that is what `pl-` is for.
    placeIn(a.pin!, line, rid);
    placeIn(b.pin!, line, rid);
    b.outbox.length = 0;
    handleMessage(reg, b.asConn(), { type: "voip-producers" });
    expect(
      b.lastOfType("voip-producers"),
      "the new call inherited the previous one's producers",
    ).toMatchObject({ producers: [] });
  });

  it("an ordinary merged room's ledger is dropped too", async () => {
    const { a, rid } = callBetween(reg, true);
    const held = "held-room-1";
    placeIn(a.pin!, held, rid);
    reply = () => ({ status: 200, json: { id: "t-held" } });
    handleMessage(reg, a.asConn(), { type: "voip", op: "createTransport", seq: 1 });
    await flush();
    placeIn(a.pin!, rid, rid);
    reg.rooms.get(held)!.add(a.pin!);
    reg.heldRoom.set(a.pin!, held);
    handleMessage(reg, a.asConn(), { type: "merge" });

    // Re-create it and try to act on the id the old session owned. The refusal has
    // to come from an EMPTY ledger, not from a surviving one that happens to agree.
    placeIn(a.pin!, held, rid);
    a.outbox.length = 0;
    handleMessage(reg, a.asConn(), { type: "voip", op: "produce", seq: 9, transportId: "t-held" });
    await flush();
    expect(a.lastOfType("voip-error")).toMatchObject({ seq: 9, reason: "not-your-id" });
  });

  it("the merge still does what it is for — the mover lands in the active call", async () => {
    // The teardown change must not cost the feature. C is in the held room and
    // has to end up in the active one.
    const { a, rid } = callBetween(reg, true);
    const c = register(reg, "C");
    const held = "held-room-2";
    placeIn(a.pin!, held, rid);
    placeIn(c.pin!, held, rid);
    placeIn(a.pin!, rid, rid);
    reg.rooms.get(held)!.add(a.pin!);
    reg.heldRoom.set(a.pin!, held);
    c.outbox.length = 0;
    handleMessage(reg, a.asConn(), { type: "merge" });
    expect(c.lastOfType("joined")).toMatchObject({ roomId: rid });
    expect(reg.pinRoom.get(c.pin!)).toBe(rid);
    expect(reg.rooms.get(rid)!.has(c.pin!)).toBe(true);
    expect(reg.heldRoom.has(a.pin!)).toBe(false);
  });

  it("there is now ONE teardown, so a third exit cannot forget the ledger", () => {
    const relayCode = codeOnly(RELAY_SRC);
    // The property `reapRoom`'s comment claimed. Both exits call the same function,
    // and neither deletes the room's state by hand.
    expect(relayCode).toMatch(/function discardRoom\(reg: RelayRegistry, roomId: string\)/);
    expect(relayCode.match(/discardRoom\(reg, /g) ?? []).toHaveLength(2);
    const merge = relayCode.slice(relayCode.indexOf('case "merge":'), relayCode.indexOf('case "video-request":'));
    expect(merge).not.toMatch(/reg\.rooms\.delete\(/);
    expect(merge).not.toMatch(/reg\.roomMeta\.delete\(/);
    // …and `forgetRoom` is reached from exactly one place, so there is one rule.
    expect(relayCode.match(/forgetRoom\(voipSessions/g) ?? []).toHaveLength(1);
  });
});
