/* ============================================================
   In-app VIDEO recording (v2.96.2) — RELAY's own camera.

   Why this exists: iOS blocks the SYSTEM camera's video recorder while ANY
   call is active ("Recording video is not available while on a call" — a
   hard OS restriction that hits the <input capture> path too). WhatsApp
   solves it by recording inside the app, so RELAY does the same:
   getUserMedia + MediaRecorder with a live preview, and the finished blob
   rides the normal photo/video upload path (Messages) or the bare status
   upload (Status).

   Mirrors voiceNote.ts: probe the container Safari actually supports
   (video/mp4 there; webm elsewhere), always release the camera when the
   capture ends, and keep bitrates modest so a full-length clip stays well
   under the 40 MB upload cap (~2.5 Mbps video ⇒ ≈20 MB/min).
   ============================================================ */

export interface VideoMimePick {
  mimeType: string;
  ext: string;
}

/** Probe MediaRecorder for a supported VIDEO container. Null ⇒ no recorder.
 *  Unlike audio there is no "" last-ditch entry: a browser with MediaRecorder
 *  but no video encoder (rare) must report unsupported, not produce garbage. */
export function pickVideoMime(): VideoMimePick | null {
  if (typeof window === "undefined" || !window.MediaRecorder) return null;
  const candidates: VideoMimePick[] = [
    { mimeType: "video/mp4", ext: "mp4" }, // Safari (H.264/AAC)
    { mimeType: 'video/webm;codecs="vp9,opus"', ext: "webm" },
    { mimeType: 'video/webm;codecs="vp8,opus"', ext: "webm" },
    { mimeType: "video/webm", ext: "webm" },
  ];
  for (const c of candidates) {
    try {
      if (window.MediaRecorder.isTypeSupported(c.mimeType)) return c;
    } catch {
      /* ignore */
    }
  }
  return null;
}

/** True when this browser can record video in-app at all. */
export function videoRecorderSupported(): boolean {
  return pickVideoMime() != null;
}

/**
 * Open the camera + mic for the live capture preview. The caller OWNS the
 * returned stream (binds it to a <video>, later stops its tracks).
 * Throws when getUserMedia is denied/unavailable — on iOS mid-video-call the
 * camera is held by the call, which surfaces here as NotReadableError.
 */
export async function openVideoCapture(
  facing: "user" | "environment" = "user",
): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: true,
    video: {
      facingMode: facing,
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 30 },
    },
  });
}

export interface VideoRecording {
  /** Stop recording; resolves the same promise `done` exposes. */
  stop: () => void;
  /** Abort: stop and discard — `done` resolves null. */
  cancel: () => void;
  /** Resolves with the finished clip (or null when cancelled/empty). */
  done: Promise<{ blob: Blob; mimeType: string; ext: string; durationMs: number } | null>;
}

/**
 * Record from an ALREADY-OPEN capture stream (so the preview can run before
 * and after a take). Deliberately does NOT stop the stream's tracks — the
 * preview keeps running for a retake; the sheet owns the release.
 */
export function recordFromStream(
  stream: MediaStream,
  opts?: { maxMs?: number },
): VideoRecording {
  const pick = pickVideoMime();
  if (!pick) throw new Error("Video recording isn't supported by this browser.");
  let rec: MediaRecorder;
  try {
    rec = new MediaRecorder(stream, {
      mimeType: pick.mimeType,
      videoBitsPerSecond: 2_500_000,
      audioBitsPerSecond: 128_000,
    });
  } catch {
    // Some browsers reject bitrate hints — the container alone still works.
    rec = new MediaRecorder(stream, { mimeType: pick.mimeType });
  }
  const chunks: Blob[] = [];
  const startedAt = Date.now();
  let cancelled = false;
  let capT: ReturnType<typeof setTimeout> | null = null;

  const done = new Promise<{ blob: Blob; mimeType: string; ext: string; durationMs: number } | null>(
    (resolve) => {
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      rec.onstop = () => {
        if (capT) clearTimeout(capT);
        if (cancelled || chunks.length === 0) {
          resolve(null);
          return;
        }
        const finalMime = rec.mimeType || pick.mimeType || "video/mp4";
        resolve({
          blob: new Blob(chunks, { type: finalMime }),
          mimeType: finalMime,
          ext: pick.ext,
          durationMs: Date.now() - startedAt,
        });
      };
    },
  );

  // 1s timeslice: Safari flushes chunks progressively (bounded memory, and a
  // mid-recording crash still leaves data instead of one empty buffer).
  rec.start(1000);
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
