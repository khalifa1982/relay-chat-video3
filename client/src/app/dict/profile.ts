/**
 * Strings owned by the profile surface (`Profile.tsx` — the hub and every pane it
 * opens). See ./core.ts for why each area has its own file.
 *
 * ── WHY THIS MODULE EXISTED AND WAS EMPTY ────────────────────────────────────────────
 * It shipped as `{}` and was imported and spread into ./index.ts anyway, which reads as
 * a wired surface contributing nothing — the same shape v2.106.86 retired `--relay-zoom`
 * for. Worse here, because the nine `t()` calls Profile.tsx did make were ALL
 * `appearance.*`: the language switch itself was translated and the page it sits on was
 * not, so switching to Arabic landed you back on an English screen.
 *
 * ── TWO KEYS THAT LOOK LIKE ONE, AND MUST NOT COLLAPSE ───────────────────────────────
 * The SIGN-IN PIN is an account credential the server checks (4 digits, unlocks with an
 * email code). The APP-LOCK PASSCODE is a local UI gate on ONE device (4–8 digits,
 * hashed in localStorage, never leaves the browser). English calls them "PIN" and
 * "passcode"; `dict/auth.ts` already renders both as «رمز الدخول», which is right there
 * because both of its uses ARE the account credential. Here they would become one word
 * for two different things, so the lock takes «رمز القفل» — it locks the app — and the
 * sign-in PIN keeps auth.ts's wording so the two screens agree about the same fact.
 *
 * ── THE PRESENCE OVERRIDE IS NOT THE PROFILE STATUS ──────────────────────────────────
 * `profile.presence*` are the values of `identities.statusOverride` (auto/away/travel).
 * `peer.profileStatus.*` are the five values of the PROFILE STATUS (work/vacation/
 * travel/free/busy). They happen to share the English word "Travelling", and tying them
 * together would mean an edit to one silently changes the other — two vocabularies, two
 * homes, exactly as `dict/peer.ts` keeps its own.
 *
 * ── THE STORY / STATUS RENAME IS CARRIED INTO THE ARABIC ─────────────────────────────
 * v2.101.0: a STORY is the ephemeral post, a STATUS is the profile label. The audience
 * control is about STORIES («القصص»); the away/travel picker is the status («الحالة»).
 * Reaching for one Arabic word for both would undo that correction in the language where
 * nobody would notice.
 *
 * ── WESTERN DIGITS, AS EVERYWHERE ELSE ───────────────────────────────────────────────
 * Every number a user acts on here is interpolated — the 6-digit RELAY number, the day
 * count, the relative times — so it stays Western (v2.106.84). An Arabic-Indic numeral
 * beside a substituted Western one reads as a rendering fault.
 *
 * ── AND THE GUEST-HOLD COUNTDOWN NEEDS FOUR ARABIC FORMS, NOT TWO ────────────────────
 * `` `{days} more day${days === 1 ? "" : "s"}` `` cannot be translated at all: English
 * needs one/other while Arabic needs 1 singular, 2 DUAL («يومين»), 3–10 plural of paucity
 * («أيام») and 11+ singular accusative («يومًا»). `guestHoldKey` in Profile.tsx picks a
 * WHOLE key per band, mirroring `guestExpiryKey`'s bands so the two countdowns can never
 * disagree about which form a count takes.
 *
 * Arabic spells one and two as WORDS, so those two entries substitute nothing and carry
 * no `{days}` placeholder — the emphasis span simply has nowhere to land, which is the
 * right trade: «خلال 1 يوم» is not something an Arabic speaker writes.
 */
import type { Entry } from "./types";

