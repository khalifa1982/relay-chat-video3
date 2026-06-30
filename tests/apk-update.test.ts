import { describe, expect, it } from "vitest";

import {
  compareVersionNames,
  isMandatoryUpdate,
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

describe("compareVersionNames", () => {
  it("orders dotted versions numerically", () => {
    expect(compareVersionNames("1.0.5", "1.0.4")).toBe(1);
    expect(compareVersionNames("1.0.4", "1.0.5")).toBe(-1);
    expect(compareVersionNames("1.0.5", "1.0.5")).toBe(0);
    expect(compareVersionNames("1.2.0", "1.10.0")).toBe(-1); // numeric, not lexical
    expect(compareVersionNames("2.0", "1.9.9")).toBe(1);
    expect(compareVersionNames("v1.0.5", "1.0.4")).toBe(1); // tolerates leading v
  });

  it("returns 0 when either side is missing", () => {
    expect(compareVersionNames(undefined, "1.0.0")).toBe(0);
    expect(compareVersionNames("1.0.0", null)).toBe(0);
  });
});

describe("isUpdateAvailable with version names", () => {
  it("detects an update by version name even if buildNumber is equal", () => {
    // Real-world case: 1.0.4 installed, server says 1.0.5, same/lower versionCode.
    const m = parseManifest({ buildNumber: 4, versionName: "1.0.5" });
    expect(isUpdateAvailable(4, m, "1.0.4")).toBe(true);
  });

  it("reports up-to-date when version names match", () => {
    const m = parseManifest({ buildNumber: 4, versionName: "1.0.5" });
    expect(isUpdateAvailable(4, m, "1.0.5")).toBe(false);
  });

  it("does not offer a downgrade by version name", () => {
    const m = parseManifest({ buildNumber: 9, versionName: "1.0.3" });
    expect(isUpdateAvailable(4, m, "1.0.4")).toBe(false);
  });

  it("falls back to buildNumber when version names are absent", () => {
    const m = parseManifest({ buildNumber: 6 });
    expect(isUpdateAvailable(4, m)).toBe(true);
  });
});

describe("resolveApkUrl", () => {
  it("prefers the manifest apkUrl", () => {
    expect(resolveApkUrl(parseManifest({ buildNumber: 2, apkUrl: "https://x/y.apk" }))).toBe(
      "https://x/y.apk",
    );
  });

  it("falls back to the default APK URL", () => {
    expect(resolveApkUrl(parseManifest({ buildNumber: 2 }))).toContain("relay-mobile.apk");
  });
});

describe("live GitHub Releases manifest (end-to-end)", () => {
  const MANIFEST_URL =
    "https://github.com/khalifa1982/relay-app-releases/releases/latest/download/version.json";

  it("fetches a valid, parseable manifest from the public release host", async () => {
    const res = await fetch(MANIFEST_URL, { redirect: "follow" });
    expect(res.ok).toBe(true);
    const json = await res.json();
    const manifest = parseManifest(json);
    expect(manifest).not.toBeNull();
    expect(manifest!.buildNumber).toBeGreaterThanOrEqual(6);
    expect(manifest!.versionName).toBeTruthy();
    // The APK URL must be reachable and an actual binary, not an HTML page.
    const apkUrl = resolveApkUrl(manifest);
    const head = await fetch(apkUrl, { method: "GET", redirect: "follow" });
    expect(head.ok).toBe(true);
    const ct = head.headers.get("content-type") ?? "";
    expect(ct).not.toContain("text/html");
  }, 60000);

  it("detects 1.0.6 as an update for an installed 1.0.5 device", async () => {
    const res = await fetch(MANIFEST_URL, { redirect: "follow" });
    const manifest = parseManifest(await res.json());
    // Simulate a phone on an older version name.
    expect(isUpdateAvailable(5, manifest, "1.0.5")).toBe(true);
    // And reports up-to-date once the phone is on the same version.
    expect(isUpdateAvailable(6, manifest, manifest!.versionName)).toBe(false);
  }, 60000);
});

describe("isMandatoryUpdate", () => {
  it("is true only when an update is available AND marked mandatory", () => {
    const m = parseManifest({ buildNumber: 9, mandatory: true });
    expect(isMandatoryUpdate(2, m)).toBe(true);
  });

  it("is false when mandatory flag is set but no newer build", () => {
    const m = parseManifest({ buildNumber: 2, mandatory: true });
    expect(isMandatoryUpdate(2, m)).toBe(false);
  });

  it("is false when a newer build exists but mandatory flag is absent/false", () => {
    expect(isMandatoryUpdate(2, parseManifest({ buildNumber: 5 }))).toBe(false);
    expect(
      isMandatoryUpdate(2, parseManifest({ buildNumber: 5, mandatory: false })),
    ).toBe(false);
  });

  it("is false when installed build is unknown", () => {
    expect(
      isMandatoryUpdate(null, parseManifest({ buildNumber: 5, mandatory: true })),
    ).toBe(false);
  });
});
