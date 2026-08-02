/**
 * Pure helpers for the web-content version watcher, kept separate from the
 * React component so they can be unit-tested without a DOM / native runtime.
 */

/**
 * Extract the deployed app version.
 *
 * `explicit` is the value of an anchor the WEB APP owns (`[data-relay-version]`
 * or `#relay-version`). When present it is authoritative.
 *
 * `text` is the fallback: the first `vN.N.N` anywhere in `document.body
 * .innerText`. That is USER CONTENT — a message, a status or a contact name
 * containing "v1.2.3" is read as the deployed version and flips the watcher into
 * a "RELAY was updated, reload" prompt, which interrupts and can be made to
 * repeat.
 *
 * The fallback is deliberately KEPT rather than tightened: the live footer renders
 * the version inline ("© 2026 RELAY · v2.51.0 · …"), so requiring a standalone
 * match would break real detection today in exchange for closing a nuisance. The
 * anchor is the actual fix, and it removes the ambiguity entirely the moment the
 * web app emits one — at which point the fallback stops being consulted.
 */
export function extractVersion(
  text: string | null | undefined,
  explicit?: string | null,
): string | null {
  const anchored = (explicit ?? "").trim();
  if (/^v?\d+\.\d+\.\d+$/.test(anchored)) {
    return anchored.startsWith("v") ? anchored : "v" + anchored;
  }
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
