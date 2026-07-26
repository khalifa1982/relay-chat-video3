/* ============================================================
   v2.99.72 — voice-note playback, recording controls, and per-message dates.

   Three owner reports off one screenshot of a thread:

     1. "When you click to play, the sound is played, but the control doesn't show
        that it's moving, which second you reach. It only stays there like it's not
        played."
     2. "When you record the voice, [it] doesn't show that you are talking. Like, it
        just turned red, and there is no wave when you talk… and then you need to click
        on the red to send, or there's no choice to delete the voice, or you can pause
        the voice, or you cancel the voice and you want to re-record again."
     3. "There is no time and date for each message when it's sent."

   All three were real, and #1 in particular had a specific cause rather than being
   general sloppiness — see the player's own comment. #3 is subtler than it sounds: the
   TIME was already shown; the DATE was not, and the screenshot shows three bubbles
   reading "12:09 PM" sitting ABOVE a "Today" divider, i.e. from an earlier day with
   nothing saying so.
   ============================================================ */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const here = path.resolve(__dirname);
const MSG = fs.readFileSync(path.join(here, "Messages.tsx"), "utf8");
const VOICE = fs.readFileSync(
  path.resolve(here, "..", "..", "lib", "voiceNote.ts"),
  "utf8"
);

const player = MSG.slice(MSG.indexOf("function VoiceNotePlayer("), MSG.indexOf("function RecordingBar("));

describe("1 — the play control actually moves", () => {
  it("the duration probe can NEVER run while playing — the bug itself", () => {
    // The old code seeked to Number.MAX_SAFE_INTEGER from `loadedmetadata`, which
    // fires just after the click that started playback: the element jumped to the end,
    // fired `ended`, and reset the clock to 0. Audio you had heard start, with a
    // control frozen at zero.
    expect(player).toMatch(/if \(probingRef\.current \|\| !a\.paused\) return;/);
    expect(player).toMatch(/if \(a\.paused\) probeDuration\(a\);/);
    expect(player).not.toMatch(/currentTime = Number\.MAX_SAFE_INTEGER/);
  });

  it("uses the 1e101 seek form, matching readMediaDurationMs", () => {
    expect(player).toMatch(/a\.currentTime = 1e101;/);
  });

  it("the probe restores the playhead and never leaks its position to the UI", () => {
    expect(player).toMatch(/const at = a\.currentTime;/);
    expect(player).toMatch(/a\.currentTime = Number\.isFinite\(at\) \? at : 0;/);
    expect(player).toMatch(/if \(!probingRef\.current\) setCur\(a\.currentTime \|\| 0\);/);
    expect(player).toMatch(/probingRef\.current = false;/);
  });

  it("seeds the total from the stored duration, so the common case needs no probe", () => {
    // Every voice note this app records already stores its real length, and
    // messages.list already hands the whole attachment row to the client — it was
    // simply never read, which is why the bubble showed "· · ·".
    expect(player).toMatch(/durationMs\?: number \| null;/);
    expect(player).toMatch(/typeof durationMs === "number" && durationMs > 0 \? durationMs \/ 1000 : 0/);
    expect(MSG).toMatch(/<VoiceNotePlayer url=\{url\} mine=\{mine\} durationMs=\{durationMs\} \/>/);
    expect(MSG).toMatch(/durationMs=\{m\.attachment\.durationMs \?\? null\}/);
  });

  it("drives the clock with rAF while playing, not just timeupdate", () => {
    // `timeupdate` fires ~4Hz, which on a three-second note reads as a control that
    // barely moves — the other half of the report.
    // TWO occurrences, deliberately: the kick-off in the effect AND the self-re-arm
    // inside tick(). A single match was satisfied by the re-arm alone, so deleting the
    // kick-off — which stops the clock dead — left this test green.
    expect((player.match(/rafRef\.current = requestAnimationFrame\(tick\);/g) || []).length).toBe(2);
    expect(player).toMatch(/const tick = \(\) => \{/);
    expect(player).toMatch(/\}, \[playing\]\);/);
    // …and it must be cancelled, both on pause and on unmount.
    expect((player.match(/cancelAnimationFrame\(rafRef\.current\)/g) || []).length).toBeGreaterThanOrEqual(3);
  });
});

