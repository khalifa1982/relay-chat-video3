import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { codeOnly } from "../../../server/testing/codeOnly";
import { copyOnScreen } from "../../../server/testing/copyOnScreen";

/**
 * v2.63 voice/video/UI-UX improvement batch — static guards pinning the
 * fixes from the adversarially-verified audit so they can't silently regress.
 * The engine is a huge imperative closure that isn't booted in tests; these
 * pin the load-bearing lines.
 */
const CLIENT = fs.readFileSync(path.resolve(__dirname, "relayClient.ts"), "utf8");
const ROOT = path.resolve(__dirname, "../../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const APPSHELL = read("client/src/app/AppShell.tsx");
const ENGINE = read("client/src/app/RelayEngine.tsx");
const MISSED = read("client/src/app/MissedCalls.tsx");
const HISTORY = read("client/src/pages/app/History.tsx");
const CONTACTS = read("client/src/pages/app/Contacts.tsx");

describe("voice improvements", () => {
  it("acquires audio with echo cancellation / noise suppression / AGC", () => {
    expect(CLIENT).toMatch(/const AUDIO_CONSTRAINTS: MediaTrackConstraints = \{/);
    expect(CLIENT).toMatch(/echoCancellation: true/);
    expect(CLIENT).toMatch(/noiseSuppression: true/);
    expect(CLIENT).toMatch(/autoGainControl: true/);
  });

  it("plays an audible ringtone on incoming and outgoing calls, and stops on connect/teardown", () => {
    expect(CLIENT).toMatch(/function playRingtone\(kind: "incoming" \| "outgoing"\)/);
    expect(CLIENT).toMatch(/playRingtone\("incoming"\)/);
    expect(CLIENT).toMatch(/playRingtone\("outgoing"\)/);
    expect(CLIENT).toMatch(/function stopRingtone/);
  });

  it("pulses the mic button when the local mic picks up sound", () => {
    expect(CLIENT).toMatch(/function ensureLocalLevelMonitor/);
    expect(CLIENT).toMatch(/classList\.toggle\("voiced", micOn && level > 12\)/);
  });

  it("hardens ICE restart against flapping with a floor between actual attempts", () => {
    expect(CLIENT).toMatch(/lastRestartTime\?: number/);
    expect(CLIENT).toMatch(/Date\.now\(\) - \(peer\.lastRestartTime \|\| 0\) < 5000/);
  });
});

describe("video improvements", () => {
  it("a voice-only call sends no camera at all, rather than sending it disabled", () => {
    /* The SFU form UNPUBLISHED the track (a disabled MediaStreamTrack still occupies
       a publication and every subscriber's bandwidth). v2.106.44 made the stronger
       version true one step earlier and it is what survives: a voice call never
       ACQUIRES a camera, so there is nothing to send or unpublish — and the camera
       is reacquired if the call is later upgraded. */
    expect(CLIENT).toMatch(/async function reacquireCameraForPublish/);
    expect(CLIENT).toMatch(/wantVideo/);
    expect(CLIENT).toMatch(/consentOk \? \(sendStream\.getVideoTracks\(\)\[0\] \|\| null\) : null/);
  });

  it("caps screen-share resolution/framerate separately from the camera", () => {
    expect(CLIENT).toMatch(/function qualityScreenShare/);
    expect(CLIENT).toMatch(/qualityScreenShare\(videoQuality\)/);
  });

  it("times out a stalled filter model load instead of spinning forever", () => {
    const PIPE = fs.readFileSync(path.resolve(__dirname, "mediaPipeline.ts"), "utf8");
    expect(PIPE).toMatch(/MODEL_LOAD_TIMEOUT_MS = 8000/);
    expect(PIPE).toMatch(/timed out loading/);
    // ensureFaceDetector now has the same single-flight guard as ensureSegmenter
    expect(PIPE).toMatch(/if \(this\.faceDetector \|\| this\.mlBootInProgress\) return;/);
  });

  it("upgrades a slow first peer connect to a named placeholder", () => {
    expect(CLIENT).toMatch(/slowT\?: ReturnType<typeof setTimeout> \| null/);
    expect(CLIENT).toMatch(/"Waiting for " \+ \(peer\.name \|\| "them"\) \+ "…"/);
  });
});

describe("UI/UX improvements", () => {
  it("focus-visible rings are applied to raw interactive elements (sidebar, theme toggle, nav)", () => {
    expect(APPSHELL).toMatch(/focus-visible:ring-ring\/50 focus-visible:ring-\[3px\]/);
    expect(APPSHELL).toMatch(/focus-visible:ring-sidebar-ring/);
  });

  it("the Exit-the-call button carries a destructive-themed focus ring (v2.96.3: the duplicate End pill is gone)", () => {
    // The floating "X End" pill was removed on owner request (it doubled the
    // engine's own hang-up); the rejoin overlay's Exit button remains the one
    // destructive React-layer control.
    expect(ENGINE).toMatch(/focus-visible:ring-destructive\/30 dark:focus-visible:ring-destructive\/50/);
  });

  it("the notification bell and its panel rows are keyboard-focusable", () => {
    expect(MISSED).toMatch(/focus-visible:ring-ring\/50 focus-visible:ring-\[3px\]/);
  });

  it("History action buttons meet the 44px touch-target minimum", () => {
    // size-11 = 2.75rem = 44px. The mobile-redesign row action discs (RoundAction)
    // keep the 44px touch target even though the prototype mock drew 34px.
    expect(HISTORY).toMatch(/\bsize-11\b/);
  });

  it("the Contacts search field has a leading search icon", () => {
    // Tolerate trailing utility classes (the redesign added pointer-events-none
    // so the icon never intercepts a tap on the field).
    expect(CONTACTS).toMatch(
      /<Search className="absolute left-3 top-1\/2 -translate-y-1\/2 size-4 text-muted-foreground[^"]*" \/>\s*\n\s*<Input\s*\n\s*placeholder=\{t\("contacts\.search"\)\}/,
    );
  });

  it("the empty Contacts state uses the shared Empty component with a CTA", () => {
    expect(CONTACTS).toMatch(/import \{ Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent \} from "@\/components\/ui\/empty"/);
    /* REWRITTEN TO THE PROPERTY (v2.106.25). This froze the exact two-way expression
       `{search ? "No matches" : "No contacts yet"}`, so it forbade telling a THIRD kind
       of empty apart — a list narrowed by a label chip, which used to claim the whole
       directory was empty. The property is that the shared primitives are used and a
       first-run user is offered the way in, which is what this release keeps; the exact
       copy is not, and `notShowing.test.ts` pins the honesty of each branch. */
    /* On comment-stripped source: the error arm's own comment quotes
       `filtered.length === 0` to explain what used to be reached, so a raw `indexOf`
       lands on the prose and reads the WRONG EmptyTitle — the prose-anchor trap, hit
       here from another file's comment. */
    const code = codeOnly(CONTACTS);
    const title = code.slice(code.indexOf("filtered.length === 0")).match(
      /<EmptyTitle>[\s\S]{0,240}?<\/EmptyTitle>/,
    );
    expect(title).toBeTruthy();
    expect(title![0]).toMatch(/search \?/);
    expect(copyOnScreen(title![0], "No contacts yet")).toBe(true);
    expect(code).toMatch(/<EmptyContent>[\s\S]{0,400}?contacts\.addContact/);
  });
});
