/**
 * MEDIASOUP ROOM SESSIONS — app-side ownership, and the authorization it makes possible.
 *
 * WHY THIS EXISTS AT ALL, and it is not a proxy.
 *
 * `mediasoupSignaling.ts` can already talk to a node. What it cannot do is decide whether a
 * given browser is ALLOWED to make a given call, and the reason is a property of the node
 * rather than an oversight here: **the agent keys everything by `(roomId, transportId /
 * producerId / consumerId)` and records no owner for any of them.** Read `voip-node/index.js`
 * — `HANDLERS.produce` takes a `transportId` and produces on it, full stop.
 *
 * So a bare relay of client ops to the node is not a transport, it is an impersonation
 * primitive:
 *
 *   - `produce` naming ANOTHER participant's `transportId` publishes media that the room
 *     attributes to them. That is caller-ID spoofing INSIDE a live call, and it is the
 *     sharpest of the three.
 *   - `setConsumerLayers` naming their `consumerId` downgrades the video THEY are receiving.
 *   - `connectTransport` naming their `transportId` completes a DTLS handshake against a
 *     transport they are mid-way through establishing.
 *
 * The node cannot refuse any of that, because it does not know who anybody is. Therefore the
 * app must be the ownership authority, and **every op that names an id is an authorization
 * decision** rather than a hop. That is what this module is: the ledger of who owns which id,
 * plus the pure decision that reads it.
 *
 * PURE DECISION, INJECTED MECHANISM — the `signalDisposition` shape (v2.99.57), for the same
 * reason recorded there: whether a frame is authorized is exactly the thing a source pin
 * cannot answer, so it has to be drivable without a socket, a node or a room.
 *
 * WHAT IS DELIBERATELY NOT HERE: no `fetch`, no timers, no registry import. This module
 * decides; `relay.ts` routes.
 */

/**
 * The ops a CLIENT may ask for. A CLOSED SET, and what is missing from it is the argument.
 *
 * `closeRoom` — one participant would end everybody's call. It is the app's own teardown.
 * `state`    — fleet diagnostics. A browser has no use for a node's router count.
 * `stats`    — enumerates EVERY transport in the room. v2.106.36 stripped the remote address
 *              at the node so it is no longer a locator, but a participant still has no
 *              business reading the other participants' transport list.
 * `loudest`  — poll-only and room-wide; the app owns active-speaker, exactly as it does on
 *              the mesh, so handing it to clients would put two answers on one screen.
 *
 * `routerCapabilities` IS included even though it creates the room as a side effect, because
 * it is the first step of the documented handshake and a client cannot skip it — see
 * `createTransport` throwing "no such room" without it.
 */
export const CLIENT_OPS = [
  "routerCapabilities",
  "createTransport",
  "connectTransport",
  "produce",
  "consume",
  "resumeConsumer",
  "setConsumerLayers",
] as const;

export type ClientOp = (typeof CLIENT_OPS)[number];

const CLIENT_OP_SET: ReadonlySet<string> = new Set(CLIENT_OPS);

export function isClientOp(v: unknown): v is ClientOp {
  return typeof v === "string" && CLIENT_OP_SET.has(v);
}

/** Which id field, if any, each client op names — i.e. what has to be owned to call it. */
const OP_OWNED_ID: Readonly<Record<ClientOp, "transportId" | "consumerId" | null>> = {
  routerCapabilities: null,
  createTransport: null,
  connectTransport: "transportId",
  produce: "transportId",
  /* `consume` names a `producerId` TOO, and that one is deliberately NOT an ownership check:
     consuming is the whole point of being in the room, so a participant must be able to name
     somebody else's producer. What it may not do is consume ONTO a transport that is not its
     own, which is why the owned id here is the transport. The producer is validated for
     MEMBERSHIP instead (`producerInRoom`) so it cannot name a producer from another call. */
  consume: "transportId",
  resumeConsumer: "consumerId",
  setConsumerLayers: "consumerId",
};

