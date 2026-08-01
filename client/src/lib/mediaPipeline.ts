/* ============================================================
   RELAY media pipeline — local camera processing for live filters.

   Takes a raw getUserMedia stream and renders each frame onto a
   hidden <canvas>, applying:
     - CSS-style color filters (B&W, sepia, vivid, cool, warm)
     - background blur via MediaPipe Selfie Segmentation
     - sticker overlays anchored to face landmarks via MediaPipe
       Face Detector (sunglasses, dog ears, hearts, etc.)

   The processed stream is exposed via `getOutputStream()`. Callers
   should plug that into `RTCRtpSender.replaceTrack` so peers see
   the filtered output.

   Heavy ML resources (MediaPipe WASM + models) are lazy-loaded the
   first time a non-trivial filter is selected, so users who don't
   care about filters don't pay the bundle cost.
   ============================================================ */

/* eslint-disable @typescript-eslint/no-explicit-any */

export type FilterId =
  | "none"
  | "bw"
  | "sepia"
  | "vivid"
  | "cool"
  | "warm"
  | "blur-bg"
  | "sunglasses"
  | "dog"
  | "hearts";

export interface FilterDef {
  id: FilterId;
  label: string;
  emoji: string;
  // CSS-style color filter applied via canvas ctx.filter
  cssFilter?: string;
  // Background segmentation applied (blur background, keep person sharp)
  backgroundBlur?: boolean;
  // Face overlay sticker drawn anchored to detected face
  faceOverlay?: "sunglasses" | "dog" | "hearts";
}

export const FILTERS: FilterDef[] = [
  { id: "none", label: "Original", emoji: "·" },
  { id: "blur-bg", label: "Blur BG", emoji: "✨", backgroundBlur: true },
  { id: "vivid", label: "Vivid", emoji: "🌈", cssFilter: "saturate(1.6) contrast(1.1)" },
  { id: "warm", label: "Warm", emoji: "🌅", cssFilter: "sepia(0.25) saturate(1.3) hue-rotate(-10deg)" },
  { id: "cool", label: "Cool", emoji: "❄️", cssFilter: "saturate(1.1) hue-rotate(15deg) brightness(1.05)" },
  { id: "bw", label: "B&W", emoji: "◐", cssFilter: "grayscale(1) contrast(1.2)" },
  { id: "sepia", label: "Sepia", emoji: "📜", cssFilter: "sepia(0.85) contrast(1.05)" },
  { id: "sunglasses", label: "Shades", emoji: "🕶️", faceOverlay: "sunglasses" },
  { id: "dog", label: "Doggo", emoji: "🐶", faceOverlay: "dog" },
  { id: "hearts", label: "Hearts", emoji: "💕", faceOverlay: "hearts" },
];

export const findFilter = (id: FilterId): FilterDef =>
  FILTERS.find(f => f.id === id) || FILTERS[0];

interface SegmenterLike {
  segmentForVideo: (video: HTMLVideoElement, ts: number) => any;
  close?: () => void;
}
interface FaceDetectorLike {
  detectForVideo: (video: HTMLVideoElement, ts: number) => any;
  close?: () => void;
}

export interface PipelineCallbacks {
  onError?: (msg: string) => void;
  onLoading?: (loading: boolean) => void;
}

const WASM_BASE =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
const SEG_MODEL =
  "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite";
const FACE_MODEL =
  "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/latest/blaze_face_short_range.tflite";

export class MediaPipeline {
  private input: MediaStream | null = null;
  private inputVideo: HTMLVideoElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private outputStream: MediaStream | null = null;
  private rafId: number | null = null;
  private filter: FilterDef = FILTERS[0];
  private mirror = false;
  private facingMode: "user" | "environment" = "user";
  private cb: PipelineCallbacks;

  // ML resources (lazy)
  private segmenter: SegmenterLike | null = null;
  private faceDetector: FaceDetectorLike | null = null;
  private mlBootInProgress = false;

  // Frame-rate throttle. requestAnimationFrame fires at the display refresh
  // rate — 90-120Hz on modern phones — but 30fps is plenty for video and a
  // quarter of the canvas+encode work on a 120Hz panel. Tracked here and
  // enforced at the top of loop().
  // 24fps is plenty for a filtered self-view and ~20% less canvas/encode work
  // than 30. The heavy ML inference is throttled further below.
  private static readonly TARGET_FPS = 24;
  // Cap the PROCESSING resolution (height) when a filter is active. Filtering a
  // full 720p/1080p frame per tick is the main source of device heat/slowdown;
  // 480p output looks fine for a filtered tile and quarters the pixel work of
  // 1080p. (Plain, unfiltered calls don't use this pipeline at all.)
  private static readonly MAX_PROC_HEIGHT = 480;
  // Run the EXPENSIVE MediaPipe inference less often than we draw — the mask /
  // face box barely change frame-to-frame, so we reuse the last result and only
  // re-infer every Nth processed frame. Drawing (foreground = current frame)
  // still happens every tick, so motion stays smooth.
  private static readonly SEG_EVERY = 2;   // segmentation ~12fps
  private static readonly FACE_EVERY = 3;  // face detect ~8fps
  private frameCount = 0;
  private lastFrameTs = 0;

