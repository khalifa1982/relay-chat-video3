/**
 * design_handoff_relay_app — PHASE 1, the foundation the other 33 frames stand on.
 *
 * The handoff's whole accent system is one rule: the canvas loop writes the current hue
 * to `--rb` / `--rb-rgb` on `<html>`, and EVERY accent-coloured surface reads
 * `var(--rb)` / `rgba(var(--rb-rgb),α)` so the app breathes with the background instead
 * of beside it.
 *
 * THE PROPERTY EVERY TEST HERE PROTECTS: those custom properties are never UNSET. An
 * unset custom property does not fall back to a default — it makes the declaration
 * INVALID, and the browser drops it. So a missing publish renders accent chips with no
 * background at all, which is why there is a publish at init, a publish every frame, a
 * publish on the no-2D-context path, and a static fallback in the stylesheet.
 *
 * THE WRITE IS DRIVEN, NOT PINNED. This suite is node-environment with no jsdom, so
 * `publishAccentVars` takes a target seam and the assertions run the real function
 * against a recording stub — a source pin cannot tell you whether a mid-crossfade value
 * comes out as valid CSS.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  publishAccentVars,
  hexToRgb,
  RELAY_PALETTE,
  RELAY_ACCENT,
  RELAY_ACCENT_CYCLE_MS,
  ACCENT_VAR,
  ACCENT_RGB_VAR,
} from "@/lib/relayBackground";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const CSS = read("client/src/index.css");
const SHELL = read("client/src/app/AppShell.tsx");
const ENGINE = read("client/src/lib/relayBackground.ts");

/** Comment-stripped source. This repo has matched its own prose 17+ times, and three of
 *  this file's own first-draft assertions did exactly that. */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*)/.test(l))
    .join("\n");
}

