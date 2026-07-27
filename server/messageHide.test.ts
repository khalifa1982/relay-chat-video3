/**
 * v2.102.2 — "delete for me": hide ONE message for ONE person.
 *
 * Owner (#81): a way to remove a message somebody ELSE sent, for you alone.
 *
 * THE DISTINCTION FROM UNSEND IS THE WHOLE FEATURE, and it is the thing most easily
 * got wrong: `deleteMessage` flips `messages.deletedAt`, which takes a message away
 * from EVERYBODY and is rightly restricted to its own sender. This takes it away from
 * the caller and changes nothing for anybody else — which is exactly why it is allowed
 * on a message the caller did not send.
 *
 * WHY IT IS SERVER-SIDE AT ALL: a browser-only version would be a lie. The message
 * would come back on that person's other phone, and "deleted" that undeletes itself is
 * worse than no feature.
 *
 * THE PERFORMANCE DECISION IS LOAD-BEARING. Four reads had to learn the rule, and one
 * of them — the thread list's groupwise-max — is polled by every client every few
 * seconds. Pushing the exclusion inside that aggregate would defeat its loose index
 * scan for the whole fleet to serve a feature almost nobody has used, so that query is
 * left untouched and the hidden case is handled after it. These tests pin the fast path
 * as firmly as the correctness.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { IDENTITY_REFERENCING_COLUMNS } from "./purgeIdentity";

const ROOT = path.resolve(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const V2DB = read("server/v2db.ts");
const ROUTERS = read("server/v2routers.ts");
const SCHEMA = read("drizzle/schema.ts");
const MESSAGES = read("client/src/pages/app/Messages.tsx");
const PURGE = read("server/purgeIdentity.ts");

/** Block comments first, then line comments — see v2.102.1: a JSX-span-first strip
 *  eats a documented prop type and guts the source being asserted on. */
const codeOnly = (s: string) =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !/^\s*\/\//.test(l))
    .join("\n");

/** `fn(name)` → that function's source, bounded by the NEXT top-level export so it can
 *  never run past its own end (the recurring unbounded-slice fragility). */
function fn(src: string, name: string): string {
  const i = src.indexOf(`export async function ${name}`);
  const j = src.indexOf("\nexport ", i + 10);
  const out = src.slice(i, j === -1 ? undefined : j);
  expect(out.length, `${name} not found or empty`).toBeGreaterThan(120);
  return out;
}

describe("it is NOT unsend, and the two stay distinct", () => {
  it("hiding writes its own table and never touches messages.deletedAt", () => {
    const hide = fn(V2DB, "hideMessageForIdentity");
    expect(hide).toMatch(/\.insert\(messageHides\)/);
    // Setting deletedAt here would remove the message for everybody — the exact
    // confusion this feature has to avoid.
    expect(codeOnly(hide)).not.toMatch(/deletedAt: new Date\(\)/);
    expect(codeOnly(hide)).not.toMatch(/\.update\(messages\)/);
  });

  it("unsend is still sender-only, and hiding is deliberately NOT", () => {
    // If hiding were restricted to your own messages it would answer a different
    // question from the one the owner asked.
    expect(fn(V2DB, "deleteMessage")).toMatch(/eq\(messages\.senderIdentityId, input\.identityId\)/);
    expect(codeOnly(fn(V2DB, "hideMessageForIdentity"))).not.toMatch(/senderIdentityId/);
  });

  it("the two have SEPARATE confirmations, and the copy names who is affected", () => {
    // One dialog for both would have to describe two different blast radii, which is
    // how somebody unsends a message for everyone believing they hid it for themselves.
    expect(MESSAGES).toMatch(/Unsend this message\?/);
    expect(MESSAGES).toMatch(/Delete this message for you\?/);
    expect(MESSAGES).toMatch(/removed for everyone in this conversation/);
    expect(MESSAGES).toMatch(/Everyone else keeps\s*\n?\s*it/);
  });
});

