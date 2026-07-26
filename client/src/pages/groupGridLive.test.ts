/* ============================================================
   v2.99.69 — the landing group-call grid reads as a live call.

   The owner has now asked twice for the 10-up to look like people actually
   talking: "I told you before to edit it to make it animated like people is talk…
   their lips is moving."

   WHAT IS HONESTLY POSSIBLE, AND WHAT IS NOT. Lips cannot move on a still image.
   The ten tiles are stock PHOTOGRAPHS of people on video calls — laptop and monitor
   bezels in frame, faces at wildly different scales and positions — so there is no
   normalised mouth region to animate: a hardcoded mouth overlay would land on a
   houseplant in one tile and a keyboard in another. Real lip movement needs real
   footage, which is an asset decision, not a code one.

   So this release makes the grid read as a live conference by every OTHER means,
   and the load-bearing insight is that the thing which betrayed the photos was not
   the absence of lip motion — it was that nothing correlated. Four tiles carried
   hardcoded speaking times on a DIFFERENT stagger from the ring sweep, so the ring
   lit one face while another face's bars bounced. One shared schedule fixes that.

   Verified in headless Chromium against the real built bundle, not asserted:
     - the speaker rotates through UNMUTED tiles only, ring and meter together
       (KARIM 0.95/1, then NORA, then ADAM)
     - 5x2 on desktop, 2x5 on a 390px phone, no horizontal overflow
     - repainting animations in the grid: 4 -> 0 (the box-shadow ones are gone)
   ============================================================ */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { speakingTurns } from "./Home";

const HOME = fs.readFileSync(
  path.resolve(__dirname, "Home.tsx"),
  "utf8"
);

