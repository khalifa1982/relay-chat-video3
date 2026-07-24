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

  it("is bilingual again (owner ask): EN/AR copy tables + RTL + persisted toggle", () => {
    expect(HOME_TSX).toMatch(/\ben:\s*\{/);
    expect(HOME_TSX).toMatch(/\bar:\s*\{/);
    // real Arabic copy, not placeholders
    expect(HOME_TSX).toMatch(/مكالمات/);
    expect(HOME_TSX).toMatch(/متصفحك/);
    expect(HOME_TSX).toMatch(/الخصوصية/);
    // the page flips direction and persists the choice
    expect(HOME_TSX).toMatch(/dir="\$\{ar \? "rtl" : "ltr"\}"/);
    expect(HOME_TSX).toMatch(/localStorage\.setItem\("relay_lang"/);
    expect(HOME_TSX).toMatch(/data-lp="langBtn"/);
    // ENGLISH is the default for first-time visitors (owner directive,
    // v2.98.2) — no locale auto-detect; the saved toggle choice still wins.
    expect(HOME_TSX).not.toMatch(/navigator\.language/);
    expect(HOME_TSX).toMatch(/ENGLISH is the default for every first-time visitor/);
    // numbers/keypad stay LTR islands inside the RTL page
    expect(HOME_TSX).toMatch(/<div data-lp="dialDisplay" dir="ltr"/);
  });

  it("the boot loader can NEVER strand the page (v2.95.7 failsafes)", () => {
    // watchdog force-clear fires even when rAF is throttled (hidden tab)
    expect(HOME_TSX).toMatch(/const watchdog = setTimeout\(\(\) => finish\(true\), dur \+ 1600\)/);
    // a throwing step also clears the overlay
    expect(HOME_TSX).toMatch(/never strand the visitor behind the overlay/);
    // the heavy 3D boot is DEFERRED until the loader completes
    expect(HOME_TSX).toMatch(/replayHero\(\);\s*\n\s*\/\/ Boot the 3D scene only now/);
    // language switches skip the boot cinematic (plays once per visit)
    expect(HOME_TSX).toMatch(/skipBoot: bootedOnceRef\.current/);
    // v2.95.9 ZERO-JS belt: a pure-CSS watchdog clears the overlay unless the
    // engine proves it's alive, and the track shimmer moves without any JS.
    expect(HOME_TSX).toMatch(/\[data-lp="loader"\]:not\(\.lp-js-ok\)\{animation:lpAutoClear/);
    expect(HOME_TSX).toMatch(/classList\.add\("lp-js-ok"\)/);
    expect(HOME_TSX).toMatch(/\[data-lp="loadTrack"\]::after/);
  });

  it("the bar FILL is compositor-driven (v2.98.1 — never pinned at 0% again)", () => {
    // A full-width bar scaled by transform, with a plain-CSS default run…
    expect(HOME_TSX).toMatch(/@keyframes lpFill\{from\{transform:scaleX\(0\)\}to\{transform:scaleX\(1\)\}\}/);
    expect(HOME_TSX).toMatch(
      /\[data-lp="loadBar"\]\{transform-origin:left;transform:scaleX\(0\);animation:lpFill 3\.4s/,
    );
    // …grown from the right edge on the RTL (Arabic) page…
    expect(HOME_TSX).toMatch(/\[dir="rtl"\] \[data-lp="loadBar"\]\{transform-origin:right\}/);
    // …re-timed per run by runLoader (boot 3400ms / call cinematic 3000ms)…
    expect(HOME_TSX).toContain("bar.style.animation = `lpFill ${dur}ms");
    // …and NEVER driven by rAF width writes again (rAF starvation on slow
    // devices is exactly what froze the old width-based bar at 0%).
    expect(HOME_TSX).not.toMatch(/bar\.style\.width/);
    // v2.98.2: the percent COUNTER is compositor-driven too — an odometer
    // strip of 0%–100% lines swept by translateY on the same clock as the bar
    // (the rAF textContent writes sat frozen at "0%" on the same devices).
    expect(HOME_TSX).toMatch(/@keyframes lpPct\{from\{transform:translateY\(0\)\}to\{transform:translateY\(calc\(-100% \+ 14px\)\)\}\}/);
    expect(HOME_TSX).toMatch(/\[data-lp="pctStrip"\]\{animation:lpPct 3\.4s/);
    expect(HOME_TSX).toContain("strip.style.animation = `lpPct ${dur}ms");
    expect(HOME_TSX).toMatch(/function pctStripLines\(\)/);
    expect(HOME_TSX).not.toMatch(/pct\.textContent/);
    // reduced-motion kills animations but must NOT kill the zero-JS overlay
    // watchdog (that combination would strand the visitor behind the loader).
    expect(HOME_TSX).toMatch(
      /\[data-lp="loader"\]:not\(\.lp-js-ok\)\{animation:lpAutoClear \.5s ease 5\.6s forwards!important\}/,
    );
  });

  it("the mobile nav actually fits phones (v2.98.1 — the AR/EN toggle was off-screen)", () => {
    // The nav-link hide must beat the element's INLINE display:flex — without
    // !important the desktop links rendered on phones, wrapped to three lines,
    // and pushed the language toggle + Open-App pill off the right edge.
    expect(HOME_TSX).toMatch(/\.lp-navlinks\{display:none!important\}/);
    // Compact paddings so logo + ع/EN + Open App fit a 320px viewport.
    expect(HOME_TSX).toMatch(/\[data-lp="nav"\]\{padding:12px 14px!important;gap:12px!important\}/);
    expect(HOME_TSX).toMatch(/\[data-lp="langBtn"\]\{padding:8px 10px!important\}/);
    expect(HOME_TSX).toMatch(/\.lp-dock\{padding:9px 13px!important/);
    expect(HOME_TSX).toMatch(/class="lp-logo"/);
  });

  it("shows the support email (derived from the host — no domain literal)", () => {
    expect(HOME_TSX).toMatch(/const supportEmail = `support@\$\{host\}`/);
    expect(HOME_TSX).toMatch(/href="mailto:\$\{supportEmail\}"/);
    // FAQ contact entry in BOTH languages
    expect(HOME_TSX).toMatch(/How do I reach support\?/);
    expect(HOME_TSX).toMatch(/كيف أتواصل مع الدعم؟/);
  });

  it("links the privacy policy and keeps anchor navigation", () => {
    expect(HOME_TSX).toMatch(/href="\/privacy-policy"/);
    for (const a of ["#how", "#features", "#privacy", "#faq", "#top"]) {
      expect(HOME_TSX).toContain(`href="${a}"`);
    }
  });
});

describe("v2.99.15 — hero dialer resolves the number + gates on online (owner)", () => {
  it("resolves the dialed number via public directory.lookup and previews name + online", () => {
    expect(HOME_TSX).toMatch(/onLookup/);
    expect(HOME_TSX).toMatch(/utils\.directory\.lookup\s*\.fetch\(\{ number \}\)/);
    expect(HOME_TSX).toMatch(/data-lp="dialPreview"/);
  });
  it("gates the CALL button on a callable target — online user or party line; offline + unknown are blocked", () => {
    expect(HOME_TSX).toMatch(/res\.isOnline/);
    expect(HOME_TSX).toMatch(/res\.partyLine/);
    expect(HOME_TSX).toMatch(/dialCallable/);
    expect(HOME_TSX).toMatch(/if \(!dialCallable\) return;/);
  });
  it("escapes the looked-up display name before it reaches innerHTML (no XSS)", () => {
    expect(HOME_TSX).toMatch(/const escLp =/);
    expect(HOME_TSX).toMatch(/escLp\(res\.displayName/);
  });
});
