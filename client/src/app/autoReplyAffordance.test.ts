/**
 * AUTO-REPLY, LEGIBLE (v2.107.44).
 *
 * The owner's screenshot: the Messages entry point for auto-reply was a mute
 * monochrome StickyNote (a Notes glyph, wrong feature) and the sheet it opened
 * was a bare title over a switch — "look like a black white, doesn't have any
 * explanation." Two fixes, pinned here so they can't quietly revert:
 *   • the entry icon is MessageCircleReply with a live ON status dot, and its
 *     tooltip names the feature rather than saying "Options";
 *   • the sheet leads with an accent icon badge, an emoji, and a one-line lede.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SRC = readFileSync(resolve(__dirname, "../pages/app/Messages.tsx"), "utf8");
const DICT = readFileSync(resolve(__dirname, "dict/messages.ts"), "utf8");

/** The AutoReplyToggle function body only. */
function autoReplyBody(): string {
  const start = SRC.indexOf("function AutoReplyToggle()");
  expect(start).toBeGreaterThan(-1);
  const next = SRC.indexOf("\nfunction ", start + 1);
  return SRC.slice(start, next === -1 ? undefined : next);
}

describe("auto-reply affordance", () => {
  it("the entry icon reads as a reply, not a sticky note", () => {
    const body = autoReplyBody();
    expect(body).toMatch(/<MessageCircleReply className="size-5" \/>/);
    // the auto-reply trigger must not be the Notes glyph anymore
    expect(body).not.toMatch(/<StickyNote/);
  });

  it("the entry button shows a live ON status dot and names the feature", () => {
    const body = autoReplyBody();
    expect(body).toMatch(/\{on && \(/); // dot only when armed
    expect(body).toMatch(/rounded-full bg-primary ring-2 ring-card/);
    expect(body).toMatch(/title=\{t\("msg\.autoReplyTitle"\)\}/); // not "msg.options"
  });

  it("the sheet has an icon badge, an emoji, and a lede", () => {
    const body = autoReplyBody();
    expect(body).toMatch(/grid size-12 place-items-center rounded-2xl bg-primary\/10/);
    expect(body).toMatch(/💬/);
    expect(body).toMatch(/🌙/);
    expect(body).toMatch(/t\("msg\.autoReplyLede"\)/);
  });

  it("the lede string exists in both languages", () => {
    expect(DICT).toMatch(/"msg\.autoReplyLede":/);
    const seg = DICT.slice(DICT.indexOf('"msg.autoReplyLede":'), DICT.indexOf('"msg.autoReplyLede":') + 260);
    expect(seg).toMatch(/en:/);
    expect(seg).toMatch(/ar:/);
    expect(seg).toMatch(/[\u0600-\u06FF]/); // real Arabic, not a copy of the English
  });
});
