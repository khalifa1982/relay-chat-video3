/* ============================================================
   v2.99.84 — the conference stops cooking the phone, and the voice survives it.

   Owner: "my phone become verry hot whenever we have conference call multiple
   parties. I think because of the video or because of what? Make sure that the
   length of the sound to be very clear and good latency for both video and
   voice."

   THE TRANSPORT MATTERS AND IT IS THE MESH. LiveKit needs three env vars an
   operator sets, and it appears in this repo only as a commented-out optional in
   the deploy doc — so the fleet runs the WebRTC mesh, where every phone in an
   N-party call runs N-1 INDEPENDENT VIDEO ENCODERS and N-1 decoders. At the
   6-participant cap that is five of each, on a handset. That is the heat.

   AND IT IS ALSO THE AUDIO ANSWER, which is the part worth saying out loud: a
   thermally throttled phone starves its audio encoder too, which is heard as
   choppy, unclear sound. Capping the video is what protects the voice. There is
   no separate "make audio clearer" knob that survives a hot CPU.

   The CSS half of this release was MEASURED in headless Chromium against the real
   stylesheet — a source pin cannot count blur layers or tell a repainting
   animation from a compositor-only one, and that distinction is the whole change.
   ============================================================ */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { RELAY_CSS } from "./relayAssets";

const ROOT = path.resolve(__dirname, "..", "..", "..");
const CLIENT = fs.readFileSync(path.join(ROOT, "client/src/lib/relayClient.ts"), "utf8");

/** Strip comment lines before an "absent" assertion — this repo has burned itself
 *  repeatedly on a not.toMatch that matched the comment explaining the absence. */
