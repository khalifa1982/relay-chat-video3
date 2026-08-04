/**
 * ALBUMS (v2.107.32) — the counting rules, in ONE place used by BOTH sides.
 *
 * The owner's spec is numeric — "up to 100 photos and 100 videos" per album —
 * and a numeric rule enforced in two codebases is a rule waiting to disagree,
 * so the picker (client) and `messages.send` (server) import THESE constants
 * and THIS classifier rather than each keeping a copy of "100".
 *
 * An album is otherwise deliberately narrow: images and videos only. Audio has
 * its own player+transcript bubble and files their own card — mixing them into
 * a paging grid would bury them.
 */

export const ALBUM_MAX_IMAGES = 100;
export const ALBUM_MAX_VIDEOS = 100;
/** Two items is the smallest album — one item IS the existing single-attachment
 *  message, and the client sends it that way. */
export const ALBUM_MIN_ITEMS = 2;

export type AlbumCount = {
  ok: boolean;
  images: number;
  videos: number;
  /** Machine-readable refusal, for the toast/dict layer to word. */
  reason: null | "empty" | "kind" | "images" | "videos";
};

/** Classify a candidate selection by mime. FIRST failure wins, and "kind"
 *  outranks the count reasons: a selection containing a PDF is wrong before it
 *  is long. */
export function albumCounts(mimes: string[]): AlbumCount {
  let images = 0;
  let videos = 0;
  for (const m of mimes) {
    const mime = (m || "").toLowerCase();
    if (mime.startsWith("image/")) images += 1;
    else if (mime.startsWith("video/")) videos += 1;
    else return { ok: false, images, videos, reason: "kind" };
  }
  if (images + videos === 0) return { ok: false, images, videos, reason: "empty" };
  if (images > ALBUM_MAX_IMAGES) return { ok: false, images, videos, reason: "images" };
  if (videos > ALBUM_MAX_VIDEOS) return { ok: false, images, videos, reason: "videos" };
  return { ok: true, images, videos, reason: null };
}

/** The message `kind` an album rides under. Deliberately an EXISTING kind —
 *  the cover attachment plus kind image/video is exactly what a not-yet-updated
 *  client renders during the deploy window, so an album degrades to its cover
 *  instead of an unknown-kind blank. Video wins when the FIRST item is video,
 *  because the first item is the cover. */
export function albumKindFor(firstMime: string): "image" | "video" {
  return (firstMime || "").toLowerCase().startsWith("video/") ? "video" : "image";
}
