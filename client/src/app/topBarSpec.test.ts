/* ============================================================
   v2.99.86 — the top bar to the owner's three-zone spec, and an erase key you
   can actually see.

   Owner, with three screenshots:
     "This delete, I couldn't make it little large and red colour, flashy glossy
      to delete the numbers in case you want to delete it."
     "on the top bar on the left, there is the green icon, green blue of rely, and
      rely make it flashy, glossy, glossy. and it's, like, animated slowly. Uh,
      nice animation, but don't make it so much. And on the middle, put the flag
      first, little small size, not the normal size, make it little small. Then the
      first name and then the badge and then the PIN number, three numbers dash
      three number, put it in green color. and then it will show you on the right …
      this ring bill where for notification center. Green, if there is nothing… no
      notification. Red and blinking, if there is a notification, and then there's
      the profile where I told you you need to put circle of two colors."
     "make a green silk kill on the profile image … flashy between green and white
      to keep flashy but feed and feed out"

   THE LAYOUT AND THE ANIMATION PHASE WERE MEASURED in headless Chromium against
   the real built stylesheet — a source pin cannot tell you whether a PIN clips at
   320px, and it certainly cannot tell you whether two cross-fading rings are in
   phase. Both measurements are recorded in the release notes.
   ============================================================ */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { formatPin, firstNameOf } from "./TopBar";

