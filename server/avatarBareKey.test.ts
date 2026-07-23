import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * v2.99.2 — profile-photo (avatar) fixes.
 *
 * BUG: since v2.96.1 avatars upload via `?bare=1`, which named the object
 * `status_…`. authorizeStorageKey treats every `/status_` key as rich-status
 * media and FAILS CLOSED without an active status row — so every avatar
 * uploaded that way 403'd (owner: re-uploaded photo shows broken). Two fixes,
 * pinned against source (the full flow needs S3 + MySQL):
 *   1. avatars now mint `avatar_…` keys (`?bare=1&avatar=1`);
 *   2. the status gate RESCUES a `status_…` key that is some identity's current
 *      avatar, healing every already-broken photo with no migration.
 */
const upload = readFileSync(join(__dirname, "v2upload.ts"), "utf8");
const v2db = readFileSync(join(__dirname, "v2db.ts"), "utf8");
const client = readFileSync(join(__dirname, "..", "client/src/lib/uploadAttachment.ts"), "utf8");

describe("avatar bare-upload key naming (v2.99.2)", () => {
  it("the raw ?bare path mints avatar_ keys when avatar=1, else status_", () => {
    expect(upload).toMatch(/const isAvatar = req\.query\.avatar === "1"/);
    expect(upload).toMatch(/const bname = isAvatar \? "avatar" : "status"/);
    expect(upload).toMatch(/relay-chat\/\$\{identityId\}\/\$\{bname\}_/);
  });
  it("the base64 ?bare path mirrors the avatar flag (native app)", () => {
    expect(upload).toMatch(/const isAvatar = body\.avatar === true/);
  });
  it("an avatar upload rejects non-image mime", () => {
    expect(upload).toMatch(/Profile photos must be images/);
  });
  it("the client marks avatar uploads with avatar=1", () => {
    expect(client).toMatch(/if \(opts\?\.avatar\) qs\.set\("avatar", "1"\)/);
    expect(client).toMatch(/uploadBare\(blob, opts\.mimeType \|\| blob\.type \|\| "image\/jpeg", \{ avatar: true \}\)/);
  });
});

describe("authorizeStorageKey rescues legacy status_-named avatars (v2.99.2)", () => {
  it("a status_ key with NO active status row is served IF it's an identity's avatar", () => {
    // Inside the `/status_/` branch, the no-active-row path consults
    // isIdentityAvatarKey before failing closed.
    const seg = v2db.slice(v2db.indexOf('if (/\\/status_/.test(storageKey))'));
    const branch = seg.slice(0, seg.indexOf("const att = await getAttachmentByStorageKey"));
    expect(branch).toMatch(/if \(!st\) \{/);
    expect(branch).toMatch(/if \(await isIdentityAvatarKey\(storageKey\)\) return \{ kind: "avatar", authorized: true \}/);
    // …and genuinely-expired status media (not an avatar) still fails closed.
    expect(branch).toMatch(/return \{ kind: "status", authorized: false \}/);
  });
});
