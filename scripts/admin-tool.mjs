#!/usr/bin/env node
/**
 * Backend administration for RELAY, run ON an app instance.
 *
 * WHY THIS EXISTS
 * ---------------
 * Owner: *"why you dont do it at the backend / Or create for me an admin panel
 * were i can change it"*. Both, and this is the backend half.
 *
 * `DATABASE_URL` exists only in /home/relay/.env on the fleet, so this is the one
 * path that reaches the live database without a human copying a production
 * credential onto a laptop. `.github/workflows/aws-ops.yml` (action `admin-tool`)
 * runs it over SSM on ONE instance.
 *
 * OPERATIONS
 *   --op grant-admin   --email <addr>                 set users.role = 'admin'
 *   --op revoke-admin  --email <addr>                 set users.role = 'user'
 *   --op set-number    --number <old> --to <new>      renumber an identity
 *   --op whois         --number <n> | --email <addr>  read-only lookup
 *
 * DRY RUN BY DEFAULT. Nothing is written unless you pass --apply.
 *
 * THE ONE THING TO UNDERSTAND BEFORE EDITING set-number
 * -----------------------------------------------------
 * A 6-digit number is stored in more than one place, and every copy that is not
 * rewritten becomes a user-visible glitch: a contact that no longer reaches anyone,
 * a dead call-back button, a presence dot stuck grey. `server/v2db.ts` owns that
 * guarantee in ONE function and declares every number-bearing column in
 * `NUMBER_BEARING_COLUMNS`, and this script is a SECOND implementation of it in a
 * different language — which is exactly the shape that rots.
 *
 * So `server/adminToolParity.test.ts` cross-checks this file against that registry:
 * it fails the build if a column declared "renumber" is not written here, or if one
 * declared "live" / "not-a-person" IS. Adding a number-bearing column therefore
 * cannot silently leave this script behind.
 *
 * PREFER THE ADMIN PANEL (/app/admin) for routine changes: it calls the real
 * single writer, so it cannot drift at all. This script exists for the case where
 * nobody holds the admin role yet — the bootstrap — and for direct backend repair.
 *
 * THIS PATH FIRES NO HOOK AND SENDS NO NOTIFICATION (v2.99.83). Stated plainly
 * because it has a user-visible consequence. The server keeps its call-routing
 * registry IN MEMORY, keyed on the 6-digit number, and `regenerateIdentityNumber`
 * now notifies it so a live registration moves with the number. This script talks
 * straight to MySQL — its only import is `mysql2/promise` — so that hook cannot
 * fire, and the person stays registered under the OLD number until their client
 * re-registers: unreachable at the number they now own, while the dialer still
 * reports them online.
 *
 * THE SELF-HEAL THAT COVERS IT — AND THE HOLE IT USED TO HAVE (v2.106.86). This
 * paragraph used to read "the whoami query refetches on focus, and the engine
 * re-registers when idle, so the window is bounded rather than permanent". The second
 * half was true and the first was the bug: an app sitting in the FOREGROUND never
 * blurs, so it never refetches — and being online is exactly the state somebody is in
 * when an operator renumbers them. The owner hit it: a user whose PIN was changed
 * while online kept calling with the old one, and the caller-ID on those calls led
 * the recipient to save the dead number as a SECOND contact for the same person.
 *
 * The presence heartbeat now returns the authoritative number on every beat, so an
 * open client notices within ~30s whatever wrote the change. That costs no extra
 * query — the identity row is already resolved for that request — and it covers any
 * future out-of-band writer for free.
 *
 * Do NOT add a signalling table for this script to write — that would be a second,
 * parallel notification mechanism for something already covered. Use the panel when
 * the server is up; the person does not need to do anything either way.
 */
import mysql from "mysql2/promise";
import crypto from "node:crypto";
import { hashLoginPin } from "./pinHash.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a, i, arr) =>
    a.startsWith("--")
      ? [[a.slice(2), arr[i + 1]?.startsWith("--") === false ? arr[i + 1] : true]]
      : [],
  ),
);
const APPLY = args.apply === true;
const OP = typeof args.op === "string" ? args.op : "";
const email = typeof args.email === "string" ? args.email.trim().toLowerCase() : "";
/** Strip ONLY spacing and grouping, never every non-digit — the same rule as
 *  `normalizeDesiredNumber`, so "7a7b7c" cannot be read as a number. */
