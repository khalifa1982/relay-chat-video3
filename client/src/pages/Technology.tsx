import { useEffect } from "react";
import { siteEmail, siteHost } from "@/lib/siteHost";

/**
 * "The technology behind RELAY" — a standalone, public marketing/info page.
 *
 * This is a faithful React port of the design the owner supplied
 * (relay-landing.html). It preserves the same content, structure, layout and
 * the four-act scroll journey (indigo dark → white → slate → dark), while
 * polishing typography rhythm, spacing and motion. It never touches the in-app
 * experience or any backend logic — CTAs point to /app and nav back to /.
 *
 * All page-specific CSS lives in the scoped <style> block below (prefixed with
 * `.tech-page`) so it can't leak into the rest of the site. The scroll-linked
 * effects (background cross-fade, transmission rail, reveals, counters, ticker,
 * the live hero exchange, and the mesh packet) are ported into a single effect
 * with full cleanup so React can mount/unmount the page cleanly.
 */
export default function Technology() {
  useEffect(() => {
    // Force dark background while this page is mounted (matches Act I/IV).
    const html = document.documentElement;
    const prevBg = document.body.style.backgroundColor;
    document.body.style.backgroundColor = "#0A0A1F";
    html.classList.add("tech-fx-on");

    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const fine = matchMedia("(pointer: fine)").matches;
    const root = document.getElementById("tech-root");
    if (!root) return;

    const $ = (s: string, c: ParentNode = root) => c.querySelector(s) as HTMLElement | null;
    const $$ = (s: string, c: ParentNode = root) => Array.from(c.querySelectorAll(s)) as HTMLElement[];

    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
    const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
    const smooth = (t: number) => t * t * (3 - 2 * t);
    const hex2rgb = (h: string) => {
      h = h.replace("#", "");
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)] as [number, number, number];
    };
    const mix = (c1: number[], c2: number[], t: number): [number, number, number] => [
      Math.round(lerp(c1[0], c2[0], t)),
      Math.round(lerp(c1[1], c2[1], t)),
      Math.round(lerp(c1[2], c2[2], t)),
    ];
    const rgbStr = (c: number[]) => `rgb(${c[0]},${c[1]},${c[2]})`;
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    let killed = false;
    const rafs: number[] = [];
    const timers: number[] = [];
    const raf = (cb: FrameRequestCallback) => {
      const id = requestAnimationFrame(cb);
      rafs.push(id);
      return id;
    };

    $$("section[id],div[id]").forEach((el) => (el.style.scrollMarginTop = "90px"));

    const sy = () => window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;

    /* ---- background cross-fade engine ---- */
    const actEls = $$(".tech-act");
    let acts: { top: number; bottom: number; bg: number[]; ink: number[]; ac: number[] }[] = [];
    let vh = innerHeight;
    function measure() {
      vh = innerHeight;
      acts = actEls.map((el) => {
        const r = el.getBoundingClientRect();
        return {
          top: r.top + sy(),
          bottom: r.bottom + sy(),
          bg: hex2rgb(el.dataset.bg || "#0A0A1F"),
          ink: hex2rgb(el.dataset.ink || "#F4F4FF"),
          ac: hex2rgb(el.dataset.accent || "#7C5CFF"),
        };
      });
    }
    let cur = { bg: hex2rgb("#0A0A1F"), ink: hex2rgb("#F4F4FF"), ac: hex2rgb("#7C5CFF") };
    function targetColors() {
      const anchor = sy() + vh * 0.5,
        Z = vh * 0.55;
      let i = acts.findIndex((a) => anchor < a.bottom);
      if (i < 0) i = acts.length - 1;
      let bg = acts[i].bg,
        ink = acts[i].ink,
        ac = acts[i].ac;
      if (i < acts.length - 1) {
        const b = acts[i + 1].top;
        if (anchor > b - Z / 2) {
          const t = smooth(clamp((anchor - (b - Z / 2)) / Z, 0, 1));
          bg = mix(acts[i].bg, acts[i + 1].bg, t);
          ink = mix(acts[i].ink, acts[i + 1].ink, t);
          ac = mix(acts[i].ac, acts[i + 1].ac, t);
        }
      }
      if (i > 0) {
        const b = acts[i].top;
        if (anchor < b + Z / 2) {
          const t = smooth(clamp((anchor - (b - Z / 2)) / Z, 0, 1));
          bg = mix(acts[i - 1].bg, acts[i].bg, t);
          ink = mix(acts[i - 1].ink, acts[i].ink, t);
          ac = mix(acts[i - 1].ac, acts[i].ac, t);
        }
      }
      return { bg, ink, ac };
    }
    const bgLayer = $("#tech-bgLayer");
    const nav = $("#tech-nav");
    const rail = $(".tech-rail");
    function applyColors() {
      const t = targetColors(),
        k = reduced ? 1 : 0.14;
      cur.bg = mix(cur.bg, t.bg, k);
      cur.ink = mix(cur.ink, t.ink, k);
      cur.ac = mix(cur.ac, t.ac, k);
      if (bgLayer) bgLayer.style.backgroundColor = rgbStr(cur.bg);
      document.body.style.backgroundColor = rgbStr(cur.bg);
      [nav, rail].forEach((el) => {
        if (!el) return;
        const s = el.style;
        s.setProperty("--ink", rgbStr(cur.ink));
        s.setProperty("--ink-rgb", cur.ink.join(","));
        s.setProperty("--bg-rgb", cur.bg.join(","));
        s.setProperty("--accent", rgbStr(cur.ac));
      });
    }

    /* ---- transmission rail ---- */
    const railPkt = $("#tech-railPkt");
    function railTick() {
      if (!rail || !railPkt) return;
      const p = clamp(sy() / (document.documentElement.scrollHeight - vh), 0, 1);
      railPkt.style.top = p * rail.offsetHeight + "px";
    }

    /* ---- nav ---- */
    function navTick() {
      if (nav) nav.classList.toggle("scrolled", sy() > 30);
    }

    /* ---- parallax ---- */
    const paraItems = [
      { el: $(".tech-hero-glow"), f: -0.06 },
      { el: $(".tech-hero-glow.g2"), f: 0.05 },
      { el: $("#tech-meshEdges"), f: 0.045 },
      { el: $("#tech-meshNodes"), f: 0.09 },
    ].filter((o) => o.el) as { el: HTMLElement; f: number }[];
    function paraTick() {
      if (reduced) return;
      paraItems.forEach((o) => {
        const host = o.el.closest("section") || o.el;
        const r = host.getBoundingClientRect();
        const off = (r.top + r.height / 2 - vh / 2) * o.f;
        o.el.style.transform = `translateY(${off.toFixed(1)}px)`;
      });
    }

    function loop() {
      if (killed) return;
      applyColors();
      railTick();
      paraTick();
      raf(loop);
    }
    const onScroll = () => navTick();
    const onResize = () => {
      measure();
      sizeWire();
      railTick();
    };
    addEventListener("scroll", onScroll, { passive: true });
    addEventListener("resize", onResize, { passive: true });
    measure();
    navTick();
    raf(loop);

    /* ---- reveals ---- */
    const io = new IntersectionObserver(
      (es) =>
        es.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("in");
            io.unobserve(e.target);
          }
        }),
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" }
    );
    $$(".tech-reveal").forEach((el) => io.observe(el));
    timers.push(
      window.setTimeout(() => {
        if (!root.querySelector(".tech-reveal.in")) $$(".tech-reveal").forEach((el) => el.classList.add("in"));
      }, 2000)
    );

    /* ---- counters ---- */
    const cio = new IntersectionObserver(
      (es) =>
        es.forEach((e) => {
          if (!e.isIntersecting) return;
          cio.unobserve(e.target);
          const el = e.target as HTMLElement;
          const to = +(el.dataset.to || "0");
          if (reduced) {
            el.textContent = String(to);
            return;
          }
          const t0 = performance.now(),
            D = 1400;
          const step = (t: number) => {
            const p = clamp((t - t0) / D, 0, 1),
              ease = 1 - Math.pow(1 - p, 3);
            el.textContent = String(Math.round(to * ease));
            if (p < 1) raf(step);
          };
          raf(step);
        }),
      { threshold: 0.6 }
    );
    $$(".tech-count").forEach((el) => cio.observe(el));

    /* ---- latency bars ---- */
    const lat = $("#tech-lat");
    if (lat) {
      const lio = new IntersectionObserver(
        (es) =>
          es.forEach((e) => {
            if (!e.isIntersecting) return;
            lio.unobserve(lat);
            $$(".tech-fill", lat).forEach((f) => (f.style.width = f.dataset.w || "0"));
          }),
        { threshold: 0.35 }
      );
      lio.observe(lat);
    }

    /* ---- delivered chip ---- */
    const del = $("#tech-delivered"),
      get = $("#tech-get");
    if (del && get) {
      const dio = new IntersectionObserver(
        (es) =>
          es.forEach((e) => {
            if (e.isIntersecting) {
              timers.push(window.setTimeout(() => del.classList.add("on"), 800));
              dio.unobserve(get);
            }
          }),
        { threshold: 0.35 }
      );
      dio.observe(get);
    }

    /* ---- ticker (seamless) ---- */
    const tt = $("#tech-tickTrack");
    if (tt) tt.innerHTML += tt.innerHTML;

    /* ---- hero live P2P exchange ---- */
    const stage = $("#tech-stage"),
      wire = $(".tech-wire"),
      wpath = $("#tech-wirePath") as unknown as SVGPathElement | null,
      pkt = $("#tech-pkt"),
      colA = $("#tech-colA"),
      colB = $("#tech-colB"),
      typA = $("#tech-typA"),
      typB = $("#tech-typB"),
      devL = $(".tech-device.left"),
      devR = $(".tech-device.right");
    function sizeWire() {
      if (!stage || !wire || !wpath || !devL || !devR) return;
      const s = stage.getBoundingClientRect(),
        L = devL.getBoundingClientRect(),
        R = devR.getBoundingClientRect();
      wire.setAttribute("width", String(s.width));
      wire.setAttribute("height", String(s.height));
      let d: string;
      if (innerWidth <= 560) {
        const x1 = L.left - s.left + L.width * 0.5,
          y1 = L.bottom - s.top + 6;
        const x2 = R.left - s.left + R.width * 0.5,
          y2 = R.top - s.top - 6;
        d = `M ${x1} ${y1} C ${x1} ${y1 + 50}, ${x2} ${y2 - 50}, ${x2} ${y2}`;
      } else {
        const x1 = L.right - s.left + 6,
          y1 = L.top - s.top + L.height * 0.5;
        const x2 = R.left - s.left - 6,
          y2 = R.top - s.top + R.height * 0.5;
        const mx = (x1 + x2) / 2;
        d = `M ${x1} ${y1} C ${mx} ${y1 + 46}, ${mx} ${y2 + 46}, ${x2} ${y2}`;
      }
      wpath.setAttribute("d", d);
    }
    const lockSVG =
      '<svg class="tech-lock" viewBox="0 0 10 10" aria-hidden="true"><rect x="1.5" y="4.2" width="7" height="5" rx="1.2" fill="currentColor"/><path d="M3.1 4.2V3a1.9 1.9 0 0 1 3.8 0v1.2" stroke="currentColor" stroke-width="1" fill="none"/></svg>';
    function bubble(col: HTMLElement, cls: string, text: string, withTicks: boolean) {
      const b = document.createElement("div");
      b.className = "tech-bub " + cls;
      b.innerHTML = `<span class="txt"></span><span class="meta">${lockSVG}${withTicks ? '<span class="ticks">✓✓</span>' : ""}</span>`;
      (b.querySelector(".txt") as HTMLElement).textContent = text;
      col.appendChild(b);
      raf(() => raf(() => b.classList.add("show")));
      return b;
    }
    function travel(rev: boolean) {
      return new Promise<void>((res) => {
        if (!wpath || !pkt) {
          res();
          return;
        }
        const len = wpath.getTotalLength();
        if (!len) {
          res();
          return;
        }
        pkt.style.opacity = "1";
        const t0 = performance.now(),
          D = 520;
        const step = (t: number) => {
          const p = clamp((t - t0) / D, 0, 1);
          const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
          const pos = wpath.getPointAtLength((rev ? 1 - e : e) * len);
          pkt.style.transform = `translate(${pos.x}px,${pos.y}px)`;
          pkt.classList.toggle("mid", p > 0.2 && p < 0.8);
          if (p < 1) raf(step);
          else {
            pkt.style.opacity = "0";
            res();
          }
        };
        raf(step);
      });
    }
    async function heroLoop() {
      if (!stage || !colA || !colB || !typA || !typB) return;
      sizeWire();
      if (reduced) {
        bubble(colA, "me", "You seeing this latency?", true).classList.add("show");
        bubble(colB, "you", "You seeing this latency?", false).classList.add("show");
        bubble(colB, "me", "Saw it before you sent it ⚡", true).classList.add("show");
        bubble(colA, "you", "Saw it before you sent it ⚡", false).classList.add("show");
        $$(".ticks", stage).forEach((t) => t.classList.add("ok"));
        return;
      }
      while (!killed) {
        await sleep(700);
        if (killed) break;
        typA.classList.add("show");
        await sleep(1000);
        typA.classList.remove("show");
        const a1 = bubble(colA, "me", "You seeing this latency?", true);
        await sleep(280);
        await travel(false);
        bubble(colB, "you", "You seeing this latency?", false);
        a1.querySelector(".ticks")?.classList.add("ok");
        await sleep(900);
        if (killed) break;
        typB.classList.add("show");
        await sleep(1000);
        typB.classList.remove("show");
        const b1 = bubble(colB, "me", "Saw it before you sent it ⚡", true);
        await sleep(280);
        await travel(true);
        bubble(colA, "you", "Saw it before you sent it ⚡", false);
        b1.querySelector(".ticks")?.classList.add("ok");
        await sleep(2600);
        if (killed) break;
        $$(".tech-bub", stage).forEach((b) => b.classList.remove("show"));
        await sleep(500);
        colA.innerHTML = "";
        colB.innerHTML = "";
      }
    }
    heroLoop();

    /* ---- mesh packet ---- */
    const meshPkt = $("#tech-meshPkt") as unknown as SVGCircleElement | null;
    if (meshPkt && !reduced) {
      const N = [
        [70, 90],
        [210, 60],
        [350, 130],
        [130, 270],
        [210, 210],
        [280, 290],
      ];
      const E = [
        [0, 1],
        [1, 2],
        [0, 3],
        [1, 4],
        [2, 5],
        [3, 5],
        [0, 4],
        [4, 5],
        [2, 4],
      ];
      const C = ["#7C5CFF", "#FF3D63", "#2FB8C9"];
      let from = 4;
      meshPkt.setAttribute("cx", String(N[4][0]));
      meshPkt.setAttribute("cy", String(N[4][1]));
      (async function hop() {
        while (!killed) {
          const opts = E.filter((e) => e.includes(from));
          const e = opts[(Math.random() * opts.length) | 0];
          const to = e[0] === from ? e[1] : e[0];
          meshPkt.setAttribute("fill", C[(Math.random() * C.length) | 0]);
          const t0 = performance.now(),
            D = 900,
            [x1, y1] = N[from],
            [x2, y2] = N[to];
          await new Promise<void>((res) => {
            const step = (t: number) => {
              const p = clamp((t - t0) / D, 0, 1),
                s = smooth(p);
              meshPkt.setAttribute("cx", String(lerp(x1, x2, s)));
              meshPkt.setAttribute("cy", String(lerp(y1, y2, s)));
              if (p < 1) raf(step);
              else res();
            };
            raf(step);
          });
          from = to;
          await sleep(400);
        }
      })();
    }

    /* ---- magnetic buttons ---- */
    const magHandlers: { el: HTMLElement; move: (e: MouseEvent) => void; leave: () => void }[] = [];
    if (fine && !reduced) {
      $$(".tech-magnetic").forEach((btn) => {
        const move = (e: MouseEvent) => {
          const r = btn.getBoundingClientRect();
          const x = (e.clientX - r.left - r.width / 2) / r.width,
            y = (e.clientY - r.top - r.height / 2) / r.height;
          btn.style.transform = `translate(${(x * 10).toFixed(1)}px,${(y * 8).toFixed(1)}px)`;
        };
        const leave = () => (btn.style.transform = "");
        btn.addEventListener("mousemove", move);
        btn.addEventListener("mouseleave", leave);
        magHandlers.push({ el: btn, move, leave });
      });
    }

    /* re-measure after layout settles */
    const onLoad = () => {
      measure();
      sizeWire();
      railTick();
    };
    addEventListener("load", onLoad);
    timers.push(
      window.setTimeout(() => {
        measure();
        sizeWire();
      }, 600)
    );

    return () => {
      killed = true;
      rafs.forEach((id) => cancelAnimationFrame(id));
      timers.forEach((id) => clearTimeout(id));
      removeEventListener("scroll", onScroll);
      removeEventListener("resize", onResize);
      removeEventListener("load", onLoad);
      io.disconnect();
      cio.disconnect();
      magHandlers.forEach(({ el, move, leave }) => {
        el.removeEventListener("mousemove", move);
        el.removeEventListener("mouseleave", leave);
      });
      html.classList.remove("tech-fx-on");
      document.body.style.backgroundColor = prevBg;
    };
  }, []);

  return (
    <div id="tech-root" className="tech-page">
      <style>{TECH_CSS}</style>

      <div id="tech-bgLayer" aria-hidden="true" />
      <div className="tech-grain" aria-hidden="true" />

      {/* signature transmission rail */}
      <div className="tech-rail" aria-hidden="true">
        <span className="tech-rail-cap" />
        <span className="tech-packet-dot" id="tech-railPkt" />
        <span className="tech-rail-cap b" />
      </div>

      {/* nav */}
      <nav className="tech-nav" id="tech-nav">
        <a className="tech-logo" href="/" aria-label="RELAY home">
          <span className="tech-pulse" aria-hidden="true" />
          RELAY
        </a>
        <div className="tech-nav-links">
          <a href="#why">Features</a>
          <a href="#how">How it works</a>
          <a href="#security">Security</a>
        </div>
        <a className="tech-btn tech-btn-primary tech-btn-sm tech-magnetic" href="/app">
          <span>Get RELAY</span>
        </a>
      </nav>

      {/* ============ ACT I — HERO ============ */}
      <section className="tech-act tech-hero on-dark" id="top" data-bg="#0A0A1F" data-ink="#F4F4FF" data-accent="#7C5CFF">
        <div className="tech-hero-glow" aria-hidden="true" />
        <div className="tech-hero-glow g2" aria-hidden="true" />
        <div className="tech-wrap">
          <div className="tech-hero-copy">
            <p className="tech-eyebrow tech-reveal">The technology behind RELAY · {siteHost()}</p>
            <h1 className="tech-h-display tech-reveal d1">
              Zero <em className="tech-em-grad">latency</em>.<br />
              Zero <em className="tech-em-grad">listeners</em>.
            </h1>
            <p className="tech-lede tech-reveal d2">
              RELAY routes your words directly between devices — end-to-end encrypted, peer to peer, in milliseconds. No
              servers in the middle. No copies left behind. Just the two of you, in real time.
            </p>
            <div className="tech-hero-ctas tech-reveal d3">
              <a className="tech-btn tech-btn-primary tech-btn-lg tech-magnetic" href="/app">
                <span>Get RELAY — it's free</span>
                <span className="arr">→</span>
              </a>
              <a className="tech-btn tech-btn-ghost tech-magnetic" href="#how">
                <span>See how it works</span>
              </a>
            </div>
            <p className="tech-hero-note tech-reveal d4">iOS · Android · macOS · Windows · Web</p>
          </div>
          <div className="tech-stage tech-reveal d3" id="tech-stage" aria-label="Live demo of two devices exchanging encrypted messages directly">
            <svg className="tech-wire" aria-hidden="true">
              <path id="tech-wirePath" d="" />
            </svg>
            <div className="tech-pkt" id="tech-pkt" aria-hidden="true">
              <span className="tech-pkt-dot" />
              <span className="tech-pkt-ms mono">sealed · 12 ms</span>
            </div>
            <div className="tech-device left">
              <div className="tech-d-top">
                <span className="mono">AMAL</span>
                <span className="tech-online" aria-hidden="true" />
              </div>
              <div className="tech-d-screen">
                <div id="tech-colA" style={{ display: "contents" }} />
                <div className="tech-typing" id="tech-typA" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </div>
              </div>
            </div>
            <div className="tech-device right">
              <div className="tech-d-top">
                <span className="mono">ZAYD</span>
                <span className="tech-online" aria-hidden="true" />
              </div>
              <div className="tech-d-screen">
                <div id="tech-colB" style={{ display: "contents" }} />
                <div className="tech-typing" id="tech-typB" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ticker */}
      <div className="tech-act on-dark" data-bg="#0A0A1F" data-ink="#F4F4FF" data-accent="#7C5CFF" style={{ padding: 0 }}>
        <div className="tech-ticker" aria-hidden="true">
          <div className="tech-ticker-track" id="tech-tickTrack">
            <span>End-to-end encrypted <b>✦</b></span>
            <span>Zero-latency routing <b>✦</b></span>
            <span>No servers, no logs <b>✦</b></span>
            <span>Peer to peer <b>✦</b></span>
            <span>Open protocol <b>✦</b></span>
            <span>Forward secrecy <b>✦</b></span>
            <span>256-bit sealing <b>✦</b></span>
          </div>
        </div>
      </div>

      {/* ============ ACT II — WHY RELAY (white) ============ */}
      <section className="tech-act tech-why on-light" id="why" data-bg="#FAFAF7" data-ink="#10101F" data-accent="#7C5CFF">
        <div className="tech-wrap">
          <div className="tech-sect-head">
            <div>
              <p className="tech-eyebrow tech-reveal">Why RELAY</p>
              <h2 className="tech-h-sect tech-reveal d1">
                Built like a <em>whisper</em>, delivered like <em>lightning</em>.
              </h2>
            </div>
            <p className="tech-lede tech-reveal d2">
              Every chat app promises fast and private. RELAY removes the one thing that makes both impossible — the
              middleman. What's left is the shortest, quietest line between two people.
            </p>
          </div>

          <div className="tech-grid">
            <article className="tech-card tech-reveal">
              <div className="tech-card-visual t-violet" aria-hidden="true">
                <svg viewBox="0 0 60 60">
                  <path className="ic draw" d="M33 6 14 34h13l-4 20 21-30H30z" />
                </svg>
              </div>
              <div className="tech-card-body">
                <h3>Zero-latency engine</h3>
                <p>
                  Direct device-to-device routing cuts out the round trip to a datacenter. Your message takes the
                  shortest live path — and arrives while others are still connecting.
                </p>
                <p className="more">→ Median delivery: 12 ms on local networks</p>
              </div>
            </article>

            <article className="tech-card tech-reveal d1">
              <div className="tech-card-visual t-cyan" aria-hidden="true">
                <svg viewBox="0 0 60 60">
                  <rect className="ic" x="16" y="26" width="28" height="22" rx="4" />
                  <path className="ic hover-float" d="M22 26v-7a8 8 0 0 1 16 0v7" />
                  <circle cx="30" cy="37" r="2.4" fill="#0A0A1F" stroke="none" />
                </svg>
              </div>
              <div className="tech-card-body">
                <h3>Sealed end to end</h3>
                <p>
                  Every message is encrypted on your device before it moves, with keys that never leave your hardware.
                  Not even RELAY can read RELAY.
                </p>
                <p className="more">→ X25519 key exchange · AES-256 sealing</p>
              </div>
            </article>

            <article className="tech-card tech-reveal d2">
              <div className="tech-card-visual t-coral" aria-hidden="true">
                <svg viewBox="0 0 60 60">
                  <rect className="ic" x="12" y="14" width="36" height="12" rx="3" />
                  <rect className="ic" x="12" y="34" width="36" height="12" rx="3" opacity=".35" />
                  <circle className="blink" cx="19" cy="20" r="1.8" fill="#0A0A1F" stroke="none" />
                  <path className="ic draw" d="M10 52 50 8" />
                </svg>
              </div>
              <div className="tech-card-body">
                <h3>No servers, no logs</h3>
                <p>
                  There is no middle. Messages exist only on the devices that sent and received them — nothing to store,
                  nothing to subpoena, nothing to leak.
                </p>
                <p className="more">→ 0 message servers · 0 metadata retained</p>
              </div>
            </article>

            <article className="tech-card tech-reveal">
              <div className="tech-card-visual t-amber" aria-hidden="true">
                <svg viewBox="0 0 60 60">
                  <rect className="ic" x="8" y="16" width="24" height="17" rx="3" />
                  <rect className="ic" x="36" y="22" width="15" height="24" rx="3.5" />
                  <circle className="sync-dot" cx="18" cy="43" r="2.6" fill="#0A0A1F" stroke="none" />
                  <path className="ic" d="M14 43h32" opacity=".3" />
                </svg>
              </div>
              <div className="tech-card-body">
                <h3>Every device, one thread</h3>
                <p>
                  Phone, desktop, web — your conversations follow you and stay sealed on each device. Pick up
                  mid-sentence anywhere.
                </p>
                <p className="more">→ Synced peer-to-peer, never through a cloud</p>
              </div>
            </article>

            <article className="tech-card tech-reveal d1">
              <div className="tech-card-visual t-lime" aria-hidden="true">
                <svg viewBox="0 0 60 60">
                  <circle className="ic" cx="30" cy="14" r="4" />
                  <circle className="ic" cx="12" cy="40" r="4" />
                  <circle className="ic" cx="48" cy="40" r="4" />
                  <circle className="ic" cx="30" cy="48" r="4" />
                  <path className="ic blink" d="M27 17 15 37m18-20 12 20M16 41l10 6m18-6-10 6" />
                </svg>
              </div>
              <div className="tech-card-body">
                <h3>Group mesh</h3>
                <p>
                  Rooms scale from two friends to your whole team — every member is a node, so there's no single point
                  of failure and no single point of listening.
                </p>
                <p className="more">→ Each peer relays; the room heals itself</p>
              </div>
            </article>

            <article className="tech-card tech-reveal d2">
              <div className="tech-card-visual t-mix" aria-hidden="true">
                <svg viewBox="0 0 60 60">
                  <path className="ic draw" d="M22 18 10 30l12 12" />
                  <path className="ic draw" d="M38 18 50 30 38 42" />
                  <path className="ic" d="M33 14 27 46" opacity=".4" />
                </svg>
              </div>
              <div className="tech-card-body">
                <h3>Open protocol</h3>
                <p>
                  RELAY's wire protocol is published, versioned and auditable. Trust the math and the code — not the
                  marketing.
                </p>
                <p className="more">→ Spec + reference clients on the site</p>
              </div>
            </article>
          </div>

          {/* latency strip */}
          <div className="tech-lat tech-reveal" id="tech-lat">
            <h3>
              The middleman <em className="tech-serif-em">was</em> the lag.
            </h3>
            <p className="sub">
              A typical cloud chat sends your message to a datacenter, queues it, logs it, then forwards it on. RELAY
              skips the trip entirely.
            </p>
            <div className="tech-lat-row">
              <label>Typical cloud chat</label>
              <div className="tech-track">
                <div className="tech-fill slow" data-w="96%" />
              </div>
              <span className="tech-lat-ms">
                <span className="tech-count" data-to="240">0</span> ms
              </span>
            </div>
            <div className="tech-lat-row">
              <label>RELAY · P2P</label>
              <div className="tech-track">
                <div className="tech-fill fast" data-w="6%" />
              </div>
              <span className="tech-lat-ms hot">
                <span className="tech-count" data-to="12">0</span> ms
              </span>
            </div>
            <p className="tech-lat-note">MEDIAN ONE-WAY DELIVERY · SAME-REGION PEERS · YOUR MILEAGE WILL BE MEASURABLE</p>
          </div>
        </div>
      </section>

      {/* ============ ACT III — HOW IT WORKS (slate) ============ */}
      <section className="tech-act tech-how on-slate" id="how" data-bg="#D3D7DC" data-ink="#12121C" data-accent="#FF3D63">
        <div className="tech-wrap">
          <p className="tech-eyebrow tech-reveal">How it works</p>
          <h2 className="tech-h-sect tech-reveal d1">
            Three moves.
            <br />
            No middle.
          </h2>
          <div className="tech-how-grid">
            <div>
              <div className="tech-step tech-reveal">
                <span className="n">01 — PAIR</span>
                <h3>Devices meet directly</h3>
                <p>
                  Scan a code or tap a link. Your devices exchange public keys with each other — RELAY only introduces
                  them, it never holds the keys.
                </p>
              </div>
              <div className="tech-step tech-reveal d1">
                <span className="n">02 — SEAL</span>
                <h3>Encrypted before it moves</h3>
                <p>
                  Each message is sealed on your device with a fresh key. Forward secrecy means yesterday's messages
                  stay safe even if a key leaks tomorrow.
                </p>
              </div>
              <div className="tech-step tech-reveal d2">
                <span className="n">03 — RELAY</span>
                <h3>The shortest live path</h3>
                <p>
                  Messages travel peer to peer over the fastest available route. If a friend is offline, the sealed
                  parcel waits at the network edge — unopened, unread — until they return.
                </p>
              </div>
            </div>
            <div className="tech-mesh-box tech-reveal d2" aria-hidden="true">
              <svg id="tech-mesh" viewBox="0 0 420 380">
                <g className="p-slow" id="tech-meshEdges" stroke="#12121C" strokeOpacity=".22" strokeWidth="1.2" fill="none">
                  <path d="M70 90 210 60m0 0 140 70M70 90l60 180m80-210 0 150m140-80-70 160m-150-50 150 50M70 90l140 150" />
                </g>
                <g className="p-fast" id="tech-meshNodes">
                  <circle cx="70" cy="90" r="9" fill="#7C5CFF" />
                  <circle cx="210" cy="60" r="7" fill="#12121C" />
                  <circle cx="350" cy="130" r="9" fill="#FF3D63" />
                  <circle cx="130" cy="270" r="7" fill="#12121C" />
                  <circle cx="210" cy="210" r="11" fill="#2FB8C9" />
                  <circle cx="280" cy="290" r="7" fill="#12121C" />
                </g>
                <circle id="tech-meshPkt" r="5" fill="#FF3D63" />
              </svg>
              <p className="tech-mesh-cap">Every peer is a node · no single point of failure</p>
            </div>
          </div>
        </div>
      </section>

      {/* security */}
      <section className="tech-act tech-security on-slate" id="security" data-bg="#D3D7DC" data-ink="#12121C" data-accent="#FF3D63">
        <div className="tech-wrap">
          <p className="tech-eyebrow tech-reveal">Security, in plain words</p>
          <h2 className="tech-h-sect tech-reveal d1">
            Private by <em>architecture</em>, not by promise.
          </h2>
          <div className="tech-sec-list tech-reveal d2">
            <details className="tech-sec">
              <summary>
                End-to-end encryption <span className="plus">+</span>
              </summary>
              <div className="sec-body">
                <p>
                  Messages are encrypted on your device and decrypted only on the recipient's. Anyone in between —
                  networks, ISPs, even RELAY itself — sees sealed noise.
                </p>
                <span className="mono">X25519 · AES-256-GCM · HMAC-SHA256</span>
              </div>
            </details>
            <details className="tech-sec">
              <summary>
                Perfect forward secrecy <span className="plus">+</span>
              </summary>
              <div className="sec-body">
                <p>
                  Keys rotate with every message. Compromising one key exposes one message — never your history, never
                  your future.
                </p>
                <span className="mono">Double-ratchet key rotation, per message</span>
              </div>
            </details>
            <details className="tech-sec">
              <summary>
                Zero-knowledge accounts <span className="plus">+</span>
              </summary>
              <div className="sec-body">
                <p>
                  Sign up with nothing but a username. No phone number, no email, no contact-book upload. RELAY can't
                  sell what RELAY never collects.
                </p>
                <span className="mono">No PII required · no ads · no trackers</span>
              </div>
            </details>
            <details className="tech-sec">
              <summary>
                Disappearing messages <span className="plus">+</span>
              </summary>
              <div className="sec-body">
                <p>
                  Set any conversation to burn after reading — from five seconds to one week. Deletion happens on every
                  device in the thread, verifiably.
                </p>
                <span className="mono">Per-thread timers · synced erasure</span>
              </div>
            </details>
            <details className="tech-sec">
              <summary>
                Open &amp; auditable <span className="plus">+</span>
              </summary>
              <div className="sec-body">
                <p>
                  The protocol specification and reference clients are published for anyone to inspect. Independent
                  review is invited, not feared.
                </p>
                <span className="mono">Spec v1.4 · reference clients public</span>
              </div>
            </details>
          </div>

          <div className="tech-stats">
            <div className="tech-stat tech-reveal">
              <div className="val">
                <span className="tech-count" data-to="12">0</span>
                <small> ms</small>
              </div>
              <div className="lab">Median delivery</div>
            </div>
            <div className="tech-stat tech-reveal d1">
              <div className="val">0</div>
              <div className="lab">Servers holding your words</div>
            </div>
            <div className="tech-stat tech-reveal d2">
              <div className="val">
                <span className="tech-count" data-to="256">0</span>
                <small>-bit</small>
              </div>
              <div className="lab">Message sealing</div>
            </div>
            <div className="tech-stat tech-reveal d3">
              <div className="val">
                100<small>%</small>
              </div>
              <div className="lab">Yours, and only yours</div>
            </div>
          </div>
        </div>
      </section>

      {/* ============ ACT IV — FINAL CTA + FOOTER (dark) ============ */}
      <section className="tech-act tech-final on-dark accent-cyan" id="tech-get" data-bg="#0A0A1F" data-ink="#F4F4FF" data-accent="#2FD4E6">
        <div className="tech-wrap">
          <p className="tech-eyebrow tech-reveal" style={{ justifyContent: "center" }}>
            Ready when you are
          </p>
          <h2 className="tech-h-display tech-reveal d1">
            Say it in <em className="tech-em-grad">real time</em>.
          </h2>
          <p className="tech-lede tech-reveal d2" style={{ textAlign: "center" }}>
            RELAY is free on iOS, Android, macOS, Windows and the web. Pair your first device in under a minute — the
            future of instant, secure communication is already yours.
          </p>
          <div className="tech-final-ctas tech-reveal d3">
            <a className="tech-btn tech-btn-primary tech-btn-lg tech-magnetic" href="/app" aria-label="Get RELAY">
              <span>Get RELAY</span>
              <span className="arr">→</span>
            </a>
            <a className="tech-btn tech-btn-ghost tech-magnetic" href="#security">
              <span>Read the protocol</span>
            </a>
          </div>
          <p className="tech-delivered" id="tech-delivered">
            <span className="dd">✓✓</span> DELIVERED · SEALED · 12 MS
          </p>
        </div>

        <footer className="tech-footer tech-wrap">
          <div className="tech-ghost" aria-hidden="true">
            RELAY
          </div>
          <div className="tech-foot-grid">
            <div className="tech-foot-col">
              <h4>Product</h4>
              <a href="#why">Features</a>
              <a href="#how">How it works</a>
              <a href="#security">Security</a>
            </div>
            <div className="tech-foot-col">
              <h4>Protocol</h4>
              <a href="#security">Specification</a>
              <a href="#security">Reference clients</a>
              <a href="#security">Audit notes</a>
            </div>
            <div className="tech-foot-col">
              <h4>Get RELAY</h4>
              <a href="/app">iOS &amp; Android</a>
              <a href="/app">macOS &amp; Windows</a>
              <a href="/app">Web app</a>
            </div>
            <div className="tech-foot-col">
              <h4>Contact</h4>
              <a href={`mailto:${siteEmail("hello")}`}>{siteEmail("hello")}</a>
              <a href="/">{siteHost()}</a>
            </div>
          </div>
          <div className="tech-foot-bottom">
            <span>© 2026 RELAY — {siteHost().toUpperCase()}</span>
            <a href="/" className="tech-back-home">
              ← Back to home
            </a>
            <span>ZERO LATENCY · ZERO LISTENERS</span>
          </div>
        </footer>
      </section>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Scoped page CSS (ported from the owner's relay-landing.html, prefixed with */
/*  `.tech-page` so it can never leak into the app or the landing page).       */
/* -------------------------------------------------------------------------- */
const TECH_CSS = `
.tech-page{
  --bg:#0A0A1F; --ink:#F4F4FF; --ink-rgb:244,244,255; --bg-rgb:10,10,31; --accent:#7C5CFF;
  --violet:#7C5CFF; --cyan:#2FD4E6; --coral:#FF5C7A; --amber:#FFB454; --lime:#B8F04C;
  --grad:linear-gradient(92deg,var(--violet) 0%,var(--cyan) 48%,var(--coral) 100%);
  --sans:'Space Grotesk',system-ui,-apple-system,sans-serif;
  --serif:'Instrument Serif',Georgia,'Times New Roman',serif;
  --mono:'Space Mono',ui-monospace,'SF Mono',monospace;
  --ease:cubic-bezier(.16,1,.3,1);
  --pad:clamp(1.25rem,4vw,3.5rem);
  --maxw:1240px;
  color:var(--ink); font:400 17px/1.65 var(--sans);
  -webkit-font-smoothing:antialiased; text-rendering:optimizeLegibility;
  position:relative; min-height:100vh; overflow-x:hidden;
}
.tech-page *,.tech-page *::before,.tech-page *::after{box-sizing:border-box;margin:0;padding:0}
.tech-page ::selection{background:var(--accent);color:#0A0A1F}
.tech-page img,.tech-page svg{display:block;max-width:100%}
.tech-page a{color:inherit;text-decoration:none}
.tech-page button{font:inherit;color:inherit;background:none;border:0;cursor:pointer}
.tech-page :focus-visible{outline:2px solid var(--accent);outline-offset:3px;border-radius:4px}
.tech-page .mono{font-family:var(--mono)}

.tech-grain{position:fixed;inset:-50%;z-index:3;pointer-events:none;opacity:.035;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)'/%3E%3C/svg%3E");}

.tech-rail{position:fixed;left:2rem;top:9vh;bottom:9vh;width:1px;z-index:5;
  background:rgba(var(--ink-rgb),.14);pointer-events:none}
.tech-packet-dot{position:absolute;left:50%;top:0;width:9px;height:9px;border-radius:50%;
  transform:translate(-50%,-50%);background:var(--accent);
  box-shadow:0 0 12px var(--accent),0 0 28px var(--accent);}
.tech-rail-cap{position:absolute;left:50%;width:5px;height:5px;border-radius:50%;
  transform:translateX(-50%);background:rgba(var(--ink-rgb),.35)}
.tech-rail-cap.b{bottom:0}
@media (max-width:960px){.tech-rail{display:none}}

.tech-nav{position:fixed;inset:0 0 auto 0;z-index:50;display:flex;align-items:center;
  justify-content:space-between;padding:1.1rem var(--pad);
  transition:background .4s,border-color .4s,padding .4s;border-bottom:1px solid transparent}
.tech-nav.scrolled{background:rgba(var(--bg-rgb),.72);
  -webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);
  border-bottom-color:rgba(var(--ink-rgb),.08);padding-top:.8rem;padding-bottom:.8rem}
.tech-logo{display:flex;align-items:center;gap:.55rem;font-weight:700;letter-spacing:.14em;font-size:1.05rem}
.tech-pulse{width:9px;height:9px;border-radius:50%;background:var(--grad);
  box-shadow:0 0 10px rgba(124,92,255,.8);animation:techpulse 2.6s ease-in-out infinite}
@keyframes techpulse{0%,100%{transform:scale(1)}50%{transform:scale(1.35)}}
.tech-nav-links{display:flex;gap:2.2rem;font-size:.86rem;letter-spacing:.04em}
.tech-nav-links a{opacity:.72;transition:opacity .3s,color .3s;position:relative}
.tech-nav-links a:hover{opacity:1;color:var(--accent)}
@media (max-width:760px){.tech-nav-links{display:none}}

.tech-btn{display:inline-flex;align-items:center;gap:.6rem;border-radius:999px;padding:.85rem 1.7rem;
  font-weight:500;font-size:.95rem;letter-spacing:.02em;
  transition:transform .35s var(--ease),box-shadow .35s,border-color .3s,background .3s;will-change:transform}
.tech-btn-primary{background:var(--grad);color:#0A0A1F;font-weight:700}
.tech-btn-primary:hover{box-shadow:0 8px 34px rgba(124,92,255,.45),0 2px 14px rgba(255,92,122,.3)}
.tech-btn-ghost{border:1px solid rgba(var(--ink-rgb),.28);color:var(--ink)}
.tech-btn-ghost:hover{border-color:var(--accent);color:var(--accent)}
.tech-btn-sm{padding:.55rem 1.15rem;font-size:.82rem}
.tech-btn-lg{padding:1.05rem 2.3rem;font-size:1.05rem}
.tech-btn .arr{transition:transform .35s var(--ease)}
.tech-btn:hover .arr{transform:translateX(4px)}

.tech-eyebrow{font-family:var(--mono);font-size:.7rem;letter-spacing:.32em;text-transform:uppercase;
  color:var(--accent);display:flex;align-items:center;gap:.9rem;margin-bottom:1.6rem}
.tech-eyebrow::before{content:"";width:34px;height:1px;background:var(--accent)}
.tech-page h1,.tech-page h2{font-weight:500;letter-spacing:-.03em}
.tech-h-display{font-size:clamp(3rem,8.5vw,7.6rem);line-height:.98}
.tech-h-sect{font-size:clamp(2.1rem,5vw,4.2rem);line-height:1.04;max-width:16ch}
.tech-page h1 em,.tech-page h2 em,.tech-serif-em{font-family:var(--serif);font-style:italic;font-weight:400;letter-spacing:-.01em}
.tech-em-grad{background:var(--grad);-webkit-background-clip:text;background-clip:text;color:transparent}
.tech-lede{font-size:clamp(1.02rem,1.6vw,1.22rem);line-height:1.7;opacity:.78;max-width:52ch}

#tech-bgLayer{position:fixed;inset:0;z-index:0;background:#0A0A1F}
.tech-act{position:relative;z-index:2;padding:0 var(--pad)}
.tech-act.on-dark{background:#0A0A1F;color:#F4F4FF;--ink:#F4F4FF;--ink-rgb:244,244,255;--bg-rgb:10,10,31;--accent:#7C5CFF}
.tech-act.on-light{background:#FAFAF7;color:#10101F;--ink:#10101F;--ink-rgb:16,16,31;--bg-rgb:250,250,247;--accent:#7C5CFF}
.tech-act.on-slate{background:#D3D7DC;color:#12121C;--ink:#12121C;--ink-rgb:18,18,28;--bg-rgb:211,215,220;--accent:#FF3D63}
.tech-act.accent-cyan{--accent:#2FD4E6}
html.tech-fx-on .tech-act{background:transparent}
.tech-wrap{max-width:var(--maxw);margin:0 auto;position:relative}

.tech-hero{min-height:100svh;display:flex;flex-direction:column;justify-content:center;padding-top:7.5rem;padding-bottom:4rem;overflow:hidden}
.tech-hero-glow{position:absolute;pointer-events:none;z-index:0;width:70vw;height:70vw;max-width:900px;max-height:900px;
  top:-20%;right:-15%;border-radius:50%;
  background:radial-gradient(circle,rgba(124,92,255,.22),rgba(47,212,230,.07) 45%,transparent 68%);filter:blur(20px)}
.tech-hero-glow.g2{top:auto;right:auto;bottom:-30%;left:-20%;background:radial-gradient(circle,rgba(255,92,122,.14),transparent 60%)}
.tech-hero .tech-wrap{display:grid;grid-template-columns:minmax(0,1.05fr) minmax(0,1fr);gap:clamp(2rem,5vw,5rem);align-items:center}
.tech-hero-copy{position:relative;z-index:2}
.tech-hero-copy .tech-lede{margin:2rem 0 2.6rem}
.tech-hero-ctas{display:flex;gap:1rem;flex-wrap:wrap;align-items:center}
.tech-hero-note{margin-top:1.4rem;font-family:var(--mono);font-size:.72rem;letter-spacing:.12em;opacity:.5}

.tech-stage{position:relative;z-index:2;min-height:420px;display:flex;align-items:center;justify-content:space-between;gap:1rem}
.tech-device{width:min(240px,42%);border-radius:26px;padding:.9rem;background:rgba(255,255,255,.04);
  border:1px solid rgba(255,255,255,.12);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);box-shadow:0 30px 60px rgba(0,0,0,.45)}
.tech-device.right{transform:translateY(3.2rem)}
.tech-d-top{display:flex;align-items:center;justify-content:space-between;padding:.15rem .4rem .65rem;font-size:.68rem;letter-spacing:.18em;opacity:.75}
.tech-online{width:7px;height:7px;border-radius:50%;background:var(--lime);box-shadow:0 0 8px var(--lime)}
.tech-d-screen{background:#0E0E26;border-radius:18px;min-height:290px;padding:.85rem;display:flex;flex-direction:column;justify-content:flex-end;gap:.55rem;border:1px solid rgba(255,255,255,.06);overflow:hidden}
.tech-bub{max-width:88%;padding:.55rem .8rem;border-radius:14px;font-size:.8rem;line-height:1.45;position:relative;opacity:0;transform:translateY(10px) scale(.92);transition:opacity .45s var(--ease),transform .45s var(--ease)}
.tech-bub.show{opacity:1;transform:none}
.tech-bub.me{align-self:flex-end;background:var(--grad);color:#0A0A1F;font-weight:500;border-bottom-right-radius:4px}
.tech-bub.you{align-self:flex-start;background:rgba(255,255,255,.08);color:var(--ink);border-bottom-left-radius:4px}
.tech-bub .meta{display:flex;gap:.35rem;align-items:center;justify-content:flex-end;margin-top:.3rem;font-size:.6rem;opacity:.75;font-family:var(--mono)}
.tech-bub .lock,.tech-lock{width:9px;height:9px}
.tech-bub .ticks{letter-spacing:-.12em}
.tech-bub .ticks.ok{color:#0A6}
.tech-bub.you .ticks.ok{color:var(--cyan)}
.tech-typing{display:flex;gap:4px;align-self:flex-start;background:rgba(255,255,255,.08);padding:.6rem .75rem;border-radius:14px;border-bottom-left-radius:4px;opacity:0;transform:translateY(8px);transition:opacity .35s,transform .35s}
.tech-typing.show{opacity:1;transform:none}
.tech-typing i{width:5px;height:5px;border-radius:50%;background:rgba(255,255,255,.65);animation:techtp 1s infinite}
.tech-typing i:nth-child(2){animation-delay:.18s}
.tech-typing i:nth-child(3){animation-delay:.36s}
@keyframes techtp{0%,60%,100%{transform:translateY(0);opacity:.5}30%{transform:translateY(-4px);opacity:1}}
.tech-wire{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible}
.tech-wire path{fill:none;stroke:rgba(var(--ink-rgb),.18);stroke-width:1.2;stroke-dasharray:3 6;stroke-linecap:round}
.tech-pkt{position:absolute;left:0;top:0;pointer-events:none;opacity:0;z-index:3}
.tech-pkt-dot{display:block;width:10px;height:10px;border-radius:50%;background:var(--grad);box-shadow:0 0 14px var(--violet),0 0 30px var(--cyan);transform:translate(-50%,-50%)}
.tech-pkt-ms{position:absolute;left:12px;top:-22px;font-size:.62rem;letter-spacing:.12em;color:var(--cyan);white-space:nowrap;opacity:0;transition:opacity .3s}
.tech-pkt.mid .tech-pkt-ms{opacity:1}
@media (max-width:1020px){.tech-hero .tech-wrap{grid-template-columns:1fr}.tech-stage{min-height:520px;margin-top:1rem}}
@media (max-width:560px){.tech-stage{flex-direction:column;align-items:stretch;min-height:0;gap:3.2rem}.tech-device{width:min(250px,86%)}.tech-device.left{align-self:flex-start;transform:none}.tech-device.right{align-self:flex-end;transform:none}.tech-d-screen{min-height:190px}}

.tech-ticker{border-top:1px solid rgba(var(--ink-rgb),.1);border-bottom:1px solid rgba(var(--ink-rgb),.1);overflow:hidden;padding:1rem 0;position:relative;z-index:2}
.tech-ticker-track{display:flex;width:max-content;animation:techtick 30s linear infinite}
.tech-ticker span{font-family:var(--mono);font-size:.72rem;letter-spacing:.3em;text-transform:uppercase;opacity:.55;padding:0 1.6rem;white-space:nowrap}
.tech-ticker b{color:var(--accent);font-weight:400}
@keyframes techtick{to{transform:translateX(-50%)}}

.tech-why{padding-top:clamp(7rem,14vh,11rem);padding-bottom:clamp(6rem,12vh,10rem)}
.tech-sect-head{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,.8fr);gap:2.5rem;align-items:end;margin-bottom:clamp(3rem,7vw,5.5rem)}
.tech-sect-head .tech-lede{justify-self:end}
@media (max-width:860px){.tech-sect-head{grid-template-columns:1fr}.tech-sect-head .tech-lede{justify-self:start}}

.tech-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:1.4rem}
@media (max-width:1000px){.tech-grid{grid-template-columns:repeat(2,1fr)}}
@media (max-width:620px){.tech-grid{grid-template-columns:1fr}}
.tech-card{border:1px solid rgba(var(--ink-rgb),.12);border-radius:22px;overflow:hidden;background:rgba(var(--bg-rgb),0);transition:transform .5s var(--ease),box-shadow .5s var(--ease),border-color .4s}
.tech-card:hover{transform:translateY(-6px);box-shadow:0 26px 60px rgba(10,10,31,.14);border-color:rgba(var(--ink-rgb),.22)}
.tech-card-visual{aspect-ratio:16/9.5;display:flex;align-items:center;justify-content:center;overflow:hidden;position:relative}
.tech-card-visual svg{width:34%;height:auto;overflow:visible;transition:transform .7s var(--ease)}
.tech-card:hover .tech-card-visual svg{transform:scale(1.12)}
.tech-card-body{padding:1.4rem 1.5rem 1.6rem}
.tech-card-body h3{font-size:1.18rem;font-weight:700;letter-spacing:-.01em;margin-bottom:.5rem}
.tech-card-body p{font-size:.92rem;line-height:1.6;opacity:.75}
.tech-card .more{max-height:0;opacity:0;overflow:hidden;transition:max-height .55s var(--ease),opacity .5s,margin .5s;font-size:.82rem;font-family:var(--mono);letter-spacing:.04em;color:var(--accent)}
.tech-card:hover .more,.tech-card:focus-within .more{max-height:3.5rem;opacity:1;margin-top:.8rem}
@media (hover:none){.tech-card .more{max-height:none;opacity:1;margin-top:.8rem}}
.tech-card-visual.t-violet{background:#EFEAFF}.tech-card-visual.t-cyan{background:#E1F7FA}.tech-card-visual.t-coral{background:#FFE9EE}
.tech-card-visual.t-amber{background:#FFF1DE}.tech-card-visual.t-lime{background:#F0F9DC}
.tech-card-visual.t-mix{background:linear-gradient(135deg,#EFEAFF,#E1F7FA 50%,#FFE9EE)}
.tech-card .ic{stroke:#0A0A1F;stroke-width:1.6;fill:none;stroke-linecap:round;stroke-linejoin:round}
.tech-card .draw{stroke-dasharray:80;stroke-dashoffset:80;animation:techdraw 3.4s var(--ease) infinite}
@keyframes techdraw{0%{stroke-dashoffset:80}45%,70%{stroke-dashoffset:0}100%{stroke-dashoffset:-80}}
.tech-card .blink{animation:techblk 2.8s ease-in-out infinite}
@keyframes techblk{0%,100%{opacity:.25}50%{opacity:1}}
.tech-card .hover-float{animation:techhf 4s ease-in-out infinite}
@keyframes techhf{0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}
.tech-card .sync-dot{animation:techsync 2.6s var(--ease) infinite}
@keyframes techsync{0%,15%{transform:translateX(0)}45%,65%{transform:translateX(26px)}95%,100%{transform:translateX(0)}}

.tech-lat{margin-top:clamp(4.5rem,9vw,7.5rem);border:1px solid rgba(var(--ink-rgb),.12);border-radius:26px;padding:clamp(1.8rem,4vw,3.2rem);overflow:hidden;position:relative}
.tech-lat h3{font-size:clamp(1.5rem,3vw,2.3rem);letter-spacing:-.02em;margin-bottom:.5rem}
.tech-lat .sub{opacity:.65;font-size:.95rem;margin-bottom:2.4rem;max-width:56ch}
.tech-lat-row{display:grid;grid-template-columns:150px 1fr 92px;gap:1.2rem;align-items:center;margin-bottom:1.3rem}
.tech-lat-row label{font-family:var(--mono);font-size:.68rem;letter-spacing:.2em;text-transform:uppercase;opacity:.65}
.tech-track{height:12px;border-radius:99px;background:rgba(var(--ink-rgb),.08);overflow:hidden}
.tech-fill{height:100%;width:0;border-radius:99px;transition:width 1.6s var(--ease)}
.tech-fill.slow{background:rgba(var(--ink-rgb),.3)}
.tech-fill.fast{background:var(--grad)}
.tech-lat-ms{font-family:var(--mono);font-size:1rem;text-align:right;font-weight:700}
.tech-lat-ms.hot{color:var(--violet)}
.tech-lat-note{font-family:var(--mono);font-size:.68rem;letter-spacing:.1em;opacity:.45;margin-top:1.6rem}
@media (max-width:620px){.tech-lat-row{grid-template-columns:96px 1fr 70px;gap:.7rem}}

.tech-how{padding-top:clamp(7rem,14vh,11rem);padding-bottom:clamp(6rem,12vh,9rem)}
.tech-how-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:clamp(2.5rem,6vw,6rem);margin-top:clamp(3rem,6vw,5rem);align-items:start}
@media (max-width:900px){.tech-how-grid{grid-template-columns:1fr}}
.tech-step{border-left:2px solid rgba(var(--ink-rgb),.15);padding:.4rem 0 2.4rem 1.8rem;position:relative}
.tech-step:last-child{padding-bottom:.4rem}
.tech-step::before{content:"";position:absolute;left:-6px;top:.7rem;width:10px;height:10px;border-radius:50%;background:var(--accent);box-shadow:0 0 0 5px rgba(var(--bg-rgb),0),0 0 12px var(--accent)}
.tech-step .n{font-family:var(--mono);font-size:.68rem;letter-spacing:.3em;color:var(--accent);display:block;margin-bottom:.55rem}
.tech-step h3{font-size:1.45rem;font-weight:700;letter-spacing:-.015em;margin-bottom:.55rem}
.tech-step p{font-size:.95rem;opacity:.72;max-width:44ch}
.tech-mesh-box{position:sticky;top:16vh}
.tech-mesh-box svg{width:100%;height:auto;overflow:visible}
.tech-mesh-cap{font-family:var(--mono);font-size:.66rem;letter-spacing:.22em;text-transform:uppercase;opacity:.5;text-align:center;margin-top:1.2rem}
@media (max-width:900px){.tech-mesh-box{position:static}}

.tech-security{padding-bottom:clamp(6rem,12vh,10rem)}
.tech-sec-list{margin-top:clamp(2.5rem,5vw,4rem);border-top:1px solid rgba(var(--ink-rgb),.18)}
.tech-sec{border-bottom:1px solid rgba(var(--ink-rgb),.18)}
.tech-sec summary{list-style:none;display:flex;align-items:baseline;justify-content:space-between;gap:1.5rem;padding:1.7rem .2rem;cursor:pointer;font-size:clamp(1.15rem,2.4vw,1.7rem);font-weight:500;letter-spacing:-.015em;transition:color .3s,padding-left .4s var(--ease)}
.tech-sec summary::-webkit-details-marker{display:none}
.tech-sec summary:hover{color:var(--accent);padding-left:.7rem}
.tech-sec summary .plus{font-family:var(--mono);font-size:1.15rem;color:var(--accent);transition:transform .4s var(--ease);flex-shrink:0}
.tech-sec[open] summary .plus{transform:rotate(45deg)}
.tech-sec .sec-body{padding:0 .2rem 1.9rem;max-width:64ch;opacity:.75;font-size:.96rem}
.tech-sec .sec-body .mono{font-size:.72rem;letter-spacing:.1em;color:var(--accent);opacity:1;display:block;margin-top:.7rem}

.tech-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:1.3rem;margin-top:clamp(4rem,8vw,6rem)}
@media (max-width:820px){.tech-stats{grid-template-columns:repeat(2,1fr)}}
.tech-stat{border-top:2px solid rgba(var(--ink-rgb),.7);padding-top:1.15rem}
.tech-stat .val{font-size:clamp(2.2rem,4.5vw,3.6rem);font-weight:700;letter-spacing:-.03em;line-height:1}
.tech-stat .val small{font-size:.45em;font-weight:500;letter-spacing:0}
.tech-stat .lab{font-family:var(--mono);font-size:.66rem;letter-spacing:.2em;text-transform:uppercase;opacity:.55;margin-top:.6rem}

.tech-final{padding-top:clamp(8rem,16vh,13rem);text-align:center;overflow:hidden}
.tech-final .tech-h-display{margin:0 auto}
.tech-final .tech-lede{margin:2.2rem auto 3rem}
.tech-final-ctas{display:flex;gap:1rem;justify-content:center;flex-wrap:wrap}
.tech-delivered{margin:3.4rem auto 0;display:inline-flex;align-items:center;gap:.7rem;font-family:var(--mono);font-size:.72rem;letter-spacing:.2em;color:var(--cyan);opacity:0;transform:translateY(12px);transition:opacity .8s var(--ease) .2s,transform .8s var(--ease) .2s}
.tech-delivered.on{opacity:1;transform:none}
.tech-delivered .dd{letter-spacing:-.1em;font-size:.95rem}
.tech-footer{padding:clamp(6rem,12vh,9rem) 0 2.5rem;position:relative}
.tech-ghost{font-weight:700;letter-spacing:.02em;line-height:.8;text-align:center;user-select:none;font-size:clamp(5rem,19vw,17rem);color:transparent;-webkit-text-stroke:1px rgba(var(--ink-rgb),.14);pointer-events:none}
.tech-foot-grid{display:flex;justify-content:space-between;gap:2.5rem;flex-wrap:wrap;margin-top:clamp(2.5rem,6vw,4.5rem);padding-top:2.5rem;border-top:1px solid rgba(var(--ink-rgb),.1)}
.tech-foot-col h4{font-family:var(--mono);font-size:.64rem;letter-spacing:.28em;text-transform:uppercase;opacity:.45;margin-bottom:1rem}
.tech-foot-col a{display:block;font-size:.9rem;opacity:.75;padding:.28rem 0;transition:opacity .3s,color .3s}
.tech-foot-col a:hover{opacity:1;color:var(--accent)}
.tech-foot-bottom{display:flex;justify-content:space-between;gap:1rem;flex-wrap:wrap;margin-top:3.5rem;font-family:var(--mono);font-size:.66rem;letter-spacing:.14em;opacity:.45}
.tech-back-home{opacity:1;color:var(--accent);transition:opacity .3s}
.tech-back-home:hover{opacity:.7}

.tech-reveal{opacity:0;transform:translateY(30px);transition:opacity .95s var(--ease),transform .95s var(--ease)}
.tech-reveal.in{opacity:1;transform:none}
.tech-reveal.d1{transition-delay:.08s}.tech-reveal.d2{transition-delay:.16s}
.tech-reveal.d3{transition-delay:.24s}.tech-reveal.d4{transition-delay:.32s}.tech-reveal.d5{transition-delay:.4s}

@media (prefers-reduced-motion:reduce){
  .tech-page *,.tech-page *::before,.tech-page *::after{animation-duration:.01ms !important;animation-iteration-count:1 !important;transition-duration:.01ms !important}
  .tech-reveal{opacity:1;transform:none}
  .tech-ticker-track{animation:none}
}
`;
