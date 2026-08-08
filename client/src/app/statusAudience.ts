import { Users, Globe2, UserCheck } from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * The two status-audience options (v2.99.55), and the ONE place their labels and
 * explanatory copy live.
 *
 * Two surfaces render these — the composer's per-post picker and Profile → Status
 * privacy — and this repo has already paid for a duplicated rule once (v2.99.49:
 * "a second copy of that rule is what caused this bug", where two functions
 * disagreed about which identity a browser was using and one of them allocated).
 * Labels are cheaper to get wrong and much harder to notice, because nothing
 * fails: the two screens simply promise different things about the same setting.
 *
 * The wording is deliberately literal about what "Everyone" does and does not do.
 * It is an AUTHORIZATION widening plus a profile-visit lookup — it does NOT push
 * your story into strangers' feeds, because the story feed is bounded to your
 * contacts and the people who saved you (see getStatusAudienceIds for why it has
 * to stay bounded). Saying "everyone can see it" without that qualifier would
 * promise a broadcast the server never performs.
 */
export type StatusAudience = "contacts" | "everyone" | "specific";

export interface StatusAudienceOption {
  value: StatusAudience;
  /** Short label for a chip/segmented control. */
  label: string;
  /** One line under the label — what this option actually does. */
  hint: string;
  /** Past-tense confirmation used after a post goes out. */
  posted: string;
  Icon: LucideIcon;
}

export const AUDIENCE_OPTIONS: readonly StatusAudienceOption[] = [
  {
    value: "contacts",
    label: "Contacts only",
    hint: "People in your contacts, or who have you in theirs.",
    posted: "visible for 24h to your contacts and anyone who's saved you",
    Icon: Users,
  },
  {
    value: "everyone",
    label: "Everyone",
    hint: "Anyone on RELAY who opens your profile.",
    posted: "visible for 24h to anyone on RELAY who opens your profile",
    Icon: Globe2,
  },
  {
    value: "specific",
    label: "Specific people",
    hint: "Only the people you pick — nobody else can see it.",
    posted: "visible for 24h only to the people you picked",
    Icon: UserCheck,
  },
];

/** Fail closed, exactly like the server's normalizeStatusAudience: "everyone" and
 *  "specific" are honoured, anything else renders as the private "contacts" option. A
 *  value we don't recognise must never be labelled as a wider one. */
export function audienceOption(v: string | null | undefined): StatusAudienceOption {
  return v === "everyone" ? AUDIENCE_OPTIONS[1] : v === "specific" ? AUDIENCE_OPTIONS[2] : AUDIENCE_OPTIONS[0];
}
