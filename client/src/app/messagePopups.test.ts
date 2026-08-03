import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

async function fresh() {
  vi.resetModules();
  return await import("./messagePopups");
}

afterEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window;
  delete (globalThis as unknown as { document?: unknown }).document;
});

describe("messagePopups store", () => {
  it("queues a popup", async () => {
    const s = await fresh();
    s.pushMessagePopup(1, 10);
    expect(s.getMessagePopups().map((p) => p.conversationId)).toEqual([1]);
  });

  it("de-dupes by conversation (keeps one, most recent)", async () => {
    const s = await fresh();
    s.pushMessagePopup(1, 10);
    s.pushMessagePopup(2, 20);
    s.pushMessagePopup(1, 11); // same conversation → replaces, moves to end
    const ids = s.getMessagePopups().map((p) => p.conversationId);
    expect(ids).toEqual([2, 1]);
    expect(s.getMessagePopups()).toHaveLength(2);
  });

  it("caps the stack at 3", async () => {
    const s = await fresh();
    for (let c = 1; c <= 5; c++) s.pushMessagePopup(c, c);
    const ids = s.getMessagePopups().map((p) => p.conversationId);
    expect(ids).toEqual([3, 4, 5]);
  });

  it("dismisses one conversation", async () => {
    const s = await fresh();
    s.pushMessagePopup(1, 10);
    s.pushMessagePopup(2, 20);
    s.dismissMessagePopup(1);
    expect(s.getMessagePopups().map((p) => p.conversationId)).toEqual([2]);
  });

  it("clears all popups", async () => {
    const s = await fresh();
    s.pushMessagePopup(1, 10);
    s.pushMessagePopup(2, 20);
    s.clearMessagePopups();
    expect(s.getMessagePopups()).toEqual([]);
  });
});

describe("isViewingConversation", () => {
  function setLoc(pathname: string, search: string, visible = true) {
    (globalThis as unknown as { window?: unknown }).window = { location: { pathname, search } };
    (globalThis as unknown as { document?: unknown }).document = {
      visibilityState: visible ? "visible" : "hidden",
    };
  }

  it("is true when the messages tab shows that conversation and is visible", async () => {
    const s = await fresh();
    setLoc("/app/messages", "?c=42");
    expect(s.isViewingConversation(42)).toBe(true);
  });

  it("is false for a different conversation", async () => {
    const s = await fresh();
    setLoc("/app/messages", "?c=7");
    expect(s.isViewingConversation(42)).toBe(false);
  });

  it("is false when not on the messages tab", async () => {
    const s = await fresh();
    setLoc("/app/dialer", "?c=42");
    expect(s.isViewingConversation(42)).toBe(false);
  });

  it("is false when the tab is hidden (in a call elsewhere)", async () => {
    const s = await fresh();
    setLoc("/app/messages", "?c=42", false);
    expect(s.isViewingConversation(42)).toBe(false);
  });
});

/**
 * THE IN-PAGE CARD WAS THE ONE MESSAGE SURFACE THE GROUP LOCK DID NOT REACH.
 *
 * The card carries the group's title, the sender's avatar and a preview of what
 * they said, with an inline reply box under it. The lock's own scenario is *"I hand
 * my phone to someone with the app open"* — so this is the surface it is most
 * about, and it was the only one not consulting it: the thread list already
 * redacts a hidden row (`isGroupHidden` at Messages.tsx), and the notification
 * paths do too.
 *
 * SUPPRESSED rather than redacted, unlike the push. A push is the only signal a
 * closed app gets, so dropping one drops the message and the worker shows a
 * nameless banner instead. In-page nothing is lost — the thread row still updates
 * with its own redacted preview and unread count.
 */
describe("visibleMessagePopups — a locked group gets no card", () => {
  const cards = (ids: number[]) => ids.map((conversationId, i) => ({ id: i + 1, conversationId, from: 99 }));

  it("drops the hidden conversations and keeps the rest, in order", async () => {
    const { visibleMessagePopups } = await fresh();
    const hidden = new Set([2, 4]);
    const out = visibleMessagePopups(cards([1, 2, 3, 4, 5]), (c) => hidden.has(c));
    expect(out.map((p) => p.conversationId)).toEqual([1, 3, 5]);
  });

  it("hides everything when everything is locked", async () => {
    const { visibleMessagePopups } = await fresh();
    expect(visibleMessagePopups(cards([1, 2]), () => true)).toEqual([]);
  });

  it("changes nothing when no group is locked", async () => {
    const { visibleMessagePopups } = await fresh();
    const input = cards([7, 8]);
    expect(visibleMessagePopups(input, () => false)).toEqual(input);
  });

  it("fails toward SHOWING when the lock store cannot be read", async () => {
    // `groupLock` fails toward NOT locked for the same reason, and a card that
    // silently never appears is the harder failure to notice.
    const { visibleMessagePopups } = await fresh();
    const out = visibleMessagePopups(cards([1, 2]), () => {
      throw new Error("localStorage unavailable");
    });
    expect(out.map((p) => p.conversationId)).toEqual([1, 2]);
  });

  it("does not mutate the queue it was given", async () => {
    const { visibleMessagePopups } = await fresh();
    const input = cards([1, 2, 3]);
    visibleMessagePopups(input, (c) => c === 2);
    expect(input.map((p) => p.conversationId)).toEqual([1, 2, 3]);
  });
});

