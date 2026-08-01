/**
 * Strings owned by the call History screen.
 *
 * ── "RECEIVED" MEANS ANSWERED, AND THE ARABIC HAD TO PICK A SIDE ──
 * v2.99.98 established that a Received row is a call that came in AND was
 * answered — it is provably disjoint from Missed. The obvious Arabic for
 * "received" is "واردة" (incoming), which is exactly the word that would make the
 * tab overlap Missed, since a missed call is also incoming. So it is "مُجابة"
 * (answered): the label follows the DEFINITION rather than the English word, which
 * is the whole reason a dictionary keys on meaning rather than on text.
 *
 * ── THE FILTER LABELS ARE KEYS ──
 * `FILTERS` is a module-level constant and a constant cannot call a hook, so each
 * entry carries a key the tab strip translates.
 *
 * See ./auth.ts for the Western-digits rule, which holds here: every count in this
 * screen is interpolated.
 */
import type { Entry } from "./types";

export const HISTORY = {
  // ── Filter tabs ──
  "history.all": { en: "All", ar: "الكل" },
  "history.dialed": { en: "Dialed", ar: "صادرة" },
  "history.received": { en: "Received", ar: "مُجابة" },
  "history.missed": { en: "Missed", ar: "فائتة" },

  // ── Chrome ──
  "history.search": { en: "Search calls by name or number", ar: "ابحث في المكالمات بالاسم أو الرقم" },
  "history.searchLabel": { en: "Search calls", ar: "بحث في المكالمات" },
  "history.filter": { en: "Filter calls", ar: "تصفية المكالمات" },
  "history.group": { en: "Group", ar: "تجميع" },
  "history.groupOn": {
    en: "Showing one row per person — tap to list every call separately",
    ar: "عرض صف واحد لكل شخص — اضغط لعرض كل مكالمة على حدة",
  },
  "history.groupOff": {
    en: "Group repeated calls from the same person into one row",
    ar: "اجمع المكالمات المتكررة من الشخص نفسه في صف واحد",
  },

  // ── Clear history ──
  "history.clear": { en: "Clear history", ar: "مسح السجل" },
  "history.clearTitle": {
    en: "Clear your entire call history?",
    ar: "مسح سجل مكالماتك بالكامل؟",
  },
  "history.clearHint": { en: "Clear your call history", ar: "امسح سجل مكالماتك" },
  /* The other party KEEPS their own log — that is the honest half of the promise
     and the sentence exists to say so, so the Arabic says it too. */
  "history.clearBody": {
    en: "This clears the log on your side only. The other person keeps their own record of these calls. This can't be undone.",
    ar: "هذا يمسح السجل من جهتك فقط. يحتفظ الطرف الآخر بسجله الخاص لهذه المكالمات. لا يمكن التراجع عن ذلك.",
  },

  // ── Empty + error states (one answer per filter, never one for all four) ──
  "history.loadFailed": { en: "Couldn't load your call history.", ar: "تعذّر تحميل سجل مكالماتك." },
  "history.loadOlderFailed": {
    en: "Couldn't load older calls — try again.",
    ar: "تعذّر تحميل المكالمات الأقدم — أعد المحاولة.",
  },
  "history.clearFailed": {
    en: "Couldn't clear your history — try again.",
    ar: "تعذّر مسح سجلك — أعد المحاولة.",
  },
  "history.noneMissed": { en: "No missed calls. 🎉", ar: "لا مكالمات فائتة. 🎉" },
  "history.noneDialed": {
    en: "No dialed calls yet — call someone from the keypad.",
    ar: "لا مكالمات صادرة بعد — اتصل بأحدهم من لوحة الأرقام.",
  },
  "history.noneReceived": {
    en: "No answered incoming calls yet.",
    ar: "لا مكالمات واردة مُجابة بعد.",
  },
  "history.none": {
    en: "No calls yet. Dial a number to start your first call.",
    ar: "لا مكالمات بعد. اطلب رقمًا لبدء مكالمتك الأولى.",
  },
  "history.loadOlder": { en: "Load older calls", ar: "تحميل المكالمات الأقدم" },
  "history.loadingOlder": { en: "Loading older calls…", ar: "جارٍ تحميل المكالمات الأقدم…" },

  // ── Presence tooltips on a row ──
  "history.presence.onCall": {
    en: "On a call right now — you'd ring as call waiting",
    ar: "في مكالمة الآن — سيصلهم اتصالك كمكالمة منتظرة",
  },
  "history.presence.online": { en: "Online now", ar: "متصل الآن" },
  "history.presence.away": {
    en: "Signed in but not looking — the app is in the background",
    ar: "مسجّل الدخول لكنه غير منتبه — التطبيق في الخلفية",
  },
  "history.presence.offline": {
    en: "Offline — calling will page their phone",
    ar: "غير متصل — الاتصال سينبّه هاتفه",
  },

  // ── Row actions ──
  "history.addToContacts": { en: "Add to contacts", ar: "أضف إلى جهات الاتصال" },
  "history.added": { en: "Added to your contacts.", ar: "تمت الإضافة إلى جهات اتصالك." },
  "history.message": { en: "Message", ar: "رسالة" },
  "history.videoCall": { en: "Video call", ar: "مكالمة فيديو" },
  "history.callBack": { en: "Call back", ar: "معاودة الاتصال" },
  "history.callGroupBack": { en: "Call the group back", ar: "معاودة الاتصال بالمجموعة" },
  "history.callEveryoneBack": {
    en: "Call everyone back (group)",
    ar: "معاودة الاتصال بالجميع (مجموعة)",
  },
  "history.alertWhenBack": {
    en: "Alert me when they're back online",
    ar: "نبّهني عند عودتهم للاتصال",
  },

  // ── Row outcome labels ──
  "history.declined": { en: "Declined", ar: "مرفوضة" },
  "history.missedCall": { en: "Missed call", ar: "مكالمة فائتة" },
  "history.declinedByThem": { en: "Declined by them", ar: "رفضوا المكالمة" },
  "history.failed": { en: "Failed", ar: "فشلت" },
  "history.noAnswer": { en: "No answer", ar: "لا إجابة" },
  "history.unknown": { en: "Unknown", ar: "غير معروف" },
} as const satisfies Record<string, Entry>;
