/* ============================================================
   v2.99.76 — ADMIN PANEL + BACKEND TOOL.

   Owner: "why you dont do it at the backend / Or create for me an admin panel
   were i can change it."

   Both. The panel calls the real single writer, so it cannot drift. The BACKEND
   script cannot call it — `scripts/admin-tool.mjs` is plain `.mjs` run by bare
   `node` on an EC2 instance, while the renumber lives in TypeScript inside the
   server bundle — so its `set-number` is a SECOND implementation of the propagation
   rule in a different language.

   That is the exact shape that rots (v2.99.50: two gates disagreeing about one
   rule; v2.99.71: the TURN checker disagreeing with the server about what is
   advertised). No string check catches the NEXT divergence, so this file
   cross-checks the script against `NUMBER_BEARING_COLUMNS` itself: a column
   declared "renumber" MUST be written by the script, and one declared "live" or
   "not-a-person" must NOT be.
   ============================================================ */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { NUMBER_BEARING_COLUMNS } from "./v2db";

const read = (...p: string[]) => fs.readFileSync(path.resolve(__dirname, ...p), "utf8");
const TOOL = read("..", "scripts", "admin-tool.mjs");
const ROUTERS = read("v2routers.ts");
const V2DB = read("v2db.ts");
const ADMIN_UI = read("..", "client", "src", "pages", "app", "Admin.tsx");
const APP = read("..", "client", "src", "App.tsx");
const WORKFLOW = read("..", ".github", "workflows", "aws-ops.yml");

/** Strip comment lines before asserting a token is ABSENT — a comment explaining
 *  why a pattern is gone must not be what makes the assertion pass. */
const codeOnly = (src: string) =>
  src
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*|\/\*|#)/.test(l))
    .join("\n");

/** The script's set-number block only — the rest of the file must not count. */
const setNumberBlock = TOOL.slice(
  TOOL.indexOf('if (OP === "set-number")'),
  TOOL.indexOf("} catch (e) {\n  console.error(`ERROR:")
);