  // last-frame caches
  private lastSegMask: ImageData | null = null;
  private lastFaceBox: { x: number; y: number; w: number; h: number } | null = null;
  // Reused scratch canvas for the background-blur composite (was allocated
  // every frame — 30 canvases/sec of GC churn).
  private tmpCanvas: HTMLCanvasElement | null = null;

  constructor(cb: PipelineCallbacks = {}) {
    this.cb = cb;
    this.inputVideo = document.createElement("video");
    this.inputVideo.autoplay = true;
    this.inputVideo.playsInline = true;
    this.inputVideo.muted = true;
    this.canvas = document.createElement("canvas");
    this.canvas.width = 640;
    this.canvas.height = 480;
    // NOTE: we deliberately do NOT pass { willReadFrequently: true }. That hint
    // forces the canvas onto a CPU (software) backing store, which made every
    // frame's drawImage run on the CPU and was a major source of device heat.
    // We never getImageData() from this main canvas (the segmentation mask is
    // read from MediaPipe's own buffer, not the canvas), so GPU compositing is
    // safe and far cooler.
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("canvas 2d context unavailable");
    this.ctx = ctx;
  }

  /** Set or replace the camera stream. Only video is processed; audio passes
   *  through to the output stream untouched. */
  async setInputStream(stream: MediaStream) {
    this.input = stream;
    this.inputVideo.srcObject = stream;
    try { await this.inputVideo.play(); } catch { /* */ }
    // Size the canvas to the DOWNSCALED processing resolution (the same cap
    // loop() applies), NOT the full track resolution. Sizing to full-res here
    // meant captureStream was born oversized and then "popped" to the smaller
    // size on the first RAF tick — a visible resolution jump for the peer.
    const sizeCanvas = () => {
      const vh = this.inputVideo.videoHeight || 480;
      const vw = this.inputVideo.videoWidth || 640;
      const scale = Math.min(1, MediaPipeline.MAX_PROC_HEIGHT / vh);
      this.canvas.width = Math.max(2, Math.round(vw * scale));
      this.canvas.height = Math.max(2, Math.round(vh * scale));
    };
    const wait = () =>
      new Promise<void>(res => {
        if (this.inputVideo.videoWidth && this.inputVideo.videoHeight) { sizeCanvas(); res(); }
        else this.inputVideo.onloadedmetadata = () => { sizeCanvas(); res(); };
      });
    await wait();

    // Build the output stream once (first call only).
    if (!this.outputStream) {
      // Draw ONE real frame BEFORE reading captureStream, so peers never receive
      // a burst of black/empty frames at filter activation. loop() schedules the
      // RAF and, called with ts=0, also draws immediately — safe here because this
      // is the first-time branch (rafId is still null, so no double-loop).
      this.loop();
      if (!(this.canvas as { captureStream?: unknown }).captureStream) {
        // Old Safari/Edge lack canvas.captureStream → we'd otherwise ship a SILENT
        // empty MediaStream and the user's video would just freeze. Surface it so
        // the caller can fall back to the raw camera instead of failing blindly.
        this.cb.onError?.("Live video filters aren't supported on this browser.");
      }
      const out = (this.canvas as unknown as { captureStream?: (fps: number) => MediaStream }).captureStream
        ? (this.canvas as unknown as { captureStream: (fps: number) => MediaStream }).captureStream(MediaPipeline.TARGET_FPS)
        : new MediaStream();
      // Add audio tracks from the input.
      stream.getAudioTracks().forEach(t => out.addTrack(t));
      this.outputStream = out;
    } else {
      // Replace audio tracks if input changed (e.g. camera flip carries new audio).
      this.outputStream.getAudioTracks().forEach(t => this.outputStream!.removeTrack(t));
      stream.getAudioTracks().forEach(t => this.outputStream!.addTrack(t));
    }

    // Ensure the RAF loop is running. No-op if loop() above already started it
    // (first call) or if it's still running from a prior setInputStream (flip) —
    // this guard is what prevents a second, orphaned RAF loop on camera flip.
    if (this.rafId === null) this.loop();
  }

