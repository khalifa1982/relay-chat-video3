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

interface IceConfig { iceServers: Array<{ urls: string; username?: string; credential?: string }>; }
interface PeerEntry {
  pc: RTCPeerConnection;
  name: string;
  dc: RTCDataChannel | null;
  el: HTMLElement | null;
  candQ: RTCIceCandidateInit[];
  remoteSet: boolean;
  gotStream: boolean;
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
}

export interface RelayHandle {
  destroy: () => void;
}

export function startRelay(root: HTMLElement): RelayHandle {
  const $ = (id: string): HTMLElement | null => root.querySelector("#" + id);

  // ---------- state ----------
  let ws: EventSource | null = null;
  let reconnectT: ReturnType<typeof setTimeout> | null = null;
  let registeredOnce = false;
  const cid = (() => {
    try {
      const a = new Uint8Array(16);
      (window.crypto || (window as any).msCrypto).getRandomValues(a);
      return Array.from(a).map(b => ("0" + b.toString(16)).slice(-2)).join("");
    } catch {
      return String(Date.now()) + Math.random().toString(16).slice(2);
    }
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
  let inCall = false;
  let roomId: string | null = null;
  const peers: Record<string, PeerEntry> = {};
  let pendingRing: PendingRing | null = null;
  const recents: Recent[] = [];
  let callStart = 0;
  let timerInt: ReturnType<typeof setInterval> | null = null;
  let unread = 0;
  let dialed = "";
  let wantName: string | null = null;
  let toastT: ReturnType<typeof setTimeout> | null = null;
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

  // ---------- protocol ----------
  function handle(m: Msg) {
    switch (m.type) {
      case "registered":   onRegistered(m); break;
      case "room":         roomId = m.roomId || null; break;
      case "ring":         onRing(m); break;
      case "joined":       onJoined(m); break;
      case "peer-joined":  onPeerJoined(m); break;
      case "rejected":
        toast(nameOf(m.from!) + " declined.");
        if (inCall && Object.keys(peers).length === 0) hangUp();
        break;
      case "busy":
        toast("They're on another call.", true);
        if (inCall && Object.keys(peers).length === 0) hangUp();
        break;
      case "peer-left":    removePeer(m.pin!); break;
      case "signal":       onSignal(m.from!, m.data); break;
      case "error":
        toast(m.message || "Something went wrong.", true);
        if ((m.code === "offline" || m.code === "self" || m.code === "gone")
            && inCall && Object.keys(peers).length === 0) hangUp();
        break;
    }
  }

  // ---------- registration ----------
  function register() {
    const input = $("nameInput") as HTMLInputElement | null;
    const name = (input?.value || "").trim();
    if (!name) { toast("Enter a display name first.", true); return; }
    me.name = name; wantName = name;
    const btn = $("joinBtn") as HTMLButtonElement | null;
    if (btn) { btn.disabled = true; btn.textContent = "Connecting…"; }
    if (ws && ws.readyState === 1) sendWS({ type: "register", name });
    else connectWS();
  }
  function onRegistered(m: Msg) {
    me.pin = String(m.pin);
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
  async function acquireRawStream(useFacingMode: "user" | "environment"): Promise<MediaStream> {
    return navigator.mediaDevices.getUserMedia({
      audio: true,
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        facingMode: useFacingMode,
      },
    });
  }
  async function ensureMedia(): Promise<MediaStream> {
    if (processedStream) return processedStream;
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
    if (localStream && localStream.getVideoTracks().length > 0) {
      // Route through the canvas pipeline so filters / blur / overlays apply.
      pipeline = new MediaPipeline({
        onError: m => toast(m, true),
        onLoading: l => {
          const dot = $("filterLoading");
          if (dot) dot.style.display = l ? "inline-block" : "none";
        },
      });
      pipeline.setFacingMode(facingMode);
      await pipeline.setInputStream(localStream);
      processedStream = pipeline.getOutputStream();
    } else {
      // Audio-only fallback
      processedStream = localStream;
    }
    return processedStream || localStream!;
  }

  /** Swap the camera between front and back. Re-acquires getUserMedia with
   *  the opposite facingMode and hot-replaces the video track on every peer
   *  via RTCRtpSender.replaceTrack — no re-negotiation needed. */
  async function flipCamera() {
    if (!localStream) { toast("Camera isn't active yet.", true); return; }
    const next: "user" | "environment" = facingMode === "user" ? "environment" : "user";
    let nu: MediaStream;
    try {
      nu = await acquireRawStream(next);
    } catch {
      toast("Couldn't switch camera — this device may only have one.", true);
      return;
    }
    facingMode = next;
    // Stop old VIDEO tracks (keep audio tracks running to avoid mic glitches)
    if (localStream) {
      localStream.getVideoTracks().forEach(t => t.stop());
    }
    if (pipeline) {
      pipeline.setFacingMode(facingMode);
      await pipeline.setInputStream(nu);
    }
    localStream = nu;
    // Update the local self-tile's video (if shown)
    const selfV = $("tile-self")?.querySelector("video") as HTMLVideoElement | null;
    if (selfV) selfV.srcObject = processedStream || nu;
    // back camera shouldn't be mirrored on self preview
    const selfTile = $("tile-self");
    if (selfTile) selfTile.classList.toggle("back-cam", facingMode === "environment");
    toast(facingMode === "environment" ? "Switched to back camera" : "Switched to front camera");
  }

  /** Apply a filter; lazy-loads MediaPipe models if needed. */
  async function applyFilter(id: FilterId) {
    if (!pipeline) {
      // Filter chosen before camera started — remember and apply on ensureMedia
      activeFilter = id;
      updateFilterStripUI();
      return;
    }
    activeFilter = id;
    await pipeline.setFilter(id);
    updateFilterStripUI();
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
    if (!inCall) { inCall = true; enterCallUI("Calling…"); }
    sendWS({ type: "invite", to: target });
    toast("Calling " + target + "…");
  }

  // ---------- incoming ----------
  function onRing(m: Msg) {
    if (inCall) { if (m.roomId === roomId) return; sendWS({ type: "reject", to: m.from }); return; }
    if (pendingRing) { sendWS({ type: "reject", to: m.from }); return; }
    pendingRing = { from: m.from!, fromName: m.fromName!, roomId: m.roomId! };
    const ringAv = $("ringAv"); if (ringAv) ringAv.textContent = initials(m.fromName!);
    const ringWho = $("ringWho"); if (ringWho) ringWho.textContent = m.fromName!;
    const ringSub = $("ringSub"); if (ringSub) ringSub.textContent = "is calling you…";
    $("ringOverlay")?.classList.add("active");
  }
  async function acceptInvite() {
    const r = pendingRing; pendingRing = null;
    $("ringOverlay")?.classList.remove("active");
    if (!r) return;
    try { await ensureMedia(); } catch { sendWS({ type: "reject", to: r.from }); return; }
    inCall = true; roomId = r.roomId; enterCallUI("In call");
    sendWS({ type: "accept", roomId: r.roomId });
  }
  function declineInvite() {
    const r = pendingRing; pendingRing = null;
    $("ringOverlay")?.classList.remove("active");
    if (r) sendWS({ type: "reject", to: r.from });
  }

  // ---------- mesh ----------
  function onJoined(m: Msg) {
    roomId = m.roomId || null;
    (m.members || []).forEach(mem => callPeer(mem.pin, mem.name));
  }
  function onPeerJoined(m: Msg) {
    if (peers[m.pin!]) return;
    createPeer(m.pin!, m.name || "Guest", false);
  }
  function createPeer(pin: string, name: string, initiator: boolean): PeerEntry {
    if (peers[pin]) return peers[pin];
    const pc = new RTCPeerConnection(iceConfig);
    const peer: PeerEntry = { pc, name: name || "Guest", dc: null, el: null, candQ: [], remoteSet: false, gotStream: false };
    peers[pin] = peer;
    // We send the PROCESSED stream to peers (so they see filters), but if
    // there's no pipeline (audio-only) fall back to the raw stream.
    const sendStream = processedStream || localStream;
    if (sendStream) sendStream.getTracks().forEach(t => pc.addTrack(t, sendStream));
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
      if (st === "failed" || st === "closed") {
        // Don't blow away on transient failures from the offerer side; the
        // remote may still come up. Only tear down if we *never* connected.
        if (!peer.gotStream) removePeer(pin);
      }
    };
    pc.oniceconnectionstatechange = () => {
      diag("ice " + pin.slice(-4) + " " + pc.iceConnectionState);
      // On 'failed' or 'disconnected', try an ICE restart from whichever side
      // is the offerer. This rescues calls where a NAT mapping died mid-call.
      if (pc.iceConnectionState === "failed" && initiator && peer.gotStream === false) {
        diag("ice restart " + pin.slice(-4));
        tryIceRestart(pin).catch(() => { /* */ });
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
  function removePeer(pin: string) {
    const e = peers[pin];
    if (!e) return;
    const nm = e.name;
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
  async function tryIceRestart(pin: string) {
    const peer = peers[pin];
    if (!peer) return;
    try {
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
  function enterCallUI(label: string) {
    show("call");
    const lbl = $("callRoomLbl"); if (lbl) lbl.textContent = label || "In call";
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
    for (const id in peers) {
      const dc = peers[id].dc;
      if (dc && dc.readyState === "open") {
        try { dc.send(p); } catch { /* */ }
      }
    }
  }
  function addChatMsg(name: string, text: string, mine: boolean) {
    const log = $("chatLog"); if (!log) return;
    const d = document.createElement("div");
    d.className = "relay-msg " + (mine ? "me" : "them");
    d.innerHTML = (mine ? "" : '<div class="au">' + escapeHtml(name) + "</div>") + escapeHtml(text);
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
    localStream.getVideoTracks().forEach(t => t.enabled = camOn);
    $("camBtn")?.classList.toggle("off", !camOn);
    const s = $("tile-self"); if (s) s.classList.toggle("audio-only", !camOn);
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
    if (pin === me.pin || peers[pin]) { toast("Already in the call.", true); return; }
    if (Object.keys(peers).length >= 5) { toast("Call is full (6 people max).", true); return; }
    try { await ensureMedia(); } catch { return; }
    sendWS({ type: "invite", to: pin });
    toast("Inviting " + pin + "…");
    closeAddPad();
  }
  function hangUp() {
    sendWS({ type: "leave" });
    for (const id in peers) {
      try { peers[id].pc.close(); } catch { /* */ }
      if (peers[id].el) peers[id].el!.remove();
    }
    for (const id in peers) delete peers[id];
    inCall = false; roomId = null;
    if (timerInt) { clearInterval(timerInt); timerInt = null; }
    const log = $("chatLog"); if (log) log.innerHTML = "";
    $("chatPanel")?.classList.remove("open");
    $("filterDock")?.classList.remove("open");
    unread = 0;
    const b = $("chatBadge"); if (b) b.style.display = "none";
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
      const body = JSON.stringify({ cid, message: { type: "leave" } });
      if (navigator.sendBeacon) {
        navigator.sendBeacon("/api/relay/send", new Blob([body], { type: "application/json" }));
      } else {
        sendWS({ type: "leave" });
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
  ($("micBtn") as HTMLElement | null)?.addEventListener("click", toggleMic);
  ($("camBtn") as HTMLElement | null)?.addEventListener("click", toggleCam);
  ($("chatBtn") as HTMLElement | null)?.addEventListener("click", toggleChat);
  ($("chatClose") as HTMLElement | null)?.addEventListener("click", toggleChat);
  ($("addBtn") as HTMLElement | null)?.addEventListener("click", openAddPad);
  ($("addGo") as HTMLElement | null)?.addEventListener("click", addToCall);
  ($("hangBtn") as HTMLElement | null)?.addEventListener("click", hangUp);
  ($("flipCamBtn") as HTMLElement | null)?.addEventListener("click", () => { flipCamera(); });
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

  // ---------- boot ----------
  $("boot")?.classList.add("hidden");
  connectWS();
  ($("nameInput") as HTMLInputElement | null)?.focus();

  return {
    destroy() {
      destroyed = true;
      if (reconnectT) { clearTimeout(reconnectT); reconnectT = null; }
      if (timerInt) { clearInterval(timerInt); timerInt = null; }
      try { ws?.close(); } catch { /* */ }
      ws = null;
      // close peer connections
      for (const id in peers) {
        try { peers[id].pc.close(); } catch { /* */ }
      }
      if (localStream) {
        localStream.getTracks().forEach(t => t.stop());
        localStream = null;
      }
      document.removeEventListener("keydown", onDocKey);
      window.removeEventListener("beforeunload", onUnload);
      // best-effort: tell server we're leaving
      try {
        const body = JSON.stringify({ cid, message: { type: "leave" } });
        if (navigator.sendBeacon) {
          navigator.sendBeacon("/api/relay/send", new Blob([body], { type: "application/json" }));
        }
      } catch { /* */ }
    },
  };
}
