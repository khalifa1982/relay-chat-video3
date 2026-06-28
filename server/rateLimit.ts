/**
 * Tiny in-memory token-bucket rate limiter — a DoS/abuse backstop for the raw
 * HTTP signaling endpoints (the tRPC API is separate). Pure logic: `now` is
 * passed in so it's deterministic to unit-test.
 *
 * NOTE: state is per-instance (like the rest of `server/relay.ts`). On the rare
 * occasion Cloud Run runs >1 instance the effective limit is per-instance, which
 * is fine for an abuse backstop (limits are set generously so real users — even a
 * 6-way mesh blasting ICE candidates during setup — never hit them; only floods
 * do). Tunable/▒disable via env at the call sites.
 */
export interface TokenBucket {
  tokens: number;
  last: number; // ms timestamp of the last refill
}

export interface RateLimiterOptions {
  /** Max burst — the bucket size. */
  capacity: number;
  /** Sustained allowance, tokens added per second. */
  refillPerSec: number;
}

export interface RateLimiter {
  /** Consume one token for `key`. Returns true if allowed, false if throttled. */
  allow(key: string, now: number): boolean;
  /** Drop buckets idle longer than `maxIdleMs` so the map can't grow unbounded. */
  sweep(now: number, maxIdleMs: number): void;
  /** Current number of tracked keys (for tests/diagnostics). */
  size(): number;
}

export function createRateLimiter(opts: RateLimiterOptions): RateLimiter {
  const capacity = Math.max(1, opts.capacity);
  const refillPerSec = Math.max(0, opts.refillPerSec);
  const buckets = new Map<string, TokenBucket>();

  return {
    allow(key, now) {
      let b = buckets.get(key);
      if (!b) {
        b = { tokens: capacity, last: now };
        buckets.set(key, b);
      } else {
        // Refill proportionally to elapsed time, capped at capacity.
        const elapsedSec = Math.max(0, (now - b.last) / 1000);
        b.tokens = Math.min(capacity, b.tokens + elapsedSec * refillPerSec);
        b.last = now;
      }
      if (b.tokens >= 1) {
        b.tokens -= 1;
        return true;
      }
      return false;
    },
    sweep(now, maxIdleMs) {
      const stale: string[] = [];
      buckets.forEach((b, k) => {
        if (now - b.last > maxIdleMs) stale.push(k);
      });
      stale.forEach(k => buckets.delete(k));
    },
    size() {
      return buckets.size;
    },
  };
}

/**
 * Best-effort client IP for keying: the first hop in X-Forwarded-For (set by the
 * Cloudflare/Cloud Run front end), else the socket address. Never throws.
 */
export function clientIpOf(req: {
  headers?: Record<string, unknown>;
  socket?: { remoteAddress?: string };
  ip?: string;
}): string {
  try {
    const xff = req.headers?.["x-forwarded-for"];
    if (typeof xff === "string" && xff.length) {
      const first = xff.split(",")[0]?.trim();
      if (first) return first;
    }
    return req.ip || req.socket?.remoteAddress || "unknown";
  } catch {
    return "unknown";
  }
}
