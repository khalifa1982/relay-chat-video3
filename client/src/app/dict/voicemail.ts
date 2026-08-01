import type { Entry } from "./types";

/**
 * The POST-DIAL VOICEMAIL CARD — board 2g plus 5h's live recording panel. One module
 * per surface; see `dict/index.ts` for why.
 *
 * ── THE VOCABULARY THIS SCREEN MUST KEEP APART ───────────────────────────────────────
 * Four pairs of English words on this card mean genuinely different things, and the
 * failure mode is never a missing translation — it is a translation that COLLAPSES a
 * pair onto one Arabic word, which nobody reviewing the English would notice, because
 * the English still says two things:
 *
 *   VOICEMAIL vs VOICE MESSAGE. Both appear in ONE sentence — "The voice message lands
 *     in your chat with X — they'll get a 'Voicemail' alert" — so they cannot share a
 *     word without making that sentence say nothing. «بريد صوتي» is the alert the
 *     recipient sees; «رسالة صوتية» is the thing you record, and that second term is
 *     already `msg.voiceMessage`'s, so the two surfaces name one object identically.
 *
 *   DISCARD vs DISMISS. Discard destroys the take — `rec.cancel()` resolves `done`
 *     null and the audio is gone. Dismiss closes the card and costs nothing. They sit
 *     on the same screen, so one Arabic word for both would hide a destructive act
 *     behind the word people learn means "close this". «تجاهل» vs «إغلاق».
 *
 *   THE THREE REFUSAL REASONS. Declined / offline / no answer are three different
 *     facts about one call, and `reasonKey` exists precisely so the card never guesses
 *     between them. Collapsing any two in Arabic would undo that in the language where
 *     the reader has no English to fall back on. The Arabic follows the call log's own
 *     wording — «رفضوا» is `history.declinedByThem`'s verb, «غير متصل» is
 *     `presence.offline`'s — so the card and History cannot describe one call two ways.
 *
 *   COULDN'T SEND THE VOICEMAIL vs COULDN'T SEND THE MESSAGE. Two different sends fail
 *     for two different reasons and need two different next steps.
 *
 * ── SINGULAR "THEY" IS THE ARABIC PLURAL, FOLLOWING THE CALL LOG ─────────────────────
 * English uses singular-they for a peer of unknown gender. Arabic has no neutral
 * singular, and this dictionary already made the choice: `history.declinedByThem` is
 * «رفضوا المكالمة», the third-person PLURAL. Every "they" here follows it rather than
 * inventing a second convention two screens apart. Where the card has the person's
 * NAME it uses a verbal noun instead («عند عودة {who}»), which carries no gender at all.
 *
 * ── WESTERN DIGITS, AS EVERYWHERE ELSE ───────────────────────────────────────────────
 * `{seconds}` is interpolated from `VOICEMAIL_MAX_MS`, so it stays Western for the
 * v2.106.84 reason: a substituted "60" beside an Arabic-Indic numeral on the same line
 * reads as a rendering fault. The mono `0:23 / 1:00` readout is not in this file at all
 * — it is `fmtClock` output, isolated with `dir="ltr"` at the render site.
 */
