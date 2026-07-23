/**
 * Emoji / character avatars (v2.99.2).
 *
 * Instead of a separate "avatar kind" column, an emoji avatar is RENDERED to a
 * PNG (emoji centered on a gradient) and uploaded through the SAME profile-photo
 * path as a real photo. So every surface that already shows `avatarUrl` — thread
 * rows, contacts, history discs, in-call tiles, other users' directory previews
 * — renders it with zero extra wiring, and it syncs to other devices/users like
 * any photo. No schema change, no client-only state that could drift.
 */

/** Curated, friendly set — smileys, characters, animals, and fun icons. */
export const AVATAR_EMOJIS: string[] = [
  "😀", "😄", "😁", "😆", "😊", "🙂", "😉", "😍",
  "🥰", "😎", "🤩", "🥳", "😇", "🤗", "🤠", "🤓",
  "😜", "🤪", "😝", "🙃", "😺", "😻", "🦄", "🐶",
  "🐱", "🦊", "🐼", "🐨", "🦁", "🐯", "🐸", "🐵",
  "🐧", "🐤", "🦉", "🐙", "🦖", "🤖", "👽", "👾",
  "🎃", "🌟", "🔥", "🌈", "⚡", "🚀", "🍀", "🌸",
  "🎈", "🎨", "🎧", "🎸", "🍕", "👑", "💎", "❤️",
];

/** Gradient backgrounds (from → to). First is the brand teal. */
export const AVATAR_BGS: Array<{ id: string; from: string; to: string }> = [
  { id: "teal", from: "#3FE0C5", to: "#6EE7FF" },
  { id: "violet", from: "#8B5CF6", to: "#EC4899" },
  { id: "sunset", from: "#FB923C", to: "#F43F5E" },
  { id: "lime", from: "#84CC16", to: "#10B981" },
  { id: "ocean", from: "#0EA5E9", to: "#6366F1" },
  { id: "gold", from: "#F59E0B", to: "#EF4444" },
  { id: "rose", from: "#FB7185", to: "#BE123C" },
  { id: "mint", from: "#34D399", to: "#059669" },
  { id: "grape", from: "#A78BFA", to: "#7C3AED" },
  { id: "slate", from: "#475569", to: "#0F172A" },
];

/**
 * Render `emoji` centered on the `bg` gradient into a square PNG blob.
 * Rejects if the browser can't produce a blob (canvas unavailable / tainted).
 */
export function renderEmojiAvatar(
  emoji: string,
  bg: { from: string; to: string },
  size = 256,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Canvas 2D unavailable"));
        return;
      }
      const grad = ctx.createLinearGradient(0, 0, size, size);
      grad.addColorStop(0, bg.from);
      grad.addColorStop(1, bg.to);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, size, size);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      // Emoji render with the platform's color-emoji font; the family list is a
      // best-effort hint (the glyph is a single code point either way).
      ctx.font = `${Math.round(size * 0.6)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
      // Nudge down slightly — most emoji fonts sit a touch high on the baseline.
      ctx.fillText(emoji, size / 2, size / 2 + size * 0.04);
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("Failed to render avatar"))),
        "image/png",
      );
    } catch (e) {
      reject(e instanceof Error ? e : new Error("Failed to render avatar"));
    }
  });
}
