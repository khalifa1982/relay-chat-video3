import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Bilingual (AR / EN) marketing landing page.
 *
 * These tests pin the invariants of the generated file (bilingual copy,
 * language toggle + RTL handling, the live-stats query, the Gemini-generated
 * visuals, the CTA target and the version footer) plus the pure count-up
 * easing math the page relies on — without booting the full component.
 */

const HOME_TSX = fs.readFileSync(path.resolve(__dirname, "Home.tsx"), "utf8");

// ---------------------------------------------------------------------------
// 1. Static analysis of client/src/pages/Home.tsx
// ---------------------------------------------------------------------------
describe("Home.tsx — bilingual landing page", () => {
  it("default-exports a Home component", () => {
    expect(HOME_TSX).toMatch(/export\s+default\s+function\s+Home/);
  });

  it("ships both an English and an Arabic copy table", () => {
    expect(HOME_TSX).toMatch(/\ben:\s*{/);
    expect(HOME_TSX).toMatch(/\bar:\s*{/);
  });

  it("exposes a language toggle for EN and Arabic", () => {
    expect(HOME_TSX).toMatch(/setLang\(["']en["']\)/);
    expect(HOME_TSX).toMatch(/setLang\(["']ar["']\)/);
  });

  it("switches document direction to RTL for Arabic", () => {
    expect(HOME_TSX).toMatch(/dir:\s*["']rtl["']/);
    expect(HOME_TSX).toMatch(/dir:\s*["']ltr["']/);
    expect(HOME_TSX).toMatch(/setAttribute\(["']dir["']/);
  });

  it("contains real Arabic feature copy", () => {
    // RELAY brand kept Latin, but the body copy must be Arabic.
    expect(HOME_TSX).toMatch(/مكالمات/); // "calls"
    expect(HOME_TSX).toMatch(/متصفحك/); // "your browser"
    expect(HOME_TSX).toMatch(/خصوصية/); // "privacy"
  });

  it("queries the live public-stats endpoint with a refetch interval", () => {
    expect(HOME_TSX).toMatch(/trpc\.stats\.public\.useQuery/);
    expect(HOME_TSX).toMatch(/refetchInterval/);
  });

  it("renders all four live stat figures", () => {
    expect(HOME_TSX).toMatch(/registeredUsers/);
    expect(HOME_TSX).toMatch(/guestsServed/);
    expect(HOME_TSX).toMatch(/totalParties/);
    expect(HOME_TSX).toMatch(/onlineNow/);
  });

  it("links the primary CTA to /app", () => {
    expect(HOME_TSX).toMatch(/href=["']\/app["']/);
  });

  it("renders the version footer from the shared single source of truth", () => {
    expect(HOME_TSX).toMatch(/APP_VERSION/);
    expect(HOME_TSX).toMatch(/@shared\/version/);
    expect(HOME_TSX).toMatch(/©\s*{?\s*new Date\(\)\.getFullYear\(\)/);
  });

  it("does not credit or mention Gemini anywhere on the page", () => {
    expect(HOME_TSX).not.toMatch(/Gemini/);
  });

  it("uses the authentic app-grounded visuals (not the old imaginary mockups)", () => {
    expect(HOME_TSX).toMatch(/relay-real-/);
    expect(HOME_TSX).not.toMatch(/relay-mock-/);
  });
});

// ---------------------------------------------------------------------------
// 1b. Bottom-gap fix + scroll-reveal animations
// ---------------------------------------------------------------------------
describe("Home.tsx — bottom gap fix", () => {
  it("paints html and body with the page background to kill the overscroll gap", () => {
    expect(HOME_TSX).toMatch(/html\.style\.backgroundColor\s*=\s*PAGE_BG/);
    expect(HOME_TSX).toMatch(/body\.style\.backgroundColor\s*=\s*PAGE_BG/);
  });

  it("disables vertical overscroll bounce", () => {
    expect(HOME_TSX).toMatch(/overscrollBehaviorY\s*=\s*["']none["']/);
  });

  it("restores the previous html/body styles on unmount", () => {
    expect(HOME_TSX).toMatch(/html\.style\.backgroundColor\s*=\s*prev\.htmlBg/);
    expect(HOME_TSX).toMatch(/body\.style\.backgroundColor\s*=\s*prev\.bodyBg/);
  });
});

describe("Home.tsx — scroll-reveal animations", () => {
  it("defines a scroll-reveal hook backed by IntersectionObserver", () => {
    expect(HOME_TSX).toMatch(/function\s+useScrollReveal/);
    expect(HOME_TSX).toMatch(/new IntersectionObserver/);
    expect(HOME_TSX).toMatch(/classList\.add\(["']is-in["']\)/);
  });

  it("invokes the reveal hook and re-scans on language change", () => {
    expect(HOME_TSX).toMatch(/useScrollReveal\(\[lang\]\)/);
  });

  it("marks multiple sections with data-reveal", () => {
    const count = (HOME_TSX.match(/data-reveal/g) ?? []).length;
    expect(count).toBeGreaterThanOrEqual(6);
  });

  it("uses directional reveals for the alternating showcase/mobile rows", () => {
    expect(HOME_TSX).toMatch(/data-reveal=\{flip \? ["']right["'] : ["']left["']\}/);
    expect(HOME_TSX).toMatch(/data-reveal=\{isAr \? /);
  });

  it("staggers grouped reveals with a per-item --d delay", () => {
    expect(HOME_TSX).toMatch(/["']--d["']:\s*`\$\{/);
  });

  it("gates reveal motion behind prefers-reduced-motion", () => {
    expect(HOME_TSX).toMatch(/prefers-reduced-motion: no-preference/);
    expect(HOME_TSX).toMatch(/\[data-reveal\]\.is-in/);
  });

  it("drives full-page scroll-linked motion via a rAF-throttled hook", () => {
    expect(HOME_TSX).toMatch(/function\s+useScrollMotion/);
    expect(HOME_TSX).toMatch(/useScrollMotion\(\)/);
    expect(HOME_TSX).toMatch(/requestAnimationFrame/);
    expect(HOME_TSX).toMatch(/setProperty\("--sp"/);
    expect(HOME_TSX).toMatch(/setProperty\("--sy"/);
  });

  it("renders a scroll-progress bar and an animated aurora layer", () => {
    expect(HOME_TSX).toMatch(/scroll-progress/);
    expect(HOME_TSX).toMatch(/aurora/);
    expect(HOME_TSX).toMatch(/hero-parallax/);
  });
  it("reveals headlines word-by-word with a per-word delay", () => {
    expect(HOME_TSX).toMatch(/data-reveal="words"/);
    expect(HOME_TSX).toMatch(/class="word"|className="word"/);
    expect(HOME_TSX).toMatch(/--wd/);
    expect(HOME_TSX).toMatch(/\[data-reveal="words"\]\.is-in \.word/);
  });
  it("shifts the page accent color as the user scrolls (hue-rotate via --hue)", () => {
    expect(HOME_TSX).toMatch(/setProperty\("--hue"/);
    expect(HOME_TSX).toMatch(/hue-rotate\(calc\(var\(--hue/);
    expect(HOME_TSX).toMatch(/accent-shift/);
  });

  it("bails out of scroll motion when reduced motion is preferred", () => {
    expect(HOME_TSX).toMatch(/prefers-reduced-motion: reduce/);
  });

  it("only animates transform and opacity (GPU-friendly)", () => {
    // the reveal transition list must not animate layout props
    expect(HOME_TSX).not.toMatch(/transition:[^;]*\b(width|height|margin|padding|top|left)\b/);
  });
});

// ---------------------------------------------------------------------------
// 2. Visual assets — Gemini-generated mockups served from the CDN
// ---------------------------------------------------------------------------
describe("Home.tsx — visual assets", () => {
  it("references the dialer, chat, group, mobile mockups and hero background", () => {
    for (const key of ["dialer", "chat", "group", "mobile", "heroBg"]) {
      expect(HOME_TSX).toMatch(new RegExp(`${key}\\s*:`));
    }
  });

  it("serves images from the project storage path (real captured screenshots)", () => {
    // The landing visuals are real screenshots captured from the live app and
    // served via the persistent /manus-storage path.
    const storageRefs = HOME_TSX.match(/\/manus-storage\/relay-real-[^"'\s]+/g) ?? [];
    expect(storageRefs.length).toBeGreaterThanOrEqual(4);
  });

  it("does not import images from the local filesystem", () => {
    expect(HOME_TSX).not.toMatch(
      /import\s+\w+\s+from\s+['"]\.\.?\/.+\.(png|jpe?g|webp|svg)['"]/,
    );
  });
});

// ---------------------------------------------------------------------------
// 3. Pure count-up easing math — mirrors the useCountUp loop in the page.
//
//   p      = clamp((now - start) / duration, 0, 1)
//   eased  = 1 - (1 - p)^3                (cubic ease-out)
//   value  = round(target * eased)
// ---------------------------------------------------------------------------
function easeOutCubic(p: number) {
  const c = Math.max(0, Math.min(1, p));
  return 1 - Math.pow(1 - c, 3);
}
function countUpValue(target: number, p: number) {
  return Math.round(target * easeOutCubic(p));
}

describe("Home — count-up easing", () => {
  it("starts at 0 progress and lands exactly on the target", () => {
    expect(countUpValue(40, 0)).toBe(0);
    expect(countUpValue(40, 1)).toBe(40);
  });

  it("is monotonic non-decreasing across progress", () => {
    const ps = [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1];
    const vals = ps.map((p) => countUpValue(1000, p));
    for (let i = 1; i < vals.length; i++) {
      expect(vals[i]).toBeGreaterThanOrEqual(vals[i - 1]);
    }
  });

  it("eases out — more than half the distance is covered by the halfway point", () => {
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5);
  });

  it("clamps progress outside [0,1]", () => {
    expect(countUpValue(40, -2)).toBe(0);
    expect(countUpValue(40, 5)).toBe(40);
  });

  it("a zero target stays at zero for any progress", () => {
    for (const p of [0, 0.3, 0.7, 1]) {
      expect(countUpValue(0, p)).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Showcase alternation — every other screenshot row flips sides.
// ---------------------------------------------------------------------------
describe("Home — showcase row alternation", () => {
  it("flips on odd indices (idx % 2 === 1)", () => {
    const flip = (i: number) => i % 2 === 1;
    expect([0, 1, 2].map(flip)).toEqual([false, true, false]);
  });
});