describe("every read applies the rule, through ONE predicate", () => {
  it("the predicate exists once and is exported, so no surface hand-rolls it", () => {
    expect((V2DB.match(/export function notHiddenFor/g) || []).length).toBe(1);
    // A NOT EXISTS against the (identityId, messageId) primary key — an antijoin
    // lookup, not a scan.
    const p = V2DB.slice(V2DB.indexOf("export function notHiddenFor"));
    expect(p.slice(0, 400)).toMatch(/NOT EXISTS/);
    expect(p.slice(0, 400)).toMatch(/mh\.\\`messageId\\` = \$\{messages\.id\}/);
    expect(p.slice(0, 400)).toMatch(/mh\.\\`identityId\\` = \$\{identityId\}/);
  });

  it("reading a conversation excludes what the READER hid — not the sender", () => {
    // Keyed on the caller. Keyed on anyone else it would either leak nothing or hide
    // other people's messages from them, both wrong.
    expect(fn(V2DB, "listMessages")).toMatch(/notHiddenFor\(input\.identityId\)/);
  });

  it("search cannot bring a hidden message back", () => {
    // The most likely place to forget: a hidden message that reappears under search is
    // the feature silently not working.
    expect(fn(V2DB, "searchMessages")).toMatch(/notHiddenFor\(input\.identityId\)/);
  });

  it("the unread recompute excludes them too", () => {
    // Otherwise the badge counts a message this person can no longer open, which is a
    // badge that cannot be cleared.
    expect(fn(V2DB, "recomputeUnreadFor")).toMatch(/notHiddenFor\(identityId\)/);
  });

  it("the thread PREVIEW resolves to the next visible message", () => {
    const lt = fn(V2DB, "listThreads");
    expect(lt).toMatch(/inArray\(messageHides\.messageId, latestIds\)/);
    expect(lt).toMatch(/notHiddenFor\(identityId\)/);
    expect(lt).toMatch(/latestByConvo\.set\(convoId, next\)/);
    // No visible message left ⇒ no preview, and the thread STAYS. Deleting the thread
    // would hide a conversation other people are still in.
    expect(lt).toMatch(/else latestByConvo\.delete\(convoId\)/);
  });
});

