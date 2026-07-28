import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { codeOnly } from "../../../server/testing/codeOnly";

const R = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const TOPBAR = R("client/src/app/TopBar.tsx");
const SHELL = R("client/src/app/AppShell.tsx");
const CSS = R("client/src/index.css");


const BRAND = TOPBAR.slice(
  TOPBAR.indexOf("export function BrandMark"),
  TOPBAR.indexOf("export function IdentityStrip"),
);

/** Brace-matched to one keyframe block. An unbounded slice reads percentages out of
 *  every LATER keyframe too — the fragility v2.99.94 already had to rewrite out. */
function kfBody(name: string): string {
  const at = CSS.indexOf(`@keyframes ${name} {`);
  if (at < 0) return "";
  let depth = 0;
  for (let i = CSS.indexOf("{", at); i < CSS.length; i++) {
    if (CSS[i] === "{") depth++;
    else if (CSS[i] === "}") {
      depth--;
      if (depth === 0) return CSS.slice(at, i + 1);
    }
  }
  return "";
}

/** Every percentage keyframe in a block, so "when does motion stop" is derivable. */
function stops(name: string): number[] {
  const body = kfBody(name);
  return [...body.matchAll(/(?:^|\n)\s+([\d.]+)%/g)].map((m) => Number(m[1]));
}

/**
 * v2.103.2 — the RELAY wordmark, which the owner reported as absent.
 *
 * Owner: *"I saw one time you put the relay logo up in the top bar. It's moving
 * animated. Now it's not showing. Why? The word rely itself. I told you every thirty
 * seconds, make animation."*
 *
 * THREE SEPARATE CAUSES, each confirmed against the source before anything was changed,
 * and each fixed here. None of them was a later release breaking v2.99.94 — the
 * wordmark's own markup was byte-identical to what that release shipped.
 *
 *   1. A 390px BREAKPOINT. `max-[389px]:hidden` removed the word outright on 375px
 *      iPhones (SE / 8 / 13 mini) and 360px Androids while leaving the dot and the
 *      connection line in place, so the bar looked intact and the word was simply
 *      gone. Headless measurement against the real built stylesheet says that
 *      breakpoint was two whole phone sizes too cautious: with the longest name and
 *      the PIN present, 360 / 375 / 390 / 430 all have real slack, and even 320 is
 *      clear at the peak this release uses. The breakpoint is gone entirely.
 *
 *   2. ONE MOUNT, ON A `md:hidden` SURFACE. The only `<BrandMark>` lived in the mobile
 *      header, so above 768px the animated wordmark did not exist at all — the desktop
 *      sidebar drew a different, static, uppercase span. It now mounts BrandMark, which
 *      also gives desktop the connection line it never had.
 *
 *   3. A DUTY CYCLE v2.99.94 CUT BY ITSELF. Measured from the running animation, that
 *      release's word moved for 1.3s of every 30s — 4.4% — because the cycle was
 *      stretched from 5.5s to 30s without stretching the motion with it. The cadence
 *      the owner asked for was delivered and the event inside it became nearly
 *      invisible. Now 3.1s of 30s, with two beats instead of one.
 *
 * AND A FOURTH THING NOBODY HAD NOTICED, found by that same measurement: the sheen band
 * came to REST ON THE WORD. Its travel ended at translateX(320%) of a 24px band, which
 * puts its left edge at 52.8px — inside a 64px mark — and it was HELD there from 7% to
 * 100% of the cycle. So for 29.2 of every 30 seconds there was a static bright smear
 * over the last letter rather than a sheen that passes. v2.99.86 had the same end point
 * and only got away with it by repeating every 5.5s. Fixed by tightening the travel,
 * which is pinned below as a clearance calculation rather than as a magic number.
 *
 * These are structural pins. The perceptual numbers behind them (duty cycle, peak,
 * visible band width) come from sampling the real animation with a negative
 * animation-delay in headless Chromium; a unit test cannot re-run that, so what it
 * guards is every source rule those measurements depend on.
 */
