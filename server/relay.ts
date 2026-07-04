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
  /** Set by attachRelay — fired from reapRoom when a real call ends. */
  onConferenceEnd?: ConferenceEndHook;
}

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
  };
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
}

/** Fully tear down a room (abandoned, or last member explicitly left). */
function reapRoom(reg: RelayRegistry, roomId: string) {
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
export function iceServers(userId: string): IceServer[] {
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
  const TURN_TTL = parseInt(process.env.TURN_TTL || "3600", 10);
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
    const callee = reg.clients.get(calleePin);
    if (callee) safeSend(callee.socket, { type: "ring-cancel", from: callerPin });
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
  onMissedCall?: MissedCallHook
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
        sendRejoinIfInRoom(reg, conn.socket, conn.pin);
      }
      return;
    }
    const name = String(msg.name || "Guest").slice(0, 24);
    const cid = conn.cid || "";
    let pin: string;

    // Prefer the pin this channel (cid) already owns, so a reconnect keeps the
    // same number even if a stale client entry is still being cleaned up.
    const ownedPin = cid ? reg.cidToPin.get(cid) : undefined;
    const requested = typeof msg.pin === "string" && /^\d{6}$/.test(msg.pin) ? msg.pin : undefined;

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
        leaveRoom(reg, ownedPin); // clears pinRoom membership + notifies peers
        reg.clients.delete(ownedPin);
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
    if (prev) {
      if (prev.graceT) { clearTimeout(prev.graceT); prev.graceT = null; }
      // Multi-device: if the existing PRIMARY is in a live call, a different
      // device registering the same number must NOT hijack the in-call routing
      // (the primary socket is where offer/answer/ice for that call flow). Keep
      // it; the newcomer is still tracked in `devices` for ringing. When the
      // flag is off (or it's the same cid, or the primary is idle) behaviour is
      // identical to before: the latest registration becomes primary.
      const keepPrimary = multiDevice && !!prev.roomId && prev.cid !== cid && prev.cid !== null;
      if (!keepPrimary) {
        prev.socket = conn.socket;
        prev.cid = cid || prev.cid;
      }
      prev.name = name;
      if (msg.device) prev.device = String(msg.device).slice(0, 16);
      if (msg.flag) prev.flag = String(msg.flag).slice(0, 8);
    } else {
      reg.clients.set(pin, { socket: conn.socket, name, device: msg.device ? String(msg.device).slice(0, 16) : undefined, flag: msg.flag ? String(msg.flag).slice(0, 8) : undefined, roomId: null, cid: cid || null, graceT: null, ringing: new Set() });
    }
    const lk = livekitConfig();
    safeSend(conn.socket, { type: "registered", pin, name, iceServers: iceServers(pin), livekit: lk.enabled, livekitUrl: lk.url, recording: recordingConfig().enabled });
    // AUTO-REJOIN an active call this number is still a member of (no re-invite).
    sendRejoinIfInRoom(reg, conn.socket, pin);
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
      const target = reg.clients.get(to);
      if (!target) {
        if (process.env.RELAY_DIAG === "1" || process.env.NODE_ENV === "development") {
          console.log(`[relay-diag]    invite -> ${to} REJECTED: target not registered (known pins: ${Array.from(reg.clients.keys()).join(",")})`);
        }
        safeSend(conn.socket, {
          type: "error",
          code: "offline",
          message: "That number doesn't exist or is offline.",
        });
        // The callee was offline — record the miss and (for registered users)
        // email them. The hook resolves identity from the DB by number, so it
        // works even though an offline callee has no in-memory registry entry.
        try {
          onMissedCall?.({ calleePin: to, callerPin: conn.pin, callerName: self.name, reason: "cancelled" });
        } catch { /* never let a notification hook break call setup */ }
        break;
      }
      // CALL WAITING: we no longer reject the caller as "busy" when the target is
      // already in another call. Instead the invite rings through and the callee's
      // client shows a call-waiting popup (Answer = put the current call on hold
      // and switch; Reject = decline). The callee decides — not the server. A
      // second concurrent waiter is rejected client-side. The only ring we still
      // suppress is one into a room the caller is ALREADY in (a redundant invite),
      // which the callee's client also ignores by roomId.
      if (
        target.roomId &&
        self.roomId &&
        target.roomId === self.roomId
      ) {
        // Target is already in THIS room — nothing to do.
        break;
      }
      if (!self.roomId) {
        const rid = newRoomId();
        joinRoomMember(reg, rid, conn.pin);
        self.roomId = rid;
        // Seed conference-history metadata: the caller is the first roster
        // member and `to` is the dialed number. `accepted` flips on the first
        // accept (below), so an unanswered dial is never logged as a conference.
        reg.roomMeta.set(rid, {
          startedAt: Date.now(),
          answeredAt: null,
          lastActiveAt: Date.now(),
          dialedNumber: to,
          accepted: false,
          roster: new Map([[conn.pin, self.name]]),
          hostPin: conn.pin, // the creator is the host
          cohosts: new Set(),
        });
        safeSend(conn.socket, { type: "room", roomId: rid, selfRole: "host", hostPin: conn.pin });
        // On the LiveKit path, the caller joins the SFU room immediately (alone)
        // so the callee connects near-instantly the moment they accept.
        pushLivekitToken(reg, conn.pin, rid);
      }
      // Whether the room is new or growing, make sure the caller is in the roster.
      rosterTouch(reg, self.roomId!, conn.pin, self.name);
      const room = reg.rooms.get(self.roomId!);
      // 10-way only on the SFU; the mesh fallback stays capped at 6 (a 10-way
      // mesh is ~45 peer connections — far too heavy for the fallback path).
      const inviteCap = livekitConfig().enabled ? 10 : 6;
      if (room && room.size >= inviteCap) {
        safeSend(conn.socket, {
          type: "error",
          code: "full",
          message: `Call is full (${inviteCap} max).`,
        });
        break;
      }
      if (process.env.RELAY_DIAG === "1" || process.env.NODE_ENV === "development") {
        console.log(`[relay-diag]    invite -> ${to} OK: sending ring (room=${self.roomId})`);
      }
      const ringMsg = {
        type: "ring",
        from: conn.pin,
        fromName: self.name,
        flag: self.flag,
        roomId: self.roomId,
        // Mutual-consent video: the callee's ring card shows the dialed mode,
        // and only a VIDEO dial offers the "answer with video" (= consent).
        video: !!msg.video,
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
      safeSend(conn.socket, { type: "ringing", pin: to, name: target.name });
      // Remember we're ringing this callee so we can cancel it if we bail.
      self.ringing.add(to);
      // Fan out a notification hint so the callee's other open tabs
      // (e.g. Messages, Contacts) also see the incoming call.
      if (onInvite && conn.pin && self.roomId) {
        try {
          onInvite({
            fromPin: conn.pin,
            fromName: self.name,
            toPin: to,
            roomId: self.roomId,
          });
        } catch {
          /* never let a notification hook break call setup */
        }
      }
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
            if (c !== conn.cid) safeSend(sock, { type: "ring-cancel", from: callerPin });
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
        safeSend(target.socket, { type: "rejected", from: conn.pin });
        // Record the decline (call_history). Caller=targetPin, callee=us.
        try {
          onMissedCall?.({ calleePin: conn.pin, callerPin: targetPin, callerName: target.name, reason: "rejected" });
        } catch { /* never let a notification hook break call teardown */ }
        // Tear down the caller's solo dialing room so they can be invited again.
        if (roomSize(reg, target.roomId) === 1) {
          leaveRoom(reg, targetPin);
        }
      }
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
      const target = reg.clients.get(String(msg.to || ""));
      if (target)
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
      promoteHeldRoom(reg, conn, self);
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
          // Tell the target they were removed, then force them out of the room.
          sendTo(target, { type: "kicked", by: conn.pin });
          leaveRoom(reg, target); // removes membership + broadcasts peer-left + reaps if empty
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

