(function () {
  var PAL = ['#35e0b4', '#3ec9e8', '#4f9df5', '#7c8cf8', '#a78bfa', '#d174e8', '#f472b6', '#fb7185', '#f97362', '#f59e4b', '#e8c94a', '#8fd94f'];
  function h2(h) { h = h.replace('#', ''); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; }
  var cur = h2(PAL[0]), tgt = cur.slice(), idx = 0, colT = 0, cycle = true, speed = 9500;
  var frames = [], raf = 0, last = 0, rr = 0;
  var MAX_PER_TICK = 3;

  var io = window.IntersectionObserver ? new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      for (var i = 0; i < frames.length; i++) if (frames[i].cv === e.target) frames[i].vis = e.isIntersecting;
    });
  }, { rootMargin: '120px' }) : null;

  // Scale point counts down as more frames attach, so TOTAL work is bounded.
  function dScale() { return Math.max(0.3, Math.min(1, 5 / Math.max(1, frames.length))); }

  function attach(canvas, opts) {
    opts = opts || {};
    var st = { cv: canvas, ctx: canvas.getContext('2d'), o: opts, vt: Math.random() * 9, ft: Math.random() * 9, wt: Math.random() * 9, stars: [], w: 0, h: 0, vis: true, lastT: 0 };
    function size() {
      var r = canvas.getBoundingClientRect();
      var w = Math.max(80, r.width || canvas.clientWidth), h = Math.max(80, r.height || canvas.clientHeight);
      if (Math.abs(w - st.w) < 2 && Math.abs(h - st.h) < 2) return;
      st.w = w; st.h = h; canvas.width = w; canvas.height = h;
      st.stars = [];
      for (var i = 0; i < 24; i++) st.stars.push({ x: Math.random(), y: Math.random(), r: Math.random() * 1.1 + .3, p: Math.random() * 6.28, s: .4 + Math.random() * 1.2 });
      st.painted = false;
    }
    size();
    if (window.ResizeObserver) { st.ro = new ResizeObserver(size); st.ro.observe(canvas); }
    if (io) io.observe(canvas);
    frames.push(st);
    if (!raf) { last = performance.now(); raf = requestAnimationFrame(loop); }
    return st;
  }

  function loop(now) {
    raf = requestAnimationFrame(loop);
    var dt = Math.min(50, now - last); last = now;
    if (cycle) {
      colT += dt;
      if (colT > speed) {
        colT = 0; var i;
        do { i = Math.floor(Math.random() * PAL.length); } while (i === idx);
        idx = i; tgt = h2(PAL[i]);
      }
    } else { tgt = h2(PAL[0]); }
    var rate = 1 - Math.pow(1 - .0055, dt / 16.7);
    for (var k = 0; k < 3; k++) cur[k] += (tgt[k] - cur[k]) * rate;
    var r = cur[0] | 0, g = cur[1] | 0, b = cur[2] | 0;
    var root = document.documentElement.style;
    root.setProperty('--rb', 'rgb(' + r + ',' + g + ',' + b + ')');
    root.setProperty('--rb-rgb', r + ',' + g + ',' + b);

    // Visible frames only; never-painted frames get priority so nothing stays blank.
    var vis = [];
    for (var f = 0; f < frames.length; f++) { var st = frames[f]; if (st.w && (st.vis || !st.painted)) vis.push(st); }
    if (!vis.length) return;
    var n = Math.min(MAX_PER_TICK, vis.length);
    for (var d = 0; d < n; d++) {
      var pick = vis[(rr + d) % vis.length];
      var fdt = pick.lastT ? Math.min(120, now - pick.lastT) : 16;
      pick.lastT = now;
      draw(pick, now, fdt, r, g, b);
      pick.painted = true;
    }
    rr = (rr + n) % 9973;
  }

  function draw(st, t, dt, cr, cg, cb) {
    var ctx = st.ctx, w = st.w, h = st.h, I = (st.o.intensity != null ? st.o.intensity : 1);
    var ds = (st.o.density || 1) * dScale();
    function A(a) { return 'rgba(' + cr + ',' + cg + ',' + cb + ',' + a + ')'; }
    ctx.fillStyle = '#04070a'; ctx.fillRect(0, 0, w, h);
    var gr = ctx.createRadialGradient(w * .5, h * .3, 0, w * .5, h * .3, Math.max(w, h) * .6);
    gr.addColorStop(0, A(.10 * I)); gr.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gr; ctx.fillRect(0, 0, w, h);
    gr = ctx.createRadialGradient(w * .5, h * 1.35, h * .2, w * .5, h * 1.35, h * .9);
    gr.addColorStop(0, A(.13 * I)); gr.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gr; ctx.fillRect(0, 0, w, h);
    for (var si = 0; si < st.stars.length; si++) {
      var s = st.stars[si];
      ctx.fillStyle = 'rgba(215,240,233,' + ((.08 + .2 * (.5 + .5 * Math.sin(t * .001 * s.s + s.p))) * I).toFixed(3) + ')';
      ctx.beginPath(); ctx.arc(s.x * w, s.y * h, s.r, 0, 6.28); ctx.fill();
    }
    // flow-field swarm (Adamdesgns port), attractor wanders
    st.ft += dt * .0006; var ft = st.ft;
    var AX = w * (.5 + .42 * Math.sin(ft * .9 + 2) + .05 * Math.sin(ft * 3.1));
    var AY = h * (.5 + .42 * Math.cos(ft * .7) + .05 * Math.sin(ft * 2.3));
    var cols = Math.max(8, Math.round(w / 19 * ds));
    var rows = Math.max(10, Math.round(h / 19 * ds));
    var gx = w / cols, gy = h / rows;
    for (var i = cols * rows; i--;) {
      var x = (i % cols) * gx, y = ((i / cols) | 0) * gy;
      var n = Math.sin(x * .011 + Math.sin(y * .013 + ft * .7) * 2) + Math.cos(y * .009 + Math.sin(x * .008 - ft * .5) * 2);
      x += 10 * Math.cos(n * 4.5); y += 10 * Math.sin(n * 4.5);
      var k2 = Math.pow(.985, Math.hypot(x - AX, y - AY));
      var sr = (cr + (255 - cr) * k2) | 0, sg = (cg + (255 - cg) * k2) | 0, sb = (cb + (255 - cb) * k2) | 0;
      ctx.fillStyle = 'rgba(' + sr + ',' + sg + ',' + sb + ',' + ((.06 + .5 * k2) * I).toFixed(3) + ')';
      ctx.fillRect(x + (AX - x) * k2, y + (AY - y) * k2, 1.6, 1.6);
    }
    // particle vortex (yuruyurau port), center wanders
    st.vt += dt * .0016; st.wt += dt * .001; var T = st.vt;
    var vs = Math.min(w, h) * 1.15 / 400;
    var vox = w * (.5 + .3 * Math.sin(st.wt * .12 + 1.4)) - vs * 200;
    var voy = h * (.44 + .26 * Math.sin(st.wt * .085)) - vs * 240;
    var vr = (cr + (255 - cr) * .55) | 0, vg = (cg + (255 - cg) * .55) | 0, vb = (cb + (255 - cb) * .55) | 0;
    var N = Math.round(Math.min(2200, Math.max(700, w * h / 260)) * ds);
    var step = 1e4 / N;
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = 'rgba(' + vr + ',' + vg + ',' + vb + ',' + (.26 * I).toFixed(3) + ')';
    for (var j = 0; j < N; j++) {
      var ii = j * step;
      var y2 = ii / 235, kk = (4 + Math.cos(ii / 9 - T * 2)) * Math.cos(ii / 35), e = y2 / 7 - 13;
      var d = Math.hypot(kk, e) + Math.sin(e / 9 + T / 2) - 4;
      var q = 2 * Math.sin(kk * 3) - y2 / 35 * kk * (9 + kk * Math.sin(Math.cos(e) * 9 - d * 2 + T));
      var c = d - T;
      ctx.fillRect(vox + (q + 40 * Math.cos(c) + 200) * vs, voy + (q * Math.sin(c) + d * 35) * vs, vs * .9, vs * .9);
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  window.RelayBG = {
    attach: attach,
    setCycle: function (v) { cycle = !!v; },
    setSpeed: function (v) { speed = v; },
    setIntensityAll: function (v) { frames.forEach(function (st) { st.o.intensity = v; }); }
  };
})();
