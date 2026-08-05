/**
 * Strings owned by the Contacts screen.
 *
 * ── THE TAG LABELS ARE HERE, AND THAT IS WHAT MAKES THIS MODULE MORE THAN A LIST ──
 * `TAG_META` is a module-level constant carrying each tag's label beside its icon
 * and tint. A constant cannot call a hook, so the label becomes a KEY the render
 * site translates — which is also the honest shape: "Family" the section heading
 * and "Family" the row chip are the SAME fact and must never be able to disagree
 * about their Arabic.
 *
 * ── "Everyone else", NOT "All contacts" ──
 * v2.106.38 renamed that bucket in English because it is `!favourite && no tags`,
 * so "All contacts" was a false claim about somebody's own directory. The Arabic
 * carries the same narrowing ("البقية") rather than the literal "الكل", or the
 * translation would reintroduce the bug the rename fixed.
 *
 * ── THE COUNTS ARE BANDED, NOT INTERPOLATED INTO ONE SENTENCE ──
 * English needs one/other and Arabic needs zero/one/two/few/many, so `{count} online`
 * cannot be one string with a number dropped into it: at 2 Arabic wants the DUAL
 * ("متصلان", no numeral at all), at 3-10 the plural genitive, and at 11+ the singular
 * accusative. A whole key is selected per band — the shape `guestExpiryKey` established
 * — which is also what keeps "1 online" from reading as "1 onlines" in English.
 *
 * See ./auth.ts for the Western-digits and imperative-verb rules, which hold here.
 */
import type { Entry } from "./types";