export function ownedIdFieldFor(op: ClientOp): "transportId" | "consumerId" | null {
  return OP_OWNED_ID[op];
}

/**
 * One room's ledger. Three id spaces, because the node has three and owns none of them.
 *
 * `producers` keeps the KIND as well as the owner, because that is what lets a joiner be told
 * what to consume without a second round trip, and because the node exposes no way to ask.
 */
export interface RoomSession {
  /** transportId -> owning pin. */
  transports: Map<string, string>;
  /** producerId -> owner + kind. */
  producers: Map<string, { pin: string; kind: "audio" | "video" }>;
  /** consumerId -> owning pin. */
  consumers: Map<string, string>;
}

export function newRoomSession(): RoomSession {
  return { transports: new Map(), producers: new Map(), consumers: new Map() };
}

export type SessionStore = Map<string, RoomSession>;

/** Get-or-create. Called only from a path that has already authorized the room. */
export function sessionFor(store: SessionStore, roomId: string): RoomSession {
  let s = store.get(roomId);
  if (!s) {
    s = newRoomSession();
    store.set(roomId, s);
  }
  return s;
}

// ---------------------------------------------------------------------------------------
// THE DECISION
// ---------------------------------------------------------------------------------------

export type OpRefusal =
  /** Not a member of the room — or not in a room at all. */
  | "not-in-room"
  /** The room is on the mesh; there is no node to talk to. */
  | "no-assignment"
  /** Not an op a client may ask for (see CLIENT_OPS). */
  | "op-not-allowed"
  /** Named an id that belongs to somebody else, or to nothing. */
  | "not-your-id"
  /** Named a producer that is not in this room. */
  | "no-such-producer"
  /** The frame is malformed. */
  | "bad-request";

export type OpDisposition =
  | { allow: true; op: ClientOp }
  | { allow: false; reason: OpRefusal };

/**
 * Is this client allowed to run this op against this room?
 *
 * `roomId` MUST be the room the CONNECTION is in, resolved by the caller from its own
 * registry — never a value off the wire. Room ids are relayed to every participant, so a
 * client-named room is the hole v2.99.43/M45 closed on `accept` and v2.99.57/R-GENPIN closed
 * on register. This signature takes the resolved id precisely so there is nowhere to pass a
 * claimed one.
 */
export function authorizeClientOp(input: {
  op: unknown;
  /** The room the connection is actually in, or null if it is in none. */
  roomId: string | null;
  /** The connection's own pin. */
  pin: string;
  /** Whether the room has a node assignment at all. */
  hasAssignment: boolean;
  /** Whether `pin` is a member of `roomId`. */
  isMember: boolean;
  session: RoomSession | undefined;
  /** The ids the frame named, already narrowed to strings by the caller. */
  transportId?: string | null;
  consumerId?: string | null;
  producerId?: string | null;
}): OpDisposition {
  if (!isClientOp(input.op)) return { allow: false, reason: "op-not-allowed" };
  const op = input.op;

  if (!input.roomId || !input.isMember) return { allow: false, reason: "not-in-room" };
  /* ORDER IS LOAD-BEARING: membership is decided BEFORE the assignment, so a member of a
     MESH room learns "no-assignment" while a non-member learns "not-in-room" for every room
     whatever its transport. Reversed, the refusal would tell a stranger which rooms are on a
     node — a per-room existence oracle over ids that are relayed to participants. */
  if (!input.hasAssignment) return { allow: false, reason: "no-assignment" };

  const need = ownedIdFieldFor(op);
  if (need === "transportId") {
    const id = input.transportId;
    if (!id) return { allow: false, reason: "bad-request" };
    if (input.session?.transports.get(id) !== input.pin) {
      /* ONE reason for "belongs to someone else" and for "does not exist", deliberately: a
         distinguishable refusal turns this into a probe for which transport ids are live. */
      return { allow: false, reason: "not-your-id" };
    }
  } else if (need === "consumerId") {
    const id = input.consumerId;
    if (!id) return { allow: false, reason: "bad-request" };
    if (input.session?.consumers.get(id) !== input.pin) {
      return { allow: false, reason: "not-your-id" };
    }
  }

  if (op === "consume") {
    const pid = input.producerId;
    if (!pid) return { allow: false, reason: "bad-request" };
    /* Membership of THIS room's producer set, not ownership — see the comment on
       OP_OWNED_ID.consume. Without it a client could name a producer id from a different
       call and have the node wire it into this one. */
    if (!input.session?.producers.has(pid)) {
      return { allow: false, reason: "no-such-producer" };
    }
  }

  return { allow: true, op };
}

