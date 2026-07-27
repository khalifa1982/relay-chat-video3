import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

/**
 * A row you can drag sideways to reveal actions (v2.103.0).
 *
 * Owner, with two screenshots of the Messages list: drag a thread row LEFT and the
 * right-hand actions appear; drag it RIGHT and the left-hand ones do. Glassy buttons.
 * Holding a finger on the row is a second way in.
 *
 * THE LOAD-BEARING PROBLEM IS NOT THE ANIMATION — IT IS THAT THIS LIVES INSIDE A
 * VERTICALLY SCROLLING LIST. A naive implementation calls `preventDefault` on touchmove
 * and the list stops scrolling; a slightly better one still steals the gesture whenever
 * a finger moves a few pixels sideways while scrolling, which makes the whole screen
 * feel broken. Two things prevent that:
 *
 *   1. `touch-action: pan-y` — the browser keeps vertical panning for itself and only
 *      offers us horizontal movement, so scrolling never has to be given back.
 *   2. The gesture is not claimed until the pointer has moved past a threshold AND
 *      horizontally more than vertically. Until then every event is observed, not
 *      consumed, so a diagonal flick still scrolls.
 *
 * NOTHING ANIMATES EXCEPT `transform` AND `opacity`, and the drag itself writes the
 * transform imperatively rather than through React state — a state update per pointer
 * move would re-render the whole thread list on every frame of every drag, which is the
 * mistake v2.99.67 recorded.
 */

export interface SwipeAction {
  key: string;
  label: string;
  icon: ReactNode;
  /** The chip's hue. Applied inline: a runtime-composed Tailwind class is invisible to
   *  the JIT compiler and comes out unstyled (the tab-accent trap). */
  color: string;
  onSelect: () => void;
}

/** Past this fraction of a side's width, letting go RUNS the nearest action instead of
 *  just holding the tray open — the shortcut a full swipe is expected to be. */
const COMMIT_FRACTION = 0.85;
/** Below this the row springs back: a stray few pixels must not open anything. */
const OPEN_THRESHOLD = 0.4;
/** Movement before the gesture is claimed from the scroller. */
const CLAIM_PX = 10;
/** Hold this long without moving and the tray opens — the owner's second way in. */
const HOLD_MS = 450;
/** Per action, so a side's tray is as wide as what it holds. */
const ACTION_W = 76;

