import { describe, it, expect } from "vitest";
import { formatDialed, ghostNumberRule, parseDialToParam } from "./Dialer";

/**
 * Pure-logic tests for the redesigned Dialer (v2.1.1):
 *   1. The dialed-number area must be formatted "XXX YYY" once we have all
 *      6 digits, but partial input (1..5 digits) should render verbatim
 *      so the user sees what they typed without phantom whitespace shifts.
 *   2. When the user has typed nothing AND we know their own number,
 *      the area shows their own number as a "ghost" placeholder. The
 *      moment they tap any digit, the ghost vanishes and the typed
 *      digits take over (the engineer-visible `mode` flips to "typed").
 */

describe("formatDialed", () => {
  it("returns empty string verbatim", () => {
    expect(formatDialed("")).toBe("");
  });

  it("does not insert a separator before there are 4 digits", () => {
    expect(formatDialed("1")).toBe("1");
    expect(formatDialed("12")).toBe("12");
    expect(formatDialed("123")).toBe("123");
  });

  it("inserts a single space at position 3 once the 4th digit lands", () => {
    expect(formatDialed("1234")).toBe("123 4");
    expect(formatDialed("12345")).toBe("123 45");
    expect(formatDialed("123456")).toBe("123 456");
  });

  it("ignores anything past 6 digits (caller is responsible for clipping, but the formatter must not crash)", () => {
    expect(formatDialed("1234567")).toBe("123 456");
  });
});

describe("ghostNumberRule", () => {
  it("returns 'empty' when there is nothing typed and no own number is known yet", () => {
    expect(ghostNumberRule({ typed: "", ownNumber: null })).toEqual({
      mode: "empty",
      display: "",
    });
    expect(ghostNumberRule({ typed: "", ownNumber: undefined })).toEqual({
      mode: "empty",
      display: "",
    });
  });

  it("ghosts the user's own number when nothing is typed", () => {
    expect(ghostNumberRule({ typed: "", ownNumber: "812345" })).toEqual({
      mode: "ghost",
      display: "812 345",
    });
  });

  it("rejects an own-number that is not exactly 6 digits (defensive, in case of bad backend response)", () => {
    expect(ghostNumberRule({ typed: "", ownNumber: "12345" })).toEqual({
      mode: "empty",
      display: "",
    });
    expect(ghostNumberRule({ typed: "", ownNumber: "abc123" })).toEqual({
      mode: "empty",
      display: "",
    });
  });

  it("flips to 'typed' the moment the user starts typing — the ghost disappears", () => {
    // Even a single digit must take precedence. This is THE invariant the
    // user asked for: "but when he start entering the other user's number,
    // it will disappear".
    expect(ghostNumberRule({ typed: "5", ownNumber: "812345" })).toEqual({
      mode: "typed",
      display: "5",
    });
  });

  it("keeps the typed number formatted with the 'XXX YYY' separator when it reaches 4+ digits", () => {
    expect(ghostNumberRule({ typed: "1234", ownNumber: "812345" })).toEqual({
      mode: "typed",
      display: "123 4",
    });
    expect(ghostNumberRule({ typed: "812346", ownNumber: "812345" })).toEqual({
      mode: "typed",
      display: "812 346",
    });
  });

  it("strips any non-digit chars from the typed value before deciding the mode", () => {
    // Defensive: even if upstream forgot to filter (e.g. paste), we should
    // still treat a non-numeric string as 'no input' and show the ghost.
    expect(ghostNumberRule({ typed: "   ", ownNumber: "812345" })).toEqual({
      mode: "ghost",
      display: "812 345",
    });
    expect(ghostNumberRule({ typed: "abc", ownNumber: "812345" })).toEqual({
      mode: "ghost",
      display: "812 345",
    });
  });
});

describe("parseDialToParam", () => {
  // The Messages/Contacts call buttons and the legacy /app/call redirect carry
  // the target as ?to=NNNNNN. The Dialer auto-dials it once registered, so the
  // parser must accept exactly a 6-digit number and reject everything else.
  it("extracts a 6-digit number with or without a leading '?'", () => {
    expect(parseDialToParam("?to=277242")).toBe("277242");
    expect(parseDialToParam("to=277242")).toBe("277242");
  });

  it("preserves leading zeros (numbers are strings, not ints)", () => {
    expect(parseDialToParam("?to=000123")).toBe("000123");
  });

  it("ignores other params and order", () => {
    expect(parseDialToParam("?foo=1&to=812345&bar=2")).toBe("812345");
  });

  it("returns null when there is no ?to= at all", () => {
    expect(parseDialToParam("")).toBeNull();
    expect(parseDialToParam("?other=x")).toBeNull();
  });

  it("returns null for a non-6-digit or non-numeric target", () => {
    expect(parseDialToParam("?to=12345")).toBeNull(); // too short
    expect(parseDialToParam("?to=abcdef")).toBeNull(); // not numeric
  });

  it("clips an over-long value to its first 6 digits", () => {
    // URL-encoded junk should still yield a clean 6-digit target.
    expect(parseDialToParam("?to=1234567")).toBe("123456");
  });
});
