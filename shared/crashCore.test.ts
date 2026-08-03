/**
 * THE CRASH PIPE'S PURE RULES — grouping, capping, labelling.
 *
 * These functions run on BOTH ends (the client caps before sending, the server
 * caps again before storing; the server fingerprints what the client shaped),
 * so a regression here doesn't produce a visible bug — it produces a crash
 * console that quietly stops grouping, and nobody notices until a real incident
 * arrives as 3,000 ungrouped rows. Three properties carry the whole design:
 *
 *  1. THE GROUP SURVIVES A REBUILD. A deploy moves every line number and every
 *     cache-busting hash; the fingerprint input must not move with them, or
 *     each release restarts every defect's history from zero and the
 *     "per-version review" the console promises becomes per-version amnesia.
 *
 *  2. THE GROUP SURVIVES THE SPECIFICS. Two users hitting one defect carry
 *     different ids, uuids and ports in the message; normalization must fold
 *     them into one bucket while the STORED row keeps the raw text.
 *
 *  3. NOTHING UNBOUNDED GETS THROUGH, AND NOTHING TRUNCATED LOOKS COMPLETE.
 *     The cap marker is load-bearing: a silently-cut stack sends whoever reads
 *     it hunting for a frame that was never recorded.
 */
import { describe, expect, it } from "vitest";
import {
  CRASH_BREADCRUMB_MAX,
  CRASH_CAPS,
  type CrashBreadcrumb,
  capCrashField,
  crashFingerprintInput,
  crashTopFrames,
  detectCrashPlatform,
  normalizeCrashMessage,
  normalizeCrashPlatform,
  pushCrashBreadcrumb,
} from "./crashCore";

describe("crashFingerprintInput — the group key survives what changes between users and builds", () => {
  it("is identical when only line:column numbers and cache busters differ (a rebuild)", () => {
    const a = crashFingerprintInput(
      "TypeError",
      "Cannot read properties of undefined (reading 'peer')",
      "TypeError: Cannot read properties of undefined\n    at joinRoom (https://your-chat.io/assets/index.js?v=abc123:4821:17)\n    at onClick (https://your-chat.io/assets/index.js?v=abc123:9102:5)"
    );
    const b = crashFingerprintInput(
      "TypeError",
      "Cannot read properties of undefined (reading 'peer')",
      "TypeError: Cannot read properties of undefined\n    at joinRoom (https://your-chat.io/assets/index.js?v=zzz999:5555:1)\n    at onClick (https://your-chat.io/assets/index.js?v=zzz999:12:99)"
    );
    expect(a).toBe(b);
  });

  it("is identical when only ids/uuids/numbers in the MESSAGE differ (two users, one defect)", () => {
    const a = crashFingerprintInput("Error", "fetch failed for user 481923 at 10.0.11.197", null);
    const b = crashFingerprintInput("Error", "fetch failed for user 7 at 10.0.44.8", null);
    expect(a).toBe(b);
  });

  it("DIFFERS when the failing frame differs — two defects must not share a bucket", () => {
    const a = crashFingerprintInput("Error", "boom", "Error: boom\n    at sendMessage (app.js:1:1)");
    const b = crashFingerprintInput("Error", "boom", "Error: boom\n    at openCamera (app.js:1:1)");
    expect(a).not.toBe(b);
  });
});

describe("normalizeCrashMessage — specifics fold, shape stays", () => {
  it("replaces uuids, hex runs and bare integers", () => {
    const out = normalizeCrashMessage(
      "row 123 key 0xDEADBEEF session 550e8400-e29b-41d4-a716-446655440000 token a1b2c3d4e5f6"
    );
    expect(out).not.toMatch(/123|DEADBEEF|550e8400|a1b2c3d4e5f6/i);
    expect(out).toContain("<uuid>");
    expect(out).toContain("#");
  });
});

describe("crashTopFrames — both stack dialects, junk stripped", () => {
  it("reads V8 frames and strips line:col + query strings", () => {
    const frames = crashTopFrames(
      "Error: x\n    at fn (https://a/b.js?v=1:10:2)\n    at https://a/c.js:3:4\nnot a frame"
    );
    expect(frames).toHaveLength(2);
    expect(frames[0]).not.toMatch(/:\d+:\d+|\?v=/);
  });

  it("reads Firefox/Safari fn@url frames", () => {
    expect(crashTopFrames("fn@https://a/b.js:1:2\ng@https://a/b.js:3:4")).toHaveLength(2);
  });

  it("answers [] for a missing stack rather than throwing", () => {
    expect(crashTopFrames(null)).toEqual([]);
    expect(crashTopFrames(undefined)).toEqual([]);
  });
});

describe("capCrashField — bounded, and honest about it", () => {
  it("passes short values through untouched", () => {
    expect(capCrashField("hello", 10)).toBe("hello");
  });

  it("truncates over-cap values WITH the explicit marker", () => {
    const out = capCrashField("x".repeat(CRASH_CAPS.stack + 500), CRASH_CAPS.stack);
    expect(out.length).toBeLessThan(CRASH_CAPS.stack + 20);
    expect(out).toContain("…[+500]");
  });

  it("stringifies non-strings instead of throwing — the crash path never throws", () => {
    expect(capCrashField(null, 10)).toBe("");
    expect(capCrashField(42, 10)).toBe("42");
  });
});

describe("pushCrashBreadcrumb — a ring, not a leak", () => {
  it("holds the LAST N crumbs when overfilled", () => {
    const list: CrashBreadcrumb[] = [];
    for (let i = 0; i < CRASH_BREADCRUMB_MAX + 10; i++) {
      pushCrashBreadcrumb(list, { t: i, kind: "nav", msg: "step " + i });
    }
    expect(list).toHaveLength(CRASH_BREADCRUMB_MAX);
    expect(list[0].msg).toBe("step 10"); // the oldest ten fell off the front
    expect(list[list.length - 1].msg).toBe("step " + (CRASH_BREADCRUMB_MAX + 9));
  });
});

describe("platform labels — clamped on the way in, detected from the bridge", () => {
  it("normalizeCrashPlatform clamps unknown values to web instead of inventing enum members", () => {
    expect(normalizeCrashPlatform("ios")).toBe("ios");
    expect(normalizeCrashPlatform("android-native")).toBe("android-native");
    // The Capacitor shells' NATIVE layer (v2.107.21) — a Java or NSException
    // crash of the shell itself, as opposed to the web bundle running inside it.
    expect(normalizeCrashPlatform("android-shell")).toBe("android-shell");
    expect(normalizeCrashPlatform("ios-shell")).toBe("ios-shell");
    expect(normalizeCrashPlatform("smart-fridge")).toBe("web");
    expect(normalizeCrashPlatform(undefined)).toBe("web");
  });

  it("detectCrashPlatform reads the Capacitor bridge — the trick that labels the SAME live bundle per shell", () => {
    expect(detectCrashPlatform({ Capacitor: { getPlatform: () => "ios" } })).toBe("ios");
    expect(detectCrashPlatform({ Capacitor: { getPlatform: () => "android" } })).toBe("android");
    expect(detectCrashPlatform({})).toBe("web");
    // A bridge that THROWS must degrade to web, never break the reporter.
    expect(
      detectCrashPlatform({
        Capacitor: {
          getPlatform: () => {
            throw new Error("broken bridge");
          },
        },
      })
    ).toBe("web");
  });
});
