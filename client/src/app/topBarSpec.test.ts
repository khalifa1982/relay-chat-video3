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

/**
 * Exactly ONE `@keyframes` block, found by matching braces (v2.99.94).
 *
 * A fixed-length or open-ended slice from the block's start silently reads into the
 * NEXT keyframe — which is how a percentage assertion here first saw a value from a
 * completely different animation. Returns "" when the block is absent, so a caller
 * that forgets to check gets an empty string rather than the rest of the file.
 */
function kfBody(name: string): string {
  const at = CSS.indexOf(`@keyframes ${name} {`);
  if (at < 0) return "";
  let depth = 0;
  for (let i = CSS.indexOf("{", at); i < CSS.length; i++) {
    if (CSS[i] === "{") depth++;
    else if (CSS[i] === "}" && --depth === 0) return CSS.slice(at, i + 1);
  }
  return "";
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
    // Clipped, so the band is invisible until it crosses the mark. v2.99.94 moved the
    // clip onto the band's OWN layer: the word now swells to 1.07, and a shared
    // `overflow-hidden` parent would have clipped the swell along with the band.
    expect(TOPBAR).toMatch(/pointer-events-none absolute inset-0 overflow-hidden/);
    // The sheen must never intercept a pointer event, wherever the class sits.
    const sheenLayer = TOPBAR.slice(
      TOPBAR.lastIndexOf("pointer-events-none absolute inset-0 overflow-hidden")
    );
    expect(sheenLayer.slice(0, 400)).toMatch(/relay-sheen/);
  });

  it("fires the wordmark flourish every 30 seconds, and rests in between", () => {
    // v2.99.94 (owner): "for the word rely make kind of nice animated animation for
    // that word. it keep animated every 30 seconds." REWRITTEN from the v2.99.86 pin,
    // which asserted the 5.5s cadence and the 38% hold — i.e. it pinned exactly the
    // timing the owner has since replaced. Keeping BOTH cadences would have buried
    // the slower event under the faster one.
    //
    // Asserted as the PROPERTY rather than as one hold percentage: a 30s cycle whose
    // motion is confined to a small opening fraction. That is what gives an event
    // every half minute with no JS timer to arm or leak.
    for (const [cls, kf] of [
      ["relay-sheen", "relaySheen"],
      ["relay-word-pop", "relayWordPop"],
    ]) {
      const m = CSS.match(new RegExp(`\\.${cls} \\{\\s*animation: ${kf} ([\\d.]+)s`));
      expect(m, `${cls} declares a duration`).toBeTruthy();
      expect(Number(m![1]), `${cls} runs on the owner's 30s cadence`).toBe(30);
      // BRACE-MATCHED to this keyframe's own block. My first cut sliced from the
      // block's start to the end of the file, so it read percentages out of every
      // LATER keyframe too and saw relayHueB's 94% — the fixed/unbounded-slice
      // fragility this repo keeps having to rewrite out of its pins.
      const body = kfBody(kf);
      expect(body, `${kf} exists`).not.toBe("");
      const hold = body.match(/\n\s+([\d.]+)%[,\s]/g);
      expect(hold, `${kf} has percentage keyframes`).toBeTruthy();
      const pcts = hold!.map((h) => Number(h.trim().replace(/[%,]/g, "")));
      // Motion stops here and the rest of the 30s is still.
      expect(Math.max(...pcts.filter((p) => p < 100))).toBeLessThanOrEqual(10);
    }
  });

  it("keeps the brand dot on the narrowest phones and drops only the wordmark", () => {
    // The bar must never lose its brand anchor, but the wordmark is what the middle
    // zone needs the width back from.
    //
    // REWRITTEN in v2.99.94: this used to pin TWO `<BrandMark>` call sites in the
    // shell, one per breakpoint. That froze an implementation the component has since
    // absorbed — and two mounts now means two subscriptions to the connection store
    // and the same breakpoint restated in two places. The property is what matters:
    // exactly one mount, the wordmark carrying the breakpoint, and the dot never
    // carrying it.
    expect(SHELL.match(/<BrandMark\b/g)?.length).toBe(1);
    expect(SHELL).not.toMatch(/<BrandMark compact/);
    const brand = TOPBAR.slice(
      TOPBAR.indexOf("export function BrandMark"),
      TOPBAR.indexOf("export function IdentityStrip")
    );
    expect(brand.length).toBeGreaterThan(200);
    // The wordmark hides below 390px. Matched as the rendered word rather than as
    // `RELAY</span>`, which the multiline JSX does not contain at all.
    expect(brand).toMatch(/>\s*RELAY\s*</);
    expect(brand).toMatch(/relative max-\[389px\]:hidden/);
    // …and the hiding class appears exactly once, so it cannot also be on the dot.
    expect(brand.match(/max-\[389px\]:hidden/g)?.length).toBe(1);
    const dot = brand.slice(brand.indexOf("relay-heartbeat"));
    expect(dot.slice(0, 200)).not.toMatch(/max-\[389px\]:hidden/);
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

  it("is INERT — it navigates nowhere, and the old right-hand identity is gone", () => {
    expect(SHELL).toMatch(/<IdentityStrip/);
    // REWRITTEN in v2.99.94. This pin used to assert the strip was "one tap to
    // Profile", which is precisely what the owner has now asked to remove: "no need
    // to take him to the profile only … there is two places to be clicked either the
    // profile on the right or the notification center". So the assertion inverts:
    // the middle of the bar must carry no navigation and no interactive element at
    // all — no href, no onClick, and nothing focusable to trip over by keyboard.
    const decl = TOPBAR.slice(TOPBAR.indexOf("export function IdentityStrip"));
    const strip = codeOnly(decl.slice(decl.indexOf("  return (")));
    expect(strip.length).toBeGreaterThan(100);
    expect(strip).not.toMatch(/<Link/);
    expect(strip).not.toMatch(/href=/);
    expect(strip).not.toMatch(/onClick=/);
    expect(strip).not.toMatch(/<button/);
    expect(strip).not.toMatch(/tabIndex/);
    // And nothing anywhere in the bar's own module still routes to the profile page.
    expect(codeOnly(TOPBAR)).not.toMatch(/\/app\/profile/);
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
    // v2.101.0 renamed the ephemeral post to STORY throughout the user-facing copy.
    expect(TOPBAR).toMatch(/title="You have an active story"/);
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
    // v2.101.0 — the owner's own wording for this menu ("open story / add story /
    // add status / profile / log out"), and the two words now mean two things. Add
    // is no longer the else-branch of Open, so both can be asserted unconditionally.
    expect(SHELL).toMatch(/Open my story/);
    expect(SHELL).toMatch(/Add a story/);
    expect(SHELL).toMatch(/Set my status/);
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
    //
    // v2.99.90 rewrote this to the PROPERTY. It used to pin the exact body
    // `{ playDtmf(d); return; }` — i.e. the specific consolation the guard gave a
    // non-digit key — and `*` has now been removed from the pad entirely, so there
    // is no non-digit key left to play a tone for. What matters is that the guard
    // still refuses, whatever it does on the way out.
    const tap = DIALER.slice(DIALER.indexOf("function tap(d: string)"));
    const body = tap.slice(0, tap.indexOf("\n  }") + 4);
    expect(body.length).toBeGreaterThan(100);
    expect(body).toMatch(/if \(!\/\^\[0-9\]\$\/\.test\(d\)\)[^\n]*return/);
    // The refusal must come BEFORE anything appends, or the guard is decorative.
    expect(body.indexOf("test(d)")).toBeLessThan(body.indexOf("setDialed"));
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
