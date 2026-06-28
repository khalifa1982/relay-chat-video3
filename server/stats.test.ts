import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getPublicStats } from "./v2db";

/**
 * Public landing-page stats (aggregate-only counters).
 *
 * getPublicStats() must always resolve to a fully-populated, non-negative,
 * integer-shaped object even when the database is unavailable (it returns
 * zeros rather than throwing), so the landing page degrades gracefully.
 */
describe("getPublicStats — public aggregate counters", () => {
  it("resolves to an object with the four expected numeric keys", async () => {
    const stats = await getPublicStats();
    expect(stats).toBeTypeOf("object");
    for (const key of ["registeredUsers", "guestsServed", "totalParties", "onlineNow"] as const) {
      expect(stats).toHaveProperty(key);
      expect(typeof stats[key]).toBe("number");
      expect(Number.isFinite(stats[key])).toBe(true);
      expect(stats[key]).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(stats[key])).toBe(true);
    }
  });

  it("keeps guestsServed and registeredUsers within totalParties", async () => {
    const stats = await getPublicStats();
    // Every guest and every registered identity is itself an identity row,
    // so totalParties is the upper bound for guestsServed.
    expect(stats.guestsServed).toBeLessThanOrEqual(stats.totalParties);
    // onlineNow can never exceed the total number of parties either.
    expect(stats.onlineNow).toBeLessThanOrEqual(stats.totalParties);
  });
});

/**
 * Wiring guard: the stats router must be composed into the appRouter under
 * the `stats` namespace with a `public` procedure, so the frontend can call
 * trpc.stats.public.useQuery() without auth.
 */
describe("stats router wiring", () => {
  const routersSrc = readFileSync(resolve(__dirname, "routers.ts"), "utf8");
  it("registers v2StatsRouter as `stats` on the appRouter", () => {
    expect(routersSrc).toContain("v2StatsRouter");
    expect(routersSrc).toMatch(/stats:\s*v2StatsRouter/);
  });
  it("exposes a public stats procedure in v2routers.ts", () => {
    const v2Src = readFileSync(resolve(__dirname, "v2routers.ts"), "utf8");
    expect(v2Src).toContain("export const v2StatsRouter");
    expect(v2Src).toMatch(/public:\s*publicProcedure/);
  });
});