export function SwipeRow({
  left = [],
  right = [],
  children,
  disabled,
  rowClassName = "",
}: {
  /** Revealed by dragging RIGHT (they sit on the left edge). */
  left?: SwipeAction[];
  /** Revealed by dragging LEFT (they sit on the right edge). */
  right?: SwipeAction[];
  children: ReactNode;
  disabled?: boolean;
  rowClassName?: string;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  // `open` is the SETTLED state and the only thing React re-renders on. The live drag
  // never touches it.
  const [open, setOpen] = useState<"left" | "right" | null>(null);

  const drag = useRef({
    active: false,
    claimed: false,
    startX: 0,
    startY: 0,
    base: 0,
    x: 0,
    pointerId: -1,
    holdTimer: 0 as number | ReturnType<typeof setTimeout>,
  });

  const leftW = left.length * ACTION_W;
  const rightW = right.length * ACTION_W;

  /** Write the sheet's position without a re-render. */
  const paint = useCallback((x: number, animate: boolean) => {
    const el = sheetRef.current;
    if (!el) return;
    el.style.transition = animate ? "transform 220ms cubic-bezier(.22,.61,.36,1)" : "none";
    el.style.transform = `translate3d(${x}px,0,0)`;
  }, []);

  const settle = useCallback(
    (side: "left" | "right" | null) => {
      setOpen(side);
      paint(side === "left" ? leftW : side === "right" ? -rightW : 0, true);
    },
    [leftW, rightW, paint],
  );

  // Closing has to be reachable from outside a pointer gesture too: tapping elsewhere,
  // pressing Escape, or the list re-ordering under an open row.
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== "Escape") return;
      // A tap INSIDE this row's own tray must not close it before the button fires.
      if (e.target instanceof Node && wrapRef.current?.contains(e.target)) return;
      settle(null);
    };
    document.addEventListener("pointerdown", close, true);
    document.addEventListener("keydown", close, true);
    return () => {
      document.removeEventListener("pointerdown", close, true);
      document.removeEventListener("keydown", close, true);
    };
  }, [open, settle]);

  const clearHold = () => {
    if (drag.current.holdTimer) clearTimeout(drag.current.holdTimer as ReturnType<typeof setTimeout>);
    drag.current.holdTimer = 0;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (disabled || e.button !== 0) return;
    const d = drag.current;
    d.active = true;
    d.claimed = false;
    d.startX = e.clientX;
    d.startY = e.clientY;
    d.base = open === "left" ? leftW : open === "right" ? -rightW : 0;
    d.x = d.base;
    d.pointerId = e.pointerId;
    // Press-and-hold: opens the side with actions, preferring the right-hand tray
    // (Mute / Delete / Archive) because that is the one people reach for. Cancelled by
    // any real movement below, so a hold is only a hold if the finger stays put.
    clearHold();
    if (!open) {
      d.holdTimer = setTimeout(() => {
        if (!drag.current.active || drag.current.claimed) return;
        settle(right.length > 0 ? "right" : left.length > 0 ? "left" : null);
        // The gesture is spent: the tray is open, so the finger lifting must not also
        // be read as a tap on the row.
        drag.current.claimed = true;
      }, HOLD_MS);
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d.active || e.pointerId !== d.pointerId) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;

    if (!d.claimed) {
      // Not ours yet. A mostly-vertical move belongs to the scroller and ends our
      // interest in this gesture entirely, so we can never fight it mid-scroll.
      if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > CLAIM_PX) {
        d.active = false;
        clearHold();
        return;
      }
      if (Math.abs(dx) < CLAIM_PX) return;
      d.claimed = true;
      clearHold();
      // Only now do we take the pointer, so the browser has already had its chance to
      // start a vertical scroll if that is what this was.
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    }

    // Clamped to what each side actually holds, with a little resistance past the end so
    // an over-drag feels like a limit rather than a dead stop.
    const raw = d.base + dx;
    const max = leftW;
    const min = -rightW;
    const x = raw > max ? max + (raw - max) * 0.18 : raw < min ? min + (raw - min) * 0.18 : raw;
    d.x = x;
    paint(x, false);
  };

  const finish = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d.active || e.pointerId !== d.pointerId) return;
    d.active = false;
    clearHold();
    if (!d.claimed) return; // a tap, or a scroll — leave the row alone

    const x = d.x;
    if (x > 0 && leftW > 0) {
      if (x >= leftW * COMMIT_FRACTION && left.length === 1) {
        // A full swipe on a single-action side runs it, which is what a full swipe is
        // for. With several actions there is nothing unambiguous to run, so it opens.
        settle(null);
        left[0].onSelect();
        return;
      }
      settle(x >= leftW * OPEN_THRESHOLD ? "left" : null);
      return;
    }
    if (x < 0 && rightW > 0) {
      if (-x >= rightW * COMMIT_FRACTION && right.length === 1) {
        settle(null);
        right[0].onSelect();
        return;
      }
      settle(-x >= rightW * OPEN_THRESHOLD ? "right" : null);
      return;
    }
    settle(null);
  };

  const tray = (actions: SwipeAction[], side: "left" | "right") => (
    <div
      className={
        "absolute inset-y-0 flex items-center gap-1.5 px-1.5 " +
        (side === "left" ? "start-0" : "end-0")
      }
      aria-hidden={open !== side}
    >
      {actions.map((a) => (
        <button
          key={a.key}
          type="button"
          // Not focusable while hidden, or Tab walks through every buried action on
          // every row in the list.
          tabIndex={open === side ? 0 : -1}
          onClick={() => {
            settle(null);
            a.onSelect();
          }}
          className="flex w-[64px] shrink-0 flex-col items-center gap-1 rounded-2xl py-1.5 transition active:scale-95"
        >
          <span
            aria-hidden="true"
            // GLASSY: a translucent tint of the action's own hue over a blur, with a
            // hairline of the same hue — so it reads as a lit pane rather than a flat
            // circle, and the colour survives both themes.
            className="grid size-11 place-items-center rounded-full border shadow-lg backdrop-blur-md"
            style={{
              background: `linear-gradient(160deg, ${a.color}f2, ${a.color}bf)`,
              borderColor: `${a.color}80`,
              boxShadow: `0 6px 18px -6px ${a.color}99, inset 0 1px 0 rgba(255,255,255,.35)`,
              color: "#fff",
            }}
          >
            {a.icon}
          </span>
          <span className="text-[10.5px] font-medium leading-none text-muted-foreground">
            {a.label}
          </span>
        </button>
      ))}
    </div>
  );

  return (
    <div
      ref={wrapRef}
      className="relative overflow-hidden"
      // The browser keeps vertical panning; we are only ever offered horizontal
      // movement. This single line is what stops the list feeling broken.
      style={{ touchAction: "pan-y" }}
    >
      {left.length > 0 && tray(left, "left")}
      {right.length > 0 && tray(right, "right")}
      <div
        ref={sheetRef}
        className={"relative " + rowClassName}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finish}
        onPointerCancel={finish}
        // A row dragged open must not also register the tap that closed it.
        onClickCapture={(e) => {
          if (open) {
            e.preventDefault();
            e.stopPropagation();
            settle(null);
          }
        }}
      >
        {children}
      </div>
    </div>
  );
}
