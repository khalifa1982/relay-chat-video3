/**
 * One-line preview for a message in a list (thread list, in-app popup, etc.).
 * When there's no text body (an attachment-only message), show a kind-based
 * label + glyph instead of a bare dash, matching WhatsApp-style thread previews.
 */
export function previewOf(kind: string, body: string | null | undefined): string {
  if (body && body.trim()) return body;
  switch (kind) {
    case "image":
      return "📷 Photo";
    case "video":
      return "🎬 Video";
    case "audio":
      return "🎤 Voice message";
    case "file":
      return "📎 File";
    default:
      return "New message";
  }
}
