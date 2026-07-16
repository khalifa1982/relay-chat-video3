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

/** Probe MediaRecorder for a supported audio container. Null ⇒ no recorder. */
export function pickAudioMime(): AudioMimePick | null {
  if (typeof window === "undefined" || !window.MediaRecorder) return null;
  const candidates: AudioMimePick[] = [
    { mimeType: "audio/webm;codecs=opus", ext: "webm" },
    { mimeType: "audio/webm", ext: "webm" },
    { mimeType: "audio/mp4", ext: "m4a" }, // Safari
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
  const rec = pick.mimeType
    ? new MediaRecorder(stream, { mimeType: pick.mimeType })
    : new MediaRecorder(stream);
  const chunks: Blob[] = [];
  const startedAt = Date.now();
  let cancelled = false;
  let capT: ReturnType<typeof setTimeout> | null = null;

  const done = new Promise<{ blob: Blob; ext: string; durationMs: number } | null>((resolve) => {
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    rec.onstop = () => {
      if (capT) clearTimeout(capT);
      stream.getTracks().forEach((t) => t.stop()); // mic LED off, always
      if (cancelled || chunks.length === 0) {
        resolve(null);
        return;
      }
      // Use the recorder's actual mimeType (browsers sometimes substitute one).
      const finalMime = rec.mimeType || pick.mimeType || "application/octet-stream";
      resolve({
        blob: new Blob(chunks, { type: finalMime }),
        ext: pick.ext,
        durationMs: Date.now() - startedAt,
      });
    };
  });

  rec.start();
  if (opts?.maxMs && opts.maxMs > 0) {
    capT = setTimeout(() => {
      try {
        if (rec.state !== "inactive") rec.stop();
      } catch {
        /* already stopped */
      }
    }, opts.maxMs);
  }

  const safeStop = () => {
    try {
      if (rec.state !== "inactive") rec.stop();
    } catch {
      /* already stopped */
    }
  };
  return {
    stop: safeStop,
    cancel: () => {
      cancelled = true;
      safeStop();
    },
    done,
  };
}