  /**
   * Stop the RAF loop WITHOUT tearing the pipeline down (#145).
   *
   * Turning the camera off stops the raw track, and this canvas reads that track — so
   * without pausing, the loop keeps painting a frozen last frame at 30fps for as long as
   * the camera is off, on the one screen where every cycle belongs to the video encoder
   * (the cost class v2.106.56 measured and removed for the background canvas).
   *
   * Deliberately NOT `destroy()`: the pipeline holds the user's chosen FILTER, and
   * rebuilding it would silently reset that to none on the way back. `setInputStream`
   * restarts the loop by itself (`if (this.rafId === null) this.loop()`), which is exactly
   * what `reacquireCameraForPublish` calls when the camera comes back — so resuming needs
   * no second mechanism and no call site has to remember one.
   */
  pause() {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
  }

  getOutputStream(): MediaStream | null { return this.outputStream; }
  getInputVideoElement(): HTMLVideoElement { return this.inputVideo; }
  getActiveFilter(): FilterDef { return this.filter; }
  getFacingMode(): "user" | "environment" { return this.facingMode; }
  getMirror(): boolean { return this.mirror; }

  setMirror(m: boolean) { this.mirror = m; }
  setFacingMode(m: "user" | "environment") { this.facingMode = m; }

  async setFilter(id: FilterId) {
    const def = findFilter(id);
    // Drop cached inference results when the filter changes, so a quick
    // blur→other→blur switch can't reuse a seconds-old mask/face box for a frame.
    if (def.id !== this.filter.id) { this.lastSegMask = null; this.lastFaceBox = null; }
    this.filter = def;
    if (def.backgroundBlur) await this.ensureSegmenter();
    if (def.faceOverlay) await this.ensureFaceDetector();
  }

  // Models are fetched over the network (lazy-loaded, per CLAUDE.md — never
  // preloaded). On a slow/flaky connection that fetch could hang indefinitely,
  // leaving the loading dot spinning forever with no way out. This is a SOFT
  // timeout: it un-stalls the UI (clears the loading flag, surfaces an error) at
  // 8s without aborting the underlying fetch — if it succeeds later anyway, the
  // model just becomes available silently. A real network failure already
  // rejects much faster via the existing catch block.
  private static readonly MODEL_LOAD_TIMEOUT_MS = 8000;

