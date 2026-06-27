import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { APP_VERSION } from "@shared/version";
import { isNewer } from "./updateVersion";

/**
 * v2.48 — Auto-update checker + "enable once" auto Picture-in-Picture.
 *
 * These pin the invariants of the update flow and the persistent auto-PiP wiring
 * (the behaviour is browser/DOM-driven, so we assert the source contracts the
 * same way the other generated-file tests do, plus the pure version constant).
 */

const UPDATE_CHECKER = fs.readFileSync(
  path.resolve(__dirname, "UpdateChecker.tsx"),
  "utf8",
);
const SERVER_INDEX = fs.readFileSync(
  path.resolve(__dirname, "..", "..", "..", "server", "_core", "index.ts"),
  "utf8",
);
const RELAY_CLIENT = fs.readFileSync(
  path.resolve(__dirname, "..", "lib", "relayClient.ts"),
  "utf8",
);
const APP_TSX = fs.readFileSync(
  path.resolve(__dirname, "..", "App.tsx"),
  "utf8",
);

describe("isNewer — strict semver gate (no rollout flapping)", () => {
  it("is true only when the server is strictly higher", () => {
    expect(isNewer("2.49.0", "2.48.0")).toBe(true);
    expect(isNewer("2.48.1", "2.48.0")).toBe(true);
    expect(isNewer("3.0.0", "2.48.0")).toBe(true);
  });
  it("is false for equal versions (the common steady-state case)", () => {
    expect(isNewer("2.48.0", "2.48.0")).toBe(false);
  });
  it("is false for an OLDER server (a rollback never flaps the client down)", () => {
    expect(isNewer("2.47.0", "2.48.0")).toBe(false);
    expect(isNewer("2.48.0", "2.48.1")).toBe(false);
    expect(isNewer("1.0.0", "2.48.0")).toBe(false);
  });
  it("treats missing / non-numeric segments as 0 without throwing", () => {
    expect(isNewer("2.48", "2.48.0")).toBe(false);
    expect(isNewer("2.48.1", "2.48")).toBe(true);
    expect(isNewer("", "2.48.0")).toBe(false);
  });
});

