import type { Entry } from "./types";

/**
 * THE GROUP-CALL PICKER AND THE PARTY LINES SECTION.
 *
 * One module per surface — see `dict/index.ts` for why (the per-screen sweep runs
 * several contributors at once, and a single shared dictionary is the one file they
 * would all have to edit).
 *
 * ── THE ONE VOCABULARY DISTINCTION THIS SCREEN LIVES OR DIES BY ──────────────────────
 * A GROUP CALL and a PARTY LINE are two different things, and this is the ONLY screen
 * in the app that shows both at once:
 *
 *   • a GROUP CALL («مكالمة جماعية») rings a set of people you pick, one room, first to
 *     accept joins and the rest keep ringing;
 *   • a PARTY LINE («خط جماعي») rings NOBODY — it is a durable room with its own 6-digit
 *     number, and anyone who dials it simply lands in the call.
 *
 * English keeps them apart with two different noun phrases and so must Arabic. Collapsing
 * both onto one word would make the top half of this sheet describe the bottom half, and
 * the "No ringing, no invites" sentence would contradict the button above it. Asserted in
 * `groupcallLocale.test.ts` rather than left to review, because nobody reading only the
 * English would notice — the English still says two different things.
 *
 * Three smaller pairs are kept apart for the same reason and pinned in that file:
 *   • JOIN («انضم») a line vs START («ابدأ») a group call — one rings nobody, one rings
 *     everybody;
 *   • DELETE («حذف») a line — permanent, and it retires that 6-digit number for good — vs
 *     REMOVE («إزالة») a person from the selection, which is just a deselect;
 *   • HIDE («إخفاء») the fold-out vs DELETE. The disclosure toggle sits two rows above a
 *     destructive button.
 *
 * ── «على الخط» IS BORROWED FROM `dict/dialer.ts` ON PURPOSE ──────────────────────────
 * `dialer.partyLine` already renders "Party line · {count} on the line" as
 * «خط جماعي · {count} على الخط». The Dialer's preview and this list state the SAME fact
 * about the SAME room, so they use the same Arabic phrase; a second wording here is how
 * one product ends up with two names for one thing.
 *
 * ── WESTERN DIGITS, AS EVERYWHERE ────────────────────────────────────────────────────
 * Every number on this screen is one somebody acts on — a 6-digit line number they dial,
 * the participant cap, the live head-count. A substituted Western digit beside an
 * Arabic-Indic one reads as a rendering fault (v2.106.84).
 *
 * ── PLACEHOLDERS MOVE WHERE THE LANGUAGE WANTS THEM ──────────────────────────────────
 * `translate()` substitutes BY NAME, never by position, so `groupcall.createdAgo` puts
 * `{ago}` in the MIDDLE in English ("Created 3h ago") and at the END in Arabic
 * («أُنشئ قبل 3h») — Arabic states the elapsed span after the preposition. Never split a
 * sentence around an interpolation to achieve that.
 */
