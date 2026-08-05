import type { Entry } from "./types";

/**
 * The STORIES surface (#156). One module per screen — see `dict/index.ts` for why.
 *
 * ── THE VOCABULARY IS v2.101.0'S AND MUST NOT DRIFT IN TRANSLATION ───────────────────
 * A STORY is the ephemeral post; a STATUS is the profile label. The owner corrected that
 * three times before it stuck, so the Arabic keeps the two apart with two different
 * words — «قصة» for the post, and the profile label lives in `dict/profile.ts`. Reaching
 * for one Arabic word for both would undo v2.101.0 in the second language, silently.
 *
 * ── WESTERN DIGITS, AS EVERYWHERE ELSE ───────────────────────────────────────────────
 * The slide counter and the view count are interpolated numbers, so they stay Western
 * for the reason v2.106.84 recorded: a substituted "2" beside an Arabic-Indic numeral on
 * the same line reads as a rendering fault.
 *
 * ── TWO ENGLISH HALVES ARE CORRECTED HERE, NOT TRANSCRIBED ───────────────────────────
 * `Status posted — …` and `This status has expired.` were the v2.101.0 vocabulary bug
 * still live on this screen: both name the EPHEMERAL POST, so both now say story. They
 * survived because `storyVsStatus.test.ts`'s sweep reads only double-quoted
 * `title`/`placeholder`/`aria-label`/`toast(...)` literals — the first was a TEMPLATE
 * literal and the second a bare JSX text node, so neither was ever inside the window.
 * Fixing the words in the dictionary is the durable half: the sentence a person reads
 * now lives here in both languages, where the sweep's blind spot cannot reach it.
 *
 * ── THE PROFILE-STATUS KEYS AT THE BOTTOM ARE A LODGER, AND SAY SO ───────────────────
 * `profileStatus.*` is the OTHER meaning of the word — the label somebody sets about
 * themselves — and it has no business sharing «قصة» with anything above it. It is
 * physically in this module only because `dict/profile.ts` was owned by a concurrent
 * contributor during this sweep and `dict/index.ts` is deliberately closed to new
 * modules; the KEY PREFIX keeps the two vocabularies apart regardless of which file
 * they sit in, which is what actually matters. The five LABELS are deliberately NOT
 * here — they already exist as `peer.profileStatus.*` and `dict/peer.ts` asks in its
 * own header that they be REUSED rather than copied, because one fact with two keys is
 * how one fact acquires two Arabic words.
 */
