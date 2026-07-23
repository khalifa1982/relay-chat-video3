import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * v2.42 messaging overhaul — static guards for the layout/UX fixes so they
 * can't silently regress (the component itself isn't booted; these pin the
 * invariants in the source).
 */
const SRC = fs.readFileSync(path.resolve(__dirname, "Messages.tsx"), "utf8");

describe("Messages.tsx — messaging overhaul", () => {
  it("the message list stays pinned to the bottom (composer never gets pushed down)", () => {
    // The scroll area's wrapper is `relative flex flex-col flex-1 min-h-0` and
    // the scroll div itself is an in-flow `flex-1 min-h-0` child — NOT
    // `position:absolute`. A relative wrapper whose ENTIRE content is
    // position:absolute children has no in-flow box for Safari to compute a
    // flex-grow height against, which collapsed the whole message area to
    // near-zero height (composer floated mid-screen with the keypad/footer
    // pushed down by a stray ~112px gap). Regression-tested: do not go back to
    // "relative flex-1 min-h-0" + "absolute inset-0" for the scroll div.
    expect(SRC).toMatch(/className="relative flex flex-col flex-1 min-h-0"/);
    expect(SRC).toMatch(/className="flex-1 min-h-0 overflow-y-auto px-3 md:px-5 py-4 space-y-0\.5/);
    expect(SRC).not.toMatch(/className="absolute inset-0 overflow-y-auto/);
  });

  it("page root fills the shell with flex-1 (NOT h-full) and no negative-margin hacks — height:100% doesn't resolve against the flex-derived scroll-container height (short conversations collapsed upward, leaving a void above the in-flow tab bar), and a historical -mb-28 hack once hid the composer behind the old fixed nav", () => {
    expect(SRC).toMatch(/className="flex-1 flex md:p-6 gap-0 md:gap-6 min-h-0"/);
    expect(SRC).not.toMatch(/className="h-full flex md:p-6/);
    expect(SRC).not.toMatch(/className="[^"]*-mb-28/);
  });

  it("messages use a three-dot context menu (not hover-only buttons)", () => {
    expect(SRC).toMatch(/function MessageMenu/);
    expect(SRC).toMatch(/<MessageMenu/);
    expect(SRC).toMatch(/MoreVertical/);
  });

  it("the three-dot menu offers Reply and Unsend", () => {
    expect(SRC).toMatch(/Reply/);
    expect(SRC).toMatch(/Unsend/);
  });

  it("attachments open a fullscreen MediaLightbox (not a new tab)", () => {
    expect(SRC).toMatch(/function MediaLightbox/);
    expect(SRC).toMatch(/<MediaLightbox/);
    // image attachments are a button that calls onOpen (no target=_blank tab)
    expect(SRC).toMatch(/onOpen\?\.\(\{ url, type: "image"/);
  });

  it("the lightbox is dismissible (Escape + close button)", () => {
    expect(SRC).toMatch(/e\.key === "Escape" && onClose/);
    expect(SRC).toMatch(/aria-label="Close preview"/);
  });

  it("renders WhatsApp-style date dividers (Today / Yesterday) between days", () => {
    expect(SRC).toMatch(/function dayLabel/);
    expect(SRC).toMatch(/"Today"/);
    expect(SRC).toMatch(/"Yesterday"/);
    // a divider is inserted when the calendar day changes
    expect(SRC).toMatch(/const showDay =/);
  });

  it("groups consecutive same-sender messages (tail only on the last bubble)", () => {
    expect(SRC).toMatch(/sameAsPrev/);
    expect(SRC).toMatch(/lastOfGroup/);
    // the rounded tail is conditional on being the last of a run
    expect(SRC).toMatch(/lastOfGroup \? "rounded-br-sm"/);
  });

  it("supports in-conversation message search via trpc.messages.search", () => {
    expect(SRC).toMatch(/trpc\.messages\.search\.useQuery/);
    expect(SRC).toMatch(/setSearchOpen/);
  });

  it("persists the composer draft (text + reply target) per conversation", () => {
    expect(SRC).toMatch(/import \{ useDraft \} from "@\/app\/draftStore"/);
    expect(SRC).toMatch(/useDraft\(conversationId\)/);
  });

  it("supports pasting an image/video straight into the composer", () => {
    expect(SRC).toMatch(/function handlePaste/);
    expect(SRC).toMatch(/onPaste=\{handlePaste\}/);
  });

  it("shows a scroll-to-bottom button when scrolled away from the latest message", () => {
    expect(SRC).toMatch(/showScrollButton/);
    expect(SRC).toMatch(/function scrollToBottom/);
  });
});

describe("Messages.tsx — v2.69 WhatsApp-grade reliability", () => {
  it("a failed send restores the text/reply/attachment (never silently lost)", () => {
    expect(SRC).toMatch(/await sendMutation\.mutateAsync/);
    expect(SRC).toMatch(/setText\(body\);[\s\S]*?toast\.error\(/);
  });
  it("auto-scroll only fires when near the bottom or the thread changed", () => {
    expect(SRC).toMatch(/threadChanged \|\| fromBottom <= 150/);
  });
  it("read receipts are gated on visible + near-bottom", () => {
    expect(SRC).toMatch(/document\.visibilityState !== "visible"\) return;[\s\S]*?markReadMutation\.mutate/);
    expect(SRC).toMatch(/nearBottom/);
  });
  it("thread-list preview labels attachment-only messages instead of a bare dash", () => {
    expect(SRC).toMatch(/previewOf\(t\.lastMessageKind/);
    expect(SRC).not.toMatch(/\{t\.lastMessageBody \|\| "—"\}/);
  });
  it("thread list surfaces an error+retry state (not blank-forever)", () => {
    expect(SRC).toMatch(/threads\.isError \?/);
    expect(SRC).toMatch(/threads\.refetch\(\)/);
  });
});

describe("Messages.tsx — v2.71 iMessage-grade chat UI", () => {
  it("thread list shows a live typing… state (one store subscription for the list)", () => {
    expect(SRC).toMatch(/useTypingConversations/);
    expect(SRC).toMatch(/typingConvos\.includes\(t\.conversationId\)/);
    expect(SRC).toMatch(/typing…/);
  });
  it("presence LEDs: green online, GREY offline (list + conversation header)", () => {
    // v2.88: offline LEDs standardized on var(--relay-offline) — red read as
    // "busy/error", and amber now means "on a call" elsewhere in the app.
    const offline = SRC.match(/bg-\[color:var\(--relay-offline\)\]/g) || [];
    expect(offline.length).toBeGreaterThanOrEqual(2);
    const online = SRC.match(/bg-\[color:var\(--relay-online\)\]/g) || [];
    expect(online.length).toBeGreaterThanOrEqual(2);
  });
  it("the app top bar is hidden on mobile while a conversation is open", () => {
    expect(SRC).toMatch(/relay-convo-open/);
  });
  it("short conversations anchor to the BOTTOM (no dead void above the composer)", () => {
    expect(SRC).toMatch(/space-y-0\.5 bg-background md:bg-card flex flex-col"/);
    expect(SRC).toMatch(/className="mt-auto shrink-0" aria-hidden="true"/);
  });
  it("received bubbles use the neutral glassy surface, not the old hard-coded blue", () => {
    expect(SRC).toMatch(/bg-muted\/70 text-foreground border-white\/10/);
    expect(SRC).not.toMatch(/bg-\[#2563eb\]/);
  });
  it("emoji-only messages render big without a bubble", () => {
    expect(SRC).toMatch(/function isEmojiOnly/);
    expect(SRC).toMatch(/emojiOnly/);
  });
  it("the conversation header carries the live status line (typing > online > last seen)", () => {
    expect(SRC).toMatch(/typers\.length > 0 \? \(/);
    expect(SRC).toMatch(/last seen \{timeAgo\(thread\.peerLastSeenAt\)\}/);
  });
  it("the message ⋮ menu opens toward the screen INTERIOR, never off the edge (v2.99.0)", () => {
    // Own messages (justify-end) put the ⋮ at the far LEFT of the row, so the
    // menu must grow rightward (left-0); received grow leftward (right-0). The
    // old reversed mapping clipped the menu off the left edge on wide own
    // bubbles (voice notes). Pin the corrected direction.
    expect(SRC).toMatch(/\(mine \? "left-0" : "right-0"\)/);
    expect(SRC).not.toMatch(/\(mine \? "right-0" : "left-0"\)/);
  });
});
