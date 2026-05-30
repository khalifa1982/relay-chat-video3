import { describe, it, expect } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import http from "http";
import { AddressInfo } from "net";

/**
 * Regression test for the v2.0.6 production bug:
 *
 *   The server never installed `cookie-parser`, so `req.cookies` was always
 *   undefined for every request — including `/api/trpc/identity.whoami`.
 *   `res.cookie()` (write) does not need cookie-parser, but `req.cookies`
 *   (read) does. The startGuest mutation set the relay_guest cookie just
 *   fine, but the very next request couldn't read it back, so the user got
 *   stuck on the onboarding gate forever.
 *
 * This test guards against that regression by spinning up a minimal Express
 * app with `cookie-parser` mounted (matching `server/_core/index.ts`) and
 * verifying that an inbound `Cookie:` header is parsed into `req.cookies`.
 */
describe("cookie-parser middleware", () => {
  it("populates req.cookies so guest identity resolution can work", async () => {
    const app = express();
    app.use(cookieParser());

    let parsedCookies: Record<string, unknown> | undefined;
    app.get("/echo", (req, res) => {
      parsedCookies = req.cookies as Record<string, unknown> | undefined;
      res.json({ cookies: req.cookies ?? null });
    });

    const server = http.createServer(app);
    await new Promise<void>(resolve => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/echo`, {
        headers: { Cookie: "relay_guest=abcdef1234" },
      });
      const body = (await res.json()) as { cookies: Record<string, string> | null };
      expect(body.cookies).toEqual({ relay_guest: "abcdef1234" });
      expect(parsedCookies).toEqual({ relay_guest: "abcdef1234" });
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

  it("returns empty object when no Cookie header is sent (not undefined)", async () => {
    const app = express();
    app.use(cookieParser());

    app.get("/echo", (req, res) => {
      // The key guarantee: req.cookies is defined (an object), not undefined.
      // Code paths like `req.cookies?.[GUEST_COOKIE]` only work because of this.
      res.json({ hasCookies: req.cookies !== undefined, value: req.cookies });
    });

    const server = http.createServer(app);
    await new Promise<void>(resolve => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/echo`);
      const body = (await res.json()) as { hasCookies: boolean; value: unknown };
      expect(body.hasCookies).toBe(true);
      expect(body.value).toEqual({});
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
});
