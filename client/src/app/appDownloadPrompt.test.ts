/**
 * GET-THE-APP PROMPT (v2.107.79) — the pins.
 *
 * A mobile-BROWSER-only card offering the native app: Android live (direct APK),
 * iPhone present but disabled until the App Store listing lands, default tab
 * from the detected OS. What breaks silently here is the GATING — the prompt
 * showing inside the native app, or on desktop, is the embarrassing failure —
 * so the detection is a pure function unit-tested against real user agents, and
 * the exclusions are pinned at the source.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { APP_DOWNLOAD, detectMobileOs } from "../../../shared/appDownload";

const read = (p: string) => readFileSync(resolve(__dirname, "../../..", p), "utf8");
const PROMPT = read("client/src/app/AppDownloadPrompt.tsx");
const SHELL = read("client/src/app/AppShell.tsx");
const CFG = read("shared/appDownload.ts");

const UA = {
  androidChrome:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36",
  iphoneSafari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  ipadOs13: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  desktopChrome:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
};

describe("detectMobileOs — real user agents", () => {
  it("Android Chrome → android", () => {
    expect(detectMobileOs(UA.androidChrome)).toBe("android");
  });
  it("iPhone Safari → ios", () => {
    expect(detectMobileOs(UA.iphoneSafari)).toBe("ios");
  });
  it("iPadOS 13+ (Mac UA + touch screen) → ios; a real Mac (no touch) → null", () => {
    expect(detectMobileOs(UA.ipadOs13, { platform: "MacIntel", maxTouchPoints: 5 })).toBe("ios");
    expect(detectMobileOs(UA.ipadOs13, { platform: "MacIntel", maxTouchPoints: 0 })).toBe(null);
  });
  it("desktop → null (the prompt never renders)", () => {
    expect(detectMobileOs(UA.desktopChrome)).toBe(null);
  });
});

describe("who never sees the card", () => {
  it("the native shell is excluded by BOTH of its marks", () => {
    // react-native-webview's bridge object AND the shell's injected global —
    // either alone means "already inside the app being offered".
    expect(PROMPT).toMatch(/anyW\.ReactNativeWebView \|\| anyW\.__RELAY_NATIVE__/);
  });
  it("an installed PWA (display-mode: standalone) is excluded", () => {
    expect(PROMPT).toMatch(/display-mode: standalone/);
  });
  it("a dismissal holds for 14 days under a versioned key", () => {
    expect(PROMPT).toMatch(/relay_get_app_dismissed_v1/);
    expect(PROMPT).toMatch(/14 \* 24 \* 60 \* 60_000/);
  });
});

describe("the two tabs", () => {
  it("Android is live with the direct EAS APK; iOS is configured but disabled", () => {
    expect(APP_DOWNLOAD.android.enabled).toBe(true);
    expect(APP_DOWNLOAD.android.url).toMatch(/^https:\/\/expo\.dev\/artifacts\/eas\/.+\.apk$/);
    expect(APP_DOWNLOAD.ios.enabled).toBe(false);
  });
  it("both tabs always render — the disabled one shows coming-soon, not absence", () => {
    expect(PROMPT).toMatch(/\(\["android", "ios"\] as const\)\.map/);
    expect(PROMPT).toMatch(/getapp\.iosSoon/);
  });
  it("the default tab follows the detected OS", () => {
    expect(PROMPT).toMatch(/useState<"android" \| "ios">\(os === "ios" \? "ios" : "android"\)/);
  });
  it("flipping iOS on later is config, not component surgery", () => {
    // The CTA renders from `active.enabled && active.url` — no per-platform JSX
    // branch to unpick when the App Store listing lands.
    expect(PROMPT).toMatch(/active\.enabled && active\.url/);
    expect(CFG).toMatch(/ios: \{\n    enabled: false,/);
  });
});

describe("mounted once, globally", () => {
  it("AppShell renders it beside the other global overlays", () => {
    expect(SHELL).toMatch(/<AppDownloadPrompt \/>/);
  });
});
