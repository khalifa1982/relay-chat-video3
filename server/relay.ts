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
import { AccessToken, type VideoGrant } from "livekit-server-sdk";
import {
  recordingConfig,
  startRoomRecording,
  stopRoomRecording,
} from "./recording";
import { createRateLimiter, clientIpOf } from "./rateLimit";
import { createContext } from "./_core/context";

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
  clusterDeliverOutbound,
  makeRemoteSocket,
} from "./relayCluster";

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
}

export interface RelayConnection {
  cid: string;          // opaque per-tab id chosen by the client
  socket: RelaySocket;
  pin: string | null;   // assigned 6-digit number after `register`
}

export interface RoomRecording {
  egressId: string;
  by: string;   // pin that started it
  key: string;  // S3 object key
  startedAt: number;
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
}

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
  participants: Array<{ pin: string; name: string }>;
}) => void;

export interface RelayRegistry {
  clients: Map<string, RelayClient>;          // pin   -> primary (in-call) client
  rooms: Map<string, Set<string>>;            // rid   -> set<pin>
  connections: Map<string, RelayConnection>;  // cid   -> connection
  cidToPin: Map<string, string>;              // cid   -> last assigned pin
  recordings: Map<string, RoomRecording>;     // rid   -> active recording
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
}

export interface PendingRing {
  from: string;      // caller pin
  roomId: string;    // the caller's dial room the accept must target
  video: boolean;    // mutual-consent flow: was this dialed as a video call?
  at: number;        // unix ms when the invite was dispatched
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
    recordings: new Map(),
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
  room.add(pin);
  reg.pinRoom.set(pin, roomId);
  const t = reg.roomReapT.get(roomId);
  if (t) { clearTimeout(t); reg.roomReapT.delete(roomId); }
  // Busy-line mirror (v2.91): a coalesced next-tick sync, so an accept that
  // joins + flips roomMeta.accepted in the same handler is observed settled.
  touchBusyState();
}

