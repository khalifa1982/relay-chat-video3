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
  /**
   * The web app announcing that its native bridge is LISTENING (v2.105.11).
   *
   * This closes a real handshake race that loses the push token on both platforms.
   * `onLoadEnd` fires when the document has loaded, but RELAY's
   * `nativeTokenBridge` attaches its listener inside a React effect — so a token
   * posted at load time can arrive BEFORE anything is listening and simply
   * vanish, with nothing anywhere reporting it. The web side has posted
   * `RELAY_WEB_READY` for exactly this since v2.99.79 and the shell ignored it,
   * so the only recovery was backgrounding and re-foregrounding the app.
   */
  | { type: "web-ready" }
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
    // Note the spelling: the web side posts RELAY_WEB_READY, not a `relay-`
    // prefixed name like the rest. Matching the sender rather than the local
    // convention is the whole point — a tidier name here would silently never fire.
    case "RELAY_WEB_READY":
      return { type: "web-ready" };
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
