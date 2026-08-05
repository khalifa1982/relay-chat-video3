import type { Entry } from "./types";

/**
 * Strings owned by the CALL ENGINE'S REACT SURFACE (`app/RelayEngine.tsx`) — the
 * chrome this app draws AROUND the imperative engine: the in-call Minimize/Fit
 * cluster, the draggable mini window, the auto-rejoin overlay, and the host's
 * "someone wants back into this call" prompt.
 *
 * One module per surface — see `dict/index.ts` for why.
 *
 * ── WHAT IS DELIBERATELY NOT HERE ────────────────────────────────────────────────
 * The engine ITSELF (`lib/relayClient.ts` + `lib/relayAssets.ts`) writes raw DOM from
 * plain functions, so it cannot call a hook and none of its copy is reachable from
 * this dictionary. That is a real remaining gap, not an oversight — see the header of
 * `RelayEngine.tsx`.
 *
 * ── THREE DISTINCTIONS THAT MUST SURVIVE TRANSLATION ─────────────────────────────
 * These are the ones a single careless Arabic word would collapse, and each collapse
 * would leave a control that lies about what it does:
 *
 *  1. END ≠ EXIT. `engine.endCall` hangs up a call you are ON; `engine.exitCall`
 *     refuses an auto-rejoin to a call you were DROPPED from — at that moment there is
 *     no live call to end. «إنهاء المكالمة» vs «الخروج من المكالمة».
 *
 *  2. MINIMIZE ≠ MAXIMIZE ≠ FIT. Three display verbs on two adjacent controls.
 *     «تصغير» / «تكبير» / «ملاءمة». The trap is rendering "Fit screen" as «تكبير
 *     الشاشة», which would make Fit and Maximize the same word on one screen.
 *
 *  3. RECONNECTING (us, automatically) ≠ REJOIN REQUEST (them, needing approval).
 *     Two different actors; the first is a status, the second is a decision.
 *
 * ── GENDER, WHICH ARABIC FORCES A DECISION ABOUT ─────────────────────────────────
 * `engine.knockWants` renders directly beneath a person's NAME, whose gender we do not
 * know, and every Arabic verb would pick one («يريد» / «تريد»). So the Arabic is a
 * VERBAL NOUN — «طلب العودة إلى المكالمة», "a request to rejoin the call" — which reads
 * naturally as a caption and commits to no gender. `engine.knockLabel` CAN use a verb,
 * because its subject there is «شخص ما» ("someone"), which is grammatically masculine
 * whoever the person turns out to be.
 */
export const ENGINE = {
  // ── Fullscreen in-call cluster (Minimize + Fit) ──
  "engine.minimize": { en: "Minimize", ar: "تصغير" },
  "engine.minimizeLabel": {
    en: "Minimize the call to a floating window",
    ar: "تصغير المكالمة إلى نافذة عائمة",
  },
  "engine.minimizeHint": {
    en: "Minimize — keep the call in a small window while you use the app",
    ar: "تصغير — أبقِ المكالمة في نافذة صغيرة أثناء استخدامك للتطبيق",
  },
  "engine.fit": { en: "Fit", ar: "ملاءمة" },
  "engine.fitLabel": {
    en: "Fit the whole video on screen",
    ar: "إظهار الفيديو كاملًا على الشاشة",
  },
  /* The two halves of one toggle: what it is doing now, and what tapping would do. */
  "engine.fitOnHint": {
    en: "Fit: showing the whole frame (tap for fill)",
    ar: "الملاءمة مفعّلة: تظهر الصورة كاملة (اضغط للتعبئة)",
  },
  "engine.fitOffHint": {
    en: "Fit screen — show the whole video, no cropping",
    ar: "ملاءمة الشاشة — أظهر الفيديو كاملًا بلا اقتصاص",
  },

  // ── The minimized mini window ──
  "engine.maximize": { en: "Maximize", ar: "تكبير" },
  // v2.107.47 (owner) — the tiny floating call bubble state.
  "engine.bubble": { en: "Bubble", ar: "فقاعة" },
  "engine.bubbleLabel": { en: "Shrink call to a floating bubble", ar: "تصغير المكالمة إلى فقاعة عائمة" },
  "engine.restoreCall": { en: "Restore call", ar: "استعادة المكالمة" },
  "engine.maximizeLabel": {
    en: "Maximize the call back to full screen",
    ar: "إعادة المكالمة إلى ملء الشاشة",
  },
  /* ONE key for both the `aria-label` and the `title` of the mini window's hang-up.
     They said "End the call" and "End call" — a distinction with no meaning, and the
     shorter spelling is the one v2.96.3 REMOVED from a duplicate floating pill, so
     leaving it out of the source keeps that removal legible. */
  "engine.endCall": { en: "End the call", ar: "إنهاء المكالمة" },

  // ── Auto-rejoin overlay (after a reload / crash / accidental close) ──
  "engine.reconnectingLabel": {
    en: "Reconnecting to your call",
    ar: "إعادة الاتصال بمكالمتك",
  },
  "engine.reconnecting": {
    en: "Reconnecting to your call…",
    ar: "جارٍ إعادة الاتصال بمكالمتك…",
  },
  "engine.reconnectingBody": {
    en: "You were in an active call. We're rejoining you automatically.",
    ar: "كنت في مكالمة جارية. سنعيد انضمامك إليها تلقائيًا.",
  },
  /* NOT «إنهاء المكالمة» — see distinction 1 in the header. There is no live call to
     end here; this declines the reconnection. */
  "engine.exitCall": { en: "Exit the call", ar: "الخروج من المكالمة" },

  // ── Host prompt: somebody who was in this call wants back in (v2.99.9) ──
  "engine.knockLabel": {
    en: "Someone wants to rejoin the call",
    ar: "شخص ما يطلب العودة إلى المكالمة",
  },
  "engine.knockSomeone": { en: "Someone", ar: "شخص ما" },
  "engine.knockWants": {
    en: "wants to rejoin the call",
    ar: "طلب العودة إلى المكالمة",
  },
  /* Kept separate from `auth.approve` on purpose, though both are «موافقة» today:
     admitting a PERSON to a live call and approving a DEVICE sign-in are different
     acts on different screens, and one shared key means a copy edit to either one
     silently rewrites the other. */
  "engine.approve": { en: "Approve", ar: "موافقة" },
  "engine.decline": { en: "Decline", ar: "رفض" },
} as const satisfies Record<string, Entry>;
