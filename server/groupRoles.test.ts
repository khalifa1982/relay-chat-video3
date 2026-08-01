import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { IDENTITY_REFERENCING_COLUMNS } from "./purgeIdentity";
import { codeOnly } from "./testing/codeOnly";
import { copyOnScreen } from "../server/testing/copyOnScreen";

const R = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const V2DB = R("server/v2db.ts");
const ROUTERS = R("server/v2routers.ts");
const SCHEMA = R("drizzle/schema.ts");
const SHEET = R("client/src/app/GroupInfoSheet.tsx");
const MSG = R("client/src/pages/app/Messages.tsx");


/** A function's body, matched EXACTLY by name and bounded by its own end. A prefix
 *  match here is what v2.104.0 itself broke in six files by adding
 *  `deleteMessageAsGroupAdmin` beside `deleteMessage`. */
function fn(src: string, name: string): string {
  const at = src.search(new RegExp(`export async function ${name}\\b`));
  expect(at, `${name} not found`).toBeGreaterThan(-1);
  const end = src.indexOf("\nexport ", at + 10);
  const out = src.slice(at, end === -1 ? undefined : end);
  expect(out.length, `${name} body is empty`).toBeGreaterThan(200);
  return out;
}

/**
 * v2.104.0 — group roles: Creator, admins, and the delete override.
 *
 * Owner: *"the creator marked as Creator/admin inside group details; admins can appoint
 * sub-admins; only group admins or sub-admins can delete any type of message."*
 *
 * The spine of the group-admin batch. Two additive nullable columns, one predicate, two
 * write paths. What the tests below mostly guard is not the feature but the two things an
 * adversarial review of the first design killed before either was written.
 */
describe("v2.104.0 — the schema is additive and reads correctly for every existing row", () => {
  it("two nullable columns, both applied by the boot migrator", () => {
    expect(SCHEMA).toMatch(/groupRole: varchar\("groupRole", \{ length: 16 \}\)/);
    expect(SCHEMA).toMatch(/deletedByIdentityId: int\("deletedByIdentityId"\)/);
    expect(V2DB).toMatch(/column: "groupRole", ddl: "ADD COLUMN `groupRole` varchar\(16\)"/);
    expect(V2DB).toMatch(/column: "deletedByIdentityId", ddl: "ADD COLUMN `deletedByIdentityId` int"/);
  });

  it("neither column is NOT NULL, and neither has a DEFAULT — so no backfill", () => {
    const cp = SCHEMA.slice(SCHEMA.indexOf('groupRole: varchar("groupRole"'));
    expect(cp.slice(0, 90)).not.toMatch(/notNull|default/);
    const m = SCHEMA.slice(SCHEMA.indexOf('deletedByIdentityId: int("deletedByIdentityId")'));
    expect(m.slice(0, 90)).not.toMatch(/notNull|default/);
  });

  it("the role lives on the participant row, whose PRIMARY KEY scopes every write", () => {
    // NOT `users.role`: that is an ACCOUNT-level site admin, and a guest has no users row
    // at all while a guest can perfectly well be a group member.
    const cp = SCHEMA.slice(
      SCHEMA.indexOf('export const conversationParticipants'),
      SCHEMA.indexOf("export type ConversationParticipant"),
    );
    expect(cp).toMatch(/groupRole/);
    expect(cp).toMatch(/pk: primaryKey\(\{ columns: \[t\.conversationId, t\.identityId\] \}\)/);
  });
});

