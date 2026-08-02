/* ============================================================
   RELAY — HTTP-based signaling for self-hosted browser calling.

   Adapted from the standalone relay-server.zip the user supplied.
   The original ships used a raw WebSocket transport, but the Manus
   production gateway (Cloudflare → Cloud Run) does not forward raw
   WebSocket upgrades on arbitrary paths. We therefore use a pair of
   plain HTTP endpoints that look like a WebSocket to the client:

     GET  /api/relay/stream?cid=<id>   - SSE channel (server -> client)
     POST /api/relay/send              - JSON messages (client -> server)
                                         body: { cid, message }

   Semantics are identical to the original WebSocket protocol:
   register, invite, accept/reject, signal relay, leave, room/peer
   events, plus authoritative room membership for a glare-free mesh.

   STUN is enabled by default; TURN credentials are issued via the
   coturn `use-auth-secret` flow when TURN_SECRET + TURN_HOST are set.
   ============================================================ */

import crypto from "crypto";
import type { Request, Response, Express } from "express";
import { createRateLimiter, clientIpOf } from "./rateLimit";
import { createContext } from "./_core/context";
import { planDialTransport } from "./voipPool";
import type { VoipAssignment } from "./voipRegistry";
import {
  authorizeClientOp,
  forgetMember,
  forgetRoom,
  otherProducersFor,
  recordOpResult,
  sessionFor,
  type SessionStore,
} from "./mediasoupRoom";
import { callNodeTracked } from "./mediasoupSignaling";

/**
 * M40: per-CALLER-pin budget for dials to a number with no live connection —
 * the invite handler's offline-resolution branch (see its comment for why that
 * branch specifically). Module-scoped because `handleMessage` is, and keyed on
 * the server-resolved caller pin rather than an IP, so it follows the identity
 * rather than the network path.
 *
 * SELF-REVIEW: sized against GROUP DIALS, which are the heavy legitimate case.
 * A group dial fans one invite per invitee, so dialling 9 contacts who all
 * happen to be offline spends 9 tokens at once — an initial 20/1-per-4s budget
 * was exhausted by the second such dial, and the throttled path deliberately
 * skips `onMissedCall`, so the people dialled after that would silently lose
 * their missed-call record, History row and notification. That is a real
 * functional loss for a heavy but entirely ordinary user.
 *
 * 60 burst then ~1 every 2s absorbs roughly six full 9-person offline group
 * dials back to back, and 30/min sustained. Enumeration of the 10^6 space still
 * goes from "under two hours" (the flood limiter alone) to about three weeks, so
 * the oracle is closed in every practical sense without costing real dialling.
 *
 * Division of labour worth recording: the missed-call EMAIL amplification is
 * bounded separately and more precisely by `claimMissedCallEmail`'s per-user
 * cooldown (v2.99.44), which deliberately leaves the push and the History record
 * unconditional so a throttled email never costs someone the record of the call.
 * This limiter therefore exists for the ENUMERATION ORACLE — the existence and
 * display-name leak — and does not need to be tight enough to police email.
 *
 * Note the throttled reply is code "offline", which the client classifies as a
 * `reachErr` — during a group-dial bootstrap that PROMOTES the next invitee
 * rather than tearing the dial down, so a throttle degrades one invitee instead
 * of collapsing the call. Honors RELAY_RATELIMIT_OFF like every other gate.
 */
const offlineDialLimiter = createRateLimiter({ capacity: 60, refillPerSec: 0.5 });

/**
 * The key M40's offline-dial budget is charged against.
 *
 * ── SELF-REVIEW (v2.99.49): KEYING ON THE PIN MEANT THE LIMITER NEVER BOUND ──
 * A caller with no cookie is assigned a FRESH RANDOM pin by `genPin` at register
 * time, and `/api/relay/stream` can be reopened about once a second. So an
 * anonymous loop — new cid, register, 60 invites, discard, repeat — minted a new
 * bucket every time and probed at ~60/s from ONE address. The number→identity
 * oracle M40 was added to close stayed fully open: a full walk of the 10^6 space
 * in hours, not the weeks v2.99.45 claimed. It also let an anonymous client be
 * assigned a REAL user's number and drain that user's bucket, throttling their
 * legitimate dials and silently costing their callees missed-call records.
 *
 * So the budget follows something the caller cannot re-mint: their cookie-proven
 * pin when they have one (`verifiedPin`), otherwise their address. An anonymous
 * scraper now shares one bucket per address no matter how many cids it burns,
 * and a real user's bucket can only be spent by that user.
 */
function offlineDialKey(reg: RelayRegistry, callerPin: string): string {
  const c = reg.clients.get(callerPin);
  if (c?.verifiedPin) return "id:" + callerPin;
  return "ip:" + (c?.ip || "unknown");
}
setInterval(() => offlineDialLimiter.sweep(Date.now(), 30 * 60_000), 30 * 60_000).unref();
import {
  busEnabled,
  initBusyStateSync,
  touchBusyState,
  readBusyPinsFromRedis,
  readPlCountsFromRedis,
  type BusySnapshot,
} from "./redisBus";
import {
  clusterEnabled,
  startClusterRuntime,
  clusterForwardInbound,
  clusterProxyInbound,
  clusterDeliverOutbound,
  makeRemoteSocket,
  clusterForwardRenumber,
  isLeader,
} from "./relayCluster";
// The renumber hook's SETTER only (v2.99.83). `relay -> v2db` already exists
// transitively (relay -> _core/context -> v2db), so this direct edge adds no cycle;
// the edge that WOULD is v2db -> relay, which is exactly why the rebind is
// registered as a hook rather than imported by the DB layer. Same shape as
// statsFeed's setPresenceChangeHook.
import { setNumberChangeHook } from "./v2db";
import { publishToIdentity } from "./v2events";
import {
  initRoomStore,
  markRoomDirty,
  hydrateRooms,
  type PersistedRoom,
} from "./roomStore";
import { mintRoomCap, verifyRoomCap } from "./roomCapability";
import { verifyGroupCallSeed } from "./groupCallSeed";

// TURN credentials are read on every call so the operator can add them via
// `webdev_request_secrets` without restarting the server, and so unit tests
// can override them via `process.env.TURN_SECRET = "..."`.

interface IceServer {
  urls: string;
  username?: string;
  credential?: string;
}

/**
 * An open SSE channel that mimics a WebSocket's `send()` method.
 * We keep this abstraction so the message-dispatch logic doesn't care
 * about the underlying transport (which makes the unit tests easier).
 */
export interface RelaySocket {
  send: (obj: unknown) => void;
  close: () => void;
  /** True while the underlying SSE response can still be written to. Lets the
   *  invite path detect a dead-but-in-grace callee socket (backgrounded phone)
   *  and PAGE them instead of dropping the ring into a closed stream. Optional
   *  so test doubles / legacy sockets keep working (absent ⇒ assumed alive). */
  alive?: () => boolean;
}

export interface RelayClient {
  socket: RelaySocket;
  name: string;
  /** Device type this client reported at register ("Mobile"/"Desktop"). */
  device?: string;
  /** Country flag emoji this client reported at register (from geo). */
  flag?: string;
  roomId: string | null;
  cid: string | null;          // owning channel id, for reconnect re-binding
  graceT: ReturnType<typeof setTimeout> | null; // pending disconnect cleanup
  /** Pins we've sent a `ring` to that haven't accepted/rejected yet. Used to
   *  send a `ring-cancel` to the callee if we hang up before they answer. */
  ringing: Set<string>;
  /** Latest-dial stamp (v2.89.x). Re-stamped synchronously at the START of
   *  every invite (and bumped by `leave` / a takeover re-register). The async
   *  `onResolveDial` continuation captures it before awaiting; the PARTY-LINE
   *  join checks it STRICTLY afterwards — a room join must be the caller's
   *  latest dial intent, so a stale line resolve landing after a newer dial
   *  (or hang-up) can never yank the caller into the line as a phantom
   *  member. Identity RINGS deliberately do NOT use this strict check (see
   *  ctxEpoch): a group-dial flush fires several invites in one burst, and
   *  sibling in-flight invites must all still ring. Values come from one
   *  module-global monotonic sequence (never a per-client counter), so a
   *  record that's deleted and re-created can't re-reach a captured stamp. */
  dialEpoch?: number;
  /** Call-context generation (v2.89.x). Initialized at record creation and
   *  bumped ONLY by context-destroying events: `leave` (hang-up) and a
   *  re-registration that takes over this record's primary slot. The deferred
   *  identity-invite continuation aborts if it moved — a hang-up or channel
   *  takeover during the resolver await can never ghost-ring the callee or
   *  ring the old target into a new call's room — while CONCURRENT sibling
   *  invites (which move only dialEpoch) keep ringing. Same global sequence
   *  as dialEpoch for the same uniqueness guarantee. */
  ctxEpoch?: number;
  /** True when this pin was bound to a COOKIE-RESOLVED identity at register
   *  time (F1's `__ownedNumber`), i.e. the caller cannot re-mint it at will.
   *  Per-caller abuse budgets key on the pin only when this holds — see
   *  `offlineDialKey`. */
  verifiedPin?: boolean;
  /** Address this client registered from, for the unverified-caller fallback. */
  ip?: string | null;
}

export interface RelayConnection {
  cid: string;          // opaque per-tab id chosen by the client
  socket: RelaySocket;
  pin: string | null;   // assigned 6-digit number after `register`
}

/**
 * Lifetime metadata for a room, accumulated so we can write a CONFERENCE
 * HISTORY row when the room ends. `roster` keeps EVERYONE who was ever in the
 * room (pin -> latest display name), so a participant who left early still
 * appears in the history. `accepted` flips true on the first accept, so a
 * dial that nobody answered is NOT logged as a conference (the missed-call
 * path already records that).
 */
export interface RoomMeta {
  startedAt: number;            // unix ms — first invite that created the room (the "when")
  answeredAt: number | null;    // unix ms — first accept (talk time starts here)
  lastActiveAt: number;         // unix ms — last time a member was connected (the real end)
  dialedNumber: string | null;  // the number that seeded the room
  accepted: boolean;            // at least one callee answered → a real call
  roster: Map<string, string>;  // pin -> latest display name
  hostPin: string | null;       // the room creator (host) for moderation
  cohosts: Set<string>;         // pins the host promoted to co-host
  // Live-call rejoin (v2.99.9): pins currently KNOCKING to be let back in,
  // pending host approval. Cleared on approve/deny. Optional (older rooms/tests
  // never set it).
  knocks?: Map<string, { name: string; at: number }>;
  /**
   * Round 11: when this room was restored from Redis by a newly-elected leader.
   * A hydrated room has NO connected members by construction — every client
   * record died with the old leader — so it looks exactly like the "room of
   * ghosts" that sendRejoinIfInRoom exists to dissolve. It isn't: the others are
   * on their way back, they simply haven't re-registered yet. Set only by
   * applyHydratedRooms and only read for HYDRATED_GRACE_MS.
   */
  hydratedAt?: number;
  /**
   * #113 — pins the GROUP this call was started for lists as its ADMINS, so each
   * of them becomes a CO-HOST when they join. Captured from a signed seed at room
   * creation (see `server/groupCallSeed.ts`); absent for a 1:1, a party line, an
   * ad-hoc number-picker group call, and any dial whose seed did not verify.
   *
   * ONE-WAY: this is READ to grant hostship and is never written back to a group
   * role. Nothing in this file imports the role writer.
   */
  groupAdminPins?: Set<string>;
  /**
   * #109 — when each CURRENT member joined (pin → unix ms), so the invite screen
   * can say "joined 4m ago" beside a name.
   *
   * Scoped to current members: written by `joinRoomMember` only for a pin that
   * was not already in the room, and dropped by `leaveRoom`. That is what makes
   * the field mean one thing — `roster` is deliberately add-only (it is the
   * conference-history record), so reusing it would report a join time for
   * somebody who left an hour ago.
   *
   * OPTIONAL, and a missing entry is reported as NULL rather than filled in from
   * `startedAt`: `ensureDialRoom` joins its creator BEFORE it sets the metadata,
   * so a 1:1 room's creator legitimately has no stamp. A party line sets its
   * metadata first, which is why every member of the one room this is read for
   * does have one.
   */
  joinedAt?: Map<string, number>;
  /**
   * #116 — how this room was DIALLED, so an answered group call can report Voice or
   * Video in History the way a solo row does.
   *
   * OPTIONAL, and absent means UNKNOWN rather than voice: a party line is joined
   * rather than dialled, and a room hydrated from a record written before this field
   * existed carries none. Both must report nothing instead of asserting a media type
   * nobody recorded.
   */
  video?: boolean;
  /**
   * #129 — the mediasoup node this room was PLACED on, or absent for a mesh room.
   *
   * THE ROOM IS THE ONLY THING THAT CAN REMEMBER THIS. `planDialTransport` chooses a node
   * once, synchronously, at the invite that creates the room; every later op for this call —
   * a joiner's handshake, a producer, a consumer — has to reach THAT node and no other,
   * because a room's routers live on one host and media must arrive at the host holding them.
   * Re-planning per op would spread one call across nodes, which is not a degraded call but a
   * broken one. So the choice is recorded here and read, never recomputed.
   *
   * ABSENT MEANS MESH, and that is the only safe reading: a room hydrated from a record
   * written before this field existed carries none, and a rolling deploy serves both bundles
   * for about a minute — long enough for real calls. Reading a missing assignment as anything
   * but mesh would hand such a room to a node that has never heard of it.
   *
   * Carries the PRIVATE address as well as the public one, because the two planes are
   * different: signaling posts to the private one, the public one is what a client is told to
   * send media to. An assignment holding only the public address would leave the next
   * signaling caller nothing else to reach the node by — and it would be used, because it
   * would be the only address there.
   */
  voip?: VoipAssignment;
}

/**
 * How long a freshly-hydrated room is allowed to look empty. A leader change is
 * detected within one lease renew (3s) and the browsers re-register immediately
 * after their `resync`, so this only has to cover a slow client — after it, a
 * room with nothing but ghosts is genuinely dead and behaves exactly as before.
 */
export const HYDRATED_GRACE_MS = 45_000;

/** Host/co-host role of a pin in a room, for badges + moderation gating. */
export function roleOf(meta: RoomMeta | undefined, pin: string): "host" | "cohost" | undefined {
  if (!meta) return undefined;
  if (meta.hostPin === pin) return "host";
  if (meta.cohosts.has(pin)) return "cohost";
  return undefined;
}
function isModerator(meta: RoomMeta | undefined, pin: string): boolean {
  return roleOf(meta, pin) !== undefined;
}

/** Fired once per ENDED room that had ≥2 participants and was actually answered. */
export type ConferenceEndHook = (info: {
  roomId: string;
  startedAt: number;
  answeredAt: number | null;
  endedAt: number;
  dialedNumber: string | null;
  /** #116 — how it was DIALLED, or null when unknown (a party line is joined, and
   *  a room hydrated from a pre-feature record carries no flag). */
  video: boolean | null;
  participants: Array<{ pin: string; name: string }>;
}) => void;

export interface RelayRegistry {
  clients: Map<string, RelayClient>;          // pin   -> primary (in-call) client
  rooms: Map<string, Set<string>>;            // rid   -> set<pin>
  connections: Map<string, RelayConnection>;  // cid   -> connection
  cidToPin: Map<string, string>;              // cid   -> last assigned pin
  /**
   * Multi-device ring (feature-flagged): every LIVE device socket per number,
   * keyed pin -> cid -> socket. Always maintained (cheap bookkeeping); only
   * READ when MULTI_DEVICE_RING is on, so the flag-off path is unaffected.
   */
  devices: Map<string, Map<string, RelaySocket>>;
  /**
   * Persistent call membership: pin -> roomId. A member stays here across a
   * disconnect/refresh (so they can AUTO-REJOIN without a fresh invite); they're
   * removed ONLY on explicit hang-up (`leave`) or when the room is reaped as
   * abandoned. This is the source of truth for "are you still in this call?".
   */
  pinRoom: Map<string, string>;
  /**
   * Call-waiting HOLD: pin -> the roomId that pin has on hold while it talks in
   * its (different) ACTIVE room (`pinRoom`). The pin stays in BOTH rooms' member
   * Sets — `pinRoom` is the active one, `heldRoom` the frozen one. Media to/from
   * the held room is paused client-side; the server just remembers the link so a
   * `swap` can resume it and a hang-up of the active call can auto-promote it. At
   * most one held room per pin (a 3rd concurrent call is rejected client-side).
   */
  heldRoom: Map<string, string>;
  /** Per-room abandonment timer (armed when no member is connected). */
  roomReapT: Map<string, ReturnType<typeof setTimeout>>;
  /** Per-room lifetime metadata for conference-history logging. */
  roomMeta: Map<string, RoomMeta>;
  /**
   * Undelivered/live rings, calleePin -> latest ring details. Written on every
   * invite; consumed by the register handler so a callee who (re)connects
   * mid-ring — page reload, SSE blip, or a PAGED offline device opening the app
   * from a push notification — gets the ring DELIVERED late instead of never.
   * Entries expire after PENDING_RING_TTL_MS and are cleared on accept/reject/
   * cancel, so a stale ring can never resurrect.
   */
  pendingRings: Map<string, PendingRing>;
  /** Set by attachRelay — fired from reapRoom when a real call ends. */
  onConferenceEnd?: ConferenceEndHook;
  /**
   * Set by attachRelay — fired from `cancelPendingRings` for a callee whose ring
   * was delivered by PUSH, so their handset stops ringing when the caller gives up.
   *
   * ON THE REGISTRY RATHER THAN A PARAMETER, and that is the whole point: three
   * call sites cancel rings today and each would have to remember to pass it, which
   * is precisely how the fourth comes to be written without it. `onConferenceEnd`
   * sits here for the same reason.
   */
  onCancelRingPush?: CancelPushHook;
}

export interface PendingRing {
  from: string;      // caller pin
  roomId: string;    // the caller's dial room the accept must target
  video: boolean;    // mutual-consent flow: was this dialed as a video call?
  at: number;        // unix ms when the invite was dispatched
  /**
   * Was this ring delivered by a PUSH rather than over a live socket?
   *
   * It decides whether a hang-up owes this callee a `call_cancel` push. A callee
   * rung over their own open socket gets the websocket `ring-cancel` and needs
   * nothing more; a callee whose phone was woken has, by definition, no socket to
   * receive that on, so without a pushed cancel their handset rings out its full
   * 45s expiry after the caller has already given up.
   *
   * OPTIONAL, and absent means false, which is the safe direction in both senses:
   * a record written by a not-yet-updated instance mid-deploy — or hydrated from
   * a previous leader — degrades to exactly today's behaviour, and the failure it
   * cannot cause is pushing a cancel at somebody we never pushed a ring to.
   */
  pushed?: boolean;
}

/** How long a pending ring stays redeliverable. Slightly longer than the
 *  caller's 65s client-side no-answer backstop so the window is caller-owned. */
export const PENDING_RING_TTL_MS = 70_000;

export function createRegistry(): RelayRegistry {
  return {
    clients: new Map(),
    rooms: new Map(),
    connections: new Map(),
    cidToPin: new Map(),
    devices: new Map(),
    pinRoom: new Map(),
    heldRoom: new Map(),
    roomReapT: new Map(),
    roomMeta: new Map(),
    pendingRings: new Map(),
  };
}

/** Drop a callee's pending ring, optionally only when it matches a caller/room
 *  (so clearing one call's ring can't erase a different caller's). */
export function clearPendingRing(
  reg: RelayRegistry,
  calleePin: string,
  match?: { from?: string; roomId?: string }
) {
  const pr = reg.pendingRings.get(calleePin);
  if (!pr) return;
  if (match?.from && pr.from !== match.from) return;
  if (match?.roomId && pr.roomId !== match.roomId) return;
  reg.pendingRings.delete(calleePin);
}

/**
 * (Re)deliver a live ring to a callee who just (re)connected. Fired from the
 * register handler. Verifies the call is still genuinely ringing (caller
 * connected, still ringing this pin, still in the same room, TTL fresh) so a
 * stale entry can never pop a ghost ring. Also upgrades the caller's dial card
 * from "paging" to a real "Ringing…" ack, since the callee's device is now
 * actually alerting. The entry is kept until accept/reject/cancel/TTL so a
 * second reload mid-ring redelivers again.
 */
export function deliverPendingRing(reg: RelayRegistry, calleePin: string, socket?: RelaySocket) {
  const pr = reg.pendingRings.get(calleePin);
  if (!pr) return;
  if (Date.now() - pr.at > PENDING_RING_TTL_MS) {
    reg.pendingRings.delete(calleePin);
    return;
  }
  const caller = reg.clients.get(pr.from);
  if (!caller || !caller.ringing.has(calleePin) || caller.roomId !== pr.roomId) {
    reg.pendingRings.delete(calleePin);
    return;
  }
  const callee = reg.clients.get(calleePin);
  if (!callee) return;
  // Multi-device (v2.99.5): deliver to the channel that just (re)registered
  // when the caller passes it — the number's primary socket may be a
  // DIFFERENT device that is already ringing. Default stays the primary.
  safeSend(socket ?? callee.socket, {
    type: "ring",
    from: pr.from,
    fromName: caller.name,
    flag: caller.flag,
    roomId: pr.roomId,
    video: pr.video,
  });
  safeSend(caller.socket, { type: "ringing", pin: calleePin, name: callee.name });
}

/** Record/refresh a participant in a room's history roster (pin -> name). */
function rosterTouch(reg: RelayRegistry, roomId: string, pin: string, name: string) {
  const meta = reg.roomMeta.get(roomId);
  if (meta) meta.roster.set(pin, name || "Guest");
}

/** Mark a room as active "now" so its logged end time tracks real activity,
 *  not the (possibly 5-min-later) abandonment-reap wall clock. */
function roomActivityTouch(reg: RelayRegistry, roomId: string | null | undefined) {
  if (!roomId) return;
  const meta = reg.roomMeta.get(roomId);
  if (meta) meta.lastActiveAt = Date.now();
}

// How long a room with NO connected members survives before it's reaped. A
// member who returns within this window auto-rejoins; longer and the call is
// considered over. Generous so "refresh / step away / come back" keeps the call.
export const ROOM_ABANDON_MS = 5 * 60_000;

/** A room "member" who currently has a live client connection (or is in grace). */
function roomConnectedCount(reg: RelayRegistry, roomId: string): number {
  const room = reg.rooms.get(roomId);
  if (!room) return 0;
  let n = 0;
  room.forEach(pin => { if (reg.clients.has(pin)) n++; });
  return n;
}

/** Add a pin to a room as a persistent member + cancel any abandonment reap. */
function joinRoomMember(reg: RelayRegistry, roomId: string, pin: string) {
  let room = reg.rooms.get(roomId);
  if (!room) { room = new Set(); reg.rooms.set(roomId, room); }
  // #109 — stamp WHEN this pin joined, for the invite screen's "joined 4m ago".
  // Read BEFORE the add, because membership is a Set and every rejoin, merge and
  // reconnect comes back through here: without this test a member's join time
  // would be rewritten on every one of them and always read "just now".
  //
  // Here rather than at the accept / admit / rejoin sites for the same reason
  // seedCohostOnJoin is: this is the one funnel every route into a room passes
  // through, so no path can forget it.
  if (!room.has(pin)) {
    const meta = reg.roomMeta.get(roomId);
    if (meta) {
      if (!meta.joinedAt) meta.joinedAt = new Map();
      meta.joinedAt.set(pin, Date.now());
    }
  }
  room.add(pin);
  reg.pinRoom.set(pin, roomId);
  const t = reg.roomReapT.get(roomId);
  if (t) { clearTimeout(t); reg.roomReapT.delete(roomId); }
  // Busy-line mirror (v2.91): a coalesced next-tick sync, so an accept that
  // joins + flips roomMeta.accepted in the same handler is observed settled.
  touchBusyState();
  // #113: if this room was started FOR A GROUP and this pin is one of its
  // admins, they join as a co-host. Placed here rather than at the accept /
  // admit / rejoin sites so no path can forget it — every route into a room
  // goes through this function.
  seedCohostOnJoin(reg, roomId, pin);
  markRoomDirty(roomId); // Round 11: shadow the room into Redis (leader only)
}

/**
 * #113 — read a signed group-call seed into the admin pin set, or undefined.
 *
 * A thin wrapper so the room-creation site stays synchronous and readable, and so
 * the ONE-WAY property is inspectable in one place: this reads a signature and
 * returns a set of pins. It performs no database access and writes nothing.
 */
function seededGroupAdmins(callerPin: string, seed: unknown): Set<string> | undefined {
  const claim = verifyGroupCallSeed(seed, callerPin);
  if (!claim || claim.adminPins.length === 0) return undefined;
  return new Set(claim.adminPins);
}

