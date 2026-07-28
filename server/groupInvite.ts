/* ──────────────────────────────────────────────────────────────────────────
 * #114 — a group INVITE LINK, stateless.
 *
 * ── WHY STATELESS, AND WHAT REPLACES THE TABLE ─────────────────────────────
 * The obvious design is an `invites` table: a row per link, deleted to revoke.
 * That buys nothing here and costs a read on the join path plus a reaper for
 * rows nobody ever used. Instead the token CARRIES what it asserts and the
 * fleet signs it, exactly like `roomCapability` and `groupCallSeed`.
 *
 * Revocation is the one thing a signature cannot express on its own, so it gets
 * ONE integer: `conversations.inviteEpoch`. A token names the epoch it was minted
 * under and the join refuses a token whose epoch is not the CURRENT one, so
 * bumping the counter invalidates every outstanding link in a single write —
 * which is what "revoke the link" has to mean, since an admin cannot know how
 * many copies of it exist or where they went.
 *
 * ── DELIBERATELY NOT BOUND TO A PIN ────────────────────────────────────────
 * `groupCallSeed` is bound to the minting caller's number, because a seed hands
 * out MODERATION and a leaked one must be useless to anybody else. An invite is
 * the opposite by construction: it is a link, its whole purpose is to be handed
 * to somebody the minter has not enumerated, and a pin-bound invite would be a
 * one-person invite with extra steps. So this is a BEARER token, and it is
 * bounded by the two things that make that safe to ship: it EXPIRES, and the
 * epoch lets an admin kill every copy at once.
 *
 * Whoever redeems it becomes a MEMBER and nothing more. That composition was
 * examined when group roles were designed (v2.104.0) and is why there is no
 * "members are admins when the group has none" fallback: a link-joined stranger
 * gains `MEMBER_CAPABILITIES` and no route to adminship. v2.105.7's co-host
 * seeding is additive-only and grants nothing to a pin its signed list does not
 * name, so a link join cannot reach call moderation either.
 *
 * ── MINTING IS ADMIN-ONLY ──────────────────────────────────────────────────
 * `invite-link` is a GroupCapability and is NOT in `MEMBER_CAPABILITIES`, so it
 * is admin-only by the default that set exists to make obvious. Handing every
 * member the power to admit strangers is a decision, not something that should
 * arrive because a new capability was added in the wrong place.
 *
 * With no fleet secret, minting returns null and verification refuses
 * everything — the feature does not exist rather than existing unauthenticated.
 * ────────────────────────────────────────────────────────────────────────── */
import crypto from "crypto";
import { busSecret } from "./redisBus";

/**
 * Long enough that a link shared in a message is still good tomorrow, short
 * enough that a link pasted into a public channel and forgotten stops working.
 * The epoch is the immediate lever; this is the backstop for the link nobody
 * remembers to revoke.
 */
export const GROUP_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const MAX_TOKEN_LEN = 256;

function inviteMac(
  conversationId: number,
  epoch: number,
  exp: number,
  key: string,
): string {
  return crypto
    .createHmac("sha256", key)
    .update(`invite|${conversationId}|${epoch}|${exp}`)
    .digest("hex")
    .slice(0, 32); // 128-bit tag
}

/**
 * Mint an invite token for one group at one epoch.
 *
 * Returns null with no fleet secret, or for a nonsensical conversation id or
 * epoch — never a token that cannot be verified, because a link that silently
 * fails to work is worse than an admin being told the feature is unavailable.
 */
export function mintGroupInvite(
  conversationId: number,
  epoch: number,
  nowMs: number = Date.now(),
): string | null {
  const key = busSecret();
  if (!key) return null;
  if (!Number.isInteger(conversationId) || conversationId <= 0) return null;
  if (!Number.isInteger(epoch) || epoch < 0) return null;
  const exp = nowMs + GROUP_INVITE_TTL_MS;
  const token = `${exp}.${conversationId}.${epoch}.${inviteMac(conversationId, epoch, exp, key)}`;
  return token.length <= MAX_TOKEN_LEN ? token : null;
}

export interface GroupInviteClaim {
  conversationId: number;
  /** The epoch the link was minted under. The CALLER must compare this against
   *  the conversation's current epoch — this module cannot, it has no database. */
  epoch: number;
  exp: number;
}

/**
 * Verify an invite token's signature and expiry. Returns the signed claim, or
 * null for anything expired, malformed or mis-signed. Never throws.
 *
 * A valid signature is NOT permission to join: the epoch still has to match and
 * the group still has to exist. Those are the caller's checks, deliberately, so
 * that this file needs no database and can be tested without one.
 */
export function verifyGroupInvite(
  token: unknown,
  nowMs: number = Date.now(),
): GroupInviteClaim | null {
  const key = busSecret();
  if (!key) return null;
  if (typeof token !== "string" || token.length > MAX_TOKEN_LEN) return null;
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [expRaw, cidRaw, epochRaw, mac] = parts;
  if (!/^\d{1,15}$/.test(expRaw)) return null;
  if (!/^\d{1,12}$/.test(cidRaw)) return null;
  if (!/^\d{1,12}$/.test(epochRaw)) return null;
  const exp = Number(expRaw);
  const conversationId = Number(cidRaw);
  const epoch = Number(epochRaw);
  if (!Number.isFinite(exp) || exp <= nowMs) return null;
  if (!Number.isInteger(conversationId) || conversationId <= 0) return null;
  if (!Number.isInteger(epoch) || epoch < 0) return null;
  const expected = inviteMac(conversationId, epoch, exp, key);
  if (typeof mac !== "string" || mac.length !== expected.length) return null;
  try {
    if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(mac))) return null;
  } catch {
    return null;
  }
  return { conversationId, epoch, exp };
}
