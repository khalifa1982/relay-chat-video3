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
