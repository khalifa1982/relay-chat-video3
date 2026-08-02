/**
 * JavaScript injected into the RELAY web app running inside the WebView.
 *
 * Responsibilities:
 *  1. VERSION_WATCH_JS — report the footer version string so native can prompt
 *     a reload when the deployed web app changes.
 *  2. CALL_WATCH_JS — detect when a WebRTC voice/video call is active or has
 *     ended and report it to native. Also handles:
 *     - Speaker enablement on inbound calls (Bug #1)
 *     - Audio track monitoring to prevent one-way audio (Bug #2)
 *     - Audio route detection and reporting
 *  3. SESSION_PERSIST_JS — bridge sessionStorage to localStorage for persistence.
 *  4. AUDIO_FIX_JS — force proper audio constraints and speaker on call connect.
 *  5. HANGUP_ICON_FIX_JS — CSS injection to fix corrupted hang-up button icon.
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
 * ask the page to refresh its camera track after returning to the foreground.
 *
 * BUG #1 FIX: When a call connects (peer connection state → "connected"), we
 * automatically request speaker mode from native. This fixes the issue where
 * inbound calls start on earpiece and the speaker button doesn't work.
 *
 * BUG #2 FIX: We monitor all local audio tracks and re-enable any that get
 * accidentally disabled. We also ensure getUserMedia always requests audio
 * with proper constraints for full-duplex communication.
 */
