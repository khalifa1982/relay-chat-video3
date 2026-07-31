/* ──────────────────────────────────────────────────────────────────────────
 * RELAY login background — the animated canvas behind the auth card.
 *
 * The drawing code is the handoff spec's, copied near-verbatim as it asked
 * ("plain portable JS — copy it nearly verbatim into a canvas component").
 * Layers per frame, all tinted by the currently-eased palette colour: base fill
 * + two radial glows → drifting grid → parallax twinkling stars → a
 * cursor-attracted flow field → a point vortex → a drifting node/link network
 * with travelling pulses and broadcast rings → orbiting satellites beaming
 * uplinks.
 *
 * THREE DEVIATIONS FROM THE SPEC, all of them the spec's own performance notes
 * turned into code rather than left as advice — this project has already
 * shipped one landing page that made a phone hot (v2.99.67), and this canvas is
 * heavier than that one was:
 *
 *   1. A LOW-POWER TIER. The spec says "for low-power devices drop the
 *      flow-field grid from 63×63 to 45×45 and the vortex from 1e4 to 5e3".
 *      Those are now `grid`/`vortex` fields chosen from the same signals the
 *      landing page uses (narrow viewport, few cores, Data Saver).
 *   2. A FRAME BUDGET. Uncapped rAF is what cooked the phone last time, so the
 *      loop targets 30fps on desktop and 20fps on a low-power device. The
 *      motion is drift, not action; nobody can see the difference.
 *   3. HIDDEN-TAB AND REDUCED-MOTION GATES. `document.hidden` returns early
 *      (with rAF re-armed BEFORE the return, or the loop dies on the first
 *      hidden frame — the v2.99.67 bug). Under `prefers-reduced-motion` the
 *      spec says to keep the glows, grid and stars and skip the rest, so the
 *      expensive layers are gated on one flag rather than the whole thing being
 *      switched off.
 * ────────────────────────────────────────────────────────────────────────── */

export interface RelayBackgroundHandle {
  setBusiness: (v: boolean) => void;
  setAccent: (v: string) => void;
  setIntensity: (v: number) => void;
  destroy: () => void;
}

export interface RelayBackgroundOpts {
  intensity?: number;
  accent?: string;
  colorCycle?: boolean;
  /** Test seam: force the tier instead of sniffing the device. */
  lowPower?: boolean;
  /** Test seam: force the reduced-motion decision. */
  reducedMotion?: boolean;
}

/** The 12-entry cycling palette from the spec. Exported so the UI can prove it
 *  and so a test can assert the background and the accent agree. */
export const RELAY_PALETTE = [
  "#35e0b4", "#3ec9e8", "#4f9df5", "#7c8cf8", "#a78bfa", "#d174e8",
  "#f472b6", "#fb7185", "#f97362", "#f59e4b", "#e8c94a", "#8fd94f",
] as const;

export const RELAY_ACCENT = "#35e0b4";
export const RELAY_BUSINESS_GOLD = "#f0b45a";

/**
 * How long one accent hue lasts before the loop eases toward the next.
 *
 * The app handoff's figure (9.5s), raised from the login handoff's 6.2s because the
 * accent is no longer confined to one screen: it now tints every surface in the app, and
 * the whole point is that a viewer must never CATCH the switch. Exported so the engine
 * and its test read one value rather than a literal in each.
 */
export const RELAY_ACCENT_CYCLE_MS = 9_500;

/** The custom properties every accent-coloured surface in the app reads. */
export const ACCENT_VAR = "--rb";
export const ACCENT_RGB_VAR = "--rb-rgb";

