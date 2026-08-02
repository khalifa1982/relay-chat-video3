/**
 * The PROFILE STATUS — the label somebody sets about themselves (v2.101.1).
 *
 * Owner: *"you are in work, vacation, travel, free, and you can put some notes on
 * it… and it's like four items, travel, vacation, work, three, or busy. and everyone
 * has emoji and color."*
 *
 * THIS IS NOT PRESENCE, and keeping the two apart is the whole design. Presence is
 * derived from whether the app is open (`effectiveStatus` → `presenceDot`), and its
 * colour vocabulary is deliberately narrow: green means here, faded green means
 * backgrounded, amber means on-a-call-or-DND, grey means gone. CLAUDE.md is explicit
 * that a third meaning for a colour makes colour stop carrying information (v2.99.92),
 * so five new labels could not be crammed into `statusOverride` — they would have had
 * to teach `presenceDot` five new hues, and the LED would stop meaning anything.
 *
 * So the label lives in its own column and the AVAILABILITY it implies is DERIVED
 * from it, in exactly one place, by `overrideForStatus`. One writer, one source of
 * truth: every existing consumer of `statusOverride` keeps working untouched, and the
 * label and the availability can never disagree because one is computed from the other.
 *
 * COLOUR IS REINFORCEMENT HERE, NEVER THE CARRIER. The chip renders its label in the
 * ordinary foreground colour with the hue applied to a tint and a border, so nothing
 * depends on telling sky from violet at 11px — which is also why these five hues need
 * no contrast measurement of their own, unlike the AA-measured `--relay-*-text`
 * tokens that DO carry small coloured text (v2.99.94).
 */

/** The five the owner named, plus "" meaning no label at all. */
export const PROFILE_STATUSES = ["work", "vacation", "travel", "free", "busy"] as const;
export type ProfileStatus = (typeof PROFILE_STATUSES)[number];

export interface ProfileStatusMeta {
  key: ProfileStatus;
  /**
   * Finished English, and the FALLBACK rather than what a screen renders.
   *
   * Kept because this module is imported by the SERVER as well as the browser, and
   * `describeProfileStatus` composes a string for surfaces that have no translator at
   * all. A render site that CAN translate uses `labelKey`; one that cannot still shows
   * words rather than a blank.
   */
  label: string;
  emoji: string;
  /** Hue for the chip's tint + border. Never used for the label's own text. */
  color: string;
  /** What choosing it means, shown under the picker. English, for the same reason. */
  hint: string;
  /**
   * The dictionary keys for `label` and `hint`.
   *
   * PLAIN STRINGS, deliberately not the client's `TKey`: this module is `shared/`, so
   * importing a client type would make the server bundle depend on the browser's
   * dictionary. The render site narrows them, and `profileStatus.test.ts` cross-checks
   * both against the real dictionary, so a typo cannot survive.
   *
   * NAMING THEM HERE RATHER THAN IN A MAP BESIDE EACH RENDER SITE is what stops the
   * two consumers drifting: `PeerOverlays`' chip and `ProfileStatusPicker`'s grid show
   * the same five labels, and a hand-kept map in each is two lists to keep in step. A
   * sixth status added below now arrives carrying its own keys.
   *
   * `labelKey` points at `peer.profileStatus.*` rather than a private copy because
   * `dict/peer.ts` asks for exactly that in its own header: one fact with two keys is
   * how one fact acquires two different Arabic words.
   */
  labelKey: string;
  hintKey: string;
}

