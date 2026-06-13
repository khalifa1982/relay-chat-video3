import { useState, useEffect, useRef } from 'react';

// Data structure for the six story sections
interface SectionData {
  id: string;
  kicker: string;
  title: string;
  p1: string;
  p2: string;
  bullets: string[];
  img: string;
}

const SECTIONS_DATA: SectionData[] = [
  {
    id: 'section-1',
    kicker: 'INSTANT IDENTITY',
    title: 'Your number',
    p1: 'Every time you open RELAY, you are instantly allocated a temporary, secure 6-digit identity. No registration forms, no email verifications, and absolutely zero personal data required.',
    p2: 'The dialer displays your ephemeral number ghosted in faint green above the keypad. Anyone on the network can call this number directly as long as your tab remains active.',
    bullets: [
      'Zero-setup instant provisioning',
      'Faint green status indicators',
      'Completely ephemeral session binding'
    ],
    img: '/manus-storage/dialer-empty_98fa535c.png'
  },
  {
    id: 'section-2',
    kicker: 'REAL-TIME TELEMETRY',
    title: 'Live check',
    p1: 'Dialing on RELAY is coupled with real-time connectivity feedback. As you type a 6-digit destination, the network instantly queries the active peer registry.',
    p2: 'If the targeted node isn\'t online, a sub-line feedback message immediately lets you know the line is not reachable, saving you from waiting on dead connections.',
    bullets: [
      'Active registry lookup on-the-fly',
      'Instant status feedback below the input',
      'Smart routing prevention for dead lines'
    ],
    img: '/manus-storage/dialer-typed_8ad4c6c2.png'
  },
  {
    id: 'section-3',
    kicker: 'EPHEMERAL CHANNELS',
    title: 'Messages',
    p1: 'Communication isn\'t limited to voice. RELAY provides a super-fast, zero-overhead messaging console built directly into your active browser session.',
    p2: 'The empty state keeps distraction to a minimum. A simple, prominent plus button allows you to initiate a secure message thread instantly with any active peer.',
    bullets: [
      'Minimalist, clutter-free messaging hub',
      'Direct peer-to-peer message routing',
      'One-click thread creation'
    ],
    img: '/manus-storage/messages-empty_014c8014.png'
  },
  {
    id: 'section-4',
    kicker: 'SECURE SANDBOX',
    title: 'Notes to self',
    p1: 'Need a secure scratchpad or a way to test your connection? RELAY supports self-threading so you can send notes, files, and audio clips to your own active session.',
    p2: 'The rich composer panel features microphone, attachment, image, and emoji triggers. Everything you write is rendered in gorgeous cyan bubbles and stored purely in RAM.',
    bullets: [
      'Self-loopback testing and secure scratchpad',
      'Rich media attachment and voice memo controls',
      'Pure RAM storage with zero server footprint'
    ],
    img: '/manus-storage/messages-thread_3b435df8.png'
  },
  {
    id: 'section-5',
    kicker: 'ZERO PERSISTENCE',
    title: 'Contacts',
    p1: 'Keep track of your frequent collaborators without sacrificing privacy. RELAY includes an in-memory contact directory that lets you quickly search and trigger calls.',
    p2: 'Because we store nothing on our servers, this directory is built completely on-the-fly and vanishes the moment you close the browser tab.',
    bullets: [
      'Lightning-fast local search bar',
      'Instant click-to-dial functionality',
      '100% client-side memory storage'
    ],
    img: '/manus-storage/contacts-empty_ee775a4f.png'
  },
  {
    id: 'section-6',
    kicker: 'PERSONALIZED NODES',
    title: 'Profile',
    p1: 'Express yourself within your ephemeral session. Customize your node with a dynamically generated AR avatar, editable display name, and quick preferences.',
    p2: 'Toggle between dark and light modes seamlessly while keeping your 6-digit number visible. Your preferences live in local browser memory and never touch a centralized DB.',
    bullets: [
      'Generative AR-style avatar hashes',
      'On-the-fly display name editing',
      'No-latency dark/light interface toggle'
    ],
    img: '/manus-storage/profile_15ca08be.png'
  }
];

