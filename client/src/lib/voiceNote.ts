/* ============================================================
   Shared voice-note recording helpers (v2.88).

   Factored out of Messages.tsx so BOTH voice-note flows use one
   implementation:
     - the Messages composer's mic button (unlimited length), and
     - the voicemail prompt after a failed dial (60s cap).

   Safari (especially mobile) does not support "audio/webm", so we
   probe the browser's supported MIME types and pick the first that
   works — the exact logic Messages shipped since v2.31.
   ============================================================ */

export interface AudioMimePick {
  mimeType: string;
  ext: string;
}

/**
 * Spellings that ask for AAC-in-MP4 EXPLICITLY — the one pairing every current engine
 * can decode, and therefore the only container that makes a note recorded on Android
 * playable on an iPhone.
 *
 * `audio/mp4` BARE IS DELIBERATELY NOT IN THIS LIST, and that omission is the point.
 * MEASURED in this repo's Chromium 141: `isTypeSupported("audio/mp4")` answers **true**,
 * and the recorder then reveals `audio/mp4;codecs=opus` — Opus inside a real MP4
 * container (`ftypisom` in the bytes). Safari cannot decode Opus-in-MP4 either, so
 * preferring that spelling would produce a file that LOOKS right (right container, right
 * extension, right type) and still fails on iPhone — strictly harder to diagnose than
 * today's honest WebM failure. This is v2.98.0's video-mislabel trap on the audio side,
 * which is why the check below is on the REVEALED type rather than on `isTypeSupported`.
 */
const AAC_MP4 = ["audio/mp4;codecs=mp4a.40.2", "audio/mp4;codecs=aac"];

/** Is a recorder's REVEALED mime type genuinely AAC-in-MP4? */
export function isAacMp4(mimeType: string): boolean {
  const m = (mimeType || "").toLowerCase();
  if (!m.startsWith("audio/mp4")) return false;
  // No codecs parameter at all is UNPROVEN, not proven — refuse it, because that is
  // exactly the shape bare `audio/mp4` reports before it admits to Opus.
  if (!m.includes("codecs=")) return false;
  return m.includes("mp4a") || m.includes("aac");
}

/**
 * Probe MediaRecorder for a supported audio container. Null ⇒ no recorder.
 *
 * THE ORDER IS A COMPATIBILITY DECISION (v2.106.89, owner: the voice bar is broken on
 * iPhone). WebM/Opus used to be first, so an ANDROID phone recorded WebM — and iOS Safari
 * has no WebM demuxer at all, so those notes are undecodable on every iPhone: the element
 * errors, `duration` stays NaN, the bar sits at zero and the play button does nothing.
 * Safari itself records `audio/mp4`, which Android CAN decode, which is exactly why the
 * breakage only ever ran one way round.
 *
 * So an explicit AAC-in-MP4 is preferred where an engine really offers it, and WebM
 * remains the fallback for engines that do not — which is no worse than today for them.
 */
export function pickAudioMime(): AudioMimePick | null {
  if (typeof window === "undefined" || !window.MediaRecorder) return null;
  const candidates: AudioMimePick[] = [
    ...AAC_MP4.map((mimeType) => ({ mimeType, ext: "m4a" })),
    { mimeType: "audio/webm;codecs=opus", ext: "webm" },
    { mimeType: "audio/webm", ext: "webm" },
    { mimeType: "audio/mp4", ext: "m4a" }, // Safari — genuinely AAC there
    { mimeType: "audio/aac", ext: "m4a" }, // some Safari builds
    { mimeType: "audio/ogg;codecs=opus", ext: "ogg" },
  ];
  for (const c of candidates) {
    try {
      if (window.MediaRecorder.isTypeSupported(c.mimeType)) return c;
    } catch {
      /* ignore */
    }
  }
  // last-ditch: let the browser pick its default by passing no mimeType
  return { mimeType: "", ext: "bin" };
}

/** True when this browser can record voice notes at all. */
export function recorderSupported(): boolean {
  return typeof window !== "undefined" && typeof window.MediaRecorder === "function";
}

export interface VoiceRecording {
  /** Stop recording; resolves the same promise `done` exposes. */
  stop: () => void;
  /** Abort: stop everything and discard — `done` resolves null. */
  cancel: () => void;
  /**
   * Pause/resume (v2.99.72, owner ask: "you can pause the voice"). MediaRecorder
   * supports this natively, and paused time is EXCLUDED from the reported duration —
   * otherwise a note paused for a minute would claim to be a minute longer than the
   * audio it contains, and every player would show a bogus total.
   */
  pause: () => void;
  resume: () => void;
  /** "recording" | "paused" | "inactive", straight from the recorder. */
  state: () => string;
  /**
   * Current microphone loudness, 0..1 (v2.99.72, owner ask: "it doesn't show that you
   * are talking… no wave when you talk").
   *
   * Read on demand rather than pushed, so the UI samples it on its own animation frame
   * and an idle recorder costs nothing. Returns 0 when the analyser is unavailable —
   * a level meter must never be the reason recording fails.
   */
  level: () => number;
  /** Milliseconds of AUDIO recorded so far, excluding any paused time. */
  elapsedMs: () => number;
  /** Resolves with the finished audio (or null when cancelled/empty). */
  done: Promise<{ blob: Blob; ext: string; durationMs: number } | null>;
}

