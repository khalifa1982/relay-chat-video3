import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { hashLoginPin } from "../scripts/pinHash.mjs";
import { verifyPassword, hashPassword } from "./authCrypto";

/**
 * v2.106.48 — `admin-tool --op create-account`, and the parity that makes it usable.
 *
 * WHY THE OPERATION EXISTS. Registration mints an OTP and mails it — v2.105.19
 * removed the bypass that skipped that, deliberately, because proving the address
 * IS the flow. So an address that cannot receive mail (a demo or test account) can
 * never complete it through the app. That is a legitimate BACKEND operation, not a
 * gap to route around in the product.
 *
 * WHY THE PARITY TEST IS THE LOAD-BEARING PART. The passcode hash now has TWO
 * implementations: the real `hashPassword` in `server/authCrypto.ts` (TypeScript, in
 * the server bundle) and `scripts/pinHash.mjs` (plain .mjs, run by bare node on an
 * EC2 instance, because `admin-tool.mjs` cannot import the bundle). This repo has
 * watched that exact shape rot before — v2.99.71's turn-check disagreed with
 * `iceServers()` and would have reported two live relays permanently down.
 *
 * If these two disagree the failure is silent and cruel: the account is created,
 * the operator is told OK, and the passcode simply never works on the sign-in
 * screen with nothing anywhere saying why. So this does NOT compare constants or
 * strings — it feeds the script's output to the REAL verifier.
 */
const TOOL = fs.readFileSync(path.resolve(__dirname, "../scripts/admin-tool.mjs"), "utf8");
const HASHER = fs.readFileSync(path.resolve(__dirname, "../scripts/pinHash.mjs"), "utf8");
const code = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

describe("the script's passcode hash is accepted by the REAL verifier", () => {
  it("a hash minted by the script verifies against server/authCrypto.ts", () => {
    // THE property. Not "the constants match" — that the actual verifier accepts it.
    const stored = hashLoginPin("1122");
    expect(verifyPassword("1122", stored)).toBe(true);
  });

  it("a WRONG passcode is refused against that same hash", () => {
    // Without this the test above would pass for a verifier that accepts anything.
    const stored = hashLoginPin("1122");
    for (const wrong of ["1123", "2211", "0000", "112", "11223", "", "1122 "]) {
      expect(verifyPassword(wrong, stored), `must refuse ${JSON.stringify(wrong)}`).toBe(false);
    }
  });

  it("it round-trips in BOTH directions, so neither side is the odd one out", () => {
    // The real hasher's output and the script's are the same dialect: each verifies
    // under the shared verifier, and neither is a special case.
    expect(verifyPassword("4321", hashPassword("4321"))).toBe(true);
    expect(verifyPassword("4321", hashLoginPin("4321"))).toBe(true);
    // Distinct salts per call, or two accounts with one passcode share a hash.
    expect(hashLoginPin("1122")).not.toBe(hashLoginPin("1122"));
  });

  it("the format is SELF-DESCRIBING, which is what lets the verifier read its own parameters", () => {
    const parts = hashLoginPin("1122").split("$");
    expect(parts.length).toBe(4);
    expect(parts[0]).toBe("scrypt");
    expect(Number(parts[1])).toBeGreaterThanOrEqual(16384);
    expect(parts[2]).toMatch(/^[0-9a-f]{32}$/); // 16-byte salt
    expect(parts[3]).toMatch(/^[0-9a-f]{128}$/); // 64-byte key
  });

  it("the hasher module is importable and side-effect free", () => {
    // If it opened a DB connection or ran top-level await, this test could not
    // exist — which is the whole reason it is not inside admin-tool.mjs
    // (the record.mjs / agent.mjs split, v2.106.28).
    const c = code(HASHER);
    expect(c).not.toMatch(/mysql/);
    expect(c).not.toMatch(/process\.exit/);
    expect(c).not.toMatch(/process\.env/);
    expect(c).not.toMatch(/^\s*await /m);
    expect(c).toMatch(/^import crypto from "node:crypto";$/m);
  });
});

