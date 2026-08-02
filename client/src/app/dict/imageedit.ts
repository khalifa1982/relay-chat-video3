import type { Entry } from "./types";

/**
 * THE PRE-UPLOAD PHOTO EDITOR (`ImageEditSheet.tsx`, #144). One module per
 * surface — see `dict/index.ts` for why.
 *
 * ── THE REGISTER IS THE VERBAL NOUN ──────────────────────────────────────────────────
 * Short control labels are masdars, not imperatives — «تدوير», not «أدر» — matching
 * `dict/videorec.ts` and `dict/messages.ts`. Two media sheets on one phone addressing the
 * user in two different grammatical moods is the drift nobody files a bug about and
 * everybody notices. Full SENTENCES stay imperative («اسحب…»), which is what
 * `dict/status.ts` already does.
 *
 * ── FOUR DISTINCTIONS THAT MUST NOT COLLAPSE IN TRANSLATION ──────────────────────────
 *  1. "USE PHOTO" IS NOT "SEND", and this sheet's primary button is deliberately not
 *     labelled with the latter. `onUse` hands the edited file to the CALLER, where it
 *     becomes a `pendingUpload` — the caption and the disappearing timer still apply, and
 *     the composer's own Send is what actually sends. This is `videorec.useVideo`'s
 *     distinction 2, and it holds here for the identical reason: «إرسال» would promise a
 *     send that has not happened.
 *  2. "USE ORIGINAL" IS NOT "CANCEL". Both exits from this sheet keep the photo — one
 *     applies the edit, the other sends the untouched original. Nothing here throws the
 *     attachment away (removing it is the composer's own X on the pending chip), so an
 *     Arabic «إلغاء» would tell somebody their photo was discarded when it was attached.
 *  3. LEFT AND RIGHT ARE GEOMETRY, NOT READING ORDER. «تدوير لليسار» means
 *     counter-clockwise in Arabic exactly as it does in English — a photo does not mirror
 *     with the text direction. Do NOT swap these two when translating or "fixing" RTL;
 *     the component makes the same decision about the crop box's coordinates and says so.
 *  4. THE FAILURE IS NOT A REFUSAL. When the canvas cannot produce the edit the ORIGINAL
 *     is attached anyway — the notice says the edit was dropped, never that the photo was.
 *
 * ── WESTERN DIGITS, AND WHY THE RATIOS ARE NOT STRINGS HERE ──────────────────────────
 * `1:1` and `16:9` are deliberately NOT entries in this module. They are two numeric runs
 * with a separator between them, which the bidi algorithm reorders inside Arabic prose —
 * the same trap `videorec` records for its `0:07 / 1:00` clock — so the component renders
 * each as an LTR-isolated island beside the translated word. The words carry the meaning;
 * the ratios are labels on top of them.
 */
export const IMAGEEDIT = {
  /* The surface's own name, spoken when the sheet opens. */
  "imageedit.title": { en: "Edit photo", ar: "تعديل الصورة" },

  /* Distinction 2 — closing keeps the photo, so the label says so rather than "cancel". */
  "imageedit.close": {
    en: "Skip editing and use the original photo",
    ar: "تخطّي التعديل واستخدام الصورة الأصلية",
  },

  /* Distinction 3 — geometric direction, never mirrored. */
  "imageedit.rotateLeft": { en: "Rotate left", ar: "تدوير لليسار" },
  "imageedit.rotateRight": { en: "Rotate right", ar: "تدوير لليمين" },

  /* The three crop modes. `cropFree` is the default: the user drags whatever they want. */
  "imageedit.cropFree": { en: "Free", ar: "حر" },
  "imageedit.cropSquare": { en: "Square", ar: "مربّع" },
  "imageedit.cropWide": { en: "Wide", ar: "عريض" },

  /* Undo everything back to the untouched photo WITHOUT leaving the sheet. */
  "imageedit.reset": { en: "Reset", ar: "إعادة تعيين" },

  /* The instruction line under the stage. Imperative, per the register note. */
  "imageedit.dragHint": {
    en: "Drag on the photo to choose a crop",
    ar: "اسحب على الصورة لتحديد منطقة القصّ",
  },

  /* Distinction 2 — the two exits, both of which attach the photo. */
  "imageedit.useOriginal": { en: "Use original", ar: "استخدام الأصلية" },
  /* Distinction 1 — hands the edit to the composer; the composer sends. */
  "imageedit.usePhoto": { en: "Use photo", ar: "استخدام الصورة" },

  /* Distinction 4 — the edit was dropped, the photo was not. */
  "imageedit.failed": {
    en: "Couldn't apply the edit — attaching the original photo instead.",
    ar: "تعذّر تطبيق التعديل — سيتم إرفاق الصورة الأصلية بدلًا من ذلك.",
  },
} as const satisfies Record<string, Entry>;