const norm = (v) => (typeof v === "string" ? v.replace(/[\s\-.]/g, "") : "");
const number = norm(args.number);
const to = norm(args.to);
const RESERVED_PREFIXES = ["000", "111"];

const pin = typeof args.pin === "string" ? args.pin.trim() : "";
const displayName = typeof args.name === "string" ? args.name.trim() : "";
const OPS = ["grant-admin", "revoke-admin", "set-number", "whois", "create-account"];
if (!OPS.includes(OP)) {
  console.error(`usage: --op <${OPS.join("|")}> [--email <addr>] [--number <6 digits>] [--to <6 digits>] [--pin <4 digits>] [--name <display name>] [--allow-reserved] [--apply]`);
  process.exit(2);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set.");
  process.exit(2);
}

const db = await mysql.createConnection(process.env.DATABASE_URL);
const q = async (sql, params = []) => (await db.execute(sql, params))[0];
const one = async (sql, params = []) => (await q(sql, params))[0] ?? null;

/** Confirm every table/column this run names really exists, so a rename can never
 *  silently make a guard pass by reading nothing (the recover-script lesson). */
async function preflight(needed) {
  const rows = await q(
    `SELECT TABLE_NAME t, COLUMN_NAME c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()`,
  );
  const have = new Set(rows.map((r) => `${r.t}.${r.c}`));
  const missing = needed.filter((n) => !have.has(n));
  if (missing.length > 0) {
    console.error(`SCHEMA MISMATCH — not present: ${missing.join(", ")}`);
    console.error("Refusing to run: a guard that reads a column that isn't there proves nothing.");
    return false;
  }
  return true;
}

const fmt = (n) => (/^\d{6}$/.test(n) ? `${n.slice(0, 3)}-${n.slice(3)}` : n);
let exit = 0;

