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
    /* THE PROPERTY IS THE ORDER WITHIN THE ACQUISITION, not a character distance
       (v2.106.88). This was a fixed `{0,400}` window between the two calls, so it broke
       the moment a comment landed between them — the recurring fixed-slice fragility,
       and it says nothing about whether the tip still fires from the right place.
       Bounded by the function itself, and both calls are required to exist first so a
       missing one cannot pass as an ordering. */
    const at = SRC.indexOf("async function ensureMediaInner(");
    expect(at).toBeGreaterThan(-1);
    const body = SRC.slice(at, SRC.indexOf("\n  function ", at));
    const tip = body.indexOf("maybeShowIosPermTip()");
    const mon = body.indexOf("ensureLocalLevelMonitor()");
    expect(tip).toBeGreaterThan(-1);
    expect(mon).toBeGreaterThan(-1);
    expect(tip).toBeLessThan(mon);
  });

  it("shows ONCE ever (localStorage flag) and skips installed PWAs (iOS persists grants there)", () => {
    expect(SRC).toMatch(/relay_ios_perm_tip/);
    expect(SRC).toMatch(/display-mode: standalone/);
  });

  it("the tip teaches the PERMANENT fix (Website Settings → Allow), not a fake in-app toggle", () => {
    expect(SRC).toMatch(/Website Settings/);
    expect(SRC).toMatch(/set Camera and Microphone to Allow/);
  });

  it("ensureMedia still reuses a live stream — the app never double-prompts within a session (v2.80: reuse now checks the mic is actually ALIVE first)", () => {
    // REWRITTEN v2.106.44 to the PROPERTY. This froze the exact one-liner
    // `if (audioLive) return outStream();`, so it broke the moment the branch
    // grew a body (voice-then-video adds a camera to the cached stream) while
    // saying nothing about what it exists to protect: a LIVE cached mic is
    // handed straight back, so the OS never prompts twice in one session.
    const i = SRC.indexOf("const audioLive = localStream.getAudioTracks()");
    expect(i, "the aliveness check must exist").toBeGreaterThan(0);
    const branch = SRC.slice(i, SRC.indexOf("diag(\"cached media is dead", i));
    expect(branch.length, "the slice must be real").toBeGreaterThan(40);
    expect(branch).toMatch(/if \(audioLive\)/);
    expect(branch).toMatch(/return outStream\(\)/);
    // …and it must NOT re-request the microphone on the way there.
    expect(branch).not.toMatch(/audio: AUDIO_CONSTRAINTS/);
    expect(branch).not.toMatch(/acquireRawStream\(/);
  });
});