/**
 * #113 — a group ADMIN who joins a call started for that group becomes a CO-HOST.
 *
 * ADDITIVE ONLY, and that is what makes it safe: it never demotes anybody, never
 * moves the host, and never grants anything to a pin the seed did not name. The
 * room's creator stays its host — they are present and they started it — and
 * `roleOf` already treats a co-host as a moderator, so an admin gets the full set
 * of powers the ask is about without any reshuffling.
 *
 * HOST SUCCESSION NEEDS NO CHANGE, and that is worth saying: `pickSuccessor`
 * already prefers a CONNECTED co-host, so a departing host now hands the room to a
 * group admin who is actually in the call — for free, and without succession ever
 * consulting group roles (which would risk promoting an admin who is absent).
 */
function seedCohostOnJoin(reg: RelayRegistry, roomId: string, pin: string): void {
  const meta = reg.roomMeta.get(roomId);
  if (!meta?.groupAdminPins?.has(pin)) return;
  if (meta.hostPin === pin) return; // host outranks co-host; nothing to add
  if (meta.cohosts.has(pin)) return;
  meta.cohosts.add(pin);
  markRoomDirty(roomId);
}

/** Fully tear down a room (abandoned, or last member explicitly left). */
/**
 * #129 — who owns which mediasoup id, per room. See `server/mediasoupRoom.ts` for why the app
 * has to be the ownership authority at all (the node records no owner for anything, so an
 * unowned `produce` is caller-ID spoofing inside a live call).
 *
 * Module-level rather than on the registry, deliberately: it holds no call state and no
 * identity, only ids the node minted, so it must never be persisted or hydrated — a room
 * recovered by a new leader has no node-side transports to own. Both funnels below clear it.
 */
const voipSessions: SessionStore = new Map();

/** Test seam only — the store is process-lifetime state and a suite must not inherit it. */
export function _resetVoipSessionsForTests(): void {
  voipSessions.clear();
}

function reapRoom(reg: RelayRegistry, roomId: string) {
  touchBusyState(); // busy-line + party-line-count mirror (v2.91)
  markRoomDirty(roomId); // the snapshot will be null ⇒ a fenced DEL
  /* Drop the whole ownership ledger with the room. Placed in reapRoom because its own comment
     above states the property this relies on — "reapRoom is the single teardown path" — so no
     future exit can leak a room's ids by forgetting to. */
  forgetRoom(voipSessions, roomId);
  const t = reg.roomReapT.get(roomId);
  if (t) { clearTimeout(t); reg.roomReapT.delete(roomId); }
  // Conference history: if this room was a REAL call (answered, ≥2 participants
  // ever present), emit it for logging before we lose the roster. Fired exactly
  // once per room — reapRoom is the single teardown path. Best-effort.
  const meta = reg.roomMeta.get(roomId);
  reg.roomMeta.delete(roomId);
  if (meta && meta.accepted && meta.roster.size >= 2 && reg.onConferenceEnd) {
    try {
      // End time = the last moment a member was actually connected, NOT the
      // wall-clock reap time. For an immediate hang-up these are ~equal; for an
      // ABANDONED room they differ by up to ROOM_ABANDON_MS (5 min), so using
      // lastActiveAt keeps the logged duration honest. Clamp to >= startedAt.
      const endedAt = Math.max(meta.startedAt, meta.lastActiveAt || Date.now());
      reg.onConferenceEnd({
        roomId,
        startedAt: meta.startedAt,
        answeredAt: meta.answeredAt,
        endedAt,
        dialedNumber: meta.dialedNumber,
        // #116 — `?? null` rather than `?? false`: absent means we never recorded
        // it, which History must render as nothing rather than as "Voice".
        video: meta.video ?? null,
        participants: Array.from(meta.roster.entries()).map(([pin, name]) => ({ pin, name })),
      });
    } catch { /* never let history logging break teardown */ }
  }
  const room = reg.rooms.get(roomId);
  if (room) {
    room.forEach(pin => {
      if (reg.pinRoom.get(pin) === roomId) reg.pinRoom.delete(pin);
      const c = reg.clients.get(pin);
      if (c && c.roomId === roomId) c.roomId = null;
    });
    reg.rooms.delete(roomId);
  }
}

/** If a room has no connected members, arm the abandonment reaper. */
function maybeScheduleRoomReap(reg: RelayRegistry, roomId: string) {
  if (!reg.rooms.has(roomId)) return;
  if (roomConnectedCount(reg, roomId) > 0) return; // someone's still here
  if (reg.roomReapT.has(roomId)) return;            // already counting down
  reg.roomReapT.set(roomId, setTimeout(() => {
    reg.roomReapT.delete(roomId);
    // Re-check at fire time — a member may have rejoined.
    if (roomConnectedCount(reg, roomId) === 0) reapRoom(reg, roomId);
  }, ROOM_ABANDON_MS));
}

/**
 * If `pin` is still a member of an active call, hand the (re)connecting client a
 * `rejoin` so it re-enters the call WITHOUT a fresh invite: cancel the room's
 * abandonment timer, restore the live roomId and send the current member list.
 * `iceServers` is declared below in the same module.
 */
function sendRejoinIfInRoom(reg: RelayRegistry, socket: RelaySocket, pin: string) {
  const rid = reg.pinRoom.get(pin);
  if (!rid || !reg.rooms.has(rid)) return;
  const rmeta = reg.roomMeta.get(rid);
  const members = Array.from(reg.rooms.get(rid) || [])
    .filter(p => p !== pin)
    .map(p => ({ pin: p, name: (reg.clients.get(p) || { name: "Guest" }).name || "Guest", device: reg.clients.get(p)?.device, flag: reg.clients.get(p)?.flag, role: roleOf(rmeta, p) }));
  // A rejoin is only meaningful if someone is actually THERE. Members whose
  // client record is gone (disconnect grace long expired — tab closed, network
  // died) are GHOSTS: rejoining a room of ghosts resurrected zombie calls
  // forever — each rejoin also CANCELS the abandonment reaper below, so every
  // app-open re-immortalized the dead room, the device sat silently "in a
  // call", real incoming rings degraded to call-waiting, and the zombie's
  // eventual death auto-declined them ("calls disconnect within seconds").
  const connectedOthers = members.filter(m => reg.clients.has(m.pin)).length;
  if (members.length === 0 || connectedOthers === 0) {
    // …unless this member is a caller MID-DIAL: legitimately alone in a FRESH
    // room while their callee still rings. Re-registers happen DURING dials
    // (geo-flag re-affirm ~1-2s after boot, SSE blip → ready → register), and
    // reaping here killed the dial out from under the caller — the callee's
    // accept then bounced with error{gone} while the caller rang to the 65s
    // backstop. A live dial = outstanding pending rings + a young, unanswered
    // room; keep it (there's nothing to rejoin — the client never left).
    const c = reg.clients.get(pin);
    const midDial =
      !!c && c.ringing.size > 0 && !!rmeta && !rmeta.accepted &&
      Date.now() - rmeta.startedAt < PENDING_RING_TTL_MS;
    if (midDial) return;
    // …or the room was just HYDRATED by a newly-elected leader (Round 11). Every
    // member of such a room is a ghost until its owner re-registers, so without
    // this the FIRST peer to come back would dissolve the very call the
    // hydration existed to save — and persistence would be a no-op end to end.
    if (rmeta?.hydratedAt && Date.now() - rmeta.hydratedAt < HYDRATED_GRACE_MS) {
      const t0 = reg.roomReapT.get(rid);
      if (t0) { clearTimeout(t0); reg.roomReapT.delete(rid); }
      const cs = reg.clients.get(pin);
      if (cs) cs.roomId = rid;
      safeSend(socket, {
        type: "rejoin",
        roomId: rid,
        members,
        hydrated: true,
        cap: mintRoomCap(rid, pin, roleOf(rmeta, pin)),
        selfRole: roleOf(rmeta, pin),
        hostPin: rmeta?.hostPin ?? null,
        iceServers: iceServers(pin),
      });
      return;
    }
    // ALONE (stale solo dial room) or only ghosts left. Don't drop the user
    // into a dead "call" screen; release the membership so they land in the
    // lobby, and let the orphaned room reap.
    leaveRoom(reg, pin);
    return;
  }
  const t = reg.roomReapT.get(rid);
  if (t) { clearTimeout(t); reg.roomReapT.delete(rid); }
  const cself = reg.clients.get(pin);
  if (cself) cself.roomId = rid;
  safeSend(socket, {
    type: "rejoin",
    roomId: rid,
    members,
    // Round 11 B: the signed proof that WE admitted this pin to this room, so a
    // later "the server no longer knows this room" can be repaired without the
    // client being trusted about who it is. See server/roomCapability.ts.
    cap: mintRoomCap(rid, pin, roleOf(rmeta, pin)),
    selfRole: roleOf(rmeta, pin),
    hostPin: rmeta?.hostPin ?? null,
    iceServers: iceServers(pin),
  });
}

/**
 * Admit a pin into an EXISTING live room WITHOUT a ring (v2.99.9) — the
 * join-without-ring machinery shared by the approved-knock rejoin. Mirrors the
 * accept path + joinPartyLine: roster/host roles, `joined` to the newcomer,
 * `peer-joined` fan-out to everyone already in, and an SFU token. The caller
 * is responsible for authorization (knock-approve gates it on host consent).
 * No-op if the newcomer has no live client record or the room is gone/full.
 */
function admitToRoom(reg: RelayRegistry, pin: string, roomId: string): void {
  const joiner = reg.clients.get(pin);
  const room = reg.rooms.get(roomId);
  const meta = reg.roomMeta.get(roomId);
  if (!joiner || !room || !meta) return;
  const cap = ROOM_MAX;
  if (room.size >= cap && !room.has(pin)) {
    safeSend(joiner.socket, { type: "knock-result", to: "", ok: false, reason: "full" });
    return;
  }
  // If the joiner was mid-something in a stale solo room, drop it first.
  if (joiner.roomId && joiner.roomId !== roomId) leaveRoom(reg, pin);
  const members = Array.from(room)
    .filter(p => p !== pin && reg.clients.has(p))
    .map(p => ({ pin: p, name: (reg.clients.get(p) || { name: "Guest" }).name || "Guest", device: reg.clients.get(p)?.device, flag: reg.clients.get(p)?.flag, role: roleOf(meta, p) }));
  joinRoomMember(reg, roomId, pin);
  joiner.roomId = roomId;
  meta.roster.set(pin, joiner.name);
  meta.lastActiveAt = Date.now();
  safeSend(joiner.socket, {
    type: "joined",
    roomId,
    members,
    cap: mintRoomCap(roomId, pin, roleOf(meta, pin)),
    selfRole: roleOf(meta, pin),
    hostPin: meta.hostPin ?? null,
    iceServers: iceServers(pin),
  });
  members.forEach(m => {
    const o = reg.clients.get(m.pin);
    if (o) {
      safeSend(o.socket, {
        type: "peer-joined",
        pin,
        name: joiner.name,
        device: joiner.device,
        flag: joiner.flag,
        role: roleOf(meta, pin),
        iceServers: iceServers(m.pin),
      });
    }
  });
  touchBusyState();
}

/** Multi-device ring is OFF by default — enable per-deploy with MULTI_DEVICE_RING=1.
 *  Read per-call (like the other feature gates) so it can be toggled via Secrets. */
export function multiDeviceEnabled(): boolean {
  const v = (process.env.MULTI_DEVICE_RING || "").toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/** Record/refresh a device socket for a number. Cheap bookkeeping, always run. */
function deviceAdd(reg: RelayRegistry, pin: string, cid: string, socket: RelaySocket) {
  if (!cid) return;
  let m = reg.devices.get(pin);
  if (!m) { m = new Map(); reg.devices.set(pin, m); }
  m.set(cid, socket);
}
function deviceRemove(reg: RelayRegistry, pin: string, cid: string) {
  const m = reg.devices.get(pin);
  if (!m) return;
  m.delete(cid);
  if (m.size === 0) reg.devices.delete(pin);
}

// Grace window before a client is fully removed after its SSE channel drops.
// SSE channels are routinely cut by proxies/Cloud Run; a brief grace lets the
// client reconnect (same cid) and keep its number, room, and active call.
export const RELAY_DISCONNECT_GRACE_MS = 30_000;

/**
 * A COUNT off the wire, or null. Never NaN, never negative, never fractional.
 *
 * JSON gives no guarantees about what arrives, and this value feeds a comparison
 * (`>= GROUP_MIN_PARTIES`) where NaN silently answers false and a fractional or
 * negative number is nonsense. Returning null rather than a default keeps "the caller
 * said nothing" and "the caller said something unusable" the same case, which is what
 * `isGroupParty` already treats as 1:1.
 */
function wireCount(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  const n = Math.floor(v);
  return n > 0 ? n : null;
}

function safeSend(socket: RelaySocket, obj: unknown) {
  try {
    socket.send(obj);
  } catch {
    /* ignore broken pipe */
  }
}

/**
 * A throwaway signaling pin for a client we could NOT authenticate.
 *
 * This is not an allocator — it hands out a number that may well belong to a
 * real identity, because the only thing it can consult is in-memory registry
 * state (the register path must stay synchronous; its one permitted await is
 * `createContext` up in the HTTP layer). `identities`, `party_lines` and
 * `number_reservations` are all invisible from here, so a number whose owner
 * simply has no live SSE stream looks free.
 *
 * That collision is made HARMLESS by `pinIsAddressable` rather than by this
 * function: an unverified registration is never rung, never handed a room, and
 * never handed a pending ring. Widening the exclusion set below only shrinks the
 * window; it is defence in depth, not the fix.
 */
export function genPin(reg: RelayRegistry): string {
  // Exclude every number this process knows is in use — including one whose
  // client record has been reaped but whose ROOM membership survives for
  // auto-rejoin (cleanupRegistryConn deliberately keeps pinRoom), which is
  // exactly the case a `reg.clients`-only check missed.
  const taken = (p: string) => reg.clients.has(p) || reg.pinRoom.has(p) || reg.heldRoom.has(p);
  // CSPRNG: v2.99.20 #9 replaced Math.random() in `randomDigits6` for exactly
  // this reason (V8's xorshift128+ state is recoverable from a few outputs, so
  // a predictable pin can be pre-claimed) and missed this second site.
  for (let i = 0; i < 200; i++) {
    const pin = String(crypto.randomInt(100000, 1000000));
    if (!taken(pin)) return pin;
  }
  // Exhaustion is not a real state (200 misses against ~900k needs the registry
  // to be nearly full); scan rather than loop forever or throw into the register
  // path, which would deny service to every new client.
  for (let n = 100000; n < 1000000; n++) {
    const pin = String(n);
    if (!taken(pin)) return pin;
  }
  throw new Error("no free signaling pin");
}

/**
 * May this number be DIALLED, rejoined, or handed a pending ring?
 *
 * Only when the registration behind it was proven — either the request's cookie
 * resolved to that exact number (`verifiedPin`), or the record predates the
 * check / came from a direct `handleMessage` call with no untrusted transport.
 *
 * Without this, `genPin` handing an anonymous client a number that belongs to a
 * dormant identity was full impersonation: inbound dials fan to the squatter's
 * socket (multi-device ring is on fleet-wide), `deliverPendingRing` hands over a
 * ring already in flight, and the ring card renders the victim's name, avatar and
 * verified badge because the callee resolves the caller BY PIN.
 *
 * Costs nothing legitimate: an unverified client holds a randomly minted number
 * that was never published anywhere, so there is no one who could be dialling it.
 */
function pinIsAddressable(rec: { verifiedPin?: boolean } | undefined): boolean {
  return !!rec && rec.verifiedPin !== false;
}

export function newRoomId(): string {
  return "r" + crypto.randomBytes(6).toString("hex");
}

/**
 * Time-limited TURN credentials (coturn `use-auth-secret` flow).
 *   username   = `${expiry-unix}:${userId}`
 *   credential = base64( HMAC-SHA1(secret, username) )
 *
 * If TURN is not configured we just hand out STUN. STUN works on
 * the vast majority of networks; ~10–20% of strict-NAT users won't
 * connect without a real TURN relay (run coturn separately on a
 * VPS and set the two env vars to enable that path).
 */
export function iceServers(userId: string, ttlSecOverride?: number): IceServer[] {
  const list: IceServer[] = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun.cloudflare.com:3478" },
  ];
  const TURN_SECRET = process.env.TURN_SECRET || "";
  // MULTI-RELAY (v2.99.61). The fleet now runs one coturn per availability
  // zone, so a zone loss must not take the relay path with it. `TURN_HOSTS` is
  // a comma/whitespace separated list; `TURN_HOST` remains the single-relay
  // spelling and is used when the list is absent, so an existing deployment is
  // byte-identical until it opts in.
  //
  // Every relay is advertised with the SAME minted credential: coturn in
  // `use-auth-secret` mode validates the HMAC against its own static-auth-secret,
  // so relays sharing that secret all accept the same username/credential pair.
  // The client gathers relay candidates from every one of them, which is what
  // makes the failover automatic — if a zone drops, the peer already holds a
  // candidate on the surviving relay instead of having to re-negotiate blind.
  const turnHosts = (process.env.TURN_HOSTS || process.env.TURN_HOST || "")
    .split(/[\s,]+/)
    .map((h) => h.trim())
    .filter(Boolean)
    .filter((h, i, a) => a.indexOf(h) === i); // dedupe: a repeat would double-gather for nothing
  const TURN_HOST = turnHosts[0] || "";
  // The relay's UDP and TCP listeners may sit behind different public IPs
  // (e.g. two separate Layer-4 load balancers). TURN_TCP_HOST overrides the
  // host used for the TCP/TLS candidates; it falls back to TURN_HOST.
  //
  // It is honoured ONLY in the single-relay case, which is the deployment it was
  // written for (v2.92 R4C). With several relays each has its own address, so a
  // single global TCP override cannot be correct for all of them — each relay
  // uses its own host and this variable is ignored rather than silently
  // pointing every relay's TCP candidates at one zone.
  const singleRelay = turnHosts.length <= 1;
  const TURN_TCP_HOST = (singleRelay && process.env.TURN_TCP_HOST) || TURN_HOST;
  const TURN_PORT = process.env.TURN_PORT || "3478";
  const TURN_TLS_PORT = process.env.TURN_TLS_PORT || "5349";
  const TURN_TLS = process.env.TURN_TLS === "1"; // only advertise turns: when a cert is configured
  // `ttlSecOverride` lets the anonymous /api/relay/ice probe endpoint mint
  // SHORT-lived creds (300s) instead of full call-length ones (v2.88).
  // v2.92 (R4C): TURN_TTL (credential lifetime, seconds) is operator-tunable;
  // a missing/garbage/non-positive value falls back to the historical 3600 so
  // a typo can never mint already-expired (or "NaN:") usernames.
  const envTtl = parseInt(process.env.TURN_TTL || "3600", 10);
  const TURN_TTL = ttlSecOverride ?? (Number.isFinite(envTtl) && envTtl > 0 ? envTtl : 3600);
  if (TURN_SECRET && TURN_HOST) {
    // Operator-supplied TURN (recommended for production). coturn runs in
    // use-auth-secret mode: username = "<expiry-unix>:<userId>",
    // credential = base64(HMAC-SHA1(secret, username)).
    const username =
      Math.floor(Date.now() / 1000) + TURN_TTL + ":" + userId;
    const credential = crypto
      .createHmac("sha1", TURN_SECRET)
      .update(username)
      .digest("base64");
    // "off" (or 0/empty) SUPPRESSES the plaintext-TCP alt candidate. That is
    // needed to put TLS on 443 — the strongest firewall-penetrating option,
    // since turns:<host>:443 is indistinguishable from HTTPS on the wire, where
    // plaintext TURN on 443 is exactly what DPI drops. Both cannot share the
    // port, so advertising `turn:…:443` alongside `TURN_TLS_PORT=443` would
    // point clients at a TLS listener in plaintext and fail every time.
    const altRaw = process.env.TURN_TCP_ALT_PORT ?? "443";
    const altOff = /^(off|none|0|false)$/i.test(altRaw.trim()) || altRaw.trim() === "";
    const TURN_TCP_ALT_PORT = altOff ? "" : altRaw.trim();
    // Emitted per relay, in the configured order. The single-relay case is
    // byte-identical to the pre-v2.99.61 output (same URLs, same order), so
    // opting in is the only thing that changes behaviour.
    for (const host of turnHosts) {
      // With one relay the TCP candidates may be pointed at a different IP via
      // TURN_TCP_HOST; with several, each relay answers on its own address.
      const tcpHost = singleRelay ? TURN_TCP_HOST : host;
      // UDP relay (primary path) on the UDP load balancer IP.
      list.push({ urls: "turn:" + host + ":" + TURN_PORT + "?transport=udp", username, credential });
      // TURN over TCP on port 443 (firewall/CGNAT-penetrating fallback). Port 443
      // is virtually never blocked, so this path connects even on mobile/carrier
      // and corporate networks that drop UDP and non-standard TCP ports like 3478.
      // The L4 load balancer maps external 443 -> coturn 3478, so no coturn change
      // is needed and relay media tunnels back to the client over this same TCP
      // connection. This is the key fix for calls hanging on "connecting...".
      if (!altOff) {
        list.push({ urls: "turn:" + tcpHost + ":" + TURN_TCP_ALT_PORT + "?transport=tcp", username, credential });
      }
      // TCP relay on the standard port (additional fallback) on the TCP LB IP.
      list.push({ urls: "turn:" + tcpHost + ":" + TURN_PORT + "?transport=tcp", username, credential });
      // TLS relay only when a certificate is actually provisioned on coturn,
      // otherwise the turns: candidate just wastes time failing the handshake.
      if (TURN_TLS) {
        list.push({ urls: "turns:" + tcpHost + ":" + TURN_TLS_PORT + "?transport=tcp", username, credential });
      }
    }
  } else if (process.env.RELAY_DISABLE_PUBLIC_TURN !== "1") {
    // No operator TURN configured. Use OpenRelay's free public TURN as a
    // safety net so users on strict/symmetric NAT can still connect.
    // These credentials are public/shared (published by metered.ca) and
    // intentionally not secret; they're rate-limited but fine for small
    // groups and testing. Set RELAY_DISABLE_PUBLIC_TURN=1 to opt out.
    const openRelay = { username: "openrelayproject", credential: "openrelayproject" };
    list.push({ urls: "turn:openrelay.metered.ca:80", ...openRelay });
    list.push({ urls: "turn:openrelay.metered.ca:443", ...openRelay });
    list.push({ urls: "turn:openrelay.metered.ca:443?transport=tcp", ...openRelay });
    list.push({ urls: "turns:openrelay.metered.ca:443?transport=tcp", ...openRelay });
  }
  return list;
}

/* ──────────────────────────────────────────────────────────────────────────
 * THE PARTICIPANT CAP.
 *
 * Every call runs on the WebRTC mesh, so this is one number rather than a
 * per-transport choice. It was `sfuEnabled ? 10 : 6` until v2.106.53, when the
 * hosted SFU it named was retired; the mesh number is what the whole ladder
 * degrades to and therefore the only cap the signaling layer can promise.
 *
 * SIX, and it is a measurement rather than a preference: on the mesh each phone
 * runs N-1 encoders and N-1 decoders, which v2.99.84 measured as the single
 * biggest lever on call CPU and heat. `transportCap()` in voipRegistry.ts holds
 * the same 6 for the mesh and the higher number for a room pinned to one of our
 * own mediasoup nodes; when that path reaches this file, this is where it reads
 * from rather than a second copy of the arithmetic.
 * ────────────────────────────────────────────────────────────────────────── */
export const ROOM_MAX = 6;

/**
 * THE DEVICE THAT PLACES OR ANSWERS A CALL BECOMES THE NUMBER'S PRIMARY.
 *
 * WHY. Almost everything in this registry is addressed by PIN, and `reg.clients.get(pin)`
 * holds exactly ONE socket — the `signal` relay (`reg.clients.get(to)`), the `peer-joined`
 * fan-out, moderation and, until this release, the SFU join token all route through it.
 * But a number can hold SEVERAL devices (`reg.devices`; MULTI_DEVICE_RING is baked on in
 * ecosystem.config.cjs), and the register handler makes the LATEST REGISTRATION primary —
 * which has nothing whatever to do with which device its owner is calling from. An SSE
 * reconnect on an idle laptop is enough to take primary from the phone in your hand.
 *
 * So a call placed or answered from a non-primary device had its in-call traffic delivered
 * to a DIFFERENT device: no media in either direction, deterministically, while ring,
 * accept, roster and the in-call UI all succeeded. Fixing the token alone would leave the
 * mesh half of that intact, which matters now that a failed SFU falls back to it.
 *
 * SAFE BY THE SAME CONDITION THE REGISTER HANDLER ALREADY USES: we take over only when the
 * existing primary is IDLE (`!prev.roomId`). If it is in a call it stays primary and this
 * is a no-op — hijacking a live call's routing is precisely what that handler's
 * `keepPrimary` rule exists to prevent, and this must not undo it from the other side.
 *
 * NO EPOCH IS BUMPED, deliberately. The register handler bumps both epochs when it takes
 * over primary, to abort a dial resolver captured against the old socket. An idle primary
 * has no in-flight dial to abort, and bumping here would abort the very dial we are in the
 * middle of placing.
 *
 * THE `accept` HANDLER HAS DONE THIS SINCE v2.99.5 and the CALLER side was simply left out
 * — that asymmetry is the defect. Its version is deliberately UNCONDITIONAL where this one
 * is guarded, and the difference is right: an accepting device is joining a call and must
 * own the routing whatever the old primary was doing (its own hold/drop branch handles a
 * prior room), whereas dialling from a second device while the first is mid-call is a
 * second-line situation where stealing primary would break the live call on the other
 * device. So this one yields and the dial proceeds unchanged.
 */