function codeOnly(src: string): string {
  return src
    .split("\n")
    .filter((l) => {
      const t = l.trim();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");
}

const CAPS = (() => {
  const start = CLIENT.indexOf("  function applyMeshVideoCaps() {");
  expect(start, "applyMeshVideoCaps exists").toBeGreaterThan(0);
  const end = CLIENT.indexOf("\n  function createPeer(", start);
  expect(end, "the slice has an end").toBeGreaterThan(start);
  const s = CLIENT.slice(start, end);
  expect(s.length, "the slice is not empty").toBeGreaterThan(600);
  return s;
})();

describe("the mesh encoder ladder now caps FRAME RATE, the largest lever left", () => {
  it("scales framerate with the party size", () => {
    // Encode cost is roughly linear in framerate, so five encoders at the
    // camera's native 30 were doing twice the work of five at 15.
    expect(CAPS).toMatch(/const maxFramerate = n <= 1 \? 30 : n <= 3 \? 24 : 15;/);
    expect(CAPS).toMatch(/p\.encodings\[0\]\.maxFramerate = maxFramerate;/);
  });

  it("keeps the pre-existing bitrate and resolution ladder — declared AND applied", () => {
    // The new cap is ADDITIVE. Dropping either of these would trade one kind of
    // heat for another.
    //
    // Both halves are asserted deliberately. The first version of this test pinned
    // only the LADDER DECLARATION, so deleting the line that actually applies
    // maxBitrate left it green — caught by the mutation run, and exactly the
    // "pinned the declaration, not the use" weakness this repo keeps rediscovering.
    expect(CAPS).toMatch(/maxBitrate = n <= 1 \? 1_200_000 : n <= 3 \? 700_000 : 350_000/);
    expect(CAPS).toMatch(/p\.encodings\[0\]\.maxBitrate = maxBitrate;/);
    expect(CAPS).toMatch(/scale = n <= 3 \? 1 : 2/);
    expect(CAPS).toMatch(/p\.encodings\[0\]\.scaleResolutionDownBy = scale;/);
  });

  it("1:1 is unchanged in effect, and the cap is still REVERSIBLE", () => {
    // 30 equals the source rate, so a two-person call is untouched — but it is a
    // real value rather than an absent field, because the party can SHRINK (6 -> 2)
    // and an undefined cap is not reliably cleared by every engine.
    const [, one] = CAPS.match(/const maxFramerate = n <= 1 \? (\d+)/) ?? [];
    expect(one, "1:1 keeps the camera's own rate").toBe("30");
    // Never left implicit.
    expect(codeOnly(CAPS)).not.toMatch(/maxFramerate = undefined|delete .*maxFramerate/);
  });

  it("degradationPreference goes in its OWN setParameters call", () => {
    // It is a TOP-LEVEL field that some engines reject outright, and a rejected
    // setParameters discards the WHOLE object — so folding it in with the caps
    // would silently lose bitrate AND framerate on exactly the browsers that most
    // need them. Two calls, each in its own try.
    expect(CAPS).toMatch(/degradationPreference = "balanced"/);
    const setCalls = (CAPS.match(/void s\.setParameters\(/g) ?? []).length;
    expect(setCalls, "audio, video caps, and degradation are three separate calls").toBe(3);
    // The degradation call must re-READ parameters rather than reuse the object
    // whose write may have failed.
    expect(CAPS).toMatch(/const p2 = s\.getParameters\(\)/);
    // …and it must come AFTER the caps, so a rejection cannot cost them.
    expect(CAPS.indexOf("maxFramerate = maxFramerate"))
      .toBeLessThan(CAPS.indexOf('degradationPreference = "balanced"'));

    // THE ACTUAL PROPERTY, and the first version of this test did not check it:
    // counting the calls says nothing about which OBJECT carries the field. It must
    // never be set on `p` — the object the caps ride on — because that is precisely
    // the shape where one rejected field discards the caps too.
    //
    // ASSIGNMENTS, comment-stripped. Counting the bare identifier matched the
    // comment above and the type annotation as well, so it read 3 and the test was
    // RED — which then made the corresponding mutation report a false "bit", since
    // an already-failing test fails for every mutation. Both mistakes are mine and
    // both are the same lesson: match the thing you mean, in code only.
    const code = codeOnly(CAPS);
    const assigns = (code.match(/degradationPreference\s*=/g) ?? []).length;
    expect(assigns, "assigned in exactly one place").toBe(1);
    // Nothing may touch it before the caps are committed.
    const capsRegion = code.slice(
      code.indexOf('if (s.track.kind !== "video") return;'),
      code.indexOf("const p2 = s.getParameters()")
    );
    expect(capsRegion.length).toBeGreaterThan(100);
    expect(capsRegion).not.toMatch(/degradationPreference/);
  });

  it("balanced, NOT maintain-framerate", () => {
    // The common default keeps frames and sheds nothing else, which is precisely
    // wrong on a thermally throttled phone: we want it free to drop resolution.
    expect(codeOnly(CAPS)).not.toMatch(/maintain-framerate/);
  });
});

describe("audio is protected rather than capped", () => {
  it("is marked high priority so video is shed first", () => {
    expect(CAPS).toMatch(/if \(s\.track\.kind === "audio"\)/);
    expect(CAPS).toMatch(/pa\.encodings\[0\]\.priority = "high"/);
    expect(CAPS).toMatch(/networkPriority = "high"/);
  });

  it("audio is NEVER rate-limited or resolution-scaled", () => {
    // It is a rounding error beside video, and capping it is exactly the wrong
    // move for the owner's "sound very clear" ask.
    const audioBranch = CAPS.slice(
      CAPS.indexOf('if (s.track.kind === "audio")'),
      CAPS.indexOf('if (s.track.kind !== "video")')
    );
    expect(audioBranch.length).toBeGreaterThan(100);
    expect(audioBranch).not.toMatch(/maxBitrate|maxFramerate|scaleResolutionDownBy/);
  });

  it("the audio branch returns, so it can never fall into the video path", () => {
    const audioBranch = CAPS.slice(
      CAPS.indexOf('if (s.track.kind === "audio")'),
      CAPS.indexOf('if (s.track.kind !== "video")')
    );
    expect(audioBranch).toMatch(/\n\s+return;\n\s+\}/);
  });

  it("a missing encodings array is left alone rather than fabricated", () => {
    // For VIDEO an empty encodings array is filled in, because the cap is the
    // point. For audio there is nothing to cap — inventing an encoding just to
    // stamp a priority on it risks disturbing a working track for no gain.
    expect(CAPS).toMatch(/if \(!pa\.encodings \|\| pa\.encodings\.length === 0\) return;/);
  });

  it("the microphone is captured MONO, with ideal rather than exact", () => {
    // A voice call has no spatial information, so stereo doubles the encoder's
    // sample work for nothing. `exact` would throw OverconstrainedError on a
    // device that only offers stereo and cost the person their microphone.
    expect(CLIENT).toMatch(/channelCount: \{ ideal: 1 \}/);
    expect(codeOnly(CLIENT)).not.toMatch(/channelCount: \{ exact:/);
    // The existing quality hints are untouched.
    expect(CLIENT).toMatch(/echoCancellation: true/);
    expect(CLIENT).toMatch(/noiseSuppression: true/);
    expect(CLIENT).toMatch(/autoGainControl: true/);
  });
});

describe("the per-frame paint cost of the grid", () => {
  it("the sound-wave bars animate a TRANSFORM, not height", () => {
    // Five bars per speaking tile animating `height` is a layout+paint animation
    // compositing over live video. scaleY is compositor-only and looks identical.
    expect(RELAY_CSS).toMatch(/@keyframes relayWave\{0%,100%\{transform:scaleY\(\.278\)\}50%\{transform:scaleY\(1\)\}\}/);
    expect(RELAY_CSS).toMatch(/\.sound-wave i\{[^}]*transform-origin:bottom center/);
    // The rest position must match the keyframe, or the bar jumps when the
    // animation is disabled by prefers-reduced-motion.
    expect(RELAY_CSS).toMatch(/\.sound-wave i\{[^}]*transform:scaleY\(\.278\)/);
  });

  it("no keyframe animates height or box-shadow over a tile any more", () => {
    // relaySpeakPulse used to animate the TILE's own box-shadow — a full-tile
    // repaint per frame, over live video, six times over at the cap.
    expect(RELAY_CSS).toMatch(/@keyframes relaySpeakPulse\{0%,100%\{opacity:0\}50%\{opacity:1\}\}/);
    expect(RELAY_CSS).toMatch(/\.spk-glow\{[^}]*box-shadow:inset 0 0 22px 0 rgba\(34,197,94,\.30\)/);
  });

  it("the glow overlay sits BELOW the interactive chips", () => {
    // The chips live at z-index 4-5; an edge glow painted above them tints them
    // green in the corner where they are.
    const m = RELAY_CSS.match(/\.spk-glow\{[^}]*z-index:(\d+)/);
    expect(m, "the overlay declares a z-index").toBeTruthy();
    expect(Number(m![1])).toBeLessThan(4);
    // It must never eat a tap.
    expect(RELAY_CSS).toMatch(/\.spk-glow\{[^}]*pointer-events:none/);
  });

  it("the glow is still driven by .speaking alone — no new JS", () => {
    expect(RELAY_CSS).toMatch(/\.relay-tile\.speaking \.spk-glow\{opacity:1\}/);
    expect(CLIENT).toMatch(/<span class="spk-glow" aria-hidden="true"><\/span>/);
    // Nothing may toggle it imperatively; that would be a second source of truth
    // for a state the CSS already owns.
    expect(codeOnly(CLIENT)).not.toMatch(/spk-glow.*classList|querySelector\(["'.]*\.spk-glow/);
  });

  it("phones drop the per-tile blur; the ctrl-bar keeps its glass", () => {
    // MEASURED at 390 wide, six tiles: blur layers over live video 36 -> 0, and
    // 36 -> 36 on desktop at 1440.
    expect(RELAY_CSS).toMatch(/\.relay-tile \.tile-info span,\n\s+\.relay-root \.relay-tile \.nm,/);
    expect(RELAY_CSS).toMatch(/\.relay-tile \.tile-addc\{backdrop-filter:none;-webkit-backdrop-filter:none;background:rgba\(8,9,12,\.90\)\}\}/);
    // The button classes are the *-btn ones. `.tile-menu` is the overflow PANEL,
    // and naming it here would restyle the wrong element while leaving the
    // buttons blurred — the first version of this rule did exactly that.
    expect(RELAY_CSS).toMatch(/\.relay-tile \.tile-menu-btn,/);
    expect(RELAY_CSS).toMatch(/\.relay-tile \.tile-max-btn,/);
  });

  it("that override is the LAST thing in the stylesheet, which is load-bearing", () => {
    // Equal specificity is decided by ORDER, and four of the six base rules are
    // declared late in the file. Placed anywhere earlier the rule measured as
    // doing NOTHING (36 blur layers before and after) while looking correct.
    const ovr = RELAY_CSS.indexOf(".relay-root .relay-tile .tile-menu-btn,");
    expect(ovr).toBeGreaterThan(0);
    for (const base of [
      ".relay-root .relay-tile .tile-menu-btn{position:absolute",
      ".relay-root .relay-tile .tile-max-btn{position:absolute",
      ".relay-root .relay-tile .tile-addc{position:absolute",
      ".relay-root .relay-tile .connecting{position:absolute",
      ".relay-root .relay-tile .tile-info span{background",
      ".relay-root .relay-tile .nm{position:absolute",
    ]) {
      const at = RELAY_CSS.indexOf(base);
      expect(at, "base rule present: " + base).toBeGreaterThan(0);
      expect(at, "override must come after " + base).toBeLessThan(ovr);
    }
  });

  it("the avatar breath is transform-only on a phone, full colour on desktop", () => {
    // The colour cycle is free on a desktop GPU and worth keeping; on a phone the
    // cycling box-shadow repaints the disc every frame. Only small screens trade it.
    expect(RELAY_CSS).toMatch(/@keyframes relayAvBreathLite\{\n\s+0%\{transform:scale\(1\)\}/);
    expect(RELAY_CSS).toMatch(/animation-name:relayAvBreathLite/);
    // The desktop keyframes keep their shadow — this is a phone override, not a
    // removal.
    expect(RELAY_CSS).toMatch(/@keyframes relayAvBreath\{[\s\S]{0,400}?box-shadow:0 0 0 0 rgba\(244,63,94,\.55\)/);
    // The Lite variant must carry NO shadow, or it is not a fix.
    const lite = RELAY_CSS.slice(RELAY_CSS.indexOf("@keyframes relayAvBreathLite"));
    expect(lite.slice(0, lite.indexOf("}\n") + 200)).not.toMatch(/box-shadow/);
    // Override after the base rule, same specificity.
    expect(RELAY_CSS.indexOf(".relay-tile.speaking .ph .av{animation:relayAvBreath"))
      .toBeLessThan(RELAY_CSS.indexOf("animation-name:relayAvBreathLite"));
  });

  it("every motion change stays inside the reduced-motion gate", () => {
    // A person who asked for no motion must not gain any here.
    const gate = "@media (prefers-reduced-motion: no-preference){";
    const idx = RELAY_CSS.indexOf(gate);
    expect(idx).toBeGreaterThan(0);
    // The pulse is armed only inside such a block.
    expect(RELAY_CSS).toMatch(
      /@media \(prefers-reduced-motion: no-preference\)\{[\s\S]{0,300}?\.speaking \.spk-glow\{animation:relaySpeakPulse/
    );
  });

  it("the stylesheet is still a valid template literal", () => {
    // A backtick inside a CSS COMMENT terminates it and the failure surfaces as
    // syntax errors hundreds of lines away. This has now bitten in v2.99.16,
    // v2.99.82 and again while writing THIS release.
    expect(RELAY_CSS).not.toContain("`");
  });
});
