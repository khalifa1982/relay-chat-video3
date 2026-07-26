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

  // ── cross-browser call bar hardening (v2.69) ───────────────────────────────
  it("control bar has a no-backdrop-filter fallback + reduced-transparency path", () => {
    expect(RELAY_CSS).toMatch(/@supports not \(\(backdrop-filter:blur\(1px\)\)[\s\S]*?\.ctrl-bar\{background:/);
    expect(RELAY_CSS).toMatch(/@media \(prefers-reduced-transparency:reduce\)[\s\S]*?\.ctrl-bar/);
  });
  it("control-bar blur is capped on mobile (Android GPU cost)", () => {
    expect(RELAY_CSS).toMatch(/@media \(max-width:768px\)\{[\s\S]*?\.ctrl-bar[\s\S]*?backdrop-filter:blur\(10px\)/);
  });
  it("safe-area padding lives on the base .controls rule (so viewport-fit engages it everywhere)", () => {
    expect(RELAY_CSS).toMatch(/\.controls\{[^}]*padding:18px 16px max\(22px,env\(safe-area-inset-bottom\)\)/);
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
  it("a cam-off tile shows the AVATAR only — the name is not repeated there", () => {
    // REWRITTEN in v2.99.82. This pinned `.relay-tile .ph-name{`, i.e. the centred
    // full name under the avatar — which the owner asked twice to remove, having
    // circled all three renderings of one name on a screenshot. The name now
    // appears exactly ONCE per tile, in the bottom band.
    expect(RELAY_CSS).not.toMatch(/\.ph-name/);
    // The avatar itself is still there, so a camera-off tile is never a blank box.
    expect(RELAY_CSS).toMatch(/\.relay-tile \.ph \.av\{/);
    // The band, and the digits beside the name.
    expect(RELAY_CSS).toMatch(/\.relay-tile \.nm\{/);
    expect(RELAY_CSS).toMatch(/\.relay-tile \.nm \.nm-pin\{/);
  });

  it("the stylesheet contains no backtick — it IS a template literal", () => {
    // This has broken the build twice (v2.99.16, and again while writing v2.99.82):
    // a backtick inside a CSS comment terminates the literal. `pnpm check` catches
    // it, but only as a confusing cascade of syntax errors 300 lines away, so name
    // the real rule here.
    expect(RELAY_CSS).not.toContain("`");
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

  // ── v2.45 refinements ──────────────────────────────────────────────────────
  it("speaking tiles show a colourful sound-wave equaliser", () => {
    expect(RELAY_CSS).toMatch(/@keyframes relayWave/);
    expect(RELAY_CSS).toMatch(/\.sound-wave/);
  });
  it("the mobile chat close button moves off the End-call corner (order:-1)", () => {
    expect(RELAY_CSS).toMatch(/\.chat-head \.chat-close-btn\{order:-1\}/);
  });
  it("the call-waiting popup shows caller details + Answer/Reject", () => {
    expect(RELAY_MARKUP).toMatch(/id="cwNum"/);
    expect(RELAY_MARKUP).toMatch(/id="cwFlag"/);
    expect(RELAY_MARKUP).toMatch(/>Answer</);
    expect(RELAY_MARKUP).toMatch(/>Reject</);
  });
  it("has an on-hold tile badge", () => {
    expect(RELAY_CSS).toMatch(/\.relay-tile\.on-hold::after/);
  });

  // ── v2.45.1 tile-chrome fixes ──────────────────────────────────────────────
  it("the device/speed chip sits at the TOP (not bottom) so it can't overlap the name", () => {
    expect(RELAY_CSS).toMatch(/\.tile-info\{[^}]*top:11px/);
    expect(RELAY_CSS).not.toMatch(/\.tile-info\{[^}]*bottom:11px/);
  });
  it("the name label is width-capped and truncates", () => {
    expect(RELAY_CSS).toMatch(/\.relay-tile \.nm\{[^}]*max-width/);
    expect(RELAY_CSS).toMatch(/\.nm \.nm-text\{[^}]*text-overflow:ellipsis/);
  });

  // ── per-tile host menu (v2.47) ─────────────────────────────────────────────
  it("has a per-tile host ⋮ menu (shown only when moderating) + a shared menu", () => {
    expect(RELAY_CSS).toMatch(/\.tile-menu-btn\{/);
    expect(RELAY_CSS).toMatch(/#videoGrid\.mod-on .relay-tile:not\(\.you\) \.tile-menu-btn/);
    expect(RELAY_MARKUP).toMatch(/id="tileMenu"/);
    expect(RELAY_MARKUP).toMatch(/id="tmActs"/);
  });

  // ── add-person keypad (v2.49) ──────────────────────────────────────────────
  it("the add-person window has an on-screen keypad container", () => {
    expect(RELAY_MARKUP).toMatch(/id="addKeys"/);
    expect(RELAY_CSS).toMatch(/\.addpad-keys\{[^}]*grid-template-columns:repeat\(3,1fr\)/);
    expect(RELAY_CSS).toMatch(/\.addpad-key\{/);
  });
  it("tells the user the invite fires automatically (no Add click needed)", () => {
    expect(RELAY_MARKUP).toMatch(/class="addpad-hint"/);
    expect(RELAY_MARKUP).toMatch(/automatically/i);
  });

  // ── centered popups must not overflow on mobile (v2.50.1) ──────────────────
  // These open with `animation:relayFade … both`, whose final keyframe is
  // `transform:none` — which WIPES a `translateX(-50%)` centering transform and
  // shoves the panel off the right edge. They must center via auto margins
  // instead, and clamp width to the viewport.
  for (const sel of ["addpad", "filter-dock", "tile-menu"]) {
    it(`.${sel} centers via auto margins (not a relayFade-clobbered transform) and clamps width`, () => {
      const rule = RELAY_CSS.match(new RegExp(`\\.relay-root \\.${sel}\\{([^}]*)\\}`));
      expect(rule, `.${sel} rule must exist`).toBeTruthy();
      const decls = rule![1];
      expect(decls).toMatch(/margin-inline:auto/);
      expect(decls).not.toMatch(/transform:translateX\(-50%\)/);
      expect(decls).toMatch(/width:min\(/);
    });
  }

  // ── host-panel layout + per-action accents (v2.99.3) ──────────────────────
  // Owner screenshot: the old single inline row overflowed the 280px panel and
  // clipped "Remove" off the edge. Rows now STACK (name over actions) and the
  // action buttons WRAP, each with a distinct color accent.
  it("host-panel participant rows stack vertically so buttons can never clip", () => {
    expect(RELAY_CSS).toMatch(/\.hl-row\{[^}]*flex-direction:column/);
    expect(RELAY_CSS).toMatch(/\.hl-acts\{[^}]*flex-wrap:wrap/);
  });
  it("each host action carries a distinct color accent (scannable at a glance)", () => {
    expect(RELAY_CSS).toMatch(/\.hl-acts button\[data-act="mute"\]\{[^}]*#fbbf24/);
    expect(RELAY_CSS).toMatch(/\.hl-acts button\[data-act="pin"\]\{[^}]*#38bdf8/);
    expect(RELAY_CSS).toMatch(/\.hl-acts button\[data-act="cohost"\]\{[^}]*#a78bfa/);
    expect(RELAY_CSS).toMatch(/\.hl-acts button\[data-act="makehost"\]\{[^}]*var\(--accent\)/);
    expect(RELAY_CSS).toMatch(/\.hl-acts button\.hl-danger\{[^}]*var\(--danger\)/);
  });
  it("the host panel is wide enough for the stacked rows (320px, 92vw cap)", () => {
    expect(RELAY_CSS).toMatch(/\.host-panel\{[^}]*width:320px;max-width:92vw/);
  });

  // ── highlighted, blinking version/build footer (v2.55.1) ───────────────────
  it("highlights the in-call version + build with white, glowing, blinking spans", () => {
    // Version + build date are wrapped (the template interpolates the real values).
    expect(RELAY_MARKUP).toMatch(/<span class="ver-hl">v\d+\.\d+\.\d+<\/span>/);
    expect(RELAY_MARKUP).toMatch(/<span class="ver-hl">\d{4}-\d{2}-\d{2}<\/span>/);
    // White + a blink keyframe, gated by prefers-reduced-motion.
    expect(RELAY_CSS).toMatch(/\.ver-hl\{[^}]*color:#fff/);
    expect(RELAY_CSS).toMatch(/@keyframes relayVerBlink/);
    expect(RELAY_CSS).toMatch(/prefers-reduced-motion: no-preference\)\{[^@]*\.ver-hl\{[^}]*animation:relayVerBlink/);
  });
});
