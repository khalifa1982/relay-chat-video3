/**
 * What a MESSAGE notification says, and what it deliberately does not.
 *
 * This module imports NOTHING, for the same reason `callPushPayload.ts` does not:
 * both `v2routers.ts` (the send path) and the tests need it, and a dependency here
 * would put a cycle back through the router. Every function is pure.
 *
 * ── WHY THE BODY CARRIES CONTENT NOW, WHEN IT DELIBERATELY DID NOT (2026-08-02) ──
 * v2.99.42 shipped the offline-message push with a fixed sentence — "Sent you a
 * message — tap to read it." — under the owner's standing rule for the sibling
 * EMAIL ("WITHOUT the content"). The owner's own message-notification spec now asks
 * for `body: preview(message)`, first ~120 chars or "📷 Photo". A later instruction
 * wins, so the preview ships.
 *
 * It is recorded here rather than swapped quietly because it is a PRIVACY-VISIBLE
 * reversal, not a copy edit: a notification renders on a LOCK SCREEN, so from this
 * release the first line of a message is readable by whoever picks the phone up,
 * and it persists in the notification centre until dismissed. That is how every
 * mainstream messenger behaves and it is what makes the feature useful; it is also
 * the reason the two exceptions below are not optional.
 *
 * THE EMAIL IS NOT CHANGED. It stays content-free, because an email sits in a
 * third-party inbox indefinitely and is a different disclosure with a different
 * lifetime. Two channels, two rules, on purpose.
 */

/** How much of a message body a banner may carry. The spec's figure. */
export const MESSAGE_PREVIEW_MAX = 120;

/** The wording used whenever the content must NOT be shown (see `messagePushPreview`). */
export const MESSAGE_PREVIEW_GENERIC = "Sent you a message — tap to read it.";

export type MessagePushKind = "text" | "image" | "video" | "audio" | "file";

export interface MessagePushMeta {
  voicemail?: true;
  expire?: "once" | 5 | 10 | 30;
}

/**
 * The banner body for one message.
 *
 * TWO CASES REFUSE TO QUOTE THE MESSAGE, and both are correctness rather than
 * caution:
 *
 *   1. AN EXPIRING MESSAGE (`meta.expire`, v2.96). Its whole promise is that the
 *      content disappears when the recipient has seen it once — and a notification
 *      OUTLIVES the message: it sits in the notification centre after the bubble
 *      has burned, readable by anyone, with nothing left in the app to correspond
 *      to it. Quoting a view-once message in a push defeats the feature it is a
 *      push about, so the banner says only that something arrived. (The recipient
 *      still gets the real thing by opening the app, which is the only place the
 *      burn can be recorded — see `revealExpiring`.)
 *
 *   2. A BODY THAT IS ONLY WHITESPACE. The send path already rejects an empty
 *      message, but a caption-less attachment legitimately has no body at all, and
 *      a blank banner reads as a broken notification rather than a quiet one.
 *
 * A voicemail is deliberately not handled here: it has its own, better-worded push
 * ("Voicemail from X … tap to listen") and the message push is skipped for it.
 */
export function messagePushPreview(input: {
  kind?: MessagePushKind | null;
  body?: string | null;
  meta?: MessagePushMeta | null;
}): string {
  if (input.meta?.expire) return "Sent you a disappearing message — tap to view it.";
  // Newlines and runs of spaces are collapsed BEFORE the cap, or a message that
  // opens with a blank line spends its whole budget on nothing.
  const text = (input.body ?? "").replace(/\s+/g, " ").trim();
  if (text) {
    if (text.length <= MESSAGE_PREVIEW_MAX) return text;
    // Cut at the last space inside the budget when there is one reasonably close,
    // so the banner ends on a word rather than mid-word.
    const cut = text.slice(0, MESSAGE_PREVIEW_MAX);
    const sp = cut.lastIndexOf(" ");
    return `${(sp > MESSAGE_PREVIEW_MAX - 24 ? cut.slice(0, sp) : cut).trimEnd()}…`;
  }
  switch (input.kind) {
    case "image":
      return "📷 Photo";
    case "video":
      return "🎥 Video";
    case "audio":
      return "🎤 Voice note";
    case "file":
      return "📎 File";
    default:
      // An unrecognised kind with no body: say something true rather than nothing.
      return MESSAGE_PREVIEW_GENERIC;
  }
}

/**
 * The banner title.
 *
 * IN A GROUP THE TITLE IS THE GROUP, NOT THE SENDER, and that is the point of
 * having a title at all: v2.99.42 used the sender's name for both, so a group
 * message told you WHO spoke and not WHERE — and in a busy account "Sara" is not
 * something you can act on, while "Design Crew" is. The sender is not lost; it
 * leads the body (`messagePushBody`), which is how a group notification reads on
 * every other messenger.
 *
 * A group whose title has not been set falls back to the sender's name rather than
 * to an empty string or the word "Group", because a banner with no name in it is
 * worse than one naming a person who really did send it.
 */
export function messagePushTitle(input: {
  isGroup: boolean;
  groupTitle?: string | null;
  senderName: string;
}): string {
  if (input.isGroup) {
    const t = (input.groupTitle ?? "").trim();
    if (t) return t;
  }
  return input.senderName;
}

/**
 * The banner body, with the sender prefixed in a group.
 *
 * The prefix is added HERE rather than at the call site so the title and the body
 * cannot come to disagree about which of them names the person — the defect this
 * pair replaces was exactly that kind of split.
 */
export function messagePushBody(input: {
  isGroup: boolean;
  senderName: string;
  preview: string;
}): string {
  if (!input.isGroup) return input.preview;
  const who = input.senderName.trim();
  return who ? `${who}: ${input.preview}` : input.preview;
}
