/**
 * v2.96.3 — owner screenshots: (1) the notification-bell dropdown opened past
 * the LEFT screen edge on phones (right-anchored absolute panel on a bell
 * that sits mid-bar; the desktop sidebar had the mirror problem), and (2) the
 * hang-up control appeared TWICE (the engine's control-bar button AND the
 * floating top-right "X End" pill) with the dial-screen version reading as an
 * ugly rounded-rect blob. One hang-up now: the engine's — restyled as a
 * proper round red phone button, bigger on the pre-connect dial screen.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8");

const MISSED = read("client/src/app/MissedCalls.tsx");
const RELAY_ENGINE = read("client/src/app/RelayEngine.tsx");
const RELAY_ASSETS = read("client/src/lib/relayAssets.ts");

describe("notification panel fits the screen (v2.96.3)", () => {
  it("mobile: fixed + viewport-clamped; desktop sidebar: opens rightward (left-anchored)", () => {
    expect(MISSED).toMatch(/max-md:fixed max-md:inset-x-3 max-md:top-16 md:absolute md:left-0 md:mt-2 md:w-64/);
    // The old right-anchored absolute panel (ran off-screen) must be gone.
    expect(MISSED).not.toMatch(/"absolute right-0 mt-2 w-64/);
  });
});

describe("ONE hang-up control (v2.96.3)", () => {
  it("the floating top-right 'X End' pill is removed from the React layer", () => {
    expect(RELAY_ENGINE).not.toMatch(/aria-label="End call"/);
    expect(RELAY_ENGINE).not.toMatch(/>\s*End\s*</);
    // The deliberate-removal note stays so nobody re-adds it casually.
    expect(RELAY_ENGINE).toMatch(/duplicated the engine's own hang-up/);
  });
  it("the engine hang-up is a round red circle with a larger glyph", () => {
    expect(RELAY_ASSETS).toMatch(/\.ctrl\.hangup\{width:58px;height:58px;border-radius:50%/);
    expect(RELAY_ASSETS).toMatch(/\.ctrl\.hangup svg\{width:26px;height:26px\}/);
  });
  it("the pre-connect dial screen gets the big iPhone-style button on a bare bar", () => {
    // The exact button size/gradient was superseded in v2.98.0 (76px + a
    // richer two-tone red + ambient halo — see v298CallerHangup.test.ts for
    // that contract); this pin only checks what v2.96.3 actually fixed here.
    expect(RELAY_ASSETS).toMatch(/#call\.pre-connect \.ctrl\.hangup\{width:76px;height:76px/);
    // The glass ctrl-bar shell is stripped around the lone dial-screen button —
    // that dark rounded-rect shell WAS the reported "ugly" blob.
    expect(RELAY_ASSETS).toMatch(/#call\.pre-connect \.ctrl-bar\{background:none;border:none;box-shadow:none/);
  });
});