function claimPrimaryForCall(
  reg: RelayRegistry,
  conn: { socket: RelaySocket; pin: string | null; cid?: string },
): void {
  if (!multiDeviceEnabled()) return; // flag off ⇒ one device ⇒ register already did this
  const pin = conn.pin;
  if (!pin) return;
  const prev = reg.clients.get(pin);
  if (!prev || prev.roomId) return;        // no record, or the primary is mid-call
  if (prev.socket === conn.socket) return; // already us
  prev.socket = conn.socket;
  if (conn.cid) prev.cid = conn.cid;
}


/**
 * Number of clients currently in a room. Returns 0 for a null/unknown
 * roomId. Used by busy-detection and reject-cleanup so we never report
 * "busy" for a target who is sitting alone in their own dialing room
 * (that's call-waiting, not busy) and never leak a caller's solo room
 * after their callee rejects.
 */
function roomSize(reg: RelayRegistry, roomId: string | null): number {
  if (!roomId) return 0;
  return reg.rooms.get(roomId)?.size ?? 0;
}

/**
 * Tell every callee we've rung (but who hasn't joined our room yet) that the
 * call is cancelled, so their incoming-ring UI clears instead of hanging until
 * the client-side timeout. Called when the caller leaves or disconnects.
 */
export function cancelPendingRings(reg: RelayRegistry, callerPin: string): string[] {
  const c = reg.clients.get(callerPin);
  if (!c || c.ringing.size === 0) return [];
  const pins = Array.from(c.ringing);
  pins.forEach(calleePin => {
    /* A PUSHED callee has no socket for the frame below to reach, so the cancel has
       to travel the way the ring did. Read BEFORE `clearPendingRing` destroys the
       record, and dispatched through the hook parameter rather than at the three
       call sites — a per-call-site duty is the one a fourth site forgets, which is
       the class this file already records for `sendPushToIdentity` and the presence
       rule. Fire-and-forget and individually caught: this runs on the hang-up path,
       where nothing may be allowed to throw. */
    const pending = reg.pendingRings.get(calleePin);
    if (reg.onCancelRingPush && pending?.pushed && pending.from === callerPin) {
      try {
        void reg.onCancelRingPush({ calleePin, roomId: pending.roomId });
      } catch { /* a notification must never break a hang-up */ }
    }
    const cancelMsg = { type: "ring-cancel", from: callerPin };
    // Multi-device: the invite rang EVERY one of the callee's devices (see the
    // devs.forEach fan-out in the invite handler), so the cancel must reach all
    // of them — otherwise a caller who hangs up BEFORE the callee answers leaves
    // the callee's OTHER devices ringing until their own client-side timeout.
    // Mirror the ring fan-out; fall back to the single primary socket when
    // multi-device is off or no device set is registered.
    const devs = multiDeviceEnabled() ? reg.devices.get(calleePin) : undefined;
    if (devs && devs.size > 0) {
      devs.forEach(sock => safeSend(sock, cancelMsg));
    } else {
      const callee = reg.clients.get(calleePin);
      if (callee) safeSend(callee.socket, cancelMsg);
    }
    // The call is over — a later (re)connect must not get this ring redelivered.
    clearPendingRing(reg, calleePin, { from: callerPin });
  });
  c.ringing.clear();
  return pins;
}

/** Send a message to every member of a room (optionally excluding one pin). */
function broadcastToRoom(
  reg: RelayRegistry,
  roomId: string,
  obj: unknown,
  exceptPin?: string
) {
  const room = reg.rooms.get(roomId);
  if (!room) return;
  room.forEach(p => {
    if (p === exceptPin) return;
    const c = reg.clients.get(p);
    if (c) safeSend(c.socket, obj);
  });
}

/**
 * EXPLICIT leave (hang-up / logout). Removes the pin from the room PERMANENTLY
 * (clears persistent membership), tells the others, and reaps the room if it's
 * now empty. NOTE: a mere connection drop does NOT call this — that path keeps
 * the membership so the member can auto-rejoin (see the grace reaper).
 */
/**
 * HOST SUCCESSION (v2.99.47). `hostPin` was written only at room creation and by
 * an explicit `makehost`, and nothing cleared or moved it when the host left — so
 * a call that outlived its creator (a group call, where the others stay parked)
 * had a host who was no longer in the room.
 *
 * That was mostly cosmetic until M45 added `room.has(conn.pin)` to the moderation
 * gate — correct in itself, since roomMeta outlives membership and a departed
 * host must not keep moderating. But the knock alert is only ever delivered to
 * `hostPin` + co-hosts, so with an absent host the History "Live now · Join" card
 * became a dead end: the knock was recorded, the prompt went to someone not in
 * the call, and an Approve tap hit the new gate and `break`'d silently, leaving
 * the knocker on "Asked the host to let you in…" forever.
 *
 * Promoting a successor fixes that at the root and restores every other host
 * control (mute, pin, kick) for the remaining participants. Preference order:
 * an existing co-host — already trusted by the original host — else the
 * longest-standing connected member, which the room's insertion order gives us.
 * Ghost members (membership without a live client) are skipped: handing the role
 * to a disconnected pin would recreate exactly the vacancy being repaired.
 */
function promoteHostIfVacant(reg: RelayRegistry, roomId: string, departed: string) {
  const meta = reg.roomMeta.get(roomId);
  const room = reg.rooms.get(roomId);
  if (!meta || !room || room.size === 0) return;
  if (meta.hostPin !== departed) return;              // the host is still here
  meta.cohosts.delete(departed);
  const connected = Array.from(room).filter(p => reg.clients.has(p));
  const successor = connected.find(p => meta.cohosts.has(p)) ?? connected[0];
  if (!successor) return;                             // only ghosts remain
  meta.hostPin = successor;
  meta.cohosts.delete(successor);                     // host outranks co-host
  markRoomDirty(roomId); // Round 11: moderation state must survive a leader change
  broadcastToRoom(reg, roomId, {
    type: "role",
    pin: successor,
    role: "host",
    hostPin: successor,
  });
}

/**
 * RENUMBER REBIND (v2.99.83) — move a LIVE signaling registration from one
 * 6-digit number to another, in place.
 *
 * WHY THIS EXISTS
 * ---------------
 * Presence is a DB row keyed on `identityId`; this registry is in memory and keyed
 * on PIN. `regenerateIdentityNumber` moves the database and every stored copy of
 * the number inside one transaction and touched the registry NOT AT ALL — so a
 * renumbered person stayed registered under their OLD pin. The owner reported four
 * symptoms and they were all this one bug:
 *
 *   - the dialer preview reads presence by identityId and says "online now", while
 *     the invite path reads `reg.clients.get(newPin)`, finds nothing, and answers
 *     `error{offline}`. Screenshots of both, seconds apart, is what proved it.
 *   - the room roster still names the old pin, so the in-call "Add to contacts"
 *     pill reappears for somebody already SAVED (their contact row was rewritten
 *     by the same transaction, so the two pins disagree).
 *   - `pinsInCall` still reports the old pin, so Contacts shows them plain
 *     "online" while they are in a call with the viewer.
 *
 * FULLY SYNCHRONOUS, DELIBERATELY. The registry is plain Maps and `handleMessage`
 * is dispatched from the same event loop, so a rename with no `await` in its body
 * cannot be interleaved and cannot be observed half-done. Any await here would
 * reintroduce exactly the window this closes.
 *
 * THE OLD PIN IS RETIRED, NOT ALIASED. Keeping it ringing the same person would
 * re-create the two-addresses-for-one-identity split being removed, and would
 * silently bypass the block-follows-you property, because `contacts.number` was
 * rewritten in the same transaction — so a caller dialling the stale number would
 * reach them with the block on the old row no longer consulted. A dial to the old
 * number now resolves to nothing and honestly reports `nonexistent`. It can never
 * be handed to a stranger either: the reservation ledger is monotonic and the old
 * number is never released.
 */
export function rebindRegisteredPin(
  reg: RelayRegistry,
  e: { identityId: number; oldNumber: string; newNumber: string }
): "rebound" | "not-registered" | "collision" | "failed" {
  const oldPin = e.oldNumber;
  const newPin = e.newNumber;
  if (!/^\d{6}$/.test(oldPin) || !/^\d{6}$/.test(newPin) || oldPin === newPin) {
    return "not-registered";
  }
  const c = reg.clients.get(oldPin);
  // STEP 1 — resolve and no-op. The COMMON case: a renumber while signed out, or
  // an admin acting on somebody who is not connected. Cheap and silent.
  const hasResidue =
    !!c ||
    reg.pinRoom.has(oldPin) ||
    reg.heldRoom.has(oldPin) ||
    reg.pendingRings.has(oldPin);
  if (!hasResidue) return "not-registered";

  // STEP 2 — collision check BEFORE any mutation.
  const other = reg.clients.get(newPin);
  if (other && other.cid !== (c?.cid ?? null)) {
    // The only legitimate way somebody else holds the new pin is an UNVERIFIED
    // `genPin` allocation — such a registration is already un-ringable via
    // `pinIsAddressable`. Evicting a VERIFIED holder would be the F1 seizure
    // class in reverse, so refuse and let the client-side self-heal converge.
    if (other.verifiedPin) {
      console.warn("[renumber] rebind refused, new pin held by a verified client", {
        identityId: e.identityId,
      });
      return "collision";
    }
    try {
      if (other.graceT) { clearTimeout(other.graceT); other.graceT = null; }
      leaveRoom(reg, newPin);
      reg.clients.delete(newPin);
      if (other.cid) {
        reg.cidToPin.delete(other.cid);
        deviceRemove(reg, newPin, other.cid);
      }
    } catch {
      /* evicting a squatter must not abort the rebind */
    }
  }

  try {
    const touched = new Set<string>();

    // STEP 3 — SEVER THE REVERSE INDEX FIRST. `cidToPin` beats the client's
    // requested pin in the register handler, so until it moves, a concurrent
    // re-register either re-asserts the OLD pin or is misclassified as an
    // identity switch — whose body DESTROYS the live call.
    if (c?.cid) {
      reg.cidToPin.set(c.cid, newPin);
      const conn = reg.connections.get(c.cid);
      if (conn) conn.pin = newPin;
    }

    // STEP 4 — move the client record. `verifiedPin` is set explicitly: after the
    // DB commit this pin genuinely IS cookie-resolvable, and leaving it false
    // would make the person un-ringable and un-rejoinable — an "offline"
    // indistinguishable from the bug being fixed.
    if (c) {
      reg.clients.set(newPin, c);
      reg.clients.delete(oldPin);
      c.verifiedPin = true;
    }

    // STEP 5 — devices (multi-device ring is live on the fleet).
    const devs = reg.devices.get(oldPin);
    if (devs) {
      reg.devices.set(newPin, devs);
      reg.devices.delete(oldPin);
    }

    // STEP 6 — membership, ACTIVE **and** HELD. A pin can legitimately be in two
    // rooms at once (talking in one, another parked), and it sits in BOTH rooms'
    // member Sets — so iterate both maps, not one.
    for (const map of [reg.pinRoom, reg.heldRoom]) {
      const rid = map.get(oldPin);
      if (rid == null) continue;
      map.delete(oldPin);
      map.set(newPin, rid);
      touched.add(rid);
      const room = reg.rooms.get(rid);
      if (room && room.delete(oldPin)) room.add(newPin);
    }
    if (c && c.roomId) touched.add(c.roomId);

    // STEP 7 — per-room metadata. The roster is add-only BY DESIGN everywhere
    // else; this is the one place that discipline must be violated, and it is
    // safe because it is the same person. Appending instead would leave a
    // permanent phantom participant in the conference history and keep the
    // rejoin-authorization gate honouring a dead pin.
    // forEach, not for...of: iterating a Set trips TS2802 against this repo's
    // downlevel target (the v2.99.72 trap, caught by `pnpm check` — `pnpm build`
    // uses esbuild and would not have).
    touched.forEach((rid) => {
      const meta = reg.roomMeta.get(rid);
      if (meta) {
        const nm = meta.roster.get(oldPin);
        if (nm !== undefined) { meta.roster.delete(oldPin); meta.roster.set(newPin, nm); }
        if (meta.hostPin === oldPin) meta.hostPin = newPin;
        if (meta.cohosts.delete(oldPin)) meta.cohosts.add(newPin);
        const knock = meta.knocks?.get(oldPin);
        if (knock) { meta.knocks!.delete(oldPin); meta.knocks!.set(newPin, knock); }
      }
    });

    // STEP 8 — pending rings: the KEY (a ring aimed at us) and every `from` value
    // (a ring WE placed). Missing the value leaves a ring the caller can no longer
    // cancel, which then blind-rejects their next call.
    const mine = reg.pendingRings.get(oldPin);
    if (mine) { reg.pendingRings.delete(oldPin); reg.pendingRings.set(newPin, mine); }
    reg.pendingRings.forEach((pr) => {
      if ((pr as { from?: string }).from === oldPin) (pr as { from?: string }).from = newPin;
    });

    // STEP 9 — every OTHER client's `ringing` set holds OUR pin as a callee. Miss
    // this and the accept authorization cannot find the ringer, so answering
    // fails. `c.ringing` itself needs nothing — it holds callee pins, not ours.
    reg.clients.forEach((cl) => {
      if (cl.ringing.delete(oldPin)) cl.ringing.add(newPin);
    });

    // STEP 10 — the external mirrors. Without markRoomDirty, hydration after a
    // leader change restores the OLD pin and the bug resurrects itself on
    // failover; without touchBusyState, the API tier keeps reporting the old pin
    // busy and the new pin free, so the Contacts symptom survives on the other
    // instance.
    touched.forEach((rid) => markRoomDirty(rid));
    touchBusyState();

    // STEP 11 — tell the client its pin moved WITHOUT making it re-register:
    // re-registering mid-call is read as an identity switch and drops the call.
    // `registered` is re-sent because the client's existing handler already sets
    // `me.pin` from it and persists it, so an older client needs no change.
    //
    // `safeSend` takes an OBJECT — the transport serializes. Handing it a
    // pre-stringified frame produces a JSON string with no `.type`, which the
    // client's dispatcher silently drops, so the whole step would be a no-op that
    // looks like it works. (Caught by this release's own test.)
    if (c) safeSend(c.socket, { type: "registered", pin: newPin, renumbered: true });
    return "rebound";
  } catch (err) {
    // The hook that calls this SWALLOWS throws, because the renumber is already
    // committed and must never be reported as failed — which means a throw here is
    // invisible. So the catch is the destructive-but-safe fallback: treat it as an
    // identity switch on the OLD pin. That ends the person's live call, which is
    // bad, but it leaves no half-renamed state and no stale registration, so their
    // next register lands correctly. A dropped call is recoverable; a split
    // identity is the bug being fixed.
    //
    // Ids only in the log line — no name, no number beyond the identity id.
    console.warn("[renumber] rebind failed, retiring the old registration", {
      identityId: e.identityId,
      err: (err as Error)?.message,
    });
    try {
      leaveRoom(reg, oldPin);
      const dead = reg.clients.get(oldPin);
      reg.clients.delete(oldPin);
      if (dead?.cid) {
        reg.cidToPin.delete(dead.cid);
        deviceRemove(reg, oldPin, dead.cid);
      }
      reg.devices.delete(oldPin);
      reg.pendingRings.delete(oldPin);
      touchBusyState();
    } catch {
      /* nothing further to do — the client's own re-register is the backstop */
    }
    return "failed";
  }
}

export function leaveRoom(reg: RelayRegistry, pin: string) {
  touchBusyState(); // busy-line + party-line-count mirror (v2.91)
  const roomId = reg.pinRoom.get(pin) ?? reg.clients.get(pin)?.roomId ?? null;
  markRoomDirty(roomId); // Round 11
  reg.pinRoom.delete(pin);
  const c = reg.clients.get(pin);
  if (c) c.roomId = null;
  if (!roomId) return;
  // This member was active up to now — stamp the room so its end time is right.
  roomActivityTouch(reg, roomId);
  const room = reg.rooms.get(roomId);
  if (room) {
    room.delete(pin);
    // #109 — the join stamp describes CURRENT members, so it goes with them.
    // Keeping it would leave the map naming people who left, and a later reader
    // would print a join time for somebody who is not in the room.
    reg.roomMeta.get(roomId)?.joinedAt?.delete(pin);
    /* #129 — their mediasoup ids stop authorizing ops the instant they are out of the room.
       This drops the APP's record only; the node has `closeRoom` and no per-participant close,
       so the node-side transport lingers until the room itself goes. That is bounded by the
       room's life and is stated as a limitation in `mediasoupRoom.ts` rather than glossed. */
    forgetMember(voipSessions.get(roomId), pin);
    room.forEach(p => {
      const o = reg.clients.get(p);
      if (o) safeSend(o.socket, { type: "peer-left", pin });
    });
    promoteHostIfVacant(reg, roomId, pin);
    if (room.size === 0) {
      reapRoom(reg, roomId);
    } else {
      // The room still lists members, but they may ALL be disconnected "ghosts"
      // (grace-reaped mid-call, membership intentionally kept so they can
      // auto-rejoin). Without this, a room whose last *connected* peer explicitly
      // leaves would leak forever — maybeScheduleRoomReap only arms the
      // abandonment timer when no connected member remains, so a live call with
      // someone still present is never affected.
      maybeScheduleRoomReap(reg, roomId);
    }
  }
}

/* ── Round 11: the registry's durable shadow ─────────────────────────────── */

/**
 * Snapshot ONE room for persistence, or null when it no longer exists (which the
 * store turns into a fenced delete). Names come from the live client record when
 * there is one and otherwise from the history roster, so a hydrated room does not
 * come back as a wall of "Guest".
 */
export function snapshotRoom(reg: RelayRegistry, roomId: string): PersistedRoom | null {
  const room = reg.rooms.get(roomId);
  const meta = reg.roomMeta.get(roomId);
  if (!room || !meta) return null;
  const members = Array.from(room).map(pin => ({
    pin,
    name: reg.clients.get(pin)?.name || meta.roster.get(pin) || "Guest",
    // A member is HELD here when this room is their held one. `pinRoom` is the
    // active pointer; anything else that is still a member is parked.
    held: reg.heldRoom.get(pin) === roomId,
    // #109 — omitted when unknown, so a member with no stamp serializes exactly
    // as before and comes back with no stamp rather than a fabricated one.
    ...(meta.joinedAt?.has(pin) ? { joinedAt: meta.joinedAt.get(pin) } : {}),
  }));
  return {
    roomId,
    members,
    hostPin: meta.hostPin,
    cohosts: Array.from(meta.cohosts),
    // #113 — omitted when absent, so a pre-feature record and a personal call
    // serialize byte-identically to before.
    ...(meta.groupAdminPins?.size ? { groupAdminPins: Array.from(meta.groupAdminPins) } : {}),
    startedAt: meta.startedAt,
    answeredAt: meta.answeredAt,
    lastActiveAt: meta.lastActiveAt,
    dialedNumber: meta.dialedNumber,
    accepted: meta.accepted,
    // #116 — omitted when unknown, so a party line and a pre-feature room
    // serialize exactly as before.
    /* #129 — the node assignment goes with the room. Spread CONDITIONALLY so a mesh room's
       record is byte-identical to what every older instance writes and reads. */
    ...(meta.voip ? { voip: meta.voip } : {}),
    ...(typeof meta.video === "boolean" ? { video: meta.video } : {}),
    roster: Array.from(meta.roster.entries()),
  };
}

/**
 * Rebuild rooms in an EMPTY registry from their persisted shadows — what a
 * freshly-elected leader does before it serves any signaling.
 *
 * Deliberately restores ROOMS ONLY, never clients: a client record owns a live
 * socket, and there is no socket to own until the browser's home re-announces it
 * and the browser re-registers. What hydration must guarantee is that when that
 * register arrives, `sendRejoinIfInRoom` finds the membership it needs. Members
 * are therefore ghosts until their owners come back — exactly the state a
 * grace-reaped member is already in, which is a shape the rest of the registry
 * already handles everywhere (membersOf filters ghosts, sendRejoinIfInRoom
 * refuses a room of only ghosts, maybeScheduleRoomReap collects the abandoned).
 *
 * An EXISTING room is never overwritten: this instance's own live state is
 * always more current than a record it wrote at most a moment ago.
 */
export function applyHydratedRooms(reg: RelayRegistry, rooms: readonly PersistedRoom[]): number {
  let restored = 0;
  for (const rec of rooms) {
    if (reg.rooms.has(rec.roomId)) continue;
    const set = new Set<string>();
    const joined = new Map<string, number>();
    for (const m of rec.members) {
      set.add(m.pin);
      if (typeof m.joinedAt === "number") joined.set(m.pin, m.joinedAt);
      // Only ONE room may be a pin's active room and only one its held room. A
      // record that disagrees with one already applied loses rather than
      // clobbering it — the invariant matters more than any single record.
      if (m.held) {
        if (!reg.heldRoom.has(m.pin)) reg.heldRoom.set(m.pin, rec.roomId);
      } else if (!reg.pinRoom.has(m.pin)) {
        reg.pinRoom.set(m.pin, rec.roomId);
      }
    }
    if (set.size === 0) continue;
    reg.rooms.set(rec.roomId, set);
    reg.roomMeta.set(rec.roomId, {
      startedAt: rec.startedAt,
      answeredAt: rec.answeredAt,
      lastActiveAt: rec.lastActiveAt,
      dialedNumber: rec.dialedNumber,
      accepted: rec.accepted,
      roster: new Map(rec.roster),
      hostPin: rec.hostPin,
      cohosts: new Set(rec.cohosts),
      ...(rec.groupAdminPins?.length ? { groupAdminPins: new Set(rec.groupAdminPins) } : {}),
      // #109 — omitted when the record carried no stamps at all, so a pre-feature
      // record hydrates byte-identically to before.
      ...(joined.size ? { joinedAt: joined } : {}),
      /* Already validated by `isPersistedRoom` — a malformed assignment dropped the whole
         record before it reached here, which is what stops a garbage address authorizing ops
         against a node that does not exist. */
      ...(rec.voip ? { voip: rec.voip } : {}),
      ...(typeof rec.video === "boolean" ? { video: rec.video } : {}),
      hydratedAt: Date.now(),
    });
    // Every hydrated room starts with zero connected members, so arm the
    // abandonment reaper: a call whose participants never come back must not
    // outlive them on the new leader either.
    maybeScheduleRoomReap(reg, rec.roomId);
    restored++;
  }
  return restored;
}

/** Build the member list (excluding `selfPin`) for a room, with names/roles. */
function membersOf(reg: RelayRegistry, roomId: string, selfPin: string) {
  const rmeta = reg.roomMeta.get(roomId);
  return Array.from(reg.rooms.get(roomId) || [])
    .filter(p => p !== selfPin)
    // Exclude GHOSTS (membership without a live client record) — listing them
    // gave resumed/merged/rejoining participants permanently dead tiles.
    .filter(p => reg.clients.has(p))
    .map(p => ({
      pin: p,
      name: (reg.clients.get(p) || { name: "Guest" }).name || "Guest",
      device: reg.clients.get(p)?.device,
      flag: reg.clients.get(p)?.flag,
      role: roleOf(rmeta, p),
    }));
}

/**
 * Release a pin's HELD room (if any): drop the pin from that room's member Set,
 * tell the held peers it left, reap the room if now empty, and clear the hold
 * mapping. Does NOT touch the pin's ACTIVE room (`pinRoom`). Used on a full
 * hang-up / disconnect, and when a 3rd call would otherwise displace the hold.
 */
export function releaseHeldRoom(reg: RelayRegistry, pin: string) {
  touchBusyState(); // busy-line + party-line-count mirror (v2.91)
  const heldRid = reg.heldRoom.get(pin);
  markRoomDirty(heldRid); // Round 11
  reg.heldRoom.delete(pin);
  if (!heldRid) return;
  const room = reg.rooms.get(heldRid);
  if (!room) return;
  roomActivityTouch(reg, heldRid);
  room.delete(pin);
  room.forEach(p => {
    const o = reg.clients.get(p);
    if (o) safeSend(o.socket, { type: "peer-left", pin });
  });
  if (room.size === 0) reapRoom(reg, heldRid);
  else maybeScheduleRoomReap(reg, heldRid);
}

