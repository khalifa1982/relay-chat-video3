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

  // last-frame caches
  private lastSegMask: ImageData | null = null;
  private lastFaceBox: { x: number; y: number; w: number; h: number } | null = null;

  constructor(cb: PipelineCallbacks = {}) {
    this.cb = cb;
    this.inputVideo = document.createElement("video");
    this.inputVideo.autoplay = true;
    this.inputVideo.playsInline = true;
    this.inputVideo.muted = true;
    this.canvas = document.createElement("canvas");
    this.canvas.width = 640;
    this.canvas.height = 480;
    const ctx = this.canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("canvas 2d context unavailable");
    this.ctx = ctx;
  }

  /** Set or replace the camera stream. Only video is processed; audio passes
   *  through to the output stream untouched. */
  async setInputStream(stream: MediaStream) {
    this.input = stream;
    this.inputVideo.srcObject = stream;
    try { await this.inputVideo.play(); } catch { /* */ }
    // size canvas to actual track resolution once metadata arrives
    const wait = () =>
      new Promise<void>(res => {
        if (this.inputVideo.videoWidth && this.inputVideo.videoHeight) {
          this.canvas.width = this.inputVideo.videoWidth;
          this.canvas.height = this.inputVideo.videoHeight;
          res();
        } else {
          this.inputVideo.onloadedmetadata = () => {
            this.canvas.width = this.inputVideo.videoWidth || 640;
            this.canvas.height = this.inputVideo.videoHeight || 480;
            res();
          };
        }
      });
    await wait();

    // Build the output stream once.
    if (!this.outputStream) {
      const out = (this.canvas as any).captureStream
        ? (this.canvas as any).captureStream(30)
        : new MediaStream();
      // Add audio tracks from the input.
      stream.getAudioTracks().forEach(t => out.addTrack(t));
      this.outputStream = out;
    } else {
      // Replace audio tracks if input changed.
      this.outputStream.getAudioTracks().forEach(t => this.outputStream!.removeTrack(t));
      stream.getAudioTracks().forEach(t => this.outputStream!.addTrack(t));
    }

    if (this.rafId === null) this.loop();
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
    this.filter = def;
    if (def.backgroundBlur) await this.ensureSegmenter();
    if (def.faceOverlay) await this.ensureFaceDetector();
  }

  private async ensureSegmenter() {
    if (this.segmenter || this.mlBootInProgress) return;
    this.mlBootInProgress = true;
    this.cb.onLoading?.(true);
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
      this.mlBootInProgress = false;
      this.cb.onLoading?.(false);
    }
  }

  private async ensureFaceDetector() {
    if (this.faceDetector) return;
    this.cb.onLoading?.(true);
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
      this.cb.onLoading?.(false);
    }
  }

  private loop = () => {
    this.rafId = requestAnimationFrame(this.loop);
    const v = this.inputVideo;
    if (!v.videoWidth || !v.videoHeight) return;
    if (this.canvas.width !== v.videoWidth || this.canvas.height !== v.videoHeight) {
      this.canvas.width = v.videoWidth;
      this.canvas.height = v.videoHeight;
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
        const tsNow = performance.now();
        const result: any = (this.segmenter as any).segmentForVideo(v, tsNow);
        const mask = result?.categoryMask;
        // Draw blurred background fill.
        ctx.filter = "blur(14px) saturate(1.05)";
        ctx.drawImage(v, 0, 0, w, h);
        ctx.filter = "none";
        // Build mask ImageData on first use / refresh.
        if (mask) {
          const maskW = mask.width, maskH = mask.height;
          const data: Uint8Array = mask.getAsUint8Array();
          if (!this.lastSegMask || this.lastSegMask.width !== maskW || this.lastSegMask.height !== maskH) {
            this.lastSegMask = ctx.createImageData(maskW, maskH);
          }
          const px = this.lastSegMask.data;
          for (let i = 0, j = 0; i < data.length; i++, j += 4) {
            // selfie segmenter: 0 = person, others = background. Use inverted alpha
            const a = data[i] === 0 ? 255 : 0;
            px[j] = 0; px[j + 1] = 0; px[j + 2] = 0; px[j + 3] = a;
          }
          // Compose: draw mask, then in source-in mode draw the sharp video.
          const tmp = document.createElement("canvas");
          tmp.width = maskW; tmp.height = maskH;
          const tctx = tmp.getContext("2d");
          if (tctx) {
            tctx.putImageData(this.lastSegMask, 0, 0);
            tctx.globalCompositeOperation = "source-in";
            tctx.drawImage(v, 0, 0, maskW, maskH);
            ctx.drawImage(tmp, 0, 0, w, h);
          }
          if (mask.close) mask.close();
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
        } else if (!this.lastFaceBox) {
          // Nothing yet, skip drawing
        }
        const box = this.lastFaceBox;
        if (box) {
          this.drawFaceOverlay(ctx, box, this.filter.faceOverlay, w, h);
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
