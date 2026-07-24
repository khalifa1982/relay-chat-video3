/**
 * One-click email unsubscribe (v2.99.40).
 *
 * The offline-message nudge is the only mail RELAY sends that the recipient
 * didn't ask for — someone else's message triggers it. So it carries a
 * `List-Unsubscribe` header (what Gmail/Outlook turn into their own
 * unsubscribe button, and what bulk-sender rules require) plus a visible
 * footer link, and BOTH must work with no sign-in: a person who wants the mail
 * to stop should never have to remember a password to stop it.
 *
 * The token is therefore a capability, not a session: `<userId>.<hmac>`, signed
 * with the same server secret family as the inbound-email reply addresses. It
 * grants exactly one thing — turning message-notification email OFF for that
 * user. It cannot turn anything on, cannot read anything, and cannot touch any
 * other setting, so a leaked link (a forwarded email, a proxy log) costs the
 * user at most one silenced notification channel they can re-enable in Profile.
 *
 * Deliberately NOT expiring: mail lives in inboxes for years, and an
 * unsubscribe link that has quietly gone stale is exactly the failure that gets
 * a sender reported as spam.
 */
import crypto from "crypto";
import { appBaseUrl } from "./appUrl";

/** Signing key. Reuses the inbound-email secret family, falling back to
 *  JWT_SECRET, so no new env var is needed to deploy this. */
function unsubSecret(): string {
  return process.env.INBOUND_EMAIL_SECRET || process.env.JWT_SECRET || "";
}

function mac(userId: number, secret: string): string {
  return crypto
    .createHmac("sha256", secret)
    .update(`unsub:${userId}`)
    .digest("base64url")
    .slice(0, 32);
}

/** Mint a token for `userId`, or null when no secret is configured (in which
 *  case callers must omit the unsubscribe affordance rather than emit a link
 *  that would reject everyone). */
export function unsubscribeToken(userId: number): string | null {
  const secret = unsubSecret();
  if (!secret) return null;
  return `${userId}.${mac(userId, secret)}`;
}

/** Verify a token and return the userId it authorizes, or null. Constant-time
 *  comparison, and a missing secret verifies NOTHING (fails closed). */
export function verifyUnsubscribeToken(token: string): number | null {
  const secret = unsubSecret();
  if (!secret) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const userId = Number(token.slice(0, dot));
  const sig = token.slice(dot + 1);
  if (!Number.isInteger(userId) || userId <= 0) return null;
  const expected = mac(userId, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  if (!crypto.timingSafeEqual(a, b)) return null;
  return userId;
}

/** Absolute unsubscribe URL, or null when the token or the base URL is missing
 *  (a relative href is dead in a mail client, and a Host-derived one is
 *  spoofable — the same rule the email buttons already follow). */
export function unsubscribeLink(userId: number): string | null {
  const token = unsubscribeToken(userId);
  if (!token) return null;
  const base = appBaseUrl();
  if (!base) return null;
  return `${base}/api/email/unsubscribe?t=${encodeURIComponent(token)}`;
}

/**
 * `List-Unsubscribe` (+ `List-Unsubscribe-Post`) headers, or `undefined` when
 * no link can be minted. The Post header opts into RFC 8058 one-click: the mail
 * client POSTs the URL itself, so the user never leaves their inbox.
 */
export function unsubscribeHeaders(userId: number): Record<string, string> | undefined {
  const url = unsubscribeLink(userId);
  if (!url) return undefined;
  return {
    "List-Unsubscribe": `<${url}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}
