/**
 * v2.102.0 — a group gets its own 6-digit id, photo and status.
 *
 * Owner (#89): a group should have a 6-digit GROUP ID, a group avatar, a group
 * status, and a groups section.
 *
 * THE LOAD-BEARING FINDING IS NOT THE FEATURE — IT IS WHAT A THIRD NUMBER TABLE
 * BREAKS. `number_reservations` is what stops a handed-out number reaching a
 * stranger, and BOTH of its deleters guard with `NOT EXISTS` subqueries naming
 * `identities` and `party_lines` ONLY. A group number lives in neither, so without
 * the third conjunct the reaper would see a live group's reservation as unclaimed,
 * delete it, and the id could later be reissued to somebody else — the exact trap
 * v2.100.0's purge hit, in a second place. Every one of those three call sites is
 * pinned here.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { NUMBER_BEARING_COLUMNS } from "./v2db";
import { IDENTITY_REFERENCING_COLUMNS } from "./purgeIdentity";
import { codeOnly } from "./testing/codeOnly";

const ROOT = path.resolve(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const V2DB = read("server/v2db.ts");
const ROUTERS = read("server/v2routers.ts");
const SCHEMA = read("drizzle/schema.ts");
const MESSAGES = read("client/src/pages/app/Messages.tsx");


describe("the group id comes from the ONE shared allocator", () => {
  it("allocateGroupNumber delegates to allocateSharedNumber, like the other two", () => {
    // A parallel allocator is exactly the cross-table collision v2.99.30 closed: it
    // would skip the shared numberTaken check AND the atomic reservation claim.
    const fn = V2DB.slice(
      V2DB.indexOf("export async function allocateGroupNumber"),
      V2DB.indexOf("export async function allocatePartyLineNumber"),
    );
    expect(fn.length).toBeGreaterThan(80);
    expect(fn).toMatch(/return allocateSharedNumber\(db\)/);
    // …and no second implementation exists.
    expect((V2DB.match(/for \(let attempt = 0; attempt < 40; attempt\+\+\)/g) || []).length).toBe(1);
  });

  it("every allocator in the file goes through it — the count is asserted", () => {
    const callers = V2DB.match(/return allocateSharedNumber\(db\)/g) || [];
    // identities, party lines, groups.
    expect(callers.length).toBe(3);
  });

  it("numberTaken checks ALL THREE tables", () => {
    const fn = V2DB.slice(V2DB.indexOf("async function numberTaken"), V2DB.indexOf("\n/**", V2DB.indexOf("async function numberTaken")));
    expect(fn).toMatch(/\.from\(identities\)/);
    expect(fn).toMatch(/\.from\(partyLines\)/);
    expect(fn).toMatch(/\.from\(conversations\)/);
  });

  it("the group check tolerates a pre-migrator boot, like the party-line one", () => {
    // The column does not exist until the migrator runs; throwing there would make
    // EVERY allocation fail on a fresh install.
    const fn = V2DB.slice(V2DB.indexOf("async function numberTaken"));
    const seg = fn.slice(0, fn.indexOf("return false;"));
    expect((seg.match(/} catch \{/g) || []).length).toBe(2);
  });
});

describe("the reservation ledger cannot reap a live group's id", () => {
  it("releaseUnusedNumberReservation names all three tables", () => {
    const at = V2DB.indexOf("export async function releaseUnusedNumberReservation");
    const fn = V2DB.slice(at, V2DB.indexOf("\n}", at));
    expect(fn).toMatch(/FROM \\`identities\\`/);
    expect(fn).toMatch(/FROM \\`party_lines\\`/);
    expect(fn).toMatch(/FROM \\`conversations\\`/);
  });

  it("reapUnclaimedReservations names all three too — the dangerous one", () => {
    // This one runs unattended every hour. Missing the third table means a live
    // group's reservation is deleted and its id can be handed to a stranger who has
    // it written down.
    const at = V2DB.indexOf("export async function reapUnclaimedReservations");
    const fn = V2DB.slice(at, V2DB.indexOf("\n}", at));
    expect(fn).toMatch(/FROM \\`identities\\`/);
    expect(fn).toMatch(/FROM \\`party_lines\\`/);
    expect(fn).toMatch(/FROM \\`conversations\\`/);
  });

  it("every NOT EXISTS guard in the file covers three tables, not two", () => {
    // Counted across the file so a FOURTH number table has to update both guards or
    // this fails — the same reason NUMBER_BEARING_COLUMNS is machine-checked.
    const ident = (V2DB.match(/NOT EXISTS \(SELECT 1 FROM \\`identities\\`/g) || []).length;
    const lines = (V2DB.match(/NOT EXISTS \(SELECT 1 FROM \\`party_lines\\`/g) || []).length;
    const convos = (V2DB.match(/NOT EXISTS \(SELECT 1 FROM \\`conversations\\`/g) || []).length;
    expect(ident).toBeGreaterThan(0);
    expect(lines).toBe(ident);
    expect(convos).toBe(ident);
  });
});

describe("the machine-checked registries", () => {
  it("conversations.number declares a strategy, and it is not-a-person", () => {
    // numberContinuity.test.ts FAILS THE BUILD until this exists. A group id must
    // never move because a MEMBER renumbered — the id belongs to the group.
    const entry = NUMBER_BEARING_COLUMNS.find(
      (c) => c.table === "conversations" && c.column === "number",
    );
    expect(entry).toBeDefined();
    expect(entry?.strategy).toBe("not-a-person");
  });

  it("the group id is NOT rewritten by a renumber", () => {
    // Strategy "renumber" columns are rewritten inside regenerateIdentityNumber's
    // transaction. A group id there would move when its creator changed their number.
    const renumber = NUMBER_BEARING_COLUMNS.filter((c) => c.strategy === "renumber").map(
      (c) => `${c.table}.${c.column}`,
    );
    expect(renumber).not.toContain("conversations.number");
    expect(codeOnly(V2DB)).not.toMatch(/update\(conversations\)[\s\S]{0,120}number: newNumber/);
  });

  it("conversations.ownerIdentityId declares a purge disposition", () => {
    // identityPurge.test.ts fails the build until it does.
    const entry = IDENTITY_REFERENCING_COLUMNS.find(
      (c) => c.table === "conversations" && c.column === "ownerIdentityId",
    );
    expect(entry).toBeDefined();
    // KEPT: a group survives while anyone remains, and nulling the creator would be a
    // silent ownership change the members are never told about.
    expect(entry?.strategy).toBe("keep-safer");
  });
});

describe("allocation is not lost, and not leaked", () => {
  it("createGroupConversation reserves BEFORE the transaction and releases on failure", () => {
    const at = V2DB.indexOf("export async function createGroupConversation");
    const fn = V2DB.slice(at, V2DB.indexOf("\nexport ", at + 10));
    const alloc = fn.indexOf("await allocateGroupNumber()");
    const tx = fn.indexOf("db.transaction");
    expect(alloc).toBeGreaterThan(0);
    expect(tx).toBeGreaterThan(alloc);
    // …and it is REACHED, not merely present before the transaction. A mutation that
    // moved the call into an unused closure kept the text in the right place and
    // survived, so the try block's body is pinned to the assignment itself.
    const tryAt = fn.indexOf("try {", 0);
    const body = fn.slice(tryAt + 5, fn.indexOf("} catch", tryAt)).trim();
    expect(body).toBe("number = await allocateGroupNumber();");
    // The row never landed, so the reservation is genuinely unbound — give it back
    // rather than leaking one of ~980,000 ids on every failed create.
    expect(fn).toMatch(/if \(number\) await releaseUnusedNumberReservation\(number\)/);
  });

  it("an exhausted allocator degrades to a group with NO id, never a failed create", () => {
    // A group is reached through its thread, so the id is not load-bearing for
    // reaching it — refusing to create the group would be the worse failure.
    const at = V2DB.indexOf("export async function createGroupConversation");
    const fn = V2DB.slice(at, V2DB.indexOf("db.transaction", at));
    expect(fn).toMatch(/} catch \{[\s\S]{0,400}number = null;/);
  });

  it("the columns are in the schema, the migrator, AND carry a unique index", () => {
    expect(SCHEMA).toMatch(/number: varchar\("number", \{ length: 6 \}\)/);
    expect(SCHEMA).toMatch(/conversations_number_unique/);
    for (const c of ["number", "avatarUrl", "profileStatus", "statusNote", "ownerIdentityId"]) {
      expect(V2DB, `migrator ${c}`).toMatch(new RegExp(`table: "conversations", column: "${c}"`));
    }
    // `conversations` predates this release, so CREATE TABLE never re-runs and the
    // index has to come from the additive migrator.
    expect(V2DB).toMatch(/ADD UNIQUE INDEX `conversations_number_unique`/);
  });
});

describe("editing a group", () => {
  const fn = () => {
    const at = V2DB.indexOf("export async function setGroupProfile");
    return V2DB.slice(at, V2DB.indexOf("\nexport interface ThreadSummary", at));
  };

  it("the permission check is INSIDE the function, not at the call site", () => {
    // It writes a row several people share, so "who may change it" is the safety
    // argument and must not be something a caller can forget.
    //
    // REWRITTEN in v2.104.0. This used to pin the INLINE membership SELECT
    // (`from(conversationParticipants)` … `if (!member)`), i.e. one particular
    // implementation of the rule. That check now lives in `checkGroupPermission`, the
    // single predicate every group write shares, so freezing the inline version would
    // have forbidden the consolidation while saying nothing about the property. The
    // property is that the gate runs inside this function and BEFORE anything is
    // written — which is what is asserted now.
    const body = fn();
    expect(body.length).toBeGreaterThan(300);
    expect(body).toMatch(/checkGroupPermission\(conversationId, identityId, "edit-profile"\)/);
    expect(body).toMatch(/if \(!gate\.ok\) return \{ ok: false/);
    // …and it precedes the only write, so it cannot be a decorative early line.
    expect(body.indexOf("checkGroupPermission")).toBeLessThan(body.indexOf(".update(conversations)"));
  });

  it("a DM is refused outright — it has no title, photo or status of its own", () => {
    // Also rewritten: the `kind !== "group"` refusal moved into the shared predicate
    // with the membership check, so it is asserted THERE — which is strictly better,
    // because every future group write inherits it instead of restating it.
    const gate = V2DB.slice(
      V2DB.indexOf("export async function checkGroupPermission"),
      V2DB.indexOf("export async function setGroupRole"),
    );
    expect(gate.length).toBeGreaterThan(400);
    expect(gate).toMatch(/if \(convo\.kind !== "group"\) return \{ ok: false, reason: "not-a-group" \}/);
    expect(gate).toMatch(/if \(!mine\) return \{ ok: false, reason: "not-a-member" \}/);
  });

  it("NO presence override is derived — a group has no presence", () => {
    // An identity's profileStatus derives statusOverride. A group's must not: there
    // is no presence for an availability to describe.
    //
    // codeOnly, because the function's OWN comment names statusOverride to say it is
    // not derived — and a bare not.toMatch matched that prose. Tenth time in this
    // repo, so it is worth saying again: assert against code, never against text.
    const body = codeOnly(fn());
    expect(body).not.toMatch(/overrideForStatus/);
    expect(body).not.toMatch(/statusOverride/);
  });

  it("the avatar is namespace-gated, so a group cannot point at a stranger's media", () => {
    /* v2.98.4/F2 and v2.99.26/H5 — the absolute-URL form is what H5 closed, so the key is
       taken after the LAST marker rather than tested as a prefix.

       v2.106.66 — this froze the gate's INLINE body inside `setGroupProfile`, so it broke
       the moment the rule was extracted, while saying nothing about the property. And the
       extraction is the point: `createGroup` now accepts an avatar too, and a rule with two
       homes is exactly how the second one comes to be written without it. Pinned as the
       property — ONE gate, correct in itself, applied by EVERY procedure that accepts an
       avatar, before the write. */
    const fn = ROUTERS.slice(
      ROUTERS.indexOf("function assertOwnedAvatarUrl("),
      ROUTERS.indexOf("export const v2MessagesRouter"),
    );
    expect(fn.length).toBeGreaterThan(200);
    expect(fn).toMatch(/lastIndexOf\(marker\)/);
    expect(fn).toMatch(/keyInOwnerNamespace\(key, identityId\)/);
    // A falsy url returns EARLY rather than being treated as a key, and a url with no
    // marker (a data: URL, an external CDN) is left alone — it never resolves through
    // our proxy, so gating it would refuse a legitimate avatar.
    expect(fn).toMatch(/if \(!avatarUrl\) return;/);
    expect(fn).toMatch(/if \(at < 0\) return;/);
    expect(codeOnly(fn)).not.toMatch(/if \((?:false|0)\)/);

    // EVERY procedure that takes an avatar applies it, and applies it BEFORE the write.
    for (const [proc, endAnchor, write] of [
      ["  setGroupProfile: publicProcedure", "  setGroupRole: publicProcedure", "await setGroupProfile("],
      ["  createGroup: publicProcedure", "  conversationInfo: publicProcedure", "await createGroupConversation("],
    ] as const) {
      const start = ROUTERS.indexOf(proc);
      expect(start, proc).toBeGreaterThan(-1);
      /* The end anchor must EXIST and must FOLLOW the start. A missing one used to fall
         back to end-of-file, so the slice silently swallowed every later procedure — the
         unbounded-slice fragility this repo has been bitten by repeatedly, and it was live
         here: `openThread` sits BEFORE `createGroup`, so that arm was reading to EOF. */
      const end = ROUTERS.indexOf(endAnchor, start);
      expect(end, `${proc}: end anchor must follow it`).toBeGreaterThan(start);
      const body = ROUTERS.slice(start, end);
      expect(body, `${proc} accepts an avatar`).toMatch(/avatarUrl: z\.string\(\)/);
      const gate = body.indexOf("assertOwnedAvatarUrl(");
      expect(gate, `${proc} must apply the gate`).toBeGreaterThan(-1);
      const at = body.indexOf(write);
      expect(at, `${proc}: write anchor`).toBeGreaterThan(-1);
      expect(gate, `${proc}: gate before the write`).toBeLessThan(at);
    }
  });

  it("the picked avatar SURVIVES every hop, which is the bug that was reported", () => {
    /* Owner, verbatim: *"there is a problem with the avatar of the group when you created
       you select avatar by default, it comes with default avatar, but if you select
       another avatar doesn't appear."*

       THE DEFECT WAS A SILENT DROP, not a broken control, and that is why it needs its own
       pin: a plain `z.object` STRIPS unknown keys rather than rejecting them, so a client
       sending an avatar got a clean success and a group born with a NULL photo. Nothing
       anywhere said no.

       Written after the mutation run, which found this gap in my own tests: gating the
       avatar and ORDERING the gate were both pinned, and the value could still be thrown
       away at THREE separate layers with every assertion green — the router dropping it
       before the helper, the helper dropping it before the INSERT, or the sheet never
       sending it. Each is indistinguishable from the original report. So the chain is
       asserted hop by hop rather than end to end, because a break in any single link
       reproduces the bug exactly. */
    // 1. the sheet mounts a picker, and its choice is held in state
    expect(MESSAGES).toMatch(/<AvatarPicker/);
    expect(MESSAGES).toMatch(/onSave=\{async \(url\) => setGroupAvatar\(url\)\}/);
    // 2. …and that state reaches the mutation, rather than the picker being decoration
    expect(MESSAGES).toMatch(/createGroup\.mutate\(\{[\s\S]{0,200}?avatarUrl: groupAvatar,/);
    // 3. the router forwards it to the helper (dropping it here IS the reported bug)
    const cgAt = ROUTERS.indexOf("  createGroup: publicProcedure");
    const proc = ROUTERS.slice(cgAt, ROUTERS.indexOf("  conversationInfo: publicProcedure", cgAt));
    expect(proc.length).toBeGreaterThan(400);
    expect(proc).toMatch(/createGroupConversation\(\{[\s\S]{0,300}?avatarUrl: input\.avatarUrl \?\? null,/);
    // 4. …and the helper actually writes the column
    const fn = V2DB.slice(
      V2DB.indexOf("export async function createGroupConversation("),
      V2DB.indexOf("export async function", V2DB.indexOf("export async function createGroupConversation(") + 10),
    );
    expect(fn.length).toBeGreaterThan(400);
    expect(fn).toMatch(/avatarUrl\?: string \| null;/); // optional ⇒ old callers unchanged
    expect(fn).toMatch(/avatarUrl: input\.avatarUrl \?\? null,/);
    // `?? null` and never `|| null`: they agree for every value the schema admits, but the
    // nullish form is the one that cannot swallow a future falsy-but-meaningful value.
    expect(fn).not.toMatch(/avatarUrl: input\.avatarUrl \|\| null/);
  });

  it("every refusal is NAMED, because each needs a different next step", () => {
    const proc = ROUTERS.slice(
      ROUTERS.indexOf("  setGroupProfile: publicProcedure"),
      ROUTERS.indexOf("  createGroup: publicProcedure"),
    );
    for (const r of ["not-found", "not-a-group", "not-a-member", "unavailable"]) {
      expect(proc, r).toMatch(new RegExp(r));
    }
    expect(proc).toMatch(/Only members can change a group/);
  });

  it("the status vocabulary is the SHARED one, not a second copy", () => {
    const proc = ROUTERS.slice(ROUTERS.indexOf("  setGroupProfile: publicProcedure"));
    expect(proc.slice(0, 1200)).toMatch(/z\.enum\(\["", \.\.\.PROFILE_STATUSES\]\)/);
    expect(V2DB).toMatch(/set\.profileStatus = normalizeProfileStatus\(patch\.profileStatus\)/);
  });
});

describe("what the group's own identity looks like on screen", () => {
  it("the wire names the fields group*, never reusing peer*", () => {
    // One field meaning two things is how a surface comes to render a group's id as a
    // person's — and a group is not a peer.
    for (const f of ["groupNumber", "groupAvatarUrl", "groupStatus", "groupStatusNote"]) {
      expect(ROUTERS, `wire ${f}`).toMatch(new RegExp(`${f}: b\\.${f}`));
    }
  });

  it("a DM can never carry a group's id — the base projection is null", () => {
    const at = V2DB.indexOf("groupNumber: null as string | null");
    expect(at).toBeGreaterThan(0);
    // Set only in the group branch.
    expect(V2DB).toMatch(/groupNumber: convo\.number \?\? null/);
  });

  it("a group is findable by its OWN id, not just its title", () => {
    /* 2026-08-01 REWRITTEN TO THE PROPERTY. It froze the exact ONE-LINE argument list,
       so it broke when a fifth field (the name YOU saved the peer under) joined it —
       while saying nothing about the rule: a group is findable by its own 6-digit id. */
    const at = MESSAGES.indexOf("matchQuery(threadSearch, [");
    expect(at, "the thread search is gone").toBeGreaterThan(-1);
    const args = MESSAGES.slice(at, MESSAGES.indexOf("])", at));
    expect(args.length).toBeGreaterThan(30);
    expect(args).toContain("t.groupNumber");
    expect(args).toContain("t.title");
  });

  it("the row shows the group's id in the same place a person's sits", () => {
    expect(MESSAGES).toMatch(/const ownNumber = isGroup \? t\.groupNumber : isDm \? t\.peerNumber : null;/);
    // Notes-to-self stays blank, because that is me.
    expect(MESSAGES).toMatch(/isDm \? t\.peerNumber : null/);
  });

  it("a group photo that fails to load degrades to the glyph", () => {
    // Never the browser's broken-image icon — the same rule PeerAvatar follows.
    expect(MESSAGES).toMatch(/t\.groupAvatarUrl \? \(/);
    expect(MESSAGES).toMatch(/onError=\{\(e\) => \{[\s\S]{0,120}display = "none"/);
  });

  it("the header shows the group's id and its status, and NO tier badge", () => {
    // A tier describes a person's account; a group has none.
    expect(MESSAGES).toMatch(/isGroup && thread\?\.groupNumber && \/\^\\d\{6\}\$\/\.test\(thread\.groupNumber\)/);
    expect(MESSAGES).toMatch(/\{thread && !isGroup && \(\s*\n\s*<RoleBadge/);
  });

  it("the status string comes from the SHARED formatter", () => {
    // So the header and any later surface cannot phrase one status two ways.
    expect(MESSAGES).toMatch(/describeProfileStatus\(thread\?\.groupStatus, thread\?\.groupStatusNote\)/);
    expect(MESSAGES).toMatch(/import \{ describeProfileStatus \} from "@shared\/profileStatus"/);
  });

  it("the Groups section already existed and still does", () => {
    // Confirmed rather than rebuilt: the owner asked for a groups section and
    // Messages has had one. This pins it so the rename/rework did not lose it.
    //
    // v2.106.64 — the LABEL moved from "Groups" to "Group chats" and the section is now
    // built only in the groups scope, because the tab itself says Groups and the section
    // beside it says Group calls; the old pin froze the label AND its position in a
    // both-scopes array, so it forbade that while saying nothing about the property.
    // The property is that a section exists whose rows are the non-archived groups.
    expect(MESSAGES).toMatch(/key: "groups",/);
    expect(MESSAGES).toMatch(/rows: list\.filter\(\(t\) => t\.kind === "group" && !t\.archived\)/);
    // …and that it is the GROUPS tab that renders it, so "the group section" is a real
    // place rather than a heading that could appear anywhere.
    expect(MESSAGES).toMatch(/only === "groups"\s*\n?\s*\?\s*\[/);
  });
});
