/**
 * Mirror the per-device alert prefs into Cache Storage so the service worker
 * can read them (v2.99.42).
 *
 * Do Not Disturb (`dnd.ts`) and per-conversation mute (`mutedThreads.ts`) are
 * per-DEVICE settings kept in localStorage, and they were enforced in the page:
 * `useRealtime` simply didn't chime or pop for a muted thread. That was enough
 * while every alert originated in an open tab. It stopped being enough when the
 * server began pushing for new messages, because a Web Push goes straight to the
 * OS — so a muted thread would buzz the phone anyway and DND would be ignored.
 *
 * A service worker cannot read localStorage, so the page copies the two values
 * into a Cache entry the worker reads on each push. Cache Storage is the lightest
 * origin-scoped store both sides can reach; the payload is two booleans-worth of
 * data, so there is nothing to keep in sync beyond "write on change".
 *
 * Best-effort throughout: if this never runs, the worker's read fails open and
 * shows the notification — the pre-v2.99.42 behaviour.
 */
const CACHE = "relay-prefs-v1";
const KEY = "/__relay_alert_prefs";

export interface AlertPrefs {
  dnd: boolean;
  muted: number[];
}

export async function writeAlertPrefsToSw(prefs: AlertPrefs): Promise<void> {
  try {
    if (typeof caches === "undefined") return;
    const cache = await caches.open(CACHE);
    await cache.put(
      KEY,
      new Response(JSON.stringify({ dnd: prefs.dnd, muted: prefs.muted }), {
        headers: { "Content-Type": "application/json" },
      })
    );
  } catch {
    /* the worker fails open, so a write failure only costs the suppression */
  }
}

/** Read the two localStorage values and push them to the worker. Called on boot
 *  and whenever either setting changes. */
export function syncAlertPrefsToSw(): void {
  let dnd = false;
  let muted: number[] = [];
  try {
    dnd = localStorage.getItem("relay_dnd") === "1";
  } catch {
    /* private mode */
  }
  try {
    const raw = localStorage.getItem("relay_muted_threads");
    const arr = raw ? JSON.parse(raw) : [];
    if (Array.isArray(arr)) muted = arr.filter((x) => typeof x === "number");
  } catch {
    /* malformed or unavailable */
  }
  void writeAlertPrefsToSw({ dnd, muted });
}
