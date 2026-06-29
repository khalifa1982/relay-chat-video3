import { describe, expect, it } from "vitest";

import {
  isUpdateAvailable,
  parseManifest,
  resolveApkUrl,
} from "../lib/apk-update-config";

describe("parseManifest", () => {
  it("parses a valid manifest", () => {
    const m = parseManifest({
      buildNumber: 5,
      versionName: "1.2.0",
      apkUrl: "https://your-chat.org/update/app.apk",
      notes: "Bug fixes",
    });
    expect(m).toEqual({
      buildNumber: 5,
      versionName: "1.2.0",
      apkUrl: "https://your-chat.org/update/app.apk",
      notes: "Bug fixes",
    });
  });

  it("accepts numeric strings and floors them", () => {
    const m = parseManifest({ buildNumber: "7" });
    expect(m?.buildNumber).toBe(7);
  });

  it("rejects invalid / missing build numbers", () => {
    expect(parseManifest({})).toBeNull();
    expect(parseManifest({ buildNumber: 0 })).toBeNull();
    expect(parseManifest({ buildNumber: -3 })).toBeNull();
    expect(parseManifest({ buildNumber: "abc" })).toBeNull();
    expect(parseManifest(null)).toBeNull();
    expect(parseManifest("nope")).toBeNull();
  });
});

describe("isUpdateAvailable", () => {
  const m = (b: number) => parseManifest({ buildNumber: b });

  it("is true when server build is higher", () => {
    expect(isUpdateAvailable(1, m(2))).toBe(true);
  });

  it("is false when equal or lower", () => {
    expect(isUpdateAvailable(2, m(2))).toBe(false);
    expect(isUpdateAvailable(3, m(2))).toBe(false);
  });

  it("is false when no manifest", () => {
    expect(isUpdateAvailable(1, null)).toBe(false);
  });

  it("is false (conservative) when installed build is unknown", () => {
    expect(isUpdateAvailable(null, m(5))).toBe(false);
    expect(isUpdateAvailable(undefined, m(5))).toBe(false);
  });
});

describe("resolveApkUrl", () => {
  it("prefers the manifest apkUrl", () => {
    expect(resolveApkUrl(parseManifest({ buildNumber: 2, apkUrl: "https://x/y.apk" }))).toBe(
      "https://x/y.apk",
    );
  });

  it("falls back to the default APK URL", () => {
    expect(resolveApkUrl(parseManifest({ buildNumber: 2 }))).toContain("/app.apk");
  });
});
