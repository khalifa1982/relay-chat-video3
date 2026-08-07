/**
 * Per-person conversation colours.
 *
 * Owner: "when he post mind bubble is orange so him he should. the other side
 * should be blue, but if you were in the group each one give him a different
 * colour for his type of chat bubble" — and, for the typing line, "it give a
 * different color if there is two three people typing in the same time".
 *
 * WHERE A GROUP PERSON'S COLOUR NOW LANDS CHANGED IN v2.106.61, and the sentence above
 * is left verbatim because it is the reason it needed asking rather than deciding. The
 * owner's redesign board (frame 3c) keeps every received bubble on ONE neutral surface
 * and colours the sender's NAME and AVATAR instead; those two words asked for the
 * opposite. Put to them directly, they chose the board — "Match the board exactly" — so
 * the per-person hue moved off the bubble fill and onto the name and the disc. The
 * identity → hue MAPPING is untouched, so nobody's colour changed, only what it tints.
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

/**
 * MINE — the orange the owner asked for, at the board's own weight (v2.106.62).
 *
 * A CORRECTION TO MYSELF, and it is the reason this changed. v2.106.40 recorded, twice
 * and in two files, that *"the board draws the outgoing bubble as a translucent ACCENT
 * tint, but the owner asked for orange"* — and treated that as a conflict where the
 * owner's words win. Read off the board's own markup, frame 3c's outgoing bubble is
 * `rgba(245,140,60,.17)` with a `rgba(245,140,60,.45)` border. **245,140,60 is orange.**
 * Every accent surface on that board is spelled `rgba(var(--rb-rgb), …)`; this one is not.
 *
 * So there was never a conflict to resolve: the board and the owner agree on orange, and
 * the only thing that differed was WEIGHT — a solid saturated gradient here versus a
 * translucent tint there. The owner's ask ("when he post mind bubble is orange") is
 * satisfied either way, so the board's weight is what to take.
 *
 * AND THE MISREADING HAD A REAL COST BEYOND THE FILL, which is what makes this worth
 * recording rather than quietly patching: v2.106.40 measured the ✓✓ ticks against the
 * SOLID `#fb923c`, correctly concluded the accent was unreadable on it (1.34:1), and moved
 * read/delivered onto white. That measurement was right about the surface it was taken on
 * and the surface was the wrong one. On a 17% orange over a near-black page the effective
 * background is far darker, which is exactly why the board can draw its tick and its
 * `@mention` in the accent. Both are re-measured on THIS fill in `messagingColors.test.ts`
 * rather than assumed to have flipped.
 *
 * `BRAND_GRADIENT` is untouched and still solid: it is the two SEND BUTTONS, where a
 * translucent fill would make the app's primary action look disabled.
 */
export const OWN_BUBBLE_STYLE: CSSProperties = {
  // Split into colour + image rather than the `background` shorthand. There is no image
  // here today, but the shorthand is what reset `background-color` to transparent in the
  // v2.106.40 `.rglass` defect, and a later gradient added on top of a shorthand is how
  // that returns.
  backgroundColor: "rgba(245,140,60,.17)",
  // THEME-AWARE (v2.107.27). This was the literal `#f2fffa`, which is right over the
  // board's near-black page and measured 1.18:1 over the light one — the fill is
  // TRANSLUCENT, so the effective surface tracks the page while the text did not. An
  // inline style cannot branch on theme, so the value lives in `index.css` with a
  // `:not(.dark)` override; the dark value there is this exact hex.
  color: "var(--mbub-own-fg)",
  borderColor: "rgba(245,140,60,.45)",
};

/**
 * The other side of a 1:1 — the board's neutral surface carrying a BLUE EDGE (v2.106.62).
 *
 * THE BOARD AND AN EXPLICIT OWNER REQUEST GENUINELY CONFLICTED HERE, so it was put to them
 * rather than resolved in either direction. Frames 1d and 3c use the SAME neutral glass for
 * every received bubble — a 1:1 peer's and a group member's are byte-identical markup — so
 * "match the board exactly" means the 1:1 blue disappears. But the owner asked for that blue
 * in their own words in v2.99.85 (*"the other side should be blue"*), and an answer given
 * about GROUP bubbles is not licence to delete a second, separate request.
 *
 * Offered the three readings, they chose **neutral glass plus a blue edge**: the board's
 * surface, with the colour they named surviving as the border rather than the fill. So the
 * fill is the board's verbatim and only `borderColor` differs from a group member's.
 *
 * `.45` mirrors the own bubble's `rgba(245,140,60,.45)` exactly, which makes the three
 * surfaces one system rather than three decisions — mine an orange edge, a 1:1 peer a blue
 * edge, a group member the board's neutral edge, all on the same glass.
 *
 * SAID PLAINLY: a 1:1 received bubble renders NO name label (there is only one other person
 * in the thread), so the border is the whole of the blue in a conversation. The chat header's
 * title is deliberately NOT tinted — the board draws it `#eafff6`, and recolouring it would
 * break frame 1d's header to satisfy a bubble decision.
 */