const ROOT = path.resolve(__dirname, "..", "..", "..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const TOPBAR = read("client/src/app/TopBar.tsx");
const SHELL = read("client/src/app/AppShell.tsx");
const BELL = read("client/src/app/MissedCalls.tsx");
const CSS = read("client/src/index.css");
const DIALER = read("client/src/pages/app/Dialer.tsx");

function codeOnly(src: string): string {
  return src
    .split("\n")
    .filter((l) => {
      const t = l.trim();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");
}

describe("the PIN format the owner asked for", () => {
  it("is three digits, a dash, three digits", () => {
    expect(formatPin("777777")).toBe("777-777");
    expect(formatPin("601586")).toBe("601-586");
  });

  it("never mangles a value that is not a 6-digit number", () => {
    // A party line, a partial value mid-render, or a missing identity must pass
    // through rather than becoming a differently-wrong string.
    for (const v of ["", "1", "12345", "1234567", null, undefined]) {
      expect(formatPin(v as string)).toBe(v ?? "");
    }
  });
});

describe("first name only", () => {
  it("takes the first word", () => {
    expect(firstNameOf("Khalifa Alhammadi")).toBe("Khalifa");
    expect(firstNameOf("Mohamed Idris")).toBe("Mohamed");
  });

  it("survives a single name, extra spaces and an empty value", () => {
    expect(firstNameOf("Sara")).toBe("Sara");
    expect(firstNameOf("  Ali   Hassan ")).toBe("Ali");
    expect(firstNameOf("")).toBe("");
    expect(firstNameOf(null)).toBe("");
  });
});

describe("LEFT — the glossy RELAY mark", () => {
  it("sheens by TRANSLATING a band, never by animating background-position", () => {
    // background-position repaints the element every frame; transform does not.
    expect(CSS).toMatch(/@keyframes relaySheen\{?[\s\S]{0,240}?transform: translateX/);
    expect(codeOnly(CSS)).not.toMatch(/@keyframes relaySheen[\s\S]{0,300}?background-position/);
    expect(TOPBAR).toMatch(/relay-sheen/);
    // Clipped, so the band is invisible until it crosses the mark.
    expect(TOPBAR).toMatch(/overflow-hidden/);
    // It must never eat the tap on the brand link.
    expect(TOPBAR).toMatch(/className="absolute inset-y-0 -left-6 w-6 pointer-events-none relay-sheen"/);
  });

  it("is slow and mostly idle — 'don't make it so much'", () => {
    const m = CSS.match(/\.relay-sheen \{\s*animation: relaySheen ([\d.]+)s/);
    expect(m, "the sheen declares a duration").toBeTruthy();
    expect(Number(m![1])).toBeGreaterThanOrEqual(4);
    // The band finishes its sweep at 38% and then waits, so most of the cycle is
    // still. A band that swept continuously would be "so much".
    expect(CSS).toMatch(/@keyframes relaySheen\{?[\s\S]{0,240}?38%,/);
  });

  it("keeps the brand dot on the narrowest phones and drops only the wordmark", () => {
    // The bar must never lose its brand anchor, but the wordmark is what the middle
    // zone needs the width back from.
    expect(SHELL).toMatch(/max-\[389px\]:hidden">\s*<BrandMark \/>/);
    expect(SHELL).toMatch(/min-\[390px\]:hidden">\s*<BrandMark compact \/>/);
  });
});

describe("MIDDLE — flag · first name · badge over the PIN", () => {
  it("renders them in the owner's order", () => {
    // Anchored from `return (` with UNAMBIGUOUS needles. `{formatPin(number)}` alone
    // also matches inside the aria-label's `${formatPin(number)}`, which put the PIN
    // at position 440 and made this test read the order backwards — my bug, not the
    // component's.
    const decl = TOPBAR.slice(TOPBAR.indexOf("export function IdentityStrip"));
    const strip = decl.slice(decl.indexOf("  return ("));
    const flag = strip.indexOf("<CountryFlag");
    const name = strip.indexOf("{first}");
    const badge = strip.indexOf("<RoleBadge");
    const pin = strip.indexOf(">\n        {formatPin(number)}");
    expect(flag).toBeGreaterThan(0);
    expect(flag).toBeLessThan(name);
    expect(name).toBeLessThan(badge);
    expect(badge).toBeLessThan(pin);
  });

  it("the flag is SMALLER than the app's normal size, and its box is RESERVED", () => {
    // "little small size, not the normal size, make it little small."
    expect(TOPBAR).toMatch(/className="text-\[11px\] leading-none"/);
    // geoSelf returns a null country for a LAN, VPN or GeoIP miss and CountryFlag
    // then renders NOTHING — so without a reserved box the identity block shifts
    // sideways the moment geo resolves, moving where the name truncates mid-session.
    expect(TOPBAR).toMatch(/grid place-items-center w-\[15px\]/);
  });

  it("the PIN is green, from a token rather than a literal", () => {
    expect(TOPBAR).toMatch(/text-\[color:var\(--relay-green-text\)\]/);
    // MEASURED: the presence-LED green is 4.46:1 on the light card — it FAILS AA
    // for text this size — so green text has its own token, darker in light theme.
    expect(CSS).toMatch(/--relay-green-text: oklch\(0\.48 0\.18 145\)/);
    expect(CSS).toMatch(/--relay-green-text: oklch\(0\.76 0\.16 145\)/);
    // The LED green is deliberately untouched: a 12px dot is not text.
    expect(CSS).toMatch(/--relay-online: oklch\(0\.55 0\.18 145\)/);
  });

  it("the digits are bidi-isolated so an Arabic name cannot reorder them", () => {
    expect(TOPBAR).toMatch(/dir="ltr"/);
    expect(TOPBAR).toMatch(/\[unicode-bidi:isolate\]/);
  });

  it("the NAME is the only shrinker — everything else is atomic", () => {
    const strip = TOPBAR.slice(TOPBAR.indexOf("export function IdentityStrip"));
    expect(strip).toMatch(/min-w-0 truncate text-\[13px\]/);
    // The flag and the badge must not shrink, or they distort/clip instead.
    expect(strip).toMatch(/shrink-0 grid place-items-center/);
    expect(strip).toMatch(/<span className="shrink-0 leading-none">\s*<RoleBadge/);
  });

  it("is one tap to Profile, and the old right-hand identity is gone", () => {
    expect(SHELL).toMatch(/<IdentityStrip/);
    // The flag and mono number used to sit on the RIGHT; leaving them there would
    // render the owner's identity twice.
    const code = codeOnly(SHELL);
    expect(code).not.toMatch(/font-mono text-xs text-muted-foreground shrink-0 max-\[359px\]:hidden/);
  });
});

describe("RIGHT — the bell states", () => {
  it("green when clear, red when something is waiting, amber for DND", () => {
    expect(BELL).toMatch(/text-\[color:var\(--relay-green-text\)\]/);
    expect(BELL).toMatch(/bg-destructive\/15 text-destructive/);
    expect(BELL).toMatch(/var\(--relay-dnd\)/);
    // DND must NOT be green — it used to be, and green now means "all clear". One
    // colour meaning both "nothing waiting" and "alerts silenced" is an inversion.
    const dndBranch = BELL.slice(BELL.indexOf("dnd\n            ? "), BELL.indexOf(": total > 0"));
    expect(dndBranch).not.toMatch(/relay-online|relay-green-text/);
  });

  it("the CLEAR state is a stroke, not a permanently lit chip", () => {
    // The owner asked for green-when-clear and gets it, but a tinted plate lit 100%
    // of the time spends attention on the one state that needs none.
    expect(BELL).toMatch(/: "text-\[color:var\(--relay-green-text\)\] hover:bg-\[color:var\(--relay-green-text\)\]\/10"/);
  });

  it("its halo no longer animates box-shadow", () => {
    // The bell sits on the top bar's backdrop-blur surface — the most expensive host
    // in the app to repaint over. Converted to the v2.99.84 overlay pattern.
    expect(codeOnly(CSS)).not.toMatch(/@keyframes relayBlinkGlow/);
    expect(codeOnly(CSS)).not.toMatch(/\.relay-blink-glow \{/);
    expect(CSS).toMatch(/\.relay-blink-halo \{\s*animation: relayGlossPulse/);
    expect(BELL).toMatch(/className="absolute inset-0 rounded-xl pointer-events-none relay-blink-halo"/);
    // Only rendered while something is waiting, so a quiet bell runs nothing.
    expect(BELL).toMatch(/\{blink && !dnd && \(/);
  });
});

describe("RIGHT — the avatar's two-colour ring", () => {
  it("cross-fades two stacked rings rather than animating a colour", () => {
    expect(TOPBAR).toMatch(/relay-ring-a/);
    expect(TOPBAR).toMatch(/relay-ring-b/);
    expect(TOPBAR).toMatch(/boxShadow: "0 0 0 2px var\(--relay-online\)"/);
    expect(TOPBAR).toMatch(/boxShadow: "0 0 0 2px rgba\(255,255,255,\.92\)"/);
    // A border-color or conic-gradient animation would repaint every frame.
    const css = codeOnly(CSS);
    expect(css).not.toMatch(/@keyframes relayRingFade[\s\S]{0,200}?border-color/);
    expect(CSS).toMatch(/@keyframes relayRingFade \{[\s\S]{0,160}?opacity/);
  });

  it("anti-phases with a NEGATIVE DELAY, never with `reverse`", () => {
    // `relayRingFade` is symmetric and ease-in-out is point-symmetric, so
    // `animation-direction: reverse` is an EXACT no-op — verified numerically, max
    // |forward - reversed| = 0.000000. With it, both rings peaked together and the
    // later-declared WHITE one covered the green for the whole cycle: a white ring
    // BLINKING, which is the one thing the owner ruled out ("feed and feed out").
    // MEASURED after the fix: a+b stays ~1 across the cycle, max |a-b| = 0.99.
    expect(CSS).toMatch(/\.relay-ring-b \{\s*animation: relayRingFade 2\.6s ease-in-out infinite;\s*animation-delay: -1\.3s;/);
    expect(codeOnly(CSS)).not.toMatch(/relayRingFade[^;]*infinite reverse/);
  });

  it("rests as the GREEN ring under reduced motion, not white", () => {
    // Neither ring animates there, and without an explicit rest state the
    // later-declared white ring sat at full opacity and covered the green — a still
    // frame that looks nothing like the moving one. MEASURED: 1.00/0.00 held.
    expect(TOPBAR).toMatch(/rgba\(255,255,255,\.92\)", opacity: 0 \}/);
  });

  it("keeps the halo inside the bar", () => {
    // MEASURED at 320px with a back arrow: the ring's rect stays within the header.
    // A wider outset bled past the inline padding and was sliced at the edge.
    expect(TOPBAR).toMatch(/absolute inset-\[-2px\] rounded-full pointer-events-none relay-ring-a/);
  });

  it("is NOT a button — it lives inside the dropdown trigger", () => {
    // A button inside a button is invalid HTML (v2.99.39), and MEASURED: zero
    // `button button, a button, button a` in the rendered bar.
    const av = TOPBAR.slice(TOPBAR.indexOf("export function AvatarRing"));
    expect(av).not.toMatch(/<button/);
    expect(av).toMatch(/<span className="relative block size-9 shrink-0">/);
  });

  it("puts the STORY signal on a pip, not on the ring", () => {
    // The ring means "this is you". Overloading it with story state would change an
    // identity signal whenever you post a photo, and would contradict PeerAvatar,
    // where a ring means somebody ELSE'S unseen story.
    expect(TOPBAR).toMatch(/\{hasStatus && \(/);
    expect(TOPBAR).toMatch(/title="You have an active status"/);
  });

  it("the presence LED goes amber on DND so the green ring cannot mislead", () => {
    expect(TOPBAR).toMatch(/background: dnd \? "var\(--relay-dnd\)" : "var\(--relay-online\)"/);
  });
});

describe("the avatar tap: one tap, a real choice, no double-tap", () => {
  it("offers status and profile, and never binds a dblclick", () => {
    // "even if there is a status, when you click it, it will tell you to see the
    // status or go to the profile." A dblclick would put a ~300ms delay on every tap
    // of the most-tapped chrome in the app, collides with iOS Safari's zoom gesture,
    // has no keyboard equivalent, and would assign the HIDDEN gesture to the COMMON
    // case — most people have no status most of the time.
    // A BINDING, not the word. `codeOnly` strips `//` lines but not a JSX
    // `{/* … */}` block, so the bare word matched the comment that explains why
    // there is no double-tap — the same "matched my own prose" trap this repo has
    // now hit five times. Only a real handler can satisfy these.
    expect(SHELL).not.toMatch(/onDoubleClick\s*=/);
    expect(SHELL).not.toMatch(/addEventListener\(\s*["']dblclick["']/);
    expect(SHELL).toMatch(/See my status/);
    expect(SHELL).toMatch(/Add a status/);
    expect(SHELL).toMatch(/<UserRound className="size-4" \/> Profile/);
  });

  it("opens the viewer IMPERATIVELY, because there is no status route", () => {
    // `navigate("/app/status")` would be a silent no-op — statuses live as a strip
    // atop Messages and the viewer is opened through the global overlay host. No
    // source pin could have caught that; the route list had to be read.
    expect(SHELL).toMatch(/onClick=\{\(\) => openPeerStatus\(me\.number\)\}/);
    expect(codeOnly(SHELL)).not.toMatch(/navigate\("\/app\/status"\)/);
  });

  it("still carries the guest's only mobile route to registration", () => {
    // v2.95.10 put Register here because a separate pill overflowed the bar. Losing
    // it would strand every guest on a phone.
    expect(SHELL).toMatch(/Register — keep this number/);
    expect(SHELL).toMatch(/<LogOut className="size-4" \/> Sign out/);
  });
});

describe("the dialer erase key", () => {
  it("is large, red and glossy", () => {
    expect(DIALER).toMatch(/background: "linear-gradient\(160deg,#f87171,#dc2626 55%,#991b1b\)"/);
    expect(DIALER).toMatch(/aria-label="Erase last digit"/);
    // The glyph scales with the key rather than sitting at a fixed 18px.
    expect(DIALER).toMatch(/width: "clamp\(22px,6\.5vw,28px\)"/);
  });

  it("lives IN the keypad, where it cannot collide", () => {
    // MEASURED, and this is why it moved: the old floating button already overlapped
    // the Group Call button by 9px at 320px BEFORE this release, and growing it to
    // the size the owner asked for took that to 17px. In the pad it measures 92x72
    // at 320px with no overlap of any key or call button.
    expect(codeOnly(DIALER)).not.toMatch(/absolute right-0 top-0 size-12/);
    expect(codeOnly(DIALER)).not.toMatch(/absolute right-0 top-1\.5 size-10/);
    expect(DIALER).toMatch(/relay-key relative rounded-\[22px\] overflow-hidden/);
    // `#` gave up its cell — on a 6-digit numeric pad it was pure decoration, the
    // same trade v2.99.36 made on the landing pad.
    expect(codeOnly(DIALER)).not.toMatch(/\{ d: "#", sub: "" \}/);
  });

  it("is dimmed and inert with nothing to erase, never hidden", () => {
    // A key that appears and disappears makes the grid jump under the thumb.
    expect(DIALER).toMatch(/disabled=\{dialed\.length === 0\}/);
    expect(DIALER).toMatch(/disabled:opacity-30/);
  });

  it("its halo animates opacity only, and only while there is something to erase", () => {
    expect(DIALER).toMatch(/pointer-events-none relay-gloss-pulse/);
    expect(DIALER).toMatch(/\{dialed\.length > 0 && \(/);
    expect(CSS).toMatch(/@keyframes relayGlossPulse \{[\s\S]{0,140}?opacity/);
  });

  it("the pad can no longer take a non-digit into the number field", () => {
    // The length guard used to apply ONLY to digits, so `*` (and the old `#`)
    // appended without limit and pushed junk into a field that can only hold a
    // 6-digit RELAY number.
    expect(DIALER).toMatch(/if \(!\/\^\[0-9\]\$\/\.test\(d\)\) \{ playDtmf\(d\); return; \}/);
  });
});

describe("every new animation obeys the repo's motion rules", () => {
  it("all four primitives animate ONLY transform or opacity", () => {
    for (const name of ["relayGlossPulse", "relaySheen", "relayRingFade"]) {
      const at = CSS.indexOf("@keyframes " + name);
      expect(at, name + " exists").toBeGreaterThan(0);
      const block = CSS.slice(at, CSS.indexOf("}\n  }", at) + 5);
      const props = [...block.matchAll(/^\s{4,}([a-z-]+):/gm)].map((m) => m[1]);
      expect(props.length).toBeGreaterThan(0);
      for (const prop of props) {
        expect(["transform", "opacity"], `${name} animates ${prop}`).toContain(prop);
      }
    }
  });

  it("no keyframe anywhere animates a repainting property", () => {
    // A standing guard, not a one-off: this is the class v2.99.84 removed 14 of, and
    // relayBlinkGlow proved it can come back unnoticed because no test forbade it.
    const gated = CSS.slice(CSS.indexOf("@media (prefers-reduced-motion: no-preference)"));
    for (const bad of ["box-shadow", "height", "width", "background-position", "border-color", "filter"]) {
      expect(gated, `a keyframe animates ${bad}`).not.toMatch(
        new RegExp("@keyframes[\\s\\S]{0,400}?\\n\\s{4,}" + bad + ":")
      );
    }
  });

  it("they all sit inside the reduced-motion gate", () => {
    const gateAt = CSS.indexOf("@media (prefers-reduced-motion: no-preference)");
    expect(gateAt).toBeGreaterThan(0);
    for (const cls of [".relay-gloss-pulse", ".relay-sheen", ".relay-ring-a", ".relay-ring-b", ".relay-blink-halo"]) {
      expect(CSS.indexOf(cls), cls + " is declared inside the gate").toBeGreaterThan(gateAt);
    }
  });
});
