/* ============================================================
   v2.99.54 — THE VIDEO-CONSENT PROMPT IS CENTRED AND LEGIBLE.

   Owner screenshot (iPhone, mid-call, after enabling the camera): the
   "X wants to start video" card ran off the RIGHT edge of the screen — the
   caller's name was cut to "a Hasan", the primary button to "Turn on vide" —
   while overlapping the Minimize/Fit chrome and the "Connected" status line,
   and reading washed-out over the live video behind it.

   ROOT CAUSE, measured in headless Chromium rather than guessed. The card was
   centred with `left:50%; transform:translateX(-50%)` and entered with
   `animation:relayFade .25s ease both`. relayFade's final keyframe is
   `transform:none`, and fill-mode `both` makes that value PERSIST once the
   animation finishes — so the centring transform was wiped and the card's LEFT
   edge sat at exactly 50% of the viewport. Before/after, same harness:

     390px wide:  left 195 (=50%), right 429  -> 39px off-screen
     375px wide:  left 188 (=50%), right 422  -> 47px off-screen
     320px wide:  left 160 (=50%), right 394  -> 74px off-screen
     1280px wide: left 640 (=50%), right 1270 -> just fits

   That last row is why it shipped: on a desktop the row layout happened to fit
   inside the window, so the bug was invisible to anyone not on a phone. The
   computed transform read `matrix(1, 0, 0, 1, 0, 0)` — the identity matrix,
   i.e. none — which is the direct proof the translate was gone.

   This trap was ALREADY found and fixed once, for `.addpad`, whose comment spells
   it out verbatim. It was never swept across the file, so `.video-ask` was the
   same bug sitting in a second place. Hence the last test here: a guard over the
   whole stylesheet, so the next centred element that reaches for relayFade fails
   the build instead of shipping broken on phones only.
   ============================================================ */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const CSS = fs.readFileSync(path.resolve(__dirname, "relayAssets.ts"), "utf8");

/** The declaration block of a single CSS rule, by exact selector. */
function block(selector: string): string {
  const at = CSS.indexOf(selector + "{");
  if (at < 0) return "";
  return CSS.slice(at + selector.length + 1, CSS.indexOf("}", at));
}