/** Fully tear down a room (abandoned, or last member explicitly left). */
function reapRoom(reg: RelayRegistry, roomId: string) {
  touchBusyState(); // busy-line + party-line-count mirror (v2.91)
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
  const rec = reg.recordings.get(roomId);
  if (rec) {
    reg.recordings.delete(roomId);
    if (rec.egressId) stopRoomRecording(rec.egressId).catch(() => { /* best-effort */ });
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
 * abandonment timer, restore the live roomId, send the current member list, and
 * (SFU) mint a fresh join token. Forward declarations `livekitConfig`,
 * `iceServers`, `pushLivekitToken` are defined below in the same module.
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
  const lk = livekitConfig();
  safeSend(socket, {
    type: "rejoin",
    roomId: rid,
    members,
    selfRole: roleOf(rmeta, pin),
    hostPin: rmeta?.hostPin ?? null,
    iceServers: iceServers(pin),
    livekit: lk.enabled,
    livekitUrl: lk.url,
  });
  pushLivekitToken(reg, pin, rid);
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
  const cap = livekitConfig().enabled ? 10 : 6;
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
  const lk = livekitConfig();
  pushLivekitToken(reg, pin, roomId);
  safeSend(joiner.socket, {
    type: "joined",
    roomId,
    members,
    selfRole: roleOf(meta, pin),
    hostPin: meta.hostPin ?? null,
    iceServers: iceServers(pin),
    livekit: lk.enabled,
    livekitUrl: lk.url,
  });
  const activeRec = reg.recordings.get(roomId);
  if (activeRec) safeSend(joiner.socket, { type: "recording", on: true, by: activeRec.by });
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
        livekit: lk.enabled,
        livekitUrl: lk.url,
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

function safeSend(socket: RelaySocket, obj: unknown) {
  try {
    socket.send(obj);
  } catch {
    /* ignore broken pipe */
  }
}

export function genPin(reg: RelayRegistry): string {
  let pin: string;
  do {
    pin = String(Math.floor(100000 + Math.random() * 900000));
  } while (reg.clients.has(pin));
  return pin;
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
  const TURN_HOST = process.env.TURN_HOST || "";
  // The relay's UDP and TCP listeners may sit behind different public IPs
  // (e.g. two separate Layer-4 load balancers). TURN_TCP_HOST overrides the
  // host used for the TCP/TLS candidates; it falls back to TURN_HOST.
  const TURN_TCP_HOST = process.env.TURN_TCP_HOST || TURN_HOST;
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
    // UDP relay (primary path) on the UDP load balancer IP.
    list.push({ urls: "turn:" + TURN_HOST + ":" + TURN_PORT + "?transport=udp", username, credential });
    // TURN over TCP on port 443 (firewall/CGNAT-penetrating fallback). Port 443
    // is virtually never blocked, so this path connects even on mobile/carrier
    // and corporate networks that drop UDP and non-standard TCP ports like 3478.
    // The L4 load balancer maps external 443 -> coturn 3478, so no coturn change
    // is needed and relay media tunnels back to the client over this same TCP
    // connection. This is the key fix for calls hanging on "connecting...".
    const TURN_TCP_ALT_PORT = process.env.TURN_TCP_ALT_PORT || "443";
    list.push({ urls: "turn:" + TURN_TCP_HOST + ":" + TURN_TCP_ALT_PORT + "?transport=tcp", username, credential });
    // TCP relay on the standard port (additional fallback) on the TCP LB IP.
    list.push({ urls: "turn:" + TURN_TCP_HOST + ":" + TURN_PORT + "?transport=tcp", username, credential });
    // TLS relay only when a certificate is actually provisioned on coturn,
    // otherwise the turns: candidate just wastes time failing the handshake.
    if (TURN_TLS) {
      list.push({ urls: "turns:" + TURN_TCP_HOST + ":" + TURN_TLS_PORT + "?transport=tcp", username, credential });
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
 * LiveKit SFU (optional, feature-gated like TURN). When LIVEKIT_URL +
 * LIVEKIT_API_KEY + LIVEKIT_API_SECRET are all set, call MEDIA is routed through
 * the LiveKit SFU (10-way, recording-capable) instead of the WebRTC mesh. The
 * SSE relay below stays the "phone" (presence + ring/accept/leave + roomId);
 * LiveKit only replaces the per-peer RTCPeerConnection mesh. When unset, the
 * mesh runs unchanged. Env is read per-call so creds can be added via Manus
 * Secrets without a restart (same pattern as iceServers()).
 * ────────────────────────────────────────────────────────────────────────── */
export function livekitConfig(): { enabled: boolean; url: string } {
  const url = process.env.LIVEKIT_URL || "";
  const key = process.env.LIVEKIT_API_KEY || "";
  const secret = process.env.LIVEKIT_API_SECRET || "";
  return { enabled: !!(url && key && secret), url };
}

/**
 * Mint a short-lived (60s) LiveKit join token for ONE room + identity, minted
 * server-side from registry state we control — never from client-supplied
 * room/identity. The API secret is the HMAC key and must NEVER reach the
 * browser (only this signed JWT does). `toJwt()` is async in v2.
 */
export async function mintLivekitToken(
  identity: string,
  name: string,
  room: string
): Promise<string> {
  const apiKey = process.env.LIVEKIT_API_KEY || "";
  const apiSecret = process.env.LIVEKIT_API_SECRET || "";
  const at = new AccessToken(apiKey, apiSecret, { identity, name, ttl: 60 });
  const grant: VideoGrant = {
    roomJoin: true,
    room,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  };
  at.addGrant(grant);
  return await at.toJwt();
}

/**
 * Fire-and-forget: mint a LiveKit join token for `pin` in `roomId` and push it
 * over that client's SSE channel as a `livekit-token` message. No-op when
 * LiveKit isn't configured. The JWT is never logged. Authorization is implicit:
 * the caller only ever passes pins/rooms derived from trusted registry state.
 */
function pushLivekitToken(reg: RelayRegistry, pin: string, roomId: string) {
  const lk = livekitConfig();
  if (!lk.enabled) return;
  const client = reg.clients.get(pin);
  if (!client) return;
  mintLivekitToken(pin, client.name || "Guest", roomId)
    .then(token => {
      const c = reg.clients.get(pin);
      if (c) safeSend(c.socket, { type: "livekit-token", roomId, token, url: lk.url });
    })
    .catch(e => console.warn("[relay] livekit token mint failed:", e));
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
export function leaveRoom(reg: RelayRegistry, pin: string) {
  touchBusyState(); // busy-line + party-line-count mirror (v2.91)
  const roomId = reg.pinRoom.get(pin) ?? reg.clients.get(pin)?.roomId ?? null;
  reg.pinRoom.delete(pin);
  const c = reg.clients.get(pin);
  if (c) c.roomId = null;
  if (!roomId) return;
  // This member was active up to now — stamp the room so its end time is right.
  roomActivityTouch(reg, roomId);
  const room = reg.rooms.get(roomId);
  if (room) {
    room.delete(pin);
    room.forEach(p => {
      const o = reg.clients.get(p);
      if (o) safeSend(o.socket, { type: "peer-left", pin });
    });
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
  if (self) self.roomId = heldRid;
  const t = reg.roomReapT.get(heldRid);
  if (t) { clearTimeout(t); reg.roomReapT.delete(heldRid); }
  roomActivityTouch(reg, heldRid);
  broadcastToRoom(reg, heldRid, { type: "peer-hold", pin, on: false }, pin);
  const rmeta = reg.roomMeta.get(heldRid);
  const lk = livekitConfig();
  safeSend(conn.socket, {
    type: "resumed",
    roomId: heldRid,
    members: membersOf(reg, heldRid, pin),
    selfRole: roleOf(rmeta, pin),
    hostPin: rmeta?.hostPin ?? null,
    iceServers: iceServers(pin),
    livekit: lk.enabled,
    livekitUrl: lk.url,
  });
  pushLivekitToken(reg, pin, heldRid);
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
  const cap = livekitConfig().enabled ? 10 : 6;
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
  safeSend(socket, { type: "room", roomId: rid, partyLine: true, hostPin: null });
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
  const lk = livekitConfig();
  safeSend(socket, {
    type: "joined",
    roomId: rid,
    members,
    partyLine: true,
    lineTitle: title,
    hostPin: null,
    iceServers: iceServers(callerPin),
    livekit: lk.enabled,
    livekitUrl: lk.url,
  });
  pushLivekitToken(reg, callerPin, rid);
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
        livekit: lk.enabled,
        livekitUrl: lk.url,
      });
    }
  });
  // An active recording on the line is disclosed to the newcomer (consent).
  const activeRec = reg.recordings.get(rid);
  if (activeRec) safeSend(socket, { type: "recording", on: true, by: activeRec.by });
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
}

export type InviteHook = (info: {
  fromPin: string;
  fromName: string;
  toPin: string;
  roomId: string;
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
 * identity's subscribed devices (Web Push). The relay then PAGES: it keeps the
 * dial alive so the callee can open the app and receive the ring late
 * (deliverPendingRing), instead of instantly bouncing the caller with
 * "offline". Resolving { exists: false } (or rejecting) falls back to the
 * classic offline error.
 */
export type PageCalleeHook = (info: {
  calleePin: string;
  callerPin: string;
  callerName: string;
  roomId: string;
  video: boolean;
}) => Promise<{ exists: boolean; name?: string } | null>;

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
        const lk = livekitConfig();
        safeSend(conn.socket, { type: "registered", pin: conn.pin, name: existing.name, iceServers: iceServers(conn.pin), livekit: lk.enabled, livekitUrl: lk.url, recording: recordingConfig().enabled });
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
    if ("__ownedNumber" in msg) {
      const owned = msg.__ownedNumber;
      requested = typeof owned === "string" && /^\d{6}$/.test(owned) ? owned : undefined;
    }

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
      if (msg.device) prev.device = String(msg.device).slice(0, 16);
      if (msg.flag) prev.flag = String(msg.flag).slice(0, 8);
    } else {
      // ctxEpoch is seeded at creation so a continuation captured under a
      // DELETED record (whose ctxEpoch was undefined-or-older) can never
      // match this new record's generation and ghost-ring under it.
      reg.clients.set(pin, { socket: conn.socket, name, device: msg.device ? String(msg.device).slice(0, 16) : undefined, flag: msg.flag ? String(msg.flag).slice(0, 8) : undefined, roomId: null, cid: cid || null, graceT: null, ringing: new Set(), ctxEpoch: ++dialEpochSeq });
    }
    const lk = livekitConfig();
    safeSend(conn.socket, { type: "registered", pin, name, iceServers: iceServers(pin), livekit: lk.enabled, livekitUrl: lk.url, recording: recordingConfig().enabled });
    // AUTO-REJOIN an active call this number is still a member of (no re-invite).
    // Multi-device (v2.99.5): NOT when the call lives on another device that
    // kept the primary slot — sending the rejoin here dragged every freshly
    // opened secondary device straight into the primary's live call.
    if (!keptPrimaryElsewhere) sendRejoinIfInRoom(reg, conn.socket, pin);
    // Deliver any ring that's still live for this number: a reload mid-ring, or
    // a PAGED offline device the user just opened from the push notification.
    // Sent to THIS device's socket (a multi-device secondary must ring here,
    // not on the primary that is already ringing).
    deliverPendingRing(reg, pin, conn.socket);
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
      const callerPin = conn.pin;
      const callerSocket = conn.socket;
      const wantVideo = !!msg.video;
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
            });
            safeSend(callerSocket, { type: "room", roomId: rid, selfRole: "host", hostPin: callerPin });
            // On the LiveKit path, the caller joins the SFU room immediately (alone)
            // so the callee connects near-instantly the moment they accept.
            pushLivekitToken(reg, callerPin, rid);
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
          !!target && (!onPageCallee || !target.socket.alive || target.socket.alive());
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
          if (process.env.RELAY_RATELIMIT_OFF !== "1" && !offlineDialLimiter.allow(callerPin, Date.now())) {
            safeSend(callerSocket, {
              type: "error",
              code: "offline",
              pin: to,
              message: "They're offline right now.",
            });
            return;
          }
          onPageCallee({ calleePin: to, callerPin, callerName: me.name, roomId: "", video: wantVideo })
            .then(info => {
              // Stale-continuation guard — the SAME discipline the party-line
              // resolver applies at `settle` (line ~1526). onPageCallee awaits
              // the DB; while it's out the caller may have hung up or had their
              // channel taken over (both bump ctxEpoch). An identity dial keys on
              // ctxEpoch (a sibling group-dial invite moves only dialEpoch, so
              // those coexist). A moved epoch ⇒ this offline result belongs to a
              // dial that no longer exists — drop it, so we never fire a stray
              // error / phantom miss into the caller's NEW context.
              const callerNow = reg.clients.get(callerPin);
              if (!callerNow || callerNow.ctxEpoch !== ctxEpoch) return;
              if (info && info.exists) {
                safeSend(callerSocket, {
                  type: "error",
                  code: "offline",
                  pin: to,
                  message: (info.name || "They") + " is offline right now.",
                });
                // Record the miss → History + (pref-gated) missed-call email on return.
                try {
                  onMissedCall?.({ calleePin: to, callerPin, callerName: me.name, reason: "cancelled" });
                } catch { /* never let a notification hook break call setup */ }
              } else {
                safeSend(callerSocket, { type: "error", code: "nonexistent", message: "That number doesn't exist." });
              }
            })
            .catch(() => {
              const callerNow = reg.clients.get(callerPin);
              if (!callerNow || callerNow.ctxEpoch !== ctxEpoch) return;
              safeSend(callerSocket, { type: "error", code: "offline", message: "They're offline right now." });
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
        const inviteCap = livekitConfig().enabled ? 10 : 6;
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
      const acceptCap = livekitConfig().enabled ? 10 : 6;
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
      // On the LiveKit path, the newcomer joins the SFU room; LiveKit's own
      // ParticipantConnected/TrackSubscribed events drive peer discovery, so the
      // mesh peer-joined/offer dance is skipped client-side.
      pushLivekitToken(reg, conn.pin, roomId);
      const lk = livekitConfig();
      // Newcomer learns existing members and will offer to each (only one
      // side ever offers, which avoids SDP glare in the mesh). Fresh ICE
      // servers keyed to this peer are minted right as it's about to build
      // its peer connections — never the stale register-time set.
      safeSend(conn.socket, {
        type: "joined",
        roomId,
        members,
        selfRole: roleOf(roomMetaForRoles, conn.pin),
        hostPin: roomMetaForRoles?.hostPin ?? null,
        iceServers: iceServers(conn.pin),
        livekit: lk.enabled,
        livekitUrl: lk.url,
      });
      // If this room is already being recorded, tell the newcomer right away so
      // they see the REC indicator (consent/transparency — they joined after the
      // start broadcast).
      const activeRec = reg.recordings.get(roomId);
      if (activeRec) safeSend(conn.socket, { type: "recording", on: true, by: activeRec.by });
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
            livekit: lk.enabled,
            livekitUrl: lk.url,
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
      const host = info.hostPin ? reg.clients.get(info.hostPin) : null;
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
      if (!meta || !room || !isModerator(meta, conn.pin) || !room.has(conn.pin)) break;
      if (!meta.knocks || !meta.knocks.has(knockerPin)) break;
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

    case "refresh-livekit": {
      // Client lost or never received its SFU token (mint failure / dropped SSE
      // frame / connect failure). Re-mint for its CURRENT room, derived from
      // trusted server state — never a client-supplied room name.
      if (self.roomId) pushLivekitToken(reg, conn.pin, self.roomId);
      break;
    }

    case "start-recording": {
      const rid = self.roomId;
      if (!recordingConfig().enabled) {
        safeSend(conn.socket, { type: "recording-error", message: "Recording isn't set up on this server." });
        break;
      }
      if (!rid) break;
      const existing = reg.recordings.get(rid);
      if (existing) {
        safeSend(conn.socket, { type: "recording", on: true, by: existing.by });
        break;
      }
      // Reserve the slot SYNCHRONOUSLY so a double-tap (or a second participant)
      // can't kick off two egresses for the same room while we await the SDK.
      reg.recordings.set(rid, { egressId: "", by: conn.pin, key: "", startedAt: Date.now() });
      broadcastToRoom(reg, rid, { type: "recording", on: true, by: conn.pin });
      startRoomRecording(rid, Date.now())
        .then(({ egressId, key }) => {
          const cur = reg.recordings.get(rid);
          // Room ended (or slot cleared) while we awaited — undo.
          if (!cur || !reg.rooms.has(rid)) {
            stopRoomRecording(egressId).catch(() => { /* */ });
            reg.recordings.delete(rid);
            return;
          }
          cur.egressId = egressId;
          cur.key = key;
        })
        .catch(e => {
          console.warn("[relay] start recording failed:", e);
          reg.recordings.delete(rid);
          broadcastToRoom(reg, rid, { type: "recording", on: false });
          safeSend(conn.socket, { type: "recording-error", message: "Couldn't start the recording." });
        });
      break;
    }

    case "stop-recording": {
      const rid = self.roomId;
      if (!rid) break;
      const rec = reg.recordings.get(rid);
      if (!rec) break;
      reg.recordings.delete(rid);
      broadcastToRoom(reg, rid, { type: "recording", on: false });
      if (rec.egressId) stopRoomRecording(rec.egressId).catch(e => console.warn("[relay] stop recording failed:", e));
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
      const shares =
        (!!activeRid && reg.rooms.get(activeRid)?.has(to)) ||
        (!!heldRid && reg.rooms.get(heldRid)?.has(to));
      if (!shares) break;
      safeSend(target.socket, {
        type: "signal",
        from: conn.pin,
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
      const t = reg.roomReapT.get(heldRid);
      if (t) { clearTimeout(t); reg.roomReapT.delete(heldRid); }
      roomActivityTouch(reg, heldRid);
      roomActivityTouch(reg, activeRid);
      broadcastToRoom(reg, heldRid, { type: "peer-hold", pin: conn.pin, on: false }, conn.pin);
      broadcastToRoom(reg, activeRid, { type: "peer-hold", pin: conn.pin, on: true }, conn.pin);
      const rmeta = reg.roomMeta.get(heldRid);
      const lk = livekitConfig();
      safeSend(conn.socket, {
        type: "resumed",
        roomId: heldRid,
        heldRoomId: activeRid,
        members: membersOf(reg, heldRid, conn.pin),
        selfRole: roleOf(rmeta, conn.pin),
        hostPin: rmeta?.hostPin ?? null,
        iceServers: iceServers(conn.pin),
        livekit: lk.enabled,
        livekitUrl: lk.url,
      });
      pushLivekitToken(reg, conn.pin, heldRid);
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
      const lkm = livekitConfig();
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
            selfRole: roleOf(activeMeta, p),
            hostPin: activeMeta?.hostPin ?? null,
            iceServers: iceServers(p),
            livekit: lkm.enabled,
            livekitUrl: lkm.url,
          });
          pushLivekitToken(reg, p, activeRid);
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
      safeSend(conn.socket, { type: "merged", roomId: activeRid, members: membersOf(reg, activeRid, conn.pin) });
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
      switch (action) {
        case "mute":
        case "unmute": {
          if (!room.has(target)) break;
          sendTo(target, { type: "force-mute", on: action === "mute", by: conn.pin });
          break;
        }
        case "mute-all":
        case "unmute-all": {
          const on = action === "mute-all";
          room.forEach(p => { if (p !== conn.pin) sendTo(p, { type: "force-mute", on, by: conn.pin }); });
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
          sendTo(target, { type: "kicked", by: conn.pin });
          leaveRoom(reg, target); // removes membership + broadcasts peer-left + reaps if empty
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
  onResolveDial?: ResolveDialHook
): RelayRegistry {
  const reg = createRegistry();
  reg.onConferenceEnd = onConferenceEnd;
  activeRegistry = reg; // busy-line reads (pinsInCall) target the live registry
  // Redis mirror of busy-line/party-line state (v2.91) — inert without
  // REDIS_URL. The provider closes over THIS registry, matching
  // activeRegistry's last-attach-wins semantics.
  initBusyStateSync(() => computeBusySnapshot(reg));

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
  function leaderProcess(cid: string, home: string, raw: unknown): void {
    homeOf.set(cid, home);
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
  // so an attacker opening thousands exhausts the instance. ~25 is far above
  // any legitimate device count behind one NAT hitting ONE Cloud Run instance.
  const MAX_STREAMS_PER_IP = 25;
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
      if ((streamsPerIp.get(ip) ?? 0) >= MAX_STREAMS_PER_IP) {
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
    if ((message as RelayMessage).type === "register") {
      let owned: string | null = null;
      try {
        const ctx = await createContext({ req, res } as Parameters<typeof createContext>[0]);
        owned = ctx.identity?.number ?? null;
      } catch {
        owned = null;
      }
      (message as RelayMessage).__ownedNumber = owned;
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
        res.status(404).json({ error: "channel not found" });
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
