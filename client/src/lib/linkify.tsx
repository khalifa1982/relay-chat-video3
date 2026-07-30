import { Fragment, type ReactNode } from "react";
import { findMentions, type MentionCandidate } from "@shared/mentions";

// Matches http(s):// URLs and bare www. links; trailing punctuation is excluded.
const URL_RE = /((?:https?:\/\/|www\.)[^\s<]+[^\s<.,!?)\]}"'])/gi;

/**
 * Highlight roster-resolved @mentions inside one plain-text run (board 3c).
 *
 * ONLY A NAME THAT RESOLVES IS HIGHLIGHTED — see `shared/mentions.ts`. A bare
 * `/@\w+/` rule would light up "email me @ 5pm", and would render `@Dana` in accent
 * bold whether or not Dana is in the group, which SAYS she was addressed.
 *
 * MINE gets no accent, deliberately: the outgoing bubble is orange and a bright
 * accent span on it is the one combination that does not read. It stays emphasised
 * by weight, which is what carries the meaning anyway.
 */
function withMentions(text: string, members: readonly MentionCandidate[], mine: boolean, keyBase: number): ReactNode {
  const spans = findMentions(text, members);
  if (!spans.length) return text;
  const out: ReactNode[] = [];
  let cursor = 0;
  spans.forEach((s, n) => {
    if (s.start > cursor) out.push(<Fragment key={`${keyBase}t${n}`}>{text.slice(cursor, s.start)}</Fragment>);
    out.push(
      <span
        key={`${keyBase}m${n}`}
        className="font-semibold"
        style={mine ? undefined : { color: "var(--rb, #3FE0C5)" }}
      >
        {s.text}
      </span>
    );
    cursor = s.end;
  });
  if (cursor < text.length) out.push(<Fragment key={`${keyBase}tail`}>{text.slice(cursor)}</Fragment>);
  return out;
}

/**
 * Turn URLs in a plain-text string into clickable links. Returns React nodes,
 * so the non-link text is still escaped by React (no XSS). Only http(s)/www
 * schemes are linked — never javascript:/data:.
 *
 * `members` opts a group conversation into @mention highlighting. Absent (every
 * pre-existing caller, and every 1:1) the output is byte-identical to before — a
 * DM has one other person in it, so there is nobody a mention could disambiguate.
 */
export function linkify(
  text: string | null | undefined,
  members?: readonly MentionCandidate[],
  mine?: boolean
): ReactNode {
  if (!text) return text ?? null;
  const parts = text.split(URL_RE);
  return parts.map((part, i) => {
    // Capturing split puts the matched URLs at odd indices.
    if (i % 2 === 1) {
      const href = part.toLowerCase().startsWith("www.") ? "https://" + part : part;
      return (
        <a
          key={i}
          href={href}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="underline underline-offset-2 break-all text-[color:var(--relay-online,theme(colors.primary.DEFAULT))]"
        >
          {part}
        </a>
      );
    }
    /* Mentions are resolved WITHIN the non-URL runs only, so a name that happens to
       appear inside a link's path cannot be turned into a mention span sitting
       inside an anchor. */
    return (
      <Fragment key={i}>
        {members && members.length ? withMentions(part, members, !!mine, i) : part}
      </Fragment>
    );
  });
}