/**
 * Promote a pin's HELD room to ACTIVE (phone-style "resume the other line"):
 * repoint `pinRoom`, clear the hold, cancel any reap, tell the resumed room the
 * pin is back (peer-hold off), and hand the client a `resumed` envelope (member
 * list + fresh ICE / SFU token) so it can re-activate that call's media. Returns
 * false (and clears a dangling mapping) if there's nothing valid to promote.
 */
function promoteHeldRoom(
  reg: RelayRegistry,
  conn: { socket: RelaySocket; pin: string | null },
  self: RelayClient | undefined,
): boolean {
  const pin = conn.pin;
  if (!pin) return false;
  const heldRid = reg.heldRoom.get(pin);
  reg.heldRoom.delete(pin);
  if (!heldRid || !reg.rooms.has(heldRid)) return false;
  reg.pinRoom.set(pin, heldRid);
  markRoomDirty(heldRid); // Round 11: no longer held — this is the active call
  if (self) self.roomId = heldRid;
  const t = reg.roomReapT.get(heldRid);
  if (t) { clearTimeout(t); reg.roomReapT.delete(heldRid); }
  roomActivityTouch(reg, heldRid);
  broadcastToRoom(reg, heldRid, { type: "peer-hold", pin, on: false }, pin);
  const rmeta = reg.roomMeta.get(heldRid);
  safeSend(conn.socket, {
    type: "resumed",
    roomId: heldRid,
    members: membersOf(reg, heldRid, pin),
    cap: mintRoomCap(heldRid, pin, roleOf(rmeta, pin)),
    selfRole: roleOf(rmeta, pin),
    hostPin: rmeta?.hostPin ?? null,
    iceServers: iceServers(pin),
  });
  return true;
}

/* ── Party lines (v2.89) ─────────────────────────────────────────────────────
 * A party line is a DB-backed DIALABLE ROOM NUMBER: dialing it never rings
 * anyone — the caller drops straight into the line's persistent room. The
 * room id is DERIVED from the line's number (`pl-<number>`), so the in-memory
 * room can be reaped freely whenever it empties (ROOM_ABANDON_MS or last
 * leave): the next dial re-resolves the number from the DB (onResolveDial)
 * and re-creates the room. An empty line is therefore re-dialable forever.
 * ──────────────────────────────────────────────────────────────────────── */
export const PARTY_LINE_ROOM_PREFIX = "pl-";
export function partyLineRoomId(number: string): string {
  return PARTY_LINE_ROOM_PREFIX + number;
}

/**
 * Consulted on every invite BEFORE the identity/paging flow. Resolves whether
 * the dialed pin is a party line (returning its title for the join envelope)
 * or an ordinary identity number. Absent (protocol unit tests, bare deploys)
 * ⇒ every dial is an identity dial and the invite path stays fully
 * synchronous, byte-identical to pre-v2.89 behavior.
 */
export type ResolveDialHook = (
  pin: string
) => Promise<"identity" | { partyLine: true; title?: string }>;

/** How long the invite path waits for `onResolveDial` before dialing as an
 *  identity anyway. A wedged resolver (dead DB pool, hung query) must never
 *  strand a dial in limbo — after this the identity flow runs and a LATE real
 *  resolve is ignored (the flow runs exactly once, guarded by a settled flag
 *  + the dial-epoch check). Party-line dials to a wedged DB degrade to the
 *  honest "doesn't exist or is offline" instead of hanging forever. */
export const RESOLVE_DIAL_TIMEOUT_MS = 1500;
let resolveDialTimeoutMs = RESOLVE_DIAL_TIMEOUT_MS;
/** Test hook: shrink the resolver timeout (null restores the default). */
export function _setResolveDialTimeoutForTests(ms: number | null): void {
  resolveDialTimeoutMs = ms ?? RESOLVE_DIAL_TIMEOUT_MS;
}

/** Global monotonic source for `RelayClient.dialEpoch`/`ctxEpoch` stamps —
 *  see those fields' docs for why values must be globally unique, never
 *  per-client counters. */
let dialEpochSeq = 0;

/**
 * Drop `callerPin` into the party line's persistent room. Mirrors the accept
 * path's room-join machinery: cap check, membersOf roster (ghost-filtered),
 * joinRoomMember (persistent membership + reap-timer cancel), `joined` to the
 * newcomer, `peer-joined` to everyone already on the line. Nobody is rung.
 */
function joinPartyLine(
  reg: RelayRegistry,
  socket: RelaySocket,
  callerPin: string,
  number: string,
  title?: string,
  onMissedCall?: MissedCallHook
) {
  const me = reg.clients.get(callerPin);
  if (!me) return; // caller vanished while the dial resolved
  const rid = partyLineRoomId(number);
  if (me.roomId === rid) {
    // Redial of the line they're already on (in-call add pad). Deliberately a
    // NON-fatal code — "self"/"gone"/"offline" tear a solo call down client-side.
    safeSend(socket, { type: "error", code: "already", message: "You're already on this line." });
    return;
  }
  if (me.roomId && me.roomId !== rid) {
    const cur = reg.rooms.get(me.roomId);
    const others = cur
      ? Array.from(cur).filter(p => p !== callerPin && reg.clients.has(p)).length
      : 0;
    if (others > 0) {
      // In a live call with other people: an in-call "+" can ring a PERSON into
      // this call, but it can't fold a whole party line in. Non-fatal error.
      safeSend(socket, { type: "error", code: "busy", message: "Hang up your current call first to join the party line." });
      return;
    }
    // Alone in a solo dial room — release it and join the line. If that room
    // is a LIVE dial (outstanding rings — the caller abandoned a "Calling…"
    // to hop onto the line), the rings MUST be cancelled FIRST: leaveRoom
    // reaps the now-empty room, and a callee whose ring survived would keep
    // alerting only to have their accept bounce with error{gone}. Mirror the
    // `leave` handler exactly: ring-cancel fanout + pendingRings cleanup +
    // caller bookkeeping (cancelPendingRings) + a missed-call row per callee.
    const missed = cancelPendingRings(reg, callerPin);
    for (const calleePin of missed) {
      try {
        onMissedCall?.({ calleePin, callerPin, callerName: me.name, reason: "cancelled" });
      } catch { /* never let a notification hook break the line join */ }
    }
    leaveRoom(reg, callerPin);
  }
  const existing = reg.rooms.get(rid);
  const cap = ROOM_MAX;
  if (existing && existing.size >= cap) {
    safeSend(socket, { type: "error", code: "full", message: `Call is full (${cap} max).` });
    return;
  }
  // Room metadata — recreated fresh whenever the line was empty (reaped).
  // hostPin stays null: a party line has no host (its owner may never dial in).
  let meta = reg.roomMeta.get(rid);
  if (!meta) {
    meta = {
      startedAt: Date.now(),
      answeredAt: null,
      lastActiveAt: Date.now(),
      dialedNumber: number,
      accepted: false,
      roster: new Map(),
      hostPin: null,
      cohosts: new Set(),
    };
    reg.roomMeta.set(rid, meta);
  }
  // Standard `room` ack FIRST so the dialer's state machine has its roomId
  // (a group dial also flushes its remaining invites on this ack — those then
  // ring people INTO the line via the ordinary identity invite path).
  safeSend(socket, { type: "room", roomId: rid, partyLine: true, hostPin: null, cap: mintRoomCap(rid, callerPin, undefined) });
  const members = membersOf(reg, rid, callerPin);
  joinRoomMember(reg, rid, callerPin);
  me.roomId = rid;
  meta.roster.set(callerPin, me.name);
  meta.lastActiveAt = Date.now();
  // Conference history: a line becomes a REAL (loggable) call once two members
  // are concurrently connected; duration counts from that moment. A lone
  // dialer who leaves never logs (roster.size >= 2 gate in reapRoom).
  if (roomConnectedCount(reg, rid) >= 2) {
    meta.accepted = true;
    if (meta.answeredAt == null) meta.answeredAt = Date.now();
  }
  safeSend(socket, {
    type: "joined",
    roomId: rid,
    members,
    partyLine: true,
    lineTitle: title,
    hostPin: null,
    cap: mintRoomCap(rid, callerPin, undefined),
    iceServers: iceServers(callerPin),
  });
  members.forEach(m => {
    const o = reg.clients.get(m.pin);
    if (o) {
      safeSend(o.socket, {
        type: "peer-joined",
        pin: callerPin,
        name: me.name,
        device: me.device,
        flag: me.flag,
        iceServers: iceServers(m.pin),
      });
    }
  });
}

export interface RelayMessage {
  type?: string;
  name?: string;
  pin?: string;
  device?: string;
  flag?: string;
  to?: string;
  roomId?: string;
  data?: unknown;
  // Host moderation (`mod` message): action + optional target pin.
  action?: string;
  target?: string;
  /** invite: the caller dialed this as a VIDEO call (mutual-consent flow). */
  video?: boolean;
  /** rejoin-recreate (Round 11 B): the server-minted room capability. Proof of
   *  prior membership — the ONLY thing the client is trusted for on that path. */
  cap?: string;
  /**
   * SERVER-SET ONLY (F1). The 6-digit number the POST /api/relay/send handler
   * resolved for the authenticated caller (from their session/guest cookie),
   * or `null` when no identity could be resolved. NEVER trusted from client
   * input — the handler strips any client-supplied value before setting it.
   * `register` binds the claimed pin to this so a client can only take its OWN
   * number. Absent (field undefined) ⇒ a direct handleMessage call (unit tests):
   * the legacy client-requested-pin behavior is preserved.
   */
  __ownedNumber?: string | null;
  /** SERVER-ONLY, stamped alongside __ownedNumber (v2.99.49). Stripped from any
   *  client payload first, exactly like __ownedNumber. Lets per-caller budgets
   *  fall back to the address when the caller has no verified identity. */
  __clientIp?: string | null;
}

export type InviteHook = (info: {
  fromPin: string;
  fromName: string;
  toPin: string;
  roomId: string;
  /**
   * Whether the caller dialled with video (v2.105.18). OPTIONAL, so a caller
   * that omits it reads as a voice call — the recoverable direction, since a
   * voice ring for a video dial merely under-promises, while claiming video for
   * a voice dial would turn on a camera nobody offered.
   *
   * It matters because this hook now also drives the OS-level ring for an IDLE
   * callee, and CallKit/the full-screen intent render a video call differently.
   */
  video?: boolean;
}) => void;

/**
 * Fired once per callee who was rung but never connected — because the caller
 * cancelled/left before they answered, or they declined. A higher layer turns
 * this into a missed-call record + (for registered callees) an email.
 */
export type MissedCallHook = (info: {
  calleePin: string;
  callerPin: string;
  callerName: string;
  reason: "cancelled" | "rejected";
}) => void;

/**
 * Fired when an invite targets a number with NO live relay connection (never
 * registered, or its SSE died — a backgrounded/locked phone). The hook answers
 * from the DB whether the number belongs to a real identity (and its display
 * name) and, when it does, pushes a "call is coming in" notification to that
 * identity's subscribed devices. The relay then PAGES: it keeps the dial alive
 * so the callee can open the app and receive the ring late
 * (deliverPendingRing), instead of instantly bouncing the caller with
 * "offline". Resolving { exists: false } (or rejecting) falls back to the
 * classic offline error.
 *
 * `pushed` IS WHAT DECIDES WHETHER TO PAGE, and it is the whole of how this
 * satisfies two owner directives that read as opposites (v2.105.12). v2.99.11
 * removed paging outright — "if the user is offline it should NOT ring
 * automatically" — and the owner has since asked for ringing back. Both hold if
 * the relay pages ONLY when a device was actually woken: a phone with the app
 * installed rings, and somebody no push can reach still fails fast with the
 * leave-a-message card instead of a 65-second "Reaching their phone…" that was
 * never going to resolve. A hook that omits the field reads as 0, so an
 * older/bare wiring keeps exactly the v2.99.11 behaviour.
 */
export type PageCalleeHook = (info: {
  calleePin: string;
  callerPin: string;
  callerName: string;
  roomId: string;
  video: boolean;
}) => Promise<{ exists: boolean; name?: string; pushed?: number } | null>;

/**
 * Fired when a ring that was delivered by PUSH is cancelled — the caller hung up
 * before the callee answered.
 *
 * ── WHY THIS EXISTS AT ALL ───────────────────────────────────────────────────
 * The websocket `ring-cancel` beside it can only reach a callee with a live
 * socket, and a pushed callee has none by definition — that is the whole reason
 * they were pushed. Without this the handset goes on ringing for the full 45s
 * APNs/FCM expiry after the caller has given up, and on iOS that is a CallKit
 * screen the person answers into a call that ended.
 *
 * Fire-and-forget: the caller's hang-up has already happened and must not wait on
 * a DB read or two HTTP round trips, and a failure here costs a stale ring rather
 * than a broken hang-up.
 */
export type CancelPushHook = (info: { calleePin: string; roomId: string }) => void;

/**
 * Protocol logic. Kept as a pure function over (registry, socket-state,
 * message) so it's straightforward to unit-test without spinning up an
 * HTTP server. The optional `onInvite` callback is fired exactly once
 * per successful `invite` dispatch so a higher layer can fan out a
 * notification (e.g. via the v2 SSE bus) to the callee even when they
 * are not currently connected to the relay channel.
 */
