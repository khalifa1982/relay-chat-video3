/**
 * The 4-digit login-passcode hash, for `scripts/admin-tool.mjs`.
 *
 * WHY THIS IS ITS OWN FILE. `admin-tool.mjs` opens a MySQL connection at module scope
 * and runs top-level await, so importing it from a test would try to reach a database
 * — the same reason v2.106.28 split `record.mjs` out of `agent.mjs`. This module has
 * NO side effects and no imports beyond `node:crypto`, so a test can import it and
 * check the one thing that matters.
 *
 * WHAT MATTERS. This is a SECOND implementation of a credential hash: the real one is
 * `hashPassword` in `server/authCrypto.ts`, which is TypeScript inside the server
 * bundle, and this is plain `.mjs` run by bare node on an EC2 instance. That is
 * exactly the shape this repo has watched rot before (v2.99.71's turn-check, and the
 * set-number renumber rule in the file that imports this). If the two disagree the
 * account is created and its passcode simply never works — a failure with no error
 * anywhere, on a sign-in screen.
 *
 * So `server/adminToolCreate.test.ts` does not compare strings: it feeds this
 * function's output to the REAL `verifyPassword` and requires it to verify, and
 * requires a wrong passcode to fail. Parity is then a property of the actual
 * verifier rather than of two constants that look alike.
 *
 * The format is self-describing (`scrypt$N$salt$hash`), which is what makes that
 * possible: the verifier reads its parameters out of the string, so only the SCHEME
 * name and the derivation have to agree.
 */
import crypto from "node:crypto";

// Mirrors server/authCrypto.ts. The test proves the pairing, not these numbers.
const SCHEME = "scrypt";
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEYLEN = 64;
const SALT_BYTES = 16;

/** Hash a login passcode into the server's `scrypt$N$salt$hash` form. */
export function hashLoginPin(pin) {
  const salt = crypto.randomBytes(SALT_BYTES).toString("hex");
  const derived = crypto
    .scryptSync(String(pin), salt, KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P })
    .toString("hex");
  return `${SCHEME}$${SCRYPT_N}$${salt}$${derived}`;
}
