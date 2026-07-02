/* ============================================================
   RELAY client — native WebRTC mesh over our HTTP signaling
   (Server-Sent Events + POST). This is a TypeScript port of the
   original public/app.js so it can be bundled by Vite and run
   inside a React page (the platform's Space Editor doesn't touch
   React-rendered DOM).

   The functions accept a `root: HTMLElement` so they can locate
   their DOM nodes via `root.querySelector(...)` rather than
   `document.getElementById(...)`. This also lets us scope the
   styles and avoids global-id collisions with the host page.
   ============================================================ */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { MediaPipeline, FILTERS, type FilterId, type FilterDef } from "./mediaPipeline";
import { computeLayout } from "./callLayout";
import { buildAudioOutputList } from "./audioOutputs";
import { detectDeviceType } from "./deviceType";
import { probeBrowserMedia, buildCapabilityReport } from "@shared/mediaCapabilities";
import { readSnapshot, writeSnapshot, clearSnapshot, type RejoinSnapshot } from "./rejoinSnapshot";
import { isDndOn } from "@/app/dnd";

interface IceConfig {
  iceServers: Array<{ urls: string; username?: string; credential?: string }>;
  // Connect-speed tuning (see buildIceConfig): pre-gather candidates, bundle all
  // media onto ONE transport, and mux RTCP — so the first offer already carries
  // candidates and only one ICE negotiation runs. Cuts call-setup latency.
  iceCandidatePoolSize?: number;
  bundlePolicy?: RTCBundlePolicy;
  rtcpMuxPolicy?: RTCRtcpMuxPolicy;
}
/**
 * Build the RTCPeerConnection config from a server list, always applying the
 * connect-speed tuning. Centralised so every place that swaps in fresh ICE
 * servers keeps the pool/bundle/mux settings (a bare `{ iceServers }` would drop
 * them and slow the next connection back down).
 *   - iceCandidatePoolSize: pre-gathers host/srflx candidates before the offer,
 *     so the SDP already includes them (fewer trickle round-trips → faster).
 *   - bundlePolicy "max-bundle": one transport for audio+video → a single ICE
 *     check list instead of one per m-line.
 *   - rtcpMuxPolicy "require": RTCP shares the RTP port (half the candidates).
 */
function buildIceConfig(
  servers: IceConfig["iceServers"]
): IceConfig {
  return {
    iceServers: servers,
    iceCandidatePoolSize: 4,
    bundlePolicy: "max-bundle",
    rtcpMuxPolicy: "require",
  };
}
interface PeerEntry {
  pc: RTCPeerConnection;
  name: string;
  dc: RTCDataChannel | null;
  el: HTMLElement | null;
  candQ: RTCIceCandidateInit[];
  remoteSet: boolean;
  gotStream: boolean;
  initiator: boolean;
  /** grace timer started on `disconnected`; cleared if we recover */
  graceT: ReturnType<typeof setTimeout> | null;
  /** debounce so we don't fire a burst of restarts */
  restartT: ReturnType<typeof setTimeout> | null;
  /** capped count of ICE restarts attempted for this peer */
  iceRestarts: number;
  /** wall-clock ms of the last ACTUAL restart attempt — hardens the per-call
   *  RESTART_DEBOUNCE_MS timer against flapping iceconnectionstatechange events
   *  that each re-arm a fresh debounce (the timer only blocks while PENDING, not
   *  right after it fires), which could otherwise fire restarts back-to-back. */
  lastRestartTime?: number;
  /** When this peer's call is on HOLD, the senders we detached (replaceTrack
   *  null) so we can re-attach the right track kind on resume. null = live. */
  frozen?: Array<{ sender: RTCRtpSender; kind: string }> | null;
  /** Fires once if the FIRST connect to this peer is still pending after 15s —
   *  upgrades the generic "connecting…" placeholder to a named "Waiting for
   *  X…" so a slow/stuck first connect doesn't look identical to a normal one. */
  slowT?: ReturnType<typeof setTimeout> | null;
}
interface PendingRing { from: string; fromName: string; roomId: string; flag?: string; }
interface Recent { id: string; name: string; }

interface Msg {
  type?: string;
  pin?: string;
  name?: string;
  device?: string;
  from?: string;
  fromName?: string;
  to?: string;
  roomId?: string;
  // Host moderation / roles. (`on`/`by` are shared with the recording message
  // below, so they're not re-declared here.)
  role?: string | null;
  selfRole?: string | null;
  hostPin?: string | null;
  flag?: string;
  members?: Array<{ pin: string; name: string; device?: string; flag?: string; role?: string }>;
  iceServers?: IceConfig["iceServers"];
  data?: { sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit };
  message?: string;
  code?: string;
  // LiveKit SFU (optional). `livekit`/`livekitUrl` are advisory flags stamped on
  // registered/joined/peer-joined; `token`+`url` arrive on a `livekit-token` push.
  livekit?: boolean;
  livekitUrl?: string;
  token?: string;
  url?: string;
  // Recording (LiveKit Egress). `recording` (boolean) on `registered` advertises
  // availability; the `recording` status message carries `on` + `by`.
  recording?: boolean;
  on?: boolean;
  by?: string;
}

export type RelayPhase = "idle" | "dialing" | "ringing" | "in-call";

export interface RelayHandle {
  destroy: () => void;
  /** Programmatic dial. Returns true if the engine accepted the request.
   *  `opts.voice` starts the call with the camera off (a voice call). */
  dial: (number: string, opts?: { voice?: boolean }) => boolean;
  /** Start a GROUP call — ring up to 10 numbers into one room. Returns true if
   *  at least one valid number was accepted. */
  dialGroup: (numbers: string[], opts?: { voice?: boolean }) => boolean;
  /** Set/replace the engine-state callback. Fired whenever phase changes. */
  setOnStateChange: (cb: ((phase: RelayPhase) => void) | null) => void;
  /** Best-effort: cancel an in-flight call/leave the room. */
  hangup: () => void;
  /** The 6-digit number the SIGNALING server actually registered for this
   *  device. This is the ONLY number a peer can dial successfully. Returns
   *  null until the first `registered` message arrives. */
  getPin: () => string | null;
  /** Subscribe to authoritative pin changes (fires on every `registered`). */
  setOnPinChange: (cb: ((pin: string | null) => void) | null) => void;
  /** Subscribe to auto-rejoin status: true while the engine is honoring a
   *  reload/crash snapshot to rejoin an active call, false once it has rejoined
   *  or given up. Lets the app show a "Reconnecting… / Exit call" prompt. */
  setOnRejoinChange: (cb: ((rejoining: boolean) => void) | null) => void;
  /** User chose NOT to reconnect — drop the rejoin snapshot and leave the call.
   *  Safe to call whether or not a rejoin is pending. */
  cancelRejoin: () => void;
  /** Ask the engine to register under this stable number (the identity
   *  number). Must be called before the engine registers. The server may
   *  still override if the number is taken by another device. */
  setPreferredPin: (pin: string | null) => void;
  /** Set our country flag emoji (shown beside our name on remote tiles).
   *  Re-affirms registration if already connected. */
  setSelfFlag: (flag: string) => void;
}

