import type { Entry } from "./types";

/**
 * Strings owned by the alert surfaces — the "while you were away" catch-up card, the
 * missed-call landing banner, and the notification bell with its panel.
 *
 * One module per surface; see `dict/index.ts` for why.
 *
 * ── THE VOCABULARY THIS SCREEN MUST KEEP APART ───────────────────────────────────────
 * Four pairs of English words mean genuinely different things here, and the failure
 * mode is not a missing translation — it is a translation that collapses a pair onto
 * one Arabic word, which nobody reviewing the English would notice because the English
 * still says two things:
 *
 *   DISMISS vs DECLINE. The banner's ✕ dismisses a notice and costs nothing; Decline
 *     REVOKES a pending session, which cannot be taken back — the other device has to
 *     start again. One Arabic word for both would put an irreversible act behind the
 *     word people learn means "close this". «إغلاق» vs «رفض».
 *
 *   NEW vs UNREAD. The catch-up card says "New message"; the bell row says "{n} unread
 *     message". They are not the same claim — a message can be unread without being
 *     new — and both spellings are on screen, so both are translated. «جديدة» vs
 *     «غير مقروءة».
 *
 *   MISSED CALL (فائتة) vs DECLINED (مرفوضة). `history.ts` already draws that line for
 *     the call log; this screen inherits it and must not blur it.
 *
 *   APPROVE here is the SAME button `auth.waitingHow` tells you to tap on your other
 *     device ("tap {approve}"). It has its own key rather than importing `auth.approve`
 *     — one module per surface, so an auth copy edit cannot silently reword the bell —
 *     but the two Arabic halves are asserted EQUAL in `alertsLocale.test.ts`, because an
 *     instruction that names a button by a word the button does not carry is worse than
 *     no instruction.
 *
 * ── WESTERN DIGITS, AND WHY THE RELATIVE STAMPS ARE ABBREVIATED ──────────────────────
 * Every number here is interpolated and stays Western (v2.106.84): a count beside an
 * Arabic-Indic numeral on the same line reads as a rendering fault.
 *
 * The "3m ago" family is abbreviated in Arabic too («منذ {n} د»), and that is a
 * translation decision rather than laziness. It matches the ENGLISH REGISTER, which is
 * itself abbreviated — and it sidesteps Arabic's counted-noun agreement, where the
 * correct noun form changes at 3 and again at 11 («3 دقائق» but «11 دقيقة»). An
 * abbreviation is correct for every n. Where a full noun is unavoidable (the counted
 * rows below) this follows the convention `groups.ts` already set: singular for one,
 * plural for many, which is right for 1–10 and reads acceptably above it. Said plainly
 * rather than claimed as perfect.
 *
 * ── "منذ" LEADS WHERE "ago" TRAILS ───────────────────────────────────────────────────
 * The same reordering `dialer.ago` records: Arabic puts the preposition BEFORE the
 * duration while English puts the word after it. Substitution is by NAME, so the two
 * halves may place `{n}` differently — and must.
 */
