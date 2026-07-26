import { useEffect, useMemo, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useLiveStats } from "@/app/useLiveStats";
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

/* Inline "launch" arrow for the Open-App pills. A bare "↗" (U+2197) used to
   live inside the copy strings, but the v2.99.16 RTL rule forces
   'Noto Kufi Arabic' on every element in Arabic — that face has no U+2197, so
   iOS fell through to the emoji font and drew a boxed ↗️ beside the Arabic
   label instead of a clean arrow (owner screenshot). An inline SVG renders
   identically in every language, font and platform. Mirrored in RTL (below,
   `.lp-arrow`) so it still points "outward" when text flows right-to-left. */
const ARROW_NE = `<svg class="lp-arrow" viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex:none"><path d="M7 17 17 7"/><path d="M8 7h9v9"/></svg>`;

/* Backspace / erase-one-digit glyph for the hero dialer (owner ask). NOT
   mirrored in RTL: the dial display is a dir="ltr" island in both languages,
   so digits always fill left→right and the erase always takes the rightmost
   one — a left-pointing backspace stays the correct affordance. */
const ARROW_BS = `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 5H9l-7 7 7 7h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Z"/><path d="M18 9l-6 6"/><path d="M12 9l6 6"/></svg>`;

/** Sentinel for the keypad cell that erases instead of entering a digit. */
const BS_KEY = "bs";

const KEYS: Array<[string, string]> = [
  ["1", ""], ["2", "ABC"], ["3", "DEF"], ["4", "GHI"], ["5", "JKL"], ["6", "MNO"],
  // The erase key takes the bottom-right cell (owner ask). It replaces "#",
  // which was pure decoration here — this pad only ever accepts 0-9 for a
  // 6-digit RELAY number, so "#" did nothing but play a tone. Putting erase
  // IN the grid gives it a full 54px touch target and, unlike a button beside
  // the number display, it can never overlap the digits (it did exactly that
  // in Arabic, where the RTL-mirrored button landed on top of the first digit).
  ["7", "PQRS"], ["8", "TUV"], ["9", "WXYZ"], ["*", ""], ["0", "+"], [BS_KEY, ""],
];

/* ── bilingual copy (owner ask: bring Arabic back to the new design). RELAY
   and pure-technical mono chrome (DTLS-SRTP, key caps) stay Latin; all
   user-facing copy translates. AR renders the page dir="rtl" with LTR islands
   for numbers/keypads. Choice persists in localStorage("relay_lang"). ── */
export type Lang = "en" | "ar";
const COPY = {
  en: {
    langBtn: "عربي",
    navHow: "HOW IT WORKS", navFeatures: "FEATURES", navPrivacy: "PRIVACY", navFaq: "FAQ",
    openApp: "OPEN APP",
    erase: "Erase last digit",
    loaderTagline: "the same encryption standard that armors bank traffic — applied to your voice",
    heroBadge: "LIVE — PEER-TO-PEER CALLS IN YOUR BROWSER",
    h1a: "Pick a name.", h1b: "Get a number.", h1c: "Dial anyone.",
    heroP: "RELAY is free voice, video and chat that runs entirely in your browser. No installs. No accounts. No servers in the middle of your call.",
    ctaLaunch: "Launch RELAY →", ctaHow: "How it works",
    worksIn: "WORKS IN CHROME · SAFARI · FIREFOX · EDGE",
    dialerTitle: "RELAY DIALER", dialerOnline: "ONLINE",
    dialEnter: "ENTER ANY 6-DIGIT NUMBER", dialMore: (n: number) => `${n} MORE DIGIT${n > 1 ? "S" : ""}`,
    dialReady: "LINE READY — PRESS CALL", call: "CALL", clear: "CLEAR", demo: "DIAL A DEMO NUMBER",
    dialChecking: "CHECKING NUMBER…", dialOnline: "ONLINE — READY TO CALL",
    dialOffline: "OFFLINE — YOU CAN'T CALL THEM RIGHT NOW", dialNotFound: "NO RELAY USER WITH THIS NUMBER",
    dialJoin: "JOIN CALL", dialParty: (n: number) => `PARTY LINE · ${n} ON THE LINE`,
    marquee: "PEER-TO-PEER ✦ NO ACCOUNTS ✦ NO INSTALLS ✦ FREE FOREVER ✦ ENCRYPTED IN TRANSIT ✦ BROWSER-NATIVE ✦ 6-DIGIT NUMBERS ✦ PEER-TO-PEER ✦ NO ACCOUNTS ✦ NO INSTALLS ✦ FREE FOREVER ✦",
    statsEyebrow: "LIVE NETWORK — REAL NUMBERS",
    statUsers: "REGISTERED USERS", statGuests: "GUESTS SERVED", statParties: "CALL PARTIES", statMessages: "MESSAGES SENT", statOnline: "ONLINE NOW",
    howEyebrow: "01 — HOW IT WORKS", howH2: "On a call in less time than a signup form.",
    step1T: "Pick a name", step1B: "No signup, no email, no password. Type whatever you want to be called today and you're on the network.",
    step2T: "Get your number", step2B: "You're handed a 6-digit RELAY number instantly — short enough to read out loud, easy enough to remember.",
    step3T: "Dial anyone", step3B: "Punch in a friend's number for voice, video or chat — straight from the browser, on any device.",
    featEyebrow: "02 — FEATURES", featH2: "Everything a call needs. Nothing it doesn't.",
    f1T: "Voice calls", f1B: "Low-latency audio that streams browser-to-browser — from your mic to their speakers, nothing in between.",
    f2T: "Video calls", f2B: "Face-to-face in one click. Crisp video that stays strictly between the people on the call.",
    f3T: "Text chat", f3B: "A channel that runs alongside the call — paste links, drop notes, keep talking.",
    f4T: "No installs", f4B: "If it runs a browser, it runs RELAY. Desktop, laptop, phone, tablet.",
    f5T: "No accounts", f5B: "A display name is the only identity you need. Leave whenever you like.",
    f6T: "Free forever", f6B: "No plans, no meters, no premium tier. Calling is free, full stop.",
    liveFrom: "LIVE FROM THE APP",
    privEyebrow: "03 — PRIVACY", privH2: "Your call is nobody's business.",
    privP1: "RELAY is peer-to-peer. Voice and video stream directly between browsers over WebRTC, encrypted in transit with DTLS-SRTP.",
    privP2: "Our server does one job: introductions. It helps two browsers find each other, then steps out of the way. Your media never passes through it.",
    privL1: "NO CALL RECORDING, EVER", privL2: "NO ACCOUNT DATABASE", privL3: "NOTHING STORED, NOTHING TO BREACH",
    faqEyebrow: "04 — FAQ", faqH2: "Quick answers.",
    q1: "Is RELAY really free?", a1: "Yes. Calls run peer-to-peer between browsers, so there's no expensive media infrastructure to pay for — and no reason to charge you.",
    q2: "Do I need an account?", a2: "No. Pick a display name when you arrive and you're on the network. No email, no password, no verification.",
    q3: "How do the 6-digit numbers work?", a3: "Every visitor gets a short RELAY number. Read it out, text it, write it on a napkin — anyone who dials it from their browser reaches you directly.",
    q4: "Does it work on my phone?", a4: "Yes — RELAY runs in any modern browser: Chrome, Safari, Firefox and Edge, on desktop or mobile. Nothing to install.",
    q5: "Who can see or hear my calls?", a5: "Just the people on them. Media streams directly between browsers, encrypted in transit. RELAY's server only handles the handshake — it never touches your audio or video.",
    q6: "How do I reach support?", a6: (email: string) => `Email us any time at ${email}. Your message lands directly inside RELAY for the team, and we reply from there.`,
    ctaNumber: "Get your number →", ctaFine: "FREE · NO SIGNUP · ~10 SECONDS",
    footTag: "PEER-TO-PEER. BROWSER-NATIVE. FREE.", footPolicy: "POLICY", footTop: "TOP ↑",
    bootMsgs: [
      [0, "WAKING THE NETWORK…", "Spinning up a direct line between your browsers…"],
      [0.22, "RESOLVING PEERS…", "Finding the shortest path — no relay servers in the middle."],
      [0.45, "EXCHANGING KEYS…", "Both devices invent a secret code that only they two know."],
      [0.72, "LINE ENCRYPTED", "Every packet of voice & video is scrambled with that secret."],
      [0.97, "CONNECTED", "Locked end-to-end. Nobody can listen in — not even RELAY."],
    ] as Array<[number, string, string]>,
    callMsgs: (fmt: string) => [
      [0, `DIALING ${fmt}…`, `Reaching ${fmt} directly — browser to browser.`],
      [0.3, "RINGING…", "No phone network involved. Just the open web."],
      [0.55, "EXCHANGING KEYS…", "Your devices invent a secret code that only they two know."],
      [0.78, "LINE ENCRYPTED", "From here on, every word is scrambled end-to-end."],
      [0.97, "CONNECTING…", "Locked. Nobody can listen in — not even RELAY."],
    ] as Array<[number, string, string]>,
  },
  ar: {
    langBtn: "EN",
    navHow: "كيف يعمل", navFeatures: "المزايا", navPrivacy: "الخصوصية", navFaq: "الأسئلة",
    openApp: "افتح التطبيق",
    erase: "حذف آخر رقم",
    loaderTagline: "نفس معيار التشفير الذي يحمي معاملات البنوك — مطبَّق على صوتك",
    heroBadge: "مباشر — مكالمات ند-لِند داخل متصفحك",
    h1a: "اختر اسمًا.", h1b: "احصل على رقم.", h1c: "اتصل بأي شخص.",
    heroP: "RELAY مكالمات صوت وفيديو ودردشة مجانية تعمل بالكامل داخل متصفحك. بلا تثبيت. بلا حسابات. ولا خوادم تتوسط مكالمتك.",
    ctaLaunch: "شغِّل RELAY ←", ctaHow: "كيف يعمل",
    worksIn: "يعمل على كروم · سفاري · فايرفوكس · إيدج",
    dialerTitle: "لوحة اتصال RELAY", dialerOnline: "متصل",
    dialEnter: "أدخل أي رقم من 6 خانات", dialMore: (n: number) => `تبقّى ${n} ${n > 1 ? "خانات" : "خانة"}`,
    dialReady: "الخط جاهز — اضغط اتصال", call: "اتصال", clear: "مسح", demo: "جرِّب رقمًا تجريبيًا",
    dialChecking: "جارٍ التحقق من الرقم…", dialOnline: "متصل — جاهز للاتصال",
    dialOffline: "غير متصل — لا يمكنك الاتصال به الآن", dialNotFound: "لا يوجد مستخدم RELAY بهذا الرقم",
    dialJoin: "الانضمام للمكالمة", dialParty: (n: number) => `خط جماعي · ${n} على الخط`,
    marquee: "ند-لِند ✦ بلا حسابات ✦ بلا تثبيت ✦ مجاني للأبد ✦ مشفَّر أثناء النقل ✦ داخل المتصفح ✦ أرقام من 6 خانات ✦ ند-لِند ✦ بلا حسابات ✦ بلا تثبيت ✦ مجاني للأبد ✦",
    statsEyebrow: "الشبكة الآن — أرقام حقيقية",
    statUsers: "مستخدمون مسجّلون", statGuests: "ضيوف تمّت خدمتهم", statParties: "أطراف المكالمات", statMessages: "رسائل مُرسلة", statOnline: "متصلون الآن",
    howEyebrow: "01 — كيف يعمل", howH2: "تدخل مكالمة في وقت أقل من تعبئة نموذج تسجيل.",
    step1T: "اختر اسمًا", step1B: "لا تسجيل، لا بريد إلكتروني، لا كلمة مرور. اكتب أي اسم يعجبك اليوم وستكون على الشبكة.",
    step2T: "احصل على رقمك", step2B: "تحصل فورًا على رقم RELAY من 6 خانات — قصير يُقرأ بصوت عالٍ ويسهل حفظه.",
    step3T: "اتصل بأي شخص", step3B: "اطلب رقم صديقك صوتًا أو فيديو أو دردشة — مباشرة من المتصفح وعلى أي جهاز.",
    featEyebrow: "02 — المزايا", featH2: "كل ما تحتاجه المكالمة. ولا شيء زائد.",
    f1T: "مكالمات صوتية", f1B: "صوت بزمن استجابة منخفض يتدفق من متصفح إلى متصفح — من مايكروفونك إلى سماعاتهم، لا شيء بينهما.",
    f2T: "مكالمات فيديو", f2B: "وجهًا لوجه بنقرة واحدة. فيديو نقي يبقى حصريًا بين أطراف المكالمة.",
    f3T: "دردشة نصية", f3B: "قناة تعمل بموازاة المكالمة — الصق روابط، دوّن ملاحظات، وواصل الحديث.",
    f4T: "بلا تثبيت", f4B: "إن كان جهازك يشغّل متصفحًا فهو يشغّل RELAY. حاسوب، لابتوب، هاتف، لوحي.",
    f5T: "بلا حسابات", f5B: "اسم العرض هو كل الهوية التي تحتاجها. وغادر متى شئت.",
    f6T: "مجاني للأبد", f6B: "لا باقات ولا عدّادات ولا فئة مدفوعة. الاتصال مجاني، نقطة.",
    liveFrom: "مباشرة من التطبيق",
    privEyebrow: "03 — الخصوصية", privH2: "مكالمتك لا تخص أحدًا سواك.",
    privP1: "RELAY يعمل ند-لِند: الصوت والفيديو يتدفقان مباشرة بين المتصفحات عبر WebRTC، مشفَّرين أثناء النقل بمعيار DTLS-SRTP.",
    privP2: "خادمنا يقوم بمهمة واحدة: التعارف. يساعد المتصفحين على إيجاد بعضهما ثم يتنحّى جانبًا. وسائطك لا تمر عبره أبدًا.",
    privL1: "لا تسجيل للمكالمات، أبدًا", privL2: "لا قاعدة بيانات حسابات", privL3: "لا شيء يُخزَّن، لا شيء يُخترق",
    faqEyebrow: "04 — الأسئلة الشائعة", faqH2: "إجابات سريعة.",
    q1: "هل RELAY مجاني فعلًا؟", a1: "نعم. المكالمات تعمل ند-لِند بين المتصفحات، فلا بنية وسائط مكلفة ندفع ثمنها — ولا سبب لنحاسبك.",
    q2: "هل أحتاج إلى حساب؟", a2: "لا. اختر اسم عرض عند وصولك وستكون على الشبكة. لا بريد ولا كلمة مرور ولا تحقق.",
    q3: "كيف تعمل الأرقام ذات 6 خانات؟", a3: "كل زائر يحصل على رقم RELAY قصير. اقرأه بصوت عالٍ أو أرسله برسالة — وكل من يطلبه من متصفحه يصل إليك مباشرة.",
    q4: "هل يعمل على هاتفي؟", a4: "نعم — RELAY يعمل على أي متصفح حديث: كروم وسفاري وفايرفوكس وإيدج، على الحاسوب أو الجوال. لا شيء يُثبَّت.",
    q5: "من يستطيع رؤية أو سماع مكالماتي؟", a5: "أطراف المكالمة فقط. الوسائط تتدفق مباشرة بين المتصفحات مشفَّرة أثناء النقل. خادم RELAY يتولى المصافحة فقط — ولا يلمس صوتك أو فيديوك أبدًا.",
    q6: "كيف أتواصل مع الدعم؟", a6: (email: string) => `راسلنا في أي وقت على ${email}. تصل رسالتك مباشرة إلى فريقنا داخل RELAY ونرد عليك من هناك.`,
    ctaNumber: "احصل على رقمك ←", ctaFine: "مجاني · بلا تسجيل · ~10 ثوانٍ",
    footTag: "ند-لِند. داخل المتصفح. مجاني.", footPolicy: "سياسة الخصوصية", footTop: "الأعلى ↑",
    bootMsgs: [
      [0, "إيقاظ الشبكة…", "نفتح خطًا مباشرًا بين المتصفحات…"],
      [0.22, "تحديد الأطراف…", "نبحث عن أقصر مسار — بلا خوادم وسيطة."],
      [0.45, "تبادل المفاتيح…", "جهازاكما يبتكران سرًا لا يعرفه سواهما."],
      [0.72, "الخط مُشفَّر", "كل حزمة صوت وفيديو تُبعثر بذلك السر."],
      [0.97, "تم الاتصال", "مقفل طرف-لِطرف. لا أحد يستطيع التنصّت — ولا حتى RELAY."],
    ] as Array<[number, string, string]>,
    callMsgs: (fmt: string) => [
      [0, `جارٍ طلب ${fmt}…`, `نصل إلى ${fmt} مباشرة — متصفح إلى متصفح.`],
      [0.3, "يرن…", "بلا شبكة هاتف. فقط الويب المفتوح."],
      [0.55, "تبادل المفاتيح…", "جهازاكما يبتكران سرًا لا يعرفه سواهما."],
      [0.78, "الخط مُشفَّر", "من هنا فصاعدًا كل كلمة مبعثرة طرف-لِطرف."],
      [0.97, "جارٍ الاتصال…", "مقفل. لا أحد يستطيع التنصّت — ولا حتى RELAY."],
    ] as Array<[number, string, string]>,
  },
};
type Copy = (typeof COPY)["en"];