/** CSS with comments stripped — same reason. */
const CSS_CODE = CSS.replace(/\/\*[\s\S]*?\*\//g, "");

function recorder() {
  const seen = new Map<string, string>();
  return { seen, setProperty: (k: string, v: string) => void seen.set(k, v) };
}

describe("publishAccentVars — the one writer", () => {
  it("writes BOTH forms, because the two are used differently", () => {
    // `var(--rb)` for a solid colour; `rgba(var(--rb-rgb),α)` for every tint. A surface
    // needing a tint cannot derive one from the rgb() string, which is why both exist.
    const t = recorder();
    publishAccentVars([53, 224, 180], t);
    expect(t.seen.get(ACCENT_VAR)).toBe("rgb(53,224,180)");
    expect(t.seen.get(ACCENT_RGB_VAR)).toBe("53,224,180");
  });

  it("truncates to integers, so a mid-crossfade value is still valid CSS", () => {
    // The loop eases between hues, so the channels are FRACTIONAL almost always.
    // `rgb(52.7,…)` is not a valid colour and the declaration would be dropped.
    const t = recorder();
    publishAccentVars([52.7, 223.2, 179.99], t);
    expect(t.seen.get(ACCENT_VAR)).toBe("rgb(52,223,179)");
    expect(t.seen.get(ACCENT_RGB_VAR)).toBe("52,223,179");
  });

  it("never emits a fractional or NaN channel for any palette hue mid-fade", () => {
    // Walk a real crossfade between every adjacent pair and assert every published
    // value parses as CSS-legal integers.
    for (let i = 0; i < RELAY_PALETTE.length; i++) {
      const a = hexToRgb(RELAY_PALETTE[i]);
      const b = hexToRgb(RELAY_PALETTE[(i + 1) % RELAY_PALETTE.length]);
      for (const k of [0.13, 0.37, 0.61, 0.89]) {
        const t = recorder();
        publishAccentVars(a.map((c, j) => c + (b[j] - c) * k), t);
        expect(t.seen.get(ACCENT_RGB_VAR)).toMatch(/^\d{1,3},\d{1,3},\d{1,3}$/);
        expect(t.seen.get(ACCENT_VAR)).toMatch(/^rgb\(\d{1,3},\d{1,3},\d{1,3}\)$/);
      }
    }
  });

  it("hexToRgb round-trips every palette entry", () => {
    for (const hex of RELAY_PALETTE) {
      const rgb = hexToRgb(hex);
      expect(rgb).toHaveLength(3);
      for (const c of rgb) expect(Number.isFinite(c) && c >= 0 && c <= 255).toBe(true);
    }
    expect(hexToRgb("#35e0b4")).toEqual([53, 224, 180]);
  });

  it("is a no-op with no document and no target, rather than throwing", () => {
    // It is called from module-level init paths; throwing there would take the whole
    // shell down on any non-DOM host.
    expect(() => publishAccentVars([1, 2, 3])).not.toThrow();
  });
});

describe("the engine publishes even when it cannot draw", () => {
  const src = code(ENGINE);

  it("the no-2D-context branch publishes BEFORE returning its inert handle", () => {
    /* The nastiest case: the one browser that cannot draw the background would also be
       the one where every accent chip renders with no background. */
    const branch = src.slice(src.indexOf("if (!ctx) {"), src.indexOf("const low ="));
    expect(branch.length).toBeGreaterThan(60);
    expect(branch).toMatch(/publishAccentVars\(hexToRgb\(opts\.accent \?\? RELAY_ACCENT\)\)/);
    expect(branch.indexOf("publishAccentVars")).toBeLessThan(branch.indexOf("return {"));
  });

  it("publishes once at INIT, before the first frame", () => {
    // The first rAF callback is a frame away and `document.hidden` can defer it
    // indefinitely, so without this the app's first paint has no accent at all.
    const init = src.slice(src.indexOf("onResize();"), src.indexOf("function draw("));
    expect(init).toMatch(/publishAccentVars\(cur\)/);
  });

  it("and publishes every frame from inside draw", () => {
    // A publish only at init would freeze the app's accent while the canvas kept
    // cycling — the two visibly out of step.
    const draw = src.slice(src.indexOf("function draw("));
    expect(draw).toMatch(/publishAccentVars\(cur\)/);
  });
});

describe("the stylesheet carries a static fallback", () => {
  const block = CSS_CODE.slice(
    CSS_CODE.indexOf(":root {\n  --rb:"),
    CSS_CODE.indexOf(".relay-v2 {"),
  );

  it("the slice really found the fallback block", () => {
    expect(block.length).toBeGreaterThan(30);
    expect(block).toMatch(/--rb:/);
  });

  it("declares both vars, so JS is never the only source", () => {
    /* Not decoration: with no declaration at all, `rgba(var(--rb-rgb),.14)` is invalid
       and dropped, so a path where the engine never runs would render accent chips with
       NO background rather than a plain one. */
    expect(block).toMatch(/--rb:\s*#35e0b4/);
    expect(block).toMatch(/--rb-rgb:\s*53,\s*224,\s*180/);
  });

  it("the fallback IS the palette's first hue, so nothing invents a colour", () => {
    // Two sources of "the default accent" is how the untinted app and the first frame
    // come to disagree by a visible step.
    expect(RELAY_PALETTE[0]).toBe("#35e0b4");
    expect(RELAY_ACCENT).toBe("#35e0b4");
    expect(hexToRgb(RELAY_PALETTE[0])).toEqual([53, 224, 180]);
  });

  it("declares them at the ROOT level the engine writes to", () => {
    /* The engine writes to `<html>`. A fallback nested inside `.relay-v2` would be a
       more specific selector on a DESCENDANT, so it would beat the root's inline style
       and the accent would never move. Comment-stripped, because the prose above
       legitimately names both `.relay-v2` and `--rb`. */
    expect(block).not.toMatch(/\.relay-v2/);
    const roots = CSS_CODE.match(/--rb:\s*#/g) ?? [];
    expect(roots).toHaveLength(1); // exactly one declaration of the fallback
  });
});

describe("the glass token layer", () => {
  const layer = CSS_CODE.slice(CSS_CODE.indexOf(".relay-v2 .rglass"));

  it("exists, and every tier the frames reference is defined", () => {
    expect(layer.length).toBeGreaterThan(400);
    for (const cls of ["rglass", "rsheet", "rbar", "rbar-flat", "rchip-accent", "rcta", "rscrim"]) {
      expect(layer).toMatch(new RegExp(`\\.relay-v2 \\.${cls}\\s*\\{`));
    }
  });

  it("the accent tiers read the VAR, so they follow the cycle with no JS per element", () => {
    expect(layer).toMatch(/\.rchip-accent[^}]*rgba\(var\(--rb-rgb\), 0\.14\)/);
    expect(layer).toMatch(/\.rcta[^}]*background: var\(--rb\)/);
  });

  it("on-accent text is the board's near-black, not white", () => {
    // White fails on the palette's yellow and lime entries; #04211a holds across all 12.
    expect(layer).toMatch(/\.rcta[^}]*color: #04211a/);
  });

  it("offers a NO-BLUR bar for surfaces over live video", () => {
    /* v2.99.84 measured 36 backdrop-filter layers over a call grid and removed all of
       them on phones. A single blurred bar class with no alternative is how they come
       back one screen at a time. The slice is comment-stripped: `.rbar`'s own comment
       names `.rbar-flat`, so an unstripped `indexOf` found the PROSE and the slice then
       swallowed `.rbar`'s real backdrop-filter. */
    const flat = layer.slice(layer.indexOf(".relay-v2 .rbar-flat"), layer.indexOf(".relay-v2 .rchip-accent"));
    expect(flat.length).toBeGreaterThan(40);
    expect(flat).toMatch(/background: rgba\(8, 12, 14, 0\.92\)/);
    expect(flat).not.toMatch(/backdrop-filter/);
    // And the blurred one really does blur, so the pair is a genuine choice.
    const bar = layer.slice(layer.indexOf(".relay-v2 .rbar {"), layer.indexOf(".relay-v2 .rbar-flat"));
    expect(bar).toMatch(/backdrop-filter: blur\(16px\)/);
  });

  it("EVERY rule is scoped, so the landing page and docs are untouched", () => {
    // The property is that no rule targets a bare `.r*` class at the top level — not
    // "no line starts with a dot", which `.relay-v2 .rglass` obviously does.
    const selectors = layer.match(/^\.[^\s{]+/gm) ?? [];
    expect(selectors.length).toBeGreaterThan(5);
    for (const sel of selectors) expect(sel).toBe(".relay-v2");
  });
});

describe("the cycle", () => {
  const src = code(ENGINE);

  it("is the app handoff's 9.5s, from ONE named constant", () => {
    expect(RELAY_ACCENT_CYCLE_MS).toBe(9_500);
    // And the engine reads that constant rather than restating the number.
    expect(src).toMatch(/>\s*RELAY_ACCENT_CYCLE_MS/);
    expect(src).not.toMatch(/>\s*6200/);
  });

  it("holds STILL under reduced motion, but still publishes", () => {
    /* Now that the accent tints every surface, a hue that keeps changing IS animation.
       The request is "stop moving", not "render my chips without a colour" — so the
       target is pinned to the static accent and the publish stays above the early
       return that skips the expensive layers. */
    expect(src).toMatch(/!cycle \|\| calm/);
    const publishAt = src.indexOf("publishAccentVars(cur)");
    const calmReturn = src.indexOf("if (calm) return");
    expect(publishAt).toBeGreaterThan(-1);
    expect(calmReturn).toBeGreaterThan(-1);
    expect(publishAt).toBeLessThan(calmReturn);
  });
});

describe("the app-wide mount", () => {
  const src = code(SHELL);

  it("is exactly ONE canvas, in the shell", () => {
    /* The engine runs its own rAF per canvas, so a mount per route would multiply the
       cost by the number of live screens — the v2.99.67 class. */
    expect(src).toMatch(/<RelayBackground \/>/);
    expect(src.match(/<RelayBackground/g) ?? []).toHaveLength(1);
  });

  it("runs in DARK only, and the shell's own background agrees", () => {
    /* The board is a dark design while this app defaults to LIGHT, so light mode keeps
       today's opaque surfaces rather than shipping near-black text on a near-black live
       canvas. */
    expect(src).toMatch(/const liveBackground = theme === "dark";/);
    expect(src).toMatch(/\{liveBackground && <RelayBackground \/>\}/);
    expect(src).toMatch(/liveBackground \? "bg-transparent" : "bg-background"/);
  });

  it("both background decisions read ONE flag, never the theme twice", () => {
    /* Two separate theme reads is how you get an opaque shell over a running canvas —
       all of the cost and none of the effect.
       The first draft of this asserted `theme === "dark"` occurs once in the FILE, and
       it was simply wrong about the code: the sidebar's Dark/Light segmented control
       legitimately reads the theme too. The property is about the BACKGROUND decision. */
    expect(src.match(/const liveBackground =/g) ?? []).toHaveLength(1);
    expect(src.match(/liveBackground/g)?.length).toBeGreaterThanOrEqual(3); // def + mount + bg class
    /* Neither the mount nor the shell's background class re-derives the theme.
       BOUNDED ON REAL CODE (`<aside`), not on the comment that follows: `code()` strips
       comments, so an anchor inside one returns -1 and `slice(start, -1)` runs to
       end-of-file — which swallowed the sidebar's own legitimate theme toggle. That is
       the inverted prose-anchor trap, and it has now bitten twice (v2.105.26). */
    const mount = src.slice(src.indexOf("min-h-svh"), src.indexOf("<aside"));
    expect(mount.length).toBeGreaterThan(80);
    expect(mount.length).toBeLessThan(600); // the slice really is just the mount
    expect(mount).not.toMatch(/theme === /);
  });

  it("the canvas is fixed and behind, not in the flow", () => {
    const bg = read("client/src/app/RelayBackground.tsx");
    expect(bg).toMatch(/position: "fixed"/);
    expect(bg).toMatch(/zIndex: 0/);
    expect(bg).toMatch(/aria-hidden/);
  });
});
