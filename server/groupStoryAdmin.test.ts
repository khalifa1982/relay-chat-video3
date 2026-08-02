/**
 * #118 / #119 — the two group-story items the owner asked for on 2026-07-29.
 *
 *   #118  a group ADMIN may remove a story a MEMBER posted to their group.
 *   #119  a group story stops spending the poster's own 30-active cap.
 *
 * Both are DB writes, and there is no MySQL here, so the properties are proven by
 * reading the statements — with the one rule that can be stated as a function
 * (which shelf a count is taken on) pinned at both ends so the caller and the
 * counter cannot drift.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { codeOnly } from "./testing/codeOnly";
import { copyOnScreen, whyCopyMissing } from "./testing/copyOnScreen";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const DB = read("server/v2db.ts");
const ROUTERS = read("server/v2routers.ts");
const VIEWER = read("client/src/pages/app/Status.tsx");

/**
 * The exact function BODY.
 *
 * Two traps, both of which this repo has been bitten by, and my first draft of
 * this helper walked straight into the second:
 *
 *  - the `\b` on the name, so a PREFIX cannot be read instead (v2.104.0's
 *    `deleteMessage` / `deleteMessageAsGroupAdmin` collision);
 *  - the body brace is NOT simply the first `{` after the name. For
 *    `function f(input: {…})` it is the destructured parameter (v2.105.9), and for
 *    `function f(): Promise<{…}>` it is the RETURN TYPE — which is what this file
 *    hit, returning the type annotation and failing every assertion about the body.
 *    So the scan takes the first `{` reached with parens CLOSED and angles at zero.
 */
