/**
 * Call quality, as numbers (v2.105.21).
 *
 * WHY THIS EXISTS. The owner reported "slowness in the voice and video calls" and
 * there was no way to answer it: `/api/health` now says which transport the fleet
 * uses, but nothing reported what a call is actually DOING. v2.99.67 removed the
 * Diagnostics panel (rightly — it was a permanent floater nobody asked for), and
 * the only surviving `getStats` reader samples bitrate for the quality button. So
 * "it feels slow" could not be turned into a figure, and choosing a different SFU
 * vendor on that basis would have been a guess.
 *
 * THE ONE NUMBER THAT MATTERS MOST IS `path`. If the selected ICE candidate pair
 * is a RELAY pair, media is going out to coturn and back instead of straight to the
 * other side — which roughly doubles the round trip and is a CONFIGURATION problem no
 * change of transport fixes. `relay` therefore has to be visible, not inferred.
 *
 * PURE CORE, INJECTED COLLECTION. `summarizeStats` takes reports and returns a
 * record; it touches no RTCPeerConnection, no SFU room and no clock. That is
 * what makes the arithmetic — seconds→ms, loss as a ratio of the right
 * denominator, bitrate as a DELTA — testable without a browser, which matters
 * because every one of those is easy to get subtly wrong and impossible to notice
 * by looking at a number on a screen.
 *
 * ONE SHAPE FOR EVERY TRANSPORT, deliberately: the mesh exposes
 * `RTCPeerConnection.getStats()` per peer while an SFU exposes its own per-track
 * report, so the collectors differ and the summary must not — otherwise the two
 * paths cannot be compared, which is the entire point of measuring before moving a
 * call onto a different transport.
 */

/** A single stats entry, narrowed to the fields we read. Deliberately loose: the
 *  browser's `RTCStats` union is huge and varies by engine, and reading an absent
 *  field must yield `undefined` rather than throwing. */
export interface StatEntry {
  id?: string;
  type?: string;
  kind?: string;
  mediaType?: string;
  state?: string;
  nominated?: boolean;
  selected?: boolean;
  currentRoundTripTime?: number;
  localCandidateId?: string;
  remoteCandidateId?: string;
  candidateType?: string;
  packetsLost?: number;
  packetsReceived?: number;
  jitter?: number;
  frameWidth?: number;
  frameHeight?: number;
  framesPerSecond?: number;
  bytesSent?: number;
  bytesReceived?: number;
  /* THE THERMAL PAIR (v2.106.56). `encoderImplementation` names the encoder the
     browser actually chose — a value containing "libvpx"/"openh264" is SOFTWARE
     (the phone's CPU), while "VideoToolbox"/"ExternalEncoder"/"MediaFoundation"
     is the hardware block. `qualityLimitationReason === "cpu"` is the
     throttling itself, reported by the sender. Both are standard
     `outbound-rtp` fields, so they read identically on the mesh and on
     mediasoup. */
  encoderImplementation?: string;
  qualityLimitationReason?: string;
  /* THE IDENTITY FIELDS (v2.106.58). All three live on an entry OTHER than the one
     that references them, which is why the two-pass `byId` index below is not
     optional: `protocol` is on the local/remote CANDIDATE (never on the pair), and
     `mimeType` is on the `codec` entry named by an rtp entry's `codecId`. Reading
     either off the referencing entry yields `undefined` and would render nothing
     while looking implemented. */
  protocol?: string;
  codecId?: string;
  mimeType?: string;
  /* THE PLAYOUT PAIR (v2.107.10). `totalAudioEnergy` is the energy of the audio
     samples the receiver actually RENDERED, and `totalSamplesDuration` how much
     of it there was — so packets arriving while energy stays at exactly 0 is
     "received and never heard", which is a completely different fault from
     "never arrived" and is invisible in every other counter here. v2.106.51 was
     precisely that: ~508 audio packets a side, zero energy, silence. The two are
     read TOGETHER because alone they cannot separate a broken playout path
     (nothing rendered at all) from a muted far side (rendered, all zeroes). */
  totalAudioEnergy?: number;
  totalSamplesDuration?: number;
}

