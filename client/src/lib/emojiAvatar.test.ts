import { describe, it, expect } from "vitest";
import { AVATAR_EMOJIS, AVATAR_BGS, renderEmojiAvatar } from "./emojiAvatar";

/**
 * v2.99.2 — emoji/character avatars. The rendering itself is canvas-driven
 * (verified headlessly), so here we pin the curated collection + gradient
 * palette and the render contract.
 */
describe("emoji avatar collection", () => {
  it("ships a generous, unique set of characters", () => {
    expect(AVATAR_EMOJIS.length).toBeGreaterThanOrEqual(40);
    expect(new Set(AVATAR_EMOJIS).size).toBe(AVATAR_EMOJIS.length); // no dupes
    // A few staples the owner asked for (happy smileys / characters).
    for (const e of ["😀", "😎", "🥳", "🦄", "🚀"]) {
      expect(AVATAR_EMOJIS).toContain(e);
    }
  });
  it("offers multiple gradient backgrounds, brand teal first", () => {
    expect(AVATAR_BGS.length).toBeGreaterThanOrEqual(6);
    expect(AVATAR_BGS[0]).toMatchObject({ from: "#3FE0C5", to: "#6EE7FF" });
    for (const b of AVATAR_BGS) {
      expect(b.from).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(b.to).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });
  it("renderEmojiAvatar rejects cleanly when no canvas is available (node env)", async () => {
    // jsdom/node has no real canvas; the function must reject, not throw sync.
    await expect(renderEmojiAvatar("😀", AVATAR_BGS[0])).rejects.toBeInstanceOf(Error);
  });
});
