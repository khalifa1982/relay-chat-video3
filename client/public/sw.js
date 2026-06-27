/*
 * RELAY service worker — intentionally minimal.
 *
 * Its ONLY job is to make the app installable (a registered SW with a fetch
 * handler is part of the install criteria). It deliberately does NOT cache
 * anything and does NOT intercept requests: the fetch handler is a no-op that
 * lets the browser perform its normal network fetch. This guarantees there is
 * never a stale-asset problem and the SW can never break the live app, the
 * tRPC API, or the long-lived SSE signaling stream.
 *
 * (Offline caching can be layered on later — carefully, and never over /api/.)
 */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {
  /* no-op: do not call respondWith → browser handles the request normally */
});