describe("v2.104.0 — ONE predicate, and no fallback that grants power", () => {
  const gate = fn(V2DB, "checkGroupPermission");

  it("the capability set is closed and small, and splits members from admins", () => {
    /* REWRITTEN v2.105.6 (was: the exact one-line union). That froze the LOCATION of
       the list rather than the property, so adding a capability broke it while saying
       nothing about the thing that matters — which side of the member/admin line each
       one lands on. The union is now multi-line and there is an explicit
       MEMBER_CAPABILITIES set, so this asserts the membership of both sides. */
    const decl = V2DB.slice(
      V2DB.indexOf("export type GroupCapability ="),
      V2DB.indexOf("export type GroupPermission ="),
    );
    expect(decl.length).toBeGreaterThan(40);
    for (const cap of ["edit-profile", "post-story", "start-call", "delete-any-message", "manage-roles"]) {
      expect(decl).toContain(`"${cap}"`);
    }
    // The member set names exactly the two unconditional ones. A capability added to
    // it is a decision; one added anywhere else is admin-only, which is the safe
    // direction to be wrong in.
    const members = /const MEMBER_CAPABILITIES = new Set<GroupCapability>\(\[([^\]]*)\]\)/.exec(V2DB);
    expect(members).toBeTruthy();
    const listed = Array.from(members![1].matchAll(/"([a-z-]+)"/g)).map((m) => m[1]).sort();
    expect(listed).toEqual(["edit-profile", "post-story", "start-call"]);
  });

  it("membership is established BEFORE any role or capability is considered", () => {
    // A non-member must not learn anything about the group, including whether it has
    // admins — so the membership refusal comes first.
    expect(gate).toMatch(/if \(!mine\) return \{ ok: false, reason: "not-a-member" \}/);
    expect(gate.indexOf('reason: "not-a-member"')).toBeLessThan(
      gate.indexOf("MEMBER_CAPABILITIES.has(capability)"),
    );
  });

  it("`edit-profile` is UNCONDITIONAL for members — and that IS the security", () => {
    // THE FINDING THIS ENCODES. The first design granted every member FULL admin rights
    // whenever a group had no admin, calling it behaviour-preserving. It is a hostile
    // takeover primitive, default-on for every pre-v2.102.0 group (all have
    // ownerIdentityId NULL): any member could appoint THEMSELVES, and the other nineteen
    // would instantly lose every power they had a second earlier.
    //
    // The fix is no fallback at all. `edit-profile` — the only thing a member can do
    // today — is granted to every member forever, so there is nothing for a first-mover
    // to take away. Everything else needs a real admin.
    /* REWRITTEN v2.105.6: was `if (capability === "edit-profile")`, i.e. it froze the
       one-capability shape. The property is that a MEMBER capability returns ok
       without consulting adminship at all, and that the admin refusal sits after it. */
    expect(gate).toMatch(/if \(MEMBER_CAPABILITIES\.has\(capability\)\) return \{ ok: true/);
    expect(gate.indexOf("MEMBER_CAPABILITIES.has(capability)")).toBeLessThan(
      gate.indexOf('reason: "not-an-admin"'),
    );
  });

  it("no capability is granted merely because the group has no admin", () => {
    // The escalation would look like `if (!hasAdmin) return { ok: true }`. Any shape of
    // that is forbidden: `hasAdmin` may be REPORTED, never used to grant.
    const code = codeOnly(gate);
    expect(code).not.toMatch(/if \(!hasAdmin\)[^\n]*\{?\s*return \{ ok: true/);
    expect(code).not.toMatch(/adminless/);
    // It is still returned, so the UI can explain itself.
    expect(gate).toMatch(/hasAdmin/);
  });

  it("the creator is an admin, derived — no backfill, and only while a member", () => {
    // `ownerIdentityId` has been written at creation since v2.102.0 and read by nothing.
    // Deriving from it means every group made since then already HAS an administrator.
    expect(gate).toMatch(/convo\.ownerIdentityId != null && convo\.ownerIdentityId === identityId/);
    expect(gate).toMatch(/const isAdmin = mine\.groupRole === "admin" \|\| isCreator;/);
    // The creator branch is reached only after the membership check above, so a purged
    // or departed creator (no participant row) confers adminship on nobody.
    expect(gate.indexOf('reason: "not-a-member"')).toBeLessThan(gate.indexOf("isCreator = creatorIsMember"));
  });

  it("a dead read fails CLOSED, while 'no admin' is a reported state", () => {
    // Opposite directions, both deliberate: "this group has no admin" is knowledge;
    // "the read threw" is not.
    expect(gate).toMatch(/if \(!db\) return \{ ok: false, reason: "unavailable" \}/);
    expect(gate).toMatch(/catch[\s\S]{0,200}?return \{ ok: false, reason: "unavailable" \}/);
  });

  it("the DM refusal lives here too, so every group write inherits it", () => {
    expect(gate).toMatch(/if \(convo\.kind !== "group"\) return \{ ok: false, reason: "not-a-group" \}/);
  });
});

describe("v2.104.0 — every writer gates itself through the predicate", () => {
  it("setGroupProfile no longer carries its own membership SELECT", () => {
    const f = fn(V2DB, "setGroupProfile");
    expect(f).toMatch(/checkGroupPermission\(conversationId, identityId, "edit-profile"\)/);
    // The inline duplicate is GONE — one rule, one place.
    expect(codeOnly(f)).not.toMatch(/from\(conversationParticipants\)/);
    expect(f.indexOf("checkGroupPermission")).toBeLessThan(f.indexOf(".update(conversations)"));
  });

  it("setGroupRole gates on manage-roles before it reads or writes anything", () => {
    const f = fn(V2DB, "setGroupRole");
    expect(f).toMatch(/checkGroupPermission\(input\.conversationId, input\.actorIdentityId, "manage-roles"\)/);
    expect(f).toMatch(/if \(!gate\.ok\) return \{ ok: false, reason: gate\.reason \}/);
    expect(f.indexOf("checkGroupPermission")).toBeLessThan(f.indexOf(".update(conversationParticipants)"));
  });

  it("the role write is scoped to ONE participation by naming both key halves", () => {
    // Without both, an UPDATE could change a role in another group or for another
    // person. This is the class that survived a mutation twice (v2.102.2, v2.103.0), so
    // it is pinned on the WRITE specifically rather than on a nearby SELECT's copy.
    const f = fn(V2DB, "setGroupRole");
    // BOUNDED TO THE UPDATE'S OWN `.where(...)`. The first version of this sliced from
    // `.update(conversationParticipants)` to the end of the function — and the RE-READ
    // below the update carries a BYTE-IDENTICAL where clause, so stripping the
    // conversation from the UPDATE left the re-read's copy satisfying the pin and the
    // mutation SURVIVED. That is the third time this exact shape has got through
    // (v2.102.2, v2.103.0), so it is pinned on the write specifically and BOTH sites are
    // counted, so a clause missing from either is caught rather than masked by the other.
    const upAt = f.indexOf(".update(conversationParticipants)");
    expect(upAt).toBeGreaterThan(-1);
    const write = f.slice(upAt, f.indexOf(");", f.indexOf(".where(", upAt)));
    expect(write.length).toBeGreaterThan(80);
    expect(write).toMatch(/eq\(conversationParticipants\.conversationId, input\.conversationId\)/);
    expect(write).toMatch(/eq\(conversationParticipants\.identityId, input\.targetIdentityId\)/);
    // Both halves appear TWICE across the function: once on the write, once on the
    // re-read. A missing one on either side changes the count.
    expect(f.match(/eq\(conversationParticipants\.conversationId, input\.conversationId\)/g)?.length).toBe(3);
    expect(f.match(/eq\(conversationParticipants\.identityId, input\.targetIdentityId\)/g)?.length).toBe(2);
  });

  it("a revoke cannot leave the group with no administrator", () => {
    // Same reasoning as admin.setAccountType refusing a site-admin self-demotion
    // (v2.99.99): refusing GUARANTEES an administrator remains, which is stronger than
    // counting them. The creator is counted too, because their adminship is derived and
    // would not appear in the column.
    const f = fn(V2DB, "setGroupRole");
    expect(f).toMatch(/reason: "last-admin"/);
    expect(f).toMatch(/creatorStillAdmin/);
    expect(f).toMatch(/if \(remaining === 0 && !creatorStillAdmin\) return \{ ok: false, reason: "last-admin" \}/);
  });

  it("the creator's adminship cannot be revoked, and the refusal is NAMED", () => {
    // It is derived, so no stored value could remove it — a control that appears to work
    // and changes nothing is worse than one that refuses.
    const f = fn(V2DB, "setGroupRole");
    expect(f).toMatch(/reason: "creator-cannot-be-revoked"/);
  });
});

describe("v2.104.0 — the admin delete reuses the mechanism and keeps unsend intact", () => {
  const f = fn(V2DB, "deleteMessageAsGroupAdmin");

  it("unsend is UNTOUCHED and stays sender-only", () => {
    // A widening would have put an isAdmin-shaped parameter in the position the house
    // rule forbids, and messageHide.test.ts pins the literal sender clause inside it.
    const unsend = fn(V2DB, "deleteMessage");
    expect(unsend).toMatch(/eq\(messages\.senderIdentityId, input\.identityId\)/);
    expect(codeOnly(unsend)).not.toMatch(/checkGroupPermission|isAdmin|groupRole/);
  });

  it("gates on delete-any-message before touching a row", () => {
    expect(f).toMatch(/checkGroupPermission\(input\.conversationId, input\.identityId, "delete-any-message"\)/);
    expect(f.indexOf("checkGroupPermission")).toBeLessThan(f.indexOf(".update(messages)"));
  });

  it("REFUSES a message that is not in the group the caller administers", () => {
    // Message ids are small sequential integers, so without this an admin of one group
    // could delete a message in any other. It answers exactly like a missing message, so
    // the endpoint is no existence oracle.
    expect(f).toMatch(/if \(!row \|\| row\.conversationId !== input\.conversationId\) return \{ ok: false, reason: "not-found" \}/);
  });

  it("reuses deletedAt rather than inventing a second mechanism", () => {
    // Five readers already filter on deletedAt; a new mechanism would have to teach all
    // five, and SEARCH is where that silently fails.
    expect(f).toMatch(/deletedAt: new Date\(\)/);
    expect(f).toMatch(/deletedByIdentityId: input\.identityId/);
  });

  it("KEEPS the attachments row and only nulls the reference", () => {
    // authorizeStorageKey serves a key with NO row as `unknown`, so deleting the row
    // would make the media MORE readable rather than gone (v2.98.4/F3).
    expect(f).toMatch(/attachmentId: null/);
    expect(codeOnly(f)).not.toMatch(/delete\(attachments\)/);
  });

  it("is an ATOMIC claim, and idempotent for an already-deleted message", () => {
    expect(f).toMatch(/isNull\(messages\.deletedAt\)/);
    expect(f).toMatch(/affectedRows \?\? 0\) > 0/);
    expect(f).toMatch(/if \(row\.deletedAt\) return \{ ok: true \}/);
  });

  it("RECOMPUTES unread rather than decrementing — the decrement excludes the wrong person", () => {
    // deleteMessage's decrement carries `ne(identityId, input.identityId)`, which is the
    // SENDER there and the ADMIN here: reusing it would skip the admin and wrongly
    // decrement the real sender. A recompute is also idempotent (v2.99.74).
    expect(f).toMatch(/recomputeUnreadFor\(input\.conversationId, m\)/);
    expect(codeOnly(f)).not.toMatch(/GREATEST\(/);
  });

  it("unhooks a survivor's reply BEFORE the quoted message goes", () => {
    expect(f).toMatch(/set\(\{ replyToId: null \}\)/);
    expect(f.indexOf("replyToId: null")).toBeLessThan(f.indexOf("deletedAt: new Date()"));
  });

  it("refuses the admin's OWN message — that is Unsend's job", () => {
    expect(f).toMatch(/reason: "own-message"/);
  });
});

describe("v2.104.0 — the purge registry, and the guard that would have missed it", () => {
  it("deletedByIdentityId is declared, and keep-safer rather than redact", () => {
    // `redact` would be actively WRONG: NULL in this column MEANS "the sender unsent
    // it", so nulling a purged admin's id rewrites their deletion into an apparent
    // self-unsend — the row would positively assert the sender removed their own words.
    const entry = IDENTITY_REFERENCING_COLUMNS.find(
      (c) => c.table === "messages" && c.column === "deletedByIdentityId",
    );
    expect(entry, "deletedByIdentityId must be declared").toBeTruthy();
    expect(entry!.strategy).toBe("keep-safer");
    expect(entry!.note).toMatch(/redact/i);
  });

  it("the machine check's own name pattern was widened in the same commit", () => {
    // THE REVIEW'S MOST VALUABLE CATCH: REFERENCE_SHAPE is an anchored, hand-kept
    // alternation, so a new identity-naming column it does not list escapes the guard
    // entirely — the build would NOT fail by name, which is the one thing that guard
    // exists to promise.
    const purgeTest = R("server/identityPurge.test.ts");
    expect(purgeTest).toMatch(/REFERENCE_SHAPE[\s\S]{0,400}?deletedByIdentityId/);
  });
});

describe("v2.104.0 — the router names each refusal, and checks nothing itself", () => {
  it("every refusal setGroupRole can return has its own message", () => {
    const proc = ROUTERS.slice(ROUTERS.indexOf("  setGroupRole: publicProcedure"), ROUTERS.indexOf("  deleteAsAdmin: publicProcedure"));
    expect(proc.length).toBeGreaterThan(500);
    for (const reason of [
      "not-found",
      "not-a-group",
      "not-a-member",
      "not-an-admin",
      "target-not-a-member",
      "creator-cannot-be-revoked",
      "last-admin",
      "unavailable",
    ]) {
      expect(proc, reason).toMatch(new RegExp(`"?${reason}"?:`));
    }
    // The router performs NO permission check of its own — a caller must not be able to
    // forget one, so it lives inside the write function.
    expect(codeOnly(proc)).not.toMatch(/checkGroupPermission/);
  });

  it("the admin delete fans out the EXISTING message SSE kind, not a new one", () => {
    // An undeclared kind is dropped by the Redis bus allowlist whenever the recipient is
    // on the other instance, and single-instance dev would look perfect (v2.99.74).
    const proc = ROUTERS.slice(ROUTERS.indexOf("  deleteAsAdmin: publicProcedure"), ROUTERS.indexOf("  createGroup: publicProcedure"));
    expect(proc.length).toBeGreaterThan(400);
    expect(proc).toMatch(/publishToIdentity\(id, \{ kind: "message"/);
  });

  it("conversationInfo reports roles as DECORATION and stays members-only", () => {
    // BOUNDED FROM THE START, and asserted non-empty. My first cut ended the slice at
    // `indexOf("  list: publicProcedure")`, which occurs 570 lines EARLIER in the file —
    // so the end came before the start and the slice was "". Every assertion below would
    // then have passed vacuously the moment one was a `not.toMatch`; the recurring
    // inverted/unbounded-slice fragility this repo keeps having to write out of its pins.
    const ciAt = ROUTERS.indexOf("  conversationInfo: publicProcedure");
    expect(ciAt).toBeGreaterThan(0);
    // END ANCHOR SEARCHED FROM ciAt, and the NEAREST following procedure. Bounding it at
    // `createGroup` swept in the procedures between, one of which has its own
    // `code: "FORBIDDEN"` — so deleting THIS procedure's membership throw left the pin
    // satisfied by a stranger's and the mutation SURVIVED.
    // REWRITTEN v2.105.7 to the NEXT PROCEDURE, whichever it is, rather than the
    // one that happened to follow: #113 inserted `startGroupCall` between these two,
    // which grew the window past its own 3000-char sanity bound. Naming the new
    // neighbour would just move the fragility one insertion along, so the end anchor
    // is now "the next procedure declaration" and cannot go stale again.
    const nextProc = ROUTERS.indexOf(": publicProcedure", ciAt + 40);
    expect(nextProc).toBeGreaterThan(ciAt);
    // Back up to that declaration's own line start so the slice ends cleanly.
    const proc = ROUTERS.slice(ciAt, ROUTERS.lastIndexOf("\n", nextProc));
    expect(proc.length).toBeGreaterThan(400);
    // "IT IS ONE PROCEDURE" ASSERTED DIRECTLY RATHER THAN VIA A CHARACTER COUNT
    // (rewritten v2.105.16). The old bound was `< 3000`, an arbitrary proxy for the real
    // invariant — and v2.105.16 added one field with a comment, which took the procedure
    // to 3580 and broke the pin while saying nothing about whether the slice had
    // over-run. Bumping the number would move the fragility one addition along, which is
    // exactly what the note above warns about; counting declarations cannot go stale on a
    // legitimate addition and catches the thing the bound was standing in for.
    expect((proc.match(/: publicProcedure/g) || []).length).toBe(1);
    expect(proc).toMatch(/isCreator:/);
    expect(proc).toMatch(/isAdmin:/);
    expect(proc).toMatch(/hasAdmin:/);
    // THE GUARD ITSELF, not "a FORBIDDEN appears somewhere nearby".
    expect(proc).toMatch(/if \(!memberIds\.includes\(me\.id\)\) \{[\s\S]{0,160}?code: "FORBIDDEN"/);
    // It uses the decoration-tolerant reader, NOT the fail-closed predicate — and the
    // reverse would be the bug, so the predicate must not appear here.
    expect(proc).toMatch(/getGroupRoles\(input\.conversationId\)/);
    expect(codeOnly(proc)).not.toMatch(/checkGroupPermission/);
  });

  it("getGroupRoles is decoration-only and says so, failing to an EMPTY map", () => {
    const f = fn(V2DB, "getGroupRoles");
    // It swallows its own failure so a role lookup can never stop a roster rendering…
    expect(f).toMatch(/catch \{\s*return empty;/);
    expect(f).toMatch(/roleById: new Map<number, string \| null>\(\)/);
    // …which is exactly why it must never decide anything. It performs no membership
    // check and returns no verdict, so there is nothing here a caller could mistake for
    // authorization. (The first version of this test asserted the wording of the comment
    // above the function — pinning prose, and outside the slice besides.)
    expect(codeOnly(f)).not.toMatch(/ok: (true|false)/);
    expect(codeOnly(f)).not.toMatch(/not-a-member|not-an-admin/);
  });
});

describe("v2.104.0 — the UI offers only what the server would allow", () => {
  it("the sheet reads adminship from the SERVER's answer, never inferring it", () => {
    expect(SHEET).toMatch(/const iAmAdmin = !!info\.data\?\.members\.find\(\(m\) => m\.isMe\)\?\.isAdmin;/);
  });

  it("Creator and Admin are separate labels, and only one shows", () => {
    expect(SHEET).toMatch(/m\.isCreator \? \([\s\S]{0,300}?Creator/);
    expect(SHEET).toMatch(/: m\.isAdmin \? \([\s\S]{0,300}?Admin/);
  });

  it("the appoint control is admin-only and never offered against the creator", () => {
    expect(SHEET).toMatch(/\{iAmAdmin && !m\.isCreator && \(/);
    /* The TERNARY is the property — one control whose label states which way it goes —
       and both halves must reach the screen. Repointed for #156: the labels are keys now,
       so the shape is pinned on the condition and the words on `copyOnScreen`. */
    expect(SHEET).toMatch(/m\.isAdmin \? t\("groups\.removeAdmin"\) : t\("groups\.makeAdmin"\)/);
    for (const w of ["Remove admin", "Make admin"]) expect(copyOnScreen(SHEET, w), w).toBe(true);
  });

  it("a group with no admin SAYS so instead of offering a control that fails", () => {
    // Every group created before v2.102.0 has no creator recorded, so it has no admin and
    // no way to appoint one. Nothing about it regresses; the feature does not reach it,
    // and the sheet says that in words.
    expect(SHEET).toMatch(/hasAdmin/);
    expect(copyOnScreen(SHEET, "created before admins existed")).toBe(true);
  });

  it("the role write is not optimistic, and refreshes only the read that shows it", () => {
    expect(SHEET).toMatch(/trpc\.messages\.setGroupRole\.useMutation/);
    const m = SHEET.slice(SHEET.indexOf("trpc.messages.setGroupRole.useMutation"));
    const body = m.slice(0, m.indexOf("});"));
    expect(codeOnly(body)).not.toMatch(/onMutate|setData/);
    expect(body).toMatch(/conversationInfo\.invalidate/);
  });

  it("the message menu offers the override only to an admin, never on my own message", () => {
    expect(MSG).toMatch(/onAdminDelete=\{iAmGroupAdmin \? \(\) => setAdminDeleting\(m\) : undefined\}/);
    expect(MSG).toMatch(/\{!mine && onAdminDelete && \(/);
    expect(copyOnScreen(MSG, "Remove for everyone")).toBe(true);
    expect(MSG).toMatch(/const iAmGroupAdmin = !!\(isGroup && infoQuery\.data\?\.members\.find\(\(mem\) => mem\.isMe\)\?\.isAdmin\)/);
  });

  it("it is behind a confirmation whose copy names the blast radius", () => {
    expect(copyOnScreen(MSG, "Remove this message for everyone?")).toBe(true);
    expect(copyOnScreen(MSG, "They aren't told, and it can't be undone")).toBe(true);
  });

  it("the admin delete is not optimistic", () => {
    // It removes a row twenty people are looking at, so a failure painted as success
    // would leave the admin believing they removed something the server refused.
    const m = MSG.slice(MSG.indexOf("trpc.messages.deleteAsAdmin.useMutation"));
    const body = m.slice(0, m.indexOf("});"));
    expect(body.length).toBeGreaterThan(100);
    expect(codeOnly(body)).not.toMatch(/onMutate|setData/);
  });
});
