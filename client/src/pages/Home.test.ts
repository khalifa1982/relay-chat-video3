import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Marketing landing page — the Claude Design "RELAY Landing" port (v2.95.5).
 *
 * Pins the invariants of the implemented page: the cinematic structure
 * (loader / hero dialer / marquee / live stats / how / features / privacy /
 * faq / footer), the WORKING hero dialer wiring (DTMF map + /i/<n> call
 * hand-off into the app's direct-join flow), relative CTAs (the domain guard
 * forbids deployment literals — chrome labels derive from siteHost()), the
 * dynamically-imported three.js scene with its no-WebGL fallback, the
 * reduced-motion path, the carried-over live network stats, the bundled
 * portrait assets, and the version footer.
 */

const HOME_TSX = fs.readFileSync(path.resolve(__dirname, "Home.tsx"), "utf8");

describe("Home.tsx — RELAY Landing (design port)", () => {
  it("default-exports a Home component", () => {
    expect(HOME_TSX).toMatch(/export\s+default\s+function\s+Home/);
  });

  it("keeps the LIVE NETWORK stats from the previous landing (owner ask)", () => {
    expect(HOME_TSX).toMatch(/trpc\.stats\.public\.useQuery/);
    expect(HOME_TSX).toMatch(/refetchInterval/);
    for (const k of ["registeredUsers", "guestsServed", "totalParties", "onlineNow"]) {
      expect(HOME_TSX).toContain(k);
    }
    expect(HOME_TSX).toMatch(/LIVE NETWORK — REAL NUMBERS/);
  });

  it("has every design section + the boot loader + marquee", () => {
    for (const label of ["Hero", "How it works", "Features", "Privacy", "FAQ", "Footer", "Live stats"]) {
      expect(HOME_TSX).toContain(`data-screen-label="${label}"`);
    }
    expect(HOME_TSX).toMatch(/WAKING THE NETWORK…/);
    expect(HOME_TSX).toMatch(/LINE ENCRYPTED/);
    expect(HOME_TSX).toMatch(/lpMarquee 30s linear infinite/);
  });

  it("hero dialer is REAL: DTMF tones + 6-digit gate + /i/<n> hand-off", () => {
    // Full DTMF frequency table.
    expect(HOME_TSX).toMatch(/"1": \[697, 1209\]/);
    expect(HOME_TSX).toMatch(/"#": \[941, 1477\]/);
    // The CALL button plays the cinematic loader then lands in the app's
    // call-link direct-join flow — same-origin, never a hardcoded domain.
    expect(HOME_TSX).toMatch(/window\.location\.href = `\/i\/\$\{n\}`/);
    expect(HOME_TSX).toMatch(/DIAL A DEMO NUMBER/);
    expect(HOME_TSX).toMatch(/LINE READY — PRESS CALL/);
  });

  it("CTAs are relative /app links; decorative chrome derives from siteHost()", () => {
    expect(HOME_TSX).toMatch(/href="\/app"/);
    expect(HOME_TSX).toMatch(/siteHost\(\)/);
    expect(HOME_TSX).not.toMatch(/your-chat/);
    expect(HOME_TSX).not.toMatch(/manus\.space/);
  });

  it("three.js loads via dynamic import with a graceful no-WebGL fallback", () => {
    expect(HOME_TSX).toMatch(/await import\("three"\)/);
    // never statically imported (it must not land in the entry/landing chunk)
    expect(HOME_TSX).not.toMatch(/^import .* from ["']three["']/m);
    // renderer construction is try/caught — 2D fx keep running without WebGL
    expect(HOME_TSX).toMatch(/new T\.WebGLRenderer\(/);
    expect(HOME_TSX).toMatch(/catch \{ return; \} \/\/ no WebGL/);
  });

  it("all five 3D zones + the matrix rain + scramble are ported", () => {
    for (const z of ["zone 0: peer-to-peer network", "zone 1: waveform rings", "zone 2: glassy orbs", "zone 3: globe with arcs", "zone 4: calm starfield"]) {
      expect(HOME_TSX).toContain(z);
    }
    expect(HOME_TSX).toMatch(/drawMatrix/);
    expect(HOME_TSX).toMatch(/scrTick/);
  });

  it("honors prefers-reduced-motion (no loader, no rain, no 3D)", () => {
    expect(HOME_TSX).toMatch(/prefers-reduced-motion: reduce/);
    // engine checks it before booting the heavy paths
    expect(HOME_TSX).toMatch(/const reduced =/);
  });

  it("uses the ALREADY-BUNDLED portrait tiles (no external image hosts)", () => {
    for (let i = 1; i <= 10; i++) {
      expect(HOME_TSX).toMatch(new RegExp(`/marketing/p${String(i).padStart(2, "0")}_`));
    }
    expect(HOME_TSX).not.toMatch(/manus-storage/);
  });

  it("cleans up on unmount (rAF loops, listeners, renderer, audio)", () => {
    expect(HOME_TSX).toMatch(/cancelAnimationFrame\(raf\)/);
    expect(HOME_TSX).toMatch(/cancelAnimationFrame\(threeRaf\)/);
    expect(HOME_TSX).toMatch(/removeEventListener\("mousemove", onMove\)/);
    expect(HOME_TSX).toMatch(/renderer\?\.dispose\(\)/);
    expect(HOME_TSX).toMatch(/ac\?\.close\(\)/);
  });

  it("carries the version footer (owner convention: versioned every deploy)", () => {
    expect(HOME_TSX).toMatch(/© 2026 RELAY · v\$\{APP_VERSION\}/);
  });

  it("links the privacy policy and keeps anchor navigation", () => {
    expect(HOME_TSX).toMatch(/href="\/privacy-policy"/);
    for (const a of ["#how", "#features", "#privacy", "#faq", "#top"]) {
      expect(HOME_TSX).toContain(`href="${a}"`);
    }
  });
});
