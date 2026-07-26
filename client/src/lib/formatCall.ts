/* Pure formatters for call/conference history rows. Kept dependency-free so
 * they're cheap to unit-test in the node test env (no React / trpc imports). */

/** Human call duration: "0:45", "12:03", "1:02:33". Clamps junk to "0:00". */
export function formatDuration(secInput: number): string {
  const sec =
    !Number.isFinite(secInput) || secInput < 0 ? 0 : Math.floor(secInput);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const mm = String(m).padStart(h > 0 ? 2 : 1, "0");
  const ss = String(s).padStart(2, "0");
  // Owner spec (v2.99.77): under an hour, minutes take as many digits as they
  // need — "1:23" under ten minutes, "12:34" over. With hours, EVERY field is
  // two digits ("01:05:03"), so the columns line up down the log instead of
  // jittering between "1:05:03" and "11:05:03".
  return h > 0 ? `${String(h).padStart(2, "0")}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Friendly absolute timestamp, e.g. "Jun 27, 3:14 PM" (locale-aware). */
export function formatWhen(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** FULL date + precise time for the call log, e.g.
 *  "Jul 3, 2026, 4:12:09 PM" — year always shown, seconds included.
 *  `locale` is only passed by tests (deterministic output); the UI uses the
 *  browser default. */
export function formatFullWhen(iso: string | Date, locale?: string): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}