describe("shared app version", () => {
  it("is a clean semver string", () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
  it("is the current release (2.48.0)", () => {
    expect(APP_VERSION).toBe("2.48.0");
  });
});

describe("server /api/version endpoint", () => {
  it("serves the shared APP_VERSION", () => {
    expect(SERVER_INDEX).toMatch(/['"]@shared\/version['"]/);
    expect(SERVER_INDEX).toMatch(/app\.get\(\s*["']\/api\/version["']/);
    expect(SERVER_INDEX).toMatch(/version:\s*APP_VERSION/);
  });
  it("is uncacheable so a fresh deploy is seen immediately", () => {
    // The handler sets no-store; pin that it's near the route.
    const seg = SERVER_INDEX.slice(SERVER_INDEX.indexOf("/api/version"));
    expect(seg).toMatch(/Cache-Control["']\s*,\s*["']no-store/);
  });
});

describe("UpdateChecker component", () => {
  it("polls /api/version on a 30-second interval", () => {
    expect(UPDATE_CHECKER).toMatch(/fetch\(\s*["']\/api\/version["']/);
    expect(UPDATE_CHECKER).toMatch(/POLL_MS\s*=\s*30_?000/);
    expect(UPDATE_CHECKER).toMatch(/setInterval\(\s*check\s*,\s*POLL_MS\s*\)/);
  });
  it("fetches with no-store so it always sees the live version", () => {
    expect(UPDATE_CHECKER).toMatch(/cache:\s*["']no-store["']/);
  });
  it("acts ONLY on a strictly-newer server version (no rollout flapping)", () => {
    // A plain `serverV !== APP_VERSION` would reload a tab already on the new
    // bundle that polled an old instance mid-rollout. Require strict-newer.
    expect(UPDATE_CHECKER).toMatch(/import\s*\{\s*isNewer\s*\}\s*from\s*["']\.\/updateVersion["']/);
    expect(UPDATE_CHECKER).toMatch(/isNewer\(serverV,\s*APP_VERSION\)/);
    expect(UPDATE_CHECKER).not.toMatch(/serverV\s*===\s*APP_VERSION/);
  });
  it("reloads SILENTLY only for an ESTABLISHED call (phase === in-call), never dialing/ringing", () => {
    // dialing/ringing have no server membership to auto-rejoin, so a reload there
    // would silently drop the outgoing call — gate strictly on "in-call".
    expect(UPDATE_CHECKER).toMatch(/phaseRef\.current\s*===\s*["']in-call["']/);
    expect(UPDATE_CHECKER).toMatch(/reloadingRef\.current/);
    expect(UPDATE_CHECKER).toMatch(/window\.location\.reload\(\)/);
  });
  it("throttles silent reloads across the reload via sessionStorage (no stale-edge loop)", () => {
    // reloadingRef is wiped by reload(); a persistent stamp + cooldown stops a
    // stale CDN edge from re-reloading in a tight loop.
    expect(UPDATE_CHECKER).toMatch(/sessionStorage/);
    expect(UPDATE_CHECKER).toMatch(/recentlyReloaded\(\)/);
    expect(UPDATE_CHECKER).toMatch(/RELOAD_COOLDOWN_MS/);
  });
  it("shows a CENTERED modal card when idle (grid place-items-center, fixed inset-0)", () => {
    expect(UPDATE_CHECKER).toMatch(/fixed inset-0/);
    expect(UPDATE_CHECKER).toMatch(/place-items-center/);
    expect(UPDATE_CHECKER).toMatch(/role="dialog"/);
  });
  it("offers a clickable Refresh and a dismiss that REAPPEARS later", () => {
    expect(UPDATE_CHECKER).toMatch(/Refresh now/);
    expect(UPDATE_CHECKER).toMatch(/REAPPEAR_MS/);
    expect(UPDATE_CHECKER).toMatch(/setDismissed\(false\)/);
  });
  it("never interrupts an active call (card is gated on phase === idle)", () => {
    expect(UPDATE_CHECKER).toMatch(/phase\s*!==\s*["']idle["']\s*\)\s*return null/);
  });
  it("is mounted once at the app root", () => {
    expect(APP_TSX).toMatch(/<UpdateChecker\s*\/>/);
    expect(APP_TSX).toMatch(/import\s*\{\s*UpdateChecker\s*\}/);
  });
});

describe("auto Picture-in-Picture (enable once)", () => {
  it("persists the preference under a stable localStorage key", () => {
    expect(RELAY_CLIENT).toMatch(/relay_auto_pip/);
    expect(RELAY_CLIENT).toMatch(/function autoPipPref\(\)/);
    expect(RELAY_CLIENT).toMatch(/function setAutoPipPref\(/);
  });
  it("primes the compositor when a call opens so background auto-PiP needs no tap", () => {
    expect(RELAY_CLIENT).toMatch(/function primeAutoPip\(\)/);
    // enterCallUI calls primeAutoPip()
    const callUi = RELAY_CLIENT.slice(
      RELAY_CLIENT.indexOf("function enterCallUI"),
      RELAY_CLIENT.indexOf("function addSelfTile"),
    );
    expect(callUi).toMatch(/primeAutoPip\(\)/);
  });
  it("auto-opens PiP on background via a visibilitychange listener", () => {
    expect(RELAY_CLIENT).toMatch(/function onVisibilityChange\(\)/);
    expect(RELAY_CLIENT).toMatch(/addEventListener\(\s*["']visibilitychange["']\s*,\s*onVisibilityChange/);
    expect(RELAY_CLIENT).toMatch(/removeEventListener\(\s*["']visibilitychange["']\s*,\s*onVisibilityChange/);
  });
  it("relies on the autoPictureInPicture attribute for the gesture-free path", () => {
    expect(RELAY_CLIENT).toMatch(/autoPictureInPicture/);
  });
  it("stops priming when the call ends (no idle compositor leak)", () => {
    expect(RELAY_CLIENT).toMatch(/function unprimeAutoPip\(\)/);
    const hang = RELAY_CLIENT.slice(RELAY_CLIENT.indexOf("function hangUp"));
    expect(hang.slice(0, 2000)).toMatch(/unprimeAutoPip\(\)/);
  });
});
