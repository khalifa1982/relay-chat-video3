import { describe, it, expect } from "vitest";
import { formatDuration, formatWhen } from "./formatCall";

describe("formatDuration", () => {
  it("formats sub-minute durations as m:ss", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(5)).toBe("0:05");
    expect(formatDuration(45)).toBe("0:45");
    expect(formatDuration(59)).toBe("0:59");
  });

  it("formats minutes as m:ss with zero-padded seconds", () => {
    expect(formatDuration(60)).toBe("1:00");
    expect(formatDuration(63)).toBe("1:03");
    expect(formatDuration(12 * 60 + 3)).toBe("12:03");
  });

  it("formats hours as h:mm:ss with zero-padded minutes", () => {
    expect(formatDuration(3600)).toBe("1:00:00");
    expect(formatDuration(3600 + 2 * 60 + 33)).toBe("1:02:33");
    expect(formatDuration(2 * 3600 + 5)).toBe("2:00:05");
  });

  it("clamps negative / non-finite / fractional input", () => {
    expect(formatDuration(-10)).toBe("0:00");
    expect(formatDuration(Number.NaN)).toBe("0:00");
    expect(formatDuration(Infinity)).toBe("0:00");
    expect(formatDuration(45.9)).toBe("0:45"); // floored
  });
});

describe("formatWhen", () => {
  it("returns a non-empty string for a valid date", () => {
    expect(formatWhen(new Date("2026-06-27T15:14:00Z")).length).toBeGreaterThan(0);
  });

  it("accepts an ISO string", () => {
    expect(formatWhen("2026-06-27T15:14:00Z").length).toBeGreaterThan(0);
  });

  it("returns empty string for an invalid date instead of 'Invalid Date'", () => {
    expect(formatWhen("not-a-date")).toBe("");
  });
});
