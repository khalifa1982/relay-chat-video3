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
import { isDndOn } from "@/app/dnd";

interface IceConfig { iceServers: Array<{ urls: string; username?: string; credential?: string }>; }
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
}
interface PendingRing { from: string; fromName: string; roomId: string; }
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
  let iceConfig: IceConfig = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };
  let localStream: MediaStream | null = null;        // RAW camera stream (input)
  let processedStream: MediaStream | null = null;    // post-pipeline stream (sent to peers)
  let pipeline: MediaPipeline | null = null;
  let facingMode: "user" | "environment" = "user";
  let activeFilter: FilterId = "none";
  let micOn = true, camOn = true;
  let screenStream: MediaStream | null = null;       // active getDisplayMedia stream, or null
  let screenSharing = false;
  let recordingAvailable = false; // server advertised egress+S3 are configured
  let recordingOn = false;        // a recording is in progress for this room
  let inCall = false;
  let roomId: string | null = null;
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
      case "signal":       onSignal(m.from!, m.data); break;
      case "ice":          onIceServers(m); break;
      case "error":
        toast(m.message || "Something went wrong.", true);
        if ((m.code === "offline" || m.code === "self" || m.code === "gone")
            && inCall && aloneInCall()) hangUp("server-error:" + (m.code || "?"));
        break;
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
    //   1. preferredPin — the stable identity number from the host. This is
    //      what unifies the big number with the profile number.
    //   2. savedPin — a number we were previously issued (reload continuity).
    // The server still has final say (it rejects a pin already taken by
    // someone else) and reports the authoritative value back via onRegistered.
    if (preferredPin && /^\d{6}$/.test(preferredPin)) me.pin = preferredPin;
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
    if (m.iceServers && m.iceServers.length) iceConfig = { iceServers: m.iceServers };
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
  async function acquireRawStream(useFacingMode: "user" | "environment"): Promise<MediaStream> {
    return navigator.mediaDevices.getUserMedia({
      audio: true,
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
    const scrTrack = screenStream?.getVideoTracks()[0];
    if (scrTrack) { try { await scrTrack.applyConstraints(ac); } catch { /* */ } }
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
    b.style.display = audioOutSupported ? "" : "none";
    // Highlight only when a real NON-default output is active.
    b.classList.toggle("on", !!audioSinkId);
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
  function openAudioMenu() {
    if (!audioOutSupported) {
      toast("This browser routes call audio automatically (try your device's audio settings).", true);
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
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
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
  async function flipCamera() {
    if (!localStream) { toast("Camera isn't active yet.", true); return; }
    if (screenSharing) { toast("Stop screen sharing to flip the camera.", true); return; }
    const next: "user" | "environment" = facingMode === "user" ? "environment" : "user";
    let nuVideo: MediaStream;
    try {
      nuVideo = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { ...qualityVideo(videoQuality), facingMode: next },
      });
    } catch {
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
    // Update the local self-tile's video (if shown)
    const selfV = $("tile-self")?.querySelector("video") as HTMLVideoElement | null;
    if (selfV) selfV.srcObject = processedStream || nu;
    // back camera shouldn't be mirrored on self preview
    const selfTile = $("tile-self");
    if (selfTile) selfTile.classList.toggle("back-cam", facingMode === "environment");
    toast(facingMode === "environment" ? "Switched to back camera" : "Switched to front camera");
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
    if (!inCall) { inCall = true; enterCallUI("Calling…"); emitPhase("dialing"); }
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
    if (!inCall) { inCall = true; enterCallUI(opts?.voice ? "Voice call…" : "Calling…"); emitPhase("dialing"); }
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
  function showCallWaiting(name: string) {
    const cw = $("callWaiting"); if (!cw) return;
    const n = $("cwName"); if (n) n.textContent = name || "Someone";
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
  function switchCall() {
    const w = waitingRing; waitingRing = null;
    hideCallWaiting();
    if (!w) return;
    // Leave the current room but KEEP media + the call UI (no idle flash), then
    // accept the waiting call, reusing the same camera/mic stream.
    sendWS({ type: "leave", reason: "switch-call" });
    for (const id in peers) { try { peers[id].pc.close(); } catch { /* */ } if (peers[id].el) peers[id].el!.remove(); delete peers[id]; }
    teardownLivekit();
    roomId = w.roomId;
    enterCallUI("Connecting…");
    sendWS({ type: "accept", roomId: w.roomId });
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
      waitingRing = { from: m.from!, fromName: m.fromName!, roomId: m.roomId! };
      showCallWaiting(m.fromName || nameOf(m.from!));
      return;
    }
    if (pendingRing) { sendWS({ type: "reject", to: m.from }); return; }
    pendingRing = { from: m.from!, fromName: m.fromName!, roomId: m.roomId! };
    const ringAv = $("ringAv"); if (ringAv) ringAv.textContent = initials(m.fromName!);
    const ringWho = $("ringWho"); if (ringWho) ringWho.textContent = m.fromName!;
    const ringSub = $("ringSub"); if (ringSub) ringSub.textContent = "is calling you…";
    $("ringOverlay")?.classList.add("active");
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
    if (!r) { emitPhase("idle"); return; }
    try { await ensureMedia(); } catch { sendWS({ type: "reject", to: r.from }); emitPhase("idle"); return; }
    inCall = true; roomId = r.roomId; enterCallUI("In call");
    sendWS({ type: "accept", roomId: r.roomId });
  }
  function declineInvite() {
    const r = pendingRing; pendingRing = null;
    if (ringTimeoutT) { clearTimeout(ringTimeoutT); ringTimeoutT = null; }
    $("ringOverlay")?.classList.remove("active");
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
    toast("Caller cancelled the call");
    emitPhase("idle");
  }

  // ---------- mesh / SFU ----------
  function onJoined(m: Msg) {
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
      iceConfig = { iceServers: m.iceServers };
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
    try {
      await ensureMedia();
    } catch {
      // Couldn't re-acquire camera/mic on this fresh page (permission revoked or
      // device busy). We can't rejoin — explicitly leave so the server drops our
      // membership instead of keeping us as a phantom "connected" member that
      // holds the room open.
      sendWS({ type: "leave", reason: "rejoin-no-media" });
      return;
    }
    roomId = rid;
    inCall = true;
    enterCallUI("In call");          // shows the call screen + arms the SFU watchdog
    recordMemberDevices(m.members);
    recordMemberRoles(m.members);
    captureSelfRole(m);
    toast("Rejoined the call");
    if (livekitEnabled) {
      diag("rejoin: livekit room " + rid);
      // The server pushed a fresh token right after this message; onLivekitToken
      // will joinLivekit. If it already arrived (race), join now.
      if (lkPendingToken && lkPendingToken.roomId === rid && !lkRoom) void joinLivekit(rid);
      return;
    }
    // Mesh: re-offer to each existing member (glare-free — we're the newcomer).
    if (m.iceServers && m.iceServers.length) iceConfig = { iceServers: m.iceServers };
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
      iceConfig = { iceServers: m.iceServers };
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
      try { const d = JSON.parse(new TextDecoder().decode(payload)); addChatMsg(d.name, d.text, false); } catch { /* */ }
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
        for (const t of send.getVideoTracks()) await room.localParticipant.publishTrack(t);
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
  // Placeholder (avatar + full name, shown when the camera is off) + an info
  // chip (device + live speed) used by every tile builder.
  function tileContentHTML(name: string, device: string, flag: string): string {
    const dev = device
      ? '<span class="ti-dev">' + escapeHtml(device) + "</span>"
      : '<span class="ti-dev"></span>';
    const fl = '<span class="nm-flag">' + (flag ? escapeHtml(flag) : "") + "</span>";
    return (
      '<div class="ph"><div class="av">' + initials(name) + "</div>" +
      '<div class="ph-name">' + fl + escapeHtml(name) + "</div></div>" +
      '<div class="nm">' + fl + escapeHtml(name) + "</div>" +
      '<div class="tile-info">' + dev + '<span class="ti-speed"></span></div>'
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
  }
  function onForceMute(m: Msg) {
    if (m.on) { setMic(false); toast("You were muted by the host."); }
    else { setMic(true); toast("The host unmuted you."); }
  }
  function onRoleChange(m: Msg) {
    const pin = m.pin || "";
    if (!pin) return;
    const role = (m.role as string | null) ?? null;
    if (role) peerRoles[pin] = role; else delete peerRoles[pin];
    setTileRole(pin === me.pin ? "tile-self" : "tile-" + pin, role);
    if (pin === me.pin) { myRole = role; updateHostUI(); toast(role === "cohost" ? "You're now a co-host." : "You're no longer a co-host."); }
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
    t.insertAdjacentHTML("beforeend", tileContentHTML(name, peerDevices[id] || "", peerFlags[id] || ""));
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
  function createPeer(pin: string, name: string, initiator: boolean): PeerEntry {
    if (peers[pin]) return peers[pin];
    const pc = new RTCPeerConnection(iceConfig);
    const peer: PeerEntry = { pc, name: name || "Guest", dc: null, el: null, candQ: [], remoteSet: false, gotStream: false, initiator, graceT: null, restartT: null, iceRestarts: 0 };
    peers[pin] = peer;
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
    iceConfig = { iceServers: m.iceServers };
    diag("ice servers refreshed (" + m.iceServers.length + ")");
    Object.values(peers).forEach(p => {
      try { p.pc.setConfiguration(iceConfig as RTCConfiguration); } catch { /* */ }
    });
  }
  function removePeer(pin: string, quiet = false) {
    const e = peers[pin];
    if (!e) return;
    const nm = e.name;
    if (e.graceT) { clearTimeout(e.graceT); e.graceT = null; }
    if (e.restartT) { clearTimeout(e.restartT); e.restartT = null; }
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
    peer.restartT = setTimeout(() => {
      peer.restartT = null;
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
  function markEstablished() {
    establishedOnce = true;
    exitReconnecting();
    clearConnSeq();
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
        '<div class="ph-name">' + selfFl + "You</div></div>" +
        '<div class="nm">' + selfFl + "You</div>" +
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
    t.insertAdjacentHTML("beforeend", tileContentHTML(name, peerDevices[id] || "", peerFlags[id] || ""));
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
    const v = entry.el.querySelector("video") as HTMLVideoElement | null;
    if (v) { v.srcObject = stream; void applyAudioSink(v); }
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

  // ---------- Picture-in-Picture (composited active speakers) ----------
  // Minimizing a mobile browser pauses the call; PiP keeps it alive + visible.
  // We composite the top-2 active speakers onto a canvas, capture that canvas as
  // a stream, and PiP the resulting video — so a single PiP window shows a 2-up
  // split that follows whoever's talking (and a shared screen).
  let pipCanvas: HTMLCanvasElement | null = null;
  let pipCtx: CanvasRenderingContext2D | null = null;
  let pipVideo: HTMLVideoElement | null = null;
  let pipActive = false;
  let pipTimer: ReturnType<typeof setInterval> | null = null;
  function pipSupported(): boolean {
    return typeof document !== "undefined" &&
      "pictureInPictureEnabled" in document &&
      !!(document as unknown as { pictureInPictureEnabled?: boolean }).pictureInPictureEnabled;
  }
  function ensurePipCompositor() {
    if (pipCanvas) return;
    pipCanvas = document.createElement("canvas");
    pipCanvas.width = 640; pipCanvas.height = 360;
    pipCtx = pipCanvas.getContext("2d");
    pipVideo = document.createElement("video");
    pipVideo.muted = true; pipVideo.playsInline = true; pipVideo.autoplay = true;
    (pipVideo as unknown as { autoPictureInPicture?: boolean }).autoPictureInPicture = true;
    pipVideo.setAttribute("style", "position:fixed;left:-10000px;top:0;width:2px;height:2px;opacity:0;pointer-events:none");
    const cap = (pipCanvas as unknown as { captureStream?: (fps: number) => MediaStream }).captureStream;
    if (cap) pipVideo.srcObject = cap.call(pipCanvas, 24);
    document.body.appendChild(pipVideo);
    pipVideo.addEventListener("leavepictureinpicture", () => { pipActive = false; stopPipLoop(); updatePipBtn(false); });
  }
  // The ordered <video> elements to feature: screen share first, then loudest
  // speakers, then DOM order, self last. Returns up to 2.
  function pipSourceVideos(): HTMLVideoElement[] {
    const ids: string[] = [];
    const push = (id?: string | null) => { if (id && !ids.includes(id) && document.getElementById(id)) ids.push(id); };
    screenShareIds.forEach(push);
    speakerOrder.forEach(push);
    push(activeSpeakerId);
    const grid = $("videoGrid");
    if (grid) Array.from(grid.children).forEach(c => { const id = (c as HTMLElement).id; if (id !== "tile-self") push(id); });
    push("tile-self");
    return ids.slice(0, 2)
      .map(id => document.getElementById(id)?.querySelector("video") as HTMLVideoElement | null)
      .filter((v): v is HTMLVideoElement => !!v && v.videoWidth > 0);
  }
  function pipDrawCover(ctx: CanvasRenderingContext2D, video: HTMLVideoElement, dx: number, dy: number, dw: number, dh: number) {
    const vw = video.videoWidth || 16, vh = video.videoHeight || 9;
    const scale = Math.max(dw / vw, dh / vh);
    const sw = dw / scale, sh = dh / scale;
    const sx = (vw - sw) / 2, sy = (vh - sh) / 2;
    try { ctx.drawImage(video, sx, sy, sw, sh, dx, dy, dw, dh); } catch { /* not ready */ }
  }
  function pipRender() {
    if (!pipActive || !pipCanvas || !pipCtx) return;
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
  function startPipLoop() {
    stopPipLoop();
    // ~12fps composite — plenty for a thumbnail, and keeps the captured stream
    // (and thus the PiP window) updating while the page is backgrounded.
    pipTimer = setInterval(pipRender, 80);
    pipRender();
  }
  function stopPipLoop() { if (pipTimer) { clearInterval(pipTimer); pipTimer = null; } }
  function updatePipBtn(on: boolean) {
    const b = $("pipBtn");
    if (!b) return;
    b.style.display = pipSupported() ? "" : "none";
    b.classList.toggle("on", on);
  }
  async function enterPip() {
    if (!pipSupported() || !inCall) { toast("Picture-in-Picture isn't available here.", true); return; }
    ensurePipCompositor();
    pipActive = true;
    startPipLoop();
    try { await pipVideo!.play(); } catch { /* */ }
    try {
      await (pipVideo as unknown as { requestPictureInPicture: () => Promise<unknown> }).requestPictureInPicture();
      updatePipBtn(true);
      toast("Picture-in-Picture on");
    } catch {
      pipActive = false; stopPipLoop(); updatePipBtn(false);
      toast("Couldn't start Picture-in-Picture.", true);
    }
  }
  async function exitPip() {
    pipActive = false; stopPipLoop();
    try {
      const d = document as unknown as { pictureInPictureElement?: Element; exitPictureInPicture?: () => Promise<void> };
      if (d.pictureInPictureElement && d.exitPictureInPicture) await d.exitPictureInPicture();
    } catch { /* */ }
    updatePipBtn(false);
  }
  function togglePip() {
    const inPip = !!(document as unknown as { pictureInPictureElement?: Element }).pictureInPictureElement;
    if (pipActive || inPip) void exitPip(); else void enterPip();
  }
  function teardownPip() {
    void exitPip();
    if (pipVideo) { try { pipVideo.srcObject = null; pipVideo.remove(); } catch { /* */ } pipVideo = null; }
    pipCanvas = null; pipCtx = null;
  }

  // ---------- chat (data channels) ----------
  function setupDC(pin: string, dc: RTCDataChannel) {
    dc.onopen = () => addToRecents(pin, (peers[pin] || { name: "" }).name);
    dc.onmessage = e => {
      try { const d = JSON.parse(e.data); addChatMsg(d.name, d.text, false); } catch { /* */ }
    };
  }
  function broadcastChat(text: string) {
    const p = JSON.stringify({ name: me.name, text });
    if (livekitEnabled && lkRoom) {
      // SFU path: there are no per-peer datachannels — fan out over LiveKit data.
      try { void lkRoom.localParticipant.publishData(new TextEncoder().encode(p), { reliable: true }); } catch { /* */ }
      return;
    }
    for (const id in peers) {
      const dc = peers[id].dc;
      if (dc && dc.readyState === "open") {
        try { dc.send(p); } catch { /* */ }
      }
    }
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
    addChatMsg(me.name!, text, true);
    broadcastChat(text);
    f.value = "";
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
  function setCam(on: boolean) {
    if (!localStream) return;
    camOn = on;
    const published = processedStream || localStream;
    published.getVideoTracks().forEach(t => (t.enabled = camOn));
    if (processedStream) localStream.getVideoTracks().forEach(t => (t.enabled = camOn));
    $("camBtn")?.classList.toggle("off", !camOn);
    // Don't flip the self-tile to audio-only while a screen share occupies it.
    const s = $("tile-self"); if (s && !screenSharing) s.classList.toggle("audio-only", !camOn);
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
      disp = await md.getDisplayMedia({ video: { ...qualityVideo(videoQuality) }, audio: false });
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
    if (a.classList.contains("open")) ($("addInput") as HTMLInputElement | null)?.focus();
  }
  function closeAddPad() {
    $("addpad")?.classList.remove("open");
    const inp = $("addInput") as HTMLInputElement | null; if (inp) inp.value = "";
  }
  async function addToCall() {
    const inp = $("addInput") as HTMLInputElement | null;
    const pin = (inp?.value || "").trim();
    if (!/^\d{6}$/.test(pin)) { toast("Enter a 6-digit number.", true); return; }
    const here = pin === me.pin || (livekitEnabled ? !!lkParticipantTiles[pin] : !!peers[pin]);
    if (here) { toast("Already in the call.", true); return; }
    // 10-way only on the SFU; the mesh fallback stays capped at 6.
    const cap = livekitEnabled ? 10 : 6;
    const n = livekitEnabled ? Object.keys(lkParticipantTiles).length : Object.keys(peers).length;
    if (n >= cap - 1) { toast(`Call is full (${cap} people max).`, true); return; }
    try { await ensureMedia(); } catch { return; }
    sendWS({ type: "invite", to: pin });
    toast("Inviting " + pin + "…");
    closeAddPad();
  }
  function hangUp(reason: string = "manual") {
    sendWS({ type: "leave", reason });
    if (ringTimeoutT) { clearTimeout(ringTimeoutT); ringTimeoutT = null; }
    pendingRing = null;
    $("ringOverlay")?.classList.remove("active");
    clearConnSeq();
    exitReconnecting();
    establishedOnce = false;
    if (waitingRing) declineWaiting(); // reject any pending second caller
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
    closeHostPanel(); closeAudioMenu(); updateHostUI();
    void exitPip(); // leave PiP when the call ends
    stopStatsSampler();
    teardownSpeakerMonitor();
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
    // server keeps the membership so the user AUTO-REJOINS on reload. Only an
    // explicit hang-up (hangBtn → hangUp) or logout (engine destroy) sends a
    // `leave`. A truly-abandoned room is reaped server-side after a few minutes.
    // (Kept as a no-op hook so the beforeunload listener wiring is unchanged.)
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
  ($("micBtn") as HTMLElement | null)?.addEventListener("click", toggleMic);
  ($("camBtn") as HTMLElement | null)?.addEventListener("click", toggleCam);
  ($("chatBtn") as HTMLElement | null)?.addEventListener("click", toggleChat);
  ($("chatClose") as HTMLElement | null)?.addEventListener("click", toggleChat);
  ($("addBtn") as HTMLElement | null)?.addEventListener("click", openAddPad);
  ($("addGo") as HTMLElement | null)?.addEventListener("click", addToCall);
  ($("addClose") as HTMLElement | null)?.addEventListener("click", closeAddPad);
  // Host controls
  ($("hostBtn") as HTMLElement | null)?.addEventListener("click", openHostPanel);
  ($("hostClose") as HTMLElement | null)?.addEventListener("click", closeHostPanel);
  ($("muteAllBtn") as HTMLElement | null)?.addEventListener("click", () => { sendMod("mute-all"); toast("Muted everyone."); });
  ($("unmuteAllBtn") as HTMLElement | null)?.addEventListener("click", () => { sendMod("unmute-all"); toast("Asked everyone to unmute."); });
  ($("gridBtn") as HTMLElement | null)?.addEventListener("click", () => { sendMod("grid"); closeHostPanel(); });
  ($("hostList") as HTMLElement | null)?.addEventListener("click", onHostListClick);
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
  };
  document.addEventListener("click", onDocClickAddPad, true);
  ($("hangBtn") as HTMLElement | null)?.addEventListener("click", () => hangUp("user-hangup"));
  ($("flipCamBtn") as HTMLElement | null)?.addEventListener("click", () => { flipCamera(); });
  ($("screenBtn") as HTMLElement | null)?.addEventListener("click", () => { void toggleScreenShare(); });
  // Reveal the screen-share button only where getDisplayMedia actually exists
  // (Android Chrome, desktop, iPad — yes; iOS Safari phone — no). Pure client
  // capability check; mirrors the record-button visibility pattern.
  {
    const sb = $("screenBtn") as HTMLElement | null;
    const md = navigator.mediaDevices as (MediaDevices & { getDisplayMedia?: unknown }) | undefined;
    if (sb) sb.style.display = md && typeof md.getDisplayMedia === "function" ? "" : "none";
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
  // Picture-in-Picture (composited active speakers).
  ($("pipBtn") as HTMLElement | null)?.addEventListener("click", togglePip);
  updatePipBtn(false);
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
      preferredPin = pin && /^\d{6}$/.test(pin) ? pin : null;
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
    hangup() {
      try { ($("hangBtn") as HTMLButtonElement | null)?.click(); }
      catch { /* swallow — engine handles its own cleanup */ }
    },
    destroy() {
      destroyed = true;
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
      // close peer connections
      for (const id in peers) {
        try { peers[id].pc.close(); } catch { /* */ }
      }
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
      stopStatsSampler();
      teardownPip();
      if (callResizeObs) { try { callResizeObs.disconnect(); } catch { /* */ } callResizeObs = null; }
      document.removeEventListener("click", onDocClickAddPad, true);
      if (typeof navigator !== "undefined" && navigator.mediaDevices?.removeEventListener) {
        try { navigator.mediaDevices.removeEventListener("devicechange", onAudioDeviceChange); } catch { /* */ }
      }
      document.removeEventListener("keydown", onDocKey);
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
