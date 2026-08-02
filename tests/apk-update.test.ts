import { describe, expect, it } from "vitest";

/** parseManifest now REQUIRES a digest (the owner confirmed the live
 *  manifest carries one), so fixtures must supply a real 64-hex value. */
const VALID_SHA = "e482dd5fdbe5eed4c5d3898b1282842013a3bd4af29f672c2d850ceef4e4b046";

import {
  compareVersionNames,
  isMandatoryUpdate,
  isUpdateAvailable,
  parseManifest,
  resolveApkUrl,
  UPDATE_BASE_URL,
  UPDATE_APK_URL,
} from "../lib/apk-update-config";

describe("parseManifest", () => {
  it("parses a valid manifest", () => {
    // The apkUrl must sit under the pinned update origin to be carried through —
    // this fixture used an unrelated host, which parseManifest now drops so the
    // download falls back to the compiled-in URL.
    const apkUrl = `${UPDATE_BASE_URL}/app.apk`;
    const m = parseManifest({
      buildNumber: 5,
      versionName: "1.2.0",
      apkUrl,
      notes: "Bug fixes", sha256: VALID_SHA });
    expect(m).toEqual({
      buildNumber: 5,
      versionName: "1.2.0",
      apkUrl,
      notes: "Bug fixes",
      sha256: VALID_SHA,
    });
  });

  it("drops an off-origin apkUrl but keeps the rest of the manifest", () => {
    // A rewritten manifest must not be able to redirect the download; it also
    // must not be able to suppress the update entirely by naming a bad URL.
    const m = parseManifest({
      buildNumber: 5,
      versionName: "1.2.0",
      apkUrl: "https://your-chat.io/update/app.apk", sha256: VALID_SHA });
    expect(m).not.toBeNull();
    expect(m?.apkUrl).toBeUndefined();
    expect(m?.buildNumber).toBe(5);
  });

  it("accepts numeric strings and floors them", () => {
    const m = parseManifest({ buildNumber: "7", sha256: VALID_SHA });
    expect(m?.buildNumber).toBe(7);
  });

  it("rejects invalid / missing build numbers", () => {
    expect(parseManifest({ sha256: VALID_SHA })).toBeNull();
    expect(parseManifest({ buildNumber: 0, sha256: VALID_SHA })).toBeNull();
    expect(parseManifest({ buildNumber: -3, sha256: VALID_SHA })).toBeNull();
    expect(parseManifest({ buildNumber: "abc", sha256: VALID_SHA })).toBeNull();
    expect(parseManifest(null)).toBeNull();
    expect(parseManifest("nope")).toBeNull();
  });
});

describe("isUpdateAvailable", () => {
  const m = (b: number) => parseManifest({ buildNumber: b, sha256: VALID_SHA });

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
    const m = parseManifest({ buildNumber: 4, versionName: "1.0.5", sha256: VALID_SHA });
    expect(isUpdateAvailable(4, m, "1.0.4")).toBe(true);
  });

  it("reports up-to-date when version names match", () => {
    const m = parseManifest({ buildNumber: 4, versionName: "1.0.5", sha256: VALID_SHA });
    expect(isUpdateAvailable(4, m, "1.0.5")).toBe(false);
  });

  it("does not offer a downgrade by version name", () => {
    const m = parseManifest({ buildNumber: 9, versionName: "1.0.3", sha256: VALID_SHA });
    expect(isUpdateAvailable(4, m, "1.0.4")).toBe(false);
  });

  it("falls back to buildNumber when version names are absent", () => {
    const m = parseManifest({ buildNumber: 6, sha256: VALID_SHA });
    expect(isUpdateAvailable(4, m)).toBe(true);
  });
});

describe("resolveApkUrl", () => {
  it("honours a manifest apkUrl only when it is under the PINNED origin", () => {
    // The manifest used to choose the download origin outright. version.json is a
    // separate, much smaller asset than the APK, so whoever could rewrite it could
    // point every installation at any host — while `sha256` is an optional field
    // of that same file, so they could disable verification in the same edit.
    // The origin is a build-time decision; the manifest may only pick a file
    // WITHIN it.
    const pinned = `${UPDATE_BASE_URL}/relay-mobile-1.2.3.apk`;
    expect(resolveApkUrl(parseManifest({ buildNumber: 2, apkUrl: pinned, sha256: VALID_SHA }))).toBe(pinned);
  });

  it("ignores an off-origin apkUrl and falls back to the compiled-in one", () => {
    for (const hostile of [
      "https://evil.tld/relay.apk",
      "http://github.com/khalifa1982/relay-app-releases/releases/latest/download/relay.apk", // cleartext
      "https://github.com.evil.tld/khalifa1982/relay-app-releases/releases/latest/download/x.apk",
      "https://github.com/someone-else/releases/latest/download/relay.apk", // same host, other path
      "javascript:alert(1)",
      "not a url",
    ]) {
      expect(
        resolveApkUrl(parseManifest({ buildNumber: 2, apkUrl: hostile, sha256: VALID_SHA })),
        hostile,
      ).toBe(UPDATE_APK_URL);
    }
  });

  it("falls back to the default APK URL", () => {
    expect(resolveApkUrl(parseManifest({ buildNumber: 2, sha256: VALID_SHA }))).toContain("relay-mobile.apk");
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

  it("flags an older device as needing an update, and a same-version device as up to date", async () => {
    const res = await fetch(MANIFEST_URL, { redirect: "follow" });
    const manifest = parseManifest(await res.json());
    expect(manifest).not.toBeNull();
    // A phone one build behind the published manifest must see an update.
    const olderBuild = manifest!.buildNumber - 1;
    expect(isUpdateAvailable(olderBuild, manifest, "0.0.1")).toBe(true);
    // A phone already on the published version must report up to date.
    expect(
      isUpdateAvailable(manifest!.buildNumber, manifest, manifest!.versionName),
    ).toBe(false);
  }, 60000);
});

describe("isMandatoryUpdate", () => {
  it("is true only when an update is available AND marked mandatory", () => {
    const m = parseManifest({ buildNumber: 9, mandatory: true, sha256: VALID_SHA });
    expect(isMandatoryUpdate(2, m)).toBe(true);
  });

  it("is false when mandatory flag is set but no newer build", () => {
    const m = parseManifest({ buildNumber: 2, mandatory: true, sha256: VALID_SHA });
    expect(isMandatoryUpdate(2, m)).toBe(false);
  });

  it("is false when a newer build exists but mandatory flag is absent/false", () => {
    expect(isMandatoryUpdate(2, parseManifest({ buildNumber: 5, sha256: VALID_SHA }))).toBe(false);
    expect(
      isMandatoryUpdate(2, parseManifest({ buildNumber: 5, mandatory: false, sha256: VALID_SHA })),
    ).toBe(false);
  });

  it("is false when installed build is unknown", () => {
    expect(
      isMandatoryUpdate(null, parseManifest({ buildNumber: 5, mandatory: true, sha256: VALID_SHA })),
    ).toBe(false);
  });
});