export const PEER_BUBBLE_STYLE: CSSProperties = {
  background:
    "linear-gradient(180deg,rgba(255,255,255,.08),rgba(255,255,255,.03))",
  color: "var(--mbub-peer-fg)",
  borderColor: "rgba(59,130,246,.45)",
};

/**
 * Group palette. Blue is deliberately ABSENT: in a group it would read as "the
 * other person" from the 1:1 rule, and orange is absent because that is always
 * you. `text` is the light tint the sender's NAME renders in, and `hue` is what
 * their avatar gradient is built from; `from`/`to` are no longer a bubble fill
 * (v2.106.61) and survive because the voice-note glyph is measured against `to`.
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
export const GROUP_PALETTE: readonly {
  /** The light stop of the sender AVATAR gradient, and the voice-note glyph source. */
  from: string;
  /** The dark stop — what `bubbleGlyphColor` uses on a white disc. */
  to: string;
  /** The sender NAME colour: a light tint that reads on the neutral glass bubble. */
  text: string;
  /** The hue the board builds this person’s avatar gradient from (v2.106.61). */
  hue: number;
}[] = [
  { from: "#a855f7", to: "#6d28d9", text: "#d8b4fe", hue: 271 }, // violet
  { from: "#10b981", to: "#047857", text: "#6ee7b7", hue: 160 }, // emerald
  { from: "#f43f5e", to: "#9f1239", text: "#fda4af", hue: 350 }, // rose
  { from: "#06b6d4", to: "#0e7490", text: "#67e8f9", hue: 189 }, // cyan
  { from: "#eab308", to: "#a16207", text: "#fde047", hue: 45 }, // amber
  { from: "#ec4899", to: "#9d174d", text: "#f9a8d4", hue: 330 }, // pink
  { from: "#84cc16", to: "#4d7c0f", text: "#bef264", hue: 84 }, // lime
  { from: "#8b5cf6", to: "#5b21b6", text: "#c4b5fd", hue: 258 }, // purple
  { from: "#f97316", to: "#9a3412", text: "#fdba74", hue: 25 }, // burnt (distinct from own gradient)
  { from: "#14b8a6", to: "#0f766e", text: "#5eead4", hue: 173 }, // teal
  // ── v2.103.3, the second six ────────────────────────────────────────────────
  { from: "#dc2626", to: "#7f1d1d", text: "#fca5a5", hue: 0 }, // crimson — deeper and less pink than rose
  { from: "#d946ef", to: "#86198f", text: "#f0abfc", hue: 292 }, // fuchsia — sits between pink and violet
  { from: "#22c55e", to: "#166534", text: "#86efac", hue: 142 }, // spring green — warmer than emerald's blue-green
  { from: "#ca8a04", to: "#713f12", text: "#fde68a", hue: 41 }, // mustard — amber taken darker
  { from: "#7e22ce", to: "#4c1d95", text: "#e9d5ff", hue: 272 }, // plum — violet taken darker
  { from: "#0891b2", to: "#155e75", text: "#a5f3fc", hue: 192 }, // sea — cyan taken darker
];

/**
 * Stable index for an identity. A plain modulo would put ids 1 and 11 on the same
 * hue, and small consecutive ids are exactly what a young install hands out — so
 * mix the bits first. Deterministic and dependency-free; this is a colour picker,
 * not a hash that anything trusts.
 */
