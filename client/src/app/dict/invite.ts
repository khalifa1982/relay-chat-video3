import type { Entry } from "./types";

/**
 * The SHARED INVITE MESSAGE (#161). One module per surface — see `dict/index.ts`.
 *
 * These four strings are the entire text a person outside RELAY ever sees, so they are
 * the app's first impression and the owner reviewed them directly. Keep them SHORT:
 * *"don't make the message very long."*
 *
 * ── THE ARABIC IS NOT A WORD-FOR-WORD RENDERING, DELIBERATELY ────────────────────────
 * English puts the invitee last ("X invited you to join RELAY"); Arabic reads better with
 * the verb leading, so `invite.fromLine` is «يدعوك … للانضمام إلى RELAY». The PLACEHOLDER
 * ORDER differs between the two halves and that is fine — `translate()` substitutes by
 * NAME, never by position, which is exactly why `tn`/`{who}` exist rather than a split
 * sentence (v2.106.84: a sentence chopped at the English seam can only be re-assembled
 * into nonsense in a language whose word order differs).
 *
 * ── "RELAY" STAYS LATIN IN BOTH ─────────────────────────────────────────────────────
 * It is the product's name and the domain the link points at; transliterating it would
 * make the message name a product the recipient cannot then find.
 */
export const INVITE = {
  /** Somebody with a name and a number is inviting you. `{who}` is already "Name (NNN-NNN)". */
  "invite.fromLine": {
    en: "{who} invited you to join RELAY",
    ar: "{who} يدعوك للانضمام إلى RELAY",
  },
  /** …to a specific room. `{title}` is the party line's own name. */
  "invite.fromLineRoom": {
    en: '{who} invited you to join "{title}" on RELAY',
    ar: '{who} يدعوك للانضمام إلى «{title}» على RELAY',
  },
  /* THE NAMELESS FALLBACKS ARE NOT DEAD CODE: `GroupCallScreen` shares a party line, and
     a not-yet-loaded identity query there would otherwise interpolate "undefined invited
     you" into a message about to leave the app. Better to say less than to say wrong. */
  "invite.anonLine": {
    en: "You're invited to join RELAY",
    ar: "أنت مدعو للانضمام إلى RELAY",
  },
  "invite.anonLineRoom": {
    en: 'You\'re invited to join "{title}" on RELAY',
    ar: "أنت مدعو للانضمام إلى «{title}» على RELAY",
  },
  /**
   * The standing sign-off the owner asked for: *"put kind of a stand-up code for the
   * rely … make it unique."*
   *
   * It states the one thing that actually distinguishes RELAY from every other app in
   * that inbox — you are reachable on six digits, with no phone number and no SIM — so it
   * earns its line rather than being a slogan. One line, because it is the third block of
   * a message that must stay short.
   */
  "invite.tagline": {
    en: "⚡ RELAY — six digits, no phone number.",
    ar: "⚡ RELAY — ستة أرقام، بلا رقم هاتف.",
  },
} as const satisfies Record<string, Entry>;