function initialLang(): Lang {
  // ENGLISH is the default for every first-time visitor (owner directive,
  // 2026-07-22) — the page no longer auto-picks Arabic from the device
  // locale; Arabic is one tap away on the ع toggle and the choice persists.
  try {
    const saved = localStorage.getItem("relay_lang");
    if (saved === "ar" || saved === "en") return saved;
    return "en";
  } catch {
    return "en";
  }
}

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
/* Active-speaker sweep (v2.99.16): a green ring lights each tile in turn so the
   grid reads as a LIVE moving call, not fixed photos. Each tile's ring runs the
   same 20s loop at a staggered -2s delay, so the highlight rotates around the
   10-up. Reduced-motion kills it via the global .lp-root * rule below. */
@keyframes lpActive{0%,13%,100%{opacity:0}3%,10%{opacity:.95}}
/* A "talking" pulse for the active window (v2.99.69): a scale lift PLUS a small
   nod, because a pure scale reads as a zoom and a nod reads as a person. Still
   transform-only, so it composes on the compositor with no paint. */
@keyframes lpTalk{0%,13%,100%{transform:scale(1) translateY(0)}4%{transform:scale(1.014) translateY(-.7px)}7%{transform:scale(1.018) translateY(.5px)}10%{transform:scale(1.012) translateY(-.3px)}}
/* THE ONE THAT MAKES A STILL READ AS A LIVE FEED (v2.99.69). A real video tile is
   never perfectly still — there is always sub-pixel drift and the odd hitch from
   the encoder. Photos have none of that, which is why the grid read as "fixed
   images" no matter how much the surrounding chrome moved. Deliberately tiny and
   deliberately NON-periodic-looking (uneven keyframe spacing, prime-ish timings at
   the call site) so the eye cannot latch onto a loop. Transform-only. */
@keyframes lpLive{0%{transform:translate3d(0,0,0)}17%{transform:translate3d(.35px,-.3px,0)}31%{transform:translate3d(-.25px,.4px,0)}44%{transform:translate3d(.4px,.25px,0)}58%{transform:translate3d(-.35px,-.35px,0)}73%{transform:translate3d(.2px,.45px,0)}88%{transform:translate3d(-.4px,-.2px,0)}100%{transform:translate3d(0,0,0)}}
/* Voice-shaped level bars (v2.99.69). The old shared lpEq was a smooth 1.1s
   sine on every bar, which reads as a loading spinner, not a voice. Speech is
   bursty and the bars must disagree with each other, so each has its own uneven
   envelope and the call site gives them non-harmonic durations that will not visibly
   re-align. scaleY only — no height/paint. */
@keyframes lpVox1{0%,100%{transform:scaleY(.22)}12%{transform:scaleY(.9)}23%{transform:scaleY(.35)}39%{transform:scaleY(1)}52%{transform:scaleY(.28)}66%{transform:scaleY(.78)}81%{transform:scaleY(.4)}}
@keyframes lpVox2{0%,100%{transform:scaleY(.5)}9%{transform:scaleY(.25)}27%{transform:scaleY(1)}41%{transform:scaleY(.42)}55%{transform:scaleY(.85)}70%{transform:scaleY(.2)}88%{transform:scaleY(.7)}}
@keyframes lpVox3{0%,100%{transform:scaleY(.35)}15%{transform:scaleY(.62)}30%{transform:scaleY(.24)}47%{transform:scaleY(.95)}61%{transform:scaleY(.5)}77%{transform:scaleY(.3)}92%{transform:scaleY(.82)}}
/* The speaking ENVELOPE, on the same 20s/-2s schedule as the ring, so the meter
   and the highlight belong to the same person. Before v2.99.69 four tiles had
   hardcoded speaking times on a different stagger from the ring sweep, so the ring
   lit one face while another face's bars bounced — nothing correlated, and the whole
   effect read as decoration rather than as somebody talking. Opacity only. */
@keyframes lpVoxOn{0%,14%,100%{opacity:0}3%,11%{opacity:1}}
/* ZERO-JS loader failsafes (v2.95.9). The engine's FIRST action is adding
   .lp-js-ok to the overlay, which disarms this CSS watchdog (the JS watchdogs
   take over). If the engine never runs or dies before that, pure CSS fades the
   overlay out at ~5.6s and drops it from hit-testing — a frozen loading screen
   is impossible even with zero working JavaScript. */
@keyframes lpAutoClear{to{opacity:0;visibility:hidden;pointer-events:none}}
[data-lp="loader"]:not(.lp-js-ok){animation:lpAutoClear .5s ease 5.6s forwards}
/* The progress TRACK carries a CSS-only light sweep, so the loader visibly
   MOVES even if the JS width/percent updates stall. */
@keyframes lpShimmer{from{transform:translateX(-120%)}to{transform:translateX(520%)}}
[data-lp="loadTrack"]{position:relative}
[data-lp="loadTrack"]::after{content:"";position:absolute;top:0;bottom:0;left:0;width:22%;border-radius:3px;background:linear-gradient(90deg,transparent,rgba(111,242,174,.55),transparent);animation:lpShimmer 1.3s linear infinite}
/* v2.98.1: the FILL is compositor-driven (transform:scaleX, full-width bar).
   The old JS width writes rode requestAnimationFrame, which paints NOTHING on
   a device whose main thread is saturated during boot — the bar sat visibly
   at 0% until the watchdog cleared the overlay (owner report, 3rd round).
   Transform animations keep running on the compositor while the main thread
   is blocked, so the bar now fills no matter what. The default 3.4s run also
   starts with ZERO JS (plain CSS at insertion); runLoader only re-times it. */
@keyframes lpFill{from{transform:scaleX(0)}to{transform:scaleX(1)}}
[data-lp="loadBar"]{transform-origin:left;transform:scaleX(0);animation:lpFill 3.4s cubic-bezier(.25,.46,.45,.94) forwards}
[dir="rtl"] [data-lp="loadBar"]{transform-origin:right}
/* v2.98.2: the percent COUNTER is compositor-driven too (owner: the number
   under the bar stayed at 0% while the bar filled) — an odometer strip of
   0%–100% lines swept by transform:translateY with the SAME duration/easing
   as the bar, so bar and counter move together even on a saturated main
   thread. -100% + 14px = stop exactly on the last (100%) 14px line. */