describe("v2.103.2 — the wordmark is visible on every screen", () => {
  it("carries NO breakpoint, so no phone width can hide it", () => {
    // This is the direct answer to "it's not showing". A width-conditional class here
    // is exactly the defect.
    expect(BRAND).toMatch(/>\s*RELAY\s*</);
    expect(codeOnly(BRAND)).not.toMatch(/max-\[\d+px\]:hidden/);
    // Nor any other way of hiding it at a width.
    expect(codeOnly(BRAND)).not.toMatch(/\bhidden\s+(?:sm|md|lg|xl):/);
    expect(codeOnly(BRAND)).not.toMatch(/max-(?:sm|md|lg):hidden/);
  });

  it("the brand dot is not width-conditional either", () => {
    // It never was, and the bar must keep its anchor whatever happens to the word.
    const dot = BRAND.slice(BRAND.indexOf("relay-heartbeat"));
    expect(dot.length).toBeGreaterThan(200);
    expect(codeOnly(dot.slice(0, 300))).not.toMatch(/hidden/);
  });

  it("mounts on BOTH shell surfaces, which are mutually exclusive breakpoints", () => {
    // REWRITTEN from the v2.99.94 pin, which asserted exactly ONE mount — and that one
    // mount was on `md:hidden`, so it froze the state where desktop had no animated
    // wordmark at all. Two mounts is correct here BECAUSE the surfaces cannot both be
    // visible: the sidebar is `hidden md:flex`, the header is `md:hidden`. The
    // wordmark's own rules still live in one place (inside BrandMark), so nothing is
    // restated; and `useConnectionState` is a `useSyncExternalStore` over window events
    // with no timer, so a second subscription costs nothing measurable.
    expect(SHELL.match(/<BrandMark\b/g)?.length).toBe(2);
    expect(SHELL).not.toMatch(/<BrandMark compact/);

    const sidebar = SHELL.slice(SHELL.indexOf("<aside"), SHELL.indexOf("</aside>"));
    expect(sidebar.length).toBeGreaterThan(500);
    expect(sidebar).toMatch(/hidden md:flex/);
    expect(sidebar).toMatch(/<BrandMark \/>/);
    // The static uppercase span it replaced must be gone, or both would render.
    expect(codeOnly(sidebar)).not.toMatch(/uppercase tracking-\[0\.18em\][^>]*>RELAY</);

    const header = SHELL.slice(SHELL.indexOf("{/* mobile header */}"));
    const headerEl = header.slice(0, header.indexOf("</header>"));
    expect(headerEl.length).toBeGreaterThan(500);
    expect(headerEl).toMatch(/md:hidden/);
    expect(headerEl).toMatch(/<BrandMark \/>/);
  });
});