/**
 * Start recording from the microphone. Always releases the mic when the
 * recording ends (stop, cancel, or the optional `maxMs` cap firing).
 * Throws when getUserMedia is denied/unavailable.
 */
export async function startVoiceRecording(opts?: { maxMs?: number }): Promise<VoiceRecording> {
  const pick = pickAudioMime();
  if (!pick) throw new Error("Voice recording isn't supported by this browser.");
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  // v2.99.36: the ONLY release of this mic used to be inside rec.onstop, so a
  // MediaRecorder that fails to construct or start (unsupported mime
  // substitution, device yanked, browser quirk) threw with the microphone still
  // captured — the mic indicator stayed on with no handle left to stop it.
  // Anything that throws before we return a handle must release the mic.
  let rec: MediaRecorder;
  try {
    rec = pick.mimeType
      ? new MediaRecorder(stream, { mimeType: pick.mimeType })
      : new MediaRecorder(stream);
  } catch (e) {
    stream.getTracks().forEach((t) => t.stop());
    throw e;
  }
  const chunks: Blob[] = [];
  let cancelled = false;
  let capT: ReturnType<typeof setTimeout> | null = null;

  // ── elapsed time, excluding pauses ──
  // Accumulate completed run-lengths and time the current run separately, so a pause
  // genuinely stops the clock. Using a single startedAt would count paused wall-clock
  // as audio and hand every player a duration longer than the sound.
  let accumulatedMs = 0;
  let runStartedAt: number | null = Date.now();
  const elapsedMs = () =>
    accumulatedMs + (runStartedAt == null ? 0 : Date.now() - runStartedAt);

  // ── live input level ──
  // A WebAudio analyser on the SAME stream the recorder uses, so the meter shows the
  // audio actually being captured rather than a second, differently-gated capture.
  // Entirely optional: every failure path leaves `level()` returning 0.
  let ac: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  let levelBuf: Uint8Array<ArrayBuffer> | null = null;
  try {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (Ctor) {
      ac = new Ctor();
      /* THE LEVEL METER WAS DEAD ON iPHONE, AND THE CAUSE IS THE AWAIT ABOVE (v2.106.89).
       *
       * `getUserMedia` is awaited before we get here, so the synchronous user gesture is
       * long gone by the time this context is constructed — and WebKit starts a context
       * created outside a gesture SUSPENDED. A suspended context does not run its graph,
       * so `getByteTimeDomainData` keeps handing back the all-128 midpoint fill and
       * `level()` returns exactly 0 for the whole recording. The 30 bars the composer
       * draws are driven by nothing else, so they sit flat at their floor: the owner's
       * *"no wave when you talk"* on iPhone, and the second half of *"this voice bar …
       * the iPhone showing"*.
       *
       * This repo already knows this — `relayClient.ts` resumes for the IDENTICAL
       * mic → analyser → level pattern, and `dtmf.ts` and `Home.tsx` both name it in
       * prose as "the classic iOS Web Audio race". The recorder was simply never given
       * the same line.
       *
       * Fire-and-forget: a resume that never settles must not delay the recording, and
       * every failure path here already leaves `level()` returning 0. */
      void ac.resume?.().catch(() => {
        /* a meter is never a reason for recording to fail */
      });
      const src = ac.createMediaStreamSource(stream);
      analyser = ac.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.35;
      src.connect(analyser);
      // Deliberately NOT connected to ac.destination: routing the mic to the speakers
      // during recording is a feedback loop.
      levelBuf = new Uint8Array(new ArrayBuffer(analyser.fftSize));
    }
  } catch {
    ac = null;
    analyser = null;
  }
  const level = (): number => {
    if (!analyser || !levelBuf) return 0;
    try {
      analyser.getByteTimeDomainData(levelBuf);
      // RMS of the waveform around the 128 midpoint. RMS rather than peak because a
      // peak meter pins to the top on any transient and stops conveying speech.
      let sum = 0;
      for (let i = 0; i < levelBuf.length; i++) {
        const v = (levelBuf[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / levelBuf.length);
      // Speech RMS sits low (~0.02-0.2), so scale it into something a bar can show
      // while still leaving headroom at the top.
      return Math.min(1, rms * 4.5);
    } catch {
      return 0;
    }
  };
  const releaseAudio = () => {
    try {
      analyser?.disconnect();
      void ac?.close();
    } catch {
      /* nothing to do */
    }
    ac = null;
    analyser = null;
    levelBuf = null;
  };

  /* `done` MUST ALWAYS SETTLE, AND IT USED TO BE ABLE NOT TO.
   *
   * It resolved ONLY inside `rec.onstop`. There was no `onerror`, and the duration cap
   * below calls `rec.stop()` — which itself depends on `onstop` firing. So a recorder that
   * went inactive WITHOUT firing it (an iOS call/Siri interruption, mic contention with
   * another tab, a MediaRecorder `error` event) left this promise pending forever.
   *
   * WHAT THAT COST THE USER IS OUT OF ALL PROPORTION TO THE CAUSE. In `Messages.tsx`,
   * `setRecording(false)` lives only in that promise's `.finally()`, and while `recording`
   * is true the whole composer is REPLACED by the recording bar — no text field, no send
   * button — and both of that bar's exits (Discard and Send) call `stop()`, which is a
   * no-op on an already-inactive recorder. So both ways out were dead and the only escape
   * was navigating away. The mic is also the DEFAULT primary button while the field is
   * empty, i.e. exactly what somebody taps first. That is a complete, silent lock-out of
   * sending, which is what the owner reported.
   *
   * So the resolver is hoisted out and made IDEMPOTENT, and there are now four paths to it:
   * a normal stop, a recorder error, an already-inactive recorder, and a hard deadline.
   * Whichever fires first wins and the rest are no-ops. */
  let settle: (v: { blob: Blob; ext: string; durationMs: number } | null) => void = () => {};
  let settled = false;
  let deadlineT: ReturnType<typeof setTimeout> | null = null;

  const finish = (opts?: { discard?: boolean }) => {
    if (settled) return;
    settled = true;
    if (capT) clearTimeout(capT);
    if (deadlineT) clearTimeout(deadlineT);
    if (runStartedAt != null) {
      accumulatedMs += Date.now() - runStartedAt;
      runStartedAt = null;
    }
    releaseAudio();
    stream.getTracks().forEach((t) => t.stop()); // mic LED off, always — every path
    if (opts?.discard || cancelled || chunks.length === 0) {
      settle(null);
      return;
    }
    // Use the recorder's actual mimeType (browsers sometimes substitute one).
    const finalMime = rec.mimeType || pick.mimeType || "application/octet-stream";
    settle({
      blob: new Blob(chunks, { type: finalMime }),
      ext: pick.ext,
      durationMs: accumulatedMs,
    });
  };

  const done = new Promise<{ blob: Blob; ext: string; durationMs: number } | null>((resolve) => {
    settle = resolve;
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    rec.onstop = () => finish();
    /* A recorder ERROR settles with whatever was captured rather than discarding it: the
       chunks already collected are real audio, and losing a recording somebody made is
       worse than sending a slightly short one. If nothing was captured, `finish` resolves
       null on its own. */
    rec.onerror = () => finish();
  });

  try {
    rec.start();
  } catch (e) {
    // Same reasoning as the construction guard above: never leave the mic open.
    releaseAudio();
    stream.getTracks().forEach((t) => t.stop());
    throw e;
  }
  if (opts?.maxMs && opts.maxMs > 0) {
    capT = setTimeout(() => {
      try {
        if (rec.state !== "inactive") rec.stop();
      } catch {
        /* already stopped */
      }
      // …and settle even if that stop produced no `onstop`. Without this the duration cap
      // was itself a way to hang: it asked the recorder to stop and then trusted an event.
      finish();
    }, opts.maxMs);
  }

  /* THE BACKSTOP. Every other path depends on the recorder behaving; this one does not.
     Generous — the cap plus a wide margin, or a flat ceiling when there is no cap — because
     its job is to make "pending forever" impossible, not to enforce a limit. A recording cut
     short by this is a bad outcome; a composer nobody can escape is a worse one. */
  const DEADLINE_MS = (opts?.maxMs && opts.maxMs > 0 ? opts.maxMs : 5 * 60_000) + 30_000;
  deadlineT = setTimeout(() => finish(), DEADLINE_MS);

  const safeStop = () => {
    try {
      if (rec.state !== "inactive") {
        rec.stop(); // `onstop` → finish()
        return;
      }
    } catch {
      /* fall through and settle directly */
    }
    /* ALREADY INACTIVE, so `stop()` fires nothing. This is the case that locked the
       composer: the bar's Discard and Send both routed here, both were no-ops, and neither
       button did anything ever again. Settling directly is what makes them work. */
    finish();
  };
  return {
    stop: safeStop,
    cancel: () => {
      cancelled = true;
      safeStop();
    },
    pause: () => {
      try {
        if (rec.state === "recording") {
          rec.pause();
          if (runStartedAt != null) {
            accumulatedMs += Date.now() - runStartedAt;
            runStartedAt = null;
          }
        }
      } catch {
        /* engine without pause support — the recorder simply keeps running */
      }
    },
    resume: () => {
      try {
        if (rec.state === "paused") {
          rec.resume();
          runStartedAt = Date.now();
        }
      } catch {
        /* as above */
      }
    },
    state: () => {
      try {
        return rec.state;
      } catch {
        return "inactive";
      }
    },
    level,
    elapsedMs,
    done,
  };
}