export const PROFILE_STATUS_META: readonly ProfileStatusMeta[] = [
  {
    key: "work",
    label: "At work",
    emoji: "💼",
    color: "#38bdf8",
    hint: "Reachable, but working — people can still call you.",
    labelKey: "peer.profileStatus.work",
    hintKey: "profileStatus.hintWork",
  },
  {
    key: "vacation",
    label: "On vacation",
    emoji: "🏖️",
    color: "#a78bfa",
    // Vacation and travel both mean "not at my desk", so both derive the same
    // availability. The LABEL is what differs, which is the point of having one.
    hint: "Shows you as away as well as on vacation.",
    labelKey: "peer.profileStatus.vacation",
    hintKey: "profileStatus.hintVacation",
  },
  {
    key: "travel",
    label: "Travelling",
    emoji: "✈️",
    color: "#fb923c",
    hint: "Shows you as travelling — the badge people already know.",
    labelKey: "peer.profileStatus.travel",
    hintKey: "profileStatus.hintTravel",
  },
  {
    key: "free",
    label: "Free to talk",
    emoji: "🟢",
    color: "#22c55e",
    hint: "Presence decides the rest: online when you're active.",
    labelKey: "peer.profileStatus.free",
    hintKey: "profileStatus.hintFree",
  },
  {
    key: "busy",
    label: "Busy",
    emoji: "⛔",
    color: "#ef4444",
    hint: "Shows you as away, so people know before they dial.",
    labelKey: "peer.profileStatus.busy",
    hintKey: "profileStatus.hintBusy",
  },
] as const;

/** The column holds 140, and a note longer than a line stops being a note. */
export const MAX_STATUS_NOTE = 140;

/**
 * Narrow an unknown value to a profile status, or null.
 *
 * FAILS TO NULL rather than to a default: this label is a claim the person makes
 * about themselves, shown to everybody who looks them up, and "On vacation" when
 * they picked nothing is worse than showing no label at all. `""` is a legitimate
 * clear and also resolves to null, so the two ways of saying "no label" agree.
 */
export function normalizeProfileStatus(v: unknown): ProfileStatus | null {
  return typeof v === "string" && (PROFILE_STATUSES as readonly string[]).includes(v)
    ? (v as ProfileStatus)
    : null;
}

/** The metadata for a status, or null. One lookup, so no surface hand-rolls a label. */
export function profileStatusMeta(v: unknown): ProfileStatusMeta | null {
  const key = normalizeProfileStatus(v);
  return key ? (PROFILE_STATUS_META.find((m) => m.key === key) ?? null) : null;
}

/**
 * A free-text note, bounded to the column.
 *
 * Newlines collapse to spaces: the chip is one line everywhere it appears, and a
 * stored newline would either be swallowed silently or break a layout depending on
 * the surface — collapsing it means every surface gets the same string.
 */
export function normalizeStatusNote(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/\s+/g, " ").trim();
  return s ? s.slice(0, MAX_STATUS_NOTE) : null;
}

/**
 * The AVAILABILITY a profile status implies — the single place the two are linked.
 *
 * `statusOverride` is the pre-existing presence override that `effectiveStatus` and
 * `presenceDot` already understand, and it stays exactly three values wide. Deriving
 * it here rather than storing it separately is what stops the label and the LED
 * disagreeing: there is nothing to keep in sync, because one is computed.
 *
 *   vacation, travel → "travel"  (not at my desk, and the badge already exists)
 *   busy             → "away"    (tell people before they dial)
 *   work, free, none → ""        (presence decides — being at work is not being away)
 *
 * "work" mapping to auto is a deliberate call rather than an oversight: somebody at
 * work is usually AT their computer, so marking them away would make the LED lie
 * about the most reachable state on the list.
 */
export function overrideForStatus(v: unknown): "" | "away" | "travel" {
  switch (normalizeProfileStatus(v)) {
    case "vacation":
    case "travel":
      return "travel";
    case "busy":
      return "away";
    default:
      return "";
  }
}

/** "🏖️ On vacation · back Monday" — one string, so no surface composes its own. */
export function describeProfileStatus(
  status: unknown,
  note?: string | null
): string | null {
  const meta = profileStatusMeta(status);
  if (!meta) return null;
  const n = normalizeStatusNote(note);
  return n ? `${meta.emoji} ${meta.label} · ${n}` : `${meta.emoji} ${meta.label}`;
}
