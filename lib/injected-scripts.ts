/**
 * JavaScript injected into the RELAY web app running inside the WebView.
 *
 * Two responsibilities:
 *  1. VERSION_WATCH_JS — report the footer version string so native can prompt
 *     a reload when the deployed web app changes.
 *  2. CALL_WATCH_JS — detect when a WebRTC voice/video call is active or has
 *     ended and report it to native. Native uses this to keep the media session
 *     alive in the background, enable picture-in-picture, keep the screen awake,
 *     and (on resume) re-acquire the camera so the preview never stays frozen.
 *
 * Each script must be self-contained and must end with `true;` so the WebView
 * does not log an evaluation warning.
 */

export const VERSION_WATCH_JS = `(() => {
  try {
    if (window.__relayVersionWatch) return;
    window.__relayVersionWatch = true;
    var post = function (v) {
      try {
        window.ReactNativeWebView &&
          window.ReactNativeWebView.postMessage(
            JSON.stringify({ type: 'relay-version', version: v })
          );
      } catch (e) {}
    };
    var read = function () {
      var m = (document.body && document.body.innerText || '').match(/v\\d+\\.\\d+\\.\\d+/);
      return m ? m[0] : null;
    };
    var report = function () { var v = read(); if (v) post(v); };
    report();
    setInterval(report, 60000);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') report();
    });
  } catch (e) {}
})();
true;`;

/**
 * Detects active calls by:
 *  - Patching RTCPeerConnection to track how many live peer connections exist.
 *  - Tracking whether any getUserMedia stream with a live video track exists.
 * It reports `{ type: 'relay-call', active, hasVideo }` to native whenever the
 * state changes, and exposes `window.__relayReacquireCamera()` so native can
 * ask the page to refresh its camera track after returning to the foreground
 * (this clears the "frozen frame" seen on resume).
 */