export function peerPaletteIndex(
  identityId: number | null | undefined
): number {
  const n =
    typeof identityId === "number" && Number.isFinite(identityId)
      ? Math.abs(Math.trunc(identityId))
      : 0;
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

/**
 * THE GROUP RECEIVED BUBBLE — one neutral glass for everybody (v2.106.61).
 *
 * Board frame 3c gives every received bubble the SAME surface and puts the per-person
 * colour on the sender's NAME and AVATAR instead. Until now this app did the opposite:
 * sixteen saturated per-person bubble fills.
 *
 * THAT WAS NOT A MISREADING — it is what the owner asked for, twice, in the words quoted
 * at the top of this file. The board and those words genuinely conflict, so it was put to
 * them rather than resolved here, and they chose the board: *"Match the board exactly."*
 *
 * AND THE BOARD'S CHOICE IS LOAD-BEARING RATHER THAN COSMETIC, which is what makes the
 * rest of 3c possible: its reply quote is an accent-tinted panel with an accent left
 * border, and its `@mention` is accent-coloured bold text — both INSIDE the bubble. On a
 * saturated per-person fill neither reads, because the accent would be competing with a
 * different strong hue in every bubble. A neutral surface is what lets one accent mean
 * one thing everywhere.
 *
 * The identity → colour mapping is UNCHANGED, so nobody's colour moves: the same
 * `peerPaletteIndex` still picks the same palette entry, and that entry now tints the
 * name and the avatar rather than the bubble.
 */
export const GROUP_BUBBLE_STYLE: CSSProperties = {
  background:
    "linear-gradient(180deg,rgba(255,255,255,.08),rgba(255,255,255,.03))",
  color: "var(--mbub-peer-fg)",
  borderColor: "rgba(255,255,255,.11)",
};

/** The bubble style for one message. */
export function bubbleStyleFor(opts: {
  mine: boolean;
  isGroup: boolean;
  senderIdentityId: number | null | undefined;
}): CSSProperties {
  if (opts.mine) return OWN_BUBBLE_STYLE;
  if (!opts.isGroup) return PEER_BUBBLE_STYLE;
  return GROUP_BUBBLE_STYLE;
}

/**
 * THE SENDER'S AVATAR, in their own colour — where the board puts a person's identity.
 *
 * Built to the board's own formula: one hue drives a `135deg` gradient from a light stop
 * to a darker one 45° along the wheel, carrying near-black text. Frame 3c's four senders
 * are `hsl(282 …)`, `hsl(208 …)`, `hsl(58 …)` and `hsl(330 …)`, all of that shape.
 *
 * The hue comes from the SAME palette entry the name does, so a person's disc, their name
 * and their typing line cannot disagree — which is the whole reason this module exists.
 * Returned as a style rather than a class because a runtime-composed Tailwind class is
 * invisible to the JIT and comes out unstyled (the tab-accent trap).
 */
export function senderAvatarStyle(opts: {
  isGroup: boolean;
  senderIdentityId: number | null | undefined;
}): CSSProperties {
  const h = opts.isGroup
    ? GROUP_PALETTE[peerPaletteIndex(opts.senderIdentityId)].hue
    : 212;
  return {
    background: `linear-gradient(135deg,hsl(${h} 65% 62%),hsl(${(h + 45) % 360} 70% 42%))`,
    // The board's on-gradient text: near-black, so it reads on every hue including the
    // yellows, where white would not.
    color: "#04211a",
  };
}

/**
 * The colour for a GLYPH that sits on a WHITE control placed on top of the bubble —
 * the voice-note play disc, today.
 *
 * The bubble's own DARKER gradient stop, so the control borrows the bubble's identity
 * rather than introducing another colour, and so it is legible by construction on every
 * hue the palette can hand out. Measured on a white disc across all 36 surfaces (own,
 * peer and the 16 group hues, both stops of each): 4.92:1 at worst, none failing AA.
 *
 * This exists because `.rchip-accent` — a CARD recipe — was being used here, and on a
 * saturated bubble it measured 1.16:1 at worst and failed on 30 of those 36. A recipe is
 * only valid on the surface it was measured against.
 *
 * Still correct after v2.106.61 moved the group bubble to neutral glass and v2.106.62 moved
 * the other two to translucent tints: the measurement was of the GLYPH on the WHITE DISC,
 * which has not changed, and every surface the disc now sits on is LIGHTER than the
 * saturated fills it was measured against — so the white disc reads at least as well as it
 * did. What these values no longer do is borrow the bubble's own fill; they borrow the
 * SENDER's colour, which is the same person either way.
 */
export function bubbleGlyphColor(opts: {
  mine: boolean;
  isGroup: boolean;
  senderIdentityId: number | null | undefined;
}): string {
  if (opts.mine) return "#c2410c"; // the own gradient's dark stop
  if (!opts.isGroup) return "#1d4ed8"; // the 1:1 blue's dark stop
  return GROUP_PALETTE[peerPaletteIndex(opts.senderIdentityId)].to;
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
