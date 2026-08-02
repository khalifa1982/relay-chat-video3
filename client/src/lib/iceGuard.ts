/**
 * The blank-TURN-credential guard.
 *
 * WHY THIS EXISTS. An operator report from the coturn logs described a large
 * majority of sessions arriving with `username=<>` — no credential at all — and
 * proposed that the app was constructing an `RTCPeerConnection` before the
 * time-limited TURN credentials had been fetched. That specific mechanism does
 * not exist here (the credentials arrive on the room ack, and the pre-ack config
 * is STUN-only, so an early connection produces no coturn session rather than a
 * blank one), and the far likelier account is `iceCandidatePoolSize`: under
 * `max-bundle` the browser pre-gathers several candidate sets, uses one and
 * discards the rest — each having already opened a TURN connection it then
 * abandons before answering the 401 challenge.
 *
 * BUT THE GUARD IS WORTH HAVING REGARDLESS, and that is the whole argument for
 * this file: the proposed mechanism is one nobody can rule out for the FUTURE.
 * Any path that ever hands `buildIceConfig` a half-populated entry — a server
 * change, a new caller, a partially-parsed payload — would reintroduce it
 * silently, because a credential-less TURN entry does not throw: it is accepted,
 * gathers nothing, and the call simply has no relay path. Filtering the entry out
 * makes that outcome unreachable by construction rather than by review.
 *
 * IT DROPS THE ENTRY RATHER THAN REFUSING TO BUILD, deliberately. This runs on
 * the call path, so failing shut would mean a configuration mistake costs every
 * call outright; failing open costs only the relay leg, which is exactly what a
 * credential-less entry was going to deliver anyway. A call that might connect
 * directly beats no call.
 *
 * ONLY A POSITIVELY-IDENTIFIED TURN URL IS EVER DROPPED. A STUN entry carries no
 * credentials by design and must pass through untouched, and an entry this
 * function cannot parse is KEPT — dropping what we do not understand is the
 * direction that costs somebody a call.
 */

export interface IceServerLike {
  urls: string;
  username?: string;
  credential?: string;
}

/**
 * Does this ICE server URL require `username`/`credential` to be usable?
 *
 * `turn:` and `turns:` do; `stun:`/`stuns:` do not. An unrecognised or malformed
 * value answers FALSE, which is what keeps the caller's filter conservative — an
 * entry we cannot classify is never a candidate for removal.
 */
export function urlNeedsCredentials(url: unknown): boolean {
  if (typeof url !== "string") return false;
  const i = url.indexOf(":");
  if (i <= 0) return false;
  const scheme = url.slice(0, i).toLowerCase();
  return scheme === "turn" || scheme === "turns";
}

function present(v: unknown): boolean {
  return typeof v === "string" && v.length > 0;
}

/**
 * Split a server list into the entries a peer connection can actually use and the
 * TURN entries that arrived without credentials.
 *
 * Returns both halves rather than just the kept ones, because the DROP is the
 * finding: it should never happen, and if it does the operator needs to see which
 * URL it was.
 */
export function usableIceServers<T extends IceServerLike>(
  servers: readonly T[] | null | undefined,
): { kept: T[]; dropped: T[] } {
  const kept: T[] = [];
  const dropped: T[] = [];
  if (!servers || !servers.length) return { kept, dropped };
  for (const s of servers) {
    if (!s) continue;
    if (urlNeedsCredentials(s.urls) && !(present(s.username) && present(s.credential))) {
      dropped.push(s);
    } else {
      kept.push(s);
    }
  }
  return { kept, dropped };
}
