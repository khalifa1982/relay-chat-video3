/* ──────────────────────────────────────────────────────────────────────────
 * #113 — a group's ADMINS become CO-HOSTS of a call started for that group.
 *
 * ── THE DIRECTION IS ONE-WAY, AND THAT IS THE WHOLE SAFETY ARGUMENT ────────
 * Group admin → call co-host. NEVER the reverse. A call host is not, and must
 * never become, a group admin, because hostship is handed out by mechanisms that
 * nobody decided:
 *
 *   - whoever DIALS creates the room and is its host, so any member could take
 *     group adminship simply by starting a call;
 *   - HOST SUCCESSION (v2.99.47) promotes the longest-standing CONNECTED member
 *     when the host leaves with no co-host, so somebody who merely stayed in the
 *     call would acquire group adminship with nobody choosing it;
 *   - `knock-approve` / `admitToRoom` can admit a link-joined stranger, and a
 *     party line is joinable by number.
 *
 * Any of those becoming a route to group adminship is the takeover class the
 * v2.104.0 review killed before it was written. So this file mints a seed and the
 * signaling layer READS it; nothing here or downstream writes a group role.
 *
 * ── WHY A SIGNED SEED RATHER THAN A LOOKUP ON THE DIAL PATH ────────────────
 * The room is created SYNCHRONOUSLY inside the invite handler. Putting a database
 * read there would add an await to the one path a call cannot afford to wait on —
 * which is exactly why `onResolveDial` carries a timeout and a settled-flag dance
 * (a wedged resolver must never strand a dial). And the client cannot be asked who
 * the admins are: that is an assertion about authority, and a client that asserts
 * its own authority is the hole closed by v2.99.43/M45 and v2.99.57/R-GENPIN.
 *
 * So membership and adminship are resolved where the database already lives — in a
 * tRPC procedure, before the dial — and the answer is handed back as a CAPABILITY
 * the fleet signed. The signaling layer verifies a signature and reads a list. No
 * await, no new failure mode, and the client asserts nothing.
 *
 * Bound to the MINTING CALLER's pin, and the signaling side takes the subject from
 * the CONNECTION rather than the message, so a leaked seed is useless to anybody
 * holding a different number.
 *
 * Same fleet-secret family as `roomCapability` and the bus. With no secret
 * configured, minting returns null and verification refuses everything — the
 * feature simply does not exist rather than existing unauthenticated.
 *
 * NOT A DISCLOSURE: the admin pins travel to the caller, who is already a member,
 * and `conversationInfo` has returned every member's number alongside `isAdmin`
 * since v2.104.0. The seed tells them nothing they could not already read.
 * ────────────────────────────────────────────────────────────────────────── */
import crypto from "crypto";
import { busSecret } from "./redisBus";

/** A call is minutes long and rooms reap after 5 idle minutes. Short on purpose:
 *  this authorizes moderation, and unlike a room capability there is no recovery
 *  case needing it to survive a browser restart. */
export const GROUP_SEED_TTL_MS = 30 * 60_000;

/** Mesh caps at 6 and the SFU at 10; a group may be larger than either, so the
 *  bound is generous rather than tight — but bounded, so a hostile value cannot
 *  make the verifier do unbounded work. */
const MAX_ADMIN_PINS = 32;
const MAX_SEED_LEN = 512;

function seedMac(
  conversationId: number,
  callerPin: string,
  exp: number,
  pins: string,
  key: string,
): string {
  return crypto
    .createHmac("sha256", key)
    .update(`${conversationId}|${callerPin}|${exp}|${pins}`)
    .digest("hex")
    .slice(0, 32); // 128-bit tag
}

/** Canonical pin list: 6-digit only, deduped, SORTED — so the same set always
 *  produces the same string and therefore the same tag. Without the sort, two
 *  equivalent sets would sign differently and a re-mint could fail to verify. */
function canonicalPins(pins: readonly string[]): string[] {
  return Array.from(new Set(pins.filter((p) => /^\d{6}$/.test(p))))
    .sort()
    .slice(0, MAX_ADMIN_PINS);
}

/**
 * Mint a seed naming the group's admin pins, for one caller.
 *
 * Returns null with no fleet secret, for a malformed caller pin, or when the
 * group has NO admins — a seed carrying an empty list would be a token that
 * authorizes nothing, and issuing one invites a reader to think it did something.
 */
export function mintGroupCallSeed(
  conversationId: number,
  callerPin: string,
  adminPins: readonly string[],
  nowMs: number = Date.now(),
): string | null {
  const key = busSecret();
  if (!key) return null;
  if (!Number.isInteger(conversationId) || conversationId <= 0) return null;
  if (!/^\d{6}$/.test(callerPin)) return null;
  const list = canonicalPins(adminPins);
  if (list.length === 0) return null;
  const exp = nowMs + GROUP_SEED_TTL_MS;
  const pins = list.join("-");
  const seed = `${exp}.${conversationId}.${pins}.${seedMac(conversationId, callerPin, exp, pins, key)}`;
  return seed.length <= MAX_SEED_LEN ? seed : null;
}

export interface GroupCallSeedClaim {
  conversationId: number;
  /** The group's admins AT MINT TIME. Inside the signature, so a client cannot
   *  add itself; a role revoked after minting outlives it by at most the TTL. */
  adminPins: string[];
  exp: number;
}

/**
 * Verify a seed against the connection's OWN pin. Returns the signed claim, or
 * null for anything expired, malformed, mis-signed, or minted for another pin.
 * Never throws — a bad seed must degrade to "no co-hosts seeded", not to an error
 * that fails a dial.
 */
export function verifyGroupCallSeed(
  seed: unknown,
  callerPin: string,
  nowMs: number = Date.now(),
): GroupCallSeedClaim | null {
  const key = busSecret();
  if (!key) return null;
  if (typeof seed !== "string" || seed.length > MAX_SEED_LEN) return null;
  if (!/^\d{6}$/.test(callerPin)) return null;
  const parts = seed.split(".");
  if (parts.length !== 4) return null;
  const [expRaw, cidRaw, pins, mac] = parts;
  if (!/^\d{1,15}$/.test(expRaw) || !/^\d{1,12}$/.test(cidRaw)) return null;
  const exp = Number(expRaw);
  const conversationId = Number(cidRaw);
  if (!Number.isFinite(exp) || exp <= nowMs) return null;
  if (!Number.isInteger(conversationId) || conversationId <= 0) return null;
  // Shape-check the list BEFORE the HMAC so a hostile string cannot make the
  // verifier hash something enormous; the length cap above bounds it anyway.
  if (!/^\d{6}(-\d{6})*$/.test(pins)) return null;
  const list = pins.split("-");
  if (list.length > MAX_ADMIN_PINS) return null;
  const expected = seedMac(conversationId, callerPin, exp, pins, key);
  if (typeof mac !== "string" || mac.length !== expected.length) return null;
  try {
    if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(mac))) return null;
  } catch {
    return null;
  }
  return { conversationId, adminPins: list, exp };
}
