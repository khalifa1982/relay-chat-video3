import { describe, it, expect } from "vitest";
import { createRateLimiter, clientIpOf } from "./rateLimit";

describe("createRateLimiter — token bucket", () => {
  it("allows up to capacity, then throttles", () => {
    const rl = createRateLimiter({ capacity: 5, refillPerSec: 0 });
    const t = 1_000;
    for (let i = 0; i < 5; i++) expect(rl.allow("a", t)).toBe(true);
    expect(rl.allow("a", t)).toBe(false); // bucket empty
  });

  it("refills proportionally to elapsed time (capped at capacity)", () => {
    const rl = createRateLimiter({ capacity: 10, refillPerSec: 10 }); // 10/sec
    let t = 0;
    for (let i = 0; i < 10; i++) rl.allow("a", t); // drain
    expect(rl.allow("a", t)).toBe(false);
    t += 500; // +0.5s → +5 tokens
    for (let i = 0; i < 5; i++) expect(rl.allow("a", t)).toBe(true);
    expect(rl.allow("a", t)).toBe(false);
    // Long idle never exceeds capacity.
    t += 10_000;
    let allowed = 0;
    for (let i = 0; i < 100; i++) if (rl.allow("a", t)) allowed++;
    expect(allowed).toBe(10);
  });

  it("keys are independent", () => {
    const rl = createRateLimiter({ capacity: 1, refillPerSec: 0 });
    expect(rl.allow("a", 0)).toBe(true);
    expect(rl.allow("a", 0)).toBe(false);
    expect(rl.allow("b", 0)).toBe(true); // separate bucket
  });

  it("a realistic mesh-setup burst stays under the production limit", () => {
    // Production: capacity 1000, 200/s. A 6-way mesh setup is ~85 msgs; even
    // several users sharing one NAT during simultaneous setups stay under.
    const rl = createRateLimiter({ capacity: 1000, refillPerSec: 200 });
    let throttled = 0;
    const t = 5_000;
    for (let i = 0; i < 500; i++) if (!rl.allow("ip", t)) throttled++;
    expect(throttled).toBe(0);
  });

  it("sweep drops idle buckets", () => {
    const rl = createRateLimiter({ capacity: 2, refillPerSec: 1 });
    rl.allow("a", 0);
    rl.allow("b", 10_000);
    expect(rl.size()).toBe(2);
    rl.sweep(11_000, 5_000); // "a" idle 11s > 5s, "b" idle 1s
    expect(rl.size()).toBe(1);
  });
});

describe("clientIpOf", () => {
  it("uses the first X-Forwarded-For hop", () => {
    expect(clientIpOf({ headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" } })).toBe("1.2.3.4");
  });
  it("falls back to the socket address", () => {
    expect(clientIpOf({ headers: {}, socket: { remoteAddress: "9.9.9.9" } })).toBe("9.9.9.9");
  });
  it("never throws on a malformed request", () => {
    expect(clientIpOf({})).toBe("unknown");
  });
});
