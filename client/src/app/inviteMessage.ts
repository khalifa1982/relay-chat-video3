import type { TKey } from "./i18n";
import { formatPin } from "./TopBar";

/**
 * THE ONE INVITE MESSAGE (#161).
 *
 * Owner, with a screenshot of a shared party-line invite arriving as a single run-on
 * line: *"this is it's look very ugly … put the username and then space between two
 * brackets … then say join relay and put relay link … make a BR break … and also below
 * put kind of a stand-up code for the relay … make it unique. don't make the message very
 * long."*
 *
 * ── WHY THE MESSAGE WAS ONE BLOB, AND WHY THE OLD CODE'S OWN COMMENT WAS WRONG ───────
 * Every share site called `navigator.share({ title, text, url })`, and `Dialer.tsx`
 * asserted in a comment that passing them separately makes the sheet *"lay them out
 * cleanly (header on top, link below) instead of concatenating into one block."* The
 * owner's screenshot disproves that: WhatsApp joins `text` and `url` with a SPACE, so the
 * sentence and the URL land on one line and wrap mid-URL. The layout is the RECEIVING
 * app's choice the moment you hand it two fields — so the only way to control it is to
 * hand over ONE field. Everything is composed into `text`, blank lines included, and
 * `url` is deliberately not passed.
 *
 * ── AND A SECOND, WORSE PROBLEM IN THE SAME SCREENSHOT ───────────────────────────────
 * The old wording was `… on RELAY — dial 794 254`, and "dial" followed by a spaced
 * six-digit run is maximally phone-shaped: the message client LINKIFIED it (green,
 * underlined, beside the real link), so the most tappable thing in the invite was a
 * tel: handler that would dial the recipient's own carrier. The number now appears as
 * `Name (794-254)` — an identifier rather than an instruction — which is both what the
 * owner asked for and the shape least likely to be read as dialable. STATED HONESTLY:
 * that REDUCES the chance, it does not eliminate it. Linkifier heuristics are the client's
 * and there is no iPhone here to confirm on.
 *
 * ── ONE COMPOSER, FOUR CALL SITES ────────────────────────────────────────────────────
 * There were FOUR share/copy sites with THREE different wordings (`Reach me on RELAY`,
 * `Call me on RELAY`, `Join "X" on RELAY — dial …`), which is how the wording the owner is
 * complaining about came to exist in the first place. This module is the only place the
 * message is built, so a future edit reaches every surface.
 */

/** The translator shape, so this module needs no React and stays drivable in a test. */
export type Translate = (key: TKey, vars?: Record<string, string | number>) => string;

export interface InviteWho {
  /** The inviter's display name; the FIRST word is used — a full name eats the line. */
  name?: string | null;
  /** The inviter's own 6-digit number. */
  pin?: string | null;
}

/**
 * "Khalifa (777-777)", or null when we do not confidently know both halves.
 *
 * Null rather than a partial: "Khalifa ()" and " (777-777)" are both worse than the
 * anonymous phrasing, and an identity query that has not resolved yet is a real state on
 * every one of these screens.
 */
export function inviteWhoLabel(who: InviteWho | null | undefined): string | null {
  const first = (who?.name ?? "").trim().split(/\s+/)[0] ?? "";
  const pin = (who?.pin ?? "").trim();
  if (!first || !/^\d{6}$/.test(pin)) return null;
  return `${first} (${formatPin(pin)})`;
}

/**
 * The composed message. THREE BLOCKS separated by blank lines, which is the "BR break"
 * the owner asked for and what stops a messaging client running the sentence into the URL:
 *
 *     Khalifa (777-777) invited you to join "Design Crew" on RELAY
 *
 *     https://<app-origin>/i/794254
 *
 *     ⚡ RELAY — six digits, no phone number.
 *
 * (The origin is written as a placeholder deliberately: `noHardcodedDomains.test.ts`
 * forbids a deployment domain anywhere under `client/src`, even in prose, and it caught
 * this comment's first draft — the app is Host-driven and every literal is one more place
 * a rename has to reach.)
 */
export function inviteLeadLine(
  t: Translate,
  opts: { who?: InviteWho | null; title?: string | null },
): string {
  const who = inviteWhoLabel(opts.who);
  const title = (opts.title ?? "").trim();
  return who
    ? title
      ? t("invite.fromLineRoom", { who, title })
      : t("invite.fromLine", { who })
    : title
      ? t("invite.anonLineRoom", { title })
      : t("invite.anonLine");
}

export function buildInviteMessage(
  t: Translate,
  opts: { who?: InviteWho | null; title?: string | null; url: string },
): string {
  /* `\n\n` rather than `\n`: a single newline is collapsed to a space by some clients,
     and it is the BLANK line that makes the link a block of its own. */
  return `${inviteLeadLine(t, opts)}\n\n${opts.url}\n\n${t("invite.tagline")}`;
}

/**
 * Share it, falling back to the clipboard where the Web Share API is absent (every
 * desktop browser) — a share button that silently does nothing is worse than one that
 * copies (v2.103.3).
 *
 * A `title` IS still passed, because mail clients use it as the SUBJECT and would otherwise
 * send an untitled message — but it is DERIVED from the message's own lead line rather than
 * taken as a parameter. A fifth argument is a fifth thing four call sites can get wrong,
 * and the subject of an invite is, by definition, its first sentence. `url` is not passed
 * at all, for the reason in this module's header.
 */
export function shareInviteMessage(
  t: Translate,
  opts: {
    who?: InviteWho | null;
    title?: string | null;
    url: string;
    onCopied: () => void;
    onCopyFailed: () => void;
  },
): void {
  const text = buildInviteMessage(t, opts);
  if (typeof navigator !== "undefined" && navigator.share) {
    navigator.share({ title: inviteLeadLine(t, opts), text }).catch(() => {});
    return;
  }
  navigator.clipboard?.writeText(text).then(opts.onCopied).catch(opts.onCopyFailed);
}