describe("both places a card and a lock can meet", () => {
  const read = (p: string) =>
    readFileSync(new URL(p, import.meta.url).pathname, "utf8")
      .split("\n")
      .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
      .join("\n");

  it("nothing is QUEUED for a group already hidden", async () => {
    // The queue holds three, so a card nobody will ever see would push out one
    // they would.
    const rt = read("./useRealtime.ts");
    expect(rt).toMatch(/!isGroupHidden\(payload\.conversationId\)/);
    expect(rt).toMatch(/import \{ isGroupHidden \} from "\.\/groupLock"/);
  });

  it("and the render filters again, for a group locked while its card is up", async () => {
    const ui = read("./MessagePopups.tsx");
    expect(ui).toMatch(/visibleMessagePopups\(all, isGroupHidden, \{ appLocked \}\)/);
    // Without this the component never re-renders on a lock change and the card
    // stays on screen until something else happens to update it.
    expect(ui).toMatch(/useGroupLocks\(\)/);
  });
});

/**
 * THE CARD OUTLIVED THE DEVICE PASSCODE.
 *
 * `<MessagePopups/>` is mounted in `App.tsx` as a sibling of `<Router/>` —
 * deliberately, so a card survives tab navigation. That also puts it OUTSIDE
 * `PasscodeGate`, which locks by swapping ITS OWN children for the lock screen
 * (`if (!locked) return <>{children}</>; return <LockScreen/>`).
 *
 * So `useRealtime` — which lives in `AppShell`, inside the gate — stops, and no NEW
 * card is queued while locked. But the queue is MODULE state and the component is
 * still mounted and still rendering, at `position: fixed; z-[80]`, over a lock
 * screen whose root sets no z-index at all. Profile has a "Lock now" button, so:
 *
 *   a message arrives → its card appears → the user taps Lock → the card stays on
 *   screen above the lock, with the sender's name, the message preview, and a
 *   working reply box.
 *
 * That is the entirety of what the passcode exists to cover, sitting on top of it.
 */
describe("visibleMessagePopups — the app passcode outranks every card", () => {
  const cards = (ids: number[]) => ids.map((conversationId, i) => ({ id: i + 1, conversationId, from: 99 }));

  it("shows nothing at all while the device is locked", async () => {
    const { visibleMessagePopups } = await fresh();
    expect(visibleMessagePopups(cards([1, 2, 3]), () => false, { appLocked: true })).toEqual([]);
  });

  it("the lock outranks the per-group rule, not the other way round", async () => {
    // Even a conversation nothing else is hiding is covered.
    const { visibleMessagePopups } = await fresh();
    expect(visibleMessagePopups(cards([7]), () => false, { appLocked: true })).toEqual([]);
  });

  it("unlocking brings the card back — suppressed, not discarded", async () => {
    // Somebody who locked mid-conversation expects to find it again.
    const { visibleMessagePopups } = await fresh();
    const input = cards([4, 5]);
    expect(visibleMessagePopups(input, () => false, { appLocked: true })).toEqual([]);
    expect(visibleMessagePopups(input, () => false, { appLocked: false })).toEqual(input);
  });

  it("an absent option means unlocked, so every existing caller is unchanged", async () => {
    const { visibleMessagePopups } = await fresh();
    const input = cards([1]);
    expect(visibleMessagePopups(input, () => false)).toEqual(input);
    expect(visibleMessagePopups(input, () => false, {})).toEqual(input);
  });

  it("the component actually asks — it is the only thing standing between the two", async () => {
    const ui = readFileSync(new URL("./MessagePopups.tsx", import.meta.url).pathname, "utf8");
    expect(ui).toMatch(/const appLocked = useLocked\(\)/);
    expect(ui).toMatch(/visibleMessagePopups\(all, isGroupHidden, \{ appLocked \}\)/);
    expect(ui).toMatch(/import \{ useLocked \} from "\.\/passcode"/);
  });

  it("and the gate really does render ONLY the lock screen, which is why this is needed", () => {
    // If the gate rendered its children behind an overlay instead, the mount point
    // would not matter — this test records which of the two it is.
    const gate = readFileSync(new URL("./PasscodeGate.tsx", import.meta.url).pathname, "utf8");
    expect(gate).toMatch(/if \(!locked\) return <>\{children\}<\/>;\s*\n\s*return <LockScreen \/>;/);
  });
});
