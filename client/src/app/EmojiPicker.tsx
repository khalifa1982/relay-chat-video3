import { useMemo, useRef, useState } from "react";
import { EMOJI_GROUPS, searchEmoji, emojiCount } from "@/lib/emojiCatalog";

/**
 * The app's ONE emoji picker (v2.99.80) — a categorised, searchable grid over
 * `emojiCatalog`.
 *
 * The owner asked for "the list of all emojis" on the status-reply surface. Three
 * hand-written 32/48/56-glyph lists existed before this; a fourth would have been
 * the wrong answer, so this component and its catalogue are shared by the status
 * reply band and the Messages composer.
 *
 * DESIGN NOTES
 * ------------
 * - Category TABS, not one long scroll. 1,128 glyphs in a single column is a
 *   scroll nobody finishes; the tabs make it a two-tap reach.
 * - SEARCH is keyword-based (`searchEmoji`), because nobody types the Unicode
 *   name. Typing switches the grid to results and the tabs go quiet — showing
 *   both a filter and a category selection at once is ambiguous about which one
 *   is in effect.
 * - Rendered as a plain positioned panel rather than a shadcn Popover: the two
 *   call sites both already own their own overlay stack (the Messages composer,
 *   and the status viewer's `fixed inset-0 z-[100]`), and nesting a portal inside
 *   the viewer would put the panel behind it.
 * - The whole panel carries `select-text` because the status viewer's root sets
 *   `select-none`, which would otherwise make the search field unusable.
 */

export interface EmojiPickerProps {
  /** Called with the chosen glyph. The panel does NOT close itself — the caller
   *  decides, because a composer wants to stay open for a second glyph while a
   *  one-tap reaction does not. */
  onPick: (emoji: string) => void;
  /** Rendered top-right; typically a close button. */
  onClose?: () => void;
  className?: string;
  /** Max grid height. Defaults to a phone-friendly band. */
  maxHeight?: number;
  /** Dark surface (the status viewer is always dark); default follows the theme. */
  tone?: "theme" | "dark";
}

export function EmojiPicker({
  onPick,
  onClose,
  className = "",
  maxHeight = 240,
  tone = "theme",
}: EmojiPickerProps) {
  const [tab, setTab] = useState(0);
  const [q, setQ] = useState("");
  const gridRef = useRef<HTMLDivElement | null>(null);

  const results = useMemo(() => (q.trim() ? searchEmoji(q) : null), [q]);
  const shown = results ?? EMOJI_GROUPS[tab].items.map((i) => i.e);

  const dark = tone === "dark";
  const shell = dark
    ? "border-white/15 bg-neutral-900/95 text-white"
    : "border-border bg-popover text-popover-foreground";
  const fieldCls = dark
    ? "border-white/15 bg-white/10 text-white placeholder:text-white/40"
    : "border-border bg-background";
  const tabIdle = dark ? "text-white/50 hover:bg-white/10" : "text-muted-foreground hover:bg-muted";
  const tabOn = dark ? "bg-white/20 text-white" : "bg-muted text-foreground";
  const cell = dark ? "hover:bg-white/15" : "hover:bg-muted";

  return (
    <div
      // max-w capped and centred. Without it the panel stretches to its parent —
      // in the status viewer that is the full viewport, and 8 columns across 1240px
      // measured 153px per cell in a headless desktop render: a 20px glyph adrift
      // in a huge square. A phone is unaffected (366px is under the cap).
      className={`mx-auto w-full max-w-[420px] select-text rounded-2xl border p-2 shadow-2xl backdrop-blur ${shell} ${className}`}
      // Keep taps inside the panel from reaching an overlay behind it (the status
      // viewer's tap zones sit under this and would navigate the story).
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="mb-1.5 flex items-center gap-1.5">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={`Search ${emojiCount()} emoji…`}
          aria-label="Search emoji"
          dir="ltr"
          className={`h-8 min-w-0 flex-1 rounded-lg border px-2.5 text-sm outline-none ${fieldCls}`}
        />
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close emoji picker"
            className={`rounded-lg px-2 py-1 text-sm ${tabIdle}`}
          >
            ✕
          </button>
        )}
      </div>

      {/* Category tabs. Hidden while searching — a filter and a selected tab
          showing at once is ambiguous about which is in effect. */}
      {!results && (
        <div className="mb-1.5 flex gap-0.5 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {EMOJI_GROUPS.map((g, i) => (
            <button
              key={g.id}
              type="button"
              onClick={() => {
                setTab(i);
                if (gridRef.current) gridRef.current.scrollTop = 0;
              }}
              title={g.label}
              aria-label={g.label}
              aria-pressed={i === tab}
              className={`shrink-0 rounded-lg px-2 py-1 text-base leading-none ${i === tab ? tabOn : tabIdle}`}
            >
              {g.icon}
            </button>
          ))}
        </div>
      )}

      <div
        ref={gridRef}
        className="grid grid-cols-8 gap-0.5 overflow-y-auto overscroll-contain"
        style={{ maxHeight }}
      >
        {shown.map((e) => (
          <button
            key={e}
            type="button"
            onClick={() => onPick(e)}
            // The glyph IS the label; an aria-label per emoji would need a name
            // table this catalogue deliberately doesn't carry (keywords are for
            // search, not for announcement), and a wrong name is worse than the
            // glyph, which screen readers already speak.
            className={`grid aspect-square place-items-center rounded-lg text-xl leading-none ${cell}`}
          >
            {e}
          </button>
        ))}
        {results && results.length === 0 && (
          <div className="col-span-8 px-1 py-6 text-center text-xs opacity-60">
            No emoji match “{q.trim()}”.
          </div>
        )}
      </div>
    </div>
  );
}
