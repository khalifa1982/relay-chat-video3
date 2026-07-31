import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

/**
 * A row you can drag sideways to reveal actions (v2.103.0, reworked v2.106.60).
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
 *
 * ── v2.106.60: THE SWIPE NOW STAYS WHERE YOU PUT IT ───────────────────────────────────
 *
 * The owner, on the shipped behaviour: "when you slide right or left, that bar shouldn't
 * be transparent; it should only show you the icons, either on the left or the right.
 * When you remove your hand, the bar should stop where you slid it, and you can then
 * click on these buttons."
 *
 * All three were real and all three were MEASURED by driving a real drag on the real
 * bundle rather than reasoned about — the first two theories this file's own author
 * reached for were both wrong:
 *
 *   (1) THE TRAY OPENED AND WAS THEN CLOSED BY THE CLICK THAT ENDED THE DRAG. The
 *       timeline off a real pointer drag reads: pointerup (still dragging) →
 *       lostpointercapture (transform -228px, tray OPEN) → click → closed. `finish`
 *       settled it open correctly and `onClickCapture` — which exists so a row dragged
 *       open does not ALSO register a tap on the row — immediately undid it, because it
 *       could not tell the click that ends the OPENING gesture from a later tap on an
 *       already-open row. So a swipe could never stay open at ANY distance: measured at
 *       60/100/140/180/220/260px, every one sprang back. The thresholds were never
 *       involved, which is why lowering them would have fixed nothing.
 *
 *       Press-and-hold had the same defect one step along: the hold timer settled the
 *       tray open, then the finger lifting ran `finish`, whose `d.x` is still 0, so it
 *       closed it again. Both are now flagged on the gesture (`justOpened` / `heldOpen`)
 *       so the gesture that opened a tray cannot also close it.
 *
 *   (2) ONLY THE DRAGGED SIDE'S ICONS ARE REVEALED. Both trays are always mounted, one
 *       at each edge, and the row covering the other one is all that hid it — so it was
 *       true only while the row happened to be opaque, which (3) shows it was not. It is
 *       structural now: a tray is `visibility: hidden` unless the row has actually moved
 *       to expose it, which also takes its buttons out of hit-testing.
 *
 *   (3) THE ROW WAS 35% TRANSPARENT WHILE BEING DRAGGED, so both sides' pucks and the
 *       app's live background canvas read straight through it — the owner's "the back
 *       buttons above the cover of the message or group become transparent". Measured:
 *       `background-color` resolved to `oklab(0.24 … / 0.35)` mid-drag. The cause is in
 *       the CALLER, not here: a translucent `active:`/`hover:` tint, and `:active` is
 *       true for the whole duration of a pointer drag. Fixed at the call site (opaque
 *       tints) and pinned by a sweep, because a future caller cannot be relied on to
 *       remember and this component cannot see its own row's classes.
 *
 * THE TRAY GEOMETRY IS DERIVED RATHER THAN GUESSED. The open offset used to be a flat
 * `76 * count` while the tray's real width is its padding plus its pucks plus its gaps —
 * 216px for three actions against an offset of 228, so a full drag over-revealed by 12px
 * and showed a strip of whatever sits behind the list. `trayWidth` computes it from the
 * same numbers the classes use, so the reveal is pixel-exact and the two cannot drift.
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

/** Movement before the gesture is claimed from the scroller. */
const CLAIM_PX = 10;
/** Hold this long without moving and the tray opens — the owner's second way in. */
const HOLD_MS = 450;

/* The tray's own geometry, kept beside the classes that must agree with it (`w-[64px]`,
   `gap-1.5`, `px-1.5`). A FRACTION of the width used to decide whether to open, which
   made the 3-action side need twice the drag of the 2-action side for the same gesture —
   part of why the right-hand tray felt broken. It is an absolute distance now: by the
   time we are here the gesture has already been claimed (past CLAIM_PX and mostly
   horizontal), so it is deliberate by construction and only needs to be told apart from
   a drag that came back to where it started. */
const PUCK_W = 64;
const TRAY_GAP = 6;
const TRAY_PAD = 6;
const OPEN_PX = 24;

