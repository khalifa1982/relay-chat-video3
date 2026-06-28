import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { APP_VERSION } from "@shared/version";

/* -------------------------------------------------------------------------- */
/*  Bilingual landing page (AR / EN).                                          */
/*  Language is a local UI preference only; it does NOT touch the in-app       */
/*  experience. Arabic flips the document to RTL.                              */
/* -------------------------------------------------------------------------- */

type Lang = "en" | "ar";

/* Gemini-generated UI mockups + hero (asset URLs tied to project lifecycle). */
const IMG = {
  heroBg:
    "https://d2xsxph8kpxj0f.cloudfront.net/86205309/LDUyWQ6Lzxde96UDvwdvU2/relay-hero-bg-m43wUbmhFJxmSvgbRcZFv8.webp",
  dialer:
    "https://d2xsxph8kpxj0f.cloudfront.net/86205309/LDUyWQ6Lzxde96UDvwdvU2/relay-mock-dialer-gcoPfnkvde3dFVut46iKCy.webp",
  chat:
    "https://d2xsxph8kpxj0f.cloudfront.net/86205309/LDUyWQ6Lzxde96UDvwdvU2/relay-mock-chat-hGJhpsCBXS5cLUw4HGe3bL.webp",
  group:
    "https://d2xsxph8kpxj0f.cloudfront.net/86205309/LDUyWQ6Lzxde96UDvwdvU2/relay-mock-group-2cGZZ9qxsVwAymc3Kyuu8j.webp",
  mobile:
    "https://d2xsxph8kpxj0f.cloudfront.net/86205309/LDUyWQ6Lzxde96UDvwdvU2/relay-mock-mobile-5LCbQpS65QerasETd6Hr8w.webp",
};

