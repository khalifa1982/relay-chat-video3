/**
 * Strings owned by the dialer surface, plus the PRESENCE vocabulary.
 *
 * ── WHY PRESENCE LIVES HERE AND IS KEYED RATHER THAN MAPPED ───────────────────
 * `peerPresenceLines` is a pure function shared by the Dialer, the
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
  /* NO `presence.travelling`. Its only reader was `peerStatus`, deleted in
     v2.106.97 as dead code, and its lowercase form belonged to that function's
     register — a phrase sitting alongside "online now" / "away" / "offline".
     `peerPresenceLines` reports a travelling peer as OFFLINE and puts the
     travelling-ness on its own chip, which is a standalone LABEL and is
     capitalised; those two keys are below. */
  "presence.offline": { en: "offline", ar: "غير متصل" },

  /* The status the person PICKED, rendered as its own chip rather than folded
     into the presence line. Capitalised because it is a label, not a phrase. */
  "dialer.chosenTravelling": { en: "Travelling ✈️", ar: "مسافر ✈️" },
  "dialer.chosenAway": { en: "Away", ar: "بعيد" },

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

  /* A HELD number (v2.107.x): an admin-reserved vanity pattern (000000, 121212, …)
     or a tombstoned number — real in the reservation ledger, but nobody's, and not
     assignable. It reads DIFFERENTLY from both a person and the "no RELAY user" blank.
     ONE KEY FOR THE WHOLE SENTENCE with two placeholders, rendered via `tn` so the two
     coloured words are React spans while the connective ("by" / "من قبل") stays inside
     the string and keeps each language's own word order — the exact case the fragment
     rule (see ./auth.ts) exists for. Owner: the word Reserved in red, admin in yellow. */
  "dialer.reservedByAdmin": {
    en: "{reserved} by {admin}",
    ar: "{reserved} من قبل {admin}",
  },
  "dialer.reservedWord": { en: "Reserved", ar: "محجوز" },
  "dialer.reservedAdmin": { en: "admin", ar: "مشرف" },

  /* ── The missed-call banner ──────────────────────────────────────────────────
     ONE KEY FOR THE WHOLE SENTENCE, not `from` + a name + `— tap to see all`.
     `dialer.from` exists for the fragment and is deliberately NOT used: a sentence
     assembled from pieces cannot be translated, only re-assembled into nonsense,
     because Arabic does not put the same words in the same order. The bolded name
     and the optional `· 777 777` ride as PLACEHOLDERS through `tn`, so the
     translator decides where they go. */
  "dialer.missedFromTap": {
    en: "from {name}{num} — tap to see all",
    ar: "من {name}{num} — انقر لعرض الكل",
  },

  // ── The dial readout's own sub-line ──
  "dialer.enterNumber": {
    en: "Enter a 6-digit RELAY number",
    ar: "أدخل رقم RELAY المكوّن من 6 أرقام",
  },

  /* HOW MANY DIGITS ARE LEFT — FOUR KEYS, NOT ONE STRING WITH AN `s` ON IT.
     `${n} more digit${n === 1 ? "" : "s"}` is a sentence built from a fragment and
     cannot be translated at all: English needs one/other, Arabic needs a singular,
     a DUAL («رقمان»), a plural of paucity for 3–10 («أرقام») and the singular
     accusative from 11 up («رقمًا»). `moreDigitsKey` in Dialer.tsx picks a WHOLE key
     per band. Two of these share an English half, which is fine — the dictionary's
     uniqueness rule is about KEYS (the same shape as `peer.guestExpires*`).
     Western digits, as everywhere: the count sits beside a 6-digit RELAY number. */
  "dialer.moreDigitsOne": { en: "1 more digit", ar: "رقم واحد آخر" },
  "dialer.moreDigitsTwo": { en: "2 more digits", ar: "رقمان آخران" },
  "dialer.moreDigitsFew": { en: "{count} more digits", ar: "{count} أرقام أخرى" },
  "dialer.moreDigitsMany": { en: "{count} more digits", ar: "{count} رقمًا آخر" },

  // ── The three call actions' hover copy ──
  "dialer.notOnRelay": {
    en: "That number isn't on RELAY",
    ar: "هذا الرقم غير مسجَّل على RELAY",
  },
  "dialer.groupCallHint": {
    en: "Group call — ring up to 10 people into one room",
    ar: "مكالمة جماعية — اتصل بما يصل إلى 10 أشخاص في غرفة واحدة",
  },

  // ── Quick-add ──
  "dialer.addNumberToContacts": {
    en: "Add {number} to your contacts",
    ar: "أضف {number} إلى جهات اتصالك",
  },
  "dialer.saveFailed": { en: "Couldn't save the contact.", ar: "تعذّر حفظ جهة الاتصال." },

  /* ── The idle marquee ────────────────────────────────────────────────────────
     THE FOUR CATEGORY PROMPTS MAP TO THE FOUR CONTACT TAGS, so their Arabic must
     stay DISTINCT — collapsing any two would make the rotation say the same thing
     twice in the language where nobody would notice. "Contact your family" is the
     owner's own wording, verbatim; the rest match its shape (an instruction, no
     apology, nothing claimed about the reader's address book).

     VIP BORROWS THE TAG'S OWN ARABIC («شخصية مهمة», `contacts.tag.vip`) rather than
     inventing a second term: the Contacts chip and this prompt are the SAME fact,
     and two spellings of one tag is how they come to disagree.

     Every string here is bounded by `MARQUEE_COPY_MAX` — a wrap grows the row, and
     the row's height is part of the keypad's hardcoded budget. */
  "dialer.marqueeFamily": { en: "Contact your family", ar: "تواصل مع عائلتك" },
  "dialer.marqueeFriend": { en: "Call a friend", ar: "اتصل بصديق" },
  "dialer.marqueeTeam": { en: "Reach your team", ar: "تواصل مع فريقك" },
  "dialer.marqueeVip": { en: "Call a VIP", ar: "اتصل بشخصية مهمة" },
  "dialer.marqueeSaved": { en: "Someone you've saved", ar: "شخص حفظته لديك" },
  "dialer.marqueeHintDial": {
    en: "Press the numbers to dial",
    ar: "اضغط الأرقام للاتصال",
  },
  "dialer.marqueeHintFind": {
    en: "Find friends, family & team",
    ar: "ابحث عن أصدقائك وعائلتك وفريقك",
  },
  /* The tap target's screen-reader label. Arabic takes its own comma («،»), and the
     six digits stay Western — a number read aloud has to be the number typed. */
  "dialer.marqueeDial": { en: "Dial {name}, {number}", ar: "اتصل بـ{name}، {number}" },
} as const satisfies Record<string, Entry>;
