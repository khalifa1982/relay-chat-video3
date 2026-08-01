/**
 * v2.96.2 — in-app video recorder, contract pins.
 *
 * iOS refuses to let the SYSTEM camera record video while ANY call is active
 * ("Recording video is not available while on a call") — that restriction
 * also covers the <input capture> path, so "send a video" and "video status"
 * were dead ends mid-call (owner screenshot). RELAY now records IN-PAGE
 * (getUserMedia + MediaRecorder), the way WhatsApp does natively:
 *   - lib/videoNote.ts probes the container the browser really supports
 *     (video/mp4 on Safari, webm elsewhere) and records at modest bitrates
 *     so a full clip stays far below the 40 MB upload cap;
 *   - VideoRecordSheet gives live preview → record (timer + auto-stop) →
 *     review with Retake/Use, and ALWAYS releases the camera;
 *   - Messages: the composer's "+" menu offers Record video (v2.99.66); the clip
 *     rides the normal attachment flow (caption + disappearing timer apply);
 *   - Status: a Record tab feeds the same composer pipeline (30s story cap).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { codeOnly } from "./testing/codeOnly";
import { copyOnScreen, keysForEnglish } from "./testing/copyOnScreen";

const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8");

const VIDEO_NOTE = read("client/src/lib/videoNote.ts");
const SHEET = read("client/src/app/VideoRecordSheet.tsx");
const MESSAGES = read("client/src/pages/app/Messages.tsx");
const STATUS = read("client/src/pages/app/Status.tsx");

describe("videoNote lib (v2.96.2)", () => {
  it("probes Safari-first containers and refuses to guess (no '' fallback for video)", () => {
    // video/mp4 FIRST — iPhones are the whole reason this feature exists.
    expect(VIDEO_NOTE).toMatch(/\{ mimeType: "video\/mp4", ext: "mp4" \}/);
    expect(VIDEO_NOTE).toMatch(/video\/webm;codecs="vp9,opus"/);
    expect(VIDEO_NOTE).toMatch(/return null;\s*\n\}/);
    expect(VIDEO_NOTE).not.toMatch(/ext: "bin"/);
  });
  it("records at bounded bitrates so a max-length clip clears the 40MB upload cap", () => {
    expect(VIDEO_NOTE).toMatch(/videoBitsPerSecond: 2_500_000/);
    expect(VIDEO_NOTE).toMatch(/audioBitsPerSecond: 128_000/);
  });
  it("uses a 1s timeslice (Safari flushes progressively) and honors a maxMs cap", () => {
    expect(VIDEO_NOTE).toMatch(/rec\.start\(1000\)/);
    expect(VIDEO_NOTE).toMatch(/opts\?\.maxMs && opts\.maxMs > 0/);
  });
  it("recordFromStream leaves the preview stream alive (the sheet owns release)", () => {
    // Nothing in the recording lifecycle (construction, the mislabel-swap, or
    // finish) may stop the STREAM's tracks — voiceNote does, video must not,
    // or Retake would need a full re-acquire and the preview would die.
    const fn = VIDEO_NOTE.slice(VIDEO_NOTE.indexOf("export function recordFromStream"));
    expect(fn).not.toMatch(/getTracks\(\)\.forEach/);
    expect(VIDEO_NOTE).toMatch(/does NOT stop the stream's tracks/);
  });
});

describe("VideoRecordSheet (v2.96.2)", () => {
  it("releases the camera on every exit: unmount cancel + review + explicit close", () => {
    expect(SHEET).toMatch(/recRef\.current\?\.cancel\(\);\s*\n\s*releaseStream\(\);/);
    expect(SHEET).toMatch(/releaseStream\(\); \/\/ camera LED off while reviewing/);
  });
  it("mirrors only the FRONT-camera live preview (recorded clip stays raw)", () => {
    expect(SHEET).toMatch(/facing === "user" \? \{ transform: "scaleX\(-1\)" \}/);
  });
  it("review offers Retake and Use, and revokes the object URL", () => {
    /* REPOINTED (localisation sweep) — and these two were ALREADY VACUOUS before the
       sweep, which is the more useful half of the finding. `toMatch(/Retake/)` and
       `toMatch(/Use video/)` ran against the RAW file, and this sheet's own header
       comment transcribes board 4j: *"after stop Retake pill … and a SOLID-accent
       'Use video' pill"*. Both pins were therefore passing on PROSE — the buttons
       could have rendered nothing at all and they would have stayed green. That is
       the trap `codeOnly` exists for, hit for the twentieth time in this repo.

       So: comment-stripped source, and asked as the property these always stood for
       — this review screen still offers these two actions — via `copyOnScreen`,
       which is satisfied by the literal OR by a key whose English half is that word.
       Strictly stronger than what it replaces, because reaching the dictionary also
       proves an Arabic half exists (`Entry` requires both). */
    const code = codeOnly(SHEET);
    expect(code, "the strip left nothing to assert against").toContain("phase === \"review\"");
    expect(copyOnScreen(code, "Retake"), "the review screen no longer offers Retake").toBe(true);
    expect(copyOnScreen(code, "Use video"), "the review screen no longer offers Use video").toBe(
      true
    );
    expect(SHEET).toMatch(/URL\.revokeObjectURL\(reviewUrl\)/);
  });
  it("explains the mid-video-call camera conflict honestly", () => {
    /* REPOINTED (localisation sweep). This notice is held in state as a KEY rather
       than as a sentence — so that a language change while the sheet is open does not
       leave a stale string on screen — which means it reaches the screen through
       `setErrKey("…")` and NOT through a `t("…")` call. `copyOnScreen` looks for the
       translator call specifically (deliberately: a bare mention would match an import
       or a comment), so it cannot see this one. The property is identical and is
       asserted directly: the sentence exists in the dictionary, and this sheet
       references the key that carries it. */
    const line = "turn the call's camera off first";
    const keys = keysForEnglish(line);
    expect(keys, `"${line}" is not in the dictionary at all — the copy is gone`).not.toEqual([]);
    expect(
      keys.some((k) => codeOnly(SHEET).includes(`"${k}"`)),
      `the dictionary carries "${line}" (${keys.join("/")}) but the sheet does not reach it`
    ).toBe(true);
  });
});

