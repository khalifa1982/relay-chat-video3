/** Strings owned by the calls surface. See ./core.ts for why each area has its own file. */
import type { Entry } from "./types";

/**
 * THE IMPERATIVE CALL SURFACE — `lib/relayAssets.ts`'s markup, driven by
 * `lib/relayClient.ts`.
 *
 * ── WHY THIS MODULE SHIPPED EMPTY, AND WHAT CHANGED ──────────────────────────────
 * `dict/engine.ts` covers the REACT chrome this app draws around the engine, and its
 * header says plainly that the engine itself "writes raw DOM from plain functions, so
 * it cannot call a hook and none of its copy is reachable from this dictionary. That
 * is a real remaining gap, not an oversight." It was right about the constraint and
 * wrong about the conclusion: a plain function cannot call a hook, but it does not
 * have to — the translator can be INJECTED at the one boundary where React meets the
 * engine (`app/RelayEngine.tsx`, which already calls `useT`).
 *
 * Meanwhile this module sat as `export const CALLS = {}` while being imported and
 * spread into `dict/index.ts`, so it read as a wired surface and contributed nothing
 * — the "published value nothing consumes" antipattern this repo retired
 * `--relay-zoom` for.
 *
 * So the markup now carries `data-i18n` / `data-i18n-aria` / `data-i18n-title` /
 * `data-i18n-placeholder` attributes naming a key from HERE, and
 * `applyEngineLabels(root, t)` walks them. The key sits beside the string it
 * replaces rather than in a selector table somewhere else, which is what stops the
 * two drifting; and `engineLabels.test.ts` fails the build if the markup grows a
 * user-facing string with no key, so the NEXT control added to that bar cannot ship
 * English-only.
 *
 * ── THE ENGLISH STAYS IN THE MARKUP, DELIBERATELY ────────────────────────────────
 * Every annotated element keeps its English text. If the applier never runs — a
 * mount race, a missing provider, a key that fails to resolve — the bar reads
 * English rather than empty. That is the same fail-soft rule `useLocale` already
 * follows, and on a live call an unlabelled control is far worse than an
 * untranslated one.
 *
 * ── DISTINCTIONS A SINGLE CARELESS ARABIC WORD WOULD COLLAPSE ────────────────────
 * Each of these would leave a control that lies about what it does:
 *
 *  1. MUTE ME ≠ MUTE THEM. `calls.mute` silences your own microphone; `calls.muteAll`
 *     is a HOST action on everybody else. Both are "mute" in English. The host pair
 *     must read as an action on OTHERS, or a host taps it expecting to mute
 *     themselves and silences the room.
 *
 *  2. DECLINE ≠ REJECT ≠ NOT NOW. Declining an incoming CALL, refusing a video
 *     REQUEST mid-call, and dismissing a prompt are three different refusals on three
 *     different objects. Collapsing them onto one «رفض» makes the video-consent
 *     prompt read as though it hangs up the call.
 *
 *  3. END CALL ≠ END HELD. `calls.endCall` ends the call you are ON; `calls.endHeld`
 *     ends the OTHER one you parked. A single «إنهاء» on both is how somebody hangs
 *     up the wrong call.
 *
 *  4. SWAP ≠ MERGE. Swap moves you between two calls; Merge joins them into one. Two
 *     different outcomes, and Merge cannot be undone by tapping Swap.
 *
 *  5. VOICE/VIDEO AS A CALL KIND ≠ VIDEO AS A REQUEST. `calls.voiceCall` labels the
 *     kind of call being placed; `calls.turnOnVideo` asks the other side under the
 *     v2.81 mutual-consent protocol. The second is a question, not a state.
 *
 * ── NOT TRANSLATED, ON PURPOSE ───────────────────────────────────────────────────
 * The brand mark "RELAY" is a name and the `000000` placeholder is a digit shape —
 * neither is language. A 6-digit RELAY number renders in WESTERN digits everywhere,
 * because a number read aloud has to be the number typed.
 */
