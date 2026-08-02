/**
 * Strings owned by the dialer surface, plus the PRESENCE vocabulary.
 *
 * ── WHY PRESENCE LIVES HERE AND IS KEYED RATHER THAN MAPPED ───────────────────
 * `peerStatus` / `peerPresenceLines` are pure functions shared by the Dialer, the
 * profile popup, Contacts and History, and they return finished English strings.
 * The tempting way to translate their output is a `text → key` lookup at each
 * render site, and that is precisely what this dictionary's own rule forbids: a
 * copy edit to the English would silently drop the translation, and two states
 * that happen to share a word would be forced to share an Arabic one. So the
 * functions return a KEY alongside the text, and the text stays for the surfaces
 * the sweep has not reached yet.
 *
 * See ./auth.ts for the Western-digits and imperative-verb rules, which hold here
 * too.
 */
import type { Entry } from "./types";

export const DIALER = {
  // ── Presence (the shared vocabulary — four states, one word each) ──
  "presence.onCall": { en: "on a call", ar: "في مكالمة" },
  "presence.online": { en: "online now", ar: "متصل الآن" },
  "presence.away": { en: "away", ar: "بعيد" },
  "presence.travelling": { en: "travelling ✈️", ar: "مسافر ✈️" },
  "presence.offline": { en: "offline", ar: "غير متصل" },

  // ── The keypad card ──
  "dialer.myNumber": { en: "MY NUMBER", ar: "رقمي" },
  "dialer.shareInvite": { en: "Share invite link", ar: "شارك رابط الدعوة" },
  "dialer.inviteCopied": { en: "Invite link copied", ar: "تم نسخ رابط الدعوة" },
  "dialer.copyFailed": { en: "Couldn't copy the link", ar: "تعذّر نسخ الرابط" },
  "dialer.lookingUp": { en: "Looking up…", ar: "جارٍ البحث…" },
  "dialer.partyLine": {
    en: "Party line · {count} on the line",
    ar: "خط جماعي · {count} على الخط",
  },
  "dialer.erase": { en: "Erase", ar: "مسح" },
  "dialer.eraseLast": { en: "Erase last digit", ar: "امسح آخر رقم" },
  "dialer.addToContacts": { en: "Add to contacts", ar: "أضف إلى جهات الاتصال" },
  "dialer.savedToContacts": { en: "Saved to your contacts.", ar: "تم الحفظ في جهات اتصالك." },

  // ── The three call actions ──
  "dialer.voiceCall": { en: "Voice Call", ar: "مكالمة صوتية" },
  "dialer.voiceCallHint": {
    en: "Voice call (camera off)",
    ar: "مكالمة صوتية (الكاميرا مغلقة)",
  },
  "dialer.videoCall": { en: "Video Call", ar: "مكالمة فيديو" },
  "dialer.groupCall": { en: "Group Call", ar: "مكالمة جماعية" },
  "dialer.join": { en: "Join", ar: "انضم" },
  "dialer.joinPartyLine": { en: "Join the party line", ar: "انضم إلى الخط الجماعي" },
  "dialer.joinPartyLineHint": {
    en: "Join the party line (camera off)",
    ar: "انضم إلى الخط الجماعي (الكاميرا مغلقة)",
  },

  // ── Recents + missed ──
  "dialer.recent": { en: "Recent", ar: "الأخيرة" },
  "dialer.loading": { en: "Loading…", ar: "جارٍ التحميل…" },
  "dialer.noCalls": {
    en: "No calls yet. Dial a number to start your first call.",
    ar: "لا مكالمات بعد. اطلب رقمًا لبدء مكالمتك الأولى.",
  },
  "dialer.callBack": { en: "Call back", ar: "معاودة الاتصال" },
  "dialer.callBackVoice": { en: "Call back (voice)", ar: "معاودة الاتصال (صوت)" },
  "dialer.missedCall": { en: "Missed Call", ar: "مكالمة فائتة" },
  "dialer.missedCalls": { en: "{count} Missed Calls", ar: "{count} مكالمات فائتة" },
  "dialer.from": { en: "from", ar: "من" },
  "dialer.dismiss": { en: "Dismiss", ar: "إغلاق" },

  /* "2d 4h ago" — the elapsed figure is LTR + bidi-isolated at the render site, so
     only the surrounding word is translated. The placeholder carries the whole
     duration rather than being split, because Arabic puts "منذ" BEFORE it while
     English puts "ago" after — a fragment-joined version cannot express both. */
  "dialer.ago": { en: "{elapsed} ago", ar: "منذ {elapsed}" },
  "dialer.noSuchUser": {
    en: "No RELAY user with this number",
    ar: "لا يوجد مستخدم RELAY بهذا الرقم",
  },
} as const satisfies Record<string, Entry>;
