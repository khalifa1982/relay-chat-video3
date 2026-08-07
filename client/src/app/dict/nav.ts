/**
 * Strings owned by the standalone LOGIN SCREEN (`LoginScreen.tsx`) — the marketing
 * entry page with its own card and state machine, distinct from the compact
 * onboarding gate. See ./core.ts for why each area has its own file, and ./auth.ts
 * for the Western-digits and imperative-verb rules that apply here too.
 *
 * This module is named `nav` for historical reasons (it was scaffolded before the
 * surfaces were mapped) and is registered in ./index.ts under that name; the KEYS
 * are what matter, and they are all `login.*`.
 */
import type { Entry } from "./types";

export const NAV = {
  // ── Security & identity section ──
  "login.securityEyebrow": { en: "SECURITY & IDENTITY", ar: "الأمان والهوية" },
  "login.identityHeading": {
    en: "Your identity is six digits.",
    ar: "هويتك ستة أرقام.",
  },
  "login.identityNote": {
    en: "Not your email. Not your phone. Not even your name. On RELAY you are a random six-digit ID — enter as a guest and one is reserved for you on the spot; register and it is yours for good.",
    ar: "ليس بريدك الإلكتروني. ولا رقم هاتفك. ولا حتى اسمك. في RELAY أنت رقم عشوائي من ستة أرقام — ادخل كضيف ويُحجز لك رقم في الحال؛ وسجّل ليصبح ملكك إلى الأبد.",
  },

  // ── Live network ──
  "login.liveNetwork": { en: "Live network", ar: "الشبكة المباشرة" },
  "login.registered": { en: "REGISTERED", ar: "المسجّلون" },
  "login.guestsServed": { en: "GUESTS SERVED", ar: "الضيوف المخدومون" },
  "login.callParties": { en: "CALL PARTIES", ar: "أطراف المكالمات" },
  "login.messages": { en: "MESSAGES", ar: "الرسائل" },
  "login.onlineNow": { en: "ONLINE NOW", ar: "متصل الآن" },

  // ── Choose your access ──
  "login.chooseAccess": { en: "CHOOSE YOUR ACCESS", ar: "اختر طريقة الدخول" },
  "login.guest": { en: "Guest", ar: "ضيف" },
  "login.guestSub": { en: "Just a display name", ar: "اسم يظهر للآخرين فقط" },
  "login.registeredTitle": { en: "Registered", ar: "مسجَّل" },
  "login.registeredSub": {
    en: "Login / register with email",
    ar: "تسجيل الدخول أو إنشاء حساب بالبريد",
  },

  // ── Guest step ──
  "login.guestLabel": { en: "GUEST ACCESS · YOUR FULL NAME", ar: "دخول الضيوف · اسمك الكامل" },
  "login.fullNamePlaceholder": { en: "Full name — e.g. Alex Mercer", ar: "الاسم الكامل — مثال: أحمد المنصوري" },
  "login.fullName": { en: "Full name", ar: "الاسم الكامل" },
  "login.guestNote": {
    en: "Tap below and a six-digit RELAY number is reserved for you on the spot — we'll show it to you straight away.",
    ar: "اضغط أدناه ويُحجز لك رقم RELAY من ستة أرقام في الحال — وسنعرضه لك فورًا.",
  },
  "login.reservingNumber": { en: "Reserving your number…", ar: "جارٍ حجز رقمك…" },
  "login.guestCta": {
    en: "I am a guest — reserve my number",
    ar: "أنا ضيف — احجز رقمي",
  },
  "login.agreePrefix": {
    en: "I agree to the",
    ar: "أوافق على",
  },
  "login.agreeGuidelines": {
    en: "Terms & Community Guidelines",
    ar: "الشروط وإرشادات المجتمع",
  },
  "login.agreeSuffix": {
    en: ", and understand there is zero tolerance for objectionable content or abusive behaviour.",
    ar: "، وأفهم أنه لا تسامح إطلاقاً مع المحتوى المُسيء أو السلوك المُسيء.",
  },
  "login.agreeAria": {
    en: "Agree to the Terms and Community Guidelines",
    ar: "الموافقة على الشروط وإرشادات المجتمع",
  },
  "login.err.guestSession": {
    en: "Couldn't start a guest session. Try again.",
    ar: "تعذّر بدء جلسة الضيف. حاول مرة أخرى.",
  },

  // ── Email step ──
  "login.emailLabel": { en: "REGISTERED ACCESS · EMAIL", ar: "دخول المسجّلين · البريد الإلكتروني" },
  "login.emailAria": { en: "Email address", ar: "البريد الإلكتروني" },
  "login.accountType": { en: "ACCOUNT TYPE", ar: "نوع الحساب" },
  "login.private": { en: "Private", ar: "شخصي" },
  "login.business": { en: "Business", ar: "أعمال" },
  "login.soon": { en: "SOON", ar: "قريبًا" },
  "login.comingSoon": { en: "COMING SOON", ar: "قريبًا" },
  "login.businessBlurb": {
    en: "Business accounts bring team lines, shared numbers and an admin console — same six-digit identity, gold-tier theme.",
    ar: "حسابات الأعمال تتيح خطوط الفريق والأرقام المشتركة ولوحة إدارة — بالهوية نفسها المكوّنة من ستة أرقام، وبسمة ذهبية.",
  },
  "login.businessCta": { en: "Business — coming soon", ar: "الأعمال — قريبًا" },
  "login.checking": { en: "Checking…", ar: "جارٍ التحقق…" },
  "login.continue": { en: "Continue", ar: "متابعة" },
  "login.err.checkAddress": {
    en: "Couldn't check that address. Try again.",
    ar: "تعذّر التحقق من هذا العنوان. حاول مرة أخرى.",
  },

  // ── The identity hint (email + masked number) ──
  "login.change": { en: "CHANGE", ar: "تغيير" },
  "login.yourRelayId": { en: "YOUR RELAY ID", ar: "معرّفك في RELAY" },

  // ── Choose step ──
  "login.checkingAddress": { en: "Checking that address…", ar: "جارٍ التحقق من العنوان…" },
  "login.registerNew": { en: "Register a new account", ar: "أنشئ حسابًا جديدًا" },
  "login.logIn": { en: "Log in", ar: "تسجيل الدخول" },
  "login.chooseHintPending": {
    en: "Existing users log in · new users register a permanent six-digit ID",
    ar: "المستخدمون الحاليون يسجّلون الدخول · والجدد ينشئون معرّفًا دائمًا من ستة أرقام",
  },
  "login.chooseHintUnreg": {
    en: "No RELAY account for that address yet — register to claim a six-digit ID.",
    ar: "لا يوجد حساب RELAY لهذا العنوان بعد — سجّل لتحصل على معرّف من ستة أرقام.",
  },
  "login.chooseHintExisting": {
    en: "This email already has a RELAY account, so it can't be registered again — log in instead and we'll email you a code.",
    ar: "هذا البريد الإلكتروني مرتبط بحساب RELAY بالفعل، فلا يمكن التسجيل به مجددًا — سجّل الدخول وسنرسل لك رمزًا بالبريد.",
  },

  // ── Code step ──
  "login.codeLabel": { en: "SIGN-IN CODE", ar: "رمز تسجيل الدخول" },
  "login.codeSent": { en: "We sent you a 6-digit code.", ar: "أرسلنا لك رمزًا من 6 أرقام." },
  "login.codeAria": { en: "6-digit sign-in code", ar: "رمز تسجيل الدخول المكوّن من 6 أرقام" },
  "login.verifying": { en: "Verifying…", ar: "جارٍ التحقق…" },
  "login.verifySignIn": { en: "Verify & sign in", ar: "تحقّق وسجّل الدخول" },
  "login.resendWait": {
    en: "You can ask for another code in",
    ar: "يمكنك طلب رمز آخر خلال",
  },
  "login.resendAction": { en: "Resend the code", ar: "أعد إرسال الرمز" },
  "login.err.badCode": {
    en: "That code didn't work. Check it and try again.",
    ar: "الرمز غير صحيح. تحقّق منه وحاول مرة أخرى.",
  },
  "login.err.sendCode": {
    en: "Couldn't send your code. Try again.",
    ar: "تعذّر إرسال رمزك. حاول مرة أخرى.",
  },
  "login.err.mailNotConfigured": {
    en: "We couldn't send your code — email delivery isn't set up yet. Contact the operator.",
    ar: "تعذّر إرسال الرمز — لم يُفعَّل إرسال البريد الإلكتروني بعد. تواصل مع المشغّل.",
  },
  "login.notice.locked": {
    en: "This account is locked after too many wrong PINs — the email code unlocks it.",
    ar: "قُفل هذا الحساب بعد محاولات خاطئة كثيرة — الرمز المُرسل بالبريد يفتحه.",
  },

  // ── Register step ──
  "login.permanentName": { en: "PERMANENT DISPLAY NAME", ar: "الاسم الدائم الذي سيظهر" },
  "login.permanentPlaceholder": {
    en: "Full name — shown to everyone",
    ar: "الاسم الكامل — يظهر للجميع",
  },
  "login.permanentAria": { en: "Permanent display name", ar: "الاسم الدائم الذي سيظهر" },
  "login.permanentWarning": {
    en: "This name is permanent — it can never be changed.",
    ar: "هذا الاسم دائم — ولا يمكن تغييره أبدًا.",
  },
  "login.creating": { en: "Creating…", ar: "جارٍ الإنشاء…" },
  "login.createAccount": { en: "Create private account", ar: "أنشئ حسابًا شخصيًا" },
  "login.err.startRegistration": {
    en: "Couldn't start registration. Try again.",
    ar: "تعذّر بدء التسجيل. حاول مرة أخرى.",
  },

  // ── Passcode step ──
  "login.passcodeLabel": { en: "PASSCODE", ar: "رمز الدخول" },
  "login.passcodePrompt": {
    en: "Enter your 4-digit passcode",
    ar: "أدخل رمز الدخول المكوّن من 4 أرقام",
  },
  "login.passcodeAria": { en: "4-digit passcode", ar: "رمز الدخول المكوّن من 4 أرقام" },
  "login.unlock": { en: "Unlock", ar: "افتح" },
  "login.err.badPasscode": {
    en: "That passcode didn't work.",
    ar: "رمز الدخول غير صحيح.",
  },

  // ── Waiting-for-approval step ──
  "login.approvalDeclined": { en: "APPROVAL DECLINED", ar: "تم رفض الموافقة" },
  "login.waitingApproval": { en: "WAITING FOR APPROVAL", ar: "بانتظار الموافقة" },
  "login.declinedBody": {
    en: "That sign-in was declined on your other device. You can try another way in below.",
    ar: "تم رفض تسجيل الدخول هذا من جهازك الآخر. يمكنك تجربة طريقة أخرى للدخول أدناه.",
  },
  "login.waitingBody": {
    en: "This is a new device. Approve it from a device you're already signed in on — then you're in.",
    ar: "هذا جهاز جديد. وافق عليه من جهاز مسجَّل دخوله بالفعل — وستدخل مباشرة.",
  },
  "login.approvalWait": {
    en: "Still waiting — you can ask again in",
    ar: "ما زال الانتظار قائمًا — يمكنك الطلب مجددًا خلال",
  },
  "login.approvalAction": { en: "Ask that device again", ar: "اطلب من ذلك الجهاز مرة أخرى" },
  "login.passcodeNoApproval": {
    en: "A 4-digit passcode never needs approval — you can set one from Profile once you're in.",
    ar: "رمز الدخول المكوّن من 4 أرقام لا يحتاج موافقة أبدًا — يمكنك ضبطه من الملف الشخصي بعد الدخول.",
  },

  // ── Method picker ──
  "login.orSignInWith": { en: "OR SIGN IN WITH", ar: "أو سجّل الدخول بـ" },
  "login.methodCode": { en: "Email code", ar: "رمز بالبريد" },
  "login.methodPin": { en: "4-digit passcode", ar: "رمز من 4 أرقام" },
  "login.methodDevice": { en: "Another device", ar: "جهاز آخر" },

  // ── Chrome ──
  "login.back": { en: "Back", ar: "رجوع" },
  "login.backToEmail": { en: "Back to email", ar: "العودة إلى البريد" },
  "login.guestSessionNote": {
    en: "Guest sessions end when you close your browser — but this browser can restore your number and history next time. Registering keeps them permanently and earns a verified badge.",
    ar: "تنتهي جلسة الضيف عند إغلاق المتصفح — لكن هذا المتصفح يستطيع استعادة رقمك وسجلك في المرة القادمة. التسجيل يحفظهما نهائيًا ويمنحك شارة التوثيق.",
  },
  "login.oneLine": {
    en: "One encrypted line for everything — talk, see and type with the same people, at once.",
    ar: "خط مشفّر واحد لكل شيء — تحدّث وشاهد واكتب مع الأشخاص أنفسهم في الوقت نفسه.",
  },
  "login.voice": { en: "Voice", ar: "صوت" },
  "login.video": { en: "Video", ar: "فيديو" },
  "login.chat": { en: "Chat", ar: "دردشة" },
  "login.footer": {
    en: "© 2026 RELAY · ENCRYPTED COMMUNICATIONS",
    ar: "© 2026 RELAY · اتصالات مشفّرة",
  },
} as const satisfies Record<string, Entry>;
