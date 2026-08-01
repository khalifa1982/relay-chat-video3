/**
 * Native push-token bridge (v2.99.79).
 *
 * The owner's shipping mobile app is a React Native + Expo shell wrapping
 * the live app URL in a WebView. The native layer is what holds the push
 * permission and the device/Expo token; the web app is what knows WHO is signed
 * in. So the shell posts the token into the page and the page registers it.
 *
 * The shell should send, once it has a token:
 *
 *     webviewRef.current.injectJavaScript(
 *       `window.postMessage(JSON.stringify({
 *          type: "SET_PUSH_TOKEN", token: ${JSON.stringify(token)}
 *        }), "*"); true;`
 *     );
 *
 * `platform` may be included and is ignored — the token's SHAPE decides the
 * transport server-side, because a mislabelled token is a silent delivery
 * failure rather than an error anybody sees.
 *
 * ── SECURITY: WHY THIS IS NOT THE SNIPPET YOU FIND ONLINE ──────────────────
 *
 * The usual advice is a bare `window.addEventListener("message", …)` that reads
 * `event.data` and registers whatever token it finds. On a real website that is a
 * notification-hijack primitive: ANY frame that can post into this page — an
 * embedding iframe, an opener, a malicious ad — can hand us a token belonging to
 * an attacker's device and become the recipient of somebody else's calls and
 * messages. This repo already has a recorded finding of exactly that class (the
 * v2.99.49 R1 push-endpoint re-bind).
 *
 * Three gates, all cheap:
 *
 *   1. ORIGIN. Accepted only when same-origin, or when the origin is empty /
 *      "null" — which is what an injected-JS post from a native WebView looks
 *      like on iOS. A hostile frame always has a real, different origin, so this
 *      is the gate that actually does the work.
 *   2. SOURCE. `event.source` must be this window or absent. A post from a child
 *      iframe or an opener carries that frame's window, never ours.
 *   3. SHAPE. Strict: an object with `type === "SET_PUSH_TOKEN"` and a plausible
 *      token. Anything else is ignored silently, because unrelated libraries post
 *      into pages constantly and a noisy console is its own bug.
 *
 * The server re-validates independently (`classifyNativeToken`) and the existing
 * per-browser claim on `push.subscribe` still governs re-binding, so this is one
 * layer of three rather than the only one.
 */

/** Expo's own token, e.g. "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]". */
const EXPO_TOKEN = /^Expo(nent)?PushToken\[[^\]\s]+\]$/;
/** A raw FCM registration token / APNs device token. */
const DEVICE_TOKEN = /^[A-Za-z0-9_:%.~-]{32,4096}$/;
/**
 * An APNs device token is PURE HEX (32 bytes → 64 chars classically, up to 100 on newer
 * iOS). An FCM registration token never is — it carries a `:` plus `-`/`_`.
 *
 * This has to be here, and not only on the server, because `nativeTokenBridge.test.ts`
 * cross-checks `tokenKind` against the server's `classifyNativeToken` over a table of
 * inputs: two gates disagreeing about one rule is the recurring defect this repo keeps
 * re-learning (v2.99.50, v2.99.71), and here a disagreement is a broken registration.
 * That guard is what caught v2.105.11 changing the server alone.
 */
const APNS_TOKEN = /^[0-9a-fA-F]{64,200}$/;

export function looksLikePushToken(v: unknown): boolean {
  if (typeof v !== "string") return false;
  const t = v.trim();
  return EXPO_TOKEN.test(t) || DEVICE_TOKEN.test(t);
}

/** The kind we ask the server to store. Shape-derived, never label-derived. */
export function tokenKind(token: string): "expo" | "fcm" | "apns" | null {
  const t = token.trim();
  if (EXPO_TOKEN.test(t)) return "expo";
  // BEFORE the FCM branch, or a hex token matches the looser pattern first and is
  // reported as an FCM registration token it is not.
  if (APNS_TOKEN.test(t) && t.length % 2 === 0) return "apns";
  if (DEVICE_TOKEN.test(t)) return "fcm";
  return null;
}

/** Every kind this bridge can ask the server to store. */
export type BridgeKind = "expo" | "fcm" | "apns" | "apns-voip";

/**
 * The ONE thing the shape cannot answer (v2.105.13).
 *
 * iOS issues TWO hex tokens: the PushKit one (rings via CallKit, topic
 * `<bundle>.voip`) and the ordinary alert one (topic `<bundle>`). They are
 * indistinguishable by shape, so the shell's declaration is the only signal —
 * and it is safe to trust because mislabelling costs the declarer their own ring
 * and nobody else anything. Mirrors the server's `isVoipDeclaration`; a
 * declaration on a NON-hex token is ignored, so it can never relabel an Expo or
 * FCM token.
 */
export function resolveKind(token: string, declaredVoip: boolean): BridgeKind | null {
  const shape = tokenKind(token);
  if (!shape) return null;
  return declaredVoip && shape === "apns" ? "apns-voip" : shape;
}

/**
 * Is this message one we should act on?
 *
 * Pure and exported so the gates are testable without a DOM — the whole value of
 * this module is WHICH messages it refuses, and that cannot be asserted by
 * reading the source.
 */