export const STATUS = {
  // v2.107.39: stories go through the photo/video editors; the preview's re-edit pill.
  "status.editMedia": { en: "Edit", ar: "تعديل" },
  "status.myStory": { en: "My story", ar: "قصتي" },
  "status.newStory": { en: "New story", ar: "قصة جديدة" },
  "status.close": { en: "Close", ar: "إغلاق" },
  "status.next": { en: "Next", ar: "التالي" },
  "status.previous": { en: "Previous", ar: "السابق" },
  "status.noViews": { en: "No views yet.", ar: "لا مشاهدات بعد." },
  /* `status.library` was deleted here, not left "for later". Board 4b replaced the
     single Library tab with the four-tab row (Text · Photo · Video · Audio), so nothing
     reads it — and an unread key is worse than a missing one, because it LOOKS like
     coverage: somebody counting keys would conclude this screen is more translated than
     it is (the v2.106.91 reasoning). The tab words live in `status.tab*` above. */
  "status.record": { en: "Record", ar: "تسجيل" },
  "status.allEmoji": { en: "All emoji", ar: "كل الرموز" },
  "status.caption": { en: "Add a caption…", ar: "أضف تعليقًا…" },
  "status.typeStory": { en: "Type a story…", ar: "اكتب قصة…" },
  "status.replyToStory": { en: "Reply to this story", ar: "رد على هذه القصة" },
  "status.sendReply": { en: "Send reply", ar: "إرسال الرد" },
  "status.posting": { en: "Posting…", ar: "جارٍ النشر…" },
  "status.deleting": { en: "Deleting…", ar: "جارٍ الحذف…" },
  "status.removing": { en: "Removing…", ar: "جارٍ الإزالة…" },
  /* THE TWO DELETIONS KEEP TWO DIFFERENT VERBS, in both languages: one is the author
     removing their own post, the other is a group admin removing somebody else's
     (v2.105.27). Collapsing them onto one Arabic word would erase that distinction in
     exactly the language where it matters most to be unambiguous. */
  "status.storyDeleted": { en: "Story deleted", ar: "تم حذف القصة" },
  "status.storyRemoved": { en: "Story removed", ar: "تمت إزالة القصة" },
  "status.unsupportedFile": { en: "Unsupported file.", ar: "ملف غير مدعوم." },
  "status.pickMedia": {
    en: "Pick an image, video, or audio file.",
    ar: "اختر ملف صورة أو فيديو أو صوت.",
  },
  "status.writeFirst": { en: "Write something first.", ar: "اكتب شيئًا أولًا." },
  "status.postFailed": { en: "Couldn't post your story.", ar: "تعذّر نشر قصتك." },
  "status.replyFailed": {
    en: "Couldn't send that reply. Try again.",
    ar: "تعذّر إرسال الرد. حاول مرة أخرى.",
  },
  "status.ownStory": { en: "That's your own story.", ar: "هذه قصتك أنت." },
  "status.gone": {
    en: "This story is no longer available.",
    ar: "لم تعد هذه القصة متاحة.",
  },

  // ── The strip ──
  /* Stands in for the viewer's own name on their own tile, and for the author of
     their own slide inside a group reel. It also feeds `initials()`, so it must be a
     real word rather than a placeholder. */
  "status.you": { en: "You", ar: "أنت" },
  "status.emptyStrip": {
    en: "Share a photo, video, or a line — visible for 24h to your contacts.",
    ar: "شارك صورة أو فيديو أو سطرًا — يظهر 24 ساعة لجهات اتصالك.",
  },

  // ── The composer ──
  "status.text": { en: "Text", ar: "نص" },
  /* Board 4b's three media tabs. Requested BY NAME by the change that added them, which
     could not create them itself — its own note records the near-miss it declined:
     `profile.photo` is "الصورة" WITH the definite article because it labels a row in
     Profile, so borrowing it would couple two entirely different surfaces to one key. These
     are bare nouns, which is what a tab in a row of tabs needs. */
  "status.tabPhoto": { en: "Photo", ar: "صورة" },
  "status.tabVideo": { en: "Video", ar: "فيديو" },
  "status.tabAudio": { en: "Audio", ar: "صوت" },
  "status.color": { en: "Color", ar: "اللون" },
  "status.chooseMedia": {
    en: "Tap to choose a photo, video, or audio file",
    ar: "اضغط لاختيار صورة أو فيديو أو ملف صوتي",
  },
  "status.postTo": { en: "Post to", ar: "النشر في" },
  "status.whoCanSee": { en: "Who can see this", ar: "من يمكنه رؤية هذه القصة" },
  /* Imperative, per this dictionary's own rule for buttons: an Arabic app says
     «انشر القصة», not the noun phrase a machine translation produces. */
  "status.shareStory": { en: "Share story", ar: "انشر القصة" },
  /* The fallback title for a group whose own title is empty. */
  "status.groupFallback": { en: "Group", ar: "مجموعة" },
  "status.groupAudienceNote": {
    en: "Everyone in {group} can see this for 24h, and it shows under the group — not on your own story.",
    ar: "يمكن لكل من في {group} رؤيتها لمدة 24 ساعة، وتظهر ضمن المجموعة — لا ضمن قصتك أنت.",
  },

  /* ── The audience options ────────────────────────────────────────────────────────
     `client/src/app/statusAudience.ts` is the ONE place these labels live, for the
     reason its own header records: two surfaces render them and nothing FAILS when two
     screens promise different things about one setting. That module is a plain constant
     and cannot call a hook, so it carries the English and these carry the words — the
     `labelKey` pattern, keyed on the option's own value rather than looked up by its
     text, so a copy edit cannot silently drop the translation.

     If the Profile sweep needs them for Story privacy, REUSE THESE KEYS. */
  "status.audContacts": { en: "Contacts only", ar: "جهات الاتصال فقط" },
  "status.audContactsHint": {
    en: "People in your contacts, or who have you in theirs.",
    ar: "من هم في جهات اتصالك، أو من لديهم رقمك في جهات اتصالهم.",
  },
  "status.audEveryone": { en: "Everyone", ar: "الجميع" },
  "status.audEveryoneHint": {
    en: "Anyone on RELAY who opens your profile.",
    ar: "أي شخص على RELAY يفتح ملفك الشخصي.",
  },

  /* ── The post confirmations ──────────────────────────────────────────────────────
     WHOLE SENTENCES, one per outcome, never a stem plus an interpolated tail. The
     English used to be `Status posted — ${option.posted}.`, which is a sentence
     assembled from a fragment and therefore untranslatable: Arabic does not put the
     qualifier where English does, so the two halves cannot be glued back together.
     Selecting a whole key per outcome is the `guestExpiryKey` rule. */
  "status.postedContacts": {
    en: "Story posted — visible for 24h to your contacts and anyone who's saved you.",
    ar: "تم نشر القصة — تظهر 24 ساعة لجهات اتصالك ولكل من حفظ رقمك.",
  },
  "status.postedEveryone": {
    en: "Story posted — visible for 24h to anyone on RELAY who opens your profile.",
    ar: "تم نشر القصة — تظهر 24 ساعة لأي شخص على RELAY يفتح ملفك الشخصي.",
  },
  "status.postedGroup": {
    en: "Story posted to {group} — everyone in the group can see it for 24h.",
    ar: "تم نشر القصة في {group} — يمكن لكل أعضاء المجموعة رؤيتها لمدة 24 ساعة.",
  },

  // ── The viewer ──
  /* Western digits on both sides (v2.106.84). The counter renders inside a `dir="ltr"`
     span so the two numbers keep their order whatever the page direction is. */
  "status.slideOf": { en: "{index} of {total}", ar: "{index} من {total}" },
  "status.viewers": { en: "Viewers", ar: "المشاهدون" },
  "status.seenBy": { en: "Seen by {count}", ar: "شاهدها {count}" },
  /* THE PAIR, kept together for the reason recorded above `status.storyDeleted`: the
     author's own removal and an admin's removal of somebody else's are different acts
     (v2.105.27), and they sit on the SAME screen. Splitting the pair across two modules
     — borrowing `common.delete` for one — is how the two Arabic verbs come to collapse
     into one, so both buttons live here beside the two toasts they fire. */
  "status.delete": { en: "Delete", ar: "حذف" },
  "status.removeAsAdmin": { en: "Remove as admin", ar: "إزالة بصفتك مشرفًا" },
  "status.youAreAdmin": {
    en: "You're an admin of this group",
    ar: "أنت مشرف في هذه المجموعة",
  },
  /* Both fall back into the confirmation below, so they are phrases that have to read
     naturally INSIDE that sentence rather than on their own. */
  "status.thisMember": { en: "this member", ar: "هذا العضو" },
  "status.thisGroup": { en: "this group", ar: "هذه المجموعة" },
  "status.confirmRemove": {
    en: "Remove {who}'s story from {group}? It disappears for every member. This can't be undone.",
    ar: "إزالة قصة {who} من {group}؟ ستختفي عن كل الأعضاء، ولا يمكن التراجع عن هذا.",
  },
  "status.deleteUnreachable": {
    en: "Couldn't reach the server — story not deleted.",
    ar: "تعذّر الوصول إلى الخادم — لم يتم حذف القصة.",
  },
  "status.deleteGone": {
    en: "That story is no longer there to delete — it may have already expired. Pull to refresh.",
    ar: "لم تعد هذه القصة موجودة لحذفها — ربما انتهت صلاحيتها. اسحب للتحديث.",
  },
  "status.removeGone": {
    en: "That story isn't there to remove — pull to refresh.",
    ar: "هذه القصة غير موجودة لإزالتها — اسحب للتحديث.",
  },

  // ── The reply band ──
  "status.sentTo": { en: "Sent to {name}", ar: "أُرسل إلى {name}" },
  /* Said STORY, not "status": this is the ephemeral post expiring. */
  "status.expired": { en: "This story has expired.", ar: "انتهت صلاحية هذه القصة." },
  "status.reactWith": { en: "React with {emoji}", ar: "تفاعل بـ{emoji}" },
  "status.replyTo": { en: "Reply to {name}…", ar: "رد على {name}…" },

  /* ── Relative times ──────────────────────────────────────────────────────────────
     ABBREVIATED UNITS ON BOTH SIDES, and that is what makes these translatable at all.
     English writes "3m ago", whose unit does not inflect; Arabic counts in five bands
     (zero / one / two / few / many) and «منذ 3 دقائق» vs «منذ 11 دقيقة» would need a
     whole key each. The abbreviation «د» / «س» / «ي» is INVARIANT, exactly as the
     English one is, so one key per unit is correct rather than a shortcut — and it
     matches the register of the English it replaces, which is already abbreviated
     because this line shares a row with a name and a slide counter. */
  "status.justNow": { en: "just now", ar: "الآن" },
  "status.minutesAgo": { en: "{count}m ago", ar: "منذ {count} د" },
  "status.hoursAgo": { en: "{count}h ago", ar: "منذ {count} س" },
  "status.daysAgo": { en: "{count}d ago", ar: "منذ {count} ي" },

  /* ── THE PROFILE STATUS PICKER — the other meaning of the word ────────────────────
     A STATUS is the profile label the owner named by hand: *"you are in work, vacation,
     travel, free, and you can put some notes on it… and everyone has emoji and color."*
     The five LABELS are `peer.profileStatus.*` and are reused rather than copied.

     What lives here is everything else the picker says. Each hint describes what the
     label does to your PRESENCE, so the Arabic has to keep «متاح» (reachable) and
     «بعيد» (away) apart — collapsing them would make "At work" and "Busy" read as the
     same state, which is the one distinction the hints exist to draw. */
  "profileStatus.hintWork": {
    en: "Reachable, but working — people can still call you.",
    ar: "متاح لكنك تعمل — لا يزال بإمكان الآخرين الاتصال بك.",
  },
  "profileStatus.hintVacation": {
    en: "Shows you as away as well as on vacation.",
    ar: "يُظهرك بعيدًا وفي إجازة في الوقت نفسه.",
  },
  "profileStatus.hintTravel": {
    en: "Shows you as travelling — the badge people already know.",
    ar: "يُظهرك مسافرًا — الشارة التي يعرفها الناس بالفعل.",
  },
  "profileStatus.hintFree": {
    en: "Presence decides the rest: online when you're active.",
    ar: "التواجد يحدد الباقي: متصل عندما تكون نشطًا.",
  },
  "profileStatus.hintBusy": {
    en: "Shows you as away, so people know before they dial.",
    ar: "يُظهرك بعيدًا، ليعرف الناس ذلك قبل أن يتصلوا.",
  },
  "profileStatus.none": {
    en: "No status — presence decides: online when you're active, offline otherwise.",
    ar: "بلا حالة — التواجد يحدد ذلك: متصل عندما تكون نشطًا، وغير متصل فيما عدا ذلك.",
  },
  "profileStatus.note": { en: "Note (optional)", ar: "ملاحظة (اختياري)" },
  /* A worked EXAMPLE rather than an instruction, so the Arabic is an example too. */
  "profileStatus.notePlaceholder": { en: "back Monday", ar: "أعود يوم الاثنين" },
} as const satisfies Record<string, Entry>;
