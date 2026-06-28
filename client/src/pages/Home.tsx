import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { APP_VERSION } from "@shared/version";

/* -------------------------------------------------------------------------- */
/*  Bilingual landing page (AR / EN).                                          */
/*  Language is a local UI preference only; it does NOT touch the in-app       */
/*  experience. Arabic flips the document to RTL.                              */
/*  Copy is intentionally plain and friendly (rewritten for clarity).          */
/* -------------------------------------------------------------------------- */

type Lang = "en" | "ar";

/* Authentic UI visuals grounded on the REAL in-app screens captured from the
   live RELAY app (asset URLs tied to the project lifecycle — they do not
   expire). */
const IMG = {
  // Real screenshots captured directly from the live app at your-chat.org/app
  heroBg: "/manus-storage/relay-real-call_913247ed.png",
  dialer: "/manus-storage/relay-real-dialer_7eafdee6.png",
  chat: "/manus-storage/relay-real-messages_ee881e78.png",
  group: "/manus-storage/relay-real-call_913247ed.png",
  mobile: "/manus-storage/relay-real-mobile_a5c81f70.png",
};

const T = {
  en: {
    dir: "ltr" as const,
    nav_open: "Open the app",
    hero_kicker: "No downloads. No signups.",
    hero_title_1: "The simplest way to call",
    hero_title_2: "right from your browser.",
    hero_sub:
      "Type your name and get a personal 6-digit number. Share it with friends or family so they can call you instantly.",
    hero_cta: "Open RELAY",
    hero_note:
      "Your number stays on this device for 30 days. Register anytime to keep it forever.",
    stats_title: "Zero barriers to connect",
    stats_sub:
      "No app store visits. No passwords to remember. Just open a link and start talking.",
    stat_registered: "Registered users",
    stat_guests: "Guests served",
    stat_total: "Total identities",
    stat_online: "Online now",
    feat_kicker: "Everything you need",
    feat_title: "Simple tools for better conversations",
    feat_sub:
      "We built all the essential features you expect, without any of the clutter.",
    features: [
      {
        t: "Your own number",
        d: "Get a unique 6-digit number instantly without giving away your personal details.",
      },
      {
        t: "Clear audio and video",
        d: "Enjoy high-quality one-on-one calls that connect directly between you and your friend.",
      },
      {
        t: "Easy group links",
        d: "Create a room and send a link to bring everyone together in a video call.",
      },
      {
        t: "Helpful host controls",
        d: "Mute everyone, add co-hosts, or pin important speakers to keep your meetings organized.",
      },
      {
        t: "Rich chat messaging",
        d: "Send files, share photos, and record quick voice notes right inside the chat.",
      },
      {
        t: "Share your screen",
        d: "Show your screen to others while keeping their video in a small, floating window.",
      },
      {
        t: "Flexible audio options",
        d: "Switch easily between your phone speaker, headphones, or Bluetooth devices.",
      },
      {
        t: "One-tap redial",
        d: "See your past calls and quickly call back a friend or a whole group with one tap.",
      },
      {
        t: "Private by design",
        d: "Your data stays on your device, and your calls go directly from person to person.",
      },
    ],
    shots_title: "Designed for daily life",
    shot_dialer_t: "The dialer",
    shot_dialer_d:
      "Just type a 6-digit number and call. No contact lists or setup needed.",
    shot_chat_t: "Interactive chat",
    shot_chat_d:
      "Share photos, drop files, and send voice notes while you talk.",
    shot_group_t: "Group meetings",
    shot_group_d:
      "Invite anyone with a link. The active speaker automatically takes center stage.",
    mobile_t: "Works on your phone too",
    mobile_d:
      "Open the website on your mobile browser. It rings just like a normal phone call, even when you are on the go.",
    cta_title: "Ready to start your first call?",
    cta_sub: "Get your 6-digit number in two seconds. No email required.",
    cta_btn: "Open RELAY",
    footer_tag: "Simple calls, straight from your browser.",
    footer_rights: "All rights reserved.",
  },
  ar: {
    dir: "rtl" as const,
    nav_open: "افتح التطبيق",
    hero_kicker: "بدون تحميل. بدون تسجيل.",
    hero_title_1: "أسهل طريقة للاتصال",
    hero_title_2: "مباشرة من متصفحك.",
    hero_sub:
      "اكتب اسمك واحصل فوراً على رقم شخصي من ٦ أرقام. شاركه مع الأصدقاء أو العائلة ليتصلوا بك مباشرة.",
    hero_cta: "افتح RELAY",
    hero_note:
      "يبقى رقمك على هذا الجهاز لمدة ٣٠ يوماً. يمكنك تسجيله في أي وقت للاحتفاظ به للأبد.",
    stats_title: "تواصل بلا عوائق",
    stats_sub:
      "لا حاجة لزيارة متجر التطبيقات ولا كلمات مرور لتذكّرها. فقط افتح الرابط وابدأ التحدّث.",
    stat_registered: "مستخدمون مسجّلون",
    stat_guests: "ضيوف استخدموا النظام",
    stat_total: "إجمالي الهويات",
    stat_online: "متصل الآن",
    feat_kicker: "كل ما تحتاجه",
    feat_title: "أدوات بسيطة لمحادثات أفضل",
    feat_sub: "صمّمنا كل الميزات الأساسية التي تحتاجها، دون أي تعقيد.",
    features: [
      {
        t: "رقم خاص بك",
        d: "احصل على رقم فريد من ٦ أرقام فوراً دون الحاجة لمشاركة بياناتك الشخصية.",
      },
      {
        t: "مكالمات واضحة",
        d: "استمتع بمكالمات صوت وفيديو عالية الجودة مباشرة بينك وبين أصدقائك.",
      },
      {
        t: "روابط جماعية سهلة",
        d: "أنشئ غرفة محادثة وأرسل الرابط لجمع الجميع في مكالمة فيديو واحدة.",
      },
      {
        t: "تحكّم كامل للمضيف",
        d: "اكتم صوت الجميع، عيّن مضيفين مساعدين، أو ثبّت المتحدثين لتنظيم اجتماعك.",
      },
      {
        t: "محادثات نصية غنية",
        d: "أرسل الملفات، وشارك الصور، وسجّل ملاحظات صوتية سريعة داخل الدردشة.",
      },
      {
        t: "مشاركة الشاشة",
        d: "اعرض شاشتك للآخرين مع إبقاء صورتهم في نافذة صغيرة عائمة.",
      },
      {
        t: "خيارات صوت مرنة",
        d: "تنقّل بسهولة بين مكبّر الصوت، أو سماعات الرأس، أو أجهزة البلوتوث.",
      },
      {
        t: "إعادة اتصال بلمسة",
        d: "شاهد سجلّ مكالماتك السابقة وأعد الاتصال بصديق أو بمجموعة كاملة بلمسة واحدة.",
      },
      {
        t: "خصوصية تامة",
        d: "تبقى بياناتك على جهازك وتتم مكالماتك مباشرة من جهاز إلى آخر.",
      },
    ],
    shots_title: "مصمّم لحياتك اليومية",
    shot_dialer_t: "لوحة الاتصال",
    shot_dialer_d:
      "اكتب الرقم المكوّن من ٦ أرقام واتصل مباشرة، دون الحاجة لقوائم جهات اتصال.",
    shot_chat_t: "دردشة تفاعلية",
    shot_chat_d: "شارك الصور والملفات وأرسل رسائل صوتية أثناء التحدّث.",
    shot_group_t: "الاجتماعات الجماعية",
    shot_group_d:
      "ادعُ أي شخص عبر رابط، وسيركّز التطبيق تلقائياً على الشخص الذي يتحدّث.",
    mobile_t: "يعمل على هاتفك أيضاً",
    mobile_d:
      "افتح الموقع من متصفح هاتفك. سيرنّ تماماً كأي مكالمة عادية حتى أثناء تنقّلك.",
    cta_title: "جاهز لبدء مكالمتك الأولى؟",
    cta_sub:
      "احصل على رقمك المكوّن من ٦ أرقام في ثانيتين. لا يتطلّب بريداً إلكترونياً.",
    cta_btn: "افتح RELAY",
    footer_tag: "ريليه — مكالمات بسيطة، مباشرة من متصفحك.",
    footer_rights: "جميع الحقوق محفوظة.",
  },
};

