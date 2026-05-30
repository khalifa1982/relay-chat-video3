import { useEffect, useMemo, useRef, useState } from "react";

/**
 * RELAY landing page v2.3 — interactive scroll-driven presentation.
 *
 * All copy on this page was authored by Grok (xai grok-4) against a strict
 * JSON schema; see /home/ubuntu/relay-shots/copy.json for the source.
 * All screenshots are real captures of the running RELAY app (Playwright,
 * iPhone 14 viewport, deviceScaleFactor=2), uploaded once to /manus-storage/.
 *
 * Interaction model:
 *   - Hero phone parallaxes against scrollY.
 *   - Each story section is a 2-column desktop / stacked mobile block. The
 *     phone-screenshot column is sticky vertically while the user scrolls
 *     past the section; the image itself translates UP as the user scrolls
 *     INTO the section and translates DOWN as the user scrolls OUT, giving
 *     the wheel-driven "image follows the mouse" effect.
 *   - Detail panel + bullets fade/slide in from the right at ~35% into-view.
 *   - Bullets stagger.
 *   - prefers-reduced-motion disables all of the above and renders a static
 *     stacked layout.
 */

const COPY = {
  hero: {
    eyebrow: "BROWSER CALLS",
    headline: "Voice in the\nsame tab you work in",
    sub: "Open a dial pad, type a number, speak. No installs, no accounts, nothing left behind when the tab closes.",
    primary_cta: "Open RELAY",
    secondary_cta: "Watch the scroll",
  },
  sections: [
    {
      id: "dialer-empty",
      eyebrow: "YOUR NUMBER",
      title: "Six digits appear the moment the page loads",
      lede: "The dial pad shows your own number in faint green before you press anything.",
      detail:
        "That number is the only address anyone needs. Type any six digits to reach another browser. The interface stays empty until the first key press.",
      bullets: ["6-digit number", "1M possible combinations", "Visible on first load"],
      image: "/manus-storage/dialer-empty_98fa535c.png",
      alt: "RELAY dialer with the user's own number ghosted in green and a numeric keypad below.",
    },
    {
      id: "dialer-typed",
      eyebrow: "LIVE CHECK",
      title: "Type, and the line checks itself",
      lede: "As digits appear, a small line states whether the number is reachable right now.",
      detail:
        "The check runs peer-to-peer. No list is consulted on a central server. Presence is confirmed only when both browsers are open at the same instant.",
      bullets: ["Real-time status", "No server lookup", "277 242 example"],
      image: "/manus-storage/dialer-typed_8ad4c6c2.png",
      alt: "RELAY dialer with 277 242 typed and a sub-hint reading 'No RELAY user with this number'.",
    },
    {
      id: "messages-empty",
      eyebrow: "MESSAGES",
      title: "Start a thread with one tap",
      lede: "The Messages tab shows nothing but a plus button until a conversation begins.",
      detail:
        "Tapping plus opens a number field or a 'Note to self' shortcut. Every thread stays local to the two browsers involved. Close the tab and the thread disappears with it.",
      bullets: ["Empty by default", "Plus opens a new thread", "Ephemeral on close"],
      image: "/manus-storage/messages-empty_014c8014.png",
      alt: "RELAY Messages tab showing 'No messages yet. Tap the + above to start a conversation.'",
    },
    {
      id: "messages-thread",
      eyebrow: "NOTES TO SELF",
      title: "Voice notes and text share one composer",
      lede: "A self-thread holds cyan bubbles above a composer with mic, attachments, image, and emoji buttons.",
      detail:
        "The mic records directly in the browser and sends peer-to-peer. Attachments follow the same path. Nothing is copied to disk on any machine in between.",
      bullets: ["Cyan message bubbles", "Mic for voice notes", "Attachments and emoji"],
      image: "/manus-storage/messages-thread_3b435df8.png",
      alt: "RELAY conversation view with two cyan message bubbles and a Type a message composer with mic button.",
    },
    {
      id: "contacts",
      eyebrow: "CONTACTS",
      title: "A blank list until you add someone",
      lede: "Fresh accounts show only a search field and an Add button — zero entries below.",
      detail:
        "Contacts live in your browser storage. Adding a number creates a local record you can tap to redial later. Wipe the browser and the list goes with it.",
      bullets: ["Search bar present", "Add button visible", "Zero contacts at start"],
      image: "/manus-storage/contacts-empty_ee775a4f.png",
      alt: "RELAY Contacts page with a search bar and a cyan Add button.",
    },
    {
      id: "profile",
      eyebrow: "PROFILE",
      title: "Your number and theme in one view",
      lede: "Avatar, editable display name, the six-digit number, and a Dark/Light toggle all sit on one screen.",
      detail:
        "The number shown matches the one on the dial pad. Theme and notification settings affect only the local interface; they never leave the browser.",
      bullets: ["AR avatar initials", "Editable display name", "Dark or light toggle"],
      image: "/manus-storage/profile_15ca08be.png",
      alt: "RELAY profile page showing the AR avatar, display name editor, 6-digit number 316 897, and Dark / Light theme toggle.",
    },
  ],
  closing: {
    eyebrow: "END OF SCROLL",
    title: "Close the tab and the call ends",
    body: "Numbers and messages exist only while the browsers stay open. Nothing remains on any server afterward.",
    cta: "Open RELAY",
  },
  privacy_line: "No call audio, video, or text is stored on any server.",
} as const;