describe("create-account is safe by construction", () => {
  it("it is dry-run by default, like every other write in this tool", () => {
    expect(code(TOOL)).toMatch(/const APPLY = args\.apply === true;/);
    // The op's own write path is gated on it.
    const at = TOOL.indexOf('if (OP === "create-account")');
    expect(at).toBeGreaterThan(0);
    const op = TOOL.slice(at, TOOL.indexOf("/* ── grant-admin", at));
    expect(op).toMatch(/if \(!APPLY\) \{\s*console\.log\("DRY RUN/);
  });

  it("it REFUSES an address that already has an account", () => {
    const at = TOOL.indexOf('if (OP === "create-account")');
    const op = TOOL.slice(at, TOOL.indexOf("/* ── grant-admin", at));
    // One address, one account (v2.99.49 M50/F3): a second row is how a later
    // sign-in lands on the wrong one.
    expect(op).toMatch(/SELECT id, email FROM users WHERE email = \?/);
    expect(op).toMatch(/REFUSED: \$\{email\} already has an account/);
  });

  it("it never grants admin, and says so", () => {
    const at = TOOL.indexOf('if (OP === "create-account")');
    const op = TOOL.slice(at, TOOL.indexOf("/* ── grant-admin", at));
    // Granting admin is a separate, visible decision (`--op grant-admin`).
    expect(op).not.toMatch(/'admin'/);
    // The role written is 'user', in the VALUES clause of the users insert. Asserted
    // on the VALUES list itself: a `role[^)]*'user'` span cannot reach across the
    // closing paren of the column list, which is what made my first attempt wrong.
    expect(op).toMatch(/VALUES \(\?, \?, \?, 'otp', 'user', 1, \?, 1\)/);
    expect(op).toMatch(/NOT an admin/);
  });

  it("it never prints the passcode", () => {
    const at = TOOL.indexOf('if (OP === "create-account")');
    const op = TOOL.slice(at, TOOL.indexOf("/* ── grant-admin", at));
    // This output goes to a CI log, and the person who set it already knows it.
    const logs = op.match(/console\.(log|error)\([^\n]*/g) || [];
    for (const l of logs) {
      expect(l, `must not interpolate the passcode: ${l}`).not.toMatch(/\$\{pin\}/);
      expect(l).not.toMatch(/\bpin\b\s*\)/);
    }
    expect(op).toMatch(/not printed/);
  });

  it("the user row and the identity row are written in ONE transaction", () => {
    const at = TOOL.indexOf('if (OP === "create-account")');
    const op = TOOL.slice(at, TOOL.indexOf("/* ── grant-admin", at));
    // A users row with no identity is an account with no number, which no screen
    // in the app can repair.
    const begin = op.indexOf("beginTransaction()");
    const insUser = op.indexOf("INSERT INTO users");
    const insIdent = op.indexOf("INSERT INTO identities");
    const commit = op.indexOf("db.commit()");
    expect(begin).toBeGreaterThan(0);
    expect(begin).toBeLessThan(insUser);
    expect(insUser).toBeLessThan(insIdent);
    expect(insIdent).toBeLessThan(commit);
    expect(op).toMatch(/await db\.rollback\(\);/);
  });

  it("the number is reserved in the shared ledger and then claimed", () => {
    const at = TOOL.indexOf('if (OP === "create-account")');
    const op = TOOL.slice(at, TOOL.indexOf("/* ── grant-admin", at));
    // v2.102.0: identities and party_lines share ONE number space and no unique
    // index spans both, so the ledger is what makes the allocation safe. Without
    // the claimedAt stamp the reaper (whose predicate is `claimedAt IS NULL`)
    // could later recycle a number this account is using.
    expect(op).toMatch(/INSERT INTO number_reservations \(number\) VALUES \(\?\)/);
    expect(op).toMatch(/UPDATE number_reservations SET claimedAt = NOW\(\) WHERE number = \? AND claimedAt IS NULL/);
    // …and freeness is checked against BOTH tables plus the ledger.
    expect(op).toMatch(/FROM identities WHERE number = \?/);
    expect(op).toMatch(/FROM party_lines WHERE number = \?/);
    expect(op).toMatch(/FROM number_reservations WHERE number = \?/);
  });

  it("it uses a CSPRNG for the number, not Math.random", () => {
    const at = TOOL.indexOf('if (OP === "create-account")');
    const op = TOOL.slice(at, TOOL.indexOf("/* ── grant-admin", at));
    // v2.99.20 #9 replaced the weak RNG in the server's allocator; a second
    // allocator must not reintroduce it.
    expect(op).toMatch(/crypto\.randomInt\(0, 1_000_000\)/);
    expect(code(TOOL)).not.toMatch(/Math\.random/);
  });

  it("it honours the reserved prefixes unless explicitly overridden", () => {
    const at = TOOL.indexOf('if (OP === "create-account")');
    const op = TOOL.slice(at, TOOL.indexOf("/* ── grant-admin", at));
    // Same rule as self-service (v2.105.8): never handed out by accident,
    // assignable on purpose.
    expect(op).toMatch(/reservedPrefix\(cand\)\) continue;/);
    expect(op).toMatch(/args\["allow-reserved"\] !== true/);
    expect(TOOL).toMatch(/const RESERVED_PREFIXES = \["000", "111"\];/);
  });

  it("the passcode must be exactly 4 digits — what the app's screen accepts", () => {
    const at = TOOL.indexOf('if (OP === "create-account")');
    const op = TOOL.slice(at, TOOL.indexOf("/* ── grant-admin", at));
    expect(op).toMatch(/\/\^\\d\{4\}\$\/\.test\(pin\)/);
  });

  it("it preflights every column it names, so a rename cannot make it pass vacuously", () => {
    const at = TOOL.indexOf('if (OP === "create-account")');
    const op = TOOL.slice(at, TOOL.indexOf("/* ── grant-admin", at));
    expect(op).toMatch(/await preflight\(\[/);
    for (const col of [
      "users.openId", "users.email", "users.emailVerified", "users.loginPinHash",
      "identities.number", "identities.userId", "identities.verified",
      "number_reservations.claimedAt",
    ]) {
      expect(op, `preflight must name ${col}`).toContain(`"${col}"`);
    }
  });

  it("the account it creates is a REGISTERED one — verified, with the passcode live", () => {
    const at = TOOL.indexOf('if (OP === "create-account")');
    const op = TOOL.slice(at, TOOL.indexOf("/* ── grant-admin", at));
    // emailVerified is what makes the email-code path usable later, and
    // identities.verified is what the Registered badge reads (v2.99.6).
    expect(op).toMatch(/INSERT INTO users \(openId, name, email, loginMethod, role, emailVerified, loginPinHash, preferPinLogin\)/);
    expect(op).toMatch(/VALUES \(\?, \?, \?, 'otp', 'user', 1, \?, 1\)/);
    expect(op).toMatch(/INSERT INTO identities \(number, displayName, userId, verified\) VALUES \(\?, \?, \?, 1\)/);
    // openId is notNull + unique, so it needs a synthetic value.
    expect(op).toMatch(/local:\$\{crypto\.randomBytes\(16\)\.toString\("hex"\)\}/);
  });
});
