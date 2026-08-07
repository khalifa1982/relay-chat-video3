/**
 * SCREENSHOT-BLOCK BRIDGE (QW-12, v2.107.65).
 *
 * The mobile shell (1.0.44+) is the only layer that can flip Android's
 * FLAG_SECURE. The web app owns the toggle UI and posts the decision to the
 * shell; the shell advertises the capability so the switch only appears where it
 * works. This pins the load-bearing guarantees:
 *
 *  - the toggle's visibility hangs on a capability the SHELL advertises
 *    (`__RELAY_NATIVE__.capabilities.screenshotBlock`), never a user-agent sniff,
 *    so it can never show as a dead control on desktop or an older shell;
 *  - the preference is DEVICE-LOCAL (localStorage), not an account flag;
 *  - flipping it both persists AND posts the exact `SET_SCREENSHOT_BLOCK` wire
 *    shape the shell parses;
 *  - it is re-applied on every load (FLAG_SECURE resets per Activity), and is a
 *    silent no-op off a supporting shell.
 *
 * The env is Node with no DOM (see vitest.config.ts), so each behavioural test
 * stands in a fake `window` with an in-memory localStorage and a capturing
 * ReactNativeWebView, and always restores the global so one test can't leak into
 * the next.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { codeOnly } from "../../../server/testing/codeOnly";
import {
  screenshotBlockSupported,
  getScreenshotBlockPref,
  setScreenshotBlock,
  applyStoredScreenshotBlock,
} from "./nativeScreenshotBridge";

// ─────────────────────────── fake-window harness ───────────────────────────

type WindowOpts = {
  /** Present only when a native shell injected it; its capability decides support. */
  native?: { platform?: string; capabilities?: { screenshotBlock?: boolean } };
  /** Whether a ReactNativeWebView bridge is attached (a real shell attaches one). */
  rn?: boolean;
  /** Simulate private-mode / disabled storage that throws on access. */
  storageThrows?: boolean;
  /** Pre-seed localStorage. */
  store?: Record<string, string>;
};

function withWindow(
  opts: WindowOpts,
  body: (ctx: { posted: Array<{ type?: string; enabled?: unknown }>; store: Record<string, string> }) => void,
) {
  const g = globalThis as unknown as { window?: unknown };
  const prev = g.window;
  const store: Record<string, string> = { ...(opts.store ?? {}) };
  const posted: Array<{ type?: string; enabled?: unknown }> = [];

  const localStorage = opts.storageThrows
    ? {
        getItem() {
          throw new Error("storage blocked");
        },
        setItem() {
          throw new Error("storage blocked");
        },
      }
    : {
        getItem: (k: string) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
        setItem: (k: string, v: string) => {
          store[k] = String(v);
        },
      };

  const fakeWin: Record<string, unknown> = { localStorage };
  if (opts.native !== undefined) fakeWin.__RELAY_NATIVE__ = opts.native;
  if (opts.rn) {
    fakeWin.ReactNativeWebView = {
      postMessage: (s: string) => {
        try {
          posted.push(JSON.parse(s));
        } catch {
          posted.push({});
        }
      },
    };
  }

  g.window = fakeWin;
  try {
    body({ posted, store });
  } finally {
    if (prev === undefined) delete g.window;
    else g.window = prev;
  }
}

// ─────────────────────────── capability gate ───────────────────────────

describe("QW-12 — the toggle only exists where the shell can enforce it", () => {
  it("is unsupported off a shell (no __RELAY_NATIVE__)", () => {
    withWindow({}, () => {
      expect(screenshotBlockSupported()).toBe(false);
    });
  });

  it("is unsupported when the shell advertises no such capability (e.g. iOS)", () => {
    withWindow({ native: { platform: "ios", capabilities: { screenshotBlock: false } } }, () => {
      expect(screenshotBlockSupported()).toBe(false);
    });
    withWindow({ native: { platform: "ios", capabilities: {} } }, () => {
      expect(screenshotBlockSupported()).toBe(false);
    });
  });

  it("is supported only on a build that advertises it (Android)", () => {
    withWindow({ native: { platform: "android", capabilities: { screenshotBlock: true } } }, () => {
      expect(screenshotBlockSupported()).toBe(true);
    });
  });
});

// ─────────────────────────── stored preference ───────────────────────────

describe("QW-12 — the preference is device-local and defaults OFF", () => {
  it("defaults to OFF when nothing is stored", () => {
    withWindow({}, () => {
      expect(getScreenshotBlockPref()).toBe(false);
    });
  });

  it("reads '1' as ON and '0' as OFF", () => {
    withWindow({ store: { "relay.screenshotBlock": "1" } }, () => {
      expect(getScreenshotBlockPref()).toBe(true);
    });
    withWindow({ store: { "relay.screenshotBlock": "0" } }, () => {
      expect(getScreenshotBlockPref()).toBe(false);
    });
  });

  it("reads as OFF rather than throwing when storage is unavailable", () => {
    withWindow({ storageThrows: true }, () => {
      expect(getScreenshotBlockPref()).toBe(false);
    });
  });
});

// ─────────────────────────── set: persist + post ───────────────────────────

