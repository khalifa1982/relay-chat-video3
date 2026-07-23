import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Regression tests for the 2026-07-23 reliability pass. relayClient.ts/
 * Messages.tsx have no DOM test harness in this repo (browser DOM tests are
 * not configured — see README "Common Pitfalls"), so — matching the existing
 * precedent for this file (videoConsent.test.ts, multiCallFixes.test.ts,
 * incomingRing.test.ts) — these pin the fixes by reading the source.
 */
const RELAY_CLIENT = fs.readFileSync(
  path.resolve(__dirname, "..", "lib", "relayClient.ts"),
  "utf8",
);
const MESSAGES_TSX = fs.readFileSync(
  path.resolve(__dirname, "..", "pages", "app", "Messages.tsx"),
  "utf8",
);

describe("call-waiting: the promoted ring mirrors onRing's video-button visibility", () => {
  it("waitingRing carries the video flag from the incoming call-waiting message", () => {
    const seg = RELAY_CLIENT.slice(
      RELAY_CLIENT.indexOf("if (waitingRing && waitingRing.from !== m.from"),
      RELAY_CLIENT.indexOf("showCallWaiting(m.fromName"),
    );
    expect(seg).toMatch(/video:\s*!!m\.video/);
  });
  it("the promoted-ring presentation resets acceptVideoWrap (was missing, unlike onRing)", () => {
    const seg = RELAY_CLIENT.slice(
      RELAY_CLIENT.indexOf("if (promotedRing && !destroyed) {"),
      RELAY_CLIENT.indexOf("presentRingProfile(promotedRing.from)"),
    );
    expect(seg).toMatch(/acceptVideoWrap/);
    expect(seg).toMatch(/promotedRing\.video \? "" : "none"/);
  });
});

describe("Messages: scrolling back to the bottom re-fires the read receipt", () => {
  const seg = MESSAGES_TSX.slice(
    MESSAGES_TSX.indexOf('const [showScrollButton, setShowScrollButton] = useState(false);'),
    MESSAGES_TSX.indexOf("function scrollToBottom()"),
  );
  it("the scroll handler marks read when the user catches back up to the bottom", () => {
    // Previously only a NEW message arriving or a visibility change re-fired
    // markRead — catching up by scrolling alone left the thread "unread"
    // forever if neither of those happened again afterward.
    expect(seg).toMatch(/fromBottom <= 150/);
    expect(seg).toMatch(/markReadMutation\.mutate\(\{ conversationId \}\)/);
  });
  it("is debounced so a scroll gesture doesn't fire a mutation per frame", () => {
    expect(seg).toMatch(/setTimeout\(\(\) => \{\s*markReadMutation\.mutate/);
    expect(seg).toMatch(/clearTimeout\(markReadT\)/);
  });
});
