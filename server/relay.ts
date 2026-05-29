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
}

export function createRegistry(): RelayRegistry {
  return { clients: new Map(), rooms: new Map(), connections: new Map() };
}

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
  const TURN_TTL = parseInt(process.env.TURN_TTL || "3600", 10);
  if (TURN_SECRET && TURN_HOST) {
    // Operator-supplied TURN (recommended for production).
    const username =
      Math.floor(Date.now() / 1000) + TURN_TTL + ":" + userId;
    const credential = crypto
      .createHmac("sha1", TURN_SECRET)
      .update(username)
      .digest("base64");
    list.push({ urls: "turn:" + TURN_HOST + ":3478?transport=udp", username, credential });
    list.push({ urls: "turn:" + TURN_HOST + ":3478?transport=tcp", username, credential });
    list.push({ urls: "turns:" + TURN_HOST + ":5349?transport=tcp", username, credential });
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

/**
 * Protocol logic. Kept as a pure function over (registry, socket-state,
 * message) so it's straightforward to unit-test without spinning up an
 * HTTP server.
 */
export function handleMessage(
  reg: RelayRegistry,
  conn: { socket: RelaySocket; pin: string | null; setPin: (p: string) => void },
  msg: RelayMessage
) {
  const type = msg && msg.type;

  // register: assign (or reuse requested) 6-digit number.
  if (type === "register") {
    if (conn.pin) return;
    const name = String(msg.name || "Guest").slice(0, 24);
    let pin: string;
    if (
      typeof msg.pin === "string" &&
      /^\d{6}$/.test(msg.pin) &&
      !reg.clients.has(msg.pin)
    ) {
      pin = msg.pin;
    } else {
      pin = genPin(reg);
    }
    conn.setPin(pin);
    reg.clients.set(pin, { socket: conn.socket, name, roomId: null });
    safeSend(conn.socket, { type: "registered", pin, name, iceServers: iceServers(pin) });
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
        safeSend(conn.socket, {
          type: "error",
          code: "offline",
          message: "That number isn't online.",
        });
        break;
      }
      if (target.roomId && target.roomId !== self.roomId) {
        safeSend(conn.socket, { type: "busy", from: to });
        break;
      }
      if (!self.roomId) {
        const rid = newRoomId();
        reg.rooms.set(rid, new Set([conn.pin]));
        self.roomId = rid;
        safeSend(conn.socket, { type: "room", roomId: rid });
      }
      const room = reg.rooms.get(self.roomId!);
      if (room && room.size >= 6) {
        safeSend(conn.socket, {
          type: "error",
          code: "full",
          message: "Call is full (6 max).",
        });
        break;
      }
      safeSend(target.socket, {
        type: "ring",
        from: conn.pin,
        fromName: self.name,
        roomId: self.roomId,
      });
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
      if (room.size >= 6) {
        safeSend(conn.socket, {
          type: "error",
          code: "full",
          message: "Call is full (6 max).",
        });
        break;
      }
      const members = Array.from(room)
        .filter(p => p !== conn.pin)
        .map(p => ({
          pin: p,
          name: (reg.clients.get(p) || { name: "Guest" }).name || "Guest",
        }));
      room.add(conn.pin);
      self.roomId = roomId;
      // Newcomer learns existing members and will offer to each (only one
      // side ever offers, which avoids SDP glare in the mesh).
      safeSend(conn.socket, { type: "joined", roomId, members });
      members.forEach(m => {
        const o = reg.clients.get(m.pin);
        if (o)
          safeSend(o.socket, {
            type: "peer-joined",
            pin: conn.pin,
            name: self.name,
          });
      });
      break;
    }

    case "reject": {
      const target = reg.clients.get(String(msg.to || ""));
      if (target) safeSend(target.socket, { type: "rejected", from: conn.pin });
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
export function attachRelay(app: Express): RelayRegistry {
  const reg = createRegistry();

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
        try {
          res.end();
        } catch {
          /* noop */
        }
      },
    };

    const conn: RelayConnection = { cid, socket, pin: null };
    reg.connections.set(cid, conn);

    // Send a ready event so the client can flip state.
    safeSend(socket, { type: "ready" });

    // Keep-alive heartbeat (comment line every 25s; passes through Cloudflare,
    // Cloud Run, and most proxies without timing out).
    const hb = setInterval(() => {
      if (closed) return;
      try {
        res.write(": ping\n\n");
      } catch {
        /* noop */
      }
    }, 25_000);

    const cleanup = () => {
      if (closed) return;
      closed = true;
      clearInterval(hb);
      const existing = reg.connections.get(cid);
      if (existing === conn) reg.connections.delete(cid);
      if (conn.pin) {
        leaveRoom(reg, conn.pin);
        reg.clients.delete(conn.pin);
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
        setPin: (p: string) => {
          conn.pin = p;
        },
      },
      message as RelayMessage
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
