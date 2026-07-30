/**
 * design_handoff_relay_app — PHASE 2b, screen 1a (the Dialer), plus the shared
 * number-sharing module the board's MY NUMBER card forced into existence.
 *
 * WHY THIS SUITE EXISTS AT ALL: phase 1 shipped ten design utilities and phase 2a used
 * three of them. `.rglass`, `.rcta`, `.rchip-accent` and the rest were dead code on every
 * screen — the tokens existed and nothing read them. These pins are what stop a screen
 * from silently reverting to its pre-redesign surfaces while the utilities sit unused
 * again.
 *
 * WHAT IS MEASURED RATHER THAN PINNED: all of the geometry. A source pin cannot tell you
 * whether a circle is round or whether a card fits a 568px phone, and BOTH of those were
 * wrong in the first cut — the keys came out 99x80 (oval by 18px) because `gridAutoRows`
 * sized rows independently of the column width, and the new MY NUMBER row pushed a card
 * that had fitted every width into a 121px overflow at 375x667. Measured in headless
 * Chromium against the real built stylesheet at 320/360/375/390/430: 35/35, keys exactly
 * round (0.0px deviation) at every width, card fits everywhere.
 *
 * THE MEASUREMENT ALSO ESTABLISHED A BASELINE, which is why the short-screen rules exist:
 * the PRE-redesign card fitted all five widths, so a card that scrolls on a phone would be
 * a regression this release caused rather than a limit it inherited.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const DIALER = read("client/src/pages/app/Dialer.tsx");
const SHARE = read("client/src/app/ShareNumber.tsx");
const PROFILE = read("client/src/pages/app/Profile.tsx");
const CSS = read("client/src/index.css");

/** Comment-stripped source. This repo has matched its own prose 18+ times. */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*)/.test(l))
    .join("\n");
}
const DIALER_CODE = code(DIALER);
const SHARE_CODE = code(SHARE);
const PROFILE_CODE = code(PROFILE);
const CSS_CODE = CSS.replace(/\/\*[\s\S]*?\*\//g, "");

/** A CSS rule's own body, bounded by its closing brace — never by whichever rule happens
 *  to sit next, which is how a phase-1 pin came to fail on correct code when `.rtabbar`
 *  landed inside its window. */
function rule(sel: string): string {
  const at = CSS_CODE.indexOf(sel);
  expect(at, `no such rule: ${sel}`).toBeGreaterThan(0);
  const body = CSS_CODE.slice(at, CSS_CODE.indexOf("}", at) + 1);
  expect(body.length, sel).toBeGreaterThan(20);
  return body;
}

describe("the board's MY NUMBER card exists and is SHARED, not duplicated", () => {
  it("the QR renderer and the share sheet live in ONE module", () => {
    // Extracted from Profile rather than copied: two QR renderers, two invite-link
    // formats and two share fallbacks would drift apart one edit at a time.
    expect(SHARE_CODE).toMatch(/export function QrGlyph\(/);
    expect(SHARE_CODE).toMatch(/export function ShareNumberSheet\(/);
    expect(SHARE_CODE).toMatch(/export function MyNumberCard\(/);
    // …and Profile now IMPORTS them rather than defining its own.
    expect(PROFILE_CODE).toMatch(/import \{ QrGlyph, ShareNumberSheet \} from "@\/app\/ShareNumber"/);
    expect(PROFILE_CODE).not.toMatch(/function QrGlyph\(/);
    expect(PROFILE_CODE).not.toMatch(/function ShareNumberSheet\(/);
    // The QR dependency is imported in exactly one place now.
    expect(PROFILE_CODE).not.toMatch(/from "qrcode\.react"/);
    expect(SHARE_CODE).toMatch(/from "qrcode\.react"/);
  });

  it("the QR and the Share button carry the SAME invite link", () => {
    // A QR that resolved to something other than what Share copies would be two
    // meanings for "share my number".
    expect(SHARE_CODE).toMatch(/export function inviteUrlFor\(/);
    expect((SHARE_CODE.match(/inviteUrlFor\(/g) ?? []).length).toBeGreaterThanOrEqual(3);
    /* …and nothing hand-rolls the `/i/` path beside it. Asserted as CONTAINMENT, not as
       a count: `inviteUrlFor` legitimately builds it TWICE — once against
       `window.location.origin` and once as an SSR-safe relative fallback — so a count of
       1 was simply wrong about the code and failed on a correct file. */
    const fnStart = SHARE_CODE.indexOf("export function inviteUrlFor(");
    const fnEnd = SHARE_CODE.indexOf("\n}", fnStart);
    expect(fnStart).toBeGreaterThanOrEqual(0);
    const inside = SHARE_CODE.slice(fnStart, fnEnd);
    const all = [...SHARE_CODE.matchAll(/\/i\/\$\{/g)];
    expect(all.length).toBeGreaterThan(0);
    for (const m of all) {
      expect(m.index, "an /i/ path is built outside inviteUrlFor").toBeGreaterThanOrEqual(fnStart);
      expect(m.index, "an /i/ path is built outside inviteUrlFor").toBeLessThan(fnStart + inside.length);
    }
  });

  it("the card renders NOTHING without a real 6-digit number", () => {
    // A guest mid-mint has none, and a card headed MY NUMBER over an em-dash asserts
    // something false about the account.
    expect(SHARE_CODE).toMatch(/if \(!number \|\| number\.length !== 6\) return null;/);
  });

  it("the card owns the sheet it opens", () => {
    // One mounted element gets the whole behaviour; two call sites managing their own
    // `open` state is how one ends up with a QR button that does nothing.
    const at = SHARE_CODE.indexOf("export function MyNumberCard(");
    const body = SHARE_CODE.slice(at);
    expect(body).toMatch(/const \[qrOpen, setQrOpen\] = useState\(false\)/);
    expect(body).toMatch(/<ShareNumberSheet open=\{qrOpen\} onOpenChange=\{setQrOpen\} number=\{number\} \/>/);
  });

  it("it uses the phase-1 glass and accent utilities, not bespoke surfaces", () => {
    // The whole point of this release: the tokens stop being dead code.
    expect(SHARE_CODE).toMatch(/rglass/);
    expect(SHARE_CODE).toMatch(/rchip-accent/);
  });

  it("the number is bidi-isolated, so an RTL page cannot reorder it", () => {
    const at = SHARE_CODE.indexOf("export function MyNumberCard(");
    const body = SHARE_CODE.slice(at);
    expect(body).toMatch(/dir="ltr"/);
    expect(body).toMatch(/\[unicode-bidi:isolate\]/);
  });

  it("is mounted on the Dialer", () => {
    expect(DIALER_CODE).toMatch(/import \{ MyNumberCard \} from "@\/app\/ShareNumber"/);
    expect(DIALER_CODE).toMatch(/<MyNumberCard number=\{me\?\.number\}/);
    // shrink-0, because the card is a no-scroll flex column: an auto-height row here is
    // the first thing squeezed on a short phone (how v2.99.36's save-pill got clipped).
    expect(DIALER_CODE).toMatch(/<MyNumberCard number=\{me\?\.number\} className="rmynum-dialer shrink-0"/);
  });
});

describe("the keypad is the board's circular glass pad", () => {
  it("every key is a circle in a SQUARE cell", () => {
    // MEASURED FIRST DRAFT WAS WRONG: `gridAutoRows` sized rows independently of the
    // column width, so keys came out 99x80 — oval by 18px. `aspect-square` on the key
    // makes the cell square by construction at any width, which is what the board's
    // "aspect 1" requires; the row height then follows.
    expect(DIALER_CODE).toMatch(/rounded-full aspect-square/);
    expect(DIALER_CODE).not.toMatch(/gridAutoRows/);
    // the erase key is the 12th cell and must match its eleven siblings
    expect((DIALER_CODE.match(/rounded-full aspect-square/g) ?? []).length).toBe(2);
    expect(DIALER_CODE).not.toMatch(/rounded-\[22px\]/);
  });

  it("the pad is capped by the board's 310px AND by the viewport height", () => {
    // The height term is what stops the new MY NUMBER row pushing the card into a
    // scroll; the 190px floor is what stops the keys shrinking below a tappable size
    // (the alternative measured at 38px).
    expect(DIALER_CODE).toMatch(
      /maxWidth: "min\(100%, 310px, max\(190px, calc\(\(100dvh - 422px\) \* 0\.75\)\)\)"/,
    );
  });

  it("the letters are back under the digits, and are aria-hidden", () => {
    // Board 1a asks for them; they were dropped citing the OLD prototype, and `KEYS` has
    // carried `sub` unused ever since. Decoration on a numeric-only field, so a screen
    // reader announcing "two A B C" for a digit key would be noise.
    expect(DIALER_CODE).toMatch(/\{k\.sub\.trim\(\) && \(/);
    expect(DIALER_CODE).toMatch(/rkey-sub/);
    const at = DIALER_CODE.indexOf("rkey-sub");
    expect(DIALER_CODE.slice(at - 300, at)).toMatch(/aria-hidden="true"/);
  });

  it(".rkey tints on the CYCLING accent and never animates a shadow", () => {
    const r = rule(".relay-v2 .rkey:hover");
    expect(r).toMatch(/background: rgba\(var\(--rb-rgb\), 0\.12\)/);
    // the press is a transform (`active:scale`), never a box-shadow, which would repaint
    // the whole key every frame — the v2.99.84 rule.
    expect(DIALER_CODE).toMatch(/active:scale-\[0\.94\]/);
    const base = rule(".relay-v2 .rkey {");
    expect(base).not.toMatch(/transition/);
  });

  it("light theme keeps its measured neutral key surface", () => {
    // The accent is built for a near-black card: the tint washes out and the hairline
    // vanishes on a light one.
    const r = rule(".relay-v2:not(.dark) .rkey {");
    expect(r).toMatch(/background: var\(--secondary\)/);
  });
});

describe("the action row is the board's hierarchy", () => {
  it("Call is the accent primary and the other two are glass secondaries", () => {
    // Board 1a: "Video 50px / Call 66px solid accent / Group 50px".
    expect(DIALER_CODE).toMatch(/rcta rounded-full grid place-items-center/);
    expect((DIALER_CODE.match(/rkey rounded-full grid place-items-center/g) ?? []).length).toBe(2);
    // the primary is bigger than the secondaries at every clamp bound
    expect(DIALER_CODE).toMatch(/width: "clamp\(58px, 15vw, 66px\)"/);
    expect((DIALER_CODE.match(/width: "clamp\(46px, 12\.5vw, 50px\)"/g) ?? []).length).toBe(2);
  });

  it("NOTHING was removed — all three actions survive", () => {
    // A redesign that quietly drops a control is a feature regression wearing a restyle.
    expect(DIALER_CODE).toMatch(/aria-label=\{previewIsLine \? "Join the party line" : "Voice call"\}/);
    expect(DIALER_CODE).toMatch(/aria-label="Video call"/);
    expect(DIALER_CODE).toMatch(/aria-label="Group call"/);
  });

  it("the app's own hue language survives on the secondary GLYPHS", () => {
    // The owner established sky-for-video and violet-for-group (v2.77/v2.99.90). The
    // accent takes the primary; the convention keeps the glyphs.
    expect(DIALER_CODE).toMatch(/color: "#7dd3fc"/);
    expect(DIALER_CODE).toMatch(/color: "#c4b5fd"/);
  });

  it("the on-accent text comes from .rcta, not a hardcoded white", () => {
    // White fails on the palette's yellow and lime entries; `.rcta` carries the board's
    // `#04211a`. So the Call button must NOT re-assert text-white.
    const at = DIALER_CODE.indexOf("rcta rounded-full");
    expect(DIALER_CODE.slice(at, at + 200)).not.toMatch(/text-white/);
    expect(rule(".relay-v2 .rcta")).toMatch(/color: #04211a/);
  });
});

describe("short screens: the convenience yields, never the function", () => {
  it("below 700px the decoration goes", () => {
    const q = CSS_CODE.slice(
      CSS_CODE.indexOf("@media (max-height: 700px)"),
      CSS_CODE.indexOf("@media (max-height: 660px)"),
    );
    expect(q.length).toBeGreaterThan(60);
    expect(q).toMatch(/\.rkey-sub \{\s*display: none;/);
    expect(q).toMatch(/\.rmynum \{/);
  });

  it("below 660px the MY NUMBER card is withheld — the keypad is not shrunk", () => {
    // MEASURED: the pre-redesign card fitted all five widths, so a card that scrolls
    // would be a regression this release caused. Shrinking keys instead measured 38px,
    // under the 44px anyone can reliably hit.
    const at = CSS_CODE.indexOf("@media (max-height: 660px)");
    expect(at).toBeGreaterThan(0);
    const q = CSS_CODE.slice(at, at + 240);
    expect(q).toMatch(/\.rmynum-dialer \{\s*display: none;/);
  });

  it("the withholding is scoped to the DIALER's mount", () => {
    // `.rmynum` is the card itself; `.rmynum-dialer` is only where the Dialer mounts it.
    // Hiding by the shared class would take the card out of any future surface too.
    expect(DIALER_CODE).toMatch(/rmynum-dialer/);
    expect(SHARE_CODE).not.toMatch(/rmynum-dialer/);
    expect(SHARE_CODE).toMatch(/"rmynum rglass/);
  });
});
