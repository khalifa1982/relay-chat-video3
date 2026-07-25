import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * v2.99.52 — the RELEASE build type must never be signed with the DEBUG key.
 *
 * `mobile/native/android/app/build.gradle` shipped the React Native template
 * default, `release { signingConfig signingConfigs.debug }`. Two problems:
 *
 *   1. A local or CI `assembleRelease` produced a debug-signed artifact that
 *      looks shippable — nothing about the file says "do not upload this".
 *   2. `native-rn.yml` signs the AAB afterwards with the real upload key, but
 *      `jarsigner` ADDS a signature rather than replacing one, so the bundle
 *      handed to Play carried TWO signers. Play can reject that outright, and
 *      "it's re-signed in CI so the store artifact is fine" was optimistic.
 *
 * The release build now uses a real keystore when one is configured and is
 * otherwise UNSIGNED, which is what makes the CI signature single and correct.
 *
 * Source-pinned rather than executed: there is no Android SDK in the unit
 * environment (the real build runs in native-rn.yml, which triggers on any push
 * touching mobile/native/**).
 */
const ROOT = path.resolve(__dirname, "..");
const GRADLE = fs.readFileSync(
  path.join(ROOT, "mobile/native/android/app/build.gradle"),
  "utf8",
);

/** The body of one `buildTypes { <name> { … } }` entry. */
function buildType(name: string): string {
  const types = GRADLE.slice(GRADLE.indexOf("buildTypes {"));
  const start = types.indexOf(`${name} {`);
  expect(start, `buildTypes.${name} exists`).toBeGreaterThan(-1);
  // Entries are one indent level in; the next sibling starts at the same depth.
  const rest = types.slice(start);
  const end = rest.indexOf("\n        }");
  return rest.slice(0, end === -1 ? rest.length : end);
}

describe("Android release signing", () => {
  it("the RELEASE build type is never signed with the debug key", () => {
    expect(buildType("release")).not.toMatch(/signingConfigs\.debug/);
  });

  it("release signs with a real keystore when configured, and is UNSIGNED otherwise", () => {
    expect(buildType("release")).toMatch(
      /signingConfig hasUploadKeystore \? signingConfigs\.release : null/,
    );
  });

  it("the debug build type still uses the debug key (unchanged)", () => {
    expect(buildType("debug")).toMatch(/signingConfig signingConfigs\.debug/);
  });

  it("the keystore comes from env or gradle properties, never the repo", () => {
    for (const v of [
      "RELAY_KEYSTORE_PATH",
      "RELAY_KEYSTORE_PASSWORD",
      "RELAY_KEY_ALIAS",
      "RELAY_KEY_PASSWORD",
    ]) {
      expect(GRADLE, `${v} is read`).toContain(v);
    }
    // No real keystore or password is committed. `debug.keystore` and the
    // universally-known 'android' debug password are the deliberate exceptions.
    const committed = fs
      .readdirSync(path.join(ROOT, "mobile/native/android/app"))
      .filter((f) => /\.(jks|keystore)$/i.test(f));
    expect(committed).toEqual(["debug.keystore"]);
  });

  it("a half-configured keystore does NOT silently fall back", () => {
    // All of path/password/alias must be present and the file must exist, so a
    // partially-set environment yields an unsigned build (visible) rather than a
    // debug-signed one (invisible).
    const guard = GRADLE.slice(
      GRADLE.indexOf("def hasUploadKeystore"),
      GRADLE.indexOf("signingConfigs {"),
    );
    expect(guard).toMatch(/ksPath\?\.toString\(\)/);
    expect(guard).toMatch(/ksPassword\?\.toString\(\)/);
    expect(guard).toMatch(/ksAlias\?\.toString\(\)/);
    expect(guard).toMatch(/file\(ksPath\.toString\(\)\)\.exists\(\)/);
  });

  it("the release-APK artifact path tolerates the unsigned filename", () => {
    // AGP emits `app-release-unsigned.apk` with no signing config and
    // `app-release.apk` with one. v2.99.52 made the release unsigned by default,
    // so a hardcoded signed filename failed the upload (`if-no-files-found:
    // error`) even though the Gradle build succeeded — that is exactly how the
    // first run of the signing fix failed. A glob covers both.
    const wf = fs.readFileSync(path.join(ROOT, ".github/workflows/native-rn.yml"), "utf8");
    expect(wf).toMatch(/apk\/release\/app-release\*\.apk/);
    expect(wf).not.toMatch(/apk\/release\/app-release\.apk/);
  });

  it("does not tell QA to install an artifact that cannot be installed", () => {
    // An unsigned APK is not installable; the debug artifact is the device-test
    // build. The workflow comment must not still claim otherwise.
    const wf = fs.readFileSync(path.join(ROOT, ".github/workflows/native-rn.yml"), "utf8");
    expect(wf).not.toMatch(/debug-keystore signed/);
    expect(wf).toMatch(/RELAY-RN-debug-apk artifact/);
  });

  it("the CI signing step still guards on the secret being present", () => {
    // Without the secret the workflow must stay green and simply not sign —
    // otherwise every fork/PR build fails. (Its jarsigner now signs an UNSIGNED
    // bundle, which is what makes the result single-signer.)
    const wf = fs.readFileSync(path.join(ROOT, ".github/workflows/native-rn.yml"), "utf8");
    expect(wf).toMatch(/if \[ -z "\$KEYSTORE_B64" \]/);
    expect(wf).toMatch(/jarsigner -keystore/);
  });
});
