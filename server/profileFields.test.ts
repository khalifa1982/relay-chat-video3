import { describe, it, expect } from "vitest";
import {
  SOCIAL_PLATFORMS,
  sanitizeSocials,
  sanitizeMobiles,
  sanitizeStatusOverride,
  effectiveStatus,
  formatLastSeen,
  MAX_SOCIALS,
  MAX_MOBILES,
} from "@shared/profileFields";

describe("sanitizeSocials", () => {
  it("keeps known platforms with non-empty values, drops the rest", () => {
    const out = sanitizeSocials([
      { platform: "x", value: "@alice" },
      { platform: "website", value: "example.com" },
      { platform: "bogus", value: "x" },
      { platform: "snapchat", value: "" },
      { value: "no platform" },
      "garbage",
    ]);
    expect(out).toEqual([
      { platform: "x", value: "@alice" },
      { platform: "website", value: "example.com" },
    ]);
  });
  it("caps the count", () => {
    const many = Array.from({ length: MAX_SOCIALS + 5 }, () => ({ platform: "x", value: "a" }));
    expect(sanitizeSocials(many)).toHaveLength(MAX_SOCIALS);
  });
  it("returns [] for non-arrays", () => {
    expect(sanitizeSocials(null)).toEqual([]);
    expect(sanitizeSocials("x")).toEqual([]);
  });
});

describe("social hrefs", () => {
  const href = (k: string, v: string) => SOCIAL_PLATFORMS.find((p) => p.key === k)!.href(v);
  it("builds canonical X / Snapchat / WhatsApp / website URLs", () => {
    expect(href("x", "@bob")).toBe("https://x.com/bob");
    expect(href("x", "https://twitter.com/bob")).toBe("https://x.com/bob");
    expect(href("snapchat", "bob")).toBe("https://snapchat.com/add/bob");
    expect(href("whatsapp", "+1 (555) 123-4567")).toBe("https://wa.me/15551234567");
    expect(href("website", "example.com")).toBe("https://example.com");
    expect(href("website", "https://x.io")).toBe("https://x.io");
  });
  it("returns null for empty / too-short values", () => {
    expect(href("x", "  ")).toBeNull();
    expect(href("whatsapp", "12")).toBeNull();
  });
});

describe("sanitizeMobiles", () => {
  it("keeps plausible numbers, drops junk", () => {
    expect(sanitizeMobiles(["+1 555 123 4567", "(020) 7946 0958", "hi", "12", 999])).toEqual([
      "+1 555 123 4567",
      "(020) 7946 0958",
    ]);
  });
  it("caps the count", () => {
    const many = Array.from({ length: MAX_MOBILES + 3 }, (_, i) => `+1555000${1000 + i}`);
    expect(sanitizeMobiles(many)).toHaveLength(MAX_MOBILES);
  });
});

describe("status", () => {
  it("sanitizes the override to a known value or empty", () => {
    expect(sanitizeStatusOverride("away")).toBe("away");
    expect(sanitizeStatusOverride("travel")).toBe("travel");
    expect(sanitizeStatusOverride("online")).toBe("");
    expect(sanitizeStatusOverride(undefined)).toBe("");
  });
  it("computes the effective status (override wins over presence)", () => {
    expect(effectiveStatus(true, "")).toBe("online");
    expect(effectiveStatus(false, "")).toBe("offline");
    expect(effectiveStatus(true, "away")).toBe("away");
    expect(effectiveStatus(false, "travel")).toBe("travel");
  });
});

describe("formatLastSeen", () => {
  const base = new Date("2026-06-28T15:30:00").getTime();
  it("just now / minutes ago", () => {
    expect(formatLastSeen(base - 10_000, base)).toBe("last seen just now");
    expect(formatLastSeen(base - 60_000, base)).toBe("last seen 1 minute ago");
    expect(formatLastSeen(base - 5 * 60_000, base)).toBe("last seen 5 minutes ago");
  });
  it("today at H:MM", () => {
    const t = new Date("2026-06-28T09:05:00").getTime();
    expect(formatLastSeen(t, base)).toBe("last seen today at 9:05 AM");
  });
  it("yesterday at H:MM", () => {
    const t = new Date("2026-06-27T22:30:00").getTime();
    expect(formatLastSeen(t, base)).toBe("last seen yesterday at 10:30 PM");
  });
  it("older → on MON D AT the time (v2.99.66)", () => {
    // Owner screenshot: the dialer preview read "last seen on Jul 23" with no
    // clock, while today/yesterday already carried one. The time is the part
    // that distinguishes "this morning" from "3am", so every dated branch has it.
    const t = new Date("2026-06-20T08:00:00").getTime();
    expect(formatLastSeen(t, base)).toBe("last seen on Jun 20 at 8:00 AM");
  });
  it("names the year only when it is not the current one", () => {
    // "Jun 20" silently reads as this year; being twelve months wrong without
    // saying so is worse than one extra token.
    const sameYear = new Date("2026-01-04T19:45:00").getTime();
    expect(formatLastSeen(sameYear, base)).toBe("last seen on Jan 4 at 7:45 PM");
    const lastYear = new Date("2025-11-02T06:09:00").getTime();
    expect(formatLastSeen(lastYear, base)).toBe("last seen on Nov 2, 2025 at 6:09 AM");
  });
  it("empty for invalid timestamps", () => {
    expect(formatLastSeen(0, base)).toBe("");
    expect(formatLastSeen(NaN, base)).toBe("");
  });
});
