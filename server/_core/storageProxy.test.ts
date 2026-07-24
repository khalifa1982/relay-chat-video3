import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Participant-only file access — proves the /manus-storage proxy's authorization
 * decision table: a raw URL alone never opens a message attachment; only the
 * uploader or a conversation participant can, and the check fails CLOSED. The DB
 * layer (authorizeStorageKey) and identity resolution (createContext) are mocked
 * so this pins the PROXY's enforcement independent of the DB.
 *
 * v2.99.14: the proxy no longer 307-REDIRECTS to a presigned storage URL (that
 * URL was session-independent and copyable/replayable outside the app). It now
 * STREAMS the bytes through this cookie-gated route. The storage backends are
 * mocked to "not configured" so an AUTHORIZED request deterministically stops
 * at the config check (500) WITHOUT a network fetch — every assertion here is
 * about the authorization verdict (403 / not-403) and the fact that no redirect
 * to a presigned URL is ever emitted.
 */
const { mockCreateContext, mockAuthorize } = vi.hoisted(() => ({
  mockCreateContext: vi.fn(),
  mockAuthorize: vi.fn(),
}));
vi.mock("./context", () => ({ createContext: mockCreateContext }));
vi.mock("../v2db", () => ({ authorizeStorageKey: mockAuthorize }));
// Storage backends unconfigured → an authorized request halts at the config
// guard (500) before any network I/O, keeping the test hermetic.
vi.mock("../s3", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../s3")>();
  return { ...actual, s3Config: () => null, s3PresignGetUrl: () => "" };
});
vi.mock("./env", () => ({ ENV: { forgeApiUrl: undefined, forgeApiKey: undefined } }));

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
    headersSent: false,
    redirectCalls: 0,
    status(c: number) { this.statusCode = c; return this; },
    send(b: any) { this.body = b; this.headersSent = true; return this; },
    set() { return this; },
    setHeader() { return this; },
    on() { return this; },
    end() { this.headersSent = true; return this; },
    destroy() { return this; },
    redirect(code: number, url: string) { this.redirectCalls++; this.statusCode = code; this.body = url; return this; },
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

  it("ALLOWS a message attachment to a participant / uploader (not 403) and NEVER redirects to a presigned URL", async () => {
    asIdentity(7);
    mockAuthorize.mockResolvedValue({ kind: "attachment", authorized: true });
    const r = mkRes();
    await handler()(mkReq("relay-chat/9/photo_ab12.jpg"), r);
    expect(r.statusCode).not.toBe(403);
    // v2.99.14: the browser must never be handed a shareable storage URL.
    expect(r.redirectCalls).toBe(0);
  });

  it("REFUSES an unknown key to anonymous — no presigned URL for a guessed/orphaned object (v2.99.14, 403)", async () => {
    asIdentity(null);
    mockAuthorize.mockResolvedValue({ kind: "unknown" });
    const r = mkRes();
    await handler()(mkReq("relay-chat/3/orphan_zz99.bin"), r);
    expect(r.statusCode).toBe(403);
  });

  it("SERVES an avatar/unknown key to an authenticated identity (not 403, still no redirect)", async () => {
    asIdentity(7);
    mockAuthorize.mockResolvedValue({ kind: "unknown" });
    const r = mkRes();
    await handler()(mkReq("relay-chat/3/avatar_zz99.jpg"), r);
    expect(r.statusCode).not.toBe(403);
    expect(r.redirectCalls).toBe(0);
  });

  it("SERVES a semi-public avatar even to anonymous (invite previews), and never redirects", async () => {
    asIdentity(null);
    mockAuthorize.mockResolvedValue({ kind: "avatar", authorized: true });
    const r = mkRes();
    await handler()(mkReq("relay-chat/3/avatar_zz99.jpg"), r);
    expect(r.statusCode).not.toBe(403);
    expect(r.redirectCalls).toBe(0);
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

  /**
   * Regression: the authorization check and the eventual S3 presign used to
   * run on DIFFERENT normalizations of the same key — authorizeStorageKey did
   * an exact-string DB match on the RAW key, while s3PresignGetUrl silently
   * collapsed a double slash back to the real single-slash key via
   * sanitizeS3Key. A double-slash variant of a real attachment's key missed
   * the exact-match lookup (classified `unknown`, the fail-open avatar
   * branch) but still normalized to — and served — the real private object.
   * The fix canonicalizes the key ONCE, up front, so both steps always agree.
   */
  it("normalizes a slash-mangled key BEFORE authorizing, closing the double-slash bypass", async () => {
    asIdentity(null);
    mockAuthorize.mockResolvedValue({ kind: "attachment", authorized: false });
    const r = mkRes();
    // A real attachment key with an extra "/" inserted must still be
    // recognized (and denied) as that SAME attachment — not fall through to
    // the "unknown" (avatar-like, served-to-anyone) classification.
    await handler()(mkReq("relay-chat/9//photo_ab12.jpg"), r);
    expect(mockAuthorize).toHaveBeenCalledWith("relay-chat/9/photo_ab12.jpg", null);
    expect(r.statusCode).toBe(403);
  });

  it("normalizes a leading-slash key the same way", async () => {
    asIdentity(null);
    mockAuthorize.mockResolvedValue({ kind: "attachment", authorized: false });
    const r = mkRes();
    await handler()(mkReq("/relay-chat/9/photo_ab12.jpg"), r);
    expect(mockAuthorize).toHaveBeenCalledWith("relay-chat/9/photo_ab12.jpg", null);
    expect(r.statusCode).toBe(403);
  });

  it("rejects a trailing-slash key (would-be empty segment) with 400, no auth work", async () => {
    const r = mkRes();
    await handler()(mkReq("relay-chat/9/photo_ab12.jpg/"), r);
    expect(r.statusCode).toBe(400);
    expect(mockAuthorize).not.toHaveBeenCalled();
  });
});