const VERSION = "v2.3.0";

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduced(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  return reduced;
}

/** Smooth, RAF-throttled scroll listener. */
function useScrollY(): number {
  const [y, setY] = useState(0);
  useEffect(() => {
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        setY(window.scrollY);
        raf = 0;
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);
  return y;
}

/**
 * Per-section scroll progress (0..1).
 * 0 = the section's top edge is at the bottom of the viewport (just entering).
 * 1 = the section's bottom edge is at the top of the viewport (just leaving).
 * The hook returns -1 when the section isn't measured yet so callers can skip work.
 */
function useSectionProgress(ref: React.RefObject<HTMLElement | null>): number {
  const scrollY = useScrollY();
  const [vh, setVh] = useState(() => (typeof window !== "undefined" ? window.innerHeight : 800));
  useEffect(() => {
    const onResize = () => setVh(window.innerHeight);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return useMemo(() => {
    const el = ref.current;
    if (!el) return -1;
    const rect = el.getBoundingClientRect();
    const top = rect.top; // px from viewport top
    const height = rect.height || 1;
    // Map [vh, -height] -> [0, 1].
    const raw = (vh - top) / (vh + height);
    return Math.max(0, Math.min(1, raw));
    // intentionally include scrollY so memo re-runs when scroll position changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollY, vh, ref]);
}

/**
 * A phone-shaped bezel that wraps a screenshot.
 * The frame is a light-on-dark gradient ring so the device reads on a near-black page.
 */
function PhoneFrame({
  src,
  alt,
  className = "",
  haloIntensity = 0.28,
}: {
  src: string;
  alt: string;
  className?: string;
  haloIntensity?: number;
}) {
  return (
    <div className={`relative ${className}`}>
      {/* Cyan halo behind the device */}
      <div
        aria-hidden
        className="absolute -inset-10 rounded-[64px] blur-3xl pointer-events-none"
        style={{
          background: `radial-gradient(55% 45% at 50% 50%, oklch(0.78 0.18 195 / ${haloIntensity}), transparent 70%)`,
        }}
      />
      {/* Outer bezel — light gradient ring */}
      <div
        className="relative rounded-[44px] p-[10px] shadow-2xl shadow-black/70"
        style={{
          background:
            "linear-gradient(160deg, oklch(0.38 0.01 220) 0%, oklch(0.18 0.012 220) 45%, oklch(0.32 0.01 220) 100%)",
        }}
      >
        {/* Inner screen — clipped; subtle lighter background so the dark screenshot reads against the bezel */}
        <div
          className="relative overflow-hidden rounded-[34px] ring-1 ring-black/40"
          style={{ background: "oklch(0.18 0.012 220)" }}
        >
          <img
            src={src}
            alt={alt}
            loading="lazy"
            draggable={false}
            className="block w-full select-none"
          />
          {/* Notch overlays the top of the screenshot */}
          <div
            aria-hidden
            className="absolute left-1/2 -translate-x-1/2 top-[6px] z-10 h-[16px] w-[78px] rounded-full"
            style={{ background: "oklch(0.04 0.012 220)" }}
          />
          {/* Soft glossy highlight along the top edge */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-12 z-0"
            style={{
              background:
                "linear-gradient(to bottom, rgba(255,255,255,0.04), transparent 80%)",
            }}
          />
        </div>
      </div>
      {/* Side button */}
      <div
        aria-hidden
        className="absolute right-[-3px] top-[28%] h-[64px] w-[3px] rounded-r-md"
        style={{
          background:
            "linear-gradient(90deg, oklch(0.20 0.012 220), oklch(0.38 0.01 220))",
        }}
      />
    </div>
  );
}

function HeroPhone({ reduced, scrollY }: { reduced: boolean; scrollY: number }) {
  const translate = reduced ? 0 : Math.min(scrollY * 0.18, 60);
  const tilt = reduced ? 0 : Math.min(scrollY * 0.02, 5);
  const opacity = reduced ? 1 : Math.max(0.55, 1 - scrollY / 900);
  return (
    <div
      className="mx-auto"
      style={{
        width: "min(300px, 78vw)",
        transform: `translate3d(0, ${-translate}px, 0) rotate(${-tilt}deg)`,
        transition: reduced ? "none" : "opacity 200ms ease-out",
        opacity,
      }}
    >
      <PhoneFrame
        src={COPY.sections[0].image}
        alt="RELAY dial pad on a phone screen, hero shot"
        haloIntensity={0.4}
      />
    </div>
  );
}

function StorySection({
  section,
  index,
  reduced,
}: {
  section: (typeof COPY.sections)[number];
  index: number;
  reduced: boolean;
}) {
  const ref = useRef<HTMLElement | null>(null);
  const progress = useSectionProgress(ref);
  const isVisible = progress > 0.15 && progress < 0.95;

  // Phone-image translate: -60px at entry → +30px at exit.
  // Result: image starts low, rises as user scrolls into the section, slips
  // upward as they scroll past — feels like the image is "carried" by scroll.
  const translateY = reduced ? 0 : -60 + progress * 90;

  // Detail panel fade in from x=24px once progress > 0.25.
  const panelProgress = Math.max(0, Math.min(1, (progress - 0.18) / 0.35));
  const panelX = reduced ? 0 : (1 - panelProgress) * 24;
  const panelOpacity = reduced ? 1 : panelProgress;

  // Alternate the layout direction so the scroll feels less repetitive.
  const reversed = index % 2 === 1;

  return (
    <section
      ref={ref}
      data-section={section.id}
      className="relative py-28 sm:py-36 lg:py-44 border-t border-white/5"
      aria-label={section.title}
    >
      <div
        className={`container max-w-6xl grid gap-12 lg:gap-20 items-center grid-cols-1 lg:grid-cols-12 ${
          reversed ? "lg:[&>div:first-child]:order-2" : ""
        }`}
      >
        {/* Phone screenshot column */}
        <div className="lg:col-span-5 flex justify-center">
          <div
            style={{
              width: "min(280px, 70vw)",
              transform: `translate3d(0, ${translateY}px, 0)`,
              transition: reduced ? "none" : "transform 60ms linear",
              willChange: "transform",
            }}
          >
            <PhoneFrame
              src={section.image}
              alt={section.alt}
              haloIntensity={isVisible ? 0.28 : 0.12}
            />
          </div>
        </div>

        {/* Detail panel column */}
        <div
          className="lg:col-span-7"
          style={{
            transform: `translate3d(${panelX}px, 0, 0)`,
            opacity: panelOpacity,
            transition: reduced ? "none" : "transform 120ms ease-out, opacity 120ms ease-out",
            willChange: "transform, opacity",
          }}
        >
          <p className="text-xs tracking-[0.25em] font-semibold text-[oklch(0.78_0.18_195)] uppercase">
            {section.eyebrow}
          </p>
          <h2 className="mt-3 text-3xl sm:text-4xl lg:text-5xl font-semibold leading-[1.08] tracking-tight text-white">
            {section.title}
          </h2>
          <p className="mt-5 text-lg sm:text-xl text-white/70 leading-snug">{section.lede}</p>
          <p className="mt-5 text-base sm:text-lg text-white/55 leading-relaxed max-w-xl">
            {section.detail}
          </p>
          <ul className="mt-8 space-y-2.5">
            {section.bullets.map((b, i) => (
              <li
                key={b}
                className="flex items-center gap-3 text-sm sm:text-base text-white/75"
                style={{
                  transform: reduced
                    ? "none"
                    : `translate3d(0, ${(1 - panelProgress) * (8 + i * 4)}px, 0)`,
                  opacity: reduced ? 1 : Math.max(0, panelProgress - i * 0.08),
                  transition: reduced
                    ? "none"
                    : "transform 200ms ease-out, opacity 200ms ease-out",
                }}
              >
                <span
                  aria-hidden
                  className="inline-block size-1.5 rounded-full bg-[oklch(0.78_0.18_195)]"
                />
                <span>{b}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

export default function Home() {
  const reduced = useReducedMotion();
  const scrollY = useScrollY();

  // Lock dark theme for the landing page so the brand palette renders correctly.
  useEffect(() => {
    const root = document.documentElement;
    const had = root.classList.contains("dark");
    root.classList.add("dark");
    return () => {
      if (!had) root.classList.remove("dark");
    };
  }, []);

  // Sticky top-bar reveal once user has scrolled past the hero.
  const stickyVisible = scrollY > 380;

  // Mouse-driven micro-tilt on the hero phone — subtle and disabled on mobile/reduced.
  const [mouse, setMouse] = useState({ x: 0, y: 0 });
  useEffect(() => {
    if (reduced) return;
    const onMove = (e: MouseEvent) => {
      const x = e.clientX / window.innerWidth - 0.5;
      const y = e.clientY / window.innerHeight - 0.5;
      setMouse({ x, y });
    };
    window.addEventListener("mousemove", onMove, { passive: true });
    return () => window.removeEventListener("mousemove", onMove);
  }, [reduced]);

  return (
    <div
      className="min-h-screen text-white antialiased selection:bg-[oklch(0.78_0.18_195)] selection:text-black"
      style={{ background: "oklch(0.10 0.012 220)" }}
    >
      {/* Page-wide ambient grid */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10 opacity-[0.05]"
        style={{
          backgroundImage:
            "linear-gradient(to right, white 1px, transparent 1px), linear-gradient(to bottom, white 1px, transparent 1px)",
          backgroundSize: "56px 56px",
        }}
      />

      {/* Sticky brand bar — appears after the hero */}
      <header
        className="fixed top-0 inset-x-0 z-40 transition-all duration-300 ease-out"
        style={{
          transform: stickyVisible ? "translateY(0)" : "translateY(-100%)",
          backgroundColor: "oklch(0.10 0.012 220 / 0.75)",
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        <div className="container max-w-6xl flex items-center justify-between py-3.5">
          <a href="/" className="flex items-center gap-2.5">
            <span
              className="size-2 rounded-full"
              style={{ background: "oklch(0.78 0.18 195)" }}
            />
            <span className="font-semibold tracking-wider">RELAY</span>
          </a>
          <a
            href="/app"
            className="rounded-full px-4 py-2 text-sm font-semibold transition-transform active:scale-[0.97]"
            style={{
              background: "oklch(0.78 0.18 195)",
              color: "oklch(0.13 0.012 220)",
            }}
          >
            Open the app
          </a>
        </div>
      </header>

      {/* HERO */}
      <section
        data-section="hero"
        className="relative overflow-hidden pt-20 sm:pt-28 pb-16 sm:pb-24"
      >
        <div className="container max-w-6xl">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span
                className="size-2 rounded-full"
                style={{ background: "oklch(0.78 0.18 195)" }}
              />
              <span className="font-semibold tracking-wider">RELAY</span>
            </div>
            <a
              href="/app"
              className="hidden sm:inline-flex rounded-full border border-white/15 px-4 py-2 text-sm font-medium text-white/85 hover:text-white hover:border-white/30 transition-colors"
            >
              Open the app
            </a>
          </div>

          <div className="mt-16 sm:mt-24 grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
            <div className="lg:col-span-7">
              <p className="text-xs tracking-[0.3em] font-semibold text-[oklch(0.78_0.18_195)] uppercase">
                {COPY.hero.eyebrow}
              </p>
              <h1 className="mt-5 text-4xl sm:text-6xl lg:text-7xl font-semibold leading-[1.02] tracking-tight whitespace-pre-line">
                {COPY.hero.headline}
              </h1>
              <p className="mt-7 max-w-xl text-lg sm:text-xl text-white/70 leading-snug">
                {COPY.hero.sub}
              </p>
              <div className="mt-10 flex flex-wrap items-center gap-3">
                <a
                  href="/app"
                  className="inline-flex items-center justify-center rounded-full px-6 py-3.5 font-semibold transition-transform active:scale-[0.97]"
                  style={{
                    background: "oklch(0.78 0.18 195)",
                    color: "oklch(0.13 0.012 220)",
                  }}
                >
                  {COPY.hero.primary_cta} →
                </a>
                <a
                  href="#dialer-empty"
                  className="inline-flex items-center justify-center rounded-full border border-white/20 px-6 py-3.5 font-medium text-white/85 hover:text-white hover:border-white/40 transition-colors"
                >
                  {COPY.hero.secondary_cta} ↓
                </a>
              </div>
              <p className="mt-10 text-sm text-white/40 max-w-md">{COPY.privacy_line}</p>
            </div>

            <div className="lg:col-span-5">
              <div
                style={{
                  transform: reduced
                    ? "none"
                    : `perspective(1200px) rotateY(${mouse.x * 6}deg) rotateX(${-mouse.y * 4}deg)`,
                  transition: reduced ? "none" : "transform 200ms ease-out",
                }}
              >
                <HeroPhone reduced={reduced} scrollY={scrollY} />
              </div>
            </div>
          </div>
        </div>

        {/* Soft cyan glow */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 -bottom-40 h-[60vh] -z-10"
          style={{
            background:
              "radial-gradient(50% 50% at 50% 0%, oklch(0.78 0.18 195 / 0.18), transparent 70%)",
          }}
        />
      </section>

      {/* STORY SECTIONS */}
      <main>
        {COPY.sections.map((s, i) => (
          <StorySection key={s.id} section={s} index={i} reduced={reduced} />
        ))}
      </main>

      {/* CLOSING */}
      <section
        data-section="closing"
        className="relative border-t border-white/5 py-32 sm:py-44 text-center overflow-hidden"
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            background:
              "radial-gradient(60% 55% at 50% 50%, oklch(0.78 0.18 195 / 0.16), transparent 70%)",
          }}
        />
        <div className="container max-w-3xl">
          <p className="text-xs tracking-[0.3em] font-semibold text-[oklch(0.78_0.18_195)] uppercase">
            {COPY.closing.eyebrow}
          </p>
          <h2 className="mt-5 text-3xl sm:text-5xl font-semibold leading-tight tracking-tight">
            {COPY.closing.title}
          </h2>
          <p className="mt-6 text-lg text-white/65 max-w-xl mx-auto leading-snug">
            {COPY.closing.body}
          </p>
          <a
            href="/app"
            className="mt-10 inline-flex items-center justify-center rounded-full px-7 py-4 font-semibold transition-transform active:scale-[0.97]"
            style={{
              background: "oklch(0.78 0.18 195)",
              color: "oklch(0.13 0.012 220)",
            }}
          >
            {COPY.closing.cta} →
          </a>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="border-t border-white/5 py-10">
        <div className="container max-w-6xl flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-white/40">
          <div className="flex items-center gap-2.5">
            <span className="size-1.5 rounded-full bg-[oklch(0.78_0.18_195)]" />
            <span className="tracking-widest">RELAY · {VERSION}</span>
          </div>
          <div className="text-white/35">Copy by Grok · screenshots are real</div>
        </div>
      </footer>
    </div>
  );
}
