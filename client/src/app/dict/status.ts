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
 */
export const STATUS = {
  "status.myStory": { en: "My story", ar: "قصتي" },
  "status.newStory": { en: "New story", ar: "قصة جديدة" },
  "status.close": { en: "Close", ar: "إغلاق" },
  "status.next": { en: "Next", ar: "التالي" },
  "status.previous": { en: "Previous", ar: "السابق" },
  "status.noViews": { en: "No views yet.", ar: "لا مشاهدات بعد." },
  "status.library": { en: "Library", ar: "المعرض" },
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
} as const satisfies Record<string, Entry>;