describe("2 — recording shows you are talking, and is not a one-way trip to Send", () => {
  it("the recorder exposes a REAL input level, from the recorded stream", () => {
    // A decorative animation would look identical while telling you nothing, which is
    // precisely the complaint — so the meter is tapped off the same MediaStream the
    // recorder is encoding.
    expect(VOICE).toMatch(/level: \(\) => number;/);
    expect(VOICE).toMatch(/ac\.createMediaStreamSource\(stream\)/);
    expect(VOICE).toMatch(/analyser\.getByteTimeDomainData\(levelBuf\)/);
    // RMS, not peak: a peak meter pins to the top on any transient and stops
    // conveying speech at all.
    expect(VOICE).toMatch(/Math\.sqrt\(sum \/ levelBuf\.length\)/);
  });

  it("never routes the microphone to the speakers", () => {
    // Connecting the analyser chain to ac.destination is a feedback loop.
    expect(VOICE).not.toMatch(/connect\(ac\.destination\)/);
    expect(VOICE).toMatch(/Deliberately NOT connected to ac\.destination/);
  });

  it("a missing analyser degrades to 0 instead of failing the recording", () => {
    expect(VOICE).toMatch(/if \(!analyser \|\| !levelBuf\) return 0;/);
    expect(VOICE).toMatch(/catch \{\s*\n\s*ac = null;/);
  });

  it("pause and resume exist, and paused time is EXCLUDED from the duration", () => {
    // Otherwise a note paused for a minute claims to be a minute longer than its
    // audio, and every player shows a bogus total.
    expect(VOICE).toMatch(/pause: \(\) => void;/);
    expect(VOICE).toMatch(/resume: \(\) => void;/);
    expect(VOICE).toMatch(/accumulatedMs \+= Date\.now\(\) - runStartedAt;/);
    expect(VOICE).toMatch(/durationMs: accumulatedMs,/);
    expect(VOICE).not.toMatch(/durationMs: Date\.now\(\) - startedAt/);
  });

  it("releases the WebAudio context on every exit path", () => {
    expect(VOICE).toMatch(/const releaseAudio = \(\) =>/);
    // Exactly the reachable paths: `onstop` (which every stop/cancel/cap funnels
    // through) and the rec.start() throw-guard. NOT the MediaRecorder *construction*
    // guard — the analyser is built after the recorder, so at that point there is
    // nothing to release. Asserting a third call here was over-specifying, and the
    // count is pinned so a future reorder that DOES create the context earlier has to
    // come back and think about it.
    expect((VOICE.match(/releaseAudio\(\);/g) || []).length).toBe(2);
    const onstop = VOICE.slice(VOICE.indexOf("rec.onstop = () => {"), VOICE.indexOf("resolve({"));
    expect(onstop).toMatch(/releaseAudio\(\);/);
    const startGuard = VOICE.slice(VOICE.indexOf("    rec.start();"), VOICE.indexOf("if (opts?.maxMs"));
    expect(startGuard).toMatch(/releaseAudio\(\);/);
    // The analyser really is set up after the recorder, which is why two is enough.
    expect(VOICE.indexOf("ac = new Ctor();")).toBeGreaterThan(VOICE.indexOf("rec = pick.mimeType"));
  });

  it("the composer becomes a full recording bar, replacing the lone red Stop", () => {
    expect(MSG).toMatch(/\{recording \? \(/);
    expect(MSG).toMatch(/<RecordingBar/);
    // The old UI's only exit was a Stop that also sent.
    expect(MSG).not.toMatch(/<StopCircle/);
  });

  it("offers discard, pause/resume and send — three exits, not one", () => {
    const bar = MSG.slice(MSG.indexOf("function RecordingBar("), MSG.indexOf("/** Styled generic-attachment card"));
    expect(bar).toMatch(/aria-label="Discard recording"/);
    expect(bar).toMatch(/aria-label=\{paused \? "Resume recording" : "Pause recording"\}/);
    expect(bar).toMatch(/aria-label="Send voice note"/);
    expect(MSG).toMatch(/onCancel=\{discardRecording\}/);
    expect(MSG).toMatch(/onSend=\{stopRecording\}/);
  });

  it("discarding really discards — it does not send and unsend", () => {
    expect(MSG).toMatch(/function discardRecording\(\) \{[\s\S]{0,400}?recordingRef\.current\?\.cancel\(\);/);
    // cancel() resolves `done` with null, and the upload is inside the non-null branch.
    expect(VOICE).toMatch(/if \(cancelled \|\| chunks\.length === 0\) \{\s*\n\s*resolve\(null\);/);
    expect(MSG).toMatch(/if \(!result\) return; \/\/ cancelled \/ empty/);
  });

  it("reads the paused state BACK rather than assuming the pause took", () => {
    // An engine without MediaRecorder.pause leaves the recorder running, and the UI
    // must not claim otherwise.
    expect(MSG).toMatch(/setRecPaused\(rec\.state\(\) === "paused"\);/);
  });

  it("the wave is written imperatively, not through React state", () => {
    const bar = MSG.slice(MSG.indexOf("function RecordingBar("), MSG.indexOf("/** Styled generic-attachment card"));
    // A state update per frame would re-render the whole thread 60 times a second —
    // the mistake the landing page had to be rescued from in v2.99.67.
    expect(bar).toMatch(/el\.style\.transform = `scaleY\(/);
    expect(bar).toMatch(/clockRef\.current\.textContent = fmtClock\(/);
    expect(bar).not.toMatch(/setState|useState/);
    // …and sampled at ~20Hz rather than every frame, for the same battery reason.
    expect(bar).toMatch(/if \(t - last < 50\) return;/);
    expect(bar).toMatch(/return \(\) => cancelAnimationFrame\(raf\);/);
  });

  it("the newest sample is on the right, so the wave scrolls the way people read", () => {
    const bar = MSG.slice(MSG.indexOf("function RecordingBar("), MSG.indexOf("/** Styled generic-attachment card"));
    expect(bar).toMatch(/hist\[hist\.length - BARS \+ i\]/);
  });

  it("the paused state is visibly different, and reset between takes", () => {
    const bar = MSG.slice(MSG.indexOf("function RecordingBar("), MSG.indexOf("/** Styled generic-attachment card"));
    expect(bar).toMatch(/paused \? "bg-muted-foreground" : "bg-destructive motion-safe:animate-pulse"/);
    expect(MSG).toMatch(/setRecPaused\(false\);/);
  });
});

describe("3 — every message says WHEN it was sent", () => {
  const fn = MSG.slice(MSG.indexOf("function formatTime("), MSG.indexOf("function formatTime(") + 900);

  it("today stays time-only; anything older names the day", () => {
    // Repeating today's date on every bubble is noise; omitting it on an older one is
    // the actual bug — the screenshot shows "12:09 PM" bubbles above a Today divider.
    expect(fn).toMatch(/if \(sameDay\) return time;/);
    expect(fn).toMatch(/month: "short", day: "numeric"/);
    // …and the non-today branch must actually RETURN the date. Asserting only the
    // formatters left `return time;` passing, which is the bug being fixed.
    expect(fn).toMatch(/return `\$\{day\}\$\{year\} · \$\{time\}`;/);
  });

  it("names the YEAR when it differs, rather than silently reading as this year", () => {
    // Same rule as formatLastSeen (v2.99.66): being twelve months wrong without saying
    // so is worse than one extra token.
    expect(fn).toMatch(/d\.getFullYear\(\) === now\.getFullYear\(\) \? "" : ` \$\{d\.getFullYear\(\)\}`/);
  });

  it("compares the whole date, not just the day-of-month", () => {
    // A bare getDate() check makes "the 26th of last month" look like today.
    expect(fn).toMatch(/d\.getDate\(\) === now\.getDate\(\)/);
    expect(fn).toMatch(/d\.getMonth\(\) === now\.getMonth\(\)/);
    expect(fn).toMatch(/d\.getFullYear\(\) === now\.getFullYear\(\)/);
  });
});
