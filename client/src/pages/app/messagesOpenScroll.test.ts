/**
 * Open-at-last-read scroll — the regression pins (2026-08-08).
 *
 * The owner's report was "opening a chat shows the very first, oldest message; you have
 * to scroll down." Three independent defects each produced exactly that, and each is
 * pinned here because none can be asserted by reading behaviour without a real DOM:
 *
 *   1. THE ORPHANED REF. `scrollRef` was declared and used in six places but never
 *      attached to the scroll container, so `scrollRef.current` was always null, every
 *      scroll effect hit `if (!el) return`, and the thread was never positioned — it sat
 *      at the default top. This is the one that matters most: a missing `ref={scrollRef}`
 *      silently disables the entire feature.
 *   2. WAITING FOREVER. The open-scroll required the frozen unread count, which stays
 *      null on a cold inbox or a notification deep-link — so even with the ref wired it
 *      would never fire. It must default to the NEWEST when the boundary is unknown.
 *   3. WRONG ANCESTOR. It positioned with `scrollIntoView`, which scrolls whichever
 *      ancestor is nearest and could leave THIS container untouched. It must set
 *      `scrollTop` on the container itself, container-relative.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SRC = readFileSync(
  resolve(__dirname, "../../pages/app/Messages.tsx"),
  "utf8",
);

describe("the message scroll container is actually wired to scrollRef", () => {
  it("the overflow-y-auto message list carries ref={scrollRef} — without it nothing scrolls", () => {
    // The container that holds the message map + the unread divider. If this ref is ever
    // dropped again, the thread reverts to opening at the oldest message.
    expect(SRC).toMatch(
      /ref=\{scrollRef\}\s*\n\s*className="flex-1 min-h-0 overflow-y-auto[^"]*flex flex-col"/,
    );
  });

  it("scrollRef is declared once and used to drive positioning", () => {
    expect(SRC).toMatch(/const scrollRef = useRef<HTMLDivElement>\(null\)/);
  });
});

describe("the open-scroll never leaves the thread at the top", () => {
  it("defaults to the NEWEST (scrollHeight) when there is no unread target", () => {
    // The all-read case AND the deep-link case (boundary not yet loaded) both land here.
    expect(SRC).toMatch(/box\.scrollTop = box\.scrollHeight; \/\/ newest/);
  });

  it("does NOT gate the open-scroll on the frozen unread count being known", () => {
    // The defect was `if (!data || data.length === 0 || openUnread === null) return;`.
    // The count may never resolve (deep-link), so it must not block positioning.
    const openScroll = SRC.slice(SRC.indexOf("SCROLL ON OPEN"));
    expect(openScroll).not.toMatch(/openUnread === null\) return/);
  });

  it("positions the container itself, container-relative (not the nearest ancestor)", () => {
    expect(SRC).toMatch(
      /row\.getBoundingClientRect\(\)\.top - box\.getBoundingClientRect\(\)\.top/,
    );
    // And the write is to the container's own scrollTop, so no ancestor is guessed at.
    expect(SRC).toMatch(/box\.scrollTop = Math\.max\(0, box\.scrollTop \+ delta - 60\)/);
  });
});

describe("re-assertion survives late layout but yields to the user", () => {
  it("re-applies the target across a few frames (a late photo can't drag it away)", () => {
    expect(SRC).toMatch(/openScrollRafRef\.current = requestAnimationFrame\(tick\)/);
  });

  it("stops the moment a REAL user gesture happens, not on our own scroll writes", () => {
    expect(SRC).toMatch(/if \(userScrolledRef\.current \|\| frames\+\+ > 8\)/);
    // Flipped by wheel / touch / key — never by the programmatic scrollTop writes, which
    // also fire a scroll event and would otherwise cancel re-assertion on frame one.
    expect(SRC).toMatch(/addEventListener\("wheel", onUserIntent/);
    expect(SRC).toMatch(/addEventListener\("touchmove", onUserIntent/);
    expect(SRC).toMatch(/const userScrolledRef = useRef\(false\)/);
  });
});

describe("the unread divider still renders at the boundary", () => {
  it("draws the divider above the first-unread message with its count", () => {
    expect(SRC).toMatch(/m\.id === firstUnreadId &&/);
    expect(SRC).toMatch(/msg\.unreadDivider"\)\.replace\("\{n\}", String\(openUnread \?\? 0\)\)/);
  });
});
