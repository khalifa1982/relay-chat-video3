/**
 * Unit tests for the pure helpers backing `directory.geoSelf`. The
 * full procedure makes a network call to ipapi.co; we don't exercise
 * that here. Instead we pin the deterministic pieces:
 *
 *   - `flagEmojiFromIso2` correctly maps ISO-3166-1 alpha-2 to the
 *     two-codepoint regional-indicator emoji.
 *   - `pickClientIp` honors common forwarding headers in priority
 *     order and strips IPv6-mapped IPv4 prefixes.
 *   - `isPrivateOrLocalIp` recognizes the RFC-1918 / loopback /
 *     link-local / unique-local ranges so we don't hit a public
 *     geo service for them.
 */
import { describe, expect, it } from "vitest";
import {
  flagEmojiFromIso2,
  isPrivateOrLocalIp,
  pickClientIp,
} from "./v2routers";

describe("flagEmojiFromIso2", () => {
  it("returns the UAE flag for AE", () => {
    expect(flagEmojiFromIso2("AE")).toBe("\u{1F1E6}\u{1F1EA}");
  });

  it("returns the US flag for us (case-insensitive)", () => {
    expect(flagEmojiFromIso2("us")).toBe("\u{1F1FA}\u{1F1F8}");
  });

  it("returns null for unknown / malformed codes", () => {
    expect(flagEmojiFromIso2("")).toBeNull();
    expect(flagEmojiFromIso2(null)).toBeNull();
    expect(flagEmojiFromIso2(undefined)).toBeNull();
    expect(flagEmojiFromIso2("USA")).toBeNull(); // 3 chars
    expect(flagEmojiFromIso2("U1")).toBeNull(); // contains digit
  });
});

describe("pickClientIp", () => {
  it("prefers CF-Connecting-IP when present", () => {
    const ip = pickClientIp({
      headers: {
        "cf-connecting-ip": "203.0.113.4",
        "x-forwarded-for": "10.0.0.1",
      },
      ip: "127.0.0.1",
    });
    expect(ip).toBe("203.0.113.4");
  });

  it("falls back to the first X-Forwarded-For entry", () => {
    const ip = pickClientIp({
      headers: { "x-forwarded-for": "  198.51.100.7, 10.0.0.1 " },
      ip: "127.0.0.1",
    });
    expect(ip).toBe("198.51.100.7");
  });

  it("strips ::ffff: IPv6-mapped IPv4 prefix", () => {
    const ip = pickClientIp({
      headers: { "x-forwarded-for": "::ffff:192.0.2.42" },
    });
    expect(ip).toBe("192.0.2.42");
  });

  it("falls back to req.ip then socket.remoteAddress", () => {
    expect(
      pickClientIp({ headers: {}, ip: "203.0.113.5" })
    ).toBe("203.0.113.5");
    expect(
      pickClientIp({
        headers: {},
        socket: { remoteAddress: "::ffff:198.51.100.9" },
      })
    ).toBe("198.51.100.9");
  });
});

describe("isPrivateOrLocalIp", () => {
  it("flags loopback, RFC-1918, link-local and unique-local ranges", () => {
    expect(isPrivateOrLocalIp("127.0.0.1")).toBe(true);
    expect(isPrivateOrLocalIp("::1")).toBe(true);
    expect(isPrivateOrLocalIp("10.0.0.5")).toBe(true);
    expect(isPrivateOrLocalIp("192.168.1.1")).toBe(true);
    expect(isPrivateOrLocalIp("172.16.0.1")).toBe(true);
    expect(isPrivateOrLocalIp("172.31.255.255")).toBe(true);
    expect(isPrivateOrLocalIp("169.254.1.1")).toBe(true);
    expect(isPrivateOrLocalIp("fd00::1")).toBe(true);
    expect(isPrivateOrLocalIp("fe80::1")).toBe(true);
  });

  it("does not flag public routable IPs", () => {
    expect(isPrivateOrLocalIp("8.8.8.8")).toBe(false);
    expect(isPrivateOrLocalIp("1.1.1.1")).toBe(false);
    expect(isPrivateOrLocalIp("172.15.0.1")).toBe(false); // outside 16-31
    expect(isPrivateOrLocalIp("172.32.0.1")).toBe(false);
  });
});
