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
    // The scroll area's parent is a flex-1 min-h-0 box; the actual scroll div
    // fills it via absolute inset-0 — fully decoupled from flex sizing, so its
    // content height can never push the composer around.
    expect(SRC).toMatch(/className="relative flex-1 min-h-0"/);
    expect(SRC).toMatch(/className="absolute inset-0 overflow-y-auto/);
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
