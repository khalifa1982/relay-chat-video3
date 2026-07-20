/**
 * v2.92 (R4B): ZERO hardcoded deployment domains in client/src (owner
 * requirement — the same bundle serves the Manus deploy and the AWS self-host).
 * Marketing/legal pages that want to NAME the site derive it from the host the
 * page is actually being served on.
 */

/** The serving hostname without a leading "www." (e.g. "example.org"). */
export function siteHost(): string {
  if (typeof window === "undefined" || !window.location?.hostname) return "relay";
  return window.location.hostname.replace(/^www\./, "");
}

/** A contact address on the serving host (e.g. "hello@example.org"). */
export function siteEmail(local: string): string {
  return `${local}@${siteHost()}`;
}
