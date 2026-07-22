import { useEffect, useRef, useState } from "react";
import { X, SwitchCamera, Check, RotateCcw, Square } from "lucide-react";
import {
  openVideoCapture,
  recordFromStream,
  videoRecorderSupported,
  type VideoRecording,
} from "@/lib/videoNote";

/**
 * In-app video recorder (v2.96.2) — RELAY's own camera sheet.
 *
 * Exists because iOS refuses to let the SYSTEM camera record video while any
 * call is active ("Recording video is not available while on a call"), which
 * also breaks the <input capture> path. This sheet records in-page
 * (getUserMedia + MediaRecorder): live preview → record with a running timer
 * (auto-stops at `maxMs`) → review with Retake / Use. The camera is released
 * on every exit path.
 *
 * Used by the Messages composer (60s cap → the normal attachment flow, so
 * captions + the disappearing timer still apply) and the Status composer
 * (30s cap → the bare status upload).
 */
export function VideoRecordSheet({
  maxMs = 60_000,
  onClose,
  onUse,
}: {
  maxMs?: number;
  onClose: () => void;
  onUse: (r: { blob: Blob; mimeType: string; ext: string; durationMs: number }) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recRef = useRef<VideoRecording | null>(null);
  const [facing, setFacing] = useState<"user" | "environment">("user");
  const [phase, setPhase] = useState<"live" | "rec" | "review">("live");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [result, setResult] = useState<{ blob: Blob; mimeType: string; ext: string; durationMs: number } | null>(null);
  const [reviewUrl, setReviewUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const releaseStream = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  // Acquire (and re-acquire on flip) the live camera while not reviewing.
  useEffect(() => {
    if (phase === "review") return;
    let dead = false;
    setErr(null);
    releaseStream();
    openVideoCapture(facing)
      .then((s) => {
        if (dead) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = s;
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          void videoRef.current.play().catch(() => {});
        }
      })
      .catch(() => {
        if (!dead) {
          setErr(
            "Camera unavailable. If you're on a video call, turn the call's camera off first, then try again."
          );
        }
      });
    return () => {
      dead = true;
    };
    // release handled on unmount below + before each re-acquire above
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facing, phase === "review"]);

  // Full cleanup on unmount: abort any take, free the camera, drop the URL.
  useEffect(() => {
    return () => {
      recRef.current?.cancel();
      releaseStream();
    };
  }, []);
  useEffect(() => {
    return () => {
      if (reviewUrl) URL.revokeObjectURL(reviewUrl);
    };
  }, [reviewUrl]);

  // Running timer while recording.
  useEffect(() => {
    if (phase !== "rec") return;
    const t0 = Date.now();
    const t = setInterval(() => setElapsedMs(Date.now() - t0), 200);
    return () => clearInterval(t);
  }, [phase]);

  function startTake() {
    const s = streamRef.current;
    if (!s) return;
    try {
      const rec = recordFromStream(s, { maxMs });
      recRef.current = rec;
      setElapsedMs(0);
      setPhase("rec");
      void rec.done.then((r) => {
        recRef.current = null;
        if (!r) {
          setPhase("live");
          return;
        }
        setResult(r);
        setReviewUrl(URL.createObjectURL(r.blob));
        releaseStream(); // camera LED off while reviewing
        setPhase("review");
      });
    } catch {
      setErr("Recording isn't supported by this browser.");
    }
  }

  function retake() {
    if (reviewUrl) URL.revokeObjectURL(reviewUrl);
    setReviewUrl(null);
    setResult(null);
    setPhase("live"); // effect re-acquires the camera
  }

  const clock = (ms: number) => {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };
  const capLeft = Math.max(0, maxMs - elapsedMs);

  return (
    <div className="fixed inset-0 z-[130] flex flex-col bg-black" role="dialog" aria-modal="true" aria-label="Record a video">
      {/* top bar */}
      <div className="flex items-center justify-between px-4 pb-2" style={{ paddingTop: "max(12px, env(safe-area-inset-top))" }}>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close recorder"
          className="grid size-10 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20"
        >
          <X className="size-5" />
        </button>
        {phase === "rec" && (
          <span className="inline-flex items-center gap-2 rounded-full bg-black/60 px-3 py-1.5 font-mono text-sm text-white">
            <span className="size-2.5 animate-pulse rounded-full bg-red-500" />
            {clock(elapsedMs)}
            <span className="text-white/50">/ {clock(maxMs)}</span>
          </span>
        )}
        {phase !== "review" ? (
          <button
            type="button"
            onClick={() => setFacing((f) => (f === "user" ? "environment" : "user"))}
            disabled={phase === "rec"}
            aria-label="Flip camera"
            className="grid size-10 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20 disabled:opacity-40"
          >
            <SwitchCamera className="size-5" />
          </button>
        ) : (
          <span className="size-10" />
        )}
      </div>

      {/* stage */}
      <div className="relative min-h-0 flex-1">
        {phase === "review" && reviewUrl ? (
          <video src={reviewUrl} controls playsInline autoPlay className="absolute inset-0 size-full object-contain" />
        ) : (
          <video
            ref={videoRef}
            muted
            playsInline
            autoPlay
            className="absolute inset-0 size-full object-cover"
            // Mirror the FRONT-camera preview only (natural selfie feel); the
            // recorded clip itself is the raw, unmirrored track.
            style={facing === "user" ? { transform: "scaleX(-1)" } : undefined}
          />
        )}
        {err && (
          <div className="absolute inset-0 grid place-items-center p-6">
            <div className="max-w-xs text-center text-sm text-white/85">{err}</div>
          </div>
        )}
        {phase === "rec" && capLeft <= 10_000 && (
          <div className="absolute bottom-3 left-0 right-0 text-center text-xs font-medium text-white/70">
            Auto-stops in {Math.ceil(capLeft / 1000)}s
          </div>
        )}
      </div>

      {/* controls */}
      <div
        className="flex items-center justify-center gap-8 px-6 pt-4"
        style={{ paddingBottom: "max(20px, env(safe-area-inset-bottom))" }}
      >
        {phase === "review" ? (
          <>
            <button
              type="button"
              onClick={retake}
              className="inline-flex items-center gap-2 rounded-full bg-white/12 px-5 py-3 text-sm font-semibold text-white hover:bg-white/20 active:scale-95 transition-transform"
            >
              <RotateCcw className="size-4" /> Retake
            </button>
            <button
              type="button"
              onClick={() => result && onUse(result)}
              className="inline-flex items-center gap-2 rounded-full bg-[color:var(--relay-online,#06d6a0)] px-6 py-3 text-sm font-bold text-[#04201B] shadow-lg active:scale-95 transition-transform"
            >
              <Check className="size-4" /> Use video
            </button>
          </>
        ) : phase === "rec" ? (
          <button
            type="button"
            onClick={() => recRef.current?.stop()}
            aria-label="Stop recording"
            className="grid size-[74px] place-items-center rounded-full border-4 border-white/80 active:scale-95 transition-transform"
          >
            <span className="grid size-[54px] place-items-center rounded-full bg-red-500 text-white">
              <Square className="size-5 fill-current" />
            </span>
          </button>
        ) : (
          <button
            type="button"
            onClick={startTake}
            disabled={!!err || !videoRecorderSupported()}
            aria-label="Start recording"
            className="grid size-[74px] place-items-center rounded-full border-4 border-white/80 active:scale-95 transition-transform disabled:opacity-40"
          >
            <span className="size-[54px] rounded-full bg-red-500" />
          </button>
        )}
      </div>
    </div>
  );
}
