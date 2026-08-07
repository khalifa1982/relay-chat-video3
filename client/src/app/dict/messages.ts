/**
 * Strings owned by the Messages screen — the thread list, the conversation, the
 * composer, and the five confirmations.
 *
 * ── THE FIVE CONFIRMATIONS SAY FIVE DIFFERENT THINGS, AND THE ARABIC KEEPS THEM APART ──
 * "Delete for me" / "Unsend" / "Remove for everyone" (admin) / "Delete this chat" /
 * "Archive" destroy different amounts, for different people, with different
 * reversibility. Their English was written so the difference is unmistakable
 * (v2.102.2, v2.104.0). Collapsing two of them onto one Arabic verb — "حذف" for all
 * of them — would undo that work in the language, so each carries its own phrasing:
 * حذف عندي / التراجع عن الإرسال / إزالة للجميع.
 *
 * ── "Delete this chat" IS NOT DESTRUCTIVE AND MUST NOT READ AS IF IT WERE ──
 * v2.103.0 makes the thread come back by itself the moment anybody messages again,
 * and the sentence exists to say so. The Arabic says so too, or the one dialog in
 * this file that is deliberately NOT red would start reading like the four that are.
 *
 * See ./auth.ts for the Western-digits rule — every countdown and count here is
 * interpolated.
 *
 * ── COUNTS REUSE `groups.*` RATHER THAN MINTING A SECOND VOCABULARY ──────────────────
 * "{n} members" and "{n} online" already exist as `groups.memberCountOne/Many` and
 * `groups.onlineCount`, rendered by the group-info sheet. Keys are global, so the
 * conversation header reads them directly instead of adding `msg.*` twins: two keys for
 * one noun is how the sheet and the header come to describe the same group differently,
 * and the Arabic plural decision then has to be made twice. That decision is the house's
 * existing TWO-band one (singular / «أعضاء» for everything above it) rather than the
 * four-band treatment `peer.guestExpiry*` uses — followed here for consistency with the
 * surface that already ships it, not re-litigated.
 *
 * ── THE SECONDS BANDS ARE REAL, THOUGH ───────────────────────────────────────────────
 * The disappearing-message copy SPELLS OUT "seconds", and the values it can carry are
 * 5, 10 and 30 — which straddle an Arabic band boundary: 3–10 take the plural of paucity
 * («ثوانٍ») and 11+ the singular accusative («ثانية»). `expireSecondsKey` in Messages.tsx
 * picks the whole key; the two English halves are identical, which is fine, because the
 * dictionary's uniqueness rule is about KEYS.
 *
 * Everywhere the same fact is shown ABBREVIATED ("{n}s", "{n}m") no band is needed and
 * none is used: a unit symbol does not inflect in either language.
 */
import type { Entry } from "./types";

