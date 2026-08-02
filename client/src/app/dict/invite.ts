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

  /* ── the invite CARD (#109) ───────────────────────────────────────────────
     The card a shared `/i/<pin>` link lands on. It is the FIRST screen somebody
     reaching RELAY from a link ever sees, and it was English-only — the one place
     where "the app has an Arabic switch" was least true, because a visitor with no
     identity has not been anywhere that offers the switch yet.

     `invite.lineCount*` bands rather than interpolating, for the same reason every
     other count here does: Arabic's dual is a word. */
  "invite.kindLine": { en: "Party line", ar: "خط جماعي" },
  "invite.kindCall": { en: "Call invite", ar: "دعوة مكالمة" },
  "invite.notFoundTitle": { en: "Number not found", ar: "الرقم غير موجود" },
  "invite.notFoundBody": {
    en: "There's no RELAY user with this number",
    ar: "لا يوجد مستخدم RELAY بهذا الرقم",
  },
  "invite.lineCountNobody": {
    en: "Nobody on the line yet — you'd be first",
    ar: "لا أحد على الخط بعد — ستكون أول من ينضم",
  },
  "invite.lineCountOne": { en: "1 on the line now", ar: "شخص واحد على الخط الآن" },
  "invite.lineCountTwo": { en: "2 on the line now", ar: "شخصان على الخط الآن" },
  "invite.lineCountFew": { en: "{count} on the line now", ar: "{count} أشخاص على الخط الآن" },
  "invite.lineCountMany": { en: "{count} on the line now", ar: "{count} شخصًا على الخط الآن" },
  /* The roster is UNKNOWN rather than empty when the API tier cannot reach the
     signaling node — a distinction the copy has to keep, or the card makes a false
     claim about somebody else's call. */
  "invite.lineRosterUnknown": {
    en: "Open the line to see who's on it",
    ar: "افتح الخط لترى من عليه",
  },
  /* ONE key for the whole line: `{when}` is a date and `{who}` a count phrase, and
     Arabic puts the two in a different order from English. */
  "invite.lineCreated": { en: "{who} · created {when}", ar: "{who} · أُنشئ في {when}" },
  "invite.peerInCall": { en: "On a call right now", ar: "في مكالمة الآن" },
  "invite.peerOnline": { en: "Online now", ar: "متصل الآن" },
  "invite.peerOffline": {
    en: "Offline — you can't call them right now",
    ar: "غير متصل — لا يمكنك الاتصال به الآن",
  },
  "invite.creator": { en: "Creator", ar: "المُنشئ" },
  "invite.onTheLine": { en: "On the line", ar: "على الخط" },
  "invite.host": { en: "Host", ar: "المضيف" },
  "invite.hostTitle": { en: "Host of this call", ar: "مضيف هذه المكالمة" },
  "invite.cohost": { en: "Co-host", ar: "مضيف مشارك" },
  "invite.cohostTitle": {
    en: "Co-host — can moderate this call",
    ar: "مضيف مشارك — يمكنه إدارة هذه المكالمة",
  },
  /* `{ago}` is a compact duration (`4m`, `3h 20m`) from `formatElapsedSince`, which
     is still English-abbreviated — named in the release notes rather than half-done,
     because a COMPOUND duration needs a plural per unit and that is its own piece of
     work. Substituted by name, so Arabic still controls where it sits. */
  "invite.joined": { en: "joined {ago} ago", ar: "انضم قبل {ago}" },
} as const satisfies Record<string, Entry>;