describe("one shared speaking schedule", () => {
  it("a muted tile never takes a turn", () => {
    // The first cut used the raw tile index, and the screenshot showed the bug at
    // once: the ring lit ZAIN and DANA, who wear mute badges. A mute badge on the
    // person the highlight says is speaking is worse than no highlight at all.
    const turns = speakingTurns([
      { muted: false },
      { muted: true },
      { muted: false },
      { muted: true },
      { muted: false },
    ]);
    expect(turns).toEqual([0, null, 1, null, 2]);
  });

  it("turns are consecutive from zero, so the loop has no dead gap", () => {
    const tiles = Array.from({ length: 10 }, (_, i) => ({ muted: i === 6 || i === 7 }));
    const turns = speakingTurns(tiles);
    const live = turns.filter((t): t is number => t !== null);
    expect(live).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(turns[6]).toBeNull();
    expect(turns[7]).toBeNull();
  });

  it("handles the degenerate all-muted case without dividing by zero", () => {
    expect(speakingTurns([{ muted: true }, { muted: true }])).toEqual([null, null]);
    // The call site floors the speaker count at 1 for exactly this reason.
    expect(HOME).toMatch(/const speakers = turns\.filter\(t => t !== null\)\.length \|\| 1;/);
  });

  it("the slot length divides the shared loop by the number of speakers", () => {
    expect(HOME).toMatch(/const slot = 20 \/ speakers;/);
    expect(HOME).toMatch(/const delay = `\$\{-\(turn \?\? 0\) \* slot\}s`;/);
  });

  it("the ring, the meter, the nod and the chip dot all use that ONE delay", () => {
    const fn = HOME.slice(HOME.indexOf("function groupTiles()"), HOME.indexOf("/** 0%–100% odometer"));
    // Every schedule-driven animation reads `${delay}` — nothing carries its own
    // hardcoded timing any more, which is what made the old grid incoherent.
    // lpTalk is built without the `animation:` prefix because a muted tile gets
    // the empty string instead (see the muted-tile test below).
    expect(fn).toMatch(/`lpTalk 20s \$\{delay\} infinite`/);
    expect(fn).toMatch(/animation:lpActive 20s \$\{delay\} infinite/);
    expect(fn).toMatch(/voxMeter\(delay\)/);
    expect(fn).toMatch(/animation:lpVoxOn 20s \$\{delay\} infinite/);
    // The retired per-tile fields must not come back.
    expect(fn).not.toMatch(/g\.spk/);
    expect(fn).not.toMatch(/g\.eq/);
  });

  it("the retired hardcoded speaking keyframes are gone, not merely unused", () => {
    expect(HOME).not.toMatch(/@keyframes lpSpkA2/);
    expect(HOME).not.toMatch(/@keyframes lpSpkO2/);
    // …while the 2-up hero mock's own lpSpkA/lpSpkO are untouched.
    expect(HOME).toMatch(/@keyframes lpSpkA\{/);
    expect(HOME).toMatch(/@keyframes lpSpkO\{/);
  });
});

describe("a muted tile is never highlighted", () => {
  it("gets no ring and no nod, but keeps its live feed", () => {
    const fn = HOME.slice(HOME.indexOf("function groupTiles()"), HOME.indexOf("/** 0%–100% odometer"));
    expect(fn).toMatch(/const containerAnim = turn === null \? "" : `lpTalk 20s \$\{delay\} infinite`;/);
    expect(fn).toMatch(/const ring =\s*\n\s*turn === null\s*\n\s*\? ""/);
    // The jitter and Ken-Burns are unconditional — a muted person is still on video.
    expect(fn).toMatch(/const feed = `<span style="position:absolute;inset:0;display:block;animation:lpLive/);
    // …and the empty animation must not emit a bare `animation:` declaration.
    expect(fn).toMatch(/\$\{containerAnim \? `;animation:\$\{containerAnim\}` : ""\}/);
  });

  it("gets a mute badge instead of a level meter", () => {
    const fn = HOME.slice(HOME.indexOf("function groupTiles()"), HOME.indexOf("/** 0%–100% odometer"));
    expect(fn).toMatch(/\$\{g\.muted \? MUTE_SVG : voxMeter\(delay\)\}/);
    expect(fn).toMatch(/const dot = g\.muted\s*\n\s*\? ""/);
  });
});

describe("what makes a still photograph read as a live feed", () => {
  it("every tile gets sub-pixel jitter — the single biggest tell", () => {
    // A real video tile is never perfectly still. Photos have no drift at all,
    // which is why the grid read as "fixed images" however much the chrome moved.
    expect(HOME).toMatch(/@keyframes lpLive\{/);
    const fn = HOME.slice(HOME.indexOf("function groupTiles()"), HOME.indexOf("/** 0%–100% odometer"));
    expect(fn).toMatch(/animation:lpLive \$\{g\.live\} linear infinite/);
  });

  it("the jitter lives on a WRAPPER, because the img already runs Ken-Burns", () => {
    // Two transform animations on ONE element do not compose — the later
    // declaration simply wins, so the jitter would have silently replaced the
    // Ken-Burns (or vice versa).
    const fn = HOME.slice(HOME.indexOf("const feed ="), HOME.indexOf("const dot ="));
    expect(fn).toMatch(/animation:lpLive/);
    expect(fn).toMatch(/<img src="\$\{P\[i\]\}"/);
    expect(fn).toMatch(/animation:\$\{g\.kb\}/);
    // The jitter span opens before the img, i.e. it really is the parent.
    expect(fn.indexOf("lpLive")).toBeLessThan(fn.indexOf("<img"));
  });

  it("no two tiles drift in lockstep", () => {
    const gc = HOME.slice(HOME.indexOf("const GC = ["), HOME.indexOf("const MUTE_SVG"));
    const lives = [...gc.matchAll(/live: "([^"]+)"/g)].map(m => m[1]);
    expect(lives).toHaveLength(10);
    expect(new Set(lives).size).toBe(10);
    // Non-integer, non-harmonic durations so the pattern does not visibly re-align.
    for (const l of lives) expect(l).toMatch(/^\d+\.\d+s -\d+\.\d+s$/);
  });

  it("the level bars are voice-shaped, not a smooth sine", () => {
    // A single shared 1.1s sine on every bar reads as a loading spinner. Speech is
    // bursty and the bars have to disagree with one another.
    for (const k of ["lpVox1", "lpVox2", "lpVox3"]) {
      expect(HOME).toMatch(new RegExp(`@keyframes ${k}\\{`));
    }
    const meter = HOME.slice(HOME.indexOf("const voxMeter ="), HOME.indexOf("Speaking turn per tile"));
    const durs = [...meter.matchAll(/lpVox\d (\.\d+)s/g)].map(m => m[1]);
    expect(durs.length).toBe(4);
    expect(new Set(durs).size).toBe(4); // four bars, four different periods
  });

  it("the talking pulse is a nod, not just a zoom", () => {
    // A pure scale reads as a camera zoom; a small vertical offset reads as a person.
    const kf = HOME.slice(HOME.indexOf("@keyframes lpTalk{"), HOME.indexOf("@keyframes lpTalk{") + 260);
    expect(kf).toMatch(/translateY\(-?\.\d+px\)/);
    expect(kf).toMatch(/scale\(1\.0\d+\)/);
  });
});

describe("cost — this page is the one that made a phone hot", () => {
  it("nothing in the grid animates a repainting property", () => {
    // Measured on an emulated 390px phone at 4x CPU throttle: repainting
    // animations went 4 -> 0 (the removed lpSpkA2 box-shadow) while
    // compositor-only ones went 50 -> 84. Repaint is the expensive one; layer
    // count went up and that is the deliberate trade.
    const fn = HOME.slice(HOME.indexOf("function groupTiles()"), HOME.indexOf("/** 0%–100% odometer"));
    // The box-shadow on the ring overlay is STATIC (declared once, then only its
    // opacity animates), so it costs one paint, not one per frame.
    expect(fn).toMatch(/opacity:0;pointer-events:none;animation:lpActive/);
    // No animation in the grid may name a paint-only property.
    for (const prop of ["box-shadow", "background-color", "filter", "width", "height", "top", "left"]) {
      const kfNames = ["lpTalk", "lpActive", "lpLive", "lpVox1", "lpVox2", "lpVox3", "lpVoxOn"];
      for (const k of kfNames) {
        const i = HOME.indexOf(`@keyframes ${k}{`);
        expect(i).toBeGreaterThan(-1);
        const body = HOME.slice(i, HOME.indexOf("}\n", i));
        expect(body).not.toContain(prop);
      }
    }
  });

  it("adds no JavaScript — the whole effect is CSS on the compositor", () => {
    const fn = HOME.slice(HOME.indexOf("function groupTiles()"), HOME.indexOf("/** 0%–100% odometer"));
    expect(fn).not.toMatch(/requestAnimationFrame|setInterval|setTimeout/);
  });

  it("stays inside the global reduced-motion kill switch", () => {
    expect(HOME).toMatch(/prefers-reduced-motion: reduce\)\{[\s\S]{0,80}\.lp-root \*\{animation:none/);
  });
});

describe("ten people no longer render as eight plus two", () => {
  it("the grid is explicitly 5 across, not auto-fit", () => {
    // auto-fit/minmax(130px) resolved to EIGHT columns on the 1138px card, leaving
    // 8 + 2 and a large empty block — which is what the owner's screenshot showed.
    expect(HOME).toMatch(/\.lp-gcgrid\{grid-template-columns:repeat\(5,minmax\(0,1fr\)\)\}/);
    expect(HOME).not.toMatch(/grid-template-columns:repeat\(auto-fit,minmax\(130px,1fr\)\)/);
  });

  it("steps down through 4, 3 and 2 so no breakpoint orphans a single tile", () => {
    for (const [w, n] of [["900px", 4], ["680px", 3], ["470px", 2]]) {
      expect(HOME).toMatch(
        new RegExp(`@media \\(max-width:${w}\\)\\{\\.lp-gcgrid\\{grid-template-columns:repeat\\(${n},minmax\\(0,1fr\\)\\)\\}\\}`)
      );
    }
  });

  it("the GROUP CALL chip gets its own band instead of sitting on a face", () => {
    // Verified by geometry, not by eye: the chip's rect no longer intersects tile 0.
    expect(HOME).toMatch(/class="lp-gcgrid" style="display:grid;gap:8px;padding:42px 12px 64px"/);
  });
});
