/**
 * THE ON-SCREEN KEYBOARD MUST NOT COVER THE COMPOSER.
 *
 * The owner: "I went inside the message screens and I cannot send messages."
 *
 * MEASURED against the real built bundle at 390x844, with the visual viewport shrunk to
 * 400 to simulate the iOS keyboard:
 *
 *                     --relay-vh   <main> height   input bottom edge
 *   keyboard closed      844px          844              785
 *   keyboard OPEN        844px          844              785   ← 385px UNDER the keyboard
 *
 * `AppShell` DID subscribe to `visualViewport`'s resize — and then wrote
 * `window.innerHeight`, which on iOS does not change when the keyboard opens. So the
 * handler fired and wrote an unchanged value: a subscription that reads as handled while
 * handling nothing. Tap the composer on a phone and the field you just tapped, and Send
 * beside it, are underneath the keyboard.
 *
 * After the fix, same measurement: `--relay-vh` 400px, main 400, input bottom **341** —
 * 59px of clearance inside the visible area.
 *
 * It is worse in THIS app than in most for a reason this app chose deliberately: v2.76
 * locks document scrolling to stop iOS shoving the whole app past its own end, which also
 * removed the browser's own scroll-the-focused-input-into-view rescue. The lock is right
 * and stays; the missing half was a keyboard-aware height.
 *
 * These are source pins because the suite is node-environment with no layout engine — a
 * unit test cannot open a keyboard. Each pins the PROPERTY that the measurement rests on,
 * and each is mutation-verified to bite.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { codeOnly } from "../../../server/testing/codeOnly";

const SHELL = "client/src/app/AppShell.tsx";
const src = () => codeOnly(readFileSync(SHELL, "utf8"));

/** The body of the effect that writes `--relay-vh`, bounded by its own end. */
function vhEffect(s: string): string {
  const at = s.indexOf('root.style.setProperty("--relay-vh"');
  expect(at, "the --relay-vh writer must exist").toBeGreaterThan(-1);
  // Walk back to the enclosing useEffect, forward to its cleanup's end.
  const start = s.lastIndexOf("useEffect(", at);
  const end = s.indexOf('root.style.removeProperty("--relay-vh")', at);
  expect(end, "the effect's cleanup must exist").toBeGreaterThan(start);
  const body = s.slice(start, end);
  expect(body.length, "the slice must be real, not an accident").toBeGreaterThan(200);
  return body;
}

describe("the shell height follows the VISIBLE viewport, not just the layout one", () => {
  it("reads visualViewport.height and takes the SMALLER of the two", () => {
    /* THE DEFECT WAS EXACTLY THIS: the effect listened to visualViewport and then wrote
       innerHeight. Reading `vv.height` is the property; taking the MINIMUM is what makes
       it correct in both directions, since innerHeight is the right answer whenever the
       keyboard is closed. */
    const body = vhEffect(src());
    expect(body).toMatch(/visualViewport/);
    expect(body).toMatch(/\bvv\.height\b|visualViewport\.height/);
    expect(body, "must take the smaller of layout and visible height").toMatch(/Math\.min\(/);
    expect(body).toMatch(/window\.innerHeight/);
  });

  it("does NOT trust the visible height while the page is pinch-zoomed", () => {
    /* visualViewport.height also shrinks under a zoom. Without the scale guard, magnifying
       the page would SHRINK the app — a new bug traded for the old one. */
    const body = vhEffect(src());
    expect(body).toMatch(/\.scale\b/);
  });

  it("floors the height, so a transient bad reading cannot collapse the app to nothing", () => {
    /* Failing toward "too tall" is recoverable by scrolling. Failing toward "no height" is
       a blank app, which is the direction that must be impossible. */
    const body = vhEffect(src());
    expect(body).toMatch(/Math\.max\(\s*\d{3}/);
  });

  it("re-measures on a visual-viewport SCROLL as well as a resize", () => {
    // iOS moves the visual viewport as well as resizing it; a move with no resize still
    // changes what is on screen.
    const body = vhEffect(src());
    expect(body).toMatch(/addEventListener\("scroll", set\)/);
    expect(body).toMatch(/addEventListener\("resize", set\)/);
    expect(body).toMatch(/addEventListener\("orientationchange", set\)/);
  });

  it("every listener it adds, it removes", () => {
    const body = vhEffect(src());
    const added = Array.from(body.matchAll(/addEventListener\("(\w+)"/g)).map((m) => m[1]);
    const removed = Array.from(body.matchAll(/removeEventListener\("(\w+)"/g)).map((m) => m[1]);
    expect(added.length).toBeGreaterThan(3);
    for (const ev of new Set(added)) expect(removed, `never removes ${ev}`).toContain(ev);
  });
});

describe("nothing overrides the shrunk height back up again", () => {
  it("`min-h-svh` is cancelled on mobile, or the whole fix is a NO-OP", () => {
    /* `min-height` WINS over `height`. `min-h-svh` carries no breakpoint prefix, so it
       applies on a phone too — shrinking `--relay-vh` to the keyboard-visible height
       would be overridden straight back to ~100svh and the composer would stay under the
       keyboard. Measured both ways: with `min-h-svh` alone the shell stayed 844.
       The desktop rule is deliberately untouched. */
    const s = src();
    const at = s.indexOf("max-md:h-[var(--relay-vh");
    expect(at, "the mobile height rule must exist").toBeGreaterThan(-1);
    const cls = s.slice(s.lastIndexOf('className="', at), s.indexOf('"', at) + 1);
    expect(cls, "must cancel min-h-svh below md").toContain("max-md:min-h-0");
    expect(cls, "desktop keeps its own height rule").toContain("md:h-svh");
  });

  it("the measured height is what sizes the mobile shell, with a CSS fallback", () => {
    /* The var must carry a fallback: it is unset until the first measurement lands, and an
       unset custom property is an INVALID declaration the browser drops — which would mean
       no height at all rather than a default. */
    expect(src()).toMatch(/max-md:h-\[var\(--relay-vh,\s*100svh\)\]/);
  });

  it("document scrolling stays LOCKED — the v2.76 decision is not being undone here", () => {
    /* The lock is why the keyboard case needed fixing at all (it removes the browser's own
       scroll-into-view), and removing it would reintroduce iOS shoving the app past its own
       end. The fix is the height, not the lock. */
    expect(src()).toMatch(/relay-app-lock/);
  });
});
