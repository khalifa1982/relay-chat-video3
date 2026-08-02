/* ============================================================
   Dates and numbers follow the APP's language, not the browser's.

   THE DEFECT THIS CLOSES
   ----------------------
   `new Date(x).toLocaleDateString()` with an empty argument list formats in the
   BROWSER's locale. This app has its own language switch, so on a screen the user
   has just set to Arabic every one of those calls kept rendering in whatever the
   browser was configured with — and the reverse for somebody whose browser is
   Arabic but who chose English. v2.106.93 recorded exactly this for the sign-in
   stamp and pinned "a localised date-and-time" rather than the empty arglist; this
   is that rule with a shared reader so the next call site inherits it.

   WHY ARABIC PINS `-u-nu-latn` AND ENGLISH PINS NOTHING
   ----------------------------------------------------
   Two different decisions, and both are deliberate:

   - **Arabic** resolves to Arabic-Indic numerals (٢٠٢٦) on some engines and Latin
     on others, depending on the ICU/CLDR build. This app's standing rule is
     WESTERN digits everywhere (v2.106.84) — a number a user reads aloud, dials or
     compares must be the number shown — so the numbering system is pinned rather
     than left to the runtime. Pinning it also makes the output the SAME on every
     engine, which is what stops a screenshot from one device disagreeing with
     another.

   - **English** deliberately passes `undefined`, i.e. the browser's own regional
     format. Forcing `en-US` would change `02/08/2026` to `8/2/2026` for every
     British, Irish, Australian and Indian user who is perfectly happy today —
     a regression dressed as a fix. "English" is a language, not a date format,
     and the browser already knows the region. So this changes only what is
     broken.
   ============================================================ */
import type { Locale } from "./i18n";

/**
 * The BCP-47 tag to hand `toLocaleString` and friends.
 *
 * Returns `undefined` for English ON PURPOSE — see the header. Callers pass it
 * straight through, and an `undefined` argument is exactly what those APIs mean by
 * "use the runtime default".
 */
export function intlLocale(locale: Locale): string | undefined {
  return locale === "ar" ? "ar-u-nu-latn" : undefined;
}

/** `2/8/2026` — a date with no clock. */
export function formatDateIn(locale: Locale, ms: number | string | Date): string {
  return new Date(ms).toLocaleDateString(intlLocale(locale));
}

/** `2/8/2026, 3:30:00 PM` — a date AND a clock, for a stamp that must be exact. */
export function formatDateTimeIn(locale: Locale, ms: number | string | Date): string {
  return new Date(ms).toLocaleString(intlLocale(locale));
}

/**
 * `1,204` — a COUNT, not a measurement.
 *
 * Grouping separators differ by locale too, and an Arabic screen showing
 * `١٬٢٠٤` where the English one shows `1,204` is the same class of surprise as
 * the dates: the digits are what a person reads back to you.
 */
export function formatNumberIn(locale: Locale, n: number): string {
  return n.toLocaleString(intlLocale(locale));
}
