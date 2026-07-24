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
 * once when the document boots, before any routing has happened. A `to=` present
 * here therefore means "the user arrived on this URL", while one that appears
 * later can only have come from in-app navigation.
 *
 * Empty string during SSR/tests where `window` is absent.
 */
export const BOOT_SEARCH: string =
  typeof window !== "undefined" && window.location ? window.location.search : "";

/**
 * True when the document was loaded with a `to=` dial target — i.e. the dial
 * intent came from OUTSIDE the app (a pasted or clicked link, or a reload)
 * rather than from a tap inside it. Such a target must be confirmed by the user
 * instead of dialed automatically.
 */
export function bootedWithDialTarget(): boolean {
  return /(^|[?&])to=/.test(BOOT_SEARCH);
}

/**
 * One-time, same-origin proof that THIS app generated a full-page dial
 * navigation — used by the flows that legitimately need one, notably the
 * "<name> is back online — tap to call them now" notification, which the user
 * explicitly armed and which navigates with `window.location.href` (a real
 * document load, so `bootedWithDialTarget()` is true for it).
 *
 * A marker inside the URL would be worthless — an attacker just copies it into
 * their own link. `sessionStorage` is same-origin, is not settable by a link,
 * and does not survive being sent to someone else, so possession of a matching
 * entry distinguishes "our own navigation" from "a URL somebody sent you".
 * Single-use: consuming it clears it, so a reload can't silently re-dial.
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
