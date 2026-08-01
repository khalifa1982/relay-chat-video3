import type { Entry } from "./types";

/**
 * The GROUP INFO sheet — name, photo, status, roster, roles, invite links, and the
 * per-device lock. One module per surface; see `dict/index.ts` for why.
 *
 * ── FOUR VOCABULARY DISTINCTIONS THIS SCREEN MUST NOT LOSE IN TRANSLATION ───────────
 * This is the densest permission surface in the app, and four pairs of English words
 * mean genuinely different things here. Collapsing any pair onto one Arabic word would
 * erase a decision the repo made deliberately, in the language where nobody reviewing
 * the English would notice:
 *
 *  1. CREATOR vs ADMIN — «المنشئ» / «مشرف». v2.104.0 chose "Creator" over the board's
 *     "OWNER" because adminship is DERIVED from having made the group and cannot be
 *     revoked. A creator and an admin can do the same things; the words are not
 *     interchangeable because one of them is a fact and the other is a grant.
 *  2. REMOVE (a member) vs REVOKE (a link) vs DELETE — «إزالة» / «إبطال» / «حذف».
 *     Removing a person and killing a bearer capability are different acts with
 *     different blast radii, and the revoke copy exists precisely to say that members
 *     who already joined STAY. `common.delete` is deliberately not reached for here.
 *  3. THE GROUP CODE vs THE APP PASSCODE — «رمز المجموعة» / «رمز قفل التطبيق». The
 *     whole safety argument of the lock is that the app passcode is the only route back
 *     from a forgotten group code; two names that read alike would undo that.
 *  4. STATUS vs STORY — «الحالة», never «قصة». `dict/status.ts` owns the ephemeral post
 *     and records why the two must stay apart (v2.101.0, corrected three times).
 *
 * ── WESTERN DIGITS, AS EVERYWHERE ELSE ───────────────────────────────────────────────
 * "6 digits", "4-digit", "7 days" and every interpolated count stay Western, per
 * v2.106.84: a substituted Western "3" beside an Arabic-Indic numeral on the same line
 * reads as a rendering fault, and a group's own ID is a number people read out loud.
 *
 * ── THE ARROW FLIPS ──────────────────────────────────────────────────────────────────
 * "Profile → App lock" is a NAVIGATION path, so its arrow follows the reading direction:
 * the Arabic half uses «←». A right-pointing arrow inside RTL prose points backwards
 * through the very sequence it is describing.
 *
 * ── WHY THE UNNAMED CASES GET THEIR OWN WHOLE SENTENCES ──────────────────────────────
 * `Added {name} to the group.` is fine — a proper noun substitutes cleanly. But the
 * English fell back to `Added them to the group.` by interpolating the bare pronoun
 * "them", and a PRONOUN is exactly the fragment that cannot be substituted across
 * languages: Arabic attaches it to the verb rather than standing it alone in the
 * object slot. So the named and unnamed cases are two complete sentences instead.
 */
