import { useEffect, useRef, useState } from "react";
import { X, SwitchCamera, Check, RotateCcw, Images, Send } from "lucide-react";
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
 *
 * ── BOARD 4j (Video message) ────────────────────────────────────────────────
 * The frame's own values, lifted from `Relay App Redesign.dc.html#4j`:
 *   REC chip   gap 6 / padding 6px 13px / radius 18 / fill rgba(251,85,96,.15) /
 *              border rgba(251,85,96,.45) / 7px dot #fb5560 / label mono 11px 600
 *              #ffd6db reading "REC 0:07 / 1:00"
 *   hairline   3px tall, radius 2, track rgba(255,255,255,.12), fill #fb5560,
 *              16px side margins
 *   controls   one row, gap 54: 44px gallery tile (radius 14, 1.5px
 *              rgba(255,255,255,.3)) · 78px shutter (3.5px #fff ring, inner
 *              inset 9px, radius 12 while recording) · 52px accent send circle
 *   after stop Retake pill (radius 18, rgba(0,0,0,.4) + rgba(255,255,255,.3)
 *              border, 11px 600 #fff) and a SOLID-accent "Use video" pill
 *              (11px 700, on-accent #04211a)
 *
 * RED MEANS RECORDING here and that is deliberate: it is a convention older than
 * this app and it collides with nothing on this surface (there is no destructive
 * hairline to confuse it with). It is emphatically NOT `--relay-online` — that
 * token means ONLINE and has to carry exactly one meaning, which is why v2.99.86
 * moved DND off it, v2.106.9 the speaking tile, v2.106.11 the push banner and
 * v2.106.18 the voice waveform. The "Use video" button used to be painted with
 * it; it is the cycling accent now, like every other primary CTA in the app.
 */
const REC_RED = "#fb5560";

export function VideoRecordSheet({
  maxMs = 60_000,
  onClose,
  onUse,
  onPickLibrary,
}: {
  maxMs?: number;
  onClose: () => void;
  onUse: (r: { blob: Blob; mimeType: string; ext: string; durationMs: number }) => void;
  /** Board 4j's gallery thumb. OPTIONAL, and absent rather than disabled when a
   *  caller does not pass it (a control that can only refuse should not be on
   *  screen at all): picking existing media is the CALLER's flow — Messages and
   *  Status each already own a library path — so the sheet offers the shortcut
   *  only to a caller that has one to offer. */
  onPickLibrary?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recRef = useRef<VideoRecording | null>(null);
  /** Set only by the send circle: this take skips review and goes straight out. */
  const sendOnStopRef = useRef(false);
  const [facing, setFacing] = useState<"user" | "environment">("user");
  const [phase, setPhase] = useState<"live" | "rec" | "review">("live");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [result, setResult] = useState<{ blob: Blob; mimeType: string; ext: string; durationMs: number } | null>(null);
  const [reviewUrl, setReviewUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // Probed ONCE: isTypeSupported is cheap but this renders 5x/sec while recording.
  const [canRecord] = useState(() => videoRecorderSupported());

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
      sendOnStopRef.current = false;
      setElapsedMs(0);
      setPhase("rec");
      void rec.done.then((r) => {
        recRef.current = null;
        const straightOut = sendOnStopRef.current;
        sendOnStopRef.current = false;
        if (!r) {
          setPhase("live");
          return;
        }
        if (straightOut) {
          // Board 4j draws the send circle beside the recording shutter, so
          // stopping via send skips review entirely. No object URL is minted on
          // this path, so there is nothing to revoke; the preview stream is
          // still live (recordFromStream never stops its tracks) and the unmount
          // cleanup releases it once the caller closes the sheet.
          setPhase("live");
          onUse(r);
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

  function stopAndSend() {
    sendOnStopRef.current = true;
    recRef.current?.stop();
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
  // Board 4j's progress hairline. Driven by TRANSFORM rather than `width`: a
  // width write repaints, and this updates five times a second (v2.99.84).
  const progress = maxMs > 0 ? Math.min(1, elapsedMs / maxMs) : 0;
  const notice = err ?? (canRecord ? null : "Recording isn't supported by this browser.");
  // A shutter that can only refuse is absent, not disabled.
  const shutterLive = !notice;

  return (
    /* `dark relay-v2` is carried HERE as well as on <html>: the design utilities
       this sheet uses are scoped `.relay-v2 X` / `.dark.relay-v2 X`, and while
       AppShell puts `relay-v2` on the root it only adds `dark` in the dark theme
       — this surface is a black camera view in either theme, so it declares its
       own. Same pattern as AuthPanel / PasscodeGate. */
    <div
      className="dark relay-v2 fixed inset-0 z-[130] flex flex-col bg-black"
      role="dialog"
      aria-modal="true"
      aria-label="Record a video"
    >
      {/* top bar — board 4j: close · REC chip · flip, padding 10px 16px */}
      <div
        className="flex items-center justify-between gap-2 px-4 pb-2.5"
        style={{ paddingTop: "max(10px, env(safe-area-inset-top))" }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close recorder"
          className="grid size-11 shrink-0 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20"
        >
          {/* the frame's 19px stroke-2 cross */}
          <X className="size-[19px]" strokeWidth={2} />
        </button>
        {phase === "rec" && (
          <span
            className="inline-flex min-w-0 items-center gap-1.5 rounded-[18px] px-[13px] py-1.5"
            style={{
              background: "rgba(251, 85, 96, 0.15)",
              border: "1px solid rgba(251, 85, 96, 0.45)",
            }}
          >
            <span
              className="size-[7px] shrink-0 rounded-full motion-safe:animate-pulse"
              style={{ background: REC_RED }}
            />
            <span className="whitespace-nowrap font-mono text-[11px] font-semibold" style={{ color: "#ffd6db" }}>
              REC {clock(elapsedMs)} / {clock(maxMs)}
            </span>
          </span>
        )}
        {phase !== "review" ? (
          <button
            type="button"
            onClick={() => setFacing((f) => (f === "user" ? "environment" : "user"))}
            disabled={phase === "rec"}
            aria-label="Flip camera"
            className="grid size-11 shrink-0 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20 disabled:opacity-40"
          >
            {/* the frame draws a generic rotate arrow here; SwitchCamera is the
                same control with a glyph that says which control it is. */}
            <SwitchCamera className="size-[18px]" strokeWidth={1.9} />
          </button>
        ) : (
          <span className="size-11 shrink-0" />
        )}
      </div>

      {/* progress hairline (board 4j) — only while a take is running, because
          before one starts there is no progress to report. */}
      {phase === "rec" && (
        <div
          className="mx-4 mt-1.5 h-[3px] overflow-hidden rounded-[2px] bg-white/12"
          role="presentation"
        >
          <span
            className="block h-full origin-left rounded-[2px]"
            style={{ background: REC_RED, transform: `scaleX(${progress})` }}
          />
        </div>
      )}

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
        {notice && (
          <div className="absolute inset-0 grid place-items-center p-6">
            <div className="max-w-xs text-center text-sm text-white/85">{notice}</div>
          </div>
        )}
        {/* The hairline answers "how much is left" at a glance; this answers it in
            words, which is what a screen reader and a glance-away user get. Kept
            deliberately though the frame omits it, in the board's mono voice. */}
        {phase === "rec" && capLeft <= 10_000 && (
          <div className="absolute bottom-3 left-0 right-0 text-center font-mono text-[10px] uppercase tracking-[0.18em] text-white/60">
            Auto-stops in {Math.ceil(capLeft / 1000)}s
          </div>
        )}
      </div>

      {/* controls */}
      {phase === "review" ? (
        /* board 4j "after stop": two pills, gap 8. Both are raised to a 44px
           minimum height — the frame's 8px/16px padding computes to a 27px
           control, and a hit target under 44px is the one thing a frame does not
           get to overrule. Radius and type are the frame's. */
        <div
          className="flex items-center justify-center gap-2 px-4 pt-4"
          style={{ paddingBottom: "max(20px, env(safe-area-inset-bottom))" }}
        >
          <button
            type="button"
            onClick={retake}
            className="inline-flex min-h-11 items-center gap-2 rounded-[18px] px-4 text-[11px] font-semibold text-white transition-transform active:scale-95"
            style={{ background: "rgba(0, 0, 0, 0.4)", border: "1px solid rgba(255, 255, 255, 0.3)" }}
          >
            <RotateCcw className="size-4" /> Retake
          </button>
          <button
            type="button"
            onClick={() => result && onUse(result)}
            /* `.rcta` is the app's one primary-CTA recipe: solid `var(--rb)` with
               the board's on-accent `#04211a` text. Using the utility rather than
               an inline colour is what makes this button cycle with every other
               accent surface — and what keeps the presence green out of it. */
            className="rcta inline-flex min-h-11 items-center gap-2 rounded-[18px] px-5 text-[11px] font-bold transition-transform active:scale-95"
          >
            <Check className="size-4" /> Use video
          </button>
        </div>
      ) : (
        /* board 4j's control row: 44px gallery tile · 78px shutter · 52px send,
           gap 54. Both side slots are ALWAYS laid out (empty when their control
           does not apply) so the shutter stays dead-centre instead of sliding as
           states change. The gap falls back below ~392px so the row still fits a
           320px phone: 44 + 78 + 52 + two gaps + 32px of padding. */
        <div
          className="flex items-center justify-center gap-[min(54px,13.8vw)] px-4 pt-4"
          style={{ paddingBottom: "max(20px, env(safe-area-inset-bottom))" }}
        >
          <div className="grid size-11 shrink-0 place-items-center">
            {phase === "live" && onPickLibrary && (
              <button
                type="button"
                onClick={onPickLibrary}
                aria-label="Choose a video from your library"
                className="grid size-11 place-items-center rounded-[14px] transition-transform active:scale-95"
                style={{
                  background: "linear-gradient(135deg, hsl(30 40% 30%), hsl(200 40% 25%))",
                  border: "1.5px solid rgba(255, 255, 255, 0.3)",
                }}
              >
                <Images className="size-[18px] text-white/85" />
              </button>
            )}
          </div>

          {shutterLive ? (
            <button
              type="button"
              onClick={phase === "rec" ? () => recRef.current?.stop() : startTake}
              aria-label={phase === "rec" ? "Stop recording" : "Start recording"}
              className="relative size-[78px] shrink-0 transition-transform active:scale-95"
            >
              <span className="absolute inset-0 rounded-full" style={{ border: "3.5px solid #fff" }} />
              {/* recording ⇒ the frame's rounded SQUARE (a stop marker); idle ⇒ a
                  disc, which is what a shutter reads as before it is pressed. */}
              <span
                className={
                  phase === "rec"
                    ? "absolute inset-[9px] rounded-[12px] motion-safe:animate-pulse"
                    : "absolute inset-[9px] rounded-full"
                }
                style={{ background: REC_RED }}
              />
            </button>
          ) : (
            <span className="size-[78px] shrink-0" />
          )}

          <div className="grid size-[52px] shrink-0 place-items-center">
            {phase === "rec" && (
              <button
                type="button"
                onClick={stopAndSend}
                aria-label="Stop and send"
                className="rcta grid size-[52px] place-items-center rounded-full transition-transform active:scale-95"
              >
                <Send className="size-[19px]" strokeWidth={2} />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
