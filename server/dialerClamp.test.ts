/**
 * Dialer clamp sizing — pure-math verification so the keypad never overflows
 * any viewport, even before we touch real devices.
 *
 * The dialer uses `clamp(64px, 18vw, 78px)` for key buttons and
 * `clamp(8px, 2vw, 16px)` for gaps. The grid is 3 cols wide.
 * We verify that 3 keys + 2 gaps + horizontal padding never exceed the
 * viewport width on phones from 320px (oldest iPhone SE) to 480px.
 */

import { describe, it, expect } from "vitest";

function clamp(min: number, vwValue: number, max: number, viewportPx: number): number {
  const computed = (vwValue / 100) * viewportPx;
  return Math.min(Math.max(computed, min), max);
}

describe("dialer responsive sizing", () => {
  const VIEWPORTS = [320, 360, 375, 390, 414, 430, 480, 768, 1024, 1440];
  const HORIZONTAL_PADDING = 32; // px (px-4 each side)

  it("3-key row + 2 gaps + padding fits inside every common viewport", () => {
    for (const vw of VIEWPORTS) {
      const key = clamp(64, 18, 78, vw);
      const gap = clamp(8, 2, 16, vw);
      const rowWidth = key * 3 + gap * 2 + HORIZONTAL_PADDING;
      expect(rowWidth).toBeLessThanOrEqual(vw);
    }
  });

  it("key buttons never shrink below the 44x44 px iOS hit-target minimum", () => {
    for (const vw of VIEWPORTS) {
      const key = clamp(64, 18, 78, vw);
      expect(key).toBeGreaterThanOrEqual(44);
    }
  });

  it("key buttons never overflow the 78px max", () => {
    for (const vw of VIEWPORTS) {
      const key = clamp(64, 18, 78, vw);
      expect(key).toBeLessThanOrEqual(78);
    }
  });

  it("gap stays between 8 and 16 px regardless of viewport", () => {
    for (const vw of VIEWPORTS) {
      const gap = clamp(8, 2, 16, vw);
      expect(gap).toBeGreaterThanOrEqual(8);
      expect(gap).toBeLessThanOrEqual(16);
    }
  });

  it("dialed-number font (clamp 2rem,8vw,3.5rem) stays readable on every device", () => {
    // 1rem === 16px; we work in px for clarity
    const minPx = 32; // 2rem
    const maxPx = 56; // 3.5rem
    for (const vw of VIEWPORTS) {
      const size = clamp(minPx, 8, maxPx, vw);
      expect(size).toBeGreaterThanOrEqual(minPx);
      expect(size).toBeLessThanOrEqual(maxPx);
    }
  });
});
