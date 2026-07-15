/**
 * The RELAY call engine, ported from the web (client/src/lib/relayClient.ts)
 * with the protocol semantics that took v2.74–v2.84 to harden:
 *  - staged progress: calling → ringing / "reaching their phone…" (paging) →
 *    connecting → live; 65s no-answer backstop
 *  - stale-ring replace rules (same-caller / expired rings never blind-reject)
 *  - voice-first + MUTUAL-CONSENT video (video-request / accept / decline;
 *    both cameras turn on together), 1:1 auto-end on remote-left
 *  - mesh (newcomer offers, candidate queue, renegotiation) via the shared
 *    @livekit/react-native-webrtc stack, LiveKit SFU when the server says so
 *  - native audio routing: earpiece/speaker via react-native-incall-manager,
 *    speaker DEFAULT ON on phones (v2.84 parity)
 * Deferred to M3.5+: hold/swap/merge (call waiting UI), group calls, rejoin
 * after app restart, screen share, recording, filters.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import {
  MediaStream, RTCIceCandidate, RTCPeerConnection, RTCSessionDescription, mediaDevices,
} from "@livekit/react-native-webrtc";
import { AudioSession } from "@livekit/react-native";
import { Room, RoomEvent, Track } from "livekit-client";
import InCallManager from "react-native-incall-manager";
import { RelaySignaling, type IceServer, type Msg } from "./signaling";
import { type Whoami } from "../lib/api";

export type CallStatus = "calling" | "ringing" | "paging" | "connecting" | "live";
export type CallPhase = "idle" | "incoming" | "dialing" | "in-call";

export interface RemoteTile {
  key: string;            // pin (mesh) or participant identity (SFU)
  name: string;
  /** Remote media for RTCView — mesh stream, or the SFU video track wrapped
   *  in a MediaStream (ONE rendering path; SFU audio plays via AudioSession). */
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
  videoAsk: string | null; // peer name asking to start video
  tiles: RemoteTile[];
  localStream: MediaStream | null;
  micOn: boolean;
  camOn: boolean;
  speakerOn: boolean;
}

interface EngineApi extends EngineState {
  ready: boolean;
  dial: (number: string, opts?: { voice?: boolean; displayName?: string }) => void;
  acceptIncoming: (opts?: { voice?: boolean }) => void;
  declineIncoming: () => void;
  hangup: () => void;
  toggleMic: () => void;
  toggleCam: () => void;
  flipCam: () => void;
  toggleSpeaker: () => void;
  answerVideoAsk: (yes: boolean) => void;
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
    incoming: null, videoAsk: null, tiles: [], localStream: null,
    micOn: true, camOn: false, speakerOn: true,
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
  const livekitEnabled = useRef(false);
  const lkRoom = useRef<Room | null>(null);
  const lkPendingToken = useRef<{ roomId: string; token: string; url: string } | null>(null);
  const lkStreams = useRef<Map<string, MediaStream>>(new Map()); // identity → wrapped video
  const videoApproved = useRef(false);
  const callAnswered = useRef(false);
  const established = useRef(false);
  const dialTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const failT = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lkWatchdog = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lkTries = useRef(0);
  const ringTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inCall = useRef(false);

  const clearTimer = (r: React.MutableRefObject<ReturnType<typeof setTimeout> | null>) => {
    if (r.current) { clearTimeout(r.current); r.current = null; }
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
    const room = lkRoom.current;
    if (room) {
      room.remoteParticipants.forEach(rp => {
        let track: unknown | null = null;
        rp.videoTrackPublications.forEach(pub => { if (pub.track && !track) track = pub.track; });
        let stream: MediaStream | null = null;
        if (track) {
          // Wrap the SFU video track in a stable MediaStream (cached per
          // identity — RTCView keys off the stream URL).
          const cached = lkStreams.current.get(rp.identity);
          const mst = (track as { mediaStreamTrack: unknown }).mediaStreamTrack;
          if (cached && (cached.getVideoTracks()[0] as unknown) === mst) {
            stream = cached;
          } else {
            const ms = new MediaStream(undefined as never);
            (ms as unknown as { addTrack: (t: unknown) => void }).addTrack(mst);
            lkStreams.current.set(rp.identity, ms);
            stream = ms;
          }
        } else {
          lkStreams.current.delete(rp.identity);
        }
        tiles.push({ key: rp.identity, name: rp.name || rp.identity, stream, hasVideo: !!track });
      });
    }
    patch({ tiles });
  };

