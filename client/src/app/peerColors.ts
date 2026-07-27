/**
 * Per-person conversation colours.
 *
 * Owner: "when he post mind bubble is orange so him he should. the other side
 * should be blue, but if you were in the group each one give him a different
 * colour for his type of chat bubble" — and, for the typing line, "it give a
 * different color if there is two three people typing in the same time".
 *
 * ONE module for both, deliberately. A bubble colour and a typing colour that
 * disagree about the same person is worse than having neither, because the colour
 * is the only thing telling you who is who at a glance — and duplicated rules are
 * exactly how two screens end up promising different things (the v2.99.55
 * lesson, and v2.99.77's one-rule-five-call-sites bug).
 *
 * The colour is derived from the identity id, NOT from the person's position in
 * the roster. Position changes as people join, leave or are reordered by a query,
 * which would silently recolour a conversation mid-scroll; an identity id never
 * moves. It also means every participant sees the SAME person in the SAME colour
 * without anyone having to agree on an ordering.
 */
import type { CSSProperties } from "react";

/**
 * The brand orange, in one place. It serves two purposes — my bubbles and the two
 * send buttons — and had been written out three times, so a change to one would
 * have silently disagreed with the others.
 */
export const BRAND_GRADIENT = "linear-gradient(135deg,#fb923c,#c2410c)";

/** Mine, everywhere: the orange the owner already has and asked to keep. */
export const OWN_BUBBLE_STYLE: CSSProperties = {
  background: BRAND_GRADIENT,
  color: "#fff",
  borderColor: "rgba(255,255,255,.18)",
};

/**
 * The other side of a 1:1, named rather than drawn from the palette. The owner
 * asked for blue specifically, and a two-person thread has no ambiguity to
 * resolve — so it must not depend on a hash that could hand out a different hue.
 */
export const PEER_BUBBLE_STYLE: CSSProperties = {
  background: "linear-gradient(135deg,#3b82f6,#1d4ed8)",
  color: "#fff",
  borderColor: "rgba(255,255,255,.18)",
};

/**
 * Group palette. Blue is deliberately ABSENT: in a group it would read as "the
 * other person" from the 1:1 rule, and orange is absent because that is always
 * you. Every hue is dark enough to carry white text at the contrast the rest of
 * the app uses, and every `text` is the light tint the sender's NAME renders in.
 *
 * SIXTEEN, at the owner's request ("every user gets a different bubble colour, up
 * to 16"). Said plainly: sixteen is at the limit of what is tellable apart at
 * bubble size on a phone, and it has to be, because the wheel is already missing
 * blue and orange. The first ten are the v2.99.85 set and are the most separated;
 * the six added here lean on DEPTH as a second axis rather than trying to find six
 * more unused hues, which do not exist — a deep crimson beside a bright rose reads
 * as two colours, whereas two more near-identical greens would not.
 *
 * The array's ORDER carries no meaning: `peerPaletteIndex` is a bit-mixed hash, so
 * neighbours in this list are not neighbours on screen. What matters is that all
 * sixteen are pairwise distinguishable, which is what the palette test checks.
 */
export const GROUP_PALETTE: readonly { from: string; to: string; text: string }[] = [
  { from: "#a855f7", to: "#6d28d9", text: "#d8b4fe" }, // violet
  { from: "#10b981", to: "#047857", text: "#6ee7b7" }, // emerald
  { from: "#f43f5e", to: "#9f1239", text: "#fda4af" }, // rose
  { from: "#06b6d4", to: "#0e7490", text: "#67e8f9" }, // cyan
  { from: "#eab308", to: "#a16207", text: "#fde047" }, // amber
  { from: "#ec4899", to: "#9d174d", text: "#f9a8d4" }, // pink
  { from: "#84cc16", to: "#4d7c0f", text: "#bef264" }, // lime
  { from: "#8b5cf6", to: "#5b21b6", text: "#c4b5fd" }, // purple
  { from: "#f97316", to: "#9a3412", text: "#fdba74" }, // burnt (distinct from own gradient)
  { from: "#14b8a6", to: "#0f766e", text: "#5eead4" }, // teal
  // ── v2.103.3, the second six ────────────────────────────────────────────────
  { from: "#dc2626", to: "#7f1d1d", text: "#fca5a5" }, // crimson — deeper and less pink than rose
  { from: "#d946ef", to: "#86198f", text: "#f0abfc" }, // fuchsia — sits between pink and violet
  { from: "#22c55e", to: "#166534", text: "#86efac" }, // spring green — warmer than emerald's blue-green
  { from: "#ca8a04", to: "#713f12", text: "#fde68a" }, // mustard — amber taken darker
  { from: "#7e22ce", to: "#4c1d95", text: "#e9d5ff" }, // plum — violet taken darker
  { from: "#0891b2", to: "#155e75", text: "#a5f3fc" }, // sea — cyan taken darker
];

/**
 * Stable index for an identity. A plain modulo would put ids 1 and 11 on the same
 * hue, and small consecutive ids are exactly what a young install hands out — so
 * mix the bits first. Deterministic and dependency-free; this is a colour picker,
 * not a hash that anything trusts.
 */
export function peerPaletteIndex(identityId: number | null | undefined): number {
  const n = typeof identityId === "number" && Number.isFinite(identityId) ? Math.abs(Math.trunc(identityId)) : 0;
  // `Math.imul`, not `*` — a plain multiply produces a double, and the following
  // `>>>` truncates to 32 bits, THROWING AWAY the high bits that carry all the
  // mixing. The first version of this did exactly that and ids 1, 2 and 4 all
  // landed on the same hue, which is the bug the palette exists to avoid. Caught
  // by this release's own test rather than shipped.
  let h = Math.imul(n, 2654435761) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 2246822519) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 3266489917) >>> 0;
  h ^= h >>> 16;
  return (h >>> 0) % GROUP_PALETTE.length;
}

/** The bubble style for one message. */
export function bubbleStyleFor(opts: {
  mine: boolean;
  isGroup: boolean;
  senderIdentityId: number | null | undefined;
}): CSSProperties {
  if (opts.mine) return OWN_BUBBLE_STYLE;
  if (!opts.isGroup) return PEER_BUBBLE_STYLE;
  const c = GROUP_PALETTE[peerPaletteIndex(opts.senderIdentityId)];
  return {
    background: `linear-gradient(135deg,${c.from},${c.to})`,
    color: "#fff",
    borderColor: "rgba(255,255,255,.18)",
  };
}

/**
 * The text colour for a person's NAME — used by the typing line and the group
 * sender label, so a bubble and the name above it read as the same person.
 * A light tint rather than the bubble's own gradient, because this sits on the
 * page background where a dark fill would be unreadable.
 */
export function nameColorFor(opts: {
  isGroup: boolean;
  senderIdentityId: number | null | undefined;
}): string {
  if (!opts.isGroup) return "#93c5fd"; // the 1:1 blue, lightened for text
  return GROUP_PALETTE[peerPaletteIndex(opts.senderIdentityId)].text;
}
