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

self.addEventListener("push", (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch { /* non-JSON push */ }
  const isCall = d.kind === "incoming-call";
  event.waitUntil(
    self.registration.showNotification(d.title || "RELAY", {
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