describe("the hot query keeps its fast path", () => {
  it("the groupwise-max aggregate is NOT given an antijoin", () => {
    const lt = fn(V2DB, "listThreads");
    const agg = lt.slice(lt.indexOf("const maxIdRows"), lt.indexOf("const latestIds"));
    expect(agg.length).toBeGreaterThan(120);
    // THE POINT OF THE WHOLE DESIGN. This aggregate is a loose index scan polled by
    // every client; an exclusion inside it costs every user in the fleet.
    expect(agg).toMatch(/MAX\(\$\{messages\.id\}\)/);
    expect(codeOnly(agg)).not.toMatch(/notHiddenFor|messageHides/);
  });

  it("the hidden check is ONE lookup over the winning ids, not a per-thread query", () => {
    const lt = fn(V2DB, "listThreads");
    const probe = lt.slice(lt.indexOf("if (latestIds.length > 0) {"), lt.indexOf("if (hidden.length > 0)"));
    expect(probe.length).toBeGreaterThan(120);
    // A primary-key range scan bounded to the ids already in hand.
    expect(probe).toMatch(/eq\(messageHides\.identityId, identityId\)/);
    expect(probe).toMatch(/inArray\(messageHides\.messageId, latestIds\)/);
  });

  it("the expensive fallback runs ONLY for conversations whose winner is hidden", () => {
    const lt = fn(V2DB, "listThreads");
    // Guarded twice: nothing hidden at all ⇒ no loop; and inside the loop, a
    // conversation whose winner is visible is skipped before any query.
    expect(lt).toMatch(/if \(hidden\.length > 0\) \{/);
    expect(lt).toMatch(/if \(!hiddenIds\.has\(m\.id\)\) continue;/);
    // With no hides the added cost is the single lookup above and nothing more.
    const guard = lt.indexOf("if (hidden.length > 0) {");
    const fallback = lt.indexOf("orderBy(desc(messages.id))", guard);
    expect(guard).toBeGreaterThan(0);
    expect(fallback).toBeGreaterThan(guard);
  });
});

describe("the write is claimed, scoped and idempotent", () => {
  it("membership is checked BEFORE the row is written", () => {
    // A message id is a small integer, so without this anybody could write a row
    // naming any message in the database.
    const hide = fn(V2DB, "hideMessageForIdentity");
    const check = hide.indexOf("getConversationParticipantIds");
    const write = hide.indexOf(".insert(messageHides)");
    expect(check).toBeGreaterThan(0);
    expect(write).toBeGreaterThan(check);
    expect(hide).toMatch(/if \(!members\.includes\(input\.identityId\)\) return \{ ok: false, reason: "not-a-member" \}/);
  });

  it("THE INSERT IS THE ATOMIC CLAIM, so a retry cannot adjust the count twice", () => {
    // The defect v2.99.57 found in deleteMessage: two concurrent requests both passed a
    // read-then-write check and both moved a STORED counter. Here affectedRows from the
    // ON DUPLICATE KEY insert decides, so only the first hide proceeds.
    const hide = fn(V2DB, "hideMessageForIdentity");
    expect(hide).toMatch(/onDuplicateKeyUpdate/);
    expect(hide).toMatch(/affectedRows.*\?\? 0\) > 0/);
    const claimed = hide.indexOf("const claimed");
    const recompute = hide.indexOf("recomputeUnreadFor");
    expect(claimed).toBeGreaterThan(0);
    expect(recompute).toBeGreaterThan(claimed);
    // An already-hidden message SUCCEEDS without touching the counter, so the endpoint
    // is idempotent rather than an error the UI has to explain.
    expect(hide).toMatch(/if \(!claimed\) return \{ ok: true \}/);
  });

  it("the unread count is RECOMPUTED, never decremented", () => {
    // A decrement is not idempotent and a retry drives a stored counter negative
    // (v2.99.74). Recomputing also heals any pre-existing drift for this participant.
    const hide = fn(V2DB, "hideMessageForIdentity");
    expect(codeOnly(hide)).not.toMatch(/unreadCount.*-\s*1/);
    expect(hide).toMatch(/recomputeUnreadFor\(row\.conversationId, input\.identityId\)/);
    const rc = fn(V2DB, "recomputeUnreadFor");
    expect(rc).toMatch(/COUNT\(\*\)/);
    // Scoped to ONE participant's row on the UPDATE specifically. A bare toMatch was
    // satisfied by the SELECT's own copy of the same clause, so stripping it from the
    // WRITE passed — and an unscoped UPDATE rewrites EVERY member's badge in the
    // conversation to this person's count (caught by mutation).
    const upd = rc.slice(rc.indexOf(".update(conversationParticipants)"));
    expect(upd.length).toBeGreaterThan(120);
    expect(upd).toMatch(/eq\(conversationParticipants\.conversationId, conversationId\)/);
    expect(upd).toMatch(/eq\(conversationParticipants\.identityId, identityId\)/);
    // Both clauses appear twice in the function — once to read the watermark, once to
    // write — so a missing one on either side is caught rather than masked.
    expect((rc.match(/eq\(conversationParticipants\.identityId, identityId\)/g) || []).length).toBe(2);
    // Derived from the read watermark, this person's own messages excluded.
    expect(rc).toMatch(/gt\(messages\.id, after\)/);
    expect(rc).toMatch(/ne\(messages\.senderIdentityId, identityId\)/);
    expect(rc).toMatch(/isNull\(messages\.deletedAt\)/);
  });

  it("the endpoint resolves the caller itself and is no existence oracle", () => {
    const proc = ROUTERS.slice(ROUTERS.indexOf("  hide: publicProcedure"), ROUTERS.indexOf("  setGroupProfile: publicProcedure"));
    expect(proc.length).toBeGreaterThan(300);
    expect(proc).toMatch(/const me = requireIdentity\(ctx\)/);
    expect(proc).toMatch(/identityId: me\.id/);
    // "not a member" and "no such message" answer IDENTICALLY, so probing ids reveals
    // nothing about which conversations exist or who is in them.
    expect(proc).toMatch(/res\.reason === "not-a-member" \|\| res\.reason === "not-found"/);
    expect((proc.match(/That message is no longer there\./g) || []).length).toBe(1);
  });
});

