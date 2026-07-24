import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

/**
 * v2.99.14 — MEDIA URL LOCKDOWN (owner: a video-note URL like
 * `/manus-storage/relay-chat/62/..._video-note_....webm` could be opened +
 * copied OUTSIDE the app; "everything should be encrypted, not traceable — the
 * file URL stays in the app").
 *
 * Root cause was NOT missing authorization (video notes are participant-gated
 * attachments) — it was that the proxy 307-REDIRECTED the browser to a
 * session-independent presigned S3/Forge URL, which is then visible in the
 * address bar / devtools and replayable by anyone for its lifetime. The fix:
 * STREAM the bytes through the cookie-gated proxy so no shareable storage URL
 * is ever emitted, and stop fail-open serving of unclassified keys to anons.
 *
 * Behavioral coverage lives in server/_core/storageProxy.test.ts (no redirect,
 * unknown+anon → 403) and server/storageProxy.test.ts (legal key streams 200,
 * no Location). This file pins the source-level invariants so they can't
 * silently regress.
 */

describe("v2.99.14 — the storage proxy streams, never redirects to a presigned URL", () => {
  const proxy = read("server/_core/storageProxy.ts");

  it("the handler NEVER 307-redirects (no res.redirect in the request path)", () => {
    // The whole point: a shareable presigned URL must never reach the browser.
    expect(proxy).not.toMatch(/res\.redirect\(/);
  });

  it("it streams the object body through the app (Readable.fromWeb + pipe)", () => {
    expect(proxy).toMatch(/import \{ Readable \} from "node:stream"/);
    expect(proxy).toMatch(/Readable\.fromWeb\(/);
    expect(proxy).toMatch(/\.pipe\(res\)/);
    // Range-aware so <video>/<audio> seeking still works.
    expect(proxy).toMatch(/const range = req\.headers\.range/);
    expect(proxy).toMatch(/Range: range/);
  });

  it("the presigned URL is resolved SERVER-SIDE only and never handed to the client", () => {
    // s3PresignGetUrl / the Forge presign are fetched here, not redirected to.
    expect(proxy).toMatch(/await fetch\(upstreamUrl/);
  });

  it("responses are PRIVATE-cached, never public (public would restore shareability)", () => {
    expect(proxy).toMatch(/Cache-Control", "private, max-age=60"/);
    expect(proxy).not.toMatch(/Cache-Control",\s*"public/);
  });

  it("an UNKNOWN (orphaned/guessed) key is refused to an anonymous caller — fail-open closed", () => {
    expect(proxy).toMatch(/authz\.kind === "unknown" && identityId == null/);
  });

  it("message attachments + status media stay participant/audience-gated (unchanged)", () => {
    expect(proxy).toMatch(/authz\.kind === "attachment" && !authz\.authorized/);
    expect(proxy).toMatch(/authz\.kind === "status" && !authz\.authorized/);
  });
});

describe("v2.99.14 — shared message media uploads through the participant-gated attachment path", () => {
  const messages = read("client/src/pages/app/Messages.tsx");
  const upload = read("client/src/lib/uploadAttachment.ts");

  it("video notes + voice notes ride uploadAttachment (an attachments row → participant gate), not the bare path", () => {
    // video-note / voice-note filenames flow into the normal attachment upload.
    expect(messages).toMatch(/video-note/);
    expect(messages).toMatch(/voice-note/);
    // the ?bare=1 (rowless, ungated) path is reserved for avatars/status only.
    expect(upload).not.toMatch(/bare=1[\s\S]*uploadFile/);
  });
});
