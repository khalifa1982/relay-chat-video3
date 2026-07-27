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
  it("is the current release (2.101.1)", () => {
    expect(APP_VERSION).toBe("2.101.1");
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
  it("reloads SILENTLY when idle OR in an established call, never dialing/ringing (v2.96.1)", () => {
    // Owner: updates should apply with no Refresh click. dialing/ringing have
    // no server membership to auto-rejoin, so a reload there would silently
    // drop the outgoing call — those phases defer to the next poll.
    expect(UPDATE_CHECKER).toMatch(/p\s*===\s*["']in-call["']\s*\|\|\s*p\s*===\s*["']idle["']/);
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
    // Window widened (2000 → 2800) for the v2.78.1 waiting-ring promotion
    // block inserted earlier in hangUp; the unprime call itself is unchanged.
    expect(hang.slice(0, 2800)).toMatch(/unprimeAutoPip\(\)/);
  });
});

describe("iOS Picture-in-Picture (real-stream path, v2.50)", () => {
  it("detects iOS and drives PiP via the WebKit presentation-mode API", () => {
    expect(RELAY_CLIENT).toMatch(/const IS_IOS =/);
    expect(RELAY_CLIENT).toMatch(/webkitSetPresentationMode/);
    expect(RELAY_CLIENT).toMatch(/webkitPresentationMode/);
  });
  it("feeds the PiP video a REAL remote stream on iOS (canvas renders black there)", () => {
    expect(RELAY_CLIENT).toMatch(/function iosPipStream\(\)/);
    expect(RELAY_CLIENT).toMatch(/function pipRefreshIosSource\(\)/);
    // pipRender takes the iOS branch before touching the canvas.
    const render = RELAY_CLIENT.slice(RELAY_CLIENT.indexOf("function pipRender"));
    expect(render.slice(0, 400)).toMatch(/if \(IS_IOS\)\s*\{\s*pipRefreshIosSource\(\)/);
  });
  it("skips the canvas compositor on iOS in ensurePipCompositor", () => {
    const ens = RELAY_CLIENT.slice(RELAY_CLIENT.indexOf("function ensurePipCompositor"));
    expect(ens.slice(0, 900)).toMatch(/if \(!IS_IOS\)/);
  });
});

describe("call-routing fixes (v2.50)", () => {
  it("switchCall no longer sends an explicit switch-call leave (accept relocates atomically)", () => {
    const sc = RELAY_CLIENT.slice(
      RELAY_CLIENT.indexOf("function switchCall"),
      RELAY_CLIENT.indexOf("function switchCall") + 1800,
    );
    // An ESTABLISHED call is relocated atomically by the server's accept handler
    // (no switch-call leave — the v2.50 race fix). v2.99.27 (QA M2) adds a leave
    // ONLY on the abandon-an-unanswered-DIAL branch, which targets the OLD dial
    // room (a DIFFERENT room from the one being accepted), so it can't race.
    expect(sc).not.toMatch(/type:\s*["']leave["'][^}]*switch-call/);
    expect(sc).toMatch(/type:\s*["']accept["']/);
  });
  it("an offline error from an add-to-call invite does not tear down the call", () => {
    expect(RELAY_CLIENT).toMatch(/addInviteOfflineGuard/);
    // The error handler checks the guard before the alone-in-call hangUp — and
    // v2.99.19 widened it to BOTH offline + nonexistent (the add-to-call "+"
    // pad can hit either code depending on whether the number is a real user);
    // v2.99.47 added `unavailable` (the offline-dial throttle) for the same
    // reason and pushed the guard further down the case, hence the wider window.
    const errCase = RELAY_CLIENT.slice(RELAY_CLIENT.indexOf('case "error"'));
    expect(errCase.slice(0, 2400)).toMatch(
      /addInviteOfflineGuard\s*&&\s*\(m\.code === ["']offline["']\s*\|\|\s*m\.code === ["']nonexistent["']/,
    );
  });
});

describe("robust auto-rejoin across the Update reload (v2.57)", () => {
  it("snapshots the active call on unload and restores it at boot", () => {
    expect(RELAY_CLIENT).toMatch(/from "\.\/rejoinSnapshot"/);
    // onUnload writes the snapshot while in a call.
    expect(RELAY_CLIENT).toMatch(/if \(inCall && roomId && me\.pin\) \{\s*writeSnapshot\(\{/);
    // Boot reads it + arms a watchdog.
    expect(RELAY_CLIENT).toMatch(/pendingRejoin = readSnapshot\(Date\.now\(\)\)/);
    expect(RELAY_CLIENT).toMatch(/rejoinWatchT = setTimeout/);
  });
  it("registers under the IN-CALL pin during a pending rejoin (so the server room matches)", () => {
    expect(RELAY_CLIENT).toMatch(/if \(pendingRejoin && \/\^\\d\{6\}\$\/\.test\(pendingRejoin\.pin\)\) me\.pin = pendingRejoin\.pin/);
  });
  it("onRejoin retries media + restores mic/cam, never dropping on a transient failure", () => {
    expect(RELAY_CLIENT).toMatch(/let gotMedia = false/);
    expect(RELAY_CLIENT).toMatch(/if \(!pendingRejoin\.micOn\) setMic\(false\)/);
    expect(RELAY_CLIENT).toMatch(/if \(!pendingRejoin\.camOn\) setCam\(false\)/);
  });
  it("does not switch the pin while a rejoin is pending", () => {
    expect(RELAY_CLIENT).toMatch(/!inCall && !pendingRejoin && ws && ws\.readyState === 1/);
  });
});

describe("Android loudspeaker force (Web Audio routing, v2.57)", () => {
  it("offers a reversible loudspeaker route on phones (v2.99.4: via the Loudspeaker/Earpiece/Bluetooth menu; v2.84's blind toggle is retired)", () => {
    expect(RELAY_CLIENT).toMatch(/const IS_ANDROID =/);
    expect(RELAY_CLIENT).toMatch(/if \(IS_ANDROID \|\| IS_IOS\) \{\s*\n\s*void renderMobileAudioMenu\(\)/);
    expect(RELAY_CLIENT).toMatch(/async function setMobileRoute\(route: string\)/);
  });
  it("only mutes source elements AFTER the context is confirmed running (never silence)", () => {
    const en = RELAY_CLIENT.slice(RELAY_CLIENT.indexOf("async function loudspeakerEnable"));
    // Window widened (v2.69) — the onstatechange auto-resume block was added
    // above this guard, which still runs before any element is muted.
    expect(en.slice(0, 1000)).toMatch(/if \(loudspeakerCtx\.state !== "running"\) return false/);
  });
});
