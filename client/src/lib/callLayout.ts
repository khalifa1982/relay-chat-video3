/* Pure decision logic for the in-call video layout (active-speaker / spotlight /
 * compact). Kept DOM-free and dependency-free so it's cheap to unit-test; the
 * relay engine applies the returned decision to the real #videoGrid tiles. */

export type LayoutMode = "grid" | "spotlight" | "compact";

export interface LayoutInput {
  /** Tile element ids in DOM order, e.g. ["tile-self", "tile-123456"]. */
  tileIds: string[];
  /** Our own tile id (excluded from auto-spotlight, sorted last). */
  selfId?: string;
  /** Tile id the user clicked to pin big, or null. */
  manualSpotlightId: string | null;
  /** Tile ids currently sharing a screen. */
  screenShareIds: string[];
  /** Tile id of the loudest speaker (auto), or null. */
  activeSpeakerId: string | null;
  /** Tile ids ordered loudest-first (recent activity). */
  speakerOrder: string[];
  /** True when the call container is "minimized" (small). */
  compact: boolean;
}

export interface LayoutResult {
  mode: LayoutMode;
  /** The big/primary tile (spotlight & compact), or null for an equal grid. */
  focusId: string | null;
  /** Tiles to render (compact hides the rest; grid/spotlight show all). */
  shownIds: string[];
  /** Non-focus tiles shown as a thumb row in spotlight mode. */
  thumbIds: string[];
}

const DEFAULT_SELF = "tile-self";

/** The tile id of a screen share, preferring a REMOTE share over our own. */
export function pickScreenShareTile(
  tileIds: string[],
  screenShareIds: Iterable<string>,
  selfId: string = DEFAULT_SELF,
): string | null {
  const shares = new Set(screenShareIds);
  let selfShare: string | null = null;
  for (const id of tileIds) {
    if (!shares.has(id)) continue;
    if (id === selfId) selfShare = id;
    else return id; // a remote share wins
  }
  return selfShare;
}

/** Resolve the focused tile: manual pin > screen share > active speaker. */
export function resolveFocus(input: LayoutInput): string | null {
  const { tileIds, manualSpotlightId, screenShareIds, activeSpeakerId } = input;
  const selfId = input.selfId ?? DEFAULT_SELF;
  const has = (id: string | null): id is string => !!id && tileIds.includes(id);
  if (has(manualSpotlightId)) return manualSpotlightId;
  const share = pickScreenShareTile(tileIds, screenShareIds, selfId);
  if (share) return share;
  if (has(activeSpeakerId)) return activeSpeakerId;
  return null;
}

/** Tiles ranked by relevance: focus first, then loudest speakers, then DOM
 *  order, with our own tile last. Used to pick the top-2 in compact view. */
export function rankTiles(
  tileIds: string[],
  focusId: string | null,
  speakerOrder: string[],
  selfId: string = DEFAULT_SELF,
): string[] {
  const present = new Set(tileIds);
  const out: string[] = [];
  const push = (id: string | null) => {
    if (id && present.has(id) && !out.includes(id)) out.push(id);
  };
  push(focusId);
  speakerOrder.forEach(push);
  for (const id of tileIds) if (id !== selfId) push(id);
  push(selfId);
  return out;
}

/** Decide the full layout from the current call state. */
export function computeLayout(input: LayoutInput): LayoutResult {
  const { tileIds, compact } = input;
  const selfId = input.selfId ?? DEFAULT_SELF;
  if (tileIds.length === 0) {
    return { mode: "grid", focusId: null, shownIds: [], thumbIds: [] };
  }
  const focusId = resolveFocus(input);

  if (compact) {
    const order = rankTiles(tileIds, focusId, input.speakerOrder, selfId);
    const shownIds = order.slice(0, 2);
    return {
      mode: "compact",
      focusId: shownIds[0] ?? null,
      shownIds,
      thumbIds: [],
    };
  }

  if (focusId) {
    const thumbIds = tileIds.filter((id) => id !== focusId);
    return { mode: "spotlight", focusId, shownIds: tileIds.slice(), thumbIds };
  }

  return { mode: "grid", focusId: null, shownIds: tileIds.slice(), thumbIds: [] };
}