/**
 * Mount the HTTP signaling endpoints on an Express app.
 *
 * Returns the underlying registry so tests can poke at internal state.
 */
export function attachRelay(
  app: Express,
  onInvite?: InviteHook,
  onMissedCall?: MissedCallHook,
  onConferenceEnd?: ConferenceEndHook
): RelayRegistry {
  const reg = createRegistry();
  reg.onConferenceEnd = onConferenceEnd;

  // Public ICE config endpoint. Returns the same fresh, time-limited TURN/STUN
  // credentials the signaling layer issues, so browser-side tools (e.g. the
  // /turn-test page) can probe the operator coturn with VALID use-auth-secret
  // credentials instead of stale static ones.
  app.get("/api/relay/ice", (req: Request, res: Response) => {
    const who = String(req.query.u || "probe-" + Math.random().toString(36).slice(2, 8));
    res.json({ iceServers: iceServers(who) });
  });

  // SSE channel: long-lived response that streams JSON-encoded server -> client
  // messages. Each event line is `data: <json>\n\n`.
  app.get("/api/relay/stream", (req: Request, res: Response) => {
    const cid = String(req.query.cid || "");
    if (!cid) {
      res.status(400).json({ error: "missing cid" });
      return;
    }
    // If the same cid reconnects (e.g. tab refresh), close the old channel.
    const prev = reg.connections.get(cid);
    if (prev) {
      try {
        prev.socket.close();
      } catch {
        /* noop */
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
        try {
          res.end();
        } catch {
          /* noop */
        }
      },
    };

    const conn: RelayConnection = { cid, socket, pin: null };
    reg.connections.set(cid, conn);

    // Reconnect re-binding: if this cid already owns a number whose client
    // record still exists (within the disconnect grace window), re-attach the
    // fresh SSE socket to it immediately so the user keeps their number, room,
    // and any active call instead of being assigned a new number.
    const ownedPin = reg.cidToPin.get(cid);
    if (ownedPin) {
      const client = reg.clients.get(ownedPin);
      if (client) {
        // Multi-device: a reconnecting SECONDARY device must not hijack the
        // in-call primary's socket — NOR cancel the PRIMARY's disconnect-grace
        // timer (doing so would strand a dead primary and never promote the
        // survivor). Only the primary's own reconnect touches its socket+grace.
        // Flag-off → always (identical to before).
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
      const existing = reg.connections.get(cid);
      if (existing === conn) reg.connections.delete(cid);
      // Drop this device socket from the ring set — a dead socket can't receive
      // a ring, and a reconnecting cid re-adds itself. (Bookkeeping only; the
      // grace-window client teardown below is unchanged.)
      if (conn.pin) deviceRemove(reg, conn.pin, cid);
      // Do NOT remove the client immediately. SSE channels are routinely cut by
      // proxies; instead start a grace timer. If the same cid reconnects within
      // the window, the stream handler re-binds and clears this timer, so the
      // user keeps their number, room, and active call. Only after the window
      // expires with no reconnect do we actually tear the client down.
      if (conn.pin) {
        const pin = conn.pin;
        const client = reg.clients.get(pin);
        if (client && (client.cid === cid || client.cid === null)) {
          if (client.graceT) clearTimeout(client.graceT);
          client.graceT = setTimeout(() => {
            const c = reg.clients.get(pin);
            // Only reap if it wasn't re-bound to a newer live connection.
            if (c && c.graceT) {
              // Multi-device: if the primary device vanished but ANOTHER device
              // for this number is still connected, promote it to primary
              // instead of marking the number offline (keeps it reachable for
              // NEW calls). KNOWN GAP: if the primary dropped mid-call, the
              // promoted idle device has no RTCPeerConnection/LiveKit session for
              // that room, so the in-progress call is effectively over on this
              // side — the number stays reachable but that call doesn't migrate.
              if (multiDeviceEnabled()) {
                const devs = reg.devices.get(pin);
                const survivor = devs && Array.from(devs.entries()).find(([dcid]) => dcid !== cid);
                if (survivor) {
                  // Drop the dead primary's stale cid→pin mapping before handing
                  // the number to the survivor.
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
              // A call held by this (now gone) member can't be auto-rejoined — only
              // the ACTIVE room is restored on reconnect — so drop it instead of
              // leaking a ghost member into it.
              releaseHeldRoom(reg, pin);
              const rid = reg.pinRoom.get(pin) ?? null;
              if (rid) {
                // In an ACTIVE call: do NOT leave the room. Keep the persistent
                // membership (reg.pinRoom + the pin in reg.rooms) AND keep
                // cidToPin, so when this device reconnects/refreshes it
                // auto-rejoins the same call without a fresh invite. Drop only
                // the dead connection, then arm the abandonment reaper in case
                // this was the last connected member.
                // This member was connected until now; stamp the room so an
                // eventual abandonment reap logs the real end, not reap time.
                roomActivityTouch(reg, rid);
                // Tell the SURVIVORS this member has gone (their 30s grace elapsed
                // with no reconnect) so their grids reflow immediately and they see
                // a "left the call" notice — the authoritative exit signal for a
                // silent drop (tab-close / network-loss / crash), where the client
                // can't otherwise tell a vanished remote peer from a local blip.
                // Membership (reg.pinRoom + the pin in reg.rooms) is intentionally
                // KEPT, so if this device reconnects it still auto-rejoins and the
                // survivors rebuild the tile from the fresh offer.
                broadcastToRoom(reg, rid, { type: "peer-left", pin }, pin);
                reg.clients.delete(pin);
                reg.devices.delete(pin);
                maybeScheduleRoomReap(reg, rid);
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
  app.post("/api/relay/send", (req: Request, res: Response) => {
    const body = req.body || {};
    const cid = String(body.cid || "");
    const message = body.message;
    if (!cid || cid.length > 200 || typeof message !== "object" || message === null) {
      res.status(400).json({ error: "bad request" });
      return;
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
      onMissedCall
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