export const CALL_WATCH_JS = `(() => {
  try {
    if (window.__relayCallWatch) return;
    window.__relayCallWatch = true;

    var state = { active: false, hasVideo: false, ringing: false };
    var peers = new Set();
    var localStreams = new Set();
    // Track whether the current call was inbound (ringing detected before connect)
    var wasRinging = false;
    // Track whether we already forced speaker for this call session
    var speakerForced = false;
    // Startup grace period: suppress ring detection for the first 4 seconds
    // after script injection to avoid false positives during initial page render.
    var startupTime = Date.now();
    var STARTUP_GRACE_MS = 4000;
    // Debounce: require ringing to be detected on 2 consecutive cycles before
    // actually firing the notification. This prevents transient DOM states from
    // triggering false alarms.
    var ringDebounceCount = 0;
    var RING_DEBOUNCE_THRESHOLD = 2;

    var post = function () {
      try {
        window.ReactNativeWebView &&
          window.ReactNativeWebView.postMessage(
            JSON.stringify({ type: 'relay-call', active: state.active, hasVideo: state.hasVideo, ringing: state.ringing })
          );
      } catch (e) {}
    };

    var postAudioRoute = function (route) {
      try {
        window.ReactNativeWebView &&
          window.ReactNativeWebView.postMessage(
            JSON.stringify({ type: 'relay-audio-route', route: route })
          );
      } catch (e) {}
    };

    var setRinging = function (v, caller) {
      if (state.ringing === v) return;
      state.ringing = v;
      if (v) wasRinging = true;
      try {
        window.ReactNativeWebView &&
          window.ReactNativeWebView.postMessage(
            JSON.stringify({ type: 'relay-ring', ringing: v, caller: caller || null })
          );
      } catch (e) {}
    };

    // --- BUG #1 FIX: Force speaker on call connect ---
    // When a peer connection transitions to "connected" state, automatically
    // tell native to switch to speaker mode. This fixes the issue where
    // accepting an inbound call leaves audio on earpiece with no way to switch.
    var forceSpeakerOnConnect = function () {
      if (speakerForced) return;
      speakerForced = true;
      // Small delay to let the audio session fully initialize
      setTimeout(function () {
        postAudioRoute('speaker');
      }, 300);
    };

    // --- REMOVED: the audio-track "health monitor" ---
    //
    // It re-enabled every disabled local audio track on a 2-second interval, to
    // prevent one-way audio. But track.enabled = false is EXACTLY how the web
    // app mutes the microphone — so tapping mute silenced you for at most two
    // seconds and then the shell turned your microphone back on, while the mute
    // button kept rendering as muted. The user believed they were muted, said
    // something private, and the other side heard it.
    //
    // The shell cannot tell "accidentally disabled" from "the user pressed mute"
    // — both are the same one-bit state — so there is no safe version of this
    // check to keep. If one-way audio is a real problem it has to be fixed in the
    // web app, which is the only layer that knows the user's intent. A mute
    // button that does not mute is categorically worse than the bug this was
    // reaching for.

    // --- Incoming-call (ringing) detection ---
    // FIXED: The old logic was too broad — it matched "is calling" or "incoming call"
    // text anywhere on the page (including the normal dialer UI labels like
    // "Voice Call", "Video Call"). Now we require STRONG evidence:
    //  1. A dedicated incoming-call DOM element (accept/decline buttons, modal overlay)
    //  2. OR specific "X is calling you" / "incoming call from X" text patterns
    //     that are distinct from static UI labels.
    // Additionally, we suppress detection during the startup grace period and
    // require 2 consecutive positive detections (debounce) before firing.
    var detectRinging = function () {
      try {
        // Startup grace: don't detect ringing in the first few seconds after load
        if (Date.now() - startupTime < STARTUP_GRACE_MS) return;

        // If a call is already active, there's no "incoming" ring.
        if (state.active) {
          if (state.ringing) setRinging(false, null);
          ringDebounceCount = 0;
          return;
        }

        // STRONG signal: dedicated incoming-call DOM elements with accept/decline actions.
        // These are specific modal/overlay elements that ONLY appear during a real incoming call.
        var hasCallModal = !!document.querySelector(
          '[data-incoming-call], [data-call-accept], [data-call-decline], ' +
          '.incoming-call-overlay, .incoming-call-modal, ' +
          '.call-incoming[data-ringing], .ringing-overlay, ' +
          'button[data-action="accept-call"], button[data-action="decline-call"]'
        );

        // MEDIUM signal: text patterns that are specific to an active ringing state
        // (not generic UI labels like "Voice Call" or "Video Call").
        var body = (document.body && document.body.innerText || '');
        // Only match dynamic text like "John is calling..." or "Incoming call from John"
        // Exclude static labels by requiring a name before "is calling" or after "from"
        var hasRingingText = /\bis calling\.{0,3}$|\bis calling you|incoming call from\s+\S/im.test(body);

        // We need the call modal OR very specific ringing text.
        // The text-only signal requires an additional check: there must be
        // accept/decline-like buttons visible (not just static page text).
        var hasActionButtons = !!document.querySelector(
          'button[class*="accept"], button[class*="answer"], ' +
          'button[class*="decline"], button[class*="reject"], ' +
          '[role="button"][class*="accept"], [role="button"][class*="answer"], ' +
          '[data-call-accept], [data-call-decline], ' +
          '.accept-btn, .answer-btn, .decline-btn, .reject-btn'
        );

        var ringing = hasCallModal || (hasRingingText && hasActionButtons);

        // Debounce: require multiple consecutive positive detections
        if (ringing) {
          ringDebounceCount++;
          if (ringDebounceCount < RING_DEBOUNCE_THRESHOLD) return;
        } else {
          ringDebounceCount = 0;
          if (state.ringing) setRinging(false, null);
          return;
        }

        // Extract caller name from dedicated elements or text patterns
        var caller = null;
        var nameEl = document.querySelector(
          '[data-caller-name], [data-incoming-call] .caller-name, ' +
          '.incoming-call-overlay .caller-name, .incoming-call-modal .caller-name, ' +
          '.call-incoming .caller, .ringing-overlay .caller-name'
        );
        if (nameEl) {
          caller = (nameEl.getAttribute('data-caller-name') || nameEl.textContent || '').trim() || null;
        }
        if (!caller) {
          var patterns = [
            /([\u0600-\u06FF\w .'+-]{2,40})\s+is calling/i,
            /incoming (?:voice |video )?call from\s+([\u0600-\u06FF\w .'+-]{2,40})/i,
            /call from\s+([\u0600-\u06FF\w .'+-]{2,40})/i,
          ];
          for (var pi = 0; pi < patterns.length; pi++) {
            var mm = body.match(patterns[pi]);
            if (mm && mm[1]) {
              var candidate = mm[1].trim();
              // Filter out false matches from static UI ("Voice", "Video", "Group")
              if (!/^(voice|video|group|incoming|relay)$/i.test(candidate)) {
                caller = candidate;
                break;
              }
            }
          }
        }
        setRinging(true, caller);
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
        var wasActive = state.active;
        state.active = active;
        state.hasVideo = hasVideo;
        post();
        // When a call ends, tear down all media and notify native.
        if (!active && wasActive) {
          speakerForced = false;
          wasRinging = false;
          // §1 MIC RELEASE: Stop every track we ever acquired
          localStreams.forEach(function (s) {
            try {
              s.getTracks().forEach(function (t) {
                try { t.stop(); } catch (e) {}
              });
            } catch (e) {}
          });
          localStreams.clear();
          // Also stop tracks held by any remaining peer connection senders
          peers.forEach(function (pc) {
            try {
              var senders = pc.getSenders ? pc.getSenders() : [];
              senders.forEach(function (sn) {
                try { if (sn.track) sn.track.stop(); } catch (e) {}
              });
            } catch (e) {}
          });
          // Notify native shell that the call is truly over (mic release trigger)
          try {
            if (window.RelayNative && window.RelayNative.postMessage) {
              window.RelayNative.postMessage(JSON.stringify({ type: 'callEnded' }));
            } else if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.RelayNative) {
              window.webkit.messageHandlers.RelayNative.postMessage(JSON.stringify({ type: 'callEnded' }));
            }
          } catch (e) {}
          // Also send via ReactNativeWebView for RN-side handling
          try {
            window.ReactNativeWebView &&
              window.ReactNativeWebView.postMessage(
                JSON.stringify({ type: 'webCallEnded', callId: '' })
              );
          } catch (e) {}
        }
      }
    };

    // --- Patch RTCPeerConnection to know when calls start/stop ---
    var RTC = window.RTCPeerConnection || window.webkitRTCPeerConnection;
    if (RTC) {
      var Orig = RTC;
      var Patched = function () {
        var pc = new Orig(arguments[0], arguments[1]);
        peers.add(pc);

        // A peer connection is only TERMINAL when it is closed. 'disconnected'
        // is explicitly recoverable in the WebRTC spec — it is what a two-second
        // tunnel or a Wi-Fi/LTE handoff looks like — and 'failed' is what the web
        // app answers with an ICE restart on the SAME connection.
        //
        // Treating either as the end of the call was severe, because recompute()
        // runs the irreversible teardown: track.stop() on every local track (the
        // microphone and camera are then dead for the REST of the call, since
        // stop() cannot be undone), plus reporting the call ended to CallKit and
        // the Android call service. Nothing ever re-added the connection, so one
        // network blip left the shell permanently convinced there was no call.
        //
        // So: close is immediate; disconnected/failed only count if they are
        // still unresolved after a grace window, matching the web app's own
        // reconnect behaviour. Recovery cancels the timer.
        var deadT = null;
        var clearDead = function () {
          if (deadT) { clearTimeout(deadT); deadT = null; }
        };
        var finish = function () {
          clearDead();
          peers.delete(pc);
          recompute();
        };
        var cleanup = function () {
          var cs = pc.connectionState;
          if (cs === 'closed' || pc.iceConnectionState === 'closed') {
            finish();
            return;
          }
          if (cs === 'connected' || cs === 'completed') {
            // Recovered — cancel any pending teardown.
            clearDead();
            return;
          }
          if (cs === 'failed' || cs === 'disconnected') {
            if (!deadT) deadT = setTimeout(function () {
              deadT = null;
              var now = pc.connectionState;
              if (now !== 'connected' && now !== 'completed') finish();
            }, 15000);
          }
        };

        // BUG #1 FIX: When the connection becomes "connected", force speaker.
        pc.addEventListener('connectionstatechange', function () {
          if (pc.connectionState === 'connected') {
            forceSpeakerOnConnect();
            // BUG #2 FIX: Ensure audio tracks are enabled on connect
          }
          recompute();
          cleanup();
        });
        pc.addEventListener('iceconnectionstatechange', function () {
          if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
            forceSpeakerOnConnect();
          }
          cleanup();
        });

        // BUG #2 FIX: When a track is added to the peer connection, ensure
        // audio tracks are enabled. This catches scenarios where the remote
        // side adds tracks that might start disabled.
        pc.addEventListener('track', function (ev) {
          try {
            if (ev.track && ev.track.kind === 'audio') {
              ev.track.enabled = true;
            }
          } catch (e) {}
          // (The local-track "health monitor" that used to run here was removed:
          //  it re-enabled the user's microphone after they muted it. Enabling a
          //  REMOTE track above is unrelated — that is the audio arriving from
          //  the other party, which the local mute button does not control.)
        });

        var origClose = pc.close.bind(pc);
        pc.close = function () { clearDead(); peers.delete(pc); recompute(); return origClose(); };
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
    // BUG #2 FIX: Enhanced getUserMedia patch that ensures audio constraints
    // always include proper settings for full-duplex communication.
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      var origGUM = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      window.__relayLastConstraints = { audio: true, video: true };
      navigator.mediaDevices.getUserMedia = function (constraints) {
        // Ensure audio constraints enable echo cancellation and noise suppression
        // for reliable two-way audio across platforms.
        var c = constraints || {};
        if (c.audio === true) {
          c = Object.assign({}, c, {
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            }
          });
        } else if (c.audio && typeof c.audio === 'object') {
          c = Object.assign({}, c, {
            audio: Object.assign({
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            }, c.audio)
          });
        }
        window.__relayLastConstraints = c;
        return origGUM(c).then(function (stream) {
          localStreams.add(stream);
          // Deliberately does NOT force enabled = true here. A freshly acquired
          // track is already enabled, so this only ever mattered when something
          // had disabled it — i.e. when the user had muted — which made it one
          // more way for the shell to override a mute it cannot interpret.
          stream.getTracks().forEach(function (t) {
            t.addEventListener('ended', function () {
              recompute();
            });
            // NOTE: no 'mute' handler. There used to be one that set
            // enabled = true 100ms after any mute event — the same defeat of
            // the user's mute button, just on a rarer trigger. A track's muted
            // property is set by the user agent and is read-only; flipping
            // enabled does not clear it, so the handler could not even achieve
            // what it was written for.
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
        localStreams.forEach(function (s) {
          s.getVideoTracks().forEach(function (t) {
            // Restore the PRIOR value, so kicking a frozen preview cannot turn a
            // camera back on that the user had switched off.
            try {
              var was = t.enabled;
              t.enabled = false;
              setTimeout(function () { t.enabled = was; }, 60);
            } catch (e) {}
          });
        });
      } catch (e) {}
    };

    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') {
        setTimeout(function () { try { window.__relayReacquireCamera(); } catch (e) {} }, 150);
        // BUG #2 FIX: Re-enable audio tracks when app comes back to foreground
        recompute();
      }
    });

    // --- Audio output (speaker) route detection ---
    var lastRoute = null;
    var detectAudioRoute = function () {
      try {
        var route = null;
        var el = document.querySelector('[data-audio-route]');
        if (el) route = (el.getAttribute('data-audio-route') || '').toLowerCase();
        if (!route) {
          var btOn = document.querySelector(
            '[data-bluetooth-active], .bluetooth-active, [aria-label*="Bluetooth" i][aria-pressed="true"]'
          );
          var spkOn = document.querySelector(
            '[data-speaker-active], .speaker-active, [aria-label*="speaker" i][aria-pressed="true"], button.speaker.active, [aria-label*="Speaker" i].active'
          );
          if (btOn) route = 'bluetooth';
          else if (spkOn) route = 'speaker';
          else if (state.active) route = 'earpiece';
        }
        if (route && route !== lastRoute) {
          lastRoute = route;
          postAudioRoute(route);
        }
      } catch (e) {}
    };

    // --- Online presence detection ---
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

    rehydrate();
    snapshot();
    setInterval(snapshot, 5000);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') snapshot();
      else rehydrate();
    });
    window.addEventListener('pagehide', snapshot);
    window.addEventListener('beforeunload', snapshot);
  } catch (e) {}
})();
true;`;

