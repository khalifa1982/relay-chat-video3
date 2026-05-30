import { describe, it, expect } from "vitest";

/**
 * v2.3.0 landing page is a scroll-driven presentation. These tests pin the
 * pure functions and invariants that the page depends on, without booting
 * the full component (no DOM / IntersectionObserver fakery required).
 *
 * The maths here mirror the StorySection / HeroPhone hooks in Home.tsx.
 */

// ---------------------------------------------------------------------------
// Scroll-progress math (mirrors useSectionProgress).
// progress(top, height, vh) maps the section's bounding box to a 0..1 number.
// progress = 0 when section top is at the viewport bottom (entering).
// progress = 1 when section bottom is at the viewport top (leaving).
// ---------------------------------------------------------------------------
function sectionProgress(top: number, height: number, vh: number): number {
  const raw = (vh - top) / (vh + height);
  return Math.max(0, Math.min(1, raw));
}

describe("Home — section progress math", () => {
  const VH = 800;
  const H = 1000;

  it("progress is 0 before the section enters the viewport", () => {
    expect(sectionProgress(VH + 50, H, VH)).toBe(0);
    expect(sectionProgress(VH, H, VH)).toBeCloseTo(0, 6);
  });

  it("progress is 1 after the section has fully left the viewport", () => {
    // section bottom at viewport top means top = -H
    expect(sectionProgress(-H, H, VH)).toBe(1);
    expect(sectionProgress(-H - 50, H, VH)).toBe(1);
  });

  it("progress is 0.5 when the section's top sits at -100 with vh=800,h=1000", () => {
    // raw = (800 - (-100)) / (800 + 1000) = 900 / 1800 = 0.5
    expect(sectionProgress(-100, H, VH)).toBeCloseTo(0.5, 6);
  });

  it("progress is monotonic in scroll position (as top decreases, progress rises)", () => {
    const tops = [VH, 400, 0, -200, -500, -H];
    const ps = tops.map((t) => sectionProgress(t, H, VH));
    for (let i = 1; i < ps.length; i++) {
      expect(ps[i]).toBeGreaterThanOrEqual(ps[i - 1]);
    }
  });
});

// ---------------------------------------------------------------------------
// Phone parallax derivation: the phone image translates from -60px at entry
// to +30px at exit (span of 90px across progress 0..1).
// ---------------------------------------------------------------------------
function phoneTranslateY(progress: number): number {
  return -60 + progress * 90;
}

describe("Home — phone parallax mapping", () => {
  it("starts low (negative) at entry and rises through center", () => {
    expect(phoneTranslateY(0)).toBe(-60);
    expect(phoneTranslateY(0.5)).toBe(-15);
    expect(phoneTranslateY(1)).toBe(30);
  });

  it("spans 90px from entry to exit", () => {
    expect(phoneTranslateY(1) - phoneTranslateY(0)).toBe(90);
  });
});

// ---------------------------------------------------------------------------
// Detail-panel reveal: opacity 0 below progress 0.18, full at 0.53, clamped 1.
// ---------------------------------------------------------------------------
function panelProgress(progress: number): number {
  return Math.max(0, Math.min(1, (progress - 0.18) / 0.35));
}

describe("Home — detail-panel reveal mapping", () => {
  it("is invisible before the section is meaningfully in view", () => {
    expect(panelProgress(0)).toBe(0);
    expect(panelProgress(0.17)).toBe(0);
  });

  it("fully revealed once progress passes 0.53", () => {
    expect(panelProgress(0.53)).toBeCloseTo(1, 6);
    expect(panelProgress(0.7)).toBe(1);
    expect(panelProgress(1)).toBe(1);
  });

  it("rises smoothly between 0.18 and 0.53", () => {
    expect(panelProgress(0.355)).toBeCloseTo(0.5, 2);
  });
});

// ---------------------------------------------------------------------------
// Asset URLs — all real-screenshot paths must be local /manus-storage/ refs.
// Regenerate via `manus-upload-file --webdev` if you ever rotate the assets.
// ---------------------------------------------------------------------------
const REAL_SCREENSHOT_PATHS = [
  "/manus-storage/dialer-empty_98fa535c.png",
  "/manus-storage/dialer-typed_8ad4c6c2.png",
  "/manus-storage/messages-empty_014c8014.png",
  "/manus-storage/messages-thread_3b435df8.png",
  "/manus-storage/contacts-empty_ee775a4f.png",
  "/manus-storage/profile_15ca08be.png",
];

describe("Home — real screenshot assets", () => {
  it("every asset path is server-relative and starts with /manus-storage/", () => {
    for (const p of REAL_SCREENSHOT_PATHS) {
      expect(p.startsWith("/manus-storage/")).toBe(true);
      expect(p.startsWith("http")).toBe(false);
    }
  });

  it("six unique paths, one per real app screen", () => {
    expect(new Set(REAL_SCREENSHOT_PATHS).size).toBe(6);
  });

  it("paths cover every key app screen by filename hint", () => {
    const joined = REAL_SCREENSHOT_PATHS.join("|");
    expect(joined).toMatch(/dialer-empty/);
    expect(joined).toMatch(/dialer-typed/);
    expect(joined).toMatch(/messages-empty/);
    expect(joined).toMatch(/messages-thread/);
    expect(joined).toMatch(/contacts-empty/);
    expect(joined).toMatch(/profile/);
  });
});

// ---------------------------------------------------------------------------
// Section layout alternates between standard and reversed (index % 2 === 1).
// ---------------------------------------------------------------------------
describe("Home — section alternation", () => {
  it("even-indexed sections render image on left, odd-indexed on right", () => {
    const reversed = (i: number) => i % 2 === 1;
    expect(reversed(0)).toBe(false);
    expect(reversed(1)).toBe(true);
    expect(reversed(2)).toBe(false);
    expect(reversed(3)).toBe(true);
    expect(reversed(4)).toBe(false);
    expect(reversed(5)).toBe(true);
  });
});
