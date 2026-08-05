/**
 * Permanent guard for the floating call BUBBLE (v2.107.47, owner request).
 *
 * The owner asked for the live-call panel to collapse to "a small icon ... you can
 * keep moving around the app or even minimize the app and keep talking." That is a
 * THIRD display state on top of `minimized`: a ~60px draggable bubble that frees the
 * whole screen while the call stays fully live (the engine div is never torn down).
 *
 * This test pins the wiring so a future refactor can't silently drop the bubble:
 *  - the `bubbled` state exists and resets to false when the call goes idle;
 *  - a control collapses the mini-box INTO the bubble (setBubbled(true));
 *  - tapping the bubble restores (setBubbled(false)) rather than hanging up;
 *  - the bubble shrinks the engine host to an invisible sliver (opacity:0, 1x1)
 *    so MEDIA KEEPS FLOWING — the whole point of "keep talking";
 *  - the app chrome is NOT hidden while bubbled (the body-class stays off, gated
 *    on !minimized, and the bubble is only reachable from minimized);
 *  - bubble labels exist in the dict in EN and AR.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const engine = readFileSync(join(__dirname, "RelayEngine.tsx"), "utf8");
const dict = readFileSync(join(__dirname, "dict", "engine.ts"), "utf8");

describe("floating call bubble — wiring guard", () => {
  it("has a bubbled display state", () => {
    expect(engine).toMatch(/const \[bubbled, setBubbled\] = useState\(false\)/);
  });

  it("resets bubbled when the call returns to idle", () => {
    const idleReset = engine.match(/phase === "idle"\)\s*{[^}]*}/);
    expect(idleReset, "idle reset block not found").toBeTruthy();
    expect(idleReset![0]).toContain("setBubbled(false)");
  });

  it("offers a control to collapse the mini-box into the bubble", () => {
    expect(engine).toContain("setBubbled(true)");
  });

  it("restores from the bubble instead of hanging up when tapped", () => {
    // the bubble's onClick sets bubbled false (guarded against a drag)
    expect(engine).toMatch(/setBubbled\(false\)/);
  });

  it("keeps media flowing: the bubbled engine host is an invisible 1x1 sliver, not display:none", () => {
    const sliver = engine.match(/bubbleEngineStyle:\s*React\.CSSProperties\s*=\s*{[\s\S]*?};/);
    expect(sliver, "bubbleEngineStyle not found").toBeTruthy();
    expect(sliver![0]).toContain("opacity: 0");
    expect(sliver![0]).toMatch(/width:\s*1\b/);
    expect(sliver![0]).toMatch(/height:\s*1\b/);
    // must NOT tear the media down
    expect(sliver![0]).not.toContain("display");
  });

  it("does not hide the app chrome while bubbled (body-class gated on !minimized, bubble only reachable from minimized)", () => {
    expect(engine).toContain('classList.toggle("relay-call-active", phase !== "idle" && !minimized)');
    // the bubble overlay is rendered under `active && bubbled`, and reaching bubbled
    // goes through the mini-box (minimized === true), so the chrome stays visible.
    expect(engine).toMatch(/active && bubbled \?/);
  });

  it("labels the bubble controls in EN and AR", () => {
    for (const key of ["engine.bubble", "engine.bubbleLabel", "engine.restoreCall"]) {
      expect(dict, `${key} missing`).toContain(`"${key}"`);
    }
    const block = dict.slice(dict.indexOf('"engine.restoreCall"'));
    expect(block.slice(0, 120)).toMatch(/ar:\s*"/);
  });
});
