import type { Entry } from "./types";

/**
 * The PEER surfaces — the profile popup, the full-screen profile, the avatar ring
 * and the guest-expiry note (`client/src/app/PeerOverlays.tsx`).
 *
 * One module per surface — see `dict/index.ts` for why.
 *
 * ── THE STORY / STATUS VOCABULARY IS v2.101.0'S, AND THIS SCREEN WAS BREAKING IT ──────
 * A STORY is the ephemeral post; a STATUS is the profile label. Two of this screen's
 * strings called the ephemeral post a "status" — the popup avatar's `aria-label`
 * ("View X's status") and the button that opens the story viewer ("View status") — while
 * the `title` on the very same element already said "View story". Both now say STORY, in
 * both languages, and the Arabic uses «قصة» for the post exactly as `dict/status.ts` does.
 * The PROFILE LABEL keeps its own words below (`peer.profileStatus.*`), so the two ideas
 * never collapse onto one Arabic word — which is the way this correction would be undone
 * silently, in the language where nobody would notice.
 *
 * ── THE TAG CHIPS DELIBERATELY HAVE NO KEYS HERE ─────────────────────────────────────
 * They reuse `contacts.tag.*`. `dict/contacts.ts` records the reason in its own header:
 * "Family" the section heading and "Family" the chip are the SAME fact and must never be
 * able to disagree about their Arabic. Minting `peer.tag.*` would guarantee that only for
 * as long as nobody edited one of the two.
 *
 * ── WESTERN DIGITS, AS EVERYWHERE ELSE ───────────────────────────────────────────────
 * The guest countdown interpolates a number, so it stays Western (v2.106.84): an
 * Arabic-Indic numeral beside a substituted Western one reads as a rendering fault.
 *
 * ── AND THE COUNTDOWN NEEDS FOUR ARABIC FORMS, NOT TWO ───────────────────────────────
 * English needs day/days. Arabic counts differently and getting it wrong is visible to
 * every reader: 1 is singular, 2 is the DUAL («يومين»), 3–10 take the plural of paucity
 * («أيام»), and 11+ take the singular accusative («يومًا»). `guestExpiryKey` in
 * PeerOverlays.tsx picks the form; two of these share an English half, which is fine —
 * the dictionary's uniqueness rule is about KEYS.
 */