@keyframes lpPct{from{transform:translateY(0)}to{transform:translateY(calc(-100% + 14px))}}
[data-lp="pctStrip"]{animation:lpPct 3.4s cubic-bezier(.25,.46,.45,.94) forwards}
@media (max-width:760px){
  /* !important is REQUIRED against the markup's inline styles: the plain
     .lp-navlinks{display:none} silently lost to the inline display:flex, so
     phones kept the desktop nav links — they wrapped to three lines and shoved
     the ع/EN language toggle and the Open-App pill off the right edge of the
     screen (owner: "switching the language is not working"). */
  .lp-navlinks{display:none!important}
  [data-lp="nav"]{padding:12px 14px!important;gap:12px!important}
  .lp-logo span:last-child{font-size:15px!important;letter-spacing:.16em!important}
  [data-lp="langBtn"]{padding:8px 10px!important}
  .lp-dock{padding:9px 13px!important;letter-spacing:.1em!important}
  .lp-hero{padding:120px 22px 70px!important}
  .lp-section{padding-left:22px!important;padding-right:22px!important}
}
@media (prefers-reduced-motion: reduce){
  .lp-root *{animation:none!important}
  /* ...except the zero-JS overlay watchdog: killing it would strand a
     reduced-motion visitor behind the loader if the engine never runs. */
  [data-lp="loader"]:not(.lp-js-ok){animation:lpAutoClear .5s ease 5.6s forwards!important}
}
/* Arabic parity (v2.99.16, owner: "the Arabic version renders smaller than
   English"). ROOT CAUSE: every element hardcodes a LATIN face ('Space Grotesk'
   / 'IBM Plex Mono') inside its inline font shorthand, so Arabic glyphs fell
   back to a smaller system Arabic face — the whole RTL layout looked shrunken.
   FIX: load a real Arabic webfont (Noto Kufi Arabic, in FONTS_HREF) and force it
   for RTL text. Inline font shorthands are NOT !important, so a stylesheet
   font-family !important overrides ONLY the family (sizes/weights untouched).
   The dialer/keypad/percent LTR islands (dir=ltr) stay monospace — that later,
   higher-specificity rule wins for them. */
.lp-root[dir="rtl"] *{font-family:'Noto Kufi Arabic','Space Grotesk',sans-serif!important}
.lp-root[dir="rtl"] [dir="ltr"],.lp-root[dir="rtl"] [dir="ltr"] *{font-family:'IBM Plex Mono','Noto Kufi Arabic',monospace!important}
/* The launch arrow points "outward" in both directions (RTL mirrors it). */
.lp-root[dir="rtl"] .lp-arrow{transform:scaleX(-1)}
/* Erase key: dimmed by JS until there is a digit to erase; .lp-key supplies
   the hover/active feedback, so full opacity on hover reads as "armed". */
.lp-bs:hover{opacity:1!important}
/* The 10-up group grid (v2.99.69). It used auto-fit/minmax(130px), which on a
   1138px-wide card resolves to EIGHT columns — so ten people rendered as 8 + 2
   with a large empty block underneath, which is what the owner's screenshot shows.
   Ten participants want the conventional 5x2; a phone gets 2x5, and the middle
   sizes get 3 and 4 so no breakpoint ever leaves a single orphan on the last row
   (10 divides by 5, 2 and — with one short row — 3 and 4). */
