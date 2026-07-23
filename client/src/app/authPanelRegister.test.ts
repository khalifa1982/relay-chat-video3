import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

/**
 * v2.99.0 registration overhaul (owner directive): the email is collected FIRST
 * (the email stage / gate), so the "register" step only asks first + last name
 * and shows the email READ-ONLY — never a second editable email field. The
 * post-registration "setup" step then shows the freshly-minted 6-digit RELAY
 * number and makes BOTH a profile photo AND a 4-digit passcode mandatory (the
 * old optional "Skip" is gone). Source-pinned (no DOM env).
 */
describe("AuthPanel — registration overhaul (email→name, mandatory number/passcode/photo)", () => {
  const src = read("client/src/app/AuthPanel.tsx");

  it("register step shows the email READ-ONLY (no second editable email input)", () => {
    // The old editable re-entry field is gone…
    expect(src).not.toMatch(/id="auth-email2"/);
    // …replaced by a read-only display of the already-known email.
    expect(src).toMatch(/Just your name to finish/);
    expect(src).toMatch(/<span className="truncate font-medium">\{cleanEmail\}<\/span>/);
    // first + last name are still collected
    expect(src).toMatch(/id="auth-first"/);
    expect(src).toMatch(/id="auth-last"/);
  });

  it("setup step shows the generated 6-digit RELAY number", () => {
    expect(src).toMatch(/Your RELAY number/);
    expect(src).toMatch(/whoami\.data\?\.number \? fmtNumber\(whoami\.data\.number\)/);
    expect(src).toMatch(/function fmtNumber\(/);
  });

  it("setup requires a profile photo AND a 4-digit passcode — the Skip path is gone", () => {
    // mandatory photo: uploaded via the bare-avatar path, gated on shownAvatar
    expect(src).toMatch(/uploadAvatarImage/);
    expect(src).toMatch(/Add a profile photo to finish/);
    expect(src).toMatch(/const shownAvatar =/);
    // mandatory passcode + both gate the Finish button
    expect(src).toMatch(/Your passcode is exactly 4 digits/);
    expect(src).toMatch(/disabled=\{busy \|\| avatarUploading \|\| !shownAvatar \|\| setupPin\.length !== 4 \|\| setupPin2\.length !== 4\}/);
    // no "skip setup" escape hatch anymore
    expect(src).not.toMatch(/skipSetup/);
    expect(src).not.toMatch(/Skip — email me a code/);
  });

  it("awaits the avatar SAVE (not just the upload) before marking it set", () => {
    // v2.98.0 lesson: the profile save is a separate round-trip; await it.
    expect(src).toMatch(/await updateProfile\.mutateAsync\(\{ avatarUrl: json\.url \}\)/);
  });
});
