/**
 * Objectionable-content filter (v2.107.54).
 *
 * WHY THIS EXISTS
 * App Store Review Guideline 1.2 requires a user-generated-content app to have "a
 * method for filtering objectionable content". This is that method: a curated
 * matcher for unambiguous slurs and exploitation terms, applied server-side to the
 * content that is BROADCAST to people who did not opt into it — story text and
 * captions, the profile name and status note everyone who looks you up sees, and a
 * group's name. It masks a match rather than rejecting the whole write, so a false
 * positive costs a few asterisks instead of a lost post.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * It does not police private 1:1 or group MESSAGES. Two adults messaging each other
 * privately are not "posting content" in the 1.2 sense, and a keyword mask on private
 * speech is both the wrong tool (it does not stop a determined sender) and a real
 * harm (it silently rewrites what someone said to a specific person). The report +
 * block + unsend controls are the mechanisms for private conversations; this is the
 * mechanism for the broadcast surfaces. The one exception the app enforces elsewhere
 * is child-sexual content, which is never acceptable on any surface.
 *
 * SCOPE AND HONESTY
 * A word list is a blunt instrument. It is not, and cannot be, a complete moderation
 * system — obfuscation defeats it and context escapes it. It is the automated FILTER
 * that pairs with the human mechanisms (reporting, blocking, 24h enforcement) the
 * guidelines also require. Keep the list to terms that are objectionable in every
 * context; anything context-dependent belongs to reporting, not to a blanket mask.
 */

/**
 * Terms that are objectionable in ANY context. Kept intentionally short and limited
 * to unambiguous slurs and exploitation terms — a longer, cleverer list is a longer,
 * cleverer way to censor ordinary words. Matching is case-insensitive and whole-word
 * (see `buildPattern`), so "Scunthorpe" and "class" are safe.
 *
 * The list is stored as base64 so a source-code scan (or a casual reader of the repo)
 * does not surface a wall of slurs; it is decoded once at module load.
 */
const ENCODED_TERMS: string[] = [
  // Each entry is base64(term). Decoded at load. This is obfuscation for the READER
  // of the source, not security — the decoded list is in memory as normal.
  "bmlnZ2Vy", "bmlnZ2E=", "ZmFnZ290", "ZmFn", "a2lrZQ==", "c3BpYw==",
  "Y2hpbms=", "Y29vbg==", "dHJhbm55", "cmV0YXJk", "cmFwaXN0",
  "Y2hpbGQgcG9ybg==", "Y2hpbGRwb3Ju", "Y3Ntdw==", "cGVkbw==", "cGVkb3BoaWxl",
  "a3lz", "a2lsbCB5b3Vyc2VsZg==", "d2V0YmFjaw==", "YmVhbmVy",
];

function decode(b64: string): string {
  // atob exists in browsers and modern Node; fall back to Buffer on older Node.
  try {
    if (typeof atob === "function") return atob(b64);
  } catch {
    /* fall through */
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const B: any = (globalThis as any).Buffer;
  return B ? B.from(b64, "base64").toString("utf8") : "";
}

const TERMS: string[] = ENCODED_TERMS.map(decode).filter(Boolean);

/** Escape a term for use inside a RegExp. */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * ONE case-insensitive, global pattern matching any listed term on a word boundary.
 * A term containing a space (e.g. "child porn") still boundary-anchors on its ends,
 * so it matches the phrase without matching either word alone. Built once.
 */
const PATTERN: RegExp | null =
  TERMS.length > 0
    ? new RegExp(`\\b(?:${TERMS.map(escapeRe).join("|")})\\b`, "gi")
    : null;

/** True if the text contains a listed objectionable term. */
export function containsObjectionable(text: string | null | undefined): boolean {
  if (!text || !PATTERN) return false;
  PATTERN.lastIndex = 0;
  return PATTERN.test(text);
}

/**
 * Mask any listed term in the text, preserving length with asterisks so the shape of
 * the sentence survives ("that ****** is here"). Returns the input unchanged when
 * there is nothing to mask (and preserves null/undefined so callers can pass optional
 * fields straight through).
 */
export function sanitizeUgcText<T extends string | null | undefined>(text: T): T {
  if (!text || !PATTERN) return text;
  PATTERN.lastIndex = 0;
  return text.replace(PATTERN, (m) => "*".repeat(m.length)) as T;
}
