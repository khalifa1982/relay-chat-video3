import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { codeOnly } from "../../../server/testing/codeOnly";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const SURFACE = read("client/src/app/installSurface.ts");
const BANNER = read("client/src/app/PushBanner.tsx");
const PROFILE = read("client/src/pages/app/Profile.tsx");
const MANIFEST = JSON.parse(read("client/public/manifest.webmanifest"));

describe("v2.106.81 — the install prompt is desktop-only and never lies", () => {
  it("the shortcut lands on /app, which is what the owner asked for", () => {
    /* No code does this — the browser builds the icon from the manifest, so the
       manifest IS the feature. Pinned because an unrelated edit to start_url would
       silently move every installed shortcut to the marketing page. */
    expect(MANIFEST.start_url).toBe("/app");
  });

  it("the shell is detected by CAPABILITY, never by a user-agent sniff", () => {
    /* v2.106.76's reasoning: a UA sniff would claim a shell for every Android
       browser and suppress the affordance for people who genuinely need it. */
    expect(SURFACE).toMatch(/typeof rn\?\.postMessage === "function"/);
    const code = codeOnly(SURFACE);
    expect(code, "no UA sniffing").not.toMatch(/userAgent|navigator\.platform|vendor/i);
  });

  it("nothing renders in the native shell — it already receives calls", () => {
    /* This is the BUG the owner was looking at, not merely noise: inside the Expo
       WebView `iosNeedsInstallForPush()` is true (not standalone, no PushManager),
       so the banner told the user to tap a Safari button that does not exist. */
    const code = codeOnly(BANNER);
    expect(code).toMatch(/if \(isNativeShell\(\)\) return null;/);
    // …and it is the FIRST gate, so no other branch can render ahead of it.
    const shellAt = code.indexOf("isNativeShell()");
    const firstReturn = code.indexOf("return (");
    expect(shellAt).toBeGreaterThan(-1);
    expect(firstReturn).toBeGreaterThan(-1);
    expect(shellAt, "the shell gate precedes every render").toBeLessThan(firstReturn);
  });

  it("the old Add-to-Home-Screen BANNER is gone", () => {
    // The owner's ask: not on a mobile browser, not in the app.
    const code = codeOnly(BANNER);
    expect(code).not.toMatch(/Add to Home Screen/);
    expect(code).not.toMatch(/iosNeedsInstallForPush/);
  });

  it("a mobile browser is never offered the desktop install", () => {
    expect(SURFACE).toMatch(/!isMobileBrowser\(\)/);
    /* `(pointer: coarse)` asks what the input device IS, rather than parsing a
       string the browser may lie about; the width bound stops a touchscreen laptop
       — a desktop in every way that matters here — reading as a phone. */
    expect(SURFACE).toMatch(/\(pointer: coarse\)/);
    expect(SURFACE).toMatch(/innerWidth < 900/);
  });

  it("the button appears ONLY when a real prompt is in hand, never merely on desktop", () => {
    /* Safari and Firefox never fire `beforeinstallprompt` and expose no
       programmatic install, so gating on "is this a desktop" would render a button
       that is present, tappable and able to do nothing — the silent-no-op class
       (v2.103.3: such a control should be ABSENT, not disabled). */
    expect(SURFACE).toMatch(/hasInstallPrompt\(\)/);
    const fn = SURFACE.slice(SURFACE.indexOf("export function shouldOfferInstall"));
    expect(fn.length).toBeGreaterThan(60);
    const body = fn.slice(0, fn.indexOf("\n}") + 1);
    for (const guard of ["!isInstalled()", "!isNativeShell()", "!isMobileBrowser()", "hasInstallPrompt()"]) {
      expect(body, `shouldOfferInstall requires ${guard}`).toContain(guard);
    }
  });

  it("preventDefault is called, or the prompt cannot be replayed from our button", () => {
    expect(SURFACE).toMatch(/e\.preventDefault\(\)/);
  });

  it("the prompt is single-use and the row goes with it", () => {
    /* The spec allows one firing. Keeping it would give the user a button that
       works once and then silently does nothing. */
    const fn = SURFACE.slice(SURFACE.indexOf("export async function promptInstall"));
    const body = fn.slice(0, fn.indexOf("\n}") + 1);
    expect(body).toMatch(/deferred = null;/);
    // …and the banner drops the row on EITHER outcome, not just on accept.
    const code = codeOnly(BANNER);
    expect(code).toMatch(/setOfferInstall\(false\);/);
  });

  it("an install makes the affordance disappear", () => {
    expect(SURFACE).toMatch(/"appinstalled"/);
  });

  it("the banner SUBSCRIBES rather than reading once", () => {
    /* `beforeinstallprompt` fires early and asynchronously — often before this
       component mounts, sometimes after. A one-shot read would miss it either way. */
    expect(codeOnly(BANNER)).toMatch(/subscribeInstallPrompt\(/);
  });

  it("Profile's SETTINGS note survives on iOS Safari but not in the shell", () => {
    /* A deliberate split, recorded rather than glossed: the intrusive banner is
       gone, but the settings pane is reached by someone asking why they are not
       being rung, and answering with silence is the silent-no-op class. In the
       shell it is suppressed, because there it is simply false. */
    expect(codeOnly(PROFILE)).toMatch(/!isNativeShell\(\) && iosNeedsInstallForPush\(\)/);
  });
});
