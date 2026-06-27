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
  from?: string;
  fromName?: string;
  to?: string;
  roomId?: string;
  members?: Array<{ pin: string; name: string }>;
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
}

export type RelayPhase = "idle" | "dialing" | "ringing" | "in-call";

export interface RelayHandle {
  destroy: () => void;
  /** Programmatic dial. Returns true if the engine accepted the request. */
  dial: (number: string) => boolean;
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
  let inCall = false;
  let roomId: string | null = null;
  const peers: Record<string, PeerEntry> = {};
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
        if (wantName) sendWS({ type: "register", name: wantName, pin: me.pin || undefined });
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
    switch (m.type) {
      case "registered":   onRegistered(m); break;
      case "room":         roomId = m.roomId || null; break;
      case "ring":         onRing(m); break;
      case "ring-cancel":  onRingCancel(m); break;
      case "joined":       onJoined(m); break;
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
    if (ws && ws.readyState === 1) sendWS({ type: "register", name, pin: me.pin || undefined });
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
  async function acquireRawStream(useFacingMode: "user" | "environment"): Promise<MediaStream> {
    return navigator.mediaDevices.getUserMedia({
      audio: true,
      video: {
        width: { ideal: isMobile ? 960 : 1280 },
        height: { ideal: isMobile ? 540 : 720 },
        frameRate: { ideal: 30, max: 30 },
        facingMode: useFacingMode,
      },
    });
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
        video: {
          width: { ideal: isMobile ? 960 : 1280 },
          height: { ideal: isMobile ? 540 : 720 },
          frameRate: { ideal: 30, max: 30 },
          facingMode: next,
        },
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
  async function programmaticDial(target: string): Promise<boolean> {
    if (!/^\d{6}$/.test(target)) return false;
    if (!me.pin) return false; // not registered yet — caller should retry
    if (target === me.pin) { toast("That's your own number.", true); return false; }
    if (peers[target]) { toast("You're already connected to them.", true); return false; }
    try { await ensureMedia(); } catch { return false; }
    if (!inCall) { inCall = true; enterCallUI("Calling…"); emitPhase("dialing"); }
    sendWS({ type: "invite", to: target });
    toast("Calling " + target + "…");
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
  function onPeerJoined(m: Msg) {
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

    room.on(RoomEventEnum.TrackSubscribed, (track, _pub, participant) => {
      addLkTile(participant.identity, participant.name || participant.identity);
      const el = lkParticipantTiles[participant.identity];
      if (!el) return;
      if (track.kind === TrackEnum.Kind.Video) {
        track.attach(el.querySelector("video") as HTMLVideoElement);
        bindLkPlaceholder(el, true);
      } else if (track.kind === TrackEnum.Kind.Audio) {
        track.attach(); // detached <audio> element for playback
        bindLkPlaceholder(el, false); // audio-only: clear "connecting…", keep avatar
      }
    });
    room.on(RoomEventEnum.TrackUnsubscribed, (track, _pub, participant) => {
      try { track.detach(); } catch { /* */ }
      const el = lkParticipantTiles[participant.identity];
      if (el && track.kind === TrackEnum.Kind.Video) bindLkPlaceholder(el, false);
    });
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
  function addLkTile(id: string, name: string) {
    if (lkParticipantTiles[id]) return;
    const grid = $("videoGrid"); if (!grid) return;
    const t = document.createElement("div");
    t.className = "relay-tile"; t.id = "tile-" + id;
    const v = document.createElement("video");
    v.autoplay = true; v.playsInline = true;
    t.appendChild(v);
    t.insertAdjacentHTML("beforeend", '<div class="ph"><div class="av">' + initials(name) + "</div></div>");
    t.insertAdjacentHTML("beforeend", '<div class="nm">' + escapeHtml(name) + "</div>");
    t.insertAdjacentHTML("beforeend", '<div class="connecting">connecting…</div>');
    lkParticipantTiles[id] = t;
    grid.appendChild(t);
    layoutGrid();
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
  function removePeer(pin: string) {
    const e = peers[pin];
    if (!e) return;
    const nm = e.name;
    if (e.graceT) { clearTimeout(e.graceT); e.graceT = null; }
    if (e.restartT) { clearTimeout(e.restartT); e.restartT = null; }
    try { e.pc.close(); } catch { /* */ }
    if (e.el) e.el.remove();
    delete peers[pin];
    layoutGrid();
    if (inCall) addSysMsg((nm || "Someone") + " left the call.");
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
    t.insertAdjacentHTML("beforeend", '<div class="nm">You</div>');
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
    t.insertAdjacentHTML("beforeend", '<div class="ph"><div class="av">' + initials(name) + "</div></div>");
    t.insertAdjacentHTML("beforeend", '<div class="nm">' + escapeHtml(name) + "</div>");
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
    if (v) v.srcObject = stream;
    const c = entry.el.querySelector(".connecting") as HTMLElement | null;
    if (c) c.style.display = "none";
    const sync = () => {
      const has = stream.getVideoTracks().some(tr => tr.enabled && tr.readyState === "live");
      const ph = entry.el!.querySelector(".ph") as HTMLElement | null;
      if (ph) ph.style.display = has ? "none" : "flex";
    };
    sync();
    stream.getVideoTracks().forEach(tr => { tr.onmute = sync; tr.onunmute = sync; tr.onended = sync; });
  }
  function layoutGrid() {
    const g = $("videoGrid"); if (!g) return;
    const n = g.children.length;
    let cols = 1; if (n > 1) cols = 2; if (n > 4) cols = 3;
    g.style.gridTemplateColumns = "repeat(" + cols + ",1fr)";
    g.style.gridTemplateRows = "repeat(" + Math.ceil(n / cols) + ",minmax(0,1fr))";
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
    micOn = !micOn;
    localStream.getAudioTracks().forEach(t => t.enabled = micOn);
    $("micBtn")?.classList.toggle("off", !micOn);
  }
  function toggleCam() {
    if (!localStream) return;
    camOn = !camOn;
    // The track actually SENT to peers/SFU is the PROCESSED (canvas) track, so
    // toggle THAT to truly stop outgoing video. Toggling only the raw input (the
    // old behavior) just starves the canvas and keeps forwarding a frozen frame.
    // This fixes camera-off on BOTH the mesh and the SFU. Also toggle the raw
    // input so the physical camera capture/light reflects the off state.
    const published = processedStream || localStream;
    published.getVideoTracks().forEach(t => (t.enabled = camOn));
    if (processedStream) localStream.getVideoTracks().forEach(t => (t.enabled = camOn));
    $("camBtn")?.classList.toggle("off", !camOn);
    // Don't flip the self-tile to audio-only while a screen share occupies it.
    const s = $("tile-self"); if (s && !screenSharing) s.classList.toggle("audio-only", !camOn);
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
      disp = await md.getDisplayMedia({ video: true, audio: false });
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
    if (selfV) selfV.srcObject = disp;
    // Screen content must never be mirrored, and isn't "audio-only".
    if (selfTile) { selfTile.classList.add("screen"); selfTile.classList.remove("audio-only"); }
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
    screenBusy = false;
    toast("Stopped screen sharing");
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
  const onAddInput = (e: KeyboardEvent) => { if (e.key === "Enter") addToCall(); };
  const onDocKey = (e: KeyboardEvent) => {
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
    try {
      const body = JSON.stringify({ cid, message: { type: "leave", reason: "page-unload" } });
      if (navigator.sendBeacon) {
        navigator.sendBeacon("/api/relay/send", new Blob([body], { type: "application/json" }));
      } else {
        sendWS({ type: "leave", reason: "page-unload" });
      }
    } catch { /* */ }
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
  ($("hangBtn") as HTMLElement | null)?.addEventListener("click", () => hangUp("user-hangup"));
  ($("flipCamBtn") as HTMLElement | null)?.addEventListener("click", () => { flipCamera(); });
  ($("screenBtn") as HTMLElement | null)?.addEventListener("click", () => { void toggleScreenShare(); });
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
    dial(target: string): boolean {
      // returns true synchronously if validation passes; the actual call is async,
      // but the host UI just needs to know whether to flip to in-call mode.
      if (!/^\d{6}$/.test(target)) return false;
      if (!me.pin) return false;
      if (target === me.pin) return false;
      // fire-and-forget the actual async call
      void programmaticDial(target);
      return true;
    },
    setOnStateChange(cb) { onPhaseChange = cb; },
    getPin() { return me.pin; },
    setPreferredPin(pin) {
      preferredPin = pin && /^\d{6}$/.test(pin) ? pin : null;
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
