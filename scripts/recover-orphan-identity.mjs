#!/usr/bin/env node
/**
 * Recover an ORPHANED guest identity onto a registered account.
 *
 * WHY THIS EXISTS
 * ---------------
 * Before v2.99.49, registering as a guest could mint a BRAND-NEW identity
 * instead of upgrading the one the browser was already using: `ensureUserIdentity`
 * looked the guest up by cookie token only, while `createContext` resolves by
 * cookie OR device id and treats the device id as authoritative. Any browser whose
 * live identity was device-resolved therefore fell through to the allocate branch.
 * The old row keeps the number, contacts, messages and call history; it is simply
 * left behind with `userId` still NULL, unreachable from the account.
 *
 * v2.99.49 stopped this happening to anyone new. It does NOT retroactively repair
 * a row already orphaned — that is what this script is for. (The owner's 601-586
 * is the known case.)
 *
 * SAFETY
 * ------
 * DRY RUN BY DEFAULT. Nothing is written unless you pass --apply.
 *
 * Refuses unless every one of these holds:
 *   1. the orphan identity exists and has `userId IS NULL` (never steal a row
 *      that already belongs to an account);
 *   2. the target user exists;
 *   3. the account's CURRENT identity — the one this replaces — is EMPTY:
 *      no messages sent, no contacts, no conversations, no call/conference
 *      history, no statuses, no party lines. If it has ANY data the script
 *      stops, because completing would destroy it. There is deliberately no
 *      override flag.
 *
 * The write runs in ONE transaction, in this order (which the unique index on
 * identities.userId forces): delete the empty current identity, then adopt the
 * orphan. Re-running after success is a no-op — the orphan is no longer
 * unclaimed, so guard 1 stops it.
 *
 * USAGE
 *   node scripts/recover-orphan-identity.mjs --number 601586 --email you@example.com
 *   node scripts/recover-orphan-identity.mjs --number 601586 --email you@example.com --apply
 *
 * DATABASE_URL must be set (on an app instance it already is, via /home/relay/.env).
 */
import mysql from "mysql2/promise";

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a, i, arr) =>
    a.startsWith("--") ? [[a.slice(2), arr[i + 1]?.startsWith("--") === false ? arr[i + 1] : true]] : [],
  ),
);
const APPLY = args.apply === true;
const number = String(args.number || "").replace(/\D/g, "");
const email = typeof args.email === "string" ? args.email.trim().toLowerCase() : "";

if (!/^\d{6}$/.test(number) || !email) {
  console.error("usage: --number <6 digits> --email <account email> [--apply]");
  process.exit(2);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set.");
  process.exit(2);
}

const db = await mysql.createConnection(process.env.DATABASE_URL);
const q = async (sql, params = []) => (await db.execute(sql, params))[0];
const one = async (sql, params = []) => (await q(sql, params))[0] ?? null;
const count = async (sql, params = []) => Number((await one(sql, params))?.n ?? 0);

/**
 * PREFLIGHT: confirm every (table, column) this script names actually exists,
 * before a single row is read or written. The emptiness check below is what
 * stands between a recovery and destroying data, so it must not be possible for
 * it to under-count because a column was renamed — a typo'd name would otherwise
 * surface as a mid-run error at best, and this way it is a clear refusal up
 * front. (Two of these names were wrong on the first draft: contacts uses
 * `ownerId`, and call_history splits into caller/callee columns.)
 */
async function preflight() {
  const NEEDED = [
    ["identities", ["id", "number", "displayName", "userId", "guestToken", "guestExpiresAt", "deviceId"]],
    ["users", ["id", "email"]],
    ["messages", ["senderIdentityId"]],
    ["conversation_participants", ["identityId"]],
    ["contacts", ["ownerId"]],
    ["call_history", ["callerIdentityId", "calleeIdentityId"]],
    ["conference_participants", ["identityId"]],
    ["statuses", ["identityId"]],
    ["party_lines", ["ownerIdentityId"]],
  ];
  const missing = [];
  for (const [table, cols] of NEEDED) {
    const rows = await q(
      "SELECT COLUMN_NAME c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?",
      [table],
    );
    const have = new Set(rows.map((r) => r.c));
    if (have.size === 0) { missing.push(`table ${table}`); continue; }
    for (const c of cols) if (!have.has(c)) missing.push(`${table}.${c}`);
  }
  if (missing.length) {
    throw new Error(
      `schema mismatch — this script names things that do not exist: ${missing.join(", ")}. ` +
      `Refusing rather than risking an under-counted emptiness check.`,
    );
  }
}

