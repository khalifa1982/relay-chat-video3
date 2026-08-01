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
import { capPinInput, pinDigits } from "@/app/pinInput";
import { isDndOn } from "@/app/dnd";
import { notify } from "@/app/notifications";
import { RINGTONE_NOTES, RINGTONE_LOOP_MS, RINGTONE_PEAK_GAIN, RINGTONE_WAVE } from "@shared/ringtone";
import { isNativeAndroid, nativeSetSpeaker, nativeSetInCall } from "./nativeBridge";
import { DEVICE_ID_HEADER, getDeviceId } from "./deviceId";
import { describePeerPresence, formatElapsedSince } from "@shared/profileFields";
import { describeProfileStatus } from "@shared/profileStatus";

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
  /** This peer's remote audio, on its OWN <audio> element (v2.106.51).
   *  It must never ride the tile's <video>: a <video> cannot begin playback
   *  until its video track delivers a frame, so on a call where no camera is
   *  transmitting the element parks at readyState 0 and the audio attached
   *  beside it is never played out. See attachRemote for the measurement. */
  audioEl?: HTMLAudioElement | null;
  /** The full remote stream as accumulated from every ontrack for this peer
   *  (audio + video). The msid-less merge path needs an accumulator, and it
   *  used to read one back off the tile <video>'s srcObject — which stops
   *  being the whole picture once audio lives on its own element. */
  remoteStream?: MediaStream | null;
}
interface PendingRing { from: string; fromName: string; roomId: string; flag?: string; video?: boolean; at?: number; }
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
  // Host moderation / roles. (`on`/`by` are shared with the peer-hold message
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
  token?: string;
  url?: string;
  /** invite/ring: the caller dialed this as a VIDEO call (mutual-consent flow). */
  video?: boolean;
  /** ringing ack (LEGACY, v2.83–v2.99.10): the callee had no live connection so
   *  the server was PAGING them. Retired in v2.99.11 — an offline callee now
   *  gets error{offline} instead of a paging ack. Field kept for wire-compat
   *  with a mid-rollout old server; never read. */
  paging?: boolean;
  /** room/joined (v2.89): the dialed number was a PARTY LINE — the server
   *  dropped us straight into its persistent room instead of ringing anyone. */
  partyLine?: boolean;
  /** joined (party line): the line's display title. */
  lineTitle?: string;
  /** room/joined/rejoin/resumed/merged (Round 11 B): a server-minted capability
   *  proving WE were admitted to this room. Presented back on `rejoin-recreate`
   *  when the server has lost the room, so recovery is authorized by the
   *  server's own signature rather than by anything we claim about ourselves. */
  cap?: string;
  /** rejoin: the room did not exist and was rebuilt from capabilities. */
  recreated?: boolean;
  on?: boolean;
  by?: string;
  /** ring-cancel (v2.99.5, multi-device): why the ring ended on THIS device —
   *  "answered"/"declined" happened on ANOTHER of the user's devices. Absent on
   *  a caller's own cancel (old servers / caller hung up). */
  reason?: string;
  /** knock (v2.99.9): the pin/name of someone requesting to rejoin a live call
   *  (delivered to the host), and the result of our own knock. */
  fromPin?: string;
  ok?: boolean;
}

export type RelayPhase = "idle" | "dialing" | "ringing" | "in-call";

export interface RelayHandle {
  destroy: () => void;
  /** Programmatic dial. Returns true if the engine accepted the request.
   *  `opts.voice` starts the call with the camera off (a voice call — video
   *  stays disabled until the user explicitly enables it in-call; omitting it
   *  is a "Dial by Video": the session connects with the camera already live).
   *  `opts.displayName` labels the dial-progress card with the callee's name. */
  dial: (number: string, opts?: { voice?: boolean; displayName?: string }) => boolean;
  /** Start a GROUP call — ring up to `maxParticipants()` numbers into one room.
   *  Returns true if at least one valid number was accepted. */
  dialGroup: (numbers: string[], opts?: { voice?: boolean }) => boolean;
  /** Max participants the ACTIVE transport supports: 10 on the SFU, 6 on the
   *  mesh. Lets the group-call picker cap selection to what can actually
   *  connect (over-selecting strands the overflow in a full-room accept). */
  maxParticipants: () => number;
  /** Set/replace the engine-state callback. Fired whenever phase changes. */
  setOnStateChange: (cb: ((phase: RelayPhase) => void) | null) => void;
  /** Read-only snapshot of the CURRENT call roster (pin + name per remote
   *  peer, both transports) — powers the host's in-call "save to contacts"
   *  chip (v2.96). Empty outside a call. */
  getRoster: () => Array<{ pin: string; name: string }>;
  /** Best-effort: cancel an in-flight call/leave the room. */
  hangup: () => void;
  /** The 6-digit number the SIGNALING server actually registered for this
   *  device. This is the ONLY number a peer can dial successfully. Returns
   *  null until the first `registered` message arrives. */
  getPin: () => string | null;
  /** Subscribe to authoritative pin changes (fires on every `registered`). */
  setOnPinChange: (cb: ((pin: string | null) => void) | null) => void;
  /** Wire the incoming-ring "quick reply" to the host's messaging stack:
   *  called with (callerPin, text) when the callee picks a canned response
   *  (the engine then declines the ring). */
  setOnQuickReply: (cb: ((toPin: string, text: string) => void) | null) => void;
  /** Voicemail hook (v2.88): fired when a 1:1 OUTGOING dial dies unconnected
   *  (no-answer / declined / offline) so the host can offer to record a voice
   *  message for the callee (delivered as a chat audio message). */
  setOnDialFailed: (
    cb: ((info: { pin: string; name: string | null; reason: string }) => void) | null
  ) => void;
  /** Numbers whose incoming calls are silently declined (per-contact block).
   *  Replace-style: pass the full current list each time. */
  setBlockedPins: (pins: string[]) => void;
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
  /** In-page minimize (v2.99.8): when the React host shrinks the engine to a
   *  small floating box, force the compact 2-up layout deterministically (the
   *  ResizeObserver is a fallback). */
  setMinimized: (on: boolean) => void;
  /** Numbers the user has ALREADY saved as contacts (v2.99.8). Drives the
   *  per-tile "add to contacts" mark: a peer NOT in this set shows the mark;
   *  saving removes it. Replace-style — pass the full current list each time. */
  setSavedContacts: (pins: string[]) => void;
  /** Wire the per-tile "add to contacts" mark to the host's contacts stack:
   *  called with (pin, name) when the user taps a peer's add mark in-call. */
  setOnSaveContact: (cb: ((pin: string, name: string) => void) | null) => void;
  /** Live-call rejoin (v2.99.9): ask to rejoin the live call `number` is in
   *  (History "Join"). The server verifies we were previously in that room and
   *  asks the host to approve. */
  knock: (number: string) => void;
  /** Host-side: approve / deny a pending knock for our call. */
  approveKnock: (roomId: string, pin: string) => void;
  denyKnock: (roomId: string, pin: string) => void;
  /** Host-side callback: someone who was in this call wants back in — surface a
   *  prompt. Called with (pin, name, roomId). */
  setOnKnock: (cb: ((pin: string, name: string, roomId: string) => void) | null) => void;
}

/**
 * What to do with an incoming `signal` frame, given which room it came from.
 *
 * v2.99.57. The server's S2 gate relays a signal when the sender shares EITHER
 * the receiver's active room OR a held one, and it is evaluated from the
 * SENDER's side. Until the frame carried `roomId`, the receiver could not tell
 * those apart — so a peer whose call the receiver had PARKED could hand-craft a
 * signal, land in `onSignal` with no matching `peers[from]`, and have a peer
 * built around the receiver's CURRENTLY live stream: the mic (and, because
 * `createPeer` flips `callIsGroup` when another peer exists, the camera) from a
 * different, private call. That is a full bypass of the mutual-consent protocol.
 *
 * Pure and exported so the decision is unit-testable without a WebRTC stack.
 *
 *  - "current"  → handle normally (this is our live call).
 *  - "held"     → route to an EXISTING held peer only; never build a new one,
 *                 and never touch the live stream.
 *  - "drop"     → a room we are not in, or a held room we have no peer for.
 *
 * Deliberately does NOT second-guess the CURRENT-room case with a member-list
 * check. The server already established that the sender shares our active room
 * before relaying, and adding a client-side roster gate there would refuse
 * legitimate mesh offers that arrive before the `room`/`peer-joined` ack — the
 * exact class of regression this repo has shipped before. The vulnerability was
 * only ever the held room being indistinguishable from the active one.
 */