/**
 * BUG #3 FIX: HANGUP_ICON_FIX_JS — Inject CSS to fix the corrupted hang-up
 * button icon on Android. The web app's call-end button may render with a
 * broken/missing icon due to font loading issues in the Android WebView.
 * This injects a CSS override that ensures the hang-up button always shows
 * a recognizable phone-down icon using a combination of approaches:
 * - SVG background-image as a reliable fallback
 * - Force the icon font to render correctly
 * - Target common call-end button selectors
 */
export const HANGUP_ICON_FIX_JS = `(() => {
  try {
    if (window.__relayHangupFix) return;
    window.__relayHangupFix = true;

    var style = document.createElement('style');
    style.id = 'relay-hangup-fix';
    style.textContent = [
      // Target common hang-up / end-call button patterns and ensure the icon renders.
      // The SVG is a standard phone-down icon (Material Design call_end).
      '[data-call-end] svg, [data-hangup] svg, .call-end svg, .hangup-btn svg, button[aria-label*="hang" i] svg, button[aria-label*="end" i] svg, button[aria-label*="End" i] svg, [data-testid*="hangup"] svg, [data-testid*="end-call"] svg {',
      '  display: block !important;',
      '  visibility: visible !important;',
      '  opacity: 1 !important;',
      '  min-width: 24px !important;',
      '  min-height: 24px !important;',
      '}',
      // If the icon is rendered via a font icon that is corrupted, replace it
      '[data-call-end] i, [data-hangup] i, .call-end i, .hangup-btn i, button[aria-label*="hang" i] i, button[aria-label*="end" i] i {',
      '  font-family: inherit !important;',
      '  -webkit-font-smoothing: antialiased !important;',
      '}',
      // Ensure the end-call button itself is visible and properly colored
      '[data-call-end], [data-hangup], .call-end, .hangup-btn, button[aria-label*="hang" i], button[aria-label*="end" i], button[aria-label*="End Call" i], [data-testid*="hangup"], [data-testid*="end-call"] {',
      '  background-color: #EF4444 !important;',
      '  border-radius: 50% !important;',
      '  display: flex !important;',
      '  align-items: center !important;',
      '  justify-content: center !important;',
      '  visibility: visible !important;',
      '  opacity: 1 !important;',
      '}',
      // If the icon element is empty or has broken content, inject a phone-down SVG via CSS
      '[data-call-end]:empty::after, [data-hangup]:empty::after, .call-end:empty::after, .hangup-btn:empty::after {',
      '  content: "" !important;',
      '  display: block !important;',
      '  width: 24px !important;',
      '  height: 24px !important;',
      '  background-image: url("data:image/svg+xml,%3Csvg xmlns=\\'http://www.w3.org/2000/svg\\' viewBox=\\'0 0 24 24\\' fill=\\'white\\'%3E%3Cpath d=\\'M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08a.956.956 0 010-1.36C3.53 8.46 7.56 6.5 12 6.5s8.47 1.96 11.71 5.22c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28a11.27 11.27 0 00-2.67-1.85.996.996 0 01-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z\\'/%3E%3C/svg%3E") !important;',
      '  background-size: contain !important;',
      '  background-repeat: no-repeat !important;',
      '  background-position: center !important;',
      '}',
    ].join('\\n');
    document.head.appendChild(style);

    // Also watch for dynamically added call UI and ensure icon fonts load
    var fixIcons = function () {
      try {
        var btns = document.querySelectorAll(
          '[data-call-end], [data-hangup], .call-end, .hangup-btn, ' +
          'button[aria-label*="hang" i], button[aria-label*="end" i], ' +
          'button[aria-label*="End" i], [data-testid*="hangup"], [data-testid*="end-call"]'
        );
        btns.forEach(function (btn) {
          // If the button has no visible child content, inject an SVG icon
          if (btn.children.length === 0 && btn.textContent.trim() === '') {
            btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="white"><path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08a.956.956 0 010-1.36C3.53 8.46 7.56 6.5 12 6.5s8.47 1.96 11.71 5.22c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28a11.27 11.27 0 00-2.67-1.85.996.996 0 01-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z"/></svg>';
          }
        });
      } catch (e) {}
    };
    // Run periodically to catch dynamically rendered call UI
    setInterval(fixIcons, 2000);
    fixIcons();
  } catch (e) {}
})();
true;`;

