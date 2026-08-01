import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { codeOnly } from "../../../server/testing/codeOnly";
import { RELAY_TONE_DARK, RELAY_TONE_LIGHT } from "@/lib/relayBackground";

/**
 * THE LIGHT THEME GETS THE ANIMATED BACKGROUND TOO (#158).
 *
 * Owner, verbatim: *"if you choose the light theme, ensure that the 3D background also
 * changes … the background will be a very light black or gray that is moving."*
 *
 * ── WHAT WAS ACTUALLY WRONG, AND IT WAS NOT A MISSING `if` ───────────────────────────
 * `liveBackground = theme === "dark"` meant the light theme had NO animated background at
 * all — but flipping that alone would have shipped a canvas nobody could see, because the
 * engine is built end to end for a near-black surface:
 *
 *   • the base fill is `#04070a`
 *   • stars and grid are near-WHITE ink
 *   • the vortex composites with `"lighter"`, which is ADDITIVE — a no-op against paper
 *   • a particle's channels are brightened TOWARD 255 as it gets denser
 *
 * On a pale surface every one of those is invisible or inverted. So the fix is a TONE MAP
 * rather than a colour swap, and `toward` is its load-bearing member: dark brightens a
 * channel out of black, light must DARKEN it onto paper. Without that flip every particle
 * lands within a few percent of the base and the canvas reads as a blank page.
 *
 * ── WHY THE TONE IS A PROP, NOT A `useTheme()` READ ──────────────────────────────────
 * The login screen and the passcode lock mount this canvas BEFORE the app shell exists,
 * and both are dark by design. A component that decided its own tone would flip those to
 * paper the moment somebody's stored preference said light — pinned in
 * `backgroundOverContent.test.ts`, which asserts the component never imports `useTheme`.
 *
 * ── AND THE ACCENT NAV HAD TO STOP RIDING THE SAME BOOLEAN ───────────────────────────
 * `accentNav = liveBackground` held only while the canvas was dark-only: one boolean was
 * answering two different questions. Turning the background on in light would have turned
 * the accent nav on over a pale surface and reinstated the measured 1.7:1 contrast
 * failure v2.106.2 exists to avoid. Pinned in `fiveTabShell.test.ts`.
 */
const ROOT = path.resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");
const ENGINE = codeOnly(read("client/src/lib/relayBackground.ts"));