const PAGE_BG = "oklch(0.10 0.012 220)";
const CYAN = "oklch(0.78 0.18 195)";

/* Splits a string into <span> words so each word can be revealed with its own
   staggered delay. Keeps spaces between words. Works for both LTR and RTL. */
function WordReveal({
  text,
  className,
  baseDelay = 0,
  step = 55,
}: {
  text: string;
  className?: string;
  baseDelay?: number;
  step?: number;
}) {
  const words = text.split(" ");
  return (
    <span className={className} data-reveal="words">
      {words.map((w, i) => (
        <span
          key={i}
          className="word"
          style={{ "--wd": `${baseDelay + i * step}ms` } as React.CSSProperties}
        >
          {w}
          {i < words.length - 1 ? "\u00A0" : ""}
        </span>
      ))}
    </span>
  );
}

/* Reveal-on-scroll: adds `.is-in` to any [data-reveal] element the first time
   it scrolls into view. One observer for the whole page, disconnected on
   unmount. Honors prefers-reduced-motion via the CSS (animation is gated). */
function useScrollReveal(deps: unknown[] = []) {
  useEffect(() => {
    const els = Array.from(
      document.querySelectorAll<HTMLElement>("[data-reveal]"),
    );
    if (els.length === 0) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("is-in");
            io.unobserve(e.target);
          }
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -8% 0px" },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

function useCountUp(target: number, run: boolean, duration = 1200) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!run) return;
    if (target <= 0) {
      setValue(0);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setValue(Math.round(target * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, run, duration]);
  return value;
}

/* Drives full-page scroll-linked motion. Writes three CSS custom properties on
   <html> on every animation frame:
     --sp  = overall scroll progress 0..1   (progress bar width)
     --sy  = raw scrollY in px               (hero parallax)
     --hue = scroll-driven hue offset in deg (page-wide color shift)
   rAF-throttled and passive so it never blocks scrolling. Gated by
   prefers-reduced-motion. */
function useScrollMotion() {
  useEffect(() => {
    if (
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }
    const root = document.documentElement;
    let raf = 0;
    const update = () => {
      raf = 0;
      const max = root.scrollHeight - window.innerHeight;
      const sp = max > 0 ? Math.min(1, window.scrollY / max) : 0;
      root.style.setProperty("--sp", String(sp));
      root.style.setProperty("--sy", String(window.scrollY));
      // Drift the page accent through a calm cyan→green→violet arc as you scroll.
      root.style.setProperty("--hue", String(Math.round(sp * 90)));
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
      root.style.removeProperty("--sp");
      root.style.removeProperty("--sy");
      root.style.removeProperty("--hue");
    };
  }, []);
}

export default function Home() {
  const [lang, setLang] = useState<Lang>("en");
  const [statsVisible, setStatsVisible] = useState(false);
  const t = T[lang];
  const isAr = lang === "ar";

  const { data: stats } = trpc.stats.public.useQuery(undefined, {
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  // Reflect language on <html> for correct RTL rendering.
  useEffect(() => {
    const html = document.documentElement;
    const prevDir = html.getAttribute("dir");
    const prevLang = html.getAttribute("lang");
    html.setAttribute("dir", t.dir);
    html.setAttribute("lang", lang);
    return () => {
      if (prevDir) html.setAttribute("dir", prevDir);
      else html.removeAttribute("dir");
      if (prevLang) html.setAttribute("lang", prevLang);
      else html.removeAttribute("lang");
    };
  }, [lang, t.dir]);

  // Fix the black overscroll gap on mobile: paint <html> and <body> with the
  // page background so any rubber-band scroll past the footer matches the page
  // instead of revealing the theme's near-black body color. Restored on unmount
  // so the in-app routes keep their own background.
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const prev = {
      htmlBg: html.style.backgroundColor,
      bodyBg: body.style.backgroundColor,
      overscroll: html.style.overscrollBehaviorY,
    };
    html.style.backgroundColor = PAGE_BG;
    body.style.backgroundColor = PAGE_BG;
    html.style.overscrollBehaviorY = "none";
    return () => {
      html.style.backgroundColor = prev.htmlBg;
      body.style.backgroundColor = prev.bodyBg;
      html.style.overscrollBehaviorY = prev.overscroll;
    };
  }, []);

  // Progressive reveal of section content while scrolling. Re-scan when the
  // language changes since the DOM subtree is rebuilt.
  useScrollReveal([lang]);

  // Full-page scroll-linked motion (progress bar + hero parallax + hue shift).
  useScrollMotion();

  // Trigger count-up once the stats band scrolls into view.
  useEffect(() => {
    const el = document.getElementById("stats-band");
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setStatsVisible(true);
          io.disconnect();
        }
      },
      { threshold: 0.3 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const registered = useCountUp(stats?.registeredUsers ?? 0, statsVisible);
  const guests = useCountUp(stats?.guestsServed ?? 0, statsVisible);
  const total = useCountUp(stats?.totalParties ?? 0, statsVisible);
  const online = stats?.onlineNow ?? 0;

  const fmt = (n: number) =>
    new Intl.NumberFormat(isAr ? "ar-EG" : "en-US").format(n);

  return (
    <div
      dir={t.dir}
      className="min-h-screen text-slate-100 overflow-x-hidden relative font-sans selection:bg-[oklch(0.78_0.18_195)] selection:text-slate-950"
      style={{ backgroundColor: PAGE_BG }}
    >
      <style>{`
        @keyframes pulse-glow { 0%,100%{opacity:.15;transform:scale(1)} 50%{opacity:.28;transform:scale(1.05)} }
        .animate-pulse-glow{animation:pulse-glow 8s infinite ease-in-out}
        .grid-bg{background-image:linear-gradient(rgba(255,255,255,.015) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.015) 1px,transparent 1px);background-size:40px 40px}
        @keyframes fade-up { from{opacity:0;transform:translateY(16px)} to{opacity:1;transform:translateY(0)} }
        .shot-img{box-shadow:0 30px 80px -20px rgba(0,0,0,.85);}

        /* Page-wide accent that drifts with scroll (--hue set by useScrollMotion).
           Everything that reads var(--accent) shifts hue together as you scroll. */
        :root{ --accent: ${CYAN}; }
        @media (prefers-reduced-motion: no-preference){
          .accent-shift{ filter: hue-rotate(calc(var(--hue, 0) * 1deg)); }
        }

        /* Top scroll-progress bar driven by --sp; its hue drifts with --hue too. */
        .scroll-progress{
          position:fixed;top:0;left:0;right:0;height:3px;z-index:60;
          transform-origin:0 50%;
          transform:scaleX(var(--sp, 0));
          background:linear-gradient(90deg, ${CYAN}, #34d399);
          box-shadow:0 0 12px rgba(38,230,255,.5);
        }
        @media (prefers-reduced-motion: no-preference){
          .scroll-progress{ filter: hue-rotate(calc(var(--hue, 0) * 1deg)); }
        }
        [dir="rtl"] .scroll-progress{transform-origin:100% 50%;}

        /* Slow drifting aurora behind the whole page. Two large radial blobs that
           rotate/translate forever; very low opacity so text stays readable.
           Hue also drifts with scroll so the ambient color changes as you move. */
        @keyframes aurora-drift {
          0%   { transform: translate3d(-8%, -6%, 0) rotate(0deg); }
          50%  { transform: translate3d(8%, 6%, 0) rotate(180deg); }
          100% { transform: translate3d(-8%, -6%, 0) rotate(360deg); }
        }
        .aurora{
          position:fixed;inset:-20%;z-index:0;pointer-events:none;
          background:
            radial-gradient(40% 40% at 25% 30%, oklch(0.78 0.18 195 / 0.10), transparent 70%),
            radial-gradient(45% 45% at 75% 70%, oklch(0.72 0.16 160 / 0.10), transparent 70%);
          filter:blur(20px);
        }
        @media (prefers-reduced-motion: no-preference){
          .aurora{
            animation:aurora-drift 36s linear infinite;
            filter:blur(20px) hue-rotate(calc(var(--hue, 0) * 1.4deg));
          }
        }

        /* Hero parallax: nudge the bg layer up as the user scrolls (--sy in px). */
        @media (prefers-reduced-motion: no-preference){
          .hero-parallax{ transform: translate3d(0, calc(var(--sy, 0) * 0.18px), 0) scale(1.06); }
          .hero-fade{ opacity: clamp(0, calc(1 - var(--sy, 0) * 0.0018), 1); }
        }

        /* Scroll-reveal: elements start slightly down + faded, then ease into
           place once .is-in is added by the IntersectionObserver. transform +
           opacity only (GPU-friendly). Staggered via inline --d delay. */
        [data-reveal]{ opacity:1;transform:none; }
        @media (prefers-reduced-motion: no-preference){
          .fade-up{animation:fade-up .6s cubic-bezier(0.23,1,0.32,1) both}
          [data-reveal]{
            opacity:0;
            transform:translateY(34px) scale(0.985);
            transition:opacity .7s cubic-bezier(0.23,1,0.32,1),
                       transform .7s cubic-bezier(0.23,1,0.32,1);
            transition-delay:var(--d, 0ms);
            will-change:opacity, transform;
          }
          [data-reveal="left"]{transform:translateX(-40px)}
          [data-reveal="right"]{transform:translateX(40px)}
          /* Word-by-word headline reveal: the wrapper itself does not move/fade
             (it is just a layout container); each child .word rises into place. */
          [data-reveal="words"]{ opacity:1;transform:none; }
          .word{
            display:inline-block;
            opacity:0;
            transform:translateY(0.5em);
            transition:opacity .55s cubic-bezier(0.23,1,0.32,1),
                       transform .55s cubic-bezier(0.23,1,0.32,1);
          }
          [data-reveal="words"].is-in .word{
            opacity:1;
            transform:none;
            transition-delay:var(--wd, 0ms);
          }
          [data-reveal].is-in{ opacity:1;transform:none; }
        }
      `}</style>

      <div className="scroll-progress" aria-hidden="true" />
      <div className="aurora" aria-hidden="true" />
      <div className="absolute inset-0 grid-bg pointer-events-none z-0" />

      {/* Header */}
      <header className="fixed top-0 inset-x-0 h-20 z-50 flex items-center justify-between px-5 md:px-12 pointer-events-none">
        <div className="flex items-center gap-3 bg-slate-950/50 backdrop-blur-md px-4 py-2 rounded-full border border-white/5 pointer-events-auto shadow-lg">
          <span
            className="w-2.5 h-2.5 rounded-full animate-pulse accent-shift"
            style={{ backgroundColor: CYAN, boxShadow: `0 0 10px ${CYAN}` }}
          />
          <span className="font-semibold tracking-wider text-sm text-white">RELAY</span>
        </div>

        <div className="flex items-center gap-2 pointer-events-auto">
          {/* Language toggle */}
          <div className="flex items-center rounded-full bg-slate-950/50 backdrop-blur-md border border-white/10 p-0.5 text-xs font-semibold">
            <button
              onClick={() => setLang("en")}
              className={`px-3 py-1.5 rounded-full transition-all duration-200 ${
                lang === "en" ? "bg-white text-slate-950" : "text-slate-300 hover:text-white"
              }`}
              aria-pressed={lang === "en"}
            >
              EN
            </button>
            <button
              onClick={() => setLang("ar")}
              className={`px-3 py-1.5 rounded-full transition-all duration-200 ${
                lang === "ar" ? "bg-white text-slate-950" : "text-slate-300 hover:text-white"
              }`}
              aria-pressed={lang === "ar"}
            >
              ع
            </button>
          </div>
          <a
            href="/app"
            className="hidden sm:inline-flex items-center justify-center px-5 py-2.5 rounded-full text-sm font-semibold text-slate-950 transition-all active:scale-[0.97] accent-shift"
            style={{ backgroundColor: CYAN, boxShadow: "0 0 20px rgba(38,230,255,.25)" }}
          >
            {t.nav_open}
          </a>
        </div>
      </header>

      {/* Hero */}
      <section className="relative min-h-[92vh] flex flex-col justify-center items-center px-6 text-center pt-28 pb-16 z-10 overflow-hidden">
        <div
          className="absolute inset-0 z-0 opacity-70 hero-parallax"
          style={{
            backgroundImage: `url(${IMG.heroBg})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        />
        <div
          className="absolute inset-0 z-0"
          style={{
            background:
              "radial-gradient(circle at 50% 35%, transparent 0%, oklch(0.10 0.012 220 / 0.7) 60%, oklch(0.10 0.012 220) 100%)",
          }}
        />

        <div className="max-w-4xl mx-auto flex flex-col items-center relative z-10 fade-up hero-fade">
          <span
            className="text-[11px] md:text-xs font-bold tracking-[0.25em] uppercase mb-6 accent-shift"
            style={{ color: CYAN }}
          >
            {t.hero_kicker}
          </span>
          <h1 className="text-4xl sm:text-6xl md:text-7xl font-extrabold text-white tracking-tight leading-[1.12] mb-7">
            <WordReveal text={t.hero_title_1} />
            <br className="hidden sm:block" />{" "}
            <span
              className="text-transparent bg-clip-text accent-shift"
              style={{
                backgroundImage: `linear-gradient(90deg, #fff, ${CYAN}, #fff)`,
              }}
            >
              <WordReveal
                text={t.hero_title_2}
                baseDelay={t.hero_title_1.split(" ").length * 55}
              />
            </span>
          </h1>
          <p className="text-lg md:text-xl text-slate-300 max-w-2xl leading-relaxed mb-10">
            {t.hero_sub}
          </p>
          <div className="flex flex-col items-center gap-4">
            <a
              href="/app"
              className="inline-flex items-center justify-center px-8 py-4 rounded-full text-base font-bold text-slate-950 transition-all active:scale-[0.97] accent-shift"
              style={{ backgroundColor: CYAN, boxShadow: "0 0 32px rgba(38,230,255,.35)" }}
            >
              {t.hero_cta} {isAr ? "←" : "→"}
            </a>
            <span className="text-xs text-slate-400 max-w-xs leading-normal">{t.hero_note}</span>
          </div>
        </div>
      </section>

      {/* Live stats band */}
      <section id="stats-band" className="relative z-10 px-6 py-16 md:py-20">
        <div className="max-w-5xl mx-auto text-center mb-10">
          <h2 className="text-2xl sm:text-3xl font-extrabold text-white mb-3" data-reveal="words">
            {t.stats_title.split(" ").map((w, i, arr) => (
              <span
                key={i}
                className="word"
                style={{ "--wd": `${i * 60}ms` } as React.CSSProperties}
              >
                {w}
                {i < arr.length - 1 ? "\u00A0" : ""}
              </span>
            ))}
          </h2>
          <p className="text-slate-400" data-reveal style={{ "--d": "120ms" } as React.CSSProperties}>
            {t.stats_sub}
          </p>
        </div>
        <div className="max-w-5xl mx-auto grid grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
          {[
            { label: t.stat_registered, value: fmt(registered), live: false },
            { label: t.stat_guests, value: fmt(guests), live: false },
            { label: t.stat_total, value: fmt(total), live: false },
            { label: t.stat_online, value: fmt(online), live: true },
          ].map((s, i) => (
            <div
              key={i}
              data-reveal
              style={{ "--d": `${i * 90}ms` } as React.CSSProperties}
              className="relative rounded-2xl border border-white/10 bg-slate-900/40 backdrop-blur-sm p-6 md:p-8 text-center overflow-hidden"
            >
              <div
                className="absolute -top-10 left-1/2 -translate-x-1/2 w-32 h-32 rounded-full blur-3xl opacity-20 accent-shift"
                style={{ backgroundColor: CYAN }}
              />
              <div className="relative">
                {s.live && (
                  <span className="inline-flex items-center gap-1.5 mb-2 text-[10px] font-semibold tracking-wider text-emerald-400 uppercase">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    LIVE
                  </span>
                )}
                <div
                  className="text-3xl md:text-5xl font-extrabold tabular-nums"
                  style={{ color: s.live ? "#34d399" : "#fff" }}
                >
                  {s.value}
                </div>
                <div className="mt-2 text-xs md:text-sm text-slate-400">{s.label}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Features grid */}
      <section className="relative z-10 px-6 py-16 md:py-24">
        <div className="max-w-3xl mx-auto text-center mb-14">
          <span
            className="text-xs font-bold tracking-[0.2em] uppercase block mb-3 accent-shift"
            style={{ color: CYAN }}
            data-reveal
          >
            {t.feat_kicker}
          </span>
          <h2
            className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight mb-4"
            data-reveal="words"
          >
            {t.feat_title.split(" ").map((w, i, arr) => (
              <span
                key={i}
                className="word"
                style={{ "--wd": `${i * 60}ms` } as React.CSSProperties}
              >
                {w}
                {i < arr.length - 1 ? "\u00A0" : ""}
              </span>
            ))}
          </h2>
          <p className="text-slate-400 text-lg leading-relaxed" data-reveal style={{ "--d": "120ms" } as React.CSSProperties}>
            {t.feat_sub}
          </p>
        </div>
        <div className="max-w-6xl mx-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {t.features.map((f, i) => (
            <div
              key={i}
              data-reveal
              style={{ "--d": `${(i % 3) * 80}ms` } as React.CSSProperties}
              className="group rounded-2xl border border-white/10 bg-slate-900/30 p-6 transition-all duration-200 hover:border-[oklch(0.78_0.18_195)]/40 hover:bg-slate-900/60 hover:-translate-y-1"
            >
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center mb-4 font-bold text-slate-950 text-sm accent-shift"
                style={{ backgroundColor: CYAN }}
              >
                {String(i + 1).padStart(2, "0")}
              </div>
              <h3 className="text-lg font-bold text-white mb-2">{f.t}</h3>
              <p className="text-sm text-slate-400 leading-relaxed">{f.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Screenshot showcase */}
      <section className="relative z-10 px-6 py-16 md:py-24">
        <div className="max-w-3xl mx-auto text-center mb-16">
          <h2
            className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight"
            data-reveal="words"
          >
            {t.shots_title.split(" ").map((w, i, arr) => (
              <span
                key={i}
                className="word"
                style={{ "--wd": `${i * 55}ms` } as React.CSSProperties}
              >
                {w}
                {i < arr.length - 1 ? "\u00A0" : ""}
              </span>
            ))}
          </h2>
        </div>

        <div className="max-w-6xl mx-auto space-y-20 lg:space-y-28">
          {[
            { img: IMG.dialer, title: t.shot_dialer_t, desc: t.shot_dialer_d },
            { img: IMG.chat, title: t.shot_chat_t, desc: t.shot_chat_d },
            { img: IMG.group, title: t.shot_group_t, desc: t.shot_group_d },
          ].map((s, i) => {
            const flip = i % 2 === 1;
            return (
              <div
                key={i}
                className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-14 items-center"
              >
                <div
                  data-reveal={flip ? "right" : "left"}
                  className={`lg:col-span-7 ${flip ? "lg:order-last" : ""}`}
                >
                  <div className="relative rounded-2xl overflow-hidden border border-white/10 shot-img">
                    <div
                      className="absolute -inset-8 blur-3xl opacity-20 -z-10 accent-shift"
                      style={{ backgroundColor: CYAN }}
                    />
                    <img
                      src={s.img}
                      alt={s.title}
                      loading="lazy"
                      className="w-full h-auto block"
                    />
                  </div>
                </div>
                <div
                  className="lg:col-span-5"
                  data-reveal={flip ? "left" : "right"}
                  style={{ "--d": "120ms" } as React.CSSProperties}
                >
                  <h3 className="text-2xl sm:text-3xl font-extrabold text-white mb-4">
                    {s.title}
                  </h3>
                  <p className="text-slate-300 text-base sm:text-lg leading-relaxed">
                    {s.desc}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Mobile */}
      <section className="relative z-10 px-6 py-16 md:py-24">
        <div className="max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          <div
            className={isAr ? "lg:order-last" : ""}
            data-reveal={isAr ? "right" : "left"}
          >
            <h2 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight mb-5">
              {t.mobile_t}
            </h2>
            <p className="text-slate-300 text-lg leading-relaxed">{t.mobile_d}</p>
            <a
              href="/app"
              className="mt-8 inline-flex items-center justify-center px-6 py-3 rounded-full text-sm font-bold text-slate-950 transition-all active:scale-[0.97] accent-shift"
              style={{ backgroundColor: CYAN, boxShadow: "0 0 24px rgba(38,230,255,.3)" }}
            >
              {t.nav_open} {isAr ? "←" : "→"}
            </a>
          </div>
          <div
            className="flex justify-center"
            data-reveal={isAr ? "left" : "right"}
            style={{ "--d": "120ms" } as React.CSSProperties}
          >
            <div className="relative w-full max-w-[300px]">
              <div
                className="absolute -inset-10 blur-3xl opacity-25 -z-10 rounded-full accent-shift"
                style={{ backgroundColor: CYAN }}
              />
              <img
                src={IMG.mobile}
                alt={t.mobile_t}
                loading="lazy"
                className="w-full h-auto block drop-shadow-2xl"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="relative z-10 px-6 py-20 md:py-28">
        <div className="max-w-3xl mx-auto text-center relative" data-reveal>
          <div
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] rounded-full blur-[100px] opacity-15 animate-pulse-glow pointer-events-none accent-shift"
            style={{ backgroundColor: CYAN }}
          />
          <h2
            className="relative text-3xl sm:text-5xl font-extrabold text-white tracking-tight mb-5"
            data-reveal="words"
          >
            {t.cta_title.split(" ").map((w, i, arr) => (
              <span
                key={i}
                className="word"
                style={{ "--wd": `${i * 50}ms` } as React.CSSProperties}
              >
                {w}
                {i < arr.length - 1 ? "\u00A0" : ""}
              </span>
            ))}
          </h2>
          <p className="relative text-slate-300 text-lg mb-9">{t.cta_sub}</p>
          <a
            href="/app"
            className="relative inline-flex items-center justify-center px-9 py-4 rounded-full text-base font-bold text-slate-950 transition-all active:scale-[0.97] accent-shift"
            style={{ backgroundColor: CYAN, boxShadow: "0 0 36px rgba(38,230,255,.4)" }}
          >
            {t.cta_btn} {isAr ? "←" : "→"}
          </a>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 border-t border-white/10 px-6 py-10">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4 text-center md:text-start">
          <div className="flex items-center gap-3">
            <span
              className="w-2.5 h-2.5 rounded-full accent-shift"
              style={{ backgroundColor: CYAN, boxShadow: `0 0 10px ${CYAN}` }}
            />
            <div>
              <div className="font-semibold tracking-wider text-white text-sm">RELAY</div>
              <div className="text-xs text-slate-500">{t.footer_tag}</div>
            </div>
          </div>
          <div className="text-xs text-slate-500 flex flex-col md:items-end gap-1">
            <span>
              © {new Date().getFullYear()} RELAY · {t.footer_rights}
            </span>
            <span className="flex items-center gap-2">
              <span>v{APP_VERSION}</span>
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
