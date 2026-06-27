/* Pure version-comparison helper for the auto-update checker. Kept dependency-free
 * (no React/DOM imports) so it can be unit-tested in the node environment. */

/** True iff `server` is a strictly-higher semver than `baked`. We act ONLY on a
 *  strictly-newer server — never on mere inequality. During a multi-instance
 *  rollout the static bundle and /api/version can briefly come from different
 *  revisions, so a tab already on the NEW bundle can poll an OLD instance; a
 *  plain `!==` would make it reload pointlessly (and repeatedly mid-call). A
 *  rollback (server older than the loaded bundle) also returns false, so we never
 *  flap downward. Non-numeric / missing segments are treated as 0. */
export function isNewer(server: string, baked: string): boolean {
  const a = String(server).split(".");
  const b = String(baked).split(".");
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = parseInt(a[i] ?? "0", 10) || 0;
    const y = parseInt(b[i] ?? "0", 10) || 0;
    if (x !== y) return x > y;
  }
  return false;
}