export const PROFILE = {
  // ── The page itself ──
  "profile.loading": { en: "Loading profile…", ar: "جارٍ تحميل الملف الشخصي…" },
  "profile.saved": { en: "Saved", ar: "تم الحفظ" },
  "profile.nameEmpty": {
    en: "Display name can't be empty.",
    ar: "لا يمكن ترك الاسم الظاهر فارغًا.",
  },
  "profile.back": { en: "Back to profile", ar: "العودة إلى الملف الشخصي" },

  // ── The identity hero ──
  /* The name fallback. Never blank and never a key: this stands in for a person. */
  "profile.you": { en: "You", ar: "أنت" },
  "profile.tapAvatar": { en: "Tap to set your avatar", ar: "انقر لتعيين صورتك" },
  "profile.changeAvatar": { en: "Change avatar", ar: "تغيير الصورة" },
  "profile.addAvatar": { en: "Add an avatar", ar: "إضافة صورة" },
  /* The number is interpolated, so the digits are Western in both halves. */
  "profile.numberAria": {
    en: "Your RELAY number is {number} — open number settings",
    ar: "رقمك في RELAY هو {number} — افتح إعدادات الرقم",
  },
  "profile.showQr": {
    en: "Show the QR code for your number",
    ar: "عرض رمز QR الخاص برقمك",
  },
  "profile.shareByQr": { en: "Share your number by QR", ar: "شارك رقمك عبر رمز QR" },
  "profile.copyMyNumber": { en: "Copy your number", ar: "نسخ رقمك" },

  // ── Pane titles. One map, so a pane's header and the row that opens it cannot drift. ──
  "profile.paneName": { en: "Name & photo", ar: "الاسم والصورة" },
  "profile.paneNumber": { en: "My RELAY number", ar: "رقمي في RELAY" },
  /* STATUS, not story — this pane opens the away/travel picker (v2.101.0). */
  "profile.paneStatus": { en: "Status", ar: "الحالة" },
  "profile.paneAbout": { en: "About & contact info", ar: "نبذة وبيانات التواصل" },
  "profile.panePin": { en: "Sign-in PIN", ar: "رمز الدخول" },
  "profile.paneLock": { en: "App lock", ar: "قفل التطبيق" },
  "profile.paneDevices": { en: "Devices", ar: "الأجهزة" },
  /* STORY, not status — this one gates who can watch an ephemeral post. */
  "profile.panePrivacy": { en: "Story privacy", ar: "خصوصية القصص" },
  "profile.paneNotifs": { en: "Notifications", ar: "الإشعارات" },
  /* The Appearance pane reuses `appearance.title` from core.ts — the pane heading and
     the settings it contains are the same fact, and a second key would let them drift. */

  // ── Hub group headings ──
  "profile.groupAccount": { en: "Account", ar: "الحساب" },
  "profile.groupPrivacy": { en: "Privacy & security", ar: "الخصوصية والأمان" },
  "profile.groupAlerts": { en: "Alerts & appearance", ar: "التنبيهات والمظهر" },

  // ── Hub row subtitles ──
  "profile.subSetName": { en: "Set a name", ar: "عيّن اسمًا" },
  "profile.subNumber": {
    en: "{number} · QR, copy, change",
    ar: "{number} · رمز QR، نسخ، تغيير",
  },
  "profile.subAbout": {
    en: "Bio, email, mobile, links",
    ar: "نبذة، بريد، جوال، روابط",
  },
  "profile.subPin": { en: "Sign in with four digits", ar: "سجّل الدخول بأربعة أرقام" },
  "profile.subLock": {
    en: "Passcode or Face ID on this device",
    ar: "رمز قفل أو Face ID على هذا الجهاز",
  },
  "profile.subDevices": { en: "Where you're signed in", ar: "أين سجّلت دخولك" },
  "profile.subPrivacy": {
    en: "Who can watch your stories",
    ar: "من يمكنه مشاهدة قصصك",
  },
  "profile.subNotifs": {
    en: "Ringtone, push, email, Do Not Disturb",
    ar: "نغمة الرنين، الإشعارات، البريد، عدم الإزعاج",
  },
  "profile.admin": { en: "Admin", ar: "الإدارة" },
  "profile.subAdmin": {
    en: "Find an account, change its number",
    ar: "ابحث عن حساب وغيّر رقمه",
  },

  // ── The presence pill (see the header: NOT the profile-status vocabulary) ──
  "profile.presenceAvailable": { en: "Available", ar: "متاح" },
  "profile.presenceAway": { en: "Away", ar: "بالخارج" },
  "profile.presenceTravelling": { en: "Travelling", ar: "مسافر" },

  // ── The guest upgrade card ──
  "profile.restoreHeading": {
    en: "Restore a previous number",
    ar: "استعادة رقم سابق",
  },
  "profile.keepForever": {
    en: "Keep this number forever",
    ar: "احتفظ بهذا الرقم إلى الأبد",
  },
  "profile.keepForeverBody": {
    en: "Guest sessions end when you close your browser — this browser can restore your number afterwards, but only this one. Create an account to keep your number, contacts, and profile permanently across all your devices.",
    ar: "تنتهي جلسة الضيف بإغلاق المتصفح — ويستطيع هذا المتصفح وحده استعادة رقمك بعدها. أنشئ حسابًا لتحتفظ برقمك وجهات اتصالك وملفك الشخصي بشكل دائم على كل أجهزتك.",
  },
  "profile.regInviteTitle": {
    en: "An administrator suggested an address",
    ar: "اقترح أحد المسؤولين عنوان بريد",
  },
  "profile.regInviteBody": {
    en: "You can change it — registering only ever uses an address you confirm, and the code goes to whichever one you finish with.",
    ar: "يمكنك تغييره — لا يستخدم التسجيل إلا عنوانًا تؤكده أنت، ويصل الرمز إلى العنوان الذي تُنهي به التسجيل.",
  },
  /* THE ONE THING SOFTWARE CANNOT GUARD, SAID OUT LOUD. Nothing lets an administrator
     complete a registration — that needs a request from this browser — but nothing can
     stop somebody talking a person into an address the somebody controls. The Arabic
     has to carry the same warning, not a softer gist. */
  "profile.regInviteWarn": {
    en: "Use an address you own. Whoever can read that inbox can sign in to this number.",
    ar: "استخدم عنوانًا تملكه أنت. فمن يستطيع قراءة ذلك البريد يستطيع تسجيل الدخول إلى هذا الرقم.",
  },
  "profile.regInviteDismiss": { en: "Dismiss this suggestion", ar: "تجاهل هذا الاقتراح" },
  "profile.registerWithEmail": {
    en: "Register with email",
    ar: "التسجيل بالبريد الإلكتروني",
  },
  "profile.carryOver": {
    en: "Your current number and contacts carry over automatically.",
    ar: "ينتقل رقمك الحالي وجهات اتصالك تلقائيًا.",
  },

  // ── The guest-hold countdown. FOUR Arabic forms — see the header. ──
  "profile.guestHoldOne": {
    en: "This browser holds your guest number for {days} more day, and that resets every time you open RELAY — so it only runs down if you stop using it. Registering removes the limit entirely.",
    ar: "يحتفظ هذا المتصفح برقمك كضيف يومًا واحدًا إضافيًا، وتُجدَّد المدة كلما فتحت RELAY — فهي لا تنقص إلا إن توقفت عن استخدامه. والتسجيل يزيل هذا الحد نهائيًا.",
  },
  "profile.guestHoldTwo": {
    en: "This browser holds your guest number for {days} more days, and that resets every time you open RELAY — so it only runs down if you stop using it. Registering removes the limit entirely.",
    ar: "يحتفظ هذا المتصفح برقمك كضيف يومين إضافيين، وتُجدَّد المدة كلما فتحت RELAY — فهي لا تنقص إلا إن توقفت عن استخدامه. والتسجيل يزيل هذا الحد نهائيًا.",
  },
  "profile.guestHoldFew": {
    en: "This browser holds your guest number for {days} more days, and that resets every time you open RELAY — so it only runs down if you stop using it. Registering removes the limit entirely.",
    ar: "يحتفظ هذا المتصفح برقمك كضيف {days} أيام إضافية، وتُجدَّد المدة كلما فتحت RELAY — فهي لا تنقص إلا إن توقفت عن استخدامه. والتسجيل يزيل هذا الحد نهائيًا.",
  },
  "profile.guestHoldMany": {
    en: "This browser holds your guest number for {days} more days, and that resets every time you open RELAY — so it only runs down if you stop using it. Registering removes the limit entirely.",
    ar: "يحتفظ هذا المتصفح برقمك كضيف {days} يومًا إضافيًا، وتُجدَّد المدة كلما فتحت RELAY — فهي لا تنقص إلا إن توقفت عن استخدامه. والتسجيل يزيل هذا الحد نهائيًا.",
  },

  // ── The build stamp ──
  "profile.buildStamp": {
    en: "RELAY v{version} · auto-updates on publish",
    ar: "‏RELAY الإصدار {version} · يُحدَّث تلقائيًا عند النشر",
  },

  // ── Name & photo pane ──
  "profile.displayName": { en: "Display name", ar: "الاسم الظاهر" },
  "profile.displayNameHint": {
    en: "Shown to people you call and chat with.",
    ar: "يظهر لمن تتصل بهم وتراسلهم.",
  },
  "profile.photo": { en: "Photo", ar: "الصورة" },
  "profile.changePhoto": {
    en: "Change photo or emoji",
    ar: "تغيير الصورة أو الرمز التعبيري",
  },
  "profile.addPhoto": {
    en: "Add a photo or emoji",
    ar: "إضافة صورة أو رمز تعبيري",
  },
  /* Removing a PHOTO, not a person — `contacts.removeAction` is a different act and
     v2.105.27 keeps those verbs apart on purpose. */
  "profile.removePhoto": { en: "Remove", ar: "إزالة" },

  // ── The number pane ──
  "profile.numberCopied": { en: "Number copied", ar: "تم نسخ الرقم" },
  "profile.copyFailed": { en: "Couldn't copy the number", ar: "تعذّر نسخ الرقم" },
  "profile.yourNumber": { en: "Your RELAY number", ar: "رقمك في RELAY" },
  "profile.connectingFrom": { en: "Connecting from {country}", ar: "الاتصال من {country}" },
  "profile.copyNumber": { en: "Copy number", ar: "نسخ الرقم" },
  "profile.showQrShare": {
    en: "Show QR code to share your number",
    ar: "عرض رمز QR لمشاركة رقمك",
  },
  "profile.generating": { en: "Generating…", ar: "جارٍ التوليد…" },
  "profile.randomNumber": { en: "Random number", ar: "رقم عشوائي" },
  "profile.regenFailed": {
    en: "Couldn't regenerate — try again.",
    ar: "تعذّر توليد رقم جديد — أعد المحاولة.",
  },
  /* The new number is interpolated already grouped, so it is Western in both halves. */
  "profile.numberChanged": {
    en: "Now {number} — everyone who saved you was updated automatically.",
    ar: "رقمك الآن {number} — وقد جرى تحديث كل من حفظك لديه تلقائيًا.",
  },
  "profile.shareNumberHint": {
    en: "Share this 6-digit number for people to call or message you.",
    ar: "شارك هذا الرقم المكوّن من 6 خانات ليتصل بك الآخرون أو يراسلوك.",
  },
  "profile.regenTitle": {
    en: "Generate a new 6-digit number?",
    ar: "توليد رقم جديد من 6 خانات؟",
  },
  /* The promise this dialog makes is the reason somebody taps it, so the Arabic carries
     both halves: the propagation AND what stops working. */
  "profile.regenBody": {
    en: "Everyone who saved you as a contact is updated automatically — they keep reaching you. Your old number stops working immediately, and anyone who only has it written down elsewhere will need the new one.",
    ar: "يُحدَّث تلقائيًا كل من حفظك في جهات اتصاله — وسيظلون قادرين على الوصول إليك. أما رقمك القديم فيتوقف عن العمل فورًا، ومن يملكه مدوّنًا في مكان آخر فقط سيحتاج إلى الرقم الجديد.",
  },
  "profile.regenConfirm": { en: "Regenerate", ar: "توليد رقم جديد" },

  /* ── The account-only note. TWO WHOLE SENTENCES, never one with a swapped subject ──
     The old shape was `{what} needs a registered account.`, and a sentence chopped at
     an English seam cannot be reassembled in Arabic, where the word order differs. */
  "profile.accountOnlyPin": {
    en: "A sign-in PIN needs a registered account. Your 6-digit number, contacts and history all carry over when you register — nothing is lost.",
    ar: "يتطلب رمز الدخول حسابًا مسجّلًا. وينتقل رقمك المكوّن من 6 خانات وجهات اتصالك وسجلّك بالكامل عند التسجيل — لا يُفقد شيء.",
  },
  "profile.accountOnlyDevices": {
    en: "The device list needs a registered account. Your 6-digit number, contacts and history all carry over when you register — nothing is lost.",
    ar: "تتطلب قائمة الأجهزة حسابًا مسجّلًا. وينتقل رقمك المكوّن من 6 خانات وجهات اتصالك وسجلّك بالكامل عند التسجيل — لا يُفقد شيء.",
  },
  "profile.registerThisNumber": { en: "Register this number", ar: "سجّل هذا الرقم" },

  // ── The sign-in PIN pane ──
  "profile.pinHas": {
    en: "A 4-digit PIN signs you in instead of an email code. Four wrong tries lock the account (an email code unlocks).",
    ar: "يسجّل رمز من 4 أرقام دخولك بدل رمز البريد. وأربع محاولات خاطئة تقفل الحساب (ويفتحه رمز البريد).",
  },
  "profile.pinNone": {
    en: "Set a 4-digit PIN to sign in without waiting for an email code.",
    ar: "عيّن رمزًا من 4 أرقام لتسجّل الدخول دون انتظار رمز البريد.",
  },
  /* A SECOND, COMPLETE sentence rendered beside the one above — not a tail spliced onto
     it, which is the shape Arabic cannot re-assemble. */
  "profile.pinLocked": {
    en: "Currently LOCKED — your next email-code sign-in unlocks it.",
    ar: "الحساب مقفل حاليًا — وسيفتحه تسجيل دخولك التالي برمز البريد.",
  },
  "profile.pinChange": { en: "Change PIN", ar: "تغيير رمز الدخول" },
  "profile.pinSet": { en: "Set a PIN", ar: "تعيين رمز دخول" },
  "profile.pinRemove": { en: "Remove PIN", ar: "إزالة رمز الدخول" },
  "profile.pinNew": { en: "New PIN", ar: "رمز جديد" },
  "profile.pinRepeat": { en: "Repeat", ar: "أعد الإدخال" },
  "profile.pinLength": {
    en: "The PIN is exactly 4 digits.",
    ar: "رمز الدخول 4 أرقام بالضبط.",
  },
  "profile.pinMismatch": { en: "The PINs don't match.", ar: "الرمزان غير متطابقين." },
  "profile.pinUpdated": { en: "PIN updated.", ar: "تم تحديث رمز الدخول." },
  "profile.pinSaved": {
    en: "PIN set — you can use it at your next sign-in.",
    ar: "تم تعيين رمز الدخول — يمكنك استخدامه في تسجيل الدخول التالي.",
  },
  "profile.pinSaveFailed": { en: "Couldn't save the PIN.", ar: "تعذّر حفظ رمز الدخول." },
  "profile.pinRemoved": {
    en: "PIN removed — sign-ins use email codes.",
    ar: "تمت إزالة رمز الدخول — سيجري تسجيل الدخول برموز البريد.",
  },
  "profile.pinRemoveFailed": {
    en: "Couldn't remove the PIN.",
    ar: "تعذّرت إزالة رمز الدخول.",
  },

  // ── The devices pane ──
  "profile.devicesHint": {
    en: "Where you're signed in. Remove a device to sign it out remotely.",
    ar: "أين سجّلت دخولك. أزل جهازًا لتسجيل خروجه عن بُعد.",
  },
  "profile.deviceNone": {
    en: "This device will appear here after your next sign-in.",
    ar: "سيظهر هذا الجهاز هنا بعد تسجيل دخولك التالي.",
  },
  "profile.deviceThis": { en: "This device", ar: "هذا الجهاز" },
  /* Two interpolated values, substituted BY NAME — so Arabic is free to lead with the
     date, which it does. */
  "profile.deviceActive": {
    en: "Active {when} · added {added}",
    ar: "أُضيف في {added} · نشِط {when}",
  },
  "profile.devicePending": { en: "New sign-in waiting", ar: "طلب تسجيل دخول جديد" },
  "profile.devicePendingWarn": {
    en: "If this wasn't you, decline it — the sign-in cannot complete without your approval.",
    ar: "إن لم تكن أنت، فارفضه — لا يمكن إتمام تسجيل الدخول دون موافقتك.",
  },
  "profile.deviceApprove": { en: "Approve", ar: "موافقة" },
  "profile.deviceDecline": { en: "Decline", ar: "رفض" },
  "profile.deviceApproved": {
    en: "Device approved — it can sign in now.",
    ar: "تمت الموافقة على الجهاز — يمكنه تسجيل الدخول الآن.",
  },
  "profile.deviceApproveFailed": {
    en: "Couldn't approve that device.",
    ar: "تعذّرت الموافقة على هذا الجهاز.",
  },
  "profile.deviceDeclined": { en: "Sign-in declined.", ar: "تم رفض تسجيل الدخول." },
  "profile.deviceDeclineFailed": {
    en: "Couldn't decline that device.",
    ar: "تعذّر رفض هذا الجهاز.",
  },
  "profile.deviceSignOutThis": {
    en: "Sign out this device",
    ar: "تسجيل خروج هذا الجهاز",
  },
  "profile.deviceSignOutNamed": { en: "Sign out {name}", ar: "تسجيل خروج {name}" },
  "profile.deviceSignOutThisQ": {
    en: "Sign out this device?",
    ar: "تسجيل خروج هذا الجهاز؟",
  },
  "profile.deviceSignOutNamedQ": { en: "Sign out {name}?", ar: "تسجيل خروج {name}؟" },
  "profile.deviceSignOutThisBody": {
    en: "You'll be signed out here and returned to the start screen.",
    ar: "سيجري تسجيل خروجك هنا وستعود إلى شاشة البداية.",
  },
  "profile.deviceSignOutOtherBody": {
    en: "That device will be signed out and will need to sign in again.",
    ar: "سيجري تسجيل خروج ذلك الجهاز وسيحتاج إلى تسجيل الدخول من جديد.",
  },
  "profile.deviceSignedOut": {
    en: "Signed that device out.",
    ar: "تم تسجيل خروج ذلك الجهاز.",
  },
  "profile.deviceSignOutFailed": {
    en: "Couldn't sign that device out.",
    ar: "تعذّر تسجيل خروج ذلك الجهاز.",
  },

  // ── The notifications pane ──
  "profile.notifUnsupported": {
    en: "This browser doesn't support desktop notifications.",
    ar: "لا يدعم هذا المتصفح إشعارات سطح المكتب.",
  },
  "profile.notifOn": { en: "Notifications are on", ar: "الإشعارات مُفعَّلة" },
  "profile.notifBlocked": { en: "Notifications are blocked", ar: "الإشعارات محظورة" },
  "profile.notifOff": {
    en: "Get notified when someone calls or texts",
    ar: "تلقَّ تنبيهًا عندما يتصل بك أحد أو يراسلك",
  },
  "profile.notifOnPush": {
    en: "Call alerts reach this device even when RELAY is closed — plus a chime when the app is in another tab.",
    ar: "تصل تنبيهات المكالمات إلى هذا الجهاز حتى وRELAY مغلق — إضافةً إلى نغمة عندما يكون التطبيق في تبويب آخر.",
  },
  "profile.notifOnBasic": {
    en: "You'll see a system notification and hear a chime when the app is in another tab.",
    ar: "سيظهر لك إشعار من النظام وستسمع نغمة عندما يكون التطبيق في تبويب آخر.",
  },
  "profile.notifBlockedHint": {
    en: "Allow notifications for this site in your browser settings, then refresh.",
    ar: "اسمح بالإشعارات لهذا الموقع من إعدادات متصفحك، ثم أعد التحميل.",
  },
  "profile.notifOffHint": {
    en: "We'll ring this device for incoming calls — we never push promotional content.",
    ar: "سنُرنّ هذا الجهاز للمكالمات الواردة — ولا نرسل أي محتوى ترويجي إطلاقًا.",
  },
  /* The iOS install note BOLDS the menu item in the MIDDLE of the sentence, so it is
     rendered with `tn` and the placeholder stays INSIDE the string — Arabic orders the
     Share menu and the item differently, and a sentence chopped at the English seam
     could only be reassembled into nonsense (the v2.106.84 rule). */
  "profile.iosInstall": {
    en: "iPhone/iPad: to get rung while RELAY is closed, use Safari's Share → {item}, then open RELAY from the icon (Apple only allows call alerts for installed web apps).",
    ar: "آيفون/آيباد: لتصلك المكالمات وRELAY مغلق، افتح قائمة المشاركة في Safari واختر {item}، ثم افتح RELAY من الأيقونة (تسمح Apple بتنبيهات المكالمات للتطبيقات المثبَّتة فقط).",
  },
  "profile.iosInstallItem": {
    en: "Add to Home Screen",
    ar: "إضافة إلى الشاشة الرئيسية",
  },
  "profile.callAlertsOn": { en: "Call alerts on", ar: "تنبيهات المكالمات مُفعَّلة" },
  "profile.notifEnabled": { en: "Enabled", ar: "مُفعَّلة" },
  "profile.notifBlockedShort": { en: "Blocked in browser", ar: "محظورة في المتصفح" },
  "profile.notifRequesting": { en: "Requesting…", ar: "جارٍ الطلب…" },
  "profile.notifEnable": { en: "Enable notifications", ar: "تفعيل الإشعارات" },
  "profile.testRingtone": { en: "Test ringtone", ar: "تجربة نغمة الرنين" },
  "profile.ringtoneHint": {
    en: "RELAY's own ringtone — fixed medium volume, distinct from system sounds.",
    ar: "نغمة RELAY الخاصة — بمستوى صوت متوسط ثابت، ومميّزة عن أصوات النظام.",
  },

  // ── Email / push toggles ──
  "profile.toggleNamed": { en: "Toggle {name}", ar: "تبديل {name}" },
  "profile.prefsFailed": {
    en: "Couldn't update email notifications — try again.",
    ar: "تعذّر تحديث إشعارات البريد — أعد المحاولة.",
  },
  "profile.pushTitle": { en: "Push notifications", ar: "إشعارات الدفع" },
  "profile.pushDesc": {
    en: "Alert my devices about incoming calls and new messages while RELAY is closed.",
    ar: "نبّه أجهزتي بالمكالمات الواردة والرسائل الجديدة وRELAY مغلق.",
  },
  "profile.missedEmailTitle": { en: "Missed-call email", ar: "بريد المكالمات الفائتة" },
  "profile.missedEmailDesc": {
    en: "Email me when I miss a call while I'm offline.",
    ar: "راسلني بالبريد عندما تفوتني مكالمة وأنا غير متصل.",
  },
  "profile.messageEmailTitle": { en: "Message email", ar: "بريد الرسائل" },
  /* "We never include the message content" is a PROMISE, not a description — the Arabic
     has to state it as plainly as the English does. */
  "profile.messageEmailDesc": {
    en: "Email me when a message arrives while I'm offline — only if your devices can't be reached, at most a few times a day. We never include the message content.",
    ar: "راسلني بالبريد عند وصول رسالة وأنا غير متصل — فقط إن تعذّر الوصول إلى أجهزتك، وبضع مرات في اليوم على الأكثر. ولا نُضمّن محتوى الرسالة إطلاقًا.",
  },
  "profile.emailFooter": {
    en: "Sent to your account email. Message emails never contain the message itself.",
    ar: "تُرسل إلى بريد حسابك. ورسائل البريد لا تتضمن نص الرسالة نفسه إطلاقًا.",
  },

  // ── Story privacy ──
  "profile.privacyFailed": {
    en: "Couldn't update who can see your stories — try again.",
    ar: "تعذّر تحديث من يمكنه رؤية قصصك — أعد المحاولة.",
  },
  "profile.privacyAria": { en: "Who can see my stories", ar: "من يمكنه رؤية قصصي" },
  /* Both halves of the rule, because each answers a different worry: what this setting
     does NOT do retroactively, and that a block always wins. */
  "profile.privacyFooter": {
    en: "Applies to statuses you post from now on — anything already posted keeps the audience you chose for it. Blocking someone always hides your status from them, whichever option is set.",
    ar: "يسري على ما تنشره من الآن فصاعدًا — أما المنشور سابقًا فيحتفظ بالجمهور الذي اخترته له. وحظر أي شخص يُخفي عنه قصصك دائمًا، أيًّا كان الخيار المحدَّد.",
  },

  // ── Do Not Disturb ──
  "profile.dnd": { en: "Do Not Disturb", ar: "عدم الإزعاج" },
  "profile.dndOn": { en: "Do Not Disturb is on", ar: "وضع عدم الإزعاج مُفعَّل" },
  "profile.dndOff": { en: "Do Not Disturb is off", ar: "وضع عدم الإزعاج مُعطَّل" },
  /* "Messages still arrive" is the part people check before turning it on. */
  "profile.dndOnDesc": {
    en: "Incoming calls are auto-declined; chimes and pop-ups are silenced. Messages still arrive.",
    ar: "تُرفض المكالمات الواردة تلقائيًا، وتُكتم النغمات والنوافذ المنبثقة. أما الرسائل فتصل كالمعتاد.",
  },
  "profile.dndOffDesc": {
    en: "Silence call rings, chimes, and desktop pop-ups without going offline.",
    ar: "اكتم رنين المكالمات والنغمات ونوافذ سطح المكتب دون أن تصبح غير متصل.",
  },
  "profile.dndToggle": { en: "Toggle Do Not Disturb", ar: "تبديل وضع عدم الإزعاج" },

  // ── The app lock (see the header: «رمز القفل», never the sign-in PIN's word) ──
  "profile.lockOn": { en: "Passcode is on", ar: "رمز القفل مُفعَّل" },
  "profile.lockOff": { en: "Passcode is off", ar: "رمز القفل مُعطَّل" },
  "profile.lockOnDesc": {
    en: "RELAY asks for your code each time it opens on this device.",
    ar: "يطلب RELAY رمزك في كل مرة يُفتح فيها على هذا الجهاز.",
  },
  /* "never leaves this browser" is the reassurance that makes somebody willing to set
     one — a claim about where the hash lives, and the Arabic keeps it. */
  "profile.lockOffDesc": {
    en: "Lock RELAY behind a 4–8 digit code on this device. It's stored hashed and never leaves this browser.",
    ar: "اقفل RELAY خلف رمز من 4 إلى 8 أرقام على هذا الجهاز. يُخزَّن مُجزَّأً ولا يغادر هذا المتصفح إطلاقًا.",
  },
  "profile.lockNow": { en: "Lock now", ar: "اقفل الآن" },
  "profile.lockChange": { en: "Change passcode", ar: "تغيير رمز القفل" },
  "profile.lockRemove": { en: "Remove", ar: "إزالة" },
  "profile.lockSet": { en: "Set a passcode", ar: "تعيين رمز قفل" },
  "profile.lockNew": { en: "New passcode", ar: "رمز قفل جديد" },
  "profile.lockCode": { en: "Passcode", ar: "رمز القفل" },
  "profile.lockConfirm": { en: "Confirm", ar: "تأكيد" },
  "profile.lockPlaceholder": { en: "4–8 digits", ar: "من 4 إلى 8 أرقام" },
  "profile.lockRepeat": { en: "Repeat code", ar: "أعد إدخال الرمز" },
  "profile.lockSaving": { en: "Saving…", ar: "جارٍ الحفظ…" },
  "profile.lockUpdate": { en: "Update", ar: "تحديث" },
  "profile.lockTurnOn": { en: "Turn on", ar: "تفعيل" },
  "profile.lockShort": { en: "Use at least 4 digits.", ar: "استخدم 4 أرقام على الأقل." },
  "profile.lockMismatch": {
    en: "The two codes don't match.",
    ar: "الرمزان غير متطابقين.",
  },
  "profile.lockSaveFailed": {
    en: "Couldn't save the passcode on this device.",
    ar: "تعذّر حفظ رمز القفل على هذا الجهاز.",
  },
  "profile.lockRemoveConfirm": {
    en: "Remove the app passcode on this device?",
    ar: "إزالة رمز قفل التطبيق على هذا الجهاز؟",
  },
  "profile.bio": { en: "Face ID / fingerprint", ar: "Face ID أو البصمة" },
  "profile.bioOnDesc": {
    en: "Unlock with biometrics; your passcode still works as a fallback.",
    ar: "افتح القفل بالبصمة الحيوية؛ ويظل رمز القفل يعمل كبديل.",
  },
  "profile.bioOffDesc": {
    en: "Add a faster unlock using this device's built-in biometrics.",
    ar: "أضف طريقة أسرع لفتح القفل باستخدام البصمة الحيوية المدمجة في هذا الجهاز.",
  },
  "profile.bioToggle": { en: "Toggle biometric unlock", ar: "تبديل فتح القفل بالبصمة" },
  "profile.bioFailed": {
    en: "Couldn't set up biometric unlock on this device.",
    ar: "تعذّر إعداد فتح القفل بالبصمة على هذا الجهاز.",
  },
} as const satisfies Record<string, Entry>;
