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
 *   - Messages: the image button becomes a Record/Library chooser; the clip
 *     rides the normal attachment flow (caption + disappearing timer apply);
 *   - Status: a Record tab feeds the same composer pipeline (30s story cap).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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
    expect(SHEET).toMatch(/Retake/);
    expect(SHEET).toMatch(/Use video/);
    expect(SHEET).toMatch(/URL\.revokeObjectURL\(reviewUrl\)/);
  });
  it("explains the mid-video-call camera conflict honestly", () => {
    expect(SHEET).toMatch(/turn the call's camera off first/);
  });
});

describe("Messages wiring (v2.96.2)", () => {
  it("the image button opens a Record/Library chooser when the recorder is supported", () => {
    expect(MESSAGES).toMatch(/if \(videoRecorderSupported\(\)\) setAttachMenuOpen\(\(v\) => !v\);\s*\n\s*else imageRef\.current\?\.click\(\);/);
    expect(MESSAGES).toMatch(/Record video/);
    expect(MESSAGES).toMatch(/Photo & video library/);
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
