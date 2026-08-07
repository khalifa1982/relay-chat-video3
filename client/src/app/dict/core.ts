/**
 * Strings that belong to no single screen — navigation, the appearance pane, the
 * auth flow, and the verbs that appear everywhere.
 *
 * ONE MODULE PER AREA, and that is a collision-avoidance decision as much as a
 * tidiness one: the per-screen translation sweep runs several people (or agents)
 * at once, and a single shared dictionary file is the one thing they would all
 * have to edit. Each area owns its own file; `dict/index.ts` composes them.
 */
import type { Entry } from "./types";

export const CORE = {
  // ── Navigation ──
  "nav.calls": { en: "Calls", ar: "المكالمات" },
  "nav.history": { en: "History", ar: "السجل" },
  "nav.messages": { en: "Messages", ar: "الرسائل" },
  "nav.groups": { en: "Groups", ar: "المجموعات" },
  "nav.contacts": { en: "Contacts", ar: "جهات الاتصال" },
  "nav.profile": { en: "Profile", ar: "الملف الشخصي" },

  // ── Appearance settings ──
  "appearance.title": { en: "Appearance", ar: "المظهر" },
  "appearance.theme": { en: "Theme", ar: "السمة" },
  "appearance.dark": { en: "Dark", ar: "داكن" },
  "appearance.light": { en: "Light", ar: "فاتح" },
  /* NOTE (v2.106.91): there are deliberately NO `appearance.arabic` / `appearance.english`
     keys. Each language is labelled in ITS OWN language as a LITERAL ("English",
     "العربية") and must never be translated — "Arabic" written in English is exactly the
     label that fails the person it is for, who has landed in a language they cannot read
     and has to find their way out. Keys for them would invite somebody to "fix" that.  */
  "appearance.language": { en: "Language", ar: "اللغة" },
  "appearance.textSize": { en: "Text size", ar: "حجم الخط" },
  "appearance.small": { en: "Small", ar: "صغير" },
  "appearance.normal": { en: "Normal", ar: "عادي" },
  "appearance.large": { en: "Large", ar: "كبير" },
  "appearance.remembered": {
    en: "Your choice is remembered on this device.",
    ar: "يتم حفظ اختيارك على هذا الجهاز.",
  },
  "appearance.sample": { en: "Sample text", ar: "نص تجريبي" },

  // Sign-in and registration strings live in ./auth.ts — one home per surface, so
  // the sweep can run several contributors at once without them colliding here.

  // ── Common actions ──
  "common.save": { en: "Save", ar: "حفظ" },
  "common.cancel": { en: "Cancel", ar: "إلغاء" },
  "common.delete": { en: "Delete", ar: "حذف" },
  "common.done": { en: "Done", ar: "تم" },
  "common.retry": { en: "Try again", ar: "إعادة المحاولة" },
  "common.search": { en: "Search", ar: "بحث" },
  "common.close": { en: "Close", ar: "إغلاق" },
  "common.loading": { en: "Loading…", ar: "جارٍ التحميل…" },
  "common.signOut": { en: "Sign out", ar: "تسجيل الخروج" },
} as const satisfies Record<string, Entry>;