export const GROUPS = {
  /* ── The sheet's frame ── */
  "groups.info": { en: "Group info", ar: "معلومات المجموعة" },
  "groups.close": { en: "Close", ar: "إغلاق" },
  "groups.untitled": { en: "Untitled group", ar: "مجموعة بلا اسم" },
  /** Only ever the AvatarPicker's initials fallback when a group has no name yet. */
  "groups.fallbackName": { en: "Group", ar: "مجموعة" },
  "groups.changePhoto": { en: "Change the group photo", ar: "تغيير صورة المجموعة" },
  "groups.choosePhoto": { en: "Choose a group photo", ar: "اختر صورة للمجموعة" },
  /* A NOUN PHRASE, not a sentence: `AvatarPicker` drops it into its own
     "Couldn't remove …" wording. Arabic puts the object in the same slot after the
     verb, so this substitutes cleanly once that component is swept too. */
  "groups.photoLabel": { en: "the group photo", ar: "صورة المجموعة" },

  /* ── Counts. The number is always interpolated and always Western. ── */
  "groups.memberCountOne": { en: "{n} member", ar: "{n} عضو" },
  "groups.memberCountMany": { en: "{n} members", ar: "{n} أعضاء" },
  "groups.onlineCount": { en: "{n} online", ar: "{n} متصل" },

  /* ── The group's own 6-digit id ── */
  "groups.copyId": { en: "Copy this group's ID", ar: "نسخ معرّف هذه المجموعة" },
  "groups.idCopied": { en: "Group ID copied.", ar: "تم نسخ معرّف المجموعة." },
  "groups.idCaption": {
    en: "· group number — dialable",
    ar: "· رقم المجموعة — يمكن الاتصال به",
  },
  "groups.noId": {
    en: "This group has no ID — it was created before group IDs existed.",
    ar: "لا يوجد معرّف لهذه المجموعة — فقد أُنشئت قبل وجود معرّفات المجموعات.",
  },

  /* ── Name and status ── */
  "groups.nameLabel": { en: "Group name", ar: "اسم المجموعة" },
  "groups.nameHint": {
    en: "Leave it blank to fall back to the members' names.",
    ar: "اتركه فارغًا ليُشتق اسم المجموعة من أسماء أعضائها.",
  },
  /* «الحالة» — the profile label. NEVER «قصة», which is the ephemeral post
     (`dict/status.ts`). */
  "groups.statusLabel": { en: "Status", ar: "الحالة" },
  "groups.statusEmptyHint": {
    en: "No status — nothing extra is shown beside the group's name.",
    ar: "لا توجد حالة — لا يظهر شيء إضافي بجانب اسم المجموعة.",
  },
  "groups.saving": { en: "Saving…", ar: "جارٍ الحفظ…" },
  "groups.saved": { en: "Saved", ar: "تم الحفظ" },
  "groups.saveFailed": {
    en: "Couldn't save that — nothing changed.",
    ar: "تعذّر الحفظ — لم يتغيّر شيء.",
  },
  "groups.changeFailed": {
    en: "Couldn't change that — nothing changed.",
    ar: "تعذّر التغيير — لم يتغيّر شيء.",
  },

  /* ── The member list ── */
  "groups.members": { en: "Members", ar: "الأعضاء" },
  "groups.loadFailed": {
    en: "Couldn't load the member list.",
    ar: "تعذّر تحميل قائمة الأعضاء.",
  },
  /* "Retry", not `common.retry`'s "Try again": Contacts, History and Messages all say
     "Retry" on this exact affordance, and unifying the spelling is a copy change nobody
     asked for. Recorded so the next person does not read this as an oversight. */
  "groups.retry": { en: "Retry", ar: "إعادة المحاولة" },
  "groups.controlsHidden": {
    en: "Your controls are hidden until this loads — nothing has changed.",
    ar: "عناصر التحكم مخفية حتى يكتمل التحميل — لم يتغيّر شيء.",
  },
  "groups.loadingMembers": { en: "Loading members…", ar: "جارٍ تحميل الأعضاء…" },
  "groups.someone": { en: "Someone", ar: "شخص ما" },
  "groups.you": { en: "you", ar: "أنت" },

  /* ── Roles. Two words, two facts — see the header. ── */
  "groups.roleCreator": { en: "Creator", ar: "المنشئ" },
  "groups.roleAdmin": { en: "Admin", ar: "مشرف" },
  /* «تعيين» (appoint) / «إلغاء الإشراف» (revoke the adminship) rather than the member
     row's «إزالة» (remove the person): taking somebody's adminship and taking somebody
     out of the group are different powers, and the buttons sit on the same row. */
  "groups.makeAdmin": { en: "Make admin", ar: "تعيين مشرفًا" },
  "groups.removeAdmin": { en: "Remove admin", ar: "إلغاء الإشراف" },

  /* ── Removing a member ── */
  "groups.remove": { en: "Remove", ar: "إزالة" },
  "groups.removing": { en: "Removing…", ar: "جارٍ الإزالة…" },
  "groups.removeMemberAria": {
    en: "Remove {name} from the group",
    ar: "إزالة {name} من المجموعة",
  },
  "groups.thisMember": { en: "this member", ar: "هذا العضو" },
  "groups.removeConfirm": {
    en: "Remove {name} from this group? They lose access to it. Messages they already sent stay — those are part of everybody's history here.",
    ar: "إزالة {name} من هذه المجموعة؟ سيفقد إمكانية الوصول إليها. أمّا الرسائل التي أرسلها فتبقى — فهي جزء من سجلّ الجميع هنا.",
  },
  "groups.keepMember": { en: "Keep them", ar: "إبقاء العضو" },
  "groups.removeFailed": { en: "Couldn't remove them.", ar: "تعذّر إزالة هذا الشخص." },

  /* ── Adding a member ── */
  "groups.addByNumber": { en: "Add by 6-digit number", ar: "إضافة برقم من 6 خانات" },
  "groups.addByNumberAria": {
    en: "Add someone to this group by their 6-digit number",
    ar: "إضافة شخص إلى هذه المجموعة برقمه المكوّن من 6 خانات",
  },
  "groups.add": { en: "Add", ar: "إضافة" },
  "groups.adding": { en: "Adding…", ar: "جارٍ الإضافة…" },
  /* Named and unnamed are two whole sentences, never one sentence with a pronoun
     interpolated into it — see the header. */
  "groups.addedNamed": {
    en: "Added {name} to the group.",
    ar: "تمت إضافة {name} إلى المجموعة.",
  },
  "groups.addedUnnamed": {
    en: "Added them to the group.",
    ar: "تمت إضافة هذا الشخص إلى المجموعة.",
  },
  "groups.alreadyNamed": {
    en: "{name} were already in this group.",
    ar: "{name} موجود في هذه المجموعة بالفعل.",
  },
  "groups.alreadyUnnamed": {
    en: "They were already in this group.",
    ar: "هذا الشخص موجود في هذه المجموعة بالفعل.",
  },
  "groups.addFailed": { en: "Couldn't add them.", ar: "تعذّر إضافة هذا الشخص." },
  "groups.joinerSeesHint": {
    en: "They'll see messages from when they join, not the history before it.",
    ar: "سيرى الرسائل من لحظة انضمامه فقط، لا ما سبقها.",
  },

  /* ── Who may do what ── */
  "groups.anyMemberEdits": {
    en: "Any member can change the name, photo and status.",
    ar: "يمكن لأي عضو تغيير الاسم والصورة والحالة.",
  },
  "groups.adminsRemoveMessages": {
    en: "Admins can also remove anyone's message.",
    ar: "كما يمكن للمشرفين إزالة رسالة أي شخص.",
  },
  "groups.noAdminsEver": {
    en: "This group was created before admins existed, so it has none. Start a new group to use admin controls.",
    ar: "أُنشئت هذه المجموعة قبل وجود المشرفين، لذا ليس لها مشرفون. أنشئ مجموعة جديدة لاستخدام أدوات الإشراف.",
  },
  "groups.membersCanAdd": {
    en: "All members can add people",
    ar: "يمكن لجميع الأعضاء إضافة أشخاص",
  },
  "groups.membersCanAddHint": {
    en: "Off = only the creator and admins can add. Removing people stays admin-only either way.",
    ar: "عند الإيقاف، يمكن للمنشئ والمشرفين وحدهم الإضافة. أمّا إزالة الأشخاص فتبقى للمشرفين في الحالتين.",
  },

  /* ── The invite link, and who it is for ── */
  "groups.audienceTitle": {
    en: "Who can join with the invite link",
    ar: "من يمكنه الانضمام عبر رابط الدعوة",
  },
  "groups.audienceAria": {
    en: "Who can join with this link",
    ar: "من يمكنه الانضمام عبر هذا الرابط",
  },
  "groups.audienceGuest": { en: "Guests only", ar: "الضيوف فقط" },
  "groups.audienceGuestHint": {
    en: "only guest accounts can join.",
    ar: "يمكن لحسابات الضيوف فقط الانضمام.",
  },
  "groups.audienceRegistered": { en: "Registered", ar: "الحسابات المسجّلة" },
  "groups.audienceRegisteredHint": {
    en: "only accounts with a verified email can join.",
    ar: "يمكن للحسابات ذات البريد المُوثّق فقط الانضمام.",
  },
  "groups.audienceAll": { en: "Everyone", ar: "الجميع" },
  "groups.audienceAllHint": {
    en: "guests and registered accounts can join.",
    ar: "يمكن للضيوف والحسابات المسجّلة الانضمام.",
  },
  /* The hint is a whole clause, so it substitutes without splitting a sentence. */
  "groups.nextLinkIs": {
    en: "The next link you create: {what}",
    ar: "الرابط التالي الذي تنشئه: {what}",
  },
  "groups.createLink": { en: "Create an invite link", ar: "إنشاء رابط دعوة" },
  "groups.createAnotherLink": { en: "Create another link", ar: "إنشاء رابط آخر" },
  "groups.creatingLink": { en: "Creating…", ar: "جارٍ الإنشاء…" },
  "groups.createLinkFailed": {
    en: "Couldn't create an invite link.",
    ar: "تعذّر إنشاء رابط دعوة.",
  },
  "groups.copyLink": { en: "Copy link", ar: "نسخ الرابط" },
  "groups.linkCopied": { en: "Link copied", ar: "تم نسخ الرابط" },
  "groups.copyFailed": {
    en: "Couldn't copy — select and copy it by hand.",
    ar: "تعذّر النسخ — حدّد الرابط وانسخه يدويًا.",
  },
  "groups.linkForRegistered": {
    en: "Only registered accounts can join with this link.",
    ar: "يمكن للحسابات المسجّلة فقط الانضمام عبر هذا الرابط.",
  },
  "groups.linkForGuests": {
    en: "Only guest accounts can join with this link.",
    ar: "يمكن لحسابات الضيوف فقط الانضمام عبر هذا الرابط.",
  },
  "groups.linkForAnyone": {
    en: "Anyone with this link can join.",
    ar: "يمكن لأي شخص لديه هذا الرابط الانضمام.",
  },
  "groups.linkExpiry": {
    en: "It expires in 7 days, and whoever joins sees only messages sent from then on.",
    ar: "تنتهي صلاحيته خلال 7 أيام، ومن ينضم لن يرى إلا الرسائل المُرسلة من تلك اللحظة فصاعدًا.",
  },
  /* «إبطال» (invalidate), deliberately NOT «إزالة» — a link is not a person, and the
     whole point of this copy is that removing the LINK removes nobody. */
  "groups.revokeAll": { en: "Revoke all invite links", ar: "إبطال كل روابط الدعوة" },
  "groups.revoke": { en: "Revoke", ar: "إبطال" },
  "groups.revoking": { en: "Revoking…", ar: "جارٍ الإبطال…" },
  "groups.keepLink": { en: "Keep it", ar: "إبقاء الرابط" },
  "groups.revokeConfirm": {
    en: "Revoke every invite link for this group? Anyone holding one can no longer join. Members who already joined stay in the group.",
    ar: "إبطال كل روابط الدعوة لهذه المجموعة؟ لن يتمكن أي شخص يحمل رابطًا من الانضمام بعد الآن. أمّا الأعضاء الذين انضموا بالفعل فيبقون في المجموعة.",
  },
  "groups.revokedToast": {
    en: "Invite links revoked — old links no longer work.",
    ar: "تم إبطال روابط الدعوة — لم تعد الروابط القديمة تعمل.",
  },
  "groups.revokeFailed": {
    en: "Couldn't revoke the invite links.",
    ar: "تعذّر إبطال روابط الدعوة.",
  },

  /* ── The per-device 4-digit lock ── */
  "groups.lockTitle": {
    en: "Lock this chat on this device",
    ar: "قفل هذه المحادثة على هذا الجهاز",
  },
  "groups.lockedBadge": { en: "Locked", ar: "مقفلة" },
  "groups.lockExplain": {
    en: "Hides the chat and its preview behind a 4-digit code on this device. It is not a permission — everyone in the group still has these messages, and your other devices still show them.",
    ar: "يُخفي المحادثة ومعاينتها خلف رمز من 4 خانات على هذا الجهاز. وهو ليس إذنًا — فكل من في المجموعة لا يزال لديه هذه الرسائل، وأجهزتك الأخرى لا تزال تعرضها.",
  },
  /* The arrow points the way the reader reads: «←» in Arabic. */
  "groups.lockNeedsPasscode": {
    en: "Set an app passcode first (Profile → App lock). It is the only way back if you forget the group code.",
    ar: "عيّن رمز قفل التطبيق أولًا (الملف الشخصي ← قفل التطبيق). فهو السبيل الوحيد للعودة إذا نسيت رمز المجموعة.",
  },
  "groups.lockSet": { en: "Set a 4-digit code", ar: "تعيين رمز من 4 خانات" },
  "groups.lockRemoveCta": { en: "Remove the lock", ar: "إزالة القفل" },
  "groups.lockNewCodeAria": { en: "New group lock code", ar: "رمز قفل جديد للمجموعة" },
  "groups.lockAnyCodeAria": {
    en: "Group lock code or app passcode",
    ar: "رمز قفل المجموعة أو رمز قفل التطبيق",
  },
  "groups.lockDo": { en: "Lock", ar: "قفل" },
  /* Its own key rather than sharing the member row's «إزالة»: removing a lock and
     removing a person are the same English word for two unrelated acts, and this file's
     whole job is to stop those collapsing together in the second language. */
  "groups.lockRemove": { en: "Remove", ar: "إزالة" },
  "groups.lockNoPreviews": {
    en: "Locked groups never show previews in the thread list.",
    ar: "المجموعات المقفلة لا تُظهر أي معاينة في قائمة المحادثات.",
  },
  "groups.lockedToast": {
    en: "Locked. It hides on this device when you reload or leave the chat.",
    ar: "تم القفل. ستُخفى على هذا الجهاز عند إعادة التحميل أو مغادرة المحادثة.",
  },
  "groups.lockBadCode": { en: "Use exactly four digits.", ar: "استخدم 4 خانات بالضبط." },
  "groups.lockNeedsPasscodeToast": {
    en: "Set an app passcode first — Profile → App lock.",
    ar: "عيّن رمز قفل التطبيق أولًا — الملف الشخصي ← قفل التطبيق.",
  },
  "groups.lockStoreFailed": {
    en: "This browser won't let RELAY store the lock.",
    ar: "هذا المتصفح لا يسمح لتطبيق RELAY بتخزين القفل.",
  },
  "groups.lockRemovedToast": {
    en: "Lock removed on this device.",
    ar: "تمت إزالة القفل على هذا الجهاز.",
  },
  "groups.lockWrongCode": {
    en: "That's not the group code or your app passcode.",
    ar: "هذا ليس رمز المجموعة ولا رمز قفل التطبيق.",
  },
} as const satisfies Record<string, Entry>;
