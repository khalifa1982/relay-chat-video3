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
import { lockedConversationIds, onGroupLocksChanged } from "./groupLock";

const CACHE = "relay-prefs-v1";
const KEY = "/__relay_alert_prefs";

/**
 * The shape, defined ONCE in `shared/` and re-exported so every existing import of
 * `AlertPrefs` from this module is unchanged (v2.107.11).
 *
 * It moved because the server now needs the same three lists: the OS-rendered push
 * transports do not pass through the worker, so the sender applies the rule itself
 * and two declarations of "what a device has muted" would be two things to keep in
 * step.
 *
 * `locked` is REDACTED rather than suppressed, which is the difference between a
 * lock and a mute. The message push carries the body since v2.107.8, so a locked
 * chat's banner would otherwise quote it — and even before that the sender's name
 * alone told whoever is holding the phone who is in there and that they are active.
 * Suppressing instead would lose the message, which a privacy screen has no
 * business doing.
 */
export type { AlertPrefs } from "@shared/alertPrefs";
import type { AlertPrefs } from "@shared/alertPrefs";

export async function writeAlertPrefsToSw(prefs: AlertPrefs): Promise<void> {
  try {
    if (typeof caches === "undefined") return;
    const cache = await caches.open(CACHE);
    await cache.put(
      KEY,
      new Response(JSON.stringify({ dnd: prefs.dnd, muted: prefs.muted, locked: prefs.locked }), {
        headers: { "Content-Type": "application/json" },
      })
    );
  } catch {
    /* the worker fails open, so a write failure only costs the suppression */
  }
}

/** This device's three switches, read from where each of them lives. */
export function readAlertPrefs(): AlertPrefs {
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
  // Read through the module that OWNS the lock store rather than re-parsing its
  // localStorage key here: a second reader of that shape is how the page and the
  // worker come to disagree about which groups are locked.
  let locked: number[] = [];
  try {
    locked = lockedConversationIds();
  } catch {
    /* the worker fails open — an unread lock list only costs the redaction */
  }
  return { dnd, muted, locked };
}

/* ── the SECOND mirror, for pushes the worker never sees (v2.107.11) ──────────
 *
 * The Cache Storage copy above is read by the service worker, and that covered
 * every OS alert for as long as Web Push was the only way to raise one. v2.107.8
 * gave the native shells OS-rendered notifications (an FCM `notification` block,
 * and Expo pushes) which reach the notification centre with no worker involved —
 * so on a phone, DND stopped silencing, a muted chat buzzed anyway, and a LOCKED
 * group's message text appeared on the lock screen.
 *
 * Those transports are addressed by a subscription row, so the same prefs are
 * mirrored there too, by whoever holds the endpoint. This module does not make the
 * call — it has no tRPC client and importing one here would drag React state into
 * a plain module — it just says WHEN, and `RelayEngine` (which registered the
 * token and therefore knows the endpoint) does the sending.
 */
const prefListeners = new Set<(p: AlertPrefs) => void>();

/** Subscribe to every change of this device's alert prefs. */
export function onAlertPrefsChanged(fn: (p: AlertPrefs) => void): () => void {
  prefListeners.add(fn);
  return () => {
    prefListeners.delete(fn);
  };
}

/** Read the three settings and mirror them to every copy. Called on boot and
 *  whenever any of them changes. */
export function syncAlertPrefsToSw(): void {
  const prefs = readAlertPrefs();
  void writeAlertPrefsToSw(prefs);
  prefListeners.forEach((l) => {
    try {
      l(prefs);
    } catch {
      /* one bad subscriber must not stop the worker mirror or the rest */
    }
  });
}

/**
 * Keep the worker's copy current when a lock is set or removed (v2.105.20).
 *
 * Registered HERE, at module scope, rather than called from each of `groupLock`'s
 * writers: `mutedThreads.ts` and `dnd.ts` each remember to call `syncAlertPrefsToSw`
 * after their own write, and that per-call-site duty is exactly the shape a third
 * caller forgets — after which a locked chat's notification names a member. One
 * subscription covers every present and future writer, and the edge points this way
 * because `groupLock` importing this module would close a cycle.
 */
onGroupLocksChanged(() => syncAlertPrefsToSw());
