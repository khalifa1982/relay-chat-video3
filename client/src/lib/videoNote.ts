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

/**
 * Spellings that ask for H.264-in-MP4 EXPLICITLY — the one pairing every current
 * engine can decode, and therefore the only container that makes a clip recorded on
 * Android playable on an iPhone.
 *
 * THE AUDIO SIBLING LEARNED THIS AND THIS FILE DID NOT (v2.106.89 fixed
 * `pickAudioMime` after the owner reported the voice bar broken on iPhone; the same
 * reasoning was never carried across). Bare `video/mp4` is answered TRUE by
 * Chromium, which then reveals VP8/VP9 under that label — the mislabel check below
 * catches that and switches to WebM, which is honest and still undecodable on every
 * iPhone, because iOS Safari has no WebM demuxer at all. Asking for the codec by
 * name first means the engines that really can produce H.264 do, and the fallback is
 * reached only by the ones that genuinely cannot.
 *
 * Bare `video/mp4` stays in the list BELOW these, because that is exactly what
 * Safari answers to and Safari's is genuinely H.264/AAC.
 */
const H264_MP4 = [
  'video/mp4;codecs="avc1.42E01E,mp4a.40.2"', // Baseline 3.0 + AAC-LC — the safe pair
  'video/mp4;codecs="avc1,mp4a"',
  "video/mp4;codecs=avc1",
];

/** Probe MediaRecorder for a supported VIDEO container. Null ⇒ no recorder.
 *  Unlike audio there is no "" last-ditch entry: a browser with MediaRecorder
 *  but no video encoder (rare) must report unsupported, not produce garbage. */
export function pickVideoMime(): VideoMimePick | null {
  if (typeof window === "undefined" || !window.MediaRecorder) return null;
  const candidates: VideoMimePick[] = [
    ...H264_MP4.map((mimeType) => ({ mimeType, ext: "mp4" })),
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

/** How long a stopped recorder gets to flush its final blob. Same reasoning, and
 *  the same value, as `voiceNote.ts`: far longer than a flush, far shorter than a
 *  wait anybody notices. */
const FLUSH_GRACE_MS = 5_000;

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

  /* `done` MUST ALWAYS SETTLE, AND HERE IT COULD NOT — the defect `voiceNote.ts`
   * fixed and this sibling never did.
   *
   * It resolved only from the recorder's `stop` event. There was no `error`
   * listener, `safeStop()` on an ALREADY-INACTIVE recorder fires nothing at all, and
   * the duration cap called `rec.stop()` and then trusted that same event. So a
   * recorder that went inactive on its own — an iOS call or Siri interruption, the
   * camera claimed by another app, a MediaRecorder `error` — left this pending
   * forever.
   *
   * WHAT THAT COSTS: `VideoRecordSheet` leaves `phase === "rec"` only inside
   * `rec.done.then(...)`, and both of that phase's exits (Stop and Send) call
   * `recRef.current?.stop()`, a no-op on an inactive recorder. Both ways out are
   * dead and the sheet is stuck on the recording UI — the same complete lock-out the
   * owner reported for the voice composer, on the video sheet.
   *
   * So the resolver is hoisted and made IDEMPOTENT, with four paths to it: a normal
   * stop, a recorder error, an already-inactive recorder, and a hard deadline. */
  let settle: (v: { blob: Blob; mimeType: string; ext: string; durationMs: number } | null) => void =
    () => {};
  let settled = false;
  let deadlineT: ReturnType<typeof setTimeout> | null = null;
  const armDeadline = (ms: number) => {
    if (deadlineT) clearTimeout(deadlineT);
    deadlineT = setTimeout(() => finish(), ms);
  };
  const finish = () => {
    if (settled) return;
    settled = true;
    if (capT) clearTimeout(capT);
    if (deadlineT) clearTimeout(deadlineT);
    if (cancelled || chunks.length === 0) {
      settle(null);
      return;
    }
    const finalMime = rec.mimeType || mimeType;
    settle({
      blob: new Blob(chunks, { type: finalMime }),
      mimeType: finalMime,
      ext,
      durationMs: Date.now() - startedAt,
    });
  };

  const done = new Promise<{ blob: Blob; mimeType: string; ext: string; durationMs: number } | null>(
    (resolve) => {
      settle = resolve;
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
          r.removeEventListener("error", finish); // …and the old recorder's error is not ours
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
            rec.addEventListener("error", finish);
            rec.start(1000);
          } catch {
            /* keep the mp4-labeled recorder — imperfect labeling beats no recording */
          }
        };
        r.addEventListener("dataavailable", check);
      };

      rec.addEventListener("dataavailable", onData);
      rec.addEventListener("stop", finish);
      /* A recorder ERROR settles with whatever was captured rather than discarding
         it: the chunks already collected are real footage, and losing a take
         somebody just made is worse than sending a slightly short one. With nothing
         captured, `finish` resolves null on its own. */
      rec.addEventListener("error", finish);
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
          /* Arm a SHORT deadline rather than settling here. `stop()` queues the
             final `dataavailable`, so resolving in this tick would drop the last
             second of the take — and with a recorder that flushed nothing, it is
             this that stops the cap being its own way to hang. */
          armDeadline(FLUSH_GRACE_MS);
        }, opts.maxMs);
      }
      /* THE BACKSTOP. Every other path depends on the recorder behaving; this one
         does not. Generous, because its job is to make "pending forever" impossible
         rather than to enforce a limit: a take cut short by it is bad, a sheet
         nobody can leave is worse. */
      armDeadline((opts?.maxMs && opts.maxMs > 0 ? opts.maxMs : 5 * 60_000) + 30_000);
    },
  );

  const safeStop = () => {
    try {
      if (rec.state !== "inactive") {
        rec.stop(); // the `stop` event → finish()
        return;
      }
    } catch {
      /* fall through and settle directly */
    }
    /* ALREADY INACTIVE, so `stop()` fires nothing. This is the case that wedged the
       sheet: its Stop and Send buttons both route here, both were no-ops, and
       neither did anything ever again. Settling directly is what makes them work. */
    finish();
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