export function acceptTokenMessage(
  ev: { origin?: string; source?: unknown; data?: unknown },
  selfOrigin: string,
  selfWindow: unknown
): { token: string; voip: boolean } | null {
  // 1. Origin. Empty / "null" is the native-injection case; anything else must
  //    match us exactly.
  const origin = ev.origin ?? "";
  if (origin !== "" && origin !== "null" && origin !== selfOrigin) return null;
  // 2. Source. Ours, or absent (injected script has no separate window).
  if (ev.source != null && ev.source !== selfWindow) return null;
  // 3. Shape. Accept a JSON string or an already-parsed object, because RN's
  //    postMessage bridge stringifies and other shells do not.
  let data: unknown = ev.data;
  if (typeof data === "string") {
    // A bare token string is NOT accepted: without the envelope there is no way
    // to tell it apart from any other string a library might post.
    if (data.length > 8192) return null;
    try {
      data = JSON.parse(data);
    } catch {
      return null;
    }
  }
  if (typeof data !== "object" || data === null) return null;
  const d = data as { type?: unknown; token?: unknown; kind?: unknown };
  if (d.type !== "SET_PUSH_TOKEN") return null;
  if (!looksLikePushToken(d.token)) return null;
  // The shell may declare `kind: "apns-voip"` for its PushKit token. Any other
  // value is IGNORED rather than refused — `platform` and other hints have always
  // been tolerated here, and the shape still decides everything else.
  return { token: (d.token as string).trim(), voip: d.kind === "apns-voip" };
}

/**
 * The SECOND envelope: a `relay:native` CustomEvent (2026-08-01).
 *
 * The owner's push spec asks the shell to reach the page with
 * `window.dispatchEvent(new CustomEvent('relay:native', {detail: {...}}))` carrying
 * `{type:'pushToken', kind:'apns-voip'|'fcm', token}`. That is a different contract
 * from the `postMessage`/`SET_PUSH_TOKEN` one above, and BOTH are accepted — the
 * shell already on the owner's iPhone posts the old shape and is the only handset
 * whose ring has ever been proven end to end, so replacing the contract would
 * silence the one device that works.
 *
 * ── WHY THIS ONE NEEDS NO ORIGIN GATE, SAID EXPLICITLY ──────────────────────
 * A CustomEvent has no origin and no source, because it cannot cross a document
 * boundary: only script already executing IN this document can dispatch it. The
 * three gates above exist because `postMessage` is reachable from an embedding
 * iframe, an opener or an ad — a CustomEvent is not. Anyone who can dispatch this
 * already has script execution here, at which point a push token is the least of
 * what they have. The SHAPE check is still applied, and the server re-derives the
 * kind from the token independently, so this remains one layer of three.
 */
export function acceptNativeEventDetail(detail: unknown): { token: string; voip: boolean } | null {
  if (typeof detail !== "object" || detail === null) return null;
  const d = detail as { type?: unknown; token?: unknown; kind?: unknown };
  if (d.type !== "pushToken") return null;
  if (!looksLikePushToken(d.token)) return null;
  return { token: (d.token as string).trim(), voip: d.kind === "apns-voip" };
}

/**
 * Mount the listener. Returns a teardown.
 *
 * `register` is called at most once per distinct token: the shell may post on
 * every foreground, and re-registering an unchanged token would be a write per
 * app switch forever.
 */
export function mountNativeTokenBridge(
  register: (token: string, kind: BridgeKind) => void
): () => void {
  if (typeof window === "undefined") return () => {};
  // A SET, not a single slot (v2.105.13). An iOS shell now legitimately posts TWO
  // tokens — the Expo one for notifications and the PushKit one for ringing — and
  // they may alternate on every foreground. A one-slot `last` would see each as
  // "changed" and re-register both on every app switch, forever.
  const seen = new Set<string>();
  // ONE admit path for both envelopes, so the dedupe, the kind resolution and the
  // shape rule cannot come to differ between them — which is exactly how one
  // transport ends up registering a token the other would have refused.
  const admit = (accepted: { token: string; voip: boolean } | null) => {
    if (!accepted) return;
    const { token, voip } = accepted;
    // Keyed on kind too, so a shell that corrects a mislabelled token — posting
    // the same string first as apns and then as apns-voip — is not ignored.
    const kind = resolveKind(token, voip);
    if (!kind) return;
    const key = `${kind}:${token}`;
    if (seen.has(key)) return;
    seen.add(key);
    register(token, kind);
  };
  const onMessage = (ev: MessageEvent) => {
    admit(acceptTokenMessage(ev, window.location.origin, window));
  };
  const onNative = (ev: Event) => {
    admit(acceptNativeEventDetail((ev as CustomEvent).detail));
  };
  window.addEventListener("message", onMessage);
  window.addEventListener("relay:native", onNative);
  // Let the shell ask us to re-send rather than having to time its post against
  // our mount: some shells post before the bundle has finished evaluating.
  try {
    window.postMessage(JSON.stringify({ type: "RELAY_WEB_READY" }), window.location.origin);
  } catch {
    /* a stricter engine may refuse; the shell's own retry covers it */
  }
  return () => {
    window.removeEventListener("message", onMessage);
    window.removeEventListener("relay:native", onNative);
  };
}