export function handleMessage(
  reg: RelayRegistry,
  conn: { socket: RelaySocket; pin: string | null; setPin: (p: string) => void; cid?: string },
  msg: RelayMessage,
  onInvite?: InviteHook,
  onMissedCall?: MissedCallHook,
  onPageCallee?: PageCalleeHook,
  onResolveDial?: ResolveDialHook
) {
  const type = msg && msg.type;

  // [TEMP DIAG] live signaling trace — remove after debugging the call flow.
  if ((process.env.RELAY_DIAG === "1" || process.env.NODE_ENV === "development") && type !== "ping") {
    const m = msg as Record<string, unknown>;
    const extra =
      type === "invite" || type === "reject"
        ? " to=" + String(m.to ?? "")
        : type === "accept"
        ? " room=" + String(m.roomId ?? "")
        : type === "signal"
        ? " to=" + String(m.to ?? "") + " data=" + (m.data && (m.data as Record<string, unknown>).sdp ? "sdp:" + String(((m.data as Record<string, unknown>).sdp as Record<string, unknown>).type) : (m.data && (m.data as Record<string, unknown>).candidate ? "candidate" : "?"))
        : type === "leave"
        ? " reason=" + String(m.reason ?? "(none)")
        : "";
    console.log(`[relay-diag] <- ${type} from=${conn.pin ?? "(unreg)"}${extra}`);
  }

  // register: assign (or reuse requested) 6-digit number.
  if (type === "register") {
    if (conn.pin) {
      // Already bound on this channel (e.g. a duplicate register after a
      // reconnect that was re-bound below). Just re-affirm the number.
      const existing = reg.clients.get(conn.pin);
      if (existing) {
        if (msg.name) existing.name = String(msg.name).slice(0, 24);
        if (msg.device) existing.device = String(msg.device).slice(0, 16);
        // A re-affirm that carries a NEW flag (geo resolved after we registered)
        // must reach peers already in the room — push a live `peer-meta` update,
        // since the join-time flag was empty for them.
        const newFlag = msg.flag ? String(msg.flag).slice(0, 8) : undefined;
        if (newFlag && newFlag !== existing.flag) {
          existing.flag = newFlag;
          if (existing.roomId) {
            broadcastToRoom(reg, existing.roomId, { type: "peer-meta", pin: conn.pin, flag: newFlag }, conn.pin);
          }
        }
        safeSend(conn.socket, { type: "registered", pin: conn.pin, name: existing.name, iceServers: iceServers(conn.pin), });
        // A within-grace re-attach (same cid) also auto-rejoins its active call.
        // Multi-device (v2.99.5): a SECONDARY device's re-affirm (geo flag,
        // SSE blip) must NOT receive a rejoin while the number's call lives on
        // the PRIMARY device — that dragged the idle device into the call.
        // Same-cid (the primary itself, and every flag-off caller) is unchanged.
        const isPrimaryChannel =
          !multiDeviceEnabled() || existing.cid === conn.cid || existing.cid === null;
        if (isPrimaryChannel) sendRejoinIfInRoom(reg, conn.socket, conn.pin);
        // …and receives any ring that's still live (page reload / paged device
        // opening from a push) — the ring would otherwise be lost forever.
        // Delivered to THIS channel's socket so a multi-device secondary that
        // reloaded mid-ring actually rings (the default was the primary socket).
        deliverPendingRing(reg, conn.pin, conn.socket);
      }
      return;
    }
    const name = String(msg.name || "Guest").slice(0, 24);
    const cid = conn.cid || "";
    let pin: string;

    // Prefer the pin this channel (cid) already owns, so a reconnect keeps the
    // same number even if a stale client entry is still being cleaned up.
    const ownedPin = cid ? reg.cidToPin.get(cid) : undefined;
    let requested = typeof msg.pin === "string" && /^\d{6}$/.test(msg.pin) ? msg.pin : undefined;

    // SECURITY (F1): bind the claimed number to the AUTHENTICATED caller. The
    // POST /api/relay/send handler resolves the caller's own identity number
    // (from their session/guest cookie) and stamps it on `__ownedNumber` — a
    // client can never set this. Without this bind, a client could `register`
    // with ANY free 6-digit number (the transport is keyed only by a
    // client-minted `cid`), letting an attacker seize a victim's number while
    // the victim's app is closed and intercept their inbound calls / spoof
    // their caller-ID.
    //   • a resolved number  → IGNORE whatever pin the client asked for and use
    //     the caller's real number (also self-heals a stale client after
    //     regenerateNumber).
    //   • resolved to null (no identity: no cookie, or a resolution error) → do
    //     NOT honor an explicit claim; fall through to the caller's existing
    //     cid-owned pin or a freshly allocated one.
    //   • field ABSENT (undefined) → a direct handleMessage call (unit tests):
    //     keep the legacy client-requested-pin behavior.
    // v2.99.49: remember whether the caller's number was PROVEN, not just claimed.
    // Only a cookie-resolved pin is unmintable, and every per-caller budget keyed
    // on the pin depends on that (see offlineDialKey). Field absent = a direct
    // handleMessage call (unit tests), which keeps legacy behaviour and is treated
    // as verified — there is no untrusted transport in that path.
    const overHttp = "__ownedNumber" in msg;
    if (overHttp) {
      const owned = msg.__ownedNumber;
      requested = typeof owned === "string" && /^\d{6}$/.test(owned) ? owned : undefined;
    }
    const registerIp = typeof msg.__clientIp === "string" ? msg.__clientIp : null;
    /** Proven, not merely claimed: a cookie-resolved pin we are about to honour. */
    const verifiedClaim = (pinFinal: string) =>
      !overHttp || (requested !== undefined && pinFinal === requested);

    const multiDevice = multiDeviceEnabled();
    // SECURITY: an explicit, valid pin request that DIFFERS from the pin this
    // browser (cid) previously owned means a DIFFERENT identity is registering
    // here — typically a new user after a logout on a shared browser. We must
    // NOT silently hand them the previous user's number: that would drop them
    // straight into that user's still-live call (cross-user hijack) and, on the
    // SFU path, mint them a publish/subscribe token under the wrong identity.
    // Sever the stale cid→pin binding and, when this browser was that identity's
    // only connection, tear its room membership down too.
    const identitySwitch = !!ownedPin && !!requested && requested !== ownedPin;
    if (identitySwitch && ownedPin) {
      const stale = reg.clients.get(ownedPin);
      if (!stale || stale.cid === cid || stale.cid === null) {
        if (stale?.graceT) { clearTimeout(stale.graceT); stale.graceT = null; }
        // Multi-device (v2.99.5): this browser is switching identity away
        // (logout → new guest, or a different login), but the number may still
        // be LIVE on the user's other devices — promote a survivor to primary
        // instead of tearing the number down (mirrors the disconnect-grace
        // survivor promotion), otherwise the other device silently became
        // unreachable until its next re-register.
        const devs = multiDevice ? reg.devices.get(ownedPin) : undefined;
        const survivor = devs
          ? Array.from(devs.entries()).find(([dcid]) => dcid !== cid)
          : undefined;
        if (stale && survivor) {
          stale.socket = survivor[1];
          stale.cid = survivor[0];
        } else {
          leaveRoom(reg, ownedPin); // clears pinRoom membership + notifies peers
          reg.clients.delete(ownedPin);
        }
      }
      if (cid && reg.cidToPin.get(cid) === ownedPin) reg.cidToPin.delete(cid);
      deviceRemove(reg, ownedPin, cid);
    }
    const effectiveOwned = identitySwitch ? undefined : ownedPin;
    if (effectiveOwned) {
      pin = effectiveOwned;
    } else if (
      requested &&
      (multiDevice || !reg.clients.has(requested) || reg.clients.get(requested)!.cid === cid)
    ) {
      // Honour an explicit pin request if it's free or already owned by this cid.
      // With multi-device ring ON, also honour it when ANOTHER device already
      // holds the number — that's the whole point (same number, many devices).
      pin = requested;
    } else {
      pin = genPin(reg);
    }

    conn.setPin(pin);
    if (cid) reg.cidToPin.set(cid, pin);
    // Track this device socket for the number (read only when the flag is on).
    deviceAdd(reg, pin, cid, conn.socket);

    // Reuse/refresh an existing client record (preserves room membership across
    // a reconnect); otherwise create a fresh one.
    const prev = reg.clients.get(pin);
    // True when another device stayed primary for a live call (multi-device):
    // the newly-registered SECONDARY must not receive that call's rejoin.
    let keptPrimaryElsewhere = false;
    if (prev) {
      if (prev.graceT) { clearTimeout(prev.graceT); prev.graceT = null; }
      // Multi-device: if the existing PRIMARY is in a live call, a different
      // device registering the same number must NOT hijack the in-call routing
      // (the primary socket is where offer/answer/ice for that call flow). Keep
      // it; the newcomer is still tracked in `devices` for ringing. When the
      // flag is off (or it's the same cid, or the primary is idle) behaviour is
      // identical to before: the latest registration becomes primary.
      const keepPrimary = multiDevice && !!prev.roomId && prev.cid !== cid && prev.cid !== null;
      keptPrimaryElsewhere = keepPrimary;
      if (!keepPrimary) {
        prev.socket = conn.socket;
        prev.cid = cid || prev.cid;
        // This channel just TOOK OVER the primary record: any dial still
        // awaiting its resolver was captured against the old socket/context —
        // bump BOTH epochs so that continuation aborts instead of ghost-
        // ringing. (The same-channel re-affirm path above deliberately does
        // NOT bump: a benign geo/SSE re-affirm mid-dial must not kill the
        // dial. A multi-device secondary that leaves the primary in place
        // doesn't invalidate the primary's in-flight dial either. A record
        // created FRESH gets a new ctxEpoch at creation below, so a stale
        // continuation from a deleted record's era can never match it.)
        prev.dialEpoch = ++dialEpochSeq;
        prev.ctxEpoch = prev.dialEpoch;
      }
      prev.name = name;
      // Verified-ness follows the pin actually in use: a verified re-register
      // keeps it, and an UNVERIFIED registration can never upgrade a record
      // (`verifiedClaim`), so an anonymous client landing on
      // someone's number cannot inherit their budget.
      prev.verifiedPin = verifiedClaim(pin);
      prev.ip = registerIp ?? prev.ip ?? null;
      if (msg.device) prev.device = String(msg.device).slice(0, 16);
      if (msg.flag) prev.flag = String(msg.flag).slice(0, 8);
    } else {
      // ctxEpoch is seeded at creation so a continuation captured under a
      // DELETED record (whose ctxEpoch was undefined-or-older) can never
      // match this new record's generation and ghost-ring under it.
      reg.clients.set(pin, { socket: conn.socket, name, device: msg.device ? String(msg.device).slice(0, 16) : undefined, flag: msg.flag ? String(msg.flag).slice(0, 8) : undefined, roomId: null, cid: cid || null, graceT: null, ringing: new Set(), ctxEpoch: ++dialEpochSeq, verifiedPin: verifiedClaim(pin), ip: registerIp });
    }
    safeSend(conn.socket, { type: "registered", pin, name, iceServers: iceServers(pin), });
    // AUTO-REJOIN an active call this number is still a member of (no re-invite).
    // Multi-device (v2.99.5): NOT when the call lives on another device that
    // kept the primary slot — sending the rejoin here dragged every freshly
    // opened secondary device straight into the primary's live call.
    // A rejoin hands over the room id, the member list and ICE servers — so it
    // must only ever go to a client that
    // PROVED it owns this number, or to the very browser connection that was
    // already registered under it. A fresh anonymous cid has neither, so a
    // `genPin` collision with a number that is still a room member can no longer
    // drop a stranger into a live call. `provenPin` (not `verifiedClaim` alone)
    // keeps the ordinary reload working when `createContext` hiccups: the cid is
    // unchanged, so the browser is still recognisably the one that was in the call.
    const provenPin = verifiedClaim(pin) || (!!effectiveOwned && pin === effectiveOwned);
    if (!keptPrimaryElsewhere && provenPin) sendRejoinIfInRoom(reg, conn.socket, pin);
    // Deliver any ring that's still live for this number: a reload mid-ring, or
    // a PAGED offline device the user just opened from the push notification.
    // Sent to THIS device's socket (a multi-device secondary must ring here,
    // not on the primary that is already ringing).
    // Same gate: a ring already in flight for this number must not be handed to a
    // client that cannot prove the number is theirs.
    if (provenPin) deliverPendingRing(reg, pin, conn.socket);
    // Busy-line mirror (v2.91): a (re)registered client can change both party-
    // line CONNECTED counts and busy verdicts (rejoin restores roomId) without
    // crossing any join/leave funnel — sync the settled state.
    touchBusyState();
    return;
  }

  if (!conn.pin) return;
  const self = reg.clients.get(conn.pin);
  if (!self) return;

  switch (type) {
    case "invite": {
      const to = String(msg.to || "");
      if (to === conn.pin) {
        safeSend(conn.socket, {
          type: "error",
          code: "self",
          message: "That's your own number.",
        });
        break;
      }
      // Multi-device: make THIS device the number's primary before anything routes by pin
      // (the token, the mesh signal relay, peer-joined). No-op when the existing primary
      // is mid-call, or when the flag is off. See claimPrimaryForCall.
      claimPrimaryForCall(reg, conn);
      const callerPin = conn.pin;
      const callerSocket = conn.socket;
      const wantVideo = !!msg.video;
      /* SERVICE BUSY FOR A GROUP, BEFORE ANYTHING IS SPENT (v2.106.59).
       *
       * The owner's node-scaling doc: "Mesh fallback is for 1:1 calls. If group rooms exist
       * and the pool is saturated, reject with a clear 'service busy' error and fire the
       * saturation alarm loudly — a large group over mesh is worse than an honest error."
       * It is right, and for a measured reason: on the mesh each phone runs N−1 encoders and
       * N−1 decoders (v2.99.84), so a large group there is a hot phone rather than a
       * lower-quality call.
       *
       * FIRST, so a refused call resolves no identity, mints no room, rings nobody and
       * records no miss — the refusal is the whole outcome.
       *
       * `msg.parties` is present ONLY on the invite that CREATES a group dial's room, which
       * is exactly the moment a transport is chosen. An add-person invite flushed into an
       * EXISTING call carries none, reads as 1:1 and is therefore never refused — correct,
       * because that room already has its transport and refusing would break the expansion
       * of a live call rather than prevent a bad one.
       *
       * IT CANNOT FIRE TODAY: `planDialTransport` reads the cached node snapshot, which is
       * empty without `REDIS_URL` and a registered agent, so `reason` is `no-nodes` and
       * `refused` is null. The rule goes live with the fleet, not with this deploy. */
      const dialPlan = planDialTransport({ partySize: wireCount((msg as { parties?: unknown }).parties) });
      if (dialPlan.refused === "pool-saturated") {
        safeSend(conn.socket, {
          type: "error",
          code: "saturated",
          message: "Group calling is busy right now — try again in a moment, or call one person.",
        });
        break;
      }
      // Stamp the dial context NOW, synchronously, before any await. The
      // deferred resolver continuation below re-checks these stamps — same
      // state-before-await / re-check-after discipline as onPageCallee.
      // dialEpoch moves on EVERY invite (newest-dial-wins, for line joins);
      // ctxEpoch moves only on hang-up / channel takeover (for identity
      // rings, so a group-dial burst's sibling invites all still ring).
      self.dialEpoch = ++dialEpochSeq;
      const dialEpoch = self.dialEpoch;
      const ctxEpoch = self.ctxEpoch;
      /**
       * The whole identity-dial flow (ring / page / cap / call-waiting),
       * extracted into a closure so the party-line resolver (v2.89) can run
       * FIRST — an async DB check — and fall through to it. State is
       * RE-FETCHED from the registry at run time: on the deferred path the
       * caller may have hung up (or been reaped) while the resolver awaited.
       * With no resolver hook this runs synchronously, byte-identical to the
       * pre-v2.89 invite path.
       */
      const runIdentityInvite = () => {
        const me = reg.clients.get(callerPin);
        if (!me) return; // caller vanished while the dial resolved
        // Create the caller's dial room on first use — shared by the live-ring
        // path and the paging path (a paged callee's late accept needs a room).
        const ensureDialRoom = (): string => {
          if (!me.roomId) {
            const rid = newRoomId();
            joinRoomMember(reg, rid, callerPin);
            me.roomId = rid;
            // Seed conference-history metadata: the caller is the first roster
            // member and `to` is the dialed number. `accepted` flips on the first
            // accept (below), so an unanswered dial is never logged as a conference.
            reg.roomMeta.set(rid, {
              startedAt: Date.now(),
              answeredAt: null,
              lastActiveAt: Date.now(),
              dialedNumber: to,
              accepted: false,
              roster: new Map([[callerPin, me.name]]),
              hostPin: callerPin, // the creator is the host
              cohosts: new Set(),
              /* #113: the group's admins, from a seed the FLEET signed for THIS
                 caller's pin. The subject comes from the connection, never the
                 message, so a leaked seed is useless to another number; a bad,
                 expired or unsigned seed yields undefined and the call proceeds
                 exactly as it did before this feature existed. */
              groupAdminPins: seededGroupAdmins(callerPin, (msg as { seed?: unknown }).seed),
              // #116 — the DIAL channel, from the same flag the ring card and the
              // VoIP push already read. Recorded here because the room is the only
              // thing that survives to the end of the call.
              video: wantVideo,
              /* #129 — the node this call was PLACED on, from the plan computed above.
                 Recorded rather than recomputed: `planDialTransport` reads a snapshot that
                 the refresh timer replaces every few seconds, so asking again later can
                 legitimately answer a DIFFERENT node — and a call whose ops went to two
                 nodes is not degraded, it is broken, because the routers live on one host.
                 Undefined on the mesh, which is what every reader treats as "no node". */
              ...(dialPlan.voip ? { voip: dialPlan.voip } : {}),
            });
            safeSend(callerSocket, { type: "room", roomId: rid, selfRole: "host", hostPin: callerPin, cap: mintRoomCap(rid, callerPin, "host") });
          }
          // Whether the room is new or growing, make sure the caller is in the roster.
          rosterTouch(reg, me.roomId!, callerPin, me.name);
          return me.roomId!;
        };
        const target = reg.clients.get(to);
        // A registry record whose SSE stream is already CLOSED (a backgrounded /
        // locked phone inside the 30s disconnect grace) can't be rung — writes to
        // it silently vanish, which used to leave the caller on a fake
        // "Ringing…" until the 65s backstop. With the paging hook wired, treat a
        // dead socket exactly like an unregistered number so the callee gets
        // PAGED (push + late ring on reconnect) instead.
        const targetReachable =
          !!target &&
          // An UNVERIFIED registration is not this number (v2.99.57): `genPin` can
          // hand an anonymous client a number whose owner merely has no live
          // stream, and ringing it would deliver the victim's calls to the
          // squatter. Treat it exactly like an unregistered number so the callee
          // is paged and the caller gets an honest `offline`.
          pinIsAddressable(target) &&
          (!onPageCallee || !target.socket.alive || target.socket.alive());
        if (!targetReachable) {
          if (!onPageCallee) {
            // Legacy path (no paging hook — protocol unit tests, bare deploys):
            // instant offline error + missed-call record, exactly as before.
            if (process.env.RELAY_DIAG === "1" || process.env.NODE_ENV === "development") {
              console.log(`[relay-diag]    invite -> ${to} REJECTED: target not registered (known pins: ${Array.from(reg.clients.keys()).join(",")})`);
            }
            safeSend(callerSocket, {
              type: "error",
              code: "offline",
              // `pin` names WHICH invitee this is about (v2.99.44). A group dial
              // rings several people, so without it the caller can't tell which
              // one went unreachable and can't know when the last one has
              // resolved. Additive: older clients ignore the field.
              pin: to,
              message: "That number doesn't exist or is offline.",
            });
            // The callee was offline — record the miss and (for registered users)
            // email them. The hook resolves identity from the DB by number, so it
            // works even though an offline callee has no in-memory registry entry.
            try {
              onMissedCall?.({ calleePin: to, callerPin, callerName: me.name, reason: "cancelled" });
            } catch { /* never let a notification hook break call setup */ }
            return;
          }
          // OFFLINE (v2.99.11, owner: "if the user is offline it should NOT ring
          // automatically — tell the caller he's offline; you can leave an SMS or
          // voice message"). The number may belong to a real identity whose device
          // just isn't connected. We RESOLVE the identity (name + existence) via
          // the hook but DO NOT keep the dial alive, do NOT page-wake their phone
          // with a full incoming-call ring, and do NOT sit on "Reaching their
          // phone…" for 65s. Instead: a fast honest "offline" error → the caller's
          // client shows the leave-a-message card. The MISS is recorded here so it
          // still surfaces on their History + fires the missed-call notification /
          // email when they next open the app (that's how they "see it on return").
          if (process.env.RELAY_DIAG === "1" || process.env.NODE_ENV === "development") {
            console.log(`[relay-diag]    invite -> ${to} OFFLINE: target ${target ? "in-grace (dead socket)" : "not registered"}`);
          }
          // SECURITY (M40): throttle THIS branch — dials to a number with no live
          // connection — per calling pin. It is the app's last unthrottled
          // number→identity oracle and a third-party spam amplifier:
          //   • the two replies differ by design ("<Name> is offline right now."
          //     for a real identity vs "That number doesn't exist.") so it leaks
          //     existence AND the display name over the whole 10^6 space. The
          //     tRPC resolvers were gated for exactly this (F5's directoryGate,
          //     120 burst / ~60 per minute); this path never was, and the
          //     signaling limiter is a FLOOD guard (~200/s) that a scraper simply
          //     stays under — full enumeration in well under two hours.
          //   • each pass also calls onMissedCall, writing a History row and
          //     firing a missed-call push AND email at the victim. Unlike the
          //     offline-MESSAGE email there is no cooldown on it, so this is a
          //     mailbox flood against a third party (and a sender-reputation risk
          //     for the operator's domain) driven by a stranger.
          // Scoped deliberately to the OFFLINE branch: a dial to an ONLINE user
          // never reaches here, so normal calling and group dials (which fan many
          // invites at once) are untouched — which is why this avoids the
          // previously-rejected idea of capping invites in general. Generous
          // enough that a person dialling several offline contacts never notices.
          if (process.env.RELAY_RATELIMIT_OFF !== "1" && !offlineDialLimiter.allow(offlineDialKey(reg, callerPin), Date.now())) {
            // `unavailable`, NOT `offline` (v2.99.47): the throttle fires BEFORE
            // the number is resolved, so we do not actually know the callee
            // exists. Claiming "offline" made the client raise the leave-a-message
            // card for a MISTYPED number — the user recorded up to 60s of voice
            // and the send then failed against a non-existent identity, losing the
            // recording. The client treats this as unreachable (ends the dial
            // honestly) but never voicemail-eligible. The message stays generic,
            // so it still leaks nothing about whether the number is real.
            safeSend(callerSocket, {
              type: "error",
              code: "unavailable",
              pin: to,
              message: "Can't place that call right now — try again in a moment.",
            });
            return;
          }
          // THE ROOM IS CREATED BEFORE THE AWAIT, and that ordering is load-bearing
          // rather than incidental: the push payload carries the room the callee must
          // join to answer, so minting it afterwards would send a ring with nothing to
          // connect to — a phone that rings and then cannot answer.
          //
          // Checked against BOTH client paths before doing it, because the offline
          // branch has never produced a `room` ack before:
          //   • 1:1 — `inParkedCall()` is `callIsGroup || roomId.startsWith("pl-")`, both
          //     false here, so a subsequent error{offline} still reaches the fatal branch
          //     and still raises the leave-a-message card. Unchanged.
          //   • GROUP — an existing room means the remaining invitees are flushed off the
          //     `room` ack, which is the ORDINARY path; v2.99.19's one-at-a-time
          //     promotion dance exists precisely because an offline first invitee used to
          //     create no room, and it still covers `nonexistent`/`unavailable`, which
          //     return before this point. The per-invitee drain at the client keys on
          //     `pin`, which every reply below carries.
          const pagingRoom = ensureDialRoom();
          onPageCallee({ calleePin: to, callerPin, callerName: me.name, roomId: pagingRoom, video: wantVideo })
            .then(info => {
              // Stale-continuation guard — the SAME discipline the party-line
              // resolver applies at `settle` (line ~1526). onPageCallee awaits
              // the DB; while it's out the caller may have hung up or had their
              // channel taken over (both bump ctxEpoch). An identity dial keys on
              // ctxEpoch (a sibling group-dial invite moves only dialEpoch, so
              // those coexist). A moved epoch ⇒ this offline result belongs to a
              // dial that no longer exists — drop it, so we never fire a stray
              // error / phantom miss into the caller's NEW context. It is also what
              // stops a hang-up racing the continuation into registering a pending
              // ring for a dial that no longer exists.
              const callerNow = reg.clients.get(callerPin);
              if (!callerNow || callerNow.ctxEpoch !== ctxEpoch) return;
              if (info && info.exists) {
                if ((info.pushed ?? 0) > 0) {
                  // PAGING (restored v2.105.12). A device was actually woken, so hold
                  // the dial open: the ring is redeliverable for PENDING_RING_TTL_MS,
                  // and the moment the callee's app registers, `deliverPendingRing`
                  // hands it over and upgrades this ack to a real "Ringing…".
                  callerNow.ringing.add(to);
                  reg.pendingRings.set(to, {
                    from: callerPin,
                    roomId: pagingRoom,
                    video: wantVideo,
                    at: Date.now(),
                    // Rung by PUSH, so a hang-up owes this callee a pushed cancel.
                    // The LIVE-ring path below deliberately leaves this unset: that
                    // callee has a socket, gets the websocket `ring-cancel`, and must
                    // not have their phone woken a second time to be told nothing.
                    pushed: true,
                  });
                  safeSend(callerSocket, {
                    type: "ringing",
                    pin: to,
                    // The name is withheld from an UNVERIFIED caller for exactly the
                    // reason the offline reply withholds it (v2.99.49): a named ack
                    // across the whole number space is name-harvesting, and a paging
                    // ack is reachable by the same probe.
                    name: callerNow.verifiedPin ? info.name : undefined,
                    // The caller's client renders "Reaching their phone…" rather than
                    // "Ringing…", because nothing is audibly ringing yet.
                    paging: true,
                  });
                  return;
                }
                // Nothing could be woken — no subscription, push switched off, or every
                // token stale. Fail FAST and honestly rather than paging into silence.
                safeSend(callerSocket, {
                  type: "error",
                  code: "offline",
                  pin: to,
                  // v2.99.49: the NAME is only for a caller who proved who they
                  // are. An unverified caller (no cookie ⇒ a genPin'd throwaway
                  // pin) is exactly the enumeration case, and a named reply
                  // turned existence-probing into name-harvesting across the
                  // whole number space. A real user dialling a contact still
                  // gets the honest "<Name> is offline right now."
                  message: callerNow.verifiedPin
                    ? (info.name || "They") + " is offline right now."
                    : "They're offline right now.",
                });
                // Record the miss → History + (pref-gated) missed-call email on return.
                try {
                  onMissedCall?.({ calleePin: to, callerPin, callerName: me.name, reason: "cancelled" });
                } catch { /* never let a notification hook break call setup */ }
              } else {
                // `pin` names the invitee (v2.99.47): a GROUP dial tracks one
                // outstanding entry per invitee and drains it by pin, so a reply
                // without one left the counter stuck and the caller sat on
                // "Ringing…" until the 65s no-answer backstop — the very hang
                // v2.99.44 set out to close. Its three sibling replies already
                // carried it; these last two did not.
                safeSend(callerSocket, { type: "error", code: "nonexistent", pin: to, message: "That number doesn't exist." });
              }
            })
            .catch(() => {
              const callerNow = reg.clients.get(callerPin);
              if (!callerNow || callerNow.ctxEpoch !== ctxEpoch) return;
              safeSend(callerSocket, { type: "error", code: "offline", pin: to, message: "They're offline right now." });
            });
          return;
        }
        if (!target) return; // unreachable (targetReachable ⇒ target) — narrows TS
        // CALL WAITING: we no longer reject the caller as "busy" when the target is
        // already in another call. Instead the invite rings through and the callee's
        // client shows a call-waiting popup (Answer = put the current call on hold
        // and switch; Reject = decline). The callee decides — not the server. A
        // second concurrent waiter is rejected client-side. The only ring we still
        // suppress is one into a room the caller is ALREADY in (a redundant invite),
        // which the callee's client also ignores by roomId.
        if (
          target.roomId &&
          me.roomId &&
          target.roomId === me.roomId
        ) {
          // Target is already in THIS room — nothing to do.
          return;
        }
        ensureDialRoom();
        const room = reg.rooms.get(me.roomId!);
        // 10-way only on the SFU; the mesh fallback stays capped at 6 (a 10-way
        // mesh is ~45 peer connections — far too heavy for the fallback path).
        const inviteCap = ROOM_MAX;
        if (room && room.size >= inviteCap) {
          safeSend(callerSocket, {
            type: "error",
            code: "full",
            message: `Call is full (${inviteCap} max).`,
          });
          return;
        }
        if (process.env.RELAY_DIAG === "1" || process.env.NODE_ENV === "development") {
          console.log(`[relay-diag]    invite -> ${to} OK: sending ring (room=${me.roomId})`);
        }
        const ringMsg = {
          type: "ring",
          from: callerPin,
          fromName: me.name,
          flag: me.flag,
          roomId: me.roomId,
          // Mutual-consent video: the callee's ring card shows the dialed mode,
          // and only a VIDEO dial offers the "answer with video" (= consent).
          video: wantVideo,
        };
        // Multi-device ring: if the callee is idle (not already in a call), ring
        // EVERY one of their devices — first to accept wins (the accept handler
        // cancels the rest). When the flag is off, or they're mid-call, we ring
        // only the single primary socket exactly as before.
        const devs = reg.devices.get(to);
        if (multiDeviceEnabled() && !target.roomId && devs && devs.size > 0) {
          devs.forEach(sock => safeSend(sock, ringMsg));
        } else {
          safeSend(target.socket, ringMsg);
        }
        // Ack the CALLER that the ring was actually DELIVERED — the callee's
        // device is now alerting. This drives the caller's staged progress
        // ("Calling…" = request sent → "Ringing…" = destination being alerted).
        // Includes the callee's registered display name so the caller's dial
        // card can label a raw-number dial.
        safeSend(callerSocket, { type: "ringing", pin: to, name: target.name });
        // Remember we're ringing this callee so we can cancel it if we bail.
        me.ringing.add(to);
        // Keep the ring redeliverable: if the callee's page reloads (or their SSE
        // blips) mid-ring, their re-register gets the ring again instead of a
        // silent void (deliverPendingRing). Cleared on accept/reject/cancel/TTL.
        reg.pendingRings.set(to, { from: callerPin, roomId: me.roomId!, video: wantVideo, at: Date.now() });
        // Fan out a notification hint so the callee's other open tabs
        // (e.g. Messages, Contacts) also see the incoming call.
        if (onInvite && me.roomId) {
          try {
            onInvite({
              fromPin: callerPin,
              fromName: me.name,
              toPin: to,
              roomId: me.roomId,
              // v2.105.18: the hook now also raises the OS-level ring for an
              // IDLE callee, and a CallKit / full-screen-intent screen renders a
              // video call differently from a voice one.
              video: wantVideo,
            });
          } catch {
            /* never let a notification hook break call setup */
          }
        }
      };
      if (onResolveDial) {
        // PARTY LINES (v2.89): consult the DB-backed resolver BEFORE the
        // identity/paging flow. A dial to a party-line number NEVER rings
        // anyone — the caller joins the line's persistent room directly.
        // `settle` runs the flow EXACTLY once (settled flag), only if the
        // caller's dial context hasn't moved while we awaited (dial epoch),
        // and is raced against a timeout so a wedged resolver (dead DB pool)
        // can never strand the dial in limbo — the identity flow is the
        // fallback, and the late real resolve is then ignored.
        let settled = false;
        const settle = (res: Awaited<ReturnType<ResolveDialHook>>) => {
          if (settled) return;
          settled = true;
          clearTimeout(fallbackT);
          // Stale-continuation guards. The caller's context may have changed
          // while the resolver was out — proceeding blindly ghost-rings the
          // callee (possibly into another call's room) or enrolls an idle
          // caller as a phantom line member. A vanished record always aborts.
          const now = reg.clients.get(callerPin);
          if (!now) return;
          const isLine = !!res && typeof res === "object" && (res as { partyLine?: boolean }).partyLine;
          // A party-line JOIN must be the caller's LATEST dial intent: any
          // newer invite, hang-up, or takeover re-register aborts it. An
          // identity RING only needs the call context intact (no hang-up /
          // takeover) — sibling invites from a group-dial burst coexist.
          if (isLine ? now.dialEpoch !== dialEpoch : now.ctxEpoch !== ctxEpoch) return;
          try {
            if (isLine) {
              joinPartyLine(reg, callerSocket, callerPin, to, (res as { title?: string }).title, onMissedCall);
            } else {
              runIdentityInvite();
            }
          } catch (e) {
            // A throw INSIDE the flow must never re-run it (the old trailing
            // .catch re-dialed = double ring) nor crash as an unhandled
            // rejection. Log and drop — the client's backstops recover.
            console.warn("[relay] deferred dial dispatch failed:", e);
          }
        };
        const fallbackT = setTimeout(() => settle("identity"), resolveDialTimeoutMs);
        // Two-argument then: the rejection handler catches RESOLVER failures
        // only ("db down" ⇒ dial as an identity). A trailing .catch would also
        // catch exceptions thrown inside joinPartyLine/runIdentityInvite and
        // re-run the identity flow — a double-ring footgun.
        onResolveDial(to).then(
          res => settle(res),
          () => settle("identity")
        );
        break;
      }
      runIdentityInvite();
      break;
    }

    case "accept": {
      const roomId = String(msg.roomId || "");
      const room = reg.rooms.get(roomId);
      if (!room) {
        safeSend(conn.socket, {
          type: "error",
          code: "gone",
          message: "That call has ended.",
        });
        break;
      }
      // Authorization: only a pin that was actually rung into this room (i.e.
      // sits in some current member's `ringing` set) may join it. Without this,
      // a client that learns a roomId could join an in-progress call — and on
      // the SFU path be minted a publish/subscribe token. Covers mesh + SFU.
      const callerPin = Array.from(room).find(p => reg.clients.get(p)?.ringing.has(conn.pin!));
      if (!callerPin) {
        safeSend(conn.socket, {
          type: "error",
          code: "forbidden",
          message: "You weren't invited to this call.",
        });
        break;
      }
      // 10-way only on the SFU; the mesh fallback stays capped at 6.
      const acceptCap = ROOM_MAX;
      if (room.size >= acceptCap) {
        safeSend(conn.socket, {
          type: "error",
          code: "full",
          message: `Call is full (${acceptCap} max).`,
        });
        break;
      }
      // Multi-device: the accepting DEVICE becomes the primary client for this
      // number, so every subsequent in-call signal (offer/answer/ice/peer-left)
      // routes to the device that actually answered — not to another idle device
      // that happened to hold the primary slot. No-op when the flag is off.
      if (multiDeviceEnabled() && conn.cid && self.cid !== conn.cid) {
        self.socket = conn.socket;
        self.cid = conn.cid;
      }
      // If the accepter was already in a different room, decide: HOLD it or DROP
      // it. A prior room with OTHER connected members is a REAL call (call
      // waiting) → put it on HOLD so it isn't dropped (the user can swap back).
      // A solo dialing room (only us) is just left, exactly as before. We never
      // hold more than one call: if a hold already exists it is released first.
      if (self.roomId && self.roomId !== roomId) {
        const priorRid = self.roomId;
        const priorRoom = reg.rooms.get(priorRid);
        const priorOthers = priorRoom
          ? Array.from(priorRoom).filter(p => p !== conn.pin && reg.clients.has(p))
          : [];
        if (priorOthers.length > 0) {
          // Real call → HOLD it. Keep the pin in the prior room's Set + roster;
          // only detach the ACTIVE pointer (set to the new room just below).
          const existingHeld = reg.heldRoom.get(conn.pin);
          if (existingHeld && existingHeld !== priorRid) releaseHeldRoom(reg, conn.pin);
          reg.heldRoom.set(conn.pin, priorRid);
          reg.pinRoom.delete(conn.pin); // about to be re-set to the new room
          markRoomDirty(priorRid);      // Round 11: this member is now HELD there
          roomActivityTouch(reg, priorRid);
          broadcastToRoom(reg, priorRid, { type: "peer-hold", pin: conn.pin, on: true }, conn.pin);
        } else {
          leaveRoom(reg, conn.pin);
        }
      }
      const roomMetaForRoles = reg.roomMeta.get(roomId);
      const members = Array.from(room)
        .filter(p => p !== conn.pin)
        // GHOSTS (membership kept, client record long gone) must not reach the
        // newcomer's roster: each one became a permanently dead "connecting…"
        // tile — the newcomer offers to nobody, forever. A member mid-grace
        // still has a client record and stays listed.
        .filter(p => reg.clients.has(p))
        .map(p => ({
          pin: p,
          name: (reg.clients.get(p) || { name: "Guest" }).name || "Guest",
          device: reg.clients.get(p)?.device,
          flag: reg.clients.get(p)?.flag,
          role: roleOf(roomMetaForRoles, p),
        }));
      joinRoomMember(reg, roomId, conn.pin);
      self.roomId = roomId;
      // Conference history: this accept makes the room a REAL (answered) call;
      // add the accepter to the roster + stamp answer/active time so the logged
      // duration measures TALK time (from first answer), not ring/dial time.
      {
        const meta = reg.roomMeta.get(roomId);
        if (meta) {
          meta.accepted = true;
          meta.roster.set(conn.pin, self.name);
          if (meta.answeredAt == null) meta.answeredAt = Date.now();
          meta.lastActiveAt = Date.now();
        }
      }
      // Multi-device: tell this number's OTHER devices the call was answered
      // here, so their incoming-call UI clears ("answered elsewhere"). The
      // `from` matches the ring they received (the caller's pin).
      if (multiDeviceEnabled()) {
        const devs = reg.devices.get(conn.pin);
        if (devs) {
          devs.forEach((sock, c) => {
            // `reason` (v2.99.5) lets the other devices show the honest
            // "Answered on another device" note; old clients ignore it.
            if (c !== conn.cid) safeSend(sock, { type: "ring-cancel", from: callerPin, reason: "answered" });
          });
        }
      }
      // Newcomer learns existing members and will offer to each (only one
      // side ever offers, which avoids SDP glare in the mesh). Fresh ICE
      // servers keyed to this peer are minted right as it's about to build
      // its peer connections — never the stale register-time set.
      safeSend(conn.socket, {
        type: "joined",
        roomId,
        members,
        cap: mintRoomCap(roomId, conn.pin, roleOf(roomMetaForRoles, conn.pin)),
        selfRole: roleOf(roomMetaForRoles, conn.pin),
        hostPin: roomMetaForRoles?.hostPin ?? null,
        iceServers: iceServers(conn.pin),
      });
      const newcomerPin = conn.pin;
      // Answered — this call's ring must never redeliver on a later reconnect.
      clearPendingRing(reg, newcomerPin, { roomId });
      members.forEach(m => {
        const o = reg.clients.get(m.pin);
        if (o) {
          // The newcomer answered — they're no longer a pending ring for us.
          o.ringing.delete(newcomerPin);
          safeSend(o.socket, {
            type: "peer-joined",
            pin: newcomerPin,
            name: self.name,
            device: self.device,
            flag: self.flag,
            role: roleOf(roomMetaForRoles, newcomerPin),
            iceServers: iceServers(m.pin),
          });
        }
      });
      break;
    }

    case "reject": {
      const targetPin = String(msg.to || "");
      const target = reg.clients.get(targetPin);
      // Only honour a decline for a call that was genuinely ringing us — without
      // this guard a client could POST reject for an arbitrary live pin and forge
      // a "declined" call_history row between two parties.
      if (target && target.ringing.has(conn.pin)) {
        target.ringing.delete(conn.pin);
        clearPendingRing(reg, conn.pin, { from: targetPin });
        // Multi-device (v2.99.5): declining on ONE device silences the ring on
        // the number's OTHER devices too (mirror of the accept fan-out) —
        // without this they kept ringing until their own 30s local timeout.
        if (multiDeviceEnabled()) {
          const devs = reg.devices.get(conn.pin);
          if (devs) {
            devs.forEach((sock, c) => {
              if (c !== conn.cid) safeSend(sock, { type: "ring-cancel", from: targetPin, reason: "declined" });
            });
          }
        }
        safeSend(target.socket, { type: "rejected", from: conn.pin });
        // Record the decline (call_history). Caller=targetPin, callee=us.
        try {
          onMissedCall?.({ calleePin: conn.pin, callerPin: targetPin, callerName: target.name, reason: "rejected" });
        } catch { /* never let a notification hook break call teardown */ }
        // Tear down the caller's solo dialing room so they can be invited
        // again — but NEVER a party line: a lone line occupant who rang
        // someone in (the in-call ➕ / group-dial flush) stays PARKED on the
        // line when that invitee declines. A pl- room is a persistent
        // destination, not a throwaway dial room.
        // GROUP-DIAL GUARD (QA H1): a group dial rings A/B/C off one room; while
        // everyone rings, the caller's room is still size 1 (nobody accepted).
        // If we reaped it the moment A declined, B and C would keep ringing with
        // pendingRings pointing at a DELETED room → they'd get error{gone} on
        // accept and the whole conference dies over one decline. Only reap once
        // the caller is ringing NOBODY else (`target.ringing` already had the
        // decliner removed at line 1739), so an in-progress group dial survives.
        const callerRid = target.roomId;
        if (
          callerRid &&
          !callerRid.startsWith(PARTY_LINE_ROOM_PREFIX) &&
          roomSize(reg, callerRid) === 1 &&
          target.ringing.size === 0
        ) {
          leaveRoom(reg, targetPin);
        }
      }
      break;
    }

    // ── live-call rejoin: knock → host approval → direct join (v2.99.9) ──────
    // A user who LEFT a call (logout drops room membership) can ask to rejoin
    // from History. `knock` targets the NUMBER whose live room they want back
    // into; the server resolves the room, verifies the knocker was PREVIOUSLY
    // in it (roster gate — no joining a stranger's call), and asks the HOST to
    // approve. This is the authorization boundary that replaces a fresh invite.
    case "knock": {
      const toNum = String(msg.to || "");
      const info = liveRoomInfo(reg, toNum, conn.pin);
      if (!info) {
        safeSend(conn.socket, { type: "knock-result", to: toNum, ok: false, reason: "gone" });
        break;
      }
      // The approver must be someone who is actually IN the room and connected —
      // M45's gate refuses anyone else, so alerting them would leave the knocker
      // waiting on a prompt that can never be honoured. v2.99.47: check that up
      // front and answer "gone" instead (the knocker's client shows "that call
      // has ended" rather than "asked the host…" forever). Host succession in
      // leaveRoom means a live call normally always has a present host.
      const roomNow = reg.rooms.get(info.roomId);
      const hostPresent =
        info.hostPin && roomNow?.has(info.hostPin) ? reg.clients.get(info.hostPin) : null;
      const host = hostPresent ?? null;
      if (!host) {
        safeSend(conn.socket, { type: "knock-result", to: toNum, ok: false, reason: "gone" });
        break;
      }
      // Record the pending knock on the ROOM meta so approve/deny can validate
      // it (and it's scoped to this room, not a free-floating grant).
      const meta = reg.roomMeta.get(info.roomId);
      if (meta) {
        if (!meta.knocks) meta.knocks = new Map();
        meta.knocks.set(conn.pin, { name: self.name, at: Date.now() });
      }
      // Alert the host (+ co-hosts) that someone wants back in.
      const knockMsg = { type: "knock", fromPin: conn.pin, fromName: self.name, roomId: info.roomId };
      safeSend(host.socket, knockMsg);
      if (meta) meta.cohosts.forEach(cp => { const c = reg.clients.get(cp); if (c) safeSend(c.socket, knockMsg); });
      safeSend(conn.socket, { type: "knock-result", to: toNum, ok: true, reason: "pending" });
      break;
    }

    case "knock-approve":
    case "knock-deny": {
      const roomId = String(msg.roomId || "");
      const knockerPin = String(msg.pin || "");
      const meta = reg.roomMeta.get(roomId);
      const room = reg.rooms.get(roomId);
      // Only the room's HOST or a co-host may approve/deny, and only a knock
      // that's actually pending (guards against a forged approve for an
      // arbitrary pin → unsolicited call injection).
      //
      // SECURITY (M45): the approver must ALSO still be IN the room. Unlike the
      // `mod` case — which derives its room from trusted server state
      // (`self.roomId`) and so is inherently bound to the caller's live call —
      // this handler takes `roomId` from the CLIENT, and `roomMeta` outlives
      // membership (the roster is add-only, and nothing clears `hostPin` /
      // `cohosts` when someone leaves). So `isModerator` alone kept saying yes
      // to people who had already gone, which meant:
      //   • a FORMER host who hung up could still name the old roomId and admit
      //     an outsider into a call they are no longer part of; and
      //   • worse, a KICKED co-host (whose role was never revoked — see the
      //     `kick` case) could knock and then APPROVE THEMSELVES straight back
      //     in, since both gates were satisfied. The kick was undoable by its
      //     own target.
      // Membership is the right test rather than `rid === self.roomId`, because
      // a host whose call is on HOLD is still in the room's member Set (v2.97.1)
      // and must remain able to approve.
      // v2.99.47: a rejected gate REPLIES. Silence here read as a broken button
      // to a host tapping Approve, and left the knocker waiting forever.
      if (!meta || !room || !isModerator(meta, conn.pin) || !room.has(conn.pin)) {
        // NOT `forbidden`/`gone`: the client treats both as FATAL to a peerless
        // call, so replying with one could hang up the approver's OWN call. A
        // dedicated code keeps this informational.
        safeSend(conn.socket, {
          type: "error",
          code: "knockfail",
          message: "You're no longer in that call.",
        });
        break;
      }
      if (!meta.knocks || !meta.knocks.has(knockerPin)) {
        safeSend(conn.socket, {
          type: "error",
          code: "knockfail",
          message: "That request is no longer waiting.",
        });
        break;
      }
      meta.knocks.delete(knockerPin);
      const knocker = reg.clients.get(knockerPin);
      if (!knocker) break; // knocker vanished while we deliberated
      if (type === "knock-deny") {
        safeSend(knocker.socket, { type: "knock-result", to: "", ok: false, reason: "denied" });
        break;
      }
      // APPROVED — admit the knocker with the join-without-ring machinery
      // (mirrors the accept path + joinPartyLine; the host approval IS the authz).
      admitToRoom(reg, knockerPin, roomId);
      break;
    }

    case "refresh-ice": {
      // Client is about to do an ICE restart and wants fresh TURN creds.
      // Mint a per-peer set and ship it back; safe to call frequently.
      safeSend(conn.socket, { type: "ice", iceServers: iceServers(conn.pin) });
      break;
    }

    case "rejoin-recreate": {
      /*
       * Round 11 part B — LAST-RESORT recovery: "I am still in a call, and you
       * no longer know about it." Sent after a leader change when the ordinary
       * register→rejoin handshake produced nothing, i.e. when the durable shadow
       * in Redis was also unavailable (a failover blip, or a leader that died
       * before its first write-through).
       *
       * AUTHORIZATION IS THE WHOLE DESIGN HERE. The client is asked for exactly
       * one thing — a capability THIS FLEET minted when it admitted this pin to
       * this room — and everything else is re-derived:
       *   • the subject pin comes from the CONNECTION, never the message, so a
       *     capability that leaks is useless to anyone holding another number;
       *   • the role comes from INSIDE the signature, so `selfRole: "host"` is
       *     not something a client can assert (that is the M45 / R-GENPIN class:
       *     moderation powers over a call you were never in);
       *   • a claimed member list is not accepted at all. Membership converges
       *     because every returning participant presents its OWN capability.
       * With no fleet secret configured nothing can be minted or verified, so
       * the path simply does not exist rather than existing unauthenticated.
       */
      const rid = typeof msg.roomId === "string" ? msg.roomId : "";
      const selfPin = conn.pin;
      if (!rid || !selfPin) {
        safeSend(conn.socket, { type: "error", code: "gone", message: "That call has ended." });
        break;
      }
      const claim = verifyRoomCap(msg.cap, rid, selfPin);
      if (!claim) {
        safeSend(conn.socket, { type: "error", code: "gone", message: "That call has ended." });
        break;
      }
      // The room may have survived after all (hydration won the race, or another
      // participant recreated it a moment ago) — then this is an ordinary
      // readmission, NOT a recreation.
      let meta = reg.roomMeta.get(rid);
      if (!reg.rooms.has(rid) || !meta) {
        meta = {
          startedAt: Date.now(),
          answeredAt: Date.now(),
          lastActiveAt: Date.now(),
          dialedNumber: null,
          // A recreated room is by definition a call that was already up, so it
          // is `accepted` — otherwise its conference-history row would be
          // silently dropped when it finally ends.
          accepted: true,
          roster: new Map(),
          hostPin: null,
          cohosts: new Set(),
        };
        reg.roomMeta.set(rid, meta);
        reg.rooms.set(rid, new Set());
      }
      // The signed role is honoured only where it cannot displace anyone: the
      // first host capability to arrive takes a VACANT host seat. A room that
      // already has a host keeps it, so two peers recreating concurrently can
      // never fight over moderation.
      if (claim.role === "host" && !meta.hostPin) meta.hostPin = selfPin;
      else if (claim.role === "cohost" || (claim.role === "host" && meta.hostPin !== selfPin)) {
        meta.cohosts.add(selfPin);
      }
      if (self.roomId && self.roomId !== rid) leaveRoom(reg, selfPin);
      joinRoomMember(reg, rid, selfPin);
      self.roomId = rid;
      meta.roster.set(selfPin, self.name);
      meta.lastActiveAt = Date.now();
      const others = membersOf(reg, rid, selfPin);
      safeSend(conn.socket, {
        type: "rejoin",
        roomId: rid,
        members: others,
        recreated: true,
        cap: mintRoomCap(rid, selfPin, roleOf(meta, selfPin)),
        selfRole: roleOf(meta, selfPin),
        hostPin: meta.hostPin ?? null,
        iceServers: iceServers(selfPin),
      });
      // Tell whoever is already back that this peer returned, so the mesh
      // re-links without waiting for anybody's timeout.
      others.forEach(m => {
        const o = reg.clients.get(m.pin);
        if (o) {
          safeSend(o.socket, {
            type: "peer-joined",
            pin: selfPin,
            name: self.name,
            device: self.device,
            flag: self.flag,
            role: roleOf(meta, selfPin),
            iceServers: iceServers(m.pin),
          });
        }
      });
      touchBusyState();
      break;
    }

    case "signal": {
      const to = String(msg.to || "");
      const target = reg.clients.get(to);
      if (!target) break;
      // SECURITY (S2): relay SDP/ICE ONLY between peers that actually share a
      // room (active OR held). Without this gate, any registered client could
      // push a `signal` to any ONLINE pin and force a silent WebRTC handshake —
      // harvesting the victim's host/srflx ICE candidates (IP deanonymization)
      // with no call, no ring, and no camera/mic consent. Legitimate signaling
      // only flows after both peers are members of the same room (post-accept /
      // peer-joined), and a call-waiting HOLD keeps both in the held room's set,
      // so both are covered. Mirrors the membership discipline of accept/reject.
      const activeRid = reg.pinRoom.get(conn.pin) ?? self.roomId;
      const heldRid = reg.heldRoom.get(conn.pin);
      // WHICH room authorized this relay (v2.99.57). The S2 gate above is
      // evaluated from the SENDER's side and deliberately counts a HELD room as
      // shared — but the relayed frame carried no room id, so the receiver could
      // not tell a held-room signal from a current-call one.
      //
      // That was a media-consent bypass, not a cosmetic gap: A is in call H with
      // V; V answers a second call and parks H, which moves A into V's
      // `heldPeers` and out of `peers`. A then hand-crafts a `signal` to V. The
      // gate passes (V is still in H's member set), V's client finds no
      // `peers[A]`, and `onSignal` calls `createPeer(A, …)` — which attaches
      // `processedStream || localStream`, i.e. V's LIVE mic from the call with
      // C, and flips `callIsGroup` so the camera goes too, bypassing mutual
      // consent. A silently receives V's audio and video from a private call.
      const matchedRid =
        !!activeRid && reg.rooms.get(activeRid)?.has(to) ? activeRid : heldRid;
      if (!matchedRid) break;
      safeSend(target.socket, {
        type: "signal",
        from: conn.pin,
        // The client never supplies this, so it cannot be forged or omitted.
        // Named `roomId` to match every other frame that carries a room.
        roomId: matchedRid,
        data: msg.data,
      });
      break;
    }

    case "leave": {
      // Caller hung up everything: every callee still ringing just missed the
      // call, and any call we had on hold is dropped too (full teardown).
      // Bump BOTH epochs so an invite still awaiting its resolver aborts —
      // a hang-up during the await must not ghost-ring the callee afterwards
      // (nor enroll the now-idle caller as a phantom party-line member).
      self.dialEpoch = ++dialEpochSeq;
      self.ctxEpoch = self.dialEpoch;
      const callerName = self.name;
      const missed = cancelPendingRings(reg, conn.pin);
      for (const calleePin of missed) {
        try {
          onMissedCall?.({ calleePin, callerPin: conn.pin, callerName, reason: "cancelled" });
        } catch { /* never let a notification hook break call teardown */ }
      }
      releaseHeldRoom(reg, conn.pin);
      leaveRoom(reg, conn.pin);
      break;
    }

    case "hold": {
      // The caller is putting their CURRENT room on hold to take another call.
      // Tell that room's other members so they see a "put you on hold" status.
      const rid = self.roomId;
      if (!rid) break;
      const on = msg.action !== "off"; // default = on; "off" resumes
      broadcastToRoom(reg, rid, { type: "peer-hold", pin: conn.pin, on }, conn.pin);
      break;
    }

    case "swap": {
      // Call waiting: switch the ACTIVE call and the HELD call. The held room
      // becomes active (its peers resume, peer-hold off) and the previously
      // active room is put on hold (peer-hold on). Media is re-activated
      // client-side; the server just flips the pointers + notifies both rooms.
      const activeRid = self.roomId;
      const heldRid = reg.heldRoom.get(conn.pin);
      if (!activeRid || !heldRid || !reg.rooms.has(heldRid) || !reg.rooms.has(activeRid)) {
        safeSend(conn.socket, { type: "error", code: "nohold", message: "No call on hold." });
        break;
      }
      reg.heldRoom.set(conn.pin, activeRid);
      reg.pinRoom.set(conn.pin, heldRid);
      self.roomId = heldRid;
      markRoomDirty(activeRid); // Round 11: both rooms' held flags flipped
      markRoomDirty(heldRid);
      const t = reg.roomReapT.get(heldRid);
      if (t) { clearTimeout(t); reg.roomReapT.delete(heldRid); }
      roomActivityTouch(reg, heldRid);
      roomActivityTouch(reg, activeRid);
      broadcastToRoom(reg, heldRid, { type: "peer-hold", pin: conn.pin, on: false }, conn.pin);
      broadcastToRoom(reg, activeRid, { type: "peer-hold", pin: conn.pin, on: true }, conn.pin);
      const rmeta = reg.roomMeta.get(heldRid);
      safeSend(conn.socket, {
        type: "resumed",
        roomId: heldRid,
        heldRoomId: activeRid,
        members: membersOf(reg, heldRid, conn.pin),
        cap: mintRoomCap(heldRid, conn.pin, roleOf(rmeta, conn.pin)),
        selfRole: roleOf(rmeta, conn.pin),
        hostPin: rmeta?.hostPin ?? null,
        iceServers: iceServers(conn.pin),
      });
      break;
    }

    case "end-active": {
      // Phone-style "end this line": leave the ACTIVE call and, if a call is on
      // hold, resume it (promote held → active). With nothing held this is just a
      // plain hang-up of the current call.
      leaveRoom(reg, conn.pin);
      // ALWAYS answer (v2.99.36). promoteHeldRoom returns false — sending
      // NOTHING — when the held room is already gone (reaped, or its last member
      // left). The client's end-active branch deliberately skips its own
      // hang-up and waits for `resumed`, so that silence wedged it in a call
      // whose camera/mic were still captured and whose End button had become a
      // no-op ("I cannot even have another call"). A `nohold` error lets the
      // client tear down immediately instead of waiting out its fallback timer.
      if (!promoteHeldRoom(reg, conn, self)) {
        safeSend(conn.socket, { type: "error", code: "nohold", message: "Call ended." });
      }
      break;
    }

    case "end-held": {
      // Phone-style "drop the WAITING line" (v2.97.1, owner: pick which call to
      // end): release ONLY the held room — its members get a normal peer-left
      // and the room reaps if empty — while the ACTIVE call stays untouched.
      // (The client already closed its frozen peer connections.)
      if (!reg.heldRoom.get(conn.pin)) {
        safeSend(conn.socket, { type: "error", code: "nohold", message: "No call on hold." });
        break;
      }
      releaseHeldRoom(reg, conn.pin);
      safeSend(conn.socket, { type: "held-ended" });
      break;
    }

    case "merge": {
      // Merge the HELD call into the ACTIVE call → one conference. Every other
      // held member is moved into the active room (they get a fresh `joined` so
      // they mesh-link with everyone), the active members are told a peer joined,
      // and the hold is cleared. Best-effort; secondary to hold/swap.
      const activeRid = self.roomId;
      const heldRid = reg.heldRoom.get(conn.pin);
      if (!activeRid || !heldRid || !reg.rooms.has(heldRid) || !reg.rooms.has(activeRid)) {
        safeSend(conn.socket, { type: "error", code: "nohold", message: "No call on hold." });
        break;
      }
      reg.heldRoom.delete(conn.pin);
      // Busy-line mirror (v2.91): merging a SOLO held party line deletes the
      // empty held room below WITHOUT crossing any join/leave funnel (movers
      // is empty, so joinRoomMember never runs) — the local live count drops
      // but the Redis mirror would keep the stale count until the 30s full
      // re-sync. Coalesced next-tick sync observes the settled state.
      touchBusyState();
      const heldRoom = reg.rooms.get(heldRid)!;
      const activeMeta = reg.roomMeta.get(activeRid);
      const movers = Array.from(heldRoom).filter(p => p !== conn.pin);
      // Remove the holder from the held room first so movers don't try to link to
      // a "ghost" copy of us in the old room (we're already in the active room).
      heldRoom.delete(conn.pin);
      for (const p of movers) {
        const pc = reg.clients.get(p);
        heldRoom.delete(p);
        joinRoomMember(reg, activeRid, p);
        if (pc) pc.roomId = activeRid;
        if (activeMeta) {
          activeMeta.roster.set(p, pc?.name || "Guest");
          activeMeta.accepted = true;
          activeMeta.lastActiveAt = Date.now();
        }
        if (pc) {
          safeSend(pc.socket, {
            type: "joined",
            roomId: activeRid,
            members: membersOf(reg, activeRid, p),
            cap: mintRoomCap(activeRid, p, roleOf(activeMeta, p)),
            selfRole: roleOf(activeMeta, p),
            hostPin: activeMeta?.hostPin ?? null,
            iceServers: iceServers(p),
          });
        }
        broadcastToRoom(reg, activeRid, {
          type: "peer-joined",
          pin: p,
          name: pc?.name || "Guest",
          device: pc?.device,
          flag: pc?.flag,
          role: roleOf(activeMeta, p),
          iceServers: undefined,
        }, p);
      }
      // The held room is now empty of real members — reap it (no history; it was
      // folded into the active call, which carries the full roster).
      if (heldRoom.size === 0) {
        const t = reg.roomReapT.get(heldRid);
        if (t) { clearTimeout(t); reg.roomReapT.delete(heldRid); }
        reg.roomMeta.delete(heldRid);
        reg.rooms.delete(heldRid);
      }
      // Round 11: the held room was folded into the active one WITHOUT crossing
      // reapRoom, so neither side would otherwise be re-shadowed.
      markRoomDirty(heldRid);
      markRoomDirty(activeRid);
      safeSend(conn.socket, { type: "merged", roomId: activeRid, members: membersOf(reg, activeRid, conn.pin), cap: mintRoomCap(activeRid, conn.pin, roleOf(activeMeta, conn.pin)) });
      break;
    }

    case "video-request":
    case "video-accept":
    case "video-decline": {
      // Mutual-consent video (1:1): cameras transmit only after BOTH parties
      // agree. Pure relay of the sender's intent to the rest of their room,
      // stamped with who it came from.
      const rid = self.roomId;
      if (!rid) break;
      broadcastToRoom(reg, rid, { type: msg.type, from: conn.pin, fromName: self.name }, conn.pin);
      break;
    }

    case "screen": {
      // The caller started/stopped sharing their screen. Tell the room so EVERY
      // participant can spotlight the sharer's tile — we don't rely on per-browser
      // track-source detection (the mesh + replaced-track paths don't expose it).
      const rid = self.roomId;
      if (!rid) break;
      const on = msg.action !== "off";
      broadcastToRoom(reg, rid, { type: "peer-screen", pin: conn.pin, on }, conn.pin);
      break;
    }

    case "mod": {
      // Host / co-host moderation. Only a moderator of the caller's own active
      // room may act, and only on members of THAT room.
      const rid = self.roomId;
      if (!rid) break;
      const meta = reg.roomMeta.get(rid);
      if (!isModerator(meta, conn.pin)) {
        safeSend(conn.socket, { type: "error", code: "forbidden", message: "Only the host can do that." });
        break;
      }
      const room = reg.rooms.get(rid);
      if (!room) break;
      const action = String(msg.action || "");
      const target = typeof msg.target === "string" ? msg.target : "";
      const sendTo = (p: string, obj: unknown) => { const c = reg.clients.get(p); if (c) safeSend(c.socket, obj); };
      /**
       * Is `p` ACTIVELY in this room, as opposed to merely a member of it?
       *
       * v2.99.57: `room.has(p)` is true for someone who PARKED this call and is
       * now live in a different one — the roster keeps held members precisely so
       * they can resume. Acting on `room.has` alone meant a host could reach into
       * a member's OTHER call: `force-mute` was applied by their client to
       * whatever call they were actually in, and `kick` called `leaveRoom`, which
       * removes them from their ACTIVE room — so kicking a held member dropped an
       * unrelated call and left them still a member of the room they were kicked
       * from. Bypassable and destructive at once.
       */
      const inActiveRoom = (p: string) =>
        (reg.pinRoom.get(p) ?? reg.clients.get(p)?.roomId ?? null) === rid;
      switch (action) {
        case "mute":
        case "unmute": {
          // Must be IN this call, not merely a member who parked it.
          if (!room.has(target) || !inActiveRoom(target)) break;
          sendTo(target, { type: "force-mute", on: action === "mute", by: conn.pin, roomId: rid });
          break;
        }
        case "mute-all":
        case "unmute-all": {
          const on = action === "mute-all";
          room.forEach(p => {
            if (p !== conn.pin && inActiveRoom(p)) sendTo(p, { type: "force-mute", on, by: conn.pin, roomId: rid });
          });
          break;
        }
        case "cohost": {
          // Toggle co-host. Only the HOST may (de)assign co-hosts.
          if (meta!.hostPin !== conn.pin) {
            safeSend(conn.socket, { type: "error", code: "forbidden", message: "Only the host assigns co-hosts." });
            break;
          }
          if (!room.has(target) || target === meta!.hostPin) break;
          const role = meta!.cohosts.has(target) ? undefined : "cohost";
          if (role) meta!.cohosts.add(target); else meta!.cohosts.delete(target);
          markRoomDirty(rid); // Round 11
          broadcastToRoom(reg, rid, { type: "role", pin: target, role: role ?? null });
          break;
        }
        case "makehost": {
          // Transfer the HOST role to another member. Only the current host can.
          if (meta!.hostPin !== conn.pin) {
            safeSend(conn.socket, { type: "error", code: "forbidden", message: "Only the host can transfer the host role." });
            break;
          }
          if (!room.has(target) || target === meta!.hostPin) break;
          const oldHost = meta!.hostPin;
          meta!.hostPin = target;
          meta!.cohosts.delete(target);     // new host is no longer just a co-host
          if (oldHost) meta!.cohosts.add(oldHost); // demote old host to co-host
          markRoomDirty(rid); // Round 11
          // Tell the room about BOTH role changes.
          broadcastToRoom(reg, rid, { type: "role", pin: target, role: "host", hostPin: target });
          if (oldHost) broadcastToRoom(reg, rid, { type: "role", pin: oldHost, role: "cohost", hostPin: target });
          break;
        }
        case "kick": {
          // Remove a participant from the call. A co-host can remove regular
          // members; only the host can remove a co-host; nobody can remove the host.
          if (!room.has(target) || target === conn.pin) break;
          const trole = roleOf(meta, target);
          if (trole === "host") {
            safeSend(conn.socket, { type: "error", code: "forbidden", message: "You can't remove the host." });
            break;
          }
          if (trole === "cohost" && meta!.hostPin !== conn.pin) {
            safeSend(conn.socket, { type: "error", code: "forbidden", message: "Only the host can remove a co-host." });
            break;
          }
          // SECURITY (M45): strip the target's MODERATOR ROLE as part of the
          // removal. `leaveRoom` only drops membership — it never touched
          // `meta.cohosts`, so a kicked co-host stayed a co-host in the room's
          // metadata and got their powers back intact the moment they were back
          // in the room by ANY route (a re-invite, an auto-rejoin, or — before
          // the guard added above — knocking and approving themselves). A removal
          // that leaves the removed party able to mute, pin and kick the people
          // who removed them is not a removal. Also drop any knock they have
          // pending so the kick can't be immediately undone by a queued request.
          if (meta) {
            meta.cohosts.delete(target);
            meta.knocks?.delete(target);
          }
          // Tell the target they were removed, then force them out of the room.
          sendTo(target, { type: "kicked", by: conn.pin, roomId: rid });
          // Remove them from THIS room (v2.99.57). `leaveRoom` acts on the
          // target's ACTIVE room, so for a member who had parked this call it
          // used to drop their unrelated live call and leave them a member here —
          // a kick that both missed and did collateral damage.
          if (reg.heldRoom.get(target) === rid) {
            releaseHeldRoom(reg, target);
          } else if (inActiveRoom(target)) {
            leaveRoom(reg, target); // membership + peer-left + reap if empty
          } else {
            // A member of this room who is neither active in it nor holding it
            // (a reaped connection whose membership survives for auto-rejoin).
            reg.rooms.get(rid)?.delete(target);
            reg.pinRoom.delete(target);
            broadcastToRoom(reg, rid, { type: "peer-left", pin: target }, target);
            promoteHostIfVacant(reg, rid, target);
          }
          // Everyone still in the room learns the role is gone, so no client
          // keeps rendering them with host controls.
          broadcastToRoom(reg, rid, { type: "role", pin: target, role: null });
          break;
        }
        case "pin": {
          // Pin a feed to everyone's main view (empty target = clear → grid).
          broadcastToRoom(reg, rid, { type: "host-pin", pin: target || null });
          break;
        }
        case "grid": {
          broadcastToRoom(reg, rid, { type: "host-pin", pin: null });
          break;
        }
        default:
          break;
      }
      break;
    }

    /**
     * #129 — THE mediasoup OP TUNNEL. One funnel, and that is the whole shape of it.
     *
     * mediasoup has no client↔server channel of its own. The deleted hosted SFU did — its SDK
     * carried a WebSocket straight to the media server, so the app only had to hand over a
     * token — and that is exactly why a token-shaped seam would be the wrong seam here: every
     * one of a participant's ops has to travel through us.
     *
     * ONE CASE RATHER THAN ONE PER OP. Six-plus ops each needing room authorization, id
     * ownership, correlation and a reply to the RIGHT socket is precisely the shape the house
     * rule forbids spreading across call sites, and v2.106.48 is the recorded proof: a token
     * addressed to the number instead of the socket reached a different device, and the call
     * carried nothing while every other frame looked fine. So the socket is `conn.socket`,
     * once, here.
     *
     * FAILS OPEN INTO A REFUSAL, NEVER A THROW. This is the call path.
     */
    case "voip": {
      const seq = typeof (msg as { seq?: unknown }).seq === "number" ? (msg as { seq: number }).seq : null;
      /* CORRELATION IS THE CLIENT'S OWN `seq`, echoed back untouched. The tunnel is one
         request/response pair over a channel that delivers frames out of order under retry,
         so without it a client cannot tell which `createTransport` a reply belongs to — and
         with two transports in flight (send + recv, which the handshake requires) that is not
         hypothetical. It is opaque to us: never read, never used as a key, so a client that
         reuses one only confuses itself. */
      const deny = (reason: string) => {
        safeSend(conn.socket, { type: "voip-error", seq, reason });
      };

      /* CAPTURED, NOT RE-READ. `handleMessage` already returned for an unregistered
         connection long before the switch, so this is non-null here — but the async
         continuation below loses that narrowing, because `conn.pin` is a mutable property and
         a closure could run after it changed. Capturing the value is therefore load-bearing
         rather than a type workaround: it is the pin the op was authorized FOR, and re-reading
         it after the await would let a channel takeover mid-op record ids under a new number.
         A redundant `if (!selfPin)` guard is deliberately absent — two individually-removable
         checks for one rule is dead weight that reads as load-bearing (v2.105.17). */
      const selfPin = conn.pin;
      /* THE ROOM COMES FROM THE REGISTRY, NEVER THE MESSAGE. Room ids are relayed to every
         participant, so a client-named room is the hole M45 closed on `accept`. There is
         deliberately no `msg.roomId` read anywhere in this case. */
      const rid = reg.pinRoom.get(selfPin) ?? null;
      const meta = rid ? reg.roomMeta.get(rid) : undefined;
      const room = rid ? reg.rooms.get(rid) : undefined;

      const str = (k: string) => {
        const v = (msg as Record<string, unknown>)[k];
        return typeof v === "string" && v ? v : null;
      };

      const verdict = authorizeClientOp({
        op: (msg as { op?: unknown }).op,
        roomId: rid,
        pin: selfPin,
        hasAssignment: !!meta?.voip,
        isMember: !!room?.has(selfPin),
        session: rid ? voipSessions.get(rid) : undefined,
        transportId: str("transportId"),
        consumerId: str("consumerId"),
        producerId: str("producerId"),
      });
      if (!verdict.allow) {
        deny(verdict.reason);
        break;
      }

      const assignment = meta!.voip!;
      const roomId = rid!;
      /* The payload is the client's, MINUS anything that would let it aim the op somewhere
         else: `roomId` is ours (the node keys every id by it, so a client-supplied one would
         reach into another call on the same node) and `op`/`seq` are envelope. Everything
         else — rtpCapabilities, dtlsParameters, rtpParameters — is opaque mediasoup data we
         have no business validating and could not validate correctly if we tried. */
      const { op: _op, seq: _seq, roomId: _rid, type: _t, ...rest } = msg as Record<string, unknown>;
      void _op; void _seq; void _rid; void _t;

      void (async () => {
        try {
          const res = await callNodeTracked<Record<string, unknown>>(
            { instanceId: assignment.instanceId, privateIp: assignment.privateIp },
            verdict.op,
            { ...rest, roomId },
          );
          if (!res.ok) {
            deny(res.reason);
            return;
          }
          /* RE-CHECK AFTER THE AWAIT — the same discipline as the offline dial resolver. The
             member may have left, or the room been reaped, while the node answered; recording
             their ids then would resurrect ownership for a room nobody is in, and the reply
             would land on a socket now serving a different call. */
          if (reg.pinRoom.get(selfPin) !== roomId) return;

          const rec = recordOpResult(sessionFor(voipSessions, roomId), selfPin, verdict.op, res.data);
          safeSend(conn.socket, { type: "voip-result", seq, op: verdict.op, data: res.data });

          /* THE EVENT CHANNEL THE NODE DOES NOT HAVE, and it turns out not to be needed: the
             agent is request/response only, with no push at all — but the APP is the one that
             called `produce`, so at this instant it already knows a new producer exists and
             tells the room's other members directly. Strictly better than a poll, and the
             poll was not available anyway. */
          if (rec.newProducer) {
            const others = reg.rooms.get(roomId);
            others?.forEach((p) => {
              if (p === selfPin) return;
              const o = reg.clients.get(p);
              if (o) {
                safeSend(o.socket, {
                  type: "voip-producer",
                  pin: selfPin,
                  producerId: rec.newProducer!.id,
                  kind: rec.newProducer!.kind,
                });
              }
            });
          }
        } catch {
          /* A tunnel op must never reject into the handler: this runs detached from the
             signaling dispatch, so an unhandled rejection here would be a process-level event
             for what is one recoverable request. The client sees a refusal and retries. */
          deny("node-error");
        }
      })();
      break;
    }

    /**
     * #129 — what a joiner has to consume. Answered from the app's own ledger, because the
     * node cannot answer it: it records no owner, so "who is producing in this room" does not
     * exist on that side. Same authorization as the tunnel; the reply names other people's
     * producer ids, which is what consuming requires and is scoped to this room's members.
     */
    case "voip-producers": {
      const selfPin = conn.pin;
      const rid = reg.pinRoom.get(selfPin) ?? null;
      const meta = rid ? reg.roomMeta.get(rid) : undefined;
      if (!rid || !reg.rooms.get(rid)?.has(selfPin) || !meta?.voip) {
        safeSend(conn.socket, { type: "voip-error", seq: null, reason: rid ? "no-assignment" : "not-in-room" });
        break;
      }
      safeSend(conn.socket, {
        type: "voip-producers",
        producers: otherProducersFor(voipSessions.get(rid), selfPin),
      });
      break;
    }

    default:
      break;
  }
}

