/* ============================================================
   RELAY — WebSocket signaling for self-hosted browser calling.

   Adapted from the standalone relay-server.zip the user supplied.
   - Mounts on the existing HTTP server under path `/api/relay`
     (so the platform gateway routes WebSocket upgrades to us).
   - Server is authoritative about room membership (glare-free
     mesh: only the newcomer sends WebRTC offers).
   - Issues short-lived TURN credentials via HMAC-SHA1 when
     `TURN_SECRET` and `TURN_HOST` are set; otherwise falls back
     to public STUN servers.
   ============================================================ */

import crypto from "crypto";
import type { Server as HttpServer, IncomingMessage } from "http";
import { WebSocket, WebSocketServer } from "ws";

const TURN_SECRET = process.env.TURN_SECRET || "";
const TURN_HOST = process.env.TURN_HOST || "";
const TURN_TTL = parseInt(process.env.TURN_TTL || "3600", 10);

interface IceServer {
  urls: string;
  username?: string;
  credential?: string;
}

export interface RelayClient {
  ws: WebSocket;
  name: string;
  roomId: string | null;
}

interface RelayWebSocket extends WebSocket {
  pin: string | null;
  isAlive: boolean;
}

export interface RelayRegistry {
  clients: Map<string, RelayClient>;
  rooms: Map<string, Set<string>>;
}

export function createRegistry(): RelayRegistry {
  return { clients: new Map(), rooms: new Map() };
}

function safeSend(ws: WebSocket, obj: unknown) {
  try {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
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
  ];
  if (TURN_SECRET && TURN_HOST) {
    const username = Math.floor(Date.now() / 1000) + TURN_TTL + ":" + userId;
    const credential = crypto
      .createHmac("sha1", TURN_SECRET)
      .update(username)
      .digest("base64");
    list.push({ urls: "turn:" + TURN_HOST + ":3478?transport=udp", username, credential });
    list.push({ urls: "turn:" + TURN_HOST + ":3478?transport=tcp", username, credential });
    list.push({ urls: "turns:" + TURN_HOST + ":5349?transport=tcp", username, credential });
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
      if (o) safeSend(o.ws, { type: "peer-left", pin });
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

export function handleMessage(
  reg: RelayRegistry,
  ws: RelayWebSocket,
  msg: RelayMessage
) {
  const type = msg && msg.type;

  // register: assign (or reuse requested) 6-digit number.
  if (type === "register") {
    if (ws.pin) return;
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
    ws.pin = pin;
    reg.clients.set(pin, { ws, name, roomId: null });
    safeSend(ws, { type: "registered", pin, name, iceServers: iceServers(pin) });
    return;
  }

  if (!ws.pin) return;
  const self = reg.clients.get(ws.pin);
  if (!self) return;

  switch (type) {
    case "invite": {
      const to = String(msg.to || "");
      if (to === ws.pin) {
        safeSend(ws, {
          type: "error",
          code: "self",
          message: "That's your own number.",
        });
        break;
      }
      const target = reg.clients.get(to);
      if (!target) {
        safeSend(ws, {
          type: "error",
          code: "offline",
          message: "That number isn't online.",
        });
        break;
      }
      if (target.roomId && target.roomId !== self.roomId) {
        safeSend(ws, { type: "busy", from: to });
        break;
      }
      if (!self.roomId) {
        const rid = newRoomId();
        reg.rooms.set(rid, new Set([ws.pin]));
        self.roomId = rid;
        safeSend(ws, { type: "room", roomId: rid });
      }
      const room = reg.rooms.get(self.roomId!);
      if (room && room.size >= 6) {
        safeSend(ws, {
          type: "error",
          code: "full",
          message: "Call is full (6 max).",
        });
        break;
      }
      safeSend(target.ws, {
        type: "ring",
        from: ws.pin,
        fromName: self.name,
        roomId: self.roomId,
      });
      break;
    }

    case "accept": {
      const roomId = String(msg.roomId || "");
      const room = reg.rooms.get(roomId);
      if (!room) {
        safeSend(ws, {
          type: "error",
          code: "gone",
          message: "That call has ended.",
        });
        break;
      }
      if (room.size >= 6) {
        safeSend(ws, {
          type: "error",
          code: "full",
          message: "Call is full (6 max).",
        });
        break;
      }
      const members = Array.from(room)
        .filter(p => p !== ws.pin)
        .map(p => ({
          pin: p,
          name: (reg.clients.get(p) || { name: "Guest" }).name || "Guest",
        }));
      room.add(ws.pin);
      self.roomId = roomId;
      // Newcomer learns existing members and will offer to each (only one
      // side ever offers, which avoids SDP glare in the mesh).
      safeSend(ws, { type: "joined", roomId, members });
      members.forEach(m => {
        const o = reg.clients.get(m.pin);
        if (o) safeSend(o.ws, { type: "peer-joined", pin: ws.pin, name: self.name });
      });
      break;
    }

    case "reject": {
      const target = reg.clients.get(String(msg.to || ""));
      if (target) safeSend(target.ws, { type: "rejected", from: ws.pin });
      break;
    }

    case "signal": {
      const target = reg.clients.get(String(msg.to || ""));
      if (target)
        safeSend(target.ws, { type: "signal", from: ws.pin, data: msg.data });
      break;
    }

    case "leave": {
      leaveRoom(reg, ws.pin);
      break;
    }

    default:
      break;
  }
}

export function attachRelay(httpServer: HttpServer): RelayRegistry {
  const reg = createRegistry();
  // `noServer: true` lets us share the HTTP listener with Express and
  // dispatch only WebSocket upgrades whose URL begins with `/api/relay`.
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (req: IncomingMessage, socket, head) => {
    const url = req.url || "";
    if (!url.startsWith("/api/relay")) return; // let Vite HMR + others handle it
    wss.handleUpgrade(req, socket, head, ws => {
      wss.emit("connection", ws, req);
    });
  });

  wss.on("connection", (rawWs: WebSocket) => {
    const ws = rawWs as RelayWebSocket;
    ws.pin = null;
    ws.isAlive = true;
    ws.on("pong", () => {
      ws.isAlive = true;
    });

    ws.on("message", raw => {
      let msg: RelayMessage;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      handleMessage(reg, ws, msg);
    });

    ws.on("close", () => {
      if (ws.pin) {
        leaveRoom(reg, ws.pin);
        reg.clients.delete(ws.pin);
      }
    });

    ws.on("error", () => {
      /* swallow socket errors; close handler still fires */
    });
  });

  // Heartbeat — drop dead sockets after a missed ping/pong cycle.
  const hb = setInterval(() => {
    wss.clients.forEach(rawWs => {
      const ws = rawWs as RelayWebSocket;
      if (ws.isAlive === false) {
        try {
          ws.terminate();
        } catch {
          /* noop */
        }
        return;
      }
      ws.isAlive = false;
      try {
        ws.ping();
      } catch {
        /* noop */
      }
    });
  }, 30000);
  wss.on("close", () => clearInterval(hb));

  console.log(
    "[relay] signaling ready on /api/relay — TURN " +
      (TURN_SECRET && TURN_HOST
        ? "enabled via " + TURN_HOST
        : "NOT configured (STUN only — works on most networks)")
  );

  return reg;
}