.lp-gcgrid{grid-template-columns:repeat(5,minmax(0,1fr))}
@media (max-width:900px){.lp-gcgrid{grid-template-columns:repeat(4,minmax(0,1fr))}}
@media (max-width:680px){.lp-gcgrid{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media (max-width:470px){.lp-gcgrid{grid-template-columns:repeat(2,minmax(0,1fr))}}
`;

/**
 * Per-tile specs for the 10-person group grid.
 *
 * v2.99.69 dropped the per-entry `spk`/`eq` fields. They pinned four tiles to
 * hardcoded speaking times on a DIFFERENT stagger from the ring sweep, so the ring
 * lit one face while another face's bars bounced. Speaking is now derived from the
 * tile's index — one schedule for the ring, the meter, the nod and the chip dot —
 * which is what makes the grid read as one conversation instead of ten decorations.
 * `live` is the per-tile jitter timing: non-harmonic values so no two tiles drift
 * in lockstep and none of them visibly loops.
 */
const GC = [
  { n: "LINA · HOST", kb: "lpKb1 12s ease-in-out -2s infinite alternate", live: "7.3s -0.4s" },
  { n: "OMAR", kb: "lpKb2 14s ease-in-out -5s infinite alternate", live: "6.1s -2.7s" },
  { n: "SARA", kb: "lpKb3 11s ease-in-out -1s infinite alternate", live: "8.9s -5.1s" },
  { n: "MAYA", kb: "lpKb2 13s ease-in-out -7s infinite alternate", live: "5.7s -1.3s" },
  { n: "ADAM", kb: "lpKb1 15s ease-in-out -4s infinite alternate", live: "9.7s -6.2s" },
  { n: "NORA", kb: "lpKb3 12s ease-in-out -6s infinite alternate", live: "6.7s -3.9s" },
  { n: "ZAIN", kb: "lpKb2 11s ease-in-out -3s infinite alternate", live: "8.3s -0.9s", muted: true },
  { n: "DANA", kb: "lpKb1 13s ease-in-out -8s infinite alternate", live: "7.9s -4.6s", muted: true },
  { n: "KARIM", kb: "lpKb3 14s ease-in-out -2s infinite alternate", live: "6.3s -2.1s" },
  { n: "HALA", kb: "lpKb2 12s ease-in-out -5s infinite alternate", live: "9.1s -7.4s" },
];

const MUTE_SVG = `<span style="position:absolute;right:8px;bottom:7px;width:16px;height:16px;border-radius:50%;background:rgba(255,93,93,.15);border:1px solid rgba(255,93,93,.45);display:flex;align-items:center;justify-content:center"><svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#ff5d5d" stroke-width="2.4" stroke-linecap="round"><rect x="9" y="2" width="6" height="12" rx="3"></rect><path d="M2 2l20 20"></path></svg></span>`;
const eqBars = (anim: string, w = 2.5, h = 10) =>
  `<span style="position:absolute;right:8px;bottom:8px;display:flex;align-items:flex-end;gap:2px;height:${h}px;animation:${anim}"><span style="width:${w}px;height:5px;border-radius:2px;background:#6ff2ae;transform-origin:bottom;animation:lpEq 1.1s ease-in-out infinite"></span><span style="width:${w}px;height:9px;border-radius:2px;background:#6ff2ae;transform-origin:bottom;animation:lpEq 1.1s ease-in-out .18s infinite"></span><span style="width:${w}px;height:7px;border-radius:2px;background:#6ff2ae;transform-origin:bottom;animation:lpEq 1.1s ease-in-out .36s infinite"></span></span>`;

/**
 * A voice-shaped level meter for the group grid (v2.99.69), gated by the SHARED
 * speaking schedule so it belongs to whoever the ring is lighting.
 *
 * Four bars, each with its own envelope and a non-harmonic duration, so they
 * disagree with one another the way a real meter does. The old version ran one
 * smooth sine on every bar, which reads as a spinner.
 */
const voxMeter = (delay: string) =>
  `<span style="position:absolute;right:8px;bottom:8px;display:flex;align-items:flex-end;gap:2px;height:11px;opacity:0;pointer-events:none;animation:lpVoxOn 20s ${delay} infinite">` +
  `<span style="width:2.5px;height:11px;border-radius:2px;background:#6ff2ae;transform-origin:bottom;animation:lpVox1 .74s ease-in-out infinite"></span>` +
  `<span style="width:2.5px;height:11px;border-radius:2px;background:#6ff2ae;transform-origin:bottom;animation:lpVox2 .53s ease-in-out infinite"></span>` +
  `<span style="width:2.5px;height:11px;border-radius:2px;background:#6ff2ae;transform-origin:bottom;animation:lpVox3 .89s ease-in-out infinite"></span>` +
  `<span style="width:2.5px;height:11px;border-radius:2px;background:#6ff2ae;transform-origin:bottom;animation:lpVox2 .61s ease-in-out -.2s infinite"></span>` +
  `</span>`;

/**
 * Speaking turn per tile, or null for a muted one.
 *
 * The turn is the tile's ordinal among the UNMUTED tiles, not its raw index. The
 * first cut of v2.99.69 used the raw index, and the screenshot showed the bug
 * immediately: the ring lit ZAIN and DANA, who wear mute badges — a muted person
 * highlighted as the active speaker, which is worse than no highlight at all.
 * Eight speakers over the shared 20s loop gives 2.5s each and fills the loop
 * exactly, so there is no dead gap where nobody is talking either.
 */
export function speakingTurns(
  tiles: ReadonlyArray<{ muted?: boolean }>
): Array<number | null> {
  let turn = 0;
  return tiles.map(t => (t.muted ? null : turn++));
}

function groupTiles(): string {
  const turns = speakingTurns(GC);
  const speakers = turns.filter(t => t !== null).length || 1;
  const slot = 20 / speakers; // seconds of the shared loop per speaker
  return GC.map((g, i) => {
    // ONE schedule per tile, for everything (v2.99.69). The ring, the level meter,
    // the nod and the chip's speaking dot all run the same 20s loop at the same
    // per-speaker offset, so the grid reads as a single conversation moving around
    // the room. Before this, four tiles carried their own hardcoded speaking times
    // on a different stagger from the ring sweep, so the highlight and the bars
    // belonged to different people and the whole thing looked decorative.
    const turn = turns[i];
    const delay = `${-(turn ?? 0) * slot}s`;
    // The nod runs on the CONTAINER. The old code comma-appended a box-shadow
    // animation here for four tiles; that has been dropped — box-shadow animates
    // by REPAINTING, and the ring overlay below already draws the same highlight
    // with opacity, which the compositor handles for free.
    // A MUTED tile gets no nod and no ring. It stays a live feed (the jitter and
    // Ken-Burns still run) but it never takes a turn, because nothing looks more
    // wrong than a mute badge on the person the highlight says is talking.
    const containerAnim = turn === null ? "" : `lpTalk 20s ${delay} infinite`;
    const ring =
      turn === null
        ? ""
        : `<span style="position:absolute;inset:0;border-radius:12px;border:2px solid #6ff2ae;box-shadow:0 0 22px rgba(111,242,174,.45),inset 0 0 18px rgba(111,242,174,.18);opacity:0;pointer-events:none;animation:lpActive 20s ${delay} infinite"></span>`;
    // A separate wrapper for the live-feed jitter: the img itself is already
    // running Ken-Burns, and two transform animations on ONE element do not
    // compose — the later declaration simply wins.
    const feed = `<span style="position:absolute;inset:0;display:block;animation:lpLive ${g.live} linear infinite"><img src="${P[i]}" alt="${g.n}" loading="lazy" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;animation:${g.kb}"></span>`;
    // A speaking dot inside the name chip. Opacity-gated on the same schedule
    // rather than recolouring the chip, which would repaint text.
    const dot = g.muted
      ? ""
      : `<span style="display:inline-block;width:4px;height:4px;border-radius:50%;background:#6ff2ae;margin-inline-end:4px;vertical-align:middle;opacity:0;animation:lpVoxOn 20s ${delay} infinite"></span>`;
    return `<div style="position:relative;border-radius:12px;overflow:hidden;background:linear-gradient(150deg,#101820,#0b1016);border:1px solid rgba(233,240,242,.08);aspect-ratio:4/3${containerAnim ? `;animation:${containerAnim}` : ""}">${feed}<span style="position:absolute;left:8px;bottom:7px;padding:3px 8px;border-radius:999px;background:rgba(10,13,16,.7);font:500 8px 'IBM Plex Mono',monospace;letter-spacing:.12em;color:#e9f0f2">${dot}${g.n}</span>${g.muted ? MUTE_SVG : voxMeter(delay)}${ring}</div>`;
  }).join("");
}

/** 0%–100% odometer lines for the boot loader's percent counter (v2.98.2).
 *  The strip is swept by the compositor (lpPct translateY, same clock as the
 *  bar's lpFill), so the counter keeps moving on main-thread-saturated devices
 *  where rAF textContent writes sat frozen at "0%". Latin digits in both
 *  languages — the counter is an LTR island like the dial display. */
function pctStripLines(): string {
  let lines = "";
  for (let i = 0; i <= 100; i++) lines += `<span style="display:block;height:14px;line-height:14px">${i}%</span>`;
  return lines;
}

function keypad(t: Copy): string {
  const cell =
    "display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;height:54px;border-radius:14px;background:rgba(255,255,255,.045);border:1px solid rgba(233,240,242,.09)";
  return KEYS.map(([d, sub]) =>
    d === BS_KEY
      ? // Erase cell: an icon, not a character. It carries data-lp (not
        // data-lp-key) so the delegated handler routes it to backspace().
        `<button type="button" class="lp-key lp-bs" data-lp="backBtn" aria-label="${t.erase}" title="${t.erase}" style="${cell};color:#e9f0f2;opacity:.35;transition:opacity .15s,transform .15s,background .15s">${ARROW_BS}</button>`
      : `<button type="button" class="lp-key" data-lp-key="${d}" style="${cell}"><span style="font:500 19px 'IBM Plex Mono',monospace;color:#e9f0f2;pointer-events:none">${d}</span><span style="font:500 8px 'IBM Plex Mono',monospace;letter-spacing:.2em;color:rgba(148,162,172,.65);min-height:9px;pointer-events:none">${sub}</span></button>`,
  ).join("");
}

const chromeBar = (host: string, label = "") =>
  `<div style="display:flex;align-items:center;gap:5px;padding:8px 12px;border-bottom:1px solid rgba(233,240,242,.07)"><span style="width:7px;height:7px;border-radius:50%;background:rgba(233,240,242,.18);display:block"></span><span style="width:7px;height:7px;border-radius:50%;background:rgba(233,240,242,.18);display:block"></span><span style="width:7px;height:7px;border-radius:50%;background:rgba(233,240,242,.18);display:block"></span><span style="margin-left:8px;font:400 9px 'IBM Plex Mono',monospace;letter-spacing:.12em;color:rgba(148,162,172,.6)">${host}${label}</span></div>`;

/** LIVE NETWORK stats strip (carried over from the previous landing). Values
 *  are written imperatively from the trpc.stats.public query. */
function statsStrip(t: Copy): string {
  const tile = (key: string, label: string, extra = "") =>
    `<div style="flex:1 1 180px;min-width:150px;text-align:center"><div dir="ltr" style="display:flex;align-items:center;justify-content:center;gap:8px"><span data-lp="stat-${key}" style="font:700 clamp(26px,3.4vw,40px) 'Space Grotesk',sans-serif;color:#e9f0f2">—</span>${extra}</div><div style="margin-top:6px;font:500 9px 'IBM Plex Mono',monospace;letter-spacing:.26em;color:rgba(148,162,172,.75)">${label}</div></div>`;
  return `
  <section class="lp-section" data-screen-label="Live stats" style="padding:56px 40px 8px">
    <div style="max-width:1140px;margin:0 auto">
      <div style="display:flex;align-items:center;gap:16px;margin-bottom:26px"><span data-scramble="1" style="font:500 11px 'IBM Plex Mono',monospace;letter-spacing:.28em;color:#6ff2ae">${t.statsEyebrow}</span><span style="flex:1;height:1px;background:linear-gradient(90deg,rgba(111,242,174,.35),transparent)"></span></div>
      <div style="display:flex;flex-wrap:wrap;gap:26px;border:1px solid rgba(233,240,242,.09);border-radius:20px;background:rgba(255,255,255,.025);padding:30px 24px">
        ${tile("users", t.statUsers)}
        ${tile("guests", t.statGuests)}
        ${tile("parties", t.statParties)}
        ${tile("messages", t.statMessages)}
        ${tile("online", t.statOnline, `<span style="width:8px;height:8px;border-radius:50%;background:#6ff2ae;box-shadow:0 0 12px rgba(111,242,174,.9);animation:lpBlink 1.6s infinite;display:block"></span>`)}
      </div>
    </div>
  </section>`;
}

function markup(host: string, t: Copy, ar: boolean): string {
  const mq = t.marquee;
  const supportEmail = `support@${host}`;
  const step = (n: string, title: string, body: string, demo: string) =>
    `<div data-reveal="${n === "01" ? 1 : n === "02" ? 2 : 3}"><div class="lp-card" style="background:rgba(255,255,255,.035);border:1px solid rgba(233,240,242,.09);border-radius:20px;padding:34px;min-height:220px;box-sizing:border-box"><div style="display:flex;align-items:center;gap:16px"><span style="font:600 13px 'IBM Plex Mono',monospace;letter-spacing:.2em;color:#6ff2ae">STEP ${n}</span><span style="flex:1;height:1px;background:linear-gradient(90deg,rgba(111,242,174,.45),transparent)"></span></div><h3 data-scramble="1" style="margin:22px 0 12px;font:600 22px 'Space Grotesk',sans-serif">${title}</h3><p style="margin:0;font:400 15px/1.65 'Space Grotesk',sans-serif;color:#94a2ac">${body}</p><div style="margin-top:22px;border:1px solid rgba(233,240,242,.1);border-radius:12px;overflow:hidden;background:rgba(10,13,16,.6)">${chromeBar(host)}<div style="height:170px;overflow:hidden;position:relative;background:radial-gradient(130% 110% at 50% 0%,#0f171b,#0a0d10);display:flex;align-items:center;justify-content:center">${demo}</div></div></div></div>`;

  const feat = (icon: string, title: string, body: string, reveal: number) =>
    `<div data-reveal="${reveal}"><div class="lp-card" style="background:rgba(255,255,255,.035);border:1px solid rgba(233,240,242,.09);border-radius:20px;padding:32px;min-height:210px;box-sizing:border-box"><div style="height:40px;display:flex;align-items:center">${icon}</div><h3 data-scramble="1" style="margin:20px 0 10px;font:600 21px 'Space Grotesk',sans-serif">${title}</h3><p style="margin:0;font:400 15px/1.6 'Space Grotesk',sans-serif;color:#94a2ac">${body}</p></div></div>`;
  const feat2 = (num: string, title: string, body: string, reveal: number) =>
    `<div data-reveal="${reveal}"><div class="lp-card2" style="background:rgba(255,255,255,.02);border:1px solid rgba(233,240,242,.09);border-radius:20px;padding:32px;min-height:170px;box-sizing:border-box"><div data-scramble="1" style="font:500 11px 'IBM Plex Mono',monospace;letter-spacing:.24em;color:rgba(111,242,174,.7)">[ ${num} ]</div><h3 data-scramble="1" style="margin:18px 0 10px;font:600 19px 'Space Grotesk',sans-serif">${title}</h3><p style="margin:0;font:400 14px/1.6 'Space Grotesk',sans-serif;color:#94a2ac">${body}</p></div></div>`;
  const faq = (q: string, a: string) =>
    `<details style="border-bottom:1px solid rgba(233,240,242,.1)"><summary style="display:flex;justify-content:space-between;align-items:center;gap:24px;padding:24px 0;cursor:pointer;list-style:none;font:500 18px 'Space Grotesk',sans-serif">${q}<span style="font:400 22px 'IBM Plex Mono',monospace;color:#6ff2ae">+</span></summary><p style="margin:0;padding:0 0 26px;font:400 15px/1.7 'Space Grotesk',sans-serif;color:#94a2ac;max-width:640px">${a}</p></details>`;

  return `
<div data-lp="root" id="top" dir="${ar ? "rtl" : "ltr"}" style="position:relative;min-height:100vh">
<div data-lp="hue" style="position:fixed;inset:0;z-index:0;pointer-events:none"></div>
<canvas data-lp="matrix" style="position:fixed;inset:0;width:100vw;height:100vh;display:block;z-index:0;pointer-events:none;opacity:.75"></canvas>
<canvas data-lp="canvas" style="position:fixed;inset:0;width:100vw;height:100vh;display:block;z-index:0;pointer-events:none"></canvas>
<div data-lp="spot" style="position:fixed;top:0;left:0;width:900px;height:900px;z-index:1;pointer-events:none;background:radial-gradient(circle 340px at center,rgba(111,242,174,.06),transparent 70%);mix-blend-mode:screen;transform:translate3d(-450px,-450px,0)"></div>

<div data-lp="loader" style="position:fixed;inset:0;z-index:100;background:#0a0d10;display:flex;align-items:center;justify-content:center;opacity:1;transition:opacity .6s ease">
  <div style="width:min(440px,84vw);display:flex;flex-direction:column;align-items:center;gap:38px">
    <div style="display:flex;align-items:center;gap:10px"><span style="width:8px;height:8px;border-radius:50%;background:#6ff2ae;box-shadow:0 0 12px rgba(111,242,174,.9);animation:lpBlink 1.4s infinite"></span><span style="font:700 16px 'Space Grotesk',sans-serif;letter-spacing:.24em;color:#e9f0f2">RELAY</span></div>
    <div style="width:100%">
      <div style="text-align:center;font:500 9px 'IBM Plex Mono',monospace;letter-spacing:.3em;color:#6ff2ae;margin-bottom:8px">DTLS-SRTP · END-TO-END HANDSHAKE</div>
      <div style="text-align:center;font:400 10px 'IBM Plex Mono',monospace;letter-spacing:.08em;color:rgba(148,162,172,.75);margin-bottom:22px">${t.loaderTagline}</div>
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
      <div data-lp="loadTrack" style="width:100%;height:3px;border-radius:3px;background:rgba(233,240,242,.08);overflow:hidden"><div data-lp="loadBar" style="width:100%;height:100%;border-radius:3px;background:#6ff2ae;box-shadow:0 0 14px rgba(111,242,174,.8)"></div></div>
      <div style="display:flex;justify-content:space-between;margin-top:12px"><span data-lp="loadMsg" style="font:500 10px 'IBM Plex Mono',monospace;letter-spacing:.22em;color:#6ff2ae">${t.bootMsgs[0][1]}</span><span data-lp="loadPct" dir="ltr" style="font:500 10px 'IBM Plex Mono',monospace;letter-spacing:.18em;color:rgba(148,162,172,.8);display:block;height:14px;overflow:hidden;text-align:right"><span data-lp="pctStrip" style="display:block">${pctStripLines()}</span></span></div>
      <div data-lp="loadSub" style="margin-top:9px;font:400 11px/1.5 'Space Grotesk',sans-serif;color:rgba(148,162,172,.85);min-height:17px">${t.bootMsgs[0][2]}</div>
    </div>
  </div>
</div>

<nav data-lp="nav" style="position:fixed;top:0;left:0;right:0;z-index:10;display:flex;align-items:center;justify-content:space-between;gap:24px;padding:16px 40px;background:rgba(10,13,16,.45);backdrop-filter:blur(18px) saturate(1.5);-webkit-backdrop-filter:blur(18px) saturate(1.5);border-bottom:1px solid rgba(111,242,174,.18);box-shadow:0 8px 40px rgba(0,0,0,.25), inset 0 1px 0 rgba(255,255,255,.06)">
  <a href="#top" class="lp-logo" style="display:flex;align-items:center;gap:10px;color:#e9f0f2"><span data-lp="dockDot" style="width:8px;height:8px;border-radius:50%;background:#6ff2ae;box-shadow:0 0 12px rgba(111,242,174,.9);display:block"></span><span style="font:700 17px 'Space Grotesk',sans-serif;letter-spacing:.22em">RELAY</span></a>
  <div class="lp-navlinks" style="display:flex;align-items:center;gap:28px;font:500 11px 'IBM Plex Mono',monospace;letter-spacing:.18em">
    <a class="lp-navlink" href="#how">${t.navHow}</a>
    <a class="lp-navlink" href="#features">${t.navFeatures}</a>
    <a class="lp-navlink" href="#privacy">${t.navPrivacy}</a>
    <a class="lp-navlink" href="#faq">${t.navFaq}</a>
  </div>
  <div style="display:flex;align-items:center;gap:10px"><button type="button" data-lp="langBtn" style="cursor:pointer;font:600 11px 'IBM Plex Mono',monospace;letter-spacing:.12em;color:#e9f0f2;border:1px solid rgba(233,240,242,.25);border-radius:999px;padding:9px 14px;background:rgba(255,255,255,.04)">${t.langBtn}</button><a data-lp="dock" class="lp-dock" href="/app" style="font:600 11px 'IBM Plex Mono',monospace;letter-spacing:.16em;color:#6ff2ae;border:1px solid rgba(111,242,174,.4);border-radius:999px;padding:10px 20px;background:rgba(111,242,174,.06);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);display:inline-flex;align-items:center;gap:7px;white-space:nowrap">${t.openApp}${ARROW_NE}</a></div>
</nav>

<main style="position:relative;z-index:2">
  <section class="lp-hero" data-screen-label="Hero" style="min-height:100vh;display:flex;align-items:center;padding:150px 40px 90px;box-sizing:border-box">
    <div style="max-width:1240px;margin:0 auto;display:flex;flex-wrap:wrap;gap:70px;align-items:center;justify-content:space-between;width:100%">
      <div style="flex:1 1 520px;min-width:320px">
        <div style="display:flex;align-items:center;gap:10px;font:500 11px 'IBM Plex Mono',monospace;letter-spacing:.24em;color:#6ff2ae;animation:lpRiseIn .9s cubic-bezier(.22,1,.36,1) both"><span style="width:6px;height:6px;border-radius:50%;background:#6ff2ae;animation:lpBlink 1.6s infinite"></span><span data-scramble="1">${t.heroBadge}</span></div>
        <h1 style="margin:26px 0 0;font:700 clamp(48px,7vw,94px)/0.99 'Space Grotesk',sans-serif;letter-spacing:-.025em">
          <span style="display:block;animation:lpRiseIn .9s cubic-bezier(.22,1,.36,1) .08s both" data-scramble="1">${t.h1a}</span>
          <span style="display:block;animation:lpRiseIn .9s cubic-bezier(.22,1,.36,1) .18s both" data-scramble="1">${t.h1b}</span>
          <span style="display:block;color:#6ff2ae;text-shadow:0 0 44px rgba(111,242,174,.35);animation:lpRiseIn .9s cubic-bezier(.22,1,.36,1) .28s both" data-scramble="1">${t.h1c}</span>
        </h1>
        <p style="margin:28px 0 0;max-width:470px;font:400 17px/1.65 'Space Grotesk',sans-serif;color:#94a2ac;animation:lpRiseIn .9s cubic-bezier(.22,1,.36,1) .4s both">${t.heroP}</p>
        <div style="display:flex;flex-wrap:wrap;gap:16px;margin-top:38px;animation:lpRiseIn .9s cubic-bezier(.22,1,.36,1) .5s both">
          <a class="lp-cta" href="/app" style="background:#6ff2ae;color:#06120b;font:600 16px 'Space Grotesk',sans-serif;padding:16px 30px;border-radius:999px;box-shadow:0 0 36px rgba(111,242,174,.35)">${t.ctaLaunch}</a>
          <a class="lp-ghost" href="#how" style="color:#e9f0f2;font:500 16px 'Space Grotesk',sans-serif;padding:16px 28px;border-radius:999px;border:1px solid rgba(233,240,242,.18)">${t.ctaHow}</a>
        </div>
        <div style="margin-top:34px;font:400 10px 'IBM Plex Mono',monospace;letter-spacing:.26em;color:rgba(148,162,172,.6);animation:lpRiseIn .9s cubic-bezier(.22,1,.36,1) .6s both">${t.worksIn}</div>
      </div>
      <div style="flex:0 1 375px;min-width:320px;animation:lpRiseIn 1s cubic-bezier(.22,1,.36,1) .55s both">
        <div data-lp="padTilt" style="background:rgba(255,255,255,.035);border:1px solid rgba(233,240,242,.1);border-radius:26px;padding:26px;backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);box-shadow:0 30px 80px rgba(0,0,0,.5);transition:transform .25s ease-out;transform:perspective(900px)">
          <div style="display:flex;align-items:center;justify-content:space-between;font:500 10px 'IBM Plex Mono',monospace;letter-spacing:.22em"><span style="color:rgba(148,162,172,.9)">${t.dialerTitle}</span><span style="display:flex;align-items:center;gap:6px;color:#6ff2ae"><span style="width:5px;height:5px;border-radius:50%;background:#6ff2ae;animation:lpBlink 1.6s infinite"></span>${t.dialerOnline}</span></div>
          <div data-lp="dialDisplay" dir="ltr" style="margin:22px 0 8px;text-align:center;font:500 clamp(19px,6.2vw,30px) 'IBM Plex Mono',monospace;letter-spacing:clamp(.13em,.6vw,.28em);white-space:nowrap;color:#e9f0f2;min-height:38px">· · · · · ·</div>
          <div data-lp="dialStatus" style="text-align:center;font:400 10px 'IBM Plex Mono',monospace;letter-spacing:.22em;color:rgba(148,162,172,.9);margin-bottom:8px">${t.dialEnter}</div>
          <div data-lp="dialPreview" style="display:none;text-align:center;font:500 12px 'Space Grotesk',sans-serif;margin-bottom:14px;min-height:18px"></div>
          <div dir="ltr" style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px">${keypad(t)}</div>
          <a data-lp="callBtn" href="/app" style="display:flex;align-items:center;justify-content:center;gap:8px;margin-top:14px;text-align:center;padding:15px;border-radius:14px;background:rgba(111,242,174,.12);border:1px solid rgba(111,242,174,.35);color:#6ff2ae;font:600 12px 'IBM Plex Mono',monospace;letter-spacing:.22em;opacity:.4;pointer-events:none;transition:all .3s">${t.call}</a>
          <div style="display:flex;justify-content:space-between;margin-top:14px;font:400 10px 'IBM Plex Mono',monospace;letter-spacing:.16em">
            <button type="button" data-lp="clearBtn" style="background:none;border:none;cursor:pointer;color:rgba(148,162,172,.7);font:inherit;letter-spacing:inherit;padding:0">${t.clear}</button>
            <button type="button" data-lp="demoBtn" style="background:none;border:none;cursor:pointer;color:rgba(111,242,174,.8);font:inherit;letter-spacing:inherit;padding:0;border-bottom:1px dotted rgba(111,242,174,.5)">${t.demo}</button>
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

  ${statsStrip(t)}

  <section id="how" class="lp-section" data-screen-label="How it works" style="padding:150px 40px 120px">
    <div style="max-width:1140px;margin:0 auto">
      <div data-reveal="0" data-scramble="1" style="font:500 11px 'IBM Plex Mono',monospace;letter-spacing:.28em;color:#6ff2ae">${t.howEyebrow}</div>
      <h2 data-reveal="1" data-scramble="1" style="margin:18px 0 0;font:700 clamp(34px,4.4vw,58px)/1.05 'Space Grotesk',sans-serif;letter-spacing:-.02em;max-width:640px">${t.howH2}</h2>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:26px;margin-top:64px">
        ${step("01", t.step1T, t.step1B, `<div style="animation:lpFloat3d 7s ease-in-out infinite alternate;display:flex;flex-direction:column;align-items:center;gap:11px"><div style="font:500 8px 'IBM Plex Mono',monospace;letter-spacing:.28em;color:rgba(111,242,174,.75)">CHOOSE A NAME</div><div style="display:flex;align-items:center;padding:9px 18px;border:1px solid rgba(111,242,174,.35);border-radius:10px;background:rgba(255,255,255,.03);box-shadow:0 0 24px rgba(111,242,174,.1);font:600 17px 'IBM Plex Mono',monospace;color:#e9f0f2"><span style="opacity:0;animation:lpTch 6s infinite .2s">S</span><span style="opacity:0;animation:lpTch 6s infinite .5s">a</span><span style="opacity:0;animation:lpTch 6s infinite .8s">r</span><span style="opacity:0;animation:lpTch 6s infinite 1.1s">a</span><span style="width:2px;height:16px;margin-left:3px;background:#6ff2ae;animation:lpCaretB 1s steps(1) infinite;display:block"></span></div><div style="font:600 9px 'IBM Plex Mono',monospace;letter-spacing:.22em;color:#0a0d10;background:#6ff2ae;padding:7px 16px;border-radius:999px;animation:lpGlowP 3s ease-in-out infinite">ENTER RELAY →</div></div><span style="position:absolute;left:10px;bottom:9px;display:flex;align-items:center;gap:6px;font:500 8px 'IBM Plex Mono',monospace;letter-spacing:.22em;color:rgba(111,242,174,.85)"><span style="width:5px;height:5px;border-radius:50%;background:#6ff2ae;box-shadow:0 0 8px rgba(111,242,174,.9);display:block"></span>GUEST MODE</span>`)}
        ${step("02", t.step2T, t.step2B, `<div style="animation:lpFloat3d 7s ease-in-out infinite alternate reverse;display:flex;flex-direction:column;align-items:center;gap:12px"><div style="font:500 8px 'IBM Plex Mono',monospace;letter-spacing:.28em;color:rgba(111,242,174,.75)">YOUR RELAY NUMBER</div><div style="display:flex;gap:6px;font:700 32px 'IBM Plex Mono',monospace;color:#6ff2ae;text-shadow:0 0 22px rgba(111,242,174,.55)"><span style="opacity:0;animation:lpDgt 5.5s infinite .2s">2</span><span style="opacity:0;animation:lpDgt 5.5s infinite .4s">3</span><span style="opacity:0;animation:lpDgt 5.5s infinite .6s">5</span><span style="opacity:0;animation:lpDgt 5.5s infinite .7s;color:rgba(111,242,174,.45)">-</span><span style="opacity:0;animation:lpDgt 5.5s infinite .8s">5</span><span style="opacity:0;animation:lpDgt 5.5s infinite 1s">3</span><span style="opacity:0;animation:lpDgt 5.5s infinite 1.2s">1</span></div><div style="display:flex;align-items:center;gap:7px;font:500 9px 'IBM Plex Mono',monospace;letter-spacing:.2em;color:#94a2ac;border:1px solid rgba(233,240,242,.15);border-radius:999px;padding:6px 14px"><span style="color:#6ff2ae">⤴</span>SHARE INVITE LINK</div></div><span style="position:absolute;left:10px;bottom:9px;display:flex;align-items:center;gap:6px;font:500 8px 'IBM Plex Mono',monospace;letter-spacing:.22em;color:rgba(111,242,174,.85)"><span style="width:5px;height:5px;border-radius:50%;background:#6ff2ae;box-shadow:0 0 8px rgba(111,242,174,.9);display:block"></span>YOUR NUMBER</span>`)}
        ${step("03", t.step3T, t.step3B, `<div style="animation:lpFloat3d 8s ease-in-out infinite alternate;display:flex;align-items:center;gap:18px"><div style="display:grid;grid-template-columns:repeat(3,42px);gap:5px"><div style="border-radius:8px;background:rgba(255,255,255,.045);color:#94a2ac;font:600 11px 'IBM Plex Mono',monospace;text-align:center;padding:6px 0">1</div><div style="border-radius:8px;background:rgba(255,255,255,.045);color:#94a2ac;font:600 11px 'IBM Plex Mono',monospace;text-align:center;padding:6px 0;animation:lpKpress 6s infinite .3s">2</div><div style="border-radius:8px;background:rgba(255,255,255,.045);color:#94a2ac;font:600 11px 'IBM Plex Mono',monospace;text-align:center;padding:6px 0;animation:lpKpress 6s infinite .8s">3</div><div style="border-radius:8px;background:rgba(255,255,255,.045);color:#94a2ac;font:600 11px 'IBM Plex Mono',monospace;text-align:center;padding:6px 0">4</div><div style="border-radius:8px;background:rgba(255,255,255,.045);color:#94a2ac;font:600 11px 'IBM Plex Mono',monospace;text-align:center;padding:6px 0;animation:lpKpress 6s infinite 1.3s">5</div><div style="border-radius:8px;background:rgba(255,255,255,.045);color:#94a2ac;font:600 11px 'IBM Plex Mono',monospace;text-align:center;padding:6px 0">6</div><div style="border-radius:8px;background:rgba(255,255,255,.045);color:#94a2ac;font:600 11px 'IBM Plex Mono',monospace;text-align:center;padding:6px 0">7</div><div style="border-radius:8px;background:rgba(255,255,255,.045);color:#94a2ac;font:600 11px 'IBM Plex Mono',monospace;text-align:center;padding:6px 0">8</div><div style="border-radius:8px;background:rgba(255,255,255,.045);color:#94a2ac;font:600 11px 'IBM Plex Mono',monospace;text-align:center;padding:6px 0;animation:lpKpress 6s infinite 1.8s">9</div></div><div style="display:flex;flex-direction:column;align-items:center;gap:9px"><div style="font:700 15px 'IBM Plex Mono',monospace;color:#6ff2ae;text-shadow:0 0 14px rgba(111,242,174,.5)">235-91_</div><div style="width:38px;height:38px;border-radius:50%;background:#6ff2ae;display:flex;align-items:center;justify-content:center;animation:lpCallPulse 6s infinite"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#0a0d10" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3A19.5 19.5 0 0 1 5 12.7 19.8 19.8 0 0 1 2 4.1 2 2 0 0 1 4 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.9a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.2-1.2a2 2 0 0 1 2.1-.5c1 .3 2 .6 2.9.7a2 2 0 0 1 1.8 2z"></path></svg></div><div style="font:500 8px 'IBM Plex Mono',monospace;letter-spacing:.22em;color:#94a2ac">CALLING…</div></div></div><span style="position:absolute;left:10px;bottom:9px;display:flex;align-items:center;gap:6px;font:500 8px 'IBM Plex Mono',monospace;letter-spacing:.22em;color:rgba(111,242,174,.85)"><span style="width:5px;height:5px;border-radius:50%;background:#6ff2ae;box-shadow:0 0 8px rgba(111,242,174,.9);display:block"></span>DIAL PAD</span>`)}
      </div>
    </div>
  </section>

  <section id="features" class="lp-section" data-screen-label="Features" style="padding:120px 40px">
    <div style="max-width:1140px;margin:0 auto">
      <div data-reveal="0" data-scramble="1" style="font:500 11px 'IBM Plex Mono',monospace;letter-spacing:.28em;color:#6ff2ae">${t.featEyebrow}</div>
      <h2 data-reveal="1" data-scramble="1" style="margin:18px 0 0;font:700 clamp(34px,4.4vw,58px)/1.05 'Space Grotesk',sans-serif;letter-spacing:-.02em;max-width:700px">${t.featH2}</h2>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:24px;margin-top:64px">
        ${feat(`<span style="display:flex;align-items:flex-end;gap:4px;height:40px"><span style="width:4px;height:12px;border-radius:2px;background:#6ff2ae;transform-origin:bottom;animation:lpEq 1.1s ease-in-out infinite"></span><span style="width:4px;height:22px;border-radius:2px;background:#6ff2ae;transform-origin:bottom;animation:lpEq 1.1s ease-in-out .13s infinite"></span><span style="width:4px;height:32px;border-radius:2px;background:#6ff2ae;transform-origin:bottom;animation:lpEq 1.1s ease-in-out .26s infinite"></span><span style="width:4px;height:18px;border-radius:2px;background:#6ff2ae;transform-origin:bottom;animation:lpEq 1.1s ease-in-out .39s infinite"></span><span style="width:4px;height:9px;border-radius:2px;background:#6ff2ae;transform-origin:bottom;animation:lpEq 1.1s ease-in-out .52s infinite"></span></span>`, t.f1T, t.f1B, 1)}
        ${feat(`<span style="position:relative;width:40px;height:27px;border:2px solid #6ff2ae;border-radius:7px;display:block"><span style="position:absolute;right:-13px;top:5px;width:10px;height:13px;background:#6ff2ae;clip-path:polygon(100% 0,0 50%,100% 100%);display:block"></span></span>`, t.f2T, t.f2B, 2)}
        ${feat(`<span style="width:40px;height:27px;border:2px solid #6ff2ae;border-radius:7px;display:flex;align-items:center;justify-content:center;gap:4px"><span style="width:4px;height:4px;border-radius:50%;background:#6ff2ae;animation:lpDots 1.3s infinite"></span><span style="width:4px;height:4px;border-radius:50%;background:#6ff2ae;animation:lpDots 1.3s .18s infinite"></span><span style="width:4px;height:4px;border-radius:50%;background:#6ff2ae;animation:lpDots 1.3s .36s infinite"></span></span>`, t.f3T, t.f3B, 3)}
        ${feat2("04", t.f4T, t.f4B, 2)}
        ${feat2("05", t.f5T, t.f5B, 3)}
        ${feat2("06", t.f6T, t.f6B, 4)}
      </div>

      <div data-reveal="2" style="margin-top:60px">
        <div style="display:flex;align-items:center;gap:16px;margin-bottom:22px"><span data-scramble="1" style="font:500 11px 'IBM Plex Mono',monospace;letter-spacing:.28em;color:#6ff2ae">${t.liveFrom}</span><span style="flex:1;height:1px;background:linear-gradient(90deg,rgba(111,242,174,.35),transparent)"></span></div>
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
            <div class="lp-gcgrid" style="display:grid;gap:8px;padding:42px 12px 64px">${groupTiles()}</div>
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
        <div data-reveal="0" data-scramble="1" style="font:500 11px 'IBM Plex Mono',monospace;letter-spacing:.28em;color:#6ff2ae">${t.privEyebrow}</div>
        <h2 data-reveal="1" data-scramble="1" style="margin:18px 0 0;font:700 clamp(34px,4.4vw,58px)/1.05 'Space Grotesk',sans-serif;letter-spacing:-.02em">${t.privH2}</h2>
        <p data-reveal="2" style="margin:26px 0 0;font:400 16px/1.7 'Space Grotesk',sans-serif;color:#94a2ac;max-width:480px">${t.privP1}</p>
        <p data-reveal="3" style="margin:18px 0 0;font:400 16px/1.7 'Space Grotesk',sans-serif;color:#94a2ac;max-width:480px">${t.privP2}</p>
        <div data-reveal="4" style="margin-top:30px;display:flex;flex-direction:column;gap:12px;font:500 12px 'IBM Plex Mono',monospace;letter-spacing:.14em;color:rgba(233,240,242,.85)">
          <span><span style="color:#6ff2ae">—</span> ${t.privL1}</span>
          <span><span style="color:#6ff2ae">—</span> ${t.privL2}</span>
          <span><span style="color:#6ff2ae">—</span> ${t.privL3}</span>
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
      <div data-reveal="0" data-scramble="1" style="font:500 11px 'IBM Plex Mono',monospace;letter-spacing:.28em;color:#6ff2ae">${t.faqEyebrow}</div>
      <h2 data-reveal="1" data-scramble="1" style="margin:18px 0 40px;font:700 clamp(34px,4.4vw,54px)/1.05 'Space Grotesk',sans-serif;letter-spacing:-.02em">${t.faqH2}</h2>
      <div data-reveal="2">
        ${faq(t.q1, t.a1)}
        ${faq(t.q2, t.a2)}
        ${faq(t.q3, t.a3)}
        ${faq(t.q4, t.a4)}
        ${faq(t.q5, t.a5)}
        ${faq(t.q6, t.a6(supportEmail))}
      </div>
      <div data-reveal="3" style="margin-top:70px;text-align:center">
        <a class="lp-cta" href="/app" style="display:inline-block;background:#6ff2ae;color:#06120b;font:600 17px 'Space Grotesk',sans-serif;padding:18px 40px;border-radius:999px;box-shadow:0 0 40px rgba(111,242,174,.35)">${t.ctaNumber}</a>
        <div style="margin-top:16px;font:400 10px 'IBM Plex Mono',monospace;letter-spacing:.24em;color:rgba(148,162,172,.6)">${t.ctaFine}</div>
      </div>
    </div>
  </section>

  <footer data-screen-label="Footer" style="padding:100px 40px 50px;border-top:1px solid rgba(233,240,242,.07)">
    <div style="max-width:1240px;margin:0 auto">
      <div style="font:700 clamp(90px,15vw,220px)/0.9 'Space Grotesk',sans-serif;letter-spacing:.03em;color:rgba(233,240,242,.06);text-align:center;user-select:none" data-scramble="1">RELAY</div>
      <div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:24px;margin-top:60px">
        <div style="font:400 11px 'IBM Plex Mono',monospace;letter-spacing:.18em;color:rgba(148,162,172,.7)"><span>${t.footTag}</span> <span dir="ltr">© 2026 RELAY · v${APP_VERSION}</span></div>
        <div style="display:flex;flex-wrap:wrap;gap:26px;font:500 11px 'IBM Plex Mono',monospace;letter-spacing:.16em">
          <a href="/app" style="display:inline-flex;align-items:center;gap:6px">${t.openApp}${ARROW_NE}</a>
          <a class="lp-footlink" href="#how">${t.navHow}</a>
          <a class="lp-footlink" href="#features">${t.navFeatures}</a>
          <a class="lp-footlink" href="#privacy">${t.navPrivacy}</a>
          <a class="lp-footlink" href="#faq">${t.navFaq}</a>
          <a class="lp-footlink" href="mailto:${supportEmail}" dir="ltr">${supportEmail}</a>
          <a class="lp-footlink" href="/privacy-policy">${t.footPolicy}</a>
          <a class="lp-footlink" href="#top">${t.footTop}</a>
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

/** A directory.lookup result the landing dialer can preview (subset we use). */
export interface DialLookup {
  displayName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  isOnline?: boolean;
  partyLine?: boolean;
  memberCount?: number;
}

/** The owner asked the preview to show "the name first and last." Registered
 *  users carry firstName/lastName; prefer "First Last", else the displayName. */
function dialLookupName(res: DialLookup): string {
  const full = [res.firstName, res.lastName].filter((s) => s && s.trim()).join(" ").trim();
  return full || (res.displayName || "").trim();
}

function startLanding(
  host: HTMLElement,
  t: Copy,
  opts: {
    skipBoot: boolean;
    onToggleLang: () => void;
    /** Resolve a dialed 6-digit number to its owner (public directory.lookup).
     *  Returns null for an unknown number. Used to preview name + online state
     *  and to gate the CALL button (guests can only call an ONLINE user). */
    onLookup?: (number: string) => Promise<DialLookup | null>;
  }
): () => void {
  const $ = (k: string) => host.querySelector<HTMLElement>(`[data-lp="${k}"]`);
  // FIRST action: prove JS is alive — this disarms the pure-CSS auto-clear
  // watchdog on the overlay (the JS watchdogs in runLoader take over from here).
  $("loader")?.classList.add("lp-js-ok");
  const reduced =
    typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  /* Frame budget (v2.99.67). The page ran TWO uncapped rAF loops — this one and
     the WebGL scene's — plus a full-viewport canvas repaint every frame, with no
     pause when the tab was hidden. On a phone that pins the GPU and the device
     gets hot in the hand. None of this animation reads as smoother at 60fps than
     at 30, so it is capped; phones get a lower cap again, and the WebGL scene is
     skipped there entirely (see bootThree). */
  const lowPower =
    typeof navigator !== "undefined" &&
    (innerWidth <= 820 ||
      (typeof navigator.hardwareConcurrency === "number" && navigator.hardwareConcurrency <= 4) ||
      // Data Saver is an explicit "spend less on my behalf" signal.
      !!(navigator as unknown as { connection?: { saveData?: boolean } }).connection?.saveData);
  const FRAME_MS = lowPower ? 1000 / 20 : 1000 / 30;
  const TINT_MS = lowPower ? 220 : 160;
  let lastFrame = 0;
  let lastTint = 0;


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
  // v2.99.15 — live number resolution for the hero dialer. `dialTarget` holds
  // the looked-up owner of the CURRENT 6-digit number (null = unknown/pending);
  // `dialCallable` gates the CALL button. A guest may only dial an ONLINE user
  // (or a party line); an offline user / unknown number can't be called from
  // here. `FALLBACK` = the lookup failed (network) — let the call proceed to the
  // /i flow, which re-resolves and gates offline itself.
  const FALLBACK = Symbol("lookup-failed");
  let dialTarget: DialLookup | null | typeof FALLBACK = null;
  let dialCallable = false;
  let lastLookedUp = "";
  let lookupSeq = 0;
  const escLp = (s: string) =>
    s.replace(/[&<>"']/g, (c) => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string
    ));

  /* ── dialer ── */
  const setCallState = (armed: boolean, label: string, arrow = false) => {
    const cb = $("callBtn");
    dialCallable = armed;
    if (!cb) return;
    // textContent (never innerHTML) for the label — it carries localized copy.
    cb.textContent = label;
    // The launch arrow is a CONSTANT SVG appended after the text: a bare "↗"
    // rendered as an emoji box in Arabic (the forced Noto Kufi Arabic face has
    // no U+2197), exactly like the nav pill did. No interpolation here, so
    // insertAdjacentHTML carries no injection surface.
    if (arrow) cb.insertAdjacentHTML("beforeend", ARROW_NE);
    cb.style.opacity = armed ? "1" : ".4";
    cb.style.pointerEvents = armed ? "auto" : "none";
    cb.style.background = armed ? "#6ff2ae" : "rgba(111,242,174,.12)";
    cb.style.color = armed ? "#06120b" : "#6ff2ae";
    cb.style.boxShadow = armed ? "0 0 34px rgba(111,242,174,.4)" : "none";
  };
  const setPreview = (html: string) => {
    const p = $("dialPreview");
    if (!p) return;
    // v2.99.35: while a RESOLVED preview line is showing (name · ONLINE /
    // offline / not-found), the status line above it is redundant — and it
    // was stuck on "CHECKING NUMBER…" forever (syncDial writes it, nothing
    // ever resolved it), so the pad showed two contradicting lines at once.
    const st = $("dialStatus");
    if (st) st.style.display = html ? "none" : "";
    if (!html) { p.style.display = "none"; p.innerHTML = ""; return; }
    p.style.display = "block";
    p.innerHTML = html; // name is escaped by callers via escLp
  };
  const applyLookup = (n: string, res: DialLookup | null) => {
    const fmt = `${n.slice(0, 3)}-${n.slice(3)}`;
    dialTarget = res;
    if (!res) {
      // No RELAY user owns this number — nothing to call.
      setPreview(`<span style="color:#f2a9a9">${t.dialNotFound}</span>`);
      setCallState(false, t.call);
      return;
    }
    const name = escLp(dialLookupName(res) || fmt);
    if (res.partyLine) {
      setPreview(`<b style="color:#e9f0f2">${name}</b> <span style="color:rgba(148,162,172,.85)">· ${t.dialParty(res.memberCount || 0)}</span>`);
      setCallState(true, t.dialJoin, true);
      return;
    }
    if (res.isOnline) {
      setPreview(`<b style="color:#e9f0f2">${name}</b> <span style="color:#6ff2ae">· ${t.dialerOnline}</span>`);
      setCallState(true, `${t.call} ${fmt}`, true);
    } else {
      // OFFLINE → a guest can't reach them from the landing page.
      setPreview(`<b style="color:#e9f0f2">${name}</b> <span style="color:rgba(148,162,172,.8)">· ${t.dialOffline}</span>`);
      setCallState(false, t.call);
    }
  };
  const runLookup = (n: string) => {
    lastLookedUp = n;
    dialTarget = null;
    setPreview(`<span style="color:rgba(148,162,172,.85)">${t.dialChecking}</span>`);
    setCallState(false, t.call);
    if (!opts.onLookup) {
      // No resolver wired (unit/preview) — behave like the pre-v2.99.15 dialer:
      // arm the button and let the /i flow resolve + gate.
      dialTarget = FALLBACK;
      setPreview("");
      const st = $("dialStatus");
      if (st) st.textContent = t.dialReady; // not "checking" — nothing is
      setCallState(true, `${t.call} ${n.slice(0, 3)}-${n.slice(3)}`, true);
      return;
    }
    const seq = ++lookupSeq;
    void Promise.resolve(opts.onLookup(n))
      .then((res) => {
        if (seq !== lookupSeq || num !== n) return; // stale / number changed
        applyLookup(n, res);
      })
      .catch(() => {
        if (seq !== lookupSeq || num !== n) return;
        // Lookup failed — don't strand the caller; let /i re-resolve + gate.
        dialTarget = FALLBACK;
        setPreview("");
        const st = $("dialStatus");
        if (st) st.textContent = t.dialReady; // resolved (fail-open), not "checking"
        setCallState(true, `${t.call} ${n.slice(0, 3)}-${n.slice(3)}`, true);
      });
  };
  const syncDial = () => {
    const el = $("dialDisplay"), st = $("dialStatus");
    const chars: string[] = [];
    for (let i = 0; i < 6; i++) chars.push(num[i] || "·");
    if (el) el.textContent = chars.join(" ");
    const len = num.length, full = len === 6;
    // The erase key keeps its grid cell (removing it would reflow the pad) but
    // dims to show there is nothing to erase yet.
    const bs = $("backBtn");
    if (bs) bs.style.opacity = len ? "1" : ".35";
    if (st) {
      st.textContent = full ? t.dialChecking : len ? t.dialMore(6 - len) : t.dialEnter;
      st.style.color = full ? "#6ff2ae" : "rgba(148,162,172,.9)";
    }
    if (!full) {
      // Below 6 digits: nothing to call yet — clear any prior preview/target.
      dialTarget = null;
      lastLookedUp = "";
      lookupSeq++; // invalidate any in-flight lookup
      setPreview("");
      setCallState(false, t.call);
      return;
    }
    // Full number: resolve once (guard against re-firing on repeated syncDial).
    if (num !== lastLookedUp) runLookup(num);
  };
  /* ── key tones (owner: "make tone when you click each number as sound") ──
     Real DTMF pairs, one per key. Two things kept the previous implementation
     effectively silent: (1) it scheduled the oscillators at `ac.currentTime`
     in the SAME tick it called `ac.resume()` — resume is ASYNC, so on iOS the
     context was still suspended when the note was scheduled, and by the time
     it actually started running that timestamp was already in the past, so
     the note was dropped (the classic iOS Web Audio race); and (2) the peak
     gain was 0.045 (≈ -27 dBFS) — inaudible over any ambient noise even when
     it did fire. Now the context is unlocked on the first real gesture, a
     suspended context resumes and THEN schedules, every note starts at a
     small lookahead so it can never be scheduled in the past, and the peak is
     a clearly audible 0.18.
     PLATFORM LIMIT (not a bug we can fix): on iPhone the hardware mute switch
     silences Web Audio outright — no web page can override that. */
  const TONE_PEAK = 0.18;
  const ensureAc = (): AudioContext | null => {
    if (!ac) {
      try {
        const Ctor =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return null;
        ac = new Ctor();
      } catch {
        return null; // audio is decorative — never break the dialer
      }
    }
    return ac;
  };
  const playTones = (freqs: number[], ms = 150) => {
    const c = ensureAc();
    if (!c) return;
    const fire = () => {
      if (!alive || c.state !== "running") return;
      try {
        const t0 = c.currentTime + 0.005; // lookahead: never schedule in the past
        const dur = ms / 1000;
        const g = c.createGain();
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(TONE_PEAK, t0 + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        g.connect(c.destination);
        for (const fr of freqs) {
          const o = c.createOscillator();
          o.type = "sine";
          o.frequency.value = fr;
          o.connect(g);
          o.start(t0);
          o.stop(t0 + dur + 0.01);
        }
      } catch { /* decorative */ }
    };
    // A suspended context MUST resume before the note is scheduled.
    if (c.state === "suspended") void c.resume().then(fire).catch(() => {});
    else fire();
  };
  /** iOS only starts an AudioContext from inside a real user gesture. */
  let audioUnlocked = false;
  const unlockAudio = () => {
    if (audioUnlocked) return;
    audioUnlocked = true;
    const c = ensureAc();
    if (!c) return;
    try {
      if (c.state === "suspended") void c.resume();
      // A 1-sample silent buffer played during the gesture completes the unlock.
      const src = c.createBufferSource();
      src.buffer = c.createBuffer(1, 1, 22050);
      src.connect(c.destination);
      src.start(0);
    } catch { /* best effort */ }
  };
  const beep = (d: string) => {
    const f = DTMF[d];
    if (f) playTones(f);
  };
  const press = (d: string) => {
    beep(d);
    if (!/[0-9]/.test(d) || num.length >= 6) return;
    num += d;
    syncDial();
  };
  /** Erase the last digit (owner ask). Softer, lower two-tone than a DTMF
   *  digit so an erase is audibly distinct from entering a number. */
  const backspace = () => {
    if (!num) return;
    playTones([420, 310], 105);
    num = num.slice(0, -1);
    syncDial();
  };
  const clearDial = () => { num = ""; syncDial(); };
  const demoDial = () => {
    if (demoT) return;
    num = "";
    syncDial();
    demoT = setInterval(() => {
      num += Math.floor(Math.random() * 10);
      beep(num.slice(-1));
      syncDial();
      if (num.length >= 6) {
        clearInterval(demoT!);
        demoT = null;
        // A demo number is random — almost never a real user, so the live
        // lookup would land on "not found" and disable CALL, making the demo
        // feel broken. Cancel that in-flight lookup and arm the button in
        // FALLBACK mode so the dial cinematic still plays end-to-end.
        lookupSeq++;
        lastLookedUp = num;
        dialTarget = FALLBACK;
        setPreview("");
        setCallState(true, `${t.call} ${num.slice(0, 3)}-${num.slice(3)}`, true);
      }
    }, 150);
  };

  /* ── loader ── */
  // FAILSAFE (v2.95.7 — owner-reported "loading page not moving" on .io): the
  // overlay covers the whole page, so it must NEVER be able to strand the
  // visitor. Three belts: (1) the 3D scene now boots AFTER the loader finishes
  // (a slow/software-WebGL machine compiling shaders used to stall rAF — the
  // bar visibly froze); (2) a setTimeout watchdog force-clears the overlay at
  // dur+1.6s even if rAF never ticks (background tab) or stalls; (3) any
  // exception inside a step force-clears it too.
  // v2.98.1: the bar FILL is a compositor CSS animation (lpFill, re-timed to
  // `dur` below) — rAF starvation can no longer pin the visible bar at 0%;
  // this loop only syncs the percent text, messages, and the lock.
  let loaderDone = false;
  const runLoader = (dur: number, msgs: LoaderMsg[], onDone?: () => void) => {
    const ov = $("loader");
    if (!ov || reduced) {
      if (ov) ov.style.display = "none";
      onDone?.();
      return;
    }
    if (ldT) cancelAnimationFrame(ldT);
    loaderDone = false;
    let lockOn: boolean | null = null;
    const finish = (instant: boolean) => {
      if (loaderDone) return;
      loaderDone = true;
      clearTimeout(watchdog);
      ov.style.opacity = "0";
      ov.style.pointerEvents = "none";
      if (instant) ov.style.display = "none";
      else setTimeout(() => { ov.style.display = "none"; }, 650);
      onDone?.();
    };
    // Watchdog fires even when rAF is throttled to zero (hidden tab) — timers
    // still tick there. dur+1600 leaves room for the normal fade path.
    const watchdog = setTimeout(() => finish(true), dur + 1600);
    ov.style.display = "flex";
    ov.style.pointerEvents = "auto";
    requestAnimationFrame(() => { ov.style.opacity = "1"; });
    const bar = $("loadBar"), strip = $("pctStrip"), msg = $("loadMsg"), sub = $("loadSub");
    // Re-time the compositor-driven fill + percent counter for THIS run (boot
    // 3400 / call 3000). ONE synchronous write each, then the compositor
    // animates them even if the main thread never yields another frame (the
    // v2.98.1/.2 frozen-at-0% fixes); the none→reflow→set dance restarts the
    // animations for the call cinematic.
    if (bar) {
      bar.style.animation = "none";
      void bar.offsetWidth;
      bar.style.animation = `lpFill ${dur}ms cubic-bezier(.25,.46,.45,.94) forwards`;
    }
    if (strip) {
      strip.style.animation = "none";
      void strip.offsetWidth;
      strip.style.animation = `lpPct ${dur}ms cubic-bezier(.25,.46,.45,.94) forwards`;
    }
    const t0 = performance.now();
    const step = () => {
      if (!alive) { clearTimeout(watchdog); return; }
      try {
        const p = Math.min(1, (performance.now() - t0) / dur);
        const e = 1 - Math.pow(1 - p, 2.1);
        // Bar + percent counter are CSS-animated (lpFill/lpPct above) — rAF
        // only keeps the staged messages and the lock in sync.
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
        else { setTimeout(() => { if (alive) finish(false); }, 260); }
      } catch {
        finish(true); // never strand the visitor behind the overlay
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
    // Gate: only proceed for a callable target — an ONLINE user, a party line,
    // or a lookup that couldn't resolve (let /i re-check). An offline user or an
    // unknown number is blocked here (the button is already disabled, but guard
    // the handler too in case of a race).
    if (!dialCallable) return;
    calling = true;
    const n = num, fmt = `${n.slice(0, 3)}-${n.slice(3)}`;
    const nb = $("nodeB");
    if (nb?.firstChild) nb.firstChild.nodeValue = fmt;
    runLoader(3000, t.callMsgs(fmt) as LoaderMsg[], () => {
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
    // A decorative rain does not need retina pixels, and on a phone the canvas
    // is the largest surface repainted every frame (v2.99.67). 1.5 → 1.0 on a
    // low-power device is a ~2.2x cut in pixels touched per frame.
    const dpr = Math.min(devicePixelRatio, lowPower ? 1 : 1.5);
    c.width = innerWidth * dpr;
    c.height = innerHeight * dpr;
    mctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    mctx.font = '13px "IBM Plex Mono",monospace';
    rainCols = [];
    const n = Math.ceil(innerWidth / (lowPower ? 26 : 18));
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
    // THE CHROME TINT IS THE MOST EXPENSIVE THING ON THIS PAGE (v2.99.67, owner:
    // "when I open this website from the phone, the phone is heating"). It used
    // to run every 3rd frame — 20 times a second — and each pass re-parses six
    // style strings and repaints two 1100px radial gradients plus three
    // box-shadows over most of the viewport. The hue it encodes drifts slowly
    // with scroll, so 20Hz bought nothing a human can see. Throttled by TIME
    // instead of frame count, which also makes the cost independent of the frame
    // rate: ~6 writes a second instead of 20, and identical output between them.
    const nowMs = performance.now();
    if (nowMs - lastTint >= TINT_MS) {
      lastTint = nowMs;
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
    raf = requestAnimationFrame(fxLoop);
    // Nothing to draw for a tab nobody is looking at. rAF is already throttled
    // when hidden, but not stopped on every browser, and this also covers the
    // window being fully occluded.
    if (typeof document !== "undefined" && document.hidden) return;
    const now = performance.now();
    if (now - lastFrame < FRAME_MS) return; // frame budget
    lastFrame = now;
    updateFx();
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

  /* ── three.js scene (dynamic import; page fully works without it) ──
     Booted AFTER the boot loader completes (v2.95.7): shader compilation +
     scene build on a slow GPU used to stall the main thread mid-loader. */
  let threeStarted = false;
  const lpDpr = () => Math.min(devicePixelRatio, innerWidth > 820 ? 1.8 : 1.25);
  const bootThree = async () => {
    // A phone does not get a WebGL scene (v2.99.67). It was the second uncapped
    // rAF loop on the page and the main reason the device got hot; the CSS
    // backdrop already carries the look, and the hue drift below still runs.
    if (reduced || threeStarted || lowPower) return;
    threeStarted = true;
    let T: typeof import("three");
    try {
      T = await import("three");
    } catch { return; }
    if (!alive) return;
    const c = $("canvas") as HTMLCanvasElement | null;
    if (!c) return;
    let rn: import("three").WebGLRenderer;
    try {
      rn = new T.WebGLRenderer({ canvas: c, antialias: innerWidth > 820, alpha: true });
    } catch { return; } // no WebGL — 2D fx still run
    renderer = rn;
    rn.setPixelRatio(lpDpr());
    rn.setSize(innerWidth, innerHeight, false);
    rn.setClearColor(0x000000, 0);
    const scene = new T.Scene();
    scene.fog = new T.FogExp2(0x0a0d10, 0.0085);
    const cam = new T.PerspectiveCamera(58, innerWidth / innerHeight, 0.1, 500);
    onResizeThree = () => {
      rn.setPixelRatio(lpDpr());
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
  // ROBUSTNESS (v2.99.24): wire EVERY interactive control FIRST — the keypad,
  // Clear, Call, AND the language toggle — and arm the dial state, BEFORE any
  // decorative / 3D / audio / boot code runs. Those extras can throw on a
  // stricter or older browser (WebGL/AudioContext/rAF quirks); if they threw
  // before the controls were wired, the page would render but nothing would be
  // clickable (the reported symptom). The critical controls now attach up front
  // and the rest is wrapped so a failure can NEVER disable them or leave the
  // full-screen loader stuck over the page eating taps.
  //
  // v2.99.35 — ONE DELEGATED listener on the host wrapper, not per-node
  // listeners. Per-node wiring died silently when React 19 re-applied
  // dangerouslySetInnerHTML on an unrelated re-render (a fresh {__html}
  // object identity each render — see the dsih memo in the shell below):
  // every child node was rebuilt ~0.5s after mount when the live-stats query
  // resolved, the wired nodes were discarded, and the whole landing went
  // dead — keypad, CALL, and the AR/EN toggle (the owner's exact report,
  // traced live with an instrumented innerHTML setter). The host wrapper is
  // React-owned and never replaced — only its CHILDREN are — so delegation
  // survives any innerHTML swap.
  const onHostClick = (e: Event) => {
    const target = e.target as HTMLElement | null;
    const el = target?.closest?.(
      "[data-lp-key],[data-lp='clearBtn'],[data-lp='demoBtn'],[data-lp='callBtn'],[data-lp='langBtn'],[data-lp='backBtn']",
    ) as HTMLElement | null;
    if (!el || !host.contains(el)) return;
    const key = el.dataset.lpKey;
    if (key) { press(key); return; }
    switch (el.dataset.lp) {
      case "clearBtn": clearDial(); break;
      case "demoBtn": demoDial(); break;
      case "callBtn": callNow(e); break;
      case "langBtn": opts.onToggleLang(); break;
      case "backBtn": backspace(); break;
    }
  };
  host.addEventListener("click", onHostClick);
  // Unlock the key tones on the first real gesture — pointerdown fires BEFORE
  // the click that plays the first tone, so even the very first keypress is
  // audible (iOS starts every AudioContext suspended).
  host.addEventListener("pointerdown", unlockAudio, { once: true, passive: true });
  syncDial();
  const dismissLoader = () => {
    const ov = $("loader");
    if (ov) { ov.style.opacity = "0"; ov.style.pointerEvents = "none"; ov.style.display = "none"; }
  };
  try {
    window.addEventListener("mousemove", onMove, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    onScroll();
    initReveals();
    initScramble();
    initMatrix();
  } catch (e) {
    // Decorative extras only — the controls above already work.
    console.warn("[landing] decorative init failed (controls still work):", e);
  }
  try {
    if (reduced || opts.skipBoot) {
      // Reduced motion, or a LANGUAGE SWITCH re-init (the boot cinematic only
      // plays once per visit): clear the overlay and go straight to content.
      dismissLoader();
      if (!reduced) {
        raf = requestAnimationFrame(fxLoop);
        void bootThree();
      }
    } else {
      raf = requestAnimationFrame(fxLoop);
      runLoader(3400, t.bootMsgs as LoaderMsg[], () => {
        replayHero();
        // Boot the 3D scene only now — its shader compile can't stall the loader.
        void bootThree();
      });
    }
  } catch (e) {
    // If boot/fx init throws before the loader was dismissed, the opaque
    // full-screen overlay would sit over the page and swallow every tap — force
    // it down so the (already-wired) controls are reachable.
    console.warn("[landing] boot/fx init failed:", e);
    dismissLoader();
  }

  return () => {
    alive = false;
    cancelAnimationFrame(raf);
    cancelAnimationFrame(threeRaf);
    cancelAnimationFrame(ldT);
    if (demoT) clearInterval(demoT);
    host.removeEventListener("click", onHostClick);
    host.removeEventListener("pointerdown", unlockAudio);
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
  "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&family=Noto+Kufi+Arabic:wght@400;500;600;700&display=swap";

export default function Home() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [lang, setLang] = useState<Lang>(() => initialLang());
  const bootedOnceRef = useRef(false);
  // ROOT-CAUSE FIX (v2.99.35, owner: "the dial pad… doesn't click; the Arabic
  // tab is not active"): React 19 re-applies dangerouslySetInnerHTML whenever
  // the {__html} OBJECT identity changes — even when the string inside is
  // byte-identical. An inline `{{ __html: html }}` made a fresh object every
  // render, so the first unrelated re-render (the live-stats query resolving
  // ~0.5s after mount) re-set innerHTML on the live DOM, REBUILDING every
  // node and silently discarding all of the engine's wiring (keypad, CALL,
  // langBtn) while the [lang]-keyed effect saw no reason to re-run. Traced
  // live with an instrumented innerHTML setter: identical string, new object,
  // full DOM replacement at t≈565ms. The {__html} object is memoized so its
  // identity only changes when the markup truly does — and the wiring effect
  // below keys on THIS object, so if the DOM is ever replaced again the
  // engine re-wires in the same commit. (Third belt: the engine's clicks ride
  // one DELEGATED listener on the never-replaced host wrapper.)
  const dsih = useMemo(
    () => ({ __html: markup(siteHost(), COPY[lang], lang === "ar") }),
    [lang],
  );

  // LIVE NETWORK stats (carried from the previous landing, owner ask): written
  // imperatively into the design's strip so the static markup stays one string.
  //
  // v2.99.71 — PUSHED. This used to poll every 30s with refetchOnWindowFocus OFF,
  // which meant a visitor could watch numbers half a minute stale and returning to
  // the tab did not refresh them (owner: "while I'm seeing the page, if somebody logs
  // in, it will automatically update — no need for me to refresh"). The hook opens
  // the shared public SSE feed and keeps a slow poll as a backstop; the sign-in
  // screen uses the SAME hook, so the two surfaces cannot disagree about freshness.
  const live = useLiveStats();
  // Public, rate-limited number→owner resolver for the hero dialer's live
  // preview (name + online state). utils.fetch is imperative — the landing
  // page is raw DOM, so the engine calls this as digits are entered.
  const utils = trpc.useUtils();
  useEffect(() => {
    const root = rootRef.current;
    const d = live;
    if (!root || !d) return;
    const put = (key: string, v: number | null | undefined) => {
      const el = root.querySelector<HTMLElement>(`[data-lp="stat-${key}"]`);
      if (el && typeof v === "number") el.textContent = v.toLocaleString("en-US");
    };
    put("users", d.registeredUsers);
    put("guests", d.guestsServed);
    put("parties", d.totalParties);
    put("messages", d.messagesSent);
    put("online", d.onlineNow);
    // Keyed on the whole snapshot: the feed only emits a frame when a number
    // actually CHANGED, so this re-runs exactly as often as there is something new
    // to write, and the markup itself stays one memoized string (v2.99.35).
  }, [live]);

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
    const stop = rootRef.current
      ? startLanding(rootRef.current, COPY[lang], {
          // The boot cinematic plays once per visit — not again on a language
          // switch (the engine re-inits over the freshly-rendered markup).
          skipBoot: bootedOnceRef.current,
          onToggleLang: () => {
            setLang((prev) => {
              const next: Lang = prev === "en" ? "ar" : "en";
              try { localStorage.setItem("relay_lang", next); } catch { /* private mode */ }
              return next;
            });
          },
          // QA H9: do NOT swallow a lookup ERROR into null here. `directory.lookup`
          // RESOLVES to null for a genuine not-a-user (→ "NO RELAY USER", CALL
          // off) and only REJECTS on a real failure (a shared-NAT rate-limit 429,
          // a transient 500). A `.catch(() => null)` turned every such error into
          // a false "NO RELAY USER" and disabled CALL for real online users. Let
          // the rejection reach runLookup's fail-open (FALLBACK → arm CALL → /i
          // re-resolves + gates), which is exactly what that .catch is there for.
          onLookup: (number: string) =>
            utils.directory.lookup
              .fetch({ number })
              .then((r) => (r as DialLookup | null) ?? null),
        })
      : undefined;
    bootedOnceRef.current = true;
    return () => {
      document.documentElement.style.scrollBehavior = prevBehavior;
      stop?.();
    };
    // Keyed on dsih (not just lang): the engine wires the exact DOM this
    // markup object produced — if React ever swaps that DOM, re-wire with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang, dsih]);

  return (
    // dir MUST live on `.lp-root` itself: the RTL layout + Arabic-font/sizing
    // rules are scoped to `.lp-root[dir="rtl"]` (see CSS). The inner markup also
    // stamps dir on its own `[data-lp="root"]`, but that is a CHILD of `.lp-root`
    // — so without this the `.lp-root[dir="rtl"]` selector never matched and the
    // Noto-Kufi-Arabic font/sizing never activated (Arabic rendered in the small
    // fallback system face). Binding it to `lang` here makes the toggle actually
    // switch the whole page to RTL + the correct Arabic font.
    <div className="lp-root" dir={lang === "ar" ? "rtl" : "ltr"}>
      <style>{CSS}</style>
      <div ref={rootRef} dangerouslySetInnerHTML={dsih} />
    </div>
  );
}