describe("QW-12 — flipping the toggle persists and posts the wire shape", () => {
  it("ON writes '1' and posts SET_SCREENSHOT_BLOCK enabled:true", () => {
    withWindow({ rn: true, native: { capabilities: { screenshotBlock: true } } }, ({ posted, store }) => {
      setScreenshotBlock(true);
      expect(store["relay.screenshotBlock"]).toBe("1");
      expect(posted).toEqual([{ type: "SET_SCREENSHOT_BLOCK", enabled: true }]);
    });
  });

  it("OFF writes '0' and posts SET_SCREENSHOT_BLOCK enabled:false", () => {
    withWindow({ rn: true, store: { "relay.screenshotBlock": "1" } }, ({ posted, store }) => {
      setScreenshotBlock(false);
      expect(store["relay.screenshotBlock"]).toBe("0");
      expect(posted).toEqual([{ type: "SET_SCREENSHOT_BLOCK", enabled: false }]);
    });
  });

  it("still posts (for this session) even if persisting throws", () => {
    withWindow({ rn: true, storageThrows: true }, ({ posted }) => {
      setScreenshotBlock(true);
      expect(posted).toEqual([{ type: "SET_SCREENSHOT_BLOCK", enabled: true }]);
    });
  });
});

// ─────────────────────────── apply-on-load ───────────────────────────

describe("QW-12 — the block is re-applied on every load", () => {
  it("posts the stored preference when the shell supports it", () => {
    withWindow(
      { rn: true, native: { capabilities: { screenshotBlock: true } }, store: { "relay.screenshotBlock": "1" } },
      ({ posted }) => {
        applyStoredScreenshotBlock();
        expect(posted).toEqual([{ type: "SET_SCREENSHOT_BLOCK", enabled: true }]);
      },
    );
  });

  it("is a silent no-op off a supporting shell (nothing posted)", () => {
    withWindow({ rn: true, store: { "relay.screenshotBlock": "1" } }, ({ posted }) => {
      applyStoredScreenshotBlock(); // no __RELAY_NATIVE__ capability → unsupported
      expect(posted).toEqual([]);
    });
  });
});

// ─────────────────────────── the wiring is actually in place ───────────────────────────

const read = (rel: string) => readFileSync(join(__dirname, rel), "utf8");
const bridge = codeOnly(read("./nativeScreenshotBridge.ts"));
const relayEngine = codeOnly(read("./RelayEngine.tsx"));
const profile = codeOnly(read("../pages/app/Profile.tsx"));
const profileDict = read("./dict/profile.ts");
const version = read("../../../shared/version.ts");

const hasBilingualKey = (src: string, key: string, prefix: string): boolean => {
  const at = src.indexOf(`"${key}":`);
  if (at < 0) return false;
  const rest = src.slice(at + key.length);
  const nextKey = rest.indexOf(`"${prefix}`, 3);
  const entry = nextKey > 0 ? rest.slice(0, nextKey) : rest.slice(0, 400);
  return /\ben:/.test(entry) && /\bar:/.test(entry);
};

describe("QW-12 — the bridge speaks the shell's contract", () => {
  it("posts through the ReactNativeWebView bridge with the agreed type", () => {
    expect(bridge).toMatch(/ReactNativeWebView/);
    expect(bridge).toMatch(/"SET_SCREENSHOT_BLOCK"/);
    expect(bridge).toMatch(/__RELAY_NATIVE__/);
    // The preference is device-local, keyed in localStorage — not a server flag.
    expect(bridge).toMatch(/relay\.screenshotBlock/);
  });
});

describe("QW-12 — the engine re-applies the block on load, ungated by auth", () => {
  it("imports and calls applyStoredScreenshotBlock in a mount-once effect", () => {
    expect(relayEngine).toMatch(/import \{ applyStoredScreenshotBlock \} from "\.\/nativeScreenshotBridge"/);
    expect(relayEngine).toMatch(/applyStoredScreenshotBlock\(\)/);
  });
});

describe("QW-12 — the toggle is wired into privacy settings and self-gates", () => {
  it("renders the toggle under the receipts/typing toggles", () => {
    expect(profile).toMatch(/<ReadReceiptTypingToggles \/>\s*<ScreenshotBlockToggle \/>/);
  });

  it("the toggle draws nothing unless the shell advertises support", () => {
    expect(profile).toMatch(/function ScreenshotBlockToggle\(\)/);
    expect(profile).toMatch(/if \(!screenshotBlockSupported\(\)\) return null;/);
    // Flipping it goes through the device-local helper, not updateProfile.
    expect(profile).toMatch(/setScreenshotBlock\(next\)/);
  });

  it("every screenshot-block string is bilingual", () => {
    for (const key of [
      "profile.screenshotSectionLabel",
      "profile.screenshotBlockTitle",
      "profile.screenshotBlockDesc",
      "profile.screenshotBlockFooter",
    ]) {
      expect(hasBilingualKey(profileDict, key, "profile."), key).toBe(true);
    }
  });
});

describe("QW-12 — version", () => {
  it("the app version is at or past the release that introduced it", () => {
    const m = /APP_VERSION = "(\d+)\.(\d+)\.(\d+)"/.exec(version);
    expect(m, "version.ts must declare a version").toBeTruthy();
    const got = [+m![1], +m![2], +m![3]];
    const min = [2, 107, 65];
    expect(got[0] * 1e6 + got[1] * 1e3 + got[2]).toBeGreaterThanOrEqual(
      min[0] * 1e6 + min[1] * 1e3 + min[2],
    );
  });
});