function fnAt(src: string, name: string): string {
  const m = new RegExp(`export (async )?function ${name}\\b`).exec(src);
  if (!m) throw new Error(`no function ${name}`);
  let paren = 0;
  let angle = 0;
  let sawParams = false;
  let start = -1;
  for (let i = m.index; i < src.length; i++) {
    const c = src[i];
    if (c === "(") { paren++; sawParams = true; }
    else if (c === ")") paren--;
    else if (c === "<") angle++;
    else if (c === ">" && src[i - 1] !== "=") angle--;
    else if (c === "{" && sawParams && paren === 0 && angle === 0) { start = i; break; }
  }
  if (start < 0) throw new Error(`no body for ${name}`);
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced ${name}`);
}

describe("#118 — the admin delete is its own writer", () => {
  it("exists as a SEPARATE NAMED function, not a flag on the author-scoped one", () => {
    // The house rule from v2.104.0: a boolean in that position is something a
    // caller can pass by mistake, and a name is not.
    expect(DB).toMatch(/export async function deleteStatusAsGroupAdmin\(/);
    const author = fnAt(DB, "deleteStatus");
    expect(author).not.toMatch(/isAdmin|asAdmin|checkGroupPermission/);
  });

  it("leaves the author-scoped delete EXACTLY as it was", () => {
    // Its author clause on the DELETE is a mutation-verified tripwire (v2.105.6),
    // and an unscoped one would let anybody remove anybody's story.
    const author = fnAt(DB, "deleteStatus");
    const del = author.slice(author.indexOf(".delete(statuses)"));
    expect(del).toMatch(/eq\(statuses\.id, id\), eq\(statuses\.identityId, ownerId\)/);
  });

  it("REFUSES a personal story before it ever reads a permission", () => {
    // A row with no conversationId was addressed to the author's own contacts and
    // is nobody's group business — checked FIRST, so the answer cannot depend on
    // which groups the caller happens to administer.
    const fn = fnAt(DB, "deleteStatusAsGroupAdmin");
    const personal = fn.indexOf('reason: "not-a-group-story"');
    const perm = fn.indexOf("checkGroupPermission");
    expect(personal).toBeGreaterThan(-1);
    expect(perm).toBeGreaterThan(-1);
    expect(personal).toBeLessThan(perm);
  });

  it("gates on the group capability, and refuses when it is not granted", () => {
    const fn = fnAt(DB, "deleteStatusAsGroupAdmin");
    expect(fn).toMatch(/checkGroupPermission\(row\.conversationId, adminIdentityId, "delete-any-story"\)/);
    expect(fn).toMatch(/if \(!perm\.ok\) return \{ ok: false, reason: "forbidden" \}/);
  });

  it("scopes the DELETE by the CONVERSATION, never by the caller", () => {
    // By the caller it would delete nothing; without the conversation clause an
    // admin of one group could remove a story posted to another.
    const fn = fnAt(DB, "deleteStatusAsGroupAdmin");
    const del = fn.slice(fn.indexOf(".delete(statuses)"));
    expect(del).toMatch(/eq\(statuses\.id, statusId\), eq\(statuses\.conversationId, row\.conversationId\)/);
    expect(del).not.toMatch(/identityId, adminIdentityId/);
  });

  it("the capability is its OWN name and is admin-only by ABSENCE from the member set", () => {
    expect(DB).toMatch(/\| "delete-any-story"/);
    const set = DB.slice(DB.indexOf("const MEMBER_CAPABILITIES"), DB.indexOf("const MEMBER_CAPABILITIES") + 220);
    expect(set).not.toMatch(/delete-any-story/);
    // ...and the set really is the one the checker reads, so the absence means
    // something rather than naming a set nobody consults.
    expect(DB).toMatch(/if \(MEMBER_CAPABILITIES\.has\(capability\)\)/);
  });

  it("the member set is never mutated — that would leak authority across groups", () => {
    // v2.105.16: MEMBER_CAPABILITIES is module-level, so `.add` for one group would
    // grant the capability in EVERY group for the life of the process.
    const code = codeOnly(DB);
    expect(code).not.toMatch(/MEMBER_CAPABILITIES\.(add|delete|clear)\(/);
  });

  it("returns the author and group, so the removal can be fanned out", () => {
    const fn = fnAt(DB, "deleteStatusAsGroupAdmin");
    expect(fn).toMatch(/return \{ ok: true, conversationId: row\.conversationId, authorId: row\.identityId \}/);
  });
});

describe("#118 — the procedure", () => {
  const q = ROUTERS.slice(
    ROUTERS.indexOf("removeAsGroupAdmin: publicProcedure"),
    ROUTERS.indexOf("markViewed: publicProcedure"),
  );
  it("the slice really is the procedure", () => {
    expect(q.length).toBeGreaterThan(400);
    expect(q).toMatch(/deleteStatusAsGroupAdmin/);
  });

  it("is its own procedure rather than a branch inside `remove`", () => {
    const own = ROUTERS.slice(
      ROUTERS.indexOf("  /** Delete one of my statuses. */"),
      ROUTERS.indexOf("removeAsGroupAdmin: publicProcedure"),
    );
    expect(own).toMatch(/deleteStatus\(input\.id, me\.id\)/);
    expect(own).not.toMatch(/deleteStatusAsGroupAdmin/);
  });

  it("EVERY refusal answers identically, so ids cannot be probed", () => {
    // Status ids are small sequential integers; a distinguishable refusal would let
    // anybody map which ids exist and which groups they belong to.
    expect(q.match(/throw new TRPCError/g)?.length).toBe(1);
    expect(q).toMatch(/code: "NOT_FOUND", message: "That story isn't there to remove\."/);
  });

  it("is rate-limited", () => {
    expect(q).toMatch(/statusGate\(ctx\)/);
  });

  it("the fan-out names the AUTHOR, not the admin", () => {
    // Clients key their rings on the author. Publishing under the admin's identity
    // would clear a ring they never had and leave the real one lit for 24h.
    expect(q).toMatch(/publishStatusEvent\(\s*res\.authorId,/);
    expect(q).not.toMatch(/publishStatusEvent\(\s*me\.id,/);
  });
});

describe("#118 — the viewer offers it only where it can work", () => {
  it("asks whether I am an admin LAZILY, not on the polled feed", () => {
    expect(VIEWER).toMatch(/trpc\.messages\.conversationInfo\.useQuery/);
    expect(VIEWER).toMatch(/enabled: groupCid != null && !isMine/);
  });

  it("the control needs a group slide, somebody else's, and a real admin answer", () => {
    const decl = VIEWER.slice(VIEWER.indexOf("const canRemoveAsAdmin"), VIEWER.indexOf("const itemMs"));
    expect(decl).toMatch(/groupCid != null/);
    expect(decl).toMatch(/!isMine/);
    expect(decl).toMatch(/groupInfo\.data\?\.members\?\.some\(\(m\) => m\.isMe && m\.isAdmin\)/);
    // Defaults to false in flight or on failure: hiding a control beats showing one
    // the server will refuse.
    expect(decl).toMatch(/!!groupInfo\.data/);
  });

  it("`groupCid` is derived from the subject's KIND, never from a bare field", () => {
    // A REAL GAP found by mutation: `group?.subject.conversationId ?? 1` also
    // satisfies `groupCid != null`, so the control could surface on a PERSONAL reel
    // for anybody who happens to administer conversation 1 — and every assertion
    // above stayed green. The kind test is what makes a person reel unreachable.
    expect(VIEWER).toMatch(
      /const groupCid = group\?\.subject\.kind === "group" \? group\.subject\.conversationId : null;/,
    );
  });

  it("never shows beside the author's own Delete", () => {
    // Two buttons doing the same thing by different authority on one row.
    const admin = VIEWER.slice(VIEWER.indexOf("{canRemoveAsAdmin && item && ("));
    expect(admin.length).toBeGreaterThan(400);
    expect(VIEWER).toMatch(/canRemoveAsAdmin =\s*\n?\s*groupCid != null &&\s*\n?\s*!isMine/);
  });

  it("is confirmed, and the copy says whose story and where", () => {
    const admin = VIEWER.slice(VIEWER.indexOf("{canRemoveAsAdmin && item && ("));
    // A REAL GAP found by mutation, and the same class as the v2.105.16 survivor:
    // asserting that `window.confirm(` APPEARS says nothing about whether it
    // DECIDES anything — `if (false && !window.confirm(…))` left the text in place
    // and removed somebody else's story with no prompt at all. So the condition is
    // pinned exactly, and a constant-false conjunct in front of it is forbidden.
    expect(admin).toMatch(/if \(\s*\n\s*!window\.confirm\(/);
    expect(admin).not.toMatch(/if \(\s*\n?\s*(false|true) &&/);
    /* THE THREE COPY PINS GO THROUGH `copyOnScreen` — they froze English literals and
       the sentence now lives in the dictionary. The property was never the template's
       shape: it is that the confirmation names WHOSE story and WHICH group, says it
       goes for everybody, and says it cannot be undone. Both facts are still
       interpolated INTO one sentence rather than glued around it, so the Arabic can put
       them where the language wants them — asserted separately below. */
    for (const phrase of ["story from", "every member", "can't be undone"]) {
      expect(copyOnScreen(VIEWER, phrase), whyCopyMissing(VIEWER, phrase)).toBe(true);
    }
    expect(admin).toMatch(/t\("status\.confirmRemove", \{/);
    expect(admin).toMatch(/who,/);
    expect(admin).toMatch(/group: group\?\.subject\.displayName \?\? t\("status\.thisGroup"\)/);
    // ...and it RETURNS on a refusal rather than falling through to the delete.
    expect(admin).toMatch(/\) \{\s*\n\s*return;\s*\n\s*\}/);
  });

  it("refreshes BOTH status reads and re-clamps the index", () => {
    const admin = VIEWER.slice(VIEWER.indexOf("{canRemoveAsAdmin && item && ("));
    expect(admin).toMatch(/utils\.status\.feed\.invalidate\(\)/);
    expect(admin).toMatch(/utils\.status\.mine\.invalidate\(\)/);
    expect(admin).toMatch(/setIi\(\(v\) => Math\.max\(0, Math\.min\(v,/);
  });
});

describe("#119 — a group story no longer spends a personal slot", () => {
  const fn = fnAt(DB, "countActiveStatuses");

  it("counts PERSONAL stories only when no group is named", () => {
    expect(fn).toMatch(/conversationId == null\s*\n?\s*\? isNull\(statuses\.conversationId\)/);
  });

  it("counts THIS AUTHOR's stories in THAT group when one is named", () => {
    // Per (author, group), not per group: a group-wide total would let one member
    // fill the shelf and lock every other member out.
    expect(fn).toMatch(/: eq\(statuses\.conversationId, conversationId\)/);
    expect(fn).toMatch(/eq\(statuses\.identityId, ownerId\)/);
  });

  it("still only counts LIVE stories", () => {
    expect(fn).toMatch(/gt\(statuses\.expiresAt, new Date\(\)\)/);
  });

  it("defaults to the personal shelf, so an untaught caller keeps today's meaning", () => {
    expect(DB).toMatch(/conversationId: number \| null = null,/);
  });

  it("the poster's cap is checked on the shelf being posted to", () => {
    expect(ROUTERS).toMatch(/countActiveStatuses\(me\.id, group\?\.id \?\? null\)\) >= STATUS_MAX_ACTIVE/);
  });

  it("the refusal names WHICH shelf is full", () => {
    // "You can have up to 30" while a personal reel sits empty is a message
    // somebody cannot act on.
    const post = ROUTERS.slice(ROUTERS.indexOf("countActiveStatuses(me.id, group?.id ?? null)"));
    const block = post.slice(0, post.indexOf("}\n"));
    expect(block).toMatch(/active stories in one group/);
    expect(block).toMatch(/group\s*\n?\s*\? `You can have up to/);
  });

  it("there is exactly ONE cap call site", () => {
    // Two would be two places that can come to disagree about which shelf counts.
    expect(codeOnly(ROUTERS).match(/countActiveStatuses\(/g)?.length).toBe(1);
  });
});
