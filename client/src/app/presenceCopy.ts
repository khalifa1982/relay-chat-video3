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
import {
  lastSeenBand,
  compactAgoBand,
  formatClockDigits,
  peerPresenceState,
  type LastSeenClock,
  type PeerPresenceInput,
} from "@shared/profileFields";
import type { Locale, TKey } from "./i18n";
import { formatDateIn, formatDateTimeIn } from "./dateLocale";

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

/* ── the presence line ─────────────────────────────────────────────────────
   Same shape as the last-seen renderer above and for the same reason: the state
   is decided by `peerPresenceState` in `shared/profileFields.ts`, which both this
   and the English `describePeerPresence` read, so the two cannot come to disagree
   about whether somebody is idle or simply offline. */

/** The dual is a WORD in Arabic, so occupancy is banded like every other count. */
export function lineCountKey(n: number): TKey {
  if (n <= 0) return "peer.lineNobody";
  if (n === 1) return "peer.lineOne";
  if (n === 2) return "peer.lineTwo";
  return n <= 10 ? "peer.lineFew" : "peer.lineMany";
}

export function presenceLabel(
  d: PeerPresenceInput,
  t: T,
  opts: { locale: Locale; nowMs?: number },
): string {
  const s = peerPresenceState(d);
  switch (s.kind) {
    /* Renders NOTHING, deliberately: "Offline" is still a claim about somebody
       the server declined to describe (v2.95). */
    case "hidden":
      return "";
    case "partyLine":
      return t(lineCountKey(s.memberCount), { count: s.memberCount });
    case "inCall":
      return t("peer.presenceInCall");
    case "idle":
      return t("peer.presenceIdle");
    case "online":
      return t("peer.presenceOnline");
    case "offline":
      return t("peer.presenceOffline");
    case "lastSeen":
      /* The stamp follows the APP's language, not the browser's — the empty
         `toLocaleString()` arglist here is what v2.106.93 already refused for the
         sign-in stamp, and this was the same defect one screen along. */
      return t("peer.presenceLastSeen", { when: formatDateTimeIn(opts.locale, s.at) });
  }
}

/* ── the COMPACT "…ago" row, translated ────────────────────────────────────
   Contacts has a hard width budget (v2.106.43 measured it), so it renders `5m ago`
   where the popup renders `last seen 5 minutes ago`. Two forms on purpose; ONE
   decision, so the row and the popup can never bucket the same moment differently.

   THE UNIT IS A WHOLE KEY, not a letter appended to a number: `m`/`h`/`d` are
   abbreviations of English words, and Arabic abbreviates neither the same way nor
   in the same position. It still bands one/two/few/many, because the dual is a
   word — `2 ساعة` is wrong where `ساعتان` is right. */

type AgoUnit = "minutes" | "hours" | "days";

const AGO_KEYS: Record<AgoUnit, [TKey, TKey, TKey, TKey]> = {
  minutes: ["peer.agoMinuteOne", "peer.agoMinuteTwo", "peer.agoMinuteFew", "peer.agoMinuteMany"],
  hours: ["peer.agoHourOne", "peer.agoHourTwo", "peer.agoHourFew", "peer.agoHourMany"],
  days: ["peer.agoDayOne", "peer.agoDayTwo", "peer.agoDayFew", "peer.agoDayMany"],
};

export function agoKey(unit: AgoUnit, n: number): TKey {
  const [one, two, few, many] = AGO_KEYS[unit];
  if (n <= 1) return one;
  if (n === 2) return two;
  return n <= 10 ? few : many;
}

export function compactAgoLabel(
  d: Date | string | number | null | undefined,
  t: T,
  opts: { locale: Locale; nowMs?: number },
): string {
  const b = compactAgoBand(d, opts.nowMs ?? Date.now());
  switch (b.kind) {
    case "never":
      return t("peer.agoNever");
    case "justNow":
      return t("peer.agoJustNow");
    case "minutes":
      return t(agoKey("minutes", b.n), { count: b.n });
    case "hours":
      return t(agoKey("hours", b.n), { count: b.n });
    case "days":
      return t(agoKey("days", b.n), { count: b.n });
    case "date":
      /* Beyond a week the row shows a DATE, which is a regional format rather than
         a translation — so it follows the app's language through the one reader
         instead of the browser's through an empty arglist. */
      return formatDateIn(opts.locale, b.at);
  }
}
