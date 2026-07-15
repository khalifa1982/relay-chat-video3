/**
 * RELAY signaling transport + protocol — a faithful port of the web engine's
 * layer (client/src/lib/relayClient.ts) against the UNMODIFIED server
 * (server/relay.ts): SSE down (`/api/relay/stream?cid=`), POST up
 * (`/api/relay/send`), the same message vocabulary, the same retry/backoff,
 * re-register on every `ready`, reconnect on error. The state machine lives
 * in engine.tsx — this file only moves messages.
 */
import EventSource from "react-native-sse";
import { BASE_URL } from "../lib/api";

export interface IceServer { urls: string; username?: string; credential?: string }

/** Server→client + client→server message envelope (superset used by M3). */
export interface Msg {
  type?: string;
  pin?: string;
  name?: string;
  device?: string;
  flag?: string;
  from?: string;
  fromName?: string;
  to?: string;
  roomId?: string;
  reason?: string;
  members?: Array<{ pin: string; name: string; device?: string; flag?: string; role?: string }>;
  iceServers?: IceServer[];
  data?: { sdp?: { type: string; sdp: string }; candidate?: unknown };
  message?: string;
  code?: string;
  video?: boolean;
  paging?: boolean;
  livekit?: boolean;
  livekitUrl?: string;
  token?: string;
  url?: string;
}

function randomCid(): string {
  let s = "";
  for (let i = 0; i < 16; i++) s += Math.floor(Math.random() * 256).toString(16).padStart(2, "0");
  return s;
}

export class RelaySignaling {
  private cid = randomCid();
  private es: EventSource | null = null;
  private retryT: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;
  private wantName: string | null = null;
  private preferredPin: string | null = null;
  /** Authoritative pin assigned by the server. */
  pin: string | null = null;

  onMessage: (m: Msg) => void = () => {};
  onRegistered: (pin: string) => void = () => {};

  connect() {
    if (this.destroyed || this.es) return;
    const source = new EventSource(`${BASE_URL}/api/relay/stream?cid=${encodeURIComponent(this.cid)}`);
    this.es = source;
    source.addEventListener("message", e => {
      if (!("data" in e) || typeof e.data !== "string") return;
      let m: Msg;
      try { m = JSON.parse(e.data) as Msg; } catch { return; }
      if (m.type === "ready") {
        // (Re)register on every stream (re)open — the server re-binds the cid.
        if (this.wantName) this.sendRegister();
        return;
      }
      if (m.type === "registered" && m.pin) {
        this.pin = String(m.pin);
        this.onRegistered(this.pin);
      }
      this.onMessage(m);
    });
    source.addEventListener("error", () => {
      try { source.removeAllEventListeners(); source.close(); } catch { /* */ }
      if (this.es === source) this.es = null;
      if (!this.retryT && !this.destroyed) {
        this.retryT = setTimeout(() => { this.retryT = null; this.connect(); }, 1500);
      }
    });
  }

  register(name: string, preferredPin: string | null) {
    this.wantName = name;
    this.preferredPin = preferredPin;
    if (this.es) this.sendRegister();
    else this.connect();
  }

  private sendRegister() {
    void this.send({
      type: "register",
      name: this.wantName ?? "Guest",
      pin: this.preferredPin ?? undefined,
      device: "Mobile",
    });
  }

  /**
   * POST a signaling message. Non-`leave` messages retry 3× with the web
   * engine's 250·3^n backoff — a single dropped offer/answer is pair-fatal
   * on the mesh, exactly the failure v2.80 fixed.
   */
  async send(message: Msg): Promise<void> {
    const maxAttempts = message.type === "leave" ? 1 : 3;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const res = await fetch(`${BASE_URL}/api/relay/send`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cid: this.cid, message }),
        });
        if (res.ok) return;
        if (res.status === 404) { this.connect(); } // channel gone — reconnect
      } catch { /* transient */ }
      if (attempt < maxAttempts - 1) {
        await new Promise(r => setTimeout(r, 250 * Math.pow(3, attempt) + Math.random() * 150));
      }
    }
  }

  /** Force a fresh stream (foreground return) — no-op if healthy. */
  ensureConnected() {
    if (!this.es && !this.destroyed) this.connect();
  }

  destroy() {
    this.destroyed = true;
    if (this.retryT) { clearTimeout(this.retryT); this.retryT = null; }
    try { this.es?.removeAllEventListeners(); this.es?.close(); } catch { /* */ }
    this.es = null;
  }
}
