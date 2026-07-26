import { describe, it, expect } from "vitest";
import { formatDuration, formatWhen, formatFullWhen } from "./formatCall";

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

  it("formats hours as hh:mm:ss — EVERY field two digits (owner spec, v2.99.77)", () => {
    // "If it's hours, you put two digits hour, two digits minutes, two digits of
    // the seconds." Padding the hour too is what keeps the column from jittering
    // between "1:05:03" and "11:05:03" down the log.
    expect(formatDuration(3600)).toBe("01:00:00");
    expect(formatDuration(3600 + 2 * 60 + 33)).toBe("01:02:33");
    expect(formatDuration(2 * 3600 + 5)).toBe("02:00:05");
    expect(formatDuration(11 * 3600 + 5 * 60 + 3)).toBe("11:05:03");
  });

  it("under an hour, minutes take only the digits they need", () => {
    // "If it was less than ten minutes, then just one digit ... If it's more than
    // ten minutes, you put two digits."
    expect(formatDuration(83)).toBe("1:23");
    expect(formatDuration(9 * 60 + 59)).toBe("9:59");
    expect(formatDuration(12 * 60 + 34)).toBe("12:34");
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

describe("formatFullWhen (call-log full date + precise time)", () => {
  it("always includes the YEAR and SECONDS (en-US pinned for determinism)", () => {
    const s = formatFullWhen("2026-07-03T16:12:09Z", "en-US");
    expect(s).toMatch(/2026/);
    // Seconds survive any whole-minute timezone offset.
    expect(s).toMatch(/:09/);
    expect(s.length).toBeGreaterThan(10);
  });

  it("returns empty string for an invalid date instead of 'Invalid Date'", () => {
    expect(formatFullWhen("nope")).toBe("");
  });
});