  private async ensureSegmenter() {
    if (this.segmenter || this.mlBootInProgress) return;
    this.mlBootInProgress = true;
    this.cb.onLoading?.(true);
    const timeoutT = setTimeout(() => {
      this.mlBootInProgress = false;
      this.cb.onLoading?.(false);
      this.cb.onError?.("Background blur model timed out loading. Try again or pick a different filter.");
    }, MediaPipeline.MODEL_LOAD_TIMEOUT_MS);
    try {
      const vision: any = await import("@mediapipe/tasks-vision");
      const fileset = await vision.FilesetResolver.forVisionTasks(WASM_BASE);
      this.segmenter = await vision.ImageSegmenter.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: SEG_MODEL, delegate: "GPU" },
        runningMode: "VIDEO",
        outputCategoryMask: true,
        outputConfidenceMasks: false,
      });
    } catch (e: any) {
      this.cb.onError?.("Couldn't load background blur model. " + (e?.message || e));
    } finally {
      clearTimeout(timeoutT);
      this.mlBootInProgress = false;
      this.cb.onLoading?.(false);
    }
  }

  private async ensureFaceDetector() {
    // Mirrors ensureSegmenter's single-flight guard — without it two rapid
    // filter taps could kick off overlapping createFromOptions() calls.
    if (this.faceDetector || this.mlBootInProgress) return;
    this.mlBootInProgress = true;
    this.cb.onLoading?.(true);
    const timeoutT = setTimeout(() => {
      this.mlBootInProgress = false;
      this.cb.onLoading?.(false);
      this.cb.onError?.("Face overlay model timed out loading. Try again or pick a different filter.");
    }, MediaPipeline.MODEL_LOAD_TIMEOUT_MS);
    try {
      const vision: any = await import("@mediapipe/tasks-vision");
      const fileset = await vision.FilesetResolver.forVisionTasks(WASM_BASE);
      this.faceDetector = await vision.FaceDetector.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: FACE_MODEL, delegate: "GPU" },
        runningMode: "VIDEO",
      });
    } catch (e: any) {
      this.cb.onError?.("Couldn't load face overlay model. " + (e?.message || e));
    } finally {
      clearTimeout(timeoutT);
      this.mlBootInProgress = false;
      this.cb.onLoading?.(false);
    }
  }

  private loop = (ts = 0) => {
    this.rafId = requestAnimationFrame(this.loop);
    // Throttle to ~TARGET_FPS regardless of the display's refresh rate.
    const minGap = 1000 / MediaPipeline.TARGET_FPS - 1;
    if (ts && ts - this.lastFrameTs < minGap) return;
    this.lastFrameTs = ts;
    this.frameCount++;
    const v = this.inputVideo;
    if (!v.videoWidth || !v.videoHeight) return;
    // Cap the processing canvas to MAX_PROC_HEIGHT (preserving aspect) so we
    // never filter a full-res frame — the big heat/slowdown win.
    const scale = Math.min(1, MediaPipeline.MAX_PROC_HEIGHT / v.videoHeight);
    const cw = Math.max(2, Math.round(v.videoWidth * scale));
    const ch = Math.max(2, Math.round(v.videoHeight * scale));
    if (this.canvas.width !== cw || this.canvas.height !== ch) {
      this.canvas.width = cw;
      this.canvas.height = ch;
    }
    const ctx = this.ctx;
    const w = this.canvas.width, h = this.canvas.height;

    // Mirror flip if enabled (for self-preview on front cam this looks natural,
    // but the OUTGOING video to peers should not be mirrored — they should see
    // us as the camera sees us). The processed stream is therefore NOT mirrored;
    // only the local <video> tile applies a CSS mirror via .relay-tile.you.
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    // Background blur (segmentation): draw blurred whole-frame, then composite
    // the foreground (person) on top using the segmentation mask as alpha.
    if (this.filter.backgroundBlur && this.segmenter) {
      try {
        // Draw the blurred background fill EVERY frame (current frame).
        ctx.filter = "blur(14px) saturate(1.05)";
        ctx.drawImage(v, 0, 0, w, h);
        ctx.filter = "none";
        // Re-segment only every SEG_EVERY frames; reuse the cached alpha mask in
        // between (the person barely moves between two frames). This halves the
        // most expensive per-frame work.
        if (this.frameCount % MediaPipeline.SEG_EVERY === 0 || !this.lastSegMask) {
          const tsNow = performance.now();
          const result: any = (this.segmenter as any).segmentForVideo(v, tsNow);
          const mask = result?.categoryMask;
          if (mask) {
            const maskW = mask.width, maskH = mask.height;
            const data: Uint8Array = mask.getAsUint8Array();
            if (!this.lastSegMask || this.lastSegMask.width !== maskW || this.lastSegMask.height !== maskH) {
              this.lastSegMask = ctx.createImageData(maskW, maskH);
            }
            const px = this.lastSegMask.data;
            for (let i = 0, j = 0; i < data.length; i++, j += 4) {
              // selfie segmenter: 0 = person, others = background → inverted alpha.
              const a = data[i] === 0 ? 255 : 0;
              px[j] = 0; px[j + 1] = 0; px[j + 2] = 0; px[j + 3] = a;
            }
            if (mask.close) mask.close();
          }
        }
        // Composite the CURRENT-frame foreground (person) using the cached mask,
        // so motion stays sharp even though the mask refreshes at half rate.
        if (this.lastSegMask) {
          const maskW = this.lastSegMask.width, maskH = this.lastSegMask.height;
          let tmp = this.tmpCanvas;
          if (!tmp) { tmp = document.createElement("canvas"); this.tmpCanvas = tmp; }
          if (tmp.width !== maskW) tmp.width = maskW;
          if (tmp.height !== maskH) tmp.height = maskH;
          const tctx = tmp.getContext("2d");
          if (tctx) {
            tctx.globalCompositeOperation = "source-over";
            tctx.putImageData(this.lastSegMask, 0, 0); // resets tmp to the mask
            tctx.globalCompositeOperation = "source-in";
            tctx.drawImage(v, 0, 0, maskW, maskH);
            ctx.drawImage(tmp, 0, 0, w, h);
          }
        }
      } catch {
        // Fall back to plain frame on segmentation failure.
        ctx.drawImage(v, 0, 0, w, h);
      }
    } else {
      // Apply CSS-style filter and draw the frame.
      ctx.filter = this.filter.cssFilter || "none";
      ctx.drawImage(v, 0, 0, w, h);
      ctx.filter = "none";
    }

    // Face overlay: detect bounding box, draw an emoji-based overlay anchored
    // to the face. We use emoji rather than image assets to keep zero-asset
    // dependencies and look fun without external files.
    if (this.filter.faceOverlay && this.faceDetector) {
      try {
        // Re-detect only every FACE_EVERY frames; the overlay is anchored to the
        // cached box in between (faces don't jump between frames).
        if (this.frameCount % MediaPipeline.FACE_EVERY === 0) {
          const tsNow = performance.now();
          const result: any = (this.faceDetector as any).detectForVideo(v, tsNow);
          const det = result?.detections?.[0]?.boundingBox;
          if (det) {
            this.lastFaceBox = {
              x: (det.originX ?? 0),
              y: (det.originY ?? 0),
              w: (det.width ?? 0),
              h: (det.height ?? 0),
            };
          }
        }
        const box = this.lastFaceBox;
        if (box) {
          // The detector ran on the full-res input video; scale its pixel box
          // into the (smaller) processing-canvas space before drawing.
          const sx = w / (v.videoWidth || w), sy = h / (v.videoHeight || h);
          this.drawFaceOverlay(
            ctx,
            { x: box.x * sx, y: box.y * sy, w: box.w * sx, h: box.h * sy },
            this.filter.faceOverlay,
            w,
            h,
          );
        }
      } catch { /* */ }
    } else {
      this.lastFaceBox = null;
    }

    ctx.restore();
  };

  private drawFaceOverlay(
    ctx: CanvasRenderingContext2D,
    box: { x: number; y: number; w: number; h: number },
    kind: "sunglasses" | "dog" | "hearts",
    canvasW: number,
    canvasH: number,
  ) {
    // BlazeFace returns coords in pixels relative to the original frame.
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    const fw = box.w;
    if (kind === "sunglasses") {
      ctx.font = `${Math.round(fw * 0.7)}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      // sunglasses sit ~25% down from forehead
      ctx.fillText("🕶️", cx, cy - fw * 0.05);
    } else if (kind === "dog") {
      // ears on top, nose/tongue in center
      const earSize = Math.round(fw * 0.55);
      ctx.font = `${earSize}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("🐶", cx, cy);
      // little ears above
      const easy = Math.round(fw * 0.35);
      ctx.font = `${easy}px sans-serif`;
      ctx.fillText("ᯓ", cx - fw * 0.35, cy - fw * 0.55);
      ctx.fillText("ᯓ", cx + fw * 0.35, cy - fw * 0.55);
    } else if (kind === "hearts") {
      // a few floating hearts around the head
      const t = (performance.now() / 1000) % 6;
      ctx.font = `${Math.round(fw * 0.18)}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const positions = [
        { dx: -0.6, dy: -0.7, off: 0 },
        { dx: 0.55, dy: -0.6, off: 1 },
        { dx: -0.5, dy: -0.95, off: 2 },
        { dx: 0.65, dy: -0.95, off: 3 },
        { dx: 0, dy: -1.05, off: 4 },
      ];
      positions.forEach(p => {
        const phase = (t + p.off * 0.3) % 1.5;
        const lift = Math.sin(phase * Math.PI / 1.5) * fw * 0.1;
        const a = 1 - Math.min(1, phase / 1.5);
        ctx.save();
        ctx.globalAlpha = a;
        ctx.fillText("💕", cx + p.dx * fw, cy + p.dy * fw - lift);
        ctx.restore();
      });
    }
    // Avoid unused-vars from fixed signature
    void canvasW; void canvasH;
  }

  /**
   * Stop the canvas loop and release ML models WITHOUT stopping the input
   * camera/mic — the caller still owns `localStream` and may keep publishing
   * its raw track. Only the canvas's own generated video track is stopped
   * (the output's audio tracks are shared with the input, so we leave them).
   * Use this when turning filters OFF mid-call; use destroy() to tear the
   * whole thing (including the camera) down at hang-up.
   */
  dispose() {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    try { this.segmenter?.close?.(); } catch { /* */ }
    try { this.faceDetector?.close?.(); } catch { /* */ }
    this.segmenter = null;
    this.faceDetector = null;
    if (this.outputStream) {
      this.outputStream.getVideoTracks().forEach(t => t.stop());
      this.outputStream = null;
    }
    this.input = null;
    try { this.inputVideo.srcObject = null; } catch { /* */ }
  }

  destroy() {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    try { this.segmenter?.close?.(); } catch { /* */ }
    try { this.faceDetector?.close?.(); } catch { /* */ }
    if (this.outputStream) {
      this.outputStream.getTracks().forEach(t => t.stop());
      this.outputStream = null;
    }
    if (this.input) {
      this.input.getTracks().forEach(t => t.stop());
      this.input = null;
    }
  }
}
