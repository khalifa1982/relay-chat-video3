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
    // REWRITTEN TO THE PROPERTY (v2.106.12). This froze the exact class string
    // including `md:w-64`, so it broke the moment the panel legitimately widened for
    // board 2d's inline Approve/Decline — while saying nothing about what it exists
    // to prevent, which is a panel that runs off the edge of a phone.
    //
    // The rule the bug had: the bell sits mid-bar, so a RIGHT-anchored absolute panel
    // ran past the LEFT screen edge. Mobile must therefore be pinned to the VIEWPORT,
    // and desktop must open rightward from a LEFT anchor.
    expect(MISSED).toMatch(/max-md:fixed/);
    expect(MISSED).toMatch(/max-md:inset-x-\d/); // clamped to the viewport, both sides
    /* REWRITTEN TO THE PROPERTY (#159). This froze the PHYSICAL spelling `md:left-0`,
       so it forbade the RTL sweep while saying nothing about the rule it stands for —
       that on desktop the panel hangs off the bell's LEADING edge and opens away from
       it. `md:start-0` is that same anchor expressed logically, which keeps it true in
       Arabic instead of opening back across the button. Both spellings are accepted
       here so the pin describes the anchor rather than the writing system; what it
       still forbids is the trailing-edge anchor that caused the bug. */
    expect(MISSED).toMatch(/md:absolute md:(?:start|left)-0/);
    expect(MISSED, "the panel must not hang off the TRAILING edge again").not.toMatch(
      /md:(?:end|right)-0/,
    );
    // The old right-anchored absolute panel (ran off-screen) must be gone.
    expect(MISSED).not.toMatch(/absolute right-0 mt-2 w-64/);
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