export const PEER = {
  // ── The avatar ring (PeerAvatar), on every surface that draws a face ──
  "peer.viewStory": { en: "View story", ar: "عرض القصة" },
  "peer.viewProfile": { en: "View profile", ar: "عرض الملف الشخصي" },
  /** Shown under the person's own name when the viewer saved them under a
   *  different alias — makes the alias visibly the VIEWER's label. */
  "peer.savedAs": { en: "Saved in your contacts as “{name}”", ar: "محفوظ في جهات اتصالك باسم «{name}»" },
  "peer.newStoryTap": { en: "New story — tap to view", ar: "قصة جديدة — انقر للعرض" },
  /* The possessive has no Arabic equivalent, so the name MOVES: "X's story" becomes
     "story of X". Safe because `translate` substitutes by NAME rather than by position. */
  "peer.viewNamedStory": { en: "View {name}'s story", ar: "عرض قصة {name}" },
  "peer.viewNamedProfile": {
    en: "View {name}'s profile",
    ar: "عرض الملف الشخصي لـ{name}",
  },
  "peer.viewFullProfile": { en: "View full profile", ar: "عرض الملف الشخصي الكامل" },
  /* Same reorder, the other way round: English leads with the name, Arabic ends with it. */
  "peer.fullProfileOf": { en: "{name} full profile", ar: "الملف الشخصي الكامل لـ{name}" },

  // ── Name fallbacks. Never a raw key, and never blank: these stand in for a person. ──
  "peer.someone": { en: "Someone", ar: "شخص ما" },
  "peer.guest": { en: "Guest", ar: "ضيف" },
  "peer.profile": { en: "Profile", ar: "الملف الشخصي" },
  "peer.them": { en: "them", ar: "هذا الشخص" },

  // ── The guest-expiry note ──
  "peer.guestExpiresToday": { en: "Guest number expires today", ar: "ينتهي رقم الضيف اليوم" },
  "peer.guestExpiresInDay": {
    en: "Guest number expires in 1 day",
    ar: "ينتهي رقم الضيف خلال يوم واحد",
  },
  "peer.guestExpiresInTwoDays": {
    en: "Guest number expires in 2 days",
    ar: "ينتهي رقم الضيف خلال يومين",
  },
  "peer.guestExpiresInDaysFew": {
    en: "Guest number expires in {count} days",
    ar: "ينتهي رقم الضيف خلال {count} أيام",
  },
  "peer.guestExpiresInDaysMany": {
    en: "Guest number expires in {count} days",
    ar: "ينتهي رقم الضيف خلال {count} يومًا",
  },
  /* The half that makes the figure non-frightening — a bare countdown implies one nobody
     can stop, and `touchGuestExpiry` really does push it forward on every visit. */
  "peer.guestCountdownResets": {
    en: "Opening RELAY resets the countdown",
    ar: "فتح RELAY يعيد ضبط العدّ التنازلي",
  },

  // ── The three primary actions, on both profile surfaces ──
  "peer.message": { en: "Message", ar: "رسالة" },
  "peer.voice": { en: "Voice", ar: "صوت" },
  "peer.video": { en: "Video", ar: "فيديو" },

  // ── Saving the person ──
  "peer.addToContacts": { en: "Add to contacts", ar: "أضف إلى جهات الاتصال" },
  "peer.inYourContacts": { en: "In your contacts", ar: "في جهات اتصالك" },

  // ── The label chips (board 4a). The LABELS themselves come from `contacts.tag.*`. ──
  "peer.yourLabels": { en: "Your labels", ar: "تصنيفاتك" },
  /* ONE sentence with the name inside it, never two fragments glued around an
     interpolation: the emphasised part does not sit between the same two words in Arabic,
     so a split sentence can only be re-assembled into nonsense. */
  "peer.labelsPrivate": {
    en: "Only you see these — they are never shared with {name}.",
    ar: "أنت وحدك من يرى هذه التصنيفات — ولا تتم مشاركتها أبدًا مع {name}.",
  },

  // ── The two conversation-scoped extras (present only when opened from a chat) ──
  "peer.searchChat": { en: "Search chat", ar: "البحث في المحادثة" },
  "peer.muted": { en: "Muted", ar: "مكتوم" },
  "peer.notifications": { en: "Notifications", ar: "الإشعارات" },

  // ── Chrome ──
  "peer.back": { en: "Back", ar: "رجوع" },
  "peer.close": { en: "Close", ar: "إغلاق" },

  // ── The two states the popup can be in before it has a person ──
  "peer.loadingProfile": { en: "Loading profile…", ar: "جارٍ تحميل الملف الشخصي…" },
  "peer.notOnRelay": { en: "This number isn't on RELAY.", ar: "هذا الرقم غير مسجّل على RELAY." },

  // ── Toasts ──
  "peer.added": { en: "Added to your contacts.", ar: "تمت الإضافة إلى جهات اتصالك." },
  "peer.addFailed": {
    en: "Couldn't add the contact — try again.",
    ar: "تعذّرت إضافة جهة الاتصال — أعد المحاولة.",
  },
  "peer.labelSaveFailed": {
    en: "Couldn't save that label — try again.",
    ar: "تعذّر حفظ هذا التصنيف — أعد المحاولة.",
  },
  "peer.openFailed": { en: "Couldn't open that conversation.", ar: "تعذّر فتح هذه المحادثة." },

  /* ── THE PROFILE STATUS LABEL — the OTHER meaning of the word ──────────────────────
     `PROFILE_STATUS_META` is a shared module-level constant, so it cannot call a hook and
     its `label` is finished English. These translate it AT THE RENDER SITE keyed on the
     status's own key, which is the `labelKey` pattern this dictionary already uses for
     `CATEGORY_META` — never a `text → key` lookup, which would silently drop the
     translation the moment somebody edited the English.

     If the Profile sweep needs these words too, REUSE THESE KEYS rather than minting
     `profile.status.*`: it is one fact, and two keys is how one fact acquires two Arabic
     words. */
  "peer.profileStatus.work": { en: "At work", ar: "في العمل" },
  "peer.profileStatus.vacation": { en: "On vacation", ar: "في إجازة" },
  "peer.profileStatus.travel": { en: "Travelling", ar: "مسافر" },
  "peer.profileStatus.free": { en: "Free to talk", ar: "متفرّغ للحديث" },
  "peer.profileStatus.busy": { en: "Busy", ar: "مشغول" },

  /* ── "last seen …" ──────────────────────────────────────────────────────
     ONE WHOLE KEY PER BAND rather than a sentence assembled around a count,
     for the reason `peer.guestExpiresIn*` above is: English pluralises with a
     suffix and Arabic does not — it needs one/two/few/many, and the noun
     itself changes — so `{n} minute{s}` cannot be translated at all. The band
     is chosen by `lastSeenBand` in `shared/profileFields.ts`, which is the
     SAME function the English renderer reads, so the two can never disagree
     about which band a timestamp is in.
     Every number here is interpolated and stays WESTERN (v2.106.84): a
     substituted "5" beside an Arabic-Indic numeral on one line reads as a
     rendering fault, and a clock is read aloud as the digits shown. */
  "peer.lastSeenJustNow": { en: "last seen just now", ar: "شوهد للتو" },
  "peer.lastSeenMinute": { en: "last seen 1 minute ago", ar: "شوهد قبل دقيقة واحدة" },
  "peer.lastSeenTwoMinutes": { en: "last seen 2 minutes ago", ar: "شوهد قبل دقيقتين" },
  "peer.lastSeenMinutesFew": {
    en: "last seen {count} minutes ago",
    ar: "شوهد قبل {count} دقائق",
  },
  "peer.lastSeenMinutesMany": {
    en: "last seen {count} minutes ago",
    ar: "شوهد قبل {count} دقيقة",
  },
  "peer.lastSeenToday": { en: "last seen today at {time}", ar: "شوهد اليوم في {time}" },
  "peer.lastSeenYesterday": { en: "last seen yesterday at {time}", ar: "شوهد أمس في {time}" },
  /* Two date keys rather than an optional year fragment: Arabic puts the year
     elsewhere in the phrase, so a `{year}` that is sometimes empty would leave
     a dangling separator in one language or the other. */
  "peer.lastSeenOnDate": {
    en: "last seen on {month} {day} at {time}",
    ar: "شوهد في {day} {month} الساعة {time}",
  },
  "peer.lastSeenOnDateYear": {
    en: "last seen on {month} {day}, {year} at {time}",
    ar: "شوهد في {day} {month} {year} الساعة {time}",
  },
  "peer.clockAm": { en: "AM", ar: "ص" },
  "peer.clockPm": { en: "PM", ar: "م" },
  "peer.month.0": { en: "Jan", ar: "يناير" },
  "peer.month.1": { en: "Feb", ar: "فبراير" },
  "peer.month.2": { en: "Mar", ar: "مارس" },
  "peer.month.3": { en: "Apr", ar: "أبريل" },
  "peer.month.4": { en: "May", ar: "مايو" },
  "peer.month.5": { en: "Jun", ar: "يونيو" },
  "peer.month.6": { en: "Jul", ar: "يوليو" },
  "peer.month.7": { en: "Aug", ar: "أغسطس" },
  "peer.month.8": { en: "Sep", ar: "سبتمبر" },
  "peer.month.9": { en: "Oct", ar: "أكتوبر" },
  "peer.month.10": { en: "Nov", ar: "نوفمبر" },
  "peer.month.11": { en: "Dec", ar: "ديسمبر" },

  /* ── the presence line ──────────────────────────────────────────────────
     Keyed on `peerPresenceState`, which decides WHICH state with no words in
     it, so the English `describePeerPresence` and this cannot come to disagree
     about whether somebody is idle or simply offline. `hidden` deliberately has
     NO key: a suppressed presence renders nothing at all, because "Offline" is
     still a claim about somebody the server declined to describe (v2.95). */
  "peer.presenceInCall": { en: "On a call right now", ar: "في مكالمة الآن" },
  "peer.presenceIdle": {
    en: "Away — app is in the background",
    ar: "بعيد — التطبيق في الخلفية",
  },
  "peer.presenceOnline": { en: "Online now", ar: "متصل الآن" },
  "peer.presenceOffline": { en: "Offline", ar: "غير متصل" },

  /* ── the presence DOT's own label ───────────────────────────────────────
     A SECOND, SHORTER SET RATHER THAN A REUSE OF THE FOUR ABOVE, and that is a
     decision rather than duplication. These four are the `aria-label` on an 11px
     LED — a bare state name is the whole of what a screen reader needs there —
     while the four above are a presence LINE that sits beside a name and can
     afford to say "Online now" and to explain what "Away" means. Reusing the long
     forms would have silently changed the English on seven surfaces, and the rule
     is that only the broken half moves: each `en` below is byte-identical to the
     string `presenceDot` returned before it took a key. */
  "peer.dotOnCall": { en: "On a call", ar: "في مكالمة" },
  "peer.dotOffline": { en: "Offline", ar: "غير متصل" },
  "peer.dotAway": { en: "Away", ar: "بعيد" },
  "peer.dotOnline": { en: "Online", ar: "متصل" },
  /* A full date-and-time stamp, formatted in the APP's language rather than the
     browser's — see `dateLocale.ts`. */
  "peer.presenceLastSeen": { en: "Last seen {when}", ar: "آخر ظهور {when}" },
  /* A LINE is not a person, so it reports occupancy instead of presence. Banded
     because Arabic's dual is a word rather than a numeral plus a plural noun. */
  /* The English is byte-identical to what shipped — "nobody on the line" reads
     better and is an unrequested copy change, which the byte-identity test in
     `presenceCopy.test.ts` correctly refused. Only Arabic gains a real zero form,
     because «٠ أشخاص» is not how the count is said. */
  "peer.lineNobody": { en: "Party line · 0 on the line", ar: "خط جماعي · لا أحد على الخط" },
  "peer.lineOne": { en: "Party line · 1 on the line", ar: "خط جماعي · شخص واحد على الخط" },
  "peer.lineTwo": { en: "Party line · 2 on the line", ar: "خط جماعي · شخصان على الخط" },
  "peer.lineFew": { en: "Party line · {count} on the line", ar: "خط جماعي · {count} أشخاص على الخط" },
  "peer.lineMany": { en: "Party line · {count} on the line", ar: "خط جماعي · {count} شخصًا على الخط" },

  /* ── the COMPACT "…ago", for the Contacts row ────────────────────────────
     English abbreviates to a LETTER (`5m ago`) because the row has one line and a
     measured width budget. Arabic does not abbreviate the same way, so the unit is
     a whole key rather than a suffix, and it bands one/two/few/many like every
     other count here — `٢ ساعة` is wrong where `ساعتان` is right.

     THE ARABIC IS DELIBERATELY NOT THE LONG FORM: the row is the tightest surface
     in the app, so this reads "قبل ٥ د" rather than "قبل ٥ دقائق"; the popup one tap
     away carries the full sentence. Western digits, per v2.106.84. */
  "peer.agoNever": { en: "never", ar: "أبدًا" },
  "peer.agoJustNow": { en: "just now", ar: "الآن" },
  "peer.agoMinuteOne": { en: "1m ago", ar: "قبل دقيقة" },
  "peer.agoMinuteTwo": { en: "2m ago", ar: "قبل دقيقتين" },
  "peer.agoMinuteFew": { en: "{count}m ago", ar: "قبل {count} د" },
  "peer.agoMinuteMany": { en: "{count}m ago", ar: "قبل {count} د" },
  "peer.agoHourOne": { en: "1h ago", ar: "قبل ساعة" },
  "peer.agoHourTwo": { en: "2h ago", ar: "قبل ساعتين" },
  "peer.agoHourFew": { en: "{count}h ago", ar: "قبل {count} س" },
  "peer.agoHourMany": { en: "{count}h ago", ar: "قبل {count} س" },
  "peer.agoDayOne": { en: "1d ago", ar: "قبل يوم" },
  "peer.agoDayTwo": { en: "2d ago", ar: "قبل يومين" },
  "peer.agoDayFew": { en: "{count}d ago", ar: "قبل {count} أيام" },
  "peer.agoDayMany": { en: "{count}d ago", ar: "قبل {count} يومًا" },
} as const satisfies Record<string, Entry>;
