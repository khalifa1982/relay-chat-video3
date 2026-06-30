import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

/**
 * v2.65 data-integrity / security fixes from a full-app backend audit:
 * messaging (reply spoofing, attachment ownership, deleted-message filtering)
 * and contacts (field format validation, transactional number-regen).
 */
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

const fakeMe = {
  id: 7,
  number: "123456",
  displayName: "Test User",
  avatarUrl: null,
  userId: null,
  isGuest: true,
  guestExpiresAt: new Date(),
};

describe("messages.send — data integrity", () => {
  it("rejects an attachmentId the caller doesn't own (no DB = never found = FORBIDDEN)", async () => {
    const caller = appRouter.createCaller(makeCtx(fakeMe));
    await expect(
      caller.messages.send({ conversationId: 1, body: "hi", attachmentId: 999 })
    ).rejects.toThrow(/not found|not yours|FORBIDDEN/i);
  });

  it("still rejects a whitespace-only body with no attachment", async () => {
    const caller = appRouter.createCaller(makeCtx(fakeMe));
    await expect(
      caller.messages.send({ conversationId: 1, body: "   " })
    ).rejects.toThrow(/body or attachment/i);
  });

  it("refuses without an identity", async () => {
    const caller = appRouter.createCaller(makeCtx(null));
    await expect(
      caller.messages.send({ conversationId: 1, body: "hi" })
    ).rejects.toThrow(/no identity/i);
  });
});

describe("contacts.upsert — field format validation", () => {
  it("rejects a malformed email", async () => {
    const caller = appRouter.createCaller(makeCtx(fakeMe));
    await expect(
      caller.contacts.upsert({ number: "482015", email: "not-an-email" })
    ).rejects.toThrow();
  });

  it("accepts a well-formed email (passes validation; DB unavailable in tests so it fails later, not on the email check)", async () => {
    const caller = appRouter.createCaller(makeCtx(fakeMe));
    const err = await caller.contacts
      .upsert({ number: "482015", email: "friend@example.com" })
      .catch((e) => e);
    expect(String(err.message || err)).not.toMatch(/email/i);
  });

  it("rejects a phone number with fewer than 4 digits", async () => {
    const caller = appRouter.createCaller(makeCtx(fakeMe));
    await expect(
      caller.contacts.upsert({ number: "482015", phone: "+1 5" })
    ).rejects.toThrow(/phone/i);
  });

  it("rejects a phone number with non-phone characters", async () => {
    const caller = appRouter.createCaller(makeCtx(fakeMe));
    await expect(
      caller.contacts.upsert({ number: "482015", phone: "call me maybe" })
    ).rejects.toThrow(/phone/i);
  });

  it("accepts a well-formed international phone number", async () => {
    const caller = appRouter.createCaller(makeCtx(fakeMe));
    const err = await caller.contacts
      .upsert({ number: "482015", phone: "+1 (555) 010-0123" })
      .catch((e) => e);
    expect(String(err.message || err)).not.toMatch(/phone/i);
  });

  it("rejects a website without http(s):// (blocks javascript:/data: URIs)", async () => {
    const caller = appRouter.createCaller(makeCtx(fakeMe));
    await expect(
      caller.contacts.upsert({ number: "482015", website: "javascript:alert(1)" })
    ).rejects.toThrow();
    await expect(
      caller.contacts.upsert({ number: "482015", website: "example.com" })
    ).rejects.toThrow();
  });

  it("accepts a well-formed https website", async () => {
    const caller = appRouter.createCaller(makeCtx(fakeMe));
    const err = await caller.contacts
      .upsert({ number: "482015", website: "https://example.com" })
      .catch((e) => e);
    expect(String(err.message || err)).not.toMatch(/website|http/i);
  });
});
