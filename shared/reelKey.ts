/**
 * The identity of ONE story reel — what a single ring in the strip stands for.
 *
 * WHY THIS IS A STRING AND WHY IT LIVES HERE
 * -----------------------------------------
 * Since v2.105.6 a reel's subject is either a PERSON or a GROUP, and both are
 * identified by small sequential integers drawn from tables that know nothing about
 * each other — identity id 34 and conversation id 34 are unrelated, and a group's
 * own 6-digit number comes out of the SAME allocator as a person's (v2.102.0). So a
 * bare numeric key cannot say which kind it means, and the first surface to compare
 * one against the other renders a group as a person or opens the wrong reel.
 *
 * A prefixed string makes that impossible by construction rather than by care, and
 * the constructors live in `shared/` so the server that mints the keys and the
 * client that compares them cannot come to disagree — the same reason
 * `shared/profileStatus.ts` and `shared/messageDays.ts`-style rules are shared.
 *
 * There are THREE constructors rather than two because one real case has no id:
 * `status.forNumber` answers by NUMBER (it is the profile-visit pull surface), so a
 * reel synthesized from it knows the person's number and not their identity id.
 * Giving that case its own prefix is the honest option — reusing the person prefix
 * would put an identity id and a 6-digit number in one namespace, where 601586 can
 * legitimately be both.
 */

export type ReelSubjectKind = "person" | "group";

/** A reel for a person we know the identity id of (the feed's normal case). */
export function personReelKey(identityId: number): string {
  return `p:${identityId}`;
}

/** A reel for a person known only by their 6-digit number (`status.forNumber`). */
export function personReelKeyByNumber(number: string): string {
  return `pn:${number}`;
}

/** A reel addressed to a group, keyed by conversation id. */
export function groupReelKey(conversationId: number): string {
  return `g:${conversationId}`;
}

/**
 * Which kind of subject a key names, or null if it is not a key we minted.
 *
 * Returns null rather than guessing: a key from a future version, or a corrupted
 * one, must not be silently read as a person — that is the direction that renders
 * somebody else's face on a group's story.
 */
export function reelKeyKind(key: string): ReelSubjectKind | null {
  if (/^p:\d+$/.test(key) || /^pn:\d+$/.test(key)) return "person";
  if (/^g:\d+$/.test(key)) return "group";
  return null;
}