describe("v2.103.2 — the 30-second flourish is long enough to be seen", () => {
  it("both halves run the owner's 30s cadence with no JS timer", () => {
    // "it keep animated every 30 seconds". A CSS cycle whose motion occupies a small
    // opening fraction gives an event every half minute with nothing to arm or leak.
    for (const [cls, kf] of [
      ["relay-sheen", "relaySheen"],
      ["relay-word-pop", "relayWordPop"],
    ] as const) {
      const m = CSS.match(new RegExp(`\\.${cls} \\{\\s*animation: ${kf} ([\\d.]+)s`));
      expect(m, `${cls} declares a duration`).toBeTruthy();
      expect(Number(m![1]), `${cls} runs on the 30s cadence`).toBe(30);
    }
    // No interval, no rAF, no state tick driving any of this.
    expect(codeOnly(BRAND)).not.toMatch(/setInterval|requestAnimationFrame|setTimeout/);
  });

  it("motion occupies a window that is small BUT NOT VANISHING — both bounds", () => {
    // THE UPPER BOUND ALONE IS WHAT LET v2.99.94 REGRESS. Its pin asserted the motion
    // ended at or before 10% of the cycle and said nothing about a floor, so shortening
    // the flourish to 5% — 1.3s of 30s, which the owner then reported as the word not
    // animating — passed cleanly. A one-sided bound on a perceptual property rewards
    // making the thing disappear.
    for (const kf of ["relaySheen", "relayWordPop"]) {
      const pcts = stops(kf).filter((p) => p < 100);
      expect(pcts.length, `${kf} has percentage keyframes`).toBeGreaterThan(0);
      const end = Math.max(...pcts);
      expect(end, `${kf} motion is long enough to notice`).toBeGreaterThanOrEqual(8);
      expect(end, `${kf} still rests for most of the cycle`).toBeLessThanOrEqual(20);
    }
  });

  it("the word and the band finish at the SAME point, so it reads as one event", () => {
    // v2.99.94 had the word stop at 5% and the band at 7%: two things happening near
    // each other rather than one flourish.
    const word = Math.max(...stops("relayWordPop").filter((p) => p < 100));
    const band = Math.max(...stops("relaySheen").filter((p) => p < 100));
    expect(word).toBe(band);
  });

  it("swells TWICE, the second beat smaller — the dot's own language", () => {
    // A single swell reads as a glitch. The brand dot beside it already beats twice
    // ("flashing similar to the heart way"), so this matches rather than competes.
    const body = kfBody("relayWordPop");
    expect(body).not.toBe("");
    const peaks = [...body.matchAll(/transform: scale\(1\.(\d+)\)/g)].map((m) => Number(`1.${m[1]}`));
    expect(peaks.length).toBeGreaterThanOrEqual(2);
    expect(peaks[1]).toBeLessThan(peaks[0]);
    // …and it returns to rest, so the still frame under reduced motion is the mark.
    expect(body).toMatch(/scale\(1\)/);
  });

  it("the peak is the MEASURED-safe 1.1 and no larger", () => {
    // A transform paints outside its layout box, so the swell can reach the middle zone
    // without changing any geometry. 1.1 is the largest peak that keeps positive slack
    // against the longest display name at every width down to 320px; 1.14 grazes it.
    const peaks = [...kfBody("relayWordPop").matchAll(/scale\(1\.(\d+)\)/g)].map((m) => Number(`1.${m[1]}`));
    expect(Math.max(...peaks)).toBeLessThanOrEqual(1.1);
    // The origin is what makes the growth predictable — it grows away from the dot.
    expect(BRAND).toMatch(/transformOrigin: "left center"/);
  });
});

