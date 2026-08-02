import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { verifyTimeoutMsFor } from "../lib/apk-update-config";

const ROOT = resolve(__dirname, "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

/**
 * Hardening of the self-hosted APK update path.
 *
 * WHAT ACTUALLY PROTECTS THE USER, stated plainly because it determines how much
 * of this matters: Android's package installer refuses an update whose signing
 * certificate differs from the installed app's, and refuses a versionCode
 * downgrade. That is the trust anchor against a tampered APK — not this code.
 * The manifest digest is defence in depth against a corrupt or partial download,
 * and it is weaker than it looks because the manifest and the APK are served by
 * the SAME host.
 *
 * What was wrong was not the absence of a perfect check; it was that the check
 * reported success when it had not run:
 *
 *  - a flat 10s timeout on a JS SHA-256 of a ~53MB file, which the file's own
 *    comment admitted was "the common case" — so the digest was decorative;
 *  - on timeout it installed anyway and called it verified;
 *  - a DETECTED mismatch deleted the file, re-downloaded the same URL, and could
 *    then install it via that same timeout allowance;
 *  - `expectedSize` was a parameter the only call site never passed, so the
 *    documented size check was dead code. On a typical device the sole surviving
 *    check was "the file exists and is non-empty".
 */
describe("verification budget scales with file size", () => {
  it("a 53MB APK gets far more than the old flat 10s", () => {
    const ms = verifyTimeoutMsFor(53 * 1024 * 1024);
    expect(ms).toBeGreaterThan(60_000);
  });

  it("a small file still gets a usable floor", () => {
    expect(verifyTimeoutMsFor(1024)).toBeGreaterThanOrEqual(20_000);
  });

  it("is bounded, so a pathological size cannot hang the update UI", () => {
    expect(verifyTimeoutMsFor(50 * 1024 * 1024 * 1024)).toBeLessThanOrEqual(180_000);
  });

  it("is monotonic and safe for degenerate inputs", () => {
    expect(verifyTimeoutMsFor(10 * 1024 * 1024)).toBeLessThan(verifyTimeoutMsFor(80 * 1024 * 1024));
    expect(verifyTimeoutMsFor(0)).toBeGreaterThan(0);
    expect(verifyTimeoutMsFor(-1)).toBeGreaterThan(0);
    expect(Number.isFinite(verifyTimeoutMsFor(0))).toBe(true);
  });
});

describe("a detected mismatch is terminal", () => {
  const INTEGRITY = read("lib/apk-integrity.ts");
  const HOOK = read("hooks/use-apk-update.ts");

  it("the timeout allowance can be withdrawn by the caller", () => {
    expect(INTEGRITY).toMatch(/allowSkipOnTimeout\?: boolean/);
    expect(INTEGRITY).toMatch(/shouldInstall: allowSkipOnTimeout/);
  });

  it("a mismatch is reported distinctly, not folded into a generic failure", () => {
    // The caller needs to tell "wrong bytes" apart from "could not check".
    expect(INTEGRITY).toMatch(/mismatch: boolean/);
    expect(INTEGRITY).toMatch(/verified: boolean/);
  });

  it("the hook makes the mismatch sticky and withdraws the allowance on retry", () => {
    expect(HOOK).toMatch(/const sawMismatchRef = useRef\(false\)/);
    expect(HOOK).toMatch(/allowSkipOnTimeout: !sawMismatchRef\.current/);
    expect(HOOK).toMatch(/if \(verifyResult\.mismatch\) sawMismatchRef\.current = true/);
  });

  it("the size check is actually reachable — the caller passes a size", () => {
    expect(HOOK).toMatch(/expectedBytesRef\.current,/);
    expect(HOOK).toMatch(/expectedBytesRef\.current = p\.totalBytesExpectedToWrite/);
  });

  it("`verified` is only true when a digest really matched", () => {
    // So no surface can claim verification that did not happen.
    const timeoutBranch = INTEGRITY.slice(INTEGRITY.indexOf("} catch (err) {"));
    expect(timeoutBranch).toMatch(/verified: false/);
    const noHash = INTEGRITY.slice(INTEGRITY.indexOf("No hash in manifest"));
    expect(noHash.slice(0, 200)).toMatch(/verified: false/);
  });

  it("no path still claims HTTPS makes an unverified install fine", () => {
    // The old copy asserted transport trust as if it substituted for the digest.
    expect(INTEGRITY).not.toMatch(/installing via HTTPS trust/);
  });
});

describe("a mandatory update can never permanently brick the app", () => {
  const BANNER = read("components/apk-update-banner.tsx");

  it("the blocking overlay has an escape once the update has failed", () => {
    // `mandatory` is an UNAUTHENTICATED manifest field and the overlay is
    // full-screen with pointerEvents="auto" and no dismiss, so any permanent
    // failure in the update chain left the whole app — including calling —
    // unusable forever.
    expect(BANNER).toMatch(/const canSkip = status === "error" && failures >= 2/);
    expect(BANNER).toMatch(/Continue without updating/);
    expect(BANNER).toMatch(/setDismissed\(true\)/);
    expect(BANNER).toMatch(/if \(dismissed\) return null;/);
  });

  it("the escape is NOT offered while the update can still succeed", () => {
    // A forced update must stay forced in the working case; the way out exists
    // only for the brick scenario, and only after more than one failure so a
    // single transient blip does not hand out a bypass.
    expect(BANNER).toMatch(/failures >= 2/);
    expect(BANNER).toMatch(/if \(isError && !wasError\.current\) setFailures/);
  });

  it("the user is told WHY it failed", () => {
    expect(BANNER).toMatch(/error\?: string \| null/);
    expect(BANNER).toMatch(/status === "error" && error \?/);
    expect(read("app/(tabs)/index.tsx")).toMatch(/error=\{error\}/);
  });

  it("the escape control meets the minimum touch target", () => {
    const skip = BANNER.slice(BANNER.indexOf("  skip: {"), BANNER.indexOf("  skipText: {"));
    expect(skip).toMatch(/minHeight: 44/);
  });
});
