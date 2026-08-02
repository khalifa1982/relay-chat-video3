/**
 * Strings owned by the auth surface — the sign-in sheet, the onboarding gate and
 * the guest-restore card. See ./core.ts for why each area has its own file.
 *
 * ── WESTERN DIGITS, DELIBERATELY, EVEN IN ARABIC PROSE ────────────────────────
 * Arabic normally takes Eastern-Arabic numerals (٠١٢٣) and this dictionary does
 * not use them ANYWHERE, which is a decision rather than an oversight. Every
 * number a user actually acts on in this flow is interpolated: the resend
 * countdown, the email address, and above all the six-digit RELAY number, which
 * is Western everywhere in the product because a number somebody reads out loud
 * has to be the number they type. Writing "٦ أرقام" beside a "60" the code
 * substitutes in puts two numeral systems on one line, which reads as a rendering
 * fault rather than as localisation.
 *
 * ── IMPERATIVE VERBS FOR BUTTONS ──────────────────────────────────────────────
 * "إرسال الرمز" (a noun phrase) is what a machine translation produces for "Send
 * code"; an Arabic app says "أرسل الرمز". Labels here are written the way a
 * person would be told to do the thing.
 */
import type { Entry } from "./types";

export const AUTH = {
  // ── Stage titles (the sheet has exactly one headline, so this IS it) ──
  "auth.title.signIn": { en: "Sign in", ar: "تسجيل الدخول" },
  "auth.title.register": { en: "Create your account", ar: "أنشئ حسابك" },
  "auth.title.code": { en: "Enter your code", ar: "أدخل الرمز" },
  "auth.title.pin": { en: "Enter your PIN", ar: "أدخل رمز الدخول" },
  "auth.title.setup": { en: "Finish setting up", ar: "أكمل الإعداد" },
  "auth.title.waiting": { en: "Waiting for approval", ar: "بانتظار الموافقة" },
  "auth.title.upsell": {
    en: "Register — keep this number",
    ar: "سجّل — واحتفظ بهذا الرقم",
  },

  // ── Chrome ──
  "auth.back": { en: "Back", ar: "رجوع" },
  "auth.close": { en: "Close", ar: "إغلاق" },

  // ── Email step ──
  "auth.emailSub": {
    en: "Enter your email and we'll send you a one-time code. No password needed.",
    ar: "أدخل بريدك الإلكتروني وسنرسل لك رمزًا يُستخدم لمرة واحدة. لا حاجة إلى كلمة مرور.",
  },
  "auth.emailSubUpsell": {
    en: "Your guest number is only held for this browser. Registering locks it to your account for good — and adds a verified badge.",
    ar: "رقمك كضيف محفوظ على هذا المتصفح فقط. التسجيل يربطه بحسابك نهائيًا — ويمنحك شارة التوثيق.",
  },
  "auth.emailLabel": {
    en: "Registered access · Email",
    ar: "دخول المسجّلين · البريد الإلكتروني",
  },
  "auth.checking": { en: "Checking…", ar: "جارٍ التحقق…" },
  "auth.sending": { en: "Sending…", ar: "جارٍ الإرسال…" },
  "auth.sendVerificationCode": { en: "Send verification code", ar: "أرسل رمز التحقق" },
  "auth.sendCode": { en: "Send code", ar: "أرسل الرمز" },
  "auth.noPasswordFoot": {
    en: "No password — a 6-digit code checks your email",
    ar: "بلا كلمة مرور — رمز من 6 أرقام يتحقق من بريدك",
  },

  // ── Register step ──
  "auth.registerSub": {
    en: "Just your name to finish — we already have your email.",
    ar: "اسمك فقط لإتمام التسجيل — لدينا بريدك بالفعل.",
  },
  "auth.firstName": { en: "First name", ar: "الاسم الأول" },
  "auth.lastName": { en: "Last name", ar: "اسم العائلة" },
  "auth.creating": { en: "Creating…", ar: "جارٍ الإنشاء…" },

  // ── The reserved-number row + account type ──
  "auth.yourNumber": { en: "Your number", ar: "رقمك" },
  "auth.reserved": { en: "Reserved", ar: "محجوز" },
  "auth.accountType": { en: "Account type", ar: "نوع الحساب" },
  "auth.private": { en: "Private", ar: "شخصي" },
  "auth.business": { en: "Business", ar: "أعمال" },
  "auth.soon": { en: "Soon", ar: "قريبًا" },

  // ── The "this address already has an account" note ──
  "auth.existingTitle": {
    en: "That email already has a RELAY account",
    ar: "هذا البريد الإلكتروني مرتبط بحساب RELAY بالفعل",
  },
  "auth.existingBody": {
    en: "So it can't be registered again — we're signing you in to it instead. You'll use that account's number, not this guest one.",
    ar: "لذا لا يمكن التسجيل به مجددًا — سنسجّل دخولك إليه بدلاً من ذلك. وستستخدم رقم ذلك الحساب، لا رقم الضيف هذا.",
  },

  // ── Keep me signed in ──
  "auth.rememberMe": { en: "Keep me signed in", ar: "أبقني مسجّلاً للدخول" },
  "auth.rememberDays": { en: "{days} days", ar: "{days} يومًا" },
  "auth.rememberOff": {
    en: "Off: you'll be signed out when this browser closes.",
    ar: "معطّل: سيُسجَّل خروجك عند إغلاق هذا المتصفح.",
  },

  // ── PIN step ──
  "auth.pinPrompt": {
    en: "Enter the 4-digit PIN for {email}.",
    ar: "أدخل رمز الدخول المكوّن من 4 أرقام الخاص بـ {email}.",
  },
  "auth.unlocked": { en: "Unlocked ✓", ar: "تم الفتح ✓" },
  "auth.unlocking": { en: "Unlocking…", ar: "جارٍ الفتح…" },
  "auth.emailCodeInstead": {
    en: "Email me a code instead",
    ar: "أرسل لي رمزًا بالبريد بدلاً من ذلك",
  },
  "auth.pinFoot": {
    en: "Three wrong tries are forgiven — a fourth locks the account until you sign in by email code.",
    ar: "يُسمح بثلاث محاولات خاطئة — والرابعة تقفل الحساب حتى تسجّل الدخول برمز البريد.",
  },

  // ── Waiting-for-approval step ──
  "auth.waitingBody": {
    en: "For your security, approve this sign-in from a device already signed in to {email}.",
    ar: "لأمانك، وافق على تسجيل الدخول هذا من جهاز مسجَّل دخوله بالفعل إلى {email}.",
  },
  "auth.waitingHow": {
    en: "Open the notification bell (or Profile → Devices) on your other device and tap {approve}. This screen continues automatically.",
    ar: "افتح جرس الإشعارات (أو الملف الشخصي ← الأجهزة) على جهازك الآخر واضغط {approve}. ستتابع هذه الشاشة تلقائيًا.",
  },
  "auth.approve": { en: "Approve", ar: "موافقة" },
  "auth.waitStalled": {
    en: "No response yet — your other device may be offline or closed. You can sign in with your 4-digit PIN instead (no approval needed).",
    ar: "لا استجابة حتى الآن — قد يكون جهازك الآخر غير متصل أو مغلقًا. يمكنك تسجيل الدخول برمزك المكوّن من 4 أرقام بدلاً من ذلك (بلا حاجة إلى موافقة).",
  },
  "auth.usePinInstead": {
    en: "Sign in with your PIN instead",
    ar: "سجّل الدخول برمز الدخول بدلاً من ذلك",
  },

  // ── Setup step ──
  "auth.setupSub": {
    en: "You're in ✅ — here's your number. Add a photo and pick a 4-digit passcode to finish. You'll use this passcode to sign in on any device.",
    ar: "تم تسجيلك ✅ — وهذا رقمك. أضف صورة واختر رمز دخول من 4 أرقام للإنهاء. ستستخدم هذا الرمز لتسجيل الدخول من أي جهاز.",
  },
  "auth.yourRelayNumber": { en: "Your RELAY number", ar: "رقمك في RELAY" },
  "auth.changeAvatar": { en: "Change avatar", ar: "تغيير الصورة" },
  "auth.addAvatar": { en: "Add an avatar", ar: "إضافة صورة" },
  "auth.yourPhoto": { en: "Your photo", ar: "صورتك" },
  "auth.avatarSet": {
    en: "Looking good — tap to change",
    ar: "تبدو رائعة — اضغط للتغيير",
  },
  "auth.avatarNeeded": {
    en: "Add a photo or emoji (required)",
    ar: "أضف صورة أو رمزًا تعبيريًا (مطلوب)",
  },
  "auth.passcodeLabel": { en: "4-digit passcode", ar: "رمز دخول من 4 أرقام" },
  "auth.passcodeRepeat": { en: "Repeat it", ar: "أعد إدخاله" },
  "auth.finishing": { en: "Finishing…", ar: "جارٍ الإنهاء…" },
  "auth.finish": { en: "Finish", ar: "إنهاء" },

  // ── Code step ──
  "auth.codeSentTo": {
    en: "We sent a 6-digit code to {email}.",
    ar: "أرسلنا رمزًا من 6 أرقام إلى {email}.",
  },
  "auth.verifying": { en: "Verifying…", ar: "جارٍ التحقق…" },
  "auth.verifyContinue": { en: "Verify & continue", ar: "تحقّق وتابع" },
  "auth.resendIn": {
    en: "Resend code in {seconds}s",
    ar: "إعادة إرسال الرمز خلال {seconds} ث",
  },
  "auth.resend": { en: "Resend code", ar: "أعد إرسال الرمز" },
  "auth.newCodeSent": { en: "A new code is on its way.", ar: "رمز جديد في الطريق." },

  // ── Errors and notices ──
  // Written as full sentences rather than fragments, because each of these is the
  // ONLY thing on screen telling somebody why they cannot get in.
  "auth.err.declined": {
    en: "That sign-in was declined on your other device.",
    ar: "تم رفض تسجيل الدخول هذا من جهازك الآخر.",
  },
  "auth.err.photoNotImage": {
    en: "Your photo must be an image.",
    ar: "يجب أن تكون صورتك ملف صورة.",
  },
  "auth.err.photoTooBig": {
    en: "Your photo must be under 4 MB.",
    ar: "يجب أن يكون حجم صورتك أقل من 4 ميغابايت.",
  },
  "auth.err.photoUpload": {
    en: "Photo upload failed. Try again.",
    ar: "فشل رفع الصورة. حاول مرة أخرى.",
  },
  "auth.err.mailNotConfigured": {
    en: "We couldn't send your code — email delivery isn't set up yet. Contact the operator.",
    ar: "تعذّر إرسال الرمز — لم يُفعَّل إرسال البريد الإلكتروني بعد. تواصل مع المشغّل.",
  },
  "auth.notice.locked": {
    en: "This account is locked after too many wrong PINs — the email code below unlocks it.",
    ar: "قُفل هذا الحساب بعد محاولات خاطئة كثيرة — الرمز المُرسل بالبريد أدناه يفتحه.",
  },
  "auth.err.sendCode": {
    en: "Couldn't send a code. Try again.",
    ar: "تعذّر إرسال الرمز. حاول مرة أخرى.",
  },
  "auth.err.badPin": { en: "That PIN didn't work.", ar: "رمز الدخول غير صحيح." },
  "auth.err.needAvatar": {
    en: "Add a profile photo to finish.",
    ar: "أضف صورة شخصية للإنهاء.",
  },
  "auth.err.passcodeLength": {
    en: "Your passcode is exactly 4 digits.",
    ar: "يجب أن يتكوّن رمز الدخول من 4 أرقام بالضبط.",
  },
  "auth.err.passcodeMismatch": {
    en: "The passcodes don't match.",
    ar: "رمزا الدخول غير متطابقين.",
  },
  "auth.err.savePasscode": {
    en: "Couldn't save your passcode. Try again.",
    ar: "تعذّر حفظ رمز الدخول. حاول مرة أخرى.",
  },
  "auth.err.startRegistration": {
    en: "Couldn't start registration. Try again.",
    ar: "تعذّر بدء التسجيل. حاول مرة أخرى.",
  },
  "auth.err.badCode": { en: "That code didn't work.", ar: "الرمز غير صحيح." },

  // ── The onboarding gate — the FIRST screen, and the only one a person can be
  //    stuck on. The language switch lives here for that reason: Profile is
  //    behind this gate, so somebody who lands in a language they cannot read
  //    would otherwise have no way through.
  "gate.tagline": {
    en: "Pick a name and jump straight in — no account needed.",
    ar: "اختر اسمًا وادخل مباشرة — بلا حاجة إلى حساب.",
  },
  "gate.taglineEmail": {
    en: "Login or register with your email — no password, we send you a one-time code.",
    ar: "سجّل الدخول أو أنشئ حسابًا ببريدك الإلكتروني — بلا كلمة مرور، نرسل لك رمزًا يُستخدم لمرة واحدة.",
  },
  "gate.displayName": { en: "Your display name", ar: "الاسم الذي سيظهر" },
  "gate.namePlaceholder": { en: "e.g. Alex", ar: "مثال: أحمد" },
  "gate.settingUp": { en: "Setting up…", ar: "جارٍ الإعداد…" },
  "gate.enterAsGuest": { en: "Enter as guest", ar: "ادخل كضيف" },
  "gate.or": { en: "or", ar: "أو" },
  "gate.loginRegister": {
    en: "Login / Register with email",
    ar: "تسجيل الدخول / إنشاء حساب بالبريد",
  },
  "gate.guestFoot": {
    en: "Guest sessions end when you close your browser — but this browser can restore your number and history next time. Registering keeps them permanently and earns a verified badge.",
    ar: "تنتهي جلسة الضيف عند إغلاق المتصفح — لكن هذا المتصفح يستطيع استعادة رقمك وسجلك في المرة القادمة. التسجيل يحفظهما نهائيًا ويمنحك شارة التوثيق.",
  },
  "gate.yourEmail": { en: "Your email", ar: "بريدك الإلكتروني" },
  "gate.continueWithEmail": { en: "Continue with email", ar: "تابع بالبريد الإلكتروني" },
  "gate.emailFoot": {
    en: "Login and registration are the same step — the code we email you does both. No password, so there's nothing to forget.",
    ar: "تسجيل الدخول وإنشاء الحساب خطوة واحدة — الرمز الذي نرسله بالبريد يقوم بالأمرين. بلا كلمة مرور، فلا شيء يمكن نسيانه.",
  },
  "gate.backToCall": { en: "← Back to joining the call", ar: "→ العودة للانضمام إلى المكالمة" },
  "gate.backToGuest": { en: "← Continue as guest instead", ar: "→ تابع كضيف بدلاً من ذلك" },

  // ── The call-link join card ──
  "gate.joinNameLabel": { en: "Enter your name to connect", ar: "أدخل اسمك للاتصال" },
  "gate.yourName": { en: "Your name", ar: "اسمك" },
  "gate.connecting": { en: "Connecting…", ar: "جارٍ الاتصال…" },
  "gate.numberNotFound": { en: "Number not found", ar: "الرقم غير موجود" },
  "gate.cannotReach": { en: "Can't be reached", ar: "تعذّر الوصول إليه" },
  "gate.joinLine": { en: "Join the line", ar: "انضم إلى الخط" },
  "gate.joinCall": { en: "Join call", ar: "انضم إلى المكالمة" },
  "gate.noDeviceToRing": {
    en: "There's no device we can ring for {name} yet. Once they open RELAY on a phone, calls will reach them.",
    ar: "لا يوجد جهاز يمكننا الاتصال به لـ {name} حتى الآن. بمجرد أن يفتح RELAY على هاتفه، ستصله المكالمات.",
  },
  "gate.them": { en: "them", ar: "هذا الشخص" },
  "gate.haveAccount": {
    en: "Have a RELAY account? Sign in first",
    ar: "لديك حساب RELAY؟ سجّل الدخول أولاً",
  },
  "gate.joinFoot": {
    en: "No account needed — your name is just for this call. Registering later keeps your number and history.",
    ar: "لا حاجة إلى حساب — اسمك لهذه المكالمة فقط. التسجيل لاحقًا يحفظ رقمك وسجلك.",
  },

  // ── Feature chips ──
  "gate.voice": { en: "Voice", ar: "صوت" },
  "gate.video": { en: "Video", ar: "فيديو" },
  "gate.chat": { en: "Chat", ar: "دردشة" },

  /* ── THE PIN REVEAL (#162) ────────────────────────────────────────────────────
     The screen between passing login and reaching the dashboard, which EVERY way in
     passes through — a guest name, an email sign-in, and any entry surface added
     later, because it arms on the signed-out → signed-in transition rather than on a
     callback per route. It belongs to this module for that reason: it is the last
     step of the login path, not a screen of the app behind it.

     Every string here is a MICRO-LABEL under heavy letter-spacing (0.3–0.4em), so the
     Arabic is deliberately short — see the note in `PinReveal.tsx` about what that
     spacing does to a connected script.

     NOT TRANSLATED, on purpose: the brand mark "RELAY" is a name, and the six digits
     are Western everywhere in the product because a number read aloud has to be the
     number typed. */
  "pin.yourNumber": { en: "YOUR NUMBER", ar: "رقمك" },
  "pin.autoAssigned": { en: "AUTO-ASSIGNED", ar: "تلقائي" },
  "pin.online": { en: "ONLINE", ar: "متصل" },
  /* The one sentence on the screen, and the reason it is worth having: somebody who
     has just been handed a number needs to know what it is FOR. */
  "pin.caption": {
    en: "Anyone with this number can dial you — no account needed.",
    ar: "يمكن لأي شخص لديه هذا الرقم الاتصال بك — بلا حاجة إلى حساب.",
  },
  /* The digit slots are decorative spans, so this is the ONLY thing a screen reader
     gets. The number is interpolated, and stays Western on both sides. */
  "pin.screenReader": {
    en: "Your RELAY number is {number}",
    ar: "رقمك في RELAY هو {number}",
  },
  "pin.continueAria": {
    en: "Your RELAY number — continue to the app",
    ar: "رقمك في RELAY — تابع إلى التطبيق",
  },
} as const satisfies Record<string, Entry>;