const T = {
  en: {
    dir: "ltr" as const,
    nav_open: "Open the app",
    hero_kicker: "BROWSER VOICE · VIDEO · CHAT",
    hero_title_1: "Call anyone, right in",
    hero_title_2: "the tab you work in",
    hero_sub:
      "Pick a name, get a 6-digit number, and start voice, video, group calls and chat — straight in the browser. No install, no account required.",
    hero_cta: "Open RELAY",
    hero_note: "Free · works on desktop and mobile · nothing to download.",
    stats_title: "Live on RELAY right now",
    stats_sub: "Real numbers, pulled live from the network.",
    stat_registered: "Registered users",
    stat_guests: "Guests served",
    stat_total: "Total identities",
    stat_online: "Online now",
    feat_kicker: "WHAT'S NEW",
    feat_title: "Everything you need to stay connected",
    feat_sub:
      "RELAY has grown into a full communication suite — calls, conferences, messaging and host controls, all in the browser.",
    features: [
      {
        t: "6-digit instant identity",
        d: "Open RELAY and get a personal 6-digit number in seconds. Share it, and anyone can call you — no sign-up needed.",
      },
      {
        t: "Voice & video calls",
        d: "Crystal-clear 1:1 voice and video powered by WebRTC, with multi-device ringing so you never miss a call.",
      },
      {
        t: "Group conferences",
        d: "Create a group call, share an invite link, and bring everyone together with active-speaker spotlight and grid layouts.",
      },
      {
        t: "Host controls",
        d: "Mute-all, co-host roles, pin & remove participants, and transfer host — keep large calls organised.",
      },
      {
        t: "Rich messaging",
        d: "Send messages, files, images and voice notes with full-screen media, reactions and in-app popups.",
      },
      {
        t: "Screen sharing & PiP",
        d: "Share your screen across browsers and pop the call into Picture-in-Picture while you keep working.",
      },
      {
        t: "Audio routing",
        d: "Pick your output device, route to Bluetooth automatically, and switch the camera or mic mid-call.",
      },
      {
        t: "Call history & redial",
        d: "A full history tab with one-tap redial — including group redial to bring the same people back instantly.",
      },
      {
        t: "Privacy first",
        d: "Guests stay on the device for 30 days. Register to keep your number forever. Call media is peer-to-peer.",
      },
    ],
    shots_title: "See it in action",
    shot_dialer_t: "The dialer",
    shot_dialer_d:
      "Your number glows above the keypad. Dial 6 digits or start a voice, video or group call in one tap.",
    shot_chat_t: "Messages",
    shot_chat_d:
      "A fast, clean messaging console with files, images, voice notes and read state — built right into your session.",
    shot_group_t: "Group video",
    shot_group_d:
      "Active-speaker spotlight, mute indicators, screen share and host controls for calls of every size.",
    mobile_t: "Built for mobile too",
    mobile_d:
      "RELAY works in your phone browser — no app store, no download. Voice, video and chat with the same number, everywhere.",
    cta_title: "Ready to talk?",
    cta_sub: "Open RELAY in your browser and get your number in seconds.",
    cta_btn: "Open RELAY",
    footer_tag: "Browser voice, video & chat. No install, no account.",
    footer_design: "Designed by Gemini",
    footer_rights: "All rights reserved.",
  },
  ar: {
    dir: "rtl" as const,
    nav_open: "افتح التطبيق",
    hero_kicker: "صوت · فيديو · دردشة في المتصفح",
    hero_title_1: "اتصل بأي شخص، مباشرةً",
    hero_title_2: "من نفس التبويب الذي تعمل فيه",
    hero_sub:
      "اختر اسماً، احصل على رقم من ٦ خانات، وابدأ مكالمات صوتية وفيديو وجماعية ودردشة — مباشرةً في المتصفح. بدون تثبيت، وبدون حساب.",
    hero_cta: "افتح RELAY",
    hero_note: "مجاني · يعمل على الكمبيوتر والجوال · لا شيء للتحميل.",
    stats_title: "مباشر على RELAY الآن",
    stats_sub: "أرقام حقيقية، محدّثة مباشرةً من الشبكة.",
    stat_registered: "مستخدمون مسجّلون",
    stat_guests: "ضيوف استخدموا النظام",
    stat_total: "إجمالي الهويات",
    stat_online: "متصل الآن",
    feat_kicker: "الجديد",
    feat_title: "كل ما تحتاجه لتبقى على تواصل",
    feat_sub:
      "تطوّر RELAY إلى منصة تواصل متكاملة — مكالمات ومؤتمرات ورسائل وأدوات تحكم للمضيف، كلها في المتصفح.",
    features: [
      {
        t: "هوية فورية من ٦ خانات",
        d: "افتح RELAY واحصل على رقم شخصي من ٦ خانات خلال ثوانٍ. شاركه ليتمكّن أي شخص من الاتصال بك — دون تسجيل.",
      },
      {
        t: "مكالمات صوت وفيديو",
        d: "صوت وفيديو فردي عالي الوضوح عبر WebRTC، مع رنين متعدد الأجهزة حتى لا تفوتك أي مكالمة.",
      },
      {
        t: "مؤتمرات جماعية",
        d: "أنشئ مكالمة جماعية، شارك رابط الدعوة، واجمع الجميع مع إبراز المتحدث النشط وتخطيطات الشبكة.",
      },
      {
        t: "أدوات تحكم المضيف",
        d: "كتم الجميع، أدوار المضيف المساعد، تثبيت وإزالة المشاركين، ونقل دور المضيف — لتنظيم المكالمات الكبيرة.",
      },
      {
        t: "رسائل غنية",
        d: "أرسل رسائل وملفات وصوراً وملاحظات صوتية مع عرض وسائط بملء الشاشة وتفاعلات ونوافذ منبثقة داخل التطبيق.",
      },
      {
        t: "مشاركة الشاشة و PiP",
        d: "شارك شاشتك عبر المتصفحات وانقل المكالمة إلى وضع صورة-داخل-صورة بينما تواصل عملك.",
      },
      {
        t: "توجيه الصوت",
        d: "اختر جهاز الإخراج، ووجّه الصوت إلى البلوتوث تلقائياً، وبدّل الكاميرا أو الميكروفون أثناء المكالمة.",
      },
      {
        t: "سجل المكالمات وإعادة الاتصال",
        d: "تبويب سجل كامل مع إعادة اتصال بلمسة واحدة — بما في ذلك إعادة الاتصال الجماعي لإعادة الأشخاص أنفسهم فوراً.",
      },
      {
        t: "الخصوصية أولاً",
        d: "يبقى الضيوف على الجهاز لمدة ٣٠ يوماً. سجّل للاحتفاظ برقمك للأبد. وسائط المكالمة بين الأطراف مباشرةً.",
      },
    ],
    shots_title: "شاهده أثناء العمل",
    shot_dialer_t: "لوحة الاتصال",
    shot_dialer_d:
      "يتوهّج رقمك فوق لوحة المفاتيح. اطلب ٦ خانات أو ابدأ مكالمة صوت أو فيديو أو جماعية بلمسة واحدة.",
    shot_chat_t: "الرسائل",
    shot_chat_d:
      "وحدة رسائل سريعة ونظيفة مع ملفات وصور وملاحظات صوتية وحالة القراءة — مدمجة في جلستك مباشرةً.",
    shot_group_t: "فيديو جماعي",
    shot_group_d:
      "إبراز المتحدث النشط، مؤشرات الكتم، مشاركة الشاشة وأدوات تحكم المضيف لمكالمات بكل الأحجام.",
    mobile_t: "مصمّم للجوال أيضاً",
    mobile_d:
      "يعمل RELAY في متصفح هاتفك — بلا متجر تطبيقات وبلا تحميل. صوت وفيديو ودردشة بنفس الرقم، في كل مكان.",
    cta_title: "جاهز للتحدّث؟",
    cta_sub: "افتح RELAY في متصفحك واحصل على رقمك خلال ثوانٍ.",
    cta_btn: "افتح RELAY",
    footer_tag: "صوت وفيديو ودردشة في المتصفح. بدون تثبيت، وبدون حساب.",
    footer_design: "تصميم بواسطة Gemini",
    footer_rights: "جميع الحقوق محفوظة.",
  },
};

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

