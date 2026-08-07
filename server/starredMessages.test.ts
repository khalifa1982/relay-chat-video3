/**
 * STARRED MESSAGES (QW-3, v2.107.53) — private per-user message bookmarks.
 * docs/feature-roadmap.md.
 *
 * A star is (identityId, messageId) in message_stars. The security property that
 * matters is that a leaked messageId cannot be used to pin — or, via the Starred
 * view, exfiltrate — a message from a conversation the caller was never in. So the
 * pins below dwell on the MEMBERSHIP GATE, not just the happy path.
 *
 * House style: source-string pins over codeOnly()-stripped source, so an assertion
 * can never pass on a COMMENT that merely describes the behaviour.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { codeOnly } from "./testing/codeOnly";

const read = (rel: string) => readFileSync(join(__dirname, rel), "utf8");
const db = codeOnly(read("./v2db.ts"));
const routers = codeOnly(read("./v2routers.ts"));
const mount = codeOnly(read("./routers.ts"));
const messages = codeOnly(read("../client/src/pages/app/Messages.tsx"));
const msgDict = read("../client/src/app/dict/messages.ts");
const coreDict = read("../client/src/app/dict/core.ts");

/* ─────────────────────────── schema ─────────────────────────── */

describe("QW-3 — message_stars schema", () => {
  it("creates message_stars idempotently, as a per-user join not a message column", () => {
    expect(db).toMatch(/CREATE TABLE IF NOT EXISTS \\`message_stars\\`/);
    // The pair is the primary key — that is what makes star/unstar idempotent and
    // blocks a double-star by construction.
    expect(db).toMatch(/PRIMARY KEY \(\\`identityId\\`, \\`messageId\\`\)/);
  });

  it("indexes by (identityId, starredAt) so the Starred view reads newest-first cheaply", () => {
    expect(db).toMatch(/KEY \\`star_identity_time_idx\\` \(\\`identityId\\`, \\`starredAt\\`\)/);
  });

  it("lands in the additive tableCreates array, never as a destructive migration", () => {
    // It must sit in the CREATE TABLE IF NOT EXISTS list, i.e. after content_reports
    // which is the block immediately before it.
    const idxReports = db.indexOf('name: "content_reports"');
    const idxStars = db.indexOf('name: "message_stars"');
    expect(idxReports).toBeGreaterThan(0);
    expect(idxStars).toBeGreaterThan(idxReports);
  });
});

/* ─────────────────────────── db helpers ─────────────────────────── */

describe("QW-3 — star db helpers", () => {
  it("starMessage is MEMBERSHIP-GATED — a leaked id can't pin across rooms", () => {
    const start = db.indexOf("export async function starMessage");
    const end = db.indexOf("export async function unstarMessage", start);
    const block = db.slice(start, end);
    expect(start).toBeGreaterThan(0);
    // The gate joins messages to conversation_participants on the caller's identity
    // before the INSERT, and bails when the caller isn't a member.
    expect(block).toMatch(/JOIN \\`conversation_participants\\` p/);
    expect(block).toMatch(/p\.\\`identityId\\` = \$\{identityId\}/);
    expect(block).toMatch(/if \(!allowed\) return \{ ok: false \}/);
    // Idempotent insert.
    expect(block).toMatch(/ON DUPLICATE KEY UPDATE \\`starredAt\\` = \\`starredAt\\`/);
  });

  it("unstarMessage is PK-scoped to the caller's own row and idempotent", () => {
    const start = db.indexOf("export async function unstarMessage");
    const end = db.indexOf("export async function listStarredIdsInConversation", start);
    const block = db.slice(start, end);
    expect(block).toMatch(/DELETE FROM \\`message_stars\\`/);
    expect(block).toMatch(/\\`identityId\\` = \$\{identityId\} AND \\`messageId\\` = \$\{messageId\}/);
  });

  it("listStarredMessages RE-CHECKS membership so stars from left rooms drop out", () => {
    const start = db.indexOf("export async function listStarredMessages");
    const block = db.slice(start, start + 1200);
    expect(start).toBeGreaterThan(0);
    // Membership re-joined here too — a star left over from a conversation the person
    // has since left must not leak its body into the Starred view.
    expect(block).toMatch(/JOIN \\`conversation_participants\\` p/);
    expect(block).toMatch(/ORDER BY s\.\\`starredAt\\` DESC/);
    // Bounded.
    expect(block).toMatch(/LIMIT \$\{capped\}/);
  });

  it("listStarredIdsInConversation stays scoped to one conversation and excludes deleted", () => {
    const start = db.indexOf("export async function listStarredIdsInConversation");
    const end = db.indexOf("export interface StarredMessage", start);
    const block = db.slice(start, end);
    expect(block).toMatch(/m\.\\`conversationId\\` = \$\{conversationId\}/);
    expect(block).toMatch(/m\.\\`deletedAt\\` IS NULL/);
  });
});

/* ─────────────────────────── trpc procedures ─────────────────────────── */

