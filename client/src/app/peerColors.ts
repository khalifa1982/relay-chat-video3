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
 * you. Ten hues, each with enough separation to be told apart at bubble size on
 * a phone, all dark enough to carry white text at the contrast the rest of the
 * app uses.
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
