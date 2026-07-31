/**
 * The RELAY call engine, ported from the web (client/src/lib/relayClient.ts)
 * with the protocol semantics that took v2.74–v2.84 to harden:
 *  - staged progress: calling → ringing / "reaching their phone…" (paging) →
 *    connecting → live; 65s no-answer backstop
 *  - stale-ring replace rules (same-caller / expired rings never blind-reject)
 *  - voice-first + MUTUAL-CONSENT video (video-request / accept / decline;
 *    both cameras turn on together), 1:1 auto-end on remote-left
 *  - mesh (newcomer offers, candidate queue, renegotiation) via the shared
 *    @livekit/react-native-webrtc stack — the WebRTC BINDING, not an SFU client.
 *
 *  THE HOSTED SFU WAS DELETED IN v2.106.54 (account cancelled) — no Room, no
 *  token, no watchdog; every call is the mesh. TWO PACKAGES DELIBERATELY STAY,
 *  and they are NOT the SFU client:
 *    - @livekit/react-native-webrtc IS the WebRTC binding (RTCPeerConnection,
 *      MediaStream, mediaDevices, RTCView). The mesh is built on it.
 *    - @livekit/react-native is the ANDROID INITIALISER. Its
 *      `LiveKitReactNative.setup()` (MainApplication.kt) configures
 *      `WebRTCModuleOptions` for the binding above: hardware acoustic echo
 *      cancellation and noise suppression, the video encoder/decoder factories,
 *      and `enableMediaProjectionService` — WITHOUT WHICH SCREEN SHARE SENDS
 *      BLACK FRAMES. Removing it costs mesh call audio quality and screen share,
 *      so it is a mesh dependency wearing a confusing name. Only its JS
 *      `AudioSession` export was SFU-only, and those calls are gone.
 *  - native audio routing: earpiece/speaker via react-native-incall-manager,
 *    speaker DEFAULT ON on phones (v2.84 parity)
 * M3.5 adds: CALL WAITING (a second ring mid-call → decline / END current &
 * answer — the answer is deliberately destructive, no hold UI yet; an awaited
 * retried `leave` strictly precedes the `accept`, killing the v2.50 switch
 * race), GROUP CALLS (dialGroup + in-call add-person; groups bypass video
 * consent and never auto-end at 0 remotes), REJOIN-AFTER-RESTART (AsyncStorage
 * snapshot → register under the snapshot pin → the server's rejoin offer is
 * accepted instead of declined), and `peer-hold` (a held call shows "On hold"
 * instead of auto-ending — a hold FREEZES media and keeps the peer connection).
 * M5 added screen share (mesh getDisplayMedia + a replaceTrack hot-swap) and PiP.
 * Still deferred: hold/swap/merge UI, filters.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState, Vibration } from "react-native";
import {
  MediaStream, RTCIceCandidate, RTCPeerConnection, RTCSessionDescription, mediaDevices,
} from "@livekit/react-native-webrtc";
import InCallManager from "react-native-incall-manager";
import { RelaySignaling, type IceServer, type Msg } from "./signaling";
import {
  clearRejoinSnapshot, readRejoinSnapshot, saveRejoinSnapshot, type RejoinSnapshot,
} from "./rejoinSnapshot";
import { api as serverApi, type Whoami } from "../lib/api";
import {
  nativeCancelRing, nativeEnsureNotificationPermission, nativeGetPushToken,
  nativeSetPipEligible, nativeStartCallService, nativeStopCallService,
} from "../lib/native";

export type CallStatus = "calling" | "ringing" | "paging" | "connecting" | "live";
export type CallPhase = "idle" | "incoming" | "dialing" | "in-call";

export interface RemoteTile {
  key: string;            // the peer's 6-digit pin
  name: string;
  /** Remote media for RTCView — the peer's mesh stream. Audio is ROUTED by
   *  InCallManager (earpiece/speaker), never carried by this element. */
  stream: MediaStream | null;
  hasVideo: boolean;
}

export interface IncomingRing {
  from: string;
  fromName: string;
  roomId: string;
  video: boolean;
  at: number;
}

interface EngineState {
  phase: CallPhase;
  status: CallStatus;
  peerName: string;
  peerPin: string;
  isVideoCall: boolean;
  incoming: IncomingRing | null;
  /** Call waiting: a second caller ringing while we're in a call (M3.5). */
  waiting: IncomingRing | null;
  videoAsk: string | null; // peer name asking to start video
  tiles: RemoteTile[];
  localStream: MediaStream | null;
  micOn: boolean;
  camOn: boolean;
  speakerOn: boolean;
  /** The peer answered THEIR call waiting — we're parked ("On hold"). */
  onHold: boolean;
  isGroup: boolean;
  /** Reconnecting to a live call after an app restart (rejoin). */
  rejoining: boolean;
  /** Transient toast surfaced by the engine (add-person feedback, "full"…). */
  notice: string | null;
  // ── M5 ──
  /* NO RECORDING FIELD. Call recording was the hosted SFU's egress service in
     its entirety and went with the cancelled account (v2.106.53/54); the server
     no longer sends the flag or the broadcast, so a Record control here would be
     one that silently does nothing. */
  /** I'm sharing my screen. */
  sharingScreen: boolean;
  /** Pin of a REMOTE participant sharing their screen ("" = none). */
  peerScreenPin: string;
}

interface EngineApi extends EngineState {
  ready: boolean;
  dial: (number: string, opts?: { voice?: boolean; displayName?: string }) => void;
  dialGroup: (numbers: string[], opts?: { voice?: boolean }) => void;
  addToCall: (number: string) => void;
  acceptIncoming: (opts?: { voice?: boolean }) => void;
  declineIncoming: () => void;
  acceptWaiting: () => void;   // END the current call & answer the waiter
  declineWaiting: () => void;
  hangup: () => void;
  toggleMic: () => void;
  toggleCam: () => void;
  flipCam: () => void;
  toggleSpeaker: () => void;
  answerVideoAsk: (yes: boolean) => void;
  toggleScreenShare: () => void;
}

const CallContext = createContext<EngineApi | null>(null);
export function useCall(): EngineApi {
  const v = useContext(CallContext);
  if (!v) throw new Error("useCall outside CallProvider");
  return v;
}

interface Peer {
  pc: RTCPeerConnection;
  stream: MediaStream;
  name: string;
  pendingCandidates: unknown[];
  hasRemoteDesc: boolean;
  initiator: boolean;
}