/**
 * What a caller hands us: a plain ARRAY of entries, one array per leg.
 *
 * Deliberately not `Iterable<StatEntry>`, which is the obvious choice and does not
 * compile here: this project targets ES5, so `for…of` over a bare iterable is
 * TS2802 (`--downlevelIteration`) — the trap recorded in v2.99.72 and v2.99.98. An
 * `RTCStatsReport` is converted with its own `.forEach`, which is exactly how the
 * existing bitrate sampler already reads one, so the collectors and this share a
 * style rather than diverging.
 */
export type StatsInput = readonly StatEntry[];

/** Flatten a browser stats report into the array shape above, ES5-safely. */
export function entriesOf(report: { forEach: (cb: (v: unknown) => void) => void }): StatEntry[] {
  const out: StatEntry[] = [];
  try {
    report.forEach((v) => {
      if (v && typeof v === "object") out.push(v as StatEntry);
    });
  } catch {
    /* a hostile or half-implemented report yields nothing rather than throwing */
  }
  return out;
}

export type MediaPath = "relay" | "direct" | "unknown";

/**
 * What happened to the audio we were SENT (v2.107.10).
 *
 *   - `ok`          — packets arrived and carried sound. Nothing to say.
 *   - `not-playing` — packets arrived, and NOTHING was rendered (`totalSamplesDuration`
 *                     is exactly 0). This is a bug on our side of the wire and is
 *                     the v2.106.51 signature verbatim: the transport is fine and
 *                     the person hears silence.
 *   - `no-sound`    — packets arrived and were rendered, and every sample was zero.
 *                     Overwhelmingly the far side being muted or in a silent room,
 *                     so it is NOT called a fault. Also the honest answer when the
 *                     UA reports no sample duration at all, because there the two
 *                     causes cannot be told apart and claiming either would be a
 *                     guess.
 *   - `unknown`     — too little evidence yet, or the UA reports no energy.
 *
 * Keeping `no-sound` and `not-playing` separate is the whole value: they need
 * different next steps, and a single "no audio" state would send somebody to
 * inspect a transport that is working perfectly.
 */
export type AudioInboundState = "ok" | "no-sound" | "not-playing" | "unknown";

export interface AudioInbound {
  /** Audio RTP packets received across every leg. */
  packets: number;
  /** Summed `totalAudioEnergy`. Null when no leg reported it. */
  energy: number | null;
  /** Summed `totalSamplesDuration`, seconds. Null when no leg reported it. */
  playoutSec: number | null;
  state: AudioInboundState;
}

/**
 * How many inbound audio packets make the verdict trustworthy.
 *
 * ~50 packets a second, so this is about three seconds of call. Higher than the
 * loss floor on purpose: a call one second old can legitimately have received
 * audio that has not been rendered yet, and reporting "not playing" there would
 * make every healthy call accuse itself for its first moments.
 */
export const AUDIO_MIN_PACKETS = 150;

/**
 * Decide the state from the three counters. Exported because it is the one piece
 * of judgement here and it must be drivable directly — every branch is a distinct
 * claim about somebody's call.
 */
export function audioInboundState(
  packets: number,
  energy: number | null,
  playoutSec: number | null,
): AudioInboundState {
  if (packets < AUDIO_MIN_PACKETS) return "unknown";
  // No energy figure at all ⇒ nothing to judge. Silence is not evidence.
  if (energy === null) return "unknown";
  if (energy > 0) return "ok";
  /* Energy is zero with real packets behind it. WHICH failure it is turns on
     whether anything was rendered — and an unreported duration cannot answer
     that, so it degrades to the weaker, non-accusatory claim. */
  if (playoutSec !== null && playoutSec <= 0) return "not-playing";
  return "no-sound";
}