// Faux Phone Bezel Component
const PhoneBezel = ({ src, alt }: { src: string; alt: string }) => {
  return (
    <div className="relative mx-auto w-full max-w-[290px] aspect-[9/19.5] rounded-[48px] border-[11px] border-[#1e293b] bg-black shadow-[0_25px_60px_-15px_rgba(0,0,0,0.9)] ring-1 ring-white/10 overflow-hidden">
      {/* Notch / Dynamic Island */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 w-28 h-5 bg-black rounded-full z-30 flex items-center justify-between px-3.5">
        <div className="w-2.5 h-2.5 rounded-full bg-[#111] border border-slate-900 flex items-center justify-center">
          <div className="w-1 h-1 rounded-full bg-blue-950" />
        </div>
        <div className="w-1.5 h-1.5 rounded-full bg-[#111]" />
      </div>

      {/* Speaker grill / Ear piece */}
      <div className="absolute top-1.5 left-1/2 -translate-x-1/2 w-12 h-1 bg-[#222] rounded-full z-30" />

      {/* Side Buttons (Faux physical chrome) */}
      <div className="absolute top-24 -left-[13px] w-[2px] h-10 bg-slate-700 rounded-l z-10" />
      <div className="absolute top-38 -left-[13px] w-[2px] h-14 bg-slate-700 rounded-l z-10" />
      <div className="absolute top-56 -left-[13px] w-[2px] h-14 bg-slate-700 rounded-l z-10" />
      <div className="absolute top-32 -right-[13px] w-[2px] h-16 bg-slate-700 rounded-r z-10" />

      {/* Glossy glare effect overlay */}
      <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/[0.02] to-white/[0.06] pointer-events-none z-20" />

      {/* Screen Content */}
      <div className="absolute inset-0 w-full h-full bg-slate-950 overflow-hidden">
        <img
          src={src}
          alt={alt}
          className="w-full h-full object-cover select-none"
          loading="lazy"
        />
      </div>
    </div>
  );
};

export default function Home() {
  const [stickyVisible, setStickyVisible] = useState(false);
  const prefersReducedMotion = useRef<boolean>(false);

  useEffect(() => {
    // Check user preference for reduced motion
    prefersReducedMotion.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let rafId: number;

    const handleScroll = () => {
      const scrollY = window.scrollY;
      
      // Hard contract: comparison must literally be scrollY > 480
      setStickyVisible(scrollY > 480);

      if (prefersReducedMotion.current) return;

      // Animate sections based on scroll position
      const sections = document.querySelectorAll('.story-section');
      sections.forEach((sec, idx) => {
        const rect = sec.getBoundingClientRect();
        const viewHeight = window.innerHeight;
        
        // Calculate relative position to viewport center (-1.5 to 1.5)
        const sectionCenter = rect.top + rect.height / 2;
        const viewportCenter = viewHeight / 2;
        const distanceFromCenter = (sectionCenter - viewportCenter) / viewportCenter;
        const t = Math.max(-1.5, Math.min(1.5, distanceFromCenter));

        const phone = sec.querySelector('.phone-wrapper') as HTMLElement;
        const text = sec.querySelector('.text-wrapper') as HTMLElement;
        const halo = sec.querySelector('.halo-bg') as HTMLElement;

        if (phone) {
          // Phones translate vertically and tilt slightly depending on scroll
          const translateY = t * 40;
          const rotate = t * -3;
          phone.style.transform = `translateY(${translateY}px) rotate(${rotate}deg)`;
        }

        if (text) {
          // Text fades in and moves slightly vertically
          const opacity = Math.max(0, 1 - Math.abs(t) * 1.3);
          const translateY = t * 15;
          text.style.opacity = `${opacity}`;
          text.style.transform = `translateY(${translateY}px)`;
        }

        if (halo) {
          // Halos shift scale and fade
          const scale = 1 + (1 - Math.min(1, Math.abs(t))) * 0.25;
          const opacity = Math.max(0, 0.12 - Math.abs(t) * 0.08);
          halo.style.transform = `translate(-50%, -50%) scale(${scale})`;
          halo.style.opacity = `${opacity}`;
        }
      });
    };

    const onScroll = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(handleScroll);
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    handleScroll(); // Initial run

    return () => {
      window.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(rafId);
    };
  }, []);

  return (
    <div 
      className="min-h-screen text-slate-100 selection:bg-[oklch(0.78_0.18_195)] selection:text-slate-950 overflow-x-hidden relative font-sans"
      style={{ backgroundColor: 'oklch(0.10 0.012 220)' }}
    >
      {/* Custom Styles */}
      <style>{`
        @keyframes pulse-glow {
          0%, 100% { opacity: 0.15; transform: scale(1); }
          50% { opacity: 0.25; transform: scale(1.05); }
        }
        .animate-pulse-glow {
          animation: pulse-glow 8s infinite ease-in-out;
        }
        .grid-bg {
          background-image: linear-gradient(rgba(255, 255, 255, 0.015) 1px, transparent 1px),
                            linear-gradient(90deg, rgba(255, 255, 255, 0.015) 1px, transparent 1px);
          background-size: 40px 40px;
        }
      `}</style>

      {/* Grid Pattern Overlay */}
      <div className="absolute inset-0 grid-bg pointer-events-none z-0" />

      {/* Header & Sticky CTA */}
      <header className="fixed top-0 inset-x-0 h-20 z-50 flex items-center justify-between px-6 md:px-12 pointer-events-none">
        <div className="flex items-center gap-3 bg-slate-950/40 backdrop-blur-md px-4 py-2 rounded-full border border-white/5 pointer-events-auto shadow-lg">
          <div className="w-2.5 h-2.5 rounded-full bg-[oklch(0.78_0.18_195)] animate-pulse shadow-[0_0_10px_oklch(0.78_0.18_195)]" />
          <span className="font-semibold tracking-wider text-sm text-white">RELAY</span>
        </div>

        {/* Sticky CTA (fades in after 480px scroll) */}
        <div 
          className={`transition-all duration-300 transform pointer-events-auto ${
            stickyVisible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-4'
          }`}
        >
          <a 
            href="/app"
            className="inline-flex items-center justify-center px-5 py-2.5 rounded-full text-sm font-semibold bg-[oklch(0.78_0.18_195)] text-slate-950 hover:bg-[oklch(0.83_0.15_195)] active:scale-98 transition-all shadow-[0_0_20px_rgba(38,230,255,0.25)] hover:shadow-[0_0_25px_rgba(38,230,255,0.4)]"
          >
            Open the app
          </a>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative min-h-[95vh] flex flex-col justify-center items-center px-6 text-center pt-24 pb-16 z-10 overflow-hidden">
        {/* Background glow */}
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] rounded-full bg-[oklch(0.78_0.18_195)]/10 blur-[100px] pointer-events-none animate-pulse-glow" />

        <div className="max-w-4xl mx-auto flex flex-col items-center">
          <span className="text-xs md:text-sm font-bold tracking-[0.25em] text-[oklch(0.78_0.18_195)] uppercase mb-6 drop-shadow-sm">
            BROWSER CALLS
          </span>
          <h1 className="text-4xl sm:text-6xl md:text-7xl font-extrabold text-white tracking-tight leading-[1.1] mb-8">
            Voice in the same <br className="hidden sm:block" />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-white via-[oklch(0.78_0.18_195)] to-white">
              tab you work in
            </span>
          </h1>
          <p className="text-lg md:text-xl text-slate-300 max-w-2xl leading-relaxed mb-10 font-normal">
            Open a dial pad, type a number, speak. No installs, no accounts, nothing left behind when the tab closes.
          </p>
          
          <div className="flex flex-col items-center gap-4">
            <a 
              href="/app"
              className="group inline-flex items-center justify-center px-8 py-4 rounded-full text-base font-bold bg-[oklch(0.78_0.18_195)] text-slate-950 hover:bg-[oklch(0.83_0.15_195)] active:scale-98 transition-all shadow-[0_0_30px_rgba(38,230,255,0.3)] hover:shadow-[0_0_40px_rgba(38,230,255,0.5)]"
            >
              Open RELAY →
            </a>
            <span className="text-xs text-slate-500 max-w-xs leading-normal">
              No call audio, video, or text is stored on any server.
            </span>
          </div>
        </div>
      </section>

      {/* Story Sections */}
      <div className="relative py-12 space-y-36 lg:space-y-48 max-w-7xl mx-auto px-6 md:px-12 z-10">
        {SECTIONS_DATA.map((section, idx) => {
          const isEven = idx % 2 === 0;
          return (
            <section 
              key={section.id} 
              id={section.id}
              className="story-section relative grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-20 items-center min-h-[60vh]"
            >
              {/* Radial Cyan Glow behind each phone */}
              <div 
                className="halo-bg absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[350px] lg:w-[450px] aspect-square rounded-full bg-[oklch(0.78_0.18_195)]/5 blur-[80px] pointer-events-none transition-all duration-300 ease-out opacity-0"
                style={{
                  left: isEven ? '70%' : '30%'
                }}
              />

              {/* Text content */}
              <div className={`lg:col-span-5 text-wrapper transition-all duration-300 ease-out opacity-100 ${
                isEven ? 'lg:order-first' : 'lg:order-last'
              }`}>
                <span className="text-xs font-bold tracking-[0.2em] text-[oklch(0.78_0.18_195)] uppercase block mb-3">
                  {section.kicker}
                </span>
                <h2 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight mb-6">
                  {section.title}
                </h2>
                <div className="space-y-4 text-slate-300 text-base sm:text-lg leading-relaxed mb-8">
                  <p>{section.p1}</p>
                  <p>{section.p2}</p>
                </div>
                
                {/* 3 Bullet Facts */}
                <ul className="space-y-3">
                  {section.bullets.map((bullet, bIdx) => (
                    <li key={bIdx} className="flex items-start gap-3 text-sm text-slate-400">
                      <span className="mt-1 flex-shrink-0 w-1.5 h-1.5 rounded-full bg-[oklch(0.78_0.18_195)] shadow-[0_0_6px_oklch(0.78_0.18_195)]" />
                      <span>{bullet}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Phone Bezel */}
              <div className={`lg:col-span-7 flex justify-center phone-wrapper transition-all duration-300 ease-out will-change-transform ${
                isEven ? 'lg:order-last' : 'lg:order-first'
              }`}>
                <PhoneBezel src={section.img} alt={section.title} />
              </div>
            </section>
          );
        })}
      </div>

      {/* Finale Section */}
      <section className="relative min-h-[80vh] flex flex-col justify-center items-center px-6 text-center py-24 z-10 overflow-hidden">
        {/* Background glow */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[450px] h-[450px] rounded-full bg-[oklch(0.78_0.18_195)]/10 blur-[90px] pointer-events-none" />

        <div className="max-w-3xl mx-auto flex flex-col items-center">
          <span className="text-xs md:text-sm font-bold tracking-[0.25em] text-[oklch(0.78_0.18_195)] uppercase mb-6">
            END OF SCROLL
          </span>
          <h2 className="text-4xl sm:text-5xl md:text-6xl font-extrabold text-white tracking-tight mb-8">
            Close the tab and <br className="hidden sm:block" />
            the call ends
          </h2>
          <p className="text-lg md:text-xl text-slate-300 max-w-xl leading-relaxed mb-10 font-normal">
            Numbers and messages exist only while the browsers stay open. Nothing remains on any server afterward.
          </p>
          
          <a 
            href="/app"
            className="group inline-flex items-center justify-center px-8 py-4 rounded-full text-base font-bold bg-[oklch(0.78_0.18_195)] text-slate-950 hover:bg-[oklch(0.83_0.15_195)] active:scale-98 transition-all shadow-[0_0_30px_rgba(38,230,255,0.3)] hover:shadow-[0_0_40px_rgba(38,230,255,0.5)]"
          >
            Open RELAY →
          </a>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative border-t border-white/5 py-12 text-center z-10">
        <p className="text-xs text-slate-500 tracking-wider">
          RELAY · v2.11.0 · Designed by gemini-3.5-flash
        </p>
      </footer>
    </div>
  );
}
