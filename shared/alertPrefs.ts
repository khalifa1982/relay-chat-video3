/**
 * DO NOT DISTURB, PER-CONVERSATION MUTE, AND THE GROUP LOCK — the one rule, on
 * the side that can still apply it.
 *
 * ── WHAT BROKE ─────────────────────────────────────────────────────────────
 * All three are per-DEVICE settings in localStorage, and the decision recorded in
 * `conversation_participants` ("MUTE IS DELIBERATELY NOT HERE … the worker has to
 * silence a notification without asking the server anything") rested on one fact:
 * every OS-level alert went through the service worker, which reads a Cache
 * Storage mirror of those settings and drops or redacts accordingly.
 *
 * v2.107.8 stopped that being true. To make message notifications appear on the
 * native shells, `sendPushToIdentity` began attaching an FCM `notification` block
 * and sending Expo pushes — both of which the OPERATING SYSTEM renders directly.
 * No service worker is involved, so on a native shell:
 *
 *   • Do Not Disturb no longer silenced anything.
 *   • A muted conversation buzzed the phone anyway.
 *   • A LOCKED group's message preview appeared on the lock screen, naming the
 *     sender and quoting the text — which is the exact thing the lock exists to
 *     prevent, now that the same release also put the message body in the banner.
 *
 * ── WHY THE PREFS RIDE ON THE SUBSCRIPTION ─────────────────────────────────
 * The settings are per-device and `push_subscriptions` is already per-device: one
 * row per endpoint, and on a native shell that endpoint belongs to the very
 * handset whose localStorage holds the switches. So the page mirrors them onto
 * its own subscription row, exactly as it already mirrors them into Cache Storage
 * for the worker, and the sender consults the row it is about to send to.
 *
 * They are NOT moved to `conversation_participants`: that would make mute an
 * account-wide setting and silence a thread on every device the account owns,
 * which is a different feature and not the one anybody asked for.
 *
 * ── FAILS OPEN, EVERY TIME ─────────────────────────────────────────────────
 * An absent, unparseable, or partial prefs record reads as "nothing suppressed",
 * matching the service worker's own rule. A missed notification is worse than an
 * unwanted one, and a device that has never synced (an older page, storage
 * disabled) must keep behaving exactly as it does today.
 */

export interface AlertPrefs {
  /** Silence everything except a ring. */
  dnd: boolean;
  /** Conversation ids whose MESSAGES are silenced on this device. */
  muted: number[];
  /** Conversation ids whose messages must not be NAMED or QUOTED on this device. */
  locked: number[];
}

export const EMPTY_ALERT_PREFS: AlertPrefs = { dnd: false, muted: [], locked: [] };

/**
 * How many conversation ids one device may register per list.
 *
 * Bounded because this is stored per subscription row and read on the send path;
 * an unbounded list is a write amplifier a client controls. Two hundred is far
 * past any real number of muted or locked chats, and the excess is DROPPED rather
 * than refused — a device with an implausible number of mutes should lose the
 * tail of the list, not the whole sync.
 */
export const MAX_ALERT_IDS = 200;

/** What the redacted banner says. Byte-identical to `client/public/sw.js`, which
 *  applies the same rule for Web Push — pinned by test, because two spellings of
 *  the same redaction is how one of them comes to leak a name. */
export const REDACTED_TITLE = "RELAY";
export const REDACTED_BODY = "New message in a locked chat";

function ids(v: unknown): number[] {
  if (!Array.isArray(v)) return [];
  const out: number[] = [];
  for (const x of v) {
    if (typeof x === "number" && Number.isInteger(x) && x > 0 && !out.includes(x)) out.push(x);
    if (out.length >= MAX_ALERT_IDS) break;
  }
  return out;
}

/**
 * Coerce anything — a parsed JSON column, a tRPC input, `null` — into prefs.
 *
 * Every field defaults to the permissive value, so a record this function cannot
 * read suppresses nothing.
 */
export function normalizeAlertPrefs(v: unknown): AlertPrefs {
  if (!v || typeof v !== "object" || Array.isArray(v)) return { ...EMPTY_ALERT_PREFS };
  const o = v as Record<string, unknown>;
  return { dnd: o.dnd === true, muted: ids(o.muted), locked: ids(o.locked) };
}

/** Parse a stored prefs column. Never throws; an unreadable value suppresses nothing. */
export function parseAlertPrefs(raw: string | null | undefined): AlertPrefs {
  if (!raw) return { ...EMPTY_ALERT_PREFS };
  try {
    return normalizeAlertPrefs(JSON.parse(raw));
  } catch {
    return { ...EMPTY_ALERT_PREFS };
  }
}

/** Is this the empty record? Used to store NULL instead of `{}` for the common case. */
export function alertPrefsAreEmpty(p: AlertPrefs): boolean {
  return !p.dnd && p.muted.length === 0 && p.locked.length === 0;
}

/**
 * The conversation a message push is about, read from its own tag.
 *
 * The tag is the only carrier — `PushPayload` has no conversation field, and the
 * service worker has always derived it this way (`/^relay-msg-(\d+)$/`). Kept
 * here so the server and the worker cannot come to disagree about which chat a
 * notification belongs to; the test pins the two regexes against each other.
 */
export function conversationOfPushTag(tag: string | null | undefined): number | null {
  const m = /^relay-msg-(\d+)$/.exec(tag ?? "");
  return m ? Number(m[1]) : null;
}

/**
 * What to do with one push for one device.
 *
 * `drop`   — do not deliver at all (DND, or a muted conversation).
 * `redact` — deliver, but name nobody and quote nothing (a locked conversation).
 * `send`   — deliver as composed.
 *
 * THE THREE RULES ARE THE WORKER'S, IN THE WORKER'S ORDER:
 *
 *   • A RING IS NEVER DROPPED. Missing a call is worse than an unwanted buzz, and
 *     it is the one alert that cannot be caught up on later.
 *   • DND IS THE DEFAULT-DENY, not a list of covered kinds. Any push kind added
 *     later is silenced by it without anybody remembering to opt in — the
 *     inversion v2.99.81 made in the worker for the same reason.
 *   • MUTE AND LOCK ARE MESSAGE-ONLY. A per-conversation mute must not silence a
 *     missed call or a voicemail from that same person, and a lock redacts rather
 *     than suppresses, because a privacy screen has no business losing a message.
 *
 * A message with no resolvable conversation is neither muted nor locked: the tag
 * is what carries the id, and a push we cannot attribute must not be suppressed
 * on the strength of a guess.
 */
export type PushDisposition = "send" | "drop" | "redact";

export function pushDisposition(input: {
  kind: string;
  tag?: string | null;
  prefs: AlertPrefs;
}): PushDisposition {
  if (input.kind === "incoming-call") return "send";
  if (input.prefs.dnd) return "drop";
  if (input.kind !== "message") return "send";
  const conv = conversationOfPushTag(input.tag);
  if (conv === null) return "send";
  if (input.prefs.muted.includes(conv)) return "drop";
  if (input.prefs.locked.includes(conv)) return "redact";
  return "send";
}