export interface CallStats {
  /** Round trip to the far end, ms. Null when no succeeded candidate pair reported one. */
  rttMs: number | null;
  /** Inbound packet loss, percent, 0–100. Null when nothing has been received yet.
   *  POOLED across every leg — see `lossWorstPct` for the per-leg worst. */
  lossPct: number | null;
  /**
   * The WORST single leg's loss, percent. Null when no leg has enough evidence.
   *
   * `lossPct` pools every leg into one ratio, which is right for a 1:1 call and
   * DILUTES on a group one: a peer losing 20% is invisible behind four clean peers,
   * and that peer's call is bad. Jitter has always been worst-case for exactly this
   * reason ("one smooth leg does not make a choppy call smooth") — loss was the
   * inconsistent sibling.
   *
   * A LEG NEEDS `LOSS_MIN_PACKETS` OF EVIDENCE TO COUNT, and that floor is
   * load-bearing rather than cautious: these counters are cumulative from the leg's
   * own start, so a peer who joined two seconds ago can legitimately read 1 received
   * / 1 lost — 50% — and without the floor a newcomer would spike the whole call to
   * "poor" for one tick. Under-evidenced legs still contribute to the pooled figure,
   * so nothing is discarded.
   */
  lossWorstPct: number | null;
  /** Inbound jitter, ms. Null when unreported. */
  jitterMs: number | null;
  /**
   * Whether media is going through a TURN relay.
   *
   * `relay` is the finding: it means the round trip includes a detour to coturn.
   * WORST-CASE across peers/tracks — if ANY leg is relayed the call is relayed as
   * far as the user's experience is concerned, so reporting "direct" because one
   * other leg happened to be direct would hide the thing being looked for.
   */
  path: MediaPath;
  /**
   * The ICE candidate type actually carrying media — the doc asks for this by name,
   * and `path` alone cannot answer it: `host` (same LAN) and `srflx` (NAT-traversed
   * direct) both read "direct", and those are different situations to be in.
   *
   * WORST-CASE across legs by distance from ideal (host < prflx < srflx < relay),
   * which is the same discipline `path` uses — and `path` is now DERIVED from this,
   * so there is one rule rather than two that can come to disagree. An
   * UNRECOGNISED type is ignored rather than ranked, so a future candidate kind
   * cannot read as "relay" and cry wolf; that also makes the derivation
   * behaviour-identical to the `anyRelay` flag it replaced.
   */
  candidate: string | null;
  /**
   * The selected pair's transport protocol, lowercased — `udp` or `tcp`.
   *
   * Needed for the mediasoup verification ("confirm media flows over UDP to that
   * node's public IP"), and a finding in its own right: a call relayed over
   * TURN/TCP:443 is indistinguishable from TURN/UDP:3478 without it, while their
   * latency is not. WORST-CASE across legs (udp < tcp < ssltcp/tls) for the same
   * reason as `candidate`.
   */
  protocol: string | null;
  /**
   * What WE are ENCODING, from the `codec` entry the outbound stream names. The
   * send side deliberately, because that is what the H.264 preference is about and
   * what burns a phone's CPU — and on an SFU the forwarded codec is the produced
   * one, so it stays the right question after the cutover.
   *
   * `codecVideo === null` on a voice call is itself the confirmation the voice/video
   * doc asks for ("confirm no camera track is published"). Legs that disagree are
   * joined rather than collapsed, so a heterogeneous mesh is visible.
   */
  codecAudio: string | null;
  codecVideo: string | null;
  /** What WE are sending: the largest published frame + its rate. */
  up: { w: number; h: number; fps: number | null } | null;
  /** What we are RECEIVING: the largest inbound frame + its rate. */
  down: { w: number; h: number; fps: number | null } | null;
  /** Throughput, kbps, derived from a byte DELTA — null on the first sample. */
  kbpsUp: number | null;
  kbpsDown: number | null;
  /** How many peer connections / tracks this summary covers. */
  legs: number;
  /**
   * WHERE our video is being encoded, verbatim from the browser. Null when we are
   * publishing no video (a voice call) or the UA does not report it.
   *
   * This is the pass/fail signal for the H.264 preference: on an iPhone it must
   * read a hardware encoder. VP8 has no hardware encoder there, so a software
   * value on a video call means the phone is burning CPU for the call's duration.
   */
  encoder: string | null;
  /** True when the encoder names a known SOFTWARE implementation. Null = unknown. */
  encoderSoftware: boolean | null;
  /**
   * The sender's own reason for degrading quality. `"cpu"` is the thermal-throttle
   * smoking gun — the device could not keep up, which is exactly what a hot phone
   * looks like from inside the page. WORST-CASE across legs, like `path`: one
   * cpu-limited leg is a cpu-limited call.
   */
  limitedBy: string | null;
  /**
   * Evidence that the audio we were sent was actually HEARD (v2.107.10).
   *
   * Null when no leg reported an inbound audio stream at all — never a
   * zero-filled record, because "no audio stream" and "an audio stream that
   * delivered nothing" are different findings and one must not read as the other.
   *
   * This is the counter that separates a transport failure from a playout
   * failure, and its absence is why an audio outage had to be argued from coturn
   * logs rather than from the app.
   */
  audioIn: AudioInbound | null;
}

