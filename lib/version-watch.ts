/**
 * Pure helpers for the web-content version watcher, kept separate from the
 * React component so they can be unit-tested without a DOM / native runtime.
 */

/** Extract a semantic version like "v2.51.0" from arbitrary page text. */
export function extractVersion(text: string | null | undefined): string | null {
  if (!text) return null;
  const match = text.match(/v\d+\.\d+\.\d+/);
  return match ? match[0] : null;
}

/**
 * Decide how to react when a new version string arrives.
 * - `previous === null` means this is the first version seen this session:
 *   record it, do NOT prompt.
 * - A different non-null version means the web app was redeployed while open:
 *   record it and prompt the user to reload.
 * - The same version is a no-op.
 */
export function reconcileVersion(
  previous: string | null,
  incoming: string | null,
): { next: string | null; shouldPromptReload: boolean } {
  if (!incoming) return { next: previous, shouldPromptReload: false };
  if (previous === null) return { next: incoming, shouldPromptReload: false };
  if (previous !== incoming)
    return { next: incoming, shouldPromptReload: true };
  return { next: previous, shouldPromptReload: false };
}
