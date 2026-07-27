/**
 * The top bar's live connection line (v2.99.94).
 *
 * Owner: "below the flashy light put small line and [mention] online small letter.
 * it means you are online now and when you are idle it will mention you are idle in
 * yellow color and if you were disconnected from the internet it will […] show you
 * you are offline red color."
 *
 * WHAT THIS REPORTS IS THIS DEVICE'S OWN REALTIME HEALTH, and that choice is the
 * whole design. The tempting alternative — read my own presence row back from the
 * server — cannot work for the one case the line exists for: if the connection has
 * just died, the round trip that would tell you so is exactly the thing that fails.
 * So the verdict is derived locally, from two signals the browser already has.
 *
 * THE MIDDLE STATE NEEDS POSITIVE EVIDENCE, not merely the absence of evidence.
 * `isSseConnected()` starts false and only flips on the stream's `onopen`, so a rule
 * of "not connected ⇒ idle" would render amber for the first few hundred ms of every
 * single app load and then snap to green — a flicker that reads as a bug. The rule
 * therefore keys on `degraded`, which starts FALSE and is set only when the stream
 * actually fails. Fail-open, the same convention as the presence and push gates.
 *
 * GREEN IS NEVER A LIE, which is why the stream is consulted at all. `navigator.onLine`
 * only reports that an interface is up — a captive portal or a dead uplink still reads
 * true — so on its own it would paint "online" over a connection that carries nothing.
 * Green requires the realtime stream to be established, which requires the server to
 * be genuinely reachable.
 *
 * "IDLE" IS THE HONEST WORD FOR IT, not a substitute for one. A backgrounded tab is
 * precisely a tab whose EventSource the browser throttles or suspends, and that is the
 * same condition the server records as `presence.idle` (v2.99.92) — so this line
 * agrees with what other people see of you without asking. Said plainly: you cannot
 * literally watch your own "idle" label while the app is hidden; what you see is the
 * reconnect window right after you come back, and a genuine stream failure.
 */
import { useSyncExternalStore } from "react";
import { isRealtimeDegraded, subscribeRealtimeStatus } from "./useRealtime";

export type ConnectionState = "online" | "idle" | "offline";

/**
 * Pure rule, so the three-way decision can be tested without a browser.
 *
 * Order matters: no network outranks a degraded stream, because a dropped stream is
 * a *symptom* of no network and reporting the symptom instead of the cause would send
 * somebody looking in the wrong place.
 */
export function connectionState(networkUp: boolean, degraded: boolean): ConnectionState {
  if (!networkUp) return "offline";
  if (degraded) return "idle";
  return "online";
}

/** Lowercase, per "small letter". */
export const CONNECTION_LABEL: Record<ConnectionState, string> = {
  online: "online",
  idle: "idle",
  offline: "offline",
};

/**
 * The colour per state, as a CSS custom property NAME rather than a class name.
 *
 * Deliberately not a Tailwind class: a runtime-composed class string is not present
 * in the source at build time, so Tailwind's JIT never emits it and the colour comes
 * out unstyled — the trap already documented for the bottom tab bar's accents.
 *
 * The two new tokens are MEASURED, not picked by eye. `--relay-dnd`, the amber
 * already in the palette, is 3.72:1 on the light card and FAILS AA for text this
 * small; it also already means "alerts are silenced", and one colour meaning two
 * things in one bar is the collision v2.99.86 moved DND off green to avoid.
 */
export const CONNECTION_VAR: Record<ConnectionState, string> = {
  online: "--relay-green-text",
  idle: "--relay-amber-text",
  offline: "--relay-red-text",
};

/** A fuller sentence for assistive tech and the `title`, since one word is terse. */
export const CONNECTION_TITLE: Record<ConnectionState, string> = {
  online: "Connected — messages and calls arrive instantly",
  idle: "Idle — reconnecting, so alerts may be delayed",
  offline: "Offline — no internet connection",
};

function networkUp(): boolean {
  // `navigator` is absent in a bare Node test env, and an unknown network is treated
  // as up: this line must never be the reason somebody thinks they are offline.
  if (typeof navigator === "undefined") return true;
  return navigator.onLine !== false;
}

function snapshot(): ConnectionState {
  return connectionState(networkUp(), isRealtimeDegraded());
}

function subscribe(onChange: () => void): () => void {
  const un = subscribeRealtimeStatus(onChange);
  if (typeof window === "undefined") return un;
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
    un();
  };
}

/**
 * `useSyncExternalStore` rather than a polling interval: the two inputs already
 * announce themselves (window events, and the stream's own handlers), so a timer
 * would re-render the app's most-mounted component on a schedule to learn nothing.
 * The snapshot is a string, so React's referential check is a value comparison and
 * an unchanged state costs no render.
 */
export function useConnectionState(): ConnectionState {
  return useSyncExternalStore(subscribe, snapshot, () => "online" as const);
}
