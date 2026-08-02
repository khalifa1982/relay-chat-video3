/* ============================================================
   "last seen …", TRANSLATED — the one client-side renderer.

   WHY THIS EXISTS RATHER THAN A MAP OVER `formatLastSeen`'s OUTPUT
   ---------------------------------------------------------------
   `formatLastSeen` returns a finished English sentence and has readers on four
   screens (Dialer, Contacts, Messages, GroupCallScreen). Localising it by mapping
   that output to a key is exactly what this dictionary forbids: a copy edit
   silently drops the translation, and two states sharing an English word would be
   forced to share an Arabic one.

   It also cannot be done by interpolating a count into one sentence. English
   pluralises with a suffix; Arabic needs one/two/few/many AND changes the noun, so
   `{n} minute{s}` is a sentence assembled from a fragment and is untranslatable —
   the whole KEY has to change per band. That is the `guestExpiryKey` rule
   (v2.106.85), applied to a formatter with six bands instead of two.

   THE BANDING IS NOT REPEATED HERE, which is the load-bearing part: `lastSeenBand`
   in `shared/profileFields.ts` decides which band a timestamp is in, and BOTH
   renderers read it — this one and the English `formatLastSeen` beside it. Two
   copies of that decision is how an Arabic screen comes to say "yesterday" where
   the English one says "today", about the same person, at the same moment.

   IT RETURNS "" FOR NO-LAST-SEEN, deliberately matching `formatLastSeen`, because
   every call site already treats the empty string as "render nothing" and a
   translated placeholder would put a claim on screen where there is no fact.
   ============================================================ */
import { lastSeenBand, formatClockDigits, type LastSeenClock } from "@shared/profileFields";
import type { TKey } from "./i18n";

type T = (key: TKey, vars?: Record<string, string | number>) => string;

/**
 * WHOLE KEY PER BAND. The two/few/many split is Arabic's; English collapses it,
 * which costs nothing because both halves of a key carry their own sentence.
 */
export function lastSeenMinutesKey(minutes: number): TKey {
  if (minutes <= 1) return "peer.lastSeenMinute";
  if (minutes === 2) return "peer.lastSeenTwoMinutes";
  return minutes <= 10 ? "peer.lastSeenMinutesFew" : "peer.lastSeenMinutesMany";
}

/** `3:05 PM` / `3:05 م` — digits Western in both, meridiem translated. */
export function formatClockLocalised(c: LastSeenClock, t: T): string {
  return `${formatClockDigits(c)} ${t(c.pm ? "peer.clockPm" : "peer.clockAm")}`;
}

export function lastSeenLabel(lastSeenMs: number, nowMs: number, t: T): string {
  const b = lastSeenBand(lastSeenMs, nowMs);
  switch (b.kind) {
    case "none":
      return "";
    case "justNow":
      return t("peer.lastSeenJustNow");
    case "minutes":
      return t(lastSeenMinutesKey(b.minutes), { count: b.minutes });
    case "today":
      return t("peer.lastSeenToday", { time: formatClockLocalised(b.clock, t) });
    case "yesterday":
      return t("peer.lastSeenYesterday", { time: formatClockLocalised(b.clock, t) });
    case "date": {
      const vars = {
        month: t(`peer.month.${b.month}` as TKey),
        day: b.day,
        time: formatClockLocalised(b.clock, t),
      };
      /* Two keys, not one with a sometimes-empty `{year}`: Arabic places the year
         differently, so a blank fragment would leave a dangling separator in one
         language or the other. */
      return b.year == null
        ? t("peer.lastSeenOnDate", vars)
        : t("peer.lastSeenOnDateYear", { ...vars, year: b.year });
    }
  }
}
