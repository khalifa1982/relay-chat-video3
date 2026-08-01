/**
 * v2.105.16 — ADD AND REMOVE GROUP MEMBERS BY HAND, PLUS "ALL USERS CAN ADD" (#108).
 *
 * THE ONE HAZARD WORTH NAMING UP FRONT is the per-group widening. `MEMBER_CAPABILITIES`
 * is a MODULE-LEVEL Set, so the tempting implementation — add `add-member` to it when the
 * group allows it — would grant the capability in EVERY group for the life of the
 * process. That is a cross-request authority leak, not a feature, and it would be
 * invisible in any single-group test. The widening is therefore a per-call comparison
 * against the conversation's own column, and a test below forbids mutating the set.
 *
 * THE SECOND is that adding somebody to a group is a way to put messages in front of
 * them, so it must not become a route around a block they placed (v2.98.6/E2 closed
 * exactly that for `openThread` and `createGroup`).
 *
 * THE THIRD is that this is the SECOND route by which somebody becomes a member after a
 * group exists. The first is an invite link (v2.105.9), and the two must not disagree
 * about the history watermark — so they share one writer.
 */

import { describe, it, expect } from "vitest";
import { copyOnScreen } from "./testing/copyOnScreen";
import fs from "fs";
import path from "path";
import { codeOnly } from "./testing/codeOnly";

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");

const V2DB = read("server/v2db.ts");
const V2DB_CODE = codeOnly(V2DB);
const ROUTERS = read("server/v2routers.ts");
const SCHEMA = read("drizzle/schema.ts");
const SHEET = read("client/src/app/GroupInfoSheet.tsx");

/**
 * A named top-level function's body, brace-matched and asserted non-empty.
 *
 * `minLen` is a parameter rather than a constant because one function here is a
 * legitimately tiny alias (`joinGroupByInvite` delegates in one line), and a fixed floor
 * of 60 failed on it — a test bug, not a defect. The floor still exists so a locator that
 * silently matched the wrong brace cannot pass by reading nothing.
 */
function fnBody(src: string, name: string, minLen = 60): string {
  const m = new RegExp(`export (?:async )?function ${name}\\b`).exec(src);
  expect(m, `${name} should be declared`).toBeTruthy();
  let i = m!.index;
  let par = 0;
  let ang = 0;
  let brace = 0;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === "(") par++;
    else if (c === ")") par--;
    else if (c === "<") ang++;
    else if (c === ">") ang--;
    else if (c === "{") {
      if (par === 0 && ang <= 0 && brace === 0) break;
      brace++;
    } else if (c === "}") brace--;
  }
  const start = i;
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) break;
    }
  }
  const body = src.slice(start, i + 1);
  expect(body.length, `${name}'s body should not be empty`).toBeGreaterThan(minLen);
  return body;
}

/** A tRPC procedure's body, bounded by the NEXT procedure so it cannot run long. */
function procBody(src: string, name: string): string {
  const at = src.indexOf(`  ${name}: publicProcedure`);
  expect(at, `${name} should be a procedure`).toBeGreaterThan(-1);
  const rest = src.slice(at + 4);
  const next = rest.search(/\n  [A-Za-z][A-Za-z0-9]*: (?:public|protected)Procedure/);
  const body = next === -1 ? rest : rest.slice(0, next);
  expect(body.length, `${name}'s slice should not be empty`).toBeGreaterThan(150);
  // ONE procedure, asserted by counting declarations rather than by a character bound —
  // an arbitrary length cap goes stale on any legitimate addition.
  expect((body.match(/: publicProcedure/g) || []).length).toBe(1);
  return body;
}