const CYAN = "oklch(0.78 0.18 195)";

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
      style={{ backgroundColor: "oklch(0.10 0.012 220)" }}
    >
      <style>{`
        @keyframes pulse-glow { 0%,100%{opacity:.15;transform:scale(1)} 50%{opacity:.28;transform:scale(1.05)} }
        .animate-pulse-glow{animation:pulse-glow 8s infinite ease-in-out}
        .grid-bg{background-image:linear-gradient(rgba(255,255,255,.015) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.015) 1px,transparent 1px);background-size:40px 40px}
        @keyframes fade-up { from{opacity:0;transform:translateY(16px)} to{opacity:1;transform:translateY(0)} }
        @media (prefers-reduced-motion: no-preference){
          .fade-up{animation:fade-up .6s cubic-bezier(0.23,1,0.32,1) both}
        }
        .shot-img{box-shadow:0 30px 80px -20px rgba(0,0,0,.85);}
      `}</style>

      <div className="absolute inset-0 grid-bg pointer-events-none z-0" />

      {/* Header */}
      <header className="fixed top-0 inset-x-0 h-20 z-50 flex items-center justify-between px-5 md:px-12 pointer-events-none">
        <div className="flex items-center gap-3 bg-slate-950/50 backdrop-blur-md px-4 py-2 rounded-full border border-white/5 pointer-events-auto shadow-lg">
          <span
            className="w-2.5 h-2.5 rounded-full animate-pulse"
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
            className="hidden sm:inline-flex items-center justify-center px-5 py-2.5 rounded-full text-sm font-semibold text-slate-950 transition-all active:scale-[0.97]"
            style={{ backgroundColor: CYAN, boxShadow: "0 0 20px rgba(38,230,255,.25)" }}
          >
            {t.nav_open}
          </a>
        </div>
      </header>

      {/* Hero */}
      <section className="relative min-h-[92vh] flex flex-col justify-center items-center px-6 text-center pt-28 pb-16 z-10 overflow-hidden">
        <div
          className="absolute inset-0 z-0 opacity-70"
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

        <div className="max-w-4xl mx-auto flex flex-col items-center relative z-10 fade-up">
          <span
            className="text-[11px] md:text-xs font-bold tracking-[0.25em] uppercase mb-6"
            style={{ color: CYAN }}
          >
            {t.hero_kicker}
          </span>
          <h1 className="text-4xl sm:text-6xl md:text-7xl font-extrabold text-white tracking-tight leading-[1.12] mb-7">
            {t.hero_title_1}
            <br className="hidden sm:block" />{" "}
            <span
              className="text-transparent bg-clip-text"
              style={{
                backgroundImage: `linear-gradient(90deg, #fff, ${CYAN}, #fff)`,
              }}
            >
              {t.hero_title_2}
            </span>
          </h1>
          <p className="text-lg md:text-xl text-slate-300 max-w-2xl leading-relaxed mb-10">
            {t.hero_sub}
          </p>
          <div className="flex flex-col items-center gap-4">
            <a
              href="/app"
              className="inline-flex items-center justify-center px-8 py-4 rounded-full text-base font-bold text-slate-950 transition-all active:scale-[0.97]"
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
          <h2 className="text-2xl sm:text-3xl font-extrabold text-white mb-3">{t.stats_title}</h2>
          <p className="text-slate-400">{t.stats_sub}</p>
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
              className="relative rounded-2xl border border-white/10 bg-slate-900/40 backdrop-blur-sm p-6 md:p-8 text-center overflow-hidden"
            >
              <div
                className="absolute -top-10 left-1/2 -translate-x-1/2 w-32 h-32 rounded-full blur-3xl opacity-20"
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
            className="text-xs font-bold tracking-[0.2em] uppercase block mb-3"
            style={{ color: CYAN }}
          >
            {t.feat_kicker}
          </span>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight mb-4">
            {t.feat_title}
          </h2>
          <p className="text-slate-400 text-lg leading-relaxed">{t.feat_sub}</p>
        </div>
        <div className="max-w-6xl mx-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {t.features.map((f, i) => (
            <div
              key={i}
              className="group rounded-2xl border border-white/10 bg-slate-900/30 p-6 transition-all duration-200 hover:border-[oklch(0.78_0.18_195)]/40 hover:bg-slate-900/60"
            >
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center mb-4 font-bold text-slate-950 text-sm"
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
          <h2 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
            {t.shots_title}
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
                  className={`lg:col-span-7 ${flip ? "lg:order-last" : ""}`}
                >
                  <div className="relative rounded-2xl overflow-hidden border border-white/10 shot-img">
                    <div
                      className="absolute -inset-8 blur-3xl opacity-20 -z-10"
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
                <div className="lg:col-span-5">
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
          <div className={isAr ? "lg:order-last" : ""}>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight mb-5">
              {t.mobile_t}
            </h2>
            <p className="text-slate-300 text-lg leading-relaxed">{t.mobile_d}</p>
            <a
              href="/app"
              className="mt-8 inline-flex items-center justify-center px-6 py-3 rounded-full text-sm font-bold text-slate-950 transition-all active:scale-[0.97]"
              style={{ backgroundColor: CYAN, boxShadow: "0 0 24px rgba(38,230,255,.3)" }}
            >
              {t.nav_open} {isAr ? "←" : "→"}
            </a>
          </div>
          <div className="flex justify-center">
            <div className="relative w-full max-w-[300px]">
              <div
                className="absolute -inset-10 blur-3xl opacity-25 -z-10 rounded-full"
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
        <div className="max-w-3xl mx-auto text-center relative">
          <div
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] rounded-full blur-[100px] opacity-15 animate-pulse-glow pointer-events-none"
            style={{ backgroundColor: CYAN }}
          />
          <h2 className="relative text-3xl sm:text-5xl font-extrabold text-white tracking-tight mb-5">
            {t.cta_title}
          </h2>
          <p className="relative text-slate-300 text-lg mb-9">{t.cta_sub}</p>
          <a
            href="/app"
            className="relative inline-flex items-center justify-center px-9 py-4 rounded-full text-base font-bold text-slate-950 transition-all active:scale-[0.97]"
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
              className="w-2.5 h-2.5 rounded-full"
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
              <span className="opacity-40">·</span>
              <span>{t.footer_design}</span>
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
