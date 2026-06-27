import { Fragment, type ReactNode } from "react";

// Matches http(s):// URLs and bare www. links; trailing punctuation is excluded.
const URL_RE = /((?:https?:\/\/|www\.)[^\s<]+[^\s<.,!?)\]}"'])/gi;

/**
 * Turn URLs in a plain-text string into clickable links. Returns React nodes,
 * so the non-link text is still escaped by React (no XSS). Only http(s)/www
 * schemes are linked — never javascript:/data:.
 */
export function linkify(text: string | null | undefined): ReactNode {
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
    return <Fragment key={i}>{part}</Fragment>;
  });
}
