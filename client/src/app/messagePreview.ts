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

/**
 * #115 — A STORY REPLY, PREVIEWED WITH ITS CONTEXT.
 *
 * A one-tap story reaction IS an emoji-only message, so in a list it arrived as a
 * floating ❤️ with nothing saying what it was about. The conversation bubble has said
 * so since v2.99.80; the thread list and the reply-quote line did not.
 *
 * `mine` means the LAST MESSAGE is ours, and it is what decides "your" vs "their" —
 * correct because a story reply is always a DM to the story's AUTHOR (`status.reply`
 * resolves the thread with `getOrCreateDmConversation`), so whoever did not send the
 * reply owns the story.
 *
 * DELIBERATELY SHORTER THAN THE BUBBLE'S CHIP, which reads "↩ Replied to your story ·
 * 📷 Photo story · “…”". Same vocabulary — story, your/their — but a one-line glance
 * has a hard budget the bubble does not, and this was MEASURED against the real built
 * stylesheet rather than estimated: after the 6-digit number and its separator the
 * preview span is 141px at 320px and 181px at 360px, while the chip's wording needs
 * **193px** — so it clips on those two widths, and what clips is the END of the line,
 * i.e. exactly the reaction that varies. This form needs **118px** and fits at every
 * width with room to spare. The story's KIND and EXCERPT are dropped for the same
 * reason: they push the reply's own content off the end.
 *
 * No bidi ceremony is needed and that is worth stating rather than adding: the prefix
 * is Latin and comes FIRST, so `dir="auto"` resolves the row to LTR and an Arabic body
 * renders RTL *within* it, in logical order — exactly as "📷 Photo" already does.
 */
export function previewOfStoryReply(opts: {
  mine: boolean;
  kind: string;
  body: string | null | undefined;
}): string {
  return `↩ ${opts.mine ? "their" : "your"} story · ${previewOf(opts.kind, opts.body)}`;
}