export function CallProvider({ me, children }: { me: Whoami; children: React.ReactNode }) {
  const [state, setState] = useState<EngineState>({
    phase: "idle", status: "calling", peerName: "", peerPin: "", isVideoCall: false,
    incoming: null, waiting: null, videoAsk: null, tiles: [], localStream: null,
    micOn: true, camOn: false, speakerOn: true,
    onHold: false, isGroup: false, rejoining: false, notice: null,
    sharingScreen: false, peerScreenPin: "",
  });
  const [ready, setReady] = useState(false);
  const st = useRef(state);
  st.current = state;
  const patch = (p: Partial<EngineState>) => setState(s => ({ ...s, ...p }));

  // ── mutable engine internals (never re-render on their own) ──
  const sig = useRef<RelaySignaling | null>(null);
  const roomId = useRef<string | null>(null);
  const peers = useRef<Map<string, Peer>>(new Map());
  const iceServers = useRef<IceServer[]>([]);
  const localStream = useRef<MediaStream | null>(null);
  const videoApproved = useRef(false);
  const callAnswered = useRef(false);
  const established = useRef(false);
  const dialTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const failT = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ringTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inCall = useRef(false);
  // ── M3.5 internals ──
  const callIsGroup = useRef(false);
  const heldByPeer = useRef(false);
  const waitingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingGroupInvites = useRef<string[]>([]);
  /** While > Date.now(), an add-person `error{code:"offline"}` is non-fatal. */
  const addInviteGuardUntil = useRef(0);
  const pendingRejoin = useRef<RejoinSnapshot | null>(null);
  const rejoinWatchdog = useRef<ReturnType<typeof setTimeout> | null>(null);
  const snapRefresh = useRef<ReturnType<typeof setInterval> | null>(null);
  const noticeT = useRef<ReturnType<typeof setTimeout> | null>(null);
  // M5: the active screen-capture stream (mesh path), busy re-entry guard.
  const screenStream = useRef<MediaStream | null>(null);
  const screenBusy = useRef(false);

  const clearTimer = (r: React.MutableRefObject<ReturnType<typeof setTimeout> | null>) => {
    if (r.current) { clearTimeout(r.current); r.current = null; }
  };

  /** Web parity (v2.80): teardown gates fire only when NO remote is attached —
   *  a group member's decline must never kill a conference with live peers. */
  const aloneInCall = () => peers.current.size === 0;

  const showNotice = (text: string) => {
    if (noticeT.current) clearTimeout(noticeT.current);
    patch({ notice: text });
    noticeT.current = setTimeout(() => { noticeT.current = null; patch({ notice: null }); }, 3000);
  };

  const markGroup = () => {
    if (callIsGroup.current) return;
    callIsGroup.current = true;
    patch({ isGroup: true });
  };

  // ── rejoin snapshot (M3.5): fresh while established, gone otherwise ──
  const writeSnap = () => {
    const pin = sig.current?.pin;
    const rid = roomId.current;
    if (!established.current || !pin || !rid) return;
    void saveRejoinSnapshot({
      roomId: rid, pin,
      micOn: st.current.micOn, camOn: st.current.camOn, speakerOn: st.current.speakerOn,
      isVideoCall: st.current.isVideoCall, isGroup: callIsGroup.current,
      peerName: st.current.peerName, peerPin: st.current.peerPin, ts: Date.now(),
    });
  };
  const stopSnapRefresh = () => {
    if (snapRefresh.current) { clearInterval(snapRefresh.current); snapRefresh.current = null; }
  };

  const publishTiles = () => {
    const tiles: RemoteTile[] = [];
    peers.current.forEach((p, pin) => {
      const vts = p.stream.getVideoTracks() as unknown as Array<{ muted?: boolean; enabled?: boolean }>;
      tiles.push({
        key: pin, name: p.name, stream: p.stream,
        hasVideo: vts.some(t => !t.muted && t.enabled !== false),
      });
    });
    patch({ tiles });
  };

  const markEstablished = useCallback(() => {
    if (established.current) return;
    established.current = true;
    clearTimer(dialTimeout);
    clearTimer(rejoinWatchdog);
    pendingRejoin.current = null;
    patch({ status: "live", phase: "in-call", rejoining: false });
    // Native call audio: communication mode + speaker default ON (v2.84).
    InCallManager.start({ media: st.current.isVideoCall ? "video" : "audio" });
    InCallManager.setSpeakerphoneOn(st.current.speakerOn);
    // M4: ongoing-call foreground service — Android must never freeze a
    // backgrounded live call (stopped in hangupInternal).
    nativeStartCallService(st.current.peerName || undefined);
    // M5: leaving the app mid-call now enters Picture-in-Picture.
    nativeSetPipEligible(true);
    // M3.5: keep a fresh rejoin snapshot while the call lives (RN has no
    // pagehide — a process kill gives no callback, so we refresh on a timer).
    writeSnap();
    stopSnapRefresh();
    snapRefresh.current = setInterval(writeSnap, 10_000);
  }, []);

  // ── media ──
  const ensureMedia = async (withVideo: boolean): Promise<MediaStream> => {
    const cur = localStream.current;
    if (cur && (!withVideo || cur.getVideoTracks().length > 0)) return cur;
    const gotNew = await mediaDevices.getUserMedia({
      audio: true,
      video: withVideo ? { facingMode: "user" } : false,
    });
    if (cur) {
      // Upgrading to video: keep the live mic, adopt the new camera track.
      const vt = gotNew.getVideoTracks()[0];
      if (vt) cur.addTrack(vt);
      gotNew.getAudioTracks().forEach(t => t.stop());
      localStream.current = cur;
    } else {
      localStream.current = gotNew;
    }
    patch({ localStream: localStream.current });
    return localStream.current!;
  };

  // ── mesh ──
  const createPeer = (pin: string, name: string, initiator: boolean) => {
    if (peers.current.has(pin)) return peers.current.get(pin)!;
    // A 2nd mesh peer means this is a conference (web parity: consent bypass
    // + no auto-end at 0 remotes both key off this).
    if (peers.current.size >= 1) markGroup();
    const pc = new RTCPeerConnection({ iceServers: iceServers.current as never });
    const stream = new MediaStream(undefined as never);
    const peer: Peer = { pc, stream, name, pendingCandidates: [], hasRemoteDesc: false, initiator };
    peers.current.set(pin, peer);
    const ls = localStream.current;
    // Mid-share joiners must receive the SCREEN, not the parked camera —
    // the web fixed this exact bug class (a fresh group member saw black).
    const screenVt = st.current.sharingScreen ? screenStream.current?.getVideoTracks()[0] : null;
    if (ls) {
      ls.getAudioTracks().forEach(t => pc.addTrack(t, ls));
      const vt = screenVt ?? ls.getVideoTracks()[0];
      if (vt) pc.addTrack(vt as never, ls as never);
    }
    // v2.80 m-line discipline: a camera-less INITIATOR still negotiates a
    // sendrecv video m-line, so a later consent upgrade needs only
    // replaceTrack (no renegotiation, no glare) and the peer's camera has an
    // inbound slot from day one.
    if (initiator && !screenVt && !(ls && ls.getVideoTracks().length > 0)) {
      try {
        (pc as unknown as { addTransceiver: (k: string, o: object) => void })
          .addTransceiver("video", { direction: "sendrecv" });
      } catch { /* older stack — renegotiation fallback still works */ }
    }
    (pc as unknown as { ontrack: (e: { track: { kind: string } }) => void }).ontrack = (e: { track: unknown }) => {
      try { (stream as unknown as { addTrack: (t: unknown) => void }).addTrack(e.track); } catch { /* dup */ }
      // A null-track sendrecv m-line delivers a muted video track (the web's
      // camera-less peers) — re-render tiles when it (un)mutes so a black
      // rectangle never replaces the avatar (v2.80 regression class).
      const trk = e.track as { kind?: string; onmute?: () => void; onunmute?: () => void };
      if (trk.kind === "video") { trk.onmute = publishTiles; trk.onunmute = publishTiles; }
      publishTiles();
      markEstablished();
    };
    (pc as unknown as { onicecandidate: (e: { candidate: unknown }) => void }).onicecandidate = e => {
      if (e.candidate) void sig.current?.send({ type: "signal", to: pin, data: { candidate: e.candidate } });
    };
    (pc as unknown as { onconnectionstatechange: () => void }).onconnectionstatechange = () => {
      const cs = (pc as unknown as { connectionState: string }).connectionState;
      if (cs === "connected") markEstablished();
      if (cs === "failed" || cs === "closed") {
        // Terminal for this pair — drop the tile; auto-end handles 1:1 below.
        removePeer(pin);
      }
    };
    return peer;
  };

  const meshOffer = async (pin: string) => {
    const peer = peers.current.get(pin);
    if (!peer) return;
    const offer = await peer.pc.createOffer({});
    await peer.pc.setLocalDescription(offer as never);
    void sig.current?.send({ type: "signal", to: pin, data: { sdp: peer.pc.localDescription as never } });
  };

  const removePeer = (pin: string) => {
    const peer = peers.current.get(pin);
    if (!peer) return;
    peers.current.delete(pin);
    try { peer.pc.close(); } catch { /* */ }
    // A sharer who leaves never sends screen{off} — clear their spotlight.
    if (st.current.peerScreenPin === pin) patch({ peerScreenPin: "" });
    publishTiles();
    // 1:1 auto-end (v2.81): the other party left — end rather than sit alone.
    // Groups stay open (the host may ring more people in — web parity), and a
    // HELD call must survive the holder's temporary departure (peer-hold).
    if (inCall.current && peers.current.size === 0 &&
        !callIsGroup.current && !heldByPeer.current) {
      hangupInternal("remote-left");
    }
  };

  const onSignal = async (from: string, data: Msg["data"]) => {
    if (!data) return;
    let peer = peers.current.get(from);
    // A fresh OFFER for a dead pc means the peer rebuilt their session
    // (reload/rejoin) — applying it onto the stale pc stalls forever (web
    // parity). Rebuild without triggering the 1:1 auto-end.
    if (peer && data.sdp?.type === "offer") {
      const cs = (peer.pc as unknown as { connectionState: string }).connectionState;
      if (cs === "failed" || cs === "closed" || cs === "disconnected") {
        try { peer.pc.close(); } catch { /* */ }
        peers.current.delete(from);
        peer = undefined as never;
      }
    }
    if (!peer) peer = createPeer(from, from, false);
    try {
    if (data.sdp) {
      await peer.pc.setRemoteDescription(new RTCSessionDescription(data.sdp as never) as never);
      peer.hasRemoteDesc = true;
      for (const c of peer.pendingCandidates.splice(0)) {
        try { await peer.pc.addIceCandidate(new RTCIceCandidate(c as never) as never); } catch { /* stale */ }
      }
      if (data.sdp.type === "offer") {
        // v2.81 answerer rule: flip offered recvonly video m-lines to sendrecv
        // BEFORE answering, so a later consent upgrade needs no renegotiation.
        try {
          const trs = (peer.pc as unknown as { getTransceivers: () => Array<{ receiver?: { track?: { kind?: string } }; direction: string }> }).getTransceivers();
          for (const tr of trs) {
            if (tr.receiver?.track?.kind === "video" && tr.direction === "recvonly") {
              try { tr.direction = "sendrecv"; } catch { /* best effort */ }
            }
          }
        } catch { /* older stack */ }
        const answer = await peer.pc.createAnswer();
        await peer.pc.setLocalDescription(answer as never);
        void sig.current?.send({ type: "signal", to: from, data: { sdp: peer.pc.localDescription as never } });
      }
    } else if (data.candidate) {
      if (peer.hasRemoteDesc) {
        try { await peer.pc.addIceCandidate(new RTCIceCandidate(data.candidate as never) as never); } catch { /* */ }
      } else {
        peer.pendingCandidates.push(data.candidate);
      }
    }
    } catch { /* negotiation hiccup — the retry/rebuild paths recover */ }
  };

  const renegotiateAll = async () => {
    for (const [pin] of peers.current) await meshOffer(pin).catch(() => {});
  };

  // ── protocol ──
  const handleMessage = useCallback((m: Msg) => {
    switch (m.type) {
      case "registered":
        if (m.iceServers?.length) iceServers.current = m.iceServers;
        break;
      case "peer-screen":
        if (!m.pin) break;
        if (m.on !== false) patch({ peerScreenPin: m.pin });
        // Only the SHARER's own off clears (two group sharers must not desync).
        else if (st.current.peerScreenPin === m.pin) patch({ peerScreenPin: "" });
        publishTiles();
        break;
      case "room": {
        roomId.current = m.roomId ?? null;
        // Group dial (M3.5): the rest of the batch was queued until the server
        // created our dial room — every later invite reuses it (web parity).
        const q = pendingGroupInvites.current.splice(0);
        for (const t of q) {
          if (!peers.current.has(t)) void sig.current?.send({ type: "invite", to: t, video: st.current.camOn });
        }
        break;
      }
      case "ringing":
        if (inCall.current && !callAnswered.current) {
          patch({
            status: m.paging ? "paging" : "ringing",
            // A group dial gets per-invitee acks — don't let the last one
            // rename the "Group call" card (web guards the same way).
            peerName: callIsGroup.current ? st.current.peerName : (m.name || st.current.peerName),
          });
        }
        break;
      case "ring": {
        // Stale-ring replace rules (v2.83): a ring from the SAME caller (redial
        // or server redelivery) or an EXPIRED pending ring replaces; only a
        // genuinely-concurrent second caller is rejected.
        const cur = st.current.incoming;
        if (inCall.current) {
          // A redelivered ring for the call we're IN (SSE blip mid-answer →
          // re-register → deliverPendingRing) must be ignored, not rejected —
          // rejecting killed the caller's dial room out from under our accept.
          // roomId is set at ACCEPT time (not just on `joined`), so matching
          // on it alone covers the whole answer window.
          if (m.roomId === roomId.current) return;
          // CALL WAITING (M3.5, v2.83 replace rules): reject ONLY a genuinely
          // concurrent DIFFERENT second caller with a fresh waiter already up;
          // a same-caller redial/redelivery or an expired waiter REPLACES.
          const w = st.current.waiting;
          if (w && w.from !== m.from && Date.now() - w.at <= 70_000) {
            void sig.current?.send({ type: "reject", to: m.from });
            return;
          }
          clearTimer(waitingTimeout);
          patch({ waiting: { from: m.from!, fromName: m.fromName || m.from!, roomId: m.roomId!, video: !!m.video, at: Date.now() } });
          // Discreet cue only — never blast a ringtone over live call audio.
          try { Vibration.vibrate([0, 300, 150, 300]); } catch { /* */ }
          waitingTimeout.current = setTimeout(() => {
            waitingTimeout.current = null;
            const cw = st.current.waiting;
            if (cw && cw.from === m.from) {
              void sig.current?.send({ type: "reject", to: cw.from });
              patch({ waiting: null });
            }
          }, 30_000);
          return;
        }
        if (cur && cur.from !== m.from && Date.now() - cur.at <= 70_000) {
          void sig.current?.send({ type: "reject", to: m.from });
          return;
        }
        const ring: IncomingRing = {
          from: m.from!, fromName: m.fromName || m.from!, roomId: m.roomId!,
          video: !!m.video, at: Date.now(),
        };
        stopRing(); // a same-caller replace must not stack ringtones
        patch({ incoming: ring, phase: "incoming" });
        InCallManager.startRingtone("_DEFAULT_", [0, 400, 200, 400], "default", 60);
        nativeCancelRing(); // the in-app ring supersedes the FCM lock-screen one
        clearTimer(ringTimeout);
        ringTimeout.current = setTimeout(() => {
          if (st.current.incoming?.from === ring.from) declineIncomingInternal();
        }, 60_000);
        break;
      }
      case "ring-cancel":
        if (st.current.incoming && (!m.from || st.current.incoming.from === m.from)) {
          stopRing();
          patch({ incoming: null, phase: inCall.current ? "in-call" : "idle" });
        }
        // Deliberate divergence from web: our call-waiting answer is
        // DESTRUCTIVE (ends the current call first), so accepting a waiter
        // whose caller already hung up would cost BOTH calls — clear it.
        if (st.current.waiting && (!m.from || st.current.waiting.from === m.from)) {
          clearTimer(waitingTimeout);
          patch({ waiting: null });
        }
        break;
      case "joined": {
        roomId.current = m.roomId ?? roomId.current;
        if (m.iceServers?.length) iceServers.current = m.iceServers;
        callAnswered.current = true;
        // Answering INTO an ongoing conference must flip the group flag before
        // any consent choke point runs (toggleCam) — a group bypasses the
        // 1:1 mutual-consent gate.
        if ((m.members?.length ?? 0) > 1) markGroup();
        patch({ status: "connecting" });
        {
          // Mesh: the NEWCOMER (me) offers to every existing member (glare-free).
          for (const member of m.members ?? []) {
            createPeer(member.pin, member.name, true);
          }
          void (async () => { for (const mem of m.members ?? []) await meshOffer(mem.pin).catch(() => {}); })();
        }
        break;
      }
      case "peer-joined": {
        if (m.iceServers?.length) iceServers.current = m.iceServers;
        callAnswered.current = true;
        clearTimer(dialTimeout);
        if (!established.current) patch({ status: "connecting" });
        if (m.pin) {
          // Existing member: the newcomer offers — just prepare the pc.
          createPeer(m.pin, m.name || m.pin, false);
        }
        break;
      }
      case "peer-left": {
        // `peer-left` is the server's authoritative "membership removed" —
        // the holder LEFT for real (server releases held rooms on full leave).
        // Without clearing the flag a held 1:1 shows "On hold" forever — the
        // hold path suppresses the auto-end, so only this can release it.
        if (heldByPeer.current) {
          heldByPeer.current = false;
          patch({ onHold: false });
          if (inCall.current && !callIsGroup.current && peers.current.size === 0 &&
              true) {
            hangupInternal("remote-left");
            break;
          }
        }
        if (m.pin) removePeer(m.pin);
        break;
      }
      case "signal":
        if (m.from) void onSignal(m.from, m.data);
        break;
      case "rejected":
        // Web-shaped gate (v2.80): a decline only matters while NO remote is
        // attached — one group invitee declining must not kill a live
        // conference. Post-establishment (call-waiting promote window), a
        // lone rejected means the far side moved on: end honestly.
        if (inCall.current && aloneInCall()) {
          if (!established.current) failDial("They declined.");
          else hangupInternal("peer-rejected");
        }
        break;
      case "busy":
        if (inCall.current && !established.current && aloneInCall()) failDial("They're on another call.");
        break;
      case "kicked":
        hangupInternal("kicked");
        break;
      case "rejoin":
        // Rejoin-after-restart (M3.5): if boot armed a pendingRejoin (fresh
        // snapshot), take the room back; otherwise decline explicitly so the
        // server drops the ghost membership (it would pollute the next dial).
        if (pendingRejoin.current && !established.current) {
          void resumeRejoin(m);
        } else if (!inCall.current) {
          void sig.current?.send({ type: "leave", reason: "rejoin-declined" });
        }
        break;
      case "peer-hold":
        // The peer answered THEIR call waiting: the web holder FREEZES media
        // and keeps the peer connection, so their tile goes quiet rather than
        // leaving — without this flag a silent peer reads as "remote left"
        // and auto-ends US. Park instead and wait for on:false / their
        // return. 1:1 ONLY: in a group
        // one member's hold must not banner the whole (still live) call —
        // per-tile hold badges belong to the hold/swap milestone.
        if (!inCall.current || callIsGroup.current) break;
        heldByPeer.current = m.on !== false;
        patch({ onHold: heldByPeer.current });
        break;
      case "video-request":
        if (inCall.current) patch({ videoAsk: m.fromName || "They" });
        break;
      case "video-accept":
        if (!inCall.current) break; // straggler after teardown — never grab media idle
        videoApproved.current = true;
        void enableCamera();
        break;
      case "video-decline":
        if (!inCall.current) break;
        videoApproved.current = false; // consent is per-ask, not permanent
        patch({ videoAsk: null });
        break;
      case "error": {
        // In-call add-person to an offline/nonexistent number must NEVER tear
        // the call down (v2.50 web fix) — the 6s guard consumes it as a toast.
        if (m.code === "offline" && Date.now() < addInviteGuardUntil.current) {
          showNotice(m.message || "That number doesn't exist or is offline.");
          break;
        }
        if (m.code === "full") { showNotice(m.message || "Call is full."); break; }
        const fatal = m.code === "offline" || m.code === "self" || m.code === "gone";
        if (fatal && inCall.current && !established.current && aloneInCall()) {
          failDial(m.message || "They're unreachable right now.");
        }
        break;
      }
      default: break;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopRing = () => {
    clearTimer(ringTimeout);
    try { InCallManager.stopRingtone(); } catch { /* */ }
  };

  const failDial = (message: string) => {
    if (failT.current) return; // already presenting a failure
    clearTimer(dialTimeout);
    patch({ status: "calling", peerName: message });
    failT.current = setTimeout(() => { failT.current = null; hangupInternal("dial-failed"); }, 1900);
  };

  const cleanupMedia = () => {
    peers.current.forEach(p => { try { p.pc.close(); } catch { /* */ } });
    peers.current.clear();
    const ls = localStream.current;
    localStream.current = null;
    if (ls) ls.getTracks().forEach(t => { try { t.stop(); } catch { /* */ } });
    try { InCallManager.stop(); } catch { /* */ }
  };

  const hangupInternal = (reason: string) => {
    void sig.current?.send({ type: "leave", reason });
    stopRing();
    nativeStopCallService(); // M4: release the ongoing-call keep-alive
    clearTimer(dialTimeout);
    clearTimer(failT);
    clearTimer(waitingTimeout);
    clearTimer(rejoinWatchdog);
    // Promote-on-death (v2.78.1): a dying call must NOT swallow a live second
    // caller — re-present the waiter as a normal incoming ring afterwards.
    const promoted = st.current.waiting && Date.now() - st.current.waiting.at <= 70_000
      ? st.current.waiting : null;
    inCall.current = false;
    callAnswered.current = false;
    established.current = false;
    videoApproved.current = false;
    callIsGroup.current = false;
    heldByPeer.current = false;
    pendingGroupInvites.current = [];
    pendingRejoin.current = null;
    addInviteGuardUntil.current = 0;
    roomId.current = null;
    stopSnapRefresh();
    void clearRejoinSnapshot();
    nativeSetPipEligible(false);
    if (screenStream.current) {
      try { screenStream.current.getTracks().forEach(t => t.stop()); } catch { /* */ }
      screenStream.current = null;
    }
    cleanupMedia();
    setState(s => ({
      ...s, phase: "idle", status: "calling", peerName: "", peerPin: "",
      incoming: null, waiting: null, videoAsk: null, tiles: [], localStream: null,
      camOn: false, micOn: true, onHold: false, isGroup: false, rejoining: false,
      sharingScreen: false, peerScreenPin: "",
    }));
    if (promoted) {
      patch({ incoming: { ...promoted }, phase: "incoming" });
      InCallManager.startRingtone("_DEFAULT_", [0, 400, 200, 400], "default", 60);
      nativeCancelRing();
      clearTimer(ringTimeout);
      ringTimeout.current = setTimeout(() => {
        if (st.current.incoming?.from === promoted.from) declineIncomingInternal();
      }, 60_000);
    }
  };

  const declineIncomingInternal = () => {
    const r = st.current.incoming;
    stopRing();
    patch({ incoming: null, phase: "idle" });
    if (r) void sig.current?.send({ type: "reject", to: r.from });
  };

  const declineWaitingInternal = () => {
    const w = st.current.waiting;
    clearTimer(waitingTimeout);
    patch({ waiting: null });
    if (w) void sig.current?.send({ type: "reject", to: w.from });
  };

  /** Call-waiting answer (M3.5): END the current call, then accept the waiter.
   *  The leave is AWAITED with retries — the server processes a POST fully
   *  before responding, so leave-then-accept is strictly ordered. Firing them
   *  unserialized can land accept-first: the server would HOLD the old room
   *  and the late leave would tear down the call we just answered (the v2.50
   *  race class). Keeps the live mic + audio session + FGS across the switch. */
  const acceptWaitingInternal = () => {
    const w = st.current.waiting;
    if (!w || !inCall.current) return;
    clearTimer(waitingTimeout);
    clearTimer(dialTimeout);
    clearTimer(failT);
    // A boot-armed rejoin must not race the answer: its 10s watchdog would
    // tear down the freshly accepted call (review finding).
    clearTimer(rejoinWatchdog);
    pendingRejoin.current = null;
    // Key the NEW room immediately — redelivered rings for the waiter's call
    // must dedupe by roomId across the whole switch window.
    roomId.current = w.roomId;
    patch({ waiting: null, rejoining: false });
    void (async () => {
      const left = await sig.current?.send({ type: "leave", reason: "switch" }, { attempts: 3 });
      // The engine may have been torn down while the leave was in flight
      // (peer-left → 1:1 auto-end): continuing would join the new room with
      // no mic and inCall=false — a zombie call. Stop here; the waiter was
      // promoted by hangupInternal if still fresh.
      if (!inCall.current) return;
      if (!left) {
        // The leave definitively failed after retries — an accept now would
        // make the server HOLD the old room forever. End honestly instead.
        hangupInternal("switch-failed");
        return;
      }
      // Partial teardown — everything but the mic, InCallManager, and FGS.
      peers.current.forEach(p => { try { p.pc.close(); } catch { /* */ } });
      peers.current.clear();
      established.current = false;
      callAnswered.current = true;
      videoApproved.current = false; // voice answer — mid-call consent can upgrade
      callIsGroup.current = false;
      heldByPeer.current = false;
      pendingGroupInvites.current = [];
      stopSnapRefresh();
      void clearRejoinSnapshot();
      if (screenStream.current) {
        try { screenStream.current.getTracks().forEach(t => t.stop()); } catch { /* */ }
        screenStream.current = null;
      }
      localStream.current?.getVideoTracks().forEach(t => { t.enabled = false; });
      patch({
        phase: "in-call", status: "connecting", peerName: w.fromName, peerPin: w.from,
        isVideoCall: w.video, camOn: false, tiles: [], videoAsk: null,
        onHold: false, isGroup: false, sharingScreen: false, peerScreenPin: "",
      });
      void sig.current?.send({ type: "accept", roomId: w.roomId });
      // Voice answer to a video dial: tell them cameras stay off (v2.81).
      if (w.video) void sig.current?.send({ type: "video-decline" });
    })();
  };

  /** Positive rejoin (M3.5): the server offered our room back after a restart
   *  registered under the snapshot pin. WE are the newcomer, so we offer to
   *  every member (glare-free) — the same rule a fresh join follows. */
  const resumeRejoin = async (m: Msg) => {
    const snap = pendingRejoin.current;
    if (!snap) return;
    pendingRejoin.current = null;
    clearTimer(rejoinWatchdog);
    roomId.current = m.roomId ?? snap.roomId;
    if (m.iceServers?.length) iceServers.current = m.iceServers;
    callAnswered.current = true;
    if ((m.members?.length ?? 0) > 1 || snap.isGroup) markGroup();
    try {
      await ensureMedia(false);
    } catch {
      await new Promise(r => setTimeout(r, 600));
      try {
        await ensureMedia(false);
      } catch {
        // No mic = no call: forfeit the room honestly instead of sitting mute.
        void sig.current?.send({ type: "leave", reason: "rejoin-no-media" });
        inCall.current = false;
        callAnswered.current = false;
        void clearRejoinSnapshot();
        cleanupMedia();
        patch({ phase: "idle", status: "calling", peerName: "", peerPin: "", rejoining: false });
        return;
      }
    }
    localStream.current?.getAudioTracks().forEach(t => { t.enabled = snap.micOn; });
    patch({ micOn: snap.micOn, speakerOn: snap.speakerOn });
    {
      for (const mem of m.members ?? []) createPeer(mem.pin, mem.name || mem.pin, true);
      void (async () => { for (const mem of m.members ?? []) await meshOffer(mem.pin).catch(() => {}); })();
      // Rejoin rosters are NOT ghost-filtered server-side — if nobody connects
      // within 15s the members are dead pins; stop pretending.
      clearTimer(rejoinWatchdog);
      rejoinWatchdog.current = setTimeout(() => {
        rejoinWatchdog.current = null;
        if (inCall.current && !established.current) hangupInternal("rejoin-failed");
      }, 15_000);
    }
    void clearRejoinSnapshot(); // consumed — establishment re-writes it
  };

  /** M5 screen share, mesh-only since v2.106.54: getDisplayMedia (MediaProjection
   *  consent behind it) hot-swaps into the pre-allocated video m-line —
   *  replaceTrack, no renegotiation — and announces via `{type:"screen"}` so
   *  every client spotlights the sharer. */
  const stopScreenShareInternal = async (announce: boolean) => {
    const dying = screenStream.current;
    screenStream.current = null;
    patch({ sharingScreen: false });
    if (dying) {
      // Restore the camera into the slot (or empty it if the cam is off).
      const camTrack = st.current.camOn ? (localStream.current?.getVideoTracks()[0] ?? null) : null;
      peers.current.forEach(p => {
        try {
          const senders = (p.pc as unknown as { getSenders: () => Array<{ track: { kind?: string } | null; replaceTrack: (t: unknown) => Promise<void> }> }).getSenders();
          const s = senders.find(x => x.track && x.track.kind === "video");
          if (s) void s.replaceTrack(camTrack as never);
        } catch { /* */ }
      });
    }
    if (dying) { try { dying.getTracks().forEach(t => { t.stop(); }); } catch { /* */ } }
    if (announce && inCall.current) void sig.current?.send({ type: "screen", action: "off" });
    // Drop the FGS back to mic-only types.
    if (established.current) nativeStartCallService(st.current.peerName || undefined);
  };

  const toggleScreenShareInternal = () => {
    if (!inCall.current || screenBusy.current) return;
    if (st.current.sharingScreen) { screenBusy.current = true; void stopScreenShareInternal(true).finally(() => { screenBusy.current = false; }); return; }
    screenBusy.current = true;
    void (async () => {
      try {
        {
          const md = mediaDevices as unknown as { getDisplayMedia?: (c: object) => Promise<MediaStream> };
          if (!md.getDisplayMedia) { showNotice("Screen sharing isn't available on this device."); return; }
          const disp = await md.getDisplayMedia({ video: true });
          const track = disp.getVideoTracks()[0];
          if (!inCall.current || !track) { disp.getTracks().forEach(t => t.stop()); return; }
          screenStream.current = disp;
          (track as unknown as { onended?: () => void }).onended = () => { void stopScreenShareInternal(true); };
          let swapped = 0;
          peers.current.forEach(p => {
            try {
              const senders = (p.pc as unknown as { getSenders: () => Array<{ track: { kind?: string } | null; replaceTrack: (t: unknown) => Promise<void> }> }).getSenders();
              const s = senders.find(x => x.track && x.track.kind === "video");
              if (s) { void s.replaceTrack(track as never); swapped++; return; }
              const trs = (p.pc as unknown as { getTransceivers: () => Array<{ receiver?: { track?: { kind?: string } }; sender: { track: unknown | null; replaceTrack: (t: unknown) => Promise<void> } }> }).getTransceivers();
              const slot = trs.find(tr => tr.receiver?.track?.kind === "video" && !tr.sender.track);
              if (slot) { void slot.sender.replaceTrack(track as never); swapped++; }
            } catch { /* */ }
          });
          if (swapped === 0) {
            disp.getTracks().forEach(t => t.stop());
            screenStream.current = null;
            showNotice("Screen sharing needs a video-capable call.");
            return;
          }
          patch({ sharingScreen: true });
        }
        void sig.current?.send({ type: "screen", action: "on" });
        // Android 14: the mediaProjection FGS type may only be declared AFTER
        // the user granted capture — restart the keep-alive with it now.
        if (established.current) nativeStartCallService(st.current.peerName || undefined, { screenShare: true });
      } catch {
        // Consent dialog cancelled / SDK failure — stay as we were.
      } finally {
        screenBusy.current = false;
      }
    })();
  };

  const enableCamera = async () => {
    try {
      await ensureMedia(true);
      patch({ camOn: true });
      // Mid-share the video slot carries the SCREEN track — swapping the
      // camera in would kill the share, and the addTrack fallback would mint
      // a duplicate m-line (web guards every enable path the same way).
      // stop-share restores the camera per camOn, so state-only is enough.
      if (st.current.sharingScreen) return;
      {
        // Mesh: fill the PRE-ALLOCATED video m-line with replaceTrack — no
        // renegotiation, no RN↔RN offer glare. Renegotiate only for peers
        // without a reserved slot (legacy path).
        const vt = localStream.current?.getVideoTracks()[0];
        if (vt) {
          const needOffer: string[] = [];
          peers.current.forEach((p, pin) => {
            try {
              const trs = (p.pc as unknown as { getTransceivers: () => Array<{ receiver?: { track?: { kind?: string } }; sender: { track: unknown | null; replaceTrack: (t: unknown) => Promise<void> } }> }).getTransceivers();
              const slot = trs.find(tr => tr.receiver?.track?.kind === "video" && !tr.sender.track);
              if (slot) { void slot.sender.replaceTrack(vt as never); return; }
            } catch { /* fall through */ }
            try { p.pc.addTrack(vt as never, localStream.current as never); needOffer.push(pin); } catch { /* */ }
          });
          for (const pin of needOffer) await meshOffer(pin).catch(() => {});
        }
      }
    } catch { /* camera denied — stay voice */ }
  };

  // ── boot: register the engine under MY identity number ──
  useEffect(() => {
    const s = new RelaySignaling();
    sig.current = s;
    s.onMessage = handleMessage;
    s.onRegistered = () => setReady(true);
    let cancelled = false;
    // M3.5: the snapshot read GATES registration — an unarmed register would
    // hit the rejoin auto-decline (`leave rejoin-declined`), which forfeits
    // the room permanently. A fresh, identity-matching snapshot pre-arms the
    // engine and registers under the SNAPSHOT pin (server-authoritative).
    void (async () => {
      // Restore the persisted channel id FIRST (web's relay_cid): the server
      // keeps a killed app's pin alive for a 30s grace keyed to this cid — a
      // fresh random cid can't reclaim the pin, which would kill BOTH the
      // rejoin below and the M4 open-from-FCM ring hand-off.
      await s.restoreCid();
      let snapPin: string | null = null;
      const snap = await readRejoinSnapshot().catch(() => null);
      if (!cancelled && snap) {
        if (me.number && snap.pin !== me.number) {
          // Different identity now owns this device — the shared-device
          // hijack guard the server can't apply to our per-boot cid.
          void clearRejoinSnapshot();
        } else {
          pendingRejoin.current = snap;
          inCall.current = true;
          callAnswered.current = true;
          videoApproved.current = true; // was live pre-restart; consent stands
          established.current = false;
          snapPin = snap.pin;
          patch({
            phase: "in-call", status: "connecting", rejoining: true,
            peerName: snap.peerName, peerPin: snap.peerPin,
            isVideoCall: snap.isVideoCall, camOn: false,
            micOn: snap.micOn, speakerOn: snap.speakerOn,
          });
          clearTimer(rejoinWatchdog);
          rejoinWatchdog.current = setTimeout(() => {
            rejoinWatchdog.current = null;
            // No rejoin offer arrived — the server already reaped us.
            if (pendingRejoin.current && !established.current) {
              pendingRejoin.current = null;
              inCall.current = false;
              callAnswered.current = false;
              void clearRejoinSnapshot();
              cleanupMedia();
              patch({ phase: "idle", status: "calling", peerName: "", peerPin: "", rejoining: false });
            }
          }, 10_000);
        }
      }
      if (!cancelled) s.register(me.displayName, snapPin ?? me.number);
    })();
    // M4: rings-when-closed — ask for POST_NOTIFICATIONS (Android 13+), then
    // register this device's FCM token so the server can PAGE it for calls
    // that arrive with the app dead (server/relay.ts onPageCallee →
    // sendPushToIdentity → sendFcmData → RelayFcmService full-screen ring).
    // Token is null until Firebase is configured — silently skipped.
    void (async () => {
      await nativeEnsureNotificationPermission();
      const token = await nativeGetPushToken();
      if (token) await serverApi.pushSubscribe(token).catch(() => {});
    })();
    const appSub = AppState.addEventListener("change", stt => {
      if (stt === "active") {
        s.ensureConnected();
        // Android 12+ blocks FGS starts from the background: if the call
        // ESTABLISHED while backgrounded (caller backgrounded mid-ring), the
        // keep-alive start was rejected — retry now that we're foreground.
        // Idempotent when it already runs (same notification re-posted).
        if (established.current) nativeStartCallService(st.current.peerName || undefined);
        // Foreground zombie sweep (v2.83 parity): rings older than the 70s
        // pending-ring TTL are dead server-side — presenting them lies.
        const now = Date.now();
        if (st.current.incoming && now - st.current.incoming.at > 70_000) {
          stopRing();
          patch({ incoming: null, phase: inCall.current ? "in-call" : "idle" });
        }
        if (st.current.waiting && now - st.current.waiting.at > 70_000) {
          clearTimer(waitingTimeout);
          patch({ waiting: null });
        }
      } else if (stt === "background") {
        writeSnap(); // freshest possible ts if Android kills us back there
      }
    });
    return () => {
      cancelled = true;
      appSub.remove();
      s.destroy();
      sig.current = null;
      stopSnapRefresh();
      // Identity change / provider teardown: a surviving snapshot would let
      // the NEXT identity resume THIS user's call (shared-device hijack).
      void clearRejoinSnapshot();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me.id]);

  // ── public api ──
  const api: EngineApi = useMemo(() => ({
    ...state, ready,
    dial: (number, opts) => {
      if (inCall.current || !/^\d{6}$/.test(number) || number === sig.current?.pin) return;
      const video = !opts?.voice;
      inCall.current = true;
      established.current = false;
      callAnswered.current = false;
      videoApproved.current = false; // consent comes ONLY from the callee
                                     // (answer-with-video → video-accept)
      callIsGroup.current = false;
      heldByPeer.current = false;
      patch({
        phase: "dialing", status: "calling", peerPin: number,
        peerName: opts?.displayName ?? "", isVideoCall: video, camOn: false,
        onHold: false, isGroup: false,
      });
      void (async () => {
        try { await ensureMedia(false); } catch { hangupInternal("no-media"); return; }
        void sig.current?.send({ type: "invite", to: number, video });
        clearTimer(dialTimeout);
        dialTimeout.current = setTimeout(() => {
          if (inCall.current && !callAnswered.current) failDial("No answer — they'll see your missed call.");
        }, 65_000);
      })();
    },
    dialGroup: (numbers, opts) => {
      if (inCall.current) return;
      const uniq = Array.from(new Set(numbers.map(n => n.replace(/\D/g, ""))))
        .filter(n => /^\d{6}$/.test(n) && n !== sig.current?.pin)
        .slice(0, 10);
      if (uniq.length === 0) return;
      const video = !(opts?.voice ?? true); // voice-first default (v2.83 rule)
      inCall.current = true;
      established.current = false;
      callAnswered.current = false;
      videoApproved.current = false;
      heldByPeer.current = false;
      markGroup();
      patch({
        phase: "dialing", status: "calling", peerPin: "",
        peerName: `Group call · ${uniq.length} ${uniq.length === 1 ? "person" : "people"}`,
        isVideoCall: video, camOn: false, onHold: false,
      });
      void (async () => {
        try { await ensureMedia(false); } catch { hangupInternal("no-media"); return; }
        // First invite creates the dial room; the rest flush on the server's
        // `room` ack so every invite lands in the SAME room (web parity —
        // this is also what seeds the roster with us as the caller, which
        // History's direction inference depends on).
        pendingGroupInvites.current = uniq.slice(1);
        void sig.current?.send({ type: "invite", to: uniq[0], video });
        clearTimer(dialTimeout);
        dialTimeout.current = setTimeout(() => {
          if (inCall.current && !callAnswered.current) failDial("No answer — they'll see your missed call.");
        }, 65_000);
      })();
    },
    addToCall: (number) => {
      if (!inCall.current) return;
      const n = number.replace(/\D/g, "");
      if (!/^\d{6}$/.test(n) || n === sig.current?.pin) { showNotice("Enter a valid 6-digit number."); return; }
      if (peers.current.has(n)) {
        showNotice("They're already in this call.");
        return;
      }
      /* SIX, matching the web's exported ROOM_MAX. A measurement rather than a
         preference: on the mesh each phone runs N-1 encoders and N-1 decoders. */
      const cap = 6;
      const count = 1 + peers.current.size;
      if (count >= cap) { showNotice(`Call is full (${cap} people max).`); return; }
      // 6s guard: an offline/nonexistent target answers with error{offline},
      // which must read as a toast — never a call teardown (v2.50 web fix).
      addInviteGuardUntil.current = Date.now() + 6000;
      void sig.current?.send({ type: "invite", to: n, video: st.current.camOn });
      showNotice(`Inviting ${n.slice(0, 3)}-${n.slice(3)}…`);
    },
    acceptIncoming: (opts) => {
      const r = st.current.incoming;
      if (!r) return;
      stopRing();
      const answerVideo = r.video && !opts?.voice;
      videoApproved.current = answerVideo; // Video answer = the consent (v2.81)
      inCall.current = true;
      callAnswered.current = true;
      callIsGroup.current = false; // `joined` flips it for conferences
      heldByPeer.current = false;
      // Key the room NOW (not on `joined`) so redelivered rings for THIS call
      // are ignored by roomId alone across the whole answer window (Step 0c).
      roomId.current = r.roomId;
      patch({
        incoming: null, phase: "in-call", status: "connecting",
        peerName: r.fromName, peerPin: r.from, isVideoCall: r.video, camOn: answerVideo,
        onHold: false, isGroup: false,
      });
      void (async () => {
        try {
          await ensureMedia(answerVideo);
        } catch {
          // Media denied: REJECT so the caller hears it now (a `leave` would
          // ring them to the 65s backstop and leave a ghost pending ring).
          void sig.current?.send({ type: "reject", to: r.from });
          inCall.current = false;
          callAnswered.current = false;
          cleanupMedia();
          patch({ phase: "idle", status: "calling", peerName: "", peerPin: "", camOn: false });
          return;
        }
        void sig.current?.send({ type: "accept", roomId: r.roomId });
        if (r.video) void sig.current?.send({ type: answerVideo ? "video-accept" : "video-decline" });
      })();
    },
    declineIncoming: declineIncomingInternal,
    acceptWaiting: acceptWaitingInternal,
    declineWaiting: declineWaitingInternal,
    hangup: () => hangupInternal("user-hangup"),
    toggleMic: () => {
      const next = !st.current.micOn;
      localStream.current?.getAudioTracks().forEach(t => { t.enabled = next; });
      patch({ micOn: next });
      if (established.current) setTimeout(writeSnap, 150); // snapshot follows state
    },
    toggleCam: () => {
      if (st.current.camOn) {
        localStream.current?.getVideoTracks().forEach(t => { t.enabled = false; });
        patch({ camOn: false });
        if (established.current) setTimeout(writeSnap, 150);
        return;
      }
      // Groups bypass mutual consent (v2.81) — everyone opted into a
      // conference; the 1:1 ask protocol would baffle web peers mid-group.
      if (videoApproved.current || callIsGroup.current) {
        void enableCamera();
        if (established.current) setTimeout(writeSnap, 300);
        return;
      }
      // Mutual consent: ask first — the peer's accept turns BOTH cameras on.
      void sig.current?.send({ type: "video-request" });
    },
    flipCam: () => {
      const vt = localStream.current?.getVideoTracks()[0] as unknown as { _switchCamera?: () => void } | undefined;
      vt?._switchCamera?.();
    },
    toggleSpeaker: () => {
      const next = !st.current.speakerOn;
      InCallManager.setSpeakerphoneOn(next);
      patch({ speakerOn: next });
      if (established.current) setTimeout(writeSnap, 150);
    },
    answerVideoAsk: (yes) => {
      patch({ videoAsk: null });
      void sig.current?.send({ type: yes ? "video-accept" : "video-decline" });
      if (yes) { videoApproved.current = true; void enableCamera(); }
    },
    toggleScreenShare: toggleScreenShareInternal,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [state, ready]);

  return <CallContext.Provider value={api}>{children}</CallContext.Provider>;
}
