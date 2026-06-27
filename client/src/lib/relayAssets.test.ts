import { describe, it, expect } from "vitest";
import { RELAY_CSS, RELAY_MARKUP } from "./relayAssets";

/**
 * Regression guards for two live-call fixes (v2.32):
 *  - Multi-party camera: the audio-only tile must hide its <video> with
 *    `visibility:hidden`, NEVER `display:none`. LiveKit's adaptiveStream pauses
 *    inbound video for any element whose computed `display` is none, so a
 *    display:none here stalls remote cameras when audio subscribes before video
 *    (common with 3+ parties). Pin it so it can't regress.
 *  - Mobile screen share: the button must NOT be blanket-hidden on phones; it's
 *    capability-gated in JS instead. And it must default to hidden in markup.
 */
describe("relay call UI regression guards", () => {
  it("audio-only tile hides its video with visibility:hidden, not display:none", () => {
    const rule = RELAY_CSS.match(/\.relay-tile\.audio-only video\{([^}]*)\}/);
    expect(rule, "the .audio-only video rule must exist").toBeTruthy();
    const decls = rule![1];
    expect(decls).toContain("visibility:hidden");
    expect(decls).not.toContain("display:none");
  });

  it("does NOT blanket-hide #screenBtn on small screens (it's JS capability-gated)", () => {
    // No media-query rule that force-hides the screen-share button.
    expect(RELAY_CSS).not.toMatch(/@media[^{]*\{[^}]*#screenBtn\s*\{\s*display:\s*none/);
  });

  it("screen-share button defaults to display:none in markup (revealed only when supported)", () => {
    const btn = RELAY_MARKUP.match(/<button[^>]*id="screenBtn"[^>]*>/);
    expect(btn, "#screenBtn must exist").toBeTruthy();
    expect(btn![0]).toMatch(/style="display:none"/);
  });

  it("the mobile control bar can wrap so an extra button is never clipped", () => {
    // Some .ctrl-bar rule (the narrow-phone override) must allow wrapping.
    expect(RELAY_CSS).toMatch(/\.ctrl-bar\{[^}]*flex-wrap:wrap/);
  });
});
