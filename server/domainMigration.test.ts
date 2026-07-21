import { describe, it, expect } from "vitest";
import type { Express } from "express";
import { registerDomainMigration } from "./domainMigration";

/**
 * The .org→.io 301 shim (owner's domain migration, 2026-07-21). Pins that the
 * retired hosts redirect path-preserving to the canonical .io origin, and that
 * every other Host (the live domain, health checks, IPs) passes through.
 */
function capture() {
  let mw: ((req: unknown, res: unknown, next: () => void) => void) | null = null;
  const app = { use: (fn: typeof mw) => { mw = fn; } } as unknown as Express;
  registerDomainMigration(app);
  if (!mw) throw new Error("middleware not registered");
  return mw as (req: unknown, res: unknown, next: () => void) => void;
}

function run(mw: ReturnType<typeof capture>, host: string | undefined, url = "/app?x=1") {
  let redirect: { code: number; to: string } | null = null;
  let nexted = false;
  mw(
    { headers: { host }, originalUrl: url },
    { redirect: (code: number, to: string) => { redirect = { code, to }; } },
    () => { nexted = true; },
  );
  return { redirect: redirect as { code: number; to: string } | null, nexted };
}

describe("domain migration — .org 301s to .io", () => {
  const mw = capture();

  it("301s the retired apex + www hosts, preserving the path/query", () => {
    for (const h of ["your-chat.org", "www.your-chat.org", "YOUR-CHAT.ORG", "your-chat.org:443"]) {
      const r = run(mw, h, "/i/123456?video=1");
      expect(r.redirect).toEqual({ code: 301, to: "https://your-chat.io/i/123456?video=1" });
      expect(r.nexted).toBe(false);
    }
  });

  it("passes every other Host straight through (live domain, health checks, IPs)", () => {
    for (const h of ["your-chat.io", "www.your-chat.io", "localhost:3000", "10.0.1.5", undefined]) {
      const r = run(mw, h);
      expect(r.redirect).toBeNull();
      expect(r.nexted).toBe(true);
    }
  });
});