export const GROUPCALL = {
  // ── The picker's chrome ──
  "groupcall.title": { en: "Create group call", ar: "إنشاء مكالمة جماعية" },
  "groupcall.close": { en: "Close", ar: "إغلاق" },
  /* The chip's ✕. `{name}` is the saved contact name when there is one and the bare
     6-digit number otherwise, so the label names whatever the chip shows. */
  "groupcall.removeSelected": { en: "Remove {name}", ar: "إزالة {name}" },

  // ── Adding people ──
  "groupcall.addNumberPlaceholder": {
    en: "Add a number (6 digits)",
    ar: "أضف رقمًا (6 أرقام)",
  },
  /* The `+` was an icon-only button with NO accessible name at all — a screen reader
     announced "button". Added here rather than left for a later pass: an unlabelled
     control is exactly what a localisation sweep is meant to surface. */
  "groupcall.addNumber": { en: "Add this number", ar: "أضف هذا الرقم" },
  "groupcall.searchPlaceholder": { en: "Search contacts", ar: "ابحث في جهات الاتصال" },
  "groupcall.loading": { en: "Loading…", ar: "جارٍ التحميل…" },
  "groupcall.noMatches": { en: "No matches.", ar: "لا توجد نتائج." },
  "groupcall.noContacts": {
    en: "No contacts yet — add numbers above.",
    ar: "لا توجد جهات اتصال بعد — أضف الأرقام في الأعلى.",
  },

  // ── Voice-first, then the primary action ──
  "groupcall.voice": { en: "Voice", ar: "صوت" },
  "groupcall.video": { en: "Video", ar: "فيديو" },
  /* Two forms rather than one with an always-present count: the button renders with no
     count while nothing is picked (it is disabled, not absent), and "(0)" there would be
     a number about nothing. */
  "groupcall.start": { en: "Start group call", ar: "ابدأ المكالمة الجماعية" },
  "groupcall.startCount": {
    en: "Start group call ({n})",
    ar: "ابدأ المكالمة الجماعية ({n})",
  },

  // ── Party lines: the disclosure row and its explanation ──
  "groupcall.partyLines": { en: "Party lines", ar: "الخطوط الجماعية" },
  "groupcall.hide": { en: "Hide", ar: "إخفاء" },
  "groupcall.manage": { en: "Manage", ar: "إدارة" },
  /* `{max}` is the live transport's own room cap, never a literal — every call runs the
     mesh, whose cap is 6, so a hardcoded 10 would be a false claim about capacity. */
  "groupcall.lineHint": {
    en: "Dial the number — you drop straight in · up to {max}",
    ar: "اطلب الرقم لتدخل مباشرةً · حتى {max}",
  },
  "groupcall.lineAbout": {
    en: "A party line is a room with its own 6-digit number — anyone who dials it lands in the same call. No ringing, no invites: just share the number.",
    ar: "الخط الجماعي غرفة لها رقمها الخاص من 6 أرقام — وكل من يطلبه ينضم إلى المكالمة نفسها. بلا رنين وبلا دعوات: شارك الرقم فحسب.",
  },
  "groupcall.atCap": {
    en: "You have all {max} party lines — delete one to make room.",
    ar: "لديك {max} خطوط جماعية وهو الحد الأقصى — احذف واحدًا لإفساح المجال.",
  },

  // ── Creating one ──
  "groupcall.lineNamePlaceholder": {
    en: "Line name (e.g. Family room)",
    ar: "اسم الخط (مثل: غرفة العائلة)",
  },
  "groupcall.creating": { en: "Creating…", ar: "جارٍ الإنشاء…" },
  "groupcall.newLine": { en: "New line", ar: "خط جديد" },
  "groupcall.noLines": { en: "No party lines yet.", ar: "لا توجد خطوط جماعية بعد." },

  // ── A row ──
  /* «على الخط» matches `dialer.partyLine` — see this module's header. "Live" is the ROOM
     being active, which is why it is not the presence word: green means a PERSON is
     online and nothing else in this app. */
  "groupcall.live": {
    en: "Live · {count} on the line",
    ar: "نشط · {count} على الخط",
  },
  /* `{ago}` is `formatElapsedSince`'s compact span ("3h 20m", "2d"). It sits mid-sentence
     in English and after the preposition in Arabic. */
  "groupcall.createdAgo": { en: "Created {ago} ago", ar: "أُنشئ قبل {ago}" },
  "groupcall.joinAria": { en: "Join {title}", ar: "انضم إلى {title}" },
  "groupcall.manageAria": { en: "Manage {title}", ar: "إدارة {title}" },

  // ── The manage card ──
  "groupcall.manageTitle": { en: "Manage “{title}”", ar: "إدارة «{title}»" },
  "groupcall.copyDialIn": { en: "Copy dial-in", ar: "نسخ رقم الاتصال" },
  "groupcall.shareNumber": { en: "Share number", ar: "مشاركة الرقم" },
  /* Deliberately NOT `common.delete`, though the word is the same. The three delete
     strings on this screen are one family about one act — retiring a party line and its
     number permanently — and they read together. `common.delete` is the generic verb and
     is still parked for the group/admin sweep. */
  "groupcall.delete": { en: "Delete", ar: "حذف" },

  // ── …and its confirmation ──
  "groupcall.deleteTitle": {
    en: "Delete this party line?",
    ar: "حذف هذا الخط الجماعي؟",
  },
  /* All three true consequences, in both languages: the live call survives, the number
     stops resolving, and it is never reissued (the reservation ledger is monotonic and
     `claimedAt` is already stamped, so the reaper can never reclaim it). */
  "groupcall.deleteBody": {
    en: "Anyone on the line right now keeps talking, and {number} stops resolving for new dials. That number won't come back — it's retired for good.",
    ar: "من على الخط الآن يواصلون حديثهم، لكن {number} سيتوقف عن الاستجابة للطلبات الجديدة. ولن يعود هذا الرقم — فقد أُحيل للتقاعد نهائيًا.",
  },
  /* The dialog keeps rendering for an instant after `deleting` is cleared, so this
     fallback is genuinely reachable rather than defensive. */
  "groupcall.theNumber": { en: "the number", ar: "الرقم" },
  "groupcall.deleteCancel": { en: "Keep it", ar: "الإبقاء عليه" },
  "groupcall.deleteAction": { en: "Delete line", ar: "حذف الخط" },

  // ── Toasts ──
  "groupcall.lineCreated": {
    en: "Party line created — its number is {number}",
    ar: "تم إنشاء الخط الجماعي — رقمه {number}",
  },
  "groupcall.createFailed": {
    en: "Couldn't create the party line.",
    ar: "تعذّر إنشاء الخط الجماعي.",
  },
  "groupcall.lineDeleted": { en: "Party line deleted", ar: "تم حذف الخط الجماعي" },
  "groupcall.deleteFailed": {
    en: "Couldn't delete the party line.",
    ar: "تعذّر حذف الخط الجماعي.",
  },
  "groupcall.inviteCopied": { en: "Invite copied", ar: "تم نسخ الدعوة" },
  /* TWO copy-failure wordings, preserved rather than unified. They are the same act — a
     clipboard write that failed while copying this line's invite — and the shipped
     English says it two ways. Merging them is a COPY change, which is not this sweep's to
     make; translating them separately keeps each screen saying exactly what it said. */
  "groupcall.inviteCopyFailed": {
    en: "Couldn't copy the invite",
    ar: "تعذّر نسخ الدعوة",
  },
  "groupcall.copyFailed": { en: "Couldn't copy", ar: "تعذّر النسخ" },
} as const satisfies Record<string, Entry>;
