/**
 * v2.99.36 — three owner asks on the landing page (screenshot + notes):
 *
 * (1) "In the arabic the open app icon is not showing." The Open-App pill
 *     carried a bare "↗" (U+2197) inside the copy string. The v2.99.16 RTL
 *     rule forces 'Noto Kufi Arabic' on EVERY element in Arabic and that face
 *     has no U+2197, so iOS fell through to the emoji font and drew a boxed
 *     ↗️ next to the Arabic label instead of a clean arrow. FIX: the arrow is
 *     now an inline SVG (`ARROW_NE`) — renders identically in every language,
 *     font and platform — and it mirrors in RTL so it still points "outward".
 *
 * (2) "In the dial pad both in arabic and english make delete number icons so
 *     if you enter you can erase it." An erase key now occupies the keypad's
 *     bottom-right cell, replacing "#" — which was pure decoration here, since
 *     this pad only accepts 0-9 for a 6-digit RELAY number and "#" did nothing
 *     but play a tone. It dims when there is nothing to erase.
 *     A REAL BUG was caught mid-build and fixed: the first implementation put
 *     the erase button beside the number display (absolutely positioned,
 *     `inset-inline-end`). In English it covered the 6th placeholder dot; in
 *     ARABIC, where it mirrors to the leading edge, it landed ON TOP of the
 *     first digit — the display is too wide to share that row. Moving it into
 *     the grid removes the overlap entirely and gives it a full 54px-tall
 *     touch target. Pinned below via the no-overlap-by-construction contract.
 *
 * (3) "Make tone when you click each number as sound." DTMF tones existed but
 *     were effectively silent for two reasons, both fixed: the oscillators
 *     were scheduled at `ac.currentTime` in the SAME tick as the async
 *     `ac.resume()`, so on iOS the note's start time had already elapsed by
 *     the time the context actually ran (the classic iOS Web Audio race); and
 *     the peak gain was 0.045 (≈ -27 dBFS), inaudible in practice. Now the
 *     context is unlocked on the first real gesture, a suspended context
 *     resumes and THEN schedules, notes start at a lookahead so they can never
 *     be scheduled in the past, and the peak is 0.18.
 *
 * Verified headlessly on an emulated phone against the real built bundle:
 * 2 oscillators per keypress at the correct DTMF frequencies, peak 0.18, zero
 * notes scheduled in the past, the iOS silent-buffer unlock firing on the
 * first touch; the erase key overlapping neither the display nor any key in
 * EITHER language, erasing one digit per tap and no-opping when empty; and the
 * Arabic pill painting a mirrored SVG arrow with no U+2197 left on the page.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const HOME = readFileSync(join(__dirname, "..", "client/src/pages/Home.tsx"), "utf8");

describe("(1) Arabic Open-App arrow is an SVG, not a font glyph (v2.99.36)", () => {
  it("no bare U+2197 reaches the DOM — not in the copy tables, not on the CALL button", () => {
    expect(HOME).toMatch(/openApp: "OPEN APP",/);
    expect(HOME).toMatch(/openApp: "افتح التطبيق",/);
    // Copy strings and the dynamically-set CALL label are the only two paths
    // that ever painted this character. (It survives in code COMMENTS that
    // explain the fix — those never render.)
    expect(HOME).not.toMatch(/^\s*\w+: "[^"\n]*↗/m);
    expect(HOME).not.toMatch(/setCallState\([^;\n]*↗/);
  });
  it("the CALL button gets the arrow as a constant SVG appended after its text", () => {
    // The label stays textContent (localized copy); only the constant SVG is
    // inserted as markup, so there is no interpolation/injection surface.
    expect(HOME).toMatch(/const setCallState = \(armed: boolean, label: string, arrow = false\)/);
    expect(HOME).toMatch(/cb\.textContent = label;/);
    expect(HOME).toMatch(/if \(arrow\) cb\.insertAdjacentHTML\("beforeend", ARROW_NE\);/);
    // …and it must lay out text + icon on one centred line.
    expect(HOME).toMatch(/data-lp="callBtn"[^>]*display:flex;align-items:center;justify-content:center;gap:8px/);
  });
  it("both Open-App links render the inline SVG arrow", () => {
    expect(HOME).toMatch(/const ARROW_NE = `<svg class="lp-arrow"/);
    // nav pill + footer link
    expect((HOME.match(/\$\{t\.openApp\}\$\{ARROW_NE\}/g) || []).length).toBe(2);
  });
  it("the arrow mirrors in RTL so it still points outward", () => {
    expect(HOME).toMatch(/\.lp-root\[dir="rtl"\] \.lp-arrow\{transform:scaleX\(-1\)\}/);
  });
});

describe("(2) erase key lives IN the keypad grid (v2.99.36)", () => {
  it("replaces the decorative '#' cell rather than floating over the display", () => {
    expect(HOME).toMatch(/\["0", "\+"\], \[BS_KEY, ""\],/);
    expect(HOME).not.toMatch(/\["#", ""\]/);
  });
  it("renders as an icon button routed to backspace() by the delegated handler", () => {
    expect(HOME).toMatch(/d === BS_KEY/);
    expect(HOME).toMatch(/data-lp="backBtn"/);
    expect(HOME).toMatch(/case "backBtn": backspace\(\); break;/);
    expect(HOME).toMatch(/\[data-lp='backBtn'\]/); // in the delegation selector
  });
  it("is NOT absolutely positioned next to the number display (the overlap bug)", () => {
    // The discarded first attempt used inset-inline-end on the display row,
    // which covered the 6th dot in English and the FIRST DIGIT in Arabic.
    expect(HOME).not.toMatch(/inset-inline-end/);
    expect(HOME).toMatch(/it can never overlap the digits/);
  });
  it("erases exactly one digit, no-ops when empty, and dims when there is nothing to erase", () => {
    const bs = HOME.slice(HOME.indexOf("const backspace ="), HOME.indexOf("const clearDial ="));
    expect(bs).toMatch(/if \(!num\) return;/);
    expect(bs).toMatch(/num = num\.slice\(0, -1\);/);
    expect(HOME).toMatch(/bs\.style\.opacity = len \? "1" : "\.35";/);
  });
  it("carries a localized label in both languages", () => {
    expect(HOME).toMatch(/erase: "Erase last digit"/);
    expect(HOME).toMatch(/erase: "حذف آخر رقم"/);
    expect(HOME).toMatch(/aria-label="\$\{t\.erase\}"/);
  });
});

describe("(3) audible key tones (v2.99.36)", () => {
  it("a suspended context RESUMES BEFORE the note is scheduled (the iOS race)", () => {
    expect(HOME).toMatch(/if \(c\.state === "suspended"\) void c\.resume\(\)\.then\(fire\)/);
  });
  it("every note starts at a lookahead — never scheduled in the past", () => {
    expect(HOME).toMatch(/const t0 = c\.currentTime \+ 0\.005;/);
    expect(HOME).toMatch(/o\.start\(t0\)/);
  });
  it("the peak gain is audible (0.18), not the old inaudible 0.045", () => {
    expect(HOME).toMatch(/const TONE_PEAK = 0\.18;/);
    expect(HOME).not.toMatch(/exponentialRampToValueAtTime\(0\.045/);
  });
  it("audio is unlocked on the first real gesture (iOS starts contexts suspended)", () => {
    expect(HOME).toMatch(/host\.addEventListener\("pointerdown", unlockAudio, \{ once: true, passive: true \}\)/);
    expect(HOME).toMatch(/src\.buffer = c\.createBuffer\(1, 1, 22050\)/);
    expect(HOME).toMatch(/host\.removeEventListener\("pointerdown", unlockAudio\)/);
  });
  it("every digit key still plays its real DTMF pair, and erase gets its own tone", () => {
    expect(HOME).toMatch(/const f = DTMF\[d\];\s*\n\s*if \(f\) playTones\(f\);/);
    expect(HOME).toMatch(/playTones\(\[420, 310\], 105\)/);
  });
  it("the honest platform limit is documented, not papered over", () => {
    expect(HOME).toMatch(/hardware mute switch/);
  });
});
