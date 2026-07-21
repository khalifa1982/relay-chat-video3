import { useEffect, useMemo, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { APP_VERSION } from "@shared/version";
import { siteHost } from "@/lib/siteHost";

/**
 * Marketing landing page — implemented from the owner's Claude Design project
 * "RELAY Landing.dc.html" (2cf1060d, 2026-07-21). A cinematic single-page site:
 * a boot loader that plays the DTLS-SRTP handshake story, a scroll-driven
 * three.js fly-through (5 depth zones: p2p network → waveform rings → orbs →
 * globe arcs → starfield), a scroll-velocity "matrix rain" + text-scramble
 * effect, a hue that shifts with scroll depth, and a WORKING hero dialer
 * (real DTMF tones; 6 digits → CALL → the cinematic loader → /i/<number>,
 * which lands in the app's call-link direct-join flow).
 *
 * Implementation notes (deliberate deviations from the raw design file):
 * - The design hardcoded the deployment domain in its CTAs; this repo forbids
 *   deployment-domain literals (noHardcodedDomains.test.ts), and the landing IS
 *   the app's own origin — so CTAs are relative (/app, /i/<n>) and the
 *   decorative browser-chrome labels derive from siteHost().
 * - LIVE NETWORK stats (owner ask): the previous landing's real-time figures
 *   (trpc.stats.public — registered users / guests served / call parties /
 *   online now) are carried into the new design as a strip under the marquee.
 * - three.js is an npm dep loaded via dynamic import() so the 3D chunk loads
 *   after first paint; if WebGL/import fails the page still fully works (the
 *   2D fx loop is independent).
 * - prefers-reduced-motion: the boot loader, rain, scramble and 3D scene are
 *   skipped; content reveals immediately.
 * - The design's portrait assets are the SAME p01–p10 tiles already bundled at
 *   /marketing/ (v2.92.3), referenced directly — no new binaries.
 * - Markup is mounted via dangerouslySetInnerHTML with an imperative engine —
 *   the repo's established pattern for design-file ports (see Relay.tsx).
 */

/* eslint-disable react-hooks/exhaustive-deps */

const P = [
  "/marketing/p01_48b37f0c.jpg",
  "/marketing/p02_25ef8366.jpg",
  "/marketing/p03_20c4e74c.jpg",
  "/marketing/p04_fc1bd253.jpg",
  "/marketing/p05_a63e3fa7.jpg",
  "/marketing/p06_b6c856de.jpg",
  "/marketing/p07_0bb4a935.jpg",
  "/marketing/p08_d54aaacd.jpg",
  "/marketing/p09_fb2b3bc4.jpg",
  "/marketing/p10_6d299c17.jpg",
];

const KEYS: Array<[string, string]> = [
  ["1", ""], ["2", "ABC"], ["3", "DEF"], ["4", "GHI"], ["5", "JKL"], ["6", "MNO"],
  ["7", "PQRS"], ["8", "TUV"], ["9", "WXYZ"], ["*", ""], ["0", "+"], ["#", ""],
];

const CSS = `
.lp-root{position:relative;min-height:100vh;background:#0a0d10;color:#e9f0f2;font-family:'Space Grotesk',Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;overflow-x:hidden}
.lp-root a{color:#6ff2ae;text-decoration:none}
.lp-root a:hover{color:#a9f8cf}
.lp-root ::selection{background:rgba(111,242,174,.25)}
.lp-root summary::-webkit-details-marker{display:none}
.lp-navlink{color:rgba(148,162,172,.95)}
.lp-navlink:hover{color:#e9f0f2}
.lp-dock{transition:transform .3s}
.lp-dock:hover{transform:scale(1.05)}
.lp-cta{transition:all .3s}
.lp-cta:hover{transform:translateY(-3px);box-shadow:0 0 56px rgba(111,242,174,.55)!important;color:#06120b}
.lp-ghost{transition:all .3s}
.lp-ghost:hover{border-color:rgba(233,240,242,.5)!important;color:#e9f0f2}
.lp-key{transition:all .15s;cursor:pointer}
.lp-key:hover{background:rgba(255,255,255,.09)!important;border-color:rgba(111,242,174,.35)!important}
.lp-key:active{transform:scale(.93);background:rgba(111,242,174,.15)!important}
.lp-card{transition:all .35s}
.lp-card:hover{border-color:rgba(111,242,174,.35)!important;transform:translateY(-5px)}
.lp-card2{transition:all .35s}
.lp-card2:hover{border-color:rgba(111,242,174,.3)!important;transform:translateY(-5px)}
.lp-faq summary:hover{color:#6ff2ae}
.lp-footlink{color:rgba(148,162,172,.85)}
.lp-footlink:hover{color:#e9f0f2}
@keyframes lpRiseIn{from{opacity:0;transform:translateY(30px)}to{opacity:1;transform:translateY(0)}}
@keyframes lpBlink{0%,100%{opacity:1}50%{opacity:.12}}
@keyframes lpMarquee{from{transform:translateX(0)}to{transform:translateX(-50%)}}
@keyframes lpEq{0%,100%{transform:scaleY(.3)}50%{transform:scaleY(1)}}
@keyframes lpDots{0%,60%,100%{opacity:.2}30%{opacity:1}}
@keyframes lpDash{to{background-position:24px 0}}
@keyframes lpPing{0%{transform:scale(1);opacity:.7}100%{transform:scale(2.1);opacity:0}}
@keyframes lpPk{0%{left:0%;opacity:0}12%{opacity:1}88%{opacity:1}100%{left:94%;opacity:0}}
@keyframes lpPkr{0%{left:94%;opacity:0}12%{opacity:1}88%{opacity:1}100%{left:0%;opacity:0}}
@keyframes lpFloat3d{0%{transform:perspective(900px) rotateX(2.5deg) rotateY(-3deg)}100%{transform:perspective(900px) rotateX(-1.5deg) rotateY(3deg)}}
@keyframes lpTch{0%,3%{opacity:0}7%,80%{opacity:1}88%,100%{opacity:0}}
@keyframes lpCaretB{0%,49%{opacity:1}50%,100%{opacity:0}}
@keyframes lpDgt{0%{opacity:0;transform:translateY(8px) scale(.85)}6%{opacity:1;transform:none}82%{opacity:1}92%,100%{opacity:0}}
@keyframes lpKpress{0%,100%{background:rgba(255,255,255,.045);color:#94a2ac;box-shadow:none}4%{background:rgba(111,242,174,.32);color:#ecfff5;box-shadow:0 0 12px rgba(111,242,174,.55)}11%{background:rgba(255,255,255,.045);color:#94a2ac;box-shadow:none}}
@keyframes lpCallPulse{0%,38%{transform:none;box-shadow:0 0 0 0 rgba(111,242,174,0)}45%{transform:scale(1.16);box-shadow:0 0 0 7px rgba(111,242,174,.22),0 0 20px rgba(111,242,174,.6)}55%,100%{transform:none;box-shadow:0 0 10px rgba(111,242,174,.3)}}
@keyframes lpSpkA{0%,44%{box-shadow:0 0 0 2px rgba(111,242,174,.7),0 0 24px rgba(111,242,174,.22)}50%,94%{box-shadow:0 0 0 1px rgba(233,240,242,.09)}100%{box-shadow:0 0 0 2px rgba(111,242,174,.7),0 0 24px rgba(111,242,174,.22)}}
@keyframes lpSpkO{0%,44%{opacity:1}50%,94%{opacity:.15}100%{opacity:1}}
@keyframes lpBub{0%{opacity:0;transform:translateY(10px) scale(.92)}5%{opacity:1;transform:none}86%{opacity:1}94%,100%{opacity:0}}
@keyframes lpGlowP{0%,100%{box-shadow:0 0 12px rgba(111,242,174,.25)}50%{box-shadow:0 0 26px rgba(111,242,174,.6)}}
@keyframes lpSpin{to{transform:rotate(360deg)}}
@keyframes lpLockPop{0%{transform:translate(-50%,-50%) scale(.7)}60%{transform:translate(-50%,-50%) scale(1.25)}100%{transform:translate(-50%,-50%) scale(1)}}
@keyframes lpKb1{0%{transform:scale(1.07) translate(-1.4%,-1%)}100%{transform:scale(1.14) translate(1.4%,1.2%)}}
@keyframes lpKb2{0%{transform:scale(1.13) translate(1.2%,.9%)}100%{transform:scale(1.06) translate(-1.2%,-1%)}}
@keyframes lpKb3{0%{transform:scale(1.06) translate(.9%,1.3%)}100%{transform:scale(1.13) translate(-1%,-1.2%)}}
@keyframes lpSpkA2{0%,21%{box-shadow:0 0 0 2px rgba(111,242,174,.7),0 0 24px rgba(111,242,174,.25)}27%,96%{box-shadow:0 0 0 1px rgba(233,240,242,.09)}100%{box-shadow:0 0 0 2px rgba(111,242,174,.7),0 0 24px rgba(111,242,174,.25)}}
@keyframes lpSpkO2{0%,21%{opacity:1}27%,96%{opacity:.12}100%{opacity:1}}
@media (max-width:760px){
  .lp-navlinks{display:none}
  .lp-hero{padding:120px 22px 70px!important}
  .lp-section{padding-left:22px!important;padding-right:22px!important}
}
@media (prefers-reduced-motion: reduce){
  .lp-root *{animation:none!important}
}
`;

/** Per-tile Ken-Burns/speaking specs for the 10-person group grid. */
const GC = [
  { n: "LINA · HOST", kb: "lpKb1 12s ease-in-out -2s infinite alternate", spk: "lpSpkA2 20s infinite", eq: "lpSpkO2 20s infinite" },
  { n: "OMAR", kb: "lpKb2 14s ease-in-out -5s infinite alternate" },
  { n: "SARA", kb: "lpKb3 11s ease-in-out -1s infinite alternate" },
  { n: "MAYA", kb: "lpKb2 13s ease-in-out -7s infinite alternate", spk: "lpSpkA2 20s -15s infinite", eq: "lpSpkO2 20s -15s infinite" },
  { n: "ADAM", kb: "lpKb1 15s ease-in-out -4s infinite alternate" },
  { n: "NORA", kb: "lpKb3 12s ease-in-out -6s infinite alternate" },
  { n: "ZAIN", kb: "lpKb2 11s ease-in-out -3s infinite alternate", muted: true },
  { n: "DANA", kb: "lpKb1 13s ease-in-out -8s infinite alternate", muted: true },
  { n: "KARIM", kb: "lpKb3 14s ease-in-out -2s infinite alternate", spk: "lpSpkA2 20s -10s infinite", eq: "lpSpkO2 20s -10s infinite" },
  { n: "HALA", kb: "lpKb2 12s ease-in-out -5s infinite alternate", spk: "lpSpkA2 20s -5s infinite", eq: "lpSpkO2 20s -5s infinite" },
];

const MUTE_SVG = `<span style="position:absolute;right:8px;bottom:7px;width:16px;height:16px;border-radius:50%;background:rgba(255,93,93,.15);border:1px solid rgba(255,93,93,.45);display:flex;align-items:center;justify-content:center"><svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#ff5d5d" stroke-width="2.4" stroke-linecap="round"><rect x="9" y="2" width="6" height="12" rx="3"></rect><path d="M2 2l20 20"></path></svg></span>`;
const eqBars = (anim: string, w = 2.5, h = 10) =>
  `<span style="position:absolute;right:8px;bottom:8px;display:flex;align-items:flex-end;gap:2px;height:${h}px;animation:${anim}"><span style="width:${w}px;height:5px;border-radius:2px;background:#6ff2ae;transform-origin:bottom;animation:lpEq 1.1s ease-in-out infinite"></span><span style="width:${w}px;height:9px;border-radius:2px;background:#6ff2ae;transform-origin:bottom;animation:lpEq 1.1s ease-in-out .18s infinite"></span><span style="width:${w}px;height:7px;border-radius:2px;background:#6ff2ae;transform-origin:bottom;animation:lpEq 1.1s ease-in-out .36s infinite"></span></span>`;

function groupTiles(): string {
  return GC.map((g, i) => {
    const anim = g.spk ? `;animation:${g.spk}` : "";
    return `<div style="position:relative;border-radius:12px;overflow:hidden;background:linear-gradient(150deg,#101820,#0b1016);border:1px solid rgba(233,240,242,.08);aspect-ratio:4/3${anim}"><img src="${P[i]}" alt="${g.n}" loading="lazy" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;animation:${g.kb}"><span style="position:absolute;left:8px;bottom:7px;padding:3px 8px;border-radius:999px;background:rgba(10,13,16,.7);font:500 8px 'IBM Plex Mono',monospace;letter-spacing:.12em;color:#e9f0f2">${g.n}</span>${g.muted ? MUTE_SVG : g.eq ? eqBars(g.eq) : ""}</div>`;
  }).join("");
}

function keypad(): string {
  return KEYS.map(
    ([d, sub]) =>
      `<button type="button" class="lp-key" data-lp-key="${d}" style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;height:54px;border-radius:14px;background:rgba(255,255,255,.045);border:1px solid rgba(233,240,242,.09)"><span style="font:500 19px 'IBM Plex Mono',monospace;color:#e9f0f2;pointer-events:none">${d}</span><span style="font:500 8px 'IBM Plex Mono',monospace;letter-spacing:.2em;color:rgba(148,162,172,.65);min-height:9px;pointer-events:none">${sub}</span></button>`,
  ).join("");
}

const chromeBar = (host: string, label = "") =>
  `<div style="display:flex;align-items:center;gap:5px;padding:8px 12px;border-bottom:1px solid rgba(233,240,242,.07)"><span style="width:7px;height:7px;border-radius:50%;background:rgba(233,240,242,.18);display:block"></span><span style="width:7px;height:7px;border-radius:50%;background:rgba(233,240,242,.18);display:block"></span><span style="width:7px;height:7px;border-radius:50%;background:rgba(233,240,242,.18);display:block"></span><span style="margin-left:8px;font:400 9px 'IBM Plex Mono',monospace;letter-spacing:.12em;color:rgba(148,162,172,.6)">${host}${label}</span></div>`;

/** LIVE NETWORK stats strip (carried over from the previous landing). Values
 *  are written imperatively from the trpc.stats.public query. */
function statsStrip(): string {
  const tile = (key: string, label: string, extra = "") =>
    `<div style="flex:1 1 180px;min-width:150px;text-align:center"><div style="display:flex;align-items:center;justify-content:center;gap:8px"><span data-lp="stat-${key}" style="font:700 clamp(26px,3.4vw,40px) 'Space Grotesk',sans-serif;color:#e9f0f2">—</span>${extra}</div><div style="margin-top:6px;font:500 9px 'IBM Plex Mono',monospace;letter-spacing:.26em;color:rgba(148,162,172,.75)">${label}</div></div>`;
  return `
  <section class="lp-section" data-screen-label="Live stats" style="padding:56px 40px 8px">
    <div style="max-width:1140px;margin:0 auto">
      <div style="display:flex;align-items:center;gap:16px;margin-bottom:26px"><span data-scramble="1" style="font:500 11px 'IBM Plex Mono',monospace;letter-spacing:.28em;color:#6ff2ae">LIVE NETWORK — REAL NUMBERS</span><span style="flex:1;height:1px;background:linear-gradient(90deg,rgba(111,242,174,.35),transparent)"></span></div>
      <div style="display:flex;flex-wrap:wrap;gap:26px;border:1px solid rgba(233,240,242,.09);border-radius:20px;background:rgba(255,255,255,.025);padding:30px 24px">
        ${tile("users", "REGISTERED USERS")}
        ${tile("guests", "GUESTS SERVED")}
        ${tile("parties", "CALL PARTIES")}
        ${tile("online", "ONLINE NOW", `<span style="width:8px;height:8px;border-radius:50%;background:#6ff2ae;box-shadow:0 0 12px rgba(111,242,174,.9);animation:lpBlink 1.6s infinite;display:block"></span>`)}
      </div>
    </div>
  </section>`;
}

function markup(host: string): string {
  const mq = `PEER-TO-PEER ✦ NO ACCOUNTS ✦ NO INSTALLS ✦ FREE FOREVER ✦ ENCRYPTED IN TRANSIT ✦ BROWSER-NATIVE ✦ 6-DIGIT NUMBERS ✦ PEER-TO-PEER ✦ NO ACCOUNTS ✦ NO INSTALLS ✦ FREE FOREVER ✦`;
  const step = (n: string, title: string, body: string, demo: string) =>
    `<div data-reveal="${n === "01" ? 1 : n === "02" ? 2 : 3}"><div class="lp-card" style="background:rgba(255,255,255,.035);border:1px solid rgba(233,240,242,.09);border-radius:20px;padding:34px;min-height:220px;box-sizing:border-box"><div style="display:flex;align-items:center;gap:16px"><span style="font:600 13px 'IBM Plex Mono',monospace;letter-spacing:.2em;color:#6ff2ae">STEP ${n}</span><span style="flex:1;height:1px;background:linear-gradient(90deg,rgba(111,242,174,.45),transparent)"></span></div><h3 data-scramble="1" style="margin:22px 0 12px;font:600 22px 'Space Grotesk',sans-serif">${title}</h3><p style="margin:0;font:400 15px/1.65 'Space Grotesk',sans-serif;color:#94a2ac">${body}</p><div style="margin-top:22px;border:1px solid rgba(233,240,242,.1);border-radius:12px;overflow:hidden;background:rgba(10,13,16,.6)">${chromeBar(host)}<div style="height:170px;overflow:hidden;position:relative;background:radial-gradient(130% 110% at 50% 0%,#0f171b,#0a0d10);display:flex;align-items:center;justify-content:center">${demo}</div></div></div></div>`;

  const feat = (icon: string, title: string, body: string, reveal: number) =>
    `<div data-reveal="${reveal}"><div class="lp-card" style="background:rgba(255,255,255,.035);border:1px solid rgba(233,240,242,.09);border-radius:20px;padding:32px;min-height:210px;box-sizing:border-box"><div style="height:40px;display:flex;align-items:center">${icon}</div><h3 data-scramble="1" style="margin:20px 0 10px;font:600 21px 'Space Grotesk',sans-serif">${title}</h3><p style="margin:0;font:400 15px/1.6 'Space Grotesk',sans-serif;color:#94a2ac">${body}</p></div></div>`;
  const feat2 = (num: string, title: string, body: string, reveal: number) =>
    `<div data-reveal="${reveal}"><div class="lp-card2" style="background:rgba(255,255,255,.02);border:1px solid rgba(233,240,242,.09);border-radius:20px;padding:32px;min-height:170px;box-sizing:border-box"><div data-scramble="1" style="font:500 11px 'IBM Plex Mono',monospace;letter-spacing:.24em;color:rgba(111,242,174,.7)">[ ${num} ]</div><h3 data-scramble="1" style="margin:18px 0 10px;font:600 19px 'Space Grotesk',sans-serif">${title}</h3><p style="margin:0;font:400 14px/1.6 'Space Grotesk',sans-serif;color:#94a2ac">${body}</p></div></div>`;
  const faq = (q: string, a: string) =>
    `<details style="border-bottom:1px solid rgba(233,240,242,.1)"><summary style="display:flex;justify-content:space-between;align-items:center;gap:24px;padding:24px 0;cursor:pointer;list-style:none;font:500 18px 'Space Grotesk',sans-serif">${q}<span style="font:400 22px 'IBM Plex Mono',monospace;color:#6ff2ae">+</span></summary><p style="margin:0;padding:0 0 26px;font:400 15px/1.7 'Space Grotesk',sans-serif;color:#94a2ac;max-width:640px">${a}</p></details>`;

  return `
<div data-lp="root" id="top" style="position:relative;min-height:100vh">
<div data-lp="hue" style="position:fixed;inset:0;z-index:0;pointer-events:none"></div>
<canvas data-lp="matrix" style="position:fixed;inset:0;width:100vw;height:100vh;display:block;z-index:0;pointer-events:none;opacity:.75"></canvas>
<canvas data-lp="canvas" style="position:fixed;inset:0;width:100vw;height:100vh;display:block;z-index:0;pointer-events:none"></canvas>
<div data-lp="spot" style="position:fixed;top:0;left:0;width:900px;height:900px;z-index:1;pointer-events:none;background:radial-gradient(circle 340px at center,rgba(111,242,174,.06),transparent 70%);mix-blend-mode:screen;transform:translate3d(-450px,-450px,0)"></div>

<div data-lp="loader" style="position:fixed;inset:0;z-index:100;background:#0a0d10;display:flex;align-items:center;justify-content:center;opacity:1;transition:opacity .6s ease">
  <div style="width:min(440px,84vw);display:flex;flex-direction:column;align-items:center;gap:38px">
    <div style="display:flex;align-items:center;gap:10px"><span style="width:8px;height:8px;border-radius:50%;background:#6ff2ae;box-shadow:0 0 12px rgba(111,242,174,.9);animation:lpBlink 1.4s infinite"></span><span style="font:700 16px 'Space Grotesk',sans-serif;letter-spacing:.24em;color:#e9f0f2">RELAY</span></div>
    <div style="width:100%">
      <div style="text-align:center;font:500 9px 'IBM Plex Mono',monospace;letter-spacing:.3em;color:#6ff2ae;margin-bottom:8px">DTLS-SRTP · END-TO-END HANDSHAKE</div>
      <div style="text-align:center;font:400 10px 'IBM Plex Mono',monospace;letter-spacing:.08em;color:rgba(148,162,172,.75);margin-bottom:22px">the same encryption standard that armors bank traffic — applied to your voice</div>
      <div style="display:flex;align-items:center;gap:14px">
        <span style="position:relative;flex:none;width:60px;height:60px;border-radius:50%;border:1px solid rgba(111,242,174,.6);background:rgba(111,242,174,.07);display:flex;align-items:center;justify-content:center;font:600 10px 'IBM Plex Mono',monospace;letter-spacing:.14em;color:#e9f0f2">YOU<span style="position:absolute;inset:0;border-radius:50%;border:1px solid rgba(111,242,174,.5);animation:lpPing 2s ease-out infinite"></span></span>
        <span style="position:relative;flex:1;height:16px;display:block">
          <span style="position:absolute;left:0;right:0;top:7px;height:2px;background-image:repeating-linear-gradient(90deg,rgba(111,242,174,.55) 0 8px,transparent 8px 20px);background-size:20px 2px;animation:lpDash 1s linear infinite;display:block"></span>
          <span style="position:absolute;top:0;left:0;font:600 11px 'IBM Plex Mono',monospace;color:#6ff2ae;animation:lpPk 1.5s linear infinite;display:block">1</span>
          <span style="position:absolute;top:0;left:0;font:600 11px 'IBM Plex Mono',monospace;color:#6ff2ae;animation:lpPk 1.5s linear .5s infinite;display:block">0</span>
          <span style="position:absolute;top:0;left:0;font:600 11px 'IBM Plex Mono',monospace;color:rgba(111,242,174,.7);animation:lpPkr 1.9s linear .3s infinite;display:block">1</span>
          <span data-lp="lock" style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:30px;height:30px;border-radius:50%;background:#0a0d10;border:1px solid rgba(148,162,172,.45);display:flex;align-items:center;justify-content:center;z-index:2">
            <span style="position:absolute;inset:-5px;border-radius:50%;border:1px dashed rgba(111,242,174,.45);animation:lpSpin 4s linear infinite;display:block"></span>
            <span data-lp="lockOpen" style="display:flex;color:#94a2ac"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="10" rx="2"></rect><path d="M7 11V7a5 5 0 0 1 9.9-1"></path></svg></span>
            <span data-lp="lockClosed" style="display:none;color:#6ff2ae"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="10" rx="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg></span>
          </span>
        </span>
        <span data-lp="nodeB" style="position:relative;flex:none;width:60px;height:60px;border-radius:50%;border:1px solid rgba(111,242,174,.6);background:rgba(111,242,174,.07);display:flex;align-items:center;justify-content:center;font:600 10px 'IBM Plex Mono',monospace;letter-spacing:.1em;color:#e9f0f2;text-align:center">THEM<span style="position:absolute;inset:0;border-radius:50%;border:1px solid rgba(111,242,174,.5);animation:lpPing 2s ease-out 1s infinite;display:block"></span></span>
      </div>
    </div>
    <div style="width:100%">
      <div style="width:100%;height:3px;border-radius:3px;background:rgba(233,240,242,.08);overflow:hidden"><div data-lp="loadBar" style="width:0%;height:100%;border-radius:3px;background:#6ff2ae;box-shadow:0 0 14px rgba(111,242,174,.8)"></div></div>
      <div style="display:flex;justify-content:space-between;margin-top:12px"><span data-lp="loadMsg" style="font:500 10px 'IBM Plex Mono',monospace;letter-spacing:.22em;color:#6ff2ae">WAKING THE NETWORK…</span><span data-lp="loadPct" style="font:500 10px 'IBM Plex Mono',monospace;letter-spacing:.18em;color:rgba(148,162,172,.8)">0%</span></div>
      <div data-lp="loadSub" style="margin-top:9px;font:400 11px/1.5 'Space Grotesk',sans-serif;color:rgba(148,162,172,.85);min-height:17px">Spinning up a direct line between your browsers…</div>
    </div>
  </div>
</div>

<nav data-lp="nav" style="position:fixed;top:0;left:0;right:0;z-index:10;display:flex;align-items:center;justify-content:space-between;gap:24px;padding:16px 40px;background:rgba(10,13,16,.45);backdrop-filter:blur(18px) saturate(1.5);-webkit-backdrop-filter:blur(18px) saturate(1.5);border-bottom:1px solid rgba(111,242,174,.18);box-shadow:0 8px 40px rgba(0,0,0,.25), inset 0 1px 0 rgba(255,255,255,.06)">
  <a href="#top" style="display:flex;align-items:center;gap:10px;color:#e9f0f2"><span data-lp="dockDot" style="width:8px;height:8px;border-radius:50%;background:#6ff2ae;box-shadow:0 0 12px rgba(111,242,174,.9);display:block"></span><span style="font:700 17px 'Space Grotesk',sans-serif;letter-spacing:.22em">RELAY</span></a>
  <div class="lp-navlinks" style="display:flex;align-items:center;gap:28px;font:500 11px 'IBM Plex Mono',monospace;letter-spacing:.18em">
    <a class="lp-navlink" href="#how">HOW IT WORKS</a>
    <a class="lp-navlink" href="#features">FEATURES</a>
    <a class="lp-navlink" href="#privacy">PRIVACY</a>
    <a class="lp-navlink" href="#faq">FAQ</a>
  </div>
  <a data-lp="dock" class="lp-dock" href="/app" style="font:600 11px 'IBM Plex Mono',monospace;letter-spacing:.16em;color:#6ff2ae;border:1px solid rgba(111,242,174,.4);border-radius:999px;padding:10px 20px;background:rgba(111,242,174,.06);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px)">OPEN APP ↗</a>
</nav>

<main style="position:relative;z-index:2">
  <section class="lp-hero" data-screen-label="Hero" style="min-height:100vh;display:flex;align-items:center;padding:150px 40px 90px;box-sizing:border-box">
    <div style="max-width:1240px;margin:0 auto;display:flex;flex-wrap:wrap;gap:70px;align-items:center;justify-content:space-between;width:100%">
      <div style="flex:1 1 520px;min-width:320px">
        <div style="display:flex;align-items:center;gap:10px;font:500 11px 'IBM Plex Mono',monospace;letter-spacing:.24em;color:#6ff2ae;animation:lpRiseIn .9s cubic-bezier(.22,1,.36,1) both"><span style="width:6px;height:6px;border-radius:50%;background:#6ff2ae;animation:lpBlink 1.6s infinite"></span><span data-scramble="1">LIVE — PEER-TO-PEER CALLS IN YOUR BROWSER</span></div>
        <h1 style="margin:26px 0 0;font:700 clamp(48px,7vw,94px)/0.99 'Space Grotesk',sans-serif;letter-spacing:-.025em">
          <span style="display:block;animation:lpRiseIn .9s cubic-bezier(.22,1,.36,1) .08s both" data-scramble="1">Pick a name.</span>
          <span style="display:block;animation:lpRiseIn .9s cubic-bezier(.22,1,.36,1) .18s both" data-scramble="1">Get a number.</span>
          <span style="display:block;color:#6ff2ae;text-shadow:0 0 44px rgba(111,242,174,.35);animation:lpRiseIn .9s cubic-bezier(.22,1,.36,1) .28s both" data-scramble="1">Dial anyone.</span>
        </h1>
        <p style="margin:28px 0 0;max-width:470px;font:400 17px/1.65 'Space Grotesk',sans-serif;color:#94a2ac;animation:lpRiseIn .9s cubic-bezier(.22,1,.36,1) .4s both">RELAY is free voice, video and chat that runs entirely in your browser. No installs. No accounts. No servers in the middle of your call.</p>
        <div style="display:flex;flex-wrap:wrap;gap:16px;margin-top:38px;animation:lpRiseIn .9s cubic-bezier(.22,1,.36,1) .5s both">
          <a class="lp-cta" href="/app" style="background:#6ff2ae;color:#06120b;font:600 16px 'Space Grotesk',sans-serif;padding:16px 30px;border-radius:999px;box-shadow:0 0 36px rgba(111,242,174,.35)">Launch RELAY →</a>
          <a class="lp-ghost" href="#how" style="color:#e9f0f2;font:500 16px 'Space Grotesk',sans-serif;padding:16px 28px;border-radius:999px;border:1px solid rgba(233,240,242,.18)">How it works</a>
        </div>
        <div style="margin-top:34px;font:400 10px 'IBM Plex Mono',monospace;letter-spacing:.26em;color:rgba(148,162,172,.6);animation:lpRiseIn .9s cubic-bezier(.22,1,.36,1) .6s both">WORKS IN CHROME · SAFARI · FIREFOX · EDGE</div>
      </div>
      <div style="flex:0 1 375px;min-width:320px;animation:lpRiseIn 1s cubic-bezier(.22,1,.36,1) .55s both">
        <div data-lp="padTilt" style="background:rgba(255,255,255,.035);border:1px solid rgba(233,240,242,.1);border-radius:26px;padding:26px;backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);box-shadow:0 30px 80px rgba(0,0,0,.5);transition:transform .25s ease-out;transform:perspective(900px)">
          <div style="display:flex;align-items:center;justify-content:space-between;font:500 10px 'IBM Plex Mono',monospace;letter-spacing:.22em"><span style="color:rgba(148,162,172,.9)">RELAY DIALER</span><span style="display:flex;align-items:center;gap:6px;color:#6ff2ae"><span style="width:5px;height:5px;border-radius:50%;background:#6ff2ae;animation:lpBlink 1.6s infinite"></span>ONLINE</span></div>
          <div data-lp="dialDisplay" style="margin:22px 0 8px;text-align:center;font:500 30px 'IBM Plex Mono',monospace;letter-spacing:.28em;color:#e9f0f2;min-height:38px">· · · · · ·</div>
          <div data-lp="dialStatus" style="text-align:center;font:400 10px 'IBM Plex Mono',monospace;letter-spacing:.22em;color:rgba(148,162,172,.9);margin-bottom:20px">ENTER ANY 6-DIGIT NUMBER</div>
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px">${keypad()}</div>
          <a data-lp="callBtn" href="/app" style="display:block;margin-top:14px;text-align:center;padding:15px;border-radius:14px;background:rgba(111,242,174,.12);border:1px solid rgba(111,242,174,.35);color:#6ff2ae;font:600 12px 'IBM Plex Mono',monospace;letter-spacing:.22em;opacity:.4;pointer-events:none;transition:all .3s">CALL</a>
          <div style="display:flex;justify-content:space-between;margin-top:14px;font:400 10px 'IBM Plex Mono',monospace;letter-spacing:.16em">
            <button type="button" data-lp="clearBtn" style="background:none;border:none;cursor:pointer;color:rgba(148,162,172,.7);font:inherit;letter-spacing:inherit;padding:0">CLEAR</button>
            <button type="button" data-lp="demoBtn" style="background:none;border:none;cursor:pointer;color:rgba(111,242,174,.8);font:inherit;letter-spacing:inherit;padding:0;border-bottom:1px dotted rgba(111,242,174,.5)">DIAL A DEMO NUMBER</button>
          </div>
        </div>
      </div>
    </div>
  </section>

  <div style="border-top:1px solid rgba(233,240,242,.08);border-bottom:1px solid rgba(233,240,242,.08);padding:13px 0;overflow:hidden;background:rgba(10,13,16,.4)">
    <div style="display:flex;width:max-content;animation:lpMarquee 30s linear infinite">
      <span style="white-space:nowrap;padding-right:56px;font:500 11px 'IBM Plex Mono',monospace;letter-spacing:.3em;color:rgba(148,162,172,.75)">${mq}</span>
      <span style="white-space:nowrap;padding-right:56px;font:500 11px 'IBM Plex Mono',monospace;letter-spacing:.3em;color:rgba(148,162,172,.75)">${mq}</span>
    </div>
  </div>

  ${statsStrip()}

  <section id="how" class="lp-section" data-screen-label="How it works" style="padding:150px 40px 120px">
    <div style="max-width:1140px;margin:0 auto">
      <div data-reveal="0" data-scramble="1" style="font:500 11px 'IBM Plex Mono',monospace;letter-spacing:.28em;color:#6ff2ae">01 — HOW IT WORKS</div>
      <h2 data-reveal="1" data-scramble="1" style="margin:18px 0 0;font:700 clamp(34px,4.4vw,58px)/1.05 'Space Grotesk',sans-serif;letter-spacing:-.02em;max-width:640px">On a call in less time than a signup form.</h2>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:26px;margin-top:64px">
        ${step("01", "Pick a name", "No signup, no email, no password. Type whatever you want to be called today and you're on the network.", `<div style="animation:lpFloat3d 7s ease-in-out infinite alternate;display:flex;flex-direction:column;align-items:center;gap:11px"><div style="font:500 8px 'IBM Plex Mono',monospace;letter-spacing:.28em;color:rgba(111,242,174,.75)">CHOOSE A NAME</div><div style="display:flex;align-items:center;padding:9px 18px;border:1px solid rgba(111,242,174,.35);border-radius:10px;background:rgba(255,255,255,.03);box-shadow:0 0 24px rgba(111,242,174,.1);font:600 17px 'IBM Plex Mono',monospace;color:#e9f0f2"><span style="opacity:0;animation:lpTch 6s infinite .2s">S</span><span style="opacity:0;animation:lpTch 6s infinite .5s">a</span><span style="opacity:0;animation:lpTch 6s infinite .8s">r</span><span style="opacity:0;animation:lpTch 6s infinite 1.1s">a</span><span style="width:2px;height:16px;margin-left:3px;background:#6ff2ae;animation:lpCaretB 1s steps(1) infinite;display:block"></span></div><div style="font:600 9px 'IBM Plex Mono',monospace;letter-spacing:.22em;color:#0a0d10;background:#6ff2ae;padding:7px 16px;border-radius:999px;animation:lpGlowP 3s ease-in-out infinite">ENTER RELAY →</div></div><span style="position:absolute;left:10px;bottom:9px;display:flex;align-items:center;gap:6px;font:500 8px 'IBM Plex Mono',monospace;letter-spacing:.22em;color:rgba(111,242,174,.85)"><span style="width:5px;height:5px;border-radius:50%;background:#6ff2ae;box-shadow:0 0 8px rgba(111,242,174,.9);display:block"></span>GUEST MODE</span>`)}
        ${step("02", "Get your number", "You're handed a 6-digit RELAY number instantly — short enough to read out loud, easy enough to remember.", `<div style="animation:lpFloat3d 7s ease-in-out infinite alternate reverse;display:flex;flex-direction:column;align-items:center;gap:12px"><div style="font:500 8px 'IBM Plex Mono',monospace;letter-spacing:.28em;color:rgba(111,242,174,.75)">YOUR RELAY NUMBER</div><div style="display:flex;gap:6px;font:700 32px 'IBM Plex Mono',monospace;color:#6ff2ae;text-shadow:0 0 22px rgba(111,242,174,.55)"><span style="opacity:0;animation:lpDgt 5.5s infinite .2s">2</span><span style="opacity:0;animation:lpDgt 5.5s infinite .4s">3</span><span style="opacity:0;animation:lpDgt 5.5s infinite .6s">5</span><span style="opacity:0;animation:lpDgt 5.5s infinite .7s;color:rgba(111,242,174,.45)">-</span><span style="opacity:0;animation:lpDgt 5.5s infinite .8s">5</span><span style="opacity:0;animation:lpDgt 5.5s infinite 1s">3</span><span style="opacity:0;animation:lpDgt 5.5s infinite 1.2s">1</span></div><div style="display:flex;align-items:center;gap:7px;font:500 9px 'IBM Plex Mono',monospace;letter-spacing:.2em;color:#94a2ac;border:1px solid rgba(233,240,242,.15);border-radius:999px;padding:6px 14px"><span style="color:#6ff2ae">⤴</span>SHARE INVITE LINK</div></div><span style="position:absolute;left:10px;bottom:9px;display:flex;align-items:center;gap:6px;font:500 8px 'IBM Plex Mono',monospace;letter-spacing:.22em;color:rgba(111,242,174,.85)"><span style="width:5px;height:5px;border-radius:50%;background:#6ff2ae;box-shadow:0 0 8px rgba(111,242,174,.9);display:block"></span>YOUR NUMBER</span>`)}
        ${step("03", "Dial anyone", "Punch in a friend's number for voice, video or chat — straight from the browser, on any device.", `<div style="animation:lpFloat3d 8s ease-in-out infinite alternate;display:flex;align-items:center;gap:18px"><div style="display:grid;grid-template-columns:repeat(3,42px);gap:5px"><div style="border-radius:8px;background:rgba(255,255,255,.045);color:#94a2ac;font:600 11px 'IBM Plex Mono',monospace;text-align:center;padding:6px 0">1</div><div style="border-radius:8px;background:rgba(255,255,255,.045);color:#94a2ac;font:600 11px 'IBM Plex Mono',monospace;text-align:center;padding:6px 0;animation:lpKpress 6s infinite .3s">2</div><div style="border-radius:8px;background:rgba(255,255,255,.045);color:#94a2ac;font:600 11px 'IBM Plex Mono',monospace;text-align:center;padding:6px 0;animation:lpKpress 6s infinite .8s">3</div><div style="border-radius:8px;background:rgba(255,255,255,.045);color:#94a2ac;font:600 11px 'IBM Plex Mono',monospace;text-align:center;padding:6px 0">4</div><div style="border-radius:8px;background:rgba(255,255,255,.045);color:#94a2ac;font:600 11px 'IBM Plex Mono',monospace;text-align:center;padding:6px 0;animation:lpKpress 6s infinite 1.3s">5</div><div style="border-radius:8px;background:rgba(255,255,255,.045);color:#94a2ac;font:600 11px 'IBM Plex Mono',monospace;text-align:center;padding:6px 0">6</div><div style="border-radius:8px;background:rgba(255,255,255,.045);color:#94a2ac;font:600 11px 'IBM Plex Mono',monospace;text-align:center;padding:6px 0">7</div><div style="border-radius:8px;background:rgba(255,255,255,.045);color:#94a2ac;font:600 11px 'IBM Plex Mono',monospace;text-align:center;padding:6px 0">8</div><div style="border-radius:8px;background:rgba(255,255,255,.045);color:#94a2ac;font:600 11px 'IBM Plex Mono',monospace;text-align:center;padding:6px 0;animation:lpKpress 6s infinite 1.8s">9</div></div><div style="display:flex;flex-direction:column;align-items:center;gap:9px"><div style="font:700 15px 'IBM Plex Mono',monospace;color:#6ff2ae;text-shadow:0 0 14px rgba(111,242,174,.5)">235-91_</div><div style="width:38px;height:38px;border-radius:50%;background:#6ff2ae;display:flex;align-items:center;justify-content:center;animation:lpCallPulse 6s infinite"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#0a0d10" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3A19.5 19.5 0 0 1 5 12.7 19.8 19.8 0 0 1 2 4.1 2 2 0 0 1 4 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.9a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.2-1.2a2 2 0 0 1 2.1-.5c1 .3 2 .6 2.9.7a2 2 0 0 1 1.8 2z"></path></svg></div><div style="font:500 8px 'IBM Plex Mono',monospace;letter-spacing:.22em;color:#94a2ac">CALLING…</div></div></div><span style="position:absolute;left:10px;bottom:9px;display:flex;align-items:center;gap:6px;font:500 8px 'IBM Plex Mono',monospace;letter-spacing:.22em;color:rgba(111,242,174,.85)"><span style="width:5px;height:5px;border-radius:50%;background:#6ff2ae;box-shadow:0 0 8px rgba(111,242,174,.9);display:block"></span>DIAL PAD</span>`)}
      </div>
    </div>
  </section>

  <section id="features" class="lp-section" data-screen-label="Features" style="padding:120px 40px">
    <div style="max-width:1140px;margin:0 auto">
      <div data-reveal="0" data-scramble="1" style="font:500 11px 'IBM Plex Mono',monospace;letter-spacing:.28em;color:#6ff2ae">02 — FEATURES</div>
      <h2 data-reveal="1" data-scramble="1" style="margin:18px 0 0;font:700 clamp(34px,4.4vw,58px)/1.05 'Space Grotesk',sans-serif;letter-spacing:-.02em;max-width:700px">Everything a call needs. Nothing it doesn't.</h2>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:24px;margin-top:64px">
        ${feat(`<span style="display:flex;align-items:flex-end;gap:4px;height:40px"><span style="width:4px;height:12px;border-radius:2px;background:#6ff2ae;transform-origin:bottom;animation:lpEq 1.1s ease-in-out infinite"></span><span style="width:4px;height:22px;border-radius:2px;background:#6ff2ae;transform-origin:bottom;animation:lpEq 1.1s ease-in-out .13s infinite"></span><span style="width:4px;height:32px;border-radius:2px;background:#6ff2ae;transform-origin:bottom;animation:lpEq 1.1s ease-in-out .26s infinite"></span><span style="width:4px;height:18px;border-radius:2px;background:#6ff2ae;transform-origin:bottom;animation:lpEq 1.1s ease-in-out .39s infinite"></span><span style="width:4px;height:9px;border-radius:2px;background:#6ff2ae;transform-origin:bottom;animation:lpEq 1.1s ease-in-out .52s infinite"></span></span>`, "Voice calls", "Low-latency audio that streams browser-to-browser — from your mic to their speakers, nothing in between.", 1)}
        ${feat(`<span style="position:relative;width:40px;height:27px;border:2px solid #6ff2ae;border-radius:7px;display:block"><span style="position:absolute;right:-13px;top:5px;width:10px;height:13px;background:#6ff2ae;clip-path:polygon(100% 0,0 50%,100% 100%);display:block"></span></span>`, "Video calls", "Face-to-face in one click. Crisp video that stays strictly between the people on the call.", 2)}
        ${feat(`<span style="width:40px;height:27px;border:2px solid #6ff2ae;border-radius:7px;display:flex;align-items:center;justify-content:center;gap:4px"><span style="width:4px;height:4px;border-radius:50%;background:#6ff2ae;animation:lpDots 1.3s infinite"></span><span style="width:4px;height:4px;border-radius:50%;background:#6ff2ae;animation:lpDots 1.3s .18s infinite"></span><span style="width:4px;height:4px;border-radius:50%;background:#6ff2ae;animation:lpDots 1.3s .36s infinite"></span></span>`, "Text chat", "A channel that runs alongside the call — paste links, drop notes, keep talking.", 3)}
        ${feat2("04", "No installs", "If it runs a browser, it runs RELAY. Desktop, laptop, phone, tablet.", 2)}
        ${feat2("05", "No accounts", "A display name is the only identity you need. Leave whenever you like.", 3)}
        ${feat2("06", "Free forever", "No plans, no meters, no premium tier. Calling is free, full stop.", 4)}
      </div>

      <div data-reveal="2" style="margin-top:60px">
        <div style="display:flex;align-items:center;gap:16px;margin-bottom:22px"><span data-scramble="1" style="font:500 11px 'IBM Plex Mono',monospace;letter-spacing:.28em;color:#6ff2ae">LIVE FROM THE APP</span><span style="flex:1;height:1px;background:linear-gradient(90deg,rgba(111,242,174,.35),transparent)"></span></div>
        <div style="border:1px solid rgba(233,240,242,.12);border-radius:20px;overflow:hidden;background:rgba(10,13,16,.65);box-shadow:0 30px 80px rgba(0,0,0,.5)">
          ${chromeBar(host, " — live call")}
          <div style="display:grid;grid-template-columns:2fr 1fr;gap:1px;background:rgba(233,240,242,.08);height:clamp(260px,42vw,480px)">
            <div style="position:relative;overflow:hidden;background:#0a0d10">
              <div style="position:absolute;inset:0;display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:12px 12px 68px">
                <div style="position:relative;border-radius:14px;background:linear-gradient(150deg,#123038,#0c1d28);animation:lpSpkA 8s infinite;display:flex;align-items:center;justify-content:center;overflow:hidden"><img src="${P[0]}" alt="Lina on video" loading="lazy" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;animation:lpKb1 12s ease-in-out -3s infinite alternate"><span style="position:absolute;left:10px;bottom:9px;padding:4px 10px;border-radius:999px;background:rgba(10,13,16,.65);font:500 9px 'IBM Plex Mono',monospace;letter-spacing:.14em;color:#e9f0f2">LINA · HOST</span><span style="position:absolute;right:10px;bottom:10px;display:flex;align-items:flex-end;gap:2px;height:12px;animation:lpSpkO 8s infinite"><span style="width:3px;height:6px;border-radius:2px;background:#6ff2ae;transform-origin:bottom;animation:lpEq 1.1s ease-in-out infinite"></span><span style="width:3px;height:11px;border-radius:2px;background:#6ff2ae;transform-origin:bottom;animation:lpEq 1.1s ease-in-out .18s infinite"></span><span style="width:3px;height:8px;border-radius:2px;background:#6ff2ae;transform-origin:bottom;animation:lpEq 1.1s ease-in-out .36s infinite"></span></span></div>
                <div style="position:relative;border-radius:14px;background:linear-gradient(150deg,#1a2040,#111830);animation:lpSpkA 8s 4s infinite;display:flex;align-items:center;justify-content:center;overflow:hidden"><img src="${P[1]}" alt="Omar on video" loading="lazy" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;animation:lpKb2 14s ease-in-out -6s infinite alternate"><span style="position:absolute;left:10px;bottom:9px;padding:4px 10px;border-radius:999px;background:rgba(10,13,16,.65);font:500 9px 'IBM Plex Mono',monospace;letter-spacing:.14em;color:#e9f0f2">OMAR</span><span style="position:absolute;right:10px;bottom:10px;display:flex;align-items:flex-end;gap:2px;height:12px;animation:lpSpkO 8s 4s infinite"><span style="width:3px;height:6px;border-radius:2px;background:#62d9ff;transform-origin:bottom;animation:lpEq 1.1s ease-in-out infinite"></span><span style="width:3px;height:11px;border-radius:2px;background:#62d9ff;transform-origin:bottom;animation:lpEq 1.1s ease-in-out .18s infinite"></span><span style="width:3px;height:8px;border-radius:2px;background:#62d9ff;transform-origin:bottom;animation:lpEq 1.1s ease-in-out .36s infinite"></span></span></div>
              </div>
              <div style="position:absolute;left:50%;bottom:14px;transform:translateX(-50%);display:flex;align-items:center;gap:9px;padding:9px 14px;border-radius:999px;background:rgba(14,19,23,.7);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border:1px solid rgba(233,240,242,.12)">
                <span style="width:28px;height:28px;border-radius:50%;background:rgba(255,255,255,.08);display:flex;align-items:center;justify-content:center;color:#cfe3da"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="2" width="6" height="12" rx="3"></rect><path d="M5 10v1a7 7 0 0 0 14 0v-1M12 18v4"></path></svg></span>
                <span style="width:28px;height:28px;border-radius:50%;background:rgba(255,255,255,.08);display:flex;align-items:center;justify-content:center;color:#cfe3da"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="13" height="12" rx="2"></rect><path d="M15 10l7-4v12l-7-4z"></path></svg></span>
                <span style="width:28px;height:28px;border-radius:50%;background:rgba(111,242,174,.16);border:1px solid rgba(111,242,174,.4);display:flex;align-items:center;justify-content:center;font:600 8px 'IBM Plex Mono',monospace;color:#6ff2ae">HD</span>
                <span style="width:28px;height:28px;border-radius:50%;background:rgba(255,255,255,.08);display:flex;align-items:center;justify-content:center;color:#cfe3da"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg></span>
                <span style="width:34px;height:28px;border-radius:999px;background:#ff5d5d;display:flex;align-items:center;justify-content:center;box-shadow:0 0 14px rgba(255,93,93,.45)"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" style="transform:rotate(135deg)"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3A19.5 19.5 0 0 1 5 12.7 19.8 19.8 0 0 1 2 4.1 2 2 0 0 1 4 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.9a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.2-1.2a2 2 0 0 1 2.1-.5c1 .3 2 .6 2.9.7a2 2 0 0 1 1.8 2z"></path></svg></span>
              </div>
              <span style="position:absolute;left:14px;top:12px;display:flex;align-items:center;gap:7px;padding:6px 12px;border-radius:999px;background:rgba(10,13,16,.6);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);border:1px solid rgba(111,242,174,.3);font:500 9px 'IBM Plex Mono',monospace;letter-spacing:.22em;color:#6ff2ae"><span style="width:6px;height:6px;border-radius:50%;background:#6ff2ae;animation:lpBlink 1.4s infinite;display:block"></span>LIVE · ENCRYPTED</span>
              <span style="position:absolute;right:14px;top:14px;font:500 9px 'IBM Plex Mono',monospace;letter-spacing:.16em;color:rgba(148,162,172,.7)">00:42</span>
            </div>
            <div style="position:relative;overflow:hidden;background:#0b0f13;display:flex;flex-direction:column">
              <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid rgba(233,240,242,.08)"><span style="font:500 9px 'IBM Plex Mono',monospace;letter-spacing:.24em;color:#94a2ac">MESSAGES</span><span style="display:flex;align-items:center;gap:5px;font:500 8px 'IBM Plex Mono',monospace;letter-spacing:.14em;color:rgba(111,242,174,.8)">LIVE</span></div>
              <div style="flex:1;display:flex;flex-direction:column;gap:8px;padding:12px 14px;overflow:hidden">
                <div style="align-self:flex-start;max-width:88%;padding:7px 11px;border-radius:12px 12px 12px 4px;background:rgba(255,255,255,.06);border:1px solid rgba(233,240,242,.08);font:400 11.5px 'Space Grotesk',sans-serif;color:#cfd9df;opacity:0;animation:lpBub 12s infinite .5s">You free for a call?</div>
                <div style="align-self:flex-end;max-width:88%;padding:7px 11px;border-radius:12px 12px 4px 12px;background:rgba(111,242,174,.12);border:1px solid rgba(111,242,174,.3);font:400 11.5px 'Space Grotesk',sans-serif;color:#dffcec;opacity:0;animation:lpBub 12s infinite 2s">Dialing you now — 235 531</div>
                <div style="align-self:flex-start;max-width:88%;border-radius:12px 12px 12px 4px;background:rgba(255,255,255,.06);border:1px solid rgba(233,240,242,.08);overflow:hidden;opacity:0;animation:lpBub 12s infinite 3.8s"><img src="${P[0]}" alt="shared photo" loading="lazy" style="width:130px;height:74px;object-fit:cover;display:block"><div style="padding:5px 10px;font:400 10.5px 'Space Grotesk',sans-serif;color:#cfd9df">say hi to the team 👋<span style="margin-left:6px;font:400 8px 'IBM Plex Mono',monospace;color:rgba(148,162,172,.6)">12:04</span></div></div>
                <div style="align-self:flex-start;padding:8px 12px;border-radius:12px 12px 12px 4px;background:rgba(255,255,255,.06);border:1px solid rgba(233,240,242,.08);display:flex;gap:4px;opacity:0;animation:lpBub 12s infinite 9.4s"><span style="width:5px;height:5px;border-radius:50%;background:#94a2ac;animation:lpBlink 1s infinite;display:block"></span><span style="width:5px;height:5px;border-radius:50%;background:#94a2ac;animation:lpBlink 1s .2s infinite;display:block"></span><span style="width:5px;height:5px;border-radius:50%;background:#94a2ac;animation:lpBlink 1s .4s infinite;display:block"></span></div>
              </div>
              <div style="margin:0 12px 12px;display:flex;align-items:center;gap:9px;padding:8px 13px;border-radius:999px;background:rgba(255,255,255,.045);border:1px solid rgba(233,240,242,.1)"><span style="font:400 10.5px 'Space Grotesk',sans-serif;color:rgba(148,162,172,.55)">Message…</span></div>
            </div>
          </div>
        </div>

        <div style="margin-top:28px;border:1px solid rgba(233,240,242,.12);border-radius:20px;overflow:hidden;background:rgba(10,13,16,.65);box-shadow:0 30px 80px rgba(0,0,0,.5)">
          ${chromeBar(host, " — group call · 10 people")}
          <div style="position:relative;background:#0a0d10">
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;padding:12px 12px 64px">${groupTiles()}</div>
            <span style="position:absolute;left:14px;top:12px;display:flex;align-items:center;gap:7px;padding:6px 12px;border-radius:999px;background:rgba(10,13,16,.6);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);border:1px solid rgba(111,242,174,.3);font:500 9px 'IBM Plex Mono',monospace;letter-spacing:.22em;color:#6ff2ae"><span style="width:6px;height:6px;border-radius:50%;background:#6ff2ae;animation:lpBlink 1.4s infinite;display:block"></span>GROUP CALL · 10 LIVE</span>
            <span style="position:absolute;right:14px;top:14px;font:500 9px 'IBM Plex Mono',monospace;letter-spacing:.16em;color:rgba(148,162,172,.7)">01:27</span>
            <div style="position:absolute;left:50%;bottom:14px;transform:translateX(-50%);display:flex;align-items:center;gap:10px;padding:9px 16px;border-radius:999px;background:rgba(14,19,23,.7);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border:1px solid rgba(233,240,242,.12);font:500 9px 'IBM Plex Mono',monospace;letter-spacing:.2em;color:#94a2ac"><span style="color:#6ff2ae">10</span> ON THE CALL</div>
          </div>
        </div>
      </div>
    </div>
  </section>

  <section id="privacy" class="lp-section" data-screen-label="Privacy" style="padding:120px 40px">
    <div style="max-width:1140px;margin:0 auto;display:flex;flex-wrap:wrap;gap:70px;align-items:center">
      <div style="flex:1 1 440px;min-width:320px">
        <div data-reveal="0" data-scramble="1" style="font:500 11px 'IBM Plex Mono',monospace;letter-spacing:.28em;color:#6ff2ae">03 — PRIVACY</div>
        <h2 data-reveal="1" data-scramble="1" style="margin:18px 0 0;font:700 clamp(34px,4.4vw,58px)/1.05 'Space Grotesk',sans-serif;letter-spacing:-.02em">Your call is nobody's business.</h2>
        <p data-reveal="2" style="margin:26px 0 0;font:400 16px/1.7 'Space Grotesk',sans-serif;color:#94a2ac;max-width:480px">RELAY is peer-to-peer. Voice and video stream directly between browsers over WebRTC, encrypted in transit with DTLS-SRTP.</p>
        <p data-reveal="3" style="margin:18px 0 0;font:400 16px/1.7 'Space Grotesk',sans-serif;color:#94a2ac;max-width:480px">Our server does one job: introductions. It helps two browsers find each other, then steps out of the way. Your media never passes through it.</p>
        <div data-reveal="4" style="margin-top:30px;display:flex;flex-direction:column;gap:12px;font:500 12px 'IBM Plex Mono',monospace;letter-spacing:.14em;color:rgba(233,240,242,.85)">
          <span><span style="color:#6ff2ae">—</span> NO CALL RECORDING, EVER</span>
          <span><span style="color:#6ff2ae">—</span> NO ACCOUNT DATABASE</span>
          <span><span style="color:#6ff2ae">—</span> NOTHING STORED, NOTHING TO BREACH</span>
        </div>
      </div>
      <div data-reveal="2" style="flex:1 1 420px;min-width:320px">
        <div style="background:rgba(255,255,255,.03);border:1px solid rgba(233,240,242,.09);border-radius:24px;padding:48px 40px;box-sizing:border-box">
          <div style="text-align:center;font:500 10px 'IBM Plex Mono',monospace;letter-spacing:.26em;color:#6ff2ae;margin-bottom:34px">DTLS-SRTP · ENCRYPTED</div>
          <div style="display:flex;align-items:center;gap:18px">
            <div style="display:flex;flex-direction:column;align-items:center;gap:12px"><span style="position:relative;width:70px;height:70px;border-radius:50%;border:1px solid rgba(111,242,174,.6);display:flex;align-items:center;justify-content:center;font:600 11px 'IBM Plex Mono',monospace;letter-spacing:.14em;color:#e9f0f2;background:rgba(111,242,174,.07)">YOU<span style="position:absolute;inset:0;border-radius:50%;border:1px solid rgba(111,242,174,.5);animation:lpPing 2s ease-out infinite;display:block"></span></span></div>
            <div style="flex:1;height:2px;background-image:repeating-linear-gradient(90deg,rgba(111,242,174,.8) 0 10px,transparent 10px 24px);background-size:24px 2px;animation:lpDash 1s linear infinite"></div>
            <div style="display:flex;flex-direction:column;align-items:center;gap:12px"><span style="position:relative;width:70px;height:70px;border-radius:50%;border:1px solid rgba(111,242,174,.6);display:flex;align-items:center;justify-content:center;font:600 11px 'IBM Plex Mono',monospace;letter-spacing:.14em;color:#e9f0f2;background:rgba(111,242,174,.07)">THEM<span style="position:absolute;inset:0;border-radius:50%;border:1px solid rgba(111,242,174,.5);animation:lpPing 2s ease-out 1s infinite;display:block"></span></span></div>
          </div>
          <div style="text-align:center;font:400 10px 'IBM Plex Mono',monospace;letter-spacing:.24em;color:rgba(148,162,172,.7);margin-top:34px">BROWSER ↔ BROWSER</div>
          <div style="display:flex;justify-content:center;margin-top:26px"><span style="font:500 10px 'IBM Plex Mono',monospace;letter-spacing:.2em;color:rgba(148,162,172,.55);border:1px dashed rgba(148,162,172,.35);border-radius:8px;padding:8px 14px;text-decoration:line-through">MIDDLE SERVER</span></div>
        </div>
      </div>
    </div>
  </section>

  <section id="faq" class="lp-section lp-faq" data-screen-label="FAQ" style="padding:120px 40px 140px">
    <div style="max-width:760px;margin:0 auto">
      <div data-reveal="0" data-scramble="1" style="font:500 11px 'IBM Plex Mono',monospace;letter-spacing:.28em;color:#6ff2ae">04 — FAQ</div>
      <h2 data-reveal="1" data-scramble="1" style="margin:18px 0 40px;font:700 clamp(34px,4.4vw,54px)/1.05 'Space Grotesk',sans-serif;letter-spacing:-.02em">Quick answers.</h2>
      <div data-reveal="2">
        ${faq("Is RELAY really free?", "Yes. Calls run peer-to-peer between browsers, so there's no expensive media infrastructure to pay for — and no reason to charge you.")}
        ${faq("Do I need an account?", "No. Pick a display name when you arrive and you're on the network. No email, no password, no verification.")}
        ${faq("How do the 6-digit numbers work?", "Every visitor gets a short RELAY number. Read it out, text it, write it on a napkin — anyone who dials it from their browser reaches you directly.")}
        ${faq("Does it work on my phone?", "Yes — RELAY runs in any modern browser: Chrome, Safari, Firefox and Edge, on desktop or mobile. Nothing to install.")}
        ${faq("Who can see or hear my calls?", "Just the people on them. Media streams directly between browsers, encrypted in transit. RELAY's server only handles the handshake — it never touches your audio or video.")}
      </div>
      <div data-reveal="3" style="margin-top:70px;text-align:center">
        <a class="lp-cta" href="/app" style="display:inline-block;background:#6ff2ae;color:#06120b;font:600 17px 'Space Grotesk',sans-serif;padding:18px 40px;border-radius:999px;box-shadow:0 0 40px rgba(111,242,174,.35)">Get your number →</a>
        <div style="margin-top:16px;font:400 10px 'IBM Plex Mono',monospace;letter-spacing:.24em;color:rgba(148,162,172,.6)">FREE · NO SIGNUP · ~10 SECONDS</div>
      </div>
    </div>
  </section>

  <footer data-screen-label="Footer" style="padding:100px 40px 50px;border-top:1px solid rgba(233,240,242,.07)">
    <div style="max-width:1240px;margin:0 auto">
      <div style="font:700 clamp(90px,15vw,220px)/0.9 'Space Grotesk',sans-serif;letter-spacing:.03em;color:rgba(233,240,242,.06);text-align:center;user-select:none" data-scramble="1">RELAY</div>
      <div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:24px;margin-top:60px">
        <div style="font:400 11px 'IBM Plex Mono',monospace;letter-spacing:.18em;color:rgba(148,162,172,.7)">PEER-TO-PEER. BROWSER-NATIVE. FREE. © 2026 RELAY · v${APP_VERSION}</div>
        <div style="display:flex;flex-wrap:wrap;gap:26px;font:500 11px 'IBM Plex Mono',monospace;letter-spacing:.16em">
          <a href="/app">OPEN APP ↗</a>
          <a class="lp-footlink" href="#how">HOW IT WORKS</a>
          <a class="lp-footlink" href="#features">FEATURES</a>
          <a class="lp-footlink" href="#privacy">PRIVACY</a>
          <a class="lp-footlink" href="#faq">FAQ</a>
          <a class="lp-footlink" href="/privacy-policy">POLICY</a>
          <a class="lp-footlink" href="#top">TOP ↑</a>
        </div>
      </div>
    </div>
  </footer>
</main>
</div>`;
}

/* ── the imperative engine (ported from the design's DCLogic class) ───────── */

const DTMF: Record<string, [number, number]> = {
  "1": [697, 1209], "2": [697, 1336], "3": [697, 1477],
  "4": [770, 1209], "5": [770, 1336], "6": [770, 1477],
  "7": [852, 1209], "8": [852, 1336], "9": [852, 1477],
  "*": [941, 1209], "0": [941, 1336], "#": [941, 1477],
};

type LoaderMsg = [number, string, string];

function startLanding(host: HTMLElement): () => void {
  const $ = (k: string) => host.querySelector<HTMLElement>(`[data-lp="${k}"]`);
  const reduced =
    typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

  let alive = true;
  let raf = 0; // fx loop
  let threeRaf = 0;
  let ldT = 0;
  let demoT: ReturnType<typeof setInterval> | null = null;
  let renderer: { dispose(): void } | null = null;
  let ac: AudioContext | null = null;

  // shared state
  let mx = 0, my = 0, smx = 0, smy = 0, sp = 0, tp = 0, svel = 0, lsy: number | null = null;
  let fc = 0, rainA = 0, baseHue = 150;
  let num = "";
  let calling = false;

  /* ── dialer ── */
  const syncDial = () => {
    const el = $("dialDisplay"), st = $("dialStatus"), cb = $("callBtn");
    const chars: string[] = [];
    for (let i = 0; i < 6; i++) chars.push(num[i] || "·");
    if (el) el.textContent = chars.join(" ");
    const len = num.length, full = len === 6;
    if (st) {
      st.textContent = full
        ? "LINE READY — PRESS CALL"
        : len ? `${6 - len} MORE DIGIT${6 - len > 1 ? "S" : ""}` : "ENTER ANY 6-DIGIT NUMBER";
      st.style.color = full ? "#6ff2ae" : "rgba(148,162,172,.9)";
    }
    if (cb) {
      cb.textContent = full ? `CALL ${num.slice(0, 3)}-${num.slice(3)} ↗` : "CALL";
      cb.style.opacity = full ? "1" : ".4";
      cb.style.pointerEvents = full ? "auto" : "none";
      cb.style.background = full ? "#6ff2ae" : "rgba(111,242,174,.12)";
      cb.style.color = full ? "#06120b" : "#6ff2ae";
      cb.style.boxShadow = full ? "0 0 34px rgba(111,242,174,.4)" : "none";
    }
  };
  const beep = (d: string) => {
    try {
      const f = DTMF[d];
      if (!f) return;
      if (!ac) ac = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      if (ac.state === "suspended") void ac.resume();
      const g = ac.createGain();
      g.gain.setValueAtTime(0.001, ac.currentTime);
      g.gain.exponentialRampToValueAtTime(0.045, ac.currentTime + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.13);
      g.connect(ac.destination);
      f.forEach((fr) => {
        const o = ac!.createOscillator();
        o.type = "sine";
        o.frequency.value = fr;
        o.connect(g);
        o.start();
        o.stop(ac!.currentTime + 0.14);
      });
    } catch { /* audio is decorative */ }
  };
  const press = (d: string) => {
    beep(d);
    if (!/[0-9]/.test(d) || num.length >= 6) return;
    num += d;
    syncDial();
  };
  const onKeyClick = (e: Event) => {
    const k = (e.currentTarget as HTMLElement).dataset.lpKey;
    if (k) press(k);
  };
  const clearDial = () => { num = ""; syncDial(); };
  const demoDial = () => {
    if (demoT) return;
    num = "";
    demoT = setInterval(() => {
      num += Math.floor(Math.random() * 10);
      beep(num.slice(-1));
      syncDial();
      if (num.length >= 6) { clearInterval(demoT!); demoT = null; }
    }, 150);
  };

  /* ── loader ── */
  const runLoader = (dur: number, msgs: LoaderMsg[], onDone?: () => void) => {
    const ov = $("loader");
    if (!ov || reduced) {
      if (ov) ov.style.display = "none";
      onDone?.();
      return;
    }
    if (ldT) cancelAnimationFrame(ldT);
    let lockOn: boolean | null = null;
    ov.style.display = "flex";
    ov.style.pointerEvents = "auto";
    requestAnimationFrame(() => { ov.style.opacity = "1"; });
    const bar = $("loadBar"), pct = $("loadPct"), msg = $("loadMsg"), sub = $("loadSub");
    const t0 = performance.now();
    const step = () => {
      if (!alive) return;
      const p = Math.min(1, (performance.now() - t0) / dur);
      const e = 1 - Math.pow(1 - p, 2.1);
      if (bar) bar.style.width = (e * 100).toFixed(1) + "%";
      if (pct) pct.textContent = Math.round(e * 100) + "%";
      let mm = msgs[0][1], ss = msgs[0][2];
      for (const m of msgs) if (e >= m[0]) { mm = m[1]; ss = m[2]; }
      if (msg && msg.textContent !== mm) msg.textContent = mm;
      if (sub && sub.textContent !== ss) sub.textContent = ss;
      const lk = $("lock"), lo = $("lockOpen"), lc = $("lockClosed");
      if (lk && lo && lc) {
        const locked = e >= 0.72;
        if (locked !== lockOn) {
          lockOn = locked;
          lo.style.display = locked ? "none" : "flex";
          lc.style.display = locked ? "flex" : "none";
          lk.style.borderColor = locked ? "rgba(111,242,174,.8)" : "rgba(148,162,172,.45)";
          lk.style.boxShadow = locked ? "0 0 22px rgba(111,242,174,.55)" : "none";
          lk.style.animation = locked ? "lpLockPop .45s cubic-bezier(.22,1,.36,1)" : "none";
        }
      }
      if (p < 1) { ldT = requestAnimationFrame(step); }
      else {
        setTimeout(() => {
          if (!alive) return;
          ov.style.opacity = "0";
          ov.style.pointerEvents = "none";
          setTimeout(() => { ov.style.display = "none"; }, 650);
          onDone?.();
        }, 260);
      }
    };
    step();
  };
  const replayHero = () => {
    const hero = host.querySelector('[data-screen-label="Hero"]');
    hero?.querySelectorAll<HTMLElement>("*").forEach((el) => {
      const a = el.style.animation;
      if (a && a.indexOf("lpRiseIn") > -1) {
        el.style.animation = "none";
        void el.offsetWidth;
        el.style.animation = a;
      }
    });
  };
  const callNow = (e: Event) => {
    e.preventDefault();
    if (num.length !== 6 || calling) return;
    calling = true;
    const n = num, fmt = `${n.slice(0, 3)}-${n.slice(3)}`;
    const nb = $("nodeB");
    if (nb?.firstChild) nb.firstChild.nodeValue = fmt;
    runLoader(3000, [
      [0, `DIALING ${fmt}…`, `Reaching ${fmt} directly — browser to browser.`],
      [0.3, "RINGING…", "No phone network involved. Just the open web."],
      [0.55, "EXCHANGING KEYS…", "Your devices invent a secret code that only they two know."],
      [0.78, "LINE ENCRYPTED", "From here on, every word is scrambled end-to-end."],
      [0.97, "CONNECTING…", "Locked. Nobody can listen in — not even RELAY."],
    ], () => {
      calling = false;
      // Same-origin: land in the app's call-link direct-join flow.
      window.location.href = `/i/${n}`;
    });
  };

  /* ── reveals + scramble ── */
  let pendingReveals: HTMLElement[] = [];
  const initReveals = () => {
    pendingReveals = [];
    host.querySelectorAll<HTMLElement>("[data-reveal]").forEach((el) => {
      if (reduced) return;
      const r = el.getBoundingClientRect();
      if (r.top < innerHeight * 0.92) return;
      const d = (Number(el.dataset.reveal) || 0) * 50;
      el.style.opacity = "0";
      el.style.transform = "translateY(22px)";
      el.style.transition = `opacity .5s cubic-bezier(.22,1,.36,1) ${d}ms, transform .5s cubic-bezier(.22,1,.36,1) ${d}ms`;
      pendingReveals.push(el);
    });
  };
  const checkReveals = () => {
    for (let i = pendingReveals.length - 1; i >= 0; i--) {
      if (pendingReveals[i].getBoundingClientRect().top < innerHeight * 0.92) {
        pendingReveals[i].style.opacity = "1";
        pendingReveals[i].style.transform = "translateY(0px)";
        pendingReveals.splice(i, 1);
      }
    }
  };
  type Scr = { el: HTMLElement; orig: string; prog: number };
  let scr: Scr[] = [];
  const initScramble = () => {
    scr = [];
    if (reduced) return;
    host.querySelectorAll<HTMLElement>("[data-scramble]").forEach((el) => {
      scr.push({ el, orig: el.textContent || "", prog: 1e9 });
    });
  };
  const garble = (orig: string, keep: number) => {
    let out = "";
    for (let i = 0; i < orig.length; i++) {
      const ch = orig[i];
      out += i < keep || !/[A-Za-z0-9]/.test(ch) ? ch : Math.random() < 0.5 ? "0" : "1";
    }
    return out;
  };
  const scrTick = () => {
    const active = svel > 7, vh = innerHeight;
    if (active) {
      for (const s of scr) {
        const r = s.el.getBoundingClientRect();
        if (r.bottom > 0 && r.top < vh) { s.prog = 0; s.el.textContent = garble(s.orig, 0); }
      }
      return;
    }
    for (const s of scr) {
      const len = s.orig.length;
      if (s.prog >= len) continue;
      s.prog += Math.max(2, Math.ceil(len / 9));
      if (s.prog >= len) { s.el.textContent = s.orig; s.prog = 1e9; }
      else s.el.textContent = garble(s.orig, s.prog);
    }
  };

  /* ── matrix rain ── */
  let mctx: CanvasRenderingContext2D | null = null;
  let rainCols: Array<{ y: number; v: number }> = [];
  const sizeMatrix = () => {
    const c = $("matrix") as HTMLCanvasElement | null;
    if (!c || !mctx) return;
    const dpr = Math.min(devicePixelRatio, 1.5);
    c.width = innerWidth * dpr;
    c.height = innerHeight * dpr;
    mctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    mctx.font = '13px "IBM Plex Mono",monospace';
    rainCols = [];
    const n = Math.ceil(innerWidth / 18);
    for (let i = 0; i < n; i++) rainCols.push({ y: Math.random() * innerHeight, v: 2.5 + Math.random() * 4 });
  };
  const initMatrix = () => {
    const c = $("matrix") as HTMLCanvasElement | null;
    if (!c || reduced) return;
    mctx = c.getContext("2d");
    sizeMatrix();
  };
  const drawMatrix = (h: number) => {
    const x = mctx;
    if (!x) return;
    x.globalCompositeOperation = "destination-out";
    x.globalAlpha = 0.13;
    x.fillStyle = "#000";
    x.fillRect(0, 0, innerWidth, innerHeight);
    x.globalCompositeOperation = "source-over";
    if (rainA < 0.02) return;
    x.globalAlpha = Math.min(0.8, rainA);
    x.fillStyle = `hsla(${h},90%,66%,1)`;
    for (let i = 0; i < rainCols.length; i++) {
      const col = rainCols[i];
      x.fillText(Math.random() < 0.5 ? "0" : "1", i * 18, col.y);
      col.y += col.v * (1 + rainA * 2);
      if (col.y > innerHeight + 20) { col.y = -20 - Math.random() * 260; col.v = 2.5 + Math.random() * 4; }
    }
  };

  /* ── hue-shifting chrome fx (runs even without three) ── */
  let threeColorTint: ((shift: number) => void) | null = null;
  const updateFx = () => {
    const sy = window.scrollY || 0;
    const vel = Math.abs(sy - (lsy == null ? sy : lsy));
    lsy = sy;
    svel = svel * 0.82 + vel * 0.18;
    sp += (tp - sp) * 0.16;
    smx += (mx - smx) * 0.09;
    smy += (my - smy) * 0.09;
    const shift = sp * 280;
    const h = (baseHue + shift) % 360;
    const target = Math.min(0.9, svel / 26);
    rainA = rainA + (target - rainA) * 0.14;
    drawMatrix(h);
    if (fc % 2 === 0 && threeColorTint) threeColorTint(shift);
    if (fc % 3 === 1) scrTick();
    if (fc % 3 === 0) {
      const hu = $("hue");
      if (hu) hu.style.background = `radial-gradient(1100px at 12% 8%, hsla(${h},85%,62%,.075), transparent 62%), radial-gradient(900px at 88% 92%, hsla(${(h + 40) % 360},85%,60%,.06), transparent 62%)`;
      const s = $("spot");
      if (s) s.style.background = `radial-gradient(circle 340px at center, hsla(${h},85%,64%,.06), transparent 70%)`;
      const nv = $("nav");
      if (nv) {
        nv.style.borderBottomColor = `hsla(${h},85%,64%,.22)`;
        nv.style.boxShadow = `0 8px 40px hsla(${h},85%,55%,.12), inset 0 1px 0 rgba(255,255,255,.06)`;
        nv.style.background = `linear-gradient(180deg, hsla(${h},60%,16%,.5), rgba(10,13,16,.45))`;
      }
      const dk = $("dock");
      if (dk) {
        dk.style.borderColor = `hsla(${h},85%,64%,.45)`;
        dk.style.color = `hsl(${h},85%,68%)`;
        dk.style.background = `hsla(${h},85%,60%,.08)`;
        dk.style.boxShadow = `0 0 18px hsla(${h},85%,60%,.25)`;
      }
      const dd = $("dockDot");
      if (dd) { dd.style.background = `hsl(${h},85%,66%)`; dd.style.boxShadow = `0 0 12px hsla(${h},85%,66%,.9)`; }
    }
    if (fc % 5 === 0) checkReveals();
    fc++;
  };
  const fxLoop = () => {
    if (!alive) return;
    updateFx();
    raf = requestAnimationFrame(fxLoop);
  };

  /* ── listeners ── */
  const onMove = (e: MouseEvent) => {
    mx = (e.clientX / innerWidth) * 2 - 1;
    my = (e.clientY / innerHeight) * 2 - 1;
    const s = $("spot");
    if (s) s.style.transform = `translate3d(${e.clientX - 450}px,${e.clientY - 450}px,0)`;
    const p = $("padTilt");
    if (p) {
      const r = p.getBoundingClientRect();
      if (e.clientX > r.left - 90 && e.clientX < r.right + 90 && e.clientY > r.top - 90 && e.clientY < r.bottom + 90) {
        const rx = ((e.clientY - (r.top + r.height / 2)) / r.height) * -5;
        const ry = ((e.clientX - (r.left + r.width / 2)) / r.width) * 6;
        p.style.transform = `perspective(900px) rotateX(${rx}deg) rotateY(${ry}deg)`;
      } else {
        p.style.transform = "perspective(900px)";
      }
    }
  };
  const onScroll = () => {
    const d = document.documentElement, max = d.scrollHeight - innerHeight;
    tp = max > 0 ? Math.min(1, Math.max(0, (window.scrollY || d.scrollTop) / max)) : 0;
    checkReveals();
  };
  let onResizeThree: (() => void) | null = null;
  const onResize = () => {
    sizeMatrix();
    onResizeThree?.();
  };

  /* ── three.js scene (dynamic import; page fully works without it) ── */
  const bootThree = async () => {
    if (reduced) return;
    let T: typeof import("three");
    try {
      T = await import("three");
    } catch { return; }
    if (!alive) return;
    const c = $("canvas") as HTMLCanvasElement | null;
    if (!c) return;
    let rn: import("three").WebGLRenderer;
    try {
      rn = new T.WebGLRenderer({ canvas: c, antialias: true, alpha: true });
    } catch { return; } // no WebGL — 2D fx still run
    renderer = rn;
    rn.setPixelRatio(Math.min(devicePixelRatio, 1.8));
    rn.setSize(innerWidth, innerHeight, false);
    rn.setClearColor(0x000000, 0);
    const scene = new T.Scene();
    scene.fog = new T.FogExp2(0x0a0d10, 0.0085);
    const cam = new T.PerspectiveCamera(58, innerWidth / innerHeight, 0.1, 500);
    onResizeThree = () => {
      rn.setPixelRatio(Math.min(devicePixelRatio, 1.8));
      rn.setSize(innerWidth, innerHeight, false);
      cam.aspect = innerWidth / innerHeight;
      cam.updateProjectionMatrix();
    };
    const gc = document.createElement("canvas");
    gc.width = gc.height = 128;
    const g2 = gc.getContext("2d")!;
    const gr = g2.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, "rgba(255,255,255,1)");
    gr.addColorStop(0.35, "rgba(255,255,255,.32)");
    gr.addColorStop(1, "rgba(255,255,255,0)");
    g2.fillStyle = gr;
    g2.fillRect(0, 0, 128, 128);
    const glowTex = new T.CanvasTexture(gc);

    const CA = 0x6ff2ae, CB = 0x62d9ff; // "aurora" theme
    { const hsl = { h: 0, s: 0, l: 0 }; new T.Color(CA).getHSL(hsl); baseHue = hsl.h * 360; }
    const tA: import("three").Color[] = [], tB: import("three").Color[] = [];
    threeColorTint = (shift: number) => {
      const A = new T.Color(CA).offsetHSL(shift / 360, 0, 0);
      const B = new T.Color(CB).offsetHSL(shift / 360, 0, 0);
      for (const ccc of tA) ccc.copy(A);
      for (const ccc of tB) ccc.copy(B);
    };

    type Zone = { g: import("three").Group; z: number; mats: Array<{ m: { opacity: number }; bo: number }>; tick: (t: number, f: number, m: number) => void };
    const zones: Zone[] = [];
    const collectMats = (grp: import("three").Group) => {
      const arr: Array<{ m: { opacity: number }; bo: number }> = [];
      grp.traverse((o) => {
        const mat = (o as { material?: { transparent: boolean; opacity: number } }).material;
        if (mat) { mat.transparent = true; arr.push({ m: mat, bo: mat.opacity }); }
      });
      return arr;
    };
    const sprite = (colorHex: number, scale: number, opacity: number, tintList: import("three").Color[]) => {
      const m = new T.SpriteMaterial({ map: glowTex, color: colorHex, transparent: true, opacity, blending: T.AdditiveBlending, depthWrite: false });
      tintList.push(m.color);
      const s = new T.Sprite(m);
      s.scale.set(scale, scale, 1);
      return s;
    };
    const worldAt = (z: number) => {
      const v = new T.Vector3(smx, -smy, 0.5).unproject(cam);
      const d = v.sub(cam.position).normalize();
      const t = (z - cam.position.z) / d.z;
      return cam.position.clone().add(d.multiplyScalar(t));
    };
    const vis = (camZ: number, gz: number) => {
      const d = Math.abs(camZ - (gz + 30));
      let f = 1 - d / 46;
      if (f < 0) f = 0;
      return f * f * (3 - 2 * f);
    };

    // zone 0: peer-to-peer network
    {
      const net = new T.Group();
      net.position.z = 0;
      const N = 330;
      const base = new Float32Array(N * 3), pos = new Float32Array(N * 3);
      for (let i = 0; i < N; i++) {
        base[i * 3] = (Math.random() + Math.random() - 1) * 20;
        base[i * 3 + 1] = (Math.random() + Math.random() - 1) * 11;
        base[i * 3 + 2] = (Math.random() + Math.random() - 1) * 6;
      }
      const pairs: number[] = [];
      for (let i = 0; i < N && pairs.length < 1300; i++)
        for (let j = i + 1; j < N && pairs.length < 1300; j++) {
          const dx = base[i * 3] - base[j * 3], dy = base[i * 3 + 1] - base[j * 3 + 1], dz = base[i * 3 + 2] - base[j * 3 + 2];
          if (dx * dx + dy * dy + dz * dz < 21) pairs.push(i, j);
        }
      const pGeo = new T.BufferGeometry();
      pGeo.setAttribute("position", new T.BufferAttribute(pos, 3));
      const pMat = new T.PointsMaterial({ color: CA, size: 0.24, transparent: true, opacity: 0.9, blending: T.AdditiveBlending, depthWrite: false });
      tA.push(pMat.color);
      net.add(new T.Points(pGeo, pMat));
      const lPos = new Float32Array(pairs.length * 3);
      const lGeo = new T.BufferGeometry();
      lGeo.setAttribute("position", new T.BufferAttribute(lPos, 3));
      const lMat = new T.LineBasicMaterial({ color: CB, transparent: true, opacity: 0.2, blending: T.AdditiveBlending, depthWrite: false });
      tB.push(lMat.color);
      net.add(new T.LineSegments(lGeo, lMat));
      net.add(sprite(CA, 50, 0.09, tA));
      scene.add(net);
      const tick = (t: number, _f: number, m: number) => {
        const cw = worldAt(0);
        for (let i = 0; i < N; i++) {
          let px = base[i * 3] + Math.sin(t * 0.5 + i * 1.63) * 0.5 * m;
          let py = base[i * 3 + 1] + Math.cos(t * 0.44 + i * 2.13) * 0.45 * m;
          const pz = base[i * 3 + 2] + Math.sin(t * 0.6 + i) * 0.4 * m;
          const dx = px - cw.x, dy = py - cw.y, d2 = dx * dx + dy * dy;
          if (d2 < 36 && d2 > 0.0001) {
            const dd = Math.sqrt(d2), push = ((6 - dd) / 6) * 3.2 * m;
            px += (dx / dd) * push;
            py += (dy / dd) * push;
          }
          pos[i * 3] = px; pos[i * 3 + 1] = py; pos[i * 3 + 2] = pz;
        }
        for (let k = 0; k < pairs.length; k += 2) {
          const a = pairs[k] * 3, b = pairs[k + 1] * 3, o = k * 3;
          lPos[o] = pos[a]; lPos[o + 1] = pos[a + 1]; lPos[o + 2] = pos[a + 2];
          lPos[o + 3] = pos[b]; lPos[o + 4] = pos[b + 1]; lPos[o + 5] = pos[b + 2];
        }
        pGeo.attributes.position.needsUpdate = true;
        lGeo.attributes.position.needsUpdate = true;
      };
      zones.push({ g: net, z: 0, mats: collectMats(net), tick });
    }
    // zone 1: waveform rings
    {
      const rg = new T.Group();
      rg.position.z = -70;
      const rings: Array<{ geo: import("three").BufferGeometry; arr: Float32Array; seg: number; R: number; i: number }> = [];
      for (let i = 0; i < 6; i++) {
        const seg = 150, arr = new Float32Array(seg * 3);
        const geo = new T.BufferGeometry();
        geo.setAttribute("position", new T.BufferAttribute(arr, 3));
        const mat = new T.LineBasicMaterial({ color: i % 2 ? CB : CA, transparent: true, opacity: 0.45, blending: T.AdditiveBlending, depthWrite: false });
        (i % 2 ? tB : tA).push(mat.color);
        rg.add(new T.LineLoop(geo, mat));
        rings.push({ geo, arr, seg, R: 4.2 + i * 2.05, i });
      }
      rg.add(sprite(CB, 22, 0.13, tB));
      scene.add(rg);
      const tick = (t: number, _f: number, m: number) => {
        for (const rr of rings) {
          for (let j = 0; j < rr.seg; j++) {
            const a = (j / rr.seg) * Math.PI * 2;
            const rad = rr.R + Math.sin(a * 7 - t * (1.3 + rr.i * 0.15) + rr.i * 1.4) * (0.4 + 0.13 * rr.i) * m;
            rr.arr[j * 3] = Math.cos(a) * rad;
            rr.arr[j * 3 + 1] = Math.sin(a) * rad;
            rr.arr[j * 3 + 2] = Math.sin(a * 3 + t * 0.8 + rr.i) * 0.5 * m;
          }
          rr.geo.attributes.position.needsUpdate = true;
        }
        rg.rotation.z = t * 0.03 * m;
      };
      zones.push({ g: rg, z: -70, mats: collectMats(rg), tick });
    }
    // zone 2: glassy orbs
    {
      const og = new T.Group();
      og.position.z = -140;
      const orbs: Array<{ halo: import("three").Sprite; core: import("three").Mesh; wire: import("three").Mesh; x: number; y: number; z: number; phi: number }> = [];
      for (let i = 0; i < 8; i++) {
        const r = 1.1 + Math.random() * 2.2;
        const x = (Math.random() * 2 - 1) * 13, y = (Math.random() * 2 - 1) * 6.5, z = (Math.random() * 2 - 1) * 4;
        const halo = sprite(i % 2 ? CB : CA, r * 7, 0.2, i % 2 ? tB : tA);
        halo.position.set(x, y, z);
        og.add(halo);
        const core = new T.Mesh(new T.SphereGeometry(r, 32, 22), new T.MeshBasicMaterial({ color: 0x0c1218, transparent: true, opacity: 0.94 }));
        core.position.set(x, y, z);
        og.add(core);
        const wireMat = new T.MeshBasicMaterial({ color: i % 2 ? CB : CA, wireframe: true, transparent: true, opacity: 0.1 });
        (i % 2 ? tB : tA).push(wireMat.color);
        const wire = new T.Mesh(new T.SphereGeometry(r * 1.02, 18, 12), wireMat);
        wire.position.set(x, y, z);
        og.add(wire);
        orbs.push({ halo, core, wire, x, y, z, phi: Math.random() * 6.28 });
      }
      scene.add(og);
      const tick = (t: number, f: number, m: number) => {
        for (const o of orbs) {
          const y = o.y + Math.sin(t * 0.7 + o.phi) * 0.9 * m;
          const x = o.x + Math.sin(t * 0.16 + o.phi * 2) * 1.3 * m;
          o.halo.position.set(x, y, o.z);
          o.core.position.set(x, y, o.z);
          o.wire.position.set(x, y, o.z);
          o.wire.rotation.y = t * 0.24 + o.phi;
          (o.halo.material as { opacity: number }).opacity = (0.17 + 0.06 * Math.sin(t * 1.1 + o.phi)) * f;
        }
      };
      zones.push({ g: og, z: -140, mats: collectMats(og), tick });
    }
    // zone 3: globe with arcs
    {
      const gg = new T.Group();
      gg.position.z = -210;
      const R = 9;
      const wireM = new T.MeshBasicMaterial({ color: CB, wireframe: true, transparent: true, opacity: 0.13 });
      tB.push(wireM.color);
      gg.add(new T.Mesh(new T.IcosahedronGeometry(R, 2), wireM));
      gg.add(sprite(CB, 30, 0.12, tB));
      const arcs: Array<{ curve: import("three").QuadraticBezierCurve3; mat: import("three").LineBasicMaterial }> = [];
      const endPts = new Float32Array(12 * 2 * 3);
      const movPts = new Float32Array(12 * 3);
      for (let i = 0; i < 12; i++) {
        const a = new T.Vector3().randomDirection(), b = new T.Vector3().randomDirection();
        const mid = a.clone().add(b).normalize().multiplyScalar(R * 1.55);
        const curve = new T.QuadraticBezierCurve3(a.clone().multiplyScalar(R), mid, b.clone().multiplyScalar(R));
        const geo = new T.BufferGeometry().setFromPoints(curve.getPoints(40));
        const mat = new T.LineBasicMaterial({ color: CA, transparent: true, opacity: 0.45, blending: T.AdditiveBlending, depthWrite: false });
        tA.push(mat.color);
        gg.add(new T.Line(geo, mat));
        arcs.push({ curve, mat });
        endPts.set([a.x * R, a.y * R, a.z * R], i * 6);
        endPts.set([b.x * R, b.y * R, b.z * R], i * 6 + 3);
      }
      const epGeo = new T.BufferGeometry();
      epGeo.setAttribute("position", new T.BufferAttribute(endPts, 3));
      const epMat = new T.PointsMaterial({ color: CA, size: 0.5, transparent: true, opacity: 0.9, blending: T.AdditiveBlending, depthWrite: false });
      tA.push(epMat.color);
      gg.add(new T.Points(epGeo, epMat));
      const mvGeo = new T.BufferGeometry();
      mvGeo.setAttribute("position", new T.BufferAttribute(movPts, 3));
      gg.add(new T.Points(mvGeo, new T.PointsMaterial({ color: 0xffffff, size: 0.42, transparent: true, opacity: 0.95, blending: T.AdditiveBlending, depthWrite: false })));
      scene.add(gg);
      const tick = (t: number, f: number, m: number) => {
        gg.rotation.y = t * 0.06 * m + smx * 0.22;
        gg.rotation.x = smy * 0.1;
        for (let i = 0; i < arcs.length; i++) {
          arcs[i].mat.opacity = (0.18 + 0.34 * (Math.sin(t * 1.2 + i * 1.7) * 0.5 + 0.5)) * f;
          const p = arcs[i].curve.getPoint((t * 0.07 + i * 0.083) % 1);
          movPts[i * 3] = p.x; movPts[i * 3 + 1] = p.y; movPts[i * 3 + 2] = p.z;
        }
        mvGeo.attributes.position.needsUpdate = true;
      };
      zones.push({ g: gg, z: -210, mats: collectMats(gg), tick });
    }
    // zone 4: calm starfield
    {
      const sg = new T.Group();
      sg.position.z = -286;
      const SN = 420, sPos = new Float32Array(SN * 3);
      for (let i = 0; i < SN; i++) {
        sPos[i * 3] = (Math.random() * 2 - 1) * 48;
        sPos[i * 3 + 1] = (Math.random() * 2 - 1) * 26;
        sPos[i * 3 + 2] = (Math.random() * 2 - 1) * 34;
      }
      const sGeo = new T.BufferGeometry();
      sGeo.setAttribute("position", new T.BufferAttribute(sPos, 3));
      const sMat = new T.PointsMaterial({ color: CB, size: 0.3, transparent: true, opacity: 0.75, blending: T.AdditiveBlending, depthWrite: false });
      tB.push(sMat.color);
      sg.add(new T.Points(sGeo, sMat));
      sg.add(sprite(CA, 40, 0.07, tA));
      scene.add(sg);
      const tick = (t: number, _f: number, m: number) => { sg.rotation.z = t * 0.012 * m; };
      zones.push({ g: sg, z: -286, mats: collectMats(sg), tick });
    }
    // global dust
    const DN = 420, dPos = new Float32Array(DN * 3);
    for (let i = 0; i < DN; i++) {
      dPos[i * 3] = (Math.random() * 2 - 1) * 46;
      dPos[i * 3 + 1] = (Math.random() * 2 - 1) * 25;
      dPos[i * 3 + 2] = 50 - Math.random() * 370;
    }
    const dGeo = new T.BufferGeometry();
    dGeo.setAttribute("position", new T.BufferAttribute(dPos, 3));
    const dust = new T.Points(dGeo, new T.PointsMaterial({ color: 0x9fb4c4, size: 0.16, transparent: true, opacity: 0.22, blending: T.AdditiveBlending, depthWrite: false }));
    scene.add(dust);

    const M = 1; // design "motion" prop at its default
    const clock = new T.Clock();
    const loop = () => {
      if (!alive) return;
      threeRaf = requestAnimationFrame(loop);
      const t = clock.getElapsedTime();
      const camZ = 34 - sp * 286;
      cam.position.set(smx * 2.6 * M, -smy * 1.6 * M + 0.3, camZ);
      cam.lookAt(smx * 1.2, -smy * 0.8, camZ - 46);
      for (const z of zones) {
        const f = vis(camZ, z.z);
        z.g.visible = f > 0.015;
        if (z.g.visible) {
          const s = 0.92 + 0.16 * f;
          z.g.scale.set(s, s, s);
          for (const mm of z.mats) mm.m.opacity = mm.bo * f;
          z.tick(t, f, M);
        }
      }
      dust.rotation.z = t * 0.008 * M;
      rn.render(scene, cam);
    };
    loop();
  };

  /* ── wire it all up ── */
  host.querySelectorAll<HTMLElement>("[data-lp-key]").forEach((b) => b.addEventListener("click", onKeyClick));
  $("clearBtn")?.addEventListener("click", clearDial);
  $("demoBtn")?.addEventListener("click", demoDial);
  $("callBtn")?.addEventListener("click", callNow);
  window.addEventListener("mousemove", onMove, { passive: true });
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onResize);
  onScroll();
  initReveals();
  initScramble();
  initMatrix();
  if (reduced) {
    const ov = $("loader");
    if (ov) ov.style.display = "none";
  } else {
    raf = requestAnimationFrame(fxLoop);
    void bootThree();
    runLoader(3400, [
      [0, "WAKING THE NETWORK…", "Spinning up a direct line between your browsers…"],
      [0.22, "RESOLVING PEERS…", "Finding the shortest path — no relay servers in the middle."],
      [0.45, "EXCHANGING KEYS…", "Both devices invent a secret code that only they two know."],
      [0.72, "LINE ENCRYPTED", "Every packet of voice & video is scrambled with that secret."],
      [0.97, "CONNECTED", "Locked end-to-end. Nobody can listen in — not even RELAY."],
    ], replayHero);
  }
  syncDial();

  return () => {
    alive = false;
    cancelAnimationFrame(raf);
    cancelAnimationFrame(threeRaf);
    cancelAnimationFrame(ldT);
    if (demoT) clearInterval(demoT);
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("scroll", onScroll);
    window.removeEventListener("resize", onResize);
    renderer?.dispose();
    void ac?.close().catch(() => {});
  };
}

/* ── the React shell ─────────────────────────────────────────────────────── */

const FONTS_ID = "lp-fonts";
const FONTS_HREF =
  "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap";

export default function Home() {
  const rootRef = useRef<HTMLDivElement>(null);
  const html = useMemo(() => markup(siteHost()), []);

  // LIVE NETWORK stats (carried from the previous landing, owner ask): written
  // imperatively into the design's strip so the static markup stays one string.
  const stats = trpc.stats.public.useQuery(undefined, {
    refetchInterval: 30_000,
    refetchOnWindowFocus: false,
  });
  useEffect(() => {
    const root = rootRef.current;
    const d = stats.data;
    if (!root || !d) return;
    const put = (key: string, v: number | null | undefined) => {
      const el = root.querySelector<HTMLElement>(`[data-lp="stat-${key}"]`);
      if (el && typeof v === "number") el.textContent = v.toLocaleString("en-US");
    };
    put("users", d.registeredUsers);
    put("guests", d.guestsServed);
    put("parties", d.totalParties);
    put("online", d.onlineNow);
  }, [stats.data]);

  useEffect(() => {
    // Fonts (idempotent — cached across navigations).
    if (!document.getElementById(FONTS_ID)) {
      const l = document.createElement("link");
      l.id = FONTS_ID;
      l.rel = "stylesheet";
      l.href = FONTS_HREF;
      document.head.appendChild(l);
    }
    // Smooth in-page anchor scrolling while the landing is mounted.
    const prevBehavior = document.documentElement.style.scrollBehavior;
    document.documentElement.style.scrollBehavior = "smooth";
    const stop = rootRef.current ? startLanding(rootRef.current) : undefined;
    return () => {
      document.documentElement.style.scrollBehavior = prevBehavior;
      stop?.();
    };
  }, []);

  return (
    <div className="lp-root">
      <style>{CSS}</style>
      <div ref={rootRef} dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
