/**
 * The ONE place that builds JavaScript for `WebView.injectJavaScript`.
 *
 * WHY THIS EXISTS. Every native→web message used to be assembled with template
 * interpolation into a single-quoted JS string literal:
 *
 *     detail: { type: 'callAnswered', callId: '${callId}', mode: '${mode}' }
 *
 * `callId` and `mode` arrive from a `relay://` deep link, which ANY installed app
 * or ANY web page can fire — the scheme is public and declared in app.config.ts.
 * A single apostrophe closes the literal, so
 *
 *     relay://call?action=answer&mode=voice&nativeCall=x');<attacker JS>//
 *
 * ran arbitrary JavaScript inside the WebView that holds the user's authenticated
 * RELAY session: read the session, exfiltrate messages, place calls as them. No
 * user interaction beyond following a link.
 *
 * The same shape appeared at five other sites, including one carrying the push
 * token. Notably the file already used `JSON.stringify` correctly for a
 * navigation URL a few lines away — the rule was known, just not applied
 * everywhere. So it now lives in one function that every site must call, rather
 * than being a habit each site can forget.
 */

/** The event name the web app listens for. */
export const NATIVE_EVENT = "relay:native";

/**
 * Escape a value for safe embedding in a JavaScript source string.
 *
 * `JSON.stringify` handles quotes, backslashes and control characters. It also
 * emits U+2028 / U+2029 literally — legal in JSON, and legal in JS string
 * literals only from ES2019. Hermes is fine with them, but escaping costs
 * nothing and removes the dependency on engine version.
 */
export function jsLiteral(value: unknown): string {
  return JSON.stringify(value ?? null)
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/**
 * Build the JS that dispatches a `relay:native` CustomEvent carrying `detail`.
 *
 * The WHOLE detail object is serialized in one go, so no field can be forgotten
 * and no field is interpolated as raw source. Wrapped in try/catch and ending in
 * `true;` — `injectJavaScript` on iOS warns when the injected script's final
 * expression is not truthy.
 */
export function nativeEventJs(detail: Record<string, unknown>): string {
  return `
    try {
      window.dispatchEvent(new CustomEvent(${jsLiteral(NATIVE_EVENT)}, {
        detail: ${jsLiteral(detail)}
      }));
    } catch (e) { console.warn('[RELAY native bridge] dispatch failed:', e); }
    true;
  `;
}

/** Navigate the WebView. The URL is serialized, never interpolated. */
export function navigateJs(url: string): string {
  return `window.location.href = ${jsLiteral(url)}; true;`;
}

/** What kind of token the native layer is handing over. */
export type PushTokenKind = "fcm" | "apns" | "apns-voip" | "expo";

/**
 * Hand the page this device's push token.
 *
 * TWO ENVELOPES, ON PURPOSE. The web app accepts both a `relay:native`
 * CustomEvent carrying `{type:'pushToken', kind, token}` and the older
 * `postMessage`/`SET_PUSH_TOKEN` shape, and it de-duplicates by (kind, token) —
 * so sending both costs one extra dispatch and nothing else, while covering a
 * deployed web build that only implements one of them. Getting this wrong is
 * silent: the app looks fine and simply never rings when it is closed.
 *
 * Note this is `injectJavaScript`, NOT `WebView.postMessage`. On Android the
 * latter dispatches its MessageEvent on `document`, and a MessageEvent does not
 * bubble, so a `window`-level listener — which is the only kind the page has, and
 * the only kind the spec asks for — never sees it. On iOS the same call
 * dispatches on `window`. That platform difference is the whole reason Android
 * push registration never worked.
 */
export function pushTokenJs(token: string, kind: PushTokenKind): string {
  return `
    try {
      window.dispatchEvent(new CustomEvent(${jsLiteral(NATIVE_EVENT)}, {
        detail: ${jsLiteral({ type: "pushToken", kind, token })}
      }));
    } catch (e) { console.warn('[RELAY native bridge] push token event failed:', e); }
    try {
      window.postMessage(
        ${jsLiteral(JSON.stringify({ type: "SET_PUSH_TOKEN", kind, token }))},
        window.location.origin
      );
    } catch (e) { console.warn('[RELAY native bridge] push token post failed:', e); }
    true;
  `;
}

/* ── Deep-link input validation ───────────────────────────────────────────
 * Escaping alone makes injection impossible, but a `relay://` link is still
 * attacker-controlled input driving the CALL UI, so the values are also
 * constrained to what the native side actually emits. Anything else is dropped
 * rather than passed through to the web app.
 * ─────────────────────────────────────────────────────────────────────── */

export type CallAction = "answer" | "decline";
export type CallMode = "voice" | "video";

export function isCallAction(v: unknown): v is CallAction {
  return v === "answer" || v === "decline";
}

export function isCallMode(v: unknown): v is CallMode {
  return v === "voice" || v === "video";
}

/**
 * A call id we are willing to hand to the web app: a bounded,
 * URL-safe token. Returns null for anything else.
 *
 * The native call layer mints these (UUIDs and room ids), so this is deliberately
 * narrow — it is not trying to be a general sanitizer, it is stating the shape.
 */
export function sanitizeCallId(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (s.length === 0 || s.length > 128) return null;
  return /^[A-Za-z0-9._:-]+$/.test(s) ? s : null;
}