export const CALLS = {
  /* ── the standard control bar ─────────────────────────────────────────────── */
  "calls.mute": { en: "Mute", ar: "كتم" },
  "calls.unmute": { en: "Unmute", ar: "إلغاء الكتم" },
  "calls.micAria": { en: "Mute or unmute microphone", ar: "كتم الميكروفون أو إلغاء كتمه" },
  "calls.camOff": { en: "Cam off", ar: "إيقاف الكاميرا" },
  "calls.camOn": { en: "Cam on", ar: "تشغيل الكاميرا" },
  "calls.camAria": { en: "Turn camera on or off", ar: "تشغيل الكاميرا أو إيقافها" },
  "calls.flip": { en: "Flip", ar: "تبديل" },
  "calls.share": { en: "Share", ar: "مشاركة" },
  "calls.quality": { en: "Quality", ar: "الجودة" },
  "calls.stats": { en: "Stats", ar: "الإحصائيات" },
  "calls.sound": { en: "Sound", ar: "الصوت" },
  "calls.pip": { en: "PiP", ar: "نافذة عائمة" },
  "calls.filters": { en: "Filters", ar: "الفلاتر" },
  "calls.add": { en: "Add", ar: "إضافة" },
  "calls.host": { en: "Host", ar: "المضيف" },
  "calls.chat": { en: "Chat", ar: "الدردشة" },
  "calls.endCall": { en: "End Call", ar: "إنهاء المكالمة" },

  /* ── the incoming ring card ───────────────────────────────────────────────── */
  "calls.answer": { en: "Answer", ar: "رد" },
  "calls.decline": { en: "Decline", ar: "رفض المكالمة" },
  "calls.voice": { en: "Voice", ar: "صوت" },
  "calls.video": { en: "Video", ar: "فيديو" },
  "calls.voiceCall": { en: "Voice call", ar: "مكالمة صوتية" },
  /* Quick replies: each DECLINES the call and sends the line, so the wording has to
     read as something you say to the caller rather than as a call control.
     EACH ONE IS TWO KEYS, and that is not duplication: the `…` key is the LABEL on
     the button somebody chooses, and the `…Msg` key is the sentence actually SENT.
     Deriving the second from the first would mean appending English punctuation to
     an Arabic sentence, and the two are read by different people in different
     places — one by the sender picking, one by the caller receiving. */
  "calls.quickBackShortly": { en: "I'll call you back shortly", ar: "سأعاود الاتصال بك قريبًا" },
  "calls.quickBackShortlyMsg": {
    en: "I'll call you back shortly.",
    ar: "سأعاود الاتصال بك قريبًا.",
  },
  "calls.quickCantTalk": {
    en: "Can't talk right now — text me",
    ar: "لا أستطيع التحدث الآن — راسلني",
  },
  "calls.quickCantTalkMsg": {
    en: "Can't talk right now — text me.",
    ar: "لا أستطيع التحدث الآن — راسلني.",
  },
  "calls.quickOnMyWay": { en: "On my way", ar: "أنا في الطريق" },
  "calls.quickOnMyWayMsg": { en: "On my way.", ar: "أنا في الطريق." },
  "calls.customReplyPlaceholder": { en: "Or type your own…", ar: "أو اكتب رسالتك…" },
  "calls.quickSendAria": {
    en: "Send the message and decline the call",
    ar: "إرسال الرسالة ورفض المكالمة",
  },

  /* ── mutual-consent video (v2.81) ─────────────────────────────────────────── */
  /* A REQUEST, not a state — this asks the other side, so it must not read as a
     toggle you already flipped. */
  "calls.turnOnVideo": { en: "Turn on video", ar: "طلب تشغيل الفيديو" },
  /* Refusing the video REQUEST, which does NOT end the call — distinct from
     `calls.decline`, which does. */
  "calls.notNow": { en: "Not now", ar: "ليس الآن" },
  "calls.reject": { en: "Reject", ar: "رفض الطلب" },

  /* ── call waiting, hold, merge (v2.97.1) ──────────────────────────────────── */
  "calls.onHold": { en: "On hold", ar: "قيد الانتظار" },
  "calls.inCall": { en: "In call", ar: "في مكالمة" },
  "calls.swap": { en: "Swap", ar: "تبديل المكالمة" },
  "calls.merge": { en: "Merge", ar: "دمج المكالمتين" },
  /* Ends the PARKED call, never the live one. */
  "calls.endHeld": { en: "End held", ar: "إنهاء المكالمة المُعلّقة" },

  /* ── host controls — actions on OTHER people ──────────────────────────────── */
  "calls.hostControls": { en: "Host controls", ar: "أدوات المضيف" },
  "calls.muteAll": { en: "Mute all", ar: "كتم الجميع" },
  "calls.unmuteAll": { en: "Unmute all", ar: "إلغاء كتم الجميع" },
  "calls.gridView": { en: "Grid view", ar: "عرض الشبكة" },
  "calls.participant": { en: "Participant", ar: "مشارك" },

  /* ── add a person mid-call ────────────────────────────────────────────────── */
  "calls.addPerson": { en: "Add person", ar: "إضافة شخص" },
  "calls.addToCall": { en: "Add to call", ar: "إضافة إلى المكالمة" },
  "calls.enterANumber": { en: "Enter a number", ar: "أدخل رقمًا" },
  /* Western digits: the number is dialled, so the hint names the digits the keypad
     actually produces. */
  "calls.autoInviteHint": {
    en: "Invites automatically once you enter all 6 digits",
    ar: "تتم الدعوة تلقائيًا بمجرد إدخال الأرقام الستة",
  },

  /* ── registration / identity strip inside the engine ──────────────────────── */
  "calls.displayName": { en: "Display name", ar: "الاسم المعروض" },
  "calls.joinTheCall": { en: "Join the Call", ar: "انضم إلى المكالمة" },
  "calls.yourNumber": { en: "Your number", ar: "رقمك" },
  "calls.copyNumber": { en: "Copy number", ar: "نسخ الرقم" },
  "calls.pickNameGetNumber": {
    en: "Pick a name, get a number, dial anyone.",
    ar: "اختر اسمًا، واحصل على رقم، واتصل بمن تشاء.",
  },
  "calls.transmissionConnected": { en: "Transmission Connected", ar: "تم تأسيس الاتصال" },
  "calls.encryption": { en: "Encryption", ar: "التشفير" },
  "calls.recentsEmpty": {
    en: "People you call will appear here for quick redial.",
    ar: "سيظهر هنا من تتصل بهم لإعادة الاتصال السريع.",
  },

  /* ── generic controls ─────────────────────────────────────────────────────── */
  "calls.close": { en: "Close", ar: "إغلاق" },
  "calls.cancel": { en: "Cancel", ar: "إلغاء" },
  "calls.closeChat": { en: "Close chat", ar: "إغلاق الدردشة" },
  "calls.closeFilters": { en: "Close filters", ar: "إغلاق الفلاتر" },
  "calls.insertEmoji": { en: "Insert emoji", ar: "إدراج رمز تعبيري" },

  /* ── tooltips ─────────────────────────────────────────────────────────────── */
  /* A `title` is desktop-hover-only — a phone never shows one, which is exactly why
     v2.106.79 moved the add-to-contacts label out of one and into visible text. They
     are translated anyway rather than named as a remaining gap, because "the labels
     are Arabic and the tooltips are English" is the half-done state this whole batch
     exists to remove. Each one EXPLAINS its control, so it must stay longer and more
     specific than the label beneath it — collapsing a tooltip onto its own label
     would leave the control with two copies of one word and no explanation. */
  "calls.tipMic": {
    en: "Microphone — tap to mute or unmute yourself",
    ar: "الميكروفون — اضغط لكتم صوتك أو إلغاء كتمه",
  },
  "calls.tipCam": {
    en: "Camera — tap to turn your video on or off",
    ar: "الكاميرا — اضغط لتشغيل الفيديو أو إيقافه",
  },
  "calls.tipFlip": {
    en: "Switch between the front and back camera",
    ar: "التبديل بين الكاميرا الأمامية والخلفية",
  },
  "calls.tipShare": {
    en: "Share your screen with everyone on the call",
    ar: "شارك شاشتك مع كل من في المكالمة",
  },
  "calls.tipQuality": {
    en: "Video quality — switch between HD and Data saver",
    ar: "جودة الفيديو — التبديل بين الجودة العالية وتوفير البيانات",
  },
  "calls.tipStats": {
    en: "Call quality — round trip, packet loss, and whether media is going through a TURN relay",
    ar: "جودة المكالمة — زمن الذهاب والإياب، وفقد الحزم، وما إذا كانت الوسائط تمر عبر مُرحّل TURN",
  },
  "calls.tipSound": {
    en: "Sound output — loudspeaker, earpiece or Bluetooth",
    ar: "مخرج الصوت — مكبر الصوت أو سماعة الأذن أو البلوتوث",
  },
  "calls.tipPip": {
    en: "Picture-in-Picture — keeps the call visible when you switch apps",
    ar: "نافذة عائمة — تبقي المكالمة ظاهرة عند التنقل بين التطبيقات",
  },
  "calls.tipFilters": {
    en: "Camera filters — color effects, background blur, face fun",
    ar: "فلاتر الكاميرا — تأثيرات لونية، وتمويه الخلفية، وأقنعة الوجه",
  },
  "calls.tipAdd": { en: "Add another person to this call", ar: "أضف شخصًا آخر إلى هذه المكالمة" },
  "calls.tipHost": {
    en: "Host controls — mute, pin, promote or remove participants",
    ar: "أدوات المضيف — كتم المشاركين أو تثبيتهم أو ترقيتهم أو إزالتهم",
  },
  "calls.tipChat": {
    en: "In-call chat with everyone on the line",
    ar: "دردشة أثناء المكالمة مع كل من على الخط",
  },
  "calls.tipAnswerVoice": {
    en: "Answer with microphone only (camera off)",
    ar: "الرد بالميكروفون فقط (الكاميرا مغلقة)",
  },
  "calls.tipAnswerVideo": { en: "Answer with the camera on", ar: "الرد مع تشغيل الكاميرا" },
  "calls.tipDecline": { en: "Decline the call", ar: "رفض المكالمة" },
  /* v2.99.11: declining is what OFFERS the voicemail card, so the tooltip has to say
     so — otherwise Decline reads as a dead end and the caller's only remaining route
     to the person is invisible. */
  "calls.tipDeclineVoicemail": {
    en: "Decline — they'll be offered to leave you a voice message",
    ar: "رفض — وسيُعرض عليهم ترك رسالة صوتية لك",
  },
  "calls.tipQuickReply": {
    en: "Text them instead — sending declines the call",
    ar: "راسلهم بدلًا من ذلك — الإرسال يرفض المكالمة",
  },
  /* The held pair. "this call stays connected" is the load-bearing half: without it
     the control reads as though it hangs up whichever call you are listening to. */
  "calls.tipEndHeld": {
    en: "Hang up the HELD call — this call stays connected",
    ar: "إنهاء المكالمة المُعلّقة — أما هذه المكالمة فتبقى متصلة",
  },
  "calls.tipSwap": { en: "Switch to the held call", ar: "التبديل إلى المكالمة المُعلّقة" },
  "calls.tipMerge": {
    en: "Merge both calls into a conference",
    ar: "دمج المكالمتين في مكالمة جماعية",
  },
  "calls.tipCopy": { en: "Click to copy", ar: "اضغط للنسخ" },
  "calls.tipVerified": { en: "Verified account", ar: "حساب موثّق" },

  /* ── fallbacks for a peer whose name we do not have ───────────────────────── */
  /* Two DIFFERENT sentence positions, so deliberately not one key: `calls.someone` is
     a subject ("Someone is calling") and `calls.they` is a pronoun inside a longer
     line. Arabic does not share a word across those positions either. */
  "calls.someone": { en: "Someone", ar: "شخص ما" },
  "calls.they": { en: "They", ar: "هم" },

  /* ── strings the engine markup needs that the first pass missed ─────────────── */
  /* THE ON-HOLD TITLE IS ONE KEY WITH A PLACEHOLDER, NOT A SENTENCE ASSEMBLED
     AROUND A SPAN. The markup used to read `<span id=onHoldName>They</span> put you
     on hold`, which cannot be translated at all: Arabic leads with the verb, so the
     name does not sit before the same words and a sentence chopped at the English
     seam can only be reassembled into nonsense. This is the `tn()` reasoning of
     v2.106.84 applied to raw DOM — `translate` substitutes by NAME, so `{who}` is
     free to move. */
  "calls.onHoldTitle": { en: "{who} put you on hold", ar: "قام {who} بوضعك قيد الانتظار" },
  "calls.onHoldSub": {
    en: "Hang tight — you'll hear them the moment they're back",
    ar: "انتظر قليلاً — ستسمعهم فور عودتهم",
  },
  "calls.incomingCallSub": {
    en: "Incoming call · answer to hold your current call",
    ar: "مكالمة واردة · الرد سيضع مكالمتك الحالية قيد الانتظار",
  },
  "calls.wantsVideoSub": {
    en: "wants to start video — accepting turns on BOTH cameras",
    ar: "يريد بدء الفيديو — الموافقة تشغّل الكاميرتين معاً",
  },
  "calls.isCallingYou": { en: "is calling you…", ar: "يتصل بك…" },
  "calls.callingEllipsis": { en: "Calling…", ar: "جارٍ الاتصال…" },
  "calls.messageEveryone": { en: "Message everyone…", ar: "راسل الجميع…" },
  "calls.leave": { en: "Leave", ar: "مغادرة المكالمة" },

  /* THE STAGED CALL STATUS. Written by `setCallStatus`, so these cannot be markup
     annotations — the applier would overwrite a live "Connected" with the idle
     default. The engine resolves them through its injected translator and
     re-applies on a language change. */
  "calls.statusCalling": { en: "Calling…", ar: "جارٍ الاتصال…" },
  "calls.statusRinging": { en: "Ringing…", ar: "جارٍ الرنين…" },
  "calls.statusConnecting": { en: "Connecting…", ar: "جارٍ التوصيل…" },
  "calls.statusEncrypting": { en: "Securing connection…", ar: "جارٍ تأمين الاتصال…" },
  "calls.statusLive": { en: "Connected", ar: "متصل" },
  "calls.statusReconnecting": { en: "Reconnecting…", ar: "إعادة الاتصال…" },
  // ── Call Settings — "send my calls to voicemail" (v2.107.48, owner) ──────────
  "callSettings.paneTitle": { en: "Call settings", ar: "إعدادات المكالمات" },
  "callSettings.paneSub": { en: "Send calls to voicemail", ar: "تحويل المكالمات إلى البريد الصوتي" },
  "callSettings.title": { en: "Calls to voicemail", ar: "المكالمات إلى البريد الصوتي" },
  "callSettings.lede": {
    en: "Send incoming calls to your voicemail instead of ringing you. Chat is never affected — this is calls only.",
    ar: "تحويل المكالمات الواردة إلى بريدك الصوتي بدلاً من الرنين. لا تتأثر المحادثة إطلاقاً — هذا للمكالمات فقط.",
  },
  "callSettings.allTitle": { en: "Send all calls to voicemail", ar: "تحويل كل المكالمات إلى البريد الصوتي" },
  "callSettings.allDesc": {
    en: "Everyone who calls you reaches your voicemail.",
    ar: "كل من يتصل بك يصل إلى بريدك الصوتي.",
  },
  "callSettings.allOnToast": { en: "All calls now go to voicemail", ar: "كل المكالمات تُحوَّل الآن إلى البريد الصوتي" },
  "callSettings.allOffToast": { en: "Calls will ring you again", ar: "ستُرِنّ المكالمات لديك مرة أخرى" },
  "callSettings.selectedTitle": { en: "Selected contacts", ar: "جهات اتصال محددة" },
  "callSettings.selectedDesc": {
    en: "Pick the people whose calls should go to voicemail.",
    ar: "اختر الأشخاص الذين يجب تحويل مكالماتهم إلى البريد الصوتي.",
  },
  "callSettings.selectedSupersededDesc": {
    en: "All calls are going to voicemail, so these picks are paused. Turn off the switch above to use them.",
    ar: "كل المكالمات تُحوَّل إلى البريد الصوتي، لذا هذه الاختيارات متوقفة. أوقف المفتاح أعلاه لاستخدامها.",
  },
  "callSettings.searchContacts": { en: "Search contacts", ar: "بحث في جهات الاتصال" },
  "callSettings.noContacts": { en: "No contacts to show", ar: "لا توجد جهات اتصال لعرضها" },
  "callSettings.saveFailed": { en: "Couldn't save that — try again", ar: "تعذّر الحفظ — حاول مرة أخرى" },
} as const satisfies Record<string, Entry>;