export const VOICEMAIL = {
  /* ── Why the call ended. Three facts, never blurred (see the header). ─────────── */
  "voicemail.reasonDeclined": { en: "They declined your call.", ar: "رفضوا مكالمتك." },
  "voicemail.reasonOffline": { en: "They're offline right now.", ar: "غير متصلين حاليًا." },
  "voicemail.reasonNoAnswer": { en: "They didn't answer.", ar: "لم يردّوا على المكالمة." },

  /* ── Board 5h's live recording panel ──────────────────────────────────────────── */
  "voicemail.recordingLabel": {
    en: "Voicemail — recording (max {seconds}s)",
    ar: "بريد صوتي — جارٍ التسجيل (بحد أقصى {seconds} ث)",
  },
  "voicemail.pauseRecording": { en: "Pause recording", ar: "إيقاف التسجيل مؤقتًا" },
  "voicemail.resumeRecording": { en: "Resume recording", ar: "استئناف التسجيل" },
  "voicemail.pause": { en: "Pause", ar: "إيقاف مؤقت" },
  "voicemail.resume": { en: "Resume", ar: "استئناف" },
  "voicemail.recording": { en: "Recording", ar: "جارٍ التسجيل" },
  "voicemail.paused": { en: "Paused", ar: "متوقف مؤقتًا" },
  "voicemail.discardRecording": { en: "Discard this recording", ar: "تجاهل هذا التسجيل" },
  "voicemail.discard": { en: "Discard", ar: "تجاهل" },
  "voicemail.sendVoicemail": { en: "Send voicemail", ar: "إرسال البريد الصوتي" },
  "voicemail.sendThisVoiceMessage": {
    en: "Send this voice message",
    ar: "إرسال هذه الرسالة الصوتية",
  },
  "voicemail.send": { en: "Send", ar: "إرسال" },
  /* SEND IS THE ONLY REMAINING STOP — Pause and Discard are separate controls — so this
     sentence is load-bearing rather than decoration, and `{seconds}` comes from the cap
     itself so the copy can never promise a ceiling the recorder does not enforce. */
  "voicemail.autoStop": {
    en: "Sending stops the recording. It stops and sends on its own at {seconds} seconds.",
    ar: "الإرسال يوقف التسجيل، وسيتوقف ويُرسل تلقائيًا عند {seconds} ثانية.",
  },

  /* ── The card itself ──────────────────────────────────────────────────────────── */
  "voicemail.didntConnect": { en: "Call to {who} didn't connect", ar: "لم تُستكمل المكالمة مع {who}" },
  "voicemail.dismiss": { en: "Dismiss", ar: "إغلاق" },
  "voicemail.sendingVoicemail": { en: "Sending voicemail…", ar: "جارٍ إرسال البريد الصوتي…" },
  "voicemail.voicemailSent": { en: "Voicemail sent", ar: "تم إرسال البريد الصوتي" },
  "voicemail.messagePlaceholder": { en: "Message {who}…", ar: "راسِل {who}…" },
  "voicemail.messageLabel": { en: "Message {who}", ar: "راسِل {who}" },
  "voicemail.sendMessage": { en: "Send message", ar: "إرسال الرسالة" },
  "voicemail.leaveVoiceMessage": { en: "Leave a voice message", ar: "اترك رسالة صوتية" },
  "voicemail.willAlert": {
    en: "You'll be alerted when they're online",
    ar: "سننبّهك عند عودتهم إلى الاتصال",
  },
  "voicemail.tellMeOnline": {
    en: "Tell me when they're back online",
    ar: "نبّهني عند عودتهم إلى الاتصال",
  },
  /* THE ONE SENTENCE THAT NAMES BOTH TERMS. Keeping «رسالة صوتية» and «بريد صوتي» apart
     is what stops it collapsing into "the voice message … you'll get a voice message
     alert", which says nothing. */
  "voicemail.landsInChat": {
    en: 'The voice message lands in your chat with {who} — they\'ll get a "Voicemail" alert.',
    ar: "ستصل الرسالة الصوتية إلى محادثتك مع {who}، وسيصلهم تنبيه «بريد صوتي».",
  },

  /* ── Toasts. Each error carries the underlying reason as `{error}` INSIDE the
        sentence rather than concatenated onto it: Arabic does not put the cause where
        English does, and a sentence chopped at the English seam can only be
        re-assembled into nonsense (the `translateNodes` rule, applied to plain text). */
  "voicemail.notSupported": {
    en: "Voice recording isn't supported by this browser — send them a message instead.",
    ar: "لا يدعم هذا المتصفح التسجيل الصوتي — أرسل لهم رسالة نصية بدلًا من ذلك.",
  },
  "voicemail.sentTo": { en: "Voicemail sent to {who}.", ar: "تم إرسال البريد الصوتي إلى {who}." },
  "voicemail.sendFailed": {
    en: "Couldn't send the voicemail: {error}",
    ar: "تعذّر إرسال البريد الصوتي: {error}",
  },
  "voicemail.micRequired": {
    en: "Mic access is required to leave a voicemail: {error}",
    ar: "يلزم السماح بالوصول إلى الميكروفون لترك بريد صوتي: {error}",
  },
  "voicemail.messageSentTo": { en: "Message sent to {who}.", ar: "تم إرسال الرسالة إلى {who}." },
  "voicemail.messageFailed": {
    en: "Couldn't send the message: {error}",
    ar: "تعذّر إرسال الرسالة: {error}",
  },
  "voicemail.watchSet": {
    en: "You'll be alerted when {who} is back online.",
    ar: "سننبّهك عند عودة {who} إلى الاتصال.",
  },
  "voicemail.watchFailed": { en: "Couldn't set the alert.", ar: "تعذّر ضبط التنبيه." },
} as const satisfies Record<string, Entry>;