/** Byte counters plus the moment they were read, so the next call can difference them. */
export interface ByteSample {
  bytesSent: number;
  bytesReceived: number;
  atMs: number;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * How far each ICE candidate type is from ideal, and each transport protocol.
 *
 * Worst-case reductions need an ORDER, and an order has to be chosen rather than
 * assumed — a 5-leg mesh call has no single candidate type. Ranked by round-trip
 * cost: a host pair is same-LAN, prflx/srflx are direct through NAT, and a relay
 * pair detours through coturn. UNLISTED values are ignored, not ranked, so an
 * unrecognised type can never be reported as the worst one.
 */
const CANDIDATE_RANK: Record<string, number> = { host: 0, prflx: 1, srflx: 2, relay: 3 };
const PROTOCOL_RANK: Record<string, number> = { udp: 0, tcp: 1, ssltcp: 2, tls: 3 };

/** How much of a leg's own evidence makes its loss ratio trustworthy. At ~50
 *  audio packets a second that is one second of call; below it a freshly-joined
 *  peer's 1-of-2 reads as 50% and would flip a healthy call to "poor". */
export const LOSS_MIN_PACKETS = 50;

/** Take the worse of two ranked values, ignoring anything the table does not know. */
function worseOf(cur: string | null, next: unknown, rank: Record<string, number>): string | null {
  if (typeof next !== "string") return cur;
  const v = next.toLowerCase();
  if (!(v in rank)) return cur;
  if (cur === null) return v;
  return rank[v] > rank[cur] ? v : cur;
}

/**
 * Reduce one or more stats reports to a single summary.
 *
 * `prev` + `now` are what make throughput possible: a stats report carries
 * CUMULATIVE byte counters, so a bitrate is a difference over elapsed time and a
 * single sample can only ever answer null. Passing the clock in rather than calling
 * `Date.now()` keeps the function pure and its arithmetic checkable.
 */
export function summarizeStats(
  reports: StatsInput[],
  opts: { prev?: ByteSample | null; nowMs: number } = { nowMs: 0 },
): { stats: CallStats; sample: ByteSample } {
  let rttMs: number | null = null;
  let lost = 0;
  let received = 0;
  let jitterWorstMs: number | null = null;
  let lossWorstPct: number | null = null;
  let candidate: string | null = null;
  let protocol: string | null = null;
  const codecUp = { audio: new Set<string>(), video: new Set<string>() };
  let sawPair = false;
  let up: CallStats["up"] = null;
  let down: CallStats["down"] = null;
  let encoder: string | null = null;
  let limitedBy: string | null = null;
  let bytesSent = 0;
  let bytesReceived = 0;
  let legs = 0;
  let sawAudioIn = false;
  let audioInPackets = 0;
  let audioInEnergy: number | null = null;
  let audioInPlayoutSec: number | null = null;

  for (const report of reports) {
    legs++;
    // Index candidates by id first: a candidate PAIR names its ends by id, so the
    // types can only be resolved after the whole report has been seen. Doing it in
    // one pass would work only if the browser emitted candidates before pairs,
    // which is not guaranteed.
    const byId = new Map<string, StatEntry>();
    const entries: StatEntry[] = [];
    for (const e of report) {
      entries.push(e);
      if (e && typeof e.id === "string") byId.set(e.id, e);
    }

    /* This leg's own loss, so the worst peer can be reported alongside the pooled
       figure. Pooling audio and video WITHIN a leg is right — that is one peer's
       loss — while pooling ACROSS legs is what hides a bad one. */
    let legLost = 0;
    let legReceived = 0;

    for (const e of entries) {
      if (!e) continue;

      if (e.type === "candidate-pair" && e.state === "succeeded") {
        // Several pairs can read "succeeded"; the nominated/selected one is the one
        // carrying media. Absent that flag, any succeeded pair is better than none.
        const preferred = e.nominated === true || e.selected === true;
        const r = num(e.currentRoundTripTime);
        // `currentRoundTripTime` is SECONDS per spec. Reporting it raw would show
        // "0.04 ms" and read as a perfect connection.
        if (r !== null && (preferred || rttMs === null)) rttMs = r * 1000;
        sawPair = true;
        const l = e.localCandidateId ? byId.get(e.localCandidateId) : undefined;
        const rm = e.remoteCandidateId ? byId.get(e.remoteCandidateId) : undefined;
        candidate = worseOf(candidate, l?.candidateType, CANDIDATE_RANK);
        candidate = worseOf(candidate, rm?.candidateType, CANDIDATE_RANK);
        /* The protocol is read from the CANDIDATES, never from the pair — the pair
           carries no `protocol` field, so reading it there returns undefined and
           renders nothing while appearing done. Local first: it is the leg WE own,
           and a relayed pair's two ends can legitimately differ. */
        protocol = worseOf(protocol, l?.protocol, PROTOCOL_RANK);
        protocol = worseOf(protocol, rm?.protocol, PROTOCOL_RANK);
      }

      if (e.type === "inbound-rtp") {
        lost += num(e.packetsLost) ?? 0;
        received += num(e.packetsReceived) ?? 0;
        legLost += num(e.packetsLost) ?? 0;
        legReceived += num(e.packetsReceived) ?? 0;
        const j = num(e.jitter);
        // Jitter is SECONDS too, and worst-case across legs for the same reason as
        // `path`: one smooth leg does not make a choppy call smooth.
        if (j !== null) jitterWorstMs = Math.max(jitterWorstMs ?? 0, j * 1000);
        bytesReceived += num(e.bytesReceived) ?? 0;
        const w = num(e.frameWidth);
        const h = num(e.frameHeight);
        if (w && h && (!down || w * h > down.w * down.h)) {
          down = { w, h, fps: num(e.framesPerSecond) };
        }
        /* THE AUDIO PLAYOUT EVIDENCE. Attributed on an EXPLICIT kind only: a UA
           that reports neither `kind` nor `mediaType` leaves `audioIn` null and
           this makes no claim, which is right — guessing "it must be audio
           because it has no frame size" would put a video leg's counters behind
           a sentence about somebody's microphone. Summed across legs, because
           the question ("is any audio reaching this person") is about the call
           rather than about one peer. */
        if (e.kind === "audio" || e.mediaType === "audio") {
          sawAudioIn = true;
          audioInPackets += num(e.packetsReceived) ?? 0;
          const en = num(e.totalAudioEnergy);
          if (en !== null) audioInEnergy = (audioInEnergy ?? 0) + en;
          const sec = num(e.totalSamplesDuration);
          if (sec !== null) audioInPlayoutSec = (audioInPlayoutSec ?? 0) + sec;
        }
      }

      if (e.type === "outbound-rtp") {
        bytesSent += num(e.bytesSent) ?? 0;
        const w = num(e.frameWidth);
        const h = num(e.frameHeight);
        /* THE CODEC'S OWN mimeType DECIDES WHICH KIND IT IS, so no `kind` guess is
           needed at all: a codec entry reads "audio/opus" or "video/H264" and is
           self-describing. Deriving the kind from the rtp entry instead would have
           to guess for a UA that reports neither `kind` nor `mediaType`.

           A VIDEO CODEC IS REPORTED ONLY WHEN FRAMES ARE ACTUALLY BEING SENT, and
           that gate came out of a real voice call: under mutual consent the offerer
           negotiates a video m-line with a NULL TRACK for the slot the camera would
           later fill (v2.106.51), so a voice call HAS an outbound video stream with
           a codec and no frames — and the readout said "VP8" on a call with no
           camera, which is the exact false impression this release exists to
           remove. The evidence used is the frame size, i.e. the SAME evidence `up`
           below uses, so the codec line and the resolution line can never disagree
           about whether video is live. */
        const c = e.codecId ? byId.get(e.codecId) : undefined;
        const mime = typeof c?.mimeType === "string" ? c.mimeType : "";
        const slash = mime.indexOf("/");
        if (slash > 0) {
          const top = mime.slice(0, slash).toLowerCase();
          const name = mime.slice(slash + 1);
          if (name && top === "audio") codecUp.audio.add(name);
          if (name && top === "video" && w && h) codecUp.video.add(name);
        }
        /* VIDEO ONLY, and the guard matters: an audio outbound-rtp reports no
           encoder and no limitation, so folding it in would let a voice leg
           overwrite a real video reading with nulls. A frame size is the test
           that works even when `kind` is absent (older UAs spell it
           `mediaType`), because only video has one. */
        const isVideo = e.kind === "video" || e.mediaType === "video" ||
                        (num(e.frameWidth) ?? 0) > 0;
        if (isVideo) {
          const impl = typeof e.encoderImplementation === "string" ? e.encoderImplementation : null;
          if (impl) encoder = impl;
          const lim = typeof e.qualityLimitationReason === "string" ? e.qualityLimitationReason : null;
          /* "none" is the healthy value and must not shadow a real reason from
             another leg — worst-case wins, and cpu outranks everything. */
          if (lim && lim !== "none" && (limitedBy === null || lim === "cpu")) limitedBy = lim;
        }
        // LARGEST, not last: with simulcast a publisher reports one outbound-rtp per
        // spatial layer, and the low layer would otherwise be shown as "what you are
        // sending" — making a healthy 720p publish read as 180p.
        if (w && h && (!up || w * h > up.w * up.h)) {
          up = { w, h, fps: num(e.framesPerSecond) };
        }
      }
    }

    /* Reduced AFTER the leg's entries, so audio and video are pooled within the leg
       and only then compared across legs. */
    const legSeen = legLost + legReceived;
    if (legSeen >= LOSS_MIN_PACKETS) {
      const pct = Math.round((legLost / legSeen) * 1000) / 10;
      if (lossWorstPct === null || pct > lossWorstPct) lossWorstPct = pct;
    }
  }

  const sample: ByteSample = { bytesSent, bytesReceived, atMs: opts.nowMs };
  let kbpsUp: number | null = null;
  let kbpsDown: number | null = null;
  const prev = opts.prev;
  if (prev) {
    const dt = (opts.nowMs - prev.atMs) / 1000;
    // A non-positive interval yields no rate rather than Infinity, and a counter
    // that went BACKWARDS (a renegotiation, a track republish) is treated as no
    // data rather than a negative bitrate.
    if (dt > 0) {
      const dUp = bytesSent - prev.bytesSent;
      const dDown = bytesReceived - prev.bytesReceived;
      if (dUp >= 0) kbpsUp = Math.round((dUp * 8) / dt / 1000);
      if (dDown >= 0) kbpsDown = Math.round((dDown * 8) / dt / 1000);
    }
  }

  return {
    stats: {
      rttMs: rttMs === null ? null : Math.round(rttMs),
      // The denominator is received + lost, i.e. packets that were SENT to us —
      // dividing by `received` alone understates loss, and by anything else is
      // meaningless.
      lossPct: received + lost > 0 ? Math.round((lost / (received + lost)) * 1000) / 10 : null,
      lossWorstPct,
      jitterMs: jitterWorstMs === null ? null : Math.round(jitterWorstMs * 10) / 10,
      // `unknown` when no succeeded pair was reported at all — never "direct",
      // which would be a claim about the media path we have no evidence for.
      // DERIVED from `candidate` so the relay rule lives in exactly one place; an
      // unrecognised candidate type leaves `candidate` null and reads "direct",
      // which is byte-identical to the `anyRelay` flag this replaced.
      path: !sawPair ? "unknown" : candidate === "relay" ? "relay" : "direct",
      candidate,
      protocol,
      codecAudio: joinCodecs(codecUp.audio),
      codecVideo: joinCodecs(codecUp.video),
      up,
      down,
      kbpsUp,
      kbpsDown,
      legs,
      encoder,
      encoderSoftware: encoder === null ? null : isSoftwareEncoder(encoder),
      limitedBy,
      audioIn: sawAudioIn
        ? {
            packets: audioInPackets,
            energy: audioInEnergy,
            playoutSec: audioInPlayoutSec,
            state: audioInboundState(audioInPackets, audioInEnergy, audioInPlayoutSec),
          }
        : null,
    },
    sample,
  };
}

/** One codec name, or every distinct one joined — because legs that disagree about
 *  the codec is a real finding, and collapsing to "the first one" would hide it.
 *  Sorted so the string is stable across reports rather than following whichever
 *  peer's entry the browser emitted first. */
function joinCodecs(set: Set<string>): string | null {
  const out: string[] = [];
  set.forEach((v) => out.push(v));
  if (!out.length) return null;
  out.sort();
  return out.join("/");
}

/**
 * Is this encoder name a SOFTWARE implementation?
 *
 * Matched on the software names rather than the hardware ones, deliberately: the
 * hardware list is open-ended and vendor-specific (VideoToolbox, MediaFoundation,
 * ExternalEncoder, NVENC, …), so an unrecognised value would read as "software"
 * and cry wolf on a perfectly good call. The software encoders are a short, stable,
 * well-known set. An unknown name is therefore NOT reported as software — it
 * reports as not-software, which is the quiet direction to be wrong in.
 *
 * Chromium prefixes its own with "libvpx"/"libaom"/"OpenH264"; a value may also be
 * decorated, e.g. "SimulcastEncoderAdapter (libvpx, libvpx)", so it is a substring
 * test rather than an equality one.
 */
export function isSoftwareEncoder(impl: string): boolean {
  const v = impl.toLowerCase();
  return v.includes("libvpx") || v.includes("libaom") || v.includes("openh264") ||
         v.includes("ffmpeg") || v.includes("x264");
}

/** One line, for the in-call chip. Every field is omitted rather than shown empty,
 *  so a partially-reported call reads as short rather than as broken. */
export function formatCallStats(s: CallStats): string {
  const parts: string[] = [];
  if (s.rttMs !== null) parts.push(`${s.rttMs}ms`);
  if (s.lossPct !== null) parts.push(`${s.lossPct}% loss`);
  if (s.jitterMs !== null) parts.push(`${s.jitterMs}ms jit`);
  // Named even when it is the good case, because "direct" is the reassurance that
  // makes "relay" mean something when it appears.
  if (s.path !== "unknown") parts.push(s.path === "relay" ? "via TURN relay" : "direct");
  if (s.up) parts.push(`↑${s.up.w}×${s.up.h}${s.up.fps !== null ? `@${Math.round(s.up.fps)}` : ""}`);
  if (s.kbpsUp !== null) parts.push(`↑${s.kbpsUp}kbps`);
  if (s.down) parts.push(`↓${s.down.w}×${s.down.h}${s.down.fps !== null ? `@${Math.round(s.down.fps)}` : ""}`);
  if (s.kbpsDown !== null) parts.push(`↓${s.kbpsDown}kbps`);
  /* THE THERMAL READOUT. "sw encode" is surfaced only for the BAD case, because a
     hardware encoder is the expectation and naming it every call would be noise —
     the raw name goes on the DETAIL line instead, where the owner's phone test can
     read it. The LIMITATION, though, is surfaced whatever it says: `bandwidth` is
     the literal "starts fine and then degrades" signal the owner reported, and it
     was captured and invisible until v2.106.58. */
  if (s.encoderSoftware === true) parts.push("sw encode");
  if (s.limitedBy) parts.push(`${s.limitedBy} limited`);
  /* THE PLAYOUT DIAGNOSIS, IN WORDS (v2.107.10) — and it belongs on LINE 1, with
     the verdicts, rather than on the detail line with the raw counters: "the
     audio is arriving and you cannot hear it" is a statement about how the call
     is GOING, and it is the single most useful sentence this readout can produce.
     Only the definite case is worded. `no-sound` is left to the detail line
     because it is usually a muted peer, and a readout that accuses the app every
     time somebody mutes is one nobody trusts on the day it is right. */
  if (s.audioIn?.state === "not-playing") parts.push("audio not playing out");
  return parts.length ? parts.join(" · ") : "measuring…";
}

/**
 * The DIAGNOSTIC line: what the call is made of, rather than how well it is going.
 *
 * SEPARATE FROM `formatCallStats` rather than appended to it, and that split is the
 * point. The two lines answer different questions — "is this call bad?" versus "what
 * is this call?" — and merging them would put the always-relevant numbers and the
 * only-relevant-while-diagnosing detail in one `text-overflow: ellipsis` run, where
 * anything added silently truncates the END. The thermal words already sit there.
 *
 * Every field is omitted when absent, so a call with nothing distinctive to say
 * produces an EMPTY string and the readout stays one line.
 */
export function formatCallDetail(s: CallStats): string {
  const parts: string[] = [];
  /* The specific candidate type, which `path` cannot express: `host` and `srflx`
     both read "direct" and are different situations. Protocol rides with it because
     the pair is the one thing they both describe. */
  if (s.candidate) parts.push(s.protocol ? `${s.candidate}/${s.protocol}` : s.candidate);
  else if (s.protocol) parts.push(s.protocol);
  /* ↑ reuses the send-direction glyph line 1 already uses for resolution and
     throughput, so one vocabulary covers both lines. */
  if (s.codecAudio) parts.push(`↑${s.codecAudio}`);
  if (s.codecVideo) parts.push(`↑${s.codecVideo}`);
  if (s.encoder) parts.push(`enc ${s.encoder}`);
  /* THE RAW AUDIO EVIDENCE, always when there is an inbound audio stream — not
     only when something looks wrong. That is deliberate: the point of a number is
     that it can be compared, and "what does this read on a call that WORKS" is
     exactly the question an outage makes unanswerable if the figure only appears
     during one. ↓ is the receive glyph line 1 already uses. */
  if (s.audioIn) {
    const a = s.audioIn;
    const energy = a.energy === null ? "?" : a.energy.toFixed(2);
    parts.push(`↓aud ${a.packets}pkt/${energy}e`);
    if (a.state === "no-sound") parts.push("silent (muted?)");
  }
  /* WORST LEG, and only when it differs from the pooled figure — on a 1:1 call they
     are the same number by construction, so showing both would be noise on the
     overwhelmingly common case. */
  if (s.lossWorstPct !== null && s.lossPct !== null && s.lossWorstPct > s.lossPct) {
    parts.push(`worst leg ${s.lossWorstPct}%`);
  }
  if (s.legs > 1) parts.push(`${s.legs} legs`);
  return parts.join(" · ");
}

/**
 * Is this reading worth flagging to the user?
 *
 * Thresholds are deliberately generous — this exists to catch a call that is
 * genuinely bad, not to editorialise about a good one. A TURN relay is called out
 * on its own regardless of the numbers, because it is a fixable misconfiguration
 * rather than a condition to tolerate.
 */
export function callStatsVerdict(s: CallStats): "relay" | "poor" | "ok" {
  if (s.path === "relay") return "relay";
  /* A CPU-LIMITED SENDER IS A POOR CALL EVEN WHEN THE NETWORK NUMBERS ARE PERFECT,
     and that is the whole point of reading it: thermal throttling degrades the
     picture with a 1ms RTT and zero loss, so every other threshold here says the
     call is fine while the person is watching it fall apart. Software encoding
     ALONE is deliberately NOT poor — it is a warning sign about heat over time,
     not a statement about this instant, and a desktop encoding VP8 in software is
     perfectly healthy. */
  if (s.limitedBy === "cpu") return "poor";
  /* AUDIO THAT ARRIVED AND WAS NEVER RENDERED IS THE WORST CALL THERE IS, and
     every network threshold below says it is fine — v2.106.51 read 1ms RTT, zero
     loss and total silence. `no-sound` is deliberately NOT poor: that is what a
     muted peer looks like. */
  if (s.audioIn?.state === "not-playing") return "poor";
  if ((s.rttMs ?? 0) > 300) return "poor";
  if ((s.lossPct ?? 0) > 5) return "poor";
  /* AND THE WORST SINGLE LEG, because the pooled ratio above dilutes: on a 5-way
     mesh call one peer losing 20% is a bad call for that peer and reads as 4% once
     four clean legs are averaged in. The `LOSS_MIN_PACKETS` floor inside
     `summarizeStats` is what stops a two-second-old leg's 1-of-2 firing this. */
  if ((s.lossWorstPct ?? 0) > 5) return "poor";
  if ((s.jitterMs ?? 0) > 50) return "poor";
  return "ok";
}

/** Which hue the in-call readout wears (board 5c). */
export type QualityTone = "good" | "warn" | "neutral";

/**
 * Map a summary to the readout's colour state.
 *
 * `callStatsVerdict` is left untouched and is READ here, so the thresholds live in
 * exactly one place — but its "ok" cannot be painted accent on its own, and that
 * distinction is the whole reason this function exists. `summarizeStats([])` is
 * "ok": the verdict deliberately treats unknown values as not-poor, because
 * absence is not evidence of a bad call. Painting THAT accent would make a bright
 * pill assert a healthy call on zero evidence — including during a ring, before
 * any candidate pair exists.
 *
 * So `good` additionally requires a MEASURED media path. `path` is the one field
 * that cannot be reported without a succeeded candidate pair, which makes it the
 * honest test for "this is a real reading" rather than a placeholder.
 */
export function callQualityTone(s: CallStats): QualityTone {
  const v = callStatsVerdict(s);
  if (v === "relay" || v === "poor") return "warn";
  if (s.path === "unknown") return "neutral";
  return "good";
}