export const ALERTS = {
  // ── The catch-up card ──
  "alerts.awayTitle": { en: "While you were away", ar: "أثناء غيابك" },
  /* DISMISS, not decline — see the header. The banner's ✕ costs nothing. */
  "alerts.dismiss": { en: "Dismiss", ar: "إغلاق" },

  // ── Missed calls ──
  /* The card's heading carries NO number when there is one call ("Missed call"); the
     bell's row always carries it ("1 missed call"). Two spellings on screen, two keys. */
  "alerts.missedOne": { en: "Missed call", ar: "مكالمة فائتة" },
  "alerts.missedMany": { en: "{n} missed calls", ar: "{n} مكالمات فائتة" },
  "alerts.missedRegion": { en: "Missed calls", ar: "المكالمات الفائتة" },
  "alerts.missedRowOne": { en: "{n} missed call", ar: "{n} مكالمة فائتة" },
  /* A trailing fragment appended after "Name · 777-777". Arabic joins the conjunction
     to the number without a space («و2»), which is how the language writes it. */
  "alerts.andOthersOne": { en: "and {n} other", ar: "و{n} آخر" },
  "alerts.andOthersMany": { en: "and {n} others", ar: "و{n} آخرين" },
  "alerts.viewMissedOne": { en: "View missed call", ar: "عرض المكالمة الفائتة" },
  "alerts.viewMissedMany": { en: "View missed calls", ar: "عرض المكالمات الفائتة" },
  "alerts.tapHistory": { en: "Tap to review in History", ar: "اضغط للمراجعة في السجل" },

  // ── Unread messages: NEW (the card) and UNREAD (the bell) are different claims ──
  "alerts.newMessageOne": { en: "New message", ar: "رسالة جديدة" },
  "alerts.newMessageMany": { en: "{n} new messages", ar: "{n} رسائل جديدة" },
  "alerts.unreadRowOne": { en: "{n} unread message", ar: "{n} رسالة غير مقروءة" },
  "alerts.unreadRowMany": { en: "{n} unread messages", ar: "{n} رسائل غير مقروءة" },
  "alerts.tapMessages": { en: "Tap to open Messages", ar: "اضغط لفتح الرسائل" },

  // ── Relative stamps (see the header for why these are abbreviated) ──
  "alerts.justNow": { en: "just now", ar: "الآن" },
  "alerts.minutesAgo": { en: "{n}m ago", ar: "منذ {n} د" },
  "alerts.hoursAgo": { en: "{n}h ago", ar: "منذ {n} س" },
  "alerts.daysAgo": { en: "{n}d ago", ar: "منذ {n} ي" },

  // ── The bell and its panel ──
  "alerts.notifications": { en: "Notifications", ar: "الإشعارات" },
  "alerts.notificationsOne": { en: "{n} notification", ar: "{n} إشعار" },
  "alerts.notificationsMany": { en: "{n} notifications", ar: "{n} إشعارات" },
  "alerts.notificationsDnd": {
    en: "Notifications (Do Not Disturb is on)",
    ar: "الإشعارات (وضع عدم الإزعاج مُفعّل)",
  },
  "alerts.dnd": { en: "Do Not Disturb", ar: "عدم الإزعاج" },
  "alerts.dndToggle": { en: "Toggle Do Not Disturb", ar: "تبديل وضع عدم الإزعاج" },
  "alerts.dndOn": { en: "Rings and chimes are silenced", ar: "الرنين والتنبيهات مكتومة" },
  "alerts.dndOff": { en: "Calls ring normally", ar: "المكالمات ترن بشكل طبيعي" },

  // ── The empty state (board 5h): it names what LANDS here, not just that there is
  //    nothing — an empty panel that does not say what it is for reads as broken. ──
  "alerts.allCaughtUp": { en: "All caught up", ar: "لا شيء جديد" },
  /* The verb LEADS in Arabic, so `{...}` ordering differs from the English clause
     order. Safe because substitution is by name — there is nothing positional here. */
  "alerts.emptyHint": {
    en: "Missed calls, messages and sign-ins land here",
    ar: "تصل هنا المكالمات الفائتة والرسائل وطلبات تسجيل الدخول",
  },

  // ── A waiting new-device sign-in ──
  "alerts.newDeviceSignIn": { en: "New device sign-in", ar: "تسجيل دخول من جهاز جديد" },
  "alerts.devicesWaitingOne": { en: "{n} new device waiting", ar: "{n} جهاز جديد بالانتظار" },
  "alerts.devicesWaitingMany": { en: "{n} new devices waiting", ar: "{n} أجهزة جديدة بالانتظار" },
  "alerts.approveOrDecline": {
    en: "Approve or decline the sign-in",
    ar: "وافق على تسجيل الدخول أو ارفضه",
  },
  "alerts.approve": { en: "Approve", ar: "موافقة" },
  /* DECLINE, not dismiss — this revokes the pending session and cannot be undone. */
  "alerts.decline": { en: "Decline", ar: "رفض" },
  "alerts.notYouDecline": {
    en: "If this wasn't you, decline it.",
    ar: "إذا لم تكن أنت، فارفضه.",
  },
} as const satisfies Record<string, Entry>;
