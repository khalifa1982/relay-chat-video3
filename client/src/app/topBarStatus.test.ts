/**
 * v2.99.94 — the top bar's newest owner batch, and the bottom bar's reclaimed space.
 *
 *   "I circle on the notification center push it left little bit, keep space and gap
 *    between the notification center and the profile and also whoever click on the bar
 *    anywhere in the top bar. no need to take him to the profile only. there is two
 *    places to be clicked either the profile on the right or the notification center
 *    only … colored light blue and there was a word mention Relay make type of
 *    animation that it keep blinking their light from lighter blue to light green to
 *    light different light and flashing similar to the heart way. this is for the dot
 *    on the top left and for the word rely make kind of nice animated animation for
 *    that word. it keep animated every 30 seconds … and below the flashy light put
 *    small line and [mention] online small letter. it means you are online now and
 *    when you are idle it will mention you are idle in yellow color and if you were
 *    disconnected from the internet it will […] show you you are offline red color …
 *    and at the bottom after the bottom bar there's a still gap space so I stick the
 *    bottom down because I need the space for the middle frame"
 *
 * The three-way connection RULE is tested behaviourally, because that is the whole
 * feature — a source pin cannot tell you whether losing the network turns the line
 * red, or whether a fresh page load flickers amber before settling on green.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import {
  CONNECTION_LABEL,
  CONNECTION_TITLE,
  CONNECTION_VAR,
  connectionState,
  type ConnectionState,
} from "./connectionStatus";
import {
  _setRealtimeDegraded,
  isRealtimeDegraded,
  subscribeRealtimeStatus,
} from "./useRealtime";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const TOPBAR = read("./TopBar.tsx");
const SHELL = read("./AppShell.tsx");
const CSS = read("../index.css");
const STATUS = read("./connectionStatus.ts");
const REALTIME = read("./useRealtime.ts");

/**
 * Strip comments so a `not.toMatch` cannot pass on the prose describing the code.
 *
 * The line-based version used elsewhere in this repo strips `//`, `*` and `/*` LINES
 * — and it has now been caught missing JSX `{/* … *​/}` blocks twice, because their
 * continuation lines begin with ordinary words. So the block forms are removed as
 * SPANS first, which is the only way to catch a comment whose middle lines look like
 * prose. (This is the eighth `not.toMatch` in this repo to have matched its own
 * commentary; doing it properly here rather than dodging it again.)
 */
const codeOnly = (s: string) =>
  s
    // FIXED in v2.102.1: the first pass used to be a JSX-span strip,
    // /\{\s*\/\*[\s\S]*?\*\/\s*\}/ — but a DOCUMENTED PROP TYPE has the same
    // shape (`}: { /** … */ value: unknown; … }`), so it swallowed the whole prop
    // block and much of the function body. Every `not.toMatch` here was reading a
    // gutted source and could pass vacuously. Stripping block comments FIRST is
    // both simpler and correct: a JSX comment collapses to a bare `{}`, whose
    // prose is gone, and no code is touched.
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !/^\s*\/\//.test(l))
    .join("\n");