describe("the schema and the purge cascade", () => {
  it("the table is keyed (identityId, messageId) — the order every read uses", () => {
    const t = SCHEMA.slice(SCHEMA.indexOf("export const messageHides"), SCHEMA.indexOf("export const messages ="));
    expect(t.length).toBeGreaterThan(200);
    expect(t).toMatch(/primaryKey\(\{ columns: \[t\.identityId, t\.messageId\] \}\)/);
    // The reverse direction needs its own index or clearing a message's hides is a scan.
    expect(t).toMatch(/index\("message_hides_message_idx"\)\.on\(t\.messageId\)/);
  });

  it("the migrator creates it guarded, and additively", () => {
    const m = V2DB.slice(V2DB.indexOf('name: "message_hides"'));
    expect(m.slice(0, 600)).toMatch(/CREATE TABLE IF NOT EXISTS/);
    expect(m.slice(0, 600)).toMatch(/PRIMARY KEY \(\\`identityId\\`, \\`messageId\\`\)/);
  });

  it("the purge declares it as a CASCADE, and really deletes it", () => {
    // The machine-checked registry named this column the moment it existed, which is
    // the point of having it — this entry was not optional.
    const e = IDENTITY_REFERENCING_COLUMNS.find(
      (c) => c.table === "message_hides" && c.column === "identityId",
    );
    expect(e, "message_hides.identityId must be declared").toBeTruthy();
    expect(e!.strategy).toBe("cascade");
    // Declaring a cascade and not performing it would leave rows naming a deleted
    // identity — the registry would read as covered while nothing happened.
    expect(PURGE).toMatch(/\.delete\(messageHides\)\.where\(eq\(messageHides\.identityId, identityId\)\)/);
  });
});

describe("the client", () => {
  it("the menu offers it on ANYBODY's message, and unsend stays ours-only", () => {
    expect(MESSAGES).toMatch(/onHide\?: \(\) => void;/);
    expect(MESSAGES).toMatch(/\{onHide && \(/);
    // Unsend keeps its `mine &&` guard; hiding deliberately has none.
    expect(MESSAGES).toMatch(/\{mine && onDelete && \(/);
    // Both call sites pass it — the own-message one and the received one.
    expect((MESSAGES.match(/onHide=\{\(\) => setHidingId\(m\.id\)\}/g) || []).length).toBe(2);
  });

  it("it is optimistic WITH restore, the same shape unsend uses", () => {
    // A hide that stayed on screen until the next poll reads as a control that did
    // nothing; a failed one must put the message back rather than vanishing something
    // that still exists for everybody.
    const mut = MESSAGES.slice(MESSAGES.indexOf("const hideMutation"), MESSAGES.indexOf('// "I\'m typing" ping'));
    expect(mut.length).toBeGreaterThan(400);
    expect(mut).toMatch(/onMutate: async \(\{ messageId \}\)/);
    expect(mut).toMatch(/utils\.messages\.list\.setData\(input, \(old\) =>/);
    expect(mut).toMatch(/if \(context\?\.prev\) utils\.messages\.list\.setData\(context\.input, context\.prev\)/);
    expect(mut).toMatch(/onError:/);
  });

  it("the thread LIST is refreshed too, not only the open thread", () => {
    // Hiding the newest message changes the preview and can change the badge, so
    // refreshing one would leave the other describing a message that is now invisible
    // (the v2.99.87 defect).
    const mut = MESSAGES.slice(MESSAGES.indexOf("const hideMutation"), MESSAGES.indexOf('// "I\'m typing" ping'));
    expect(mut).toMatch(/utils\.messages\.list\.invalidate\(\{ conversationId \}\)/);
    expect(mut).toMatch(/utils\.messages\.threads\.invalidate\(\)/);
  });
});
