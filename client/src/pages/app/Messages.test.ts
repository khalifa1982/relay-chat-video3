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
  it("the message list has min-h-0 so the composer stays pinned to the bottom", () => {
    // The scroll container must include min-h-0 (the flexbox fix that stops the
    // input from floating into the middle of the screen).
    expect(SRC).toMatch(/flex-1 min-h-0 overflow-y-auto/);
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
});
