/**
 * Pure parsing of messages posted by the injected scripts in the WebView.
 * Kept free of React/native imports so it can be unit-tested directly.
 */

export type RelayMessage =
  | { type: "version"; version: string }
  | { type: "call"; active: boolean; hasVideo: boolean }
  | { type: "ring"; ringing: boolean; caller: string | null }
  | { type: "message"; count: number }
  | { type: "audio-route"; route: "earpiece" | "speaker" | "bluetooth" }
  | { type: "online"; online: boolean }
  | { type: "webCallEnded"; callId: string }
  | { type: "unknown" };

/**
 * Parse a raw `postMessage` payload (JSON string) into a typed RelayMessage.
 * Returns `{ type: "unknown" }` for anything unrecognized or malformed.
 */
export function parseRelayMessage(raw: unknown): RelayMessage {
  if (typeof raw !== "string") return { type: "unknown" };
  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    return { type: "unknown" };
  }
  if (!data || typeof data.type !== "string") return { type: "unknown" };

  switch (data.type) {
    case "relay-version":
      return typeof data.version === "string" && data.version
        ? { type: "version", version: data.version }
        : { type: "unknown" };
    case "relay-call":
      return {
        type: "call",
        active: Boolean(data.active),
        hasVideo: Boolean(data.hasVideo),
      };
    case "relay-ring":
      return {
        type: "ring",
        ringing: Boolean(data.ringing),
        caller: typeof data.caller === "string" ? data.caller : null,
      };
    case "relay-message": {
      const count = Number(data.count);
      return {
        type: "message",
        count: Number.isFinite(count) ? count : 0,
      };
    }
    case "relay-audio-route": {
      const route = String(data.route);
      if (route === "earpiece" || route === "speaker" || route === "bluetooth") {
        return { type: "audio-route", route };
      }
      return { type: "unknown" };
    }
    case "relay-online":
      return { type: "online", online: Boolean(data.online) };
    case "webCallEnded":
      return typeof data.callId === "string" && data.callId
        ? { type: "webCallEnded", callId: data.callId }
        : { type: "unknown" };
    default:
      return { type: "unknown" };
  }
}

/**
 * Decide whether the OTA updater is allowed to auto-restart right now.
 * Restarting during an active call would drop the call, so it is blocked.
 */
export function canAutoRestart(opts: {
  autoRestart: boolean;
  updateReady: boolean;
  callActive: boolean;
}): boolean {
  return opts.autoRestart && opts.updateReady && !opts.callActive;
}