/**
 * RELAY_NATIVE_BRIDGE_JS — Expose window.RelayNative.postMessage() shim.
 *
 * The native iOS app registers a WKScriptMessageHandler named "RelayNative".
 * The web app at your-chat.io uses window.RelayNative.postMessage(jsonString)
 * to send messages like webCallEnded and setAudioRoute to native.
 *
 * On iOS WKWebView, the actual native path is:
 *   window.webkit.messageHandlers.RelayNative.postMessage(string)
 *
 * This shim ensures window.RelayNative.postMessage works regardless of
 * whether the web app uses the webkit path or the convenience alias.
 * It also listens for relay:native CustomEvents (audioRouteChanged, callMuted)
 * injected by native and forwards them to the web app's event system.
 */
export const RELAY_NATIVE_BRIDGE_JS = `(() => {
  try {
    if (window.__relayNativeBridge) return;
    window.__relayNativeBridge = true;

    // Shim: window.RelayNative.postMessage(jsonString)
    // On Android: the native @JavascriptInterface "RelayNative" is already bound
    //   by RelayWebViewSetup — window.RelayNative.postMessage() calls native directly.
    // On iOS: routes to WKScriptMessageHandler.
    // Fallback: posts via ReactNativeWebView for RN-side handling.
    if (!window.RelayNative) {
      window.RelayNative = {
        postMessage: function(msg) {
          try {
            // iOS WKWebView native path
            if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.RelayNative) {
              window.webkit.messageHandlers.RelayNative.postMessage(msg);
              return;
            }
            // Fallback: also post via ReactNativeWebView for RN-side handling
            if (window.ReactNativeWebView) {
              window.ReactNativeWebView.postMessage(msg);
            }
          } catch (e) {
            console.warn('[RelayNative bridge] postMessage error:', e);
          }
        }
      };
    } else {
      // Android: RelayNative is already bound natively via @JavascriptInterface.
      // Ensure it has the postMessage method (it does from native addJavascriptInterface).
      // Nothing to shim — the native interface handles webCallEnded + setAudioRoute directly.
    }
  } catch (e) {}
})();
true;`;

/** Combined script injected once on load. */
export const INJECTED_JS =
  RELAY_NATIVE_BRIDGE_JS + "\n" + SESSION_PERSIST_JS + "\n" + VERSION_WATCH_JS + "\n" + CALL_WATCH_JS + "\n" + HANGUP_ICON_FIX_JS;
