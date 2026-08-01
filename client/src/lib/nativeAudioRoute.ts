/**
 * NATIVE AUDIO ROUTING (2026-08-01) — the third thing that crosses the shell
 * boundary, after the push token and the call lifecycle.
 *
 * ── WHY THIS EXISTS AT ALL ──────────────────────────────────────────────────
 * The web has no API for "put this call on the loudspeaker". `setSinkId` is a
 * DESKTOP output-device picker and enumerates nothing on a phone (v2.99.4 found
 * the menu opening EMPTY there), so what the app has instead is a WebAudio
 * re-route that forces the media path onto the loudspeaker — a workaround that
 * only ever worked because a browser tab has no other idea about routing.
 *
 * Inside a native shell that is no longer true: the OS owns the route, an
 * AudioManager / AVAudioSession call is the only thing that moves it, and the
 * WebAudio force is at best a no-op and at worst fights whatever the shell just
 * set. So in a shell the buttons stop trying and start ASKING.
 *
 * ── THE SHELL IS AUTHORITATIVE, AND THAT DECIDES THE UI RULE ────────────────
 * We send a REQUEST and the shell answers with `audioRouteChanged`. The button
 * state follows the ANSWER, never the tap.
 *
 * That is deliberately not the friendlier-looking design. Highlighting the
 * button optimistically would mean a tap that the OS refused — a Bluetooth
 * device that dropped, a route the phone will not take during a system call —
 * leaves the app claiming an output the call is not using. This app has spent a
 * lot of releases removing exactly that class of lie, and the failure direction
 * here is the good one: an unchanged button over an unchanged route is TRUE.
 *
 * The corollary is worth saying plainly: a shell build that does not yet handle
 * `setAudioRoute` will show a button that does nothing when tapped. That is
 * accurate rather than broken — in such a shell the route really did not move,
 * because nothing else in the page can move it.
 *
 * ── PLAIN BROWSERS ARE UNTOUCHED ────────────────────────────────────────────
 * No `RelayNative` ⇒ none of this runs and the WebAudio force stays exactly as
 * it shipped. That is the whole compatibility contract, and it is why the shell
 * test is a capability check on the object rather than a user-agent sniff.
 */

/**
 * The wire vocabulary, verbatim from the spec. These strings are a CONTRACT with
 * a binary we do not build and cannot deploy in step with, so they are never
 * derived, abbreviated or reused — the engine's own internal ids stay separate
 * and are translated at the boundary (see ROUTE_TO_WIRE below).
 */
export type NativeAudioRoute = "speaker" | "earpiece" | "bluetooth";

/** What the shell can tell us about the call's audio. */
export type NativeAudioEvent =
  | { type: "audioRouteChanged"; route: NativeAudioRoute }
  | { type: "callMuted"; muted: boolean };

/**
 * The engine's internal route ids ("loud" / "ear" / "bt", which predate this and
 * are woven through the menu markup) mapped to the wire names — ONE map, both
 * directions derived from it.
 *
 * Two hand-written maps is how the request and the confirmation come to disagree
 * about which button is lit: you would tap Bluetooth, the shell would confirm
 * "bluetooth", and a lookup that spelled it differently would light nothing. The
 * repo has paid for that shape twice already (v2.99.71's TURN checker,
 * v2.105.11's token classifier), so there is exactly one table here.
 */
export const ROUTE_TO_WIRE = {
  loud: "speaker",
  ear: "earpiece",
  bt: "bluetooth",
} as const satisfies Record<string, NativeAudioRoute>;

export type EngineRouteId = keyof typeof ROUTE_TO_WIRE;

/** wire → engine, DERIVED so it cannot drift from the table above. */
export function wireToEngineRoute(route: NativeAudioRoute): EngineRouteId {
  const hit = (Object.keys(ROUTE_TO_WIRE) as EngineRouteId[]).find(
    k => ROUTE_TO_WIRE[k] === route,
  );
  // Unreachable while the type holds; `ear` rather than a throw because this runs
  // on an incoming shell event and the earpiece is the conservative answer.
  return hit ?? "ear";
}

/**
 * Is a route name one we recognise?
 *
 * FAILS CLOSED — an unknown value yields null and the event is dropped, rather
 * than defaulting to anything. Defaulting toward "speaker" would be the harmful
 * direction specifically: a garbled event would light the loudspeaker button
 * during a call somebody is holding to their ear in public. Same reasoning as
 * `normalizeMode` defaulting to voice in the call bridge.
 */
export function normalizeNativeRoute(v: unknown): NativeAudioRoute | null {
  return v === "speaker" || v === "earpiece" || v === "bluetooth" ? v : null;
}

interface RelayNativeSink {
  postMessage?: (s: string) => void;
}

