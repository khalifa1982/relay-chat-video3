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
  "appearance.language": { en: "Language", ar: "اللغة" },
  "appearance.english": { en: "English", ar: "English" },
  "appearance.arabic": { en: "العربية", ar: "العربية" },
  "appearance.textSize": { en: "Text size", ar: "حجم الخط" },
  "appearance.small": { en: "Small", ar: "صغير" },
  "appearance.normal": { en: "Normal", ar: "عادي" },
  "appearance.large": { en: "Large", ar: "كبير" },
  "appearance.remembered": {
    en: "Your choice is remembered on this device.",
    ar: "يتم حفظ اختيارك على هذا الجهاز.",
  },
  "appearance.sample": { en: "Sample text", ar: "نص تجريبي" },

  // ── Sign in / register ──
  "auth.guestName": { en: "What should people call you?", ar: "بماذا يناديك الآخرون؟" },
  "auth.enterAsGuest": { en: "I am a guest — reserve my number", ar: "أنا ضيف — احجز رقمي" },
  "auth.email": { en: "Email address", ar: "البريد الإلكتروني" },
  "auth.continue": { en: "Continue", ar: "متابعة" },
  "auth.login": { en: "Log in", ar: "تسجيل الدخول" },
  "auth.register": { en: "Register", ar: "إنشاء حساب" },
  "auth.back": { en: "Back", ar: "رجوع" },
  "auth.codeSent": {
    en: "We sent a 6-digit code to your email.",
    ar: "أرسلنا رمزًا من ٦ أرقام إلى بريدك الإلكتروني.",
  },
  "auth.enterCode": { en: "Enter the code", ar: "أدخل الرمز" },
  "auth.resend": { en: "Send another code", ar: "إرسال رمز جديد" },
  "auth.passcode": { en: "Your 4-digit passcode", ar: "رمز الدخول المكوّن من ٤ أرقام" },
  "auth.useCodeInstead": { en: "Email me a code instead", ar: "أرسل لي رمزًا بالبريد بدلاً من ذلك" },
  "auth.waitingApproval": {
    en: "Waiting for approval from your other device",
    ar: "في انتظار الموافقة من جهازك الآخر",
  },
  "auth.declined": { en: "That sign-in was declined.", ar: "تم رفض محاولة تسجيل الدخول." },
  "auth.fullName": { en: "Your full name", ar: "اسمك الكامل" },
  "auth.rememberMe": { en: "Keep me signed in", ar: "أبقني مسجّلاً للدخول" },

  // ── Common actions ──
  "common.save": { en: "Save", ar: "حفظ" },
  "common.cancel": { en: "Cancel", ar: "إلغاء" },
  "common.delete": { en: "Delete", ar: "حذف" },
  "common.done": { en: "Done", ar: "تم" },
  "common.retry": { en: "Try again", ar: "إعادة المحاولة" },
  "common.search": { en: "Search", ar: "بحث" },
  "common.signOut": { en: "Sign out", ar: "تسجيل الخروج" },
} as const satisfies Record<string, Entry>;
