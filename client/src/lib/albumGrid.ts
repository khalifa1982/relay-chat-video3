/**
 * ALBUMS (v2.107.32) — the bubble grid's layout rule, pure so it is testable.
 *
 * The grid shows AT MOST FOUR tiles in two columns — the shape every messenger
 * has trained every thumb on — and folds the rest into a "+N" veil on the last
 * tile. A 200-item album rendering 200 <img>s per bubble would cost the scroll
 * dearly and say nothing four tiles don't; the count is the information, and
 * the viewer is where the items live.
 */
export const ALBUM_GRID_MAX_TILES = 4;

export function albumGridPlan(n: number): { shown: number; overflow: number } {
  const count = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  const shown = Math.min(count, ALBUM_GRID_MAX_TILES);
  return { shown, overflow: Math.max(0, count - shown) };
}