try {
  console.log(`OP=${OP}  MODE=${APPLY ? "APPLY" : "DRY RUN"}`);

  /* ── whois ─────────────────────────────────────────────────────────────── */
  if (OP === "whois") {
    if (!/^\d{6}$/.test(number) && !email) {
      console.error("whois needs --number <6 digits> or --email <addr>");
      exit = 2;
    } else if (!(await preflight(["identities.number", "identities.userId", "users.email", "users.role"]))) {
      exit = 3;
    } else {
      const rows = await q(
        `SELECT i.id, i.number, i.displayName, i.userId, u.email, u.role
           FROM identities i LEFT JOIN users u ON u.id = i.userId
          WHERE ${/^\d{6}$/.test(number) ? "i.number = ?" : "u.email = ?"}
          LIMIT 10`,
        [/^\d{6}$/.test(number) ? number : email],
      );
      if (rows.length === 0) console.log("no match");
      for (const r of rows) {
        console.log(
          `identity ${r.id}  ${fmt(r.number)}  ${JSON.stringify(r.displayName)}  user=${r.userId ?? "-"}  ${r.email ?? "-"}  role=${r.role ?? "-"}`,
        );
      }
    }
  }

  /* ── create-account ────────────────────────────────────────────────────────
     A registered, email-verified account with a 4-digit passcode, created WITHOUT
     an email round trip.

     WHY THIS CANNOT BE DONE THROUGH THE APP. Registration mints an OTP and mails
     it (v2.105.19 removed the bypass that used to skip that, deliberately), so an
     address that cannot receive mail — a demo or test address — can never complete
     it. That is not a gap to route around in the app: proving the address is the
     point of the flow. It is a legitimate BACKEND operation, which is what this
     script is for.

     WHAT IT DOES NOT DO, on purpose:
       - It never grants admin. Use `--op grant-admin` afterwards, as a separate,
         visible decision.
       - It refuses an address that already has an account, upholding the
         one-address-one-account invariant (v2.99.49 M50/F3). Two rows for one
         email is how a later sign-in lands on the wrong account.
       - It never prints the passcode. The person who set it already knows it, and
         this output goes to a CI log.
     ────────────────────────────────────────────────────────────────────────── */
  if (OP === "create-account") {
    if (!email || !email.includes("@")) {
      console.error("create-account needs --email <addr>");
      exit = 2;
    } else if (!/^\d{4}$/.test(pin)) {
      console.error("create-account needs --pin <exactly 4 digits> (what the app's passcode screen accepts)");
      exit = 2;
    } else if (number && !/^\d{6}$/.test(number)) {
      console.error("--number must be exactly 6 digits");
      exit = 2;
    } else if (
      !(await preflight([
        "users.id", "users.openId", "users.email", "users.loginMethod", "users.role",
        "users.emailVerified", "users.loginPinHash", "users.preferPinLogin",
        "identities.id", "identities.number", "identities.displayName",
        "identities.userId", "identities.verified",
        "number_reservations.number", "number_reservations.claimedAt",
      ]))
    ) {
      exit = 3;
    } else {
      const clash = await one(`SELECT id, email FROM users WHERE email = ? LIMIT 1`, [email]);
      if (clash) {
        console.error(`REFUSED: ${email} already has an account (user ${clash.id}).`);
        console.error("Two user rows for one address is how a later sign-in lands on the wrong one.");
        exit = 4;
      } else {
        // Pick the number. An explicit --number is honoured when free; otherwise we
        // search, skipping the prefixes the server's own allocator skips so this
        // path cannot hand out something self-service would refuse.
        const taken = async (n) =>
          !!(await one(`SELECT 1 x FROM identities WHERE number = ? LIMIT 1`, [n])) ||
          !!(await one(`SELECT 1 x FROM party_lines WHERE number = ? LIMIT 1`, [n])) ||
          !!(await one(`SELECT 1 x FROM number_reservations WHERE number = ? LIMIT 1`, [n]));
        const reservedPrefix = (n) => RESERVED_PREFIXES.some((p) => n.startsWith(p));
        let chosen = "";
        if (number) {
          if (reservedPrefix(number) && args["allow-reserved"] !== true) {
            console.error(`${fmt(number)} starts with a reserved prefix — pass --allow-reserved to use it anyway`);
            exit = 4;
          } else if (await taken(number)) {
            console.error(`${fmt(number)} is already taken`);
            exit = 4;
          } else {
            chosen = number;
          }
        } else {
          for (let i = 0; i < 40 && !chosen; i++) {
            // crypto.randomInt, not Math.random: v2.99.20 #9 replaced the weak RNG
            // in the server's allocator and a second allocator must not reintroduce it.
            const cand = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
            if (reservedPrefix(cand)) continue;
            if (!(await taken(cand))) chosen = cand;
          }
          if (!chosen) {
            console.error("could not find a free 6-digit number in 40 attempts");
            exit = 4;
          }
        }
        if (exit === 0) {
          const name = displayName || email.split("@")[0];
          console.log(`create ${email}  number=${fmt(chosen)}  name=${JSON.stringify(name)}  passcode=**** (4 digits, not printed)`);
          if (!APPLY) {
            console.log("DRY RUN — re-run with --apply to write this.");
          } else {
            // Reserve first, OUTSIDE the transaction, so a lost race costs nothing —
            // the same ordering set-number uses above.
            try {
              await q(`INSERT INTO number_reservations (number) VALUES (?)`, [chosen]);
            } catch (e) {
              if (e?.errno === 1062 || e?.code === "ER_DUP_ENTRY") {
                console.error(`${fmt(chosen)} was reserved by another allocation in flight`);
                exit = 4;
              }
              // Any other error: fall through and let the unique index decide,
              // exactly as the server's allocator fails open here.
            }
            if (exit === 0) {
              // ONE transaction: a users row with no identity is an account with no
              // number, which no screen in the app can repair.
              await db.beginTransaction();
              try {
                const openId = `local:${crypto.randomBytes(16).toString("hex")}`;
                const ins = await q(
                  `INSERT INTO users (openId, name, email, loginMethod, role, emailVerified, loginPinHash, preferPinLogin)
                   VALUES (?, ?, ?, 'otp', 'user', 1, ?, 1)`,
                  [openId, name, email, hashLoginPin(pin)],
                );
                const userId = ins.insertId;
                await q(
                  `INSERT INTO identities (number, displayName, userId, verified) VALUES (?, ?, ?, 1)`,
                  [chosen, name, userId],
                );
                await db.commit();
                await q(
                  `UPDATE number_reservations SET claimedAt = NOW() WHERE number = ? AND claimedAt IS NULL`,
                  [chosen],
                );
                console.log(`OK — user ${userId}, number ${fmt(chosen)}`);
                console.log("Sign in at /app with the email, then the 4-digit passcode.");
                console.log("This account is NOT an admin. Use --op grant-admin if that is wanted.");
              } catch (e) {
                await db.rollback();
                console.error(`FAILED, rolled back: ${e?.message || e}`);
                exit = 5;
              }
            }
          }
        }
      }
    }
  }

  /* ── grant-admin / revoke-admin ────────────────────────────────────────── */
  if (OP === "grant-admin" || OP === "revoke-admin") {
    const role = OP === "grant-admin" ? "admin" : "user";
    if (!email) {
      console.error(`${OP} needs --email <addr>`);
      exit = 2;
    } else if (!(await preflight(["users.email", "users.role"]))) {
      exit = 3;
    } else {
      // Deliberately matched on the exact address and required to be UNIQUE: the
      // schema has no unique index on users.email, and granting admin to "whichever
      // row happened to come back first" is not a thing this should ever do.
      const rows = await q(`SELECT id, email, role FROM users WHERE email = ? ORDER BY id`, [email]);
      if (rows.length === 0) {
        console.error(`no user with email ${email}`);
        exit = 4;
      } else if (rows.length > 1) {
        console.error(`AMBIGUOUS: ${rows.length} users share ${email} (ids ${rows.map((r) => r.id).join(", ")}).`);
        console.error("Refusing to guess which one you meant.");
        exit = 4;
      } else {
        const u = rows[0];
        console.log(`user ${u.id} (${u.email}) role ${u.role} -> ${role}`);
        if (u.role === role) {
          console.log("already set — nothing to do");
        } else if (!APPLY) {
          console.log("DRY RUN — re-run with --apply to write this.");
        } else {
          const res = await q(`UPDATE users SET role = ? WHERE id = ? AND role = ?`, [role, u.id, u.role]);
          // Verdict from the WRITE, not from the read above.
          if ((res?.affectedRows ?? 0) === 1) console.log("OK — role updated");
          else {
            console.error("lost a race — the role changed underneath us; re-run to see the current state");
            exit = 5;
          }
        }
      }
    }
  }

  /* ── set-number ────────────────────────────────────────────────────────── */
  if (OP === "set-number") {
    const needed = [
      "identities.id",
      "identities.number",
      "contacts.id",
      "contacts.ownerId",
      "contacts.number",
      "conference_participants.identityId",
      "conference_participants.number",
      "party_lines.number",
      "number_reservations.number",
      "number_reservations.claimedAt",
    ];
    if (!/^\d{6}$/.test(number) || !/^\d{6}$/.test(to)) {
      console.error("set-number needs --number <6 digits> and --to <6 digits>");
      exit = 2;
    } else if (RESERVED_PREFIXES.some((p) => to.startsWith(p)) && !args["allow-reserved"]) {
      /* The reservation stays the DEFAULT answer here, exactly as it is in the
         server's own `normalizeDesiredNumber`. `--allow-reserved` is the deliberate
         administrative override, and it is spelled out rather than implied because a
         CLI typo is more plausible than a mis-click: an operator who means it can say
         so in five words.

         WHAT IS NOT RELAXED: the random allocator skips 000/111 unconditionally, and
         self-service "Choose my number" still refuses them — so no ordinary signup,
         regenerate or user choice can ever produce one. Never handed out by accident,
         assignable on purpose. */
      console.error(`--to ${to} uses a reserved prefix (${RESERVED_PREFIXES.join(", ")})`);
      console.error("Pass --allow-reserved to assign it anyway (an admin-only, deliberate act).");
      exit = 2;
    } else if (!(await preflight(needed))) {
      exit = 3;
    } else {
      const ident = await one(`SELECT id, number, displayName FROM identities WHERE number = ?`, [number]);
      if (!ident) {
        console.error(`no identity holds ${fmt(number)}`);
        exit = 4;
      } else if (number === to) {
        console.log("already that number — nothing to do");
      } else {
        // Free in BOTH tables sharing the one number space.
        const clashI = await one(`SELECT id FROM identities WHERE number = ?`, [to]);
        const clashP = await one(`SELECT id FROM party_lines WHERE number = ?`, [to]);
        if (clashI || clashP) {
          console.error(`${fmt(to)} is already in use (${clashI ? "an identity" : "a party line"})`);
          exit = 4;
        } else {
          const affected = await q(`SELECT id, ownerId, number FROM contacts WHERE number IN (?, ?)`, [number, to]);
          // planRenumber, reproduced: rewrite every row holding the OLD number, and
          // drop a stale row the same owner already has for the NEW one, which would
          // otherwise collide with the unique (ownerId, number) key.
          const newRowByOwner = new Map();
          for (const r of affected) if (r.number === to) newRowByOwner.set(r.ownerId, r.id);
          const updateIds = [];
          const deleteIds = [];
          for (const r of affected) {
            if (r.number !== number) continue;
            updateIds.push(r.id);
            const dup = newRowByOwner.get(r.ownerId);
            if (dup !== undefined) deleteIds.push(dup);
          }
          console.log(
            `identity ${ident.id} ${JSON.stringify(ident.displayName)}: ${fmt(number)} -> ${fmt(to)}`,
          );
          console.log(`contacts: ${updateIds.length} rewritten, ${deleteIds.length} stale duplicate(s) removed`);
          if (!APPLY) {
            console.log("DRY RUN — re-run with --apply to write this.");
          } else {
            // Reserve first, OUTSIDE the transaction, so a lost race costs nothing.
            try {
              await q(`INSERT INTO number_reservations (number) VALUES (?)`, [to]);
            } catch (e) {
              if (e?.errno === 1062 || e?.code === "ER_DUP_ENTRY") {
                console.error(`${fmt(to)} is reserved by another allocation in flight`);
                exit = 4;
              }
              // Any other error: fall through and let the unique index be the
              // authority, exactly as the server's allocator fails open here.
            }
            if (exit === 0) {
              await db.beginTransaction();
              try {
                await q(`UPDATE identities SET number = ? WHERE id = ? AND number = ?`, [to, ident.id, number]);
                if (deleteIds.length > 0) {
                  await q(
                    `DELETE FROM contacts WHERE id IN (${deleteIds.map(() => "?").join(",")})`,
                    deleteIds,
                  );
                }
                if (updateIds.length > 0) {
                  await q(
                    `UPDATE contacts SET number = ? WHERE id IN (${updateIds.map(() => "?").join(",")})`,
                    [to, ...updateIds],
                  );
                }
                await q(
                  `UPDATE conference_participants SET number = ? WHERE identityId = ? AND number = ?`,
                  [to, ident.id, number],
                );
                await db.commit();
                // The old number's reservation stays forever on purpose: it WAS
                // handed out, and recycling it would let somebody who kept it
                // written down later reach a stranger.
                await q(
                  `UPDATE number_reservations SET claimedAt = NOW() WHERE number = ? AND claimedAt IS NULL`,
                  [to],
                );
                console.log("OK — renumbered and propagated");
                // v2.99.83: say the quiet part. This path cannot notify the server,
                // so the operator needs to know the person is not INSTANTLY reachable
                // at the new number.
                //
                // v2.106.86 — and the window is now bounded, which it was not. The
                // old note said "until their client re-registers (reopening the app is
                // immediate)", and that was the whole defect: a client only re-registers
                // when `whoami` changes, `whoami` only refetched on window FOCUS, and an
                // app sitting in the foreground never blurs. A user who was online when
                // his number changed therefore kept calling with the OLD pin
                // indefinitely — reported by the owner, on a real renumber.
                // The presence heartbeat now carries the authoritative number, so any
                // open client converges within one beat with nothing for anyone to do.
                console.log(
                  "NOTE: no notification was sent — this identity stays registered " +
                    "on " + number + " in the signaling layer until their client " +
                    "picks up the change, which the presence heartbeat does within " +
                    "~30s while the app is open (reopening it is immediate)."
                );
              } catch (e) {
                await db.rollback();
                console.error(`FAILED, rolled back: ${e?.message || e}`);
                exit = 5;
              }
            }
          }
        }
      }
    }
  }
} catch (e) {
  console.error(`ERROR: ${e?.message || e}`);
  exit = 1;
} finally {
  await db.end().catch(() => {});
}

process.exit(exit);
