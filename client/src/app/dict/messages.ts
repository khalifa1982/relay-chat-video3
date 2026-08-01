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
} as const satisfies Record<string, Entry>;
