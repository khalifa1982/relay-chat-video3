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

  // ── active-speaker / spotlight view (v2.35) ────────────────────────────────
  it("video tiles are clickable (cursor:pointer) so users can spotlight them", () => {
    expect(RELAY_CSS).toMatch(/\.relay-tile\{[^}]*cursor:pointer/);
  });

  it("the spotlighted tile gets a visible accent ring", () => {
    expect(RELAY_CSS).toMatch(/\.relay-tile\.is-spotlight\{[^}]*box-shadow/);
  });

  it("the active speaker tile gets a speaking outline", () => {
    expect(RELAY_CSS).toMatch(/\.relay-tile\.speaking\{[^}]*outline/);
  });

  it("a screen-share tile letterboxes its video (object-fit:contain, never cropped)", () => {
    expect(RELAY_CSS).toMatch(/\.relay-tile\.screen video\{[^}]*object-fit:contain/);
  });

  // ── dismissible add-person pad (v2.38) ─────────────────────────────────────
  it("the in-call add-person pad has a visible close (X) control", () => {
    expect(RELAY_MARKUP).toMatch(/id="addClose"/);
    expect(RELAY_CSS).toMatch(/#addClose\{/);
  });

  // ── tile enrichment (v2.39) ────────────────────────────────────────────────
  it("cam-off tiles show a full-name label under the avatar", () => {
    expect(RELAY_CSS).toMatch(/\.relay-tile \.ph-name\{/);
  });
  it("tiles carry a device + speed info chip", () => {
    expect(RELAY_CSS).toMatch(/\.relay-tile \.tile-info\{/);
  });
  it("the active speaker pulses (motion-gated)", () => {
    expect(RELAY_CSS).toMatch(/@keyframes relaySpeakPulse/);
    expect(RELAY_CSS).toMatch(/prefers-reduced-motion: no-preference/);
  });

  // ── host controls (v2.41) ──────────────────────────────────────────────────
  it("has a host-controls button + panel with mute-all / grid actions", () => {
    expect(RELAY_MARKUP).toMatch(/id="hostBtn"/);
    expect(RELAY_MARKUP).toMatch(/id="hostPanel"/);
    expect(RELAY_MARKUP).toMatch(/id="muteAllBtn"/);
    expect(RELAY_MARKUP).toMatch(/id="gridBtn"/);
  });
  it("styles the Host/Co-Host role badge on tiles", () => {
    expect(RELAY_CSS).toMatch(/\.role-badge\{/);
  });

  // ── audio output picker (v2.43) ────────────────────────────────────────────
  it("has an audio-output button + menu (speaker / earpiece / Bluetooth)", () => {
    expect(RELAY_MARKUP).toMatch(/id="audioBtn"/);
    expect(RELAY_MARKUP).toMatch(/id="audioMenu"/);
    expect(RELAY_CSS).toMatch(/\.audio-menu\{/);
  });

  // ── flag + Picture-in-Picture (v2.44) ──────────────────────────────────────
  it("styles a country-flag tag beside the tile name", () => {
    expect(RELAY_CSS).toMatch(/\.nm-flag/);
  });
  it("has a Picture-in-Picture button", () => {
    expect(RELAY_MARKUP).toMatch(/id="pipBtn"/);
  });
});
