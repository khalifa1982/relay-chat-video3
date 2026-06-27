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

export interface RelayRegistry {
  clients: Map<string, RelayClient>;          // pin   -> client
  rooms: Map<string, Set<string>>;            // rid   -> set<pin>
  connections: Map<string, RelayConnection>;  // cid   -> connection
  cidToPin: Map<string, string>;              // cid   -> last assigned pin
}

export function createRegistry(): RelayRegistry {
  return { clients: new Map(), rooms: new Map(), connections: new Map(), cidToPin: new Map() };
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

export function leaveRoom(reg: RelayRegistry, pin: string) {
  const c = reg.clients.get(pin);
  if (!c || !c.roomId) return;
  const room = reg.rooms.get(c.roomId);
  if (room) {
    room.delete(pin);
    room.forEach(p => {
      const o = reg.clients.get(p);
      if (o) safeSend(o.socket, { type: "peer-left", pin });
    });
    if (room.size === 0) reg.rooms.delete(c.roomId);
  }
  c.roomId = null;
}

export interface RelayMessage {
  type?: string;
  name?: string;
  pin?: string;
  to?: string;
  roomId?: string;
  data?: unknown;
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
        const lk = livekitConfig();
        safeSend(conn.socket, { type: "registered", pin: conn.pin, name: existing.name, iceServers: iceServers(conn.pin), livekit: lk.enabled, livekitUrl: lk.url });
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

    if (ownedPin) {
      pin = ownedPin;
    } else if (requested && (!reg.clients.has(requested) || reg.clients.get(requested)!.cid === cid)) {
      // Honour an explicit pin request if it's free or already owned by this cid.
      pin = requested;
    } else {
      pin = genPin(reg);
    }

    conn.setPin(pin);
    if (cid) reg.cidToPin.set(cid, pin);

    // Reuse/refresh an existing client record (preserves room membership across
    // a reconnect); otherwise create a fresh one.
    const prev = reg.clients.get(pin);
    if (prev) {
      if (prev.graceT) { clearTimeout(prev.graceT); prev.graceT = null; }
      prev.socket = conn.socket;
      prev.name = name;
      prev.cid = cid || prev.cid;
    } else {
      reg.clients.set(pin, { socket: conn.socket, name, roomId: null, cid: cid || null, graceT: null, ringing: new Set() });
    }
    const lk = livekitConfig();
    safeSend(conn.socket, { type: "registered", pin, name, iceServers: iceServers(pin), livekit: lk.enabled, livekitUrl: lk.url });
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
          message: "That number isn't online.",
        });
        // The callee was offline — record the miss and (for registered users)
        // email them. The hook resolves identity from the DB by number, so it
        // works even though an offline callee has no in-memory registry entry.
        try {
          onMissedCall?.({ calleePin: to, callerPin: conn.pin, callerName: self.name, reason: "cancelled" });
        } catch { /* never let a notification hook break call setup */ }
        break;
      }
      // A target is only "busy" if it's already in an established call with
      // someone else (2+ people). A target sitting alone in their own dialing
      // room is still reachable — that's call-waiting, not busy.
      if (
        target.roomId &&
        target.roomId !== self.roomId &&
        roomSize(reg, target.roomId) > 1
      ) {
        safeSend(conn.socket, { type: "busy", from: to });
        break;
      }
      if (!self.roomId) {
        const rid = newRoomId();
        reg.rooms.set(rid, new Set([conn.pin]));
        self.roomId = rid;
        safeSend(conn.socket, { type: "room", roomId: rid });
        // On the LiveKit path, the caller joins the SFU room immediately (alone)
        // so the callee connects near-instantly the moment they accept.
        pushLivekitToken(reg, conn.pin, rid);
      }
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
      safeSend(target.socket, {
        type: "ring",
        from: conn.pin,
        fromName: self.name,
        roomId: self.roomId,
      });
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
      const invitedToRoom = Array.from(room).some(p => reg.clients.get(p)?.ringing.has(conn.pin!));
      if (!invitedToRoom) {
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
      // If the accepter was already in a different room (e.g. their own solo
      // dialing room from an outgoing call, or a previous call), leave it
      // first so they're never referenced by two rooms.
      if (self.roomId && self.roomId !== roomId) {
        leaveRoom(reg, conn.pin);
      }
      const members = Array.from(room)
        .filter(p => p !== conn.pin)
        .map(p => ({
          pin: p,
          name: (reg.clients.get(p) || { name: "Guest" }).name || "Guest",
        }));
      room.add(conn.pin);
      self.roomId = roomId;
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
        iceServers: iceServers(conn.pin),
        livekit: lk.enabled,
        livekitUrl: lk.url,
      });
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
      // Caller hung up: every callee still ringing just missed the call.
      const callerName = self.name;
      const missed = cancelPendingRings(reg, conn.pin);
      for (const calleePin of missed) {
        try {
          onMissedCall?.({ calleePin, callerPin: conn.pin, callerName, reason: "cancelled" });
        } catch { /* never let a notification hook break call teardown */ }
      }
      leaveRoom(reg, conn.pin);
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
  onMissedCall?: MissedCallHook
): RelayRegistry {
  const reg = createRegistry();

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
        if (client.graceT) { clearTimeout(client.graceT); client.graceT = null; }
        client.socket = socket;
        conn.pin = ownedPin;
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
              // A vanished caller's pending callees missed the call.
              const callerName = c.name;
              const missed = cancelPendingRings(reg, pin);
              for (const calleePin of missed) {
                try {
                  onMissedCall?.({ calleePin, callerPin: pin, callerName, reason: "cancelled" });
                } catch { /* never let a notification hook break reaping */ }
              }
              leaveRoom(reg, pin);
              reg.clients.delete(pin);
              if (reg.cidToPin.get(cid) === pin) reg.cidToPin.delete(cid);
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
    if (!cid || typeof message !== "object" || message === null) {
      res.status(400).json({ error: "bad request" });
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
