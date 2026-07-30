/**
 * #115 — THE ONE PLACE THAT KNOWS WHAT A STORY-REPLY MARKER LOOKS LIKE.
 *
 * `status.reply` stamps `meta.statusReply` SERVER-SIDE (v2.99.80) — deliberately not
 * through `messages.send`, whose meta schema is a plain `z.object` that STRIPS unknown
 * keys rather than rejecting them, so a client could otherwise label any message a
 * reply to any story including one it never had access to.
 *
 * This lives in `shared/` because THREE readers now need the same rule and they are on
 * opposite sides of the wire: the conversation bubble's chip (client), the thread-list
 * projection (server), and the reply-quote line (client). Two copies of "is this a
 * story reply" is how a thread row and the bubble it opens come to disagree about the
 * same message.
 *
 * Read DEFENSIVELY throughout: this comes off a JSON column, so it may be anything.
 */

export type StatusReplyMarker = {
  id: number;
  kind: string;
  /** ≤80 chars of the story's own text, when it had any. Never its media. */
  excerpt?: string;
};

/** The marker, or null when this message is not a story reply. */
export function statusReplyOf(meta: unknown): StatusReplyMarker | null {
  const sr = (meta as { statusReply?: unknown } | null)?.statusReply;
  if (!sr || typeof sr !== "object") return null;
  const o = sr as { id?: unknown; kind?: unknown; excerpt?: unknown };
  if (typeof o.id !== "number" || typeof o.kind !== "string") return null;
  return {
    id: o.id,
    kind: o.kind,
    excerpt: typeof o.excerpt === "string" ? o.excerpt.slice(0, 80) : undefined,
  };
}

/**
 * Whether this message is a story reply — the narrow question the thread list asks.
 *
 * Its own function rather than `!!statusReplyOf(meta)` at the call site, so the server
 * projection states what it is deriving and cannot accidentally start shipping the
 * whole marker (with the story's excerpt in it) to a list that has no room for it.
 */
export function isStatusReply(meta: unknown): boolean {
  return statusReplyOf(meta) !== null;
}

/**
 * How a replied-to story reads. STORY, never "status" — v2.101.0 fixed that vocabulary
 * everywhere a person can see it, and these strings are user-facing.
 */
export const STORY_KIND_LABEL: Record<string, string> = {
  text: "Story",
  image: "📷 Photo story",
  video: "🎬 Video story",
  audio: "🎤 Audio story",
};

/** The label for a story kind, falling back to the bare word rather than to nothing. */
export function storyKindLabel(kind: string): string {
  return STORY_KIND_LABEL[kind] ?? "Story";
}
