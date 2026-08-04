/**
 * VIDEO COVERS (v2.107.30) — capture a video's opening frame on the CLIENT, at
 * thumbnail size, at upload time.
 *
 * Why a stored image rather than `<video preload="metadata">` in the bubble:
 * that element paints its first frame on desktop Chrome and stays a BLACK BOX
 * on iOS Safari and most Android WebViews — which is exactly the owner-reported
 * shape ("show a cover, take the first screen"). It also costs a partial media
 * fetch per video per scroll. A real ≤512px image rides the SAME `thumbKey`
 * lane photos have used since v2.89 (the upload endpoint's thumb mode requires
 * the THUMB to be an image and says nothing about the main file's type, so no
 * server change), renders instantly, lazily, and everywhere.
 *
 * Capture time is 0.1s rather than 0: several encoders emit a pure-black or
 * half-decoded frame 0, and a tenth of a second is still "the first screen" to
 * a person. Clips at or under 0.2s are captured at 0 — seeking would land past
 * their midpoint.
 *
 * EVERYTHING HERE FAILS SOFT to `null`: a video whose frame cannot be captured
 * must still upload and send exactly as before — the cover is decoration on the
 * message, never a gate in front of it.
 */
import { THUMB_MAX_EDGE, WEBP_QUALITY, fitWithin } from "./imageDownscale";

export interface VideoPoster {
  blob: Blob;
  mime: string;
  /** FULL video pixel dimensions — stored on the attachment row so the bubble
   *  reserves its box before any bytes arrive (same rule as photos). */
  width: number;
  height: number;
  durationMs: number;
  thumbWidth: number;
  thumbHeight: number;
}

/** Where in the clip to grab the cover. Pure, so the rule is testable:
 *  0.1s for anything longer than 0.2s, the very start for shorter clips,
 *  and 0 for a duration the browser could not determine. */
export function posterSeekSeconds(durationSeconds: number): number {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return 0;
  return durationSeconds > 0.2 ? 0.1 : 0;
}

/** The cover's pixel size: the SAME bound photo thumbnails use, so a video
 *  cover and a photo thumb are indistinguishable to the renderer and the
 *  2 MB thumb cap alike. */
export function posterTargetDims(videoW: number, videoH: number): { width: number; height: number } {
  return fitWithin(videoW, videoH, THUMB_MAX_EDGE);
}

/** A capture that has not produced a frame by now never will (a stalled
 *  decoder, an unsupported codec) — give up and upload coverless. */
const CAPTURE_TIMEOUT_MS = 8000;

export async function captureVideoPoster(file: Blob): Promise<VideoPoster | null> {
  if (typeof document === "undefined") return null;
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  try {
    return await new Promise<VideoPoster | null>((resolve) => {
      let settled = false;
      const timer = setTimeout(() => finish(null), CAPTURE_TIMEOUT_MS);
      function finish(v: VideoPoster | null) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(v);
      }
      const draw = () => {
        try {
          const vw = video.videoWidth;
          const vh = video.videoHeight;
          if (!(vw > 0 && vh > 0)) return finish(null);
          const dims = posterTargetDims(vw, vh);
          const canvas = document.createElement("canvas");
          canvas.width = dims.width;
          canvas.height = dims.height;
          const ctx = canvas.getContext("2d");
          if (!ctx) return finish(null);
          ctx.drawImage(video, 0, 0, dims.width, dims.height);
          const durationMs = Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : 0;
          const emit = (blob: Blob | null, mime: string) =>
            finish(
              blob
                ? { blob, mime, width: vw, height: vh, durationMs, thumbWidth: dims.width, thumbHeight: dims.height }
                : null,
            );
          // webp first, jpeg fallback — the same encode ladder photo thumbs use.
          canvas.toBlob(
            (b) => {
              if (b && b.type === "image/webp") return emit(b, "image/webp");
              canvas.toBlob((j) => emit(j, "image/jpeg"), "image/jpeg", 0.85);
            },
            "image/webp",
            WEBP_QUALITY,
          );
        } catch {
          finish(null);
        }
      };
      video.addEventListener("error", () => finish(null), { once: true });
      video.addEventListener(
        "loadedmetadata",
        () => {
          const at = posterSeekSeconds(video.duration);
          if (at > 0) {
            video.addEventListener("seeked", draw, { once: true });
            try {
              video.currentTime = at;
            } catch {
              // A container that refuses the seek still decodes frame 0.
              video.addEventListener("loadeddata", draw, { once: true });
              if (video.readyState >= 2) draw();
            }
          } else {
            video.addEventListener("loadeddata", draw, { once: true });
            if (video.readyState >= 2) draw();
          }
        },
        { once: true },
      );
      video.src = url;
      video.load();
    });
  } finally {
    /* Release the DECODER, not just the URL — a detached <video> holding a src
       keeps a hardware decode session alive on mobile until GC gets around to
       it, and a burst of picked videos can exhaust the device's sessions. */
    try {
      video.removeAttribute("src");
      video.load();
    } catch {
      /* teardown is best-effort */
    }
    URL.revokeObjectURL(url);
  }
}
