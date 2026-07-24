/**
 * The URL this document was LOADED with, captured once at app boot.
 *
 * SECURITY (M48 — link-driven forced hot-mic): the Dialer auto-dials `?to=<pin>`
 * so that tapping "call" in Messages/Contacts (which routes to
 * `/app/dialer?to=…`) connects immediately. But the effect could not tell an
 * in-app route change from someone ARRIVING on that URL, and microphone
 * permission is granted per-origin and persists — so for any regular RELAY user
 * a link like `https://<host>/app/dialer?to=<attacker-pin>` turned a single
 * click into a live outbound call to a number the attacker chose, with
 * `getUserMedia` succeeding silently and `?video=1` adding the camera. The
 * attacker's side can auto-answer.
 *
 * Route modules can't make this distinction themselves: `Dialer.tsx` is
 * lazily loaded, so its module scope is first evaluated AT the navigation that
 * needs it — by which time `window.location.search` already carries `?to=`
 * either way. This module is imported by `main.tsx`, so it is evaluated exactly
 * once when the document boots, before any routing has happened.
 *
 * ── SELF-REVIEW (v2.99.48): THE FIRST VERSION LEFT TWO WAYS IN AND BROKE ONE
 * WORKING FLOW ──
 *
 *  1. It tested the RAW search string with `/(^|[?&])to=/`, while the value that
 *     actually drives the dial is read with `URLSearchParams`, which
 *     PERCENT-DECODES KEYS. So `?%74o=555555` (`%74` is `t`) was invisible to the
 *     guard and perfectly visible to the consumer — the whole hole, reopened by
 *     one escape. A guard must never parse differently from the code it guards;
 *     `bootDialTarget()` now runs the CONSUMER'S parser over the boot URL.
 *
 *  2. `/i/<pin>` — the app's own share link, and the shorter form people actually
 *     send — boots with an EMPTY search and only then redirects client-side to
 *     `/app/dialer?to=…`, which read as an in-app tap. So the documented invite
 *     URL stayed fully exploitable while the long form was closed. Arrival is
 *     therefore judged on the boot PATH too.
 *
 *  3. And the guard was too broad in time: `BOOT_SEARCH` is captured per DOCUMENT,
 *     so once a tab had booted with any `to=` (e.g. tapping "Call" on a
 *     back-online alert), EVERY later in-app call tap in that tab hit the prefill
 *     branch — one-tap calling from Contacts/Messages silently stayed broken for
 *     the rest of the session. The question is now per-NAVIGATION: "is the number
 *     being dialed the one this document was opened with?", not "did this document
 *     ever open with one?".
 */
const hasWindow = typeof window !== "undefined" && !!window.location;

export const BOOT_SEARCH: string = hasWindow ? window.location.search : "";
/** The path this document was loaded with — `/i/<pin>` is itself a dial intent. */
export const BOOT_PATH: string = hasWindow ? window.location.pathname : "";

/**
 * The dial target the document was OPENED with, or null.
 *
 * Uses `URLSearchParams` — the same parser `Dialer.tsx` uses to read `to` — so
 * the two can never disagree about what the URL says. `/i/<pin>` carries the
 * target in the PATH and redirects client-side, so it is resolved here too;
 * `/app/call` is the legacy redirect into the same flow.
 */
export function bootDialTarget(): string | null {
  const fromPath = /^\/i\/(\d{1,6})/.exec(BOOT_PATH);
  if (fromPath) {
    const n = fromPath[1];
    if (/^\d{6}$/.test(n)) return n;
    return "*"; // an invite arrival with an unusable pin — still an arrival
  }
  if (/^\/app\/call\b/.test(BOOT_PATH)) return "*";
  let raw = "";
  try {
    raw = new URLSearchParams(BOOT_SEARCH).get("to") ?? "";
  } catch {
    return "*"; // unparseable → treat as an arrival (fail closed)
  }
  const to = raw.replace(/\D+/g, "").slice(0, 6);
  return /^\d{6}$/.test(to) ? to : null;
}

/**
 * True when `target` is the number this document was OPENED with — i.e. the dial
 * intent came from OUTSIDE the app (a pasted or clicked link, or a reload)
 * rather than from a tap inside it. Such a target must be confirmed by the user
 * instead of dialed automatically.
 *
 * `"*"` from `bootDialTarget()` means "arrived on an invite/legacy URL whose
 * target we can't read here" and matches any target, since the redirect that
 * follows is the only thing that could have produced one.
 */
export function arrivedWithDialTarget(target: string): boolean {
  const boot = bootDialTarget();
  return boot !== null && (boot === "*" || boot === target);
}

/**
 * Kept for the callers that only ask "did this document open on a dial URL?".
 * Prefer `arrivedWithDialTarget(target)` — see reason 3 above.
 */
export function bootedWithDialTarget(): boolean {
  return bootDialTarget() !== null;
}

/**
 * One-time, same-origin proof that THIS app generated a full-page dial
 * navigation — used by the flows that legitimately need one, notably the
 * "<name> is back online — tap to call them now" notification, which the user
 * explicitly armed and which navigates with `window.location.href` (a real
 * document load, so the arrival test above is true for it).
 *
 * A marker inside the URL would be worthless — an attacker just copies it into
 * their own link. `sessionStorage` is same-origin, is not settable by a link,
 * and does not survive being sent to someone else, so possession of a matching
 * entry distinguishes "our own navigation" from "a URL somebody sent you".
 * Single-use: consuming it clears it, so a reload can't silently re-dial.
 *
 * NOTE (v2.99.48): a Web Push tap cannot use this — a service worker has no
 * access to `sessionStorage` — so that path deliberately lands on a prefilled
 * pad and needs one confirming tap. That is the honest tradeoff, not a bug.
 */
const DIAL_INTENT_KEY = "relay_dial_intent";

export function markDialIntent(target: string): void {
  try {
    sessionStorage.setItem(DIAL_INTENT_KEY, target);
  } catch {
    /* storage unavailable → the dialer just asks for a tap (fails safe) */
  }
}

/** Read-and-clear. Returns the marked target, or null when none was set. */
export function consumeDialIntent(): string | null {
  try {
    const v = sessionStorage.getItem(DIAL_INTENT_KEY);
    if (v) sessionStorage.removeItem(DIAL_INTENT_KEY);
    return v || null;
  } catch {
    return null;
  }
}