describe("the prompt is centred without relying on transform", () => {
  const base = block(".relay-root .video-ask");

  it("centres with inset + auto margins, not translateX", () => {
    expect(base).toMatch(/position:absolute/);
    expect(base).toMatch(/inset:0/);
    expect(base).toMatch(/margin:auto/);
    // Auto margins only centre an absolutely-positioned box when its size is
    // intrinsic rather than filling the inset box.
    expect(base).toMatch(/width:max-content/);
    expect(base).toMatch(/height:max-content/);
    // The thing that broke it must be gone.
    expect(base).not.toMatch(/transform/);
    expect(base).not.toMatch(/left:50%/);
    expect(base).not.toMatch(/top:\d/);
  });

  it("the entrance animates opacity ONLY, so no keyframe can move it again", () => {
    expect(block(".relay-root .video-ask.show")).toMatch(/animation:vaIn/);
    expect(block(".relay-root .video-ask.show")).not.toMatch(/relayFade/);
    const kf = CSS.slice(CSS.indexOf("@keyframes vaIn{"), CSS.indexOf("@keyframes vaIn{") + 60);
    expect(kf).toMatch(/from\{opacity:0\}to\{opacity:1\}/);
    expect(kf).not.toMatch(/transform/);
  });

  it("can never be wider than the screen", () => {
    expect(base).toMatch(/max-width:min\(92vw,400px\)/);
  });

  it("no leftover mobile rule re-introduces a top offset", () => {
    // The old @media (max-width:680px) block set `top:10px`, which would fight
    // `inset:0` and push the card off-centre on exactly the phones this fixes.
    const phone = block("@media (max-width:380px){.relay-root .video-ask");
    expect(phone).not.toMatch(/top:/);
    expect(CSS).not.toMatch(/@media \(max-width:680px\)\{\.relay-root \.video-ask/);
  });
});

describe("the prompt is legible rather than translucent", () => {
  const base = block(".relay-root .video-ask");

  it("is opaque — no blur layer over the live video behind it", () => {
    expect(base).toMatch(/background:#141824/);
    expect(base).not.toMatch(/backdrop-filter/);
    expect(base).not.toMatch(/rgba\(20,23,29/);
  });

  it("dims what is behind it without capturing taps", () => {
    // A spread box-shadow paints the scrim. box-shadow is not hit-tested, so the
    // call controls underneath stay reachable while the prompt is up — which
    // matters, because one of those controls is hang-up.
    expect(base).toMatch(/box-shadow:0 0 0 100vmax rgba\(4,5,8,\.62\)/);
  });

  it("reads at arm's length: bigger name, higher-contrast subtitle", () => {
    expect(block(".relay-root .va-meta b")).toMatch(/font-size:17px/);
    const sub = block(".relay-root .va-sub");
    expect(sub).toMatch(/font-size:13\.5px/);
    // Was var(--muted) (#8A93A2) — too dim for two lines of small print.
    expect(sub).toMatch(/color:#C3CBD9/);
    expect(sub).not.toMatch(/var\(--muted\)/);
  });

  it("both buttons are full-size touch targets and the primary is unmistakable", () => {
    const btn = block(".relay-root .va-btn");
    expect(btn).toMatch(/flex:1/);
    expect(btn).toMatch(/min-height:46px/);
    // Solid purple with white text, not translucent purple on translucent glass.
    expect(block(".relay-root .va-accept")).toMatch(/background:#6D4AFF/);
    expect(block(".relay-root .va-accept")).toMatch(/color:#fff/);
  });

  it("the name still truncates instead of stretching the card", () => {
    const b = block(".relay-root .va-meta b");
    expect(b).toMatch(/text-overflow:ellipsis/);
    expect(b).toMatch(/max-width:100%/);
  });
});

describe("no centred element may lean on relayFade again (build guard)", () => {
  /* relayFade ends on `transform:none` with fill-mode both. Any rule that
     centres with translateX(-50%) and whose own or `.show` variant applies
     relayFade will silently lose its centring the moment the animation
     finishes — invisible on a wide desktop, broken on every phone. Two sites
     have now hit this. This makes a third impossible to ship. */
  function offenders(css: string): string[] {
    const bad: string[] = [];
    // Each rule: selector { declarations }
    const rules = [...css.matchAll(/(^|\n)([^\n{}@]+)\{([^{}]*)\}/g)].map((m) => ({
      sel: m[2].trim(),
      decl: m[3],
    }));
    const centred = rules.filter((r) => /transform:\s*translateX\(-50%\)/.test(r.decl));
    for (const c of centred) {
      // Does this selector — or a state variant of it — apply relayFade?
      const fades = rules.some(
        (r) =>
          (r.sel === c.sel || r.sel.startsWith(c.sel + ".") || r.sel.startsWith(c.sel + ":")) &&
          /animation:\s*relayFade/.test(r.decl)
      );
      // A rule that restates the transform in its own keyframes is safe (cwIn).
      if (fades) bad.push(c.sel);
    }
    return bad;
  }

  it("finds no offender in the shipped stylesheet", () => {
    expect(offenders(CSS)).toEqual([]);
  });

  it("and the guard actually catches the bug it exists for", () => {
    // Feed it the exact pre-fix shape; if this passes vacuously the test above
    // proves nothing.
    const regressed = `
.relay-root .video-ask{position:absolute;top:14px;left:50%;transform:translateX(-50%);display:none}
.relay-root .video-ask.show{display:flex;animation:relayFade .25s ease both}
`;
    expect(offenders(regressed)).toEqual([".relay-root .video-ask"]);
  });

  it("does not flag the banners that restate the transform in their keyframes", () => {
    // .call-waiting and .held-bar centre the same way but animate with cwIn,
    // whose from AND to both include translateX(-50%) — correct by construction.
    const kf = CSS.slice(CSS.indexOf("@keyframes cwIn{"), CSS.indexOf("@keyframes cwIn{") + 160);
    expect(kf).toMatch(/from\{opacity:0;transform:translateX\(-50%\)/);
    expect(kf).toMatch(/to\{opacity:1;transform:translateX\(-50%\)/);
    expect(offenders(CSS)).not.toContain(".relay-root .call-waiting");
    expect(offenders(CSS)).not.toContain(".relay-root .held-bar");
  });
});
