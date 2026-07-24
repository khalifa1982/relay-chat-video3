/*
 * RELAY service worker — installability + Web Push, nothing else.
 *
 * It deliberately does NOT cache anything and does NOT intercept requests: the
 * fetch handler is a no-op that lets the browser perform its normal network
 * fetch. This guarantees there is never a stale-asset problem and the SW can
 * never break the live app, the tRPC API, or the long-lived SSE signaling
 * stream. (Offline caching can be layered on later — carefully, never over /api/.)
 *
 * v2.83 adds Web Push: the server WAKES devices that have no live connection —
 * an incoming-call page ("X is calling — open RELAY to answer"; the signaling
 * server keeps the dial alive and delivers the ring the moment the app opens)
 * and missed-call notices. On iPhone/iPad this requires iOS 16.4+ AND the app
 * installed to the Home Screen (Apple's restriction on web push).
 */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {
  /* no-op: do not call respondWith → browser handles the request normally */
});

/**
 * Per-device alert prefs, mirrored into Cache Storage by the app (see
 * client/src/app/swPrefs.ts) because a service worker cannot read localStorage.
 *
 * Do Not Disturb and per-conversation mute have always been per-DEVICE settings
 * enforced in the page. Once the server started pushing for new messages
 * (v2.99.42) that enforcement point was no longer enough: a push goes straight
 * to the OS, so a muted thread would still buzz the phone and DND would be
 * ignored — breaking exactly the promise those switches make. The worker is the
 * right place to honour them, since it is per-device like the settings.
 *
 * Fails OPEN: any read problem shows the notification. Missing an alert is worse
 * than an unwanted one for calls, and this only ever suppresses.
 */
async function alertPrefs() {
  try {
    const cache = await caches.open("relay-prefs-v1");
    const res = await cache.match("/__relay_alert_prefs");
    if (!res) return { dnd: false, muted: [] };
    const p = await res.json();
    return { dnd: p.dnd === true, muted: Array.isArray(p.muted) ? p.muted : [] };
  } catch {
    return { dnd: false, muted: [] };
  }
}

/** Should this push be silenced on this device? Calls are never suppressed by
 *  mute (mute is per-conversation, about messages); DND covers both. */
async function suppressed(d) {
  const isMessage = d.kind === "message";
  if (!isMessage && d.kind !== "missed-call" && d.kind !== "voicemail") return false;
  const prefs = await alertPrefs();
  if (prefs.dnd) return true;
  if (!isMessage) return false;
  const m = /^relay-msg-(\d+)$/.exec(d.tag || "");
  if (!m) return false;
  return prefs.muted.indexOf(Number(m[1])) !== -1;
}

self.addEventListener("push", (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch { /* non-JSON push */ }
  const isCall = d.kind === "incoming-call";
  event.waitUntil(
    suppressed(d).then((skip) => {
      if (skip) return undefined;
      return self.registration.showNotification(d.title || "RELAY", {
      body: d.body || "",
      tag: d.tag || (isCall ? "relay-call" : "relay"),
      icon: "/icon.svg",
      badge: "/icon.svg",
      // Ask the OS for sound+vibration; renotify so a fresh call re-alerts even
      // when an older notification with the same tag is still up.
      renotify: true,
      requireInteraction: isCall, // a ringing call should stay on screen
      silent: false,
      vibrate: isCall ? [400, 200, 400, 200, 400] : [200, 100, 200],
      data: { url: d.url || "/app/dialer" },
      });
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/app/dialer";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      // Focus an existing RELAY window if one is alive (its engine reconnects
      // and receives the held ring instantly); otherwise open a fresh one.
      for (const w of wins) {
        if ("focus" in w) {
          try {
            w.focus();
            if ("navigate" in w && !String(w.url).includes("/app/")) w.navigate(url);
          } catch { /* focus/navigate best-effort */ }
          return;
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
