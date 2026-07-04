import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

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
  it("unpublishes camera video on the SFU for a voice-only call instead of sending it disabled", () => {
    expect(CLIENT).toMatch(/async function syncLivekitVideoPublication/);
    expect(CLIENT).toMatch(/if \(camOn && \(videoApproved \|\| callIsGroup\)\) \{\s*\n\s*for \(const t of send\.getVideoTracks\(\)\) await publishSafe\(t, "camera"\);/);
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

  it("the End / Exit-the-call buttons carry destructive-themed focus rings", () => {
    expect(ENGINE).toMatch(/focus-visible:ring-destructive\/20 dark:focus-visible:ring-destructive\/40/);
  });

  it("the notification bell and its panel rows are keyboard-focusable", () => {
    expect(MISSED).toMatch(/focus-visible:ring-ring\/50 focus-visible:ring-\[3px\]/);
  });

  it("History action buttons meet the 44px touch-target minimum", () => {
    expect(HISTORY).toMatch(/className="size-11"/);
  });

  it("the Contacts search field has a leading search icon", () => {
    expect(CONTACTS).toMatch(/<Search className="absolute left-3 top-1\/2 -translate-y-1\/2 size-4 text-muted-foreground" \/>\s*\n\s*<Input\s*\n\s*placeholder="Search by name or number"/);
  });

  it("the empty Contacts state uses the shared Empty component with a CTA", () => {
    expect(CONTACTS).toMatch(/import \{ Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent \} from "@\/components\/ui\/empty"/);
    expect(CONTACTS).toMatch(/<EmptyTitle>\{search \? "No matches" : "No contacts yet"\}<\/EmptyTitle>/);
  });
});
