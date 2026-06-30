import { describe, expect, it } from "vitest";

import { elapsedFraction, remainingFraction } from "../lib/countdown";

const WINDOW = 10 * 60_000; // 10 minutes

describe("remainingFraction", () => {
  it("is full (1) right after a check", () => {
    const t = 1_000_000;
    expect(remainingFraction(t, t, WINDOW)).toBe(1);
  });

  it("is half when half the window has elapsed", () => {
    const t = 1_000_000;
    expect(remainingFraction(t, t + WINDOW / 2, WINDOW)).toBeCloseTo(0.5, 5);
  });

  it("is empty (0) once the window has fully elapsed", () => {
    const t = 1_000_000;
    expect(remainingFraction(t, t + WINDOW, WINDOW)).toBe(0);
    expect(remainingFraction(t, t + WINDOW * 2, WINDOW)).toBe(0);
  });

  it("clamps to 1 for future/skewed timestamps", () => {
    const t = 1_000_000;
    expect(remainingFraction(t, t - 5000, WINDOW)).toBe(1);
  });

  it("returns 0 for a non-positive window", () => {
    expect(remainingFraction(0, 0, 0)).toBe(0);
    expect(remainingFraction(0, 0, -10)).toBe(0);
  });
});

describe("elapsedFraction", () => {
  it("is the inverse of remainingFraction", () => {
    const t = 1_000_000;
    expect(elapsedFraction(t, t, WINDOW)).toBe(0);
    expect(elapsedFraction(t, t + WINDOW / 4, WINDOW)).toBeCloseTo(0.25, 5);
    expect(elapsedFraction(t, t + WINDOW, WINDOW)).toBe(1);
  });
});
