/**
 * v2.98.0 — profile avatar capture: the save must actually finish before the
 * UI says so (owner: "when you're on [the profile] and you captured it, [it
 * doesn't] post").
 *
 * ROOT CAUSE: `onAvatarPick` is a two-step pipeline — upload the bytes to
 * storage, THEN persist the returned URL onto the profile via a separate
 * tRPC mutation. The second step was fired with `.mutate()` (fire-and-forget)
 * while the `uploading` spinner cleared in a `finally` block that only
 * awaited the FIRST step (the upload). That let the UI report "done" (camera
 * badge stops spinning) the instant the upload finished, regardless of
 * whether the profile save actually completed — a save failure (session
 * hiccup, dropped request, etc.) left a real, uploaded photo in storage that
 * the profile's `avatarUrl` never actually got pointed at, with the UI having
 * already signalled success. Fixed by awaiting `updateProfile.mutateAsync`
 * in the SAME try block as the upload, so the spinner and the error path
 * both cover the whole pipeline, not just the first half of it.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PROFILE = readFileSync(
  join(__dirname, "..", "client/src/pages/app/Profile.tsx"),
  "utf8",
);

const onAvatarPick = PROFILE.slice(
  PROFILE.indexOf("async function onAvatarPick"),
  PROFILE.indexOf("function clearAvatar"),
);

describe("Profile avatar capture waits for the real save (v2.98.0)", () => {
  it("awaits the profile save with mutateAsync — no fire-and-forget .mutate() left", () => {
    expect(onAvatarPick).toMatch(/await updateProfile\.mutateAsync\(\{ avatarUrl: json\.url \}\);/);
    expect(onAvatarPick).not.toMatch(/[^.]updateProfile\.mutate\(\{ avatarUrl: json\.url \}\);/);
  });

  it("the save awaits inside the SAME try block as the upload, so one catch covers both failures", () => {
    const tryIdx = onAvatarPick.indexOf("try {");
    const catchIdx = onAvatarPick.indexOf("} catch");
    const uploadIdx = onAvatarPick.indexOf("await uploadAvatarImage(");
    const saveIdx = onAvatarPick.indexOf("await updateProfile.mutateAsync(");
    expect(tryIdx).toBeGreaterThan(-1);
    expect(uploadIdx).toBeGreaterThan(tryIdx);
    expect(saveIdx).toBeGreaterThan(uploadIdx);
    expect(saveIdx).toBeLessThan(catchIdx);
  });

  it("the uploading spinner only clears in finally, AFTER both awaits — no early 'done' signal", () => {
    const finallyIdx = onAvatarPick.indexOf("} finally {");
    const saveIdx = onAvatarPick.indexOf("await updateProfile.mutateAsync(");
    const setUploadingFalseIdx = onAvatarPick.indexOf("setUploading(false);");
    expect(saveIdx).toBeLessThan(finallyIdx);
    expect(setUploadingFalseIdx).toBeGreaterThan(finallyIdx);
  });
});
