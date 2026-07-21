import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

/**
 * Guest ID-reveal ("matrix" animation), login-overhaul part 1. Source-pinned
 * (no DOM test env): the reveal must (a) exist as its own overlay component that
 * cleans up its rAF loops and respects reduced-motion, and (b) be gated in
 * OnboardingGate BEFORE the identity check so it outlasts `me` flipping truthy,
 * while a call-link join skips it and goes straight to the dial.
 */
describe("MatrixReveal component", () => {
  const src = read("client/src/app/MatrixReveal.tsx");

  it("is a full-screen overlay that decodes the 6-digit number", () => {
    expect(src).toMatch(/fixed inset-0/);
    expect(src).toMatch(/Generating your RELAY ID/);
    // Locks onto the real number once known.
    expect(src).toMatch(/\/\^\\d\{6\}\$\//);
  });

  it("respects reduced-motion and tears down its animation frames", () => {
    expect(src).toMatch(/prefers-reduced-motion: reduce/);
    expect(src).toMatch(/cancelAnimationFrame/);
    // rain canvas must not eat clicks
    expect(src).toMatch(/pointer-events-none/);
  });

  it("calls onDone after a minimum on-screen time (no instant flash)", () => {
    expect(src).toMatch(/MIN_MS/);
    expect(src).toMatch(/onDone\(\)/);
  });
});

describe("OnboardingGate — reveal wiring", () => {
  const src = read("client/src/app/OnboardingGate.tsx");

  it("renders MatrixReveal BEFORE the identity gate so it survives me flipping truthy", () => {
    expect(src).toMatch(/import \{ MatrixReveal \}/);
    const revealIdx = src.indexOf("if (revealing)");
    const meGateIdx = src.indexOf("if (me) return <>{children}</>");
    expect(revealIdx).toBeGreaterThan(-1);
    expect(meGateIdx).toBeGreaterThan(-1);
    expect(revealIdx).toBeLessThan(meGateIdx);
  });

  it("skips the reveal on a call-link join (straight into the dial)", () => {
    expect(src).toMatch(/if \(!callTarget\) setRevealing\(true\)/);
  });
});
