/**
 * v2.98.0 — caller-side "End Call" redesign (owner: "the red one for
 * Hangout... it's not nice"). The pre-connect dial screen (Calling…/Ringing…)
 * is the ONE control on an otherwise near-empty dark screen, so a bare red
 * circle read as a lone dot floating in black. Grounded it with a soft
 * ambient glow (distinct from the tight ripple ring), a richer two-tone
 * gradient, and a real "End Call" caption underneath.
 *
 * A real bug was found and fixed while building this: the mobile media query
 * that lets a crowded in-call control bar SCROLL (`.ctrl-bar{max-height:40vh;
 * overflow-y:auto}`) was clipping the new halo + caption on the pre-connect
 * screen, where there's only one button and nothing to scroll. Verified via a
 * headless render — screenshot evidence, not just source pins.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ASSETS = readFileSync(join(__dirname, "..", "client/src/lib/relayAssets.ts"), "utf8");

describe("caller-side End Call redesign (v2.98.0)", () => {
  it("adds a real 'End Call' caption, hidden everywhere except the pre-connect dial screen", () => {
    /* Matched on the CLASS plus its text rather than the exact tag, so a
       translation annotation (or any other attribute) on the element does not
       break a pin about the caption EXISTING. */
    expect(ASSETS).toMatch(/<span class="hangup-lbl"[^>]*>End Call<\/span>/);
    expect(ASSETS).toMatch(/\.hangup-lbl\{display:none\}/);
    expect(ASSETS).toMatch(/#call\.pre-connect \.ctrl\.hangup \.hangup-lbl\{display:block/);
  });
  it("grounds the button with a soft ambient halo BEHIND it (distinct from the tight ripple ring)", () => {
    expect(ASSETS).toMatch(/#call\.pre-connect \.ctrl-bar::before\{content:"";[\s\S]{0,200}radial-gradient\(circle,rgba\(255,59,92/);
    // The ripple ring (a thin border, existing since v2.97) is a SEPARATE effect.
    expect(ASSETS).toMatch(/#call\.pre-connect \.ctrl\.hangup::after\{content:"";[\s\S]{0,120}border:2px solid rgba\(255,92,114,\.5\)/);
  });
  it("the halo glow is NOT clipped by the mobile control-bar scroll override (the real bug found + fixed)", () => {
    // The pre-connect ctrl-bar override must win over the media-query's
    // max-height/overflow-y:auto (which exists to let a CROWDED in-call bar
    // scroll — irrelevant with the single pre-connect button, and it was
    // silently clipping the new halo + caption).
    const rule = ASSETS.slice(ASSETS.indexOf("#call.pre-connect .ctrl-bar{"));
    const body = rule.slice(0, rule.indexOf("}") + 1);
    expect(body).toMatch(/max-height:none/);
    expect(body).toMatch(/overflow:visible/);
  });
  it("richer two-tone red gradient + a bigger glyph than the compact in-call button", () => {
    expect(ASSETS).toMatch(/#call\.pre-connect \.ctrl\.hangup\{width:76px;height:76px;\s*\n\s*background:linear-gradient\(155deg,#FF7A8A 0%,#FF3B5C 55%,#D81B42 100%\)/);
  });
  it("the halo pulses gently — motion-gated behind prefers-reduced-motion, like every other ring-card animation", () => {
    const gated = ASSETS.slice(ASSETS.indexOf("@media (prefers-reduced-motion:no-preference){\n  .relay-root #call.pre-connect .ctrl.hangup{animation:relayBob"));
    expect(gated.slice(0, 600)).toMatch(/\.ctrl-bar::before\{animation:relayHaloPulse/);
    expect(ASSETS).toMatch(/@keyframes relayHaloPulse/);
  });
  it("the glyph is CENTERED: the pre-connect un-hide uses display:grid, never flex (v2.98.3)", () => {
    // .ctrl centers its glyph with display:grid + place-items:center. The
    // pre-connect un-hide rule used display:flex — flexbox has no
    // justify-items, so the white handset fell back to flex-start and sat
    // pinned to the LEFT edge of the 76px red circle (owner screenshot;
    // measured 1px left / 42px right before, 21.5px all around after).
    expect(ASSETS).toMatch(/#call\.pre-connect \.ctrl-bar \.ctrl\.hangup\{display:grid\}/);
    expect(ASSETS).not.toMatch(/\.ctrl\.hangup\{display:flex\}/);
  });
  it("the compact IN-CALL hang-up button (crowded control bar) is untouched by the pre-connect-only rules", () => {
    // Scoped selectors only — no bare `.ctrl.hangup` change that would leak
    // the caption/halo into the small in-call button among mic/cam/etc.
    const compact = ASSETS.slice(
      ASSETS.indexOf('.relay-root .ctrl.hangup{width:58px'),
      ASSETS.indexOf("#call.pre-connect .ctrl.hangup{width:76px")
    );
    expect(compact).not.toMatch(/hangup-lbl\{display:block/);
  });
});
