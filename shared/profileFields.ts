/**
 * Pure helpers for the expanded profile hub (mobile numbers, social links,
 * status, last-seen). Shared by client (UI) and server (validation) so both
 * agree on the shapes/caps. No DOM, no DB — unit-tested directly.
 */

/** The social/link platforms a user can attach to their profile. */
export type SocialPlatform = "x" | "website" | "snapchat" | "whatsapp";

export interface SocialPlatformDef {
  key: SocialPlatform;
  label: string;
  placeholder: string;
  /** Build a tappable URL from the stored value (null = not linkable). */
  href: (value: string) => string | null;
}

export const SOCIAL_PLATFORMS: SocialPlatformDef[] = [
  {
    key: "x",
    label: "X (Twitter)",
    placeholder: "@handle or x.com/handle",
    href: (v) => {
      const h = v.trim().replace(/^@/, "").replace(/^https?:\/\/(www\.)?(x|twitter)\.com\//i, "");
      return h ? `https://x.com/${encodeURIComponent(h.split(/[/?#]/)[0])}` : null;
    },
  },
  {
    key: "website",
    label: "Website",
    placeholder: "https://example.com",
    href: (v) => {
      const t = v.trim();
      if (!t) return null;
      return /^https?:\/\//i.test(t) ? t : `https://${t}`;
    },
  },
  {
    key: "snapchat",
    label: "Snapchat",
    placeholder: "username",
    href: (v) => {
      const h = v.trim().replace(/^@/, "").replace(/^https?:\/\/(www\.)?snapchat\.com\/add\//i, "");
      return h ? `https://snapchat.com/add/${encodeURIComponent(h.split(/[/?#]/)[0])}` : null;
    },
  },
  {
    key: "whatsapp",
    label: "WhatsApp",
    placeholder: "+1 555 123 4567",
    href: (v) => {
      const digits = v.replace(/[^\d]/g, "");
      return digits.length >= 6 ? `https://wa.me/${digits}` : null;
    },
  },
];

const PLATFORM_KEYS = new Set<string>(SOCIAL_PLATFORMS.map((p) => p.key));

export interface SocialLink {
  platform: SocialPlatform;
  value: string;
}

export const MAX_SOCIALS = 10;
export const MAX_MOBILES = 5;
const MAX_SOCIAL_VALUE = 200;
const MAX_MOBILE_LEN = 32;

/** Keep only well-formed social links (known platform + non-empty value), trim,
 *  cap value length and count. Returns a clean array. */
export function sanitizeSocials(input: unknown): SocialLink[] {
  if (!Array.isArray(input)) return [];
  const out: SocialLink[] = [];
  for (const item of input) {
    if (!item || typeof item !== "object") continue;
    const platform = (item as { platform?: unknown }).platform;
    const value = (item as { value?: unknown }).value;
    if (typeof platform !== "string" || !PLATFORM_KEYS.has(platform)) continue;
    if (typeof value !== "string") continue;
    const v = value.trim().slice(0, MAX_SOCIAL_VALUE);
    if (!v) continue;
    out.push({ platform: platform as SocialPlatform, value: v });
    if (out.length >= MAX_SOCIALS) break;
  }
  return out;
}

/** Keep only non-empty mobile strings (allow leading +, digits, spaces, dashes,
 *  parens), trim, cap length + count. */
export function sanitizeMobiles(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  for (const item of input) {
    if (typeof item !== "string") continue;
    const v = item.trim().slice(0, MAX_MOBILE_LEN);
    // Must contain at least 4 digits to be a plausible number, and only
    // phone-ish characters (+, digits, spaces, dashes, parens) — so "(020) …"
    // and "+1 555 …" pass while free text is rejected.
    if ((v.match(/\d/g) || []).length < 4) continue;
    if (!/^[+\d\s().-]+$/.test(v)) continue;
    out.push(v);
    if (out.length >= MAX_MOBILES) break;
  }
  return out;
}

export type StatusOverride = "" | "away" | "travel";

/** Manual status the user can set; "" means "auto" (derived from live presence). */
export function sanitizeStatusOverride(input: unknown): StatusOverride {
  return input === "away" || input === "travel" ? input : "";
}

/**
 * The effective status to DISPLAY, combining live presence with any override.
 *
 * `idle` (v2.99.92) means signed in but BACKGROUNDED — the owner's "idle": *"whenever
 * you minimize the app, the user showing offline, not the idle."* It maps onto the
 * SAME `away` the manual override already produces, deliberately: every surface in
 * the app already knows how to render "away", so an automatic idle needs no new
 * display vocabulary and cannot be handled inconsistently by one screen.
 *
 * A MANUAL override still wins. Somebody who set "travelling" stays travelling
 * whether or not their app is in the foreground — they said so on purpose, and an
 * automatic signal must not overwrite a deliberate one.
 *
 * `idle` DEFAULTS TO FALSE, and that default is the safety property: a caller that
 * has not been taught about idle yet degrades to the pre-v2.99.92 reading (online),
 * never to the wrong-way failure of showing somebody offline.
 */
export type EffectiveStatus = "online" | "offline" | "away" | "travel";
export function effectiveStatus(
  isOnline: boolean,
  override: StatusOverride,
  idle = false
): EffectiveStatus {
  if (override === "travel") return "travel";
  if (override === "away") return "away";
  if (!isOnline) return "offline";
  return idle ? "away" : "online";
}

/**
 * How long ago, as an ELAPSED DURATION and never a calendar date (v2.99.90).
 *
 * Owner, about the dialer preview: *"It shows you when was his last login …
 * number of hours. If it passed one day more than twenty four hours … Days that
 * shows you one day, two day, three days like this, not date as a date. No. As a
 * number of days and number of hours and number of seconds."*
 *
 *   < 60s    → "8s"
 *   < 60m    → "14m"
 *   < 24h    → "3h 20m"   (hours + minutes; the minutes still matter at this range)
 *   >= 24h   → "2d 4h"    ("one day, two day, three days like this")
 *
 * Seconds appear only under a minute. Printing them on a two-day-old figure
 * would be noise AND would need the line to re-render every second to stay
 * honest, so they stop where they stop being information.
 *
 * `formatLastSeen` below is deliberately UNCHANGED and still used by Contacts and
 * the profile popup: the owner asked for the clock there in v2.99.66 ("it doesn't
 * show you the time and the minutes"), so replacing it globally would undo that.
 * This is a second formatter for the surface that asked for a duration.
 */
export function formatElapsedSince(lastSeenMs: number, nowMs: number): string {
  if (!Number.isFinite(lastSeenMs) || lastSeenMs <= 0) return "";
  const diff = Math.max(0, nowMs - lastSeenMs);
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) {
    const rm = m % 60;
    return rm > 0 ? `${h}h ${rm}m` : `${h}h`;
  }
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh > 0 ? `${d}d ${rh}h` : `${d}d`;
}

/**
 * WhatsApp-style "last seen" string from a timestamp. Pure; `now` is injected so
 * it's deterministic to test.
 *   < 60s         → "last seen just now"
 *   < 60m         → "last seen N minutes ago"
 *   same day      → "last seen today at H:MM AM"
 *   previous day  → "last seen yesterday at H:MM AM"
 *   older         → "last seen on MON D at H:MM AM"
 *   older, other year → "last seen on MON D, YYYY at H:MM AM"
 *
 * v2.99.66 (owner screenshot of the dialer preview): the older-than-yesterday
 * branch used to stop at the date — "last seen on Jul 23" — while the same-day
 * and yesterday branches already carried the clock. Owner: "it shows you last
 * seen on this, but doesn't show you the time and the minutes." The time is the
 * part that tells you whether they were here this morning or at 3am, so it is
 * now on EVERY dated branch. The year is added only when it differs from now,
 * because "Jul 23" reads as this year and would otherwise be wrong by twelve
 * months without saying so.
 */
export type LastSeenBand =
  | { kind: "none" }
  | { kind: "justNow" }
  | { kind: "minutes"; minutes: number }
  | { kind: "today"; clock: LastSeenClock }
  | { kind: "yesterday"; clock: LastSeenClock }
  | { kind: "date"; month: number; day: number; year: number | null; clock: LastSeenClock };

/** A wall clock with its meridiem kept SEPARATE, because "AM" is a word. */
export type LastSeenClock = { hour12: number; minute: number; pm: boolean };

/**
 * WHICH BAND a timestamp falls in — the one rule, with no words in it.
 *
 * WHY THIS IS SPLIT OUT (v2.106.97)
 * ---------------------------------
 * `formatLastSeen` returned a finished English sentence, and it has readers on four
 * screens, so localising it by mapping its OUTPUT would be the very thing this
 * dictionary forbids: a copy edit silently drops the translation, and two states
 * sharing an English word are forced to share an Arabic one. It also cannot be done
 * by interpolation, because the plural is not a suffix — English needs one/other
 * while Arabic needs zero/one/two/few/many, so the whole KEY has to change per band
 * (the `guestExpiryKey` rule).
 *
 * So the banding is a pure function with two renderers over it: this file's English
 * one below, which is unchanged to the byte and is what the dictionary's own
 * fallback promises, and the client's translated one. One rule, so the two can never
 * disagree about which band a timestamp is in — which is the divergence that would
 * show as an Arabic screen saying "yesterday" where the English one says "today".
 */
export function lastSeenBand(lastSeenMs: number, nowMs: number): LastSeenBand {
  if (!Number.isFinite(lastSeenMs) || lastSeenMs <= 0) return { kind: "none" };
  const diff = nowMs - lastSeenMs;
  if (diff < 60_000) return { kind: "justNow" }; // includes a clock that has gone backwards
  if (diff < 60 * 60_000) return { kind: "minutes", minutes: Math.floor(diff / 60_000) };
  const then = new Date(lastSeenMs);
  const now = new Date(nowMs);
  const clock = lastSeenClock(then);
  const sameDay =
    then.getFullYear() === now.getFullYear() &&
    then.getMonth() === now.getMonth() &&
    then.getDate() === now.getDate();
  if (sameDay) return { kind: "today", clock };
  const yest = new Date(nowMs - 24 * 60 * 60_000);
  const isYesterday =
    then.getFullYear() === yest.getFullYear() &&
    then.getMonth() === yest.getMonth() &&
    then.getDate() === yest.getDate();
  if (isYesterday) return { kind: "yesterday", clock };
  return {
    kind: "date",
    month: then.getMonth(),
    day: then.getDate(),
    /* NULL rather than the year itself when it matches now, because "Jul 23" reads
       as this year and would otherwise be wrong by twelve months without saying so
       (v2.99.66). Which means the renderer picks a DIFFERENT key, not a blank. */
    year: then.getFullYear() === now.getFullYear() ? null : then.getFullYear(),
    clock,
  };
}

export const LAST_SEEN_MONTHS_EN = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

/** English rendering of a band. Byte-identical to what this function always returned. */
export function formatLastSeen(lastSeenMs: number, nowMs: number): string {
  const b = lastSeenBand(lastSeenMs, nowMs);
  switch (b.kind) {
    case "none":
      return "";
    case "justNow":
      return "last seen just now";
    case "minutes":
      return `last seen ${b.minutes} minute${b.minutes === 1 ? "" : "s"} ago`;
    case "today":
      return `last seen today at ${formatClockOf(b.clock)}`;
    case "yesterday":
      return `last seen yesterday at ${formatClockOf(b.clock)}`;
    case "date": {
      const day = `${LAST_SEEN_MONTHS_EN[b.month]} ${b.day}`;
      const year = b.year == null ? "" : `, ${b.year}`;
      return `last seen on ${day}${year} at ${formatClockOf(b.clock)}`;
    }
  }
}

export function lastSeenClock(d: Date): LastSeenClock {
  const h = d.getHours();
  return { hour12: h % 12 === 0 ? 12 : h % 12, minute: d.getMinutes(), pm: h >= 12 };
}

/** `3:05` — the DIGITS only. Western digits everywhere, per v2.106.84. */
export function formatClockDigits(c: LastSeenClock): string {
  return `${c.hour12}:${String(c.minute).padStart(2, "0")}`;
}

function formatClockOf(c: LastSeenClock): string {
  return `${formatClockDigits(c)} ${c.pm ? "PM" : "AM"}`;
}

/* ──────────────────────────────────────────────────────────────────────────
 * "Is this person here right now?", in WORDS — ONE reader (v2.105.24).
 *
 * This is `presenceDot.ts`'s discipline applied to text. Three surfaces need the answer:
 * the profile popup (where this rule was born), the incoming ring card, and now the
 * OUTGOING dial card. Three copies is how two screens come to disagree about one person —
 * v2.99.77 was exactly that defect, one rule with four call sites and a fifth that forgot
 * it, and the fix was a shared reader.
 *
 * THE RING CARD'S OWN VERSION IS THE CAUTIONARY TALE, and is why the dial card must NOT
 * be built by copying it: `presentRingProfile` branches on the legacy `statusOverride`
 * alone. It predates the v2.101.1 profile-status vocabulary, so it knows nothing about
 * `profileStatus`, `statusNote`, `idle`, `inCall`, `presenceHidden` or party lines — it
 * would cheerfully print "Online now" about a phone line, and it spells travelling
 * "Traveling" where `describeProfileStatus` spells it "Travelling", which would have been
 * a THIRD spelling of one word on one screen.
 *
 * ORDER IS THE RULE, not a formatting preference:
 *   - a PARTY LINE is not a person, so it never reports presence;
 *   - SUPPRESSION outranks everything (a guest inactive over a day has presence hidden for
 *     privacy, v2.95) — and it must return "" rather than "Offline", because saying
 *     "Offline" is still a claim about somebody the server declined to describe;
 *   - ON A CALL outranks plain online, since it is the more useful fact when deciding
 *     whether to dial;
 *   - BACKGROUNDED reads as away rather than as "Online now" or as a last-seen a few
 *     seconds ago, which is what minimising used to produce (v2.99.92).
 * ────────────────────────────────────────────────────────────────────────── */
export interface PeerPresenceInput {
  isOnline: boolean;
  /** Signed in but backgrounded (v2.99.92). */
  idle?: boolean;
  inCall: boolean;
  lastSeenAt: string | Date | null;
  presenceHidden: boolean;
  partyLine: boolean;
  memberCount: number;
}

export type PeerPresenceState =
  | { kind: "partyLine"; memberCount: number }
  | { kind: "hidden" }
  | { kind: "inCall" }
  | { kind: "idle" }
  | { kind: "online" }
  | { kind: "lastSeen"; at: number }
  | { kind: "offline" };

/**
 * WHICH presence state, with no words in it — the same split as `lastSeenBand`
 * above, and for the same reason: this rule is shared by the profile popup, the
 * full profile and the ring card, so a `text → key` map at each render site would
 * let a copy edit silently drop the translation on one of them.
 *
 * The ORDER is the rule and is unchanged; every clause's reasoning is in the
 * header comment above `PeerPresenceInput`.
 */
export function peerPresenceState(d: PeerPresenceInput): PeerPresenceState {
  if (d.partyLine) return { kind: "partyLine", memberCount: d.memberCount };
  if (d.presenceHidden) return { kind: "hidden" };
  if (d.inCall) return { kind: "inCall" };
  if (d.isOnline && d.idle) return { kind: "idle" };
  if (d.isOnline) return { kind: "online" };
  if (d.lastSeenAt) return { kind: "lastSeen", at: new Date(d.lastSeenAt).getTime() };
  return { kind: "offline" };
}

/** English rendering. Byte-identical to what this function always returned. */
export function describePeerPresence(d: PeerPresenceInput): string {
  const s = peerPresenceState(d);
  switch (s.kind) {
    case "partyLine":
      return `Party line · ${s.memberCount} on the line`;
    case "hidden":
      return "";
    case "inCall":
      return "On a call right now";
    case "idle":
      return "Away — app is in the background";
    case "online":
      return "Online now";
    case "lastSeen":
      return `Last seen ${new Date(s.at).toLocaleString()}`;
    case "offline":
      return "Offline";
  }
}

/* ── the COMPACT "…ago" band, for a row that has one line ───────────────────
   Contacts renders `last seen 5m ago`, where the profile popup renders the long
   form. Two formatters, deliberately — the row has a hard width budget (v2.106.43
   measured it) and "last seen 5 minutes ago" does not fit — but they must never
   disagree about WHICH bucket a moment is in, so the decision is shared exactly as
   `lastSeenBand` is and only the words differ. */

export type CompactAgoBand =
  | { kind: "never" }
  | { kind: "justNow" }
  | { kind: "minutes"; n: number }
  | { kind: "hours"; n: number }
  | { kind: "days"; n: number }
  | { kind: "date"; at: number };

/**
 * Total by construction: every shape that is not one of the three real time types
 * answers `never`, because `new Date(true)` is one millisecond after the epoch and
 * would render a date about somebody nobody has a time for. `<= 0` matches
 * `lastSeenBand`'s own rule — 0 is what a null column becomes on plenty of paths,
 * and two formatters disagreeing about it is the divergence this file exists to close.
 */
export function compactAgoBand(
  d: Date | string | number | null | undefined,
  nowMs: number,
): CompactAgoBand {
  if (d === null || d === undefined || d === "") return { kind: "never" };
  if (!(d instanceof Date) && typeof d !== "string" && typeof d !== "number") {
    return { kind: "never" };
  }
  const ms = (d instanceof Date ? d : new Date(d)).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return { kind: "never" };
  const diff = (nowMs - ms) / 1000;
  if (diff < 60) return { kind: "justNow" };
  if (diff < 3600) return { kind: "minutes", n: Math.floor(diff / 60) };
  if (diff < 86400) return { kind: "hours", n: Math.floor(diff / 3600) };
  if (diff < 86400 * 7) return { kind: "days", n: Math.floor(diff / 86400) };
  return { kind: "date", at: ms };
}

/**
 * "last seen …" for one row.
 *
 * TOTAL BY CONSTRUCTION, and that is not defensiveness for its own sake — it is a
 * blast-radius fix with a demonstrated failure mode. The previous shape took
 * `Date | string | null` and called `.getTime()` on whatever was not a string, so a
 * value of any OTHER type threw a TypeError out of the render — and because this is
 * called from a row inside the list, React unwound the whole page and the error
 * boundary replaced the entire Contacts screen with "An unexpected error occurred."
 * Measured, not theorised: driving the real bundle with one numeric `lastSeenAt`
 * rendered ZERO contacts and that message.
 *
 * Today the server sends a Drizzle `timestamp`, i.e. a real Date that superjson
 * revives as a Date, so the throwing path is not reachable through the ordinary
 * wire — this is about the cost when it is wrong, not a claim that it is. One row
 * losing its "last seen" line is a cosmetic degradation; the entire address book
 * disappearing is the failure the owner would report as "the contact is not
 * showing". A whole screen must not rest on one field's runtime type.
 *
 * It also accepts a NUMBER now, because that is what the sibling formatter in
 * `shared/profileFields.ts` takes (`formatLastSeen(lastSeenMs)`) — two functions
 * answering one question with different input types is how a future caller passes
 * the wrong one, and that formatter is likewise total (`!Number.isFinite` → "").
 *
 * WHAT MOVED IN v2.106.98, and why the signature did not: the BANDING (which of
 * never/just-now/minutes/hours/days/date a moment falls in, and the totality rules
 * above) now lives in `compactAgoBand` in `shared/profileFields.ts`, because this
 * row and the profile popup answer the same question about the same person and must
 * never disagree about the bucket. Only the WORDS are here, and only for the ENGLISH
 * fallback — the Contacts row renders through `compactAgoLabel` in
 * `client/src/app/presenceCopy.ts`, which reads this same band.
 *
 * It lives HERE rather than in the page for the reason `formatLastSeen` and
 * `describePeerPresence` do: an English renderer of a shared band is the dictionary's
 * own fallback, not a screen's private helper.
 */
export function relativeTime(d: Date | string | number | null | undefined): string {
  const b = compactAgoBand(d, Date.now());
  switch (b.kind) {
    case "never":
      return "never";
    case "justNow":
      return "just now";
    case "minutes":
      return `${b.n}m ago`;
    case "hours":
      return `${b.n}h ago`;
    case "days":
      return `${b.n}d ago`;
    case "date":
      return new Date(b.at).toLocaleDateString();
  }
}