describe("QW-3 — star procedures", () => {
  it("setMessageStar / starred queries live under trpc.identity (auth router)", () => {
    expect(mount).toMatch(/identity: v2AuthRouter/);
    expect(routers).toMatch(/setMessageStar: publicProcedure/);
    expect(routers).toMatch(/starredIdsInConversation: publicProcedure/);
    expect(routers).toMatch(/starredMessages: publicProcedure/);
    // All three must sit in v2AuthRouter, i.e. before the admin router opens.
    const idxSet = routers.indexOf("setMessageStar: publicProcedure");
    const idxAdmin = routers.indexOf("export const v2AdminRouter");
    expect(idxSet).toBeGreaterThan(0);
    expect(idxSet).toBeLessThan(idxAdmin);
  });

  it("setMessageStar takes the identity from requireIdentity, never a client id", () => {
    const start = routers.indexOf("setMessageStar: publicProcedure");
    const end = routers.indexOf("starredIdsInConversation: publicProcedure", start);
    const block = routers.slice(start, end);
    expect(block).toMatch(/const me = requireIdentity\(ctx\)/);
    expect(block).toMatch(/starMessage\(me\.id, input\.messageId\)/);
    expect(block).toMatch(/unstarMessage\(me\.id, input\.messageId\)/);
    // No identityId input on this proc by construction.
    expect(block).not.toMatch(/input\.identityId/);
  });

  it("setMessageStar surfaces the gate failure rather than pretending it starred", () => {
    const start = routers.indexOf("setMessageStar: publicProcedure");
    const end = routers.indexOf("starredIdsInConversation: publicProcedure", start);
    const block = routers.slice(start, end);
    // star returns !ok when the message isn't the caller's to see → BAD_REQUEST.
    expect(block).toMatch(/if \(!res\.ok\)/);
    expect(block).toMatch(/code: "BAD_REQUEST"/);
  });

  it("the starredMessages limit is capped at the schema layer (max 500)", () => {
    const start = routers.indexOf("starredMessages: publicProcedure");
    const block = routers.slice(start, start + 500);
    expect(block).toMatch(/\.max\(500\)/);
  });
});

/* ─────────────────────────── client wiring ─────────────────────────── */

describe("QW-3 — client star wiring", () => {
  it("the message menu offers a star toggle that flips label by state", () => {
    // The item shows Unstar when already starred, Star otherwise.
    expect(messages).toMatch(/onToggleStar\(\); setOpen\(false\)/);
    expect(messages).toMatch(/t\("msg\.unstarAction"\)/);
    expect(messages).toMatch(/t\("msg\.starAction"\)/);
  });

  it("star is offered on BOTH my own and received messages (unlike report)", () => {
    // Both call sites pass onToggleStar/starred. Report is received-only, but star
    // is offered everywhere — so the toggle wiring must appear at least twice.
    const occurrences = messages.match(/onToggleStar=\{\(\) => toggleStar\(m\.id, starredIds\.has\(m\.id\)\)\}/g) ?? [];
    expect(occurrences.length).toBeGreaterThanOrEqual(2);
  });

  it("the star mutation and per-conversation id query are wired in ConversationView", () => {
    expect(messages).toMatch(/trpc\.identity\.starredIdsInConversation\.useQuery/);
    expect(messages).toMatch(/trpc\.identity\.setMessageStar\.useMutation/);
    // The toggle computes the next state from the current one.
    expect(messages).toMatch(/starMutation\.mutate\(\{ messageId, starred: !currentlyStarred \}\)/);
  });

  it("a starred bubble shows a filled star marker on its own side", () => {
    expect(messages).toMatch(/starredIds\.has\(m\.id\) && \(/);
    expect(messages).toMatch(/fill-amber-400 text-amber-400/);
  });

  it("the Starred view opens from the header and lists starred messages", () => {
    // Header entry.
    expect(messages).toMatch(/setStarredOpen\(true\)/);
    // The sheet queries the cross-conversation list and navigates on tap.
    expect(messages).toMatch(/trpc\.identity\.starredMessages\.useQuery/);
    expect(messages).toMatch(/onOpenConversation\(r\.conversationId\)/);
  });

  it("the header star state actually exists (would fail to compile otherwise)", () => {
    expect(messages).toMatch(/const \[starredOpen, setStarredOpen\] = useState\(false\)/);
  });
});

/* ─────────────────────────── locale ─────────────────────────── */

describe("QW-3 — bilingual strings", () => {
  const hasBilingualKey = (src: string, key: string, prefix: string): boolean => {
    const at = src.indexOf(`"${key}":`);
    if (at < 0) return false;
    const rest = src.slice(at + key.length);
    const nextKey = rest.indexOf(`"${prefix}`, 3);
    const entry = nextKey > 0 ? rest.slice(0, nextKey) : rest.slice(0, 400);
    return /\ben:/.test(entry) && /\bar:/.test(entry);
  };

  it("carries every star string in both locales", () => {
    for (const key of [
      "msg.starAction",
      "msg.unstarAction",
      "msg.starFailed",
      "msg.starredTitle",
      "msg.starredEmpty",
      "msg.starredHint",
      "msg.starredNoText",
      "msg.tabStarred",
    ]) {
      expect(hasBilingualKey(msgDict, key, '"msg.')).toBe(true);
    }
  });

  it("the shared close/loading strings the sheet uses are bilingual", () => {
    for (const key of ["common.close", "common.loading"]) {
      expect(hasBilingualKey(coreDict, key, '"common.')).toBe(true);
    }
  });
});
