/* ============================================================
   v2.99.67 — OWNER BATCH: heating, a vanishing conference tile, the wrapped
   dial pad, and the missed-call banner.

   1. "On the mobile, it shows you five digits up and one digit below. So make
      them one line instead of two lines." The landing dial display is 30px
      monospace with .28em letter-spacing; six digits joined by spaces is 11
      characters ≈ 290px, against ~285px of inner card width at 390px — so it
      wrapped, and only on a phone.
   2. "When I open this website from the phone, the phone is heating." The page
      ran two uncapped rAF loops (this one plus the WebGL scene), repainted a
      full-viewport canvas at device pixel ratio every frame, and rewrote six
      gradient/box-shadow style strings 20 times a second, with no pause when the
      tab was hidden. Measured on an emulated 390px phone at 4x CPU throttle:
      canvas repaints 59.1/s -> 16.6/s, backing store 585x1266 -> 390x844, i.e.
      ~43.7 Mpx/s -> ~5.5 Mpx/s of canvas fill.
   3. "On the conference call, somebody got a line, when he answer and he
      returned back, he disappeared… he keep hearing [him], but his profile is
      disappeared." onPeerHold restored a placeholder tile only when LiveKit was
      active, and on the way BACK it only stripped a CSS class — so if the tile
      had already gone with the peer's transport there was nothing to un-hold.
   4. "Don't show it on the main screen as a side banner from up to down. Show it
      only on the notification center on the top… and also on the history."
   ============================================================ */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..", "..", "..");
const read = (...p: string[]) => fs.readFileSync(path.resolve(root, ...p), "utf8");
const HOME = read("client", "src", "pages", "Home.tsx");
const RELAY = read("client", "src", "lib", "relayClient.ts");
const SHELL = read("client", "src", "app", "AppShell.tsx");

describe("1 — the dial display can never wrap", () => {
  const disp = HOME.slice(
    HOME.indexOf('<div data-lp="dialDisplay"'),
    HOME.indexOf('<div data-lp="dialDisplay"') + 400
  );

  it("is nowrap, so six digits are structurally one line", () => {
    expect(disp).toMatch(/white-space:nowrap/);
  });

  it("scales with the viewport instead of a fixed 30px", () => {
    // 11 chars x (0.6em advance + letter-spacing) must fit ~285px at 390px wide.
    expect(disp).toMatch(/font:500 clamp\(19px,6\.2vw,30px\)/);
    expect(disp).toMatch(/letter-spacing:clamp\(\.13em,\.6vw,\.28em\)/);
    // The old fixed values are what overflowed.
    expect(disp).not.toMatch(/font:500 30px/);
    expect(disp).not.toMatch(/letter-spacing:\.28em/);
  });

  it("still caps at the desktop size, which was already correct", () => {
    // clamp's max is the original 30px / .28em, so wide screens are unchanged.
    expect(disp).toContain("30px)");
    expect(disp).toContain(".28em)");
  });
});

