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
    if (!res) return { dnd: false, muted: [], locked: [] };
    const p = await res.json();
    return {
      dnd: p.dnd === true,
      muted: Array.isArray(p.muted) ? p.muted : [],
      // Absent for a page older than v2.105.20, which reads as "nothing locked" —
      // i.e. exactly today's behaviour, so a mid-rollout worker cannot redact
      // notifications for a device that has set no locks.
      locked: Array.isArray(p.locked) ? p.locked : [],
    };
  } catch {
    return { dnd: false, muted: [], locked: [] };
  }
}

/** The conversation a message push is about, from its own tag, or null. */
function convOf(d) {
  const m = /^relay-msg-(\d+)$/.exec((d && d.tag) || "");
  return m ? Number(m[1]) : null;
}

/**
 * Is this push for a group locked on this device? (v2.105.20)
 *
 * REDACTION, NOT SUPPRESSION, and the distinction is the whole point of the lock
 * being a privacy screen: a mute means "do not tell me", so it drops the
 * notification; a lock means "do not show it on this screen", so the alert must
 * still arrive and merely stop naming anybody. Suppressing would silently lose
 * messages the user still wants to know about.
 *
 * Fails OPEN like everything else here: an unreadable pref list shows the ordinary
 * notification rather than redacting the world.
 */
async function lockedConv(d) {
  if (!d || d.kind !== "message") return false;
  const c = convOf(d);
  if (c === null) return false;
  const prefs = await alertPrefs();
  return prefs.locked.indexOf(c) !== -1;
}

/**
 * Should this push be silenced on this device?
 *
 * TWO SEPARATE RULES, and they have different scopes:
 *   - DND applies to EVERY kind except a ring. A ring is exempt because missing a
 *     call is worse than an unwanted buzz, and because it is the one alert the
 *     recipient cannot get later.
 *   - MUTE is per-CONVERSATION and therefore only ever about messages.
 *
 * v2.99.81 — DND IS NOW THE DEFAULT, NOT AN OPT-IN LIST. This used to early-return
 * "not suppressed" for any kind outside message / missed-call / voicemail, BEFORE
 * the prefs were read — so `contact-online` ("X is back online, tap to call them")
 * buzzed the phone with Do Not Disturb on, and the same alert delivered IN-PAGE
 * already honoured DND, so the two paths disagreed about the user's own setting.
 * The list-of-covered-kinds shape is also the kind that gets forgotten: any future
 * push kind was silently DND-exempt. Inverting the default makes a new kind safe
 * without anybody remembering to add it — the same reasoning that put the
 * `pushEnabled` check inside `sendPushToIdentity` rather than at its call sites.
 */
async function suppressed(d) {
  // A ring is never silenced here. (No code path currently sends one — that was
  // removed in v2.99.11 at the owner's request — but the kind remains, so the
  // exemption has to be explicit rather than implied by a list.)
  if (d.kind === "incoming-call") return false;
  const prefs = await alertPrefs();
  if (prefs.dnd) return true;
  // Mute stays message-only: a per-conversation mute must not silence a missed
  // call or a voicemail from that same person.
  if (d.kind !== "message") return false;
  const c = convOf(d);
  if (c === null) return false;
  return prefs.muted.indexOf(c) !== -1;
}

self.addEventListener("push", (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch { /* non-JSON push */ }
  const isCall = d.kind === "incoming-call";
  event.waitUntil(
    // Both questions are asked before anything is shown. Mute/DND decide WHETHER,
    // the lock decides WHAT — a locked group still alerts, it just names nobody.
    Promise.all([suppressed(d), lockedConv(d)]).then(([skip, hide]) => {
      if (skip) return undefined;
      return self.registration.showNotification(hide ? "RELAY" : d.title || "RELAY", {
      body: hide ? "New message in a locked chat" : d.body || "",
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
