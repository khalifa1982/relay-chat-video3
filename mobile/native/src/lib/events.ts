/**
 * The v2 realtime bus — the SAME `/api/v2/events` SSE stream the web app
 * consumes (server/v2events.ts; identity via cookie or x-relay-device-id).
 * One shared connection; screens subscribe to event kinds. Polling remains
 * each screen's safety net, exactly like the web.
 */
import EventSource from "react-native-sse";
import { BASE_URL } from "./api";
import { getDeviceId } from "./deviceId";

export type V2Event =
  | { kind: "message"; conversationId: number; from: number }
  | { kind: "typing"; conversationId: number; from: number }
  | { kind: "read"; conversationId: number; reader: number }
  | { kind: "presence"; number: string; online: boolean; lastSeenAt: string }
  | { kind: "contact"; from: number }
  | { kind: "call_offer"; fromNumber: string; fromName: string; roomId: string }
  | { kind: "ping" };

type Listener = (ev: V2Event) => void;

let es: EventSource | null = null;
let opening = false; // guards the async gap below — two mounts in one frame
let retryT: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<Listener>();

async function open() {
  if (es || opening) return;
  opening = true;
  let deviceId: string;
  try {
    deviceId = await getDeviceId();
  } finally {
    opening = false;
  }
  if (es) return;
  const source = new EventSource(`${BASE_URL}/api/v2/events`, {
    headers: { "x-relay-device-id": deviceId },
  });
  es = source;
  source.addEventListener("message", e => {
    if (!("data" in e) || typeof e.data !== "string") return;
    try {
      const ev = JSON.parse(e.data) as V2Event;
      listeners.forEach(l => { try { l(ev); } catch { /* subscriber error */ } });
    } catch { /* non-JSON keepalive */ }
  });
  source.addEventListener("error", () => {
    // Drop and re-open with a small backoff (the library also retries, but a
    // hard re-open recovers auth/network transitions cleanly).
    try { source.removeAllEventListeners(); source.close(); } catch { /* */ }
    if (es === source) es = null;
    if (!retryT && listeners.size > 0) {
      retryT = setTimeout(() => { retryT = null; void open(); }, 3000);
    }
  });
}

/** Subscribe to bus events. Returns an unsubscribe fn. Opens lazily. */
export function onEvent(l: Listener): () => void {
  listeners.add(l);
  void open();
  return () => {
    listeners.delete(l);
  };
}
