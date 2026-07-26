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
  /**
   * Consume `cost` tokens for `key`. Returns true if allowed, false if throttled.
   *
   * `cost` DEFAULTS TO 1, and that default is load-bearing: this limiter backs the
   * directory gate, the OTP gate, the status gate, the guest-mint gate, the upload
   * buckets, the storage proxy and the signaling flood guard, and every one of
   * those call sites passes two arguments. Making the cost mandatory would change
   * all of them at once (v2.99.81).
   *
   * A cost exists because some endpoints do N times the work of others for one
   * call — `directory.presenceMany` resolves up to 100 numbers per request, so at
   * a flat one token per call its enumeration throttle was 100x weaker than
   * `directory.lookup`'s.
   */
  allow(key: string, now: number, cost?: number): boolean;
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
    allow(key, now, cost = 1) {
      // A cost below 1 would let an unbounded number of calls through; above
      // capacity it could never succeed even on a full bucket, which reads as a
      // permanently broken endpoint rather than a throttle.
      const need = Math.min(capacity, Math.max(1, cost));
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
      if (b.tokens >= need) {
        b.tokens -= need;
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
 * How many trusted reverse-proxy hops sit in front of this process. The client
 * IP is the entry X-Forwarded-For appends `hops` positions from the RIGHT.
 * Default 1 = a single front proxy (the `.io` AWS ALB, which appends the real
 * peer IP as the last hop). Set `RELAY_TRUSTED_PROXY_HOPS=2` for a CloudFront →
 * ALB chain, etc. Garbage / <1 values fall back to 1.
 */
export function trustedProxyHops(): number {
  const raw = process.env.RELAY_TRUSTED_PROXY_HOPS;
  const n = raw == null ? 1 : Number(raw);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

/**
 * Best-effort client IP for keying rate limiters. Never throws.
 *
 * SECURITY (F4): X-Forwarded-For is a client-appendable list — a request can
 * arrive with a forged `X-Forwarded-For: <spoof>` and the trusted front proxy
 * (ALB) APPENDS the real peer IP to the RIGHT. Trusting the LEFTMOST hop (the
 * old behavior) therefore let an attacker rotate that header to mint a fresh
 * rate-limit bucket per request and defeat every per-IP limiter. We instead
 * trust the hop `trustedProxyHops()` positions from the right — the one the ALB
 * itself wrote — which a client cannot forge. Falls back to the leftmost real
 * hop if the list is shorter than expected, then to the socket address.
 */
export function clientIpOf(req: {
  headers?: Record<string, unknown>;
  socket?: { remoteAddress?: string };
  ip?: string;
}): string {
  try {
    const xff = req.headers?.["x-forwarded-for"];
    if (typeof xff === "string" && xff.length) {
      const hops = xff.split(",").map((s) => s.trim()).filter(Boolean);
      if (hops.length) {
        const idx = Math.max(0, hops.length - trustedProxyHops());
        const ip = hops[idx];
        if (ip) return ip.replace(/^::ffff:/i, "");
      }
    }
    return (req.ip || req.socket?.remoteAddress || "unknown").replace(/^::ffff:/i, "");
  } catch {
    return "unknown";
  }
}