describe("the backend tool agrees with the server about what a renumber touches", () => {
  it("covers exactly the columns declared 'renumber' — no more, no less", () => {
    // The whole point of the file. A new number-bearing column in the schema fails
    // `numberContinuity.test.ts` until it gets a strategy, and then fails HERE until
    // the script learns about it.
    const SQL_TABLE: Record<string, RegExp> = {
      contacts: /UPDATE contacts SET number =/,
      conference_participants: /UPDATE conference_participants SET number =/,
      conference_history: /UPDATE conference_history SET/,
      party_lines: /UPDATE party_lines SET/,
    };
    for (const c of NUMBER_BEARING_COLUMNS) {
      if (c.table === "identities") continue; // the identity's own move, asserted below
      const re = SQL_TABLE[c.table];
      expect(re, `${c.table} has no parity rule in this test — add one`).toBeTruthy();
      const written = re.test(setNumberBlock);
      if (c.strategy === "renumber") {
        expect(written, `${c.table} is declared 'renumber' and the script MUST rewrite it`).toBe(true);
      } else {
        expect(
          written,
          `${c.table} is declared '${c.strategy}' and the script must NOT rewrite it`
        ).toBe(false);
      }
    }
  });

  it("moves the identity itself, guarded on the number it read", () => {
    // `AND number = ?` makes a concurrent change LOSE rather than corrupt.
    expect(setNumberBlock).toMatch(
      /UPDATE identities SET number = \? WHERE id = \? AND number = \?/
    );
  });

  it("reproduces planRenumber's collision rule, not just the simple update", () => {
    // Without the stale-duplicate delete, a saver who already had a row for the NEW
    // number collides with the unique (ownerId, number) key and the whole renumber
    // fails — for that one contact's sake.
    expect(setNumberBlock).toMatch(/newRowByOwner/);
    expect(setNumberBlock).toMatch(/DELETE FROM contacts WHERE id IN/);
    expect(setNumberBlock).toMatch(/if \(r\.number !== number\) continue;/);
    // And the server's own planner still exists to be the reference.
    expect(V2DB).toMatch(/export function planRenumber\(/);
  });

  it("checks BOTH tables of the shared number space before writing", () => {
    expect(setNumberBlock).toMatch(/SELECT id FROM identities WHERE number = \?/);
    expect(setNumberBlock).toMatch(/SELECT id FROM party_lines WHERE number = \?/);
  });

  it("reserves in the shared ledger, and treats a duplicate as taken", () => {
    expect(setNumberBlock).toMatch(/INSERT INTO number_reservations \(number\) VALUES \(\?\)/);
    expect(setNumberBlock).toMatch(/errno === 1062 \|\| e\?\.code === "ER_DUP_ENTRY"/);
    expect(setNumberBlock).toMatch(/UPDATE number_reservations SET claimedAt = NOW\(\)/);
  });

  it("NEVER releases the old number's reservation", () => {
    // Monotonic on purpose: recycling would let somebody who kept the old number
    // written down later reach a stranger.
    expect(codeOnly(TOOL)).not.toMatch(/DELETE FROM number_reservations/);
  });

  it("writes inside a transaction and rolls back as a unit", () => {
    expect(setNumberBlock).toMatch(/await db\.beginTransaction\(\);/);
    expect(setNumberBlock).toMatch(/await db\.commit\(\);/);
    expect(setNumberBlock).toMatch(/await db\.rollback\(\);/);
    expect(setNumberBlock.indexOf("beginTransaction")).toBeLessThan(
      setNumberBlock.indexOf("UPDATE identities SET number")
    );
  });

  it("honours the same reserved prefixes and the same normalization rule", () => {
    expect(TOOL).toMatch(/const RESERVED_PREFIXES = \["000", "111"\];/);
    expect(V2DB).toMatch(/const RESERVED_PREFIXES = \["000", "111"\]/);
    // Strips ONLY spacing and grouping, so "7a7b7c" is refused rather than read as
    // a number — the same reasoning as normalizeDesiredNumber.
    expect(TOOL).toMatch(/replace\(\/\[\\s\\-\.\]\/g, ""\)/);
    expect(codeOnly(TOOL)).not.toMatch(/replace\(\/\\D\/g, ""\)/);
  });

  it("is DRY RUN by default, on every writing operation", () => {
    expect(TOOL).toMatch(/const APPLY = args\.apply === true;/);
    // Each write is gated, and the gate is on APPLY rather than on its absence.
    expect((TOOL.match(/if \(!APPLY\) \{/g) || []).length).toBeGreaterThanOrEqual(2);
    expect(TOOL).toMatch(/DRY RUN — re-run with --apply/);
  });

  it("preflights every table and column it names", () => {
    // A guard that reads a column which no longer exists proves nothing — the bug
    // the recover script shipped with in its first draft.
    expect(TOOL).toMatch(/information_schema\.COLUMNS/);
    expect(TOOL).toMatch(/SCHEMA MISMATCH/);
    for (const col of [
      "contacts.ownerId",
      "conference_participants.identityId",
      "number_reservations.claimedAt",
      "party_lines.number",
    ]) {
      expect(TOOL, `${col} must be preflighted`).toMatch(
        new RegExp(`"${col.replace(".", "\\.")}"`)
      );
    }
  });

  it("refuses an ambiguous email rather than guessing which account", () => {
    // users.email carries NO unique index, so "the first row" is not an answer when
    // the operation is granting administrator.
    //
    // Pins the CONDITION, not just the message. A first cut asserted only the
    // wording, and a mutation that changed `rows.length > 1` to `false` — i.e. that
    // silently made it guess — left the test green because the unreachable message
    // was still in the file.
    expect(TOOL).toMatch(/\} else if \(rows\.length > 1\) \{/);
    expect(TOOL).toMatch(/AMBIGUOUS: \$\{rows\.length\} users share/);
    expect(TOOL).toMatch(/Refusing to guess which one you meant\./);
    // …and the refusal must come BEFORE anything reads rows[0].
    expect(TOOL.indexOf("rows.length > 1")).toBeLessThan(TOOL.indexOf("const u = rows[0];"));
  });

  it("takes its verdict from the WRITE, not from the earlier read", () => {
    expect(TOOL).toMatch(/\(res\?\.affectedRows \?\? 0\) === 1/);
  });
});

describe("the admin API is gated on the ROW, never on the client's claim", () => {
  const router = ROUTERS.slice(ROUTERS.indexOf("async function requireAdmin("), ROUTERS.length);

  it("re-derives admin status server-side for every procedure", () => {
    expect(router).toMatch(/if \(!\(await isUserAdmin\(userId\)\)\) \{/);
    expect(V2DB).toMatch(/export async function isUserAdmin\(/);
    // Each mutating/reading procedure must go through it — not just the page.
    const find = router.slice(router.indexOf("findIdentities:"), router.indexOf("setIdentityNumber:"));
    const setN = router.slice(router.indexOf("setIdentityNumber:"));
    expect(find).toMatch(/await requireAdmin\(ctx\)/);
    expect(setN).toMatch(/await requireAdmin\(ctx\)/);
  });

  it("isUserAdmin FAILS CLOSED", () => {
    const fn = V2DB.slice(
      V2DB.indexOf("export async function isUserAdmin("),
      V2DB.indexOf("/** One row of the admin panel")
    );
    expect(fn).toMatch(/if \(typeof userId !== "number" \|\| !Number\.isFinite\(userId\)\) return false;/);
    expect(fn).toMatch(/if \(!db\) return false;/);
    expect(fn).toMatch(/catch \{\s*\n\s*return false;/);
    expect(fn).toMatch(/rows\[0\]\?\.role === "admin"/);
  });

  it("refuses uniformly, so it is not an oracle for who holds the role", () => {
    expect(router).toMatch(/code: "FORBIDDEN", message: "Administrators only\."/);
  });

  it("the number change routes through the ONE writer", () => {
    // An admin shortcut writing the column directly would skip every propagation
    // the self-service path gets, silently.
    const setN = router.slice(router.indexOf("setIdentityNumber:"));
    expect(setN).toMatch(/await claimIdentityNumber\(input\.identityId, input\.number\)/);
    expect(codeOnly(setN)).not.toMatch(/\.update\(identities\)/);
    // Still exactly one writer in the whole of v2db.
    expect([...V2DB.matchAll(/\.update\(identities\)\s*\n?\s*\.set\(\{ number:/g)].length).toBe(1);
  });

  it("an admin acting on somebody else is traced, with ids and no content", () => {
    const setN = router.slice(router.indexOf("setIdentityNumber:"));
    expect(setN).toMatch(/console\.warn\(/);
    expect(setN).toMatch(/renumbered \$\{res\.oldNumber\} -> \$\{res\.newNumber\} by identity \$\{me\.id\}/);
  });

  it("the search is rate limited and bounded", () => {
    const find = router.slice(router.indexOf("findIdentities:"), router.indexOf("setIdentityNumber:"));
    expect(find).toMatch(/directoryGate\(ctx\)/);
    expect(find).toMatch(/adminFindIdentities\(input\.query \?\? "", 25\)/);
  });

  it("the panel's read surface withholds everything it does not need", () => {
    const fn = V2DB.slice(
      V2DB.indexOf("export async function adminFindIdentities("),
      V2DB.indexOf("/** Three-tier account badge")
    );
    // No credential hashes, no guest tokens, no recovery hashes, no device ids —
    // an admin panel is a permanent read surface and the smallest one wins.
    for (const forbidden of [
      "passwordHash",
      "loginPinHash",
      "guestToken",
      "recoveryHash",
      "deviceId",
    ]) {
      expect(codeOnly(fn), `${forbidden} must not be selected`).not.toMatch(
        new RegExp(forbidden)
      );
    }
    // …and it escapes LIKE wildcards, so a typed % matches a literal %.
    expect(fn).toMatch(/replace\(\/\[%_\\\\\]\/g/);
  });
});

describe("the panel is reachable, and invisible to everyone else", () => {
  it("is routed and lazily loaded like every other tab", () => {
    expect(APP).toMatch(/const Admin = lazy\(\(\) => import\("\.\/pages\/app\/Admin"\)\);/);
    expect(APP).toMatch(/<Route path=\{"\/app\/admin"\}>\{\(\) => <ShellRoute tab="admin" \/>\}<\/Route>/);
  });

  it("renders a refusal rather than a blank page for a non-admin", () => {
    expect(ADMIN_UI).toMatch(/if \(!amIAdmin\.data\?\.admin\) \{/);
    expect(ADMIN_UI).toMatch(/Administrators only/);
  });

  it("asks the SERVER whether this account is an admin", () => {
    // Not the cached whoami: a stale payload must neither hide the panel from an
    // admin nor advertise it to somebody who would only get FORBIDDEN.
    expect(ADMIN_UI).toMatch(/trpc\.admin\.amIAdmin\.useQuery/);
    // v2.99.89 rewrote this to the PROPERTY rather than the shape. It used to pin
    // `function AdminLinkSection()` and that section's own `return null` — i.e. one
    // particular implementation — so folding the entry into the Profile hub's row
    // list broke it while the property it exists to protect was untouched. What
    // matters is that the entry is gated on a SERVER answer and never on the cached
    // whoami role, which has been through the browser and is a rendering hint.
    const PROFILE = read("..", "client", "src", "pages", "app", "Profile.tsx");
    expect(PROFILE).toMatch(/trpc\.admin\.amIAdmin\.useQuery/);
    expect(PROFILE).toMatch(/\{amIAdmin\.data\?\.admin && \(/);
    // Never `me.role === "admin"`: a stale payload must neither hide the entry from
    // an admin nor advertise it to somebody who would only get FORBIDDEN.
    expect(PROFILE).not.toMatch(/me\.role === "admin"/);
  });
});

describe("the ops action that runs it", () => {
  const step = WORKFLOW.slice(WORKFLOW.indexOf("admin-tool —"), WORKFLOW.length);

  it("is offered as an action and gated on it", () => {
    expect(WORKFLOW).toMatch(/admin-tool/);
    expect(step).toMatch(/if: inputs\.action == 'admin-tool'/);
  });

  it("free-text inputs are base64'd on the runner and decoded on the instance", () => {
    // Every one of these lands inside a command string executed on production EC2
    // via SSM. This file has been bitten by exactly that twice.
    //
    // ASSERTED AGAINST THE CMDLINE ITSELF, not against the whole step. A first cut
    // only checked that `ADM_EMAIL_B64` appeared somewhere — which it still did,
    // as a now-unused assignment, when a mutation put the RAW value back into the
    // command. Merely encoding a variable is worthless if the command uses the
    // other one.
    const cmdline = step.slice(step.indexOf("CMDLINE="), step.indexOf("PARAMS=$(jq"));
    expect(cmdline).toBeTruthy();
    for (const v of ["ADM_EMAIL", "ADM_NUM", "ADM_TO"]) {
      expect(cmdline, `${v} must reach the command only via base64 -d`).toMatch(
        new RegExp(`echo \\$${v}_B64 \\| base64 -d`)
      );
      // The raw variable must NOT be interpolated: `$ADM_EMAIL"` with no `_B64`.
      expect(cmdline, `${v} must not be interpolated raw`).not.toMatch(
        new RegExp(`\\$${v}(?!_B64)`)
      );
    }
    expect(step).toMatch(/base64 -w0/);
  });

  it("admin_op is a closed choice AND re-validated in the step", () => {
    // It is the one value interpolated without encoding, so it must not be
    // free text: GitHub restricts a `choice`, and the step whitelists it again.
    const opInput = WORKFLOW.slice(WORKFLOW.indexOf("      admin_op:"), WORKFLOW.indexOf("      admin_email:"));
    expect(opInput).toMatch(/type: choice/);
    expect(opInput).toMatch(/options: \[whois, grant-admin, revoke-admin, set-number\]/);
    expect(step).toMatch(/whois\|grant-admin\|revoke-admin\|set-number\) : ;;/);
    expect(step).toMatch(/unknown admin_op/);
  });

  it("defaults to a dry run and gates --apply behind its own input", () => {
    expect(step).toMatch(/FLAG=" --apply"/);
    expect(step).toMatch(/if \[ "\$ADM_APPLY" = "true" \]/);
    expect(WORKFLOW).toMatch(/admin_apply/);
    expect(WORKFLOW).toMatch(/default: false/);
  });

  it("runs on exactly ONE instance", () => {
    expect(step).toMatch(/--max-concurrency 1 --max-errors 0/);
  });

  it("takes its verdict from the script's printed marker, not the SSM status", () => {
    // A wrapper or pipeline can mask a non-zero exit (the v2.99.46 bug), so the
    // step must READ the marker rather than trusting SSM's own success.
    //
    // Asserting `/ADMIN_EXIT=/` alone was not enough: the marker also appears
    // inside the CMDLINE that PRINTS it, so replacing the check with `if true`
    // left the assertion green while the step could no longer fail.
    expect(step).toMatch(/if echo "\$OUT" \| grep -q "ADMIN_EXIT=0"; then/);
    expect(step).toMatch(/did not report ADMIN_EXIT=0/);
    // …and the failure branch must actually fail the step.
    const branch = step.slice(step.indexOf('grep -q "ADMIN_EXIT=0"'));
    expect(branch).toMatch(/exit 1/);
  });

  it("ships in the release tar, so the instance actually has it", () => {
    // scripts/ is already shipped for turn-check + recover; this asserts the rule
    // still holds, because a tool the box does not have is not a tool.
    const deploy = read("..", ".github", "workflows", "deploy.yml");
    expect(deploy).toMatch(/scripts/);
  });
});
