/**
 * PINNED MESSAGES (QW-8, v2.107.60) — a CONVERSATION-WIDE pin: a message pinned for
 * everyone in the chat, shown in a banner at the top, admin-gated in groups. Distinct
 * from the private per-user star (message_stars).
 *
 * The feature is two new columns on the messages table threaded end to end plus an
 * admin-gated toggle. This pins each seam — schema, the boot migrator that puts the
 * columns on the live DB, the capability that keeps group-pinning admin-only, the
 * DB helper's gate, the router's error map + SSE fan-out, the wire serialization, and
 * the client's banner/menu wiring — so a half-wired pin can't pass. House style:
 * codeOnly()-stripped source, so a pin can never pass on a comment, plus a bilingual
 * check on the new dictionary keys.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { codeOnly } from "./testing/codeOnly";

const read = (rel: string) => readFileSync(join(__dirname, rel), "utf8");
const schema = codeOnly(read("../drizzle/schema.ts"));
const v2db = codeOnly(read("./v2db.ts"));
const routers = codeOnly(read("./v2routers.ts"));
const messages = codeOnly(read("../client/src/pages/app/Messages.tsx"));
const msgDict = read("../client/src/app/dict/messages.ts");
const version = read("../shared/version.ts");

const hasBilingualKey = (src: string, key: string, prefix: string): boolean => {
  const at = src.indexOf(`"${key}":`);
  if (at < 0) return false;
  const rest = src.slice(at + key.length);
  const nextKey = rest.indexOf(`"${prefix}`, 3);
  const entry = nextKey > 0 ? rest.slice(0, nextKey) : rest.slice(0, 400);
  return /\ben:/.test(entry) && /\bar:/.test(entry);
};

/* ───────────────────────────── schema + migrator ───────────────────────────── */

describe("QW-8 — the messages table gains pin columns", () => {
  it("adds pinnedAt and pinnedByIdentityId", () => {
    expect(schema).toMatch(/pinnedAt: timestamp\("pinnedAt"\)/);
    expect(schema).toMatch(/pinnedByIdentityId: int\("pinnedByIdentityId"\)/);
  });

  it("the boot migrator ADDs both columns (additive, so old messages read as unpinned)", () => {
    expect(v2db).toMatch(
      /\{ table: "messages", column: "pinnedAt", ddl: "ADD COLUMN `pinnedAt` timestamp NULL" \}/,
    );
    expect(v2db).toMatch(
      /\{ table: "messages", column: "pinnedByIdentityId", ddl: "ADD COLUMN `pinnedByIdentityId` int" \}/,
    );
  });
});

/* ─────────────────── capability: group-pinning is admin-only ─────────────────── */

describe("QW-8 — pin-message is an admin-only group capability", () => {
  it("adds pin-message to the capability union", () => {
    expect(v2db).toMatch(/\| "pin-message"/);
  });

  it("keeps pin-message OUT of MEMBER_CAPABILITIES (so it is admin-only by default)", () => {
    const at = v2db.indexOf("const MEMBER_CAPABILITIES = new Set");
    const line = v2db.slice(at, at + 160);
    expect(line).not.toMatch(/pin-message/);
  });
});

/* ─────────────────────── db helper: the gate is inside ─────────────────────── */

describe("QW-8 — setMessagePin gates the write itself", () => {
  it("admin-gates a group and membership-gates a DM", () => {
    const at = v2db.indexOf("export async function setMessagePin");
    const fn = v2db.slice(at, at + 2400);
    // Group branch consults the capability; DM branch checks membership.
    expect(fn).toMatch(/checkGroupPermission\(input\.conversationId, input\.identityId, "pin-message"\)/);
    expect(fn).toMatch(/getConversationParticipantIds\(input\.conversationId\)/);
    expect(fn).toMatch(/members\.includes\(input\.identityId\)/);
  });

  it("refuses a message that isn't in the named conversation (no id oracle)", () => {
    const at = v2db.indexOf("export async function setMessagePin");
    const fn = v2db.slice(at, at + 2400);
    expect(fn).toMatch(/row\.conversationId !== input\.conversationId/);
  });

  it("stamps pinnedAt+pinnedBy on pin and clears both on unpin", () => {
    const at = v2db.indexOf("export async function setMessagePin");
    const fn = v2db.slice(at, at + 2400);
    expect(fn).toMatch(/pinnedAt: new Date\(\), pinnedByIdentityId: input\.identityId/);
    expect(fn).toMatch(/pinnedAt: null, pinnedByIdentityId: null/);
  });

  it("the pinned lookup is membership-gated and excludes deleted messages", () => {
    const at = v2db.indexOf("export async function listPinnedMessages");
    const fn = v2db.slice(at, at + 1400);
    expect(fn).toMatch(/members\.includes\(identityId\)/);
    expect(fn).toMatch(/isNotNull\(messages\.pinnedAt\)/);
    expect(fn).toMatch(/isNull\(messages\.deletedAt\)/);
  });
});

