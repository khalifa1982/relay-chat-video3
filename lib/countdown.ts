/**
 * Pure helpers for the footer "Check" control's countdown ring.
 *
 * The ring represents the time remaining until the next automatic update check.
 * It starts full (1) right after a check and drains to empty (0) over the poll
 * window (e.g. 10 minutes). No numbers are shown — only the ring drains. When it
 * reaches 0 the app runs a check, which resets `lastCheckAt` and refills the ring.
 */

/**
 * Fraction of the poll window still REMAINING, in [0, 1].
 *
 * @param lastCheckAt  epoch ms when the most recent check started
 * @param now          current epoch ms
 * @param windowMs     length of the poll window in ms (must be > 0)
 *
 * Returns 1 immediately after a check and 0 once the window has fully elapsed.
 * Robust against clock skew / future timestamps (clamped to [0, 1]).
 */
export function remainingFraction(
  lastCheckAt: number,
  now: number,
  windowMs: number,
): number {
  if (!Number.isFinite(windowMs) || windowMs <= 0) return 0;
  const elapsed = now - lastCheckAt;
  if (!Number.isFinite(elapsed)) return 0;
  const remaining = 1 - elapsed / windowMs;
  if (remaining <= 0) return 0;
  if (remaining >= 1) return 1;
  return remaining;
}

/**
 * Convenience inverse: fraction of the window already ELAPSED, in [0, 1].
 */
export function elapsedFraction(
  lastCheckAt: number,
  now: number,
  windowMs: number,
): number {
  return 1 - remainingFraction(lastCheckAt, now, windowMs);
}
