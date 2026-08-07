/**
 * Inline text formatting (QW-5, v2.107.56) — WhatsApp-style emphasis markers:
 *
 *   *bold*      _italic_      ~strikethrough~      `monospace`
 *
 * This module is the PARSER only: it turns a plain string into a flat list of
 * segments, each carrying the set of marks active over it. The renderer
 * (client/src/lib/linkify.tsx) maps segments to nested <strong>/<em>/<s>/<code>
 * and, within each segment's literal text, still resolves @mentions. Keeping the
 * parser pure (no React) is what lets it be unit-tested headlessly and lets the
 * renderer own escaping.
 *
 * DESIGN — why the boundary rules are strict
 * The whole risk of an emphasis syntax in a chat app is FALSE POSITIVES: turning
 * `my_var_name` into part-italic, `5 * 3 = 15` into bold, or a stray asterisk into
 * a swallowed rest-of-message. So a marker only opens when it sits at a boundary
 * (start of string, whitespace, or punctuation) with a NON-space right after it,
 * and only closes with a non-space right before it and a boundary right after. An
 * unmatched marker is left as a literal character. This is the same heuristic
 * WhatsApp uses, and it means ordinary prose with the occasional `*` or `_` renders
 * exactly as typed.
 *
 * `code` is literal inside — like Markdown, once a backtick span opens, the other
 * three markers inside it are plain text (you can type `*not bold*` in monospace).
 * The other three nest freely: `*bold _and italic_*` gives a run that is both.
 */

export type Mark = "bold" | "italic" | "strike" | "code";

export interface FormatSeg {
  text: string;
  /** Marks active over this run, outermost-first (stable order for rendering). */
  marks: Mark[];
}

const MARKERS: Record<string, Mark> = {
  "*": "bold",
  _: "italic",
  "~": "strike",
  "`": "code",
};

/** A boundary character on the OUTER side of a marker: start/end handled by index. */
function isBoundary(ch: string | undefined): boolean {
  if (ch === undefined) return true; // start or end of string
  return /\s/.test(ch) || /[(){}\[\]<>"'.,!?;:—–-]/.test(ch);
}

/**
 * Find the earliest valid emphasis span in `text`. Returns the marker, the inner
 * text bounds, or null if there is none. "Earliest" is by opening index; ties break
 * by the marker order in MARKERS (bold, italic, strike, code) which only matters when
 * two different markers open at the same index, which they cannot (one character).
 */
function findSpan(
  text: string,
): { marker: string; open: number; innerStart: number; innerEnd: number; close: number } | null {
  for (let i = 0; i < text.length; i++) {
    const marker = text[i];
    if (!(marker in MARKERS)) continue;
    // Opening test: boundary before, non-space after, and not the very last char.
    if (!isBoundary(text[i - 1])) continue;
    const after = text[i + 1];
    if (after === undefined || /\s/.test(after)) continue;
    // Scan for the matching close: a same marker with a non-space before it and a
    // boundary after it. For `code`, the inner is literal, so the first qualifying
    // backtick closes it; for the others the same rule applies (shortest valid span).
    for (let j = i + 1; j < text.length; j++) {
      if (text[j] !== marker) continue;
      if (/\s/.test(text[j - 1])) continue; // non-space right before the closer
      if (!isBoundary(text[j + 1])) continue; // boundary right after the closer
      if (j === i + 1) continue; // empty span (e.g. `**`) — not a span
      return { marker, open: i, innerStart: i + 1, innerEnd: j, close: j };
    }
  }
  return null;
}

function parseInto(text: string, active: Mark[], out: FormatSeg[]): void {
  if (!text) return;
  const span = findSpan(text);
  if (!span) {
    out.push({ text, marks: active });
    return;
  }
  // before the span — plain at the current mark level
  if (span.open > 0) parseInto(text.slice(0, span.open), active, out);
  const mark = MARKERS[span.marker];
  const inner = text.slice(span.innerStart, span.innerEnd);
  if (mark === "code") {
    // Literal inside — no further parsing, other markers are plain text.
    out.push({ text: inner, marks: [...active, "code"] });
  } else {
    parseInto(inner, [...active, mark], out);
  }
  // after the span — plain at the current mark level
  if (span.close + 1 < text.length) parseInto(text.slice(span.close + 1), active, out);
}

/**
 * Parse a plain-text run into formatting segments. A string with no valid markers
 * returns a single segment with empty marks (byte-identical text), so callers can
 * treat "no formatting" and "formatting" uniformly.
 */
export function parseInlineFormat(input: string): FormatSeg[] {
  const out: FormatSeg[] = [];
  parseInto(input, [], out);
  // Coalesce is unnecessary for rendering, but drop any empty runs the recursion
  // can produce at boundaries so the renderer never emits an empty node.
  return out.filter((s) => s.text.length > 0);
}

/** True if the text contains at least one run that would render with a mark. */
export function hasInlineFormat(input: string): boolean {
  return parseInlineFormat(input).some((s) => s.marks.length > 0);
}