  const markEstablished = useCallback(() => {
    if (established.current) return;
    established.current = true;
    clearTimer(dialTimeout);
    clearTimer(lkWatchdog);
    patch({ status: "live", phase: "in-call" });
    // Native call audio: communication mode + speaker default ON (v2.84).
    InCallManager.start({ media: st.current.isVideoCall ? "video" : "audio" });
    InCallManager.setSpeakerphoneOn(st.current.speakerOn);
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
    const pc = new RTCPeerConnection({ iceServers: iceServers.current as never });
    const stream = new MediaStream(undefined as never);
    const peer: Peer = { pc, stream, name, pendingCandidates: [], hasRemoteDesc: false, initiator };
    peers.current.set(pin, peer);
    const ls = localStream.current;
    if (ls) ls.getTracks().forEach(t => pc.addTrack(t, ls));
    // v2.80 m-line discipline: a camera-less INITIATOR still negotiates a
    // sendrecv video m-line, so a later consent upgrade needs only
    // replaceTrack (no renegotiation, no glare) and the peer's camera has an
    // inbound slot from day one.
    if (initiator && !(ls && ls.getVideoTracks().length > 0)) {
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
    publishTiles();
    // 1:1 auto-end (v2.81): the other party left — end rather than sit alone.
    if (inCall.current && peers.current.size === 0 && !lkRoom.current) {
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

  // ── LiveKit SFU ──
  const armLkWatchdog = () => {
    clearTimer(lkWatchdog);
    lkTries.current = 0;
    const tick = () => {
      lkWatchdog.current = null;
      if (!inCall.current || !livekitEnabled.current || established.current) return;
      const room = lkRoom.current as unknown as { state?: string } | null;
      if (room && room.state === "connected") { lkWatchdog.current = setTimeout(tick, 4000); return; }
      if (!callAnswered.current) {
        // Still ringing — keep the token fresh forever; the ring timers govern.
        void sig.current?.send({ type: "refresh-livekit" });
        lkWatchdog.current = setTimeout(tick, 4000);
        return;
      }
      lkTries.current++;
      if (lkTries.current > 3) {
        hangupInternal("livekit-join-timeout");
        return;
      }
      void sig.current?.send({ type: "refresh-livekit" });
      lkWatchdog.current = setTimeout(tick, 4000);
    };
    lkWatchdog.current = setTimeout(tick, 4500);
  };

  const joinLivekit = async (rid: string) => {
    const tok = lkPendingToken.current;
    if (lkRoom.current || !tok || tok.roomId !== rid) return;
    // Consume the token — a failed connect must retry with a FRESH one
    // (they're short-TTL), which the watchdog's refresh-livekit provides.
    lkPendingToken.current = null;
    const room = new Room();
    lkRoom.current = room;
    room.on(RoomEvent.TrackSubscribed, () => { publishTiles(); markEstablished(); });
    room.on(RoomEvent.TrackUnsubscribed, publishTiles);
    room.on(RoomEvent.ParticipantConnected, publishTiles);
    room.on(RoomEvent.ParticipantDisconnected, () => {
      publishTiles();
      if (inCall.current && room.remoteParticipants.size === 0 && established.current) {
        hangupInternal("remote-left");
      }
    });
    room.on(RoomEvent.Disconnected, () => {
      if (lkRoom.current !== room || !inCall.current) return;
      if (!established.current) {
        // Pre-establishment SFU blip: retry via a fresh token (v2.83 parity).
        lkRoom.current = null;
        void sig.current?.send({ type: "refresh-livekit" });
        return;
      }
      hangupInternal("livekit-disconnected");
    });
    try {
      await AudioSession.startAudioSession();
      await room.connect(tok.url, tok.token);
      await room.localParticipant.setMicrophoneEnabled(st.current.micOn);
      if (videoApproved.current && st.current.camOn) {
        await room.localParticipant.setCameraEnabled(true);
      }
      publishTiles();
    } catch {
      if (lkRoom.current === room) lkRoom.current = null; // watchdogless M3: next token retries
    }
  };

  // ── protocol ──
  const handleMessage = useCallback((m: Msg) => {
    switch (m.type) {
      case "registered":
        livekitEnabled.current = !!m.livekit;
        if (m.iceServers?.length) iceServers.current = m.iceServers;
        break;
      case "room":
        roomId.current = m.roomId ?? null;
        break;
      case "ringing":
        if (inCall.current && !callAnswered.current) {
          patch({ status: m.paging ? "paging" : "ringing", peerName: m.name || st.current.peerName });
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
          if (m.roomId === roomId.current || m.from === st.current.peerPin) return;
          void sig.current?.send({ type: "reject", to: m.from }); // call waiting = M3.5
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
        break;
      case "joined": {
        roomId.current = m.roomId ?? roomId.current;
        if (m.iceServers?.length) iceServers.current = m.iceServers;
        livekitEnabled.current = !!m.livekit;
        callAnswered.current = true;
        patch({ status: "connecting" });
        if (!livekitEnabled.current) {
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
        if (!livekitEnabled.current && m.pin) {
          // Existing member: the newcomer offers — just prepare the pc.
          createPeer(m.pin, m.name || m.pin, false);
        }
        break;
      }
      case "peer-left":
        if (m.pin) removePeer(m.pin);
        break;
      case "livekit-token":
        if (m.roomId && m.token) {
          lkPendingToken.current = { roomId: m.roomId, token: m.token, url: m.url || "" };
          if (livekitEnabled.current && roomId.current === m.roomId && !lkRoom.current) void joinLivekit(m.roomId);
        }
        break;
      case "signal":
        if (m.from) void onSignal(m.from, m.data);
        break;
      case "rejected":
        if (inCall.current && !established.current) failDial("They declined.");
        break;
      case "busy":
        if (inCall.current && !established.current) failDial("They're on another call.");
        break;
      case "kicked":
        hangupInternal("kicked");
        break;
      case "rejoin":
        // Rejoin-after-restart is M3.5; ignoring the offer would leave the
        // SERVER thinking we're still in the old room (ghost membership that
        // pollutes the next dial). Decline it explicitly.
        if (!inCall.current) void sig.current?.send({ type: "leave", reason: "rejoin-declined" });
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
        const fatal = m.code === "offline" || m.code === "self" || m.code === "gone";
        if (fatal && inCall.current && !established.current) failDial(m.message || "They're unreachable right now.");
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
    const room = lkRoom.current;
    lkRoom.current = null;
    lkPendingToken.current = null;
    lkStreams.current.clear();
    if (room) { void room.disconnect().catch(() => {}); }
    void AudioSession.stopAudioSession();
    const ls = localStream.current;
    localStream.current = null;
    if (ls) ls.getTracks().forEach(t => { try { t.stop(); } catch { /* */ } });
    try { InCallManager.stop(); } catch { /* */ }
  };

  const hangupInternal = (reason: string) => {
    void sig.current?.send({ type: "leave", reason });
    stopRing();
    clearTimer(dialTimeout);
    clearTimer(failT);
    clearTimer(lkWatchdog);
    inCall.current = false;
    callAnswered.current = false;
    established.current = false;
    videoApproved.current = false;
    roomId.current = null;
    cleanupMedia();
    setState(s => ({
      ...s, phase: "idle", status: "calling", peerName: "", peerPin: "",
      incoming: null, videoAsk: null, tiles: [], localStream: null, camOn: false, micOn: true,
    }));
  };

  const declineIncomingInternal = () => {
    const r = st.current.incoming;
    stopRing();
    patch({ incoming: null, phase: "idle" });
    if (r) void sig.current?.send({ type: "reject", to: r.from });
  };

  const enableCamera = async () => {
    try {
      await ensureMedia(true);
      patch({ camOn: true });
      const room = lkRoom.current;
      if (room) await room.localParticipant.setCameraEnabled(true);
      else {
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
    s.register(me.displayName, me.number);
    const appSub = AppState.addEventListener("change", stt => {
      if (stt === "active") s.ensureConnected();
    });
    return () => { appSub.remove(); s.destroy(); sig.current = null; };
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
      patch({
        phase: "dialing", status: "calling", peerPin: number,
        peerName: opts?.displayName ?? "", isVideoCall: video, camOn: false,
      });
      void (async () => {
        try { await ensureMedia(false); } catch { hangupInternal("no-media"); return; }
        void sig.current?.send({ type: "invite", to: number, video });
        armLkWatchdog(); // SFU deployments: keep the join token fresh while ringing
        clearTimer(dialTimeout);
        dialTimeout.current = setTimeout(() => {
          if (inCall.current && !callAnswered.current) failDial("No answer — they'll see your missed call.");
        }, 65_000);
      })();
    },
    acceptIncoming: (opts) => {
      const r = st.current.incoming;
      if (!r) return;
      stopRing();
      const answerVideo = r.video && !opts?.voice;
      videoApproved.current = answerVideo; // Video answer = the consent (v2.81)
      inCall.current = true;
      callAnswered.current = true;
      patch({
        incoming: null, phase: "in-call", status: "connecting",
        peerName: r.fromName, peerPin: r.from, isVideoCall: r.video, camOn: answerVideo,
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
        armLkWatchdog(); // callee-side backstop: media must come up or the call ends honestly
        if (r.video) void sig.current?.send({ type: answerVideo ? "video-accept" : "video-decline" });
      })();
    },
    declineIncoming: declineIncomingInternal,
    hangup: () => hangupInternal("user-hangup"),
    toggleMic: () => {
      const next = !st.current.micOn;
      localStream.current?.getAudioTracks().forEach(t => { t.enabled = next; });
      void lkRoom.current?.localParticipant.setMicrophoneEnabled(next);
      patch({ micOn: next });
    },
    toggleCam: () => {
      if (st.current.camOn) {
        localStream.current?.getVideoTracks().forEach(t => { t.enabled = false; });
        void lkRoom.current?.localParticipant.setCameraEnabled(false);
        patch({ camOn: false });
        return;
      }
      if (videoApproved.current) { void enableCamera(); return; }
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
    },
    answerVideoAsk: (yes) => {
      patch({ videoAsk: null });
      void sig.current?.send({ type: yes ? "video-accept" : "video-decline" });
      if (yes) { videoApproved.current = true; void enableCamera(); }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [state, ready]);

  return <CallContext.Provider value={api}>{children}</CallContext.Provider>;
}
