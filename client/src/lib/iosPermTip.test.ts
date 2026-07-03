import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * v2.76 — iOS camera/mic permission UX, static pins.
 *
 * Reality this feature is built around (and must stay honest about): the
 * getUserMedia permission popup is BROWSER policy — no web API can persist a
 * grant for the user, apply it to other sites, or survive the user clearing
 * site data. Chrome/Android + desktop browsers persist after the first Allow
 * on their own; iOS Safari re-prompts by default and the ONLY permanent fix
 * is Safari's own per-site setting (aA → Website Settings → Allow). So the
 * app (a) never re-prompts within a session, and (b) shows a ONE-TIME tip on
 * iOS pointing at that setting, right after the first successful grant.
 */
const SRC = fs.readFileSync(path.resolve(__dirname, "relayClient.ts"), "utf8");

describe("iOS permission tip — one-time pointer to Safari's permanent Allow", () => {
  it("exists, is iOS-gated, and fires from ensureMedia after a successful grant", () => {
    expect(SRC).toMatch(/function maybeShowIosPermTip\(\) \{[\s\S]*?if \(!IS_IOS\) return;/);
    expect(SRC).toMatch(/maybeShowIosPermTip\(\);[\s\S]{0,400}ensureLocalLevelMonitor\(\);/);
  });

  it("shows ONCE ever (localStorage flag) and skips installed PWAs (iOS persists grants there)", () => {
    expect(SRC).toMatch(/relay_ios_perm_tip/);
    expect(SRC).toMatch(/display-mode: standalone/);
  });

  it("the tip teaches the PERMANENT fix (Website Settings → Allow), not a fake in-app toggle", () => {
    expect(SRC).toMatch(/Website Settings/);
    expect(SRC).toMatch(/set Camera and Microphone to Allow/);
  });

  it("ensureMedia still reuses a live stream — the app never double-prompts within a session", () => {
    expect(SRC).toMatch(/if \(localStream\) return outStream\(\);/);
  });
});