export function trayWidth(count: number): number {
  return count > 0 ? TRAY_PAD * 2 + count * PUCK_W + (count - 1) * TRAY_GAP : 0;
}

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
  const leftTrayRef = useRef<HTMLDivElement | null>(null);
  const rightTrayRef = useRef<HTMLDivElement | null>(null);
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
    /** The hold timer already settled this gesture — the finger lifting must not re-decide. */
    heldOpen: false,
    /** This gesture just opened a tray, so the click that ends it must not close it. */
    justOpened: false,
  });

  const leftW = trayWidth(left.length);
  const rightW = trayWidth(right.length);

  /** Write the sheet's position AND which side is revealed, without a re-render.
   *
   *  ONE FUNNEL for both, deliberately: every path that moves the row (the live drag,
   *  settling, the hold timer) goes through here, so a side can never be left showing
   *  through from the opposite direction's gesture. */
  const paint = useCallback((x: number, animate: boolean) => {
    const el = sheetRef.current;
    if (el) {
      el.style.transition = animate ? "transform 220ms cubic-bezier(.22,.61,.36,1)" : "none";
      el.style.transform = `translate3d(${x}px,0,0)`;
    }
    // `visibility` rather than opacity: it also removes the hidden side's buttons from
    // hit-testing, so a tap in the revealed gap can never land on the tray behind the row.
    if (leftTrayRef.current) leftTrayRef.current.style.visibility = x > 0 ? "visible" : "hidden";
    if (rightTrayRef.current) rightTrayRef.current.style.visibility = x < 0 ? "visible" : "hidden";
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
    // Cleared here as a backstop: a click always follows its own pointerup, so these are
    // consumed long before another gesture starts — but a stale flag would silently
    // swallow the NEXT tap on the row, so it can never be left set.
    d.heldOpen = false;
    d.justOpened = false;
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
        const dd = drag.current;
        if (!dd.active || dd.claimed) return;
        const side = right.length > 0 ? "right" : left.length > 0 ? "left" : null;
        if (!side) return;
        // The gesture is spent: the tray is open, so neither the finger lifting nor the
        // click that follows it may be read as a decision about this row.
        dd.claimed = true;
        dd.heldOpen = true;
        dd.justOpened = true;
        settle(side);
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
    // The hold timer already decided this gesture. Re-deciding here would read `d.x`,
    // which for a hold is still 0, and close the tray the hold had just opened.
    if (d.heldOpen) return;
    if (!d.claimed) return; // a tap, or a scroll — leave the row alone

    /* STAYS WHERE IT WAS SLID. A full swipe used to RUN the nearest action on a
       single-action side; that is gone, because the owner's ask is the opposite ("the bar
       should stop where you slid it, and you can then click on these buttons") and
       because firing Delete off a gesture with no confirmation is not something to keep
       for the sake of a shortcut nobody asked for. It was also unreachable in practice —
       no side in the app has exactly one action — so removing it changes nothing today
       and removes the hazard for whoever adds a one-action side. */
    const x = d.x;
    const side = x >= OPEN_PX && leftW > 0 ? "left" : x <= -OPEN_PX && rightW > 0 ? "right" : null;
    d.justOpened = side !== null;
    settle(side);
  };

  const tray = (actions: SwipeAction[], side: "left" | "right") => (
    <div
      ref={side === "left" ? leftTrayRef : rightTrayRef}
      className={
        "absolute inset-y-0 flex items-center gap-1.5 px-1.5 " +
        (side === "left" ? "start-0" : "end-0")
      }
      aria-hidden={open !== side}
      /* React owns the SETTLED truth and `paint` overrides it during a drag. Both agree
         at rest, so a re-render while a tray is open cannot hide it, and a re-render
         while it is closed cannot reveal it. */
      style={{
        visibility: open === side ? "visible" : "hidden",
        /* The board's revealed surface (`rgba(255,255,255,.02)`) over an opaque panel, so
           the gap the row leaves behind reads as a tray rather than as a hole onto the
           app's live background canvas. NEVER the `background` shorthand — it resets
           `background-color` to transparent and the fix silently undoes itself while
           looking identical in the source (the v2.106.40 `.rglass` trap). */
        backgroundColor: "var(--card)",
        backgroundImage: "linear-gradient(rgba(255,255,255,.02),rgba(255,255,255,.02))",
      }}
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
            /* GLOSSY AND SHAPED, to the board's own numbers: a 40px squircle at a 13px
               radius (it was a 44px circle), a two-stop tint of the action's own hue, a
               hairline of the same hue and an inner highlight — so it reads as a lit pane
               rather than a flat disc, and the colour survives both themes.
               NO `backdrop-blur`: the surface behind it is opaque now, so a blur per puck
               per row would buy nothing and cost paint on the app's densest scrolling
               list (the v2.99.84 rule). */
            className="grid size-10 place-items-center rounded-[13px] border shadow-lg"
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
        onClickCapture={(e) => {
          /* A row dragged open must not also register the tap that closed it — but the
             click that ENDS the opening drag is part of that same gesture, and closing on
             it is what made a swipe impossible to leave open. Swallow it without
             deciding anything. */
          if (drag.current.justOpened) {
            drag.current.justOpened = false;
            e.preventDefault();
            e.stopPropagation();
            return;
          }
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
