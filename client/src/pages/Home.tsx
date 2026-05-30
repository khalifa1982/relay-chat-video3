import { useEffect, useRef, useState } from "react";

/**
 * RELAY landing page v2 — long-scroll cinematic presentation.
 *
 * Every illustration on this page is a Gemini-generated frame
 * (gemini-3.1-flash-image), uploaded once to the project's storage layer.
 * The page itself is hand-authored React; the IMAGERY is AI.
 *
 * Layout (top to bottom):
 *   1. Hero with parallax phone + sticky "Launch RELAY" CTA in the corner
 *   2. Looping animation reel (6 frames cycled with CSS keyframes)
 *   3. Chat scene + caption
 *   4. Voice call scene + caption
 *   5. Multi-party video grid + caption ("multiple parties chatting")
 *   6. Dial pad close-up + caption
 *   7. Finale launch scene + big CTA
 */

const ASSET = {
  hero: "/manus-storage/hero_7fd2aad5.png",
  chat: "/manus-storage/scene-chat_d5b71720.png",
  voice: "/manus-storage/scene-voice-call_757f9f34.png",
  grid: "/manus-storage/scene-video-grid_a221d124.png",
  dialpad: "/manus-storage/scene-dialpad_b09b59c0.png",
  launch: "/manus-storage/scene-launch_d020f421.png",
  loop1: "/manus-storage/loop-1-dial_0d16a088.png",
  loop2: "/manus-storage/loop-2-ringing_fb44c0f7.png",
  loop3: "/manus-storage/loop-3-connecting_f6b2bf94.png",
  loop4: "/manus-storage/loop-4-live_d2b91240.png",
  loop5: "/manus-storage/loop-5-group_c4eb3cbd.png",
  loop6: "/manus-storage/loop-6-chat_bf820cb4.png",
} as const;

const LOOP_FRAMES = [
  { src: ASSET.loop1, label: "Dial" },
  { src: ASSET.loop2, label: "Ringing" },
  { src: ASSET.loop3, label: "Connecting" },
  { src: ASSET.loop4, label: "Live" },
  { src: ASSET.loop5, label: "Group of six" },
  { src: ASSET.loop6, label: "Keep talking" },
];