describe("the two tone maps are genuinely opposite, not one palette twice", () => {
  it("dark brightens a channel and light darkens it", () => {
    /* THE ONE VALUE THAT DECIDES WHETHER ANYTHING IS VISIBLE. A light tone that kept
       `toward: 255` would paint white-on-white: every mark within a few percent of the
       paper, i.e. a canvas that runs, costs a rAF, and shows nothing. */
    expect(RELAY_TONE_DARK.toward).toBe(255);
    expect(RELAY_TONE_LIGHT.toward).toBe(0);
  });

  it("light composites MULTIPLICATIVELY, because additive is a no-op on paper", () => {
    expect(RELAY_TONE_DARK.composite).toBe("lighter");
    expect(RELAY_TONE_LIGHT.composite).toBe("multiply");
  });

  it("the ink inverts with the surface", () => {
    const lum = ([r, g, b]: [number, number, number]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
    // Near-white ink on near-black paper; near-black ink on near-white paper.
    expect(lum(RELAY_TONE_DARK.ink)).toBeGreaterThan(180);
    expect(lum(RELAY_TONE_LIGHT.ink)).toBeLessThan(80);
  });

  it("the light base is the owner's 'very light black or gray', not pure white", () => {
    /* Pure white makes every mark a hard edge and loses the depth the glows give; it is
       also not what was asked for. A hair off white, with the same cool cast the dark
       palette carries so the accent reads as one hue family in both. */
    expect(RELAY_TONE_LIGHT.base).toMatch(/^#[0-9a-f]{6}$/i);
    expect(RELAY_TONE_LIGHT.base.toLowerCase()).not.toBe("#ffffff");
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(RELAY_TONE_LIGHT.base.slice(i, i + 2), 16));
    expect(Math.min(r, g, b)).toBeGreaterThan(0xdc); // unmistakably light
    expect(Math.max(r, g, b)).toBeLessThan(0xfa); // and not white
  });

  it("every tone member differs between the two — no half-converted map", () => {
    /* A member left shared is a value tuned for one surface applied to the other, which is
       exactly the class of defect this release removes. `starAlpha`/`glow` are pairs, so
       they are compared as JSON. */
    expect(RELAY_TONE_LIGHT.base).not.toBe(RELAY_TONE_DARK.base);
    expect(RELAY_TONE_LIGHT.gridAlpha).not.toBe(RELAY_TONE_DARK.gridAlpha);
    expect(RELAY_TONE_LIGHT.vortexAlpha).not.toBe(RELAY_TONE_DARK.vortexAlpha);
    expect(JSON.stringify(RELAY_TONE_LIGHT.ink)).not.toBe(JSON.stringify(RELAY_TONE_DARK.ink));
    expect(JSON.stringify(RELAY_TONE_LIGHT.starAlpha)).not.toBe(
      JSON.stringify(RELAY_TONE_DARK.starAlpha),
    );
    expect(JSON.stringify(RELAY_TONE_LIGHT.glow)).not.toBe(JSON.stringify(RELAY_TONE_DARK.glow));
  });
});

describe("the paint loop reads the tone and nothing else", () => {
  /* SCOPED TO THE PAINT LOOP, not the whole file — my first draft swept the file and
     failed on CORRECT source, because `#04070a` and the near-white ink legitimately live
     in `RELAY_TONE_DARK`, which is now the one place they belong. The property is that
     the loop reads them THROUGH the tone. */
  const at = ENGINE.indexOf("export function initRelayBackground");
  const LOOP = ENGINE.slice(at);

  it("is reading a real function body (guards against a vacuous pass)", () => {
    expect(at).toBeGreaterThan(0);
    expect(LOOP.length).toBeGreaterThan(4000);
  });

  it("carries no hardcoded dark value left over from the single-surface engine", () => {
    /* THE ACTUAL FAILURE MODE OF THIS CHANGE is a value the sweep missed: one line still
       painting near-white ink or compositing additively, on a canvas whose other 20 lines
       moved. That reads as a rendering fault rather than a missing feature, so it is
       cheaper to forbid the literals outright than to enumerate the lines. */
    expect(LOOP).not.toMatch(/#04070a/);
    expect(LOOP).not.toMatch(/215\s*,\s*240\s*,\s*233/);
    expect(LOOP).not.toMatch(/globalCompositeOperation\s*=\s*"lighter"/);
    expect(LOOP).not.toMatch(/255\s*-\s*[a-z]/); // the old brighten-toward-white arithmetic
  });

  it("defaults to DARK when no tone is supplied, so every existing caller is unchanged", () => {
    /* The login screen and the passcode lock pass nothing. A default of light would flip
       two surfaces nobody asked to change, on a release about a third one. */
    expect(ENGINE).toMatch(/const TONE = opts\.tone \?\? RELAY_TONE_DARK;/);
  });

  it("`mix` travels toward the tone's own target, not a constant", () => {
    expect(ENGINE).toMatch(/const mix = \(c: number, k: number\) => \(c \+ \(TONE\.toward - c\) \* k\)/);
  });

  it("the surface, the ink, the glows and the composite all come from the tone", () => {
    expect(ENGINE).toMatch(/fillStyle = TONE\.base/);
    expect(ENGINE).toMatch(/A\(TONE\.glow\[0\]\)/);
    expect(ENGINE).toMatch(/A\(TONE\.glow\[1\]\)/);
    expect(ENGINE).toMatch(/TONE\.ink\[0\]/);
    expect(ENGINE).toMatch(/TONE\.gridAlpha/);
    expect(ENGINE).toMatch(/TONE\.starAlpha\[0\]/);
    expect(ENGINE).toMatch(/globalCompositeOperation = TONE\.composite/);
    expect(ENGINE).toMatch(/TONE\.vortexAlpha/);
  });
});

describe("the shell wires it", () => {
  const SHELL = codeOnly(read("client/src/app/AppShell.tsx"));
  const BG = codeOnly(read("client/src/app/RelayBackground.tsx"));

  it("the canvas is mounted in BOTH themes", () => {
    expect(SHELL).toMatch(/const liveBackground = true;/);
    expect(SHELL).toMatch(/<RelayBackground light=\{lightBackground\} \/>/);
  });

  it("the tone follows the user's theme, derived once", () => {
    expect(SHELL).toMatch(/const lightBackground = theme !== "dark";/);
    expect([...SHELL.matchAll(/const lightBackground = /g)].length).toBe(1);
  });

  it("a theme switch REBUILDS the canvas rather than mutating a live loop", () => {
    /* The composite operation is captured at init and set per frame from that captured
       value, so a running loop cannot be re-toned. Keying the effect on `light` makes the
       rebuild explicit instead of leaving a canvas painting the previous tone. */
    expect(BG).toMatch(/\}, \[light\]\);/);
    expect(BG).toMatch(/tone: light \? RELAY_TONE_LIGHT : RELAY_TONE_DARK/);
  });

  it("the vignette matches the base it darkens toward", () => {
    /* A near-black vignette over a pale canvas is a dark ring around a light page — the
       most visible way this could be half-done. */
    expect(BG).toMatch(/rgba\(238,241,240,0\)/); // light: fades from its own base
    expect(BG).toMatch(/rgba\(4,7,10,0\)/); // dark: unchanged
  });
});
