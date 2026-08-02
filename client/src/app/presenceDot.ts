/**
 * ONE rule for the presence LED, shared by every surface that draws one (v2.99.92).
 *
 * Owner: *"whenever you minimize the app, the user showing offline, not the idle."*
 * Adding a third state meant eight separate dots across Contacts, the Messages
 * thread list, the chat header and the profile popup each had to learn it — and
 * eight copies of one rule is how this codebase has repeatedly ended up with one
 * surface disagreeing with another about the same person (v2.99.77 was exactly
 * that: `isGuestPresenceHidden` applied in four places and forgotten in a fifth).
 * So the rule lives here and the dots read it.
 *
 * THE COLOUR VOCABULARY IS DELIBERATELY NOT WIDENED. Idle is the ONLINE green at
 * reduced opacity with no glow, rather than a new hue: amber already means "on a
 * call" here and "Do Not Disturb" in the top bar, and a third meaning would make the
 * colour stop carrying information. Faded-green reads as "there, but not looking",
 * and the LABEL is what says it unambiguously — which is also what a screen reader
 * and a colour-blind reader get.
 */
import type { TKey } from "./i18n";
/**
 * The four states, as a stable discriminant.
 *
 * A caller that needs its OWN wording for a state — History's tooltips explain the
 * CONSEQUENCE ("Offline — calling will page their phone") rather than naming the
 * state — switches on this. It used to switch on the English label instead, which
 * is the antipattern this dictionary exists to remove: the moment somebody edits
 * "Online" the comparison stops matching and the tooltip silently falls through to
 * the wrong branch, with nothing failing.
 */
export type PresenceDotState = "inCall" | "offline" | "away" | "online";

export interface PresenceDot {
  /** CSS colour for the dot. */
  color: string;
  /** `box-shadow` for the dot, or "" for none. */
  glow: string;
  /**
   * The label as a dictionary KEY, never as finished text.
   *
   * THIS IS DELIBERATELY NOT A `label: string`, and the reason is measured rather
   * than stylistic: seven surfaces put this into an `aria-label`, so returning
   * English here meant a screen reader on an Arabic phone heard "Online" on every
   * contact row, every thread row, every group member and every call-picker entry.
   * A sweep cannot see it — the offender is an expression, not a literal — so the
   * only thing that catches it is making the English UNAVAILABLE. Dropping the
   * field turns every one of those sites into a compile error, which is what makes
   * the fix hold for the eighth surface somebody adds.
   */
  labelKey: TKey;
  /** Which of the four states this is — for a caller with its own wording. */
  state: PresenceDotState;
  /** True when there is a live session at all (foreground or background). */
  live: boolean;
}

export function presenceDot(p: {
  isOnline?: boolean | null;
  /** Signed in but backgrounded. Only meaningful while `isOnline`. */
  idle?: boolean | null;
  inCall?: boolean | null;
}): PresenceDot {
  const online = !!p.isOnline;
  // Busy outranks everything: knowing they will bounce you matters more than
  // knowing they are there (v2.88).
  if (p.inCall) {
    return {
      color: "#f59e0b",
      glow: "0 0 8px rgba(245,158,11,.7)",
      labelKey: "peer.dotOnCall",
      state: "inCall",
      live: true,
    };
  }
  if (!online) {
    // Grey, never red (v2.88) — offline is not an error.
    return {
      color: "var(--muted-foreground, #94a3b8)",
      glow: "",
      labelKey: "peer.dotOffline",
      state: "offline",
      live: false,
    };
  }
  if (p.idle) {
    // No glow: the glow is what makes the green read as "active right now", and an
    // idle person is precisely not that.
    return {
      color: "color-mix(in oklab, var(--relay-online, #06d6a0) 55%, transparent)",
      glow: "",
      labelKey: "peer.dotAway",
      state: "away",
      live: true,
    };
  }
  return {
    color: "var(--relay-online, #06d6a0)",
    glow: "0 0 8px var(--relay-online, #06d6a0)",
    labelKey: "peer.dotOnline",
    state: "online",
    live: true,
  };
}