describe("v2.103.2 — the sheen passes across the mark instead of parking on it", () => {
  it("CLEARS a 64px mark at the end of its travel", () => {
    // THE PIN THAT WOULD HAVE CAUGHT THE FOUR-RELEASE-OLD BUG. The band is `w-N` at
    // `-left-N`, so its static box is [-N, 0] and translateX(p%) shifts it by p% of N.
    // At the end keyframe its LEFT edge sits at (p/100 - 1) * N, and anything wider
    // than that is still under the band — held there for the rest of the cycle.
    //
    // v2.99.86 and v2.99.94: N = 24, p = 320 ⇒ left edge 52.8px, so an 11px strip of a
    // 64px mark stayed lit. Measured: the band was on screen for 29.2 of every 30s.
    const band = BRAND.match(/-left-(\d+) w-(\d+) relay-sheen/);
    expect(band, "the band declares matching left/width").toBeTruthy();
    expect(band![1]).toBe(band![2]);
    const N = Number(band![1]) * 4; // Tailwind spacing unit = 4px
    const endPct = Math.max(...[...kfBody("relaySheen").matchAll(/translateX\((-?[\d.]+)%\)/g)].map((m) => Number(m[1])));
    const clearance = (endPct / 100) * N - N;
    // The mark measures 64px at text-sm with 0.22em tracking.
    expect(clearance, `band clears only ${clearance}px — a 64px mark stays lit`).toBeGreaterThanOrEqual(64);
  });

  it("rests entirely OUTSIDE the clip, so reduced motion shows no smear", () => {
    // With the animation inert there is no transform, so the static box must already be
    // fully off the leading edge: `-left-N w-N` puts it at [-N, 0], flush and invisible.
    const band = BRAND.match(/-left-(\d+) w-(\d+) relay-sheen/);
    expect(band![1]).toBe(band![2]);
    // …and the START keyframe must not put it back on screen either.
    const startPct = Math.min(...[...kfBody("relaySheen").matchAll(/translateX\((-?[\d.]+)%\)/g)].map((m) => Number(m[1])));
    expect(startPct).toBeLessThanOrEqual(0);
  });

  it("sweeps LINEARLY, because ease-in-out is fastest where it is visible", () => {
    // ease-in-out concentrates speed at the midpoint of the window — and the midpoint
    // is precisely the part crossing the letters, so the band was gone in 1.4s of a
    // 3.6s window. Switching to linear took the visible portion to 3.3s with no other
    // change. The pop keeps its easing: a swell should ease, a sweep should not.
    expect(CSS).toMatch(/\.relay-sheen \{\s*animation: relaySheen 30s linear infinite;/);
    expect(CSS).toMatch(/\.relay-word-pop \{\s*animation: relayWordPop 30s ease-in-out infinite;/);
  });

  it("is wide enough to read as the mark lighting up", () => {
    // 24px crossing a 64px word is a glint; 40px is most of the mark. This is free
    // safety-wise: the band is clipped to the word's own box, so unlike the swell it
    // cannot reach anything beside it however wide it gets.
    const band = BRAND.match(/-left-(\d+) w-(\d+) relay-sheen/);
    expect(Number(band![2]) * 4).toBeGreaterThanOrEqual(40);
    // Still clipped, and still unable to intercept a tap.
    expect(BRAND).toMatch(/pointer-events-none absolute inset-0 overflow-hidden/);
  });
});

describe("v2.103.2 — the motion rules still hold", () => {
  it("both animations stay inside the reduced-motion gate", () => {
    // The owner asked for a decorative flourish. Hoisting these out of the gate would
    // override an accessibility request to deliver it, so Reduce Motion suppresses the
    // animation and leaves the plain word — which is the correct trade and is why the
    // still frame is asserted to be the unscaled mark above.
    const gateAt = CSS.indexOf("@media (prefers-reduced-motion: no-preference)");
    expect(gateAt).toBeGreaterThan(0);
    for (const cls of [".relay-sheen", ".relay-word-pop"]) {
      expect(CSS.indexOf(cls), `${cls} is inside the gate`).toBeGreaterThan(gateAt);
    }
  });

  it("neither keyframe animates a repainting property", () => {
    // The bar's surface is `backdrop-blur-xl backdrop-saturate-150`, the most expensive
    // host in the app to repaint over (v2.99.84 removed 14 of exactly this).
    for (const kf of ["relaySheen", "relayWordPop"]) {
      const body = kfBody(kf);
      expect(body, `${kf} exists`).not.toBe("");
      const props = [...body.matchAll(/^\s+([a-z-]+):/gm)].map((m) => m[1]);
      expect(props.length).toBeGreaterThan(0);
      for (const p of props) expect(["transform", "opacity"], `${kf} animates ${p}`).toContain(p);
    }
  });

  it("the brand mark is still inert — it navigates nowhere", () => {
    // v2.99.94 (owner): the middle of the bar is a label, not a shortcut. Mounting it
    // on a second surface must not quietly reintroduce a tap target.
    const code = codeOnly(BRAND);
    expect(code.length).toBeGreaterThan(400);
    expect(code).not.toMatch(/<Link/);
    expect(code).not.toMatch(/href=/);
    expect(code).not.toMatch(/onClick=/);
  });
});
