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
 * ── …AND WHY A ROW STILL SAYS "واردة" ──
 * `history.incoming` DOES use the plain direction word, and that is not a
 * contradiction. It is rendered only on a CONFERENCE row — a call that connected and
 * has a duration printed beside it — so there is nothing for it to be confused with;
 * a missed call is a SoloItem and shows "مكالمة فائتة" instead. The overlap the tab
 * label had to avoid is between two TABS, and that tab still says "مُجابة".
 *
 * ── THE FILTER LABELS ARE KEYS ──
 * `FILTERS` is a module-level constant and a constant cannot call a hook, so each
 * entry carries a key the tab strip translates. `dayBucket` and `groupTitleOf` are the
 * same shape one step along: pure module-level functions that RETURN a key, with their
 * English derived from that key so the two halves cannot drift apart.
 *
 * ── THE COUNTS ARE BANDED ──
 * "{n} calls in this log" cannot be one string with a number dropped in: English needs
 * one/other, Arabic needs the dual at 2 (no numeral at all), the plural genitive at
 * 3-10 and the singular accusative at 11+. A whole key per band, the shape
 * `guestExpiryKey` established.
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
  "history.title": { en: "Call history", ar: "سجل المكالمات" },
  "history.loading": { en: "Loading…", ar: "جارٍ التحميل…" },
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
  /* The sentence the ALL tab really shows. The entry used to carry a shorter one that
     no render site ever referenced — it only looked wired because `history.noneMissed`
     contains it as a substring — so this is the key catching up with the screen rather
     than a copy change. */
  "history.none": {
    en: "No calls yet. Your conference and call history will appear here — who you dialed, how many people joined, their names and numbers, and how long the call lasted.",
    ar: "لا مكالمات بعد. سيظهر هنا سجل مكالماتك ومؤتمراتك — من اتصلت به، وكم شخصًا انضم، وأسماؤهم وأرقامهم، وكم استغرقت المكالمة.",
  },
  "history.noMatches": {
    en: "No calls match “{query}”.",
    ar: "لا مكالمات تطابق “{query}”.",
  },
  "history.loadOlder": { en: "Load older calls", ar: "تحميل المكالمات الأقدم" },
  "history.loadingOlder": { en: "Loading older calls…", ar: "جارٍ تحميل المكالمات الأقدم…" },
  "history.thatsAll": { en: "That's the whole call log.", ar: "هذا هو سجل المكالمات بالكامل." },
  "history.openFailed": { en: "Couldn't open that conversation.", ar: "تعذّر فتح هذه المحادثة." },
  "history.watchFailed": { en: "Couldn't set the alert.", ar: "تعذّر ضبط التنبيه." },
  "history.addFailed": { en: "Couldn't add the contact.", ar: "تعذّرت إضافة جهة الاتصال." },
  /* Arabic leads with the verb, so `{name}` lands in a different place than in English.
     Safe because `translate` substitutes by NAME rather than by position. */
  "history.watchSet": {
    en: "You'll be alerted when {name} is back online.",
    ar: "سننبّهك عند عودة {name} للاتصال.",
  },

  // ── Day dividers ──
  "history.today": { en: "Today", ar: "اليوم" },
  "history.yesterday": { en: "Yesterday", ar: "أمس" },

  /* ── Counts (banded — see the header note) ── */
  "history.callCountOne": { en: "1 call in this log", ar: "مكالمة واحدة في هذا السجل" },
  "history.callCountTwo": { en: "2 calls in this log", ar: "مكالمتان في هذا السجل" },
  "history.callCountFew": { en: "{count} calls in this log", ar: "{count} مكالمات في هذا السجل" },
  "history.callCountMany": { en: "{count} calls in this log", ar: "{count} مكالمة في هذا السجل" },
  "history.missedCountOne": { en: "1 missed", ar: "فائتة واحدة" },
  "history.missedCountTwo": { en: "2 missed", ar: "فائتتان" },
  "history.missedCountFew": { en: "{count} missed", ar: "{count} فائتات" },
  "history.missedCountMany": { en: "{count} missed", ar: "{count} فائتة" },
  /* "loaded" says how far the reach extends — the honest companion to a count that is
     deliberately "in this log" and never a lifetime total. */
  "history.loadedCountOne": {
    en: "1 call loaded · search and grouping cover these",
    ar: "مكالمة واحدة محمّلة · البحث والتجميع يغطيانها",
  },
  "history.loadedCountTwo": {
    en: "2 calls loaded · search and grouping cover these",
    ar: "مكالمتان محمّلتان · البحث والتجميع يغطيانها",
  },
  "history.loadedCountFew": {
    en: "{count} calls loaded · search and grouping cover these",
    ar: "{count} مكالمات محمّلة · البحث والتجميع يغطيانها",
  },
  "history.loadedCountMany": {
    en: "{count} calls loaded · search and grouping cover these",
    ar: "{count} مكالمة محمّلة · البحث والتجميع يغطيانها",
  },

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

  /* ── Row titles ──
     A group call, a party line and a bare fallback each get a whole sentence rather
     than a stem plus a suffix: "(party line)" tacked onto a title is a fragment no
     language but English can be relied on to place there. */
  "history.groupOf": { en: "Group · {count}", ar: "مجموعة · {count}" },
  "history.partyLineNamed": { en: "{title} (party line)", ar: "{title} (خط جماعي)" },
  "history.lineNamed": { en: "Line {number}", ar: "خط {number}" },
  "history.callTo": { en: "Call to {number}", ar: "مكالمة إلى {number}" },
  "history.call": { en: "Call", ar: "مكالمة" },

  // ── Row direction + media (a conference row only; see the header note on "واردة") ──
  "history.outgoing": { en: "Outgoing", ar: "صادرة" },
  "history.incoming": { en: "Incoming", ar: "واردة" },
  "history.voice": { en: "Voice", ar: "صوتية" },
  "history.video": { en: "Video", ar: "فيديو" },

  /* ── Screen-reader row labels ──
     One key per direction rather than a shared sentence with the direction word
     substituted in: nesting a translated word inside another translated sentence is
     the seam that stops Arabic ordering either of them freely. */
  "history.confRowOut": {
    en: "Outgoing call with {title}, {duration} duration",
    ar: "مكالمة صادرة مع {title}، مدتها {duration}",
  },
  "history.confRowIn": {
    en: "Incoming call with {title}, {duration} duration",
    ar: "مكالمة واردة مع {title}، مدتها {duration}",
  },
  /* NOTE — there is deliberately no key for the solo row's "{label} — {name}" or the
     roster chip's "{name} ({number})". Both are pure punctuation around values that are
     ALREADY localised where they are produced, so a key would have identical halves —
     which the differ-halves guard correctly reads as English pasted into the Arabic
     side, and which would be ceremony rather than a translation either way. They are
     composed at the render site. */

  // ── Live-call rejoin card ──
  "history.liveNow": { en: "Live now", ar: "مباشر الآن" },
  "history.join": { en: "Join", ar: "انضمام" },
  "history.knocked": {
    en: "Asked the host to let you in…",
    ar: "طلبنا من المضيف السماح لك بالدخول…",
  },
  "history.hostedBy": { en: "hosted by {name}", ar: "يستضيفها {name}" },
  "history.inCallCountOne": { en: "1 in the call", ar: "شخص واحد في المكالمة" },
  "history.inCallCountTwo": { en: "2 in the call", ar: "شخصان في المكالمة" },
  "history.inCallCountFew": { en: "{count} in the call", ar: "{count} أشخاص في المكالمة" },
  "history.inCallCountMany": { en: "{count} in the call", ar: "{count} شخصًا في المكالمة" },

  // ── Row outcome labels ──
  "history.declined": { en: "Declined", ar: "مرفوضة" },
  "history.missedCall": { en: "Missed call", ar: "مكالمة فائتة" },
  "history.declinedByThem": { en: "Declined by them", ar: "رفضوا المكالمة" },
  "history.failed": { en: "Failed", ar: "فشلت" },
  "history.noAnswer": { en: "No answer", ar: "لا إجابة" },
  "history.unknown": { en: "Unknown", ar: "غير معروف" },
} as const satisfies Record<string, Entry>;
