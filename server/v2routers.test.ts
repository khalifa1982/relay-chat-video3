import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { pairKey } from "./v2db";

function makeCtx(identity: TrpcContext["identity"] = null): TrpcContext {
  return {
    user: null,
    identity,
    req: { protocol: "https", headers: {}, cookies: {} } as TrpcContext["req"],
    res: {
      cookie: () => undefined,
      clearCookie: () => undefined,
    } as unknown as TrpcContext["res"],
  };
}

describe("v2 routers — auth surface", () => {
  it("whoami returns null when no identity is present", async () => {
    const caller = appRouter.createCaller(makeCtx(null));
    const me = await caller.identity.whoami();
    expect(me).toBeNull();
  });

  it("whoami returns the resolved identity when one is attached", async () => {
    const fake = {
      id: 42,
      number: "812345",
      displayName: "Anya",
      avatarUrl: null,
      userId: null,
      isGuest: true,
      guestExpiresAt: new Date(),
    };
    const caller = appRouter.createCaller(makeCtx(fake));
    const me = await caller.identity.whoami();
    expect(me).toMatchObject({
      id: 42,
      number: "812345",
      displayName: "Anya",
      isGuest: true,
    });
  });

  it("rejects guest signup payloads with empty names", async () => {
    const caller = appRouter.createCaller(makeCtx(null));
    await expect(caller.identity.startGuest({ displayName: "   " })).rejects.toThrow();
  });

  it("contacts.upsert refuses when there is no identity", async () => {
    const caller = appRouter.createCaller(makeCtx(null));
    await expect(
      caller.contacts.upsert({ number: "123456", displayName: "x" })
    ).rejects.toThrow(/no identity/i);
  });

  it("contacts.upsert refuses when adding yourself", async () => {
    const fake = {
      id: 1,
      number: "555000",
      displayName: "Me",
      avatarUrl: null,
      userId: null,
      isGuest: true,
      guestExpiresAt: new Date(),
    };
    const caller = appRouter.createCaller(makeCtx(fake));
    await expect(
      caller.contacts.upsert({ number: "555000", displayName: "Me" })
    ).rejects.toThrow(/yourself/i);
  });

  it("messages.openThread rejects malformed numbers via zod", async () => {
    const fake = {
      id: 1,
      number: "555111",
      displayName: "Me",
      avatarUrl: null,
      userId: null,
      isGuest: true,
      guestExpiresAt: new Date(),
    };
    const caller = appRouter.createCaller(makeCtx(fake));
    await expect(
      caller.messages.openThread({ number: "12" as unknown as string })
    ).rejects.toThrow();
  });

  it("messages.send rejects payload missing both body and attachment", async () => {
    const fake = {
      id: 1,
      number: "555222",
      displayName: "Me",
      avatarUrl: null,
      userId: null,
      isGuest: true,
      guestExpiresAt: new Date(),
    };
    const caller = appRouter.createCaller(makeCtx(fake));
    await expect(
      caller.messages.send({
        conversationId: 1,
        kind: "text",
        body: "",
        attachmentId: null,
      })
    ).rejects.toThrow(/body or attachment/i);
  });
});

describe("pairKey", () => {
  it("orders ids deterministically regardless of input order", () => {
    expect(pairKey(2, 7)).toBe("2-7");
    expect(pairKey(7, 2)).toBe("2-7");
  });
});