/* ──────────────────────── router: procedure + wire ──────────────────────── */

describe("QW-8 — the router exposes pin and serializes it", () => {
  it("setMessagePin takes conversationId, messageId and a pinned boolean", () => {
    const at = routers.indexOf("setMessagePin: publicProcedure");
    const proc = routers.slice(at, at + 1600);
    expect(proc).toMatch(/conversationId: z\.number\(\)\.int\(\)\.positive\(\)/);
    expect(proc).toMatch(/messageId: z\.number\(\)\.int\(\)\.positive\(\)/);
    expect(proc).toMatch(/pinned: z\.boolean\(\)/);
  });

  it("maps not-an-admin to FORBIDDEN and fans out the existing message SSE kind", () => {
    const at = routers.indexOf("setMessagePin: publicProcedure");
    const proc = routers.slice(at, at + 2000);
    expect(proc).toMatch(/"not-an-admin": \{ code: "FORBIDDEN"/);
    expect(proc).toMatch(/publishToIdentity\(id, \{ kind: "message", conversationId: input\.conversationId, from: me\.id \}\)/);
  });

  it("pinnedMessages returns the conversation's pins for the banner", () => {
    const at = routers.indexOf("pinnedMessages: publicProcedure");
    const proc = routers.slice(at, at + 900);
    expect(proc).toMatch(/listPinnedMessages\(me\.id, input\.conversationId\)/);
  });

  it("pinnedAt is serialized onto every message on the wire", () => {
    expect(routers).toMatch(/pinnedAt: r\.pinnedAt \?\? null/);
  });
});

/* ──────────────────────── client: menu + banner ──────────────────────── */

describe("QW-8 — the client can pin and shows the banner", () => {
  it("can-pin is admin in a group and anyone in a DM", () => {
    expect(messages).toMatch(/const canPin = !isGroup \|\| iAmGroupAdmin/);
  });

  it("the pin toggle calls the mutation with the conversation and the flipped state", () => {
    expect(messages).toMatch(/pinMutation\.mutate\(\{ conversationId, messageId, pinned: !currentlyPinned \}\)/);
  });

  it("the menu offers Pin only when the caller may pin, at both call sites", () => {
    const sites = [...messages.matchAll(/onTogglePin=\{canPin \? \(\) => togglePin\(m\.id, pinnedIds\.has\(m\.id\)\) : undefined\}/g)];
    expect(sites.length).toBe(2);
  });

  it("the banner renders only when something is pinned and jumps on tap", () => {
    expect(messages).toMatch(/const pins = pinnedQuery\.data\?\.pins \?\? \[\]/);
    expect(messages).toMatch(/if \(pins\.length === 0\) return null/);
    expect(messages).toMatch(/onClick=\{\(\) => jumpToMessage\(top\.id\)\}/);
  });

  it("jump-to is best-effort via data-mid and flashes the target", () => {
    expect(messages).toMatch(/data-mid=\{m\.id\}/);
    expect(messages).toMatch(/querySelector<HTMLElement>\(`\[data-mid="\$\{messageId\}"\]`\)/);
    expect(messages).toMatch(/flashMid === m\.id/);
  });

  it("a pinned bubble carries its own pin marker", () => {
    expect(messages).toMatch(/pinnedIds\.has\(m\.id\) && \(/);
  });
});

/* ─────────────────────────── i18n + version ─────────────────────────── */

describe("QW-8 — strings are bilingual and it ships in 2.107.61", () => {
  it("pin action, failure and banner strings are in en and ar", () => {
    expect(hasBilingualKey(msgDict, "msg.pinAction", '"msg.')).toBe(true);
    expect(hasBilingualKey(msgDict, "msg.unpinAction", '"msg.')).toBe(true);
    expect(hasBilingualKey(msgDict, "msg.pinFailed", '"msg.')).toBe(true);
    expect(hasBilingualKey(msgDict, "msg.pinnedLabel", '"msg.')).toBe(true);
    expect(hasBilingualKey(msgDict, "msg.pinnedCount", '"msg.')).toBe(true);
    expect(hasBilingualKey(msgDict, "msg.pinnedMedia", '"msg.')).toBe(true);
  });

  it("the app version is 2.107.61", () => {
    expect(version).toMatch(/APP_VERSION = "2\.107\.61"/);
  });
});
