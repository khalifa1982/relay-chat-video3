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
const WF = fs.readFileSync(path.join(ROOT, ".github/workflows/native-rn.yml"), "utf8");

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
    // All of path/password/alias must be present and the file must be real, so a
    // partially-set environment yields an unsigned build (visible) rather than a
    // debug-signed one (invisible).
    const guard = GRADLE.slice(
      GRADLE.indexOf("def ksFile ="),
      GRADLE.indexOf("signingConfigs {"),
    );
    expect(guard).toMatch(/ksPassword\?\.toString\(\)/);
    expect(guard).toMatch(/ksAlias\?\.toString\(\)/);
    expect(guard).toMatch(/ksFile\.isFile\(\)/);
  });

  it("a ZERO-BYTE keystore is refused (exists() alone is not enough)", () => {
    // `base64 -d` of an empty string exits 0 and leaves a 0-byte file, and
    // File.exists() is TRUE for it. That is precisely what an absent CI secret
    // decodes to, so an exists()-only guard would flip true on every secretless
    // run and fail the build trying to load a garbage keystore.
    expect(GRADLE).toMatch(/ksFile\.length\(\) > 0/);
    // The workflow rejects it at the decode step too — both sides of the trap.
    expect(WF).toMatch(/test -s "\$ks"/);
  });

  it("a RELATIVE keystore path is rejected rather than silently missing", () => {
    // Gradle's file() resolves a relative path against the app MODULE directory,
    // so a plausible-looking value lands somewhere unintended, exists() goes
    // false, and the build goes quietly unsigned with a green log.
    expect(GRADLE).toMatch(/!ksFile\.isAbsolute\(\)/);
    expect(GRADLE).toMatch(/throw new GradleException\("RELAY_KEYSTORE_PATH must be an ABSOLUTE path/);
    // …and CI stages to $RUNNER_TEMP, which is absolute by construction.
    expect(WF).toMatch(/ks="\$RUNNER_TEMP\/relay-upload\.keystore"/);
  });

  it("an INTENDED signed build that can't sign FAILS instead of going green-unsigned", () => {
    // Gradle is the only signer now. jarsigner used to exit non-zero on a bad or
    // empty password; an incomplete keystore here would instead leave the build
    // unsigned and green, and Play would only reject it at upload time — during a
    // store swap. RELAY_REQUIRE_SIGNED closes that gap.
    expect(GRADLE).toMatch(/def requireSigned = System\.getenv\("RELAY_REQUIRE_SIGNED"\)/);
    expect(GRADLE).toMatch(/if \(requireSigned\?\.toString\(\) && !hasUploadKeystore\) \{/);
    expect(GRADLE).toMatch(/throw new GradleException\("RELAY_REQUIRE_SIGNED is set but/);
    // CI sets it ONLY when it actually staged a keystore — otherwise every
    // secretless run and every fork PR would fail.
    expect(WF).toMatch(
      /RELAY_REQUIRE_SIGNED: \$\{\{ steps\.keystore\.outputs\.signed == 'true' && '1' \|\| '' \}\}/,
    );
  });

  it("credentials reach only the build step — not \\$GITHUB_ENV, not -P args", () => {
    // $GITHUB_ENV exposes a value to every later step in the job; `-P` puts it in
    // the process command line (visible to `ps`, and liable to surface in Gradle
    // failure output). GitHub masks registered secrets in logs, but the DECODED
    // keystore bytes are not a registered secret and are not masked.
    expect(WF).not.toMatch(/RELAY_KEYSTORE_PASSWORD[^\n]*GITHUB_ENV/);
    expect(WF).not.toMatch(/-PRELAY_KEYSTORE/);
    // Matched per-LINE: a prose mention of `set -x` in a comment is not the
    // hazard, an actual command is. (My own explanatory comment tripped the
    // naive whole-file version of this assertion.)
    expect(WF.split("\n").filter((l) => /^\s*set -[a-z]*x/.test(l))).toEqual([]);
    // The keystore is staged OUTSIDE the checkout, so no artifact glob can ever
    // publish it, and it is wiped with the job.
    expect(WF).not.toMatch(/base64 -d > [^\n]*mobile\//);
    expect(WF).toMatch(/chmod 600 "\$ks"/);
  });

  it("Gradle is the SINGLE signer — jarsigner no longer adds a second signature", () => {
    // This was the v2.99.52 bug: jarsigner ADDS rather than replaces, so signing
    // an already-signed bundle produced two signers, which Play can reject.
    expect(WF).not.toMatch(/jarsigner -keystore/);
    expect(WF).toMatch(/jarsigner -verify -strict/);
  });

  it("the AAB signature is verified DETERMINISTICALLY, not by jarsigner's exit code", () => {
    // `jarsigner -verify` can print "jar is unsigned" and still exit 0, so it
    // cannot be the only assertion. apksigner is not an option here: it cannot
    // read a bundle at all, because v2/v3 live in an APK Signing Block that
    // bundletool and Play never read on an AAB.
    expect(WF).toMatch(/unzip -l "\$aab" \| grep -qE 'META-INF\/\.\*\\\.\(RSA\|EC\|DSA\)'/);
    // The APK is verified with apksigner, where v2/v3 presence actually matters.
    expect(WF).toMatch(/apksigner" verify --print-certs -v "\$apk"/);
    // …at whatever build-tools version the runner has, never a hardcoded one.
    expect(WF).not.toMatch(/build-tools\/\d/);
  });

  it("the documented store-swap artifact NAME survives the mechanism change", () => {
    // mobile/README.md §3.2 tells the operator to upload
    // RELAY-RN-release-aab-SIGNED. The name is the contract: it means "signed and
    // uploadable". Dropping it would leave only an artifact whose step title used
    // to say "(unsigned)" while silently being signed on some runs.
    expect(WF).toMatch(/name: RELAY-RN-release-aab-SIGNED/);
    expect(WF).toMatch(/RELAY-RN-release-signed\.aab/);
    expect(WF).toMatch(/if-no-files-found: ignore/);
    // …and the plain AAB step no longer asserts something false.
    expect(WF).not.toMatch(/Upload release AAB \(unsigned\)/);
  });

  it("android-apk.yml is deliberately NOT converted", () => {
    // Its two projects (mobile/android TWA, mobile/app Capacitor) have no
    // signingConfig at all, so jarsigner is the ONLY signer there. A "consistency"
    // pass that removed it would leave those releases permanently unsigned.
    const apkWf = fs.readFileSync(path.join(ROOT, ".github/workflows/android-apk.yml"), "utf8");
    // `jarsigner \` with the flags on continuation lines, hence the [\s\S].
    expect(apkWf).toMatch(/jarsigner[\s\S]{0,40}-keystore \/tmp\/upload\.keystore/);
    expect(WF).toMatch(/jarsigner remains the SIGNER in android-apk\.yml/);
  });

  it("the release-APK artifact path tolerates the unsigned filename", () => {
    // AGP emits `app-release-unsigned.apk` with no signing config and
    // `app-release.apk` with one. v2.99.52 made the release unsigned by default,
    // so a hardcoded signed filename failed the upload (`if-no-files-found:
    // error`) even though the Gradle build succeeded — that is exactly how the
    // first run of the signing fix failed. A glob covers both.
    expect(WF).toMatch(/apk\/release\/app-release\*\.apk/);
    // Assert on the `path:` LINE, not the surrounding block: the step's own
    // comment explains both filenames, and the naive version of this assertion
    // matched that prose. Only the path directive can actually fail a run.
    const paths = WF.split("\n").filter(
      (l) => /^\s*path:/.test(l) && l.includes("apk/release/"),
    );
    expect(paths).toHaveLength(1);
    expect(paths[0]).not.toMatch(/app-release\.apk/);
    expect(paths[0]).toMatch(/app-release\*\.apk/);
  });

  it("does not tell QA to install an artifact that cannot be installed", () => {
    // An unsigned APK is not installable; the debug artifact is the device-test
    // build. The workflow comment must not still claim otherwise.
    expect(WF).not.toMatch(/debug-keystore signed/);
    expect(WF).toMatch(/RELAY-RN-debug-apk artifact/);
  });

  it("a secretless run stays GREEN and simply does not sign", () => {
    // Every fork push and every workflow_dispatch without secrets must still
    // build. v2.99.55 moved the guard EARLIER — it now gates whether the keystore
    // is staged at all, because an unconditional decode leaves a 0-byte file that
    // an exists()-only Gradle guard would accept. `:-` is required under `set -u`.
    expect(WF).toMatch(/if \[ -z "\$\{KEYSTORE_B64:-\}" \]; then/);
    expect(WF).toMatch(/echo "signed=false" >> "\$GITHUB_OUTPUT"/);
    // …and everything downstream of signing is conditional on that output.
    expect(WF).toMatch(/if: steps\.keystore\.outputs\.signed == 'true'/);
  });
});