describe("Messages wiring (v2.96.2)", () => {
  it("the recorder is reachable from the composer's attach menu", () => {
    // v2.99.66 restructured the composer: the image button and the paperclip
    // merged into one "+" that always opens this menu (owner asked for the extra
    // input width), so the old "recorder? menu : straight to library" branch is
    // gone. What must stay true is that a supported recorder is OFFERED there —
    // and that it is gated on support, since an unsupported browser showing a
    // dead "Record video" row is the regression this test exists to catch.
    expect(MESSAGES).toMatch(/onClick=\{\(\) => setAttachMenuOpen\(\(v\) => !v\)\}/);
    const menu = MESSAGES.slice(
      MESSAGES.indexOf("{attachMenuOpen && ("),
      MESSAGES.indexOf("{expire !== null && (")
    );
    expect(menu).toMatch(/videoRecorderSupported\(\) && \(/);
    expect(menu).toMatch(/setVideoRecOpen\(true\)/);
    expect(menu).toMatch(/Record video/);
    expect(menu).toMatch(/Photo &amp; video/);
    expect(menu).toMatch(/Attach file/);
  });
  it("a recorded clip rides the NORMAL attachment flow (caption + expire timer apply)", () => {
    expect(MESSAGES).toMatch(/maxMs=\{60_000\}/);
    expect(MESSAGES).toMatch(/uploadFile\(new File\(\[r\.blob\], `video-note\.\$\{r\.ext\}`, \{ type: r\.mimeType \}\)\)/);
  });
});

describe("Status wiring (v2.96.2)", () => {
  it("offers a Record tab (gated on support) with the 30s story cap", () => {
    expect(STATUS).toMatch(/videoRecorderSupported\(\) && \(/);
    expect(STATUS).toMatch(/maxMs=\{30_000\}/);
    expect(STATUS).toMatch(/pickFile\(new File\(\[r\.blob\], `status-video\.\$\{r\.ext\}`, \{ type: r\.mimeType \}\)\)/);
  });
});