/* ── Carrier-style busy line (v2.88) ─────────────────────────────
 * The module remembers the registry attachRelay created so the tRPC layer can
 * ask "is this pin on a call right now?" — a pure READ of in-memory state.
 * Single-instance by design (same instance serves the SSE signaling), exactly
 * like the rest of this module; see CLAUDE.md's in-memory-state warning. */
let activeRegistry: RelayRegistry | null = null;

/** Test hook: point the busy-line reads at a synthetic registry. */
export function _setActiveRegistryForTests(reg: RelayRegistry | null): void {
  activeRegistry = reg;
}

/**
 * Which of `pins` are currently IN A CALL (their primary client sits in a
 * room)? Returns the subset as a Set. Empty when signaling isn't attached
 * (tests / cold paths) — "not in a call" is the safe default.
 */
export function pinsInCall(pins: readonly string[]): Set<string> {
  const out = new Set<string>();
  const reg = activeRegistry;
  if (!reg) return out;
  for (const pin of pins) {
    const rid = reg.clients.get(pin)?.roomId;
    if (!rid) continue;
    // A caller alone in their DIAL room isn't "on a call" yet — only count
    // rooms someone actually answered, or with 2+ members (review v2.88).
    const meta = reg.roomMeta.get(rid);
    const size = reg.rooms.get(rid)?.size ?? 0;
    if (meta?.accepted || size > 1) out.add(pin);
  }
  return out;
}

