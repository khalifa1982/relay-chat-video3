import { describe, it, expect } from "vitest";
import { isFreshSnapshot, REJOIN_MAX_AGE_MS } from "./rejoinSnapshot";

const now = 1_000_000;
const valid = { roomId: "rabc123", pin: "482015", micOn: true, camOn: false, ts: now };

describe("isFreshSnapshot", () => {
  it("accepts a well-formed, fresh snapshot", () => {
    expect(isFreshSnapshot(valid, now)).toBe(true);
    expect(isFreshSnapshot({ ...valid, ts: now - 10_000 }, now)).toBe(true);
  });
  it("rejects a stale snapshot (older than the grace window)", () => {
    expect(isFreshSnapshot({ ...valid, ts: now - (REJOIN_MAX_AGE_MS + 1) }, now)).toBe(false);
  });
  it("rejects an absurd future-dated snapshot (clock skew)", () => {
    expect(isFreshSnapshot({ ...valid, ts: now + 10_000 }, now)).toBe(false);
  });
  it("rejects malformed shapes", () => {
    expect(isFreshSnapshot(null, now)).toBe(false);
    expect(isFreshSnapshot({ ...valid, roomId: "" }, now)).toBe(false);
    expect(isFreshSnapshot({ ...valid, pin: "abc" }, now)).toBe(false);
    expect(isFreshSnapshot({ ...valid, pin: "12345" }, now)).toBe(false); // not 6 digits
    expect(isFreshSnapshot({ ...valid, micOn: "yes" }, now)).toBe(false);
    expect(isFreshSnapshot({ roomId: "r", pin: "482015" }, now)).toBe(false); // missing fields
  });
});
