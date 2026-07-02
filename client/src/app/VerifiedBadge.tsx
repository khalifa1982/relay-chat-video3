import { BadgeCheck } from "lucide-react";

/**
 * The "blue badge" shown next to a fully-verified (email-verified) user's name
 * everywhere their identity appears — contact lists, message threads, the
 * dashboard header, dialer preview, history roster, etc. A single component so
 * the mark is pixel-identical across the app. Render it ONLY when the relevant
 * `verified` flag (from whoami / directory / contacts / threads) is true.
 */
export function VerifiedBadge({
  className = "",
  size = 14,
  title = "Verified account",
}: {
  className?: string;
  size?: number;
  title?: string;
}) {
  return (
    <span
      title={title}
      aria-label="Verified"
      role="img"
      className={"inline-flex shrink-0 items-center text-[#2f7bff] dark:text-[#4c9bff] " + className}
    >
      <BadgeCheck width={size} height={size} aria-hidden="true" />
    </span>
  );
}