// ---------------------------------------------------------------------------------------
// THE LEDGER'S WRITERS — called AFTER the node has answered, never before
// ---------------------------------------------------------------------------------------

/**
 * Record what the node just handed out. Returns the producer's own id when the op created
 * one, because that is the signal the caller fans to the room's other members.
 *
 * WRITTEN FROM THE RESPONSE, NOT THE REQUEST. An id the node did not actually mint must never
 * enter the ledger: it would authorize a later op against something that does not exist, and
 * the node's refusal would then look like our own bug.
 */
export function recordOpResult(
  session: RoomSession,
  pin: string,
  op: ClientOp,
  data: unknown,
): { newProducer?: { id: string; kind: "audio" | "video" } } {
  const o = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const id = typeof o.id === "string" && o.id ? o.id : null;

  if (op === "createTransport" && id) {
    session.transports.set(id, pin);
    return {};
  }
  if (op === "produce" && id) {
    const kind = o.kind === "video" ? "video" : "audio";
    session.producers.set(id, { pin, kind });
    return { newProducer: { id, kind } };
  }
  if (op === "consume" && id) {
    session.consumers.set(id, pin);
    return {};
  }
  return {};
}

/**
 * What a joiner has to consume: every producer in the room that is not their own.
 *
 * THIS IS THE MISSING EVENT CHANNEL'S OTHER HALF. The agent is request/response only — there
 * is no node->app push at all — so on the node's side "who is producing" is unanswerable. It
 * does not need to be: the app is the caller of every `produce`, so it already knows, and a
 * joiner is told directly instead of polling something that cannot be polled.
 */
export function otherProducersFor(
  session: RoomSession | undefined,
  pin: string,
): Array<{ id: string; kind: "audio" | "video"; pin: string }> {
  if (!session) return [];
  const out: Array<{ id: string; kind: "audio" | "video"; pin: string }> = [];
  session.producers.forEach((v, id) => {
    if (v.pin !== pin) out.push({ id, kind: v.kind, pin: v.pin });
  });
  return out;
}

/**
 * Forget one participant's ids when they leave.
 *
 * STATED PLAINLY AS A LIMITATION RATHER THAN GLOSSED: this drops the APP's record and cannot
 * free anything on the node, because the agent has `closeRoom` and no per-participant close
 * (verified against its HANDLERS — there is no `closeTransport`, no `closeProducer`). So a
 * leaver's node-side transport lingers until the room itself closes. That is bounded by the
 * room's own life and is why forgetting here is still correct: it stops their ids ever
 * authorizing another op, which is this ledger's job. Freeing the node resource needs an op
 * the agent does not have yet.
 */
export function forgetMember(session: RoomSession | undefined, pin: string): void {
  if (!session) return;
  const drop = <V>(m: Map<string, V>, owned: (v: V) => boolean) => {
    const gone: string[] = [];
    m.forEach((v, k) => {
      if (owned(v)) gone.push(k);
    });
    /* Collected then deleted rather than deleted mid-walk — the ES5 iteration trap this repo
       has hit four times (v2.99.72, v2.99.98, v2.105.21, v2.106.32). */
    for (const k of gone) m.delete(k);
  };
  drop(session.transports, (v) => v === pin);
  drop(session.producers, (v) => v.pin === pin);
  drop(session.consumers, (v) => v === pin);
}

export function forgetRoom(store: SessionStore, roomId: string): void {
  store.delete(roomId);
}
