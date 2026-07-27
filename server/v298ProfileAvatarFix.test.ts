/**
 * v2.98.0 — setting an avatar: the save must actually finish before the UI says so
 * (owner: "when you're on [the profile] and you captured it, [it doesn't] post").
 *
 * ROOT CAUSE: setting an avatar is a two-step pipeline — upload the bytes to storage,
 * THEN persist the returned URL onto the profile via a separate tRPC mutation. The
 * second step was fired with `.mutate()` (fire-and-forget) while the busy spinner
 * cleared in a `finally` block that only awaited the FIRST step. That let the UI
 * report "done" the instant the upload finished, regardless of whether the profile
 * save completed — a save failure (session hiccup, dropped request) left a real,
 * uploaded photo in storage that the profile's `avatarUrl` never got pointed at, with
 * the UI having already signalled success. Fixed by awaiting the mutation in the SAME
 * try block as the upload, so the spinner and the error path cover the whole pipeline.
 *
 * WHERE THIS IS PINNED CHANGED IN v2.99.89, and the reason is worth stating: these
 * assertions used to read `Profile.tsx`'s `onAvatarPick`, which turned out to be
 * UNREACHABLE — nothing ever clicked the file input it was wired to, because the
 * avatar button opens `AvatarPicker`, which owns its own upload. So this file was
 * guarding a copy of the pipeline that could not run, while the copy that DOES run
 * was unguarded. The dead handler is now deleted and the assertions moved to
 * `AvatarPicker`. The property is unchanged; it is simply pointed at the live code.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");
const PICKER = read("client/src/app/AvatarPicker.tsx");
const PROFILE = read("client/src/pages/app/Profile.tsx");

/** The only two paths that put bytes in storage and then name them on the profile. */
const paths = [
  ["a photo from the library", "async function onPhoto("],
  ["an emoji or animated character", "async function pickEmoji("],
] as const;

describe("there is exactly ONE avatar upload path", () => {
  it("and it is not in Profile", () => {
    // Two upload paths for one photo is how they drift apart — and the Profile copy
    // had already drifted into being unreachable without anyone noticing.
    expect(PROFILE).not.toMatch(/uploadAvatarImage/);
    expect(PROFILE).not.toMatch(/type="file"/);
    expect(PICKER).toMatch(/import \{ uploadAvatarImage \} from "@\/lib\/uploadAttachment"/);
  });

  it("Profile still opens it, so nothing was taken away", () => {
    expect(PROFILE).toMatch(/<AvatarPicker\b/);
    expect(PROFILE).toMatch(/onClick=\{\(\) => setPickerOpen\(true\)\}/);
  });
});

describe("setting an avatar waits for the real save (v2.98.0)", () => {
  it("the save awaits the mutation — no fire-and-forget .mutate() anywhere", () => {
    const save = PICKER.slice(
      PICKER.indexOf("async function save("),
      PICKER.indexOf("async function pickEmoji(")
    );
    expect(save.length).toBeGreaterThan(80);
    expect(save).toMatch(/await updateProfile\.mutateAsync\(\{ avatarUrl: url \}\);/);
    expect(PICKER).not.toMatch(/[^.]updateProfile\.mutate\(/);
  });

  for (const [label, decl] of paths) {
    it(`${label}: upload and save share ONE try, so one catch covers both`, () => {
      const at = PICKER.indexOf(decl);
      expect(at, `${decl} exists`).toBeGreaterThan(-1);
      const fn = PICKER.slice(at, PICKER.indexOf("\n  }", PICKER.indexOf("} finally {", at)));
      const tryIdx = fn.indexOf("try {");
      const catchIdx = fn.indexOf("} catch");
      const uploadIdx = fn.indexOf("await uploadAvatarImage(");
      const saveIdx = fn.indexOf("await save(url)");
      expect(tryIdx).toBeGreaterThan(-1);
      expect(uploadIdx).toBeGreaterThan(tryIdx);
      expect(saveIdx).toBeGreaterThan(uploadIdx);
      expect(saveIdx).toBeLessThan(catchIdx);
    });

    it(`${label}: the busy spinner clears in finally, AFTER both awaits`, () => {
      const at = PICKER.indexOf(decl);
      const fn = PICKER.slice(at, PICKER.indexOf("\n  }", PICKER.indexOf("} finally {", at)));
      const finallyIdx = fn.indexOf("} finally {");
      const saveIdx = fn.indexOf("await save(url)");
      const clearIdx = fn.indexOf("setBusy(false);");
      expect(saveIdx).toBeGreaterThan(-1);
      expect(saveIdx).toBeLessThan(finallyIdx);
      expect(clearIdx).toBeGreaterThan(finallyIdx);
    });
  }
});
