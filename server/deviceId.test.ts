/*
 * Regression tests for the sticky-session device-id contract introduced
 * in v2.1.0 to stop the "my number changes randomly / multiple users
 * get mixed up" bug.
 *
 * The two ends of the contract are (1) the server's `extractDeviceId`
 * header validator and (2) the `NumberSchema`-style hex shape on the
 * `startGuest` input. Both must agree, or the survival path collapses.
 *
 * We test the validator behavior directly, since it's a pure function
 * over `req.headers`. The DB-touching parts (`getIdentityByDeviceId`,
 * `bindDeviceIdToIdentity`, `startGuest` survival path) are exercised
 * by the broader v2routers integration tests when a real DB is
 * available; here we pin the deterministic logic that survives any
 * environment.
 */

import { describe, it, expect } from "vitest";
import type { Request } from "express";
import { extractDeviceId, DEVICE_ID_HEADER } from "./_core/context";

function fakeReq(headers: Record<string, string | string[] | undefined>): Request {
  // Only the `.headers` property is read by extractDeviceId. Cast to
  // Request because we deliberately don't construct a real Express
  // request \u2014 the validator must be safe to call on any shape.
  return { headers } as unknown as Request;
}

describe("extractDeviceId — header validator (the gate-keeper for sticky sessions)", () => {
  it("accepts a valid 32-char hex device id", () => {
    const id = "deadbeef".repeat(4); // 32 hex chars
    const req = fakeReq({ [DEVICE_ID_HEADER]: id });
    expect(extractDeviceId(req)).toBe(id);
  });

  it("accepts the shortest allowed device id (16 hex chars)", () => {
    const id = "0123456789abcdef";
    const req = fakeReq({ [DEVICE_ID_HEADER]: id });
    expect(extractDeviceId(req)).toBe(id);
  });

  it("accepts the longest allowed device id (64 hex chars)", () => {
    const id = "a".repeat(64);
    const req = fakeReq({ [DEVICE_ID_HEADER]: id });
    expect(extractDeviceId(req)).toBe(id);
  });

  it("normalizes upper-case hex to lower-case", () => {
    const req = fakeReq({ [DEVICE_ID_HEADER]: "DEADBEEFDEADBEEFDEADBEEFDEADBEEF" });
    expect(extractDeviceId(req)).toBe("deadbeefdeadbeefdeadbeefdeadbeef");
  });

  it("trims whitespace around the value", () => {
    const req = fakeReq({ [DEVICE_ID_HEADER]: "  deadbeefdeadbeefdeadbeefdeadbeef  " });
    expect(extractDeviceId(req)).toBe("deadbeefdeadbeefdeadbeefdeadbeef");
  });

  it("rejects an empty header", () => {
    const req = fakeReq({ [DEVICE_ID_HEADER]: "" });
    expect(extractDeviceId(req)).toBeNull();
  });

  it("rejects a too-short header (under the 8-char minimum)", () => {
    // The validator's minimum is 8 chars (server/_core/context.ts).
    // We pick the shortest invalid value to pin the boundary.
    const req = fakeReq({ [DEVICE_ID_HEADER]: "abcd123" });
    expect(extractDeviceId(req)).toBeNull();
  });

  it("accepts the documented 8-char minimum boundary", () => {
    // Pins the lower bound: anything shorter is rejected (previous
    // test), anything 8–64 chars long must be accepted.
    const req = fakeReq({ [DEVICE_ID_HEADER]: "abcd1234" });
    expect(extractDeviceId(req)).toBe("abcd1234");
  });

  it("rejects a too-long header (65 chars)", () => {
    const req = fakeReq({ [DEVICE_ID_HEADER]: "a".repeat(65) });
    expect(extractDeviceId(req)).toBeNull();
  });

  it("rejects non-hex characters", () => {
    const req = fakeReq({ [DEVICE_ID_HEADER]: "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz" });
    expect(extractDeviceId(req)).toBeNull();
  });

  it("rejects a mixed-content header (hex + non-hex)", () => {
    const req = fakeReq({ [DEVICE_ID_HEADER]: "deadbeef!*&deadbeefdeadbeefdead" });
    expect(extractDeviceId(req)).toBeNull();
  });

  it("returns null when the header is absent", () => {
    const req = fakeReq({});
    expect(extractDeviceId(req)).toBeNull();
  });

  it("picks the first value when the header is repeated as an array", () => {
    // Multiple values for the same header are unusual but valid HTTP.
    // We accept the first to keep behavior deterministic.
    const req = fakeReq({
      [DEVICE_ID_HEADER]: [
        "deadbeefdeadbeefdeadbeefdeadbeef",
        "ffffffffffffffffffffffffffffffff",
      ],
    });
    expect(extractDeviceId(req)).toBe("deadbeefdeadbeefdeadbeefdeadbeef");
  });

  it("returns null when an array header's first value is invalid", () => {
    // If the first value is junk, we don't fall back to later values \u2014
    // that would be a path a malicious proxy could use to forge an
    // identity by stuffing the array.
    const req = fakeReq({
      [DEVICE_ID_HEADER]: ["bogus", "deadbeefdeadbeefdeadbeefdeadbeef"],
    });
    expect(extractDeviceId(req)).toBeNull();
  });

  it("ignores a non-string header value", () => {
    // A misbehaving proxy could set the header to something exotic;
    // we should fail closed, not crash.
    const req = fakeReq({ [DEVICE_ID_HEADER]: undefined });
    expect(extractDeviceId(req)).toBeNull();
  });
});