export const CONTACTS = {
  // ── Tags: one label, two renderers (section heading + row chip) ──
  "contacts.tag.vip": { en: "VIP", ar: "شخصية مهمة" },
  "contacts.tag.family": { en: "Family", ar: "العائلة" },
  "contacts.tag.friend": { en: "Friends", ar: "الأصدقاء" },
  "contacts.tag.team": { en: "Team", ar: "الفريق" },

  // ── Section headings ──
  "contacts.online": { en: "Online", ar: "متصل" },
  "contacts.favorites": { en: "Favorites", ar: "المفضلة" },
  "contacts.everyoneElse": { en: "Everyone else", ar: "البقية" },

  /* ── The counts beside a section heading ──
     Western digits throughout: the number is interpolated, so an Eastern-Arabic
     numeral here would sit beside a substituted Western one and read as a rendering
     fault. The 1 and 2 bands carry NO placeholder in Arabic at all — "متصل واحد" and
     "متصلان" say the count in the word, which is what the language does. */
  "contacts.onlineCountOne": { en: "1 online", ar: "متصل واحد" },
  "contacts.onlineCountTwo": { en: "2 online", ar: "متصلان" },
  "contacts.onlineCountFew": { en: "{count} online", ar: "{count} متصلين" },
  "contacts.onlineCountMany": { en: "{count} online", ar: "{count} متصلًا" },
  "contacts.contactCountOne": { en: "1 contact", ar: "جهة اتصال واحدة" },
  "contacts.contactCountTwo": { en: "2 contacts", ar: "جهتا اتصال" },
  "contacts.contactCountFew": { en: "{count} contacts", ar: "{count} جهات اتصال" },
  "contacts.contactCountMany": { en: "{count} contacts", ar: "{count} جهة اتصال" },

  // ── Chrome ──
  "contacts.search": { en: "Search by name or number", ar: "ابحث بالاسم أو الرقم" },
  /* The unlit filter chip: "no label selected", not "every contact". Same word as
     History's own All tab, in its own module — one home per surface. */
  "contacts.filterAll": { en: "All", ar: "الكل" },
  "contacts.addByPin": { en: "Add by PIN", ar: "أضف برقم PIN" },
  "contacts.addContact": { en: "Add a contact", ar: "أضف جهة اتصال" },
  "contacts.addToContacts": { en: "Add to contacts", ar: "أضف إلى جهات الاتصال" },

  // ── Empty + error states (four distinct answers, never one) ──
  "contacts.loadFailed": { en: "Couldn't load your contacts", ar: "تعذّر تحميل جهات اتصالك" },
  /* The half that stops a failed read reading as a lost address book. */
  "contacts.loadFailedHint": {
    en: "Your saved contacts are still there — this device just couldn't reach them.",
    ar: "جهات اتصالك المحفوظة ما زالت موجودة — هذا الجهاز فقط لم يستطع الوصول إليها.",
  },
  "contacts.noMatches": { en: "No matches", ar: "لا نتائج" },
  "contacts.noneInLabel": { en: "Nothing in this label", ar: "لا شيء في هذا التصنيف" },
  "contacts.none": { en: "No contacts yet", ar: "لا جهات اتصال بعد" },
  "contacts.noneHint": {
    en: "Save someone's number to call or message them in one tap.",
    ar: "احفظ رقم أحدهم لتتصل به أو تراسله بلمسة واحدة.",
  },
  /* BOTH narrowings can be live at once, so there are three sentences rather than one
     with a clause bolted on. `{all}` is the All chip's own label rather than the word
     spelled again, so the prose and the control it points at cannot come to disagree —
     and `{label}` is the tag's own label for the same reason. */
  "contacts.noMatchesInLabel": {
    en: 'Nobody matching "{query}" is labelled {label}. Tap {all} to search everyone.',
    ar: 'لا أحد ممن يطابق "{query}" مصنّف ضمن {label}. اضغط {all} للبحث في الجميع.',
  },
  "contacts.noMatchesFor": {
    en: 'Nobody matches "{query}".',
    ar: 'لا أحد يطابق "{query}".',
  },
  "contacts.noneWithLabel": {
    en: "None of your contacts are labelled {label}. Tap {all} to see everyone.",
    ar: "لا أحد من جهات اتصالك مصنّف ضمن {label}. اضغط {all} لعرض الجميع.",
  },

  // ── Row actions ──
  "contacts.message": { en: "Message", ar: "رسالة" },
  "contacts.voiceCall": { en: "Voice call", ar: "مكالمة صوتية" },
  "contacts.videoCall": { en: "Video call", ar: "مكالمة فيديو" },
  "contacts.moreOptions": { en: "More options", ar: "خيارات أخرى" },
  "contacts.onACall": { en: "On a call right now", ar: "في مكالمة الآن" },
  "contacts.block": { en: "Block", ar: "حظر" },
  "contacts.unblock": { en: "Unblock", ar: "إلغاء الحظر" },
  // v2.107.48 (owner) — per-contact "send this person's calls to voicemail".
  "contacts.callsVoicemailOn": { en: "Send calls to voicemail", ar: "تحويل المكالمات إلى البريد الصوتي" },
  "contacts.callsVoicemailOff": { en: "Stop sending to voicemail", ar: "إيقاف التحويل إلى البريد الصوتي" },
  "contacts.favorite": { en: "Favorite", ar: "إضافة إلى المفضلة" },
  "contacts.unfavorite": { en: "Unfavorite", ar: "إزالة من المفضلة" },
  "contacts.edit": { en: "Edit", ar: "تعديل" },
  "contacts.category": { en: "Category", ar: "التصنيف" },

  /* ── The row's presence line ──
     `presence.onCall` and `presence.away` are reused verbatim at the render site: they
     are the app's shared words for those two states and their English already matches
     this row exactly, so a contacts-local copy would only be a second Arabic word for
     one state. The bare "online" is NOT `presence.online` ("online now") — a different
     English phrase, so it gets its own entry rather than a silent copy change to a row
     whose width was measured. "blocked" is not a presence state at all. */
  "contacts.rowOnline": { en: "online", ar: "متصل" },
  /* ONE key for the whole line. `{ago}` is substituted by name, so Arabic — which
     leads with the verb — puts it where the sentence wants it rather than where
     English happens to leave a gap. Splitting this into "last seen" + a duration is
     the fragment-assembly the dictionary forbids outright. */
  "contacts.rowLastSeen": { en: "last seen {ago}", ar: "آخر ظهور {ago}" },
  "contacts.blocked": { en: "blocked", ar: "محظور" },

  // ── Remove confirmation ──
  "contacts.removeTitle": { en: "Remove contact?", ar: "إزالة جهة الاتصال؟" },
  /* The NAMED variant. Two sentences rather than one interpolated blob, because
     Arabic puts the subject before the verb here and English does not — a split
     version could not express both orders. */
  "contacts.removeNamed": {
    en: "{name} will be removed from your contacts. This can't be undone.",
    ar: "ستتم إزالة {name} من جهات اتصالك. لا يمكن التراجع عن ذلك.",
  },
  "contacts.removeAction": { en: "Remove", ar: "إزالة" },
  "contacts.removeBody": {
    en: "This contact will be removed. This can't be undone.",
    ar: "ستتم إزالة جهة الاتصال هذه. لا يمكن التراجع عن ذلك.",
  },
  /* The blocked-contact warning. v2.99.28: the block LIVES on the contact row, so
     removing it silently unblocks them — the whole point of this sentence is that
     the consequence is stated BEFORE the tap, so the Arabic must state it too. */
  "contacts.removeBlockedBody": {
    en: "Heads up: this contact is blocked. Because the block lives on the contact, removing them also unblocks them — they'll be able to call and message you again. Keep them blocked instead if you just want them out of sight.",
    ar: "تنبيه: جهة الاتصال هذه محظورة. لأن الحظر مخزّن على جهة الاتصال، فإن إزالتهم تلغي حظرهم أيضًا — سيتمكنون من الاتصال بك ومراسلتك مجددًا. أبقهم محظورين بدلًا من ذلك إن كنت تريد إخفاءهم فقط.",
  },

  // ── The edit / add sheet ──
  "contacts.editTitle": { en: "Edit contact", ar: "تعديل جهة الاتصال" },
  "contacts.editBody": { en: "Edit this contact's details.", ar: "عدّل تفاصيل جهة الاتصال هذه." },
  "contacts.addBody": {
    en: "Add a contact by their 6-digit RELAY number.",
    ar: "أضف جهة اتصال برقم RELAY المكوّن من 6 خانات.",
  },
  "contacts.name": { en: "Friend's name", ar: "اسم الصديق" },
  "contacts.company": { en: "Company", ar: "الشركة" },
  "contacts.jobTitle": { en: "Title", ar: "المسمّى الوظيفي" },
  "contacts.close": { en: "Close", ar: "إغلاق" },
  "contacts.relayNumber": { en: "RELAY number", ar: "رقم RELAY" },
  /* Western digits: the number a person reads out loud has to be the number they type
     (the rule ./auth.ts records), so the example is the same six digits in both. */
  "contacts.numberPlaceholder": { en: "e.g. 482015", ar: "مثال: 482015" },
  "contacts.numberHint": {
    en: "Type a 6-digit RELAY number to preview the user.",
    ar: "اكتب رقم RELAY المكوّن من 6 خانات لمعاينة المستخدم.",
  },
  "contacts.noSuchUser": {
    en: "No RELAY user with this number",
    ar: "لا يوجد مستخدم RELAY بهذا الرقم",
  },
  "contacts.noSuchUserHint": {
    en: "You can still save it — they'll show up once they register.",
    ar: "يمكنك حفظه على أي حال — سيظهرون بمجرد تسجيلهم.",
  },
  "contacts.displayName": { en: "Display name", ar: "الاسم المعروض" },
  "contacts.email": { en: "Email", ar: "البريد الإلكتروني" },
  "contacts.phone": { en: "Phone", ar: "الهاتف" },
  "contacts.jobTitleLabel": { en: "Title / role", ar: "المسمّى الوظيفي / الدور" },
  "contacts.website": { en: "Website", ar: "الموقع الإلكتروني" },
  "contacts.birthday": { en: "Birthday", ar: "تاريخ الميلاد" },
  "contacts.birthdayPlaceholder": { en: "e.g. Mar 14", ar: "مثال: 14 مارس" },
  "contacts.notes": { en: "Notes", ar: "ملاحظات" },

  // ── Toasts ──
  "contacts.saveFailed": { en: "Couldn't save that change.", ar: "تعذّر حفظ هذا التغيير." },
  "contacts.removeFailed": {
    en: "Couldn't remove that contact — try again.",
    ar: "تعذّرت إزالة جهة الاتصال — أعد المحاولة.",
  },
  "contacts.openFailed": {
    en: "Couldn't open that conversation.",
    ar: "تعذّر فتح هذه المحادثة.",
  },
} as const satisfies Record<string, Entry>;
