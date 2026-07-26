/**
 * ADOPT-AND-RETIRE: the recovery key that lets a person reclaim a guest identity
 * their browser has forgotten (v2.99.68).
 *
 * WHY THIS EXISTS
 * ---------------
 * RELAY names a person twice: the identity ROW (referenced by numeric id, which is
 * what contacts, messages, thread membership, call history and statuses all point
 * at) and the 6-digit NUMBER (what other people store). Because twelve of the
 * thirteen linkages are id-keyed, re-attaching an identity restores everything
 * with no row rewriting — and because the number never moves, nobody who saved it
 * was ever broken.
 *
 * What was missing was a way to NAME the row after the browser forgot it. Guest
 * identity is session-scoped by explicit product decision — the device id lives in
 * `sessionStorage`, the guest cookie is a session cookie, so both halves die on
 * browser close and a fresh session mints a fresh guest. That is the intended
 * privacy behaviour and this module does not change it: automatic resolution stays
 * byte-identical. It adds a SECOND, DELIBERATE path — the person asks for their
 * number back and proves they held it.
 *
 * WHY A SEPARATE SECRET AND NOT JUST A PERSISTENT COOKIE
 * -----------------------------------------------------
 * Making the guest cookie or the device id durable would restore the identity
 * AUTOMATICALLY, which is exactly what was ruled out: on a shared browser the next
 * person would land in the previous guest's account. A key that is only ever sent
 * when the user explicitly asks to restore keeps the default behaviour intact —
 * and an explicit sign-out deletes it, so a shared browser cannot be raided.
 *
 * PROPERTIES
 *   - 32 bytes of CSPRNG (64 hex chars). Guessing is 2^256; there is no
 *     enumeration surface to rate-limit into safety, but the endpoints are gated
 *     anyway because they read the database.
 *   - Stored SERVER-SIDE AS A SHA-256 HASH, so a database dump — or any read path
 *     that leaks a row — never yields something that can claim an identity. This is
 *     the same reason `push_subscriptions.claimHash` is a hash (v2.99.49).
 *   - Compared by hash equality on an indexed column, so no timing-safe compare is
 *     needed: the attacker never learns whether a near-miss was close.
 */

import { createHash, randomBytes } from "node:crypto";

/** Exactly 64 lowercase hex characters, the shape `newRecoveryKey` produces. */
const KEY_RE = /^[a-f0-9]{64}$/;

/** Mint a fresh recovery key. Returned to the browser ONCE, never stored raw. */
export function newRecoveryKey(): string {
  return randomBytes(32).toString("hex");
}

/**
 * Hash a recovery key for storage/lookup. Plain sha256 with no salt is correct
 * here and a KDF would be wrong: the input is 256 bits of uniform randomness, so
 * there is no dictionary to stretch against, and every request has to look the row
 * up by this value — a per-row salt would make that a table scan.
 */
export function hashRecoveryKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

/**
 * Accept a recovery key from a client, or null when it is not even the right
 * shape. Fails CLOSED — a malformed value is never hashed and looked up, so a
 * caller cannot probe with junk and cannot make us do work on garbage.
 *
 * Case-folds, because the value round-trips through localStorage and hand-copying
 * during support is a real path; trims, because a pasted key routinely carries
 * whitespace.
 */
export function normalizeRecoveryKey(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  return KEY_RE.test(s) ? s : null;
}
