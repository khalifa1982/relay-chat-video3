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

export function looksLikePushToken(v: unknown): boolean {
  if (typeof v !== "string") return false;
  const t = v.trim();
  return EXPO_TOKEN.test(t) || DEVICE_TOKEN.test(t);
}

/** The kind we ask the server to store. Shape-derived, never label-derived. */
export function tokenKind(token: string): "expo" | "fcm" | null {
  const t = token.trim();
  if (EXPO_TOKEN.test(t)) return "expo";
  if (DEVICE_TOKEN.test(t)) return "fcm";
  return null;
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
): string | null {
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
  const d = data as { type?: unknown; token?: unknown };
  if (d.type !== "SET_PUSH_TOKEN") return null;
  if (!looksLikePushToken(d.token)) return null;
  return (d.token as string).trim();
}

/**
 * Mount the listener. Returns a teardown.
 *
 * `register` is called at most once per distinct token: the shell may post on
 * every foreground, and re-registering an unchanged token would be a write per
 * app switch forever.
 */
export function mountNativeTokenBridge(
  register: (token: string, kind: "expo" | "fcm") => void
): () => void {
  if (typeof window === "undefined") return () => {};
  let last: string | null = null;
  const onMessage = (ev: MessageEvent) => {
    const token = acceptTokenMessage(ev, window.location.origin, window);
    if (!token || token === last) return;
    const kind = tokenKind(token);
    if (!kind) return;
    last = token;
    register(token, kind);
  };
  window.addEventListener("message", onMessage);
  // Let the shell ask us to re-send rather than having to time its post against
  // our mount: some shells post before the bundle has finished evaluating.
  try {
    window.postMessage(JSON.stringify({ type: "RELAY_WEB_READY" }), window.location.origin);
  } catch {
    /* a stricter engine may refuse; the shell's own retry covers it */
  }
  return () => window.removeEventListener("message", onMessage);
}