/** Everything that hangs off an identity id, so "is it empty" is not a guess. */
async function dataFootprint(id) {
  const f = {
    messagesSent: await count("SELECT COUNT(*) n FROM messages WHERE senderIdentityId=?", [id]),
    conversations: await count("SELECT COUNT(*) n FROM conversation_participants WHERE identityId=?", [id]),
    contactsOwned: await count("SELECT COUNT(*) n FROM contacts WHERE ownerId=?", [id]),
    callHistory: await count(
      "SELECT COUNT(*) n FROM call_history WHERE callerIdentityId=? OR calleeIdentityId=?",
      [id, id],
    ),
    conferences: await count("SELECT COUNT(*) n FROM conference_participants WHERE identityId=?", [id]),
    statuses: await count("SELECT COUNT(*) n FROM statuses WHERE identityId=?", [id]),
    partyLines: await count("SELECT COUNT(*) n FROM party_lines WHERE ownerIdentityId=?", [id]),
  };
  f.total = Object.values(f).reduce((a, b) => a + b, 0);
  return f;
}

try {
  await preflight();
  const orphan = await one(
    "SELECT id, number, displayName, userId, guestToken, deviceId FROM identities WHERE number=?",
    [number],
  );
  const user = await one("SELECT id, email FROM users WHERE LOWER(email)=? ORDER BY id LIMIT 1", [email]);

  console.log("── inputs ─────────────────────────────────────────────");
  console.log("  orphan identity :", orphan ? `#${orphan.id} ${orphan.number} "${orphan.displayName}" userId=${orphan.userId ?? "NULL"}` : "NOT FOUND");
  console.log("  account         :", user ? `#${user.id} ${user.email}` : "NOT FOUND");

  if (!orphan) throw new Error(`no identity has number ${number}`);
  if (!user) throw new Error(`no user with email ${email}`);
  if (orphan.userId !== null) {
    throw new Error(
      `identity ${number} is already claimed by user #${orphan.userId} — refusing. ` +
      (orphan.userId === user.id ? "(It is ALREADY this account's — nothing to do.)" : "(It belongs to someone else.)"),
    );
  }

  const current = await one(
    "SELECT id, number, displayName FROM identities WHERE userId=? ORDER BY id LIMIT 1",
    [user.id],
  );
  const orphanData = await dataFootprint(orphan.id);
  const currentData = current ? await dataFootprint(current.id) : null;

  console.log("\n── what would move ───────────────────────────────────");
  console.log(`  KEEP  #${orphan.id} (${orphan.number}) →`, JSON.stringify(orphanData));
  console.log(current
    ? `  DROP  #${current.id} (${current.number}) → ${JSON.stringify(currentData)}`
    : "  DROP  (none — the account has no identity yet)");

  if (current && currentData.total > 0) {
    throw new Error(
      `the account's current identity #${current.id} (${current.number}) is NOT empty ` +
      `(${currentData.total} rows). Completing would destroy that data, so this stops here. ` +
      `Merging two non-empty identities is a different job and needs a considered migration.`,
    );
  }

  if (!APPLY) {
    console.log("\nDRY RUN — nothing written. Re-run with --apply to perform it.");
    process.exit(0);
  }

  await db.beginTransaction();
  try {
    // Order is forced by the unique index on identities.userId: the account can
    // hold only one identity, so the empty one must go before the orphan is
    // adopted. Both statements are re-checked in their WHERE clauses so a
    // concurrent change loses rather than corrupts.
    if (current) {
      const del = await q("DELETE FROM identities WHERE id=? AND userId=?", [current.id, user.id]);
      if (del.affectedRows !== 1) throw new Error("current identity changed under us — rolled back");
    }
    const upd = await q(
      "UPDATE identities SET userId=?, guestToken=NULL, guestExpiresAt=NULL WHERE id=? AND userId IS NULL",
      [user.id, orphan.id],
    );
    if (upd.affectedRows !== 1) throw new Error("orphan was claimed under us — rolled back");
    await db.commit();
    console.log(`\nDONE — ${orphan.number} now belongs to ${user.email}. Sign out and back in on the device.`);
  } catch (e) {
    await db.rollback();
    throw e;
  }
} catch (e) {
  console.error("\nREFUSED:", e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
} finally {
  await db.end();
}
