import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Participant-only file access — proves the /manus-storage proxy's authorization
 * decision table: a raw URL alone never opens a message attachment; only the
 * uploader or a conversation participant can, and the check fails CLOSED. The DB
 * layer (authorizeStorageKey) and identity resolution (createContext) are mocked
 * so this pins the PROXY's enforcement independent of the DB.
 */
const { mockCreateContext, mockAuthorize } = vi.hoisted(() => ({
  mockCreateContext: vi.fn(),
  mockAuthorize: vi.fn(),
}));
vi.mock("./context", () => ({ createContext: mockCreateContext }));
vi.mock("../v2db", () => ({ authorizeStorageKey: mockAuthorize }));

import { registerStorageProxy } from "./storageProxy";

type Handler = (req: any, res: any) => Promise<void> | void;
function handler(): Handler {
  let h: Handler = () => {};
  registerStorageProxy({ get: (_p: string, fn: Handler) => { h = fn; } } as any);
  return h;
}
function mkRes() {
  return {
    statusCode: 0,
    body: null as any,
    status(c: number) { this.statusCode = c; return this; },
    send(b: any) { this.body = b; return this; },
    set() { return this; },
    redirect(code: number, url: string) { this.statusCode = code; this.body = url; return this; },
    json(o: any) { this.body = o; return this; },
  };
}
const mkReq = (key: string) => ({ params: { 0: key }, headers: {}, cookies: {} });
const asIdentity = (id: number | null) =>
  mockCreateContext.mockResolvedValue({ identity: id == null ? null : { id } });

describe("storage proxy — participant-only file access", () => {
  beforeEach(() => { mockCreateContext.mockReset(); mockAuthorize.mockReset(); });

  it("DENIES a message attachment to a non-participant (403)", async () => {
    asIdentity(99);
    mockAuthorize.mockResolvedValue({ kind: "attachment", authorized: false });
    const r = mkRes();
    await handler()(mkReq("relay-chat/9/photo_ab12.jpg"), r);
    expect(r.statusCode).toBe(403);
    expect(mockAuthorize).toHaveBeenCalledWith("relay-chat/9/photo_ab12.jpg", 99);
  });

  it("DENIES a message attachment to anonymous (no identity) (403)", async () => {
    asIdentity(null);
    mockAuthorize.mockResolvedValue({ kind: "attachment", authorized: false });
    const r = mkRes();
    await handler()(mkReq("relay-chat/9/voice_ab12.m4a"), r);
    expect(r.statusCode).toBe(403);
  });

  it("ALLOWS a message attachment to a participant / uploader (not 403)", async () => {
    asIdentity(7);
    mockAuthorize.mockResolvedValue({ kind: "attachment", authorized: true });
    const r = mkRes();
    await handler()(mkReq("relay-chat/9/photo_ab12.jpg"), r);
    expect(r.statusCode).not.toBe(403);
  });

  it("DENIES an unknown key (avatar/other) to anonymous (403)", async () => {
    asIdentity(null);
    mockAuthorize.mockResolvedValue({ kind: "unknown" });
    const r = mkRes();
    await handler()(mkReq("relay-chat/3/avatar_zz99.jpg"), r);
    expect(r.statusCode).toBe(403);
  });

  it("ALLOWS an unknown key (avatar) to any authenticated identity (not 403)", async () => {
    asIdentity(7);
    mockAuthorize.mockResolvedValue({ kind: "unknown" });
    const r = mkRes();
    await handler()(mkReq("relay-chat/3/avatar_zz99.jpg"), r);
    expect(r.statusCode).not.toBe(403);
  });

  it("fails CLOSED (503) when the auth check throws — never leaks on a DB blip", async () => {
    asIdentity(7);
    mockAuthorize.mockRejectedValue(new Error("db down"));
    const r = mkRes();
    await handler()(mkReq("relay-chat/9/photo_ab12.jpg"), r);
    expect(r.statusCode).toBe(503);
  });

  it("rejects path traversal BEFORE any auth work (400)", async () => {
    const r = mkRes();
    await handler()(mkReq("relay-chat/../secret"), r);
    expect(r.statusCode).toBe(400);
    expect(mockAuthorize).not.toHaveBeenCalled();
  });
});
