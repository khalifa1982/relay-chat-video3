import type { Entry } from "./types";

/**
 * THE IN-APP CAMERA SHEET (`VideoRecordSheet.tsx`). One module per surface — see
 * `dict/index.ts` for why.
 *
 * ── THE REGISTER IS THE VERBAL NOUN, BECAUSE THAT IS WHAT THIS APP ALREADY SPEAKS ─────
 * Short control labels here are masdars, not imperatives — «بدء التسجيل», not «ابدأ
 * التسجيل» — because `dict/messages.ts` already labels the voice recorder's controls that
 * way («تجاهل التسجيل», «استئناف التسجيل», «إيقاف التسجيل مؤقتًا»). Two recorders on one
 * phone addressing the user in two different grammatical moods is the kind of drift
 * nobody files a bug about and everybody notices. Full SENTENCES stay imperative, which
 * is likewise what `dict/status.ts` does («اختر ملف صورة أو فيديو أو صوت»).
 *
 * ── FOUR DISTINCTIONS THAT MUST NOT COLLAPSE IN TRANSLATION ──────────────────────────
 *  1. STOP-TO-REVIEW vs STOP-AND-SEND. These are two buttons in the SAME row and both
 *     end the take. The shutter hands you a review screen; the accent circle sets
 *     `sendOnStopRef` and skips it entirely. A screen-reader user hearing one phrase for
 *     both has a 50% chance of irreversibly handing the clip over when they meant to
 *     look at it first, so «إيقاف التسجيل» and «إيقاف وإرسال» stay apart.
 *  2. "USE VIDEO" IS NOT "SEND". `onUse` hands the clip to the CALLER — in Messages it
 *     becomes a pendingUpload, so the caption and the disappearing timer still apply
 *     before anything is sent. «استخدام الفيديو» says that; «إرسال» would promise a send
 *     that has not happened.
 *  3. THE TWO NOTICES ARE TWO DIFFERENT FAILURES. "Camera unavailable" is a conflict the
 *     user can resolve (turn the call's camera off); "not supported by this browser" is
 *     one they cannot. One Arabic sentence for both would send somebody to fix a thing
 *     that is not the problem.
 *  4. THE SURFACE'S NAME vs THE ACTION. The dialog is «تسجيل فيديو» (what this screen
 *     is); the shutter is «بدء التسجيل» (what the button does). Careless Arabic renders
 *     both as the first one.
 *
 * ── THE GALLERY IS CALLED WHAT THE STORY COMPOSER ALREADY CALLS IT ───────────────────
 * «المعرض», matching `status.library`. Two words for one place is how a user ends up
 * unsure whether the two shortcuts open the same thing.
 *
 * ── WESTERN DIGITS ───────────────────────────────────────────────────────────────────
 * The countdown's seconds are interpolated, so they stay Western for the reason
 * v2.106.84 recorded. The REC chip's `0:07 / 1:00` is deliberately NOT a string in this
 * module at all — see the component: it is an LTR-isolated island, because two numbers
 * separated by a slash inside Arabic prose are reordered by the bidi algorithm and the
 * elapsed time would render on the wrong side of the cap.
 */
export const VIDEOREC = {
  /* The surface's own name, spoken by a screen reader when the sheet opens. */
  "videorec.title": { en: "Record a video", ar: "تسجيل فيديو" },
  "videorec.close": { en: "Close recorder", ar: "إغلاق المسجّل" },
  "videorec.flip": { en: "Flip camera", ar: "تبديل الكاميرا" },

  /* The live chip beside the pulsing red dot. Kept SHORT: it shares a `whitespace-nowrap`
     run with the timer inside a chip that has to fit a 320px phone. */
  "videorec.rec": { en: "REC", ar: "تسجيل" },

  /* Distinction 1 and 4 — the three verbs on the control row. */
  "videorec.start": { en: "Start recording", ar: "بدء التسجيل" },
  "videorec.stop": { en: "Stop recording", ar: "إيقاف التسجيل" },
  "videorec.stopAndSend": { en: "Stop and send", ar: "إيقاف وإرسال" },

  /* Distinction 2 — the review screen. */
  "videorec.retake": { en: "Retake", ar: "إعادة التسجيل" },
  "videorec.useVideo": { en: "Use video", ar: "استخدام الفيديو" },

  "videorec.library": {
    en: "Choose a video from your library",
    ar: "اختر فيديو من المعرض",
  },

  /* Distinction 3 — two failures, two remedies. The Arabic leads with the subject
     («this browser…») rather than tracking the English word order, which is what the
     language wants and is safe because substitution is by NAME. */
  "videorec.cameraUnavailable": {
    en: "Camera unavailable. If you're on a video call, turn the call's camera off first, then try again.",
    ar: "الكاميرا غير متاحة. إن كنت في مكالمة فيديو، أوقف كاميرا المكالمة أولًا ثم حاول مرة أخرى.",
  },
  "videorec.unsupported": {
    en: "Recording isn't supported by this browser.",
    ar: "هذا المتصفح لا يدعم التسجيل.",
  },

  /* A LONE number inside prose, so it needs no isolation — digits within one numeric run
     are never reordered; it is two numbers with punctuation between them that swap. */
  "videorec.autoStops": {
    en: "Auto-stops in {seconds}s",
    ar: "يتوقف تلقائيًا خلال {seconds} ثانية",
  },
} as const satisfies Record<string, Entry>;