/**
 * PUBLISH THE ACCENT AS CSS CUSTOM PROPERTIES ON `<html>`.
 *
 * This is the load-bearing half of the whole design system: every accent chip, ring,
 * tab pill and CTA is written as `var(--rb)` / `rgba(var(--rb-rgb),α)`, so the canvas
 * loop is what makes the entire app breathe together.
 *
 * IT MUST BE CALLED EVEN WHEN NOTHING IS ANIMATING, and that is the trap worth naming:
 * an UNSET custom property makes `rgba(var(--rb-rgb),.14)` an invalid declaration, which
 * the browser DROPS — so a missing publish does not fall back to a default colour, it
 * renders accent chips with no background at all. Hence a one-shot publish at init, a
 * publish under reduced motion, a publish from the no-2D-context branch, and a static
 * fallback in `index.css` for the case where this module never runs.
 */
export function publishAccentVars(
  rgb: readonly number[],
  /** Test seam: this suite is node-environment with no jsdom, so the WRITE is proven
   *  against a recording stub rather than pinned as a source string. */
  target?: { setProperty(k: string, v: string): void },
): void {
  const s = target ?? (typeof document === "undefined" ? null : document.documentElement.style);
  if (!s) return;
  // TRUNCATED TO INTEGERS, and that is not tidiness: the loop EASES between hues, so
  // these channels are fractional almost every frame, and `rgb(52.7,…)` is not a valid
  // colour — the declaration would be dropped and the accent would vanish mid-crossfade.
  const r = rgb[0] | 0, g = rgb[1] | 0, b = rgb[2] | 0;
  s.setProperty(ACCENT_VAR, `rgb(${r},${g},${b})`);
  s.setProperty(ACCENT_RGB_VAR, `${r},${g},${b}`);
}

/** `#rrggbb` → `[r,g,b]`. Exported so the fallback publish and the loop agree. */
export function hexToRgb(hex: string): number[] {
  const s = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16));
}

/** Same signals the landing page uses (v2.99.67). Narrow viewport OR few cores
 *  OR Data Saver ⇒ the cheap tier. */