describe("the per-group widening never touches the process-global set", () => {
  it("MEMBER_CAPABILITIES is never mutated at runtime", () => {
    // THE LOAD-BEARING ASSERTION. It is a module-level Set: adding to it for one group
    // grants the capability in every group for the life of the process, and no
    // single-group test would show it.
    expect(V2DB_CODE).not.toMatch(/MEMBER_CAPABILITIES\.add\(/);
    expect(V2DB_CODE).not.toMatch(/MEMBER_CAPABILITIES\.delete\(/);
    expect(V2DB_CODE).not.toMatch(/MEMBER_CAPABILITIES\.clear\(/);
    // It is declared `const` and read only via `.has`.
    expect(V2DB_CODE).toMatch(/const MEMBER_CAPABILITIES = new Set<GroupCapability>\(/);
    expect((V2DB_CODE.match(/MEMBER_CAPABILITIES\./g) || []).length).toBe(1);
    expect(V2DB_CODE).toMatch(/MEMBER_CAPABILITIES\.has\(capability\)/);
  });

  it("add-member is NOT in the static member set — the group's own column decides", () => {
    const decl = V2DB_CODE.slice(
      V2DB_CODE.indexOf("const MEMBER_CAPABILITIES"),
      V2DB_CODE.indexOf("const MEMBER_CAPABILITIES") + 220,
    );
    expect(decl).not.toMatch(/add-member/);
    expect(decl).not.toMatch(/remove-member/);
  });

  it("only an EXPLICIT true widens it, so NULL keeps meaning admin-only", () => {
    // Every pre-release group carries NULL and must keep behaving as it does today, so a
    // falsy read is the safe direction.
    const gate = fnBody(V2DB, "checkGroupPermission");
    expect(gate).toMatch(/capability === "add-member" && convo\.membersCanAdd === true/);
    // The widening sits AFTER the static member check and BEFORE the admin refusal —
    // if it came after the refusal it could never be reached by a non-admin, which is
    // the only caller it exists for.
    const widen = gate.indexOf('capability === "add-member"');
    expect(widen).toBeGreaterThan(gate.indexOf("MEMBER_CAPABILITIES.has(capability)"));
    expect(widen).toBeLessThan(gate.indexOf('reason: "not-an-admin"'));
  });

  it("remove-member has NO widening anywhere — admin-only unconditionally", () => {
    // "All users can add" says add, and it is taken literally: one member able to eject
    // another is a different, larger power nobody asked for.
    const gate = codeOnly(fnBody(V2DB, "checkGroupPermission"));
    expect(gate).not.toMatch(/remove-member/);
    // And the toggle is CONSULTED for exactly one capability. Counted on `convo.` so the
    // SELECT projection that reads the column is not mistaken for a second decision —
    // counting the bare name read 3 (projection key, projection value, comparison) and
    // failed for a reason unrelated to the property.
    expect((gate.match(/convo\.membersCanAdd/g) || []).length).toBe(1);
  });
});

describe("one writer for becoming a member after the group exists", () => {
  it("the participant insert-with-watermark exists in exactly one place", () => {
    expect((V2DB.match(/joinedAtMessageId: newest\?\.id \?\? null/g) || []).length).toBe(1);
    expect(V2DB_CODE).toMatch(/export async function admitGroupMember\(/);
  });

  it("the invite route delegates to it rather than inserting its own row", () => {
    // A one-line alias, so the floor is lowered deliberately rather than the assertion
    // being dropped: what matters is that it delegates and inserts nothing itself.
    const fn = fnBody(V2DB, "joinGroupByInvite", 20);
    expect(fn).toMatch(/return admitGroupMember\(input\)/);
    expect(fn).not.toMatch(/\.insert\(/);
  });

  it("the add-by-hand route delegates to it too", () => {
    expect(codeOnly(procBody(ROUTERS, "addGroupMember"))).toMatch(/await admitGroupMember\(\{/);
  });

  it("an already-member add is a SUCCESS, not an error", () => {
    // A double-tap or a retry after a dropped response must be harmless, and "they are in
    // the group" is exactly what the caller asked for.
    const fn = fnBody(V2DB, "admitGroupMember");
    const guard = fn.indexOf("if (existing) return { ok: true, joined: false }");
    expect(guard).toBeGreaterThan(-1);
    // …and the watermark is only ever stamped on a row being CREATED, so re-adding
    // somebody cannot delete their history from their own view.
    expect(guard).toBeLessThan(fn.indexOf("joinedAtMessageId:"));
  });
});

describe("adding is not a route around a block", () => {
  const ADD = procBody(ROUTERS, "addGroupMember");
  const ADD_CODE = codeOnly(ADD);

  it("a blocked adder is refused", () => {
    expect(ADD_CODE).toMatch(/isNumberBlockedBy\(target\.id, me\.number\)/);
  });

  it("the block and 'no such number' answer IDENTICALLY", () => {
    // Two messages would tell somebody they had been blocked, which is exactly what a
    // block should not announce. One TRPCError object is reused for both, so they cannot
    // drift apart.
    expect(ADD_CODE).toMatch(/const notFound = new TRPCError\(\{/);
    expect((ADD_CODE.match(/throw notFound;/g) || []).length).toBe(2);
  });

  it("the block check runs BEFORE anybody is admitted", () => {
    expect(ADD_CODE.indexOf("isNumberBlockedBy")).toBeLessThan(
      ADD_CODE.indexOf("admitGroupMember("),
    );
  });

  it("the capability gate precedes the number lookup, and is rate-limited", () => {
    expect(ADD_CODE).toMatch(/checkGroupPermission\(input\.conversationId, me\.id, "add-member"\)/);
    expect(ADD_CODE).toMatch(/directoryGate\(ctx\)/);
    expect(ADD_CODE.indexOf("checkGroupPermission")).toBeLessThan(
      ADD_CODE.indexOf("getIdentityByNumber"),
    );
  });

  it("the number is shape-checked rather than digit-stripped into something else", () => {
    // `\D`-stripping would read "7a7b7c7d7e7f" as 777777 and add a stranger (the
    // v2.99.75 normalizeDesiredNumber reasoning).
    expect(ADD_CODE).toMatch(/\/\^\\d\{6\}\$\/\.test\(digits\)/);
    expect(ADD_CODE).toMatch(/replace\(\/\[\\s\\-\.\]\/g, ""\)/);
  });
});

describe("removals that are wrong whoever asks", () => {
  const FN = fnBody(V2DB, "removeGroupMember");
  const FN_CODE = codeOnly(FN);

  it("the creator cannot be removed", () => {
    // Their adminship is DERIVED from having made the group, so removing them strips it
    // with no route back — and in a group whose only admin is the derived creator it
    // leaves the group permanently adminless, the state v2.104.0 chose not to add a
    // fallback for.
    expect(FN_CODE).toMatch(
      /convo\.ownerIdentityId != null && convo\.ownerIdentityId === input\.identityId/,
    );
    expect(FN_CODE).toMatch(/reason: "is-creator"/);
  });

  it("nobody removes themselves — that is leaving, and leaving does not exist yet", () => {
    expect(FN_CODE).toMatch(
      /if \(input\.identityId === input\.actingIdentityId\) return \{ ok: false, reason: "self" \}/,
    );
    // Refused FIRST, before any read: it needs no database to know.
    expect(FN_CODE.indexOf('reason: "self"')).toBeLessThan(FN_CODE.indexOf("getDb()"));
  });

  it("both are enforced in the WRITER, not at the call site", () => {
    // So no future caller can forget them.
    const proc = codeOnly(procBody(ROUTERS, "removeGroupMember"));
    expect(proc).not.toMatch(/ownerIdentityId/);
    expect(proc).toMatch(/actingIdentityId: me\.id/);
  });

  it("removing is ADMIN-ONLY, gated before the write", () => {
    // ADDED after a mutation SURVIVED: replacing the gate with a literal `{ok: true}`
    // changed nothing any assertion could see, because the tests above only checked WHERE
    // the creator/self rules live and never that authority was checked at all. The
    // admin-only property of removal was completely unasserted.
    const proc = codeOnly(procBody(ROUTERS, "removeGroupMember"));
    expect(proc).toMatch(
      /const gate = await checkGroupPermission\(input\.conversationId, me\.id, "remove-member"\)/,
    );
    expect(proc).toMatch(/if \(!gate\.ok\) \{/);
    expect(proc.indexOf("checkGroupPermission")).toBeLessThan(proc.indexOf("removeGroupMember({"));
    // A constant-true gate is the shape the mutation used, so it is forbidden by name —
    // pinning the CALL alone let `const gate = { ok: true as const … }` straight through.
    expect(proc).not.toMatch(/gate = \{\s*ok: true/);
  });

  it("adding is gated the same way, and neither gate is a constant", () => {
    const proc = codeOnly(procBody(ROUTERS, "addGroupMember"));
    expect(proc).toMatch(
      /const gate = await checkGroupPermission\(input\.conversationId, me\.id, "add-member"\)/,
    );
    expect(proc).not.toMatch(/gate = \{\s*ok: true/);
  });

  it("the DELETE is scoped to both halves of the key", () => {
    // Unscoped it would remove that identity from EVERY conversation, or every member
    // from this one.
    expect(FN_CODE).toMatch(
      /eq\(conversationParticipants\.conversationId, input\.conversationId\)/,
    );
    expect(FN_CODE).toMatch(/eq\(conversationParticipants\.identityId, input\.identityId\)/);
    expect((FN_CODE.match(/\.delete\(/g) || []).length).toBe(1);
  });

  it("their messages are NOT deleted", () => {
    // The rows belong to everybody in the thread, not only to their author — the same
    // reasoning that keeps a group alive while anyone remains.
    expect(FN_CODE).not.toMatch(/messages/);
  });

  it("removing a non-member is a success rather than an error", () => {
    expect(FN_CODE).toMatch(/return \{ ok: true, removed \}/);
    expect(FN_CODE).toMatch(/affectedRows/);
  });
});

describe("the toggle", () => {
  it("is admin-only, via the capability that already means 'change who may do what'", () => {
    // A new capability naming the same authority would be two names for one decision.
    const proc = codeOnly(procBody(ROUTERS, "setGroupMembersCanAdd"));
    expect(proc).toMatch(/checkGroupPermission\(input\.conversationId, me\.id, "manage-roles"\)/);
  });

  it("writes ONE boolean and can reach nothing else", () => {
    const fn = codeOnly(fnBody(V2DB, "setGroupMembersCanAdd"));
    const sets = [...fn.matchAll(/\.set\((\{[^}]*\})\)/g)].map((m) => m[1]);
    expect(sets.length).toBe(1);
    const keys = [...sets[0].matchAll(/([A-Za-z_]\w*):/g)].map((m) => m[1]);
    expect(keys).toEqual(["membersCanAdd"]);
    // Scoped to a GROUP, so it cannot set a flag on a direct chat.
    expect(fn).toMatch(/eq\(conversations\.kind, "group"\)/);
  });

  it("the read fails to OFF, matching the gate's own falsy-is-safe direction", () => {
    const fn = codeOnly(fnBody(V2DB, "getGroupMembersCanAdd"));
    expect(fn).toMatch(/row\.membersCanAdd === true/);
    expect(fn).toMatch(/return null/);
  });

  it("conversationInfo puts it on the wire so a member's UI can be honest", () => {
    const proc = procBody(ROUTERS, "conversationInfo");
    expect(proc).toMatch(/membersCanAdd: \(await getGroupMembersCanAdd\(input\.conversationId\)\) === true/);
  });
});

describe("schema and migrator", () => {
  it("the column is additive and nullable", () => {
    expect(SCHEMA).toMatch(/membersCanAdd: boolean\("membersCanAdd"\)/);
    // NOT notNull: NULL is what every existing group means, so the migration is a no-op.
    expect(SCHEMA).not.toMatch(/membersCanAdd:[^\n]*notNull/);
  });

  it("the boot migrator adds it", () => {
    expect(V2DB).toMatch(
      /\{ table: "conversations", column: "membersCanAdd", ddl: "ADD COLUMN `membersCanAdd` boolean" \}/,
    );
  });
});

describe("the sheet offers only what the server would allow", () => {
  it("Remove is admin-only, and never against the creator or yourself", () => {
    expect(SHEET).toMatch(/\{iAmAdmin && !m\.isCreator && !m\.isMe && \(/);
  });

  it("Add widens to a plain member only on the SERVER's answer", () => {
    expect(SHEET).toMatch(/\{\(iAmAdmin \|\| info\.data\?\.membersCanAdd\) && \(/);
    // Never inferred from anything client-side.
    expect(codeOnly(SHEET)).not.toMatch(/membersCanAdd = /);
  });

  it("removal is confirmed, and the copy says the messages stay", () => {
    // That their messages survive is the part somebody would assume the opposite of.
    /* REPOINTED FOR #156. The name is INTERPOLATED, so the sentence reaches the
       dictionary as a `{name}` placeholder — which is why the question is asked in two
       halves: the copy is present (`copyOnScreen`), and the confirmation still names the
       member rather than saying "this member". */
    expect(copyOnScreen(SHEET, "from this group?")).toBe(true);
    expect(SHEET).toMatch(/name: removing\.name/);
    expect(copyOnScreen(SHEET, "they already sent stay")).toBe(true);

    // THE BUTTON MUST ROUTE THROUGH THE CONFIRMATION, not merely coexist with it.
    // ADDED after a mutation SURVIVED: pointing the Remove button straight at
    // `removeMember.mutate` left the confirm markup in the file — so the assertions above
    // still passed while the confirmation had become unreachable dead code. That is the
    // pin-the-declaration-not-the-use class, and this is the assertion that catches it.
    /* BOTH ANCHORS ARE ASSERTED TO EXIST BEFORE SLICING. The end anchor used to be the
       button's own English text; localisation turned it into a key, `indexOf` answered
       -1, and `slice(start, -1)` silently ran to the END OF THE FILE — so the slice
       swallowed the confirmation dialog, which legitimately DOES call the mutation, and
       the "must not write directly" assertion failed on correct source. That is the
       negative-index trap (v2.99.78, v2.106.56, v2.106.65) inside the very pin written
       to catch a real gap. Re-anchored on the element's own closing tag, which no copy
       change can move. */
    const btnStart = SHEET.indexOf("{iAmAdmin && !m.isCreator && !m.isMe && (");
    expect(btnStart, "the row-button gate moved").toBeGreaterThan(-1);
    const btnEnd = SHEET.indexOf("</button>", btnStart);
    expect(btnEnd, "the row button lost its closing tag").toBeGreaterThan(btnStart);
    const btn = SHEET.slice(btnStart, btnEnd);
    expect(btn.length).toBeGreaterThan(120);
    /* WHITESPACE-TOLERANT (#156): this froze the call on ONE line, and giving the
       fallback name a translation key made prettier wrap it. The property is only that
       the row button OPENS the confirmation by setting `removing` — never the formatting
       of the arguments. */
    expect(btn.replace(/\s+/g, " ")).toMatch(/onClick=\{\(\) => setRemoving\(\{ id: m\.id/);
    expect(btn, "the row button must not write directly").not.toMatch(/removeMember\.mutate/);
    // …and exactly one place performs the write: the confirmation's own button.
    expect((SHEET.match(/removeMember\.mutate\(/g) || []).length).toBe(1);
  });

  it("the add field says what a new member will and will not see", () => {
    expect(
      copyOnScreen(SHEET, "They'll see messages from when they join, not the history before it"),
    ).toBe(true);
  });
});
