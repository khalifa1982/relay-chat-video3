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
 *
 * ── WHO A LINK IS FOR (v2.105.23, the last piece of #108) ──────────────────
 * An admin may restrict a link to GUESTS only or to REGISTERED accounts only.
 * `all` is the default and is what every link minted before this existed means.
 *
 * THE AUDIENCE LIVES IN THE TOKEN, NOT IN A COLUMN — the opposite of where the
 * epoch lives, and for a reason. The epoch is a property of the GROUP ("every
 * link is dead now"), so it has to sit somewhere a signature cannot reach. The
 * audience is a property of THIS LINK: an admin can reasonably have a
 * registered-only link in one place and an open one in another, both live at
 * once. A column would collapse them into a single setting AND would rewrite a
 * link already handed out — so a link minted registered-only yesterday would
 * start admitting guests because a toggle moved today, which is not what the
 * person who minted it agreed to.
 *
 * AN OPEN TOKEN IS BYTE-IDENTICAL TO THE OLD FORMAT, deliberately: `all` is still
 * four segments MAC'd over the same string, so every link minted in the last
 * seven days keeps working across the deploy that adds this. A RESTRICTED token
 * is five segments whose MAC input INCLUDES the audience, so the two shapes are
 * domain-separated — appending `.registered` to an open token, or dropping the
 * segment from a restricted one, changes the expected MAC and is refused.
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

/** Who a link admits. `all` is the default and the pre-v2.105.23 meaning. */
export type GroupInviteAudience = "all" | "guest" | "registered";

const AUDIENCES: readonly string[] = ["all", "guest", "registered"];

/**
 * Resolve an audience value, or null for anything that is not one of the three.
 *
 * FAILS TO NULL, never to `all`: a value we do not recognise must refuse rather
 * than quietly widen a link to everybody. The one place `all` is inferred is an
 * ABSENT audience, which is the four-segment token shape and is a real claim
 * ("this link was minted before audiences existed"), not an unreadable one.
 */
export function normalizeInviteAudience(v: unknown): GroupInviteAudience | null {
  return typeof v === "string" && AUDIENCES.includes(v) ? (v as GroupInviteAudience) : null;
}

function inviteMac(
  conversationId: number,
  epoch: number,
  exp: number,
  audience: GroupInviteAudience,
  key: string,
): string {
  // `all` is MAC'd over the pre-audience string, so a token minted before this
  // existed still verifies. A restricted audience gets its own domain, which is
  // what stops one shape being edited into the other.
  const base = `invite|${conversationId}|${epoch}|${exp}`;
  return crypto
    .createHmac("sha256", key)
    .update(audience === "all" ? base : `${base}|${audience}`)
    .digest("hex")
    .slice(0, 32); // 128-bit tag
}

/**
 * Does a link with this audience admit somebody of this account tier?
 *
 * Pure, so the rule can be tested without a database, and so the ONE place that
 * decides it is not buried in a procedure. The tier vocabulary is the app's own
 * three-tier one (guest / registered / admin, v2.99.6); the caller derives it.
 *
 * AN OPEN LINK DOES NOT CONSULT THE TIER AT ALL. It imposes no requirement, so
 * refusing it because a tier could not be read would break the default case for
 * everybody. A RESTRICTED link fails SHUT on an unreadable tier for the mirror
 * reason — admitting somebody who cannot be classified is the thing it exists to
 * stop.
 *
 * `registered` admits an ADMIN, because an admin holds a registered account by
 * construction. `guest` does NOT admit either of the others: guests-only was
 * asked for as guests-only, and reading it more loosely would make the setting
 * mean nothing.
 */
export function inviteAudienceAdmits(
  audience: GroupInviteAudience,
  tier: string | null | undefined,
): boolean {
  if (audience === "all") return true;
  if (audience === "registered") return tier === "registered" || tier === "admin";
  if (audience === "guest") return tier === "guest";
  return false;
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
  audience: GroupInviteAudience = "all",
  nowMs: number = Date.now(),
): string | null {
  const key = busSecret();
  if (!key) return null;
  if (!Number.isInteger(conversationId) || conversationId <= 0) return null;
  if (!Number.isInteger(epoch) || epoch < 0) return null;
  // An unrecognised audience REFUSES rather than falling back to `all`: a mint that
  // silently drops the restriction hands out a link the admin did not ask for.
  const aud = normalizeInviteAudience(audience);
  if (!aud) return null;
  const exp = nowMs + GROUP_INVITE_TTL_MS;
  const mac = inviteMac(conversationId, epoch, exp, aud, key);
  const token =
    aud === "all"
      ? `${exp}.${conversationId}.${epoch}.${mac}`
      : `${exp}.${conversationId}.${epoch}.${aud}.${mac}`;
  return token.length <= MAX_TOKEN_LEN ? token : null;
}

export interface GroupInviteClaim {
  conversationId: number;
  /** The epoch the link was minted under. The CALLER must compare this against
   *  the conversation's current epoch — this module cannot, it has no database. */
  epoch: number;
  exp: number;
  /** Who this link admits. A four-segment token has none and reads as `all`, which
   *  is the meaning every link minted before v2.105.23 was handed out under. */
  audience: GroupInviteAudience;
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
  // Four segments is an OPEN link (including every link minted before audiences
  // existed); five carries a restricted audience.
  if (parts.length !== 4 && parts.length !== 5) return null;
  const [expRaw, cidRaw, epochRaw] = parts;
  const audRaw = parts.length === 5 ? parts[3] : "all";
  const mac = parts.length === 5 ? parts[4] : parts[3];
  if (!/^\d{1,15}$/.test(expRaw)) return null;
  if (!/^\d{1,12}$/.test(cidRaw)) return null;
  if (!/^\d{1,12}$/.test(epochRaw)) return null;
  const audience = normalizeInviteAudience(audRaw);
  /* KEPT THOUGH REDUNDANT, and recorded rather than quietly removed: a mutation
   * replacing this with `?? "all"` SURVIVES, because the one-encoding guard below then
   * refuses the same token (measured, not assumed — an unknown five-segment audience
   * comes back null either way). It stays because it makes "an audience we do not
   * recognise is refused" a LOCAL statement instead of a consequence of the next guard's
   * ordering; relying on that ordering is how a later reorder would open it silently. */
  if (!audience) return null;
  // ONE ENCODING PER TOKEN. A five-segment token carrying the literal "all" is not a
  // shape this fleet mints, and since `all` is MAC'd over the four-segment string it
  // would otherwise verify — a second spelling of the same token for no benefit.
  if (parts.length === 5 && audience === "all") return null;
  const exp = Number(expRaw);
  const conversationId = Number(cidRaw);
  const epoch = Number(epochRaw);
  if (!Number.isFinite(exp) || exp <= nowMs) return null;
  if (!Number.isInteger(conversationId) || conversationId <= 0) return null;
  if (!Number.isInteger(epoch) || epoch < 0) return null;
  const expected = inviteMac(conversationId, epoch, exp, audience, key);
  if (typeof mac !== "string" || mac.length !== expected.length) return null;
  try {
    if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(mac))) return null;
  } catch {
    return null;
  }
  return { conversationId, epoch, exp, audience };
}
