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
function constructRecorder(stream: MediaStream, mimeType: string): MediaRecorder {
  try {
    return new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: 2_500_000,
      audioBitsPerSecond: 128_000,
    });
  } catch {
    // Some browsers reject bitrate hints — the container alone still works.
    return new MediaRecorder(stream, { mimeType });
  }
}

export function recordFromStream(
  stream: MediaStream,
  opts?: { maxMs?: number },
): VideoRecording {
  const pick = pickVideoMime();
  if (!pick) throw new Error("Video recording isn't supported by this browser.");
  let rec = constructRecorder(stream, pick.mimeType);
  let ext = pick.ext;
  let mimeType = pick.mimeType;
  const chunks: Blob[] = [];
  const startedAt = Date.now();
  let cancelled = false;
  let capT: ReturnType<typeof setTimeout> | null = null;

  const done = new Promise<{ blob: Blob; mimeType: string; ext: string; durationMs: number } | null>(
    (resolve) => {
      const finish = () => {
        if (capT) clearTimeout(capT);
        if (cancelled || chunks.length === 0) {
          resolve(null);
          return;
        }
        const finalMime = rec.mimeType || mimeType;
        resolve({
          blob: new Blob(chunks, { type: finalMime }),
          mimeType: finalMime,
          ext,
          durationMs: Date.now() - startedAt,
        });
      };
      const onData = (e: BlobEvent) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      // Cross-platform playback hazard (verified live, Chromium/Android): some
      // browsers report "video/mp4" as SUPPORTED via isTypeSupported() but
      // actually encode VP8/VP9(+Opus) under that label — a real .mp4 file
      // that isn't really H.264/AAC, which a strict decoder (e.g. Safari's
      // native player) can refuse to play for the RECIPIENT even though it
      // recorded and previews fine for the sender. MediaRecorder.mimeType
      // only reveals the true negotiated codec once encoding actually
      // starts, not at construction (confirmed empirically: it stays the
      // bare "video/mp4" for tens-to-hundreds of ms after start()). Forcing
      // an immediate requestData() flush reveals the truth within a couple
      // of milliseconds, so a mislabeled recorder — which has produced no
      // meaningful footage yet — can be swapped for an honest webm one
      // transparently, before the caller or user ever notices.
      const armMislabelCheck = (r: MediaRecorder) => {
        if (ext !== "mp4") return; // only the "video/mp4" label can lie
        const check = (_e: BlobEvent) => {
          r.removeEventListener("dataavailable", check);
          if (!/vp[89]|opus/i.test(r.mimeType || "")) return; // honest H.264 — nothing to do
          // A cancel() that lands in the same tick as construction already
          // called r.stop() while `r` was still the only recorder — its own
          // "stop" listener (never removed in this branch) will fire and
          // resolve `done` via `finish`. Swapping in a fresh recorder here
          // would start a live MediaRecorder nobody ever stops again (cancel
          // already ran, and it captured the OLD `rec` reference) — a leaked
          // recorder + a `done` that never resolves. Confirmed via a headless
          // race test before this guard existed.
          if (cancelled) return;
          r.removeEventListener("stop", finish); // this stop is just to swap, not a real end
          try {
            if (r.state !== "inactive") r.stop();
          } catch {
            /* ignore */
          }
          chunks.length = 0; // discard any sliver recorded under the wrong label
          try {
            const honest = constructRecorder(stream, "video/webm");
            rec = honest;
            ext = "webm";
            mimeType = "video/webm";
            rec.addEventListener("dataavailable", onData);
            rec.addEventListener("stop", finish);
            rec.start(1000);
          } catch {
            /* keep the mp4-labeled recorder — imperfect labeling beats no recording */
          }
        };
        r.addEventListener("dataavailable", check);
      };

      rec.addEventListener("dataavailable", onData);
      rec.addEventListener("stop", finish);
      armMislabelCheck(rec);

      // 1s timeslice: Safari flushes chunks progressively (bounded memory, and
      // a mid-recording crash still leaves data instead of one empty buffer).
      rec.start(1000);
      if (ext === "mp4") {
        try {
          rec.requestData(); // forces the mislabel check to resolve in ~ms, not 1s
        } catch {
          /* worst case the mislabel check simply never fires */
        }
      }
      if (opts?.maxMs && opts.maxMs > 0) {
        capT = setTimeout(() => {
          try {
            if (rec.state !== "inactive") rec.stop();
          } catch {
            /* already stopped */
          }
        }, opts.maxMs);
      }
    },
  );

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
