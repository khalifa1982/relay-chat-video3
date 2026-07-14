import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { buildAssetLinks, DEFAULT_TWA_PACKAGE } from "./wellKnown";

/** v2.85 — Digital Asset Links for the Android TWA (mobile/android). */

const FP_A = "14:6D:E9:83:C5:73:06:50:D8:EE:B9:95:2F:34:FC:64:16:A0:83:42:E6:1D:BE:A8:8A:04:96:B2:3F:CF:44:E5";
const FP_B = "AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99";

describe("buildAssetLinks", () => {
  it("returns null until fingerprints are configured (route 404s harmlessly)", () => {
    expect(buildAssetLinks({})).toBeNull();
    expect(buildAssetLinks({ TWA_SHA256_FINGERPRINTS: "  " })).toBeNull();
    expect(buildAssetLinks({ TWA_SHA256_FINGERPRINTS: "not-a-fingerprint" })).toBeNull();
  });

  it("emits the Android statement list Play/Chrome expect, with BOTH keys (Play App Signing + upload)", () => {
    const links = buildAssetLinks({ TWA_SHA256_FINGERPRINTS: `${FP_A}, ${fpLower(FP_B)}` })!;
    expect(links).toHaveLength(1);
    const stmt = links[0] as {
      relation: string[];
      target: { namespace: string; package_name: string; sha256_cert_fingerprints: string[] };
    };
    expect(stmt.relation).toEqual(["delegate_permission/common.handle_all_urls"]);
    expect(stmt.target.namespace).toBe("android_app");
    expect(stmt.target.package_name).toBe(DEFAULT_TWA_PACKAGE);
    // Normalized to uppercase; both fingerprints present.
    expect(stmt.target.sha256_cert_fingerprints).toEqual([FP_A, FP_B]);
  });

  it("honours a custom package name", () => {
    const links = buildAssetLinks({ TWA_PACKAGE_NAME: "net.example.relay", TWA_SHA256_FINGERPRINTS: FP_A })!;
    expect((links[0] as { target: { package_name: string } }).target.package_name).toBe("net.example.relay");
  });
});

function fpLower(fp: string) {
  return fp.toLowerCase();
}

describe("mobile shells — repo wiring", () => {
  const ROOT = path.resolve(__dirname, "..");
  const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

  it("the route is registered and the Android project binds the SAME package + origin", () => {
    expect(read("server/_core/index.ts")).toMatch(/registerWellKnown\(app\)/);
    const gradle = read("mobile/android/app/build.gradle");
    expect(gradle).toContain(`applicationId "${DEFAULT_TWA_PACKAGE}"`);
    expect(gradle).toContain("https://www.your-chat.org/app");
    expect(read("mobile/android/app/src/main/res/values/strings.xml")).toContain("https://www.your-chat.org");
  });

  it("the iOS shell loads the live app and carries the call-critical Info.plist keys", () => {
    const cap = read("mobile/ios/capacitor.config.json");
    expect(cap).toContain('"url": "https://www.your-chat.org/app"');
    const plist = read("mobile/ios/ios/App/App/Info.plist");
    expect(plist).toContain("NSCameraUsageDescription");
    expect(plist).toContain("NSMicrophoneUsageDescription");
    expect(plist).toMatch(/UIBackgroundModes[\s\S]{0,80}audio/);
  });

  it("CI builds the installable APK + Play bundle from mobile/android", () => {
    const wf = read(".github/workflows/android-apk.yml");
    expect(wf).toContain("assembleDebug assembleRelease bundleRelease");
    expect(wf).toContain("app-debug.apk");
    expect(wf).toContain("app-release.aab");
  });
});
