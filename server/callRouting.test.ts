/**
 * Calls → voicemail routing: the SAFETY tests (v2.107.48, owner).
 *
 * The whole feature was reverted once because it broke calling for everyone by
 * putting a DB round-trip in front of every ring. These tests pin the guarantee
 * that the rebuild does NOT do that:
 *
 *   1. routeCallToVoicemail is a SYNCHRONOUS in-memory check.
 *   2. A caller with NOTHING opted in (the whole system by default) gets `false`
 *      — "ring normally" — so the ring path is unchanged for them.
 *   3. The global master switch diverts everyone.
 *   4. The per-contact set diverts only the listed numbers.
 *   5. An all-off config is pruned from the cache (the common case keeps the map
 *      empty, so lookups are fast misses).
 *
 * These use the cache's test seams directly — no DB, no bus — because the point
 * is the ring-time decision logic that runs on the hot path.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  routeCallToVoicemail,
  _setRoutingForTests,
  _clearRoutingForTests,
  _routingCacheSize,
} from "./callRouting";

describe("call routing — ring-time decision (in-memory, synchronous)", () => {
  beforeEach(() => _clearRoutingForTests());

  it("returns false for a callee with nothing configured (normal ring, the default for everyone)", () => {
    // No entry at all.
    expect(routeCallToVoicemail("482015", "300300")).toBe(false);
    // The map is empty — a miss, not a stored all-off row.
    expect(_routingCacheSize()).toBe(0);
  });

  it("is synchronous — returns a boolean directly, never a promise", () => {
    const r = routeCallToVoicemail("482015", "300300");
    expect(typeof r).toBe("boolean");
    // A Promise would be truthy-object; assert it is a primitive.
    expect(r).not.toBeInstanceOf(Promise);
  });

  it("global master switch diverts EVERY caller", () => {
    _setRoutingForTests("482015", true, []);
    expect(routeCallToVoicemail("482015", "300300")).toBe(true);
    expect(routeCallToVoicemail("482015", "999999")).toBe(true);
    // A DIFFERENT callee with no config still rings.
    expect(routeCallToVoicemail("777700", "300300")).toBe(false);
  });

  it("per-contact set diverts only the listed numbers, rings everyone else", () => {
    _setRoutingForTests("482015", false, ["300300", "445566"]);
    expect(routeCallToVoicemail("482015", "300300")).toBe(true);
    expect(routeCallToVoicemail("482015", "445566")).toBe(true);
    // Not in the set → rings.
    expect(routeCallToVoicemail("482015", "111222")).toBe(false);
  });

  it("prunes an all-off config so the common case leaves the map empty", () => {
    _setRoutingForTests("482015", true, ["300300"]);
    expect(_routingCacheSize()).toBe(1);
    // Turn everything off → the entry is removed, not stored as an all-false row.
    _setRoutingForTests("482015", false, []);
    expect(_routingCacheSize()).toBe(0);
    expect(routeCallToVoicemail("482015", "300300")).toBe(false);
  });

  it("master ON supersedes the (empty) per-contact set — everyone diverts", () => {
    _setRoutingForTests("482015", true, ["300300"]);
    // Even a caller not in the list is diverted, because `all` wins.
    expect(routeCallToVoicemail("482015", "111222")).toBe(true);
  });
});