export const MESSAGES = {
  // ── Thread-list sections ──
  "msg.section.direct": { en: "Direct", ar: "مباشرة" },
  "msg.section.groups": { en: "Group chats", ar: "محادثات جماعية" },
  "msg.section.notes": { en: "Notes", ar: "ملاحظات" },
  "msg.section.archived": { en: "Archived", ar: "المؤرشفة" },

  // ── Thread-list chrome ──
  "msg.search": { en: "Search conversations", ar: "ابحث في المحادثات" },
  // v2.107.51 (owner): the thread-list top bar now names each icon under it, and
  // search hides behind one of them. These are the short labels for that row.
  "msg.tabAutoReply": { en: "Auto-reply", ar: "رد تلقائي" },
  "msg.tabSearch": { en: "Search", ar: "بحث" },
  "msg.tabStarred": { en: "Starred", ar: "المميزة" },
  "msg.tabNew": { en: "New", ar: "جديد" },
  // On the Groups tab the compose button makes a GROUP, so it names itself so.
  "msg.tabNewGroup": { en: "Group", ar: "مجموعة" },
  "msg.loadFailed": { en: "Couldn't load your conversations.", ar: "تعذّر تحميل محادثاتك." },
  "msg.groupConversation": { en: "Group conversation", ar: "محادثة جماعية" },
  "msg.notesToSelf": { en: "Notes to yourself", ar: "ملاحظات لنفسك" },
  "msg.pinned": { en: "Pinned", ar: "مثبّتة" },
  "msg.markedUnread": { en: "Marked unread", ar: "معلّمة كغير مقروءة" },
  "msg.conversation": { en: "Conversation", ar: "محادثة" },
  "msg.thisChat": { en: "this chat", ar: "هذه المحادثة" },

  // ── Read receipts ──
  "msg.read": { en: "Read", ar: "مقروءة" },
  "msg.delivered": { en: "Delivered", ar: "وصلت" },
  "msg.sent": { en: "Sent", ar: "أُرسلت" },

  // ── Swipe actions ──
  "msg.markRead": { en: "Read", ar: "مقروءة" },
  "msg.markUnread": { en: "Unread", ar: "غير مقروءة" },
  "msg.pin": { en: "Pin", ar: "تثبيت" },
  "msg.unpin": { en: "Unpin", ar: "إلغاء التثبيت" },
  "msg.mute": { en: "Mute", ar: "كتم" },
  "msg.unmute": { en: "Unmute", ar: "إلغاء الكتم" },
  "msg.delete": { en: "Delete", ar: "حذف" },
  "msg.archive": { en: "Archive", ar: "أرشفة" },
  "msg.unarchive": { en: "Unarchive", ar: "إلغاء الأرشفة" },

  // ── Delete-this-chat confirmation (RECOVERABLE — the copy says so) ──
  "msg.clearTitle": { en: "Delete this chat for you?", ar: "حذف هذه المحادثة عندك؟" },
  "msg.clearBody": {
    en: "{label} leaves your list and its messages are hidden on all your devices. Everyone else keeps the conversation, and it comes back here if they message you again.",
    ar: "ستغادر {label} قائمتك وتُخفى رسائلها على كل أجهزتك. يحتفظ الآخرون بالمحادثة، وستعود هنا إن راسلوك مجددًا.",
  },
  "msg.clearAction": { en: "Delete for me", ar: "احذفها عندي" },

  // ── Conversation header ──
  "msg.back": { en: "Back", ar: "رجوع" },
  "msg.closeSearch": { en: "Close search", ar: "إغلاق البحث" },
  "msg.searchInChat": { en: "Search in this conversation…", ar: "ابحث في هذه المحادثة…" },
  "msg.voiceCall": { en: "Voice call", ar: "مكالمة صوتية" },
  "msg.videoCall": { en: "Video call", ar: "مكالمة فيديو" },
  "msg.callGroup": { en: "Call the group", ar: "اتصل بالمجموعة" },
  "msg.videoCallGroup": { en: "Video call the group", ar: "مكالمة فيديو مع المجموعة" },

  // ── Previews (thread rows + reply quotes) ──
  "msg.photo": { en: "📷 Photo", ar: "📷 صورة" },
  "msg.video": { en: "🎬 Video", ar: "🎬 فيديو" },
  "msg.voiceMessage": { en: "🎤 Voice message", ar: "🎤 رسالة صوتية" },
  "msg.attachment": { en: "📎 Attachment", ar: "📎 مرفق" },
  "msg.message": { en: "Message", ar: "رسالة" },

  // ── Story replies ──
  "msg.repliedToTheirStory": { en: "Replied to their story", ar: "ردّ على قصتهم" },
  "msg.repliedToYourStory": { en: "Replied to your story", ar: "ردّ على قصتك" },

  // ── Disappearing / view-once ──
  "msg.disappearsIn": { en: "Disappears in {n}s", ar: "تختفي خلال {n} ث" },
  "msg.viewOnce": {
    en: "View once — gone when you leave",
    ar: "عرض واحد — تختفي عند مغادرتك",
  },
  "msg.disappearedMine": {
    en: "Viewed — this message has disappeared",
    ar: "تمت المشاهدة — اختفت هذه الرسالة",
  },
  "msg.disappeared": { en: "This message has disappeared", ar: "اختفت هذه الرسالة" },
  "msg.turnOffDisappearing": { en: "Turn off disappearing", ar: "إيقاف الاختفاء" },

  // ── Composer ──
  "msg.type": { en: "Type a message", ar: "اكتب رسالة" },
  "msg.uploading": { en: "Uploading…", ar: "جارٍ الرفع…" },
  "msg.emoji": { en: "Emoji", ar: "رموز تعبيرية" },
  "msg.attach": { en: "Attach media or a file", ar: "أرفق وسائط أو ملفًا" },
  "msg.closeAttach": { en: "Close attach menu", ar: "إغلاق قائمة الإرفاق" },
  "msg.send": { en: "Send", ar: "إرسال" },
  "msg.cancelReply": { en: "Cancel reply", ar: "إلغاء الرد" },
  "msg.removeAttachment": { en: "Remove attachment", ar: "إزالة المرفق" },
  "msg.scrollToLatest": { en: "Scroll to latest messages", ar: "انتقل إلى أحدث الرسائل" },
  "msg.scrollToLatestShort": { en: "Scroll to latest", ar: "الأحدث" },

  // ── Voice notes ──
  "msg.playVoiceNote": { en: "Play voice note", ar: "تشغيل الرسالة الصوتية" },
  "msg.pause": { en: "Pause", ar: "إيقاف مؤقت" },
  "msg.seek": { en: "Seek", ar: "تحديد الموضع" },
  "msg.downloadAudio": { en: "Download audio", ar: "تنزيل الصوت" },
  /* v2.106.89 — an honest state for a note THIS engine cannot decode (an Android
     WebM/Opus note opened on an iPhone). Says whose limitation it is, because the file
     itself is fine and the download works. */
  "msg.voiceUnsupported": { en: "Can't play this here", ar: "لا يمكن تشغيله هنا" },
  "msg.voiceUnsupportedHint": {
    en: "This device can't open this recording — download it instead.",
    ar: "لا يستطيع هذا الجهاز فتح هذا التسجيل — نزّله بدلاً من ذلك.",
  },
  "msg.discardRecording": { en: "Discard recording", ar: "تجاهل التسجيل" },
  "msg.discardRecordingHint": { en: "Discard this recording", ar: "تجاهل هذا التسجيل" },
  "msg.resumeRecording": { en: "Resume recording", ar: "استئناف التسجيل" },
  "msg.pauseRecording": { en: "Pause recording", ar: "إيقاف التسجيل مؤقتًا" },
  "msg.sendVoiceNote": { en: "Send voice note", ar: "إرسال الرسالة الصوتية" },

  // ── Media ──
  "msg.openImage": { en: "Open image", ar: "فتح الصورة" },
  "msg.playVideo": { en: "Play video", ar: "تشغيل الفيديو" },

  // ── Message actions ──
  "msg.options": { en: "Message options", ar: "خيارات الرسالة" },
  "msg.react": { en: "React to this message", ar: "تفاعل مع هذه الرسالة" },
  "msg.moreReactions": { en: "More reactions", ar: "تفاعلات أخرى" },
  "msg.closeReactions": { en: "Close reactions", ar: "إغلاق التفاعلات" },

  // ── Message info panel ──
  "msg.infoTitle": { en: "Message info", ar: "معلومات الرسالة" },
  "msg.infoReceivedNote": {
    en: "These are the times recorded on your side for a message you received.",
    ar: "هذه الأوقات مسجّلة من جهتك لرسالة استلمتها.",
  },
  // Per-post group read receipts (v2.107.35) - the info panel's group section.
  "msg.readBy": { en: "Read by", ar: "قرأها" },
  "msg.readByNone": { en: "No one has read this yet", ar: "لم يقرأها أحد بعد" },

  // ── Forward ──
  "msg.forwardTitle": { en: "Forward to…", ar: "إعادة توجيه إلى…" },
  "msg.forwardSearch": { en: "Search by name or number", ar: "ابحث بالاسم أو الرقم" },
  "msg.forwardSearchLabel": {
    en: "Search conversations to forward to",
    ar: "ابحث في المحادثات لإعادة التوجيه",
  },
  "msg.forwardNoMatch": {
    en: "No conversations match “{query}”.",
    ar: "لا توجد محادثات تطابق «{query}».",
  },
  "msg.forwardNone": { en: "No other conversations yet.", ar: "لا محادثات أخرى بعد." },
  "msg.forwarded": { en: "Forwarded", ar: "تمت إعادة التوجيه" },
  "msg.forwardFailed": { en: "Couldn't forward that message", ar: "تعذّرت إعادة توجيه الرسالة" },

  // ── Delete for me (IRREVERSIBLE — different from the chat-level one above) ──
  "msg.hideTitle": { en: "Delete this message for you?", ar: "حذف هذه الرسالة عندك؟" },
  "msg.hideBody": {
    en: "It disappears from this conversation on all your devices. Everyone else keeps it, and they aren't told. You can't get it back.",
    ar: "ستختفي من هذه المحادثة على كل أجهزتك. يحتفظ بها الآخرون ولا يُبلَّغون بذلك. لا يمكنك استرجاعها.",
  },
  "msg.hideAction": { en: "Delete for me", ar: "احذفها عندي" },
  "msg.hideFailed": {
    en: "Couldn't delete that for you — it's still here.",
    ar: "تعذّر حذفها عندك — ما زالت هنا.",
  },

  // ── Admin removal ──
  "msg.adminRemoveTitle": {
    en: "Remove this message for everyone?",
    ar: "إزالة هذه الرسالة للجميع؟",
  },
  "msg.adminRemoveBody": {
    en: "{name}'s message disappears for every member of the group. They aren't told, and it can't be undone.",
    ar: "ستختفي رسالة {name} عن كل عضو في المجموعة. لن يُبلَّغوا بذلك، ولا يمكن التراجع.",
  },
  "msg.adminRemoveAction": { en: "Remove for everyone", ar: "أزلها للجميع" },
  "msg.thisMember": { en: "This member", ar: "هذا العضو" },
  "msg.removedForEveryone": { en: "Removed for everyone", ar: "تمت الإزالة للجميع" },

  // ── Unsend ──
  "msg.unsendTitle": { en: "Unsend this message?", ar: "التراجع عن إرسال هذه الرسالة؟" },
  "msg.unsendBody": {
    en: "It will be removed for everyone in this conversation. This can't be undone.",
    ar: "ستُزال لدى كل من في هذه المحادثة. لا يمكن التراجع عن ذلك.",
  },
  "msg.unsendFailed": {
    en: "Couldn't unsend that message — restored it.",
    ar: "تعذّر التراجع عن إرسال الرسالة — تمت استعادتها.",
  },

  // ── Toasts ──
  "msg.copied": { en: "Copied", ar: "تم النسخ" },
  "msg.copyFailed": { en: "Failed to copy", ar: "تعذّر النسخ" },
  "msg.noNumberToCall": {
    en: "Nobody else in this group has a number to call.",
    ar: "لا أحد آخر في هذه المجموعة لديه رقم للاتصال به.",
  },
  "msg.callFailed": { en: "Couldn't start the call.", ar: "تعذّر بدء المكالمة." },
  "msg.tooLargeToOpen": {
    en: "This attachment is too large to open here. It hasn't been used up.",
    ar: "هذا المرفق أكبر من أن يُفتح هنا. ولم يُستهلك.",
  },
  "msg.reactionFailed": {
    en: "Couldn't save that reaction — try again.",
    ar: "تعذّر حفظ التفاعل — أعد المحاولة.",
  },
  "msg.tooLarge": { en: "File exceeds the 40 MB limit.", ar: "الملف يتجاوز حد 40 ميغابايت." },
  "msg.voiceNoteFailed": { en: "Failed to save voice note", ar: "تعذّر حفظ الرسالة الصوتية" },

  // ── Auto-reply ──
  "msg.autoReplyOn": {
    en: "Auto-reply is on while you're away",
    ar: "الرد التلقائي مفعّل أثناء غيابك",
  },
  "msg.autoReplyOff": { en: "Auto-reply is off", ar: "الرد التلقائي متوقف" },

  // ── New group sheet ──
  "msg.changeGroupPhoto": { en: "Change the group photo", ar: "تغيير صورة المجموعة" },
  "msg.chooseGroupPhoto": { en: "Choose a group photo", ar: "اختر صورة للمجموعة" },
  "msg.groupPhotoSet": { en: "Group photo set.", ar: "تم تعيين صورة المجموعة." },
  "msg.addGroupPhoto": {
    en: "Add a group photo (optional).",
    ar: "أضف صورة للمجموعة (اختياري).",
  },
  "msg.createGroup": { en: "Create group", ar: "أنشئ المجموعة" },

  /* ══════════════════════════════════════════════════════════════════════════════════
     THE REST OF THE SCREEN (2026-08-02)

     v2.106.85 wired the thread-list chrome, the confirmations and most of the composer,
     and left ~90 render sites behind — including the `+` attachment menu the owner named
     in their own words ("on the attachment inside the chat on the plus button add the
     voice note beside of the other features set as video photos"), which was built
     correctly and shipped entirely in English.
     ══════════════════════════════════════════════════════════════════════════════════ */

  // ── Thread-list states ──
  "msg.loading": { en: "Loading…", ar: "جارٍ التحميل…" },
  "msg.noGroupsYet": { en: "No groups yet.", ar: "لا مجموعات بعد." },
  "msg.startGroupHint": {
    en: "Tap the + above to start one.",
    ar: "اضغط على + بالأعلى لبدء واحدة.",
  },
  "msg.noMessagesYet": { en: "No messages yet.", ar: "لا رسائل بعد." },
  "msg.startConversationHint": {
    en: "Tap the + above to start a conversation.",
    ar: "اضغط على + بالأعلى لبدء محادثة.",
  },
  /* Same English as `msg.forwardNoMatch` on purpose — one sentence, two surfaces that
     each narrow their own list. Keyed separately so either can be reworded alone. */
  "msg.noThreadsMatch": {
    en: "No conversations match “{query}”.",
    ar: "لا توجد محادثات تطابق «{query}».",
  },
  "msg.threadStateFailed": {
    en: "Couldn't save that — nothing changed.",
    ar: "تعذّر الحفظ — لم يتغيّر شيء.",
  },

  // ── Row fallbacks. These stand in for a conversation's name, so none may be blank. ──
  "msg.group": { en: "Group", ar: "مجموعة" },
  /* The thread row's own TITLE. `msg.notesToSelf` ("Notes to yourself") is the avatar's
     aria-label and reads as a description; this is the name in the list. */
  "msg.notesToSelfName": { en: "Notes to self", ar: "ملاحظات لنفسي" },
  "msg.unknown": { en: "Unknown", ar: "غير معروف" },
  /* What a LOCKED group's row shows in place of its preview (v2.105.20). It replaces the
     words AND the sender's name, so it must not read as somebody's message. */
  "msg.locked": { en: "Locked", ar: "مقفلة" },
  "msg.noMessagesYetShort": { en: "No messages yet", ar: "لا رسائل بعد" },
  "msg.muted": { en: "Muted", ar: "مكتومة" },
  "msg.typing": { en: "typing", ar: "يكتب" },
  "msg.selectConversation": { en: "Select a conversation", ar: "اختر محادثة" },

  // ── Group-calls section (Groups tab) ──
  "msg.groupCalls": { en: "Group calls", ar: "مكالمات جماعية" },
  "msg.startGroupCall": { en: "Start a group call", ar: "ابدأ مكالمة جماعية" },

  /* ── Compact relative time ──
     UNIT SYMBOLS, not sentences: "3h" does not inflect in English and «3 س» does not in
     Arabic, so one key per unit is correct and no plural band is involved. The number is
     interpolated and therefore Western in both, per the rule above. */
  "msg.timeNow": { en: "now", ar: "الآن" },
  "msg.timeMinutes": { en: "{n}m", ar: "{n} د" },
  "msg.timeHours": { en: "{n}h", ar: "{n} س" },
  "msg.timeDays": { en: "{n}d", ar: "{n} ي" },
  /* The stamp goes INSIDE the sentence rather than being concatenated after it: Arabic
     puts «آخر ظهور» first but a language that did not would have nowhere to put it. */
  "msg.lastSeen": { en: "last seen {when}", ar: "آخر ظهور {when}" },

  // ── Conversation header presence ──
  "msg.typingNow": { en: "typing…", ar: "يكتب…" },
  "msg.away": { en: "away", ar: "غائب" },
  "msg.online": { en: "online", ar: "متصل" },
  "msg.offline": { en: "offline", ar: "غير متصل" },

  // ── In-conversation search ──
  "msg.searchHint": {
    en: "Type to search this conversation.",
    ar: "اكتب للبحث في هذه المحادثة.",
  },
  "msg.searching": { en: "Searching…", ar: "جارٍ البحث…" },
  "msg.noMessagesMatch": {
    en: "No messages match “{query}”.",
    ar: "لا توجد رسائل تطابق «{query}».",
  },
  "msg.results": { en: "Results", ar: "النتائج" },
  "msg.member": { en: "Member", ar: "عضو" },
  "msg.emptyThread": { en: "No messages yet. Say hi 👋", ar: "لا رسائل بعد. ألقِ التحية 👋" },

  /* ── Who said it ──
     «هذا الشخص» rather than a literal "them": Arabic has no neutral third-person plural
     used as a polite singular, so the demonstrative is what reads as a person here. */
  "msg.you": { en: "You", ar: "أنت" },
  "msg.them": { en: "Them", ar: "هذا الشخص" },
  /* SELF GETS ITS OWN WHOLE SENTENCE rather than "{name}" resolving to "You": «الرد على
     أنت» is ungrammatical, and there is no substitution that fixes it — the pronoun has
     to change form, which only a separate string can express. */
  "msg.replyingTo": { en: "Replying to {name}", ar: "الرد على {name}" },
  "msg.replyingToSelf": { en: "Replying to yourself", ar: "الرد على نفسك" },

  // ── Reply-quote preview of a locked message ──
  "msg.disappearingPreview": { en: "⏱ Disappearing message", ar: "⏱ رسالة تختفي" },

  // ── Voicemail bubble label (v2.88) ──
  "msg.voicemail": { en: "Voicemail", ar: "بريد صوتي" },

  // ── Self-destructing messages ──
  "msg.viewOnceShort": { en: "View once", ar: "عرض واحد" },
  "msg.disappearsAfterOpening": {
    en: "Disappears {n}s after opening",
    ar: "تختفي بعد {n} ث من الفتح",
  },
  "msg.opening": { en: "Opening…", ar: "جارٍ الفتح…" },
  "msg.tapToView": { en: "Tap to view", ar: "انقر للعرض" },
  "msg.viewOnceHint": {
    en: "Can be viewed once, then it disappears",
    ar: "يمكن عرضها مرة واحدة ثم تختفي",
  },
  "msg.disappearsAfterYouOpen": {
    en: "Disappears {n}s after you open it",
    ar: "تختفي بعد {n} ث من فتحك لها",
  },
  "msg.expireBannerOnce": {
    en: "Disappearing: they can view this ONCE — then it's gone for both of you.",
    ar: "تختفي: يمكنهم عرضها مرة واحدة فقط — ثم تُحذف لديكما معًا.",
  },
  /* 3–10 seconds: the plural of paucity. */
  "msg.expireBannerFew": {
    en: "Disappearing: gone {n} seconds after they open it.",
    ar: "تختفي: تُحذف بعد {n} ثوانٍ من فتحهم لها.",
  },
  /* 11+ seconds: the singular accusative. Same English, different Arabic — which is the
     whole reason both keys exist. */
  "msg.expireBannerMany": {
    en: "Disappearing: gone {n} seconds after they open it.",
    ar: "تختفي: تُحذف بعد {n} ثانية من فتحهم لها.",
  },
  "msg.expireToggleOff": {
    en: "Make the next message disappear",
    ar: "اجعل الرسالة التالية تختفي",
  },
  "msg.expireToggleOnce": { en: "Disappearing: view once", ar: "تختفي: عرض واحد" },
  "msg.expireToggleFew": { en: "Disappearing: {n} seconds", ar: "تختفي: {n} ثوانٍ" },
  "msg.expireToggleMany": { en: "Disappearing: {n} seconds", ar: "تختفي: {n} ثانية" },
  "msg.expireCycleHint": {
    en: "Disappearing message: tap to cycle off · view-once · 5s · 10s · 30s",
    ar: "رسالة تختفي: انقر للتنقل بين إيقاف · عرض واحد · 5 ث · 10 ث · 30 ث",
  },

  /* ── THE "+" ATTACHMENT MENU (v2.106.65, and the owner's named ask) ──
     Every row here is a THING YOU CAN ATTACH, so each is a noun phrase rather than an
     imperative — «رسالة صوتية», not «سجّل». The disabled hint is the exception: it tells
     you what to do instead, so it ends in an instruction. */
  "msg.recordVideo": { en: "Record video", ar: "تسجيل فيديو" },
  "msg.photoAndVideo": { en: "Photo & video", ar: "صورة أو فيديو" },
  "msg.attachFile": { en: "Attach file", ar: "إرفاق ملف" },
  "msg.voiceNote": { en: "Voice note", ar: "رسالة صوتية" },
  "msg.recordVoiceNoteHint": { en: "Record a voice note", ar: "سجّل رسالة صوتية" },
  "msg.voiceNoteUnsupported": {
    en: "Voice notes need a newer browser — use Attach file for an audio file instead",
    ar: "تحتاج الرسائل الصوتية إلى متصفح أحدث — استخدم «إرفاق ملف» لإرسال ملف صوتي بدلاً من ذلك",
  },

  // ── Read receipt (the tick's own title) ──
  "msg.notSent": { en: "Not sent", ar: "لم تُرسل" },

  /* ── The message ⋮ menu ──
     "Delete for me" and "Remove for everyone" reuse `msg.hideAction` /
     `msg.adminRemoveAction`: the menu item and the confirmation it opens are the SAME
     act, and giving them separate keys is how the button and the dialog come to promise
     different blast radii — the exact distinction this file's header exists to protect. */
  "msg.reply": { en: "Reply", ar: "رد" },
  "msg.reactAction": { en: "React", ar: "تفاعل" },
  "msg.copy": { en: "Copy", ar: "نسخ" },
  "msg.forward": { en: "Forward", ar: "إعادة توجيه" },
  "msg.info": { en: "Info", ar: "معلومات" },
  "msg.unsendAction": { en: "Unsend", ar: "التراجع عن الإرسال" },

  // ── Attachments ──
  "msg.imageAlt": { en: "Image", ar: "صورة" },
  "msg.videoAlt": { en: "Video", ar: "فيديو" },
  /* Voice transcripts (v2.107.31). */
  "msg.transcribe": { en: "Transcribe", ar: "نسخ الصوت إلى نص" },
  "msg.transcribing": { en: "Transcribing…", ar: "جارٍ النسخ…" },
  "msg.transcribeFailed": { en: "Couldn't transcribe that — try again.", ar: "تعذّر نسخ التسجيل — حاول مرة أخرى." },
  "msg.translating": { en: "Translating…", ar: "جارٍ الترجمة…" },
  "msg.translateFailed": { en: "Couldn't translate that — try again.", ar: "تعذّرت الترجمة — حاول مرة أخرى." },
  /* Albums (v2.107.32). */
  "msg.albumOnlyMedia": { en: "Albums can only contain photos and videos.", ar: "الألبومات تحتوي على صور وفيديوهات فقط." },
  "msg.albumTooMany": { en: "Up to 100 photos and 100 videos per album.", ar: "بحد أقصى 100 صورة و100 فيديو في الألبوم." },
  "msg.albumUploading": { en: "Uploading {done} of {total}…", ar: "جارٍ رفع {done} من {total}…" },
  "msg.albumCount": { en: "{n} items", ar: "{n} عناصر" },
  "msg.albumCaptionPh": { en: "Add a caption for this item…", ar: "أضف تعليقًا لهذا العنصر…" },
  "msg.albumEditItem": { en: "Edit", ar: "تعديل" },
  "msg.albumRemoveItem": { en: "Remove from album", ar: "إزالة من الألبوم" },
  "msg.albumAddMore": { en: "Add more", ar: "إضافة المزيد" },
  "msg.openAlbum": { en: "Open album", ar: "فتح الألبوم" },
  "msg.album": { en: "Album", ar: "ألبوم" },
  "msg.prev": { en: "Previous", ar: "السابق" },
  "msg.next": { en: "Next", ar: "التالي" },
  "msg.fileFallback": { en: "Attachment", ar: "مرفق" },
  "msg.tapToOpen": { en: "Tap to open or download", ar: "انقر للفتح أو التنزيل" },

  // ── Recording bar (short button titles; the aria-labels above are the long forms) ──
  "msg.resume": { en: "Resume", ar: "استئناف" },

  // ── Fullscreen media viewer ──
  "msg.closePreview": { en: "Close preview", ar: "إغلاق المعاينة" },
  "msg.download": { en: "Download", ar: "تنزيل" },
  /* The wording is deliberately NOT an end-to-end claim — `messages.body` is plain text
     the server searches with LIKE, so it cannot make one. Translating it must not quietly
     upgrade the promise either: «مشفّرة أثناء النقل» is in-transit and nothing more. */
  "msg.encryptedInTransit": {
    en: "Encrypted in transit · stays in the app",
    ar: "مشفّرة أثناء النقل · تبقى داخل التطبيق",
  },

  // ── Away auto-reply ──
  "msg.autoReplyFailed": {
    en: "Couldn't change auto-reply. Try again.",
    ar: "تعذّر تغيير الرد التلقائي. أعد المحاولة.",
  },
  "msg.autoReplyTitle": { en: "Auto-reply when I'm away", ar: "الرد التلقائي أثناء غيابي" },
  "msg.autoReplyLede": {
    en: "A one-time note back to anyone who messages you while you're offline.",
    ar: "ملاحظة تُرسل مرة واحدة لكل من يراسلك أثناء عدم اتصالك.",
  },
  "msg.autoReplyBody": {
    en: "If someone messages you while you're offline, RELAY replies once to let them know you'll get back to them. Off by default.",
    ar: "إذا راسلك أحد وأنت غير متصل، يرد RELAY مرة واحدة ليخبره أنك ستعود إليه. متوقف افتراضيًا.",
  },

  // ── Forward dialog copy ──
  "msg.forwardExpiringNote": {
    en: "This is a disappearing message — forwarding it would break the promise it was sent under, so it can't be forwarded.",
    ar: "هذه رسالة تختفي — إعادة توجيهها تنقض الوعد الذي أُرسلت بموجبه، لذا لا يمكن إعادة توجيهها.",
  },
  "msg.forwardHint": {
    en: "Pick a conversation. It's sent as a new message there, with its own delivery receipts.",
    ar: "اختر محادثة. سترسل هناك كرسالة جديدة، بإيصالات تسليم خاصة بها.",
  },

  // ── New-message sheet ──
  "msg.newMessage": { en: "New message", ar: "رسالة جديدة" },
  "msg.newGroup": { en: "New group", ar: "مجموعة جديدة" },
  "msg.newConversation": { en: "New conversation", ar: "محادثة جديدة" },
  "msg.conversationType": { en: "Conversation type", ar: "نوع المحادثة" },
  "msg.noteToSelf": { en: "Note to self", ar: "ملاحظة لنفسي" },
  "msg.noteToSelfHint": {
    en: "Save links, ideas, and attachments to your own thread.",
    ar: "احفظ الروابط والأفكار والمرفقات في محادثتك الخاصة.",
  },
  "msg.orMessageSomeone": { en: "or message someone", ar: "أو راسل شخصًا" },
  /* RELAY is the product name and stays Latin in both, like every other number label in
     the app — a number you read aloud has to be the number you type (v2.106.84). */
  "msg.relayNumber": { en: "RELAY number", ar: "رقم RELAY" },
  "msg.numberOrName": { en: "Number or name", ar: "رقم أو اسم" },
  "msg.searchContactsLabel": {
    en: "Search your contacts by number or name",
    ar: "ابحث في جهات اتصالك بالرقم أو الاسم",
  },
  "msg.open": { en: "Open", ar: "فتح" },
  "msg.groupName": { en: "Group name", ar: "اسم المجموعة" },
  "msg.groupNamePlaceholder": { en: "e.g. Weekend Trip", ar: "مثال: رحلة نهاية الأسبوع" },
  "msg.addMembersByNumber": { en: "Add members by number", ar: "أضف أعضاء بالرقم" },
  "msg.removeMember": { en: "Remove {number}", ar: "إزالة {number}" },
  "msg.creating": { en: "Creating…", ar: "جارٍ الإنشاء…" },
  /* The count INCLUDES YOU, which is why it can never be zero here. Two bands, matching
     `groups.memberCount*` — see the header note. */
  "msg.createGroupOne": { en: "Create group · {n} member", ar: "أنشئ المجموعة · {n} عضو" },
  "msg.createGroupMany": { en: "Create group · {n} members", ar: "أنشئ المجموعة · {n} أعضاء" },
  /* `AvatarPicker`'s remove-confirmation slots this in mid-sentence, so it is a noun
     phrase with its article, not a label. */
  "msg.theGroupPhoto": { en: "the group photo", ar: "صورة المجموعة" },
  "msg.unnamed": { en: "Unnamed", ar: "بدون اسم" },

  // ── Toasts ──
  "msg.voiceSendFailed": {
    en: "Voice note not sent — tap the mic and try again.",
    ar: "لم تُرسل الرسالة الصوتية — اضغط الميكروفون وأعد المحاولة.",
  },
  "msg.removeFailed": {
    en: "Couldn't remove that — it's still here.",
    ar: "تعذّرت إزالتها — ما زالت هنا.",
  },
  "msg.uploadFailed": { en: "Upload failed: {reason}", ar: "فشل الرفع: {reason}" },
  "msg.sendFailed": {
    en: "Message not sent — check your connection and tap send again.",
    ar: "لم تُرسل الرسالة — تحقّق من اتصالك واضغط إرسال مجددًا.",
  },
  "msg.voiceUnsupportedToast": {
    en: "Voice notes aren't supported by this browser yet. Try the latest Safari/Chrome, or send an audio file via the paperclip instead.",
    ar: "لا يدعم هذا المتصفح الرسائل الصوتية بعد. جرّب أحدث إصدار من Safari أو Chrome، أو أرسل ملفًا صوتيًا عبر مشبك الورق بدلاً من ذلك.",
  },
  "msg.micRequired": {
    en: "Mic access required for voice notes: {reason}",
    ar: "يلزم الإذن بالوصول إلى الميكروفون للرسائل الصوتية: {reason}",
  },
  /* v2.107.52 — feature roadmap wave 1. */
  "msg.draft": { en: "Draft", ar: "مسودة" },
  "msg.playbackSpeed": { en: "Playback speed", ar: "سرعة التشغيل" },
  /* v2.107.52 — content reporting (Apple 1.2). */
  "msg.reportAction": { en: "Report", ar: "إبلاغ" },
  "msg.reportTitle": { en: "Report this message?", ar: "الإبلاغ عن هذه الرسالة؟" },
  "msg.reportBody": {
    en: "Tell us what's wrong. Our team reviews reports and takes action on content that breaks the rules.",
    ar: "أخبرنا بالمشكلة. يراجع فريقنا البلاغات ويتخذ إجراءً بشأن المحتوى المخالف للقواعد.",
  },
  "msg.reportSpam": { en: "Spam", ar: "رسائل مزعجة" },
  "msg.reportHarassment": { en: "Harassment or bullying", ar: "تحرش أو تنمر" },
  "msg.reportHate": { en: "Hate speech", ar: "خطاب كراهية" },
  "msg.reportViolence": { en: "Violence or threats", ar: "عنف أو تهديدات" },
  "msg.reportSexual": { en: "Sexual content", ar: "محتوى جنسي" },
  "msg.reportCsam": { en: "Child sexual abuse", ar: "إساءة جنسية للأطفال" },
  "msg.reportOther": { en: "Something else", ar: "شيء آخر" },
  "msg.reportSubmit": { en: "Submit report", ar: "إرسال البلاغ" },
  "msg.reporting": { en: "Submitting…", ar: "جارٍ الإرسال…" },
  "msg.reportThanks": {
    en: "Thanks — your report was submitted.",
    ar: "شكرًا — تم إرسال بلاغك.",
  },
  "msg.reportFailed": {
    en: "Couldn't submit your report. Please try again.",
    ar: "تعذّر إرسال بلاغك. يرجى المحاولة مرة أخرى.",
  },
  "msg.starAction": {
    en: "Star",
    ar: "تمييز بنجمة",
  },
  "msg.unstarAction": {
    en: "Unstar",
    ar: "إزالة النجمة",
  },
  "msg.starFailed": {
    en: "Couldn't update the star. Please try again.",
    ar: "تعذّر تحديث النجمة. يرجى المحاولة مرة أخرى.",
  },
  "msg.starredTitle": {
    en: "Starred messages",
    ar: "الرسائل المميزة",
  },
  "msg.starredEmpty": {
    en: "No starred messages yet",
    ar: "لا توجد رسائل مميزة بعد",
  },
  "msg.starredHint": {
    en: "Star a message to keep it here.",
    ar: "ميّز رسالة بنجمة للاحتفاظ بها هنا.",
  },
  "msg.starredNoText": {
    en: "(media message)",
    ar: "(رسالة وسائط)",
  },
} as const satisfies Record<string, Entry>;