export function isLowPowerDevice(): boolean {
  if (typeof window === "undefined") return true;
  const nav = navigator as Navigator & { connection?: { saveData?: boolean } };
  return (
    window.innerWidth <= 820 ||
    (typeof navigator.hardwareConcurrency === "number" && navigator.hardwareConcurrency <= 4) ||
    nav.connection?.saveData === true
  );
}

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export function initRelayBackground(
  cv: HTMLCanvasElement,
  opts: RelayBackgroundOpts = {},
): RelayBackgroundHandle {
  const ctx = cv.getContext("2d");
  const R = Math.random;
  const hex2 = (h: string) => {
    const s = h.replace("#", "");
    return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16));
  };

  // No 2D context (a very old browser, or a jsdom test double): hand back an
  // inert handle rather than throwing on the login screen.
  if (!ctx) {
    // But PUBLISH THE ACCENT FIRST. Without a 2D context there is no loop to do it, and
    // an unset `--rb` drops every accent declaration in the app — so the one browser
    // that cannot draw the background would also be the one with invisible chips.
    publishAccentVars(hexToRgb(opts.accent ?? RELAY_ACCENT));
    return { setBusiness: () => {}, setAccent: () => {}, setIntensity: () => {}, destroy: () => {} };
  }

  const low = opts.lowPower ?? isLowPowerDevice();
  const calm = opts.reducedMotion ?? prefersReducedMotion();
  // Spec's own low-power numbers: flow field 63×63 → 45×45, vortex 1e4 → 5e3.
  const GRID = low ? 45 : 63;
  const VORTEX = low ? 5_000 : 10_000;
  const FRAME_MS = low ? 50 : 33; // 20fps / 30fps — this is drift, not action.

  let intensity = opts.intensity ?? 1.1;
  let business = false;
  const cycle = opts.colorCycle ?? true;
  let accent = opts.accent ?? RELAY_ACCENT;
  let colIdx = 0;
  let colTgt = hex2(RELAY_PALETTE[0]);
  let cur = [...colTgt];
  let colT = 0;

  const stars = [...Array(130)].map(() => ({
    x: R(), y: R(), r: R() * 1.2 + 0.3, p: R() * 6.28, s: 0.4 + R() * 1.2, d: 0.3 + R() * 0.7,
  }));
  const nodes = [...Array(16)].map(() => ({
    bx: 0.04 + R() * 0.92, by: 0.5 + R() * 0.45, a: R() * 6.28, sp: 0.5 + R(),
  }));
  const sats = [
    { ph: R() * 6, sp: 0.1, rx: 0.47, ry: 0.13, cy: 0.17 },
    { ph: R() * 6, sp: -0.075, rx: 0.34, ry: 0.095, cy: 0.215 },
    { ph: R() * 6, sp: 0.13, rx: 0.585, ry: 0.165, cy: 0.125 },
  ];
  let pulses: Array<{ i: number; j: number; t: number; sp: number }> = [];
  let rings: Array<{ x: number; y: number; r: number }> = [];
  let vt = 0, wt = 0, ft = 0;
  let tx = 0, ty = 0, px = 0, py = 0, sy = 0, syT = 0;
  let mx: number | null = null, my: number | null = null;
  let raf = 0;

  const onMove = (e: MouseEvent) => {
    tx = e.clientX / innerWidth - 0.5;
    ty = e.clientY / innerHeight - 0.5;
    mx = e.clientX; my = e.clientY;
  };
  const onOut = (e: MouseEvent) => { if (!e.relatedTarget) { mx = null; my = null; } };
  const onScroll = () => { syT = window.scrollY || document.documentElement.scrollTop || 0; };
  const onResize = () => {
    // DPR capped at 1 on the cheap tier: the backing store is the single
    // biggest lever on fill cost (v2.99.67 measured ~8x from this alone).
    const d = low ? 1 : Math.min(2, devicePixelRatio || 1);
    cv.width = innerWidth * d;
    cv.height = innerHeight * d;
    ctx.setTransform(d, 0, 0, d, 0, 0);
  };
  addEventListener("mousemove", onMove);
  addEventListener("mouseout", onOut);
  addEventListener("scroll", onScroll, { passive: true });
  addEventListener("resize", onResize);
  onResize();
  /* Publish ONCE before the first frame. The loop publishes every frame, but the first
     rAF callback is a frame away and `document.hidden` can defer it indefinitely — so
     without this the app's very first paint would have no accent at all, on the one
     screen most likely to be looked at while loading. */
  publishAccentVars(cur);

  function draw(t: number, dt: number) {
    const w = innerWidth, h = innerHeight;
    const I = Math.max(0.2, Math.min(1.5, intensity));

    // ---- colour cycling ----------------------------------------------------
    if (business) colTgt = hex2(RELAY_BUSINESS_GOLD);
    // REDUCED MOTION HOLDS THE ACCENT STILL. Now that the accent tints every surface in
    // the app rather than one screen, a hue that keeps changing IS animation — however
    // slow — so `prefers-reduced-motion` freezes it. The vars are still published below,
    // because the request is "stop moving", not "render my chips without a colour".
    else if (!cycle || calm) colTgt = hex2(calm && cycle ? RELAY_ACCENT : accent);
    else if ((colT += dt) > RELAY_ACCENT_CYCLE_MS) {
      colT = 0;
      let i: number;
      do { i = Math.floor(R() * RELAY_PALETTE.length); } while (i === colIdx);
      colIdx = i;
      colTgt = hex2(RELAY_PALETTE[i]);
    }
    const rate = 1 - Math.pow(1 - (business ? 0.05 : 0.011), dt / 16.7);
    cur = cur.map((c, i) => c + (colTgt[i] - c) * rate);
    const [cr, cg, cb] = cur;
    // Every frame, so the whole app's accent tracks the background exactly. Cheap: two
    // custom-property writes, and the style recalc they trigger is what makes the app
    // breathe with the canvas rather than beside it.
    publishAccentVars(cur);
    const A = (a: number) => `rgba(${cr | 0},${cg | 0},${cb | 0},${a})`;

    px += (tx - px) * 0.04; py += (ty - py) * 0.04; sy += (syT - sy) * 0.06;

    // ---- base + glows ------------------------------------------------------
    ctx!.fillStyle = "#04070a";
    ctx!.fillRect(0, 0, w, h);
    let g = ctx!.createRadialGradient(w * 0.5 - px * 40, h * 0.34 - py * 30, 0, w * 0.5, h * 0.34, Math.max(w, h) * 0.55);
    g.addColorStop(0, A(0.1)); g.addColorStop(1, "rgba(0,0,0,0)");
    ctx!.fillStyle = g; ctx!.fillRect(0, 0, w, h);
    g = ctx!.createRadialGradient(w * 0.5, h * 1.42, h * 0.3, w * 0.5, h * 1.42, h * 0.95);
    g.addColorStop(0, A(0.14)); g.addColorStop(1, "rgba(0,0,0,0)");
    ctx!.fillStyle = g; ctx!.fillRect(0, 0, w, h);

    // ---- drifting grid -----------------------------------------------------
    ctx!.strokeStyle = "rgba(148,180,170,.045)"; ctx!.lineWidth = 1; ctx!.beginPath();
    for (let x = 0.5 + ((px * -12) % 72); x < w; x += 72) { ctx!.moveTo(x, 0); ctx!.lineTo(x, h); }
    for (let y = 0.5 + ((py * -12 - sy * 0.3) % 72); y < h; y += 72) { ctx!.moveTo(0, y); ctx!.lineTo(w, y); }
    ctx!.stroke();

    // ---- stars -------------------------------------------------------------
    for (const s of stars) {
      const a = 0.1 + 0.24 * (0.5 + 0.5 * Math.sin(t * 0.001 * s.s + s.p));
      ctx!.fillStyle = `rgba(215,240,233,${a})`;
      const yy = (((s.y * h - py * 22 * s.d - sy * 0.12 * s.d) % h) + h) % h;
      ctx!.beginPath(); ctx!.arc(s.x * w - px * 22 * s.d, yy, s.r, 0, 6.28); ctx!.fill();
    }

    // The spec: under reduced motion keep the glows, grid and stars — and stop.
    if (calm) return;

    // ---- flow field, attracted to the cursor (wanders when idle) -----------
    ft += dt * 0.0006;
    const AX = mx ?? w * (0.5 + 0.42 * Math.sin(ft * 0.9 + 2) + 0.05 * Math.sin(ft * 3.1));
    const AY = my ?? h * (0.5 + 0.42 * Math.cos(ft * 0.7) + 0.05 * Math.sin(ft * 2.3));
    const gx = w / GRID, gy = h / GRID;
    for (let i = GRID * GRID; i--;) {
      let x = (i % GRID) * gx, y = ((i / GRID) | 0) * gy;
      const n = Math.sin(x * 0.011 + Math.sin(y * 0.013 + ft * 0.7) * 2)
        + Math.cos(y * 0.009 + Math.sin(x * 0.008 - ft * 0.5) * 2);
      x += 12 * Math.cos(n * 4.5); y += 12 * Math.sin(n * 4.5);
      const k = Math.pow(0.988, Math.hypot(x - AX, y - AY));
      const sr = (cr + (255 - cr) * k) | 0, sg = (cg + (255 - cg) * k) | 0, sb = (cb + (255 - cb) * k) | 0;
      ctx!.fillStyle = `rgba(${sr},${sg},${sb},${(0.07 + 0.6 * k).toFixed(3)})`;
      ctx!.fillRect(x + (AX - x) * k, y + (AY - y) * k, 1.6, 1.6);
    }

    // ---- point vortex, wandering across the viewport -----------------------
    vt += dt * 0.00236 * (0.55 + I * 0.6); wt += dt * 0.001;
    const T = vt, vs = (Math.min(w, h) * 1.3) / 400;
    const wx = 0.5 + 0.33 * Math.sin(wt * 0.12 + 1.4), wy = 0.46 + 0.3 * Math.sin(wt * 0.085);
    const vox = w * wx - vs * 200 - px * 26, voy = h * wy - vs * 240 - py * 22 - sy * 0.22;
    const vr = (cr + (255 - cr) * 0.55) | 0, vg = (cg + (255 - cg) * 0.55) | 0, vb = (cb + (255 - cb) * 0.55) | 0;
    const vp = vs * 0.85;
    ctx!.globalCompositeOperation = "lighter";
    ctx!.fillStyle = `rgba(${vr},${vg},${vb},.28)`;
    for (let i = VORTEX; i--;) {
      const y = i / 235, k = (4 + Math.cos(i / 9 - T * 2)) * Math.cos(i / 35), e = y / 7 - 13;
      const d = Math.hypot(k, e) + Math.sin(e / 9 + T / 2) - 4;
      const q = 2 * Math.sin(k * 3) - (y / 35) * k * (9 + k * Math.sin(Math.cos(e) * 9 - d * 2 + T));
      const c = d - T;
      ctx!.fillRect(vox + (q + 40 * Math.cos(c) + 200) * vs, voy + (q * Math.sin(c) + d * 35) * vs, vp, vp);
    }
    ctx!.globalCompositeOperation = "source-over";

    // ---- node network + pulses --------------------------------------------
    const nodePx: Array<[number, number]> = nodes.map((n) => {
      n.a += dt * 0.00035 * n.sp;
      return [
        (n.bx + Math.cos(n.a) * 0.012) * w - px * 34,
        (n.by + Math.sin(n.a * 0.8) * 0.012) * h - py * 30,
      ];
    });
    const links: Array<[number, number]> = [];
    for (let i = 0; i < nodePx.length; i++) {
      for (let j = i + 1; j < nodePx.length; j++) {
        const d = Math.hypot(nodePx[i][0] - nodePx[j][0], nodePx[i][1] - nodePx[j][1]);
        if (d < 190) {
          links.push([i, j]);
          ctx!.strokeStyle = A((1 - d / 190) * 0.13); ctx!.lineWidth = 1;
          ctx!.beginPath(); ctx!.moveTo(nodePx[i][0], nodePx[i][1]); ctx!.lineTo(nodePx[j][0], nodePx[j][1]); ctx!.stroke();
        }
      }
    }
    for (const [x, y] of nodePx) {
      ctx!.fillStyle = A(0.55); ctx!.beginPath(); ctx!.arc(x, y, 1.8, 0, 6.28); ctx!.fill();
    }

    while (pulses.length < Math.round(6 * I) && links.length) {
      const [i, j] = links[Math.floor(R() * links.length)];
      pulses.push({ i, j, t: 0, sp: 0.00025 + R() * 0.0004 });
    }
    pulses = pulses.filter((p) => {
      if ((p.t += dt * p.sp) >= 1) return false;
      const a = nodePx[p.i], b = nodePx[p.j];
      if (!a || !b) return false;
      const x = a[0] + (b[0] - a[0]) * p.t, y = a[1] + (b[1] - a[1]) * p.t;
      ctx!.fillStyle = A(0.22); ctx!.beginPath(); ctx!.arc(x, y, 5.5, 0, 6.28); ctx!.fill();
      ctx!.fillStyle = A(0.95); ctx!.beginPath(); ctx!.arc(x, y, 2, 0, 6.28); ctx!.fill();
      return true;
    });

    // ---- satellites --------------------------------------------------------
    for (const st of sats) {
      const cx = w * 0.5 - px * 48, cy = h * st.cy - py * 40 - sy * 0.1;
      const rx = w * st.rx, ry = h * st.ry;
      ctx!.setLineDash([2, 8]); ctx!.strokeStyle = A(0.1); ctx!.lineWidth = 1;
      ctx!.beginPath(); ctx!.ellipse(cx, cy, rx, ry, 0, 0, 6.28); ctx!.stroke(); ctx!.setLineDash([]);
      const ang = st.ph + t * 0.001 * st.sp * (0.5 + I * 0.55);
      const x = cx + Math.cos(ang) * rx, y = cy + Math.sin(ang) * ry;
      let ni = 0, nd = 1e9;
      nodePx.forEach(([nx, ny], k) => {
        const d = Math.hypot(nx - x, ny - y);
        if (d < nd) { nd = d; ni = k; }
      });
      if (Math.sin(t * 0.0005 + st.ph * 2) > 0.25 && nodePx[ni]) {
        const [nx, ny] = nodePx[ni];
        const lg = ctx!.createLinearGradient(x, y, nx, ny);
        lg.addColorStop(0, A(0.28)); lg.addColorStop(1, A(0));
        ctx!.strokeStyle = lg; ctx!.lineWidth = 1;
        ctx!.beginPath(); ctx!.moveTo(x, y); ctx!.lineTo(nx, ny); ctx!.stroke();
        if (R() < dt * 0.0018) rings.push({ x: nx, y: ny, r: 2 });
      }
      ctx!.save(); ctx!.translate(x, y); ctx!.rotate(ang);
      ctx!.fillStyle = A(0.85); ctx!.fillRect(-4, -3, 8, 6);
      ctx!.fillStyle = A(0.4); ctx!.fillRect(-15, -2, 8, 4); ctx!.fillRect(7, -2, 8, 4);
      ctx!.restore();
      const bl = 0.5 + 0.5 * Math.sin(t * 0.007 + st.ph * 3);
      ctx!.fillStyle = `rgba(255,255,255,${0.25 + 0.6 * bl})`;
      ctx!.beginPath(); ctx!.arc(x, y - 6, 1.5, 0, 6.28); ctx!.fill();
    }

    rings = rings.filter((r) => {
      if ((r.r += dt * 0.045) > 80) return false;
      ctx!.strokeStyle = A((1 - r.r / 80) * 0.3); ctx!.lineWidth = 1.2;
      ctx!.beginPath(); ctx!.arc(r.x, r.y, r.r, 0, 6.28); ctx!.stroke();
      return true;
    });
  }

  let last = typeof performance !== "undefined" ? performance.now() : 0;
  let acc = 0;
  const loop = (now: number) => {
    // Re-arm FIRST. Returning early without this kills the loop permanently on
    // the first hidden frame — the exact v2.99.67 bug.
    raf = requestAnimationFrame(loop);
    const dt = Math.min(50, now - last);
    last = now;
    if (typeof document !== "undefined" && document.hidden) return;
    /* A LIVE CALL OWNS THE PHONE'S CPU, so stop painting for its duration. This
     * canvas is mounted by the app SHELL and the call UI is a fixed overlay on
     * top of it — the shell never unmounts — so without this gate a full-screen
     * animated scene keeps compositing at 30fps BEHIND a call, entirely invisible,
     * on the one screen where every spare cycle belongs to the video encoder.
     * Same shape as the hidden-tab gate above (re-armed first, so it RESUMES the
     * moment the call ends rather than dying), and read off the document because
     * the engine is raw DOM while this is React — a flag they can both see beats
     * threading state between them. */
    if (typeof document !== "undefined" && document.documentElement.dataset.relayInCall === "1") return;
    acc += dt;
    if (acc < FRAME_MS) return;
    const step = acc;
    acc = 0;
    draw(now, step);
  };
  raf = requestAnimationFrame(loop);

  return {
    setBusiness: (v: boolean) => { business = v; },
    setAccent: (v: string) => { accent = v; },
    setIntensity: (v: number) => { intensity = v; },
    destroy() {
      cancelAnimationFrame(raf);
      removeEventListener("mousemove", onMove);
      removeEventListener("mouseout", onOut);
      removeEventListener("scroll", onScroll);
      removeEventListener("resize", onResize);
    },
  };
}