/**
 * Live head-count on a party line, straight from the in-memory registry (same
 * single-instance trust model as pinsInCall). Counts only CONNECTED members —
 * ghosts (kept membership, dead client) don't inflate the "N on the line".
 * Returns 0 for every number when signaling isn't attached (tests/cold paths).
 */
export function partyLineLiveCounts(numbers: readonly string[]): Map<string, number> {
  const out = new Map<string, number>();
  const reg = activeRegistry;
  for (const n of numbers) {
    let c = 0;
    if (reg) {
      const room = reg.rooms.get(partyLineRoomId(n));
      room?.forEach(p => { if (reg.clients.has(p)) c++; });
    }
    out.set(n, c);
  }
  return out;
}

/**
 * Live-call rejoin (v2.99.9): resolve the ALIVE room a given number is in and
 * return its roster/host — but ONLY to a `requester` who was PREVIOUSLY in that
 * exact room (their pin is retained in `roomMeta.roster`, which is add-only).
 * That relationship gate makes this safe to expose to the API tier: you can
 * only see the live roster of a call you were already part of (no enumeration
 * or eavesdrop oracle over the number space). Returns null when there's no live
 * room, the requester was never in it, or signaling isn't attached (so on a
 * non-leader API instance it simply degrades to "no live card"). Same
 * single-instance trust model as pinsInCall.
 */
export type LiveRoomInfo = { roomId: string; hostPin: string | null; hostName: string | null; count: number; members: Array<{ pin: string; name: string; role: string }>; startedAt: number };

/** Registry-parameterized core of `liveRoomFor` — used by the signaling `knock`
 *  handler (which has its own `reg` in scope) so it never depends on the global
 *  `activeRegistry` (that would be a different/absent registry in tests and
 *  wrong under a per-request handler). */
export function liveRoomInfo(
  reg: RelayRegistry,
  number: string,
  requester: string,
): LiveRoomInfo | null {
  if (!reg || !/^\d{6}$/.test(number) || !/^\d{6}$/.test(requester)) return null;
  // The number's CURRENT room (a connected member's live roomId; fall back to
  // persistent membership for a member in disconnect-grace).
  const rid = reg.clients.get(number)?.roomId ?? reg.pinRoom.get(number) ?? null;
  if (!rid) return null;
  const room = reg.rooms.get(rid);
  const meta = reg.roomMeta.get(rid);
  if (!room || !meta) return null;
  // Alive = a real (answered) call with at least one CONNECTED member.
  if (!meta.accepted || roomConnectedCount(reg, rid) < 1) return null;
  // Relationship gate: the requester must have been in this room before.
  if (requester !== meta.hostPin && !meta.roster.has(requester)) return null;
  // Don't advertise a call the requester is ALREADY an active member of.
  if (room.has(requester) && reg.clients.get(requester)?.roomId === rid) return null;
  const members = Array.from(room)
    .filter(p => reg.clients.has(p))
    .map(p => ({ pin: p, name: (reg.clients.get(p) || { name: "Guest" }).name || "Guest", role: roleOf(meta, p) ?? "" }));
  const hostName = meta.hostPin ? (reg.clients.get(meta.hostPin)?.name ?? meta.roster.get(meta.hostPin) ?? null) : null;
  return { roomId: rid, hostPin: meta.hostPin, hostName, count: members.length, members, startedAt: meta.startedAt };
}

/** The API-tier entry (tRPC directory.liveRoom): reads the module-level
 *  `activeRegistry` the signaling node set. Returns null off the signaling node
 *  (degrades to "no live card" on a non-leader instance). */
export function liveRoomFor(number: string, requester: string): LiveRoomInfo | null {
  const reg = activeRegistry;
  if (!reg) return null;
  return liveRoomInfo(reg, number, requester);
}

/**
 * #109 — who is on a PARTY LINE right now, for the invite screen somebody sees
 * before they join.
 *
 * DELIBERATELY NOT `liveRoomInfo`, and the difference is the whole reason this
 * exists as its own function. That one is gated on the requester having been in
 * the room before, which is exactly right for a private call and impossible here:
 * a link-holder has by construction never been on the line. So the gate is
 * replaced by a NARROWER TARGET instead of being relaxed — this reads the ONE
 * room id derived from the line's own number (`pl-<number>`) and can therefore
 * never be pointed at a private call, whatever number it is handed. A person's
 * number resolves to no `pl-` room, so passing one returns an empty roster.
 *
 * PINS ARE RETURNED HERE and dropped by the caller. Keeping the registry reader
 * honest about what it read means the trimming decision lives at the API
 * boundary, where the audience is known, rather than being buried in here.
 */
export type PartyLineRoster = {
  roomId: string;
  startedAt: number | null;
  members: Array<{ pin: string; name: string; role: string; joinedAt: number | null }>;
};

export function partyLineRosterOf(reg: RelayRegistry, number: string): PartyLineRoster | null {
  if (!reg || !/^\d{6}$/.test(number)) return null;
  const rid = partyLineRoomId(number);
  const room = reg.rooms.get(rid);
  const meta = reg.roomMeta.get(rid);
  if (!room) return { roomId: rid, startedAt: meta?.startedAt ?? null, members: [] };
  const members = Array.from(room)
    // CONNECTED members only. A party-line room retains a ghost through
    // disconnect-grace so they can auto-rejoin, and listing one would tell a
    // joiner somebody is on the line who is not.
    .filter(p => reg.clients.has(p))
    .map(p => ({
      pin: p,
      name: reg.clients.get(p)?.name || meta?.roster.get(p) || "Guest",
      role: roleOf(meta, p) ?? "",
      joinedAt: meta?.joinedAt?.get(p) ?? null,
    }));
  return { roomId: rid, startedAt: meta?.startedAt ?? null, members };
}

/** The API-tier entry: reads the `activeRegistry` the signaling node set, so it
 *  returns null off that node — the invite screen then shows the line with no
 *  roster rather than claiming it is empty. */
export function partyLineRosterFor(number: string): PartyLineRoster | null {
  const reg = activeRegistry;
  if (!reg) return null;
  return partyLineRosterOf(reg, number);
}

/* ── Tiered busy-state (v2.91, Redis bus) ────────────────────────
 * On a multi-instance deploy the ALB pins ALL /api/relay/* traffic to ONE
 * signaling node (see docs-aws-scale-out.md); the OTHER instances' registries
 * are empty, so their local pinsInCall/partyLineLiveCounts reads would lie.
 * The signaling node mirrors its registry into Redis (`relay:busypins` /
 * `relay:plcounts`, written from the join/leave/reap funnels + a 30s full
 * re-sync); these async wrappers read the mirror WHEN the bus is on AND this
 * instance has no local relay clients (API tier). Everywhere else — .org,
 * single-box .io, the signaling node itself — they return the local read,
 * byte-identical to the sync functions. */

/** Full busy-state truth of a registry — what the signaling node mirrors to
 *  Redis. Exported for tests. Zero-count party lines are omitted (absent ==
 *  0 for readers, and the sync HDELs entries that leave the map). */
export function computeBusySnapshot(reg: RelayRegistry): BusySnapshot {
  const busyPins: string[] = [];
  reg.clients.forEach((c, pin) => {
    const rid = c.roomId;
    if (!rid) return;
    const meta = reg.roomMeta.get(rid);
    const size = reg.rooms.get(rid)?.size ?? 0;
    if (meta?.accepted || size > 1) busyPins.push(pin); // pinsInCall semantics
  });
  const plCounts = new Map<string, number>();
  reg.rooms.forEach((room, rid) => {
    if (!rid.startsWith(PARTY_LINE_ROOM_PREFIX)) return;
    let n = 0;
    room.forEach(p => { if (reg.clients.has(p)) n++; });
    if (n > 0) plCounts.set(rid.slice(PARTY_LINE_ROOM_PREFIX.length), n);
  });
  return { busyPins, plCounts, hasClients: reg.clients.size > 0 };
}

/** Local registry answer when this instance IS (or could be) the signaling
 *  node; Redis mirror when it demonstrably isn't (bus on, zero local
 *  clients). Failure-safe: any Redis error degrades to "not on a call". */
export async function pinsInCallAsync(pins: readonly string[]): Promise<Set<string>> {
  if (busEnabled() && !(activeRegistry && activeRegistry.clients.size > 0)) {
    try {
      return await readBusyPinsFromRedis(pins);
    } catch {
      return new Set();
    }
  }
  return pinsInCall(pins);
}

/** Tiered variant of partyLineLiveCounts — same routing as pinsInCallAsync. */
export async function partyLineLiveCountsAsync(
  numbers: readonly string[]
): Promise<Map<string, number>> {
  if (busEnabled() && !(activeRegistry && activeRegistry.clients.size > 0)) {
    try {
      return await readPlCountsFromRedis(numbers);
    } catch {
      /* fall through to the (all-zero) local read */
    }
  }
  return partyLineLiveCounts(numbers);
}

/**
 * Reconnect re-binding, extracted verbatim from the SSE stream handler so BOTH
 * the local (non-clustered) path and the cross-instance LEADER (which runs the
 * registry on virtual sockets, see server/relayCluster.ts) can reuse it. If this
 * cid already owns a number whose client record survives (within the disconnect
 * grace window), re-attach the fresh socket so the user keeps number/room/call.
 * Behavior-preserving: the local path calls it right after connections.set(cid).
 */
function bindReconnect(reg: RelayRegistry, cid: string, socket: RelaySocket): void {
  const conn = reg.connections.get(cid);
  if (!conn) return;
  const ownedPin = reg.cidToPin.get(cid);
  if (ownedPin) {
    const client = reg.clients.get(ownedPin);
    if (client) {
      // Multi-device: a reconnecting SECONDARY device must not hijack the
      // in-call primary's socket — NOR cancel the PRIMARY's disconnect-grace
      // timer. Only the primary's own reconnect touches its socket+grace.
      const isPrimaryReconnect =
        !multiDeviceEnabled() || client.cid === cid || client.cid === null;
      if (isPrimaryReconnect) {
        if (client.graceT) { clearTimeout(client.graceT); client.graceT = null; }
        client.socket = socket;
      }
      conn.pin = ownedPin;
      deviceAdd(reg, ownedPin, cid, socket); // track this device for ringing
    }
  }
}

/**
 * The REGISTRY-side teardown of a dropped SSE channel, extracted verbatim from
 * the stream handler's `cleanup` (the transport bits — hb/uncountStream/res.end
 * — stay at the call site). Deletes the connection, drops the device socket, and
 * arms the disconnect-grace timer that (on expiry with no reconnect) reaps the
 * client / promotes a surviving device / cancels pending rings / releases held
 * rooms / leaves or keeps the room for auto-rejoin. Reused by the cross-instance
 * LEADER on a `__disconnect` from a home instance.
 */
