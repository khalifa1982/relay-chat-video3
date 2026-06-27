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
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
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
