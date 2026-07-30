/**
 * @mentions in a group conversation — board 3c.
 *
 * A MENTION MUST RESOLVE AGAINST THE ROSTER, NOT MATCH ANY `@word`.
 * -----------------------------------------------------------------
 * The tempting rule is `/@(\w+)/` — highlight anything after an at-sign. It is
 * wrong twice over. It lights up "email me @ 5pm" and "@here", which are not
 * mentions of anybody; and worse, it renders `@Dana` in accent bold whether or not
 * Dana is in the group, which SAYS she was addressed and implies she was told. A
 * highlight that means "this person was pinged" has to be false when they were not.
 *
 * So a mention is `@` followed by a roster member's display name, matched
 * LONGEST-FIRST because display names contain spaces: with "Ali" and "Ali Hassan"
 * both members, `@Ali Hassan` is one mention of the second person rather than a
 * mention of the first followed by a stray surname.
 *
 * NOTHING IS STORED. The message body carries the text somebody typed, and this
 * resolves it at render time against the CURRENT roster — so a member who leaves
 * stops being highlighted, which is honest: they are no longer somebody this
 * conversation can address. The alternative (a stored mention list on the message)
 * would keep asserting a ping to somebody who is gone.
 */

export interface MentionCandidate {
  /** The identity being mentioned. */
  id: number;
  /** What the composer inserts and the renderer matches. */
  name: string;
}

export interface MentionSpan {
  /** Index of the `@` in the source string. */
  start: number;
  /** Index just past the matched name. */
  end: number;
  /** The full matched text, `@` included. */
  text: string;
  id: number;
}

/** The character before an `@` must not be a word character, or an email address
 *  (`ali@example.com`) would have its domain read as a mention. */
function boundaryOk(text: string, at: number): boolean {
  if (at === 0) return true;
  return !/[A-Za-z0-9_@.]/.test(text[at - 1]);
}

/**
 * Every mention in a body, in order, resolved against the roster.
 *
 * Candidates are sorted longest-name-first ONCE rather than per position, so this
 * stays linear in the body for a fixed roster. Overlaps cannot happen because the
 * scan jumps past each match.
 */
export function findMentions(
  body: string | null | undefined,
  members: readonly MentionCandidate[]
): MentionSpan[] {
  if (!body || !members.length) return [];
  const sorted = [...members]
    .filter((m) => m.name && m.name.length > 0)
    .sort((a, b) => b.name.length - a.name.length);
  const out: MentionSpan[] = [];
  let i = 0;
  while (i < body.length) {
    const at = body.indexOf("@", i);
    if (at < 0) break;
    if (!boundaryOk(body, at)) {
      i = at + 1;
      continue;
    }
    const rest = body.slice(at + 1);
    /* Case-insensitively, because somebody typing a mention by hand should not have
       to reproduce the capitalisation of a display name — the resolved identity is
       the same person either way. */
    const lower = rest.toLowerCase();
    const hit = sorted.find((m) => lower.startsWith(m.name.toLowerCase()));
    if (hit) {
      const end = at + 1 + hit.name.length;
      out.push({ start: at, end, text: body.slice(at, end), id: hit.id });
      i = end;
    } else {
      i = at + 1;
    }
  }
  return out;
}

/** Whether a given identity is mentioned in a body. Used to decide whether to
 *  emphasise the whole row for the person addressed. */
export function mentions(
  body: string | null | undefined,
  members: readonly MentionCandidate[],
  identityId: number
): boolean {
  return findMentions(body, members).some((m) => m.id === identityId);
}

/**
 * The composer's autocomplete: the `@` token being typed at the caret, or null.
 *
 * ANCHORED AT THE CARET rather than scanning the whole draft, because the answer is
 * about what the user is typing RIGHT NOW — scanning would re-open a completed
 * mention earlier in the line every time they typed a character after it.
 *
 * A token containing a newline ends the search: an `@` two lines up is not what the
 * caret is on.
 */
export function mentionQueryAt(
  draft: string,
  caret: number
): { query: string; start: number } | null {
  const upto = draft.slice(0, caret);
  const at = upto.lastIndexOf("@");
  if (at < 0) return null;
  if (!boundaryOk(draft, at)) return null;
  const query = upto.slice(at + 1);
  if (/[\n\r]/.test(query)) return null;
  /* Bounded, so a long paragraph after a stray `@` does not keep the picker open
     while matching nothing. Two words is enough for "First Last". */
  if (query.length > 40) return null;
  if (query.split(" ").length > 2) return null;
  return { query, start: at };
}

/** Roster entries whose name matches what is being typed, best-first. Prefix
 *  matches outrank interior ones, because typing "al" means somebody whose name
 *  STARTS with it far more often than somebody with it in the middle. */
export function rankMentionMatches(
  query: string,
  members: readonly MentionCandidate[],
  limit = 6
): MentionCandidate[] {
  const q = query.trim().toLowerCase();
  if (!q) return members.slice(0, limit);
  const scored: { m: MentionCandidate; rank: number }[] = [];
  for (const m of members) {
    const name = m.name.toLowerCase();
    if (name.startsWith(q)) scored.push({ m, rank: 0 });
    else if (name.split(" ").some((w) => w.startsWith(q))) scored.push({ m, rank: 1 });
    else if (name.includes(q)) scored.push({ m, rank: 2 });
  }
  scored.sort((a, b) => a.rank - b.rank || a.m.name.localeCompare(b.m.name));
  return scored.slice(0, limit).map((s) => s.m);
}

/**
 * Replace the token being typed with a completed mention, and report where the
 * caret should land.
 *
 * A TRAILING SPACE IS ADDED so the next word is not swallowed into the name on the
 * next render — `@Dana` followed immediately by "can" would otherwise be tested as
 * the name "Danacan" and stop resolving. But it is added ONLY when the text at the
 * caret does not already begin with one: completing mid-sentence otherwise leaves a
 * double space, which is small, visible, and entirely the tool's fault.
 */
export function applyMention(
  draft: string,
  caret: number,
  member: MentionCandidate
): { text: string; caret: number } | null {
  const tok = mentionQueryAt(draft, caret);
  if (!tok) return null;
  const rest = draft.slice(caret);
  const inserted = "@" + member.name + (rest.startsWith(" ") ? "" : " ");
  const text = draft.slice(0, tok.start) + inserted + rest;
  /* The caret lands PAST the space either way — after inserting our own, or past
     the one already there — so the next keystroke starts a new word rather than
     extending the name. */
  return { text, caret: tok.start + inserted.length + (rest.startsWith(" ") ? 1 : 0) };
}