/**
 * Exactly ONE `@keyframes` block, by brace matching — an open-ended or fixed-length
 * slice from a block's start silently reads into the next animation's percentages.
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

describe("the connection rule — online / idle / offline", () => {
  it("names all three states from the two inputs", () => {
    expect(connectionState(true, false)).toBe("online");
    expect(connectionState(true, true)).toBe("idle");
    expect(connectionState(false, false)).toBe("offline");
  });

  it("NO NETWORK outranks a degraded stream", () => {
    // A dropped stream is a SYMPTOM of no network. Reporting the symptom instead of
    // the cause would send somebody looking at the wrong thing entirely.
    expect(connectionState(false, true)).toBe("offline");
  });

  it("the middle state needs POSITIVE evidence, so a fresh load starts green", () => {
    // The flag it keys on starts FALSE. If the rule instead read "the stream is not
    // yet connected", every single app load would paint amber for the few hundred ms
    // before `onopen` and then snap to green — a flicker that reads as a bug.
    expect(isRealtimeDegraded()).toBe(false);
    expect(connectionState(true, isRealtimeDegraded())).toBe("online");
  });

  it("carries a lowercase word AND a colour, never colour alone", () => {
    // "[mention] online small letter" — and a state distinguished only by hue is
    // unreadable to anyone who cannot tell green from amber.
    for (const s of ["online", "idle", "offline"] as ConnectionState[]) {
      expect(CONNECTION_LABEL[s]).toBe(s);
      expect(CONNECTION_LABEL[s]).toBe(CONNECTION_LABEL[s].toLowerCase());
      expect(CONNECTION_VAR[s]).toMatch(/^--relay-/);
      expect(CONNECTION_TITLE[s].length).toBeGreaterThan(10);
    }
  });

  it("maps each state to the owner's colour", () => {
    expect(CONNECTION_VAR.online).toBe("--relay-green-text");
    expect(CONNECTION_VAR.idle).toBe("--relay-amber-text");
    expect(CONNECTION_VAR.offline).toBe("--relay-red-text");
  });

  it("does NOT reuse the DND amber, which fails AA and already means something else", () => {
    // MEASURED: --relay-dnd is 3.72:1 on the light card, so it fails WCAG AA for text
    // this small — and it already means "alerts are silenced", so borrowing it would
    // put one colour on two meanings in one bar (the collision v2.99.86 moved DND off
    // green to avoid).
    expect(Object.values(CONNECTION_VAR)).not.toContain("--relay-dnd");
    expect(codeOnly(STATUS)).not.toMatch(/relay-dnd/);
  });

  it("the two new tokens are defined in BOTH themes", () => {
    // Dark defaults in the shared block, light overrides after — the same shape the
    // green text token uses.
    expect(CSS).toMatch(/--relay-amber-text: oklch\(0\.8 0\.15 80\)/);
    expect(CSS).toMatch(/--relay-red-text: oklch\(0\.68 0\.2 27\)/);
    // Light theme: measured at 5.16:1 and 5.61:1 on the white card.
    expect(CSS).toMatch(/--relay-amber-text: oklch\(0\.54 0\.14 75\)/);
    expect(CSS).toMatch(/--relay-red-text: oklch\(0\.54 0\.2 27\)/);
    // Both must be overridden for light, or one theme silently inherits the other's.
    expect(CSS.match(/--relay-amber-text:/g)?.length).toBe(2);
    expect(CSS.match(/--relay-red-text:/g)?.length).toBe(2);
  });

  it("treats an unknown network as UP — this line never falsely says offline", () => {
    expect(codeOnly(STATUS)).toMatch(
      /typeof navigator === "undefined"\) return true/
    );
  });

  it("requires the STREAM for green, so green is never a lie", () => {
    // navigator.onLine only reports that an interface is up — a captive portal or a
    // dead uplink still reads true. Green additionally requires the realtime stream,
    // which requires the server to be genuinely reachable.
    expect(codeOnly(STATUS)).toMatch(/isRealtimeDegraded\(\)/);
    expect(codeOnly(STATUS)).toMatch(/navigator\.onLine !== false/);
  });
});

describe("the realtime-health flag", () => {
  let seen = 0;
  let un: (() => void) | null = null;
  beforeEach(() => {
    seen = 0;
    _setRealtimeDegraded(false);
    un = subscribeRealtimeStatus(() => {
      seen++;
    });
  });
  afterEach(() => {
    un?.();
    _setRealtimeDegraded(false);
  });

  it("notifies subscribers when the stream fails and when it recovers", () => {
    _setRealtimeDegraded(true);
    expect(isRealtimeDegraded()).toBe(true);
    expect(seen).toBe(1);
    _setRealtimeDegraded(false);
    expect(isRealtimeDegraded()).toBe(false);
    expect(seen).toBe(2);
  });

  it("notifies only on a real TRANSITION", () => {
    // The stream retries with backoff and errors repeatedly while it is down. Firing
    // per failed attempt would re-render the app shell once per retry for a fact that
    // has not changed.
    _setRealtimeDegraded(true);
    _setRealtimeDegraded(true);
    _setRealtimeDegraded(true);
    expect(seen).toBe(1);
  });

  it("unsubscribing really stops the notifications", () => {
    un?.();
    un = null;
    _setRealtimeDegraded(true);
    expect(seen).toBe(0);
  });

  it("a throwing subscriber does not stop the others being told", () => {
    // One bad listener must not be the reason the bar never learns the connection
    // dropped.
    const order: string[] = [];
    const a = subscribeRealtimeStatus(() => {
      order.push("a");
      throw new Error("boom");
    });
    const b = subscribeRealtimeStatus(() => order.push("b"));
    _setRealtimeDegraded(true);
    expect(order).toContain("a");
    expect(order).toContain("b");
    a();
    b();
  });

  it("is a SECOND flag, not a reuse of the poll-demotion one", () => {
    // They answer different questions and must start from different values:
    // sseConnected starts false ("may I slow the polls?"), degraded starts false
    // ("has it actually failed?") — and inferring one from the other is what would
    // reintroduce the load flicker.
    expect(REALTIME).toMatch(/let realtimeDegraded = false;/);
    expect(REALTIME).toMatch(/let sseConnected = false;/);
    expect(codeOnly(STATUS)).not.toMatch(/isSseConnected/);
  });

  it("is set from the SAME two handlers that own sseConnected", () => {
    // One owner of the truth. Two independently-maintained sources for "is the stream
    // up" is the drift this codebase keeps relearning (v2.99.50, v2.99.71).
    const code = codeOnly(REALTIME);
    // onopen: both cleared/​set together.
    expect(code).toMatch(
      /_setSseConnected\(true\);[\s\S]{0,120}?_setRealtimeDegraded\(false\)/
    );
    // onerror: the one place it learns it is not live.
    expect(code).toMatch(
      /_setSseConnected\(false\);[\s\S]{0,300}?_setRealtimeDegraded\(true\)/
    );
    // Exactly one site sets it true — a second would be a second writer.
    expect(code.match(/_setRealtimeDegraded\(true\)/g)?.length).toBe(1);
  });

  it("teardown resets to OPTIMISTIC, not degraded", () => {
    // A deliberate stop is not a failure, and leaving it degraded would have a
    // remount (a sign-in, a StrictMode re-run) start out amber for no reason.
    const code = codeOnly(REALTIME);
    const cleanup = code.slice(code.indexOf("      closed = true;"));
    expect(cleanup.length).toBeGreaterThan(50);
    expect(cleanup.slice(0, 400)).toMatch(/_setRealtimeDegraded\(false\)/);
  });
});

describe("the status line in the bar", () => {
  const brand = TOPBAR.slice(
    TOPBAR.indexOf("export function BrandMark"),
    TOPBAR.indexOf("export function IdentityStrip")
  );

  it("the slice under test is not empty", () => {
    expect(brand.length).toBeGreaterThan(500);
  });

  it("sits BELOW the dot and the wordmark", () => {
    // "below the flashy light put small line". The left zone is a column: brand row
    // first, connection line second.
    expect(brand).toMatch(/flex-col items-start/);
    const dot = brand.indexOf("relay-heartbeat");
    const word = brand.indexOf("RELAY");
    const line = brand.indexOf("CONNECTION_LABEL");
    expect(dot).toBeGreaterThan(0);
    expect(dot).toBeLessThan(word);
    expect(word).toBeLessThan(line);
  });

  it("is small, and announced when it changes", () => {
    expect(brand).toMatch(/text-\[9\.5px\]/);
    expect(brand).toMatch(/role="status"/);
    expect(brand).toMatch(/aria-live="polite"/);
    expect(brand).toMatch(/title=\{CONNECTION_TITLE\[conn\]\}/);
  });

  it("colours itself with an INLINE css variable, never a runtime class name", () => {
    // A class string composed at runtime is absent from the source at build time, so
    // Tailwind's JIT never emits it and the colour comes out unstyled — the trap
    // already documented for the bottom tab bar's accents.
    expect(brand).toMatch(/style=\{\{ color: `var\(\$\{CONNECTION_VAR\[conn\]\}\)` \}\}/);
    expect(brand).not.toMatch(/text-\[color:var\(\$\{/);
  });

  it("reads the live state rather than a prop somebody has to remember to pass", () => {
    expect(brand).toMatch(/useConnectionState\(\)/);
  });
});

describe("the dot — three lights and a heartbeat", () => {
  const brand = TOPBAR.slice(
    TOPBAR.indexOf("export function BrandMark"),
    TOPBAR.indexOf("export function IdentityStrip")
  );

  it("is light blue at rest", () => {
    // "colored light blue" — and this is the STATIC base, so it is also the
    // reduced-motion still frame.
    expect(brand).toMatch(/linear-gradient\(135deg,#7DD3FC,#6EE7FF\)/);
  });

  it("cycles by CROSS-FADING stacked layers, never by animating a colour", () => {
    // An animated background-color repaints every frame, and this element sits on the
    // bar's backdrop-blur surface — the most expensive host in the app to repaint
    // over (v2.99.84 removed 14 of exactly this from the call grid).
    expect(brand).toMatch(/relay-hue-a/);
    expect(brand).toMatch(/relay-hue-b/);
    expect(CSS).toMatch(/@keyframes relayHueA \{[\s\S]{0,200}?opacity/);
    expect(CSS).toMatch(/@keyframes relayHueB \{[\s\S]{0,200}?opacity/);
    for (const kf of ["relayHueA", "relayHueB"]) {
      const body = kfBody(kf);
      expect(body, `${kf} exists`).not.toBe("");
      expect(body).not.toMatch(/background/);
    }
  });

  it("gives each overlay a DIFFERENT light, so it is a cycle and not a flash", () => {
    // "from lighter blue to light green to light different light" — three distinct
    // colours, so the two overlays must not be the same.
    const a = brand.match(/relay-hue-a[\s\S]{0,160}?linear-gradient\(([^)]+)\)/)?.[1];
    const b = brand.match(/relay-hue-b[\s\S]{0,160}?linear-gradient\(([^)]+)\)/)?.[1];
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(a).not.toBe(b);
  });

  it("rests both overlays at opacity 0, so reduced motion shows the blue base", () => {
    // Under reduced motion neither overlay animates. Without an explicit 0 rest the
    // later-declared one would sit fully opaque and cover the base, making the still
    // frame a colour the moving version never settles on — the v2.99.86 ring bug.
    expect(brand.match(/opacity: 0 \}\}/g)?.length).toBe(2);
  });

  it("the hue WINDOWS are disjoint", () => {
    // A is lit across the first part of the cycle and B across the second. Overlapping
    // them would additively blend into a fourth colour nobody asked for.
    const a = kfBody("relayHueA");
    const b = kfBody("relayHueB");
    expect(a).not.toBe("");
    expect(b).not.toBe("");
    expect(a).toMatch(/25% \{\s*opacity: 1;/);
    expect(b).toMatch(/75% \{\s*opacity: 1;/);
    // A has gone dark (44%) before B starts to rise (56%).
    expect(a).toMatch(/44%,/);
    expect(b).toMatch(/56% \{/);
    // And neither reaches full opacity in the other's window.
    expect(a).not.toMatch(/75%/);
    expect(b).not.toMatch(/25%/);
  });

  it("beats TWICE per cycle and then rests — a heartbeat, not breathing", () => {
    // "flashing similar to the heart way". A single sine pulse reads as breathing.
    const body = kfBody("relayHeartbeat");
    expect(body).not.toBe("");
    const peaks = [...body.matchAll(/transform: scale\(1\.(\d+)\)/g)].map((m) => Number(`1.${m[1]}`));
    const distinctPeaks = peaks.filter((p) => p > 1.1);
    expect(distinctPeaks.length).toBeGreaterThanOrEqual(2);
    // The second thump is SMALLER than the first, which is what makes it read as one.
    expect(distinctPeaks[1]).toBeLessThan(distinctPeaks[0]);
    // And it spends most of the cycle at rest.
    expect(body).toMatch(/62%,/);
  });

  it("puts the beat on a WRAPPER and the fades on the layers inside", () => {
    // Two animations on ONE element do not compose — the later declaration simply
    // wins (v2.99.85). The scale must therefore live on a different element from the
    // opacity, or one of the two silently stops happening.
    expect(brand).toMatch(/relative block size-2\.5 shrink-0 relay-heartbeat/);
    const wrapper = brand.slice(brand.indexOf("relay-heartbeat"));
    // The hue classes appear INSIDE the heartbeat wrapper, on their own spans.
    expect(wrapper.slice(0, 900)).toMatch(/relay-hue-a/);
    expect(brand).not.toMatch(/relay-heartbeat[^"]*relay-hue/);
    expect(brand).not.toMatch(/relay-hue-[ab][^"]*relay-heartbeat/);
  });

  it("the glow is a static box-shadow, not an animated one", () => {
    expect(brand).toMatch(/boxShadow: "0 0 10px rgba\(110,231,255,\.85\)"/);
    for (const kf of ["relayHeartbeat", "relayHueA", "relayHueB", "relayWordPop"]) {
      const body = kfBody(kf);
      expect(body, `${kf} exists`).not.toBe("");
      expect(body).not.toMatch(/box-shadow/);
    }
  });

  it("every new animation is inside the reduced-motion gate", () => {
    // The gate opens at the `@media (prefers-reduced-motion: no-preference)` block and
    // the file has exactly one, so "after it starts" is the whole test.
    const gateAt = CSS.indexOf("@media (prefers-reduced-motion: no-preference)");
    expect(gateAt).toBeGreaterThan(0);
    for (const cls of [
      ".relay-heartbeat",
      ".relay-hue-a",
      ".relay-hue-b",
      ".relay-word-pop",
    ]) {
      expect(CSS.indexOf(cls), `${cls} is declared`).toBeGreaterThan(gateAt);
    }
  });
});

describe("only two things in the bar are tappable", () => {
  it("the brand mark navigates nowhere", () => {
    const brand = codeOnly(
      TOPBAR.slice(
        TOPBAR.indexOf("export function BrandMark"),
        TOPBAR.indexOf("export function IdentityStrip")
      )
    );
    expect(brand.length).toBeGreaterThan(400);
    expect(brand).not.toMatch(/<Link/);
    expect(brand).not.toMatch(/href=/);
    expect(brand).not.toMatch(/onClick=/);
  });

  it("wouter's Link is no longer imported at all", () => {
    // The whole module is now display-only, so an unused import would be the only
    // thing left suggesting otherwise.
    expect(codeOnly(TOPBAR)).not.toMatch(/from "wouter"/);
  });

  it("the BACK arrow is deliberately kept", () => {
    // The owner was talking about the identity/brand area being a shortcut, not about
    // navigation controls. Removing Back would strand people on every sub-page.
    expect(SHELL).toMatch(/onClick=\{goBack\}/);
    expect(SHELL).toMatch(/aria-label="Back"/);
  });

  it("the bell and the avatar are both still real controls", () => {
    expect(SHELL).toMatch(/<NotificationBell/);
    expect(SHELL).toMatch(/<DropdownMenuTrigger/);
    // Profile is still reachable — one tap inside the avatar's own menu.
    expect(SHELL).toMatch(/onClick=\{\(\) => navigate\("\/app\/profile"\)\}/);
  });
});

describe("the bell moves left, away from the avatar", () => {
  it("widens the gap between the two right-hand chips", () => {
    // "push it left little bit, keep space and gap between the notification center
    // and the profile". The cluster is pinned to the right edge by the header's
    // justify-between, so widening the internal gap is what moves the BELL — the
    // avatar cannot move without leaving the edge.
    const right = SHELL.slice(SHELL.indexOf("RIGHT — notifications"));
    const cls = right.match(/className="flex items-center gap-([\d.]+) shrink-0"/);
    expect(cls, "the right-hand cluster declares a gap").toBeTruthy();
    // MEASURED at 320-430px: 14px of gap, both chips inside the header, nothing
    // overlapping the middle zone.
    expect(Number(cls![1])).toBeGreaterThan(2);
  });

  it("keeps the bell BEFORE the avatar, visually as well as in the DOM", () => {
    const right = SHELL.slice(SHELL.indexOf("RIGHT — notifications"));
    expect(right.indexOf("<NotificationBell")).toBeLessThan(right.indexOf("<DropdownMenu>"));
    // DOM order alone is not enough, and the mutation run is what showed it: a
    // `flex-row-reverse` on the cluster paints them the other way round while leaving
    // the source order — and therefore the assertion above — completely untouched.
    const cls = right.slice(right.indexOf('<div className="flex items-center'), right.indexOf(">\n") + 1);
    expect(cls).toMatch(/flex items-center/);
    expect(cls).not.toMatch(/row-reverse/);
  });

  it("still renders a bell at all", () => {
    const right = SHELL.slice(SHELL.indexOf("RIGHT — notifications"));
    expect(right.slice(0, 1200)).toMatch(/<NotificationBell\b/);
  });
});

describe("the bottom bar sticks to the bottom", () => {
  it("drops the extra floor under the tab row", () => {
    // "at the bottom after the bottom bar there's a still gap space so I stick the
    // bottom down because I need the space for the middle frame." MEASURED at 390px
    // with no safe-area: the bar went 81px -> 68px, so 13px goes back to the scroll
    // area above it.
    const nav = SHELL.slice(SHELL.indexOf("Docked glass tab bar"));
    expect(nav).toMatch(/paddingBottom: "env\(safe-area-inset-bottom\)"/);
    expect(codeOnly(nav)).not.toMatch(/max\(0\.55rem, env\(safe-area-inset-bottom\)\)/);
  });

  it("KEEPS the safe-area inset, which is not decoration", () => {
    // On an iPhone the home indicator sits exactly there; dropping the inset as well
    // would put it on top of the tab icons.
    const nav = SHELL.slice(SHELL.indexOf("Docked glass tab bar"));
    expect(nav).toMatch(/env\(safe-area-inset-bottom\)/);
  });

  it("tightens the tab row's own padding", () => {
    const nav = SHELL.slice(SHELL.indexOf("Docked glass tab bar"));
    expect(nav).toMatch(/flex flex-col items-center gap-1 pt-1\.5 pb-0\.5/);
    expect(codeOnly(nav)).not.toMatch(/items-center gap-1 pt-2 pb-1/);
  });

  it("stays IN FLOW — it is not a floating overlay", () => {
    // The invariant that makes the reclaimed space real: the scroll container ends at
    // this bar's top edge, so shrinking the bar genuinely grows the content area
    // rather than just moving a fixed element down.
    // Scoped to the element's own className, not to a window of source: the comment
    // above it SAYS "not position:fixed", so a `not.toMatch(/fixed/)` over the
    // surrounding text passed on the very prose explaining the absence.
    const from = SHELL.indexOf("Docked glass tab bar");
    const navTag = codeOnly(SHELL.slice(from, from + 1400));
    const cls = navTag.slice(navTag.indexOf("<nav"), navTag.indexOf("style={{"));
    expect(cls.length).toBeGreaterThan(80);
    expect(cls).toMatch(/shrink-0/);
    expect(cls).not.toMatch(/fixed/);
    expect(cls).not.toMatch(/absolute/);
  });
});