/**
 * Is there a native shell listening?
 *
 * A capability check on the injected object, never a user-agent sniff: the shells
 * inject `RelayNative` themselves, so its presence is the only honest signal that
 * somebody is on the other end of `postMessage`. A UA sniff would claim a shell
 * for every Android browser and route the taps into nothing.
 */
export function hasNativeAudioShell(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const rn = (window as unknown as { RelayNative?: RelayNativeSink }).RelayNative;
    return typeof rn?.postMessage === "function";
  } catch {
    return false;
  }
}

/**
 * THE SHELL HAS TWO NAMES FOR THIS ONE OPERATION, so we send both.
 *
 * Read off the shell's own source rather than off the spec, which names only the
 * first:
 *
 *   iOS      `plugins/with-ios-voip-callkit.js` — a WKScriptMessageHandler whose
 *            switch has `case "setAudioRoute"`, then its own switch over
 *            speaker / earpiece / bluetooth.
 *   Android  `components/relay-webview.tsx` — an RN `onMessage` switch with
 *            `case "audio-route": applyAudioRoute(msg.route)`, typed in
 *            `lib/call-messages.ts` as
 *            `{ type: "audio-route"; route: "earpiece" | "speaker" | "bluetooth" }`.
 *
 * The route VALUES agree across both; only the envelope's `type` differs. That is
 * the one-rule-two-spellings shape this repo keeps paying for, and the failure is
 * the silent kind — send only the spec's name and every Android tap reaches a
 * parser that answers `{type:"unknown"}` and a `default: break`.
 *
 * We cannot fix it in the shell from here, so the web satisfies both. It is safe
 * BY CONSTRUCTION rather than by timing: the two handlers live on different
 * platforms and each has a hard inert default for a name it does not know (iOS
 * logs "unknown message type", Android breaks), so no shell can ever act twice.
 * When the shell unifies on one name, one of these lines goes.
 */
const ROUTE_MESSAGE_TYPES = ["setAudioRoute", "audio-route"] as const;

/**
 * WEB → NATIVE. Ask the shell to move the call's audio.
 *
 * Returns whether the request was SENT, which is a much weaker claim than
 * "the route changed" and is named that way on purpose — only
 * `audioRouteChanged` says the latter, and only the shell can say it.
 *
 * Never throws: this runs from a button handler inside a live call. Each envelope
 * is posted independently so one throwing cannot cost the other its delivery.
 */
export function requestNativeAudioRoute(route: NativeAudioRoute): boolean {
  if (typeof window === "undefined") return false;
  let sent = false;
  for (const type of ROUTE_MESSAGE_TYPES) {
    try {
      const rn = (window as unknown as { RelayNative?: RelayNativeSink }).RelayNative;
      if (typeof rn?.postMessage !== "function") return sent;
      rn.postMessage(JSON.stringify({ type, route }));
      sent = true;
    } catch {
      /* a shell that refused one name may still take the other */
    }
  }
  return sent;
}

/**
 * Validate an inbound audio event.
 *
 * Its own parser rather than a branch inside `parseNativeCallEvent`, because the
 * two answer different questions and share only a channel: a call event is keyed
 * on a callId these do not carry, so folding them together would mean a function
 * whose result every caller has to re-narrow before it can act.
 *
 * `muted` must be a REAL boolean. A truthy check would let the string "false"
 * mute somebody's microphone mid-sentence — the value arrives from a separate
 * binary, so its type is not something this side gets to assume.
 */
export function parseNativeAudioEvent(detail: unknown): NativeAudioEvent | null {
  if (typeof detail !== "object" || detail === null) return null;
  const d = detail as { type?: unknown; route?: unknown; muted?: unknown };
  if (d.type === "audioRouteChanged") {
    const route = normalizeNativeRoute(d.route);
    return route ? { type: "audioRouteChanged", route } : null;
  }
  if (d.type === "callMuted") {
    return typeof d.muted === "boolean" ? { type: "callMuted", muted: d.muted } : null;
  }
  return null;
}

/**
 * Mount the listener. Returns a teardown.
 *
 * Its own subscription on `relay:native` rather than an extra branch inside the
 * call bridge's: that one DEDUPES per (type, callId) so a shell re-posting on
 * foreground cannot answer a call twice, and route events legitimately repeat —
 * a Bluetooth headset connecting and disconnecting sends "bluetooth" then
 * "earpiece" then "bluetooth" again, and a dedupe would swallow the third. Two
 * independent listeners on one channel is already the established pattern here
 * (the token bridge has its own).
 */
export function mountNativeAudioBridge(
  onEvent: (e: NativeAudioEvent) => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const onNative = (ev: Event) => {
    const e = parseNativeAudioEvent((ev as CustomEvent).detail);
    if (e) onEvent(e);
  };
  window.addEventListener("relay:native", onNative);
  return () => window.removeEventListener("relay:native", onNative);
}