function cleanupRegistryConn(
  reg: RelayRegistry,
  cid: string,
  conn: RelayConnection,
  onMissedCall?: MissedCallHook
): void {
  const existing = reg.connections.get(cid);
  if (existing === conn) reg.connections.delete(cid);
  // Drop this device socket from the ring set — a dead socket can't receive a
  // ring, and a reconnecting cid re-adds itself.
  if (conn.pin) deviceRemove(reg, conn.pin, cid);
  // Do NOT remove the client immediately — SSE channels are routinely cut by
  // proxies; start a grace timer. A reconnect within the window re-binds and
  // clears it, so the user keeps their number, room, and active call.
  if (conn.pin) {
    const pin = conn.pin;
    const client = reg.clients.get(pin);
    if (client && (client.cid === cid || client.cid === null)) {
      if (client.graceT) clearTimeout(client.graceT);
      client.graceT = setTimeout(() => {
        const c = reg.clients.get(pin);
        // Only reap if it wasn't re-bound to a newer live connection.
        if (c && c.graceT) {
          // Multi-device: promote a surviving device to primary instead of
          // marking the number offline (keeps it reachable for NEW calls).
          if (multiDeviceEnabled()) {
            const devs = reg.devices.get(pin);
            const survivor = devs && Array.from(devs.entries()).find(([dcid]) => dcid !== cid);
            if (survivor) {
              if (reg.cidToPin.get(cid) === pin) reg.cidToPin.delete(cid);
              c.graceT = null;
              c.socket = survivor[1];
              c.cid = survivor[0];
              return; // keep the number alive on the surviving device
            }
          }
          // A vanished caller's pending callees missed the call.
          const callerName = c.name;
          const missed = cancelPendingRings(reg, pin);
          for (const calleePin of missed) {
            try {
              onMissedCall?.({ calleePin, callerPin: pin, callerName, reason: "cancelled" });
            } catch { /* never let a notification hook break reaping */ }
          }
          // A call held by this (now gone) member can't be auto-rejoined.
          releaseHeldRoom(reg, pin);
          const rid = reg.pinRoom.get(pin) ?? null;
          if (rid) {
            // In an ACTIVE call: KEEP the persistent membership (reg.pinRoom + the
            // pin in reg.rooms) AND cidToPin so a reconnect auto-rejoins the same
            // call. Drop only the dead connection, then arm the abandonment reaper.
            roomActivityTouch(reg, rid);
            broadcastToRoom(reg, rid, { type: "peer-left", pin }, pin);
            reg.clients.delete(pin);
            reg.devices.delete(pin);
            // HOST SUCCESSION (v2.99.57). v2.99.47's M53 fix gave `leaveRoom` a
            // successor, but a host whose SSE simply DIES — a backgrounded phone,
            // a dropped network — reaches this branch instead, and it never
            // promoted anyone. `meta.hostPin` then named a member with no client
            // record, so mute/pin/kick returned `forbidden` for everyone and a
            // History "Join" knock went to an absent host and was silently
            // dropped: exactly the dead end M53 exists to prevent.
            //
            // AFTER the delete, deliberately: promoteHostIfVacant filters
            // candidates on `reg.clients.has(p)`, so calling it earlier would
            // "promote" the host who just vanished.
            promoteHostIfVacant(reg, rid, pin);
            maybeScheduleRoomReap(reg, rid);
            touchBusyState();
          } else {
            // Not in a call — full teardown (original behaviour).
            leaveRoom(reg, pin);
            reg.clients.delete(pin);
            reg.devices.delete(pin);
            if (reg.cidToPin.get(cid) === pin) reg.cidToPin.delete(cid);
          }
        }
      }, RELAY_DISCONNECT_GRACE_MS);
    }
  }
}

/**
 * Mount the HTTP signaling endpoints on an Express app.
 *
 * Returns the underlying registry so tests can poke at internal state.
 */
export function attachRelay(
  app: Express,
  onInvite?: InviteHook,
  onMissedCall?: MissedCallHook,
  onConferenceEnd?: ConferenceEndHook,
  onPageCallee?: PageCalleeHook,
  onResolveDial?: ResolveDialHook,
  onCancelRingPush?: CancelPushHook
): RelayRegistry {
  const reg = createRegistry();
  reg.onConferenceEnd = onConferenceEnd;
  reg.onCancelRingPush = onCancelRingPush;
  activeRegistry = reg; // busy-line reads (pinsInCall) target the live registry
  // Redis mirror of busy-line/party-line state (v2.91) — inert without
  // REDIS_URL. The provider closes over THIS registry, matching
  // activeRegistry's last-attach-wins semantics.
  initBusyStateSync(() => computeBusySnapshot(reg));
  // RENUMBER REBIND (v2.99.83): keep the live signaling registration in step with a
  // number that moved in the database. Registered as a hook because v2db cannot
  // import this module without closing an import cycle — see setNumberChangeHook.
  //
  // In clustered mode the registry lives on the LEADER, so a renumber served by a
  // follower is forwarded rather than applied locally, where it would be a silent
  // no-op. The client-side self-heal covers the remaining case that no server hook
  // can: the operator CLI writes straight to MySQL and never reaches the server.
  setNumberChangeHook((e) => {
    if (!clustered || isLeader()) {
      rebindRegisteredPin(reg, e);
    } else {
      clusterForwardRenumber(e);
    }
    // Tell the person's own tabs their number moved, so every surface showing it
    // converges without a reload. Fans by identityId, which is why it does not
    // depend on the number being announced — the old one is retired the moment the
    // transaction commits. Best-effort: this is a UI refresh, and the rebind above
    // is what actually keeps them reachable.
    try {
      publishToIdentity(e.identityId, {
        kind: "number",
        number: e.newNumber,
        previousNumber: e.oldNumber,
      });
    } catch {
      /* the client's focus refetch is the backstop */
    }
  });
  // Round 11: the durable shadow of the room registry. Completely dormant until
  // relayCluster hands it a fence epoch, which only ever happens on winning the
  // leadership lease — so a single-process deploy writes nothing.
  initRoomStore({
    snapshotOf: (roomId) => snapshotRoom(reg, roomId),
    liveRoomIds: () => Array.from(reg.rooms.keys()),
  });

  // ── Cross-instance signaling (phase 2), gated on clusterEnabled()
  //    (RELAY_CLUSTER=1 + REDIS_URL). OFF ⇒ everything here is dormant and the
  //    endpoints take the unchanged single-process path. ON ⇒ the elected leader
  //    runs THIS reg on virtual sockets, every instance keeps its live SSE
  //    sockets in localDelivery and proxies to/from the leader over Redis. See
  //    docs-cross-instance-signaling.md. ──
  const clustered = clusterEnabled();
  // cid -> this instance's live SSE socket (home role: deliver leader-routed
  // objects to the actual browser).
  const localDelivery = new Map<string, RelaySocket>();
  // cid -> home instance id (leader role: route a virtual socket's sends back to
  // the instance the peer is connected to).
  const homeOf = new Map<string, string>();

  // Leader-side processing of a forwarded frame. Runs the SAME registry +
  // handleMessage as the local path, but on a VIRTUAL socket per remote peer.
  function leaderProcess(cid: string, home: string, raw: unknown, proxy = false): void {
    // A PROXIED frame comes from an instance that does NOT hold this cid's SSE
    // stream (the load balancer sent the POST to the wrong box). It cannot know
    // the home, so its claim is ignored entirely and the home we already
    // recorded wins. No recorded home ⇒ nothing could receive a reply anyway, so
    // drop rather than bind the cid to an instance with no stream — doing that
    // would send every subsequent reply into a black hole.
    if (proxy) {
      if (!homeOf.has(cid)) return;
    } else {
      homeOf.set(cid, home);
    }
    let conn = reg.connections.get(cid);
    if (!conn) {
      const vsock = makeRemoteSocket(
        cid,
        (c, obj) => clusterDeliverOutbound(homeOf.get(c) ?? home, c, obj),
        () => { /* leader-side teardown is driven by __disconnect below */ }
      );
      conn = { cid, socket: vsock, pin: null };
      reg.connections.set(cid, conn);
    }
    const c = conn;
    const t = (raw as { type?: unknown } | null)?.type;
    if (t === "__connect") {
      // Re-bind to an existing (grace-window) client so a reconnect keeps its
      // number/room/call — the leader owns that state.
      bindReconnect(reg, cid, c.socket);
    } else if (t === "__disconnect") {
      cleanupRegistryConn(reg, cid, c, onMissedCall);
      homeOf.delete(cid);
    } else if (t === "__renumber") {
      // RENUMBER REBIND, routed to the leader (v2.99.83). The registry lives ONLY
      // here, but a renumber can be served by any instance, so applying it locally
      // on a follower would be a silent no-op.
      //
      // Two properties come free from arriving through this path, both wanted:
      // `dispatchInbound` queues behind the hydration gate, so a rebind landing
      // mid-hydration is applied AFTER it — required, because hydration would
      // otherwise restore the old pin on top of the rename; and the anti-spoof home
      // check has already run.
      const r = raw as { identityId?: unknown; oldNumber?: unknown; newNumber?: unknown };
      if (
        typeof r.identityId === "number" &&
        typeof r.oldNumber === "string" &&
        typeof r.newNumber === "string"
      ) {
        rebindRegisteredPin(reg, {
          identityId: r.identityId,
          oldNumber: r.oldNumber,
          newNumber: r.newNumber,
        });
      }
    } else {
      handleMessage(
        reg,
        { socket: c.socket, pin: c.pin, cid, setPin: (p: string) => { c.pin = p; } },
        raw as RelayMessage,
        onInvite,
        onMissedCall,
        onPageCallee,
        onResolveDial
      );
    }
  }

  if (clustered) {
    startClusterRuntime({
      onInbound: leaderProcess,
      onOutbound: (cid, obj) => { localDelivery.get(cid)?.send(obj); },
      // LEADER: read the room registry back from Redis before serving anything.
      onHydrate: async () => {
        const rooms = await hydrateRooms();
        const n = applyHydratedRooms(reg, rooms);
        if (n) console.log(`[relay] hydrated ${n} room(s) from Redis on taking leadership`);
      },
      // HOME: leadership moved. The new leader has our ROOMS (it just hydrated)
      // but not our CLIENTS — a client record owns a live socket, and the socket
      // lives here. Ask each local browser to re-register, which is the existing,
      // well-tested path that rebuilds the client record and then hands back a
      // `rejoin` from the hydrated membership. Old clients that don't know
      // `resync` simply ignore it and are no worse off than before this round.
      onLeaderChanged: () => {
        localDelivery.forEach((sock) => safeSend(sock, { type: "resync" }));
      },
      liveCids: () => Array.from(localDelivery.keys()),
      // LEADER: a home instance stopped beating. Its browsers are unreachable,
      // but they are NOT necessarily gone — the instance may be restarting and
      // they will reconnect elsewhere. So run the ORDINARY disconnect path,
      // which gives each of them RELAY_DISCONNECT_GRACE_MS to come back and
      // keeps their call membership meanwhile. Silently deregistering them (the
      // pre-Round-11 behaviour) ended every one of those calls instantly.
      onHomeLost: (cids) => {
        for (const cid of cids) {
          const conn = reg.connections.get(cid);
          if (!conn) continue;
          cleanupRegistryConn(reg, cid, conn, onMissedCall);
          reg.connections.delete(cid);
          homeOf.delete(cid);
        }
      },
    });
  }

  // ── Abuse hardening for the UNAUTHENTICATED endpoints (v2.88) ──
  // Both gates honor RELAY_RATELIMIT_OFF like the /send limiter. Limits are
  // generous: a real client opens ONE stream and reconnects with backoff; only
  // a flood or a connection-exhaustion attack ever trips them.
  const rateLimitOff = () => process.env.RELAY_RATELIMIT_OFF === "1";
  // Stream OPENS per IP: 30 burst, 1/s sustained (reconnect storms stay under).
  const streamOpenLimiter = createRateLimiter({ capacity: 30, refillPerSec: 1 });
  // ICE probes per IP: 10 burst, 1 every 2s sustained.
  const iceLimiter = createRateLimiter({ capacity: 10, refillPerSec: 0.5 });
  setInterval(() => {
    const now = Date.now();
    streamOpenLimiter.sweep(now, 10 * 60_000);
    iceLimiter.sweep(now, 10 * 60_000);
  }, 10 * 60_000).unref();
  // cidToPin backstop reaper: a cid that disconnects while its pin is in an
  // ACTIVE call is deliberately KEPT — including its reg.clients entry being
  // removed — so a reconnect with the same cid can auto-rejoin the call (see
  // cleanupRegistryConn's in-call branch). If that client never reconnects,
  // the room eventually reaps (clearing pinRoom) but nothing else ever removes
  // the now-inert cidToPin entry — an unbounded, if slow, per-cid memory leak.
  // A pin with NO live client AND NO active-or-held room has nothing left to
  // reconnect into; only THEN is its cidToPin entry safe to purge (checking
  // `clients` alone would wrongly delete entries mid-legitimate-reconnect-
  // window, since clients.delete(pin) runs immediately on disconnect even
  // while the room — and the reconnect opportunity — is still alive).
  setInterval(() => {
    const stale: string[] = [];
    reg.cidToPin.forEach((pin, cid) => {
      if (!reg.clients.has(pin) && !reg.pinRoom.has(pin) && !reg.heldRoom.has(pin)) {
        stale.push(cid);
      }
    });
    stale.forEach((cid) => reg.cidToPin.delete(cid));
  }, 15 * 60_000).unref();
  // Concurrent SSE streams per IP — each open stream holds a socket + timer,
  // so an attacker opening thousands exhausts the instance.
  //
  // v2.99.57: raised from 25, which was NOT "far above any legitimate device
  // count". It is per-IP, and any shared egress puts a whole population behind one
  // address — carrier CGNAT, an office, a school, a café. Every open tab holds one
  // stream here AND one on /api/v2/events, so ~12 tabs across all users on that IP
  // exhausted it, and the refusal is a hard 429 that leaves those users unable to
  // call at all. This is the same misjudgement already corrected twice (the media
  // proxy 240→600, `guestMintGate`). The FLOOD defence is `streamOpenLimiter`
  // (30 burst / 1-per-second per IP), which is unchanged; this ceiling only exists
  // to bound total held sockets, so it can be an order of magnitude higher without
  // weakening anything.
  const MAX_STREAMS_PER_IP = 250;
  const streamsPerIp = new Map<string, number>();

  // Public ICE config endpoint. Returns fresh, time-limited TURN/STUN
  // credentials so browser-side tools (e.g. the /turn-test page) can probe the
  // operator coturn with VALID use-auth-secret credentials instead of stale
  // static ones. Anonymous ⇒ rate-limited, and the creds are SHORT-lived
  // (300s) — plenty for a probe, useless for freeloading relay bandwidth.
  app.get("/api/relay/ice", (req: Request, res: Response) => {
    if (!rateLimitOff() && !iceLimiter.allow(clientIpOf(req), Date.now())) {
      res.status(429).json({ error: "rate_limited" });
      return;
    }
    const who = String(req.query.u || "probe-" + Math.random().toString(36).slice(2, 8));
    res.json({ iceServers: iceServers(who, 300) });
  });

  // SSE channel: long-lived response that streams JSON-encoded server -> client
  // messages. Each event line is `data: <json>\n\n`.
  app.get("/api/relay/stream", (req: Request, res: Response) => {
    const cid = String(req.query.cid || "");
    // cid is client-minted (a 32-hex localStorage value) — reject the absent
    // and the absurd (a multi-KB cid would bloat every registry map key).
    if (!cid || cid.length > 200) {
      res.status(400).json({ error: "missing or oversized cid" });
      return;
    }
    const ip = clientIpOf(req);
    if (!rateLimitOff()) {
      if (!streamOpenLimiter.allow(ip, Date.now())) {
        res.status(429).json({ error: "rate_limited" });
        return;
      }
      // A RECONNECT of a cid we already hold REPLACES its stream rather than
      // adding one (the old socket is closed a few lines below), so it must not be
      // measured against the ceiling. Counting it first is why a plain tab refresh
      // at the limit used to be refused — the user's own stream blocked them.
      const isReplacement = clustered ? localDelivery.has(cid) : reg.connections.has(cid);
      if (!isReplacement && (streamsPerIp.get(ip) ?? 0) >= MAX_STREAMS_PER_IP) {
        res.status(429).json({ error: "too_many_streams" });
        return;
      }
    }
    // Count this stream against the IP. Decrement EXACTLY ONCE whichever way
    // the stream dies — cleanup() (client drop) or socket.close() (server-side
    // replacement on cid reconnect, which bypasses cleanup via `closed`).
    streamsPerIp.set(ip, (streamsPerIp.get(ip) ?? 0) + 1);
    let counted = true;
    const uncountStream = () => {
      if (!counted) return;
      counted = false;
      const n = (streamsPerIp.get(ip) ?? 1) - 1;
      if (n <= 0) streamsPerIp.delete(ip);
      else streamsPerIp.set(ip, n);
    };
    // If the same cid reconnects (e.g. tab refresh), close the old channel.
    // Clustered: the home tracks its live socket in localDelivery (the leader
    // owns reg.connections); closing the OLD local socket sets its `closed`
    // flag, which no-ops the old cleanup — so no spurious __disconnect races the
    // reconnect's __connect (mirrors the single-process identity+closed guard).
    if (clustered) {
      const prevLocal = localDelivery.get(cid);
      if (prevLocal) {
        try { prevLocal.close(); } catch { /* noop */ }
      }
    } else {
      const prev = reg.connections.get(cid);
      if (prev) {
        try {
          prev.socket.close();
        } catch {
          /* noop */
        }
      }
    }

    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no"); // disable proxy buffering
    res.flushHeaders?.();

    let closed = false;
    // Declared here so `close()` can clear it directly. When the server closes
    // an old channel on reconnect, it sets `closed = true` before the res-close
    // event reaches `cleanup()` — which then early-returns on `if (closed)` and
    // never clears the interval. That leaks one 15s timer per reconnect. Clear
    // it in BOTH paths so neither leaks.
    let hb: ReturnType<typeof setInterval> | null = null;
    const socket: RelaySocket = {
      send: (obj: unknown) => {
        if (closed) return;
        try {
          res.write("data: " + JSON.stringify(obj) + "\n\n");
        } catch {
          /* noop */
        }
      },
      close: () => {
        if (closed) return;
        closed = true;
        if (hb) { clearInterval(hb); hb = null; }
        uncountStream();
        try {
          res.end();
        } catch {
          /* noop */
        }
      },
      // Lets the invite path spot a dead-but-in-grace callee (backgrounded
      // phone) and page them instead of ringing into a closed stream.
      alive: () => !closed,
    };

    const conn: RelayConnection = { cid, socket, pin: null };
    if (clustered) {
      // Home role: register the live socket for delivery; the LEADER does the
      // registry re-bind via the forwarded __connect.
      localDelivery.set(cid, socket);
      clusterForwardInbound(cid, { type: "__connect" });
    } else {
      reg.connections.set(cid, conn);
      // Reconnect re-binding: keep number/room/call across a proxy-cut SSE.
      // Extracted so the cross-instance leader reuses it on a __connect.
      bindReconnect(reg, cid, socket);
    }

    // Send a ready event so the client can flip state.
    safeSend(socket, { type: "ready" });

    // Keep-alive heartbeat (comment line every 25s; passes through Cloudflare,
    // Cloud Run, and most proxies without timing out).
    hb = setInterval(() => {
      if (closed) return;
      try {
        res.write(": ping\n\n");
      } catch {
        /* noop */
      }
    }, 15_000);

    const cleanup = () => {
      if (closed) return;
      closed = true;
      if (hb) { clearInterval(hb); hb = null; }
      uncountStream();
      if (clustered) {
        // Home role: tear down + forward __disconnect ONLY if THIS socket is
        // still the current one (a reconnect that replaced it already forwarded
        // its own __connect; the `closed` flag also no-ops a server-initiated
        // close). Mirrors the single-process identity guard.
        if (localDelivery.get(cid) === socket) {
          localDelivery.delete(cid);
          clusterForwardInbound(cid, { type: "__disconnect" });
        }
      } else {
        // Registry teardown (delete conn, drop device, arm the grace/reap timer),
        // extracted so the cross-instance leader reuses it on a __disconnect.
        cleanupRegistryConn(reg, cid, conn, onMissedCall);
      }
      try {
        res.end();
      } catch {
        /* noop */
      }
    };

    req.on("close", cleanup);
    req.on("aborted", cleanup);
    res.on("close", cleanup);
  });

  // Inbound messages from the client.
  app.post("/api/relay/send", async (req: Request, res: Response) => {
    const body = req.body || {};
    const cid = String(body.cid || "");
    const message = body.message;
    if (!cid || cid.length > 200 || typeof message !== "object" || message === null) {
      res.status(400).json({ error: "bad request" });
      return;
    }
    // SECURITY (F1): `__ownedNumber` is a SERVER-ONLY field. Strip any value a
    // client tried to inject BEFORE we (maybe) set it, so it can never be forged
    // through this endpoint or the cluster forward. For a `register`, resolve the
    // caller's real identity number from their cookie and stamp it — the register
    // handler binds the claimed pin to it. Resolution failures fail CLOSED (null
    // ⇒ a fresh number is allocated), never open. Only `register` pays the
    // identity-resolution cost; every other signaling message operates on the
    // pin already bound at register time.
    delete (message as Record<string, unknown>).__ownedNumber;
    delete (message as Record<string, unknown>).__clientIp;
    if ((message as RelayMessage).type === "register") {
      let owned: string | null = null;
      try {
        const ctx = await createContext({ req, res } as Parameters<typeof createContext>[0]);
        owned = ctx.identity?.number ?? null;
      } catch {
        owned = null;
      }
      (message as RelayMessage).__ownedNumber = owned;
      // v2.99.49: also record the ADDRESS, so a caller with no verified identity
      // is budgeted per-IP instead of per-pin (which they can re-mint freely).
      try {
        (message as RelayMessage).__clientIp = clientIpOf(req);
      } catch {
        (message as RelayMessage).__clientIp = null;
      }
    }
    // Cap signaling payload size. SDP/ICE/control messages are all small (a big
    // SDP is ~10-20 KB; the in-call chat rides the WebRTC data channel, NOT this
    // endpoint), so 256 KB is generous headroom while rejecting abusive floods.
    let approxLen = 0;
    try { approxLen = JSON.stringify(message).length; } catch { approxLen = Infinity; }
    if (approxLen > 256_000) {
      res.status(413).json({ error: "payload_too_large" });
      return;
    }
    if (clustered) {
      // Home role: the browser is homed here (localDelivery), but the registry
      // runs on the leader — forward the message; any reply comes back over SSE.
      if (!localDelivery.has(cid)) {
        // INSTANCE AFFINITY (v2.99.59). The SSE stream and this POST are
        // separate HTTP requests, so a load balancer with no stickiness routes
        // them to DIFFERENT instances — measured against production: 12 of 24
        // POSTs landed on the box with no stream for the cid. This used to
        // answer 404 and drop the message on the floor; the client retries 3
        // times, so ~6% were lost outright and the rest delayed by seconds, on
        // the offer/answer/ICE path where that is call-fatal. Hand it to the
        // leader instead, which knows the real home and routes the reply there.
        //
        // TRADE-OFF, recorded deliberately: an instance that is not the home
        // cannot distinguish "homed elsewhere" from "no such cid", so a dead
        // channel now also gets 200 instead of 404. Nothing regresses — the
        // client never treated 404 as a signal (it retries blindly and the SSE
        // close is what drives reconnect), and a dead channel's message was
        // undeliverable either way. It also removes a cid-existence oracle,
        // since the response is now uniform. Restoring the distinction would
        // mean mirroring cid→home into Redis; an ALB stickiness policy is the
        // cheaper cure and is the documented ops follow-up.
        clusterProxyInbound(cid, message);
        res.json({ ok: true, proxied: true });
        return;
      }
      clusterForwardInbound(cid, message);
      res.json({ ok: true });
      return;
    }
    const conn = reg.connections.get(cid);
    if (!conn) {
      res.status(404).json({ error: "channel not found" });
      return;
    }
    handleMessage(
      reg,
      {
        socket: conn.socket,
        pin: conn.pin,
        cid,
        setPin: (p: string) => {
          conn.pin = p;
        },
      },
      message as RelayMessage,
      onInvite,
      onMissedCall,
      onPageCallee,
      onResolveDial
    );
    res.json({ ok: true });
  });

  const _ts = process.env.TURN_SECRET;
  const _th = process.env.TURN_HOST;
  console.log(
    "[relay] HTTP signaling ready on /api/relay/{stream,send} — TURN " +
      (_ts && _th
        ? "enabled via operator coturn at " + _th
        : process.env.RELAY_DISABLE_PUBLIC_TURN === "1"
          ? "NOT configured (STUN only)"
          : "using free public fallback (openrelay.metered.ca) — set TURN_SECRET+TURN_HOST for your own coturn")
  );

  return reg;
}
