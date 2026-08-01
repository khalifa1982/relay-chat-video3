/**
 * THE NATIVE CALL BRIDGE (2026-08-01) — the other half of the push spec.
 *
 * `nativeTokenBridge.ts` gets a token INTO the page. This carries CALL EVENTS in
 * both directions, which is what makes a natively-rung call answerable.
 *
 * The shape of the problem: the native shells own the ring (PushKit/CallKit on
 * iOS, a full-screen intent on Android) and the web app owns the CALL — the
 * signaling connection, the media, the room. So three things have to cross:
 *
 *   1. NATIVE → WEB, in-page: the person tapped Answer / Decline on the OS call
 *      screen while the WebView was already alive. Delivered as a `relay:native`
 *      CustomEvent, the same channel the token uses.
 *
 *   2. NATIVE → WEB, COLD START: the app was killed, the push woke it, and the
 *      shell opens the WebView at `?nativeCall=<id>&mode=<m>&action=answer`. There
 *      is no page to dispatch an event at, so the intent has to ride the URL.
 *
 *   3. WEB → NATIVE: the call ended in the web UI, so the OS call screen must be
 *      dismissed or the phone shows a call that is over.
 *
 * ── WHY THE URL INTENT IS READ ONCE, AT BOOT ────────────────────────────────
 * `client/src/lib/bootUrl.ts` captures the URL before any routing for exactly this
 * class of reason, and its own history is the argument: v2.99.57/M48 found that
 * `?to=` could place a live call from a link because a route module cannot tell an
 * arrival from an in-app navigation. The same trap applies here — a `nativeCall`
 * left in the address bar must not re-answer a finished call every time the user
 * navigates. So it is consumed ONCE and cleared.
 *
 * ── AND WHY THIS ONE IS ALLOWED TO AUTO-ANSWER WHEN `?to=` IS NOT ───────────
 * Said plainly, because it is the same shape as a hole this repo has already
 * closed. `?to=` auto-dialling is refused because a LINK is attacker-supplied: one
 * click on a URL somebody else chose would open the microphone. `?nativeCall` is
 * different in the one way that matters — it is not reachable by a link. The shell
 * puts it there only after the OS call UI reported that THE USER TAPPED ANSWER, so
 * the consent gesture has already happened, on a screen the OS drew. A stranger's
 * URL cannot manufacture that gesture; at worst it JOINS a room whose id they
 * would have to already know, which is the same authorization every other join
 * path enforces server-side.
 */

export type NativeCallAction = "answer" | "decline";

export interface NativeCallIntent {
  callId: string;
  mode: "voice" | "video";
  action: NativeCallAction;
}

/** What the shell tells us happened on the OS call screen. */
export type NativeCallEvent =
  | { type: "callAnswered"; callId: string; mode: "voice" | "video" }
  | { type: "callDeclined"; callId: string }
  | { type: "callEndedNative"; callId: string };

/**
 * A call id is a signaling room id, and it is INTERPOLATED INTO NOTHING — it only
 * ever gets compared and passed to the engine. Still bounded and character-checked,
 * because a value arriving from a URL that reaches call setup deserves a shape rule
 * whatever today's consumers do with it.
 */
const CALL_ID = /^[A-Za-z0-9:_-]{1,128}$/;

export function normalizeCallId(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return CALL_ID.test(t) ? t : null;
}

function normalizeMode(v: unknown): "voice" | "video" {
  // Defaults to VOICE, deliberately. Getting this wrong toward video would open a
  // camera the caller never asked for — the mutual-consent rule v2.81 exists for —
  // whereas defaulting to voice merely under-promises and the camera is one tap.
  return v === "video" ? "video" : "voice";
}

/**
 * Parse the cold-start intent out of a URL's query string.
 *
 * Pure, so the parsing can be asserted without a browser — which matters because
 * "does a stray query param answer a call" is exactly what a source pin cannot say.
 */
export function parseNativeCallIntent(search: string): NativeCallIntent | null {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  } catch {
    return null;
  }
  const callId = normalizeCallId(params.get("nativeCall"));
  if (!callId) return null;
  const action = params.get("action");
  // An UNRECOGNISED action is refused rather than defaulted. The spec names
  // `action=answer`; defaulting an unknown value to "answer" would make a
  // half-formed URL join a call, which is the one outcome worth being strict about.
  if (action !== "answer" && action !== "decline") return null;
  return { callId, mode: normalizeMode(params.get("mode")), action };
}