export default function Home() {
  // Lock dark theme for the landing page so the brand palette renders correctly.
  useEffect(() => {
    const root = document.documentElement;
    const had = root.classList.contains("dark");
    root.classList.add("dark");
    return () => {
      if (!had) root.classList.remove("dark");
    };
  }, []);

  // Track scroll progress (0..1) so we can drive hero parallax and the
  // sticky CTA reveal without depending on any animation library.
  const [scrollY, setScrollY] = useState(0);
  useEffect(() => {
    const onScroll = () => setScrollY(window.scrollY);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-[#06080A] text-[#EAEEF2] [font-family:'Hanken_Grotesk',ui-sans-serif,system-ui,sans-serif]">
      <BackgroundFx />
      <StickyTopBar visible={scrollY > 480} />

      <main className="relative z-10">
        <HeroSection scrollY={scrollY} />
        <LoopReelSection />
        <SceneSection
          eyebrow="Conversations"
          title="Chat that feels personal"
          body="Direct peer-to-peer messages over a WebRTC data channel. Voice notes, images, links — same private wire as your calls."
          image={ASSET.chat}
          imageAlt="Two phones tilted toward each other showing a RELAY chat conversation"
        />
        <SceneSection
          eyebrow="Voice"
          title="One tap to hear them"
          body="A 6-digit number is all you need. Open the app, type the number, press Call. The other phone rings in the browser, no install required."
          image={ASSET.voice}
          imageAlt="RELAY voice call screen with sound waves emanating from a single phone"
          flip
        />
        <SceneSection
          eyebrow="Group calls"
          title="Up to six people, one room"
          body="A full peer-to-peer mesh: every browser sends its stream directly to every other browser. No media server in the path, just signaling at the start."
          image={ASSET.grid}
          imageAlt="Six floating portrait tiles inside a glass panel, RELAY group call grid"
        />
        <SceneSection
          eyebrow="Dial pad"
          title="It dials like a phone, because it is one"
          body="Your own 6-digit number sits ghosted in the input until you start typing — a quiet reminder of who you are. Tap a digit and your call replaces it."
          image={ASSET.dialpad}
          imageAlt="Close-up of the RELAY glass dial pad UI floating against a dark background"
          flip
        />

        <HonestSection />
        <FinaleSection />
      </main>

      <footer className="relative z-10 border-t border-white/5">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-3 px-6 py-8 text-xs text-[#5A6271] sm:flex-row">
          <Brand small />
          <p>Self-hosted on Manus. Browser-to-browser calling, end-to-end encrypted by WebRTC.</p>
        </div>
      </footer>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sections                                                            */
/* ------------------------------------------------------------------ */

function HeroSection({ scrollY }: { scrollY: number }) {
  // Subtle parallax: hero image drifts up + fades as the user scrolls past it.
  const heroLift = Math.min(scrollY * 0.25, 220);
  const heroFade = Math.max(0, 1 - scrollY / 700);

  return (
    <section className="relative flex min-h-[100dvh] flex-col items-center justify-center px-6 pt-16">
      <header className="absolute left-0 right-0 top-0 z-10 mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6">
        <Brand />
        <nav className="flex items-center gap-2 text-sm text-[#8A93A2]">
          <a
            href="#how"
            className="hidden rounded-lg px-3 py-2 transition hover:text-white sm:inline-block">
            How it works
          </a>
          <a
            href="/app"
            className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 font-semibold text-white transition hover:border-[#3FE0C5]/60 hover:text-[#3FE0C5]">
            Open the app
          </a>
        </nav>
      </header>

      <div className="relative z-[1] mx-auto flex max-w-5xl flex-col items-center text-center">
        <span className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-[#8A93A2]">
          <span className="h-1.5 w-1.5 rounded-full bg-[#3FE0C5] shadow-[0_0_10px_#3FE0C5]" />
          Live calling, in your browser
        </span>
        <h1 className="text-balance text-[clamp(2.25rem,6vw,4.5rem)] font-extrabold leading-[1.04] tracking-tight [font-family:'Bricolage_Grotesque',ui-sans-serif]">
          Pick a name. Get a number.{" "}
          <span className="bg-gradient-to-br from-[#3FE0C5] to-[#6EE7FF] bg-clip-text text-transparent">
            Dial anyone.
          </span>
        </h1>
        <p className="mt-5 max-w-2xl text-balance text-base leading-relaxed text-[#A6AEBA] md:text-lg">
          A self-hosted, peer-to-peer phone for the open web. Voice, video, and chat —
          no installs, no accounts, just a number anyone can call.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <a
            href="/app"
            className="group inline-flex items-center gap-2 rounded-2xl bg-gradient-to-br from-[#3FE0C5] to-[#6EE7FF] px-7 py-4 text-base font-bold text-[#04201B] shadow-[0_18px_50px_-18px_rgba(63,224,197,0.7)] transition hover:-translate-y-0.5 hover:shadow-[0_24px_60px_-18px_rgba(63,224,197,0.85)] [font-family:'Bricolage_Grotesque',ui-sans-serif]">
            <PhoneIcon className="h-5 w-5" />
            Launch the app now
            <ArrowIcon className="h-4 w-4 transition group-hover:translate-x-0.5" />
          </a>
          <a
            href="#tour"
            className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-6 py-4 text-base font-semibold text-white transition hover:border-white/20 [font-family:'Bricolage_Grotesque',ui-sans-serif]">
            Take the tour
            <span className="text-base">↓</span>
          </a>
        </div>
      </div>

      {/* Hero illustration — Gemini-generated dial-pad phone, parallaxed */}
      <div
        className="pointer-events-none relative z-0 mt-10 w-full max-w-5xl"
        style={{
          transform: `translateY(${-heroLift}px)`,
          opacity: heroFade,
        }}>
        <div className="absolute inset-0 -z-10 mx-auto h-full max-w-3xl rounded-[3rem] bg-gradient-to-br from-[#3FE0C5]/20 to-[#6EE7FF]/10 blur-3xl" />
        <img
          src={ASSET.hero}
          alt="A RELAY dial-pad phone floating in a cyan-lit studio"
          loading="eager"
          decoding="async"
          className="mx-auto block w-full max-w-4xl rounded-3xl border border-white/10 shadow-[0_60px_160px_-50px_rgba(63,224,197,0.45)]"
        />
      </div>

      <ScrollHint />
    </section>
  );
}

function LoopReelSection() {
  // A 6-frame strip cycled by a CSS keyframe animation. The strip is laid
  // out horizontally and `translateX`-ed by the animation. The container
  // crops to one frame at a time.
  return (
    <section id="tour" className="relative px-6 py-24 md:py-32">
      <div className="mx-auto max-w-6xl">
        <SectionEyebrow>From dial to live</SectionEyebrow>
        <h2 className="mb-3 text-balance text-[clamp(1.75rem,4vw,3rem)] font-extrabold tracking-tight [font-family:'Bricolage_Grotesque',ui-sans-serif]">
          Six moments, one call.
        </h2>
        <p className="mb-12 max-w-2xl text-balance text-[#A6AEBA] md:text-lg">
          Watch the whole flow — dial, ring, connect, talk, group up, keep chatting —
          play out in a loop. This is RELAY in motion.
        </p>

        <div className="relative mx-auto w-full overflow-hidden rounded-3xl border border-white/10 bg-black/40 shadow-[0_40px_120px_-40px_rgba(63,224,197,0.4)]">
          <div className="aspect-[16/10] w-full overflow-hidden">
            <div className="loop-reel-track flex h-full">
              {/* Render frames twice so the strip can loop seamlessly */}
              {[...LOOP_FRAMES, ...LOOP_FRAMES].map((f, i) => (
                <div key={i} className="loop-reel-frame relative h-full flex-shrink-0">
                  <img
                    src={f.src}
                    alt={f.label}
                    loading="lazy"
                    decoding="async"
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                  <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
                  <div className="absolute bottom-5 left-5 rounded-full border border-white/10 bg-black/40 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-[#3FE0C5] backdrop-blur">
                    {f.label}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <style>{`
          .loop-reel-track {
            width: ${LOOP_FRAMES.length * 200}%;
            animation: loop-reel-pan ${LOOP_FRAMES.length * 4}s linear infinite;
          }
          .loop-reel-frame {
            width: ${100 / (LOOP_FRAMES.length * 2)}%;
          }
          @keyframes loop-reel-pan {
            from { transform: translateX(0); }
            to   { transform: translateX(-50%); }
          }
          @media (prefers-reduced-motion: reduce) {
            .loop-reel-track { animation: none; }
          }
        `}</style>
      </div>
    </section>
  );
}

function SceneSection({
  eyebrow,
  title,
  body,
  image,
  imageAlt,
  flip,
}: {
  eyebrow: string;
  title: string;
  body: string;
  image: string;
  imageAlt: string;
  flip?: boolean;
}) {
  // Reveal-on-scroll: fade + lift the section as it enters the viewport.
  const ref = useRef<HTMLElement | null>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setShown(true);
            obs.disconnect();
            return;
          }
        }
      },
      { threshold: 0.25 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <section
      ref={ref}
      className={
        "relative px-6 py-20 transition-all duration-1000 ease-out " +
        (shown ? "translate-y-0 opacity-100" : "translate-y-10 opacity-0")
      }>
      <div
        className={
          "mx-auto grid max-w-6xl items-center gap-10 md:grid-cols-2 md:gap-16 " +
          (flip ? "md:[grid-template-areas:'right_left']" : "")
        }>
        <div className={flip ? "md:[grid-area:left]" : ""}>
          <SectionEyebrow>{eyebrow}</SectionEyebrow>
          <h2 className="mb-4 text-balance text-[clamp(1.75rem,3.5vw,2.75rem)] font-extrabold tracking-tight [font-family:'Bricolage_Grotesque',ui-sans-serif]">
            {title}
          </h2>
          <p className="text-balance text-base leading-relaxed text-[#A6AEBA] md:text-lg">{body}</p>
        </div>
        <div className={"relative " + (flip ? "md:[grid-area:right]" : "")}>
          <div className="absolute -inset-6 -z-10 rounded-[2.5rem] bg-gradient-to-br from-[#3FE0C5]/15 to-[#6EE7FF]/10 blur-2xl" />
          <img
            src={image}
            alt={imageAlt}
            loading="lazy"
            decoding="async"
            className="w-full rounded-3xl border border-white/10 shadow-[0_40px_120px_-40px_rgba(0,0,0,0.8)]"
          />
        </div>
      </div>
    </section>
  );
}

function HonestSection() {
  return (
    <section id="how" className="relative px-6 py-20">
      <div className="mx-auto grid max-w-5xl grid-cols-1 gap-6 rounded-3xl border border-white/10 bg-white/[0.03] p-8 md:grid-cols-[0.6fr_1fr] md:p-10">
        <div>
          <SectionEyebrow>The honest version</SectionEyebrow>
          <h2 className="text-2xl font-bold tracking-tight [font-family:'Bricolage_Grotesque',ui-sans-serif] md:text-3xl">
            What's happening on the wire
          </h2>
        </div>
        <div className="space-y-4 text-sm leading-relaxed text-[#A6AEBA]">
          <p>
            <span className="font-semibold text-white">Media is peer-to-peer.</span>{" "}
            Audio, video, and chat travel directly between participants' browsers via
            native WebRTC. The server only relays connection setup messages.
          </p>
          <p>
            <span className="font-semibold text-white">State is ephemeral.</span>{" "}
            Numbers and rooms live for the lifetime of the session. Nothing about your
            call is stored.
          </p>
          <p>
            <span className="font-semibold text-white">HTTPS + STUN, optional TURN.</span>{" "}
            Hosted on Manus with HTTPS and a real WebSocket gateway. Public STUN gets
            most networks through; add TURN for the strict-NAT tail.
          </p>
        </div>
      </div>
    </section>
  );
}

function FinaleSection() {
  return (
    <section className="relative isolate overflow-hidden px-6 pb-32 pt-20">
      <div className="absolute inset-0 -z-10">
        <img
          src={ASSET.launch}
          alt=""
          aria-hidden="true"
          className="h-full w-full object-cover opacity-50"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#06080A] via-[#06080A]/60 to-transparent" />
      </div>
      <div className="mx-auto flex max-w-3xl flex-col items-center text-center">
        <SectionEyebrow>Ready when you are</SectionEyebrow>
        <h2 className="mb-5 text-balance text-[clamp(2.25rem,5vw,4rem)] font-extrabold tracking-tight [font-family:'Bricolage_Grotesque',ui-sans-serif]">
          Your number is one click away.
        </h2>
        <p className="mb-10 max-w-xl text-balance text-base text-[#A6AEBA] md:text-lg">
          Pick a name. Take your 6-digit RELAY number. Share it. Call anyone, anywhere,
          on any device with a browser.
        </p>
        <a
          href="/app"
          className="group inline-flex items-center gap-2 rounded-2xl bg-gradient-to-br from-[#3FE0C5] to-[#6EE7FF] px-9 py-5 text-lg font-bold text-[#04201B] shadow-[0_24px_70px_-18px_rgba(63,224,197,0.7)] transition hover:-translate-y-0.5 hover:shadow-[0_30px_80px_-18px_rgba(63,224,197,0.85)] [font-family:'Bricolage_Grotesque',ui-sans-serif]">
          <PhoneIcon className="h-5 w-5" />
          Launch the app now
          <ArrowIcon className="h-5 w-5 transition group-hover:translate-x-0.5" />
        </a>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Decorative pieces                                                   */
/* ------------------------------------------------------------------ */

function StickyTopBar({ visible }: { visible: boolean }) {
  return (
    <div
      className={
        "fixed left-0 right-0 top-0 z-20 transition-all duration-300 " +
        (visible ? "translate-y-0 opacity-100" : "-translate-y-full opacity-0")
      }>
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-3">
        <div className="rounded-2xl border border-white/10 bg-black/40 px-4 py-2 backdrop-blur-xl backdrop-saturate-150">
          <Brand small />
        </div>
        <a
          href="/app"
          className="rounded-2xl bg-gradient-to-br from-[#3FE0C5] to-[#6EE7FF] px-5 py-2.5 text-sm font-bold text-[#04201B] shadow-[0_10px_30px_-10px_rgba(63,224,197,0.7)] transition hover:-translate-y-0.5 [font-family:'Bricolage_Grotesque',ui-sans-serif]">
          Launch the app
        </a>
      </div>
    </div>
  );
}

function ScrollHint() {
  return (
    <div className="pointer-events-none absolute bottom-6 left-0 right-0 z-10 flex justify-center">
      <div className="flex flex-col items-center gap-2 text-[10px] uppercase tracking-[0.3em] text-[#5A6271]">
        <span>Scroll</span>
        <span className="block h-8 w-px animate-pulse bg-gradient-to-b from-[#5A6271] to-transparent" />
      </div>
    </div>
  );
}

function SectionEyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-[#3FE0C5]">
      <span className="h-1.5 w-1.5 rounded-full bg-[#3FE0C5] shadow-[0_0_10px_#3FE0C5]" />
      {children}
    </span>
  );
}

function Brand({ small }: { small?: boolean } = {}) {
  return (
    <div
      className={
        "flex items-center gap-2 [font-family:'Bricolage_Grotesque',ui-sans-serif] font-extrabold tracking-tight " +
        (small ? "text-base" : "text-xl")
      }>
      <span className="relative inline-block h-3 w-3 rounded-full bg-gradient-to-br from-[#3FE0C5] to-[#6EE7FF] shadow-[0_0_18px_rgba(63,224,197,0.7)]">
        <span className="absolute inset-0 animate-ping rounded-full bg-[#3FE0C5]/60" />
      </span>
      RELAY
    </div>
  );
}

function BackgroundFx() {
  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <div className="absolute inset-0 [background:radial-gradient(50%_40%_at_18%_12%,rgba(63,224,197,0.12),transparent_60%),radial-gradient(45%_40%_at_85%_88%,rgba(110,231,255,0.10),transparent_60%)]" />
      <div className="absolute inset-0 opacity-30 [background-image:linear-gradient(rgba(255,255,255,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.06)_1px,transparent_1px)] [background-size:46px_46px] [mask-image:radial-gradient(circle_at_50%_30%,black,transparent_75%)]" />
    </div>
  );
}

/* ----- inline icons (no external deps) ----- */
function PhoneIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}

function ArrowIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true">
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  );
}
