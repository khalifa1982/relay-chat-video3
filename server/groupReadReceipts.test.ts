/**
 * v2.107.35 — PER-POST GROUP READ RECEIPTS.
 *
 * Owner: *"in the group, when someone posts something, the post owner and
 * admins can see who read it and what time for each post."*
 *
 * The design in one paragraph, so the pins below read as consequences rather
 * than trivia. A receipt row (message, reader, time) is written INSIDE
 * `markThreadRead`'s existing transaction, bounded to the (prevRead, lastId]
 * delta that very call produced — so a receipt can never exist without the
 * watermark advance that reports it, re-opening a chat re-inserts nothing, and
 * the unique key absorbs any raced double-call. Group conversations only: a
 * DM's reader is never in question and its info panel already shows `readAt`.
 * The audience is enforced where the data lives (`listMessageReads`): the
 * post's AUTHOR, the group's CREATOR, or a stored ADMIN — everyone else gets
 * FORBIDDEN, because a member must not be able to audit who has seen somebody
 * else's message. The client mounts the panel section behind the same rule,
 * which therefore only decides what to OFFER, never what is allowed.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const V2DB = read("server/v2db.ts");
const ROUTERS = read("server/v2routers.ts");
const SCHEMA = read("drizzle/schema.ts");
const MESSAGES = read("client/src/pages/app/Messages.tsx");
const DICT = read("client/src/app/dict/messages.ts");

/** EXACT-name function slice (the swipeActions locator, same trap avoided). */
function fn(src: string, name: string): string {
  const at = src.indexOf(`export async function ${name}(`);
  expect(at, `${name} must exist`).toBeGreaterThan(-1);
  const next = src.indexOf("\nexport ", at + 1);
  return src.slice(at, next === -1 ? undefined : next);
}

describe("the table exists in both places a table must exist", () => {
  it("drizzle schema: one receipt per (message, reader), enforced by key", () => {
    expect(SCHEMA).toMatch(/export const messageReads = mysqlTable\(\s*"message_reads"/);
    expect(SCHEMA).toMatch(/uniqueIndex\("msg_reads_unique"\)\.on\(t\.messageId, t\.readerId\)/);
  });

  it("boot DDL: CREATE TABLE IF NOT EXISTS with the same unique key", () => {
    // The prod database learns about new tables at boot, not from drizzle-kit —
    // the message_attachments precedent this entry sits beside.
    expect(V2DB).toMatch(/name: "message_reads"/);
    expect(V2DB).toMatch(/CREATE TABLE IF NOT EXISTS \\`message_reads\\`/);
    expect(V2DB).toMatch(/UNIQUE KEY \\`msg_reads_unique\\` \(\\`messageId\\`, \\`readerId\\`\)/);
  });
});

describe("recording: inside the read transaction, delta-bounded, group-only", () => {
  const w = fn(V2DB, "markThreadRead");

  it("the OLD watermark is read in the same statement that proves membership", () => {
    expect(w).toMatch(/lastReadMessageId: conversationParticipants\.lastReadMessageId,/);
    expect(w).toMatch(/const prevRead = membership\[0\]\?\.lastReadMessageId \?\? 0;/);
  });

  it("gated on the conversation being a GROUP and the watermark actually moving", () => {
    expect(w).toMatch(/convoRow\?\.kind === "group" && lastId > prevRead/);
  });

  it("exactly the newly-read window: (prevRead, lastId], visible, not my own", () => {
    // gt/lte are what make a re-open insert NOTHING — idempotence by bounds,
    // with the unique key as the belt to this suspenders.
    expect(w).toMatch(/gt\(messages\.id, prevRead\)/);
    expect(w).toMatch(/lte\(messages\.id, lastId\)/);
    expect(w).toMatch(/senderIdentityId\} <> \$\{input\.identityId\}/);
    expect(w).toMatch(/isNull\(messages\.deletedAt\)/);
  });

  it("bounded and race-proof: newest-500 cap, duplicate-key no-op, via the SAME tx", () => {
    expect(w).toMatch(/\.limit\(500\);/);
    expect(w).toMatch(/tx\s*\n\s*\.insert\(messageReads\)/);
    expect(w).toMatch(/\.onDuplicateKeyUpdate\(\{ set: \{ readerId: sql`\$\{messageReads\.readerId\}` \} \}\)/);
  });
});

describe("reading: the audience rule lives with the data", () => {
  const r = fn(V2DB, "listMessageReads");

  it("author, creator, or stored admin — nobody else", () => {
    expect(r).toMatch(/msg\.senderIdentityId === input\.viewerId \|\| convo\.ownerIdentityId === input\.viewerId/);
    expect(r).toMatch(/allowed = mine\?\.groupRole === "admin";/);
    expect(r).toMatch(/if \(!allowed\) return \{ ok: false, reason: "not-allowed" \};/);
  });

  it("groups only, and an unsent post revokes its audit trail with its content", () => {
    expect(r).toMatch(/convo\.kind !== "group"/);
    expect(r).toMatch(/if \(msg\.deletedAt\) return \{ ok: false, reason: "gone" \};/);
  });

  it("readers come back oldest-first with the exact time", () => {
    expect(r).toMatch(/\.orderBy\(messageReads\.readAt\);/);
    expect(r).toMatch(/readAt: messageReads\.readAt,/);
  });

  it("the router maps not-allowed to FORBIDDEN behind requireIdentity", () => {
    const at = ROUTERS.indexOf("readsFor: publicProcedure");
    expect(at).toBeGreaterThan(-1);
    const proc = ROUTERS.slice(at, ROUTERS.indexOf("}),", at));
    expect(proc).toMatch(/requireIdentity\(ctx\)/);
    expect(proc).toMatch(/listMessageReads\(\{ messageId: input\.messageId, viewerId: me\.id \}\)/);
    expect(proc).toMatch(/code: "FORBIDDEN"/);
  });
});

describe("the panel: offered to the owner's audience, honest in every state", () => {
  it("mounted in the info dialog for groups, for the author or an admin", () => {
    expect(MESSAGES).toMatch(
      /\{isGroup && \(iSent \|\| iAmGroupAdmin\) && <GroupReadBy messageId=\{m\.id\} \/>\}/,
    );
  });

  it("a failed fetch shows a dash, NEVER a fake empty list", () => {
    // "No one has read this yet" on a network error would be a lie about the
    // one thing this panel exists to report. The error branch must therefore
    // come BEFORE the empty branch.
    const comp = MESSAGES.slice(
      MESSAGES.indexOf("function GroupReadBy"),
      MESSAGES.indexOf("\n}\n", MESSAGES.indexOf("function GroupReadBy")),
    );
    const errAt = comp.indexOf("q.isError");
    const emptyAt = comp.indexOf("q.data.length === 0");
    expect(errAt).toBeGreaterThan(-1);
    expect(emptyAt).toBeGreaterThan(errAt);
    expect(comp).toMatch(/formatExact\(r\.readAt\)/);
    expect(comp).toMatch(/r\.displayName \|\| r\.number/);
  });

  it("both strings exist in both languages", () => {
    expect(DICT).toMatch(/"msg\.readBy": \{ en: "Read by", ar: "قرأها" \}/);
    expect(DICT).toMatch(/"msg\.readByNone": \{ en: "No one has read this yet", ar: "لم يقرأها أحد بعد" \}/);
  });
});