/**
 * Validate a `relay:native` call event.
 *
 * Separate from `acceptNativeEventDetail` in the token bridge because they answer
 * different questions and share only a channel — folding them together would mean
 * one function whose return type is a union nobody can act on without re-narrowing.
 */
export function parseNativeCallEvent(detail: unknown): NativeCallEvent | null {
  if (typeof detail !== "object" || detail === null) return null;
  const d = detail as { type?: unknown; callId?: unknown; mode?: unknown };
  const callId = normalizeCallId(d.callId);
  if (!callId) return null;
  if (d.type === "callAnswered") return { type: "callAnswered", callId, mode: normalizeMode(d.mode) };
  if (d.type === "callDeclined") return { type: "callDeclined", callId };
  if (d.type === "callEndedNative") return { type: "callEndedNative", callId };
  return null;
}

/**
 * HOW LONG AN ARMED NATIVE ANSWER STAYS LIVE.
 *
 * The server's own `PENDING_RING_TTL_MS` is 70s — past that the ring is no longer
 * redeliverable, so an arm that outlived it could only ever match a DIFFERENT call.
 */
export const NATIVE_ANSWER_TTL_MS = 70_000;

export interface NativeAnswerArm {
  roomId: string;
  voice: boolean;
  at: number;
}

/**
 * Does an armed native answer apply to the ring that just arrived?
 *
 * ── THIS IS THE SAFETY PROPERTY OF THE WHOLE FEATURE ────────────────────────
 * On a cold start the person taps Answer on the OS call screen BEFORE this
 * document exists, so the intent has to be held until the server redelivers the
 * ring. An arm that never expired, or that matched any room, would silently answer
 * the NEXT call to arrive — possibly minutes later, possibly from somebody else —
 * opening the microphone with no gesture at all. That is the M48 class of hole.
 *
 * So it is bounded in TIME and matched on the ROOM, and both halves are load-bearing:
 * without the room match a different caller is answered, and without the TTL the
 * same caller redialling an hour later is answered.
 *
 * Pure and exported precisely because "does a stale arm open the microphone" is
 * what a source pin cannot answer.
 */
export function nativeAnswerMatches(
  arm: NativeAnswerArm | null,
  roomId: string,
  nowMs: number,
): { voice: boolean } | null {
  if (!arm) return null;
  if (nowMs - arm.at > NATIVE_ANSWER_TTL_MS) return null;
  if (arm.roomId !== roomId) return null;
  return { voice: arm.voice };
}

/**
 * WEB → NATIVE. Tell the shell a call finished in the web UI so it tears the OS
 * call screen down.
 *
 * Degrades SILENTLY in a plain browser, which is the whole contract: this runs on
 * every hang-up, in every browser, and the overwhelmingly common case is that there
 * is no shell at all. A throw here would break hanging up.
 */
export function notifyNativeCallEnded(callId: string): void {
  if (typeof window === "undefined") return;
  const id = normalizeCallId(callId);
  if (!id) return;
  try {
    const rn = (window as unknown as { RelayNative?: { postMessage?: (s: string) => void } })
      .RelayNative;
    rn?.postMessage?.(JSON.stringify({ type: "webCallEnded", callId: id }));
  } catch {
    /* no shell, or a shell that refused — a hang-up must never depend on it */
  }
}

/**
 * Mount the call-event listener. Returns a teardown.
 *
 * DEDUPED PER (type, callId): the shells re-post on foreground, and answering the
 * same call twice would run the join path against a room we are already in.
 */
export function mountNativeCallBridge(onEvent: (e: NativeCallEvent) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const seen = new Set<string>();
  const onNative = (ev: Event) => {
    const e = parseNativeCallEvent((ev as CustomEvent).detail);
    if (!e) return;
    const key = `${e.type}:${e.callId}`;
    if (seen.has(key)) return;
    seen.add(key);
    onEvent(e);
  };
  window.addEventListener("relay:native", onNative);
  return () => window.removeEventListener("relay:native", onNative);
}