export const CALL_WATCH_JS = `(() => {
  try {
    if (window.__relayCallWatch) return;
    window.__relayCallWatch = true;

    var state = { active: false, hasVideo: false, ringing: false };
    var peers = new Set();
    var localStreams = new Set();

    var post = function () {
      try {
        window.ReactNativeWebView &&
          window.ReactNativeWebView.postMessage(
            JSON.stringify({ type: 'relay-call', active: state.active, hasVideo: state.hasVideo, ringing: state.ringing })
          );
      } catch (e) {}
    };

    var setRinging = function (v, caller) {
      if (state.ringing === v) return;
      state.ringing = v;
      try {
        window.ReactNativeWebView &&
          window.ReactNativeWebView.postMessage(
            JSON.stringify({ type: 'relay-ring', ringing: v, caller: caller || null })
          );
      } catch (e) {}
    };

    // --- Incoming-call (ringing) detection ---
    // RELAY shows an incoming-call UI before the user answers. We detect it by
    // scanning for typical incoming-call markers (Accept/Decline buttons or an
    // "incoming"/"is calling" label). When it appears we tell native to ring;
    // when it disappears (answered or missed) we tell native to stop.
    var detectRinging = function () {
      try {
        var text = (document.body && document.body.innerText || '').toLowerCase();
        var hasIncoming =
          /incoming call|is calling|incoming voice|incoming video/.test(text);
        var hasAccept = !!document.querySelector(
          '[data-incoming-call], [data-call-accept], .incoming-call, .call-incoming'
        );
        var ringing = hasIncoming || hasAccept;
        // Don't treat an already-connected call as ringing.
        if (state.active) ringing = false;
        var caller = null;
        // Prefer an explicit hook the web app can expose.
        var nameEl = document.querySelector(
          '[data-caller-name], [data-incoming-call] .caller-name, .incoming-call .caller-name, .call-incoming .caller'
        );
        if (nameEl) {
          caller = (nameEl.getAttribute('data-caller-name') || nameEl.textContent || '').trim() || null;
        }
        if (!caller) {
          var body = (document.body && document.body.innerText || '');
          // Match several common phrasings: "X is calling", "Incoming call from X",
          // "X wants to talk", "Call from X".
          var patterns = [
            /([\w .'+-]{1,40})\s+is calling/i,
            /incoming (?:voice |video )?call from\s+([\w .'+-]{1,40})/i,
            /call from\s+([\w .'+-]{1,40})/i,
            /([\w .'+-]{1,40})\s+wants to (?:talk|call)/i,
          ];
          for (var pi = 0; pi < patterns.length; pi++) {
            var mm = body.match(patterns[pi]);
            if (mm && mm[1]) { caller = mm[1].trim(); break; }
          }
        }
        setRinging(ringing, caller);
      } catch (e) {}
    };

    var recompute = function () {
      var active = peers.size > 0;
      var hasVideo = false;
      localStreams.forEach(function (s) {
        try {
          s.getVideoTracks().forEach(function (t) {
            if (t.readyState === 'live' && t.enabled) hasVideo = true;
          });
        } catch (e) {}
      });
      if (active !== state.active || hasVideo !== state.hasVideo) {
        state.active = active;
        state.hasVideo = hasVideo;
        post();
      }
    };

    // --- Patch RTCPeerConnection to know when calls start/stop ---
    var RTC = window.RTCPeerConnection || window.webkitRTCPeerConnection;
    if (RTC) {
      var Orig = RTC;
      var Patched = function () {
        var pc = new Orig(arguments[0], arguments[1]);
        peers.add(pc);
        var cleanup = function () {
          if (pc.connectionState === 'closed' ||
              pc.connectionState === 'failed' ||
              pc.connectionState === 'disconnected' ||
              pc.iceConnectionState === 'closed') {
            peers.delete(pc);
            recompute();
          }
        };
        pc.addEventListener('connectionstatechange', function () { recompute(); cleanup(); });
        pc.addEventListener('iceconnectionstatechange', cleanup);
        var origClose = pc.close.bind(pc);
        pc.close = function () { peers.delete(pc); recompute(); return origClose(); };
        recompute();
        return pc;
      };
      Patched.prototype = Orig.prototype;
      try {
        window.RTCPeerConnection = Patched;
        if (window.webkitRTCPeerConnection) window.webkitRTCPeerConnection = Patched;
      } catch (e) {}
    }

    // --- Track local media streams (for hasVideo + camera re-acquire) ---
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      var origGUM = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      window.__relayLastConstraints = { audio: true, video: true };
      navigator.mediaDevices.getUserMedia = function (constraints) {
        window.__relayLastConstraints = constraints || window.__relayLastConstraints;
        return origGUM(constraints).then(function (stream) {
          localStreams.add(stream);
          stream.getTracks().forEach(function (t) {
            t.addEventListener('ended', function () { recompute(); });
          });
          recompute();
          return stream;
        });
      };
    }

    // Exposed for native: refresh the camera track to clear a frozen preview.
    window.__relayReacquireCamera = function () {
      try {
        if (!state.active || !state.hasVideo) return;
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
        // Touch enabled flag to force the browser to re-render the latest frame.
        localStreams.forEach(function (s) {
          s.getVideoTracks().forEach(function (t) {
            try { t.enabled = false; setTimeout(function () { t.enabled = true; }, 60); } catch (e) {}
          });
        });
      } catch (e) {}
    };

    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') {
        setTimeout(function () { try { window.__relayReacquireCamera(); } catch (e) {} }, 150);
        recompute();
      }
    });

    // --- Audio output (speaker) route detection ---
    // RELAY shows a speaker/audio-output control during a call. We watch for an
    // active 'speaker on' state and a Bluetooth indicator, and report the chosen
    // route to native so it can route audio to earpiece / loudspeaker / Bluetooth.
    var lastRoute = null;
    var detectAudioRoute = function () {
      try {
        var route = null;
        // Explicit hooks the web app can expose (preferred).
        var el = document.querySelector('[data-audio-route]');
        if (el) route = (el.getAttribute('data-audio-route') || '').toLowerCase();
        if (!route) {
          var btOn = document.querySelector(
            '[data-bluetooth-active], .bluetooth-active, [aria-label*="Bluetooth" i][aria-pressed="true"]'
          );
          var spkOn = document.querySelector(
            '[data-speaker-active], .speaker-active, [aria-label*="speaker" i][aria-pressed="true"], button.speaker.active'
          );
          if (btOn) route = 'bluetooth';
          else if (spkOn) route = 'speaker';
          else if (state.active) route = 'earpiece';
        }
        if (route && route !== lastRoute) {
          lastRoute = route;
          try {
            window.ReactNativeWebView &&
              window.ReactNativeWebView.postMessage(
                JSON.stringify({ type: 'relay-audio-route', route: route })
              );
          } catch (e) {}
        }
      } catch (e) {}
    };

    // --- Online presence detection ---
    // The user is "online" (available for calls) once they're past the name-entry
    // screen. We infer this from the URL being an /app sub-route AND the absence
    // of a name-entry form. Native uses this to keep the app reachable in the
    // background so incoming calls still ring when minimized.
    var lastOnline = null;
    var detectOnline = function () {
      try {
        var path = (location.pathname || '').toLowerCase();
        var onAppRoute = path.indexOf('/app') === 0;
        var entry = document.querySelector(
          'input[name="name" i], input[placeholder*="name" i], [data-name-entry], [data-login-screen]'
        );
        var explicit = document.querySelector('[data-online="true"]');
        var online = !!explicit || (onAppRoute && !entry);
        if (online !== lastOnline) {
          lastOnline = online;
          try {
            window.ReactNativeWebView &&
              window.ReactNativeWebView.postMessage(
                JSON.stringify({ type: 'relay-online', online: online })
              );
          } catch (e) {}
        }
      } catch (e) {}
    };

    // --- Screen-share enablement ---
    // Some Android WebView builds expose getDisplayMedia but the page may guard
    // it behind a feature check. Ensure the API is present so RELAY's share-screen
    // button works; the actual capture permission is auto-granted natively.
    try {
      if (navigator.mediaDevices && !navigator.mediaDevices.getDisplayMedia &&
          navigator.mediaDevices.getUserMedia) {
        navigator.mediaDevices.getDisplayMedia = function (constraints) {
          var c = constraints || { video: true };
          return navigator.mediaDevices.getUserMedia(c);
        };
      }
    } catch (e) {}

    // --- Incoming-message detection ---
    // Track unread badge / new message rows so native can post a message
    // notification when the count increases while backgrounded.
    var lastUnread = 0;
    var detectMessages = function () {
      try {
        var n = 0;
        var badge = document.querySelector(
          '[data-unread-count], .unread-count, .badge-unread'
        );
        if (badge) {
          var bv = parseInt((badge.getAttribute('data-unread-count') || badge.textContent || '0').replace(/[^0-9]/g, ''), 10);
          if (!isNaN(bv)) n = bv;
        }
        if (n > lastUnread) {
          try {
            window.ReactNativeWebView &&
              window.ReactNativeWebView.postMessage(
                JSON.stringify({ type: 'relay-message', count: n })
              );
          } catch (e) {}
        }
        lastUnread = n;
      } catch (e) {}
    };

    // Poll the DOM for the incoming-call UI and react to changes.
    setInterval(detectRinging, 1200);
    setInterval(detectMessages, 1500);
    setInterval(detectAudioRoute, 1000);
    setInterval(detectOnline, 1500);
    detectOnline();
    if (window.MutationObserver) {
      try {
        var mo = new MutationObserver(function () { detectRinging(); });
        mo.observe(document.documentElement, { childList: true, subtree: true });
      } catch (e) {}
    }
    detectRinging();

    post();
  } catch (e) {}
})();
true;`;

