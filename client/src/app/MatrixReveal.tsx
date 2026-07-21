import { useEffect, useRef, useState } from "react";

/**
 * Guest ID-reveal animation (login overhaul, owner spec: "matrix-like cascading
 * green-code animation, dark background, high-gloss"). Played once, full-screen,
 * the instant a guest picks a name — a wall of falling green glyphs behind a
 * glass card whose 6-digit RELAY number "decodes" digit-by-digit out of the
 * scramble, then settles. Purely presentational: it holds the gate on screen
 * while the guest session is minted, then calls `onDone` to enter the app.
 *
 * - `number` may arrive AFTER mount (the startGuest round-trip): until it does
 *   the card scrambles; once known it locks each digit left-to-right.
 * - Honors prefers-reduced-motion: no rain, no scramble — a calm number reveal.
 * - Canvas is `pointer-events-none` and torn down on unmount (no leaked rAF).
 */
const GLYPHS = "ｦｧｨｩｪｫｬｭｮｯｰｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎ0123456789ABCDEF".split("");
const MIN_MS = 2200; // never flash by; give the reveal room to land

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export function MatrixReveal({
  number,
  name,
  onDone,
}: {
  number: string | null;
  name: string;
  onDone: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const startedRef = useRef<number | null>(null); // monotonic-ish via rAF timestamps
  const doneRef = useRef(false);
  const reduced = prefersReducedMotion();

  // The digits shown on the card: scrambled until `number` is known + locked.
  const [shown, setShown] = useState<string>("······");
  const [settled, setSettled] = useState(false);

  // ── Matrix rain on the backdrop canvas (rAF, reduced-motion skips it). ──
  useEffect(() => {
    if (reduced) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let cols = 0;
    let drops: number[] = [];
    const FONT = 16;

    const resize = () => {
      canvas.width = Math.floor(window.innerWidth * Math.min(2, window.devicePixelRatio || 1));
      canvas.height = Math.floor(window.innerHeight * Math.min(2, window.devicePixelRatio || 1));
      canvas.style.width = window.innerWidth + "px";
      canvas.style.height = window.innerHeight + "px";
      const scale = Math.min(2, window.devicePixelRatio || 1);
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      cols = Math.ceil(window.innerWidth / FONT);
      drops = Array.from({ length: cols }, () => Math.floor((Math.random() * -window.innerHeight) / FONT));
    };
    resize();
    window.addEventListener("resize", resize);

    const tick = () => {
      // Trails: translucent black wash each frame.
      ctx.fillStyle = "rgba(6,9,12,0.14)";
      ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
      ctx.font = `${FONT}px "SFMono-Regular", ui-monospace, Menlo, monospace`;
      for (let i = 0; i < cols; i++) {
        const g = GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
        const x = i * FONT;
        const y = drops[i] * FONT;
        // Lead glyph bright mint; tail dimmer green.
        ctx.fillStyle = Math.random() < 0.08 ? "#c9fff2" : "rgba(63,224,197,0.82)";
        ctx.fillText(g, x, y);
        if (y > window.innerHeight && Math.random() > 0.975) drops[i] = 0;
        drops[i]++;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [reduced]);

  // ── Digit decode: scramble, then lock left-to-right once number is known. ──
  useEffect(() => {
    let raf = 0;
    let lockTimer: ReturnType<typeof setTimeout> | null = null;

    const loop = (ts: number) => {
      if (startedRef.current == null) startedRef.current = ts;
      const target = number && /^\d{6}$/.test(number) ? number : null;

      if (reduced && target) {
        setShown(target);
        setSettled(true);
        return; // decode animation skipped for reduced-motion
      }

      if (!target) {
        // Still minting: full scramble.
        setShown(Array.from({ length: 6 }, () => GLYPHS[Math.floor(Math.random() * 10)]).join(""));
        raf = requestAnimationFrame(loop);
        return;
      }

      // Number known: reveal digits progressively over ~900ms.
      const elapsed = ts - (startedRef.current ?? ts);
      const revealFor = Math.min(6, Math.floor(elapsed / 150)); // one digit / 150ms
      let out = "";
      for (let i = 0; i < 6; i++) {
        out += i < revealFor ? target[i] : String(Math.floor(Math.random() * 10));
      }
      setShown(out);
      if (revealFor >= 6) {
        setShown(target);
        setSettled(true);
        return;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      if (lockTimer) clearTimeout(lockTimer);
    };
  }, [number, reduced]);

  // ── Exit: after the number settles AND a minimum on-screen time. ──
  useEffect(() => {
    if (!settled || doneRef.current) return;
    const startedAt = startedRef.current ?? 0;
    const elapsed = performance.now() - startedAt;
    const wait = Math.max(650, MIN_MS - elapsed); // linger a beat on the settled ID
    const t = setTimeout(() => {
      if (doneRef.current) return;
      doneRef.current = true;
      onDone();
    }, wait);
    return () => clearTimeout(t);
  }, [settled, onDone]);

  const display = /^\d{6}$/.test(shown) ? `${shown.slice(0, 3)}-${shown.slice(3)}` : shown;

  return (
    <div className="fixed inset-0 z-[70] grid place-items-center overflow-hidden bg-[#06090c] text-foreground">
      {!reduced && (
        <canvas ref={canvasRef} aria-hidden className="pointer-events-none absolute inset-0 opacity-70" />
      )}
      {/* vignette to keep the card legible over the rain */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(circle at 50% 45%, transparent 30%, rgba(6,9,12,0.86) 78%)" }}
      />
      <div className="matrix-card relative w-full max-w-[360px] px-6 text-center">
        <div className="mb-3 text-[0.68rem] font-semibold uppercase tracking-[0.28em] text-[color:var(--relay-online,#3FE0C5)]">
          {settled ? "Session ready" : "Generating your RELAY ID"}
        </div>
        <div
          className="font-mono text-[2.6rem] font-bold leading-none tracking-[0.12em]"
          style={{
            color: settled ? "#eafff9" : "#3FE0C5",
            textShadow: "0 0 24px rgba(63,224,197,0.55)",
            transition: "color .3s ease",
          }}
          aria-live="polite"
        >
          {display}
        </div>
        <div
          className="mt-4 text-sm text-muted-foreground transition-opacity duration-300"
          style={{ opacity: settled ? 1 : 0 }}
        >
          Welcome, <span className="font-medium text-foreground">{name || "guest"}</span>
        </div>
      </div>
      <style>{`
        @media (prefers-reduced-motion: no-preference) {
          .matrix-card { animation: matrixCardIn .5s cubic-bezier(0.23,1,0.32,1) both; }
        }
        @keyframes matrixCardIn { from { opacity: 0; transform: translateY(10px) scale(.97); } to { opacity: 1; transform: none; } }
      `}</style>
    </div>
  );
}
