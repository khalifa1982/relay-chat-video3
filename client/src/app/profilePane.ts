/**
 * Ask the Profile page to open on a particular pane (v2.101.0).
 *
 * WHY THIS IS NOT A URL. Profile's panes are LOCAL STATE, and deliberately so:
 * wouter's `useLocation` returns `location.pathname` ONLY, so a `#pane` or
 * `?pane=` navigation re-renders nothing — the tap would appear to do nothing with
 * no error to explain why — and a real sub-route per pane would put ten entries in
 * the app's history for one screen (recorded in v2.99.89).
 *
 * So the intent travels out of band. `sessionStorage` rather than a module
 * variable because the caller navigates first and Profile is a LAZY route: its
 * module may not have evaluated when the intent is set, and a module-scoped value
 * in a different chunk would be a different value.
 *
 * ONE-SHOT by construction: `takeProfilePane` reads and clears in the same call,
 * so returning to Profile later does not silently reopen a pane the person closed.
 * Every storage access is guarded — a blocked `sessionStorage` (private mode,
 * some embedded webviews) must degrade to landing on the hub, never throw on the
 * way to a page.
 */
const KEY = "relay_profile_pane";

export function requestProfilePane(pane: string): void {
  try {
    sessionStorage.setItem(KEY, pane);
  } catch {
    /* the person lands on the hub instead — one extra tap, never an error */
  }
}

/** Read the pending pane and clear it. Returns null when there is none. */
export function takeProfilePane(): string | null {
  try {
    const v = sessionStorage.getItem(KEY);
    if (v) sessionStorage.removeItem(KEY);
    return v || null;
  } catch {
    return null;
  }
}