/**
 * SESSION_PERSIST_JS — keep the user signed in across full app restarts.
 *
 * Many web apps keep their auth token in `sessionStorage`, which the Android
 * WebView clears when the app process is killed (so the user appears logged out
 * every cold start even though cookies/localStorage persist). This bridge
 * mirrors any sessionStorage entries into localStorage under a namespaced key
 * and rehydrates sessionStorage from that mirror on the next launch — WITHOUT
 * overwriting values the page has already set this session. It is a no-op for
 * apps that already persist to localStorage.
 */
export const SESSION_PERSIST_JS = `(() => {
  try {
    if (window.__relaySessionPersist) return;
    window.__relaySessionPersist = true;
    var NS = '__relay_ss__';

    var rehydrate = function () {
      try {
        var raw = localStorage.getItem(NS);
        if (!raw) return;
        var saved = JSON.parse(raw);
        Object.keys(saved).forEach(function (k) {
          // Do not clobber anything the page already put in this session.
          if (sessionStorage.getItem(k) === null) {
            try { sessionStorage.setItem(k, saved[k]); } catch (e) {}
          }
        });
      } catch (e) {}
    };

    var snapshot = function () {
      try {
        var out = {};
        for (var i = 0; i < sessionStorage.length; i++) {
          var k = sessionStorage.key(i);
          if (k === null) continue;
          out[k] = sessionStorage.getItem(k);
        }
        localStorage.setItem(NS, JSON.stringify(out));
      } catch (e) {}
    };

    // Restore first, then keep the mirror fresh.
    rehydrate();
    snapshot();
    setInterval(snapshot, 5000);
    document.addEventListener('visibilitychange', function () {
      // Persist right before the app is likely backgrounded/killed.
      if (document.visibilityState === 'hidden') snapshot();
      else rehydrate();
    });
    window.addEventListener('pagehide', snapshot);
    window.addEventListener('beforeunload', snapshot);
  } catch (e) {}
})();
true;`;

/** Combined script injected once on load. */
export const INJECTED_JS =
  SESSION_PERSIST_JS + "\n" + VERSION_WATCH_JS + "\n" + CALL_WATCH_JS;
