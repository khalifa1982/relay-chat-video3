import { Fragment, type ReactNode } from "react";
import { findMentions, type MentionCandidate } from "@shared/mentions";
import { parseInlineFormat, type Mark } from "@shared/messageFormat";

// Matches http(s):// URLs and bare www. links; trailing punctuation is excluded.
const URL_RE = /((?:https?:\/\/|www\.)[^\s<]+[^\s<.,!?)\]}"'])/gi;

/**
 * Highlight roster-resolved @mentions inside one plain-text run (board 3c).
 *
 * ONLY A NAME THAT RESOLVES IS HIGHLIGHTED — see `shared/mentions.ts`. A bare
 * `/@\w+/` rule would light up "email me @ 5pm", and would render `@Dana` in accent
 * bold whether or not Dana is in the group, which SAYS she was addressed.
 *
 * EVERY BUBBLE GETS THE ACCENT NOW, INCLUDING MINE (v2.106.62) — and the branch that used
 * to exclude mine is deleted rather than kept as a no-op, because its stated reason turned
 * out to be about a surface the app had chosen for itself.
 *
 * It read: *"the outgoing bubble is orange and a bright accent span on it is the one
 * combination that does not read."* True of the SOLID `#fb923c` gradient the app used to
 * fill an own bubble with — and the board never drew that. Frames 1d and 3c both fill it
 * `rgba(245,140,60,.17)` over a near-black page, and the board draws its own `@Marcus`
 * mention in `var(--rb)` on exactly that.
 *
 * MEASURED on both fills, across all 12 accent hues, worst case:
 *
 *   accent on the OLD solid #fb923c      1.06:1   <- invisible; the old reason was right
 *   accent on the board's .17 tint       5.44:1 mobile / 4.82:1 desktop   <- clears AA
 *
 * So the mention is the accent everywhere, `mine` is gone from the signature, and the
 * emphasis no longer has to be carried by weight alone on half the messages.
 */
function withMentions(text: string, members: readonly MentionCandidate[], keyBase: number): ReactNode {
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
        // A LITERAL fallback, never `var(--rb, var(--rb))` — a custom-property cycle
        // resolves to the guaranteed-invalid value and the browser DROPS the declaration,
        // leaving the mention with no colour at all (v2.106.7).
        style={{ color: "var(--rb, #3FE0C5)" }}
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
 * Wrap a run of text in the nested emphasis tags QW-5 supports, resolving
 * @mentions within each formatted segment's literal text. The mark → element map is
 * <strong>/<em>/<s>/<code>; `code` also gets a subtle monospace pill so a snippet
 * reads as code on both the light and the tinted own-bubble. Marks nest by wrapping
 * outermost-first, and mentions run on the innermost literal text so a mention inside
 * *bold* still highlights.
 */
function markClass(mark: Mark): string {
  switch (mark) {
    case "bold":
      return "font-semibold";
    case "italic":
      return "italic";
    case "strike":
      return "line-through";
    case "code":
      return "font-mono text-[0.92em] px-1 py-0.5 rounded bg-black/10 dark:bg-white/10";
  }
}

function withFormatting(
  text: string,
  members: readonly MentionCandidate[] | undefined,
  keyBase: number,
): ReactNode {
  const segs = parseInlineFormat(text);
  return segs.map((seg, n) => {
    // A code segment is literal — mentions are NOT resolved inside a code span (an
    // @name in a snippet is code, not an address).
    const hasCode = seg.marks.includes("code");
    const leaf: ReactNode =
      !hasCode && members && members.length
        ? withMentions(seg.text, members, keyBase * 1000 + n)
        : seg.text;
    if (seg.marks.length === 0) return <Fragment key={`${keyBase}f${n}`}>{leaf}</Fragment>;
    // Wrap outermost-first so the resulting DOM nests in a stable order.
    let node: ReactNode = leaf;
    for (let m = seg.marks.length - 1; m >= 0; m--) {
      const mark = seg.marks[m];
      node = (
        <span key={`${keyBase}f${n}m${m}`} className={markClass(mark)}>
          {node}
        </span>
      );
    }
    return <Fragment key={`${keyBase}f${n}`}>{node}</Fragment>;
  });
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
  members?: readonly MentionCandidate[]
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
       inside an anchor. Formatting is applied at the same layer (URLs are already
       split out, so a `*` inside a link can't be read as a marker), and mentions run
       on each formatted segment's leaf text. */
    return <Fragment key={i}>{withFormatting(part, members, i)}</Fragment>;
  });
}