describe("2 — the render loop has a budget and pauses when unseen", () => {
  it("detects a low-power device from screen, cores, or Data Saver", () => {
    const blk = HOME.slice(HOME.indexOf("const lowPower ="), HOME.indexOf("const lowPower =") + 700);
    expect(blk).toMatch(/innerWidth <= 820/);
    expect(blk).toMatch(/hardwareConcurrency <= 4/);
    expect(blk).toMatch(/saveData/);
  });

  it("caps the frame rate, lower on a phone", () => {
    expect(HOME).toMatch(/const FRAME_MS = lowPower \? 1000 \/ 20 : 1000 \/ 30;/);
    const loop = HOME.slice(HOME.indexOf("const fxLoop = () => {"), HOME.indexOf("const fxLoop = () => {") + 700);
    expect(loop).toMatch(/if \(now - lastFrame < FRAME_MS\) return;/);
  });

  it("does no work at all for a hidden tab", () => {
    const loop = HOME.slice(HOME.indexOf("const fxLoop = () => {"), HOME.indexOf("const fxLoop = () => {") + 700);
    expect(loop).toMatch(/document\.hidden\) return;/);
    // The rAF is re-armed BEFORE the early returns, or the loop would die on the
    // first hidden frame and never resume.
    expect(loop.indexOf("requestAnimationFrame(fxLoop)")).toBeLessThan(loop.indexOf("document.hidden"));
  });

  it("throttles the chrome tint by TIME, not frame count", () => {
    // Frame-count throttling makes the cost track the frame rate; the hue drifts
    // slowly, so 20Hz bought nothing visible.
    expect(HOME).toMatch(/const TINT_MS = lowPower \? 220 : 160;/);
    expect(HOME).toMatch(/if \(nowMs - lastTint >= TINT_MS\) \{/);
    expect(HOME).not.toMatch(/if \(fc % 3 === 0\) \{/);
  });

  it("stops painting the canvas at retina density on a phone", () => {
    expect(HOME).toMatch(/Math\.min\(devicePixelRatio, lowPower \? 1 : 1\.5\)/);
    expect(HOME).toMatch(/innerWidth \/ \(lowPower \? 26 : 18\)/);
  });

  it("skips the WebGL scene entirely on a low-power device", () => {
    expect(HOME).toMatch(/if \(reduced \|\| threeStarted \|\| lowPower\) return;/);
  });

  it("leaves the reduced-motion path exactly as it was", () => {
    // Reduced motion already skipped rain, scramble and 3D; this batch must not
    // change what that visitor gets.
    expect(HOME).toMatch(/const reduced =\s*\n\s*typeof matchMedia !== "undefined"/);
  });
});

describe("3 — a peer who takes another call comes back with a tile", () => {
  it("there is a transport-agnostic placeholder tile", () => {
    expect(RELAY).toMatch(/function ensurePlaceholderTile\(id: string, name: string\)/);
    const fn = RELAY.slice(
      RELAY.indexOf("function ensurePlaceholderTile"),
      RELAY.indexOf("function dropPlaceholderTile")
    );
    // Bails if a tile already exists, so it can never duplicate an id.
    expect(fn).toMatch(/if \(document\.getElementById\("tile-" \+ id\)\) return;/);
    expect(fn).toMatch(/t\.dataset\.ph = "1";/);
    expect(fn).toMatch(/layoutGrid\(\);/);
  });

  it("the real tile REPLACES the placeholder on both transports", () => {
    // Without this, addTile/addLkTile would append a second #tile-<id>.
    const addTile = RELAY.slice(RELAY.indexOf("function addTile(id: string"), RELAY.indexOf("function attachRemote"));
    expect(addTile).toMatch(/dropPlaceholderTile\(id\);/);
    const addLk = RELAY.slice(RELAY.indexOf("function addLkTile(id: string"), RELAY.indexOf("function addLkTile(id: string") + 400);
    expect(addLk).toMatch(/dropPlaceholderTile\(id\);/);
    // And only a placeholder is ever removed by it.
    const drop = RELAY.slice(RELAY.indexOf("function dropPlaceholderTile"), RELAY.indexOf("function dropPlaceholderTile") + 300);
    expect(drop).toMatch(/dataset\.ph === "1"/);
  });

  it("restores the tile on hold on EITHER transport, not just LiveKit", () => {
    const hold = RELAY.slice(RELAY.indexOf("function onPeerHold"), RELAY.indexOf("function onRoleChange"));
    expect(hold).toMatch(/ensurePlaceholderTile\(pin, nm\);/);
    // The LiveKit-only guard is what left a mesh conference with no tile.
    expect(hold).not.toMatch(/if \(livekitEnabled && !document\.getElementById/);
  });

  it("RESTORES the tile when they come back — the reported symptom", () => {
    const hold = RELAY.slice(RELAY.indexOf("function onPeerHold"), RELAY.indexOf("function onRoleChange"));
    const back = hold.slice(hold.indexOf("peersHoldingUs.delete(pin);"));
    expect(back).toMatch(/ensurePlaceholderTile\(pin, nm\);/);
    // It must happen BEFORE the class is stripped, or there is nothing to strip.
    expect(back.indexOf("ensurePlaceholderTile")).toBeLessThan(
      back.indexOf('classList.remove("on-hold")')
    );
  });

  it("both branches of the hold signal now ensure a tile", () => {
    const hold = RELAY.slice(RELAY.indexOf("function onPeerHold"), RELAY.indexOf("function onRoleChange"));
    expect((hold.match(/ensurePlaceholderTile/g) || []).length).toBe(2);
  });
});

describe("4 — the missed-call banner is gone from the main screen", () => {
  it("nothing drops a summary banner over the app", () => {
    expect(SHELL).not.toMatch(/<AwaySummaryToast/);
    // …and the import went with it rather than lingering as dead code.
    expect(SHELL).toMatch(/import \{ NotificationBell \} from "\.\/MissedCalls";/);
    expect(SHELL).not.toMatch(/AwaySummaryToast, NotificationBell/);
  });

  it("the bell still carries the count and the blink", () => {
    // The information is not lost, it moved to pull-not-push surfaces.
    expect(SHELL).toMatch(/<NotificationBell/);
    const bell = read("client", "src", "app", "MissedCalls.tsx");
    expect(bell).toMatch(/const total = missedCount \+ unreadCount \+ pendingDevices;/);
    expect(bell).toMatch(/const blink = missedCount \+ unreadCount > 0;/);
    // …and it routes to History and Messages for the detail.
    expect(bell).toMatch(/onOpenHistory/);
    expect(bell).toMatch(/onOpenMessages/);
  });
});