describe("identity.updateProfile validation", () => {
  it("rejects when no identity is present", async () => {
    const caller = appRouter.createCaller(makeCtx(null));
    await expect(
      caller.identity.updateProfile({ displayName: "New Name" })
    ).rejects.toThrow(/no identity/i);
  });

  it("accepts a valid avatarUrl shape (URL) for an attached identity", async () => {
    const fake = {
      id: 9,
      number: "900111",
      displayName: "Profile Tester",
      avatarUrl: null,
      userId: null,
      isGuest: true,
      guestExpiresAt: new Date(),
    };
    const caller = appRouter.createCaller(makeCtx(fake));
    // zod should accept a well-formed URL (the DB write may fail in this
    // test environment, but that happens after validation — we just want
    // to confirm input shape validation passes).
    try {
      await caller.identity.updateProfile({
        avatarUrl: "https://example.com/a.png",
      });
    } catch (err) {
      // Acceptable: db-layer error. NOT acceptable: zod validation error.
      const msg = err instanceof Error ? err.message : String(err);
      expect(msg).not.toMatch(/invalid_string|invalid url/i);
    }
  });

  it("rejects non-URL avatarUrl values via zod", async () => {
    const fake = {
      id: 10,
      number: "900222",
      displayName: "Profile Tester",
      avatarUrl: null,
      userId: null,
      isGuest: true,
      guestExpiresAt: new Date(),
    };
    const caller = appRouter.createCaller(makeCtx(fake));
    await expect(
      caller.identity.updateProfile({ avatarUrl: "not a url" })
    ).rejects.toThrow();
  });

  it("accepts a /manus-storage/ relative path (the format storagePut returns)", async () => {
    // Regression for the avatar-upload bug: storagePut returns
    // "/manus-storage/{key}", not an absolute URL. The previous
    // z.string().url() validator rejected those with
    // { code: "invalid_format", format: "url", path: ["avatarUrl"] }.
    const fake = {
      id: 11,
      number: "900333",
      displayName: "Profile Tester",
      avatarUrl: null,
      userId: null,
      isGuest: true,
      guestExpiresAt: new Date(),
    };
    const caller = appRouter.createCaller(makeCtx(fake));
    try {
      await caller.identity.updateProfile({
        avatarUrl: "/manus-storage/relay-chat/11/abc_def.png",
      });
    } catch (err) {
      // Acceptable: a downstream DB error is fine; what we care about
      // is that zod did NOT reject the input as an invalid URL.
      const msg = err instanceof Error ? err.message : String(err);
      expect(msg).not.toMatch(/invalid_format|invalid url|invalid avatar url/i);
    }
  });

  it("still rejects garbage strings even with the relaxed validator", async () => {
    const fake = {
      id: 12,
      number: "900444",
      displayName: "Profile Tester",
      avatarUrl: null,
      userId: null,
      isGuest: true,
      guestExpiresAt: new Date(),
    };
    const caller = appRouter.createCaller(makeCtx(fake));
    await expect(
      caller.identity.updateProfile({ avatarUrl: "javascript:alert(1)" })
    ).rejects.toThrow();
    await expect(
      caller.identity.updateProfile({ avatarUrl: "./not-allowed.png" })
    ).rejects.toThrow();
  });
});

describe("identity.signOutGuest cookie behavior", () => {
  it("clears the relay_guest cookie even when no identity is present", async () => {
    const cleared: { name: string; opts: Record<string, unknown> }[] = [];
    const ctx: TrpcContext = {
      user: null,
      identity: null,
      req: { protocol: "https", headers: {}, cookies: {} } as TrpcContext["req"],
      res: {
        cookie: () => undefined,
        clearCookie: (name: string, opts: Record<string, unknown>) => {
          cleared.push({ name, opts });
        },
      } as unknown as TrpcContext["res"],
    };
    const caller = appRouter.createCaller(ctx);
    const result = await caller.identity.signOutGuest();
    expect(result).toMatchObject({ ok: true });
    expect(cleared.find((c) => c.name === "relay_guest")).toBeTruthy();
  });
});

/* ── v2 SSE event bus -------------------------------------------- */

import { _connectedCount, publishToIdentity, broadcastPresence } from "./v2events";

describe("v2 SSE event bus — publisher safety", () => {
  it("publishToIdentity is a no-op when no clients are connected", () => {
    expect(_connectedCount()).toBe(0);
    // Should not throw with no subscribers — this is the production hot path
    // when only one peer is online.
    expect(() =>
      publishToIdentity(99999, {
        kind: "message",
        conversationId: 1,
        from: 1,
      })
    ).not.toThrow();
  });

  it("broadcastPresence accepts both Date and ISO string lastSeenAt", () => {
    expect(() => broadcastPresence("123456", true, new Date())).not.toThrow();
    expect(() =>
      broadcastPresence("123456", false, new Date().toISOString())
    ).not.toThrow();
  });
});