export function startRelay(root: HTMLElement): RelayHandle {
  const $ = (id: string): HTMLElement | null => root.querySelector("#" + id);

  // ---------- state ----------
  let ws: EventSource | null = null;
  let reconnectT: ReturnType<typeof setTimeout> | null = null;
  let registeredOnce = false;
  const cid = (() => {
    // Stable per-device connection id. Persist it in localStorage so a page
    // reload / reconnect keeps the SAME cid, which the server maps back to the
    // SAME 6-digit number. Without this, every reload minted a fresh cid -> a
    // brand-new number, so callers kept dialing a number that no longer existed.
    const KEY = "relay_cid";
    try {
      const existing = window.localStorage.getItem(KEY);
      if (existing && existing.length >= 8) return existing;
    } catch { /* localStorage blocked (private mode) — fall through */ }
    let fresh: string;
    try {
      const a = new Uint8Array(16);
      (window.crypto || (window as any).msCrypto).getRandomValues(a);
      fresh = Array.from(a).map(b => ("0" + b.toString(16)).slice(-2)).join("");
    } catch {
      fresh = String(Date.now()) + Math.random().toString(16).slice(2);
    }
    try { window.localStorage.setItem(KEY, fresh); } catch { /* ignore */ }
    return fresh;
  })();
  let wsReady = false;
  const wsOpenCbs: Array<() => void> = [];
  const me: { pin: string | null; name: string | null } = { pin: null, name: null };
  let iceConfig: IceConfig = buildIceConfig([{ urls: "stun:stun.l.google.com:19302" }]);
  let localStream: MediaStream | null = null;        // RAW camera stream (input)
  let processedStream: MediaStream | null = null;    // post-pipeline stream (sent to peers)
  let pipeline: MediaPipeline | null = null;
  let facingMode: "user" | "environment" = "user";
  let activeFilter: FilterId = "none";
  let micOn = true, camOn = true;
  // Pending auto-rejoin after a mid-call reload (e.g. the auto-updater). Read from
  // sessionStorage at boot; drives register() to use the in-call pin and onRejoin
  // to restore mic/cam. Cleared once we rejoin, the call proves ended, or on a
  // real hang-up.
  let pendingRejoin: RejoinSnapshot | null = null;
  let rejoinWatchT: ReturnType<typeof setTimeout> | null = null;
  // Subscriber (the React provider) for auto-rejoin status, so the app can show a
  // prominent "Reconnecting… / Exit call" prompt while a snapshot is being honored.
  let onRejoinChange: ((rejoining: boolean) => void) | null = null;
  function emitRejoin() {
    try { onRejoinChange?.(!!pendingRejoin); } catch { /* */ }
  }
  function clearPendingRejoin() {
    const was = !!pendingRejoin;
    pendingRejoin = null;
    if (rejoinWatchT) { clearTimeout(rejoinWatchT); rejoinWatchT = null; }
    clearSnapshot();
    if (was) emitRejoin();
  }
  let screenStream: MediaStream | null = null;       // active getDisplayMedia stream, or null
  let screenSharing = false;
  let recordingAvailable = false; // server advertised egress+S3 are configured
  let recordingOn = false;        // a recording is in progress for this room
  let inCall = false;
  let roomId: string | null = null;
  // Set briefly while an add-to-call invite is in flight, so an "offline" error
  // for THAT invite doesn't trip the call-teardown path in the `error` handler
  // (which exists for the PRIMARY dial target — dialing someone offline should
  // end your empty call, but adding an offline number must not kill the call
  // you're already in, e.g. while it's still ringing and you're momentarily alone).
  let addInviteOfflineGuard = false;
  let addInviteGuardT: ReturnType<typeof setTimeout> | null = null;
  const peers: Record<string, PeerEntry> = {};
  // Group call: extra invitees queued until the server confirms the room, so a
  // fresh group dial can't race into two separate rooms.
  let pendingGroupInvites: string[] = [];
  // Per-tile enrichment (v2.39): remote device types (pin -> "Mobile"/"Desktop",
  // shared via signaling) + a periodic getStats sampler for live bitrate.
  const peerDevices: Record<string, string> = {};
  const peerFlags: Record<string, string> = {}; // pin -> country flag emoji
  let selfFlag = "";                              // our own flag (set by the host app)
  let statsSampleT: ReturnType<typeof setInterval> | null = null;
  const statsPrev: Record<string, { bytes: number; ts: number }> = {};
  // Host moderation (v2.41): my role + everyone's roles for badges + the
  // host-controls panel. "host" | "cohost" | null.
  let myRole: string | null = null;
  let roomHostPin: string | null = null;
  const peerRoles: Record<string, string> = {};
  // Audio output routing (v2.43): the chosen output device (speaker / earpiece /
  // wired / Bluetooth). "" = the system default. We apply it to every remote
  // media element via setSinkId and RE-APPLY on devicechange so a Bluetooth
  // headset that connects mid-call is actually heard.
  let audioSinkId = (() => { try { return window.localStorage.getItem("relay_audio_sink") || ""; } catch { return ""; } })();
  const lkAudioEls: HTMLMediaElement[] = []; // SFU detached <audio> playback elements
  const audioOutSupported = typeof HTMLMediaElement !== "undefined"
    && typeof (HTMLMediaElement.prototype as unknown as { setSinkId?: unknown }).setSinkId === "function";
  // ---------- active-speaker / spotlight view (v2.35) ----------
  let spotlightId: string | null = null;     // tile id manually pinned big, or null
  let manualSpotlight = false;               // user clicked a tile to pin it
  let activeSpeakerId: string | null = null; // tile id of the loudest speaker (auto)
  let speakerOrder: string[] = [];           // tile ids, most-recently-loud first
  let speakerCandidate: string | null = null; // pending new leader (hysteresis)
  let speakerCandidateCount = 0;             // consecutive samples it has led
  const screenShareIds = new Set<string>();  // tile ids currently sharing a screen
  let compactView = false;                   // call container is "minimized" (small)
  let callResizeObs: ResizeObserver | null = null;
  // Mesh-only active-speaker detection via Web Audio (the SFU uses LiveKit's
  // ActiveSpeakersChanged instead). Lazily created on the first remote stream.
  let meshAudioCtx: AudioContext | null = null;
  const meshAnalysers: Record<string, { node: AnalyserNode; src: MediaStreamAudioSourceNode; data: Uint8Array<ArrayBuffer> }> = {};
  let speakerSampleT: ReturnType<typeof setInterval> | null = null;
  // ---------- LiveKit SFU (optional; null on the mesh path) ----------
  let livekitEnabled = false;
  let livekitUrl: string | null = null;
  // `Room` from livekit-client, lazy-imported only when actually joining a call.
  let lkRoom: import("livekit-client").Room | null = null;
  const lkParticipantTiles: Record<string, HTMLElement> = {};
  let lkPendingToken: { roomId: string; token: string; url: string } | null = null;
  let lkConnected = false; // true only AFTER a successful room.connect()+publish
  let lkWatchdog: ReturnType<typeof setTimeout> | null = null;
  let lkJoinTries = 0;
  function clearLkWatchdog() { if (lkWatchdog) { clearTimeout(lkWatchdog); lkWatchdog = null; } lkJoinTries = 0; }
  // Reliability net for the SFU path: if media isn't up a few seconds after the
  // call UI opens (token mint failed, SSE frame dropped, or connect() failed),
  // re-request a fresh token; after a few tries, surface an error + hang up
  // instead of sitting on a silent, media-less call forever.
  function armLkWatchdog() {
    clearLkWatchdog();
    const tick = () => {
      if (!inCall || !livekitEnabled || lkConnected) { lkWatchdog = null; return; }
      lkJoinTries++;
      if (lkJoinTries > 3) {
        lkWatchdog = null;
        toast("Couldn't connect call media. Please try again.", true);
        hangUp("livekit-join-timeout");
        return;
      }
      diag("livekit: media not up — re-requesting token (try " + lkJoinTries + ")");
      sendWS({ type: "refresh-livekit" });
      lkWatchdog = setTimeout(tick, 4000);
    };
    lkWatchdog = setTimeout(tick, 4500);
  }
  let pendingRing: PendingRing | null = null;
  // Call waiting: a second incoming call while already in a call.
  let waitingRing: PendingRing | null = null;
  let waitingTimeoutT: ReturnType<typeof setTimeout> | null = null;
  const recents: Recent[] = [];
  let callStart = 0;
  let timerInt: ReturnType<typeof setInterval> | null = null;
  let unread = 0;
  let dialed = "";
  let wantName: string | null = null;
  let onPinChange: ((pin: string | null) => void) | null = null;
  const emitPin = () => { try { onPinChange?.(me.pin); } catch { /* */ } };
  // The stable identity number the host (Dialer.tsx) wants this device to
  // register under, so the signaling pin == the profile number == one number
  // everywhere. Set BEFORE register() runs.
  let preferredPin: string | null = null;
  let toastT: ReturnType<typeof setTimeout> | null = null;
  // Auto-dismiss timer for an unanswered incoming ring (there's no caller-cancel
  // signal yet, so we don't strand the callee on a dead ring screen).
  let ringTimeoutT: ReturnType<typeof setTimeout> | null = null;
  let destroyed = false;

  // ---------- utils ----------
  const show = (s: string) => {
    root.querySelectorAll(".relay-screen").forEach(x => x.classList.remove("active"));
    $(s)?.classList.add("active");
  };
  const initials = (n: string | null) => (n || "?").trim().slice(0, 2).toUpperCase() || "?";
  const escapeHtml = (s: string) =>
    (s || "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
  const toast = (msg: string, err = false) => {
    const t = $("toast");
    if (!t) return;
    t.textContent = msg;
    t.className = "relay-toast show" + (err ? " err" : "");
    if (toastT) clearTimeout(toastT);
    toastT = setTimeout(() => { t.className = "relay-toast"; }, 3400);
  };
  const fmtPin = (p: string | null) => String(p ?? "").replace(/(\d{3})(\d{3})/, "$1 $2");
  const nameOf = (pin: string) => (peers[pin] ? peers[pin].name : pin);

  // ---------- transport (SSE + POST) ----------
  function connectWS() {
    try {
      if (ws) { try { ws.close(); } catch { /* */ } }
      ws = new EventSource("/api/relay/stream?cid=" + encodeURIComponent(cid));
    } catch {
      toast("Can't reach the server.", true);
      return;
    }
    ws.onopen = () => { diag("sse open"); };
    ws.onmessage = (e: MessageEvent) => {
      let m: Msg;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m && m.type === "ready") {
        wsReady = true;
        diag("sse ready");
        const cbs = wsOpenCbs.splice(0);
        cbs.forEach(fn => { try { fn(); } catch { /* */ } });
        if (wantName) sendWS({ type: "register", name: wantName, pin: me.pin || undefined, device: detectDeviceType(), flag: selfFlag || undefined });
        return;
      }
      if (m && m.type) diag("recv " + m.type + (m.from ? " from " + m.from.slice(-4) : ""));
      handle(m);
    };
    ws.onerror = () => { wsReady = false; diag("sse error"); scheduleReconnect(); };
  }
  function scheduleReconnect() {
    if (destroyed || reconnectT) return;
    reconnectT = setTimeout(() => {
      reconnectT = null;
      try { ws?.close(); } catch { /* */ }
      if (!destroyed) connectWS();
    }, 1500);
  }
  function sendWS(obj: any) {
    try {
      const body = JSON.stringify({ cid, message: obj });
      fetch("/api/relay/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true,
      }).catch(() => { /* ignore — SSE will reconnect */ });
    } catch { /* */ }
  }

  // True when we're in a call but no remote party is present yet — used to
  // decide whether a `rejected`/`busy`/error should tear the call down. On the
  // mesh path that's "no peers"; on the LiveKit path it's "no remote tiles" (so
  // a declined add-invite in a group call doesn't kill the whole call).
  function aloneInCall(): boolean {
    return livekitEnabled
      ? Object.keys(lkParticipantTiles).length === 0
      : Object.keys(peers).length === 0;
  }

  // ---------- protocol ----------
  function handle(m: Msg) {
    // Capture the advisory LiveKit flag whenever the server stamps it
    // (registered / joined / peer-joined), so we know our media path up front.
    if (typeof m.livekit === "boolean") {
      livekitEnabled = m.livekit;
      livekitUrl = m.livekitUrl || livekitUrl;
    }
    if (typeof m.recording === "boolean" && m.type === "registered") {
      recordingAvailable = m.recording;
      updateRecordBtnVisibility();
    }
    switch (m.type) {
      case "registered":   onRegistered(m); break;
      case "recording":      onRecordingStatus(m); break;
      case "recording-error":
        toast(m.message || "Recording failed.", true);
        recordingOn = false; updateRecordingUI();
        break;
      case "room":
        roomId = m.roomId || null;
        captureSelfRole(m); // the creator is the host
        // Group call: now that the room exists, ring the remaining invitees.
        if (pendingGroupInvites.length) {
          const q = pendingGroupInvites; pendingGroupInvites = [];
          q.forEach(t => { if (!peers[t]) sendWS({ type: "invite", to: t }); });
        }
        break;
      case "ring":         onRing(m); break;
      case "ring-cancel":  onRingCancel(m); break;
      case "joined":       onJoined(m); break;
      case "rejoin":       void onRejoin(m); break;
      case "resumed":      void onResumed(m); break;
      case "merged":       onMerged(m); break;
      case "peer-joined":  onPeerJoined(m); break;
      case "livekit-token": onLivekitToken(m); break;
      case "rejected":
        toast(nameOf(m.from!) + " declined.");
        if (inCall && aloneInCall()) hangUp("peer-rejected");
        break;
      case "busy":
        toast("They're on another call.", true);
        if (inCall && aloneInCall()) hangUp("peer-busy");
        break;
      case "peer-left":    removePeer(m.pin!); break;
      case "force-mute":   onForceMute(m); break;
      case "role":         onRoleChange(m); break;
      case "host-pin":     onHostPin(m); break;
      case "peer-meta":
        // Late metadata update (e.g. a peer's flag resolved after they joined).
        if (m.pin && m.flag) { peerFlags[m.pin] = m.flag; setTileFlag("tile-" + m.pin, m.flag); }
        if (m.pin && m.device) { peerDevices[m.pin] = m.device; setTileDevice("tile-" + m.pin, m.device); }
        break;
      case "peer-hold":    onPeerHold(m); break;
      case "peer-screen":  onPeerScreen(m); break;
      case "kicked":
        toast("You were removed from the call by the host.", true);
        hangUp("kicked");
        break;
      case "signal":       onSignal(m.from!, m.data); break;
      case "ice":          onIceServers(m); break;
      case "error": {
        toast(m.message || "Something went wrong.", true);
        const fatalCode = m.code === "offline" || m.code === "self" || m.code === "gone";
        if (addInviteOfflineGuard && m.code === "offline") {
          // Offline error for an add-to-call invite — don't tear down our call.
          addInviteOfflineGuard = false;
          if (addInviteGuardT) { clearTimeout(addInviteGuardT); addInviteGuardT = null; }
        } else if (fatalCode && inCall && aloneInCall()) {
          hangUp("server-error:" + (m.code || "?"));
        }
        break;
      }
    }
  }

  // A LiveKit join token was pushed for `roomId`. Stash it and, if we're already
  // the active room and not yet connected, connect to the SFU now.
  function onLivekitToken(m: Msg) {
    if (!m.roomId || !m.token) return;
    lkPendingToken = { roomId: m.roomId, token: m.token, url: m.url || livekitUrl || "" };
    if (livekitEnabled && roomId === m.roomId && !lkRoom) void joinLivekit(m.roomId);
  }

  // ---------- registration ----------
  function register() {
    const input = $("nameInput") as HTMLInputElement | null;
    const name = (input?.value || "").trim();
    if (!name) { toast("Enter a display name first.", true); return; }
    me.name = name; wantName = name;
    try { window.localStorage.setItem("relay_name", name); } catch { /* */ }
    // Reuse our previously-issued number if we have one saved, so reloads keep
    // the same 6-digit number that friends may already be dialing.
    let savedPin: string | undefined;
    try { savedPin = window.localStorage.getItem("relay_pin") || undefined; } catch { /* */ }
    // Priority for the number we ask the server to register us under:
    //   0. pendingRejoin.pin — when rejoining an active call after a reload, we
    //      MUST register under the SAME pin we held in the call, or the server's
    //      membership lookup (sendRejoinIfInRoom, keyed by pin) won't find the
    //      room and the rejoin silently fails. This wins for the brief window.
    //   1. preferredPin — the stable identity number from the host.
    //   2. savedPin — a number we were previously issued (reload continuity).
    // The server still has final say (it rejects a pin already taken by
    // someone else) and reports the authoritative value back via onRegistered.
    if (pendingRejoin && /^\d{6}$/.test(pendingRejoin.pin)) me.pin = pendingRejoin.pin;
    else if (preferredPin && /^\d{6}$/.test(preferredPin)) me.pin = preferredPin;
    else if (savedPin && !me.pin) me.pin = savedPin;
    const btn = $("joinBtn") as HTMLButtonElement | null;
    if (btn) { btn.disabled = true; btn.textContent = "Connecting…"; }
    if (ws && ws.readyState === 1) sendWS({ type: "register", name, pin: me.pin || undefined, device: detectDeviceType(), flag: selfFlag || undefined });
    else connectWS();
  }
  function onRegistered(m: Msg) {
    me.pin = String(m.pin);
    try { window.localStorage.setItem("relay_pin", me.pin); } catch { /* */ }
    // Tell the embedding host (Dialer.tsx) the AUTHORITATIVE number so the UI
    // shows the exact pin the signaling server will route calls to. Without
    // this the page showed a separate identity number and every dial to it was
    // rejected as "offline".
    emitPin();
    if (m.iceServers && m.iceServers.length) iceConfig = buildIceConfig(m.iceServers);
    if (!registeredOnce) {
      registeredOnce = true;
      const meName = $("meName"); if (meName) meName.textContent = me.name;
      const meAv = $("meAv"); if (meAv) meAv.textContent = initials(me.name);
      const meCode = $("meCode"); if (meCode) meCode.textContent = fmtPin(me.pin);
      const bigCode = $("bigCode"); if (bigCode) bigCode.textContent = me.pin;
      const shareLink = location.origin + "/";
      const shareUrl = $("shareUrl"); if (shareUrl) shareUrl.textContent = shareLink;
      buildPad();
      show("lobby");
      // Prime camera/mic permission NOW, at login, so the OS permission prompt
      // is handled while the user is idle in the lobby — not in the middle of
      // placing a call. On mobile, prompting during the invite caused the page
      // to lose focus and the call to drop instantly. We warm the stream and
      // keep it ready; ensureMedia() is idempotent (returns the cached stream).
      void primeMedia();
    } else {
      const meCode = $("meCode"); if (meCode) meCode.textContent = fmtPin(me.pin);
      const bigCode = $("bigCode"); if (bigCode) bigCode.textContent = me.pin;
    }
  }

  // ---------- dial pad ----------
  const KEYS: Array<[string, string]> = [
    ["1", ""], ["2", "ABC"], ["3", "DEF"],
    ["4", "GHI"], ["5", "JKL"], ["6", "MNO"],
    ["7", "PQRS"], ["8", "TUV"], ["9", "WXYZ"],
    ["*", ""], ["0", "+"], ["#", ""],
  ];
  function buildPad() {
    const pad = $("pad");
    if (!pad) return;
    pad.innerHTML = "";
    KEYS.forEach(([d, l]) => {
      const k = document.createElement("div");
      k.className = "relay-key";
      k.innerHTML = '<span class="d">' + d + '</span><span class="l">' + l + "</span>";
      k.onclick = () => pushDigit(d);
      pad.appendChild(k);
    });
  }
  function refreshDisplay() {
    const el = $("dialDisplay");
    if (!el) return;
    if (!dialed) { el.textContent = "Enter a number"; el.classList.add("empty"); }
    else { el.textContent = dialed; el.classList.remove("empty"); }
    const callBtn = $("callBtn") as HTMLButtonElement | null;
    if (callBtn) callBtn.disabled = !/^\d{6}$/.test(dialed);
  }
  function pushDigit(d: string) {
    if (/\d/.test(d) && dialed.length < 6) { dialed += d; refreshDisplay(); }
  }

  // ---------- media ----------
  // Phones run hot encoding 720p60. Cap the framerate to 30 everywhere and ask
  // for a lighter capture resolution on mobile — WebRTC still upscales fine and
  // the device stays cool. Desktops keep 720p.
  const isMobile = (() => {
    try {
      return /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
        || (typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches
            && Math.min(window.screen?.width || 9999, window.screen?.height || 9999) <= 820);
    } catch { return false; }
  })();
  // Streaming quality (camera + screen). "low" = data saver: far less CPU
  // (cooler device) and bandwidth (lower latency); "high" = HD. Persisted.
  type VideoQuality = "high" | "low";
  let videoQuality: VideoQuality = (() => {
    try { return window.localStorage.getItem("relay_quality") === "low" ? "low" : "high"; }
    catch { return "high"; }
  })();
  function qualityVideo(q: VideoQuality) {
    if (q === "low") {
      return { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 15, max: 20 } };
    }
    return {
      width: { ideal: isMobile ? 960 : 1280 },
      height: { ideal: isMobile ? 540 : 720 },
      frameRate: { ideal: 30, max: 30 },
    };
  }
  // Screen share is mostly STATIC content (slides, a document, a desktop) — a
  // capped, lower framerate than the camera is plenty smooth and saves real
  // bandwidth/CPU. Previously getDisplayMedia was called with ONLY the camera's
  // qualityVideo() constraint, which on a 4K/retina display could request a
  // 720p-WIDTH-ideal-but-uncapped-framerate capture at full native resolution and
  // up to 60fps — a much heavier publish than any camera ever sends.
  function qualityScreenShare(q: VideoQuality) {
    if (q === "low") {
      return { width: { ideal: 1024 }, height: { ideal: 576 }, frameRate: { ideal: 8, max: 12 } };
    }
    return { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 10, max: 15 } };
  }
  // Echo cancellation / noise suppression / auto-gain are constraint HINTS the
  // browser applies on its own audio pipeline (no renegotiation, no SFU impact)
  // and degrade gracefully where unsupported — a clear call-quality win for free.
  const AUDIO_CONSTRAINTS: MediaTrackConstraints = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  };
  async function acquireRawStream(useFacingMode: "user" | "environment"): Promise<MediaStream> {
    return navigator.mediaDevices.getUserMedia({
      audio: AUDIO_CONSTRAINTS,
      video: { ...qualityVideo(videoQuality), facingMode: useFacingMode },
    });
  }
  function updateQualityBtn() {
    const b = $("qualityBtn");
    if (b) {
      b.textContent = videoQuality === "low" ? "SD" : "HD";
      b.classList.toggle("on", videoQuality === "high");
      b.setAttribute("title", videoQuality === "low" ? "Data saver — tap for HD" : "HD — tap for data saver");
    }
  }
  // Switch resolution live (no re-acquire) via applyConstraints on the current
  // camera and/or screen track, so it's seamless mid-call.
  async function setVideoQuality(q: VideoQuality) {
    videoQuality = q;
    try { window.localStorage.setItem("relay_quality", q); } catch { /* */ }
    const vc = qualityVideo(q);
    const ac = { width: vc.width, height: vc.height, frameRate: vc.frameRate };
    const camTrack = localStream?.getVideoTracks()[0];
    if (camTrack) { try { await camTrack.applyConstraints(ac); } catch { /* */ } }
    // Screen share gets its OWN (capped-framerate) constraint set — applying the
    // camera's uncapped-resolution constraint here would silently re-uncap an
    // in-progress share's framerate back up to 30fps on a Data-saver→HD toggle.
    const scrTrack = screenStream?.getVideoTracks()[0];
    if (scrTrack) {
      const sc = qualityScreenShare(q);
      try { await scrTrack.applyConstraints({ width: sc.width, height: sc.height, frameRate: sc.frameRate }); } catch { /* */ }
    }
    updateQualityBtn();
    toast(q === "low" ? "Data saver on (low resolution)" : "HD video on");
  }
  function toggleQuality() { void setVideoQuality(videoQuality === "high" ? "low" : "high"); }

  // ---------- audio output routing (speaker / earpiece / headset / Bluetooth) ----------
  /** Every remote-audio-producing element: mesh remote <video>s (audio rides the
   *  video element) + SFU detached <audio>s. */
  function collectAudioEls(): HTMLMediaElement[] {
    const els: HTMLMediaElement[] = [];
    for (const pin in peers) {
      const v = peers[pin].el?.querySelector("video") as HTMLMediaElement | null;
      if (v) els.push(v);
    }
    for (const a of lkAudioEls) els.push(a);
    return els;
  }
  // Mobile autoplay belt-and-suspenders: if a remote element's play() is blocked
  // because there hasn't been a user gesture yet, REPLAY every remote element on
  // the next tap anywhere. The user always taps something in a call, so incoming
  // audio recovers within a tap instead of staying silent. Self-clears on fire.
  let audioUnlockArmed = false;
  function armAudioUnlock() {
    if (audioUnlockArmed || typeof document === "undefined") return;
    audioUnlockArmed = true;
    const unlock = () => {
      collectAudioEls().forEach(el => { try { void el.play?.(); } catch { /* */ } });
      audioUnlockArmed = false;
      document.removeEventListener("pointerdown", unlock);
      document.removeEventListener("touchend", unlock);
    };
    document.addEventListener("pointerdown", unlock);
    document.addEventListener("touchend", unlock);
  }
  async function applyAudioSink(only?: HTMLMediaElement) {
    if (!audioOutSupported) return;
    const targets = only ? [only] : collectAudioEls();
    for (const t of targets) {
      const el = t as HTMLMediaElement & { setSinkId?: (id: string) => Promise<void> };
      if (typeof el.setSinkId === "function") {
        try {
          await el.setSinkId(audioSinkId);
        } catch {
          // The chosen device vanished (e.g. an unplugged Bluetooth headset).
          // Fall back to the system default so audio is never silently lost and
          // the UI stops claiming a dead device is selected.
          if (audioSinkId) {
            audioSinkId = "";
            try { window.localStorage.removeItem("relay_audio_sink"); } catch { /* */ }
            try { await el.setSinkId(""); } catch { /* */ }
          }
        }
      }
    }
  }
  function updateAudioBtn(label?: string) {
    const b = $("audioBtn");
    if (!b) return;
    // VISIBLE on every platform during a call (cross-platform parity). Where the
    // browser can't select an audio output (e.g. Android Chrome), tapping toggles
    // the Web-Audio loudspeaker force instead of the control silently vanishing.
    b.style.display = "";
    // Highlight when a real NON-default output is active OR loudspeaker force is on.
    b.classList.toggle("on", !!audioSinkId || loudspeakerOn);
    if (label) b.setAttribute("title", "Audio output: " + label);
  }
  async function refreshAudioOutputs() {
    const menu = $("audioMenu");
    if (!menu) return;
    let devices: MediaDeviceInfo[] = [];
    try { devices = await navigator.mediaDevices.enumerateDevices(); } catch { /* */ }
    // Pure logic (validates the persisted sink still exists + de-dups defaults).
    const list = buildAudioOutputList(devices, audioSinkId);
    // If the persisted device is gone, drop the phantom selection.
    if (list.validSink !== audioSinkId) {
      audioSinkId = list.validSink;
      try {
        if (audioSinkId) window.localStorage.setItem("relay_audio_sink", audioSinkId);
        else window.localStorage.removeItem("relay_audio_sink");
      } catch { /* */ }
    }
    menu.innerHTML = list.rows.map(audioRow).join("") ||
      '<div class="ao-empty">No selectable outputs. Your device routes audio automatically.</div>';
    updateAudioBtn(list.currentLabel);
  }
  function audioRow(r: { id: string; label: string; selected: boolean }): string {
    return '<button type="button" class="ao-item' + (r.selected ? " ao-sel" : "") +
      '" data-sink="' + escapeHtml(r.id) + '">' + escapeHtml(r.label) + "</button>";
  }
  async function pickAudioSink(id: string) {
    audioSinkId = id;
    try {
      if (id) window.localStorage.setItem("relay_audio_sink", id);
      else window.localStorage.removeItem("relay_audio_sink");
    } catch { /* */ }
    await applyAudioSink();
    closeAudioMenu();
    void refreshAudioOutputs();
    toast("Audio output updated");
  }
  // ── Android loudspeaker force (Web Audio routing) ──────────────────────────
  // Android Chrome exposes NO web API to pick the call's audio OUTPUT, and routes
  // WebRTC audio to the EARPIECE while a mic is captured. Routing the remote audio
  // through an AudioContext (whose destination is the device's MEDIA output)
  // forces the LOUDSPEAKER (and follows a connected headset/Bluetooth). We mute
  // the source elements ONLY after the context is confirmed `running`, so the
  // worst case is "no change" (earpiece) — NEVER silence. Fully reversible.
  const IS_ANDROID = (() => { try { return /Android/i.test(navigator.userAgent || ""); } catch { return false; } })();
  let loudspeakerCtx: AudioContext | null = null;
  let loudspeakerOn = false;
  let loudspeakerScanT: ReturnType<typeof setInterval> | null = null;
  const loudspeakerNodes: AudioNode[] = [];
  const loudspeakerMutedEls = new Set<HTMLMediaElement>();
  function routeElToLoudspeaker(el: HTMLMediaElement) {
    if (!loudspeakerCtx || loudspeakerMutedEls.has(el)) return;
    const stream = el.srcObject as MediaStream | null;
    if (!stream || stream.getAudioTracks().length === 0) return;
    try {
      const src = loudspeakerCtx.createMediaStreamSource(stream);
      src.connect(loudspeakerCtx.destination);
      loudspeakerNodes.push(src);
      // Mute the element ONLY AFTER the Web-Audio loudspeaker path is wired. A
      // remote WebRTC stream can be tapped by just ONE MediaStreamAudioSourceNode
      // (the active-speaker analyser already taps it), so createMediaStreamSource
      // can throw here — and if we'd muted FIRST, that throw would leave the
      // element muted with no working route = total silence. Muting last means a
      // failed tap simply leaves the element audible (earpiece), never silent.
      loudspeakerMutedEls.add(el);
      el.muted = true;
    } catch { /* stream already tapped — leave el UNMUTED so audio still plays */ }
  }
  /** Re-route any NEW remote audio onto the loudspeaker (called when participants
   *  join while loudspeaker mode is on). No-op when off. */
  function refreshLoudspeakerRouting() {
    if (loudspeakerOn) collectAudioEls().forEach(routeElToLoudspeaker);
  }
  async function loudspeakerEnable(): Promise<boolean> {
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return false;
      if (!loudspeakerCtx) loudspeakerCtx = new Ctx();
      await loudspeakerCtx.resume();
      if (loudspeakerCtx.state !== "running") return false; // never mute → never silent
      loudspeakerOn = true;
      collectAudioEls().forEach(routeElToLoudspeaker);
      // Catch participants who join AFTER loudspeaker mode is on (cheap; the Set
      // guard skips already-routed elements).
      if (!loudspeakerScanT) loudspeakerScanT = setInterval(refreshLoudspeakerRouting, 2000);
      return true;
    } catch { return false; }
  }
  function loudspeakerDisable() {
    if (loudspeakerScanT) { clearInterval(loudspeakerScanT); loudspeakerScanT = null; }
    loudspeakerNodes.forEach(n => { try { n.disconnect(); } catch { /* */ } });
    loudspeakerNodes.length = 0;
    loudspeakerMutedEls.forEach(el => { try { el.muted = false; } catch { /* */ } });
    loudspeakerMutedEls.clear();
    loudspeakerOn = false;
    try { void loudspeakerCtx?.suspend(); } catch { /* */ }
  }
  async function toggleLoudspeaker() {
    if (loudspeakerOn) { loudspeakerDisable(); updateAudioBtn(); toast("Loudspeaker off"); return; }
    const ok = await loudspeakerEnable();
    updateAudioBtn();
    toast(ok ? "Loudspeaker on 🔊" : "Couldn't switch the output on this device.", !ok);
  }
  function openAudioMenu() {
    if (!audioOutSupported) {
      // No web output-picker here. On ANDROID, offer the loudspeaker-force toggle
      // (a real, reversible control) instead of a dead-end message. On iOS, audio
      // routing already works natively — don't touch it; just say so honestly.
      if (IS_ANDROID) void toggleLoudspeaker();
      else toast("Your device routes call audio automatically (headset/Bluetooth switches on its own).");
      return;
    }
    void refreshAudioOutputs();
    $("audioMenu")?.classList.add("open");
  }
  function closeAudioMenu() { $("audioMenu")?.classList.remove("open"); }
  function onAudioMenuClick(e: Event) {
    const btn = (e.target as HTMLElement)?.closest?.("button[data-sink]") as HTMLElement | null;
    if (!btn) return;
    void pickAudioSink(btn.getAttribute("data-sink") || "");
  }
  // Snapshot of known output device ids, to detect a NEW one (BT/headset) appearing.
  let prevOutputIds = new Set<string>();
  // Was a headset-looking device present on the last devicechange? Tracked across
  // BOTH input + output kinds so we detect a connect even on Android Chrome, where
  // audio OUTPUTS often aren't enumerable but the headset's MIC (an audioinput)
  // still appears. Used to auto-leave forced-loudspeaker when a headset arrives.
  let headsetWasPresent = false;
  function looksLikeHeadset(label: string): boolean {
    return /bluetooth|headset|airpod|buds|headphone|hands?-?free|wireless|earbud/i.test(label || "");
  }
  // A Bluetooth headset (dis)connecting fires devicechange. Re-apply the chosen
  // sink (so a disconnect falls back to default), and — the real fix for "can't
  // hear my Bluetooth headset" — when we're on Automatic and a headset/BT output
  // newly appears, actively route call audio onto it.
  const onAudioDeviceChange = async () => {
    await applyAudioSink();
    try {
      const devs = await navigator.mediaDevices.enumerateDevices();
      const outs = devs.filter(d => d.kind === "audiooutput" && d.deviceId && d.deviceId !== "default");
      const ids = new Set(outs.map(d => d.deviceId));
      const added = outs.filter(d => !prevOutputIds.has(d.deviceId));
      prevOutputIds = ids;
      // A headset/BT device connecting while FORCED LOUDSPEAKER is on (Android,
      // where there's no setSinkId) must hand audio back to the headset — the OS
      // routes the default output there, so we just drop the loudspeaker force.
      // Detected across input+output so it works even when outputs aren't listed.
      const headsetNow = devs.some(
        d => (d.kind === "audiooutput" || d.kind === "audioinput") && looksLikeHeadset(d.label),
      );
      if (headsetNow && !headsetWasPresent && loudspeakerOn) {
        loudspeakerDisable();
        updateAudioBtn();
        toast("Headset connected — routing audio to it");
      }
      headsetWasPresent = headsetNow;
      if (audioSinkId === "" && added.length) {
        const bt = added.find(d => looksLikeHeadset(d.label)) || null;
        if (bt) {
          audioSinkId = bt.deviceId;
          try { window.localStorage.setItem("relay_audio_sink", bt.deviceId); } catch { /* */ }
          await applyAudioSink();
          updateAudioBtn(bt.label || "Headset");
          toast("Audio switched to " + (bt.label || "your headset"));
        }
      }
    } catch { /* */ }
    if ($("audioMenu")?.classList.contains("open")) void refreshAudioOutputs();
  };
  // Seed the known-output snapshot once media is up (so a later connect is "new").
  async function seedAudioOutputs() {
    if (!audioOutSupported) return;
    try {
      const devs = await navigator.mediaDevices.enumerateDevices();
      prevOutputIds = new Set(devs.filter(d => d.kind === "audiooutput" && d.deviceId && d.deviceId !== "default").map(d => d.deviceId));
    } catch { /* */ }
  }
  // The stream we currently publish to peers. When a filter is active it's the
  // processed (canvas) stream; otherwise it's the RAW camera — which means NO
  // canvas, NO captureStream re-encode, and far less heat in the common case of
  // a plain call. `processedStream` is non-null ONLY while a filter runs, so the
  // historic `processedStream || localStream` call-sites stay correct.
  function outStream(): MediaStream {
    return processedStream || (localStream as MediaStream);
  }
  // Build (once) and start the canvas pipeline reading from the live camera.
  // Called lazily the first time a real filter is selected — never for plain
  // calls.
  async function ensurePipeline(): Promise<void> {
    if (!localStream || localStream.getVideoTracks().length === 0) return;
    if (!pipeline) {
      pipeline = new MediaPipeline({
        onError: m => toast(m, true),
        onLoading: l => {
          const dot = $("filterLoading");
          if (dot) dot.style.display = l ? "inline-block" : "none";
        },
      });
      pipeline.setFacingMode(facingMode);
      await pipeline.setInputStream(localStream);
    }
    // Null-guard: an interleaved filter-off could have torn the pipeline down
    // while we awaited above.
    if (pipeline) processedStream = pipeline.getOutputStream();
  }
  async function ensureMedia(): Promise<MediaStream> {
    // Reuse a live camera/mic — don't re-prompt. (We key off localStream, not
    // processedStream, because plain calls never create a processedStream.)
    if (localStream) return outStream();
    try {
      localStream = await acquireRawStream(facingMode);
    } catch {
      try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS, video: false });
        camOn = false;
        toast("No camera found — joining with audio only.");
      } catch (e2) {
        toast("Mic/camera blocked. Allow access in your browser, then retry.", true);
        throw e2;
      }
    }
    // Only spin up the heavy canvas pipeline if a filter was already chosen.
    if (activeFilter !== "none" && localStream.getVideoTracks().length > 0) {
      await ensurePipeline();
    }
    ensureLocalLevelMonitor();
    return outStream();
  }
  // Keep the outgoing video track's enabled flag in sync with camOn after any
  // track swap (filter on/off, camera flip).
  function syncCamEnabled() {
    const pub = outStream();
    pub.getVideoTracks().forEach(t => (t.enabled = camOn));
    if (processedStream && localStream) {
      localStream.getVideoTracks().forEach(t => (t.enabled = camOn));
    }
  }
  // Hot-swap the outgoing VIDEO track on every transport (mesh peers + SFU) with
  // no SDP renegotiation. Used when filters turn on/off and when flipping camera
  // in the no-filter (raw) path.
  async function replaceVideoEverywhere(track: MediaStreamTrack | null) {
    for (const id in peers) {
      try {
        const senders = peers[id].pc.getSenders();
        const sender = senders.find(s => s.track && s.track.kind === "video")
                    || senders.find(s => !s.track);
        if (sender) await sender.replaceTrack(track);
      } catch { /* */ }
    }
    if (lkRoom) {
      try {
        // LiveKit types are dynamically imported (any); prefer the SDK's
        // in-place replaceTrack, else fall back to unpublish + publish.
        const lp: any = (lkRoom as any).localParticipant;
        const pubs: any[] = typeof lp.getTrackPublications === "function"
          ? lp.getTrackPublications()
          : (lp.videoTrackPublications ? Array.from(lp.videoTrackPublications.values()) : []);
        if (!track) {
          // No replacement (e.g. stopping screen share in an audio-only call) —
          // drop any published video so no orphan publication lingers.
          for (const pub of pubs) {
            const lt = pub?.track;
            const isVideo = pub?.kind === "video" || lt?.kind === "video";
            if (lt && isVideo && lt.mediaStreamTrack) {
              try { await lp.unpublishTrack(lt.mediaStreamTrack); } catch { /* */ }
            }
          }
        } else {
          let swapped = false;
          for (const pub of pubs) {
            const lt = pub?.track;
            const isVideo = pub?.kind === "video" || lt?.kind === "video";
            if (lt && isVideo) {
              if (typeof lt.replaceTrack === "function") { await lt.replaceTrack(track); swapped = true; break; }
              if (lt.mediaStreamTrack) { try { await lp.unpublishTrack(lt.mediaStreamTrack); } catch { /* */ } }
            }
          }
          if (!swapped) await lp.publishTrack(track);
        }
      } catch { /* */ }
    }
    syncCamEnabled();
  }

  // Warm the camera/mic at login. Best-effort: if the user denies or has no
  // devices we surface a gentle banner but never block the lobby. The stream is
  // cached so the later ensureMedia() call during a dial is instant and does not
  // pop a fresh OS prompt (which on mobile was dropping the call).
  let mediaPrimed = false;
  async function primeMedia() {
    if (mediaPrimed || localStream) return;
    const banner = $("mediaBanner");
    try {
      await ensureMedia();
      mediaPrimed = true;
      if (banner) banner.style.display = "none";
      // Show a tiny self-preview confirmation so the user sees mic/cam are live.
      toast("Camera & mic ready");
    } catch {
      // ensureMedia already toasted; show a persistent banner with a retry.
      if (banner) banner.style.display = "flex";
    }
  }

  /** Swap the camera between front and back. Re-acquires getUserMedia with
   *  the opposite facingMode and hot-replaces the video track on every peer
   *  via RTCRtpSender.replaceTrack — no re-negotiation needed. We acquire
   *  VIDEO-ONLY and keep the EXISTING audio track, so the transmitted/muteable
   *  audio identity never changes (otherwise mute would silently toggle the
   *  wrong track and a duplicate mic capture would leak). */
  // Re-entrancy guard: two rapid taps must not interleave getUserMedia +
  // replaceTrack (which leaves the published track disagreeing with facingMode).
  let flipBusy = false;
  /** Acquire the OTHER camera as reliably as the platform allows. A soft
   *  `facingMode` is NOT reliable — many devices return the SAME camera for an
   *  "ideal" constraint — so we try an EXACT facingMode first, then fall back to
   *  enumerating video inputs and explicitly grabbing a DIFFERENT deviceId, then
   *  a soft facingMode as a last resort. Returns the new VIDEO stream or null. */
  async function acquireFlippedCamera(next: "user" | "environment"): Promise<MediaStream | null> {
    const q = qualityVideo(videoQuality);
    // 1) EXACT facingMode — the only constraint that reliably switches cameras.
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: false, video: { ...q, facingMode: { exact: next } } });
    } catch { /* no exact match / only one camera / unsupported — fall through */ }
    // 2) Enumerate inputs and pick a DIFFERENT device than the current one.
    //    NOTE: iOS Safari (and some others) can report an EMPTY deviceId. The old
    //    `d.deviceId !== curId` was `something !== undefined` → always true → it
    //    re-grabbed an arbitrary (often the SAME) camera. Normalize curId to "" and
    //    require BOTH ids truthy so an unknown current id falls through to step 3
    //    (soft facingMode) instead of silently shipping the same camera.
    try {
      const curId = localStream?.getVideoTracks()[0]?.getSettings?.().deviceId || "";
      const cams = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === "videoinput");
      const other = cams.find(d => d.deviceId && curId && d.deviceId !== curId);
      if (other) {
        return await navigator.mediaDevices.getUserMedia({ audio: false, video: { ...q, deviceId: { exact: other.deviceId } } });
      }
    } catch { /* fall through */ }
    // 3) Last resort: soft facingMode (some quirky devices honor only this).
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: false, video: { ...q, facingMode: next } });
    } catch { return null; }
  }
  async function flipCamera() {
    if (flipBusy) return;
    if (!localStream) { toast("Camera isn't active yet.", true); return; }
    if (screenSharing) { toast("Stop screen sharing to flip the camera.", true); return; }
    flipBusy = true;
    try {
      const next: "user" | "environment" = facingMode === "user" ? "environment" : "user";
      const nuVideo = await acquireFlippedCamera(next);
      if (!nuVideo || nuVideo.getVideoTracks().length === 0) {
        toast("Couldn't switch camera — this device may only have one.", true);
        return;
      }
      facingMode = next;
      // Carry the SAME audio track across the flip; stop only the old VIDEO.
      const audioTracks = localStream.getAudioTracks();
      localStream.getVideoTracks().forEach(t => t.stop());
      // New combined stream = existing audio + the fresh camera video. The audio
      // track object is unchanged, so toggleMic and every peer/SFU audio sender
      // keep pointing at the right track.
      const nu = new MediaStream([...audioTracks, ...nuVideo.getVideoTracks()]);
      localStream = nu;
      if (pipeline) {
        // Filtered path: the canvas output track is unchanged — just point the
        // pipeline at the new camera. Peers keep the same sender track.
        pipeline.setFacingMode(facingMode);
        await pipeline.setInputStream(nu);
      } else {
        // Raw path: we publish the camera track directly, so hot-swap the VIDEO
        // on every peer / the SFU (audio is untouched — it's the same track).
        await replaceVideoEverywhere(nu.getVideoTracks()[0] || null);
      }
      // Preserve the camera-OFF (mute) state across the flip — a fresh track
      // defaults to enabled, which would otherwise turn the camera back ON.
      syncCamEnabled();
      // Update the local self-tile's video (if shown). With a filter active the
      // processedStream is the SAME object across the flip, so reassigning it
      // alone won't flush the stale buffered frame — null it first to force a
      // rebind, then replay.
      const selfV = $("tile-self")?.querySelector("video") as HTMLVideoElement | null;
      if (selfV) {
        selfV.srcObject = null;
        selfV.srcObject = processedStream || nu;
        void selfV.play().catch(() => {});
      }
      // back camera shouldn't be mirrored on self preview
      const selfTile = $("tile-self");
      if (selfTile) selfTile.classList.toggle("back-cam", facingMode === "environment");
      toast(facingMode === "environment" ? "Switched to back camera" : "Switched to front camera");
    } finally {
      flipBusy = false;
    }
  }

  // Serialize filter changes: applyFilter awaits getUserMedia/MediaPipe/track
  // swaps, so two rapid taps could interleave and leave the published track
  // disagreeing with the selection (or null-deref the pipeline mid-teardown).
  // We coalesce to the LATEST requested filter and run one change at a time.
  let filterBusy = false;
  let pendingFilter: FilterId | null = null;
  async function applyFilter(id: FilterId) {
    if (screenSharing) { toast("Filters are off while sharing your screen.", true); return; }
    pendingFilter = id;
    // Immediate visual feedback on the strip even while a prior change runs.
    const sel = $("filterStrip");
    sel?.querySelectorAll(".relay-filter").forEach(el => {
      (el as HTMLElement).classList.toggle("active", (el as HTMLElement).dataset.id === id);
    });
    if (filterBusy) return;
    filterBusy = true;
    try {
      while (pendingFilter !== null && pendingFilter !== activeFilter) {
        const target = pendingFilter;
        pendingFilter = null;
        await applyFilterInner(target);
      }
    } finally {
      filterBusy = false;
    }
  }
  async function applyFilterInner(id: FilterId) {
    const prev = activeFilter;
    activeFilter = id;
    updateFilterStripUI();

    // No camera yet — remember the choice; ensureMedia() builds the pipeline.
    if (!localStream || localStream.getVideoTracks().length === 0) return;
    if (id === prev) return;

    if (id === "none") {
      // Filters OFF: republish the raw camera track, then stop the canvas loop.
      const rawTrack = localStream.getVideoTracks()[0] || null;
      const dying = pipeline;
      pipeline = null;
      processedStream = null;
      await replaceVideoEverywhere(rawTrack);
      const selfV = $("tile-self")?.querySelector("video") as HTMLVideoElement | null;
      if (selfV) selfV.srcObject = localStream;
      // replaceTrack resolves when senders ACCEPT the raw track, but the encoder
      // may still be draining buffered canvas frames. dispose() stops the canvas
      // captureStream track immediately, which can freeze peers mid-switch — yield
      // one tick so the encoder fully moves to the raw track first.
      await new Promise(r => setTimeout(r, 0));
      // dispose() (NOT destroy()) — keep the shared camera/mic alive.
      try { dying?.dispose(); } catch { /* */ }
      return;
    }

    // Filters ON (or switching between filters).
    const hadPipeline = !!pipeline;
    await ensurePipeline();
    await pipeline!.setFilter(id);
    if (!hadPipeline) {
      // raw → canvas: hot-swap the published track to the processed stream.
      const procTrack = processedStream?.getVideoTracks()[0] || null;
      await replaceVideoEverywhere(procTrack);
      const selfV = $("tile-self")?.querySelector("video") as HTMLVideoElement | null;
      if (selfV) selfV.srcObject = processedStream;
    }
  }
  function updateFilterStripUI() {
    const strip = $("filterStrip");
    if (!strip) return;
    strip.querySelectorAll(".relay-filter").forEach(el => {
      const tile = el as HTMLElement;
      tile.classList.toggle("active", tile.dataset.id === activeFilter);
    });
  }
  function buildFilterStrip() {
    const strip = $("filterStrip");
    if (!strip) return;
    strip.innerHTML = "";
    FILTERS.forEach((f: FilterDef) => {
      const tile = document.createElement("button");
      tile.className = "relay-filter" + (f.id === activeFilter ? " active" : "");
      tile.dataset.id = f.id;
      tile.title = f.label;
      tile.innerHTML = '<span class="emoji">' + f.emoji + '</span><span class="lbl">' + f.label + '</span>';
      tile.onclick = () => applyFilter(f.id as FilterId);
      strip.appendChild(tile);
    });
  }
  function toggleFilterStrip() {
    const dock = $("filterDock");
    if (!dock) return;
    if (!dock.dataset.built) { buildFilterStrip(); dock.dataset.built = "1"; }
    dock.classList.toggle("open");
    updateFilterStripUI();
  }

  // ---------- placing a call ----------
  async function startCall() {
    if (!/^\d{6}$/.test(dialed)) return;
    if (dialed === me.pin) { toast("That's your own number.", true); return; }
    if (peers[dialed]) { toast("You're already connected to them.", true); return; }
    try { await ensureMedia(); } catch { return; }
    const target = dialed; dialed = ""; refreshDisplay(); closeAddPad();
    if (!inCall) { inCall = true; enterCallUI("Calling…"); emitPhase("dialing"); playRingtone("outgoing"); }
    sendWS({ type: "invite", to: target });
    toast("Calling " + target + "…");
  }

  // ---------- programmatic API for embedding hosts ----------
  let onPhaseChange: ((p: RelayPhase) => void) | null = null;
  let lastPhase: RelayPhase = "idle";
  function emitPhase(p: RelayPhase) {
    if (lastPhase === p) return;
    lastPhase = p;
    try { onPhaseChange?.(p); } catch { /* ignore subscriber errors */ }
  }
  async function programmaticDial(target: string, opts?: { voice?: boolean }): Promise<boolean> {
    if (!/^\d{6}$/.test(target)) return false;
    if (!me.pin) return false; // not registered yet — caller should retry
    if (target === me.pin) { toast("That's your own number.", true); return false; }
    if (peers[target]) { toast("You're already connected to them.", true); return false; }
    try { await ensureMedia(); } catch { return false; }
    // Voice call: start with the camera OFF (the existing camera-toggle path).
    // The other side sees an audio-only tile; tapping the camera button upgrades
    // to video instantly (no renegotiation — the track is already published,
    // just disabled). Purely additive: a normal video call is unchanged.
    if (opts?.voice && localStream && localStream.getVideoTracks().length > 0) {
      setCam(false);
    }
    if (!inCall) {
      inCall = true;
      enterCallUI(opts?.voice ? "Voice call…" : "Calling…");
      emitPhase("dialing");
      playRingtone("outgoing");
    }
    sendWS({ type: "invite", to: target });
    toast("Calling " + target + "…");
    return true;
  }

  // Start a GROUP call: ring up to 10 numbers into ONE room. The relay creates
  // the room on the first invite and rings every subsequent invite into the same
  // room, so the first to accept joins and the rest keep ringing (call-waiting
  // style). We gate the extra invites on the server's `room` confirmation so a
  // fresh group dial can't race into two rooms.
  async function programmaticGroupDial(targets: string[], opts?: { voice?: boolean }): Promise<boolean> {
    if (!me.pin) return false;
    const clean = Array.from(
      new Set(
        targets
          .map(t => String(t).replace(/\D/g, "").slice(0, 6))
          .filter(t => /^\d{6}$/.test(t) && t !== me.pin)
      )
    ).slice(0, 10);
    if (clean.length === 0) return false;
    try { await ensureMedia(); } catch { return false; }
    if (opts?.voice && localStream && localStream.getVideoTracks().length > 0) setCam(false);
    const alreadyInRoom = inCall && !!roomId;
    if (!inCall) { inCall = true; enterCallUI(opts?.voice ? "Voice call…" : "Calling…"); emitPhase("dialing"); }
    if (alreadyInRoom) {
      clean.forEach(t => { if (!peers[t]) sendWS({ type: "invite", to: t }); });
    } else {
      const [first, ...rest] = clean;
      pendingGroupInvites = rest;
      sendWS({ type: "invite", to: first });
    }
    toast("Starting group call (" + clean.length + ")…");
    return true;
  }

  // ---------- incoming ----------
  // ---------- call waiting ----------
  function showCallWaiting(name: string, number?: string, flag?: string) {
    const cw = $("callWaiting"); if (!cw) return;
    const n = $("cwName"); if (n) n.textContent = name || "Someone";
    const num = $("cwNum"); if (num) num.textContent = number || "";
    const fl = $("cwFlag"); if (fl) fl.textContent = flag || "";
    cw.classList.add("show");
    if (waitingTimeoutT) clearTimeout(waitingTimeoutT);
    // Auto-decline if ignored, so the second caller isn't left hanging.
    waitingTimeoutT = setTimeout(() => declineWaiting(), 30000);
  }
  function hideCallWaiting() {
    $("callWaiting")?.classList.remove("show");
    if (waitingTimeoutT) { clearTimeout(waitingTimeoutT); waitingTimeoutT = null; }
  }
  function declineWaiting() {
    const w = waitingRing; waitingRing = null;
    hideCallWaiting();
    if (w) sendWS({ type: "reject", to: w.from });
  }
  // ---------- hold / swap / merge (call waiting) ----------
  // A short synthesized tone so a held / resumed caller gets an audible cue even
  // when no remote audio is flowing. Best-effort; silent if Web Audio is blocked.
  let cueCtx: AudioContext | null = null;
  function playCue(kind: "hold" | "resume") {
    try {
      const Ctx = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext | undefined;
      if (!Ctx) return;
      if (!cueCtx) cueCtx = new Ctx();
      void cueCtx.resume();
      const ctx = cueCtx;
      const now = ctx.currentTime;
      // "hold" = two soft descending beeps; "resume" = a brighter rising toot.
      const notes = kind === "resume" ? [660, 990] : [520, 392];
      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        const t0 = now + i * 0.16;
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(0.18, t0 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.15);
        osc.connect(gain); gain.connect(ctx.destination);
        osc.start(t0); osc.stop(t0 + 0.16);
      });
    } catch { /* audio blocked — the visual "on hold" status still shows */ }
  }

  // ---------- ringtone / dial-tone ----------
  // Looping Web-Audio tones so an incoming ring and an outgoing dial both have
  // AUDIBLE feedback, not just the visual overlay. Respects Do Not Disturb (silent,
  // matching onRing's existing DND auto-decline) and a persisted opt-out.
  let ringtoneCtx: AudioContext | null = null;
  let ringtoneTimer: ReturnType<typeof setInterval> | null = null;
  // Every oscillator/gain fire() schedules is tracked so stopRingtone() can tear
  // them out of the Web Audio graph. On Android the context starts SUSPENDED
  // (autoplay policy); oscillators scheduled while suspended stay queued and fire
  // audibly the moment the context later resumes for an unrelated reason (e.g.
  // loudspeakerEnable()'s own resume(), or any mid-call gesture) — long after the
  // call connected. Clearing only the setInterval left those queued nodes in the
  // graph, which is what produced a "peep peep peep" mid-call on Android.
  const ringtoneNodes = new Set<AudioScheduledSourceNode | AudioNode>();
  function ringtoneEnabled(): boolean {
    try { return window.localStorage.getItem("relay_ringtone_off") !== "1"; } catch { return true; }
  }
  function stopRingtone() {
    if (ringtoneTimer) { clearInterval(ringtoneTimer); ringtoneTimer = null; }
    // Stop + disconnect every scheduled node so nothing can fire after this point,
    // even if the context resumes later (Android).
    ringtoneNodes.forEach(n => {
      try { (n as AudioScheduledSourceNode).stop?.(0); } catch { /* not an osc / already stopped */ }
      try { n.disconnect(); } catch { /* already disconnected */ }
    });
    ringtoneNodes.clear();
  }
  function playRingtone(kind: "incoming" | "outgoing") {
    stopRingtone();
    if (!ringtoneEnabled() || isDndOn()) return;
    try {
      const Ctx = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext | undefined;
      if (!Ctx) return;
      if (!ringtoneCtx) ringtoneCtx = new Ctx();
      void ringtoneCtx.resume();
      const fire = () => {
        const ctx = ringtoneCtx; if (!ctx) return;
        const now = ctx.currentTime;
        // Incoming: classic two-burst ring (480Hz then 440Hz). Outgoing: a single
        // soft repeating dial-tone beep so the caller hears it's actually ringing.
        const bursts: Array<[number, number]> = kind === "incoming" ? [[480, 0], [440, 0.45]] : [[425, 0]];
        bursts.forEach(([freq, offset]) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = "sine";
          osc.frequency.value = freq;
          const t0 = now + offset;
          const dur = kind === "incoming" ? 0.4 : 0.9;
          gain.gain.setValueAtTime(0.0001, t0);
          gain.gain.exponentialRampToValueAtTime(0.12, t0 + 0.05);
          gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
          osc.connect(gain); gain.connect(ctx.destination);
          ringtoneNodes.add(osc); ringtoneNodes.add(gain);
          // Self-prune once this burst finishes so the Set never grows unbounded
          // across a long ring.
          osc.onended = () => { ringtoneNodes.delete(osc); ringtoneNodes.delete(gain); };
          osc.start(t0); osc.stop(t0 + dur + 0.05);
        });
      };
      fire();
      ringtoneTimer = setInterval(fire, kind === "incoming" ? 3000 : 2000);
    } catch { /* best-effort — visual ring overlay still shows */ }
  }

  // Call-waiting HOLD state: the OTHER call we've parked while we talk on the
  // active one. On the mesh path we keep its peer connections alive but FROZEN
  // (no media flowing, tiles detached) so a swap-back is instant; on the SFU path
  // we drop the LiveKit connection (the server keeps room membership) and rejoin
  // on resume. At most one held call (a 3rd concurrent caller is rejected).
  let heldRoomId: string | null = null;
  const heldPeers: Record<string, PeerEntry> = {};
  let heldLabel: string | null = null;

  function outAudioTrack(): MediaStreamTrack | null {
    // Audio is always the raw mic (the processed stream carries only video).
    return localStream?.getAudioTracks()[0] || outStream().getAudioTracks()[0] || null;
  }
  function outVideoTrack(): MediaStreamTrack | null {
    if (screenSharing && screenStream) return screenStream.getVideoTracks()[0] || null;
    return outStream().getVideoTracks()[0] || null;
  }
  // Freeze a peer: stop sending it our media (keeps the PC/ICE alive) and detach
  // its tile from the grid (kept in memory so a swap-back re-appends it).
  function freezePeerMedia(e: PeerEntry) {
    try {
      const fz: Array<{ sender: RTCRtpSender; kind: string }> = [];
      e.pc.getSenders().forEach(s => {
        if (s.track) { fz.push({ sender: s, kind: s.track.kind }); void s.replaceTrack(null).catch(() => {}); }
      });
      e.frozen = fz;
    } catch { /* */ }
    if (e.el && e.el.parentNode) e.el.parentNode.removeChild(e.el);
  }
  // Thaw a peer: re-attach our current media tracks and re-append its tile.
  function thawPeerMedia(e: PeerEntry) {
    const v = outVideoTrack(), a = outAudioTrack();
    (e.frozen || []).forEach(({ sender, kind }) => {
      void sender.replaceTrack(kind === "video" ? v : a).catch(() => {});
    });
    e.frozen = null;
    const grid = $("videoGrid");
    if (e.el && grid && !e.el.parentNode) grid.appendChild(e.el);
  }
  function updateHeldBar() {
    const bar = $("heldBar");
    if (!bar) return;
    const has = !!heldRoomId;
    bar.classList.toggle("show", has);
    if (has) { const nm = $("heldName"); if (nm) nm.textContent = heldLabel || "Another call"; }
  }
  // Park the CURRENT active call as HELD (freeze its peers; drop SFU connection).
  function parkActiveAsHeld() {
    heldRoomId = roomId;
    heldLabel = null;
    for (const id in peers) {
      const e = peers[id];
      heldLabel = heldLabel || e.name;
      freezePeerMedia(e);
      heldPeers[id] = e;
      delete peers[id];
    }
    // SFU: the server keeps our membership; drop the live connection and rejoin
    // it when we resume (mesh peers stay connected, so this is a no-op there).
    if (livekitEnabled) teardownLivekit();
    updateHeldBar();
  }
  // Tear down whatever is in `heldPeers` (held call ended or merged away).
  function dropHeld() {
    for (const id in heldPeers) {
      const e = heldPeers[id];
      if (e.graceT) { clearTimeout(e.graceT); e.graceT = null; }
      if (e.restartT) { clearTimeout(e.restartT); e.restartT = null; }
      try { e.pc.close(); } catch { /* */ }
      if (e.el && e.el.parentNode) e.el.parentNode.removeChild(e.el);
      delete heldPeers[id];
    }
    heldRoomId = null;
    heldLabel = null;
    updateHeldBar();
  }

  function switchCall() {
    const w = waitingRing; waitingRing = null;
    hideCallWaiting();
    if (!w) return;
    // If we somehow already hold a call, drop it — we only juggle two lines.
    if (heldRoomId) dropHeld();
    // Put the CURRENT call on HOLD (keep its peers frozen) and accept the new one.
    // The server's `accept` handler detects our prior real call and holds it
    // (broadcasting peer-hold to its members) — no separate `hold`/`leave` needed,
    // which also avoids the old switch race. One message = atomic.
    parkActiveAsHeld();
    roomId = w.roomId;
    enterCallUI("Connecting…");
    sendWS({ type: "accept", roomId: w.roomId });
  }

  // Swap the ACTIVE and HELD calls: freeze the current peers, thaw the held ones,
  // and tell the server to flip the rooms. The server replies `resumed` (handled
  // by onResumed) which re-renders / reconnects the resumed call.
  function swapCall() {
    if (!heldRoomId) { toast("No call on hold.", true); return; }
    // Freeze the currently-active peers into a temp bucket.
    const parking: Record<string, PeerEntry> = {};
    const parkingRoom = roomId;
    let parkingLabel: string | null = null;
    for (const id in peers) {
      const e = peers[id]; parkingLabel = parkingLabel || e.name;
      freezePeerMedia(e); parking[id] = e; delete peers[id];
    }
    if (livekitEnabled) teardownLivekit();
    // Promote the held peers to active.
    for (const id in heldPeers) { peers[id] = heldPeers[id]; delete heldPeers[id]; }
    const resumingRoom = heldRoomId;
    // Move the parked set into held.
    for (const id in parking) heldPeers[id] = parking[id];
    heldRoomId = parkingRoom;
    heldLabel = parkingLabel;
    roomId = resumingRoom;
    sendWS({ type: "swap" });
    // onResumed (server reply) re-renders the now-active call + thaws media.
  }

  // Merge the held call into the active call → a single conference.
  function mergeCall() {
    if (!heldRoomId) { toast("No call on hold.", true); return; }
    // Bring the held peers back as ACTIVE members of the current room, thawed.
    for (const id in heldPeers) {
      const e = heldPeers[id];
      peers[id] = e;
      delete heldPeers[id];
      thawPeerMedia(e);
      if (!e.el) addTile(id, e.name); else { const grid = $("videoGrid"); if (grid && !e.el.parentNode) grid.appendChild(e.el); }
    }
    heldRoomId = null; heldLabel = null;
    updateHeldBar();
    layoutGrid();
    sendWS({ type: "merge" });
    toast("Calls merged");
    addSysMsg("You merged both calls into one conference.");
  }

  // End the ACTIVE line and resume the HELD one (phone-style). With nothing held
  // this is a normal hang-up.
  function endActiveLine() {
    if (!heldRoomId) { hangUp("user-hangup"); return; }
    // Close the active peers; the server's `end-active` leaves the active room and
    // promotes the held one, replying `resumed` to re-activate it here.
    for (const id in peers) {
      try { peers[id].pc.close(); } catch { /* */ }
      if (peers[id].el && peers[id].el!.parentNode) peers[id].el!.parentNode!.removeChild(peers[id].el!);
      delete peers[id];
    }
    if (livekitEnabled) teardownLivekit();
    sendWS({ type: "end-active" });
    addSysMsg("Ended this line — resuming your held call…");
  }

  // Server confirmed a swap / end-active: the named room is now ACTIVE. Thaw its
  // (frozen) mesh peers or reconnect the SFU, re-render, and play the resume cue.
  async function onResumed(m: Msg) {
    const rid = m.roomId || null;
    if (!rid) return;
    roomId = rid;
    inCall = true;
    enterCallUI("In call");
    recordMemberDevices(m.members);
    recordMemberRoles(m.members);
    captureSelfRole(m);
    if (livekitEnabled) {
      if (m.iceServers && m.iceServers.length) iceConfig = buildIceConfig(m.iceServers);
      // The server pushed a fresh token; reconnect to the resumed SFU room.
      if (lkPendingToken && lkPendingToken.roomId === rid && !lkRoom) void joinLivekit(rid);
    } else {
      // Mesh: the resumed peers are FROZEN in `peers` (moved there by swapCall) —
      // thaw each so media flows and tiles re-appear. Any member the server lists
      // that we DON'T have a live peer for (e.g. it died during hold) is re-dialed.
      if (m.iceServers && m.iceServers.length) iceConfig = buildIceConfig(m.iceServers);
      for (const id in peers) thawPeerMedia(peers[id]);
      (m.members || []).forEach(mem => { if (!peers[mem.pin]) callPeer(mem.pin, mem.name); });
    }
    updateHeldBar();
    layoutGrid();
    playCue("resume");
    toast("Back on your other call");
  }

  // Server confirmed a merge: everyone's now in one room. Make sure all listed
  // members have a live, thawed tile (held peers were already promoted client-side
  // in mergeCall; this reconciles anyone the server moved that we lack).
  function onMerged(m: Msg) {
    if (m.roomId) roomId = m.roomId;
    if (!livekitEnabled) {
      (m.members || []).forEach(mem => { if (!peers[mem.pin]) callPeer(mem.pin, mem.name); });
    }
    heldRoomId = null; heldLabel = null;
    updateHeldBar();
    layoutGrid();
  }

  function onRing(m: Msg) {
    // Do Not Disturb: silently auto-decline (no ring overlay, no chime/notify).
    // The caller sees a normal "declined" and the miss is still recorded.
    if (isDndOn()) { sendWS({ type: "reject", to: m.from }); return; }
    if (inCall) {
      if (m.roomId === roomId) return; // already in this room
      // Call waiting: alert (Switch / Decline) instead of auto-rejecting. Only
      // one waiter at a time; a second concurrent caller is rejected.
      if (waitingRing) { sendWS({ type: "reject", to: m.from }); return; }
      waitingRing = { from: m.from!, fromName: m.fromName!, roomId: m.roomId!, flag: m.flag };
      showCallWaiting(m.fromName || nameOf(m.from!), m.from, m.flag);
      return;
    }
    if (pendingRing) { sendWS({ type: "reject", to: m.from }); return; }
    pendingRing = { from: m.from!, fromName: m.fromName!, roomId: m.roomId! };
    const ringAv = $("ringAv"); if (ringAv) ringAv.textContent = initials(m.fromName!);
    const ringWho = $("ringWho"); if (ringWho) ringWho.textContent = m.fromName!;
    const ringSub = $("ringSub"); if (ringSub) ringSub.textContent = "is calling you…";
    $("ringOverlay")?.classList.add("active");
    playRingtone("incoming");
    // Promote the embedding host (Dialer) to fullscreen so the callee actually
    // SEES the Accept/Decline overlay. Without this the engine stays parked
    // off-screen for an incoming call and the callee can never answer — which
    // looked like "the call never connects / they don't receive anything".
    emitPhase("ringing");
    if (ringTimeoutT) clearTimeout(ringTimeoutT);
    ringTimeoutT = setTimeout(() => {
      if (pendingRing && pendingRing.from === m.from) declineInvite();
    }, 60000);
  }
  async function acceptInvite() {
    const r = pendingRing; pendingRing = null;
    if (ringTimeoutT) { clearTimeout(ringTimeoutT); ringTimeoutT = null; }
    $("ringOverlay")?.classList.remove("active");
    stopRingtone();
    if (!r) { emitPhase("idle"); return; }
    try { await ensureMedia(); } catch { sendWS({ type: "reject", to: r.from }); emitPhase("idle"); return; }
    // Accepting is a user gesture — arm the audio unlock now so the remote
    // voice stream (which arrives a second or two later, OUTSIDE any gesture and
    // thus gated by Android's autoplay policy) plays on the user's next touch
    // instead of staying silent until a play() failure happens to re-arm it.
    armAudioUnlock();
    inCall = true; roomId = r.roomId; enterCallUI("In call");
    sendWS({ type: "accept", roomId: r.roomId });
  }
  function declineInvite() {
    const r = pendingRing; pendingRing = null;
    if (ringTimeoutT) { clearTimeout(ringTimeoutT); ringTimeoutT = null; }
    $("ringOverlay")?.classList.remove("active");
    stopRingtone();
    if (r) sendWS({ type: "reject", to: r.from });
    emitPhase("idle");
  }
  // The caller hung up before we answered — clear the incoming-ring UI without
  // sending a reject back (they're already gone).
  function onRingCancel(m: Msg) {
    if (!pendingRing) return;
    if (m.from && pendingRing.from !== m.from) return;
    pendingRing = null;
    if (ringTimeoutT) { clearTimeout(ringTimeoutT); ringTimeoutT = null; }
    $("ringOverlay")?.classList.remove("active");
    stopRingtone();
    toast("Caller cancelled the call");
    emitPhase("idle");
  }

  // ---------- mesh / SFU ----------
  function onJoined(m: Msg) {
    stopRingtone(); // peer connected — stop the outgoing dial tone
    roomId = m.roomId || null;
    recordMemberDevices(m.members);
    recordMemberRoles(m.members);
    captureSelfRole(m);
    if (livekitEnabled && roomId) {
      // SFU path: media goes through LiveKit, not the mesh. Don't build peers;
      // connect to the room (if the token already arrived — otherwise the
      // `livekit-token` push will trigger joinLivekit).
      diag("livekit: joined room " + roomId + " (SFU path)");
      if (lkPendingToken && lkPendingToken.roomId === roomId) void joinLivekit(roomId);
      return;
    }
    // Apply the fresh, per-peer TURN/STUN credentials the server minted for
    // this room BEFORE building any peer connections, so every RTCPeerConnection
    // gathers relay candidates from our coturn (not the stale register-time set).
    if (m.iceServers && m.iceServers.length) {
      iceConfig = buildIceConfig(m.iceServers);
      diag("ice servers from joined (" + m.iceServers.length + ")");
    }
    (m.members || []).forEach(mem => callPeer(mem.pin, mem.name));
  }
  // AUTO-REJOIN: the server says this number is still a member of an active call
  // (after a refresh / reconnect). Re-acquire media, re-enter the call UI, and
  // re-establish media — no fresh invite, no user action needed.
  async function onRejoin(m: Msg) {
    if (inCall) return;              // already in a call — ignore
    const rid = m.roomId || null;
    if (!rid) return;
    // Re-acquire media RESILIENTLY. A transient getUserMedia failure on a fresh
    // page (devices momentarily busy while the previous page's tracks release)
    // must NOT drop us from the call — retry once before giving up. (ensureMedia
    // already falls back to audio-only if only the camera is unavailable.)
    let gotMedia = false;
    try { await ensureMedia(); gotMedia = true; }
    catch {
      await new Promise(r => setTimeout(r, 600));
      try { await ensureMedia(); gotMedia = true; } catch { /* truly hopeless */ }
    }
    if (!gotMedia) {
      // We genuinely can't get a mic — leave so the server drops our membership
      // instead of holding the room open with a phantom member.
      clearPendingRejoin();
      sendWS({ type: "leave", reason: "rejoin-no-media" });
      return;
    }
    roomId = rid;
    inCall = true;
    enterCallUI("In call");          // shows the call screen + arms the SFU watchdog
    recordMemberDevices(m.members);
    recordMemberRoles(m.members);
    captureSelfRole(m);
    // Restore the mic/cam state the user had BEFORE the reload (default = both on,
    // so we only need to flip OFF the ones that were off).
    if (pendingRejoin) {
      if (!pendingRejoin.micOn) setMic(false);
      if (!pendingRejoin.camOn) setCam(false);
    }
    clearPendingRejoin();
    toast("Rejoined the call");
    if (livekitEnabled) {
      diag("rejoin: livekit room " + rid);
      // The server pushed a fresh token right after this message; onLivekitToken
      // will joinLivekit. If it already arrived (race), join now.
      if (lkPendingToken && lkPendingToken.roomId === rid && !lkRoom) void joinLivekit(rid);
      return;
    }
    // Mesh: re-offer to each existing member (glare-free — we're the newcomer).
    if (m.iceServers && m.iceServers.length) iceConfig = buildIceConfig(m.iceServers);
    (m.members || []).forEach(mem => { if (!peers[mem.pin]) callPeer(mem.pin, mem.name); });
  }
  function onPeerJoined(m: Msg) {
    if (m.pin && m.device) { peerDevices[m.pin] = m.device; setTileDevice("tile-" + m.pin, m.device); }
    if (m.pin && m.flag) { peerFlags[m.pin] = m.flag; setTileFlag("tile-" + m.pin, m.flag); }
    if (m.pin && m.role) { peerRoles[m.pin] = m.role as string; setTileRole("tile-" + m.pin, m.role as string); }
    refreshHostPanel();
    // On the SFU path, LiveKit's own ParticipantConnected/TrackSubscribed events
    // drive remote tiles — the mesh offer/answer dance is skipped entirely.
    if (livekitEnabled) return;
    if (peers[m.pin!]) return;
    // Same as onJoined: adopt the fresh relay creds before creating the peer.
    if (m.iceServers && m.iceServers.length) {
      iceConfig = buildIceConfig(m.iceServers);
      diag("ice servers from peer-joined (" + m.iceServers.length + ")");
    }
    createPeer(m.pin!, m.name || "Guest", false);
  }

  // ---------- LiveKit SFU media path ----------
  // Connect to the LiveKit room (= the relay roomId), publish our processed
  // stream, and render remote participants into the existing #videoGrid tiles.
  // Lazy-imports livekit-client so the bundle cost is only paid on a real call.
  async function joinLivekit(rid: string) {
    if (lkRoom) return; // never double-connect
    const tok = lkPendingToken;
    if (!tok || tok.roomId !== rid || !tok.url || !tok.token) {
      diag("livekit: waiting for token");
      return;
    }
    let RoomCtor, RoomEventEnum, TrackEnum;
    try {
      const lk = await import("livekit-client");
      RoomCtor = lk.Room; RoomEventEnum = lk.RoomEvent; TrackEnum = lk.Track;
    } catch (e) {
      diag("livekit: failed to load client");
      console.warn("livekit-client load failed", e);
      return;
    }
    const room = new RoomCtor({ adaptiveStream: true, dynacast: true });
    lkRoom = room;

    const isScreenPub = (pub: unknown): boolean => {
      const src = (pub as { source?: unknown } | null)?.source;
      // LiveKit Track.Source.ScreenShare === "screen_share".
      return String(src) === "screen_share" || src === TrackEnum.Source?.ScreenShare;
    };
    room.on(RoomEventEnum.TrackSubscribed, (track, _pub, participant) => {
      addLkTile(participant.identity, participant.name || participant.identity);
      const el = lkParticipantTiles[participant.identity];
      if (!el) return;
      if (track.kind === TrackEnum.Kind.Video) {
        const vEl = el.querySelector("video") as HTMLVideoElement | null;
        if (vEl) track.attach(vEl);
        bindLkPlaceholder(el, true);
        // A screen-share video → mark the tile so layout auto-focuses it (and
        // the video is letterboxed, not cropped). The tile id is "tile-<identity>".
        if (isScreenPub(_pub)) { screenShareIds.add(el.id); el.classList.add("screen"); }
        // Resume playback + re-layout once the real frame dimensions arrive (and
        // after paint), so a new (esp. screen-share) video shows without needing
        // a device rotation — parity with the self-share path.
        if (vEl) {
          void vEl.play().catch(() => {});
          vEl.addEventListener("loadedmetadata", () => { void vEl.play().catch(() => {}); layoutGrid(); }, { once: true });
        }
        layoutGrid();
        if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => layoutGrid());
      } else if (track.kind === TrackEnum.Kind.Audio) {
        const audioEl = track.attach() as HTMLMediaElement; // detached <audio> for playback
        // Track it so the chosen output device (speaker/earpiece/BT) applies, and
        // route it to the current sink right away.
        lkAudioEls.push(audioEl);
        void applyAudioSink(audioEl);
        // ANDROID ONLY: a DETACHED <audio> element doesn't reliably initialize the
        // WebRTC audio output pipeline on Android Chrome (incoming SFU audio stays
        // silent). Insert it (hidden) into the scoped call root so playback inits,
        // and kick play() with a one-tap fallback. iOS works WITHOUT DOM insertion
        // and a 2nd gated media element there can hurt, so we leave iOS untouched.
        if (IS_ANDROID) {
          try {
            audioEl.style.display = "none";
            root.appendChild(audioEl);
            void audioEl.play?.().catch(() => armAudioUnlock());
          } catch { /* */ }
        }
        // Don't flip the tile to audio-only (which hides the video) if this
        // participant is ALSO publishing camera video — audio commonly
        // subscribes first, and marking audio-only here is what stalls their
        // camera on the SFU. Keep video visible when a video publication exists.
        bindLkPlaceholder(el, lkHasVideo(participant));
      }
    });
    room.on(RoomEventEnum.TrackUnsubscribed, (track, _pub, participant) => {
      let detached: HTMLMediaElement[] = [];
      try { detached = (track.detach() as HTMLMediaElement[] | HTMLMediaElement) as HTMLMediaElement[]; } catch { /* */ }
      // Drop any detached audio elements from the sink-tracking list.
      const arr = Array.isArray(detached) ? detached : (detached ? [detached] : []);
      arr.forEach(d => { const i = lkAudioEls.indexOf(d); if (i >= 0) lkAudioEls.splice(i, 1); });
      const el = lkParticipantTiles[participant.identity];
      if (el && track.kind === TrackEnum.Kind.Video) {
        if (isScreenPub(_pub)) {
          screenShareIds.delete(el.id);
          el.classList.remove("screen");
          // The screen + camera shared one <video>; detaching the screen left it
          // blank. Re-attach the participant's still-live camera so their tile
          // shows their face again (not a frozen black frame).
          const cam = lkCameraTrack(participant);
          const vid = el.querySelector("video") as HTMLVideoElement | null;
          if (cam?.attach && vid) { try { cam.attach(vid); } catch { /* */ } }
        }
        bindLkPlaceholder(el, lkHasVideo(participant));
        layoutGrid();
      }
    });
    // SFU active-speaker: LiveKit reports speakers loudest-first. Map them to
    // tile ids, drop ourselves (we don't auto-spotlight self), and relayout so
    // the spotlight follows whoever's talking.
    if (RoomEventEnum.ActiveSpeakersChanged) {
      room.on(RoomEventEnum.ActiveSpeakersChanged, (speakers: Array<{ identity?: string }>) => {
        const ids = (speakers || [])
          .map(s => s?.identity)
          .filter((id): id is string => !!id && id !== me.pin)
          .map(id => "tile-" + id)
          .filter(id => !!document.getElementById(id));
        speakerOrder = ids;
        const next = ids[0] || null;
        if (next !== activeSpeakerId) { activeSpeakerId = next; layoutGrid(); }
      });
    }
    room.on(RoomEventEnum.ParticipantConnected, p => addLkTile(p.identity, p.name || p.identity));
    room.on(RoomEventEnum.ParticipantDisconnected, p => removeLkTile(p.identity));
    room.on(RoomEventEnum.DataReceived, (payload: Uint8Array) => {
      try { receiveChatFrame(new TextDecoder().decode(payload)); } catch { /* */ }
    });
    // LiveKit drives its OWN reconnection (Reconnecting → Reconnected), and its
    // retry window is longer than our 10s mesh window. So on the SFU path we
    // only surface the status — we must NOT arm our hard timer, or it would race
    // and kill LiveKit's working reconnection. A terminal `Disconnected` (after
    // LiveKit has exhausted its retries) is the single source of teardown.
    if (RoomEventEnum.Reconnecting) {
      room.on(RoomEventEnum.Reconnecting, () => { if (lkRoom === room) setSfuReconnectingUI(); });
    }
    if (RoomEventEnum.Reconnected) {
      room.on(RoomEventEnum.Reconnected, () => { if (lkRoom === room) markEstablished(); });
    }
    room.on(RoomEventEnum.Disconnected, () => {
      if (lkRoom !== room || !inCall) return;
      // Terminal: LiveKit already gave the call its (longer) reconnect window
      // and gave up. End the call rather than show a misleading countdown.
      hangUp("livekit-disconnected");
    });

    try {
      await room.connect(tok.url, tok.token);
      // Publish the SAME processed stream the mesh sends, so filters/blur survive.
      const send = processedStream || localStream;
      if (send) {
        // A VOICE call (camOn already false here — set before enterCallUI) must
        // not publish a video track at all: an unconditional publish meant every
        // "voice-only" call still occupied a video publication/subscription on
        // the SFU (just disabled), wasting bandwidth and showing peers a black
        // tile instead of a clean voice-call UI.
        if (camOn) {
          for (const t of send.getVideoTracks()) await room.localParticipant.publishTrack(t);
        }
        for (const t of send.getAudioTracks()) await room.localParticipant.publishTrack(t);
      }
      lkConnected = true;
      clearLkWatchdog();
      markEstablished(); // SFU media is up → top bar shows "Connected"
      diag("livekit: connected + published");
    } catch (e) {
      // Connect/publish failed (expired token, transient SFU/network fault).
      // Clear the half-built room so the double-connect guard doesn't block a
      // retry, and drop the (maybe-expired) token so the watchdog's
      // refresh-livekit mints a fresh one. No-op if the call already ended.
      diag("livekit: connect failed");
      console.warn("livekit connect failed", e);
      try { void room.disconnect(); } catch { /* */ }
      if (lkRoom === room) lkRoom = null;
      lkConnected = false;
      lkPendingToken = null;
    }
  }

  // Remote-participant tile shims that reuse the existing #videoGrid DOM/CSS
  // (keyed by LiveKit participant.identity, which equals the 6-digit pin).
  // Five rainbow bars that animate (equaliser) only while the tile is .speaking.
  const SOUND_WAVE_HTML = '<div class="sound-wave" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div>';
  // Placeholder (avatar + full name, shown when the camera is off) + an info
  // chip (device + live speed) used by every tile builder.
  function tileContentHTML(name: string, device: string, flag: string, pin?: string): string {
    const dev = device
      ? '<span class="ti-dev">' + escapeHtml(device) + "</span>"
      : '<span class="ti-dev"></span>';
    const fl = '<span class="nm-flag">' + (flag ? escapeHtml(flag) : "") + "</span>";
    // Host/co-host control: a ⋮ menu in the corner (shown only when #videoGrid is
    // .mod-on). Remote tiles only.
    const menuBtn = pin
      ? '<button class="tile-menu-btn" type="button" data-pin="' + escapeHtml(pin) + '" aria-label="Participant options" title="Options">⋮</button>'
      : "";
    // The flag lives ONLY in the bottom-left .nm label (not also in the centered
    // cam-off name) so it never renders twice on a camera-off tile.
    return (
      '<div class="ph"><div class="av">' + initials(name) + "</div>" +
      '<div class="ph-name">' + escapeHtml(name) + "</div>" +
      SOUND_WAVE_HTML + "</div>" +
      '<div class="nm">' + fl + '<span class="nm-text">' + escapeHtml(name) + "</span></div>" +
      '<div class="tile-info">' + dev + '<span class="ti-speed"></span></div>' +
      menuBtn
    );
  }
  function setTileDevice(tileId: string, device: string) {
    const el = document.getElementById(tileId);
    const d = el?.querySelector(".ti-dev") as HTMLElement | null;
    if (d && device) d.textContent = device;
  }
  // Show a participant's country flag in BOTH name spots (the bottom-left label
  // and the cam-off placeholder name).
  function setTileFlag(tileId: string, flag: string) {
    if (!flag) return;
    const el = document.getElementById(tileId);
    el?.querySelectorAll(".nm-flag").forEach(s => { (s as HTMLElement).textContent = flag; });
  }
  // Remember (and display) each member's device type + flag. Works for both
  // paths: the maps are read at LiveKit tile creation, and the live setters
  // update mesh tiles.
  function recordMemberDevices(members?: Array<{ pin: string; device?: string; flag?: string }>) {
    (members || []).forEach(mem => {
      if (mem.device) {
        peerDevices[mem.pin] = mem.device;
        setTileDevice("tile-" + mem.pin, mem.device);
      }
      if (mem.flag) {
        peerFlags[mem.pin] = mem.flag;
        setTileFlag("tile-" + mem.pin, mem.flag);
      }
    });
  }

  // ---------- host moderation (roles, mute, pin) ----------
  function setMic(on: boolean) {
    if (!localStream) return;
    micOn = on;
    localStream.getAudioTracks().forEach(t => (t.enabled = on));
    $("micBtn")?.classList.toggle("off", !on);
  }
  function setTileRole(tileId: string, role: string | null | undefined) {
    const el = document.getElementById(tileId);
    let badge = el?.querySelector(".role-badge") as HTMLElement | null;
    const nm = el?.querySelector(".nm") as HTMLElement | null;
    if (role) {
      if (!badge && nm) {
        badge = document.createElement("span");
        badge.className = "role-badge";
        nm.insertBefore(badge, nm.firstChild);
      }
      if (badge) badge.textContent = role === "host" ? "Host" : "Co-Host";
    } else if (badge) {
      badge.remove();
    }
  }
  function recordMemberRoles(members?: Array<{ pin: string; role?: string }>) {
    (members || []).forEach(mem => {
      if (mem.role) { peerRoles[mem.pin] = mem.role; setTileRole("tile-" + mem.pin, mem.role); }
      else { delete peerRoles[mem.pin]; setTileRole("tile-" + mem.pin, null); }
    });
  }
  function captureSelfRole(m: Msg) {
    if (m.selfRole !== undefined) myRole = m.selfRole ?? null;
    if (m.hostPin !== undefined) roomHostPin = m.hostPin ?? null;
    if (myRole && me.pin) { peerRoles[me.pin] = myRole; setTileRole("tile-self", myRole); }
    updateHostUI();
  }
  function isModerator(): boolean { return myRole === "host" || myRole === "cohost"; }
  function updateHostUI() {
    const b = $("hostBtn");
    if (b) b.style.display = isModerator() ? "" : "none";
    // Reveal the per-tile ⋮ menu buttons only for moderators.
    $("videoGrid")?.classList.toggle("mod-on", isModerator());
  }
  // ---- per-tile host menu (⋮ in a tile corner) ----
  function openTileMenu(pin: string) {
    if (!isModerator() || !pin) return;
    const nameEl = $("tmName"); if (nameEl) nameEl.textContent = nameOf(pin);
    const acts = $("tmActs");
    if (acts) {
      const amHost = myRole === "host";
      const role = peerRoles[pin];
      const rows: string[] = [];
      rows.push('<button data-act="pin" data-pin="' + pin + '">Pin to everyone’s view</button>');
      rows.push('<button data-act="mute" data-pin="' + pin + '">Mute</button>');
      if (amHost) {
        rows.push('<button data-act="cohost" data-pin="' + pin + '">' + (role === "cohost" ? "Remove co-host" : "Make co-host") + "</button>");
        if (role !== "host") rows.push('<button data-act="makehost" data-pin="' + pin + '">Make host</button>');
      }
      rows.push('<button class="tm-danger" data-act="kick" data-pin="' + pin + '">Remove from call</button>');
      acts.innerHTML = rows.join("");
    }
    $("tileMenu")?.classList.add("open");
  }
  function closeTileMenu() { $("tileMenu")?.classList.remove("open"); }
  function onTileMenuClick(e: Event) {
    const btn = (e.target as HTMLElement)?.closest?.("button[data-act]") as HTMLElement | null;
    if (!btn) return;
    const act = btn.getAttribute("data-act") || "";
    const pin = btn.getAttribute("data-pin") || "";
    if (!pin) return;
    if (act === "kick") {
      if (confirm("Remove " + nameOf(pin) + " from the call?")) { sendMod("kick", pin); closeTileMenu(); }
      return;
    }
    if (act === "makehost") {
      if (confirm("Make " + nameOf(pin) + " the host? You'll become a co-host.")) { sendMod("makehost", pin); closeTileMenu(); }
      return;
    }
    sendMod(act, pin); // pin / mute / cohost
    if (act !== "cohost") closeTileMenu();
  }
  function onForceMute(m: Msg) {
    if (m.on) { setMic(false); toast("You were muted by the host."); }
    else { setMic(true); toast("The host unmuted you."); }
  }
  // A peer started/stopped screen sharing. Spotlight (or release) their tile for
  // EVERYONE — independent of per-browser track-source detection, so a shared
  // screen shows prominently to all participants, not just the sharer.
  function onPeerScreen(m: Msg) {
    const pin = m.pin || ""; if (!pin) return;
    const id = "tile-" + pin;
    const tile = document.getElementById(id);
    if (m.on) {
      screenShareIds.add(id);
      tile?.classList.add("screen");
      addSysMsg(nameOf(pin) + " is sharing their screen.");
    } else {
      screenShareIds.delete(id);
      tile?.classList.remove("screen");
    }
    layoutGrid();
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => layoutGrid());
  }
  // A peer put this call on hold to take another call. Mark their tile + notify,
  // and give the HELD party an explicit audible cue (a low tone when put on hold,
  // a brighter rising "toot" when the call resumes).
  function onPeerHold(m: Msg) {
    const pin = m.pin || ""; if (!pin) return;
    const tile = document.getElementById("tile-" + pin);
    const nm = nameOf(pin);
    if (m.on) {
      tile?.classList.add("on-hold");
      addSysMsg(nm + " put you on hold for another call.");
      toast(nm + " put you on hold.");
      playCue("hold");
    } else {
      tile?.classList.remove("on-hold");
      addSysMsg(nm + " is back.");
      toast(nm + " is back.");
      playCue("resume");
    }
  }
  function onRoleChange(m: Msg) {
    const pin = m.pin || "";
    if (!pin) return;
    const role = (m.role as string | null) ?? null;
    if (m.hostPin !== undefined) roomHostPin = m.hostPin ?? null;
    if (role) peerRoles[pin] = role; else delete peerRoles[pin];
    setTileRole(pin === me.pin ? "tile-self" : "tile-" + pin, role);
    if (pin === me.pin) {
      myRole = role; updateHostUI();
      const msg = role === "host" ? "You're now the host."
        : role === "cohost" ? "You're now a co-host."
        : "You're no longer a co-host.";
      toast(msg);
    } else if (role === "host") {
      toast(nameOf(pin) + " is now the host.");
    }
    refreshHostPanel();
  }
  function onHostPin(m: Msg) {
    const pin = m.pin || null;
    if (pin) {
      manualSpotlight = true;
      spotlightId = pin === me.pin ? "tile-self" : "tile-" + pin;
      toast("The host pinned a video.");
    } else {
      manualSpotlight = false;
      spotlightId = null;
      toast("Switched to grid view.");
    }
    layoutGrid();
  }
  // Send a moderation action to the server (host/co-host only — server re-checks).
  function sendMod(action: string, target?: string) {
    sendWS({ type: "mod", action, target });
  }
  function openHostPanel() {
    if (!isModerator()) { toast("Only the host can do that.", true); return; }
    refreshHostPanel();
    $("hostPanel")?.classList.add("open");
  }
  function closeHostPanel() { $("hostPanel")?.classList.remove("open"); }
  // Rebuild the participant list with per-row moderation actions.
  function refreshHostPanel() {
    const list = $("hostList"); const grid = $("videoGrid");
    if (!list || !grid) return;
    const amHost = myRole === "host";
    const rows: string[] = [];
    Array.from(grid.children).forEach(node => {
      const el = node as HTMLElement;
      if (el.id === "tile-self") return;
      const pin = el.id.replace(/^tile-/, "");
      if (!pin) return;
      const rawName = (el.querySelector(".nm")?.textContent || pin).replace(/^(Host|Co-Host)/, "").trim();
      const role = peerRoles[pin];
      const badge = role ? '<span class="hl-badge">' + (role === "host" ? "Host" : "Co-Host") + "</span>" : "";
      const cohostLabel = role === "cohost" ? "Remove co-host" : "Make co-host";
      rows.push(
        '<div class="hl-row">' +
          '<div class="hl-name">' + escapeHtml(rawName) + badge + '<span class="hl-pin">' + escapeHtml(pin) + "</span></div>" +
          '<div class="hl-acts">' +
            '<button data-act="mute" data-pin="' + pin + '">Mute</button>' +
            '<button data-act="pin" data-pin="' + pin + '">Pin</button>' +
            (amHost ? '<button data-act="cohost" data-pin="' + pin + '">' + cohostLabel + "</button>" : "") +
            (amHost && role !== "host" ? '<button data-act="makehost" data-pin="' + pin + '">Make host</button>' : "") +
            (role !== "host" ? '<button class="hl-danger" data-act="kick" data-pin="' + pin + '">Remove</button>' : "") +
          "</div>" +
        "</div>"
      );
    });
    list.innerHTML = rows.join("") || '<div class="hl-empty">No other participants yet.</div>';
  }
  function onHostListClick(e: Event) {
    const btn = (e.target as HTMLElement)?.closest?.("button[data-act]") as HTMLElement | null;
    if (!btn) return;
    const act = btn.getAttribute("data-act") || "";
    const pin = btn.getAttribute("data-pin") || "";
    if (act === "mute") { sendMod("mute", pin); toast("Muted " + pin); }
    else if (act === "pin") { sendMod("pin", pin); closeHostPanel(); }
    else if (act === "cohost") { sendMod("cohost", pin); }
    else if (act === "makehost") {
      if (confirm("Make " + nameOf(pin) + " the host? You'll become a co-host.")) {
        sendMod("makehost", pin); closeHostPanel();
      }
    }
    else if (act === "kick") {
      if (confirm("Remove " + nameOf(pin) + " from the call?")) {
        sendMod("kick", pin); closeHostPanel();
      }
    }
  }

  // ---------- live bitrate (getStats) ----------
  function formatMbps(bitsPerSec: number): string {
    const mbps = bitsPerSec / 1_000_000;
    if (mbps <= 0) return "";
    return (mbps >= 10 ? mbps.toFixed(0) : mbps.toFixed(1)) + " Mbps";
  }
  function setTileSpeed(tileId: string, text: string) {
    const el = document.getElementById(tileId);
    const s = el?.querySelector(".ti-speed") as HTMLElement | null;
    if (s) s.textContent = text;
  }
  async function sampleOneStats(key: string, tileId: string, pc: RTCPeerConnection, outbound: boolean) {
    try {
      const report = await pc.getStats();
      let bytes = 0;
      report.forEach((r: { type?: string; bytesReceived?: number; bytesSent?: number; kind?: string; mediaType?: string }) => {
        const wanted = outbound ? "outbound-rtp" : "inbound-rtp";
        if (r.type === wanted) bytes += (outbound ? r.bytesSent : r.bytesReceived) ?? 0;
      });
      const now = Date.now();
      const prev = statsPrev[key];
      statsPrev[key] = { bytes, ts: now };
      if (prev && now > prev.ts) {
        const bits = (bytes - prev.bytes) * 8;
        const secs = (now - prev.ts) / 1000;
        if (bits >= 0 && secs > 0) setTileSpeed(tileId, formatMbps(bits / secs));
      }
    } catch { /* stats unavailable */ }
  }
  function sampleStats() {
    if (!inCall) return;
    // Mesh peers: inbound bitrate per remote tile.
    for (const pin in peers) {
      void sampleOneStats("in-" + pin, "tile-" + pin, peers[pin].pc, false);
    }
    // Self: outbound bitrate (from any one peer connection — same encode).
    const anyPeer = Object.values(peers)[0];
    if (anyPeer) void sampleOneStats("out-self", "tile-self", anyPeer.pc, true);
    // SFU: best-effort per-participant inbound via the track's own stats report.
    // LiveKit's stats API is loosely typed and varies by version, so this block
    // is intentionally `any` and fully guarded.
    if (livekitEnabled && lkRoom) {
      try {
        const remotes = (lkRoom as unknown as { remoteParticipants?: Map<string, unknown> }).remoteParticipants;
        remotes?.forEach((pp: unknown) => {
          const p = pp as { identity?: string; getTrackPublications?: () => unknown[] };
          const identity = p.identity;
          if (!identity || typeof p.getTrackPublications !== "function") return;
          const pubs = p.getTrackPublications() as Array<{ track?: { getRTCStatsReport?: () => Promise<RTCStatsReport> } }>;
          for (const pub of pubs) {
            const track = pub?.track;
            if (!track || typeof track.getRTCStatsReport !== "function") continue;
            void track.getRTCStatsReport().then((report) => {
              let bytes = 0;
              report.forEach((r: { type?: string; bytesReceived?: number }) => {
                if (r.type === "inbound-rtp") bytes += r.bytesReceived ?? 0;
              });
              const key = "lk-" + identity, now = Date.now(), prev = statsPrev[key];
              statsPrev[key] = { bytes, ts: now };
              if (prev && now > prev.ts) {
                const bits = (bytes - prev.bytes) * 8, secs = (now - prev.ts) / 1000;
                if (bits >= 0 && secs > 0) setTileSpeed("tile-" + identity, formatMbps(bits / secs));
              }
            }).catch(() => {});
            break; // one video pub is enough
          }
        });
      } catch { /* */ }
    }
  }
  function startStatsSampler() {
    if (statsSampleT) return;
    statsSampleT = setInterval(sampleStats, 2000);
  }
  function stopStatsSampler() {
    if (statsSampleT) { clearInterval(statsSampleT); statsSampleT = null; }
    for (const k in statsPrev) delete statsPrev[k];
  }

  function addLkTile(id: string, name: string) {
    if (lkParticipantTiles[id]) return;
    const grid = $("videoGrid"); if (!grid) return;
    const t = document.createElement("div");
    t.className = "relay-tile"; t.id = "tile-" + id;
    const v = document.createElement("video");
    v.autoplay = true; v.playsInline = true;
    t.appendChild(v);
    t.insertAdjacentHTML("beforeend", tileContentHTML(name, peerDevices[id] || "", peerFlags[id] || "", id));
    t.insertAdjacentHTML("beforeend", '<div class="connecting">connecting…</div>');
    lkParticipantTiles[id] = t;
    grid.appendChild(t);
    layoutGrid();
  }
  // True if a LiveKit participant currently publishes a (non-muted) camera video
  // track — even if it hasn't been SUBSCRIBED yet. Used so an audio-first
  // subscription doesn't wrongly mark the tile audio-only. LiveKit objects are
  // dynamically-imported `any`, so probe defensively.
  function lkHasVideo(participant: { getTrackPublications?: () => unknown[]; videoTrackPublications?: Map<string, unknown> }): boolean {
    try {
      const pubs: any[] = typeof participant.getTrackPublications === "function"
        ? participant.getTrackPublications()
        : (participant.videoTrackPublications ? Array.from(participant.videoTrackPublications.values()) : []);
      return pubs.some((p: any) =>
        (p?.kind === "video" || p?.track?.kind === "video" || p?.source === "camera") && p?.isMuted !== true);
    } catch {
      return false;
    }
  }
  // A participant's live CAMERA video track (not their screen share), if any.
  // Used to RE-ATTACH the camera after a screen share ends — on the SFU a
  // participant's camera + screen are two publications that share one tile/video
  // element, so detaching the screen track leaves the element blank otherwise.
  function lkCameraTrack(participant: { getTrackPublications?: () => unknown[]; videoTrackPublications?: Map<string, unknown> }): { attach?: (el: HTMLMediaElement) => void } | null {
    try {
      const pubs: any[] = typeof participant.getTrackPublications === "function"
        ? participant.getTrackPublications()
        : (participant.videoTrackPublications ? Array.from(participant.videoTrackPublications.values()) : []);
      const cam = pubs.find((p: any) =>
        (p?.source === "camera" || (p?.kind !== "audio" && String(p?.source) !== "screen_share"))
        && p?.track && p?.isMuted !== true && p?.track?.kind === "video");
      return cam?.track ?? null;
    } catch {
      return null;
    }
  }
  function bindLkPlaceholder(el: HTMLElement, hasVideo: boolean) {
    const ph = el.querySelector(".ph") as HTMLElement | null;
    if (ph) ph.style.display = hasVideo ? "none" : "flex"; // keep the avatar for audio-only
    el.classList.toggle("audio-only", !hasVideo);
    // Any subscribed track means the participant is connected — clear the
    // "connecting…" overlay regardless of video (else audio-only tiles show it
    // forever, since no Video track ever arrives to flip the state).
    const c = el.querySelector(".connecting") as HTMLElement | null;
    if (c) c.style.display = "none";
    el.dataset.state = "connected";
  }
  function removeLkTile(id: string) {
    const el = lkParticipantTiles[id];
    const nm = el?.querySelector(".nm")?.textContent || "Someone";
    el?.remove();
    delete lkParticipantTiles[id];
    // Drop any spotlight/active state pinned to the gone tile.
    const goneId = "tile-" + id;
    if (spotlightId === goneId) { spotlightId = null; manualSpotlight = false; }
    if (activeSpeakerId === goneId) activeSpeakerId = null;
    screenShareIds.delete(goneId);
    speakerOrder = speakerOrder.filter(s => s !== goneId);
    layoutGrid();
    // Parity with the mesh path's removePeer, which posts a "left" notice.
    if (inCall) addSysMsg(nm + " left the call.");
  }
  // Tear down the LiveKit room + its tiles. Safe to call when not on the SFU path.
  function teardownLivekit() {
    clearLkWatchdog();
    lkConnected = false;
    if (lkRoom) { try { void lkRoom.disconnect(); } catch { /* */ } lkRoom = null; }
    for (const id in lkParticipantTiles) { lkParticipantTiles[id].remove(); delete lkParticipantTiles[id]; }
    lkPendingToken = null;
    // Drop the SFU audio-element refs here too (not just hangUp), so a call-waiting
    // "Switch" that keeps the call alive doesn't retain the old room's elements.
    lkAudioEls.length = 0;
  }
  // Clear a peer's slow-connect timer and revert the placeholder text/class.
  function clearSlowConnect(peer: PeerEntry) {
    if (peer.slowT) { clearTimeout(peer.slowT); peer.slowT = null; }
    if (!peer.el) return;
    peer.el.classList.remove("slow-connect");
    const c = peer.el.querySelector(".connecting") as HTMLElement | null;
    if (c) c.textContent = "connecting…";
  }
  function createPeer(pin: string, name: string, initiator: boolean): PeerEntry {
    if (peers[pin]) return peers[pin];
    const pc = new RTCPeerConnection(iceConfig);
    const peer: PeerEntry = { pc, name: name || "Guest", dc: null, el: null, candQ: [], remoteSet: false, gotStream: false, initiator, graceT: null, restartT: null, iceRestarts: 0, slowT: null };
    peers[pin] = peer;
    // No media after 15s of trying = upgrade the generic "connecting…" tile
    // text to a named "Waiting for X…" (diagnostics panel covers ICE detail;
    // this is just an honest signal in the grid itself, not a new "offline" claim).
    peer.slowT = setTimeout(() => {
      peer.slowT = null;
      if (peer.gotStream || !peer.el) return;
      const st = peer.pc.connectionState;
      if (st === "connected" || st === "failed" || st === "closed") return;
      peer.el.classList.add("slow-connect");
      const c = peer.el.querySelector(".connecting") as HTMLElement | null;
      if (c) c.textContent = "Waiting for " + (peer.name || "them") + "…";
    }, 15000);
    // We send the PROCESSED stream to peers (so they see filters), but if
    // there's no pipeline (audio-only) fall back to the raw stream. Audio always
    // comes from the camera stream; the VIDEO is the SCREEN while sharing, so a
    // participant who joins mid-share sees the screen (not the camera).
    const sendStream = processedStream || localStream;
    if (sendStream) {
      sendStream.getAudioTracks().forEach(t => pc.addTrack(t, sendStream));
      const sharing = screenSharing && screenStream;
      const vtrack = sharing
        ? (screenStream!.getVideoTracks()[0] || null)
        : (sendStream.getVideoTracks()[0] || null);
      if (vtrack) pc.addTrack(vtrack, sharing ? screenStream! : sendStream);
    }
    pc.onicecandidate = e => {
      if (e.candidate) {
        sendWS({ type: "signal", to: pin, data: { candidate: e.candidate } });
        diag("local cand " + pin.slice(-4) + " " + (e.candidate.candidate || "").split(" ")[7]);
      } else {
        diag("local cand-end " + pin.slice(-4));
      }
    };
    pc.ontrack = e => { diag("ontrack from " + pin.slice(-4)); attachRemote(pin, e.streams[0]); };
    pc.onconnectionstatechange = () => {
      const st = pc.connectionState;
      diag("conn " + pin.slice(-4) + " " + st);
      updateTileState(pin, st);
      if (st === "connected") {
        // Recovered (or first connect): cancel any pending teardown.
        if (peer.graceT) { clearTimeout(peer.graceT); peer.graceT = null; }
        peer.iceRestarts = 0;
        clearSlowConnect(peer);
        markEstablished(); // first live media → top bar shows "Connected"
      } else if (st === "closed") {
        removePeer(pin);
      }
      // Re-evaluate the whole call's health: if every peer is in trouble (after
      // the call was live) we flip the top bar to "Reconnecting…" and start the
      // 10s recovery window; if any peer is back, we return to "Connected".
      evaluateMeshHealth();
      // NOTE: we deliberately do NOT tear down on the first `failed` here.
      // The ICE handler below runs a grace window + restart first; only after
      // that window expires without recovery do we remove the peer. This is
      // what stops the "call drops ~3s after dialing" behaviour.
    };
    pc.oniceconnectionstatechange = () => {
      const ist = pc.iceConnectionState;
      diag("ice " + pin.slice(-4) + " " + ist);
      if (ist === "connected" || ist === "completed") {
        if (peer.graceT) { clearTimeout(peer.graceT); peer.graceT = null; }
        return;
      }
      // Both `disconnected` and `failed` get a rescue attempt. `disconnected`
      // is the common transient state browsers sit in for many seconds before
      // `failed`; restarting ICE (with fresh TURN creds) here recovers most
      // cross-NAT calls instead of letting them die.
      if (ist === "disconnected" || ist === "failed") {
        scheduleRescue(pin, ist);
      }
    };
    pc.onicegatheringstatechange = () => diag("gather " + pin.slice(-4) + " " + pc.iceGatheringState);
    if (initiator) {
      const dc = pc.createDataChannel("chat");
      setupDC(pin, dc);
      peer.dc = dc;
    } else {
      pc.ondatachannel = e => { setupDC(pin, e.channel); peer.dc = e.channel; };
    }
    addTile(pin, peer.name);
    return peer;
  }
  async function callPeer(pin: string, name: string) {
    const peer = createPeer(pin, name, true);
    try {
      const offer = await peer.pc.createOffer();
      await peer.pc.setLocalDescription(offer);
      sendWS({ type: "signal", to: pin, data: { sdp: peer.pc.localDescription } });
    } catch (e) { console.warn("offer error", e); }
  }
  async function onSignal(from: string, data?: Msg["data"]) {
    if (!data) return;
    let peer = peers[from];
    if (data.sdp) {
      // A fresh OFFER for an EXISTING peer whose connection is already dead means
      // the remote refreshed/reconnected and is re-offering as a newcomer. Applying
      // it onto the stale (failed/closed/disconnected) RTCPeerConnection stalls, so
      // tear the dead peer down and rebuild from scratch.
      if (
        peer &&
        data.sdp.type === "offer" &&
        (peer.pc.connectionState === "failed" ||
          peer.pc.connectionState === "closed" ||
          peer.pc.connectionState === "disconnected")
      ) {
        removePeer(from, true);
        peer = peers[from]; // deleted above → recreated below
      }
      if (!peer) peer = createPeer(from, "Guest", false);
      try {
        await peer.pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
        peer.remoteSet = true;
        await flushCand(from);
        if (data.sdp.type === "offer") {
          const answer = await peer.pc.createAnswer();
          await peer.pc.setLocalDescription(answer);
          sendWS({ type: "signal", to: from, data: { sdp: peer.pc.localDescription } });
        }
      } catch (e) { console.warn("sdp error", e); }
    } else if (data.candidate) {
      if (!peer) peer = createPeer(from, "Guest", false);
      if (peer.remoteSet) {
        try { await peer.pc.addIceCandidate(new RTCIceCandidate(data.candidate)); } catch { /* */ }
      } else peer.candQ.push(data.candidate);
    }
  }
  async function flushCand(pin: string) {
    const peer = peers[pin];
    if (!peer) return;
    for (const c of peer.candQ) {
      try { await peer.pc.addIceCandidate(new RTCIceCandidate(c)); } catch { /* */ }
    }
    peer.candQ = [];
  }
  // Apply server-issued (refreshed) TURN/STUN credentials. Updates the default
  // config used for new peers AND live-applies to existing connections via
  // setConfiguration so an in-flight restart can use the fresh relay.
  function onIceServers(m: Msg) {
    if (!m.iceServers || !m.iceServers.length) return;
    iceConfig = buildIceConfig(m.iceServers);
    diag("ice servers refreshed (" + m.iceServers.length + ")");
    Object.values(peers).forEach(p => {
      try { p.pc.setConfiguration(iceConfig as RTCConfiguration); } catch { /* */ }
    });
  }
  function removePeer(pin: string, quiet = false) {
    // A member of the HELD call left (their hang-up while we're on the other
    // line). Clean it out of the held bucket; if the held call is now empty,
    // clear the hold so the "on hold" bar disappears.
    if (heldPeers[pin]) {
      const h = heldPeers[pin];
      if (h.graceT) { clearTimeout(h.graceT); h.graceT = null; }
      if (h.restartT) { clearTimeout(h.restartT); h.restartT = null; }
      try { h.pc.close(); } catch { /* */ }
      if (h.el && h.el.parentNode) h.el.parentNode.removeChild(h.el);
      delete heldPeers[pin];
      if (Object.keys(heldPeers).length === 0) { heldRoomId = null; heldLabel = null; updateHeldBar(); }
      if (!peers[pin]) return; // nothing more to do if they weren't also active
    }
    const e = peers[pin];
    if (!e) return;
    const nm = e.name;
    if (e.graceT) { clearTimeout(e.graceT); e.graceT = null; }
    if (e.restartT) { clearTimeout(e.restartT); e.restartT = null; }
    if (e.slowT) { clearTimeout(e.slowT); e.slowT = null; }
    try { e.pc.close(); } catch { /* */ }
    if (e.el) e.el.remove();
    delete peers[pin];
    unregisterMeshAnalyser(pin);
    // Drop any spotlight/active state pinned to the gone tile so layout recovers.
    const goneId = "tile-" + pin;
    if (spotlightId === goneId) { spotlightId = null; manualSpotlight = false; }
    if (activeSpeakerId === goneId) activeSpeakerId = null;
    screenShareIds.delete(goneId);
    speakerOrder = speakerOrder.filter(s => s !== goneId);
    layoutGrid();
    // `quiet` skips the "X left the call" system message — used when we're
    // immediately rebuilding the peer (a refresh/reconnect re-offer), not when
    // they're genuinely leaving.
    if (inCall && !quiet) addSysMsg((nm || "Someone") + " left the call.");
  }

  // ---------- diagnostics ----------
  const diagLog: string[] = [];
  function diag(line: string) {
    const ts = new Date().toISOString().slice(11, 23);
    const entry = ts + "  " + line;
    diagLog.push(entry);
    if (diagLog.length > 200) diagLog.shift();
    const box = $("diagBody");
    if (box) {
      box.textContent = diagLog.join("\n");
      box.scrollTop = box.scrollHeight;
    }
  }
  function updateTileState(pin: string, st: string) {
    const peer = peers[pin];
    if (!peer || !peer.el) return;
    const c = peer.el.querySelector(".connecting") as HTMLElement | null;
    if (c) {
      if (st === "connected" || peer.gotStream) {
        c.style.display = "none";
      } else {
        c.style.display = "block";
        c.textContent = st === "failed" ? "connection failed" :
                        st === "disconnected" ? "reconnecting…" :
                        st === "checking" ? "checking network…" :
                        "connecting…";
      }
    }
    peer.el.dataset.state = st;
  }
  const MAX_ICE_RESTARTS = 4;
  const GRACE_MS = 8000;       // how long to let `disconnected` self-heal
  const RESTART_DEBOUNCE_MS = 1200;

  // Rescue a peer whose ICE went `disconnected`/`failed`. We (a) ask the server
  // for fresh TURN creds, (b) after a short grace window for `disconnected`
  // (immediately for `failed`), trigger an ICE restart from the offerer side,
  // and (c) only tear the peer down if the grace window fully elapses without
  // recovery AND we've exhausted restart attempts. This is what stops calls
  // dropping ~3s after dialing.
  function scheduleRescue(pin: string, ist: string) {
    const peer = peers[pin];
    if (!peer) return;
    // Pull fresh ICE servers so a restart can land on a working relay.
    requestFreshIce();
    // `failed` is terminal-ish: restart right away. `disconnected` often heals
    // on its own, so give it a grace window before doing anything drastic.
    if (ist === "failed") {
      debouncedRestart(pin);
    }
    if (peer.graceT) return; // already counting down
    peer.graceT = setTimeout(() => {
      peer.graceT = null;
      const cur = peer.pc.iceConnectionState;
      if (cur === "connected" || cur === "completed") return; // healed
      // still broken after the grace window
      if (peer.iceRestarts < MAX_ICE_RESTARTS) {
        debouncedRestart(pin);
        // re-arm a shorter window to check the restart result
        peer.graceT = setTimeout(() => {
          peer.graceT = null;
          const c2 = peer.pc.iceConnectionState;
          if ((c2 === "failed" || c2 === "disconnected") && !peer.gotStream) {
            diag("giving up on " + pin.slice(-4) + " after " + peer.iceRestarts + " restarts");
            removePeer(pin);
          }
        }, GRACE_MS);
      } else if (!peer.gotStream) {
        diag("giving up on " + pin.slice(-4) + " (max restarts)");
        removePeer(pin);
      }
    }, ist === "failed" ? 1500 : GRACE_MS);
  }

  function debouncedRestart(pin: string) {
    const peer = peers[pin];
    if (!peer) return;
    if (peer.restartT) return;
    // Hard floor between actual restart attempts, independent of the pending-timer
    // debounce above — stops a flapping ICE state from re-triggering immediately
    // after a restart just fired.
    if (Date.now() - (peer.lastRestartTime || 0) < 5000) return;
    peer.restartT = setTimeout(() => {
      peer.restartT = null;
      peer.lastRestartTime = Date.now();
      tryIceRestart(pin).catch(() => { /* */ });
    }, RESTART_DEBOUNCE_MS);
  }

  // Ask the signaling server to re-issue short-lived TURN credentials. The
  // server replies with a `{ type: "ice", iceServers }` message handled below.
  let lastIceRefresh = 0;
  function requestFreshIce() {
    const now = Date.now();
    if (now - lastIceRefresh < 5000) return; // don't spam
    lastIceRefresh = now;
    sendWS({ type: "refresh-ice" });
  }

  async function tryIceRestart(pin: string) {
    const peer = peers[pin];
    if (!peer) return;
    // Only the offerer performs the restart (avoids glare). If we're not the
    // initiator, nudge the peer by asking the server for fresh creds; their
    // side will drive the restart.
    if (!peer.initiator) { requestFreshIce(); return; }
    if (peer.iceRestarts >= MAX_ICE_RESTARTS) return;
    peer.iceRestarts++;
    try {
      // Apply any freshly-received TURN creds to this live connection before
      // restarting, so the new offer gathers relay candidates from them.
      try { peer.pc.setConfiguration(iceConfig as RTCConfiguration); } catch { /* older browsers */ }
      diag("ice restart " + pin.slice(-4) + " (#" + peer.iceRestarts + ")");
      const offer = await peer.pc.createOffer({ iceRestart: true });
      await peer.pc.setLocalDescription(offer);
      sendWS({ type: "signal", to: pin, data: { sdp: peer.pc.localDescription } });
    } catch (e) { console.warn("ice restart failed", e); }
  }
  function toggleDiag() {
    const o = $("diagOverlay");
    if (!o) return;
    o.classList.toggle("open");
    const box = $("diagBody");
    if (box) {
      const lines = [
        "cid=" + cid,
        "pin=" + (me.pin || "-"),
        "name=" + (me.name || "-"),
        "sse=" + (ws ? ["CONNECTING", "OPEN", "CLOSED"][ws.readyState] || "?" : "none"),
        "ice servers=" + iceConfig.iceServers.map(s => s.urls).join(", "),
        "peers=" + Object.keys(peers).length,
        ...Object.entries(peers).map(([p, e]) =>
          "  " + p + " name=" + e.name +
          " conn=" + e.pc.connectionState +
          " ice=" + e.pc.iceConnectionState +
          " gather=" + e.pc.iceGatheringState +
          " sig=" + e.pc.signalingState +
          " remote=" + (e.remoteSet ? "y" : "n") +
          " stream=" + (e.gotStream ? "y" : "n")),
        "",
        "--- device capabilities (cross-platform QA) ---",
        ...buildCapabilityReport(probeBrowserMedia()).rows.map(
          r => "  " + (r.supported ? "✓" : "✗") + " " + r.label + (r.note ? " — " + r.note : "")
        ),
        "",
        "--- recent events ---",
        ...diagLog,
      ];
      box.textContent = lines.join("\n");
      box.scrollTop = box.scrollHeight;
    }
  }

  // ---------- video grid ----------
  // ---------- live connection status + 10s reconnect window ----------
  // The top bar shows a REAL status (connecting → encrypting → live, or
  // reconnecting), not a scripted animation. If the call drops after it was
  // live, we hold the call open and try to recover for RECONNECT_WINDOW_MS
  // before tearing down — so a brief tunnel/elevator/Wi-Fi blip doesn't kill
  // the call.
  type CallStatus = "connecting" | "encrypting" | "live" | "reconnecting";
  let callStatus: CallStatus = "connecting";
  let establishedOnce = false; // reached "live" at least once this call
  let reconnectHardT: ReturnType<typeof setTimeout> | null = null;
  let reconnectTickT: ReturnType<typeof setInterval> | null = null;
  let connSeqTimers: ReturnType<typeof setTimeout>[] = [];
  const RECONNECT_WINDOW_MS = 10000;
  const STATUS_LABEL: Record<CallStatus, string> = {
    connecting: "Connecting…",
    encrypting: "Securing connection…",
    live: "Connected",
    reconnecting: "Reconnecting…",
  };
  function setCallStatus(s: CallStatus, labelOverride?: string) {
    callStatus = s;
    const lbl = $("callRoomLbl");
    if (lbl) lbl.textContent = labelOverride ?? STATUS_LABEL[s];
    const ct = $("call")?.querySelector(".call-head .ct");
    if (ct) {
      ct.classList.remove("st-connecting", "st-encrypting", "st-live", "st-reconnecting");
      ct.classList.add("st-" + s);
    }
  }
  function clearConnSeq() {
    connSeqTimers.forEach(t => clearTimeout(t));
    connSeqTimers = [];
  }
  // Drive connecting → encrypting while the transport comes up; the real "live"
  // flip happens when a peer / the SFU actually connects.
  function runConnSequence() {
    clearConnSeq();
    setCallStatus("connecting");
    connSeqTimers.push(setTimeout(() => {
      if (callStatus === "connecting") setCallStatus("encrypting");
    }, 600));
  }
  // We reached a live media connection. Cancel any reconnect window and show it.
  // This is the AUTHORITATIVE "the call is actually connected" signal — it fires
  // from the peer-connection state machine (mesh) and LiveKit connect/reconnect
  // (SFU), not a timer. So it's the one reliable place to (a) silence the ring
  // and (b) flip the phase to "in-call". Without this the OUTGOING caller stayed
  // in phase "dialing" for the whole call, and on iOS (Safari throttles the
  // timer-driven stopRingtone in the background) the ring/animation persisted
  // even after the conversation was live. Both calls are idempotent.
  function markEstablished() {
    establishedOnce = true;
    exitReconnecting();
    clearConnSeq();
    stopRingtone();          // definitively kill any outgoing dial tone
    emitPhase("in-call");    // caller: leave "dialing" so the ring UI clears
    if (callStatus !== "live") setCallStatus("live");
  }
  // MESH reconnect: WE own recovery (ICE restarts + signaling), so we run a
  // hard 10s window with a visible countdown and tear the call down if it
  // doesn't recover. NOT used on the SFU path — see setSfuReconnectingUI().
  function enterReconnecting() {
    if (!inCall || !establishedOnce || livekitEnabled) return;
    if (reconnectHardT) return; // already counting down
    // Re-open signaling ONLY if it's actually unhealthy (don't tear down a
    // working SSE channel on a transient media blip), then kick ICE restarts.
    if (!ws || ws.readyState !== 1 /* EventSource.OPEN */) {
      try { ws?.close(); } catch { /* */ }
      if (!destroyed) connectWS();
    }
    Object.keys(peers).forEach(pin => { try { void tryIceRestart(pin); } catch { /* */ } });
    let remaining = Math.ceil(RECONNECT_WINDOW_MS / 1000);
    setCallStatus("reconnecting", "Reconnecting… " + remaining + "s");
    reconnectTickT = setInterval(() => {
      remaining -= 1;
      if (remaining > 0 && callStatus === "reconnecting") {
        setCallStatus("reconnecting", "Reconnecting… " + remaining + "s");
      }
    }, 1000);
    reconnectHardT = setTimeout(() => {
      reconnectHardT = null;
      toast("Call lost — couldn't reconnect.", true);
      hangUp("connection-lost");
    }, RECONNECT_WINDOW_MS);
  }
  // SFU reconnect: LiveKit owns its OWN retry loop (which is longer than 10s),
  // so we must NOT arm our hard timer — that would race and kill LiveKit's
  // working reconnection. We only surface the status; the terminal LiveKit
  // `Disconnected` event is the single source of teardown.
  function setSfuReconnectingUI() {
    if (!inCall || !establishedOnce) return;
    setCallStatus("reconnecting");
  }
  function exitReconnecting() {
    if (reconnectHardT) { clearTimeout(reconnectHardT); reconnectHardT = null; }
    if (reconnectTickT) { clearInterval(reconnectTickT); reconnectTickT = null; }
  }
  // Re-evaluate whether the mesh call is healthy after any peer state change.
  // Only a TERMINAL failure (`failed`/`closed`) on every peer opens the window —
  // a transient `disconnected` is left to the per-peer grace + ICE restart (and
  // still shows "reconnecting…" on the tile) so brief blips don't flap the UI or
  // tear down signaling.
  function evaluateMeshHealth() {
    if (livekitEnabled || !inCall || !establishedOnce) return;
    const ps = Object.values(peers);
    if (ps.length === 0) return; // alone — nothing to reconnect to
    const anyConnected = ps.some(p => p.pc.connectionState === "connected");
    if (anyConnected) {
      exitReconnecting();
      if (callStatus === "reconnecting") setCallStatus("live");
      return;
    }
    const allTerminal = ps.every(p =>
      ["failed", "closed"].includes(p.pc.connectionState));
    if (allTerminal) enterReconnecting();
  }
  function enterCallUI(label: string) {
    show("call");
    establishedOnce = false;
    exitReconnecting();
    resetSpeakerView(); // fresh call → no stale spotlight/active-speaker focus
    startStatsSampler(); // live per-tile bitrate
    void seedAudioOutputs(); // snapshot outputs so a later BT connect is detected
    runConnSequence();
    // On the SFU path, start the join watchdog so a failed/slow token or connect
    // recovers (re-request) or surfaces an error instead of a silent dead call.
    if (livekitEnabled) armLkWatchdog();
    if (label && /in call/i.test(label)) emitPhase("in-call");
    // NOTE: the top-bar label is now owned by setCallStatus() (live status),
    // so we deliberately do NOT write `label` into #callRoomLbl here.
    const grid = $("videoGrid"); if (grid) grid.innerHTML = "";
    addSelfTile();
    for (const id in peers) { if (!peers[id].el) addTile(id, peers[id].name); }
    layoutGrid();
    callStart = Date.now();
    if (timerInt) clearInterval(timerInt);
    timerInt = setInterval(() => {
      const s = Math.floor((Date.now() - callStart) / 1000);
      const t = $("timer");
      if (t) t.textContent = String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
    }, 1000);
    // If the user has enabled auto-PiP once, warm the compositor now so a later
    // background auto-opens the PiP window with no tap.
    primeAutoPip();
  }
  function addSelfTile() {
    const grid = $("videoGrid"); if (!grid) return;
    const t = document.createElement("div");
    t.className = "relay-tile you"; t.id = "tile-self";
    if (facingMode === "environment") t.classList.add("back-cam");
    const v = document.createElement("video");
    v.autoplay = true; v.muted = true; v.playsInline = true;
    // Show the PROCESSED stream in the self-tile so the user sees their filter
    // exactly as the remote peer will see it.
    v.srcObject = processedStream || localStream;
    t.appendChild(v);
    // Avatar (from the user's name) + "You" label + device chip. The avatar
    // shows whenever the camera is off so the tile is never a blank black box.
    const selfFl = '<span class="nm-flag">' + (selfFlag ? escapeHtml(selfFlag) : "") + "</span>";
    t.insertAdjacentHTML(
      "beforeend",
      '<div class="ph"><div class="av">' + initials(me.name || "You") + "</div>" +
        '<div class="ph-name">You</div>' +
        SOUND_WAVE_HTML + "</div>" +
        '<div class="nm">' + selfFl + '<span class="nm-text">You</span></div>' +
        '<div class="tile-info"><span class="ti-dev">' + escapeHtml(detectDeviceType()) + "</span>" +
        '<span class="ti-speed"></span></div>'
    );
    grid.appendChild(t);
    if (!camOn) t.classList.add("audio-only");
  }
  function addTile(id: string, name: string) {
    if (!inCall) return;
    const entry = peers[id]; if (!entry || entry.el) return;
    const grid = $("videoGrid"); if (!grid) return;
    const t = document.createElement("div");
    t.className = "relay-tile"; t.id = "tile-" + id;
    const v = document.createElement("video");
    v.autoplay = true; v.playsInline = true;
    t.appendChild(v);
    t.insertAdjacentHTML("beforeend", tileContentHTML(name, peerDevices[id] || "", peerFlags[id] || "", id));
    t.insertAdjacentHTML("beforeend", '<div class="connecting">connecting…</div>');
    entry.el = t;
    grid.appendChild(t);
    layoutGrid();
  }
  function attachRemote(id: string, stream: MediaStream) {
    const entry = peers[id]; if (!entry) return;
    if (!entry.el) addTile(id, entry.name);
    if (!entry.el) return;
    entry.gotStream = true;
    clearSlowConnect(entry);
    const v = entry.el.querySelector("video") as HTMLVideoElement | null;
    if (v) {
      v.srcObject = stream;
      void applyAudioSink(v);
      // Android Chrome gates an unmuted element's autoplay until an explicit
      // play() — without this the remote <video> stays PAUSED and INCOMING AUDIO
      // is silent (outgoing is unaffected). Mirrors the LiveKit video path. iOS
      // treats this as a no-op, so it's safe there. If play() is rejected (no
      // user gesture yet), arm a one-tap recovery so audio is never stuck silent.
      void v.play().catch(() => armAudioUnlock());
    }
    const c = entry.el.querySelector(".connecting") as HTMLElement | null;
    if (c) c.style.display = "none";
    // Tap the remote audio for active-speaker metering (mesh path only).
    registerMeshAnalyser(id, stream);
    const sync = () => {
      const has = stream.getVideoTracks().some(tr => tr.enabled && tr.readyState === "live");
      const ph = entry.el!.querySelector(".ph") as HTMLElement | null;
      if (ph) ph.style.display = has ? "none" : "flex";
    };
    sync();
    stream.getVideoTracks().forEach(tr => { tr.onmute = sync; tr.onunmute = sync; tr.onended = sync; });
  }
  // The single layout brain: equal grid by default, a 1-big-+-thumbs SPOTLIGHT
  // when there's a focused tile (manual pin > screen share > active speaker), or
  // a 2-up of the most-active tiles when the call is "minimized" (compact). The
  // DECISION is the pure computeLayout() in callLayout.ts; this just applies it.
  function layoutGrid() {
    const g = $("videoGrid"); if (!g) return;
    const tiles = Array.from(g.children) as HTMLElement[];
    // Reset transient per-tile + container state from the previous pass.
    tiles.forEach(t => {
      t.style.gridColumn = ""; t.style.gridRow = ""; t.style.display = "";
      t.classList.remove("is-spotlight", "is-thumb");
      t.classList.toggle("speaking", t.id === activeSpeakerId && !screenShareIds.has(t.id));
    });
    g.classList.remove("spotlight", "compact");
    if (tiles.length === 0) return;

    const plan = computeLayout({
      tileIds: tiles.map(t => t.id),
      manualSpotlightId: manualSpotlight ? spotlightId : null,
      screenShareIds: Array.from(screenShareIds),
      activeSpeakerId,
      speakerOrder,
      compact: compactView,
    });
    const byId = (id: string) => tiles.find(t => t.id === id) || null;

    if (plan.mode === "compact") {
      g.classList.add("compact");
      const shown = new Set(plan.shownIds);
      tiles.forEach(t => { if (!shown.has(t.id)) t.style.display = "none"; });
      g.style.gridTemplateColumns = "1fr";
      g.style.gridTemplateRows = plan.shownIds.length > 1 ? "1fr 1fr" : "1fr";
      return;
    }

    if (plan.mode === "spotlight" && plan.focusId) {
      g.classList.add("spotlight");
      const cols = Math.max(plan.thumbIds.length, 1);
      g.style.gridTemplateColumns = "repeat(" + cols + ",minmax(0,1fr))";
      g.style.gridTemplateRows = plan.thumbIds.length ? "minmax(0,1fr) 22%" : "1fr";
      const spot = byId(plan.focusId);
      if (spot) { spot.classList.add("is-spotlight"); spot.style.gridColumn = "1 / -1"; spot.style.gridRow = "1"; }
      plan.thumbIds.forEach(id => { const t = byId(id); if (t) { t.classList.add("is-thumb"); t.style.gridRow = "2"; } });
      return;
    }

    // Default equal grid (the original behaviour).
    const n = tiles.length;
    let cols = 1; if (n > 1) cols = 2; if (n > 4) cols = 3;
    g.style.gridTemplateColumns = "repeat(" + cols + ",1fr)";
    g.style.gridTemplateRows = "repeat(" + Math.ceil(n / cols) + ",minmax(0,1fr))";
  }

  /** Click a tile to spotlight it big; click the spotlighted tile again to unpin. */
  function onGridClick(e: Event) {
    if (!inCall) return;
    // A tap on the per-tile ⋮ opens the host menu instead of spotlighting.
    const menuBtn = (e.target as HTMLElement)?.closest?.(".tile-menu-btn") as HTMLElement | null;
    if (menuBtn) {
      e.stopPropagation();
      openTileMenu(menuBtn.getAttribute("data-pin") || "");
      return;
    }
    const tile = (e.target as HTMLElement)?.closest?.(".relay-tile") as HTMLElement | null;
    if (!tile) return;
    if (manualSpotlight && spotlightId === tile.id) {
      manualSpotlight = false; spotlightId = null;
    } else {
      manualSpotlight = true; spotlightId = tile.id;
    }
    layoutGrid();
  }

  /** Reset all spotlight/active-speaker state (called when a call (re)starts). */
  function resetSpeakerView() {
    spotlightId = null; manualSpotlight = false;
    activeSpeakerId = null; speakerOrder = [];
    speakerCandidate = null; speakerCandidateCount = 0;
    screenShareIds.clear(); compactView = false;
  }

  // ---------- mesh active-speaker (Web Audio level metering) ----------
  function ensureMeshSpeakerMonitor() {
    if (livekitEnabled) return;
    if (!meshAudioCtx) {
      try {
        const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctx) return;
        meshAudioCtx = new Ctx();
      } catch { return; }
    }
    try { void meshAudioCtx.resume(); } catch { /* */ }
    if (!speakerSampleT) speakerSampleT = setInterval(sampleMeshSpeakers, 400);
  }
  function registerMeshAnalyser(pin: string, stream: MediaStream) {
    if (livekitEnabled || meshAnalysers[pin]) return;
    if (!stream.getAudioTracks().length) return;
    ensureMeshSpeakerMonitor();
    if (!meshAudioCtx) return;
    try {
      const src = meshAudioCtx.createMediaStreamSource(stream);
      const node = meshAudioCtx.createAnalyser();
      node.fftSize = 256;
      src.connect(node); // analyser is a sink only — never connected to destination
      const data = new Uint8Array(new ArrayBuffer(node.frequencyBinCount));
      meshAnalysers[pin] = { node, src, data };
    } catch { /* */ }
  }
  function unregisterMeshAnalyser(pin: string) {
    const a = meshAnalysers[pin];
    if (!a) return;
    try { a.src.disconnect(); a.node.disconnect(); } catch { /* */ }
    delete meshAnalysers[pin];
  }
  function sampleMeshSpeakers() {
    const levels: Array<{ id: string; level: number }> = [];
    for (const pin in meshAnalysers) {
      if (!document.getElementById("tile-" + pin)) continue;
      const a = meshAnalysers[pin];
      a.node.getByteFrequencyData(a.data);
      let sum = 0;
      for (let i = 0; i < a.data.length; i++) sum += a.data[i];
      levels.push({ id: "tile-" + pin, level: sum / a.data.length });
    }
    levels.sort((x, y) => y.level - x.level);
    const SPEAK = 12; // empirical avg-bin threshold on 0..255
    const loud = levels.filter(l => l.level > SPEAK).map(l => l.id);
    speakerOrder = loud;
    const next = loud[0] || null;
    // Hysteresis: don't flip the spotlight on a single noisy sample. A new leader
    // must lead for 2 consecutive samples (~800ms) before we switch — unless
    // there's no current speaker yet. Silence (next === null) HOLDS the last
    // speaker rather than dropping the spotlight to nobody.
    if (next && next !== activeSpeakerId) {
      if (next === speakerCandidate) speakerCandidateCount++;
      else { speakerCandidate = next; speakerCandidateCount = 1; }
      if (activeSpeakerId === null || speakerCandidateCount >= 2) {
        activeSpeakerId = next;
        speakerCandidate = null; speakerCandidateCount = 0;
        layoutGrid();
      }
    } else if (next === activeSpeakerId) {
      speakerCandidate = null; speakerCandidateCount = 0;
    }
  }
  function teardownSpeakerMonitor() {
    if (speakerSampleT) { clearInterval(speakerSampleT); speakerSampleT = null; }
    for (const pin in meshAnalysers) unregisterMeshAnalyser(pin);
    if (meshAudioCtx) { try { void meshAudioCtx.close(); } catch { /* */ } meshAudioCtx = null; }
  }

  // ---------- local mic level (VU) feedback ----------
  // A muted mic that's still "hot" — or the reverse, a forgotten mute — is
  // invisible without this: a small accent pulse on #micBtn whenever YOUR voice
  // is detected, so it's obvious before a peer has to say "you're on mute".
  // Independent of livekitEnabled/meshAudioCtx (which only taps REMOTE streams).
  let localLevelCtx: AudioContext | null = null;
  let localLevelAnalyser: { src: MediaStreamAudioSourceNode; node: AnalyserNode; data: Uint8Array<ArrayBuffer> } | null = null;
  let localLevelT: ReturnType<typeof setInterval> | null = null;
  function ensureLocalLevelMonitor() {
    if (localLevelAnalyser || !localStream || localStream.getAudioTracks().length === 0) return;
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      if (!localLevelCtx) localLevelCtx = new Ctx();
      void localLevelCtx.resume();
      // Tap via a NEW MediaStream wrapping the same track — never the destination,
      // so this can't interfere with anything else reading the track (e.g. the
      // RTCRtpSender publishing it to peers).
      const src = localLevelCtx.createMediaStreamSource(new MediaStream([localStream.getAudioTracks()[0]]));
      const node = localLevelCtx.createAnalyser();
      node.fftSize = 256;
      src.connect(node);
      localLevelAnalyser = { src, node, data: new Uint8Array(new ArrayBuffer(node.frequencyBinCount)) };
      if (!localLevelT) localLevelT = setInterval(sampleLocalLevel, 400);
    } catch { /* best-effort — silent if Web Audio is unavailable */ }
  }
  function sampleLocalLevel() {
    const a = localLevelAnalyser;
    const btn = $("micBtn");
    if (!a || !btn) return;
    a.node.getByteFrequencyData(a.data);
    let sum = 0;
    for (let i = 0; i < a.data.length; i++) sum += a.data[i];
    const level = sum / a.data.length;
    btn.classList.toggle("voiced", micOn && level > 12);
  }
  function teardownLocalLevelMonitor() {
    if (localLevelT) { clearInterval(localLevelT); localLevelT = null; }
    if (localLevelAnalyser) {
      try { localLevelAnalyser.src.disconnect(); localLevelAnalyser.node.disconnect(); } catch { /* */ }
      localLevelAnalyser = null;
    }
    if (localLevelCtx) { try { void localLevelCtx.close(); } catch { /* */ } localLevelCtx = null; }
    $("micBtn")?.classList.remove("voiced");
  }

  // ---------- Picture-in-Picture (composited active speakers) ----------
  // Minimizing a mobile browser pauses the call; PiP keeps it alive + visible.
  // We composite the top-2 active speakers onto a canvas, capture that canvas as
  // a stream, and PiP the resulting video — so a single PiP window shows a 2-up
  // split that follows whoever's talking (and a shared screen).
  let pipCanvas: HTMLCanvasElement | null = null;
  let pipCtx: CanvasRenderingContext2D | null = null;
  let pipVideo: HTMLVideoElement | null = null;
  let pipStream: MediaStream | null = null;
  let pipActive = false;
  let pipPrimed = false;      // compositor kept warm so the browser can AUTO-enter
  let pipAutoEntered = false; // PiP was opened by backgrounding (not a manual tap)
  let pipTimer: ReturnType<typeof setInterval> | null = null;
  const PIP_ACTIVE_MS = 80;   // smooth composite while the PiP window is showing
  const PIP_PRIME_MS = 1000;  // trickle while primed-but-foreground (keeps track live)
  // "Enable once" preference: when ON, PiP auto-engages whenever the user
  // backgrounds the app during a call — no per-call tap. Persisted so it survives
  // reloads / future calls.
  function autoPipPref(): boolean {
    try { return window.localStorage.getItem("relay_auto_pip") === "1"; } catch { return false; }
  }
  function setAutoPipPref(on: boolean): void {
    try { window.localStorage.setItem("relay_auto_pip", on ? "1" : "0"); } catch { /* */ }
  }
  // iOS Safari can't render a canvas.captureStream() source inside a PiP window
  // (it shows black) and throttles canvas compositing in the background — so on
  // iOS we PiP a REAL remote MediaStream (the single active speaker) instead of
  // the 2-up canvas composite. iPhone also drives PiP through the older WebKit
  // presentation-mode API rather than the standard requestPictureInPicture().
  const IS_IOS = (() => {
    try {
      const ua = navigator.userAgent || "";
      return /iP(hone|od|ad)/.test(ua)
        || (/Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1); // iPadOS poses as Mac
    } catch { return false; }
  })();
  type WebkitVideo = HTMLVideoElement & {
    webkitSupportsPresentationMode?: (m: string) => boolean;
    webkitSetPresentationMode?: (m: string) => void;
    webkitPresentationMode?: string;
  };
  function iosPipCapable(): boolean {
    try {
      const v = document.createElement("video") as WebkitVideo;
      return typeof v.webkitSetPresentationMode === "function"
        && (typeof v.webkitSupportsPresentationMode !== "function"
            || v.webkitSupportsPresentationMode("picture-in-picture"));
    } catch { return false; }
  }
  function isInPip(): boolean {
    if ((document as unknown as { pictureInPictureElement?: Element }).pictureInPictureElement) return true;
    const wv = pipVideo as WebkitVideo | null;
    return !!(wv && wv.webkitPresentationMode === "picture-in-picture");
  }
  function pipSupported(): boolean {
    if (typeof document === "undefined") return false;
    // Standard API (Android Chrome / desktop): the 2-up composite needs
    // canvas.captureStream to feed the PiP <video>.
    const std =
      "pictureInPictureEnabled" in document
      && !!(document as unknown as { pictureInPictureEnabled?: boolean }).pictureInPictureEnabled
      && typeof HTMLCanvasElement !== "undefined"
      && typeof (HTMLCanvasElement.prototype as unknown as { captureStream?: unknown }).captureStream === "function";
    // iOS path: real-stream PiP via the WebKit presentation-mode API.
    return std || (IS_IOS && iosPipCapable());
  }
  // Fired when the PiP window closes (standard `leavepictureinpicture` on
  // Android/desktop, or a WebKit presentation-mode change to non-PiP on iOS).
  function onPipLeft() {
    pipActive = false; pipAutoEntered = false;
    // If auto-PiP is still primed, keep the compositor trickling so it can
    // re-engage on the next background; otherwise stop the loop entirely.
    if (pipPrimed) startPipLoop(PIP_PRIME_MS); else stopPipLoop();
    updatePipBtn();
  }
  function ensurePipCompositor() {
    if (pipVideo) return;
    pipVideo = document.createElement("video");
    pipVideo.muted = true; pipVideo.playsInline = true; pipVideo.autoplay = true;
    (pipVideo as unknown as { autoPictureInPicture?: boolean }).autoPictureInPicture = true;
    pipVideo.setAttribute("style", "position:fixed;left:-10000px;top:0;width:2px;height:2px;opacity:0;pointer-events:none");
    if (!IS_IOS) {
      // Android/desktop: composite the top-2 speakers onto a canvas and feed the
      // PiP <video> from canvas.captureStream (gives the 2-up split).
      pipCanvas = document.createElement("canvas");
      pipCanvas.width = 640; pipCanvas.height = 360;
      pipCtx = pipCanvas.getContext("2d");
      const cap = (pipCanvas as unknown as { captureStream?: (fps: number) => MediaStream }).captureStream;
      if (cap) { pipStream = cap.call(pipCanvas, 24); pipVideo.srcObject = pipStream; }
    }
    // On iOS the canvas path renders black in PiP, so pipVideo.srcObject is set
    // to a REAL remote stream (the active speaker) in pipRefreshIosSource().
    document.body.appendChild(pipVideo);
    pipVideo.addEventListener("leavepictureinpicture", onPipLeft);
    pipVideo.addEventListener("webkitpresentationmodechanged", () => {
      const m = (pipVideo as WebkitVideo | null)?.webkitPresentationMode;
      if (m && m !== "picture-in-picture") onPipLeft();
    });
  }
  // The ordered <video> elements to feature: screen share first, then loudest
  // speakers, then DOM order, self last. Returns up to 2 (or up to 4 when
  // `loose`, which also skips the videoWidth>0 gate — used on iOS where a
  // backgrounded tile can report 0 width but still carry a live track).
  function pipSourceVideos(loose = false): HTMLVideoElement[] {
    const ids: string[] = [];
    const push = (id?: string | null) => { if (id && !ids.includes(id) && document.getElementById(id)) ids.push(id); };
    screenShareIds.forEach(push);
    speakerOrder.forEach(push);
    push(activeSpeakerId);
    const grid = $("videoGrid");
    if (grid) Array.from(grid.children).forEach(c => { const id = (c as HTMLElement).id; if (id !== "tile-self") push(id); });
    push("tile-self");
    return ids.slice(0, loose ? 4 : 2)
      .map(id => document.getElementById(id)?.querySelector("video") as HTMLVideoElement | null)
      .filter((v): v is HTMLVideoElement => !!v && (loose || v.videoWidth > 0));
  }
  // iOS: the single best REAL remote stream to show in PiP (screen share >
  // active speaker > first remote tile with a live video track).
  function iosPipStream(): MediaStream | null {
    for (const v of pipSourceVideos(true)) {
      const s = v.srcObject as MediaStream | null;
      if (s && s.getVideoTracks().some(t => t.readyState === "live")) return s;
    }
    return null;
  }
  // iOS: point pipVideo at the current active-speaker stream (called from the
  // render tick + before entering PiP) so the PiP window follows the talker.
  function pipRefreshIosSource() {
    if (!pipVideo) return;
    const stream = iosPipStream();
    if (stream && pipVideo.srcObject !== stream) {
      pipVideo.srcObject = stream;
      pipVideo.play().catch(() => {});
    }
  }
  function pipDrawCover(ctx: CanvasRenderingContext2D, video: HTMLVideoElement, dx: number, dy: number, dw: number, dh: number) {
    const vw = video.videoWidth || 16, vh = video.videoHeight || 9;
    const scale = Math.max(dw / vw, dh / vh);
    const sw = dw / scale, sh = dh / scale;
    const sx = (vw - sw) / 2, sy = (vh - sh) / 2;
    try { ctx.drawImage(video, sx, sy, sw, sh, dx, dy, dw, dh); } catch { /* not ready */ }
  }
  function pipRender() {
    if (!pipActive && !pipPrimed) return;
    if (IS_IOS) { pipRefreshIosSource(); return; } // real-stream path, no canvas
    if (!pipCanvas || !pipCtx) return;
    const W = pipCanvas.width, H = pipCanvas.height;
    pipCtx.fillStyle = "#0b0c10";
    pipCtx.fillRect(0, 0, W, H);
    const vids = pipSourceVideos();
    if (vids.length >= 2) {
      // Side-by-side split of the two active speakers.
      pipDrawCover(pipCtx, vids[0], 0, 0, W / 2 - 1, H);
      pipDrawCover(pipCtx, vids[1], W / 2 + 1, 0, W / 2 - 1, H);
      pipCtx.fillStyle = "rgba(255,255,255,.15)";
      pipCtx.fillRect(W / 2 - 1, 0, 2, H);
    } else if (vids.length === 1) {
      pipDrawCover(pipCtx, vids[0], 0, 0, W, H);
    }
  }
  function startPipLoop(intervalMs: number = PIP_ACTIVE_MS) {
    stopPipLoop();
    // ~12fps composite — plenty for a thumbnail. NOTE: a fully-backgrounded tab
    // throttles setInterval to ~1Hz (and mobile may freeze it), so the composite
    // can stall on its last frame while hidden; the PiP window + AUDIO still keep
    // the call alive, which is the main goal. Works best on Android Chrome/desktop.
    // A slower interval is used while merely PRIMED (foreground) so we don't burn
    // CPU compositing a window nobody's looking at yet.
    pipTimer = setInterval(pipRender, intervalMs);
    pipRender();
  }
  function stopPipLoop() { if (pipTimer) { clearInterval(pipTimer); pipTimer = null; } }
  // The PiP control lights up whenever auto-PiP is ENABLED (the persistent pref),
  // not just while a PiP window happens to be open — so the user can see at a
  // glance that they've turned the "auto" behaviour on.
  function updatePipBtn() {
    const b = $("pipBtn");
    if (!b) return;
    b.style.display = pipSupported() ? "" : "none";
    b.classList.toggle("on", autoPipPref() || pipActive || isInPip());
  }
  // Enter/exit PiP on the right API: iOS uses webkitSetPresentationMode (and a
  // real remote stream, set first); everyone else uses the standard
  // requestPictureInPicture / exitPictureInPicture on the canvas composite.
  async function requestPipEnter() {
    if (!pipVideo) return;
    const v = pipVideo as WebkitVideo & { requestPictureInPicture?: () => Promise<unknown> };
    if (IS_IOS && typeof v.webkitSetPresentationMode === "function") {
      pipRefreshIosSource();
      v.webkitSetPresentationMode("picture-in-picture"); // synchronous; no promise
      return;
    }
    if (typeof v.requestPictureInPicture === "function") await v.requestPictureInPicture();
  }
  async function requestPipExit() {
    const v = pipVideo as WebkitVideo | null;
    if (IS_IOS && v && typeof v.webkitSetPresentationMode === "function") {
      if (v.webkitPresentationMode === "picture-in-picture") v.webkitSetPresentationMode("inline");
      return;
    }
    const d = document as unknown as { pictureInPictureElement?: Element; exitPictureInPicture?: () => Promise<void> };
    if (d.pictureInPictureElement && d.exitPictureInPicture) await d.exitPictureInPicture();
  }
  async function enterPip() {
    if (!pipSupported() || !inCall) { toast("Picture-in-Picture isn't available here.", true); return; }
    ensurePipCompositor();
    pipActive = true;
    startPipLoop();
    // Request PiP SYNCHRONOUSLY within the click's transient activation — don't
    // `await play()` first, or the microtask turn can invalidate the user
    // gesture and PiP intermittently throws NotAllowedError. Kick play() in the
    // background instead.
    const playing = pipVideo!.play().catch(() => {});
    try {
      await requestPipEnter();
      void playing;
      updatePipBtn();
      toast("Picture-in-Picture on");
    } catch {
      pipActive = false;
      if (pipPrimed) startPipLoop(PIP_PRIME_MS); else stopPipLoop();
      updatePipBtn();
      toast("Couldn't start Picture-in-Picture.", true);
    }
  }
  async function exitPip() {
    pipActive = false;
    if (pipPrimed) startPipLoop(PIP_PRIME_MS); else stopPipLoop();
    try { await requestPipExit(); } catch { /* */ }
    updatePipBtn();
  }
  // Keep the off-screen composite PLAYING during the call so the browser can
  // AUTO-enter PiP (via the autoPictureInPicture attribute) the instant the app
  // is backgrounded — no per-call tap. Only primes when the user has enabled the
  // pref once + the call supports PiP.
  function primeAutoPip() {
    if (!autoPipPref() || !pipSupported() || !inCall) return;
    ensurePipCompositor();
    pipPrimed = true;
    if (!pipActive) startPipLoop(PIP_PRIME_MS);
    if (IS_IOS) pipRefreshIosSource(); // give iOS a real stream to auto-PiP
    pipVideo?.play().catch(() => {});
    updatePipBtn();
  }
  function unprimeAutoPip() {
    pipPrimed = false;
    pipAutoEntered = false;
    if (!pipActive) stopPipLoop();
    try { pipVideo?.pause(); } catch { /* */ }
  }
  // Quiet auto-enter used on background (no user gesture, so no toast and a
  // failed requestPictureInPicture() just falls back to the attribute path).
  async function autoEnterPip() {
    if (!pipSupported() || !inCall || isInPip()) return;
    ensurePipCompositor();
    pipActive = true;
    startPipLoop(PIP_ACTIVE_MS);
    const playing = pipVideo!.play().catch(() => {});
    try {
      await requestPipEnter();
      void playing;
    } catch {
      // Background tab has no transient activation; rely on the autoPictureInPicture
      // attribute (Android) / iOS's native auto-PiP to open it. Stay primed so the
      // composite/stream is live for that path.
      pipActive = pipPrimed;
    }
    updatePipBtn();
  }
  // App backgrounded / foregrounded. When auto-PiP is enabled and we're in a
  // call, open a PiP window on hide and close it (if WE opened it) on return.
  function onVisibilityChange() {
    if (typeof document === "undefined") return;
    if (document.hidden) {
      if (!inCall || !autoPipPref() || !pipSupported()) return;
      const wasInPip = isInPip();
      primeAutoPip();
      startPipLoop(PIP_ACTIVE_MS);
      if (!wasInPip) { pipAutoEntered = true; void autoEnterPip(); }
    } else {
      // Foreground again: drop an auto-opened PiP (the full grid is back), but
      // leave a window the user opened by hand. Throttle the primed composite.
      if (pipAutoEntered) { pipAutoEntered = false; void exitPip(); }
      else if (pipPrimed && !pipActive) startPipLoop(PIP_PRIME_MS);
    }
  }
  function togglePip() {
    // The PiP button is the "enable once" switch: ON arms auto-PiP (and opens a
    // window now so the user sees it work); OFF disarms it.
    if (autoPipPref() || pipActive || isInPip()) {
      setAutoPipPref(false);
      unprimeAutoPip();
      void exitPip();
      updatePipBtn();
      toast("Auto Picture-in-Picture off");
    } else {
      setAutoPipPref(true);
      primeAutoPip();
      void enterPip();
    }
  }
  function teardownPip() {
    unprimeAutoPip();
    void exitPip();
    if (pipStream) { try { pipStream.getTracks().forEach(t => t.stop()); } catch { /* */ } pipStream = null; }
    if (pipVideo) { try { pipVideo.srcObject = null; pipVideo.remove(); } catch { /* */ } pipVideo = null; }
    pipCanvas = null; pipCtx = null;
  }

  // ---------- chat (data channels) ----------
  // Dedup guard: on a mesh reconnect (data channel re-open) or an SFU
  // redelivery, the same chat frame can arrive twice. Each frame now carries a
  // unique id; we drop any id we've already rendered (and pre-seed our OWN sent
  // ids so a self-echo on the SFU path is ignored). Bounded so it can't grow
  // without limit across a long call.
  const seenChatIds = new Set<string>();
  function markChatSeen(id: string): boolean {
    if (!id) return true; // legacy frame with no id — always render
    if (seenChatIds.has(id)) return false;
    seenChatIds.add(id);
    if (seenChatIds.size > 500) {
      // drop the oldest ~100 (insertion order) to cap memory
      const it = seenChatIds.values();
      for (let i = 0; i < 100; i++) { const n = it.next(); if (n.done) break; seenChatIds.delete(n.value); }
    }
    return true;
  }
  function newChatId(): string {
    return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  }
  function receiveChatFrame(raw: string) {
    try {
      const d = JSON.parse(raw);
      if (!markChatSeen(d.id)) return; // duplicate — skip
      addChatMsg(d.name, d.text, false);
    } catch { /* */ }
  }
  function setupDC(pin: string, dc: RTCDataChannel) {
    dc.onopen = () => addToRecents(pin, (peers[pin] || { name: "" }).name);
    dc.onmessage = e => receiveChatFrame(e.data as string);
  }
  // Returns the number of peers the message was actually handed to (so the
  // caller can warn the user when a send reached nobody). On the SFU path we
  // can't count subscribers, so a successful publish counts as "delivered".
  function broadcastChat(text: string, id: string): number {
    const p = JSON.stringify({ name: me.name, text, id });
    if (livekitEnabled && lkRoom) {
      // SFU path: there are no per-peer datachannels — fan out over LiveKit data.
      try {
        void lkRoom.localParticipant.publishData(new TextEncoder().encode(p), { reliable: true });
        return 1;
      } catch { return 0; }
    }
    let delivered = 0;
    for (const id2 in peers) {
      const dc = peers[id2].dc;
      if (dc && dc.readyState === "open") {
        try { dc.send(p); delivered++; } catch { /* peer channel wedged — not delivered */ }
      }
    }
    return delivered;
  }
  // Wrap http(s)/www URLs in safe anchors. Input MUST already be HTML-escaped.
  function linkifyEscaped(escaped: string): string {
    return escaped.replace(/((?:https?:\/\/|www\.)[^\s<]+[^\s<.,!?)\]}"'])/gi, (u) => {
      const href = /^www\./i.test(u) ? "https://" + u : u;
      return `<a href="${href}" target="_blank" rel="noopener noreferrer nofollow" style="color:var(--accent2);text-decoration:underline">${u}</a>`;
    });
  }
  function addChatMsg(name: string, text: string, mine: boolean) {
    const log = $("chatLog"); if (!log) return;
    const d = document.createElement("div");
    d.className = "relay-msg " + (mine ? "me" : "them");
    d.innerHTML = (mine ? "" : '<div class="au">' + escapeHtml(name) + "</div>") + linkifyEscaped(escapeHtml(text));
    log.appendChild(d); log.scrollTop = log.scrollHeight;
    if (!mine && !$("chatPanel")?.classList.contains("open")) {
      unread++;
      const b = $("chatBadge");
      if (b) { b.style.display = "grid"; b.textContent = String(unread); }
    }
  }
  function addSysMsg(text: string) {
    const log = $("chatLog"); if (!log) return;
    const d = document.createElement("div");
    d.className = "relay-msg sys"; d.textContent = text;
    log.appendChild(d); log.scrollTop = log.scrollHeight;
  }
  function sendChat() {
    const f = $("chatField") as HTMLInputElement | null;
    if (!f) return;
    const text = f.value.trim();
    if (!text) return;
    const id = newChatId();
    markChatSeen(id); // record our own id so an SFU self-echo is ignored
    addChatMsg(me.name!, text, true);
    const delivered = broadcastChat(text, id);
    f.value = "";
    // If there ARE other people in the call but the frame reached none of them
    // (all data channels wedged/closed on a blip), tell the user instead of
    // silently dropping it — it rendered locally but never left this device.
    if (delivered === 0 && Object.keys(peers).length > 0) {
      toast("Message not delivered — check your connection.", true);
    }
  }

  // ---------- recents ----------
  function addToRecents(id: string, name: string) {
    const ex = recents.find(r => r.id === id);
    if (!ex) { recents.unshift({ id, name: name || id }); renderRecents(); }
    else if (name && ex.name !== name) { ex.name = name; renderRecents(); }
  }
  function renderRecents() {
    const list = $("dirList"); if (!list) return;
    if (!recents.length) {
      list.innerHTML = '<p class="empty-dir">People you call will appear here for quick redial.<br><br>To connect with someone: send them your number, or type theirs on the keypad and hit Call.</p>';
      return;
    }
    list.innerHTML = "";
    recents.forEach(r => {
      const d = document.createElement("div");
      d.className = "relay-usr";
      d.innerHTML = '<div class="av">' + initials(r.name) + '</div><div class="info"><b>' + escapeHtml(r.name) + "</b><span>" + r.id + "</span></div><div class=\"go\">&#8635;</div>";
      d.onclick = () => { dialed = r.id; refreshDisplay(); startCall(); };
      list.appendChild(d);
    });
  }

  // ---------- controls ----------
  function toggleMic() {
    if (!localStream) return;
    setMic(!micOn);
  }
  // Set the camera on/off explicitly (shared by the toggle button and the
  // voice-call start path, which begins with the camera off). The track actually
  // SENT to peers/SFU is the PROCESSED (canvas) track, so toggle THAT to truly
  // stop outgoing video; also toggle the raw input so the physical camera
  // capture/light reflects the off state. Works on BOTH mesh and SFU.
  // Publish/unpublish the camera video track on the SFU to match `enabled` — a
  // disabled MediaStreamTrack still occupies a LiveKit publication (and every
  // subscriber's bandwidth) unless we explicitly unpublish it. No-op on the mesh
  // (which only ever has `enabled` toggling — no separate publish step) and
  // while screen-sharing (that publication is owned by toggleScreenShare).
  async function syncLivekitVideoPublication(enabled: boolean) {
    if (!lkRoom || screenSharing) return;
    try {
      const lp: any = (lkRoom as any).localParticipant;
      const pubs: any[] = typeof lp.getTrackPublications === "function"
        ? lp.getTrackPublications()
        : (lp.videoTrackPublications ? Array.from(lp.videoTrackPublications.values()) : []);
      const videoPubs = pubs.filter((pub: any) => pub?.kind === "video" || pub?.track?.kind === "video");
      if (enabled && videoPubs.length === 0) {
        const track = currentCameraVideoTrack();
        if (track) await lp.publishTrack(track);
      } else if (!enabled && videoPubs.length > 0) {
        for (const pub of videoPubs) {
          const lt = pub?.track;
          if (lt?.mediaStreamTrack) { try { await lp.unpublishTrack(lt.mediaStreamTrack); } catch { /* */ } }
        }
      }
    } catch { /* best-effort — mute/unmute (track.enabled) below already happened */ }
  }
  function setCam(on: boolean) {
    if (!localStream) return;
    camOn = on;
    const published = processedStream || localStream;
    published.getVideoTracks().forEach(t => (t.enabled = camOn));
    if (processedStream) localStream.getVideoTracks().forEach(t => (t.enabled = camOn));
    $("camBtn")?.classList.toggle("off", !camOn);
    // Don't flip the self-tile to audio-only while a screen share occupies it.
    const s = $("tile-self"); if (s && !screenSharing) s.classList.toggle("audio-only", !camOn);
    if (livekitEnabled) {
      // Upgrading voice→video republishes tracks on the SFU, which can recreate
      // the remote audio elements and drop a previously-chosen output (a picked
      // sink, or Android's forced loudspeaker). Re-apply the routing once the
      // publication settles so the call doesn't silently jump back to the
      // earpiece mid-call. Both re-appliers are idempotent/guarded.
      void syncLivekitVideoPublication(camOn).then(() => { if (camOn) reapplyAudioRouting(); });
    } else if (camOn) {
      reapplyAudioRouting();
    }
  }
  // Re-assert the active audio output after a media change. applyAudioSink is a
  // no-op where the browser has no output picker (e.g. Android Chrome);
  // refreshLoudspeakerRouting is a no-op unless the forced-loudspeaker mode is on.
  function reapplyAudioRouting() {
    void applyAudioSink();
    refreshLoudspeakerRouting();
  }
  function toggleCam() {
    if (!localStream) return;
    setCam(!camOn);
  }
  // The camera video track we publish when NOT screen-sharing: the filtered
  // canvas track when a filter is active, else the raw camera.
  function currentCameraVideoTrack(): MediaStreamTrack | null {
    return (processedStream || localStream)?.getVideoTracks()[0] || null;
  }
  let screenBusy = false;
  async function toggleScreenShare() {
    if (screenBusy) return; // ignore double-taps while a transition is in flight
    if (screenSharing) { await stopScreenShare(); return; }
    if (!inCall) { toast("Start a call first.", true); return; }
    const md = navigator.mediaDevices as MediaDevices & {
      getDisplayMedia?: (c?: MediaStreamConstraints) => Promise<MediaStream>;
    };
    if (!md.getDisplayMedia) { toast("Screen sharing isn't supported on this device.", true); return; }
    // Mesh path can only hot-swap into an EXISTING video sender (no
    // renegotiation). An audio-only call (no camera) has none, so screen share
    // would silently reach no one — block it with a clear message. The SFU path
    // publishes a fresh track, so it's fine there.
    if (!livekitEnabled && Object.keys(peers).length > 0) {
      const haveVideoSlot = Object.values(peers).some(p =>
        p.pc.getSenders().some(s => (s.track && s.track.kind === "video") || !s.track));
      if (!haveVideoSlot) {
        toast("Screen sharing needs a camera-enabled call.", true);
        return;
      }
    }
    screenBusy = true;
    let disp: MediaStream;
    try {
      disp = await md.getDisplayMedia({ video: { ...qualityScreenShare(videoQuality) }, audio: false });
    } catch {
      // User cancelled the picker, or permission denied — no-op.
      screenBusy = false;
      return;
    }
    // The call may have ended while the picker was open — don't adopt a capture
    // into a dead call (that would leak the screen grab + wedge state).
    const track = disp.getVideoTracks()[0] || null;
    if (!inCall || !track) {
      disp.getTracks().forEach(t => t.stop());
      screenBusy = false;
      return;
    }
    screenStream = disp;
    screenSharing = true;
    // Browser "Stop sharing" UI (or the source ending) ⇒ restore the camera.
    track.onended = () => { void stopScreenShare(); };
    await replaceVideoEverywhere(track);
    $("screenBtn")?.classList.add("on");
    const selfTile = $("tile-self");
    const selfV = selfTile?.querySelector("video") as HTMLVideoElement | null;
    if (selfV) {
      selfV.srcObject = disp;
      selfV.playsInline = true;
      // MOBILE FIX: the shared screen used to appear only after rotating the
      // device — the tile wasn't re-laid-out once the capture's real dimensions
      // arrived. Re-run layout on the first frame / a size change, and force a
      // post-paint reflow, so it shows immediately.
      // Resume playback AND re-layout once the real frame arrives — the play()
      // is the load-bearing part (a late first frame can leave the element
      // paused on mobile); layoutGrid handles the spotlight sizing.
      const reflow = () => { void selfV.play().catch(() => {}); layoutGrid(); };
      selfV.addEventListener("loadedmetadata", reflow, { once: true });
      selfV.addEventListener("resize", reflow, { once: true });
      try { await selfV.play(); } catch { /* autoplay is fine; muted self tile */ }
    }
    // Screen content must never be mirrored, and isn't "audio-only".
    if (selfTile) { selfTile.classList.add("screen"); selfTile.classList.remove("audio-only"); }
    // Auto-focus our own share in the layout (until someone else's share or a
    // manual pin overrides it).
    screenShareIds.add("tile-self");
    layoutGrid();
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => layoutGrid());
    // Tell everyone we're sharing so they spotlight our tile (works on every
    // browser — viewers don't need to detect the track source themselves).
    sendWS({ type: "screen", action: "on" });
    screenBusy = false;
    toast("Sharing your screen");
  }
  async function stopScreenShare() {
    if (!screenSharing) return;
    screenBusy = true;
    screenSharing = false;
    const dying = screenStream;
    screenStream = null;
    // Swap the live camera/filtered track back in for every peer + the SFU.
    await replaceVideoEverywhere(currentCameraVideoTrack());
    try { dying?.getTracks().forEach(t => { t.onended = null; t.stop(); }); } catch { /* */ }
    $("screenBtn")?.classList.remove("on");
    const selfTile = $("tile-self");
    const selfV = selfTile?.querySelector("video") as HTMLVideoElement | null;
    if (selfV) selfV.srcObject = processedStream || localStream;
    if (selfTile) {
      selfTile.classList.remove("screen");
      selfTile.classList.toggle("audio-only", !camOn);
    }
    screenShareIds.delete("tile-self");
    layoutGrid();
    sendWS({ type: "screen", action: "off" });
    screenBusy = false;
    toast("Stopped screen sharing");
  }
  // ---------- recording (LiveKit Egress → operator S3) ----------
  function updateRecordBtnVisibility() {
    const b = $("recordBtn");
    if (b) b.style.display = recordingAvailable ? "" : "none";
  }
  function updateRecordingUI() {
    $("recordBtn")?.classList.toggle("on", recordingOn);
    const ind = $("recIndicator");
    if (ind) ind.style.display = recordingOn ? "flex" : "none";
  }
  function onRecordingStatus(m: Msg) {
    const was = recordingOn;
    recordingOn = !!m.on;
    updateRecordingUI();
    if (recordingOn && !was) toast("Recording started");
    else if (!recordingOn && was) toast("Recording stopped");
  }
  function toggleRecording() {
    if (!recordingAvailable) { toast("Recording isn't set up on this server.", true); return; }
    if (!inCall) { toast("Start a call first.", true); return; }
    // Optimistic; the server broadcasts the authoritative `recording` status.
    if (recordingOn) sendWS({ type: "stop-recording" });
    else sendWS({ type: "start-recording" });
  }
  function toggleChat() {
    const p = $("chatPanel"); if (!p) return;
    p.classList.toggle("open");
    if (p.classList.contains("open")) {
      unread = 0;
      const b = $("chatBadge"); if (b) b.style.display = "none";
      ($("chatField") as HTMLInputElement | null)?.focus();
    }
  }
  function openAddPad() {
    const a = $("addpad"); if (!a) return;
    a.classList.toggle("open");
    // Deliberately do NOT auto-focus the text field: on mobile that pops the OS
    // keyboard up over the on-screen keypad. The keypad is the primary input.
  }
  function closeAddPad() {
    $("addpad")?.classList.remove("open");
    const inp = $("addInput") as HTMLInputElement | null; if (inp) inp.value = "";
  }
  // On-screen keypad for the add-person window. Build once; each tap appends a
  // digit and the invite fires automatically on the 6th (no "Add" click needed).
  const ADD_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "back"];
  function buildAddPad() {
    const pad = $("addKeys"); if (!pad) return;
    pad.innerHTML = "";
    ADD_KEYS.forEach(k => {
      if (!k) { const s = document.createElement("span"); s.className = "addpad-key spacer"; pad.appendChild(s); return; }
      const b = document.createElement("button");
      b.type = "button";
      b.className = "addpad-key" + (k === "back" ? " back" : "");
      b.textContent = k === "back" ? "⌫" : k;
      if (k === "back") b.setAttribute("aria-label", "Backspace");
      b.onclick = k === "back" ? addBackspace : () => addPushDigit(k);
      pad.appendChild(b);
    });
  }
  function addInputValue(): string {
    const inp = $("addInput") as HTMLInputElement | null;
    return (inp?.value || "").replace(/\D/g, "").slice(0, 6);
  }
  function setAddInput(v: string) {
    const inp = $("addInput") as HTMLInputElement | null; if (inp) inp.value = v;
  }
  function addPushDigit(d: string) {
    const cur = addInputValue();
    if (cur.length >= 6) return;
    const next = cur + d;
    setAddInput(next);
    if (next.length === 6) void addToCall(); // auto-invite on the final digit
  }
  function addBackspace() {
    setAddInput(addInputValue().slice(0, -1));
  }
  // Sanitize typed input (desktop) to digits + auto-invite when complete.
  function onAddInputType() {
    const v = addInputValue();
    setAddInput(v);
    if (v.length === 6) void addToCall();
  }
  let addInviting = false; // re-entry guard (auto-fire + Enter + button can overlap)
  async function addToCall() {
    if (addInviting) return;
    const a = $("addpad");
    if (!a || !a.classList.contains("open")) return; // ignore stray fires once closed
    const pin = addInputValue();
    if (!/^\d{6}$/.test(pin)) { toast("Enter a 6-digit number.", true); return; }
    if (pin === me.pin) { toast("That's your own number.", true); return; }
    const here = livekitEnabled ? !!lkParticipantTiles[pin] : !!peers[pin];
    if (here) { toast("Already in the call.", true); return; }
    // 10-way only on the SFU; the mesh fallback stays capped at 6.
    const cap = livekitEnabled ? 10 : 6;
    const n = livekitEnabled ? Object.keys(lkParticipantTiles).length : Object.keys(peers).length;
    if (n >= cap - 1) { toast(`Call is full (${cap} people max).`, true); return; }
    addInviting = true;
    try { await ensureMedia(); } catch { addInviting = false; return; }
    // Online → the server rings them in; offline/nonexistent → the server replies
    // with an "offline" error and the generic handler toasts
    // "That number doesn't exist or is offline." Either way the pad closes itself.
    // Arm the offline guard so that error doesn't tear down the call we're in.
    addInviteOfflineGuard = true;
    if (addInviteGuardT) clearTimeout(addInviteGuardT);
    addInviteGuardT = setTimeout(() => { addInviteOfflineGuard = false; addInviteGuardT = null; }, 6000);
    sendWS({ type: "invite", to: pin });
    toast("Inviting " + pin + "…");
    closeAddPad();
    addInviting = false;
  }
  function hangUp(reason: string = "manual") {
    sendWS({ type: "leave", reason });
    // The user explicitly ended the call — don't auto-rejoin it on a later reload.
    clearPendingRejoin();
    stopRingtone();
    loudspeakerDisable(); // stop the loudspeaker scan + release the audio context
    if (ringTimeoutT) { clearTimeout(ringTimeoutT); ringTimeoutT = null; }
    pendingRing = null;
    $("ringOverlay")?.classList.remove("active");
    clearConnSeq();
    exitReconnecting();
    establishedOnce = false;
    if (waitingRing) declineWaiting(); // reject any pending second caller
    dropHeld();                        // a full hang-up drops any held call too
    // Disconnect the SFU BEFORE stopping localStream/pipeline below, or LiveKit
    // errors republishing a dead track during teardown. No-op on the mesh path.
    // NOTE: keep `livekitEnabled` (it's a stable server-config flag captured at
    // `registered`); only the room/tiles/token are per-call and get cleared.
    teardownLivekit();
    for (const id in peers) {
      try { peers[id].pc.close(); } catch { /* */ }
      if (peers[id].el) peers[id].el!.remove();
    }
    for (const id in peers) delete peers[id];
    pendingGroupInvites = [];
    for (const k in peerDevices) delete peerDevices[k];
    for (const k in peerFlags) delete peerFlags[k];
    for (const k in peerRoles) delete peerRoles[k];
    lkAudioEls.length = 0;
    myRole = null; roomHostPin = null;
    closeHostPanel(); closeAudioMenu(); closeTileMenu(); updateHostUI();
    unprimeAutoPip(); void exitPip(); // leave PiP + stop priming when the call ends
    stopStatsSampler();
    teardownSpeakerMonitor();
    teardownLocalLevelMonitor();
    resetSpeakerView();
    // Clear leftover tiles so an idle/parked grid doesn't keep dead srcObjects.
    const grid = $("videoGrid"); if (grid) grid.innerHTML = "";
    inCall = false; roomId = null;
    emitPhase("idle");
    if (timerInt) { clearInterval(timerInt); timerInt = null; }
    const log = $("chatLog"); if (log) log.innerHTML = "";
    $("chatPanel")?.classList.remove("open");
    $("filterDock")?.classList.remove("open");
    unread = 0;
    const b = $("chatBadge"); if (b) b.style.display = "none";
    if (screenStream) {
      try { screenStream.getTracks().forEach(t => { t.onended = null; t.stop(); }); } catch { /* */ }
      screenStream = null;
    }
    screenSharing = false;
    screenBusy = false;
    $("screenBtn")?.classList.remove("on");
    // The server stops the egress when the room empties; just reset local UI.
    recordingOn = false;
    updateRecordingUI();
    if (pipeline) { try { pipeline.destroy(); } catch { /* */ } pipeline = null; }
    if (localStream) {
      localStream.getTracks().forEach(t => t.stop());
      localStream = null;
      micOn = true; camOn = true;
      $("micBtn")?.classList.remove("off");
      $("camBtn")?.classList.remove("off");
    }
    processedStream = null;
    show("lobby"); renderRecents();
  }

  // ---------- wire up ----------
  const onJoinClick = () => register();
  const onNameKey = (e: KeyboardEvent) => { if (e.key === "Enter") register(); };
  const onCopyClick = () => {
    if (!me.pin) return;
    navigator.clipboard.writeText(me.pin).then(() => toast("Number copied")).catch(() => toast(me.pin!));
  };
  const onShareClick = () => {
    const u = $("shareUrl")?.textContent || "";
    navigator.clipboard.writeText(u).then(() => toast("Invite link copied")).catch(() => toast(u));
  };
  const onBackKey = () => { dialed = dialed.slice(0, -1); refreshDisplay(); };
  const onChatField = (e: KeyboardEvent) => { if (e.key === "Enter") sendChat(); };
  const onAddInput = (e: KeyboardEvent) => {
    if (e.key === "Enter") addToCall();
    else if (e.key === "Escape") closeAddPad();
  };
  const onDocKey = (e: KeyboardEvent) => {
    // Escape closes the add-person pad first (a dismissible floating panel).
    if (e.key === "Escape" && $("addpad")?.classList.contains("open")) {
      e.preventDefault();
      closeAddPad();
      return;
    }
    // Diagnostics shortcut works on any screen (lower- and upper-case).
    if (e.key === "?" || (e.shiftKey && e.key === "/")) {
      e.preventDefault();
      toggleDiag();
      return;
    }
    if (!$("lobby")?.classList.contains("active")) return;
    if (/^[0-9]$/.test(e.key)) pushDigit(e.key);
    else if (e.key === "Backspace") { dialed = dialed.slice(0, -1); refreshDisplay(); }
    else if (e.key === "Enter" && /^\d{6}$/.test(dialed)) startCall();
  };
  const onUnload = () => {
    // IMPORTANT: a page refresh / tab close must NOT leave an active call — the
    // server keeps the membership (30s grace) so the user AUTO-REJOINS on reload.
    // Only an explicit hang-up (hangBtn → hangUp) or logout (engine destroy) sends
    // a `leave`. A truly-abandoned room is reaped server-side after the grace.
    // Snapshot the call so the fresh page rejoins the SAME room with the SAME
    // mic/cam state (instead of stranding the user idle on the dialer).
    if (inCall && roomId && me.pin) {
      writeSnapshot({ roomId, pin: me.pin, micOn, camOn, ts: Date.now() });
    }
  };

  ($("joinBtn") as HTMLElement | null)?.addEventListener("click", onJoinClick);
  ($("nameInput") as HTMLElement | null)?.addEventListener("keydown", onNameKey as EventListener);
  ($("copyBtn") as HTMLElement | null)?.addEventListener("click", onCopyClick);
  ($("shareUrl") as HTMLElement | null)?.addEventListener("click", onShareClick);
  ($("backKey") as HTMLElement | null)?.addEventListener("click", onBackKey);
  ($("callBtn") as HTMLElement | null)?.addEventListener("click", startCall);
  ($("acceptBtn") as HTMLElement | null)?.addEventListener("click", acceptInvite);
  ($("declineBtn") as HTMLElement | null)?.addEventListener("click", declineInvite);
  ($("cwSwitch") as HTMLElement | null)?.addEventListener("click", switchCall);
  ($("cwDecline") as HTMLElement | null)?.addEventListener("click", declineWaiting);
  ($("heldSwap") as HTMLElement | null)?.addEventListener("click", swapCall);
  ($("heldMerge") as HTMLElement | null)?.addEventListener("click", mergeCall);
  ($("micBtn") as HTMLElement | null)?.addEventListener("click", toggleMic);
  ($("camBtn") as HTMLElement | null)?.addEventListener("click", toggleCam);
  ($("chatBtn") as HTMLElement | null)?.addEventListener("click", toggleChat);
  ($("chatClose") as HTMLElement | null)?.addEventListener("click", toggleChat);
  ($("addBtn") as HTMLElement | null)?.addEventListener("click", openAddPad);
  ($("addGo") as HTMLElement | null)?.addEventListener("click", addToCall);
  ($("addClose") as HTMLElement | null)?.addEventListener("click", closeAddPad);
  buildAddPad();
  ($("addInput") as HTMLInputElement | null)?.addEventListener("input", onAddInputType);
  // Host controls
  ($("hostBtn") as HTMLElement | null)?.addEventListener("click", openHostPanel);
  ($("hostClose") as HTMLElement | null)?.addEventListener("click", closeHostPanel);
  ($("muteAllBtn") as HTMLElement | null)?.addEventListener("click", () => { sendMod("mute-all"); toast("Muted everyone."); });
  ($("unmuteAllBtn") as HTMLElement | null)?.addEventListener("click", () => { sendMod("unmute-all"); toast("Asked everyone to unmute."); });
  ($("gridBtn") as HTMLElement | null)?.addEventListener("click", () => { sendMod("grid"); closeHostPanel(); });
  ($("hostList") as HTMLElement | null)?.addEventListener("click", onHostListClick);
  // Per-tile host menu
  ($("tmClose") as HTMLElement | null)?.addEventListener("click", closeTileMenu);
  ($("tmActs") as HTMLElement | null)?.addEventListener("click", onTileMenuClick);
  // Dismiss the add-person pad on an outside click (capture phase so it runs
  // before the add-button's own toggle; the add button is excluded so toggling
  // still works). This fixes the "can't close the add window during a call" bug.
  const onDocClickAddPad = (e: Event) => {
    const t = e.target as Node | null;
    if (!t) return;
    const outside = (panelId: string, btnId: string) => {
      const p = $(panelId);
      if (!p || !p.classList.contains("open")) return false;
      if (p.contains(t)) return false;
      if (($(btnId) as HTMLElement | null)?.contains(t)) return false;
      return true;
    };
    if (outside("addpad", "addBtn")) closeAddPad();
    if (outside("audioMenu", "audioBtn")) closeAudioMenu();
    // Tile menu closes on any outside click (its ⋮ openers live on tiles).
    const tm = $("tileMenu");
    if (tm && tm.classList.contains("open") && !tm.contains(t) && !(t as HTMLElement)?.closest?.(".tile-menu-btn")) closeTileMenu();
  };
  document.addEventListener("click", onDocClickAddPad, true);
  // The red End button ends THIS line. If a call is on hold, it ends the active
  // line and resumes the held one (phone-style); otherwise it hangs up fully.
  ($("hangBtn") as HTMLElement | null)?.addEventListener("click", () => endActiveLine());
  ($("flipCamBtn") as HTMLElement | null)?.addEventListener("click", () => { flipCamera(); });
  ($("screenBtn") as HTMLElement | null)?.addEventListener("click", () => { void toggleScreenShare(); });
  // Screen share is VISIBLE on every platform during a call (cross-platform
  // parity — it used to vanish on iOS / in-app webviews, which read as a missing
  // feature). Where the browser genuinely can't capture (iOS Safari, some in-app
  // webviews), toggleScreenShare() explains it on tap instead of the control
  // silently disappearing.
  {
    const sb = $("screenBtn") as HTMLElement | null;
    if (sb) sb.style.display = "";
  }
  ($("recordBtn") as HTMLElement | null)?.addEventListener("click", toggleRecording);
  ($("qualityBtn") as HTMLElement | null)?.addEventListener("click", toggleQuality);
  updateQualityBtn();
  // Audio output (speaker / earpiece / headset / Bluetooth).
  ($("audioBtn") as HTMLElement | null)?.addEventListener("click", () => {
    if ($("audioMenu")?.classList.contains("open")) closeAudioMenu();
    else openAudioMenu();
  });
  ($("audioMenu") as HTMLElement | null)?.addEventListener("click", onAudioMenuClick);
  updateAudioBtn();
  // Picture-in-Picture (composited active speakers). The button reflects the
  // persistent auto-PiP pref, so it lights up on load if previously enabled.
  ($("pipBtn") as HTMLElement | null)?.addEventListener("click", togglePip);
  updatePipBtn();
  // Auto-PiP: when enabled, open a PiP window the moment the app is backgrounded
  // mid-call (and close it on return). One listener for the engine's lifetime.
  document.addEventListener("visibilitychange", onVisibilityChange);
  if (typeof navigator !== "undefined" && navigator.mediaDevices?.addEventListener) {
    try { navigator.mediaDevices.addEventListener("devicechange", onAudioDeviceChange); } catch { /* */ }
  }
  ($("filterBtn") as HTMLElement | null)?.addEventListener("click", toggleFilterStrip);
  ($("filterClose") as HTMLElement | null)?.addEventListener("click", toggleFilterStrip);
  ($("chatSend") as HTMLElement | null)?.addEventListener("click", sendChat);
  ($("chatField") as HTMLElement | null)?.addEventListener("keydown", onChatField as EventListener);
  ($("addInput") as HTMLElement | null)?.addEventListener("keydown", onAddInput as EventListener);
  ($("diagBtn") as HTMLElement | null)?.addEventListener("click", toggleDiag);
  ($("diagClose") as HTMLElement | null)?.addEventListener("click", toggleDiag);
  ($("diagCopy") as HTMLElement | null)?.addEventListener("click", () => {
    const box = $("diagBody"); if (!box) return;
    navigator.clipboard.writeText(box.textContent || "").then(() => toast("Diagnostics copied"));
  });
  document.addEventListener("keydown", onDocKey);
  // Click a video tile to spotlight it big (click it again to unpin).
  ($("videoGrid") as HTMLElement | null)?.addEventListener("click", onGridClick);
  // "Minimize" detection: when the call host shrinks to a small floating window
  // we switch to a compact 2-up of the active speakers. A normal phone screen is
  // tall, so we require BOTH dimensions small to avoid triggering on mobile.
  if (typeof ResizeObserver !== "undefined") {
    callResizeObs = new ResizeObserver(entries => {
      // Only react during a call — when idle the engine host is parked at ~1px
      // off-screen, which would otherwise read as "minimized" and churn layout.
      if (!inCall) return;
      const r = entries[0]?.contentRect; if (!r) return;
      const next = r.width < 500 && r.height < 420;
      if (next !== compactView) { compactView = next; layoutGrid(); }
    });
    try { callResizeObs.observe(root); } catch { /* */ }
  }
  window.addEventListener("beforeunload", onUnload);
  // Local network loss (Wi-Fi drop, tunnel, airplane toggle) is the clearest
  // "you're disconnected" signal. On the MESH path we own recovery, so show the
  // reconnect window and, when the radio returns, re-open signaling + kick ICE
  // restarts. On the SFU path LiveKit detects and drives this itself (its
  // Reconnecting/Reconnected events), so we stay out of its way.
  const onOffline = () => {
    if (inCall && establishedOnce && !livekitEnabled) enterReconnecting();
  };
  const onOnline = () => {
    if (!inCall || livekitEnabled) return;
    if (!ws || ws.readyState !== 1 /* EventSource.OPEN */) {
      try { ws?.close(); } catch { /* */ }
      if (!destroyed) connectWS();
    }
    Object.keys(peers).forEach(pin => { try { void tryIceRestart(pin); } catch { /* */ } });
  };
  window.addEventListener("offline", onOffline);
  window.addEventListener("online", onOnline);

  // ---------- boot ----------
  // Pending auto-rejoin? (set by onUnload before a mid-call reload.) If a fresh
  // snapshot exists, register under the IN-CALL pin so the server's room lookup
  // matches, and arm a watchdog: if no `rejoin` arrives within 10s the call must
  // have ended during the refresh — clear it and stay idle (the one valid
  // exception to auto-rejoin).
  pendingRejoin = readSnapshot(Date.now());
  if (pendingRejoin) {
    me.pin = pendingRejoin.pin;
    rejoinWatchT = setTimeout(() => { clearPendingRejoin(); }, 10_000);
  }
  $("boot")?.classList.add("hidden");
  connectWS();
  ($("nameInput") as HTMLInputElement | null)?.focus();

  return {
    dial(target: string, opts?: { voice?: boolean }): boolean {
      // returns true synchronously if validation passes; the actual call is async,
      // but the host UI just needs to know whether to flip to in-call mode.
      if (!/^\d{6}$/.test(target)) return false;
      if (!me.pin) return false;
      if (target === me.pin) return false;
      // fire-and-forget the actual async call
      void programmaticDial(target, opts);
      return true;
    },
    dialGroup(targets: string[], opts?: { voice?: boolean }): boolean {
      if (!me.pin) return false;
      const valid = targets.filter(t => /^\d{6}$/.test(String(t)) && t !== me.pin);
      if (valid.length === 0) return false;
      void programmaticGroupDial(targets, opts);
      return true;
    },
    setOnStateChange(cb) { onPhaseChange = cb; },
    getPin() { return me.pin; },
    setPreferredPin(pin) {
      const next = pin && /^\d{6}$/.test(pin) ? pin : null;
      preferredPin = next;
      // Reconcile to the AUTHORITATIVE identity number. If we already registered
      // under a DIFFERENT pin — e.g. a stale localStorage `relay_pin` reused
      // before the identity number had loaded, or a number that only arrived
      // after the first register — switch to it now so the dialer's big number,
      // the header number, and the actually-dialable signaling pin are ONE
      // number (otherwise the user sees two numbers and the displayed one can't
      // be reached). The server treats a new pin from the same cid as an identity
      // switch (drops the old, takes the new). NEVER switch mid-call: an identity
      // switch tears down room membership.
      // NEVER switch the pin while an auto-rejoin is pending — the server's room
      // lookup is keyed by the in-call pin, so changing it would break the rejoin.
      if (next && me.pin && next !== me.pin && !inCall && !pendingRejoin && ws && ws.readyState === 1) {
        me.pin = next;
        try { window.localStorage.setItem("relay_pin", next); } catch { /* */ }
        sendWS({ type: "register", name: me.name || wantName || "Guest", pin: next, device: detectDeviceType(), flag: selfFlag || undefined });
      }
    },
    setSelfFlag(flag) {
      const f = (flag || "").slice(0, 8);
      if (f === selfFlag) return;
      selfFlag = f;
      // If already registered, re-affirm so the server stores it (and future
      // member lists carry it). Also update our own self tile live.
      if (me.pin && ws && ws.readyState === 1) {
        sendWS({ type: "register", name: me.name || "Guest", pin: me.pin, device: detectDeviceType(), flag: selfFlag || undefined });
      }
      setTileFlag("tile-self", selfFlag);
    },
    setOnPinChange(cb) {
      onPinChange = cb;
      // Fire immediately with the current value so a late subscriber syncs up.
      if (cb) { try { cb(me.pin); } catch { /* */ } }
    },
    setOnRejoinChange(cb) {
      onRejoinChange = cb;
      // Fire immediately so a subscriber that mounts AFTER boot still learns a
      // rejoin is already in flight (boot reads the snapshot synchronously).
      if (cb) { try { cb(!!pendingRejoin); } catch { /* */ } }
    },
    cancelRejoin() {
      // Leave the room if we already managed to rejoin, then drop the snapshot so
      // the next reload won't auto-rejoin again.
      try { ($("hangBtn") as HTMLButtonElement | null)?.click(); } catch { /* */ }
      clearPendingRejoin();
    },
    hangup() {
      try { ($("hangBtn") as HTMLButtonElement | null)?.click(); }
      catch { /* swallow — engine handles its own cleanup */ }
    },
    destroy() {
      destroyed = true;
      // Logout / engine teardown → don't carry a pending auto-rejoin into the
      // next session, and release the loudspeaker context.
      if (rejoinWatchT) { clearTimeout(rejoinWatchT); rejoinWatchT = null; }
      try { loudspeakerDisable(); loudspeakerCtx?.close?.(); } catch { /* */ }
      if (reconnectT) { clearTimeout(reconnectT); reconnectT = null; }
      if (timerInt) { clearInterval(timerInt); timerInt = null; }
      if (ringTimeoutT) { clearTimeout(ringTimeoutT); ringTimeoutT = null; }
      if (waitingTimeoutT) { clearTimeout(waitingTimeoutT); waitingTimeoutT = null; }
      waitingRing = null;
      clearConnSeq();
      exitReconnecting();
      // Disconnect the SFU before stopping local tracks (no-op on the mesh path).
      teardownLivekit();
      try { ws?.close(); } catch { /* */ }
      ws = null;
      // close peer connections (active + any held call)
      for (const id in peers) {
        try { peers[id].pc.close(); } catch { /* */ }
      }
      for (const id in heldPeers) {
        try { heldPeers[id].pc.close(); } catch { /* */ }
        delete heldPeers[id];
      }
      heldRoomId = null;
      try { cueCtx?.close?.(); cueCtx = null; } catch { /* */ }
      stopRingtone();
      try { ringtoneCtx?.close?.(); ringtoneCtx = null; } catch { /* */ }
      if (screenStream) {
        try { screenStream.getTracks().forEach(t => { t.onended = null; t.stop(); }); } catch { /* */ }
        screenStream = null;
      }
      screenSharing = false;
      screenBusy = false;
      if (localStream) {
        localStream.getTracks().forEach(t => t.stop());
        localStream = null;
      }
      teardownSpeakerMonitor();
      teardownLocalLevelMonitor();
      stopStatsSampler();
      teardownPip();
      if (callResizeObs) { try { callResizeObs.disconnect(); } catch { /* */ } callResizeObs = null; }
      document.removeEventListener("click", onDocClickAddPad, true);
      if (typeof navigator !== "undefined" && navigator.mediaDevices?.removeEventListener) {
        try { navigator.mediaDevices.removeEventListener("devicechange", onAudioDeviceChange); } catch { /* */ }
      }
      document.removeEventListener("keydown", onDocKey);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("beforeunload", onUnload);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
      // best-effort: tell server we're leaving
      try {
        const body = JSON.stringify({ cid, message: { type: "leave", reason: "page-unload-2" } });
        if (navigator.sendBeacon) {
          navigator.sendBeacon("/api/relay/send", new Blob([body], { type: "application/json" }));
        }
      } catch { /* */ }
    },
  };
}