export function signalDisposition(s: {
  frameRoom?: string | null;
  roomId: string | null;
  heldRoomId: string | null;
  hasHeldPeer: boolean;
}): "current" | "held" | "drop" {
  // A frame with NO room means an older server (or a direct unit-test call).
  // Fail OPEN: refusing every unstamped frame would tear down every in-flight
  // call on the deploy that introduces this.
  if (!s.frameRoom) return "current";
  if (s.roomId && s.frameRoom === s.roomId) return "current";
  if (s.heldRoomId && s.frameRoom === s.heldRoomId) return s.hasHeldPeer ? "held" : "drop";
  return "drop";
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
  /** How long to wait for the server's own `rejoin` before assuming it has lost
   *  the room. Register → rejoin is one round trip on the same SSE stream, so
   *  this only ever elapses when the room is genuinely gone. */
  const RECREATE_DELAY_MS = 1500;
  function armRecreate(target: { roomId: string; cap: string }) {
    recreateTarget = target;
    if (recreateT) clearTimeout(recreateT);
    recreateT = setTimeout(() => {
      recreateT = null;
      const t = recreateTarget;
      recreateTarget = null;
      if (!t) return;
      diag("rejoin-recreate " + t.roomId);
      sendWS({ type: "rejoin-recreate", roomId: t.roomId, cap: t.cap });
    }, RECREATE_DELAY_MS);
  }
  function cancelRecreate() {
    recreateTarget = null;
    if (recreateT) { clearTimeout(recreateT); recreateT = null; }
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
  let inCall = false;
  let roomId: string | null = null;
  // Round 11 B: the capability for `roomId`, kept alongside it and refreshed by
  // every room ack. Never generated locally — an unsigned value is worth nothing.
  let roomCap: string | null = null;
  // Round 11 B: a pending "the server seems to have forgotten this call" repair.
  // ARMED rather than sent immediately, because the ordinary register→rejoin
  // handshake usually wins — and when it does there is nothing to repair.
  let recreateTarget: { roomId: string; cap: string } | null = null;
  let recreateT: ReturnType<typeof setTimeout> | null = null;
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
  /**
   * Invitees of an UNANSWERED group dial who haven't resolved yet (v2.99.44,
   * closing the L1 follow-up deferred in v2.99.27).
   *
   * A decline is deliberately not fatal to a group dial — `inParkedCall()` is
   * true for one, so two of three people declining must leave the third still
   * ringing. But nothing was watching for the LAST one: when everybody declined,
   * the caller sat on "Ringing…" until the 65s no-answer backstop, with nobody
   * left to answer. This set is the missing bookkeeping — non-null ONLY while a
   * group dial is outstanding and unanswered, so it can never affect an
   * established call or an add-person invite.
   */
  let groupDialOutstanding: Set<string> | null = null;
  /** Drop one invitee; when the last one resolves with nobody having answered,
   *  end the dial honestly instead of waiting out the backstop. */
  function groupInviteeResolved(pin: string | undefined, why: string): void {
    if (!groupDialOutstanding || !pin) return;
    groupDialOutstanding.delete(pin);
    if (groupDialOutstanding.size > 0) return;
    groupDialOutstanding = null;
    // Only when this really is still an unanswered dial with nobody on it.
    if (inCall && outgoingDial && !establishedOnce && aloneInCall()) failDial(why, "group-dial-exhausted");
  }
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
  const audioOutSupported = typeof HTMLMediaElement !== "undefined"
    && typeof (HTMLMediaElement.prototype as unknown as { setSinkId?: unknown }).setSinkId === "function";
  // ---------- active-speaker / spotlight view (v2.35) ----------
  let spotlightId: string | null = null;     // tile id manually pinned big, or null
  let manualSpotlight = false;               // user clicked a tile to pin it
  // Screen-share MAXIMIZE (v2.99.8): full-bleed the shared screen (hide the
  // thumb filmstrip) vs. the normal spotlight-with-thumbs.
  let screenMaximized = false;
  // Per-tile "add to contacts" mark (v2.99.8): the pins the user has ALREADY
  // saved (pushed from React via setSavedContacts); a peer NOT in this set gets
  // an add mark under their name. `onSaveContact` bridges the tap to React.
  let savedContactPins = new Set<string>();
  let onSaveContact: ((pin: string, name: string) => void) | null = null;
  // Live-call rejoin (v2.99.9): host-side "someone wants to rejoin" callback.
  let onKnock2: ((pin: string, name: string, roomId: string) => void) | null = null;
  let activeSpeakerId: string | null = null; // tile id of the loudest speaker (auto)
  let speakerOrder: string[] = [];           // tile ids, most-recently-loud first
  let speakerCandidate: string | null = null; // pending new leader (hysteresis)
  let speakerCandidateCount = 0;             // consecutive samples it has led
  const screenShareIds = new Set<string>();  // tile ids currently sharing a screen
  let compactView = false;                   // call container is "minimized" (small)
  let callResizeObs: ResizeObserver | null = null;
  // Active-speaker detection via Web Audio, on the REMOTE streams. Lazily
  // created on the first one.
  let meshAudioCtx: AudioContext | null = null;
  const meshAnalysers: Record<string, { node: AnalyserNode; src: MediaStreamAudioSourceNode; data: Uint8Array<ArrayBuffer> }> = {};
  let speakerSampleT: ReturnType<typeof setInterval> | null = null;
  // THE PARTY CAP. The mesh runs N-1 encoders and N-1 decoders on every phone, which
  // v2.99.84 measured as the single biggest lever on call CPU and heat, so 6 is a
  // measurement rather than a preference.
  //
  // ONE definition, and it is still a function rather than a bare constant: three copies
  // of the old `sfuEnabled ? 10 : 6` had to be consolidated once already, and every
  // reader — the group picker, the invite guard, `maxParticipants()` — must agree with
  // the number the user was shown when they chose who to call. A party built past the
  // cap half-connects and reads as our bug.
  const MESH_MAX = 6;
  function transportMax(): number { return MESH_MAX; }
  // Has ANYONE joined this call yet? False while an outgoing dial is still RINGING.
  // Set by acceptInvite/createPeer (any evidence a second party is in the call);
  // reset by hangUp. It exists because a media-establishment timer must never tear
  // down a call nobody has answered yet — a caller whose media was slow used to have
  // every outgoing call die a few seconds into the ring.
  let callAnswered = false;
  // ── mutual-consent video (1:1 protocol) ──────────────────────────────────
  // Video transmits ONLY once BOTH parties have agreed, per call:
  //   • a VIDEO dial: the callee answering with the Video button is the
  //     consent (they reply `video-accept`); answering Voice replies
  //     `video-decline` and the call stays voice-only.
  //   • mid-call upgrade: tapping the camera in an unapproved 1:1 call sends
  //     `video-request` — the other side gets an in-call prompt; accepting
  //     turns BOTH cameras on. Declining keeps voice-only.
  // Once approved, camera toggles are free for the rest of the call (turning
  // video OFF never needs consent). Group calls (3+) bypass the gate.
  let videoApproved = false;
  let callIsGroup = false;
  let videoReqT: ReturnType<typeof setTimeout> | null = null; // our outstanding request
  function clearVideoReq() { if (videoReqT) { clearTimeout(videoReqT); videoReqT = null; } }
  /**
   * SECURITY (M37): did WE offer video on this call? `video-accept` may only turn
   * our camera on when we did.
   *
   * `onVideoAccept` used to check nothing but `inCall`, so an UNSOLICITED
   * `video-accept` frame from any call peer ran `unlockApprovedVideo()` and
   * forced the recipient's camera on mid-voice-call — a complete bypass of the
   * v2.81 mutual-consent protocol, whose entire promise is that a camera only
   * transmits after BOTH sides agree. The victim got a cheerful "Video is on —
   * both sides 🎥" toast as their only notice. On a party line (joinable by
   * number) one frame could do it to every participant at once.
   *
   * `videoReqT` alone is not a sufficient guard: there are TWO legitimate ways
   * to receive `video-accept`, and only one of them involves an outstanding
   * request. A VIDEO DIAL answered with the Video button also replies
   * `video-accept` (see the answer path), and there the caller's consent was
   * given implicitly by dialing with video — no `video-request` was ever sent.
   * `outgoingDial` can't stand in for it either, since it is cleared at
   * establishment while a consent frame often arrives before the transport even
   * exists. Hence this dedicated flag, set at BOTH consent points.
   *
   * ── SELF-REVIEW (v2.99.47): THE FIRST VERSION WAS A PLAIN BOOLEAN, AND THAT
   * LEFT THE BYPASS OPEN ── it was cleared only in `hangUp`, but a call can be
   * left WITHOUT hanging up: `switchCall` abandons an unanswered outgoing dial
   * with a bare `leave` and joins the incoming room, and `parkActiveAsHeld`
   * moves the active call to hold. So: victim taps Video call → flag set →
   * attacker dials → victim taps "End call & answer" → the flag survives into
   * the ATTACKER's call → one `video-accept` frame turns the victim's camera on.
   * Exactly the forced-hot-camera outcome M37 existed to close.
   *
   * Fixed by keying the offer to the ROOM it was made for instead of to a
   * lifecycle hook. A flag set for one call cannot authorize another, so the
   * guarantee no longer depends on remembering to clear it at every exit — new
   * call-switch paths added later are safe by construction. Until the room is
   * known (an outgoing dial offers video before the server names the room) it
   * is PENDING: the `room` ack — the server's reply to OUR OWN invite, and the
   * only place a room is provably the one our dial created — binds it to the real
   * id. Joining any OTHER room (accepting an incoming ring, switching, resuming)
   * never binds, so the offer stays unbound and authorizes nothing.
   */
  let videoOfferPending = false;          // we offered; the room isn't named yet
  let videoOfferedForRoom: string | null = null;  // …and now it is
  /** Our own dial's room is now known — an offer made for it becomes bound. */
  function bindVideoOfferToRoom(rid: string | null) {
    if (videoOfferPending) { videoOfferedForRoom = rid; videoOfferPending = false; }
  }
  /**
   * Consent is strictly per-call. Called wherever the active call CHANGES
   * without a hangUp — switch-to-incoming, park-as-held, swap — so neither our
   * offer nor an earlier approval can leak into the next conversation.
   * (`videoApproved` leaking mattered on its own: it disables the gate, so a
   * still-live camera would publish to the new peer with no agreement.)
   */
  function resetVideoConsent() {
    videoApproved = false;
    videoOfferedForRoom = null;
    videoOfferPending = false;
    clearVideoReq();
  }
  function videoGateActive(): boolean {
    return inCall && !videoApproved && !callIsGroup;
  }
  // Actually start transmitting video AFTER approval (both media paths). The
  // local camera may already be live (video dial) — publication was gated —
  // and the mesh senders may be the null slots from the gated createPeer, so
  // ALWAYS push the track into every transport here.
  function unlockApprovedVideo() {
    videoApproved = true;
    clearVideoReq();
    if (!camOn) setCam(true); // flips enabled + self tile
    const t = currentCameraVideoTrack();
    if (t) void replaceVideoEverywhere(t).then(() => syncCamEnabled());
  }
  // Consent can arrive BEFORE the transport exists (the callee's video-accept
  // often beats peer-joined/ICE). Re-assert "approved video is actually
  // flowing" whenever a connection settles — fills any mesh sender that was
  // negotiated as a null slot pre-consent.
  function ensureApprovedVideoFlowing() {
    if (!inCall || !camOn || !(videoApproved || callIsGroup) || screenSharing) return;
    const t = currentCameraVideoTrack();
    if (!t) return;
    const someoneMissingOurVideo = Object.values(peers).some(
      p => !p.pc.getSenders().some(s => s.track && s.track.kind === "video")
    );
    if (someoneMissingOurVideo) void replaceVideoEverywhere(t).then(() => syncCamEnabled());
  }
  function requestVideoUpgrade() {
    if (videoReqT) { toast("Video request already sent — waiting for them…"); return; }
    // M37: we asked, so a matching accept is legitimate — bound to THIS room.
    // (Mid-call, the room is always already known.)
    if (roomId) videoOfferedForRoom = roomId; else videoOfferPending = true;
    sendWS({ type: "video-request" });
    toast("Video request sent — their camera prompt is up. Video starts when they accept.");
    videoReqT = setTimeout(() => {
      videoReqT = null;
      toast("No response to your video request — the call stays voice-only for now.", true);
    }, 30_000);
  }
  function onVideoRequest(m: Msg) {
    if (!inCall) return;
    const nm = $("vaName"); if (nm) nm.textContent = m.fromName || nameOf(m.from || "") || "They";
    $("videoAsk")?.classList.add("show");
  }
  function onVideoAccept() {
    if (!inCall) return;
    // M37: only honor an accept that answers OUR offer (a mid-call
    // `video-request`, or a video dial we placed) IN THIS CALL. An unsolicited
    // one — or one that answers an offer made in a call we have since left — is
    // a peer trying to switch our camera on without consent; drop it silently
    // rather than toasting, so the frame reveals nothing about whether it landed.
    // Room equality is the WHOLE guard: an offer whose room was never bound (an
    // abandoned dial) authorizes nothing. Fail-closed by construction — if a
    // future path forgets to bind, video simply doesn't auto-enable and a camera
    // tap re-offers it.
    if (videoOfferedForRoom === null || videoOfferedForRoom !== roomId) return;
    unlockApprovedVideo();
    toast("Video is on — both sides. 🎥");
  }
  function onVideoDecline() {
    if (!inCall) return;
    clearVideoReq();
    // A declined VIDEO DIAL: our camera was locally live (preview) but never
    // transmitted — drop to a clean voice call.
    if (camOn) setCam(false);
    toast("They kept the call voice-only. You can send a video request anytime.");
  }
  function hideVideoAsk() { $("videoAsk")?.classList.remove("show"); }
  // OUTGOING dial in progress (caller side). Non-null from the moment we send
  // the invite until the call is ESTABLISHED (markEstablished) or torn down.
  // Drives the staged call-progress flow the phone expects:
  //   "Calling…"  — invite sent (immediately after PIN entry)
  //   "Ringing…"  — server acked that the callee's device is actually alerting
  //   "Connecting…" — callee answered; media/session being established
  //   connected   — full in-call interface appears (and only then)
  // While set, #call carries .pre-connect: a dedicated dial card (avatar,
  // number, voice/video chip, live status) replaces the grid, and every
  // control except End Call is hidden.
  let outgoingDial: { pin: string; name?: string; video: boolean; group?: boolean } | null = null;
  // No-answer backstop for OUTGOING dials. The callee's client auto-declines
  // at 60s, which normally ends the dial via `rejected` — but if their device
  // died mid-ring (tab killed, network gone) that reply never comes, and the
  // caller used to ring forever in a solo room that the server kept alive
  // (and auto-rejoin could resurrect). Armed at dial, cleared on answer /
  // teardown.
  let dialTimeoutT: ReturnType<typeof setTimeout> | null = null;
  /**
   * THE POST-ANSWER ESTABLISHMENT DEADLINE, and the hole it fills.
   *
   * Once the callee ANSWERS, nothing bounded how long the caller could sit on
   * "Securing connection…" — two independent mechanisms guaranteed it:
   *
   * `onCalleeAnswered()` calls `clearDialTimeout()`, cancelling the 65s no-answer
   * backstop outright; and even if it did not, that callback early-returns on
   * `callAnswered`, so it would decline to fire anyway.
   *
   * So the state "we are in the room, they answered, and no remote media ever
   * arrived" had no timer, no error and no way out but the End button. That is
   * exactly the owner's report: 00:17 on "Securing connection…", callee shown
   * online, previous attempt recorded as "no answer".
   *
   * This bounds it. Armed where the dial timeout is CANCELLED, so the coverage
   * is continuous rather than leaving a gap between the two; cleared the moment
   * media is real.
   *
   * IT ONLY EVER ENDS A CALL THAT ALREADY CANNOT WORK — it never stops a dial
   * being placed, so it does not violate the fail-open rule this file follows on
   * the call path. And 20s is deliberately generous: the SFU family gives up on
   * a room CONNECTION after ~16.5s (4.5s + 3x4s), a legitimately slow publish +
   * subscribe on a poor mobile network is seconds, and an UNANSWERED dial still
   * gets its full 65s. A call that comes up at 19s is untouched.
   */
  const MEDIA_ESTABLISH_MS = 20_000;
  let establishT: ReturnType<typeof setTimeout> | null = null;
  function clearEstablishDeadline() {
    if (establishT) { clearTimeout(establishT); establishT = null; }
  }
  function armEstablishDeadline() {
    clearEstablishDeadline();
    establishT = setTimeout(() => {
      establishT = null;
      // Re-check rather than trust the arm: a call that established, ended, or
      // was never a dial must not be failed by a timer armed 20s ago.
      if (!inCall || establishedOnce || !outgoingDial) return;
      diag("establish deadline: answered but no media after " + MEDIA_ESTABLISH_MS + "ms");
      /* THE REASON MUST NOT BE "no-answer". They DID answer — recording it as no
         answer would write a false history row and would offer to "leave a voice
         message", which is the wrong offer for somebody who picked up. This reason
         is deliberately absent from failDial's voicemail-eligible set. */
      failDial("Couldn't connect the audio — they answered but no sound came through.", "media-timeout");
    }, MEDIA_ESTABLISH_MS);
  }
  function clearDialTimeout() {
    if (dialTimeoutT) { clearTimeout(dialTimeoutT); dialTimeoutT = null; }
  }
  function armDialTimeout() {
    clearDialTimeout();
    dialTimeoutT = setTimeout(() => {
      dialTimeoutT = null;
      if (!inCall || callAnswered) return;
      toast("No answer.", true);
      failDial("No answer — they'll see your missed call.", "no-answer");
    }, 65_000);
  }
  /* ── who you are dialling (v2.105.24) ──────────────────────────────────────
   * Owner, from a screenshot of this screen mid-ring: *"when I'm dialing out why there is
   * no image of his profile it's showing, is the status, my last call when it was, add
   * some information."*
   *
   * Until now this card could not show a photo AT ALL — its markup had no image element,
   * only a text disc — so the grey initials were the only thing it could ever display.
   * The incoming ring card gained a real photo in v2.97.0; this one never did.
   *
   * ONE FETCH PER DIAL, FROM ONE FUNNEL. `showDialCard` is the single place all three dial
   * paths converge (ordinary dial, group dial, in-call add-person), and it also re-runs
   * mid-dial when the `ringing` ack brings the callee's real name — so the work is keyed
   * on the pin CHANGING rather than on the function being called, which is what stops a
   * second fetch and a visible flicker when the name lands.
   * ────────────────────────────────────────────────────────────────────────── */
  /** The pin the card is currently painted for, so a re-paint is distinguishable from a
   *  NEW dial. Cleared in `exitPreConnect`, so re-dialling the same person re-fetches. */
  let dcPin: string | null = null;

  /** A tRPC GET with this browser's device id attached. The engine's other fetches omit
   *  it, which is survivable for the PUBLIC directory lookup but would make an
   *  identity-gated call (the last-call figure) a permanent silent no-op for exactly the
   *  Safari/ITP guests whose guest cookie was dropped — the case that header exists for. */
  function trpcGet(procedure: string, input: unknown): Promise<unknown> {
    const qs = encodeURIComponent(JSON.stringify({ json: input }));
    const headers: Record<string, string> = {};
    const did = getDeviceId();
    if (did) headers[DEVICE_ID_HEADER] = did;
    return fetch(`/api/trpc/${procedure}?input=${qs}`, { credentials: "include", headers })
      .then((r) => (r.ok ? r.json() : null));
  }

  /** superjson wraps a null result as `{json: null}`, so the payload must be unwrapped
   *  `.result.data.json` FIRST. Reading the wrapper on a null (`data?.json ?? data`) yields
   *  a truthy object and reports an unknown number as a resolved user — the exact defect
   *  v2.105.2 shipped and had to correct. */
  function trpcJson<T>(j: unknown): T | null {
    const d = (j as { result?: { data?: { json?: T | null } } } | null)?.result?.data?.json;
    return d ?? null;
  }

  /** Blank every enriched row. Runs when the card starts painting a DIFFERENT pin, so a
   *  photo, status or last-call line can never survive from the person dialled before —
   *  including across a failed dial, whose card stays up for a beat before teardown. */
  function resetDialIdentity() {
    const img = $("dcAvImg") as HTMLImageElement | null;
    if (img) { img.style.display = "none"; img.removeAttribute("src"); img.onload = null; img.onerror = null; }
    const role = $("dcRole"); if (role) { role.style.display = "none"; role.textContent = ""; }
    const pres = $("dcPresence"); if (pres) pres.textContent = "";
    const last = $("dcLast"); if (last) last.textContent = "";
  }

  function enrichDialCard(pin: string) {
    // A group dial's "pin" is a head count, and a 6-digit shape is the only thing the
    // directory can resolve.
    if (!/^\d{6}$/.test(pin)) return;

    trpcGet("directory.lookup", { number: pin })
      .then((j) => {
        // STALENESS, ON THE PIN AS A VALUE. `outgoingDial` is MUTATED in place (the ringing
        // ack writes `.name` onto it), so identity comparison would be wrong in one
        // direction and needlessly strict in the other: re-dialling the same person makes
        // a NEW object for whom this answer is still perfectly correct. Comparing the pin
        // applies the answer exactly when it is about the person on screen.
        if (!outgoingDial || outgoingDial.pin !== pin) return;
        const d = trpcJson<{
          avatarUrl?: string | null; verified?: boolean; role?: string | null;
          isOnline?: boolean; idle?: boolean; inCall?: boolean;
          lastSeenAt?: string | null; presenceHidden?: boolean;
          partyLine?: boolean; memberCount?: number;
          profileStatus?: string | null; statusNote?: string | null;
        }>(j);
        if (!d) return;

        const img = $("dcAvImg") as HTMLImageElement | null;
        const initialsEl = $("dcAv");
        if (d.avatarUrl && img && initialsEl) {
          // Swapped in only once it has DECODED, and re-checked then: a slow photo must
          // never appear over the next person's card. A broken one falls back to the
          // initials rather than the browser's broken-image glyph (the PeerAvatar rule).
          img.onload = () => {
            if (outgoingDial && outgoingDial.pin === pin) img.style.display = "";
          };
          img.onerror = () => { img.style.display = "none"; };
          img.src = d.avatarUrl;
        }

        const role = $("dcRole");
        const tier = d.role === "guest" || d.role === "registered" || d.role === "admin"
          ? d.role
          : d.verified ? "registered" : d.role === null ? null : "guest";
        if (role && tier) {
          const meta = { guest: ["#4c9bff", "Guest"], registered: ["#22c55e", "Registered"], admin: ["#eab308", "Admin"] }[tier];
          role.style.display = "";
          (role as HTMLElement).style.color = meta[0];
          role.textContent = meta[1];
        }

        // THE STATUS THEY CHOSE outranks presence, because it is a statement they made on
        // purpose; presence is the fallback when they have said nothing. Both come from
        // the SHARED formatters, never a local copy — the incoming ring card's inline
        // version predates the v2.101.1 status vocabulary and spells travelling
        // differently, so copying it would have put two spellings in one app.
        const pres = $("dcPresence");
        if (pres) {
          const chosen = describeProfileStatus(d.profileStatus ?? null, d.statusNote ?? null);
          pres.textContent = chosen ?? describePeerPresence({
            isOnline: !!d.isOnline,
            idle: !!d.idle,
            inCall: !!d.inCall,
            lastSeenAt: d.lastSeenAt ?? null,
            presenceHidden: !!d.presenceHidden,
            partyLine: !!d.partyLine,
            memberCount: d.memberCount ?? 0,
          });
        }
      })
      .catch(() => { /* one decorative row — it must never cost anybody a call */ });

    trpcGet("calls.lastWith", { number: pin })
      .then((j) => {
        if (!outgoingDial || outgoingDial.pin !== pin) return;
        const d = trpcJson<{ at?: string | null; answered?: boolean }>(j);
        const at = d?.at ? new Date(d.at) : null;
        const el = $("dcLast");
        // NOTHING, never "first call". A cleared history and the 100-row caps make "no
        // row" a frequent legitimate state, so claiming "never" would be a false
        // statement about the caller's own data.
        if (!el || !at || Number.isNaN(at.getTime())) return;
        const ago = formatElapsedSince(at.getTime(), Date.now());
        // The OUTCOME travels with the time: "2h ago" reads identically about a call they
        // declined and a conversation, and those mean opposite things when you are
        // deciding whether to dial again.
        el.textContent = d?.answered ? `Last spoke ${ago} ago` : `Last tried ${ago} ago · no answer`;
      })
      .catch(() => { /* same — decoration only */ });
  }

  /* Board 3a: the dialled number as MONO TILES that scramble matrix-style and settle onto
   * the real digit with an accent glow.
   *
   * ONLY ON A FRESH DIAL, and that is the whole reason this takes a flag. `showDialCard`
   * re-runs DURING a single dial — the `ringing` ack carries the callee's real name — so a
   * scramble on every call would re-scramble a number that has already settled, one second
   * into the call, which reads as a glitch rather than as an effect. On a repaint the tiles
   * are written straight to their settled state.
   *
   * The timers are tracked and cleared, or leaving the screen mid-scramble leaves an
   * interval writing into detached nodes for the rest of the session.
   */
  let dialScrambleTimers: ReturnType<typeof setTimeout>[] = [];
  function stopDialScramble(): void {
    for (const t of dialScrambleTimers) clearTimeout(t);
    dialScrambleTimers = [];
  }
  function paintDialDigits(text: string, animate: boolean): void {
    const host = $("dcNum");
    if (!host) return;
    stopDialScramble();
    host.textContent = "";
    const chars = text.split("");
    chars.forEach((ch, i) => {
      const cell = document.createElement("span");
      const isDigit = /\d/.test(ch);
      cell.className = isDigit ? "dc-dig" : "dc-dig sep";
      // A separator is never scrambled: it is punctuation, not a digit being resolved.
      if (!animate || !isDigit) {
        cell.textContent = ch;
        if (isDigit) cell.classList.add("set");
      } else {
        cell.textContent = String(Math.floor(Math.random() * 10));
        // Staggered left to right, so the number RESOLVES rather than all landing at once.
        const flicks = 4 + i;
        let n = 0;
        const step = () => {
          if (n >= flicks) { cell.textContent = ch; cell.classList.add("set"); return; }
          cell.textContent = String(Math.floor(Math.random() * 10));
          n++;
          dialScrambleTimers.push(setTimeout(step, 140));
        };
        dialScrambleTimers.push(setTimeout(step, 140));
      }
      host.appendChild(cell);
    });
  }

  function showDialCard() {
    $("call")?.classList.add("pre-connect");
    const d = outgoingDial; if (!d) return;
    // A DIFFERENT person than the card currently shows ⇒ blank the enriched rows and go
    // and fetch. The same person ⇒ this is the mid-dial re-paint carrying their real name,
    // so leave the photo alone (re-fetching would flicker it).
    const fresh = dcPin !== d.pin;
    if (fresh) { dcPin = d.pin; resetDialIdentity(); }
    const av = $("dcAv"); if (av) av.textContent = d.group ? "👥" : (d.name ? initials(d.name) : "#");
    paintDialDigits(d.group || d.pin.length !== 6 ? d.pin : d.pin.slice(0, 3) + "-" + d.pin.slice(3), fresh);
    const nm = $("dcName"); if (nm) { nm.textContent = d.name || ""; nm.style.display = d.name ? "" : "none"; }
    const md = $("dcMode");
    if (md) {
      // The visual confirmation of the SESSION MODE, from the very start:
      // a video dial connects with the camera already live; a voice dial
      // stays camera-off until the user explicitly enables it in-call.
      md.textContent = d.video ? "Video call" : "Voice call";
      md.classList.toggle("video", d.video);
    }
    // LAST, so the fetch is fired only after the card is fully painted for this pin — and
    // only for a genuinely new one. A group dial has no single person to look up.
    if (fresh && !d.group) enrichDialCard(d.pin);
  }
  function exitPreConnect() {
    stopDialScramble();
    outgoingDial = null;
    // Forget which pin the card showed, so dialling the same person again re-fetches
    // rather than trusting rows painted before this call happened — their status and the
    // last-call figure are both stale by definition once a call has ended.
    dcPin = null;
    resetDialIdentity();
    $("call")?.classList.remove("pre-connect");
  }
  // The callee ANSWERED our outgoing dial (first remote party appeared):
  // advance "Ringing…" → the real connecting sequence. The dial card stays up
  // until the media session is actually ESTABLISHED — only then does the full
  // in-call interface appear (markEstablished → exitPreConnect).
  function onCalleeAnswered() {
    clearDialTimeout();
    if (!outgoingDial) return;
    if (!establishedOnce) {
      runConnSequence();
      // Coverage passes from the 65s no-answer backstop to the establishment
      // deadline HERE, in the same breath as the cancel, so there is no window
      // in which the call is bounded by nothing.
      armEstablishDeadline();
    }
  }
  // Numbers this user has BLOCKED (pushed by the host app from their contact
  // list). An incoming ring from any of them is silently declined — same
  // treatment as Do-Not-Disturb, but per-number.
  let blockedPins = new Set<string>();
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
    /* PUBLISH "the call surface is on screen" for the app shell's background
     * canvas, which pauses its rAF while this is set (relayBackground.ts).
     * SET AND CLEARED IN THE ONE SWITCHER on purpose: paired to enterCallUI and a
     * teardown instead, the two could drift and either leak the flag — freezing
     * the background for the rest of the session — or miss a path and keep the
     * canvas painting through a call. Here the flag cannot mean anything other
     * than which screen is active. It covers the PRE-CONNECT dial card too, which
     * is also full-screen and also wants the CPU. */
    try {
      const el = document.documentElement;
      if (s === "call") el.dataset.relayInCall = "1";
      else delete el.dataset.relayInCall;
    } catch { /* non-DOM host — the canvas simply keeps its old behaviour */ }
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
  // Last name seen per pin (mesh createPeer + SFU addLkTile both record here) —
  // so hold/leave messaging can name an SFU peer, whose entry never lives in
  // the mesh `peers` map (v2.97.1).
  const peerNamesSeen: Record<string, string> = {};
  const nameOf = (pin: string) =>
    peers[pin]?.name || peerNamesSeen[pin] || pin;

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
  // Signaling rides plain POSTs. A single DROPPED message used to be fatal for
  // a mesh pair — an offer/answer that never arrives means that pair never
  // gets media, with no retry anywhere ("his video/audio doesn't work for me,
  // works for everyone else"). And drops genuinely happen: transient network
  // blips, and 429s from the per-IP abuse limiter when several participants
  // behind ONE office NAT join at once (a 6-party mesh setup is 15 links ×
  // offer/answer/ICE ≈ hundreds of messages in a few seconds from one IP).
  // Retry with backoff (250ms/750ms/2250ms); out-of-order arrival is already
  // handled (per-peer candidate queues). `leave` stays fire-and-forget — a
  // teardown must never linger; the server's disconnect grace covers it.
  function sendWS(obj: any) {
    const retriable = !!obj && obj.type !== "leave";
    let body: string;
    try { body = JSON.stringify({ cid, message: obj }); } catch { return; }
    // Attach the stable device id so the server can resolve THIS browser's
    // identity (and bind `register` to the caller's real number, F1) even when
    // the guest cookie was dropped by Safari ITP / privacy mode — the same
    // cookie-loss fallback the tRPC client and the upload route use. The SSE
    // stream (EventSource) can't set headers, but signaling — including
    // register — rides these POSTs, which can.
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const did = getDeviceId();
    if (did) headers[DEVICE_ID_HEADER] = did;
    void (async () => {
      for (let attempt = 0; ; attempt++) {
        try {
          const res = await fetch("/api/relay/send", {
            method: "POST",
            headers,
            body,
            keepalive: true,
          });
          if (res.ok || !retriable || attempt >= 3) return;
          diag("send retry " + (obj?.type || "?") + " (http " + res.status + ")");
        } catch {
          if (!retriable || attempt >= 3) return;
          diag("send retry " + (obj?.type || "?") + " (network)");
        }
        await new Promise(r => setTimeout(r, 250 * Math.pow(3, attempt) + Math.random() * 150));
      }
    })();
  }

  // True when we're in a call but no remote party is present yet — used to
  // decide whether a `rejected`/`busy`/error should tear the call down, so that
  // a declined add-invite in a group call doesn't kill the whole call.
  function aloneInCall(): boolean {
    return Object.keys(peers).length === 0;
  }

  // True when we're in a PARKED room — a group call or a party line (server
  // room ids "pl-<number>", see PARTY_LINE_ROOM_PREFIX in server/relay.ts).
  // In a parked room you stay until YOU hang up: a `rejected`/`busy` for an
  // add-invite must never tear the call down even while we're (still) alone
  // on the line — mirroring how error{offline} guards the add-invite path.
  // The roomId check matters on top of callIsGroup for a rejoin-after-reload
  // onto a line, where the rejoin envelope carries no partyLine flag.
  function inParkedCall(): boolean {
    return callIsGroup || (!!roomId && roomId.startsWith("pl-"));
  }

  // ---------- protocol ----------
  function handle(m: Msg) {
    // Round 11 B: every envelope that puts us IN a room carries a fresh
    // capability for it. Captured in one place rather than in each handler, so a
    // room ack added later inherits the recovery path for free.
    if (typeof m.cap === "string" && m.cap) roomCap = m.cap;
    switch (m.type) {
      case "registered":   onRegistered(m); break;
      case "resync": {
        // Round 11 C. Signaling leadership moved to another instance. Our SSE
        // stream is fine — it is the SERVER-side view of who we are that was
        // lost, because a client record owns a socket and the new leader has
        // none. Re-register (the same message the stream sends on open), which
        // rebuilds it and, from the leader's hydrated room registry, hands back
        // a `rejoin`. If it does NOT (the durable copy was unavailable too),
        // the armed repair below runs. Media is untouched throughout.
        diag("resync (leader changed)");
        if (wantName) {
          sendWS({ type: "register", name: wantName, pin: me.pin || undefined, device: detectDeviceType(), flag: selfFlag || undefined });
        }
        if (inCall && roomId && roomCap) armRecreate({ roomId, cap: roomCap });
        break;
      }
      case "room":
        roomId = m.roomId || null;
        // M37 (v2.99.47): this ack answers OUR OWN invite, so this room is the
        // one our dial created — the single place a pending video offer may be
        // bound. Every other way of entering a room deliberately leaves it
        // unbound, which is what stops an abandoned dial's offer authorizing a
        // camera in someone else's call.
        bindVideoOfferToRoom(roomId);
        captureSelfRole(m); // the creator is the host
        // Group call: now that the room exists, ring the remaining invitees.
        if (pendingGroupInvites.length) {
          const q = pendingGroupInvites; pendingGroupInvites = [];
          q.forEach(t => { if (!peers[t]) sendWS({ type: "invite", to: t, video: camOn }); });
        }
        break;
      case "ringing":
        // Server confirmed our invite was DELIVERED — the callee's device is now
        // being alerted. Advance the caller's staged progress from "Calling…"
        // (request sent) to "Ringing…" (destination being alerted).
        //
        // `paging` (restored v2.105.12) distinguishes the two ways that happens,
        // and the distinction is honest rather than cosmetic: without it, a
        // pocketed phone that has been sent a wake-up push would claim to be
        // "Ringing…" while nothing is audibly ringing yet. v2.99.11 removed
        // paging altogether; the owner has since asked for ringing back, and the
        // server now pages ONLY when a push actually reached a device — a callee
        // nothing can wake still gets error{offline} and the leave-a-message
        // card. When their app opens, `deliverPendingRing` sends a second
        // `ringing` ack WITHOUT `paging`, which upgrades this line in place.
        if (inCall && outgoingDial && !callAnswered) {
          setCallStatus("ringing", m.paging ? "Reaching their phone…" : undefined);
          // Upgrade the dial card with the callee's registered display name if
          // the dialer didn't know it (dialed a raw number, not a contact).
          if (m.name && !outgoingDial.group && !outgoingDial.name) {
            outgoingDial.name = String(m.name);
            showDialCard();
          }
        }
        break;
      case "ring":         onRing(m); break;
      case "ring-cancel":  onRingCancel(m); break;
      case "joined":       onJoined(m); break;
      case "rejoin":       void onRejoin(m); break;
      case "resumed":      void onResumed(m); break;
      case "merged":       onMerged(m); break;
      case "peer-joined":  onPeerJoined(m); break;
      case "rejected":
        toast(nameOf(m.from!) + " declined.");
        // Group dial: note the decline; the LAST one ends the dial (see
        // groupInviteeResolved) instead of ringing on into the backstop.
        groupInviteeResolved(m.from, "Everyone declined.");
        // A decline is only fatal to a lone 1:1 DIALER. In a group call or on
        // a party line the invite was an ADD — stay parked (inParkedCall).
        if (inCall && aloneInCall() && !inParkedCall()) {
          if (outgoingDial && !establishedOnce) failDial("They declined.", "peer-rejected");
          else hangUp("peer-rejected");
        }
        break;
      case "busy":
        toast("They're on another call.", true);
        groupInviteeResolved(m.from, "Nobody was available.");
        if (inCall && aloneInCall() && !inParkedCall()) {
          if (outgoingDial && !establishedOnce) failDial("They're on another call.", "peer-busy");
          else hangUp("peer-busy");
        }
        break;
      case "peer-left": {
        // A REAL leave: whoever it was is no longer holding us (a holder that
        // fully hangs up releases the held room → this very message), so the
        // hold banner/music clear and the normal end logic applies (v2.97.1).
        const goneP = m.pin!;
        peersHoldingUs.delete(goneP);
        updateOnHoldState();
        removePeer(goneP);
        break;
      }
      // v2.99.57: a moderation frame names the room it was issued for. Ignore one
      // aimed at a call we are no longer in — the server now refuses to send it,
      // so this is defence in depth. Fails OPEN on a missing room so an older
      // frame still applies.
      case "force-mute":   if (!m.roomId || m.roomId === roomId) onForceMute(m); break;
      case "role":         onRoleChange(m); break;
      case "host-pin":     onHostPin(m); break;
      case "peer-meta":
        // Late metadata update (e.g. a peer's flag resolved after they joined).
        if (m.pin && m.flag) { peerFlags[m.pin] = m.flag; setTileFlag("tile-" + m.pin, m.flag); }
        if (m.pin && m.device) { peerDevices[m.pin] = m.device; setTileDevice("tile-" + m.pin, m.device); }
        break;
      case "peer-hold":    onPeerHold(m); break;
      case "peer-screen":  onPeerScreen(m); break;
      case "video-request": onVideoRequest(m); break;
      case "video-accept":  onVideoAccept(); break;
      case "video-decline": onVideoDecline(); break;
      case "kicked":
        if (m.roomId && m.roomId !== roomId) {
          // A kick from a call we had PARKED must not hang up the call we are
          // actually on. Drop the held call instead.
          if (m.roomId === heldRoomId) dropHeld();
          break;
        }
        toast("You were removed from the call by the host.", true);
        hangUp("kicked");
        break;
      case "knock":        onKnock(m); break;
      case "knock-result": onKnockResult(m); break;
      case "signal":       onSignal(m.from!, m.data, m.roomId); break;
      case "ice":          onIceServers(m); break;
      case "error": {
        toast(m.message || "Something went wrong.", true);
        // Two very different failure classes share the `error` envelope:
        //   • REACHABILITY (`offline`/`nonexistent`/`gone`) — the INVITEE we rang
        //     couldn't be reached. In a group call or party line this must NOT
        //     tear the whole call down just because one invitee didn't pick up
        //     (mirrors how `rejected`/`busy` already spare a parked call).
        //   • JOIN (`self`/`full`/`forbidden`) — WE couldn't join (7th mesh /
        //     11th SFU accept, full party line). Fatal to a peerless joiner; the
        //     aloneInCall() guard spares any LIVE call (host-only forbidden).
        // `unavailable` (v2.99.47) is the OFFLINE-DIAL THROTTLE: unreachable for
        // now, but the server never resolved the number, so it is deliberately
        // NOT voicemail-eligible below — offering to leave a message for a
        // possibly-nonexistent number loses whatever the user records.
        const reachErr =
          m.code === "offline" || m.code === "nonexistent" || m.code === "gone" ||
          m.code === "unavailable";
        /* `saturated` (v2.106.59) is the media fleet being FULL for a GROUP call:
           the owner's node-scaling doc reserves the mesh fallback for 1:1 because a
           large group over the mesh runs N−1 encoders on every phone, so an honest
           refusal beats a call nobody can hear. Classified as a JOIN error rather
           than a reach error, because the failure is ours and not the invitee's —
           reachErr would raise the leave-a-voice-message card, which is the wrong
           offer for somebody who is perfectly reachable. CLASSIFYING IT AT ALL is
           the load-bearing part: an unclassified code reaches neither the fatal
           branch nor the group-dial promotion, so the caller would sit on
           "Ringing…" until the 65s backstop and be told nothing. */
        const joinErr = m.code === "self" || m.code === "full" || m.code === "forbidden" ||
                        m.code === "saturated";
        // v2.99.36: `nohold` answers an `end-active` whose held room was already
        // gone — there is nothing to resume, so complete the hang-up NOW (that
        // branch skipped hangUp and would otherwise sit here with the camera and
        // mic still captured until the fail-closed timer fired).
        // v2.99.47: a knock approve/deny that the server refused (we've left the
        // call, or the request already resolved). Purely informational — it must
        // never be classified with the fatal reachability/join codes, since the
        // approver may be sitting alone in a perfectly good call of their own.
        if (m.code === "knockfail") {
          toast(m.message || "That request is no longer waiting.", true);
          break;
        }
        if (m.code === "nohold" && inCall) {
          cancelEndActiveFallback();
          dropHeld();
          hangUp("end-active-nohold");
          return;
        }
        if (addInviteOfflineGuard && (m.code === "offline" || m.code === "nonexistent" || m.code === "unavailable")) {
          // Offline/nonexistent error for an in-call add-to-call invite (the "+"
          // pad) — the server just reports the addee is unreachable; never tear
          // down the call we're already in. (v2.99.11 split offline vs
          // nonexistent, so the guard must accept BOTH.)
          addInviteOfflineGuard = false;
          if (addInviteGuardT) { clearTimeout(addInviteGuardT); addInviteGuardT = null; }
          break;
        }
        // GROUP-DIAL BOOTSTRAP: a group dial rings the FIRST invitee to create
        // the room, then the `room` ack flushes the rest (see programmaticGroupDial
        // + the `room` case). If that first invitee is unreachable, v2.99.11 means
        // NO room is ever created — so `room` never arrives, the remaining
        // invitees are never rung, and (without this) the fatal branch below
        // would kill the entire group dial over one offline person. Instead,
        // promote the next pending invitee as the new bootstrap; only fail once
        // every invitee is exhausted. Sent one at a time — never all-at-once —
        // so we never race several room-creating invites into duplicate rooms.
        if (reachErr && callIsGroup && outgoingDial && !establishedOnce) {
          // An unreachable invitee is resolved either way; when the room already
          // exists this is the only thing that notices them.
          if (groupDialOutstanding && m.pin) groupDialOutstanding.delete(m.pin);
        }
        if (reachErr && callIsGroup && outgoingDial && !establishedOnce && !roomId && aloneInCall()) {
          if (pendingGroupInvites.length) {
            const next = pendingGroupInvites.shift()!;
            sendWS({ type: "invite", to: next, video: camOn });
          } else {
            failDial(m.message || "Nobody could be reached.", "server-error:" + (m.code || "?"));
          }
          break;
        }
        // A reachability error inside an ESTABLISHED parked call (a group/party-
        // line add-invite once the room exists) never ends the call — stay on it.
        if (reachErr && inParkedCall()) break;
        // Everything else: fatal to a peerless dialer/joiner. A LIVE call (peers
        // present) is spared by aloneInCall().
        if ((reachErr || joinErr) && inCall && aloneInCall()) {
          if (outgoingDial && !establishedOnce) {
            failDial(m.message || "They're unreachable right now.", "server-error:" + (m.code || "?"));
          } else {
            hangUp("server-error:" + (m.code || "?"));
          }
        }
        break;
      }
    }
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
    // Round 11 B: rejoining after a reload. If the server still knows the call
    // it answers with `rejoin` in this same burst and the repair is cancelled;
    // if it has forgotten it (its leader died AND the durable copy was gone),
    // nothing arrives and the capability is what gets us back in.
    if (pendingRejoin?.cap && pendingRejoin.roomId) {
      armRecreate({ roomId: pendingRejoin.roomId, cap: pendingRejoin.cap });
    }
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
    // v2.99.84: MONO, and `ideal` rather than `exact` so a device that only
    // offers stereo still yields a track instead of throwing OverconstrainedError
    // and costing the person their microphone. A voice call is mono by nature —
    // there is no spatial information in one mouth — so a stereo capture doubles
    // the encoder's sample work for nothing, on the path where N-1 encoders are
    // already the problem. Clarity is unaffected; only redundant channels go.
    channelCount: { ideal: 1 },
  };
  async function acquireRawStream(
    useFacingMode: "user" | "environment",
    wantVideo = true,
  ): Promise<MediaStream> {
    /* VOICE MODE NEVER OPENS THE CAMERA (`wantVideo: false`).
       This used to request `video` unconditionally and then DISABLE the track, which honoured
       the letter of the v2.81 mutual-consent rule (nothing is published) while breaking its
       spirit and costing three real things: the OS camera indicator lights up during a VOICE
       call, the device captures frames it will never send (the "phone becomes very hot"
       class), and a camera-less desktop took the no-camera fallback and toasted "No camera
       found — joining with audio only" on a call where no camera was ever wanted.
       `wantVideo` DEFAULTS TO TRUE, deliberately: every caller that has not been taught the
       mode is byte-identical to before, so this can only ever narrow what is opened.
       Voice → video still works with no camera at start, because `reacquireCameraForPublish`
       builds a fresh stream from the EXISTING audio tracks and only needs `localStream` to
       exist — verified rather than assumed. */
    const s = await navigator.mediaDevices.getUserMedia({
      audio: AUDIO_CONSTRAINTS,
      video: wantVideo ? { ...qualityVideo(videoQuality), facingMode: useFacingMode } : false,
    });
    // Hint the encoder that camera content is motion (prioritize frame rate /
    // smoothness over per-frame detail on a constrained link). Plain property
    // write — no renegotiation, no-op where unsupported.
    try { s.getVideoTracks().forEach(t => { (t as MediaStreamTrack & { contentHint?: string }).contentHint = "motion"; }); } catch { /* */ }
    return s;
  }
  function updateQualityBtn() {
    const b = $("qualityBtn");
    if (b) {
      // v2.99.4: the HD/SD text lives in the #qualityTxt chip span (the button
      // now also contains the "Quality" label) — writing button.textContent
      // would wipe both children. Fallback covers any older markup.
      const t = $("qualityTxt");
      if (t) t.textContent = videoQuality === "low" ? "SD" : "HD";
      else b.textContent = videoQuality === "low" ? "SD" : "HD";
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
  /** Every remote-audio-producing element: each mesh peer's own <audio> +
   *  SFU detached <audio>s.
   *
   *  THIS FUNCTION IS THE ONLY ROUTE TO REMOTE AUDIO, so anything added here
   *  has to be added here or three shipped features silently stop covering it:
   *  the output-device picker (applyAudioSink), armAudioUnlock's tap-to-recover,
   *  and the forced-loudspeaker route all reach remote audio ONLY through this.
   *  Mesh audio moved off the tile <video> in v2.106.51; the <video>s are still
   *  collected because they still need play() re-kicked for VIDEO autoplay, and
   *  routeElToLoudspeaker skips any element whose stream has no audio track. */
  function collectAudioEls(): HTMLMediaElement[] {
    const els: HTMLMediaElement[] = [];
    for (const pin in peers) {
      const a = peers[pin].audioEl as HTMLMediaElement | null | undefined;
      if (a) els.push(a);
      const v = peers[pin].el?.querySelector("video") as HTMLMediaElement | null;
      if (v) els.push(v);
    }
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
  // iOS/iPadOS detection, hoisted here so the camera-flip + filter paths (defined
  // above the SFU/PiP code) can special-case iOS media quirks.
  const IS_IOS = (() => {
    try {
      const ua = navigator.userAgent || "";
      return /iP(hone|od|ad)/.test(ua)
        || (/Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1); // iPadOS poses as Mac
    } catch { return false; }
  })();
  // iOS Safari does NOT remember camera/mic grants by default — it re-prompts
  // on later visits, and NO web API can persist the grant for the user (that's
  // a platform security boundary; Chrome/Android and desktop browsers persist
  // after the first Allow on their own). The one real, permanent fix lives in
  // Safari itself: aA → Website Settings → Camera/Microphone → Allow. Surface
  // that ONCE, right after the first successful grant (while the popup is
  // fresh in mind), then never again. Skipped inside an installed (standalone)
  // PWA, where iOS already persists grants per app.
  function maybeShowIosPermTip() {
    try {
      if (!IS_IOS) return;
      const standalone =
        (navigator as unknown as { standalone?: boolean }).standalone === true ||
        (typeof window.matchMedia === "function" && window.matchMedia("(display-mode: standalone)").matches);
      if (standalone) return;
      if (window.localStorage.getItem("relay_ios_perm_tip") === "1") return;
      window.localStorage.setItem("relay_ios_perm_tip", "1");
      // Delayed so it doesn't collide with the "call starting" toasts.
      setTimeout(() => {
        toast(
          "Tip: stop the camera/mic popup — tap aA in Safari's address bar → Website Settings → set Camera and Microphone to Allow. Safari then remembers it for this site."
        );
      }, 1500);
    } catch { /* best-effort — never block media on a tip */ }
  }
  let loudspeakerCtx: AudioContext | null = null;
  let loudspeakerOn = false;
  let loudspeakerScanT: ReturnType<typeof setInterval> | null = null;
  const loudspeakerNodes: AudioNode[] = [];
  const loudspeakerMutedEls = new Set<HTMLMediaElement>();
  /**
   * Persisted speakerphone preference — and the fix for BOTH mobile audio
   * reports. PHONES DEFAULT ON: iOS routes WebRTC audio to the tiny EARPIECE
   * while the mic is live, so an iPhone held at arm's length "hears nothing"
   * (reported as one-way audio on every Android↔iPhone call — the iPhone side
   * was silent in both directions); Android WebViews land on the earpiece for
   * ANSWERED calls too (reported as "speaker won't enable until I hang up and
   * redial"). A video-caller UI is used at arm's length like FaceTime-on-
   * speaker, so speaker-on is the honest default; the audio button toggles it
   * per call and the choice is remembered. WebAudio output rides the MEDIA
   * route, which follows a connected headset/AirPods automatically — never
   * blasts into someone's ear.
   */
  function loudspeakerPref(): boolean {
    try {
      const v = window.localStorage.getItem("relay_loudspeaker");
      if (v === "1") return true;
      if (v === "0") return false;
    } catch { /* */ }
    return IS_IOS || IS_ANDROID;
  }
  function setLoudspeakerPref(on: boolean) {
    try { window.localStorage.setItem("relay_loudspeaker", on ? "1" : "0"); } catch { /* */ }
  }
  /** Create the loudspeaker context (with its auto-resume guard) if needed. */
  function ensureLoudspeakerCtx(): AudioContext | null {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return null;
    if (!loudspeakerCtx) {
      loudspeakerCtx = new Ctx();
      // The OS can suspend this context when the tab is backgrounded (Android),
      // which — because the source <audio>/<video> elements are muted while the
      // Web-Audio route carries the sound — would silence ALL incoming audio.
      // Auto-resume the moment it flips to suspended while loudspeaker is on.
      loudspeakerCtx.onstatechange = () => {
        if (loudspeakerOn && loudspeakerCtx && loudspeakerCtx.state === "suspended") {
          void loudspeakerCtx.resume().catch(() => {});
        }
      };
    }
    return loudspeakerCtx;
  }
  /**
   * Pre-create + resume the loudspeaker context INSIDE a user gesture (the
   * Answer / dial tap), so the speaker auto-apply at establishment finds a
   * RUNNING context — iOS refuses resume() outside a gesture. No routing and
   * no muting happens here, so it can never affect audibility by itself.
   */
  function loudspeakerPrime() {
    if (!loudspeakerPref()) return;
    try {
      const ctx = ensureLoudspeakerCtx();
      if (ctx) void ctx.resume().catch(() => {});
    } catch { /* best-effort */ }
  }
  function routeElToLoudspeaker(el: HTMLMediaElement) {
    if (!loudspeakerCtx || loudspeakerMutedEls.has(el)) return;
    // NEVER mute an element into a context that isn't RUNNING: the 2s scan
    // used to route a newly-joined participant while the context sat
    // suspended (backgrounded tab) — their element got muted with no live
    // Web-Audio path = that one voice silent. Try to resume; route them on a
    // later scan tick once the context is actually running.
    if (loudspeakerCtx.state !== "running") {
      void loudspeakerCtx.resume().catch(() => {});
      return;
    }
    const stream = el.srcObject as MediaStream | null;
    if (!stream || stream.getAudioTracks().length === 0) return;
    try {
      // Tap a FRESH MediaStream wrapping the same audio tracks, not the shared
      // element stream: on several Android/Chrome builds a WebRTC stream OBJECT
      // accepts only ONE MediaStreamAudioSourceNode, and the active-speaker
      // analyser may already hold that tap. The old shared-object tap then
      // threw for exactly ONE participant, whose element stayed on the
      // EARPIECE while everyone else played through the loudspeaker — heard as
      // "his audio is quiet/weird/distorted". A fresh wrapper stream gives
      // this route its own graph source and coexists with the analyser.
      const src = loudspeakerCtx.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
      src.connect(loudspeakerCtx.destination);
      loudspeakerNodes.push(src);
      // Mute the element ONLY AFTER the Web-Audio loudspeaker path is wired —
      // a failed tap must leave the element audible (earpiece), never silent.
      loudspeakerMutedEls.add(el);
      el.muted = true;
    } catch { /* tap failed — leave el UNMUTED so audio still plays */ }
  }
  /** Re-route any NEW remote audio onto the loudspeaker (called when participants
   *  join while loudspeaker mode is on). No-op when off. */
  function refreshLoudspeakerRouting() {
    if (loudspeakerOn) collectAudioEls().forEach(routeElToLoudspeaker);
  }
  async function loudspeakerEnable(): Promise<boolean> {
    try {
      if (!ensureLoudspeakerCtx() || !loudspeakerCtx) return false;
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
    // NATIVE ANDROID APP: real OS speakerphone routing (AudioManager) — no
    // WebAudio hop, identical to the system dialer. Falls through to the
    // WebAudio force if the native call fails for any reason.
    if (isNativeAndroid()) {
      const next = !loudspeakerOn;
      if (await nativeSetSpeaker(next)) {
        loudspeakerOn = next;
        setLoudspeakerPref(next);
        updateAudioBtn();
        toast(next ? "Speaker on 🔊" : "Speaker off — earpiece");
        return;
      }
    }
    if (loudspeakerOn) {
      loudspeakerDisable();
      setLoudspeakerPref(false); // remembered: next calls start on the earpiece
      updateAudioBtn();
      toast("Speaker off — earpiece");
      return;
    }
    const ok = await loudspeakerEnable();
    if (ok) setLoudspeakerPref(true); // remembered for the NEXT call too
    updateAudioBtn();
    toast(ok ? "Speaker on 🔊" : "Couldn't switch the output on this device.", !ok);
  }
  function openAudioMenu() {
    // PHONES (v2.99.4 owner spec): a real three-route MENU — Loudspeaker /
    // Earpiece / Bluetooth — instead of the old blind speakerphone toggle.
    // The OS exposes no output-device list to the web on Android/iOS (the
    // sink menu opened EMPTY there), so the routes map onto what phones CAN
    // do: Loudspeaker = the WebAudio media-route force (or the native
    // AudioManager in the Android app), Earpiece = dropping that force, and
    // Bluetooth = dropping the force so the OS default route follows the
    // connected headset (phones hand the default route to BT automatically).
    if (IS_ANDROID || IS_IOS) {
      void renderMobileAudioMenu().then(() => $("audioMenu")?.classList.add("open"));
      return;
    }
    if (!audioOutSupported) {
      toast("Your device routes call audio automatically (headset/Bluetooth switches on its own).");
      return;
    }
    void refreshAudioOutputs();
    $("audioMenu")?.classList.add("open");
  }
  function closeAudioMenu() { $("audioMenu")?.classList.remove("open"); }
  /** True when any enumerated device looks like a headset/Bluetooth output. */
  async function headsetPresent(): Promise<boolean> {
    try {
      const devs = await navigator.mediaDevices.enumerateDevices();
      return devs.some(d => looksLikeHeadset(d.label));
    } catch { return false; }
  }
  function mobileAudioRow(route: string, icon: string, label: string, desc: string, selected: boolean, dim = false): string {
    return '<button type="button" class="ao-item' + (selected ? " ao-sel" : "") + (dim ? " ao-dim" : "") +
      '" data-route="' + route + '"><span class="ao-ic">' + icon + '</span><span class="ao-tx"><span>' +
      escapeHtml(label) + "</span><i>" + escapeHtml(desc) + "</i></span></button>";
  }
  async function renderMobileAudioMenu() {
    const menu = $("audioMenu");
    if (!menu) return;
    const bt = await headsetPresent();
    // Which route carries audio right now: the loudspeaker force when on;
    // otherwise the OS default — which follows a connected headset, else the
    // earpiece (the documented Android/iOS WebRTC default while a mic is live).
    const current = loudspeakerOn ? "loud" : bt ? "bt" : "ear";
    menu.innerHTML =
      mobileAudioRow("loud", "🔊", "Loudspeaker", "Hands-free — hear the call out loud", current === "loud") +
      mobileAudioRow("ear", "📞", "Earpiece", "Private — hold the phone to your ear", current === "ear") +
      mobileAudioRow("bt", "🎧", "Bluetooth / headset",
        bt ? "Route the call to your connected device" : "No Bluetooth device detected — connect one and it takes over",
        current === "bt", !bt);
  }
  async function setMobileRoute(route: string) {
    closeAudioMenu();
    if (route === "loud") {
      // Native Android app: real OS speakerphone. Web: the WebAudio force.
      if (isNativeAndroid() && (await nativeSetSpeaker(true))) {
        loudspeakerOn = true;
        setLoudspeakerPref(true);
        updateAudioBtn();
        toast("Speaker on 🔊");
        return;
      }
      const ok = await loudspeakerEnable();
      if (ok) setLoudspeakerPref(true);
      updateAudioBtn();
      toast(ok ? "Speaker on 🔊" : "Couldn't switch the output on this device.", !ok);
      return;
    }
    // Earpiece and Bluetooth both DROP the loudspeaker force — the OS default
    // route then carries the audio (earpiece normally; the headset when one is
    // connected, phones hand the default route to Bluetooth on their own).
    if (isNativeAndroid()) { try { await nativeSetSpeaker(false); } catch { /* */ } }
    loudspeakerDisable();
    setLoudspeakerPref(false);
    updateAudioBtn();
    if (route === "bt") {
      toast((await headsetPresent())
        ? "Audio routed to your Bluetooth device"
        : "Connect a Bluetooth device — the call follows it automatically");
    } else {
      toast("Earpiece — hold the phone to your ear");
    }
  }
  function onAudioMenuClick(e: Event) {
    const rbtn = (e.target as HTMLElement)?.closest?.("button[data-route]") as HTMLElement | null;
    if (rbtn) { void setMobileRoute(rbtn.getAttribute("data-route") || "ear"); return; }
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
  // ── local-track death watch ──────────────────────────────────────────────
  // The OS can kill a LIVE local track mid-call: a phone-call interrupt, a
  // Bluetooth headset connecting/disconnecting (the mic moves devices), or
  // another app claiming the camera. The mesh keeps a dead sender — the user
  // stayed permanently one-way muted / black with zero feedback ("completely
  // muted" in the 6-party QA). Watch every local track and self-heal.
  function watchLocalTracks(stream: MediaStream) {
    stream.getTracks().forEach(t => {
      t.onended = () => { void recoverDeadLocalTrack(t.kind); };
    });
  }
  async function recoverDeadLocalTrack(kind: string) {
    if (!inCall || !localStream) return;
    const genR = mediaGen;
    diag("local " + kind + " track ENDED — attempting reacquire");
    if (kind === "audio") {
      try {
        const fresh = await navigator.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS, video: false });
      // v2.99.36: the call may have ended while this recovery was acquiring —
      // installing the stream then would strand a live mic forever.
      if (mediaStale(genR) || !inCall || !localStream) { stopStream(fresh); return; }
        const at = fresh.getAudioTracks()[0];
        if (!at) throw new Error("no-track");
        at.onended = () => { void recoverDeadLocalTrack("audio"); };
        localStream.getAudioTracks().forEach(t => { try { localStream!.removeTrack(t); } catch { /* */ } });
        localStream.addTrack(at);
        // The filter pipeline's OUTPUT stream carries the audio too — future
        // mesh peers addTrack from processedStream, so leaving the dead track
        // there would hand new joiners a silent mic.
        if (processedStream) {
          processedStream.getAudioTracks().forEach(t => { try { processedStream!.removeTrack(t); } catch { /* */ } });
          try { processedStream.addTrack(at); } catch { /* */ }
        }
        at.enabled = micOn;
        // Mesh: hot-swap into every peer's audio sender (no renegotiation).
        for (const id in peers) {
          try {
            const sender = peers[id].pc.getSenders().find(s => s.track && s.track.kind === "audio");
            if (sender) await sender.replaceTrack(at);
          } catch { /* per-peer best effort */ }
        }
        toast("Microphone reconnected.");
      } catch {
        toast("Your microphone was lost — check the device, then tap mute/unmute to retry.", true);
      }
      return;
    }
    // Video: reuse the per-path camera reacquire flows. If the camera is OFF
    // there's nothing to do now — the next enable reacquires anyway.
    if (!camOn) return;
    const track = await reacquireCameraForPublish();
    if (track) { await replaceVideoEverywhere(track); syncCamEnabled(); }
  }
  /**
   * Release the local camera + mic (and the filter pipeline wrapping them) in
   * ONE place, so every "we're not in a call any more" path actually frees the
   * devices.
   *
   * v2.99.36 (owner bug): "when I finish the call and I minimize the browser,
   * the mic and the camera is still active — I cannot even have another call".
   * A held capture keeps the OS/browser indicator lit AND keeps the device
   * exclusive, so another tab/app (or the next call) can't acquire it. The
   * self-preview element's srcObject is cleared too: a <video> holding a
   * reference to a (stopped) capture stream can keep some browsers' indicator
   * on and pins the stream object alive.
   */
  function releaseLocalMedia(reason: string) {
    // Invalidate every in-flight acquisition: anything still awaiting
    // getUserMedia when we release must NOT install its stream afterwards (it
    // would be an orphan no end path can ever stop — a permanently lit camera).
    mediaGen++;
    if (pipeline) { try { pipeline.destroy(); } catch { /* */ } pipeline = null; }
    if (localStream) {
      try { localStream.getTracks().forEach(t => t.stop()); } catch { /* */ }
      localStream = null;
    }
    processedStream = null;
    try {
      const selfV = $("tile-self")?.querySelector("video") as HTMLVideoElement | null;
      if (selfV) selfV.srcObject = null;
    } catch { /* */ }
    diag("released local camera/mic (" + reason + ")");
  }

  /**
   * Monotonic media generation (v2.99.36). Bumped by releaseLocalMedia on every
   * release. Any async acquisition captures it BEFORE awaiting getUserMedia and
   * re-checks it after: a mismatch (or `destroyed`) means the call ended while
   * the prompt/acquisition was in flight, so the freshly acquired tracks are
   * stopped instead of installed. Without this, every acquire-after-await path
   * (ensureMedia, flipCamera, reacquireCameraForPublish, recoverDeadLocalTrack)
   * could strand a live camera/mic that NO end path stops.
   */
  let mediaGen = 0;
  /** Stop a stream's tracks, best-effort. */
  function stopStream(s: MediaStream | null | undefined) {
    if (!s) return;
    try { s.getTracks().forEach(t => t.stop()); } catch { /* */ }
  }
  /** True when an acquisition started at `gen` is now stale (released/destroyed). */
  function mediaStale(gen: number) {
    return destroyed || gen !== mediaGen;
  }
  /** In-flight ensureMedia, so concurrent callers SHARE one acquisition instead
   *  of each running getUserMedia and orphaning the loser's stream. */
  let ensureMediaInFlight: Promise<MediaStream> | null = null;
  /** What the in-flight acquisition is opening, so a VIDEO caller is never
   *  handed a VOICE caller's audio-only result (see below). */
  let ensureMediaInFlightWantsVideo = true;

  function ensureMedia(wantVideo = true): Promise<MediaStream> {
    // Share the in-flight acquisition only when it opens AT LEAST what this
    // caller needs. A voice acquisition in flight cannot satisfy a video
    // caller, and starting a second getUserMedia concurrently is exactly the
    // orphan-a-stream bug the sharing exists to prevent — so we WAIT for it and
    // then run again, which takes the add-a-camera branch below.
    if (ensureMediaInFlight && (!wantVideo || ensureMediaInFlightWantsVideo)) return ensureMediaInFlight;
    if (ensureMediaInFlight) {
      return ensureMediaInFlight
        .catch(() => { /* its failure is its caller's problem, not ours */ })
        .then(() => ensureMedia(wantVideo));
    }
    ensureMediaInFlightWantsVideo = wantVideo;
    const p = ensureMediaInner(wantVideo).finally(() => {
      if (ensureMediaInFlight === p) ensureMediaInFlight = null;
    });
    ensureMediaInFlight = p;
    return p;
  }

  async function ensureMediaInner(wantVideo: boolean): Promise<MediaStream> {
    const gen = mediaGen;
    // Reuse a live camera/mic — don't re-prompt. But only if the cached MIC is
    // actually ALIVE: tracks can die BETWEEN calls (phone-call interrupt,
    // Bluetooth swap, device unplugged while idle) and reusing a dead stream
    // meant joining the next call permanently one-way muted.
    if (localStream) {
      const audioLive = localStream.getAudioTracks().some(t => t.readyState === "live");
      if (audioLive) {
        // VOICE-THEN-VIDEO in one session: the cached stream may hold no camera
        // at all (a voice call opens none), so a video call must ADD one rather
        // than be handed the audio-only stream — which would look exactly like
        // "my camera is never recognized". The mic is deliberately NOT torn
        // down to get there: it is working, and a re-prompt could fail (device
        // busy) and cost the call its audio to chase a camera.
        if (wantVideo && !localStream.getVideoTracks().some(t => t.readyState === "live")) {
          const added = await reacquireCameraForPublish();
          if (mediaStale(gen)) throw new Error("media-released-during-acquire");
          if (!added) {
            camOn = false;
            $("camBtn")?.classList.add("off");
            toast("No camera found — joining with audio only. Tap the camera button to retry once it's available.");
          }
        }
        return outStream();
      }
      diag("cached media is dead — reacquiring fresh");
      try { localStream.getTracks().forEach(t => t.stop()); } catch { /* */ }
      localStream = null;
      if (pipeline) { try { pipeline.destroy(); } catch { /* */ } pipeline = null; }
      processedStream = null;
    }
    try {
      const raw = await acquireRawStream(facingMode, wantVideo);
      // The call may have ended (or the engine been destroyed) while the OS
      // prompt / acquisition was in flight — never install an orphan.
      if (mediaStale(gen)) { stopStream(raw); throw new Error("media-released-during-acquire"); }
      localStream = raw;
    } catch (firstErr) {
      if ((firstErr as Error)?.message === "media-released-during-acquire") throw firstErr;
      // In VOICE mode the request above WAS audio-only, so retrying the same
      // constraints could only fail the same way — and calling the result a
      // "no camera" fallback would be a false claim about a call that never
      // wanted one. Go straight to the honest mic message.
      if (!wantVideo) {
        toast("Mic blocked. Allow microphone access in your browser, then retry.", true);
        throw firstErr;
      }
      try {
        const audioOnly = await navigator.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS, video: false });
        if (mediaStale(gen)) { stopStream(audioOnly); throw new Error("media-released-during-acquire"); }
        localStream = audioOnly;
        camOn = false;
        // Reflect the fallback on the camera BUTTON too — it used to keep its
        // "on" look, so tapping it toggled a camera that didn't exist and the
        // user had no signal their video was never being sent.
        $("camBtn")?.classList.add("off");
        toast("No camera found — joining with audio only. Tap the camera button to retry once it's available.");
      } catch (e2) {
        if ((e2 as Error)?.message === "media-released-during-acquire") throw e2;
        toast("Mic/camera blocked. Allow access in your browser, then retry.", true);
        throw e2;
      }
    }
    // Self-heal when the OS kills a track mid-call (see recoverDeadLocalTrack).
    watchLocalTracks(localStream);
    // First grant of the session: on iOS Safari, show the one-time pointer to
    // the PERMANENT per-site Allow (the popup itself is browser policy we
    // cannot suppress from a web page).
    maybeShowIosPermTip();
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
        const pc = peers[id].pc;
        const senders = pc.getSenders();
        // KIND-AWARE empty-slot fallback: a bare `find(s => !s.track)` could
        // hand the VIDEO track to an empty AUDIO sender. Resolve the empty
        // slot through its transceiver's receiver kind instead.
        const sender = senders.find(s => s.track && s.track.kind === "video")
                    || pc.getTransceivers().find(tr => tr.mid !== null && !tr.sender.track && tr.receiver?.track?.kind === "video")?.sender
                    || null;
        if (sender) await sender.replaceTrack(track);
      } catch { /* */ }
    }
    syncCamEnabled();
  }

  // Warm the camera/mic at login. Best-effort: if the user denies or has no
  // devices we surface a gentle banner but never block the lobby. The stream is
  // cached so the later ensureMedia() call during a dial is instant and does not
  // pop a fresh OS prompt (which on mobile was dropping the call).
  let mediaPrimed = false;
  /**
   * Warm the camera/mic PERMISSION at login so the OS prompt is handled while
   * the user is idle — NOT in the middle of placing a call (on mobile, prompting
   * during the invite made the page lose focus and dropped the call).
   *
   * v2.99.36 (owner bug: "when I finish the call ... the mic and the camera is
   * still active — I cannot even have another call"): this used to call
   * ensureMedia() and deliberately KEEP the stream ("we warm the stream and keep
   * it ready"), so the camera + mic were held live for the entire time the user
   * sat in the app with no call at all. That lit the device indicator
   * permanently and — because capture is exclusive — stopped another tab/app
   * (or the next call) from acquiring the devices.
   *
   * Now we warm only the PERMISSION: acquire briefly, then release immediately.
   * The permission grant persists for the origin, so the real in-call
   * ensureMedia() still won't prompt — with zero capture while idle.
   */
  async function primeMedia() {
    if (mediaPrimed || localStream || inCall) return;
    const banner = $("mediaBanner");
    try {
      const probe = await navigator.mediaDevices.getUserMedia({
        audio: AUDIO_CONSTRAINTS,
        video: true,
      });
      // Release the devices at once — we only wanted the grant.
      try { probe.getTracks().forEach(t => t.stop()); } catch { /* */ }
      mediaPrimed = true; // sticky: the grant doesn't need re-warming
      if (banner) banner.style.display = "none";
      diag("media permission warmed (devices released — not held while idle)");
    } catch {
      // Denied / no devices: show a persistent banner with a retry. Never block
      // the lobby — a dial re-attempts acquisition and reports failure itself.
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
  // getUserMedia right after stopping a camera can fail TRANSIENTLY
  // (NotReadableError) while the OS releases the hardware — seen on iPhones
  // and several Android WebViews. Retry a couple of times with a short
  // breather instead of giving up on the first attempt (the reported "flip
  // hangs until I toggle the camera a few times").
  async function acquireFlippedCameraWithRetry(next: "user" | "environment"): Promise<MediaStream | null> {
    const delays = [0, 300, 700];
    for (const wait of delays) {
      if (wait) await new Promise(r => setTimeout(r, wait));
      const s = await acquireFlippedCamera(next);
      if (s && s.getVideoTracks().length > 0) return s;
    }
    return null;
  }
  async function flipCamera() {
    if (flipBusy) return;
    const genF = mediaGen;
    if (!localStream) { toast("Camera isn't active yet.", true); return; }
    if (screenSharing) { toast("Stop screen sharing to flip the camera.", true); return; }
    flipBusy = true;
    try {
      const next: "user" | "environment" = facingMode === "user" ? "environment" : "user";
      const audioTracks = localStream.getAudioTracks();
      const oldVideo = localStream.getVideoTracks();
      // Many phones can hold only ONE camera capture at a time — calling
      // getUserMedia for the new camera while the old one is STILL LIVE hangs /
      // freezes the page (iOS always; some Android WebViews too). Since
      // v2.96.1 we stop-first on EVERY platform — the retry + recovery below
      // covers the failure case that used to be Android's reason to overlap.
      oldVideo.forEach(t => t.stop());
      const nuVideo = await acquireFlippedCameraWithRetry(next);
      // v2.99.36: the call may have ended mid-flip (End tapped while the new
      // camera was being acquired) — release it instead of installing an orphan.
      if (mediaStale(genF)) { stopStream(nuVideo); return; }
      if (!nuVideo || nuVideo.getVideoTracks().length === 0) {
        toast("Couldn't switch camera — this device may only have one.", true);
        {
          // We already stopped the old camera — bring the original facing back so
          // the user isn't left with a dead tile.
          const recover = await acquireFlippedCameraWithRetry(facingMode);
          if (mediaStale(genF)) { stopStream(recover); return; }
          const rv = recover?.getVideoTracks()[0];
          if (rv) {
            localStream = new MediaStream([...audioTracks, rv]);
            if (pipeline) { await pipeline.setInputStream(localStream); }
            else { await replaceVideoEverywhere(rv); }
            syncCamEnabled();
            const sv = $("tile-self")?.querySelector("video") as HTMLVideoElement | null;
            if (sv) { sv.srcObject = null; sv.srcObject = processedStream || localStream; void sv.play().catch(() => {}); }
          }
        }
        return;
      }
      facingMode = next;
      // Carry the SAME audio track across the flip; stop the old VIDEO (already
      // stopped above on iOS — stop() is idempotent, so this is a no-op there).
      oldVideo.forEach(t => t.stop());
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
      // iOS sometimes delivers the fresh camera track MUTED for a beat — the
      // tile sits black until the first frame. Rebind + replay on unmute so
      // the flip visibly completes without the user toggling the camera.
      const freshTrack = nu.getVideoTracks()[0];
      if (freshTrack && freshTrack.muted) {
        freshTrack.addEventListener("unmute", () => {
          const v = $("tile-self")?.querySelector("video") as HTMLVideoElement | null;
          if (v) { v.srcObject = null; v.srcObject = processedStream || localStream; void v.play().catch(() => {}); }
        }, { once: true });
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
      // iOS Safari's canvas.captureStream() is unreliable — it frequently yields
      // a track that produces NO frames (the filter ships a frozen/black tile),
      // and the MediaPipe WASM can fail to init. Verify the processed track is
      // actually LIVE on iOS; if not, silently fall back to the raw camera so the
      // call keeps working instead of freezing. (Android/desktop are fine.)
      if (IS_IOS && processedStream) {
        const live = await probeTrackLive(processedStream);
        if (!live) {
          activeFilter = "none";
          const rawTrack = localStream.getVideoTracks()[0] || null;
          const dying = pipeline;
          pipeline = null;
          processedStream = null;
          await replaceVideoEverywhere(rawTrack);
          const sv = $("tile-self")?.querySelector("video") as HTMLVideoElement | null;
          if (sv) sv.srcObject = localStream;
          await new Promise(r => setTimeout(r, 0));
          try { dying?.dispose(); } catch { /* */ }
          updateFilterStripUI();
          toast("Live filters aren't supported on this browser — using your camera.", true);
        }
      }
    }
  }
  /** Resolves true if the stream's video track actually produces a frame within
   *  ~1s (its <video> gets non-zero dimensions). Used to detect iOS's dead
   *  canvas.captureStream so we can fall back instead of shipping a black tile. */
  function probeTrackLive(stream: MediaStream): Promise<boolean> {
    return new Promise((resolve) => {
      const track = stream.getVideoTracks()[0];
      if (!track || track.readyState === "ended") { resolve(false); return; }
      const v = document.createElement("video");
      v.muted = true; v.playsInline = true; v.srcObject = stream;
      let done = false;
      const finish = (ok: boolean) => {
        if (done) return; done = true;
        clearTimeout(to);
        try { v.srcObject = null; } catch { /* */ }
        resolve(ok);
      };
      const to = setTimeout(() => finish((v.videoWidth || 0) > 0), 1000);
      v.onloadeddata = () => { if ((v.videoWidth || 0) > 0) finish(true); };
      void v.play().catch(() => {});
    });
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
    loudspeakerPrime(); // dial tap gesture — before ensureMedia consumes it
    // The raw dialer's mode IS the camera toggle's current state, so it decides
    // whether a camera is opened at all.
    try { await ensureMedia(camOn); } catch { return; }
    const target = dialed; dialed = ""; refreshDisplay(); closeAddPad();
    if (!inCall) {
      inCall = true;
      // M37: dialing with the camera live IS our video consent, so a matching
      // `video-accept` from the callee is legitimate even with no video-request.
      videoOfferPending = camOn; videoOfferedForRoom = null;
      outgoingDial = { pin: target, video: camOn };
      enterCallUI("Calling…", { outgoing: true });
      emitPhase("dialing");
      playRingtone("outgoing");
    }
    sendWS({ type: "invite", to: target, video: camOn });
    toast("Calling " + target + "…");
  }

  // ---------- programmatic API for embedding hosts ----------
  let onPhaseChange: ((p: RelayPhase) => void) | null = null;
  // Quick-reply hook: the engine has no messaging stack of its own, so the
  // host app (RelayEngineProvider) wires this to the v2 messages API. Called
  // with the caller's pin + the canned text when the callee picks a reply.
  let onQuickReply: ((toPin: string, text: string) => void) | null = null;
  // Dial-failed hook (v2.88 voicemail): fired when a 1:1 OUTGOING dial ends
  // without ever connecting — no answer, declined, or offline — so the host
  // can offer "Leave a voice message" / "Tell me when they're back online".
  let onDialFailed: ((info: { pin: string; name: string | null; reason: string }) => void) | null = null;
  let lastPhase: RelayPhase = "idle";
  function emitPhase(p: RelayPhase) {
    if (lastPhase === p) return;
    lastPhase = p;
    try { onPhaseChange?.(p); } catch { /* ignore subscriber errors */ }
  }
  async function programmaticDial(target: string, opts?: { voice?: boolean; displayName?: string }): Promise<boolean> {
    if (!/^\d{6}$/.test(target)) return false;
    if (!me.pin) return false; // not registered yet — caller should retry
    if (target === me.pin) { toast("That's your own number.", true); return false; }
    if (peers[target]) { toast("You're already connected to them.", true); return false; }
    try { await ensureMedia(!opts?.voice); } catch { return false; }
    // VOICE mode: no camera was opened at all (see acquireRawStream), and the
    // camera STATE is still flipped off so the button, the self tile and the
    // publish gate all agree with what is being captured. This used to be
    // conditional on a video track EXISTING — which is precisely what a voice
    // call no longer has, so the condition would now skip and leave a lit
    // camera button over a camera nobody opened.
    if (opts?.voice) setCam(false);
    if (!inCall) {
      inCall = true;
      videoOfferPending = !opts?.voice; videoOfferedForRoom = null; // M37 — a video dial offers video
      outgoingDial = { pin: target, name: opts?.displayName, video: !opts?.voice };
      enterCallUI(opts?.voice ? "Voice call…" : "Calling…", { outgoing: true });
      emitPhase("dialing");
      playRingtone("outgoing");
    }
    sendWS({ type: "invite", to: target, video: !opts?.voice });
    toast("Calling " + target + "…");
    return true;
  }

  // Start a GROUP call: ring up to 10 numbers into ONE room. The relay creates
  // the room on the first invite and rings every subsequent invite into the same
  // room, so the first to accept joins and the rest keep ringing (call-waiting
  // style). We gate the extra invites on the server's `room` confirmation so a
  // fresh group dial can't race into two rooms.
  async function programmaticGroupDial(
    targets: string[],
    opts?: { voice?: boolean; seed?: string | null },
  ): Promise<boolean> {
    if (!me.pin) return false;
    const deduped = Array.from(
      new Set(
        targets
          /* v2.106.65 — grouping is stripped, a non-digit is NOT folded away. The old
             `replace(/\D/g, "").slice(0, 6)` made `7a7b7c7d7e7f` into `777777`, which the
             `/^\d{6}$/` filter below then happily accepted — so a malformed target became
             a real stranger's number and got rung, rather than being dropped. Accepting
             the grouping the app itself renders (`777-777`) is deliberate and is what
             `capPinInput` does at every typing site. */
          /* v2.106.65 — REFUSE a malformed target rather than repair it.
             `replace(/\D/g, "")` made `7a7b7c7d7e7f` into `777777`, which the `/^\d{6}$/`
             filter below then happily accepted, so a malformed target silently became a
             real stranger's number and got rung.
             NOTE, because a first draft of this comment said the opposite: `capPinInput`
             would NOT have helped — it also yields `777777`, keeping the digits and
             dropping the letters. What makes it safe at a TYPING site is that the field is
             rewritten as you type, so you always see what will be sent. There is no field
             here, so that protection does not exist, and the only honest rule is to accept
             a target that is ALREADY a number (grouping allowed, since the app renders
             `777-777`) and drop anything else. */
          .filter(t => /^[\d\s.-]+$/.test(String(t).trim()))
          .map(t => pinDigits(String(t)))
          .filter(t => /^\d{6}$/.test(t) && t !== me.pin)
      )
    );
    // Clamp to the ACTIVE transport's cap, RESERVING the caller's own slot
    // (QA M19): the SFU room holds 10 and the mesh 6 INCLUDING us, so we can
    // only ring cap−1 others — ringing the full cap would strand the last
    // acceptee in an accept-into-full. Ring only what can connect, and say so.
    const cap = transportMax() - 1;
    const clean = deduped.slice(0, cap);
    if (deduped.length > cap) {
      toast(`This server supports up to ${cap + 1} on a call — ringing the first ${cap}.`, true);
    }
    if (clean.length === 0) return false;
    try { await ensureMedia(!opts?.voice); } catch { return false; }
    if (opts?.voice) setCam(false);
    const alreadyInRoom = inCall && !!roomId;
    callIsGroup = true; // conferences bypass the 1:1 video-consent gate
    if (!inCall) {
      inCall = true;
      videoOfferPending = !opts?.voice; videoOfferedForRoom = null; // M37 — a video group dial offers video
      outgoingDial = { pin: clean.length + " people", name: "Group call", video: !opts?.voice, group: true };
      enterCallUI(opts?.voice ? "Voice call…" : "Calling…", { outgoing: true });
      emitPhase("dialing");
    }
    if (alreadyInRoom) {
      // Adding people to a call that already exists — never a dial, so the
      // outstanding-invitee bookkeeping below must not apply.
      clean.forEach(t => { if (!peers[t]) sendWS({ type: "invite", to: t, video: camOn }); });
    } else {
      const [first, ...rest] = clean;
      pendingGroupInvites = rest;
      groupDialOutstanding = new Set(clean);
      /* #113 — the seed rides the invite that CREATES the room, and only that one:
         the room is created once, so the later invites have nothing to seed. It is
         a capability the fleet signed for our own pin, not an assertion, so a
         client that omits or forges it simply gets a call with no co-hosts. */
      /* THE PARTY SIZE RIDES THE INVITE THAT CREATES THE ROOM, and only that one.
         The server cannot derive it: a group dial sends its first invite ALONE and
         flushes the rest off the `room` ack, so at room-creation time the server
         sees ONE invitee and a room of size 1 whatever the party will become — and
         it is the room-creation moment that picks the transport. `clean.length` is
         the invitees; +1 for us, which is what makes "3" mean three people on the
         call rather than three people invited.
         A HINT, NOT AN ASSERTION: understating it gets the mesh (today's
         behaviour), overstating it refuses only our own call. See isGroupParty. */
      sendWS({
        type: "invite", to: first, video: camOn, parties: clean.length + 1,
        ...(opts?.seed ? { seed: opts.seed } : {}),
      });
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
    try { navigator.vibrate?.(0); } catch { /* no vibration API */ }
    stopTitleFlash();
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
        // Incoming: RELAY's signature ringtone — a distinct custom melody at a
        // fixed MEDIUM-LOUD level (spec + rationale in shared/ringtone.ts; the
        // Profile "Test ringtone" preview plays the same spec). Outgoing: a
        // single soft repeating dial-tone beep so the caller hears ringing.
        // Physical ring on phones that support it (Android — iOS has no
        // vibration API). Re-fired per burst cycle; stopRingtone cancels.
        if (kind === "incoming") { try { navigator.vibrate?.([400, 200, 400]); } catch { /* */ } }
        const notes: Array<{ freq: number; at: number; dur: number; gain?: number }> =
          kind === "incoming" ? RINGTONE_NOTES : [{ freq: 425, at: 0, dur: 0.9, gain: 0.12 }];
        notes.forEach(n => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = kind === "incoming" ? RINGTONE_WAVE : "sine";
          osc.frequency.value = n.freq;
          const t0 = now + n.at;
          const peak = n.gain ?? RINGTONE_PEAK_GAIN;
          gain.gain.setValueAtTime(0.0001, t0);
          gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.0001, t0 + n.dur);
          osc.connect(gain); gain.connect(ctx.destination);
          ringtoneNodes.add(osc); ringtoneNodes.add(gain);
          // Self-prune once this note finishes so the Set never grows unbounded
          // across a long ring.
          osc.onended = () => { ringtoneNodes.delete(osc); ringtoneNodes.delete(gain); };
          osc.start(t0); osc.stop(t0 + n.dur + 0.05);
        });
      };
      fire();
      ringtoneTimer = setInterval(fire, kind === "incoming" ? RINGTONE_LOOP_MS : 2000);
    } catch { /* best-effort — visual ring overlay still shows */ }
  }

  // iOS Safari refuses to START an AudioContext outside a user gesture: a
  // context first created inside onRing (an SSE event handler) is born
  // "suspended", resume() outside a gesture is ignored, and every oscillator
  // playRingtone schedules is SILENT — the classic "iPhone shows the incoming
  // call but never makes a sound". Pre-create + resume the engine's audio
  // contexts on the FIRST gesture anywhere in the app (entering the app is
  // itself a tap, so this is effectively always armed before the first ring).
  // resume() on a running context is a no-op, so re-fires are harmless.
  function unlockEngineAudio() {
    try {
      const Ctx = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext | undefined;
      if (!Ctx) return;
      if (!ringtoneCtx) ringtoneCtx = new Ctx();
      void ringtoneCtx.resume().catch?.(() => {});
      if (!cueCtx) cueCtx = new Ctx();
      void cueCtx.resume().catch?.(() => {});
    } catch { /* best-effort */ }
  }

  // Tab-title flash while an incoming call rings, so a backgrounded DESKTOP tab
  // shows "📞 Incoming call" in the tab strip even without notification
  // permission. Started by onRing, stopped by stopRingtone (accept / decline /
  // cancel / timeout all funnel there).
  let titleFlashT: ReturnType<typeof setInterval> | null = null;
  let titleFlashOrig: string | null = null;
  function startTitleFlash(text: string) {
    if (typeof document === "undefined" || titleFlashT) return;
    titleFlashOrig = document.title;
    let on = true;
    document.title = text;
    titleFlashT = setInterval(() => {
      on = !on;
      document.title = on ? text : (titleFlashOrig || "RELAY");
    }, 1200);
  }
  function stopTitleFlash() {
    if (titleFlashT) { clearInterval(titleFlashT); titleFlashT = null; }
    if (titleFlashOrig != null) {
      try { document.title = titleFlashOrig; } catch { /* */ }
      titleFlashOrig = null;
    }
  }

  // Call-waiting HOLD state: the OTHER call we've parked while we talk on the
  // active one. Its peer connections stay alive but FROZEN (no media flowing,
  // tiles detached) so a swap-back is instant. At most one held call (a 3rd
  // concurrent caller is rejected).
  let heldRoomId: string | null = null;
  const heldPeers: Record<string, PeerEntry> = {};
  let heldLabel: string | null = null;

  /* ── being HELD (v2.97.1) ────────────────────────────────────────────
     Peers who put US on hold (peer-hold on). This set is the guard that keeps a
     held 1:1 ALIVE: a holder's transport going quiet used to read as "they left"
     → 1:1 auto-end, which is the reported "answering a second call kills the
     first call".
     Cleared on peer-hold off, on a REAL leave (peer-left), and at call end. */
  const peersHoldingUs = new Set<string>();
  // peer-hold can arrive a beat AFTER the holder's transport drops, so a bare
  // 1:1 disconnect never ends the call instantly — it arms this short fuse,
  // and a peer-hold (or the peer coming back) defuses it.
  let soloEndT: ReturnType<typeof setTimeout> | null = null;
  function cancelSoloEndGrace() {
    if (soloEndT) { clearTimeout(soloEndT); soloEndT = null; }
  }
  /** Fail-closed window for `end-active` (v2.99.36): if the server never answers
   *  `resumed` (the held room was already reaped, so it promotes nothing and
   *  replies nothing), force a real hang-up instead of wedging in a call whose
   *  camera/mic are still captured. Generous — a resume is normally instant. */
  const END_ACTIVE_RESUME_MS = 4000;
  let endActiveT: ReturnType<typeof setTimeout> | null = null;
  function cancelEndActiveFallback() {
    if (endActiveT) { clearTimeout(endActiveT); endActiveT = null; }
  }
  function armSoloEndGrace(nm: string) {
    cancelSoloEndGrace();
    soloEndT = setTimeout(() => {
      soloEndT = null;
      if (!inCall || callIsGroup || !callAnswered) return;
      if (peersHoldingUs.size > 0) return; // it WAS a hold — the banner owns the UX
      if (!aloneInCall()) return; // they reconnected/rejoined meanwhile
      addSysMsg(nm + " left the call.");
      if (heldRoomId) {
        toast("Call ended — resuming your held call…");
        endActiveLine();
      } else {
        toast("Call ended.");
        hangUp("remote-left");
      }
    }, 1600);
  }

  // Light HOLD MUSIC for the party who was parked (owner spec): a soft looped
  // two-bar motif — clearly "please hold", nothing like the ring or cues.
  let holdMusicTimer: ReturnType<typeof setInterval> | null = null;
  const holdMusicNodes = new Set<AudioScheduledSourceNode>();
  function holdMusicBar(ctx: AudioContext) {
    const t0 = ctx.currentTime + 0.05;
    const notes: Array<[number, number, number]> = [
      // [freq, offset, dur] — C5 E5 G5 A5 · E5 D5 (gentle add9 lilt)
      [523.25, 0.0, 0.42], [659.25, 0.45, 0.42], [783.99, 0.9, 0.42],
      [880.0, 1.35, 0.58], [659.25, 2.0, 0.42], [587.33, 2.45, 0.66],
    ];
    for (const [f, at, dur] of notes) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = f;
      const s = t0 + at;
      g.gain.setValueAtTime(0.0001, s);
      g.gain.exponentialRampToValueAtTime(0.05, s + 0.06);
      g.gain.exponentialRampToValueAtTime(0.0001, s + dur);
      osc.connect(g); g.connect(ctx.destination);
      osc.start(s); osc.stop(s + dur + 0.05);
      holdMusicNodes.add(osc);
      osc.onended = () => holdMusicNodes.delete(osc);
    }
  }
  function startHoldMusic() {
    if (holdMusicTimer) return;
    try {
      const Ctx = (window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) as typeof AudioContext | undefined;
      if (!Ctx) return;
      if (!cueCtx) cueCtx = new Ctx();
      void cueCtx.resume();
      holdMusicBar(cueCtx);
      holdMusicTimer = setInterval(() => { if (cueCtx) holdMusicBar(cueCtx); }, 3400);
    } catch { /* silent hold is still a hold */ }
  }
  function stopHoldMusic() {
    if (holdMusicTimer) { clearInterval(holdMusicTimer); holdMusicTimer = null; }
    // Stop queued oscillators too — a suspended context would otherwise replay
    // them the next time it resumes (the ringtone "peep peep" lesson).
    holdMusicNodes.forEach(n => { try { n.stop(); } catch { /* */ } });
    holdMusicNodes.clear();
  }
  /** The "you're on hold" banner + music, driven by peersHoldingUs. Group
   *  calls only mark the holder's tile (the others are still talking). */
  function updateOnHoldState() {
    const held = inCall && !callIsGroup && peersHoldingUs.size > 0;
    const bar = $("onHoldBar");
    if (bar) {
      bar.classList.toggle("show", held);
      if (held) {
        const nmEl = $("onHoldName");
        const first = Array.from(peersHoldingUs)[0];
        if (nmEl) nmEl.textContent = first ? nameOf(first) : "They";
      }
    }
    if (held) startHoldMusic(); else stopHoldMusic();
  }

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
    // Resume PLAYBACK too: the tile's <video> was paused for the hold and a
    // re-appended element does not auto-resume — without this the resumed
    // party stayed permanently silent with a frozen frame. If the browser
    // gates the un-gestured play(), the one-tap unlock recovers it.
    const vid = e.el?.querySelector("video") as HTMLVideoElement | null;
    if (vid) void vid.play().catch(() => armAudioUnlock());
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
    if (outgoingDial && !establishedOnce) {
      // QA M2: the CURRENT "call" is an UNANSWERED outgoing dial — an empty dial
      // room with no peer that has accepted. Parking it as HELD is meaningless
      // (there is nothing to resume) and would leave the dialed party ringing
      // into a room we've abandoned; Swap/Resume would then enter a dead empty
      // room. Cancel the dial instead — `leave` reaps that dial room and
      // cancelPendingRings stops the outgoing ring — then accept the incoming.
      // (No switch race: the leave targets the OLD dial room, the accept a
      // DIFFERENT new room, so they can't fight over the same room.)
      sendWS({ type: "leave", reason: "abandon-dial-for-incoming" });
      outgoingDial = null;
    } else {
      // Put the CURRENT (established) call on HOLD (keep its peers frozen) and
      // accept the new one. The server's `accept` handler detects our prior real
      // call and holds it (broadcasting peer-hold to its members) — no separate
      // `hold`/`leave` needed, which also avoids the old switch race. Atomic.
      parkActiveAsHeld();
    }
    // M37 (v2.99.47): a different conversation starts here — neither our video
    // offer nor an approval from the call we just left may carry into it.
    resetVideoConsent();
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
    // Promote the held peers to active.
    for (const id in heldPeers) { peers[id] = heldPeers[id]; delete heldPeers[id]; }
    const resumingRoom = heldRoomId;
    // Move the parked set into held.
    for (const id in parking) heldPeers[id] = parking[id];
    heldRoomId = parkingRoom;
    heldLabel = parkingLabel;
    // M37 (v2.99.47): the active conversation changes here too. `onResumed`
    // re-grants approval for the genuinely-established call we're returning to;
    // until then the gate stays closed rather than inheriting the other call's.
    resetVideoConsent();
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

  // Drop ONLY the held line (v2.97.1, owner: "you can select which call to
  // drop"): close its frozen peers locally and tell the server to release the
  // held room — its members get a normal peer-left; the ACTIVE call stays up.
  function endHeldLine() {
    if (!heldRoomId) { toast("No call on hold.", true); return; }
    dropHeld();
    sendWS({ type: "end-held" });
    toast("Held call ended.");
    addSysMsg("You ended the held call — this call stays connected.");
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
    sendWS({ type: "end-active" });
    addSysMsg("Ended this line — resuming your held call…");
    // FAIL CLOSED (v2.99.36, owner: "I cannot even have another call"). This
    // branch deliberately skips hangUp — the ONLY function that releases the
    // camera/mic — and depends entirely on the server answering `resumed`. If
    // the held room is already gone the server promotes nothing and replies
    // NOTHING, so the engine wedged: inCall stayed true, localStream + pipeline
    // stayed captured (indicator lit), and because `heldRoomId` was still set
    // every further End tap re-entered this same silent branch — a permanent
    // no-op that also blocked any new call (programmaticDial requires !inCall).
    // Now: if no `resumed` arrives, force a real hang-up so the devices are
    // always released and the UI returns to idle.
    if (endActiveT) clearTimeout(endActiveT);
    endActiveT = setTimeout(() => {
      endActiveT = null;
      if (destroyed || !inCall) return;
      diag("end-active: no `resumed` from the server — forcing a full hang-up");
      dropHeld();
      hangUp("end-active-no-resume");
    }, END_ACTIVE_RESUME_MS);
  }

  // Server confirmed a swap / end-active: the named room is now ACTIVE. Thaw its
  // (frozen) mesh peers or reconnect the SFU, re-render, and play the resume cue.
  async function onResumed(m: Msg) {
    const rid = m.roomId || null;
    if (!rid) return;
    // The resume landed — disarm the end-active fail-closed fallback.
    if (endActiveT) { clearTimeout(endActiveT); endActiveT = null; }
    // v2.99.36: if the room we're resuming IS the one we had on hold, nothing is
    // held any more. onResumed was written for swapCall (which re-sets heldRoomId
    // itself), so the end-active path used to leave heldRoomId === roomId — and a
    // stale heldRoomId is what wedged the NEXT End tap into the silent
    // non-hangUp branch (camera/mic never released, End a permanent no-op).
    if (heldRoomId === rid) { heldRoomId = null; heldLabel = null; }
    roomId = rid;
    inCall = true;
    videoApproved = true; // resuming an established call — consent already settled
    enterCallUI("In call");
    recordMemberDevices(m.members);
    recordMemberRoles(m.members);
    captureSelfRole(m);
    // The resumed peers are FROZEN in `peers` (moved there by swapCall) — thaw each
    // so media flows and tiles re-appear. Any member the server lists that we DON'T
    // have a live peer for (e.g. it died during hold) is re-dialed.
    if (m.iceServers && m.iceServers.length) iceConfig = buildIceConfig(m.iceServers);
    for (const id in peers) thawPeerMedia(peers[id]);
    (m.members || []).forEach(mem => { if (!peers[mem.pin]) callPeer(mem.pin, mem.name); });
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
    (m.members || []).forEach(mem => { if (!peers[mem.pin]) callPeer(mem.pin, mem.name); });
    heldRoomId = null; heldLabel = null;
    updateHeldBar();
    layoutGrid();
  }

  /* v2.97: enrich the ring card with the caller's PROFILE — real photo,
     verified badge, presence/status line — via the public directory (the
     signaling ring payload only carries name + flag). Async and DECORATIVE:
     the ring never waits on it, and a slow response for a PREVIOUS caller is
     dropped (guarded on pendingRing.from) so it can never stamp the wrong
     identity onto the current ring. */
  function presentRingProfile(pin: string) {
    const img = $("ringAvImg") as HTMLImageElement | null;
    const initialsEl = $("ringAv");
    const ver = $("ringVerified");
    const pres = $("ringPresence");
    if (img) { img.style.display = "none"; img.removeAttribute("src"); }
    if (initialsEl) initialsEl.style.display = "";
    if (ver) ver.style.display = "none";
    if (pres) pres.textContent = "";
    if (!/^\d{6}$/.test(pin)) return;
    const input = encodeURIComponent(JSON.stringify({ json: { number: pin } }));
    fetch("/api/trpc/directory.lookup?input=" + input, { credentials: "include" })
      .then(r => (r.ok ? r.json() : null))
      .then((j) => {
        if (!pendingRing || pendingRing.from !== pin) return; // stale caller
        const d = (j as { result?: { data?: { json?: { avatarUrl?: string | null; verified?: boolean; role?: string | null; isOnline?: boolean; statusOverride?: string } | null } } } | null)
          ?.result?.data?.json;
        if (!d) return;
        if (d.avatarUrl && img && initialsEl) {
          img.onload = () => {
            if (pendingRing && pendingRing.from === pin) { img.style.display = ""; initialsEl.style.display = "none"; }
          };
          img.onerror = () => { img.style.display = "none"; if (initialsEl) initialsEl.style.display = ""; };
          img.src = d.avatarUrl;
        }
        // Three-tier badge (v2.99.6): every caller gets the check mark, tinted
        // by account tier, with the tier name in tiny type under it — blue
        // Guest / green Registered / yellow Admin. Older servers send only
        // `verified`; fall back to the old verified-only presentation.
        const role = d.role === "guest" || d.role === "registered" || d.role === "admin"
          ? d.role
          : d.verified ? "registered" : d.role === null ? null : "guest";
        if (ver && role) {
          const meta = { guest: ["#4c9bff", "Guest"], registered: ["#22c55e", "Registered"], admin: ["#eab308", "Admin"] }[role];
          ver.style.display = "";
          (ver as HTMLElement).style.color = meta[0];
          ver.setAttribute("title", meta[1] + " account");
          const txt = $("ringRoleTxt"); if (txt) txt.textContent = meta[1];
        }
        if (pres) {
          pres.textContent =
            d.statusOverride === "away" ? "Away" :
            d.statusOverride === "travel" ? "Traveling" :
            d.isOnline ? "Online now" : "";
        }
      })
      .catch(() => { /* decoration only — the ring works without it */ });
  }

  function onRing(m: Msg) {
    // Do Not Disturb: silently auto-decline (no ring overlay, no chime/notify).
    // The caller sees a normal "declined" and the miss is still recorded.
    if (isDndOn()) { sendWS({ type: "reject", to: m.from }); return; }
    // BLOCKED number: silently decline — no overlay, no sound, nothing.
    if (m.from && blockedPins.has(m.from)) { sendWS({ type: "reject", to: m.from }); return; }
    if (inCall) {
      if (m.roomId === roomId) return; // already in this room
      // Call waiting: alert (Switch / Decline) instead of auto-rejecting. Only
      // one CURRENT waiter at a time — but a waiter from the SAME caller (their
      // redial / a server redelivery) or one whose ring window has long passed
      // (its 30s auto-decline froze with the tab in the background) is replaced,
      // not used as grounds to auto-reject the fresh call.
      if (waitingRing && waitingRing.from !== m.from && Date.now() - (waitingRing.at || 0) <= 70_000) {
        sendWS({ type: "reject", to: m.from });
        return;
      }
      // Bug fix: `video` was never carried onto the waiting-ring record, so a
      // call-waiting VIDEO call always got answered voice-only via switchCall
      // (it never consults video) and the promoted-after-hangup path (below)
      // showed a stale video-answer button left over from a PRIOR call.
      waitingRing = { from: m.from!, fromName: m.fromName!, roomId: m.roomId!, flag: m.flag, video: !!m.video, at: Date.now() };
      showCallWaiting(m.fromName || nameOf(m.from!), m.from, m.flag);
      return;
    }
    // A pendingRing normally means "already being rung — reject the second
    // caller". But a ZOMBIE pendingRing — left behind when our SSE died before
    // the caller's ring-cancel arrived and the 60s decline timer froze with the
    // backgrounded tab — must not blind-reject the NEXT real call: that was the
    // top cause of "redial drops in two seconds" (the callee's stale state
    // auto-declined the fresh ring with zero user interaction). A ring from the
    // SAME caller (redial / server redelivery after our reconnect) or one past
    // the 70s ring window REPLACES the stale presentation instead.
    if (pendingRing && pendingRing.from !== m.from && Date.now() - (pendingRing.at || 0) <= 70_000) {
      sendWS({ type: "reject", to: m.from });
      return;
    }
    pendingRing = { from: m.from!, fromName: m.fromName!, roomId: m.roomId!, video: !!m.video, at: Date.now() };
    // Mutual-consent protocol: a VOICE call is answered as voice — the Video
    // answer button only appears when the CALLER dialed this as a video call
    // (answering with it is the callee's consent). v2.97: the buttons carry
    // labels in a wrapper, so the WRAPPER is what hides.
    const vWrap = $("acceptVideoWrap"); if (vWrap) vWrap.style.display = m.video ? "" : "none";
    const ringAv = $("ringAv"); if (ringAv) ringAv.textContent = initials(m.fromName!);
    const ringWho = $("ringWho"); if (ringWho) ringWho.textContent = m.fromName!;
    // Caller identity verification: their PIN (mono, formatted) + country flag.
    const ringPin = $("ringPin");
    if (ringPin) ringPin.textContent = m.from && m.from.length === 6 ? m.from.slice(0, 3) + "-" + m.from.slice(3) : (m.from || "");
    const ringFlag = $("ringFlag"); if (ringFlag) ringFlag.textContent = m.flag || "";
    const ringSub = $("ringSub"); if (ringSub) ringSub.textContent = m.video ? "Video call…" : "Voice call…";
    $("quickReplies")?.classList.remove("open"); // fresh ring → replies folded
    const crInput = $("customReplyInput") as HTMLInputElement | null; if (crInput) crInput.value = "";
    presentRingProfile(m.from!); // photo + verified + presence (async, guarded)
    $("ringOverlay")?.classList.add("active");
    playRingtone("incoming");
    // Out-of-tab alerting: flash the tab title, and (when the page is hidden
    // and permission was granted) raise a system notification. notify() itself
    // suppresses when visible + honours DND, so this never double-alerts.
    startTitleFlash("📞 Incoming call — RELAY");
    notify({
      title: `Incoming ${m.video ? "video" : "voice"} call`,
      body: `${m.fromName || m.from || "Someone"} · ${m.from || ""} is calling you on RELAY`,
      tag: "relay-ring-" + (m.from || ""),
      autoCloseMs: 30_000,
      onClick: () => { try { window.focus(); } catch { /* */ } },
    });
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
  async function acceptInvite(opts?: { voice?: boolean }) {
    const r = pendingRing; pendingRing = null;
    if (ringTimeoutT) { clearTimeout(ringTimeoutT); ringTimeoutT = null; }
    $("ringOverlay")?.classList.remove("active");
    stopRingtone();
    if (!r) { emitPhase("idle"); return; }
    // The Answer tap IS the gesture — prime the speaker route NOW, before the
    // getUserMedia await consumes/outlives the transient activation (phones
    // apply the remembered speaker state at establishment).
    loudspeakerPrime();
    // A camera is opened only when this is a VIDEO call we are answering AS
    // video. Answering a video dial with the Voice button, or answering a voice
    // dial at all, is voice mode — and under the v2.81 mutual-consent rule our
    // camera may not transmit in either case until a video-request is accepted,
    // so opening one would capture frames that cannot legally be sent.
    const wantVideo = !!(r.video && !opts?.voice);
    try { await ensureMedia(wantVideo); } catch { sendWS({ type: "reject", to: r.from }); emitPhase("idle"); return; }
    // "Answer as Voice": camera stays OFF (same rule as a voice DIAL — the
    // SFU publishes no video at all while camOn is false; tapping the camera
    // button mid-call upgrades to video, reacquiring if none was opened).
    if (!wantVideo) setCam(false);
    // Mutual-consent: answering a VIDEO-dialed call with the Video button IS
    // the consent — mark it before media publishes. The reply to the caller is
    // sent AFTER the `accept` below (the server relays video-* by the sender's
    // room, which it only learns from the accept).
    if (r.video && !opts?.voice) videoApproved = true;
    // Accepting is a user gesture — arm the audio unlock now so the remote
    // voice stream (which arrives a second or two later, OUTSIDE any gesture and
    // thus gated by Android's autoplay policy) plays on the user's next touch
    // instead of staying silent until a play() failure happens to re-arm it.
    armAudioUnlock();
    callAnswered = true; // WE answered — the watchdog may enforce media now
    inCall = true; roomId = r.roomId; enterCallUI("In call");
    sendWS({ type: "accept", roomId: r.roomId });
    // Mutual-consent reply to the caller (after `accept`, so the server knows
    // our room): Video answer = both sides transmit; Voice answer on a video
    // dial = the caller stands their camera down.
    if (r.video) sendWS({ type: opts?.voice ? "video-decline" : "video-accept" });
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
    // Multi-device (v2.99.5): the server says WHY this device's ring ended —
    // the call was answered/declined on ANOTHER of your devices. Absent reason
    // = the caller cancelled (old servers send nothing).
    const note =
      m.reason === "answered" ? "Answered on another device" :
      m.reason === "declined" ? "Declined on another device" :
      "Caller cancelled the call";
    // A cancelled CALL-WAITING ring must also dismiss the "Switch" popup. It was
    // only clearing `pendingRing`, so a stale waiting popup survived a cancel —
    // and tapping it later parked your LIVE call then died on the server's
    // `gone`, dropping the good call. Clear the matching waitingRing here.
    if (waitingRing && (!m.from || waitingRing.from === m.from)) {
      waitingRing = null;
      hideCallWaiting();
      toast(note);
    }
    if (!pendingRing) return;
    if (m.from && pendingRing.from !== m.from) return;
    pendingRing = null;
    if (ringTimeoutT) { clearTimeout(ringTimeoutT); ringTimeoutT = null; }
    $("ringOverlay")?.classList.remove("active");
    stopRingtone();
    toast(note);
    emitPhase("idle");
  }

  // ── live-call rejoin: knock handling (v2.99.9) ────────────────────────────
  // As the HOST: someone who was in this call wants back in. Surface it to the
  // React layer (a prompt with Approve/Decline) via the onKnock callback.
  function onKnock(m: Msg) {
    if (!m.fromPin || !m.roomId) return;
    try { onKnock2?.(m.fromPin, m.fromName || nameOf(m.fromPin), m.roomId); } catch { /* */ }
  }
  // As the KNOCKER: the result of our request to rejoin.
  function onKnockResult(m: Msg) {
    if (m.ok && m.reason === "pending") { toast("Asked the host to let you in…"); return; }
    if (m.reason === "denied") { toast("The host declined your request to join.", true); return; }
    if (m.reason === "full") { toast("That call is full.", true); return; }
    if (m.reason === "gone") { toast("That call has ended.", true); return; }
  }

  // ---------- mesh / SFU ----------
  function onJoined(m: Msg) {
    stopRingtone(); // peer connected — stop the outgoing dial tone
    cancelRecreate(); // Round 11 B: we are in a room — nothing to repair
    roomId = m.roomId || null;
    // PARTY LINE (v2.89): dialing a party-line number joins its persistent
    // room directly — the server answers the invite with `room` + `joined`
    // instead of ringing anyone, so receiving `joined` while our OUTGOING dial
    // is still unanswered IS the answer. Party lines are conference rooms:
    // bypass the 1:1 video-consent gate and the 1:1 "peer left → auto-end"
    // rule (you stay parked on the line until YOU hang up), and when the line
    // is EMPTY mark the call established immediately — with no peers there is
    // no peer/track event coming to do it for us.
    if (m.partyLine && outgoingDial && !callAnswered) {
      callIsGroup = true;
      videoApproved = true;
      callAnswered = true;
      if (m.lineTitle && !outgoingDial.group && !outgoingDial.name) {
        outgoingDial.name = String(m.lineTitle);
        showDialCard();
      }
      onCalleeAnswered();
      if (!m.members || m.members.length === 0) markEstablished();
    }
    recordMemberDevices(m.members);
    recordMemberRoles(m.members);
    captureSelfRole(m);
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
    cancelRecreate();                // Round 11 B: the server answered — no repair needed
    if (inCall) return;              // already in a call — ignore
    const rid = m.roomId || null;
    if (!rid) return;
    // Re-acquire media RESILIENTLY. A transient getUserMedia failure on a fresh
    // page (devices momentarily busy while the previous page's tracks release)
    // must NOT drop us from the call — retry once before giving up. (ensureMedia
    // already falls back to audio-only if only the camera is unavailable.)
    let gotMedia = false;
    // The snapshot records the mode the call was in before the reload, so a
    // VOICE call rejoins without opening a camera. With NO snapshot this is a
    // server-driven rejoin whose mode we cannot know, so it reads as video —
    // the historical behaviour, and the recoverable direction, since a camera
    // opened for what turns out to be a voice call is stood down below while a
    // camera never opened would leave a video call with a black tile.
    const rejoinWantsVideo = pendingRejoin ? pendingRejoin.camOn : true;
    try { await ensureMedia(rejoinWantsVideo); gotMedia = true; }
    catch {
      await new Promise(r => setTimeout(r, 600));
      try { await ensureMedia(rejoinWantsVideo); gotMedia = true; } catch { /* truly hopeless */ }
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
    videoApproved = true; // resuming an established call — consent already settled
    enterCallUI("In call");
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
    // Re-offer to each existing member (glare-free — we're the newcomer).
    if (m.iceServers && m.iceServers.length) iceConfig = buildIceConfig(m.iceServers);
    (m.members || []).forEach(mem => { if (!peers[mem.pin]) callPeer(mem.pin, mem.name); });
  }
  function onPeerJoined(m: Msg) {
    if (m.pin && m.device) { peerDevices[m.pin] = m.device; setTileDevice("tile-" + m.pin, m.device); }
    if (m.pin && m.flag) { peerFlags[m.pin] = m.flag; setTileFlag("tile-" + m.pin, m.flag); }
    if (m.pin && m.role) { peerRoles[m.pin] = m.role as string; setTileRole("tile-" + m.pin, m.role as string); }
    refreshHostPanel();
    // The server's peer-joined is the AUTHORITATIVE "they answered" signal, and it
    // must drive the answer transition here rather than any media event: a media
    // event that never fires used to leave the caller at "Ringing…" forever while
    // the callee's side died with "couldn't connect media" — a zombie solo room
    // that auto-rejoin then resurrected. With callAnswered set here, both sides
    // fail (or recover) together.
    callAnswered = true;
    onCalleeAnswered();
    if (peers[m.pin!]) return;
    // Same as onJoined: adopt the fresh relay creds before creating the peer.
    if (m.iceServers && m.iceServers.length) {
      iceConfig = buildIceConfig(m.iceServers);
      diag("ice servers from peer-joined (" + m.iceServers.length + ")");
    }
    createPeer(m.pin!, m.name || "Guest", false);
  }


  // Remote-participant tiles reuse the existing #videoGrid DOM/CSS, keyed by the
  // peer's 6-digit pin.
  // Five rainbow bars that animate (equaliser) only while the tile is .speaking.
  const SOUND_WAVE_HTML = '<div class="sound-wave" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div>';
  // Placeholder (avatar + full name, shown when the camera is off) + an info
  // chip (device + live speed) used by every tile builder.
  /**
   * The ONE builder for every participant tile — remote (mesh + SFU), placeholder
   * and self. `pin` absent ⇒ no ⋮ menu, no maximize, no Add pill and no digits in
   * the band (you cannot add yourself, and the owner has said they do not need
   * their own number shown back to them).
   *
   * `avatarName` exists only for the SELF tile, whose band reads "You" while its
   * avatar must still show the person's own initials.
   */
  function tileContentHTML(
    name: string,
    device: string,
    flag: string,
    pin?: string,
    avatarName?: string
  ): string {
    const dev = device
      ? '<span class="ti-dev">' + escapeHtml(device) + "</span>"
      : '<span class="ti-dev"></span>';
    const fl = '<span class="nm-flag">' + (flag ? escapeHtml(flag) : "") + "</span>";
    // Host/co-host control: a ⋮ menu in the corner (shown only when #videoGrid is
    // .mod-on). Remote tiles only.
    const menuBtn = pin
      ? '<button class="tile-menu-btn" type="button" data-pin="' + escapeHtml(pin) + '" aria-label="Participant options" title="Options">⋮</button>'
      : "";
    // Screen-share MAXIMIZE (v2.99.8): a per-tile button revealed by CSS ONLY on
    // a .screen tile — toggles full-bleed of the shared screen (hide thumbs).
    const maxBtn = pin
      ? '<button class="tile-max-btn" type="button" data-pin="' + escapeHtml(pin) + '" aria-label="Maximize shared screen" title="Maximize / restore shared screen"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14h6v6M20 10h-6V4M14 10l6-6M10 14l-6 6"/></svg></button>'
      : "";
    // Add-to-contacts MARK (v2.99.8): under a REMOTE peer's name, when they
    // aren't a saved contact yet. `addContactMarkHTML` returns "" for saved
    // peers so the mark disappears the moment they're added.
    const addMark = pin ? addContactMarkHTML(pin, name) : "";
    // THE NAME APPEARS EXACTLY ONCE (v2.99.82, owner asked twice).
    //
    // This used to render it THREE times on one tile: the initials disc, then a
    // centred `.ph-name` under it, then again in the bottom `.nm` band. Owner,
    // with a marked-up screenshot circling all three: "you mentioned the name in
    // two places ... You don't need to repeat the name. You need to put the
    // profile picture or the avatar, and below it, you put add to contact if he
    // was not in your contact. and at the bottom of the border of the frame of the
    // user where you put the flag and you put his first name only, and beside, you
    // put the PIN number, the six digits without mention PIN."
    //
    // So: avatar (photo, or initials as the fallback) -> the Add pill if they are
    // not saved -> one bottom band carrying flag · first name · six digits.
    // `.ph-name` is GONE.
    //
    // FIRST NAME ONLY in the band, with the full name on `title` so nothing is
    // lost to a hover or a screen reader.
    const first = (name || "").trim().split(/\s+/)[0] || name;
    // The six digits raw — no "PIN" label, no grouping dash. `dir="ltr"` plus bidi
    // ISOLATION (the v2.99.77 PinTag lesson) so an Arabic first name beside it
    // cannot reorder the digits.
    const pinTag = /^\d{6}$/.test(pin || "")
      ? '<span class="nm-pin" dir="ltr">' + escapeHtml(pin as string) + "</span>"
      : "";
    return (
      // M26: `name` is a peer-chosen display name, so it is escaped. Escape the
      // initials too — the 2-char slice can't carry an event handler, but a bare
      // "<" still corrupts this row's parse.
      '<div class="ph"><div class="av">' + escapeHtml(initials(avatarName || name)) + "</div>" +
      SOUND_WAVE_HTML + "</div>" +
      '<div class="nm" title="' + escapeHtml(name) + '">' + fl +
      '<span class="nm-text">' + escapeHtml(first) + "</span>" + pinTag + "</div>" +
      addMark +
      '<div class="tile-info">' + dev + '<span class="ti-speed"></span></div>' +
      // v2.99.84: the active-speaker glow lives on its OWN overlay so the
      // animation can be opacity-only. Animating the tile's own box-shadow
      // repainted the whole tile — over LIVE VIDEO, so nothing cached — every
      // frame, six times over at the mesh cap. Static markup, no JS toggles it:
      // the `.speaking` class on the tile drives it in CSS, exactly as before.
      '<span class="spk-glow" aria-hidden="true"></span>' +
      menuBtn + maxBtn
    );
  }
  /** The per-tile "add to contacts" mark markup for a remote peer — empty when
   *  the peer is already saved (v2.99.8). Kept as its own function so a live
   *  saved-set change can re-render just the marks. */
  function addContactMarkHTML(pin: string, name: string): string {
    if (!/^\d{6}$/.test(pin) || savedContactPins.has(pin)) return "";
    return (
      '<button class="tile-addc" type="button" data-addc="' + escapeHtml(pin) +
      '" data-name="' + escapeHtml(name) + '" aria-label="Add ' + escapeHtml(name) +
      ' to contacts" title="Add to contacts">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/></svg>' +
      '<span>Add</span></button>'
    );
  }
  /** Re-render every tile's add-contact mark (after the saved set changes). */
  function refreshAllTileAddMarks() {
    const grid = $("videoGrid");
    if (!grid) return;
    grid.querySelectorAll(".relay-tile").forEach((tileEl) => {
      const tile = tileEl as HTMLElement;
      const id = tile.id || "";
      const pin = id.startsWith("tile-") ? id.slice(5) : "";
      if (!/^\d{6}$/.test(pin)) return; // self / non-pin tiles never get the mark
      const existing = tile.querySelector(".tile-addc");
      if (savedContactPins.has(pin)) {
        existing?.remove();
        return;
      }
      if (!existing) {
        const nameEl = tile.querySelector(".nm-text");
        const name = (nameEl?.textContent || "Guest").trim();
        const nm = tile.querySelector(".nm");
        if (nm) nm.insertAdjacentHTML("afterend", addContactMarkHTML(pin, name));
      }
    });
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
  // Remember (and display) each member's device type + flag: the maps are read when
  // a tile is created, and the live setters update tiles already on screen.
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
    // Unmuting with a DEAD mic (OS killed the track) actually reacquires — the
    // recovery toast tells users to "toggle mute to retry", so the toggle must
    // genuinely retry, not just flip `enabled` on a corpse.
    if (on && inCall && !localStream.getAudioTracks().some(t => t.readyState === "live")) {
      void recoverDeadLocalTrack("audio");
    }
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
      // A full-bleed maximize collapses back to the grid when its screen ends.
      if (screenMaximized && spotlightId === id) { screenMaximized = false; manualSpotlight = false; spotlightId = null; }
    }
    layoutGrid();
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => layoutGrid());
  }
  // A peer put this call on hold to take another call. Mark their tile + notify,
  // and give the HELD party an explicit audible cue (a low tone when put on hold,
  // a brighter rising "toot" when the call resumes).
  function onPeerHold(m: Msg) {
    const pin = m.pin || ""; if (!pin) return;
    const nm = nameOf(pin);
    if (m.on) {
      peersHoldingUs.add(pin);
      // The hold arrived — a pending "did they leave?" fuse is defused.
      cancelSoloEndGrace();
      // Their transport goes away when they take the other call, so by the time
      // this signal lands their tile may already have been removed — on EITHER
      // path (an SFU disconnect, or a mesh peer-left). Restore a name-only tile
      // so the roster still shows who is parked. This used to be SFU-only, which
      // is why a mesh conference lost the tile entirely (v2.99.67).
      ensurePlaceholderTile(pin, nm);
      document.getElementById("tile-" + pin)?.classList.add("on-hold");
      addSysMsg(nm + " put you on hold for another call.");
      toast(nm + " put you on hold.");
      playCue("hold");
    } else {
      peersHoldingUs.delete(pin);
      // THE REPORTED BUG: this only stripped the on-hold class, so if the tile
      // had been removed while they were away there was nothing to un-hold and
      // they came back as audio with no tile. Recreate it if it is missing; the
      // real tile replaces this placeholder as soon as their media arrives.
      ensurePlaceholderTile(pin, nm);
      document.getElementById("tile-" + pin)?.classList.remove("on-hold");
      addSysMsg(nm + " is back.");
      toast(nm + " is back.");
      playCue("resume");
    }
    updateOnHoldState();
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
    // Rides the existing 2s tick (v2.105.21) rather than arming its own timer.
    void collectCallQuality();
    // Mesh peers: inbound bitrate per remote tile.
    for (const pin in peers) {
      void sampleOneStats("in-" + pin, "tile-" + pin, peers[pin].pc, false);
    }
    // Self: outbound bitrate (from any one peer connection — same encode).
    const anyPeer = Object.values(peers)[0];
    if (anyPeer) void sampleOneStats("out-self", "tile-self", anyPeer.pc, true);
  }
  /* ── CALL QUALITY READOUT (v2.105.21) ──────────────────────────────────────
   * Owner: "I feel slowness in the voice and video calls." There was no way to
   * answer that — nothing reported RTT, loss, or whether media was going through a
   * TURN relay, so "slow" could not be turned into a diagnosis and a decision to
   * change SFU vendors would have rested on a feeling.
   *
   * NO SECOND POLLER, deliberately: `sampleStats` already runs every 2s while in a
   * call, is already gated on `inCall`, and already reaches BOTH transports' stats.
   * A parallel timer would double the getStats cost on the app's most expensive
   * screen for data the existing one is already fetching.
   *
   * OFF BY DEFAULT, and that matters: v2.99.67 removed the Diagnostics panel at the
   * owner's request because it was a permanent floater nobody had asked for. This
   * is opt-in and remembered, so it can be left on for a diagnosing session and
   * then forgotten about.
   */
  let statsShown = false;
  try { statsShown = localStorage.getItem("relay_call_stats") === "1"; } catch { /* private mode */ }
  let qualPrev: import("./callStats").ByteSample | null = null;
  /** Last thermal signature written to the diag log, so a 2s poller logs a CHANGE
   *  rather than a line every tick. */
  let qualLastSig = "";

  /**
   * Write the readout. `tone` picks the board-5c hue and defaults to neutral, so
   * a caller with nothing measured yet ("measuring…") cannot accidentally claim a
   * healthy call.
   *
   * The class is one of THREE COMPLETE LITERAL STRINGS, never composed: a
   * runtime-assembled class name is invisible to every grep and every build step,
   * and a rule for a class nobody sets renders nothing with all tests green.
   */
  function renderCallQuality(
    text: string,
    tone: import("./callStats").QualityTone = "neutral",
  ) {
    const el = document.getElementById("callQual");
    if (!el) return;
    el.style.display = statsShown ? "" : "none";
    if (!statsShown) return;
    el.textContent = text;
    el.className =
      tone === "good" ? "call-qual is-good" : tone === "warn" ? "call-qual is-warn" : "call-qual";
  }

  /** Gather every leg's stats report and reduce them through the ONE shared
   *  summarizer. Sharing it is the point: a second transport's numbers have to be
   *  directly comparable to these, or "is this one worse?" has no answer. */
  async function collectCallQuality() {
    if (!statsShown || !inCall) return;
    const { entriesOf, summarizeStats, formatCallStats, formatCallDetail, callStatsVerdict, callQualityTone } =
      await import("./callStats");
    const reports: import("./callStats").StatEntry[][] = [];
    for (const pin in peers) {
      try { reports.push(entriesOf(await peers[pin].pc.getStats())); }
      catch { /* one dead peer must not lose the rest */ }
    }
    try {
      const { stats, sample } = summarizeStats(reports, { prev: qualPrev, nowMs: Date.now() });
      qualPrev = sample;
      const v = callStatsVerdict(stats);
      /* TWO LINES, joined with a newline and rendered by `white-space: pre-line`:
         line 1 is how the call is GOING, line 2 what it is MADE OF. The detail line
         is omitted entirely when it has nothing to say, so an ordinary reading stays
         a one-line pill. `textContent`, never innerHTML — `encoderImplementation`
         and the codec name are browser-supplied strings and there is no reason to
         hand any of them to a parser. */
      const detail = formatCallDetail(stats);
      renderCallQuality(
        (v === "relay" ? "⚠ " : v === "poor" ? "▲ " : "") + formatCallStats(stats) +
          (detail ? "\n" + detail : ""),
        callQualityTone(stats),
      );
      /* THE DOC ASKS FOR THE THERMAL FIELDS IN THE DEBUG LOG AS WELL AS ON SCREEN
         ("add these three fields to the call debug logging"), and the log is what
         survives being copied out of a session. Logged only when it CHANGES, or a
         2s poller would bury every other line in the diag buffer. */
      const sig = `${stats.encoder ?? "-"}|${stats.limitedBy ?? "-"}|${stats.up?.fps ?? "-"}`;
      if (sig !== qualLastSig) {
        qualLastSig = sig;
        diag(`enc=${stats.encoder ?? "none"} limited=${stats.limitedBy ?? "none"} fps=${stats.up?.fps ?? "-"}`);
      }
    } catch { /* the readout is decoration — never let it disturb a call */ }
  }

  function toggleCallStats() {
    statsShown = !statsShown;
    try { localStorage.setItem("relay_call_stats", statsShown ? "1" : "0"); } catch { /* */ }
    // Clear the baseline so the first line after switching on is not a throughput
    // computed against a sample from minutes ago.
    qualPrev = null;
    renderCallQuality("measuring…");
    if (statsShown) void collectCallQuality();
  }

  function startStatsSampler() {
    if (statsSampleT) return;
    statsSampleT = setInterval(sampleStats, 2000);
  }
  function stopStatsSampler() {
    if (statsSampleT) { clearInterval(statsSampleT); statsSampleT = null; }
    for (const k in statsPrev) delete statsPrev[k];
  }
  // Clear a peer's slow-connect timer and revert the placeholder text/class.
  function clearSlowConnect(peer: PeerEntry) {
    if (peer.slowT) { clearTimeout(peer.slowT); peer.slowT = null; }
    if (!peer.el) return;
    peer.el.classList.remove("slow-connect");
    const c = peer.el.querySelector(".connecting") as HTMLElement | null;
    if (c) c.textContent = "connecting…";
  }
  // MESH bandwidth/CPU allocation: at 6 participants every client runs FIVE
  // independent video encoders — uncapped 720p30 × 5 saturates a laptop uplink
  // and melts phones (the "resource conflict at scale" a 6-party test feels as
  // random camera/audio degradation). Scale each sender's bitrate/resolution
  // with the party size; re-applied on every join/leave. Best-effort — older
  // browsers without setParameters simply keep default behaviour.
  //
  // v2.99.84 (owner: "my phone become verry hot whenever we have conference call
  // multiple parties"): bitrate and resolution were capped, FRAME RATE was not —
  // and encode cost scales roughly linearly with it, so five encoders at the
  // camera's native 30fps were doing twice the work of five at 15. That is the
  // largest CPU lever left on this path, and it also fixes the audio half of the
  // same report: a thermally throttled phone starves its AUDIO encoder too, which
  // is heard as choppy, unclear sound. Capping video is what protects voice.
  /* ASK FOR H.264 BEFORE VP8 ON EVERY VIDEO m-LINE — the biggest remaining
   * thermal lever, and a different one from applyMeshVideoCaps below (that caps
   * how MUCH we encode; this decides WHERE it is encoded).
   *
   * An iPhone has NO VP8 hardware encoder, so a VP8 call encodes on the CPU for
   * its whole duration, while H.264 goes to the dedicated VideoToolbox encoder
   * and is nearly free. Nothing in this codebase pinned a codec, so the stack
   * default applied — and MEASURED, Chromium offers VP8 FIRST. Since an answerer
   * normally adopts the OFFERER's order, a Chrome desktop dialling an iPhone
   * handed the phone software VP8. That asymmetry is why the heat was situational.
   *
   * IT REORDERS AND MUST NEVER RESTRICT. Passing a list that omits VP8 would make
   * us fail to negotiate video at all with a peer that has no H.264 — a dead tile
   * instead of a warm phone, which is worse. So every other codec is kept, just
   * after H.264. Empty/absent H.264 (this repo's own headless Chromium ships
   * none — measured `h264Variants: 0`) is a NO-OP rather than a throw: an empty
   * array resets preferences and a list missing required entries raises
   * InvalidModificationError.
   *
   * BASELINE, packetization-mode=1 FIRST among the H.264 variants (`42e01f` /
   * `42001f`), because that is the profile iPhone hardware actually encodes; a
   * high-profile entry first could land us back in software on the very device
   * this exists for. */
  function preferHardwareVideoCodec(pc: RTCPeerConnection) {
    try {
      const caps = (window.RTCRtpSender as unknown as {
        getCapabilities?: (k: string) => { codecs: RTCRtpCodec[] } | null;
      }).getCapabilities?.("video");
      const all = caps?.codecs;
      if (!all || !all.length) return;
      const isH264 = (c: RTCRtpCodec) => (c.mimeType || "").toLowerCase() === "video/h264";
      const h264 = all.filter(isH264);
      if (!h264.length) return;   // no hardware path to prefer — leave the default alone
      const baselineFirst = h264.slice().sort((a, b) => rankH264(a) - rankH264(b));
      const ordered = baselineFirst.concat(all.filter(c => !isH264(c)));
      pc.getTransceivers().forEach(tr => {
        const kind = tr.sender?.track?.kind || tr.receiver?.track?.kind;
        if (kind && kind !== "video") return;
        try {
          (tr as unknown as { setCodecPreferences?: (c: RTCRtpCodec[]) => void })
            .setCodecPreferences?.(ordered);
        }
        catch { /* older UA, or a codec set it will not accept — keep the default */ }
      });
      diag("codec pref: h264-first (" + h264.length + " variant" + (h264.length === 1 ? "" : "s") + ")");
    } catch { /* never let a preference tweak cost us the call */ }
  }
  /** Lower is better: baseline + packetization-mode=1 is what iPhone encodes in HW. */
  function rankH264(c: RTCRtpCodec): number {
    const f = (c.sdpFmtpLine || "").toLowerCase();
    const pm1 = f.includes("packetization-mode=1");
    const baseline = f.includes("profile-level-id=42e01f") || f.includes("profile-level-id=42001f");
    if (baseline && pm1) return 0;
    if (baseline) return 1;
    if (pm1) return 2;
    return 3;
  }

  function applyMeshVideoCaps() {
    const n = Object.keys(peers).length;
    const maxBitrate = n <= 1 ? 1_200_000 : n <= 3 ? 700_000 : 350_000;
    const scale = n <= 3 ? 1 : 2;
    // 1:1 keeps 30 — deliberately a real value equal to the source rate rather
    // than an absent field, because the party can SHRINK (6 → 2) and a cap left
    // undefined is not reliably cleared by every engine; assigning 30 back is
    // deterministic. So 1:1 is unchanged in effect while remaining reversible.
    const maxFramerate = n <= 1 ? 30 : n <= 3 ? 24 : 15;
    for (const id in peers) {
      peers[id].pc.getSenders().forEach(s => {
        if (!s.track) return;
        // AUDIO: never rate-capped (it is a rounding error beside video), but
        // marked HIGH priority so that when the uplink or the CPU runs short the
        // engine sheds VIDEO and keeps the voice intact. On a mesh this is the
        // difference between a call that goes blurry and one that goes unusable.
        if (s.track.kind === "audio") {
          try {
            const pa = s.getParameters();
            if (!pa.encodings || pa.encodings.length === 0) return; // nothing to mark
            pa.encodings[0].priority = "high";
            (pa.encodings[0] as { networkPriority?: string }).networkPriority = "high";
            void s.setParameters(pa);
          } catch { /* unsupported → engine default, which is still fine */ }
          return;
        }
        if (s.track.kind !== "video") return;
        try {
          const p = s.getParameters();
          if (!p.encodings || p.encodings.length === 0) p.encodings = [{} as RTCRtpEncodingParameters];
          p.encodings[0].maxBitrate = maxBitrate;
          p.encodings[0].scaleResolutionDownBy = scale;
          p.encodings[0].maxFramerate = maxFramerate;
          void s.setParameters(p);
        } catch { /* per-sender best effort */ }
        // SEPARATE call, and that separation is the point: `degradationPreference`
        // is a TOP-LEVEL field that some engines reject outright, and a rejected
        // setParameters discards the WHOLE object — so folding it in above would
        // silently lose the bitrate/framerate caps on exactly the browsers that
        // most need them. "balanced" lets the encoder shed resolution as well as
        // frames under CPU pressure; the common default of maintain-framerate is
        // precisely wrong on a thermally throttled phone.
        try {
          const p2 = s.getParameters() as RTCRtpSendParameters & { degradationPreference?: string };
          p2.degradationPreference = "balanced";
          void s.setParameters(p2);
        } catch { /* engine has no opinion setting — keep its default */ }
      });
    }
  }
  function createPeer(pin: string, name: string, initiator: boolean): PeerEntry {
    if (name) peerNamesSeen[pin] = name;
    if (peers[pin]) return peers[pin];
    callAnswered = true; // a second party exists — the join watchdog may enforce media
    onCalleeAnswered();  // outgoing dial: "Ringing…" → the real connecting sequence
    if (Object.keys(peers).length >= 1) callIsGroup = true; // 2nd remote → conference
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
      // Mutual-consent gate (mesh): un-approved 1:1 video rides NOTHING — the
      // always-negotiated null-track transceiver below keeps the m-line ready
      // for the moment consent arrives (replaceVideoEverywhere fills it).
      const consentOk = videoApproved || callIsGroup;
      const vtrack = sharing
        ? (screenStream!.getVideoTracks()[0] || null)
        : (consentOk ? (sendStream.getVideoTracks()[0] || null) : null);
      // Group the video under sendStream's msid (same stream id as the audio),
      // even while screen-sharing — the transmitted track is still `vtrack` (the
      // screen). Grouping it under a SEPARATE stream (screenStream) gave audio and
      // video two different msids, so a mid-share joiner's ontrack fired twice with
      // two `e.streams[0]` and attachRemote's `v.srcObject = stream` kept only the
      // last → silent audio OR a black tile for whoever joined during a share.
      if (vtrack) pc.addTrack(vtrack, sendStream);
      // NO video track to send right now (no camera, or 1:1 consent not yet
      // given): the OFFERER still negotiates a VIDEO m-line — sendrecv with a
      // null-track sender — because an SDP answer can't add one later. The
      // null-track sender is the slot replaceVideoEverywhere fills when the
      // camera is (re)acquired or consent arrives. ONLY the initiator: on the
      // ANSWERER, an addTransceiver slot is never associated with the offered
      // m-line (it stays an mid-less ORPHAN that swallowed the camera track);
      // the answerer's slot comes from the offer itself, flipped to sendrecv
      // in onSignal before the answer is created.
      else if (initiator) pc.addTransceiver("video", { direction: "sendrecv" });
    }
    // THE THERMAL FIX: ask for H.264 before VP8 on every video m-line.
    preferHardwareVideoCodec(pc);
    // Party-size-scaled encoder caps (see applyMeshVideoCaps). Deferred a tick
    // so the freshly-added senders are queryable.
    setTimeout(applyMeshVideoCaps, 0);
    pc.onicecandidate = e => {
      if (e.candidate) {
        sendWS({ type: "signal", to: pin, data: { candidate: e.candidate } });
        diag("local cand " + pin.slice(-4) + " " + (e.candidate.candidate || "").split(" ")[7]);
      } else {
        diag("local cand-end " + pin.slice(-4));
      }
    };
    pc.ontrack = e => {
      diag("ontrack from " + pin.slice(-4) + (e.streams?.length ? "" : " (msid-less)"));
      const s = e.streams && e.streams[0];
      if (s) { attachRemote(pin, s); return; }
      // MSID-LESS m-line — e.g. a peer's null-track video transceiver (their
      // camera was absent at join). e.streams is EMPTY here; blindly passing
      // e.streams[0] handed attachRemote `undefined`, which wiped the tile's
      // srcObject and with it the peer's ALREADY-ATTACHED AUDIO — one
      // camera-less participant silently killed their own audio for everyone.
      // Merge the bare track into the tile's existing stream instead.
      // Accumulate onto the entry's own record of the remote stream. This used
      // to read the tile <video>'s srcObject as the accumulator, which stopped
      // being the whole picture in v2.106.51 when audio moved to its own
      // element — the <video> now holds video tracks only, so merging onto it
      // would have quietly dropped this peer's audio.
      const cur = peers[pin]?.remoteStream || null;
      const merged = cur || new MediaStream();
      try { if (e.track) merged.addTrack(e.track); } catch { /* dup add — fine */ }
      attachRemote(pin, merged);
    };
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
        ensureApprovedVideoFlowing(); // consent may have landed before this pc existed
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
  /* THE VOICE-MODE AUDIO PROFILE, applied to our own SDP before it goes on the wire.
   * Owner spec: Opus, 24-32 kbps, DTX on, FEC on, ptime 20 - and IDENTICAL in voice and
   * video mode, so this runs on every description rather than only on voice calls.
   *
   * MEASURED, BOTH WAYS, BECAUSE THE OBVIOUS MECHANISM SILENTLY DOES NOTHING:
   * `RTCRtpSender.setParameters` with `encodings[0].dtx` is ACCEPTED without throwing
   * and then DROPPED - the key is absent when read straight back, so an API-level
   * version of this would have read as done and changed nothing. SDP is the only
   * mechanism that works here.
   *
   * TWO OF THE FIVE WERE ALREADY TRUE and are left alone: a real call already reports
   * `useinbandfec=1` (FEC) and `targetBitrate: 32000`, both Chromium defaults. What is
   * genuinely added is `usedtx=1` and `a=ptime:20`, plus an explicit
   * `maxaveragebitrate` so the 32 kbps ceiling is OURS rather than a default that could
   * move.
   *
   * DTX IS A RECEIVER PREFERENCE, which is why BOTH sides must ask: `usedtx=1` in our
   * SDP tells the PEER to use DTX when sending to us. Since our code runs on both ends,
   * tuning the offer AND the answer is what turns it on in both directions - verified,
   * both peers' outbound codec reading
   * `maxaveragebitrate=32000;minptime=10;usedtx=1;useinbandfec=1`.
   *
   * IT FAILS TOWARD THE UNTOUCHED ORIGINAL, and that is the whole safety argument: this
   * sits on the offer/answer path of EVERY call, so a regex that misfires would break
   * calling outright. No recognisable Opus fmtp line => the SDP is returned BYTE-
   * IDENTICAL; anything thrown => the original. Verified against garbage SDP, empty
   * SDP, and already-tuned SDP (idempotent, which matters because a renegotiation
   * re-runs this). */
  /* 32 kbps is the TOP of the owner's 24-32 band, and a CEILING rather than a target:
   * Opus is variable-rate, so this caps the peak while DTX and silence take the average
   * well below it. 20ms ptime is the spec's value and Opus's own default frame size. */
  const OPUS_MAX_BITRATE = 32_000;
  const OPUS_PTIME_MS = 20;
  const OPUS_FMTP_RE = /^(a=fmtp:(\d+) ([^\r\n]*\buseinbandfec=1\b[^\r\n]*))$/m;
  function tuneOpusSdp(sdp: string | null | undefined): string {
    const src = typeof sdp === "string" ? sdp : "";
    try {
      if (!src) return src;
      const m = src.match(OPUS_FMTP_RE);
      if (!m) return src;                       // not recognisable - do not touch it
      let line = m[1];
      if (!/\busedtx=/.test(line)) line += ";usedtx=1";
      if (!/\bmaxaveragebitrate=/.test(line)) line += ";maxaveragebitrate=" + OPUS_MAX_BITRATE;
      let next = src.replace(OPUS_FMTP_RE, line);
      if (!/^a=ptime:/m.test(next)) {
        next = next.replace(
          new RegExp("^(a=rtpmap:" + m[2] + " opus/48000/2)$", "m"),
          "$1\r\na=ptime:" + OPUS_PTIME_MS,
        );
      }
      return next;
    } catch { return src; }
  }
  /** THE ONE FUNNEL. Every setLocalDescription goes through here, so a site added later
   *  inherits the profile instead of quietly publishing untuned SDP. */
  async function setLocalTuned(pc: RTCPeerConnection, desc: RTCSessionDescriptionInit) {
    await pc.setLocalDescription({ type: desc.type, sdp: tuneOpusSdp(desc.sdp) } as RTCSessionDescriptionInit);
  }

  async function callPeer(pin: string, name: string) {
    const peer = createPeer(pin, name, true);
    try {
      const offer = await peer.pc.createOffer();
      await setLocalTuned(peer.pc, offer);
      sendWS({ type: "signal", to: pin, data: { sdp: peer.pc.localDescription } });
    } catch (e) { console.warn("offer error", e); }
  }
  async function onSignal(from: string, data?: Msg["data"], frameRoom?: string | null) {
    if (!data) return;
    // v2.99.57 — a signal authorized by a HELD room must never reach the live
    // call's media. See `signalDisposition` for the bypass this closes.
    const disp = signalDisposition({
      frameRoom,
      roomId,
      heldRoomId,
      hasHeldPeer: !!heldPeers[from],
    });
    if (disp === "drop") {
      diag("signal dropped (room " + (frameRoom || "?") + " is not ours)");
      return;
    }
    if (disp === "held") {
      // The held call's peers are frozen by design; a renegotiation for a parked
      // call is not something we act on, and it must NOT be allowed to build a
      // peer around the stream the ACTIVE call is using.
      diag("signal for held room ignored (peer is parked)");
      return;
    }
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
          // Answer every offered VIDEO m-line as sendrecv even while we have
          // nothing to send yet (camera off / consent pending). The default
          // answer direction is recvonly, which would LOCK this side out of
          // ever sending video without a renegotiation — the consented camera
          // later rides in via plain replaceTrack.
          peer.pc.getTransceivers().forEach(tr => {
            if (tr.receiver?.track?.kind === "video" && tr.direction === "recvonly") {
              try { tr.direction = "sendrecv"; } catch { /* older UAs — best effort */ }
            }
          });
          // THE ANSWERER HALF OF THE THERMAL FIX, and it is the half that matters
          // most: the OFFERER's preference order is what an answerer normally
          // adopts, so a Chrome desktop calling an iPhone would otherwise hand the
          // phone VP8 (measured: Chromium offers VP8 first) and the phone would
          // encode it in SOFTWARE. Re-stating our own preference before the answer
          // is what lets the phone answer in H.264.
          preferHardwareVideoCodec(peer.pc);
          const answer = await peer.pc.createAnswer();
          await setLocalTuned(peer.pc, answer);
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
  /** Stop and drop a peer's own <audio> (v2.106.51).
   *
   *  Removing the tile takes the element out of the DOM with it, but a detached
   *  media element with a live srcObject can KEEP PLAYING in Chrome — so a
   *  departed peer could still be heard. Closing the pc ends their tracks, which
   *  covers it in practice; this makes it true by construction instead. ONE
   *  helper because there are TWO teardown paths (active and held) and a rule
   *  living at each call site is a rule one of them eventually forgets. */
  function releasePeerAudio(e: PeerEntry) {
    const ae = e.audioEl;
    e.remoteStream = null;
    if (!ae) return;
    try { ae.pause(); } catch { /* */ }
    try { ae.srcObject = null; } catch { /* */ }
    try { ae.remove(); } catch { /* */ }
    e.audioEl = null;
  }
  function removePeer(pin: string, quiet = false) {
    // A genuine departure clears any "they put us on hold" state for the pin
    // (quiet rebuilds — ICE-restart re-offers — keep it; the peer isn't gone).
    if (!quiet) {
      peersHoldingUs.delete(pin);
      updateOnHoldState();
    }
    // A member of the HELD call left (their hang-up while we're on the other
    // line). Clean it out of the held bucket; if the held call is now empty,
    // clear the hold so the "on hold" bar disappears.
    if (heldPeers[pin]) {
      const h = heldPeers[pin];
      if (h.graceT) { clearTimeout(h.graceT); h.graceT = null; }
      if (h.restartT) { clearTimeout(h.restartT); h.restartT = null; }
      try { h.pc.close(); } catch { /* */ }
      releasePeerAudio(h);
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
    releasePeerAudio(e);
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
    applyMeshVideoCaps(); // fewer parties → raise per-sender quality again
    // `quiet` skips the "X left the call" notice — used when we're immediately
    // rebuilding the peer (a refresh/reconnect re-offer), not a genuine leave.
    // Surface it as a visible toast too (the chat drawer is closed by default,
    // so the system message alone is invisible during a call).
    if (inCall && !quiet) {
      addSysMsg((nm || "Someone") + " left the call.");
      toast((nm || "Someone") + " left the call.");
    }
    // 1:1: the other party leaving ENDS the call (like a phone). Lingering in
    // a dead solo call swallowed the next incoming ring as call-waiting.
    // Groups keep the room open (the host may ring more people in).
    if (inCall && !quiet && !callIsGroup && callAnswered && aloneInCall()) {
      // If a call is HELD, the far side leaving the ACTIVE 1:1 must RESUME the
      // held call — not tear everything down. `hangUp` would `dropHeld()` a
      // perfectly live parked call; `endActiveLine()` promotes the held one
      // (server `end-active` → `resumed`). Only a true no-held case hangs up.
      if (heldRoomId) {
        toast("Call ended — resuming your held call…");
        endActiveLine();
      } else {
        toast("Call ended.");
        hangUp("remote-left");
      }
    }
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
      // An ESTABLISHED peer that goes disconnected/failed must SHOW a status (not
      // freeze silently on its last frame) — so the survivor sees "reconnecting…"
      // during the grace window before a genuine drop is torn down. Only suppress
      // the overlay for healthy/pending states.
      const broken = st === "failed" || st === "disconnected";
      if (!broken && (st === "connected" || peer.gotStream)) {
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
      await setLocalTuned(peer.pc, offer);
      sendWS({ type: "signal", to: pin, data: { sdp: peer.pc.localDescription } });
    } catch (e) { console.warn("ice restart failed", e); }
  }
  // v2.99.36: the on-screen Diagnostics panel was removed (owner request).
  // diag() above keeps the in-memory rolling event log for console debugging.

  // ---------- video grid ----------
  // ---------- live connection status + 10s reconnect window ----------
  // The top bar shows a REAL status (connecting → encrypting → live, or
  // reconnecting), not a scripted animation. If the call drops after it was
  // live, we hold the call open and try to recover for RECONNECT_WINDOW_MS
  // before tearing down — so a brief tunnel/elevator/Wi-Fi blip doesn't kill
  // the call.
  type CallStatus = "calling" | "ringing" | "connecting" | "encrypting" | "live" | "reconnecting";
  let callStatus: CallStatus = "connecting";
  let establishedOnce = false; // reached "live" at least once this call
  let reconnectHardT: ReturnType<typeof setTimeout> | null = null;
  let reconnectTickT: ReturnType<typeof setInterval> | null = null;
  let connSeqTimers: ReturnType<typeof setTimeout>[] = [];
  const RECONNECT_WINDOW_MS = 10000;
  const STATUS_LABEL: Record<CallStatus, string> = {
    calling: "Calling…",
    ringing: "Ringing…",
    connecting: "Connecting…",
    encrypting: "Securing connection…",
    live: "Connected",
    reconnecting: "Reconnecting…",
  };
  const ALL_ST_CLASSES = ["st-calling", "st-ringing", "st-connecting", "st-encrypting", "st-live", "st-reconnecting"];
  function setCallStatus(s: CallStatus, labelOverride?: string) {
    callStatus = s;
    const text = labelOverride ?? STATUS_LABEL[s];
    const lbl = $("callRoomLbl");
    if (lbl) lbl.textContent = text;
    const ct = $("call")?.querySelector(".call-head .ct");
    if (ct) {
      ct.classList.remove(...ALL_ST_CLASSES);
      ct.classList.add("st-" + s);
    }
    // Mirror the live status onto the pre-connect dial card (its own status
    // line sits under the callee identity, like a phone's dialing screen).
    const dst = $("dcStatusTxt"); if (dst) dst.textContent = text;
    const card = $("dialCard");
    if (card) {
      card.classList.remove(...ALL_ST_CLASSES);
      card.classList.add("st-" + s);
    }
  }
  function clearConnSeq() {
    connSeqTimers.forEach(t => clearTimeout(t));
    connSeqTimers = [];
  }
  // Honest terminal state for a FAILED outgoing dial. The old abrupt teardown
  // hid the reason entirely: the toast lives inside the engine root, which the
  // host parks at opacity-0 the instant the phase flips to idle — so a dial
  // that died as offline/declined/busy looked like a silent two-second glitch.
  // Hold the dial card up with the outcome for a beat, THEN tear down.
  let failDialT: ReturnType<typeof setTimeout> | null = null;
  function clearFailDial() {
    if (failDialT) { clearTimeout(failDialT); failDialT = null; }
  }
  function failDial(message: string, reason: string) {
    groupDialOutstanding = null;
    if (failDialT) return; // already presenting a failure
    if (!inCall || establishedOnce || !outgoingDial) { hangUp(reason); return; }
    clearDialTimeout();
    stopRingtone();
    // Voicemail-eligible outcomes (v2.88): a 1:1 dial that never connected
    // because they didn't answer / declined / are offline. Tell the host —
    // it raises the "Leave a voice message / alert me when online" card once
    // the engine finishes tearing down. Groups and self-inflicted failures
    // (media denied, server errors other than offline) don't qualify.
    const d = outgoingDial;
    // v2.99.11: "server-error:offline" now DOES raise the leave-a-message card.
    // Paging was retired (owner: an offline user must not be auto-rung), so a
    // real offline callee ends as server-error:offline within one round-trip and
    // the identity provably EXISTS — so openThread-by-number succeeds and the
    // voice/text message is deliverable. A NONEXISTENT number returns the
    // distinct "server-error:nonexistent" reason, which is excluded (no thread
    // to send to), and so is v2.99.47's "server-error:unavailable" (the offline-
    // dial throttle fires before the number is resolved, so existence is
    // unproven and a recorded message would have nowhere to go).
    // "no-answer"/"peer-rejected" still qualify as before.
    if (
      d && !d.group &&
      (reason === "no-answer" || reason === "peer-rejected" || reason === "server-error:offline")
    ) {
      try { onDialFailed?.({ pin: d.pin, name: d.name ?? null, reason }); } catch { /* host errors never break teardown */ }
    }
    setCallStatus("calling", message); // renders on the dial card status line
    failDialT = setTimeout(() => {
      failDialT = null;
      hangUp(reason);
    }, 1900);
  }
  // Drive connecting → encrypting while the transport comes up; the real "live"
  // flip happens when a peer / the SFU actually connects.
  /**
   * What is ACTUALLY missing right now, in words the caller can act on.
   *
   * "Securing connection…" was announced on a 600ms timer with no relation to
   * any DTLS or ICE state, so a stuck call reported a specific-sounding phase it
   * may never have reached — and the owner staring at it for seventeen seconds
   * had no way to tell what had failed. On the SFU path in particular the claim
   * is simply false: the caller joined the room at dial time, so nothing is being
   * "secured" — we are waiting for the other side's media to arrive, which is a
   * different problem with a different fix.
   *
   * The STATE stays `encrypting` (it drives the `st-encrypting` styling); only the
   * text is derived from what is really true.
   */
  function establishingLabel(): string {
    // The transport really is in the ICE/DTLS phase here, which is what the wording
    // describes. It is a function rather than the constant because it was ONCE a
    // claim that could be false — a caller already inside an SFU room is not
    // "securing" anything, it is waiting on the other side's media — and whichever
    // transport comes next must be able to say so again rather than inheriting a
    // sentence that no longer applies to it.
    return STATUS_LABEL.encrypting;
  }
  function runConnSequence() {
    clearConnSeq();
    setCallStatus("connecting");
    connSeqTimers.push(setTimeout(() => {
      if (callStatus === "connecting") setCallStatus("encrypting", establishingLabel());
    }, 600));
  }
  // Register the call with the OS media session. This (a) tells Android the tab
  // is actively playing media — one of the signals that helps a backgrounded tab
  // keep its audio alive — and (b) surfaces lock-screen / notification-shade
  // controls that map to our in-call actions. Purely additive + feature-detected.
  function updateMediaSession(active: boolean) {
    try {
      const ms = (navigator as unknown as { mediaSession?: MediaSession }).mediaSession;
      if (!ms) return;
      // The DOM lib doesn't yet type the newer call actions (hangup/toggle*), so
      // route setActionHandler through a string-typed shim.
      const ms2 = ms as unknown as {
        setActionHandler: (a: string, h: (() => void) | null) => void;
      };
      if (!active) {
        try { ms.metadata = null; } catch { /* */ }
        try { ms.playbackState = "none"; } catch { /* */ }
        for (const a of ["hangup", "togglemicrophone", "togglecamera", "play", "pause"]) {
          try { ms2.setActionHandler(a, null); } catch { /* unsupported action — ignore */ }
        }
        return;
      }
      try {
        const MM = (window as unknown as { MediaMetadata?: typeof MediaMetadata }).MediaMetadata;
        if (MM) ms.metadata = new MM({ title: "In call", artist: "RELAY" });
      } catch { /* */ }
      try { ms.playbackState = "playing"; } catch { /* */ }
      const set = (a: string, h: () => void) => { try { ms2.setActionHandler(a, h); } catch { /* unsupported — ignore */ } };
      set("hangup", () => hangUp("media-session"));
      set("togglemicrophone", () => toggleMic());
      set("togglecamera", () => toggleCam());
      // No-op play/pause so the OS control can't pause our audio element.
      set("play", () => { try { void loudspeakerCtx?.resume(); } catch { /* */ } });
      set("pause", () => { /* keep the call audible — ignore an OS pause */ });
    } catch { /* mediaSession fully unsupported — no-op */ }
  }
  // We reached a live media connection. Cancel any reconnect window and show it.
  // This is the AUTHORITATIVE "the call is actually connected" signal — it fires
  // from the peer-connection state machine, not a timer. So it's the one reliable
  // place to (a) silence the ring
  // and (b) flip the phase to "in-call". Without this the OUTGOING caller stayed
  // in phase "dialing" for the whole call, and on iOS (Safari throttles the
  // timer-driven stopRingtone in the background) the ring/animation persisted
  // even after the conversation was live. Both calls are idempotent.
  function markEstablished() {
    establishedOnce = true;
    clearEstablishDeadline(); // media is real — the deadline has done its job

    exitPreConnect();        // ONLY now does the full in-call interface appear
    exitReconnecting();
    clearConnSeq();
    stopRingtone();          // definitively kill any outgoing dial tone
    emitPhase("in-call");    // caller: leave "dialing" so the ring UI clears
    updateMediaSession(true); // OS "active media" signal + lock-screen controls
    if (callStatus !== "live") setCallStatus("live");
    // NATIVE ANDROID APP: enter OS call mode + start the ongoing-call
    // foreground service (Android never freezes a live call), then apply the
    // remembered speaker state through the REAL AudioManager route.
    if (isNativeAndroid()) {
      void nativeSetInCall(true);
      if (loudspeakerPref() && !loudspeakerOn) {
        void nativeSetSpeaker(true).then(ok => {
          if (ok) { loudspeakerOn = true; updateAudioBtn(); }
        });
      }
      return;
    }
    // PHONES (browser/TWA/iOS): apply the remembered speakerphone state the
    // moment the call is live (default ON — see loudspeakerPref; the
    // Answer/dial tap already primed the context inside a real gesture so this
    // resume sticks). If the context still isn't running, enable() refuses to
    // mute anything — the worst case is exactly the old earpiece behavior,
    // never silence.
    if ((IS_IOS || IS_ANDROID) && loudspeakerPref() && !loudspeakerOn) {
      void loudspeakerEnable().then(ok => { if (ok) updateAudioBtn(); });
    }
  }
  // WE own recovery (ICE restarts + signaling), so we run a hard 10s window with a
  // visible countdown and tear the call down if it doesn't recover. An SFU that
  // drives its own, longer retry loop must NOT be given this timer — racing it kills
  // a reconnection that was working — so a future transport needs its own path here
  // rather than reusing this one.
  function enterReconnecting() {
    if (!inCall || !establishedOnce) return;
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
    if (!inCall || !establishedOnce) return;
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
  function enterCallUI(label: string, opts?: { outgoing?: boolean }) {
    show("call");
    establishedOnce = false;
    exitReconnecting();
    resetSpeakerView(); // fresh call → no stale spotlight/active-speaker focus
    startStatsSampler(); // live per-tile bitrate
    void seedAudioOutputs(); // snapshot outputs so a later BT connect is detected
    if (opts?.outgoing) {
      // OUTGOING dial: staged progress — "Calling…" now, "Ringing…" on the
      // server's delivery ack, and the real connecting sequence only once the
      // callee answers (onCalleeAnswered). Show the dedicated dial card.
      setCallStatus("calling");
      showDialCard();
      armDialTimeout();
    } else {
      // Callee accept / rejoin / resume: the session starts establishing now.
      exitPreConnect(); // never carry a stale dial card into a non-dial entry
      runConnSequence();
    }
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
    // iOS Safari reads the ATTRIBUTE form of playsinline (and older iOS the
    // webkit- one); without it the self-preview goes fullscreen-or-blank instead
    // of rendering inline — the reported "self-mirror doesn't show on iPhone".
    v.setAttribute("playsinline", "");
    v.setAttribute("webkit-playsinline", "");
    // Show the PROCESSED stream in the self-tile so the user sees their filter
    // exactly as the remote peer will see it.
    v.srcObject = processedStream || localStream;
    // iOS: autoplay of a freshly-attached MediaStream is unreliable — kick it
    // explicitly (muted + inline, so the autoplay policy allows it). Harmless
    // where autoplay already works.
    void v.play().catch(() => {});
    t.appendChild(v);
    // ONE builder for every tile (v2.99.82). This used to hand-roll the same DOM,
    // which is how it kept its own duplicate `.ph-name` after the remote tiles
    // lost theirs. Passing no `pin` means it gets no ⋮ menu, no maximize button
    // and no Add pill — you cannot add yourself — and the self tile therefore
    // inherits every future change to the shared shape for free.
    //
    // Own number in the band, like everyone else's: the owner's rule is the band
    // carries flag · first name · six digits, and "You" plus your own PIN is what
    // that means for the self tile.
    t.insertAdjacentHTML(
      "beforeend",
      tileContentHTML("You", detectDeviceType(), selfFlag || "", undefined, me.name || "You")
    );
    grid.appendChild(t);
    if (!camOn) t.classList.add("audio-only");
  }
  /**
   * A NAME-ONLY tile for someone who is in the call but has no media right now
   * (v2.99.67). The case that needed it: in a conference, a participant answers
   * another line — which tears down their transport, so `peer-left` / an SFU
   * disconnect removes their tile — and then comes back. Audio returned, but
   * their tile did not, so the owner reported "he keep hearing [him], but his
   * profile is disappeared".
   *
   * `addTile` cannot do this job: it requires a live `peers[id]` entry, which is
   * exactly what no longer exists after the teardown. `addLkTile` only exists on
   * the SFU path. So this makes a bare tile on EITHER transport, marked
   * `data-ph` so the real tile can replace it rather than duplicate the id.
   */
  function ensurePlaceholderTile(id: string, name: string) {
    if (!inCall || !id) return;
    if (document.getElementById("tile-" + id)) return;
    const grid = $("videoGrid"); if (!grid) return;
    if (name) peerNamesSeen[id] = name;
    const t = document.createElement("div");
    t.className = "relay-tile";
    t.id = "tile-" + id;
    t.dataset.ph = "1";
    t.insertAdjacentHTML("beforeend", tileContentHTML(name || nameOf(id), peerDevices[id] || "", peerFlags[id] || "", id));
    grid.appendChild(t);
    layoutGrid();
  }
  /** Drop a placeholder so a REAL tile with the same id can take its place. */
  function dropPlaceholderTile(id: string) {
    const el = document.getElementById("tile-" + id);
    if (el && el.dataset.ph === "1") el.remove();
  }

  function addTile(id: string, name: string) {
    if (!inCall) return;
    const entry = peers[id]; if (!entry || entry.el) return;
    dropPlaceholderTile(id);
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
    if (!stream) return; // defensive: never wipe a tile with a missing stream
    const entry = peers[id]; if (!entry) return;
    if (!entry.el) addTile(id, entry.name);
    if (!entry.el) return;
    entry.gotStream = true;
    clearSlowConnect(entry);
    entry.remoteStream = stream;
    const v = entry.el.querySelector("video") as HTMLVideoElement | null;
    // ── AUDIO GETS ITS OWN ELEMENT. THIS IS NOT A TIDY-UP. ───────────────────
    // Audio used to ride the tile's <video> (`v.srcObject = stream`), and that
    // made every voice call SILENT. Measured, in this browser, 6 runs of 6:
    // inbound totalAudioEnergy EXACTLY 0 while ~508 audio packets/side arrived
    // with 0 loss; the same counter reads 2.3-3.5 on a call with video.
    //
    // WHY: the offerer always negotiates a null-track video m-line for the
    // mutual-consent slot (see createPeer), so on a voice call the remote
    // stream carries a video track that will never deliver a frame. A <video>
    // cannot reach HAVE_METADATA without dimensions, and a frameless track
    // supplies none — so the element parks at readyState 0 with the trace
    // `emptied -> play -> waiting`, its play() promise NEVER SETTLES, and the
    // audio sitting in the same stream is never played out. Confirmed with a
    // zero-RELAY-code loopback: audio-only -> a <video> plays; audio + a
    // sendrecv video transceiver with NO track -> the <video> stalls exactly
    // like this; the SAME stream handed to an <audio> plays.
    //
    // The trigger is "no incoming video frames", so this was NEVER only about
    // voice mode: it also covered every 1:1 video dial before consent (v2.81
    // means no camera transmits yet) and any group participant with their
    // camera off. And it bites hardest via the mesh, which is exactly where
    // v2.106.48's new SFU fallback lands a call.
    //
    // The SFU path already got this right — it attaches per track (see
    // TrackSubscribed) — so this makes the two transports agree.
    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length) {
      let ae = entry.audioEl;
      if (!ae) {
        ae = document.createElement("audio");
        ae.autoplay = true;
        ae.style.display = "none";
        // A child of the tile, so peer teardown removes it with the tile. It is
        // IN the document deliberately: a detached element is not a reliable
        // playout path on Android Chrome (the reason the SFU path inserts too).
        entry.el.appendChild(ae);
        entry.audioEl = ae;
      }
      ae.srcObject = new MediaStream(audioTracks);
      void applyAudioSink(ae);
      // Android Chrome gates an unmuted element's autoplay until an explicit
      // play(). If play() is rejected (no user gesture yet), arm a one-tap
      // recovery so incoming audio is never stuck silent.
      void ae.play().catch(() => armAudioUnlock());
      if (loudspeakerOn) routeElToLoudspeaker(ae);
    }
    if (v) {
      // VIDEO ONLY. Handing it the audio too is the defect above; and it must
      // still receive the frameless consent track, because a mid-call camera-on
      // arrives by replaceTrack on that same track object (no new ontrack), so
      // dropping it here would mean the camera never appears.
      v.srcObject = new MediaStream(stream.getVideoTracks());
      void v.play().catch(() => armAudioUnlock());
    }
    const c = entry.el.querySelector(".connecting") as HTMLElement | null;
    if (c) c.style.display = "none";
    // Tap the remote audio for active-speaker metering (mesh path only).
    registerMeshAnalyser(id, stream);
    const sync = () => {
      // A REMOTE track's `.enabled` is the receiver-side flag (always true) —
      // the sender turning their camera off surfaces here as `muted` (no
      // frames arriving). Checking only enabled/readyState kept the tile on
      // the FROZEN last frame when a peer disabled their camera (or their
      // uplink stalled), which testers read as "their camera is dead/stuck".
      // `!tr.muted` flips the tile to the avatar until frames actually flow.
      // AND the element must have real frames (videoWidth > 0): the always-
      // negotiated consent m-line delivers a live-but-silent track during
      // voice calls, which otherwise painted a BLACK tile instead of the
      // avatar. The `resize` listener below re-syncs when frames start.
      const hasLiveTrack = stream.getVideoTracks().some(tr => !tr.muted && tr.enabled && tr.readyState === "live");
      const has = hasLiveTrack && ((v?.videoWidth || 0) > 0);
      const ph = entry.el!.querySelector(".ph") as HTMLElement | null;
      if (ph) ph.style.display = has ? "none" : "flex";
    };
    v?.addEventListener("resize", sync);
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
      // Screen-share MAXIMIZE (v2.99.8): only meaningful when the focused tile
      // is actually a screen share; a maximize with thumbs hidden = full-bleed.
      const maxNow = screenMaximized && screenShareIds.has(plan.focusId);
      g.classList.toggle("screen-max", maxNow);
      const cols = Math.max(plan.thumbIds.length, 1);
      g.style.gridTemplateColumns = maxNow ? "1fr" : "repeat(" + cols + ",minmax(0,1fr))";
      g.style.gridTemplateRows = maxNow || !plan.thumbIds.length ? "1fr" : "minmax(0,1fr) 22%";
      const spot = byId(plan.focusId);
      if (spot) { spot.classList.add("is-spotlight"); spot.style.gridColumn = "1 / -1"; spot.style.gridRow = maxNow ? "1 / -1" : "1"; }
      plan.thumbIds.forEach(id => {
        const t = byId(id);
        if (t) { t.classList.add("is-thumb"); t.style.gridRow = "2"; if (maxNow) t.style.display = "none"; }
      });
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
    const target = e.target as HTMLElement;
    // A tap on the per-tile ⋮ opens the host menu instead of spotlighting.
    const menuBtn = target?.closest?.(".tile-menu-btn") as HTMLElement | null;
    if (menuBtn) {
      e.stopPropagation();
      openTileMenu(menuBtn.getAttribute("data-pin") || "");
      return;
    }
    // Add-to-contacts mark (v2.99.8): bridge to React, which upserts the
    // contact and pushes back the new saved set (removing the mark).
    const addBtn = target?.closest?.(".tile-addc") as HTMLElement | null;
    if (addBtn) {
      e.stopPropagation();
      const pin = addBtn.getAttribute("data-addc") || "";
      const nm = addBtn.getAttribute("data-name") || "Guest";
      if (/^\d{6}$/.test(pin)) {
        // Optimistic: drop the mark immediately; React confirms via setSavedContacts.
        savedContactPins.add(pin);
        addBtn.remove();
        try { onSaveContact?.(pin, nm); } catch { /* */ }
      }
      return;
    }
    // Screen-share MAXIMIZE (v2.99.8): full-bleed the shared screen (toggle).
    const maxBtn = target?.closest?.(".tile-max-btn") as HTMLElement | null;
    if (maxBtn) {
      e.stopPropagation();
      const tileEl = maxBtn.closest(".relay-tile") as HTMLElement | null;
      if (tileEl) {
        if (screenMaximized && spotlightId === tileEl.id) {
          screenMaximized = false;
        } else {
          screenMaximized = true; manualSpotlight = true; spotlightId = tileEl.id;
        }
        layoutGrid();
      }
      return;
    }
    const tile = target?.closest?.(".relay-tile") as HTMLElement | null;
    if (!tile) return;
    if (manualSpotlight && spotlightId === tile.id) {
      manualSpotlight = false; spotlightId = null; screenMaximized = false;
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
    screenShareIds.clear(); compactView = false; screenMaximized = false;
  }

  // ---------- mesh active-speaker (Web Audio level metering) ----------
  function ensureMeshSpeakerMonitor() {
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
    if (meshAnalysers[pin]) return;
    if (!stream.getAudioTracks().length) return;
    ensureMeshSpeakerMonitor();
    if (!meshAudioCtx) return;
    try {
      // Fresh wrapper stream (see routeElToLoudspeaker): keeps this metering
      // tap from colliding with the loudspeaker tap on the same remote stream.
      const src = meshAudioCtx.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
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
  // Independent of meshAudioCtx, which only taps REMOTE streams.
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
  // (IS_IOS is defined once near IS_ANDROID so the camera-flip/filter paths can use it.)
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
      // v2.96.1: calling setPresentationMode on a video with NO decoded frame
      // yet is silently IGNORED by iOS (the old code did exactly that right
      // after swapping srcObject, then toasted "on" — the reported "PiP not
      // working"). Give the fresh stream a beat to produce a frame first…
      if (v.readyState < 2) {
        await new Promise<void>((resolve) => {
          const done = () => { v.removeEventListener("loadeddata", done); resolve(); };
          v.addEventListener("loadeddata", done, { once: true });
          setTimeout(done, 900); // cap the wait — worst case we still try
        });
      }
      v.webkitSetPresentationMode("picture-in-picture"); // synchronous; no promise
      // …then VERIFY the mode actually flipped so the caller can report
      // honestly instead of claiming success into the void.
      await new Promise(r => setTimeout(r, 250));
      if (v.webkitPresentationMode !== "picture-in-picture") {
        throw new Error("ios-pip-refused");
      }
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
    // iOS shows a REAL remote stream in PiP — on a voice-only call there is
    // none, so say that instead of pretending it worked (v2.96.1).
    if (IS_IOS && !iosPipStream()) {
      toast("Picture-in-Picture needs video — ask them to turn a camera on.", true);
      return;
    }
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
  // While a filter is active, our published video is a canvas.captureStream track
  // driven by requestAnimationFrame — which the browser throttles/pauses when the
  // tab is backgrounded, so peers would see us FROZEN on the last frame. Swap the
  // published track to the RAW camera (not rAF-gated) while hidden, and back to the
  // filtered track on return. Uses the existing replaceTrack helper (never a
  // full-stream replace), skipped while screen-sharing. Re-entrancy-guarded.
  let bgVideoSwapped = false;
  let bgSwapBusy = false;
  async function bgSwapVideo(hidden: boolean) {
    if (bgSwapBusy) return;
    if (hidden) {
      if (bgVideoSwapped || screenSharing || !processedStream || !localStream) return;
      const raw = localStream.getVideoTracks()[0] || null;
      if (!raw) return;
      bgSwapBusy = true;
      try { await replaceVideoEverywhere(raw); bgVideoSwapped = true; }
      catch { /* leave filtered — worst case a frozen frame, not a drop */ }
      finally { bgSwapBusy = false; }
    } else {
      if (!bgVideoSwapped) return;
      const proc = processedStream?.getVideoTracks()[0] || null;
      bgSwapBusy = true;
      try { if (proc) await replaceVideoEverywhere(proc); }
      catch { /* */ }
      finally { bgVideoSwapped = false; bgSwapBusy = false; syncCamEnabled(); }
    }
  }
  // App backgrounded / foregrounded. When auto-PiP is enabled and we're in a
  // call, open a PiP window on hide and close it (if WE opened it) on return.
  function onVisibilityChange() {
    if (typeof document === "undefined") return;
    if (document.hidden) {
      if (!inCall) {
        // v2.99.36 (owner: "when I finish the call and I minimize the browser,
        // the mic and the camera is still active"): backgrounding with NO call
        // in progress must never leave the devices captured. Normally nothing is
        // held here (hangUp released them), so this is a belt-and-braces sweep
        // for any path that left a stream behind. In-call backgrounding is
        // untouched — the call keeps its media.
        if (localStream || pipeline) releaseLocalMedia("hidden-while-idle");
        return;
      }
      // Keep OUTGOING video live even with a filter on (independent of PiP).
      void bgSwapVideo(true);
      if (!autoPipPref() || !pipSupported()) return;
      const wasInPip = isInPip();
      primeAutoPip();
      startPipLoop(PIP_ACTIVE_MS);
      if (!wasInPip) { pipAutoEntered = true; void autoEnterPip(); }
    } else {
      // Foreground again: returning restores transient activation, so resume the
      // loudspeaker context if the OS suspended it in the background (else audio
      // stays silent on return), and restore the filtered video track. Drop an
      // auto-opened PiP (the full grid is back), but leave a window the user
      // opened by hand. Throttle the primed composite.
      // FIRST: the OS likely froze our SSE while backgrounded (iOS suspends
      // timers + sockets within seconds of locking). Reconnect + re-register
      // IMMEDIATELY so this device is reachable — and receives any ring the
      // server is holding for us (deliverPendingRing) — in under a second,
      // instead of waiting out an error/backoff cycle. No-op while healthy.
      if (!destroyed && (!ws || ws.readyState !== 1 || !wsReady)) {
        try { ws?.close(); } catch { /* */ }
        connectWS();
      }
      // Zombie-ring sweep: a 60s decline timer frozen with the backgrounded tab
      // can leave an ancient incoming-ring (or call-waiting) overlay + state up
      // for hours — and that stale state used to blind-auto-reject the next real
      // call. Past the 70s ring window, clear it silently; the caller is gone.
      if (pendingRing && Date.now() - (pendingRing.at || 0) > 70_000) {
        pendingRing = null;
        if (ringTimeoutT) { clearTimeout(ringTimeoutT); ringTimeoutT = null; }
        $("ringOverlay")?.classList.remove("active");
        stopRingtone();
        emitPhase(inCall ? "in-call" : "idle");
      }
      if (waitingRing && Date.now() - (waitingRing.at || 0) > 70_000) {
        waitingRing = null;
        hideCallWaiting();
      }
      // iOS also re-suspends AudioContexts in the background — resume the
      // ringtone context so a ring that arrives right after return is audible.
      if (ringtoneCtx && ringtoneCtx.state === "suspended") { try { void ringtoneCtx.resume(); } catch { /* */ } }
      if (loudspeakerOn) { try { void loudspeakerCtx?.resume(); } catch { /* */ } }
      if (inCall) void bgSwapVideo(false);
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
  /**
   * SECURITY (M46 — in-call chat impersonation): prefer the sender identity the
   * TRANSPORT proves over the one the frame claims.
   *
   * A chat frame is just JSON on a data channel, and both `name` and `pin` were
   * taken straight from it — so any participant could publish
   * `{name:"Alice", pin:"<alice's pin>", text:"…"}` and have it render as a
   * message from Alice, complete with her avatar (the chip resolves the photo by
   * pin). In a call about anything sensitive that is a convincing forgery, and on
   * a party line it can be aimed at everyone at once.
   *
   * The transport already knows who actually sent the bytes: there is one data
   * channel PER PEER, so `setupDC`'s `pin` is authenticated by the channel itself.
   * Use that, and take the display name from the roster (`nameOf`) rather than
   * from the payload — a frame's self-declared sender is a claim, not a fact, and
   * rendering it would let any participant publish as anybody. `senderPin`
   * is optional so any future/legacy caller without a proven identity still
   * degrades to the old behaviour rather than dropping messages.
   */
  function receiveChatFrame(raw: string, senderPin?: string) {
    try {
      const d = JSON.parse(raw);
      if (!markChatSeen(d.id)) return; // duplicate — skip
      const trusted = senderPin && /^\d{6}$/.test(senderPin) ? senderPin : undefined;
      // v2.99.4: frames carry the sender's PIN (older clients simply omit it) —
      // but a proven identity always wins over the frame's self-declaration.
      const pin = trusted ?? (typeof d.pin === "string" ? d.pin : undefined);
      const name = trusted ? nameOf(trusted) : d.name;
      addChatMsg(name, d.text, false, pin);
    } catch { /* */ }
  }
  function setupDC(pin: string, dc: RTCDataChannel) {
    dc.onopen = () => addToRecents(pin, (peers[pin] || { name: "" }).name);
    // M46: this channel belongs to exactly one peer, so `pin` IS the sender.
    dc.onmessage = e => receiveChatFrame(e.data as string, pin);
  }
  // Returns the number of peers the message was actually handed to (so the
  // caller can warn the user when a send reached nobody). On the SFU path we
  // can't count subscribers, so a successful publish counts as "delivered".
  function broadcastChat(text: string, id: string): number {
    // `pin` (v2.99.4) lets receivers render the sender's number + avatar in the
    // chat's glass identity chip. Old clients ignore unknown fields.
    const p = JSON.stringify({ name: me.name, text, id, pin: me.pin || undefined });
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
  // ── chat avatars (v2.99.4) ─────────────────────────────────────────────────
  // Sender photos for the chat's identity chips, resolved once per PIN via the
  // public directory.lookup (same call the incoming-ring card uses) and cached
  // for the engine's lifetime. Rows render initials instantly; the photo drops
  // in when (and if) the lookup lands. null = looked up, no photo.
  const chatAvatars = new Map<string, string | null>();
  function applyChatAvatar(pin: string) {
    const url = chatAvatars.get(pin);
    if (!url) return;
    document.querySelectorAll('.mident .mav[data-pin="' + pin + '"]').forEach((el) => {
      const av = el as HTMLElement;
      av.style.backgroundImage = "url(" + JSON.stringify(url) + ")";
      av.textContent = "";
    });
  }
  function ensureChatAvatar(pin?: string) {
    if (!pin || !/^\d{6}$/.test(pin)) return;
    if (chatAvatars.has(pin)) { applyChatAvatar(pin); return; }
    chatAvatars.set(pin, null); // in-flight marker — one fetch per pin
    const input = encodeURIComponent(JSON.stringify({ json: { number: pin } }));
    fetch("/api/trpc/directory.lookup?input=" + input, { credentials: "include" })
      .then(r => (r.ok ? r.json() : null))
      .then((j) => {
        const d = (j as { result?: { data?: { json?: { avatarUrl?: string | null } | null } } } | null)?.result?.data?.json;
        if (d?.avatarUrl) { chatAvatars.set(pin, d.avatarUrl); applyChatAvatar(pin); }
      })
      .catch(() => { /* decoration only */ });
  }
  function addChatMsg(name: string, text: string, mine: boolean, pin?: string) {
    const log = $("chatLog"); if (!log) return;
    // v2.99.4 (owner spec): every message carries a GLASS identity chip —
    // avatar + username + PIN + time in its own frosted bubble above the text
    // bubble — mine on the RIGHT, everyone else on the LEFT.
    const who = mine ? (me.name || "You") : (name || "Guest");
    // SECURITY (M26 — zero-click DOM XSS on the app origin): `pin` arrives on a
    // chat frame over the peer's DATA CHANNEL and the receive path validated it
    // with nothing but `typeof d.pin === "string"`. It is then interpolated into
    // this row's innerHTML TWICE, unescaped: once inside the double-quoted
    // `data-pin="…"` ATTRIBUTE, and once through `fmtPin`, which returns a
    // non-matching string completely UNCHANGED. So a peer sending
    //   pin: 'x"><img src=x onerror=…>'
    // broke out of the attribute and injected a live element that executes on
    // parse — no click, no hover, just receiving the message. Running on our own
    // origin, that script can drive the whole authenticated API as the victim
    // (read every thread, send as them, edit the profile), i.e. session takeover.
    // Reachable by anyone who can share a call — including a PARTY LINE, which is
    // joinable by number, so one frame could hit every participant at once.
    //
    // A pin is ALWAYS exactly six digits, so validate rather than merely escape:
    // anything else is not a pin and is dropped to `undefined` (the chip simply
    // renders without a pin). This is the same check `ensureChatAvatar` already
    // applied — it just ran AFTER the markup was written, so it protected the
    // avatar fetch and not the render. It also keeps the `[data-pin="…"]`
    // querySelectorAll in `applyChatAvatar` from being fed a malformed selector.
    const idPinRaw = mine ? (me.pin || undefined) : pin;
    const idPin = idPinRaw && /^\d{6}$/.test(idPinRaw) ? idPinRaw : undefined;
    const time = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    const row = document.createElement("div");
    row.className = "mrow " + (mine ? "me" : "them");
    row.innerHTML =
      '<div class="mbody"><div class="mident">' +
      // `initials` slices a peer-supplied name to 2 chars, so it can't fit an
      // event-handler attribute, but an unescaped "<" still corrupts the parse —
      // escape it too rather than reasoning about the length cap.
      '<span class="mav"' + (idPin ? ' data-pin="' + idPin + '"' : "") + ">" + escapeHtml(initials(who)) + "</span>" +
      '<span class="mwho"><b>' + escapeHtml(mine ? "You" : who) + "</b>" +
      (idPin ? "<i>" + fmtPin(idPin) + "</i>" : "") + "</span>" +
      '<span class="mtime">' + time + "</span></div>" +
      '<div class="relay-msg ' + (mine ? "me" : "them") + '">' + linkifyEscaped(escapeHtml(text)) + "</div></div>";
    log.appendChild(row); log.scrollTop = log.scrollHeight;
    ensureChatAvatar(idPin);
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
  // ── chat emoji palette (v2.99.4) ──────────────────────────────────────────
  // A real picker like the main Messages tab: 😊 toggles a wrap of common
  // emojis between the log and the composer; tapping one inserts it at the
  // caret. Built lazily on first open (zero cost for text-only chats).
  const CHAT_EMOJIS = [
    "😀","😁","😂","🤣","😊","😍","😘","😜","🤔","😎","🥳","😭",
    "😅","🙃","😇","🤩","😤","😱","🤯","😴","🤗","🫡","🙄","😬",
    "👍","👎","👏","🙏","💪","🤝","👋","✌️","🤞","🫶","❤️","💔",
    "🔥","💯","🎉","✨","⭐","🎂","🌹","☕","🍕","⚡","✅","❌",
  ];
  let chatEmojisBuilt = false;
  function insertChatEmoji(emoji: string) {
    const f = $("chatField") as HTMLInputElement | null;
    if (!f || !emoji) return;
    const start = f.selectionStart ?? f.value.length;
    const end = f.selectionEnd ?? f.value.length;
    f.value = f.value.slice(0, start) + emoji + f.value.slice(end);
    const pos = start + emoji.length;
    try { f.setSelectionRange(pos, pos); } catch { /* */ }
    f.focus();
  }
  function toggleChatEmojis() {
    const p = $("chatEmojis");
    if (!p) return;
    if (!chatEmojisBuilt) {
      chatEmojisBuilt = true;
      p.innerHTML = CHAT_EMOJIS
        .map(e => '<button type="button" data-emoji="' + e + '" aria-label="Insert ' + e + '">' + e + "</button>")
        .join("");
      p.addEventListener("click", (ev) => {
        const t = (ev.target as HTMLElement)?.closest?.("button[data-emoji]") as HTMLElement | null;
        if (t) insertChatEmoji(t.getAttribute("data-emoji") || "");
      });
    }
    const open = p.classList.toggle("open");
    $("chatEmojiBtn")?.classList.toggle("open", open);
    if (!open) ($("chatField") as HTMLInputElement | null)?.focus();
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
      // M26: same as the call tiles — `r.name` is peer-chosen, so escape the
      // initials as well as the full name. `r.id` is a server-issued 6-digit pin.
      d.innerHTML = '<div class="av">' + escapeHtml(initials(r.name)) + '</div><div class="info"><b>' + escapeHtml(r.name) + "</b><span>" + escapeHtml(r.id) + "</span></div><div class=\"go\">&#8635;</div>";
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
  // SENT to peers is the PROCESSED (canvas) track, so toggle THAT to truly stop
  // outgoing video; also toggle the raw input so the physical camera capture/light
  // reflects the off state.
  // Defensive: if the local camera track has genuinely died, grab a fresh one and
  // swap it into localStream (+ the filter pipeline) so we can publish a LIVE
  // track. Returns the track to publish (processed when a filter is on), or null.
  async function reacquireCameraForPublish(): Promise<MediaStreamTrack | null> {
    if (!localStream) return null;
    const genP = mediaGen;
    try {
      // Plain SAME-facing acquisition FIRST: acquireFlippedCamera is built for
      // flipping and deliberately avoids the current device — using it alone
      // here could bind the wrong camera, or fail outright on single-camera
      // desktops (the "camera never comes back" recovery failure). It stays as
      // the fallback for devices where the direct constraint is rejected.
      let fresh: MediaStream | null = null;
      try {
        fresh = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: facingMode } },
          audio: false,
        });
      } catch { /* fall through to the flip helper */ }
      if (!fresh || fresh.getVideoTracks().length === 0) fresh = await acquireFlippedCamera(facingMode);
      // v2.99.36: the call may have ended while this re-acquisition was in
      // flight — stop the fresh camera rather than reinstalling it into a dead
      // call (nothing would ever stop it, leaving the camera light on).
      if (mediaStale(genP) || !localStream) { stopStream(fresh); return null; }
      const v = fresh?.getVideoTracks()[0];
      if (!v) return null;
      // Re-arm the death watch on the fresh track (the old watcher died with
      // the old track — a second device loss must stay recoverable).
      v.onended = () => { void recoverDeadLocalTrack("video"); };
      const audio = localStream.getAudioTracks();
      localStream = new MediaStream([...audio, v]);
      if (pipeline) { await pipeline.setInputStream(localStream); return pipeline.getOutputStream()?.getVideoTracks()[0] || v; }
      const sv = $("tile-self")?.querySelector("video") as HTMLVideoElement | null;
      if (sv) { sv.srcObject = null; sv.srcObject = localStream; void sv.play().catch(() => {}); }
      return v;
    } catch { return null; }
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
    if (camOn) {
      // Enabling with NO live camera track (denied/absent at join, or the OS killed
      // it) must REACQUIRE — without this, for exactly the "my camera is never
      // recognized" users the camera button silently did nothing forever. The fresh track rides into
      // each peer's video sender (guaranteed by createPeer's null-track
      // transceiver) via replaceTrack — no renegotiation.
      const haveLive = localStream.getVideoTracks().some(t => t.readyState === "live");
      if (!haveLive) {
        void (async () => {
          const track = await reacquireCameraForPublish();
          if (track) {
            await replaceVideoEverywhere(track);
            syncCamEnabled();
            const st = $("tile-self"); if (st && !screenSharing) st.classList.remove("audio-only");
          } else {
            camOn = false;
            $("camBtn")?.classList.add("off");
            const st = $("tile-self"); if (st && !screenSharing) st.classList.add("audio-only");
            toast("Camera unavailable — check that RELAY has camera permission and no other app is using it.", true);
          }
        })();
      }
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
    // Mutual-consent: turning video ON in an un-approved 1:1 call sends a
    // request instead — the other side's prompt (accept = both cameras on)
    // is what actually starts video. Turning OFF never needs consent.
    if (!camOn && videoGateActive() && !screenSharing) {
      requestVideoUpgrade();
      return;
    }
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
    if (!md.getDisplayMedia) {
      // NO mobile browser implements getDisplayMedia — not iOS Safari AND not
      // Android Chrome. Web screen-capture needs the OS screen-record API, which
      // phones don't expose to web pages, so it's a DESKTOP-ONLY capability
      // (not an app bug). Only desktop browsers ever reach the sharing logic below.
      const isMobile = IS_IOS || IS_ANDROID || (typeof navigator !== "undefined" && (navigator.maxTouchPoints || 0) > 0 && /Mobi|Android|iP(hone|ad|od)/i.test(navigator.userAgent || ""));
      toast(
        isMobile
          ? "Screen sharing only works on a computer — phone browsers don't allow it. Open RELAY on a desktop/laptop to share your screen."
          : "Screen sharing isn't supported in this browser. Try Chrome, Edge, or Firefox on desktop.",
        true,
      );
      return;
    }
    // We can only hot-swap into an EXISTING video sender (no renegotiation). An
    // audio-only call (no camera) has none, so screen share would silently reach
    // no one — block it with a clear message rather than appearing to work.
    if (Object.keys(peers).length > 0) {
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
    // A shared screen is mostly static, text-heavy content — hint "detail" so the
    // encoder favors sharpness over frame rate (readable text, not smeared).
    try { (track as MediaStreamTrack & { contentHint?: string }).contentHint = "detail"; } catch { /* */ }
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
    // Swap the live camera/filtered track back in for every peer + the SFU —
    // but when the camera is OFF, swap in NOTHING (null → mesh senders empty,
    // SFU publication dropped). Swapping the DISABLED camera track into the
    // live screen publication kept a "video" flowing that renders as a solid
    // BLACK tile for every subscriber ("his camera is dead") until the next
    // camera toggle.
    await replaceVideoEverywhere(camOn ? currentCameraVideoTrack() : null);
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
    return pinDigits(inp?.value ?? "");
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
  //
  // v2.106.65 — this used `replace(/\D/g, "")`, which FOLDS a letter away rather than
  // dropping it, and this is the one field in the app where that is more than cosmetic:
  // the sixth digit AUTO-INVITES, so `7a7b7c7d7e7f` silently became `777777` and rang a
  // stranger into a live call off a typo. `capPinInput` drops as typed, so the field
  // always shows exactly what will be dialled. The markup's `maxlength` came down from 16
  // to seven in the same change, so the browser's own cap agrees with ours instead of
  // letting ten more characters in before our handler trims them.
  function onAddInputType() {
    const inp = $("addInput") as HTMLInputElement | null;
    if (inp) inp.value = capPinInput(inp.value);
    const v = addInputValue();
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
    if (peers[pin]) { toast("Already in the call.", true); return; }
    // The ONE cap, so this can never disagree with what the group picker showed.
    const cap = transportMax();
    const n = Object.keys(peers).length;
    if (n >= cap - 1) { toast(`Call is full (${cap} people max).`, true); return; }
    addInviting = true;
    // Already in a call: the mode is whatever this call is in, so adding a
    // person must not open a camera a voice call deliberately never opened.
    try { await ensureMedia(camOn); } catch { addInviting = false; return; }
    // Online → the server rings them in; offline → error{offline}; unknown →
    // error{nonexistent} (v2.99.11 split the two). The generic handler toasts
    // the message either way and the pad closes itself. Arm the offline guard so
    // BOTH of those errors leave the call we're already in untouched.
    addInviteOfflineGuard = true;
    if (addInviteGuardT) clearTimeout(addInviteGuardT);
    addInviteGuardT = setTimeout(() => { addInviteOfflineGuard = false; addInviteGuardT = null; }, 6000);
    sendWS({ type: "invite", to: pin, video: camOn });
    toast("Inviting " + pin + "…");
    closeAddPad();
    addInviting = false;
  }
  function hangUp(reason: string = "manual") {
    groupDialOutstanding = null;
    sendWS({ type: "leave", reason });
    // Native Android: leave OS call mode + drop the ongoing-call service.
    if (isNativeAndroid()) void nativeSetInCall(false);
    // The user explicitly ended the call — don't auto-rejoin it on a later reload.
    clearPendingRejoin();
    stopRingtone();
    cancelEndActiveFallback();
    loudspeakerDisable(); // stop the loudspeaker scan + release the audio context
    if (ringTimeoutT) { clearTimeout(ringTimeoutT); ringTimeoutT = null; }
    pendingRing = null;
    $("ringOverlay")?.classList.remove("active");
    exitPreConnect(); // clear any in-flight dial card / pre-connect gating
    clearDialTimeout(); // an ended call must never fire a stale "No answer."
    clearEstablishDeadline(); // …nor a stale "couldn't connect the audio"
    clearFailDial(); // an explicit End during the failure card mustn't re-fire
    videoApproved = false; callIsGroup = false; // consent is per-call
    videoOfferedForRoom = null; videoOfferPending = false; // M37 — the OFFER is per-call too
    clearVideoReq();
    hideVideoAsk();
    clearConnSeq();
    exitReconnecting();
    establishedOnce = false;
    updateMediaSession(false);         // release the OS media session
    // A second caller WAITING while this call ends is PROMOTED to a normal
    // incoming ring after teardown (bottom of this function) — never auto-
    // declined. A dying call (especially a dead-room auto-rejoin) must not
    // swallow a live incoming call.
    const promotedRing = waitingRing;
    waitingRing = null;
    hideCallWaiting();
    dropHeld();                        // a full hang-up drops any held call too
    for (const id in peers) {
      try { peers[id].pc.close(); } catch { /* */ }
      if (peers[id].el) peers[id].el!.remove();
    }
    for (const id in peers) delete peers[id];
    pendingGroupInvites = [];
    for (const k in peerDevices) delete peerDevices[k];
    for (const k in peerFlags) delete peerFlags[k];
    for (const k in peerRoles) delete peerRoles[k];
    myRole = null; roomHostPin = null;
    closeHostPanel(); closeAudioMenu(); closeTileMenu(); updateHostUI();
    unprimeAutoPip(); void exitPip(); // leave PiP + stop priming when the call ends
    stopStatsSampler();
    teardownSpeakerMonitor();
    teardownLocalLevelMonitor();
    resetSpeakerView();
    // Clear leftover tiles so an idle/parked grid doesn't keep dead srcObjects.
    const grid = $("videoGrid"); if (grid) grid.innerHTML = "";
    inCall = false; roomId = null; callAnswered = false;
    // Round 11 B: the capability names a call we have LEFT. Dropping it here is
    // what guarantees the repair path can never resurrect a call the user ended.
    roomCap = null; cancelRecreate();
    emitPhase("idle");
    if (timerInt) { clearInterval(timerInt); timerInt = null; }
    const log = $("chatLog"); if (log) log.innerHTML = "";
    $("chatPanel")?.classList.remove("open");
    $("filterDock")?.classList.remove("open");
    // Being-held state dies with the call (v2.97.1): music off, fuse defused.
    peersHoldingUs.clear();
    cancelSoloEndGrace();
    stopHoldMusic();
    $("onHoldBar")?.classList.remove("show");
    unread = 0;
    const b = $("chatBadge"); if (b) b.style.display = "none";
    if (screenStream) {
      try { screenStream.getTracks().forEach(t => { t.onended = null; t.stop(); }); } catch { /* */ }
      screenStream = null;
    }
    screenSharing = false;
    screenBusy = false;
    $("screenBtn")?.classList.remove("on");
    // Release the camera + mic through the ONE helper (v2.99.36) so the device
    // indicator goes out the moment the call ends and the next call / another
    // app can acquire them.
    releaseLocalMedia("hang-up:" + reason);
    micOn = true; camOn = true;
    $("micBtn")?.classList.remove("off");
    $("camBtn")?.classList.remove("off");
    show("lobby"); renderRecents();
    // Let a promoted call-waiting caller ring through now that the old call
    // is fully torn down (mirror of onRing's incoming-ring presentation).
    if (promotedRing && !destroyed) {
      pendingRing = promotedRing;
      // Bug fix: this presentation is a "mirror of onRing" (see above) but was
      // missing the one thing that makes a video dial answerable as video —
      // onRing hides/shows the Video-answer button based on the ring's video
      // flag; without this line the button kept whatever visibility a PRIOR
      // ring left it in, so a promoted video call could show no Video button
      // (or a promoted voice call could wrongly show a stale one).
      const vWrap = $("acceptVideoWrap"); if (vWrap) vWrap.style.display = promotedRing.video ? "" : "none";
      const ringAv = $("ringAv"); if (ringAv) ringAv.textContent = initials(promotedRing.fromName || "?");
      const ringWho = $("ringWho"); if (ringWho) ringWho.textContent = promotedRing.fromName || "Someone";
      const ringSub = $("ringSub"); if (ringSub) ringSub.textContent = "is calling you…";
      const ringPin2 = $("ringPin");
      if (ringPin2) ringPin2.textContent = promotedRing.from.length === 6 ? promotedRing.from.slice(0, 3) + "-" + promotedRing.from.slice(3) : promotedRing.from;
      presentRingProfile(promotedRing.from);
      $("ringOverlay")?.classList.add("active");
      playRingtone("incoming");
      emitPhase("ringing");
      if (ringTimeoutT) clearTimeout(ringTimeoutT);
      ringTimeoutT = setTimeout(() => {
        if (pendingRing && pendingRing.from === promotedRing.from) declineInvite();
      }, 60000);
    }
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
      writeSnapshot({ roomId, pin: me.pin, micOn, camOn, ts: Date.now(), cap: roomCap ?? undefined });
    }
  };

  ($("joinBtn") as HTMLElement | null)?.addEventListener("click", onJoinClick);
  ($("nameInput") as HTMLElement | null)?.addEventListener("keydown", onNameKey as EventListener);
  ($("copyBtn") as HTMLElement | null)?.addEventListener("click", onCopyClick);
  ($("shareUrl") as HTMLElement | null)?.addEventListener("click", onShareClick);
  ($("backKey") as HTMLElement | null)?.addEventListener("click", onBackKey);
  ($("callBtn") as HTMLElement | null)?.addEventListener("click", startCall);
  ($("acceptBtn") as HTMLElement | null)?.addEventListener("click", () => void acceptInvite());
  ($("acceptVoiceBtn") as HTMLElement | null)?.addEventListener("click", () => void acceptInvite({ voice: true }));
  ($("declineBtn") as HTMLElement | null)?.addEventListener("click", declineInvite);
  // Send-to-voicemail (v2.97): a decline — RELAY then offers the CALLER the
  // existing voicemail flow (record → lands in your Messages as audio).
  ($("toVoicemailBtn") as HTMLElement | null)?.addEventListener("click", () => {
    toast("Sent to voicemail — they can leave you a message.");
    declineInvite();
  });
  // Message…: fold out the canned replies + the type-your-own box (v2.97).
  ($("typeReplyBtn") as HTMLElement | null)?.addEventListener("click", () => {
    const qr = $("quickReplies");
    qr?.classList.toggle("open");
    if (qr?.classList.contains("open")) ($("customReplyInput") as HTMLInputElement | null)?.focus();
  });
  root.querySelectorAll<HTMLButtonElement>(".qr-opt").forEach(btn => {
    btn.addEventListener("click", () => {
      const r = pendingRing;
      const text = btn.dataset.msg || btn.textContent || "";
      if (!r || !text) return;
      try { onQuickReply?.(r.from, text); toast("Reply sent — call declined"); }
      catch { toast("Couldn't send the reply.", true); }
      declineInvite();
    });
  });
  // Type-your-own reply (v2.97): sending messages the caller AND declines.
  const sendCustomReply = () => {
    const inp = $("customReplyInput") as HTMLInputElement | null;
    const r = pendingRing;
    const text = (inp?.value || "").trim();
    if (!r || !text) return;
    try { onQuickReply?.(r.from, text); toast("Message sent — call declined"); }
    catch { toast("Couldn't send the message.", true); }
    if (inp) inp.value = "";
    declineInvite();
  };
  ($("customReplySend") as HTMLElement | null)?.addEventListener("click", sendCustomReply);
  ($("customReplyInput") as HTMLInputElement | null)?.addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key === "Enter") { e.preventDefault(); sendCustomReply(); }
  });
  ($("cwSwitch") as HTMLElement | null)?.addEventListener("click", switchCall);
  ($("vaAccept") as HTMLElement | null)?.addEventListener("click", () => {
    hideVideoAsk();
    unlockApprovedVideo();
    sendWS({ type: "video-accept" });
    toast("Video on — both sides. 🎥");
  });
  ($("vaDecline") as HTMLElement | null)?.addEventListener("click", () => {
    hideVideoAsk();
    sendWS({ type: "video-decline" });
  });
  ($("cwDecline") as HTMLElement | null)?.addEventListener("click", declineWaiting);
  ($("heldSwap") as HTMLElement | null)?.addEventListener("click", swapCall);
  ($("heldEnd") as HTMLElement | null)?.addEventListener("click", endHeldLine);
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
  ($("qualityBtn") as HTMLElement | null)?.addEventListener("click", toggleQuality);
  // v2.105.21 — the call-quality readout. Reflect the remembered state on mount so a
  // session left with it ON shows the line as soon as a call opens, rather than
  // waiting for a tap that has already happened.
  ($("statsBtn") as HTMLElement | null)?.addEventListener("click", toggleCallStats);
  renderCallQuality("measuring…");
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
  // First-gesture audio unlock (iOS): pre-create + resume the ringtone/cue
  // AudioContexts inside a real user gesture, so an incoming ring that arrives
  // later (via SSE — no gesture) is actually AUDIBLE. Self-removes after firing.
  const onFirstGesture = () => {
    unlockEngineAudio();
    document.removeEventListener("pointerdown", onFirstGesture);
    document.removeEventListener("keydown", onFirstGesture);
  };
  document.addEventListener("pointerdown", onFirstGesture);
  document.addEventListener("keydown", onFirstGesture);
  if (typeof navigator !== "undefined" && navigator.mediaDevices?.addEventListener) {
    try { navigator.mediaDevices.addEventListener("devicechange", onAudioDeviceChange); } catch { /* */ }
  }
  ($("filterBtn") as HTMLElement | null)?.addEventListener("click", toggleFilterStrip);
  ($("filterClose") as HTMLElement | null)?.addEventListener("click", toggleFilterStrip);
  ($("chatSend") as HTMLElement | null)?.addEventListener("click", sendChat);
  ($("chatEmojiBtn") as HTMLElement | null)?.addEventListener("click", toggleChatEmojis);
  ($("chatField") as HTMLElement | null)?.addEventListener("keydown", onChatField as EventListener);
  ($("addInput") as HTMLElement | null)?.addEventListener("keydown", onAddInput as EventListener);
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
  // `pagehide` is the mobile-reliable companion to beforeunload — Safari/Chrome on
  // iOS/Android fire it (but often NOT beforeunload) when the tab is backgrounded
  // into the page cache, so the auto-rejoin snapshot is written on mobile too.
  window.addEventListener("pagehide", onUnload);
  // Local network loss (Wi-Fi drop, tunnel, airplane toggle) is the clearest
  // "you're disconnected" signal. We own recovery, so show the reconnect window
  // and, when the radio returns, re-open signaling + kick ICE restarts.
  const onOffline = () => {
    if (inCall && establishedOnce) enterReconnecting();
  };
  const onOnline = () => {
    if (!inCall) return;
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
    dial(target: string, opts?: { voice?: boolean; displayName?: string }): boolean {
      // returns true synchronously if validation passes; the actual call is async,
      // but the host UI just needs to know whether to flip to in-call mode.
      if (!/^\d{6}$/.test(target)) return false;
      if (!me.pin) return false;
      if (target === me.pin) return false;
      // Still inside the tap that triggered the dial — prime the speaker route
      // before the async media work consumes the transient activation.
      loudspeakerPrime();
      // fire-and-forget the actual async call
      void programmaticDial(target, opts);
      return true;
    },
    dialGroup(targets: string[], opts?: { voice?: boolean; seed?: string | null }): boolean {
      if (!me.pin) return false;
      const valid = targets.filter(t => /^\d{6}$/.test(String(t)) && t !== me.pin);
      if (valid.length === 0) return false;
      loudspeakerPrime();
      void programmaticGroupDial(targets, opts);
      return true;
    },
    maxParticipants() { return transportMax(); },
    setOnStateChange(cb) { onPhaseChange = cb; },
    getRoster() {
      // Read-only snapshot of who's on the call RIGHT NOW (both transports) —
      // drives the host's in-call "save to contacts" chip (v2.96). Never
      // mutates engine state.
      const out: Array<{ pin: string; name: string }> = [];
      for (const id in peers) {
        if (/^\d{6}$/.test(id)) out.push({ pin: id, name: peers[id].name || "Guest" });
      }
      return out;
    },
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
    setOnQuickReply(cb) { onQuickReply = cb; },
    setOnDialFailed(cb) { onDialFailed = cb; },
    setBlockedPins(pins) { blockedPins = new Set(pins); },
    setMinimized(on) {
      // React drives compact deterministically (the ResizeObserver at boot is
      // the passive fallback). Forcing it here means the mini box shows the
      // 2-up even if it's sized at/above the observer threshold.
      if (compactView === !!on) return;
      compactView = !!on;
      layoutGrid();
    },
    setSavedContacts(pins) {
      savedContactPins = new Set((pins || []).filter((p) => /^\d{6}$/.test(p)));
      // Re-render tile chrome so the add-contact marks refresh live.
      try { refreshAllTileAddMarks(); } catch { /* */ }
    },
    setOnSaveContact(cb) { onSaveContact = cb; },
    knock(number) {
      if (!/^\d{6}$/.test(number) || !me.pin || number === me.pin) return;
      if (!ws || ws.readyState !== 1) { toast("Not connected — try again in a moment.", true); return; }
      // Prime the speaker route inside the tap, like a dial (we may join media).
      loudspeakerPrime();
      sendWS({ type: "knock", to: number });
    },
    approveKnock(roomId, pin) {
      if (!roomId || !/^\d{6}$/.test(pin)) return;
      sendWS({ type: "knock-approve", roomId, pin });
    },
    denyKnock(roomId, pin) {
      if (!roomId || !/^\d{6}$/.test(pin)) return;
      sendWS({ type: "knock-deny", roomId, pin });
    },
    setOnKnock(cb) { onKnock2 = cb; },
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
      /* The in-call flag lives on <html>, which OUTLIVES this engine — so a
       * teardown while the call surface is showing (sign-out, route change) would
       * leave the shell's background canvas frozen for the rest of the session.
       * Not a drift risk of the kind show() guards against: this is an
       * unconditional cleanup, not a second conditional owner. */
      try { delete document.documentElement.dataset.relayInCall; } catch { /* */ }
      stopHoldMusic();
      cancelSoloEndGrace();
      cancelEndActiveFallback();
      // Logout / engine teardown → don't carry a pending auto-rejoin into the
      // next session, and release the loudspeaker context.
      if (rejoinWatchT) { clearTimeout(rejoinWatchT); rejoinWatchT = null; }
      roomCap = null; cancelRecreate(); // Round 11 B — same reason as in hangUp
      try { loudspeakerDisable(); loudspeakerCtx?.close?.(); } catch { /* */ }
      if (reconnectT) { clearTimeout(reconnectT); reconnectT = null; }
      if (timerInt) { clearInterval(timerInt); timerInt = null; }
      if (ringTimeoutT) { clearTimeout(ringTimeoutT); ringTimeoutT = null; }
      if (waitingTimeoutT) { clearTimeout(waitingTimeoutT); waitingTimeoutT = null; }
      waitingRing = null;
      clearFailDial();
      clearConnSeq();
      clearEstablishDeadline();
      exitReconnecting();
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
      // Engine teardown (logout / unmount): free the camera + mic and the filter
      // pipeline through the shared helper (v2.99.36).
      releaseLocalMedia("engine-destroy");
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
      window.removeEventListener("pagehide", onUnload);
      document.removeEventListener("pointerdown", onFirstGesture);
      document.removeEventListener("keydown", onFirstGesture);
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
