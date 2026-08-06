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
    /* v2.107.32 turned the single-key handler into a small router (Escape +
       the pager's arrow keys); the CONTRACT stays what it was — Escape closes. */
    expect(SRC).toMatch(/if \(e\.key === "Escape"\) onClose\(\);/);
    expect(SRC).toMatch(/aria-label=\{t\("msg\.closePreview"\)\}/);
  });

  it("renders WhatsApp-style date dividers (Today / Yesterday) between days", () => {
    /* REWRITTEN in v2.105.3, to the property rather than the location. This used
       to assert that `dayLabel` was DEFINED IN this file and that a per-message
       `showDay` flag existed — both of which the sticky header deliberately
       removed: the rule now lives in one shared module and the header belongs to a
       per-day <section>. Frozen as it was, it asserted an implementation this
       release replaces while saying nothing about whether dividers appear. */
    expect(SRC).toMatch(/from "@\/app\/messageDays"/);
    expect(SRC).toMatch(/groupMessagesByDay\(/);
    expect(SRC).toMatch(/\{day\.label\}/);
    // …and the labels themselves are behaviourally covered in
    // client/src/pages/app/stickyDayHeader.test.ts against the real function.
  });

  it("groups consecutive same-sender messages (tail only on the last bubble)", () => {
    expect(SRC).toMatch(/sameAsPrev/);
    expect(SRC).toMatch(/lastOfGroup/);
    /* The rounded tail is conditional on being the last of a run — which is the property, and
       the RADIUS is not. This froze `rounded-br-sm` (Tailwind's 2px); board 1d/3c specify a
       5px notch, so the literal moved in v2.106.62 while the grouping rule it stands for did
       not. Matched on the shape of the conditional instead. */
    /* v2.107.40: `br` became `ee` — LOGICAL corners, because the tail marks the
       SPEAKER'S side and in Arabic own bubbles sit on the left. The grouping
       property this pin stands for is unchanged. */
    expect(SRC).toMatch(/lastOfGroup \? "rounded-ee-\[?[\w.]+\]?"/);
    expect(SRC).toMatch(/lastOfGroup \? "rounded-es-\[?[\w.]+\]?"/);
  });

  it("supports in-conversation message search via trpc.messages.search", () => {
    expect(SRC).toMatch(/trpc\.messages\.search\.useQuery/);
    expect(SRC).toMatch(/setSearchOpen/);
  });

  it("persists the composer draft (text + reply target) per conversation", () => {
    /* v2.107.34: the import gained `clearDraft as clearDraftFor` — deleting a
       thread now wipes its local draft in the same confirm, because the
       abandoned text is usually the only reason the thread existed. */
    expect(SRC).toMatch(/import \{ useDraft, clearDraft as clearDraftFor, getDraft, onDraftsChange \} from "@\/app\/draftStore"/);
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
    // v2.99.92 moved both LEDs onto the SHARED `presenceDot` helper — see
    // Contacts.test.ts for why. What matters here is that BOTH dots (the thread row
    // and the conversation header) read the shared rule rather than one of them
    // keeping an inline ternary, which is precisely how they would drift apart.
    expect(SRC).toMatch(/import \{ presenceDot \} from "@\/app\/presenceDot"/);
    const uses = SRC.match(/presenceDot\(\{ isOnline:/g) || [];
    expect(uses.length).toBe(2);
    expect(SRC).toMatch(/presenceDot\(\{ isOnline: t\.peerIsOnline, idle: t\.peerIdle \}\)/);
    expect(SRC).toMatch(/presenceDot\(\{ isOnline: thread\?\.peerIsOnline, idle: thread\?\.peerIdle \}\)/);
  });
  it("the app top bar is hidden on mobile while a conversation is open", () => {
    expect(SRC).toMatch(/relay-convo-open/);
  });
  it("short conversations anchor to the BOTTOM (no dead void above the composer)", () => {
    expect(SRC).toMatch(/space-y-0\.5 bg-background md:bg-card flex flex-col"/);
    expect(SRC).toMatch(/className="mt-auto shrink-0" aria-hidden="true"/);
  });
  it("every bubble's colour comes from the shared rule (v2.99.85 supersedes v2.71)", () => {
    // v2.71 pinned the neutral grey surface for received bubbles. The owner has now
    // asked for the opposite — "the other side should be blue, but if you were in the
    // group each one give him a different colour" — so this pin was asserting exactly
    // what the release had to remove. Rewritten to the stronger property rather than
    // relaxed: no bubble carries a HARD-CODED colour of any kind; all of them are
    // resolved by one function, which is what stops the surfaces drifting apart.
    expect(SRC).toMatch(/style=\{bubbleStyleFor\(\{ mine, isGroup, senderIdentityId: m\.senderIdentityId \}\)\}/);
    expect(SRC).not.toMatch(/bg-muted\/70 text-foreground border-white\/10/);
    expect(SRC).not.toMatch(/bg-\[#2563eb\]/);
  });
  it("emoji-only messages render big without a bubble", () => {
    expect(SRC).toMatch(/function isEmojiOnly/);
    expect(SRC).toMatch(/emojiOnly/);
  });
  it("the conversation header carries the live status line (typing > online > last seen)", () => {
    /* REWRITTEN (v2.106.40). This froze the exact condition `typers.length > 0 ? (`, so
       narrowing the header's typing arm to a 1:1 turned it red while saying nothing about the
       precedence it stands for. In a GROUP the arm fired at the same time as `TypingLine`
       AND dropped "5 members · 3 online" the moment anybody typed — so a group header lost
       its own size to repeat something already on screen, and `TypingLine` is the better of
       the two because it names WHO and colours them per person.
       THE PROPERTY is the ORDERING: typing outranks presence, and last-seen is the fallback
       when neither. */
    const at = SRC.indexOf("{typers.length > 0");
    expect(at).toBeGreaterThan(-1);
    /* Bounded by the ternary chain's OWN last arm rather than by a fixed character
       count: the 1,800-char window went stale the moment the group arm grew, which is
       the recurring fixed-slice fragility (v2.99.78 and its recurrences). */
    const end = SRC.indexOf('t("msg.offline")', at);
    expect(end).toBeGreaterThan(at);
    const line = SRC.slice(at, end);
    expect(line, "typing is the first arm").toMatch(/^\{typers\.length > 0[^?]*\? \(/);
    /* Anchored on the KEYS, not the words. Both are dictionary entries now, and an
       ordering assertion whose anchors are copy answers -1 once the screen is
       translated — which `<` then satisfies vacuously, so this would keep passing with
       the precedence inverted (the negative-index trap, v2.99.78 / v2.106.65). */
    const iTyping = line.indexOf('t("msg.typingNow")');
    const iSeen = line.indexOf('t("msg.lastSeen"');
    expect(iTyping).toBeGreaterThan(-1);
    expect(iSeen).toBeGreaterThan(-1);
    expect(iTyping < iSeen, "presence/last-seen is a LATER arm, so typing wins").toBe(true);
    // The stamp still goes INSIDE the sentence rather than being glued after it.
    /* The stamp still goes INSIDE the sentence rather than being glued to it, which
       is the property. v2.106.98 added the locale, because the >1-week fallback is a
       DATE and was formatting in the browser's language rather than the app's. */
    expect(SRC).toMatch(/t\("msg\.lastSeen", \{ when: timeAgo\(t, thread\.peerLastSeenAt, locale\) \}\)/);
  });
  it("the message ⋮ menu opens toward the screen INTERIOR, never off the edge (v2.99.0)", () => {
    /* Own messages (justify-end) put the ⋮ at the row's far START, so the menu must
       grow toward the interior; received grow the other way. The old REVERSED mapping
       clipped the menu off the edge on wide own bubbles (voice notes).

       LOGICAL as of #156's RTL pass, and this one is not cosmetic: `left-0` is a fixed
       side, so in Arabic — where the whole row mirrors — it would grow toward the edge
       the menu is trying to avoid, i.e. it would reinstate the exact v2.99.0 clipping in
       the other language. `start-0`/`end-0` follow the row. */
    expect(SRC).toMatch(/\(mine \? "start-0" : "end-0"\)/);
    expect(SRC).not.toMatch(/\(mine \? "end-0" : "start-0"\)/);
    expect(SRC).not.toMatch(/\(mine \? "(left|right)-0"/);
  });
});
